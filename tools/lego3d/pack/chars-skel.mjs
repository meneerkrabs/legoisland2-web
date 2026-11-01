// The skeleton body (SKEL_HR of the skeleton, MUMM_HR of the mummy guards: the same shape, flat white): the LDraw minifig skeleton parts - torso with ribs and pelvis 6260, arm 6265, leg 6266 - taken
// APART into their rigid pieces (the ribcage frame and spine rod, the pelvis, the arm's clip + rod, collar and shaft, the leg's clip + shaft and its foot block) and warped piece by piece onto the game's
// own skeleton: along the bone by anchor levels (where the game's pieces start and end), across it by the half widths measured in the game's mesh, so that every piece is as wide and deep as the
// game's (the first version box-fitted the whole torso part, neck tube and shoulder pins included, which squeezed the ribcage low and left the neck tube above it, and made the arms and legs lofts).
// Skinned like the game: every piece rigid on its bone, the only soft part is the shaft of each leg between the collar block and the foot (the game's own bridge between its two leg bones, 0.07 long).
// Builder only; the pack gets positions / bones / weights (encodeBody), nothing of the game's mesh.
import path from 'node:path';
import { LDRAW } from '../lib.mjs';
import { LDrawLib } from '../ldraw.mjs';
import { ldrawToGame, loadBody } from './chars-core.mjs';
import { weldSoup } from './chars-body.mjs';
import { planeCap, fixTJunctions, visiblePrune } from './chars-geom.mjs';

const lib = new LDrawLib(path.join(LDRAW, 'lib/ldraw'));
/** the parts of the body (names for the table; the blob's per-triangle `part` indexes this list) */
export const SKEL_PARTS = [
  { id: 'torso' }, { id: 'pelvis' },
  { id: 'arm +x clip', bone: 11 }, { id: 'arm +x collar', bone: 13 }, { id: 'arm -x clip', bone: 12 }, { id: 'arm -x collar', bone: 15 },
  { id: 'leg +x', bone: 2 }, { id: 'foot +x', bone: 6 }, { id: 'leg -x', bone: 1 }, { id: 'foot -x', bone: 4 },
];
/** LDraw primitive resolution per part (low = p/8: the round parts have fewer sides; the skeleton is HR only, so the cost is the whole body's) */
const RES = { 6260: 'low', 6265: 'low', 6266: 'low' };
const PART_ID = Object.fromEntries(SKEL_PARTS.map((p, i) => [p.id, i]));

/** connected components of a soup (vertices welded by position): [{ tris, lo, hi }] */
export function components(tris) {
  const w = weldSoup(tris), par = Array.from({ length: w.pos.length / 3 }, (_, i) => i);
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let t = 0; t < w.idx.length; t += 3) { par[find(w.idx[t])] = find(w.idx[t + 1]); par[find(w.idx[t + 1])] = find(w.idx[t + 2]); }
  const C = new Map();
  for (let t = 0; t < w.idx.length; t += 3) {
    const r = find(w.idx[t]);
    let c = C.get(r); if (!c) C.set(r, c = { list: [], lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] });
    for (let k = 0; k < 3; k++) { const o = (t + k) * 3; c.list.push(tris[o], tris[o + 1], tris[o + 2]); for (let a = 0; a < 3; a++) { c.lo[a] = Math.min(c.lo[a], tris[o + a]); c.hi[a] = Math.max(c.hi[a], tris[o + a]); } }
  }
  return [...C.values()].map((c) => ({ tris: visiblePrune(fixTJunctions(Float32Array.from(c.list)).tris), lo: c.lo, hi: c.hi }));   // outside-only shells (the LDraw parts carry their inner walls, slots and sockets)
}

