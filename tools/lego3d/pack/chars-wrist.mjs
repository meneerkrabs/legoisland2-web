// The wrist join of the characters (docs/re/lego3d.md "Round 12"). Builder only.
//
// The claw 3820 comes as two shells: the BODY (the C ring) and the NECK (the collar r 3 LDU with the wrist peg r 2.5 above it, whose lower end is cut by the ring's top wall). fitHand puts the claw on the
// game's hand mesh with its RING where the game's tools are held (the grip: chars-grip.mjs), and that leaves the neck at the claw's own peg position: 0.15 - 0.2 game units in front of the axis of the
// game's forearm and square to the ground while the forearm leans 16 - 20 degrees forward: the peg stood beside the cuff, not in it (MR: not even touching).
// The ring cannot move, the neck can: it is built anew here, a straight tube whose axis runs from a point on the ring's top wall through the centre of the arm's cuff, nearly along the cuff's own axis;
// the collar's top face lies in the cuff's end plane (sunk in just far enough that the neck's lean leaves no wedge) and the peg goes on into the sleeve, as a real minifig hand's does; the collar's
// lower end is cut by the ring's surface. The wrist bone sits in the sleeve on that axis (0.075 above the cuff, measured), so a wrist rotation turns the hand about a point in the sleeve.
import { parseMsh } from '../../../src/formats/msh.ts';
import { parseSvwl, skinPositions } from '../../../src/formats/anim.ts';
import { BONES } from './chars-core.mjs';

/** the cuffs of the generated bodies, by body key ('pepp-0', 'mfg-1', 'skel1-0'): { R: { c, n }, L: { c, n } } in the bind pose (world): c = centre of the arm's end face, n = its outward normal (down the arm) */
export const CUFFS = new Map();
/** how far (LDU) the collar's lower end is sunk into the ring's surface, and how much deeper the closing fan's centre lies */
const SURF_SINK = 0.5, SURF_FAN = 0.6;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** connected shells of a triangle soup (vertices welded at 1e-4): [Float32Array] */
export function splitShells(tris) {
  const K = (i) => `${Math.round(tris[i] * 1e4)},${Math.round(tris[i + 1] * 1e4)},${Math.round(tris[i + 2] * 1e4)}`;
  const par = new Map(); const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  const keys = [];
  for (let i = 0; i < tris.length; i += 9) {
    const k = [K(i), K(i + 3), K(i + 6)]; keys.push(k);
    for (const x of k) if (!par.has(x)) par.set(x, x);
    par.set(find(k[0]), find(k[1])); par.set(find(k[1]), find(k[2]));
  }
  const groups = new Map();
  keys.forEach((k, t) => { const r = find(k[0]); (groups.get(r) ?? groups.set(r, []).get(r)).push(t); });
  return [...groups.values()].map((ts) => { const o = new Float32Array(ts.length * 9); ts.forEach((t, j) => o.set(tris.subarray(t * 9, t * 9 + 9), j * 9)); return o; });
}

/** minimal rotation taking unit a onto unit b (Rodrigues), as a function of a vector */
export function rotTo(a, b) {
  const v = cross(a, b), c = dot(a, b), s2 = dot(v, v);
  if (s2 < 1e-14) return c > 0 ? (p) => p : (p) => [-p[0], -p[1], -p[2]];   // (a turn of 180 degrees never happens here)
  const k = (1 - c) / s2;
  return (p) => { const vp = cross(v, p); return [p[0] + vp[0] + k * (v[1] * vp[2] - v[2] * vp[1]), p[1] + vp[1] + k * (v[2] * vp[0] - v[0] * vp[2]), p[2] + vp[2] + k * (v[0] * vp[1] - v[1] * vp[0])]; };
}

/**
 * The end face of an arm in a body mesh (parsed `m`, its skin `sv`, the bind-pose positions `X`): the flat face of the arm (every vertex's primary bone in `arm`, [upper, lower]) that reaches furthest
 * down the arm (along the bone direction elbow -> wrist) and looks down it (normal . bone direction > 0.85), taken as one PLANE. -> { tris: [[v, v, v]], T: the same as corner positions, d0, smax, s: position -> distance along d0 }
 * A slab of the last 0.12 would not do: a loft's cap is LEVEL while the bone leans, so its corners span about 0.25 along the bone, and a painted band cuts the cap into pieces (Pepper's MR arm: the
 * slab kept one corner triangle, off-centre, and the neck of the right hand landed 0.11 beside the sleeve).
 */
