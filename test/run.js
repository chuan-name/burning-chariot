#!/usr/bin/env node
/* 燃烧战车 无头回归测试： node test/run.js
 * 1) 每张地图、每辆战车打完整对局，确认能分出胜负且不抛异常
 * 2) 平地上逐一试射 30 套武器，确认都能命中并造成伤害
 * 3) 必杀技直击，确认落雷 / 覆盖打击等特殊分支都会结算
 * 4) 玩家操作：移动、调角度、蓄力、发射
 */
const { loadRZ, flatten, solvePower } = require('./harness');
const hudWrites = require('./hud-writes');
const RZ = loadRZ();

let pass = 0, fail = 0;
function check(ok, label, extra) {
  if (ok) { pass++; console.log(`  ok   ${label}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? '  ' + extra : ''}`); }
}
function head(t) { console.log(`\n${t}`); }

function newGame(mapId, roster, difficulty) {
  return new RZ.Game({ mapId, roster, difficulty: difficulty || 'normal', guide: false, humanTeam: null });
}
function duel(v, foe, ai) {
  return [
    { vehicle: v, team: 0, ai: ai !== false, name: v.name },
    { vehicle: foe, team: 1, ai: ai !== false, name: foe.name + '·2' }
  ];
}

// ---------- 1. 完整对局 ----------
head('对局能正常结束');
function playOut(g, label) {
  let frames = 0;
  while (g.result === null && frames < 60 * 60 * 12) { g.update(16); frames++; }
  check(g.result !== null && g.turnNo >= 3, label,
    `回合=${g.turnNo} 结果=${g.result} 残弹=${g.projectiles.length}`);
}
for (const m of RZ.MAPS) {
  const a = RZ.VEHICLES[Math.floor(Math.random() * RZ.VEHICLES.length)];
  const b = RZ.VEHICLES[Math.floor(Math.random() * RZ.VEHICLES.length)];
  playOut(newGame(m.id, duel(a, b), 'hard'), `${m.name} · ${a.name} vs ${b.name}`);
}
for (const v of RZ.VEHICLES) {
  const foe = RZ.VEHICLES[(RZ.VEHICLES.indexOf(v) + 5) % RZ.VEHICLES.length];
  playOut(newGame('dry', duel(v, foe)), `1v1 ${v.name}`);
}
playOut(newGame('sky', [
  { vehicle: RZ.VEHICLES[0], team: 0, ai: true, name: '烈火' },
  { vehicle: RZ.VEHICLES[1], team: 1, ai: true, name: '红龙' },
  { vehicle: RZ.VEHICLES[4], team: 0, ai: true, name: '毒蜘蛛' },
  { vehicle: RZ.VEHICLES[9], team: 1, ai: true, name: '奥丁' }
]), '2v2 天空之城');

// ---------- 2. 平地试射 ----------
head('平地上每套武器都能打中并造成伤害');
for (const v of RZ.VEHICLES) {
  for (const [label, key] of [['武器一', 'w1'], ['武器二', 'w2'], ['必杀', 'ss']]) {
    const g = newGame('dry', duel(v, RZ.VEHICLES[0], false), 'hard');
    const floor = flatten(g);
    g.wind = 0;
    const me = g.units[0], foe = g.units[1];
    me.x = 500; me.y = floor; me.face = 1; me.aim = 45; me.airborne = false;
    foe.x = 900; foe.y = floor; foe.airborne = false;
    const w = v[key];
    me.power = solvePower(RZ, g, me, w, 45, foe.x);
    me.fuel = RZ.MAX_FUEL;
    me.weaponIdx = key === 'w1' ? 0 : key === 'w2' ? 1 : 2;
    const hp0 = foe.hp;
    g.active = me; g.phase = 'aim';
    g.fire();
    let n = 0;
    while (g.projectiles.length && n < 4000) { g.update(16); n++; }
    for (let i = 0; i < 200; i++) g.update(16);
    const dmg = Math.round(hp0 - foe.hp);
    check(dmg > 0, `${v.name} ${label} ${w.name}`, `力度=${me.power.toFixed(0)} 掉血=${dmg}`);
  }
}

// ---------- 3. 必杀直击 ----------
head('必杀直击（落雷 / 覆盖打击 / 持续伤害都要结算）');
for (const v of RZ.VEHICLES) {
  const g = newGame('dry', duel(v, RZ.VEHICLES[0], false), 'hard');
  const me = g.units[0], foe = g.units[1];
  const hp0 = foe.hp;
  g.active = me;
  g.explode(foe.x, foe.y - 16, v.ss, me, foe);
  for (let i = 0; i < 240; i++) g.update(16);
  const dmg = Math.round(hp0 - foe.hp);
  check(dmg > 0, `${v.name} ${v.ss.name}`, `掉血=${dmg}`);
}

// ---------- 4. 玩家操作 ----------
head('玩家操作');
{
  const v = RZ.VEHICLES[0];
  const g = newGame('dry', duel(v, RZ.VEHICLES[1], false));
  const u = g.active;
  flatten(g);
  u.y = 600; u.airborne = false; u.x = 500;

  const aim0 = u.aim;
  for (let i = 0; i < 10; i++) g.applyHeld({ ArrowUp: true });
  check(u.aim === aim0 + 10, '按住 ↑ 抬高角度', `${aim0}° → ${u.aim}°`);
  for (let i = 0; i < 5; i++) g.applyHeld({ ArrowDown: true });
  check(u.aim === aim0 + 5, '按住 ↓ 压低角度', `→ ${u.aim}°`);

  const x0 = u.x, fuel0 = u.fuel;
  for (let i = 0; i < 30; i++) g.applyHeld({ ArrowRight: true });
  check(u.x > x0 && u.fuel < fuel0, '按住 → 前进并消耗燃料',
    `x ${x0} → ${u.x.toFixed(0)}，燃料 ${fuel0} → ${u.fuel.toFixed(0)}`);
  check(u.face === 1, '朝向跟着移动方向翻转');

  u.aim = 45;
  g.startCharge();
  for (let i = 0; i < 40; i++) g.update(16);
  const charged = u.power;
  check(charged > 30 && charged <= 100, '按住空格蓄力', `力度=${charged.toFixed(0)}`);
  g.releaseCharge();
  check(g.phase === 'fly' && g.projectiles.length > 0, '松开空格发射', `弹数=${g.projectiles.length}`);

  // 角度上下限
  const g2 = newGame('dry', duel(v, RZ.VEHICLES[1], false));
  for (let i = 0; i < 400; i++) g2.applyHeld({ ArrowUp: true });
  check(g2.active.aim === 90, '角度上限 90°');
  for (let i = 0; i < 400; i++) g2.applyHeld({ ArrowDown: true });
  check(g2.active.aim === -25, '角度下限 -25°');

  // 燃料不够就切不了必杀
  const g3 = newGame('dry', duel(v, RZ.VEHICLES[1], false));
  g3.active.fuel = v.ss.fuel - 1;
  g3.setWeapon(2);
  check(g3.active.weaponIdx !== 2, '燃料不足时无法切到必杀', `油=${g3.active.fuel} 需要=${v.ss.fuel}`);
  g3.active.fuel = v.ss.fuel;
  g3.setWeapon(2);
  check(g3.active.weaponIdx === 2, '油够了就能切到必杀');
}

