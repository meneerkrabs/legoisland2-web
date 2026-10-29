// The "view plane" of the original (Faces.c FUN_0087f01e, wrapper FUN_00444500(y)): an infinite horizontal plane at height `y`, drawn without depth test and with the far plane temporarily 2000.
// docs/re/rendering.md section 10 (WP-RENDER R6). What the decompile settles:
//   * the TEXTURED pass (scrolling UVs u = x / 100 + 0.2 sin t1, v = z / 100 + 0.15 cos t2) only runs when DAT_05d5faac != 0; that global is written only by FUN_0087f854, which nothing in the
//     executable calls (no call, no pointer): the pass is dead code and `t1` / `t2` never advance. FUN_0087f8ca (the other variant, FUN_00444510) is not called either.
//   * the COLOURED pass always runs. A quad 8 units in front of the camera (+-6 wide and high, spanned by the view's right and up vectors) is clipped (FUN_0087ee7b) to the part ABOVE the eye
//     height + 0.01, every vertex is projected from the line through it and the eye onto the plane (0, -1, 0, 200) = the horizontal plane y = -200 (FUN_0087ea1e; the function's argument `y`
//     (0 for z10RGB, -106 for z22BIP) only feeds the dead textured pass): for an eye BELOW y = -200 that is a surface seen from below, in front of the camera; for any eye above it every
//     projected vertex lies behind the camera and nothing is visible (the test's random cameras show both). Vertices of the original quad get the colour
//     (0, ftol(255 d^2), 255) with d = cos of the angle between their direction and the horizontal view direction; the vertices made by the clip (the horizon) cyan (0, 255, 255).
//     Triangle list (0, i + 1, i), state block 0x1d (vertex colour and alpha, blended, no depth).
//   * callers: z10RGB's LAND draw hook (FUN_005f7709: the plane at y = 0 BEFORE the record) and z22BIP's SEAB hook (FUN_0070fc64: the plane at y = -106 AFTER the record).
// Pure (no GL).
const fr = Math.fround;

/** DAT_009812bc / DAT_009812c0 (0.6) x 10 = half extent of the quad, 0.8 (DAT_00892084) x 10 = its distance, 0.01 (DAT_00892030) = the clip height above the eye */
export const VIEWPLANE_HALF = fr(fr(10) * fr(0.6)), VIEWPLANE_DIST = fr(fr(10) * fr(0.8)), VIEWPLANE_CLIP = fr(0.01);

export interface ViewPlaneInput {
  eye: ArrayLike<number>;
  /** the view direction (unit): the third column of the view matrix */
  fwd: ArrayLike<number>;
  /** the camera's up vector (DAT_00986d88..90: (0, 1, 0)) */
  up: ArrayLike<number>;
  /** the camera target (DAT_00986d78..80): only its horizontal offset from the eye is used */
  target: ArrayLike<number>;
  /** FUN_0087f01e's argument (0 for z10RGB, -106 for z22BIP): only the dead textured pass uses it, kept so callers can pass what the original passes */
  level?: number;
  /** widescreen: the quad's half width is multiplied by this (1 at 4:3 = the original) so that it still covers a wider view */
  widen?: number;
}
export interface ViewPlaneMesh {
  /** n x (x, y, z) */
  positions: Float32Array;
  /** n x (r, g, b, a) bytes */
  colors: Uint8Array;
  /** triangle list (0, i + 1, i) */
  indices: Uint16Array;
  count: number;
}

const norm = (v: number[]) => {
  const l2 = fr(fr(fr(v[0] * v[0]) + fr(v[1] * v[1])) + fr(v[2] * v[2]));
  if (l2 !== 0) { const k = fr(1 / fr(Math.sqrt(l2))); v[0] = fr(k * v[0]); v[1] = fr(k * v[1]); v[2] = fr(k * v[2]); }
  return v;
};

