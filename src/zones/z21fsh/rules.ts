// z21FSH "Fishing" (Adventure Island): constants, the fish simulation and the zone's shared state. Pure TypeScript (no DOM): the node tests drive it with scripted
// input (tools/tests/m6-z21FSH.mjs). Ported function by function from the decompile (docs/re/m6/z21FSH.md); addresses are VAs of the NL build:
//   FUN_007061ee  the fish update (swim towards the shoal's way-point follower, bite approach, hooked circling)  -> `fishStep`
//   FUN_00705e00  the bite picker (runs once per frame, after the fish)                                         -> `pickBite`
//   FUN_006f5b50  the way-point follower of a shoal (move one segment, pause, next)                              -> `Follower`
//   FUN_006f48c9 / FUN_006f49b3  the blinking message slots (32)                                                 -> `Popups`
// The nodes (Fishing FSM, Bertha, shoal, rod, switch, fisherman) are in nodes.ts. The original keeps all state in node structs (offsets in the comments).
import type { GameRecord } from '../../game/record.ts';

export const f32 = Math.fround;

/** constructor addresses in the EXE (the `ctor` of the set-up's attaches, docs/re/zone-setup.md) */
export const CTOR = { SWITCH: 0x6f51e6, BERTHA: 0x6f56d0, SPLASH: 0x6f5aa1, SHOAL: 0x6f6034, FISHING: 0x6f8e5a, FISHERMAN: 0x6f937d, ROD: 0x6f9cdc } as const;

/**
 * Record indices (the builder FUN_006f9dd0 lays the records out at `DAT_00983804 + 0x68 * i`; the constructors use byte offsets: BIGB 0x68, WATE 0xd0, RODD 0x208,
 * PEPP 0x270, FSHM 0x2d8, SPLH 0x478, FLOT 0x2018 ...). The names are checked at run time (`checkRecords`).
 */
export const REC = { BIGB: 1, WATE: 2, LAND: 4, RODD: 5, PEPP: 6, FSHM: 7, FSH0: 8, FSH1: 9, FSH2: 10, SPLH: 11, FLOT: 79 } as const;
const REC_NAMES: Record<number, string> = { 1: 'BIGB', 2: 'WATE', 4: 'LAND', 5: 'RODD', 6: 'PEPP', 7: 'FSHM', 8: 'FSH0', 9: 'FSH1', 10: 'FSH2', 11: 'SPLH', 79: 'FLOT' };
export function checkRecords(records: GameRecord[]): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(REC_NAMES)) if (records[+i]?.name !== n) bad.push(`record ${i} is ${records[+i]?.name ?? 'missing'}, expected ${n}`);
  return bad;
}

/** tables of the EXE read at run time (`readTables`): the fishing spots' records (0x92f1a0), the shoal's model records (0x92f1c0), the fish path (0x92f1d0), the fisherman's routes (0x92f720) */
export const TABLE = { SPOTS: 0x92f1a0, SPOT_COUNT: 8, LODS: 0x92f1c0, LOD_COUNT: 3, PATH: 0x92f1d0, PATH_COUNT: 10, ROUTES: 0x92f720 } as const;

/** sound table ids (FUN_006f52a0: 2D loads `FUN_00443580(id)`, 3D loads `FUN_004433b0(id)`; names of the table) */
export const SND = {
  /** 2D (DAT_05d5ca80 / ca6c / cabc / ca9c / ca94 / ca98 / caac / caa4 / caa8 / caa0 / cab0 / ca70 / ca74 / cad0 / ca7c / ca78 / cacc / ca90 / ca84) */
  FISH_CAUGHT: 0x152, LINE_SNAP: 0x154, LOSE_TENSION: 0x155,
  ROD_WIND1: 0x158, ROD_WIND2: 0x159, ROD_WIND3: 0x15a,
  PEPP_REEL1: 0x15f, PEPP_REEL2: 0x160, PEPP_REEL3: 0x161, PEPP_REEL4: 0x162,
  PEPP_CAST: 0x12f, CAST1: 0x130, CAST2: 0x131,
  FISH_REELIN: 0x251, FISH_REELIN2: 0x252, REEL_LOOP: 0x335, CATCH_FISH: 0x15b, CATCH_BERTHA: 0x15c, CAST_STRENGTH: 0x371,
  /** 3D (DAT_05d5cac0 / ca88 / cab8 / cab4 / cac4 / cac8 / ca8c / ca68) */
  WRIGGLE: 0x151, ESCAPE: 0x153, BOB1: 0x156, BOB2: 0x157, SPLASH1: 0x134, SPLASH2: 0x135, BITES: 0x333, STRIKE: 0x136,
} as const;
export const SOUNDS_2D = [SND.FISH_CAUGHT, SND.LINE_SNAP, SND.LOSE_TENSION, SND.ROD_WIND1, SND.ROD_WIND2, SND.ROD_WIND3, SND.PEPP_REEL1, SND.PEPP_REEL2, SND.PEPP_REEL3, SND.PEPP_REEL4,
  SND.PEPP_CAST, SND.CAST1, SND.CAST2, SND.FISH_REELIN, SND.FISH_REELIN2, SND.REEL_LOOP, SND.CATCH_FISH, SND.CATCH_BERTHA, SND.CAST_STRENGTH];
