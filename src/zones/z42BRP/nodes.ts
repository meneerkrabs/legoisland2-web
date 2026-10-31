// z42BRP: the behaviour nodes of Brickster's palace, ported from the zone code of the original (0x81fd64-0x827700, docs/re/m6/z42BRP.md). DOM-free: everything runs on the
// world's records, so node tests can drive it with scripted input.
//   phase 1 (game variable 0xfa == 1): the side run up the tower
//     pepbrp  0x823f08 (update 0x822ba8)  Pepper runs round the tower (left / right = along the circle, button 2 = jump), switches, lift
//     zonebrp 0x826516 (update 0x825850)  the tower's moving parts: sliders, the two bridges the switches lower, the crumbling platform, the arc platform, the lift
//   phase 2 (0xfa == 2): the roof
//     peptop  0x8224ba (update 0x821704)  Pepper on the roof floor: four directions, pizza throw (button 4), knock-back by the bots, falling
//     brickst 0x82714a (update 0x826b40)  Brickster paces between the two bots' places, the third pizza ends the game
//     bottop  0x824a02 (update 0x8243e5)  the four brick bots that march across the roof
//     zonetop 0x825378 (update 0x824c80)  the roof floor collapses row by row, the door of the end cutscene
// The node's "draw hook" work does not exist in this zone: the records are drawn with their own matrices. Timing: fixed 60 Hz step, one tick = one drawn frame of the original (`w.dt`
// where the original multiplies by DAT_008b1718: 1 for the first five frames, then 0.5); the game clock the zone reads (FUN_00435cbb = ftol(ms * 0.06), 1/60 s) is the
// deterministic stand-in `BrpState.clock()` = 1 per tick (a tick is 1/60 s whatever `dt` says).
import { parseBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Archive } from '../../formats/archive.ts';
import { eulerMatrix, mulMatrices, normalise3 } from '../exact.ts';
import { AnimInstance } from '../../game/anim.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { registerCtor } from '../../game/setup.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { B } from '../../game/input.ts';
import type { WaypointSystem } from '../../game/walker.ts';
import { MAP_PATH } from '../../game/walker.ts';
import { boneOfPose } from '../common/pose.ts';
import { rand as crtRand } from '../../game/crt.ts';
import type { RandFn } from '../../fx/particles/core.ts';
import { REC, REC_NAMES, SND, VAR, RUN, ROOF, BOT, FLOOR, BOSS, PARTS, CLIP } from './rules.ts';

/** constructor addresses of the zone (the extraction's attaches, docs/re/zone-setup.md) */
export const CTOR = { PEPBRP: 0x823f08, PEPTOP: 0x8224ba, BOTTOP: 0x824a02, ZONETOP: 0x825378, ZONEBRP: 0x826516, BRICKST: 0x82714a } as const;

/** pi and pi / 2 as the executable has them (floats 0x40490fdb, 0x3fc90fdb: _DAT_0089207c / _DAT_00892220) */
const PI = Math.fround(Math.PI), HALF_PI = Math.fround(Math.PI / 2);
/** the side run keeps its angle as a float32 and wraps it with `fmod(angle, 6.2831854820251465)`: the 2 pi of the original is the double 0x401921fb60000000 (the float32 of 2 pi), not the true 2 pi */
const F = Math.fround, TWO_PI_F32 = 6.2831854820251465;
type V3 = [number, number, number];

// ------------------------------------------------------------------------------------------------ small engine functions the zone uses

/** FUN_0043a9e5(dst, a, b): dst = b * a, every product and sum float32 (src/zones/exact.ts) */
function m43a9e5(a: Float32Array, b: Float32Array): Float32Array { return mulMatrices(b, a); }
/** FUN_0043cec0: normalise in place, float32 per operation (a zero vector stays) */
const normalise = normalise3;
/** FUN_0043a5e4 / FUN_0043a340 (src/zones/exact.ts) */
function eulerF(rx: number, ry: number, rz: number, px: number, py: number, pz: number): Float32Array {
  const m = new Float32Array(16);
  eulerMatrix(m, rx, ry, rz, px, py, pz);
  return m;
}
const setEulerF = (r: GameRecord, rx: number, ry: number, rz: number, px: number, py: number, pz: number) => { r.m.set(eulerF(rx, ry, rz, px, py, pz)); };
/** FUN_00823bfb / FUN_008263b4(vec, angle, r): (sin(angle) r, y kept, cos(angle) r) */
function polar(v: number[], angle: number, r: number) { const y = v[1]; v[0] = F(F(Math.sin(angle)) * r); v[1] = 0 * r; v[2] = F(F(Math.cos(angle)) * r); v[1] = y; }
const posOf = (r: GameRecord): V3 => [r.x, r.y, r.z];
const setPos = (r: GameRecord, x: number, y: number, z: number) => { r.m[12] = x; r.m[13] = y; r.m[14] = z; };

/** stands in for the animation of a record that has none (worlds built by other code, e.g. the stub-walk test, have no rigs bound) */
const NO_ANIM = { advance: () => 0, frame: 0, clip: 0, frameCount: 0, start: () => false, pose: () => null } as unknown as AnimInstance;
const animOf = (r: GameRecord): AnimInstance => r.anim ?? NO_ANIM;

// ------------------------------------------------------------------------------------------------ shared state (the zone's globals)

/** what the host fills in: sound, speech, the cutscene, the clock; the defaults only record what happened */
export interface BrpEnv {
  /** the C runtime's rand() (0 .. 32767, FUN_0085daf0) behind FUN_004388ae; the zone game passes the shared generator (src/game/crt.ts), tests a scripted source */
  rng: RandFn;
  /** FUN_00435c91: milliseconds since the loop started (the random numbers of the bots scale with it) */
  ms(): number;
  /** FUN_004435a0: a 2D sound by sound-table id */
  sfx(id: number): void;
  /** FUN_004433f0: a 3D sound at a position; `voice` picks one of the handles the original loads for the same sound (the six sliders, the bots' feet) */
  sfx3(id: number, pos: V3, voice?: number): void;
  /** FUN_00439bf8 + FUN_00435a11: speak lines of brp.str; `stop` first = FUN_00435b07 */
  say(a: string, b?: string, stop?: boolean): void;
  /** FUN_0045f750: the letterbox bars */
  letterbox(on: boolean): void;
  /** FUN_0045c40c(0): the end cutscene (only when the zone was not started from the menu); true when one runs */
  startCutscene(): boolean;
  /** FUN_0045c432: a cutscene is running */
  cutsceneActive(): boolean;
}

/** the C runtime's generator (FUN_0085daf0: MSVC LCG, 0 .. 32767) with a private state (tests; the game draws from the shared one, src/game/crt.ts) */
export function lcg(seed: number): RandFn {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 0x343fd) + 0x269ec3) >>> 0; return (s >>> 16) & 0x7fff; };
}

export class BrpState {
  env: BrpEnv;
  // the globals of the zone (DAT_05d5f5b8 ...)
  /** 5b8: Pepper is being knocked back by a bot */
  knock = 0;
  /** 5bc: hits on Brickster (reset when Pepper respawns) */
  hits = 0;
  /** 5d4: the end sequence: 0 playing, 1 the third hit landed, 2 the cutscene is asked for, 3 the cutscene runs / ran */
  endState = 0;
  /** 5d8: 0 until the end sequence started, then 2 -> 1 (mode 4 follows when the cutscene is over) */
  endTimer = 0;
  /** 5dc: Pepper respawns (roof) */
  respawn = 0;
  /** 5e0: the knock-back timer (20 ticks) and direction (5f0 .. 5f8) */
  knockTimer = 0;
  knockDir: V3 = [0, 0, 0];
  /** 5ec: the side run restarted (the moving parts return); 5fc: the roof floor returns; 600: Brickster returns */
  reset5ec = 0; reset5fc = 0; reset600 = 0;
  /** 5e8: Pepper reached the lift */
  liftHit = 0;
  /** statistics (tests): restarts of the side run (fell off the tower), falls from the roof */
  restarts = 0; falls = 0;
  /** DAT_00958a60 / DAT_00958ad8: the first update of the roof / side run node (initial value 1 in .data) */
  firstTop = 1; firstRun = 1;
  /** DAT_05d5f4c4: the elapsed game time in clock ticks (1/60 s), counted by the zone loop while mode 2 runs and no cutscene plays */
  elapsed = 0;
  pepbrp: PepBrpNode | null = null;
  peptop: PepTopNode | null = null;
  brickster: BricksterNode | null = null;
  zonebrp: ZoneBrpNode | null = null;
  zonetop: ZoneTopNode | null = null;
  bots: BotNode[] = [];
  rigs: Record<string, Blk> = {};
  log: string[] = [];
  sounds: { id: number; pos: V3 | null }[] = [];
  spoken: string[] = [];
  /** the world the state belongs to (the game clock counts its ticks) */
  w: World | null = null;
  /**
   * DAT_05d5f608: the static matrix of Brickster's three emitters (smoke2, flame1, flame1: DAT_05d5f648 / 64c / 650, started by FUN_0082714a on it, identity at the start): bone 10 of
   * BSTR's pose of the last draw x the record matrix (FUN_0043bc58 + FUN_0043a9e5), refreshed by the Brickster node after a hit and by the roof node while a cutscene runs
   */
  readonly bossFxM = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  /** FUN_00442a20(h, 2, 1, 1) / (h, 1, 1, 1) on the three emitters: `on[k]` true = gate on (the zone game binds it to the particle engine; a log for the tests) */
  bossFx: (on: [boolean, boolean, boolean]) => void = (on) => { this.fxLog.push(on.map((b) => (b ? 1 : 0)).join('')); };
  fxLog: string[] = [];
  /** FUN_0043bc58(BSTR anim, 10) + FUN_0043a9e5(DAT_05d5f608, BSTR + 0xc, bone): `clip` / `frame` = the pose the last draw evaluated */
  bossBone(w: World, clip: number, frame: number) { boneOfPose(this.bossFxM, w.records[REC.BSTR], clip, frame, 10); }

