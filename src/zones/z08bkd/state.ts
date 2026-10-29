// The zone's shared state: the globals of the original (DAT_05d5897c .. DAT_05d5898c) and what the HUD update FUN_005b92d3, the loop's end test FUN_005b8fa4 and
// the delivery of a brick FUN_005b903b do with them.
import { C, REC, SCORE } from './consts.ts';
import type { GameRecord } from '../../game/record.ts';

import { ad, sb, ml, dv } from '../common/f32.ts';

/** the lines FUN_005b903b speaks for the 1st .. 5th delivered brick (CASGBD08 .. 12), FUN_005b92d3 CASGBD07 at half the oxygen */
export const SPEECH = { HALF_AIR: 'CASGBD07', BRICK: ['CASGBD08', 'CASGBD09', 'CASGBD10', 'CASGBD11', 'CASGBD12'], HIT: 'CASGBD05' } as const;

/** what the dolphin is told when brick k is delivered (FUN_005b92a2(1 or 2) in FUN_005b903b: the 1st, 2nd and 4th give 1, the 3rd and 5th give 2) */
export const DOLPHIN_MESSAGE = [1, 1, 2, 1, 2] as const;

export class BkdState {
  /** _DAT_05d5897c: seconds spent (the "oxygen" clock) */
  elapsed = 0;
  /** DAT_05d58988: bricks delivered at the surface (0..5; 5 ends the game) */
  bricks = 0;
  /** DAT_05d58984: the page was found (+1000 points) */
  page = false;
  /** _DAT_05d58978: the page icon flash (4 s after the find; the blink test `ftol(t) & 0x10` never fires for 0..4: the icon just lights up) */
  pageFlash = 0;
  /** DAT_05d58980: the "your air is half gone" line was spoken */
  halfSpoken = false;
  /** DAT_05d5898c: the pending message for the dolphin (FUN_005b92a2 sets it, FUN_005b92af takes and clears it) */
  dolphinMessage = 0;
  /** the HUD state FUN_005b92d3 writes: the five brick icons' tints (0x77333333 dim -> white), the page icon tint, the oxygen gauge value (1.2 x percent left) */
  brickTint: number[] = [0x77333333, 0x77333333, 0x77333333, 0x77333333, 0x77333333];
  pageTint = 0x77333333;
  gauge = 100;
  /** called with the id of a speech line (FUN_00439bf8 + FUN_00435a11) */
  speak: (id: string) => void = () => { /* silent */ };
  /** FUN_005b903b shows the bridge piece of brick k (the record's flag bit 2) */
  records: GameRecord[] = [];

  /** FUN_005b9014: the percentage of the time left (100 - elapsed / 500 * 100); negative after the time is up */
  percentLeft(): number {
    // every operation rounds to float32 (24-bit precision): 100 - (elapsed / 500) * 100
    return sb(C.HUNDRED, ml(dv(this.elapsed, C.TIME_LIMIT), C.HUNDRED));
  }
  /** FUN_005b8ffa: all five bricks delivered */
  success(): boolean { return this.bricks === 5; }
  /** FUN_005b8fa4: the game is over (the loop leaves mode 2 for the banner): five bricks, or the percentage below zero */
  over(): boolean {
    if (this.bricks === 5) return true;
    return !(C.ZERO <= this.percentLeft());
  }

  /** FUN_005b92d3 (every frame of mode 2, after the update pass): the clock, the gauge, the half-air line, the HUD tints */
  tickHud(dt: number) {
    this.elapsed = ad(dt, this.elapsed);
    let pct = sb(C.HUNDRED, ml(dv(this.elapsed, C.TIME_LIMIT), C.HUNDRED));
    if (pct < C.ZERO) pct = 0;
    this.gauge = ml(pct, C.GAUGE_SCALE);
    if (pct <= C.FIFTY && !this.halfSpoken) { this.speak(SPEECH.HALF_AIR); this.halfSpoken = true; }
    if (this.bricks > 0) this.brickTint[this.bricks - 1] = 0xffffffff;
    if (this.page) this.pageTint = 0xffffffff;
    if (this.pageFlash > C.ZERO) {
      // the original tests `ftol(flash) & 0x10` here: 0..4 never has that bit, the tint stays white
      this.pageTint = 0xffffffff;
      this.pageFlash = sb(this.pageFlash, dt);
    }
  }

  /** FUN_005b9289: the page is in the bag */
  gotPage() { this.page = true; this.pageFlash = 4; }

  /** FUN_005b92af: the dolphin takes the pending message */
  takeDolphinMessage(): number { const m = this.dolphinMessage; this.dolphinMessage = 0; return m; }

  /**
   * FUN_005b903b(brick record): the bridge piece of that brick appears (BRT1..5), the dolphin is told, the counter rises and the line for the count is spoken.
   * Returns the new count.
   */
  deliver(brick: GameRecord): number {
    const k = (REC.BRICKS as readonly number[]).indexOf(brick.index);
    if (k >= 0) {
      this.records[REC.BRICK_TOPS[k]]?.show();
      this.dolphinMessage = DOLPHIN_MESSAGE[k];
    }
    this.bricks++;
    const line = SPEECH.BRICK[this.bricks - 1];
    if (line) this.speak(line);
    return this.bricks;
  }

  /** FUN_005b7f60: the banner's score (ftol(percent left) * 0xb3 + 1000 with the page, clamped to 0..10000); `percent` = FUN_005b9014 */
  score(): number {
    let s = Math.trunc(this.percentLeft()) * SCORE.PER_PERCENT;
    if (this.page) s += SCORE.PAGE_BONUS;
    if (s < 0) s = 0;
    if (SCORE.MAX < s) s = SCORE.MAX;
    return s;
  }
}

/** FUN_005b7f60's three outcomes of the finished game: not all bricks (CASGBD04, hi-score only), then bronze / silver / gold by the score (CASGBD03 / 02 / 01) */
export function medalOfScore(score: number): 1 | 2 | 3 {
  return score < SCORE.GOLD_FROM ? (score < SCORE.SILVER_FROM ? 1 : 2) : 3;
}
