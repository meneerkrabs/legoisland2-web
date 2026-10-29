// z08BKD "Brick Dive" (castle island mini-game): constants of the port. Every number has the address of the executable it was read from (floats in .rdata read by the
// code as `_DAT_008xxxxx`, immediates of FUN_005ba32c / FUN_005b9430 / the zone code). `tools/tests/m6-z08BKD.mjs` checks the table `FLOAT_ADDRS` against the executable.
const fr = Math.fround;
const bitsView = new DataView(new ArrayBuffer(4));
/** the float32 with the given bit pattern (the decompile shows float immediates as hex ints) */
export const f32bits = (u: number): number => { bitsView.setUint32(0, u >>> 0); return bitsView.getFloat32(0); };

/** the float literals the zone code reads from .rdata: name -> [address, value] (WP-VERIFY: every value is the exact float32 of the executable; `tools/tests/m7-z08BKD-emu.mjs` checks the bit patterns) */
export const FLOAT_ADDRS = {
  HUNDRED: [0x89201c, 100], ONE: [0x892020, 1], TWELVE: [0x892024, 12], TWO: [0x892028, 2], ZERO: [0x89202c, 0], THIRTY: [0x892038, 30], HALF: [0x89204c, 0.5],
  TEN: [0x892060, 10], TWO_EIGHT: [0x89206c, 2.8], FIVE: [0x892070, 5], FIFTEEN: [0x892074, 15], PI: [0x89207c, 3.1415927], FOUR: [0x892080, 4],
  TWO_PI: [0x892094, 6.2831855], GAUGE_SCALE: [0x8920e8, 1.2], POINT_TWO: [0x8920f0, 0.2], POINT_FOUR: [0x892118, 0.4], ONE_POINT_ONE: [0x892148, 1.1],
  TWO_FIFTY_SIX: [0x8921e8, 256], SIXTEEN: [0x8921f4, 16], THREE: [0x892200, 3], MINUS_TWO: [0x892204, -2], HALF_PI: [0x892220, 1.5707964], FIFTY: [0x892254, 50],
  TICK_SECONDS: [0x8922ac, 0.03333333507180214], TWENTY: [0x89237c, 20], WAVE_RANGE: [0x892388, 60], FADE_STEP: [0x8923cc, 0.0625], POINT_THREE: [0x89245c, 0.3], TIME_LIMIT: [0x8924b4, 500],
  ONE_EIGHTY: [0x8924e0, 180], POINT_NINETY_FIVE: [0x8924e4, 0.95], MINUS_TWENTY_FOUR: [0x892518, -24], FORTY: [0x892528, 40], SIXTEEN_HUNDRED: [0x8925dc, 1600],
  POINT_FIFTEEN: [0x892624, 0.15], NINE: [0x892660, 9], FIVE_DEG: [0x8926a4, 0.087266], ANG_LO: [0x8926a8, 4.014236], ANG_HI: [0x8926ac, 5.497758],
  MINUS_QUARTER_PI: [0x8926b0, -0.7853939533233643], EIGHTH_PI: [0x8926b4, 0.39269697666168213], CLAM_OPEN_LIM: [0x8926b8, -1.047192], CLAM_OPEN_MID: [0x8926bc, -0.261798],
  CLAM_SHUT_LIM: [0x8926c0, -1.2217239141464233], ANCHOR_LO: [0x8926c4, -0.43633], ANCHOR_HI: [0x8926c8, 0.43633], SURFACE_Y: [0x8926cc, 86.5], DOLPHIN_RISE_Y: [0x8926d0, 78.5],
  OCTO_ANGLE: [0x8926d4, 1.9198518991470337], MINUS_HUNDRED: [0x8926d8, -100],
} as const satisfies Record<string, readonly [number, number]>;

type Floats = { -readonly [K in keyof typeof FLOAT_ADDRS]: number };
/** the values (rounded to float32 like the executable's) */
export const C: Floats = Object.fromEntries(Object.entries(FLOAT_ADDRS).map(([k, [, v]]) => [k, fr(v)])) as Floats;

/** DAT_008b1718 = 1.0 and _DAT_008922ac: the seconds of one tick; the zone multiplies its speeds by `FUN_005baff2()` = DAT_008b1718 * 1 * _DAT_008922ac */
export const DT = C.TICK_SECONDS;

