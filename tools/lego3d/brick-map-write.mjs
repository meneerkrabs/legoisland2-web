#!/usr/bin/env node
// Writes tools/lego3d/brickmap.json (the committed brick table) from the measurement run (brick-search.mjs -> brick-table.mjs) and the decisions in brick-review.json.
// Every brick that goes in is built once more here (LOD 0 + 1) and demoted when the build shows a problem (a two-colour brick that loses its second colour, no LOD 1 where the game has one, an empty mesh).
//   node tools/lego3d/brick-map-write.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LDrawLib } from './ldraw.mjs';
import { LDRAW, WORK, archive } from './lib.mjs';
import { buildBrickAll, parseFlags } from './brickbuild.mjs';
import { BOX_TOL, MEAN_TOL, FAR_TOL, CLASS_BOX, CLASS_MEAN } from './brickfit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const choice = JSON.parse(fs.readFileSync(path.join(WORK, 'brick-choice.json'), 'utf8'));
const review = JSON.parse(fs.readFileSync(path.join(here, 'brick-review.json'), 'utf8'));
const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw')), a = archive('Bricks');
const out = { v: 2, rule: { box: BOX_TOL, mean: MEAN_TOL, far: FAR_TOL, classBox: CLASS_BOX, classMean: CLASS_MEAN }, bricks: {}, rejected: {}, none: {}, slab: [], pending: [] };
/** build options of a class brick from its review entry: { parts: ["4033c01", "2494!"], flags: "trans,fit,b0=3,b1=1.5" } ("!" = glass part, trans = LDraw transparent colours are the second colour, fit = per-axis fit to the game's box) */
export const classOpts = (e) => parseFlags(e.flags);
const fmt = (b) => `best part mean ${b.mean} / far ${(b.far * 100).toFixed(0)} % / box ${b.box}`;
for (const [name, c] of Object.entries(choice)) {
  if (c.status === 'slab') { out.slab.push(name); continue; }
  if (c.status === 'none') { out.none[name] = c.note; continue; }
  if (review.cls?.[name]) { out.pending.push(name); continue; }   // class bricks are built below
  if (review.reject[name]) { out.rejected[name] = review.reject[name]; continue; }
  const accepted = c.status === 'verified' || review.accept[name] || (review.fitScale ?? []).includes(name);
  if (!accepted) { out.rejected[name] = `${c.part} (${c.title.trim().replace(/\s+/g, ' ')}) is the closest library part, but the game's own LOD 0 differs: ${fmt(c.built)}`; continue; }
  const parts = (review.partOverride?.[name] ?? [c.part]).map((p) => ({ p }));
  const fitScale = (review.fitScale ?? []).includes(name);
  const r = buildBrickAll(lib, a, name, parts.map((p) => p.p), { fitScale });
  if (!r.lods) { out.rejected[name] = `build failed: ${r.row.status}`; continue; }
  const row = r.row, L0 = r.lods[0];
  if (r.refs[0].secondTris && (L0.split >= L0.pos.length / 3 || L0.split < 1)) { out.rejected[name] = `the game's brick has a second colour (${r.refs[0].vertexCount - r.refs[0].split} vertices) that ${parts[0].p} has no counterpart for`; continue; }
  const lod1 = a.find(`lods/${name}_lod1.msh`);
  if (lod1 && !r.lods[1]) { out.rejected[name] = 'no LOD 1 could be built'; continue; }
  const verified = row.lod0.verified;
  out.bricks[name] = { parts, tier: verified ? 'verified' : 'reviewed', title: c.title.trim().replace(/\s+/g, ' '), ...(fitScale ? { fitScale: true } : {}), ...(review.accept[name] ? { note: review.accept[name] } : {}), lod0: row.lod0, lod1: row.lod1 };
  process.stdout.write('.');
}
// class bricks ("same functional element", loosened rule): box <= CLASS_BOX per axis, mean <= CLASS_MEAN, a second colour kept where the game has one, a LOD 1 where the game has one
for (const name of [...out.pending, ...Object.keys(review.cls ?? {}).filter((n) => !out.pending.includes(n))]) {
  const e = review.cls[name], parts = e.parts.map((p) => ({ p })), o = classOpts(e);
  const r = buildBrickAll(lib, a, name, parts.map((p) => p.p), o);
  const why = (m) => { out.rejected[name] = m; delete out.none[name]; };   // (the review.reject text, if any, is replaced by the numbers of the class attempt)
  if (!r.lods) { why(`build failed: ${r.row.status}`); continue; }
  const row = r.row, L0 = r.lods[0];
  if (r.refs[0].secondTris && (L0.split >= L0.pos.length / 3 || L0.split < 1)) { why(`the game's brick has a second colour that ${e.parts.join('+')} does not provide`); continue; }
  if (a.find(`lods/${name}_lod1.msh`) && !r.lods[1]) { why('no LOD 1 could be built'); continue; }
  if (row.lod0.box > CLASS_BOX || row.lod0.mean > CLASS_MEAN) { why(`${e.parts.join('+')}: box ${row.lod0.box} / mean ${row.lod0.mean} outside the class rule (${CLASS_BOX} / ${CLASS_MEAN})`); continue; }
  if (row.studs && (row.studs.nGame !== row.studs.nNew || row.studs.worst > 0.09)) { why(`${e.parts.join('+')}: stud layout differs (game ${row.studs.nGame} studs, part ${row.studs.nNew}, worst ${row.studs.worst.toFixed(3)} off)`); continue; }
  delete out.rejected[name]; delete out.none[name];
  out.bricks[name] = { parts, tier: 'class', strict: row.lod0.verified, cls: e.cls, title: e.title ?? '', ...(o.fitScale ? { fitScale: true } : {}), ...(o.second ? { second: o.second } : {}), ...(o.nostud ? { nostud: true } : {}), ...(o.b0 !== undefined ? { b0: o.b0 } : {}), ...(o.b1 !== undefined ? { b1: o.b1 } : {}), ...(o.mc0 !== undefined ? { mc0: o.mc0 } : {}), ...(o.mc1 !== undefined ? { mc1: o.mc1 } : {}), ...(o.bc1 !== undefined ? { bc1: o.bc1 } : {}), note: e.note, lod0: row.lod0, lod1: row.lod1 };
  process.stdout.write('+');
}
delete out.pending;
console.log();
fs.writeFileSync(path.join(here, 'brickmap.json'), JSON.stringify(out, null, 1));
const n = (t) => Object.values(out.bricks).filter((b) => b.tier === t).length;
console.log(`bricks ${Object.keys(out.bricks).length} (verified ${n('verified')}, reviewed ${n('reviewed')}, class ${n('class')}), rejected ${Object.keys(out.rejected).length}, no counterpart ${Object.keys(out.none).length}, slabs ${out.slab.length}`);
