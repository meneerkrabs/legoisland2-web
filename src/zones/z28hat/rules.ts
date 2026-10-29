// z28HAT "hot-air balloon" (Adventure Island, Mr Hates' dinosaur valley): the shared state, constants and result rules of the zone. Pure TypeScript (no DOM): the node
// tests (tools/tests/m6-z28HAT.mjs) drive the nodes (nodes.ts) with scripted input. Ported from the decompile (docs/re/m6/z28HAT.md); `FUN_...` = address in the NL EXE.
// The original keeps the state in the node structs of the zone's ten behaviours and in a few globals (DAT_05d5d2e4 .. DAT_05d5d3c4, kept in `HatShared`).
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Vec3 } from '../parachute/util.ts';
import { SoundBank } from '../parachute/sound.ts';
import type { SoundDef } from '../parachute/sound.ts';

/** constructor addresses of the zone's behaviours (the `ctor` of the set-up's attaches: FUN_00791990 calls `FUN_00423532(record, ctor, ...)`) */
export const CTOR = {
  PEPP: 0x797d67, BALLOON: 0x79798f, BRONTY: 0x796a05, WINCH: 0x795da0, MRHATES: 0x7956be, DINO: 0x7953d4, BABY: 0x794679, FIREBALL: 0x793867, SANDBAG: 0x7932b6, PTERA: 0x792d38,
} as const;
/** update functions (vtable slot 0 of each node): pepp 0x797ba0 (prerender 0x797c02), balloon 0x796e14, Bronty 0x795f80, winch 0x795770 (prerender 0x795bd6), Mr Hates 0x7955f0, dino 0x794c26, baby 0x793c44, fireball 0x793370, sandbag 0x792e60, pterodactyl 0x792ae0 */
export const UPDATE = { PEPP: 0x797ba0, BALLOON: 0x796e14, BRONTY: 0x795f80, WINCH: 0x795770, DINO: 0x794c26, BABY: 0x793c44, FIREBALL: 0x793370, SANDBAG: 0x792e60, PTERA: 0x792ae0 } as const;

/** records by index (FUN_00791990 addresses them as `DAT_00983804 + 0x68 * i`); the names are checked at run time (`checkRecords`) */
export const REC = {
  /** the player's record: Pepper in the basket */
  PEPP: 151,
  /** the hot-air balloon (HOTB), the node that flies it */
  HOTB: 153,
  /** the brontosaurus (BRON, anim BRON.blk) and Mr Hates (HATE, MFIG.blk) who rides it */
  BRON: 8, HATE: 7,
  /** the winch hook (WNCH) */
  WNCH: 65,
  /** the drop zone (DROP: the landing site the balloon starts at) */
  DROP: 6,
  /** the six big dinosaurs: STE1 STE2 STE3 (stegosaurs, STEG.blk), TRI1 TRI2 (triceratops, TRIC.blk), TREX (TREX.blk); ctor order of FUN_00791990 */
  DINOS: [9, 14, 11, 12, 15, 13],
  /** the five baby tyrannosaurs REX1 .. REX5 (BREX.blk) */
  BABIES: [10, 17, 18, 19, 20],
  /** the fireball FRB1 (the two other FRB records are hidden props without a node) */
  FRB1: 22,
  /** the three sandbags SDB1 .. SDB3 */
  SANDBAGS: [76, 77, 78],
  /** the pterodactyl */
  PTER: 16,
  /** the pizza Bronty eats (PIZ4), hidden by Bronty's update except while he eats */
  PIZ4: 139,
  /** Mr Hates' hologram (HOLO) and the zap prop (ZAPP) */
  HOLO: 21, ZAPP: 150,
  LAND: 1, PAG1: 152, TREX: 13,
  /** the two extra flame sheets FRB2 / FRB3 */
  FLAMES: [63, 64],
} as const;
const NAMES: Record<number, string> = { 151: 'PEPP', 153: 'HOTB', 8: 'BRON', 7: 'HATE', 65: 'WNCH', 6: 'DROP', 22: 'FRB1', 16: 'PTER', 139: 'PIZ4', 21: 'HOLO', 150: 'ZAPP', 1: 'LAND', 152: 'PAG1' };
['STE1', 'STE2', 'STE3', 'TRI1', 'TRI2', 'TREX'].forEach((n, k) => { NAMES[REC.DINOS[k]] = n; });
[1, 2, 3, 4, 5].forEach((n, k) => { NAMES[REC.BABIES[k]] = `REX${n}`; });
[1, 2, 3].forEach((n, k) => { NAMES[REC.SANDBAGS[k]] = `SDB${n}`; });
NAMES[63] = 'FRB2'; NAMES[64] = 'FRB3'; NAMES[22] = 'FRB1';
export function checkRecords(records: GameRecord[]): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(NAMES)) if (records[+i]?.name !== n) bad.push(`record ${i} is ${records[+i]?.name ?? 'missing'}, expected ${n}`);
  return bad;
}

