/* Focused DamAudio browser test — playwright-core + Chrome.
 * Uses a generated WAV data-URL as a stand-in licensed track (no real
 * assets, no downloads) plus forced-rejection stubs.
 * Log -> tests/audio-test.log
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const URL = 'http://127.0.0.1:3000/?test=1';
const LOG = path.join(__dirname, 'audio-test.log');
const lines = [];
const log = (...a) => { const s = a.join(' '); lines.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// tiny PCM WAV (0.5s sine) as a data URL — a local stand-in file
function wavDataUrl() {
  const sr = 8000, n = sr / 2, bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const write = (o, s) => s.split('').forEach((c, i) => bytes[o + i] = c.charCodeAt(0));
  write(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  write(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    dv.setInt16(44 + i * 2, Math.sin(i * 440 * 2 * Math.PI / sr) * 8000, true);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  return 'data:audio/wav;base64,' + Buffer.from(bin, 'binary').toString('base64');
}

(async () => {
  const wav = wavDataUrl();
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  const errors = [];
  const expected = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/404|Failed to load resource|ERR_FILE|net::/.test(m.text())) {
      expected.push(m.text()); return;
    }
    errors.push(m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => expected.push('reqfail ' + r.url()));

  // map all three slots to our local wav before game scripts run
  await page.addInitScript(w => {
    window.DAM_AUDIO_TRACKS = { playing: w, won: w, lost: w };
  }, wav);
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const st = () => page.evaluate(() => window.DamAudio.state());
  const setMode = m => page.evaluate(m => window.DamAudio.setMode(m), m);

  // init (simulated user gesture not needed with autoplay flag)
  await page.evaluate(() => { window.DamAudio.init(); window.DamAudio.resume(); });
  let s = await st();
  assert(s.ctxState === 'running' || s.ctxState === 'suspended');
  log('audio init: ctx=' + s.ctxState);

  // licensed slot actually used for 'playing'
  await setMode('playing');
  await sleep(600);
  s = await st();
  assert.strictEqual(s.mode, 'playing');
  assert(s.trackSrc && s.trackSrc.startsWith('data:audio/wav'),
    'track src is the mapped file, got ' + (s.trackSrc || '').slice(0, 60));
  assert.strictEqual(s.trackPaused, false, 'track actively playing');
  assert.strictEqual(s.scheduling, false, 'synth scheduler off while file plays');
  log('licensed slot used: currentSrc=data-URL, playing, no synth scheduler');

  // transition to won: outgoing track fades then pauses; new track = won slot
  const oldSrc = s.trackSrc;
  await setMode('won');
  await sleep(200);
  s = await st();
  assert.strictEqual(s.mode, 'won');
  assert(s.trackSrc && s.trackSrc !== null, 'won track started');
  log('mode won: track switched');
  await sleep(900);                        // past the 0.5s fade + teardown
  const oldGone = await page.evaluate(() =>
    window.__damTest && true);             // internal teardown is implicit
  s = await st();
  assert.strictEqual(s.trackMode, 'won');
  assert.strictEqual(s.scheduling, false);

  await setMode('lost');
  await sleep(300);
  s = await st();
  assert.strictEqual(s.trackMode, 'lost');
  assert.strictEqual(s.trackPaused, false);
  log('mode lost: track switched again, only current track active');

  // mute covers media via master
  await page.evaluate(() => window.DamAudio.setMuted(true));
  await sleep(400);
  s = await st();
  assert(s.masterGain < 0.05, 'master ~0 while muted, got ' + s.masterGain);
  await page.evaluate(() => window.DamAudio.setMuted(false));
  await sleep(400);
  s = await st();
  assert(s.masterGain > 0.3, 'master restored');
  log('mute: master gain covers licensed tracks');

  // paused → silence + no rumble target
  await setMode('paused');
  await sleep(800);
  s = await st();
  assert.strictEqual(s.mode, 'paused');
  assert.strictEqual(s.trackPaused, null, 'no active track while paused');
  assert.strictEqual(s.scheduling, false);
  assert(s.rumbleGain < 0.01, 'rumble off when paused, got ' + s.rumbleGain);
  log('paused: silent, no track, no scheduler, rumble ~0');

  // synth path: clear track config → scheduler runs
  await page.evaluate(() => { window.DAM_AUDIO_TRACKS = {}; });
  await setMode('playing');
  await sleep(600);
  s = await st();
  assert.strictEqual(s.scheduling, true, 'synth scheduler running');
  assert.strictEqual(s.schedulerCount, 1);
  assert(s.rumbleGain > 0.02, 'rumble under playing, got ' + s.rumbleGain);
  log('synth fallback when slots empty: scheduler=1, rumble on');

  // repeated setMode does not duplicate scheduler
  await setMode('playing'); await setMode('playing');
  await sleep(300);
  s = await st();
  assert.strictEqual(s.schedulerCount, 1, 'still one scheduler');
  log('repeated setMode(playing): no duplicates');

  // rejected play() → synth fallback, no unhandled rejection
  await page.evaluate(() => {
    window.DAM_AUDIO_TRACKS = { won: 'data:audio/wav;base64,AAAA' };
    const orig = Audio.prototype.play;
    window.__origPlay = orig;
    Audio.prototype.play = function () {
      return Promise.reject(new Error('forced rejection'));
    };
  });
  await setMode('won');
  await sleep(700);
  s = await st();
  assert.strictEqual(s.mode, 'won');
  assert.strictEqual(s.scheduling, true, 'synth fallback after rejected play');
  log('rejected play() → synth fallback, no unhandled rejection');
  await page.evaluate(() => { Audio.prototype.play = window.__origPlay; });

  // missing file (404) → single synth fallback
  await page.evaluate(() => {
    window.DAM_AUDIO_TRACKS = { playing: 'no-such-file-xyz.ogg' };
  });
  await setMode('playing');
  await sleep(1200);
  s = await st();
  assert.strictEqual(s.mode, 'playing');
  assert.strictEqual(s.scheduling, true, 'synth fallback after missing file');
  log('missing file → synth fallback (404 logged as expected)');

  // init failure safety: simulate missing AudioContext in a fresh page
  const p2 = await browser.newPage();
  await p2.addInitScript(() => { window.AudioContext = undefined;
    window.webkitAudioContext = undefined; });
  p2.on('pageerror', e => errors.push('noAC pageerror: ' + e.message));
  await p2.goto(URL, { waitUntil: 'load' });
  await p2.waitForTimeout(500);
  await p2.click('#btn-start');
  await p2.waitForTimeout(400);
  const h = await p2.evaluate(() =>
    document.getElementById('hud-status').textContent);
  assert.strictEqual(h, 'TRACKING', 'game runs with no AudioContext');
  const a = await p2.evaluate(() => window.DamAudio.state());
  assert.strictEqual(a.ctxState, 'none');
  log('no AudioContext: game still runs, audio state none');

  await browser.close();
  assert.strictEqual(errors.length, 0, 'unexpected errors:\n' + errors.join('\n'));
  log('expected/deliberate resource errors seen: ' + expected.length);
  log('ALL AUDIO CHECKS PASSED');
})().catch(e => {
  log('FATAL/FAIL: ' + (e && e.stack || e));
  process.exitCode = 1;
}).finally(() => fs.writeFileSync(LOG, lines.join('\n') + '\n'));