/** FUN_0087e6fc: the four corners of the quad in front of the camera (top left, top right, bottom right, bottom left) */
export function viewPlaneQuad(inp: ViewPlaneInput): number[][] {
  const f = inp.fwd, up = inp.up, e = inp.eye;
  const f8 = [fr(f[0] * fr(0.8)), fr(f[1] * fr(0.8)), fr(f[2] * fr(0.8))];
  const right = norm([fr(fr(up[1] * f8[2]) - fr(up[2] * f8[1])), fr(fr(up[2] * f8[0]) - fr(up[0] * f8[2])), fr(fr(up[0] * f8[1]) - fr(up[1] * f8[0]))]);
  const upv = norm([fr(fr(right[1] * f8[2]) - fr(right[2] * f8[1])), fr(fr(right[2] * f8[0]) - fr(right[0] * f8[2])), fr(fr(right[0] * f8[1]) - fr(right[1] * f8[0]))]);
  const c = [0, 1, 2].map((k) => fr(fr(f8[k] * 10) + e[k]));
  const w = fr(VIEWPLANE_HALF * (inp.widen ?? 1));
  const R = right.map((v) => fr(fr(v * 10) * fr(0.6))).map((v) => fr(v * (w / VIEWPLANE_HALF)));
  const U = upv.map((v) => fr(fr(v * 10) * fr(0.6)));
  const corner = (su: number, sr: number) => [0, 1, 2].map((k) => fr(fr(c[k] + su * U[k]) + sr * R[k]));
  return [corner(1, -1), corner(1, 1), corner(-1, 1), corner(-1, -1)];
}

/** FUN_0087ee7b: the part of the polygon strictly above `y` (Sutherland-Hodgman against a horizontal plane); `flag[i]` = 1 for the vertices the clip made. Fewer than 3 vertices = nothing */
export function clipAbove(poly: number[][], y: number): { pts: number[][]; flag: number[] } {
  const pts: number[][] = [], flag: number[] = [];
  const cross = (a: number[], b: number[]) => {
    const k = fr(fr(a[1] - y) / fr(a[1] - b[1]));
    return [fr(a[0] - fr(fr(a[0] - b[0]) * k)), y, fr(a[2] - fr(fr(a[2] - b[2]) * k))];   // FUN_0087ecf2
  };
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], next = poly[(i + 1) % poly.length];
    if (cur[1] <= y) {
      if (y < next[1]) { pts.push(cross(cur, next)); flag.push(1); }
    } else {
      pts.push([cur[0], cur[1], cur[2]]); flag.push(0);
      if (next[1] < y) { pts.push(cross(cur, next)); flag.push(1); }
    }
  }
  return pts.length < 3 ? { pts: [], flag: [] } : { pts, flag };
}

/** the plane the coloured pass projects onto: n = (0, -1, 0), d = 200 (local_48..local_3c of FUN_0087f01e): dot(p, n) - d = 0 at y = -200 */
export const VIEWPLANE_NY = -1, VIEWPLANE_D = 200;

/** FUN_0087ea1e(out, p2, p3, plane (0, ny, 0, d)): where the line through p2 and p3 meets the plane; the caller guarantees p2 and p3 differ in height */
export function planeHit(p2: ArrayLike<number>, p3: ArrayLike<number>, ny = VIEWPLANE_NY, d = VIEWPLANE_D): number[] {
  const f2 = fr(fr(p2[1] * ny) - d), f3 = fr(fr(p3[1] * ny) - d);
  const t = fr(f2 / fr(f2 - f3));
  return [fr(fr(fr(p3[0] - p2[0]) * t) + p2[0]), fr(fr(fr(p3[1] - p2[1]) * t) + p2[1]), fr(fr(fr(p3[2] - p2[2]) * t) + p2[2])];
}

