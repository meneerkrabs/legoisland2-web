#!/usr/bin/env node
// Before / after sheets of the GENERATED bricks (pack -> generator -> .msh, the same path the browser takes): game (blue, left) next to the replacement (orange, right), 5 bricks per row.
//   node tools/lego3d/brick-final-sheets.mjs OUTPREFIX [--lod 0|1]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { render, sheet, boundsOf, mshSoup } from './qa-raster.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), prefix = args[0], LOD = args.includes('--lod') ? +args[args.indexOf('--lod') + 1] : 0;
const a = archive('Bricks');
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const r = await generateArchive(pack, 'Bricks', a, async () => null, ['bricks']);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null, idx0 = await pack.json('bricks/index.json');   // --only a,b or a tier name (class, reviewed, verified)
const names = Object.keys(idx0.bricks).filter((n) => !only || only.includes(n) || only.includes(idx0.bricks[n].tier)).filter((n) => r.files.has(`lods/${n}_lod${LOD}.msh`)).sort();
const cells = [];
for (const n of names) {
  const g = mshSoup(parseMsh(a.read(a.find(`lods/${n}_lod${LOD}.msh`)))), m = mshSoup(parseMsh(r.files.get(`lods/${n}_lod${LOD}.msh`)));
  const b = boundsOf([{ tris: g }, { tris: m }]);
  cells.push([render([{ tris: g, colour: [110, 170, 255] }], { yaw: 35, pitch: 30, size: 110, bounds: b }), render([{ tris: m, colour: [255, 190, 90] }], { yaw: 35, pitch: 30, size: 110, cull: true, bounds: b })]);
}
const per = 30;
for (let s = 0; s * per < cells.length; s++) {
  const rows = [];
  for (let i = s * per; i < Math.min(cells.length, (s + 1) * per); i += 5) rows.push(cells.slice(i, Math.min(i + 5, (s + 1) * per, cells.length)).flat());
  sheet(`${prefix}-lod${LOD}-${s}.png`, rows);
  console.log(`sheet ${s}: ${names.slice(s * per, (s + 1) * per).join(' ')}`);
}
