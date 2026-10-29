// z42BRP "Brickster's palace" (archive z42BRP, zone table index 29, story node 67): constants of the zone code of the original (0x81fd64-0x827700) and the small pure pieces
// of its rules (score from the elapsed time, medals, result variables). Every constant carries the address it comes from; the tests (tools/tests/m6-z42BRP.mjs) compare
// the constants with the executable. DOM-free.
import type { Pe } from '../../formats/exe.ts';

/** game variables: SWITCH_BRP_PEPPSWITCH = the phase of the zone (1 side run, 2 roof; FUN_008387c0), SWITCH_BRP_DOOR = the door / flames of the end cutscene, HISCORE_BRP / TROPHY_BRP (tools/gamevars.tsv) */
export const VAR = { PHASE: 0xfa, DOOR: 0xfb, STARTED_FROM_MENU: 0xb, HISCORE: 0x96, TROPHY: 0xcf } as const;

/** the record indices of the zone (the byte offsets the constructors use / 0x68; names are checked at run time, `checkRecords`) */
export const REC = {
  BRP: 14, SWIC1: 15, SWIC2: 16, SWUP1: 17, SWUP2: 18, STR1: 19, STR2: 20, STR3: 21,
  /** the six platforms that slide in and out (BRI1 x 6) */
  SLIDERS: [22, 23, 24, 25, 26, 27] as readonly number[],
  /** BRI2 / BRI3: the bridges the two switches lower; BRI5: the arc platform; BRI7: the crumbling one; BRI8: the lift at the end of the side run */
  BRI2: 28, BRI3: 29, BRI5: 34, BRI7: 38, BRI8: 39,
  /** the roof floor: five rows of (west block TOP1, four FLR3 tiles); row 0 is the one Pepper stands on at the start */
  ROWS: [[66, 62, 61, 60, 59], [67, 58, 57, 56, 55], [68, 54, 53, 52, 51], [63, 50, 49, 48, 47], [64, 45, 44, 43, 42]] as readonly (readonly number[])[],
  DOOR: 71,
  /** the brick-bot heads the side run's ground probes ignore: BBOT x 6 (73, 74, 75, 88, 89, 76) */
  BBOT: [73, 74, 75, 88, 89, 76] as readonly number[],
  SLUGS: [10, 11, 13, 12] as readonly number[],
  RAT_FIRST: 0, RAT_LAST: 9, SLUG_FIRST: 10, SLUG_LAST: 13,
  PIZZ: 87, PEPP: 90, BSTR: 91, BOTS: [92, 93, 94, 95] as readonly number[],
  /** BBOT 76 / 75 / FLR3 57 / 61 / 62: the reference points the roof set-up measures its directions from */
  SPAWN_A: 76, SPAWN_B: 75, ROW_A: 57, ROW_B: 61, ROW_C: 62,
} as const;
/** record names of the indices above (`checkRecords`) */
export const REC_NAMES: Record<number, string> = {
  14: ' BRP', 15: 'SWIC', 16: 'SWIC', 17: 'SWUP', 18: 'SWUP', 21: 'STR3', 28: 'BRI2', 29: 'BRI3', 34: 'BRI5', 38: 'BRI7', 39: 'BRI8', 71: 'DOOR', 73: 'BBOT', 74: 'BBOT', 75: 'BBOT', 76: 'BBOT',
  87: 'PIZZ', 88: 'BBOT', 89: 'BBOT', 90: 'PEPP', 91: 'BSTR', 92: 'BOT0', 93: 'BOT1', 94: 'BOT2', 95: 'BOT3', 61: 'FLR3', 57: 'FLR3', 62: 'FLR3', 66: 'TOP1', 10: 'SLG0', 11: 'SLG1', 12: 'SLG3', 13: 'SLG2',
};

