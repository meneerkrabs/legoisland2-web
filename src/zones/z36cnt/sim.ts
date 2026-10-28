// z36CNT, the centrifuge (G-force training): the game logic, DOM-free. Everything here is a port of the zone's per-frame code (Walk.c's TRAI controller
// FUN_007b20a8 with its state machine FUN_007b0c6e and the input / lights function FUN_007b0401, the technician Bob FUN_007b2836 / FUN_007b24a2, the monitor
// frame ranges FUN_007aff48 / FUN_007aff9f, the engine pitch FUN_007af902, the HUD feed FUN_007aef49). Field names of the controller object carry their
// offsets (`+0xf8` ...) so the decompile can be followed. docs/re/m3/z36CNT.md has the full map.
//
// The host (the zone game in ../z36CNT.ts, or a test) supplies Pepper's and Bob's animation instances, the record visibility switches, the sound calls,
// the speech, the game variables, a random source and the monitor texture frame; the sim never touches the DOM or the renderer.

/** float32 rounding: the original keeps these fields as 32-bit floats (stores round, x87 temporaries do not) */
const f = Math.fround;
import { f32 as bits } from './util.ts';
export { bits };

export const TWO_PI = f(6.2831855);          // _DAT_00892094
export const PI = f(3.1415927);              // _DAT_0089207c
export const HALF_PI = f(1.5707964);         // _DAT_00892220
export const THREE_HALF_PI = f(4.712389);    // _DAT_008922b4

/** scene record indices of the zone (the original addresses them as DAT_00983804 + 0x68 * i; the names are checked when the zone loads) */
export const REC = {
  TBOB: 0, CHAI: 1, WEIG: 2, FLOR: 3, RGRN: 4, RYEL: 5, LYEL: 6, LGRN: 7,
  LIGH0: 8, LIGH1: 9, LIGH2: 10, LIGH3: 11, LION0: 12, LION1: 13, LION2: 14, LION3: 15, LLIT: 16, RLIT: 17, TRAI: 18, PEPP: 19,
} as const;
export const REC_NAMES = ['TBOB', 'CHAI', 'WEIG', 'FLOR', 'RGRN', 'RYEL', 'LYEL', 'LGRN', 'LIGH', 'LIGH', 'LIGH', 'LIGH', 'LION', 'LION', 'LION', 'LION', 'LLIT', 'RLIT', 'TRAI', 'PEPP'];

/** sound-table ids the zone loads in FUN_007af780 (FUN_00443580(id)) */
export const SND = {
  AMBIENT: 0xca, SEATBELT: 0xcb, VISOR: 0xcc, PHEW: 0xcd, BIGBUTTON: 0xce, START: 0xcf, BRAKE_OFF: 0xd0, BRAKE: 0xd1, ENGINE: 0xd2, SWISH: 0xd3,
  LRED: 0xd4, LGREEN: 0xd5, RRED: 0xd6, RGREEN: 0xd7, KLAXON: 0xd8, BOB_BUTTON1: 0xd9, BOB_BUTTON2: 0xda, BOB_BUTTON3: 0xdb, BOB_BUTTON4: 0xdc,
} as const;

/** Pepper's clips of the zone's MFIG.blk (the `+0xfc` field of the controller) */
export const PEP = { IDLE: 1, SPIN: 2, MAXG: 3, PHEW: 8, VISOR: 0xc, START: 0xe, BELT: 0xf } as const;
/** Bob's clips */
export const BOB = { IDLE: 5, BUTTON_A: 9, BUTTON_B: 10, BUTTON_C: 0xb, BUTTON_D: 6, CLIP_7: 7, CLIP_4: 4 } as const;

/** game variables */
export const VAR_TROPHY_CNT = 0x86, VAR_HISCORE_CNT = 0x9b;
/** medal limits: the score at the time-out must exceed 1999 to count for a medal, silver from 4000, gold from 6000 (FUN_007b0c6e case 4 / 5, FUN_007b0085) */
export const MEDAL_MIN = 2000, MEDAL_SILVER = 4000, MEDAL_GOLD = 6000;

export interface AnimLike {
  frame: number;
  readonly frameCount: number;
  start(clip: number, frame?: number): boolean;
  seek(frame: number): boolean;
  advance(rate: number, dt?: number): number;
}

