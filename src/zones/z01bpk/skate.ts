// z01BPK, the skate park: the skateboard node of the zone (Common\Z01BPK\c_src\skate.c, constructor FUN_00492cc2, handler table 0x8d2130 = { update FUN_00490e2e,
// pre-render FUN_004928d2, destroy FUN_00492e90, draw FUN_00492c25 }). The code is shared with the island (src/island/vehicles/skate.ts ported the branches taken
// when CURRENT_SUBGAME != 1); this file ports the branches of CURRENT_SUBGAME == 1 (the park: half-pipes "QPIP", the arena walls +-39.9 / +-24, the trick
// scoring, the stunts of the air FUN_0048e840) and nothing else. Functions: FUN_00490e2e (update), FUN_004900d4 (per-state work), FUN_0048f66d (state machine),
// FUN_0048e840 (tricks), FUN_00490cd2 / FUN_00490af4 (input), FUN_0048fece / FUN_0048fdea (rolling sound).
// The state byte is Pepper's clip (MFIG.blk): 0x16 getting on, 0x2d push off, 0x29 rolling, 0x51 / 0x53 leaning (poses scrubbed by the steering), 0x2a crouch (Alt),
// 0x2b crouch held, 0x20 in the air (and the trick clips of FUN_0048e840 while the state is 0x20), 0x21 landing, 0x23 crash. The board record SKBD (DAT_009daa7c = 0x24)
// follows Pepper's matrix and plays SKBD.blk clips 1 (getting on), 3 (rolling), 4 (lean), 5 .. 0xe (the board's part of a trick).
// docs/re/m6/z01BPK.md lists every constant with its address; tools/tests/m6-z01BPK.mjs checks them against the executable.
import { parkSession } from '../../island/vehicles/crashsound.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { RAMP_TABLE } from '../../game/camera.ts';
import { setYawMatrix } from './run.ts';
import type { BpkRun } from './run.ts';

// ---------------------------------------------------------------------------------------------------------------------------------- constants
const f32 = Math.fround;
/** the float32 with this bit pattern (the constants of .rdata: a decimal literal can be one ulp off, e.g. 0x3e490fdb = pi / 16 is not f32(0.19635)) */
function fbits(u: number): number { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, u, true); return dv.getFloat32(0, true); }
/** the sweeps of the park: radius 0.8 / skin 0.6 (ground, walls), the second wall sweep radius 0.6 (0x3f4ccccd / 0x3f19999a); the head bump uses 1.4 (0x8d2120) */
export const PARK = {
  RADIUS: f32(0.8), SKIN: f32(0.6), RADIUS2: f32(0.6), BUMP_RADIUS: f32(1.4),
  /** FUN_00490e2e: the downward ground sweep reaches `vyv * dt - 40` below Pepper's feet + 1.2 (0x892528 / 0x8920e8) */
  GROUND_REACH: 40.0, FEET: f32(1.2),
  /** steering: yaw += steer * 0.00075 per tick (0x8924f8) */
  TURN: f32(0.00075),
  /** the board speeds up by 0.1 per tick (0x8920cc) up to `maxSpeed` (node +0x60 = 0.75: 0x3f400000) */
  PUSH: f32(0.1), MAX_SPEED: 0.75, MAX_SPEED_CAP: 1.0,
  /** the jump: v0 = charge * 20 (0x89237c), falling off the start platform / launching off the top of a pipe: 30 (0x41f00000) */
  JUMP_V0: 20.0, LAUNCH_V0: 30.0, CHARGE_STEP: f32(0.06), CHARGE_MAX: 2.0,
  /** the arena: x +-39.9 (0x892520 / 0x89251c), z +-24 (0x892518 / 0x8921a4), floor 0.6479 (0x892514), camera x +-37.9 / z +-21.9 (0x892508 / 0x892504 / 0x892500 / 0x8924fc) */
  WALL_X: f32(39.9), WALL_Z: 24.0, FLOOR: f32(0.6479), CAM_X: f32(37.9), CAM_Z: f32(21.9),
  /** the turn away from a wall / the half-pipe: pi / 16 = 0.19634954 rad per tick (0x8924ec = 0x3e490fdb), the pipe's air spin 10 degrees per tick (0x8920d8 = 0.0174532, a truncated pi / 180) */
  WALL_TURN: fbits(0x3e490fdb), SPIN: 10.0, DEG: f32(0.0174532),
  /** the ledge test only counts on the start platform (z <= -25: 0x892510), a drop of more than 2 (0x892028) */
  LEDGE_Z: -25.0, LEDGE: 2.0, AHEAD: 2.5,
  /** launching off the top of a pipe: y > 9.25 (0x89250c) while moving up */
  PIPE_TOP: f32(9.25),
  /** the camera: eye eases 0.1 (0.8 in the air) to (0, 12, -14) in Pepper's frame, target 4 above him (0x892080) */
  CAM_OFFSET: [0, 12.0, -14.0], CAM_EASE: f32(0.1), CAM_EASE_AIR: f32(0.8),
  /** the pipe's wall: while in the air a normal with 0 < y < 0.6 (0x89213c) snaps the up vector to +-z */
  PIPE_WALL_Y: f32(0.6),
  /** getting on: Pepper turns (0.19635 per tick) until his forward . (0, 0, 1) >= 0.95 (0x8924e4) */
  FACE_DOT: f32(0.95),
  /** air spin: stops turning once forward.y <= -0.65 (0x8924f0); picks the direction with right.y vs -0.9 (0x8924f4) */
  SPIN_STOP: f32(-0.65), SPIN_LEFT_Y: f32(-0.9),
} as const;