export function endFace(m, sv, X, arm) {
  const lo = arm[1], b = (i) => [BONES[i * 16 + 12], BONES[i * 16 + 13], BONES[i * 16 + 14]], d0 = unit(sub(b(lo + 1), b(lo)));
  const T = [], I = [];
  for (const g of m.groups) for (let t = 0; t < g.indexCount; t += 3) {
    const v = [0, 1, 2].map((k) => m.indices[g.firstIndex + t + k] + g.firstVertex);
    if (v.every((i) => arm.includes(sv.bone[i]))) { I.push(v); T.push(v.map((i) => [X[i * 3], X[i * 3 + 1], X[i * 3 + 2]])); }
  }
  const s = (p) => dot(sub(p, b(lo)), d0), smax = T.length ? Math.max(...T.flat().map(s)) : 0, planes = [];
  T.forEach(([p, q, r], k) => {
    const nn = cross(sub(q, p), sub(r, p)), l = Math.hypot(...nn);
    if (l < 1e-12) return;
    const u = unit(nn); if (dot(u, d0) < 0.85) return;
    const off = dot([(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3], u);
    let F = planes.find((f) => dot(f.u, u) > 0.999 && Math.abs(f.off - off) < 0.01);
    if (!F) planes.push(F = { u, off, area: 0, smax: -1e9, idx: [] });
    F.area += l / 2; F.smax = Math.max(F.smax, s(p), s(q), s(r)); F.idx.push(k);
  });
  if (!planes.length) return { tris: [], T: [], all: T, d0, smax, s };
  planes.sort((x, y) => y.smax - x.smax || y.area - x.area);
  return { tris: planes[0].idx.map((k) => I[k]), T: planes[0].idx.map((k) => T[k]), all: T, d0, smax, s };
}

/**
 * The cuff of an arm in a generated (or the game's) body mesh in the bind pose: the arm's end face (endFace); { c: area-weighted centre, n: unit outward normal, a: the unit axis of the tube down the arm, r:
 * radius of the face (from its area) }. Works for the real arm's tilted disc and the lofts' / skeleton's flat caps alike.
 */
export function cuffOf(bytes, arm) {
  const m = parseMsh(bytes), sv = parseSvwl(m.svwl, m.vertexCount), X = skinPositions(m.positions, sv, BONES), E = endFace(m, sv, X, arm);
  if (!E.all.length) return null;
  let A = 0; const c = [0, 0, 0], n = [0, 0, 0];
  for (const [p, q, r] of E.T) {
    const nn = cross(sub(q, p), sub(r, p)), area = Math.hypot(...nn) / 2, u = unit(nn), cen = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3, (p[2] + q[2] + r[2]) / 3];
    A += area; for (let k = 0; k < 3; k++) { c[k] += cen[k] * area; n[k] += u[k] * area; }
  }
  if (A <= 0) return null;
  // the tube's own axis (the end face of a loft or of the skeleton's shaft is level, the tube behind it leans): from the middle of the arm's cross-section 0.15 - 0.3 up the arm to the face's centre
  const far = []; for (const t of E.all) for (const q of t) { const d = E.smax - E.s(q); if (d > 0.15 && d < 0.3) far.push(q); }
  const cc = c.map((x) => x / A), nn = unit(n), axis = far.length >= 6 ? unit(sub(cc, [0, 1, 2].map((k) => far.reduce((mm, q) => mm + q[k], 0) / far.length))) : nn;
  return { c: cc, n: nn, a: dot(axis, nn) > 0.94 ? axis : nn, r: Math.sqrt(A / Math.PI) };   // (the axis not more than 20 degrees off the face normal: a painted band or a decal group on the arm pulls the slab off the tube)
}

/** a cuff of the bind world frame into a bone's local frame (the hand's bone: translation + rotation of its bind matrix) */
export function cuffToBone(cuff, bone) {
  const o = bone * 16, Rm = [BONES[o], BONES[o + 1], BONES[o + 2], BONES[o + 4], BONES[o + 5], BONES[o + 6], BONES[o + 8], BONES[o + 9], BONES[o + 10]];
  const loc = (p) => [p[0] * Rm[0] + p[1] * Rm[1] + p[2] * Rm[2], p[0] * Rm[3] + p[1] * Rm[4] + p[2] * Rm[5], p[0] * Rm[6] + p[1] * Rm[7] + p[2] * Rm[8]];   // (rotation: transpose = inverse)
  return { c: loc(sub(cuff.c, [BONES[o + 12], BONES[o + 13], BONES[o + 14]])), n: unit(loc(cuff.n)), a: unit(loc(cuff.a ?? cuff.n)), r: cuff.r };
}

