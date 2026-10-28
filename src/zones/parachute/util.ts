// Shared pure helpers of the two parachute mini-games (z38PAR "Parachute", z40aPO "Parachute landing on Ogel"). DOM-free: node tests drive them.
import type { GameRecord } from '../../game/record.ts';

/** 2 pi as the executable has it: the float constant 0x40c90fdb at 0x892094 (6.2831855), used for every angle wrap of the pilot code */
export const TWO_PI = 6.2831855;

let source: () => number = Math.random;
/** replace the random source (tests); `f` returns [0, 1) */
export function setRandomSource(f: (() => number) | null) { source = f ?? Math.random; }

/** FUN_004388ae(max): `rand() / 32767 * max` with the CRT's rand() in 0..32767 (0 for max <= 0) */
export function rand(max: number): number {
  if (max <= 0) return 0;
  const r = Math.floor(source() * 32768);
  return (r / 32767) * max;
}

export type Vec3 = [number, number, number];

/** FUN_0043a5e4 rotation part: row-vector matrix of the Euler angles (a = x, b = y, c = z) as GameRecord.setEuler builds it; returns the third row (forward) */
export function eulerForward(rx: number, ry: number, rz: number): Vec3 {
  const f1 = Math.cos(rx), f2 = Math.sin(rx), f3 = Math.cos(ry), f4 = Math.sin(ry), f5 = Math.cos(rz), f6 = Math.sin(rz);
  return [f6 * f2 + f5 * f4 * f1, f6 * f4 * f1 - f5 * f2, f3 * f1];
}

/**
 * FUN_0043d5ec: the first crossing of the segment a -> b with the faces of the origin-centred box `h` (half extents); returns t (1.01 when there is none)
 * and the crossing point / face normal in `out`.
 */
export function segmentBox(a: ArrayLike<number>, b: ArrayLike<number>, h: ArrayLike<number>, out: { p: Vec3; n: Vec3 }): number {
  let best = 1.01;
  const P = out.p, N = out.n;
  const axis = (i: number, j: number, k: number) => {
    if (a[i] === b[i]) return;
    const inv = 1 / (b[i] - a[i]);
    for (const sgn of [1, -1]) {
      const t = (sgn * h[i] - a[i]) * inv;
      if (t >= 0 && t <= best) {
        const vj = (b[j] - a[j]) * t + a[j];
        if (vj < h[j] && -h[j] < vj) {
          const vk = (b[k] - a[k]) * t + a[k];
          if (vk < h[k] && -h[k] < vk) {
            P[i] = sgn * h[i]; P[j] = vj; P[k] = vk;
            N[0] = N[1] = N[2] = 0; N[i] = sgn;
            best = t;
          }
        }
      }
    }
  };
  axis(0, 1, 2); axis(1, 0, 2); axis(2, 0, 1);
  return best;
}

/** FUN_00468590 (shared by both zones): does the segment prev -> cur cross the collision box of record `bird`? (the box test the pilot makes against the pterodactyls / rock monsters) */
export function segmentHitsRecordBox(bird: GameRecord, prev: ArrayLike<number>, cur: ArrayLike<number>, outPoint: Vec3, outNormal: Vec3, scale = 1): boolean {
  const col = bird.colObj?.col;
  if (!col) return false;
  const c = col.center, e = scale === 1 ? col.halfExtents : [col.halfExtents[0] * scale, col.halfExtents[1] * scale, col.halfExtents[2] * scale];
  const a = bird.toLocal(prev), b = bird.toLocal(cur);
  // FUN_00468590 adds the box centre (local_38 = local_38 + local_1c) before the box test
  const a2 = [a[0] + c[0], a[1] + c[1], a[2] + c[2]], b2 = [b[0] + c[0], b[1] + c[1], b[2] + c[2]];
  const o = { p: [0, 0, 0] as Vec3, n: [0, 0, 0] as Vec3 };
  const t = segmentBox(a2, b2, e, o);
  if (t < 0 || t > 1) return false;
  // the hit point is brought back into the bird's frame (minus the centre) and into the world
  const lp = [o.p[0] - c[0], o.p[1] - c[1], o.p[2] - c[2]];
  const m = bird.m;
  outPoint[0] = lp[0] * m[0] + lp[1] * m[4] + lp[2] * m[8] + m[12];
  outPoint[1] = lp[0] * m[1] + lp[1] * m[5] + lp[2] * m[9] + m[13];
  outPoint[2] = lp[0] * m[2] + lp[1] * m[6] + lp[2] * m[10] + m[14];
  outNormal[0] = o.n[0] * m[0] + o.n[1] * m[4] + o.n[2] * m[8];
  outNormal[1] = o.n[0] * m[1] + o.n[1] * m[5] + o.n[2] * m[9];
  outNormal[2] = o.n[0] * m[2] + o.n[1] * m[6] + o.n[2] * m[10];
  return true;
}

