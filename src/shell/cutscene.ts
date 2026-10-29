// The cutscene manager ("CSM", Common\CSM, Manager.c; docs/re/architecture.md 5, docs/re/m4/wp2-cutscenes.md): the runner of the compiled `.cut` scripts
// (src/formats/cutscene.ts), DOM-free. A zone declares script slots (`FUN_0045c310(n)` + `FUN_0045c397(slot, script, messages)`), starts one (`FUN_0045c40c(slot)`)
// and calls `tick()` every frame of the modes that run it (`FUN_0045c402`); `active()` is `FUN_0045c432`. Commands are scheduled by wait / signal ids exactly like
// `FUN_00459119` (3 passes: start pending commands whose wait counter is 0, run the running ones, finish the done ones); the script ends in the frame in which no
// command ran (a running camera FOLLOW does not count).
//
// INSTRUCTION COVERAGE (ids of FUN_0045988b; handler addresses in docs/re/m4/wp2-cutscenes.md). Everything below is ported 1:1 from the decompile:
//   load (FUN_0045d68a)   : actor lookup by 4-char name, first record wins (FUN_0045d5c0; CMRA / SWCH / PLAY are global = handled by FUN_0045eaf0); an unknown actor stops the
//                           loader: that command and all later ones stay as the debug heap left them (wait id 0xcdcd) and never start; the same for the extra commands the
//                           header counts beyond the records; waypoints resolve CSM map first, then PATH (actor MOVEPOSITION: PATH only), prefix match (FUN_00462b4e);
//                           SETANIM names through the animation dictionary; SETSWITCH names through the zone's switch dictionary, then SWITCH_GME_*; `.man` splines
//                           (camera: FUN_004454e0 B-spline of the track's translations; actors: FUN_0043ee40 matrix track)
//   actor (FUN_0045c49d)  : SETVISIBILITY 0, SETANIM 1 (+ done when FUN_0043b92a says the clip ended, then the extra duration), SAYTEXT 2 (speech, subtitle, random mouth
//                           frames FUN_0043f2f0), SETTARGET 3 (yaw), SETPOSITION 5 (PATH node of the resolved index + walker re-pin), MOVEPOSITION 6 (waypoint walker
//                           FUN_0045c66b / FUN_0045c80d, or a `.man` matrix track FUN_0043efa0), FOLLOW 7 (walker follow mode FUN_00462729 until facing), SETEXPRESSION 13,
//                           ATTACH 14 (FUN_00429638 on the actor's carry node; logical fallback when the record has none), ENABLEAI 15
//   global (FUN_0045eaf0) : camera SETTARGET / MOVETARGET / SETPOSITION (waypoint or actor-relative FUN_00422f21 with side words) / MOVEPOSITION (eased move or B-spline) /
//                           FOLLOW, SETSWITCH, WAV/MIDI (stub), SETMOVESPEED / SETTARGETSPEED, SETFOV
//   per frame             : FUN_00459740 (registered actors' animations advance, ground snap FUN_0045965d unless a spline drives them), near plane 2.0
//   start / end           : FUN_00458d15 (camera block + FOV saved, speeds, counters, bars, PEPPER_CONTROL |= 0x100, near plane 1.0; an empty script locks the manager like
//                           the original) / the end of FUN_00459119 (AI back on, walker lanes restored, Pepper: walker unregistered, idle clip, camera behind her
//                           FUN_00422f21, mouth frames restored, FOV restored, the one-deep queue, bars off, PEPPER_CONTROL &= ~0x100)
//   skip (Shift edge)     : zero delays, snap moves / animations / speech / splines to their end (FUN_00459597 and every handler's 0x40 branch)
// Approximations (see the doc): actors without an animation instance count as "clip ended"; ATTACH without a carry node uses a logical attachment (no offset);
// actors without a controller / walker (the port's NPCs before their nodes exist) skip the walker commands exactly like the original's null walker does.
import type { Cutscene, CutCommand } from '../formats/cutscene.ts';
import type { Man } from '../formats/anim.ts';
import { buildMatrix } from '../formats/matrix.ts';
import type { GameRecord } from '../game/record.ts';
import type { World } from '../game/world.ts';
import type { WaypointSystem, StepOut } from '../game/walker.ts';
import { V } from '../game/vars.ts';

/** units per tick of an actor's MOVEPOSITION when no waypoint system is given (M3 zones: straight walk) */
export const ACTOR_SPEED = 0.5;
/** the camera looks at an actor 3.37 above its position (0x892380) */
export const ACTOR_LOOK_HEIGHT = 3.37;
/** seconds per tick: 0.03333 (0x8922bc) */
export const SEC_PER_TICK = 0.03333;
/** FUN_00458d15: default camera ease constants (0x3da3d70a = 0.08 ease, 0x3ecccccd = 0.4 max step) */
export const CAM_EASE = 0.08, CAM_MAX = 0.4;
/** DAT_0089df30 (near plane): 1.0 at the start, 2.0 every frame of a script */
export const NEAR_START = 1, NEAR_RUNNING = 2;
/** FUN_00458fa6: at most 0x30 registered actors */
export const MAX_ACTORS = 0x30;
/** FUN_0045c66b: walker tuning of an actor's MOVEPOSITION (0x3d4ccccd speed, 0x3f060a63 turn, 0x3e4ccccd / 0x3f400000 radii, 0x3e800000 limit, lane 0) */
export const CSM_WALK = { speed: 0.05, turn: 0.523596, radiusMin: 0.2, radiusMax: 0.75, radiusLimit: 0.25 };
/** FUN_0045c80d: the skip key steps a walking actor at most 0x5dd times, then puts it on the node */
export const SKIP_WALK_STEPS = 0x5dd;
/** FUN_0045cb50: turn rate used for the one skip step of FOLLOW (0x40490fdb = pi) */
export const SKIP_FOLLOW_TURN = Math.PI;
/** FUN_00422f21 side vectors: camera SETPOSITION actor uses (4, 2, -10) (DAT_008b91a8) and height 3.37; the end of a script puts the camera BEHIND Pepper with
 *  (0, 4, -20) (DAT_008b8658) at height 3.2 (0x404ccccd) */
export const SIDE_VEC_CSM: readonly [number, number, number] = [4, 2, -10];
export const SIDE_VEC_END: readonly [number, number, number] = [0, 4, -20];
export const END_HEIGHT = 3.2;
/** FUN_00422f21: the side order tried when the camera is blocked (DAT_008adc6c = 1 5 2 3 4, ends at 6), the sweep radius 2.4 (0x4019999a), mask 3 */
export const SIDE_RETRY = [1, 5, 2, 3, 4];
export const SIDE_SWEEP_RADIUS = 2.4;
/** FUN_00422f21: the 0x1000 flag skips the collision test from story node 8 on (var 0x58 >= 8) */
export const SIDE_NOCOLLIDE = 0x1000;
/** the side words of `setposition actor <code> <side>` */
export const SIDE = { HEAD: 0, FRONT: 1, BEHIND: 2, LSIDE: 3, RSIDE: 4 } as const;
/** DAT_008ae088 value FUN_00459119 forces when Pepper walks (PEPPER_CONTROL & 1) */
export const PEP_END_CLIP = 0x1b;
/** FUN_0045965d: probe from 4 above the actor, no ground below -80 (0x8920bc) gives a 160 deep probe */
export const SNAP_UP = 4, SNAP_NO_GROUND = -80, SNAP_DEPTH = -160;
/** FUN_0043b92a(anim, 2.0): the clip has ended when frameCount < frame + 2 * dt + 1 */
export const CLIP_END_MARGIN = 2;
/** FUN_00429638 bones (GOB 0, RIGHTHAND 0xe, LEFTHAND 0x10) */
export const BONE = { GOB: 0, RIGHTHAND: 0xe, LEFTHAND: 0x10 } as const;
/** FLT_MAX: the saved lane of an actor without walker (DAT_05d47b30 init 0x7f7fffff) */
const NO_LANE = 3.4028234663852886e38;