/** z of the first surface met by the ray from (x, y, -20) along +z, or null */
function zTop(x, y, tris) {
  const t = firstHit([x, y, -20], [0, 0, 1], tris);
  return t === null ? null : t - 20;
}
/** distance t > 0 along the ray o + t d to the first surface of the soup, or null */
function firstHit(o, d, tris) {
  let best = null;
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]], e1 = [tris[i + 3] - a[0], tris[i + 4] - a[1], tris[i + 5] - a[2]], e2 = [tris[i + 6] - a[0], tris[i + 7] - a[1], tris[i + 8] - a[2]];
    const p = cross(d, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-14) continue;
    const inv = 1 / det, sv = sub(o, a), u = dot(sv, p) * inv;
    if (u < 0 || u > 1) continue;
    const q = cross(sv, e1), v = dot(d, q) * inv;
    if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) * inv; if (t > 1e-9 && (best === null || t < best)) best = t;
  }
  return best;
}

/**
 * A new neck in its own frame: z runs along the axis from the top face (z = 0, at the cuff's end plane) towards the ring. The wrist peg (radius rp, from the tip at z = zTip to 0), the step, the collar
 * (radius rc, from z = 0 down to the ring): its lower end is cut by the ring's surface, `zb[k]` = where the collar's k-th side line ends (N values), `zc` = the centre of the closing fan below them (inside the
 * ring's wall). A flat cap at the tip. Outward windings. Triangle soup in LDU.
 */
export function buildNeck(N, zb, zc, { rc = 3, rp = 2.5, zTip = -3.5 } = {}) {
  const out = [], P = (r, k, z) => [r * Math.cos((2 * Math.PI * k) / N), r * Math.sin((2 * Math.PI * k) / N), z];
  const tri = (a, b, c, want) => { const n = cross(sub(b, a), sub(c, a)); if (dot(n, want(a, b, c)) >= 0) out.push(...a, ...b, ...c); else out.push(...a, ...c, ...b); };
  const radial = (a, b, c) => [a[0] + b[0] + c[0], a[1] + b[1] + c[1], 0];
  for (let k = 0; k < N; k++) {
    const k1 = (k + 1) % N;
    tri(P(rp, k, zTip), P(rp, k1, zTip), P(rp, k1, 0), radial); tri(P(rp, k, zTip), P(rp, k1, 0), P(rp, k, 0), radial);   // the peg
    tri(P(rp, k, 0), P(rp, k1, 0), P(rc, k1, 0), () => [0, 0, -1]); tri(P(rp, k, 0), P(rc, k1, 0), P(rc, k, 0), () => [0, 0, -1]);   // the step between peg and collar (the collar's top face)
    tri(P(rc, k, 0), P(rc, k1, 0), P(rc, k1, zb[k1]), radial); tri(P(rc, k, 0), P(rc, k1, zb[k1]), P(rc, k, zb[k]), radial);   // the collar
    tri([0, 0, zTip], P(rp, k, zTip), P(rp, k1, zTip), () => [0, 0, -1]);   // the peg's end
    tri([0, 0, zc], P(rc, k, zb[k]), P(rc, k1, zb[k1]), () => [0, 0, 1]);   // the fan that closes the lower end inside the ring's wall
  }
  return Float32Array.from(out);
}
const rotT = (m, v) => [m[0] * v[0] + m[3] * v[1] + m[6] * v[2], m[1] * v[0] + m[4] * v[1] + m[7] * v[2], m[2] * v[0] + m[5] * v[1] + m[8] * v[2]];   // the inverse of applyRot (a signed permutation)

/**
 * Builds the neck of a fitted claw anew and puts it onto the arm's cuff. `f` = fitHand's result (rot, s, o: a claw point p lands on s rot p + o; bodyTris = the ring placed on the game's hand mesh; claw =
 * the claw's own pieces, the body in the claw frame), `cuff` = { c, n, a, r } in the hand mesh's own frame (the end face's centre, outward normal, radius, the tube's axis down the arm), `applyRot` = geom.mjs' rotation, `N` = sides of the tube.
 * The ring is not moved (that is the grip). The neck is a straight tube from a point B on the ring's top wall through the cuff's centre c; B is searched over the wall (along the ring's axis from where the
 * collar's footprint still lies on the ring to its far end, across it near the cuff's x): the candidate whose neck leans least against the cuff's axis wins, provided every side line of the collar meets the ring's
 * surface. The collar's top face is put in the cuff's end plane, sunk in by r tan(angle against the plane's normal) + 0.3 LDU (no wedge of daylight on the far side), the peg goes 3.5 LDU on into the sleeve.
 * -> null (no B) or { tris (ring + new neck, on the hand mesh, same placement as f.tris), x, y (where the neck stands on the ring: claw LDU across / along the ring's axis; LDraw has it at 0, 0), tilt (degrees the neck leans against the cuff's axis), sink (LDU), len (LDU of neck showing between the cuff plane and the ring) }
 */
