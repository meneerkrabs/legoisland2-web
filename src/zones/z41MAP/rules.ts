// z41MAP "Pizza making" (archive z41MAP, zone table index 28, story node 65): constants of the zone code of the original (0x811abc-0x81fd64) and the
// small pure pieces of its rules (medal thresholds, scoring). Every constant carries the address it comes from; the tests (tools/tests/m3-z41MAP.mjs) compare
// the data tables with the executable. DOM-free.
import type { Pe } from '../../formats/exe.ts';

/** sound table ids the zone loads in FUN_00813500 (0x813500; names SND_MAP_*) */
export const SND = {
  PIZ_CHEESE: 0x7f, HIT_CITIZEN: 0x80, PIZ_PEPRON: 0x81, PIZ_TOMATO: 0x82, PAPA_EEK: 0x83, PAPA_OUCH: 0x84, HIT_PAPA: 0x85, PIZ_CAPS: 0x86, HIT_WINDOW: 0x87,
  PIZ_DONE: 0x1d1, PICK_CHEESE: 0x1d2, PICK_TOMATO: 0x1d3, PICK_CAPS: 0x1d4, PICK_PEPRON: 0x1d5, FOOD_MOVE: 0x1d6 /* 3D loop, FUN_004433b0 */, RIGHT_TOP: 0x1d7, WRONG_TOP: 0x1d8,
  PAPA_YEOW: 0x1d9, PAPA_CHEERS: 0x1da, PAPA_YEAH: 0x1db, PAPA_CONGRATS: 0x1dc, THROW1: 0x1e2, THROW2: 0x1e3, THROW3: 0x1e4, THROW4: 0x1e5,
  VOCAL1: 0x1f0, VOCAL2: 0x1f1, PAPA_BOUNCE: 0x259, MAMA_CLAP: 0x261,
} as const;

/** topping types (bit values; the slot / target words of the game): 1 green pepper, 2 cheese, 4 tomato, 8 pepperoni. HUD overlay texture index = bit position */
export const TOPPING = { GREEN: 1, CHEESE: 2, TOMATO: 4, PEPPERONI: 8 } as const;

/** sound played when a topping of that type is picked up (FUN_00816562 case 3: DAT_05d5f434 / 478 / 46c / 410) */
export const PICK_SOUND: Record<number, number> = { 1: SND.PICK_CAPS, 2: SND.PICK_CHEESE, 4: SND.PICK_TOMATO, 8: SND.PICK_PEPRON };
/** sound when it lands on the dough (FUN_00815576 case 2: DAT_05d5f400 / 47c / 438 / 470) */
export const HIT_SOUND: Record<number, number> = { 1: SND.PIZ_CAPS, 2: SND.PIZ_CHEESE, 4: SND.PIZ_TOMATO, 8: SND.PIZ_PEPRON };

/** the key that picks each topping (button bits of DAT_00983840) and the clip of the minifig rig `MFIG.blk` that picks it up (PEP_MAP_R*: 4 tomato, 6 green pepper, 8 cheese, 9 pepperoni) */
export const PICKS = [
  { bit: 4 /* up */, type: 4, clip: 4, record: 'TOP4' },
  { bit: 8 /* down */, type: 8, clip: 9, record: 'TOP1' },
  { bit: 1 /* left */, type: 2, clip: 8, record: 'TOP2' },
  { bit: 2 /* right */, type: 1, clip: 6, record: 'TOP3' },
] as const;

/** DAT_00955bd8: number of toppings of round 0..4 (the sixth entry is 0) */
export const TOPPINGS_PER_ROUND = [2, 3, 4, 4, 4];
export const ROUNDS = 5;

/** medal thresholds of FUN_00812dbb (0x812dbb): `score < 0x9c5` none, `< 0x1389` bronze, `< 0x1d4d` silver, else gold = 2501 / 5001 / 7501 */
export const MEDAL_BRONZE = 0x9c5, MEDAL_SILVER = 0x1389, MEDAL_GOLD = 0x1d4d;
export function medalOfScore(score: number): 0 | 1 | 2 | 3 {
  return score < MEDAL_GOLD ? (score < MEDAL_SILVER ? (score < MEDAL_BRONZE ? 0 : 1) : 2) : 3;
}

/** game variables written by FUN_00812dbb: SWITCH_GME_TROPHY_MAP (0x3f) and SWITCH_GME_HISCORE_MAP (0xda) */
export const VAR_TROPHY_MAP = 0x3f, VAR_HISCORE_MAP = 0xda;

