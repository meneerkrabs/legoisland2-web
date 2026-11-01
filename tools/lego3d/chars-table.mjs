#!/usr/bin/env node
// One row per character (the prefix of its head mesh): which body layout it uses, how many of its LOD parts are replaced for head / hands / hair / headgear / accessories, and what stays the game's.
// Reads the pack's chars/tables.json and the cached inventory.   node tools/lego3d/chars-table.mjs [--md out.md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { loadInventory } from './chars-inventory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pack = Pack.open(new Uint8Array(fs.readFileSync(path.join(here, '../../src/mods/lego3d/data/lego3d.pack'))));
const t = await pack.json('chars/tables.json');
const inv = loadInventory();
const replaced = (p) => !!(p?.hash && t.members[p.member.toLowerCase()]?.[p.hash]);
const prefix = (o) => { const h = o.attach.find((a) => a?.slot === 4)?.parts[0]?.name ?? ''; return h.replace(/_?(HR|MR|LR|SLR|BGR)?head.*$/i, '').replace(/_$/, '') || o.parts[0].name; };
const LAYOUT = { 'PEPP_HR.msh': 'pepp', 'MFG_HR.msh': 'mfg', 'BB_HR.msh': 'bb', 'Space_pep_white.msh': 'space', 'SKEL_HR.msh': 'skeleton (original)', 'MUMM_HR.msh': 'mummy (original)', 'MUM_HRbody.msh': 'diver, PEPD rig (original)' };
const rows = new Map();
for (const o of inv.models) {
  const head = o.attach.find((a) => a?.slot === 4);
  if (!head) continue;
  const key = prefix(o), r = rows.get(key) ?? { key, models: 0, zones: new Set(), bodies: new Set(), body: [0, 0], head: [0, 0], hand: [0, 0], gear: new Map() };
  r.models++; r.zones.add(o.zone); r.bodies.add(LAYOUT[o.parts[0].name] ?? o.parts[0].name);
  for (const p of o.parts) { r.body[1]++; if (replaced(p)) r.body[0]++; }
  for (const p of head.parts) { r.head[1]++; if (replaced(p)) r.head[0]++; }
  for (const a of o.attach) {
    if (!a) continue;
    if (a.slot === 6 || a.slot === 8) for (const p of a.parts) { r.hand[1]++; if (replaced(p)) r.hand[0]++; }
    else if (a.slot !== 4) { const n = a.parts[0]?.name.replace(/_?(HR|MR|LR|SLR|BGR)/i, '$1'); const e = r.gear.get(n) ?? [0, 0]; for (const p of a.parts) { e[1]++; if (replaced(p)) e[0]++; } r.gear.set(n, e); }
  }
  rows.set(key, r);
}
const lines = ['| character | zones | body | body LODs | head LODs | hand LODs | gear (replaced / LOD parts) |', '|---|---|---|---|---|---|---|'];
for (const r of [...rows.values()].sort((a, b) => a.key.localeCompare(b.key))) {
  const per = (x) => `${(x[0] / Math.max(1, r.models)).toFixed(1)} / ${(x[1] / Math.max(1, r.models)).toFixed(1)}`;
  const gear = [...r.gear].map(([n, e]) => `${n.replace(/\.msh$/, '')} ${e[0]}/${e[1]}`).join(', ') || '-';
  lines.push(`| ${r.key} | ${r.zones.size} | ${[...r.bodies].join(', ')} | ${per(r.body)} | ${per(r.head)} | ${per(r.hand)} | ${gear} |`);
}
const out = lines.join('\n');
const i = process.argv.indexOf('--md');
if (i > 0) fs.writeFileSync(process.argv[i + 1], out + '\n'); else console.log(out);
console.log(`\n${rows.size} characters`);
