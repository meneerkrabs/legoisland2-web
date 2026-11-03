#!/usr/bin/env node
// Grip check (docs/re/lego3d.md section 9, round 11): is every accessory in the claw's ring?
//   node tools/lego3d/grip-check.mjs [--pack FILE] [--json OUT] [--only REGEX] [--plain-hands]
// (`--plain-hands`: the claws as they were before round 11, fitted by chamfer only, for the packs of that time; default: the claws as the builder now turns them to the tools they hold)
// For every (accessory, hand) pair of the game's character models (hand slot 6 holds slot 7, hand slot 8 holds slot 9; LOD 0 and 1) it takes the game's accessory in the bone's coordinate
// system (the mesh through its group matrix, MATL) and the ring of the claw that the pack puts on the game's hand (chars-grip.mjs: the claw fitted to the hand, its ring hole), and measures
// where the handle is: the principal axis of the accessory's surface inside a ball around the ring's centre (the bar passes through the ring; the same estimator for the game's own tools
// and for the replacements, so the numbers are comparable). Reported in game units (the ring is 0.16 in radius, the hand 0.5 wide):
//   lat   distance of the handle's axis from the ring's axis at the ring's centre   (0 = the bar runs through the ring's middle)
//   ax    distance of the handle's middle from the ring's centre along the axis      (the claw is 0.45 tall)
//   ang   angle between the handle's axis and the ring's axis in degrees
//   recipe: when the pack records the exact grip line of a replacement (`grip`), its own lat / ax / ang
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { generateArchive } from '../../src/mods/lego3d/gen/index.ts';
import { parseMsh, groupMatrices } from '../../src/formats/msh.ts';
import { archive } from './lib.mjs';
import { loadInventory } from './chars-inventory.mjs';
import { handGrip, rawFrame, rawToBone, fitHandHeld } from './pack/chars-grip.mjs';
import { fitHand } from './pack/chars-hand.mjs';
import { areaSamples } from './pack/chars-gear-fit.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i < 0 ? d : args[i + 1]; };
const PACK = opt('--pack', path.join(here, '../../src/mods/lego3d/data/lego3d.pack'));
const PLAIN = args.includes('--plain-hands');
const ONLY = opt('--only', '') ? new RegExp(opt('--only', ''), 'i') : null;
const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
const tables = await pack.json('chars/tables.json');
const inv = loadInventory();