/** the record the zone's code addresses by byte offset (offset / 0x68 = index; the offsets are in the comments) */
export const REC = {
  SHRK: 2,         // 0xd0..
  DLPH: 3,         // 0x138
  MANT: [4, 7, 8, 9, 10, 11] as readonly number[],   // 0x1a0, 0x2d8 .. 0x478 (the six manta rays; 12..15 are hidden spares, FUN_005b9430 clears bit 2)
  PEPP: 5,         // 0x208 the diver, node SwimBeh + CamBeh
  SKEL: 6,         // 0x270 the diver's skeleton (shown while he is electrified)
  SORD: 16, SOR1: 42,   // 0x680, 0x1110 the two swordfish
  WEEDS: [17, 18, 19, 20] as readonly number[],     // WEED (swaying, 0x6f0 ..)
  PIRATES: [21, 22, 24] as readonly number[],       // 0x888, 0x8f0, 0x9c0 (record 23 is a hidden spare)
  OCTO: 25,        // 0xa28 the octopus
  WEETS: [26, 27, 28, 29, 30, 31] as readonly number[],   // 0xa90 ..
  WEIDS: [32, 33, 34, 35, 36, 37, 38, 39, 40, 41] as readonly number[],
  SEAE: 43,        // 0x1178 sea animation (shared node 0x4b1212)
  LAND: 1,         // 0x68 mainmesh
  BRICKS: [51, 89, 90, 91, 92] as readonly number[],    // 0x14b8, 0x2428, 0x2490, 0x24f8, 0x2560
  BRICK_TOPS: [83, 84, 85, 86, 87] as readonly number[],   // BRT1..5, the bridge pieces shown when a brick is delivered (flags at 0x2218, 0x2280, ...)
  CLAM_TOP: 52, CLAM_BOT: 53,   // 0x1520, 0x1588
  ANCHOR: 54,      // 0x15f0
  CANNON: 57,      // 0x1728 the barrel CBAR
  BALLS: [67, 56, 59, 60, 61, 62, 63, 64, 65, 66] as readonly number[],   // 0x1b38, 0x16c0, 0x17f8 .. 0x1ad0
  OCTC: 69,        // 0x1c08 the octopus's tentacle collision
  OCTH: 72,        // 0x1d40 the octopus's head collision
  PAGE: 82,        // 0x2150 PAG5
  PCOL: 93,        // 0x25c8 the particle collision record the diver's bubble emitter is registered with (FUN_005c23f9: flags |= 0x20 = solid while hidden)
} as const;

/** the animated records (FUN_005ca0a5 loads the .blk, FUN_005b9430's caller binds them: `rec + 8 = FUN_0043b4e2(DAT_009837fc[k], 1)`, clip 1) */
export const RIG_OF_RECORD: Record<number, string> = {
  2: 'SHRK', 3: 'DLPH', 4: 'MANT', 5: 'PEPD', 6: 'PEPD', 7: 'MANT', 8: 'MANT', 9: 'MANT', 10: 'MANT', 11: 'MANT', 12: 'MANT', 13: 'MANT', 14: 'MANT', 15: 'MANT',
  16: 'SORD', 17: 'WEED', 18: 'WEED', 19: 'WEED', 20: 'WEED', 21: 'PIRO', 22: 'PIRO', 23: 'PIRO', 24: 'PIRO', 25: 'OCTO',
  26: 'WEET', 27: 'WEET', 28: 'WEET', 29: 'WEET', 30: 'WEET', 31: 'WEET', 32: 'WEID', 33: 'WEID', 34: 'WEID', 35: 'WEID', 36: 'WEID', 37: 'WEID', 38: 'WEID', 39: 'WEID', 40: 'WEID', 41: 'WEID',
  42: 'SORD',
};

/** FUN_005b8ac0 / FUN_005b8d97: the swaying plants start at these frames (floats at the call sites) and advance 0.5 frames per tick */
export const WEED_START_FRAMES: readonly [number, number][] = [
  [17, 30], [18, 45], [19, 15], [20, 33], [26, 30], [27, 25], [28, 27], [29, 35], [30, 37], [31, 30],
  [32, 10], [33, 25], [34, 27], [35, 30], [36, 23], [37, 35], [38, 17], [39, 23], [40, 40], [41, 27],
];
export const WEED_RATE = 0.5;

/** the clip numbers (FUN_0045bff4 names in FUN_005ca0a5) */
export const CLIP = {
  SHRK_BITE: 1, SHRK_SWIM: 2,
  DLPH_WALK: 1, DLPH_JUMP1: 2, DLPH_DOLSWIM: 3, DLPH_FASTSWIM: 4, DLPH_JUMP2: 5,
  MANT_SWIM: 1,
  PEPD_SWIM: 1, PEPD_BRICKSWIM: 2, PEPD_ELECTRIFIED: 3,
  SORD_KNIFE: 1, WEED_SWAY: 1, PIRO_SLASH: 1, PIRO_IDLE: 2, PIRO_JUMPUP: 3, OCTO_DOOR: 1, WEET_SWAY: 1, WEID_SWAY7: 1,
} as const;