/** game variables (tools/gamevars.tsv): the loop writes the hi-score and the trophy; the winch, Bronty and the balloon's control state are zone-local variables ("SUBGAME 250..252") */
export const VAR = { HISCORE: 0x4a, TROPHY: 0x9d, WINCH: 0xfa, BRONTY: 0xfb, CONTROL: 0xfc } as const;
/** winch states (var 0xfa): 0 hook at the top, 1 lowering, 2 raising, 3 lowering with a dinosaur on it (set by a dinosaur that is hooked) */
export const WINCH = { TOP: 0, LOWER: 1, RAISE: 2, CARRY: 3 } as const;
/**
 * Bronty's states (var 0xfb, FUN_00795f80), with the clip names of the zone's animation dictionary (BRON_BR_*, HATES_*): 0 stance = BURP (fires), 1 freed = TAILFLICK (the end), 2 eats the pizza = FEDPIZZA,
 * 3 hit by a sandbag = HIT, 4 idle = IDLE, 5 Mr Hates runs up his back = RUNUP, 6 roars = CALL (a dinosaur above him), 7 turns left = PULLEDLEFT, 8 turns right = PULLEDRIGHT
 */
export const BRONTY = { STANCE: 0, FREED: 1, EAT: 2, HIT: 3, IDLE: 4, RUNUP: 5, ROAR: 6, TURN_L: 7, TURN_R: 8 } as const;

/** medal thresholds of the loop's score tests (`score < 0x1d4c / 5000 / 0x9c4`, FUN_00790c19 and Bronty's end): bronze 2500, silver 5000, gold 7500 */
export const MEDAL = { BRONZE: 0x9c4, SILVER: 5000, GOLD: 0x1d4c } as const;
/** score cap of the sandbag / final bonuses */
export const SCORE_CAP = 10000;

