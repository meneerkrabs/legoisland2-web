// The REAL minifig arm for the near LODs (HR, MR): the LDraw arm 3818 (3819 is its mirror image) re-articulated onto the game's own arm.
// docs/re/lego3d.md section 9 "Arms and hands (round 10)".
//
// The LDraw part is a two-segment arm: the shoulder (a cylinder about x with its dome) + the vertical upper arm, an elbow, and a forearm that is bent 45 degrees forward, ending in the cuff with the
// hand hole. The game's arm is the same shape (13 x 10 LDU tube, shoulder cap, elbow, cuff) at 0.04 game units per LDU with a different bend: its upper arm leans outward, its forearm leans out and forward by
// about 22 degrees. The earlier build lofted rings through the part and made a uniform tube of it (no shoulder cap, no elbow, no cuff). Here every vertex of the part is mapped by a continuous
// function, so the surface stays closed and keeps every detail:
//   P_U(v) = E' + k_r R_U (perp_U(v)) + g_U S_U(s_U(v))     for the shoulder / upper arm, s along the LDraw upper axis (down)
//   P_L(v) = E' + k_r R_L (perp_L(v)) + g_L S_L(s_L(v))     for the forearm
//   M(v)   = (1 - w) P_U(v) + w P_L(v),  w = smoothstep of the signed distance to the mitre plane (+-DELTA LDU): a short rounded elbow
// R_U / R_L = the minimal rotations taking the LDraw axes to the game's, E' = the game's elbow, S = the axial scale that makes the dome apex and the cuff end land where the game's arm has them.
import { splitAtPlane, capSmallHoles } from '../geom.mjs';
import { lib } from './chars-body.mjs';
import { ldrawToGame } from './chars-core.mjs';
import { fixTJunctions, planeCap, visiblePrune } from './chars-geom.mjs';

/** the LDraw arm 3818 as an outside-only shell in game axes (LDU): no studs, T-junctions fixed, cut at the inner side of the shoulder (x = 0.3: the pin and the dome's inner half sit inside the torso) and closed
 *  there with one cap, hidden faces pruned, the hand hole at the cuff closed with a disc (the hand's peg fills it; the open hole would show as a dark tube) */
const srcCache = new Map();
export function armSource(res = 'std') {
  if (srcCache.has(res)) return srcCache.get(res);
  const f = lib.flatten('3818.dat', { res, skip: /stud/ });
  let t = fixTJunctions(ldrawToGame(f.tris)).tris;
  t = splitAtPlane(t, 0, 0.3);
  const keep = []; for (let i = 0; i < t.length; i += 9) if ((t[i] + t[i + 3] + t[i + 6]) / 3 > 0.3) keep.push(...t.subarray(i, i + 9));
  t = snapTris(Float32Array.from(keep));   // (the cut is closed by closeLoops below)
  t = visiblePrune(t);
  t = capSmallHoles(fixTJunctions(t).tris, 120, 80).tris;
  t = visiblePrune(t);
  const r = { tris: closeLoops(snapTris(closeCuff(t))), infos: f.infos };
  srcCache.set(res, r);
  return r;
}
/** the hole at the end of the forearm (a tube along the forearm axis, closed by the part's own end ring): the tube walls go, the end ring gets a disc */
function closeCuff(t) {
  const L = LD_ARM, sOf = (v) => (v[0] - L.E[0]) * L.aL[0] + (v[1] - L.E[1]) * L.aL[1] + (v[2] - L.E[2]) * L.aL[2];
  const radial = (v) => { const q = [v[0] - L.E[0], v[1] - L.E[1], v[2] - L.E[2]], s = sOf(v), p = [q[0] - L.aL[0] * s, q[1] - L.aL[1] * s, q[2] - L.aL[2] * s]; return Math.hypot(...p); };
  const out = [], ring = [];
  for (let i = 0; i < t.length; i += 9) {
    const V = [0, 1, 2].map((k) => [t[i + k * 3], t[i + k * 3 + 1], t[i + k * 3 + 2]]);
    const s = V.map(sOf), r = V.map(radial);
    const hole = Math.max(...r) <= HOLE_R + 0.05 && Math.max(...s) > 3.0;   // the walls and the bottom of the hole
    if (hole) continue;
    out.push(...t.subarray(i, i + 9));
    if (s.every((x) => x > 13.95)) for (let k = 0; k < 3; k++) if (r[k] <= HOLE_R + 0.05) ring.push(V[k]);   // the end ring's inner edge
  }
  // the disc: the inner-edge vertices ordered by angle around the axis, fanned to the axis point at the end plane
  const c = [L.E[0] + L.aL[0] * 14, L.E[1] + L.aL[1] * 14, L.E[2] + L.aL[2] * 14];
  const u = unit(cross(L.aL, [1, 0, 0])), v2 = cross(L.aL, u);
  const uniq = new Map(); for (const p of ring) uniq.set(p.map((x) => Math.round(x * 1e3)).join(), p);
  const pts = [...uniq.values()].map((p) => ({ p, a: Math.atan2(dot(sub(p, c), v2), dot(sub(p, c), u)) })).sort((x, y) => x.a - y.a);
  for (let k = 0; k < pts.length; k++) { const a = pts[k].p, b = pts[(k + 1) % pts.length].p; out.push(...c, ...a, ...b); }   // winding checked by the renderer (back faces show dark red)
  return Float32Array.from(out);
}
export const HOLE_R = 2.5;

