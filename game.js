/* DAM DEFENDER — canvas renderer, input, audio wiring (v2 per-crack model). */
(function () {
  'use strict';
  var Core = window.DamGameCore;
  var Audio = window.DamAudio;
  var WW = Core.WORLD_W, WH = Core.WORLD_H;

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    hudTop: $('hud-top'), hudBottom: $('hud-bottom'),
    timer: $('hud-timer'), critical: $('hud-critical'), status: $('hud-status'),
    vignette: $('vignette'),
    integrity: $('m-integrity'), integrityV: $('m-integrity-v'),
    breaches: $('m-breaches'), breachesF: $('m-breaches-f'),
    cement: $('m-cement'), cementV: $('m-cement-v'),
    score: $('m-score'), acc: $('m-acc'), strikes: $('m-strikes'),
    flash: $('flash'),
    ovStart: $('ov-start'), ovPause: $('ov-pause'), ovEnd: $('ov-end'),
    endTitle: $('end-title'), endEyebrow: $('end-eyebrow'),
    eScore: $('e-score'), eAcc: $('e-acc'), eTime: $('e-time'),
    eCement: $('e-cement'), eStrikes: $('e-strikes'),
    btnMute: $('btn-mute'), btnFull: $('btn-full'), btnPause: $('btn-pause'),
    btnBoost: $('btn-boost')
  };

  // ---------- viewport: aspect-COVER inside usable play rect ----------
  var view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0, dpr: 1,
               playX: 0, playY: 0, playW: 0, playH: 0 };
  var game = null; // forward ref — created below

  function visibleWorldRect() {
    var a = toWorld(view.playX, view.playY);
    var b = toWorld(view.playX + view.playW, view.playY + view.playH);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  // Intersect the visible world rect with the usable dam wall, then re-lay
  // the crack anchors so all 5 breaches are reachable even when the cover
  // camera crops the world on portrait screens. Preserves repair progress.
  function relayoutCracks() {
    if (!game) return;
    var vr = visibleWorldRect();
    var W = Core.WALL;
    var x0 = Math.max(vr.x0 + 30, W.x);
    var x1 = Math.min(vr.x1 - 30, W.x + W.w);
    var y0 = Math.max(vr.y0 + 20, W.y);
    var y1 = Math.min(vr.y1 - 20, W.y + W.h);
    if (x1 - x0 < 200) { var mid = (x0 + x1) / 2; x0 = mid - 100; x1 = mid + 100; }
    if (y1 - y0 < 200) { var midy = (y0 + y1) / 2; y0 = midy - 100; y1 = midy + 100; }
    var bounds = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    game._bounds = bounds;
    Core.layoutCracks(game, bounds);
  }

  function computeView() {
    view.dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    var topH = el.hudTop ? el.hudTop.offsetHeight : 0;
    var botH = el.hudBottom ? el.hudBottom.offsetHeight : 0;
    view.playX = 0;
    view.playY = topH;
    view.playW = view.w;
    view.playH = Math.max(1, view.h - topH - botH);
    var s = Math.max(view.playW / WW, view.playH / WH);
    view.scale = s;
    view.ox = view.playX + (view.playW - WW * s) / 2;
    view.oy = view.playY + (view.playH - WH * s) / 2;
    buildDamTexture();
    relayoutCracks();
  }

  function toWorld(clientX, clientY) {
    return {
      x: (clientX - view.ox) / view.scale,
      y: (clientY - view.oy) / view.scale
    };
  }

  window.addEventListener('resize', computeView);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(computeView);
    ro.observe(el.hudTop); ro.observe(el.hudBottom);
  }

  // ---------- concrete dam texture ----------
  var damTex = null;
  function buildDamTexture() {
    var w = Math.max(2, Math.round(WW * view.scale * view.dpr));
    var h = Math.max(2, Math.round(700 * view.scale * view.dpr));
    var t = document.createElement('canvas');
    t.width = w; t.height = h;
    var c = t.getContext('2d');
    c.fillStyle = '#123b32';
    c.fillRect(0, 0, w, h);
    var rng = Core.makeRng(4242);
    var cell = Math.max(6, Math.round(14 * view.scale * view.dpr));
    for (var y = 0; y < h; y += cell) {
      for (var x = 0; x < w; x += cell) {
        var v = rng();
        c.fillStyle = 'rgba(' + (10 + v * 40) + ',' + (55 + v * 30) + ',' +
          (44 + v * 24) + ',' + (0.10 + v * 0.16) + ')';
        c.fillRect(x, y, cell, cell);
      }
    }
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.lineWidth = Math.max(1, 2 * view.scale * view.dpr);
    var gx = w / 8, gy = h / 4;
    for (var i = 1; i < 8; i++) {
      c.beginPath(); c.moveTo(i * gx, 0); c.lineTo(i * gx, h); c.stroke();
    }
    for (var j = 1; j < 4; j++) {
      c.beginPath(); c.moveTo(0, j * gy); c.lineTo(w, j * gy); c.stroke();
    }
    for (var s = 0; s < 30; s++) {
      var sx = rng() * w, sy = rng() * h, sl = (20 + rng() * 90) * view.scale * view.dpr;
      c.fillStyle = 'rgba(20,80,58,' + (0.05 + rng() * 0.1) + ')';
      c.fillRect(sx, sy, Math.max(2, 6 * view.scale * view.dpr), sl);
    }
    damTex = t;
  }

  // ---------- particles ----------
  var MAX_PARTICLES = 260;   // cement stream
  var MAX_SPARKS = 90;       // victory burst
  var MAX_LEAKS = 180;       // decorative breach leaks
  var MAX_SPLASH = 70;       // marine impact cloud
  var particles = [], sparks = [], leaks = [], splash = [];
  var bubbles = [];
  var rng = Core.makeRng(999);

  for (var i = 0; i < 40; i++) {
    bubbles.push({
      x: rng() * WW, y: rng() * WH,
      r: 1.5 + rng() * 4, v: 14 + rng() * 30,
      wob: rng() * Math.PI * 2
    });
  }

  function spawnInjection(gx, gy, ax, ay, dt) {
    var n = Math.min(10, Math.max(2, Math.round(dt * 300)));
    for (var i = 0; i < n; i++) {
      if (particles.length >= MAX_PARTICLES) particles.shift();
      var t = 0.08 + rng() * 0.92;
      var spread = 8 + t * 40;
      particles.push({
        x: gx + (ax - gx) * t + (rng() - 0.5) * spread,
        y: gy + (ay - gy) * t + (rng() - 0.5) * spread,
        vx: (ax - gx) * 0.9 + (rng() - 0.5) * 60,
        vy: (ay - gy) * 0.9 + (rng() - 0.5) * 60 - 30,
        life: 0.35 + rng() * 0.45, max: 0.8,
        r: 2 + rng() * 5
      });
    }
  }

  function spawnSparks() {
    if (reduceMotion) return;
    for (var i = 0; i < MAX_SPARKS; i++) {
      var a = rng() * Math.PI * 2, v = 60 + rng() * 260;
      sparks.push({
        x: WW / 2 + (rng() - 0.5) * 600,
        y: 150 + rng() * 500,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80,
        life: 1 + rng() * 1.4, max: 2.4,
        r: 1.5 + rng() * 3
      });
    }
  }

  // decorative leaks from unsealed breaches — never affect repair
  function spawnLeaks(dt) {
    for (var i = 0; i < game.cracks.length; i++) {
      var c = game.cracks[i];
      if (c.sealed) continue;
      var frac = 1 - c.repair / c.required;
      var rate = frac * 14 * (1 + (game.timeLeft < 15 ? 0.6 : 0));
      if (rng() < rate * dt && leaks.length < MAX_LEAKS) {
        var b = c.branches[(rng() * c.branches.length) | 0];
        var p = b[(rng() * b.length) | 0];
        leaks.push({
          x: p[0], y: p[1],
          vx: (rng() - 0.5) * 30,
          vy: -20 - rng() * 40,
          vz: 60 + rng() * 120,         // toward camera → radius growth
          life: 0.9 + rng() * 0.8, max: 1.7,
          r: 2 + rng() * 4
        });
      }
    }
  }

  function spawnSplash(x, y) {
    for (var i = 0; i < MAX_SPLASH; i++) {
      var a = rng() * Math.PI * 2, v = 30 + rng() * 200;
      splash.push({
        x: x, y: y,
        vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
        life: 0.5 + rng() * 0.9, max: 1.4,
        r: 3 + rng() * 10
      });
    }
  }

  // ---------- input ----------
  var aimTarget = { x: WW / 2, y: WH / 2 };
  var input = { firing: false, aimX: WW / 2, aimY: WH / 2 };
  var pointerDown = false;
  var spaceDown = false;
  var shake = 0;
  var redFlood = 0;
  var flashTimer = 0;

  function clearInputs() {
    pointerDown = false;
    spaceDown = false;
    input.firing = false;
    Audio.setFiring(false);
  }

  function updateFiring() {
    var want = (pointerDown || spaceDown) && game.phase === 'running';
    input.firing = want;
    Audio.setFiring(want);
  }

  function setAimFromPointer(e) {
    var w = toWorld(e.clientX, e.clientY);
    var vr = visibleWorldRect();
    aimTarget.x = Math.min(Math.max(w.x, vr.x0), vr.x1);
    aimTarget.y = Math.min(Math.max(w.y, vr.y0), vr.y1);
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (!e.isPrimary || e.button !== 0) return;
    setAimFromPointer(e);
    if (game.phase !== 'running') return;
    if (document.activeElement && document.activeElement.blur)
      document.activeElement.blur();
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    pointerDown = true;
    updateFiring();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', function (e) {
    if (!e.isPrimary) return;
    setAimFromPointer(e);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (!e.isPrimary || e.button !== 0) return;
    pointerDown = false;
    updateFiring();
  });
  canvas.addEventListener('pointercancel', clearInputs);
  canvas.addEventListener('lostpointercapture', function () {
    pointerDown = false;
    updateFiring();
  });

  function isInteractive(t) {
    return t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' ||
                 t.tagName === 'A' || t.tagName === 'TEXTAREA');
  }

  window.addEventListener('keydown', function (e) {
    if (e.code === 'Space') {
      if (game.phase !== 'running' || isInteractive(e.target)) return;
      spaceDown = true;
      updateFiring();
      e.preventDefault();
      return;
    }
    if (e.code === 'KeyB') {
      if (e.repeat || game.phase !== 'running' || isInteractive(e.target)) return;
      tryBoost();
    }
  });
  window.addEventListener('keyup', function (e) {
    if (e.code === 'Space') { spaceDown = false; updateFiring(); }
  });

  function autoPause() {
    clearInputs();
    if (game.phase === 'running') {
      Core.pause(game);
      Audio.setMode('paused');
      showOverlay('pause');
    }
  }
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) autoPause();
  });

  // ---------- overlays / HUD ----------
  function showOverlay(which) {
    el.ovStart.classList.toggle('hidden', which !== 'start');
    el.ovPause.classList.toggle('hidden', which !== 'pause');
    el.ovEnd.classList.toggle('hidden', which !== 'end');
  }

  function hideFlash() {
    el.flash.classList.add('hidden');
    flashTimer = 0;
  }
  function flashStrike() {
    el.flash.classList.remove('hidden');
    flashTimer = 1.4;
  }

  function tryBoost() {
    if (Core.activateBoost(game)) {
      Audio.init(); Audio.resume(); Audio.blip();
    }
  }

  function endGame() {
    var won = game.phase === 'won';
    clearInputs();
    hideFlash();
    Audio.setMode(won ? 'won' : 'lost');
    el.endTitle.textContent = won ? 'DAM RESTABILIZED' : 'DAM FAILURE';
    el.endTitle.classList.toggle('lost', !won);
    el.endEyebrow.textContent = won ? 'OPERATION COMPLETE' : 'STRUCTURAL BREACH';
    el.eScore.textContent = Math.round(game.score);
    el.eAcc.textContent = Math.round(Core.accuracy(game)) + '%';
    el.eTime.textContent = game.timeLeft.toFixed(1) + 's';
    el.eCement.textContent = game.injectTime.toFixed(1) + 'u';
    el.eStrikes.textContent = game.strikes;
    if (!won) {
      shake = reduceMotion ? 0 : 1;
      redFlood = 1;
    } else {
      spawnSparks();
    }
    showOverlay('end');
  }

  $('btn-start').addEventListener('click', function (e) {
    e.currentTarget.blur();
    Audio.init(); Audio.resume();
    Core.start(game);
    Audio.setMode('playing');
    showOverlay(null);
  });
  $('btn-resume').addEventListener('click', function (e) {
    e.currentTarget.blur();
    Audio.resume();
    Core.resume(game);
    Audio.setMode('playing');
    showOverlay(null);
    lastT = performance.now();
  });
  $('btn-replay').addEventListener('click', function (e) {
    e.currentTarget.blur();
    Audio.init(); Audio.resume();
    Core.restart(game);
    relayoutCracks();
    clearInputs();
    hideFlash();
    particles.length = 0; sparks.length = 0;
    leaks.length = 0; splash.length = 0;
    redFlood = 0; shake = 0;
    Audio.setMode('playing');
    showOverlay(null);
    lastT = performance.now();
  });
  el.btnPause.addEventListener('click', function () {
    if (game.phase === 'running') autoPause();
  });
  el.btnBoost.addEventListener('click', function (e) {
    e.currentTarget.blur();
    if (game.phase === 'running') tryBoost();
  });
  el.btnMute.addEventListener('click', function (e) {
    Audio.init(); Audio.resume();
    Audio.setMuted(!Audio.muted);
    var m = Audio.muted;
    el.btnMute.textContent = m ? 'SND OFF' : 'SND ON';
    el.btnMute.classList.toggle('off', m);
    el.btnMute.setAttribute('aria-pressed', String(m));
  });
  el.btnFull.addEventListener('click', function () {
    var d = document;
    if (!d.fullscreenElement && d.documentElement.requestFullscreen) {
      d.documentElement.requestFullscreen().catch(function () {});
    } else if (d.exitFullscreen) {
      d.exitFullscreen().catch(function () {});
    }
  });

  function refreshHud() {
    var tl = Math.max(0, game.timeLeft);
    el.timer.textContent = tl.toFixed(1);
    var crit = game.phase === 'running' && tl <= 15;
    el.timer.classList.toggle('low', crit);
    el.critical.classList.toggle('hidden', !crit);
    el.vignette.classList.toggle('hidden', !crit);

    var integrity = 35 + 65 * (game.injectTime / (Core.CRACK_COUNT * Core.CRACK_REQUIRED));
    el.integrity.style.width = integrity.toFixed(1) + '%';
    el.integrityV.textContent = Math.round(integrity) + '%';

    var sealed = Core.sealedCount(game);
    el.breaches.textContent = sealed + ' / ' + Core.CRACK_COUNT;
    el.breachesF.style.width = (sealed / Core.CRACK_COUNT * 100) + '%';
    el.cement.style.width = (game.injectTime / 30 * 100).toFixed(1) + '%';
    el.cementV.textContent = game.injectTime.toFixed(1) + ' / 30u';
    el.score.textContent = Math.round(game.score);
    el.acc.textContent = Math.round(Core.accuracy(game)) + '%';
    el.strikes.textContent = game.strikes;

    // boost button state
    if (game.boostRemaining > 0) {
      el.btnBoost.textContent = 'BOOST ' + game.boostRemaining.toFixed(1) + 's';
      el.btnBoost.classList.add('active');
      el.btnBoost.disabled = true;
      el.btnBoost.setAttribute('aria-pressed', 'true');
    } else if (game.boostCooldown > 0) {
      el.btnBoost.textContent = 'RECHARGE ' + Math.ceil(game.boostCooldown) + 's';
      el.btnBoost.classList.remove('active');
      el.btnBoost.disabled = true;
      el.btnBoost.setAttribute('aria-pressed', 'false');
    } else {
      el.btnBoost.textContent = 'POLYMER BOOST';
      el.btnBoost.classList.remove('active');
      el.btnBoost.disabled = game.phase !== 'running';
      el.btnBoost.setAttribute('aria-pressed', 'false');
    }

    var s = game.phase === 'running'
      ? (input.firing ? 'INJECTING' : 'TRACKING')
      : game.phase.toUpperCase();
    el.status.textContent = s;
    el.status.classList.toggle('firing', s === 'INJECTING');
  }

  // ---------- drawing ----------
  function drawWorld(t) {
    var s = view.scale, ox = view.ox, oy = view.oy;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    var g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, '#0d4a3a');
    g.addColorStop(0.5, '#0a3629');
    g.addColorStop(1, '#051f18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.save();
    ctx.beginPath();
    ctx.rect(view.playX, view.playY, view.playW, view.playH);
    ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.rect(0, 0, WW, WH);
    ctx.clip();

    if (shake > 0 && !reduceMotion) {
      var m = shake * 8;
      ctx.translate((Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
    }

    // caustic light shafts
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < 5; i++) {
      var sx = 120 + i * 320 + Math.sin(t * 0.15 + i * 2) * 60;
      var sw = 60 + Math.sin(t * 0.1 + i) * 20;
      var lg = ctx.createLinearGradient(sx, 0, sx + 160, WH);
      lg.addColorStop(0, 'rgba(180,230,210,0.10)');
      lg.addColorStop(1, 'rgba(180,230,210,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(sx, 0); ctx.lineTo(sx + sw, 0);
      ctx.lineTo(sx + sw + 200, WH); ctx.lineTo(sx + 200, WH);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // dam face
    var damTop = 110, damBot = 740;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(60, damTop); ctx.lineTo(WW - 60, damTop);
    ctx.lineTo(WW - 30, damBot); ctx.lineTo(30, damBot);
    ctx.closePath(); ctx.clip();
    if (damTex) ctx.drawImage(damTex, 0, damTop, WW, damBot - damTop);
    else { ctx.fillStyle = '#123b32'; ctx.fillRect(0, damTop, WW, damBot - damTop); }
    var eg = ctx.createLinearGradient(0, 0, WW, 0);
    eg.addColorStop(0, 'rgba(3,20,15,0.75)');
    eg.addColorStop(0.15, 'rgba(3,20,15,0)');
    eg.addColorStop(0.85, 'rgba(3,20,15,0)');
    eg.addColorStop(1, 'rgba(3,20,15,0.75)');
    ctx.fillStyle = eg;
    ctx.fillRect(0, damTop, WW, damBot - damTop);
    var vg = ctx.createLinearGradient(0, damTop, 0, damBot);
    vg.addColorStop(0, 'rgba(120,200,175,0.12)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, damTop, WW, damBot - damTop);
    ctx.restore();

    ctx.strokeStyle = 'rgba(243,234,216,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(60, damTop); ctx.lineTo(WW - 60, damTop); ctx.stroke();

    // breaches
    var aimed = game.phase === 'running' && !Core.fishOnRay(game)
      ? Core.crackNear(game, input.aimX, input.aimY) : null;
    for (var ci = 0; ci < game.cracks.length; ci++) {
      var c = game.cracks[ci];
      drawCrack(c, t, aimed === c);
    }

    // fish
    for (var fi = 0; fi < game.fish.length; fi++) drawFish(game.fish[fi], t);

    // leaks (decorative)
    for (var li = leaks.length - 1; li >= 0; li--) {
      var lk = leaks[li];
      var la = Math.max(0, lk.life / lk.max);
      var lr = lk.r + (lk.max - lk.life) * lk.vz * 0.06;
      ctx.fillStyle = 'rgba(170,220,235,' + (la * 0.35) + ')';
      ctx.beginPath();
      ctx.arc(lk.x, lk.y, lr, 0, Math.PI * 2);
      ctx.fill();
    }

    // marine-impact splash cloud
    for (var si = splash.length - 1; si >= 0; si--) {
      var sp2 = splash[si];
      var sa2 = Math.max(0, sp2.life / sp2.max);
      ctx.fillStyle = 'rgba(190,225,225,' + (sa2 * 0.4) + ')';
      ctx.beginPath();
      ctx.arc(sp2.x, sp2.y, sp2.r * (2.2 - sa2), 0, Math.PI * 2);
      ctx.fill();
    }

    // cement particles
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      var a = Math.max(0, pt.life / pt.max);
      ctx.fillStyle = 'rgba(200,205,190,' + (a * 0.55) + ')';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r * (1.6 - a * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }

    // victory sparks + ring
    for (var sp = sparks.length - 1; sp >= 0; sp--) {
      var spt = sparks[sp];
      var sa = Math.max(0, spt.life / spt.max);
      ctx.fillStyle = 'rgba(255,190,120,' + (sa * 0.9) + ')';
      ctx.beginPath();
      ctx.arc(spt.x, spt.y, spt.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (game.phase === 'won' && !reduceMotion) {
      var rt = (t * 0.8) % 1;
      ctx.strokeStyle = 'rgba(87,232,200,' + (0.5 * (1 - rt)) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(WW / 2, 420, 80 + rt * 500, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ambient bubbles
    ctx.fillStyle = 'rgba(200,235,220,0.28)';
    for (var bi = 0; bi < bubbles.length; bi++) {
      var bb = bubbles[bi];
      ctx.beginPath();
      ctx.arc(bb.x + Math.sin(t + bb.wob) * 8, bb.y, bb.r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (redFlood > 0) {
      ctx.fillStyle = 'rgba(140,20,15,' + (redFlood * 0.35) + ')';
      ctx.fillRect(0, 0, WW, WH);
      redFlood = Math.max(0, redFlood - 0.002);
    }

    drawGun(t);
    drawReticle(t);
    ctx.restore();
  }

  function drawCrack(c, t, isAimed) {
    var frac = c.repair / c.required;
    if (c.sealed) { drawPatch(c, t); return; }
    var pulse = 0.75 + 0.25 * Math.sin(t * 3 + c.id * 1.7);
    if (isAimed) pulse = Math.min(1.4, pulse + 0.35); // impact glow
    for (var b = 0; b < c.branches.length; b++) {
      var pts = c.branches[b];
      var lens = [], total = 0;
      for (var i = 0; i < pts.length - 1; i++) {
        var d = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
        lens.push(d); total += d;
      }
      var sealedLen = total * frac;
      // unsealed remainder glows
      ctx.save();
      ctx.globalAlpha = (1 - frac) * 0.9 * pulse;
      ctx.strokeStyle = 'rgba(255,122,26,0.35)';
      ctx.lineWidth = 10;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = '#ff7a1a'; ctx.shadowBlur = 26 * pulse;
      tracePartial(pts, lens, sealedLen, total); ctx.stroke();
      ctx.strokeStyle = '#ffd9a8'; ctx.lineWidth = 3; ctx.shadowBlur = 10;
      tracePartial(pts, lens, sealedLen, total); ctx.stroke();
      ctx.restore();
      // packed cement on the sealed portion of THIS crack
      if (sealedLen > 0.5) {
        ctx.save();
        ctx.strokeStyle = '#a9aea4';
        ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        tracePartial(pts, lens, 0, sealedLen); ctx.stroke();
        ctx.strokeStyle = 'rgba(60,64,58,0.8)'; ctx.lineWidth = 2.5;
        tracePartial(pts, lens, 0, sealedLen); ctx.stroke();
        ctx.restore();
      }
    }
    // repair ring + breach label at anchor (legible at mobile scale)
    ctx.save();
    ctx.font = '700 20px Consolas, "SF Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    var pct = Math.round(frac * 100);
    var label = 'BREACH 0' + (c.id + 1) + ' / ' + pct + '%';
    ctx.fillStyle = 'rgba(4,22,17,0.75)';
    var tw = ctx.measureText(label).width + 14;
    ctx.fillRect(c.anchorX - tw / 2, c.anchorY - 98, tw, 26);
    ctx.fillStyle = isAimed ? '#ff7a1a' : 'rgba(87,232,200,0.95)';
    ctx.fillText(label, c.anchorX, c.anchorY - 74);
    ctx.strokeStyle = 'rgba(243,234,216,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c.anchorX, c.anchorY - 46, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = isAimed ? '#ff7a1a' : '#57e8c8';
    ctx.beginPath();
    ctx.arc(c.anchorX, c.anchorY - 46, 13, -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    if (isAimed) {
      ctx.strokeStyle = 'rgba(255,122,26,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.anchorX, c.anchorY, 24 + Math.sin(t * 6) * 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // steel patch over the breach bounding box
  function drawPatch(c, t) {
    var bb = Core.crackBBox(c);
    var pad = 18;
    var x = bb.x - pad, y = bb.y - pad, w = bb.w + pad * 2, h = bb.h + pad * 2;
    ctx.save();
    // plate
    var pg = ctx.createLinearGradient(x, y, x, y + h);
    pg.addColorStop(0, '#3a4442');
    pg.addColorStop(0.5, '#242e2c');
    pg.addColorStop(1, '#171f1d');
    ctx.fillStyle = pg;
    ctx.strokeStyle = '#57e8c8';
    ctx.lineWidth = 3;
    roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.save();
    ctx.shadowColor = '#57e8c8'; ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
    // inner bevel
    ctx.strokeStyle = 'rgba(243,234,216,0.18)';
    ctx.lineWidth = 2;
    roundRect(x + 6, y + 6, w - 12, h - 12, 7);
    ctx.stroke();
    // bolts
    ctx.fillStyle = '#0d1412';
    ctx.strokeStyle = 'rgba(243,234,216,0.4)';
    ctx.lineWidth = 1.5;
    var bx = [x + 14, x + w - 14], by = [y + 14, y + h - 14];
    for (var i = 0; i < 2; i++) for (var j = 0; j < 2; j++) {
      ctx.beginPath(); ctx.arc(bx[i], by[j], 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    // label
    ctx.fillStyle = 'rgba(87,232,200,0.85)';
    ctx.font = '700 12px Consolas, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('SEALED', x + w / 2, y + h / 2);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function tracePartial(pts, lens, from, to) {
    var acc = 0, pen = false;
    ctx.beginPath();
    for (var i = 0; i < pts.length - 1; i++) {
      var segStart = acc, segEnd = acc + lens[i];
      acc = segEnd;
      var s0 = Math.max(segStart, from), s1 = Math.min(segEnd, to);
      if (s1 <= s0) continue;
      var f0 = lens[i] === 0 ? 0 : (s0 - segStart) / lens[i];
      var f1 = lens[i] === 0 ? 1 : (s1 - segStart) / lens[i];
      var x0 = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f0;
      var y0 = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f0;
      var x1 = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f1;
      var y1 = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f1;
      if (!pen) { ctx.moveTo(x0, y0); pen = true; } else ctx.lineTo(x0, y0);
      ctx.lineTo(x1, y1);
    }
  }

  function drawFish(f, t) {
    var sc = f.scale;
    var inv = game.elapsed < f.invulnUntil;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.dir * sc, sc);
    var wob = Math.sin(t * 8 + f.wobblePhase) * 0.25;
    ctx.fillStyle = f.color;
    ctx.save();
    ctx.translate(-42, 0); ctx.rotate(wob);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(-26, -16); ctx.lineTo(-26, 16);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.globalAlpha = inv ? 0.55 : 1;
    // dorsal fin
    ctx.fillStyle = f.color;
    ctx.beginPath();
    ctx.moveTo(-8, -14); ctx.lineTo(8, -26); ctx.lineTo(18, -12);
    ctx.closePath(); ctx.fill();
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, 46, 20, 0, 0, Math.PI * 2);
    ctx.fill();
    // shading: top darker, belly lighter
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(-2, -8, 40, 10, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(243,234,216,0.28)';
    ctx.beginPath();
    ctx.ellipse(4, 8, 32, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    // gill line
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(18, 0, 12, -0.9, 0.9);
    ctx.stroke();
    // eye
    ctx.fillStyle = '#06281f';
    ctx.beginPath(); ctx.arc(26, -5, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(243,234,216,0.7)';
    ctx.beginPath(); ctx.arc(27, -6, 1.3, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawGun(t) {
    var gx = Core.GUN_X, gy = Core.GUN_Y;
    var rot = Math.max(-0.4, Math.min(0.4, (input.aimX - gx) / WW * 0.55));
    var dip = Math.max(0, Math.min(0.3, (input.aimY - gy) / WH * 0.4));
    var firing = input.firing && game.phase === 'running';
    var recoil = firing && !reduceMotion ? Math.sin(t * 60) * 3 : 0;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(rot + dip);
    ctx.translate(0, recoil);
    ctx.fillStyle = '#1c2f28';
    ctx.strokeStyle = 'rgba(243,234,216,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 11, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (firing) {
      ctx.fillStyle = 'rgba(255,122,26,' + (0.5 + Math.sin(t * 40) * 0.2) + ')';
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#0c1714';
    ctx.beginPath();
    ctx.moveTo(-15, 6); ctx.lineTo(15, 6);
    ctx.lineTo(46, 240); ctx.lineTo(-46, 240);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(-18, 34); ctx.lineTo(18, 34);
    ctx.lineTo(21, 46); ctx.lineTo(-21, 46);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-26, 110); ctx.lineTo(26, 110);
    ctx.lineTo(30, 124); ctx.lineTo(-30, 124);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawReticle(t) {
    var ax = input.aimX, ay = input.aimY;
    var onTarget = game.phase === 'running' &&
      Core.crackNear(game, ax, ay) && !Core.fishOnRay(game);
    ctx.save();
    ctx.strokeStyle = onTarget ? '#ff7a1a' : 'rgba(243,234,216,0.85)';
    ctx.lineWidth = 2;
    var r = 14 + (onTarget ? Math.sin(t * 8) * 3 : 0);
    ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax - r - 7, ay); ctx.lineTo(ax - r + 3, ay);
    ctx.moveTo(ax + r - 3, ay); ctx.lineTo(ax + r + 7, ay);
    ctx.moveTo(ax, ay - r - 7); ctx.lineTo(ax, ay - r + 3);
    ctx.moveTo(ax, ay + r - 3); ctx.lineTo(ax, ay + r + 7);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- main loop ----------
  var lastT = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    var dtClock = Math.max(0, (now - lastT) / 1000);
    lastT = now;
    var dtSim = Math.min(dtClock, 0.05);

    var k = 1 - Math.exp(-18 * Math.min(dtClock, 0.1));
    input.aimX += (aimTarget.x - input.aimX) * k;
    input.aimY += (aimTarget.y - input.aimY) * k;

    updateFiring();
    var prevPhase = game.phase;
    Core.step(game, dtClock, dtSim, input);

    if (game.lastEvent === 'strike') {
      flashStrike();
      Audio.thud();
      if (game.lastStrike) spawnSplash(game.lastStrike.x, game.lastStrike.y);
      if (!reduceMotion) shake = Math.max(shake, 0.5);
    }
    if (game.lastEvent === 'seal') Audio.blip();
    if (prevPhase === 'running' &&
        (game.phase === 'won' || game.phase === 'lost')) {
      endGame();
    }

    if (flashTimer > 0) {
      flashTimer -= dtClock;
      if (flashTimer <= 0) hideFlash();
    }

    // particle sims (paused/end → no new spawns)
    var running = game.phase === 'running';
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dtSim; p.y += p.vy * dtSim;
      p.vx *= 0.9; p.vy = p.vy * 0.9 - 40 * dtSim;
      p.life -= dtSim;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var i = sparks.length - 1; i >= 0; i--) {
      var sp = sparks[i];
      sp.x += sp.vx * dtSim; sp.y += sp.vy * dtSim;
      sp.vy += 120 * dtSim; sp.vx *= 0.98;
      sp.life -= dtSim;
      if (sp.life <= 0) sparks.splice(i, 1);
    }
    for (var i = splash.length - 1; i >= 0; i--) {
      var sp2 = splash[i];
      sp2.x += sp2.vx * dtSim; sp2.y += sp2.vy * dtSim;
      sp2.vy -= 30 * dtSim;
      sp2.life -= dtSim;
      if (sp2.life <= 0) splash.splice(i, 1);
    }
    for (var i = leaks.length - 1; i >= 0; i--) {
      var lk = leaks[i];
      lk.x += lk.vx * dtSim; lk.y += lk.vy * dtSim;
      lk.life -= dtSim;
      if (lk.life <= 0) leaks.splice(i, 1);
    }
    if (running) {
      if (input.firing && !Core.fishOnRay(game)) {
        spawnInjection(Core.GUN_X, Core.GUN_Y, input.aimX, input.aimY, dtSim);
      }
      spawnLeaks(dtSim);
    }
    for (var b = 0; b < bubbles.length; b++) {
      var bb = bubbles[b];
      bb.y -= bb.v * (reduceMotion ? 0.3 : 1) * dtSim;
      if (bb.y < -10) { bb.y = WH + 10; bb.x = rng() * WW; }
    }
    if (shake > 0) shake = Math.max(0, shake - dtSim * 1.5);

    drawWorld(now / 1000);
    refreshHud();
  }

  // ---------- init ----------
  var TESTMODE = /[?&]test=1/.test(location.search);
  game = Core.createGame({
    seed: TESTMODE ? 189 : (Math.random() * 1e9) >>> 0
  });

  // read-only test hook, only exposed with ?test=1
  if (TESTMODE) {
    window.__damTest = {
      state: function () {
        return { phase: game.phase, inject: game.injectTime,
                 strikes: game.strikes, timeLeft: game.timeLeft,
                 sealed: Core.sealedCount(game), score: game.score };
      },
      cracks: function () {
        return game.cracks.map(function (c) {
          return { id: c.id, anchorX: c.anchorX, anchorY: c.anchorY,
                   repair: c.repair, sealed: c.sealed,
                   firstPt: c.branches[0][0].slice(),
                   points: c.branches.reduce(function (a, b) {
                     return a.concat(b.map(function (p) { return p.slice(); }));
                   }, []) };
        });
      },
      fish: function () {
        return game.fish.map(function (f) {
          return { x: f.x, y: f.y, baseY: f.baseY, speed: f.speed,
                   scale: f.scale };
        });
      },
      audio: function () { return Audio.state ? Audio.state() : null; }
    };
  }

  computeView();
  showOverlay('start');
  requestAnimationFrame(frame);
})();
