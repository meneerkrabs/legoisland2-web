// z17WAS "Whack-A-Snake" (Adventure Island): the two behaviour nodes of the zone and the shared state they use. Pure TypeScript (no DOM): the node tests drive it
// with scripted input (tools/tests/m3-z17WAS.mjs). Ported function by function from the decompile (docs/re/m3/z17WAS.md):
//   `pepwas`  constructor 0x69bf24, update FUN_0069b9b0   Pepper's button state machine (wind-up, whack, double press = grab the gem)
//   `zonewas` constructor 0x69b337, update FUN_00699e80   timer, the four snake baskets, scoring, the gem, the cheering skeletons
// The original keeps the state of the nodes in the node structs (offsets in the comments, `p+0x..` = zonewas node, `q+0x..` = pepwas node) and a few
// globals (DAT_00925e58 = the clip Pepper plays, DAT_05d5be4c / be50 / be54 = the result), kept in `WasShared`.
import { NODE_STOP, NODE_CONTINUE } from '../../game/controller.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import { gameRandom } from '../common/tickrand.ts';

/** constructor addresses in the EXE (the `ctor` of the set-up's attaches, docs/re/zone-setup.md) */
export const CTOR_PEPWAS = 0x69bf24, CTOR_ZONEWAS = 0x69b337;

/**
 * Record indices. The builder FUN_0069c040 puts the records at `DAT_00983804 + 0x68 * i`; the zonewas constructor takes them as byte offsets (i * 0x68):
 * snakes 0x68, 0xd0, 0x1a0, 0x138 ... The names are checked at run time (`checkRecords`).
 */
export const REC = {
  PEPP: 0,
  /** SNAK, by basket k = 0..3 (p+0x14 + 4k: 0xd0, 0x68, 0x1a0, 0x138) */
  SNAKE: [2, 1, 4, 3],
  /** the cheering skeletons SKEL (0x208 / 0x270): clips 13 / 14 of MFIG.blk */
  SKEL: [5, 6],
  /** KET2 .. KET8: the basket in the squashed shapes (0x2d8 .. 0x548), KET(n) = KET_FIRST + n - 2 */
  KET_FIRST: 7,
  /** the lid on each basket (p+0x24 + 4k: 0xf70, 0x1040, 0x1110, 0xea0) */
  LID: [38, 40, 42, 36],
  /** the basket BAS0..BAS3 (p+0x34 + 4k: 0xe38, 0x10a8, 0xfd8, 0xf08) */
  BAS: [35, 41, 39, 37],
  /** the zone record `WAS ` the node sits on (0x8f0) */
  WAS: 22,
  GEMM: 34,
} as const;
const NAMES: Record<number, string> = {};
[[REC.PEPP, 'PEPP'], [REC.WAS, 'WAS '], [REC.GEMM, 'GEMM']].forEach(([i, n]) => { NAMES[i as number] = n as string; });
REC.SNAKE.forEach((i) => { NAMES[i] = 'SNAK'; }); REC.SKEL.forEach((i) => { NAMES[i] = 'SKEL'; });
REC.LID.forEach((i, k) => { NAMES[i] = `LID${k}`; }); REC.BAS.forEach((i, k) => { NAMES[i] = `BAS${k}`; });
for (let n = 2; n <= 8; n++) NAMES[REC.KET_FIRST + n - 2] = `KET${n}`;

/** sound table ids (FUN_00699950; names SND_WAS_* of the table) */
export const SND = {
  /** the snake reaches the top (`FLIP_*`), by basket k: DAT_05d5be40 / be3c / be38 / be44 */
  UP: [0x165, 0x166, 0x164, 0x167],
  /** a lid pops (`SNAKE_*`): bdf0 / bde8 / bdf8 / bdfc */
  SPAWN: [0x171, 0x172, 0x170, 0x173],
  /** the hammer hits a snake that is up (`HIT_*`): bddc / bdd4 / bdcc / bdd0 */
  HIT: [0x1c7, 0x1c4, 0x1c6, 0x1c5],
  /** 3D: Pepper's swing (`SWISH1..5`: DAT_05d5be24..be34) and the double press's (`XSWISH1..3`: be18..be20), played at Pepper */
  SWISH: [0x168, 0x169, 0x16a, 0x16b, 0x16c],
  XSWISH: [0x16d, 0x16e, 0x16f],
  GRUNT: [0x177, 0x178],
  /** the clock: > 12 s left (be10), 9..12 (be0c), 1..8 (bde4), 0 = out of time (bdd8) */
  CLOCK_LOW: 0x174, CLOCK_MID: 0x175, CLOCK_HIGH: 0x176, OUT_OF_TIME: 0x1c3,
  /** the first snake of the run (Pepper gasps), the gem is taken */
  GASP: 0x1cf, GET_CRYSTAL: 0x1d0,
  /** the torch fire loop, played every tick */
  TORCH: 0x373,
} as const;
export const ALL_SOUNDS_2D = [...SND.UP, ...SND.SPAWN, ...SND.HIT, ...SND.GRUNT, SND.CLOCK_LOW, SND.CLOCK_MID, SND.CLOCK_HIGH, SND.OUT_OF_TIME, SND.GASP, SND.GET_CRYSTAL, SND.TORCH];
export const ALL_SOUNDS_3D = [...SND.SWISH, ...SND.XSWISH];