// ---------- 5. 燃料经济 ----------
head('燃料是唯一资源：开炮、移动、延迟、回油');
{
  const v = RZ.vehicleById('duzhizhu');
  check(RZ.MAX_FUEL === 200, '燃料上限 200（对齐原版）');
  check(v.w1.fuel === 8 && v.w2.fuel === 11 && v.ss.fuel === 115,
    '毒蜘蛛三套武器耗油 8 / 11 / 115', `实际 ${v.w1.fuel}/${v.w2.fuel}/${v.ss.fuel}`);
  for (const veh of RZ.VEHICLES) {
    if (!(veh.w1.fuel < veh.w2.fuel && veh.w2.fuel < veh.ss.fuel)) {
      check(false, `${veh.name} 三套武器耗油递增`, `${veh.w1.fuel}/${veh.w2.fuel}/${veh.ss.fuel}`);
    }
  }
  check(true, '每辆车都是 一号 < 二号 < 必杀 的耗油梯度');

  // 开炮扣油
  // 开局油量：够一发一号或二号武器加一点点移动，绝不够放必杀
  check(RZ.START_FUEL >= v.w2.fuel && RZ.START_FUEL < v.ss.fuel,
    `开局 ${RZ.START_FUEL} 点油：打得起二号武器，远远放不出必杀`);
  for (const veh of RZ.VEHICLES) {
    if (RZ.START_FUEL < veh.w1.fuel) check(false, `${veh.name} 开局连一号武器都打不出`);
  }
  check(true, '每辆车开局都至少打得出一发一号武器');
  const heavy = RZ.vehicleById('aodin');
  check(RZ.START_FUEL - heavy.w2.fuel < heavy.w1.fuel,
    '奥丁这种二号武器最贵的，一发就把开局的油打空',
    `${RZ.START_FUEL} - ${heavy.w2.fuel} = ${RZ.START_FUEL - heavy.w2.fuel}`);

  const g = newGame('dry', duel(v, RZ.VEHICLES[0], false));
  const u = g.active;
  const f0 = u.fuel;
  u.weaponIdx = 1;
  g.fire();
  check(u.fuel === f0 - v.w2.fuel && u.spentThisTurn === v.w2.fuel,
    '开炮按武器耗油扣', `${f0} → ${u.fuel}`);

  // 必杀不清空油槽
  const g2 = newGame('dry', duel(v, RZ.VEHICLES[0], false));
  g2.active.fuel = RZ.MAX_FUEL;
  g2.active.weaponIdx = 2;
  g2.fire();
  check(g2.active.fuel === RZ.MAX_FUEL - v.ss.fuel && g2.active.fuel > 0,
    '必杀很贵但不会清空整槽', `打完还剩 ${g2.active.fuel}`);

  // 移动扣油，且留得下一发一号武器
  const g3 = newGame('dry', duel(v, RZ.VEHICLES[0], false));
  flatten(g3);
  const m = g3.active;
  m.y = 600; m.airborne = false; m.x = 400;
  const before = m.fuel;
  for (let i = 0; i < 120; i++) g3.applyHeld({ ArrowRight: true });
  check(m.moveSpent > 0 && m.fuel < before, '移动消耗燃料',
    `走了 ${Math.round(m.x - 400)}px，耗油 ${m.moveSpent.toFixed(0)}`);
  // 把油放干，确认移动会在「还够打一发一号武器」的位置刹住
  m.fuel = v.w1.fuel + 4;
  const stuckAt = m.x;
  for (let i = 0; i < 400; i++) g3.applyHeld({ ArrowRight: true });
  check(m.fuel >= v.w1.fuel && m.x > stuckAt, '油见底时停下，但一定留得住一发一号武器',
    `余油 ${m.fuel.toFixed(1)} ≥ ${v.w1.fuel}`);
  check(g3.active.canAfford(v.w1), '所以任何时候都不会卡在打不出炮的状态');

  // 延迟跟着耗油走
  const g4 = newGame('dry', duel(v, RZ.VEHICLES[0], false));
  const a = g4.active;
  a.spentThisTurn = v.w1.fuel;
  const dLight = g4.delayFor(a);
  a.spentThisTurn = v.ss.fuel;
  const dHeavy = g4.delayFor(a);
  check(dHeavy > dLight * 2, '烧的油越多，出手延迟越长', `一号 +${dLight} / 必杀 +${dHeavy}`);

  // 回油：省着用 / 打中人 / 少乱跑
  const g5 = newGame('dry', duel(v, RZ.VEHICLES[0], false));
  const r = g5.active;
  const base = (spent, dealt, moved) => {
    r.fuel = 0; r.spentThisTurn = spent; r.dealtThisTurn = dealt; r.moveSpent = moved;
    return g5.refuel(r);
  };
  const thrifty = base(0, 0, 0);
  const spendy = base(120, 0, 0);
  const hitter = base(8, 200, 0);
  const roamer = base(60, 0, 60);
  check(thrifty > spendy, '这回合省着用，回油更多', `省 ${thrifty} / 大手大脚 ${spendy}`);
  check(hitter > base(8, 0, 0), '打中敌人多回一点油', `命中 ${hitter} / 空放 ${base(8, 0, 0)}`);
  check(roamer < base(60, 0, 0), '满地图乱跑少回一点油', `乱跑 ${roamer} / 不跑 ${base(60, 0, 0)}`);
  check(spendy >= 8, '再怎么烧也保底回一些油', `${spendy}`);
  check(thrifty <= 26, '单回合回油是十几点的量级，不能一口气回满', `最阔绰的一回合也只有 ${thrifty}`);

  // 每辆车都得养得活自己：打一发一号武器必须净赚，且各车差距不能太离谱。
  // （曾经奥丁 w1 耗油 14、回油只有 10，每回合净亏 2 点，连挪一步都做不到。）
  const econ = RZ.VEHICLES.map((veh) => {
    const thrift = (spent) => Math.max(0, (20 - spent) * 0.3);
    const gain = (spent) => Math.max(8, Math.round(veh.regen + thrift(spent)));
    const net1 = gain(veh.w1.fuel) - veh.w1.fuel;
    const net2 = gain(veh.w2.fuel) - veh.w2.fuel;
    return {
      veh, net1, net2,
      reach: Math.round(Math.max(0, net1) / veh.moveCost),
      ssTurns: Math.ceil((veh.ss.fuel - RZ.START_FUEL) / (net1 + 6))
    };
  });
  const worst = econ.reduce((a, b) => (a.net1 <= b.net1 ? a : b));
  const bestE = econ.reduce((a, b) => (a.net1 >= b.net1 ? a : b));
  check(worst.net1 >= 5, '每辆车打一发一号武器都是净赚',
    `最差的是 ${worst.veh.name}：${worst.net1 >= 0 ? '+' : ''}${worst.net1}/回合`);
  check(bestE.net1 - worst.net1 <= 8, '各车的回合结余不能拉开太大',
    `${worst.veh.name} +${worst.net1} ~ ${bestE.veh.name} +${bestE.net1}`);
  const w2bad = econ.filter((e) => e.net2 < -3);
  check(w2bad.length === 0, '二号武器最多打个平手，不该让谁越打越穷',
    w2bad.length ? w2bad.map((e) => `${e.veh.name} ${e.net2}`).join(' ') : '最低 ' +
      econ.reduce((a, b) => (a.net2 <= b.net2 ? a : b)).net2);
  const stuck = econ.filter((e) => e.reach < 50);
  check(stuck.length === 0, '一个回合的结余至少够挪 50px，不至于被钉死',
    stuck.length ? stuck.map((e) => `${e.veh.name} ${e.reach}px`).join(' ') : '最短 ' +
      econ.reduce((a, b) => (a.reach <= b.reach ? a : b)).reach + 'px');
  const ssRange = econ.map((e) => e.ssTurns);
  check(Math.min(...ssRange) >= 4 && Math.max(...ssRange) <= 16,
    '每辆车攒必杀的回合数都在合理区间',
    `${Math.min(...ssRange)} ~ ${Math.max(...ssRange)} 回合`);

  // 攒出一发必杀要花好几个回合
  const g7 = newGame('dry', duel(v, RZ.VEHICLES[0], false));
  const s7 = g7.active;
  s7.fuel = RZ.START_FUEL;
  let saveTurns = 0;
  while (s7.fuel < v.ss.fuel && saveTurns < 60) {
    s7.spentThisTurn = v.w1.fuel; s7.dealtThisTurn = 150; s7.moveSpent = 0;
    s7.fuel -= v.w1.fuel;
    g7.refuel(s7);
    saveTurns++;
  }
  check(saveTurns >= 6, '边打一号武器边攒，至少要六个回合才放得出必杀', `${saveTurns} 回合`);

  // 一整回合走完：扣油 → 结算延迟 → 回油
  const g6 = newGame('dry', duel(v, RZ.VEHICLES[0], false));
  const p = g6.active;
  const d0 = p.delay, fuel0 = p.fuel;
  p.weaponIdx = 0;
  g6.fire();
  let n = 0;
  while (g6.active === p && n < 3000) { g6.update(16); n++; }
  check(p.delay > d0, '回合结束后累计延迟增加', `${d0} → ${Math.round(p.delay)}`);
  check(p.fuel > fuel0 - v.w1.fuel, '回合结束后自动回油',
    `开火后 ${fuel0 - v.w1.fuel} → 回合末 ${Math.round(p.fuel)}`);
}

