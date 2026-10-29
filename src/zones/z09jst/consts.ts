// z09JST "Jousting" (Castle Island): addresses, record indices, sound ids and the constants of the duel code. Everything here is taken from the executable
// (docs/re/m6/z09JST.md): the record numbers are byte offsets of the zone code divided by 0x68, the floats are the immediates / `.rdata` values the code reads
// (the address is in the comment, `tools/tests/m6-z09JST.mjs` compares them with the executable), tables are read from the executable at run time.
import type { Pe } from '../../formats/exe.ts';

/** constructors of the zone's behaviour nodes (the `ctor` of the set-up's attaches): `JSTGame` (record 4 LAND), `Flag` (records 5..10), `Anims` (the eight spectators), `Drkk` (record 11) */
export const CTOR = { JSTGAME: 0x5d1f64, FLAG: 0x5d3e7c, ANIMS: 0x5d3cc1, DRKK: 0x5d3ad4 } as const;

/** the zone's records (builder FUN_005e628a; offsets of FUN_005cdb60 / FUN_005ce506 divided by 0x68) */
export const REC = {
  SSKY: 1, LAND: 4,
  /** LFG0..LFG4 (flags, anim LFLG.blk) and BBFG (anim BBFG.blk): the `Flag` nodes (0x208 .. 0x410) */
  FLAGS: [5, 6, 7, 8, 9, 10],
  /** the dark knight (rider of the enemy: MFIG.blk), the player's horse HORS (HORS.blk), the spare SADD / CLOK, the player's knight JKIT (MFIG.blk) */
  DRKK: 11, HORS: 12, SADD: 13, CLOK: 14, JKIT: 15,
  /** RSAD (the enemy's saddle), GSAD (the player's saddle), a second CLOK (the player's cloak is record 14) */
  RSAD: 16, GSAD: 17, CLOK2: 18,
  /** the spectators facing the player: LKNG (0x7b8), LQUN (0x820), LSD1 (0xa28), LSD2 (0xb60); facing the dark knight: BKNG (0x888), BQUN (0x8f0), BSD1 (0xa90), BSD2 (0xaf8) */
  LKNG: 19, LQUN: 20, BKNG: 21, BQUN: 22, LSD1: 25, BSD1: 26, BSD2: 27, LSD2: 28,
  /** the two bugle players (clip 0x86, they start the tournament) */
  BUG1: 23, BUG2: 24,
  /** DRKH: the dark knight's horse (HORS.blk) */
  DRKH: 29,
} as const;
export const NAMES: Record<number, string> = {
  1: 'SSKY', 4: 'LAND', 5: 'LFG0', 6: 'LFG1', 7: 'LFG2', 8: 'LFG3', 9: 'LFG4', 10: 'BBFG', 11: 'DRKK', 12: 'HORS', 13: 'SADD', 14: 'CLOK', 15: 'JKIT',
  16: 'RSAD', 17: 'GSAD', 18: 'CLOK', 19: 'LKNG', 20: 'LQUN', 21: 'BKNG', 22: 'BQUN', 23: 'BUG1', 24: 'BUG2', 25: 'LSD1', 26: 'BSD1', 27: 'BSD2', 28: 'LSD2', 29: 'DRKH',
};
/** the eight spectators with the `Anims` node (they only run while the duel's level +0x44 is 1 .. 3) and the four soldiers the set-up hides (flags = 0) */
export const SPECTATORS = [19, 20, 25, 28, 21, 22, 26, 27] as const;
export const HIDDEN_SOLDIERS = [25, 26, 27, 28] as const;
/** the anim rig of every animated record (blk index of the loader: 0 LFLG, 1 BBFG, 2 MFIG, 3 HORS), FUN_005e628a 0x5f10bc..: all start at clip 1, frame 0 */
export const RIG_OF: Readonly<Record<number, 'LFLG' | 'BBFG' | 'MFIG' | 'HORS'>> = {
  5: 'LFLG', 6: 'LFLG', 7: 'LFLG', 8: 'LFLG', 9: 'LFLG', 10: 'BBFG', 11: 'MFIG', 12: 'HORS', 13: 'HORS', 14: 'HORS', 15: 'MFIG', 16: 'HORS', 17: 'HORS', 18: 'HORS',
  19: 'MFIG', 20: 'MFIG', 21: 'MFIG', 22: 'MFIG', 23: 'MFIG', 24: 'MFIG', 25: 'MFIG', 26: 'MFIG', 27: 'MFIG', 28: 'MFIG', 29: 'HORS',
};
/** FUN_005cdb60: the clips the records start with (FUN_0043b6a3(anim, clip, 0)) */
export const START_CLIPS: ReadonlyArray<readonly [number[], number]> = [
  [[5, 6, 7, 8, 9, 10], 1], [[23, 24], 0x86], [[19, 20], 0x43], [[21, 22, 25, 26, 27, 28], 0x3a],
];

