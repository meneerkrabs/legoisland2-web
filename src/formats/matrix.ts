// The game's 4x4 matrix builders (FUN_0043a5e4 / FUN_0043a742): Euler angles (radians) + translation (+ scale).
// Row-major, row-vector convention (v' = v * M), left-handed Direct3D space, +Y up.
//   row0 = ( cz*cy,            sz*cy,            -sy    ) * sx
//   row1 = ( cz*sy*sx - sz*cx,  cz*cx + sz*sy*sx,  cy*sx ) * sy   (cx = cos(rx), sx = sin(rx), ...)
//   row2 = ( sz*sx + cz*sy*cx,  sz*sy*cx - cz*sx,  cy*cx ) * sz
//   row3 = ( px, py, pz, 1 )
// (as implemented, the scale multiplies the matrix COLUMNS: column j by s_j; FUN_0043a742)
// Since WP-ISLAND-FIX the products are float32 per operation (the shared exact builders); the formulas above are the same.
import { eulerMatrix, eulerScaledMatrix } from '../zones/exact.ts';
export function buildMatrix(rx: number, ry: number, rz: number, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1): Float32Array {
  // WP-ISLAND-FIX: the original runs the x87 at 24-bit precision, every product and sum of FUN_0043a5e4 / FUN_0043a742 is rounded to a float32: the exact builders of zones/exact.ts
  if (sx === 1 && sy === 1 && sz === 1) { const m = new Float32Array(16); eulerMatrix(m, rx, ry, rz, px, py, pz); return m; }
  return eulerScaledMatrix(rx, ry, rz, px, py, pz, sx, sy, sz);
}