/** the coloured pass: vertices (projected onto the plane), colours and the triangle list; null when the clipped polygon is empty */
export function viewPlaneMesh(inp: ViewPlaneInput): ViewPlaneMesh | null {
  const e = inp.eye;
  const { pts, flag } = clipAbove(viewPlaneQuad(inp), fr(e[1] + VIEWPLANE_CLIP));
  if (!pts.length) return null;
  const n = pts.length;
  // the horizontal view direction
  const hf = norm([fr(inp.target[0] - e[0]), 0, fr(inp.target[2] - e[2])]);
  const positions = new Float32Array(n * 3), colors = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const h = planeHit(pts[i], e);
    positions.set(h, i * 3);
    let g = 255;
    if (!flag[i]) {
      const d = norm([fr(pts[i][0] - e[0]), fr(pts[i][1] - e[1]), fr(pts[i][2] - e[2])]);
      const dot = fr(fr(fr(d[0] * hf[0]) + fr(d[1] * hf[1])) + fr(d[2] * hf[2]));
      g = Math.trunc(fr(fr(255 * dot) * dot));   // __ftol: truncation
    }
    // (g << 8) | 0xff0000ff: alpha 0xff, red 0 (a green above 255 would spill into it), blue 0xff
    const word = ((g << 8) | 0xff0000ff) >>> 0;
    colors[i * 4] = (word >> 16) & 255; colors[i * 4 + 1] = (word >> 8) & 255; colors[i * 4 + 2] = word & 255; colors[i * 4 + 3] = word >>> 24;
  }
  const indices = new Uint16Array((n - 2) * 3);
  for (let i = 1; i < n - 1; i++) { indices[(i - 1) * 3] = 0; indices[(i - 1) * 3 + 1] = i + 1; indices[(i - 1) * 3 + 2] = i; }
  return { positions, colors, indices, count: n };
}


// ------------------------------------------------------------------------------------------------ the textured pass (dead code in the original, a debug option of the port)
// FUN_0087f01e's FIRST pass runs only when DAT_05d5faac != 0. That global is written by FUN_0087f854(n1, n2, speed?) alone, which nothing in the executable calls (no call, no pointer), so the
// original never draws it. What the code says, if it had been called:
//   * FUN_0087f854(param_1, param_2, param_3): DAT_05d5fad0 = param_3 (read by nothing in the pass); DAT_05d5fab0[i] = i for i < param_1; DAT_05d5fac0[i] = param_1 + i for i < param_2;
//     DAT_05d5faa8 = param_2; DAT_05d5faac = param_1 (the switch). The pass binds texture number `DAT_05d5fac0[0]` = param_1 to stage 0 AND stage 1 (FUN_00412243(stage, texture): the zone's
//     texture list at 0x987bb0). So the texture is the first argument; its value is NOT in the code (nobody calls it): the port takes it as a parameter.
//   * the polygon: the quad of FUN_0087e6fc clipped (FUN_0087ed4f) to the part BELOW the eye (y < eye.y - 0.0001, DAT_00892284); each vertex projected from the eye onto the plane
//     (0, 1, 0, level) = the horizontal plane y = `level`, the argument of FUN_0087f01e (0 for z10RGB's LAND hook, -106 for z22BIP's SEAB hook): a huge floor at the zone's level seen below
//     the horizon (the coloured pass uses the other plane, y = -200);
//   * vertex format 0x242 (position, diffuse, TWO texture coordinate sets): diffuse 0xCFFFFFFF (white, alpha 207), set 0 = (x / 100 + 0.2 sin t1, z / 100 + 0.15 cos t2) with
//     t1, t2 (DAT_05d5fad4 / 8, 0 at start) growing by 0.01 after every drawn frame, set 1 = (x / 100, z / 100);
//   * state block 0x10 (stage 0: texture only for colour, texture x vertex alpha for alpha, alpha blend, no depth test); stage 1 is not part of the blocks (left at its default: off), so set 1 is unused;
//   * drawn BEFORE the coloured pass, with the far plane at 2000.
export const VIEWPLANE_TEX_PRESET = 0x10;
/** DAT_00892284: the clip height below the eye */
export const VIEWPLANE_TEX_CLIP = fr(0.0001);
/** DAT_0089201c: world units per texture repeat; DAT_008920f0 / DAT_00892624: the wobble amplitudes (u, v); DAT_00892030: the phase step per drawn frame */
export const VIEWPLANE_TEX_SCALE = 100, VIEWPLANE_TEX_WOBBLE_U = fr(0.2), VIEWPLANE_TEX_WOBBLE_V = fr(0.15), VIEWPLANE_TEX_STEP = fr(0.01);
/** the diffuse colour dword of every vertex: alpha 0xCF, RGB white */
export const VIEWPLANE_TEX_DIFFUSE = 0xcfffffff;

