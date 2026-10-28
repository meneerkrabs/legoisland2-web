// .col collision files ("CBBX"). Loader in the EXE: FUN_0043f370 (c_src/Collision.cpp), see docs/re/fragments/col.md.
// Local space of the file = the object's mesh space (same units as the .msh next to it).
import { Reader } from './reader.ts';

export interface ColGrid {
  /** cells per axis (x, y, z) */
  dims: [number, number, number];
  /** cell edge length per axis */
  cellSize: [number, number, number];
  /** min corner of cell (0,0,0) = centre - halfExtents. Verified against the polygon lists (the EXE's query code subtracts a further GRID_MARGIN, see doc). */
  origin: [number, number, number];
  /** per cell: u32 start index into `polyList`, u32 count. Stored as 2 u32 per cell. */
  cells: Uint32Array;
}

export interface Col {
  /** bounding box centre (file local space) */
  center: [number, number, number];
  /** bounding box half extents */
  halfExtents: [number, number, number];
  /** bounding sphere radius around `center` (== |halfExtents| for all files with polygons) */
  radius: number;
  /** false for "NCOL" files (nothing to collide with) */
  hasPolys: boolean;
  /** number of polygons */
  count: number;
  /** per polygon u32 flags: query masks test `mask & flags` (bits 0x1/0x2 used by the game's masks 1/3/0x43/0xc3; 0x4 = quad, 0x10/0x20 seen); see doc */
  flags: Uint32Array;
  /** per polygon u32 surface/material id (0..10; selects the footstep sound in the EXE; 710 polygons hold 0xcccccccc/0xcdcdcdcd uninitialised fill) */
  surface: Uint32Array;
  /** per polygon 4 floats: face plane nx,ny,nz,d with n.p = d (outward normal) */
  face: Float32Array;
  /** per polygon 12 floats: three edge planes (nx,ny,nz,d), inside is n.p - d <= 0 */
  edges: Float32Array;
  /** concatenated polygon index lists referenced by the grid cells (GRDP) */
  polyList: Uint32Array;
  grid: ColGrid | null;
  /** bytes after NCOL that the loader ignores (debug-heap fill in 43 shipped files) */
  ignoredTail: number;
}

export const REC_SIZE = 88;

/**
 * Polygon surface ids -> footstep / landing material, from the EXE's walking switch (FUN_0042b8e8: SND_WALK_*) and
 * landing switch (FUN_0042a88f: SND_LAND_*). Ids 2 and 10 (and 5 = water) play nothing there. 9 behaves like 7 for
 * footsteps; ids 9/10 additionally trigger special behaviour in FUN_0053adc3 (not decoded).
 */
export const SURFACE_MATERIAL: Record<number, string> = { 0: 'grass', 1: 'road', 3: 'sand', 4: 'rock', 5: 'water (silent)', 6: 'gravel', 7: 'plastic', 8: 'road', 9: 'plastic' };

/** Polygon flag bits (tested as `queryMask & flags`). Masks used by the EXE: 3, 1, 0x43, 0xc3 (0x40/0x80 are query modifiers, not polygon bits). */
export const COL_FLAG_SOLID_A = 0x01;
export const COL_FLAG_SOLID_B = 0x02;
/** polygon is a quad: a 4th edge plane is read from record bytes 0x48..0x57 (never set in the shipped data) */
export const COL_FLAG_QUAD = 0x04;
export const COL_FLAG_CHARACTER = 0x20;
/** cellSize = 2*(halfExtents + GRID_MARGIN)/dims; the EXE (FUN_00441270) also starts its cell walk at centre - halfExtents - GRID_MARGIN (DAT_00892020 = 1.0f) */
export const GRID_MARGIN = 1.0;

