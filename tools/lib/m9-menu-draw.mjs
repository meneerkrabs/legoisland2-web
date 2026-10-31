// The port's menu drawing (src/shell/menudraw.ts `drawMenu`) next to the original's page renderer FUN_0041d765 run natively (tools/lib/m7-shell-menu-emu.mjs `recordDraws`): the sprite
// rectangles / texture indices / colours handed to FUN_0043c267 and the texts handed to the text queue (FUN_0043a25c / 0043a091 / 0043a167: font, colour, text, x, y), both at the 640x480
// grid, with the two panel offsets DAT_008a9918 / DAT_008a991c of the moment (`uiOffsets`).
import { drawMenu, readRowTables } from '../../src/shell/menudraw.ts';

/** record the port's draw of the engine's current page: { tiles: [{ rect, colour, tex }], texts: [{ align, font, colour, text, x, y }] } */
export function portDraw(port, E, pe, mask) {
  const FONTS = [E.FONT_TITLE, E.FONT_ITEM];
  const tiles = [], texts = [];
  const gfx = {
    tile: (tex, x0, y0, x1, y1, argb) => tiles.push({ rect: [x0, y0, x1, y1], colour: argb >>> 0, tex }),
    textWidth: (font, s) => 10 * s.length + (font === 0 ? 4 : 0),
    text: (font, align, s, x, y, colour) => texts.push({ align, font: FONTS[font] >>> 0, colour: colour >>> 0, text: s, x, y }),
  };
  const m = E.mem;
  drawMenu(port, {
    gfx, rows: readRowTables(pe), mask: (mask | 0x20) >>> 0,
    label: (it) => it.label,
    onText: m.cstr(0x8a9ab0), offText: m.cstr(0x8a9ab8),
    keyName: (code) => 'K' + (code >>> 0),
    headers: [m.cstr(0x8a9a84), m.cstr(0x8a9a8c), m.cstr(0x8a9a94)],
  });
  return { tiles, texts };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** compare the two logs; returns a list of difference messages (empty = identical). The text queue's colours: the original passes the colour index (1 white, 9 grey) like the port. */
export function compareDraw(orig, mine) {
  const out = [];
  if (orig.tiles.length !== mine.tiles.length) out.push(`tile count: original ${orig.tiles.length}, port ${mine.tiles.length}`);
  const nt = Math.min(orig.tiles.length, mine.tiles.length);
  for (let i = 0; i < nt && out.length < 6; i++) if (!same(orig.tiles[i], mine.tiles[i])) out.push(`tile ${i}: original ${JSON.stringify(orig.tiles[i])}, port ${JSON.stringify(mine.tiles[i])}`);
  if (orig.texts.length !== mine.texts.length) out.push(`text count: original ${orig.texts.length}, port ${mine.texts.length}`);
  const nx = Math.min(orig.texts.length, mine.texts.length);
  for (let i = 0; i < nx && out.length < 12; i++) if (!same(orig.texts[i], mine.texts[i])) out.push(`text ${i}: original ${JSON.stringify(orig.texts[i])}, port ${JSON.stringify(mine.texts[i])}`);
  return out;
}
