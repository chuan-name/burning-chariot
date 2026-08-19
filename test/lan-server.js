#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const { createLanServer } = require('../server/server');

let passed = 0;
function ok(label) { passed++; console.log('  ok   ' + label); }
function nextMessage(ws, type, timeout) {
  timeout = timeout || 1500;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('等待 ' + type + ' 超时')); }, timeout);
    function onMessage(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== type) return;
      cleanup(); resolve(msg);
    }
    function onClose() { cleanup(); reject(new Error('连接提前关闭')); }
    function cleanup() { clearTimeout(timer); ws.off('message', onMessage); ws.off('close', onClose); }
    ws.on('message', onMessage); ws.on('close', onClose);
  });
}
function send(ws, value) { ws.send(JSON.stringify(value)); }
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let opened = false, hello = null;
    function done() { if (opened && hello) { ws._hello = hello; resolve(ws); } }
    ws.once('open', () => { opened = true; done(); });
    ws.on('message', raw => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'CONNECTED') { hello = msg; done(); }
    });
    ws.once('error', reject);
  });
}
function request(port, pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathname }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}
function closeWs(ws) {
  return new Promise(resolve => {
    if (!ws || ws.readyState === WebSocket.CLOSED) return resolve();
    ws.once('close', resolve); ws.close();
    setTimeout(() => { ws.terminate(); resolve(); }, 300).unref();
  });
}

(async function () {
  console.log('\nLAN Server');
  const app = createLanServer({ roomOptions: { reconnectGrace: 300 } });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const port = app.server.address().port;
  const url = 'ws://127.0.0.1:' + port + '/ws';
  const sockets = [];
  try {
    const page = await request(port, '/');
    assert.equal(page.status, 200); assert.match(page.body, /Burning Chariot/);
    ok('HTTP 静态资源访问');
    const health = await request(port, '/health');
    assert.equal(JSON.parse(health.body).service, 'burning-chariot');
    ok('健康检查可识别 Burning Chariot Server');
    const traversal = await request(port, '/../package.json');
    assert.notEqual(traversal.status, 200);
    ok('HTTP Server 拒绝目录穿越');

    const host = await connect(url); sockets.push(host);
    const connected = host._hello;
    assert.equal(connected.protocol, 1); ok('WebSocket 连接');

    const createdP = nextMessage(host, 'ROOM_CREATED');
    send(host, { type: 'CREATE_ROOM' });
    const created = await createdP;
    assert.match(created.roomId, /^\d{6}$/); assert.equal(created.playerId, 1);
    ok('创建 6 位房间并分配 Player 1');

    const missing = await connect(url); sockets.push(missing);
    const missingP = nextMessage(missing, 'ERROR');
    send(missing, { type: 'JOIN_ROOM', roomId: '999999' });
    assert.equal((await missingP).code, 'ROOM_NOT_FOUND');
    ok('加入不存在的房间会被拒绝');

    const guest = await connect(url); sockets.push(guest);
    const joinedP = nextMessage(guest, 'ROOM_JOINED');
    const hostJoinedP = nextMessage(host, 'PLAYER_JOINED');
    send(guest, { type: 'JOIN_ROOM', roomId: created.roomId });
    const joined = await joinedP; await hostJoinedP;
    assert.equal(joined.playerId, 2); assert.equal(joined.roomId, created.roomId);
    ok('加入房间并分配 Player 2');

    const third = await connect(url); sockets.push(third);
    const fullP = nextMessage(third, 'ERROR');
    send(third, { type: 'JOIN_ROOM', roomId: created.roomId });
    assert.equal((await fullP).code, 'ROOM_FULL');
    ok('第三名玩家加入已满房间会被拒绝');

    send(host, { type: 'HOST_STATE', currentPlayerId: 1, started: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    const deniedP = nextMessage(guest, 'ERROR');
    send(guest, { type: 'ACTION', action: 'MOVE', direction: 'left' });
    assert.equal((await deniedP).code, 'NOT_YOUR_TURN');
    ok('非自己回合的远端 Action 在服务器层被拒绝');

    send(host, { type: 'HOST_STATE', currentPlayerId: 2, started: true });
    await new Promise(resolve => setTimeout(resolve, 20));
    const actions = [
      { action: 'MOVE', direction: 'right' },
      { action: 'SET_ANGLE', value: 54 },
      { action: 'SELECT_WEAPON', weapon: 1 },
      { action: 'FIRE', angle: 54, power: 72, weapon: 1 },
      { action: 'USE_ITEM', itemIndex: 0 },
      { action: 'END_TURN' }
    ];
    for (const action of actions) {
      const relayP = nextMessage(host, 'ACTION');
      send(guest, Object.assign({ type: 'ACTION' }, action));
      const relayed = await relayP;
      assert.equal(relayed.action, action.action); assert.equal(relayed.playerId, 2);
      ok(action.action + ' 语义 Action 正确转发');
    }

    const snapshotP = nextMessage(guest, 'STATE_SNAPSHOT');
    send(host, { type: 'STATE_SNAPSHOT', state: { version: 3, hp: [800, 700], wind: 5 } });
    assert.equal((await snapshotP).state.version, 3);
    ok('权威 STATE_SNAPSHOT 只由 Player 1 下发');

    const hostOnlyP = nextMessage(guest, 'ERROR');
    send(guest, { type: 'STATE_SNAPSHOT', state: {} });
    assert.equal((await hostOnlyP).code, 'HOST_ONLY');
    ok('Player 2 不能伪造权威状态');

    const hostLeftP = nextMessage(host, 'PLAYER_DISCONNECTED');
    await closeWs(guest);
    assert.equal((await hostLeftP).playerId, 2);
    ok('客户端断线会通知对方');

    const reservedP = nextMessage(third, 'ERROR');
    send(third, { type: 'JOIN_ROOM', roomId: created.roomId });
    assert.equal((await reservedP).code, 'ROOM_FULL');
    ok('断线宽限期内席位不会被抢占');

    const guest2 = await connect(url); sockets.push(guest2);
    const reconnectedP = nextMessage(guest2, 'RECONNECTED');
    const hostReconnectP = nextMessage(host, 'PLAYER_RECONNECTED');
    send(guest2, { type: 'RECONNECT', roomId: created.roomId, reconnectToken: joined.reconnectToken });
    assert.equal((await reconnectedP).playerId, 2); await hostReconnectP;
    ok('凭重连 token 恢复 Player 2 席位');

    const disconnectedAgainP = nextMessage(host, 'PLAYER_DISCONNECTED');
    await closeWs(guest2); await disconnectedAgainP;
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(app.rooms.rooms.get(created.roomId).players.has(2), false);
    ok('断线宽限期后释放 Player 2 席位');

    send(host, { type: 'LEAVE_ROOM' });
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(app.rooms.rooms.has(created.roomId), false);
    ok('房主离开后销毁房间');

    const bat = fs.readFileSync(require('path').join(__dirname, '..', 'start-lan.bat'), 'utf8');
    assert.match(bat, /cd \/d "%~dp0"/i); assert.match(bat, /server\\server\.js/i);
    assert.match(bat, /localhost:3000/i);
    ok('start-lan.bat 定位目录、启动服务并自动打开浏览器');
  } finally {
    await Promise.all(sockets.map(closeWs));
    await new Promise(resolve => app.server.close(resolve));
  }
  console.log('\n✅ LAN Server 通过 ' + passed + ' 项');
})().catch(err => { console.error('\n❌ LAN Server 测试失败\n' + err.stack); process.exitCode = 1; });