export const SOUNDS_3D = [SND.WRIGGLE, SND.ESCAPE, SND.BOB1, SND.BOB2, SND.SPLASH1, SND.SPLASH2, SND.BITES, SND.STRIKE];

/** buttons (InputMapper bits): 1 left, 2 right, 4 up, 8 down, 0x10 Ctrl, 0x40 Shift */
export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CAST: 0x10, ACTION: 0x40 } as const;

/** Pepper's clips in MFIG.blk (FUN_0043b6a3(anim, clip, 0)) */
export const CLIP = { WALK: 0xd, IDLE: 0x3a, STAND: 0x43, HOLD_UP: 0x7f, PULL: 0x80, CAST: 0x81, CAST_THROW: 0x82, WAIT: 0x83, STRIKE: 0x84 } as const;
/** BIGB.blk / RODD.blk: the clip a ctor starts (`FUN_0043b6a3(anim, 1, 0)`) */
export const FISH_CLIP = 1;

/** the Fishing FSM states (node + 0x84) */
export const ST = {
  DONE: 0, WALK_IDLE: 1, TURN_TO_SPOT: 2, WALK_TO_SPOT: 3, TURN_TO_LAKE: 4, ARRIVED: 5, READY: 6, CAST: 7, WAIT: 8, REEL: 9, RETRIEVE: 10, FIGHT: 11, LANDED: 12, SCORE: 13, END: 14,
} as const;
/** sub-states of the cast (node + 0x94) */
export const CAST = { WINDUP: 0, CHARGE: 1, THROW: 2, FLIGHT: 3, LANDED: 4 } as const;

