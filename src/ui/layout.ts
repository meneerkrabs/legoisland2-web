// Text layout of the original (NewFont.c, SDText.c), pure TypeScript. Everything is computed in SCREEN PIXELS of the 2D area (`ScreenEnv`: W x H = 640x480
// gives the original's virtual grid; a bigger area scales with W/640, H/480 and truncates to integers exactly where the game does).
//   FUN_004145d0 glyph quad          -> glyphQuad            FUN_00413fd6 draw string   -> drawString
//   FUN_0041433a measure             -> stringWidth          FUN_004144b9 line height   -> lineHeight
//   FUN_0043a25c / 0043a091 / 0043a167 (left / centre / right queue) -> alignedX
//   FUN_00439c6f (key|text, wrap by character count, centred lines)  -> wrapLines + layoutMessage
//   FUN_00439f51 flush (black copy at +2,+2 first, then the text)    -> layoutTextCmd
import type { Font } from '../formats/fonts.ts';

export interface ScreenEnv { w: number; h: number }
/** the game's virtual grid */
export const VIRTUAL: ScreenEnv = { w: 640, h: 480 };

/** a font as the layout needs it: metrics and the slot scale (fonts.ts `UiFontData` fits) */
export interface LayoutFont { font: Font; scale: number; wrapScale?: number }

/** one glyph quad: (x0,y0) top-left, (x1,y1) bottom-right in screen pixels (integers), (u0,v0) at the top-left, (u1,v1) at the bottom-right (V up = 1 at the top of the picture), `c` = ARGB of TL, TR, BR, BL */
export interface TextQuad { x0: number; y0: number; x1: number; y1: number; u0: number; v0: number; u1: number; v1: number; c: [number, number, number, number] }

// ---------------------------------------------------------------------------------------------------- colours

/** FUN_00413ed9 colour table (0x8a1320, 11 entries x 4 corner colours TL TR BR BL as 0xAARRGGBB); the alpha is ignored by the glyph state (block 0x12 takes alpha from the texture) */
export const TEXT_COLOURS: readonly (readonly [number, number, number, number])[] = [
  [0xffffff00, 0xffffff00, 0xffffff00, 0xffffff00], // 0 yellow (the usual one)
  [0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff], // 1 white
  [0xff0000ff, 0xff0000ff, 0xff0000ff, 0xff0000ff], // 2 blue
  [0xff00ff00, 0xff00ff00, 0xff00ff00, 0xff00ff00], // 3 green
  [0xffff0000, 0xffff0000, 0xffff0000, 0xffff0000], // 4 red
  [0xffff0000, 0xff00ff00, 0xff0000ff, 0xffffffff], // 5 gradient red / green / blue / white
  [0xffff0000, 0xffff0000, 0xffff0000, 0xffffffff], // 6 red, bottom-left white
  [0xffff0000, 0xffff0000, 0xff220000, 0xff220000], // 7 red fading to dark red downwards
  [0xff000000, 0xff000000, 0xff000000, 0xff000000], // 8 black (the shadow)
  [0xff3f3f3f, 0xff3f3f3f, 0xff3f3f3f, 0xff3f3f3f], // 9 grey
  [0x3f000000, 0x3f000000, 0x3f000000, 0x3f000000], // 10 black (alpha 0x3f is ignored by the glyph state: opaque black)
];
export const COLOUR_SHADOW = 8;
/** a colour argument < 11 is a table index, otherwise a raw ARGB used for all four corners */
export function resolveColour(c: number): [number, number, number, number] {
  if (c >= 0 && c < 11) { const t = TEXT_COLOURS[c]; return [t[0], t[1], t[2], t[3]]; }
  const u = c >>> 0;
  return [u, u, u, u];
}

// ---------------------------------------------------------------------------------------------------- metrics

/** `DAT_008a13dc` / `008a13e0`: float32 (W / 640) * slotScale and (H / 480) * slotScale */
export function scaleXY(f: LayoutFont, env: ScreenEnv): { sx: number; sy: number } {
  return { sx: Math.fround((env.w / 640) * f.scale), sy: Math.fround((env.h / 480) * f.scale) };
}
function charIndex(font: Font, c: number): number { return font.charMap[c & 255]; }
function kernAt(font: Font, a: number, b: number): number { return font.kern[charIndex(font, a) * font.glyphCount + charIndex(font, b)]; }
const fold = (c: number) => (c >= 0xe0 ? c - 0x20 : c);

