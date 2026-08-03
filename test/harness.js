/* 在 Node 里加载浏览器端脚本：canvas 用最小桩件顶替，只测逻辑不测像素 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function fakeCtx() {
  const noop = () => {};
  return new Proxy({
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: noop,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    canvas: { width: 0, height: 0 }
  }, {
    get(t, k) { return k in t ? t[k] : noop; },
    set(t, k, v) { t[k] = v; return true; }
  });
}

function loadRZ() {
  const sandbox = {
    console, Math, Date, Object, Array, JSON, String, Number, Boolean,
    Uint8Array, Uint8ClampedArray, Float32Array, Int16Array,
    setTimeout, clearTimeout,
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx() }) }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  for (const f of ['data.js', 'terrain.js', 'physics.js', 'render.js', 'audio.js', 'ai.js', 'game.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'), sandbox, { filename: f });
  }
  sandbox.RZ.SFX.setMuted(true);
  return sandbox.RZ;
}

/** 把地形压成一块平板，用于排除地形干扰的弹道测试 */
function flatten(game, floor = 600) {
  const T = game.terrain;
  T.mask.fill(0);
  for (let y = floor; y < game.terrain.h; y++) {
    T.mask.fill(1, y * T.w, (y + 1) * T.w);
  }
  return floor;
}

/** 用真实弹道搜一个能落在目标附近的力度，相当于玩家试射 */
function solvePower(RZ, game, unit, weapon, aimDeg, targetX) {
  let bestP = 40, bestErr = Infinity;
  for (let pw = 6; pw <= 100; pw += 0.5) {
    const env = { terrain: game.terrain, gravity: game.map.gravity, wind: game.wind, units: [], recordTrail: false, spawn: [] };
    let p = RZ.launch(unit, weapon, aimDeg, pw, game.map.gravity)[0], ev = null, guard = 0;
    while (guard < 6000) {
      ev = RZ.step(p, env);
      if (!ev) { guard++; continue; }
      if (ev.type === 'split' && env.spawn.length) {      // 分裂弹跟中间那颗子弹
        p = env.spawn[(env.spawn.length / 2) | 0]; env.spawn.length = 0; continue;
      }
      if (ev.type === 'bounce') { guard++; continue; }
      break;
    }
    const err = Math.abs(ev.x - targetX);
    if (err < bestErr) { bestErr = err; bestP = pw; }
  }
  return bestP;
}

module.exports = { loadRZ, flatten, solvePower };