export interface CntHost {
  pep: AnimLike;
  bob: AnimLike;
  /** show / hide a scene record (flags bit 2) */
  show(rec: number, on: boolean): void;
  /** FUN_004435a0 (start, or keep playing) / FUN_004435b0 (stop) of a loaded sound slot */
  play(snd: number): void;
  stop(snd: number): void;
  /** FUN_00443600: playback rate in Hz of a playing sound */
  rate(snd: number, hz: number): void;
  /** FUN_00439bf8 + FUN_00435a11: speak a line of cnt.str */
  say(id: string): void;
  getVar(i: number): number;
  setVar(i: number, v: number): void;
  /** rand() / RAND_MAX */
  rand(): number;
  /** the visor attachment's rotation (the matrix FUN_0043a5e4(+0x158, angle, 0, 0, tx, ty, tz) that FUN_0043e910 hands to the model) */
  visor(angle: number): void;
}

/** Constants of the TRAI controller constructor (FUN_007b20a8, immediates) */
export const K = {
  /** +0xd8 / +0xdc: angular speed at power 0 / 1 (radians per tick): 3 and 15 degrees */
  OMEGA_MIN: bits(0x3d567704), OMEGA_MAX: bits(0x3e860a63),
  /** +0xe0: power gained per good press */
  BOOST: bits(0x3c23d70a),
  /** +0xe4: half width of the TOP / BOTTOM windows in units of OMEGA_MAX */
  WINDOW: bits(0x40300000),
  /** +0xe8: the time limit, 1800 ticks = 60 s; +0xec: 90 (unused) */
  TIME: bits(0x44e10000),
} as const;

/** state machine states (+0xf8) */
export const S = { INIT: 0, BELT: 1, START: 2, RUN: 3, STOP: 4, RESULT: 5, DONE: 6, WAIT: 7 } as const;

/** the table of monitor frame ranges at 0x944268: (first, last) pairs, indexed by the monitor state */
export const FRAME_TABLE_VA = 0x944268;
export const FRAME_TABLE_LEN = 9;

export class CentrifugeSim {
  readonly host: CntHost;
  readonly table: ReadonlyArray<readonly [number, number]>;
  // ---- controller fields (offsets of the TRAI controller object)
  /** +0xf0 time left in ticks */ time = K.TIME;
  /** +0xf4 */ bonusHits = 0;
  /** +0xf8 */ state: number = S.INIT;
  /** +0xfc Pepper's clip */ clip: number = PEP.IDLE;
  /** +0x100 power passed 0.75 once */ reached75 = false;
  /** +0x104 / +0x108 left / right latch: a press (or an early press) in this half */ latchL = false; latchR = false;
  /** +0x10c power reached 1.0 (bonus phase) */ bonus = false;
  /** +0x110 rotation angle 0..2 pi */ angle = 0;
  /** +0x114 power 0..1 */ power = 0;
  /** +0x11c streak 0..20 */ streak = 0;
  /** +0x120 streak reset request */ resetStreak = false;
  /** +0x124 / +0x128 the previous / current window was hit */ prevHit = false; hit = false;
  /** +0x12c the score */ score = 0;
  /** +0x130 in a scoring window (TOP or BOTTOM) */ inWindow = false;
  /** +0x134 launch phase: no scoring until the arm passed the first window edge */ launch = true;
  /** +0x14c a swish was played this revolution */ swish = false;
  // ---- the monitor's frame range machine (+0x138 ..)
  /** +0x138 current / +0x13c next range index, +0x140 frame, +0x144 / +0x148 range ends */
  mon = { cur: 0, next: 7, frame: 0, start: 0, end: 0 };
  /** +0x150 / +0x154 visor angle and its step; +0x198 first-visor-tick flag */
  visorAngle = 0; visorStep = 0; visorFirst = true;
  // ---- Bob (FUN_007b2836 / FUN_007b24a2)
  bobState = 7; bobSpeed = 1;
  // ---- zone globals shared by the two nodes and the loop
  /** DAT_05d5d4e4: the state Bob enters after the current clip (FUN_007b2460) */ bobNext = 0;
  /** DAT_05d5d49c: power as Bob sees it (copied while running) */ bobPower = 0;
  /** DAT_05d5d424: the displayed score (counts up 17 per tick); DAT_05d5d46c: score reached the medal minimum; DAT_05d5d470: result 0 / 1 won / 2 lost */
  shownScore = 0; medalOk = false; result = 0;
  /** DAT_05d5d474 / DAT_05d5d468 / DAT_05d5d47c / DAT_05d5d48c / DAT_05d5d420: HUD feed (streak, time left, bonus hits, power, monitor frame) */
  hudStreak = 0; hudTime = 0; hudBonus = 0; hudPower = 0; hudFrame = 0;
  /** DAT_05d5d3cc: LESGCE08 was spoken */ saidDizzy = false;
  /** ticks run */ ticks = 0;

