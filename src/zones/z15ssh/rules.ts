// z15SSH "Slangen schieten" (Snake Shooting, Adventure Island, zone table index 12): the coconut buggy. Pure TypeScript (no DOM): the node tests drive it with
// scripted input (tools/tests/m6-z15SSH.mjs). Ported function by function from the decompile (docs/re/m6/z15SSH.md):
//   `Walk`   constructor FUN_00659d94, update FUN_00658c16 on the record PEPP (22): the buggy that rides the CARBUT path by itself, the player only aims the
//            turret (arrow keys) and fires coconuts (Space); the three snakes (FUN_00657a30), the coconuts (FUN_0065866f / FUN_006582de), the Brickbot carts
//            on the cartpos1 path (FUN_00657860), the crew (Pippin, Johnny), the camera, the sounds (FUN_0065888a), the result
//   `Snake`  constructor FUN_0065a3c3 on the records SNK1..3 (4, 5, 6): an inert node (the state lives in the buggy's node); the snakes are drawn at scale 0.75
// The original keeps the state in the node struct (offsets in the comments: `p+0x..`) and a few globals (DAT_05d5bcdc the result, DAT_05d5bd48 the final score).
import { NODE_STOP, NODE_CONTINUE } from '../../game/controller.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { NO_GROUND } from '../../game/collision.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import { PathSpline, atPathEnd } from './spline.ts';
import type { PathFrame } from './spline.ts';
import { PartStore, then, rotate, rotation, setEulerPos } from './parts.ts';
import { buildMatrix } from '../../formats/matrix.ts';

/** constructor addresses in the EXE (the `ctor` of the set-up's attaches, docs/re/zone-setup.md) */
export const CTOR_CART = 0x659d94, CTOR_SNAKE = 0x65a3c3;

/** the 32-bit float of a hex literal of the code stream (the decompile shows floats as hex ints) */
export const hexf = (u: number): number => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
export const f32 = Math.fround;

/** record indices (byte offset / 0x68 of the builder FUN_0065a5c0 / the constructors); the names are checked at run time (`checkRecords`) */
export const REC = {
  SKY: 0, LAND: 1,
  /** the crew: Pippin (0xd0) and Johnny (0x138) sit in the buggy */
  PIPP: 2, JOHN: 3,
  /** the snakes SNK1..3 (0x1a0, 0x208, 0x270) */
  SNAKE: [4, 5, 6],
  /** the Brickbots BBT0 / BBT1 / BBT2 (0x3a8, 0x340, 0x2d8) that ride the carts CRT1 / CRT2 / CRT3 */
  BBT: [9, 8, 7],
  /** the buggy `PEPP` (0x8f0): the node's record, the focus, the camera target */
  CART: 22,
  /** the carts CRT1..3 (0x958, 0x9c0, 0xa28) */
  CRT: [23, 24, 25],
  /** the coconut shape (0x10a8): the model the 15 flying coconuts are drawn with */
  COCO: 41,
  /** G149 (0xf08): the position of the 3D fountain sound (record + 0x3c) */
  FOUNTAIN: 37,
} as const;
const NAMES: Record<number, string> = { 0: 'SSKY', 1: 'LAND', 2: 'PIPP', 3: 'JOHN', 22: 'PEPP', 41: 'COCO' };
REC.SNAKE.forEach((i, k) => { NAMES[i] = `SNK${k + 1}`; });
REC.BBT.forEach((i, k) => { NAMES[i] = `BBT${k}`; });
REC.CRT.forEach((i, k) => { NAMES[i] = `CRT${k + 1}`; });

/** sound-table ids FUN_0065a470 loads (`FUN_004433b0` = 3D, `FUN_00443580` = 2D) and the globals they go to */
export const SND = {
  /** 2D: the engine (DAT_05d5bd64, rate 31360..63700 by the slope), the wind layer (bd68: turret.wav at volume 80 (1 - u)), the ambience (bd60) */
  ENGINE: 0xb9, WIND: 0xba, AMBIENT: 0xbb,
  /** 3D: the waterfall (bd84, never played), the fountain at G149 (bd78), the Brickbot train at CRT1 (bd58), the snake slithering (bd74), its jump (bd80), the gem eaten (bd5c), the snake hit (bd4c) */
  WATERFALL: 0xbc, FOUNTAIN: 0xbd, TRAIN: 0xbe, SNAKE_MOVE: 0xc1, SNAKE_JUMP: 0xc2, SNAKE_GET_GEM: 0xc3, SNAKE_HIT: 0xc4,
  /** 2D: the tunnel / bridge (bd7c), the studs (bd70, started and stopped by the stages), the gun (bd88), skids (bd8c large, bd6c small), the turret swivel (bd54) / tilt (bd50) */
  UNDER_TRACK: 0xbf, OVER_STUDS: 0xc0, GUN: 0xc5, SKID_LARGE: 0xc6, SKID_SMALL: 0xc7, GUN_SWIVEL: 0xc8, GUN_TILT: 0xc9,
} as const;
export const SOUNDS_3D = [SND.FOUNTAIN, SND.WATERFALL, SND.TRAIN, SND.SNAKE_MOVE, SND.SNAKE_JUMP, SND.SNAKE_GET_GEM, SND.SNAKE_HIT];
export const SOUNDS_2D = [SND.ENGINE, SND.WIND, SND.AMBIENT, SND.UNDER_TRACK, SND.OVER_STUDS, SND.GUN, SND.SKID_LARGE, SND.SKID_SMALL, SND.GUN_SWIVEL, SND.GUN_TILT];

