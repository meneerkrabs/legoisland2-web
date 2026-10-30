// The CPU side of the particle renderer (FX_Particle.c FUN_0044f380 / FUN_0044f4c0, Graph: FUN_0088841c, FUN_00887ae5, FUN_008885e0, FUN_00887498): every particle of
// the draw list is projected to the screen as a point, the points are sorted back to front, each becomes a rotated quad of screen space vertices (FVF 0x244:
// x y z rhw, diffuse, two texture coordinate pairs), the quad is clipped to the viewport (Sutherland-Hodgman against left, right, top, bottom) and drawn as a
// triangle fan with the state block of its material.
//
// Everything the original does on the CPU is a literal port and differentially tested against the original code in the x86 interpreter
// (tools/lib/particle-draw-oracle.mjs): the quad build (`buildQuad`), the polygon clip (`clipPolygon`) and the sort (`sortSprites`). The two Direct3D calls the original
// makes (ComputeSphereVisibility and ProcessVertices) are re-implemented from their documented behaviour (`visibleFlags`, `projectPoint`).
import { AP, MV } from './layout.ts';
import { ftol, type PState } from './core.ts';
import type { Particle } from './pool.ts';

const f32 = Math.fround;

/** a vertex of the original's TL vertex buffer: 9 dwords (x y z rhw diffuse u v u2 v2; the last two of the first vertex carry the material and the vertex count) */
export const VSTRIDE = 9;

/** the viewport clip rectangle (DAT_00983a50 .. DAT_00983a5c: left, top, right, bottom in pixels, integers converted to float) */
export interface ClipRect { left: number; top: number; right: number; bottom: number }

/**
 * FUN_0044f4c0(engine, index, screen, dest): the four corners of one sprite, written to `df` / `di` (a Float32Array and an Int32Array over the same buffer) at vertex
 * offset `o` (4 x 9 dwords). `scr` = (x, y, z, rhw) of the projected centre, `invZoom` = DAT_05d3b098 (float32), `sizeScale` = engine + 0x38 (viewport width / initial
 * zoom, float32). The spin angle index (`app.ANGLE`) is advanced elsewhere (once per frame AFTER the draw: `ParticleEngine.advanceSpin`).
 */
export function buildQuad(p: Particle, scr: ArrayLike<number>, invZoom: number, sizeScale: number, ps: PState, df: Float32Array, di: Int32Array, o: number): void {
  const a = p.app, ai = a.i, af = a.f;
  const z = scr[2];
  const R = f32(invZoom * scr[3]);                             // 24-bit x87 value
  const Rf = R;
  // diffuse = (a >> 8) << 24 | (r >> 8) << 16 | (g >> 8) << 8 | (b >> 8), assembled like the original (each term masked with 0xff00 first, the blue byte read as byte 1)
  const col = ((((ai[AP.CA] & 0xff00) << 8) + (ai[AP.CR] & 0xff00)) << 8) + ((ai[AP.CB] >> 8) & 0xff) + (ai[AP.CG] & 0xff00);
  const idx = ai[AP.ANGLE];
  const size = af[AP.SIZE];
  const S = f32(f32(f32(ps.mem[idx] * size) * R) * sizeScale);                // fld sin[idx]; fmul size; fmul R; fmul [engine + 0x38]
  const C = f32(f32(f32(ps.mem[256 + idx] * size) * R) * sizeScale);     // stored as float32 before use
  const x = scr[0], y = scr[1];
  const u = AP.UV;
  // (x + C, y + S) (x - S, y + C) (x - C, y - S) (x + S, y - C)
  df[o] = f32(C + x); df[o + 1] = f32(S + y); df[o + 2] = z; df[o + 3] = Rf; di[o + 4] = col; df[o + 5] = af[u]; df[o + 6] = af[u + 1];
  df[o + 9] = f32(x - S); df[o + 10] = f32(C + y); df[o + 11] = z; df[o + 12] = Rf; di[o + 13] = col; df[o + 14] = af[u + 2]; df[o + 15] = af[u + 3];
  df[o + 18] = f32(x - C); df[o + 19] = f32(y - S); df[o + 20] = z; df[o + 21] = Rf; di[o + 22] = col; df[o + 23] = af[u + 4]; df[o + 24] = af[u + 5];
  df[o + 27] = f32(S + x); df[o + 28] = f32(y - C); df[o + 29] = z; df[o + 30] = Rf; di[o + 31] = col; df[o + 32] = af[u + 6]; df[o + 33] = af[u + 7];
}

