// Drawing of the menu engine (FUN_0041d765 and the tile helpers FUN_0041c478 / 0041c51f / 0041c5c6 / 0041c670 / 0041c71b / 0041c7cd).
// All coordinates are the 640x480 virtual grid of the original with 24-pixel tiles centred on x = 320; the textures are the 72 sprites of
// `menu/mOverlays` (index = the numbers in the EXE code: panel base 0 / 1 / 2 by theme, frames at theme + 0x1b .. 0x33, ...).
// Text is queued and drawn after the tiles (the original flushes its text queue at the end of the frame).
import { IT } from './menu.ts';
import type { MenuEngine, MenuItem, MenuPage } from './menu.ts';

export interface MenuGfx {
  /** one sprite of the menu texture set; rect in virtual pixels */
  tile(tex: number, x0: number, y0: number, x1: number, y1: number, argb: number): void;
  /** width in virtual pixels of `s` in the title font (0) / item font (1) */
  textWidth(font: 0 | 1, s: string): number;
  /** queue a text: font 0 title / 1 item, align -1 left / 0 centre / 1 right, colour = the text colour index of the original (1 white, 9 grey) */
  text(font: 0 | 1, align: -1 | 0 | 1, s: string, x: number, y: number, colour: number): void;
}

/** row tables 0x8a9928 (normal), 0x8a9978 (lists), 0x8a99c8 (dialogs), read from the EXE; panel base by theme 0x8a9a18 */
export interface MenuRowTables { normal: number[]; list: number[]; dialog: number[]; themeBase: number[] }
export const DEFAULT_ROWS: MenuRowTables = {
  normal: [-5, 0, -2, -1, 1, -1, 2, -1, 3, -1, 4, -1, 5, -1, 6, -1, 7, -1, 8, -1],
  list: [-5, 0, -2, -1, -3, 10, 20, 30, 40, 50, 60, 70, 80, -1, 2, -1],
  dialog: [-5, 0, -2, -1, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -7, -1],
  themeBase: [0, 2, 1],
};
export function readRowTables(pe: { u32(va: number): number }): MenuRowTables {
  const rd = (va: number, n: number) => Array.from({ length: n }, (_, i) => pe.u32(va + 4 * i) | 0);
  return { normal: rd(0x8a9928, 20), list: rd(0x8a9978, 16), dialog: rd(0x8a99c8, 16), themeBase: rd(0x8a9a18, 3) };
}

const WHITE = 0xffffffff, GREY = 0xff7f7f7f;

export interface DrawOpts {
  gfx: MenuGfx;
  rows: MenuRowTables;
  /** label -> display text (the '!' / '@' / '^' rules of FUN_0041c270) */
  label(item: MenuItem): string;
  /** text of the on / off marks */
  onText: string; offText: string;
  /** the engine mask (items with (disable & mask) are greyed) */
  mask: number;
  /** key name for a key code (type 7 entries) */
  keyName(code: number): string;
  /** column headers of the key list: ACTION, INST. 1, INST. 2 */
  headers: [string, string, string];
  /** the dialog's second line texts etc. are not drawn; the pause menu's text offsets live in the engine */
}