/** the numbers of the zone code, with the address of the constant in the EXE (floats: `f32`, doubles: `f64`; the node tests read them back) */
export const K = {
  /** 0x93ffe4: the balloon's knock-back lasts 15 ticks */
  KNOCK_TICKS: 15,
  /** 0x940010: the balloon's height above the drop zone */
  BALLOON_HEIGHT: 40,
  /** 0x940014 / 0x940018: thrust ramp per tick / its limit; 0x94001c: turn rate (3 degrees); 0x940020 / 0x940024: damping of the thrust ramp / of the momentum per tick */
  ACCEL: 0.0004, MAX_SPEED: 0.004, TURN: 0.05235987901687622, SPEED_DAMP: 0.02, MOM_DAMP: 0.02,
  /** 0x892090: the thrust vector is scaled by 8 * speed; 0x892544 / 0x892580: the momentum is capped at 1.6 (squared 2.56) */
  THRUST_SCALE: 8, MOM_CAP2: 2.56, MOM_CAP: 1.6,
  /** the balloon's sweeps: below the basket (y - 12.8, radius 3.2 / skin 4.0) and around the centre (radius / skin 5.6) */
  SWEEP_DROP: 12.8, SWEEP1_R: 3.2, SWEEP1_SKIN: 4.0, SWEEP2_R: 5.6,
  /** 0x8922a0 (double): the music fade per tick */
  FADE_STEP: 0.01,
  /** 0x93ffec: shortest rope (the hook hangs 18.4 under the balloon); 0x93fff0 / 0x93fff4: lowering / raising 1.6 per tick */
  ROPE_MIN: 18.4, ROPE_STEP: 1.6,
  /** 0x892938: the rope is drawn from 14.4 below the balloon; 0x892930 (double): the hook sways by heading * 0.03 */
  ROPE_TOP: 14.4, HOOK_SWAY: 0.03,
  /** 0x8921f4 .. : camera offset (0, 15.2, -16) in the balloon's frame (FUN_00796b60), the target 16 under the balloon, easing 0.06 (0.125 of that in y) */
  CAM_OFFSET: [0, 15.2, -16] as Vec3, CAM_TARGET_DROP: 16, CAM_EASE: 0.06, CAM_EASE_Y: 0.125,
  /** the rider's offset below the balloon (FUN_00797d67: 0xc14ccccd) */
  PEPPER_DROP: -12.8,
  /** 0x940030: a landed dinosaur counts for points within 40 of the drop zone (x and z, each); 0x940000: a sandbag hits within 8 of Bronty's mouth */
  DROP_RADIUS: 40, MOUTH_RADIUS: 8,
  /** 0x940004: a hooked dinosaur above Bronty (24 in x and z) makes him roar; 0x94002c: 5000 = 70.7 squared, compared with the balloon's squared 3D distance from the origin (x, y AND z: its own height 65 counts, so it is 27.8 horizontally): Bronty fires and a hooked dinosaur can be let go beyond it */
  ROAR_RADIUS: 24, FAR2: 5000,
  /** 0x940008: a released dinosaur falls 2.4 per tick; 0x93ffe8: the fireball and the sandbag fall / fly 2.4 and 1.6 per tick */
  FALL: 2.4, FIREBALL_SPEED: 2.4, SANDBAG_FALL: 1.6,
  /** 0x940028: a fireball that is 200 from the origin is gone */
  FIREBALL_RANGE2: 40000,
  /** the baby dinosaurs walk 0.4 per tick (double 0x892928) and stay within 6.4 of the nest */
  BABY_SPEED: 0.4, NEST_RADIUS: 6.4,
  /** the landed dinosaurs vanish after 75 ticks (0x42960000) */
  VANISH_TICKS: 75,
  /** points: baby 300, big dinosaur 1000 (landed within the drop zone), sandbag in the mouth 500 / miss -100 (once everything is delivered), Bronty freed 1000 */
  BABY_POINTS: 300, DINO_POINTS: 1000, SANDBAG_HIT: 500, SANDBAG_MISS: -100, FREED_POINTS: 1000,
  /** Bronty turns 0.75 degrees per tick (double 0x892940) and faces the balloon within +-22.5 degrees (0x8924e8) */
  BRONTY_TURN: 0.75, FACING: 0.39269909262657166,
  /** the pterodactyl's Lissajous flight (doubles 0x892450 / 0x892920 / 0x892918): x = sin(2t) * 60 + 35.784, z = cos(t) * 60 + 29.474, t += 0.016 per tick (0x892444 as double: see doc) */
  PTER_R: 60, PTER_X: 35.784, PTER_Z: 29.474, PTER_STEP: 0.01600000075995922,
} as const;

