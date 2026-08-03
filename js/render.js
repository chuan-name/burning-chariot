/* 燃烧战车 — 绘制层：背景、战车造型、弹体、粒子特效 */
(function (RZ) {
  'use strict';

  // ================= 粒子 =================
  function Particles() { this.list = []; this.texts = []; }

  Particles.prototype.add = function (p) { if (this.list.length < 1400) this.list.push(p); };

  Particles.prototype.burst = function (x, y, r, colors) {
    var n = Math.min(90, 22 + r | 0);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, s = Math.random() * (r * 0.16) + 1.2;
      this.add({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 0.6,
        life: 22 + Math.random() * 26, max: 48, size: 2 + Math.random() * (r * 0.11),
        c: colors[(Math.random() * colors.length) | 0], grav: 0.10, kind: 'spark'
      });
    }
    for (i = 0; i < n * 0.5; i++) {
      var a2 = Math.random() * Math.PI * 2, s2 = Math.random() * (r * 0.07);
      this.add({
        x: x, y: y, vx: Math.cos(a2) * s2, vy: Math.sin(a2) * s2 - 0.8,
        life: 34 + Math.random() * 40, max: 74, size: r * (0.16 + Math.random() * 0.22),
        c: 'rgba(60,50,45,0.55)', grav: -0.012, kind: 'smoke'
      });
    }
  };

  Particles.prototype.debris = function (x, y, n, color) {
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4, s = 1.5 + Math.random() * 5;
      this.add({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 30 + Math.random() * 30, max: 60, size: 1.5 + Math.random() * 3,
        c: color, grav: 0.22, kind: 'spark'
      });
    }
  };

  Particles.prototype.trailPuff = function (x, y, color) {
    this.add({
      x: x, y: y, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5 - 0.15,
      life: 12 + Math.random() * 12, max: 24, size: 2 + Math.random() * 2.5,
      c: color, grav: -0.005, kind: 'smoke'
    });
  };

  Particles.prototype.text = function (x, y, str, color, big) {
    this.texts.push({ x: x, y: y, s: str, c: color, life: 62, max: 62, big: !!big });
  };

  Particles.prototype.update = function () {
    var l = this.list, j = 0, i;
    for (i = 0; i < l.length; i++) {
      var p = l[i];
      p.vy += p.grav; p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy; p.life--;
      if (p.life > 0) l[j++] = p;
    }
    l.length = j;
    var t = this.texts; j = 0;
    for (i = 0; i < t.length; i++) {
      t[i].y -= 0.62; t[i].life--;
      if (t[i].life > 0) t[j++] = t[i];
    }
    t.length = j;
  };

  Particles.prototype.draw = function (ctx) {
    var l = this.list, i;
    ctx.save();
    for (i = 0; i < l.length; i++) {
      var p = l[i], a = p.life / p.max;
      ctx.globalAlpha = p.kind === 'smoke' ? a * 0.5 : a;
      ctx.fillStyle = p.c;
      if (p.kind === 'smoke') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1.6 - a * 0.6), 0, 6.2832);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
    ctx.restore();
  };

  Particles.prototype.drawTexts = function (ctx) {
    var t = this.texts;
    ctx.save();
    ctx.textAlign = 'center';
    for (var i = 0; i < t.length; i++) {
      var o = t[i], a = Math.min(1, o.life / 30);
      ctx.globalAlpha = a;
      ctx.font = (o.big ? 'bold 26px ' : 'bold 18px ') + RZ.FONT;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(o.s, o.x, o.y);
      ctx.fillStyle = o.c;
      ctx.fillText(o.s, o.x, o.y);
    }
    ctx.restore();
  };

  RZ.Particles = Particles;
  RZ.FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",system-ui,sans-serif';

  // ================= 背景 =================
  function Background(mapDef) {
    this.map = mapDef;
    this.stars = [];
    this.clouds = [];
    this.motes = [];
    var i;
    for (i = 0; i < 160; i++) {
      this.stars.push({ x: Math.random() * RZ.WORLD_W, y: Math.random() * RZ.WORLD_H * 0.8, r: Math.random() * 1.6 + 0.3, p: Math.random() * 6.28 });
    }
    for (i = 0; i < 14; i++) {
      this.clouds.push({ x: Math.random() * RZ.WORLD_W, y: 60 + Math.random() * 420, s: 0.5 + Math.random() * 1.2, v: 0.08 + Math.random() * 0.16 });
    }
    for (i = 0; i < 70; i++) {
      this.motes.push({ x: Math.random() * RZ.WORLD_W, y: Math.random() * RZ.WORLD_H, r: 1 + Math.random() * 2.6, v: 0.25 + Math.random() * 0.7, p: Math.random() * 6.28 });
    }
  }

  Background.prototype.update = function (t) {
    var m = this.map, i;
    if (m.clouds) for (i = 0; i < this.clouds.length; i++) {
      var c = this.clouds[i]; c.x += c.v; if (c.x > RZ.WORLD_W + 200) c.x = -200;
    }
    if (m.bubbles || m.embers) for (i = 0; i < this.motes.length; i++) {
      var o = this.motes[i]; o.y -= o.v; o.x += Math.sin(t * 0.002 + o.p) * 0.3;
      if (o.y < -10) { o.y = RZ.WORLD_H + 10; o.x = Math.random() * RZ.WORLD_W; }
    }
  };

  /** 天空按世界坐标铺满，视差较弱以保持辨识度 */
  Background.prototype.draw = function (ctx, cam, t, night) {
    var m = this.map, W = RZ.WORLD_W, H = RZ.WORLD_H;
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, m.sky[0]); g.addColorStop(0.55, m.sky[1]); g.addColorStop(1, m.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(-400, -400, W + 800, H + 800);

    if (night > 0) {                       // 昼夜变化
      ctx.save();
      ctx.globalAlpha = night * 0.55;
      ctx.fillStyle = '#0a1030';
      ctx.fillRect(-400, -400, W + 800, H + 800);
      ctx.restore();
    }

    var i;
    if (m.stars || night > 0.35) {
      ctx.save();
      for (i = 0; i < this.stars.length; i++) {
        var s = this.stars[i];
        ctx.globalAlpha = (m.stars ? 0.85 : night) * (0.45 + 0.55 * Math.abs(Math.sin(t * 0.001 + s.p)));
        ctx.fillStyle = '#fff';
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.restore();
    }

    if (m.clouds) {
      ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = '#ffffff';
      for (i = 0; i < this.clouds.length; i++) {
        var c = this.clouds[i];
        puffCloud(ctx, c.x, c.y, 60 * c.s);
      }
      ctx.restore();
    }

    if (m.bubbles || m.embers) {
      ctx.save();
      for (i = 0; i < this.motes.length; i++) {
        var o = this.motes[i];
        ctx.globalAlpha = m.embers ? 0.55 : 0.35;
        ctx.fillStyle = m.embers ? '#ff8a3d' : '#bfefff';
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }

    // 远景剪影山脉，给战场一点纵深
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(-400, H);
    for (var x = -400; x <= W + 400; x += 80) {
      ctx.lineTo(x, H * 0.62 + Math.sin(x * 0.0032) * 70 + Math.sin(x * 0.011) * 24);
    }
    ctx.lineTo(W + 400, H); ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  function puffCloud(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, 6.2832);
    ctx.arc(x + r * 0.5, y + r * 0.12, r * 0.4, 0, 6.2832);
    ctx.arc(x - r * 0.55, y + r * 0.15, r * 0.36, 0, 6.2832);
    ctx.arc(x + r * 0.15, y - r * 0.25, r * 0.34, 0, 6.2832);
    ctx.fill();
  }

  RZ.Background = Background;

  // ================= 战车造型 =================
  // 所有造型以「双脚落地点」为原点绘制，朝右；face=-1 时整体镜像。
  var ART = {};

  ART.tank = function (ctx, p, u) {
    // 履带
    ctx.fillStyle = p[3];
    roundRect(ctx, -22, -13, 44, 13, 5); ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    for (var i = -18; i <= 14; i += 8) { ctx.beginPath(); ctx.arc(i, -6, 4.2, 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = p[2];
    for (i = -18; i <= 14; i += 8) { ctx.beginPath(); ctx.arc(i, -6, 1.6, 0, 6.2832); ctx.fill(); }
    // 车身
    ctx.fillStyle = p[0];
    ctx.beginPath();
    ctx.moveTo(-20, -14); ctx.lineTo(18, -14); ctx.lineTo(22, -22); ctx.lineTo(-16, -24); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p[1];
    ctx.fillRect(-16, -19, 32, 3);
    // 炮塔
    ctx.fillStyle = p[0];
    ctx.beginPath(); ctx.ellipse(0, -25, 12, 8, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[2];
    ctx.beginPath(); ctx.arc(-4, -28, 2.4, 0, 6.2832); ctx.fill();
  };

  ART.heavy = function (ctx, p, u) {
    ctx.fillStyle = p[3];
    roundRect(ctx, -26, -15, 52, 15, 4); ctx.fill();
    ctx.fillStyle = '#1b1b1b';
    for (var i = -21; i <= 19; i += 8) { ctx.beginPath(); ctx.arc(i, -7, 5, 0, 6.2832); ctx.fill(); }
    ctx.fillStyle = p[0];
    roundRect(ctx, -22, -28, 44, 15, 4); ctx.fill();
    ctx.fillStyle = p[1];
    roundRect(ctx, -12, -36, 26, 11, 4); ctx.fill();
    ctx.fillStyle = p[2];
    ctx.fillRect(-20, -25, 38, 2.5);
    ctx.beginPath(); ctx.moveTo(14, -36); ctx.lineTo(20, -44); ctx.lineTo(22, -34); ctx.closePath(); ctx.fill();
  };

  ART.mech = function (ctx, p, u) {
    // 双腿
    ctx.strokeStyle = p[3]; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(-12, -12); ctx.lineTo(-4, -20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(13, -12); ctx.lineTo(5, -20); ctx.stroke();
    ctx.fillStyle = p[0];
    roundRect(ctx, -14, -34, 28, 16, 5); ctx.fill();
    ctx.fillStyle = p[1];
    roundRect(ctx, -11, -31, 22, 5, 2); ctx.fill();
    // 头
    ctx.fillStyle = p[0];
    roundRect(ctx, -8, -44, 17, 11, 4); ctx.fill();
    ctx.fillStyle = p[2];
    ctx.fillRect(-4, -41, 11, 3);
    // 肩甲
    ctx.fillStyle = p[1];
    roundRect(ctx, -20, -35, 9, 11, 3); ctx.fill();
    roundRect(ctx, 12, -35, 9, 11, 3); ctx.fill();
  };

  ART.dragon = function (ctx, p, u) {
    ctx.fillStyle = p[1];   // 尾巴
    ctx.beginPath();
    ctx.moveTo(-14, -14); ctx.quadraticCurveTo(-34, -10, -30, -30);
    ctx.quadraticCurveTo(-24, -18, -12, -20); ctx.closePath(); ctx.fill();
    // 翅膀
    ctx.fillStyle = p[2];
    ctx.beginPath();
    ctx.moveTo(-6, -26); ctx.lineTo(-22, -48); ctx.lineTo(-2, -38); ctx.closePath(); ctx.fill();
    // 身体
    ctx.fillStyle = p[0];
    ctx.beginPath(); ctx.ellipse(0, -18, 18, 14, 0, 0, 6.2832); ctx.fill();
    // 脚
    ctx.fillStyle = p[1];
    roundRect(ctx, -12, -8, 9, 8, 3); ctx.fill();
    roundRect(ctx, 4, -8, 9, 8, 3); ctx.fill();
    // 头
    ctx.fillStyle = p[0];
    ctx.beginPath(); ctx.ellipse(14, -30, 12, 10, -0.25, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[2];
    ctx.beginPath(); ctx.moveTo(6, -38); ctx.lineTo(2, -48); ctx.lineTo(12, -40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(18, -33, 2.6, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(19, -33, 1.3, 0, 6.2832); ctx.fill();
  };

  ART.spider = function (ctx, p, u) {
    ctx.strokeStyle = p[1]; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (var i = 0; i < 4; i++) {
      var bx = -12 + i * 8, up = 16 + (i % 2) * 6;
      ctx.beginPath();
      ctx.moveTo(bx, -16);
      ctx.lineTo(bx - 12 + i * 5, -16 - up);
      ctx.lineTo(bx - 20 + i * 7, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx + 4, -16);
      ctx.lineTo(bx + 14 - i * 3, -14 - up);
      ctx.lineTo(bx + 22 - i * 4, 0);
      ctx.stroke();
    }
    ctx.fillStyle = p[0];
    ctx.beginPath(); ctx.ellipse(-4, -20, 16, 12, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[1];
    ctx.beginPath(); ctx.ellipse(-8, -22, 9, 6, 0.3, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[0];
    ctx.beginPath(); ctx.ellipse(12, -22, 9, 8, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath(); ctx.arc(15, -25, 2.2, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(16, -19, 1.8, 0, 6.2832); ctx.fill();
  };

  ART.saucer = function (ctx, p, u, t) {
    var hover = Math.sin(t * 0.004) * 2.5;
    ctx.save(); ctx.translate(0, hover - 6);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.beginPath(); ctx.ellipse(0, 2, 26, 7, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[1];
    ctx.beginPath(); ctx.ellipse(0, -12, 24, 8, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[0];
    ctx.beginPath(); ctx.ellipse(0, -16, 18, 9, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[2];
    ctx.beginPath(); ctx.ellipse(0, -24, 10, 8, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.ellipse(-3, -26, 4, 3, -0.4, 0, 6.2832); ctx.fill();
    ctx.fillStyle = p[2];
    for (var i = -14; i <= 14; i += 7) {
      ctx.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.006 + i));
      ctx.beginPath(); ctx.arc(i, -10, 2, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  };

  /** 只画车体，用于选车界面与图鉴 */
  RZ.drawArt = function (ctx, vehicle, t) {
    (ART[vehicle.art] || ART.tank)(ctx, vehicle.pal, null, t || 0);
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  RZ.roundRect = roundRect;

  /** 画一辆战车（含炮管、状态、血条） */
  RZ.drawUnit = function (ctx, u, t, opts) {
    opts = opts || {};
    var v = u.vehicle, p = v.pal;
    ctx.save();
    ctx.translate(u.x, u.y);

    // 影子 + 阵营光环（2v2 时一眼分清敌我）
    ctx.save();
    ctx.globalAlpha = 0.28; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 0, 22, 5, 0, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = opts.active ? 0.55 : 0.32;
    ctx.strokeStyle = RZ.TEAM_COLORS[u.team];
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(0, 0, 24, 6, 0, 0, 6.2832); ctx.stroke();
    ctx.restore();

    // 炮管压在车体下面，先画
    ctx.save();
    ctx.scale(u.face, 1);
    var barrelA = -u.aim * Math.PI / 180;
    ctx.save();
    ctx.translate(0, -24);
    ctx.rotate(barrelA);
    ctx.fillStyle = p[1];
    roundRect(ctx, 0, -4, 30, 8, 3); ctx.fill();
    ctx.fillStyle = p[2];
    roundRect(ctx, 24, -5, 7, 10, 2); ctx.fill();
    if (u.muzzleFlash > 0) {
      ctx.globalAlpha = Math.min(1, u.muzzleFlash / 8);
      ctx.fillStyle = '#fff3b0';
      ctx.beginPath();
      ctx.moveTo(30, -9); ctx.lineTo(30 + 26 * (u.muzzleFlash / 8), 0); ctx.lineTo(30, 9);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    (ART[v.art] || ART.tank)(ctx, p, u, t);
    ctx.restore();

    if (u.hitFlash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.75, u.hitFlash / 12);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.ellipse(0, -22, 30, 28, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    // 状态：中毒 / 燃烧
    var badge = 0;
    for (var i = 0; i < u.dots.length; i++) {
      ctx.fillStyle = u.dots[i].type === 'poison' ? '#9cff5a' : '#ff7b3d';
      ctx.beginPath();
      ctx.arc(-20 + badge * 9, -54 + Math.sin(t * 0.006 + i) * 2, 3.2, 0, 6.2832);
      ctx.fill();
      badge++;
    }
    if (u.buffPower > 0) {                       // 加强攻击：小闪电
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(-20 + badge * 9, -58); ctx.lineTo(-24 + badge * 9, -50);
      ctx.lineTo(-20 + badge * 9, -50); ctx.lineTo(-23 + badge * 9, -44);
      ctx.lineTo(-15 + badge * 9, -53); ctx.lineTo(-19 + badge * 9, -53);
      ctx.closePath(); ctx.fill();
      badge++;
    }
    if (u.stunned > 0) {                         // 麻痹：紫色星
      ctx.fillStyle = '#b98cff';
      ctx.beginPath(); ctx.arc(-20 + badge * 9, -54, 3.4, 0, 6.2832); ctx.fill();
      badge++;
    }

    // 正在用道具：只亮一个通用标记，不说用的是哪个
    if (u.usedItemFlash > 0) {
      var pulse = 0.55 + 0.45 * Math.sin(t * 0.02);
      ctx.save();
      ctx.globalAlpha = Math.min(1, u.usedItemFlash / 20) * pulse;
      ctx.fillStyle = '#ffe6a8';
      roundRect(ctx, -19, -92, 38, 15, 4); ctx.fill();
      ctx.fillStyle = '#2a1405';
      ctx.font = 'bold 11px ' + RZ.FONT;
      ctx.textAlign = 'center';
      ctx.fillText('道具', 0, -81);
      ctx.restore();
    }

    // 血条与名牌
    var bw = 46, bh = 5, by = -70;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, -bw / 2 - 1, by - 1, bw + 2, bh + 2, 3); ctx.fill();
    var ratio = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = ratio > 0.5 ? '#5ad27a' : ratio > 0.22 ? '#ffcf4a' : '#ff5a5a';
    roundRect(ctx, -bw / 2, by, bw * ratio, bh, 2.5); ctx.fill();

    ctx.font = 'bold 12px ' + RZ.FONT;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(u.name, 0, by - 6);
    ctx.fillStyle = RZ.TEAM_COLORS[u.team];
    ctx.fillText(u.name, 0, by - 6);

    if (opts.active) {                       // 当前操作中的战车
      var bob = Math.sin(t * 0.006) * 3;
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.moveTo(0, by - 24 + bob); ctx.lineTo(-7, by - 34 + bob); ctx.lineTo(7, by - 34 + bob);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  };

  /** 弹体 */
  RZ.drawProjectile = function (ctx, p, t) {
    var s = p.w.shell;
    if (p.trail && p.trail.length > 3) {
      ctx.save();
      ctx.strokeStyle = s.trail; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(p.trail[0], p.trail[1]);
      for (var i = 2; i < p.trail.length; i += 2) ctx.lineTo(p.trail[i], p.trail[i + 1]);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(Math.atan2(p.vy, p.vx));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = s.glow; ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.ellipse(-4, 0, s.r * 2.6, s.r * 1.5, 0, 0, 6.2832); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = s.color;
    ctx.beginPath(); ctx.ellipse(0, 0, s.r * 1.5, s.r, 0, 0, 6.2832); ctx.fill();
    ctx.restore();
  };

  /** 落雷特效 */
  RZ.drawBolt = function (ctx, x, y0, y1, life) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, life / 10);
    ctx.strokeStyle = '#cfe4ff'; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.shadowColor = '#6a9bff'; ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    var steps = 14;
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      ctx.lineTo(x + (Math.random() - 0.5) * 34 * (1 - t), y0 + (y1 - y0) * t);
    }
    ctx.stroke();
    ctx.restore();
  };

  /** 炮口指示线：只表示角度，与力度无关 */
  RZ.drawAimRay = function (ctx, u, color) {
    var a = u.aim * Math.PI / 180;
    var dx = Math.cos(a) * u.face, dy = -Math.sin(a);
    var m = RZ.muzzle(u, 34);
    var len = 132;

    ctx.save();
    // 水平基准线，方便读出仰角
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + u.face * 58, m.y);
    ctx.stroke();

    // 角度圆弧
    ctx.beginPath();
    if (u.face > 0) ctx.arc(m.x, m.y, 42, -a, 0);
    else ctx.arc(m.x, m.y, 42, Math.PI, Math.PI + a, true);
    ctx.stroke();

    // 指向线
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = color || '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x + dx * len, m.y + dy * len);
    ctx.stroke();

    // 箭头
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color || '#ffffff';
    ctx.translate(m.x + dx * (len + 4), m.y + dy * (len + 4));
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.moveTo(9, 0); ctx.lineTo(-5, -5.5); ctx.lineTo(-5, 5.5);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  };

  /** 补给箱 */
  RZ.drawSupply = function (ctx, s, t) {
    ctx.save();
    ctx.translate(s.x, s.y);
    if (!s.landed) {                        // 降落伞
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-9, -12); ctx.lineTo(-13, -26); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(9, -12); ctx.lineTo(13, -26); ctx.stroke();
      ctx.fillStyle = '#f2f2f2';
      ctx.beginPath(); ctx.arc(0, -26, 16, Math.PI, 0); ctx.fill();
      ctx.fillStyle = s.def.color;
      ctx.beginPath(); ctx.arc(0, -26, 16, Math.PI, Math.PI * 1.5); ctx.fill();
    }
    var bob = s.landed ? Math.sin(t * 0.005) * 1.5 : 0;
    ctx.fillStyle = '#c9b28a';
    roundRect(ctx, -11, -22 + bob, 22, 22, 3); ctx.fill();
    ctx.fillStyle = s.def.color;
    ctx.fillRect(-11, -14 + bob, 22, 6);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
    roundRect(ctx, -11, -22 + bob, 22, 22, 3); ctx.stroke();
    ctx.restore();
  };
})(window.RZ || (window.RZ = {}));
