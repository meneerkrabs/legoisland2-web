// `Fonts/*.fnt`: bitmap font metrics (texture is the sibling `.tga`). Loader: FUN_00413af1 (0x00413af1).
import { Reader } from './reader.ts';

export interface Glyph {
  /** texture rectangle (normalised 0..1, v as stored: the .tga is bottom-up like every game texture) */
  u0: number; v0: number; u1: number; v1: number;
  /** quad size in pixels at the font's native size */
  width: number; height: number;
  /** pen offset: x offset and y offset (baseline relative; the game draws top = y + (offsetY - lineHeight)) */
  offsetX: number; offsetY: number;
}
export interface Font {
  lineHeight: number;
  glyphCount: number;
  /** byte at +16: byte offset of the kerning table (= 276 + 32 * glyphCount) */
  kernOffset: number;
  /** char code (0..255) -> glyph index (0 = none/space) */
  charMap: Uint8Array;
  glyphs: Glyph[];
  /** glyphCount x glyphCount advance table (bytes): kern[glyph(a) * glyphCount + glyph(b)] = advance after a when b follows */
  kern: Uint8Array;
}

export function parseFnt(data: Uint8Array): Font {
  const r = new Reader(data);
  r.skip(8);
  const lineHeight = r.u32();
  const glyphCount = r.u32();
  const kernOffset = r.u32();
  if (glyphCount === 0 || glyphCount > 1024) throw new Error(`bad glyph count ${glyphCount}`);
  if (kernOffset !== 276 + 32 * glyphCount) throw new Error(`kern offset ${kernOffset} != ${276 + 32 * glyphCount}`);
  const charMap = r.bytes(256).slice();
  const glyphs: Glyph[] = [];
  for (let i = 0; i < glyphCount; i++) {
    const u0 = r.f32(), v0 = r.f32(), u1 = r.f32(), v1 = r.f32();
    const width = r.i32(), height = r.i32(), offsetX = r.i32(), offsetY = r.i32();
    glyphs.push({ u0, v0, u1, v1, width, height, offsetX, offsetY });
  }
  const kern = r.bytes(glyphCount * glyphCount).slice();
  if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes`);
  return { lineHeight, glyphCount, kernOffset, charMap, glyphs, kern };
}

/** The game folds lower-case accented Latin-1 (>= 0xE0) onto the upper-case range before the lookup. */
export function foldChar(c: number): number { return c >= 0xe0 ? c - 0x20 : c; }

/** Advance of the pen after drawing `a` when `b` follows (b = 0 at end of string). */
export function advance(f: Font, a: number, b: number): number {
  return f.kern[f.charMap[foldChar(a)] * f.glyphCount + f.charMap[foldChar(b)]];
}
export function measure(f: Font, text: string): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += advance(f, text.charCodeAt(i) & 255, i + 1 < text.length ? text.charCodeAt(i + 1) & 255 : 0);
  return w;
}
