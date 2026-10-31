// The mesh partition of the original's Graph library (Graph/Mesh `FUN_0088069b`, reached through `FUN_00444530(mesh, nx, ny, nz)` = `FUN_00882d39` -> `FUN_00882ce8`): a set-up call of the
// zones' terrain / scenery meshes (docs/re/rendering.md 4.2a). It cuts the mesh's bounding box into nx * ny * nz cells and gives every cell its own sub-mesh with the triangles that touch it;
// from then on `FUN_0088aca2` draws the mesh through its cells (`FUN_0088b1e5`) instead of the three group passes:
//   * the box is the vertex bounds widened by 1.0 on every side; the cell edge lengths are `(max - min) / n` (float32), the cell corners are accumulated sums of them;
//   * a triangle goes to every cell for which it is not entirely outside one of the cell's six side planes (a vertex test: `FUN_008804e3`), so a triangle that touches several cells is drawn several
//     times (twice blended when its texels are translucent), and big triangles also reach cells they do not touch;
//   * a cell holds its triangles per group in file order; the draw loop is group-major, cell-minor (`for group: for cell: draw`), NOT the passes 0 / 1 / 2 of the unpartitioned mesh: groups
//     are drawn in file order whatever their flags are; group matrices (MATL) do not exist for the cells;
//   * culling of whole cells by their eight corners (`FUN_00416454`) cannot change a pixel and is left to the GPU.
// Pure (no GL). Float handling: the x87 runs in 24-bit mode (cw 0x7f): every operation rounds to a float32, the operand order follows the machine code (verified against the original code in
// the emulator: tools/tests/render-partition.mjs).
const fr = Math.fround;

/** the mesh data the partition reads */
export interface PartitionSource {
  /** x, y, z per vertex */
  positions: ArrayLike<number>;
  vertexCount: number;
  /** u16 indices, relative to the group's `firstVertex` */
  indices: ArrayLike<number>;
  groups: { indexCount: number; firstVertex: number; firstIndex: number }[];
}

/** per cell and group, the triangle numbers (within the group) in order: `cells[c][g]` */
export interface Partition { nx: number; ny: number; nz: number; cells: Int32Array[][] }

/** the cell planes of one cell (6 x [nx, ny, nz, d], float32) built from its eight corners (the order of `FUN_0088069b`) */
export function cellPlanes(corner: ArrayLike<number>): Float32Array {
  const P = new Float32Array(24);
  // [a, b, d]: plane normal = (a - ... ) the two edge vectors are `c[a] - c[a2]` and `c[a] - c[b]` (the decompile's fVar2..7), the plane passes through corner `d`
  const spec: [number, number, number, number, number][] = [
    [1, 0, 1, 2, 0],   // plane 0: a = c1 - c0, b = c1 - c2, through c0
    [5, 1, 5, 6, 1],   // plane 1: a = c5 - c1, b = c5 - c6, through c1
    [2, 3, 2, 6, 3],   // plane 2: a = c2 - c3, b = c2 - c6, through c3
    [3, 0, 3, 7, 0],   // plane 3: a = c3 - c0, b = c3 - c7, through c0
    [4, 0, 4, 5, 0],   // plane 4: a = c4 - c0, b = c4 - c5, through c0
    [5, 6, 5, 4, 6],   // plane 5: a = c5 - c6, b = c5 - c4, through c6
  ];
  spec.forEach(([ia, ja, ib, jb, through], p) => {
    const A = (i: number, k: number) => corner[i * 3 + k];
    const ax = fr(A(ia, 0) - A(ja, 0)), ay = fr(A(ia, 1) - A(ja, 1)), az = fr(A(ia, 2) - A(ja, 2));
    const bx = fr(A(ib, 0) - A(jb, 0)), by = fr(A(ib, 1) - A(jb, 1)), bz = fr(A(ib, 2) - A(jb, 2));
    let nx = fr(fr(ay * bz) - fr(az * by)), ny = fr(fr(az * bx) - fr(ax * bz)), nz = fr(fr(ax * by) - fr(ay * bx));
    // FUN_00415190: s = z*z + y*y + x*x; k = 1 / sqrt(s) (a zero vector is left alone)
    const s = fr(fr(fr(nz * nz) + fr(ny * ny)) + fr(nx * nx));
    if (s !== 0) { const k = fr(1 / fr(Math.sqrt(s))); nx = fr(k * nx); ny = fr(k * ny); nz = fr(k * nz); }
    P[p * 4] = nx; P[p * 4 + 1] = ny; P[p * 4 + 2] = nz;
    P[p * 4 + 3] = fr(fr(fr(nz * A(through, 2)) + fr(ny * A(through, 1))) + fr(nx * A(through, 0)));
  });
  return P;
}

