// z36CNT: where the machine's parts are. Port of the placement part of the TRAI controller (FUN_007b0c6e's last matrix call, FUN_007b20a8's offsets) and of the
// draw hook FUN_007b1a1b: the arm record TRAI turns about the vertical axis, the chair (CHAI) and the counter weight (WEIG) hang at its ends and tilt outward with
// the power, Pepper sits in the chair. The hook also draws motion-blur copies of all four behind the real parts; `trail` is how far such a copy is turned back.
import { buildMatrix } from '../../formats/matrix.ts';
import { mul } from '../../render/math.ts';
import { f32 } from './util.ts';

export type V3 = [number, number, number];

export interface CntLayout {
  /** the TRAI record's position (the machine's centre) */
  arm: V3;
  /** CHAI / WEIG position relative to TRAI (FUN_007b20a8 builds them with FUN_0043a8bb(.., rec - TRAI)) */
  chair: V3;
  weight: V3;
  /** the seat offset in the chair's frame (FUN_0043a8bb(+0x94, 0, -3.2, 1.6): immediates 0xc04ccccd / 0x3fcccccd) */
  seat: V3;
}

export const SEAT: V3 = [0, f32(0xc04ccccd), f32(0x3fcccccd)];

export function layoutFrom(tr: V3, chair: V3, weight: V3): CntLayout {
  return { arm: tr, chair: [chair[0] - tr[0], chair[1] - tr[1], chair[2] - tr[2]], weight: [weight[0] - tr[0], weight[1] - tr[1], weight[2] - tr[2]], seat: SEAT };
}

/** FUN_0043a9e5(dst, a, b) computes dst = b * a: `then(local, parent)` = apply `local` first, then `parent` (render/math `mul(local, parent)`) */
export const then = (local: Float32Array, parent: Float32Array): Float32Array => mul(local, parent);

/** FUN_0043ad29(m, a): the matrix's columns 0 and 2 turn by a (m' = m * RotY(a), the rotation part only) */
export function turnY(m: Float32Array, a: number) {
  const c = Math.cos(a), s = Math.sin(a);
  const x0 = m[0], x4 = m[4], x8 = m[8];
  m[0] = s * m[2] + c * m[0]; m[4] = s * m[6] + c * m[4]; m[8] = s * m[10] + c * m[8];
  m[2] = c * m[2] - s * x0; m[6] = c * m[6] - s * x4; m[10] = c * m[10] - s * x8;
}

export interface CntPose {
  /** TRAI, WEIG, CHAI, PEPP matrices (row-major, row vectors) */
  arm: Float32Array; weight: Float32Array; chair: Float32Array; pepper: Float32Array;
}

/**
 * The four matrices for an arm `angle` (the controller's +0x110; the arm record is turned by -angle), a chair tilt (power * pi/2) and a `trail` copy offset
 * (0 = the real parts; the hook turns copy j back by j * 0.2 * power).
 */
export function poseAt(l: CntLayout, angle: number, tilt: number, trail = 0): CntPose {
  const arm = buildMatrix(0, -angle, 0, l.arm[0], l.arm[1], l.arm[2]);
  const base = arm.slice();
  if (trail) turnY(base, trail);
  // FUN_007b1a1b: WEIG = (rotZ(-tilt) at its offset) * arm, CHAI = (rotZ(+tilt) at its offset) * arm, PEPP = (seat translation) * CHAI
  const weight = then(buildMatrix(0, 0, -tilt, l.weight[0], l.weight[1], l.weight[2]), base);
  const chair = then(buildMatrix(0, 0, tilt, l.chair[0], l.chair[1], l.chair[2]), base);
  const seat = buildMatrix(0, 0, 0, l.seat[0], l.seat[1], l.seat[2]);
  const pepper = then(seat, chair);
  return { arm: base, weight, chair, pepper };
}

/** number of copies the hook draws: ftol(5 * power) + 1 (FUN_007b1a1b: 0x892070 = 5), one when DAT_00987660 is set */
export function ghostCount(power: number, lowDetail = false): number { return lowDetail ? 1 : Math.trunc(5 * power) + 1; }
/** the per-copy turn-back step and the alpha (out of 255) of copy j (j = 0 is the real one, 255): 70 - ftol(j * 60 / N) */
export function ghostStep(power: number): number { return Math.fround(0.2) * power; }   // 0x8920f0
export function ghostAlpha(j: number, n: number): number { return j === 0 ? 255 : 0x46 - Math.trunc(j * (60 / n)); }

// ---------------------------------------------------------------- the arm's two blob shadows (second half of FUN_007b1a1b)

/**
 * FUN_007afe61 builds five points (x, y, z) at DAT_05d5d4a8 from the constants 0.1 / 0.2 / 0.5 / 1 (0x9442c4..0x9442d4) times 8 (0x892090), y = 0.8 (0x3f4ccccd):
 * (4, .8, 0), (1.6, .8, .8), (1.6, .8, -.8), (8, .8, -1.6), (8, .8, 1.6): a trapezoid along +x. FUN_007b1a1b passes them in the order of the table at 0x9442b0
 * (1, 0, 2, 3, 4) through the arm matrix to the blob-shadow drawer FUN_0087dd20(shadow, 2, points), once at the arm's angle and once turned by pi: the shadow
 * (type 2, the plane silhouette of Shadow.bob) of the arm's two halves on the platform.
 */
export const SHADOW_SCALE = 8, SHADOW_Y = f32(0x3f4ccccd), SHADOW_TYPE = 2;
export const SHADOW_POINTS: V3[] = [
  [0.5 * SHADOW_SCALE, SHADOW_Y, 0], [Math.fround(0.2) * SHADOW_SCALE, SHADOW_Y, Math.fround(0.1) * SHADOW_SCALE], [Math.fround(0.2) * SHADOW_SCALE, SHADOW_Y, -Math.fround(0.1) * SHADOW_SCALE],
  [1 * SHADOW_SCALE, SHADOW_Y, -Math.fround(0.2) * SHADOW_SCALE], [1 * SHADOW_SCALE, SHADOW_Y, Math.fround(0.2) * SHADOW_SCALE],
];
export const SHADOW_ORDER = [1, 0, 2, 3, 4];

/** the two shadow polygons (15 floats each) for an arm matrix */
export function armShadows(arm: Float32Array): number[][] {
  const out: number[][] = [];
  const m = arm.slice();
  for (let k = 0; k < 2; k++) {
    const pts: number[] = [];
    for (const i of SHADOW_ORDER) {
      const v = SHADOW_POINTS[i];
      pts.push(v[0] * m[0] + v[1] * m[4] + v[2] * m[8] + m[12], v[0] * m[1] + v[1] * m[5] + v[2] * m[9] + m[13], v[0] * m[2] + v[1] * m[6] + v[2] * m[10] + m[14]);
    }
    out.push(pts);
    turnY(m, f32(0x40490fdb));
  }
  return out;
}
