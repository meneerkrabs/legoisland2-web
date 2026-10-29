// Restored content: a short text popup on the zone HUD (the "never shown" messages WAB1-3, WAS1-2, BIP10 / 15, docs/re/restore.md). RECONSTRUCTION: the original has no code that shows these
// texts; where and how long is invented (the strings are the game's own, from the zone's .str). The popup rides on `Hud.extras` (src/shell/hud.ts), so it is drawn exactly while the HUD is.
import type { Ui2D } from '../ui/renderer2d.ts';

export interface PopupHud { extras: ((ui: Ui2D) => void)[] }
export interface PopupOpts { x?: number; y?: number; ms?: number; maxChars?: number }
interface Shown { text: string; x: number; y: number; until: number; maxChars?: number }

const slots = new WeakMap<object, Shown | null>();
const installed = new WeakSet<object>();

/** show `text` for `ms` milliseconds (one popup at a time per HUD: a new one replaces the old; x / y in the 640 x 480 grid, y = the bottom of the text line) */
export function hudPopup(hud: PopupHud, text: string, o: PopupOpts = {}): void {
  if (!text) return;
  slots.set(hud, { text, x: o.x ?? 320, y: o.y ?? 130, until: performance.now() + (o.ms ?? 900), maxChars: o.maxChars });
  if (installed.has(hud)) return;
  installed.add(hud);
  hud.extras.push((ui) => {
    const s = slots.get(hud);
    if (!s) return;
    if (performance.now() > s.until) { slots.set(hud, null); return; }
    ui.anchor('centre');
    ui.text(1, s.text, s.x, s.y, { colour: 0, maxChars: s.maxChars ?? 30 });
  });
}

/** what is shown now (tests / bots) */
export function popupText(hud: PopupHud): string | null {
  const s = slots.get(hud);
  return s && performance.now() <= s.until ? s.text : null;
}