/** FUN_00888aae: the vertex where edge a -> b crosses x = edge (all 9 dwords of the result; [4] = a's diffuse, [7] / [8] are left to the caller) */
function crossX(a: Float32Array, ai: Int32Array, ao: number, b: Float32Array, bo: number, edge: number, out: Float32Array, oi: Int32Array, oo: number): void {
  const t = f32(f32(edge - a[ao]) / f32(b[bo] - a[ao]));
  out[oo] = edge;
  out[oo + 1] = f32(f32(f32(b[bo + 1] - a[ao + 1]) * t) + a[ao + 1]);
  out[oo + 2] = f32(f32(f32(b[bo + 2] - a[ao + 2]) * t) + a[ao + 2]);
  out[oo + 3] = f32(f32(f32(b[bo + 3] - a[ao + 3]) * t) + a[ao + 3]);
  out[oo + 5] = f32(f32(f32(b[bo + 5] - a[ao + 5]) * t) + a[ao + 5]);
  out[oo + 6] = f32(f32(f32(b[bo + 6] - a[ao + 6]) * t) + a[ao + 6]);
  oi[oo + 4] = ai[ao + 4];
  out[oo + 7] = 0; out[oo + 8] = 0;
}
/** FUN_00888b74: the same for a horizontal edge y = edge */
function crossY(a: Float32Array, ai: Int32Array, ao: number, b: Float32Array, bo: number, edge: number, out: Float32Array, oi: Int32Array, oo: number): void {
  const t = f32(f32(edge - a[ao + 1]) / f32(b[bo + 1] - a[ao + 1]));
  out[oo + 1] = edge;
  out[oo] = f32(f32(f32(b[bo] - a[ao]) * t) + a[ao]);
  out[oo + 3] = f32(f32(f32(b[bo + 3] - a[ao + 3]) * t) + a[ao + 3]);
  out[oo + 2] = f32(f32(f32(b[bo + 2] - a[ao + 2]) * t) + a[ao + 2]);
  out[oo + 5] = f32(f32(f32(b[bo + 5] - a[ao + 5]) * t) + a[ao + 5]);
  out[oo + 6] = f32(f32(f32(b[bo + 6] - a[ao + 6]) * t) + a[ao + 6]);
  oi[oo + 4] = ai[ao + 4];
  out[oo + 7] = 0; out[oo + 8] = 0;
}

/**
 * FUN_008885e0(verts, scratch): clip the quad in `buf` (vertex 0 at word offset `o`) to the rectangle; both buffers are 9-dword vertex arrays (`bufI` / `scrI` the
 * Int32Array views). The result is in `buf` (the four passes alternate between the two buffers, an even number of them). Returns the vertex count (0 when fewer than 3 remain).
 */
