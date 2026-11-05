#!/usr/bin/env node
// Off / on pixel difference of the sky / water shots (tools/lego3d/steps/skywater.mjs): for every pair DIR/<stem>-l0.png and DIR/<stem>-l<X>.png the share of pixels whose colour differs by more than 24 (sum of rgb), the
// mean absolute difference per channel and the bounding box of the differing pixels; the top 70 rows (HUD counters) are skipped. A share of 0 = the option leaves that picture alone.
//   node tools/lego3d/skywater-diff.mjs DIR [--on 1] [--mask]   (--mask writes <stem>-diff.png: differing pixels red on the dimmed off picture)
import fs from 'node:fs';
import { readPng } from './pngio.mjs';
import { writePngTopDown } from './lib.mjs';
const a = process.argv.slice(2), dir = a[0], on = a.includes('--on') ? a[a.indexOf('--on') + 1] : '1', mask = a.includes('--mask');
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('-l0.png')).sort()) {
  const stem = f.slice(0, -7), g = `${dir}/${stem}-l${on}.png`;
  if (!fs.existsSync(g)) continue;
  const A = readPng(`${dir}/${f}`), B = readPng(g);
  if (A.w !== B.w || A.h !== B.h) { console.log(`${stem}: size differs`); continue; }
  let n = 0, tot = 0, sum = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const out = mask ? new Uint8Array(A.w * A.h * 4) : null;
  for (let y = 70; y < A.h; y++) for (let x = 0; x < A.w; x++) {
    const i = (y * A.w + x) * A.bpp, j = (y * B.w + x) * B.bpp;
    const d = Math.abs(A.d[i] - B.d[j]) + Math.abs(A.d[i + 1] - B.d[j + 1]) + Math.abs(A.d[i + 2] - B.d[j + 2]);
    tot++; sum += d / 3;
    const hit = d > 24; if (hit) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (out) { const o = (y * A.w + x) * 4; out[o] = hit ? 255 : A.d[i] >> 2; out[o + 1] = hit ? 0 : A.d[i + 1] >> 2; out[o + 2] = hit ? 0 : A.d[i + 2] >> 2; out[o + 3] = 255; }
  }
  console.log(`${stem}: ${(100 * n / tot).toFixed(3)} % of pixels differ (> 24), mean abs ${(sum / tot).toFixed(3)}${n ? `, box ${x0},${y0} - ${x1},${y1}` : ''}`);
  if (out) writePngTopDown(`${dir}/${stem}-diff.png`, A.w, A.h, out);
}
