#!/usr/bin/env node
// Before / after sheets of a game mesh and its generated replacement (pack -> generator -> .msh, the browser's path): per view the game (left) and the replacement (right), flat group colours of
// the player's own textures, world space (MATL applied), back-face culling on for the replacement (magenta = back faces would show: only with --nocull).
//   node tools/lego3d/set-sheets.mjs OUT.png zone Mesh.Msh [Mesh2.Msh ...] [--views v1,v2]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, scene, memberOf, textureOf } from './lib.mjs';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { transformPoint } from '../../src/render/math.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { render, sheet, boundsOf } from './qa-raster.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), out = args[0], zone = args[1];
const cull = !args.includes('--nocull'), byGroup = args.includes('--groups');
const PAL = [[230,60,60],[60,200,60],[70,90,255],[240,220,40],[220,60,220],[60,220,220],[250,150,40],[150,150,150],[120,70,30],[250,250,250],[120,200,120],[200,120,200],[90,160,230]];
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const SIZE = +opt('--size', 230), VSEL = opt('--views', '0,1,2,3').split(',').map(Number);
const names = args.slice(2).filter((x, i, arr) => !x.startsWith('--') && !(arr[i - 1] ?? '').startsWith('--'));
const a = archive(zone), sc = scene(zone);
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const r = await generateArchive(pack, zone, a, async () => null, ['sets']);
const VIEWS = opt('--view', '') ? opt('--view', '').split('/').map((v) => v.split(',').map(Number)) : [[35, 25], [215, 25], [90, 10], [0, 80], [130, 35], [320, 35]].filter((_, i) => VSEL.includes(i));   // --view yaw,pitch/yaw,pitch
const rows = [];
for (const nm of names) {
  const idx = sc.meshPaths.findIndex((x) => x.toLowerCase().endsWith(`\\${nm.toLowerCase()}`));
  const member = memberOf(sc.meshPaths[idx]);
  const model = sc.models.find((m) => m.parts.some((p) => p && p.mesh === idx)), part = model.parts.find((p) => p && p.mesh === idx), tl = sc.texLists[part.texList];
  const genKey = [...r.files.keys()].find((k) => k.toLowerCase() === member.toLowerCase());
  const colourOf = (id) => { const t = id >= 0 ? textureOf(a, id) : null; if (!t) return [200, 200, 200]; const px = t.rgba; let rr = 0, gg = 0, bb = 0, n = 0; for (let i = 0; i < px.length; i += 4) { rr += px[i]; gg += px[i + 1]; bb += px[i + 2]; n++; } return [rr / n, gg / n, bb / n]; };
  const meshes = (msh) => {
    const gm = groupMatrices(msh);
    return msh.groups.map((g, gi) => {
      const t = [];
      for (let i = 0; i < g.indexCount; i++) { const v = msh.indices[g.firstIndex + i] + g.firstVertex, p = [msh.positions[v * 3], msh.positions[v * 3 + 1], msh.positions[v * 3 + 2]]; t.push(...(gm[gi] ? transformPoint(gm[gi], p) : p)); }
      return { tris: Float32Array.from(t), colour: byGroup ? PAL[gi % PAL.length] : colourOf(tl[gi] ?? -1) };
    });
  };
  const orig = meshes(parseMsh(a.read(a.find(member))));
  if (!genKey) { console.log(nm, 'not replaced'); continue; }
  const mine = meshes(parseMsh(r.files.get(genKey)));
  let b = boundsOf([...orig, ...mine]);
  if (opt('--box', '')) { const v = opt('--box', '').split(',').map(Number); b = { lo: v.slice(0, 3), hi: v.slice(3, 6) }; }   // zoom: world-space box to frame
  const tri = (m) => m.reduce((s, g) => s + g.tris.length / 9, 0);
  console.log(nm, 'game', tri(orig), 'tris -> generated', tri(mine));
  const row = [];
  for (const [y, p] of VIEWS) { row.push(render(orig, { yaw: y, pitch: p, size: SIZE, bounds: b })); row.push(render(mine, { yaw: y, pitch: p, size: SIZE, cull, bounds: b })); }
  rows.push(row);
}
sheet(out, rows);