/** the trick progress: 0 .. 127 (0x89219c), the clip frame = frames * progress / 128 (0x892100); landing judged at 100 (0x89201c); score +15 per tick, +30 at the end (0x892074 / 0x892038) */
export const TRICK = { MAX: 127.0, DIV: 128.0, JUDGE: 100.0, SCORE_RUN: 15.0, SCORE_END: 30.0, DEAD_ZONE: 30, SPEED_STEP: f32(0.1) } as const;

/** the clips of the tricks that decay when the buttons are released (FUN_0048e840: 0x68, 10, 0x11, 0xf, 0x52, 0x54, 0x5c, 0x60, 0x6c); the others finish by themselves */
export const DECAY_CLIPS: readonly number[] = [0x68, 0x0a, 0x11, 0x0f, 0x52, 0x54, 0x5c, 0x60, 0x6c];

export type Dir = 'L' | 'C' | 'R';
export type Vert = 'U' | 'M' | 'D';
/** one stunt: button + stick direction -> Pepper's clip, the board's clip (0 = unchanged), the progress rate per tick (node +0x40), the sound id (the park's `FUN_00492ec0` slots) */
export interface Trick { button: number; x: Dir; y: Vert; clip: number; board: number; rate: number; sound: number }
const T = (button: number, x: Dir, y: Vert, clip: number, board: number, rate: number, sound: number): Trick => ({ button, x, y, clip, board, rate, sound });
/**
 * FUN_0048e840, second half: while the state is 0x20 and Pepper's clip is still the jump (0x20), a held trick button + the direction of the stick start a stunt.
 * Space (0x80), Ctrl (0x10), Shift (0x40); 'U' = the Up key (stickY < -30), 'D' = Down, 'M' = no vertical stick; 'L' / 'R' = steer < -30 / > 30, 'C' = |steer| < 30.
 * The sound ids are the loads of FUN_00492ec0 (DAT_05d58010 = 0x1aa, ...), the clips and rates the immediates of the function.
 */
export const TRICKS: readonly Trick[] = [
  // Space
  T(B.SPACE, 'L', 'U', 0x69, 9, 4, 0x1b2), T(B.SPACE, 'L', 'M', 0x67, 10, 4, 0x1ae), T(B.SPACE, 'L', 'D', 0x68, 0, 8, 0x1b3), T(B.SPACE, 'C', 'D', 0x6d, 0, 4, 0x1ba),
  T(B.SPACE, 'R', 'D', 0x5e, 6, 4, 0x1ac), T(B.SPACE, 'R', 'M', 0x5c, 7, 8, 0x1af), T(B.SPACE, 'R', 'U', 0x60, 8, 4, 0x1b0), T(B.SPACE, 'C', 'U', 0x52, 5, 4, 0x1aa),
  // Ctrl
  T(B.CTRL, 'L', 'U', 0x66, 0, 4, 0x1b6), T(B.CTRL, 'L', 'M', 0x0a, 0, 4, 0x1aa), T(B.CTRL, 'C', 'D', 0x11, 0, 4, 0x1aa), T(B.CTRL, 'R', 'M', 0x0f, 0, 4, 0x1aa),
  T(B.CTRL, 'R', 'U', 0x54, 0, 4, 0x1ad),
  // Shift
  T(B.SHIFT, 'L', 'U', 0x10, 0xb, 4, 0x1ab), T(B.SHIFT, 'L', 'M', 0x6a, 0, 4, 0x1b8), T(B.SHIFT, 'L', 'D', 0x64, 0, 4, 0x1b7), T(B.SHIFT, 'C', 'D', 0x6c, 0xe, 8, 0x1bb),
  T(B.SHIFT, 'R', 'M', 0x65, 0, 2, 0x1b4), T(B.SHIFT, 'R', 'U', 0x19, 0xc, 4, 0x1ab), T(B.SHIFT, 'C', 'U', 0x6b, 0xd, 4, 0x1b5),
];
/** the clip 0x5f is only in the "still held" test of the original (Shift + Right + Down), nothing selects it */
const HELD_ONLY: readonly { button: number; x: Dir; y: Vert; clip: number }[] = [{ button: B.SHIFT, x: 'R', y: 'D', clip: 0x5f }];
/**
 * Two quirks of the "still held" test (first half of FUN_0048e840, the compare chains at 0x48e8d0 / 0x48e911): for Space + Left + (no vertical) = 0x67 the vertical test is
 * `y < 30 || y > -30` (always true) and for Space + (no horizontal) + Down = 0x6d the horizontal test is `steer < 30 || steer > -30` (always true): the stunt counts as held
 * whatever the stick does in the unchecked direction. (The selection of a stunt, second half, tests both.)
 */
const HELD_ANY_Y = [0x67], HELD_ANY_X = [0x6d];

/** the direction of a stick value: left / right beyond +-30 (the original's tests are strict, so exactly +-30 is a dead zone), centre inside */
export function dirX(steer: number): Dir | null { return steer < -TRICK.DEAD_ZONE ? 'L' : steer > TRICK.DEAD_ZONE ? 'R' : steer > -TRICK.DEAD_ZONE && steer < TRICK.DEAD_ZONE ? 'C' : null; }
/** vertical: stickY < -30 = Up, > 30 = Down */
export function dirY(y: number): Vert | null { return y < -TRICK.DEAD_ZONE ? 'U' : y > TRICK.DEAD_ZONE ? 'D' : y > -TRICK.DEAD_ZONE && y < TRICK.DEAD_ZONE ? 'M' : null; }