  constructor() {
    this.env = {
      rng: crtRand,
      ms: () => 100000 + this.clock() * (1000 / 60),
      sfx: (id) => { this.sounds.push({ id, pos: null }); },
      sfx3: (id, pos) => { this.sounds.push({ id, pos }); },
      say: (a, b) => { this.spoken.push(a); if (b) this.spoken.push(b); },
      letterbox: () => { /* none */ },
      startCutscene: () => false,
      cutsceneActive: () => false,
    };
  }
  sfx(id: number) { this.env.sfx(id); }
  sfx3(id: number, pos: V3, voice = 0) { this.env.sfx3(id, pos, voice); }
  /** FUN_004388ae(x) of the original: `(float) rand() / 32767.0f * x` stored as a float (x87 at 24 bit), 0 without a draw for x <= 0 */
  rand(x: number): number { return x <= 0 ? 0 : F(F(this.env.rng() / 32767) * F(x)); }
  /**
   * FUN_00435cbb = ftol(GetTickCount-based ms * 0.06): ticks of 1/60 s. The sim steps at a fixed 60 Hz (one tick = one drawn frame = 1/60 s whatever `dt` is: dt = 1 only
   * for the first five frames' step size), so the deterministic stand-in for the clock is the tick counter
   */
  clock(): number { return this.w?.tickCount ?? 0; }
}

const states = new WeakMap<World, BrpState>();
/** the state of the zone run of `w` (created on first use) */
export function stateOf(w: World): BrpState {
  let s = states.get(w);
  if (!s) { s = new BrpState(); s.w = w; states.set(w, s); }
  return s;
}

const rec = (w: World, i: number): GameRecord => w.records[i];

// ------------------------------------------------------------------------------------------------ nodes

abstract class BrpNode implements BehaviourNode {
  abstract readonly kind: string;
  var = VAR.PHASE; mask = 0x7fff; value = 1;
  stamp = 0xfffffffe;
  protected inited = false;
  /** the constructor's work (needs the record): run once, before the first update (or by `prepareWorld`) */
  abstract init(w: World, rec: GameRecord): void;
  abstract tick(w: World, rec: GameRecord, ctrl: Controller): void;
  update(w: World, r: GameRecord, ctrl: Controller): number {
    if (!this.inited) { this.inited = true; this.init(w, r); }
    this.tick(w, r, ctrl);
    return NODE_STOP;
  }
  ensureInit(w: World, r: GameRecord) { if (!this.inited) { this.inited = true; this.init(w, r); } }
}

/** the sweep of FUN_00441270(rec, from, delta, ..., 3, radius, skin) */
function sweep(w: World, ignore: GameRecord | null, from: ArrayLike<number>, delta: ArrayLike<number>, radius: number, skin: number) {
  // the original keeps the start and the delta in float32 locals (`local_3c = y + 2.4`) and writes the contact point and the normal into float32 out parameters
  const h = w.col.sweep(ignore, [F(from[0]), F(from[1]), F(from[2])], [F(delta[0]), F(delta[1]), F(delta[2])], 3, radius, skin);
  if (h) { h.point = [F(h.point[0]), F(h.point[1]), F(h.point[2])]; h.normal = [F(h.normal[0]), F(h.normal[1]), F(h.normal[2])]; }
  return h;
}

// ---------------------------------------------------------------------------------------------- phase 1: pepbrp (Pepper's side run)

/** FUN_008229b0: the camera of the side run: the eye is 0.8 of the way from Pepper to the tower's axis (at Pepper's height + 15.625), pushed 8 % sideways; target = Pepper + (0, 3, 0) */
export function runCamera(w: World, r: GameRecord) {
  const c = w.camera.c;
  // every operation float32 (24-bit x87); constants 0.8 = _DAT_00892084, 0.08 = _DAT_0089212c
  const K8 = F(0.8), K08 = F(0.08);
  const topY = F(r.y + 15.625);
  let vx = F(F(0 - r.x) * K8), vy = F(F(topY - r.y) * K8), vz = F(F(0 - r.z) * K8);
  const sx = F(F(F(vz * 1.0) - F(vy * 0.0)) * K08), sy = F(F(F(vx * 0.0) - F(vz * 0.0)) * K08), sz = F(F(F(vy * 0.0) - F(vx * 1.0)) * K08);
  vx = F(vx + sx); vy = F(vy + sy); vz = F(vz + sz);
  c[0] = F(vx + r.x); c[1] = F(vy + r.y); c[2] = F(vz + r.z);
  // FUN_00422c7e: target = focus + (0, 3, 0) (preset 0)
  c[3] = F(0 + r.x); c[4] = F(3 + r.y); c[5] = F(0 + r.z);
}

export class PepBrpNode extends BrpNode {
  readonly kind = 'pepbrp';
  /** +0x14: the radius of the circle (BRP's collision radius * 0.465) */
  R = 0;
  /** +0x18: the start angle; +0x78: the angle now; +0x7c: the angle one tick ago; +0x74: angular speed this tick (-0.0192 / 0 / +0.0192) */
  angle0 = 0; angle = 0; prevAngle = 0; omega = 0;
  /** +0x1c: the matrix at the start (the restart puts Pepper back with it) */
  spawn = new Float32Array(16);
  /** +0x5c: gravity; +0x60..+0x68: the position one tick ago */
  g = RUN.GRAVITY;
  prevPos: V3 = [0, 0, 0];
  /** +0x6c / +0x70: bits of the direction keys this tick / the tick before (1 left, 2 right) */
  dirFlags = 0; prevDirFlags = 0;
  /** +0x88 */
  animRes = 0;
  /** +0x89: in the air; +0x8a / +0x8b: touched switch 1 / 2; +0x8c BRI7; +0x8d BRI5; +0x8e the lift; +0x8f / +0x90 facing now / one tick ago (1 left, 2 right) */
  air = false; sw1 = false; sw2 = false; crumble = false; arc = false; lift = false; facing = 1; prevFacing = 1;
  /** +0x94: hold at the start; +0x98 after a restart */
  hold: number = RUN.START_HOLD; hold2 = -1;
  /** +0x9c: time in the jump; +0xa0 the y it started from; +0xa4 y now; +0xa8 initial velocity; +0xac velocity */
  t = 0; y0 = 0; yAir = 0; v0 = 0; vel = 0;

  init(w: World, r: GameRecord) {
    const S = stateOf(w);
    S.pepbrp = this;
    const brp = rec(w, REC.BRP);
    this.R = F(F(brp.colObj?.radius ?? 0) * RUN.RADIUS_FACTOR);
    const x = r.x, y = r.y, z = r.z;
    this.angle = this.prevAngle = this.angle0 = F(Math.atan2(x, z));
    const p: number[] = [x, y, z];
    polar(p, this.angle, this.R);
    setPos(r, p[0], y, p[2]);
    this.prevPos = [p[0], y, p[2]];
    this.spawn.set(r.m);
    this.g = RUN.GRAVITY;
    this.omega = 0;
    this.facing = this.prevFacing = 1; this.air = false;
    this.sw1 = this.sw2 = this.crumble = this.arc = this.lift = false;
    this.hold = RUN.START_HOLD; this.hold2 = -1;
    S.reset5ec = 0; S.liftHit = 0;
    r.flags |= 0x40;
    animOf(r).start(CLIP.IDLE, 0);
    runCamera(w, r);
  }

