// Hands: the LDraw hand 3820 (the C-claw with its wrist peg) fitted to the player's hand mesh: the best of the 24 axis rotations by chamfer distance, then a UNIFORM scale + translation (round 10: the
// earlier per-axis box fit stretched the claw into the game's bounding box and made it a fat block; the peg is cut where the game's hand ends and CLOSED with a cap, the old cut left a hollow tube).
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { ldrawToGame, bbox } from './chars-core.mjs';
import { rotations24, applyRot, chamfer, samplePts, splitAtPlane } from '../geom.mjs';
import { fixTJunctions, planeCap } from './chars-geom.mjs';
import { splitShells } from './chars-wrist.mjs';
import { distSqPointTri } from '../../../src/mods/lego3d/geom/measure.ts';

const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
export const HAND_PART = '3820';
/** where the wrist peg is cut (game axes, LDU; the peg runs along -z): about 3.5 LDU of it stay, the part that sits inside the arm. The FIT works on the claw with this peg (so the ring stays where it was); since round 12 the
 *  neck (collar + peg) of the generated hand is built anew onto the arm's cuff (chars-wrist.mjs) */
export const PEG_CUT = -3.5;
const cache = {};
/**
 * the claw at an LDraw resolution ('low' 190 triangles, 'std' about 250), the peg cut at PEG_CUT and closed: watertight, game axes, LDU. `tris` is the whole claw, as it always was (the fit works on it).
 * Round 12: `body` (the C ring) and `neck` (the collar with the wrist peg, a shell of its own that only passes through the ring's top wall) are the same claw in two pieces, for chars-wrist.mjs which moves
 * the neck onto the arm's cuff: `neck` = the separate shell cut and capped, `body` = the triangles of `tris` that are not on its surface (the ring wall inside the collar stays: the ring is a closed shell).
 */
export function cleanHand(res = 'low') {
  if (cache[res]) return cache[res];
  const f = lib.flatten(HAND_PART + '.dat', { res });
  const cut = (raw) => {
    let t = fixTJunctions(raw).tris;
    t = splitAtPlane(t, 2, PEG_CUT);
    const kept = []; for (let i = 0; i < t.length; i += 9) if ((t[i + 2] + t[i + 5] + t[i + 8]) / 3 > PEG_CUT) kept.push(...t.subarray(i, i + 9));
    return planeCap(Float32Array.from(kept), 2, PEG_CUT, -1).tris;
  };
  const raw = ldrawToGame(f.tris), t = cut(raw);
  const shells = splitShells(raw), zmin = (x) => { let m = 1e9; for (let i = 2; i < x.length; i += 3) m = Math.min(m, x[i]); return m; };
  shells.sort((a, b) => zmin(a) - zmin(b));
  const neck = cut(shells[0]);   // the shell with the lowest z: the collar + the peg's far end
  const body = [];
  for (let i = 0; i < t.length; i += 9) {
    const c = [0, 1, 2].map((k) => (t[i + k] + t[i + 3 + k] + t[i + 6 + k]) / 3);
    let on = false; for (let j = 0; j < neck.length && !on; j += 9) on = distSqPointTri(c, [neck[j], neck[j + 1], neck[j + 2]], [neck[j + 3], neck[j + 4], neck[j + 5]], [neck[j + 6], neck[j + 7], neck[j + 8]]) < 4e-6;
    if (!on) body.push(...t.subarray(i, i + 9));
  }
  cache[res] = { tris: t, body: Float32Array.from(body), neck, infos: f.infos };
  return cache[res];
}
/**
 * mesh positions of the whole original hand -> { rot, s, o, d, tris } (best chamfer of the 24 rotations, uniform scale about the bounding box centres: a claw point p lands on s * rot * p + o).
 * `ringAxes` (unit vectors in the hand mesh's own frame, optional): the directions in which the game's tools run through this hand (chars-grip.mjs heldAxes). The claw's ring axis is the claw's y axis; a
 * hand that is nearly square in section fits the claw about equally well turned a quarter about its arm (the mummy's: 0.058 against 0.062), and the tool then goes through the claw's wall instead
 * of its ring. When the best rotation's ring axis is none of `ringAxes`, the best rotation that has one wins if it is at most `tol` times as far (chamfer) as the best.
 */
export function fitHand(origPos, origIdx, res = 'low', { ringAxes = null, tol = 1.25 } = {}) {
  const t = new Float32Array(origIdx.length * 3);
  for (let i = 0; i < origIdx.length; i++) { t[i * 3] = origPos[origIdx[i] * 3]; t[i * 3 + 1] = origPos[origIdx[i] * 3 + 1]; t[i * 3 + 2] = origPos[origIdx[i] * 3 + 2]; }
  const box = bbox(t), ref = samplePts(t);
  const c = cleanHand(res).tris;
  const all = [];
  for (const rot of rotations24()) {
    const r = new Float32Array(c.length);
    for (let i = 0; i < c.length; i += 3) r.set(applyRot(rot, [c[i], c[i + 1], c[i + 2]]), i);
    const sb = bbox(r);
    const ext = [0, 1, 2].map((k) => (box.hi[k] - box.lo[k]) / (sb.hi[k] - sb.lo[k] || 1));
    const s = Math.cbrt(ext[0] * ext[1] * ext[2]);
    const o = [0, 1, 2].map((k) => (box.lo[k] + box.hi[k]) / 2 - s * (sb.lo[k] + sb.hi[k]) / 2);
    const out = new Float32Array(r.length); for (let i = 0; i < r.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = r[i + k] * s + o[k];
    all.push({ d: chamfer(samplePts(out), ref), rot, s, o, tris: out, ring: applyRot(rot, [0, 1, 0]) });
  }
  all.sort((a, b) => a.d - b.d);
  let best = all[0];
  if (ringAxes?.length) {
    const on = (x) => ringAxes.some((a) => Math.abs(a[0] * x.ring[0] + a[1] * x.ring[1] + a[2] * x.ring[2]) > 0.99);
    if (!on(best)) { const alt = all.find((x) => on(x) && x.d <= best.d * tol); if (alt) best = { ...alt, turned: true, bestD: best.d }; }
  }
  // the same claw in its two pieces, placed like `tris` (round 12)
  const place = (q) => { const o = new Float32Array(q.length); for (let i = 0; i < q.length; i += 3) { const p = applyRot(best.rot, [q[i], q[i + 1], q[i + 2]]); for (let k = 0; k < 3; k++) o[i + k] = p[k] * best.s + best.o[k]; } return o; };
  const parts = cleanHand(res);
  return { ...best, bodyTris: place(parts.body), neckTris: place(parts.neck), claw: parts };
}