/** the clip tables of the two mfig managers (FUN_005f3a90 gets them): rows of four dwords, the player's row = clips of [HORS, GSAD, CLOK, JKIT], the enemy's = [DRKH, RSAD, DRKK] */
export const TABLE_PLAYER_VA = 0x90b7c4, TABLE_ENEMY_VA = 0x90b8f4, TABLE_ROWS = 19;
/** FUN_005d4add copies these 8 rows (x y z yaw) to DAT_05d5b190: the final tableau of a won (rows 0..3) and a lost (4..7) tournament */
export const END_ROWS_VA = 0x905a80;
export function readClipTable(pe: Pe, va: number, rows = TABLE_ROWS): number[][] {
  const t: number[][] = [];
  for (let r = 0; r < rows; r++) t.push([0, 4, 8, 12].map((o) => pe.u32(va + r * 16 + o)));
  return t;
}
/** the player's / enemy's start place and facing (FUN_005d4860): +0x60 = (40, 13, -85), euler y 1.5700 (0x3fc8f5c3); +0x78 = (204, 13, -79), euler y -1.5700 */
export const START = {
  player: { pos: [0x42200000, 0x41500000, 0xc2aa0000], euler: [0, 0x3fc8f5c3, 0] },
  enemy: { pos: [0x434c0000, 0x41500000, 0xc29e0000], euler: [0, 0xbfc8f5c3, 0] },
};

const fb = new DataView(new ArrayBuffer(4));
/** a float written as the hex pattern the executable stores */
export function hexf(u: number): number { fb.setUint32(0, u >>> 0); return fb.getFloat32(0); }
export const f32 = Math.fround;

/** floats of the update function / helpers (VA of the `.rdata` constant; the value is checked against the executable in the test) */
export const K = {
  /** 0x892020 = 1, 0x89202c = 0, 0x892024 = 12, 0x892038 = 30, 0x89204c = 0.5, 0x892070 = 5, 0x892074 = 15, 0x892080 = 4, 0x892090 = 8, 0x8920d0 = 2.5 */
  ONE: 1, ZERO: 0, TWELVE: 12, THIRTY: 30, HALF: 0.5, FIVE: 5, FIFTEEN: 15, FOUR: 4, EIGHT: 8, TWO_HALF: 2.5,
  /** 0x892114 = 200, 0x892170 = 0.12 */ TWO_HUNDRED: 200, CAM_DECAY: f32(0.12),
  /** 0x892200 = 3.0, 0x8921f4 = 16, 0x892250 = 240, 0x892254 = 50, 0x892388 = 60, 0x89237c = 20, 0x892528 = 40, 0x89257c = 18, 0x892540 = 64, 0x892700 = 70 */
  THREE: 3, SIXTEEN: 16, CAM9_MAX_X: 240, FIFTY: 50, SIXTY: 60, TWENTY: 20, FORTY: 40, EIGHTEEN: 18, SIXTY_FOUR: 64, SEVENTY: 70,
  /** 0x8922c0 = 0.02: the knights' speed per unit of charge; 0x89270c = 1/32: animation rate / camera / reaction speed per unit of charge */ RIDER: f32(0.02), RATE: 0.03125,
  /** 0x8923cc = 0.0625: the aim wobble grows by this per unit of charge */ SIXTEENTH: 0.0625,
  /** 0x905658 = 0.0075: the decay of the charge per tick */ DECAY: f32(0.0075),
  /** 0x89245c = 0.3, 0x892464 = 0.55, 0x89213c = 0.6, 0x8924d4 = 3.2, 0x8924e0 = 180, 0x892664 = 0.009, 0x892684 = -8 */
  POINT3: f32(0.3), POINT55: f32(0.55), POINT6: f32(0.6), THREE_TWO: f32(3.2), ONE_EIGHTY: 180, CAM_E_STEP: f32(0.009), CLASH_GAP: -8,
  /** 0x8926dc = 190, 0x8926e0 = 224, 0x8926e4 = 1.3, 0x8926e8 = 3.8, 0x8926ec = 4.3, 0x892700 = 70, 0x892704 = 3.75, 0x892708 = 3.7, 0x892694 = 170, 0x892710 = 245, 0x892714 = -75 */
  X190: 190, X224: 224, P1_3: f32(1.3), P3_8: f32(3.8), P4_3: f32(4.3), Z_OFF: f32(3.75), X_OFF: f32(3.7), CAM8_MAX_X: 170, CAM6_MAX_X: 245, CAM10_MIN_Z: -75,
  /** 0x892690 = 6.4: camera mode 1 looks that far above the line between the knights */ CAM1_UP: f32(6.4),
  /** doubles: 0x8926f8 = 1.4 (the wobble divisor), 0x8926f0 = 10 (the pull-back divisor) */ WOBBLE_DIV: 1.4, PULL_DIV: 10,
  /** 0x89207c = pi: the spectators face the player + pi */ PI: f32(Math.PI),
};

