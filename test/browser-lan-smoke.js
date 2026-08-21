#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('ws');
const { createLanServer } = require('../server/server');

const candidates = process.platform === 'win32' ? [
  path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
const chrome = candidates.find(file => file && fs.existsSync(file));
if (!chrome) { console.log('SKIP 未找到 Chrome/Edge，跳过浏览器 LAN 冒烟测试'); process.exit(0); }

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function chromeError(message, proc, getStderr, exit) {
  const state = exit || { code: proc.exitCode, signal: proc.signalCode };
  return new Error([
    message,
    'Chrome executable: ' + chrome,
    'exit code: ' + (state.code == null ? '(not exited)' : state.code),
    'signal: ' + (state.signal || '(none)'),
    'Chrome stderr (last 8 KB):',
    getStderr() || '(empty)'
  ].join('\n'));
}
async function targets(port, proc, getStderr, exitPromise) {
  for (let i = 0; i < 100; i++) {
    const result = await Promise.race([
      (async () => {
        try {
          const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
          return { page: list.find(item => item.type === 'page') };
        } catch (_) { return {}; }
      })(),
      exitPromise.then(exit => ({ exit }))
    ]);
    if (result.exit) throw chromeError('Chrome 在 DevTools 准备完成前退出', proc, getStderr, result.exit);
    if (result.page) return result.page;
    const exit = await Promise.race([sleep(200).then(() => null), exitPromise]);
    if (exit) throw chromeError('Chrome 在 DevTools 准备完成前退出', proc, getStderr, exit);
  }
  throw chromeError('Chrome DevTools 未就绪', proc, getStderr);
}
function cdp(url) {
  const socket = new WebSocket(url), pending = new Map(), runtimeExceptions = []; let id = 0;
  socket.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(msg.params.exceptionDetails);
      if (runtimeExceptions.length > 20) runtimeExceptions.shift();
      return;
    }
    const pair = pending.get(msg.id);
    if (!pair) return; pending.delete(msg.id);
    if (msg.error) pair.reject(new Error(msg.error.message)); else pair.resolve(msg.result);
  });
  return {
    runtimeExceptions,
    ready: new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }),
    call(method, params) {
      return new Promise((resolve, reject) => {
        const callId = ++id; pending.set(callId, { resolve, reject });
        socket.send(JSON.stringify({ id: callId, method, params: params || {} }));
      });
    },
    close() { socket.close(); }
  };
}

async function evaluate(client, expression) {
  const out = await client.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (out.exceptionDetails) throw new Error('页面脚本异常: ' + JSON.stringify(out.exceptionDetails));
  return out.result.value;
}

async function waitForGameReady(client, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let state = { readyState: '(unknown)', rz: '(unknown)', game: '(unknown)', network: '(unknown)' };
  let evaluateError = null;
  while (Date.now() < deadline) {
    try {
      state = await evaluate(client, `(() => {
        const rz = typeof window.RZ;
        return {
          readyState: document.readyState,
          rz,
          game: rz === 'object' && window.RZ ? typeof window.RZ.Game : 'undefined',
          network: rz === 'object' && window.RZ ? typeof window.RZ.LanClient : 'undefined'
        };
      })()`);
      evaluateError = null;
      if (state.readyState === 'complete' && state.rz === 'object' &&
          state.game === 'function' && state.network === 'function') return;
    } catch (error) {
      evaluateError = error;
    }
    await sleep(150);
  }
  const exceptions = client.runtimeExceptions.map((details, index) => {
    const exception = details.exception || {};
    const text = exception.description || exception.value || details.text || JSON.stringify(details);
    const location = details.url ? details.url + ':' + (details.lineNumber + 1) + ':' + (details.columnNumber + 1) : '';
    return '[' + (index + 1) + '] ' + text + (location ? '\n    at ' + location : '');
  });
  throw new Error([
    '游戏脚本就绪超时',
    'document.readyState: ' + state.readyState,
    'typeof window.RZ: ' + state.rz,
    'typeof RZ.Game: ' + state.game,
    'typeof RZ.LanClient: ' + state.network,
    evaluateError ? '最后一次状态检查错误: ' + evaluateError.message : '',
    'Runtime.exceptionThrown:',
    exceptions.length ? exceptions.join('\n') : '(none)'
  ].filter(Boolean).join('\n'));
}

async function openChrome(gamePort, debugPort, suffix) {
  const profile = path.join(os.tmpdir(), 'burning-chariot-chrome-' + process.pid + '-' + suffix);
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile,
    'http://127.0.0.1:' + gamePort + '/'
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = Buffer.alloc(0);
  proc.stderr.on('data', chunk => {
    stderr = Buffer.concat([stderr, Buffer.from(chunk)]);
    if (stderr.length > 8192) stderr = stderr.subarray(stderr.length - 8192);
  });
  const getStderr = () => stderr.toString('utf8').trim();
  const exitPromise = new Promise(resolve => {
    proc.once('error', error => resolve({ code: proc.exitCode, signal: proc.signalCode, error }));
    proc.once('exit', (code, signal) => resolve({ code, signal }));
  });
  try {
    const page = await targets(debugPort, proc, getStderr, exitPromise), client = cdp(page.webSocketDebuggerUrl);
    await client.ready; await client.call('Runtime.enable'); await waitForGameReady(client, 20000);
    return { proc, client };
  } catch (error) {
    if (!proc.killed) proc.kill();
    throw error;
  }
}

