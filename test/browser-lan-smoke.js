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
async function targets(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
      const page = list.find(item => item.type === 'page');
      if (page) return page;
    } catch (_) {}
    await sleep(100);
  }
  throw new Error('Chrome DevTools 未就绪');
}
function cdp(url) {
  const socket = new WebSocket(url), pending = new Map(); let id = 0;
  socket.on('message', raw => {
    const msg = JSON.parse(raw.toString()), pair = pending.get(msg.id);
    if (!pair) return; pending.delete(msg.id);
    if (msg.error) pair.reject(new Error(msg.error.message)); else pair.resolve(msg.result);
  });
  return {
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

async function openChrome(gamePort, debugPort, suffix) {
  const profile = path.join(os.tmpdir(), 'burning-chariot-chrome-' + process.pid + '-' + suffix);
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile,
    'http://127.0.0.1:' + gamePort + '/'
  ], { stdio: 'ignore', windowsHide: true });
  const page = await targets(debugPort), client = cdp(page.webSocketDebuggerUrl);
  await client.ready; await client.call('Runtime.enable'); await sleep(500);
  return { proc, client };
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
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
    await sleep(220);
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowRight'}))");
    await sleep(500);
    const after = await evaluate(client, "({player:window.__game.active.playerId,x:window.__game.active.x,fuel:window.__game.active.fuel})");
    if (after.player !== 2 || (after.x === before.x && after.fuel === before.fuel)) throw new Error('P2 MOVE 未到达权威端: ' + JSON.stringify({ before, after }));
    console.log('  ok   P2 MOVE 经网络在 P1 权威 Game 中执行');

    // 蓄力期间权威快照仍会持续抵达；本地力度必须平滑增长，松手后以真实力度在 P1 开火。
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keydown',{key:' '}))");
    await sleep(850);
    const charging = await evaluate(guest, "({power:window.__game.active.power,phase:window.__game.phase,player:window.__game.active.playerId})");
    if (charging.player !== 2 || charging.phase !== 'aim' || charging.power < 25) throw new Error('P2 蓄力被快照清零: ' + JSON.stringify(charging));
    await evaluate(guest, "window.dispatchEvent(new KeyboardEvent('keyup',{key:' '}))");
    await sleep(350);
    const fired = await evaluate(client, "({power:window.__game.units[1].lastPower,phase:window.__game.phase,fuel:window.__game.units[1].fuel})");
    if (fired.power < 25 || fired.fuel >= before.fuel) throw new Error('P2 FIRE 未以蓄力值执行: ' + JSON.stringify(fired));
    console.log('  ok   P2 蓄力不再被快照清零并能正常开火');

    client.close(); guest.close();
  } finally {
    if (one) one.proc.kill();
    if (two) two.proc.kill();
    await new Promise(resolve => app.server.close(resolve));
  }
  console.log('\n✅ Browser LAN Smoke 通过 7 项');
})().catch(err => { console.error('\n❌ Browser LAN Smoke 失败\n' + err.stack); process.exitCode = 1; });