/** sound table ids of the zone's slots (FUN_00792950); 3D ones are played at a position (FUN_004433f0), 2D ones are plain (FUN_004435a0) */
export const HAT_SOUNDS = {
  brontyCall: { id: 0x26, kind: '3d' },       // DAT_05d5d39c roarrev
  brontyBurp: { id: 0x12, kind: '3d' },       // 390 BurpEko
  brontyEat: { id: 0x13, kind: '3d' },        // 3b8 eat
  brexCall: { id: 10, kind: '3d' },           // 398 newbabes (the baby T-rexes, looped)
  fenceBuzz: { id: 8, kind: '3d' },           // 388 elecfence2 (at the T-rex's fence, looped)
  dinoStamp: { id: 7, kind: '3d' },           // 3ac StepRev
  fireballFly: { id: 9, kind: '3d' },         // 394 thrust (looped)
  pterFlap: { id: 6, kind: '3d' },            // 374 flap1 (looped)
  stegRoar: { id: 0xe, kind: '3d' },          // 37c roar1
  tricRoar: { id: 0xf, kind: '3d' },          // 38c roar2
  balloonHit: { id: 0x16, kind: '2d' },       // 36c SND_BALLOON_HIT (no sample in the table: silent)
  balloonFly: { id: 0x15, kind: '2d' },       // 370 thrust (looped while a key is held)
  dinoLand: { id: 0x11, kind: '2d' },         // 3b4 runoff3
  fireballHit: { id: 0x14, kind: '2d' },      // 3a0 FireHit2
  sandbagHit: { id: 0xd, kind: '2d' },        // 378 success
  sandbagMiss: { id: 0xc, kind: '2d' },       // 3bc missed
  sandbagFall: { id: 0xb, kind: '2d' },       // 368 sandrop (looped)
  winchMove: { id: 3, kind: '2d' },           // 380 winch2 (looped)
  wind1: { id: 4, kind: '2d' },               // 3a4 background (looped)
  wind2: { id: 5, kind: '2d' },               // 3a8 crickets (looped)
  hatesHit: { id: 0x93, kind: '2d' },         // 384 Succ_Tail
  hatesFinal: { id: 0x2b8, kind: '2d' },      // 364 Horn2 (loaded, never played)
} as const satisfies Record<string, SoundDef>;
export type HatSound = keyof typeof HAT_SOUNDS;

/** the records the nodes address (looked up once) */
export interface HatRecords {
  pepp: GameRecord; hotb: GameRecord; bron: GameRecord; hate: GameRecord; winch: GameRecord; drop: GameRecord; land: GameRecord; pter: GameRecord; frb1: GameRecord; piz4: GameRecord;
  trex: GameRecord; dinos: GameRecord[]; babies: GameRecord[]; sandbags: GameRecord[];
  /** FRB2 / FRB3: the other two flame sheets (hidden props without a node in the original; the port flies them with the fireball in place of its particle emitter) */
  flames: GameRecord[];
}
export function findRecords(records: GameRecord[]): HatRecords {
  const at = (i: number) => { const r = records[i]; if (!r) throw new Error(`z28HAT: no record ${i}`); return r; };
  return {
    pepp: at(REC.PEPP), hotb: at(REC.HOTB), bron: at(REC.BRON), hate: at(REC.HATE), winch: at(REC.WNCH), drop: at(REC.DROP), land: at(REC.LAND), pter: at(REC.PTER), frb1: at(REC.FRB1), piz4: at(REC.PIZ4),
    trex: at(REC.TREX), dinos: REC.DINOS.map(at), babies: REC.BABIES.map(at), sandbags: REC.SANDBAGS.map(at), flames: [63, 64].map(at),
  };
}

