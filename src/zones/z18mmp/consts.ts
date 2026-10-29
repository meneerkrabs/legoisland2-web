// z18MMP "Matching Mummies" (the mummy tomb of Adventure Island, sub-game 15): constants of the zone, read off the decompile of the NL build (docs/re/m6/z18MMP.md).
// Addresses are VAs of the executable; the node tests (tools/tests/m6-z18MMP.mjs) check the tables against the EXE.

/** constructor addresses of the zone's behaviour nodes (`FUN_00423532(record, ctor, arg, ...)` in the per-run init `FUN_006a3861`) */
export const CTOR = {
  /** Pepper (`Walk.c`, update FUN_006a4fd0: walking, coffin knocking, page, chase) */
  WALK: 0x6a81f6,
  /** the zone record `MMP` (camera in its draw hook FUN_006ac844) */
  CAMERA: 0x6aca97,
  /** a symbol (the memory game's card: update FUN_006aadf6), 12 of them, attached by the init through FUN_006ac699(n) */
  COFFIN: 0x6abf47,
  /** the three roaming mummies (FUN_006aa600) */
  MUMMY: 0x6aaa86,
  KEY: 0x6aa4b1, PAGE: 0x6a9f87, ROCK: 0x6a9bd2, PILLAR: 0x6a986d, DEBRIS: 0x6a948b, TORCH: 0x6a8fd8, SPIDER: 0x6a8c1f, RAT: 0x6a88db,
} as const;

/** record indices (the original: byte offset from DAT_00983804 / 0x68); the names are checked at run time (`checkRecords`) */
export const REC = {
  MMP: 0,
  /** SPID 0x68..0x208 */
  SPIDER: [1, 2, 3, 4, 5],
  /** RAT0..RAT3 0x270..0x3a8 */
  RAT: [6, 7, 8, 9],
  /** STAN: the pedestal of the page (0x410, FUN_006a4fd0 reads its position at +0x44c) */
  STAND: 10,
  KEY: 11,
  /** the coffin n (FUN_006ac3bb(1 << n)): 0x548, 0x5b0, 0x618, 0x680, 0x6e8, 0x750, 0x7b8, 0x820, 0x888, 0x8f0, 0x958, 0x4e0 */
  COFFIN: [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 12],
  /** the symbol of coffin n (FUN_006ac699(1 << n)): 0xa28, 0xa90, 0x9c0, 0xb60, 0xc30, 0xd00, 0xd68, 0xaf8, 0xbc8, 0xc98, 0xdd0, 0xe38 */
  SYMBOL: [25, 26, 24, 28, 30, 32, 33, 27, 29, 31, 34, 35],
  /** the case (lid base) of coffin n (FUN_006ac52a(1 << n)): 0x2700, 0x2768, 0x27d0, 0x2838, 0x28a0, 0x2908, 0x2970, 0x29d8, 0x2a40, 0x2aa8, 0x2b10, 0x2698 */
  CASE: [96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 95],
  /** the mummy of coffin n (the table at 0x5d5c010, FUN_006aabf1): 0x3670, 0x36d8, 0x3740, 0x3330, 0x3398, 0x3400, 0x3468, 0x34d0, 0x3538, 0x35a0, 0x3608, 0x3190 */
  MUMMY_OF: [134, 135, 136, 126, 127, 128, 129, 130, 131, 132, 133, 122],
  /** PILL with a node (0xf08, 0x1040, 0x10a8, 0x1110) */
  PILLAR: [37, 40, 41, 42],
  /** G000..G005 (hidden at init), POLL 49..52 hidden */
  HIDDEN: [43, 44, 45, 46, 47, 48, 49, 50, 51, 52],
  TORCH: [61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72],
  /** LURK: the homes of the roaming mummies (0x2080 / 0x20e8 / 0x2150) */
  LURK: [80, 81, 82],
  ROCK: 83,
  /** STON: the falling stones of the collapse (0x2220 .. 0x24f8) */
  STONE: [84, 85, 86, 87, 88, 89, 90, 91],
  PAGE: 94,
  DOOR: 111, TRAP: 112, GATE: 114,
  /** COLL: two barriers, enabled at the start, switched off when Pepper takes the page */
  COLL: [115, 116],
  BONE: 117,
  PEPPER: 121,
  /** the roaming mummies (nodes at 0x31f8, 0x3260, 0x32c8) and the LURK record each one starts at (the argument of FUN_006aaa86) */
  GUARD: [123, 124, 125], GUARD_HOME: [81, 82, 80],
  /** all 15 MUMM records */
  MUMMY_FIRST: 122, MUMMY_LAST: 136,
} as const;