/** FUN_00890290(name, pattern, n) == 0: the first n characters of the record name match (the original compares the 4 name bytes) */
export const nameStarts = (rec: GameRecord, pattern: string) => rec.name.startsWith(pattern);

/** FUN_0043cfee: reflect v about the plane with normal n (v - 2 (v.n) n) */
export function reflect(v: ArrayLike<number>, n: ArrayLike<number>, out: Vec3): Vec3 {
  const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  out[0] = n[0] * -2 * d + v[0]; out[1] = n[1] * -2 * d + v[1]; out[2] = n[2] * -2 * d + v[2];
  return out;
}

/** FUN_0043ab72: v * M + t for a row-vector 16-float matrix */
export function transformPoint(m: ArrayLike<number>, v: ArrayLike<number>, out: Vec3 = [0, 0, 0]): Vec3 {
  out[0] = v[0] * m[0] + v[1] * m[4] + v[2] * m[8] + m[12];
  out[1] = v[0] * m[1] + v[1] * m[5] + v[2] * m[9] + m[13];
  out[2] = v[0] * m[2] + v[1] * m[6] + v[2] * m[10] + m[14];
  return out;
}

/** the C `ftol` of the executable (`__ftol` = fistp truncating toward zero) */
export const ftol = (v: number) => Math.trunc(v);

/**
 * The steering ramp at the end of FUN_004686a3 / FUN_007d3187 (node +0x34 direction, +0x40 yaw rate; 0.01 per step, Left and Right accelerate until +-0.14; the node
 * stores 32-bit floats, so the arithmetic is rounded to float32 like the x87 stores: that is what lets the rate return to exactly zero). `held` = the button mask.
 */
export function steerYaw(n: { yawRate: number; steerDir: number }, held: number) {
  const STEP = Math.fround(0.01);      // 0x3c23d70a at 0x892030
  const f = Math.fround;
  if (!(held & 1)) {                   // Left = 1
    if (n.steerDir === 1 && n.yawRate < 0) n.yawRate = f(n.yawRate + STEP);
  } else {
    n.steerDir = 1;
    if (0 < n.yawRate) n.yawRate = f(n.yawRate - STEP);
    if (-0.14 < n.yawRate) n.yawRate = f(n.yawRate - STEP);       // 0xbe0f5c29 at 0x892480 = -0.14
  }
  if (!(held & 2)) {                   // Right = 2
    if (n.steerDir === 2 && 0 < n.yawRate) n.yawRate = f(n.yawRate - STEP);
  } else {
    n.steerDir = 2;
    if (n.yawRate < 0) n.yawRate = f(n.yawRate + STEP);
    if (n.yawRate < 0.14) n.yawRate = f(n.yawRate + STEP);        // 0x3e0f5c29 at 0x89247c = 0.14
  }
  if (n.steerDir === 1 && 0 < n.yawRate) n.yawRate = f(n.yawRate - STEP);
  if (n.steerDir === 2 && n.yawRate < 0) n.yawRate = f(n.yawRate + STEP);
  const a = Math.abs(n.yawRate);
  if (a < f(0.00999) && f(-1e-5) < a) { n.yawRate = 0; n.steerDir = 0; }   // 0x3c23ad19 / 0xb727c5ac
}
