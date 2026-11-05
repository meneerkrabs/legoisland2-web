#!/usr/bin/env node
// Writes the silhouette difference of a replaced mesh against the game's own (the views of the IoU gate side by side): grey = both, red = only the game's, blue = only the new mesh.
//   node tools/lego3d/iou-diff.mjs [--pack FILE] out.png zone Mesh.Msh [view indexes 0,2,5]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archive, memberOf, scene, writePngTopDown } from './lib.mjs';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { silhouetteIoU } from './iou.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const pi = args.indexOf('--pack'); const packFile = pi >= 0 ? args.splice(pi, 2)[1] : path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const [out, zone, nm, sel] = args;
const a = archive(zone), sc = scene(zone), pack = Pack.open(new Uint8Array(fs.readFileSync(packFile)));
const r = await generateArchive(pack, zone, a, async () => null, ['sets']);
const idx = sc.meshPaths.findIndex((x) => x.toLowerCase().endsWith(`\\${nm.toLowerCase()}`)), member = memberOf(sc.meshPaths[idx]);
const key = [...r.files.keys()].find((k) => k.toLowerCase() === member.toLowerCase());
const soups = (msh) => { const gm = groupMatrices(msh); return msh.groups.map((g, gi) => { const t = []; for (let i = 0; i < g.indexCount; i++) { const v = msh.indices[g.firstIndex + i] + g.firstVertex, p = [msh.positions[v * 3], msh.positions[v * 3 + 1], msh.positions[v * 3 + 2]], M = gm[gi]; t.push(...(M ? [p[0] * M[0] + p[1] * M[4] + p[2] * M[8] + M[12], p[0] * M[1] + p[1] * M[5] + p[2] * M[9] + M[13], p[0] * M[2] + p[1] * M[6] + p[2] * M[10] + M[14]] : p)); } return Float32Array.from(t); }); };
const io = silhouetteIoU(soups(parseMsh(a.read(a.find(member)))), soups(parseMsh(r.files.get(key))), { size: 512 });
const views = sel ? sel.split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6, 7, 8], S = 512, W = S * views.length, img = new Uint8Array(W * S * 4);
views.forEach((v, k) => { const { A, B } = io.masks[v]; for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = y * S + x, o = (y * W + k * S + x) * 4, a1 = A[i], b1 = B[i]; const c = a1 && b1 ? [150, 150, 150] : a1 ? [230, 40, 40] : b1 ? [40, 80, 240] : [235, 235, 235]; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255; } });
writePngTopDown(out, W, S, img);
console.log(views.map((v) => `view ${v}: ${io.iou[v].toFixed(3)}`).join('  '));
