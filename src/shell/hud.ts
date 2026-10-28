// The HUD (DrawHUD.c, docs/re/rendering.md 11.3, architecture.md 7.2): drawn after the 3D scene on the 800x600 reference grid of the original
// (`ref_x * W / 800`): two 60x60 corner icons at (20, 20) and (716, 20) with a Balloon24 text beside each (y = 69; left text from x = 100, right text
// right-aligned to x = 699), a 5-slot icon column at x = 20 (slot i top = 516 - 72 i), the cutscene letterbox (Ui2D.letterbox). The textures are the zone's
// `Overlays/<ZONE>` set. `updateIsland` fills the state like the island's HUD update (FUN_004b8ef0 / FUN_004b908d / FUN_004b9008): pizzas and bricks before story
// node 7, then bot heads and Constructopedia pages, the four coloured bot heads grey / white by var 0x8e, the interaction icon of var 0xc.
// Subtitle lines (cutscenes) are not drawn here yet.
import type { GameVars } from '../game/vars.ts';
import type { Ui2D, UiTextureSet } from '../ui/renderer2d.ts';

export interface HudIcon { tex: number; tint: number }
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

  constructor(set: UiTextureSet | null) { this.set = set; }

  /** island HUD from the game variables (var 0x58 story node, 0x59 sub-game, 0xb0 pizzas left, 0x4f bricks left, 0x52 bot heads, 0xa5 pages, 0x8e bot head colours, 0xc interact) */
  updateIsland(vars: GameVars) {
    const node = vars.get(0x58), sub = vars.get(0x59);
    this.column = [];
    if (node >= 0x3d) { this.left = { ...NONE }; this.right = { ...NONE }; this.leftText = ''; this.rightText = ''; return; }
    const total = node === 6 ? 12 : 11;
    if (node < 7) {
      this.left = { tex: 2, tint: 0xffffffff }; this.right = { tex: 7, tint: 0xffffffff };
      this.leftText = `${total - vars.get(0xb0)}/${total}`;
      this.rightText = `${11 - vars.get(0x4f)}/11`;
    } else {
      this.left = { tex: 0, tint: 0xffffffff }; this.right = { tex: 1, tint: 0xffffffff };
      this.leftText = `${vars.get(0x52)}`;
      this.rightText = `${vars.get(0xa5)}/${sub === 0x20 ? 2 : 4}`;
      const c = vars.get(0x8e);
      for (let i = 0; i < 4; i++) this.column.push({ tex: 3 + i, tint: c >= 0xf || (c & (1 << i)) ? 0xffffffff : 0xff888888 });
    }
    // interaction icon (var 0xc: bits 1 / 0x20 / 0x1e / 0xc0 -> textures 0xd / 0xe / 0xc / 0xf..0x10)
    const ic = vars.get(0xc);
    if (ic & 0x20) this.column.unshift({ tex: 0xe, tint: 0xffffffff });
    else if (ic & 1) this.column.unshift({ tex: 0xd, tint: 0xffffffff });
    else if (ic & 0x1e) this.column.unshift({ tex: 0xc, tint: 0xffffffff });
    else if (ic & 0xc0) this.column.unshift({ tex: 0xf, tint: 0xffffffff });
  }

  /** draw in the 640x480 virtual space (the 800x600 reference grid scaled by 0.8) */
  draw(ui: Ui2D, dt = 1) {
    if (this.letterbox !== undefined) ui.letterbox(this.letterbox, dt);
    if (!this.visible || this.letterbox === 1 || this.letterbox === 2) return;
    const k = 0.8;
    const icon = (i: HudIcon, x: number, y: number) => { if (i.tex >= 0) ui.sprite(this.set, i.tex, [x * k, y * k, (x + 60) * k, (y + 60) * k], i.tint); };
    icon(this.left, 20, 20);
    icon(this.right, 716, 20);
    if (this.leftText) ui.text(1, this.leftText, 100 * k, 69 * k, { colour: 0, align: 'left' });
    if (this.rightText) ui.text(1, this.rightText, 699 * k, 69 * k, { colour: 0, align: 'right' });
    if (this.centreText) ui.text(1, this.centreText, 400 * k, 69 * k, { colour: 0, align: 'centre' });
    this.column.forEach((c, i) => icon(c, 20, 516 - 72 * i));
  }
}
