#!/usr/bin/env node
// Cold generation time of the characters generator per zone archive (the browser generates one archive when its zone loads): the per-content cache is emptied before every archive, so the
// numbers are what a player waits for the FIRST time that zone loads (a second zone reuses the shared bodies / heads: see the warm column). Node on this machine; a browser is within a small factor.
//   node tools/lego3d/bench-gen.mjs [--gen characters,studs] [--runs 3]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { resetCharsCache } from '../../src/mods/lego3d/gen/characters.ts';
import { archive, archiveNames } from './lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const gens = (opt('--gen', 'characters') || '').split(',').filter(Boolean), runs = +opt('--runs', 3);
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const rows = [];
for (const n of archiveNames()) {
  if (!/^z\d\d/.test(n)) continue;
  const a = archive(n);
  const cold = [];
  let files = 0;
  for (let r = 0; r < runs; r++) { resetCharsCache(); const t0 = performance.now(); const g = await generateArchive(pack, n, a, async (x) => archive(x), gens); cold.push(performance.now() - t0); files = g.files.size; }
  const t1 = performance.now(); await generateArchive(pack, n, a, async (x) => archive(x), gens); const warm = performance.now() - t1;
  cold.sort((x, y) => x - y);
  rows.push({ n, files, min: cold[0], med: cold[cold.length >> 1], warm });
}
const f = (x) => x.toFixed(0).padStart(5);
console.log('archive   files   cold min  cold median  warm (ms)');
for (const r of rows) console.log(`${r.n.padEnd(8)} ${String(r.files).padStart(6)}  ${f(r.min)}    ${f(r.med)}      ${f(r.warm)}`);
const med = rows.map((r) => r.med).sort((x, y) => x - y);
console.log(`median ${med[med.length >> 1].toFixed(0)} ms, max ${med[med.length - 1].toFixed(0)} ms over ${rows.length} archives`);
