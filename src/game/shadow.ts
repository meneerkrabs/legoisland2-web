// Blob shadows (Shadow.c / FUN_00444850 init, FUN_00444940 draw, FUN_00444ef0 Pepper's marker; docs/re/rendering.md section 9), the geometry ported from the decompile and checked
// against the original code on the x86 emulator (tools/tests/render-shadow.mjs). Pure (no GL): `blobShadowPoints` returns the five vertices of `Shadow.msh` (corner, centre, corner,
// corner, corner) the game feeds to FUN_0087dd20, `markerPoints` those of Pepper's flashing marker.
//
// Which zones draw shadows at all: only those whose loop function calls FUN_00444850 (the shadow set-up: loads `\data\shadow\shadow.Msh`, the nine `<shadow>/text.txl` textures, sets
// game var 0xc6 = 0 (marker off) and var 0xc5 = 4 (Pepper's shadow type)) and registers their terrain records with FUN_00444ed0(record) (at most 0x40): with no registered record
// FUN_00444940 draws nothing. `extractShadowSetup` (src/formats/zonesetup.ts) reads both from the zone's code.

import { transformPointGame } from '../render/math.ts';
const fr = Math.fround;

/** FUN_00444940's per-type tables (type = var 0xc5 for Pepper, 4 for everything else): DAT_008b58d4 (ray start above the object, x 8), DAT_008b591c (corner radius, x 8), DAT_008b58f8 (lift, x 8) */
export const SHADOW_RAY_START = [0.25, 1, 0.25, 0.5, 0.25, 1, 1, 0, 1].map(fr);
export const SHADOW_RADIUS = [0.25, 1, 0.25, 0.6, 0.25, 1, 1, 0, 1].map(fr);
export const SHADOW_LIFT = [0.01, 0.2, 0.01, 0.01, 0.01, 0.2, 0.2, 0, 0.5].map(fr);
/** _DAT_00892090 (the x 8 scale of all three tables), DAT_008b5940 (2: the corners stay within 2 x 8 of the centre height), the ray length (DAT_008b58a4) and radius (DAT_008b58c4) / mask (DAT_008b58c0) */
export const SHADOW_SCALE = 8, SHADOW_MAX_DEVIATION = 2 * 8, SHADOW_RAY_LENGTH = 2400, SHADOW_RAY_RADIUS = fr(0.01), SHADOW_RAY_MASK = 3;
/** the corner angles relative to the heading (_DAT_00892244 / _DAT_00892248: 0.785 and 2.356, single precision, not pi / 4 and 3 pi / 4) */
const A_NEAR = fr(0.785), A_FAR = fr(2.356);
/** Pepper's shadow is never drawn above this squared distance for other records: _DAT_008921ec = 6400 (80 units) */
export const SHADOW_RANGE2 = 6400;

/**
 * One ray of FUN_00441b10 against registered record `rec` from `origin` straight down by SHADOW_RAY_LENGTH (radius 0.01, skin 0, mask 3): the hit point or null.
 */
/** FUN_00444940: controller flags (+0xc) that give a record a blob shadow (0x10 | 0x40) */
export const SHADOW_CTRL_FLAGS = 0x50;
/** what FUN_00444940 leaves in eax once it gets past its first checks: a stack pointer, -1 or the FPU status word's top bits, never 0 or 1 (the draw pass takes the record as handled) */
export const SHADOW_HANDLED = -1;
export interface ShadowGate {
  /** the zone initialised the shadow system (FUN_00444850) and registered at least one terrain record (FUN_00444ed0) */
  terrain: boolean;
  pepp: boolean;
  /** var 0xc5 (Pepper's shadow type) */
  type: number;
  hasCtrl: boolean;
  ctrlFlags: number;
  /** squared distance of the record to the camera */
  dist2: number;
}
/**
 * The early exits of FUN_00444940 and the value it returns in eax (which a node draw hook made of it reports to the draw pass FUN_0042271b: 0 = not handled, anything else = handled).
 * `draw` = a shadow gets drawn. Order as in the code: no shadow system / no terrain (0); PEPP: type -1 (non-zero) | others: no controller (non-zero), range (non-zero), controller flags
 * without 0x10 / 0x40 (0); then the type range 0..8 (non-zero). Checked against the emulated function in tools/tests/render-shadow.mjs.
 */
export function shadowGate(g: ShadowGate): { draw: boolean; ret: number } {
  if (!g.terrain) return { draw: false, ret: 0 };
  if (g.pepp) { if (g.type === -1) return { draw: false, ret: SHADOW_HANDLED }; }
  else {
    if (!g.hasCtrl) return { draw: false, ret: SHADOW_HANDLED };
    if (SHADOW_RANGE2 < g.dist2) return { draw: false, ret: SHADOW_HANDLED };
    if ((g.ctrlFlags & SHADOW_CTRL_FLAGS) === 0) return { draw: false, ret: 0 };
  }
  const t = g.pepp ? g.type : 4;
  if (t < 0 || t > 8) return { draw: false, ret: SHADOW_HANDLED };
  return { draw: true, ret: SHADOW_HANDLED };
}

export type ShadowRay = (rec: number, origin: [number, number, number]) => [number, number, number] | null;

export interface ShadowInput {
  /** position of the object (record translation, or the translation of the hips bone times the record matrix) */
  x: number; y: number; z: number;
  /** forward row of that matrix (elements 8 and 10): the shadow's heading is atan2(fx, fz) */
  fx: number; fz: number;
  /** shadow type 0..8 (Shadow/text.txl) */
  type: number;
  /** DAT_009da858 */
  seaLevel: number;
}