// ---------- 6. 不能出现僵局 ----------
// 深海遗迹的神殿立柱会把两辆车隔开，电脑必须懂得把挡路的地形轰开，
// 而不是隔着柱子对着空气互扔一百个回合。
head('隔着地形也要能打完');
{
  let unresolved = 0, longest = 0, total = 0, n = 0;
  for (let k = 0; k < 10; k++) {
    const a = RZ.VEHICLES[(k * 3 + 1) % 10], b = RZ.VEHICLES[(k * 7 + 4) % 10];
    const g = newGame('sea', [
      { vehicle: a, team: 0, ai: true, name: a.name },
      { vehicle: b, team: 1, ai: true, name: b.name }
    ]);
    // 预算给足：低攻打高防（比如贝贝龙对铁金刚）本来就磨，
    // 这里要判的是「到底能不能分出胜负」，不是「快不快」
    let f = 0;
    while (g.result === null && f < 60 * 60 * 15) { g.update(16); f++; }
    n++; total += g.turnNo;
    if (g.result === null) unresolved++;
    longest = Math.max(longest, g.turnNo);
  }
  check(unresolved === 0, '深海遗迹 10 局全部分出胜负',
    `平均 ${(total / n).toFixed(1)} 回合，最长 ${longest} 回合`);
  // 回合数是重尾分布：低攻打高防、中间又隔着神殿立柱时，实测 p95 约 43、
  // 偶尔能摸到 110+（带上道具互相回血还会更长）。所以硬指标只有一条——必须分出胜负；
  // 长度改用均值这种稳一点的统计量，再加一个「失控」上限兜底。
  check(total / n < 60 && longest < 180, '不会磨成没完没了的消耗战',
    `平均 ${(total / n).toFixed(1)} 回合，最长 ${longest}`);

  // 正面立一堵高墙。注意炮弹可以从世界上方掠过，所以「完全封死」的墙并不存在——
  // 这里要守的是当年那个真 bug：被挡住时电脑掉头往反方向越打越远。
  const g2 = newGame('dry', [
    { vehicle: RZ.VEHICLES[0], team: 0, ai: true, name: '红' },
    { vehicle: RZ.VEHICLES[0], team: 1, ai: true, name: '蓝' }
  ]);
  const T = g2.terrain, FLOOR = 600;
  flatten(g2, FLOOR);
  const A = g2.units[0], B = g2.units[1];
  A.x = 600; A.y = FLOOR; A.airborne = false; A.face = 1;
  B.x = 900; B.y = FLOOR; B.airborne = false; B.face = -1;
  // 墙要顶到天，否则电脑高抛就越过去了，根本用不着挖
  const wallX0 = 730, wallX1 = 770, wallTop = 40;
  for (let y = wallTop; y < FLOOR; y++) T.mask.fill(1, y * T.w + wallX0, y * T.w + wallX1);
  const solidBefore = countSolid(T, wallX0, wallX1, wallTop, FLOOR);
  g2.wind = 0;
  g2.stepWind = function () { this.wind = 0; };     // 定住风，免得测试随风飘
  g2.active = A;

  // 记下每一发的落点：关键是「朝墙打」，而不是掉头往反方向乱轰
  const hits = [];
  const origExplode = g2.explode.bind(g2);
  g2.explode = function (x, y, w, atk, tgt) {
    hits.push({ x: x, by: g2.active.name });
    return origExplode(x, y, w, atk, tgt);
  };
  g2.dropSupply = function () {};                   // 别让补给箱干扰落点统计

  let f2 = 0;
  while (g2.turnNo < 12 && g2.result === null && f2 < 60 * 60 * 5) { g2.update(16); f2++; }
  const solidAfter = countSolid(T, wallX0, wallX1, wallTop, FLOOR);

  // 每一发都该落在「射手 → 敌人」这一侧，而不是背对着敌人越打越远
  let forward = 0;
  for (const s of hits) {
    const away = s.by === '红' ? s.x < 600 : s.x > 900;
    if (!away) forward++;
  }
  check(hits.length >= 6 && forward === hits.length,
    '被墙挡住时，每一发都朝着敌人那侧打，不会掉头往反方向越打越远',
    `${forward}/${hits.length} 发朝向正确`);
  check(solidAfter <= solidBefore, '墙会被逐渐啃开，不会越打越厚',
    `墙体剩余 ${(solidAfter / solidBefore * 100).toFixed(0)}%`);
}
function countSolid(T, x0, x1, y0, y1) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (T.mask[y * T.w + x]) n++;
  return n;
}