/** what `FUN_005ce3a0` / `FUN_005f2f0b` read: the offset in the player knight's local frame the camera follows (0x90b7b8), the spline's blend (0x90b7b0), the fifth control point offset (0x90b730) */
export const CAM = {
  followOffset: [-5, 8.35, -12.5] as const, followOffsetVa: 0x90b7b8,
  blend: 0.4, blendVa: 0x90b7b0,
  endOffsetVa: 0x90b730, endOffset: [184, 24, -96] as const,
  splineVa: 0x90b740, splineCountVa: 0x90b73c,
};

/** ids of the zone's message table (`CI/Data/jst.str`) */
export const SAY = {
  INTRO: 'CASGJO13',
  /** by hit variant 0..3 (+0x48): player hits / the dark knight hits */
  PLAYER_HIT: ['CASGJO11', 'CASGJO11', 'CASGJO10', 'CASGJO12'],
  ENEMY_HIT: ['CASGJO07', 'CASGJO07', 'CASGJO08', 'CASGJO07'],
  BOTH_MISS: ['CASGJO09', 'CASGJO09'],
} as const;

/** game variables the zone writes: SWITCH_GME_HISCORE_JST 0x18, SWITCH_GME_TROPHY_JST 0xcb (FUN_005d4698) */
export const VAR = { HISCORE: 0x18, TROPHY: 0xcb } as const;

/** sound table ids by the name of the handle (FUN_005d24b0): 2D = FUN_00443580, 3D = FUN_004433b0 */
export const S2D = {
  WIND: 0x5d, CROW_A: 0x5f, CROW_B: 0x5e, CROWD_WIN: 0x62, CROWD_LOSE: 0x63, CROWD_FALL: 0x61, CROWD_BK_FALLEN: 0x60, CROWD_CHARGE: 0x64,
  FANFARE_SHORT: 0xf5, FANFARE_MED: 0xf6, FANFARE_LONG: 0xf7, WINDUP: 0xf8, ONLANCE: 0x2b6, OFFLANCE: 0x2b7, GRAB: 0x255, THROW: 0x256, LAND: 0x257,
} as const;
export const S3D = {
  HOOF_SLOW: [0x4e, 0x4c, 0x4d, 0x4b], HOOF_MID: [0x50, 0x4f, 0x51, 0x52], HOOF_FAST: [0x53, 0x54, 0x56, 0x55],
  HORSE1_NEIGH: 0x58, HORSE1_1: 0x57, HORSE1_2: 0x59, HORSE2_NEIGH: 0x5a, HORSE2_1: 0x5c, HORSE2_2: 0x5b,
  PEPP_HIT_BK: 0x65, PEPP_KNOCKED_OFF: 0x68, BK_FALLEN: 0x67, PEPP_FALLEN: 0x6a, BK_HIT_PEPP: 0x66, PEPP_LANCE_TWANG: 0x69, BLKWALK1: 0x253, BLKWALK2: 0x254,
} as const;
export const ALL_2D: number[] = Object.values(S2D);
export const ALL_3D: number[] = [...S3D.HOOF_SLOW, ...S3D.HOOF_MID, ...S3D.HOOF_FAST, S3D.HORSE1_NEIGH, S3D.HORSE1_1, S3D.HORSE1_2, S3D.HORSE2_NEIGH, S3D.HORSE2_1, S3D.HORSE2_2,
  S3D.PEPP_HIT_BK, S3D.PEPP_KNOCKED_OFF, S3D.BK_FALLEN, S3D.PEPP_FALLEN, S3D.BK_HIT_PEPP, S3D.PEPP_LANCE_TWANG, S3D.BLKWALK1, S3D.BLKWALK2];
/** the 3D sounds that are 2D in the table's loader FUN_005d24b0 are listed in S2D (GRAB, THROW, LAND are played with FUN_004435a0) */