export function clipPolygon(buf: Float32Array, bufI: Int32Array, o: number, scr: Float32Array, scrI: Int32Array, rc: ClipRect): number {
  const left = f32(rc.left), top = f32(rc.top), right = f32(rc.right), bottom = f32(rc.bottom);
  const S = VSTRIDE;
  const copy = (dst: Float32Array, dstI: Int32Array, dO: number, src: Float32Array, srcI: Int32Array, sO: number) => {
    for (let k = 0; k < S; k++) dstI[dO + k] = srcI[sO + k];
  };
  // pass 1: left edge: src = buf, dst = scr
  let n = 0;
  for (let i = 0; i < 4; i++) {
    const a = o + i * S, b = o + (i === 3 ? 0 : i + 1) * S;
    if (buf[a] < left) {
      if (left <= buf[b]) { crossX(buf, bufI, a, buf, b, left, scr, scrI, n * S); n += 1; }
    } else {
      copy(scr, scrI, n * S, buf, bufI, a); n += 1;
      if (buf[b] < left) { crossX(buf, bufI, a, buf, b, left, scr, scrI, n * S); n += 1; }
    }
  }
  if (n < 3) return 0;
  // pass 2: right edge: src = scr, dst = buf
  let m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * S, b = (i === n - 1 ? 0 : i + 1) * S;
    if (right < scr[a]) {
      if (scr[b] <= right) { crossX(scr, scrI, a, scr, b, right, buf, bufI, o + m * S); m += 1; }
    } else {
      copy(buf, bufI, o + m * S, scr, scrI, a); m += 1;
      if (right < scr[b]) { crossX(scr, scrI, a, scr, b, right, buf, bufI, o + m * S); m += 1; }
    }
  }
  if (m < 3) return 0;
  // pass 3: top edge: src = buf, dst = scr
  n = 0;
  for (let i = 0; i < m; i++) {
    const a = o + i * S, b = o + (i === m - 1 ? 0 : i + 1) * S;
    if (buf[a + 1] < top) {
      if (top <= buf[b + 1]) { crossY(buf, bufI, a, buf, b, top, scr, scrI, n * S); n += 1; }
    } else {
      copy(scr, scrI, n * S, buf, bufI, a); n += 1;
      if (buf[b + 1] < top) { crossY(buf, bufI, a, buf, b, top, scr, scrI, n * S); n += 1; }
    }
  }
  if (n < 3) return 0;
  // pass 4: bottom edge: src = scr, dst = buf
  m = 0;
  for (let i = 0; i < n; i++) {
    const a = i * S, b = (i === n - 1 ? 0 : i + 1) * S;
    if (bottom < scr[a + 1]) {
      if (scr[b + 1] <= bottom) { crossY(scr, scrI, a, scr, b, bottom, buf, bufI, o + m * S); m += 1; }
    } else {
      copy(buf, bufI, o + m * S, scr, scrI, a); m += 1;
      if (bottom < scr[b + 1]) { crossY(scr, scrI, a, scr, b, bottom, buf, bufI, o + m * S); m += 1; }
    }
  }
  return m < 3 ? 0 : m;
}

/**
 * FUN_00887ae5(lo, hi) on the projected points (4 floats each: x y z rhw) and the index array, sorting ascending by rhw (far first): median-of-three quicksort with a
 * selection / insertion sort below 10 elements (not stable: the exact algorithm decides the order of equal keys).
 */
export function sortSprites(pts: Float32Array, idx: Int32Array, lo: number, hi: number): void {
  const swap = (a: number, b: number) => {
    for (let k = 0; k < 4; k++) { const t = pts[a * 4 + k]; pts[a * 4 + k] = pts[b * 4 + k]; pts[b * 4 + k] = t; }
    const t = idx[a]; idx[a] = idx[b]; idx[b] = t;
  };
  const key = (i: number) => pts[i * 4 + 3];
  if (hi === lo || hi - lo < 0) return;
  if (hi - lo === 1) { if (key(hi) < key(lo)) swap(lo, hi); return; }
  if (hi - lo < 10) {
    // put the minimum first, then insertion sort the rest
    for (let i = lo + 1; i <= hi; i++) if (key(i) < key(lo)) swap(i, lo);
    for (let i = lo + 1; i <= hi; i++) {
      let j = i;
      const x = pts[i * 4], y = pts[i * 4 + 1], z = pts[i * 4 + 2], w = pts[i * 4 + 3], id = idx[i];
      while (w < key(j - 1)) {
        for (let k = 0; k < 4; k++) pts[j * 4 + k] = pts[(j - 1) * 4 + k];
        idx[j] = idx[j - 1];
        j--;
      }
      pts[j * 4] = x; pts[j * 4 + 1] = y; pts[j * 4 + 2] = z; pts[j * 4 + 3] = w; idx[j] = id;
    }
    return;
  }
  const mid = Math.trunc((lo + hi) / 2);
  if (key(mid) < key(lo)) swap(lo, mid);
  if (key(hi) < key(lo)) swap(lo, hi);
  if (key(hi) < key(mid)) swap(mid, hi);
  const pivot = key(mid);
  swap(mid, hi - 1);
  let c = lo, j = hi - 1, i = c;
  do {
    do { c = i; i = c + 1; } while (key(i) < pivot);
    do { j = j - 1; } while (pivot < key(j));
    swap(i, j);
  } while (i < j);
  swap(i, j);
  swap(i, hi - 1);
  sortSprites(pts, idx, lo, c);
  sortSprites(pts, idx, c + 2, hi);
}