/** the globals of the zone code (one per run); `World.ext` holds it under `HAT_KEY` */
export const HAT_KEY = 'z28HAT';
export class HatShared {
  readonly recs: HatRecords;
  sound: SoundBank<HatSound>;
  /** FUN_00439bf8 + FUN_00435a11: speak up to two lines of the zone table (the zone game replaces it by the speech engine's `say`); the default only records them */
  say: (a: string, b?: string) => boolean = (a, b) => { this.spoken.push(a); if (b) this.spoken.push(b); return true; };
  /** every id spoken (diagnostics) */
  spoken: string[] = [];
  /** DAT_05d5d2e8 / ec / f0: the balloon's momentum (x, y, z) */
  mom: Vec3 = [0, 0, 0];
  /** DAT_05d5d320 / 324 / 328: the push of the last fireball hit */
  push: Vec3 = [0, 0, 0];
  /** DAT_05d5d304: a dinosaur hangs on the hook (the winch does not react to the button, the dinosaur's release does) */
  carrying = false;
  /** DAT_05d5d30c: dinosaurs counted (landed, within the drop zone or not); DAT_0094000c: how many there are (the EXE's 11) */
  delivered = 0;
  total = 11;
  /** DAT_05d5d310: the score */
  score = 0;
  /** DAT_05d5d32d: all dinosaurs are down: the sandbags can be dropped, the music comes back */
  allDone = false;
  /** DAT_05d5d2cc: 0 running, 1 won (score >= 2500), 2 lost; set by Bronty's last state */
  result = 0;
  /** DAT_05d5d314: a medal was earned (set by the banner; the outro cutscene plays then) */
  medal = false;
  /** DAT_05d5d2e4: sandbag hits Bronty counted in his hit state */
  eatCount = 0;
  /** DAT_05d5d316: a fireball hit the balloon while it carried a dinosaur: the dinosaur falls */
  fireballHit = false;
  /** DAT_05d5d2f4 / DAT_05d5d32c: how many stegosaurs / triceratops lines were spoken */
  stegSpeech = 0; tricSpeech = 0;
  /** DAT_05d5d3c0: the winch's copy of var 0xfa; DAT_05d5d3c4: Bronty's copy of var 0xfb */
  winchLast = 0; brontyVar = 0;
  /** _DAT_05d5d2d8 / 2dc / 2e0: the nest of the baby dinosaurs = REX1's place at the start */
  nest: Vec3 = [0, 0, 0];
  /** the music fade scale the balloon node ramps (node +0x80); the host passes it to the music engine */
  fade = 1;
  onFade: (f: number) => void = () => {};
  /** ticks run (diagnostics) */
  ticks = 0;
  constructor(recs: HatRecords, sound: SoundBank<HatSound>) { this.recs = recs; this.sound = sound; }
}

export function sharedOf(w: World): HatShared {
  let s = w.ext.get(HAT_KEY) as HatShared | undefined;
  if (!s) {
    // a world the zone game did not prepare (the stub tests tick the scene with the registered nodes): a private state, no sounds, nodes without their constructor effects
    s = new HatShared(findRecords(w.records), new SoundBank<HatSound>(HAT_SOUNDS, null));
    w.ext.set(HAT_KEY, s);
  }
  return s;
}

/**
 * FUN_00790c19 (the end banner): the hi-score (var 0x4a) is raised to the score (every tick of the banner), the medal and the result lines by score:
 * gold >= 7500 (ADSGMC01 + 02), silver >= 5000 (03), bronze >= 2500 (04), below: ADSGMC05
 */
export function applyResult(vars: { get(i: number): number; set(i: number, v: number): void }, score: number) {
  if (vars.get(VAR.HISCORE) < score) vars.set(VAR.HISCORE, score);
}
/** medal level of a score: 3 gold, 2 silver, 1 bronze, 0 none (`score < 0x1d4c`, `< 5000`, `< 0x9c4` in FUN_00790c19) */
export const medalOf = (score: number): 0 | 1 | 2 | 3 => (score < MEDAL.GOLD ? (score < MEDAL.SILVER ? (score < MEDAL.BRONZE ? 0 : 1) : 2) : 3);
/** the result lines of the banner (message ids, y positions 200 / 320 as the loop draws them) and the ones it speaks */
export function resultLines(score: number): { id: string; y: number }[] {
  const m = medalOf(score);
  if (m === 3) return [{ id: 'ADSGMC01', y: 200 }, { id: 'ADSGMC02', y: 0x140 }];
  return [{ id: ['ADSGMC05', 'ADSGMC04', 'ADSGMC03'][m], y: 200 }];
}
export const medalText = (score: number) => ['', 'SGBRONZE', 'SGSILVER', 'SGGOLD'][medalOf(score)];

