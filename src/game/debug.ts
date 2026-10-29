// The port's debug option (src/display.ts `debugMenu`: the "Debugmenu" checkbox of the start page, or `?debug=1`): everything that is not in the original is behind it, so
// default play is exactly the original: the stub aids (F9 completes the story step, F10 fails a mini-game, test aids of the ported zones), and the cheat codes
// that the original only scans in windowed mode (PEPPERONI, FSMADVANCE).
import { currentPrefs } from '../display.ts';

/** is the debug option on (read when asked: the URL / stored preference do not change during a session) */
export function debugAids(): boolean {
  try { return currentPrefs().debugMenu; } catch { return false; }
}