/** sound table ids FUN_005cd0d0 loads (the handles DAT_05d5ac94 ..): name by the table (SND_*) */
export const SND = {
  FLIPPER_LEFT: 0x30, FLIPPER_RIGHT: 0x31, SUBMERGE: 0x32, CLAM_OPEN: 0x33, CLAM_SHUT: 0x34, CLAM_CATCH: 0x35, HIT_SAND: 0x36, HIT_ROCK: 0x37, BREATHE: 0x38,
  SHOCK1: 0x39, SHOCK4: 0x3a, HIT_ANCHOR: 0x3b, CLANG: 0x3c, TENTACLE_HIT: 0x3d, CANNON: 0x3e, WATER_SURFACE: 0x3f, WATER_SHALLOW: 0x40, WATER_MID: 0x41,
  WATER_DEEP: 0x42, SKELETON_ANIMATE: 0x43, WAVE1: 0x44, WAVE2: 0x45, INSIDE_CLAM1: 0x46, INSIDE_CLAM2: 0x47, BRICK_GET: 0x48, BRICK_DROP: 0x49, BRICK_FINISH: 0x4a,
  GETPAGE: 0x334,
} as const;
/** 3D sounds (FUN_004433b0): the clam and the cannon; everything else is a 2D load (FUN_00443580) */
export const SOUNDS_3D: readonly number[] = [SND.CLAM_OPEN, SND.CLAM_SHUT, SND.CANNON];
export const SOUNDS_2D: readonly number[] = Object.values(SND).filter((id) => !SOUNDS_3D.includes(id));

/** the zone's game variables (FUN_005b7f60 / FUN_005b8ac0 / FUN_005c1d39) */
export const VAR = { HISCORE: 0x2f, TROPHY: 0x3d, GOT_PAGE: 0xc2 } as const;

/** the medal / score rules of FUN_005b7f60 (the banner): score = ftol(percent oxygen left) * 0xb3 (+1000 with the page), 0..10000; < 6000 bronze, < 9000 silver, else gold */
export const SCORE = { PER_PERCENT: 0xb3, PAGE_BONUS: 1000, MAX: 10000, SILVER_FROM: 6000, GOLD_FROM: 9000 } as const;

/** the four camera table rows at 0x9038f0 (stride 0x10, count 4 at 0x9038e8): [y threshold, eye height offset, target height offset, eye distance] */
export const CAMERA_TABLE_VA = 0x9038e8;
export const CAMERA_TABLE: readonly (readonly [number, number, number, number])[] = [[87, 35, 15, 35], [70, 18, 0, 25], [27, 0, 0, 46], [-170, -2, 0, 43]];
/** the camera's default eye distance (FUN_005c03f0 above / below the table) and CamBeh's start (FUN_005c06d7: eye (0, 60, 40), target (0, 60, 0)) */
export const CAMERA_FAR_Z = 30;
export const CAMERA_PARALLAX = { SCALE: 15, DIVISOR: 40, TARGET: 0.3 } as const;

/** the diver (FUN_005c23f9 / FUN_005c0888): start place and the movement block (ctor args 0x4096cbaf, -2.0, 24.0, -2.0 at the builder's call) */
export const DIVER = {
  START: [0, 82.5, 10] as const,    // 0x42a50000 = 82.5
  PLANE_Z: 10,                      // 0x41200000, the z every body of the zone lives in (the game is 2D in a 3D scene)
  TURN: f32bits(0x4096cbaf),        // 4.7124 = 3 pi / 2 rad/s^2 per steer key
  TURN_DRAG: -2,                    // 0xc0000000
  THRUST: 24,                       // 0x41c00000
  DRAG: -2,
  /** FUN_005c282c: the two collision shapes (4 corners, z 10): small (2 x 4) and with a brick (2 x 7) */
  SHAPES: [
    [[1, 4, 10], [-1, 4, 10], [-1, 0, 10], [1, 0, 10]],
    [[1, 7, 10], [-1, 7, 10], [-1, 0, 10], [1, 0, 10]],
  ] as readonly (readonly (readonly [number, number, number])[])[],
  STUN: 2,                          // 0x40000000: s of lost control / skeleton view
  KNOCK: [20, -2] as const,         // FUN_005bc3a0: 2 * (node+0x30, node+0x34) = 2 * (10.0, -1.0): the fixed push (a quirk of the original: it reads the diver's own shape table)
  PEPD_START_CLIP: 1,
} as const;

