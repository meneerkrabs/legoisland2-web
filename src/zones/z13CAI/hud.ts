// z13CAI, the Adventure Island: the HUD of the loop. The wrapper FUN_0061aebb clears the HUD block (FUN_0045f9d2: every icon -1, no text), FUN_0061bf50 (before the set-up root) loads
// the overlay set of the OASIS (`_data\Overlays\z14OSD\`: the Adventure Island has none of its own) and enables one icon column (`DAT_05d4e13c = 1`, slot 0 white), and
// FUN_0061bf8c updates it on EVERY pass of the loop (any mode):
//   centre text  `%04d` (DAT_00912410) of var 0x17 (the zone's hi-score),
//   column slot 0 = the interaction icon of var 0xc (SWITCH_NS_INTERACT_ICONS): 0x20 -> texture 3, 1 -> 2, 0x1e -> 1, 0xc0 -> 4 / 5 blinking (DAT_05d5bc40 counts
//     `1.0 * DAT_008b1718` per pass: < 15 -> 4, else 5, and back to 0 when it passes 30), none -> -1 and the counter 0; then var 0xc := 0 (the nodes set their bit again next frame).
// No left / right icon, no counters. NOTE: the decompile computes `(PEPPER_CONTROL & 1) ? var 0xc : 0` first but never uses it (asm 0x61bfba..0x61bfe1: the value is overwritten by
// the next read of var 0xc), so unlike the island (src/shell/hud.ts `updateIsland`) and the Pyramid the icon is NOT gated by walking.
import type { Hud, HudIcon } from '../../shell/hud.ts';
import type { GameVars } from '../../game/vars.ts';

/** the vars the HUD reads */
export const HUD_VARS = { SCORE: 0x17, ICONS: 0x0c } as const;
/** the interaction icon textures of column slot 0 (FUN_0061bf8c) */
export const ICON_TEX = { ICON_1E: 1, ICON_1: 2, ICON_20: 3, BLINK_A: 4, BLINK_B: 5 } as const;
const WHITE = 0xffffffff;
const NONE: HudIcon = { tex: -1, tint: WHITE };
/** the overlay set FUN_0061bf50 loads */
export const OVERLAY_SET = 'z14OSD';
/** _DAT_00892074 = 15, _DAT_00892038 = 30 */
const BLINK_SWITCH = 15, BLINK_WRAP = 30;

/** `%04d` of the C runtime */
export function fmt04d(n: number): string {
  const v = n | 0;
  const s = String(Math.abs(v)).padStart(v < 0 ? 3 : 4, '0');
  return v < 0 ? `-${s}` : s;
}

export class CaiHud {
  /** DAT_05d5bc40 */
  blink = 0;
  /** FUN_0045f9d2 + FUN_0061bf50 on the shell's HUD */
  init(hud: Hud) {
    hud.left = { ...NONE }; hud.right = { ...NONE };
    hud.leftText = ''; hud.rightText = ''; hud.centreText = '';
    hud.column = [0, 1, 2, 3, 4].map(() => ({ ...NONE }));
    this.blink = 0;
  }

  /** FUN_0061bf8c; `dt` = DAT_008b1718 */
  update(hud: Hud, vars: GameVars, dt: number) {
    hud.centreText = fmt04d(vars.get(HUD_VARS.SCORE));
    const ic = vars.get(HUD_VARS.ICONS) >>> 0;
    const slot = hud.column[0] ?? (hud.column[0] = { ...NONE });
    if ((ic & 0x20) !== 0) slot.tex = ICON_TEX.ICON_20;
    else if ((ic & 1) !== 0) slot.tex = ICON_TEX.ICON_1;
    else if ((ic & 0x1e) !== 0) slot.tex = ICON_TEX.ICON_1E;
    else if ((ic & 0xc0) !== 0) {
      this.blink = Math.fround(1.0 * dt + this.blink);
      if (this.blink < BLINK_SWITCH) slot.tex = ICON_TEX.BLINK_A;
      else {
        slot.tex = ICON_TEX.BLINK_B;
        if (BLINK_WRAP < this.blink) this.blink = 0;
      }
    } else { slot.tex = -1; this.blink = 0; }
    vars.set(HUD_VARS.ICONS, 0);
  }
}
