// Hair, headgear and accessories (slots 0-3, 5, 7, 9 of the character models): LDraw parts fitted to the game's meshes. Builder only (docs/re/lego3d.md section 8).
//
// Per item (one hat / hair / tool and its LODs):
//  1. the HR mesh is measured: the pool of LDraw minifig parts of its kind (hair, hat, helmet, sword ...) is tried under the 4 yaws (+ mirror) for hair / headgear, the 24 axis rotations (+ mirror)
//     for accessories; the part's rotated box is fitted per axis to the mesh's bounding box (scales within 0.55 .. 1.8, at most 1.7x apart) and scored by the symmetric mean nearest-neighbour
//     distance of outer-surface samples / bbox diagonal (`score`), the mean silhouette IoU over the 3 axis views (`iou`) and the 90th percentile of the distances (`p90`) (chars-gear-fit.mjs).
//     Only the part name, rotation, mirror and the per-axis fit (numbers) are kept; nothing of the game's vertices / UVs goes into the pack.
//  2. accepted when score <= T.score, iou >= T.iou, p90 <= T.p90 (calibrated by looking at renders, see the report) and the item is not on the DENY list (a judgement after looking at it).
//  3. the part is cleaned (T-junctions, hollow inside pruned with the wearer's head as blocker, holes capped), put through the pose + fit, its triangles get the group of the nearest original
//     triangle, then it is decimated (quadric, group borders kept) to the triangle budget of THAT mesh; the blob is checked by assembling it (src/mods/lego3d/chars/static.ts) and measuring the result
//     against the original mesh.
//  4. the other LODs of the item use the same part + pose, fitted to their own box and decimated to their own budget; a LOD that does not reach the budget convincingly stays the game's.
import { searchFit, kindOf, loadPart, bboxOf, rotBox, fitOf, poseTris, areaSamples, outerSamples, makeGrid, nearestDist, chamferGrids, silhouettes, silIoU, nearestPct, HEAD_ROTS, ALL_ROTS, scaleOk, applyPose, UNIT } from './chars-gear-fit.mjs';
import { envelope } from './chars-gear-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decimate } from '../../../src/mods/lego3d/geom/decimate.ts';
import { TriSet } from '../../../src/mods/lego3d/chars/geo.ts';
import GEAR_TABLE from './chars-gear-table.json' with { type: 'json' };

export const GEAR_SLOTS = [0, 1, 2, 3, 5, 7, 9];
/** acceptance thresholds (see the report: calibrated on renders of accepted and rejected candidates) */
export const T = { score: 0.037, iou: 0.84, p90: 0.09, lodIou: 0.78, finalIou: 0.80, finalScore: 0.045 };
/** thin tools: IoU of a 0.2 thick blade is brutal, the chamfer carries the decision */
export const T_ACC = { score: 0.050, iou: 0.50, p90: 0.12, lodIou: 0.45, finalIou: 0.45, finalScore: 0.07 };
/** LODs with fewer triangles than this keep the game's mesh: a decimated part at that count is lumpier than the hand-made original */
export const MIN_LOD_TRIS = 60;
/** accessories: per-axis scale range (min, max, max ratio): game tools are flatter than the LDraw parts */
export const ACC_LIMITS = [0.4, 1.9, 3.0];
/** meshes that are a judgement call: the game's own stays ("convincingly" is looked at, not only measured) */
const DENY = GEAR_TABLE.deny ?? {};
/** item key -> LDraw part chosen by eye among the candidates (the pose is still found by measurement) */
const PREFER = GEAR_TABLE.prefer ?? {};
/** item key -> { iou?, score? }: thresholds relaxed after looking at the render (the thin strands of long hair cost IoU) */
const RELAX = GEAR_TABLE.relax ?? {};

// ---------------------------------------------------------------- items
/** every (model, slot) attachment is a chain of LOD meshes; a hash is "primary" when it is the first mesh (LOD 0) of some chain */
function chainsOf(inv) {
  const chains = [];
  for (const o of inv.models) for (const a of o.attach) {
    if (!a || !GEAR_SLOTS.includes(a.slot)) continue;
    chains.push({ o, a, slot: a.slot, hashes: a.parts.map((p) => p.hash ?? null), parts: a.parts });
  }
  return chains;
}
const kindName = (name) => (/hair|head$/i.test(name) ? 'hair' : /hat|cap$|crown|helm|visor|space_/i.test(name) ? 'headgear' : 'accessory');