/** buttons (InputMapper `pressed` = DAT_00983840) */
const BTN_LEFT = 1, BTN_RIGHT = 2, BTN_UP = 4, BTN_DOWN = 8;
/** Pepper's clips in the zone's MFIG.blk (15 clips) */
export const CLIP = { IDLE: 1, WIN: 2, LOSE: 5, WINDUP: 10, SNAKE_IDLE: 3, SNAKE_SQUASH: 1, SKEL1: 13, SKEL2: 14 } as const;
/** snake states (p+0xc8) */
export const SN = { HIDDEN: 0, RISING: 1, UP: 2, SINKING: 3 } as const;

export const f32 = Math.fround;
/** constants of the zonewas constructor (floats of the executable's code stream, stored in the node) */
export const K = {
  /** p+0xc0: the game lasts 2700 ticks = 90 s (0x4528c000) */
  TIME: 2700,
  /** p+0x74: the snake's travel (0x402a7efa), p+0x78: its hidden y (-0.4), p+0x7c: the lid above the snake (0x4010e560) */
  TRAVEL: f32(2.664), HIDDEN_Y: f32(-0.4), LID_OFFSET: f32(2.264),
  /** p+0xfc / p+0x100 / p+0x104: ticks to rise (6), to sink (9), to stay up (48) */
  RISE_TICKS: 6, SINK_TICKS: 9, UP_TICKS: 48,
  /** _DAT_00892084: the snake stops 0.8 below the full travel */
  TOP_MARGIN: f32(0.8),
  /** p+0x108 (the ctor starts it at 30): the pause between two spawns, by the TICKS LEFT (+0xc0 against _DAT_00892044 = 480, _DAT_00892634 = 930, _DAT_00892630 = 1830):
   *  24 below 1830 left, 19 below 930, 15 below 480 (M5 audit, oracle test: M3 had read the thresholds as ticks played, which made the pauses grow instead of shrink) */
  SPAWN_GAP: [15, 19, 24] as const, GAP_AT: [480, 930, 1830] as const, GAP_START: 30,
  /** _DAT_008921f0: the gem holder's lid sits 0.75 higher */
  HOLDER_LIFT: f32(0.75),
  /** _DAT_008920cc: the gem hovers 0.1 above the lid height */
  GEM_LIFT: f32(0.1),
  /** score: a whacked snake / a stolen gem / a gem lost; the cap */
  SCORE_WHACK: 70, SCORE_GEM: 300, SCORE_LOST: 300, SCORE_MAX: 10000,
  /** the clock sounds start 16 s before the end (p+0x134) */
  BEEPS: 16,
} as const;

/** medal thresholds (FUN_00698efe mode 4: `< 0x65`, `< 0x1389`, `< 0x2135`): bronze 101, silver 5001, gold 8501 */
export const MEDAL = { BRONZE: 101, SILVER: 5001, GOLD: 8501 } as const;
export function medalOfScore(score: number): 0 | 1 | 2 | 3 { return score >= MEDAL.GOLD ? 3 : score >= MEDAL.SILVER ? 2 : score >= MEDAL.BRONZE ? 1 : 0; }
/** FUN_00404d14(&next, exit == 2, 100 < score): the game counts as won above 100 points */
export const isWin = (score: number) => score > 100;

export interface WasSounds {
  /** FUN_004435a0: start a 2D sound (a sound that plays already only refreshes its volume) */
  play(id: number): void;
  /** FUN_004433f0: play a 3D sound at a position (cut beyond its maximum distance) */
  play3D(id: number, x: number, y: number, z: number): void;
  /** restored content (src/restore/features/cues.ts, popups.ts): an event of the swing (`was-hit` with kind 'gem' / 'snake', `was-miss`); undefined = the original */
  cue?(name: string, kind?: string): void;
}
export interface WasRng {
  /** a uniform integer 0 .. n-1 (the original's `ftol(FUN_004388ae(float))` of FUN_00435c91 = GetTickCount, `& 3` / `% 3`, or FUN_004388ae(8.0)) */
  int(n: number): number;
}
export const mathRng: WasRng = { int: (n) => Math.floor(gameRandom() * n) };     // RNG: the C runtime generator
export const silentSounds: WasSounds = { play() {}, play3D() {} };

