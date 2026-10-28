// The 2D HUD of the asteroid belt (mode 2 of FUN_007b63f6 calls FUN_0046055f, the shared DrawHUD.c): five hit icons in a column at the left, a vertical hull gauge
// at the right and the score in the middle at the top. The HUD state is set once by the zone (FUN_007b73a8) and updated by the shuttle node every tick.
// Everything is on the 800x600 reference grid of DrawHUD.c (`x * W / 800`, `y * H / 600`); `toVirtual` scales it to the 640x480 grid of Ui2D.
// Textures: `Overlays/Z39ASB` (text.opt, 6 entries): 0 arrow (gauge marker), 1 green / 2 yellow / 3 red bar segment (32x16), 4 asteroid icon, 5 emblem (gauge frame).
export interface HudSprite { tex: number; rect: [number, number, number, number]; tint: number }

/** FUN_007b73a8: textures of the HUD elements */
export const HUD_TEX = { ARROW: 0, GREEN: 1, YELLOW: 2, RED: 3, ICON: 4, FRAME: 5 } as const;

/** the 12 gauge segments: texture per segment index from the bottom (FUN_007b73a8: 3 x4, 2 x4, 1 x4) */
export const SEGMENT_TEX = [3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1] as const;

/** FUN_0045fc19(0x14, ...): five 60x60 icons at x = 20, slot i from the bottom (516 - 72 i) */
export function hitIcons(slotTint: readonly number[]): HudSprite[] {
  return slotTint.slice(0, 5).map((tint, i) => ({ tex: HUD_TEX.ICON, rect: [20, 516 - 72 * i, 80, 576 - 72 * i] as [number, number, number, number], tint }));
}

/** FUN_00460214(0x2dc, 0x2b8, 0x2cc, ...): `ratio` = gauge 0..1. The marker arrow (x 696..728) slides along the segments, the segments (x 732..764, 16 high, from y 508 up) light up, the frame icon sits below */
export function gaugeSprites(ratio: number, frameTint: number): HudSprite[] {
  const r = Math.max(0, Math.min(1, ratio));
  const out: HudSprite[] = [];
  const yc = Math.trunc(508 - 192 * r);
  out.push({ tex: HUD_TEX.ARROW, rect: [696, yc - 16, 728, yc + 16], tint: 0xffffffff });
  let n = Math.trunc(12 * r + 0.5);
  if (n > 12) n = 12; else if (n < 0) n = 0;
  for (let i = 0; i < n; i++) out.push({ tex: SEGMENT_TEX[i], rect: [732, 492 - 16 * i, 764, 508 - 16 * i], tint: 0xffffffff });
  out.push({ tex: HUD_TEX.FRAME, rect: [716, 516, 776, 576], tint: frameTint });
  return out;
}

/** the score text: FUN_0045fd45 centres the third string at (400, 69) in font Balloon24, colour 0 (yellow) */
export const SCORE_TEXT = { x: 400, y: 69 } as const;

/** all sprites in draw order (column, then the gauge) */
export function hudSprites(slotTint: readonly number[], gauge: number, frameTint: number): HudSprite[] {
  return [...hitIcons(slotTint), ...gaugeSprites(gauge, frameTint)];
}

/** 800x600 reference grid -> the 640x480 virtual grid of Ui2D */
export function toVirtual(s: HudSprite, k = 0.8): HudSprite {
  return { tex: s.tex, tint: s.tint, rect: [s.rect[0] * k, s.rect[1] * k, s.rect[2] * k, s.rect[3] * k] };
}
