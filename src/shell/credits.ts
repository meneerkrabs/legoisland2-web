// The credits scroll of the front end (FUN_00471bfa loads the fonts and CREDITS.str, FUN_00471802 word-wraps the 0xe1 lines of the table at 0x8ba8a0 into
// a line list, FUN_00471c4c scrolls it: 30 pixels per line, the scroll position grows by 1 per tick, starts at -480 and any button except Space ends it).
// Table entries (0x108 bytes): u32 font class (0 = menu font, 1 = main, 2 = Balloon24, -1 = blank), char id[0x100] ('!ID' = CREDITS.str message, else literal), i32 record
// (the stage character that peeks into the picture when the line scrolls in, -1 = none: `CreditsStage` below, ported from FUN_00471c4c, oracle test m5-audit-fe-credits).
import type { Pe } from '../formats/exe.ts';
import type { MessageTable } from '../ui/strings.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { B } from '../game/input.ts';
import type { GameRecord } from '../game/record.ts';

export const CREDITS_TABLE_VA = 0x8ba8a0;
export const CREDITS_LINES = 0xe1;
const STRIDE = 0x108;

export interface CreditLine { cls: number; text: string; record: number }

/** the wrapped lines (FUN_00471802): a line wider than 600 pixels is cut at its last space until it fits */
export function buildCredits(pe: Pe, table: MessageTable, width: (cls: number, s: string) => number): CreditLine[] {
  const out: CreditLine[] = [];
  for (let i = 0; i < CREDITS_LINES; i++) {
    const at = CREDITS_TABLE_VA + i * STRIDE;
    const cls = pe.u32(at) | 0;
    const id = pe.cstr(at + 4, 0x100);
    const rec = pe.u32(at + 0x104) | 0;
    let text = id.startsWith('!') ? table.text(id.slice(1)) : id;
    // FUN_00471802 wraps by measuring: cut at the last space until the part fits 600 pixels
    const parts: string[] = [];
    while (true) {
      let part = text, rest = '';
      while (width(cls, part) > 600) {
        const sp = part.lastIndexOf(' ');
        if (sp < 0) { rest = ''; break; }
        rest = part.slice(sp + 1) + (rest ? ' ' + rest : '');
        part = part.slice(0, sp);
      }
      parts.push(part);
      if (!rest) break;
      text = rest;
    }
    parts.forEach((p) => out.push({ cls, text: p, record: rec }));   // FUN_00471802 copies the record to every wrapped part
  }
  return out;
}

/**
 * FUN_00471c4c, the stage characters of the credits (DAT_05d57e8c / 05d57e98 / 05d57ea4, DAT_008c90a8): when a line scrolls in, the record of the line index + 15 (when it has one) is
 * put into the first free of three slots after the last one used: at x = 3 - 2.8 * slot, z = 50, clip 0x5c, visible for 80 ticks while it rises from y 3.5 to 6.2 and sinks back.
 * Space (button 0x80) during ticks 28..32 of a slot makes it blink and vanish; any other button ends the credits.
 */
export class CreditsStage {
  /** DAT_05d57e8c: ticks left per slot (0 = free) */
  timer = [0, 0, 0];
  /** DAT_05d57e98: -1 = steady, 0 / 1 = blink phase */
  state = [0, 0, 0];
  /** DAT_05d57ea4 */
  rec: (GameRecord | undefined)[] = [undefined, undefined, undefined];
  /** DAT_008c90a8: the slot used last */
  last = -1;
  /** the record's visibility word (+0x60) is written whole by the original */
  private show(r: GameRecord | undefined, on: boolean) { if (r) r.flags = on ? 2 : 0; }