(async function () {
  const app = createLanServer();
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const gamePort = app.server.address().port;
  const debugPort = 9300 + Math.floor(Math.random() * 300);
  let one = null, two = null;
  try {
    one = await openChrome(gamePort, debugPort, 'one');
    const client = one.client;
    const v = await evaluate(client, "({title:document.title,menu:!!document.getElementById('btn-lan-menu'),game:typeof RZ.Game,network:typeof RZ.LanClient})");
    if (!v.menu || v.game !== 'function' || v.network !== 'function') throw new Error('脚本或菜单未加载: ' + JSON.stringify(v));
    await evaluate(client, "document.getElementById('btn-lan-menu').click()");
    await sleep(300);
    await evaluate(client, "document.getElementById('btn-create-room').click()");
    await sleep(500);
    const l = await evaluate(client, "({screen:document.getElementById('screen-lan').classList.contains('active'),room:document.getElementById('lan-room-id').textContent,connection:document.getElementById('lan-connection').textContent,entryHidden:document.getElementById('lan-entry').hidden})");
    if (!l.screen || !/^\d{6}$/.test(l.room) || !l.entryHidden) throw new Error('大厅创建房间失败: ' + JSON.stringify(l));
    console.log('  ok   浏览器加载单机首页且未发生脚本错误');
    console.log('  ok   浏览器主动进入 LAN 后建立 WebSocket');
    console.log('  ok   浏览器创建 6 位房间并显示大厅');

    two = await openChrome(gamePort, debugPort + 1, 'two');
    const guest = two.client;
    await evaluate(guest, "document.getElementById('btn-lan-menu').click()"); await sleep(250);
    await evaluate(guest, "document.getElementById('lan-room-input').value='" + l.room + "';document.getElementById('btn-join-room').click()");
    await sleep(500);
    const joined = await evaluate(guest, "({room:document.getElementById('lan-room-id').textContent,player:document.getElementById('lan-player-2').classList.contains('local')})");
    if (joined.room !== l.room || !joined.player) throw new Error('第二浏览器加入失败: ' + JSON.stringify(joined));
    console.log('  ok   第二浏览器加入并获得 Player 2');

    await evaluate(guest, "document.getElementById('btn-lan-ready').click()"); await sleep(250);
    await evaluate(client, "document.getElementById('btn-lan-ready').click()"); await sleep(1200);
    const battle1 = await evaluate(client, "({screen:document.getElementById('screen-game').classList.contains('active'),local:window.__game&&window.__game.opts.localPlayerId,active:window.__game&&window.__game.active.playerId})");
    const battle2 = await evaluate(guest, "({screen:document.getElementById('screen-game').classList.contains('active'),local:window.__game&&window.__game.opts.localPlayerId,active:window.__game&&window.__game.active.playerId})");
    if (!battle1.screen || !battle2.screen || battle1.local !== 1 || battle2.local !== 2) throw new Error('双方未进入战场: ' + JSON.stringify({ battle1, battle2 }));
    console.log('  ok   双方准备后进入 P1 权威战场');

    // P1 跳过第一手，让 P2 获得操作权；P2 的输入必须经 WebSocket 在 P1 Game 中执行。
    await evaluate(client, "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter'}))");
    await sleep(800);
    const before = await evaluate(client, "({player:window.__game.active.playerId,x:window.__game.active.x,fuel:window.__game.active.fuel})");
    if (before.player !== 2) throw new Error('未轮到 P2: ' + JSON.stringify(before));
    const guestBefore = await evaluate(guest, "({x:window.__game.active.x,fuel:window.__game.active.fuel})");
    await evaluate(guest, "(function(){var p=RZ.LanClient.prototype,o=p.sendAction;window.__lanOriginalSendAction=o;window.__lanDelayedActions=[];p.sendAction=function(a){var self=this;window.__lanDelayedActions.push(Object.assign({},a));setTimeout(function(){o.call(self,a);},600);return true;};})()");
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
    await sleep(80);
    const predicted = await evaluate(guest, "({x:window.__game.active.x,fuel:window.__game.active.fuel,moves:window.__lanDelayedActions.filter(function(a){return a.action==='MOVE';})})");
    const movedSteps = Math.round((predicted.x - guestBefore.x) / 2);
    const reportedSteps = predicted.moves.reduce(function (sum, action) { return sum + action.steps; }, 0);
    if (movedSteps < 2 || predicted.fuel >= guestBefore.fuel || predicted.moves.length >= movedSteps || reportedSteps !== movedSteps || predicted.moves.some(function(a){return a.steps<1||a.steps>4;})) throw new Error('P2 高延迟下未立即本地预测/批量移动: ' + JSON.stringify({ guestBefore, predicted, movedSteps, reportedSteps }));
    console.log('  ok   P2 高延迟下立即本地预测移动');
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}))");
    await evaluate(guest, "RZ.LanClient.prototype.sendAction=window.__lanOriginalSendAction");
    await sleep(850);
    const after = await evaluate(client, "({player:window.__game.active.playerId,x:window.__game.active.x,fuel:window.__game.active.fuel})");
    if (after.player !== 2 || (after.x === before.x && after.fuel === before.fuel)) throw new Error('P2 MOVE 未到达权威端: ' + JSON.stringify({ before, after }));
    console.log('  ok   P2 MOVE 经网络在 P1 权威 Game 中执行');
    const reconciled = await evaluate(guest, "({x:window.__game.active.x,fuel:window.__game.active.fuel})");
    if (Math.abs(reconciled.x - after.x) > 4 || Math.abs(reconciled.fuel - after.fuel) > 1) throw new Error('P2 移动预测未与权威状态收敛: ' + JSON.stringify({ after, reconciled }));
    console.log('  ok   P2 移动预测与权威状态完成校正');

    await evaluate(guest, "(function(){var p=RZ.LanClient.prototype,o=p.sendAction;window.__lanOriginalSendAction=o;window.__lanDelayedActions=[];p.sendAction=function(a){var self=this;window.__lanDelayedActions.push(Object.assign({},a));setTimeout(function(){o.call(self,a);},600);return true;};})()");
    const angleBefore = await evaluate(guest, "window.__game.active.aim");
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp'}))");
    await sleep(80);
    const anglePredicted = await evaluate(guest, "({aim:window.__game.active.aim,angles:window.__lanDelayedActions.filter(function(a){return a.action==='SET_ANGLE';})})");
    if (anglePredicted.aim <= angleBefore || anglePredicted.angles.length > 3) throw new Error('P2 高延迟下角度未立即响应/未合并: ' + JSON.stringify({ angleBefore, anglePredicted }));
    console.log('  ok   P2 高延迟下角度立即响应并合并上报');
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowUp'}));RZ.LanClient.prototype.sendAction=window.__lanOriginalSendAction");
    await sleep(850);
    const authoritativeAngle = await evaluate(client, "window.__game.active.aim");
    if (Math.abs(authoritativeAngle - anglePredicted.aim) > 1) throw new Error('P2 角度未在权威端收敛: ' + JSON.stringify({ authoritativeAngle, anglePredicted }));
    console.log('  ok   P2 角度预测与权威状态完成校正');

    // 蓄力期间权威快照仍会持续抵达；本地力度必须平滑增长，松手后以真实力度在 P1 开火。
    await evaluate(guest, "(function(){var p=RZ.LanClient.prototype,o=p.sendAction;window.__lanOriginalSendAction=o;p.sendAction=function(a){var self=this;setTimeout(function(){o.call(self,a);},600);return true;};})()");
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keydown',{key:' '}))");
    await sleep(850);
    const charging = await evaluate(guest, "({power:window.__game.active.power,phase:window.__game.phase,player:window.__game.active.playerId})");
    if (charging.player !== 2 || charging.phase !== 'aim' || charging.power < 25) throw new Error('P2 蓄力被快照清零: ' + JSON.stringify(charging));
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keyup',{key:' '}))");
    await sleep(80);
    const localFired = await evaluate(guest, "({phase:window.__game.phase,projectiles:window.__game.projectiles.length})");
    if (localFired.phase !== 'fly' || localFired.projectiles < 1) throw new Error('P2 高延迟下未立即显示本地预测弹道: ' + JSON.stringify(localFired));
    console.log('  ok   P2 松开空格后立即显示本地预测弹道');
    await evaluate(guest, "RZ.LanClient.prototype.sendAction=window.__lanOriginalSendAction");
    await sleep(850);
    const fired = await evaluate(client, "({power:window.__game.units[1].lastPower,phase:window.__game.phase,fuel:window.__game.units[1].fuel})");
    if (fired.power < 25 || fired.fuel >= before.fuel) throw new Error('P2 FIRE 未以蓄力值执行: ' + JSON.stringify(fired));
    console.log('  ok   P2 蓄力不再被快照清零并能正常开火');

    client.close(); guest.close();
  } finally {
    if (one) one.proc.kill();
    if (two) two.proc.kill();
    await new Promise(resolve => app.server.close(resolve));
  }
  console.log('\n✅ Browser LAN Smoke 通过 12 项');
})().catch(err => { console.error('\n❌ Browser LAN Smoke 失败\n' + err.stack); process.exitCode = 1; });
