/* 燃烧战车 — 对战核心：回合、延迟出手顺序、伤害结算、镜头 */
(function (RZ) {
  'use strict';

  var TURN_TIME = 30;          // 每回合秒数
  var PASS_DELAY = 480;        // 超时未开火的延迟惩罚
  var FALL_SAFE = 130;         // 安全落差
  var CHARGE_RATE = 0.8;       // 每帧蓄力增幅：满条约 2 秒，留出微调余地
  var HALF_W = 8;              // 落脚检测的车身半宽：太宽会让车悬在凸坡上方
  var MAX_WIND_STEP = 0.3;     // 单回合风力最多变动 windMax 的三成

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ================= 战车实例 =================
  function Unit(cfg, index) {
    var v = cfg.vehicle;
    this.index = index;
    this.vehicle = v;
    this.name = cfg.name;
    this.team = cfg.team;
    this.ai = !!cfg.ai;
    this.playerId = cfg.playerId == null ? null : cfg.playerId;
    this.maxHp = v.hp; this.hp = v.hp;
    this.atk = v.atk; this.def = v.def;
    this.maxFuel = RZ.MAX_FUEL; this.fuel = RZ.START_FUEL;
    this.spentThisTurn = 0;      // 本回合总耗油，决定这一手的延迟
    this.moveSpent = 0;          // 其中花在移动上的部分，跑太多要扣回油
    this.dealtThisTurn = 0;      // 本回合打出的伤害，打中人有回油奖励
    this.firedThisTurn = false;
    this.items = (cfg.items || []).slice(0, RZ.MAX_ITEMS);
    this.usedItemFlash = 0;      // 车身上「正在用道具」的提示，不暴露用的是哪个
    // 增益：本回合限定的用完即清，带回合数的按「自己的回合」递减
    this.buffDouble = false;     // 双倍攻击：这一发打两枚
    this.buffPower = 0;          // 加强攻击：剩余回合数，开火时消耗
    this.shotMode = null;        // 'fly' | 'stun'：这一发换成道具炮弹
    this.stunned = 0;            // 麻痹：剩余回合数，动不了
    this.stealth = 0;            // 隐身：剩余回合数
    this.noFire = false;         // 飞行之后本回合不能再开火
    this.climb = v.climb;
    this.x = 0; this.y = 0; this.vy = 0;
    this.face = 1; this.aim = 45; this.power = 0;
    this.lastSeenX = 0; this.lastSeenY = 0;   // 隐身前最后被看到的位置
    this.lastPower = 0;          // 上一发用的力度，作为蓄力条上的参考刻度
    this.weaponIdx = 0;
    this.delay = 0;              // 上一次出手的延迟值，只用来排下一轮的先后
    // 位次用负的 index 起头：开局第一轮仍按出场顺序，之后才轮到「上轮靠后者先动」
    this.roundPos = -index;      // 本轮的出手位次
    this.lastPos = -index;       // 上一轮的位次，用来打破平局
    this.alive = true;
    this.airborne = false; this.fallFrom = 0;
    this.dots = [];
    this.hitFlash = 0; this.muzzleFlash = 0;
  }

  Unit.prototype.weapon = function () {
    var v = this.vehicle;
    return this.weaponIdx === 0 ? v.w1 : this.weaponIdx === 1 ? v.w2 : v.ss;
  };
  /** 燃料够不够开这一炮 */
  Unit.prototype.canAfford = function (weapon) { return this.fuel >= weapon.fuel; };

  // ================= 对局 =================
  function Game(opts) {
    this.opts = opts;
    this.map = RZ.mapById(opts.mapId);
    this.terrain = new RZ.Terrain(this.map);
    this.bg = new RZ.Background(this.map);
    this.fx = new RZ.Particles();
    this.night = opts.night != null ? opts.night : Math.random() * 0.85;
    this.guide = !!opts.guide;
    this.log = [];

    this.units = [];
    var i;
    for (i = 0; i < opts.roster.length; i++) this.units.push(new Unit(opts.roster[i], i));

    var pts = this.terrain.spawnPoints(this.units.length);
    // 让同队战车不要挤在一起：红队占奇数位，蓝队占偶数位
    var order = pts.map(function (p, idx) { return idx; });
    for (i = 0; i < this.units.length; i++) {
      var p = pts[order[i]];
      this.units[i].x = p.x;
      this.units[i].y = Math.min(p.y, RZ.WORLD_H - 20);
      this.units[i].face = p.x < RZ.WORLD_W / 2 ? 1 : -1;
      this.units[i].lastSeenX = this.units[i].x;
      this.units[i].lastSeenY = this.units[i].y;
    }

    this.projectiles = [];
    this.pendingSpawn = [];
    this.effects = [];
    this.supplies = [];
    this.wind = Math.round((Math.random() - 0.5) * this.map.windMax * 0.8);
    this.turnNo = 0;
    this.round = 0;
    this.roundQueue = [];
    this.phase = 'aim';
    this.settleTimer = 0;
    this.timeLeft = TURN_TIME;
    this.lastTick = -1;
    this.charging = false;
    this.timedOut = false;
    this.repeatShot = null;
    this.flyBack = false;
    this.turnsSinceDamage = 0;   // 连续多少回合没人掉血，用来识别僵局
    this.result = null;
    this.messages = [];
    this.t = 0;
    this.networkVersion = 0;
    this.networkDirty = 'full';
    this.networkEvent = typeof opts.networkEvent === 'function' ? opts.networkEvent : null;

    this.viewW = 1100; this.viewH = 620;   // draw() 每帧会覆盖成真实视口
    this.cam = { x: 0, y: 0, tx: 0, ty: 0, shake: 0 };
    this.active = null;
    this.aiPlan = null;
    this.aiTimer = 0;

    this.beginTurn(true);
  }

  Game.prototype.aliveOf = function (team) {
    return this.units.filter(function (u) { return u.alive && u.team === team; });
  };

  /** 本轮（或下一轮）的出手顺序：延迟小的先动，平局时上一轮排在后面的优先 */
  function orderBy(list) {
    return list.slice().sort(function (a, b) {
      return (a.delay - b.delay) || (b.lastPos - a.lastPos) || (a.index - b.index);
    });
  }

  Game.prototype.turnOrder = function () {
    return orderBy(this.units.filter(function (u) { return u.alive; }));
  };

  /**
   * 开新一轮。这是全局的核心规则：**每一轮里每辆车都恰好出手一次**，
   * 延迟只决定这一轮内部的先后，不会让谁整轮消失。
   * 所以同一辆车最多连着出手两次（上一轮压轴 + 下一轮打头），不可能三次。
   */
  Game.prototype.startRound = function () {
    var i, alive = [];
    for (i = 0; i < this.units.length; i++) {
      this.units[i].lastPos = this.units[i].roundPos;
      if (this.units[i].alive) alive.push(this.units[i]);
    }
    var ordered = orderBy(alive);
    for (i = 0; i < ordered.length; i++) ordered[i].roundPos = i;
    this.round++;
    this.roundQueue = ordered;
  };

  /**
   * 下方面板该显示哪辆车。轮到玩家自己时就是当前战车；轮到电脑（或 2v2 里的
   * 电脑队友）时退回玩家自己的车——否则角度、力度、选中的武器全被提前看光。
   * 同屏双人时行动的那位就坐在键盘前，照常显示当前战车。
   */
  Game.prototype.viewUnit = function () {
    var a = this.active, i;
    if (this.opts.localPlayerId != null) {
      for (i = 0; i < this.units.length; i++) if (this.units[i].playerId === this.opts.localPlayerId) return this.units[i];
      return null;
    }
    if (a && !a.ai) return a;
    for (i = 0; i < this.units.length; i++) {
      if (!this.units[i].ai && this.units[i].alive) return this.units[i];
    }
    for (i = 0; i < this.units.length; i++) {          // 自己的车已被击破
      if (!this.units[i].ai) return this.units[i];
    }
    return null;
  };

  /**
   * 下方面板该显示的一组读数。刻意做成与 DOM 无关的纯函数：
   * 「不是自己的回合就不能显示对方的力度/角度/武器」这条规则要能被直接测到。
   */
  Game.prototype.hudState = function () {
    var view = this.viewUnit();
    var live = !!view && view === this.active;
    if (!view) return { unit: null, live: false };
    return {
      unit: view,
      live: live,
      name: view.name,
      tag: live ? (this.opts.humanTeam == null ? RZ.TEAM_NAMES[view.team] : '你的战车') : '待命中',
      hp: Math.max(0, Math.round(view.hp)),
      hpPct: Math.max(0, view.hp / view.maxHp * 100),
      fuel: Math.round(view.fuel),
      fuelPct: view.fuel / view.maxFuel * 100,
      maxFuel: view.maxFuel,
      spent: Math.round(view.spentThisTurn),
      aim: Math.round(view.aim),
      power: live ? Math.round(view.power) : 0,     // 别人的蓄力不给看
      lastPower: view.lastPower,
      weaponIdx: view.weaponIdx,
      weaponFuel: view.weapon().fuel,
      canSS: view.canAfford(view.vehicle.ss)
    };
  };

  /** 界面替谁在看：单人是玩家那一队，同屏双人就是当前行动的那一队 */
  Game.prototype.viewerTeam = function () {
    if (this.opts.humanTeam != null) return this.opts.humanTeam;
    return this.active ? this.active.team : 0;
  };

  /** 这辆车对某一队是不是隐身的 */
  Game.prototype.hiddenFrom = function (team, u) {
    return u.stealth > 0 && u.team !== team;
  };

  /**
   * 某一队「以为」这辆车在哪。隐身期间只知道它消失前的位置——
   * 电脑也用这个函数瞄准，不许偷看真坐标。
   */
  Game.prototype.knownPos = function (team, u) {
    if (this.hiddenFrom(team, u)) return { x: u.lastSeenX, y: u.lastSeenY };
    return { x: u.x, y: u.y };
  };

  Game.prototype.say = function (text, color) {
    this.messages.push({ text: text, color: color || '#ffe6a8', life: 150 });
    if (this.messages.length > 4) this.messages.shift();
  };

  /** 取出本轮下一个还活着的；本轮打完就开新一轮 */
  Game.prototype.nextInRound = function () {
    for (var guard = 0; guard < 2; guard++) {
      while (this.roundQueue && this.roundQueue.length) {
        var cand = this.roundQueue.shift();
        if (cand.alive) return cand;
      }
      this.startRound();
    }
    return null;
  };

  // ---- 回合开始 ----
  Game.prototype.beginTurn = function (first) {
    if (this.result !== null) return;
    var u = this.nextInRound();
    if (!u) return;

    this.active = u;
    this.turnNo++;
    this.turnsSinceDamage++;
    u.power = 0;
    u.spentThisTurn = 0;
    u.moveSpent = 0;
    u.firedThisTurn = false;
    u.dealtThisTurn = 0;
    u.noFire = false;
    u.buffDouble = false;        // 双倍只在用它的那个回合有效
    u.shotMode = null;
    if (!u.canAfford(u.weapon())) u.weaponIdx = 0;   // 油不够就退回一号武器
    this.charging = false;
    this.phase = 'aim';
    this.timeLeft = TURN_TIME;
    this.aiPlan = null;
    this.aiTimer = 24;

    if (!first) this.stepWind();      // 开局那阵风用构造时定的，不再多走一步

    this.applyDots(u);
    if (u.alive && !u.ai && !u.canAfford(u.vehicle.w1)) {
      this.say('燃料不足，按 Enter 跳过本回合攒油', '#ffb4b4');
    }
    if (!first) RZ.SFX.turn();
    if (this.turnNo % 4 === 0) this.dropSupply();
    this.checkWin();
    this.markNetwork('full');
  };

  /**
   * 风向按回合演化，两条原则：
   *   1. 单回合变化幅度有上限，不会从 +10 一步跳到 -1；
   *   2. 越靠近 ±windMax，往回拉的力越强（三次方），所以极端风撑不了几个回合。
   * 结果是风大部分时间在中段游走，偶尔摸一下边就被拽回来。
   */
  Game.prototype.stepWind = function () {
    var wm = this.map.windMax;
    if (!wm) { this.wind = 0; return; }
    var t = this.wind / wm;                                  // -1 ~ 1，极端程度
    var pull = -(t * t * t) * wm * 0.60;                     // 越极端回拉越猛
    var drift = (Math.random() * 2 - 1) * wm * 0.32;         // 小幅随机游走
    var step = wm * MAX_WIND_STEP;
    this.wind = Math.round(clamp(this.wind + clamp(pull + drift, -step, step), -wm, wm));
  };

  Game.prototype.applyDots = function (u) {
    if (!u.alive || !u.dots.length) return;
    var total = 0, kinds = {};
    for (var i = u.dots.length - 1; i >= 0; i--) {
      var d = u.dots[i];
      total += d.damage;
      kinds[d.type] = true;
      d.turns--;
      if (d.turns <= 0) u.dots.splice(i, 1);
    }
    if (total > 0) {
      this.damage(u, total, null, kinds.poison ? '#9cff5a' : '#ff7b3d');
      this.fx.burst(u.x, u.y - 16, 22, kinds.poison ? ['#9cff5a', '#4bbf2f'] : ['#ff9a3d', '#ffd166']);
    }
  };

  // ---- 结束回合 ----
  Game.prototype.endTurn = function () {
    if (this.result !== null) return;
    var u = this.active;
    if (u) {
      u.delay = this.timedOut ? PASS_DELAY : this.delayFor(u);   // 决定下一轮的位次
      u.buffDouble = false;
      u.shotMode = null;
      // 按回合计的状态在「自己这一回合结束时」才递减。放在回合开始会少算一回合：
      // 挂 3 回合的麻痹，实际只能困住对方 2 个回合。
      if (u.buffPower > 0) u.buffPower--;
      if (u.stunned > 0) u.stunned--;
      if (u.stealth > 0) {
        u.stealth--;
        if (u.stealth === 0) this.say(u.name + ' 的隐身失效了', '#9fb3c8');
      }
      this.refuel(u);
    }
    this.timedOut = false;
    this.checkWin();
    if (this.result === null) this.beginTurn(false);
    this.markNetwork('full');
  };

  Game.prototype.checkWin = function () {
    if (this.result !== null) return;
    var red = this.aliveOf(0).length, blue = this.aliveOf(1).length;
    if (red && blue) return;
    this.result = red ? 0 : blue ? 1 : -1;
    this.phase = 'over';
    var human = this.opts.humanTeam;
    if (human == null) RZ.SFX.win();
    else if (this.result === human) RZ.SFX.win();
    else RZ.SFX.lose();
    this.markNetwork('full');
    this.emitNetwork('RESULT', { result: this.result });
  };

  // ---- 燃料经济 ----
  // 燃料是唯一的资源：开炮、移动都从这一条槽里扣，扣得越多这一手的延迟越长，
  // 回合结束再按「省着用 / 打中人 / 少乱跑」结算回油。
  Game.prototype.delayFor = function (u, extraFuel) {
    var d = RZ.DELAY_BASE + (u.spentThisTurn + (extraFuel || 0)) * RZ.DELAY_PER_FUEL;
    return Math.round(d);
  };

  Game.prototype.refuel = function (u) {
    var v = u.vehicle;
    var thrift = Math.max(0, (20 - u.spentThisTurn) * 0.3);   // 这回合省着用
    var battle = Math.min(6, u.dealtThisTurn * 0.03);         // 打中了人
    var roam = Math.min(10, u.moveSpent * 0.3);               // 满地图乱跑
    var gain = Math.max(8, Math.round(v.regen + thrift + battle - roam));
    var before = u.fuel;
    u.fuel = Math.min(u.maxFuel, u.fuel + gain);
    if (u.alive && u.fuel > before) {
      this.fx.text(u.x, u.y - 92, '+' + Math.round(u.fuel - before) + ' 油', '#ffd166');
    }
    return gain;
  };

  /** 扣油，顺便记账 */
  Game.prototype.spend = function (u, amount, kind) {
    u.fuel = Math.max(0, u.fuel - amount);
    u.spentThisTurn += amount;
    if (kind === 'move') u.moveSpent += amount;
  };

  // ---- 道具 ----
  /** 道具只能在自己回合、开炮之前用；飞行之后回合还没结束，也还能用 */
  Game.prototype.canUseItems = function (u) {
    return this.result === null && this.phase === 'aim' && u === this.active;
  };

  Game.prototype.useItem = function (index) {
    var u = this.active;
    if (!u || !this.canUseItems(u)) return false;
    var id = u.items[index];
    var def = id && RZ.itemById(id);
    if (!def) return false;
    if (def.kind === 'shot' && u.noFire) { this.say('这回合已经不能再开火了'); return false; }
    if (def.kind === 'shot' && u.shotMode) { this.say('这一发已经换过炮弹了'); return false; }

    u.items.splice(index, 1);
    u.usedItemFlash = 70;          // 车身上只说「在用道具」，不说用的是哪个
    this.applyItem(u, def);
    RZ.SFX.pickup();
    if (def.endsTurn) this.passTurn();
    this.markNetwork('light');
    return true;
  };

  Game.prototype.applyItem = function (u, def) {
    switch (def.id) {
      case 'double': u.buffDouble = true; break;
      case 'power': u.buffPower = 3; break;
      case 'fly': u.shotMode = 'fly'; break;
      case 'stun': u.shotMode = 'stun'; break;
      case 'heal1': this.heal(u, u.maxHp * 0.25); break;
      case 'heal2': this.heal(u, u.maxHp * 0.5); break;
      case 'fuel1': this.refill(u, u.maxFuel * 0.2); break;
      case 'fuel2': this.refill(u, u.maxFuel * 0.4); break;
      case 'stealth': u.stealth = 3; break;
    }
  };

  Game.prototype.heal = function (u, amount) {
    var before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + amount);
    this.fx.text(u.x, u.y - 84, '+' + Math.round(u.hp - before), '#5ad27a');
  };

  Game.prototype.refill = function (u, amount) {
    var before = u.fuel;
    u.fuel = Math.min(u.maxFuel, u.fuel + amount);
    this.fx.text(u.x, u.y - 84, '+' + Math.round(u.fuel - before) + ' 油', '#ffd166');
  };

  // ---- 开火 ----
  /** 真正把一组炮弹推出去；mul 是这一发的伤害倍率（加强攻击） */
  Game.prototype.launchVolley = function (u, w, power, mul) {
    var shots = RZ.launch(u, w, u.aim, power, this.map.gravity);
    for (var i = 0; i < shots.length; i++) {
      shots[i].dmgMul = mul || 1;
      this.projectiles.push(shots[i]);
    }
    u.muzzleFlash = 8;
    this.cam.shake = Math.max(this.cam.shake, 4);
    RZ.SFX.fire();
  };

  Game.prototype.fire = function () {
    var u = this.active;
    if (!u || this.phase !== 'aim') return;
    if (u.noFire) { this.say('飞行之后这一回合不能再开火'); this.charging = false; RZ.SFX.stopCharge(); return; }

    // 道具会把这一发换成定位炮 / 麻痹弹，不管你选的是哪把武器
    var mode = u.shotMode;
    var w = mode === 'fly' ? RZ.LOCATOR : mode === 'stun' ? RZ.STUN_SHELL : u.weapon();
    if (!u.canAfford(w)) {
      this.say('燃料不足，打不出 ' + w.name);
      this.charging = false;
      RZ.SFX.stopCharge();
      return;
    }
    this.spend(u, w.fuel, 'weapon');
    u.firedThisTurn = true;
    var power = Math.max(4, u.power);
    u.lastPower = Math.round(power);      // 下一回合的蓄力参考刻度

    // 加强攻击：这一发 +50%，对必杀也算；定位炮不打伤害，就不消耗它
    var mul = 1;
    if (u.buffPower > 0 && w.damage > 0) { mul = 1.5; u.buffPower = 0; }

    // 双倍攻击：普通武器连打两发（必杀和道具弹除外）
    var twice = u.buffDouble && !mode && u.weaponIdx !== 2;
    u.buffDouble = false;

    this.launchVolley(u, w, power, mul);
    this.repeatShot = twice ? { u: u, w: w, power: power, mul: mul, left: 1, wait: 0 } : null;
    this.flyBack = mode === 'fly';        // 定位炮落地后回到瞄准状态，不结束回合
    this.phase = 'fly';
    this.charging = false;
    RZ.SFX.stopCharge();
    if (!mode && u.weaponIdx === 2) this.say(u.name + ' 发动必杀 ' + w.name + '！', '#ffd166');
    this.markNetwork('light');
    this.emitNetwork('FIRE', { playerId: u.playerId, unitIndex: u.index, angle: u.aim, power: power, weapon: u.weaponIdx });
  };

  /** 放弃出手，按已花掉的油结算延迟 */
  Game.prototype.passTurn = function () {
    if (this.phase !== 'aim' || this.result !== null) return;
    this.charging = false;
    RZ.SFX.stopCharge();
    this.phase = 'settle';
    this.settleTimer = 12;
    this.markNetwork('light');
  };

  // ---- 爆炸 ----
  Game.prototype.explode = function (x, y, w, attacker, directTarget, dmgMul) {
    if (w.locator) { this.teleport(attacker, x, y); return; }   // 定位炮：不炸，人过去
    var radius = w.radius;
    var damage = w.damage * (dmgMul || 1);
    var dig = radius * (w.digMul || 1);
    this.terrain.carve(x, y, dig);
    // 镜像端会立即应用 EXPLOSION；回合结束时的完整快照再做地形校正。
    this.markNetwork('light');
    this.emitNetwork('EXPLOSION', { x: Math.round(x), y: Math.round(y), radius: radius, digRadius: dig });
    var s = w.shell;
    this.fx.burst(x, y, radius, [s.color, s.glow, '#ffffff', s.trail]);
    this.fx.debris(x, y, Math.min(26, radius * 0.35), this.map.ground.body);
    this.cam.shake = Math.max(this.cam.shake, Math.min(16, radius * 0.16));
    RZ.SFX.explode(radius > 64);

    var fake = { damage: damage, radius: radius };
    for (var i = 0; i < this.units.length; i++) {
      var t = this.units[i];
      if (!t.alive) continue;
      var d = Math.hypot(t.x - x, (t.y - 16) - y);
      var dmg = RZ.explosionDamage(fake, attacker, t, d, radius);
      if (dmg <= 0) continue;
      if (t === directTarget) dmg = Math.round(dmg * RZ.DIRECT_BONUS);
      this.damage(t, dmg, attacker, null, t === directTarget);
      if (w.dot) t.dots.push({ type: w.dot.type, turns: w.dot.turns, damage: w.dot.damage });
      if (w.stun && t.team !== (attacker ? attacker.team : -1)) {
        t.stunned = Math.max(t.stunned, w.stun);
        this.fx.text(t.x, t.y - 60, '麻痹', '#b98cff');
      }
      // 击退：小幅弹起，可能把车震下悬崖
      t.vy = Math.min(t.vy, -Math.min(6, dmg * 0.02));
      t.airborne = true;
      if (!t.fallFrom) t.fallFrom = t.y;
    }

    // 补给箱被炸到就归开火方所有
    for (i = this.supplies.length - 1; i >= 0; i--) {
      var sup = this.supplies[i];
      if (Math.hypot(sup.x - x, sup.y - y) < radius + 12) {
        if (this.collect(sup, attacker)) this.supplies.splice(i, 1);
      }
    }

    if (w.onImpact === 'lightning') this.strikeLightning(x, y, w, attacker, damage);
    if (w.onImpact === 'carpet' && w.carpet) this.carpet(x, y, w, attacker, dmgMul);
  };

  Game.prototype.strikeLightning = function (x, y, w, attacker, damage) {
    this.effects.push({ type: 'bolt', x: x, y0: Math.max(0, y - 620), y1: y, life: 16 });
    this.cam.shake = Math.max(this.cam.shake, 12);
    RZ.SFX.thunder();
    for (var i = 0; i < this.units.length; i++) {
      var t = this.units[i];
      if (!t.alive) continue;
      if (Math.abs(t.x - x) > 30) continue;
      if (t.y - 16 > y + 20 || t.y < y - 620) continue;
      var extra = Math.round(damage * 0.32 * (attacker ? attacker.atk / 100 : 1));
      this.damage(t, extra, attacker, '#cfe4ff');
    }
  };

  Game.prototype.carpet = function (x, y, w, attacker, dmgMul) {
    var c = w.carpet;
    var cw = Object.create(w);
    cw.onImpact = null; cw.count = 1; cw.damage = c.damage; cw.radius = c.radius;
    cw.dot = w.dot;
    for (var i = 0; i < c.count; i++) {
      var off = (i - (c.count - 1) / 2) * c.spacing;
      this.projectiles.push({
        x: x + off, y: y - 520 - Math.abs(off) * 0.5 - Math.random() * 60,
        vx: (Math.random() - 0.5) * 0.6, vy: 2 + Math.random(),
        w: cw, owner: attacker, team: attacker ? attacker.team : 0, dmgMul: dmgMul || 1,
        age: 30, alive: true, bounceLeft: 0, pierceLeft: 0, didSplit: true, trail: []
      });
    }
  };

  /** 定位炮落点：把车挪过去，落地交给重力 */
  Game.prototype.teleport = function (u, x, y) {
    if (!u || !u.alive) return;
    this.fx.burst(u.x, u.y - 16, 40, ['#bff6ff', '#2fd0ff', '#ffffff']);
    u.x = clamp(Math.round(x), 14, RZ.WORLD_W - 14);
    u.y = Math.max(0, Math.round(y));
    u.vy = 0;
    u.airborne = true;
    u.fallFrom = u.y;              // 传送不算摔落
    u.noFire = true;               // 飞完这回合不能再开火，但还能继续挪
    this.fx.burst(u.x, u.y - 16, 46, ['#bff6ff', '#2fd0ff', '#ffffff']);
    this.fx.text(u.x, u.y - 84, '飞行', '#2fd0ff');
    RZ.SFX.pickup();
  };

  Game.prototype.damage = function (target, amount, attacker, color, direct) {
    if (!target.alive || amount <= 0) return;
    target.hp -= amount;
    target.hitFlash = 14;
    this.fx.text(target.x, target.y - 76, '-' + amount, color || (direct ? '#fff1a8' : '#ffffff'), direct);
    if (attacker && attacker !== target && attacker.team !== target.team) {
      attacker.dealtThisTurn += amount;      // 打中人，回合结束多回一点油
      this.log.push({ by: attacker.index, dmg: amount });
      this.turnsSinceDamage = 0;
    }
    RZ.SFX.hurt();
    if (target.hp <= 0) this.kill(target);
    this.markNetwork('light');
  };

  Game.prototype.kill = function (u, silent) {
    if (!u.alive) return;
    u.hp = 0; u.alive = false;
    this.fx.burst(u.x, u.y - 18, 84, ['#ffd166', '#ff6a1f', '#ffffff', '#8b2f10']);
    this.fx.debris(u.x, u.y - 12, 26, u.vehicle.pal[0]);
    this.fx.text(u.x, u.y - 90, silent || '击破！', '#ff8a5c', true);
    this.cam.shake = Math.max(this.cam.shake, 12);
    RZ.SFX.ko();
    this.say(u.name + ' 被击破', RZ.TEAM_COLORS[u.team]);
  };

  // ---- 补给 ----
  Game.prototype.dropSupply = function () {
    var def = RZ.ITEMS[(Math.random() * RZ.ITEMS.length) | 0];
    var x = 120 + Math.random() * (RZ.WORLD_W - 240);
    this.supplies.push({ x: x, y: -40, vy: 0, def: def, landed: false });
    this.say('空投了一个道具', def.color);      // 具体是什么，捡到才知道
  };

  Game.prototype.collect = function (sup, u) {
    if (!u || !u.alive) return false;
    if (u.items.length >= RZ.MAX_ITEMS) {         // 道具满了就先放着，回头再来捡
      if (u === this.active) this.say(u.name + ' 道具已满，捡不了', '#ff9a9a');
      return false;
    }
    u.items.push(sup.def.id);
    this.fx.text(u.x, u.y - 84, '+' + sup.def.name, sup.def.color);
    RZ.SFX.pickup();
    this.say(u.name + ' 捡到道具', sup.def.color);
    return true;
  };

  // ---- 移动 / 瞄准 ----
  Game.prototype.moveActive = function (dir) {
    var u = this.active;
    if (!u || this.phase !== 'aim' || u.airborne || u.fuel <= 0) return;
    if (u.stunned > 0) { if ((this.t & 31) === 0) this.say('被麻痹了，动不了'); return; }
    u.face = dir;
    var cost = u.vehicle.moveCost;
    // 还打得出一号武器就给它留着，已经打不出了就随便走——总不能把人钉在原地
    var floor = u.fuel >= u.vehicle.w1.fuel ? u.vehicle.w1.fuel : 0;
    var stepsLeft = 1.7;
    while (stepsLeft > 0 && u.fuel > floor) {
      var nx = clamp(u.x + dir, 12, RZ.WORLD_W - 12);
      if (nx === u.x) break;
      var probe = this.terrain.supportY(nx, HALF_W, u.y - u.climb - 4);
      if (probe >= RZ.WORLD_H + 900) {           // 前面是虚空，走过去会掉下去
        if (u.fuel - cost * 2 < floor) break;
        u.x = nx; u.airborne = true; u.fallFrom = u.y;
        this.spend(u, cost * 2, 'move');
        break;
      }
      var rise = u.y - probe;
      if (rise > u.climb) break;                 // 爬不上去
      var step = rise > 2 ? cost * 1.8 : cost;   // 爬坡更费油
      if (u.fuel - step < floor) break;          // 迈出去就打不出炮了，停在这
      u.x = nx;
      u.y = probe;
      this.spend(u, step, 'move');
      stepsLeft--;
    }
    if ((this.t & 7) === 0) RZ.SFX.move();
    this.markNetwork('light');
  };

  /** 每帧处理「按住不放」的按键；keys 是 {按键名: 布尔} */
  Game.prototype.applyHeld = function (keys) {
    var u = this.active;
    if (!u || u.ai || this.phase !== 'aim' || this.result !== null) return;
    if (keys.ArrowLeft) this.moveActive(-1);
    if (keys.ArrowRight) this.moveActive(1);
    if (keys.ArrowUp) this.adjustAim(1);
    if (keys.ArrowDown) this.adjustAim(-1);
  };

  Game.prototype.adjustAim = function (d) {
    var u = this.active;
    if (!u || this.phase !== 'aim') return;
    u.aim = clamp(u.aim + d, -25, 90);
    this.markNetwork('light');
  };

  Game.prototype.setWeapon = function (idx) {
    var u = this.active;
    if (!u || this.phase !== 'aim') return;
    var w = idx === 0 ? u.vehicle.w1 : idx === 1 ? u.vehicle.w2 : u.vehicle.ss;
    if (!u.canAfford(w)) { this.say('燃料不足：' + w.name + ' 需要 ' + w.fuel); return; }
    u.weaponIdx = idx;
    RZ.SFX.click();
    this.markNetwork('light');
  };

  Game.prototype.startCharge = function () {
    if (!this.active || this.phase !== 'aim' || this.charging) return;
    this.charging = true;
    this.active.power = 0;
    RZ.SFX.startCharge();
  };

  Game.prototype.releaseCharge = function () {
    if (!this.charging) return;
    this.fire();
  };

  /** 放弃这一发蓄力（暂停时玩家松手、切走窗口等） */
  Game.prototype.cancelCharge = function () {
    if (!this.charging) return;
    this.charging = false;
    if (this.active) this.active.power = 0;
    RZ.SFX.stopCharge();
  };

  // ---- 主循环 ----
  Game.prototype.update = function (dtms) {
    this.t += 16;
    var i;
    this.fx.update();
    this.bg.update(this.t);

    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (u.hitFlash > 0) u.hitFlash--;
      if (u.muzzleFlash > 0) u.muzzleFlash--;
      if (u.usedItemFlash > 0) u.usedItemFlash--;
      if (u.stealth <= 0) { u.lastSeenX = u.x; u.lastSeenY = u.y; }
    }

    if (this.result !== null) { this.updateCamera(); return; }

    // 蓄力
    if (this.charging && this.active) {
      this.active.power = Math.min(100, this.active.power + CHARGE_RATE);
      RZ.SFX.updateCharge(this.active.power);
    }

    // 回合倒计时
    if (this.phase === 'aim') {
      this.timeLeft -= dtms / 1000;
      var sec = Math.ceil(this.timeLeft);
      if (sec <= 5 && sec !== this.lastTick && sec > 0) { this.lastTick = sec; RZ.SFX.tick(); }
      if (this.timeLeft <= 0) {
        this.charging = false; RZ.SFX.stopCharge();
        this.say('时间到！', '#ff8a8a');
        this.timedOut = true;
        this.phase = 'settle';
        this.settleTimer = 20;
      }
      if (this.active && this.active.ai) this.updateAI(dtms);
    }

    this.updatePhysics();
    this.updateSupplies();

    for (i = this.effects.length - 1; i >= 0; i--) {
      if (--this.effects[i].life <= 0) this.effects.splice(i, 1);
    }
    for (i = this.messages.length - 1; i >= 0; i--) {
      if (--this.messages[i].life <= 0) this.messages.splice(i, 1);
    }

    // 飞行阶段结束判定
    if (this.phase === 'fly' && this.projectiles.length === 0) {
      var rs = this.repeatShot;
      if (rs && rs.left > 0 && rs.u.alive) {
        // 双倍攻击的第二发：等第一发的坑炸完再打，所以两发会互相影响地形
        if (rs.wait++ === 0) this.say('双倍攻击 · 第二发', '#ff7a3d');
        if (rs.wait > 26) { rs.left--; this.launchVolley(rs.u, rs.w, rs.power, rs.mul); }
      } else if (this.flyBack) {
        this.flyBack = false;
        this.repeatShot = null;
        this.phase = 'aim';                 // 飞行不结束回合，还能接着挪
      } else {
        this.repeatShot = null;
        this.phase = 'settle';
        this.settleTimer = 34;
      }
    }
    if (this.phase === 'settle') {
      var moving = false;
      for (i = 0; i < this.units.length; i++) if (this.units[i].alive && this.units[i].airborne) moving = true;
      if (!moving) this.settleTimer--;
      if (this.settleTimer <= 0 && this.projectiles.length === 0) this.endTurn();
    }

    this.updateCamera();
  };

  Game.prototype.updatePhysics = function () {
    var env = {
      terrain: this.terrain, gravity: this.map.gravity, wind: this.wind,
      units: this.units, recordTrail: true, spawn: this.pendingSpawn,
      dig: (function (g) {
        return function (x0, y0, x1, y1, r) {
          g.terrain.tunnel(x0, y0, x1, y1, r);
          // 镜像端会应用同一条隧道事件，避免飞行中反复导入整张地形。
          g.markNetwork('light');
          g.emitNetwork('TERRAIN_TUNNEL', { x0: x0, y0: y0, x1: x1, y1: y1, radius: r });
        };
      })(this)
    };

    for (var i = this.projectiles.length - 1; i >= 0; i--) {
      var p = this.projectiles[i];
      var ev = RZ.step(p, env);
      if ((p.age & 3) === 0) this.fx.trailPuff(p.x, p.y, p.w.shell.trail);
      if (!ev) continue;
      if (ev.type === 'bounce') { RZ.SFX.bounce(); continue; }
      if (ev.type === 'split') {
        this.fx.burst(ev.x, ev.y, 16, [p.w.shell.color, '#ffffff']);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (ev.type === 'hit') this.explode(ev.x, ev.y, p.w, p.owner, ev.target, p.dmgMul);
      this.projectiles.splice(i, 1);
    }
    while (this.pendingSpawn.length) this.projectiles.push(this.pendingSpawn.pop());

    // 开火方的强化只作用于这一发
    // 战车重力与落地
    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive) continue;
      var support = this.terrain.supportY(u.x, HALF_W, Math.max(0, u.y - 26));
      if (u.airborne || support > u.y + 1.2) {
        if (!u.airborne) { u.airborne = true; u.fallFrom = u.y; u.vy = Math.max(0, u.vy); }
        u.vy += this.map.gravity * 0.85;
        u.y += u.vy;
        if (u.y > RZ.WORLD_H + 90) {
          this.kill(u, this.map.voidBottom ? '坠入虚空！' : '沉没！');
          continue;
        }
        var s2 = this.terrain.supportY(u.x, HALF_W, Math.max(0, u.y - 26));
        if (u.vy >= 0 && u.y >= s2) {
          u.y = s2; u.airborne = false;
          var drop = u.y - u.fallFrom;
          if (drop > FALL_SAFE) {
            var d = Math.round((drop - FALL_SAFE) * 0.42);
            this.damage(u, d, null, '#ffb4b4');
            this.fx.debris(u.x, u.y, 12, this.map.ground.top);
          }
          u.vy = 0; u.fallFrom = 0;
        }
      } else if (support < u.y) {
        u.y = support;                        // 地面被抬高（理论上不会发生）
      }
    }
  };

  Game.prototype.updateSupplies = function () {
    for (var i = this.supplies.length - 1; i >= 0; i--) {
      var s = this.supplies[i];
      if (!s.landed) {
        s.vy = Math.min(1.5, s.vy + 0.04);
        s.y += s.vy;
        s.x += Math.sin(this.t * 0.002 + i) * 0.25 + this.wind * 0.01;
        var g = this.terrain.groundBelow(s.x, Math.max(0, s.y - 4));
        if (s.y >= g) { s.y = g; s.landed = true; }
        if (s.y > RZ.WORLD_H + 40) { this.supplies.splice(i, 1); continue; }
      }
      for (var k = 0; k < this.units.length; k++) {
        var u = this.units[k];
        if (u.alive && Math.abs(u.x - s.x) < 22 && Math.abs(u.y - s.y) < 34) {
          if (this.collect(s, u)) this.supplies.splice(i, 1);
          break;
        }
      }
    }
  };

  Game.prototype.updateCamera = function () {
    var target = null;
    if (this.phase === 'fly' && this.projectiles.length) {
      var best = this.projectiles[0];
      for (var i = 1; i < this.projectiles.length; i++) {
        if (this.projectiles[i].y < best.y) best = this.projectiles[i];
      }
      target = { x: best.x, y: Math.max(best.y, 60) };
    } else if (this.active) {
      target = { x: this.active.x, y: this.active.y - 60 };
    }
    if (target) {
      this.cam.tx = target.x - this.viewW / 2;
      this.cam.ty = target.y - this.viewH / 2;
    }
    this.cam.tx = clamp(this.cam.tx, 0, Math.max(0, RZ.WORLD_W - this.viewW));
    this.cam.ty = clamp(this.cam.ty, -60, Math.max(0, RZ.WORLD_H - this.viewH));
    var k = this.phase === 'fly' ? 0.16 : 0.09;
    this.cam.x += (this.cam.tx - this.cam.x) * k;
    this.cam.y += (this.cam.ty - this.cam.y) * k;
    if (this.cam.shake > 0) this.cam.shake *= 0.88;
    if (this.cam.shake < 0.3) this.cam.shake = 0;
  };

  // ---- 电脑的道具策略 ----
  function itemSlot(u, id) { return u.items.indexOf(id); }

  /** 回血 / 回油 / 隐身：开打之前先把自己收拾好 */
  Game.prototype.aiUseSupportItems = function (u) {
    var hpRatio = u.hp / u.maxHp, i;
    if (hpRatio < 0.32) {
      i = itemSlot(u, 'heal2');
      if (i >= 0) { this.useItem(i); return; }           // 结束回合
    }
    if (hpRatio < 0.6) {
      i = itemSlot(u, 'heal1');
      if (i >= 0) this.useItem(i);
    }
    if (!u.canAfford(u.vehicle.w1)) {
      i = itemSlot(u, 'fuel2');
      if (i >= 0) { this.useItem(i); return; }           // 结束回合
    }
    if (u.fuel < u.maxFuel * 0.25) {
      i = itemSlot(u, 'fuel1');
      if (i >= 0) this.useItem(i);
    }
    if (u.stealth === 0 && u.hp / u.maxHp < 0.5) {
      i = itemSlot(u, 'stealth');
      if (i >= 0 && Math.random() < 0.5) this.useItem(i);
    }
  };

  /** 加强 / 双倍 / 麻痹：算出这一发能打中人，才值得砸道具 */
  Game.prototype.aiUseOffenseItems = function (u, plan) {
    if (!plan || this.phase !== 'aim') return;
    var expect = plan.expect || 0, i;
    if (expect >= 70) {
      i = itemSlot(u, 'power');
      if (i >= 0) this.useItem(i);
    }
    if (expect >= 50 && plan.weaponIdx !== 2) {
      i = itemSlot(u, 'double');
      if (i >= 0) this.useItem(i);
    }
    if (expect >= 40 && !u.shotMode) {
      i = itemSlot(u, 'stun');
      if (i >= 0 && Math.random() < 0.4) this.useItem(i);
    }
  };

  // ---- AI 驱动 ----
  Game.prototype.updateAI = function () {
    var u = this.active;
    if (!u || !u.ai) return;
    if (this.aiTimer > 0) { this.aiTimer--; return; }

    if (!this.aiPlan) {
      this.aiUseSupportItems(u);            // 可能直接结束回合（大回血 / 大回燃料）
      if (this.phase !== 'aim') return;
      this.aiPlan = RZ.aiThink(this, u);
      this.aiUseOffenseItems(u, this.aiPlan);
      this.aiPhase = this.aiPlan.moveDir ? 'move' : 'aim';
      this.aiMoveLeft = this.aiPlan.moveSteps || 0;
      return;
    }
    var plan = this.aiPlan;

    if (this.aiPhase === 'move') {
      if (this.aiMoveLeft > 0 && u.fuel > 0) { this.moveActive(plan.moveDir); this.aiMoveLeft--; return; }
      this.aiPlan = RZ.aiThink(this, u, true);   // 换位后重新计算
      this.aiPhase = 'aim';
      return;
    }

    if (this.aiPhase === 'aim') {
      if (u.weaponIdx !== plan.weaponIdx) { u.weaponIdx = plan.weaponIdx; }
      if (u.face !== plan.face) u.face = plan.face;
      var da = plan.aim - u.aim;
      if (Math.abs(da) > 0.8) { u.aim += clamp(da, -2.2, 2.2); return; }
      u.aim = plan.aim;
      this.aiPhase = 'charge';
      this.startCharge();
      return;
    }

    if (this.aiPhase === 'charge') {
      // 暂停、切窗口等外部原因可能把蓄力标志掐掉，这里自愈重来一次，
      // 否则电脑会一直举着炮站到回合超时。
      if (!this.charging) { this.startCharge(); return; }
      if (u.power < plan.power) return;
      this.releaseCharge();
      if (this.phase === 'aim') {          // 油不够没打出去：退回一号武器，再不行就过
        u.weaponIdx = 0;
        if (u.canAfford(u.vehicle.w1)) { this.charging = true; this.fire(); }
        if (this.phase === 'aim') this.passTurn();
      }
      this.aiPhase = 'done';
    }
  };

  // ---- 绘制 ----
  Game.prototype.draw = function (ctx, viewW, viewH) {
    this.viewW = viewW; this.viewH = viewH;
    var shakeX = (Math.random() - 0.5) * this.cam.shake * 2;
    var shakeY = (Math.random() - 0.5) * this.cam.shake * 2;

    ctx.save();
    ctx.translate(-Math.round(this.cam.x + shakeX), -Math.round(this.cam.y + shakeY));

    this.bg.draw(ctx, this.cam, this.t, this.night);
    this.terrain.flush();
    ctx.drawImage(this.terrain.canvas, 0, 0);

    // 水下 / 熔岩氛围
    if (this.map.haze) {
      ctx.fillStyle = this.map.haze;
      ctx.fillRect(-400, -400, RZ.WORLD_W + 800, RZ.WORLD_H + 800);
    }

    var i;
    for (i = 0; i < this.supplies.length; i++) RZ.drawSupply(ctx, this.supplies[i], this.t);

    var viewer = this.viewerTeam();
    for (i = 0; i < this.units.length; i++) {
      var u = this.units[i];
      if (!u.alive || this.hiddenFrom(viewer, u)) continue;   // 隐身：整辆车都不画
      RZ.drawUnit(ctx, u, this.t, { active: u === this.active && this.result === null });
    }

    // 只提示炮口指向，不预测落点——预测线会随蓄力乱跳，反而干扰手感
    if (this.guide && this.phase === 'aim' && this.active && !this.active.ai &&
        (this.opts.localPlayerId == null || this.active.playerId === this.opts.localPlayerId)) {
      RZ.drawAimRay(ctx, this.active, RZ.TEAM_COLORS[this.active.team]);
    }

    for (i = 0; i < this.projectiles.length; i++) RZ.drawProjectile(ctx, this.projectiles[i], this.t);
    for (i = 0; i < this.effects.length; i++) {
      var e = this.effects[i];
      if (e.type === 'bolt') RZ.drawBolt(ctx, e.x, e.y0, e.y1, e.life);
    }

    this.fx.draw(ctx);
    this.fx.drawTexts(ctx);

    // 屏幕外战车的方向指示
    for (i = 0; i < this.units.length; i++) {
      var o = this.units[i];
      if (!o.alive || this.hiddenFrom(viewer, o)) continue;
      var sx = o.x - this.cam.x;
      if (sx < 26 || sx > viewW - 26) {
        var cx = clamp(sx, 18, viewW - 18) + this.cam.x;
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = RZ.TEAM_COLORS[o.team];
        ctx.beginPath();
        var dir = sx < 26 ? -1 : 1;
        var cy = clamp(o.y - 40 - this.cam.y, 30, viewH - 30) + this.cam.y;
        ctx.moveTo(cx + dir * 10, cy);
        ctx.lineTo(cx - dir * 6, cy - 8);
        ctx.lineTo(cx - dir * 6, cy + 8);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    ctx.restore();
  };

  // ---- 联机协议适配 --------------------------------------------------
  Game.prototype.markNetwork = function (kind) {
    if (kind === 'full' || this.networkDirty !== 'full') this.networkDirty = kind || 'light';
  };

  Game.prototype.emitNetwork = function (event, data) {
    if (this.networkEvent) this.networkEvent(event, data || {});
  };

  /** 权威端唯一的远端 Action 入口；先核验玩家、回合和阶段，再调用原有规则方法。 */
  Game.prototype.applyNetworkAction = function (playerId, message) {
    var u = this.active;
    if (this.result !== null || !u || !u.alive || u.playerId !== playerId || u.ai || this.phase !== 'aim') return false;
    var action = message && message.action;
    if (action === 'MOVE') {
      var x0 = u.x, f0 = u.fuel;
      this.moveActive(message.direction === 'left' ? -1 : message.direction === 'right' ? 1 : 0);
      return u.x !== x0 || u.fuel !== f0;
    }
    if (action === 'SET_ANGLE') {
      var angle = Number(message.value);
      if (!Number.isFinite(angle) || angle < -25 || angle > 90) return false;
      u.aim = angle; this.markNetwork('light'); return true;
    }
    if (action === 'SELECT_WEAPON') {
      var idx = Number(message.weapon), old = u.weaponIdx;
      if (idx !== 0 && idx !== 1 && idx !== 2) return false;
      this.setWeapon(idx); return u.weaponIdx === idx || old === idx;
    }
    if (action === 'FIRE') {
      var power = Number(message.power), fireAngle = Number(message.angle), weapon = Number(message.weapon);
      if (!Number.isFinite(power) || power < 4 || power > 100 || !Number.isFinite(fireAngle) || fireAngle < -25 || fireAngle > 90) return false;
      if (weapon !== 0 && weapon !== 1 && weapon !== 2) return false;
      var chosen = weapon === 0 ? u.vehicle.w1 : weapon === 1 ? u.vehicle.w2 : u.vehicle.ss;
      if (!u.canAfford(u.shotMode === 'fly' ? RZ.LOCATOR : u.shotMode === 'stun' ? RZ.STUN_SHELL : chosen)) return false;
      u.aim = fireAngle; u.weaponIdx = weapon; u.power = power;
      this.charging = true; this.fire(); return this.phase === 'fly';
    }
    if (action === 'USE_ITEM') return this.useItem(Number(message.itemIndex));
    if (action === 'END_TURN') { this.passTurn(); return this.phase === 'settle'; }
    return false;
  };

  function weaponNameOf(p) { return p && p.w ? p.w.name : ''; }
  function weaponByName(unit, name) {
    var list = unit ? [unit.vehicle.w1, unit.vehicle.w2, unit.vehicle.ss] : [];
    list.push(RZ.LOCATOR, RZ.STUN_SHELL);
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].name === name) return list[i];
    for (i = 0; i < RZ.VEHICLES.length; i++) {
      var v = RZ.VEHICLES[i], all = [v.w1, v.w2, v.ss];
      for (var k = 0; k < all.length; k++) if (all[k].name === name) return all[k];
    }
    return RZ.VEHICLES[0].w1;
  }

  Game.prototype.visibleStateForPlayer = function (playerId, includeTerrain) {
    var self = this, viewer = null;
    for (var q = 0; q < this.units.length; q++) if (this.units[q].playerId === playerId) viewer = this.units[q];
    var viewerTeam = viewer ? viewer.team : playerId - 1;
    var units = this.units.map(function (u) {
      var own = u.playerId === playerId, hidden = self.hiddenFrom(viewerTeam, u);
      return {
        index: u.index, playerId: u.playerId, vehicleId: u.vehicle.id, name: u.name, team: u.team,
        hp: u.hp, maxHp: u.maxHp, fuel: own ? u.fuel : null, maxFuel: u.maxFuel,
        spentThisTurn: own ? u.spentThisTurn : 0, dealtThisTurn: own ? u.dealtThisTurn : 0,
        x: hidden ? u.lastSeenX : u.x, y: hidden ? u.lastSeenY : u.y, vy: hidden ? 0 : u.vy,
        face: u.face, aim: own ? u.aim : Math.round(u.aim / 5) * 5,
        power: own ? u.power : 0, lastPower: own ? u.lastPower : 0,
        weaponIdx: own ? u.weaponIdx : 0,
        items: own ? u.items.slice() : null, itemCount: u.items.length,
        buffDouble: own ? u.buffDouble : false, buffPower: own ? u.buffPower : (u.buffPower > 0 ? 1 : 0),
        shotMode: own ? u.shotMode : null, stunned: u.stunned, stealth: u.stealth,
        noFire: own ? u.noFire : false, dots: u.dots.map(function (d) { return { type: d.type, turns: d.turns, damage: d.damage }; }),
        alive: u.alive, airborne: u.airborne, fallFrom: u.fallFrom,
        hitFlash: u.hitFlash, muzzleFlash: u.muzzleFlash, usedItemFlash: u.usedItemFlash
      };
    });
    var state = {
      version: ++this.networkVersion, gameMode: 'lan1v1', mapId: this.map.id, night: this.night,
      units: units, activeIndex: this.active ? this.active.index : -1,
      currentPlayerId: this.active ? this.active.playerId : null,
      wind: this.wind, round: this.round, turnNo: this.turnNo, phase: this.phase,
      timeLeft: this.timeLeft, charging: ownActive(this, playerId), result: this.result,
      projectiles: this.projectiles.map(function (p) {
        return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, weaponName: weaponNameOf(p), ownerIndex: p.owner ? p.owner.index : -1,
          team: p.team, age: p.age, alive: p.alive, bounceLeft: p.bounceLeft, pierceLeft: p.pierceLeft,
          didSplit: p.didSplit, dmgMul: p.dmgMul || 1, trail: p.trail ? p.trail.slice(-80) : [] };
      }),
      supplies: this.supplies.map(function (s) { return { x: s.x, y: s.y, vy: s.vy, itemId: s.def.id, landed: s.landed }; }),
      effects: this.effects.map(function (e) { return { type: e.type, x: e.x, y0: e.y0, y1: e.y1, life: e.life }; }),
      messages: this.messages.map(function (m) { return { text: m.text, color: m.color, life: m.life }; })
    };
    if (includeTerrain) state.terrainRle = this.terrain.exportMaskRLE();
    return state;
  };

  function ownActive(game, playerId) {
    return !!game.active && game.active.playerId === playerId && game.charging;
  }

  /** 镜像端只应用权威状态，不运行规则更新。 */
  Game.prototype.applyVisibleState = function (state) {
    if (!state || state.mapId !== this.map.id || !state.units || state.units.length !== this.units.length) return false;
    if (state.version != null && this.networkVersion > state.version) return false;
    this.networkVersion = state.version || this.networkVersion;
    var fields = ['hp','maxHp','maxFuel','spentThisTurn','dealtThisTurn','x','y','vy','face','aim','power','lastPower','weaponIdx',
      'buffDouble','buffPower','shotMode','stunned','stealth','noFire','alive','airborne','fallFrom','hitFlash','muzzleFlash','usedItemFlash'];
    for (var i = 0; i < state.units.length; i++) {
      var src = state.units[i], u = this.units[i];
      for (var f = 0; f < fields.length; f++) if (src[fields[f]] != null) u[fields[f]] = src[fields[f]];
      if (src.fuel != null) u.fuel = src.fuel;
      if (src.items) u.items = src.items.slice();
      else if (src.itemCount != null) {
        u.items = [];
        for (var itemNo = 0; itemNo < src.itemCount; itemNo++) u.items.push(null);
      }
      u.dots = (src.dots || []).map(function (d) { return { type: d.type, turns: d.turns, damage: d.damage }; });
    }
    this.active = state.activeIndex >= 0 ? this.units[state.activeIndex] : null;
    this.wind = state.wind; this.round = state.round; this.turnNo = state.turnNo;
    this.phase = state.phase; this.timeLeft = state.timeLeft; this.charging = !!state.charging;
    this.result = state.result; this.night = state.night;
    if (state.terrainRle && !this.terrain.importMaskRLE(state.terrainRle)) return false;
    var self = this;
    this.projectiles = (state.projectiles || []).map(function (p) {
      var owner = p.ownerIndex >= 0 ? self.units[p.ownerIndex] : null;
      return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, w: weaponByName(owner, p.weaponName), owner: owner,
        team: p.team, age: p.age, alive: p.alive, bounceLeft: p.bounceLeft, pierceLeft: p.pierceLeft,
        didSplit: p.didSplit, dmgMul: p.dmgMul, trail: p.trail || [] };
    });
    this.supplies = (state.supplies || []).map(function (s) {
      return { x: s.x, y: s.y, vy: s.vy, def: RZ.itemById(s.itemId), landed: s.landed };
    });
    this.effects = state.effects || [];
    this.messages = state.messages || [];
    this.updateCamera();
    return true;
  };

  RZ.Game = Game;
  RZ.TURN_TIME = TURN_TIME;
})(window.RZ || (window.RZ = {}));