/** the globals of the zone (DAT_00925e58, DAT_05d5be4c / be50 / be54, the round-robin counters DAT_05d5be58 / be5c) */
export class WasShared {
  /** DAT_00925e58: the clip Pepper plays now (.data value 1). A global of the process: the pepwas constructor does not reset it, so a new run (restart, re-entering the zone)
   *  starts with the clip the previous run left there (M5 audit; `WasShared.resetGlobals()` is for tests) */
  private static clipGlobal = 1;
  private static scoreGlobal = 0; private static gemsGlobal = 0;
  static resetGlobals() { WasShared.clipGlobal = 1; WasShared.scoreGlobal = 0; WasShared.gemsGlobal = 0; }
  get clip(): number { return WasShared.clipGlobal; }
  set clip(v: number) { WasShared.clipGlobal = v; }
  /** DAT_05d5be4c: the game is over */
  done = false;
  /** DAT_05d5be54 / DAT_05d5be50: the final score and gem count (set when the time is up) */
  /** persist across restarts like the original's statics (written only at 0x699fb9 / 0x699fc8, never reset) */
  get finalScore(): number { return WasShared.scoreGlobal; }
  set finalScore(v: number) { WasShared.scoreGlobal = v; }
  get finalGems(): number { return WasShared.gemsGlobal; }
  set finalGems(v: number) { WasShared.gemsGlobal = v; }
  swishRr = 0; xswishRr = 0;
  sounds: WasSounds = silentSounds;
  rng: WasRng = mathRng;
}

const hide = (r: GameRecord) => { r.flags &= ~0xffff; };
const showRec = (r: GameRecord) => { r.flags |= 1; r.flags |= 2; };