/** sound table ids (FUN_00820b70 0x820b70; names SND_BRP_*): 2D = FUN_00443580, 3D = FUN_004433b0 */
export const SND = {
  FSMETAL: [0x22d, 0x230, 0x22e, 0x22f] as readonly number[], FSNORMAL: [0x231, 0x234, 0x233, 0x232] as readonly number[], FSPLASTIC: [0x238, 0x236, 0x235, 0x237] as readonly number[],
  JUMP: 0x239, EEK: 0x23a, YEAH: 0x23b, SWITCH: 0x23c, PIZZATHROW: 0x23d, HITHEAD: 0x23e, RUNOVER: 0x23f,
  /** 3D */
  HITVOCAL: [0x240, 0x241, 0x242] as readonly number[], FSBRIDGE: [0x243, 0x244] as readonly number[], PIZZAHITBRIK: 0x245, BBFSMETAL: [0x246, 0x247] as readonly number[],
  MOVEP_BIG: 0x248, MOVEP_MID: 0x249, MOVEP_SMALL: 0x24a, PIZZAHITBOT: 0x24b, MOVEP_UP: 0x24c,
} as const;
/** 2D ids the zone loads / 3D ids (preload lists) */
export const SOUNDS_2D = [0x239, 0x23a, 0x23b, 0x23c, 0x23d, 0x23e, 0x23f, 0x22d, 0x230, 0x22e, 0x22f, 0x231, 0x234, 0x233, 0x232, 0x238, 0x236, 0x235, 0x237] as const;
export const SOUNDS_3D = [0x240, 0x241, 0x242, 0x243, 0x244, 0x245, 0x246, 0x247, 0x248, 0x249, 0x24a, 0x24b, 0x24c] as const;

// ---- the elapsed-time score (FUN_0081fd64 mode 4): the game clock counts 1/60 s (FUN_00435cbb = ftol(ms * 0.06), 0x8921f8)
export const CLOCK_HZ = 60;
/** score = (max(seconds, 60) - 60) * -0x37 + 10000, at least 0 (0x820e.. immediates `* -0x37 + 10000`); seconds = ticks / 0x3c */
export const SCORE_BASE = 10000, SCORE_PER_SECOND = 0x37, SCORE_FREE_SECONDS = 0x3c;
/** medals: silver from 0x13ba, gold from 0x209e (`score < 0x13ba` bronze, `< 0x209e` silver, else gold); below that is still bronze */
export const MEDAL_SILVER = 0x13ba, MEDAL_GOLD = 0x209e;

