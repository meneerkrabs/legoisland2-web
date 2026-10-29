// z27TRX "T-Rex Racing" (Adventure Island mini-game): constants of the zone code. Every number is a float / int the executable (NL retail build) keeps in .rdata or as an
// immediate of the functions named in the comments; tools/tests/m6-z27TRX.mjs checks them against the user's own executable (docs/re/m6/z27TRX.md).

/** constructor addresses of the zone's behaviour nodes (the 2nd argument of FUN_00423532 in FUN_0076649a, the extraction's `Attach.ctor`) */
export const CTOR = {
  /** `trex` on PEPP (record 335): the player's rex (FUN_0076adc5, update FUN_0076a39b) */
  TREX: 0x76adc5,
  /** `anim`: TRIC / STEG / BREX spectators (FUN_0076847b, update FUN_00768330) */
  ANIM: 0x76847b,
  /** `fly` on PTRA (record 2): a constructor whose update is empty (FUN_00768188, update FUN_007680c0) */
  FLY: 0x768188,
  /** `bronty` on BRON (record 28): the brontosaurus that roars when the rex passes (FUN_00768015, update FUN_00767e70) */
  BRONTY: 0x768015,
  /** GATE: the two doors of the camp gate (FUN_00767023, update FUN_00766ef0) */
  GATE: 0x767023,
  /** VOLC: the volcano rumble (FUN_007679e2, update FUN_0076776f) */
  VOLC: 0x7679e2,
  /** SLOG: the swinging logs (FUN_00767666, update FUN_007674c0) */
  SLOG: 0x767666,
  /** BLDR: a boulder that drops from the sky when the rex comes near (FUN_00767d2e, update FUN_00767a80) */
  BLDR: 0x767d2e,
  /** EGGS / YOLK: an egg that drops, lands and breaks (FUN_00767386, update FUN_007670e0) */
  EGG: 0x767386,
} as const;

/** game variables (tools/gamevars.tsv): the zone-local `SUBGAME: n` slots 0xfa..0xff and the two totals the win writes */
export const VAR = {
  /** 0xfa: the run phase (0 / 1 waiting, 4 running, 5 arrival run (autopilot or slowing down), 6 final clip, 7 over) */
  PHASE: 0xfa,
  /** 0xfb: a statue / the statue-hit flag of FUN_007692a1 (written, never read by this zone) */
  STATUE: 0xfb,
  /** 0xfc: the volcano the rex is near (FUN_0076776f; written, never read by this zone) */
  VOLCANO: 0xfc,
  /** 0xfd: an egg was hit (FUN_00767295; written only) */
  EGG: 0xfd,
  /** 0xfe: a boulder is falling (FUN_00767a80; written only) */
  BOULDER: 0xfe,
  /** 0xff: the medal 0 .. 3 of the finished run (also the loss: 0) */
  MEDAL: 0xff,
  /** 0x1a SWITCH_GME_TROPHY_TRX */
  TROPHY: 0x1a,
  /** 0x87 SWITCH_GME_HISCORE_TRX */
  HISCORE: 0x87,
} as const;

export const PHASE = { WAIT: 0, WAIT2: 1, RUN: 4, ARRIVE: 5, FINAL: 6, OVER: 7 } as const;

/** the records the zone code addresses by index (byte offsets / 0x68 of FUN_0076649a and FUN_0076b230): checked against the names at run time */
export const REC = { PEPP: 335, DRKR: 336, PTRA: 2, BRON: 28 } as const;

