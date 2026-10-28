// The credits scroll of the front end (FUN_00471bfa loads the fonts and CREDITS.str, FUN_00471802 word-wraps the 0xe1 lines of the table at 0x8ba8a0 into
// a line list, FUN_00471c4c scrolls it: 30 pixels per line, the scroll position grows by 1 per tick, starts at -480 and any button except Space ends it).
// Table entries (0x108 bytes): u32 font class (0 = menu font, 1 = main, 2 = Balloon24, -1 = blank), char id[0x100] ('!ID' = CREDITS.str message, else literal), i32 record
// (the stage character that walks in when the line scrolls in, -1 = none: not ported, the stage characters are only decoration).
import type { Pe } from '../formats/exe.ts';
import type { MessageTable } from '../ui/strings.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { B } from '../game/input.ts';

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
    parts.forEach((p, k) => out.push({ cls, text: p, record: k === 0 ? rec : -1 }));
  }
  return out;
}

export class Credits {
  readonly lines: CreditLine[];
  /** the scroll position in pixels (the original's local_68) */
  pos = -480;
  done = false;
  constructor(lines: CreditLine[]) { this.lines = lines; }

  /** one tick (dt = 1): returns true when finished (FUN_00471c4c's return value) */
  tick(pressed: number): boolean {
    if (this.done) return true;
    const p = Math.trunc(this.pos / 30);
    if (!(pressed & B.SPACE) && pressed !== 0) this.done = true;
    else if (p >= this.lines.length) this.done = true;
    this.pos += 1;
    return this.done;
  }

  /** FUN_00471c4c's drawing: 18 lines of the list, 30 px pitch, centred at x = 320 */
  draw(ui: Ui2D) {
    const rem = this.pos % 30, base = Math.trunc(this.pos / 30);
    for (let k = 0; k < 18; k++) {
      const idx = k + base;
      if (idx < 0 || idx >= this.lines.length) continue;
      const l = this.lines[idx];
      if (l.cls < 0 || l.cls > 2 || !l.text) continue;
      ui.text(l.cls === 0 ? 0 : 1, l.text, 320, (k + 1) * 30 - rem, { colour: 0xffffffff, align: 'centre' });
    }
  }
}
