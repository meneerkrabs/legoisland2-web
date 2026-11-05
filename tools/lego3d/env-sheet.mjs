#!/usr/bin/env node
// Contact sheets of the environment shots (docs/re/lego3d.md section 19), composed in node (no browser): for every object of tools/lego3d/env-shoot.mjs one sheet, the LEGO 3D off row above the on row, one
// column per view (front / east / rear / west / top, or 3/4 + top for the secondary ones), labelled.
//   node tools/lego3d/env-sheet.mjs --shots DIR --out DIR/sheets [--cell 360x270] [--zones z02LGI] [--only pine,oak]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { writePngTopDown } from './lib.mjs';
import { ENV } from './env-table.mjs';
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const shots = opt('--shots', ''), out = opt('--out', path.join(shots, '../sheets')), [cw, ch] = opt('--cell', '360x270').split('x').map(Number);
const zonesOnly = opt('--zones', '')?.split(',').filter(Boolean), only = opt('--only', '')?.split(',').filter(Boolean);
export function readPng(f) {
  const b = fs.readFileSync(f); let o = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (o < b.length) { const len = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8); if (t === 'IHDR') { w = b.readUInt32BE(o + 8); h = b.readUInt32BE(o + 12); ct = b[o + 17]; } if (t === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0; if (!bpp) throw new Error(`png type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = new Uint8Array(w * h * 4); let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const A = i >= bpp ? line[i - bpp] : 0, B = prev[i], C = i >= bpp ? prev[i - bpp] : 0;
      const p = A + B - C, pa = Math.abs(p - A), pb = Math.abs(p - B), pc = Math.abs(p - C);
      line[i] = (line[i] + (ft === 0 ? 0 : ft === 1 ? A : ft === 2 ? B : ft === 3 ? (A + B) >> 1 : (pa <= pb && pa <= pc ? A : pb <= pc ? B : C))) & 255;
    }
    for (let x = 0; x < w; x++) { px[(y * w + x) * 4] = line[x * bpp]; px[(y * w + x) * 4 + 1] = line[x * bpp + 1]; px[(y * w + x) * 4 + 2] = line[x * bpp + 2]; px[(y * w + x) * 4 + 3] = 255; }
    prev = line;
  }
  return { w, h, px };
}
const FONT = { A: '01110100011000110001111111000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000', G: '01110100011000010111100011000101110', H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111', M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000', R: '11110100011000111110101001001010001', S: '01111100000100000111000001000011110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100', W: '10001100011000110101101011101110001', X: '10001010100010000100010101000110001', Y: '10001010100010000100001000010000100', '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111', '3': '11110000010000101110000010000111110', '4': '00010001100101010010111110001000010', '5': '11111100001111000001000001000111110', '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000', '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100', '-': '00000000000000011111000000000000000', '.': '00000000000000000000000000110001100', ':': '00000011000110000000011000110000000', '#': '01010111110101001010111110101000000', _: '00000000000000000000000000000011111' };
export function text(img, W, x0, y0, s, scale = 2, col = [255, 255, 255]) {
  for (const chr of s.toUpperCase()) {
    const g = FONT[chr];
    if (g) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r * 5 + c] === '1') for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const o = ((y0 + r * scale + dy) * W + x0 + c * scale + dx) * 4; img[o] = col[0]; img[o + 1] = col[1]; img[o + 2] = col[2]; img[o + 3] = 255; }
    x0 += 6 * scale;
  }
}
export function scaleInto(img, W, src, x0, y0, dw, dh) {
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const sx0 = Math.floor((x * src.w) / dw), sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * src.w) / dw)), sy0 = Math.floor((y * src.h) / dh), sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * src.h) / dh));
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = sy0; sy < sy1; sy++) for (let sx = sx0; sx < sx1; sx++) { const o = (sy * src.w + sx) * 4; r += src.px[o]; g += src.px[o + 1]; b += src.px[o + 2]; n++; }
    const o = ((y0 + y) * W + x0 + x) * 4; img[o] = r / n; img[o + 1] = g / n; img[o + 2] = b / n; img[o + 3] = 255;
  }
}
if (process.argv[1].endsWith('env-sheet.mjs')) {
  fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(shots).filter((f) => f.endsWith('.png'));
  for (const [zone, list] of Object.entries(ENV)) {
    if (zonesOnly.length && !zonesOnly.includes(zone)) continue;
    for (const [nm, idx, , , v] of list) {
      if (only.length && !only.includes(nm)) continue;
      const mine = files.filter((f) => f.startsWith(`oc-${zone}-r${idx}-`));
      const cols = new Map();   // key az-dist -> { l0, l1 }
      for (const f of mine) { const m = f.match(/-az(\d+)-d([\d.]+)-l([01])\.png$/); if (!m) continue; const k = `${m[1]}-${m[2]}`; (cols.get(k) ?? cols.set(k, {}).get(k))[`l${m[3]}`] = f; }
      const keys = [...cols.keys()].sort((p, q) => { const top = (k) => (k.split('-')[1] === '0.3' ? 1 : 0); return top(p) - top(q) || +p.split('-')[0] - +q.split('-')[0]; });
      if (!keys.length) continue;
      const lab = { 0: 'FRONT', 45: '3-4', 90: 'EAST', 180: 'REAR', 270: 'WEST' };
      const W = keys.length * cw, H = 2 * (ch + 18) + 22, img = new Uint8Array(W * H * 4).fill(34); for (let i = 3; i < img.length; i += 4) img[i] = 255;
      text(img, W, 6, 5, `${zone} ${nm} r${idx}  OFF ABOVE  ON BELOW`, 2);
      keys.forEach((k, ci) => {
        const [az, d] = k.split('-');
        for (const l of [0, 1]) { const f = cols.get(k)[`l${l}`]; const y0 = 22 + l * (ch + 18); text(img, W, ci * cw + 4, y0 + 2, `${d === '0.3' ? 'TOP' : lab[az] ?? az} ${l ? 'ON' : 'OFF'}`, 2, l ? [120, 255, 120] : [255, 200, 120]); if (f) scaleInto(img, W, readPng(path.join(shots, f)), ci * cw, y0 + 16, cw - 2, ch); }
      });
      writePngTopDown(path.join(out, `${zone}-${nm}.png`), W, H, img);
      console.log('sheet', `${zone}-${nm}.png`, keys.length, 'views');
    }
  }
}