/** the LDraw arm (+x arm, game axes, LDU): elbow, axes (pointing down the arm), the axial extents */
export const LD_ARM = { E: [5, -9, 0], aU: [0, -1, 0], aL: [0, -Math.SQRT1_2, Math.SQRT1_2], sApex: 15.5, sEnd: 14, DELTA: 3 };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** minimal rotation taking unit a onto unit b, as a function of a vector (Rodrigues) */
function rotTo(a, b) {
  const v = cross(a, b), c = dot(a, b), s2 = dot(v, v);
  if (s2 < 1e-14) return (p) => p;
  const k = (1 - c) / s2;
  return (p) => { const vp = cross(v, p); return [p[0] + vp[0] + k * (v[1] * vp[2] - v[2] * vp[1]), p[1] + vp[1] + k * (v[2] * vp[0] - v[0] * vp[2]), p[2] + vp[2] + k * (v[0] * vp[1] - v[1] * vp[0])]; };
}

/**
 * The game's arm of a layout in the bind pose, measured from the original HR body: `pts` = world positions of the vertices of ONE arm (the +x one; mirror the other), `b11 / b13 / b14` = the bind positions of
 * its shoulder, elbow and wrist bones. The axes are the bone directions (the original's rings are perpendicular to them, not horizontal), the elbow is the elbow bone moved to the middle of the original's tube
 * (mean perpendicular offset of the vertices on each side), the radial scale the original's forearm width over the LDraw tube's 10 LDU, the axial extents the highest / lowest vertices along the axes.
 * -> { E, dU, dL, kr, lenU, lenL }
 */
export function gameArm(pts, b11, b13, b14) {
  const dU = unit(sub(b13, b11)), dL = unit(sub(b14, b13));
  const up = pts.filter((p) => p[1] > b13[1] + 0.12), lo = pts.filter((p) => p[1] < b13[1] - 0.12);
  const perpMean = (cloud, d) => { const m = [0, 0, 0]; for (const p of cloud) { const q = sub(p, b13), s = dot(q, d), r = sub(q, mul(d, s)); m[0] += r[0]; m[1] += r[1]; m[2] += r[2]; } return mul(m, 1 / Math.max(1, cloud.length)); };
  const E = add(b13, mul(add(perpMean(up, dU), perpMean(lo, dL)), 0.5));
  // radial scale: the width of the forearm's tube across the bend plane (the part's tube is 10 LDU in diameter)
  const ex = unit(sub([1, 0, 0], mul(dL, dL[0]))), ez = unit(cross(dL, ex));
  const ext = (cloud, ax) => { let a = 1e9, b = -1e9; for (const p of cloud) { const s = dot(sub(p, E), ax); a = Math.min(a, s); b = Math.max(b, s); } return b - a; };
  const nearEnd = lo.filter((p) => dot(sub(p, E), dL) > 0.04);
  const kr = (ext(nearEnd, ex) + ext(nearEnd, ez)) / 2 / 10;
  let lenU = 0, lenL = 0; for (const p of up) lenU = Math.max(lenU, -dot(sub(p, E), dU)); for (const p of lo) lenL = Math.max(lenL, dot(sub(p, E), dL));
  return { E, dU, dL, kr, lenU, lenL };
}

