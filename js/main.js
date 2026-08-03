/* 燃烧战车 — 界面装配与主循环 */
(function (RZ) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var canvas, ctx, game = null, paused = false, raf = 0;
  var lastTurn = -1, lastWeaponSig = '';

  var setup = {
    mode: '1v1',
    difficulty: 'normal',
    guide: true,
    mapId: RZ.MAPS[0].id,
    picks: [RZ.VEHICLES[0].id, RZ.VEHICLES[1].id],
    pickSlot: 0,
    loadout: [['double', 'power', 'heal1', 'fuel1'], ['double', 'power', 'heal1', 'fuel1']]
  };

  // ================= 画面切换 =================
  function show(name) {
    var list = document.querySelectorAll('.screen');
    for (var i = 0; i < list.length; i++) list[i].classList.remove('active');
    $('screen-' + name).classList.add('active');
    if (name === 'game') resize();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-go]') : null;
    if (!t) return;
    RZ.SFX.resume(); RZ.SFX.click();
    var to = t.getAttribute('data-go');
    if (to !== 'game') stopGame();
    show(to);
  });

  // ================= 出战准备 =================
  function buildMaps() {
    var box = $('map-list');
    box.innerHTML = '';
    RZ.MAPS.forEach(function (m) {
      var el = document.createElement('div');
      el.className = 'map-card' + (m.id === setup.mapId ? ' active' : '');
      el.style.background = 'linear-gradient(160deg,' + m.sky[0] + ',' + m.sky[2] + ' 62%,' + m.ground.body + ')';
      el.textContent = m.name;
      el.onclick = function () {
        setup.mapId = m.id;
        RZ.SFX.click();
        buildMaps();
      };
      box.appendChild(el);
    });
  }

  function portrait(v, w, h, scale) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.save();
    g.translate(w / 2, h - 6);
    g.scale(scale, scale);
    RZ.drawArt(g, v, 0);
    g.restore();
    return c;
  }

  function buildVehicles() {
    var grid = $('veh-grid');
    grid.innerHTML = '';
    RZ.VEHICLES.forEach(function (v) {
      var el = document.createElement('div');
      el.className = 'veh-card' + (v.id === setup.picks[setup.pickSlot] ? ' active' : '');
      el.appendChild(portrait(v, 100, 62, 0.82));
      var b = document.createElement('b'); b.textContent = v.name;
      var i = document.createElement('i'); i.textContent = v.tag;
      el.appendChild(b); el.appendChild(i);
      el.onclick = function () {
        setup.picks[setup.pickSlot] = v.id;
        RZ.SFX.click();
        buildVehicles();
        showDetail(v);
      };
      grid.appendChild(el);
    });
    showDetail(RZ.vehicleById(setup.picks[setup.pickSlot]));
    $('pick-title').textContent = setup.mode === 'hotseat'
      ? (setup.pickSlot === 0 ? '玩家一 选择战车' : '玩家二 选择战车')
      : '选择你的战车';
  }

  // 移动耗油越低越灵活，换算成 0~100 的分数好读一些
  function mobility(v) {
    var t = (0.16 - v.moveCost) / (0.16 - 0.06);
    return Math.round(Math.max(0, Math.min(1, t)) * 100);
  }

  function statRow(label, val, max) {
    return '<div class="stat"><span>' + label + '</span><div class="track"><i style="width:' +
      Math.round(Math.min(1, val / max) * 100) + '%"></i></div><em>' + val + '</em></div>';
  }

  function weaponRow(tag, w) {
    return '<div class="wpn"><u>' + tag + '</u><b>' + w.name +
      '</b><s>威力 ' + w.damage + (w.count > 1 ? '×' + w.count : '') +
      ' · 范围 ' + w.radius + ' · 耗油 ' + w.fuel + '</s></div>';
  }

  function detailHTML(v) {
    return '<div class="vd-top"><b>' + v.name + '</b><i>' + v.tag + '</i></div>' +
      '<p class="vd-desc">' + v.desc + '</p>' +
      '<div class="stat-rows">' +
        statRow('耐久', v.hp, 1000) + statRow('攻击', v.atk, 130) +
        statRow('防御', v.def, 130) + statRow('机动', mobility(v), 100) +
      '</div>' +
      '<div class="wpn-rows">' +
        weaponRow('武器一', v.w1) + weaponRow('武器二', v.w2) + weaponRow('必　杀', v.ss) +
      '</div>';
  }

  function showDetail(v) { $('veh-detail').innerHTML = detailHTML(v); }

  function buildCodex() {
    var box = $('codex-list');
    box.innerHTML = '';
    RZ.VEHICLES.forEach(function (v) {
      var el = document.createElement('div');
      el.className = 'panel';
      var head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:6px';
      head.appendChild(portrait(v, 110, 68, 0.9));
      var d = document.createElement('div');
      d.innerHTML = detailHTML(v);
      el.appendChild(head);
      el.appendChild(d);
      box.appendChild(el);
    });
  }

  // ================= 道具选购 =================
  function currentLoadout() { return setup.loadout[setup.mode === 'hotseat' ? setup.pickSlot : 0]; }

  function buildShop() {
    var bag = currentLoadout();
    $('shop-count').textContent = bag.length + ' / ' + RZ.MAX_ITEMS;

    var slots = $('loadout');
    slots.innerHTML = '';
    for (var i = 0; i < RZ.MAX_ITEMS; i++) {
      var el = document.createElement('div');
      var def = bag[i] ? RZ.itemById(bag[i]) : null;
      el.className = 'lslot' + (def ? ' filled' : '');
      el.innerHTML = def
        ? '<span class="pip" style="background:' + def.color + '"></span>' + def.name
        : '空';
      if (def) {
        el.title = '点一下拿掉';
        el.onclick = (function (idx) {
          return function () { bag.splice(idx, 1); RZ.SFX.click(); buildShop(); };
        })(i);
      }
      slots.appendChild(el);
    }

    var box = $('shop');
    box.innerHTML = '';
    RZ.ITEMS.forEach(function (def) {
      var b = document.createElement('button');
      b.className = 'shop-item';
      b.disabled = bag.length >= RZ.MAX_ITEMS;
      b.title = def.desc;
      b.innerHTML = '<span class="pip" style="background:' + def.color + '"></span><b>' + def.name + '</b>';
      b.onmouseenter = function () { $('shop-hint').innerHTML = '<b>' + def.name + '</b>　' + def.desc; };
      b.onclick = function () {
        if (bag.length >= RZ.MAX_ITEMS) return;
        bag.push(def.id);
        RZ.SFX.click();
        buildShop();
      };
      box.appendChild(b);
    });
    if (!$('shop-hint')) {
      var hint = document.createElement('div');
      hint.className = 'shop-hint';
      hint.id = 'shop-hint';
      hint.textContent = '鼠标停在道具上看说明；栏位满了就点上面的格子拿掉一个。';
      box.parentNode.appendChild(hint);
    }
  }

  function chipGroup(id, key, cast) {
    var box = $(id);
    box.addEventListener('click', function (e) {
      var c = e.target.closest('.chip');
      if (!c) return;
      var kids = box.querySelectorAll('.chip');
      for (var i = 0; i < kids.length; i++) kids[i].classList.remove('active');
      c.classList.add('active');
      setup[key] = cast(c.getAttribute('data-' + (key === 'difficulty' ? 'diff' : key)));
      RZ.SFX.click();
      if (key === 'mode') { setup.pickSlot = 0; buildVehicles(); buildShop(); }
    });
  }

  // ================= 组队 =================
  function pickRandomVehicle(exclude) {
    var pool = RZ.VEHICLES.filter(function (v) { return exclude.indexOf(v.id) < 0; });
    if (!pool.length) pool = RZ.VEHICLES;
    return pool[(Math.random() * pool.length) | 0];
  }

  function buildRoster() {
    var used = [], roster = [];
    function randomItems() {                      // 电脑随机带四个
      var bag = [];
      for (var i = 0; i < RZ.MAX_ITEMS; i++) bag.push(RZ.ITEMS[(Math.random() * RZ.ITEMS.length) | 0].id);
      return bag;
    }
    function add(vehicle, team, ai, items) {
      used.push(vehicle.id);
      var n = 0;
      roster.forEach(function (r) { if (r.vehicle.id === vehicle.id) n++; });
      roster.push({
        vehicle: vehicle, team: team, ai: ai,
        name: vehicle.name + (n ? '·' + (n + 1) : ''),
        items: items || randomItems()
      });
    }
    var mine = RZ.vehicleById(setup.picks[0]);
    if (setup.mode === '1v1') {
      add(mine, 0, false, setup.loadout[0].slice());
      add(pickRandomVehicle(used), 1, true);
    } else if (setup.mode === '2v2') {
      add(mine, 0, false, setup.loadout[0].slice());
      add(pickRandomVehicle(used), 1, true);
      add(pickRandomVehicle(used), 0, true);
      add(pickRandomVehicle(used), 1, true);
    } else {
      add(mine, 0, false, setup.loadout[0].slice());
      add(RZ.vehicleById(setup.picks[1]), 1, false, setup.loadout[1].slice());
    }
    return roster;
  }

  // ================= 开始 / 结束对局 =================
  function startGame() {
    RZ.SFX.resume();
    stopGame();
    game = new RZ.Game({
      mapId: setup.mapId,
      roster: buildRoster(),
      difficulty: setup.difficulty,
      guide: setup.guide,
      humanTeam: setup.mode === 'hotseat' ? null : 0
    });
    window.__game = game;                       // 调试/自检用的句柄
    game.viewW = canvas.clientWidth; game.viewH = canvas.clientHeight;
    game.cam.x = game.cam.tx = Math.max(0, game.active.x - game.viewW / 2);
    game.cam.y = game.cam.ty = Math.max(0, game.active.y - game.viewH / 2);
    lastTurn = -1; lastWeaponSig = ''; lastItemSig = ''; armedItem = -1;
    resetHUDCache();
    paused = false;
    $('overlay-pause').classList.remove('show');
    $('overlay-result').classList.remove('show');
    $('btn-guide').classList.toggle('on', setup.guide);
    $('btn-mute').classList.toggle('on', !RZ.SFX.isMuted());
    show('game');
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function stopGame() {
    game = null;
    RZ.SFX.stopCharge();
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  // ================= 输入 =================
  var keys = Object.create(null);

  window.addEventListener('keydown', function (e) {
    if ($('screen-game').classList.contains('active')) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Spacebar'].indexOf(e.key) >= 0) e.preventDefault();
    }
    var k = e.key;
    if (k === ' ' || k === 'Spacebar') k = 'Space';
    if (keys[k]) return;                        // 屏蔽系统按键重复
    keys[k] = true;
    onKeyDown(k);
  });

  window.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === ' ' || k === 'Spacebar') k = 'Space';
    keys[k] = false;
    onKeyUp(k);
  });

  window.addEventListener('blur', function () {
    for (var k in keys) keys[k] = false;
    if (!game) return;
    // 玩家的蓄力作废（松手事件收不到了）；电脑的蓄力不能动，否则它会僵住
    if (game.active && game.active.ai) RZ.SFX.stopCharge();
    else game.cancelCharge();
  });

  function onKeyDown(k) {
    RZ.SFX.resume();
    if (!game || !$('screen-game').classList.contains('active')) return;
    if (k === 'Escape') { togglePause(); return; }
    if (paused || game.result !== null) return;
    if (k === 'Space' && canControl()) game.startCharge();
    if (k === '1') game.setWeapon(0);
    if (k === '2') game.setWeapon(1);
    if (k === '3') game.setWeapon(2);
    if (k === 'Enter') { game.passTurn(); RZ.SFX.click(); }
    if (k === 'g' || k === 'G') toggleGuide();
    if (k === 'm' || k === 'M') toggleMute();
  }

  function onKeyUp(k) {
    if (!game || paused || game.result !== null) return;
    if (k === 'Space' && canControl()) game.releaseCharge();
  }

  function canControl() {
    return game && game.active && !game.active.ai && game.phase === 'aim';
  }

  // 触屏按钮映射到同一套虚拟按键
  (function bindTouch() {
    var box = $('touch');
    box.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('.tbtn'); if (!b) return;
      e.preventDefault();
      var k = b.getAttribute('data-k');
      keys[k] = true; onKeyDown(k);
    });
    var up = function (e) {
      var b = e.target.closest ? e.target.closest('.tbtn') : null; if (!b) return;
      var k = b.getAttribute('data-k');
      keys[k] = false; onKeyUp(k);
    };
    box.addEventListener('pointerup', up);
    box.addEventListener('pointercancel', up);
    box.addEventListener('pointerleave', up);
    if (matchMedia('(hover: none)').matches) document.body.classList.add('touch-mode');
  })();

  function toggleGuide() {
    setup.guide = !setup.guide;
    if (game) game.guide = setup.guide;
    $('btn-guide').classList.toggle('on', setup.guide);
    RZ.SFX.click();
  }
  function toggleMute() {
    RZ.SFX.setMuted(!RZ.SFX.isMuted());
    $('btn-mute').classList.toggle('on', !RZ.SFX.isMuted());
  }
  function togglePause() {
    if (!game || game.result !== null) return;
    paused = !paused;
    $('overlay-pause').classList.toggle('show', paused);

    if (paused) {
      RZ.SFX.stopCharge();          // 只掐掉声音，蓄力状态原样留着
      return;
    }
    RZ.SFX.resume();
    if (game.charging) {
      // 暂停期间玩家把空格松了，这一发就作废；还按着（或者是电脑）就接着蓄
      if (game.active && (game.active.ai || keys.Space)) RZ.SFX.startCharge();
      else game.cancelCharge();
    } else if (keys.Space && canControl()) {
      game.startCharge();           // 暂停时按下的空格，恢复后才开始生效
    }
  }

  // ================= HUD =================
  // 这一层每帧都会被调用，所以所有写入都先比对缓存：值没变就一个字节都不碰 DOM。
  // 之前是每帧无条件写 28 处（含两次 innerHTML 重建和一次风向仪重绘），
  // 叠上待命面板的 CSS filter 会让整块 HUD 每帧重新栅格化，直接拖垮帧率。
  var hudCache = Object.create(null);

  function resetHUDCache() { hudCache = Object.create(null); }

  function setText(id, val) {
    var k = 't' + id;
    if (hudCache[k] === val) return;
    hudCache[k] = val;
    $(id).textContent = val;
  }
  function setStyle(id, prop, val) {
    var k = 's' + id + prop;
    if (hudCache[k] === val) return;
    hudCache[k] = val;
    $(id).style[prop] = val;
  }
  function setHTML(id, val) {
    var k = 'h' + id;
    if (hudCache[k] === val) return;
    hudCache[k] = val;
    $(id).innerHTML = val;
  }
  function setClass(id, cls, on) {
    var k = 'c' + id + cls;
    if (hudCache[k] === on) return;
    hudCache[k] = on;
    $(id).classList.toggle(cls, on);
  }
  function setHidden(id, on) {
    var k = 'v' + id;
    if (hudCache[k] === on) return;
    hudCache[k] = on;
    $(id).hidden = on;
  }

  function updateHUD() {
    if (!game) return;
    var u = game.active, i;

    // 出手顺序刻意不画在界面上：谁先谁后、还剩几手，是玩家自己该记的东西。

    // 风力：一回合才变一次，没必要每帧重画表盘
    setText('wind-val', (game.wind > 0 ? '+' : '') + game.wind);
    if (hudCache.wind !== game.wind) {
      hudCache.wind = game.wind;
      drawWindDial(game.wind, game.map.windMax);
    }

    var tl = Math.max(0, Math.ceil(game.timeLeft));
    setText('timer', tl);
    setClass('timer', 'warn', tl <= 5 && game.phase === 'aim');

    // 显示什么由 game.hudState() 决定，这里只负责画上去
    var h = game.hudState();
    setClass('unit-card', 'standby', !h.live);
    setClass('panel-action', 'standby', !h.live);

    if (h.unit) {
      setText('uc-name', h.name);
      setText('uc-tag', h.tag);
      setStyle('bar-hp', 'width', h.hpPct + '%');
      setText('txt-hp', h.hp);
      setStyle('bar-fu', 'width', h.fuelPct + '%');
      setText('txt-fu', h.fuel);
      // 选中的武器要吃掉燃料条右端的这一截
      var costPct = Math.min(h.fuelPct, h.weaponFuel / h.maxFuel * 100);
      setStyle('bar-cost', 'left', (h.fuelPct - costPct) + '%');
      setStyle('bar-cost', 'width', costPct + '%');
      setText('txt-spent', h.spent);

      var sig = h.unit.index + '|' + h.weaponIdx + '|' + Math.round(h.fuel / 5) + '|' + (h.live ? 1 : 0);
      if (sig !== lastWeaponSig) { lastWeaponSig = sig; buildWeaponButtons(h.unit, h.live); }

      setText('aim-val', h.aim);
      setText('pow-val', h.power);
      setStyle('power-fill', 'width', h.power + '%');

      // 道具栏
      var canUse = h.live && game.canUseItems(game.active);
      var itemSig = h.unit.index + '|' + h.unit.items.join(',') + '|' + armedItem + '|' + (canUse ? 1 : 0);
      if (itemSig !== lastItemSig) {
        lastItemSig = itemSig;
        buildItemBar({ unit: h.unit, canUse: canUse });
      }
      if (!canUse && armedItem >= 0) { armedItem = -1; $('item-tip').innerHTML = ''; }

      // 上一发的力度：微调时对着这条刻度找感觉
      setHidden('power-mark', !(h.lastPower > 0));
      if (h.lastPower > 0) {
        setStyle('power-mark', 'left', h.lastPower + '%');
        setText('pow-last', '（上次 ' + h.lastPower + '）');
      } else {
        setText('pow-last', '');
      }
    }

    // 播报
    var tick = '';
    for (i = 0; i < game.messages.length; i++) {
      var msg = game.messages[i];
      // 透明度量化到 0.1，避免淡出期间每帧都重建这块 innerHTML
      var fade = Math.min(1, Math.round(msg.life / 40 * 10) / 10);
      tick += '<div style="color:' + msg.color + ';opacity:' + fade + '">' + msg.text + '</div>';
    }
    setHTML('ticker', tick);

    setText('hint', u && u.ai ? '电脑正在瞄准…'
      : (h.live && !h.unit.canAfford(h.unit.vehicle.w1) ? '燃料不足　Enter 跳过本回合攒油'
        : '← → 移动　↑ ↓ 角度　空格 蓄力发射　Enter 跳过'));

    if (game.turnNo !== lastTurn) {
      lastTurn = game.turnNo;
      armedItem = -1;
      $('item-tip').innerHTML = '';
      if (u) {
        var flash = $('turn-flash');
        flash.textContent = u.ai ? '敌方回合' : (game.opts.humanTeam == null ? RZ.TEAM_NAMES[u.team] + '回合' : '你的回合');
        flash.style.color = RZ.TEAM_COLORS[u.team];
        flash.classList.remove('go');
        void flash.offsetWidth;
        flash.classList.add('go');
      }
    }
  }

  function buildWeaponButtons(u, live) {
    var v = u.vehicle;
    var defs = [
      { tag: '1 · 武器一', w: v.w1 },
      { tag: '2 · 武器二', w: v.w2 },
      { tag: '3 · 必杀', w: v.ss }
    ];
    var box = $('weapons');
    box.innerHTML = '';
    defs.forEach(function (d, i) {
      var b = document.createElement('button');
      var afford = u.canAfford(d.w);
      b.className = 'wbtn' + (u.weaponIdx === i ? ' active' : '') + (afford ? '' : ' locked');
      // 只写耗油：延迟、还能轮到谁，都归玩家自己盘算
      b.innerHTML = '<u>' + d.tag + '</u><b>' + d.w.name + '</b><s>耗油 ' + d.w.fuel + '</s>';
      b.disabled = !live || !afford;
      b.onclick = function () { if (live) game.setWeapon(i); };
      box.appendChild(b);
    });
  }

  // 点一次选中、再点一次才真的用掉——道具太贵重，不能手滑
  var armedItem = -1;
  var lastItemSig = '';

  function buildItemBar(h) {
    var u = h.unit;
    var bag = u ? u.items : [];
    var box = $('item-bar');
    box.innerHTML = '';
    for (var i = 0; i < RZ.MAX_ITEMS; i++) {
      var def = bag[i] ? RZ.itemById(bag[i]) : null;
      var b = document.createElement('button');
      if (!def) {
        b.className = 'islot empty';
        b.innerHTML = '<i>空</i>';
        box.appendChild(b);
        continue;
      }
      b.className = 'islot' + (armedItem === i ? ' armed' : '');
      b.disabled = !h.canUse;
      b.innerHTML = '<span class="pip" style="background:' + def.color + '"></span>' +
        '<b>' + def.short + '</b><i>' + (i + 1) + '</i>';
      b.onclick = (function (idx, d) {
        return function () {
          if (!game || !game.canUseItems(game.active)) return;
          if (armedItem !== idx) {                  // 第一下：选中并给出说明
            armedItem = idx;
            RZ.SFX.aim();
            $('item-tip').innerHTML = '<b>' + d.name + '</b>　' + d.desc +
              (d.endsTurn ? '　<b>（用完立刻结束回合）</b>' : '');
          } else {                                  // 第二下：确认使用
            armedItem = -1;
            $('item-tip').innerHTML = '';
            game.useItem(idx);
          }
          lastItemSig = '';                          // 强制重画
        };
      })(i, def);
      box.appendChild(b);
    }
  }

  var windCtx = null;
  function drawWindDial(wind, max) {
    if (!windCtx) windCtx = $('wind-dial').getContext('2d');
    var g = windCtx, s = 112, c = s / 2;
    g.clearRect(0, 0, s, s);
    g.save();
    g.translate(c, c);
    // 底盘：地图背景可能很亮，仪表需要自己的暗底
    g.fillStyle = 'rgba(10,13,18,0.72)';
    g.beginPath(); g.arc(0, 0, 50, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 50, 0, 6.2832); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(0, 0, 44, 0, 6.2832); g.stroke();
    // 刻度
    for (var i = 0; i < 24; i++) {
      var a = i / 24 * 6.2832;
      var long = i % 6 === 0;
      g.strokeStyle = long ? 'rgba(255,176,51,0.55)' : 'rgba(255,255,255,0.14)';
      g.beginPath();
      g.moveTo(Math.cos(a) * 44, Math.sin(a) * 44);
      g.lineTo(Math.cos(a) * (long ? 34 : 39), Math.sin(a) * (long ? 34 : 39));
      g.stroke();
    }
    // 风向箭头：向右为正
    var ratio = Math.min(1, Math.abs(wind) / Math.max(1, max));
    var dir = wind >= 0 ? 1 : -1;
    var len = 12 + ratio * 26;
    g.strokeStyle = ratio > 0.66 ? '#ff6a1f' : ratio > 0.33 ? '#ffb033' : '#8fd0ff';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-dir * len * 0.5, 34); g.lineTo(dir * len * 0.5, 34); g.stroke();
    g.beginPath();
    g.moveTo(dir * (len * 0.5 + 9), 34);
    g.lineTo(dir * len * 0.5, 29);
    g.lineTo(dir * len * 0.5, 39);
    g.closePath(); g.fill();
    g.restore();
  }

  // ================= 结算 =================
  function showResult() {
    var tally = {};
    game.log.forEach(function (e) { tally[e.by] = (tally[e.by] || 0) + e.dmg; });
    var human = game.opts.humanTeam;
    var title = $('result-title');
    if (game.result === -1) { title.textContent = '同归于尽'; title.style.color = '#c8d0dc'; }
    else if (human == null) { title.textContent = RZ.TEAM_NAMES[game.result] + '获胜'; title.style.color = RZ.TEAM_COLORS[game.result]; }
    else if (game.result === human) { title.textContent = '胜　利'; title.style.color = '#ffb033'; }
    else { title.textContent = '战败'; title.style.color = '#ff5f5f'; }

    var body = '';
    game.units.forEach(function (u) {
      body += '<div class="rrow' + (u.alive ? '' : ' out') + '">' +
        '<span class="dot" style="background:' + RZ.TEAM_COLORS[u.team] + '"></span>' +
        '<span>' + u.name + '<b style="color:#6f7a89;font-weight:400"> · ' + u.vehicle.tag + '</b></span>' +
        '<span style="color:#8391a4">剩余 ' + Math.max(0, Math.round(u.hp)) + '</span>' +
        '<span class="dmg">输出 ' + Math.round(tally[u.index] || 0) + '</span>' +
        '</div>';
    });
    $('result-body').innerHTML = body;
    $('overlay-result').classList.add('show');
  }

  // ================= 主循环 =================
  var last = 0;
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    var dt = last ? Math.min(50, ts - last) : 16;
    last = ts;
    if (!game || !$('screen-game').classList.contains('active')) return;

    if (!paused && game.result === null) {
      game.applyHeld(keys);
      game.update(dt);
    }

    var w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.draw(ctx, w, h);
    updateHUD();

    if (game.result != null && !$('overlay-result').classList.contains('show')) {
      if (game.projectiles.length === 0) showResult();
    }
  }

  function resize() {
    if (!canvas) return;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    if (game) { game.viewW = canvas.clientWidth; game.viewH = canvas.clientHeight; }
  }
  window.addEventListener('resize', resize);

  // ================= 启动 =================
  window.addEventListener('DOMContentLoaded', function () {
    canvas = $('stage');
    ctx = canvas.getContext('2d');
    buildMaps();
    buildVehicles();
    buildShop();
    buildCodex();
    chipGroup('mode-chips', 'mode', String);
    chipGroup('diff-chips', 'difficulty', String);
    chipGroup('guide-chips', 'guide', function (v) { return v === '1'; });

    $('btn-start').onclick = function () {
      if (setup.mode === 'hotseat' && setup.pickSlot === 0) {
        setup.pickSlot = 1;
        buildVehicles();
        buildShop();
        $('btn-start').textContent = '进入战场';
        RZ.SFX.click();
        return;
      }
      setup.pickSlot = 0;
      startGame();
    };
    $('btn-resume').onclick = togglePause;
    $('btn-restart').onclick = startGame;
    $('btn-quit').onclick = function () { stopGame(); show('title'); };
    $('btn-again').onclick = startGame;
    $('btn-lobby').onclick = function () { stopGame(); show('title'); };
    $('btn-pause').onclick = togglePause;
    $('btn-guide').onclick = toggleGuide;
    $('btn-mute').onclick = toggleMute;
    $('btn-mute').classList.add('on');
    resize();
  });
})(window.RZ || (window.RZ = {}));
