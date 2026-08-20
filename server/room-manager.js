'use strict';

const crypto = require('crypto');

const ROOM_TTL = 30 * 60 * 1000;
const RECONNECT_GRACE = 20 * 1000;
const MAX_VOLATILE_BUFFER = 64 * 1024;
const ACTIONS = new Set([
  'MOVE', 'SET_ANGLE', 'SELECT_WEAPON', 'FIRE', 'USE_ITEM', 'END_TURN', 'READY', 'SELECT_VEHICLE'
]);

// Node 14.18 才原生支持 Buffer 的 base64url 编码。Windows 7 发行版使用
// Node 12 运行时，因此在这里显式转换，生成结果与标准 base64url 相同。
function base64Url(bytes) {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomRoomId() {
  // 避免依赖较新版本的 crypto.randomInt，同时仍使用密码学随机源。
  return String(100000 + (crypto.randomBytes(4).readUInt32BE(0) % 900000));
}

function cleanRoomId(value) {
  const id = String(value || '').trim();
  return /^\d{6}$/.test(id) ? id : '';
}

function send(socket, message, volatile) {
  if (!socket || socket.readyState !== 1) return false;
  if (volatile && socket.bufferedAmount > MAX_VOLATILE_BUFFER) return false;
  socket.send(JSON.stringify(message));
  return true;
}

class RoomManager {
  constructor(options) {
    options = options || {};
    this.rooms = new Map();
    this.clients = new Map();
    this.roomTtl = options.roomTtl || ROOM_TTL;
    this.reconnectGrace = options.reconnectGrace || RECONNECT_GRACE;
    this.now = options.now || Date.now;
  }

  create(socket) {
    this.leave(socket, 'switch_room');
    let roomId;
    do roomId = randomRoomId(); while (this.rooms.has(roomId));
    const room = {
      id: roomId,
      createdAt: this.now(),
      touchedAt: this.now(),
      players: new Map(),
      currentPlayerId: null,
      started: false
    };
    const player = this._makePlayer(socket, 1);
    room.players.set(1, player);
    this.rooms.set(roomId, room);
    this.clients.set(socket, { roomId, playerId: 1, token: player.token });
    send(socket, { type: 'ROOM_CREATED', roomId, playerId: 1, reconnectToken: player.token });
    return room;
  }

  join(socket, rawRoomId) {
    const roomId = cleanRoomId(rawRoomId);
    const room = roomId && this.rooms.get(roomId);
    if (!room) return this.error(socket, 'ROOM_NOT_FOUND', '房间不存在');
    // 断线宽限期内席位仍属于原玩家，只能凭 token 重连，不能被新连接抢占。
    if (room.players.has(2)) {
      return this.error(socket, 'ROOM_FULL', '房间已满');
    }
    this.leave(socket, 'switch_room');
    const player = this._makePlayer(socket, 2);
    room.players.set(2, player);
    room.touchedAt = this.now();
    this.clients.set(socket, { roomId, playerId: 2, token: player.token });
    send(socket, { type: 'ROOM_JOINED', roomId, playerId: 2, reconnectToken: player.token });
    this.broadcast(room, { type: 'PLAYER_JOINED', roomId, playerId: 2 }, 2);
    return room;
  }

  reconnect(socket, rawRoomId, token) {
    const roomId = cleanRoomId(rawRoomId);
    const room = roomId && this.rooms.get(roomId);
    if (!room) return this.error(socket, 'ROOM_NOT_FOUND', '房间不存在');
    let found = null;
    for (const player of room.players.values()) {
      if (player.token === token && (!player.connected || player.socket === socket)) found = player;
    }
    if (!found) return this.error(socket, 'RECONNECT_REJECTED', '重连凭据无效');
    if (found.cleanupTimer) clearTimeout(found.cleanupTimer);
    found.cleanupTimer = null;
    found.socket = socket;
    found.connected = true;
    this.clients.set(socket, { roomId, playerId: found.id, token: found.token });
    room.touchedAt = this.now();
    send(socket, { type: 'RECONNECTED', roomId, playerId: found.id, reconnectToken: found.token });
    this.broadcast(room, { type: 'PLAYER_RECONNECTED', playerId: found.id }, found.id);
    return room;
  }

  handle(socket, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return this.error(socket, 'BAD_MESSAGE', '消息格式无效');
    }
    switch (message.type) {
      case 'CREATE_ROOM': return this.create(socket);
      case 'JOIN_ROOM': return this.join(socket, message.roomId);
      case 'RECONNECT': return this.reconnect(socket, message.roomId, message.reconnectToken);
      case 'LEAVE_ROOM': this.leave(socket, 'left'); return;
      case 'PING': send(socket, { type: 'PONG', at: this.now() }); return;
    }

    const membership = this.clients.get(socket);
    if (!membership) return this.error(socket, 'NOT_IN_ROOM', '尚未加入房间');
    const room = this.rooms.get(membership.roomId);
    if (!room) return this.error(socket, 'ROOM_CLOSED', '房间已关闭');
    room.touchedAt = this.now();

    if (message.type === 'ACTION') return this._relayAction(socket, room, membership, message);
    if (message.type === 'HOST_STATE' || message.type === 'STATE_SNAPSHOT' || message.type === 'GAME_EVENT') {
      if (membership.playerId !== 1) return this.error(socket, 'HOST_ONLY', '仅房主可同步权威状态');
      if (message.type === 'HOST_STATE' && (message.currentPlayerId === 1 || message.currentPlayerId === 2)) {
        room.currentPlayerId = message.currentPlayerId;
        room.started = !!message.started;
      }
      return this.broadcast(room, Object.assign({}, message, { playerId: 1 }), 1);
    }
    if (message.type === 'LOBBY') {
      const safe = {
        type: 'LOBBY', playerId: membership.playerId,
        vehicleId: typeof message.vehicleId === 'string' ? message.vehicleId.slice(0, 32) : '',
        ready: !!message.ready
      };
      return this.broadcast(room, safe, membership.playerId);
    }
    return this.error(socket, 'UNKNOWN_MESSAGE', '未知消息类型');
  }

  _relayAction(socket, room, membership, message) {
    const action = String(message.action || '');
    if (!ACTIONS.has(action)) return this.error(socket, 'INVALID_ACTION', '不支持的操作');
    if (membership.playerId === 2 && room.started && room.currentPlayerId !== 2) {
      return this.error(socket, 'NOT_YOUR_TURN', '当前不是你的回合');
    }
    const safe = { type: 'ACTION', action, playerId: membership.playerId };
    if (action === 'MOVE') safe.direction = message.direction === 'left' ? 'left' : message.direction === 'right' ? 'right' : '';
    if (action === 'SET_ANGLE') safe.value = Number(message.value);
    if (action === 'SELECT_WEAPON') safe.weapon = Number(message.weapon);
    if (action === 'FIRE') {
      safe.angle = Number(message.angle);
      safe.power = Number(message.power);
      safe.weapon = Number(message.weapon);
    }
    if (action === 'USE_ITEM') safe.itemIndex = Number(message.itemIndex);
    if (action === 'SELECT_VEHICLE') safe.vehicleId = String(message.vehicleId || '').slice(0, 32);
    if (action === 'READY') safe.ready = !!message.ready;
    if (!this._validAction(safe)) return this.error(socket, 'INVALID_ACTION', '操作参数无效');
    this.broadcast(room, safe, membership.playerId);
  }

  _validAction(message) {
    if (message.action === 'MOVE') return message.direction === 'left' || message.direction === 'right';
    if (message.action === 'SET_ANGLE') return Number.isFinite(message.value) && message.value >= -25 && message.value <= 90;
    if (message.action === 'SELECT_WEAPON') return Number.isInteger(message.weapon) && message.weapon >= 0 && message.weapon <= 2;
    if (message.action === 'FIRE') return Number.isFinite(message.angle) && message.angle >= -25 && message.angle <= 90 &&
      Number.isFinite(message.power) && message.power >= 4 && message.power <= 100 &&
      Number.isInteger(message.weapon) && message.weapon >= 0 && message.weapon <= 2;
    if (message.action === 'USE_ITEM') return Number.isInteger(message.itemIndex) && message.itemIndex >= 0 && message.itemIndex < 4;
    if (message.action === 'SELECT_VEHICLE') return /^[a-z0-9_-]{1,32}$/i.test(message.vehicleId);
    return true;
  }

  _makePlayer(socket, id) {
    return { id, socket, token: base64Url(crypto.randomBytes(18)), connected: true, cleanupTimer: null };
  }

  leave(socket, reason) {
    const membership = this.clients.get(socket);
    if (!membership) return;
    this.clients.delete(socket);
    const room = this.rooms.get(membership.roomId);
    if (!room) return;
    const player = room.players.get(membership.playerId);
    if (player && player.socket === socket) room.players.delete(membership.playerId);
    this.broadcast(room, { type: 'PLAYER_LEFT', playerId: membership.playerId, reason: reason || 'left' });
    if (membership.playerId === 1 || room.players.size === 0) this.destroy(room.id, 'host_left');
  }

  disconnect(socket) {
    const membership = this.clients.get(socket);
    if (!membership) return;
    this.clients.delete(socket);
    const room = this.rooms.get(membership.roomId);
    if (!room) return;
    const player = room.players.get(membership.playerId);
    if (!player || player.socket !== socket) return;
    player.connected = false;
    this.broadcast(room, { type: 'PLAYER_DISCONNECTED', playerId: player.id }, player.id);
    player.cleanupTimer = setTimeout(() => {
      if (!player.connected) {
        room.players.delete(player.id);
        this.broadcast(room, { type: 'PLAYER_LEFT', playerId: player.id, reason: 'timeout' });
        if (player.id === 1 || room.players.size === 0) this.destroy(room.id, 'disconnect_timeout');
      }
    }, this.reconnectGrace);
    if (player.cleanupTimer.unref) player.cleanupTimer.unref();
  }

  destroy(roomId, reason) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.rooms.delete(roomId);
    for (const player of room.players.values()) {
      if (player.cleanupTimer) clearTimeout(player.cleanupTimer);
      if (player.socket) {
        this.clients.delete(player.socket);
        send(player.socket, { type: 'ROOM_CLOSED', reason: reason || 'closed' });
      }
    }
  }

  cleanup() {
    const cutoff = this.now() - this.roomTtl;
    for (const room of this.rooms.values()) if (room.touchedAt < cutoff) this.destroy(room.id, 'expired');
  }

  broadcast(room, message, exceptPlayerId) {
    let sent = 0;
    const volatile = message && message.type === 'GAME_EVENT' && message.event === 'STATE_DELTA';
    for (const player of room.players.values()) {
      if (player.id !== exceptPlayerId && player.connected && send(player.socket, message, volatile)) sent++;
    }
    return sent;
  }

  error(socket, code, message) {
    send(socket, { type: 'ERROR', code, message });
    return null;
  }
}

module.exports = { RoomManager, cleanRoomId, ACTIONS, base64Url, randomRoomId };