/** the constants of the zone's code (named with the EXE address of the literal) */
export const K = {
  /** ctor +0x3c: the top speed 0x3df5c28f; +0x48: the gems on the buggy (0x14); _DAT_008922cc: speed change per tick (0.005) */
  MAX_SPEED: hexf(0x3df5c28f), GEMS: 20, ACCEL: f32(0.005),
  /** _DAT_00892534: the wheel's turn per tick and speed unit (0.05236 = 3 degrees), added once per wheel */
  WHEEL_K: hexf(0x3d567704),
  /** _DAT_00892584: the turret's turn per tick (0.0349 = 2 degrees); the limits of pitch (-30 .. +25 degrees) and yaw (+-60 degrees) are the immediates of the code */
  AIM_STEP: hexf(0x3d0efa03),
  PITCH_MIN: hexf(0xbf060a63), PITCH_MAX: hexf(0x3edf66a5), YAW_MIN: hexf(0xbf860a63), YAW_MAX: hexf(0x3f860a63),
  /** _DAT_00892748: the ride ends when the buggy passes z = 7000 (or the end of the path, `FUN_00447800`) */
  END_Z: 7000,
  /** FUN_00658c16's move: position += forward * speed * 8 (_DAT_00892090) * 0.2 (_DAT_008920f0) * dt, the forward vector of length 8 (the literal 0x41000000) */
  MOVE_LEN: 8, MOVE_K: f32(8 * hexf(0x3e4ccccd)),
  /** the ground follow: probe from y + 15 (_DAT_00892074) with 2.0 above it, else from y with 80.0 (0x42a00000); a rise above 0.8 (_DAT_00892084) is probed again from y */
  PROBE_UP: 15, PROBE_DY: 2, PROBE_DY_FAR: 80, MAX_RISE: hexf(0x3f4ccccd),
  /** the start parameter of the buggy on the CARBUT path (0x3ca3d70a); the snakes' (0x3a83126f on CARBUT, 0x3b449ba6 on SNAKEPOSL, 0 on SNAKEPOSR); the carts' (0, 0x3b83126f, 0x3be56042 on cartpos1) */
  START_T: hexf(0x3ca3d70a), SNAKE_T: [hexf(0x3a83126f), hexf(0x3b449ba6), 0] as readonly number[], CRT_T: [0, hexf(0x3b83126f), hexf(0x3be56042)] as readonly number[],
  /** the camera: the target 16 (_DAT_0091c728) behind the buggy, the eye 32 (_DAT_0091c72c) further on, 5 (_DAT_0091c730) above the target; the easing of the yaw 1 / 8 (_DAT_00892090) */
  CAM_BACK: 16, CAM_SPAN: 32, CAM_UP: 5, YAW_EASE: 8, CAM_GROUND: 4, CAM_LIFT: 6,
  /** snakes: spawn wait 3 * (10 - (variant >> 16) / 100) ticks (+0x64 of the buggy's record), speed + 0.1 (_DAT_008920cc) over the buggy, the jump starts when the buggy is within 24 (_DAT_008921a4) ahead of it (z), lateral offsets 0 / -2.4 / +2.4 */
  SPAWN_PER: 3, SNAKE_FASTER: f32(0.1), JUMP_Z: 24, LATERAL: [0, -2.4, 2.4] as readonly number[], SNAKE_PROBE: 8, SNAKE_SCALE: hexf(0x3f400000),
  /** coconuts: 15 slots of 0x54 bytes at +0x64, speed -1.5679 (0xbfc8b439) along the gun's forward, life 500 time units, the time runs 8 per tick, a hit sphere of squared radius 40 (0x28), 50 points, the reload 6 ticks (_DAT_0089228c), the drawn scale 1.5 (0x3fc00000) */
  COCONUTS: 15, COCO_SPEED: hexf(0xbfc8b439), COCO_LIFE: 500, TIME_STEP: 8, HIT_R2: 40, HIT_SCORE: 50, RELOAD: 6, COCO_SCALE: hexf(0x3fc00000),
  /** result: the points + gems left x 250 (0xfa), capped at 10000; no gems left: x 150 (0x96) of nothing; bronze below 12 gems (0xc), silver below 18 (0x12), gold from 18 */
  GEM_POINTS: 250, GEM_POINTS_LOST: 150, SCORE_MAX: 10000, SILVER_GEMS: 12, GOLD_GEMS: 18,
  /** PIPP's flinch clip runs to frame 18 (_DAT_0089257c); a turn faster than +-0.6 triggers it; Johnny's lean follows (yaw - eased yaw) * 4 clamped to +-1 */
  FLINCH_FRAME: 18, FLINCH_AT: 0.6, LEAN_K: 4,
} as const;

/** DAT_05d5bcdc: the result of the run (0 running, 1 / 2 the gems are gone, 3 bronze, 4 silver, 5 gold) */
export const RESULT = { RUNNING: 0, NO_GEMS: 1, NO_GEMS2: 2, BRONZE: 3, SILVER: 4, GOLD: 5 } as const;
/** the ride is won with a medal (`2 < DAT_05d5bcdc`) */
export const isWin = (result: number) => result > 2;
/** the medal 0 none .. 3 gold of a result */
export const medalOfResult = (r: number): 0 | 1 | 2 | 3 => (r >= RESULT.GOLD ? 3 : r === RESULT.SILVER ? 2 : r === RESULT.BRONZE ? 1 : 0);
/** the trophy variable (0x93 SWITCH_GME_TROPHY_SSH) and the hi-score (0x4b SWITCH_GME_HISCORE_SSH) */
export const VARS = { HISCORE: 0x4b, TROPHY: 0x93 } as const;