/** piecewise linear table lookup (anchors sorted by `t` ascending); `lin` extrapolates the end segments (levels), else the end values stay (widths) */
function interp(A, t, key, lin) {
  if (t <= A[0].t) { if (!lin) return A[0][key]; return A[0][key] + (A[1][key] - A[0][key]) * (t - A[0].t) / (A[1].t - A[0].t); }
  for (let i = 0; i + 1 < A.length; i++) if (t <= A[i + 1].t) return A[i][key] + (A[i + 1][key] - A[i][key]) * (t - A[i].t) / (A[i + 1].t - A[i].t);
  const n = A.length - 1;
  return lin ? A[n][key] + (A[n][key] - A[n - 1][key]) * (t - A[n].t) / (A[n].t - A[n - 1].t) : A[n][key];
}
/**
 * LDraw part (game axes, LDU) -> game bind pose: along-bone coordinate `ax` (LD index) -> level y by the anchors, the two lateral coordinates scaled by the anchors' sx / sz around the centre line
 * (cx(y), cz(y)); `arm` turns the part so that its long axis (LD z) becomes y: (x, y, z) -> (x, z, -y), a rotation (winding kept)
 */
function warp(tris, A, { ax = 1, arm = false, cx = () => 0, cz = () => 0 } = {}) {
  const o = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2], t = arm ? z : y, lat = arm ? -y : z;
    const Y = interp(A, t, 'y', true), sx = interp(A, t, 'sx'), sz = interp(A, t, 'sz');
    o[i] = cx(Y) + x * sx; o[i + 1] = Y; o[i + 2] = cz(Y) + lat * sz;
  }
  return o;
}
const mirrorX = (t) => { const r = new Float32Array(t.length); for (let i = 0; i < t.length; i += 9) for (let k = 0; k < 3; k++) { const j = k === 1 ? 2 : k === 2 ? 1 : k; r[i + j * 3] = -t[i + k * 3]; r[i + j * 3 + 1] = t[i + k * 3 + 1]; r[i + j * 3 + 2] = t[i + k * 3 + 2]; } return r; };   // x -> -x with the winding kept outward

/** the centre line of the game's arm over y (it leans outward): least squares of the slab centres of its vertices (+x arm: bones 11 / 13) */
function armAxis(B, bones) {
  const S = new Map();
  for (let v = 0; v < B.msh.vertexCount; v++) {
    if (!bones.includes(B.sv.bone[v])) continue;
    const k = Math.round(B.world[v * 3 + 1] / 0.05); let s = S.get(k); if (!s) S.set(k, s = { y: 0, n: 0, xl: 9, xh: -9, zl: 9, zh: -9 });
    s.y += B.world[v * 3 + 1]; s.n++; s.xl = Math.min(s.xl, B.world[v * 3]); s.xh = Math.max(s.xh, B.world[v * 3]); s.zl = Math.min(s.zl, B.world[v * 3 + 2]); s.zh = Math.max(s.zh, B.world[v * 3 + 2]);
  }
  const P = [...S.values()].filter((s) => s.n >= 12).map((s) => ({ y: s.y / s.n, x: (s.xl + s.xh) / 2, z: (s.zl + s.zh) / 2 }));
  const fit = (key) => { const n = P.length, sy = P.reduce((a, p) => a + p.y, 0), sv = P.reduce((a, p) => a + p[key], 0), syy = P.reduce((a, p) => a + p.y * p.y, 0), syv = P.reduce((a, p) => a + p.y * p[key], 0); const b = (n * syv - sy * sv) / (n * syy - sy * sy || 1); return (y) => (sv - b * sy) / n + b * y; };
  return { x: fit('x'), z: fit('z') };
}

