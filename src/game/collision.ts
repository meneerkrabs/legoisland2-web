// Collision queries of the original engine (GSMS collision code, docs/re/formats.md 8.1):
//   sweep()          = FUN_00441270 (segment with an edge radius and a plane skin against every enabled record)
//   terrainHeight()  = FUN_0043cd62 -> FUN_004425f0 -> FUN_00441b10 (downward ray against the ground record, radius 1.0, skin 0.1, mask 3, with the hit cache of FUN_00441b10)
//   probe()          = FUN_00441ac0 (the same sweep, but the ground record is skipped, radius 0.01, skin 0)
// Polygon test = FUN_00440810 (plane distance with skin, then the three edge planes widened by the radius), cells are walked like
// FUN_004405f0 / FUN_0043f810 (origin = centre - half extents - 1.0, the shipped engine's off-by-margin), the record's box with FUN_0043f9b0.
// Analytic shapes: only the box (shape 3, FUN_00440f30; set by FUN_004427e0 / 00442780 / 004428b0) is implemented; the sphere / cylinder
// shapes (FUN_00440d00 / 00440e00) are never created by the island / house set-up. The NPC bound of records with flag 0x40 is the box (FUN_004410e0 = FUN_00440f30
// without the debug lines, which only draw in the original's debug view).
//
// FLOAT32: Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE anywhere in the executable), so EVERY arithmetic result of the original's code rounds to a float32 mantissa
// (whether the compiler stored it in a local or kept it on the FPU stack). The functions below therefore write `fr` (Math.fround) around every single +, -, *, /, in the order of the
// machine code (the decompile lists the terms of a sum in a different order than the code adds them, so every sum was checked in the assembly), so that a polygon that ties with another
// at the float32 level (two triangles at the same t) is decided like the original and the hit points / normals are bit-identical (tools/tests/m7-walk-col.mjs compares them with the
// original run in the x86 emulation in that mode: 0 differences). sqrt is an `fsqrt` (rounded to a float32, too), sin / cos / atan2 results are doubles until the next operation.
import type { Col } from '../formats/col.ts';
import type { GameRecord } from './record.ts';
import { RF_ENABLED, RF_NO_COLLIDE, RF_SOLID_HIDDEN, RF_NPC } from './record.ts';

const fr = Math.fround;
/** 1e30-ish "no hit yet" (0x7149f2ca) */
const T_INF = new Float32Array(new Uint32Array([0x7149f2ca]).buffer)[0];
/** FUN_004425f0 returns -1e38 (0xfe967699) when the ray finds nothing */
export const NO_GROUND = -1e38;

/** Shared per .col slot, like the original's collision object (0x64 bytes): the box shape fields live here, not in the record. */
export class ColObject {
  readonly col: Col;
  readonly path: string;
  /** col[9] bounding radius (FUN_00442780 raises it to the box diagonal) */
  radius: number;
  /** col[0x13]: 0 = polygons, 3 = box */
  shape = 0;
  /** box half extents (+0x58 / +0x5c / +0x60) */
  box: [number, number, number];
  constructor(col: Col, path = '') {
    this.col = col; this.path = path; this.radius = col.radius;
    this.box = [col.halfExtents[0], col.halfExtents[1], col.halfExtents[2]];
  }
  /** FUN_004427e0: a box of the file's extents */
  setBoxFromFile() { this.shape = 3; this.box = [this.col.halfExtents[0], this.col.halfExtents[1], this.col.halfExtents[2]]; }
  /** FUN_00442780 */
  setBox(hx: number, hy: number, hz: number) {
    hx = fr(hx); hy = fr(hy); hz = fr(hz);
    this.box = [hx, hy, hz]; this.shape = 3;
    const d = fr(Math.sqrt(hz * hz + hy * hy + hx * hx));
    if (this.radius < d) this.radius = d;
  }
  /** FUN_004428b0(rec, r, h) */
  setBoxRadiusHeight(r: number, h: number) {
    const cy = this.col.center[1];
    const t = fr(fr(h) - cy);
    this.setBox(r, cy <= t ? t : cy, r);
  }
}

export interface Hit {
  rec: GameRecord;
  /** world space contact point of the sphere centre */
  point: [number, number, number];
  /** world space surface normal */
  normal: [number, number, number];
  /** polygon index inside the record's collision object (-1 for analytic shapes) */
  polygon: number;
  /** footstep surface id of the polygon (0 for analytic shapes: FUN_004425c0 returns 0 without a polygon) */
  surface: number;
  /** fraction of the sweep (0..1) */
  t: number;
}

