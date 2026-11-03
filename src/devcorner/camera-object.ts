// Section 5 / 4 extra (port, not in the original): "Camera op dit object". Places the camera relative to one zone record (distance, height, azimuth around the record), optionally following it.
// Pure placement maths (importable in node, tested in tools/tests/devcorner-camera.mjs); the hook that applies it right before each drawn frame is `CameraHook` in camera-run.ts.
import { viewBasis } from './camera-free.ts';

/** what the UI edits (lives in the shared camera state: `CameraState.obj`) */
export interface ObjectCamState {
  /** the override is active */
  on: boolean;
  /** index into `world.records` of the chosen record */
  rec: number;
  /** horizontal distance from the record (units; the island's near plane is 4.0, nothing closer than that is drawn) */
  dist: number;
  /** camera height above the record's origin */
  height: number;
  /** degrees around the record: 0 = in front of it (its forward row), 90 = at its right side (its +X row), 180 = behind, 270 = left */
  azimuth: number;
  /** height of the point the camera looks at, above the record's origin */
  aim: number;
  /** keep the camera on the record while it moves; off = the camera stays where it was placed */
  follow: boolean;
}
export const defaultObjectCam = (): ObjectCamState => ({ on: false, rec: -1, dist: 6, height: 2.5, azimuth: 0, aim: 1.5, follow: true });

/** the part of a record the placement needs: position and the rows of its matrix (row-major row-vector 4x4, `GameRecord.m`) */
export interface PlaceRec { m: ArrayLike<number> }

/** eye / target for a record: the horizontal facing is the record's forward row (x, z) normalised (a record that looks straight up or down falls back to +Z), `right` the same for its X row */
export function placeCamera(rec: PlaceRec, s: Pick<ObjectCamState, 'dist' | 'height' | 'azimuth' | 'aim'>): { eye: [number, number, number]; target: [number, number, number] } {
  const m = rec.m;
  const norm = (x: number, z: number, fx: number, fz: number): [number, number] => { const l = Math.hypot(x, z); return l > 1e-6 ? [x / l, z / l] : [fx, fz]; };
  const f = norm(m[8], m[10], 0, 1);
  const r = norm(m[0], m[2], f[1], -f[0]);
  const a = (s.azimuth * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const dx = f[0] * ca + r[0] * sa, dz = f[1] * ca + r[1] * sa;
  const target: [number, number, number] = [m[12], m[13] + s.aim, m[14]];
  const eye: [number, number, number] = [m[12] + dx * s.dist, m[13] + s.height, m[14] + dz * s.dist];
  return { eye, target };
}

/** write eye / target / up and the view basis into an 18-float camera block (`ChaseCamera.c`); `eps` = the look-at's smallest length (FUN_004165a5) */
export function writeCamera(c: Float64Array | Float32Array | number[], eye: ArrayLike<number>, target: ArrayLike<number>, eps = 1e-4) {
  c[0] = eye[0]; c[1] = eye[1]; c[2] = eye[2];
  c[3] = target[0]; c[4] = target[1]; c[5] = target[2];
  c[6] = 0; c[7] = 1; c[8] = 0;
  viewBasis(c, eps);
}

/** the true distance eye -> target (for the UI: the near plane is a distance too) */
export function trueDistance(eye: ArrayLike<number>, target: ArrayLike<number>): number { return Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]); }