/** constants (named after the use; the EXE address of the float / int immediate in the comment) */
export const K = {
  /** FUN_006f3eec: the lake centre (DAT_05d5c4d0.. never written: 0), the spot = pole + 4 (0x892080) towards the centre + 4 sideways */
  LAKE_CENTRE: [0, 0, 0] as const, SPOT_STEP: 4.0,
  /** FUN_006f4bfa: walking pace 0.8 per tick (0x892084), turn 0.1 rad per tick (0x8920cc) */
  WALK_STEP: f32(0.8), TURN_STEP: f32(0.1),
  /** FUN_006f6e2b state 6: aim offset limit +-0.6 (0x89213c / 0x89214c), step 0.04 (0x8925ec) */
  AIM_LIMIT: f32(0.6), AIM_STEP: f32(0.04),
  /** state 7: cast animation rate 1.0, the charge starts at frame 56 (0x89286c), the power meter 0..60 (0x892388), good casts 10 (0x892060) .. 60 */
  CAST_FRAME: 56, POWER_MAX: 60, POWER_MIN: 10,
  /** the bobber's flight: 64 ticks (0x42800000), starts 6 (0x89228c) above Pepper, y = 0 (water), gravity 0.03125 (0x89270c) per tick, divisor 64 (0x892868 = 1/64) */
  FLIGHT_TICKS: 64, LAUNCH_LIFT: 6, GRAVITY: 0.03125, INV_FLIGHT: 0.015625, SPLASH_LIFT: f32(0.01),
  /** terrain probe distance above the bobber (0x41200000 = 10) */
  PROBE: 10,
  /** the lure value after landing / while reeling (0x3f4ccccd = 0.8), its decay per tick (0x8922c0 = 0.02) */
  LURE: f32(0.8), LURE_DECAY: f32(0.02),
  /** the bobber's bob: phase step 0.2 per tick (0x8920f0) */
  BOB_STEP: f32(0.2),
  /** state 8 / 9: the bobbing sound every 150 ticks (0x95 < counter), reel speed 0.4 (0x892118) per tick, arrival distance 8 (0x892090), the taut value 0.9 (0x3f666666) */
  BOB_SOUND_TICKS: 149, REEL_SPEED: f32(0.4), ARRIVE_DIST: 8, TAUT: f32(0.9), TAUT_DECAY: f32(0.1),
  /** bite: the fish has 60 ticks when the last cast forced it, 30 otherwise (0x42700000 / 0x41f00000); the approach takes 50 steps (0x892... 0.02) */
  BITE_TICKS_FORCED: 60, BITE_TICKS: 30, APPROACH_STEPS: 50, APPROACH_STEP: 0.02, BITE_DIST2: 8,
  /** fight: start tension 30 (0x41f00000), +4 (0x892080) per tick while reeling, the weight relief (20 - weight) * 0.04, ok between 10 and 60, landed when closer than 12 (0x892024) */
  TENSION_START: 30, TENSION_REEL: 4, TENSION_MIN: 10, TENSION_MAX: 60, TENSION_RELIEF: f32(0.04), LAND_DIST: 12, TENSION_WEIGHT: 20,
  /** the taut bobber value in the fight (0x40800000) */
  TAUT_FIGHT: 4,
  /** score: 78 points per kg (0x429c0000); bronze < 4000, silver < 7000 for the trophy (immediates 4000 / 7000), the banner's thresholds 0xfa1 / 0x1b59 */
  POINTS_PER_KG: 78, TROPHY_SILVER: 4000, TROPHY_GOLD: 7000, BANNER_SILVER: 4001, BANNER_GOLD: 7001,
  /** casts at the start (0x14), the end countdown (0x5a ticks) */
  CASTS: 20, END_TICKS: 90,
  /** the score display counts up by up to 20 (0x41a00000) per tick */
  SCORE_STEP: 20,
  /** FUN_00705c64: the HUD gauge range (0xe128 = 0, 0xe130 = 0x42700000 = 60) */
  GAUGE_MAX: 60,
  /** camera presets (FUN_006f6cd9 / FUN_006f6d25): offset (0, y, z) in Pepper's frame and the height of the look-at above her; the DAT_00987660 != 0 variant (14.4, -12.8) is not used */
  CAM_A: { y: 8, z: -8, h: 6 }, CAM_B: { y: f32(7.2), z: -12, h: f32(5.6) }, CAM_EASE: 0.25,
  /** the rod's bend: target frames 9 / 18 (0x41900000) / 29 (0x41e80000), the spring 0.02 (0x8922c0), the damping 0.9 (0x892108) */
  ROD_BEND: 9, ROD_BEND_REEL: 18, ROD_BEND_FIGHT: 29, ROD_SPRING: f32(0.02), ROD_DAMP: f32(0.9),
  /** the rod's base: Pepper's bone 14 + (0.15, -1, 0.5) (0x92f798..) and, while casting, the rod's local matrix (0, 1.7, 0) at (0, -0.5, 0) */
  HAND_BONE: 14, ROD_BASE: [f32(0.15), -1, 0.5] as const, ROD_CAST_YAW: f32(1.7), ROD_CAST_ROT: [0, f32(1.7), 0] as const, ROD_CAST_POS: [0, -0.5, 0] as const,
  /** every model of the shoal and Bertha is drawn at half size (the pre-transform FUN_004440d0 with 0.5 on the diagonal) */
  MODEL_SCALE: 0.5,
  /** the shoal: 15 fish (arg 0xf), 3 model LODs (arg 3), path of 10 points, ticks per way-point leg 150 (0x43160000); Bertha: 80 (0x42a00000), starts at point 5 */
  FISH: 15, SHOAL_LEG: 150, BERTHA_LEG: 80, BERTHA_START: 5, BERTHA_WEIGHT: 19, FISH_WEIGHT_MIN: 2, FISH_WEIGHT_MAX: 17, LOD1: 6, LOD2: 13,
  /** the fisherman's place (FUN_006f937d: 0x4252cccd, 0x406a3d71, 0xc215ae14) */
  FISHERMAN_HOME: [Math.fround(52.7), Math.fround(3.66), Math.fround(-37.42)] as const,
  /** the fish: spread of the start (16.0 = 0x41800000), the fish keep below the surface (-0.5), heading ease, stop / snap distances 4 / 6 / 12, speed */
  SPREAD: 16, MAX_Y: -0.5, SWAY: f32(0.8), WEIGHT_STEP: f32(0.01), STOP_DIST: 4, AIM_DIST: 6, SNAP_DIST: 12,
} as const;