interface Best {
  t: number;
  px: number; py: number; pz: number;   // local space contact point (float32)
  nx: number; ny: number; nz: number;   // local space normal (float32)
  poly: number;
  rec: GameRecord | null;
  type: number;                          // 0 polygon, 3 box
}

// float32 scratch vectors: stores into them round like the original's float locals
const _p0 = new Float32Array(3), _p1 = new Float32Array(3), _c = new Float32Array(3);
const _from = new Float32Array(3), _delta = new Float32Array(3), _mid = new Float32Array(3), _to = new Float32Array(3);

/** FUN_0043ab72(out, matrix, v): v * M + translation, ((x m0 + y m4) + z m8) + m12, every component stored as float32 */
function toWorldF(m: Float32Array, v: ArrayLike<number>, out: Float32Array) {
  const x = v[0], y = v[1], z = v[2];
  out[0] = fr(fr(fr(fr(x * m[0]) + fr(y * m[4])) + fr(z * m[8])) + m[12]);
  out[1] = fr(fr(fr(fr(x * m[1]) + fr(y * m[5])) + fr(z * m[9])) + m[13]);
  out[2] = fr(fr(fr(fr(x * m[2]) + fr(y * m[6])) + fr(z * m[10])) + m[14]);
}
/** FUN_0043b022(out, v, matrix): the translated vector is stored (float32), then ((dx m0 + dy m1) + dz m2) per axis (the rows of the matrix) */
function toLocalF(m: Float32Array, v: ArrayLike<number>, out: Float32Array) {
  const dx = fr(v[0] - m[12]), dy = fr(v[1] - m[13]), dz = fr(v[2] - m[14]);
  out[0] = fr(fr(fr(dx * m[0]) + fr(dy * m[1])) + fr(dz * m[2]));
  out[1] = fr(fr(fr(dx * m[4]) + fr(dy * m[5])) + fr(dz * m[6]));
  out[2] = fr(fr(fr(dx * m[8]) + fr(dy * m[9])) + fr(dz * m[10]));
}

/**
 * FUN_0043d159: entering time (0..1 along the segment) of the segment a -> b into the sphere (c, r); the exit time when the start is inside; -1 for a miss.
 * (the original keeps every intermediate in a float32 local)
 */
function raySphereT(a: ArrayLike<number>, b: ArrayLike<number>, c: ArrayLike<number>, r: number): number {
  const fx = fr(a[0] - c[0]), fy = fr(a[1] - c[1]), fz = fr(a[2] - c[2]);
  const dx = fr(b[0] - a[0]), dy = fr(b[1] - a[1]), dz = fr(b[2] - a[2]);
  const aa = fr(fr(fr(dx * dx) + fr(dy * dy)) + fr(dz * dz));
  const inv = fr(1 / fr(2 * aa));
  const bb = fr(2 * fr(fr(fr(dx * fx) + fr(dy * fy)) + fr(dz * fz)));
  const cc = fr(fr(fr(fr(fx * fx) + fr(fy * fy)) + fr(fz * fz)) - fr(r * r));
  const disc = fr(fr(bb * bb) - fr(fr(aa * cc) * 4));
  let t = -1;
  if (0 < disc) {
    const sq = fr(Math.sqrt(disc));
    const t1 = fr(fr(-bb - sq) * inv), t2 = fr(fr(-bb + sq) * inv);
    t = t2;
    if (0 <= t1 && t1 <= t2) t = t1;
  }
  return t;
}

/** FUN_0043f810: quick segment / box rejection (box centred at c with half extents h): the differences are float32 locals */
function segBoxQuick(a: Float32Array, b: Float32Array, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): boolean {
  const ax = fr(a[0] - cx), ay = fr(a[1] - cy), az = fr(a[2] - cz), bx = fr(b[0] - cx), by = fr(b[1] - cy), bz = fr(b[2] - cz);
  if ((hx < Math.abs(ax) || hy < Math.abs(ay) || hz < Math.abs(az)) && (hx < Math.abs(bx) || hy < Math.abs(by) || hz < Math.abs(bz))) {
    if (hx < bx && hx < ax) return false;
    if (hy < by && hy < ay) return false;
    if (hz < bz && hz < az) return false;
    if (bx < -hx && ax < -hx) return false;
    if (by < -hy && ay < -hy) return false;
    if (bz < -hz && az < -hz) return false;
  }
  return true;
}