/**
 * FUN_00444940 after the record tests: the five points (15 floats: corner, centre, corner, corner, corner). The centre is ray-cast down onto the registered terrain records (the
 * highest hit above the sea level), each corner likewise from `rayStart` above the centre height (a hit higher than the centre moves the corner onto it; the last such record wins), corners
 * further than 16 from the centre height are clamped, and everything is lifted by the type's lift.
 */
export function blobShadowPoints(inp: ShadowInput, records: readonly number[], ray: ShadowRay): Float32Array {
  const P = new Float32Array(15);
  const t = inp.type;
  const start = fr(SHADOW_RAY_START[t] * SHADOW_SCALE), R = fr(SHADOW_RADIUS[t] * SHADOW_SCALE), lift = fr(SHADOW_LIFT[t] * SHADOW_SCALE);
  let cx = inp.x, cz = inp.z;
  // centre: local_ec starts at the sea level; every hit overwrites (cx, f4, cz) and raises ec
  let ec = inp.seaLevel, f4 = inp.seaLevel;
  if (records.length) {
    for (const rec of records) {
      const h = ray(rec, [inp.x, fr(start + inp.y), inp.z]);
      if (h) { cx = h[0]; f4 = h[1]; cz = h[2]; if (ec < f4) ec = f4; }
    }
  }
  f4 = ec;
  const a = Math.atan2(inp.fx, inp.fz);   // fpatan's result stays in st(0) (extended) while the four angles are formed: only the sums round
  const ang = [fr(a + A_FAR), fr(a + A_NEAR), fr(a - A_NEAR), fr(a - A_FAR)];   // vertices 0, 2, 3, 4
  const slot = [0, 2, 3, 4];
  for (let k = 0; k < 4; k++) {
    const v = slot[k];
    P[v * 3] = fr(cx + fr(Math.sin(ang[k]) * R));
    P[v * 3 + 2] = fr(cz + fr(Math.cos(ang[k]) * R));
  }
  P[3] = cx; P[4] = ec; P[5] = cz;   // the centre (vertex 1)
  for (const v of slot) {
    let accepted = false;
    const oy = fr(start + f4);
    P[v * 3 + 1] = oy;
    for (const rec of records) {
      const h = ray(rec, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      if (h && f4 < h[1]) { accepted = true; P[v * 3] = h[0]; P[v * 3 + 1] = h[1]; P[v * 3 + 2] = h[2]; }
    }
    if (!accepted) P[v * 3 + 1] = f4;
  }
  // corners further than 2 x 8 from the centre height are clamped to it
  for (const v of slot) {
    const dev = fr(P[v * 3 + 1] - ec);
    if (SHADOW_MAX_DEVIATION < Math.abs(dev)) P[v * 3 + 1] = dev <= 0 ? fr(ec - SHADOW_MAX_DEVIATION) : fr(SHADOW_MAX_DEVIATION + ec);
  }
  for (let v = 0; v < 5; v++) P[v * 3 + 1] = fr(lift + P[v * 3 + 1]);
  return P;
}

/** DAT_008b5948 (the marker's centre in bone 10's space) and DAT_008b5968.. (the five corner offsets: (-1, 1, 0), (0, 0, 0), (-1, -1, 0), (1, -1, 0), (1, 1, 0)) */
const MARKER_CENTRE = [fr(-0.5), fr(2.27), fr(-0.12)];
const MARKER_CORNERS = [[-1, 1, 0], [0, 0, 0], [-1, -1, 0], [1, -1, 0], [1, 1, 0]];

/**
 * FUN_00444ef0: the five points of Pepper's camera-facing marker (shadow type 7) for the matrix `m` of bone 10 times the record matrix (row-major, row vectors) and the camera `eye`.
 * The "right" and "up" vectors are not normalised (right = (-d.z, 0, d.x), up = (d.x d.y, -(d.x^2 + d.z^2), d.y d.z) for the unit view direction d), so the marker shrinks when seen from above.
 */
export function markerPoints(m: ArrayLike<number>, eye: ArrayLike<number>): Float32Array {
  const d: [number, number, number] = [fr(m[12] - eye[0]), fr(m[13] - eye[1]), fr(m[14] - eye[2])];
  // FUN_0043cec0: the sum of squares in x, y, z order, 1 / sqrt as a float
  const l2 = fr(fr(fr(d[0] * d[0]) + fr(d[1] * d[1])) + fr(d[2] * d[2]));
  if (l2 !== 0) { const k = fr(1 / fr(Math.sqrt(l2))); d[0] = fr(k * d[0]); d[1] = fr(k * d[1]); d[2] = fr(k * d[2]); }
  const right = [fr(-d[2]), 0, d[0]];   // 0 * d.y - 1 * d.z, 0 * d.z - 0 * d.x, 1 * d.x - 0 * d.y
  const up = [fr(fr(right[2] * d[1]) - fr(right[1] * d[2])), fr(fr(right[0] * d[2]) - fr(right[2] * d[0])), fr(fr(right[1] * d[0]) - fr(right[0] * d[1]))];
  // the centre: FUN_0043ab72(m, MARKER_CENTRE); the corners: FUN_0043ab72 with the matrix (right, up, d, centre) laid out as rows 0..3 at the stack locals `local_fc ...`
  const c = transformPointGame(m, MARKER_CENTRE);
  const M = new Float32Array(16);
  M.set(right, 0); M.set(up, 4); M.set(d, 8); M.set(c, 12);
  const P = new Float32Array(15);
  for (let i = 0; i < 5; i++) P.set(transformPointGame(M, MARKER_CORNERS[i]), i * 3);
  return P;
}

/** the marker blinks: visible while bit 3 of the tick counter (`_DAT_009e5868` += DAT_008b1718 per drawn frame) is set, i.e. 8 of every 16 ticks */
export function markerVisible(tick: number): boolean { return (Math.trunc(tick) & 8) !== 0; }
