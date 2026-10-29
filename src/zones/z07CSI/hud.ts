// z07CSI, the castle: the HUD of the loop. The wrapper FUN_00572780 clears the HUD block (FUN_0045f9d2: every icon -1, no text), the set-up FUN_00573527 calls FUN_00575c50 (overlay set
// `_data\Overlays\z07csi\` = DAT_05d4dd10; left icon DAT_05d4dd14 = texture 0 (the goblet, tint DAT_05d4dd18 = -1), the left icon column switched on (DAT_05d4e13c = 1) with its slot 0 tint
// white (DAT_05d4e148 = -1); the right icon stays off), and FUN_00575ca0 updates it on EVERY pass of the loop (any mode):
//   centre text DAT_05d4dd60 = "%04d" (0x8f84e8) of var 0xce (the castle's score),
//   left text   DAT_05d4dd20 = "x%d" (0x8f84f0) of the number of set bits among the low 10 bits of var 0xbc (the goblets collected),
//   column slot 0 (DAT_05d4e144) = the interaction icon of var 0xc (SWITCH_NS_INTERACT_ICONS): 0x20 -> texture 3, 1 -> 2, 0x1e -> 1, 0xc0 -> blinking 4 / 5 (DAT_05d58960 counts `1.0 * DAT_008b1718` per
//   pass: < 15 -> 4, else 5, and back to 0 when it passes 30), none -> -1 and the counter 0; then var 0xc := 0 (the nodes set their bit again next frame).
// NOTE (asm 0x575d46..0x575d7a): the decompile computes `(PEPPER_CONTROL & 1) ? var 0xc : 0` first but the next read of var 0xc overwrites it, so (as in the Adventure Island) the icon is NOT gated by
// walking (the island's `Hud.updateIsland` and the Oasis gate it).
import type { Hud, HudIcon } from '../../shell/hud.ts';
import type { GameVars } from '../../game/vars.ts';

export const VAR = { SCORE: 0xce, GOBLETS: 0xbc, ICONS: 0xc } as const;
/** FUN_00575ca0's loop bound: the goblet bits that are counted */
export const GOBLET_BITS = 10;
/** textures of the icon column's slot 0 (`_DAT_05d4e144`) */
export const ICON = { NONE: -1, FIRST: 1, SECOND: 2, TALK: 3, BLINK_A: 4, BLINK_B: 5 } as const;
const WHITE = 0xffffffff;
const NONE: HudIcon = { tex: -1, tint: WHITE };
/** _DAT_00892074 / _DAT_00892038: the blink half period and period (15 / 30 frames) */
const BLINK_HALF = 15, BLINK_FULL = 30;
const f32 = Math.fround;

/** `%04d` of the C runtime */
export function fmt04d(n: number): string {
  const v = n | 0;
  const s = String(Math.abs(v)).padStart(v < 0 ? 3 : 4, '0');
  return v < 0 ? `-${s}` : s;
}

export class CsiHud {
  /** DAT_05d58960 */
  blink = 0;

  /** FUN_0045f9d2 + FUN_00575c50 on the shell's HUD */
  init(hud: Hud) {
    hud.left = { tex: 0, tint: WHITE }; hud.right = { ...NONE };
    hud.leftText = ''; hud.rightText = ''; hud.centreText = '';
    hud.column = [0, 1, 2, 3, 4].map(() => ({ ...NONE }));
    this.blink = 0;
  }

  /** FUN_00575ca0; `dt` = DAT_008b1718 */
  update(hud: Hud, vars: GameVars, dt: number) {
    hud.centreText = fmt04d(vars.get(VAR.SCORE));
    const items = vars.get(VAR.GOBLETS);
    let n = 0;
    for (let i = 0, bit = 1; i < GOBLET_BITS; i++, bit <<= 1) if ((items & bit) !== 0) n++;
    hud.leftText = `x${n}`;
    const ic = vars.get(VAR.ICONS) >>> 0;
    const slot = hud.column[0] ?? (hud.column[0] = { ...NONE });
    if ((ic & 0x20) !== 0) slot.tex = ICON.TALK;
    else if ((ic & 1) !== 0) slot.tex = ICON.SECOND;
    else if ((ic & 0x1e) !== 0) slot.tex = ICON.FIRST;
    else if ((ic & 0xc0) !== 0) {
      this.blink = f32(f32(1.0 * dt) + this.blink);
      if (this.blink < BLINK_HALF) slot.tex = ICON.BLINK_A;
      else {
        slot.tex = ICON.BLINK_B;
        if (BLINK_FULL < this.blink) this.blink = 0;
      }
    } else { slot.tex = ICON.NONE; this.blink = 0; }
    vars.set(VAR.ICONS, 0);
  }
}