  /** FUN_00823c84: the keys: left / right along the circle (left wins), button 1 or 2 held = jump */
  private input(w: World, r: GameRecord) {
    this.prevDirFlags = this.dirFlags;
    this.dirFlags = 0;
    this.omega = 0;
    this.prevFacing = this.facing;
    const held = w.input.held;
    if ((held & B.LEFT) !== 0) { this.dirFlags |= 1; this.facing = 1; this.omega = F(-RUN.TURN_RATE * F(w.dt)); }
    else if ((held & B.RIGHT) !== 0) { this.dirFlags |= 2; this.facing = 2; this.omega = F(RUN.TURN_RATE * F(w.dt)); }
    if (!this.air && (held & (B.ALT | B.CTRL)) !== 0) {
      this.air = true;
      animOf(r).start(CLIP.JUMP, 0);
      this.t = 0; this.v0 = RUN.JUMP_V0;
      stateOf(w).sfx(SND.JUMP);
      this.y0 = r.y;
    }
  }

  tick(w: World, r: GameRecord) {
    const S = stateOf(w);
    const anim = animOf(r);
    let changed = false;
    const pos: V3 = posOf(r);
    if (this.hold <= 0) {
      if (S.firstRun === 1) { changed = true; S.firstRun = 0; }
      if (!this.lift) this.input(w, r);
      if (this.dirFlags === 0 && this.prevDirFlags !== 0) anim.start(CLIP.IDLE, 0);
      if (this.dirFlags !== 0 && this.prevDirFlags === 0 && !this.air) anim.start(CLIP.RUN, 0);
      this.prevAngle = this.angle;
      this.angle = F(this.angle + this.omega);
      this.angle = F(this.angle % TWO_PI_F32);
      pos[0] = r.x; pos[1] = r.y; pos[2] = r.z;
      this.prevPos = [pos[0], pos[1], pos[2]];
      polar(pos, this.angle, this.R);
      if (!this.air) {
        // the ground below: probe from 2.4 above down 80; the switches and the brick-bot heads do not count
        const h = sweep(w, r, [pos[0], pos[1] + RUN.PROBE_UP, pos[2]], [0, RUN.PROBE_DOWN, 0], RUN.SWEEP_RADIUS, RUN.SWEEP_SKIN);
        if (h && !this.ignored(w, h.rec)) pos[1] = h.point[1];
      } else {
        // the original keeps these as float32 (node fields and locals): t += 0.1 * dt, vel = g t + v0, y = vel t + y0 + g t^2 / 2
        this.t = F(F(RUN.JUMP_DT * w.dt) + this.t);
        this.vel = F(F(this.g * this.t) + this.v0);
        const t2 = F(this.t * this.t);
        const half = F(F(this.g * t2) * 0.5);
        this.yAir = F(F(F(this.vel * this.t) + this.y0) + half);
        pos[1] = this.yAir;
        changed = true;
      }
      const d: V3 = [F(pos[0] - this.prevPos[0]), F(pos[1] - this.prevPos[1]), F(pos[2] - this.prevPos[2])];
      if (!this.air) {
        const v = [d[0], d[1], d[2]];
        normalise(v);
        const dot = 0 * v[2] + 1 * v[1] + 0 * v[0];
        if (RUN.SLOPE_COS < dot) d[1] = F(d[1] / RUN.SLOPE_DAMP);
        if (dot < -RUN.SLOPE_COS) d[1] = 0;
      }
      // the wall: sweep from where Pepper was
      const wall = sweep(w, r, this.prevPos, d, RUN.WALL_RADIUS, RUN.SWEEP_SKIN);
      if (wall && wall.rec !== rec(w, REC.SWIC1) && wall.rec !== rec(w, REC.SWIC2)) {
        const n = wall.normal;
        const into = r.m[10] * n[2] + r.m[9] * n[1] + r.m[8] * n[0];
        if (into < 0) {
          const up = 0 * n[2] + 1 * n[1] + 0 * n[0];
          if (up < RUN.SLOPE_COS) {
            this.angle = this.prevAngle;
            this.omega = 0;
            pos[0] = this.prevPos[0]; pos[2] = this.prevPos[2];
            anim.start(CLIP.IDLE, 0);
          }
        }
      }
      setPos(r, pos[0], pos[1], pos[2]);
      // the turn: the matrix turns by the step, by pi more when the key changed sides
      let th = this.omega;
      if ((this.facing ^ this.prevFacing) !== 0) th = F(th + PI);
      if (th !== 0) {
        const old = new Float32Array(r.m);
        r.m.set(m43a9e5(old, eulerF(0, th, 0, 0, 0, 0)));
        changed = true;
      }
      // the second probe: what is under Pepper now
      const h2 = sweep(w, r, [pos[0], pos[1] + RUN.PROBE_UP, pos[2]], [0, RUN.PROBE_DOWN, 0], RUN.SWEEP_RADIUS, RUN.SWEEP_SKIN);
      const hr = h2?.rec ?? null;
      // the switches: the original's own probe (T1a closed). The angle steps 0.0192 * dt per frame; at the 60 Hz step (dt 0.5) the lattice of the float32 `fmod(a, 2 pi)`
      // contains the midpoints and the 0.0066 rad window of switch 2 is hit (tools/tests/m7-z42BRP-emu.mjs: the original's code in the emulation agrees tick by tick)
      const tr = sweep(w, r, [pos[0], pos[1] + RUN.PROBE_UP, pos[2]], [0, RUN.PROBE_DOWN, 0], RUN.SWEEP_RADIUS, RUN.SWEEP_SKIN)?.rec ?? null;
      if (tr === rec(w, REC.SWIC1)) { this.sw1 = true; S.sfx3(SND.MOVEP_BIG, posOf(rec(w, REC.BRI2))); }
      if (tr === rec(w, REC.SWIC2)) { this.sw2 = true; S.sfx3(SND.MOVEP_BIG, posOf(rec(w, REC.BRI3))); }
      if (hr === rec(w, REC.BRI7)) this.crumble = true;
      if (hr === rec(w, REC.BRI5)) this.arc = true;
      if (hr === rec(w, REC.BRI8)) {
        if (!this.lift) { this.lift = true; S.sfx(SND.YEAH); }
        const lift = rec(w, REC.BRI8);
        r.x = lift.x; r.z = lift.z;
        this.omega = 0;
        S.liftHit = 1;
        anim.start(CLIP.IDLE, 0);
        S.sfx3(SND.MOVEP_UP, posOf(lift));
        changed = true;
      }
      if (h2 && !this.ignored(w, hr!) ) {
        if (!this.air) pos[1] = h2.point[1];
        else if (pos[1] <= h2.point[1]) {
          this.air = false;
          pos[0] = h2.point[0]; pos[1] = h2.point[1]; pos[2] = h2.point[2];
          if (this.omega === 0) anim.start(CLIP.IDLE, 0); else anim.start(CLIP.RUN, 0);
        }
        r.y = pos[1];
        if (RUN.DROP_START < this.prevPos[1] - r.y && !this.air) {
          this.t = 0; this.v0 = 0; this.air = true;
          r.y = this.prevPos[1];
          S.sfx(SND.EEK);
          this.y0 = r.y;
        }
      }
      if (r.y < RUN.RESTART_Y) {
        // fell off the tower: back to the start, the moving parts return
        this.angle = this.angle0;
        r.m.set(this.spawn);
        this.air = false; this.prevFacing = 1; this.facing = 1; this.omega = 0;
        anim.start(CLIP.IDLE, 0);
        S.reset5ec = 1; S.restarts++;
        this.sw1 = this.sw2 = this.crumble = this.arc = false;
        this.hold2 = RUN.RESTART_HOLD;
      }
      if (!this.air) {
        this.animRes = anim.advance(1.0, w.dt);
        if (anim.clip === CLIP.RUN) {
          const f = anim.frame;
          if (15 <= f && f <= 16) S.sfx(SND.FSPLASTIC[0]);
          if (5 <= f && f <= 6) S.sfx(SND.FSPLASTIC[1]);
        } else if (this.omega !== 0) anim.start(CLIP.RUN, 0);
      } else this.animRes = anim.advance(2.0, w.dt);
      if (this.omega === 0) { if (this.animRes !== 0) { anim.start(CLIP.IDLE, 0); this.animRes = 0; } }
      else if (this.animRes !== 0) { anim.start(CLIP.RUN, 0); this.animRes = 0; }
      if (r.y !== this.prevPos[1]) changed = true;
      if (changed) runCamera(w, r);
    } else {
      this.hold -= 1 * w.dt;
      runCamera(w, r);
      anim.start(CLIP.IDLE, 0);
    }
  }

  /** the records the ground probes do not count: the two switches and the six brick-bot heads */
  private ignored(w: World, hit: GameRecord): boolean {
    if (hit === rec(w, REC.SWIC1) || hit === rec(w, REC.SWIC2)) return true;
    return REC.BBOT.some((i) => hit === rec(w, i));
  }
}

// ---------------------------------------------------------------------------------------------- phase 1: zonebrp (the tower's moving parts)

