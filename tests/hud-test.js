/* Focused HUD/layout test — header non-overlap + readable footer sizes
 * at 390/720/900/1440, controls in viewport, stable boost width.
 * Log -> tests/hud-test.log
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:3000/?test=1';
const LOG = path.join(__dirname, 'hud-test.log');
const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function overlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
         a.y < b.y + b.height && b.y < a.y + a.height;
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];

  for (const w of [390, 720, 900, 1440]) {
    const h = w === 390 ? 844 : w === 720 ? 900 : Math.round(w * 0.5625);
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(w + 'px: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(w + 'px console: ' + m.text());
    });
    await page.goto(URL, { waitUntil: 'load' });
    await page.waitForTimeout(500);

    const boxes = await page.evaluate(() => {
      const r = id => {
        const e = document.getElementById(id) ||
                  document.querySelector(id);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      };
      return {
        brand: r('.hud-block.brand'),
        timer: r('.hud-block.timer'),
        controls: r('.hud-block.controls'),
        critical: r('#hud-critical'),
        top: r('#hud-top'), bottom: r('#hud-bottom'),
        w: innerWidth, h: innerHeight
      };
    });
    assert(boxes.brand && boxes.timer && boxes.controls, 'blocks exist at ' + w);
    assert(!overlap(boxes.brand, boxes.timer),
      w + 'px: brand overlaps timer ' + JSON.stringify([boxes.brand, boxes.timer]));
    assert(!overlap(boxes.timer, boxes.controls),
      w + 'px: timer overlaps controls');
    assert(!overlap(boxes.brand, boxes.controls),
      w + 'px: brand overlaps controls');
    // every button fully inside viewport
    for (const id of ['btn-boost', 'btn-mute', 'btn-full', 'btn-pause']) {
      const b = await page.locator('#' + id).boundingBox();
      assert(b, w + 'px: ' + id + ' has box');
      assert(b.x >= -0.5 && b.y >= -0.5 &&
             b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5,
        w + 'px: ' + id + ' out of viewport ' + JSON.stringify(b));
    }
    // footer stats readable
    const sizes = await page.evaluate(() => ({
      label: parseFloat(getComputedStyle(
        document.querySelector('.meter-head .label')).fontSize),
      meterVal: parseFloat(getComputedStyle(
        document.querySelector('.meter-head .mono')).fontSize),
      stat: parseFloat(getComputedStyle(
        document.getElementById('m-score')).fontSize),
      timer: parseFloat(getComputedStyle(
        document.getElementById('hud-timer')).fontSize)
    }));
    const small = w <= 720;
    assert(sizes.label >= (small ? 11 : 12) - 0.1, w + 'px label ' + sizes.label);
    assert(sizes.meterVal >= (small ? 18 : 22) - 0.1, w + 'px meterVal ' + sizes.meterVal);
    assert(sizes.stat >= (small ? 22 : 28) - 0.1, w + 'px stat ' + sizes.stat);
    assert(sizes.timer >= (small ? 38 : 56) - 0.1, w + 'px timer ' + sizes.timer);
    // usable play height
    const playH = boxes.h - boxes.top.height - boxes.bottom.height;
    assert(playH >= (w === 390 ? 480 : 250), w + 'px playH ' + playH);
    // boost width stability across state text
    const bw = await page.evaluate(() => {
      const b = document.getElementById('btn-boost');
      const w1 = b.getBoundingClientRect().width;
      b.textContent = 'RECHARGE 20s';
      const w2 = b.getBoundingClientRect().width;
      b.textContent = 'POLYMER BOOST';
      return { w1, w2 };
    });
    assert(Math.abs(bw.w1 - bw.w2) < 4, w + 'px boost width shift ' + JSON.stringify(bw));
    log(w + 'x' + h + ': no overlap, controls in-bounds, ' +
        'fonts ok (label ' + sizes.label + ', stat ' + sizes.stat +
        ', timer ' + sizes.timer + '), playH ' + playH);
    await ctx.close();
  }

  // mobile: crack labels render + held touch repairs (engine hook confirms)
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true
  });
  mctx.setDefaultTimeout(30000);
  const mp = await mctx.newPage();
  mp.on('pageerror', e => errors.push('mobile: ' + e.message));
  await mp.goto(URL, { waitUntil: 'load' });
  await mp.waitForTimeout(600);
  await mp.tap('#btn-start');
  await mp.waitForTimeout(300);
  const cs = await mp.evaluate(() => window.__damTest.cracks());
  const v = await mp.evaluate(() => {
    const top = document.getElementById('hud-top').offsetHeight;
    const bot = document.getElementById('hud-bottom').offsetHeight;
    const playW = innerWidth, playH = innerHeight - top - bot;
    const s = Math.max(playW / 1600, playH / 900);
    return { s, ox: (playW - 1600 * s) / 2, oy: top + (playH - 900 * s) / 2 };
  });
  const t = cs.find(c => !c.sealed);
  const px = v.ox + t.firstPt[0] * v.s, py = v.oy + t.firstPt[1] * v.s;
  const cdp = await mctx.newCDPSession(mp);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: px, y: py, id: 1 }] });
  await sleep(3500);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const st = await mp.evaluate(() => window.__damTest.state());
  assert(st.inject > 1, 'held touch on breach repairs, got ' + st.inject);
  await mp.screenshot({ path: path.join(__dirname, 'shots', 'mobile-game.png') });
  log('mobile: held touch on breach repaired ' + st.inject.toFixed(1) + 'u');
  await mctx.close();

  await browser.close();
  assert.strictEqual(errors.length, 0, 'errors:\n' + errors.join('\n'));
  log('ALL HUD CHECKS PASSED');
})().catch(e => {
  log('FATAL/FAIL: ' + (e && e.stack || e));
  process.exitCode = 1;
}).finally(() => fs.writeFileSync(LOG, lines.join('\n') + '\n'));
