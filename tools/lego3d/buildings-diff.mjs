#!/usr/bin/env node
// Per record and view: how much of the building picture differs between LEGO 3D off and on (docs/re/lego3d.md section 18): fraction of the pixels whose colour differs by more than 24 (sum over rgb) and the box around them.
// A pair with fraction ~0 means the option leaves this building's picture alone from that side (only the 3D studs and glass backs the camera cannot see change nothing): the look at the contact sheet is then one picture.
//   node tools/lego3d/buildings-diff.mjs SHOTS_DIR [--zones z02LGI] [--only 116] [--json out.json]
import fs from 'node:fs';
import { BLD } from './buildings-table.mjs';
import { spec } from './buildings-shoot.mjs';
const a = process.argv.slice(2), dir = a[0];
const opt = (n) => { const i = a.indexOf(n); return i < 0 ? [] : a[i + 1].split(','); };
const zonesOnly = opt('--zones'), only = opt('--only'), jsonOut = opt('--json')[0];
import { readPng as png } from './pngio.mjs';
const rows = [];
for (const [zone, list] of Object.entries(BLD)) {
  if (zonesOnly.length && !zonesOnly.includes(zone)) continue;
  for (const e of list) {
    const [idx, , , mesh, vs] = e;
    if (only.length && !only.includes(String(idx))) continue;
    const res = {};
    for (const v of ['f', 'q', 's', 'r', 'l', 't']) {
      if (vs && !vs.includes(v)) continue;
      const [, az, d] = spec(e, v).split(':'), f = (l) => `${dir}/oc-${zone}-r${idx}-az${az}-d${d}-l${l}.png`;
      if (!fs.existsSync(f(0)) || !fs.existsSync(f(1))) continue;
      const A = png(f(0)), B = png(f(1)); let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 70; y < A.h; y++) for (let x = 0; x < A.w; x++) {   // the top 70 rows hold the HUD (the counters tick)
        const i = (y * A.w + x) * A.bpp, j = (y * B.w + x) * B.bpp;
        if (Math.abs(A.d[i] - B.d[j]) + Math.abs(A.d[i + 1] - B.d[j + 1]) + Math.abs(A.d[i + 2] - B.d[j + 2]) > 24) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      }
      res[v] = { frac: +(n / (A.w * (A.h - 70))).toFixed(4), box: n ? [x0, y0, x1, y1] : null };
    }
    rows.push({ zone, idx, mesh, res });
    console.log(zone, String(idx).padStart(3), mesh.padEnd(26), Object.entries(res).map(([v, r]) => `${v} ${(r.frac * 100).toFixed(1)}%`).join('  '));
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