export class ZoneBrpNode extends BrpNode {
  readonly kind = 'zonebrp';
  /** +0x74 + 12 i: the sliders' places; +0x2c + 12 i: the radial step they take (8 units outwards) */
  start: V3[] = [];
  out: V3[] = [];
  /** the moving platforms' original heights: BRI2 (+0xc0), BRI7 (+0xc8), BRI3 (+0x118), BRI8 (+0x11c) */
  y2 = 0; y7 = 0; y3 = 0; y8 = 0;
  /** BRI5's arc: angle limits (+0xd0 / +0xd4), start height (+0xd8), radius (+0xdc), angle / height now (+0x1f4 / +0x1f8), direction (+0x204) */
  arcHi = 0; arcLo = 0; arcY = 0; arcR = 0; arcAngle = 0; arcNow = 0; arcDir = 1;
  /** the flame bobbers: BRI4 x 4 (30..33), their heights (+0xf0 + 4 i), the clock at the start (+0x100) and the phases (+0x104 ..) */
  bobY: number[] = [];
  bobStart = 0;
  bobPhase = [0, 0x3c, 0x78, 0xb4];
  /** the three matrices saved at the start: SWIC1 (+0x124), SWIC2 (+0x164), SWUP1 (+0x1a4) */
  m1 = new Float32Array(16); m2 = new Float32Array(16); m3 = new Float32Array(16);
  /** +0x1e8: the slide timer; +0x1ec: moving out; +0x1f0: the crumbling platform's fall speed */
  timer = 0; movingOut = true; fallSpeed: number = PARTS.BRI7_START;

  init(w: World) {
    const S = stateOf(w);
    S.zonebrp = this;
    this.start = []; this.out = [];
    for (const i of REC.SLIDERS) {
      const r = rec(w, i);
      this.start.push(posOf(r));
      // sin of the unrounded atan2 result, cos of its float32 (the decompile passes `(double)fVar2` and `(double)fVar5`)
      const a = Math.atan2(r.x, r.z);
      const v: V3 = [F(Math.sin(a)), 0, F(Math.cos(F(a)))];
      this.out.push([F(v[0] * PARTS.SLIDE), F(v[1] * PARTS.SLIDE), F(v[2] * PARTS.SLIDE)]);
    }
    const bri2 = rec(w, REC.BRI2), bri3 = rec(w, REC.BRI3), bri7 = rec(w, REC.BRI7), bri5 = rec(w, REC.BRI5), bri8 = rec(w, REC.BRI8);
    this.y2 = bri2.y; bri2.y += PARTS.BRI2_RAISE;
    this.y3 = bri3.y; bri3.y += PARTS.BRI3_RAISE;
    this.y7 = bri7.y;
    const ax = bri5.x, ay = bri5.y, az = bri5.z;
    this.arcY = ay;
    this.arcHi = F(Math.atan2(ax, az));
    this.arcAngle = this.arcHi;
    this.arcNow = ay;
    this.arcLo = F(this.arcAngle - PARTS.ARC_WIDTH);
    this.arcR = F(Math.sqrt(F(F(az * az) + F(ax * ax))));
    this.y8 = bri8.y;
    this.bobY = [30, 31, 32, 33].map((i) => rec(w, i).y);
    this.bobStart = S.clock();
    this.m1.set(rec(w, REC.SWIC1).m); this.m2.set(rec(w, REC.SWIC2).m); this.m3.set(rec(w, REC.SWUP1).m);
    this.fallSpeed = PARTS.BRI7_START;
    this.arcDir = 1;
    this.timer = 0; this.movingOut = true;
    REC.SLIDERS.forEach((i, k) => setPos(rec(w, i), ...this.start[k]));
  }

  /** FUN_008260e5: the side run restarted: everything back where it was */
  reset(w: World) {
    const bri2 = rec(w, REC.BRI2), bri3 = rec(w, REC.BRI3), bri7 = rec(w, REC.BRI7), bri5 = rec(w, REC.BRI5), bri8 = rec(w, REC.BRI8);
    bri2.y = this.y2 + PARTS.BRI2_RAISE;
    bri7.y = this.y7;
    bri7.flags |= 2; bri7.flags |= 1;
    this.fallSpeed = PARTS.BRI7_START;
    this.arcNow = this.arcY; this.arcAngle = this.arcHi;
    const v: number[] = [0, bri5.y, 0];
    polar(v, this.arcAngle, this.arcR);
    setPos(bri5, v[0], this.arcY, v[2]);
    bri3.y = this.y3 + PARTS.BRI3_RAISE;
    bri8.y = this.y8;
    REC.SLIDERS.forEach((i, k) => setPos(rec(w, i), ...this.start[k]));
    this.timer = 0; this.movingOut = true;
    const swup2 = rec(w, REC.SWUP2), swup1 = rec(w, REC.SWUP1), swic1 = rec(w, REC.SWIC1), swic2 = rec(w, REC.SWIC2);
    swup2.flags = 0;
    swup2.m.set(this.m3);
    swic2.flags |= 2; swic2.flags |= 1;
    swic2.m.set(this.m2);
    swup1.flags = 0;
    swup1.m.set(this.m3);
    swic1.flags |= 1; swic1.flags |= 2;
    swic1.m.set(this.m1);
  }

  tick(w: World) {
    const S = stateOf(w);
    const run = S.pepbrp;
    if (S.reset5ec !== 0) { this.reset(w); S.reset5ec = 0; }
    const flag = (n: number): boolean => {
      if (!run) return false;
      return n === 1 ? run.sw1 : n === 2 ? run.sw2 : n === 3 ? run.crumble : n === 4 ? run.arc : run.lift;
    };
    this.timer = F(1 * w.dt + this.timer);
    const sl = REC.SLIDERS.map((i) => rec(w, i));
    if (this.movingOut) {
      for (let i = 0; i < 6; i++) {
        sl[i].x = F(F(F(this.out[i][0] / PARTS.SLIDE_TICKS) * w.dt) + sl[i].x);
        sl[i].z = F(F(F(this.out[i][2] / PARTS.SLIDE_TICKS) * w.dt) + sl[i].z);
      }
      if (PARTS.SLIDE_TICKS <= this.timer) {
        this.movingOut = false;
        this.timer = 0;
        for (let i = 0; i < 6; i++) S.sfx3(SND.MOVEP_MID, posOf(sl[i]), i);
      }
    } else {
      for (let i = 0; i < 6; i++) {
        sl[i].x = F(sl[i].x - F(F(this.out[i][0] / PARTS.SLIDE_TICKS) * w.dt));
        sl[i].z = F(sl[i].z - F(F(this.out[i][2] / PARTS.SLIDE_TICKS) * w.dt));
        // (as in the original the test sits inside the loop: only the first slider is put back exactly, the timer is 0 for the others)
        if (PARTS.SLIDE_TICKS <= this.timer) {
          this.movingOut = true;
          this.timer = 0;
          setPos(sl[i], ...this.start[i]);
        }
      }
    }
    const swic1 = rec(w, REC.SWIC1), swic2 = rec(w, REC.SWIC2), swup1 = rec(w, REC.SWUP1), swup2 = rec(w, REC.SWUP2);
    const bri2 = rec(w, REC.BRI2), bri3 = rec(w, REC.BRI3), bri7 = rec(w, REC.BRI7), bri5 = rec(w, REC.BRI5), bri8 = rec(w, REC.BRI8);
    if (!flag(1)) swup1.flags = 0;
    else {
      swic1.flags = 0;
      swup1.flags |= 1; swup1.flags |= 2;
      swup1.m.set(this.m1);
      if (this.y2 < bri2.y) bri2.y = F(bri2.y - F(PARTS.BRI2_DROP * w.dt));
    }
    if (!flag(2)) swup2.flags = 0;
    else {
      swic2.flags = 0;
      swup2.flags |= 1; swup2.flags |= 2;
      swup2.m.set(this.m2);
      if (this.y3 < bri3.y) bri3.y = F(bri3.y - F(PARTS.BRI3_DROP * w.dt));
    }
    if (flag(3)) {
      bri7.y = F(bri7.y - this.fallSpeed);
      this.fallSpeed = F(F(F(this.fallSpeed / PARTS.BRI7_GROW) * w.dt) + this.fallSpeed);
      if (bri7.y < 0) bri7.flags = 0;
    }
    if (flag(4)) {
      if (this.arcDir === 1) {
        if (this.arcAngle <= this.arcLo) this.arcDir = 0;
        else {
          this.arcAngle = F(this.arcAngle - F(PARTS.ARC_STEP * w.dt));
          this.arcNow = F(F(PARTS.ARC_RISE * w.dt) + this.arcNow);
          const v: number[] = [0, 0, 0];
          polar(v, this.arcAngle, this.arcR);
          bri5.x = v[0]; bri5.y = this.arcNow; bri5.z = v[2];
        }
      }
      if (this.arcDir === 0) {
        if (this.arcHi <= this.arcAngle) this.arcDir = 1;
        else {
          this.arcAngle = F(F(PARTS.ARC_STEP * w.dt) + this.arcAngle);
          this.arcNow = F(this.arcNow - F(PARTS.ARC_RISE * w.dt));
          const v: number[] = [0, 0, 0];
          polar(v, this.arcAngle, this.arcR);
          bri5.x = v[0]; bri5.y = this.arcNow; bri5.z = v[2];
        }
      }
    }
    if (flag(5)) {
      for (const i of REC.BBOT) rec(w, i).flags = 0;
      if (RUN.LIFT_TOP <= bri8.y) {
        w.vars.set(VAR.PHASE, 2);
      } else bri8.y = F(F(F(F(RUN.LIFT_TOP - this.y8) / RUN.LIFT_TICKS) * w.dt) + bri8.y);
    }
    // the four flame bobbers bob on the 1/60 s clock
    const now = S.clock();
    for (let i = 0; i < 4; i++) {
      const c = (now - this.bobStart + this.bobPhase[i]) % PARTS.BOB_PERIOD;
      const s = Math.sin(F(c * PARTS.BOB_STEP));
      rec(w, 30 + i).y = F(F(s * PARTS.BOB_AMPLITUDE) + this.bobY[i]);
    }
  }
}

