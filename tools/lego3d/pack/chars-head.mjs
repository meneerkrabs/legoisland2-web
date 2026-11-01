// Heads: the LDraw head 3626b rebuilt as a loft (rings sliced from the part: the barrel, its bevels, the stud) fitted to the skin group of the player's head mesh; the front band between the
// face group's y limits becomes the face group (UV transferred from the original face group at run time).
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { ldrawToGame, boxFit, mapTris, bbox } from './chars-core.mjs';
import { fixTJunctions, planeCap, visiblePrune } from './chars-geom.mjs';
import { capSmallHoles } from '../geom.mjs';
import { loft, shapeLevels } from './chars-loft.mjs';

const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
export const HEAD_PART = '3626b';
let headClean = null;
/** the LDraw head in game axes (LDU): stud kept, bottom closed, the inside pruned */
export function cleanHead() {
  if (headClean) return headClean;
  const f = lib.flatten(HEAD_PART + '.dat', { res: 'std' });
  let t = fixTJunctions(ldrawToGame(f.tris)).tris;
  const b = bbox(t);
  t = planeCap(t, 1, b.lo[1], -1).tris;
  t = visiblePrune(t);
  t = visiblePrune(capSmallHoles(fixTJunctions(t).tris, 200, 100).tris);
  headClean = { tris: t, infos: f.infos, box: bbox(t) };
  return headClean;
}
/** ring ladder of the head loft, richest first: [K, level cap] */
export const HEAD_LADDER = [[16, 9], [16, 7], [12, 7], [12, 5], [10, 5], [8, 5], [8, 4], [6, 4], [6, 3], [5, 3], [4, 3]];
/**
 * @param skinBox bbox of the original skin group {lo, hi}; @param face { y0, y1, fx } of the original face group (null = no face group)
 * @returns { tris (soup), faceTag (per triangle 0 skin / 1 face), K, levels }
 */
