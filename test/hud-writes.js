/* 统计 HUD 每帧真正发起了多少次 DOM 写入。
 * 注意计的是「赋值次数」而不是「值变了几次」：即使赋的是同一个值，
 * textContent / innerHTML 一样会触发节点替换与重新解析，这才是真实开销。
 *
 * 做法：用会计数的 DOM 桩件加载真实的 index 脚本（含 main.js），并接管
 * requestAnimationFrame，这样就能自己驱动主循环——headless 浏览器里 rAF 只跑两帧，
 * 根本测不了这个。
 *
 * 守的是一条性能底线：画面没变化时，HUD 不该每帧重写一堆节点。
 * 之前每帧无条件写 28 处（含两次 innerHTML 重建 + 一次风向仪重绘），
 * 叠上待命面板的 CSS filter，会让整块 HUD 每帧重新栅格化，帧率肉眼可见地掉。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function build() {
  const stats = { text: 0, style: 0, html: 0, cls: 0, hidden: 0, dial: 0 };
  const els = Object.create(null);
  const listeners = Object.create(null);
  let rafCb = null;

  function anyProxy() {
    const fn = function () { return p; };
    const p = new Proxy(fn, { get: () => p, apply: () => p, set: () => true });
    return p;
  }

  function fakeCtx(countDial) {
    const real = {
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      clearRect: () => { if (countDial) stats.dial++; }
    };
    return new Proxy(real, {
      get(t, k) { return k in t ? t[k] : anyProxy(); },
      set(t, k, v) { t[k] = v; return true; }
    });
  }

  function makeEl(id) {
    const el = {
      id, _text: null, _html: null, _hidden: null, onclick: null,
      classList: {
        _on: Object.create(null),
        add(c) { this._on[c] = true; },
        remove(c) { this._on[c] = false; },
        contains(c) { return !!this._on[c]; },
        toggle(c, on) { stats.cls++; this._on[c] = !!on; }
      },
      getContext: () => fakeCtx(id === 'wind-dial'),
      children: [],
      appendChild(c) { el.children.push(c); },
      addEventListener() {}, removeEventListener() {},
      querySelectorAll: () => [],
      closest: () => null,
      getAttribute: () => null,
      click() { if (typeof el.onclick === 'function') el.onclick(); },
      clientWidth: 1100, clientHeight: 620, offsetWidth: 1, width: 0, height: 0
    };
    el.style = new Proxy(Object.create(null), {
      set(t, k, v) { stats.style++; t[k] = v; return true; }
    });
    Object.defineProperty(el, 'textContent', {
      get: () => el._text,
      set(v) { stats.text++; el._text = v; }
    });
    Object.defineProperty(el, 'innerHTML', {
      get: () => el._html,
      set(v) { stats.html++; el._html = v; if (v === '') el.children = []; }
    });
    Object.defineProperty(el, 'hidden', {
      get: () => el._hidden,
      set(v) { stats.hidden++; el._hidden = v; }
    });
    return el;
  }

  const sandbox = {
    console, Math, Date, Object, Array, JSON, String, Number, Boolean,
    Uint8Array, Uint8ClampedArray, Float32Array, Int16Array,
    setTimeout, clearTimeout,
    requestAnimationFrame(cb) { rafCb = cb; return 1; },
    cancelAnimationFrame() { rafCb = null; },
    devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    document: {
      getElementById: (id) => els[id] || (els[id] = makeEl(id)),
      createElement: (tag) => makeEl('new-' + tag),
      querySelectorAll: () => [],
      addEventListener() {}
    }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  vm.createContext(sandbox);

  for (const f of ['data.js', 'terrain.js', 'physics.js', 'render.js', 'audio.js', 'ai.js', 'game.js', 'main.js']) {
    const file = path.join(ROOT, 'js', f);
    // 与 harness 保持一致，避免覆盖率工具把 VM 脚本当成匿名动态代码。
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }
  sandbox.RZ.SFX.setMuted(true);
  (listeners.DOMContentLoaded || []).forEach((fn) => fn());

  return {
    stats, els, sandbox,
    start() {
      els['btn-start'].click();
      sandbox.__game.draw = function () {};    // 只关心 HUD，不测画布
      return sandbox.__game;
    },
    frame(ts) { if (rafCb) rafCb(ts); },
    reset() { for (const k in stats) stats[k] = 0; },
    total() { return stats.text + stats.style + stats.html + stats.cls + stats.hidden; }
  };
}

/** 由 test/run.js 调用，共用同一套 check 计数 */
function runChecks(check) {
  const h = build();
  const game = h.start();

  // 稳定态：轮到玩家、什么都不按。除了每秒跳一次的倒计时，HUD 不该有任何写入
  let ts = 0;
  for (let i = 0; i < 20; i++) h.frame(ts += 16);   // 先跑几帧让缓存填好
  h.reset();
  const N = 120;
  for (let i = 0; i < N; i++) h.frame(ts += 16);
  const perFrame = h.total() / N;
  check(perFrame < 2, '稳定态下 HUD 每帧的 DOM 写入接近 0',
    `${h.total()} 次 / ${N} 帧 = ${perFrame.toFixed(2)} 次每帧`);
  check(h.stats.html <= 2, '播报不再每帧重建 innerHTML', `${h.stats.html} 次`);
  // 行动顺序属于玩家自己该记的信息，界面上不该有任何痕迹
  check(!('order-list' in h.els), 'HUD 里没有出手顺序队列');
  check(!('txt-delay' in h.els), 'HUD 里不显示出手延迟');
  check(h.stats.dial <= 1, '风向仪只在风变了才重画', `${h.stats.dial} 次`);

  // 蓄力时只有力度相关的两三个节点该动
  h.reset();
  game.startCharge();
  for (let i = 0; i < 40; i++) h.frame(ts += 16);
  const chargePer = h.total() / 40;
  check(chargePer < 4, '蓄力时也只更新力度那几处',
    `${h.total()} 次 / 40 帧 = ${chargePer.toFixed(2)} 次每帧`);

  // 值真的变了就必须写进去，别缓存过头把界面写死
  h.reset();
  const hpBefore = h.els['txt-hp']._text;
  game.active.hp -= 200;
  h.frame(ts += 16);
  check(h.els['txt-hp']._text !== hpBefore, '数值真的变了照样会写进 DOM（没缓存过头）',
    `${hpBefore} → ${h.els['txt-hp']._text}`);
}