// ---------------------------------------------------------------------------------------------- phase 2: peptop (Pepper on the roof)

/** FUN_008216a0: the camera of the roof: behind (z - 10) and above (y + 6), looking at Pepper + (0, 3, 0) */
export function roofCamera(w: World, r: GameRecord) {
  const c = w.camera.c;
  c[0] = F(r.x + F(ROOF.CAM_EYE[0])); c[1] = F(r.y + ROOF.CAM_EYE[1]); c[2] = F(r.z + ROOF.CAM_EYE[2]);
  c[3] = r.x; c[4] = F(r.y + ROOF.CAM_TARGET_UP); c[5] = r.z;
}

export class PepTopNode extends BrpNode {
  readonly kind = 'peptop';
  value = 2;
  /** +0x14 .. +0x24: the yaws of the directions: 0 up (+z), 1 down, 2 right (+x), 3 left; +0x68 / +0x74 / +0x8c / +0x80: the unit vectors */
  yaw: [number, number, number, number] = [0, 0, 0, 0];
  dirs: V3[] = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]];
  /** +0x28: Pepper's matrix after a fall (and at the first tick) */
  spawn = new Float32Array(16);
  /** +0x98: the height of the floor */
  floorY = 0;
  /** +0xa0: the direction the pizza flies in (always the initial forward vector, +z) */
  throwDir: V3 = [0, 0, 1];
  /** +0xac: where Pepper stood at the start of the tick; +0xb8 / +0xbc: direction now / before (-1 none); +0xc0: the step */
  startPos: V3 = [0, 0, 0];
  dir = -1; prevDir = -1;
  step: V3 = [0, 0, 0];
  /** +0xd8: a pizza is flying; +0xdc: its start; +0xcc: its step; +0xec: its age; +0xf0: its spin; +0xe8: hits on Brickster; +0xf4: ticks of the fall */
  flying = false; pizzaStart: V3 = [0, 0, 0]; pizzaStep: V3 = [0, 0, 0]; age = 0; spin = 0; myHits = 0; fall = 0;
  /** +0xf8: the animation result */
  animRes = 0;

  init(w: World, r: GameRecord) {
    const S = stateOf(w);
    S.peptop = this;
    const a = rec(w, REC.ROW_A), b = rec(w, REC.ROW_B), c = rec(w, REC.ROW_C);
    // the yaw of the floor's rows: from tile 61 to tile 57 (dx, dz)
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    const yaw = F(Math.atan2(dx, dz));
    // dir 0 (up) +0x18 = yaw; dir 1 (down) +0x20 = yaw + pi; dir 2 (right) +0x24 = yaw + pi/2; dir 3 (left) +0x1c = yaw - pi/2
    this.yaw = [yaw, F(yaw + PI), F(yaw + HALF_PI), F(yaw - HALF_PI)];
    this.spawn.set(eulerF(0, yaw, 0, b.x, b.y, b.z));
    const up: number[] = [dx, dy, dz];
    normalise(up);
    this.dirs[0] = [up[0], up[1], up[2]];
    this.throwDir = [up[0], up[1], up[2]];
    this.dirs[1] = [up[0] * -1, up[1] * -1, up[2] * -1];
    const side: number[] = [c.x - b.x, c.y - b.y, c.z - b.z];
    normalise(side);
    // +0x80 = -(-side), +0x8c = -side: right is +x for the real data (side = (-1, 0, 0))
    this.dirs[3] = [side[0], side[1], side[2]];
    this.dirs[2] = [side[0] * -1, side[1] * -1, side[2] * -1];
    this.floorY = b.y;
    this.dir = this.prevDir = -1;
    this.flying = false; this.myHits = 0; this.spin = 0; this.fall = 0; this.age = 0;
    S.hits = 0; S.knock = 0; S.knockTimer = 0; S.endTimer = 0; S.endState = 0;
    r.flags |= 0x40;
    animOf(r).start(CLIP.IDLE, 0);
    S.env.letterbox(false);
  }

  /** FUN_00821470: the keys (the last of down, up, left, right wins) and the throw */
  private input(w: World, r: GameRecord) {
    this.prevDir = this.dir;
    this.dir = -1;
    if (this.fall < 1) {
      const held = w.input.held;
      if (held !== 0) {
        if (held & B.RIGHT) this.dir = 2;
        if (held & B.LEFT) this.dir = 3;
        if (held & B.UP) this.dir = 0;
        if (held & B.DOWN) this.dir = 1;
      }
      if ((w.input.pressed & B.SPACE) !== 0 && !this.flying) {
        const pz = rec(w, REC.PIZZ);
        pz.m.set(r.m);
        pz.m[13] += ROOF.THROW_OFFSET;
        pz.m[14] += ROOF.THROW_OFFSET;
        pz.flags |= 1; pz.flags |= 2;
        this.flying = true;
        stateOf(w).sfx(SND.PIZZATHROW);
        this.age = 0; this.spin = 0;
      }
    }
  }

  tick(w: World, r: GameRecord) {
    const S = stateOf(w);
    const anim = animOf(r);
    if (S.env.cutsceneActive()) return;
    if (S.endState === 1) S.endState = 2;
    else if (S.endState === 2 && S.endTimer === 0) {
      S.endState = 3;
      S.env.startCutscene();
      S.endTimer = 2;
    }
    if (S.firstTop === 1) { r.m.set(this.spawn); S.firstTop = 0; }
    if (S.respawn !== 0) {
      S.respawn = 0;
      r.m.set(this.spawn);
      this.dir = -1;
      this.myHits = 0;
      S.hits = 0;
      this.flying = false;
      return;
    }
    let x = r.x, y = r.y, z = r.z;
    this.startPos = [x, y, z];
    if (S.knock === 0) this.input(w, r);
    else {
      if (S.knockTimer === 20) { anim.start(CLIP.STUMBLE, 0); S.sfx(SND.RUNOVER); }
      this.dir = -1;
      const k = F(ROOF.KNOCK_STEP * w.dt);
      x = F(F(S.knockDir[0] * k) + this.startPos[0]);
      y = F(F(S.knockDir[1] * k) + this.startPos[1]);
      z = F(F(S.knockDir[2] * k) + this.startPos[2]);
      S.knockTimer -= 1 * w.dt;
      if (S.knockTimer <= 0) { S.knock = 0; S.knockTimer = 0; anim.start(CLIP.IDLE, 0); }
    }
    if (S.knockTimer === 0 && this.dir !== this.prevDir) {
      if (this.dir === -1) anim.start(CLIP.IDLE, 0); else anim.start(CLIP.RUN, 0);
    }
    let yawNow: number;
    if (this.dir < 0) { this.step = [0, 0, 0]; yawNow = this.yaw[0]; }
    else {
      const v = this.dirs[this.dir];
      yawNow = this.yaw[this.dir];
      const sx = F(v[0] * ROOF.STEP), sy = F(v[1] * ROOF.STEP), sz = F(v[2] * ROOF.STEP);
      x = F(x + sx); y = F(y + sy); z = F(z + sz);
      this.step = [F(x - this.startPos[0]), F(y - this.startPos[1]), F(z - this.startPos[2])];
    }
    if (S.knock === 0) {
      // the walls of the roof (STR3) hold Pepper back: the step is undone
      const wall = sweep(w, r, [this.startPos[0], this.startPos[1] + 0.8, this.startPos[2]], this.step, ROOF_SWEEP.RADIUS, ROOF_SWEEP.SKIN);
      if (wall && wall.rec === rec(w, REC.STR3)) { x = this.startPos[0]; y = this.startPos[1]; z = this.startPos[2]; }
    }
    // the floor below: down 40 from 2.4 above; nothing there, or it has dropped below the roof level: falling
    const fl = sweep(w, r, [x, y + ROOF.FLOOR_PROBE_UP, z], [0, ROOF.FLOOR_PROBE_DOWN, 0], ROOF_SWEEP.RADIUS, ROOF_SWEEP.SKIN);
    if (!fl || fl.point[1] < this.floorY) {
      this.fall += 1;
      y = F(y - ROOF.FALL_STEP);
      if (this.fall === ROOF.FALL_TICKS) { this.fall = 0; S.respawn = 1; S.reset5fc = 1; S.reset600 = 1; S.falls++; }
    }
    if (fl && fl.rec !== rec(w, REC.PIZZ)) { x = fl.point[0]; y = fl.point[1]; z = fl.point[2]; }
    setEulerF(r, 0, yawNow, 0, x, y, z);
    if (this.flying) this.flyPizza(w, r, S);
    this.animRes = anim.advance(1.0, w.dt);
    const f = anim.frame;
    if (15 <= f && f <= 16) S.sfx(SND.FSPLASTIC[0]);
    if (5 <= f && f <= 6) S.sfx(SND.FSPLASTIC[1]);
    roofCamera(w, r);
  }

  /** the pizza in the air (FUN_00821704 from `if (+0xd8 != 0)`): moves 1.875 along +z, spins, hits the bots (it vanishes) or Brickster (a hit) */
  private flyPizza(w: World, r: GameRecord, S: BrpState) {
    const pz = rec(w, REC.PIZZ);
    this.pizzaStart = posOf(pz);
    const k = ROOF.PIZZA_SPEED * w.dt;
    this.pizzaStep = [F(k * this.throwDir[0]), F(k * this.throwDir[1]), F(k * this.throwDir[2])];
    pz.m[13] = this.pizzaStart[1] + this.pizzaStep[1];
    pz.m[12] = this.pizzaStart[0] + this.pizzaStep[0];
    pz.m[14] = this.pizzaStart[2] + this.pizzaStep[2];
    this.age += 1;
    this.spin = F(this.spin + ROOF.PIZZA_SPIN);
    setEulerF(pz, HALF_PI, this.spin, 0, pz.m[12], pz.m[13], pz.m[14]);
    const h = sweep(w, pz, this.pizzaStart, this.pizzaStep, ROOF.PIZZA_RADIUS, ROOF_SWEEP.SKIN);
    const hr = h?.rec ?? null;
    for (const bi of REC.BOTS) {
      if (hr === rec(w, bi)) {
        this.flying = false;
        pz.flags = 0;
        S.sfx3(SND.PIZZAHITBOT, posOf(rec(w, bi)));
      }
    }
    const brik = rec(w, REC.BSTR);
    if (hr === brik && animOf(brik).clip !== CLIP.BRIK_HIT) {
      const n = this.myHits;
      if (n === 0) S.env.say('OGSGBP26');
      else if (n === 1) S.env.say('OGSGBP27', 'OGSGBP28', true);
      else if (n === 2) { S.endState = 1; S.env.letterbox(true); }
      this.myHits += 1;
      const snd = n + 1 <= 3 ? SND.HITVOCAL[n] : SND.HITVOCAL[2];
      S.sfx3(snd, posOf(brik));
      S.sfx3(SND.PIZZAHITBRIK, posOf(brik));
      S.hits = this.myHits;
      this.flying = false;
      pz.flags = 0;
    }
    if (ROOF.PIZZA_LIFE <= this.age) { this.flying = false; pz.flags = 0; }
  }
}

