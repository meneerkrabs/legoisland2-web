// The zone loop's own logic (FUN_006a26a8 mode 2 / 4, FUN_006a21b0, FUN_006a2265, FUN_006a2290, FUN_006a2355, FUN_006a4f60): the clock, the danger meter's decay, when the game
// is over, the score and the medal. Pure: the zone game and the node tests drive it.
import type { GameVars } from '../../game/vars.ts';
import { VAR, BIT, SND, K, medalOfScore } from './consts.ts';
import { MmpShared } from './shared.ts';

/** `(int)` of an x87 `fistp` result: values out of the 32 bit range give the "integer indefinite" 0x80000000 (what `__ftol` returns) */
const ftol = (v: number): number => { const t = Math.trunc(v); return t >= -2147483648 && t <= 2147483647 ? t : -2147483648; };

/**
 * FUN_006a2290: 10000 - ftol((seconds - 60) * 33.3) clamped to 0..10000 when the tomb was escaped, else 0. The original converts `seconds - 60` with `fild qword` whose
 * high half is 0, so fewer than 60 seconds (a negative number) becomes a huge unsigned one and the score drops to 0.
 */
export function scoreOf(seconds: number, won: boolean): number {
  const d = seconds - K.SCORE_BASE_SECONDS;
  const v = ftol(Math.fround((d < 0 ? d >>> 0 : d) * K.SCORE_PER_SECOND));      // (the x87 runs in 24-bit precision: the product rounds to float32 before the truncation: 30 s -> 999, not 998.99..)
  let s = (K.SCORE_MAX - v) | 0;
  if (s < 0) s = 0;
  if (K.SCORE_MAX < s) s = K.SCORE_MAX;
  return won ? s : 0;
}

/** the "mm:ss" of the clock (FUN_006a4f60: `%d:%02d` of the seconds left) */
export function clockText(seconds: number): string {
  const left = K.SECONDS - seconds;
  return `${Math.trunc(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export class MmpRun {
  readonly sh: MmpShared;
  /** the result of the run: 0 running, 1 escaped, 2 lost (time up or caught) */
  result = 0;
  /** why it ended (diagnostics) */
  reason: 'none' | 'time' | 'caught' | 'escaped' = 'none';
  constructor(sh: MmpShared) { this.sh = sh; }

  /** the loop's mode 2 before the update pass: the danger meter relaxes (0.2 per tick) and the clock counts while it runs: `frac = 1.0 * dt + frac` (DAT_008b1718, dt-scaled like the original: a second is more than 30 dt units, i.e. 31 steps at dt 1 the first time, then 30) */
  beforeTick(dt: number) {
    const sh = this.sh;
    if (0 <= sh.danger) sh.danger = Math.fround(sh.danger - Math.fround(K.DANGER_DECAY * dt));
    if (!sh.stopClock) {
      sh.frac = Math.fround(1.0 * dt + sh.frac);
      if (K.SECOND_TICKS < sh.frac) { sh.frac = Math.fround(sh.frac - K.SECOND_TICKS); sh.seconds++; }
    }
  }

  /** FUN_006a2265: the tomb was escaped (VAR NEAR & 0x4000) */
  won(vars: Pick<GameVars, 'get'>): boolean { return (vars.get(VAR.NEAR) & BIT.CHASE) !== 0; }

  /** FUN_006a21b0 after the update pass: the countdown beeps of the last 10 seconds, time up, caught, escaped. Returns true when the game is over. */
  afterTick(vars: Pick<GameVars, 'get'>): boolean {
    const sh = this.sh, snd = sh.sounds;
    if (K.SECONDS - sh.seconds === sh.warnNext) { snd.play2D(SND.CLOCK_TICK); sh.warnNext--; }
    let over = false;
    if (K.SECONDS <= sh.seconds) { snd.stop2D(SND.CLOCK_TICK); snd.play2D(SND.TIME_FINISH); over = true; this.reason = 'time'; }
    else if (K.DANGER_MAX <= sh.danger) { snd.play2D(SND.TIME_FINISH); over = true; this.reason = 'caught'; }
    else if (this.won(vars)) { over = true; this.reason = 'escaped'; }
    if (over) this.result = this.won(vars) ? 1 : 2;
    return over;
  }

  score(vars: Pick<GameVars, 'get'>): number { return scoreOf(this.sh.seconds, this.won(vars)); }
  medal(vars: Pick<GameVars, 'get'>): 0 | 1 | 2 | 3 { return medalOfScore(this.won(vars), this.score(vars)); }
}

/** FUN_006a2355: the high score (var 0x14) and the trophy (var 0x48) are written when the score beats the old high score; a lost game writes nothing (score 0) */
export function applyResult(vars: Pick<GameVars, 'get' | 'set'>, won: boolean, score: number) {
  if (!won) return;
  if (vars.get(VAR.HISCORE) < score) {
    vars.set(VAR.HISCORE, score);
    vars.set(VAR.TROPHY, medalOfScore(true, score));
  }
}

/** the result lines of the banner and of the speech (FUN_006a2355 / the loop's mode 2): [message id, y] */
export function resultLines(won: boolean, score: number): { lines: [string, number][]; medal: 0 | 1 | 2 | 3 } {
  if (!won) return { lines: [['ADSGMM11', 100], ['ADSGMM12', 350]], medal: 0 };
  if (score >= K.GOLD) return { lines: [['ADSGMM06', 150], ['ADSGMM07', 250]], medal: 3 };
  if (score >= K.SILVER) return { lines: [['ADSGMM08', 150], ['ADSGMM09', 350]], medal: 2 };
  return { lines: [['ADSGMM10', 150]], medal: 1 };
}
