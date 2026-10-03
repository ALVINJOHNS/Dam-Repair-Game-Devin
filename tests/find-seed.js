// Find a test seed where the steering policy wins with margin.
const Core = require('../game-core.js');
const SPAN = Core.WORLD_W + 180;

function clearance(fish, ax, ay) {
  const gx = Core.GUN_X, gy = Core.GUN_Y;
  const dx = ax - gx, dy = ay - gy, l2 = dx*dx + dy*dy || 1;
  let m = 1e9;
  for (const f of fish) {
    for (let h = 0; h <= 3.2; h += 0.4) {
      let fx = (f.x + f.speed * h + 90) % SPAN;
      if (fx < 0) fx += SPAN;
      fx -= 90;
      let t = ((fx - gx)*dx + (f.baseY - gy)*dy) / l2;
      if (t < 0) t = 0; if (t > 1) continue;
      const cx = gx + dx*t, cy = gy + dy*t;
      const rx = Core.FISH_RX * f.scale, ry = Core.FISH_RY * f.scale;
      const q = Math.hypot((fx - cx)/rx, (fy2(f) - cy)/ry) - 1.0;
      if (q < m) m = q;
    }
  }
  return m;
}
function fy2(f){ return f.baseY; }

function pick(g) {
  let best = null, bd = -1;
  for (const c of g.cracks) {
    if (c.sealed) continue;
    for (const br of c.branches) for (const p of br) {
      const d = clearance(g.fish, p[0], p[1]);
      if (d > bd) { bd = d; best = p; }
    }
  }
  return best && { x: best[0], y: best[1], clear: bd };
}

for (let seed = 1; seed <= 200; seed++) {
  const g = Core.start(Core.createGame({ seed }));
  let overhead = 18; // simulated non-repair phases cost ~18s
  for (let s = 0; s < overhead * 20; s++) Core.step(g, 0.05, 0.05, {firing:false, aimX:800, aimY:450});
  // boost at start
  Core.activateBoost(g);
  let firing = false, aim = {x:800,y:450};
  let i = 0;
  for (; i < 400 && g.phase === 'running'; i++) {
    const p = pick(g);
    firing = p && p.clear > 0.5;
    if (p) aim = {x:p.x, y:p.y};
    // ~5 rAF frames between 250ms polls
    for (let f = 0; f < 5; f++)
      Core.step(g, 0.05, 0.05, {firing, aimX:aim.x, aimY:aim.y});
    if (g.boostCooldown <= 0 && g.boostRemaining <= 0) Core.activateBoost(g);
  }
  if (g.phase === 'won') {
    console.log('seed', seed, 'WIN timeLeft', g.timeLeft.toFixed(1),
      'strikes', g.strikes, 'iter', i);
  }
}
console.log('done');
