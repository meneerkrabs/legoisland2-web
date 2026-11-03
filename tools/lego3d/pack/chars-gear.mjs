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
//
// Tools held in the claw (slots 7 / 9: sword, axe, chalice ...) are another matter (round 11, docs/re/lego3d.md section 9): the replacement has to be IN the claw's ring, and a blade 2 LDU thick
// does not survive a voxel envelope + blur. They take the `accessory` path of buildMesh:
//  * the grip: the part's handle bar (chars-grip.mjs: cylinder vote at the part's origin, table exceptions) must run along the axis of the claw ring that the pack puts on the game's hand (the
//    ring in the mesh's own frame, through the group matrices); candidates whose handle ends up across it are skipped; the bar's cross-section is held to the ring's radius; the whole part is
//    then moved (the recipe's `shift`) so that the handle's middle lies in the ring's middle. The blob is built in that final place: groups, UVs and colours are read from the game's mesh where the handle is.
//  * the mesh: the real part (T-junctions fixed, hidden inside pruned), at the std LDraw resolution if that fits the budget, else at the low one, reduced by at most ACC_REDUCE; no voxel
//    envelope, no blur. It is shaded with its own crease normals (`geoNormals`): the game's blade is rounder than the library's, its normals do not fit another shape.
import { searchFit, kindOf, loadPart, bboxOf, rotBox, fitOf, poseTris, areaSamples, outerSamples, makeGrid, nearestDist, chamferGrids, silhouettes, silIoU, nearestPct, HEAD_ROTS, ALL_ROTS, scaleOk, applyPose, UNIT } from './chars-gear-fit.mjs';
import { envelope } from './chars-gear-env.mjs';
import { fixTJunctions, visiblePrune } from './chars-geom.mjs';
import { handGrip, partGrip, posedGrip, axisAngle, gripError, rawFrame, boneToRaw, rawToBone, fitHandHeld } from './chars-grip.mjs';
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
/** tools in the claw: the handle's axis may be this many degrees off the ring's axis (the poses are axis rotations: it is 0 or 90) */
export const ACC_GRIP_ANGLE = 3;
/** tools in the claw: a part that needs more than this factor of reduction (low-res pruned part / budget) is not replaced: heavily decimated LDraw parts are the crumpled ones */
export const ACC_REDUCE = 1.25;
/** tools in the claw: the bar's cross-section is scaled to the ring's radius times this (a bar a little thinner than the ring is loose in the claw, a thicker one goes through its wall); the fit may not thin it below the lower factor */
export const ACC_BAR_FIT = [0.85, 1.0];
/** tools in the claw: the part is moved at most this far (game units) to get the handle into the ring */
export const ACC_SHIFT_MAX = 0.7;
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
  const ringCache = new Map(), accCache = new Map();   // tools in the claw (below)
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
    if (ONLY && !SEARCH && !ONLY.test(e.name.replace(/\.msh$/i, ''))) continue;   // dev loop (chars-gear-try.mjs): only these items
    tick(e.name);
    const primary = e.li.has(0) || !e.chains.some(({ c, li }) => li > 0 && c.hashes[0] && c.hashes[0] !== e.hash);
    const bytes = A(e.zone, e.member);
    if (!bytes) continue;
    const m = h.parseMsh(bytes), origTris = m.indices.length / 3, kind = kindName(e.name), itemKey = e.name.replace(/\.msh$/i, '');
    const rows = { kind, origTris, groups: m.groups.length };
    if (DENY[itemKey]) { finish(e, { ...rows, status: 'kept', why: `judged: ${DENY[itemKey]}` }); continue; }
    let dec = null, built = null;
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
      const okList = cands.filter((c) => c.score <= TT.score && c.iou >= TT.iou && c.p90 <= TT.p90 && (!pref.length || pref.includes(c.part)));
      if (!okList.length) { const b = cands[0]; finish(e, { ...rows, status: 'kept', why: b ? `best ${b.part}: score ${b.score.toFixed(3)} iou ${b.iou.toFixed(2)} p90 ${b.p90.toFixed(3)}: not convincing` : 'no part within the scale limits', best: b }); decisions.set(e.hash, null); continue; }
      const gripCtx = kind === 'accessory' ? gripContextOf(e, m) : null;
      if (gripCtx && e.chains.some(({ c }) => c.parts.length > 1)) { finish(e, { ...rows, status: 'kept', why: 'tool in the claw with LOD meshes: all LODs stay the game\'s (a replaced HR next to a game MR would pop; the grip is the game\'s own)', part: okList[0].part }); decisions.set(e.hash, null); continue; }
      if (gripCtx) {
        // a tool in the claw: the first candidate (by shape) whose handle can be put in the ring, first without reducing the part (pass 0), then reduced by at most ACC_REDUCE (pass 1)
        const lodA = Math.min(...e.li), why = [];
        outer: for (const pass of [0, 1]) for (const c of okList) {
          const d2 = { ...c, pose: { rot: c.rot, mirror: c.mirror }, grip: gripCtx, pass };
          const r2 = buildMesh(e, m, bytes, d2, { lod: lodA, head: null, primary });
          if (process.env.GEAR_WHY) console.log(`  ${e.name} pass ${pass} ${c.part}${c.mirror ? 'M' : ''} ex${c.excluded}: ${r2.ok ? 'ok' : r2.why}`);
          if (r2.ok) { dec = d2; built = r2; break outer; }
          if (!why.includes(`${c.part}: ${r2.why}`)) why.push(`${c.part}: ${r2.why}`);
        }
        if (!built) { finish(e, { ...rows, status: 'kept', why: `no part can be put into the claw: ${why.slice(0, 4).join('; ')}`, part: okList[0].part }); decisions.set(e.hash, null); continue; }
      } else {
        dec = { ...okList[0], pose: { rot: okList[0].rot, mirror: okList[0].mirror } };
      }
      decisions.set(e.hash, dec);
    } else {
      for (const { c, li } of e.chains) { const p0 = c.hashes[0]; if (li > 0 && p0 && decisions.get(p0)) { dec = decisions.get(p0); break; } }
      if (!dec) { finish(e, { ...rows, status: 'kept', why: "its HR mesh stays the game's" }); continue; }
      if (dec.grip) { finish(e, { ...rows, status: 'kept', why: 'LOD of a tool in the claw: only the HR mesh is put into the ring (none of the replaced tools has LODs)', part: dec.part }); continue; }
      if (origTris < MIN_LOD_TRIS) { finish(e, { ...rows, status: 'kept', why: `LOD with ${origTris} triangles: stays the game's`, part: dec.part }); continue; }
    }
    const ch = e.chains[0], lod = Math.min(...e.li);
    const r = built ?? buildMesh(e, m, bytes, dec, { lod, head: headOf(e, bboxOf(meshSoup(m))), primary });
    if (!r.ok) { finish(e, { ...rows, status: 'kept', why: r.why, part: dec.part, metrics: r.metrics }); continue; }
    const key = `gear:${e.hash}`;
    h.addStatic(ctx, tables, key, e.member, e.hash, r.blob, { roles: r.roles, nrmFrom: [], kind, lod, origTris, tris: r.tris, part: dec.part, score: +r.metrics.score.toFixed(4), iou: +r.metrics.iou.toFixed(3), ...(r.recipe ?? {}) });
    for (const mem of e.members) (tables.members[mem.toLowerCase()] ??= {})[e.hash] = key;
    for (const [f, i] of r.infos) used.set(f, i);
    finish(e, { ...rows, status: 'replaced', part: dec.part, newTris: r.tris, roles: r.roles, metrics: r.metrics, derived: !primary, grip: r.recipe?.grip });
  }
  ctx.use(used);
  if (SEARCH) fs.writeFileSync(path.join(HERE, 'chars-gear-table.json'), JSON.stringify({ deny: DENY, prefer: PREFER, relax: RELAX, grips: GEAR_TABLE.grips ?? {}, fits: { ...fits, ...newFits } }, null, 1));
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
  // ------------------------------------------------------------ tools in the claw
  /** the ring of the claw that the pack puts on this game hand (hash), in the hand mesh's own frame = the bone's: { c, a, r }; null when the pack keeps the game's hand */
  function ringOfHand(zone, hp) {
    if (!tables.statics[`hand:${hp.hash}`]) return null;
    if (!ringCache.has(hp.hash)) {
      const hm = h.parseMsh(A(zone, hp.member)), f = fitHandHeld(inv, hp, 0, hm), F = rawFrame(hm);
      // the fit is in the hand mesh's raw frame; the mummy's hand carries a group matrix (it is modelled in the model's frame): the ring in the bone's frame
      ringCache.set(hp.hash, F ? rawToBone(F, handGrip(f)) : null);
    }
    return ringCache.get(hp.hash);
  }
  /**
   * What holds this tool: the rings of the claws of every model that carries it (slot 7 <- hand slot 6, slot 9 <- hand slot 8, LOD 0), in the mesh's own frame. `null` = no claw holds it (not a
   * hand-held tool, or the pack keeps the game's hands there); { fail } = held, but this mesh has no single frame; else { target (the ring most models use), uses: [{ model, slot, raw }] }.
   * A mesh that the game attaches to both hands (the sword in the left hand of one model) is one mesh for both: the majority's ring is the target, the others' residuals are reported.
   */
  function gripContextOf(e, m) {
    const uses = [];
    for (const { c, li } of e.chains) {
      if (li !== 0 || (c.slot !== 7 && c.slot !== 9)) continue;
      const ha = c.o.attach.find((x) => x?.slot === (c.slot === 7 ? 6 : 8)), hp = ha?.parts[0];
      if (!hp?.hash) continue;
      const ring = ringOfHand(c.o.zone, hp);
      if (ring) uses.push({ model: `${c.o.zone}:${c.o.model}`, slot: c.slot, ring });
    }
    if (!uses.length) return null;
    const F = rawFrame(m);
    if (!F) return { fail: 'held in the claw, but its groups sit in different frames (MATL)' };
    for (const u of uses) u.raw = boneToRaw(F, u.ring);
    const votes = new Map();
    for (const u of uses) { const k = u.raw.c.map((x) => Math.round(x / 0.02)).join(','); (votes.get(k) ?? votes.set(k, []).get(k)).push(u); }
    const top = [...votes.values()].sort((a, b) => b.length - a.length)[0];
    return { target: top[0].raw, uses };
  }
  /** the part at one LDraw resolution in game units: T-junctions fixed, what cannot be seen pruned (the real part, no voxels); `n` = its triangles. Parts far over the budget are not pruned (the prune is O(n^2)). */
  function accPrep(name, res, limit) {
    const k = `${name}|${res}`;
    if (!accCache.has(k)) {
      const P = loadPart(name, res);
      accCache.set(k, P ? { raw: P.tris.length / 9, infos: P.infos, box: P.box, tris: null, n: P.tris.length / 9, P } : null);
    }
    const r = accCache.get(k);
    if (r && !r.tris && r.raw <= limit) { r.tris = visiblePrune(fixTJunctions(r.P.tris).tris); r.n = r.tris.length / 9; }
    return r;
  }
  /**
   * The nearest-triangle group of the game's mesh is noisy where the part's shape differs (stripes on a handle: red, blue, red): every smooth patch of the part (triangles joined by an edge, dihedral
   * angle under `crease`) takes the group most of its area voted for.
   */
  function patchMajority(t, grp, crease = 40) {
    const n = t.length / 9, eps = 1e-4, cosC = Math.cos((crease * Math.PI) / 180), id = new Map(), vid = (i) => { const k = `${Math.round(t[i] / eps)},${Math.round(t[i + 1] / eps)},${Math.round(t[i + 2] / eps)}`; let v = id.get(k); if (v === undefined) { v = id.size; id.set(k, v); } return v; };
    const nrm = new Float32Array(n * 3), area = new Float32Array(n), edges = new Map(), par = Int32Array.from({ length: n }, (_, i) => i);
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (let i = 0; i < n; i++) {
      const o = i * 9, e1 = [t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]], e2 = [t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]];
      const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...c) || 1;
      nrm.set([c[0] / l, c[1] / l, c[2] / l], i * 3); area[i] = l / 2;
      const v = [vid(o), vid(o + 3), vid(o + 6)];
      for (let k = 0; k < 3; k++) { const a = v[k], b = v[(k + 1) % 3], key = a < b ? `${a}|${b}` : `${b}|${a}`; (edges.get(key) ?? edges.set(key, []).get(key)).push(i); }
    }
    for (const list of edges.values()) for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const i = list[a], j = list[b];
      if (nrm[i * 3] * nrm[j * 3] + nrm[i * 3 + 1] * nrm[j * 3 + 1] + nrm[i * 3 + 2] * nrm[j * 3 + 2] >= cosC) par[find(i)] = find(j);
    }
    const votes = new Map();
    for (let i = 0; i < n; i++) { const r = find(i), v = votes.get(r) ?? new Map(); v.set(grp[i], (v.get(grp[i]) ?? 0) + area[i]); votes.set(r, v); }
    const win = new Map(); for (const [r, v] of votes) win.set(r, [...v].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0][0]);
    return Uint32Array.from({ length: n }, (_, i) => win.get(find(i)));
  }
  function shiftSoup(t, d) { const o = new Float32Array(t.length); for (let i = 0; i < t.length; i += 3) { o[i] = t[i] + d[0]; o[i + 1] = t[i + 1] + d[1]; o[i + 2] = t[i + 2] + d[2]; } return o; }
  function buildAccessory(e, m, bytes, dec, { lod }) {
    const G = dec.grip;
    if (G.fail) return { ok: false, why: G.fail };
    if (dec.excluded >= 0) return { ok: false, why: 'fit variant that keeps a group of the game (it would stay out of the ring)' };
    const nG = m.groups.length, fitMask = m.groups.map((_, g) => g !== dec.excluded);
    const origAll = meshSoup(m), fitSoup = meshSoup(m, fitMask), box = bboxOf(fitSoup);
    const P0 = loadPart(dec.part, 'std');
    if (!P0) return { ok: false, why: 'part missing' };
    const g = partGrip(dec.part);
    if (!g) return { ok: false, why: 'no handle bar (a cylinder of 4 LDU radius at the origin) in the part' };
    // the box fit, then the bar's cross-section held to the ring's radius (the two axes across the handle)
    const rb = rotBox(P0.box, dec.pose.rot);
    let fit = fitOf(rb, box);
    const pg0 = posedGrip(g, dec.pose, fit), ang = axisAngle(pg0.a, G.target.a);
    if (ang > ACC_GRIP_ANGLE) return { ok: false, why: `handle runs ${ang.toFixed(0)} degrees across the ring's axis` };
    const axisI = [0, 1, 2].sort((a, b) => Math.abs(pg0.a[b]) - Math.abs(pg0.a[a]))[0], cap = G.target.r / g.r;
    const s = fit.s.slice(), o = fit.o.slice();
    for (let c = 0; c < 3; c++) if (c !== axisI) { s[c] = Math.min(Math.max(s[c], ACC_BAR_FIT[0] * cap), ACC_BAR_FIT[1] * cap); o[c] = (box.lo[c] + box.hi[c]) / 2 - ((rb.lo[c] + rb.hi[c]) / 2) * s[c]; }
    fit = { s, o };
    if (!scaleOk(fit.s, ...ACC_LIMITS)) return { ok: false, why: `fit out of range (${fit.s.map((x) => x.toFixed(2)).join(' ')})` };
    const pg = posedGrip(g, dec.pose, fit), shift = [0, 1, 2].map((c) => G.target.c[c] - pg.p[c]);
    if (Math.hypot(...shift) > ACC_SHIFT_MAX) return { ok: false, why: `needs to move ${Math.hypot(...shift).toFixed(2)} to get into the ring` };
    // budget and resolution
    const budget = Math.round((m.indices.length / 3) * HR_FACTOR);
    const reduceMax = RELAX[e.name.replace(/\.msh$/i, '')]?.reduce ?? ACC_REDUCE;   // `relax.<item>.reduce`: reduction allowed after looking at the result
    const lim = budget * reduceMax * 2.2;
    const std = accPrep(dec.part, 'std', lim), low = accPrep(dec.part, 'low', lim);
    if (!std || !low) return { ok: false, why: 'part missing' };
    // roles (as for the other gear): S rebuilt, D draped, K kept
    const origGroup = new Uint32Array(origAll.length / 9); { let k = 0; m.groups.forEach((gr, gi) => { for (let j = 0; j < gr.indexCount / 3; j++) origGroup[k++] = gi; }); }
    const surfT = shiftSoup(poseTris(dec.pose, fit, (low.tris ?? low.P.tris)), shift);
    const roles = [], surf = outerSamples(...Object.values(areaSamples(surfT, 600))), grid = makeGrid(surf.P, 0.08), totalTris = m.indices.length / 3;
    for (let gi = 0; gi < nG; gi++) {
      if (nG === 1) { roles.push('S'); continue; }
      if (gi === dec.excluded) { roles.push('K'); continue; }
      const nt = m.groups[gi].indexCount / 3, og = m.groups[gi];
      let dsum = 0, dn = 0;
      for (let v = og.firstVertex; v < og.firstVertex + og.vertexCount; v++) { dsum += nearestDist(grid, m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]); dn++; }
      roles.push(nt <= 16 && nt < 0.3 * totalTris && dsum / dn < 0.08 ? 'D' : 'S');
    }
    const sGroups = roles.map((r, gi) => (r === 'S' ? gi : -1)).filter((gi) => gi >= 0);
    if (!sGroups.length) return { ok: false, why: 'no solid group' };
    let keepTris = 0; roles.forEach((r, gi) => { if (r === 'K') keepTris += m.groups[gi].indexCount / 3; if (r === 'D') keepTris += Math.min(40, (m.groups[gi].indexCount / 3) * 3); });
    const avail = budget - keepTris;
    let use = null;
    if (std.tris && std.n <= avail) use = { res: 'std', part: std, reduced: 1 };
    else if (low.tris && low.n <= avail) use = { res: 'low', part: low, reduced: 1 };
    else if (dec.pass >= 1 && low.tris && low.n <= avail * reduceMax) use = { res: 'low', part: low, reduced: low.n / avail };
    if (!use) return { ok: false, why: `the part has ${std.n} (std) / ${low.n} (low) triangles after pruning, the budget is ${avail}${dec.pass >= 1 ? ` (x${reduceMax} allowed)` : ''}` };
    // the part in its final place (handle in the ring = where the game's handle is): the groups, UVs and normals are read from the game's mesh from here, so they are registered at the grip
    const tris = shiftSoup(poseTris(dec.pose, fit, use.part.tris), shift);
    const grp = patchMajority(tris, assignGroups(tris, origAll, origGroup, sGroups));
    for (const gi of sGroups) if (!grp.includes(gi)) return { ok: false, why: `group ${gi} gets no triangle of the part (a colour the part does not have)` };
    const rolesStr = roles.join('');
    let target = Math.max(8, avail), best = null;
    for (let iter = 0; iter < 8; iter++) {
      const red = reduceSoup(tris, grp, target);
      const blob = h.encodeStatic({ pos: red.pos, idx: red.idx, group: red.group });
      const out = h.assembleStatic(bytes, h.decodeStatic(blob), rolesStr, [], { geoNormals: true });
      if (!out) return { ok: false, why: 'assembler refused' };
      if (out.stats.tris <= budget) { best = { red, blob, out }; break; }
      target = Math.max(8, target - Math.max(2, out.stats.tris - budget));
    }
    if (!best) return { ok: false, why: `cannot reach ${budget} triangles` };
    // the shape against the game's (the original moved by the same shift: the shift is the grip, not part of the shape)
    const am = h.parseMsh(best.out.bytes), asoup = meshSoup(am), origS = shiftSoup(origAll, shift);
    const boxS = { lo: box.lo.map((x, i) => x + shift[i]), hi: box.hi.map((x, i) => x + shift[i]), size: box.size };
    const io = silIoU(silhouettes(asoup, boxS), silhouettes(origS, boxS));
    const s1 = areaSamples(asoup, 400), s2 = areaSamples(origS, 400), p1 = outerSamples(s1.P, s1.N).P, p2 = outerSamples(s2.P, s2.N).P, g1 = makeGrid(p1, 0.08), g2 = makeGrid(p2, 0.08);
    const ch = chamferGrids(p2, g1, p1, g2), diag = Math.hypot(...bboxOf(origAll).size);
    const metrics = { score: ch.mean / diag, iou: io.mean, p90: Math.max(nearestPct(p2, g1, 0.9), nearestPct(p1, g2, 0.9)) / diag };
    if (metrics.iou < T_ACC.finalIou || metrics.score > T_ACC.finalScore) return { ok: false, why: `shape against the game's: score ${metrics.score.toFixed(3)} iou ${metrics.iou.toFixed(2)}`, metrics };
    // the exact grip: the handle's line after the shift against the ring of every use
    const final = { p: pg.p.map((x, i) => x + shift[i]), a: pg.a };
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const useRows = new Map();   // the same error of several models is one row with a count
    for (const u of G.uses) { const er = gripError(final, u.raw), k = `${u.slot}|${r3(er.lateral)}|${r3(er.axial)}|${Math.round(er.angle)}`; const row = useRows.get(k) ?? { slot: u.slot, lat: r3(er.lateral), ax: r3(er.axial), ang: Math.round(er.angle), n: 0 }; row.n++; useRows.set(k, row); }
    const uses = [...useRows.values()];
    const recipe = { shift: shift.map((x) => Math.round(x * 1e4) / 1e4), geoNormals: true, grip: { axis: 'xyz'[axisI], angle: Math.round(ang), zones: [...new Set(G.uses.map((u) => u.model.split(':')[0]))].sort(), res: use.res, reduced: r3(use.reduced), bar: r3(g.r * fit.s[(axisI + 1) % 3] / G.target.r), uses } };
    return { ok: true, blob: best.blob, roles: rolesStr, tris: best.out.stats.tris, metrics, infos: use.part.infos, recipe };
  }

  // ------------------------------------------------------------ one mesh
  function buildMesh(e, m, bytes, dec, { lod, head, primary }) {
    if (dec.grip) return buildAccessory(e, m, bytes, dec, { lod });
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