// ---------- 7. 射程包络 ----------
// 45° 满力度大致等于一张地图的宽度：太远就没法瞄，太近就打不到人。
head('45° 满力度射程 ≈ 一张地图宽');
{
  const W = RZ.WORLD_W, LO = 1550, HI = 2250;
  function range(mapDef, weapon) {
    const u = { x: 0, y: 0, face: 1, aim: 45, team: 0, atk: 100, def: 100 };
    const p = RZ.launch(u, weapon, 45, 100, mapDef.gravity)[0];
    const y0 = p.y, x0 = p.x, g = mapDef.gravity * (weapon.gravMul || 1);
    let x = p.x, y = p.y, vx = p.vx, vy = p.vy;
    for (let i = 0; i < 8000; i++) {
      vy += g; x += vx; y += vy;
      if (vy > 0 && y >= y0) return { r: Math.round(x - x0), t: i };
    }
    return { r: -1, t: -1 };
  }
  let worst = { r: 0 }, closest = { r: 1e9 }, bad = 0;
  for (const m of RZ.MAPS) for (const v of RZ.VEHICLES) for (const k of ['w1', 'w2', 'ss']) {
    const got = range(m, v[k]);
    if (got.r < LO || got.r > HI) {
      bad++;
      console.log(`       ${m.name} ${v.name} ${v[k].name} = ${got.r}px（${(got.r / W).toFixed(2)}×地图）`);
    }
    if (got.r > worst.r) worst = { r: got.r, s: `${m.name} ${v.name} ${v[k].name}` };
    if (got.r < closest.r) closest = { r: got.r, s: `${m.name} ${v.name} ${v[k].name}` };
  }
  check(bad === 0, `150 套武器×地图组合都落在 ${LO}~${HI}px`,
    `最远 ${worst.r}px ${worst.s} / 最近 ${closest.r}px ${closest.s}`);

  // 低重力地图靠降初速保持射程，只让弹道变飘
  const w1 = RZ.VEHICLES[0].w1;
  const dry = range(RZ.mapById('dry'), w1), star = range(RZ.mapById('star'), w1);
  check(Math.abs(dry.r - star.r) < 60, '低重力地图射程与常规地图一致',
    `干枯 ${dry.r}px / 星空 ${star.r}px`);
  check(star.t > dry.t * 1.15, '低重力地图滞空明显更久',
    `干枯 ${dry.t}帧 / 星空 ${star.t}帧`);
}

// ---------- 8. 风向 ----------
head('风向：变化不能太猛，越极端越要往回拉');
{
  const g = newGame('star', duel(RZ.VEHICLES[0], RZ.VEHICLES[1], false));   // windMax 最大的图
  const wm = g.map.windMax;
  const cap = Math.ceil(wm * 0.3);
  let prev = g.wind, maxStep = 0, absSum = 0, maxAbs = 0, hi = 0, run = 0, maxRun = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    g.stepWind();
    maxStep = Math.max(maxStep, Math.abs(g.wind - prev));
    prev = g.wind;
    const a = Math.abs(g.wind);
    absSum += a;
    maxAbs = Math.max(maxAbs, a);
    if (a >= wm * 0.6) hi++;
    if (a >= wm * 0.8) { run++; maxRun = Math.max(maxRun, run); } else run = 0;
  }
  check(maxStep <= cap, `单回合最多变 ${cap} 点，不会从 +10 一步跳到 -1`, `实测最大 ${maxStep}`);
  check(maxRun <= 4 && hi / N < 0.15, '极端风待不久', `最长连续 ${maxRun} 回合，超过 60% 的回合占 ${(hi / N * 100).toFixed(1)}%`);

  // 直接验证「越极端，回拉越快」：固定风力取多次平均，看期望位移
  const meanDelta = (w) => {
    let sum = 0;
    for (let i = 0; i < 4000; i++) { g.wind = w; g.stepWind(); sum += g.wind - w; }
    return sum / 4000;
  };
  const atEdge = meanDelta(Math.round(wm * 0.9));
  const atMid = meanDelta(Math.round(wm * 0.45));
  const atCalm = meanDelta(0);
  check(atEdge < -wm * 0.15, '接近上限时，平均每回合被往回拉一大截', `${atEdge.toFixed(1)}/回合`);
  check(atEdge < atMid && atMid < atCalm + 0.3, '越极端回拉越快（0 → 中段 → 边缘 递增）',
    `0点 ${atCalm.toFixed(1)} / 中段 ${atMid.toFixed(1)} / 边缘 ${atEdge.toFixed(1)}`);
  check(Math.abs(atCalm) < wm * 0.05, '风力在中间时没有固定偏向', `${atCalm.toFixed(2)}`);
  check(absSum / N >= wm * 0.2, '风力仍然有存在感，不是常年贴着 0', `平均 |风| ${(absSum / N).toFixed(1)}/${wm}`);
  check(hi / N > 0.02 && maxAbs >= wm * 0.7, '偶尔也会刮起真正的大风',
    `${(hi / N * 100).toFixed(1)}% 的回合超过 60%，历史最大 ${maxAbs}`);

  // 从顶到边上开始，必须一路往回走
  g.wind = wm;
  const back = [];
  for (let i = 0; i < 4; i++) { g.stepWind(); back.push(g.wind); }
  check(back.every(v => v < wm) && back[3] < wm * 0.8,
    '刮到 +20 之后会被稳稳拉回来', `${wm} → ${back.join(' → ')}`);

  // 开局别一上来就顶格
  let extremeStart = 0;
  for (let i = 0; i < 60; i++) {
    const g2 = newGame('star', duel(RZ.VEHICLES[0], RZ.VEHICLES[1], false));
    if (Math.abs(g2.wind) > wm * 0.5) extremeStart++;
  }
  check(extremeStart === 0, '开局风力不会一上来就顶格', `60 局里 ${extremeStart} 局开局就是极端风`);
}

