// The engine's matrix helpers as the zones' code calls them, with the float32 stores of the original (the shared `buildMatrix` of src/formats/matrix.ts rounds the sines and
// the products differently by a unit in the last place; WP-VERIFY: tools/tests/m7-z08BKD-emu.mjs / m7-z15SSH-emu.mjs compare these bit for bit with the executable's code).
import { fr, ad, sb, ml } from './f32.ts';

/**
 * FUN_0043a5e4(m, rx, ry, rz, x, y, z) / FUN_0043a340 (rotation only): the six sines and cosines are float32 locals (`FUN_0085d374` = cos, `FUN_0085d1c4` = sin of the double),
 * every element is one float32 store of an expression evaluated in the register: row0 = (cz cy, sz cy, -sy), row1 = (cz sy sx - sz cx, cz cx + sz sy sx, cy sx),
 * row2 = (sz sx + cz sy cx, sz sy cx - cz sx, cy cx), row3 = (x, y, z, 1).
 */
export function eulerMatrix(rx: number, ry: number, rz: number, x = 0, y = 0, z = 0, out = new Float32Array(16)): Float32Array {
  const cx = fr(Math.cos(rx)), sx = fr(Math.sin(rx)), cy = fr(Math.cos(ry)), sy = fr(Math.sin(ry)), cz = fr(Math.cos(rz)), sz = fr(Math.sin(rz));
  out[0] = ml(cz, cy); out[1] = ml(sz, cy); out[2] = -sy; out[3] = 0;
  out[4] = sb(ml(ml(cz, sy), sx), ml(sz, cx)); out[5] = ad(ml(cz, cx), ml(ml(sz, sy), sx)); out[6] = ml(cy, sx); out[7] = 0;
  out[8] = ad(ml(sz, sx), ml(ml(cz, sy), cx)); out[9] = sb(ml(ml(sz, sy), cx), ml(cz, sx)); out[10] = ml(cy, cx); out[11] = 0;
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1;
  return out;
}

/** FUN_0043abe6(out, M, v): the vector rotated by the 3 x 3 part: each component (x, y, z products summed in that order, + 0.0) with float32 rounding of every operation */
export function rotateVector(m: ArrayLike<number>, v: ArrayLike<number>, out: number[] = [0, 0, 0]): number[] {
  out[0] = ad(ad(ad(ml(v[0], m[0]), ml(v[1], m[4])), ml(v[2], m[8])), 0);
  out[1] = ad(ad(ad(ml(v[0], m[1]), ml(v[1], m[5])), ml(v[2], m[9])), 0);
  out[2] = ad(ad(ad(ml(v[0], m[2]), ml(v[1], m[6])), ml(v[2], m[10])), 0);
  return out;
}

/** FUN_0043ab72(out, M, v): rotate and translate, x, y, z products summed in that order + the translation, every operation rounded to float32 */
export function transformPoint(m: ArrayLike<number>, v: ArrayLike<number>, out: number[] = [0, 0, 0]): number[] {
  out[0] = ad(ad(ad(ml(v[0], m[0]), ml(v[1], m[4])), ml(v[2], m[8])), m[12]);
  out[1] = ad(ad(ad(ml(v[0], m[1]), ml(v[1], m[5])), ml(v[2], m[9])), m[13]);
  out[2] = ad(ad(ad(ml(v[0], m[2]), ml(v[1], m[6])), ml(v[2], m[10])), m[14]);
  return out;
}

/** FUN_0043a9e5(out, P2, P3) = P3 x P2 (row vectors): element (r, c) = (P3[r][0] P2[0][c] + P3[r][1] P2[1][c]) + P3[r][2] P2[2][c], the translation row + P2[3][c]; the fourth column 0 / 1 */
export function matThen(b: ArrayLike<number>, a: ArrayLike<number>, out = new Float32Array(16)): Float32Array {
  const t = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      const v = ad(ad(ml(b[4 * r], a[c]), ml(b[4 * r + 1], a[4 + c])), ml(b[4 * r + 2], a[8 + c]));
      t[4 * r + c] = r === 3 ? ad(v, a[12 + c]) : v;
    }
    t[4 * r + 3] = r === 3 ? 1 : 0;
  }
  out.set(t);
  return out;
}