/** FUN_0087ed4f: the part of the polygon strictly below `y` (the mirror of `clipAbove`); fewer than 3 vertices = nothing */
export function clipBelow(poly: number[][], y: number): number[][] {
  const out: number[][] = [];
  const cross = (a: number[], b: number[]) => {
    const k = fr(fr(a[1] - y) / fr(a[1] - b[1]));
    return [fr(a[0] - fr(fr(a[0] - b[0]) * k)), y, fr(a[2] - fr(fr(a[2] - b[2]) * k))];   // FUN_0087ecf2
  };
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i], next = poly[(i + 1) % poly.length];
    if (y <= cur[1]) { if (next[1] < y) out.push(cross(cur, next)); }
    else { out.push([cur[0], cur[1], cur[2]]); if (y < next[1]) out.push(cross(cur, next)); }
  }
  return out.length < 3 ? [] : out;
}

export interface ViewPlaneTexMesh {
  /** n x (x, y, z) */
  positions: Float32Array;
  /** n x (u, v): texture coordinate set 0 (the scrolled one) */
  uvs: Float32Array;
  /** n x (u, v): set 1 (x / 100, z / 100; unused: stage 1 is off) */
  uvs1: Float32Array;
  /** n x (r, g, b, a) bytes */
  colors: Uint8Array;
  indices: Uint16Array;
  count: number;
}

/** the textured pass for the phases `t1`, `t2` (DAT_05d5fad4 / DAT_05d5fad8); null when nothing of the quad is below the eye */
export function viewPlaneTexturedMesh(inp: ViewPlaneInput, t1: number, t2: number): ViewPlaneTexMesh | null {
  const level = fr(inp.level ?? 0);
  const e = inp.eye;
  const pts = clipBelow(viewPlaneQuad(inp), fr(fr(e[1]) - VIEWPLANE_TEX_CLIP));
  if (!pts.length) return null;
  const n = pts.length;
  const positions = new Float32Array(n * 3), uvs = new Float32Array(n * 2), uvs1 = new Float32Array(n * 2), colors = new Uint8Array(n * 4);
  const su = Math.sin(fr(t1)), cv = Math.cos(fr(t2));   // fsin / fcos leave an extended value in st(0): only the product with the amplitude rounds
  for (let i = 0; i < n; i++) {
    const h = planeHit(pts[i], e, 1, level);   // plane (0, 1, 0, level)
    positions.set(h, i * 3);
    const u = fr(h[0] / VIEWPLANE_TEX_SCALE), v = fr(h[2] / VIEWPLANE_TEX_SCALE);
    uvs1[i * 2] = u; uvs1[i * 2 + 1] = v;
    uvs[i * 2] = fr(fr(su * VIEWPLANE_TEX_WOBBLE_U) + u); uvs[i * 2 + 1] = fr(fr(cv * VIEWPLANE_TEX_WOBBLE_V) + v);
    colors[i * 4] = 255; colors[i * 4 + 1] = 255; colors[i * 4 + 2] = 255; colors[i * 4 + 3] = VIEWPLANE_TEX_DIFFUSE >>> 24;
  }
  const indices = new Uint16Array((n - 2) * 3);
  for (let i = 1; i < n - 1; i++) { indices[(i - 1) * 3] = 0; indices[(i - 1) * 3 + 1] = i + 1; indices[(i - 1) * 3 + 2] = i; }
  return { positions, uvs, uvs1, colors, indices, count: n };
}
