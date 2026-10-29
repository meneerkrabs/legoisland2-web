// The Oasis' per-frame HUD function FUN_00628410 (called by the GameLoop FUN_00627c90 on every pass, whatever the mode) and the HUD set-up FUN_006283c0 (run by the wrapper before the loop).
//   set-up   DAT_05d4dd10 = the overlay set `_data\Overlays\z14OSD`, left icon (DAT_05d4dd14) = texture 0 (tint -1), the right icon stays off (FUN_0045f9d2 wrote -1), the left icon column
//            switched on (DAT_05d4e13c = 1) with its slot 0 tint white (DAT_05d4e148 = -1)
//   frame    centre text DAT_05d4dd60 = "%04d" of var 0x17 (the score), left text DAT_05d4dd20 = "x%d" (0x914d44) of the number of set bits among the low 10 bits of var 0x1d (the gems collected), the
//            interaction icon of var 0xc in column slot 0 (DAT_05d4e144): 0x20 -> texture 3, 1 -> 2, 0x1e -> 1 (each only while PEPPER_CONTROL & 1), 0xc0 -> blinks 4 / 5 (every 15 frames,
//            DAT_05d5bc50 counts `1.0 * dt`, resets above 30), nothing -> off and the counter 0; at the end var 0xc = 0 (the nodes set their bit again next frame).
// The island's variant (`Hud.updateIsland`, src/shell/hud.ts, FUN_004b908d) has other textures and gates; the other hubs have the same function with other variables (CSI 0xce / 0xbc ...).
import type { Hud } from '../../shell/hud.ts';
import type { GameVars } from '../../game/vars.ts';
import { f32 } from './common.ts';

export const VAR = { SCORE: 0x17, ITEMS: 0x1d, ICONS: 0xc, PEPPER_CONTROL: 0x5e } as const;
/** FUN_00628410's loop bound: the number of item bits that are counted */
export const ITEM_BITS = 10;
/** textures of the icon column's slot 0 (`_DAT_05d4e144`) */
export const ICON = { NONE: -1, FIRST: 1, SECOND: 2, TALK: 3, BLINK_A: 4, BLINK_B: 5 } as const;
/** _DAT_00892074 / _DAT_00892038: the blink half period and period (15 / 30 frames) */
const BLINK_HALF = f32(15), BLINK_FULL = f32(30);

/** `%04d` of a C int */
export const fmt04d = (n: number): string => { n |= 0; return n < 0 ? '-' + String(-n).padStart(3, '0') : String(n).padStart(4, '0'); };

/** DAT_05d5bc50: the blink counter */
export class OsdHudState { blink = 0 }

/** FUN_006283c0 */
export function initOsdHud(hud: Hud): void {
  hud.left = { tex: 0, tint: 0xffffffff };
  hud.right = { tex: -1, tint: 0xffffffff };
  hud.leftText = ''; hud.rightText = ''; hud.centreText = '';
  hud.column = [0, 1, 2, 3, 4].map(() => ({ tex: -1, tint: 0xffffffff }));
}

/** FUN_00628410 (`dt` = DAT_008b1718) */
export function updateOsdHud(hud: Hud, vars: GameVars, st: OsdHudState, dt: number): void {
  hud.centreText = fmt04d(vars.get(VAR.SCORE));
  const items = vars.get(VAR.ITEMS);
  let n = 0;
  for (let i = 0, bit = 1; i < ITEM_BITS; i++, bit <<= 1) if ((items & bit) !== 0) n++;
  hud.leftText = `x${n}`;            // the format string at 0x914d44 is "x%d"
  const ic = vars.get(VAR.ICONS);
  const slot = hud.column[0];
  const walking = (vars.get(VAR.PEPPER_CONTROL) & 1) !== 0;
  if ((ic & 0x20) !== 0) { if (walking) slot.tex = ICON.TALK; }
  else if ((ic & 1) !== 0) { if (walking) slot.tex = ICON.SECOND; }
  else if ((ic & 0x1e) !== 0) { if (walking) slot.tex = ICON.FIRST; }
  else if ((ic & 0xc0) !== 0) {
    st.blink = f32(f32(1.0 * dt) + st.blink);
    if (st.blink < BLINK_HALF) slot.tex = ICON.BLINK_A;
    else { slot.tex = ICON.BLINK_B; if (BLINK_FULL < st.blink) st.blink = 0; }
  } else { slot.tex = ICON.NONE; st.blink = 0; }
  vars.set(VAR.ICONS, 0);
}