  constructor(host: CntHost, table: ReadonlyArray<readonly [number, number]>) {
    this.host = host;
    this.table = table;
    this.setBobNext(0);                                 // FUN_007b2836 -> FUN_007b2460(0)
    host.pep.start(PEP.IDLE, 0);                        // FUN_007b20a8: FUN_0043b6a3(pep, 1, 0)
    this.monSet(7, 7);                                  // FUN_007aff48(+0x138, table, 7) after +0x13c = 7
  }

  /** FUN_007b2460: Bob's next state = max(0, n), more than 3 -> 4 */
  setBobNext(n: number) { let v = n < 1 ? 0 : n; if (v > 3) v = 4; this.bobNext = v; }

  // ---------------------------------------------------------------- the monitor frame ranges

  /** FUN_007aff48(range, table, step): the range `next` becomes current, the one after it is `cur + step` */
  private monSet(next: number, step: number) {
    const m = this.mon;
    m.next = next;
    m.cur = m.next;
    m.next = m.cur + step;
    const e = this.table[m.cur] ?? [0, 0];
    m.start = e[0]; m.end = e[1];
    m.frame = m.start;
  }
  /** FUN_007aff9f: one frame forward; true when the end of the range was reached (the frame restarts at the range start) */
  private monAdvance(): boolean {
    const m = this.mon;
    m.frame = f(m.frame + 1);
    if (m.frame >= m.end) { m.frame = m.start; return true; }
    return false;
  }

  // ---------------------------------------------------------------- one tick of FUN_007b0c6e