/**
 * A TDict lookup (FUN_0045c144) over a name -> value map: case-insensitive (FUN_0045c0b6 / FUN_0045c242), the first entry of a name wins, values are signed 16-bit
 * (0xffff = -1: the island's `Dummy_` switches); a missing name gives undefined (the original returns the last slot's value, -1)
 */
export function dictLookup(m: ReadonlyMap<string, number> | undefined): (name: string) => number | undefined {
  const r = new Map<string, number>();
  if (m) for (const [k, v] of m) { const u = k.toUpperCase(); if (!r.has(u)) r.set(u, v >= 0x8000 ? v - 0x10000 : v); }
  return (name) => r.get(name.toUpperCase());
}

/** SETSWITCH resolution of FUN_0045d68a: the zone's switch dictionary (DAT_00987e20) first, then the SWITCH_GME_* names of the game variables (DAT_00987e1c) */
export function switchResolver(zone: ReadonlyMap<string, number> | undefined, vars: { indexOf(name: string): number }): (name: string) => number | null {
  const z = dictLookup(zone);
  return (name) => {
    const v = z(name);
    if (v !== undefined && v >= 0) return v;
    const i = vars.indexOf(name.toUpperCase());
    return i >= 0 ? i : null;
  };
}

/** what the runner needs of a `.man` spline (src/formats/anim.ts `parseMan`) */
export type ManLoader = (path: string) => Man | null;

export interface CutsceneEnv {
  world: World;
  /** legacy waypoint lookup (FUN_00462b4e on CSM then PATH): used when `wp` is not given (M3 zones) */
  waypoint(name: string): [number, number, number] | null;
  /** the message text of the script's table (for the subtitle and the minimum time) */
  text(id: string): string;
  /** FUN_00435a11: start the line's voice; false when the line has no voice (FUN_00439bf8 gave -1) */
  say(id: string): boolean;
  /** FUN_00435ad3 */
  speechIdle(): boolean;
  /** FUN_00435b07 */
  stopSpeech(): void;
  /** FUN_0040cd1a: set the projection's FOV (radians) */
  setFov(fov: number): void;
  /** the Shift key went down this tick (pressed edge of mask 0x40, DAT_00983840) */
  skipPressed(): boolean;
  /** options: var 9 (CS_SPEECH_ON) and var 0 (CS_TEXT_ON) */
  speechOn(): boolean;
  textOn(): boolean;
  /** letterbox bars (FUN_0045f750): 0 off, 1 top + bottom */
  letterbox(mode: 0 | 1 | 2): void;
  /** SETANIM: the clip number of an animation name (the zone's animation dictionary DAT_05d4d484); null / -1 = unknown (FUN_0043b6a3 then fails) */
  animClip?(actor: GameRecord, name: string): number | null;
  /** SETSWITCH: game variable index of a name (the zone's switch dictionary DAT_00987e20, then the SWITCH_GME_* table DAT_00987e1c); null = unknown */
  varIndex?(name: string): number | null;
  /** the current FOV (saved at the start, restored at the end: FUN_0040ccd8) */
  getFov?(): number;
  /** the zone's waypoint system (map slots 1 PATH, 2 CSM loaded; the actors' walkers live in it). Without it waypoints resolve through `waypoint()` and the walker
   *  commands of actors fall back to a straight walk (MOVEPOSITION) or nothing (FOLLOW) */
  wp?: WaypointSystem;
  /** `.man` loader (path as written in the script, e.g. `Z02LGI\MATANIM\PAGE1A.MAN`); null = missing (the command is then a no-op) */
  loadMan?: ManLoader;
  /** DAT_0089df30: the near plane (null = the zone's own value DAT_0089df50) */
  setNearPlane?(near: number | null): void;
  /** FUN_004388ae(n) / n: a random number in [0, 1) (the mouth frames of speaking actors) */
  random?(): number;
}

export interface CutsceneSlot { name: string; script: Cutscene }

/** command states: 0 pending, 1 running, 2 done (its signal id is released next), 3 finished */
const St = { Pending: 0, Running: 1, Done: 2, Finished: 3 } as const;
type St = (typeof St)[keyof typeof St];

/** a camera spline (FUN_004454e0 + FUN_00445340 type 0 + FUN_004466f0): uniform cubic B-spline through the translations of the `.man` records */
export class CameraSpline {
  /** +0x18: the points (x negated like FUN_0043ecd0) */
  readonly pts: Float64Array;
  /** +0x14: the point count (the progress step is 1 / count) */
  readonly count: number;
  constructor(man: Man) {
    // FUN_0043ecd0 reads tracks x declared records; the short files (one record fewer) repeat the last record (the read buffer keeps it)
    const n = man.declaredFrames * man.trackCount, d = man.tracks[0];
    this.count = n;
    this.pts = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      // records are frame-major over the tracks; the camera paths have one track
      const t = i % man.trackCount, f = Math.min(Math.floor(i / man.trackCount), man.frameCount - 1);
      const src = man.tracks[t] ?? d;
      this.pts[i * 3] = -src[f * 9 + 3]; this.pts[i * 3 + 1] = src[f * 9 + 4]; this.pts[i * 3 + 2] = src[f * 9 + 5];
    }
  }
  /** FUN_004466f0 (translation part): f = count * t, i = trunc(f) clamped, u = f - i, basis (-1 3 -3 1; 3 -6 3 0; -3 0 3 0; 1 4 1 0) / 6 */
  sample(t: number, out: number[] = [0, 0, 0]): number[] {
    const n = this.count, f = n * t;
    let i = Math.trunc(f);
    let a = i - 1, c = i + 1, d = i + 2;
    if (a < 0) a = 0;
    if (i >= n) i = n - 1;
    if (c >= n) c = n - 1;
    if (d >= n) d = n - 1;
    const u = f - i, u2 = u * u, u3 = u2 * u;
    const w0 = (-u3 + 3 * u2 - 3 * u + 1) / 6, w1 = (3 * u3 - 6 * u2 + 4) / 6, w2 = (-3 * u3 + 3 * u2 + 3 * u + 1) / 6, w3 = u3 / 6;
    const p = this.pts;
    for (let k = 0; k < 3; k++) out[k] = w0 * p[a * 3 + k] + w1 * p[i * 3 + k] + w2 * p[c * 3 + k] + w3 * p[d * 3 + k];
    return out;
  }
  /** the progress per tick (+0x3c = 1 / FUN_004456e0, a float) */
  get rate() { return Math.fround(1 / this.count); }
}

