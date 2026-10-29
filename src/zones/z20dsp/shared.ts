// What the behaviour nodes of z20DSP share (the original's globals DAT_05d5c0xx of Init.c): the track spline, the replay buffer, the whirlwind push accumulators,
// the sound ids, the speech hook and a deterministic random source. The zone module (src/zones/z20DSP.ts) fills it in; tests build their own.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { TrackSpline } from './spline.ts';
import { ReplayBuffer } from './replay.ts';

/**
 * FUN_0043ce45(pos, dy) with the ground record set to LAND (FUN_004425e0(DAT_00983804 + 0x138) around the call, as the nodes do): the terrain height under (x, z), a ray of 500
 * down from y + dy against the LAND record (radius 1.0, skin 0.1, minus 0.1); -1e38 when there is none. The ground record stays unset outside those calls (the camera's
 * own FUN_0043ce45 therefore finds nothing).
 */
export function terrain(w: World, x: number, y: number, z: number, dy = 4.0): number {
  const land = w.records[3];
  const h = land ? w.col.rayRecord(land, [x, y + dy, z], [0, -500, 0], 3, 1.0, 0.1) : null;
  return h ? h.point[1] - 0.1 : -1e38;
}

/** record indices of z20DSP (the builder FUN_006c6f40; checked at run time against the names, `checkRecords`) */
export const REC = {
  SKY: 0, LAND: 3, BBT: [4, 5, 6, 7, 8], COW: [9, 10, 11], BIGB: 12, MFIG: 13,
  SCR: [29, 27, 28], CON: [31, 30, 32], WEBR: 34, WEBL: 35, WEFR: 36, WEFL: 37, PEPP: 38,
  RO: [42, 43, 45, 44, 46], SPN: [57, 56], WHRL: 58, TURB: [137, 138, 139, 140, 141, 142], TIME: [143, 144, 145, 146, 147, 148],
} as const;

/** FUN_006bfa9c: the HUD textures of Overlays/z20dsp (`text000..010`): DAT_05d4dd14 = 5 (left, the clock), DAT_05d4dd38 = 4 (right) */
export const HUD_TEX = { CLOCK: 5, TURBO: 4, WRONG_WAY: 7, COUNT_3: 8, COUNT_2: 9, COUNT_1: 10, GAUGE_ICON: 6, BONUS: 5 } as const;

/** sound table ids FUN_006be700 loads (names SND_DSP_*, docs/re/m6/z20DSP.md section 9) */
export const SND = {
  IDLE: 0x9b, ENGINE: 0x9c, TWISTER: 0x9d, HONK3: 0x9e, HONK1: 0x9f, BUMP1: 0xa1, BUMP2: 0xa2, TURBO: 0xa3, BONUS: 0xa4, CRASH: 0xa5, SHRINK: 0xa6, ENLARGE: 0xa7,
  PICKEDUP: 0xa8, RUMBLE: 0xa9, JUMP: 0xaa, TIMERUN: 0xab, TIMEUP: 0xac, FISHAIR: 0xad, FISHFLIP: 0xae, FISHSPLASH: 0xaf, UFO: 0xb0, LROCK1: 0xb1, LROCK2: 0xb2,
  HONK2: 0xb3, CACTUS: 0xb4, COW1: 0xb5, COW2: 0xb6, RROCK1: 0xb7, RROCK2: 0xb8,
} as const;
/** FUN_004433b0 loads: the positional sounds */
export const SOUNDS_3D: readonly number[] = [SND.LROCK2, SND.LROCK1, SND.RROCK2, SND.RROCK1, SND.RUMBLE, SND.TWISTER, SND.UFO];
/** FUN_00443580 loads: the 2D sounds (the engine loop and the one-shots) */
export const SOUNDS_2D: readonly number[] = [
  SND.CACTUS, SND.COW1, SND.COW2, SND.FISHAIR, SND.FISHFLIP, SND.FISHSPLASH, SND.TIMERUN, SND.TIMEUP, SND.HONK1, SND.ENLARGE, SND.PICKEDUP, SND.JUMP, SND.BONUS, SND.TURBO,
  SND.SHRINK, SND.BUMP1, SND.HONK2, SND.HONK3, SND.CRASH, SND.IDLE, SND.BUMP2, SND.ENGINE,
];

