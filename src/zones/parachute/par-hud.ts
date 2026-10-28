// z38PAR: the HUD state of FUN_00466f50 (called every tick of the play mode): the score, the wind compass (72 pre-drawn frames), the three ring icons, the
// "chute may open" icon and the altitude gauge. Pure: the ZoneGame copies the result into the shell's Hud (src/shell/hud.ts) and draws the gauge.
// Textures are indices of the zone's `Overlays/Z38PAR` set (text.opt); coordinates are the 800x600 reference grid of DrawHUD.c.
import type { Ui2D, UiTextureSet } from '../../ui/renderer2d.ts';
import type { ParRun } from './par-run.ts';
import { TWO_PI, ftol } from './util.ts';

export const HUD_TEX = {
  COMPASS0: 14,          // 14 + 0..71 = the wind direction in 5 degree steps (0x47 + 0xe)
  RING_NORMAL: [0x92, 0x74, 0x56] as const,   // ring 1 / 2 / 3 not reached
  RING_MISSED: [0xb2, 0xb1, 0xb0] as const,
  /** the animation of a passed ring: 30 frames from the normal icon (float counters 146 / 116 / 86 that run to 175.5 / 145.5 / 115.5) */
  RING_BLINK_START: [146, 116, 86] as const,
  RING_BLINK_END: [175.5, 145.5, 115.5] as const,
  CHUTE_NO: 12, CHUTE_OK: 9,
  GAUGE_LOW: 0xb, GAUGE_HIGH: 10, GAUGE_CAP: 8, GAUGE_MARKER: 0,
} as const;

export interface ParHudFrame {
  text: string;
  /** left corner icon (the compass) */
  compass: number;
  /** right corner icon */
  chuteIcon: number;
  /** the left icon column from the bottom: ring 1, 2, 3 */
  rings: [number, number, number];
  gauge: { segments: number[]; marker: number };
}

export class ParHud {
  /** DAT_008b96bc / c0 / c4: the blink counters of the three ring icons (they persist across games in the original) */
  blink: [number, number, number] = [146, 116, 86];
  frame: ParHudFrame = { text: '0', compass: 14, chuteIcon: 12, rings: [0x92, 0x74, 0x56], gauge: { segments: [], marker: 0 } };

  /** one call of FUN_00466f50: updates the run's "chute allowed" state (and speaks the hint) as the original does */
  update(run: ParRun, pilotYaw: number, dt = 1): ParHudFrame {
    const f = this.frame;
    f.text = String(ftol(run.score));
    // compass: the wind direction relative to the pilot's yaw, 0..2 pi -> 72 frames
    let a = TWO_PI - (run.windDir - pilotYaw);
    if (a < 0) a += TWO_PI;
    if (a > TWO_PI) a -= TWO_PI;
    let idx = ftol(((a * 57.3) / 360) * 72);
    if (idx < 0 || 0x47 < idx) idx = 0;
    f.compass = idx + HUD_TEX.COMPASS0;
    // ring icons
    for (let i = 0; i < 3; i++) {
      if (this.blink[i] > HUD_TEX.RING_BLINK_END[i]) this.blink[i] = HUD_TEX.RING_BLINK_START[i];
      const s = run.ring[i];
      if (s === 0) f.rings[i] = HUD_TEX.RING_NORMAL[i];
      else if (s === 1) { f.rings[i] = ftol(this.blink[i]); this.blink[i] += dt; }
      else f.rings[i] = HUD_TEX.RING_MISSED[i];
    }
    f.chuteIcon = run.chuteOk ? HUD_TEX.CHUTE_OK : HUD_TEX.CHUTE_NO;
    // gauge: the first phase shows the altitude as a fraction of the start height; below a quarter of it (>= 153 / 204 of the bar) the second phase shows the
    // height above the ground relative to the height at which the chute became allowed
    let local20 = 204 - (run.y / run.startAlt) * 204;
    let upper: number;
    if (153 <= local20) {
      upper = HUD_TEX.GAUGE_LOW;
      local20 = 204 - (run.height / run.refAlt) * 204;
      if (!run.chuteOk) run.speak('LESGPT12');
      run.chuteOk = true;
    } else {
      upper = HUD_TEX.GAUGE_HIGH;
      run.refAlt = run.y;
    }
    f.gauge.segments = Array.from({ length: 12 }, (_, i) => (i < 3 ? HUD_TEX.GAUGE_LOW : upper));
    if (local20 > 204) local20 = 204;
    const v80 = 204 - local20;
    f.gauge.marker = Math.min(1, Math.max(0, v80 / 204));
    return f;
  }
}

/** the gauge's rectangles on the 800x600 grid (FUN_00460214(0x2dc, 0x2b8, 0x2cc)): the 12 segments, the marker, the cap icon */
export function gaugeRects(frac: number) {
  const segs = Array.from({ length: 12 }, (_, i) => [732, 492 - 16 * i, 764, 492 - 16 * i + 16] as const);
  const my = ftol(508 - 192 * frac);
  return { segs, marker: [696, my - 16, 728, my + 16] as const, cap: [716, 516, 776, 576] as const };
}

/** draw the altitude gauge (FUN_00460214) with the zone's overlay set: the 12 segments, the marker arrow and the cap icon (800 x 600 reference grid scaled by 0.8 to the 640 x 480 layer) */
export function drawGauge(ui: Ui2D, set: UiTextureSet | null, gauge: { segments: number[]; marker: number }) {
  const k = 0.8;
  const g = gaugeRects(gauge.marker);
  const spr = (tex: number, r: readonly number[]) => ui.sprite(set, tex, [r[0] * k, r[1] * k, r[2] * k, r[3] * k], 0xffffffff);
  gauge.segments.forEach((tex, i) => spr(tex, g.segs[i]));
  spr(HUD_TEX.GAUGE_CAP, g.cap);
  spr(HUD_TEX.GAUGE_MARKER, g.marker);
}