/** the score of an elapsed time in clock ticks (1/60 s) */
export function scoreOf(clockTicks: number): number {
  let secs = Math.trunc(Math.trunc(clockTicks) / CLOCK_HZ);
  if (secs < SCORE_FREE_SECONDS) secs = SCORE_FREE_SECONDS;
  const s = (secs - SCORE_FREE_SECONDS) * -SCORE_PER_SECOND + SCORE_BASE;
  return s < 0 ? 0 : s;
}
/** 1 bronze (every finish), 2 silver, 3 gold */
export function medalOf(score: number): 1 | 2 | 3 { return score < MEDAL_GOLD ? (score < MEDAL_SILVER ? 1 : 2) : 3; }
/** "MM:SS" of the clock (`%02d:%02d` of ticks / 3600 and (ticks / 60) % 60) */
export function clockText(clockTicks: number): string {
  const t = Math.trunc(clockTicks / CLOCK_HZ);
  const mm = Math.trunc(t / 60), ss = t % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
/** the banner's result variables (FUN_0081fd64 mode 4, every frame): HISCORE raised to the score, TROPHY raised to the medal */
export function writeResult(vars: { get(i: number): number; set(i: number, v: number): void }, score: number): number {
  const medal = medalOf(score);
  if (vars.get(VAR.HISCORE) < score) vars.set(VAR.HISCORE, score);
  if (vars.get(VAR.TROPHY) < medal) vars.set(VAR.TROPHY, medal);
  return medal;
}
/** the speech / text lines of the banner by medal: [first line, second line] of brp.str */
export const RESULT_LINES: Record<number, [string, string]> = { 1: ['OGSGBP05', 'OGSGBP06'], 2: ['OGSGBP03', 'OGSGBP04'], 3: ['OGSGBP01', 'OGSGBP02'] };
/** the text ids of the medals (STD.str) */
export const MEDAL_TEXT: Record<number, string> = { 1: 'SGBRONZE', 2: 'SGSILVER', 3: 'SGGOLD' };

// ---- constants of the nodes (the addresses are where the value is read: .rdata floats `_DAT_00892xxx`, or immediates of the code)
/** the side run (pepbrp, ctor 0x823f08, update 0x822ba8) */
export const RUN = {
  /** ctor: R = BRP's collision radius * 0.465 (0x8929e4) */
  RADIUS_FACTOR: 0.465,
  /** FUN_00823c84: angular speed per tick, 0x8929dc / 0x8929e0 (1.1 degrees) */
  TURN_RATE: 0.0191985,
  /** the hold at the start: 15 ticks (ctor immediate 0x41700000) */
  START_HOLD: 15,
  /** the jump: initial velocity 23 (0x41b80000, FUN_00823c84), time step 0.1 per tick (0x8920cc), gravity -10 (ctor 0xc1200000) */
  JUMP_V0: 23, JUMP_DT: 0.1, GRAVITY: -10,
  /** ground probe: from y + 2.4 (0x8920a8) down 80 (0xc2a00000), sweep radius 0.16 (0x3e23d70a) skin 0.4 (0x3ecccccd); the wall sweep radius 0.08 (0x3da3d70a) skin 0.4 */
  PROBE_UP: 2.4, PROBE_DOWN: -80, SWEEP_RADIUS: 0.16, SWEEP_SKIN: 0.4, WALL_RADIUS: 0.08,
  /** a fall of more than 3.125 (0x8929d8) between two ticks starts the fall; below y 0.625 (0x8929d0) the run restarts */
  DROP_START: 3.125, RESTART_Y: 0.625,
  /** the slope rule: cos(pi / 4) (the double 0x3fe921fb60000000 passed to cos), climbing steeper than that is slowed by 10 (0x892060) */
  SLOPE_COS: 0.7071067811865476, SLOPE_DAMP: 10,
  /** after a restart the 'hold' timer is 30 (0x41f00000) */
  RESTART_HOLD: 30,
  /** the lift (BRI8) carries Pepper up to y = 132.703125 (0x8929f4) in 240 ticks (0x892250) */
  LIFT_TOP: 132.703125, LIFT_TICKS: 240,
} as const;

/** the roof (peptop, ctor 0x8224ba, update 0x821704) */
export const ROOF = {
  /** movement per tick 0.625 (0x8929d0), the camera: eye (x - 0.01, y + 6, z - 10), target (x, y + 3, z) (FUN_008216a0: 0x892030, 0x89228c, 0x892060, 0x892200) */
  STEP: 0.625, CAM_EYE: [-0.01, 6, -10] as readonly number[], CAM_TARGET_UP: 3,
  /** the knock-back by a bot: 20 ticks (0x41a00000) at 0.3125 per tick (0x892880) */
  KNOCK_TICKS: 20, KNOCK_STEP: 0.3125,
  /** the pizza: starts 1.6 above and 1.6 ahead (z) of Pepper (0x892580), flies 1.875 per tick (0x8929cc) for at most 60 ticks (0x892388), spins 0.314159 (0x8929c8) per tick; sweep radius 0.08 skin 0.4 */
  THROW_OFFSET: 1.6, PIZZA_SPEED: 1.875, PIZZA_LIFE: 60, PIZZA_SPIN: 0.314159, PIZZA_RADIUS: 0.08,
  /** the wall sweep (radius 0.16, skin 0.4), the floor probe from y + 2.4 down 40 (0xc2200000); falling: 4 per tick (0x892080), 20 ticks (0x14) then the respawn */
  FLOOR_PROBE_UP: 2.4, FLOOR_PROBE_DOWN: -40, FALL_STEP: 4, FALL_TICKS: 20,
  /** hits on Brickster needed (the third one ends the game) */
  HITS_TO_WIN: 3,
} as const;

/** the bots (bottop, ctor 0x824a02, update 0x8243e5) */
export const BOT = {
  /** speed 0.48 per tick (0x8929e8); respawn delay 90 ticks (0x42b40000); the first delay is rand % 0x5a; the start place is the k / 20 of the row, k = rand % 20 (0x14), spacing 0.05 */
  SPEED: 0.48, RESPAWN: 90, FIRST_DELAY_MOD: 0x5a, START_MOD: 0x14, START_STEP: 0.05,
  /** the ray at Pepper starts 1.6 above the bot (0x892580); the floor probe from y + 2.4 down 40; a floor more than 5 below the roof ends the walk */
  RAY_UP: 1.6, PROBE_UP: 2.4, PROBE_DOWN: -40, FALL_LIMIT: 5, RAY_RADIUS: 0.4, RAY_SKIN: 0.16,
} as const;

/** the roof floor (zonetop, ctor 0x825378, update 0x824c80) */
export const FLOOR = {
  /** a row starts to fall every 300 ticks (0x43960000), falls for 60 ticks (0x3c), the speed starts at 0.3125 (0x3ea00000) and grows by a tenth per tick */
  PERIOD: 300, FALL_TICKS: 60, FALL_START: 0.3125, FALL_GROW: 10,
  /** the door of the end cutscene swings shut in 30 ticks (0x41f00000), 3 degrees per tick (0x3d.. 0.05235988) */
  DOOR_TICKS: 30, DOOR_STEP: 0.05235988,
} as const;

/** Brickster (brickst, ctor 0x82714a, update 0x826b40) */
export const BOSS = {
  /** a leg takes 60 ticks (0x42700000), 45 after the first hit (0x42340000), 30 after the second (0x41f00000) */
  LEG: 60, LEG_HIT1: 45, LEG_HIT2: 30,
  /** ground probe below him: 5 (0xc0a00000) */
  PROBE_DOWN: -5,
} as const;

/** the side run's moving parts (zonebrp, ctor 0x826516, update 0x825850) */
export const PARTS = {
  /** the six sliders move 8 units (0x892090) in 30 ticks (0x892038) out and back */
  SLIDE: 8, SLIDE_TICKS: 30,
  /** BRI2 starts 18.75 high (0x892a08), BRI3 31.25 (0x892a04); lowered 0.375 (0x892a00) / 0.625 (0x8929d0) per tick after the switches */
  BRI2_RAISE: 18.75, BRI3_RAISE: 31.25, BRI2_DROP: 0.375, BRI3_DROP: 0.625,
  /** BRI7 crumbles: falls 0.3125 (0x3ea00000) per tick, growing by a tenth per tick */
  BRI7_START: 0.3125, BRI7_GROW: 10,
  /** BRI5 moves on an arc: 0.00767941 rad (0x8929fc) and 0.0936 up (0x8929f8) per tick, 15 degrees (0.261798, 0x892a0c) wide */
  ARC_STEP: 0.00767941, ARC_RISE: 0.0936, ARC_WIDTH: 0.261798,
  /** the flame bobbers (4 x, period 240 = 0xf0, amplitude 7.8125 = 0x8929ec, 0.0261799 = 0x8929f0 per tick) */
  BOB_PERIOD: 240, BOB_AMPLITUDE: 7.8125, BOB_STEP: 0.0261799,
} as const;

/** the constants above as the executable stores them (tests): [name, address, value] of the float constants */
export const FLOAT_CONSTANTS: readonly [string, number, number][] = [
  ['RADIUS_FACTOR', 0x8929e4, RUN.RADIUS_FACTOR], ['TURN_RATE', 0x8929dc, RUN.TURN_RATE], ['JUMP_DT', 0x8920cc, RUN.JUMP_DT], ['PROBE_UP', 0x8920a8, RUN.PROBE_UP],
  ['DROP_START', 0x8929d8, RUN.DROP_START], ['RESTART_Y', 0x8929d0, RUN.RESTART_Y], ['SLOPE_DAMP', 0x892060, RUN.SLOPE_DAMP], ['LIFT_TOP', 0x8929f4, RUN.LIFT_TOP], ['LIFT_TICKS', 0x892250, RUN.LIFT_TICKS],
  ['STEP', 0x8929d0, ROOF.STEP], ['KNOCK_STEP', 0x892880, ROOF.KNOCK_STEP], ['THROW_OFFSET', 0x892580, ROOF.THROW_OFFSET], ['PIZZA_SPEED', 0x8929cc, ROOF.PIZZA_SPEED],
  ['PIZZA_LIFE', 0x892388, ROOF.PIZZA_LIFE], ['PIZZA_SPIN', 0x8929c8, ROOF.PIZZA_SPIN], ['FALL_STEP', 0x892080, ROOF.FALL_STEP], ['BOT_SPEED', 0x8929e8, BOT.SPEED],
  ['SLIDE', 0x892090, PARTS.SLIDE], ['SLIDE_TICKS', 0x892038, PARTS.SLIDE_TICKS], ['BRI2_RAISE', 0x892a08, PARTS.BRI2_RAISE], ['BRI3_RAISE', 0x892a04, PARTS.BRI3_RAISE],
  ['BRI2_DROP', 0x892a00, PARTS.BRI2_DROP], ['BRI3_DROP', 0x8929d0, PARTS.BRI3_DROP], ['ARC_STEP', 0x8929fc, PARTS.ARC_STEP], ['ARC_RISE', 0x8929f8, PARTS.ARC_RISE], ['ARC_WIDTH', 0x892a0c, PARTS.ARC_WIDTH],
  ['BOB_AMPLITUDE', 0x8929ec, PARTS.BOB_AMPLITUDE], ['BOB_STEP', 0x8929f0, PARTS.BOB_STEP],
];

/** a float32 of the image (tests) */
export function readFloat(pe: Pe, va: number): number {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, pe.u32(va), true);
  return dv.getFloat32(0, true);
}

