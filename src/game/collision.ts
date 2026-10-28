// Collision queries of the original engine (GSMS collision code, docs/re/formats.md 8.1):
//   sweep()          = FUN_00441270 (segment with an edge radius and a plane skin against every enabled record)
//   terrainHeight()  = FUN_0043cd62 -> FUN_004425f0 -> FUN_00441b10 (downward ray against the ground record, radius 1.0, skin 0.1, mask 3)
//   probe()          = FUN_00441ac0 (the same sweep, but the ground record is skipped, radius 0.01, skin 0)
// Polygon test = FUN_00440810 (plane distance with skin, then the three edge planes widened by the radius), cells are walked like
// FUN_004405f0 / FUN_0043f810 (origin = centre - half extents - 1.0, the shipped engine's off-by-margin), the record's box with FUN_0043f9b0.
// Analytic shapes: only the box (shape 3, FUN_00440f30; set by FUN_004427e0 / 00442780 / 004428b0) is implemented; the sphere / cylinder
// shapes (FUN_00440d00 / 00440e00) are never created by the island / house set-up. Not ported: the hit cache of FUN_00441b10 (a cached polygon
// is tried first there; the full scan finds the same polygon except at overlapping polygons), the NPC bound (records with flag 0x40).
import type { Col } from '../formats/col.ts';
import type { GameRecord } from './record.ts';
import { RF_ENABLED, RF_NO_COLLIDE, RF_SOLID_HIDDEN, RF_NPC } from './record.ts';

/** 1e30-ish "no hit yet" (0x7149f2ca) */
const T_INF = 1e30;
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
    this.box = [hx, hy, hz]; this.shape = 3;
    const d = Math.sqrt(hx * hx + hy * hy + hz * hz);
    if (this.radius < d) this.radius = d;
  }
  /** FUN_004428b0(rec, r, h) */
  setBoxRadiusHeight(r: number, h: number) {
    const cy = this.col.center[1];
    const t = h - cy;
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
  px: number; py: number; pz: number;   // local space contact point
  nx: number; ny: number; nz: number;   // local space normal
  poly: number;
  rec: GameRecord | null;
  type: number;                          // 0 polygon, 3 box
}

const _p0 = [0, 0, 0], _p1 = [0, 0, 0], _tmp = [0, 0, 0];

/** FUN_0043f810: quick segment / box rejection (box centred at c with half extents h) */
function segBoxQuick(a: number[], b: number[], cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): boolean {
  const ax = a[0] - cx, ay = a[1] - cy, az = a[2] - cz, bx = b[0] - cx, by = b[1] - cy, bz = b[2] - cz;
  if ((Math.abs(ax) > hx || Math.abs(ay) > hy || Math.abs(az) > hz) && (Math.abs(bx) > hx || Math.abs(by) > hy || Math.abs(bz) > hz)) {
    if (hx < bx && hx < ax) return false;
    if (hy < by && hy < ay) return false;
    if (hz < bz && hz < az) return false;
    if (bx < -hx && ax < -hx) return false;
    if (by < -hy && ay < -hy) return false;
    if (bz < -hz && az < -hz) return false;
  }
  return true;
}

const _aabbP = [0, 0, 0], _aabbN = [0, 0, 0];
/**
 * FUN_0043d5ec: nearest crossing of the segment a -> b with the faces of the origin-centred box h (the first crossing in t order among the six
 * face planes, with the crossing inside the face rectangle); returns t (1.01 = none). Point and normal are written to _aabbP / _aabbN.
 */
