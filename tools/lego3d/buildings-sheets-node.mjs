#!/usr/bin/env node
// Contact sheets of the building shots composed in node (no browser, no bot slot): same layout as sheets.json of buildings-sheets.mjs (rows = LEGO 3D off / on, views f q s then r l t), no labels (title = file name).
//   node tools/lego3d/buildings-sheets-node.mjs SHEETS.json OUTDIR
import fs from 'node:fs';
import { readPng } from './pngio.mjs';
import { writePngTopDown } from './lib.mjs';
const sheets = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), outDir = process.argv[3];
for (const s of sheets) {
  const [cw, ch] = s.cell, cols = s.cols, rows = Math.ceil(s.items.length / cols), W = cols * cw, H = rows * ch, out = new Uint8Array(W * H * 4).fill(34);
  s.items.forEach((it, k) => {
    if (!fs.existsSync(it.file)) return;
    const im = readPng(it.file), ox = (k % cols) * cw, oy = Math.floor(k / cols) * ch;
    for (let y = 0; y < ch - 2; y++) for (let x = 0; x < cw - 2; x++) {
      const sx = (x + 0.5) * im.w / (cw - 2) - 0.5, sy = (y + 0.5) * im.h / (ch - 2) - 0.5, x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy)), x1 = Math.min(im.w - 1, x0 + 1), y1 = Math.min(im.h - 1, y0 + 1), fx = sx - x0, fy = sy - y0;
      for (let c = 0; c < 3; c++) {
        const g = (xx, yy) => im.d[(yy * im.w + xx) * im.bpp + c];
        out[((oy + y) * W + ox + x) * 4 + c] = (g(x0, y0) * (1 - fx) + g(x1, y0) * fx) * (1 - fy) + (g(x0, y1) * (1 - fx) + g(x1, y1) * fx) * fy;
      }
      out[((oy + y) * W + ox + x) * 4 + 3] = 255;
    }
  });
  writePngTopDown(`${outDir}/${s.out}.png`, W, H, out);
}
console.log(sheets.length, 'sheets');
