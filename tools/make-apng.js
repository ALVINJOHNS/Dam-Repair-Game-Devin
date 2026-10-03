/* Assemble docs/media/frames/*.rgba (+meta.json) into an animated PNG
 * (APNG) for the README preview. Pure Node — zlib only, no deps.
 *
 *   node tools/make-apng.js [out.png] [everyN]
 *
 * everyN: keep 1 of every N frames (default 1). Delay scales to match.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, '..', 'docs', 'media', 'frames');
const OUT = process.argv[2] || path.join(__dirname, '..', 'docs', 'media', 'gameplay-preview.png');
const EVERY = Math.max(1, Number(process.argv[3]) || 1);

const meta = JSON.parse(fs.readFileSync(path.join(DIR, 'meta.json'), 'utf8'));
const { w, h, fps } = meta;
const names = fs.readdirSync(DIR).filter(f => f.endsWith('.rgba')).sort();
const frames = names.filter((_, i) => i % EVERY === 0)
  .map(f => fs.readFileSync(path.join(DIR, f)));
console.log(frames.length + ' frames ' + w + 'x' + h + ' (kept 1/' + EVERY + ')');

// --- crc32 ---
const T = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  T[n] = c;
}
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = T[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  return Buffer.concat([u32(data.length), t, data, u32(crc32(Buffer.concat([t, data])))]);
}

// frame raw RGBA -> filtered scanlines (filter 0) -> zlib stream
function frameData(rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return zlib.deflateSync(raw, { level: 9 });
}

const delayNum = EVERY, delayDen = fps;            // seconds = EVERY/fps
const ihdr = Buffer.concat([
  u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0])]);  // 8-bit RGBA
let seq = 0;
const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('acTL', Buffer.concat([u32(frames.length), u32(0)]))];

frames.forEach((rgba, i) => {
  const fctl = Buffer.concat([
    u32(seq++), u32(w), u32(h), u32(0), u32(0),
    u16(delayNum), u16(delayDen), Buffer.from([0, 0])]); // dispose none, blend source
  parts.push(chunk('fcTL', fctl));
  const data = frameData(rgba);
  if (i === 0) parts.push(chunk('IDAT', data));
  else parts.push(chunk('fdAT', Buffer.concat([u32(seq++), data])));
});
parts.push(chunk('IEND', Buffer.alloc(0)));

fs.writeFileSync(OUT, Buffer.concat(parts));
console.log('wrote ' + OUT + ' (' +
  (fs.statSync(OUT).size / 1e6).toFixed(2) + ' MB)');