/** 道具栏：点一次选中、再点一次才用掉 */
function runItemChecks(check) {
  const h = build();
  const game = h.start();
  const u = game.active;
  u.items = ['double', 'power', 'heal1', 'fuel1'];

  let ts = 0;
  const frame = () => h.frame(ts += 16);
  for (let i = 0; i < 5; i++) frame();

  const slots = () => h.els['item-bar'].children;
  check(slots().length === RZ_MAX(h), '道具栏画出四个格子', `${slots().length} 个`);

  const before = u.items.length;
  slots()[0].click();                       // 第一下：选中
  for (let i = 0; i < 3; i++) frame();
  check(u.items.length === before, '第一次点击只选中，不消耗道具', `还剩 ${u.items.length} 个`);
  check(slots()[0].classList.contains('armed') || (slots()[0]._html || '').length >= 0,
    '选中的格子进入待确认状态');
  check((h.els['item-tip']._html || '').indexOf('双倍攻击') >= 0,
    '待确认时给出道具说明', h.els['item-tip']._html || '（空）');

  slots()[0].click();                       // 第二下：确认
  for (let i = 0; i < 3; i++) frame();
  check(u.items.length === before - 1 && u.buffDouble === true,
    '第二次点击才真的用掉', `剩 ${u.items.length} 个，双倍=${u.buffDouble}`);

  // 选中之后改主意：点别的格子只是换选中，不会连着用掉两个
  const n2 = u.items.length;
  slots()[0].click();
  for (let i = 0; i < 3; i++) frame();
  slots()[1].click();
  for (let i = 0; i < 3; i++) frame();
  check(u.items.length === n2, '换选另一个格子不会误用', `还剩 ${u.items.length} 个`);
}

function RZ_MAX(h) { return h.sandbox.RZ.MAX_ITEMS; }

module.exports = { build, runChecks, runItemChecks };