/** FUN_004144b9: height of one text line in pixels = trunc(cell height * sy) (the layout subtracts 8 for the line pitch) */
export function lineHeight(f: LayoutFont, env: ScreenEnv = VIRTUAL): number { return Math.trunc(f.font.lineHeight * scaleXY(f, env).sy); }

/** FUN_0041433a: pixel width of a string: x = trunc(x + kern[glyph(c_i) * N + glyph(c_i+1)] * sx) per character (no folding of lower-case accents, no `(c)` special cases here) */
export function stringWidth(f: LayoutFont, text: string, env: ScreenEnv = VIRTUAL): number {
  const { sx } = scaleXY(f, env);
  let x = 0;
  for (let i = 0; i < text.length; i++) x = Math.trunc(x + kernAt(f.font, text.charCodeAt(i), i + 1 < text.length ? text.charCodeAt(i + 1) : 0) * sx);
  return x;
}
/** measure helper for the menu engine: `{ w, h }` of a one line string at the given scale (default 640x480) */
export function measureText(f: LayoutFont, text: string, env: ScreenEnv = VIRTUAL): { w: number; h: number } {
  return { w: stringWidth(f, text, env), h: lineHeight(f, env) };
}

// ---------------------------------------------------------------------------------------------------- glyphs

/**
 * FUN_004145d0: one glyph. `x`,`y` = pen position, `y` is the BOTTOM of the line cell (the quad top is `(offsetY - cellHeight - pad) * sy + y`), `pad` grows the quad on all sides (0 normally).
 * Edges are truncated to integers; the quad is hand clipped to 0..W / 0..H with the UVs following (returns null when it lies completely outside).
 */
export function glyphQuad(f: LayoutFont, env: ScreenEnv, ch: number, x: number, y: number, pad: number, c: [number, number, number, number]): TextQuad | null {
  const font = f.font, { sx, sy } = scaleXY(f, env);
  const g = font.glyphs[charIndex(font, ch)];
  const w2 = Math.fround((g.width + 2 * pad) * sx);
  const h2 = Math.fround((g.height + 2 * pad) * sy);
  const x0f = Math.fround((g.offsetX - pad) * sx + x);
  const y0f = Math.fround(((g.offsetY - font.lineHeight) - pad) * sy + y);
  let x0 = Math.trunc(x0f), x1 = Math.trunc(x0f + w2), y0 = Math.trunc(y0f), y1 = Math.trunc(y0f + h2);
  let u0 = g.u0, v0 = g.v0, u1 = g.u1, v1 = g.v1; // v as stored (fraction from the top); the quad uses 1 - v
  if (!(x1 >= 0 && y1 >= 0 && x0 < env.w && y0 < env.h)) return null;
  if (x0 < 0) { u0 = u0 - ((u1 - u0) * x0) / w2; x0 = 0; }
  if (y0 < 0) { v0 = v0 - ((v1 - v0) * y0) / h2; y0 = 0; }
  if (env.w <= x1) { u1 = ((u1 - u0) * (env.w - x1)) / w2 + u1; x1 = env.w; }
  if (env.h <= y1) { v1 = ((v1 - v0) * (env.h - y1)) / h2 + v1; y1 = env.h; }
  return { x0, y0, x1, y1, u0, v0: 1 - v0, u1, v1: 1 - v1, c };
}

/**
 * FUN_00413fd6: the quads of a string whose pen starts at (x, y) (y = bottom of the cell), plus the pen x after the last glyph. Bytes >= 0xE0 are folded onto 0xC0..0xDF.
 * Special characters: `0xA9` "(c)" = `O` with pad +3 and `c` with pad -3 at the same position; `0x9C` (oe ligature) = `O`, then `E` at x + kern(O, E) * sx * 0.5.
 * The pen advances by the pair advance `kern[glyph(c) * N + glyph(next)] * sx`, truncated to an integer after every character.
 */
export function drawString(f: LayoutFont, env: ScreenEnv, x: number, y: number, text: string, colour: number): { quads: TextQuad[]; x: number } {
  const quads: TextQuad[] = [];
  if (text.length === 0) return { quads, x };
  const col = resolveColour(colour), { sx } = scaleXY(f, env), font = f.font;
  const push = (ch: number, px: number, pad: number) => { const q = glyphQuad(f, env, ch, px, y, pad, col); if (q) quads.push(q); };
  let c = fold(text.charCodeAt(0) & 255);
  for (let i = 0; i < text.length; i++) {
    if (c === 0xa9) { push(0x4f, x, 3); push(0x63, x, -3); }
    else if (c === 0x9c) {
      c = 0x4f;
      push(c, x, 0);
      x = Math.trunc(x + kernAt(font, c, 0x45) * sx * 0.5);
      c = 0x45;
      push(c, x, 0);
    } else push(c, x, 0);
    const next = i + 1 < text.length ? fold(text.charCodeAt(i + 1) & 255) : 0;
    x = Math.trunc(x + kernAt(font, c, next) * sx);
    c = next;
  }
  return { quads, x };
}