const _aabbP = new Float32Array(3), _aabbN = new Float32Array(3);
const T_BOX_NONE = fr(1.01);
/**
 * FUN_0043d5ec: nearest crossing of the segment a -> b with the faces of the origin-centred box h (the first crossing in t order among the six
 * face planes, with the crossing inside the face rectangle); returns t (1.01f = none). Point and normal are written to _aabbP / _aabbN.
 */
function segAabb(a0: number, a1: number, a2: number, b0: number, b1: number, b2: number, h0: number, h1: number, h2: number): number {
  let best = T_BOX_NONE;
  const P = _aabbP, N = _aabbN;
  // NOTE: like the original, the crossing coordinates are stored into the out point BEFORE they are checked against the face rectangle, so a failed candidate leaves its
  // coordinates in the out point (FUN_0043f9b0 uses that point as the new segment start)
  if (a0 !== b0) {
    const inv = fr(1 / fr(b0 - a0));
    let t = fr(fr(h0 - a0) * inv);
    if (t >= 0 && t <= best) {
      P[1] = fr(fr(fr(b1 - a1) * t) + a1);
      if (P[1] < h1 && -h1 < P[1]) { P[2] = fr(fr(fr(b2 - a2) * t) + a2); if (P[2] < h2 && -h2 < P[2]) { P[0] = h0; N[0] = 1; N[1] = 0; N[2] = 0; best = t; } }
    }
    t = fr(fr(-h0 - a0) * inv);
    if (t >= 0 && t <= best) {
      P[1] = fr(fr(fr(b1 - a1) * t) + a1);
      if (P[1] < h1 && -h1 < P[1]) { P[2] = fr(fr(fr(b2 - a2) * t) + a2); if (P[2] < h2 && -h2 < P[2]) { P[0] = -h0; N[0] = -1; N[1] = 0; N[2] = 0; best = t; } }
    }
  }
  if (a1 !== b1) {
    const inv = fr(1 / fr(b1 - a1));
    let t = fr(fr(h1 - a1) * inv);
    if (t >= 0 && t <= best) {
      P[0] = fr(fr(fr(b0 - a0) * t) + a0);
      if (P[0] < h0 && -h0 < P[0]) { P[2] = fr(fr(fr(b2 - a2) * t) + a2); if (P[2] < h2 && -h2 < P[2]) { P[1] = h1; N[0] = 0; N[1] = 1; N[2] = 0; best = t; } }
    }
    t = fr(fr(-h1 - a1) * inv);
    if (t >= 0 && t <= best) {
      P[0] = fr(fr(fr(b0 - a0) * t) + a0);
      if (P[0] < h0 && -h0 < P[0]) { P[2] = fr(fr(fr(b2 - a2) * t) + a2); if (P[2] < h2 && -h2 < P[2]) { P[1] = -h1; N[0] = 0; N[1] = -1; N[2] = 0; best = t; } }
    }
  }
  if (a2 !== b2) {
    const inv = fr(1 / fr(b2 - a2));
    let t = fr(fr(h2 - a2) * inv);
    if (t >= 0 && t <= best) {
      P[0] = fr(fr(fr(b0 - a0) * t) + a0);
      if (P[0] < h0 && -h0 < P[0]) { P[1] = fr(fr(fr(b1 - a1) * t) + a1); if (P[1] < h1 && -h1 < P[1]) { P[2] = h2; N[0] = 0; N[1] = 0; N[2] = 1; best = t; } }
    }
    t = fr(fr(-h2 - a2) * inv);
    if (t >= 0 && t <= best) {
      P[0] = fr(fr(fr(b0 - a0) * t) + a0);
      if (P[0] < h0 && -h0 < P[0]) { P[1] = fr(fr(fr(b1 - a1) * t) + a1); if (P[1] < h1 && -h1 < P[1]) { P[2] = -h2; N[0] = 0; N[1] = 0; N[2] = -1; best = t; } }
    }
  }
  return best;
}

/** FUN_0043f9b0: precise segment / box overlap (the segment must enter the box within 0..1) */
function segBoxExact(a: Float32Array, b: Float32Array, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): boolean {
  let ax = fr(a[0] - cx), ay = fr(a[1] - cy), az = fr(a[2] - cz);
  const bx = fr(b[0] - cx), by = fr(b[1] - cy), bz = fr(b[2] - cz);
  if (hx < Math.abs(ax) || hy < Math.abs(ay) || hz < Math.abs(az)) {
    const t = segAabb(ax, ay, az, bx, by, bz, hx, hy, hz);
    if (t < 0 || 1 < t) return false;
    ax = _aabbP[0]; ay = _aabbP[1]; az = _aabbP[2];
  }
  if (hx < Math.abs(bx) || hy < Math.abs(by) || hz < Math.abs(bz)) {
    const t = segAabb(bx, by, bz, ax, ay, az, hx, hy, hz);
    if (t < 0 || 1 < t) return false;
  }
  return true;
}