/** how the nodes find the records and the rigs of the zone (the original: byte offsets from DAT_00983804) */
export function checkRecords(records: readonly GameRecord[]): string[] {
  const bad: string[] = [];
  for (const [i, n] of Object.entries(NAMES)) { const r = records[+i]; if (!r || r.name !== n) bad.push(`record ${i}: ${r?.name ?? 'missing'} (expected ${n})`); }
  return bad;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// pepwas: Pepper

/** FUN_0069bf24 / FUN_0069b9b0 */
export class PepWasNode implements BehaviourNode {
  readonly kind = 'pepwas';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  readonly shared: WasShared;
  /** q+0x18: the clip Pepper plays, q+0x19: the clip to play after this one (0xff = none), q+0x1a: the result of the last animation step */
  cur = 1; next = 0xff; res = 0;
  /** q+0x1b: busy (the buttons are ignored), q+0x1c: start-up timer, q+0x1d: presses of the current direction (1 = whack, 2 = grab), q+0x20: its button */
  busy = true; timer = 15; presses = 0; dir = -1;
  /** how many ticks the node ran (diagnostics) */
  ticks = 0;
  constructor(shared: WasShared) { this.shared = shared; }

  /** the constructor: Pepper's idle clip */
  init(pep: GameRecord) {
    this.cur = 1; this.busy = true;
    this.timer = 15;                 // __ftol(_DAT_00892074 (15.0) * DAT_008b1718)
    pep.anim?.start(this.cur, 0);
    this.presses = 0; this.next = 0xff; this.dir = -1;
    this.shared.swishRr = 0; this.shared.xswishRr = 0;
  }

  update(w: World, rec: GameRecord): number {
    const sh = this.shared, anim = rec.anim;
    this.ticks++;
    rec.rebuildYaw();                                          // FUN_0043a5e4(rec + 0xc, 0, rec[0x50], 0, x, y, z)
    if (!anim) return NODE_STOP;
    this.res = anim.advance(1.0, w.dt);
    if (this.res === 2) {
      if (this.next === 0xff) {                                // the clip ended and nothing is queued: back to idle
        this.cur = CLIP.IDLE; this.busy = false; this.presses = 0; this.next = 0xff;
        anim.start(this.cur, 0); sh.clip = this.cur;
      } else {
        this.cur = this.next; this.busy = true; this.next = 0xff;
        if (this.presses === 1) {
          sh.sounds.play3D(SND.SWISH[sh.swishRr], rec.x, rec.y, rec.z);
          if (++sh.swishRr > 4) sh.swishRr = 0;
        } else if (this.presses === 2) {
          sh.sounds.play3D(SND.XSWISH[sh.xswishRr], rec.x, rec.y, rec.z);
          if (++sh.xswishRr > 2) sh.xswishRr = 0;
        }
        const g = sh.rng.int(8);                               // FUN_004388ae(8.0): 0 / 1 = a grunt
        if (g === 0) sh.sounds.play(SND.GRUNT[0]); else if (g === 1) sh.sounds.play(SND.GRUNT[1]);
        anim.start(this.cur, 0); sh.clip = this.cur;
      }
    }
    if (this.busy && this.cur !== CLIP.WINDUP) {               // the last 5 frames of a clip already take the next button
      if (anim.frameCount - 5.0 <= anim.frame) { this.busy = false; this.presses = 0; this.next = 0xff; }
    }
    const pressed = w.input.pressed;
    if (!this.busy && pressed !== 0) {
      let started = false;
      if (this.presses === 0) {
        // the first press: the wind-up clip (10) now, the whack clip after it
        if (pressed & BTN_LEFT) { this.cur = CLIP.WINDUP; this.dir = BTN_LEFT; this.next = 3; this.presses++; started = true; }
        if (pressed & BTN_DOWN) { this.cur = CLIP.WINDUP; this.dir = BTN_DOWN; this.next = 0xc; this.presses++; started = true; }
        if (pressed & BTN_RIGHT) { this.cur = CLIP.WINDUP; this.dir = BTN_RIGHT; this.next = 4; this.presses++; started = true; }
        if (pressed & BTN_UP) { this.cur = CLIP.WINDUP; this.dir = BTN_UP; this.next = 0xb; this.presses++; started = true; }
      } else {
        // the same button again during the wind-up: the grab clip (6..9) replaces the whack
        if ((pressed & BTN_LEFT) && this.dir === BTN_LEFT) { this.next = 6; this.busy = true; this.presses++; }
        if ((pressed & BTN_DOWN) && this.dir === BTN_DOWN) { this.next = 9; this.busy = true; this.presses++; }
        if ((pressed & BTN_RIGHT) && this.dir === BTN_RIGHT) { this.next = 7; this.busy = true; this.presses++; }
        if ((pressed & BTN_UP) && this.dir === BTN_UP) { this.next = 8; this.busy = true; this.presses++; }
      }
      if (started) { anim.start(this.cur, 0); sh.clip = this.cur; }
    }
    if (this.timer !== 0 && --this.timer === 0) { this.busy = false; this.next = 0xff; this.presses = 0; }
    return NODE_STOP;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// zonewas: the game

export class ZoneWasNode implements BehaviourNode {
  readonly kind = 'zonewas';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  readonly shared: WasShared;
  /** the records, by the REC table (filled by `bind`) */
  private rec: GameRecord[] = [];
  private bound = false;

  /** p+0xc0: ticks left, p+0xc4: ticks played */
  timeLeft: number = K.TIME; elapsed = 0;
  /** p+0xc8 + 2k: snake state, p+0xd0 + 2k: what happened to it (1 whacked, 2 gem taken), p+0xd8 + 4k: elapsed ticks when it reached the top, p+0xe8 + 4k: its y */
  state = [0, 0, 0, 0]; hit = [0, 0, 0, 0]; topAt = [0, 0, 0, 0]; y = [K.HIDDEN_Y, K.HIDDEN_Y, K.HIDDEN_Y, K.HIDDEN_Y];
  /** p+0x108: ticks between two spawns, p+0x118: elapsed when a snake last rose */
  gap = 30; lastRise = -1;
  /** p+0x10c: the basket whose snake holds the gem (-1 none) */
  holder = -1;
  /** p+0x110: gems taken, p+0x114: hits that counted, p+0x11c: score */
  gems = 0; hits = 0; score = 0;
  /** p+0x130: counts 8 ticks after a hit (the flash of the score: the value is computed and never used), p+0xf9: its flag */
  flash = 0; flashFlag = 0;
  /** p+0x131: nothing spawned yet (the first snake makes Pepper gasp), p+0x134: seconds the clock beeps for, p+0x138: this swing was handled, p+0x13c: a snake is being squashed, p+0x140: skeleton cheer stage */
  first = true; beeps: number = K.BEEPS; lock = false; squash = false; stage = 0;
  /** p+0xb0 + 4k: the record shown as the basket of k (BAS or one of the KET shapes) */
  private shown: GameRecord[] = [];
  /** p+0xf8: the clock is shown */
  showTime = true;
  /** the strings the HUD draws (DAT_05d4dd60 "mm:ss", DAT_05d4dd20 gems, DAT_05d4dd44 hits, the score line): FUN_00699e80 formats them before this tick's swing / spawn logic, so they lag the counters by a tick */
  timeText = ''; gemText = '0'; hitText = '0'; scoreText = '0';
  /** (port) the gem was just shown: its first position is not interpolated */
  private gemFresh = false;
  /** the lid height when closed: p+0x80 = the y of LID0 */
  closedY = 0;
  /** ticks run (diagnostics) */
  ticks = 0;

  constructor(shared: WasShared) { this.shared = shared; }

  /**
   * The constructor (FUN_0069b337) and what the zone's init code puts around it (FUN_00699950 sounds, the builder's animation set-up): finds the records,
   * hides the snakes and the gem, closes the lids, starts the idle clips. `rigs` = anim/SNAK.blk and anim/MFIG.blk of the archive.
   */
  bind(records: readonly GameRecord[], rigs: { SNAK: Blk | null; MFIG: Blk | null }) {
    this.rec = records as GameRecord[];
    const bad = checkRecords(records);
    if (bad.length) throw new Error(`z17WAS: record table differs from the builder: ${bad.slice(0, 4).join('; ')}`);
    const R = (i: number) => records[i];
    this.closedY = R(REC.LID[0]).y;
    for (let k = 0; k < 4; k++) {
      hide(R(REC.SNAKE[k]));                                   // *(p[5+k] + 0x60) = 0
      this.state[k] = 0; this.hit[k] = 0; this.y[k] = K.HIDDEN_Y;
      R(REC.SNAKE[k]).y = K.HIDDEN_Y;                          // *(p[k + 5] + 0x40) = p[k + 0x3a]
      R(REC.LID[k]).y = this.closedY;                          // *(p[k + 9] + 0x40) = p[0x20]
      this.shown[k] = R(REC.BAS[k]);
    }
    R(REC.GEMM).flags = 0x20 << 16;                            // p[0x18]: +0x60 = 0, +0x62 = 0x20 (the record's flags are one 32 bit word)
    // animation instances: the snakes' clip 3 (idle) from the frames 0 / 3 / 7 / 6 of the records 1 / 2 / 3 / 4 (FUN_0043b6a3(rec + 8, 3, frame)), the skeletons' clips 13 / 14
    if (rigs.SNAK) {
      const start = new Map<number, number>([[1, 0], [2, 3], [3, 7], [4, 6]]);
      for (const [i, f] of start) { const r = R(i); r.anim = new AnimInstance(rigs.SNAK); r.anim.start(CLIP.SNAKE_IDLE, f); }
    }
    if (rigs.MFIG) {
      REC.SKEL.forEach((i, n) => { const r = R(i); r.anim = new AnimInstance(rigs.MFIG!); r.anim.start(n === 0 ? CLIP.SKEL1 : CLIP.SKEL2, 0); });
    }
    this.shared.done = false;
    this.bound = true;
  }

  private snd(id: number) { this.shared.sounds.play(id); }

  /** FUN_00699e80 */
  update(w: World): number {
    if (!this.bound) return NODE_CONTINUE;      // not bound by the zone game (a stub world): inert
    const sh = this.shared, R = this.rec, dt = w.dt;
    this.ticks++;
    this.snd(SND.TORCH);
    const elapsed0 = this.elapsed;                             // local_40
    const pepAnim = R[REC.PEPP].anim!;
    if (this.timeLeft <= 0) {
      // the time is up: result, Pepper cheers (more than 100 points) or hangs his head, the snakes go down, the lids close
      sh.done = true;
      sh.finalScore = this.score; sh.finalGems = this.gems;
      if (sh.finalScore < 101) pepAnim.start(CLIP.LOSE, 0); else pepAnim.start(CLIP.WIN, 0);
      for (let k = 0; k < 4; k++) {
        R[REC.SNAKE[k]].y = K.HIDDEN_Y;
        const lid = R[REC.LID[k]];
        lid.setEuler(0, 0, 0, lid.x, this.closedY, lid.z);
      }
    } else {
      const secs = Math.trunc(Math.trunc(this.timeLeft) / 30);  // __ftol / 0x1e
      if (secs <= this.beeps) {
        this.beeps--;
        if (secs >= 13) this.snd(SND.CLOCK_LOW);
        else if (secs >= 9) this.snd(SND.CLOCK_MID);
        else if (secs >= 1) this.snd(SND.CLOCK_HIGH);
        else this.snd(SND.OUT_OF_TIME);
      }
      this.timeLeft = f32(this.timeLeft - dt);
      this.elapsed = f32(this.elapsed + dt);
    }
    if (!this.showTime) this.timeText = '';
    else {
      const t = Math.trunc(this.timeLeft / 30);
      this.timeText = `${String(Math.trunc(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    }
    this.scoreText = String(this.score); this.gemText = String(this.gems); this.hitText = String(this.hits);
    // the pause between two snakes gets shorter as the clock runs down: 30 at the start, 24 below 1830 ticks left, 19 below 930, 15 below 480 (the comparisons use the clock after this tick's decrement)
    if (this.timeLeft >= K.GAP_AT[0]) {
      if (this.timeLeft >= K.GAP_AT[1]) { if (this.timeLeft < K.GAP_AT[2]) this.gap = K.SPAWN_GAP[2]; }
      else this.gap = K.SPAWN_GAP[1];
    } else this.gap = K.SPAWN_GAP[0];

    // ---- the four baskets
    let active = 0;
    for (let k = 0; k < 4; k++) {
      if (this.state[k] === SN.HIDDEN) continue;
      active++;
      const snake = R[REC.SNAKE[k]], lid = R[REC.LID[k]];
      const st = this.state[k];
      if (st === SN.RISING) {
        this.y[k] = f32(this.y[k] + (K.TRAVEL / K.RISE_TICKS) * dt);
        this.lastRise = this.elapsed;                          // p+0x118
        if (this.y[k] >= K.HIDDEN_Y + K.TRAVEL - K.TOP_MARGIN) {
          this.y[k] = f32(K.HIDDEN_Y + K.TRAVEL - K.TOP_MARGIN);
          this.state[k] = SN.UP;
          this.topAt[k] = elapsed0;
          this.snd(SND.UP[k]);
        }
        snake.y = this.y[k];
        if (this.holder === k) { if (lid.y < this.y[k] + K.LID_OFFSET + K.HOLDER_LIFT) lid.y = this.y[k] + K.LID_OFFSET + K.HOLDER_LIFT; }
        else if (lid.y < this.y[k] + K.LID_OFFSET) lid.y = this.y[k] + K.LID_OFFSET;
      } else if (st === SN.UP) {
        if (elapsed0 - this.topAt[k] <= K.UP_TICKS || this.squash) {
          // the lid rides on the snake's head: bone 10 of the snake's pose, in the snake's frame
          const sa = snake.anim!;
          // FUN_0043bc58 reads the matrices the renderer evaluated into the animation's buffer at the end of the previous loop iteration, i.e. the pose of the frame BEFORE this
          // tick's FUN_0043b76a advance (M5 audit: the head, and so the lid, follows one frame behind the snake)
          const bones = sa.pose(1);
          sa.advance(1.0, dt);
          lid.m.set(snake.m);
          if (bones && bones.length >= 11 * 16) {
            const p = lid.toWorld([bones[10 * 16 + 12], bones[10 * 16 + 13], bones[10 * 16 + 14]]);
            if (this.holder === k) p[1] += K.HOLDER_LIFT;
            lid.y = p[1]; lid.x = p[0]; lid.z = p[2];
          }
        } else {
          this.state[k] = SN.SINKING;
          lid.x = snake.x; lid.z = snake.z;
          lid.setEuler(0, 0, 0, lid.x, lid.y, lid.z);
        }
      } else if (st === SN.SINKING) {
        this.y[k] = f32(this.y[k] - (K.TRAVEL / K.SINK_TICKS) * dt);
        snake.y = this.y[k];
        if (this.y[k] <= K.HIDDEN_Y) {
          this.y[k] = K.HIDDEN_Y;
          this.state[k] = SN.HIDDEN;
          hide(snake);
          if (this.holder === k) {
            hide(R[REC.GEMM]);
            this.holder = -1;
            // the snake leaves with the gem (nobody took it, nobody hit the snake): -300
            if (this.hit[k] === 0) { this.score -= K.SCORE_LOST; if (this.score < 0) this.score = 0; }
          }
          this.hit[k] = 0;
        }
        if (this.y[k] + K.LID_OFFSET < lid.y) {
          lid.y = this.y[k] + K.LID_OFFSET;
          if (lid.y < this.closedY) lid.y = this.closedY;
        }
      }
      if (this.holder !== -1) {
        // the gem sits on its snake
        const hs = R[REC.SNAKE[this.holder]], gem = R[REC.GEMM];
        gem.x = hs.x; gem.y = hs.y + K.LID_OFFSET + K.GEM_LIFT; gem.z = hs.z;
        if (this.gemFresh) { gem.savePrev(); this.gemFresh = false; }   // (port) it appears at its snake, it does not slide there from the origin
      }
    }

    // ---- a new snake
    if (active < 3 && this.lastRise + this.gap < this.elapsed) {
      let k = sh.rng.int(4);
      for (let tries = 0; this.state[k] !== SN.HIDDEN; tries++) k = tries < 64 ? sh.rng.int(4) : this.state.indexOf(SN.HIDDEN);   // the original draws until the basket is free
      if (this.first) { this.snd(SND.GASP); this.first = false; }
      this.state[k] = SN.RISING; this.hit[k] = 0;
      showRec(R[REC.SNAKE[k]]);
      R[REC.SNAKE[k]].y = this.y[k];
      R[REC.SNAKE[k]].savePrev();                              // (port) a teleport, not a move: no render interpolation
      this.snd(SND.SPAWN[k]);
      if (this.holder === -1) {
        if (sh.rng.int(3) === 0) { this.holder = k; showRec(R[REC.GEMM]); this.gemFresh = true; }   // one in three snakes holds the gem (while nobody does)
      }
    }

    // ---- Pepper's swing: the hammer lands from frame 2 on
    const pf = pepAnim.frame;
    if (pf < 2.0 || this.lock || sh.clip === 1) {
      if (pf < 2.0) this.lock = false;
    } else {
      this.lock = true;
      let k = -1;
      switch (sh.clip) {                                       // DAT_00925e58 - 3: the clip -> the basket
        case 3: k = 2; break; case 4: k = 3; break; case 6: k = 2; break; case 7: k = 3; break;
        case 8: k = 1; break; case 9: k = 0; break; case 0xb: k = 1; break; case 0xc: k = 0; break;
        default: k = -1;
      }
      if (k !== -1 && this.state[k] !== SN.HIDDEN && this.state[k] !== SN.RISING && this.state[k] !== SN.SINKING) {
        this.snd(SND.HIT[k]);
        let hitKind = '';
        if (this.holder === k) {
          if (sh.clip === 9 || sh.clip === 8 || sh.clip === 6 || sh.clip === 7) {
            // the grab clip on the snake that holds the gem
            this.gems++; this.hits++;
            this.score += K.SCORE_GEM; this.flashFlag = 1; this.flash = 8;
            if (this.score > K.SCORE_MAX) this.score = K.SCORE_MAX;
            this.snd(SND.GET_CRYSTAL);
            hitKind = 'gem';
            this.hit[k] = 2;
            hide(R[REC.GEMM]);
          }
        } else if (sh.clip === 0xc || sh.clip === 0xb || sh.clip === 3 || sh.clip === 4) {
          // the hammer on an ordinary snake
          this.score += K.SCORE_WHACK;
          if (this.score > K.SCORE_MAX) this.score = K.SCORE_MAX;
          this.hits++;
          this.hit[k] = 1; this.flashFlag = 1; this.flash = 8;
          this.squash = true;
          hitKind = 'snake';
          R[REC.SNAKE[k]].anim!.start(CLIP.SNAKE_SQUASH, 0);
        }
        if (hitKind) this.shared.sounds.cue?.('was-hit', hitKind);
      } else if (k !== -1) this.shared.sounds.cue?.('was-miss');       // a swing that lands on an empty / rising / sinking basket
    }

    // ---- the squashed snake follows Pepper's hammer; the basket is replaced by the dented shapes KET2..KET8
    let sq = -1;
    for (let k = 0; k < 4; k++) if (this.hit[k] === 1) { sq = k; break; }
    if (sq >= 0) {
      const f = Math.trunc(pepAnim.frame);                     // local_18
      const snake = R[REC.SNAKE[sq]], lid = R[REC.LID[sq]];
      if (pepAnim.clip === CLIP.WINDUP || pepAnim.clip === 1 || f > 10) {
        // the swing is over: the snake is gone, the lid closes
        this.squash = false; this.hit[sq] = 0;
        this.y[sq] = K.HIDDEN_Y; this.state[sq] = SN.HIDDEN;
        hide(snake);
        lid.y = this.closedY; lid.x = snake.x; lid.z = snake.z;
        snake.anim!.start(CLIP.SNAKE_IDLE, 0);
        hide(this.shown[sq]);
        this.shown[sq] = R[REC.BAS[sq]];
        showRec(this.shown[sq]);
      } else {
        snake.anim!.seek(f - 1);
        if (f > 1 && f < 9) {
          hide(this.shown[sq]);
          const ket = R[REC.KET_FIRST + f - 2];
          ket.m.set(this.shown[sq].m);                         // FUN_0085c0b0(ket + 0xc, shown + 0xc, 0x40)
          ket.savePrev();
          this.shown[sq] = ket;
          showRec(ket);
        }
      }
    }

    // ---- the skeletons cheer every 4 gems (the stages 1..8 alternate the two skeletons)
    const sk1 = R[REC.SKEL[0]].anim!, sk2 = R[REC.SKEL[1]].anim!;
    const stageAt = [3, 7, 11, 15, 19, 23, 27, 31];
    for (let s = 0; s < 8; s++) {
      if (this.gems > stageAt[s] && this.stage === s && (s % 2 === 0 ? sk1 : sk2).advance(1.0, dt) !== 0) this.stage = s + 1;
    }
    if (this.flash > 0) this.flash--;
    return NODE_STOP;
  }

  destroy() { /* FUN_0069b968: stops the torch loop */ }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// camera and zoom of the zone (FUN_00699c4e / FUN_00422b50)

export interface U32Reader { u32(va: number): number }
const f32at = (pe: U32Reader, va: number): number => { const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, pe.u32(va), true); return dv.getFloat32(0, true); };

/** the camera zoom DAT_0089df2c the zone sets at its end (FUN_0040cd1a(0x3ecccccd)): a vertical field of view of 0.4 rad */
export const WAS_FOV = f32(0.4);
/** FUN_00699c4e adds this to the eye's z after FUN_00422b50 (_DAT_00892788 = 7.0) and 0 to its y (_DAT_0089202c) */
export const EYE_Z_SHIFT = 7.0;

/**
 * FUN_00422b50(&camera, PEPP matrix, preset 5) + the zone's shifts: the camera stands in front of the baskets and looks back at Pepper's side.
 * Preset 5 of the table at 0x8adbf8 (12 bytes per preset: the eye offset in Pepper's frame) and the look-at offsets at 0x8adc60 (preset >= 4) are read from
 * the executable; without one the values are the table's (0, 8, 24.8) and (0, 4, 9.6).
 */
export function setWasCamera(world: World, pep: GameRecord, pe: U32Reader | null) {
  const off = pe ? [0, 1, 2].map((i) => f32at(pe, 0x8adbf8 + 5 * 12 + 4 * i)) : [0, 8.0, 24.8];
  const look = pe ? [0, 1, 2].map((i) => f32at(pe, 0x8adc60 + 4 * i)) : [0, 4.0, 9.6];
  const c = world.camera.c;
  c[6] = 0; c[7] = 1; c[8] = 0;
  c[3] = look[0] + pep.x; c[4] = look[1] + pep.y; c[5] = look[2] + pep.z;
  const e = pep.toWorld(off);
  c[0] = e[0]; c[1] = e[1] + 0; c[2] = e[2] + EYE_Z_SHIFT;
  world.camera.updateView();
  world.camera.savePrev();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// glue shared by the zone game and the tests

/** the two nodes of a zone that was set up by `setupZone` (the attaches of the zone's set-up code, by constructor address) */
export interface WasNodes { pepNode: PepWasNode; node: ZoneWasNode; shared: WasShared }

/**
 * What the original's constructors and init code leave behind after the set-up: Pepper runs only `pepwas` (the stub chain of setupZone is dropped), the
 * zonewas node binds its records and animation rigs, the camera and the zoom (`setWasCamera`) are set.
 */
export function prepareWas(world: World, pep: GameRecord, rigs: { SNAK: Blk | null; MFIG: Blk | null }, pe: U32Reader | null): WasNodes {
  const pepNode = pep.ctrl?.nodes.find((n): n is PepWasNode => n.kind === 'pepwas');
  const node = world.records[REC.WAS]?.ctrl?.nodes.find((n): n is ZoneWasNode => n.kind === 'zonewas');
  if (!pepNode || !node) throw new Error('z17WAS: the pepwas / zonewas nodes were not attached by the set-up');
  pep.ctrl!.nodes = [pepNode];
  pep.ctrl!.exclusive = null;
  node.bind(world.records, rigs);
  pepNode.init(pep);
  setWasCamera(world, pep, pe);
  return { pepNode, node, shared: node.shared };
}

/** FUN_00698efe mode 4: the high score (var 200) and the trophy (var 0xd5) are only ever raised; below 101 points the trophy is set to 0 if it was lower */
export function applyResult(vars: { get(i: number): number; set(i: number, v: number): void }, score: number) {
  const V_HISCORE = 200, V_TROPHY = 0xd5;
  if (vars.get(V_HISCORE) < score) vars.set(V_HISCORE, score);
  const medal = medalOfScore(score);
  if (medal > 0 ? vars.get(V_TROPHY) < medal : vars.get(V_TROPHY) < 1) vars.set(V_TROPHY, medal);   // below 101: `if (var < 1) var = 0`
}
/** the end line spoken and drawn for a score (ADSGWS01 gold ... ADSGWS04 below 101) */
export const resultLine = (score: number) => ['ADSGWS04', 'ADSGWS03', 'ADSGWS02', 'ADSGWS01'][medalOfScore(score)];
/** the medal text of the STD table (none below 101) */
export const medalText = (score: number) => ['', 'SGBRONZE', 'SGSILVER', 'SGGOLD'][medalOfScore(score)];
/** the result the loop hands to the shell: 0 running, 1 won (more than 100 points), 2 lost */
export const resultOf = (shared: WasShared): number => (shared.done ? (isWin(shared.finalScore) ? 1 : 2) : 0);