/** FUN_0076adc5: the node's constants (immediates of the constructor) */
export const TREX = {
  /** +0x14 minimum speed (0x3f19999a) */
  MIN_SPEED: 0.6,
  /** +0x18 maximum speed (0x3fb33333) */
  MAX_SPEED: 1.4,
  /** +0x24 speed step per tick while the accelerate key is held (0x3ca3d70a) */
  ACCEL: 0.02,
  /** +0x28 initial lane smoothing (0x3f4ccccd); FUN_00768510 rewrites it every tick */
  LANE_RATE0: 0.8,
  /** +0x3c the clock: 5400 ticks = 180 s (0x45a8c000) */
  CLOCK: 5400,
  /** +0x40 / +0x44 jump launch speed and gravity (0x41e00000 / 0xc2600000) */
  JUMP_V: 28,
  JUMP_G: -56,
  /** the start z of the rex (the record's z, 80 in the builder FUN_0076b230: FUN_0043a5e4(record + 0x8824, 0, 0, 0, 16, 0, 80)) */
  START_Z: 80,
} as const;

/**
 * the buttons of the rex (logical bits of game/input.ts). The code of FUN_00768510 tests `pressed & 0x20` (BUTTON_2, the default key Alt) for the jump (asm 0x768ab6: `and edx, 0x20`) and
 * `pressed & 0x40` (BUTTON_3, Shift) for the roar, while the controls help of TRX.str says `BUTTON_1 Springen` (bit 0x10, the default key Ctrl) for the jump: the original's help text and code
 * disagree (BUTTON_1 is the key the options menu calls "pizza"). The port does what the code does: only bit 0x20 jumps (the differential test m7-z27TRX-emu checks that Ctrl does nothing in both).
 */
export const BUTTON = { JUMP: 0x20, ROAR: 0x40 } as const;

/** FUN_00768510 / FUN_0076a39b: the run */
export const RUN = {
  /** 0x892080: LEFT slows by 4 x the accelerate step */
  BRAKE_FACTOR: 4,
  /** 0x892084: lane smoothing = (1 - 0.5 * speedFraction) * 0.8 */
  LANE_SMOOTH: 0.8,
  /** 0x892090 (8): lane offset step = laneRate * 8 per tick */
  LANE_STEP: 8,
  /** 0x8921f4 (16): lane spacing */
  LANE_WIDTH: 16,
  /** 0x8922b8 (0.0333): time scale of the jump arc, per tick */
  JUMP_T: 0.0333,
  /** 0x8921a4 (24): the rex is carried this far on after a crash clip ends */
  RECOVER_Z: 24,
  /** blink time after a crash 0x42960000 = 75 ticks */
  BLINK_TICKS: 75,
  /** 0x8920f0 (0.2): below this the blink ends visible */
  BLINK_EPS: 0.2,
  /** 0x892908 (4112): the arrival run starts; 0x892904 (4336): the camp (finish) */
  ARRIVAL_Z: 4112,
  FINISH_Z: 4336,
  /** 0x892034 (0.05): the slowing down of the arrival run after the clock ran out */
  COAST_DECEL: 0.05,
  /** 0x8920cc (0.1): particle parameter factor; also the minimum terrain height under the rex (0.1) */
  MIN_Y: 0.1,
  /** the terrain probe: FUN_0043ce45 = ray from y + 4 down 300 (0x8b1a40 = (0, -300, 0)) with radius 1.0 / skin 0.1, minus 0.1 */
  GROUND_UP: 4,
  GROUND_DOWN: 300,
  /** FUN_007698cf: the upward probe (0x93dbb8 = (0, 4, 0)), radius 2.0 (0x40000000) and skin 0.08 (0x3da3d70a) */
  UP_PROBE: 4, UP_RADIUS: 2.0, UP_SKIN: 0.08,
  /** FUN_007692a1: the forward probe starts (0, 0.4, 6) ahead and sweeps (0, 0.1, -1.07) x 8 (0x93dba8, 0x892118, 0x89228c, 0x892090) with radius 0.01 */
  FWD_AHEAD_Y: 0.4, FWD_AHEAD_Z: 6, FWD_DELTA: [0, 0.8, -8.56] as readonly number[],
} as const;

