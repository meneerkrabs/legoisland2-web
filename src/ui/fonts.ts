// Fonts of the 2D layer: loading from the `Fonts` archive and the font-slot mapping of the game (NewFont.c: FUN_004139e0 loader,
// FUN_00413dae name -> slot, FUN_00413fbd scales). Pure TypeScript (no GL): `Ui2D` uploads the images. See docs/re/ui-m2.md.
import type { Archive } from '../formats/archive.ts';
import { parseFnt } from '../formats/fonts.ts';
import type { Font } from '../formats/fonts.ts';
import { parseTga } from '../formats/tga.ts';
import type { Image } from '../formats/tga.ts';

/** The two real font slots (`DAT_00987d00[0..1]`, table `0x8a13d0`): `_data\fonts\Balloon12`, `_data\fonts\Balloon24` (`.fnt` + `.tga` in the `Fonts` archive). */
export const FONT_FILES = ['Balloon12', 'Balloon24'] as const;
/** font slot ids used by the game code (the first argument of the text functions) */
export const FONT_SMALL = 0;
export const FONT_BIG = 1;

/**
 * Per-slot scale `DAT_008a13e4[slot]`: 1.0 for slot 0; slot 1 (Balloon24) is 0.7 (0x3f333333) once FUN_00413fbd has run (it runs when the loading card
 * is first drawn, FUN_0040d1be, i.e. before any menu). Applied on top of W/640 (x) and H/480 (y).
 */
export const FONT_SCALE: readonly number[] = [1, Math.fround(0.7)];
/** `DAT_008a13ec` = 0x3fb6db6e (1.4286 = 1 / 0.7): FUN_00439c6f multiplies the wrap width in characters by it for slot 1 */
export const WRAP_SCALE: readonly number[] = [1, Math.fround(1.4285715)];

/**
 * FUN_00413dae: a font path / name -> slot. Decided by the end of the name (strcmp of the last 4 / 3 characters, case sensitive):
 * `test` 0, `main` 1, `bknw` 1, `csm` 0, `menu` 0; otherwise `strcmpi(name + 12, "Balloon12" | "Balloon24")` (the paths start with `_data/fonts/`, 12 characters), no match = 0.
 * So `data/fonts/main/main` = Balloon24 (slot 1) and `data/fonts/menu/menu`, `csm/csm` = Balloon12 (slot 0): the loose `main`, `menu`, `csm`, `bknw`, `test` fonts do not exist.
 */
export function fontSlotForName(name: string): number {
  const end = (n: number) => name.slice(Math.max(0, name.length - n));
  if (end(4) === 'test') return 0;
  if (end(4) === 'main') return 1;
  if (end(4) === 'bknw') return 1;
  if (end(3) === 'csm') return 0;
  if (end(4) === 'menu') return 0;
  const tail = name.slice(12).toLowerCase();
  for (let i = 0; i < FONT_FILES.length; i++) if (FONT_FILES[i].toLowerCase() === tail) return i;
  return 0;
}

/** slot names the game code passes (FUN_00439f36 callers), for documentation and the test page */
export const FONT_NAMES_IN_CODE: Readonly<Record<string, number>> = {
  '_data/fonts/Balloon12': 0, '_data/fonts/Balloon24': 1,
  'data/fonts/main/main': 1, 'data/fonts/menu/menu': 0, 'data/fonts/csm/csm': 0,
};

export interface UiFontData {
  name: string;
  /** metrics (cell height, glyph table, kerning pair advances) */
  font: Font;
  /** the glyph sheet: white with the glyph in alpha, rows as stored (bottom-up like every game texture) */
  image: Image;
  /** slot scale (FONT_SCALE) */
  scale: number;
  /** wrap width multiplier (WRAP_SCALE) */
  wrapScale: number;
}

/** Read both fonts (`Balloon12`, `Balloon24`: `.fnt` + `.tga`) from the `Fonts` archive. Index = slot. */
export function loadFontData(archive: Archive): UiFontData[] {
  return FONT_FILES.map((name, slot) => {
    const fnt = archive.find(`${name}.fnt`), tga = archive.find(`${name}.tga`);
    if (!fnt || !tga) throw new Error(`Fonts: ${name}.fnt/.tga missing`);
    return { name, font: parseFnt(archive.read(fnt)), image: parseTga(archive.read(tga)), scale: FONT_SCALE[slot], wrapScale: WRAP_SCALE[slot] };
  });
}
