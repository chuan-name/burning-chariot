#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RoomManager } = require('./room-manager');

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const DEFAULT_HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.resolve(__dirname, '..');
const MAX_MESSAGE_BYTES = 64 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8'
};

function lanAddresses() {
  const out = [];
  const virtual = /loopback|vmware|virtualbox|hyper-v|vethernet|docker|wsl|tailscale/i;
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(name => {
    if (virtual.test(name)) return;
    (nets[name] || []).forEach(info => {
      const family = typeof info.family === 'string' ? info.family : info.family === 4 ? 'IPv4' : '';
      if (family !== 'IPv4' || info.internal || info.address === '0.0.0.0' || info.address.startsWith('169.254.')) return;
      out.push(info.address);
    });
  });
  return [...new Set(out)];
}

function safeFile(urlPath, root) {
  let decoded;
  try { decoded = decodeURIComponent((urlPath || '/').split('?')[0]); } catch (_) { return null; }
  if (decoded === '/') decoded = '/index.html';
  const rel = decoded.replace(/^[/\\]+/, '');
  const file = path.resolve(root, rel);
  return file === root || file.startsWith(root + path.sep) ? file : null;
}

function createLanServer(options) {
  options = options || {};
  const root = path.resolve(options.root || ROOT);
  const rooms = options.rooms || new RoomManager(options.roomOptions);
  const server = http.createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' }); return res.end('Method not allowed');
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, service: 'burning-chariot', rooms: rooms.rooms.size }));
    }
    const file = safeFile(req.url, root);
    if (!file) { res.writeHead(400); return res.end('Bad request'); }
    fs.stat(file, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        // HTML/JS/CSS/JSON 没有内容哈希，局域网发行版升级后必须重新验证，
        // 否则旧客户端脚本可能与新服务端协议混用五分钟。
        'cache-control': /\.(?:html|js|css|json)$/i.test(file) ? 'no-cache' : 'public, max-age=300'
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== '/ws') return socket.destroy();
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', socket => {
    sendJson(socket, { type: 'CONNECTED', protocol: 1 });
    socket.on('message', data => {
      if (data.length > MAX_MESSAGE_BYTES) return socket.close(1009, 'Message too large');
      let message;
      try { message = JSON.parse(data.toString()); }
      catch (_) { return sendJson(socket, { type: 'ERROR', code: 'BAD_JSON', message: '消息不是合法 JSON' }); }
      rooms.handle(socket, message);
    });
    socket.on('close', () => rooms.disconnect(socket));
    socket.on('error', () => {});
  });

  const cleanupTimer = setInterval(() => rooms.cleanup(), 60 * 1000);
  if (cleanupTimer.unref) cleanupTimer.unref();
  server.on('close', () => clearInterval(cleanupTimer));
  server.on('error', err => {
    if (options.onError) options.onError(err);
  });
  return { server, wss, rooms, root };
}

function sendJson(socket, value) {
  if (socket.readyState === 1) socket.send(JSON.stringify(value));
}

function printBanner(port) {
  const addresses = lanAddresses();
  console.log('============================================');
  console.log('       Burning Chariot LAN Server');
  console.log('============================================\n');
  console.log('本机访问：\nhttp://localhost:' + port + '\n');
  if (addresses.length) {
    console.log('局域网访问：');
    addresses.forEach(address => console.log('http://' + address + ':' + port));
  } else {
    console.log('未检测到可用的局域网 IPv4 地址。');
  }
  console.log('\n服务器运行中... 按 Ctrl+C 停止服务器');
  console.log('============================================');
}

if (require.main === module) {
  const app = createLanServer({
    onError(err) {
      if (err.code === 'EADDRINUSE') {
        console.error('\n端口 ' + DEFAULT_PORT + ' 已被占用。\n可能已经启动了 Burning Chariot。\n请访问：\nhttp://localhost:' + DEFAULT_PORT);
        process.exitCode = 2;
      } else {
        console.error('服务器启动失败：' + err.message);
        process.exitCode = 1;
      }
    }
  });
  app.server.listen(DEFAULT_PORT, DEFAULT_HOST, () => printBanner(DEFAULT_PORT));
}

module.exports = { createLanServer, lanAddresses, safeFile, DEFAULT_PORT, DEFAULT_HOST };
