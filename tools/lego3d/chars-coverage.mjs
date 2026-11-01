#!/usr/bin/env node
// Coverage of the LEGO 3D character pack against the game's characters: for each of the 8 humanoid HR bodies the characters using it, per LOD the recipe (or "original") and the triangles
// before / after; heads, hands and gear (hair / headgear / accessories) replaced vs kept. Reads the pack's chars/tables.json and the cached inventory (tools/lego3d/chars-inventory.mjs).
//   node tools/lego3d/chars-coverage.mjs [--md]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { loadInventory } from './chars-inventory.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
const LODS = ['HR', 'MR', 'LR', 'SLR', 'BGR'];

export async function coverage() {
  const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
  const t = await pack.json('chars/tables.json');
  const inv = loadInventory();
  const recipeOf = (p) => { const key = t.members[p.member.toLowerCase()]?.[p.hash]; return key ? { key, rec: t.bodies[key] ?? t.statics?.[key] } : null; };
  const prefix = (o) => { const h = o.attach.find((a) => a?.slot === 4)?.parts[0]?.name ?? ''; return h.replace(/_?(HR|MR|LR|SLR|BGR)?head.*$/i, '').replace(/_$/, '') || o.parts[0].name; };
  // humanoid bodies: models with a head attachment on bone 10
  const bodies = {};
  for (const o of inv.models) {
    if (!o.attach.some((a) => a?.slot === 4)) continue;
    const h = o.parts[0].hash;
    (bodies[h] ??= { name: o.parts[0].name, models: [], chars: new Set(), lods: [] }).models.push(o);
    bodies[h].chars.add(prefix(o));
  }
  const rows = [];
  for (const [h, b] of Object.entries(bodies)) {
    const lods = [];
    const uniq = new Map();
    for (const o of b.models) o.parts.forEach((p, li) => { if (p.hash && !uniq.has(`${li}:${p.hash}`)) uniq.set(`${li}:${p.hash}`, { li, p }); });
    for (const { li, p } of uniq.values()) {
      const m = inv.meshes[p.hash], r = recipeOf(p);
      lods.push({ li, name: p.name, hash: p.hash, orig: m.tris, key: r?.key ?? null, now: r ? (r.rec.tris ?? null) : null, limit: r?.rec.limit ?? null });
    }
    lods.sort((a, c) => a.li - c.li);
    rows.push({ hash: h, name: b.name, tris: inv.meshes[h].tris, models: b.models.length, zones: new Set(b.models.map((o) => o.zone)).size, chars: [...b.chars].sort(), lods });
  }
  // heads / hands / gear: unique contents by slot
  const kinds = { head: new Map(), hand: new Map(), gear: new Map() };
  for (const o of inv.models) for (const a of o.attach) {
    if (!a) continue;
    const kind = a.slot === 4 ? 'head' : a.slot === 6 || a.slot === 8 ? 'hand' : 'gear';
    for (const p of a.parts) if (p.hash) { const m = kinds[kind].get(p.hash); if (!m) kinds[kind].set(p.hash, { p, r: recipeOf(p), n: 1, orig: inv.meshes[p.hash].tris }); else m.n++; }
  }
  const sum = {};
  for (const [k, mp] of Object.entries(kinds)) {
    const hr = [...mp.values()].filter((x) => /(^|_)HR|^(?!.*(MR|LR|SLR|BGR))/i.test(x.p.name));
    sum[k] = { contents: mp.size, replaced: [...mp.values()].filter((x) => x.r).length, tris0: [...mp.values()].filter((x) => x.r).reduce((s, x) => s + x.orig, 0), tris1: [...mp.values()].filter((x) => x.r).reduce((s, x) => s + (x.r.rec.tris ?? x.orig), 0), kept: [...mp.values()].filter((x) => !x.r).map((x) => `${x.p.name}(${x.orig})`) };
  }
  const nChars = new Set(inv.models.filter((o) => o.attach.some((a) => a?.slot === 4)).map(prefix)).size;
  return { rows, sum, nChars, kinds };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = await coverage();
  console.log(`characters (head prefixes): ${c.nChars}`);
  for (const r of c.rows) {
    console.log(`\nBODY ${r.hash} ${r.name} (${r.tris} tris) models ${r.models} zones ${r.zones} characters ${r.chars.length}: ${r.chars.join(' ')}`);
    for (const l of r.lods) console.log(`   ${LODS[l.li] ?? l.li} ${l.name} ${l.orig} -> ${l.key ? `${l.now} (${l.key}, limit ${l.limit})` : 'ORIGINAL'}`);
  }
  for (const [k, s] of Object.entries(c.sum)) console.log(`\n${k}: ${s.contents} unique contents, ${s.replaced} replaced (tris ${s.tris0} -> ${s.tris1}); kept ${s.kept.length}`);
}