/** FUN_006f9dd0's message popups: the `fsh.str` ids (DAT_0092f5a8..) */
export const MSG = { TOO_HARD: 'FSH1', TANGLED: 'FSH2', GOOD_CAST: 'FSH3', STRIKE: 'FSH4', SLACK: 'FSH7', SNAPPED: 'FSH6' } as const;
/** speech lines: the random line after a normal catch (FUN_006f6e2b state 0xc: ftol(rand) % 7, the table of the jump at 0x6f8d8b) and Bertha's by score */
export const CATCH_LINES = ['FSHMA', 'FSHMC', 'ADSGFI09', 'ADSGFI10', 'ADSGFI11', 'ADSGFI12', 'ADSGFI13'] as const;

export const TWO_PI = f32(6.2831855), PI = f32(3.1415927);

export interface Rng { next(): number }
export const mathRng: Rng = { next: () => Math.random() };
/** a deterministic generator for tests */
export function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return { next() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; } };
}
/** FUN_004388ae(max): a float in [0, max) */
/** `FUN_004388ae(max)`: `fild r; fdiv 32767.0f; fmul max; fst` in the 24-bit x87: both operations round (see src/zones/z14OSD/exact.ts rand32) */
export const randF = (r: Rng, max: number) => f32(f32(r.next()) * f32(max));
/** `ftol(FUN_004388ae(max))` */
export const randI = (r: Rng, max: number) => Math.trunc(f32(f32(r.next()) * f32(max)));

/**
 * FUN_0043cf57: length of v, v normalised in place with the executable's float32 stores (l = (float)(x x + y y + z z), len = (float)sqrt(l), k = (float)(1 / sqrt(l)), v[i] = (float)(k v[i]));
 * a zero vector stays zero (length 0). FUN_0043cec0 is the same without the length.
 */
export function lengthNormalize(v: number[]): number {
  const l = f32(f32(f32(v[0] * v[0]) + f32(v[1] * v[1])) + f32(v[2] * v[2]));      // 24-bit x87: every operation rounds
  if (l === 0) return 0;
  const sq = f32(Math.sqrt(l)), k = f32(1 / sq);      // the CRT's sqrt rounds to 24 bits too (engine-m1.md 8.1)
  v[0] = f32(k * v[0]); v[1] = f32(k * v[1]); v[2] = f32(k * v[2]);
  return f32(sq);
}
/** FUN_0043cec0: normalise in place */
export function normalize(v: number[]) { lengthNormalize(v); }

// ------------------------------------------------------------------------------------------------ message popups (FUN_006f48c9 / FUN_006f49b3)

/** one of the 32 blinking message slots at DAT_05d5c4e0 (0x2c bytes each) */
export interface Popup { active: boolean; id: string; text: string | null; on: number; off: number; count: number; visible: boolean; timer: number; x: number; y: number }

