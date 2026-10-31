// Ontwikkelaarshoek, section 10 (2): "Vlieg de camera langs dit pad". A `.man` file is an anonymous matrix track (rotation, translation, scale per key); the game plays it through a
// cutscene's SETPOSITION / MOVEPOSITION / MOVETARGET "spline" commands (CameraSpline of src/shell/cutscene.ts: FUN_0043ecd0 reads the keys with x negated, FUN_004466f0 samples the
// uniform B-spline, progress 1 / count per tick = count / 30 seconds). The unused paths no script names are played here the same way with the zone's debug camera:
//   - 'camera' mode (camera paths: the file name has `cam`): the eye follows the path; the look-at follows the partner path (`bbcrashcam01` -> `bbcrashtarg01`) when there is one, else
//     the path ahead of the eye (bij benadering: the game's script pairs them with a MOVETARGET of its own, which these unused files never got);
//   - 'volg' mode (object paths, targets, anything else): the path is where an OBJECT would be; the camera chases it from 14 units behind and 5 above (a port extension).
// The path is placed in WORLD coordinates as stored (island paths are island coordinates: z02LGI is their host; in another zone they sit relative to the world origin).
// While the corner is closed a RunHook (afterSim) moves `world.camera` each tick; the path is drawn as a polyline through RunHook.draw3d (Renderer.drawLine).
import { CameraSpline } from '../shell/cutscene.ts';
import type { Man } from '../formats/anim.ts';
import type { Renderer } from '../render/index.ts';
import { B } from '../game/input.ts';
import type { DevCorner } from './corner.ts';
import type { RunCtx, RunHook } from './types.ts';
import { manKind, polyline } from './scenes-data.ts';
import type { ManKind } from './scenes-data.ts';

export type FlyMode = 'camera' | 'volg';

export interface FlyPath {
  label: string;
  archive: string;
  name: string;
  kind: ManKind;
  eye: CameraSpline;
  look: CameraSpline | null;
  lookName: string | null;
  /** polylines for drawing (sampled spline) */
  polyEye: number[][];
  polyLook: number[][] | null;
  /** keys (the spline's point count): one step per dt-unit (1/30 s) = count dt-units = count / 30 s */
  count: number;
}

export function makeFlyPath(archive: string, name: string, man: Man, partner?: { name: string; man: Man } | null): FlyPath {
  const eye = new CameraSpline(man), look = partner ? new CameraSpline(partner.man) : null;
  return { label: `${archive}/${name}`, archive, name, kind: manKind(name, man.trackCount), eye, look, lookName: partner?.name ?? null, polyEye: polyline(man), polyLook: partner ? polyline(partner.man) : null, count: eye.count };
}

export interface FlyState {
  path: FlyPath | null;
  mode: FlyMode;
  flying: boolean;
  /** draw the path in the world also when not flying */
  show: boolean;
  /** progress 0..1 */
  p: number;
  /** multiplier of the game's own speed (1 = count / 30 s) */
  speed: number;
  loop: boolean;
  /** extension: the game does not see the pad while flying (Pepper stands still) */
  still: boolean;
}
export const makeFlyState = (): FlyState => ({ path: null, mode: 'camera', flying: false, show: true, p: 0, speed: 1, loop: false, still: true });

const CHASE_BACK = 14, CHASE_UP = 5, LOOK_AHEAD = 0.02;

/** eye and look-at of a path at progress `p` (pure; `volg` and the no-partner camera mode derive the direction from the path ahead: bij benadering) */
export function viewAt(path: FlyPath, p: number, mode: FlyMode): { eye: number[]; target: number[] } {
  const q = Math.min(Math.max(p, 0), 1);
  const at = path.eye.sample(q).slice();
  const ahead = (): number[] => {
    // a tangent from the points around p; at the very end the tangent of the last piece
    const a = path.eye.sample(Math.max(0, Math.min(q, 1 - LOOK_AHEAD) )), b = path.eye.sample(Math.min(1, Math.min(q, 1 - LOOK_AHEAD) + LOOK_AHEAD));
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  };
  if (mode === 'camera') {
    if (path.look) return { eye: at, target: path.look.sample(q).slice() };
    const d = ahead();
    return { eye: at, target: [at[0] + d[0] * 20, at[1] + d[1] * 20, at[2] + d[2] * 20] };
  }
  const d = ahead(), len = Math.hypot(d[0], d[1], d[2]);
  const f = len > 1e-6 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 0, 1];
  return { eye: [at[0] - f[0] * CHASE_BACK, at[1] - f[1] * CHASE_BACK + CHASE_UP, at[2] - f[2] * CHASE_BACK], target: at };
}

