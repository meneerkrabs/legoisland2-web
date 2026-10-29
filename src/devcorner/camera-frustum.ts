// Section 4 "Camera en tekenen", part 5: the view-pyramid export of the original, FUN_00415497(apex, p2, points) (LE2.c: "c:\Debug.obj", 0 callers), pure logic.
//
// The function writes a Wavefront OBJ to c:\Debug.obj (fopen mode "wt"): with fprintf the format strings of the executable (0x8a15b0 .. 0x8a163c, read from it at run time):
//   v <apex>                                  (param_1, three doubles %f)
//   <blank>                                   (0x8a15bc)
//   v <point 1> .. v <point 4>                (param_3 + 12 * k, k = 1 .. 4: the four corners; entry 0 is not used)
//   v <p2>                                    (param_2)
//   v <p2 x> <p2 y> <p2 z + 1.0>              (param_2 with z + _DAT_00892020 = 1.0)
//   <blank> <blank> <blank>                   (0x8a15e4, 0x8a15e8, 0x8a15ec)
//   f 1 2 3 / f 1 3 4 / f 1 4 5 / f 1 5 2    (the four sides of the pyramid)
//   f 2 3 4 5                                 (the far plane)
//   f 6 7 6                                   (a degenerate face: the marker segment p2 -> p2 + (0, 0, 1))
//   <blank> <blank>                           (0x8a1638, 0x8a163c)
// FUN_00415497 has no callers, so what apex / p2 / the points are is not known; the port takes: apex = the camera's eye, points 1 .. 4 = the corners of the view pyramid at a chosen depth
// (the far plane: top left, top right, bottom right, bottom left), p2 = the look-at target. UNCERTAIN: that role assignment is a guess; the file format is exact.
export interface ExeText { u32(va: number): number; cstr(va: number, max?: number): string }
type P3 = ArrayLike<number>;
const cross = (a: P3, b: P3): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: P3): number[] => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** printf("%f") of a double: six decimals, "-0.000000" for negative zero like the C runtime */
export function cf(v: number): string { return Object.is(v, -0) ? '-0.000000' : v.toFixed(6); }

/** the strings of the executable the function prints */
export const OBJ_STRINGS = { vertex: [0x8a15b0, 0x8a15c0, 0x8a15cc, 0x8a15d8], blank: [0x8a15bc, 0x8a15e4, 0x8a15e8, 0x8a15ec, 0x8a1638, 0x8a163c], faces: [0x8a15f0, 0x8a15fc, 0x8a1608, 0x8a1614, 0x8a1620, 0x8a162c], file: 0x8a15a0, mode: 0x8a159c } as const;

/** the file's text. `pts` = 5 points (index 0 unused, 1 .. 4 the corners), `oneZ` = _DAT_00892020 (1.0) */
export function frustumObj(pe: ExeText, apex: P3, p2: P3, pts: readonly P3[], oneZ = 1): string {
  const fmt = (va: number, a: number, b: number, c: number) => pe.cstr(va).replace('%f', cf(a)).replace('%f', cf(b)).replace('%f', cf(c));
  const v = OBJ_STRINGS.vertex;
  let s = fmt(v[0], apex[0], apex[1], apex[2]);
  s += pe.cstr(OBJ_STRINGS.blank[0]);
  for (let k = 1; k < 5; k++) s += fmt(v[1], pts[k][0], pts[k][1], pts[k][2]);
  s += fmt(v[2], p2[0], p2[1], p2[2]);
  s += fmt(v[3], p2[0], p2[1], Math.fround(p2[2] + oneZ));
  for (const a of OBJ_STRINGS.blank.slice(1, 4)) s += pe.cstr(a);
  for (const a of OBJ_STRINGS.faces) s += pe.cstr(a);
  for (const a of OBJ_STRINGS.blank.slice(4)) s += pe.cstr(a);
  return s;
}

/** the corners of the view pyramid at `depth` in front of the eye: top left, top right, bottom right, bottom left (index 0 = the apex, so the result can be passed as `pts`) */
export function pyramidCorners(eye: P3, target: P3, fovY: number, aspect: number, depth: number): number[][] {
  const f = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const r = norm(cross([0, 1, 0], f));
  const u = cross(f, r);
  const hy = Math.tan(fovY / 2) * depth, hx = hy * aspect;
  const c = [eye[0] + f[0] * depth, eye[1] + f[1] * depth, eye[2] + f[2] * depth];
  const at = (sx: number, sy: number) => [c[0] + r[0] * hx * sx + u[0] * hy * sy, c[1] + r[1] * hx * sx + u[1] * hy * sy, c[2] + r[2] * hx * sx + u[2] * hy * sy];
  return [[eye[0], eye[1], eye[2]], at(-1, 1), at(1, 1), at(1, -1), at(-1, -1)];
}