/** an actor's matrix track (FUN_0043ee40 / FUN_0043efa0): count - 1 records of 9 floats, linear between records, x negated, matrix FUN_0043a742 */
export class ActorSpline {
  readonly rec: Float32Array;
  /** *spline = declared count - 2 (the last record index used) */
  readonly count: number;
  constructor(man: Man) {
    this.count = man.declaredFrames - 2;
    this.rec = man.tracks[0].slice(0, Math.max(0, man.declaredFrames - 1) * 9);
  }
  get rate() { return Math.fround(1 / this.count); }
  /** FUN_0043efa0(spline, rec + 0xc, t): t clamped to 0..1, i = trunc(t * count), next = min(i + 1, count - 1) */
  apply(t: number, m: Float32Array) {
    const tt = t < 0 ? 0 : t > 1 ? 1 : t;
    const f = tt * this.count, i = Math.trunc(f);
    let j = i + 1;
    if (this.count - 1 <= j) j = this.count - 1;
    const u = f - i, r = this.rec, a = i * 9, b = j * 9;
    const v = (k: number) => (r[b + k] - r[a + k]) * u + r[a + k];
    m.set(buildMatrix(v(0), v(1), v(2), -v(3), v(4), v(5), v(6), v(7), v(8)));
  }
}

/** a behaviour node that can carry its record on another record's bone (the original's node with handler table 0x8adf50, constructor FUN_00429d1b) */
export interface CarryNode { setParent(parent: GameRecord | null, bone: number): void }
const isCarry = (n: unknown): n is CarryNode => typeof (n as CarryNode | null)?.setParent === 'function';

/** row-vector 4x4 product a * b (FUN_0043a9e5(out, b, a)) */
function mul4(a: ArrayLike<number>, b: ArrayLike<number>, out: Float32Array = new Float32Array(16)): Float32Array {
  const t = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) t[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  out.set(t);
  return out;
}

/**
 * The matrix part of the carry node's pre-render handler FUN_0042992a: bone < 1 copies the parent's matrix and puts the child at parent * offset; otherwise
 * child = (Ry(pi/2) at offset) * bone matrix (FUN_0043bc58) * parent matrix. Returns false when nothing was done (no parent).
 */
export function carryMatrix(child: GameRecord, parent: GameRecord | null, bone: number, offset: ArrayLike<number> = [0, 0, 0]): boolean {
  if (!parent) return false;
  child.show();
  if (bone < 1) {
    child.m.set(parent.m);
    const p = parent.toWorld(offset);
    child.m[12] = p[0]; child.m[13] = p[1]; child.m[14] = p[2];
    return true;
  }
  const pose = parent.anim?.pose();
  if (!pose || pose.length < (bone + 1) * 16) { child.m.set(parent.m); return true; }
  const local = buildMatrix(0, Math.PI / 2, 0, offset[0], offset[1], offset[2]);
  const boneM = pose.subarray(bone * 16, bone * 16 + 16);
  mul4(mul4(local, boneM), parent.m, child.m);
  return true;
}

/**
 * FUN_00422f21(rec, yaw, side, height, vec): the camera looks at rec + (0, height, 0) and sits at the side offset FUN_00422e36 gives, turned by `yaw`. Without the
 * 0x1000 flag (or before story node 8) a blocked view (sweep radius 2.4, mask 3) tries the other sides 1 5 2 3 4 and falls back to the asked side.
 */
export function actorCamera(w: World, rec: GameRecord, yaw: number, side: number, height: number, vec: readonly [number, number, number]) {
  const c = w.camera.c;
  c[3] = rec.x; c[5] = rec.z; c[4] = rec.y + height;
  const rot = buildMatrix(0, yaw, 0, 0, 0, 0);
  const offset = (s: number) => {
    const v = sideVector(s & 0xff, vec);
    return [v[0] * rot[0] + v[1] * rot[4] + v[2] * rot[8], v[0] * rot[1] + v[1] * rot[5] + v[2] * rot[9], v[0] * rot[2] + v[1] * rot[6] + v[2] * rot[10]];
  };
  const put = (o: number[]) => { c[0] = c[3] + o[0]; c[1] = c[4] + o[1]; c[2] = c[5] + o[2]; };
  let o = offset(side);
  if ((side & SIDE_NOCOLLIDE) === 0 || w.vars.get(0x58) < 8) {
    const look = [c[3], c[4], c[5]];
    if (!w.col.sweep(rec, look, o, 3, SIDE_SWEEP_RADIUS, 0)) { put(o); return; }
    for (const s of SIDE_RETRY) {
      if (s === (side & 0xff)) continue;
      const o2 = offset(s);
      if (!w.col.sweep(rec, look, o2, 3, SIDE_SWEEP_RADIUS, 0)) { put(o2); return; }
    }
    o = offset(side);
  }
  put(o);
}

/** FUN_00422e36(side, out, vec): the camera offset of a side word in the actor's frame */
export function sideVector(side: number, v: readonly [number, number, number]): [number, number, number] {
  switch (side) {
    case 0: return [0, 0, -1.75];
    case 2: return [v[0], v[1], v[2]];
    case 3: return [-v[2], v[1], v[0]];
    case 4: return [v[2], v[1], v[0]];
    case 5: return [v[0], v[1], -v[2]];
    default: return [-v[0], v[1], -v[2]];
  }
}

interface Cmd {
  c: CutCommand;
  /** +4 */
  state: St;
  /** +0x0c: seconds left of the start delay */
  delay: number;
  /** +0x10: seconds left of the command's own timer (duration / speech) */
  timer: number;
  /** +0x14: the actor record (null = global handler) */
  actor: GameRecord | null;
  /** the loader stopped before this command (unknown actor) or it lies beyond the records: it never starts */
  dead: boolean;
  /** +0x18 */
  started: boolean;
  /** waypoint: index (+0x28 for 3 / 5, +0x38 for 4 / 6) and the position the loader cached (+0x2c / +0x28); map the index came from */
  wpIndex: number;
  wpMap: number;
  wpPos: [number, number, number] | null;
  /** actor target (+0x28 for 3 / 5, +0x34 for 4 / 6, +0x24 for 7 / 14) */
  target: GameRecord | null;
  /** kind 2: the spline (+0x38) and its progress (+0x40) */
  camSpline: CameraSpline | null;
  actSpline: ActorSpline | null;
  t: number;
  /** per command scratch */
  x: Record<string, unknown>;
}

/** an entry of the registered actors (DAT_05d47b20, 0x28 bytes) */
interface ActorEntry {
  rec: GameRecord;
  /** +0x10: the walker's lane at registration (FLT_MAX without walker) */
  lane: number;
  /** +0x14: a SETANIM ran on it */
  animSet: boolean;
  /** +0x18: the face frame at registration (FUN_0043f310) */
  face: number;
  /** +0x1c: 2 while a spline drives it (no ground snap), 1 for one more frame after the spline ended */
  spline: number;
  /** +0x20 / +0x24: the walker's ignore flags saved by the skip loop */
  ignore: [number, number];
}