// ---------- 9. 蓄力手感 ----------
head('蓄力手感');
{
  const g = newGame('dry', duel(RZ.VEHICLES[0], RZ.VEHICLES[1], false));
  const u = g.active;
  g.startCharge();
  let frames = 0;
  while (u.power < 100 && frames < 600) { g.update(16); frames++; }
  const secs = frames / 60;
  check(secs >= 1.6 && secs <= 3.0, '蓄满一条需要 1.6~3 秒，够微调', `${secs.toFixed(2)}s`);

  u.power = 62;
  g.releaseCharge();
  check(u.lastPower === 62, '发射后记录本次力度，供下一发参考', `lastPower=${u.lastPower}`);
}

// ---------- 10. 暂停不能把电脑卡死 ----------
head('暂停 / 失焦打断蓄力后，电脑必须接着打');
{
  const g = newGame('dry', duel(RZ.VEHICLES[0], RZ.VEHICLES[1]), 'normal');
  let n = 0;
  while (g.aiPhase !== 'charge' && n < 900) { g.update(16); n++; }
  check(g.aiPhase === 'charge', '电脑进入蓄力阶段', `${n} 帧`);

  g.charging = false;              // 复现：暂停时把蓄力标志掐掉
  const turn0 = g.turnNo;
  let m = 0;
  while (g.phase === 'aim' && m < 500) { g.update(16); m++; }
  // 500 帧 ≈ 8.3 秒，远小于 30 秒回合超时，所以只可能是自愈后真的开了火
  check(g.phase !== 'aim' && m < 500, '蓄力被打断后电脑重新蓄力并开火',
    `${m} 帧后 phase=${g.phase}`);

  let k = 0;
  while (g.turnNo === turn0 && k < 900) { g.update(16); k++; }
  check(g.turnNo > turn0, '这一回合能正常结束并交给下一位', `回合 ${turn0}→${g.turnNo}`);
}
{
  // 玩家侧：暂停期间松手，这一发应当作废而不是自己打出去
  const g = newGame('dry', duel(RZ.VEHICLES[0], RZ.VEHICLES[1], false));
  g.startCharge();
  for (let i = 0; i < 30; i++) g.update(16);
  check(g.active.power > 0, '玩家蓄力中', `力度=${g.active.power.toFixed(0)}`);
  g.cancelCharge();
  for (let i = 0; i < 200; i++) g.update(16);
  check(!g.charging && g.active.power === 0 && g.phase === 'aim' && g.projectiles.length === 0,
    '取消蓄力后不会走火', `phase=${g.phase} 弹数=${g.projectiles.length}`);
}

// ---------- 11. 面板不能泄露电脑的出手信息 ----------
head('电脑回合时下方面板显示玩家自己的车');
{
  const mk = (roster, humanTeam) => new RZ.Game({
    mapId: 'dry', roster, difficulty: 'normal', guide: false, humanTeam
  });
  const [A, B, C, D] = [RZ.VEHICLES[0], RZ.VEHICLES[1], RZ.VEHICLES[4], RZ.VEHICLES[9]];

  // 1v1：玩家 vs 电脑
  const g = mk([
    { vehicle: A, team: 0, ai: false, name: '我方' },
    { vehicle: B, team: 1, ai: true, name: '电脑' }
  ], 0);
  const me = g.units[0], foe = g.units[1];
  g.active = me;
  check(g.viewUnit() === me, '自己的回合显示当前战车');
  g.active = foe;
  foe.power = 88; foe.weaponIdx = 2; foe.aim = 71;   // 电脑正在瞄准
  check(g.viewUnit() === me, '电脑回合仍显示自己的车');
  check(g.viewUnit().power !== foe.power && g.viewUnit().aim !== foe.aim,
    '看不到电脑的力度与角度', `电脑 力度${foe.power}/角度${foe.aim}，面板取自 ${g.viewUnit().name}`);

  // 2v2：电脑队友行动时同样不显示队友的读数
  const g2 = mk([
    { vehicle: A, team: 0, ai: false, name: '我方' },
    { vehicle: B, team: 1, ai: true, name: '敌一' },
    { vehicle: C, team: 0, ai: true, name: '队友' },
    { vehicle: D, team: 1, ai: true, name: '敌二' }
  ], 0);
  g2.active = g2.units[2];
  check(g2.viewUnit() === g2.units[0], '电脑队友行动时也显示自己的车');

  // 同屏双人：行动的那位就在键盘前，照常显示
  const g3 = mk([
    { vehicle: A, team: 0, ai: false, name: '玩家一' },
    { vehicle: B, team: 1, ai: false, name: '玩家二' }
  ], null);
  g3.active = g3.units[1];
  check(g3.viewUnit() === g3.units[1], '同屏双人显示当前行动的玩家');

  // 自己的车被击破后不能改成显示电脑的车
  g.units[0].alive = false;
  g.active = foe;
  check(g.viewUnit() === me, '玩家阵亡后面板不会切到电脑的车');

  // 面板上的每个读数都不能带出电脑的信息
  const g4 = mk([
    { vehicle: A, team: 0, ai: false, name: '我方' },
    { vehicle: B, team: 1, ai: true, name: '电脑' }
  ], 0);
  const p = g4.units[0], e = g4.units[1];
  p.aim = 38; p.fuel = 96; p.lastPower = 58; p.weaponIdx = 0; p.power = 0;
  e.aim = 74; e.fuel = 200; e.power = 93; e.weaponIdx = 1;
  g4.active = e;
  g4.charging = true;
  const h = g4.hudState();
  check(h.unit === p && h.live === false, '面板处于待命状态', `tag=${h.tag}`);
  check(h.power === 0, '蓄力条读数为 0，不显示电脑的力度', `电脑力度=${Math.round(e.power)}`);
  check(h.aim === 38, '角度显示自己的炮口', `面板=${h.aim}° 电脑=${e.aim}°`);
  check(h.fuel === 96, '燃料显示自己的，不暴露电脑还剩多少油', `面板=${h.fuel} 电脑=${e.fuel}`);
  check(h.weaponIdx === 0, '武器高亮的是自己选的那把', `面板=${h.weaponIdx} 电脑=${e.weaponIdx}`);
  check(h.lastPower === 58, '上次力度刻度仍是自己的');

  // 轮到自己时读数恢复实时
  g4.active = p; p.power = 71;
  const h2 = g4.hudState();
  check(h2.live === true && h2.power === 71, '轮到自己时蓄力条恢复实时', `力度=${h2.power}`);
}