/** the sound calls of the nodes: FUN_004435a0 play, FUN_004435b0 stop, FUN_00443600 pitch, FUN_004433f0 (positional) */
export interface DspSounds {
  play(id: number): void;
  stop(id: number): void;
  rate(id: number, hz: number): void;
  play3D(id: number, x: number, y: number, z: number): void;
  stop3D(id: number): void;
}
export const NO_SOUNDS: DspSounds = { play() {}, stop() {}, rate() {}, play3D() {}, stop3D() {} };

/** a sound recorder for node tests */
export class SoundLog implements DspSounds {
  log: string[] = [];
  play(id: number) { this.log.push(`play ${id}`); }
  stop(id: number) { this.log.push(`stop ${id}`); }
  rate(id: number, hz: number) { this.log.push(`rate ${id} ${hz}`); }
  play3D(id: number, x: number, y: number, z: number) { this.log.push(`3d ${id} ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`); }
  stop3D(id: number) { this.log.push(`stop3d ${id}`); }
  count(prefix: string) { return this.log.filter((l) => l.startsWith(prefix)).length; }
}

/** the game's random numbers (FUN_00435c91 + FUN_004388ae seed from the tick count): uniform integers; injectable for tests */
export class DspRng {
  private s: number;
  constructor(seed = 0x1234567) { this.s = seed >>> 0; }
  next(): number { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  int(n: number): number { return Math.min(n - 1, Math.floor(this.next() * n)); }
}

/** the zone-wide state (DAT_05d5c0xx and friends) */
export class DspShared {
  world!: World;
  track!: TrackSpline;
  replay = new ReplayBuffer();
  sounds: DspSounds = NO_SOUNDS;
  rng = new DspRng();
  /** FUN_00439bf8 + FUN_00435a11: speak the zone-table line (false while another line is playing) */
  say: (id: string) => boolean = () => false;
  /** DAT_05d5c078 / 7c / 80: the whirlwind's push on the car, consumed by the next Speedster update */
  push = [0, 0, 0];
  /** DAT_05d5c084: the car's forward speed (the sound / gauge) */
  speedMirror = 0;
  /** DAT_05d5c08c: the race clock mirror */
  clock = 0;
  /** DAT_05d5c098 / 9c / a0: the car's displacement of the last tick */
  delta = [0, 0, 0];
  /** DAT_05d5c0a4: the score the result screen shows (10000 - 3 * ticks) */
  score = 0;
  /** DAT_05d5c0b8: the race was won (var 0x103 != 0) */
  won = false;
  /** DAT_05d4e138: the speed gauge value (0..~0.67) */
  gauge = 0;
  /** DAT_05d4dd60: the clock text "m:ss" of the HUD */
  clockText = '2:30';
  /** rock sound alternation (DAT_05d5c1b8 / 1bc): left / right rock sounds round robin */
  rockL = 0; rockR = 0;
  rec(i: number): GameRecord { return this.world.records[i]; }
  get(v: number): number { return this.world.vars.get(v); }
  set(v: number, x: number) { this.world.vars.set(v, x); }
  /** the model replacement of a smashed cactus (model index 0x7b of the zone's model table); set by the zone module, null = no swap */
  smashedModel: import('../../formats/exe.ts').Model | null = null;
  /** DAT_05d4dd18 / DAT_05d4dd3c: the tints of the left (clock, white while a time bonus runs) and right (turbo) HUD icons (0x7f7f7f = grey) */
  tintLeft = 0x7f7f7f; tintRight = 0x7f7f7f;
  /** Bertha's reaction to the medal (FUN_006c0d09(BIGB, clip)): the BIGB node sets this; null while there is none */
  bertha: { show(clip: number): void } | null = null;
  /** the finish was crossed (state 6 reached) */
  finished = false;
}

/** the zone's game variables (the "SUBGAME: 250..262" block, gamevars.tsv; the names come from FUN_006be930 / the Speedster) */
export const VAR = {
  TURBO: 0xfa, CACTUS: 0xfb, SKID: 0xfc, DUST: 0xfd, BONUS: 0xfe, STATE: 0xff, SPIN: 0x101, SHRINK: 0x102, RESULT: 0x103, RECORD: 0x104, WRONG_WAY: 0x105, REPLAY: 0x106,
  HISCORE: 0x1e, BESTTIME: 0x77, TROPHY: 0xdc,
} as const;
/** the race state of var 0xff: 0 / 1 waiting (intro / help), 2 / 3 / 4 the countdown (30 ticks each, the car is free in 4), 5 racing, 6 finishing, 7 results */
export const STATE = { WAIT: 0, WAIT2: 1, COUNT3: 2, COUNT2: 3, GO: 4, RACE: 5, FINISH: 6, DONE: 7 } as const;