  /** the stage part of one call: `scroll` = ftol(local_68), `lines` the wrapped list, `pressed` DAT_00983840; returns the call's result for the end of the list / a button */
  step(scroll: number, lines: readonly CreditLine[], recs: readonly GameRecord[], pressed: number, dt = 1): number {
    const sub = scroll % 30, line = Math.trunc(scroll / 30);
    if (sub === 0 && line + 15 >= 0 && line + 15 < 0xe2 && (lines[line + 15]?.record ?? -1) !== -1) {
      for (let k = 0; k < 3; k++) {
        let s = k + 1 + this.last;
        if (s > 2) s -= 3;
        if (this.timer[s] === 0) {
          this.timer[s] = 0x50;
          const r = recs[lines[line + 15].record];
          this.rec[s] = r;
          if (r) {
            r.flags = 2;
            r.m[12] = Math.fround(3 - s * Math.fround(2.8));   // 3.0 - (float)slot * 2.8f
            r.m[13] = 3.5;
            r.m[14] = 50;
            r.anim?.start(0x5c, 0);
          }
          this.last = s;
          this.state[s] = -1;
          break;
        }
      }
    }
    for (let s = 0; s < 3; s++) {
      if (this.timer[s] <= 0) continue;
      const r = this.rec[s];
      r?.anim?.advance(1, dt);          // FUN_0043b76a: the clip runs per dt; the slot timers and the scroll test are per call (per pass of the loop)
      if (r) r.m[13] = Math.fround(Math.fround((this.timer[s] < 0x29 ? this.timer[s] : 0x50 - this.timer[s]) / 15) + 3.5);   // `(float)n / 15.0 + 3.5`: the division and the sum rounded in turn (x87 at 24 bit)
      this.timer[s]--;
      if (this.timer[s] === 0) this.show(r, false);
      if (this.state[s] === 0) { this.show(r, true); this.state[s] = 1; }
      else if (this.state[s] === 1) { this.show(r, false); this.state[s] = 0; }
    }
    if ((pressed & B.SPACE) === 0) {
      if (pressed !== 0) {
        for (let s = 0; s < 3; s++) if (this.state[s] === 1) this.show(this.rec[s], false);
        return 1;
      }
    } else {
      for (let s = 0; s < 3; s++) if (this.timer[s] > 0x1b && this.timer[s] < 0x21) { this.state[s] = 0; this.show(this.rec[s], false); }
    }
    if (line < lines.length) return 0;
    for (let s = 0; s < 3; s++) if (this.state[s] === 1) this.show(this.rec[s], false);
    return 1;
  }
}
export class Credits {
  readonly lines: CreditLine[];
  /** the scroll position in pixels (the original's local_68) */
  pos = -480;
  /** the int the last pass was called with (`ftol(local_68)`, before the step): FUN_00471c4c draws the text of the same call from it */
  private shown = -480;
  done = false;
  /** the start of the credits (the loop's `local_68 = -480.0`) */
  reset() { this.pos = -480; this.shown = -480; this.done = false; }
  constructor(lines: CreditLine[]) { this.lines = lines; }

  readonly stage = new CreditsStage();
  /** one pass of the loop: returns true when finished (FUN_00471c4c's return value); `recs` = the stage records whose characters peek in; the scroll grows by `1.0 * DAT_008b1718` (float32) per pass */
  tick(pressed: number, recs: readonly GameRecord[] = [], dt = 1): boolean {
    if (this.done) return true;
    this.shown = Math.trunc(this.pos);
    if (this.stage.step(this.shown, this.lines, recs, pressed, dt) !== 0) this.done = true;
    this.pos = Math.fround(1 * dt + this.pos);
    return this.done;
  }

  /** FUN_00471c4c's drawing: 18 lines of the list, 30 px pitch, centred at x = 320 */
  draw(ui: Ui2D) {
    const at = this.shown, rem = at % 30, base = Math.trunc(at / 30);   // FUN_00471c4c draws from the int it was called with
    for (let k = 0; k < 18; k++) {
      const idx = k + base;
      if (idx < 0 || idx >= this.lines.length) continue;
      const l = this.lines[idx];
      if (l.cls < 0 || l.cls > 2 || !l.text) continue;
      ui.text(l.cls === 0 ? 0 : 1, l.text, 320, (k + 1) * 30 - rem, { colour: 0xffffffff, align: 'centre' });
    }
  }
}