// ---------------------------------------------------------------------------------------------------- queue entries, alignment, message wrapping

export type Align = 'left' | 'centre' | 'right';
/** one queued text (the 0x18-byte entries at 0x9dc0d0): screen position of the pen start, font slot, colour (table index or ARGB), string */
export interface TextCmd { font: number; colour: number; x: number; y: number; text: string }

/** FUN_0043a25c / FUN_0043a091 / FUN_0043a167: left = x, centre = x - width / 2 (integer division), right = x - width (width = FUN_0043a05b = stringWidth) */
export function alignedX(f: LayoutFont, env: ScreenEnv, x: number, text: string, align: Align): number {
  if (align === 'left') return x;
  const w = stringWidth(f, text, env);
  return align === 'centre' ? x - Math.trunc(w / 2) : x - w;
}

/** FUN_00439f51: the quads of one queued text: first the black copy at (+2, +2) pixels, then the text itself */
export function layoutTextCmd(fonts: readonly LayoutFont[], env: ScreenEnv, cmd: TextCmd, shadow = true): TextQuad[] {
  const f = fonts[cmd.font];
  const out: TextQuad[] = [];
  if (shadow) out.push(...drawString(f, env, cmd.x + 2, cmd.y + 2, cmd.text, COLOUR_SHADOW).quads);
  out.push(...drawString(f, env, cmd.x, cmd.y, cmd.text, cmd.colour).quads);
  return out;
}

/**
 * The line breaking of FUN_00439c6f: while the rest is longer than `maxChars` (strict), look back from index `maxChars` for a space and cut there (the space is dropped;
 * the character AT `maxChars` is a candidate too). The original scans backwards without a bound when the first `maxChars + 1` characters hold no space (reads garbage):
 * here such a line is cut hard at `maxChars`. `slot` 1 multiplies `maxChars` by 1.4286 first (byte arithmetic): pass the font's `wrapScale` as `wrapScale`.
 */
export function wrapLines(text: string, maxChars: number, wrapScale = 1): string[] {
  let max = wrapScale === 1 ? maxChars & 255 : Math.trunc((maxChars & 255) * wrapScale) & 255;
  const out: string[] = [];
  let rest = text;
  if (max < 1) return [text]; // the original would loop forever
  while (rest.length > max) {
    let i = max;
    while (i >= 0 && rest[i] !== ' ') i--;
    if (i < 0) { out.push(rest.slice(0, max)); rest = rest.slice(max); } // no space: cut hard (see above)
    else { out.push(rest.slice(0, i)); rest = rest.slice(i + 1); }
  }
  out.push(rest);
  return out;
}

export interface MessageOpts {
  font: number; colour?: number; text: string;
  /** position in the 640x480 virtual grid (the game scales with `* W / 640` integer arithmetic; y too) */
  x: number; y: number;
  /** wrap width in characters (default: no wrapping) */
  maxChars?: number;
  /** FUN_00439c6f always centres every line; the other alignments are the direct queue calls */
  align?: Align;
}
/** FUN_00439c6f for an already expanded text: the queued entries (one per line, pitch = lineHeight - 8 pixels). Use `layoutTextCmd` to get quads. */
export function layoutMessage(fonts: readonly LayoutFont[], env: ScreenEnv, o: MessageOpts): TextCmd[] {
  const f = fonts[o.font];
  const lines = o.maxChars === undefined ? [o.text] : wrapLines(o.text, o.maxChars, f.wrapScale ?? 1);
  const pitch = (lineHeight(f, env) - 8) & 0xffff;
  const x = Math.trunc(((o.x & 0xffff) * env.w) / 640) & 0xffff;
  const y = Math.trunc(((o.y & 0xffff) * env.w) / 640) & 0xffff; // sic: the original scales y with the width factor too
  const align = o.align ?? 'centre';
  return lines.map((t, i) => ({ font: o.font, colour: o.colour ?? 0, x: alignedX(f, env, x, t, align), y: y + i * pitch, text: t }));
}