// ---------- 12. 分出胜负后必须彻底停下 ----------
head('分出胜负后对局停止（红队 result=0 是假值，别被短路掉）');
for (const winner of [0, 1]) {
  const g = newGame('dry', duel(RZ.VEHICLES[0], RZ.VEHICLES[1], false));
  g.units[1 - winner].hp = 1;
  g.kill(g.units[1 - winner]);
  g.checkWin();
  const turn0 = g.turnNo, hp0 = g.units[winner].hp;
  for (let i = 0; i < 900; i++) g.update(16);
  check(g.result === winner && g.turnNo === turn0 && g.units[winner].hp === hp0,
    `${RZ.TEAM_NAMES[winner]}获胜后不再开新回合`,
    `result=${g.result} 回合 ${turn0}→${g.turnNo}`);
}

// ---------- 13. HUD 不能每帧刷爆 DOM ----------
head('HUD 每帧的 DOM 写入量（帧率的直接来源）');
hudWrites.runChecks(check);
hudWrites.runItemChecks(check);

// ---------- 14. 道具系统 ----------
head('道具');
{
  const mk = (items, foeItems) => new RZ.Game({
    mapId: 'dry', difficulty: 'normal', guide: false, humanTeam: 0,
    roster: [
      { vehicle: RZ.vehicleById('liehuo'), team: 0, ai: false, name: '我', items: items || [] },
      { vehicle: RZ.vehicleById('tuoer'), team: 1, ai: false, name: '敌', items: foeItems || [] }
    ]
  });
  const slot = (u, id) => u.items.indexOf(id);
  // 摆成平地对射，落点可控
  function arena(g, gap) {
    flatten(g, 600);
    g.wind = 0;
    const [a, b] = g.units;
    a.x = 500; a.y = 600; a.airborne = false; a.face = 1; a.aim = 45;
    b.x = 500 + (gap || 400); b.y = 600; b.airborne = false; b.face = -1;
    a.power = solvePower(RZ, g, a, a.vehicle.w1, 45, b.x);
    g.active = a; g.phase = 'aim';
    return [a, b];
  }
  function resolve(g, n) {
    let i = 0;
    while (g.projectiles.length && i < 6000) { g.update(16); i++; }
    for (let k = 0; k < (n || 260); k++) g.update(16);
  }

  check(RZ.ITEMS.length === 9 && RZ.MAX_ITEMS === 4, '九种道具，每辆车最多带四个',
    `${RZ.ITEMS.length} 种 / 上限 ${RZ.MAX_ITEMS}`);
  check(!RZ.SUPPLIES, '旧的补给品（修理包/增幅器/燃料桶/涡轮）已经拿掉');

  // --- 小回血 / 大回血 ---
  {
    const g = mk(['heal1', 'heal2']);
    const u = g.active;
    u.hp = 200;
    g.useItem(slot(u, 'heal1'));
    check(Math.round(u.hp) === Math.round(200 + u.maxHp * 0.25), '小回血恢复 25%',
      `200 → ${Math.round(u.hp)}`);
    check(g.phase === 'aim', '小回血不结束回合');
    const before = u.hp;
    g.useItem(slot(u, 'heal2'));
    check(Math.round(u.hp) === Math.round(Math.min(u.maxHp, before + u.maxHp * 0.5)),
      '大回血恢复 50%', `${Math.round(before)} → ${Math.round(u.hp)}`);
    check(g.phase !== 'aim', '大回血用完立刻结束回合', `phase=${g.phase}`);
  }

  // --- 回燃料 ---
  {
    const g = mk(['fuel1', 'fuel2']);
    const u = g.active;
    u.fuel = 10;
    g.useItem(slot(u, 'fuel1'));
    check(Math.round(u.fuel) === Math.round(10 + u.maxFuel * 0.2), '小回燃料恢复 20%',
      `10 → ${Math.round(u.fuel)}`);
    check(g.phase === 'aim', '小回燃料不结束回合');
    g.useItem(slot(u, 'fuel2'));
    check(Math.round(u.fuel) === Math.round(10 + u.maxFuel * 0.6), '大回燃料恢复 40%',
      `→ ${Math.round(u.fuel)}`);
    check(g.phase !== 'aim', '大回燃料用完立刻结束回合');
  }

  // --- 一回合可以连用好几个 ---
  {
    const g = mk(['heal1', 'fuel1', 'power']);
    const u = g.active;
    u.hp = 300; u.fuel = 20;
    g.useItem(slot(u, 'heal1'));
    g.useItem(slot(u, 'fuel1'));
    g.useItem(slot(u, 'power'));
    check(u.items.length === 0 && u.hp > 300 && u.fuel > 20 && u.buffPower === 3,
      '一个回合可以连用多个道具', `剩余道具 ${u.items.length}`);
  }

  // --- 加强攻击：+50%，三回合有效，对必杀也算 ---
  {
    const plain = mk();
    const [pa, pb] = arena(plain);
    const hp0 = pb.hp;
    plain.fire();
    resolve(plain);
    const base = hp0 - pb.hp;

    const boosted = mk(['power']);
    const [ba, bb] = arena(boosted);
    ba.power = pa.lastPower;
    boosted.useItem(slot(ba, 'power'));
    const hp1 = bb.hp;
    boosted.fire();
    resolve(boosted);
    const buffed = hp1 - bb.hp;
    check(base > 0 && Math.abs(buffed / base - 1.5) < 0.06, '加强攻击伤害 +50%',
      `${Math.round(base)} → ${Math.round(buffed)}（×${(buffed / base).toFixed(2)}）`);
  }
  {
    const g = mk(['power']);
    const u = g.active;
    g.useItem(slot(u, 'power'));
    check(u.buffPower === 3, '加强攻击挂三个回合');
    for (let r = 0; r < 3; r++) { u.buffPower--; }
    check(u.buffPower === 0, '三个回合内没用掉就失效');
  }

  // --- 双倍攻击：真的打两发，对必杀无效，当回合不开炮就白用 ---
  {
    const g = mk(['double']);
    const [a, b] = arena(g);
    g.useItem(slot(a, 'double'));
    let volleys = 0;
    const origLaunch = g.launchVolley.bind(g);
    g.launchVolley = function (u, w, p, m) { volleys++; return origLaunch(u, w, p, m); };
    g.fire();
    resolve(g, 400);
    check(volleys === 2, '双倍攻击真的打出两发（不是伤害 ×2）', `发射了 ${volleys} 次`);
    check(a.buffDouble === false, '双倍攻击用掉即清');
  }
  {
    const g = mk(['double']);
    const [a] = arena(g);
    a.fuel = RZ.MAX_FUEL;
    a.weaponIdx = 2;
    g.useItem(slot(a, 'double'));
    let volleys = 0;
    const origLaunch = g.launchVolley.bind(g);
    g.launchVolley = function (u, w, p, m) { volleys++; return origLaunch(u, w, p, m); };
    g.fire();
    resolve(g, 400);
    check(volleys === 1, '双倍攻击对必杀无效', `发射了 ${volleys} 次`);
  }
  {
    const g = mk(['double']);
    const u = g.active;
    g.useItem(slot(u, 'double'));
    g.passTurn();
    for (let i = 0; i < 200 && g.active === u; i++) g.update(16);
    check(u.buffDouble === false, '这回合不开炮，双倍攻击就白用了');
  }

  // --- 加强 + 双倍叠加：两发都 +50% ---
  {
    const plain = mk();
    const [pa, pb] = arena(plain);
    const hp0 = pb.hp;
    plain.fire();
    resolve(plain);
    const one = hp0 - pb.hp;

    const combo = mk(['power', 'double']);
    const [ca, cb] = arena(combo);
    ca.power = pa.lastPower;
    combo.useItem(slot(ca, 'power'));
    combo.useItem(slot(ca, 'double'));
    const hp1 = cb.hp;
    combo.fire();
    resolve(combo, 500);
    const both = hp1 - cb.hp;
    check(both > one * 2.4, '加强 + 双倍叠加：两发都吃到 +50%',
      `单发 ${Math.round(one)} → 叠加 ${Math.round(both)}（×${(both / one).toFixed(2)}）`);
  }

  // --- 飞行：瞬移、不结束回合、之后不能再开火但能移动 ---
  {
    const g = mk(['fly']);
    const [a] = arena(g);
    const x0 = a.x;
    g.useItem(slot(a, 'fly'));
    check(a.shotMode === 'fly', '飞行道具把这一发换成定位炮');
    a.power = 40;
    g.fire();
    resolve(g, 200);
    check(Math.abs(a.x - x0) > 80, '战车瞬移到定位炮落点', `x ${x0} → ${Math.round(a.x)}`);
    check(g.phase === 'aim', '飞行不结束回合', `phase=${g.phase}`);
    check(a.noFire === true, '飞完不能再开火');
    const beforeX = a.x;
    a.airborne = false;
    for (let i = 0; i < 40; i++) g.applyHeld({ ArrowRight: true });
    check(a.x > beforeX, '飞完还能继续移动', `x ${Math.round(beforeX)} → ${Math.round(a.x)}`);
    g.fire();
    check(g.phase === 'aim' && g.projectiles.length === 0, '再按发射也打不出去');
  }

  // --- 麻痹弹：命中方三回合不能移动，开炮照常结束回合 ---
  {
    const g = mk(['stun']);
    const [a, b] = arena(g, 360);
    a.power = solvePower(RZ, g, a, RZ.STUN_SHELL, 45, b.x);
    g.useItem(slot(a, 'stun'));
    g.fire();
    let iter = 0;
    while (g.projectiles.length && iter < 6000) { g.update(16); iter++; }
    for (let k = 0; k < 60; k++) g.update(16);
    check(b.stunned === 3, '麻痹弹命中后挂三层麻痹', `stunned=${b.stunned}`);

    // 数一数到底困了几个「自己的回合」
    let blocked = 0;
    for (let turn = 0; turn < 5; turn++) {
      b.airborne = false;
      g.active = b; g.phase = 'aim';
      const bx = b.x;
      for (let i = 0; i < 40; i++) g.applyHeld({ ArrowRight: true });
      if (Math.round(b.x) === Math.round(bx)) blocked++;
      else break;
      g.endTurn();                       // 回合结束才递减
    }
    check(blocked === 3, '整整三个自己的回合都动不了（不是两个）', `被困 ${blocked} 回合`);
  }

  // --- 隐身：敌方看不见，电脑只能照最后出现的位置打 ---
  {
    const g = mk(['stealth']);
    const u = g.active, foe = g.units[1];
    u.x = 700;
    g.update(16);                                   // 记下最后被看到的位置
    g.useItem(slot(u, 'stealth'));
    check(u.stealth === 3, '隐身持续三个回合');
    check(g.hiddenFrom(foe.team, u) === true, '敌方看不到隐身的车');
    check(g.hiddenFrom(u.team, u) === false, '自己人还是看得到');
    u.x = 1200;
    for (let i = 0; i < 5; i++) g.update(16);
    const believed = g.knownPos(foe.team, u);
    check(Math.round(believed.x) === 700, '敌方只知道它消失前在哪',
      `真实 ${Math.round(u.x)} / 敌方以为 ${Math.round(believed.x)}`);
    check(Math.round(g.knownPos(u.team, u).x) === 1200, '自己人知道真实位置');
    u.stealth = 0;
    g.update(16);
    check(Math.round(g.knownPos(foe.team, u).x) === 1200, '隐身结束后位置重新公开');
  }

  // --- 使用道具只亮通用提示，不公开用了什么 ---
  {
    const g = mk(['power']);
    const u = g.active;
    g.useItem(slot(u, 'power'));
    check(u.usedItemFlash > 0, '用道具时车身上有通用提示');
    const leaked = g.messages.some((m) => m.text.indexOf('加强') >= 0);
    check(!leaked, '播报里不会说出用的是哪个道具',
      g.messages.map((m) => m.text).join(' / ') || '（无播报）');
  }

  // --- 开炮之后不能再用道具 ---
  {
    const g = mk(['heal1']);
    const [a] = arena(g);
    g.fire();
    check(g.canUseItems(a) === false, '开炮之后不能再用道具', `phase=${g.phase}`);
  }

  // --- 空投给的是道具，且受上限约束 ---
  {
    const g = mk(['heal1', 'heal1', 'heal1', 'heal1']);
    const u = g.active;
    g.dropSupply();
    const crate = g.supplies[g.supplies.length - 1];
    check(!!RZ.itemById(crate.def.id), '空投箱里装的是道具', crate.def.name);
    check(g.collect(crate, u) === false, '道具满了就捡不了', `已有 ${u.items.length} 个`);
    u.items.pop();
    check(g.collect(crate, u) === true && u.items.length === 4, '腾出格子就能捡起来');
  }
}