/** the roof's sweeps: radius 0.16, skin 0.4 (0x3e23d70a / 0x3ecccccd) */
const ROOF_SWEEP = { RADIUS: 0.15999999642372131, SKIN: 0.4000000059604645 } as const;

// ---------------------------------------------------------------------------------------------- phase 2: Brickster

export class BricksterNode extends BrpNode {
  readonly kind = 'brickst';
  value = 2;
  /** +0x14 / +0x20: the vectors to the two bots' places; +0x2c / +0x30: their yaws; +0x34: where he started */
  vec: V3[] = [[0, 0, 0], [0, 0, 0]];
  yawTo: [number, number] = [0, 0];
  start: V3 = [0, 0, 0];
  /** +0x40: which of the two (0, 1); +0x44: the leg's timer; +0x48: going out; +0x4c: the leg's length; +0x50: the hits seen; +0x54: hit reaction; +0x58: the animation result; +0x5c: footstep stage */
  idx = 0; timer = 0; going = true; period: number = BOSS.LEG; seen = 0; reacting = false; animRes = 0; stage = 0;

  init(w: World, r: GameRecord) {
    const S = stateOf(w);
    S.brickster = this;
    const down = (rr: GameRecord) => {
      const h = sweep(w, rr, [rr.x, rr.y, rr.z], [0, BOSS.PROBE_DOWN, 0], ROOF_SWEEP.RADIUS, ROOF_SWEEP.SKIN);
      if (h) setPos(rr, h.point[0], h.point[1], h.point[2]);
    };
    down(r);
    const b0 = rec(w, REC.BOTS[0]), b1 = rec(w, REC.BOTS[1]);
    down(b0); down(b1);
    this.start = posOf(r);
    this.vec[0] = [F(b0.x - r.x), F(b0.y - r.y), F(b0.z - r.z)];
    this.vec[1] = [F(b1.x - r.x), F(b1.y - r.y), F(b1.z - r.z)];
    this.yawTo = [F(Math.atan2(this.vec[0][0], this.vec[0][2])), F(Math.atan2(this.vec[1][0], this.vec[1][2]))];
    this.idx = 0; this.timer = 0; this.going = true; this.period = BOSS.LEG;
    S.reset600 = 0;
    r.flags |= 0x40;
    this.seen = 0; this.reacting = false; this.stage = 0; this.animRes = 0;
    animOf(r).start(CLIP.BRIK_RUN, 0);
  }

  tick(w: World, r: GameRecord) {
    const S = stateOf(w);
    if (S.endState >= 1) return;
    if (S.reset600 === 0) {
      const anim = animOf(r);
      const drawnClip = anim.clip, drawnFrame = anim.frame;      // the pose the last draw left (FUN_0043bc58 reads it)
      this.animRes = anim.advance(1.0, w.dt);
      if (this.animRes !== 0) anim.start(CLIP.BRIK_RUN, 0);
      const frame = Math.trunc(anim.frame);
      if (this.stage === 0) {
        if (4 < frame) { S.sfx3(SND.FSBRIDGE[0], posOf(r)); this.stage = 1; }
      } else if (this.stage === 1) {
        if (0xe < frame) { S.sfx3(SND.FSBRIDGE[1], posOf(r)); this.stage = 2; }
      } else if (this.stage === 2 && this.animRes !== 0) this.stage = 0;
      r.flags |= 0x40;
      if (S.hits === 1) this.period = BOSS.LEG_HIT1;
      else if (S.hits === 2) this.period = BOSS.LEG_HIT2;
      if (S.hits !== this.seen) {
        this.reacting = true;
        this.seen = S.hits;
        anim.start(CLIP.BRIK_HIT, 0);
        // FUN_00826b40: the hit count picks the emitter: 0 none, 1 smoke2, 2 the first flame1
        if (this.seen === 0) S.bossFx([false, false, false]);
        else if (this.seen === 1) S.bossFx([true, false, false]);
        else if (this.seen === 2) S.bossFx([false, true, false]);
      }
      if (this.seen !== 0) S.bossBone(w, drawnClip, drawnFrame);
      if (this.reacting) {
        if (this.animRes === 0) return;
        this.reacting = false;
        anim.start(CLIP.BRIK_RUN, 0);
        this.animRes = 0;
      }
      this.animRes = 0;
      this.timer = F(1 * w.dt + this.timer);
      if (this.period < this.timer) {
        if (this.going) this.going = false;
        else { this.idx = this.idx === 1 ? 0 : 1; this.going = true; }
        this.timer = 0;
      }
      const scale = F(100 / this.period);
      let c = this.going ? this.timer : F(this.period - this.timer);
      c = F(c * scale);
      const v = this.vec[this.idx];
      const C01 = F(0.01);      // _DAT_00892030
      const tx = F(F(F(v[0] * C01) * c) + this.start[0]), ty = F(F(F(v[1] * C01) * c) + this.start[1]), tz = F(F(F(v[2] * C01) * c) + this.start[2]);
      const h = sweep(w, r, [tx, ty, tz], [0, BOSS.PROBE_DOWN, 0], ROOF_SWEEP.RADIUS, ROOF_SWEEP.SKIN);
      const p: V3 = h ? [h.point[0], h.point[1], h.point[2]] : [tx, ty, tz];
      const yaw = this.going ? this.yawTo[this.idx] : F(this.yawTo[this.idx] - PI);
      setEulerF(r, 0, yaw, 0, p[0], p[1], p[2]);
    } else {
      S.reset600 = 0;
      setPos(r, this.start[0], this.start[1], this.start[2]);
      this.idx = 0; this.going = true; this.timer = 0; this.period = BOSS.LEG;
    }
  }
}