export function buildHead(skinBox0, face, [K, cap], neck = null) {
  const c = cleanHead();
  // a neck (the skin group reaches below the face band: a cylinder under the chin) is added as a tube; the LDraw head body is fitted to the part above it
  const skinBox = neck ? { lo: [skinBox0.lo[0], neck.top, skinBox0.lo[2]], hi: skinBox0.hi } : skinBox0;
  const h = skinBox.hi[1] - skinBox.lo[1];
  const stud = h > 1.15 - (neck ? 0.3 : 0) && skinBox.hi[1] - (face?.y1 ?? skinBox.hi[1]) > 0.1;
  const src = { lo: [c.box.lo[0], c.box.lo[1], c.box.lo[2]], hi: [c.box.hi[0], stud ? c.box.hi[1] : 0, c.box.hi[2]] };
  const fit = boxFit(src, skinBox);
  const t = mapTris(c.tris, fit);
  const lo = skinBox.lo[1], hi = skinBox.hi[1];
  const lv = new Set([+lo.toFixed(3), +hi.toFixed(3)]);
  if (face) {
    if (face.y0 - lo > 0.03) lv.add(+face.y0.toFixed(3));
    if (hi - face.y1 > 0.03) lv.add(+face.y1.toFixed(3));
    // the rows where the game's face quad changes its UV slope (a thin strip at each end maps to the frame's edge texels): a ring at each keeps the mouth where the game has it
    for (const y of face.levels ?? []) if (y > lo + 0.03 && y < hi - 0.03 && ![...lv].some((q) => Math.abs(q - y) < 0.03)) lv.add(+y.toFixed(3));
  }
  for (const y of shapeLevels(t, lo, hi, 0.004).ranked) { if (lv.size >= cap) break; if (y > lo + 0.03 && y < hi - 0.03 && ![...lv].some((q) => Math.abs(q - y) < 0.05)) lv.add(+y.toFixed(3)); }
  const levels = [...lv].sort((a, b) => a - b);
  const soup = loft(t, levels, K, { round: true, squareBottom: true });
  // face tags per side QUAD (two triangles): between the face's y limits, looking to the front, inside its x limits
  const tags = new Uint8Array(soup.length / 9);
  const nSide = 2 * K * (levels.length - 1);
  if (face) for (let q = 0; q + 1 < nSide; q += 2) {
    const o0 = q * 9, o1 = (q + 1) * 9;
    const pts = [[soup[o0], soup[o0 + 1], soup[o0 + 2]], [soup[o0 + 3], soup[o0 + 4], soup[o0 + 5]], [soup[o0 + 6], soup[o0 + 7], soup[o0 + 8]], [soup[o1], soup[o1 + 1], soup[o1 + 2]], [soup[o1 + 3], soup[o1 + 4], soup[o1 + 5]], [soup[o1 + 6], soup[o1 + 7], soup[o1 + 8]]];
    const cy = pts.reduce((s, p) => s + p[1], 0) / 6, cx = pts.reduce((s, p) => s + p[0], 0) / 6, cz = pts.reduce((s, p) => s + p[2], 0) / 6;
    if (cy >= face.y0 - 1e-3 && cy <= face.y1 + 1e-3 && cz > 0.05 && Math.abs(cx) <= face.fx + 1e-3) { tags[q] = 1; tags[q + 1] = 1; }
  }
  if (neck) {   // the neck: a tube of Kn points between the bottom of the skin group and the head (open ends: the top is inside the head, the bottom on the torso)
    const Kn = Math.min(K, 8), ring = (y) => Array.from({ length: Kn }, (_, k) => { const th = (2 * Math.PI * k) / Kn - Math.PI / 4; return [neck.cx + neck.rx * Math.cos(th), y, neck.cz + neck.rz * Math.sin(th)]; });
    const a = ring(neck.bottom), b = ring(neck.top + 0.05), out = [];
    for (let k = 0; k < Kn; k++) { const k1 = (k + 1) % Kn; out.push(...a[k], ...b[k1], ...b[k], ...a[k], ...a[k1], ...b[k1]); }   // outward for a ring counter-clockwise in (x, z), same as loft()
    const flip = orientSign(Float32Array.from(out));
    const nt = flip ? flipSoup(Float32Array.from(out)) : Float32Array.from(out);
    const all = new Float32Array(soup.length + nt.length); all.set(soup); all.set(nt, soup.length);
    const tg = new Uint8Array(tags.length + nt.length / 9); tg.set(tags);
    return { tris: all, tags: tg, K, levels, stud, neckTris: nt.length / 9 };
  }
  return { tris: soup, tags, K, levels, stud };
}

/** a tube's winding must agree with the loft's (the head is a closed solid with a positive signed volume): compares the sign of the tube's sidewall normal at its first quad with the outward direction */
function orientSign(tube) {
  // the first quad's centre is at (cx + r cos, y, cz + r sin): its outward direction is horizontal and away from the tube's axis
  const ax = [0, 0]; let n = 0;
  for (let i = 0; i < tube.length; i += 3) { ax[0] += tube[i]; ax[1] += tube[i + 2]; n++; }
  ax[0] /= n; ax[1] /= n;
  const a = [tube[0], tube[1], tube[2]], b = [tube[3], tube[4], tube[5]], c = [tube[6], tube[7], tube[8]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], nrm = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const cen = [(a[0] + b[0] + c[0]) / 3 - ax[0], (a[2] + b[2] + c[2]) / 3 - ax[1]];
  return nrm[0] * cen[0] + nrm[2] * cen[1] < 0;   // true = the normal points inward: flip
}
function flipSoup(t) { const o = new Float32Array(t.length); for (let i = 0; i < t.length; i += 9) { o.set(t.subarray(i, i + 3), i); o.set(t.subarray(i + 6, i + 9), i + 3); o.set(t.subarray(i + 3, i + 6), i + 6); } return o; }