// ---------- 15. 回合制：每轮每辆车恰好出手一次 ----------
// 这是全局最重要的一条规则：延迟只排「这一轮里的先后」，绝不会让谁整轮消失。
// 所以同一辆车最多连着出手两次（上一轮压轴 + 下一轮打头），不可能三次。
head('轮次与出手顺序');
{
  function mk(mapId, roster, humanTeam) {
    return new RZ.Game({ mapId, roster, difficulty: 'normal', guide: false, humanTeam });
  }
  const duo = () => mk('dry', [
    { vehicle: RZ.vehicleById('liehuo'), team: 0, ai: false, name: '我' },
    { vehicle: RZ.vehicleById('tuoer'), team: 1, ai: true, name: '电脑' }
  ], 0);

  // 跑一整局，统计每轮各车出手次数与最长连续出手
  const g = mk('sky', [
    { vehicle: RZ.VEHICLES[0], team: 0, ai: true, name: 'A' },
    { vehicle: RZ.VEHICLES[1], team: 1, ai: true, name: 'B' },
    { vehicle: RZ.VEHICLES[4], team: 0, ai: true, name: 'C' },
    { vehicle: RZ.VEHICLES[9], team: 1, ai: true, name: 'D' }
  ], null);
  const perRound = {};
  const seq = [];
  let lastTurn = 0, frames = 0;
  while (g.result === null && frames < 60 * 60 * 8) {
    if (g.turnNo !== lastTurn) {
      lastTurn = g.turnNo;
      const r = g.round;
      perRound[r] = perRound[r] || [];
      perRound[r].push(g.active.name);
      seq.push(g.active.name);
    }
    g.update(16);
    frames++;
  }
  // 只看所有人都还活着的完整轮次
  let badRound = null;
  const rounds = Object.keys(perRound).map(Number).sort((a, b) => a - b);
  for (const r of rounds.slice(0, -1)) {
    const names = perRound[r];
    if (new Set(names).size !== names.length) { badRound = `第${r}轮 ${names.join(',')}`; break; }
  }
  check(!badRound, '同一轮里没有谁出手两次', badRound || `${rounds.length} 轮全部合规`);

  let run = 1, maxRun = 1;
  for (let i = 1; i < seq.length; i++) {
    run = seq[i] === seq[i - 1] ? run + 1 : 1;
    if (run > maxRun) maxRun = run;
  }
  check(maxRun <= 2, '最多连着出手两次，不会出现三连', `实测最长连击 ${maxRun}（共 ${seq.length} 手）`);

  // 延迟只影响先后：烧油多的排到本轮末尾 / 下一轮靠后
  const g2 = duo();
  const [P, A] = g2.units;
  check(g2.active === P && g2.round === 1, '开局按出场顺序，第一轮玩家先手');
  P.delay = 900; A.delay = 300;
  P.lastPos = 0; A.lastPos = 1;
  check(g2.turnOrder()[0] === A, '延迟低的排在前面');
  P.delay = 100;
  check(g2.turnOrder()[0] === P, '延迟变低就排回前面');

  // 实打实地数一遍出手序列。注意玩家必须真的开火——干等到超时是另一套延迟（PASS_DELAY），
  // 测出来的就不是武器的账了。
  function playSequence(weaponIdx, howMany) {
    const g = duo();
    const human = g.units[0];
    const seq = [];
    let lt = 0, f = 0;
    while (seq.length < howMany && f < 60000) {
      if (g.turnNo !== lt) {
        lt = g.turnNo;
        seq.push(g.active.name);
        if (g.active === human) {          // 轮到玩家：选好武器立刻打出去
          human.fuel = RZ.MAX_FUEL;
          human.weaponIdx = weaponIdx;
          human.power = 60;
          g.fire();
        }
      }
      g.update(16);
      f++;
    }
    return seq;
  }

  const ssSeq = playSequence(2, 4);
  check(ssSeq.join(' → ') === '我 → 电脑 → 电脑 → 我',
    '放完必杀，对手连打两手就轮回自己（不是三手）', ssSeq.join(' → '));

  const lightSeq = playSequence(0, 4);
  check(lightSeq.join(' → ') === '我 → 电脑 → 我 → 电脑',
    '打一号武器则下一轮仍是自己先手', lightSeq.join(' → '));

  // 有人阵亡后，剩下的人照样每轮一次
  const g6 = mk('dry', [
    { vehicle: RZ.VEHICLES[0], team: 0, ai: true, name: 'A' },
    { vehicle: RZ.VEHICLES[1], team: 1, ai: true, name: 'B' },
    { vehicle: RZ.VEHICLES[4], team: 0, ai: true, name: 'C' },
    { vehicle: RZ.VEHICLES[9], team: 1, ai: true, name: 'D' }
  ], null);
  g6.kill(g6.units[2]);
  const seen = {};
  let lt6 = 0, f6 = 0, roundNow = g6.round, dup = null;
  while (f6 < 30000 && g6.result === null && g6.round < roundNow + 3) {
    if (g6.turnNo !== lt6) {
      lt6 = g6.turnNo;
      const key = g6.round + ':' + g6.active.name;
      if (seen[key]) dup = key;
      seen[key] = true;
      if (!g6.active.alive) dup = '阵亡的车还在出手 ' + key;
    }
    g6.update(16);
    f6++;
  }
  check(!dup, '有人阵亡后，剩下的车照样每轮一次', dup || '正常');
}

// ---------- 16. 出手顺序 ----------
head('延迟决定出手顺序');
{
  const g = newGame('dry', duel(RZ.VEHICLES[2], RZ.VEHICLES[9], false));
  const [a, b] = g.units;
  a.delay = 0; b.delay = 500;
  const order = g.turnOrder();
  check(order[0] === a, '延迟低的先动');
  a.delay = 900;
  check(g.turnOrder()[0] === b, '延迟变高后让出先手');
}

console.log(`\n${fail ? '❌' : '✅'} 通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail ? 1 : 0);