  /** `pressed` = the buttons that went down this tick (DAT_00983840: 1 left, 2 right, 0x40 the action button) */
  step(pressed: number) {
    const h = this.host;
    this.ticks++;
    h.play(SND.AMBIENT);
    switch (this.state) {
      case S.INIT:
        this.hudStreak = 0; this.shownScore = 0; this.medalOk = false;
        this.state = S.BELT;
        break;
      case S.BELT:
        if (pressed & 0x40) { this.state = S.WAIT; this.clip = PEP.BELT; h.pep.start(this.clip, 0); this.setBobNext(1); }
        break;
      case S.START:
        if (pressed & 0x40) { this.state = S.WAIT; this.clip = PEP.START; h.pep.start(this.clip, 0); h.play(SND.BRAKE_OFF); }
        break;
      case S.RUN:
        this.windows(pressed);
        this.angle = f(f(f(f(K.OMEGA_MAX - K.OMEGA_MIN) * this.power + K.OMEGA_MIN) * 1) + this.angle);
        if (this.angle >= TWO_PI) this.angle = f(this.angle - TWO_PI);
        this.bobPower = this.power;
        this.pitch(); h.play(SND.ENGINE);
        if (this.angle < 0.5 || this.swish) { if (this.angle < 0.5) this.swish = false; }
        else { h.play(SND.SWISH); this.swish = true; }
        break;
      case S.STOP:
        this.pitch(); h.play(SND.ENGINE); h.play(SND.SWISH);
        if (this.score > MEDAL_MIN - 1) this.medalOk = true;
        this.power = f(this.power - f(0.01));
        h.show(REC.RYEL, true); h.show(REC.LYEL, true); h.show(REC.RGRN, false); h.show(REC.LGRN, false); h.show(REC.RLIT, false); h.show(REC.LLIT, false);
        {
          const omega = f(f(K.OMEGA_MAX - K.OMEGA_MIN) * this.power + K.OMEGA_MIN);
          this.angle = f(omega + this.angle);
          if (TWO_PI < this.angle) this.angle = f(this.angle - TWO_PI);
          if (this.power <= 0) {
            this.power = 0;
            if (this.angle < omega) {
              this.angle = 0;
              h.play(SND.BRAKE);
              if (!this.reached75) this.state = S.RESULT;
              else { this.clip = PEP.PHEW; h.pep.start(this.clip, 0); this.state = S.WAIT; h.play(SND.PHEW); }
            }
          }
        }
        break;
      case S.RESULT:
      case S.DONE:
        if (this.state === S.RESULT) {
          h.stop(SND.ENGINE); h.stop(SND.SWISH);
          this.shownScore = this.score;
          this.state = S.DONE;
          const best = h.getVar(VAR_HISCORE_CNT);
          if (best < this.shownScore) {
            h.setVar(VAR_HISCORE_CNT, this.shownScore);
            if (!this.medalOk) h.setVar(VAR_TROPHY_CNT, 0);
            else if (this.shownScore < MEDAL_GOLD) h.setVar(VAR_TROPHY_CNT, this.shownScore < MEDAL_SILVER ? 1 : 2);
            else h.setVar(VAR_TROPHY_CNT, 3);
          }
        }
        this.result = h.getVar(VAR_HISCORE_CNT) < MEDAL_MIN ? 2 : 1;
        break;
      default: break;
    }

    // ---- the visor of the helmet closes while Pepper's clip 0xc plays
    if (this.clip === PEP.VISOR) {
      const fr = Math.trunc(h.pep.frame);
      if (fr > 0x1a && fr < 0x1d) h.play(SND.VISOR);
      if (this.visorFirst) {
        this.visorAngle = 0; this.visorStep = f(0.1); this.visorFirst = false;
        this.monSet(8, 8);
      } else {
        if (fr > 0x19 && fr < 0x23) { this.visorAngle = f(this.visorAngle + this.visorStep); h.visor(f(this.visorAngle * 1)); }
        if (fr > 0x22) this.monSet(0, 0);
      }
    }
    // ---- the monitor's frame ranges: a finished range picks the next one by power
    if (this.monAdvance()) {
      const m = this.mon;
      switch (m.cur) {
        case 0: case 2: case 4: case 6: {
          const p = this.power;
          let next: number;
          if (p >= 0.125) next = p >= 0.5 ? (p >= 0.75 ? 5 : 3) : 1; else next = 0;
          if (next + 1 !== m.cur) { m.next = next; this.monSet(next, 1); }
          break;
        }
        case 1: case 3: case 5: this.monSet(m.next, 1); break;
        default: break;
      }
    }
    // ---- the four light pairs follow the quarter of the turn the arm is in
    const a = this.angle;
    if (a <= 0 || HALF_PI <= a) {
      if (a <= HALF_PI || PI <= a) {
        if (a <= PI || THREE_HALF_PI <= a) {
          if (a > THREE_HALF_PI && a < TWO_PI) { h.show(REC.LIGH2, false); h.show(REC.LION2, true); h.show(REC.LION3, false); h.show(REC.LIGH3, true); }
        } else { h.show(REC.LIGH1, false); h.show(REC.LION1, true); h.show(REC.LION2, false); h.show(REC.LIGH2, true); }
      } else { h.show(REC.LIGH0, false); h.show(REC.LION0, true); h.show(REC.LION1, false); h.show(REC.LIGH1, true); }
    } else { h.show(REC.LIGH3, false); h.show(REC.LION3, true); h.show(REC.LION0, false); h.show(REC.LIGH0, true); }

    this.hudFrame = Math.trunc(this.mon.frame);
    this.hudTime = this.time;
    this.hudBonus = this.bonusHits;
    if (this.shownScore < this.score) { this.shownScore += 17; if (this.score < this.shownScore) this.shownScore = this.score; }
    this.hudStreak = this.streak;
    this.hudPower = this.power;

    // ---- Pepper's clip: scrubbed by the power while it is the spin clip, otherwise it plays and its end advances the state
    if (this.clip === PEP.SPIN) {
      h.pep.seek(f(h.pep.frameCount * this.power));
    } else {
      const r = h.pep.advance(1);
      if (r === 0 && this.clip === PEP.BELT) {
        const fr = Math.trunc(h.pep.frame);
        if (fr > 0x13 && fr < 0x16) { h.play(SND.SEATBELT); h.say('LESGCE09'); }
      }
      if (r !== 0) {
        switch (this.clip) {
          case PEP.PHEW: this.clip = PEP.IDLE; this.state = S.RESULT; break;
          case PEP.VISOR: this.clip = PEP.IDLE; this.state = S.START; break;
          case PEP.START:
            this.clip = PEP.SPIN; this.power = 0; this.resetStreak = false; this.hit = false; this.prevHit = false; this.inWindow = false;
            this.time = K.TIME; this.state = S.RUN; this.setBobNext(4);
            break;
          case PEP.BELT: this.clip = PEP.VISOR; break;
          default: break;
        }
        h.pep.start(this.clip, 0);
      }
    }
  }

