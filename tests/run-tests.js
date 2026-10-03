/* Node test runner for game-core.js v2 — no deps.
 * Run: ELECTRON_RUN_AS_NODE=1 Devin.exe tests/run-tests.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'game-core.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e.message)); }
}

function firing(x, y) { return { firing: true, aimX: x, aimY: y }; }
function idle(x, y) { return { firing: false, aimX: x || 800, aimY: y || 450 }; }
function noFish(g) { g.fish = []; }
function run(g, seconds, dt, input) {
  for (let t = 0; t < seconds; t += dt) Core.step(g, dt, Math.min(dt, 0.05), input);
}
function branchPt(c, bi, pi) { return c.branches[bi || 0][pi || 0].slice(); }
function startGame(seed) {
  const g = Core.start(Core.createGame({ seed: seed || 1 }));
  noFish(g);
  return g;
}
function pinFish(g) {
  const f = { id: 0, x: 800, y: 500, baseY: 500, dir: 1, speed: 0, scatter: 0,
    wobbleAmp: 0, wobbleFreq: 1, wobblePhase: 0, scale: 1,
    color: '#fff', invulnUntil: -1 };
  g.fish = [f];
  return f;
}
// aim at the exact center of crack i's first branch midpoint
function crackAim(c) {
  const pts = c.branches[0];
  const mid = pts[Math.floor(pts.length / 2)];
  return mid.slice();
}
// position a fish exactly on the gun->aim segment (t=0.5) so it obstructs
function pinFishOnRay(g, aim) {
  const f = { id: 0,
    x: Core.GUN_X + (aim[0] - Core.GUN_X) * 0.5,
    y: Core.GUN_Y + (aim[1] - Core.GUN_Y) * 0.5,
    baseY: 0, dir: 1, speed: 0, scatter: 0,
    wobbleAmp: 0, wobbleFreq: 1, wobblePhase: 0, scale: 1,
    color: '#fff', invulnUntil: -1 };
  f.baseY = f.y;
  f.pinX = f.x;
  g.fish = [f];
  return f;
}

console.log('game-core v2 tests');

test('initial state: ready, 5 cracks x6u, clean counters', () => {
  const g = Core.createGame({ seed: 1 });
  assert.strictEqual(g.phase, 'ready');
  assert.strictEqual(g.timeLeft, 60);
  assert.strictEqual(g.injectTime, 0);
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.strikes, 0);
  assert.strictEqual(g.cracks.length, 5);
  g.cracks.forEach(c => {
    assert.strictEqual(c.required, 6);
    assert.strictEqual(c.repair, 0);
    assert.strictEqual(c.sealed, false);
  });
  assert.strictEqual(Core.accuracy(g), 0);
  assert.strictEqual(g.boostRemaining, 0);
  assert.strictEqual(g.boostCooldown, 0);
});

test('holding fire on EMPTY WATER for >30s repairs nothing, no win', () => {
  const g = startGame(2);
  run(g, 35, 0.05, firing(800, 850));   // below wall, no crack
  assert.strictEqual(g.injectTime, 0);
  assert.strictEqual(g.phase, 'running'); // timer ~25 left, no victory
  assert(g.fireTime > 30);
});

test('6s on an active crack seals exactly that one; others stay 0; no win', () => {
  const g = startGame(3);
  const c = g.cracks[0];
  const p = crackAim(c);
  run(g, 6.2, 0.05, firing(p[0], p[1]));
  assert.strictEqual(c.sealed, true);
  assert.strictEqual(c.repair, 6);
  g.cracks.forEach(o => { if (o !== c) assert.strictEqual(o.repair, 0); });
  assert.strictEqual(g.phase, 'running');
  assert.strictEqual(Core.sealedCount(g), 1);
});

test('firing a SEALED patch grants no repair or score', () => {
  const g = startGame(4);
  const c = g.cracks[1];
  const p = crackAim(c);
  run(g, 6.2, 0.05, firing(p[0], p[1]));
  assert(c.sealed);
  const score = g.score, inj = g.injectTime;
  run(g, 6, 0.05, firing(p[0], p[1]));  // keep shooting the steel patch
  assert.strictEqual(g.injectTime, inj);
  assert.strictEqual(g.score, score);
  assert.strictEqual(Core.sealedCount(g), 1);
});

test('sealing all 5 distinct cracks wins with exactly 30u', () => {
  const g = startGame(5);
  for (let i = 0; i < 5; i++) {
    const p = crackAim(g.cracks[i]);
    run(g, 6.3, 0.05, firing(p[0], p[1]));
  }
  assert.strictEqual(Core.sealedCount(g), 5);
  assert.strictEqual(g.phase, 'won');
  assert(Math.abs(g.injectTime - 30) < 1e-6, 'injectTime ' + g.injectTime);
});

test('60s of missing loses', () => {
  const g = startGame(6);
  run(g, 61, 0.1, firing(800, 850));
  assert.strictEqual(g.phase, 'lost');
  assert.strictEqual(g.timeLeft, 0);
});

test('fish strike: -10s once per encounter, no repair while blocked (incl. cooldown)', () => {
  const g = startGame(7);
  const p = crackAim(g.cracks[0]);
  const f = pinFishOnRay(g, p);              // fish sits mid-ray to the crack
  g.aimX = p[0]; g.aimY = p[1];
  assert(Core.fishOnRay(g), 'fish on ray sanity check');
  // keep it pinned each step (strike scatters it)
  for (let i = 0; i < 30; i++) {             // first 1.5s: ONE strike
    f.x = f.pinX; f.y = f.baseY; f.scatter = 0;
    Core.step(g, 0.05, 0.05, firing(p[0], p[1]));
  }
  assert.strictEqual(g.strikes, 1);
  assert(Math.abs(g.timeLeft - (60 - 1.5 - 10)) < 0.3, 'timeLeft=' + g.timeLeft);
  assert.strictEqual(g.injectTime, 0);       // blocked, no repair
  assert(g.fireTime > 0);                    // attempts still counted
  // fish still on the line past the 2s cooldown → a NEW strike is legal
  for (let i = 0; i < 30; i++) {
    f.x = f.pinX; f.y = f.baseY; f.scatter = 0;
    Core.step(g, 0.05, 0.05, firing(p[0], p[1]));
  }
  assert.strictEqual(g.strikes, 2);
  assert.strictEqual(g.injectTime, 0);       // obstruction persists incl. cooldown
});

test('fish OUTSIDE the body ellipse does not obstruct', () => {
  const g = startGame(8);
  // fish center 500,500 — aim ray gun(800,750)->(800,300) passes x=800;
  // place fish 120px off-axis: outside 46px half-width ellipse
  g.fish = [{ id: 0, x: 920, y: 500, baseY: 500, dir: 1, speed: 0, scatter: 0,
    wobbleAmp: 0, wobbleFreq: 1, wobblePhase: 0, scale: 1,
    color: '#fff', invulnUntil: -1 }];
  Core.step(g, 0.05, 0.05, firing(800, 300));
  assert.strictEqual(g.strikes, 0);
  assert(!Core.fishOnRay(g));
});

test('exact ellipse: angled crossing, edge graze, endpoint-inside, beyond-aim', () => {
  const g = startGame(81);
  function putFish(x, y, scale) {
    g.fish = [{ id: 0, x: x, y: y, baseY: y, dir: 1, speed: 0, scatter: 0,
      wobbleAmp: 0, wobbleFreq: 1, wobblePhase: 0, scale: scale,
      color: '#fff', invulnUntil: -1 }];
  }
  // angled: ray gun(800,750)->(1400,400) crosses fish at (1100,560)
  putFish(1100, 560, 1);
  g.aimX = 1400; g.aimY = 400;
  assert(Core.fishOnRay(g), 'angled crossing hits');
  // edge graze: fish at 0.95*ry below the horizontal ray
  putFish(900, 750 + 19, 1);
  g.aimX = 1000; g.aimY = 750;
  assert(Core.fishOnRay(g), 'edge graze hits');
  // endpoint inside: aim lands inside the body even though center is further
  putFish(900, 620, 1);
  g.aimX = 900; g.aimY = 605;      // aim inside ellipse, center just beyond
  assert(Core.fishOnRay(g), 'aim endpoint inside body hits');
  // beyond aim: segment never reaches the fish
  putFish(800, 300, 1);
  g.aimX = 800; g.aimY = 400;      // fish 100px past aim, ellipse top at 280
  assert(!Core.fishOnRay(g), 'fish beyond aim does not hit');
  // clearly outside: parallel offset > rx
  putFish(900, 500, 1);
  g.aimX = 800; g.aimY = 300;
  assert(!Core.fishOnRay(g), 'offset fish does not hit');
});

test('nearest ACTIVE crack is selected; sealed cracks skipped', () => {
  const g = startGame(9);
  const c0 = g.cracks[0], c1 = g.cracks[1];
  const p0 = branchPt(c0, 0, Math.floor(c0.branches[0].length / 2));
  const p1 = branchPt(c1, 0, Math.floor(c1.branches[0].length / 2));
  assert.strictEqual(Core.crackNear(g, p0[0], p0[1]).id, c0.id);
  assert.strictEqual(Core.crackNear(g, p1[0], p1[1]).id, c1.id);
  c0.sealed = true;
  assert(Core.crackNear(g, p0[0], p0[1]) === null ||
         Core.crackNear(g, p0[0], p0[1]).id !== c0.id);
});

test('boost doubles repair: 3 boosted seconds seal a 6u crack', () => {
  const g = startGame(10);
  assert.strictEqual(Core.activateBoost(g), true);
  assert.strictEqual(g.boostRemaining, 5);
  const p = crackAim(g.cracks[0]);
  run(g, 3.1, 0.05, firing(p[0], p[1]));
  assert(g.cracks[0].sealed, 'sealed in ~3s at 2x');
  assert.strictEqual(g.boostRemaining <= 5 - 3, true);
});

test('boost mid-step expiry splits correctly', () => {
  const g = startGame(11);
  Core.activateBoost(g);
  g.boostRemaining = 1;            // 1s of boost left
  const p = crackAim(g.cracks[0]);
  Core.step(g, 2.0, 0.05, firing(p[0], p[1]));
  // gain = 1s*2 + 1s*1 = 3 units
  assert(Math.abs(g.cracks[0].repair - 3) < 1e-9,
    'repair=' + g.cracks[0].repair);
  assert.strictEqual(g.boostRemaining, 0);
});

test('boost: no reactivation inside 20s cooldown, works after', () => {
  const g = startGame(12);
  assert.strictEqual(Core.activateBoost(g), true);
  run(g, 5.5, 0.05, idle());       // burn the 5s boost
  assert.strictEqual(g.boostRemaining, 0);
  assert(g.boostCooldown > 0);
  assert.strictEqual(Core.activateBoost(g), false);  // still recharging
  run(g, 15.5, 0.1, idle());       // finish 20s cooldown
  assert.strictEqual(Core.activateBoost(g), true);
});

test('pause freezes clock, boost, and input; resume continues', () => {
  const g = startGame(13);
  Core.activateBoost(g);
  const p = crackAim(g.cracks[0]);
  run(g, 2, 0.05, firing(p[0], p[1]));
  const inj = g.injectTime, tl = g.timeLeft, br = g.boostRemaining;
  Core.pause(g);
  assert.strictEqual(g.firing, false);
  run(g, 5, 0.05, firing(p[0], p[1]));   // no-ops while paused
  assert.strictEqual(g.injectTime, inj);
  assert.strictEqual(g.timeLeft, tl);
  assert.strictEqual(g.boostRemaining, br);
  Core.resume(g);
  run(g, 1, 0.05, firing(p[0], p[1]));
  assert(g.injectTime > inj);
});

test('restart clears patches, boost, counters', () => {
  const g = startGame(14);
  const p = crackAim(g.cracks[0]);
  run(g, 6.2, 0.05, firing(p[0], p[1]));
  Core.activateBoost(g);
  Core.restart(g);
  assert.strictEqual(g.phase, 'running');
  assert.strictEqual(g.injectTime, 0);
  assert.strictEqual(g.score, 0);
  assert.strictEqual(g.strikes, 0);
  assert.strictEqual(g.timeLeft, 60);
  assert.strictEqual(g.boostRemaining, 0);
  assert.strictEqual(g.boostCooldown, 0);
  g.cracks.forEach(c => { assert.strictEqual(c.sealed, false); assert.strictEqual(c.repair, 0); });
});

test('timer expiry cannot become a victory', () => {
  const g = startGame(15);
  g.cracks.forEach((c, i) => { if (i < 4) { c.repair = 6; c.sealed = true; } });
  g.injectTime = 24;
  const last = g.cracks[4];
  last.repair = 5.99;
  const p = crackAim(last);
  g.elapsed = 59.99;
  Core.step(g, 0.05, 0.05, firing(p[0], p[1]));
  assert.strictEqual(g.phase, 'lost');
});

test('layoutCracks preserves progress and keeps anchors/branches in bounds', () => {
  const g = startGame(16);
  const p = crackAim(g.cracks[0]);
  run(g, 3, 0.05, firing(p[0], p[1]));
  const repairBefore = g.cracks[0].repair;
  // portrait-like bounds (narrow, tall)
  const bounds = { x: 533, y: 180, w: 534, h: 460 };
  Core.layoutCracks(g, bounds);
  assert.strictEqual(g.cracks[0].repair, repairBefore);
  g.cracks.forEach(c => {
    assert(c.anchorX >= bounds.x && c.anchorX <= bounds.x + bounds.w, 'anchor in x');
    assert(c.anchorY >= bounds.y && c.anchorY <= bounds.y + bounds.h, 'anchor in y');
    c.branches.forEach(br => br.forEach(pt => {
      assert(pt[0] >= bounds.x && pt[0] <= bounds.x + bounds.w,
        'branch x strictly inside bounds: ' + pt[0]);
      assert(pt[1] >= bounds.y && pt[1] <= bounds.y + bounds.h,
        'branch y strictly inside bounds: ' + pt[1]);
    }));
  });
  // distinct anchors, no overlap
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const a = g.cracks[i], b = g.cracks[j];
    assert(Math.hypot(a.anchorX - b.anchorX, a.anchorY - b.anchorY) > 50,
      'anchors separated');
  }
});

test('restart preserves the relaid geometry (_bounds survives)', () => {
  const g = startGame(20);
  const bounds = { x: 533, y: 180, w: 534, h: 460 };
  Core.layoutCracks(g, bounds);
  const anchors = g.cracks.map(c => [c.anchorX, c.anchorY]);
  Core.restart(g);
  g.cracks.forEach((c, i) => {
    assert.strictEqual(c.anchorX, anchors[i][0]);
    assert.strictEqual(c.anchorY, anchors[i][1]);
    assert.strictEqual(c.repair, 0);
    assert.strictEqual(c.sealed, false);
  });
});

test('start only transitions from ready — never revives won/lost', () => {
  const g = startGame(21);
  g.phase = 'lost';
  Core.start(g);
  assert.strictEqual(g.phase, 'lost');
  g.phase = 'won';
  Core.start(g);
  assert.strictEqual(g.phase, 'won');
});

test('accuracy counts ALL attempted fire incl. fish-blocked misses', () => {
  const g = startGame(17);
  const p = crackAim(g.cracks[0]);
  const f = pinFishOnRay(g, p);
  // 2s blocked by fish, then 2s clear on crack
  for (let i = 0; i < 40; i++) { f.x = f.pinX; f.y = f.baseY; f.scatter = 0;
    Core.step(g, 0.05, 0.05, firing(p[0], p[1])); }
  f.x = -200;
  run(g, 2, 0.05, firing(p[0], p[1]));
  const acc = Core.accuracy(g);
  assert(acc > 40 && acc < 60, 'accuracy ~50%, got ' + acc);
});

test('coarse dtClock (throttled tab) uses real wall time', () => {
  const g = startGame(18);
  // 7 steps of 1 real second each on a crack → seals 6u crack
  const p = crackAim(g.cracks[0]);
  for (let i = 0; i < 7; i++) Core.step(g, 1.0, 0.05, firing(p[0], p[1]));
  assert(g.cracks[0].sealed);
  assert(Math.abs(g.elapsed - 7) < 1e-9);
});

test('strike score loss floored at 0; seal bonus +200 applied', () => {
  const g = startGame(19);
  const f = pinFish(g);
  f.x = 800; f.y = 500;
  Core.step(g, 0.05, 0.05, firing(800, 300));
  assert.strictEqual(g.score, 0);
  const p = crackAim(g.cracks[0]);
  f.x = -200;
  run(g, 6.2, 0.05, firing(p[0], p[1]));
  assert(g.cracks[0].sealed);
  assert(g.score >= 200, 'seal bonus + on-target score, got ' + g.score);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
