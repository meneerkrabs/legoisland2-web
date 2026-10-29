// The HUD (DrawHUD.c, docs/re/rendering.md 11.3, architecture.md 7.2): drawn after the 3D scene on the 800x600 reference grid of the original
// (`ref_x * W / 800`): two 60x60 corner icons at (20, 20) and (716, 20) with a Balloon24 text beside each (y = 69; left text from x = 100, right text
// right-aligned to x = 699), a 5-slot icon column at x = 20 (slot i top = 516 - 72 i), the cutscene letterbox (Ui2D.letterbox). The textures are the zone's
// `Overlays/<ZONE>` set. `updateIsland` fills the state like the island's HUD update (FUN_004b8ef0 / FUN_004b908d / FUN_004b9008): pizzas and bricks before story
// node 7, then bot heads and Constructopedia pages, the four coloured bot heads grey / white by var 0x8e, the interaction icon of var 0xc (column slot 0),
// the island's hi-score as the centre text.
// Subtitle lines (cutscenes) are not drawn here yet.
import type { GameVars } from '../game/vars.ts';
import type { Ui2D, UiTextureSet } from '../ui/renderer2d.ts';

export interface HudIcon { tex: number; tint: number }
/**
 * The vertical gauge of the HUD (FUN_00460214(0x2dc, 0x2b8, 0x2cc, state at 0x5d4e0b8), z36CNT's power meter): 12 segments of 32x16 stacked upwards from y = 508
 * at x = 732 (800x600 grid; `segments[i]` = texture of segment i, -1 none), a 32x32 marker at x = 696 that slides up with `value` (0..192 px: y centre = 508 - 192 f)
 * when `marker` >= 0, otherwise the first round(12 f) segments are lit; the icon (`icon`, 60x60 at x = 716, y = 516) is drawn last.
 */
export interface HudGauge { value: number; min: number; max: number; segments: number[]; marker: number; icon: number; /** ARGB tint of the segments and the icon (z08BKD: 0xff77ffff); default white */ tint?: number }
const NONE: HudIcon = { tex: -1, tint: 0xffffffff };

export class Hud {
  set: UiTextureSet | null;
  left: HudIcon = { ...NONE };
  right: HudIcon = { ...NONE };
  leftText = ''; rightText = ''; centreText = '';
  /** the left icon column, slot 0 at the bottom (FUN_0045fc19) */
  column: HudIcon[] = [];
  /** cinematic bars: 0 off, 1 top + bottom, 2 bottom only */
  letterbox: 0 | 1 | 2 = 0;
  visible = true;
  /** the zone's gauge (null: none) */
  gauge: HudGauge | null = null;
  /** restored content (src/restore/arrow.ts): extra draw callbacks after the gauge (800x600 reference grid scaled by 0.8 is up to the callback); empty = the original HUD */
  extras: ((ui: Ui2D) => void)[] = [];

  constructor(set: UiTextureSet | null) { this.set = set; }

  /** FUN_004b908d's blink counter of the interaction icon (DAT_05d58630) */
  private blink = 0;
  private islandInit = false;

  /**
   * FUN_004b8ef0 (island HUD set-up): before story node 7 a pizza icon (2) left and a brick icon (7) right, from node 7 on a bot head (0) and a page (1) with
   * the four coloured bot heads (3..6) in column slots 1..4; from node 0x3d on no icons. Slot 0 of the column is the interaction icon (tint white).
   */
  initIsland(vars: GameVars) {
    const node = vars.get(0x58);
    this.left = { ...NONE }; this.right = { ...NONE }; this.leftText = ''; this.rightText = ''; this.centreText = '';
    this.column = [0, 1, 2, 3, 4].map(() => ({ ...NONE }));
    this.blink = 0;
    if (node < 0x3d) {
      if (node < 7) { this.left = { tex: 2, tint: 0xffffffff }; this.right = { tex: 7, tint: 0xffffffff }; }
      else {
        this.left = { tex: 0, tint: 0xffffffff }; this.right = { tex: 1, tint: 0xffffffff };
        for (let i = 0; i < 4; i++) this.column[1 + i] = { tex: 3 + i, tint: 0xffffffff };
      }
    }
    this.islandInit = true;
  }