/** points: a topping of the right type on the dough (0xfa, FUN_00815576), the end of a round (0xfa, FUN_00812399 case 6), the time bonus per full gauge unit (100 >> 1), the one-off citizen hit (0x1f4) */
export const POINTS_MATCH = 250, POINTS_ROUND = 250, POINTS_PER_GAUGE_UNIT = 50, POINTS_CITIZEN = 500;

/** time gauge (HUD): starts at 12.0 each round (0x41400000) and falls 0.005 per tick (_DAT_008922cc) */
export const GAUGE_START = 12, GAUGE_DECAY = 0.005;

/**
 * FUN_00812dbb(score): raises HISCORE_MAP / TROPHY_MAP like the original and returns [medal of this run, result flag DAT_05d5f3e8].
 * The result flag is 1 (success) when the *stored* trophy is non-zero (the best ever, also from earlier runs), else 2 (failed).
 */
export function finishScore(vars: { get(i: number): number; set(i: number, v: number): void }, score: number): { medal: number; result: 1 | 2 } {
  const hi = vars.get(VAR_HISCORE_MAP);
  const medal = medalOfScore(score);
  let trophy = vars.get(VAR_TROPHY_MAP);
  if (trophy < medal) { vars.set(VAR_TROPHY_MAP, medal); trophy = medal; }
  if (hi < score) vars.set(VAR_HISCORE_MAP, score);
  return { medal, result: trophy !== 0 ? 1 : 2 };
}

// ---- queue of the Ogel citizens (table DAT_00955df8, 5 entries of 0x14 bytes: occupied, record, x, y, z)
/** x, y, z of slot 0..4 (0x955e00 + 0x14 i): 0 the exit on the left, 1 the counter, 2 and 3 the queue, 4 the spawn point on the right */
export const SLOT_POS: [number, number, number][] = [[-8, 0, 6.5], [-1.9, 0, 6.5], [0.5, 0, 6.5], [4.1, 0, 6.5], [16.5, 0, 6.5]];
/** the citizens' per-record tuning block {rate} of FUN_00813733 (0x3f800000 .. 0x3fa66666): animation rate of CIT1 .. CIT4, CIT5 */
export const CITIZEN_RATES = [1.0, 1.1, 0.9, 1.3, 1.3] as const;
/** the clip table the citizens share (&DAT_00955d58 = 4, 4, 2, 7, 10): [1] arrive, [2] react, [3] hit, [4] walk */
export const CITIZEN_CLIPS = [4, 4, 2, 7, 10] as const;

// ---- the camera (FUN_00816220): look-at offset table 0x9560a8 and eye offset table 0x9560c0, mode 0 = overview, 1 = close up on Pepper
export const CAM_LOOK: [number, number, number][] = [[1.5, 2, 8], [0, 3.2, 2]];
export const CAM_EYE: [number, number, number][] = [[2, 4, -5], [0, 5.65, 1.5]];
export const CAM_EASE = 0.25;

/** Papa's hand offset (FUN_00812399): Z rotation 2.1991 (0x400cbe1b) and translation (-0.3, -1, 0.3) at 0x955bf0 */
export const HAND_ROT_Z = 2.1991, HAND_OFFSET = [-0.3, -1, 0.3] as const;
/** the topping in Pepper's hand: translation row of the matrix at 0x955f98 */
export const TOPPING_HAND_OFFSET = [0.094, -0.429, 0.135] as const;

/** compare the numeric tables above with the executable (tests) */
export function readTables(pe: Pe) {
  const u = (va: number) => pe.u32(va);
  const dv = new DataView(new ArrayBuffer(4));
  const f = (va: number) => { dv.setUint32(0, u(va), true); return dv.getFloat32(0, true); };
  return {
    perRound: [0, 1, 2, 3, 4, 5].map((i) => u(0x955bd8 + 4 * i)),
    slotPos: [0, 1, 2, 3, 4].map((i) => [f(0x955e00 + 0x14 * i), f(0x955e04 + 0x14 * i), f(0x955e08 + 0x14 * i)]),
    citizenClips: [0, 1, 2, 3, 4].map((i) => u(0x955d58 + 4 * i)),
    camLook: [[f(0x9560a8), f(0x9560ac), f(0x9560b0)], [f(0x9560b4), f(0x9560b8), f(0x9560bc)]],
    camEye: [[f(0x9560c0), f(0x9560c4), f(0x9560c8)], [f(0x9560cc), f(0x9560d0), f(0x9560d4)]],
    hand: [f(0x955bf0), f(0x955bf4), f(0x955bf8), f(0x955bfc)],
    toppingHand: [f(0x955fc8), f(0x955fcc), f(0x955fd0)],
  };
}
