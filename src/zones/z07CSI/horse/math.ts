// float32 helpers of the castle's horse code (Common\Z07CSI\Horse.c). The original keeps its vectors in float locals and the x87 runs in 24-bit precision (Direct3D 7 leaves it single):
// every operation of the nodes rounds to a float32. The matrix helpers follow the machine code of FUN_0043a4a1 / FUN_0043a5e4 / FUN_0043ab72 / FUN_0043cec0 (checked against the original
// run natively in the x86 interpreter: tools/tests/m5-z07CSI-horse-math.mjs).
import type { GameRecord } from '../../../game/record.ts';
import type { World } from '../../../game/world.ts';
import type { Hit } from '../../../game/collision.ts';

export const f = Math.fround;
export type V3 = [number, number, number];

const DV = new DataView(new ArrayBuffer(4));
/** the float32 with the bit pattern the decompile shows (`0x3e32b884`) */
export function fb(bits: number): number { DV.setUint32(0, bits >>> 0); return DV.getFloat32(0); }

/**
 * The rotation of FUN_0043a4a1 / FUN_0043a5e4 as the machine computes it (24-bit x87: every operation rounds to a float; sin / cos come from the CRT as doubles and are stored as floats):
 * [m0 m1 m2 m4 m5 m6 m8 m9 m10].
 */
export function eulerRotation(rx: number, ry: number, rz: number): number[] {
  const f1 = f(Math.cos(f(rx))), f2 = f(Math.sin(f(rx))), f3 = f(Math.cos(f(ry))), f4 = f(Math.sin(f(ry))), f5 = f(Math.cos(f(rz))), f6 = f(Math.sin(f(rz)));
  return [
    f(f5 * f3), f(f6 * f3), -f4,
    f(f(f(f5 * f4) * f2) - f(f6 * f1)), f(f(f(f6 * f4) * f2) + f(f5 * f1)), f(f3 * f2),
    f(f(f(f5 * f4) * f1) + f(f6 * f2)), f(f(f(f6 * f4) * f1) - f(f5 * f2)), f(f3 * f1),
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
  rec.m[12] = f(x); rec.m[13] = f(y); rec.m[14] = f(z);
}

/**
 * FUN_0043cec0(v): normalise in place. `l = (x*x + y*y) + z*z` (24-bit: each operation rounds), `k = 1.0 / sqrt(l)` (the CRT's fsqrt keeps the 24-bit precision: the root and the quotient round to floats),
 * every component times k; a zero vector stays.
 */
export function normalize(v: V3): V3 {
  const l2 = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  if (l2 === 0) return v;
  const k = f(1 / f(Math.sqrt(l2)));
  v[0] = f(k * v[0]); v[1] = f(k * v[1]); v[2] = f(k * v[2]);
  return v;
}

/** FUN_0043ab72(out, matrix, point): `point * M` (row vector); each component `((px * m0 + py * m4) + pz * m8) + m12`, every operation rounded to a float (the machine code's stack schedule) */
export function transformPoint(m: ArrayLike<number>, p: ArrayLike<number>, out: V3 = [0, 0, 0]): V3 {
  const px = p[0], py = p[1], pz = p[2];
  const x = f(f(f(f(px * m[0]) + f(py * m[4])) + f(pz * m[8])) + m[12]);
  const y = f(f(f(f(px * m[1]) + f(py * m[5])) + f(pz * m[9])) + m[13]);
  const z = f(f(f(f(px * m[2]) + f(py * m[6])) + f(pz * m[10])) + m[14]);
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/** FUN_00441270(rec, from, delta, normal, point, mask, radius, skin) with float32 arguments and results (the original's float locals) */
export function sweepF(w: World, ignore: GameRecord, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number, radius: number, skin: number): Hit | null {
  const h = w.col.sweep(ignore, [f(from[0]), f(from[1]), f(from[2])], [f(delta[0]), f(delta[1]), f(delta[2])], mask, radius, skin);
  if (h) { h.point = [f(h.point[0]), f(h.point[1]), f(h.point[2])]; h.normal = [f(h.normal[0]), f(h.normal[1]), f(h.normal[2])]; }
  return h;
}
/** FUN_00441ac0(rec, from, delta, normal, point, mask): the probe (ground record skipped, radius 0.01, skin 0) with float32 arguments and results */
export function probeF(w: World, ignore: GameRecord, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number): Hit | null {
  const h = w.col.probe(ignore, [f(from[0]), f(from[1]), f(from[2])], [f(delta[0]), f(delta[1]), f(delta[2])], mask);
  if (h) { h.point = [f(h.point[0]), f(h.point[1]), f(h.point[2])]; h.normal = [f(h.normal[0]), f(h.normal[1]), f(h.normal[2])]; }
  return h;
}