/** `FUN_008804e3`: 2 = the three vertices are outside one common plane (rejected), 0 = none outside any plane, 1 = otherwise (kept). `v` = 9 floats (three vertices) */
export function classifyTriangle(P: Float32Array, v: ArrayLike<number>): number {
  let and = 0x3f, or = 0;
  for (let i = 0; i < 3; i++) {
    let mask = 0;
    for (let p = 0; p < 6; p++) {
      const d = fr(fr(fr(fr(v[i * 3 + 2] * P[p * 4 + 2]) + fr(v[i * 3 + 1] * P[p * 4 + 1])) + fr(v[i * 3] * P[p * 4])) - P[p * 4 + 3]);
      if (0 < d) mask |= 1 << p;
    }
    and &= mask; or |= mask;
  }
  return and !== 0 ? 2 : or === 0 ? 0 : 1;
}

/** `FUN_0088069b`: the triangles of every cell */
export function partitionMesh(src: PartitionSource, nx: number, ny: number, nz: number): Partition {
  const pos = src.positions;
  let minX = 99999, minY = 99999, minZ = 99999, maxX = -99999, maxY = -99999, maxZ = -99999;
  for (let i = 0; i < src.vertexCount; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
    if (maxX < x) maxX = x; if (maxY < y) maxY = y; if (maxZ < z) maxZ = z;
  }
  minX = fr(minX - 1); minY = fr(minY - 1); minZ = fr(minZ - 1);
  maxX = fr(maxX + 1);
  const dx = fr(fr(maxX - minX) / nx), dy = fr(fr(fr(maxY + 1) - minY) / ny), dz = fr(fr(fr(maxZ + 1) - minZ) / nz);
  const cells: Int32Array[][] = [];
  const corner = new Float32Array(24), tri = new Float32Array(9);
  let x0 = minX;
  for (let i = 0; i < nx; i++) {
    let y0 = minY;
    for (let j = 0; j < ny; j++) {
      let z0 = minZ;
      for (let k = 0; k < nz; k++) {
        const x1 = fr(x0 + dx), y1 = fr(y0 + dy), z1 = fr(z0 + dz);
        corner.set([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]);
        z0 = z1;   // `local_44 = local_44 + local_64`
        const P = cellPlanes(corner);
        const perGroup: Int32Array[] = [];
        for (const g of src.groups) {
          const kept: number[] = [];
          for (let t = 0; t < g.indexCount / 3; t++) {
            for (let c = 0; c < 3; c++) {
              const vi = g.firstVertex + src.indices[g.firstIndex + t * 3 + c];
              tri[c * 3] = pos[vi * 3]; tri[c * 3 + 1] = pos[vi * 3 + 1]; tri[c * 3 + 2] = pos[vi * 3 + 2];
            }
            if (classifyTriangle(P, tri) < 2) kept.push(t);
          }
          perGroup.push(Int32Array.from(kept));
        }
        cells.push(perGroup);
      }
      y0 = fr(y0 + dy);
    }
    x0 = fr(x0 + dx);
  }
  return { nx, ny, nz, cells };
}

/**
 * The index buffer of the cell draw: for every group (file order) the triangles of cell 0, then cell 1 ... (`FUN_0088b1e5`'s loops), as indices into the mesh's own vertex buffer
 * (`firstVertex` added). Returns the buffer and per group its `first` / `count`.
 */
export function cellIndexOrder(src: PartitionSource, p: Partition): { indices: Uint32Array; groups: { first: number; count: number }[] } {
  let total = 0;
  for (const c of p.cells) for (const t of c) total += t.length * 3;
  const out = new Uint32Array(total);
  const groups: { first: number; count: number }[] = [];
  let o = 0;
  src.groups.forEach((g, gi) => {
    const first = o;
    for (const c of p.cells) for (const t of c[gi]) for (let k = 0; k < 3; k++) out[o++] = g.firstVertex + src.indices[g.firstIndex + t * 3 + k];
    groups.push({ first, count: o - first });
  });
  return { indices: out, groups };
}

/**
 * The calls of the zones' set-up code to `FUN_00444530(FUN_0043f160(model of record, 0), nx, ny, nz)` (found by scanning the executable's 16 call sites:
 * tools/tests/render-partition.mjs checks this table against them): archive name -> [record, nx, ny, nz]. The island's two calls and z28HAT's three are in the zone's first set-up (z28HAT's
 * second set-up function, 0x792868 -> `FUN_00791990(0)`, skips them: the meshes are already cut).
 */
export const PARTITIONS: Record<string, [record: number, nx: number, ny: number, nz: number][]> = {
  z02LGI: [[4, 8, 1, 8], [0, 8, 1, 8]],
  z05WAB: [[3, 8, 1, 8]],
  z09JST: [[4, 8, 1, 8]],
  z10RGB: [[4, 20, 1, 1]],
  z13CAI: [[4, 8, 1, 8], [0, 8, 1, 8]],
  z15SSH: [[1, 1, 1, 20]],
  z27TRX: [[0, 1, 1, 150], [29, 1, 1, 20], [30, 1, 1, 20], [31, 1, 1, 20], [32, 1, 1, 20]],
  z28HAT: [[1, 8, 1, 8], [4, 8, 1, 8], [5, 8, 1, 8]],
};