export class Popups {
  slots: Popup[] = Array.from({ length: 32 }, () => ({ active: false, id: '', text: null, on: 0, off: 0, count: 0, visible: false, timer: 0, x: 0, y: 0 }));
  /** FUN_006f4890: all slots free */
  clear() { for (const s of this.slots) s.active = false; }
  /** FUN_006f48c9(text, count, on, off, x, y): the first free slot; it starts visible. `id` is a message id of fsh.str, or literal text when `literal` */
  add(id: string, count: number, on: number, off: number, x: number, y: number, literal = false) {
    const s = this.slots.find((p) => !p.active);
    if (!s) return;
    // the slot is 0x2c bytes: the text is strcpy'd to +4 (12 bytes) and the numbers that follow (on at +0x10 ...) are stored afterwards, so a text of 12 or more characters
    // keeps its first 12 and then the low byte of `on` as its 13th character (the catch popup "13kg = 1014pts" reads "13kg = 1014p" + LF; FUN_006f48c9)
    const str = literal ? id : id;
    const shown = str.length >= 12 ? str.slice(0, 12) + ((on & 0xff) !== 0 ? String.fromCharCode(on & 0xff) : '') : str;
    s.id = shown; s.text = literal ? shown : null; s.on = on; s.off = off; s.count = count; s.visible = true; s.timer = on; s.x = x; s.y = y; s.active = true;
  }
  /** FUN_006f49b3 (called every tick from the switch node's update): hidden phase counts `off` down, then shows again (one repeat used up); visible phase counts `on` down */
  tick(dt: number) {
    // FUN_006f49b3 draws a visible slot's text (FUN_00439c6f) BEFORE it counts the slot's timer down: the frame shows the slots that were visible at the start of this tick
    this.drawn = this.shown().map((p) => ({ ...p }));
    for (const s of this.slots) {
      if (!s.active) continue;
      if (!s.visible) {
        s.timer -= 1 * dt;
        if (s.timer <= 0) { s.visible = true; s.timer = s.on; s.count -= 1; if (s.count < 1) s.active = false; }
      } else {
        s.timer -= 1 * dt;
        if (s.timer <= 0) { s.visible = false; s.timer = s.off; }
      }
    }
  }
  /** the slots the last tick drew (visible at its start): what the 2D layer of the frame shows */
  drawn: Popup[] = [];
  /** slots visible now */
  shown(): Popup[] { return this.slots.filter((s) => s.active && s.visible); }
}

// ------------------------------------------------------------------------------------------------ the way-point follower (FUN_006f5b50)

/**
 * The ghost the fish chase: a point that moves along a closed path of way-points, one leg per `leg` ticks, then pauses for `leg` ticks. The original keeps it in the
 * node struct at +0x18 (ints from, to, moving, count, timer, reset timer, speed factor, points ptr, step vector, position).
 */
export class Follower {
  from: number; to: number; moving = false; readonly count: number;
  timer: number; readonly reset: number; readonly speed: number;
  readonly points: number[][];
  step: [number, number, number] = [0, 0, 0];
  pos: [number, number, number];
  constructor(points: number[][], start: number, leg: number) {
    this.points = points; this.count = points.length;
    this.from = start; this.to = start; this.timer = leg; this.reset = leg; this.speed = f32(1 / leg);
    this.pos = [points[start][0], points[start][1], points[start][2]];
  }
  /** one tick (float32 stores like the original: `1.0 * dt` is a float product) */
  tick(dt: number) {
    const k = f32(1 * dt);
    if (!this.moving) {
      this.timer = f32(this.timer - k);
      if (this.timer <= 0) {
        this.moving = true;
        this.from = this.to;
        this.to += 1;
        if (this.count <= this.to) this.to = 0;
        const a = this.points[this.from], b = this.points[this.to];
        this.step = [f32(this.speed * f32(b[0] - a[0])), f32(this.speed * f32(b[1] - a[1])), f32(this.speed * f32(b[2] - a[2]))];
        this.timer = this.reset;
      }
    } else {
      this.timer = f32(this.timer - k);
      if (this.timer > 0) {
        this.pos[0] = f32(f32(k * this.step[0]) + this.pos[0]); this.pos[1] = f32(f32(k * this.step[1]) + this.pos[1]); this.pos[2] = f32(f32(k * this.step[2]) + this.pos[2]);
      } else { this.moving = false; this.timer = this.reset; }
    }
  }
}

// ------------------------------------------------------------------------------------------------ fish

