/* 燃烧战车 — 弹道物理
 * 这一层不碰渲染，也不改战车状态，所以 AI 可以拿同一套代码在一帧内
 * 把上千条弹道跑完来选角度。
 */
(function (RZ) {
  'use strict';

  var WIND_ACC = 0.0040;   // 风力加速度系数
  var MAX_STEP = 4;        // 每个微步最多前进的像素，保证不穿薄地形
  var UNIT_HW = 17, UNIT_HH = 16;

  RZ.WIND_ACC = WIND_ACC;

  // 满力度 45° 的射程约等于一整张地图宽（1900px），低力度也要真能打近处。
  var GRAV_REF = 0.30;                 // 射程基准重力
  function powerToSpeed(power) { return 2.5 + power * 0.214; }
  RZ.powerToSpeed = powerToSpeed;
  RZ.GRAV_REF = GRAV_REF;

  /** 低重力地图按 √(g/g0) 降初速：射程保持一致，只有滞空与弧线变飘 */
  function mapSpeedScale(gravity) {
    return Math.sqrt((gravity || GRAV_REF) / GRAV_REF);
  }

  /** 炮口世界坐标 */
  RZ.muzzle = function (unit, dist) {
    var a = unit.aim * Math.PI / 180;
    return {
      x: unit.x + Math.cos(a) * unit.face * (dist || 26),
      y: unit.y - 14 - Math.sin(a) * (dist || 26)
    };
  };

  /** 按武器定义造出一组炮弹；gravity 传当前地图重力以做射程归一 */
  RZ.launch = function (unit, weapon, aimDeg, power, gravity) {
    var out = [];
    var m = RZ.muzzle(unit, 26);
    var speed = powerToSpeed(power) * weapon.speedMul * mapSpeedScale(gravity);
    var n = weapon.count || 1;
    for (var i = 0; i < n; i++) {
      var off = n === 1 ? 0 : (i - (n - 1) / 2) * (weapon.spread || 0);
      var a = (aimDeg + off) * Math.PI / 180;
      out.push({
        x: m.x, y: m.y,
        vx: Math.cos(a) * unit.face * speed,
        vy: -Math.sin(a) * speed,
        w: weapon, owner: unit, team: unit.team,
        age: 0, alive: true,
        bounceLeft: weapon.bounce || 0,
        pierceLeft: weapon.pierce || 0,
        didSplit: false,
        trail: []
      });
    }
    return out;
  };

  function childOf(p, vx, vy) {
    var cw = Object.create(p.w);
    cw.splitAt = null; cw.count = 1; cw.onImpact = p.w.onImpact;
    return {
      x: p.x, y: p.y, vx: vx, vy: vy, w: cw,
      owner: p.owner, team: p.team, age: 6, alive: true,
      bounceLeft: 0, pierceLeft: 0, didSplit: true, trail: []
    };
  }

  function hitUnit(env, p) {
    var us = env.units;
    for (var i = 0; i < us.length; i++) {
      var u = us[i];
      if (!u.alive) continue;
      if (u === p.owner && p.age < 8) continue;
      if (Math.abs(p.x - u.x) < UNIT_HW && Math.abs(p.y - (u.y - 12)) < UNIT_HH) return u;
    }
    return null;
  }

  /** 近似地形法线，用于跳弹 */
  function normalAt(terrain, x, y) {
    var nx = 0, ny = 0, r = 5;
    for (var dy = -r; dy <= r; dy++) {
      for (var dx = -r; dx <= r; dx++) {
        if (terrain.solid(x + dx, y + dy)) { nx -= dx; ny -= dy; }
      }
    }
    var len = Math.hypot(nx, ny) || 1;
    return { x: nx / len, y: ny / len };
  }

  /**
   * 推进一颗炮弹一帧。
   * env: {terrain, gravity, wind, units, recordTrail, spawn:[]}
   * 返回 null 表示还在飞；否则 {type:'hit'|'gone', x, y, target}
   */
  RZ.step = function (p, env) {
    var g = env.gravity * (p.w.gravMul || 1);
    var wa = env.wind * WIND_ACC * (p.w.windMul == null ? 1 : p.w.windMul);
    p.vy += g; p.vx += wa;
    p.age++;

    if (p.w.splitAt === 'apex' && !p.didSplit && p.vy >= 0 && p.age > 6) {
      p.didSplit = true;
      var sp = Math.hypot(p.vx, p.vy) || 1, base = Math.atan2(p.vy, p.vx);
      var n = p.w.splitCount || 3, spread = (p.w.splitSpread || 12) * Math.PI / 180;
      for (var k = 0; k < n; k++) {
        var a = base + (k - (n - 1) / 2) * spread;
        env.spawn.push(childOf(p, Math.cos(a) * sp, Math.sin(a) * sp));
      }
      p.alive = false;
      return { type: 'split', x: p.x, y: p.y };
    }

    var dist = Math.hypot(p.vx, p.vy);
    var steps = Math.max(1, Math.ceil(dist / MAX_STEP));
    var sx = p.vx / steps, sy = p.vy / steps;
    var t = env.terrain;

    for (var i = 0; i < steps; i++) {
      var px = p.x, py = p.y;
      p.x += sx; p.y += sy;
      if (env.recordTrail && (p.age & 1) === 0 && i === 0) {
        p.trail.push(p.x, p.y);
        if (p.trail.length > 120) p.trail.splice(0, 2);
      }

      if (p.x < -400 || p.x > t.w + 400 || p.y > t.h + 260) {
        p.alive = false; return { type: 'gone', x: p.x, y: p.y };
      }
      if (p.y < -2400) { p.alive = false; return { type: 'gone', x: p.x, y: p.y }; }
      if (p.y < 0) continue;                      // 飞出画面上方仍在飞行

      var u = hitUnit(env, p);
      if (u) { p.alive = false; return { type: 'hit', x: p.x, y: p.y, target: u }; }

      if (t.solid(p.x, p.y)) {
        if (p.pierceLeft > 0) {                   // 穿地弹：钻进去继续走
          p.pierceLeft -= MAX_STEP;
          if (env.dig) env.dig(px, py, p.x, p.y, 9);
          continue;
        }
        if (p.bounceLeft > 0) {                   // 跳弹
          p.bounceLeft--;
          var nrm = normalAt(t, p.x, p.y);
          var dot = p.vx * nrm.x + p.vy * nrm.y;
          p.vx = (p.vx - 2 * dot * nrm.x) * 0.62;
          p.vy = (p.vy - 2 * dot * nrm.y) * 0.62;
          p.x = px + nrm.x * 3; p.y = py + nrm.y * 3;
          if (Math.hypot(p.vx, p.vy) < 1.4) { p.alive = false; return { type: 'hit', x: p.x, y: p.y, target: null }; }
          return { type: 'bounce', x: p.x, y: p.y };
        }
        p.alive = false;
        return { type: 'hit', x: p.x, y: p.y, target: null };
      }
    }
    return null;
  };

  /** 爆炸伤害：距离衰减 × 攻击 ÷ 防御 */
  RZ.explosionDamage = function (weapon, attacker, target, dist, radius) {
    var r = radius != null ? radius : weapon.radius;
    if (dist >= r) return 0;
    var falloff = Math.pow(1 - dist / r, 0.72) * 0.85 + 0.15;
    var atk = attacker ? attacker.atk : 100;
    var def = target ? target.def : 100;
    var dmg = weapon.damage * falloff * (atk / 100) * (100 / (60 + def * 0.4));
    return Math.max(1, Math.round(dmg));
  };

  /** 直接命中车体的额外加成 */
  RZ.DIRECT_BONUS = 1.18;
})(window.RZ || (window.RZ = {}));