  /** FUN_007af902: engine and swish pitch follow the power of the previous tick (DAT_05d5d48c) */
  private pitch() {
    const p = this.hudPower;
    this.host.rate(SND.ENGINE, 0x3880 + Math.trunc(0xfd94 * p));
    this.host.rate(SND.SWISH, 0x204c + Math.trunc(0x8bf8 * p));
  }

  // ---------------------------------------------------------------- FUN_007b0401: the windows, the lights, the score

  /** the part of the arm angle's half-turn the player is in: 'top' (press left), 'bottom' (press right), 'right' / 'left' (the early-press zones in between) */
  zoneOf(ang = this.angle): 'top' | 'bottom' | 'right' | 'left' {
    let c = ang;
    if (c <= PI) { if (c < -PI) c = f(c + TWO_PI); } else c = f(c - TWO_PI);
    if (PI < c) c = f(c - TWO_PI);
    const win = f(K.WINDOW * K.OMEGA_MAX);
    if (!(c < -win || win < c)) return 'top';
    if (c <= win || PI - win <= c) {
      if (PI - win <= c || c <= -(PI - win)) return 'bottom';
      return 'left';
    }
    return 'right';
  }

  private windows(pressed: number) {
    const h = this.host;
    let c = this.angle;
    if (c <= PI) { if (c < -PI) c = f(c + TWO_PI); } else c = f(c - TWO_PI);
    const win = f(K.WINDOW * K.OMEGA_MAX);
    if (pressed & 3) h.play(SND.BIGBUTTON);
    if (PI < c) c = f(c - TWO_PI);
    if (!this.launch) {
      if (c < -win || win < c) {
        if (c <= win || PI - win <= c) {
          if (PI - win <= c || c <= -(PI - win)) {
            // BOTTOM: press right
            h.show(REC.RGRN, false); h.show(REC.RLIT, false); h.show(REC.RYEL, true); h.show(REC.LYEL, false); h.show(REC.LGRN, true);
            this.inWindow = true;
            if ((pressed & 2) && !this.latchR) this.goodPress(SND.RGREEN, 'R');
          } else if (c < -win && -(PI - win) < c) {
            // LEFT zone (between bottom and top): the bottom window ends here
            if (this.inWindow) {
              h.show(REC.LGRN, false);
              if (!this.hit) { h.show(REC.LLIT, true); this.resetStreak = true; h.play(SND.LRED); } else h.show(REC.LYEL, true);
              if (this.hit && this.prevHit) this.power = f(this.power + K.BOOST);
              this.prevHit = this.hit; this.hit = false; this.inWindow = false; this.latchR = false;
            }
            if (pressed & 1) this.latchL = true;
          }
        } else {
          // RIGHT zone (between top and bottom): the top window ends here
          if (this.inWindow) {
            h.show(REC.RGRN, false);
            if (!this.hit) { h.show(REC.RLIT, true); this.resetStreak = true; h.play(SND.RRED); } else h.show(REC.RYEL, true);
            if (this.hit && this.prevHit) this.power = f(this.power + K.BOOST);
            this.prevHit = this.hit; this.hit = false; this.inWindow = false; this.latchL = false;
          }
          if (pressed & 2) this.latchR = true;
        }
      } else {
        // TOP: press left
        h.show(REC.LGRN, false); h.show(REC.LLIT, false); h.show(REC.LYEL, true); h.show(REC.RYEL, false); h.show(REC.RGRN, true);
        this.inWindow = true;
        if ((pressed & 1) && !this.latchL) this.goodPress(SND.LGREEN, 'L');
      }
    } else {
      h.play(SND.START);
      if (c > win) this.launch = false;
    }
    if (this.resetStreak) { this.streak = 0; this.hudStreak = 0; this.resetStreak = false; }
    this.time = f(this.time - 1);
    if (this.time <= 0) {
      this.time = 0; this.state = S.STOP; this.setBobNext(1);
      this.clip = PEP.SPIN; h.pep.start(this.clip, 0);
      this.streak = 0; this.hudStreak = 0;
    }
    if (0.75 < this.power) {
      this.reached75 = true;
      if (this.power >= 1) {
        this.power = 1;
        if (!this.bonus) {
          this.clip = PEP.MAXG; h.pep.start(this.clip, 0);
          this.bonus = true;
          this.score += 0x1ea;
          if (!this.saidDizzy) { h.say('LESGCE08'); this.saidDizzy = true; }
        }
      }
    }
  }