/** a fish struct (0xc0 bytes; the shoal's 15 and Bertha's at node + 0x50). `[n]` = float index of the original */
export class Fish {
  /** [0..2] position, [3..5] velocity, [6..8] Euler angles */
  x = 0; y = 0; z = 0; vx = 0; vy = 0; vz = 0; rx = 0; ry = 0; rz = 0;
  /** [9..0xb] axis A of the hooked circle, [0xc..0xe] drift towards Pepper while reeling, [0x12..0x14] the mouth (the line end) */
  ax = 0; ay = 0; az = 0; bx = 0; by = 0; bz = 0; mx = 0; my = 0; mz = 0;
  /** [0x15] swim phase, [0x16] its rate, [0x17] (unused), [0x18] speed, [0x19] drawn y, [0x1a] turn ease */
  phase = 0; phaseRate = 0; speed = 0; drawY = 0; turn = 0; unused17 = 0;
  /** [0x1b] bite timer, [0x1c] distance of the mouth to Pepper (99999 until hooked) */
  biteTimer = 0; dist = 0;
  /** [0x20] approach steps left (int), [0x21] approaching the bait, [0x22..0x24] its step, [0x2c] its yaw rate */
  approachLeft = 0; approaching = false; stepX = 0; stepY = 0; stepZ = 0; yawRate = 0;
  /** [0x25] radius B, [0x26] weight (kg, shrinks while it struggles), [0x27] weight at the start */
  radiusB = 0; weight = 0; weight0 = 0;
  /** [0x28] circle angle, [0x29] its speed, [0x2a] radius A, [0x2b] base radius */
  angle = 0; angleRate = 0; radiusA = 8; radiusBase = 8;
  /** [0x2d] hooked, [0x2e] bite (waiting for the strike), [0x2f] Bertha */
  hooked = false; biting = false; bertha = false;
  /** [0x1f]: the matrix this fish writes (the shoal's own, or Bertha's record matrix) */
  m: Float32Array;
  /** shoal: index 0..14 (the model LOD follows from the weight); Bertha: -1 */
  index = -1;
  constructor(m: Float32Array) { this.m = m; }
  /** FUN_006f5d5e: the per-fish randoms */
  randomise(r: Rng) {
    this.phaseRate = f32(randF(r, 8) / 50);
    this.speed = f32(f32(randF(r, 8) / 50) + f32(0.1));
    this.turn = f32(0.2);
  }
}

/** what the fish code reads of the Fishing node (DAT_05d5ca60) */
export interface FishingView {
  state: number;
  /** +0x98: 0 no bite, 1 a fish bites, 2 it is gone */
  bite: number;
  /** +0xe4: casts left */
  casts: number;
  /** +0x60..0x68: the bobber */
  bx: number; by: number; bz: number;
  /** +0xb4: the lure's strength */
  lure: number;
  /** +0xe8: the hooked fish */
  hooked: Fish | null;
  /** Pepper's record (+0xc4) */
  rec: GameRecord;
}

export interface BitePick { best: number; fish: Fish | null }
export const newPick = (): BitePick => ({ best: 99999, fish: null });

export interface FishEnv {
  fishing: FishingView | null;
  /** DAT_0098383c: buttons held */
  held: number;
  dt: number;
  pick: BitePick;
  buildEuler(m: Float32Array, rx: number, ry: number, rz: number, x: number, y: number, z: number): void;
  /** the hooked fish takes over: (the strike) */
  onHooked?(f: Fish): void;
}

/**
 * FUN_007061ee: one tick of a fish. `ghost` = the follower (the fish swim towards its x / z), `m` = the fish's matrix.
 * Three modes: free swimming (keeps below the surface, heads for the ghost, stops within 4 of it), approaching the bait (moved by the picker, the position y kept),
 * hooked (circles on the line: `A sin a + B sin 2a` around a centre that drifts towards Pepper while DOWN is held).
 * Every store is a float32 store like the original (x87 expressions are evaluated in double and rounded when stored); `0x892084` (the sway 0.8) etc. are float constants.
 */
