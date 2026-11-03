// Hands: the LDraw hand 3820 (the C-claw with its wrist peg) fitted to the player's hand mesh: the best of the 24 axis rotations by chamfer distance, then a UNIFORM scale + translation (round 10: the
// earlier per-axis box fit stretched the claw into the game's bounding box and made it a fat block; the peg is cut where the game's hand ends and CLOSED with a cap, the old cut left a hollow tube).
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { ldrawToGame, bbox } from './chars-core.mjs';
import { rotations24, applyRot, chamfer, samplePts, splitAtPlane } from '../geom.mjs';
import { fixTJunctions, planeCap } from './chars-geom.mjs';

const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
export const HAND_PART = '3820';
/** where the wrist peg is cut (game axes, LDU; the peg runs along -z): about 3.5 LDU of it stay, the part that sits inside the arm */
export const PEG_CUT = -3.5;
const cache = {};
/** the claw at an LDraw resolution ('low' 190 triangles, 'std' about 250), the peg cut at PEG_CUT and closed: watertight, game axes, LDU */
export function cleanHand(res = 'low') {
  if (cache[res]) return cache[res];
  const f = lib.flatten(HAND_PART + '.dat', { res });
  let t = fixTJunctions(ldrawToGame(f.tris)).tris;
  t = splitAtPlane(t, 2, PEG_CUT);
  const kept = []; for (let i = 0; i < t.length; i += 9) if ((t[i + 2] + t[i + 5] + t[i + 8]) / 3 > PEG_CUT) kept.push(...t.subarray(i, i + 9));
  t = planeCap(Float32Array.from(kept), 2, PEG_CUT, -1).tris;
  cache[res] = { tris: t, infos: f.infos };
  return cache[res];
}
/** mesh positions of the whole original hand -> { rot, fit, d, tris } (best chamfer of the 24 rotations, uniform scale about the bounding box centres) */
export function fitHand(origPos, origIdx, res = 'low') {
  const t = new Float32Array(origIdx.length * 3);
  for (let i = 0; i < origIdx.length; i++) { t[i * 3] = origPos[origIdx[i] * 3]; t[i * 3 + 1] = origPos[origIdx[i] * 3 + 1]; t[i * 3 + 2] = origPos[origIdx[i] * 3 + 2]; }
  const box = bbox(t), ref = samplePts(t);
  const c = cleanHand(res).tris;
  let best = null;
  for (const rot of rotations24()) {
    const r = new Float32Array(c.length);
    for (let i = 0; i < c.length; i += 3) r.set(applyRot(rot, [c[i], c[i + 1], c[i + 2]]), i);
    const sb = bbox(r);
    const ext = [0, 1, 2].map((k) => (box.hi[k] - box.lo[k]) / (sb.hi[k] - sb.lo[k] || 1));
    const s = Math.cbrt(ext[0] * ext[1] * ext[2]);
    const o = [0, 1, 2].map((k) => (box.lo[k] + box.hi[k]) / 2 - s * (sb.lo[k] + sb.hi[k]) / 2);
    const out = new Float32Array(r.length); for (let i = 0; i < r.length; i += 3) for (let k = 0; k < 3; k++) out[i + k] = r[i + k] * s + o[k];
    const d = chamfer(samplePts(out), ref);
    if (!best || d < best.d) best = { d, rot, s, tris: out };
  }
  return best;
}
