// float32 helpers for the nodes of PeppSwit.c: the original keeps its vectors in float locals (every store rounds to float32)
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import type { Hit } from '../../../game/collision.ts';

export const fr = Math.fround;
export type V3 = [number, number, number];

/** the bits of a float constant of the executable (`0x3f490f94`) */
export function f32bits(bits: number): number { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, bits >>> 0); return b.getFloat32(0); }

/**
 * FUN_0043cf57(v): normalise in place and return the length (0 and the vector unchanged for a zero vector). The x87 runs in 24-bit precision (Direct3D 7, docs/re/rendering.md): every
 * operation rounds to a float: the sum of squares (x*x + y*y) + z*z, 1 / root, every component, the square root.
 */
export function normLen(v: V3): number {
  const l2 = fr(fr(fr(v[0] * v[0]) + fr(v[1] * v[1])) + fr(v[2] * v[2]));
  if (l2 === 0) return 0;
  const s = fr(Math.sqrt(l2));            // fsqrt in 24-bit mode
  const k = fr(1 / s);                    // fdivr: 1.0 / the rounded root, rounded
  v[0] = fr(k * v[0]); v[1] = fr(k * v[1]); v[2] = fr(k * v[2]);
  return s;
}
/** FUN_0043cec0(v): normalise in place */
export function norm(v: V3): V3 { normLen(v); return v; }

/** FUN_00441270(rec, from, delta, normal, point, mask, radius, skin) with float32 arguments */
export function sweepF(w: World, ignore: GameRecord, from: V3, delta: V3, mask: number, radius: number, skin: number): Hit | null {
  const h = w.col.sweep(ignore, [fr(from[0]), fr(from[1]), fr(from[2])], [fr(delta[0]), fr(delta[1]), fr(delta[2])], mask, radius, skin);
  if (h) { h.point = [fr(h.point[0]), fr(h.point[1]), fr(h.point[2])]; h.normal = [fr(h.normal[0]), fr(h.normal[1]), fr(h.normal[2])]; }
  return h;
}

/**
 * The rotation of FUN_0043a4a1 / FUN_0043a5e4 as the original computes it (24-bit x87: every operation rounds to a float; sin / cos come from the CRT as doubles and are stored as floats):
 * [m0 m1 m2 m4 m5 m6 m8 m9 m10].
 */
export function eulerRotation(rx: number, ry: number, rz: number): number[] {
  const f1 = fr(Math.cos(fr(rx))), f2 = fr(Math.sin(fr(rx))), f3 = fr(Math.cos(fr(ry))), f4 = fr(Math.sin(fr(ry))), f5 = fr(Math.cos(fr(rz))), f6 = fr(Math.sin(fr(rz)));
  return [
    fr(f5 * f3), fr(f6 * f3), -f4,
    fr(fr(fr(f5 * f4) * f2) - fr(f6 * f1)), fr(fr(fr(f6 * f4) * f2) + fr(f5 * f1)), fr(f3 * f2),
    fr(fr(fr(f5 * f4) * f1) + fr(f6 * f2)), fr(fr(fr(f6 * f4) * f1) - fr(f5 * f2)), fr(f3 * f1),
  ];
}
/** FUN_0043a4a1(rec + 0xc, rx, ry, rz): the rotation part of the record's matrix from Euler angles (the translation stays) */
export function rotateFromEuler(rec: GameRecord, rx: number, ry: number, rz: number) {
  const r = eulerRotation(rx, ry, rz), m = rec.m;
  m[0] = r[0]; m[1] = r[1]; m[2] = r[2]; m[4] = r[3]; m[5] = r[4]; m[6] = r[5]; m[8] = r[6]; m[9] = r[7]; m[10] = r[8];
  m[3] = m[7] = m[11] = 0; m[15] = 1;
}
/** FUN_0043a5e4(rec + 0xc, rx, ry, rz, x, y, z) */
export function setEulerExact(rec: GameRecord, rx: number, ry: number, rz: number, x: number, y: number, z: number) {
  rotateFromEuler(rec, rx, ry, rz);
  rec.m[12] = fr(x); rec.m[13] = fr(y); rec.m[14] = fr(z);
}