export function fishStep(f: Fish, ghost: Follower, env: FishEnv) {
  const fishing = env.fishing, dt = env.dt;
  const pep = fishing ? fishing.rec : null;
  let len = -1.0737418e+08;   // local_c: uninitialised (0xcccccccc) unless the free branch ran
  const px = pep ? pep.m[12] : 0, py = pep ? pep.m[13] : 0, pz = pep ? pep.m[14] : 0;
  if (!f.hooked) {
    if (!f.approaching) {
      const s = Math.sin(f.phase);
      f.drawY = f32(f32(f32(s * 1.0) * K.SWAY) + f.y);       // 0x892050 = 1.0 (double), 0x892084 = 0.8 (float)
      f.phase = f32(f32(f.phaseRate * dt) + f.phase);
      if (K.MAX_Y < f.drawY) f.drawY = -0.5;     // _DAT_00892568 = -0.5
      const v = [f32(ghost.pos[0] - f.x), 0, f32(ghost.pos[2] - f.z)];   // FUN_0085d... param_2 + 0x2c / 0x34: the follower's x / z
      len = lengthNormalize(v);
      if (K.AIM_DIST < len) {
        const yaw = f32(Math.atan2(v[0], v[2]));
        const rate = f32(f.turn * dt);
        if (K.SNAP_DIST <= len) f.ry = yaw; else f.ry = f32(f32(f32(yaw - f.ry) * rate) + f.ry);
      }
    }
    env.buildEuler(f.m, f.rx, f.ry, f.rz, f.x, f.drawY, f.z);
    f.vx = f.m[8]; f.vy = f.m[9]; f.vz = f.m[10];
    const sp = f32(f.speed * dt);
    if (len <= K.STOP_DIST) { f.vx = 0; f.vy = 0; f.vz = 0; }
    else { f.vx = f32(sp * f.vx); f.vy = f32(sp * f.vy); f.vz = f32(sp * f.vz); }
    f.x = f32(f.x + f.vx); f.y = f32(f.y + f.vy); f.z = f32(f.z + f.vz);
    if (f.biting) { f.mx = f.x; f.my = f.y; f.mz = f.z; }
  } else if (fishing && fishing.bite === 2) {
    f.hooked = false;
  } else {
    // hooked: circle on the line
    f.angle = f32(f32(f.angleRate * dt) + f.angle);
    // 24-bit x87: `fmul qword 1.0` rounds the CRT's sin / cos result to a float before it is multiplied by the radius
    const sa = f32(Math.sin(f.angle)), sb = f32(Math.sin(f32(f.angle + f.angle)));
    const tA = f32(f.radiusA * sa), tB = f32(f.radiusB * sb);
    const o1 = [f32(tA * f.ax), f32(tA * f.ay), f32(tA * f.az)], o2 = [f32(tB * f.bx), f32(tB * f.by), f32(tB * f.bz)];
    if (TWO_PI < f.angleRate) f.angleRate = f32(f.angleRate - TWO_PI);
    // (the asm stores the first sum (the sin term + the centre) before adding the second term: two roundings, the decompile shows one expression)
    const mx = f32(f32(o1[0] + f.x) + o2[0]), my = f32(f32(o1[1] + f.y) + o2[1]), mz = f32(f32(o1[2] + f.z) + o2[2]);
    if ((env.held & BTN.DOWN) !== 0) { f.x = f32(f.x + f.bx); f.y = f32(f.y + f.by); f.z = f32(f.z + f.bz); }
    f.mx = mx; f.my = my; f.mz = mz;
    const ca = f32(Math.cos(f.angle)), cb = f32(Math.cos(f32(f.angle + f.angle)));
    const cA = f32(f.radiusA * ca), cB = f32(f.radiusB * cb);
    // both products are stored as float32 before they are added (asm 0x7064ad..0x7064e9)
    const h = [f32(f32(cA * f.ax) + f32(cB * f.bx)), f32(f32(cA * f.ay) + f32(cB * f.by)), f32(f32(cA * f.az) + f32(cB * f.bz))];
    normalize(h);
    // right = up x heading (up = (0, 1, 0))
    const r = [f32(1 * h[2] - 0 * h[1]), f32(0 * h[0] - 0 * h[2]), f32(0 * h[1] - 1 * h[0])];
    normalize(r);
    const m = f.m;
    m[8] = h[0]; m[9] = h[1]; m[10] = h[2]; m[4] = 0; m[5] = 1; m[6] = 0; m[0] = r[0]; m[1] = r[1]; m[2] = r[2];
    m[13] = my; m[12] = mx; m[14] = mz;
    if (pep) {
      const dx = f32(f.mx - px), dy = f32(f.my - py), dz = f32(f.mz - pz);
      f.dist = f32(Math.sqrt(f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz))));      // the asm sums x, y, z (the decompile shows z, y, x); 24-bit x87: every operation rounds
    }
    const a = f32(f.dist * 0.015625), b = f32(f.dist * 0.0625);       // 0x892868 = 1/64, 0x8923cc = 1/16
    f.radiusA = f32(f.radiusBase * a); f.radiusB = f32(f.radiusBase * b);
    if (2.0 < f.weight) f.weight = f32(f.weight - f32(K.WEIGHT_STEP * dt));              // _DAT_00892028 = 2.0, 0x892030 = 0.01 (float)
  }
  if (fishing) {
    if (f.biting) {
      if (fishing.state === ST.FIGHT) {
        // the strike: the fish is hooked and circles on the line
        f.biting = false; f.hooked = true;
        fishing.hooked = f;
        f.mx = f.x; f.my = f.y; f.mz = f.z;
        fishing.bx = f.mx; fishing.by = f.my; fishing.bz = f.mz;
        const d = [f32(px - fishing.bx), f32(py - fishing.by), f32(pz - fishing.bz)];
        const a = [f32(d[1] * 0 - d[2] * 1), f32(d[2] * 0 - d[0] * 0), f32(d[0] * 1 - d[1] * 0)];
        normalize(a);
        f.ax = a[0]; f.ay = a[1]; f.az = a[2];
        f.angleRate = f32(0.1);
        f.bx = f32(d[0] * K.WEIGHT_STEP); f.by = f32(d[1] * K.WEIGHT_STEP); f.bz = f32(d[2] * K.WEIGHT_STEP);
        env.onHooked?.(f);
      } else {
        f.biteTimer = f32(f.biteTimer - 1 * dt);
        if (f.biteTimer <= 0) { f.biting = false; f.approaching = false; fishing.bite = 2; }
      }
    }
    if (fishing.bite === 0 && fishing.state === ST.WAIT) {
      const dx = f32(f.x - fishing.bx), dy = f32(f.y - fishing.by), dz = f32(f.z - fishing.bz);
      const metric = f32(f32(f32(f32(dx * dx) + f32(dy * dy)) + f32(dz * dz)) / f32(1 + fishing.lure));      // the asm sums x, y, z
      if (metric < env.pick.best) { env.pick.fish = f; env.pick.best = metric; }
    }
  }
}