/**
 * Bronty's last state (FUN_00795f80 case 1, when his clip ends): +1000 (cap 10000), the trophy variable (var 0x9d: 3 gold, silver / bronze only raised, set to 0 below
 * 2500) and the result (1 from 2500 points, 2 below)
 */
export function finishGame(S: HatShared, vars: { get(i: number): number; set(i: number, v: number): void }) {
  S.score += K.FREED_POINTS;
  if (S.score > SCORE_CAP) S.score = SCORE_CAP;
  const old = vars.get(VAR.TROPHY);
  const s = S.score;
  if (s < MEDAL.GOLD) {
    if (s < MEDAL.SILVER) {
      if (s < MEDAL.BRONZE) { vars.set(VAR.TROPHY, 0); S.result = 2; } else { if (old < 1) vars.set(VAR.TROPHY, 1); S.result = 1; }
    } else { if (old < 2) vars.set(VAR.TROPHY, 2); S.result = 1; }
  } else { vars.set(VAR.TROPHY, 3); S.result = 1; }
}

/** the executable's reader the dictionary scan needs (`Pe`) */
export interface CodeReader { at(va: number): number; u32(va: number): number; cstr(va: number, max?: number): string }
/**
 * The zone's animation dictionary (`DAT_05d4d484`, name -> clip number, resolved by SETANIM of the cutscene scripts): the loader FUN_007a6bf3 creates it with `FUN_0045bf20(0xae)` and adds its 174 entries with
 * `FUN_0045bff4(dict, "NAME", clip)`: `push clip; push name; mov reg, [0x5d4d484]; push reg; call 0x45bff4` in the code stream. Read at run time (names `PEP_*`, `XTALK3`, `INFO_PONDERING`, `HATES_*`,
 * `BRON_BR_*` (Bronty's clips), `STEG_*`, `TRIC_*`, `TREX_*`, `PTER_*`: the clip names of the rigs, which also document what the zone's clip numbers mean).
 */
export const ANIM_DICT = { loader: 0x7a6bf3, end: 0x7aef10, dict: 0x5d4d484, add: 0x45bff4 } as const;
export function readAnimDictionary(pe: CodeReader): Map<string, number> {
  const out = new Map<string, number>();
  for (let a = ANIM_DICT.loader; a < ANIM_DICT.end; a++) {
    if (pe.at(a) !== 0xe8 || (((a + 5 + (pe.u32(a + 1) | 0)) >>> 0) !== ANIM_DICT.add)) continue;
    let p = a - 1;
    if ((pe.at(p) & 0xf8) !== 0x50) continue;                                                         // push reg
    if (pe.at(p - 5) === 0xa1 && pe.u32(p - 4) === ANIM_DICT.dict) p -= 5;                            // mov eax, [dict]
    else { p -= 6; if (pe.at(p) !== 0x8b || pe.u32(p + 2) !== ANIM_DICT.dict) continue; }            // mov ecx / edx, [dict]
    p -= 5; if (pe.at(p) !== 0x68) continue;                                                          // push name
    const name = pe.cstr(pe.u32(p + 1));
    let v: number;
    if (pe.at(p - 2) === 0x6a) v = (pe.at(p - 1) << 24) >> 24;                                       // push imm8 clip
    else if (pe.at(p - 5) === 0x68) v = pe.u32(p - 4) | 0;                                           // push imm32 clip
    else continue;
    if (!out.has(name)) out.set(name, v);
  }
  return out;
}