export function parseCol(data: Uint8Array): Col {
  const r = new Reader(data);
  r.expectTag('CBBX');
  const center: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  const halfExtents: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  const radius = r.f32();
  const t = r.tag();
  const empty = { flags: new Uint32Array(0), surface: new Uint32Array(0), face: new Float32Array(0), edges: new Float32Array(0), polyList: new Uint32Array(0) };
  if (t === 'NCOL') {
    return { center, halfExtents, radius, hasPolys: false, count: 0, ...empty, grid: null, ignoredTail: data.length - r.pos };
  }
  if (t !== 'COLP') throw new Error(`expected COLP/NCOL, got "${t}"`);
  const count = r.u32();
  if (r.remaining < count * REC_SIZE) throw new Error('COLP truncated');
  const flags = new Uint32Array(count), surface = new Uint32Array(count);
  const face = new Float32Array(count * 4), edges = new Float32Array(count * 12);
  for (let i = 0; i < count; i++) {
    flags[i] = r.u32();
    surface[i] = r.u32();
    for (let k = 0; k < 4; k++) face[i * 4 + k] = r.f32();
    for (let k = 0; k < 12; k++) edges[i * 12 + k] = r.f32();
    r.skip(16); // 4 u32 of uninitialised runtime data (heap pointers / 0xcdcdcdcd)
  }
  r.expectTag('GRDP');
  const n = r.u32();
  const polyList = r.u32s(n);
  r.expectTag('GRDC');
  const dims: [number, number, number] = [r.u32(), r.u32(), r.u32()];
  const cellSize: [number, number, number] = [r.f32(), r.f32(), r.f32()];
  const nc = dims[0] * dims[1] * dims[2];
  if (r.remaining < nc * 8) throw new Error('GRDC truncated');
  const cells = r.u32s(nc * 2);
  if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes`);
  const origin: [number, number, number] = [0, 1, 2].map((i) => center[i] - halfExtents[i] - GRID_MARGIN) as [number, number, number];
  return { center, halfExtents, radius, hasPolys: true, count, flags, surface, face, edges, polyList, grid: { dims, cellSize, origin, cells }, ignoredTail: 0 };
}

/** Intersection of three planes (rows a,b,c as [nx,ny,nz,d]); null if singular. */
function intersect3(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, c: ArrayLike<number>, co: number): [number, number, number] | null {
  const a0 = a[ao], a1 = a[ao + 1], a2 = a[ao + 2], da = a[ao + 3];
  const b0 = b[bo], b1 = b[bo + 1], b2 = b[bo + 2], db = b[bo + 3];
  const c0 = c[co], c1 = c[co + 1], c2 = c[co + 2], dc = c[co + 3];
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  if (Math.abs(det) < 1e-9) return null;
  const x = (da * (b1 * c2 - b2 * c1) - a1 * (db * c2 - b2 * dc) + a2 * (db * c1 - b1 * dc)) / det;
  const y = (a0 * (db * c2 - b2 * dc) - da * (b0 * c2 - b2 * c0) + a2 * (b0 * dc - db * c0)) / det;
  const z = (a0 * (b1 * dc - db * c1) - a1 * (b0 * dc - db * c0) + da * (b0 * c1 - b1 * c0)) / det;
  return [x, y, z];
}

/**
 * Recover the triangle corners of polygon i from the face plane and the three edge planes
 * (each pair of edge planes meets the face plane in one corner). Returns 9 floats, or null if degenerate.
 * Corner order: (e0,e1), (e1,e2), (e2,e0).
 */
export function polygonCorners(col: Col, i: number): Float32Array | null {
  const out = new Float32Array(9);
  const pairs = [[0, 1], [1, 2], [2, 0]];
  for (let k = 0; k < 3; k++) {
    const p = intersect3(col.face, i * 4, col.edges, i * 12 + pairs[k][0] * 4, col.edges, i * 12 + pairs[k][1] * 4);
    if (!p) return null;
    if (!Number.isFinite(p[0] + p[1] + p[2])) return null;
    out[k * 3] = p[0]; out[k * 3 + 1] = p[1]; out[k * 3 + 2] = p[2];
  }
  return out;
}

/**
 * All triangles as a flat position array (9 floats per triangle, wound counter-clockwise seen from the face-plane normal side,
 * i.e. corners reordered to c0,c2,c1) plus the source polygon index per triangle. Degenerate polygons are skipped.
 */
export function extractTriangles(col: Col): { positions: Float32Array; polygon: Uint32Array } {
  const pos: number[] = [], poly: number[] = [];
  for (let i = 0; i < col.count; i++) {
    const c = polygonCorners(col, i);
    if (!c) continue;
    pos.push(c[0], c[1], c[2], c[6], c[7], c[8], c[3], c[4], c[5]); poly.push(i);
  }
  return { positions: new Float32Array(pos), polygon: new Uint32Array(poly) };
}

/** Cell index ((x*ny + y)*nz + z, z fastest) for a local-space point, or -1 if outside the grid. */
export function gridCellAt(col: Col, x: number, y: number, z: number): number {
  const g = col.grid;
  if (!g) return -1;
  const ix = Math.floor((x - g.origin[0]) / g.cellSize[0]);
  const iy = Math.floor((y - g.origin[1]) / g.cellSize[1]);
  const iz = Math.floor((z - g.origin[2]) / g.cellSize[2]);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= g.dims[0] || iy >= g.dims[1] || iz >= g.dims[2]) return -1;
  return iz + g.dims[2] * (iy + g.dims[1] * ix);
}

/**
 * Candidate polygon indices for the cell containing the point. 1x1x1 grids ignore the list (the EXE tests every polygon,
 * and the list of such files is incomplete), so all indices are returned there.
 */
export function polygonsNear(col: Col, x: number, y: number, z: number): Uint32Array {
  const g = col.grid;
  if (g && g.dims[0] * g.dims[1] * g.dims[2] === 1) return Uint32Array.from({ length: col.count }, (_, i) => i);
  const c = gridCellAt(col, x, y, z);
  if (!g || c < 0) return new Uint32Array(0);
  return col.polyList.subarray(g.cells[c * 2], g.cells[c * 2 + 1] + g.cells[c * 2]);
}

/** Signed distances of point to the face plane and whether it is inside all edge planes (slack in world units). */
export function pointInPolygonPrism(col: Col, i: number, x: number, y: number, z: number, slack = 0): boolean {
  for (let k = 0; k < 3; k++) {
    const o = i * 12 + k * 4;
    if (col.edges[o] * x + col.edges[o + 1] * y + col.edges[o + 2] * z - col.edges[o + 3] > slack) return false;
  }
  return true;
}

/**
 * Nearest hit of the segment a->b against the polygons listed in the grid cells it crosses
 * (sampled conservatively by walking the segment's bounding cell range). Returns {t, polygon} or null.
 * Uses the plane test of FUN_004277B0 without radius/skin (pure ray vs triangle).
 */
export function raycast(col: Col, a: [number, number, number], b: [number, number, number], mask = 0xffffffff): { t: number; polygon: number } | null {
  const g = col.grid;
  if (!g || !col.count) return null;
  let best: { t: number; polygon: number } | null = null;
  const test = (p: number) => {
    if (!(col.flags[p] & mask)) return;
    const nx = col.face[p * 4], ny = col.face[p * 4 + 1], nz = col.face[p * 4 + 2], d = col.face[p * 4 + 3];
    const s0 = nx * a[0] + ny * a[1] + nz * a[2] - d;
    const s1 = nx * b[0] + ny * b[1] + nz * b[2] - d;
    if (s0 * s1 > 0 || s0 === s1) return;
    const t = s0 / (s0 - s1);
    if (best && t >= best.t) return;
    if (pointInPolygonPrism(col, p, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1e-4)) best = { t, polygon: p };
  };
  if (g.dims[0] * g.dims[1] * g.dims[2] === 1) {
    for (let p = 0; p < col.count; p++) test(p);
    return best;
  }
  const lo = [0, 1, 2].map((k) => Math.floor((Math.min(a[k], b[k]) - g.origin[k]) / g.cellSize[k]));
  const hi = [0, 1, 2].map((k) => Math.floor((Math.max(a[k], b[k]) - g.origin[k]) / g.cellSize[k]));
  const seen = new Set<number>();
  for (let ix = Math.max(0, lo[0]); ix <= Math.min(g.dims[0] - 1, hi[0]); ix++)
    for (let iy = Math.max(0, lo[1]); iy <= Math.min(g.dims[1] - 1, hi[1]); iy++)
      for (let iz = Math.max(0, lo[2]); iz <= Math.min(g.dims[2] - 1, hi[2]); iz++) {
        const c = iz + g.dims[2] * (iy + g.dims[1] * ix);
        const s = g.cells[c * 2], n = g.cells[c * 2 + 1];
        for (let j = 0; j < n; j++) {
          const p = col.polyList[s + j];
          if (seen.has(p)) continue;
          seen.add(p);
          test(p);
        }
      }
  return best;
}
