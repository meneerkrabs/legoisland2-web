// z40OGL's HUD (DrawHUD state at 0x5d4dd10, drawn by FUN_0046055f): the set-up FUN_007e2a80 (run by the wrapper FUN_007e2321 right before the loop) and the per-frame update FUN_007e2ad0
// (called every pass of the GameLoop FUN_007e247f, after the mode switch, in every mode).
//   set-up    DAT_05d4dd10 = FUN_0046063b("_data\Overlays\z40OGL\") (the zone's texture set: 6 textures), DAT_05d4dd14 = 0 / DAT_05d4dd18 = -1 (the left icon: texture 0, the krystal, white),
//             _DAT_05d4e148 = -1 (the tint of icon-column slot 0), DAT_05d4e13c = 1 / DAT_05d4e140 = the set (the icon column is drawn). FUN_0045f9d2 (the wrapper's HUD start) had cleared the state:
//             right icon -1 (none), every column slot -1, the texts empty.
//   per frame left text "x%d" (0x94c520) = number of set bits among the first 10 of var 0x31 (the collected krystals), centre text "%04d" (0x94c518) = var 0x25 (the score), and the
//             interaction icon of the column slot 0 from var 0xc (set by the nodes the frame before): 0x20 -> texture 3, 1 -> 2, 0x1e -> 1 (only while PEPPER_CONTROL & 1), 0xc0 -> blinking 4 / 5
//             (a counter _DAT_05d5f304 += 1 * dt: below 15 texture 4, else 5 and above 30 the counter restarts), none -> -1 and the counter 0; then var 0xc = 0.
import type { Hud } from '../../shell/hud.ts';
import type { GameVars } from '../../game/vars.ts';
import { f32 } from './common.ts';

/** the texture numbers of the zone's overlay set (text.opt order: tEXT000 .. text005) */
export const OGL_HUD = { KRYSTAL: 0, ICON_TALK: 1, ICON_ACTION: 2, ICON_SWITCH: 3, ICON_BLINK_A: 4, ICON_BLINK_B: 5 } as const;
const WHITE = 0xffffffff;
/** _DAT_00892074 (15.0) and _DAT_00892038 (30.0) */
const BLINK_SWITCH = f32(15), BLINK_PERIOD = f32(30);

/** the loop's local state: `_DAT_05d5f304` (a zero-initialised global) */
export interface OglHudState { blink: number }
export const newHudState = (): OglHudState => ({ blink: 0 });

/** FUN_007e2a80 (after FUN_0045f9d2 cleared the HUD state) */
export function hudInit(hud: Hud, st: OglHudState) {
  hud.left = { tex: OGL_HUD.KRYSTAL, tint: WHITE };
  hud.right = { tex: -1, tint: WHITE };
  hud.leftText = ''; hud.rightText = ''; hud.centreText = '';
  hud.column = [0, 1, 2, 3, 4].map(() => ({ tex: -1, tint: WHITE }));
  st.blink = 0;
}

/** FUN_007e2ad0; `dt` = DAT_008b1718 */
export function hudFrame(hud: Hud, vars: GameVars, st: OglHudState, dt: number) {
  hud.centreText = String(vars.get(0x25)).padStart(4, '0');       // sprintf("%04d", var 0x25)
  let count = 0;
  const bits = vars.get(0x31);
  for (let i = 0, m = 1; i < 10; i++, m <<= 1) if ((bits & m) !== 0) count++;
  hud.leftText = `x${count}`;                                      // sprintf("x%d", count)
  const ic = vars.get(0xc), walking = (vars.get(0x5e) & 1) !== 0;
  const slot = hud.column[0];
  if (ic & 0x20) { if (walking) slot.tex = OGL_HUD.ICON_SWITCH; }
  else if (ic & 1) { if (walking) slot.tex = OGL_HUD.ICON_ACTION; }
  else if (ic & 0x1e) { if (walking) slot.tex = OGL_HUD.ICON_TALK; }
  else if (ic & 0xc0) {
    st.blink = f32(f32(1 * dt) + st.blink);
    if (st.blink < BLINK_SWITCH) slot.tex = OGL_HUD.ICON_BLINK_A;
    else { slot.tex = OGL_HUD.ICON_BLINK_B; if (BLINK_PERIOD < st.blink) st.blink = 0; }
  } else { slot.tex = -1; st.blink = 0; }
  vars.set(0xc, 0);
}