// ---------------------------------------------------------------------------------------------- phase 2: the bots

export class BotNode extends BrpNode {
  readonly kind = 'bottop';
  value = 2;
  /** +0x40: the bots' yaw (down the roof, -z); +0x34: the row they start on; +0x14: its height */
  yaw = 0;
  row: V3 = [0, 0, 0];
  baseY = 0;
  /** +0x44: the timer (> 0: waiting, < 0: marching); +0x54: the animation result; +0x58: footstep stage; +0x48: the position one tick ago */
  timer = 0; animRes = 0; stage = 0; prev: V3 = [0, 0, 0];
  /** which of the four bots (BOT0 .. BOT3) */
  index = 0;

  init(w: World, r: GameRecord) {
    const S = stateOf(w);
    if (!S.bots.includes(this)) S.bots.push(this);
    this.index = Math.max(0, REC.BOTS.indexOf(w.records.indexOf(r)));
    const a = rec(w, REC.ROW_A), b = rec(w, REC.ROW_B);
    // the yaw: from tile 57 to tile 61 (dx, dz)
    this.yaw = F(Math.atan2(F(b.x - a.x), F(b.z - a.z)));
    const s76 = rec(w, REC.SPAWN_A), s75 = rec(w, REC.SPAWN_B);
    this.baseY = s76.y;
    this.row = [F(s75.x - s76.x), F(s75.y - s76.y), F(s75.z - s76.z)];
    r.flags = 0;
    this.timer = Math.trunc(S.rand(S.env.ms())) % BOT.FIRST_DELAY_MOD;
    if (this.timer === 0) this.spawn(w, r);
    r.flags |= 0x40;
    animOf(r).start(CLIP.BOT_WALK, 0);
    this.animRes = 0; this.stage = 0;
  }

  /** FUN_008242d0: put the bot on a random place of the row (k / 20 of the way from BBOT 76 to BBOT 75) */
  spawn(w: World, r: GameRecord) {
    const S = stateOf(w);
    const k = Math.trunc(S.rand(S.env.ms())) % BOT.START_MOD;
    const f = F(F(BOT.START_STEP) * k);
    const s76 = rec(w, REC.SPAWN_A);
    const x = F(s76.x + F(f * this.row[0])), y = F(s76.y + F(f * this.row[1])), z = F(s76.z + F(f * this.row[2]));
    setEulerF(r, 0, this.yaw, 0, x, y, z);
    this.prev = [x, y, z];
  }

  tick(w: World, r: GameRecord) {
    const S = stateOf(w);
    if (!(S.endState < 1 && !S.env.cutsceneActive())) return;
    const pep = rec(w, REC.PEPP);
    if (this.timer <= 0) {
      if (this.timer === 0) {
        this.spawn(w, r);
        this.timer = -1;
      } else {
        const f: V3 = [r.m[8], r.m[9], r.m[10]];
        this.prev = [r.x, r.y, r.z];
        const st: V3 = [F(f[0] * BOT.SPEED), F(f[1] * BOT.SPEED), F(f[2] * BOT.SPEED)];
        const nx = F(st[0] + this.prev[0]), ny = F(st[1] + this.prev[1]), nz = F(st[2] + this.prev[2]);
        r.flags |= 1; r.flags |= 2;
        // Pepper in the way: a ray from 1.6 above the bot along its step
        if (S.knockTimer === 0) {
          const hit = w.col.rayRecord(pep, [this.prev[0], F(this.prev[1] + BOT.RAY_UP), this.prev[2]], st, 3, BOT.RAY_RADIUS, BOT.RAY_SKIN);
          if (hit) {
            S.knock = 1;
            S.knockDir = [r.m[8], r.m[9], r.m[10]];
            S.knockTimer = ROOF.KNOCK_TICKS;
            r.flags = 0; r.flags |= 0x40;
            this.timer = BOT.RESPAWN;
          }
        }
        r.y = ny; r.x = nx; r.z = nz;
        const g = sweep(w, r, [nx, ny + BOT.PROBE_UP, nz], [0, BOT.PROBE_DOWN, 0], ROOF_SWEEP.RADIUS, ROOF_SWEEP.SKIN);
        if (!g || REC.BOTS.some((i) => g.rec === rec(w, i)) || g.point[1] < F(this.baseY - BOT.FALL_LIMIT)) {
          r.flags = 0; r.flags |= 0x40;
          this.timer = BOT.RESPAWN;
        }
      }
    } else {
      this.timer = F(this.timer - F(1 * w.dt));
      if (this.timer < 0) this.timer = 0;
      r.flags = 0; r.flags |= 0x40;
    }
    const anim = animOf(r);
    this.animRes = anim.advance(1.0, w.dt);
    let f = anim.frame;
    if (15 <= f && f <= 16) S.sfx3(SND.BBFSMETAL[0], posOf(r));
    f = anim.frame;
    if (5 <= f && f <= 6) S.sfx3(SND.BBFSMETAL[1], posOf(r));
    if (this.animRes !== 0) { anim.start(CLIP.BOT_WALK, 0); this.animRes = 0; }
    const frame = Math.trunc(anim.frame);
    // the per-bot footstep handles alternate 0x246 / 0x247 (DAT_05d5f534 + 4 * (2 bot + 0 / 1)): bot 0's are the very handles the generic frame-15 / frame-5 step above uses (voice 0 of each sound), bot n has its own voice n; stage 2 is never left (the result was cleared above, as in the original)
    if (this.stage === 0) {
      if (4 < frame) { S.sfx3(SND.BBFSMETAL[0], posOf(r), this.index); this.stage = 1; }
    } else if (this.stage === 1) {
      if (0xe < frame) { S.sfx3(SND.BBFSMETAL[1], posOf(r), this.index); this.stage = 2; }
    } else if (this.stage === 2 && this.animRes !== 0) this.stage = 0;
  }
}

// ---------------------------------------------------------------------------------------------- phase 2: zonetop (the floor, the door)

export class ZoneTopNode extends BrpNode {
  readonly kind = 'zonetop';
  value = 2;
  /** +0x14 ..: the 5 x 5 tiles by row; +0x78 + ...: their saved matrices */
  tiles: GameRecord[][] = [];
  saved: Float32Array[][] = [];
  door: GameRecord | null = null; doorSaved = new Float32Array(16);
  /** +0x6b8: the period of a collapse (300); +0x6bc: how long a row falls (60); +0x71c: the next row; +0x720: the timer; +0x724: the falling row; +0x728: ticks it fell (-1); +0x72c: the speed; +0x730: the door's timer */
  period = FLOOR.PERIOD; fallLen = FLOOR.FALL_TICKS; nextRow = 0; timer = 0; falling = -1; fallTicks = -1; speed: number = FLOOR.FALL_START; doorTimer: number = FLOOR.DOOR_TICKS;
  slugs: GameRecord[] = [];

  init(w: World) {
    const S = stateOf(w);
    S.zonetop = this;
    this.tiles = REC.ROWS.map((row) => row.map((i) => rec(w, i)));
    this.saved = this.tiles.map((row) => row.map((t) => new Float32Array(t.m)));
    this.door = rec(w, REC.DOOR);
    this.doorSaved.set(this.door.m);
    this.slugs = REC.SLUGS.map((i) => rec(w, i));
    setEulerF(this.door, 0, HALF_PI, 0, this.door.x, this.door.y, this.door.z);
    S.reset5fc = 0;
    this.period = FLOOR.PERIOD; this.fallLen = FLOOR.FALL_TICKS;
    this.nextRow = 0; this.timer = 0; this.falling = -1; this.fallTicks = -1; this.speed = FLOOR.FALL_START; this.doorTimer = FLOOR.DOOR_TICKS;
  }

  tick(w: World) {
    const S = stateOf(w);
    if (S.reset5fc === 0) {
      for (const s of this.slugs) s.flags = 0;
      if (S.endState === 0 && this.nextRow < 5) {
        this.timer += w.dt * 1.0;
        if (this.period <= this.timer) {
          this.falling = this.nextRow;
          this.speed = FLOOR.FALL_START;
          this.nextRow += 1;
          if (this.nextRow === 5) this.nextRow = 0;
          this.timer = 0;
        }
      }
      if (this.falling >= 0) {
        if (this.fallTicks < this.fallLen) {
          // (the original also counts a word at tile + 0x62 down from 8 here; nothing reads it)
          for (const t of this.tiles[this.falling]) t.y -= this.speed;
          this.speed = F(this.speed / FLOOR.FALL_GROW + this.speed);
          this.fallTicks += 1;
        } else {
          for (const t of this.tiles[this.falling]) t.flags = 0;
          this.fallTicks = -1; this.falling = -1;
        }
      }
      // FUN_00824c80: while a cutscene runs the emitters follow Brickster's bone 10; the cutscene's door variable 2 lights the second flame1, 3 puts all three out
      if (S.env.cutsceneActive()) { const a = rec(w, REC.BSTR).anim; S.bossBone(w, a?.clip ?? 0, a?.frame ?? 0); }
      const door = w.vars.get(VAR.DOOR);
      if (door === 2) S.bossFx([false, false, true]);
      else if (door === 3) S.bossFx([false, false, false]);
      if (w.vars.get(VAR.DOOR) === 1) {
        this.doorTimer = F(this.doorTimer - F(1 * w.dt));
        const d = this.door!;
        setEulerF(d, 0, F(this.doorTimer * F(FLOOR.DOOR_STEP)), 0, d.x, d.y, d.z);
        if (this.doorTimer <= 0) { w.vars.set(VAR.DOOR, 0); d.m.set(this.doorSaved); }
      }
    } else {
      S.reset5fc = 0;
      this.tiles.forEach((row, r) => row.forEach((t, c) => { t.m.set(this.saved[r][c]); t.flags |= 1; t.flags |= 2; }));
      this.nextRow = 0; this.timer = 0; this.fallTicks = -1; this.falling = -1; this.speed = FLOOR.FALL_START;
    }
  }
}