/** hurt zones (FUN_005ba32c writes the templates as immediates; FUN_005ba570 registers a record with a category and a template; FUN_005ba5d7 / 005ba745 use them) */
export interface HurtTemplate { anchor: [number, number, number]; anchorRadius: number; spheres: { local: [number, number, number]; radius: number }[] }
export const HURT_CATEGORY = { SHARK: 1, MANTA: 2, SWORDFISH: 3, PIRATE: 4 } as const;
export const HURT_TEMPLATES: Record<'pirate' | 'shark' | 'manta', HurtTemplate> = {
  // DAT_05d589a0: anchor (0, 3, 0.5) r 2.5, one sphere (0, 3, 0.5) r 2.5
  pirate: { anchor: [0, 3, 0.5], anchorRadius: 2.5, spheres: [{ local: [0, 3, 0.5], radius: 2.5 }] },
  // DAT_05d58bb0: anchor (0, 0, 0) r 2.8, three spheres (0, 0.2, 2) (0, 0.2, 0) (0, 0.2, -2) r 1
  shark: { anchor: [0, 0, 0], anchorRadius: 2.8, spheres: [{ local: [0, 0.2, 2], radius: 1 }, { local: [0, 0.2, 0], radius: 1 }, { local: [0, 0.2, -2], radius: 1 }] },
  // DAT_05d58b00: anchor (0, 0, 0) r 2.7, five spheres (0, 0, 2) (0, 0, 0) (0, 0, -2) (-2, 0, 0.3) (2, 0, 0.3) r 1
  manta: { anchor: [0, 0, 0], anchorRadius: 2.7, spheres: [{ local: [0, 0, 2], radius: 1 }, { local: [0, 0, 0], radius: 1 }, { local: [0, 0, -2], radius: 1 }, { local: [-2, 0, 0.3], radius: 1 }, { local: [2, 0, 0.3], radius: 1 }] },
};
/** which template + category each record gets (FUN_005b9430: FUN_005ba570(record, category, template)) */
export const HURT_REGISTRATIONS: readonly { rec: number; category: number; template: keyof typeof HURT_TEMPLATES }[] = [
  { rec: 21, category: HURT_CATEGORY.PIRATE, template: 'pirate' }, { rec: 22, category: HURT_CATEGORY.PIRATE, template: 'pirate' }, { rec: 24, category: HURT_CATEGORY.PIRATE, template: 'pirate' },
  { rec: 2, category: HURT_CATEGORY.SHARK, template: 'shark' },
  { rec: 16, category: HURT_CATEGORY.SWORDFISH, template: 'shark' }, { rec: 42, category: HURT_CATEGORY.SWORDFISH, template: 'shark' },
  { rec: 4, category: HURT_CATEGORY.MANTA, template: 'manta' }, { rec: 7, category: HURT_CATEGORY.MANTA, template: 'manta' }, { rec: 8, category: HURT_CATEGORY.MANTA, template: 'manta' },
  { rec: 9, category: HURT_CATEGORY.MANTA, template: 'manta' }, { rec: 10, category: HURT_CATEGORY.MANTA, template: 'manta' }, { rec: 11, category: HURT_CATEGORY.MANTA, template: 'manta' },
];

/** the fish nodes (FUN_005bc592): FUN_005b9430's argument blocks {tag, link, fraction} per record (`Attach.argWords`) plus one shared 4-float tail; the tail seeds the movement block [9..12] */
export const FISH_TAIL = { TURN: f32bits(0x4390dc8f), DRAG_ANG: 0, SPEED: 10, DRAG: -2 } as const;

/**
 * The diver's exhaust bubbles (FUN_005c23f9 at 0x5c2469, the node constructor): `bubble01.par` on the diver's live matrix (record 5) at (0, 4, 0), Euler rotation (0, -pi, 0), gate (2, 1, 1) = always on;
 * the collision list FUN_00442a50 gets the records 1 (0x68), 93 (PCOL, 0x25c8; its flags |= 0x20 first, `DiverNode.bind`) and 52 (0x1520), in this order.
 */
export const BUBBLE = { NAME: 'bubble01.par', OFFSET: [0, 4, 0] as const, ROT: [0, f32bits(0xc0490fdb), 0] as const, COLLIDE: [1, 93, 52] as const } as const;