// ---- the anchors: LDraw level (LDU along the part's axis) -> game level, lateral scale (game units per LDU) across x / across z (arm: across the LD x / -y).
// Read off the game's SKEL_HR (bind pose; tools/lego3d scratch: per bone y levels and half widths, docs/re/lego3d.md section 9, round 3) and the LDraw parts' own slabs (LDU)
// torso 6260: rib frame top (LD 0) = game 2.83, lowest rib (LD -26) = 1.86, spine rod bottom (LD -32.5) = 1.45; frame +-17 -> +-0.65, depth +-6.1 -> +-0.255, rod +-3.6 -> +-0.14
const TORSO = [
  { t: -32.5, y: 1.45, sx: 0.0382, sz: 0.0418 },
  { t: -26, y: 1.86, sx: 0.0382, sz: 0.0418 },
  { t: 0, y: 2.83, sx: 0.0382, sz: 0.0418 },
];
// pelvis 6260 (plate top LD -32.4 = 1.46, plate bottom -36.4 = 1.36, the bars' ends -50.9 = 0.76); plate +-16.4 -> +-0.69
const PELVIS = [
  { t: -50.9, y: 0.76, sx: 0.042, sz: 0.0418 },
  { t: -36.4, y: 1.36, sx: 0.042, sz: 0.0418 },
  { t: -32.4, y: 1.46, sx: 0.042, sz: 0.0418 },
];
// arm 6265 (LD z): clip 34.2 .. 23.3 = the game's cap 2.85 .. 2.47 (12 x 8 LDU -> 0.43 x 0.44), rod 23.3 .. 17 = the game's bridge to the collar 2.47 .. 2.14, collar 17 .. 13 = 2.14 .. 1.88 (+-6 -> 0.19 / 0.175),
// shaft 13 .. 5 = 1.88 .. 1.71 (the hand end of the part is cut at 5: the game's hand is its own mesh)
const ARM_UP = [
  { t: 17, y: 2.14, sx: 0.035, sz: 0.0375 },
  { t: 23.3, y: 2.47, sx: 0.035, sz: 0.0375 },
  { t: 25, y: 2.54, sx: 0.0358, sz: 0.055 },
  { t: 34.2, y: 2.85, sx: 0.0358, sz: 0.055 },
];
const ARM_LO = [
  { t: 5, y: 1.71, sx: 0.03, sz: 0.03 },
  { t: 13, y: 1.88, sx: 0.03, sz: 0.03 },
  { t: 13.01, y: 1.88, sx: 0.032, sz: 0.029 },
  { t: 17, y: 2.14, sx: 0.032, sz: 0.029 },
];
// leg 6266 (LD y): clip + thigh 5.6 .. -12 = 1.27 .. 0.61 (the game's thigh is a bulb 0.46 wide x 0.52 deep: the LDraw clip is 8 LDU wide x 14 deep, so x is stretched 1.6x), collar -12 .. -16 = 0.61 .. 0.405, shaft -16 .. -20 = .. 0.335, foot block -20 .. -28 = 0.335 .. 0.01 (+-8 -> +-0.30)
const LEG = [
  { t: -20, y: 0.335, sx: 0.038, sz: 0.036 },
  { t: -16, y: 0.405, sx: 0.038, sz: 0.036 },
  { t: -12, y: 0.61, sx: 0.038, sz: 0.036 },
  { t: -8, y: 0.76, sx: 0.0385, sz: 0.036 },
  { t: -4.5, y: 0.89, sx: 0.057, sz: 0.037 },
  { t: 5.6, y: 1.27, sx: 0.057, sz: 0.037 },
];
const FOOT = [
  { t: -28, y: 0.01, sx: 0.0375, sz: 0.0389 },
  { t: -20, y: 0.335, sx: 0.0375, sz: 0.0389 },
];
const LEG_X = 0.535;   // the centre line of the game's legs