const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
/** maps LDraw arm triangles (game axes LDU, the +x arm) onto the game's arm (see the header); `g` = gameArm(...) */
export function articulate(tris, g) {
  const L = LD_ARM, bis = unit(add(L.aU, L.aL));
  const RU = rotTo(L.aU, g.dU), RL = rotTo(L.aL, g.dL);
  // axial scales: the dome apex and the cuff end land on the game's top / bottom (planes y = top / bottom along the axes); the shoulder dome and the cuff keep their scale (kr) where they can
  const kU = g.lenU / L.sApex, kL = g.lenL / L.sEnd;
  const P = (v, a, R, k, dir) => { const q = sub(v, L.E), s = dot(q, a), perp = sub(q, mul(a, s)); return add(g.E, add(mul(R(perp), g.kr), mul(dir, s * k))); };
  const out = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const v = [tris[i], tris[i + 1], tris[i + 2]];
    const d = dot(sub(v, L.E), bis), w = smooth((d + L.DELTA) / (2 * L.DELTA));
    const pu = P(v, L.aU, RU, kU, g.dU), pl = P(v, L.aL, RL, kL, g.dL);
    out[i] = pu[0] + (pl[0] - pu[0]) * w; out[i + 1] = pu[1] + (pl[1] - pu[1]) * w; out[i + 2] = pu[2] + (pl[2] - pu[2]) * w;
  }
  return out;
}

/** reflects a triangle soup in x (and reverses the winding back to outward) */
export function mirrorX(t) {
  const o = new Float32Array(t.length);
  for (let i = 0; i < t.length; i += 9) {
    for (let k = 0; k < 3; k++) { const j = k === 1 ? 2 : k === 2 ? 1 : k; o[i + j * 3] = -t[i + k * 3]; o[i + j * 3 + 1] = t[i + k * 3 + 1]; o[i + j * 3 + 2] = t[i + k * 3 + 2]; }
  }
  return o;
}

/**
 * The real arm of one side for a layout: the cleaned LDraw 3818 at resolution `res` ('low' | 'std' | 'high'), articulated; the -x arm is the mirror image of the +x one. `g` = gameArm of the +x arm.
 * `planes` = y values (skin planes, band edges) at which the surface is cut so that the skin blend has vertices to act on. Triangle soup in game axes (bind pose).
 */
export function realArm(side, g, res, planes = []) {
  const base = articulate(armSource(res).tris, g);
  let best = null;
  for (const jit of [0, 3e-4, -3e-4, 7e-4, -7e-4, 1.3e-3]) {   // a cut plane that passes exactly through a vertex can leave a crack: nudge the planes a hair until the cut shell is closed
    let t = base;
    for (const y of planes) t = splitAtPlane(t, 1, y + jit);
    const open = openEdges(t);
    if (!best || open < best.open) best = { t, open };
    if (!open) break;
  }
  return side < 0 ? mirrorX(best.t) : best.t;
}
/** number of edges that are not shared by exactly one triangle of each direction (vertices welded at 1e-5) */
export function openEdges(t) {
  const K = (i) => `${Math.round(t[i] * 1e5)},${Math.round(t[i + 1] * 1e5)},${Math.round(t[i + 2] * 1e5)}`;
  const M = new Map();
  for (let i = 0; i < t.length; i += 9) { const k = [K(i), K(i + 3), K(i + 6)]; if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue; for (let e = 0; e < 3; e++) { const a = k[e], b = k[(e + 1) % 3], kk = a < b ? `${a}|${b}` : `${b}|${a}`, o = M.get(kk) ?? { n: 0, d: 0 }; o.n++; o.d += a < b ? 1 : -1; M.set(kk, o); } }
  let open = 0; for (const o of M.values()) if (o.n !== 2 || o.d !== 0) open++;
  return open;
}

/** the game's +x arm of a layout from its original HR body `B` (loadBody) and the region of the layout's spec: gameArm() over the vertices of that arm */
export function gameArmOf(B, reg, BONES) {
  const pts = []; for (let v = 0; v < B.msh.vertexCount; v++) { if (reg.groups && !reg.groups.includes(B.groupOf[v])) continue; if (reg.bones && !reg.bones.includes(B.sv.bone[v])) continue; pts.push([B.world[v * 3], B.world[v * 3 + 1], B.world[v * 3 + 2]]); }
  const bp = (b) => [BONES[b * 16 + 12], BONES[b * 16 + 13], BONES[b * 16 + 14]];
  return gameArm(pts, bp(11), bp(13), bp(14));
}