/** the Ontwikkelaarshoek's debug-draw sink (colours are D3DCOLOR ARGB; `tag` names the category): the code that calls the original's FUN_00445ba0 / FUN_00445c70 / FUN_00440ac0 reports to it when it is set */
export interface DebugSink {
  /** FUN_00445ba0(a, b, colour at a, colour at b) */
  line(tag: string, a: ArrayLike<number>, b: ArrayLike<number>, c0: number, c1: number): void;
  /** FUN_00445c70(pos, type 0 X / 1 + / 2 square, half size, colour) */
  shape(tag: string, pos: ArrayLike<number>, type: number, r: number, color: number): void;
  /** FUN_00440ac0(record matrix, centre, half extents, colour): the 12 edges of a box in the record's space */
  box(tag: string, m: ArrayLike<number> | null, centre: ArrayLike<number>, half: ArrayLike<number>, color: number): void;
}

export class CollisionWorld {
  records: GameRecord[] = [];
  /** DAT_009dec18: the ground record (LAND) used by the terrain ray; null = none */
  groundRec: GameRecord | null = null;
  /** DAT_009dec1c: probe mode, the ground record is skipped */
  skipGround = false;
  /** DAT_009deb78: the polygon of the last hit of any query (FUN_004425c0 reads its surface id) */
  lastHit: { col: ColObject; polygon: number } | null = null;
  /** the hit cache of FUN_00441b10: DAT_009dec24 (the record of the last ray that hit; 0 after a ray that found nothing), DAT_009debd0.. (its start) and DAT_009debb0.. (its end), world space */
  /** false = never use the cache (the original always does; the switch is for ports whose query sequence differs from the original's, see docs/re/engine-m1.md) */
  hitCache = true;
  cacheRec: GameRecord | null = null;
  cacheFrom: number[] = [0, 0, 0]; cacheTo: number[] = [0, 0, 0];
  private best: Best = { t: T_INF, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, poly: -1, rec: null, type: 0 };
  /** per call visit stamps for the polygons of one record (DAT_009dec20 / DAT_008b1a88) */
  private stamp = new Uint32Array(0);
  private stampGen = 1;
  stats = { sweeps: 0, polygonTests: 0 };
  /** Ontwikkelaarshoek (debug only, src/devcorner/camera-probes.ts): the sink of the original's debug-draw queue (FUN_00445ba0 / FUN_00445c70 / FUN_00440ac0); null = off, the default */
  debug: DebugSink | null = null;

  constructor(records: GameRecord[] = []) { this.records = records; }

  /** FUN_004425c0: surface id of the polygon hit last (0 when none or an analytic shape) */
  lastSurface(): number { return this.lastHit ? this.lastHit.col.col.surface[this.lastHit.polygon] ?? 0 : 0; }

  private nextGen(count: number): number {
    if (this.stamp.length < count) this.stamp = new Uint32Array(count);
    if (++this.stampGen > 0xfffffff0) { this.stampGen = 1; this.stamp.fill(0); }
    return this.stampGen;
  }