/** the stunt a button + stick position selects (null: none) */
export function trickFor(button: number, steer: number, y: number): Trick | null {
  const x = dirX(steer), v = dirY(y);
  if (x === null || v === null) return null;
  return TRICKS.find((t) => t.button === button && t.x === x && t.y === v) ?? null;
}
/** is a button held whose stick direction maps to `clip` (the "still doing the trick" test of the first half of FUN_0048e840) */
export function holdsTrick(held: number, steer: number, y: number, clip: number): boolean {
  const x = dirX(steer), v = dirY(y);
  for (const t of TRICKS) {
    if ((held & t.button) === 0 || t.clip !== clip) continue;
    const okX = HELD_ANY_X.includes(t.clip) ? true : x === t.x;
    const okY = HELD_ANY_Y.includes(t.clip) ? true : v === t.y;
    if (okX && okY) return true;
  }
  for (const t of HELD_ONLY) if ((held & t.button) !== 0 && t.clip === clip && x === t.x && v === t.y) return true;
  return false;
}

const UNSET = -107374176.0;    // a local of the original that is not written on one path: the debug heap fill 0xcccccccc read as a float
const NO_GROUND = -1000.0;     // 0x8920fc

/** FUN_0043cec0: normalise in place with the executable's float32 stores: l = (float)(x x + y y + z z), k = (float)(1 / sqrt(l)), v[i] = (float)(k v[i]); a zero vector stays zero */
function normalize(v: number[]): number[] {
  const l = f32(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (l !== 0) { const k = f32(1 / Math.sqrt(l)); v[0] = f32(k * v[0]); v[1] = f32(k * v[1]); v[2] = f32(k * v[2]); }
  return v;
}

/** the states in which the park plays its rolling sound (FUN_0048fece) */
const ROLLING = [0x0e, 0x19, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2d];


// ---------------------------------------------------------------------------------------------------------------------------------- FUN_0048e840 (shared)
/** the node fields FUN_0048e840 reads and writes (node + 0x18 based: state, +0x1c trickMid, +0x28 / +0x30 stick, +0x40 rate, +0x5c speed, +0x60 maxSpeed, +0x78 progress) */
export interface TrickNode {
  state: number; trickMid: number; steer: number; stickY: number; trickRate: number; speed: number; maxSpeed: number; progress: number;
  /** the frames FUN_0048e840 computes while a stunt runs and keeps in the node (+0x44 Pepper's frame, +0x48 the board's frame, +0x4c the progress fraction): part of the save block (WP-SAVE); the island's SkateNode declares them */
  trickPf?: number; trickBf?: number; trickF?: number;
}
/** the globals it uses: DAT_05d58004 (the trick score) and DAT_05d58008 (the "landing already counted" flag) */
export interface TrickGlobals { trickScore: number; trickFlag: number }

/** the progress of a running stunt: at the end +30 score per tick, else +rate and +15 */
function advanceTrick(n: TrickNode, g: TrickGlobals, dt: number) {
  if (TRICK.MAX <= n.progress) { n.progress = TRICK.MAX; g.trickScore = f32(TRICK.SCORE_END * dt + g.trickScore); }
  else {
    n.progress = f32(n.trickRate * dt + n.progress);
    if (TRICK.MAX < n.progress) n.progress = TRICK.MAX;
    g.trickScore = f32(TRICK.SCORE_RUN * dt + g.trickScore);
  }
}

/**
 * FUN_0048e840 (LE2.c:68000, called from FUN_00490e2e at LE2.c:69866 whenever the node's state is 0x20, on the island too): the stunts of the air.
 * `clip` = Pepper's current clip (FUN_0043b72b), `play` is called for every stunt whose condition holds (the park plays the stunt's own sound,
 * `if (DAT_05d580a4 == 0) FUN_004435a0(DAT_05d581f0)` on the island plays sound 0x1ab for all of them).
 */
export function skateTricks(n: TrickNode, g: TrickGlobals, w: World, rec: GameRecord, board: GameRecord | null, clip: number, play: (t: Trick) => void) {
  const held = w.input.held, dt = w.dt;
  let c1 = 0, c2 = 0;
  if (n.state === 0x20 && clip !== 0x20) {
    if (!holdsTrick(held, n.steer, n.stickY, clip)) {
      // the inputs of the running stunt are gone
      if (0 < n.progress) {
        if (DECAY_CLIPS.includes(clip)) {
          n.progress = f32(n.progress - (n.trickRate + n.trickRate) * dt);
          if (n.progress < 0) n.progress = 0;
          if (g.trickFlag === 0 && n.progress <= TRICK.JUDGE && g.trickScore !== 0) {
            n.trickMid = 0;
            if (n.maxSpeed < PARK.MAX_SPEED_CAP && n.speed === n.maxSpeed) n.maxSpeed = f32(n.maxSpeed + TRICK.SPEED_STEP);
          }
        } else if (g.trickFlag === 0 && TRICK.JUDGE <= n.progress && g.trickScore !== 0) {
          n.trickMid = 1;
          if (n.maxSpeed < PARK.MAX_SPEED_CAP && n.speed === n.maxSpeed) n.maxSpeed = f32(n.maxSpeed + TRICK.SPEED_STEP);
        }
        if (!DECAY_CLIPS.includes(clip)) advanceTrick(n, g, dt);
      }
    } else advanceTrick(n, g, dt);
    // the frame of both clips follows the progress
    const f = f32((n.progress * 1.0) / TRICK.DIV);
    const pf = f32((rec.anim?.frameCount ?? 0) * f), bf = f32((board?.anim?.frameCount ?? 0) * f);
    n.trickF = f; n.trickPf = pf; n.trickBf = bf;       // node +0x4c / +0x44 / +0x48 (struct +0x34 / +0x2c / +0x30)
    board?.anim?.seek(bf);
    rec.anim?.seek(pf);
  } else n.trickMid = 0;
  if (clip === 0x20) {
    // a stunt button with a direction starts a stunt (Space, then Ctrl, then Shift: a later one overrides an earlier one, every one plays its sound)
    for (const btn of [B.SPACE, B.CTRL, B.SHIFT]) {
      if ((held & btn) === 0) continue;
      const tr = trickFor(btn, n.steer, n.stickY);
      if (!tr) continue;
      c1 = tr.clip; if (tr.board !== 0) c2 = tr.board;
      n.trickRate = tr.rate;
      play(tr);
    }
  }
  if (c1 !== 0) rec.anim?.start(c1, 0);
  if (c2 !== 0) board?.anim?.start(c2, 0);
}

// ---------------------------------------------------------------------------------------------------------------------------------- the node
export class BpkSkate implements BehaviourNode {
  readonly kind = 'bpkSkate';
  var = 0x5e; mask = 4; value = 4;
  stamp = 0xfffffffe;
  readonly run: BpkRun;
  // node + 0x18 .. (FUN_00492cc2)
  state = 0x16;            // +0x18
  evaluated = 0;           // +0x19 (the landing was judged)
  grounded = 1;            // +0x1a
  onPipe = 0;              // +0x1b (the last ground sweep hit a half-pipe "QPIP")
  trickMid = 0;            // +0x1c
  pushes = 0;              // +0x1d
  locked = 0;              // +0x1e (the park: getting on / landing; set by the state machine, cleared when the landing is judged)
  animResult = 0;          // +0x20
  rampX = 0x10; steer = 0; // +0x24 / +0x28
  rampY = 0x10; stickY = 0;// +0x2c / +0x30
  t = 0;                   // +0x38: time in the air
  spin = 0;                // +0x3c: the half-pipe's air spin (+-10 degrees per tick)
  trickRate = 0;           // +0x40: the progress per tick of the running stunt
  speed = 0;               // +0x5c
  maxSpeed: number = PARK.MAX_SPEED; // +0x60
  charge = 0;              // +0x64
  pipeSpeed = 0;           // +0x68: 0.25 / forward.y, the speed along the pipe in the air
  y0 = 0;                  // +0x68 (the original shares the slot: the jump's start height; the pipe speed lives at +0x50)
  jumpY = 0;               // +0x6c
  v0 = 0;                  // +0x70
  vy = 0;                  // +0x74
  progress = 0;            // +0x78
  vx = 0; vz = 0; vyv = 0; // +0x8c / +0x94 / +0x90: the velocity of this tick
  /** +0x98 / +0x9c / +0xa0: the normal of the last half-pipe hit (initial y 8: 0x41000000), +0xb0: that record */
  pipeN: [number, number, number] = [0, 8.0, 0];
  pipeRec: GameRecord | null = null;

  constructor(run: BpkRun) { this.run = run; parkSession.visited = true; }   // the park's sound set (FUN_00492ec0) ran: DAT_05d58064 / 05d5802c hold park slots from now on

  private board(w: World): GameRecord | null { return w.records[this.run.board] ?? null; }

  // ------------------------------------------------------------------------------------------------------------------------------- input
  /** FUN_00490af4: the key ramp */
  ramp(held: number) {
    let rx = this.rampX, ry = this.rampY, b1 = false, b2 = false;
    if (held & B.LEFT) { b1 = true; rx = rx < 0x11 ? rx - 3 : 0x10; if (rx < 1) rx = 0; }
    if (held & B.RIGHT) { b1 = true; rx = rx < 0x10 ? 0x10 : rx + 3; if (rx > 0x1f) rx = 0x20; }
    if (held & B.UP) { b2 = true; ry = ry < 0x11 ? ry - 3 : 0x10; if (ry < 1) ry = 0; }
    if (held & B.DOWN) { b2 = true; ry = ry < 0x10 ? 0x10 : ry + 3; if (ry > 0x1f) ry = 0x20; }
    if (!b1) { if (rx > 0x10) { rx -= 4; if (rx < 0x10) rx = 0x10; } if (rx < 0x10) { rx += 4; if (rx > 0x10) rx = 0x10; } }
    if (!b2) { if (ry > 0x10) { ry -= 4; if (ry < 0x10) ry = 0x10; } if (ry < 0x10) { ry += 4; if (ry > 0x10) ry = 0x10; } }
    this.rampY = ry; this.stickY = RAMP_TABLE[ry] - 0x80;
    this.rampX = rx; this.steer = RAMP_TABLE[rx] - 0x80;
  }

  /** FUN_00490cd2 (the park's branches): the board speeds up by itself up to maxSpeed (no brake), the steering turns Pepper unless he is in the air */
  private input(w: World, rec: GameRecord) {
    this.ramp(w.input.held);
    if (this.maxSpeed <= this.speed) this.speed = this.maxSpeed; else this.speed = f32(this.speed + PARK.PUSH);
    if (this.state !== 0x20) rec.ry = f32(this.steer * PARK.TURN * w.dt + rec.ry);
  }

  // ------------------------------------------------------------------------------------------------------------------------------- sound
  /** FUN_0048fece with DAT_05d580a4 = 1 (the park's sound set): the wheels are one positional loop that follows the board while the state rolls, stopped otherwise */
  private rollSound(w: World) {
    const b = this.board(w);
    if (ROLLING.includes(this.state)) this.run.sounds.wheels(true, b ? [b.x, b.y, b.z] : [0, 0, 0]);
    else this.run.sounds.wheels(false, [0, 0, 0]);
  }

  // ------------------------------------------------------------------------------------------------------------------------------- FUN_004900d4
  /** the per-state work; returns the requested state (0 = none) */
  private stateWork(w: World, rec: GameRecord): number {
    const board = this.board(w);
    let next = 0, rate = 1.0, boardRate = 1.0;
    const dt = w.dt, held = w.input.held;
    this.rollSound(w);
    const lean = (pepClip: number) => {
      // the lean poses: Pepper's clip pepClip and the board's clip 4, both scrubbed to frame n + n * steer / 127
      rec.anim?.start(pepClip, 0);
      board?.anim?.start(4, 0);
      const s = f32(this.steer / 127.0);
      if (board?.anim) { const n = f32((board.anim.frameCount - 1) * 0.5); board.anim.seek(f32(n * s + n)); }
      if (rec.anim) { const n = f32((rec.anim.frameCount - 1) * 0.5); rec.anim.seek(f32(n * s + n)); }
    };
    switch (this.state) {
      case 0x0e: case 0x19: rate = 1.0; break;
      case 0x16: this.speed = 0; boardRate = 0.5; break;
      case 0x20: {
        // the jump arc: y = vy t + y0 + g t^2 / 2 with vy = g t + v0
        this.t = f32(PARK.PUSH * dt + this.t);
        this.vy = f32(this.t * w.gravity + this.v0);
        let y = f32(this.vy * this.t + this.y0 + w.gravity * (this.t * this.t) * 0.5);
        const cur = rec.y;
        if (4.0 < Math.abs(y - cur) && y - cur < 0) y = f32(cur - 4.0);
        if (y < cur) this.jumpY = y;
        else {
          const h = w.col.sweep(rec, [rec.x, f32(cur + 4.0), rec.z], [0, f32(y - cur), 0], 1, PARK.BUMP_RADIUS, PARK.BUMP_RADIUS);
          this.jumpY = h ? f32((f32(h.point[1]) - f32(y - cur)) - 4.0) : y;
        }
        this.grounded = 0;
        this.vx = 0; this.vyv = 0; this.vz = 0;
        if (!this.locked) this.airSpin(w, rec);
        if (rec.anim?.clip === 0x20) rate = 1.0; else { rate = 0; boardRate = 0; }
        break;
      }
      case 0x27: case 0x28: rate = 0; break;
      case 0x29:
        if (this.speed <= PARK.PUSH) next = 0x2d;
        this.run.trickScore = 0;
        if (this.steer < 0x15 && -0x15 < this.steer) {
          if (rec.anim?.clip !== 0x29) { next = 0x29; board?.anim?.start(3, 0); }
        } else { lean(0x51); rate = 0; boardRate = 0; }
        if ((held & B.ALT) !== 0) { next = 0x2a; this.charge = PARK.PUSH; }
        break;
      case 0x2a: rate = 1.0; break;
      case 0x2b:
        if ((held & B.ALT) === 0) {
          this.t = 0; this.v0 = f32(this.charge * PARK.JUMP_V0); this.charge = 0;
          this.jumpY = f32(this.y0 + 4.0); this.y0 = rec.y;
          next = 0x20;
        } else {
          if (this.steer < 0x15 && -0x15 < this.steer) {
            if (rec.anim?.clip !== 0x2b) { next = 0x2b; board?.anim?.start(3, 0); }
          } else { lean(0x53); boardRate = 0; }
          if (this.charge < PARK.CHARGE_MAX) this.charge = f32(PARK.CHARGE_STEP * dt + this.charge);
        }
        rate = 0;
        break;
      case 0x32:
        this.t = f32(PARK.PUSH * dt + this.t);
        this.vy = f32(this.t * w.gravity + this.v0);
        this.jumpY = f32(this.vy * this.t + this.y0 + w.gravity * (this.t * this.t) * 0.5);
        this.speed = -1.0;
        rate = 1.0;
        break;
      default: break;
    }
    // (FUN_0048fde5: empty)
    if (rate !== 0 && rec.anim) this.animResult = rec.anim.advance(rate, dt);
    if (boardRate !== 0 && board?.anim) board.anim.advance(boardRate, dt);
    return next;
  }

  /**
   * FUN_004900d4 case 0x20, the park's half: the spin over a half-pipe. On the first tick of a spin-free flight above a pipe the direction is chosen from the pipe's right
   * vector (right.y >= 0 and forward.y > -1: -10 degrees; right.y < 0 with -right.y < 1 and forward.y > -0.9: +10), the speed along the pipe is 0.25 / forward.y;
   * with a spin the yaw turns by spin degrees per tick while forward.y > -0.65 and the matrix is rebuilt flat (not for clip 0x5f).
   */
  private airSpin(w: World, rec: GameRecord) {
    const m = rec.m;
    const rightY = m[1], upY = m[5], fwdY = m[9];
    if (this.spin === 0) {
      if (this.onPipe !== 0 && upY < 6.0) {
        if (0 <= rightY) { if (PARK_NEG1 < fwdY) this.spin = -PARK.SPIN; }
        else if (-rightY < 1.0 && PARK.SPIN_LEFT_Y < fwdY) this.spin = PARK.SPIN;
      }
      if (fwdY !== 0) this.pipeSpeed = f32(0.25 / fwdY);
    } else {
      if (this.spin >= 0 || fwdY <= PARK.SPIN_STOP) {
        if (this.spin > 0 && PARK.SPIN_STOP < fwdY) rec.ry = f32(this.spin * PARK.DEG * w.dt + rec.ry);
      } else rec.ry = f32(this.spin * PARK.DEG * w.dt + rec.ry);
      if (rec.anim?.clip !== 0x5f) setYawMatrix(rec);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------- FUN_0048f66d
  /** the state machine; `next` = the state asked for so far, returns the state to switch to */
  private machine(w: World, rec: GameRecord, next: number): number {
    const board = this.board(w);
    const run = this.run;
    switch (this.state) {
      case 0x0e: if (this.animResult === 2) next = 0x27; if (this.steer < 0x14) next = 0x29; break;
      case 0x19: if (this.animResult === 2) next = 0x28; if (-0x14 < this.steer) next = 0x29; break;
      case 0x27: if (this.steer < 0x14) next = 0x29; break;
      case 0x28: if (-0x14 < this.steer) next = 0x29; break;
      case 0x16:
        // the park: turn (0.19635 per tick) until Pepper faces +z, and lock the stunt logic
        if (rec.m[10] < PARK.FACE_DOT) { rec.ry = f32(rec.ry - PARK.WALL_TURN * w.dt); setYawMatrix(rec); }
        this.locked = 1;
        if (this.animResult === 2) { next = 0x2d; board?.anim?.start(3, 0); }
        break;
      case 0x20: {
        if (this.pipeN[1] < PARK.PIPE_WALL_Y && 0 < this.pipeN[1] && !this.locked) {
          // a steep part of the pipe: the up vector snaps to +-z
          this.pipeN[0] = 0; this.pipeN[1] = 0;
          this.pipeN[2] = 0 <= this.pipeN[2] ? 1.0 : -1.0;
          alignTo(rec, this.pipeN);
        }
        if (this.grounded && this.onPipe) next = 0x21;
        break;
      }
      case 0x21: {
        this.spin = 0;
        run.sounds.stop(SND.HUNGRY); run.sounds.stop(SND.PIZZASPIN);
        if (this.animResult === 2) { next = 0x29; this.evaluated = 0; }
        board?.anim?.start(3, 0);
        this.spin = 0;
        if (this.evaluated === 0) {
          // the landing judged by the stunt's progress (progress = 0 when no stunt ran)
          let crash = false;
          if (this.trickMid === 0) {
            if (this.progress <= TRICK.JUDGE || run.trickFlag !== 0) { this.progress = 0; run.trickFlag = 1; } else crash = true;
          } else if (TRICK.JUDGE <= this.progress || run.trickFlag !== 0) {
            if (TRICK.JUDGE < this.progress && run.trickFlag === 0) { this.progress = 0; run.trickFlag = 1; }
          } else crash = true;
          if (crash) {
            next = 0x23; run.sounds.play(SND.FALLOFF);
            this.progress = 0; this.speed = 0; run.trickScore = 0; run.trickFlag = 0;
          }
          this.evaluated = 1;
        }
        // (the surface landing sounds are the island's: DAT_05d580a4 = 1 in the park)
        this.locked = 0;
        break;
      }
      case 0x23: this.maxSpeed = PARK.MAX_SPEED; this.speed = 0; if (this.animResult === 2) next = 0x29; break;
      case 0x2a:
        if (this.charge < PARK.CHARGE_MAX) this.charge = f32(PARK.CHARGE_STEP * w.dt + this.charge);
        if (this.animResult !== 0) {
          if ((w.input.held & B.ALT) !== 0) next = 0x2b;
          else { this.t = 0; this.v0 = f32(this.charge * PARK.JUMP_V0); this.charge = 0; this.jumpY = f32(this.y0 + 4.0); this.y0 = rec.y; next = 0x20; }
        }
        break;
      case 0x2d:
        if (this.animResult === 2) {
          if (this.pushes === 0) { this.pushes = 1; this.animResult = 0; } else { next = 0x29; this.pushes = 0; }
        }
        break;
      case 0x32: if (this.animResult === 2) { next = 0x29; w.pep.mailbox = 0; } break;
    }
    return next;
  }

  // ------------------------------------------------------------------------------------------------------------------------------- FUN_0048e840
  /** the stunts of the air (state 0x20): `clip` = Pepper's current clip (the code is shared with the island skateboard, `skateTricks`) */
  private tricks(w: World, rec: GameRecord, clip: number) {
    skateTricks(this, this.run, w, rec, this.board(w), clip, (tr) => this.run.sounds.play(tr.sound));
  }

  // ------------------------------------------------------------------------------------------------------------------------------- FUN_00490e2e
  update(w: World, rec: GameRecord, _ctrl: Controller): number { void _ctrl; return this.ride(w, rec); }
  /** FUN_004928d2: in the park both of its branches are skipped (they test CURRENT_SUBGAME != 1) */
  prerender(): void { /* nothing */ }

  private ride(w: World, rec: GameRecord): number {
    const g = w.pep;
    const dt = w.dt;
    let next = 0;              // local_80
    if (this.stamp !== w.frame || this.state !== g.mailbox) {
      this.animResult = 0;
      rec.show();
      this.maxSpeed = PARK.MAX_SPEED;
      this.speed = 0;
      if (g.mailbox === 1) {
        // the walk node was jumping: continue the jump on the board
        g.mailbox = 0x20; this.state = 0x20; this.t = 0; this.v0 = 20.0; this.y0 = rec.y; this.jumpY = f32(this.y0 + 2.0);
      } else if (g.mailbox !== 0) { this.state = g.mailbox; g.mailbox = 0; }
    }
    if (this.state !== 0x23 && this.state !== 0x16) { this.input(w, rec); }
    next = this.stateWork(w, rec);
    let ground = UNSET;          // local_2c
    if (this.state !== 0x16) {
      const h = w.col.sweep(rec, [rec.x, f32(rec.y + PARK.FEET), rec.z], [0, f32(this.vyv * dt - PARK.GROUND_REACH), 0], 3, PARK.RADIUS, PARK.SKIN);
      if (!h) {
        this.grounded = 1; this.onPipe = 0; this.pipeRec = null;
        g.surfaceAtFeet = w.col.lastSurface();
      } else {
        g.surfaceAtFeet = w.col.lastSurface();
        if (h.rec.name === 'QPIP') { this.onPipe = 1; this.pipeRec = h.rec; this.pipeN = [f32(h.normal[0]), f32(h.normal[1]), f32(h.normal[2])]; }
        else if (this.grounded !== 0) { this.onPipe = 0; this.pipeRec = null; }
        ground = f32(h.point[1]);
        if (this.t === 0) rec.y = ground;
      }
    }
    // the matrix: flat from the yaw unless the jump clip is playing (then the tilt of the half-pipe stays)
    if (rec.anim?.clip !== 0x20) setYawMatrix(rec);
    if (this.state === 0x20 || this.onPipe || this.state === 0x16) {
      if (this.onPipe && this.state !== 0x23 && !this.locked) {
        // tilt Pepper to the pipe's surface: up = the normal, forward = the old forward without its normal part
        alignTo(rec, this.pipeN);
        g.surfaceAtFeet = -1;
      }
    }
    const fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
    this.vx = f32(this.speed * fx * dt); this.vyv = f32(this.speed * fy * dt); this.vz = f32(this.speed * fz * dt);
    if (this.onPipe && !this.grounded && this.pipeRec) {
      // above a half-pipe the board slides along the pipe's right axis by pipeSpeed (the sign follows the spin)
      const pr = this.pipeRec.m;
      const dx = f32(this.pipeSpeed * pr[0]), dy = f32(this.pipeSpeed * pr[1]), dz = f32(this.pipeSpeed * pr[2]);
      if (this.spin > 0) { this.vx = dx; this.vyv = dy; this.vz = dz; }
      else if (this.spin < 0) { this.vx = -dx; this.vyv = -dy; this.vz = -dz; }
    }
    // walls: slide along, turn away from the wall; a second hit stops the board
    const ox = rec.x, oy = rec.y, oz = rec.z;                  // local_68 / 64 / 60
    {
      const from = [rec.x, f32(rec.y + PARK.FEET), rec.z];
      let h = w.col.sweep(rec, from, [this.vx, this.vyv, this.vz], 3, PARK.RADIUS, PARK.SKIN);
      if (h && h.rec.name !== 'QPIP') {
        const n = [f32(h.normal[0]), f32(h.normal[1]), f32(h.normal[2])];
        const d = f32(n[2] * this.vz + n[1] * 0 + n[0] * this.vx);
        this.vx = f32(this.vx - n[0] * d); this.vyv = f32(this.vyv - n[1] * d); this.vz = f32(this.vz - n[2] * d);
        if (this.spin === 0) {
          const dr = n[2] * rec.m[2] + n[1] * rec.m[1] + n[0] * rec.m[0];
          if (dr <= 0) rec.ry = f32(rec.ry - PARK.WALL_TURN * dt); else rec.ry = f32(PARK.WALL_TURN * dt + rec.ry);
        }
        h = w.col.sweep(rec, [ox, f32(oy + PARK.FEET), oz], [this.vx, this.vyv, this.vz], 3, PARK.RADIUS2, PARK.SKIN);
        if (h) { this.vx = 0; this.vyv = 0; this.vz = 0; }
      }
    }
    let nx = f32(rec.x + this.vx), nz = f32(rec.z + this.vz);
    let ny = f32(rec.y + this.vyv);
    if (this.t !== 0) {
      if (this.jumpY <= ground) {
        ny = ground; next = 0x21;
        this.t = 0; this.y0 = 0; this.jumpY = 0; this.v0 = 0; this.vy = 0; this.grounded = 1; this.pipeRec = null;
      } else ny = this.jumpY;
    }
    if (this.state !== 0x2d && this.state !== 0x16) {
      // the arena's walls: x +-39.9, z +-24, with the same turn away from them
      if (-PARK.WALL_X <= nx) {
        if (PARK.WALL_X < nx) {
          nx = PARK.WALL_X;
          if (this.spin === 0) { const d = rec.m[0] * -8.0; if (d <= 0) rec.ry = f32(rec.ry - PARK.WALL_TURN * dt); else rec.ry = f32(PARK.WALL_TURN * dt + rec.ry); }
        }
      } else {
        nx = -PARK.WALL_X;
        if (this.spin === 0) { const d = rec.m[0] * 8.0; if (d <= 0) rec.ry = f32(rec.ry - PARK.WALL_TURN * dt); else rec.ry = f32(PARK.WALL_TURN * dt + rec.ry); }
      }
      if (-PARK.WALL_Z <= nz) { if (PARK.WALL_Z < nz) nz = PARK.WALL_Z; } else nz = -PARK.WALL_Z;
    }
    rec.y = ny; rec.x = nx; rec.z = nz;
    if (rec.y < PARK.FLOOR) rec.y = PARK.FLOOR;
    next = this.machine(w, rec, next);
    // an edge in front (only on the start platform, z <= -25): off it in a jump (v0 30)
    const yNow = rec.y;
    const px = f32(rec.m[8] * PARK.AHEAD + ox), py = f32(rec.m[9] * PARK.AHEAD + oy), pz = f32(rec.m[10] * PARK.AHEAD + oz);
    let below = f32(w.col.groundRay(px, f32(py + 4.0), pz));
    if (below < NO_GROUND) below = w.seaLevel;
    const hd = w.col.sweep(rec, [px, f32(py + 80.0), pz], [0, -160.0, 0], 1, 0.009999999776482582, 0);   // FUN_00441a90
    if (hd && below < f32(hd.point[1])) below = f32(hd.point[1]);
    if (PARK.LEDGE < yNow - below && w.col.groundRay(ox, f32(oy + 4.0), oz) < rec.y && this.state !== 0x20 && this.state !== 0x16 && next !== 0x20 && rec.z <= PARK.LEDGE_Z) {
      this.launch(rec);
      next = 0x20;
    }
    // the top of a half-pipe: moving up above 9.25 launches him (v0 30)
    if (PARK.PIPE_TOP < rec.y && 0 < rec.m[9] && this.state !== 0x20 && this.state !== 0x21) {
      this.launch(rec);
      next = 0x20;
    }
    if (next !== 0) { rec.anim?.start(next, 0); this.state = next; g.mailbox = next; }
    const clip = rec.anim?.clip ?? 0;
    if (this.state === 0x20) this.tricks(w, rec, clip);
    // the board follows Pepper
    const board = this.board(w);
    if (board) { for (let i = 0; i < 15; i++) if (i !== 3 && i !== 7 && i !== 11) board.m[i] = rec.m[i]; }   // the original copies the 12 matrix words only (not the Euler angles +0x4c .. +0x54): WP-VERIFY
    // the skateboard camera: looks at 4 above Pepper, the eye eases (0.1, in the air 0.8) to (0, 12, -14) in his frame, kept inside the arena
    const c = w.camera.c;
    const k = this.state === 0x20 ? PARK.CAM_EASE_AIR : PARK.CAM_EASE;
    c[3] = rec.x; c[4] = f32(rec.y + 4.0); c[5] = rec.z;
    const ideal = rec.toWorld(PARK.CAM_OFFSET).map(f32);
    c[0] = f32((ideal[0] - c[0]) * k + c[0]);
    if (-PARK.CAM_X <= c[0]) { if (PARK.CAM_X < c[0]) c[0] = PARK.CAM_X; } else c[0] = -PARK.CAM_X;
    c[1] = f32((ideal[1] - c[1]) * k + c[1]);
    c[2] = f32((ideal[2] - c[2]) * k + c[2]);
    if (-PARK.CAM_Z <= c[2]) { if (PARK.CAM_Z < c[2]) c[2] = PARK.CAM_Z; } else c[2] = -PARK.CAM_Z;
    return NODE_STOP;
  }

  /** a jump from the ground without a crouch: v0 30, start height = the current y (the original plays DAT_05d5802c = sound 300, SND_SILENCE: nothing to hear) */
  private launch(rec: GameRecord) {
    this.t = 0; this.v0 = PARK.LAUNCH_V0; this.charge = 0;
    this.jumpY = f32(this.y0 + 4.0); this.y0 = rec.y;
  }
}

const PARK_NEG1 = -1.0;     // 0x8920dc

/** the sound ids of the park (FUN_00492ec0's loads) the node plays itself */
export const SND = { WHEELS: 0x94, FALLOFF: 0x1a8, HUNGRY: 0x1b4, PIZZASPIN: 0x1b3 } as const;

/**
 * Pepper's matrix for a surface normal `n` (FUN_00490e2e, the pipe branch): forward' = forward - (forward . n) n, normalised; right = n x forward'; up = n.
 */
export function alignTo(rec: GameRecord, nIn: readonly number[]) {
  const m = rec.m;
  const n = normalize([f32(nIn[0]), f32(nIn[1]), f32(nIn[2])]);
  let f = [m[8], m[9], m[10]];
  const d = f32(f[2] * n[2] + f[1] * n[1] + f[0] * n[0]);
  f = [f32(f[0] - d * n[0]), f32(f[1] - d * n[1]), f32(f[2] - d * n[2])];
  normalize(f);
  const r = [f32(n[1] * f[2] - n[2] * f[1]), f32(n[2] * f[0] - n[0] * f[2]), f32(n[0] * f[1] - n[1] * f[0])];
  m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
  m[4] = n[0]; m[5] = n[1]; m[6] = n[2];
  m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
}