/** FUN_0076a39b / FUN_0076a73b: the score is 10000 - (5 * max(0, ftol(clock - 5400)) + 250 * hits), the medal thresholds are `>` (0x93db98) */
export const SCORE = {
  MAX: 10000,
  /** the original's per-hit penalty (imul 0xfa) */
  HIT_COST: 250,
  /** the clock term subtracts 5400 from the remaining time (0x892900), so it is never positive: the time never costs points */
  CLOCK_REF: 5400, CLOCK_FACTOR: 5,
  /** the medal thresholds (gold / silver / bronze) read from 0x93db98: 7500 / 5000 / 2500; a score has to be higher than the threshold */
  GOLD: 7500, SILVER: 5000, BRONZE: 2500,
} as const;

/** the clip PEPP (the rex rig, TREX.blk) plays for a medal 0 .. 3 (0x93dbe4: 0x13 0x15 0x18 0x19) */
export const END_CLIP = [0x13, 0x15, 0x18, 0x19] as const;

/** the clip numbers of the rex node (TREX.blk) */
export const CLIP = {
  CRASH_BOULDER: 1, CRASH_EGG: 2, ROAR: 3, LAND: 4, BURN: 5, BURN2: 6, AIR: 7, FALL_STOP: 0xf, RUN: 0x10, JUMP: 0x11, WAIT: 0xd,
  LOSE: 0x13, LOSE2: 0x14, CHEER_BRONZE: 0x15, CHEER_SILVER: 0x18, CHEER_GOLD: 0x19, CHEER_GOLD2: 0x1a,
  BUMP_LEFT: 0x16, BUMP_RIGHT: 0x17, CRASH_ROCK: 9, CRASH_LOG_A: 0x1c, CRASH_LOG_B: 0x1d,
} as const;

/**
 * FUN_0076a194: the rider (DRKR, MFIG.blk) follows the rex: the clip of the rex rig -> the clip of Pepper's rig, the frame is copied. Index = the rex clip.
 * (the switch of the function; clips it has no case for keep the previous mapping, which the node never plays)
 */
export const RIDER_CLIP: Readonly<Record<number, number>> = {
  1: 0xe, 2: 3, 3: 0xd, 4: 5, 5: 6, 6: 2, 7: 7, 8: 0x10, 9: 1, 0xd: 8, 0xf: 10, 0x10: 9, 0x11: 0x17, 0x13: 0x16, 0x14: 0x13, 0x15: 0x10, 0x16: 0xf, 0x17: 0x18,
  0x18: 0x12, 0x19: 0x14, 0x1a: 0x15, 0x1c: 0xc, 0x1d: 0xb,
};

/** FUN_00769859: the rumble kinds (floats at 0x93db68 = the time, ints at 0x93db80 = the strength): 0 rock, 1 lane bump, 2 ?, 3 log, 4 egg / yolk, 5 burn */
export const RUMBLE = { ROCK: 0, LANE: 1, LOG: 3, EGG: 4, BURN: 5 } as const;

