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
