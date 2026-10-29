// 4x4 matrices in the game's (Direct3D) convention: row-major, row vectors (v' = v * M), left-handed, +Y up.
// A Float32Array built this way can be uploaded to GL with transpose=false: GL then sees the transposed
// matrix and computes M^T * v which is the same transform for column vectors.
export type Mat4 = Float32Array;

export const identity = (): Mat4 => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

/** a then b (row-vector order): result = a * b */
export function mul(a: Mat4, b: Mat4, out: Mat4 = new Float32Array(16)): Mat4 {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    out[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  }
  return out;
}

/**
 * FUN_0043a9e5(out, b, a): the game's matrix product `a x b` for row vectors (a is applied first), computed the way the code does it with the x87 in 24-bit precision: every element is
 * `((a.x * b.x-row) + (a.y * b.y-row)) + (a.z * b.z-row)` (the x87's adds run x, y, z; the decompiler prints the sum the other way round), the translation row adds `b`'s translation last; the last column is (0, 0, 0, 1). `a` / `b`: row-major 4x4.
 */
export function mulGame(a: ArrayLike<number>, b: ArrayLike<number>, out: Mat4 = new Float32Array(16)): Mat4 {
  const fr = Math.fround;
  for (let r = 0; r < 4; r++) {
    const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2];
    for (let c = 0; c < 3; c++) {
      let v = fr(fr(fr(a0 * b[c]) + fr(a1 * b[4 + c])) + fr(a2 * b[8 + c]));
      if (r === 3) v = fr(v + b[12 + c]);
      out[r * 4 + c] = v;
    }
    out[r * 4 + 3] = r === 3 ? 1 : 0;
  }
  return out;
}

/** FUN_0043ab72(out, M, p): `p` as a point through the row-major matrix `M`: `((p.x * M[0] + p.y * M[4]) + p.z * M[8]) + M[12]` (and the other two columns), every operation rounded to a float (the x87 adds the three products in x, y, z order) */
export function transformPointGame(m: ArrayLike<number>, p: ArrayLike<number>, out: number[] | Float32Array = [0, 0, 0]): number[] | Float32Array {
  const fr = Math.fround;
  for (let c = 0; c < 3; c++) out[c] = fr(fr(fr(fr(p[0] * m[c]) + fr(p[1] * m[4 + c])) + fr(p[2] * m[8 + c])) + m[12 + c]);
  return out;
}

/** FUN_0043abe6(out, M, v): `v` as a direction (the rotation rows only, no translation, not renormalised): `(v.x * M[0] + v.y * M[4]) + v.z * M[8]`, every operation rounded */
export function transformDirGame(m: ArrayLike<number>, v: ArrayLike<number>, out: number[] | Float32Array = [0, 0, 0]): number[] | Float32Array {
  const fr = Math.fround;
  for (let c = 0; c < 3; c++) out[c] = fr(fr(fr(v[0] * m[c]) + fr(v[1] * m[4 + c])) + fr(v[2] * m[8 + c]));
  return out;
}

export function lookDirLH(eye: number[], f: number[], up = [0, 1, 0]): Mat4 {
  let [zx, zy, zz] = f;
  const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
  // x = up x z
  let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
  const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/** left-handed perspective with GL clip space (z in -1..1), clip.w = view z */
export function perspectiveLH(fovY: number, aspect: number, zn: number, zf: number): Mat4 {
  const h = 1 / Math.tan(fovY / 2), w = h / aspect;
  const m = new Float32Array(16);
  m[0] = w; m[5] = h; m[10] = (zf + zn) / (zf - zn); m[11] = 1; m[14] = (-2 * zf * zn) / (zf - zn);
  return m;
}

export function transformPoint(m: Mat4, p: number[]): number[] {
  return [
    p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12],
    p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13],
    p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14],
  ];
}

export function translation(x: number, y: number, z: number): Mat4 { const m = identity(); m[12] = x; m[13] = y; m[14] = z; return m; }

/** scale (sx, sy, sz) then translate (px, py, pz): the game's FUN_0043a742 without rotation */
export function scaleTranslate(sx: number, sy: number, sz: number, px: number, py: number, pz: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = sx; m[5] = sy; m[10] = sz; m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
  return m;
}
