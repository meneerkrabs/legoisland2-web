// FUN_0041cbac: the dialog page of the menu engine (page kind 2), used by the 29 character pages of the Information Centre. The shipped front end / pause pages have no
// kind 2 page, so menudraw.ts (FUN_0041d765's normal pages) does not draw it. Same tile primitives (FUN_0041c478 / FUN_0041c71b / FUN_0041c7cd) on the 640x480 grid:
//   a 21 tile wide panel (half width 10 around x = 320), 18 rows from y = 0xf0 - ((n * 2 + 0xb) * 0x18) / 2 (= 36 for the 3 items of a character page):
//   row 0 top edge, rows 1-2 the title (the character's name), row 3 filler, rows 4..14 the body (a transparent window for the 3D model on the left, columns -11..-4, and
//   the plain panel from column -3), row 15 filler, row 16 the "back" button (item 2), row 17 bottom edge.
// The text lines (FUN_0041c964) start at column `8 - 10` (x = 272) at y = i * 30 + 0x78 + itemDy + y0, left aligned in the item font.
import type { MenuEngine, MenuItem, MenuPage } from '../../shell/menu.ts';
import type { DrawOpts } from '../../shell/menudraw.ts';
import { infoLines } from './pages.ts';

const WHITE = 0xffffffff;

/** the dialog's half width in tiles (local_34 = 10) */
export const DIALOG_HALF = 10;
/** x of the text column (param_4 = 8 - 10 -> (-2 * 24 + 0x140)) and the wrap width ((param_5 - param_4) * 24 with param_5 = 10 + 2) */
export const TEXT_X = 272, TEXT_WIDTH = 336, TEXT_Y0 = 0x78, TEXT_PITCH = 0x1e;

/** the rows of the dialog (0x8a99c8 read from the EXE, with its entries after the 16th, plus the last row = -6) */
export function dialogRows(table: number[], nItems: number): number[] {
  const n = nItems * 2 + 0xc;
  const rows: number[] = [];
  for (let r = 0; r < n; r++) rows.push(r === n - 1 ? -6 : table[r] ?? -1);
  return rows;
}

/** y offset of the first row (0xf0 - ((n * 2 + 0xb) * 0x18) / 2) */
export const dialogY0 = (nItems: number) => 0xf0 - Math.trunc(((nItems * 2 + 0xb) * 0x18) / 2);

export interface DialogOpts extends DrawOpts {
  /** the 0x8a99c8 table including the entries after its 16th (16 -> 2, 17 -> -1) */
  dialogTable: number[];
  /** FUN_00439788 of the IFC table */
  look(id: string): string;
  /** text width in the item font (menu font, slot 0) in virtual pixels */
  itemWidth(s: string): number;
  /** a text line of the item font drawn left aligned (FUN_0043a25c) at the 640x480 position */
  line(s: string, x: number, y: number): void;
}

/** draw the engine's current (kind 2) page; returns the text lines that were drawn */
export function drawDialog(e: MenuEngine, o: DialogOpts): string[] {
  const { gfx } = o;
  const page: MenuPage = e.cur;
  const theme = page.theme;
  const base = o.rows.themeBase[theme] ?? 0;
  const n = page.items.length;
  const rows = dialogRows(o.dialogTable, n);
  const y0 = dialogY0(n);
  e.hits = [];
  const texts: (() => void)[] = [];
  const tile = (tex: number, col: number, row: number, argb = WHITE) =>
    gfx.tile(tex, col * 24 + 320, y0 + (row - 1) * 24, (col + 1) * 24 + 320, y0 + row * 24, argb);
  const tile2 = (tex: number, col: number, row: number) =>
    gfx.tile(tex, col * 24 + 320, y0 + (row - 1) * 24, (col + 2) * 24 + 320, y0 + (row + 1) * 24, WHITE);
  const half = (x: number) => Math.floor(x / 0x30) + 1;
  const title = o.label(page.items[0]);
  const titleHalf = half(gfx.textWidth(0, title));
  let h = DIALOG_HALF;                       // local_34
  for (let row = 0; row < rows.length; row++) {
    const what = rows[row];
    h = DIALOG_HALF;
    switch (what) {
      case 0: {
        tile(base + 9, -2 - h, row); tile(base + 9, -2 - h, row + 1);
        let c = -1 - h;
        for (; c < -1 - titleHalf; c++) { tile(0, c, row); tile(0, c, row + 1); }
        for (c = -1 - titleHalf; c < titleHalf + 1; c += 2) tile2(theme + 0x36, c, row);
        let k = titleHalf;
        while (++k < h + 1) { tile(0, k, row); tile(0, k, row + 1); }
        tile(base + 0xc, k, row); tile(base + 0xc, k, row + 1);
        texts.push(() => gfx.text(0, 0, title, 320, y0 + 24 + e.titleDy, 1));
        break;
      }
      case -7: {
        tile(base + 9, -2 - h, row);
        let c = 7 - h;
        for (; c < h + 1; c++) tile(0, c, row);
        tile(base + 0xc, c, row);
        break;
      }
      case -6: {
        tile(base + 0x15, -2 - h, row);
        for (let c = -1 - h; c < h + 1; c++) tile(base + 6, c, row);
        tile(base + 0x18, h + 1, row);
        break;
      }
      case -5: {
        tile(base + 0xf, -2 - h, row);
        for (let c = -1 - h; c < h + 1; c++) tile(base + 3, c, row);
        tile(base + 0x12, h + 1, row);
        break;
      }
      case -2: break;
      case -1: {
        tile(base + 9, -2 - h, row);
        let c = -1 - h;
        for (; c < h + 1; c++) tile(0, c, row);
        tile(base + 0xc, c, row);
        break;
      }
      default: {                              // an item: the "back" button (item `what`)
        const it: MenuItem | undefined = page.items[what];
        if (!it) break;
        const sel = what === e.item;
        const pr = !(e.press < 1 || e.pressKind !== 0);
        tile(base + 9, -2 - h, row);
        tile(0, -1 - h, row);
        h -= 2;
        tile(0, -2 - h, row);
        tile(sel ? (pr ? theme + 0x2a : theme + 0x27) : theme + 0x24, -1 - h, row);
        tile(theme + 0x1e, -h, row);
        let c = -h;
        while (++c < h - 1) tile(theme + 0x1b, c, row);
        tile(theme + 0x21, c, row);
        tile(sel ? (pr ? theme + 0x33 : theme + 0x30) : theme + 0x2d, h, row);
        tile(0, h + 1, row);
        texts.push(() => gfx.text(1, 0, o.label(it), 320, y0 + row * 24 + e.itemDy, 1));
        e.hits.push({ item: what, x0: 320 - (h + 2) * 24, y0: y0 + (row - 1) * 24, x1: 320 + (h + 2) * 24, y1: y0 + row * 24 });
        h += 2;
        tile(0, h, row);
        tile(base + 0xc, h + 1, row);
        break;
      }
    }
  }
  for (const t of texts) t();
  // FUN_0041c964: the text lines (item 1's label gives the id of the first line)
  const lines = infoLines(page.items[1].label, o.look, (s) => o.itemWidth(s) <= TEXT_WIDTH);
  lines.forEach((s, i) => o.line(s, TEXT_X, i * TEXT_PITCH + TEXT_Y0 + e.itemDy + y0));
  return lines;
}
