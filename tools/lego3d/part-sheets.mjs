#!/usr/bin/env node
// Before / after of ONE moving part (all groups with the GTOM index k: a wheel, a rotor, a door) of a generated mesh, local frame, three views, game left / replacement right.
//   node tools/lego3d/part-sheets.mjs OUT.png zone Mesh.Msh k
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, scene, memberOf } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { render, sheet, boundsOf } from './qa-raster.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const [out, zone, nm, k] = process.argv.slice(2), nocull = process.argv.includes('--nocull');
const a = archive(zone), sc = scene(zone);
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const r = await generateArchive(pack, zone, a, async () => null, ['sets']);
const idx = sc.meshPaths.findIndex((x) => x.toLowerCase().endsWith(`\\${nm.toLowerCase()}`));
const member = memberOf(sc.meshPaths[idx]);
const gk = [...r.files.keys()].find((q) => q.toLowerCase() === member.toLowerCase());
const PAL = [[230,60,60],[60,200,60],[70,90,255],[240,220,40],[220,60,220],[60,220,220],[250,150,40],[150,150,150]];
const soups = (m) => m.groups.map((g, gi) => { if (m.gtom?.[gi] !== +k) return null; const t = []; for (let i = 0; i < g.indexCount; i++) { const v = m.indices[g.firstIndex + i] + g.firstVertex; t.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); } return { tris: Float32Array.from(t), colour: PAL[gi % PAL.length] }; }).filter(Boolean);
const o = soups(parseMsh(a.read(a.find(member)))), n = soups(parseMsh(r.files.get(gk)));
const b = boundsOf([...o, ...n]);
const tri = (s) => s.reduce((q, g) => q + g.tris.length / 9, 0);
console.log('part', k, 'game', tri(o), 'tris ->', tri(n));
const row = [];
for (const [y, p] of [[90, 0], [0, 0], [50, 30]]) { row.push(render(o, { yaw: y, pitch: p, size: 360, bounds: b })); row.push(render(n, { yaw: y, pitch: p, size: 360, cull: !nocull, bounds: b })); }
sheet(out, [row]);