// ---- name dictionaries of the zone (FUN_0045bff4(dict, name, id) calls: `push id; push name; (mov reg, dict); push reg; call 0x45bff4`), read from the code at run time
const DICT_ADD = 0x45bff4;
/** every `FUN_0045bff4(dict, "NAME", id)` call between `from` and `from + length` as name -> id */
export function readDictionary(pe: Pe, from: number, length: number): Map<string, number> {
  const out = new Map<string, number>();
  const code = pe.slice(from, length);
  if (!code) return out;
  const n = Math.min(length, code.length - 16);
  for (let i = 0; i < n; i++) {
    let id: number, p: number;
    if (code[i] === 0x6a) { id = (code[i + 1] << 24) >> 24; p = i + 2; }                       // push imm8
    else if (code[i] === 0x68 && code[i + 5] === 0x68) { id = code[i + 1] | (code[i + 2] << 8) | (code[i + 3] << 16) | (code[i + 4] << 24); p = i + 5; }   // push imm32 (ids >= 128)
    else continue;
    if (code[p] !== 0x68) continue;
    const str = (code[p + 1] | (code[p + 2] << 8) | (code[p + 3] << 16) | (code[p + 4] << 24)) >>> 0;
    // within the next 12 bytes: the dictionary pointer (mov reg, [abs] = 6 bytes / mov eax, [abs] = 5 bytes), push reg, call rel32 = DICT_ADD
    for (let k = p + 5; k < p + 5 + 14 && k + 5 <= code.length; k++) {
      if (code[k] !== 0xe8) continue;
      const rel = code[k + 1] | (code[k + 2] << 8) | (code[k + 3] << 16) | (code[k + 4] << 24);
      const target = (from + k + 5 + rel) >>> 0;
      if (target === DICT_ADD) { const s = pe.cstr(str); if (s) out.set(s, id); }
      break;
    }
  }
  return out;
}
/** the animation dictionary of the loader FUN_00831690 (DAT_05d4d484: PEP_RUN = 36, PEP_IDLE = 58, BRIK_HITBYPIZZA = 106 ...) */
export const LOADER = 0x831690, LOADER_SPAN = 0x8387c0 - 0x831690;
export const readAnimDictionary = (pe: Pe) => readDictionary(pe, LOADER, LOADER_SPAN);
/** the switch dictionary FUN_008387c0 (DAT_00987e20: SWITCH_BRP_PEPPSWITCH = 0xfa, SWITCH_BRP_DOOR = 0xfb) */
export const readSwitchDictionary = (pe: Pe) => readDictionary(pe, 0x8387c0, 0x200);

/** the clips the nodes start (ids of the animation dictionary / rig clip numbers) */
export const CLIP = { JUMP: 2, RUN: 0x24, IDLE: 0x3a, STUMBLE: 0x4a, BOT_WALK: 0x76, BRIK_RUN: 0x64, BRIK_HIT: 0x6a } as const;