function segAabb(a0: number, a1: number, a2: number, b0: number, b1: number, b2: number, h0: number, h1: number, h2: number): number {
  let best = 1.01;
  const P = _aabbP, N = _aabbN;
  if (a0 !== b0) {
    const inv = 1 / (b0 - a0);
    let t = (h0 - a0) * inv;
    if (t >= 0 && t <= 1.01) {
      const y = (b1 - a1) * t + a1;
      if (y < h1 && -h1 < y) { const z = (b2 - a2) * t + a2; if (z < h2 && -h2 < z) { P[0] = h0; P[1] = y; P[2] = z; N[0] = 1; N[1] = 0; N[2] = 0; best = t; } }
    }
    t = (-h0 - a0) * inv;
    if (t >= 0 && t <= best) {
      const y = (b1 - a1) * t + a1;
      if (y < h1 && -h1 < y) { const z = (b2 - a2) * t + a2; if (z < h2 && -h2 < z) { P[0] = -h0; P[1] = y; P[2] = z; N[0] = -1; N[1] = 0; N[2] = 0; best = t; } }
    }
  }
  if (a1 !== b1) {
    const inv = 1 / (b1 - a1);
    let t = (h1 - a1) * inv;
    if (t >= 0 && t <= best) {
      const x = (b0 - a0) * t + a0;
      if (x < h0 && -h0 < x) { const z = (b2 - a2) * t + a2; if (z < h2 && -h2 < z) { P[0] = x; P[1] = h1; P[2] = z; N[0] = 0; N[1] = 1; N[2] = 0; best = t; } }
    }
    t = (-h1 - a1) * inv;
    if (t >= 0 && t <= best) {
      const x = (b0 - a0) * t + a0;
      if (x < h0 && -h0 < x) { const z = (b2 - a2) * t + a2; if (z < h2 && -h2 < z) { P[0] = x; P[1] = -h1; P[2] = z; N[0] = 0; N[1] = -1; N[2] = 0; best = t; } }
    }
  }
  if (a2 !== b2) {
    const inv = 1 / (b2 - a2);
    let t = (h2 - a2) * inv;
    if (t >= 0 && t <= best) {
      const x = (b0 - a0) * t + a0;
      if (x < h0 && -h0 < x) { const y = (b1 - a1) * t + a1; if (y < h1 && -h1 < y) { P[0] = x; P[1] = y; P[2] = h2; N[0] = 0; N[1] = 0; N[2] = 1; best = t; } }
    }
    t = (-h2 - a2) * inv;
    if (t >= 0 && t <= best) {
      const x = (b0 - a0) * t + a0;
      if (x < h0 && -h0 < x) { const y = (b1 - a1) * t + a1; if (y < h1 && -h1 < y) { P[0] = x; P[1] = y; P[2] = -h2; N[0] = 0; N[1] = 0; N[2] = -1; best = t; } }
    }
  }
  return best;
}

/** FUN_0043f9b0: precise segment / box overlap (the segment must enter the box within 0..1) */
function segBoxExact(a: number[], b: number[], cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): boolean {
  let ax = a[0] - cx, ay = a[1] - cy, az = a[2] - cz;
  const bx = b[0] - cx, by = b[1] - cy, bz = b[2] - cz;
  if (Math.abs(ax) > hx || Math.abs(ay) > hy || Math.abs(az) > hz) {
    const t = segAabb(ax, ay, az, bx, by, bz, hx, hy, hz);
    if (t < 0 || t > 1) return false;
    ax = _aabbP[0]; ay = _aabbP[1]; az = _aabbP[2];
  }
  if (Math.abs(bx) > hx || Math.abs(by) > hy || Math.abs(bz) > hz) {
    const t = segAabb(bx, by, bz, ax, ay, az, hx, hy, hz);
    if (t < 0 || t > 1) return false;
  }
  return true;
}

export class CollisionWorld {
  records: GameRecord[] = [];
  /** DAT_009dec18: the ground record (LAND) used by the terrain ray; null = none */
  groundRec: GameRecord | null = null;
  /** DAT_009dec1c: probe mode, the ground record is skipped */
  skipGround = false;
  /** DAT_009deb78: the polygon of the last hit of any query (FUN_004425c0 reads its surface id) */
  lastHit: { col: ColObject; polygon: number } | null = null;
  private best: Best = { t: T_INF, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, poly: -1, rec: null, type: 0 };
  /** per call visit stamps for the polygons of one record (DAT_009dec20 / DAT_008b1a88) */
  private stamp = new Uint32Array(0);
  private stampGen = 1;
  stats = { sweeps: 0, polygonTests: 0 };