/** closes every remaining boundary loop (edges that have no partner of the opposite direction) with a fan from the loop's centroid: the shell is watertight (the cuts at the skin planes keep it so) */
export function closeLoops(t) {
  const K = (i) => `${Math.round(t[i] * 1e3)},${Math.round(t[i + 1] * 1e3)},${Math.round(t[i + 2] * 1e3)}`;
  const E = new Map();
  for (let i = 0; i < t.length; i += 9) for (let e = 0; e < 3; e++) { const a = i + e * 3, b = i + ((e + 1) % 3) * 3; E.set(`${K(a)}>${K(b)}`, [a, b]); }
  const open = []; for (const [k, [a, b]] of E) { const [ka, kb] = k.split('>'); if (!E.has(`${kb}>${ka}`)) open.push([a, b, ka, kb]); }
  if (!open.length) return t;
  // components by shared vertex keys
  const par = new Map(); const find = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const [, , ka, kb] of open) { if (!par.has(ka)) par.set(ka, ka); if (!par.has(kb)) par.set(kb, kb); par.set(find(ka), find(kb)); }
  const comp = new Map(); for (const o of open) { const r = find(o[2]); (comp.get(r) ?? comp.set(r, []).get(r)).push(o); }
  const out = Array.from(t);
  for (const edges of comp.values()) {
    const c = [0, 0, 0]; let n = 0; for (const [a, , ,] of edges) { c[0] += t[a]; c[1] += t[a + 1]; c[2] += t[a + 2]; n++; }
    c[0] /= n; c[1] /= n; c[2] /= n;
    for (const [a, b] of edges) out.push(t[b], t[b + 1], t[b + 2], t[a], t[a + 1], t[a + 2], c[0], c[1], c[2]);
  }
  return Float32Array.from(out);
}

/** snaps the vertices to a 0.01 LDU grid (the cut at x = 0.3 leaves points that differ in the 4th decimal and make non-manifold edges) and drops the triangles that collapse */
export function snapTris(t, q = 100) {
  const o = []; const r = (x) => Math.round(x * q) / q;
  for (let i = 0; i < t.length; i += 9) {
    const a = [r(t[i]), r(t[i + 1]), r(t[i + 2])], b = [r(t[i + 3]), r(t[i + 4]), r(t[i + 5])], c = [r(t[i + 6]), r(t[i + 7]), r(t[i + 8])];
    const same = (u, v) => u[0] === v[0] && u[1] === v[1] && u[2] === v[2];
    if (same(a, b) || same(b, c) || same(a, c)) continue;
    o.push(...a, ...b, ...c);
  }
  return Float32Array.from(o);
}

/**
 * Refines gameArm() against the original arm itself (builder only): coordinate descent on the elbow position, the two axial lengths and the radial scale, maximising the silhouette IoU of the
 * articulated part with the original's arm triangles in the bind pose (4 views). The bone-based start is a good guess of the directions, but the mesh's tube is offset from the bone line by a few
 * hundredths. -> { g, iou0, iou }
 */
import { silhouetteIoU } from '../iou.mjs';
export function fitGameArm(B, reg, BONES, trisOfArm) {
  const g0 = gameArmOf(B, reg, BONES);
  const sel = (v) => reg.groups.includes(B.groupOf[v]) && (!reg.bones || reg.bones.includes(B.sv.bone[v]));
  const o = [], m = B.msh;
  for (const gr of m.groups) for (let k = 0; k < gr.indexCount; k += 3) { const v = [0, 1, 2].map((q) => m.indices[gr.firstIndex + k + q] + gr.firstVertex); if (v.every(sel)) for (const i of v) o.push(B.world[i * 3], B.world[i * 3 + 1], B.world[i * 3 + 2]); }
  const O = Float32Array.from(o), V = [[0, 0], [90, 0], [35, 25], [180, 0]];
  const mk = (p) => ({ ...g0, E: [g0.E[0] + p[0], g0.E[1] + p[1], g0.E[2] + p[2]], lenL: g0.lenL * p[3], lenU: g0.lenU * p[4], kr: g0.kr * p[5], dU: unit([g0.dU[0] + p[6], g0.dU[1], g0.dU[2] + p[7]]), dL: unit([g0.dL[0] + p[8], g0.dL[1], g0.dL[2] + p[9]]) });
  const score = (p) => silhouetteIoU([O], [articulate(armSource('std').tris, mk(p))], { views: V, size: 192 }).mean;
  let p = [0, 0, 0, 1, 1, 1, 0, 0, 0, 0], best = score(p); const iou0 = best;
  for (const step of [1, 0.5, 0.25, 0.12]) for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let k = 0; k < 10; k++) for (const sg of [1, -1]) { const q = p.slice(); q[k] += sg * step * (k < 3 ? 0.03 : k < 6 ? 0.06 : 0.05); const s = score(q); if (s > best + 1e-5) { best = s; p = q; moved = true; } }
    if (!moved) break;
  }
  return { g: mk(p), iou0, iou: best, p };
}
