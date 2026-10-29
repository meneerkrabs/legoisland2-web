// z23DIP: the per-frame HUD function of the GameLoop (FUN_00726610, every loop pass whatever the mode) on the port's `Hud` (src/shell/hud.ts).
//   * the centre text: var 0x17 as "%04d" (FUN_0085ac00(DAT_05d4dd60, "%04d", v));
//   * the left text: the number of the low 10 bits set in var 0x3c (the collected gems) as "x%d" (DAT_05d4dd20, format string 0x9351a8); the left icon is texture 0 of the overlay set (DAT_05d4dd14 = 0,
//     set by the wrapper's FUN_007265c0 together with the set itself: Overlays\z14OSD, the Oasis' picture set, not a z23DIP one);
//   * the interaction icon of var 0xc in column slot 0 (_DAT_05d4e144): 0x20 -> 3, 1 -> 2, 0x1e -> 1 (each only while PEPPER_CONTROL & 1: otherwise the slot keeps its icon),
//     0xc0 -> blinking 4 / 5 (a counter of 1 * DAT_008b1718 per frame: 4 below 15, then 5, reset above 30), nothing -> -1 and the counter 0; then var 0xc = 0 (the nodes OR their
//     bits in again during the next frame). The island's variant (Hud.updateIsland) gates only slot 0 the same way but with the island's icon numbers (0xe / 0xd / 0xc / 0xf / 0x10).
import type { GameVars } from '../../game/vars.ts';
import type { Hud } from '../../shell/hud.ts';
import { VAR, HUD } from './consts.ts';

/** C's `%04d` */
export const fmt04d = (v: number): string => { const a = String(Math.abs(v | 0)).padStart(v < 0 ? 3 : 4, '0'); return v < 0 ? `-${a}` : a; };

/** the HUD state the original keeps in globals: the blink counter (_DAT_05d5d104) */
export class DipHudState { blink = 0 }

/** FUN_007265c0 + FUN_0045f9d2: the left icon is texture 0 (tint white), the column has one slot, no icon yet */
export function initDipHud(hud: Hud) {
  hud.left = { tex: HUD.GEM_ICON, tint: 0xffffffff };
  hud.right = { tex: -1, tint: 0xffffffff };
  hud.column = [{ tex: -1, tint: 0xffffffff }];
}

/** FUN_00726610 (`dt` = DAT_008b1718) */
export function updateDipHud(hud: Hud, vars: GameVars, st: DipHudState, dt = 1) {
  hud.centreText = fmt04d(vars.get(VAR.SCORE));
  let n = 0, bits = vars.get(VAR.GEMS) >>> 0;
  for (let i = 0; i < 10; i++) { if (bits & 1) n++; bits >>>= 1; }
  hud.leftText = `x${n}`;
  const ic = vars.get(VAR.ICONS), walking = (vars.get(VAR.CONTROL) & 1) !== 0;
  const slot = hud.column[0] ?? (hud.column[0] = { tex: -1, tint: 0xffffffff });
  if (ic & 0x20) { if (walking) slot.tex = HUD.ICON_ALT; }
  else if (ic & 1) { if (walking) slot.tex = HUD.ICON_1; }
  else if (ic & 0x1e) { if (walking) slot.tex = HUD.ICON_1E; }
  else if (ic & 0xc0) {
    st.blink = Math.fround(Math.fround(1.0 * dt) + st.blink);
    if (st.blink < 15) slot.tex = HUD.BLINK_A;
    else { slot.tex = HUD.BLINK_B; if (30 < st.blink) st.blink = 0; }
  } else { slot.tex = -1; st.blink = 0; }
  vars.set(VAR.ICONS, 0);
}