/** FUN_00658c16's end: the score from the points and the gems left, and the result (FUN_00658c16 -> DAT_05d5bd48 / DAT_05d5bcdc) */
export function finalScore(points: number, gems: number): { score: number; result: number } {
  if (gems === 0) return { score: gems * K.GEM_POINTS_LOST + points, result: RESULT.NO_GEMS };
  let score = gems * K.GEM_POINTS + points;
  if (score > K.SCORE_MAX) score = K.SCORE_MAX;
  const result = gems < K.GOLD_GEMS ? (gems < K.SILVER_GEMS ? RESULT.BRONZE : RESULT.SILVER) : RESULT.GOLD;
  return { score, result };
}
/** the banner's variables (FUN_00656372 mode 4): the hi-score, the trophy (1 bronze .. 3 gold), only raised */
export function applyResult(vars: { get(i: number): number; set(i: number, v: number): void }, score: number, result: number) {
  if (vars.get(VARS.HISCORE) < score) vars.set(VARS.HISCORE, score);
  const medal = medalOfResult(result);
  if (medal > 0 && vars.get(VARS.TROPHY) < medal) vars.set(VARS.TROPHY, medal);
}
/** the lines the banner shows and speaks (ids of SSH.str) and their y (FUN_00656372 mode 4 and the switch at the end of mode 2) */
export function resultLines(result: number): { id: string; y: number }[] {
  if (result === RESULT.NO_GEMS || result === RESULT.NO_GEMS2) return [{ id: 'ADSGSS05', y: 200 }, { id: 'ADSGSS06', y: 0x14a }];
  if (result > RESULT.SILVER) return [{ id: 'ADSGSS01', y: 200 }];
  if (result === RESULT.SILVER) return [{ id: 'ADSGSS02', y: 200 }, { id: 'ADSGSS03', y: 0x14a }];
  if (result === RESULT.BRONZE) return [{ id: 'ADSGSS04', y: 200 }];
  return [];
}

/** snake states (p+0x58 + 4 i) */
export const SN = { IDLE: 0, RUN: 1, HIT: 2, ATTACK: 3 } as const;
/** the clips of SNK1.blk (4 clips): 1 hit (13 frames), 2 attack (45), 3 slither (16) */
export const SNAKE_CLIP = { HIT: 1, ATTACK: 2, SLITHER: 3 } as const;
/** the clips of MFIG.blk (4 clips): the crew and the Brickbots */
export const CREW_CLIP = { LEAN: 1, BOT: 2, FLINCH: 3 } as const;

export interface SshSounds {
  /** FUN_004435a0: start a 2D sound (a sound that plays already only refreshes its volume) */
  play(id: number): void;
  /** FUN_004435b0 */
  stop(id: number): void;
  /** FUN_00443600(handle, hz) */
  rate(id: number, hz: number): void;
  /** FUN_004435c0(handle, v): raw volume 0..127 */
  volume(id: number, v: number): void;
  /** FUN_004433f0(handle, pos): a 3D sound at a position (the call also refreshes a loop) */
  play3D(id: number, x: number, y: number, z: number): void;
  /** FUN_004434b0 */
  stop3D(id: number): void;
}
export const silentSounds: SshSounds = { play() {}, stop() {}, rate() {}, volume() {}, play3D() {}, stop3D() {} };
export interface SshRng { int(n: number): number }
export const mathRng: SshRng = { int: (n) => Math.floor(Math.random() * n) };

/** one flying coconut: 0x54 bytes at p+0x64 + 0x54 k: the matrix (position at +0x30), the velocity +0x40, the birth time +0x4c, the flag +0x50 */
export class Coconut {
  active = false;
  /** matrix of the coconut (the gun's world matrix at the moment of the shot, position overwritten) */
  m = new Float32Array(16);
  vel: [number, number, number] = [0, 0, 0];
  birth = 0;
}

/** what the node needs from the zone (the loader / builder / ctor work of the original) */
export interface SshBinding {
  records: readonly GameRecord[];
  parts: PartStore;
  rigs: { MFIG: Blk | null; SNK1: Blk | null };
  /** the paths: the buggy's course (CARBUT), the snakes' (CARBUT / SNAKEPOSL / SNAKEPOSR), the carts' (cartpos1) */
  paths: { cart: PathSpline; snakes: [PathSpline, PathSpline, PathSpline]; crt: PathSpline };
  sounds?: SshSounds;
  rng?: SshRng;
  /** FUN_00439bf8 + FUN_00435a11: speak a line of SSH.str (false while another is playing) */
  say?(id: string): boolean;
  /** helper records that draw the 15 coconuts (the original draws the COCO model with hand-made matrices, FUN_0043f1a0), or none (tests) */
  cocoRecords?: GameRecord[];
}

export function checkRecords(records: readonly GameRecord[]): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(NAMES)) { const r = records[+i]; if (!r || r.name !== n) bad.push(`record ${i}: ${r?.name ?? 'missing'} (expected ${n})`); }
  return bad;
}

/** the matrix's three rotation rows set to length `s` (the draw scale of a record, the original puts it in the model matrix of the draw call) */
function scaleRows(m: Float32Array, s: number) {
  for (let r = 0; r < 3; r++) {
    const l = Math.hypot(m[r * 4], m[r * 4 + 1], m[r * 4 + 2]);
    if (l > 0) { const k = s / l; m[r * 4] *= k; m[r * 4 + 1] *= k; m[r * 4 + 2] *= k; }
  }
}

const frame: PathFrame = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };

/** FUN_00445680(path, t, 0, rec + 0xc, 1): the record's matrix from the curve at t (rows and position, the fourth column zero) */
export function placeOnPath(rec: GameRecord, path: PathSpline, t: number) {
  path.eval(t, frame);
  const m = rec.m;
  m[0] = frame.right[0]; m[1] = frame.right[1]; m[2] = frame.right[2]; m[3] = 0;
  m[4] = frame.up[0]; m[5] = frame.up[1]; m[6] = frame.up[2]; m[7] = 0;
  m[8] = frame.fwd[0]; m[9] = frame.fwd[1]; m[10] = frame.fwd[2]; m[11] = 0;
  m[12] = frame.pos[0]; m[13] = frame.pos[1]; m[14] = frame.pos[2];
}