/** the default mode for a path kind */
export const defaultMode = (k: ManKind): FlyMode => (k === 'camera' ? 'camera' : 'volg');

const C_EYE = [1, 0.85, 0, 1], C_LOOK = [1, 0.3, 0.9, 1], C_OBJ = [0.2, 0.9, 1, 1], C_NOW = [0.3, 1, 0.3, 1];

export class FlyHook implements RunHook {
  readonly S: FlyState;
  readonly run: RunCtx;
  private readonly c: DevCorner;
  private saved: Float64Array | null = null;
  /** the zone of the host (for the UI) */
  constructor(c: DevCorner, run: RunCtx, S: FlyState) { this.c = c; this.run = run; this.S = S; }

  private paused(): boolean { return this.c.isOpen && this.c.pause; }
  private cutsceneRuns(): boolean { return this.run.kind === 'zone' && this.run.cutscene.active(); }

  /** start flying from the beginning (or continue from `p`) */
  start(from = this.S.p) {
    const S = this.S;
    if (!S.path) return;
    // a running script owns the camera: it is stopped (the flight is the point of the button)
    if (this.cutsceneRuns() && this.run.kind === 'zone') { this.run.cutscene.abort(); this.c.toast('de lopende cutscene is gestopt: de camera is van het pad'); }
    if (!this.saved) this.saved = Float64Array.from(this.run.world.camera.c);
    S.p = from >= 1 ? 0 : from;
    S.flying = true;
    this.c.status('scenes.fly', `camera vliegt langs ${S.path.label}`);
    this.apply();
  }

  /** stop and give the chase camera back */
  stop() {
    const S = this.S;
    S.flying = false;
    this.c.status('scenes.fly', '');
    if (this.saved) {
      const cam = this.run.world.camera;
      for (let i = 0; i < 18; i++) cam.c[i] = this.saved[i];
      this.saved = null;
    }
  }

  /** write the camera for the current progress */
  apply() {
    const S = this.S, cam = this.run.world.camera;
    if (!S.path) return;
    const v = viewAt(S.path, S.p, S.mode), c = cam.c;
    c[0] = v.eye[0]; c[1] = v.eye[1]; c[2] = v.eye[2]; c[3] = v.target[0]; c[4] = v.target[1]; c[5] = v.target[2];
    c[6] = 0; c[7] = 1; c[8] = 0;
    cam.updateView();
  }

  tick() {
    const S = this.S;
    if (!S.flying || !S.still || this.paused()) return;
    const inp = this.c.sh.input, m = ~(B.LEFT | B.RIGHT | B.UP | B.DOWN | B.CTRL) >>> 0;
    inp.held = (inp.held & m) >>> 0; inp.pressed = (inp.pressed & m) >>> 0;
  }

  afterSim() {
    const S = this.S;
    if (!S.flying || !S.path || this.cutsceneRuns()) return;
    // the game's pace: `rate * DAT_008b1718` of the path per sim step (CameraSpline.rate = 1 / count; dt = 1 for the first frames, then 0.5 at the 60 Hz step)
    S.p += (1 / S.path.count) * S.speed * this.run.world.dt;
    if (S.p >= 1) { if (S.loop) S.p -= 1; else { S.p = 1; this.stop(); return; } }   // the end: the chase camera comes back
    this.apply();
  }

  draw3d(r: Renderer) {
    const S = this.S, path = S.path;
    if (!path || !(S.show || S.flying)) return;
    const line = (pts: number[][], col: number[]) => { for (let i = 1; i < pts.length; i++) r.drawLine(pts[i - 1], pts[i], col); };
    const obj = S.mode === 'volg' || path.kind !== 'camera';
    line(path.polyEye, obj ? C_OBJ : C_EYE);
    if (path.polyLook) line(path.polyLook, C_LOOK);
    const v = viewAt(path, S.p, S.mode), at = path.eye.sample(Math.min(Math.max(S.p, 0), 1));
    const s = 1.5;
    r.drawLine([at[0] - s, at[1], at[2]], [at[0] + s, at[1], at[2]], C_NOW);
    r.drawLine([at[0], at[1] - s, at[2]], [at[0], at[1] + s, at[2]], C_NOW);
    r.drawLine([at[0], at[1], at[2] - s], [at[0], at[1], at[2] + s], C_NOW);
    if (S.flying) r.drawLine(v.eye, v.target, C_NOW);
  }

  destroy() {
    // the zone is gone: its camera is not ours to restore
    this.saved = null;
    this.S.flying = false;
    this.c.status('scenes.fly', '');
  }
}