  /**
   * FUN_00440810 against polygon p of col (local space), updating this.best. radius = edge widening, skin = plane offset (both float32). Follows the machine code: d0 / d1 / the
   * skin-corrected distance / t / the contact point are stored as float32, every operation rounds to a float32, the sums are added in the compiled order.
   */
  private polygon(col: Col, p: number, mask: number, a: Float32Array, b: Float32Array, radius: number, skin: number, rec: GameRecord): boolean {
    this.stats.polygonTests++;
    if (!(mask & col.flags[p])) return false;
    const f = col.face, o = p * 4;
    const n0 = f[o], n1 = f[o + 1], n2 = f[o + 2], d = f[o + 3];
    const d0 = fr(fr(fr(fr(n2 * a[2]) + fr(n1 * a[1])) + fr(a[0] * n0)) - d);
    const d1 = fr(fr(fr(fr(b[0] * n0) + fr(b[1] * n1)) + fr(b[2] * n2)) - d);
    // 340 polygons of the shipped data have NaN planes (degenerate source triangles); the original's x87 compares treat them as a miss
    if (d0 !== d0 || d1 !== d1) return false;
    let denom: number, num: number;
    if (d0 >= 0) {
      num = fr(d0 - skin);
      if (d1 >= 0) {
        if (d0 < d1) return false;
        if (num > 0 && skin < d1) return false;
      }
      denom = fr(d0 - d1);
    } else {
      num = fr(-d0 - skin);
      if (d1 < 0) {
        if (-d0 < -d1) return false;
        if (num > 0 && skin < -d1) return false;
      }
      denom = fr(d1 - d0);
    }
    let t: number, qx: number, qy: number, qz: number;
    if (num <= skin) {
      // start within 2 * skin of the plane: contact at t = 0 (accepted without the best-t comparison), the point projected onto the skin plane
      t = 0;
      const k = d0 < 0 ? -fr(d0 + skin) : fr(skin - d0);
      qx = fr(fr(k * n0) + a[0]); qy = fr(fr(k * n1) + a[1]); qz = fr(fr(k * n2) + a[2]);
    } else {
      t = fr(num / denom);
      if (t < 0 || t > 1) return false; // the original breaks into the debugger here (never happens)
      if (this.best.t < t) return false;
      qx = fr(fr(fr(b[0] - a[0]) * t) + a[0]); qy = fr(fr(fr(b[1] - a[1]) * t) + a[1]); qz = fr(fr(fr(b[2] - a[2]) * t) + a[2]);
    }
    // the three edge planes (a 4th exists for flag 4 polygons, which the shipped data never uses): (z + x) + y, as compiled
    const e = col.edges, eo = p * 12;
    for (let k = 0; k < 3; k++) {
      const q = eo + k * 4;
      if (radius < fr(fr(fr(fr(qz * e[q + 2]) + fr(qx * e[q])) + fr(qy * e[q + 1])) - e[q + 3])) return false;
    }
    const B = this.best;
    B.t = t; B.px = qx; B.py = qy; B.pz = qz; B.nx = n0; B.ny = n1; B.nz = n2; B.poly = p; B.rec = rec; B.type = 0;
    return true;
  }