// ---------------------------------------------------------------- soup / group helpers
function meshSoup(m, mask = null) {
  const out = [];
  m.groups.forEach((og, gi) => { if (mask && !mask[gi]) return; for (let k = 0; k < og.indexCount; k++) { const v = m.indices[og.firstIndex + k] + og.firstVertex; out.push(m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); } });
  return Float32Array.from(out);
}
/** weld a soup by position keeping a group per triangle; drops degenerate triangles */
function weldGrouped(t, groups, eps = 1e-5) {
  const map = new Map(), pos = [], idx = [], grp = [];
  for (let i = 0; i < t.length; i += 9) {
    const ids = [];
    for (let k = 0; k < 3; k++) {
      const x = t[i + k * 3], y = t[i + k * 3 + 1], z = t[i + k * 3 + 2], key = `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;
      let id = map.get(key); if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(x, y, z); } ids.push(id);
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    idx.push(...ids); grp.push(groups[i / 9]);
  }
  return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx), group: Uint32Array.from(grp) };
}
/** decimate a grouped soup to `target` triangles (no-op when already below) */
function reduceSoup(t, groups, target, crease = 45) {
  const w = weldGrouped(t, groups);
  if (w.idx.length / 3 <= target) return w;
  const r = decimate({ pos: w.pos, idx: w.idx, group: w.group }, { targetTris: target, crease });
  return { pos: r.pos, idx: r.idx, group: r.group };
}
const soupOf = (r) => { const o = new Float32Array(r.idx.length * 3); for (let i = 0; i < r.idx.length; i++) { o[i * 3] = r.pos[r.idx[i] * 3]; o[i * 3 + 1] = r.pos[r.idx[i] * 3 + 1]; o[i * 3 + 2] = r.pos[r.idx[i] * 3 + 2]; } return o; };

/** group of every triangle of `t` = the group of the nearest triangle among `src` (an array of { soup, group }), normals must agree (dot > -0.2) */
function assignGroups(t, origSoup, origGroup, allowed) {
  const nT = origSoup.length / 9, idx = new Uint32Array(nT * 3).map((_, i) => i), keep = [];
  for (let i = 0; i < nT; i++) if (allowed.includes(origGroup[i])) keep.push(i);
  const ts = new TriSet(origSoup, idx, keep);
  const out = new Uint32Array(t.length / 9);
  for (let i = 0; i < out.length; i++) {
    const o = i * 9, c = [(t[o] + t[o + 3] + t[o + 6]) / 3, (t[o + 1] + t[o + 4] + t[o + 7]) / 3, (t[o + 2] + t[o + 5] + t[o + 8]) / 3];
    const e1 = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], e2 = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], nl = Math.hypot(...n) || 1;
    const nn = [n[0] / nl, n[1] / nl, n[2] / nl];
    const hit = ts.closest(c, nn, -0.2, 1e9) ?? ts.closest(c, null, 0, 1e9);
    out[i] = hit ? origGroup[hit.tri] : allowed[0];
  }
  return out;
}

// ---------------------------------------------------------------- one part, one mesh
const prepCache = new Map();
/** the part through pose + fit as the clean outer envelope (chars-gear-env.mjs): hollow inside gone, cracks sealed, the wearer's head (a blocker) closes a cap's opening */
function preparePart(partName, res, pose, fit, head, key, voxel) {
  const ck = `${partName}|${res}|${key}|${voxel}`;
  if (prepCache.has(ck)) return prepCache.get(ck);
  const P = loadPart(partName, res);
  const t = poseTris(pose, fit, P.tris);
  const r = { tris: envelope(t, { voxel, head, blur: 2 }).tris, infos: P.infos };
  prepCache.set(ck, r);
  return r;
}

// ---------------------------------------------------------------- build
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEARCH = !!process.env.GEAR_SEARCH;
const ONLY = process.env.GEAR_ONLY ? new RegExp(process.env.GEAR_ONLY, 'i') : null;   // GEAR_SEARCH=1: (re)do the fit search and write chars-gear-table.json; otherwise the table is used (and every fit re-verified)
/** the voxel size of the envelope: about 1/110 of the part, between 0.02 and 0.04; coarser for far LODs */
const voxelOf = (box, lod) => Math.min(0.04, Math.max(0.02, Math.max(...box.size) / 110)) * (lod > 0 ? 1.2 : 1);

export function buildGear(ctx, tables, inv, h) {
  const A = (zone, member) => { const a = h.archive(zone); const e = a.find(member); return e ? a.read(e) : null; };
  const chains = chainsOf(inv);
  const info = new Map();
  for (const c of chains) c.parts.forEach((p, li) => {
    if (!p.hash) return;
    let e = info.get(p.hash);
    if (!e) info.set(p.hash, e = { hash: p.hash, name: p.name, member: p.member, zone: c.o.zone, members: new Set(), li: new Set(), chains: [], slot: c.slot });
    e.members.add(p.member); e.li.add(li); e.chains.push({ c, li });
  });
  const entries = [...info.values()].sort((a, b) => Math.min(...a.li) - Math.min(...b.li) || a.name.localeCompare(b.name));
  const fits = GEAR_TABLE.fits ?? {}, newFits = {};
  const decisions = new Map();
  const results = [], used = new Map();
  const T0 = Date.now();
  const tick = (m) => { if (process.env.GEAR_TRACE) process.stderr.write(`[gear ${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}\n`); };
  /** the wearer's head (the slot-4 mesh of the same LOD) that overlaps the mesh: some models carry their head far from the hat (another scale), those are no blocker */
  const headOf = (e, box) => {
    if (e.slot !== 5 && e.slot !== 2 && e.slot !== 0) return null;
    let best = null;
    for (const { c, li } of e.chains) {
      const a4 = c.o.attach.find((x) => x?.slot === 4); if (!a4) continue;
      const p = a4.parts[li] ?? a4.parts[0]; if (!p?.hash) continue;
      const b = A(c.o.zone, p.member); if (!b) continue;
      const soup = meshSoup(h.parseMsh(b)), hb = bboxOf(soup);
      const cy = (hb.lo[1] + hb.hi[1]) / 2, cx = (hb.lo[0] + hb.hi[0]) / 2, cz = (hb.lo[2] + hb.hi[2]) / 2;
      const inside = cy > box.lo[1] - 0.6 && cy < box.hi[1] + 0.2 && Math.abs(cx) < 0.3 + Math.abs((box.lo[0] + box.hi[0]) / 2) && Math.abs(cz - (box.lo[2] + box.hi[2]) / 2) < 0.8;
      const d = Math.abs(cy - (box.lo[1] + 0.2));
      if (inside && (!best || d < best.d)) best = { d, soup };
    }
    return best?.soup ?? null;
  };
  const finish = (e, row) => { results.push({ name: e.name, hash: e.hash, ...row }); };

  for (const e of entries) {
    tick(e.name);
    const primary = e.li.has(0) || !e.chains.some(({ c, li }) => li > 0 && c.hashes[0] && c.hashes[0] !== e.hash);
    const bytes = A(e.zone, e.member);
    if (!bytes) continue;
    const m = h.parseMsh(bytes), origTris = m.indices.length / 3, kind = kindName(e.name), itemKey = e.name.replace(/\.msh$/i, '');
    const rows = { kind, origTris, groups: m.groups.length };
    if (DENY[itemKey]) { finish(e, { ...rows, status: 'kept', why: `judged: ${DENY[itemKey]}` }); continue; }
    let dec = null;
    if (primary) {
      if (origTris < 20) { finish(e, { ...rows, status: 'kept', why: `${origTris} triangles: nothing to gain` }); continue; }
      const pref = [].concat(PREFER[itemKey] ?? []);
      const re = pref.length ? ((p) => pref.includes(p.name)) : kindOf(e.name);
      if (!re) { finish(e, { ...rows, status: 'kept', why: 'cloth / blades / no LDraw counterpart' }); continue; }
      let cands = fits[e.hash]?.cands;
      if (SEARCH && ONLY && !ONLY.test(itemKey)) cands = fits[e.hash]?.cands;
      else if (SEARCH || !cands) { if (!SEARCH) { finish(e, { ...rows, status: 'kept', why: 'not in the fit table' }); continue; } cands = search(e, m, re, kind === 'accessory' ? ALL_ROTS : HEAD_ROTS, pref); newFits[e.hash] = { name: e.name, cands }; }
      if (!cands) { finish(e, { ...rows, status: 'kept', why: 'not in the fit table' }); continue; }
      const TT = { ...(kind === 'accessory' ? T_ACC : T), ...(RELAX[itemKey] ?? {}) };
      const ok = cands.find((c) => c.score <= TT.score && c.iou >= TT.iou && c.p90 <= TT.p90 && (!pref.length || pref.includes(c.part)));
      if (!ok) { const b = cands[0]; finish(e, { ...rows, status: 'kept', why: b ? `best ${b.part}: score ${b.score.toFixed(3)} iou ${b.iou.toFixed(2)} p90 ${b.p90.toFixed(3)}: not convincing` : 'no part within the scale limits', best: b }); decisions.set(e.hash, null); continue; }
      dec = { ...ok, pose: { rot: ok.rot, mirror: ok.mirror } };
      decisions.set(e.hash, dec);
    } else {
      for (const { c, li } of e.chains) { const p0 = c.hashes[0]; if (li > 0 && p0 && decisions.get(p0)) { dec = decisions.get(p0); break; } }
      if (!dec) { finish(e, { ...rows, status: 'kept', why: "its HR mesh stays the game's" }); continue; }
      if (origTris < MIN_LOD_TRIS) { finish(e, { ...rows, status: 'kept', why: `LOD with ${origTris} triangles: stays the game's`, part: dec.part }); continue; }
    }
    const ch = e.chains[0], lod = Math.min(...e.li);
    const r = buildMesh(e, m, bytes, dec, { lod, head: headOf(e, bboxOf(meshSoup(m))), primary });
    if (!r.ok) { finish(e, { ...rows, status: 'kept', why: r.why, part: dec.part, metrics: r.metrics }); continue; }
    const key = `gear:${e.hash}`;
    h.addStatic(ctx, tables, key, e.member, e.hash, r.blob, { roles: r.roles, nrmFrom: [], kind, lod, origTris, tris: r.tris, part: dec.part, score: +r.metrics.score.toFixed(4), iou: +r.metrics.iou.toFixed(3) });
    for (const mem of e.members) (tables.members[mem.toLowerCase()] ??= {})[e.hash] = key;
    for (const [f, i] of r.infos) used.set(f, i);
    finish(e, { ...rows, status: 'replaced', part: dec.part, newTris: r.tris, roles: r.roles, metrics: r.metrics, derived: !primary });
  }
  ctx.use(used);
  if (SEARCH) fs.writeFileSync(path.join(HERE, 'chars-gear-table.json'), JSON.stringify({ deny: DENY, prefer: PREFER, relax: RELAX, fits: { ...fits, ...newFits } }, null, 1));
  const rep = results.map((r) => `${r.name.padEnd(24)} ${r.status.padEnd(9)} ${r.origTris}${r.newTris !== undefined ? ' -> ' + r.newTris : ''} ${r.part ?? ''} ${r.metrics ? `s=${r.metrics.score.toFixed(3)} iou=${r.metrics.iou.toFixed(2)}` : ''} ${r.why ?? ''}`);
  const nRep = results.filter((r) => r.status === 'replaced').length;
  ctx.log(`gear: ${nRep} replaced, ${results.length - nRep} kept`);
  if (process.env.GEAR_REPORT) fs.writeFileSync(process.env.GEAR_REPORT, JSON.stringify(results));
  if (process.env.GEAR_TRACE) ctx.log(rep.join('\n'));
  return results;

  // ------------------------------------------------------------ search (primary meshes): best candidates over the group variants
  function search(e, m, re, rots, pref) {
    const nG = m.groups.length, totalTris = m.indices.length / 3;
    const variants = [{ mask: m.groups.map(() => true), excluded: -1 }];
    if (nG > 1) m.groups.forEach((g, gi) => { if (g.indexCount / 3 <= 0.5 * totalTris) variants.push({ mask: m.groups.map((_, k) => k !== gi), excluded: gi }); });
    const all = [];
    for (const v of variants) {
      const t = meshSoup(m, v.mask), box = bboxOf(t);
      for (const r of searchFit(t, re, rots, { top: pref.length ? pref.length : 4, box, limits: rots === ALL_ROTS ? ACC_LIMITS : [0.55, 1.8, 1.7] })) all.push({ part: r.part, title: r.title, rot: r.pose.rot, mirror: r.pose.mirror, excluded: v.excluded, score: r.score, iou: r.iou, p90: r.p90 });
    }
    const rank = (c) => c.score + 0.08 * (1 - c.iou);
    all.sort((a, b) => rank(a) - rank(b));
    const out = []; for (const c of all) if (!out.find((u) => u.part === c.part && u.excluded === c.excluded)) out.push(c);
    return out.slice(0, pref.length ? 12 : 5);
  }
  // ------------------------------------------------------------ one mesh
  function buildMesh(e, m, bytes, dec, { lod, head, primary }) {
    const nG = m.groups.length, fitMask = m.groups.map((_, g) => g !== dec.excluded);
    const origAll = meshSoup(m), fitSoup = meshSoup(m, fitMask), box = bboxOf(fitSoup);
    const res = lod === 0 ? 'std' : 'low';
    const P = loadPart(dec.part, res);
    if (!P) return { ok: false, why: `part ${dec.part} missing` };
    const fit = fitOf(rotBox(P.box, dec.pose.rot), box);
    if (!primary && !scaleOk(fit.s, 0.4, 2.2, 3.2)) return { ok: false, why: 'fit of this LOD out of range' };
    const bkey = box.lo.concat(box.hi).map((x) => x.toFixed(3)).join(',') + dec.pose.rot.join('') + (head ? 'h' : '');
    const prep = preparePart(dec.part, res, dec.pose, fit, head, bkey, voxelOf(box, lod));
    if (prep.tris.length < 9 * 8) return { ok: false, why: 'envelope empty' };
    // groups: S = rebuilt from the part, D = draped (small, lying on the new surface), K = kept
    const origGroup = new Uint32Array(origAll.length / 9); { let k = 0; m.groups.forEach((g, gi) => { for (let j = 0; j < g.indexCount / 3; j++) origGroup[k++] = gi; }); }
    const roles = [], surf = outerSamples(...Object.values(areaSamples(prep.tris, 600))), grid = makeGrid(surf.P, 0.08), totalTris = m.indices.length / 3;
    for (let g = 0; g < nG; g++) {
      if (nG === 1) { roles.push('S'); continue; }
      if (g === dec.excluded) { roles.push('K'); continue; }
      const nt = m.groups[g].indexCount / 3, og = m.groups[g];
      let dsum = 0, dn = 0;
      for (let v = og.firstVertex; v < og.firstVertex + og.vertexCount; v++) { dsum += nearestDist(grid, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); dn++; }
      roles.push(nt <= 16 && nt < 0.3 * totalTris && dsum / dn < 0.08 ? 'D' : 'S');
    }
    const sGroups = roles.map((r, g) => (r === 'S' ? g : -1)).filter((g) => g >= 0);
    if (!sGroups.length) return { ok: false, why: 'no solid group' };
    const grp = assignGroups(prep.tris, origAll, origGroup, sGroups);
    for (const g of sGroups) if (!grp.includes(g)) return { ok: false, why: `group ${g} gets no triangle of the part (a colour the part does not have)` };
    const rolesStr = roles.join('');
    let keepTris = 0; roles.forEach((r, g) => { if (r === 'K') keepTris += m.groups[g].indexCount / 3; if (r === 'D') keepTris += Math.min(40, (m.groups[g].indexCount / 3) * 3); });
    // budget: the mesh's own triangle count; the HR mesh may use up to HR_FACTOR times (the look needs it: the envelope of a hair / hat has more shape than 100 triangles hold)
    const budget = lod === 0 && primary ? Math.round((m.indices.length / 3) * HR_FACTOR) : m.indices.length / 3;
    let target = Math.max(8, budget - keepTris), best = null;
    for (let iter = 0; iter < 8; iter++) {
      const red = reduceSoup(prep.tris, grp, target);
      const blob = h.encodeStatic({ pos: red.pos, idx: red.idx, group: red.group });
      const out = h.assembleStatic(bytes, h.decodeStatic(blob), rolesStr, []);
      if (!out) return { ok: false, why: 'assembler refused' };
      if (out.stats.tris <= budget) { best = { red, blob, out }; break; }
      target = Math.max(8, target - Math.max(2, out.stats.tris - budget));
    }
    if (!best) return { ok: false, why: `cannot reach ${budget} triangles` };
    // the assembled mesh against the original
    const am = h.parseMsh(best.out.bytes), asoup = meshSoup(am);
    const io = silIoU(silhouettes(asoup, box), silhouettes(origAll, box));
    const s1 = areaSamples(asoup, 400), s2 = areaSamples(origAll, 400), p1 = outerSamples(s1.P, s1.N).P, p2 = outerSamples(s2.P, s2.N).P, g1 = makeGrid(p1, 0.08), g2 = makeGrid(p2, 0.08);
    const ch = chamferGrids(p2, g1, p1, g2), diag = Math.hypot(...bboxOf(origAll).size);
    const metrics = { score: ch.mean / diag, iou: io.mean, p90: Math.max(nearestPct(p2, g1, 0.9), nearestPct(p1, g2, 0.9)) / diag };
    const TT = kindName(e.name) === 'accessory' ? T_ACC : T;
    if (metrics.iou < TT.finalIou || metrics.score > TT.finalScore) return { ok: false, why: `after reduction to ${best.out.stats.tris} triangles: score ${metrics.score.toFixed(3)} iou ${metrics.iou.toFixed(2)}`, metrics };
    return { ok: true, blob: best.blob, roles: rolesStr, tris: best.out.stats.tris, metrics, infos: prep.infos };
  }
}

/** how many times the original's triangle count the HR mesh may use (the other LODs: exactly the original's) */
const HR_FACTOR = 2;