  /**
   * FUN_004b908d (every frame of the island loop): the centre text = var 0x12 (HISCORE_LGI) as "%04d"; the interaction icon of var 0xc (0x20 -> 0xe,
   * 1 -> 0xd, 0x1e -> 0xc while PEPPER_CONTROL & 1; 0xc0 blinks 0xf / 0x10 every 15 frames; none -> no icon; a bit set while not walking keeps the last
   * icon), then var 0xc = 0 (the nodes set it again next frame). Before node 0x3d (FUN_004b9008): node < 7 left "(11 - var 0xb0)/c" (c = 12 at node 6, else 11),
   * right "(11 - var 0x4f)/11"; else left var 0x52, right "var 0xa5/n" (n = 2 in sub-game 0x20, else 4) and the coloured bot heads white / grey by the
   * bits of var 0x8e, all four hidden when var 0x8e >= 0xf or in sub-game 0x20. `dt` = DAT_008b1718.
   */
  updateIsland(vars: GameVars, dt = 1) {
    if (!this.islandInit) this.initIsland(vars);
    const node = vars.get(0x58), sub = vars.get(0x59);
    this.centreText = String(vars.get(0x12)).padStart(4, '0');
    const ic = vars.get(0xc), walking = (vars.get(0x5e) & 1) !== 0;
    const slot = this.column[0];
    if (ic & 0x20) { if (walking) slot.tex = 0xe; }
    else if (ic & 1) { if (walking) slot.tex = 0xd; }
    else if (ic & 0x1e) { if (walking) slot.tex = 0xc; }
    else if (ic & 0xc0) {
      this.blink += 1 * dt;
      if (this.blink < 15) slot.tex = 0xf;
      else { slot.tex = 0x10; if (30 < this.blink) this.blink = 0; }
    } else { slot.tex = -1; this.blink = 0; }
    vars.set(0xc, 0);
    if (node >= 0x3d) return;
    const total = node === 6 ? 12 : 11;
    if (node < 7) {
      this.leftText = `${11 - vars.get(0xb0)}/${total}`;
      this.rightText = `${11 - vars.get(0x4f)}/11`;
    } else {
      this.leftText = `${vars.get(0x52)}`;
      this.rightText = `${vars.get(0xa5)}/${sub === 0x20 ? 2 : 4}`;
      const c = vars.get(0x8e);
      if (c < 0xf && sub !== 0x20) for (let i = 0; i < 4; i++) this.column[1 + i].tint = c & (1 << i) ? 0xffffffff : 0xff888888;
      else for (let i = 0; i < 4; i++) this.column[1 + i].tex = -1;
    }
  }

  /** draw in the 640x480 virtual space (the 800x600 reference grid scaled by 0.8) */
  draw(ui: Ui2D, dt = 1) {
    if (this.letterbox !== undefined) ui.letterbox(this.letterbox, dt);
    if (!this.visible || this.letterbox === 1 || this.letterbox === 2) return;
    const k = 0.8;
    const icon = (i: HudIcon, x: number, y: number) => { if (i.tex >= 0) ui.sprite(this.set, i.tex, [x * k, y * k, (x + 60) * k, (y + 60) * k], i.tint); };
    // widescreen (docs/re/widescreen.md): the corner groups stay in the corners of the window, the centre text in the 4:3 area (no-op in 4:3)
    ui.anchor('left');
    icon(this.left, 20, 20);
    if (this.leftText) ui.text(1, this.leftText, 100 * k, 69 * k, { colour: 0, align: 'left' });
    this.column.forEach((c, i) => icon(c, 20, 516 - 72 * i));
    ui.anchor('right');
    icon(this.right, 716, 20);
    if (this.rightText) ui.text(1, this.rightText, 699 * k, 69 * k, { colour: 0, align: 'right' });
    if (this.gauge) this.drawGauge(ui);
    for (const x of this.extras) x(ui);
    ui.anchor('centre');
    if (this.centreText) ui.text(1, this.centreText, 400 * k, 69 * k, { colour: 0, align: 'centre' });
  }

  /** FUN_00460214 (800x600 reference grid scaled by 0.8) */
  private drawGauge(ui: Ui2D) {
    const g = this.gauge!, k = 0.8;
    const span = g.max - g.min;
    // fraction of the range, clamped (the original's float compare chain; a flat range gives 0 / 1)
    let fr: number;
    if (g.max > g.min) fr = g.value >= g.max ? 1 : g.value <= g.min ? 0 : (g.value - g.min) / span;
    else fr = g.value <= g.max ? 1 : g.value >= g.min ? 0 : (g.value - g.min) / span;
    let n: number;
    if (g.marker >= 0) {
      n = 12;
      // FUN_00460214: the centre is truncated to an integer first (ftol(508 - 192 f)), then the 32 high marker is placed around it, drawn with the gauge's tint like every other part
      const yc = Math.trunc(508 - 192 * fr);
      ui.sprite(this.set, g.marker, [696 * k, (yc - 16) * k, (696 + 32) * k, (yc + 16) * k], g.tint);
    } else n = Math.max(0, Math.min(12, Math.trunc(12 * fr + 0.5)));
    for (let i = 0; i < n; i++) {
      const t = g.segments[i] ?? -1;
      if (t < 0) continue;
      const y0 = 492 - 16 * i;
      ui.sprite(this.set, t, [732 * k, y0 * k, (732 + 32) * k, (y0 + 16) * k], g.tint);
    }
    if (g.icon >= 0) ui.sprite(this.set, g.icon, [716 * k, 516 * k, (716 + 60) * k, 576 * k], g.tint);
  }
}