// ------------------------------------------------------------------------------------------------ the zone loop's per-tick part

/**
 * What FUN_0081fd64's mode 2 does around the nodes each tick: the game clock (DAT_05d5f4c4, 1/60 s ticks, counted while no cutscene plays and the end sequence has not
 * started), the switch to the second help when the roof phase begins (`FUN_00417575(0xfa) == 2 && !local_58`, mode 10) and the end of the game (`DAT_05d5f5d8`: 2 -> 1 after the
 * cutscene, then mode 4, the banner). Pure, so the node tests and the zone game run the same code.
 */
export class ZoneLoop {
  help2Done = false;
  help2Pending = false;
  /** call after the nodes ran; returns 1 when the banner follows (the result is always a success: FUN_00404d14(&next, exit == 2, 1)) */
  update(w: World, S: BrpState, cutsceneActive = S.env.cutsceneActive()): number {
    if (!cutsceneActive && S.endState === 0) S.elapsed += 1;     // the clock's difference of this frame: 1/60 s (see `BrpState.clock`)
    if (w.vars.get(VAR.PHASE) === 2 && !this.help2Done) this.help2Pending = true;
    if (S.endTimer !== 0 && !cutsceneActive) {
      if (S.endTimer === 1) return 1;
      S.endTimer -= 1;
    }
    return 0;
  }
  /** polled after `update`: true once when the second help must show (the world stands still until a button is pressed) */
  takeHelp2(): boolean {
    if (!this.help2Pending) return false;
    this.help2Pending = false; this.help2Done = true;
    return true;
  }
}

// ------------------------------------------------------------------------------------------------ registration and set-up

registerCtor(CTOR.PEPBRP, () => new PepBrpNode());
registerCtor(CTOR.PEPTOP, () => new PepTopNode());
registerCtor(CTOR.BOTTOP, () => new BotNode());
registerCtor(CTOR.ZONETOP, () => new ZoneTopNode());
registerCtor(CTOR.ZONEBRP, () => new ZoneBrpNode());
registerCtor(CTOR.BRICKST, () => new BricksterNode());

/** the rigs the zone loads (FUN_00831690) and the records they animate (the instances made at 0x837855..: clip 1 first) */
export const RIGS: [string, number[]][] = [
  ['MFIG', [REC.PEPP, REC.BSTR, ...REC.BOTS]],
  ['RATT', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ['SLUG', [10, 11, 12, 13]],
];

/** give the records their animation instances (the original creates them in the loader, FUN_0043b4e2(rig, 1) + FUN_0043b6a3(anim, 1, 0)) */
export function bindRigs(w: World, archive: Archive) {
  const S = stateOf(w);
  for (const [name, recs] of RIGS) {
    let blk = S.rigs[name];
    if (!blk) {
      const e = archive.find(`anim/${name}.blk`);
      if (!e) continue;
      blk = S.rigs[name] = parseBlk(archive.read(e));
    }
    for (const i of recs) {
      const r = w.records[i];
      if (!r) continue;
      r.anim = new AnimInstance(blk);
      r.anim.start(1, 0);
    }
  }
}

/** FUN_00462d4f(1, rec, -2) + the tuning + FUN_004625d7(handle, _, 0): the cutscene actors Pepper and Brickster get a walker on the PATH map */
export function giveWalkers(w: World, wp: WaypointSystem) {
  for (const i of [REC.PEPP, REC.BSTR]) {
    const r = w.records[i];
    if (!r?.ctrl || (r.ctrl.walker && wp.get(r.ctrl.walker))) continue;
    const h = wp.create(MAP_PATH, r, -2);
    if (!h) continue;
    r.ctrl.walker = h;
    wp.setSpeed(h, 0.016666666);       // 0x3c888888
    wp.setLane(h, 0);
    wp.setTurnRate(h, 0.523598);       // 0x3f060a63
    wp.setRadiusMin(h, 0.2);           // 0x3e4ccccd
    wp.setRadiusMax(h, 0.75);          // 0x3f400000
    wp.setRadiusLimit(h, 0.25);        // 0x3e800000
    wp.teleport(h, 0);
  }
}

/** check the record indices against the names the constructors rely on; returns the list of mismatches (tests) */
export function checkRecords(w: World): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(REC_NAMES)) if (w.records[+i]?.name !== n) bad.push(`${i}: ${w.records[+i]?.name} (want ${n})`);
  return bad;
}

/**
 * Prepare a freshly set-up zone world for the nodes: the game variable of the phase (FUN_00820f4e: `FUN_00417597(0xfa, 1)`), rig instances, the stub chain of the engine removed
 * from Pepper (the zone has its own player nodes), the nodes' constructor work (they run lazily before their first update otherwise).
 */
export function prepareWorld(w: World, archive: Archive): BrpState {
  const S = stateOf(w);
  bindRigs(w, archive);
  w.vars.set(VAR.PHASE, 1);
  const pep = w.records[REC.PEPP];
  if (pep?.ctrl) pep.ctrl.nodes = pep.ctrl.nodes.filter((n) => n.kind === 'pepbrp' || n.kind === 'peptop');
  // the constructors run in the order of the set-up's attaches (records ascending by attach order: Brickster, Pepper, the zone object, the bots)
  for (const i of [REC.BSTR, REC.PEPP, REC.BRP, ...REC.BOTS]) {
    const r = w.records[i];
    for (const node of r?.ctrl?.nodes ?? []) (node as unknown as { ensureInit?(w: World, r: GameRecord): void }).ensureInit?.(w, r);
  }
  // FUN_00820f4e ends with `FUN_0043b6a3(Pepper's animation, 1, 0)` after the attaches: Pepper shows clip 1 until the first update starts the idle clip
  w.records[REC.PEPP]?.anim?.start(1, 0);
  for (const r of w.records) r.savePrev();
  w.camera.savePrev();
  return S;
}

/** a plain snapshot of the zone state (tests, the browser bot, `window.__zone.game.debug()`) */
export function snapshot(w: World) {
  const S = stateOf(w);
  const pep = w.records[REC.PEPP], brik = w.records[REC.BSTR];
  const run = S.pepbrp, top = S.peptop;
  return {
    phase: w.vars.get(VAR.PHASE),
    pepper: { x: pep.x, y: pep.y, z: pep.z, clip: pep.anim?.clip ?? -1 },
    run: run && {
      angle: run.angle, omega: run.omega, air: run.air, hold: run.hold, sw1: run.sw1, sw2: run.sw2, crumble: run.crumble, arc: run.arc, lift: run.lift,
      bri2: w.records[REC.BRI2].y, bri3: w.records[REC.BRI3].y, bri8: w.records[REC.BRI8].y,
    },
    top: top && { dir: top.dir, flying: top.flying, hits: top.myHits, fall: top.fall },
    boss: { x: brik.x, y: brik.y, z: brik.z, clip: brik.anim?.clip ?? -1, idx: S.brickster?.idx ?? -1, going: S.brickster?.going ?? false, period: S.brickster?.period ?? 0 },
    bots: S.bots.map((b, i) => { const r = w.records[REC.BOTS[i]]; return { x: r.x, y: r.y, z: r.z, on: r.enabled, timer: b.timer }; }),
    pizza: { on: w.records[REC.PIZZ].enabled && (w.records[REC.PIZZ].flags & 0x10) === 0, x: w.records[REC.PIZZ].x, y: w.records[REC.PIZZ].y, z: w.records[REC.PIZZ].z },
    knock: S.knock, knockTimer: S.knockTimer, hits: S.hits, restarts: S.restarts, falls: S.falls, endState: S.endState, endTimer: S.endTimer, elapsed: S.elapsed,
    floor: { next: S.zonetop?.nextRow ?? -1, falling: S.zonetop?.falling ?? -1, timer: S.zonetop?.timer ?? 0 },
    log: S.log.slice(-8),
  };
}