/** the sounds of FUN_00766060 (ids of the sound table) that the zone plays; the 2D ones through FUN_00443580 loads, the 3D ones through FUN_004433b0 */
export const SND = {
  ROAR1: 0x206, ROAR2: 0x207, ROAR3: 0x208, ROAR4: 0x209,
  FALL1: 0x20a, FALL2: 0x20b, JUMP1: 0x20c, JUMP2: 0x20d,
  ROCKFALL: 0x20e, BUMPROCK: 0x20f, BUMPTREE: 0x210, BUMPFENCE: 0x211,
  ROCKIMPACT: 0x213, PENDULUM: 0x214, PILLARBREATH: 0x215, EGGFALL: 0x216, EGGIMPACT: 0x217,
  SQUEAL1: 0x218, SQUEAL2: 0x219, SHOUT1: 0x21a, SHOUT2: 0x21b,
  FS1: 0x21c, FS2: 0x21d, FS3: 0x21e, FS4: 0x21f,
  BREATHE: 0x224, CATCHBREATH: 0x225, WATERFALL: 0x226, WAHEY: 0x22b, BUMPPEND: 0x22c,
  TERRADACTYL: 0x262, VOLCANO: 0x263, DINO: 0x264, EGGSPIN: 0x265,
  VICTORY: 0x26d, LOSE: 0x270, LANDGRAVEL: 0x2de, DINO1: 0x2f2,
} as const;
export const SND_3D: readonly number[] = [SND.ROCKFALL, SND.ROCKIMPACT, SND.PENDULUM, SND.PILLARBREATH, SND.EGGFALL, SND.EGGIMPACT, SND.WATERFALL, SND.VOLCANO, SND.DINO, SND.DINO1, SND.TERRADACTYL];
/** every sound the zone loads and plays (2D ones) */
export const SND_2D: readonly number[] = [
  SND.ROAR1, SND.ROAR2, SND.ROAR3, SND.ROAR4, SND.FALL1, SND.FALL2, SND.JUMP1, SND.JUMP2, SND.BUMPROCK, SND.BUMPTREE, SND.BUMPFENCE, SND.SQUEAL1, SND.SQUEAL2, SND.SHOUT1, SND.SHOUT2,
  SND.FS1, SND.FS2, SND.FS3, SND.FS4, SND.BREATHE, SND.CATCHBREATH, SND.WAHEY, SND.BUMPPEND, SND.EGGSPIN, SND.VICTORY, SND.LOSE, SND.LANDGRAVEL,
];

/** the zone's messages (AI/Data/trx.str): intro, medal lines, the speech of the run */
export const MSG = {
  INTRO: 'ADSGTR12',
  /** bronze */ BRONZE: 'ADSGTR05',
  /** silver */ SILVER: ['ADSGTR03', 'ADSGTR04'] as const,
  /** gold */ GOLD: ['ADSGTR01', 'ADSGTR02'] as const,
  /** below a medal */ LOST: ['ADSGTR06', 'ADSGTR07'] as const,
  /** FUN_007692a1: a rock hit ("Pfoe!") */ ROCK: 'ADSGTR09',
  /** FUN_00768510: a jump ("Brul!" / "Wieieieie!") */ JUMP: ['ADSGTR08', 'ADSGTR10'] as const,
  /** the bridge ("Dit is leuk!") */ BRIDGE: 'ADSGTR11',
} as const;

/** the banner of FUN_007653be: y of the score and the medal, lines per medal [id, y] */
export const BANNER = {
  SCORE_Y: 50, MEDAL_Y: 100,
  LINES: [
    [['ADSGTR06', 100], ['ADSGTR07', 270]],
    [['ADSGTR05', 150]],
    [['ADSGTR03', 150], ['ADSGTR04', 320]],
    [['ADSGTR01', 150], ['ADSGTR02', 320]],
  ] as ReadonlyArray<ReadonlyArray<readonly [string, number]>>,
  WRAP: 30,
} as const;

/** the zoom (FUN_0040cd1a(0.75), 0x3f400000) and the fog the zone selects: FUN_00442d90(4, 450, 450, 100, 0xcacce1, 1) at 0x766c64 / 0x765dac (index in the extraction's list); the arrival camera (34, 250) */
export const VIEW = { FOV: 0.75, FOG_NORMAL_INDEX: 1, ARRIVAL_NEAR: 34 } as const;

/** the side camera (FUN_0076ab5e): eye (base x + 74, 24, camera z + 12), target (base x + lane offset, terrain, camera z + 12) */
export const CAM = { SIDE_X: 74, EYE_Y: 24, AHEAD_Z: 12, ARRIVAL_EYE: [16, 14, 4400] as readonly number[], ARRIVAL_TARGET_Z: 4400 - 8, ARRIVAL_Y: 14 } as const;