  constructor(records: GameRecord[] = []) { this.records = records; }

  /** FUN_004425c0: surface id of the polygon hit last (0 when none or an analytic shape) */
  lastSurface(): number { return this.lastHit ? this.lastHit.col.col.surface[this.lastHit.polygon] ?? 0 : 0; }

  private nextGen(count: number): number {
    if (this.stamp.length < count) this.stamp = new Uint32Array(count);
    if (++this.stampGen > 0xfffffff0) { this.stampGen = 1; this.stamp.fill(0); }
    return this.stampGen;
  }

  /** FUN_00440810 against polygon p of col (local space), updating this.best. radius = edge widening, skin = plane offset. */
  private polygon(col: Col, p: number, mask: number, a: number[], b: number[], radius: number, skin: number, rec: GameRecord): boolean {
    this.stats.polygonTests++;
    if (!(mask & col.flags[p])) return false;
    const f = col.face, o = p * 4;
    const nx = f[o], ny = f[o + 1], nz = f[o + 2], d = f[o + 3];
    const d0 = a[0] * nx + a[1] * ny + a[2] * nz - d;
    const d1 = b[0] * nx + b[1] * ny + b[2] * nz - d;
    // 340 polygons of the shipped data have NaN planes (degenerate source triangles); the original's x87 compares treat them as a miss
    if (d0 !== d0 || d1 !== d1) return false;
    let denom: number, num: number;
    if (d0 >= 0) {
      if (d1 >= 0) {
        if (d0 < d1) return false;
        if (d0 - skin > 0 && skin < d1) return false;
      }
      denom = d0 - d1; num = d0 - skin;
    } else {
      const n = -d0 - skin;
      if (d1 < 0) {
        if (-d0 < -d1) return false;
        if (n > 0 && skin < -d1) return false;
      }
      denom = d1 - d0; num = n;
    }
    let t: number, qx: number, qy: number, qz: number;
    if (num <= skin) {
      t = 0;
      const k = d0 < 0 ? -(d0 + skin) : skin - d0;
      qx = k * nx + a[0]; qy = k * ny + a[1]; qz = k * nz + a[2];
    } else {
      t = num / denom;
      if (t < 0 || t > 1) return false; // the original breaks into the debugger here (never happens)
      if (this.best.t < t) return false;
      qx = (b[0] - a[0]) * t + a[0]; qy = (b[1] - a[1]) * t + a[1]; qz = (b[2] - a[2]) * t + a[2];
    }
    // the t = 0 path (start within 2 * skin of the plane) is accepted without the best-t comparison; both then test the three edge planes
    // (a 4th edge plane exists for flag 4 polygons, which the shipped data never uses)
    const e = col.edges, eo = p * 12;
    for (let k = 0; k < 3; k++) {
      const q = eo + k * 4;
      if (radius < e[q] * qx + e[q + 1] * qy + e[q + 2] * qz - e[q + 3]) return false;
    }
    const B = this.best;
    B.t = t; B.px = qx; B.py = qy; B.pz = qz; B.nx = nx; B.ny = ny; B.nz = nz; B.poly = p; B.rec = rec; B.type = 0;
    return true;
  }