  /** a press in the right window: latch, power, score (20 + 5 per streak step), streak up to 20, bonus counter in the bonus phase */
  private goodPress(snd: number, side: 'L' | 'R') {
    if (side === 'L') this.latchL = true; else this.latchR = true;
    this.hit = true;
    this.host.play(snd);
    this.power = f(this.power + K.BOOST);
    this.score += 0x14 + this.streak * 5;
    if (this.streak < 0x14) this.streak++;
    if (this.bonus) this.bonusHits = f(this.bonusHits + 1);
  }

  // ---------------------------------------------------------------- Bob (FUN_007b24a2)

  /** one tick of the technician's controller */
  bobStep() {
    const a = this.host.bob, h = this.host;
    switch (this.bobState) {
      case 0: a.start(BOB.IDLE, 0); this.bobState = 7; break;
      case 1: a.start(BOB.BUTTON_A, 0); this.setBobNext(2); this.bobState = 7; break;
      case 2: a.start(BOB.BUTTON_B, 0); this.setBobNext(3); this.bobState = 7; break;
      case 3: a.start(BOB.IDLE, 0); this.bobState = 7; break;
      case 4: {
        if (this.bobPower <= h.rand()) a.start(BOB.IDLE, 0);
        else {
          switch (Math.trunc(h.rand() * 4)) {
            case 0: a.start(BOB.BUTTON_A, 0); h.play(SND.BOB_BUTTON1); break;
            case 1: a.start(BOB.BUTTON_B, 0); h.play(SND.BOB_BUTTON2); break;
            case 2: a.start(BOB.BUTTON_C, 0); h.play(SND.BOB_BUTTON3); break;
            case 3: a.start(BOB.BUTTON_D, 0); h.play(SND.BOB_BUTTON4); break;
            default: break;
          }
        }
        this.bobSpeed = f(3 * this.bobPower + 1);
        this.bobState = 7;
        break;
      }
      case 5: a.start(BOB.CLIP_7, 0); this.setBobNext(3); this.bobState = 7; break;
      case 6: a.start(BOB.CLIP_4, 0); this.setBobNext(3); this.bobState = 7; break;
      case 7: if (a.frameCount < this.bobSpeed + 1 + a.frame) this.bobState = this.bobNext; break;
      default: break;
    }
    a.advance(this.bobSpeed);
  }

  /** FUN_007b204c: the controller's destructor stops the loops */
  destroy() { this.host.stop(SND.ENGINE); this.host.stop(SND.SWISH); this.host.stop(SND.AMBIENT); }

  /** the engine / swish pitch Hz at a power (FUN_007af902) */
  static pitchOf(power: number): { engine: number; swish: number } { return { engine: 0x3880 + Math.trunc(0xfd94 * power), swish: 0x204c + Math.trunc(0x8bf8 * power) }; }
}

/** read the monitor frame ranges out of the executable image (`u32(va)` of the PE) */
export function readFrameTable(u32: (va: number) => number): [number, number][] {
  const t: [number, number][] = [];
  for (let i = 0; i < FRAME_TABLE_LEN; i++) t.push([u32(FRAME_TABLE_VA + i * 8) | 0, u32(FRAME_TABLE_VA + i * 8 + 4) | 0]);
  return t;
}
