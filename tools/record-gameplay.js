/* Gameplay media recorder — playwright-core + installed Chrome.
 * NODE_PATH=<devin node_modules> node tools/record-gameplay.js
 *
 * Records the game canvas to docs/media/gameplay.webm via an in-page
 * MediaRecorder, and dumps downscaled raw RGBA frames to
 * docs/media/frames/ for the animated README preview (see make-apng.js).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const URL = process.env.GAME_URL || 'http://127.0.0.1:3000/?test=1';
const OUT = path.join(__dirname, '..', 'docs', 'media');
const FRAMES = path.join(OUT, 'frames');
const VIDEO_MS = Number(process.env.VIDEO_MS || 45000);   // cap; stops early on win
const PREVIEW_MS = 12000;                               // frames kept for preview
const PREVIEW_W = 420;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TRANSFORM_FN = `(() => {
  const top = document.getElementById('hud-top').offsetHeight;
  const bot = document.getElementById('hud-bottom').offsetHeight;
  const playW = innerWidth, playH = innerHeight - top - bot;
  const s = Math.max(playW / 1600, playH / 900);
  return { s, ox: (playW - 1600 * s) / 2, oy: top + (playH - 900 * s) / 2 };
})()`;
async function toScreen(page, wx, wy) {
  const v = await page.evaluate(TRANSFORM_FN);
  return { x: v.ox + wx * v.s, y: v.oy + wy * v.s };
}

// Same crack picker as tests/browser-test.js — aims where the gun->crack
// ray stays clear of fish for ~3s.
const PICK_FN = `(() => {
  const G = window.DamGameCore;
  const gx = G.GUN_X, gy = G.GUN_Y;
  const fish = window.__damTest.fish();
  const cracks = window.__damTest.cracks();
  const SPAN = G.WORLD_W + 180;
  function qAt(fx, fy, fscale, ax, ay) {
    const dx = ax - gx, dy = ay - gy, l2 = dx*dx + dy*dy || 1;
    let t = ((fx - gx)*dx + (fy - gy)*dy) / l2;
    if (t < 0) t = 0; if (t > 1) return 1e9;
    const cx = gx + dx*t, cy = gy + dy*t;
    const rx = G.FISH_RX * fscale, ry = G.FISH_RY * fscale;
    return Math.hypot((fx - cx)/rx, (fy - cy)/ry);
  }
  function clearance(ax, ay) {
    let m = 1e9;
    for (const f of fish) {
      for (let h = 0; h <= 3.2; h += 0.4) {
        let fx = (f.x + f.speed * h + 90) % SPAN;
        if (fx < 0) fx += SPAN;
        fx -= 90;
        const q = qAt(fx, f.baseY, f.scale, ax, ay) - 1.0;
        if (q < m) m = q;
      }
    }
    return m;
  }
  let best = null, bd = -1;
  for (const c of cracks) {
    if (c.sealed) continue;
    for (const p of c.points) {
      const d = clearance(p[0], p[1]);
      if (d > bd) { bd = d; best = { x: p[0], y: p[1], id: c.id, clear: d }; }
    }
  }
  return best;
})()`;

(async () => {
  fs.mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('pageerror:', e.message));

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'shot-start.png') });

  // ---- in-page recorder: webm video + downscaled raw frames ----
  await page.evaluate(({ previewW, previewMs }) => {
    const src = document.getElementById('game');
    window.__rec = { chunks: [], frames: [], w: 0, h: 0 };
    const stream = src.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find(m => MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    mr.ondataavailable = e => { if (e.data.size) window.__rec.chunks.push(e.data); };
    mr.start(250);
    window.__rec.mr = mr;
    window.__rec.mime = mime;

    const off = document.createElement('canvas');
    off.width = previewW;
    off.height = Math.round(src.height * previewW / src.width);
    const g = off.getContext('2d', { willReadFrequently: true });
    window.__rec.w = off.width; window.__rec.h = off.height;
    const t0 = performance.now();
    window.__rec.timer = setInterval(() => {
      if (performance.now() - t0 > previewMs) return;
      g.drawImage(src, 0, 0, off.width, off.height);
      const d = g.getImageData(0, 0, off.width, off.height).data;
      let bin = '';
      const B = 0x8000;
      for (let i = 0; i < d.length; i += B)
        bin += String.fromCharCode.apply(null, d.subarray(i, i + B));
      window.__rec.frames.push(btoa(bin));
    }, 100);
  }, { previewW: PREVIEW_W, previewMs: PREVIEW_MS });

  await page.click('#btn-start');
  await sleep(400);

  // ---- autopilot: hold fire on the safest breach, boost when ready ----
  const t0 = Date.now();
  let firing = false, phase = 'running';
  while (Date.now() - t0 < VIDEO_MS) {
    await sleep(250);
    const st = await page.evaluate(() => window.__damTest.state());
    phase = st.phase;
    if (phase !== 'running') break;
    const b = page.locator('#btn-boost');
    if (!(await b.isDisabled())) await b.click().catch(() => {});
    const pick = await page.evaluate(PICK_FN);
    if (!pick) break;
    if (pick.clear < 0.4) { await page.mouse.up(); firing = false; continue; }
    const pt = await toScreen(page, pick.x, pick.y);
    await page.mouse.move(pt.x, pt.y, { steps: 6 });
    if (!firing) { await sleep(200); await page.mouse.down(); firing = true; }
  }
  await page.mouse.up();
  await sleep(600);
  console.log('gameplay ended: phase=' + phase,
    'in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  await page.screenshot({ path: path.join(OUT, 'shot-end.png') });

  // ---- pull the webm out of the page ----
  const webmB64 = await page.evaluate(() => new Promise(res => {
    const r = window.__rec;
    clearInterval(r.timer);
    r.mr.onstop = async () => {
      const buf = await new Blob(r.chunks, { type: r.mime }).arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = '';
      const B = 0x8000;
      for (let i = 0; i < bytes.length; i += B)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + B));
      res(btoa(bin));
    };
    r.mr.stop();
  }));
  fs.writeFileSync(path.join(OUT, 'gameplay.webm'), Buffer.from(webmB64, 'base64'));

  // ---- dump preview frames ----
  const rec = await page.evaluate(() =>
    ({ w: window.__rec.w, h: window.__rec.h, frames: window.__rec.frames }));
  rec.frames.forEach((f, i) => fs.writeFileSync(
    path.join(FRAMES, 'f' + String(i).padStart(4, '0') + '.rgba'),
    Buffer.from(f, 'base64')));
  fs.writeFileSync(path.join(FRAMES, 'meta.json'),
    JSON.stringify({ w: rec.w, h: rec.h, fps: 10 }));
  console.log('saved gameplay.webm (' +
    (fs.statSync(path.join(OUT, 'gameplay.webm')).size / 1e6).toFixed(1) +
    ' MB) + ' + rec.frames.length + ' preview frames');

  await browser.close();
})().catch(e => { console.error('FATAL:', e && e.stack || e); process.exitCode = 1; });