/** draw the engine's current page; fills engine.hits for the pointer. Returns the half width of the panel in tile columns. */
export function drawMenu(e: MenuEngine, o: DrawOpts): number {
  const { gfx } = o;
  const page: MenuPage = e.cur;
  const theme = page.theme;
  const base = o.rows.themeBase[theme] ?? 0;
  const n = page.items.length;
  e.hits = [];
  const texts: (() => void)[] = [];
  const tile = (tex: number, col: number, row: number, yoff: number, argb = WHITE) =>
    gfx.tile(tex, col * 24 + 320, yoff + (row - 1) * 24, (col + 1) * 24 + 320, yoff + row * 24, argb);
  const tileWide = (tex: number, col: number, row: number, yoff: number, argb = WHITE) =>
    gfx.tile(tex, col * 24 + 320, yoff + (row - 1) * 24, (col + 4) * 24 + 320, yoff + row * 24, argb);
  const tileSmall = (tex: number, col: number, row: number, yoff: number, argb = WHITE) =>
    gfx.tile(tex, col * 12 + 320, yoff + 2 + (row - 1) * 24, (col + 1) * 12 + 320, yoff - 2 + row * 24, argb);
  const tile2 = (tex: number, col: number, row: number, yoff: number, xoff: number) =>
    gfx.tile(tex, col * 24 + 320 + xoff, yoff + (row - 1) * 24, (col + 2) * 24 + 320 + xoff, yoff + (row + 1) * 24, WHITE);
  const tileTall = (tex: number, col: number, row: number, yoff: number, argb = WHITE) =>
    gfx.tile(tex, col * 24 + 320, yoff + (row - 1) * 24, (col + 1) * 24 + 320, yoff + (row + 7) * 24, argb);
  const label = (it: MenuItem) => o.label(it);
  const text = (it: string, align: -1 | 0 | 1, col: number, row: number, yoff: number, colour: number, font: 0 | 1 = 1) => {
    const x = col * 24 + 320, y = yoff + row * 24 + e.itemDy;
    texts.push(() => gfx.text(font, align, it, x, y, colour));
  };

  // ---- panel width: the widest of the title and every item (FUN_0041d765 start)
  const pageTitle = label(page.items[0]);
  const raw = page.items[0].label.startsWith('^');
  let w = raw ? 0x60 : gfx.textWidth(0, pageTitle);
  const half = (x: number) => Math.floor(x / 0x30) + 1;
  const extra = (it: MenuItem, off: number) => {
    const t = label(it);
    if (it.type === IT.TOGGLE) return gfx.textWidth(1, t) + 0x30 + gfx.textWidth(1, it.value === 0 ? o.offText : o.onText);
    if (it.type === IT.SLIDER) return gfx.textWidth(1, t) + 0xa8;
    if (it.type === IT.KEY) return 0xf0;
    return gfx.textWidth(1, t);
  };
  const titleHalf = half(w);
  if (page.kind === 1) {
    for (const it of e.list) if (it) w = Math.max(w, extra(it, 0) + 0x60);
  }
  for (let i = page.kind === 1 ? 2 : 1; i < n; i++) w = Math.max(w, extra(page.items[i], 0));
  let hw = half(w);
  const nRows = page.kind === 1 ? n * 2 + 0xb : n * 2 + 2;
  const yoff = 0xf0 - Math.trunc(((nRows - 1) * 0x18) / 2);
  const tab = page.kind === 1 ? o.rows.list : o.rows.normal;

  for (let row = 0; row < nRows; row++) {
    let what = tab[row] ?? -1;
    if (row === nRows - 1) what = -6;
    let colour = 1;
    let argb = WHITE;
    switch (what) {
      case 0: { // title: two tile rows
        tile(base + 9, -2 - hw, row, yoff);
        tile(base + 9, -2 - hw, row + 1, yoff);
        let c = -1 - hw;
        for (; c < -1 - titleHalf; c++) { tile(0, c, row, yoff); tile(0, c, row + 1, yoff); }
        c = -1 - titleHalf;
        for (; c < titleHalf + 1; c += 2) tile2(theme + 0x36, c, row, yoff, 0);
        let k = titleHalf;
        while (++k < hw + 1) { tile(0, k, row, yoff); tile(0, k, row + 1, yoff); }
        tile(base + 0xc, k, row, yoff); tile(base + 0xc, k, row + 1, yoff);
        if (!raw) texts.push(() => gfx.text(0, 0, pageTitle, 320, yoff + 24 + e.titleDy, 1));
        break;
      }
      case -5:
        tile(base + 0xf, -2 - hw, row, yoff);
        for (let c = -1 - hw; c < hw + 1; c++) tile(base + 3, c, row, yoff);
        tile(base + 0x12, hw + 1, row, yoff);
        break;
      case -6:
        tile(base + 0x15, -2 - hw, row, yoff);
        for (let c = -1 - hw; c < hw + 1; c++) tile(base + 6, c, row, yoff);
        tile(base + 0x18, hw + 1, row, yoff);
        if (page.kind === 1) tile2(e.press > 0 && e.pressKind === 3 ? 0x41 : 0x40, hw - 1, 0xd, yoff, -12);
        break;
      case -1:
        tile(base + 9, -2 - hw, row, yoff);
        for (let c = -1 - hw; c < hw + 1; c++) tile(0, c, row, yoff);
        tile(base + 0xc, hw + 1, row, yoff);
        break;
      case -2: break;
      case -3: { // scroll bar column of the list
        for (let c = -2 - hw; c < hw + 2; c++) {
          const tx = c === -2 - hw ? base + 9 : c === hw + 1 ? base + 0xc : 0;
          tile(tx, c, row, yoff);
          if (c !== hw - 1) {
            for (let r = 1; r < 9; r++) if (!e.list[r - 1]) tile(tx, c, row + r, yoff);
          }
        }
        tile2(e.press > 0 && e.pressKind === 1 ? 0x3f : 0x3e, hw - 1, row - 1, yoff, -12);
        tileTall(1, hw - 1, row + 1, yoff);
        const span = Math.max(0, e.listCount - 8);
        const thumb = span < 1 ? 0 : Math.trunc((e.scroll * 0xa8) / span);
        tile(e.press > 0 && e.pressKind !== 0 ? 0x43 : 0x42, hw - 1, row + 1, yoff + thumb);
        break;
      }
      case 10: case 20: case 30: case 40: case 50: case 60: case 70: case 80: {
        const li = what / 10 - 1;
        const it = e.list[li];
        if (!it) break;
        const grey = it.type !== IT.KEY && (it.disable & o.mask) !== 0;
        if (grey) { argb = GREY; colour = 9; }
        const sel = what === e.item;
        const pr = !(e.press < 1 || e.pressKind !== 0) && e.capture === 0;
        if (it.type === IT.KEY) {
          // header over the first entry: "ACTIE | INST. 1 | INST. 2" on three bars (FUN_0041d765 case 10)
          if (what === 10) {
            tileWide(0x3d, -8, row - 2, yoff); tileWide(0x3d, -3, row - 2, yoff); tileWide(0x3d, 2, row - 2, yoff);
            text(o.headers[0], 0, -6, row - 2, yoff, 1); text(o.headers[1], 0, -1, row - 2, yoff, 1); text(o.headers[2], 0, 4, row - 2, yoff, 1);
          }
          tile(base + 9, -10, row, yoff);
          tile(0, -9, row, yoff);
          tileWide(0x3d, -8, row, yoff, argb);
          tile(0, -4, row, yoff);
          tileWide(0x3b, -3, row, yoff, argb);
          tile(0, 1, row, yoff);
          tileWide(0x3c, 2, row, yoff, argb);
          tile(0, 6, row, yoff);
          tile(0, 8, row, yoff);
          tile(base + 0xc, 9, row, yoff);
          if (sel) {
            const t = pr || e.capture !== 0 ? 0x43 : 0x42;
            tile(t, -4, row, yoff, argb); tile(t, 1, row, yoff, argb); tile(t, 6, row, yoff, argb);
          }
          text(label(it), 0, -6, row, yoff, colour);
          // the fixed key (grey) and the rebindable one; while a key is awaited the second shows a blinking cursor
          text(o.keyName(it.disable), 0, -1, row, yoff, 9);
          if (sel && e.capture !== 0) { if (e.capture < 0) text('_', 0, 4, row, yoff, colour); } else text(o.keyName(it.value), 0, 4, row, yoff, colour);
          e.hits.push({ item: what, x0: 320 - 10 * 24, y0: yoff + (row - 1) * 24, x1: 320 + 10 * 24, y1: yoff + row * 24 });
        } else {
          tile(base + 9, -2 - hw, row, yoff);
          tile(0, -1 - hw, row, yoff);
          tile(sel ? (pr ? theme + 0x2a : theme + 0x27) : theme + 0x24, -hw, row, yoff);
          tile(theme + 0x1e, 1 - hw, row, yoff, argb);
          let c = 2 - hw;
          for (; c < hw - 4; c++) tile(theme + 0x1b, c, row, yoff, argb);
          tile(theme + 0x21, c, row, yoff, argb);
          tile(sel ? (pr ? theme + 0x33 : theme + 0x30) : theme + 0x2d, hw - 3, row, yoff);
          tile(0, hw - 2, row, yoff); tile(0, hw, row, yoff);
          tile(base + 0xc, hw + 1, row, yoff);
          text(label(it), -1, 1 - hw, row, yoff, colour);
          e.hits.push({ item: what, x0: 320 + (-hw) * 24, y0: yoff + (row - 1) * 24, x1: 320 + (hw + 1) * 24, y1: yoff + row * 24 });
        }
        break;
      }
      default: { // a normal item
        const it = page.items[what];
        if (!it) break;
        const grey = it.type !== IT.KEY && (it.disable & o.mask) !== 0;
        if (grey) { argb = GREY; colour = 9; }
        let hwi = hw, dx = 0;
        const sel = what === e.item;
        const pr = !(e.press < 1 || e.pressKind !== 0);
        if (page.kind === 1) { tile(base + 9, -2 - hw, row, yoff); tile(0, -1 - hw, row, yoff); hwi = hw - 2; dx = -1; } else tile(base + 9, -2 - hw, row, yoff);
        tile(sel ? (pr ? theme + 0x2a : theme + 0x27) : theme + 0x24, -1 - hwi + dx, row, yoff);
        tile(theme + 0x1e, dx - hwi, row, yoff, argb);
        let c = -hwi;
        while (++c < hwi - 1) tile(theme + 0x1b, c + dx, row, yoff, argb);
        tile(theme + 0x21, c + dx, row, yoff, argb);
        tile(sel ? (pr ? theme + 0x33 : theme + 0x30) : theme + 0x2d, hwi + dx, row, yoff);
        if (it.type === IT.TOGGLE) {
          text(label(it), -1, 1 - hwi + dx, row, yoff, colour);
          text(it.value === 0 ? o.offText : o.onText, 1, hwi - 1 + dx, row, yoff, colour);
        } else if (it.type === IT.SLIDER) {
          text(label(it), -1, 1 - hwi + dx, row, yoff, colour);
          for (let k = 0; k < 10; k++) tileSmall(k * 10 < it.value ? 0x39 : 0x3a, k - 0xb + hwi * 2 + dx, row, yoff, argb);
        } else text(label(it), 0, dx, row, yoff, colour);
        if (page.kind === 1) {
          tile(0, hwi + 1 + dx, row, yoff);
          tile(0, hwi + 1, row, yoff); tile(0, hwi + 2, row, yoff);
          tile(base + 0xc, hwi + 3, row, yoff);
        } else tile(base + 0xc, hwi + 1, row, yoff);
        const hx0 = 320 + (-hw - 1) * 24, hx1 = 320 + (hw + 1) * 24;
        e.hits.push({ item: what, x0: hx0, y0: yoff + (row - 1) * 24, x1: hx1, y1: yoff + row * 24, slider: it.type === IT.SLIDER ? { x0: (hwi * 2 - 0xb + dx) * 12 + 320, x1: (hwi * 2 - 0xb + dx + 10) * 12 + 320 } : undefined });
        break;
      }
    }
    void argb;
  }
  for (const t of texts) t();
  return hw;
}

/** FUN_0041c270: '!ID' message, '@prefix!ID' = message followed by the prefix, '^' raw, else literal; `msg` looks an id up (missing ids return the id) */
export function menuLabel(label: string, msg: (id: string) => string): string {
  if (label.startsWith('@')) {
    const i = label.indexOf('!');
    return msg(label.slice(i + 1)) + label.slice(1, i);
  }
  if (label.startsWith('!')) return msg(label.slice(1));
  return label;
}
