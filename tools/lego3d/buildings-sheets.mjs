#!/usr/bin/env node
// Writes the sheets.json of the building shots (docs/re/lego3d.md section 18) for tools/lego3d/vehicles-sheet.mjs: one sheet per record of the table BLD, rows = LEGO 3D off / on, views f q s then r l t.
//   node tools/lego3d/buildings-sheets.mjs SHOTS_DIR OUT.json [--zones z02LGI] [--only 116]
//   SHEETS=OUT.json sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:PORT/ tools/lego3d/vehicles-sheet.mjs --size 1600x1200 --out SHEETS_DIR
import fs from 'node:fs';
import { BLD } from './buildings-table.mjs';
import { spec } from './buildings-shoot.mjs';
const a = process.argv.slice(2), dir = a[0], outFile = a[1];
const opt = (n) => { const i = a.indexOf(n); return i < 0 ? [] : a[i + 1].split(','); };
const zonesOnly = opt('--zones'), only = opt('--only');
const sheets = [];
for (const [zone, list] of Object.entries(BLD)) {
  if (zonesOnly.length && !zonesOnly.includes(zone)) continue;
  for (const e of list) {
    const [idx, L, H, mesh, vs] = e;
    if (only.length && !only.includes(String(idx))) continue;
    const views = ['f', 'q', 's', 'r', 'l', 't'].filter((v) => !vs || vs.includes(v));
    const file = (v, l) => { const [, az, d] = spec(e, v).split(':'); return `${dir}/oc-${zone}-r${idx}-az${az}-d${d}-l${l}.png`; };
    const items = [];
    for (let k = 0; k < views.length; k += 3) for (const l of [0, 1]) for (const v of views.slice(k, k + 3)) items.push({ file: file(v, l), label: `${mesh} ${v} ${l ? 'LEGO 3D' : 'game'}` });
    if (!items.some((i) => fs.existsSync(i.file))) continue;
    sheets.push({ out: `${zone}-r${idx}-${mesh}`, cols: Math.min(3, views.length), cell: [480, 360], title: `${zone} record ${idx} ${mesh} (${L} x ${H})`, items });
  }
}
fs.writeFileSync(outFile, JSON.stringify(sheets, null, 1)); console.log(sheets.length, 'sheets');