/** the camera's eased move (FUN_0045edae / 0045eff9 / 0045f1bc / 0045f2f4): ease-in to `maxStep` per tick, ease-out in the last stretch */
export class EasedMove {
  private to: [number, number, number];
  private v: [number, number, number] = [0, 0, 0];
  private unit: [number, number, number] = [0, 0, 0];
  private remaining: number;
  private travelled = 0;
  private phase = 0;
  private easeStep: number;
  private lastRemaining = 0;
  constructor(from: ArrayLike<number>, to: ArrayLike<number>, maxStep: number, easeStep: number) {
    this.to = [to[0], to[1], to[2]];
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const l = Math.hypot(d[0], d[1], d[2]);
    this.unit = l ? [(d[0] / l) * maxStep, (d[1] / l) * maxStep, (d[2] / l) * maxStep] : [0, 0, 0];
    this.remaining = l;
    this.easeStep = easeStep;
  }
  get target(): readonly [number, number, number] { return this.to; }
  /** one tick; moves `p` (the camera eye or look-at); true when it has arrived */
  step(p: number[]): boolean {
    if (this.travelled < this.remaining) {
      // FUN_0045eff9: accelerate until the phase reaches 1, then cruise
      if (this.phase < 1) {
        this.phase += this.easeStep;
        this.v = [this.unit[0] * this.phase, this.unit[1] * this.phase, this.unit[2] * this.phase];
        this.travelled += Math.hypot(this.v[0], this.v[1], this.v[2]);
      }
      p[0] += this.v[0]; p[1] += this.v[1]; p[2] += this.v[2];
      this.remaining = Math.hypot(p[0] - this.to[0], p[1] - this.to[1], p[2] - this.to[2]);
      return false;
    }
    if (0.01 < this.remaining) {
      // FUN_0045f1bc: slow down by easeStep per tick (not below one step), keep moving
      if (0 < this.phase) this.phase = this.easeStep <= this.phase - this.easeStep ? this.phase - this.easeStep : this.easeStep;
      this.v = [this.unit[0] * this.phase, this.unit[1] * this.phase, this.unit[2] * this.phase];
      p[0] += this.v[0]; p[1] += this.v[1]; p[2] += this.v[2];
      this.remaining = Math.hypot(p[0] - this.to[0], p[1] - this.to[1], p[2] - this.to[2]);
      if (this.remaining !== this.lastRemaining) { this.lastRemaining = this.remaining; return this.arrived(p); }
      this.lastRemaining = 0;
    }
    this.remaining = 0;
    return this.arrived(p, true);
  }
  private arrived(p: number[], force = false): boolean {
    const speed = Math.hypot(this.v[0], this.v[1], this.v[2]);
    if (force || this.remaining <= speed) { this.remaining = 0; p[0] = this.to[0]; p[1] = this.to[1]; p[2] = this.to[2]; return true; }
    return false;
  }
}

/** map slots of the waypoint system (src/game/walker.ts MAP_PATH / MAP_CSM) */
const MAP_PATH = 1, MAP_CSM = 2;
/** FUN_004626d0 return codes (walker.ts STEP_ARRIVED / STEP_FACING) */
const STEP_ARRIVED = -1, STEP_FACING = -3;

export class CutsceneRunner {
  readonly env: CutsceneEnv;
  private slots: (CutsceneSlot | null)[] = [];
  private cmds: Cmd[] = [];
  /** DAT_05d47910: 0x201 wait counters (0xff = nobody signals the id) */
  private counters = new Uint8Array(0x201);
  /** DAT_05d4790a: the slot of the script that runs (or ran last) */
  private current = -1;
  get currentSlot() { return this.current; }
  /** DAT_05d4790b: the one-deep queue (-1 = empty) */
  private queued = -1;
  /** DAT_05d47b18 != 0: a script is selected (also after starting an empty script, which then never runs and blocks the manager: see `start`) */
  private selected = false;
  /** DAT_05d47908: the scheduler runs */
  private running = false;
  /** DAT_05d4dc8c: a zone / dialog holds the "cutscene active" state on (FUN_0045c456) */
  override = false;
  /** DAT_05d482a0: the camera block (18 floats) saved at the start (the original never restores it) */
  savedCamera: Float64Array | null = null;
  /** DAT_05d482f0: the FOV saved at the start */
  private savedFov = 1;
  /** DAT_05d482f8 / fc / 300 / 304: camera ease constants (SETMOVESPEED / SETTARGETSPEED) */
  moveSpeed = { ease: CAM_EASE, max: CAM_MAX };
  targetSpeed = { ease: CAM_EASE, max: CAM_MAX };
  /** DAT_05d47b20.. / DAT_05d47b1c: the registered actors (FUN_00458fa6) */
  private actors: ActorEntry[] = [];
  /** the subtitle of the SAYTEXT that is running (4 lines are drawn by the HUD in the original) */
  subtitle: { id: string; text: string } | null = null;
  /** DAT_05d482f4: the record the camera's look-at follows (camera FOLLOW) */
  private camFollow: GameRecord | null = null;
  /** DAT_05d4dc90: the voice of a SAYTEXT has been started */
  private voiceStarted = false;
  /** ATTACH without a carry node: the logical attachments (child -> parent, bone); kept after the script like the original's node state */
  readonly carried = new Map<GameRecord, { parent: GameRecord; bone: number }>();
  /** diagnostics for tests */
  log: string[] = [];
  ticks = 0;

  constructor(env: CutsceneEnv) { this.env = env; }

  /** FUN_0045c310(n) -> FUN_00458a4c: n empty slots, nothing selected or queued */
  allocate(n: number) {
    this.slots = new Array(n).fill(null);
    this.selected = false; this.running = false; this.queued = -1; this.current = 0; this.actors = [];
  }
  /** FUN_0045c397(slot, script, messages): the zone loads the compiled script (`parseCutscene`) and gives the runner the table lookup through the env */
  define(slot: number, name: string, script: Cutscene) { this.slots[slot] = { name, script }; }
  get slotCount() { return this.slots.length; }

  /** FUN_0045c432: a script is running (or a zone holds the flag) */
  active(): boolean { return this.override || this.running; }

  /**
   * FUN_0045c40c / FUN_00458d15: start a script; ignored while the game was started from the menu (var 0xb). While a script is selected the slot is queued
   * (one deep, the first request wins). A script without commands selects the slot but never runs: the manager then queues every later start until the next
   * `allocate` (the original's behaviour: the command array of an empty script is a null pointer and the "selected" pointer is never cleared).
   */
  start(slot: number): boolean {
    const w = this.env.world;
    if (w.vars.get(0xb) !== 0) return false;
    if (slot < 0 || slot >= this.slots.length) return false;
    if (this.selected) { if (this.queued < 0) this.queued = slot; return false; }
    return this.begin(slot, false);
  }

