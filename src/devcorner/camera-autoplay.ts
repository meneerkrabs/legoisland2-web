// Section 4 "Camera en tekenen", part 4: the F8 autoplay of the original (windowed mode only), pure logic.
//
//   F8 (DIK 0x42), FUN_004376f9 asm 0x437a4e .. 0x437a84: on the press edge (latch DAT_009db010) DAT_009da634 = (DAT_009da634 == 0): autoplay on / off. The frame counter is not reset.
//   FUN_00423170 (the input poll at the top of every loop pass, LE2.c:16308): when DAT_009da634 != 0 and (DAT_009da638 & 1) == 0 the Up bit (4) is OR-ed into the pad word
//                DAT_0098383c AND the "pressed" word DAT_00983840: Pepper walks forward every other frame, and the OR-ed "pressed" bit also dismisses intro / help / banner screens.
//   FUN_00423f7b (LE2.c:16934, called by all 30 zone loops once per pass, after the frame): iVar1 = var 0x59 (the zone the story is in); with the autoplay on the counter DAT_009da638
//                is incremented; at 0x97 (151) it is reset to 0 and FUN_00404bb2 (story advance) runs until FUN_00404be7() (the zone of the story node) differs from iVar1; returns 1.
//                The zone loops then leave with state 6, next = FUN_00404be7() (the port: `storyAdvanced`).
// The port counts one loop pass per sim step (60 Hz, one per drawn frame of the original), like the original's one pass per frame.
import { B } from '../game/input.ts';

/** what FUN_00423f7b needs of the story: var 0x59 (FUN_00417575(0x59)), FUN_00404bb2 and FUN_00404be7 */
export interface StoryPort {
  /** FUN_00417575(0x59): the current sub game (zone) */
  currentZone(): number;
  /** FUN_00404bb2 */
  advance(): void;
  /** FUN_00404be7: the zone of the story node */
  nodeZone(): number;
}

/** DAT_009da638 reaches this value: 0x97 = 151 */
export const AUTOPLAY_PERIOD = 0x97;
/** a story that never changes zone (never in the shipped data) must not hang the page: the original's `do ... while` has no such guard */
export const ADVANCE_GUARD = 512;

export class Autoplay {
  /** DAT_009da634 */
  on = false;
  /** DAT_009da638 */
  counter = 0;
  /** how often the guard of the advance loop fired (a port safeguard, 0 in the shipped data) */
  guarded = 0;

  /** F8: the toggle of FUN_004376f9 */
  toggle() { this.on = !this.on; return this.on; }

  /** FUN_00423170's tail: the Up bit is OR-ed into the held and the pressed word every other frame (counter even) */
  apply(held: number, pressed: number): { held: number; pressed: number } {
    if (this.on && (this.counter & 1) === 0) return { held: (held | B.UP) >>> 0, pressed: (pressed | B.UP) >>> 0 };
    return { held, pressed };
  }

  /** FUN_00423f7b: true = leave the zone (the story was moved on to another zone) */
  frameEnd(story: StoryPort): boolean {
    const iVar1 = story.currentZone();
    if (!this.on) return false;
    this.counter++;
    if (this.counter < AUTOPLAY_PERIOD) return false;
    this.counter = 0;
    let n = 0;
    do {
      story.advance();
      if (++n >= ADVANCE_GUARD) { this.guarded++; break; }
    } while (iVar1 === story.nodeZone());
    return true;
  }
}
