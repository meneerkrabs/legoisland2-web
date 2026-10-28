// The game's 4x4 matrix builders (FUN_0043a5e4 / FUN_0043a742): Euler angles (radians) + translation (+ scale).
// Row-major, row-vector convention (v' = v * M), left-handed Direct3D space, +Y up.
//   row0 = ( cz*cy,            sz*cy,            -sy    ) * sx
//   row1 = ( cz*sy*sx - sz*cx,  cz*cx + sz*sy*sx,  cy*sx ) * sy   (cx = cos(rx), sx = sin(rx), ...)
//   row2 = ( sz*sx + cz*sy*cx,  sz*sy*cx - cz*sx,  cy*cx ) * sz
//   row3 = ( px, py, pz, 1 )
// (as implemented, the scale multiplies the matrix COLUMNS: column j by s_j; FUN_0043a742)
export function buildMatrix(rx: number, ry: number, rz: number, px: number, py: number, pz: number, sx = 1, sy = 1, sz = 1): Float32Array {
  const cx = Math.cos(rx), sxn = Math.sin(rx), cy = Math.cos(ry), syn = Math.sin(ry), cz = Math.cos(rz), szn = Math.sin(rz);
  const m = new Float32Array(16);
  m[0] = cz * cy * sx; m[1] = szn * cy * sy; m[2] = -syn * sz;
  m[4] = (cz * syn * sxn - szn * cx) * sx; m[5] = (cz * cx + szn * syn * sxn) * sy; m[6] = cy * sxn * sz;
  m[8] = (szn * sxn + cz * syn * cx) * sx; m[9] = (szn * syn * cx - cz * sxn) * sy; m[10] = cy * cx * sz;
  m[12] = px; m[13] = py; m[14] = pz; m[15] = 1;
  return m;
}