  /**
   * FUN_00458d15. An empty script started directly selects the slot without running (the manager is then blocked, see `start`); started from the queue the
   * scheduler runs (FUN_00459119 returned 1) and ends it in the next frame with the usual clean-up.
   */
  private begin(slot: number, queued: boolean): boolean {
    const env = this.env, w = env.world;
    this.current = slot;
    this.selected = true;
    const sc = this.slots[slot];
    if (!sc || sc.script.commands.length === 0) {
      this.log.push(`start ${sc?.name ?? slot}: empty${queued ? '' : ' (manager blocked)'}`);
      this.cmds = [];
      return queued;
    }
    this.savedCamera = Float64Array.from(w.camera.c);
    this.savedFov = env.getFov?.() ?? 1;
    env.setNearPlane?.(NEAR_START);
    this.moveSpeed = { ease: CAM_EASE, max: CAM_MAX };
    this.targetSpeed = { ease: CAM_EASE, max: CAM_MAX };
    this.cmds = this.load(sc);
    this.counterInit();
    this.actors = [];
    this.camFollow = null;
    this.subtitle = null;
    env.letterbox(1);
    this.running = true;
    w.vars.or(V.PEPPER_CONTROL, 0x100);
    this.log.push(`start ${sc.name}`);
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------- loading (FUN_0045d68a, done per start here)
  private find(name: string | undefined): GameRecord | null {
    if (!name) return null;
    const n = name.slice(0, 4);
    return this.env.world.records.find((r) => r.name.slice(0, 4) === n) ?? null;          // FUN_0045d5c0: the first record whose name matches 4 chars
  }

  private findNode(map: number, name: string): number {
    const sys = this.env.wp;
    return sys ? sys.findNode(map, name.toUpperCase()) : -1;
  }

  private load(sc: CutsceneSlot): Cmd[] {
    const env = this.env;
    let stopped = false;
    return sc.script.commands.map((c) => {
      const actor = this.find(c.actor);
      const global = !actor && (c.actor === 'CMRA' || c.actor === 'SWCH' || c.actor === 'PLAY');
      if (!actor && !global && !stopped) { stopped = true; this.log.push(`${sc.name}: unknown actor ${c.actor}: the loader stops, the rest never runs`); }
      const m: Cmd = {
        c, state: St.Pending, delay: c.delay, timer: c.duration, actor, dead: stopped, started: false,
        wpIndex: -1, wpMap: MAP_PATH, wpPos: null, target: null, camSpline: null, actSpline: null, t: 0, x: {},
      };
      if (stopped) return m;
      const isActor = m.actor !== null;
      switch (c.cmd) {
        case 3: case 5:
          if (c.targetKind === 'waypoint') this.resolveWaypoint(m, c.target ?? '', true);
          else if (c.targetKind === 'actor') m.target = this.find(c.target);
          break;
        case 4: case 6:
          if (c.targetKind === 'waypoint') this.resolveWaypoint(m, c.target ?? '', !isActor);
          else if (c.targetKind === 'actor') m.target = this.find(c.target);
          else if (c.targetKind === 'spline') {
            const man = env.loadMan?.(c.target ?? '') ?? null;
            if (!man) this.log.push(`${sc.name}: spline ${c.target} missing`);
            else if (isActor) m.actSpline = man.trackCount === 1 && man.declaredFrames > 2 ? new ActorSpline(man) : null;       // FUN_0043ee40 wants 1 track
            else m.camSpline = new CameraSpline(man);
          }
          break;
        case 7: case 14: m.target = this.find(c.other); break;
      }
      return m;
    });
  }

  /** FUN_00462b4e(name, 2) then (name, 1) (or only PATH for an actor's MOVEPOSITION), FUN_00462be9 for the cached position */
  private resolveWaypoint(m: Cmd, name: string, csmFirst: boolean) {
    const sys = this.env.wp;
    if (!sys) { m.wpPos = this.env.waypoint(name); return; }
    let map = MAP_CSM, i = csmFirst ? this.findNode(MAP_CSM, name) : -1;
    if (i < 0) { map = MAP_PATH; i = this.findNode(MAP_PATH, name); }
    m.wpIndex = i; m.wpMap = map;
    if (i >= 0) { const p = sys.nodePos(map, i); m.wpPos = [p[0], p[1], p[2]]; }
    else this.log.push(`waypoint ${name} unresolved`);
  }

  /** FUN_00458c15: how many commands signal each id (0xff = nobody) */
  private counterInit() {
    this.counters.fill(0xff); this.counters[0] = 0;
    for (const m of this.cmds) {
      if (m.dead) continue;
      const s = m.c.signalId;
      if (s !== 0) { if (this.counters[s] === 0xff) this.counters[s] = 0; this.counters[s]++; }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------- the frame
  /** FUN_0045c402 / FUN_00458f50: one tick */
  tick() {
    if (!this.running) return;
    this.ticks++;
    this.env.setNearPlane?.(NEAR_RUNNING);
    this.running = this.schedule();
    this.actorFrame();
    this.applyCarried();
    this.env.world.camera.updateView();
  }

  /** FUN_00459119: the three passes and, in the frame no command ran, the end; true while the manager keeps running */
  private schedule(): boolean {
    let ran = false;
    for (const m of this.cmds) {
      if (m.state === St.Pending && !m.dead && this.counters[m.c.waitId] === 0) {
        m.state = St.Running;
        if (m.actor) this.register(m.actor);
      }
    }
    for (const m of this.cmds) {
      if (m.state !== St.Running) continue;
      if (!m.actor && m.c.cmd === 7) {             // the camera FOLLOW runs on, does not keep the script alive
        const r = this.run(m);
        if (r !== 1) m.state = r as St;
      } else {
        ran = true;
        m.state = this.run(m) as St;
      }
    }
    for (const m of this.cmds) {
      if (m.state === St.Done) { if (m.c.signalId !== 0) this.counters[m.c.signalId]--; m.state = St.Finished; }   // FUN_00459618
    }
    if (ran) return true;
    return this.end();
  }

  /** FUN_00458fa6: an actor takes part: its AI is switched off, its walker paused (lane saved), its face frame saved */
  private register(a: GameRecord) {
    if (this.actors.some((e) => e.rec === a)) return;
    if (this.actors.length >= MAX_ACTORS) return;
    const e: ActorEntry = { rec: a, lane: NO_LANE, animSet: false, face: a.face, spline: 0, ignore: [0, 0] };
    this.actors.push(e);
    const ctrl = a.ctrl, sys = this.env.wp;
    if (ctrl) {
      ctrl.flags &= ~2;
      if (ctrl.walker && sys?.get(ctrl.walker)) {
        sys.pause(ctrl.walker);                                    // FUN_00461e69
        e.lane = sys.get(ctrl.walker)!.lane;                       // FUN_00461ab1
      }
    }
  }
  private entry(a: GameRecord) { return this.actors.find((e) => e.rec === a) ?? null; }

  /** FUN_00459740: the registered actors' animations advance, the ones with an active controller are put on the ground unless a spline drives them */
  private actorFrame() {
    for (const e of this.actors) {
      const a = e.rec;
      a.anim?.advance(1);
      if (a.ctrl && (a.ctrl.flags & 0x80) === 0) {
        if (e.spline === 0) this.groundSnap(a);
        else if (e.spline === 1) e.spline = 0;
      }
    }
  }

  /** FUN_0045965d: probe down from 4 above the actor to the terrain (or 160 deep) against the other records; the actor stands on what it hits, else on the terrain */
  private groundSnap(a: GameRecord) {
    const col = this.env.world.col;
    const from = [a.x, a.y + SNAP_UP, a.z];
    const h = col.terrainHeight(from[0], from[1], from[2], SNAP_UP);
    const found = h > SNAP_NO_GROUND;
    const dy = found ? h - from[1] : SNAP_DEPTH;
    const hit = col.probe(a, from, [0, dy, 0], 3);
    if (!hit) { if (found) a.y = h; }
    else a.y = hit.point[1];
  }

  /** FUN_00459597: the delay, then the command's handler; 1 = running, 2 = done */
  private run(m: Cmd): number {
    if (this.skip()) m.delay = 0;
    if (m.delay > 0) { m.delay = Math.fround(m.delay - this.secStep()); return 1; }
    return m.actor ? this.runActor(m, m.actor) : this.runGlobal(m);
  }

  private dt() { return this.env.world.dt; }
  /** the timers (+0xc delay, +0x10 duration) are floats counted down by 0.03333 * dt per frame */
  private secStep() { return Math.fround(Math.fround(SEC_PER_TICK) * this.dt()); }
  private skip() { return this.env.skipPressed(); }
  /** the common tail: the command's timer runs down (seconds), done when it is <= 0 */
  private holdDone(m: Cmd): number {
    m.timer = Math.fround(m.timer - this.secStep());
    return m.timer > 0 ? 1 : 2;
  }

  // ---------------------------------------------------------------------------------------------------------------- actor commands (FUN_0045c49d)
  private runActor(m: Cmd, a: GameRecord): number {
    const c = m.c;
    switch (c.cmd) {
      case 0: { if (c.flag) a.show(); else a.hide(); return 2; }    // FUN_0045c595
      case 1: return this.setAnim(m, a);                            // FUN_0045ce77
      case 2: return this.sayText(m, a);                            // FUN_0045cf83
      case 3: return this.turnTo(m, a);                             // FUN_0045cd23
      case 5: return this.teleport(m, a);                           // FUN_0045c5e2
      case 6: return this.moveActor(m, a);                          // FUN_0045c66b
      case 7: return this.followActor(m, a);                        // FUN_0045cb50
      case 13: { a.face = c.expression ?? 0; return 2; }           // FUN_0045d294 -> FUN_0043f2f0
      case 14: return this.attach(m, a);                            // FUN_0045d2b9
      case 15: { if (a.ctrl) { if (c.flag) a.ctrl.flags |= 2; else a.ctrl.flags &= ~2; } return 2; }   // FUN_0045d301
      default: return 2;
    }
  }

  /** FUN_0045ce77: start the clip once (FUN_0043b6a3), then wait until FUN_0043b92a says it ended (or Shift), then the extra duration */
  private setAnim(m: Cmd, a: GameRecord): number {
    if (!m.started) {
      const clip = this.env.animClip?.(a, m.c.anim ?? '') ?? -1;
      if (a.anim && clip !== null && clip >= 0) a.anim.start(clip, 0);
      else if (!a.anim) this.log.push(`SETANIM ${a.name} ${m.c.anim}: no animation instance`);
      m.x.ended = false;
      const e = this.entry(a);
      if (e) e.animSet = true;
      m.started = true;
    }
    let ended = this.clipEnded(a);
    if (this.skip()) { ended = true; m.timer = 0; }
    if (ended) m.x.ended = true;
    if (!m.x.ended) return 1;
    return this.holdDone(m);
  }

  /** FUN_0043b92a(anim, 2.0): frameCount < frame + 2 * dt + 1 (a record without animation instance counts as ended: the original always has one) */
  private clipEnded(a: GameRecord): boolean {
    const an = a.anim;
    if (!an || !an.clipData) return true;
    return an.frameCount < an.frame + CLIP_END_MARGIN * this.dt() + 1;
  }

  /** FUN_0045cd23: instant yaw towards the target point; an actor target that is missing ends the command */
  private turnTo(m: Cmd, a: GameRecord): number {
    let p: ArrayLike<number>;
    if (m.c.targetKind === 'actor') { if (!m.target) return 2; p = [m.target.x, m.target.y, m.target.z]; }
    else p = m.wpPos ?? [0, 0, 0];
    a.ry = -Math.atan2(-(p[0] - a.x), p[2] - a.z);
    a.setEuler(a.rx, a.ry, a.rz, a.x, a.y, a.z);
    return 2;
  }

  /** FUN_0045c5e2: the PATH node of the resolved index (whatever map the index came from), then the walker is re-pinned there (FUN_004625d7) */
  private teleport(m: Cmd, a: GameRecord): number {
    const sys = this.env.wp;
    let p: ArrayLike<number> | null;
    if (!sys) p = m.c.targetKind === 'waypoint' ? m.wpPos : null;     // M3 zones: the cached position
    else p = m.wpIndex >= 0 && sys.node(MAP_PATH, m.wpIndex) ? sys.nodePos(MAP_PATH, m.wpIndex) : null;
    if (!p) { this.log.push(`SETPOSITION ${a.name} ${m.c.target}: no PATH node ${m.wpIndex}`); return 2; }
    a.setEuler(a.rx, a.ry, a.rz, p[0], p[1], p[2]);
    const h = this.walkerOf(a);
    if (h && sys) sys.teleport(h, m.wpIndex);
    return 2;
  }

  /** FUN_0045c470: the actor's walker (ctrl + 0x10); DAT_05d4dc94 (the fallback) is never set: 0 */
  private walkerOf(a: GameRecord): number {
    const sys = this.env.wp, h = a.ctrl?.walker ?? 0;
    return sys && h && sys.get(h) ? h : 0;
  }

  /** FUN_0045c66b: start the walk (waypoint: walker order + tuning; spline: progress 0, ground snap off), then FUN_0045c80d until arrival, then the duration */
  private moveActor(m: Cmd, a: GameRecord): number {
    const c = m.c, sys = this.env.wp;
    if (!sys) return this.moveStraight(m, a);
    if (!m.started) {
      if (c.targetKind === 'waypoint') {
        const h = this.walkerOf(a);
        m.x.walker = h;
        if (!h) { this.log.push(`MOVEPOSITION ${a.name} ${c.target}: no walker (no-op)`); return 2; }
        sys.goTo(h, m.wpIndex, 0);                                  // FUN_00461c24
        sys.setSpeed(h, CSM_WALK.speed);                            // FUN_00462206
        sys.setLane(h, 0);                                          // FUN_00461ad6
        sys.setTurnRate(h, CSM_WALK.turn);                          // FUN_00462324
        sys.setRadiusMin(h, CSM_WALK.radiusMin);                    // FUN_004623aa
        sys.setRadiusMax(h, CSM_WALK.radiusMax);                    // FUN_004623cd
        sys.setRadiusLimit(h, CSM_WALK.radiusLimit);                // FUN_00462436
        sys.apply(h, a);                                            // FUN_00461fe4
        sys.resume(h);                                              // FUN_00461f42
      } else if (c.targetKind === 'spline') {
        m.x.walker = 0;
        m.t = 0;
        const e = this.entry(a);
        if (e) e.spline = 2;
      }
      m.started = true;
    }
    return this.moveStep(m, a) ? this.holdDone(m) : 1;
  }

  /** FUN_0045c80d: one step of the walk / spline; true when arrived (the skip key finishes it at once) */
  private moveStep(m: Cmd, a: GameRecord): boolean {
    const c = m.c, sys = this.env.wp!;
    const h = (m.x.walker as number) ?? 0;
    const out: StepOut = { yaw: 0, dist: 0 };
    if (!this.skip()) {
      if (c.targetKind === 'waypoint') {
        const pos = [a.x, a.y, a.z];
        const code = sys.step(h, pos, a.ry, out, this.dt());
        a.ry = out.yaw;
        a.setEuler(a.rx, a.ry, a.rz, pos[0], a.y, pos[2]);
        return code === STEP_ARRIVED;
      }
      if (c.targetKind === 'spline') {
        const s = m.actSpline;
        if (!s) return true;
        s.apply(m.t, a.m);
        m.t = Math.fround(m.t + s.rate * this.dt());              // +0x40 is a float
        const done = 1 <= m.t;
        if (done) { const e = this.entry(a); if (e) e.spline = 1; }
        return done;
      }
      return false;                                                 // (an actor target: nothing moves, never arrives; no script uses it)
    }
    // the skip key: walk it out (at most 0x5dd steps, the walker ignoring others), else put it on the node
    if (c.targetKind === 'waypoint') {
      const e = this.entry(a);
      const pos = [a.x, a.y, a.z];
      let yaw = a.ry, arrived = false;
      for (let i = 0; i < SKIP_WALK_STEPS; i++) {
        const code = sys.step(h, pos, yaw, out, this.dt());
        if (code === STEP_ARRIVED) { arrived = true; break; }
        if (e) e.ignore = [1, 1];                                   // FUN_004618a5: the original's test is always true
        sys.setIgnore(h, 1, 1);                                     // FUN_0046190f
        yaw = out.yaw;
        a.x = pos[0]; a.z = pos[2]; a.ry = yaw;
      }
      if (!arrived) {
        const p = sys.nodePos(MAP_PATH, m.wpIndex);
        pos[0] = p[0]; pos[1] = p[1]; pos[2] = p[2];
        a.x = p[0]; a.y = p[1]; a.z = p[2];
        sys.teleport(h, m.wpIndex);                                 // FUN_004625d7
      }
      if (e) sys.setIgnore(h, e.ignore[0], e.ignore[1]);
      a.setEuler(a.rx, a.ry, a.rz, pos[0], arrived ? a.y : pos[1], pos[2]);
    } else if (c.targetKind === 'spline' && m.actSpline) m.actSpline.apply(1, a.m);
    m.timer = 0;
    return true;
  }

  /** M3 zones without a waypoint system: a straight walk to the cached waypoint at ACTOR_SPEED (approximation) */
  private moveStraight(m: Cmd, a: GameRecord): number {
    const p = m.c.targetKind === 'waypoint' ? m.wpPos : null;
    if (!p) return 2;
    if (this.skip()) a.setEuler(a.rx, a.ry, a.rz, p[0], p[1], p[2]);
    const dx = p[0] - a.x, dy = p[1] - a.y, dz = p[2] - a.z, d = Math.hypot(dx, dy, dz);
    if (d > ACTOR_SPEED * this.dt()) {
      const k = (ACTOR_SPEED * this.dt()) / d;
      a.ry = -Math.atan2(-dx, dz);
      a.setEuler(a.rx, a.ry, a.rz, a.x + dx * k, a.y + dy * k, a.z + dz * k);
      return 1;
    }
    a.setEuler(a.rx, a.ry, a.rz, p[0], p[1], p[2]);
    return this.holdDone(m);
  }

  /** FUN_0045cb50: the actor's walker turns to face the other record (FUN_00462729, step until -3); Shift: one step at turn rate pi */
  private followActor(m: Cmd, a: GameRecord): number {
    const sys = this.env.wp;
    if (!m.started) {
      const h = this.walkerOf(a);
      m.x.walker = h;
      if (!h || !sys) { this.log.push(`FOLLOW ${a.name} ${m.c.other}: no walker (no-op)`); return 2; }
      if (!m.target) { sys.followRecord(h, null); return 2; }
      sys.followRecord(h, m.target);
      m.started = true;
    }
    const h = m.x.walker as number, out: StepOut = { yaw: 0, dist: 0 };
    const pos = [a.x, a.y, a.z];
    if (!this.skip()) {
      const code = sys!.step(h, pos, a.ry, out, this.dt());
      a.ry = out.yaw;
      a.setEuler(a.rx, a.ry, a.rz, a.x, a.y, a.z);
      return code === STEP_FACING ? 2 : 1;
    }
    // (sic) the original hands the saved turn rate's variable to the step as the yaw, so the step's new yaw becomes the turn rate it restores; the record's
    // yaw is not changed (its matrix is rebuilt from its own fields)
    const turn = sys!.get(h)!.turnRate;                             // FUN_0046235a
    sys!.setTurnRate(h, SKIP_FOLLOW_TURN);                          // FUN_00462324
    sys!.step(h, pos, turn, out, this.dt());
    sys!.setTurnRate(h, out.yaw);
    a.setEuler(a.rx, a.ry, a.rz, a.x, a.y, a.z);
    m.timer = 0;
    return 2;
  }

  /** FUN_0045d2b9: FUN_00429638 hands the parent and bone to the actor's carry node, then its AI is switched on (so the node runs during the script) */
  private attach(m: Cmd, a: GameRecord): number {
    const parent = m.target, bone = m.c.bone ?? 0;
    const node = a.ctrl?.nodes.find((n) => isCarry(n)) as CarryNode | undefined;
    if (node) node.setParent(parent, bone);
    else if (parent) this.carried.set(a, { parent, bone });
    else this.carried.delete(a);
    if (a.ctrl) a.ctrl.flags |= 2;
    return 2;
  }

  /** the logical attachments (ATTACH on a record without a carry node): the child follows the parent's bone; call every frame (the original's pre-render pass) */
  applyCarried() {
    for (const [child, { parent, bone }] of this.carried) carryMatrix(child, parent, bone);
  }

  // ---------------------------------------------------------------------------------------------------------------- SAYTEXT (FUN_0045cf83)
  /**
   * The line is spoken (CS_SPEECH_ON) and shown (CS_TEXT_ON); the command lasts until the voice has finished AND (strlen + 20 + duration) / 20 seconds are over.
   * While the actor talks its face shows random mouth frames (0..9, held 2..6 ticks for 0..5, 1..5 ticks otherwise); afterwards the frame it had. Shift stops the
   * voice and ends the line. `m.x.done` = +0x30, `m.x.mouth` = +0x36, `m.x.mouthT` = +0x38, `m.x.face` = +0x34; DAT_05d4dc90 = `voiceStarted`.
   */
  private sayText(m: Cmd, a: GameRecord): number {
    const env = this.env, c = m.c, id = c.textId ?? '';
    const rnd = env.random ?? Math.random;
    if (!m.started) {
      const t = env.text(id);
      m.timer = Math.fround(Math.fround(t.length + 20 + m.timer) / 20);
      this.subtitle = env.textOn() ? { id, text: t } : null;
      m.x.face = a.face;
      m.x.done = false;
      m.x.mouth = a.face;
      m.x.mouthT = 0;
      m.started = true;
    }
    if (!env.speechOn()) m.x.done = false;
    if (!m.x.done) {
      let talk = 1;
      if (!env.speechOn()) talk = 1;
      else if (env.speechIdle()) {
        if (!this.voiceStarted) { env.say(id); this.voiceStarted = true; }
        else talk = -1;
      }
      if (talk === 1) {
        if ((m.x.mouthT as number) <= 0) {
          const f = Math.trunc(rnd() * 10);
          m.x.mouth = f;
          m.x.mouthT = f < 6 ? 2 + rnd() * 4 : rnd() * 4 + 1;
        }
      } else { m.x.done = true; m.x.mouth = m.x.face; }
      m.x.mouthT = (m.x.mouthT as number) - 1 * this.dt();
      a.face = m.x.mouth as number;
    } else this.voiceStarted = false;
    if (this.skip()) { env.stopSpeech(); m.x.done = true; m.timer = 0; this.voiceStarted = false; }
    if (!env.speechOn()) m.x.done = true;
    m.timer = Math.fround(m.timer - this.secStep());
    if (!m.x.done) return 1;
    this.voiceStarted = false;
    if (m.timer > 0) return 1;
    this.subtitle = null;
    return 2;
  }

  // ---------------------------------------------------------------------------------------------------------------- global / camera commands (FUN_0045eaf0)
  private runGlobal(m: Cmd): number {
    const c = m.c, w = this.env.world;
    switch (c.cmd) {
      case 3: return this.camSetTarget(m);                           // FUN_0045ec4f
      case 4: return this.camMove(m, true);                          // FUN_0045eeaa
      case 5: return this.camSetPosition(m);                         // FUN_0045ebc8
      case 6: return this.camMove(m, false);                         // FUN_0045ecec
      case 7: {                                                      // FUN_0045f543: the look-at follows the actor (+3.37) until another command resets it
        if (!m.started) { this.camFollow = m.target; m.started = true; }
        const t = this.camFollow;
        if (!t) return 2;
        const cam = w.camera.c;
        cam[3] = t.x; cam[5] = t.z; cam[4] = t.y + ACTOR_LOOK_HEIGHT;
        return 1;
      }
      case 8: {                                                      // FUN_0045f670: SETSWITCH (index resolved at load)
        if (!m.started) {
          const name = c.switchName ?? '';
          const idx = this.env.varIndex ? this.env.varIndex(name) : w.vars.indexOf(name);
          if (idx !== null && idx >= 0) w.vars.set(idx, c.switchValue ?? 0);
          else this.log.push(`switch ${name}: unknown`);
          m.started = true;
        }
        if (this.skip()) m.timer = 0;
        return this.holdDone(m);
      }
      case 9: return 2;                                              // WAV / MIDI: a stub
      case 10: { this.moveSpeed = { ease: (c.speedB ?? 0) * 0.02, max: (c.speedA ?? 0) * 0.1 }; return 2; }   // FUN_0045f5b8: +0x26 (b) * 0.02, +0x24 (a) * 0.1
      case 11: { this.targetSpeed = { ease: (c.speedB ?? 0) * 0.02, max: (c.speedA ?? 0) * 0.1 }; return 2; }
      case 12: { this.env.setFov(c.fov ?? 1); return 2; }           // FUN_0045f64b
      default: return 2;
    }
  }

  /** FUN_0045ec4f: the look-at once (an actor: + 3.37); stops a camera FOLLOW */
  private camSetTarget(m: Cmd): number {
    const cam = this.env.world.camera.c;
    if (m.c.targetKind === 'actor') {
      const t = m.target;
      if (!t) { this.log.push(`camera SETTARGET ${m.c.target}: no record`); this.camFollow = null; return 2; }
      cam[3] = t.x; cam[5] = t.z; cam[4] = t.y + ACTOR_LOOK_HEIGHT;
    } else {
      const p = m.wpPos ?? [0, 0, 0];
      cam[3] = p[0]; cam[4] = p[1]; cam[5] = p[2];
    }
    this.camFollow = null;
    return 2;
  }

  /** FUN_0045ebc8: the eye at a waypoint, or beside an actor (FUN_00422f21 with the side word | 0x1000, height 3.37, vector (4, 2, -10)) */
  private camSetPosition(m: Cmd): number {
    const w = this.env.world, cam = w.camera.c;
    if (m.c.targetKind === 'waypoint') {
      const p = m.wpPos ?? [0, 0, 0];
      cam[0] = p[0]; cam[1] = p[1]; cam[2] = p[2];
    } else if (m.c.targetKind === 'actor') {
      const t = m.target;
      if (!t) { this.log.push(`camera SETPOSITION ${m.c.target}: no record`); return 2; }
      actorCamera(w, t, t.ry, (m.c.side ?? 0) | SIDE_NOCOLLIDE, ACTOR_LOOK_HEIGHT, SIDE_VEC_CSM);
    }
    return 2;
  }

  /**
   * FUN_0045eeaa (look-at, `look` = true) / FUN_0045ecec (eye): kind 0 / 1 = the eased move (FUN_0045edae, look-at speeds or eye speeds; an actor target = its
   * position + 3.37 at the start; MOVETARGET of an unresolved waypoint ends at once), kind 2 = the B-spline (progress 1 / count per tick); then the duration.
   * MOVETARGET stops a camera FOLLOW.
   */
  private camMove(m: Cmd, look: boolean): number {
    const c = m.c, cam = this.env.world.camera.c, o = look ? 3 : 0;
    if (!m.started) {
      if (c.targetKind === 'waypoint') {
        if (look && !m.wpPos) return 2;
        const p = m.wpPos ?? [0, 0, 0];
        const sp = look ? this.targetSpeed : this.moveSpeed;
        m.x.move = new EasedMove([cam[o], cam[o + 1], cam[o + 2]], p, sp.max, sp.ease);
      } else if (c.targetKind === 'actor') {
        if (look) {
          if (!m.target) return 2;
          const t = m.target, sp = this.targetSpeed;
          m.x.move = new EasedMove([cam[3], cam[4], cam[5]], [t.x, t.y + ACTOR_LOOK_HEIGHT, t.z], sp.max, sp.ease);
        } else this.log.push('camera MOVEPOSITION to an actor: unsupported by the original (no script uses it)');
      } else if (c.targetKind === 'spline') m.t = 0;
      if (look) this.camFollow = null;
      m.started = true;
    }
    if (this.camStep(m, cam, o)) return this.holdDone(m);
    return 1;
  }

  /** FUN_0045f2f4: one step of the move; true when it has arrived */
  private camStep(m: Cmd, cam: Float64Array, o: number): boolean {
    const kind = m.c.targetKind;
    const set = (p: ArrayLike<number>) => { cam[o] = p[0]; cam[o + 1] = p[1]; cam[o + 2] = p[2]; };
    const mv = m.x.move as EasedMove | undefined;
    if (this.skip()) {
      if (kind !== 'spline') { if (mv) set(mv.target); }
      else if (m.camSpline) set(m.camSpline.sample(1));
      m.timer = 0;
      return true;
    }
    if (kind === 'spline') {
      const s = m.camSpline;
      if (!s) return true;
      set(s.sample(m.t));
      m.t = Math.fround(m.t + s.rate * this.dt());                  // +0x40 is a float
      return 1 <= m.t;
    }
    if (!mv) return true;
    const p = [cam[o], cam[o + 1], cam[o + 2]];
    const done = mv.step(p);
    set(p);
    return done;
  }

  // ---------------------------------------------------------------------------------------------------------------- the end (FUN_00459119's last branch)
  /** false: the manager stops; true: a queued script started */
  private end(): boolean {
    const env = this.env, w = env.world, sys = env.wp;
    for (const e of this.actors) {
      const a = e.rec, ctrl = a.ctrl;
      if (ctrl) {
        ctrl.flags |= 2;
        const h = ctrl.walker && sys?.get(ctrl.walker) ? ctrl.walker : 0;
        if (h && sys) {
          if (e.lane < NO_LANE) sys.setLane(h, e.lane);             // FUN_00461ad6
          if (a.name.slice(0, 4) === 'PEPP') {
            sys.unregister(h);                                      // FUN_0046265d
            if (w.vars.get(V.PEPPER_CONTROL) & 1) w.pep.mailbox = PEP_END_CLIP;
            a.anim?.start(w.pep.mailbox, 0);                        // FUN_0043b6a3(anim, DAT_008ae088, 0)
            actorCamera(w, a, a.ry, SIDE.BEHIND, END_HEIGHT, SIDE_VEC_END);
          }
        }
      }
      a.face = e.face;                                              // FUN_0043f2f0(model, saved)
    }
    env.setFov(this.savedFov);
    this.selected = false;
    this.subtitle = null;
    this.log.push(`end ${this.slots[this.current]?.name}`);
    const next = this.queued;
    if (next >= 0) {
      this.queued = -1;
      return this.begin(next, true);
    }
    env.letterbox(0);
    w.vars.andNot(V.PEPPER_CONTROL, 0x100);
    env.setNearPlane?.(null);
    return false;
  }

  /** diagnostics: the commands of the current script (state 0 pending, 1 running, 2 done, 3 finished; dead = never starts) and the registered actors */
  inspect() {
    return {
      commands: this.cmds.map((m) => ({ cmd: m.c.cmd, actor: m.c.actor, record: m.actor, target: m.c.target, kind: m.c.targetKind, state: m.state, dead: m.dead, started: m.started })),
      actors: this.actors.map((e) => e.rec),
      selected: this.selected, queued: this.queued, camFollow: this.camFollow,
    };
  }

  /** stop at once (the zone ends while a script runs) */
  abort() {
    if (!this.running && !this.selected) return;
    this.queued = -1;
    this.running = false;
    if (this.cmds.length) this.end();
    this.selected = false;
  }
}
