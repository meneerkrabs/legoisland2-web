#!/usr/bin/env node
// Forest group shots of docs/re/lego3d.md section 19: for every camera of the PERF run (tools/steps/devcorner-objcam.mjs with PERF=1, files perf<mode>-<zone>-r<idx>-az..-l<mode>.png) one sheet:
// original (lego3d=0) | LEGO 3D without the plants generator (lego3d=-plants) | LEGO 3D (lego3d=1), with the frame's triangles / lit vertices / render ms from the run logs when they are given.
//   node tools/lego3d/env-forest-sheet.mjs --dir ~/Documents/legoeiland2-extract/lego3d/shots-env/perf --out DIR/sheets-plants
import fs from 'node:fs';
import path from 'node:path';
import { writePngTopDown } from './lib.mjs';
import { readPng, text, scaleInto } from './env-sheet.mjs';
const a = process.argv.slice(2);
const opt = (n, d) => { const i = a.indexOf(n); return i < 0 ? d : a[i + 1]; };
const dir = opt('--dir', ''), out = opt('--out', path.join(dir, '../sheets-plants')), cw = 520, ch = 390;
fs.mkdirSync(out, { recursive: true });
const MODES = [['0', 'ORIGINAL'], ['-plants', 'LEGO 3D NO PLANTS'], ['1', 'LEGO 3D']];
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
const keys = new Set(files.map((f) => f.replace(/^perf(-plants|0|1)-/, '').replace(/-l(-plants|0|1)\.png$/, '')));
for (const k of [...keys].sort()) {
  const W = cw * 3, H = ch + 30, img = new Uint8Array(W * H * 4).fill(34); for (let i = 3; i < img.length; i += 4) img[i] = 255;
  MODES.forEach(([m, label], i) => {
    const pre = m === '-plants' ? 'perf-plants-' : `perf${m}-`, f = `${pre}${k}-l${m}.png`;
    text(img, W, i * cw + 6, 6, label + (k.startsWith('z') ? '' : ''), 2, i === 2 ? [120, 255, 120] : [255, 200, 120]);
    if (files.includes(f)) scaleInto(img, W, readPng(path.join(dir, f)), i * cw, 26, cw - 2, ch);
  });
  writePngTopDown(path.join(out, `forest-${k}.png`), W, H, img); console.log('forest', k);
}
