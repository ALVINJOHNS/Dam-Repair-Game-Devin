/*
 * DAM DEFENDER — pure game engine (v2, per-crack repair model).
 * No DOM, no canvas, no timers. Deterministic given a seed.
 * Exposed as window.DamGameCore in browsers and module.exports in Node.
 *
 * Model: 5 distinct cracks, each requiring 6 units of cement repair
 * (30 units total). Only unobstructed fire aimed within 24px of an
 * ACTIVE crack's branch repairs that crack — misses and fish-blocked
 * fire repair nothing. Win iff all 5 cracks are sealed before the
 * 60s wall clock expires. Polymer boost doubles repair rate for 5s.
 */
(function (root, factory) {
  var core = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  root.DamGameCore = core;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var WORLD_W = 1600;
  var WORLD_H = 900;
  var TIME_LIMIT = 60;
  var FISH_PENALTY = 10;
  var STRIKE_COOLDOWN = 2.0;
  var FISH_INVULN = 2.0;
  var CRACK_AIM_RADIUS = 24;         // px: aim must be this close to a branch
  var CRACK_COUNT = 5;
  var CRACK_REQUIRED = 6;            // cement units per crack (30 total)
  var REPAIR_RATE = 1;               // units/sec
  var BOOST_RATE = 2;
  var BOOST_DURATION = 5;
  var BOOST_COOLDOWN = 20;
  var SCORE_PER_REPAIR_SEC = 30;
  var SEAL_BONUS = 200;
  var STRIKE_SCORE_COST = 150;
  var GUN_X = WORLD_W / 2;
  var GUN_Y = 750;

  // normalized anchor pattern over the usable dam-wall rect
  var ANCHOR_POS = [
    [0.20, 0.22], [0.80, 0.22], [0.50, 0.48], [0.20, 0.74], [0.80, 0.74]
  ];
  // usable wall rect inside the world (default layout)
  var WALL = { x: 140, y: 170, w: 1320, h: 480 };

  // fish body ellipse (matches renderer: rx 46*scale, ry 20*scale)
  var FISH_RX = 46, FISH_RY = 20;

  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    var abx = bx - ax, aby = by - ay;
    var len2 = abx * abx + aby * aby;
    var t = len2 === 0 ? 0 : ((px - ax) * abx + (py - ay) * aby) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    var cx = ax + abx * t, cy = ay + aby * t;
    var dx = px - cx, dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ---------- cracks ----------

  // Generate deterministic branch OFFSETS relative to the anchor so the
  // geometry can be re-laid-out for portrait/desktop without reseeding.
  function buildCracks(rng) {
    var cracks = [];
    for (var i = 0; i < CRACK_COUNT; i++) {
      var raw = [];
      var nBranch = 2 + Math.floor(rng() * 2);
      for (var b = 0; b < nBranch; b++) {
        var ang = rng() * Math.PI * 2;
        var pts = [[0, 0]];
        var x = 0, y = 0;
        var segs = 4 + Math.floor(rng() * 3);
        for (var s = 0; s < segs; s++) {
          ang += (rng() - 0.5) * 1.4;
          var len = 22 + rng() * 40;
          x += Math.cos(ang) * len;
          y += Math.sin(ang) * len * 0.75;
          pts.push([x, y]);
        }
        raw.push(pts);
      }
      cracks.push({
        id: i,
        raw: raw,
        branches: [],
        anchorX: 0, anchorY: 0,
        repair: 0,
        required: CRACK_REQUIRED,
        sealed: false,
        heat: 0
      });
    }
    return cracks;
  }

  /*
   * Re-position all cracks inside `bounds` ({x,y,w,h}, world coords).
   * Anchors land on the fixed normalized pattern; raw branch offsets are
   * rescaled so branches stay within ~maxR px of the anchor. Preserves
   * id/repair/sealed/heat — pure geometry relayout.
   */
  function layoutCracks(state, bounds) {
    state._bounds = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
    var maxR = Math.max(8, Math.min(120, Math.min(bounds.w, bounds.h) * 0.16));
    for (var i = 0; i < state.cracks.length; i++) {
      var c = state.cracks[i];
      var ax = bounds.x + ANCHOR_POS[i][0] * bounds.w;
      var ay = bounds.y + ANCHOR_POS[i][1] * bounds.h;
      // clamp anchor inside bounds with margin so branches never leave view;
      // margin shrinks for tiny rects so anchors stay distinct
      var m = Math.min(maxR + 14, bounds.w * 0.45, bounds.h * 0.45);
      ax = Math.min(Math.max(ax, bounds.x + m), bounds.x + bounds.w - m);
      ay = Math.min(Math.max(ay, bounds.y + m), bounds.y + bounds.h - m);
      c.anchorX = ax; c.anchorY = ay;
      // measure extent of raw offsets, then scale to fit maxR
      var ext = 0;
      for (var b = 0; b < c.raw.length; b++) {
        for (var p = 0; p < c.raw[b].length; p++) {
          var d = Math.hypot(c.raw[b][p][0], c.raw[b][p][1]);
          if (d > ext) ext = d;
        }
      }
      var k = ext > 0 ? Math.min(1, maxR / ext) : 1;
      c.branches = c.raw.map(function (pts) {
        return pts.map(function (pt) { return [ax + pt[0] * k, ay + pt[1] * k]; });
      });
    }
    return state;
  }

  // Nearest ACTIVE crack within CRACK_AIM_RADIUS of (ax,ay). Skips sealed.
  function crackNear(state, ax, ay) {
    var best = null, bestD = CRACK_AIM_RADIUS;
    for (var i = 0; i < state.cracks.length; i++) {
      var c = state.cracks[i];
      if (c.sealed) continue;
      for (var b = 0; b < c.branches.length; b++) {
        var pts = c.branches[b];
        for (var p = 0; p < pts.length - 1; p++) {
          var d = distToSegment(ax, ay,
            pts[p][0], pts[p][1], pts[p + 1][0], pts[p + 1][1]);
          if (d < bestD) { bestD = d; best = c; }
        }
      }
    }
    return best;
  }

  function crackBBox(c) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var b = 0; b < c.branches.length; b++) {
      for (var p = 0; p < c.branches[b].length; p++) {
        var pt = c.branches[b][p];
        if (pt[0] < x0) x0 = pt[0];
        if (pt[0] > x1) x1 = pt[0];
        if (pt[1] < y0) y0 = pt[1];
        if (pt[1] > y1) y1 = pt[1];
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ---------- fish ----------

  function buildFish(rng) {
    var palette = [
      '#f4a259', '#e76f51', '#8ab17d', '#4d908e', '#f2cc8f', '#577590'
    ];
    var fish = [];
    for (var i = 0; i < 7; i++) {
      var dir = i % 2 === 0 ? 1 : -1;
      var baseY = 190 + rng() * 460;
      fish.push({
        id: i,
        x: rng() * WORLD_W,
        baseY: baseY,
        y: baseY,
        dir: dir,
        speed: (55 + rng() * 70) * dir,
        wobbleAmp: 14 + rng() * 26,
        wobbleFreq: 0.9 + rng() * 1.6,
        wobblePhase: rng() * Math.PI * 2,
        scale: 0.8 + rng() * 0.7,
        color: palette[i % palette.length],
        scatter: 0,
        invulnUntil: -1
      });
    }
    return fish;
  }

  /*
   * Exact fish-body obstruction. The segment gun->aim is transformed into
   * each fish's normalized ellipse space (x/rx, y/ry) where the body is a
   * unit circle; the entry/exit parameters of the ray with the circle come
   * from a quadratic, so angled crossings, tangents, and an aim endpoint
   * inside the body all register. Nearest entry (t>=0) wins.
   */
  function fishOnRay(state) {
    var gx = GUN_X, gy = GUN_Y, ax = state.aimX, ay = state.aimY;
    var dx = ax - gx, dy = ay - gy;
    var best = null, bestT = Infinity;
    for (var i = 0; i < state.fish.length; i++) {
      var f = state.fish[i];
      var rx = FISH_RX * f.scale, ry = FISH_RY * f.scale;
      var ux = dx / rx, uy = dy / ry;
      var vx = (gx - f.x) / rx, vy = (gy - f.y) / ry;
      var a = ux * ux + uy * uy;
      if (a === 0) continue;
      var b = ux * vx + uy * vy;
      var c = vx * vx + vy * vy - 1;
      var disc = b * b - a * c;
      if (disc < 0) continue;                 // no intersection
      var sq = Math.sqrt(disc);
      var t1 = (-b - sq) / a, t2 = (-b + sq) / a;
      if (t2 < 0 || t1 > 1) continue;         // behind gun or past aim
      var te = Math.max(0, t1);
      if (te < bestT) { best = f; bestT = te; }
    }
    return best;
  }

  // ---------- state ----------

  function createGame(options) {
    var opts = options || {};
    var rng = makeRng(opts.seed || 1337);
    var state = {
      _seed: opts.seed || 1337,
      _penaltyTime: 0,
      phase: 'ready',
      elapsed: 0,
      timeLeft: TIME_LIMIT,
      injectTime: 0,             // = sum of crack.repair (cement units, 0-30)
      fireTime: 0,               // attempted firing seconds (incl. blocked)
      onTargetTime: 0,           // seconds on an active crack
      score: 0,
      strikes: 0,
      cooldown: 0,               // strike cooldown
      boostRemaining: 0,
      boostCooldown: 0,
      cracks: buildCracks(rng),
      fish: buildFish(rng),
      aimX: WORLD_W / 2,
      aimY: WORLD_H / 2,
      firing: false,
      lastEvent: null,
      lastStrike: null,
      lastSealed: null
    };
    layoutCracks(state, WALL);
    return state;
  }

  function start(state) {
    if (state.phase === 'ready') state.phase = 'running';
    return state;
  }

  function restart(state) {
    var bounds = state._bounds || WALL;
    var fresh = createGame({ seed: state._seed });
    for (var k in fresh) state[k] = fresh[k];
    if (state._bounds) layoutCracks(state, bounds);
    state.phase = 'running';
    return state;
  }

  function pause(state) {
    if (state.phase === 'running') {
      state.phase = 'paused';
      state.firing = false;
    }
    return state;
  }

  function resume(state) {
    if (state.phase === 'paused') state.phase = 'running';
    return state;
  }

  function activateBoost(state) {
    if (state.phase !== 'running') return false;
    if (state.boostCooldown > 0 || state.boostRemaining > 0) return false;
    state.boostRemaining = BOOST_DURATION;
    state.boostCooldown = BOOST_COOLDOWN;
    return true;
  }

  function accuracy(state) {
    if (state.fireTime <= 0) return 0;
    var a = (state.onTargetTime / state.fireTime) * 100;
    return a < 0 ? 0 : (a > 100 ? 100 : a);
  }

  function sealProgress(state) {
    return Math.min(1, state.injectTime / (CRACK_COUNT * CRACK_REQUIRED));
  }

  function sealedCount(state) {
    var n = 0;
    for (var i = 0; i < state.cracks.length; i++) if (state.cracks[i].sealed) n++;
    return n;
  }

  /*
   * step(state, dtClock, dtSim, input)
   * dtClock: real monotonic seconds — timers, repair accrual, cooldowns.
   *          Uncapped: tab throttling cannot extend the deadline.
   * dtSim:   capped seconds for decorative motion (fish, heat decay).
   * input:   { firing, aimX, aimY } world coords.
   */
  function step(state, dtClock, dtSim, input) {
    state.lastEvent = null;
    if (state.phase !== 'running') return state;
    if (!isFinite(dtClock) || dtClock < 0) dtClock = 0;
    if (!isFinite(dtSim) || dtSim < 0) dtSim = 0;
    if (dtSim > 0.05) dtSim = 0.05;

    state.elapsed += dtClock;
    state.timeLeft = TIME_LIMIT - state.elapsed - state._penaltyTime;
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dtClock);
    if (state.boostCooldown > 0)
      state.boostCooldown = Math.max(0, state.boostCooldown - dtClock);

    var boostAtStart = state.boostRemaining;
    if (state.boostRemaining > 0)
      state.boostRemaining = Math.max(0, state.boostRemaining - dtClock);

    state.aimX = input.aimX;
    state.aimY = input.aimY;
    state.firing = !!input.firing;

    // fish drift (decorative/sim — dtSim)
    for (var i = 0; i < state.fish.length; i++) {
      var f = state.fish[i];
      f.x += (f.speed + f.scatter) * dtSim;
      f.y = f.baseY + Math.sin(state.elapsed * f.wobbleFreq + f.wobblePhase) *
        f.wobbleAmp;
      if (f.scatter !== 0) f.scatter *= Math.pow(0.05, dtSim);
      var margin = 90;
      if (f.speed > 0 && f.x > WORLD_W + margin) f.x = -margin;
      if (f.speed < 0 && f.x < -margin) f.x = WORLD_W + margin;
    }

    if (state.firing && state.timeLeft > 0) {
      state.fireTime += dtClock;              // every attempt counts
      var hitFish = fishOnRay(state);
      if (hitFish) {
        // blocked: no repair. Strike once per cooldown/invuln window —
        // obstruction persists either way.
        var now = state.elapsed;
        if (state.cooldown <= 0 && now >= hitFish.invulnUntil) {
          state.strikes += 1;
          state._penaltyTime += FISH_PENALTY;
          state.timeLeft = TIME_LIMIT - state.elapsed - state._penaltyTime;
          state.score = Math.max(0, state.score - STRIKE_SCORE_COST);
          state.cooldown = STRIKE_COOLDOWN;
          hitFish.invulnUntil = now + FISH_INVULN;
          hitFish.scatter = hitFish.speed > 0 ? 380 : -380;
          state.lastEvent = 'strike';
          state.lastStrike = { fishId: hitFish.id, x: hitFish.x, y: hitFish.y };
        }
      } else {
        var crack = crackNear(state, state.aimX, state.aimY);
        if (crack) {
          state.onTargetTime += dtClock;
          // split the step if boost expires inside it
          var boosted = Math.min(dtClock, boostAtStart);
          var normal = dtClock - boosted;
          var gainSec = boosted * BOOST_RATE + normal * REPAIR_RATE;
          var gain = Math.min(crack.required - crack.repair, gainSec);
          crack.repair += gain;
          state.injectTime += gain;
          state.score += SCORE_PER_REPAIR_SEC * dtClock; // 30 per valid on-target second
          crack.heat = 1;
          if (crack.repair >= crack.required && !crack.sealed) {
            crack.sealed = true;
            state.score += SEAL_BONUS;
            state.lastEvent = 'seal';
            state.lastSealed = { crackId: crack.id, x: crack.anchorX, y: crack.anchorY };
          }
        }
        // aim on empty water / sealed patch: fireTime accrued, nothing repaired
      }
    }

    for (var c = 0; c < state.cracks.length; c++) {
      var cr = state.cracks[c];
      if (cr.heat > 0) cr.heat = Math.max(0, cr.heat - dtSim * 1.5);
    }

    // expiry first — a 0s clock can never become a victory
    if (state.timeLeft <= 0) {
      state.timeLeft = 0;
      state.phase = 'lost';
      state.firing = false;
      state.lastEvent = 'lose';
      return state;
    }
    if (sealedCount(state) === CRACK_COUNT) {
      state.phase = 'won';
      state.firing = false;
      state.lastEvent = 'win';
      return state;
    }
    return state;
  }

  return {
    WORLD_W: WORLD_W,
    WORLD_H: WORLD_H,
    TIME_LIMIT: TIME_LIMIT,
    FISH_PENALTY: FISH_PENALTY,
    STRIKE_COOLDOWN: STRIKE_COOLDOWN,
    FISH_INVULN: FISH_INVULN,
    CRACK_AIM_RADIUS: CRACK_AIM_RADIUS,
    CRACK_COUNT: CRACK_COUNT,
    CRACK_REQUIRED: CRACK_REQUIRED,
    BOOST_DURATION: BOOST_DURATION,
    BOOST_COOLDOWN: BOOST_COOLDOWN,
    REPAIR_RATE: REPAIR_RATE,
    BOOST_RATE: BOOST_RATE,
    GUN_X: GUN_X,
    GUN_Y: GUN_Y,
    WALL: WALL,
    ANCHOR_POS: ANCHOR_POS,
    FISH_RX: FISH_RX,
    FISH_RY: FISH_RY,
    createGame: createGame,
    start: start,
    restart: restart,
    pause: pause,
    resume: resume,
    activateBoost: activateBoost,
    step: step,
    accuracy: accuracy,
    sealProgress: sealProgress,
    sealedCount: sealedCount,
    crackNear: crackNear,
    crackBBox: crackBBox,
    layoutCracks: layoutCracks,
    fishOnRay: fishOnRay,
    distToSegment: distToSegment,
    makeRng: makeRng
  };
});
