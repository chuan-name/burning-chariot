/* 燃烧战车 — 静态数据：战车、武器、地图
 * Weapon schema (all fields optional except name/fuel/damage/radius):
 *   fuel              开火消耗的燃料，同时决定这一回合的延迟
 *   count/spread      多发弹与散布角
 *   speedMul/gravMul/windMul   弹道系数
 *   digMul            爆炸挖地半径系数
 *   splitAt:'apex'|'time'  分裂时机, splitCount, splitSpread, child
 *   bounce            弹跳次数
 *   pierce            穿地距离(px)
 *   onImpact:'lightning'|'carpet'|'quake'
 *   dot:{type,turns,damage}    持续伤害
 */
(function (RZ) {
  'use strict';

  RZ.MAX_FUEL = 200;          // 燃料上限，全场统一
  RZ.START_FUEL = 22;         // 开局油量：勉强够打一发一号或二号武器 + 挪两步
                              // （奥丁这种二号武器耗油 20 的，一发就见底）
  RZ.DELAY_BASE = 300;        // 出手延迟的固定部分
  RZ.DELAY_PER_FUEL = 5.5;    // 本回合每消耗 1 点燃料追加的延迟

  // ---- 弹体外观预设 --------------------------------------------------
  var SHELL = {
    fire:   { r: 5, color: '#ffcc55', glow: '#ff6a1f', trail: '#ff8a3d' },
    flame:  { r: 6, color: '#ffe08a', glow: '#ff3b1f', trail: '#ff5b2a' },
    dragon: { r: 6, color: '#ff8f6b', glow: '#e02b1d', trail: '#ff5340' },
    egg:    { r: 5, color: '#fff4e0', glow: '#ffb3c7', trail: '#ffd2de' },
    venom:  { r: 5, color: '#c8ff7a', glow: '#4bbf2f', trail: '#8ee05a' },
    wind:   { r: 5, color: '#dff6ff', glow: '#4fc3f7', trail: '#a8e6ff' },
    volt:   { r: 5, color: '#cfe9ff', glow: '#4d7cff', trail: '#8fb8ff' },
    steel:  { r: 6, color: '#e8edf2', glow: '#9fb3c8', trail: '#c3d1de' },
    laser:  { r: 4, color: '#e7d5ff', glow: '#9b5cff', trail: '#c39bff' },
    rune:   { r: 7, color: '#ffe9b0', glow: '#c98b2e', trail: '#e0b25e' },
    beacon: { r: 5, color: '#bff6ff', glow: '#2fd0ff', trail: '#8fe8ff' },
    stun:   { r: 5, color: '#e6d1ff', glow: '#7a3cff', trail: '#b98cff' }
  };

  function w(o) {
    o.fuel = o.fuel || 10;
    o.count = o.count || 1;
    o.spread = o.spread || 0;
    o.speedMul = o.speedMul || 1;
    o.gravMul = o.gravMul || 1;
    o.windMul = o.windMul == null ? 1 : o.windMul;
    o.digMul = o.digMul || 1;
    o.shell = o.shell || SHELL.fire;
    return o;
  }

  // ---- 十辆战车 ------------------------------------------------------
  // hp 血量 / atk 攻击 / def 防御 / climb 爬坡能力
  // moveCost 每移动 1px 的耗油 / regen 每回合结束的基础回油
  // regen 是按各车 w1 耗油反推的：保证「开一炮」对谁都是净赚，差别只在赚多少
  // 燃料上限全场统一 200（见 RZ.MAX_FUEL）：开炮、移动共用这一条槽
  RZ.VEHICLES = [
    {
      id: 'liehuo', name: '烈火', tag: '均衡型',
      desc: '攻击、防御与移动力都很平均，任何地形都能打，新手首选。',
      hp: 860, atk: 100, def: 100, moveCost: 0.09, regen: 15, climb: 11,
      art: 'tank', pal: ['#e2543a', '#8f2618', '#ffb15c', '#2a1410'],
      w1: w({ name: '烈火弹', fuel: 9, damage: 195, radius: 48, shell: SHELL.fire }),
      w2: w({ name: '三连爆', fuel: 14, damage: 92, radius: 36, count: 3, spread: 5, shell: SHELL.fire }),
      ss: w({ name: '焦土怒射', fuel: 112, damage: 330, radius: 78, digMul: 1.25, shell: SHELL.flame,
              dot: { type: 'fire', turns: 2, damage: 42 } })
    },
    {
      id: 'honglong', name: '红龙', tag: '强攻型',
      desc: '拥有超乎想象的攻击力，移动力也非常强，但防御较薄。',
      hp: 780, atk: 128, def: 78, moveCost: 0.07, regen: 18, climb: 13,
      art: 'dragon', pal: ['#d92b2b', '#7a1010', '#ffd166', '#2a0a0a'],
      w1: w({ name: '龙焰弹', fuel: 12, damage: 215, radius: 46, speedMul: 1.06, shell: SHELL.dragon }),
      w2: w({ name: '双头龙', fuel: 18, damage: 128, radius: 40, count: 2, spread: 4, shell: SHELL.dragon }),
      ss: w({ name: '灭世龙息', fuel: 128, damage: 400, radius: 92, digMul: 1.3, shell: SHELL.flame,
              dot: { type: 'fire', turns: 3, damage: 48 } })
    },
    {
      id: 'tiejingang', name: '铁金刚', tag: '精准型',
      desc: '燃料消耗率最优，回合延迟短；必杀「电击锤」范围小，需要精确瞄准。',
      hp: 920, atk: 98, def: 118, moveCost: 0.065, regen: 14, climb: 12,
      art: 'mech', pal: ['#5b7fa6', '#243a52', '#ffd166', '#101d2a'],
      w1: w({ name: '铁拳弹', fuel: 6, damage: 180, radius: 44, shell: SHELL.steel }),
      w2: w({ name: '跳弹锤', fuel: 9, damage: 150, radius: 42, bounce: 2, shell: SHELL.steel }),
      ss: w({ name: '电击锤', fuel: 126, damage: 470, radius: 34, digMul: 1.6, shell: SHELL.volt,
              onImpact: 'lightning' })
    },
    {
      id: 'beibeilong', name: '贝贝龙', tag: '连射型',
      desc: '单发威力不高，却能撒出成片的龙蛋，最擅长打乱敌人的阵脚。',
      hp: 800, atk: 92, def: 105, moveCost: 0.09, regen: 14, climb: 11,
      art: 'dragon', pal: ['#f2a0c0', '#b05077', '#fff3d0', '#3a1526'],
      w1: w({ name: '龙蛋', fuel: 8, damage: 168, radius: 46, gravMul: 0.92, shell: SHELL.egg }),
      w2: w({ name: '散蛋雨', fuel: 12, damage: 62, radius: 30, count: 5, spread: 7, shell: SHELL.egg }),
      ss: w({ name: '万蛋齐发', fuel: 108, damage: 96, radius: 40, shell: SHELL.egg,
              onImpact: 'carpet', carpet: { count: 7, spacing: 62, damage: 78, radius: 38 } })
    },
    {
      id: 'duzhizhu', name: '毒蜘蛛', tag: '毒伤型',
      desc: '爬坡如履平地，毒液命中后会持续侵蚀敌人的装甲。',
      hp: 810, atk: 96, def: 96, moveCost: 0.085, regen: 13, climb: 20,
      art: 'spider', pal: ['#7bbf3a', '#2f5a17', '#d8ff8f', '#10200a'],
      w1: w({ name: '毒液弹', fuel: 8, damage: 172, radius: 46, shell: SHELL.venom,
              dot: { type: 'poison', turns: 2, damage: 30 } }),
      w2: w({ name: '腐蚀三射', fuel: 11, damage: 84, radius: 34, count: 3, spread: 6, shell: SHELL.venom,
              dot: { type: 'poison', turns: 1, damage: 24 } }),
      ss: w({ name: '剧毒之网', fuel: 115, damage: 250, radius: 96, digMul: 0.7, shell: SHELL.venom,
              dot: { type: 'poison', turns: 4, damage: 55 } })
    },
    {
      id: 'xuanfeng', name: '旋风', tag: '远程型',
      desc: '轻巧的浮空战车，弹速快、射程略胜一筹，但也最容易被风带偏。',
      hp: 760, atk: 104, def: 88, moveCost: 0.07, regen: 14, climb: 14,
      art: 'saucer', pal: ['#5ad2e8', '#1d6b7d', '#e8fbff', '#08222a'],
      w1: w({ name: '气旋弹', fuel: 8, damage: 178, radius: 44, speedMul: 1.14, gravMul: 1.13, windMul: 1.6, shell: SHELL.wind }),
      w2: w({ name: '穿地钻', fuel: 13, damage: 182, radius: 50, pierce: 24, digMul: 1.5, windMul: 1.2, shell: SHELL.wind }),
      ss: w({ name: '龙卷风暴', fuel: 114, damage: 118, radius: 52, count: 4, spread: 3,
              windMul: 1.8, speedMul: 1.1, gravMul: 1.06, shell: SHELL.wind })
    },
    {
      id: 'tuoer', name: '托尔', tag: '雷击型',
      desc: '雷神之锤的继承者，炮弹会在最高点分裂，落雷覆盖大片战场。',
      hp: 830, atk: 106, def: 102, moveCost: 0.105, regen: 15, climb: 11,
      art: 'mech', pal: ['#8f7ae6', '#3d2f75', '#ffe07a', '#161031'],
      w1: w({ name: '雷霆弹', fuel: 10, damage: 186, radius: 46, shell: SHELL.volt }),
      w2: w({ name: '裂空雷', fuel: 15, damage: 108, radius: 38, shell: SHELL.volt,
              splitAt: 'apex', splitCount: 3, splitSpread: 16 }),
      ss: w({ name: '神罚之雷', fuel: 124, damage: 300, radius: 56, shell: SHELL.volt,
              onImpact: 'lightning' })
    },
    {
      id: 'chiyan', name: '赤焰', tag: '灼烧型',
      desc: '喷洒的燃油会把地面点燃，站在火里的敌人每回合都在流血。',
      hp: 840, atk: 110, def: 95, moveCost: 0.11, regen: 15, climb: 10,
      art: 'tank', pal: ['#ff7a2f', '#93370d', '#ffe08a', '#2b1206'],
      w1: w({ name: '燃油弹', fuel: 10, damage: 188, radius: 48, shell: SHELL.flame,
              dot: { type: 'fire', turns: 1, damage: 34 } }),
      w2: w({ name: '四散火种', fuel: 14, damage: 76, radius: 34, count: 4, spread: 8, shell: SHELL.flame,
              dot: { type: 'fire', turns: 1, damage: 22 } }),
      ss: w({ name: '烈焰地毯', fuel: 122, damage: 120, radius: 46, shell: SHELL.flame,
              onImpact: 'carpet', carpet: { count: 6, spacing: 74, damage: 104, radius: 44 },
              dot: { type: 'fire', turns: 3, damage: 40 } })
    },
    {
      id: 'landeng', name: '兰登', tag: '直射型',
      desc: '炮弹初速极快，出膛几乎立刻命中，也几乎不受风影响，压低炮口就是一条直线。',
      hp: 790, atk: 112, def: 90, moveCost: 0.1, regen: 16, climb: 11,
      art: 'saucer', pal: ['#b07dff', '#4b2a8a', '#f0e2ff', '#170a2b'],
      w1: w({ name: '能量束', fuel: 11, damage: 190, radius: 44, speedMul: 1.35, gravMul: 1.75, windMul: 0.25, shell: SHELL.laser }),
      w2: w({ name: '双子光矛', fuel: 16, damage: 118, radius: 36, count: 2, spread: 3,
              speedMul: 1.4, gravMul: 1.9, windMul: 0.2, shell: SHELL.laser }),
      ss: w({ name: '轨道炮', fuel: 124, damage: 360, radius: 62, speedMul: 1.5, gravMul: 2.05,
              windMul: 0.1, digMul: 1.3, shell: SHELL.laser })
    },
    {
      id: 'aodin', name: '奥丁', tag: '重装型',
      desc: '装甲与血量全场最厚，炮弹沉重迟缓，一发入魂却慢得让人心焦。',
      hp: 980, atk: 118, def: 128, moveCost: 0.15, regen: 21, climb: 9,
      art: 'heavy', pal: ['#c9a227', '#6b5210', '#fff0b8', '#241a05'],
      w1: w({ name: '重迫击', fuel: 14, damage: 205, radius: 52, gravMul: 1.15, shell: SHELL.rune }),
      w2: w({ name: '裂地三连', fuel: 20, damage: 112, radius: 44, gravMul: 1.1, shell: SHELL.rune,
              splitAt: 'apex', splitCount: 3, splitSpread: 9, digMul: 1.2 }),
      ss: w({ name: '陨石审判', fuel: 132, damage: 340, radius: 84, gravMul: 1.18, digMul: 1.5, shell: SHELL.rune,
              onImpact: 'carpet', carpet: { count: 4, spacing: 96, damage: 130, radius: 56 } })
    }
  ];

  RZ.vehicleById = function (id) {
    for (var i = 0; i < RZ.VEHICLES.length; i++) if (RZ.VEHICLES[i].id === id) return RZ.VEHICLES[i];
    return RZ.VEHICLES[0];
  };

  // ---- 地图 ----------------------------------------------------------
  // gen: 地形生成器名; void: 掉出下边界即阵亡
  RZ.MAPS = [
    {
      id: 'dry', name: '干枯之大地', gen: 'hills', gravity: 0.30, windMax: 12, voidBottom: false,
      sky: ['#f6c98a', '#e08d5a', '#8b4a3c'],
      ground: { top: '#d9a05b', body: '#a9713c', deep: '#6e4423', line: '#f0c98d' },
      haze: 'rgba(255,190,120,0.10)'
    },
    {
      id: 'sea', name: '深海遗迹', gen: 'ruins', gravity: 0.24, windMax: 8, voidBottom: false,
      sky: ['#0d3b52', '#0a2740', '#04131f'],
      ground: { top: '#4a7f74', body: '#2c5551', deep: '#16302f', line: '#7fd6bf' },
      haze: 'rgba(60,180,200,0.14)', bubbles: true
    },
    {
      id: 'sky', name: '天空之城', gen: 'islands', gravity: 0.30, windMax: 16, voidBottom: true,
      sky: ['#bfe6ff', '#7cc0ec', '#3f7fb5'],
      ground: { top: '#c7e8a0', body: '#8f9f6e', deep: '#5d6b49', line: '#eaffd0' },
      haze: 'rgba(255,255,255,0.10)', clouds: true
    },
    {
      id: 'star', name: '浩瀚星空', gen: 'asteroids', gravity: 0.20, windMax: 20, voidBottom: true,
      sky: ['#141a3c', '#0c0f26', '#05060f'],
      ground: { top: '#8e8fb5', body: '#4e5075', deep: '#2a2b45', line: '#cfd2ff' },
      haze: 'rgba(120,140,255,0.10)', stars: true
    },
    {
      id: 'canyon', name: '熔岩峡谷', gen: 'canyon', gravity: 0.32, windMax: 14, voidBottom: false,
      sky: ['#4a1220', '#7a2118', '#c24a16'],
      ground: { top: '#5a3030', body: '#3a1e1e', deep: '#221010', line: '#ff8a4a' },
      haze: 'rgba(255,90,40,0.12)', embers: true
    }
  ];

  RZ.mapById = function (id) {
    for (var i = 0; i < RZ.MAPS.length; i++) if (RZ.MAPS[i].id === id) return RZ.MAPS[i];
    return RZ.MAPS[0];
  };

  // ---- 道具 ----------------------------------------------------------
  // 开火前使用，一回合可以用好几个；endsTurn 的用完立刻交出回合，
  // 所以「先用哪个」本身就是一步棋。
  // kind: 'buff' 叠状态 / 'shot' 换掉这一发炮弹 / 'restore' 回复
  RZ.ITEMS = [
    {
      id: 'double', name: '双倍攻击', short: '双倍', kind: 'buff', color: '#ff7a3d',
      desc: '下一发连打两枚同样的炮弹（对必杀无效）。只在本回合有效，这回合不开炮就白用了。'
    },
    {
      id: 'power', name: '加强攻击', short: '加强', kind: 'buff', color: '#ffb033',
      desc: '三个回合内，下一发伤害 +50%。对必杀同样有效，可以和双倍攻击叠加。'
    },
    {
      id: 'fly', name: '飞行', short: '飞行', kind: 'shot', color: '#2fd0ff',
      desc: '本回合改打定位炮，战车瞬移到落点。飞完不算结束回合，还能继续移动，但不能再开火。'
    },
    {
      id: 'stun', name: '麻痹弹', short: '麻痹', kind: 'shot', color: '#a86bff',
      desc: '本回合改打麻痹弹，命中的敌人三个回合动不了（还能用飞行，也会被地形推着走）。'
    },
    {
      id: 'heal1', name: '小回血', short: '小血', kind: 'restore', color: '#5ad27a',
      desc: '恢复 25% 耐久。'
    },
    {
      id: 'heal2', name: '大回血', short: '大血', kind: 'restore', color: '#2fa35a', endsTurn: true,
      desc: '恢复 50% 耐久，用完立刻结束本回合。'
    },
    {
      id: 'fuel1', name: '小回燃料', short: '小油', kind: 'restore', color: '#ffd166',
      desc: '恢复 20% 燃料。'
    },
    {
      id: 'fuel2', name: '大回燃料', short: '大油', kind: 'restore', color: '#c9962a', endsTurn: true,
      desc: '恢复 40% 燃料，用完立刻结束本回合。'
    },
    {
      id: 'stealth', name: '隐身', short: '隐身', kind: 'buff', color: '#9fb3c8',
      desc: '三个回合内敌人看不见你的车。他们只看得到炮弹轨迹，以及你挨打时跳出来的伤害数字。'
    }
  ];

  RZ.MAX_ITEMS = 4;             // 每辆车最多带 4 个道具

  RZ.itemById = function (id) {
    for (var i = 0; i < RZ.ITEMS.length; i++) if (RZ.ITEMS[i].id === id) return RZ.ITEMS[i];
    return null;
  };

  // 道具专用弹：不管选的是哪把武器，打出来的都是这两枚
  RZ.LOCATOR = w({
    name: '定位炮', fuel: 8, damage: 0, radius: 0, shell: SHELL.beacon,
    locator: true, gravMul: 0.95
  });
  RZ.STUN_SHELL = w({
    name: '麻痹弹', fuel: 10, damage: 55, radius: 54, digMul: 0.35, shell: SHELL.stun,
    stun: 3
  });

  RZ.TEAM_COLORS = ['#ff5f5f', '#4fa8ff'];
  RZ.TEAM_NAMES = ['红队', '蓝队'];
})(window.RZ || (window.RZ = {}));
