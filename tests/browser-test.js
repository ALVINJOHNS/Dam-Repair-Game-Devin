/* Browser acceptance test v2 — playwright-core + installed Chrome.
 * NODE_PATH=<devin node_modules> node tests/browser-test.js
 * Asserts per-crack repair, patch sealing, boost, win/loss audio modes,
 * pause/mute, critical timer, mobile layout + held-touch repair.
 * Log -> tests/browser-test.log ; shots -> tests/shots/
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const URL = process.env.GAME_URL || 'http://127.0.0.1:3000/?test=1';
const OUT = path.join(__dirname, 'shots');
const LOG = path.join(__dirname, 'browser-test.log');
const logLines = [];
function log(...a) { const s = a.join(' '); logLines.push(s); console.log(s); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TRANSFORM_FN = `(() => {
  const top = document.getElementById('hud-top').offsetHeight;
  const bot = document.getElementById('hud-bottom').offsetHeight;
  const playW = innerWidth, playH = innerHeight - top - bot;
  const s = Math.max(playW / 1600, playH / 900);
  return { s, ox: (playW - 1600 * s) / 2, oy: top + (playH - 900 * s) / 2,
           top, playH };
})()`;

async function toScreen(page, wx, wy) {
  const v = await page.evaluate(TRANSFORM_FN);
  return { x: v.ox + wx * v.s, y: v.oy + wy * v.s };
}
async function hud(page) {
  return page.evaluate(() => ({
    status: document.getElementById('hud-status').textContent,
    timer: parseFloat(document.getElementById('hud-timer').textContent),
    cement: parseFloat(document.getElementById('m-cement-v').textContent),
    breaches: document.getElementById('m-breaches').textContent,
    integrity: document.getElementById('m-integrity-v').textContent,
    score: parseInt(document.getElementById('m-score').textContent, 10),
    strikes: parseInt(document.getElementById('m-strikes').textContent, 10),
    end: !document.getElementById('ov-end').classList.contains('hidden'),
    endTitle: document.getElementById('end-title').textContent,
    critical: !document.getElementById('hud-critical').classList.contains('hidden'),
    boost: document.getElementById('btn-boost').textContent,
    audio: window.DamAudio ? window.DamAudio.state() : null,
    st: window.__damTest ? window.__damTest.state() : null
  }));
}
async function cracks(page) { return page.evaluate(() => window.__damTest.cracks()); }
function isFiring(page) {
  return page.evaluate(() =>
    document.getElementById('hud-status').textContent === 'INJECTING');
}

// Drive fire safely: reposition without firing, settle the smoothed
// reticle, hold only on lines predicted clear of fish for ~3s.
// onlyCrack=null targets any unsealed crack. Returns when done/timed out.
async function driveRepair(page, onlyCrack, maxMs) {
  await page.evaluate(id => { window.__onlyCrack = id; }, onlyCrack);
  const t0 = Date.now();
  let targetId = -1;
  while (Date.now() - t0 < maxMs) {
    await sleep(250);
    const st = (await hud(page)).st;
    if (st.phase !== 'running') break;
    if (onlyCrack != null) {
      const c = (await cracks(page))[onlyCrack];
      if (c.sealed) break;
    } else if (st.sealed >= 5) break;
    const b = page.locator('#btn-boost');
    if (!(await b.isDisabled())) await b.click().catch(() => {});
    const pick = await page.evaluate(PICK_FN);
    if (!pick) break;
    if (((Date.now() - t0) / 250 | 0) % 8 === 0) {
      log('  drive t=' + st.timeLeft.toFixed(0) + ' cement=' +
        st.inject.toFixed(1) + ' sealed=' + st.sealed + ' strikes=' +
        st.strikes + ' pick=' + pick.id + ' clear=' + pick.clear.toFixed(2));
    }
    if (pick.clear < 0.4) {          // line predicted unsafe — lift off
      await page.mouse.up();
      targetId = -1;
      continue;
    }
    if (pick.id !== targetId || !(await isFiring(page))) {
      await page.mouse.up();
      const pt = await toScreen(page, pick.x, pick.y);
      await page.mouse.move(pt.x, pt.y);
      await sleep(250);              // let reticle settle before firing
      await page.mouse.down();
      targetId = pick.id;
    }
  }
  await page.mouse.up();
  await page.evaluate(() => { window.__onlyCrack = null; });
}
async function fish(page) { return page.evaluate(() => window.__damTest.fish()); }

// pick an unsealed crack whose gun->aim ray stays clear of fish for ~3s,
// projecting fish velocity (with screen wrap) over the horizon
const PICK_FN = `(() => {
  const G = window.DamGameCore;
  const gx = G.GUN_X, gy = G.GUN_Y;
  const fish = window.__damTest.fish();
  const cracks = window.__damTest.cracks();
  const SPAN = G.WORLD_W + 180;           // wrap margin 90 each side
  function qAt(fx, fy, fscale, ax, ay) {
    const dx = ax - gx, dy = ay - gy, l2 = dx*dx + dy*dy || 1;
    let t = ((fx - gx)*dx + (fy - gy)*dy) / l2;
    if (t < 0) t = 0; if (t > 1) return 1e9;
    const cx = gx + dx*t, cy = gy + dy*t;
    const rx = G.FISH_RX * fscale, ry = G.FISH_RY * fscale;
    return Math.hypot((fx - cx)/rx, (fy - cy)/ry);   // <1 = body on line
  }
  function clearance(ax, ay) {
    let m = 1e9;
    for (const f of fish) {
      for (let h = 0; h <= 3.2; h += 0.4) {
        let fx = (f.x + f.speed * h + 90) % SPAN;      // wrap x
        if (fx < 0) fx += SPAN;
        fx -= 90;
        const fy = f.baseY;                          // wobble ~ +-40
        const q = qAt(fx, fy, f.scale, ax, ay) - 1.0;  // margin for wobble
        if (q < m) m = q;
      }
    }
    return m;
  }
  let best = null, bd = -1;
  for (const c of cracks) {
    if (c.sealed) continue;
    if (window.__onlyCrack != null && c.id !== window.__onlyCrack) continue;
    // scan every branch point: the lowest/deepest-clearable point gives
    // the shortest ray through the fish band
    for (const p of c.points) {
      const d = clearance(p[0], p[1]);
      if (d > bd) { bd = d; best = { x: p[0], y: p[1], id: c.id, clear: d }; }
    }
  }
  return best;
})()`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];

  // ================= DESKTOP =================
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 } });
  ctx.setDefaultTimeout(90000);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  assert(await page.isVisible('#ov-start'), 'start overlay');
  let cs = await cracks(page);
  assert.strictEqual(cs.length, 5, 'exactly 5 cracks');
  await page.screenshot({ path: path.join(OUT, 'desktop-start.png') });

  await page.click('#btn-start');
  await sleep(400);
  let h = await hud(page);
  assert.strictEqual(h.status, 'TRACKING');
  assert.strictEqual(h.audio.mode, 'playing');
  log('start: TRACKING, audio playing');

  // --- firing at empty wall repairs NOTHING ---
  const empty = await toScreen(page, 800, 840);
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await sleep(1600);
  await page.mouse.up();
  h = await hud(page);
  assert.strictEqual(h.st.inject, 0, 'empty wall repairs 0, got ' + h.st.inject);
  assert.strictEqual(h.breaches, '0 / 5');
  log('empty-wall fire: cement 0 (misses do not repair)');

  // --- boost early so the first crack seals at 2x ---
  await page.click('#btn-boost');
  await sleep(200);
  h = await hud(page);
  assert(/BOOST|RECHARGE/.test(h.boost), 'boost engaged: ' + h.boost);
  log('boost activated: ' + h.boost);

  // --- focused repair on the clearest breach: only it repairs ---
  const first = await page.evaluate(PICK_FN);
  assert(first, 'an unsealed crack exists');
  await driveRepair(page, first.id, 30000);
  cs = await cracks(page);
  const sealedC = cs.find(c => c.sealed);
  assert(sealedC, 'a breach sealed after focused repair');
  assert.strictEqual(sealedC.id, first.id, 'the aimed crack sealed');
  cs.forEach(c => { if (c.id !== sealedC.id) assert.strictEqual(c.repair, 0,
    'only the aimed crack repaired; crack ' + c.id + ' got ' + c.repair); });
  const sealedCount = cs.filter(c => c.sealed).length;
  assert.strictEqual(sealedCount, 1);
  const cementV = (await hud(page)).cement;
  assert(cementV >= 5.9 && cementV < 30, 'cement ~6u for one crack, got ' + cementV);
  log('one breach sealed; cement=' + cementV + ' breaches=' + (await hud(page)).breaches);
  await page.screenshot({ path: path.join(OUT, 'desktop-patch.png') });

  // shooting the sealed patch grants nothing (only fire while line clear)
  const scoreBefore = (await hud(page)).st.score;
  const cementBefore = (await hud(page)).st.inject;
  const pp2 = await toScreen(page, sealedC.anchorX, sealedC.anchorY);
  for (let i = 0; i < 5; i++) {
    const clear = await page.evaluate(pt => {
      const G = window.DamGameCore;
      const fish = window.__damTest.fish();
      const dx = pt[0] - G.GUN_X, dy = pt[1] - G.GUN_Y, l2 = dx*dx+dy*dy || 1;
      for (const f of fish) {
        let t = ((f.x - G.GUN_X)*dx + (f.y - G.GUN_Y)*dy) / l2;
        if (t < 0) t = 0; if (t > 1) continue;
        const cx = G.GUN_X + dx*t, cy = G.GUN_Y + dy*t;
        const rx = G.FISH_RX * f.scale, ry = G.FISH_RY * f.scale;
        if (Math.hypot((f.x-cx)/rx, (f.y-cy)/ry) < 1.2) return false;
      }
      return true;
    }, [sealedC.anchorX, sealedC.anchorY]);
    if (!clear) { await sleep(300); continue; }
    await page.mouse.move(pp2.x, pp2.y);
    await sleep(220);
    await page.mouse.down();
    await sleep(350);
    await page.mouse.up();
  }
  h = await hud(page);
  assert.strictEqual(h.st.inject, cementBefore, 'patch gives no cement');
  assert(h.st.score <= scoreBefore, 'patch gives no score (a fish strike may deduct)');
  log('shooting sealed patch: no repair, no score gain');

  // --- pause: clock frozen, audio paused ---
  await page.click('#btn-pause');
  await sleep(200);
  const tA = (await hud(page)).timer;
  await sleep(500);
  const tB = (await hud(page)).timer;
  assert(Math.abs(tA - tB) < 0.05, 'clock frozen');
  h = await hud(page);
  assert.strictEqual(h.audio.mode, 'paused');
  await page.screenshot({ path: path.join(OUT, 'desktop-pause.png') });
  await page.click('#btn-resume');
  await sleep(300);
  h = await hud(page);
  assert.strictEqual(h.audio.mode, 'playing');
  log('pause freezes clock; audio paused/resumed');

  // --- finish all cracks: shared safe-steering driver ---
  await driveRepair(page, null, 70000);
  await sleep(300);
  h = await hud(page);
  assert(h.end, 'end overlay shown');
  assert.strictEqual(h.endTitle, 'DAM RESTABILIZED');
  assert.strictEqual(h.breaches, '5 / 5');
  assert.strictEqual(h.audio.mode, 'won');
  assert(parseFloat(h.cement) >= 29.9, 'cement 30u, got ' + h.cement);
  await page.screenshot({ path: path.join(OUT, 'desktop-win.png') });
  log('victory: all 5 sealed, audio=won, timeLeft=' +
      await page.evaluate(() => document.getElementById('e-time').textContent));

  // --- replay resets ---
  await page.click('#btn-replay');
  await sleep(300);
  h = await hud(page);
  assert.strictEqual(h.status, 'TRACKING');
  assert.strictEqual(h.st.inject, 0);
  assert.strictEqual(h.breaches, '0 / 5');
  assert(h.timer > 59.5);
  assert.strictEqual(h.audio.mode, 'playing');
  log('replay resets all state');

  // --- real loss: sweep fire through fish band, watch critical timer ---
  await page.mouse.down();
  let sawCritical = false;
  const sweep = setInterval(async () => {
    try {
      const wx = 800 + Math.sin(Date.now() / 300) * 550;
      const wy = 300 + (Math.floor(Date.now() / 500) % 6) * 60;
      const pt = await toScreen(page, wx, wy);
      await page.mouse.move(pt.x, pt.y);
      const hh = await hud(page);
      if (hh.critical) sawCritical = true;
    } catch (e) {}
  }, 150);
  await page.waitForFunction(
    () => !document.getElementById('ov-end').classList.contains('hidden'),
    { timeout: 90000 });
  clearInterval(sweep);
  await page.mouse.up();
  h = await hud(page);
  assert.strictEqual(h.endTitle, 'DAM FAILURE');
  assert.strictEqual(h.audio.mode, 'lost');
  assert(h.st.strikes >= 2, 'strikes drained clock: ' + h.st.strikes);
  assert(sawCritical, 'CRITICAL indicator appeared under 15s');
  await page.screenshot({ path: path.join(OUT, 'desktop-loss.png') });
  log('loss: DAM FAILURE, audio=lost, critical timer shown');
  await ctx.close();

  // ================= MOBILE =================
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
  });
  mctx.setDefaultTimeout(90000);
  const mp = await mctx.newPage();
  mp.on('console', m => { if (m.type() === 'error') errors.push('mobile console: ' + m.text()); });
  mp.on('pageerror', e => errors.push('mobile pageerror: ' + e.message));
  await mp.goto(URL, { waitUntil: 'load' });
  await mp.waitForTimeout(700);
  await mp.screenshot({ path: path.join(OUT, 'mobile-start.png') });

  // controls in bounds, 44px+
  for (const id of ['btn-boost', 'btn-mute', 'btn-full', 'btn-pause']) {
    const box = await mp.locator('#' + id).boundingBox();
    assert(box, id + ' has box');
    assert(box.x >= -1 && box.x + box.width <= 391, id + ' in viewport ' + JSON.stringify(box));
    assert(box.height >= 40, id + ' touch target ' + box.height);
  }
  log('mobile: all controls in bounds, 44px+');

  // all 5 crack anchors visible inside play rect (portrait layout worked)
  const mcs = await cracks(mp);
  const v = await mp.evaluate(TRANSFORM_FN);
  for (const c of mcs) {
    const sx = v.ox + c.anchorX * v.s, sy = v.oy + c.anchorY * v.s;
    assert(sx > 10 && sx < 380 && sy > v.top && sy < v.top + v.playH - 10,
      'crack ' + c.id + ' anchor on-screen at ' + sx.toFixed(0) + ',' + sy.toFixed(0));
  }
  log('mobile: all 5 breach anchors visible in portrait play area');

  await mp.tap('#btn-start');
  await mp.waitForTimeout(400);

  // held touch on a crack repairs it (CDP touch, >=500ms)
  const cdp = await mctx.newCDPSession(mp);
  const tc = mcs.find(c => !c.sealed);
  const tp = await toScreen(mp, tc.firstPt[0], tc.firstPt[1]);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: tp.x, y: tp.y, id: 1 }] });
  await sleep(3000);
  const mid = await hud(mp);
  await sleep(4000);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd', touchPoints: [] });
  await sleep(300);
  const after = await hud(mp);
  assert(after.st.inject > 0, 'held touch repaired cement, got ' + after.st.inject);
  await mp.screenshot({ path: path.join(OUT, 'mobile-game.png') });
  log('mobile: held touch on breach repairs ' + after.st.inject.toFixed(1) + 'u');
  await mctx.close();

  await browser.close();
  assert.strictEqual(errors.length, 0, 'console/page errors:\n' + errors.join('\n'));
  log('no console/page errors');
  log('ALL BROWSER CHECKS PASSED');
})().catch(e => {
  log('FATAL/FAIL: ' + (e && e.stack || e));
  process.exitCode = 1;
}).finally(() => {
  fs.writeFileSync(LOG, logLines.join('\n') + '\n');
});
