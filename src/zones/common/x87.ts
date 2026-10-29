// The engine's matrix builders as the original's x87 code computes them: Direct3D 7 leaves the FPU in 24-bit precision (docs/re/engine-m1.md 8.1), so every
// multiply / add / subtract result rounds to a float mantissa; only the CRT's sin / cos (53 bit) come out as doubles and are stored as float locals first.
// WP-PART-WIRE / WP-MINI (z21FSH, z20DSP); checked bit for bit against the original in tools/tests/m7-z21FSH-emu.mjs (cw 0x7f).
const F = Math.fround;

/**
 * FUN_0043a5e4(m, rx, ry, rz, x, y, z) in 24-bit x87 (asm 0x43a662..0x43a6f5): cx / sx / cy / sy / cz / sz are float locals (sin / cos of the float arguments); the elements are
 * m0 = cz cy, m1 = sz cy, m2 = -sy, m4 = (cz sy) sx - sz cx, m5 = (sz sy) sx + cz cx, m6 = cy sx, m8 = (cz sy) cx + sz sx, m9 = (sz sy) cx - cz sx, m10 = cy cx, every operation rounded.
 * The translation words are copied as they are; the rotation angles are float32 stack words (rounded here).
 */
export function euler24(rx: number, ry: number, rz: number, x: number, y: number, z: number, out: Float32Array<ArrayBufferLike> = new Float32Array(16)): Float32Array<ArrayBufferLike> {
  rx = F(rx); ry = F(ry); rz = F(rz);
  const cx = F(Math.cos(rx)), sx = F(Math.sin(rx)), cy = F(Math.cos(ry)), sy = F(Math.sin(ry)), cz = F(Math.cos(rz)), sz = F(Math.sin(rz));
  out[0] = F(cz * cy); out[1] = F(sz * cy); out[2] = -sy;
  out[4] = F(F(F(cz * sy) * sx) - F(sz * cx));
  out[5] = F(F(F(sz * sy) * sx) + F(cz * cx));
  out[6] = F(cy * sx);
  out[8] = F(F(F(cz * sy) * cx) + F(sz * sx));
  out[9] = F(F(F(sz * sy) * cx) - F(cz * sx));
  out[10] = F(cy * cx);
  out[3] = out[7] = out[11] = 0; out[15] = 1;
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

/**
 * FUN_0043cf57 / FUN_0043cec0 (24-bit x87): l = ((x x + y y) + z z) stored as a float; for l != 0: k = float(1 / float(sqrt(l))), v = float(k v). Returns float(sqrt(l)) (FUN_0043cf57's result, 0 when l == 0).
 */
export function normalize24(v: number[]): number {
  const l = F(F(F(v[0] * v[0]) + F(v[1] * v[1])) + F(v[2] * v[2]));
  if (l === 0) return 0;
  const sq = F(Math.sqrt(l)), k = F(1 / sq);
  v[0] = F(k * v[0]); v[1] = F(k * v[1]); v[2] = F(k * v[2]);
  return sq;
}

/** a x b, every product rounded before the subtraction (`fld a1; fmul b2; fld a2; fmul b1; fsubp`) */
export function cross24(a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number] {
  return [F(F(a[1] * b[2]) - F(a[2] * b[1])), F(F(a[2] * b[0]) - F(a[0] * b[2])), F(F(a[0] * b[1]) - F(a[1] * b[0]))];
}

/**
 * FUN_0043a742(m, rx, ry, rz, sx, sy, sz) in 24-bit x87 (asm 0x43a7b4..): the rotation of `euler24` with the COLUMNS scaled: m[4 r + 0] x sx, m[4 r + 1] x sy, m[4 r + 2] x sz
 * (each element is float(float(product expression) x scale)); the translation is (x, y, z).
 */
export function eulerScaled24(m: Float32Array, rx: number, ry: number, rz: number, x: number, y: number, z: number, sx: number, sy: number, sz: number): Float32Array {
  rx = F(rx); ry = F(ry); rz = F(rz);
  const cx = F(Math.cos(rx)), sxs = F(Math.sin(rx)), cy = F(Math.cos(ry)), sys = F(Math.sin(ry)), cz = F(Math.cos(rz)), szs = F(Math.sin(rz));
  m[0] = F(F(cz * cy) * sx); m[1] = F(F(szs * cy) * sy); m[2] = F(-sys * sz);
  m[4] = F(F(F(F(cz * sys) * sxs) - F(szs * cx)) * sx); m[5] = F(F(F(F(szs * sys) * sxs) + F(cz * cx)) * sy); m[6] = F(F(cy * sxs) * sz);
  m[8] = F(F(F(F(cz * sys) * cx) + F(szs * sxs)) * sx); m[9] = F(F(F(F(szs * sys) * cx) - F(cz * sxs)) * sy); m[10] = F(F(cy * cx) * sz);
  m[3] = m[7] = m[11] = 0; m[15] = 1; m[12] = x; m[13] = y; m[14] = z;
  return m;
}