const NAMES: Record<number, string> = {};
const name = (i: number, n: string) => { NAMES[i] = n; };
name(0, ' MMP'); name(REC.STAND, 'STAN'); name(REC.KEY, 'KEYX'); name(REC.PAGE, 'PAGE'); name(REC.ROCK, 'ROCK'); name(REC.DOOR, 'DOOR'); name(REC.TRAP, 'TRAP'); name(REC.GATE, 'GATE');
name(REC.BONE, 'BONE'); name(REC.PEPPER, 'PEPP');
REC.SPIDER.forEach((i) => name(i, 'SPID')); REC.RAT.forEach((i, k) => name(i, `RAT${k}`)); REC.COFFIN.forEach((i) => name(i, 'COFF')); REC.CASE.forEach((i) => name(i, 'CASE'));
REC.PILLAR.forEach((i) => name(i, 'PILL')); REC.TORCH.forEach((i) => name(i, 'TORC')); REC.LURK.forEach((i) => name(i, 'LURK')); REC.STONE.forEach((i) => name(i, 'STON'));
REC.COLL.forEach((i) => name(i, 'COLL'));
for (let i = REC.MUMMY_FIRST; i <= REC.MUMMY_LAST; i++) name(i, 'MUMM');
/** the symbol types: the record names of the 12 symbols (two of each) */
export const SYMBOL_NAMES = ['BINO', 'CUPO', 'CAMO', 'SEXO', 'TEAO', 'ARCO'] as const;
export const RECORD_NAMES: Readonly<Record<number, string>> = NAMES;

/** game variables (tools/gamevars.tsv) */
export const VAR = {
  /** SWITCH_GME_HISCORE_MMP / TROPHY_MMP */
  HISCORE: 0x14, TROPHY: 0x48,
  /** zone-local state words (the `SUBGAME: n` variables 0xfb..0xff, no script name) */
  PENDING: 0xfb,     // low 12 bits: the coffin waiting for its partner; 0x1000: a pair was resolved
  NEAR: 0xfc,        // low 12 bits: the coffins within reach; 0x4000: the tomb is escaped (win)
  MATCHED: 0xfd,     // low 12 bits: matched coffins; 0x1000 key taken, 0x2000 page taken, 0x4000 page walk / gate shut
  OPEN: 0xfe,        // low 12 bits: coffins being opened; 0x1000 key released; 0x4000 the collapse (boulder, pillars, stones)
  READY: 0xff,       // low 12 bits: the coffin finished opening / arrived; 0x1000 key landed; 0x2000 page touched; 0x4000 Pepper walks to the pedestal
} as const;
/** bits of the zone variables above */
export const BIT = { KEY: 0x1000, PAGE: 0x2000, CHASE: 0x4000, ALL: 0xfff } as const;

/** Pepper's clips in MFIG.blk (FUN_006a4fd0 / FUN_006a81f6) and the mummies' */
export const CLIP = {
  /** the animation categories of the walk code (node +0x18): idle, sneak, walk, run, - , the happy jump at the end */
  IDLE: 0x3a, SNEAK: 0x08, WALK: 0x0d, RUN: 0x24, LEAP: 0x5b,
  KNOCK: 0x4d, HIT: 0x50, PAGE_TAKE: 0x47, PAGE_RETURN: 0x51, SQUASH: 0x55,
  /** mummies */
  M_RISE: 0x56, M_OUT: 0x58, M_SLEEP: 0x59, M_STAND: 0x5a, M_GONE: 0x53,
} as const;
/** walk categories (node +0x18 / +0x19) -> clip */
export const CAT_CLIP: Readonly<Record<number, number>> = { 0: CLIP.IDLE, 1: CLIP.SNEAK, 2: CLIP.WALK, 3: CLIP.RUN, 5: CLIP.LEAP };

/** Pepper states (node +0x28) */
export const PS = {
  FREE: 0, TO_COFFIN: 1, KNOCK: 2, BACK_OFF: 3, HIT: 4, TO_PEDESTAL: 5, TAKE_PAGE: 6, TURN_BACK: 7, SQUASHED: 8, RESTART: 9, CHASE: 10, BUMP: 11,
} as const;

