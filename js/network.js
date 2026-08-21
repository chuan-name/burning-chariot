/* 燃烧战车 — 浏览器端局域网通信。只管连接、房间与协议，不实现游戏规则。 */
(function (RZ) {
  'use strict';

  var MAX_VOLATILE_BUFFER = 16 * 1024;

  function wsUrl() {
    if (location.protocol === 'file:') return '';
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  }

  function LanClient() {
    this.socket = null;
    this.state = 'idle';
    this.roomId = '';
    this.playerId = 0;
    this.reconnectToken = '';
    this.handlers = [];
    this.closedByUser = false;
    this.reconnectTimer = 0;
    this.reconnectAttempts = 0;
    this.connectPromise = null;
  }

  LanClient.prototype.onMessage = function (fn) { this.handlers.push(fn); return this; };
  LanClient.prototype.emit = function (message) {
    for (var i = 0; i < this.handlers.length; i++) this.handlers[i](message);
  };

  LanClient.prototype.connect = function () {
    var self = this;
    if (this.socket && this.socket.readyState === 1) return Promise.resolve();
    if (this.socket && this.socket.readyState === 0 && this.connectPromise) return this.connectPromise;
    var url = wsUrl();
    if (!url) return Promise.reject(new Error('请通过 start-lan.bat 或 BurningChariot.exe 打开局域网模式'));
    this.closedByUser = false;
    this.state = 'connecting'; this.emit({ type: 'NETWORK_STATUS', state: this.state });
    this.connectPromise = new Promise(function (resolve, reject) {
      var settled = false;
      var socket;
      try { socket = new WebSocket(url); } catch (err) { reject(err); return; }
      self.socket = socket;
      socket.onopen = function () {
        self.state = 'connected'; self.reconnectAttempts = 0;
        self.emit({ type: 'NETWORK_STATUS', state: self.state });
        if (!settled) { settled = true; resolve(); }
      };
      socket.onmessage = function (event) {
        var message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (message.type === 'ROOM_CREATED' || message.type === 'ROOM_JOINED' || message.type === 'RECONNECTED') {
          self.roomId = message.roomId; self.playerId = message.playerId;
          self.reconnectToken = message.reconnectToken || self.reconnectToken;
        }
        self.emit(message);
      };
      socket.onerror = function () {
        if (!settled) { settled = true; reject(new Error('无法连接局域网服务器')); }
      };
      socket.onclose = function () {
        self.socket = null; self.connectPromise = null; self.state = 'disconnected';
        self.emit({ type: 'NETWORK_STATUS', state: self.state });
        if (!settled) { settled = true; reject(new Error('与服务器连接断开')); }
        if (!self.closedByUser && self.roomId && self.reconnectToken) self.scheduleReconnect();
      };
    });
    return this.connectPromise;
  };

  LanClient.prototype.scheduleReconnect = function () {
    var self = this;
    if (this.reconnectTimer || this.reconnectAttempts >= 4) return;
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(function () {
      self.reconnectTimer = 0;
      self.connect().then(function () {
        self.send({ type: 'RECONNECT', roomId: self.roomId, reconnectToken: self.reconnectToken });
      }).catch(function () { self.scheduleReconnect(); });
    }, Math.min(5000, 700 * this.reconnectAttempts));
  };

  LanClient.prototype.send = function (message) {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify(message)); return true;
  };
  LanClient.prototype.canSendVolatile = function () {
    return !!this.socket && this.socket.readyState === 1 && this.socket.bufferedAmount <= MAX_VOLATILE_BUFFER;
  };
  LanClient.prototype.sendVolatile = function (message) {
    if (!this.canSendVolatile()) return false;
    return this.send(message);
  };
  LanClient.prototype.createRoom = function () { return this.send({ type: 'CREATE_ROOM' }); };
  LanClient.prototype.joinRoom = function (roomId) { return this.send({ type: 'JOIN_ROOM', roomId: roomId }); };
  LanClient.prototype.sendLobby = function (vehicleId, ready) {
    return this.send({ type: 'LOBBY', vehicleId: vehicleId, ready: !!ready });
  };
  LanClient.prototype.sendAction = function (action) {
    action = action || {}; action.type = 'ACTION'; return this.send(action);
  };
  LanClient.prototype.leave = function () {
    if (this.socket && this.socket.readyState === 1) this.send({ type: 'LEAVE_ROOM' });
    this.roomId = ''; this.playerId = 0; this.reconnectToken = '';
  };
  LanClient.prototype.close = function () {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = 0;
    if (this.socket) this.socket.close();
    this.socket = null; this.connectPromise = null; this.state = 'idle';
  };

  RZ.LanClient = LanClient;
  RZ.lanWebSocketUrl = wsUrl;
})(window.RZ || (window.RZ = {}));