/** FUN_00447bf0(rec, path): the record's rotation from the curve at the point nearest to it (position kept), yaw +0x50 / pitch +0x4c from the forward row */
export function orientOnPath(rec: GameRecord, path: PathSpline) {
  const t = path.project([rec.x, rec.y, rec.z]);
  path.eval(t, frame);
  const m = rec.m;
  m[0] = frame.right[0]; m[1] = frame.right[1]; m[2] = frame.right[2]; m[3] = 0;
  m[4] = frame.up[0]; m[5] = frame.up[1]; m[6] = frame.up[2]; m[7] = 0;
  m[8] = frame.fwd[0]; m[9] = frame.fwd[1]; m[10] = frame.fwd[2]; m[11] = 0;
  rec.ry = Math.atan2(m[8], m[10]);
  rec.rx = Math.atan2(-m[9], Math.sqrt(m[8] * m[8] + m[10] * m[10]));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Walk: the buggy

export class CartNode implements BehaviourNode {
  readonly kind = 'Walk';
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** p+0x34: the speed, p+0x3c: its top value */
  speed = 0; maxSpeed: number = K.MAX_SPEED;
  /** p+0x24: the wheel angle, p+0x28 / p+0x2c: the turret's yaw / pitch */
  wheel = 0; aimYaw = 0; aimPitch = 0;
  /** p+0x18: the buggy's heading (the record's yaw), p+0x1c: the eased heading the camera uses, p+0x20: its rate, p+0x30: |yaw| of the last tick (the skid test) */
  yaw = 0; smoothYaw = 0; yawRate = 0; prevYaw = 0;
  /** p+0x40: points (50 per snake hit), p+0x48: gems left on the buggy */
  score = 0; gems: number = K.GEMS;
  /** p+0x4c + 4 i: the snakes' waiting timers (1.0 = hit while jumping), p+0x58 + 4 i: their states, p+0x558 + 12 i: where the jump started */
  timers = [0, 0, 0]; states: number[] = [SN.IDLE, SN.IDLE, SN.IDLE];
  saved: [number, number, number][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  /** p+0x64 .. : the coconuts, p+0x57c: the time that runs 8 per tick, p+0x580: the reload counter, p+0x584: Pippin flinches, p+0x598: the stage of the sound triggers */
  coconuts: Coconut[] = Array.from({ length: K.COCONUTS }, () => new Coconut());
  time = 0; reload = 0; flinch = false; stage = 0;
  /** DAT_05d5bcdc / DAT_05d5bd48: the result and the final score of the run */
  result = 0; finalScore = 0;
  /** the HUD globals DAT_05d5bce8 / DAT_05d5bd44 (FUN_00658818) */
  hudScore = 0; hudGems = 0;
  /** where a crosshair would sit (FUN_0065817c): computed on demand by `crosshair()` */
  ticks = 0;
  /** diagnostics: what happened (snake jumped, gem stolen, snake hit ...), newest last */
  log: string[] = [];

  private b: SshBinding | null = null;
  private snd: SshSounds = silentSounds;
  private rng: SshRng = mathRng;
  private rec: readonly GameRecord[] = [];
  bound = false;

  /** the constructor FUN_00659d94 plus what the loader FUN_0066f47d and the zone init FUN_0065760c leave behind: rigs, start places, clips, initial values */
  bind(b: SshBinding) {
    this.b = b; this.rec = b.records;
    this.snd = b.sounds ?? silentSounds; this.rng = b.rng ?? mathRng;
    const R = b.records;
    const bad = checkRecords(R);
    if (bad.length) throw new Error(`z15SSH: record table differs from the builder: ${bad.slice(0, 4).join('; ')}`);
    // the loader: MFIG instances for the crew and the Brickbots, SNK1 for the snakes, clip 1 first (FUN_0043b4e2(rig, 1) + FUN_0043b6a3(anim, 1, 0))
    const mf = b.rigs.MFIG, sn = b.rigs.SNK1;
    const mk = (i: number, rig: Blk | null) => { if (!rig) return; const r = R[i]; r.anim = new AnimInstance(rig); r.anim.start(1, 0); };
    mk(REC.PIPP, mf); mk(REC.JOHN, mf); for (const i of REC.SNAKE) mk(i, sn); for (const i of REC.BBT) mk(i, mf);
    // the constructor: the places on the paths, the clips (Johnny leans from frame 7, Pippin's flinch clip at rest, the Brickbots' clip 2 from 5 / 0 / 7)
    const cart = R[REC.CART];
    placeOnPath(cart, b.paths.cart, K.START_T);
    REC.CRT.forEach((i, k) => placeOnPath(R[i], b.paths.crt, K.CRT_T[k]));
    REC.SNAKE.forEach((i, k) => placeOnPath(R[i], b.paths.snakes[k], K.SNAKE_T[k]));
    R[REC.PIPP].anim?.start(CREW_CLIP.FLINCH, 0);
    R[REC.JOHN].anim?.start(CREW_CLIP.LEAN, 7);
    R[REC.BBT[0]].anim?.start(CREW_CLIP.BOT, 5);
    R[REC.BBT[1]].anim?.start(CREW_CLIP.BOT, 0);
    R[REC.BBT[2]].anim?.start(CREW_CLIP.BOT, 7);
    for (const i of REC.SNAKE) R[i].flags &= ~1;
    this.speed = 0; this.maxSpeed = K.MAX_SPEED;
    this.wheel = 0; this.aimYaw = 0; this.aimPitch = 0; this.yaw = 0; this.smoothYaw = 0; this.yawRate = 0; this.prevYaw = 0;
    this.score = 0; this.gems = K.GEMS;
    this.timers = [0, 0, 0]; this.states = [SN.IDLE, SN.IDLE, SN.IDLE];
    for (const c of this.coconuts) c.active = false;
    this.time = 0; this.reload = 0; this.flinch = false; this.stage = 0;
    this.result = 0; this.finalScore = 0;
    this.hudScore = 0; this.hudGems = this.gems;
    this.log.length = 0;
    this.placeCrew();
    for (const r of R) r.savePrev();
    this.bound = true;
  }

  /** (dev / test shortcut, not in the original) put the buggy at parameter t of its path: browser runs skip most of the 170 second ride with it */
  jumpTo(w: World, t: number) {
    const b = this.b!, cart = this.rec[REC.CART];
    placeOnPath(cart, b.paths.cart, t);
    const gy = w.col.terrainHeight(cart.x, cart.y + K.PROBE_UP, cart.z, K.PROBE_DY);
    if (gy !== NO_GROUND) cart.y = gy;
    orientOnPath(cart, b.paths.cart);
    this.yaw = cart.ry; this.smoothYaw = cart.ry; this.yawRate = 0;
    // the snakes wait 0.02 of the course (about 160 units) behind, as after a leap
    for (let i = 0; i < 3; i++) {
      const sn = this.rec[REC.SNAKE[i]];
      placeOnPath(sn, b.paths.snakes[i], Math.max(0, t - 0.02));
      this.states[i] = SN.IDLE; this.timers[i] = 0; sn.flags &= ~2;
    }
    for (const c of this.coconuts) c.active = false;
    for (const r of this.rec) r.savePrev();
  }

  /** the HUD globals of FUN_00658818 */
  private syncHud() { this.hudScore = this.score; this.hudGems = this.gems; }

  update(w: World, rec: GameRecord): number {
    if (!this.bound || !this.b) return NODE_CONTINUE;      // not bound by the zone game (a stub world): inert
    const b = this.b, dt = w.dt;
    this.ticks++;
    // (the dust emitters p+0x588 / p+0x58c, `trexfeet.par` at the rear wheels, FUN_00442a20(emitter, 2, 1, 1): particles are not drawn)
    // the wheels: all four turn by speed * 0.05236 each (the add sits inside the loop of the original)
    for (let i = 0; i < 4; i++) {
      this.wheel = f32(K.WHEEL_K * this.speed + this.wheel);
      const p = b.parts.get(rec, i);
      if (p) setEulerPos(p, this.wheel, 0, 0, p[12], p[13], p[14]);
    }
    // the end of the ride: the buggy is at the end of the path or past z 7000
    const finished = atPathEnd(b.paths.cart, rec.x, rec.y, rec.z) || rec.z > K.END_Z;
    if (finished) {
      this.snd.rate(SND.WIND, 0x7a80);
      this.speed = f32(this.speed - K.ACCEL * dt);
      if (this.speed < 0) this.speed = 0;
      if (this.speed > 0) this.result = 0;
      else {
        this.snd.stop(SND.WIND);
        const idle = this.states.every((s) => s === SN.IDLE);
        if (idle) { const r = finalScore(this.score, this.gems); this.finalScore = r.score; this.result = r.result; }
        else this.result = 0;
      }
    } else {
      this.engineSounds(rec);
      if (this.maxSpeed <= this.speed) this.speed = this.maxSpeed;
      else this.speed = f32(K.ACCEL * dt + this.speed);
    }
    // the turret: the arrow keys held turn it (2 degrees per tick), with the swivel / tilt sounds
    const held = w.input.held;
    let moved = false;
    if (held & 1) { this.aimYaw = f32(this.aimYaw - K.AIM_STEP * dt); this.snd.play(SND.GUN_SWIVEL); moved = true; }
    if (held & 2) { this.aimYaw = f32(K.AIM_STEP * dt + this.aimYaw); this.snd.play(SND.GUN_SWIVEL); moved = true; }
    if (held & 8) { this.aimPitch = f32(this.aimPitch - K.AIM_STEP * dt); this.snd.stop(SND.GUN_SWIVEL); this.snd.play(SND.GUN_TILT); moved = true; }
    if (held & 4) { this.aimPitch = f32(K.AIM_STEP * dt + this.aimPitch); this.snd.stop(SND.GUN_SWIVEL); this.snd.play(SND.GUN_TILT); moved = true; }
    if (!moved) { this.snd.stop(SND.GUN_SWIVEL); this.snd.stop(SND.GUN_TILT); }
    if (this.aimPitch < K.PITCH_MIN) this.aimPitch = K.PITCH_MIN;
    if (K.PITCH_MAX < this.aimPitch) this.aimPitch = K.PITCH_MAX;
    if (this.aimYaw < K.YAW_MIN) this.aimYaw = K.YAW_MIN;
    if (K.YAW_MAX < this.aimYaw) this.aimYaw = K.YAW_MAX;
    this.updateSnakes(w, rec);
    this.syncHud();                                        // FUN_00658818
    const turret = b.parts.get(rec, 4);
    if (turret) setEulerPos(turret, this.aimPitch, this.aimYaw, 0, turret[12], turret[13], turret[14]);
    if (w.input.pressed & 0x80) this.fire(rec);            // BUTTON_4 (Space) went down
    this.updateCoconuts(w);
    orientOnPath(rec, b.paths.cart);                        // FUN_00447bf0(rec, DAT_05d5bd2c)
    this.updateCarts(w, rec);
    // the buggy drives along its heading
    this.yaw = rec.ry;
    const rot = rotation(0, this.yaw, 0);
    const v = rotate(rot, [0, 0, K.MOVE_LEN]);
    const vx = v[0] * this.speed, vz = v[2] * this.speed;
    rec.x += vx * K.MOVE_K * dt;
    rec.z += vz * K.MOVE_K * dt;
    let gy = w.col.terrainHeight(rec.x, rec.y + K.PROBE_UP, rec.z, K.PROBE_DY);
    if (gy === NO_GROUND) {
      gy = w.col.terrainHeight(rec.x, rec.y, rec.z, K.PROBE_DY_FAR);
      if (gy === NO_GROUND) gy = rec.y;
    }
    if (K.MAX_RISE < gy - rec.y) {
      gy = w.col.terrainHeight(rec.x, rec.y, rec.z, K.PROBE_DY);
      if (gy === NO_GROUND) { gy = w.col.terrainHeight(rec.x, rec.y, rec.z, K.PROBE_DY_FAR); if (gy === NO_GROUND) gy = rec.y; }
    }
    rec.y = gy;
    // the camera's heading eases towards the buggy's
    const target = this.yaw;
    if (this.smoothYaw !== target) this.yawRate = (target - this.smoothYaw) / K.YAW_EASE;
    this.smoothYaw = this.smoothYaw + this.yawRate;
    this.updateCamera(w, rec, gy);
    this.placeCrew(true);
    return NODE_STOP;
  }

  // ------------------------------------------------------------------------------------------------------------------------------------ camera

  /** the end of FUN_00658c16: the target 16 behind the buggy, the eye 32 further on (so 16 ahead, looking back) and 5 above, kept above the ground */
  private updateCamera(w: World, rec: GameRecord, gy: number) {
    const c = w.camera.c;
    const R = rotation(0, this.smoothYaw, 0);
    const back = rotate(R, [0, 0, K.CAM_BACK]);
    const span = rotate(R, [0, 0, K.CAM_SPAN]);
    const tx = rec.x - back[0], ty = rec.y, tz = rec.z - back[2];
    c[3] = tx; c[4] = ty; c[5] = tz;
    c[0] = span[0] + tx; c[1] = K.CAM_UP + ty; c[2] = span[2] + tz;
    // FUN_00422ddc(cam, y, 0): the eye at least 6.4 (DAT_008adbfc) above the buggy, coming down 0.8 per tick when more than 32 above it
    const floor = 6.4 + gy;
    if (floor <= c[1]) { if (32 < c[1] - floor) c[1] -= 0.8; } else c[1] = floor;
    const ground = w.col.terrainHeight(c[0], c[1], c[2], 2);
    const lim = ground + K.CAM_GROUND;
    if (c[1] < lim) c[1] = lim;
    c[1] += K.CAM_LIFT;
    c[6] = 0; c[7] = 1; c[8] = 0;
  }

  // ------------------------------------------------------------------------------------------------------------------------------------ the crew

  /** FUN_00658c16's last part: Johnny (part 6) and Pippin (part 5) sit in the buggy, Pippin flinches in sharp turns, Johnny leans, the Brickbots ride their carts */
  placeCrew(moving = false) {
    const b = this.b!, R = this.rec;
    const cart = R[REC.CART];
    const seat = (rec: GameRecord, part: number) => {
      rec.m.set(cart.m);
      const p = b.parts.get(cart, part);
      if (p) { const t = cart.toWorld([p[12], p[13], p[14]]); rec.m[12] = t[0]; rec.m[13] = t[1]; rec.m[14] = t[2]; }
    };
    seat(R[REC.JOHN], 6);
    seat(R[REC.PIPP], 5);
    if (!moving) return;
    const pip = R[REC.PIPP].anim, joh = R[REC.JOHN].anim;
    if (this.flinch && pip) {
      if (K.FLINCH_FRAME <= pip.frame) { this.flinch = false; pip.start(CREW_CLIP.FLINCH, 0); } else pip.advance(1.0);
    }
    let lean = (cart.ry - this.smoothYaw) * K.LEAN_K;
    if (lean < -1) lean = -1;
    if (1 < lean) lean = 1;
    if (lean < -K.FLINCH_AT || K.FLINCH_AT < lean) this.flinch = true;
    if (joh) { const half = (joh.frameCount - 1) * 0.5; joh.seek(half * lean + half); }
    REC.BBT.forEach((bi, k) => {
      const crt = R[REC.CRT[k]], bot = R[bi];
      bot.m.set(crt.m);
      const p = b.parts.get(crt, 5);
      if (p) { const t = crt.toWorld([p[12], p[13], p[14]]); bot.m[12] = t[0]; bot.m[13] = t[1]; bot.m[14] = t[2]; }
      bot.anim?.advance(1.0);
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------------------ the Brickbot carts

  /** FUN_00657860: while the buggy is between z 3750 and 5020 the three carts ride the cartpos1 path at the buggy's speed (and the train sounds) */
  private updateCarts(w: World, rec: GameRecord) {
    const b = this.b!, R = this.rec, dt = w.dt;
    if (rec.z < 3750 || 5020 <= rec.z) { this.snd.stop3D(SND.TRAIN); return; }
    const c0 = R[REC.CRT[0]];
    this.snd.play3D(SND.TRAIN, c0.x, c0.y, c0.z);
    for (const i of REC.CRT) {
      const crt = R[i];
      const fy = Math.trunc(crt.y);
      orientOnPath(crt, b.paths.crt);
      const rot = rotation(0, crt.ry, 0);
      const v = rotate(rot, [0, 0, K.MOVE_LEN]);
      crt.x += v[0] * this.speed * K.MOVE_K * dt;
      crt.z += v[2] * this.speed * K.MOVE_K * dt;
      let gy = w.col.terrainHeight(crt.x, crt.y, crt.z, 4);
      if (gy === NO_GROUND) gy = fy;
      crt.y = gy;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------------ sounds

  /** FUN_0065888a(node, pitch, yaw): fountain, ambience, the engine's rate by the slope, skids by the heading change, the sounds of the course (z stages) */
  private engineSounds(rec: GameRecord) {
    const fo = this.rec[REC.FOUNTAIN];
    this.snd.play3D(SND.FOUNTAIN, fo.x, fo.y, fo.z);
    this.snd.play(SND.AMBIENT);
    const u = (rec.rx + hexf(0x3e32b884)) / hexf(0x3eb2b884);
    let rate = Math.trunc(0x7a80 + 0x7e54 * u);
    if (rate < 0x7a80) rate = 0x7a80; else if (rate > 0xf8d4) rate = 0xf8d4;
    this.snd.rate(SND.ENGINE, rate);
    this.snd.play(SND.ENGINE);
    this.snd.volume(SND.WIND, Math.trunc(80 - u * 80));
    this.snd.rate(SND.WIND, rate);
    this.snd.play(SND.WIND);
    const ay = Math.abs(rec.ry);
    const d = Math.abs(this.prevYaw - ay);
    if (d > 0.1) this.snd.play(SND.SKID_LARGE);
    else if (d > 0.06) this.snd.play(SND.SKID_SMALL);
    this.prevYaw = ay;
    const z = rec.z;
    if (z > 4402 && this.stage === 0) { this.snd.play(SND.UNDER_TRACK); this.stage = 1; }
    if (z > 4813 && this.stage === 1) { this.snd.play(SND.UNDER_TRACK); this.stage = 2; }
    if (z > 6166 && this.stage === 2) { this.snd.play(SND.OVER_STUDS); this.stage = 3; }
    if (z > 6276 && this.stage === 3) { this.snd.stop(SND.OVER_STUDS); this.stage = 4; }
    if (z > 6320 && this.stage === 4) { this.snd.play(SND.OVER_STUDS); this.stage = 5; }
    if (z > 6407 && this.stage === 5) { this.snd.stop(SND.OVER_STUDS); this.stage = 6; }
  }

  private say(id: string) { this.b?.say?.(id); }

  // ------------------------------------------------------------------------------------------------------------------------------------ the snakes

  /** FUN_00657a30(node, rec): the three snakes. IDLE waits, RUN follows its path faster than the buggy, ATTACK leaps at the buggy, HIT plays the hit clip */
  private updateSnakes(w: World, rec: GameRecord) {
    const R = this.rec, dt = w.dt, b = this.b!;
    let diff = 10 - Math.trunc((rec.variant >> 16) / 100);
    if (diff < 0) diff = 1;
    const limit = diff * K.SPAWN_PER;
    for (let i = 0; i < 3; i++) {
      const sn = R[REC.SNAKE[i]], anim = sn.anim;
      const px = sn.x, py = sn.y, pz = sn.z;
      const fy = Math.trunc(sn.y);
      if (this.timers[i] === 0) {
        if (this.states[i] === SN.RUN) {
          orientOnPath(sn, b.paths.snakes[i]);
          const v = rotate(rotation(0, sn.ry, 0), [0, 0, K.MOVE_LEN]);
          const k = this.speed + K.SNAKE_FASTER;
          sn.x += k * v[0] * K.MOVE_K * dt;
          sn.z += k * v[2] * K.MOVE_K * dt;
        }
        if (this.states[i] === SN.ATTACK) {
          let dx = (rec.x - sn.x) + K.LATERAL[i];
          let dz = rec.z - sn.z;
          let yaw = Math.atan2(dx, dz);
          if (yaw > Math.PI) yaw -= 2 * Math.PI;
          sn.ry = yaw;
          sn.setEuler(0, yaw, 0, sn.x, sn.y, sn.z);
          let fr = Math.trunc(anim?.frame ?? 0);
          if (fr === 0) fr = 1;
          dx /= fr; dz /= fr;
          sn.x += dx; sn.z += dz;
        }
      }
      let gy = w.col.terrainHeight(sn.x, sn.y, sn.z, K.SNAKE_PROBE);
      if (gy === NO_GROUND) gy = fy;
      sn.y = gy;
      const st = this.states[i];
      if (st === SN.RUN) {
        sn.flags |= 2;
        anim?.advance(1.0);
        this.snd.play3D(SND.SNAKE_MOVE, px, py, pz);
        if (rec.z - sn.z < K.JUMP_Z) {
          anim?.start(SNAKE_CLIP.ATTACK, 0);
          this.saved[i] = [sn.x, sn.y, sn.z];
          this.snd.stop3D(SND.SNAKE_MOVE);
          this.snd.play3D(SND.SNAKE_JUMP, px, py, pz);
          this.states[i] = SN.ATTACK; this.timers[i] = 0;
          this.log.push(`jump ${i}`);
        }
      } else if (st === SN.HIT) {
        if (anim && anim.advance(1.0) !== 0) { this.timers[i] = 0; this.states[i] = SN.IDLE; sn.flags &= ~2; }
      } else if (st === SN.ATTACK) {
        if (anim && anim.advance(1.0) !== 0) {
          if (this.timers[i] === 0 && this.gems > 0) {
            this.snd.play3D(SND.SNAKE_GET_GEM, px, py, pz);
            this.gems--;
            this.log.push(`gem ${i}`);
            const r = this.rng.int(13);
            if (r === 0) this.say('JOHNA'); else if (r === 1) this.say('JOHNC'); else if (r === 2) this.say('ADSGSS10');
          }
          [sn.x, sn.y, sn.z] = this.saved[i];
          this.timers[i] = 0; this.states[i] = SN.IDLE;
          sn.flags &= ~2;
        }
      } else {
        sn.flags &= ~2;
        if (!atPathEnd(b.paths.cart, rec.x, rec.y, rec.z) && rec.z < K.END_Z) {
          this.timers[i] = f32(1.0 * dt + this.timers[i]);
          if (limit < this.timers[i]) {
            this.timers[i] = 0; this.states[i] = SN.RUN;
            anim?.start(SNAKE_CLIP.SLITHER, this.rng.int(10));
            this.log.push(`spawn ${i}`);
          }
        }
      }
      // the snakes are drawn at scale 0.75 (the draw hook FUN_0065a314 sets the model matrix of FUN_004440d0 = 0.75 on the diagonal)
      scaleRows(sn.m, K.SNAKE_SCALE);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------------------ the coconuts

  /** FUN_0065866f(rec, node): fire the first free coconut from the turret (once per reload) */
  private fire(rec: GameRecord) {
    const b = this.b!;
    const part = b.parts.get(rec, 4);
    if (this.reload !== 0 || !part) return;
    for (const c of this.coconuts) {
      if (c.active) continue;
      c.active = true;
      this.snd.stop(SND.GUN); this.snd.play(SND.GUN);
      this.reload = f32(this.reload + 1);
      const gun = then(part, rec.m);                       // FUN_0043a9e5(out, rec + 0xc, part 4): the gun's world matrix
      const px = rec.x + part[12], py = rec.y + part[13], pz = rec.z + part[14];
      c.m.set(gun);
      c.m[12] = px; c.m[13] = py; c.m[14] = pz;
      rotate(gun, [0, 0, K.COCO_SPEED], c.vel);
      c.birth = Math.trunc(this.time);
      this.log.push('shot');
      break;
    }
  }

  /** FUN_006582de(node): the coconuts fly, hit snakes that run or leap, and expire after 500 time units */
  private updateCoconuts(w: World) {
    const R = this.rec, dt = w.dt;
    for (let k = 0; k < K.COCONUTS; k++) {
      const c = this.coconuts[k];
      if (!c.active) continue;
      if (this.time <= c.birth + K.COCO_LIFE) {
        c.m[12] = c.vel[0] * 1 * dt + c.m[12];
        c.m[13] = c.vel[1] * 1 * dt + c.m[13];
        c.m[14] = c.vel[2] * 1 * dt + c.m[14];
      } else c.active = false;
      for (let i = 0; i < 3; i++) {
        const sn = R[REC.SNAKE[i]];
        if (this.states[i] !== SN.RUN && this.states[i] !== SN.ATTACK) continue;
        const dx = sn.x - c.m[12], dy = sn.y - c.m[13], dz = sn.z - c.m[14];
        const d2 = Math.trunc(dx * dx + dy * dy + dz * dz);
        if (d2 < K.HIT_R2) {
          const r = this.rng.int(15);
          if (r === 0) this.say('PEPPA'); else if (r === 1) this.say('PIPPC'); else if (r === 2) this.say('ADSGSS13');
          this.score += K.HIT_SCORE;
          this.snd.stop3D(SND.SNAKE_HIT);
          this.snd.play3D(SND.SNAKE_HIT, sn.x, sn.y, sn.z);
          c.active = false;
          if (this.states[i] === SN.RUN) { this.states[i] = SN.HIT; sn.anim?.start(SNAKE_CLIP.HIT, 0); }
          else this.timers[i] = 1;
          this.log.push(`hit ${i}`);
        }
      }
    }
    this.syncCoconutRecords();
    this.time = f32(K.TIME_STEP * dt + this.time);
    if (this.reload !== 0) {
      this.reload = f32(1.0 * dt + this.reload);
      if (K.RELOAD < this.reload) this.reload = 0;
    }
  }

  private wasActive: boolean[] = [];
  /** (port) the helper records that stand for the draw hook's hand-made matrices (FUN_0043f1a0(coconut model, matrix, ...)): shown while the coconut flies */
  private syncCoconutRecords() {
    const rs = this.b?.cocoRecords;
    if (!rs) return;
    for (let k = 0; k < K.COCONUTS; k++) {
      const r = rs[k], c = this.coconuts[k];
      if (!r) continue;
      if (c.active) {
        this.cocoMatrix(k, r.m);
        r.flags |= 2;
        if (!this.wasActive[k]) r.savePrev();
      } else r.flags &= ~2;
      this.wasActive[k] = c.active;
    }
  }

  /** the draw matrix of coconut k: the coconut matrix scaled by 1.5 first (FUN_00659b77: FUN_0043a9e5(out, coconut, scale)) */
  cocoMatrix(k: number, out = new Float32Array(16)): Float32Array {
    const s = buildMatrix(0, 0, 0, 0, 0, 0, K.COCO_SCALE, K.COCO_SCALE, K.COCO_SCALE);
    return then(s, this.coconuts[k].m, out);
  }

  /** FUN_0065817c: the crosshair centre on the 640 x 480 grid, from the buggy's pitch and the turret's yaw / pitch (clamped to the screen like the original) */
  crosshair(rec: GameRecord, W = 640, H = 480): { x: number; y: number } {
    const cx0 = Math.trunc(W >> 1);
    let pitch = rec.rx;
    if (pitch < -Math.PI) pitch += 2 * Math.PI;
    const cy0 = Math.trunc(Math.trunc(H / 4) - (H * pitch) / 3);
    let x = Math.trunc(cx0 + (W * this.aimYaw) / 3);
    let y = Math.trunc(cy0 - (H * this.aimPitch) / 3);
    if (y < 0) y = 0;
    if (x < 0x20) x = 0x20;
    if (x > W - 0x20) x = W - 0x20;
    return { x, y };
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Snake: the inert node of the snake records

export class SnakeNode implements BehaviourNode {
  readonly kind = 'Snake';
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** FUN_0065a2e0: returns 1 (stop) and nothing else */
  update(): number { return NODE_STOP; }
}