/** the pieces of the skeleton: [{ part (index of SKEL_PARTS), tris (game units), skin: (x, y, z) -> [[bone, weight], ...] }] */
export function buildSkeleton(zone, member) {
  const B = loadBody(zone, member);
  const parts = {};
  for (const id of ['6260', '6265', '6266']) parts[id] = ldrawToGame(lib.flatten(id + '.dat', { res: RES[id], skip: /stud/ }).tris);   // (T-junctions are fixed per piece AFTER the split: fixing them first would join pieces that merely touch)
  const pieces = [];
  const add = (id, tris, skin) => pieces.push({ part: PART_ID[id], tris, skin });

  // ---- torso part 6260: rib frame + spine rod -> bone 8; pelvis (below the plate top) -> bone 0; coil rings, neck tube and shoulder pins dropped (the game's body has none of them)
  for (const c of components(parts['6260'])) {
    const w = [0, 1, 2].map((a) => c.hi[a] - c.lo[a]);
    if (c.hi[1] < -32) add('pelvis', warp(c.tris, PELVIS), () => [[0, 1]]);
    else if (c.lo[1] >= -0.1) continue;                       // neck tube
    else if (w[1] < 4 && w[0] < 9.5) continue;                // spring ring of the spine (the rod stays)
    else if (Math.abs(c.lo[0] + c.hi[0]) / 2 > 15) continue;    // shoulder pin (ball and stem)
    else add('torso', warp(c.tris, TORSO), () => [[8, 1]]);
  }
  // ---- arms 6265: clip + rod, collar, shaft (the hand block at the other end is the game's hand mesh); +x arm built, the -x arm is its mirror
  const axisR = armAxis(B, [11, 13]);
  const cxA = (y) => axisR.x(y), czA = (y) => axisR.z(y);
  for (const c of components(parts['6265'])) {
    if (c.hi[2] <= 5.1) continue;   // hand block
    const up = c.lo[2] >= 16.9 && c.hi[2] > 30;
    let t = warp(c.tris, up ? ARM_UP : ARM_LO, { arm: true, cx: cxA, cz: czA });
    if (!up && c.lo[2] < 5.1) t = capBottom(t, 1.71);
    for (const side of [1, -1]) {
      const tt = side > 0 ? t : mirrorX(t), lo = side > 0 ? 13 : 15, hi = side > 0 ? 11 : 12;
      if (up) add(side > 0 ? 'arm +x clip' : 'arm -x clip', tt, () => [[hi, 1]]);   // clip + rod rigid on the upper bone: the game's elbow bone sits exactly at the collar's top face (y 2.144), a soft rod measured 1.25 median stretch against the original's 1.13
      else add(side > 0 ? 'arm +x collar' : 'arm -x collar', tt, () => [[lo, 1]]);
    }
  }
  // ---- legs 6266: clip + shaft + collar -> upper bone, foot block -> foot bone; +x leg built, -x leg mirrored
  for (const c of components(parts['6266'])) {
    const foot = c.hi[1] <= -19.9;
    const t = warp(c.tris, foot ? FOOT : LEG, { cx: () => LEG_X });
    for (const side of [1, -1]) {
      const tt = side > 0 ? t : mirrorX(t), bone = foot ? (side > 0 ? 6 : 4) : (side > 0 ? 2 : 1);
      const lower = side > 0 ? 6 : 4;   // the shaft between the collar and the foot is the soft part (the game's own bridge between its leg bones, 0.07 long)
      add(foot ? (side > 0 ? 'foot +x' : 'foot -x') : (side > 0 ? 'leg +x' : 'leg -x'), tt, foot ? () => [[bone, 1]] : (x, y) => { const k = Math.max(0, Math.min(1, (y - 0.335) / (0.405 - 0.335))); return k >= 1 ? [[bone, 1]] : k <= 0 ? [[lower, 1]] : [[bone, k], [lower, 1 - k]]; });
    }
  }
  return { pieces, parts };
}
/** closes the open bottom of the arm shaft (the hand end was cut off) with a hull cap at level y */
function capBottom(t, y) { return planeCap(t, 1, y, -1, 2e-3).tris; }

/** the skeleton as one indexed mesh with per-vertex bones: every piece welded on its own (the pieces only touch) */
export function packSkeleton(sk) {
  const pos = [], bone = [], weight = [], idx = [], group = [], part = [];
  for (const pc of sk.pieces) {
    const w = weldSoup(pc.tris), base = pos.length / 3;
    for (let v = 0; v < w.pos.length / 3; v++) {
      const x = w.pos[v * 3], y = w.pos[v * 3 + 1], z = w.pos[v * 3 + 2];
      pos.push(x, y, z);
      const b = pc.skin(x, y, z);
      for (let k = 0; k < 4; k++) { bone.push(b[k]?.[0] ?? 255); weight.push(b[k]?.[1] ?? 0); }
    }
    for (let t = 0; t < w.idx.length; t += 3) { idx.push(base + w.idx[t], base + w.idx[t + 1], base + w.idx[t + 2]); group.push(0); part.push(pc.part); }
  }
  return { pos, bone, weight, idx, group, part };
}