// ---------------------------------------------------------------------------------------------------------------------------
// the two Direct3D 7 calls

/** the six view frustum planes (a, b, c, d) with unit normals from a row-vector view-projection matrix (GL clip space z in -w .. w): left, right, bottom, top, near, far */
export function frustumPlanes(vp: ArrayLike<number>, out: Float32Array = new Float32Array(24)): Float32Array {
  const col = (c: number) => [vp[c], vp[4 + c], vp[8 + c], vp[12 + c]];
  const c0 = col(0), c1 = col(1), c2 = col(2), c3 = col(3);
  const set = (i: number, s: number, a: number[]) => {
    const p = [c3[0] + s * a[0], c3[1] + s * a[1], c3[2] + s * a[2], c3[3] + s * a[3]];
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    out[i * 4] = p[0] / l; out[i * 4 + 1] = p[1] / l; out[i * 4 + 2] = p[2] / l; out[i * 4 + 3] = p[3] / l;
  };
  set(0, 1, c0); set(1, -1, c0); set(2, 1, c1); set(3, -1, c1); set(4, 1, c2); set(5, -1, c2);
  return out;
}

/**
 * IDirect3DDevice7::ComputeSphereVisibility, as far as the particle code looks at it: the result flags are `frustum (0 inside / 1 intersect / 2 outside)` in bits 0..1 and
 * per plane (left 2, right 4, top 6, bottom 8, near 10, far 12) `0 inside / 1 intersect / 2 outside` in two bits. The engine keeps a sprite when `(flags & 0xf) == flags`:
 * only the overall state and the LEFT plane may be anything, the right / top / bottom / near / far planes must have the sphere completely inside.
 */
export function visibleFlags(planes: Float32Array, x: number, y: number, z: number, r: number): number {
  // plane order of `frustumPlanes`: 0 left, 1 right, 2 bottom, 3 top, 4 near, 5 far; bit position of each plane's 2 bit state
  const BIT = [2, 4, 8, 6, 10, 12];
  let flags = 0, outside = false, intersect = false;
  for (let k = 0; k < 6; k++) {
    const d = planes[k * 4] * x + planes[k * 4 + 1] * y + planes[k * 4 + 2] * z + planes[k * 4 + 3];
    if (d < -r) { flags |= 2 << BIT[k]; outside = true; }
    else if (d < r) { flags |= 1 << BIT[k]; intersect = true; }
  }
  return flags | (outside ? 2 : intersect ? 1 : 0);
}

/** ProcessVertices with the identity world matrix: `p * view * proj` to a point on the surface (x, y in pixels, z 0..1, rhw = 1 / w) */
export function projectPoint(vp: ArrayLike<number>, x: number, y: number, z: number, w: number, h: number, out: Float32Array, o: number): void {
  const cx = x * vp[0] + y * vp[4] + z * vp[8] + vp[12];
  const cy = x * vp[1] + y * vp[5] + z * vp[9] + vp[13];
  const cz = x * vp[2] + y * vp[6] + z * vp[10] + vp[14];
  const cw = x * vp[3] + y * vp[7] + z * vp[11] + vp[15];
  const rhw = 1 / cw;
  out[o] = (1 + cx * rhw) * w * 0.5;
  out[o + 1] = (1 - cy * rhw) * h * 0.5;
  out[o + 2] = (cz * rhw + 1) * 0.5;
  out[o + 3] = rhw;
}

/** world position of a particle (the matrix of ProcessVertices is the identity, so this is the transformed point) */
export function particlePos(p: Particle): [number, number, number] {
  const f = p.mov.f;
  return [f[MV.POS], f[MV.POS + 1], f[MV.POS + 2]];
}

/**
 * The spin update at the end of FUN_0044f4c0 (executed for every sprite that is drawn while the game is not paused): `SCT += SCTINC * dt`, the integer angle index is
 * `ftol(SCT + 256)` with the sign of a C `% 256` (a negative value indexes in front of the table: whatever lies there in the original).
 */
export function spinStep(p: Particle, dt: number): void {
  const a = p.app;
  const sum = f32(f32(a.f[AP.SCTINC] * dt) + a.f[AP.SCT]);
  a.f[AP.SCT] = sum;
  a.i[AP.ANGLE] = ftol(f32(sum + 256)) % 256;
}