  /**
   * One record, polygon shape. a / b = segment in the record's local space, rmax = max(radius, skin).
   * Mirrors the polygon branch of FUN_00441270 / FUN_00441b10 (box with FUN_0043f9b0, then either every polygon (1x1x1 grid) or the grid cells).
   */
  private polygons(rec: GameRecord, obj: ColObject, mask: number, a: number[], b: number[], radius: number, skin: number, rmax: number): boolean {
    const col = obj.col;
    if (!col.count || !col.grid) return false;
    const c = col.center, h = col.halfExtents;
    if (!segBoxExact(a, b, c[0], c[1], c[2], h[0] + rmax, h[1] + rmax, h[2] + rmax)) return false;
    const g = col.grid;
    let hit = false;
    if (g.dims[0] === 1 && g.dims[1] === 1 && g.dims[2] === 1) {
      for (let p = 0; p < col.count; p++) if (this.polygon(col, p, mask, a, b, radius, skin, rec)) hit = true;
      return hit;
    }
    const gen = this.nextGen(col.count);
    const stamp = this.stamp;
    // O = centre - half extents - 1.0 (FUN_00441270: local_d8 = c - h - 1.0)
    const ox = c[0] - h[0] - 1, oy = c[1] - h[1] - 1, oz = c[2] - h[2] - 1;
    const csx = g.cellSize[0], csy = g.cellSize[1], csz = g.cellSize[2];
    const nx = g.dims[0], ny = g.dims[1], nz = g.dims[2];
    // FUN_004405f0: lo = ftol((min - O) / cs - 0.1), hi = ftol((max - O) / cs + 0.5), clamped to the grid
    const ftol = (v: number) => Math.trunc(v);
    const minx = Math.min(a[0], b[0]), miny = Math.min(a[1], b[1]), minz = Math.min(a[2], b[2]);
    const maxx = Math.max(a[0], b[0]), maxy = Math.max(a[1], b[1]), maxz = Math.max(a[2], b[2]);
    const cl = (v: number, n: number) => (v < 0 ? 0 : v > n - 1 ? n - 1 : v);
    const lx = cl(ftol((minx - ox) / csx - 0.1), nx), ly = cl(ftol((miny - oy) / csy - 0.1), ny), lz = cl(ftol((minz - oz) / csz - 0.1), nz);
    const hx = cl(ftol((maxx - ox) / csx + 0.5), nx), hy = cl(ftol((maxy - oy) / csy + 0.5), ny), hz = cl(ftol((maxz - oz) / csz + 0.5), nz);
    const hsx = csx * 0.5 + rmax, hsy = csy * 0.5 + rmax, hsz = csz * 0.5 + rmax;
    for (let ix = lx; ix <= hx; ix++) {
      for (let iy = ly; iy <= hy; iy++) {
        for (let iz = lz; iz <= hz; iz++) {
          if (!segBoxQuick(a, b, ix * csx + csx * 0.5 + ox, iy * csy + csy * 0.5 + oy, iz * csz + csz * 0.5 + oz, hsx, hsy, hsz)) continue;
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

  /** FUN_00440f30: the box shape (local space segment a -> b) */
  private box(rec: GameRecord, obj: ColObject, a: number[], b: number[], skin: number): boolean {
    const c = obj.col.center;
    const hx = obj.box[0] + skin, hy = obj.box[1] + skin + 0.5, hz = obj.box[2] + skin;
    const t = segAabb(a[0] - c[0], a[1] - c[1] - 0.5, a[2] - c[2], b[0] - c[0], b[1] - c[1] - 0.5, b[2] - c[2], hx, hy, hz);
    if (t >= 0 && t <= 1 && t < this.best.t) {
      const B = this.best;
      B.t = t; B.rec = rec; B.type = 3; B.poly = -1;
      B.px = (b[0] - a[0]) * t + a[0]; B.py = (b[1] - a[1]) * t + a[1]; B.pz = (b[2] - a[2]) * t + a[2];
      B.nx = _aabbN[0]; B.ny = _aabbN[1]; B.nz = _aabbN[2];
      return true;
    }
    return false;
  }

  private reset() { const B = this.best; B.t = T_INF; B.rec = null; B.poly = -1; B.type = 0; }

  private finish(ret: Hit | null, rec: GameRecord, obj: ColObject): Hit | null {
    const B = this.best;
    const m = rec.m;
    const point: [number, number, number] = [
      B.px * m[0] + B.py * m[4] + B.pz * m[8] + m[12],
      B.px * m[1] + B.py * m[5] + B.pz * m[9] + m[13],
      B.px * m[2] + B.py * m[6] + B.pz * m[10] + m[14]];
    const normal: [number, number, number] = [
      B.nx * m[0] + B.ny * m[4] + B.nz * m[8],
      B.nx * m[1] + B.ny * m[5] + B.nz * m[9],
      B.nx * m[2] + B.ny * m[6] + B.nz * m[10]];
    void ret;
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
    const rmax = radius <= skin ? skin : radius;
    const L = Math.sqrt(delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]) + rmax;
    const mx = delta[0] * 0.5 + from[0], my = delta[1] * 0.5 + from[1], mz = delta[2] * 0.5 + from[2];
    const toX = from[0] + delta[0], toY = from[1] + delta[1], toZ = from[2] + delta[2];
    let bestRec: GameRecord | null = null, bestObj: ColObject | null = null;
    const to = [toX, toY, toZ];
    for (const rec of this.records) {
      if (this.skipGround && rec === this.groundRec) continue;
      const f = rec.flags;
      if (!((((f & RF_SOLID_HIDDEN) !== 0 && (mask & 0x80) === 0) || (f & RF_ENABLED) !== 0))) continue;
      if (f & RF_NO_COLLIDE) continue;
      if (rec === ignore) continue;
      const obj = rec.colObj;
      if (!obj || obj.radius <= 0) continue;
      // FUN_00440a70: bounding sphere of the collision object against the segment's mid point
      rec.toWorld(obj.col.center, _tmp);
      const dx = _tmp[0] - mx, dy = _tmp[1] - my, dz = _tmp[2] - mz;
      const rr = obj.radius + L;
      if (rr * rr < dx * dx + dy * dy + dz * dz) continue;
      rec.toLocal(from, _p0); rec.toLocal(to, _p1);
      let hit = false;
      if ((f & RF_NPC) !== 0 && (mask & 0x40) === 0) hit = this.box(rec, obj, _p0, _p1, skin);
      else if (obj.shape === 0) hit = this.polygons(rec, obj, mask, _p0, _p1, radius, skin, rmax);
      else if (obj.shape === 3) hit = this.box(rec, obj, _p0, _p1, skin);
      if (hit) { bestRec = rec; bestObj = obj; }
    }
    if (!bestRec || !bestObj) return null;
    return this.finish(null, bestRec, bestObj);
  }

  /** FUN_00441ac0: the sweep without the ground record, radius 0.01 and skin 0 */
  probe(ignore: GameRecord | null, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number): Hit | null {
    this.skipGround = true;
    try { return this.sweep(ignore, from, delta, mask, 0.01, 0); } finally { this.skipGround = false; }
  }

  /** FUN_00441b10 for one record: a ray (start, delta) with the given mask / radius / skin; the nearest polygon hit. */
  rayRecord(rec: GameRecord, from: ArrayLike<number>, delta: ArrayLike<number>, mask: number, radius: number, skin: number): Hit | null {
    this.reset();
    const f = rec.flags;
    if (!((((f & RF_SOLID_HIDDEN) !== 0 && (mask & 0x80) === 0) || (f & RF_ENABLED) !== 0))) return null;
    const obj = rec.colObj;
    if (!obj) return null;
    const to = [from[0] + delta[0], from[1] + delta[1], from[2] + delta[2]];
    rec.toLocal(from, _p0); rec.toLocal(to, _p1);
    const rmax = radius <= skin ? skin : radius;
    let hit = false;
    if ((f & RF_NPC) !== 0 && (mask & 0x40) === 0) hit = this.box(rec, obj, _p0, _p1, skin);
    else if (obj.shape === 0) hit = this.polygons(rec, obj, mask, _p0, _p1, radius, skin, rmax);
    else if (obj.shape === 3) hit = this.box(rec, obj, _p0, _p1, skin);
    return hit ? this.finish(null, rec, obj) : null;
  }

  /** FUN_004425f0: the ground height below (x, y, z): ray 500 units down against the ground record, radius 1.0, skin 0.1, minus 0.1 */
  groundRay(x: number, y: number, z: number): number {
    if (!this.groundRec) return NO_GROUND;
    const h = this.rayRecord(this.groundRec, [x, y, z], [0, -500, 0], 3, 1.0, 0.1);
    return h ? h.point[1] - 0.1 : NO_GROUND;
  }

  /** FUN_0043cd62(pos, dy): terrain height below pos + (0, dy, 0), or NO_GROUND */
  terrainHeight(x: number, y: number, z: number, dy = 4): number { return this.groundRay(x, y + dy, z); }
}