  /**
   * One record, polygon shape. a / b = segment in the record's local space (float32), rmax = max(radius, skin).
   * Mirrors the polygon branch of FUN_00441270 / FUN_00441b10 (box with FUN_0043f9b0, then either every polygon (1x1x1 grid) or the grid cells).
   */
  private polygons(rec: GameRecord, obj: ColObject, mask: number, a: Float32Array, b: Float32Array, radius: number, skin: number, rmax: number, ray = false): boolean {
    const col = obj.col;
    if (!col.count || !col.grid) return false;
    const c = col.center, h = col.halfExtents;
    // FUN_00441b10 (the ray) has no box test of the object (only the bounding sphere, FUN_0043d159) and tests the grid cells with their plain half size
    if (!ray && !segBoxExact(a, b, c[0], c[1], c[2], fr(rmax + h[0]), fr(rmax + h[1]), fr(rmax + h[2]))) return false;
    const g = col.grid;
    let hit = false;
    if (g.dims[0] === 1 && g.dims[1] === 1 && g.dims[2] === 1) {
      for (let p = 0; p < col.count; p++) if (this.polygon(col, p, mask, a, b, radius, skin, rec)) hit = true;
      return hit;
    }
    const gen = this.nextGen(col.count);
    const stamp = this.stamp;
    // O = (centre - half extents) - 1.0 (local_d8)
    const ox = fr(fr(c[0] - h[0]) - 1), oy = fr(fr(c[1] - h[1]) - 1), oz = fr(fr(c[2] - h[2]) - 1);
    const csx = g.cellSize[0], csy = g.cellSize[1], csz = g.cellSize[2];
    const nx = g.dims[0], ny = g.dims[1], nz = g.dims[2];
    // FUN_00440560 (min / max of the two points) and FUN_004405f0: lo = ftol((min - O) / cs - 0.1f), hi = ftol((max - O) / cs + 0.5), clamped to the grid
    const ftol = (v: number) => Math.trunc(v);
    const minx = a[0] < b[0] ? a[0] : b[0], miny = a[1] < b[1] ? a[1] : b[1], minz = a[2] < b[2] ? a[2] : b[2];
    const maxx = a[0] < b[0] ? b[0] : a[0], maxy = a[1] < b[1] ? b[1] : a[1], maxz = a[2] < b[2] ? b[2] : a[2];
    const lo01 = fr(0.1);
    const cl = (v: number, n: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
    const lx = cl(ftol(fr(fr(fr(minx - ox) / csx) - lo01)), nx), ly = cl(ftol(fr(fr(fr(miny - oy) / csy) - lo01)), ny), lz = cl(ftol(fr(fr(fr(minz - oz) / csz) - lo01)), nz);
    const hx = cl(ftol(fr(fr(fr(maxx - ox) / csx) + 0.5)), nx), hy = cl(ftol(fr(fr(fr(maxy - oy) / csy) + 0.5)), ny), hz = cl(ftol(fr(fr(fr(maxz - oz) / csz) + 0.5)), nz);
    const hcx = fr(csx * 0.5), hcy = fr(csy * 0.5), hcz = fr(csz * 0.5);
    const hr = ray ? 0 : rmax;
    const hsx = ray ? hcx : fr(hcx + hr), hsy = ray ? hcy : fr(hcy + hr), hsz = ray ? hcz : fr(hcz + hr);
    for (let ix = lx; ix <= hx; ix++) {
      for (let iy = ly; iy <= hy; iy++) {
        for (let iz = lz; iz <= hz; iz++) {
          // the cell centre: ((i * cs) + cs / 2) + O, one float32 store
          if (!segBoxQuick(a, b, fr(fr(fr(ix * csx) + hcx) + ox), fr(fr(fr(iy * csy) + hcy) + oy), fr(fr(fr(iz * csz) + hcz) + oz), hsx, hsy, hsz)) continue;
          const cell = (ix * ny + iy) * nz + iz;
          const start = g.cells[cell * 2], n = g.cells[cell * 2 + 1];
          for (let j = 0; j < n; j++) {
            const p = col.polyList[start + j];
            if (stamp[p] === gen) continue;
            stamp[p] = gen;
            if (this.polygon(col, p, mask, a, b, radius, skin, rec)) hit = true;
          }
        }
      }
    }
    return hit;
  }

  /** FUN_00440f30 / FUN_004410e0: the box shape (local space segment a -> b) */
  private box(rec: GameRecord, obj: ColObject, a: Float32Array, b: Float32Array, skin: number): boolean {
    const c = obj.col.center;
    const hx = fr(obj.box[0] + skin), hy = fr(fr(obj.box[1] + skin) + 0.5), hz = fr(obj.box[2] + skin);
    const t = segAabb(fr(a[0] - c[0]), fr(fr(a[1] - c[1]) - 0.5), fr(a[2] - c[2]), fr(b[0] - c[0]), fr(fr(b[1] - c[1]) - 0.5), fr(b[2] - c[2]), hx, hy, hz);
    if (t >= 0 && t <= 1 && t < this.best.t) {
      const B = this.best;
      B.t = t; B.rec = rec; B.type = 3; B.poly = -1;
      if (this.debug && obj.shape === 3) this.debug.box('collision', rec.m, c, obj.box, 0xffffffff);   // FUN_00440f30 -> FUN_00440ac0(rec, centre, half extents, white): the box that was hit (not in the NPC bound FUN_004410e0)
      // the point: float32 (delta), float32 (t * delta), float32 (+ start)
      const dx = fr(b[0] - a[0]), dy = fr(b[1] - a[1]), dz = fr(b[2] - a[2]);
      B.px = fr(fr(t * dx) + a[0]); B.py = fr(fr(t * dy) + a[1]); B.pz = fr(fr(t * dz) + a[2]);
      B.nx = _aabbN[0]; B.ny = _aabbN[1]; B.nz = _aabbN[2];
      return true;
    }
    return false;
  }

  private reset() { const B = this.best; B.t = T_INF; B.rec = null; B.poly = -1; B.type = 0; }

  private finish(rec: GameRecord, obj: ColObject): Hit {
    const B = this.best;
    const m = rec.m;
    // FUN_0043ab72 (point) / FUN_0043abe6 (normal, + 0.0), float32 stores
    const point: [number, number, number] = [
      fr(fr(fr(fr(B.px * m[0]) + fr(B.py * m[4])) + fr(B.pz * m[8])) + m[12]),
      fr(fr(fr(fr(B.px * m[1]) + fr(B.py * m[5])) + fr(B.pz * m[9])) + m[13]),
      fr(fr(fr(fr(B.px * m[2]) + fr(B.py * m[6])) + fr(B.pz * m[10])) + m[14])];
    const normal: [number, number, number] = [
      fr(fr(fr(fr(B.nx * m[0]) + fr(B.ny * m[4])) + fr(B.nz * m[8])) + 0),
      fr(fr(fr(fr(B.nx * m[1]) + fr(B.ny * m[5])) + fr(B.nz * m[9])) + 0),
      fr(fr(fr(fr(B.nx * m[2]) + fr(B.ny * m[6])) + fr(B.nz * m[10])) + 0)];
    this.lastHit = B.poly >= 0 ? { col: obj, polygon: B.poly } : null;
    return { rec, point, normal, polygon: B.poly, surface: B.poly >= 0 ? obj.col.surface[B.poly] : 0, t: B.t };
  }

  /**
   * FUN_00441270. Segment from -> from + delta against all records. `ignore` = the record itself. mask = polygon flag mask (3 walking,
   * 0x43 / 0xc3 camera: bit 0x40 lets NPC-flag records take part in polygon tests, 0x80 excludes hidden solid records).
   * radius = widening of the polygon edge planes, skin = plane offset (the sphere radius against the polygon plane).
   */
  sweep(ignore: GameRecord | null, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number, radius: number, skin: number): Hit | null {
    this.stats.sweeps++;
    this.reset();
    radius = fr(radius); skin = fr(skin);
    const F = _from, D = _delta, M = _mid, T = _to;
    for (let i = 0; i < 3; i++) F[i] = from[i];      // float arguments: float32 values
    for (let i = 0; i < 3; i++) D[i] = delta[i];
    const rmax = radius <= skin ? skin : radius;
    const L = fr(fr(Math.sqrt(fr(fr(fr(D[0] * D[0]) + fr(D[1] * D[1])) + fr(D[2] * D[2])))) + rmax);
    for (let i = 0; i < 3; i++) { M[i] = fr(fr(D[i] * 0.5) + F[i]); T[i] = fr(F[i] + D[i]); }
    let bestRec: GameRecord | null = null, bestObj: ColObject | null = null;
    for (const rec of this.records) {
      if (this.skipGround && rec === this.groundRec) continue;
      const f = rec.flags;
      if (!((((f & RF_SOLID_HIDDEN) !== 0 && (mask & 0x80) === 0) || (f & RF_ENABLED) !== 0))) continue;
      if (f & RF_NO_COLLIDE) continue;
      if (rec === ignore) continue;
      const obj = rec.colObj;
      if (!obj || !(0 < obj.radius)) continue;
      // FUN_00440a70: bounding sphere of the collision object against the segment's mid point
      toWorldF(rec.m, obj.col.center, _c);
      // FUN_00440a70 (optimised code: every operation rounds to a float in the 24-bit x87 mode): (r + L)^2 < (dz^2 + dy^2) + dx^2
      const dx = fr(_c[0] - M[0]), dy = fr(_c[1] - M[1]), dz = fr(_c[2] - M[2]);
      const rr = fr(obj.radius + L);
      if (fr(rr * rr) < fr(fr(fr(dz * dz) + fr(dy * dy)) + fr(dx * dx))) continue;
      toLocalF(rec.m, F, _p0); toLocalF(rec.m, T, _p1);
      let hit = false;
      if ((f & RF_NPC) !== 0 && (mask & 0x40) === 0) hit = this.box(rec, obj, _p0, _p1, skin);
      else if (obj.shape === 0) hit = this.polygons(rec, obj, mask, _p0, _p1, radius, skin, rmax);
      else if (obj.shape === 3) hit = this.box(rec, obj, _p0, _p1, skin);
      if (hit) { bestRec = rec; bestObj = obj; }
    }
    if (!bestRec || !bestObj) return null;
    return this.finish(bestRec, bestObj);
  }

  /** FUN_00441ac0: the sweep without the ground record, radius 0.01 and skin 0 */
  probe(ignore: GameRecord | null, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number): Hit | null {
    this.skipGround = true;
    try { return this.sweep(ignore, from, delta, mask, 0.01, 0); } finally { this.skipGround = false; }
  }

  /**
   * FUN_00441b10 for one record (param_3 = 0): a ray (start, delta) with the given mask / radius / skin; the nearest polygon hit. Differences to the sweep FUN_00441270:
   * the bounding sphere is tested with FUN_0043d159 (segment against the sphere, entering time > 0) instead of the mid point test and the object's box; the grid cells are
   * tested with half size cell / 2 (no radius); and the HIT CACHE: when the last ray that hit was on this record (DAT_009dec24) and both its end points are within 2 units of the
   * last ray's, the polygon of the last hit of ANY query (DAT_009deb78, a sweep may have replaced it, even with a polygon of another object) is tested first and, if the segment
   * hits it, it is the result without looking at the other polygons.
   */
  rayRecord(rec: GameRecord, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number, radius: number, skin: number): Hit | null {
    this.reset();
    const f = rec.flags;
    if (!((((f & RF_SOLID_HIDDEN) !== 0 && (mask & 0x80) === 0) || (f & RF_ENABLED) !== 0))) return null;
    const obj = rec.colObj;
    if (!obj) return null;
    radius = fr(radius); skin = fr(skin);
    const F = _from, D = _delta, T = _to;
    for (let i = 0; i < 3; i++) F[i] = from[i];
    for (let i = 0; i < 3; i++) D[i] = delta[i];
    for (let i = 0; i < 3; i++) T[i] = fr(D[i] + F[i]);
    const rmax = radius <= skin ? skin : radius;
    let hit = false;
    let hitObj = obj;
    if ((f & RF_NPC) !== 0 && (mask & 0x40) === 0) { toLocalF(rec.m, F, _p0); toLocalF(rec.m, T, _p1); hit = this.box(rec, obj, _p0, _p1, skin); }
    else if (obj.shape === 3) { toLocalF(rec.m, F, _p0); toLocalF(rec.m, T, _p1); hit = this.box(rec, obj, _p0, _p1, skin); }
    else if (obj.shape === 0) {
      if (!obj.col.count || !obj.col.grid) return null;
      toLocalF(rec.m, F, _p0); toLocalF(rec.m, T, _p1);
      // the cache test (before the sphere test in the original, its result is only used after it)
      const lh = this.lastHit;
      let cached = false;
      if (this.hitCache && this.cacheRec === rec && lh) {
        const cf = this.cacheFrom, ct = this.cacheTo;
        const a0 = fr(ct[0] - T[0]), a1 = fr(ct[1] - T[1]), a2 = fr(ct[2] - T[2]);
        const b0 = fr(cf[0] - F[0]), b1 = fr(cf[1] - F[1]), b2 = fr(cf[2] - F[2]);
        cached = !(4 <= fr(fr(fr(a0 * a0) + fr(a1 * a1)) + fr(a2 * a2))) && !(4 <= fr(fr(fr(b0 * b0) + fr(b1 * b1)) + fr(b2 * b2)));
      }
      toWorldF(rec.m, obj.col.center, _c);
      if (!(raySphereT(F, T, _c, obj.radius) > 0)) return null;
      if (cached && lh) {
        // FUN_00440810 on the cached polygon (no mask test, the polygon may even belong to another collision object)
        if (this.polygon(lh.col.col, lh.polygon, 0xffffffff, _p0, _p1, radius, skin, rec)) { hit = true; hitObj = lh.col; }
      }
      if (!hit) hit = this.polygons(rec, obj, mask, _p0, _p1, radius, skin, rmax, true);
    }
    // a miss clears the cache record (LAB_004424d7: DAT_009dec24 = 0) on every path that reaches the end (box shapes, NPC bounds, polygon scans); the early returns (flags, no polygons, sphere) leave it
    if (!hit) { this.cacheRec = null; return null; }
    this.cacheRec = rec; this.cacheFrom = [F[0], F[1], F[2]]; this.cacheTo = [T[0], T[1], T[2]];
    return this.finish(rec, hitObj);
  }

  /** FUN_004425f0: the ground height below (x, y, z): ray 500 units down against the ground record, radius 1.0, skin 0.1, minus 0.1 */
  groundRay(x: number, y: number, z: number): number {
    if (!this.groundRec) return NO_GROUND;
    const h = this.rayRecord(this.groundRec, [x, y, z], [0, -500, 0], 3, 1.0, 0.1);
    return h ? fr(h.point[1] - fr(0.1)) : NO_GROUND;
  }

  /** FUN_0043cd62(pos, dy): terrain height below pos + (0, dy, 0), or NO_GROUND */
  terrainHeight(x: number, y: number, z: number, dy = 4): number { return this.groundRay(x, fr(fr(y) + fr(dy)), z); }
}

/** the float32 helpers for the oracle tests (tools/tests/m7-walk-col.mjs compares each one with the original function run in the emulation) */
export const collisionInternals = { segBoxExact, segBoxQuick, segAabb, raySphereT, toLocalF, toWorldF };
