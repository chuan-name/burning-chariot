/* 燃烧战车 — 合成音效（不依赖任何外部音频文件） */
(function (RZ) {
  'use strict';

  var ctx = null, master = null, noiseBuf = null, muted = false, chargeOsc = null, chargeGain = null;

  function ensure() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    var len = ctx.sampleRate * 1.2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (muted || !ensure()) return;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.02);
  }

  function noise(dur, vol, filterFrom, filterTo, type) {
    if (muted || !ensure()) return;
    var s = ctx.createBufferSource(); s.buffer = noiseBuf;
    var f = ctx.createBiquadFilter(); f.type = type || 'lowpass';
    f.frequency.setValueAtTime(filterFrom, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, filterTo), ctx.currentTime + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(); s.stop(ctx.currentTime + dur + 0.02);
  }

  RZ.SFX = {
    resume: function () { var c = ensure(); if (c && c.state === 'suspended') c.resume(); },
    setMuted: function (m) { muted = m; if (m) RZ.SFX.stopCharge(); },
    isMuted: function () { return muted; },

    click: function () { tone(660, 0.06, 'square', 0.12); },
    move: function () { noise(0.05, 0.05, 1200, 400); },
    aim: function () { tone(880, 0.03, 'square', 0.05); },

    startCharge: function () {
      if (muted || !ensure() || chargeOsc) return;
      chargeOsc = ctx.createOscillator(); chargeGain = ctx.createGain();
      chargeOsc.type = 'sawtooth';
      chargeOsc.frequency.setValueAtTime(110, ctx.currentTime);
      chargeGain.gain.setValueAtTime(0.09, ctx.currentTime);
      chargeOsc.connect(chargeGain); chargeGain.connect(master);
      chargeOsc.start();
    },
    updateCharge: function (p) {
      if (chargeOsc) chargeOsc.frequency.setTargetAtTime(110 + p * 6.2, ctx.currentTime, 0.03);
    },
    stopCharge: function () {
      if (!chargeOsc) return;
      try {
        chargeGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
        chargeOsc.stop(ctx.currentTime + 0.08);
      } catch (e) { /* 已停止 */ }
      chargeOsc = null; chargeGain = null;
    },

    fire: function () { noise(0.22, 0.34, 2600, 220); tone(150, 0.2, 'triangle', 0.22, 60); },
    explode: function (big) {
      noise(big ? 0.7 : 0.42, big ? 0.5 : 0.34, big ? 1800 : 2400, 90);
      tone(big ? 70 : 100, big ? 0.5 : 0.3, 'sine', big ? 0.4 : 0.26, 34);
    },
    bounce: function () { tone(420, 0.07, 'square', 0.1, 260); },
    thunder: function () { noise(0.9, 0.5, 5000, 120, 'bandpass'); tone(60, 0.7, 'sawtooth', 0.3, 30); },
    hurt: function () { tone(300, 0.16, 'square', 0.16, 120); },
    ko: function () { noise(0.9, 0.42, 1400, 60); tone(180, 0.8, 'sawtooth', 0.24, 40); },
    pickup: function () { tone(660, 0.08, 'square', 0.14); setTimeout(function () { tone(990, 0.12, 'square', 0.14); }, 80); },
    tick: function () { tone(1200, 0.04, 'square', 0.08); },
    turn: function () { tone(520, 0.09, 'triangle', 0.14, 780); },
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () { tone(f, 0.28, 'triangle', 0.2); }, i * 130);
      });
    },
    lose: function () {
      [440, 349, 262].forEach(function (f, i) {
        setTimeout(function () { tone(f, 0.4, 'triangle', 0.2); }, i * 190);
      });
    }
  };
})(window.RZ || (window.RZ = {}));
