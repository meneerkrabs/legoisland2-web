#!/usr/bin/env node
// Vertex / triangle counts of every mesh the mod replaces, against the game's own: node tools/lego3d/compare-counts.mjs [mod dir]  (prints a markdown table)
import fs from 'node:fs';
import path from 'node:path';
import { archive, EXTRACT } from './lib.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
const MOD = process.argv[2] ?? path.join(EXTRACT, 'mods/lego3d-pilot');
const rows = [];
const root = path.join(MOD, '_data');
for (const an of fs.readdirSync(root)) {
  const a = archive(an);
  const walk = (dir, rel) => { for (const f of fs.readdirSync(dir)) { const full = path.join(dir, f), r = rel ? `${rel}/${f}` : f; if (fs.statSync(full).isDirectory()) walk(full, r); else if (/\.msh$/i.test(f)) { const e = a.find(r); const n = parseMsh(new Uint8Array(fs.readFileSync(full))); let o = null; if (e) { const raw = a.bob.subarray(e.offset, e.offset + (e.baseSize ?? e.size)); o = parseMsh(raw); } rows.push({ arch: an, mesh: r, ov: o?.vertexCount ?? '-', ot: o ? o.indices.length / 3 : '-', nv: n.vertexCount, nt: n.indices.length / 3 }); } } };
  walk(path.join(root, an), '');
}
console.log('| archive | mesh | game verts / tris | mod verts / tris |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.arch} | ${r.mesh} | ${r.ov} / ${r.ot} | ${r.nv} / ${r.nt} |`);
