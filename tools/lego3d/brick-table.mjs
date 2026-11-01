#!/usr/bin/env node
// Chooses the LDraw part per game brick from the measurement run (brick-search.mjs) and writes the review list: node tools/lego3d/brick-table.mjs  ->  <WORK>/brick-choice.json + brick-choice.txt
// Rule: the candidate with the smallest mean distance of the BUILT LOD 0 to the game's LOD 0; among those within 0.002 of it the plainest one wins (official parts before unofficial "u...", shorter title,
// shorter number). The decisions after looking at the QA sheets (accept a near miss, reject, compound parts) are in brickmap.json (committed): this file only proposes.
import fs from 'node:fs';
import path from 'node:path';
import { WORK } from './lib.mjs';
import { BOX_TOL, MEAN_TOL, FAR_TOL } from './brickfit.mjs';

const search = JSON.parse(fs.readFileSync(path.join(WORK, 'brick-search.json'), 'utf8'));
const out = {}, lines = [];
for (const [name, e] of Object.entries(search)) {
  if (e.slab) { out[name] = { status: 'slab' }; continue; }
  const c = (e.top ?? []).filter((x) => x.built?.mean !== undefined);
  if (!c.length) { out[name] = { status: 'none', note: `no library part with a similar bounding box (${e.ref?.join(' x ')})` }; continue; }
  const best = Math.min(...c.map((x) => x.built.mean));
  const near = c.filter((x) => x.built.mean <= best + 0.002).sort((x, y) => (/^u/.test(x.part) ? 1 : 0) - (/^u/.test(y.part) ? 1 : 0) || x.title.length - y.title.length || x.part.length - y.part.length || x.part.localeCompare(y.part));
  const p = near[0], b = p.built;
  const ok = b.box <= BOX_TOL && b.mean <= MEAN_TOL && b.far <= FAR_TOL;
  out[name] = { status: ok ? 'verified' : 'review', part: p.part, title: p.title, built: b, others: c.filter((x) => x !== p).slice(0, 3).map((x) => `${x.part}(${x.built.mean})`) };
  lines.push(`${name.padEnd(26)} ${ok ? 'OK    ' : 'REVIEW'} ${p.part.padEnd(10)} box ${b.box} mean ${b.mean} far ${b.far} ${b.tris}t/${e.game}  ${p.title}`);
}
fs.writeFileSync(path.join(WORK, 'brick-choice.json'), JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(WORK, 'brick-choice.txt'), lines.join('\n') + '\n');
const cnt = {}; for (const v of Object.values(out)) cnt[v.status] = (cnt[v.status] ?? 0) + 1;
console.log(cnt);