/** sound table ids (FUN_006a4a60: FUN_00443580 = 2D, FUN_004433b0 = 3D) and the names of the table */
export const SND = {
  // 2D
  SQUEAL: [0x1a5, 0x1a6, 0x1a7],        // SND_PEPP_SQUEAL1..3, Pepper is hit
  MATCH_OK: 0x13e, MATCH_FAIL: 0x13f, KEY_APPEAR: 0x141, KEY_COLLECT: 0x143, TIME_FINISH: 0x14e, CLOCK_TICK: 0x14f, GET_PAGE: 0x148, MELD: 0x258,
  STEP_FLOOR: [0x1f6, 0x1f7, 0x1f8, 0x1f9], STEP_BRIDGE: [0x1fa, 0x1fb, 0x1fc, 0x1fd],
  // 3D
  RAT_SQUEAK: 0x1c2,
  /** zombie laugh of the matched pair: by symbol type */
  LAUGH: { ARCO: 0x179, SEXO: 0x17a, CAMO: 0x17b, CUPO: 0x17c, TEAO: 0x17d, BINO: 0x17e } as Readonly<Record<string, number>>,
  TORCH: 0x18d, SPIDER_DROP: 0x138, KNOCK: 0x13a, KEY_SPIN: 0x142, COFFIN_CLOSE: 0x13c, COFFIN_OPEN: 0x13b, SYMBOL_SPIN: 0x13d, GATE_LOOP: 0x144, GATE_OPENED: 0x145,
  WATER: 0x146, PAGE_SPIN: 0x147, BOULDER: 0x149, COLUMN_FALL: 0x14a, GROAN: [0x14b, 0x14c, 0x14d], BONES: 0x2f8,
} as const;
/** every id the zone loads (FUN_006a4a60), 2D / 3D */
export const SOUNDS_2D = [...SND.SQUEAL, SND.MATCH_OK, SND.MATCH_FAIL, SND.KEY_APPEAR, SND.KEY_COLLECT, SND.TIME_FINISH, SND.CLOCK_TICK, SND.GET_PAGE, SND.MELD, ...SND.STEP_FLOOR, ...SND.STEP_BRIDGE];
export const SOUNDS_3D = [SND.RAT_SQUEAK, ...Object.values(SND.LAUGH), SND.TORCH, SND.SPIDER_DROP, SND.KNOCK, SND.KEY_SPIN, SND.COFFIN_CLOSE, SND.COFFIN_OPEN, SND.SYMBOL_SPIN, SND.GATE_LOOP,
  SND.GATE_OPENED, SND.WATER, SND.PAGE_SPIN, SND.BOULDER, SND.COLUMN_FALL, ...SND.GROAN, SND.BONES];
/** the music keys of the zone's four segments (FUN_00443290: Z18MMP, Z18MMPPre, Hotep, Z28HAT) */
export const MUSIC = { PUZZLE: 'Z18MMP', PRE: 'Z18MMPPre', HOTEP: 'Hotep', CHASE: 'Z28HAT' } as const;

export const f32 = Math.fround;
/** constants of the code stream (named by value; the address is the `.rdata` float the code reads) */
export const K = {
  /** FUN_006a21b0: the game lasts 300 seconds; the countdown beeps for the last 10 (DAT_05d5beec starts at 10); danger meter: 145 = caught (0x89278c), 24 per hit (0x8921a4), -0.2 per tick (0x8920f0) */
  SECONDS: 300, WARN_FROM: 10, DANGER_MAX: 145, DANGER_HIT: 24, DANGER_DECAY: f32(0.2),
  /** the clock counts a second when its fraction passes 30 (0x892038) */
  SECOND_TICKS: 30,
  /** score = 10000 - ftol((seconds - 60) * 33.3) (double at 0x892790), clamped; medals: >= 8001 gold (cmp 0x1f41), >= 6001 silver (0x1771) */
  SCORE_MAX: 10000, SCORE_BASE_SECONDS: 60, SCORE_PER_SECOND: 33.3, GOLD: 8001, SILVER: 6001,
  // Pepper (FUN_006a4fd0)
  WALK_SPEED: f32(0.32), HIT_RADIUS: f32(2.88),
  STICK_X_LIMIT: 4, STICK_Z_FROM: 200,
  CHASE_VZ: f32(-0.9), TURN_STEP: f32(0.349064), HIT_PUSH: f32(0.64),
  WALL_X: f32(4.4), GATE_Y: f32(8.47), GATE_STEP: f32(0.4), ARRIVE: f32(0.8), FACING: f32(0.95), TURN_SNAP: f32(0.9), ROCK_NEAR: f32(3.2), SPEED_RUN: f32(0.576), SPEED_WALK: f32(0.256), SPEED_SNEAK: f32(0.128), TURN_BACK_VZ: f32(-0.4), RATE: f32(0.125),
  GRAVITY: f32(0.08), RESPAWN_Y: f32(-12.5), RESPAWN_TOP: f32(187.5),
  SWEEP_Y: f32(2.8),
  /** FUN_006a3861 moves Pepper 15 forward (z += 15.0, 0x892074) after the builder placed him at z = -67.122 */
  PEPPER_START_Z: 15,
  // coffin: a symbol is within reach when its squared distance to Pepper is below 8 (0x892090); the mummy leaves 0.04 per tick (0x8925ec)
  OPEN_REACH: 8, MUMMY_LEAVE: f32(0.04),
  OPEN_TICKS: 12, WRONG_TICKS: 20, SPIN: f32(0.087266), LID_TURN: f32(0.174532), SYMBOL_RISE: f32(0.32), SYMBOL_REST_Y: f32(9.688),
} as const;

/** medal of a score (FUN_006a2355): 0 none (lost), 1 bronze, 2 silver, 3 gold */
export const medalOfScore = (won: boolean, score: number): 0 | 1 | 2 | 3 => (!won ? 0 : score >= K.GOLD ? 3 : score >= K.SILVER ? 2 : 1);
