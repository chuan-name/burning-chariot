'use strict';

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { createLanServer, lanAddresses } = require('./server');

const PORT = 3000;
// SEA 现代版从 EXE 旁读取 game；Windows 7 启动器则通过环境变量指向
// 发行目录中的 game，避免把资源误判到 runtime/game。
const ROOT = process.env.BC_GAME_ROOT
  ? path.resolve(process.env.BC_GAME_ROOT)
  : path.join(path.dirname(process.execPath), 'game');

function openBrowser() {
  if (process.env.BC_NO_BROWSER === '1') return;
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', 'http://localhost:' + PORT], {
    detached: true, stdio: 'ignore', windowsHide: true
  });
  child.unref();
}

function banner(alreadyRunning) {
  console.log('============================================');
  console.log('          Burning Chariot 已启动');
  console.log('============================================\n');
  if (alreadyRunning) console.log('端口 3000 已被 Burning Chariot 占用，将打开已有服务。\n');
  console.log('本机访问：\nhttp://localhost:' + PORT + '\n');
  const addresses = lanAddresses();
  if (addresses.length) {
    console.log('其他局域网玩家访问：');
    addresses.forEach(address => console.log('http://' + address + ':' + PORT));
  } else console.log('未检测到可用的局域网 IPv4 地址。');
  if (!alreadyRunning) console.log('\n服务器运行中... 按 Ctrl+C 停止服务器');
  console.log('============================================');
}

function probeExisting(callback) {
  const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 700 }, res => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try { callback(JSON.parse(body).service === 'burning-chariot'); }
      catch (_) { callback(false); }
    });
  });
  req.on('timeout', () => { req.destroy(); callback(false); });
  req.on('error', () => callback(false));
}

probeExisting(existing => {
  if (existing) { banner(true); openBrowser(); return; }
  const app = createLanServer({
    root: ROOT,
    onError(err) {
      if (err.code === 'EADDRINUSE') {
        console.error('\n端口 3000 已被占用，但不是可识别的 Burning Chariot Server。');
        console.error('请关闭占用该端口的程序后重试。');
      } else console.error('服务器启动失败：' + err.message);
      process.exitCode = 1;
    }
  });
  app.server.listen(PORT, '0.0.0.0', () => { banner(false); openBrowser(); });
});