export interface PickHooks {
  /** FUN_006f48c9(FSH4 ...): the strike message; FUN_004433f0(FISH_BITES, bobber) */
  struck(): void;
}

/**
 * FUN_00705e00: once per frame after all fish. With no casts left the nearest fish is forced to the bait (it swims there in 50 steps and bites); otherwise the nearest
 * fish within distance^2 / (1 + lure) < 8 bites at once. The picker then clears itself.
 */
export function pickBite(fishing: FishingView | null, pick: BitePick, hooks: PickHooks, dt: number) {
  if (fishing && fishing.bite === 0) {
    const c = pick.fish;
    if (fishing.casts === 0 && c) {
      if (!c.approaching) {
        c.approaching = true;
        // asm 0x705e92..0x705f94: the differences are float32 stores, the step multiplies them by the DOUBLE 0.02 (0x8921b8); the yaw is the atan2 of the (x, z) difference NORMALISED in place by FUN_0043cf57
        const ddx = f32(fishing.bx - c.x), ddy = f32(fishing.by - c.y), ddz = f32(fishing.bz - c.z);
        c.stepX = f32(ddx * K.APPROACH_STEP); c.stepY = f32(ddy * K.APPROACH_STEP); c.stepZ = f32(ddz * K.APPROACH_STEP);
        c.approachLeft = K.APPROACH_STEPS;
        const nv = [f32(fishing.bx - c.x), 0, f32(fishing.bz - c.z)];
        lengthNormalize(nv);
        const yaw = f32(Math.atan2(nv[0], nv[2]));
        c.yawRate = f32(f32(yaw - c.ry) * K.AIM_STEP);   // _DAT_008925ec
      } else if (c.approachLeft < 1) {
        hooks.struck();
        fishing.bite = 1;
        c.biting = true; c.biteTimer = K.BITE_TICKS_FORCED;
        fishing.hooked = c;
        c.mx = c.x; c.my = c.y; c.mz = c.z;
        c.dist = 99999;
      } else {
        if (25 < c.approachLeft) c.ry = f32(f32(c.yawRate * dt) + c.ry);
        c.x = f32(c.x + c.stepX); c.y = f32(c.y + c.stepY); c.z = f32(c.z + c.stepZ);
        c.approachLeft -= 1;
      }
    } else if (pick.best < K.BITE_DIST2) {
      hooks.struck();
      fishing.bite = 1;
      c!.biting = true; c!.biteTimer = K.BITE_TICKS;
      fishing.hooked = c;
      c!.mx = c!.x; c!.my = c!.y; c!.mz = c!.z;
      c!.dist = 99999;
    }
  }
  pick.best = 99999; pick.fish = null;
}
