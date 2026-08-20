#!/usr/bin/env node
'use strict';

const assert = require('assert');
const { loadRZ, flatten } = require('./harness');
const RZ = loadRZ();
let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; console.log('  ok   ' + label); }

function roster() {
  return [
    { vehicle: RZ.vehicleById('liehuo'), team: 0, ai: false, playerId: 1, name: 'P1', items: ['power', 'heal1'] },
    { vehicle: RZ.vehicleById('tuoer'), team: 1, ai: false, playerId: 2, name: 'P2', items: ['stun', 'fuel1'] }
  ];
}
function game(localPlayerId) {
  return new RZ.Game({ mapId: 'dry', roster: roster(), guide: false, humanTeam: localPlayerId - 1, localPlayerId });
}
function mirrorFrom(state) {
  const g = game(2);
  check(g.applyVisibleState(state), '镜像端应用权威快照');
  return g;
}

console.log('\nLAN Game Sync');

{
  const g = game(1);
  const rle = g.terrain.exportMaskRLE();
  const copy = game(2);
  check(copy.terrain.importMaskRLE(rle), '地形 RLE 快照可导入');
  check(Buffer.from(copy.terrain.mask).equals(Buffer.from(g.terrain.mask)), 'Terrain 掩码同步一致');
  check(JSON.stringify(rle).length < 64 * 1024, '地形快照低于单条协议上限');
}

{
  const g = game(1), p1 = g.units[0], p2 = g.units[1];
  flatten(g, 600); p1.y = p2.y = 600; p1.airborne = p2.airborne = false;
  g.active = p2; g.phase = 'aim'; p2.x = 900; p2.fuel = 100;
  check(!g.applyNetworkAction(1, { action: 'MOVE', direction: 'left' }), '非自己回合操作被拒绝');
  const x0 = p2.x, f0 = p2.fuel;
  check(g.applyNetworkAction(2, { action: 'MOVE', direction: 'left' }) && p2.x < x0 && p2.fuel < f0, 'MOVE 经权威 Game 执行并同步 Fuel');
  check(g.applyNetworkAction(2, { action: 'SET_ANGLE', value: 63 }) && p2.aim === 63, 'SET_ANGLE 经权威 Game 执行');
  p2.fuel = 200;
  check(g.applyNetworkAction(2, { action: 'SELECT_WEAPON', weapon: 1 }) && p2.weaponIdx === 1, 'SELECT_WEAPON 经权威 Game 执行');
  check(!g.applyNetworkAction(2, { action: 'SET_ANGLE', value: 999 }), '非法角度被拒绝');
  check(g.applyNetworkAction(2, { action: 'USE_ITEM', itemIndex: 1 }) && p2.fuel > 200 - 1, 'USE_ITEM 经权威 Game 执行');
}

{
  const g = game(1), p2 = g.units[1];
  flatten(g, 600); p2.x = 500; p2.y = 600; p2.airborne = false; p2.fuel = 200;
  g.active = p2; g.phase = 'aim';
  check(g.applyNetworkAction(2, { action: 'FIRE', angle: 45, power: 52, weapon: 0 }), 'FIRE 经权威 Game 执行');
  check(g.phase === 'fly' && g.projectiles.length > 0 && p2.fuel < 200, 'Projectile 与开火 Fuel 由权威端产生');
}

{
  const g = game(1), p2 = g.units[1];
  g.active = p2; g.phase = 'aim';
  check(g.applyNetworkAction(2, { action: 'END_TURN' }) && g.phase === 'settle', 'END_TURN 经权威 Game 执行');
}

{
  const g = game(1), p1 = g.units[0], p2 = g.units[1];
  flatten(g, 600); p1.x = 500; p1.y = 600; p2.x = 800; p2.y = 600;
  p1.airborne = p2.airborne = false; g.wind = 7; g.round = 4; g.turnNo = 8;
  p2.buffPower = 2; p2.stunned = 3; p2.dots = [{ type: 'poison', turns: 2, damage: 30 }];
  const eventMirror = mirrorFrom(g.visibleStateForPlayer(2, true)), events = [];
  g.networkEvent = (event, data) => events.push({ event, data });
  g.networkDirty = null;
  const before = p2.hp;
  g.explode(p2.x, p2.y - 16, p1.vehicle.w1, p1, p2);
  check(p2.hp < before, 'Explosion / Damage / HP 在权威端结算');
  const explosion = events.find(event => event.event === 'EXPLOSION');
  check(g.networkDirty === 'light' && explosion, 'Explosion 使用增量事件，飞行中不发送完整地形');
  eventMirror.terrain.carve(explosion.data.x, explosion.data.y, explosion.data.digRadius || explosion.data.radius);
  check(Buffer.from(eventMirror.terrain.mask).equals(Buffer.from(g.terrain.mask)), 'Explosion 增量事件同步 Terrain');
  const state = g.visibleStateForPlayer(2, true);
  const m = mirrorFrom(state);
  check(m.units[1].hp === p2.hp && m.units[1].fuel === p2.fuel, 'HP 与 Fuel 快照同步');
  check(m.wind === 7 && m.round === 4 && m.turnNo === 8, 'Wind / Round / Turn 快照同步');
  check(m.units[1].buffPower === 2 && m.units[1].stunned === 3 && m.units[1].dots[0].type === 'poison', 'Buff / Debuff 快照同步');
  check(Buffer.from(m.terrain.mask).equals(Buffer.from(g.terrain.mask)), 'Explosion 后 Terrain 快照校正');
}

{
  const g = game(1), p1 = g.units[0], p2 = g.units[1];
  p1.items = ['power', 'double', 'heal1']; p1.delay = 999;
  p1.stealth = 3; p1.lastSeenX = 321; p1.lastSeenY = 456; p1.x = 900; p1.y = 500;
  const state = g.visibleStateForPlayer(2, false);
  check(state.units[0].items === null && state.units[0].itemCount === 3, '对手隐藏道具只同步数量');
  check(state.units[0].x === 321 && state.units[0].y === 456, '隐身玩家不暴露真实位置');
  check(state.units[0].delay === undefined && state.roundQueue === undefined, '快照不暴露 delay 与行动顺序');
  check(Array.isArray(state.units[1].items), '自己的道具内容可见');

  p2.alive = false; p2.hp = 0; g.checkWin();
  const resultState = g.visibleStateForPlayer(2, false);
  const m = mirrorFrom(resultState);
  check(m.result === 0 && m.phase === 'over', 'Result 快照同步（包括 result=0）');
}

console.log('\n✅ LAN Game Sync 通过 ' + passed + ' 项');
