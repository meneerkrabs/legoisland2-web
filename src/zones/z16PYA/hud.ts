// z16PYA, the Pyramid: the HUD of the loop. The wrapper FUN_00675f02 clears the HUD block (FUN_0045f9d2: every icon -1, no text) and then FUN_00676080 fills in the Pyramid's
// own (it loads the overlay set of the OASIS, `_data\Overlays\z14OSD\`: the Pyramid has no overlay set of its own), FUN_006760d0 updates it on EVERY pass of the loop (any mode):
//   left icon (texture 0, white, FUN_00676080) + the text `x%d` (DAT_0091ef38) = the number of bits set in the low 10 bits of var 0xde (the gems: FUN_006767f8 gives the
//   n-th GEM record the bit 1 << n of var 0xde), centre text `%04d` (DAT_0091ef30) of var 0x17 (the zone's hi-score), column slot 0 = the interaction icon of var 0xc:
//     0x20 -> texture 3, 1 -> 2, 0x1e -> 1 (only while PEPPER_CONTROL & 1), 0xc0 -> 4 / 5 blinking (DAT_05d5bd9c counts `1.0 * DAT_008b1718` per pass: < 15 -> 4, else 5, > 30 -> 0), none -> -1;
//   then var 0xc = 0 (the nodes that want an icon set their bit again next frame).
// The island's version (src/shell/hud.ts `updateIsland`) is the same logic with the island's textures 0xe / 0xd / 0xc / 0xf / 0x10 and its own counters.
import type { Hud, HudIcon } from '../../shell/hud.ts';
import type { GameVars } from '../../game/vars.ts';

/** FUN_00676080: `DAT_05d4dd14 = 0` (left icon texture), `DAT_05d4dd18 = -1` (white), `_DAT_05d4e148 = -1` (column slot 0 white), `DAT_05d4e13c = 1` (one column) */
export const LEFT_ICON = 0;
/** the interaction icon textures of column slot 0 (FUN_006760d0) */
export const ICON_TEX = { ICON_1E: 1, ICON_1: 2, ICON_20: 3, BLINK_A: 4, BLINK_B: 5 } as const;
/** the vars the HUD reads */
export const HUD_VARS = { SCORE: 0x17, GEMS: 0xde, ICONS: 0x0c, CONTROL: 0x5e } as const;
/** FUN_006767f8 / FUN_006760d0: the gem bits counted (the loop runs i = 0 .. 9) */
const GEM_BITS = 10;
const WHITE = 0xffffffff;
const NONE: HudIcon = { tex: -1, tint: WHITE };

/** `%04d` of the C runtime */
export function fmt04d(n: number): string {
  const v = n | 0;
  const s = String(Math.abs(v)).padStart(v < 0 ? 3 : 4, '0');
  return v < 0 ? `-${s}` : s;
}

/** the state the HUD block keeps between passes (FUN_006760d0's blink timer DAT_05d5bd9c) */
export class PyaHud {
  blink = 0;
  /** FUN_0045f9d2 + FUN_00676080 on the shell's HUD */
  init(hud: Hud) {
    hud.left = { tex: LEFT_ICON, tint: WHITE };
    hud.right = { ...NONE };
    hud.leftText = ''; hud.rightText = ''; hud.centreText = '';
    hud.column = [0, 1, 2, 3, 4].map(() => ({ ...NONE }));
    this.blink = 0;
  }

  /** FUN_006760d0; `dt` = DAT_008b1718 */
  update(hud: Hud, vars: GameVars, dt: number) {
    hud.centreText = fmt04d(vars.get(HUD_VARS.SCORE));
    let n = 0;
    const gems = vars.get(HUD_VARS.GEMS) >>> 0;
    for (let i = 0, bit = 1; i < GEM_BITS; i++, bit <<= 1) if ((gems & bit) !== 0) n++;
    hud.leftText = `x${n}`;
    const ic = vars.get(HUD_VARS.ICONS) >>> 0, walking = (vars.get(HUD_VARS.CONTROL) & 1) !== 0;
    const slot = hud.column[0];
    if ((ic & 0x20) === 0) {
      if ((ic & 1) === 0) {
        if ((ic & 0x1e) === 0) {
          if ((ic & 0xc0) === 0) { slot.tex = -1; this.blink = 0; }
          else {
            this.blink = Math.fround(1.0 * dt + this.blink);
            if (this.blink < 15) slot.tex = ICON_TEX.BLINK_A;
            else {
              slot.tex = ICON_TEX.BLINK_B;
              if (30 < this.blink) this.blink = 0;
            }
          }
        } else if (walking) slot.tex = ICON_TEX.ICON_1E;
      } else if (walking) slot.tex = ICON_TEX.ICON_1;
    } else if (walking) slot.tex = ICON_TEX.ICON_20;
    vars.set(HUD_VARS.ICONS, 0);
  }
}
