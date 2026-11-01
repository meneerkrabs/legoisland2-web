// Hands: the LDraw hand 3820 (claw; the long wrist peg is cut) fitted to the player's hand mesh: the best of the 24 axis rotations by chamfer distance, then the per-axis box fit.
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { ldrawToGame, bbox, boxFit, mapTris } from './chars-core.mjs';
import { rotations24, applyRot, chamfer, samplePts } from '../geom.mjs';

const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
export const HAND_PART = '3820';
let clean = null;
/** the claw at the low LDraw resolution, the wrist peg cut (the arm has its own): 190 triangles. Open at the cut: the hand sits on the arm, the inside is never seen */
export function cleanHand() {
  if (clean) return clean;
  const f = lib.flatten(HAND_PART + '.dat', { res: 'low' });
  const t = ldrawToGame(f.tris);
  const kept = []; for (let i = 0; i < t.length; i += 9) if ((t[i + 2] + t[i + 5] + t[i + 8]) / 3 > -4) kept.push(...t.subarray(i, i + 9));
  clean = { tris: Float32Array.from(kept), infos: f.infos };
  return clean;
}
/** mesh positions of the whole original hand -> { rot, fit, d } (best chamfer of the 24 rotations) */
export function fitHand(origPos, origIdx) {
  const t = new Float32Array(origIdx.length * 3);
  for (let i = 0; i < origIdx.length; i++) { t[i * 3] = origPos[origIdx[i] * 3]; t[i * 3 + 1] = origPos[origIdx[i] * 3 + 1]; t[i * 3 + 2] = origPos[origIdx[i] * 3 + 2]; }
  const box = bbox(t), ref = samplePts(t);
  const c = cleanHand().tris;
  let best = null;
  for (const rot of rotations24()) {
    const r = new Float32Array(c.length);
    for (let i = 0; i < c.length; i += 3) r.set(applyRot(rot, [c[i], c[i + 1], c[i + 2]]), i);
    const fit = boxFit(bbox(r), box);
    const pts = samplePts(r).map((v, i) => v * fit.s[i % 3] + fit.o[i % 3]);
    const d = chamfer(pts, ref);
    if (!best || d < best.d) best = { d, rot, fit, rotated: r };
  }
  return { ...best, tris: mapTris(best.rotated, best.fit) };
}