export function placeNeck(f, cuff, applyRot, { N = 16 } = {}) {
  const toClaw = (p) => rotT(f.rot, [(p[0] - f.o[0]) / f.s, (p[1] - f.o[1]) / f.s, (p[2] - f.o[2]) / f.s]), body = f.claw.body;
  const C = toClaw(cuff.c), upC = unit(rotT(f.rot, [-cuff.a[0], -cuff.a[1], -cuff.a[2]])), upN = unit(rotT(f.rot, [-cuff.n[0], -cuff.n[1], -cuff.n[2]]));   // up the tube / out of the end face's plane
  const ang = (a, b) => (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI;
  // the collar is 3 LDU in radius and the peg 2.5 (3.5 LDU long past the end face), as the part has them, unless the sleeve is narrower than the real minifig's (the skeleton's shaft: 3.3 LDU, a hollow of 0.17 only):
  // then the peg is slimmer and shorter, with room for the wrist to turn (the collar stays 3: the silhouette of the hand against the game's hand is better with it)
  const rCuff = cuff.r > 0.08 ? cuff.r / f.s : 99, rc = Math.min(3, rCuff), rp = Math.min(2.5, 0.7 * rCuff), zTip = rCuff < 4.5 ? -2.5 : -3.5, frame = (u) => { const ez = [-u[0], -u[1], -u[2]], e1 = unit(cross(ez, Math.abs(ez[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])); return { ez, e1, e2: cross(ez, e1) }; };
  // where the n side lines of the collar (radius rc, from the top face along the neck) meet the ring's surface: distances from the top face, or null when one misses (the footprint is not on the ring)
  const sides = (top, fr, n, D0) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n, q = [0, 1, 2].map((c) => top[c] + (fr.e1[c] * Math.cos(a) + fr.e2[c] * Math.sin(a)) * rc);
      const t = firstHit([0, 1, 2].map((c) => q[c] - fr.ez[c] * 8), fr.ez, body);   // from above the top face, along the neck: the ring's outer surface
      if (t === null || t - 8 > D0 + 4.5) return null;
      out.push(t - 8);
    }
    return out;
  };
  let pick = null;
  for (let yb = -0.25; yb <= 4.01; yb += 0.25) for (let xb = -3; xb <= 3.01; xb += 0.5) {
    const zt = zTop(xb, yb, body);
    if (zt === null) continue;
    const B = [xb, yb, zt], u = unit(sub(C, B)), alpha = ang(u, upC), cost = alpha + 0.1 * Math.abs(yb - 1.5);   // u: along the neck, from the ring towards the cuff; (a slight preference for the middle of the ring)
    if (alpha > 45 || (pick && cost >= pick.cost)) continue;
    const wedge = ang(u, upN), sink = rc * Math.tan((wedge * Math.PI) / 180) + 0.3, top = [0, 1, 2].map((c) => C[c] + u[c] * sink), D0 = dot(sub(B, top), [-u[0], -u[1], -u[2]]);   // D0: top face -> where the axis meets the ring
    if (D0 < -1.5) continue;
    const fr = frame(u);
    if (sides(top, fr, 16, D0)) pick = { top, fr, alpha, sink, D0, yb, xb, cost };
  }
  if (process.env.WRIST_DEBUG) console.log('  neck', pick ? `x ${pick.xb} y ${pick.yb} lean ${pick.alpha.toFixed(1)}` : 'none', 'cuff in the claw frame', C.map((x) => x.toFixed(2)), upC.map((x) => x.toFixed(2)));
  if (!pick) return null;
  // the neck's own frame (x = e1, y = e2, z = ez) at `top`, into the claw frame, then onto the hand mesh like the ring; the lower end of the collar follows the ring's surface (sunk SURF_SINK into it),
  // the fan under it ends SURF_FAN deeper
  const zs = sides(pick.top, pick.fr, N, pick.D0), zb = zs.map((z) => z + SURF_SINK), zc = zb.reduce((m, x) => m + x, 0) / N + SURF_FAN;
  const nk = buildNeck(N, zb, zc, { rc, rp, zTip }), out = new Float32Array(nk.length), { e1, e2, ez } = pick.fr;
  for (let i = 0; i < nk.length; i += 3) {
    const x = nk[i], y = nk[i + 1], z = nk[i + 2], q = [0, 1, 2].map((c) => pick.top[c] + e1[c] * x + e2[c] * y + ez[c] * z), r = applyRot(f.rot, q);
    for (let k = 0; k < 3; k++) out[i + k] = r[k] * f.s + f.o[k];
  }
  const tris = new Float32Array(f.bodyTris.length + out.length); tris.set(f.bodyTris); tris.set(out, f.bodyTris.length);
  return { tris, x: pick.xb, y: pick.yb, tilt: pick.alpha, sink: pick.sink, len: pick.D0 - pick.sink };
}