/** a mesh in the bone's coordinate system: every group through its MATL matrix (row vectors, v * M), as the game draws it */
function boneSoup(m) {
  const M = groupMatrices(m), out = [];
  m.groups.forEach((g, gi) => {
    const T = M[gi];
    for (let k = 0; k < g.indexCount; k++) {
      const v = m.indices[g.firstIndex + k] + g.firstVertex, x = m.positions[v * 3], y = m.positions[v * 3 + 1], z = m.positions[v * 3 + 2];
      if (T) out.push(x * T[0] + y * T[4] + z * T[8] + T[12], x * T[1] + y * T[5] + z * T[9] + T[13], x * T[2] + y * T[6] + z * T[10] + T[14]); else out.push(x, y, z);
    }
  });
  return Float32Array.from(out);
}
/** the handle of a mesh near a ring `h` ({ c, a, r }): principal axis + centroid of the surface samples inside a ball of 2.6 ring radii (the guard / blade / head beyond it are mostly outside) */
function estimateHandle(soup, h, ballK = 2.6) {
  const s = areaSamples(soup, 6000), rho = ballK * h.r, pts = [];
  for (let i = 0; i < s.P.length; i += 3) if (Math.hypot(s.P[i] - h.c[0], s.P[i + 1] - h.c[1], s.P[i + 2] - h.c[2]) <= rho) pts.push([s.P[i], s.P[i + 1], s.P[i + 2]]);
  if (pts.length < 12) return null;
  const mu = [0, 1, 2].map((c) => pts.reduce((a, p) => a + p[c], 0) / pts.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += (p[i] - mu[i]) * (p[j] - mu[j]);
  let v = [1, 0.7, 0.4];
  for (let it = 0; it < 60; it++) { const w = [0, 1, 2].map((i) => C[i][0] * v[0] + C[i][1] * v[1] + C[i][2] * v[2]); const l = Math.hypot(...w) || 1; v = w.map((x) => x / l); }
  return { c: mu, a: v, n: pts.length };
}
function errorOf(g, h) {
  const d = [g.c[0] - h.c[0], g.c[1] - h.c[1], g.c[2] - h.c[2]], a = h.a, al = d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
  const lat = Math.hypot(d[0] - a[0] * al, d[1] - a[1] * al, d[2] - a[2] * al);
  const cos = Math.min(1, Math.abs(g.a[0] * a[0] + g.a[1] * a[1] + g.a[2] * a[2]));
  return { lat, ax: Math.abs(al), ang: (Math.acos(cos) * 180) / Math.PI };
}

// ---- the uses
const uses = new Map();
for (const o of inv.models) for (const [hs, as] of [[6, 7], [8, 9]]) {
  const h = o.attach.find((x) => x?.slot === hs), a = o.attach.find((x) => x?.slot === as);
  if (!h || !a) continue;
  for (let li = 0; li <= 1; li++) {   // a single-mesh tool is drawn at every LOD: it meets the HR claw and the MR claw
    const ap = a.parts[Math.min(li, a.parts.length - 1)], hp = h.parts[Math.min(li, h.parts.length - 1)];
    if (!ap?.hash || !hp?.hash) continue;
    const key = `${ap.hash}|${hp.hash}|${as}|${li}`;
    let u = uses.get(key);
    if (!u) uses.set(key, u = { key, acc: ap, hand: hp, slot: as, li, zone: o.zone, models: [] });
    u.models.push(`${o.zone}:${o.model}`);
  }
}
const gens = new Map();
const generated = async (zone) => { if (!gens.has(zone)) gens.set(zone, await generateArchive(pack, zone, archive(zone), async () => null, ['characters'])); return gens.get(zone); };
const f3 = (x) => x.toFixed(3);
const rows = [];
for (const u of [...uses.values()].sort((x, y) => x.acc.name.localeCompare(y.acc.name) || x.slot - y.slot || x.li - y.li)) {
  if (ONLY && !ONLY.test(u.acc.name)) continue;
  const A = archive(u.zone), handE = A.find(u.hand.member), accE = A.find(u.acc.member);
  if (!handE || !accE) continue;
  const handKey = tables.members[u.hand.member.toLowerCase()]?.[u.hand.hash];
  const row = { acc: u.acc.name, slot: u.slot, lod: u.li, hand: u.hand.name, handReplaced: !!handKey, models: u.models.length, replaced: false };
  const hm = parseMsh(A.read(handE));
  const fit = PLAIN ? fitHand(hm.positions, Array.from(hm.indices), u.li === 0 ? 'std' : 'low') : fitHandHeld(inv, u.hand, u.li, hm);
  const HF = rawFrame(hm), ring = HF ? rawToBone(HF, handGrip(fit)) : handGrip(fit);   // the fit is in the hand mesh's raw frame (the mummy's hand carries a group matrix)
  row.ring = { c: ring.c.map((x) => +f3(x)), a: ring.a, r: +f3(ring.r) };
  const orig = parseMsh(A.read(accE));
  const g0 = estimateHandle(boneSoup(orig), ring);
  row.orig = g0 ? errorOf(g0, ring) : null;
  const key = tables.members[u.acc.member.toLowerCase()]?.[u.acc.hash];
  if (key && tables.statics[key]) {
    const gen = await generated(u.zone), out = gen.files.get(accE.path);
    if (out) {
      row.replaced = true; row.part = tables.statics[key].part;
      const g1 = estimateHandle(boneSoup(parseMsh(out)), ring);
      row.new = g1 ? errorOf(g1, ring) : null;
      const rec = tables.statics[key];
      if (rec.grip && rec.shift !== undefined) row.recipe = { shift: rec.shift, gripAngle: rec.grip.angle, residual: rec.grip.residual };
    }
  }
  rows.push(row);
}
const fmt = (e) => (e ? `lat ${f3(e.lat)} ax ${f3(e.ax)} ang ${e.ang.toFixed(0).padStart(2)}` : 'no handle found');
console.log(`pack ${PACK}`);
console.log('accessory (slot, LOD, hand)                                  game own                               replacement');
for (const r of rows) console.log(`${(r.acc + ' (' + r.slot + ', ' + r.lod + ', ' + r.hand + (r.handReplaced ? '' : ' [game hand]') + ') x' + r.models).padEnd(62)} ${fmt(r.orig).padEnd(36)} ${r.replaced ? r.part + ' ' + fmt(r.new) + (r.recipe ? `  recipe: shift ${JSON.stringify(r.recipe.shift)} ang ${r.recipe.gripAngle?.toFixed?.(1)}` : '') : ''}`);
if (opt('--json', '')) fs.writeFileSync(opt('--json', ''), JSON.stringify(rows, null, 1));
