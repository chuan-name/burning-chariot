/* 燃烧战车 — 电脑对手
 * 粗扫一遍角度/力度网格找出最优解，再在附近做一次精搜；
 * 难度只影响「抖动」与「是否总是选最优解」，不给 AI 任何额外情报。
 */
(function (RZ) {
  'use strict';

  var DIFF = {
    easy:   { jitterAim: 5.0, jitterPow: 9.0, pick: 3, ssMin: 40 },
    normal: { jitterAim: 2.2, jitterPow: 4.0, pick: 2, ssMin: 90 },
    hard:   { jitterAim: 0.6, jitterPow: 1.2, pick: 1, ssMin: 120 }
  };

  function simVolley(game, unit, weapon, aim, power, face, maxShots) {
    var savedFace = unit.face;
    unit.face = face;
    var shots = RZ.launch(unit, weapon, aim, power, game.map.gravity);
    unit.face = savedFace;
    if (maxShots && shots.length > maxShots) {      // 粗扫只跑中间那一发
      shots = [shots[(shots.length / 2) | 0]];
    }

    var env = {
      terrain: game.terrain, gravity: game.map.gravity, wind: game.wind,
      units: game.units, recordTrail: false, spawn: []
    };
    var impacts = [], guard = 0;
    var queue = shots.slice();
    while (queue.length && guard < 4000) {
      var p = queue.shift();
      for (var i = 0; i < 600; i++) {
        guard++;
        var ev = RZ.step(p, env);
        if (!ev) continue;
        if (ev.type === 'split') { break; }
        if (ev.type === 'bounce') continue;
        if (ev.type === 'hit') impacts.push({ x: ev.x, y: ev.y, target: ev.target });
        break;
      }
      while (env.spawn.length) queue.push(env.spawn.pop());
    }
    return impacts;
  }

  function scoreImpacts(game, unit, weapon, impacts, groupMult) {
    var score = 0, enemyDmg = 0;
    var mult = (weapon.onImpact === 'carpet' ? 1.7 : 1) * (groupMult || 1);
    for (var i = 0; i < impacts.length; i++) {
      var im = impacts[i];
      for (var k = 0; k < game.units.length; k++) {
        var t = game.units[k];
        if (!t.alive) continue;
        // 隐身的敌人只知道它消失前在哪，电脑不许偷看真坐标
        var tp = game.knownPos(unit.team, t);
        var d = Math.hypot(tp.x - im.x, (tp.y - 16) - im.y);
        var dmg = RZ.explosionDamage(weapon, unit, t, d, weapon.radius) * mult;
        if (dmg <= 0) continue;
        if (im.target === t) dmg *= RZ.DIRECT_BONUS;
        if (weapon.onImpact === 'lightning' && Math.abs(t.x - im.x) < 30) dmg *= 1.3;
        if (t.team === unit.team) {
          score -= dmg * (t === unit ? 3.0 : 1.8);        // 别炸自己人
        } else {
          score += dmg;
          enemyDmg += dmg;
          if (dmg >= t.hp) score += 260;                  // 能补刀就补刀
        }
      }
    }
    // 一发都打不中时（比如中间隔着一根柱子），退而求其次挑落点离敌人最近的那发：
    // 既能把挡路的地形轰开，也避免「反正都是 0 分」时随便挑一发朝天打。
    if (enemyDmg <= 0) {
      var nearest = 1e9;
      for (i = 0; i < impacts.length; i++) {
        for (k = 0; k < game.units.length; k++) {
          var f = game.units[k];
          if (!f.alive || f.team === unit.team) continue;
          nearest = Math.min(nearest, Math.hypot(f.x - impacts[i].x, (f.y - 16) - impacts[i].y));
        }
      }
      if (nearest < 1e9) score += Math.max(0, (600 - nearest) / 600) * 8;   // 上限 8 分，压不过任何真实伤害
    }
    return { score: score, dmg: enemyDmg };
  }

  function evaluate(game, unit, weapon, aim, power, face, best, coarse) {
    var imp = simVolley(game, unit, weapon, aim, power, face, coarse ? 1 : 0);
    if (!imp.length) return best;
    var gm = coarse && weapon.count > 1 ? 1 + (weapon.count - 1) * 0.5 : 1;
    var s = scoreImpacts(game, unit, weapon, imp, gm);
    if (s.score > best.score) {
      return { score: s.score, dmg: s.dmg, aim: aim, power: power, face: face, weapon: weapon };
    }
    return best;
  }

  /**
   * 一炮都打不中时用的「挖墙模式」。
   * 中间隔着山体或神殿立柱时，正面开火只会崩到自己，反手乱打又永远打不着——
   * 这时改成瞄着挡路的地形轰，落点越靠近敌人越好，几回合就能开出一条通道。
   */
  function digPlan(game, unit, nearPos, face) {
    var v = unit.vehicle;
    // 挖墙只用最便宜的那把武器，网格也放粗——这只是开路，不值得花一整帧去算
    var list = [v.w1], idxs = [0];
    if (!unit.canAfford(v.w1) && unit.canAfford(v.w2)) { list = [v.w2]; idxs = [1]; }

    var best = { score: -1e9, aim: 45, power: 60, face: face, weaponIdx: idxs[0] };
    for (var w = 0; w < list.length; w++) {
      for (var aim = 8; aim <= 86; aim += 4) {
        for (var pow = 18; pow <= 100; pow += 6) {
          var imp = simVolley(game, unit, list[w], aim, pow, face, 1);
          if (!imp.length) continue;
          var near2 = 1e9, self = 0, wrongSide = true;
          for (var i = 0; i < imp.length; i++) {
            near2 = Math.min(near2, Math.hypot(nearPos.x - imp[i].x, (nearPos.y - 16) - imp[i].y));
            // 落点得在自己和敌人之间，才算是在开路
            if ((imp[i].x - unit.x) * (nearPos.x - unit.x) > 0) wrongSide = false;
            for (var k = 0; k < game.units.length; k++) {
              var f = game.units[k];
              if (!f.alive || f.team !== unit.team) continue;
              var d = Math.hypot(f.x - imp[i].x, (f.y - 16) - imp[i].y);
              self += RZ.explosionDamage(list[w], unit, f, d, list[w].radius);
            }
          }
          // 挖墙难免吃点自己的溅射，权重给低一些，否则宁可掉头乱打也不肯开路
          var score = -near2 - self * 1.5 - (wrongSide ? 600 : 0);
          if (score > best.score) {
            best = { score: score, aim: aim, power: pow, face: face, weaponIdx: idxs[w] };
          }
        }
      }
    }
    return best.score > -1e9 ? best : null;
  }

  RZ.aiThink = function (game, unit, isRethink) {
    var d = DIFF[game.opts.difficulty || 'normal'] || DIFF.normal;
    var enemies = game.units.filter(function (u) { return u.alive && u.team !== unit.team; });
    if (!enemies.length) return { aim: unit.aim, power: 55, weaponIdx: 0, face: unit.face };

    // 最近的敌人决定朝向；只朝那一侧扫描，省掉一半计算
    var near = enemies[0], nearPos = game.knownPos(unit.team, near), bestD = 1e9;
    for (var i = 0; i < enemies.length; i++) {
      var ep = game.knownPos(unit.team, enemies[i]);
      var dd = Math.abs(ep.x - unit.x);
      if (dd < bestD) { bestD = dd; near = enemies[i]; nearPos = ep; }
    }
    var face = nearPos.x >= unit.x ? 1 : -1;

    // 只考虑当前燃料开得起的武器
    var v = unit.vehicle;
    var weapons = [], idxOf = [];
    if (unit.canAfford(v.w1)) { weapons.push(v.w1); idxOf.push(0); }
    if (unit.canAfford(v.w2)) { weapons.push(v.w2); idxOf.push(1); }
    if (unit.canAfford(v.ss)) { weapons.push(v.ss); idxOf.push(2); }
    if (!weapons.length) { weapons.push(v.w1); idxOf.push(0); }   // 油见底了也得比划一下

    var best = { score: -1e9, dmg: 0, aim: 45, power: 60, face: face, weapon: weapons[0] };
    var w, aim, pow;

    // 粗扫
    for (w = 0; w < weapons.length; w++) {
      for (aim = 8; aim <= 84; aim += 4) {
        for (pow = 24; pow <= 100; pow += 6) {
          best = evaluate(game, unit, weapons[w], aim, pow, face, best, true);
        }
      }
    }
    // 反向也试一次低平弹，处理敌人贴脸或地形挡路的情况
    for (aim = 12; aim <= 76; aim += 8) {
      for (pow = 40; pow <= 100; pow += 10) {
        best = evaluate(game, unit, unit.vehicle.w1, aim, pow, -face, best, true);
      }
    }
    // 精搜
    var baseAim = best.aim, basePow = best.power, baseW = best.weapon, baseFace = best.face;
    for (aim = baseAim - 3; aim <= baseAim + 3; aim += 1) {
      for (pow = basePow - 5; pow <= basePow + 5; pow += 1.5) {
        if (pow < 8 || pow > 100 || aim < -20 || aim > 90) continue;
        best = evaluate(game, unit, baseW, aim, pow, baseFace, best);
      }
    }

    var weaponIdx = idxOf[weapons.indexOf(best.weapon)];
    if (weaponIdx === undefined || weaponIdx < 0) weaponIdx = 0;

    // 必杀不值得就留着——它现在要吃掉一大半燃料，还会拖长下一手
    if (weaponIdx === 2 && best.dmg < d.ssMin) {
      var cheap = [], cheapIdx = [];
      for (w = 0; w < weapons.length; w++) {
        if (idxOf[w] !== 2) { cheap.push(weapons[w]); cheapIdx.push(idxOf[w]); }
      }
      if (cheap.length) {
        var alt = { score: -1e9, dmg: 0, aim: 45, power: 60, face: face, weapon: cheap[0] };
        for (w = 0; w < cheap.length; w++) {
          for (aim = 10; aim <= 84; aim += 3) {
            for (pow = 24; pow <= 100; pow += 5) {
              alt = evaluate(game, unit, cheap[w], aim, pow, face, alt, true);
            }
          }
        }
        if (alt.score > -1e8) { best = alt; weaponIdx = cheapIdx[cheap.indexOf(alt.weapon)]; }
      }
    }

    var plan = {
      aim: clampNum(best.aim + (Math.random() - 0.5) * d.jitterAim * 2, -20, 90),
      power: clampNum(best.power + (Math.random() - 0.5) * d.jitterPow * 2, 10, 100),
      face: best.face,
      weaponIdx: weaponIdx,
      expect: best.dmg
    };

    // 谁都打不中：改成朝挡路的地形开炮，把通道刨出来
    var digging = false;
    if (best.dmg < 1) {
      var dig = digPlan(game, unit, nearPos, face);
      if (dig) {
        plan.aim = clampNum(dig.aim, -20, 90);
        plan.power = clampNum(dig.power, 10, 100);
        plan.face = dig.face;
        plan.weaponIdx = dig.weaponIdx;
        digging = true;
      }
    }

    // 打不到人就先挪一挪位置，但要留够开炮的油。
    // 正在挖墙时默认别往前凑（贴到墙根上开炮只会炸到自己），
    // 可要是好几个回合谁都没掉血，那就是僵住了——这时必须动起来换个地形，
    // 并且方向随机，好把双方对峙的对称局面打破。
    var stale = game.turnsSinceDamage || 0;
    var breakingStale = stale >= 5;
    if (!isRethink && !unit.airborne && best.dmg < 45 && (!digging || breakingStale)) {
      var spare = unit.fuel - v.w1.fuel - 6;
      if (spare > 18) {
        plan.moveDir = breakingStale
          ? (Math.random() < 0.5 ? -1 : 1)
          : (nearPos.x >= unit.x ? 1 : -1);
        plan.moveSteps = Math.round(Math.min(breakingStale ? 220 : 150, spare / v.moveCost / 1.7));
      }
    }
    return plan;
  };

  function clampNum(v, a, b) { return v < a ? a : v > b ? b : v; }
})(window.RZ || (window.RZ = {}));
