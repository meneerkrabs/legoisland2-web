// Start-up preferences of the port itself (nothing of the original's `Settings.set`, whose 92-byte layout stays as it is), kept in localStorage `le2-display`:
//   mode       "Beeld": 4:3 (original) or widescreen. The original only has 4:3 video modes and always projects the 3D scene with a fixed aspect of 0.75
//              (docs/re/rendering.md 3.1). Widescreen keeps the vertical field of view and uses the window's aspect for the 3D scene (more is visible at the sides);
//              the 2D layer (menus, intro / help screens, movies) stays a centred 4:3 area and the HUD icons anchor to the screen corners (docs/re/widescreen.md).
//   skipIntro  skip the start-up movies (the LI2 Mod Manager's "No Intro Videos")
//   debugMenu  the original's story-checkpoint list in the front end's main menu in place of "Credits" (the Mod Manager's "Debug Mode"), docs/re/mods.md
//   restored   the optional mode "Herstelde inhoud" (restored content, docs/re/restore-plan.md; default OFF: with it off the game is exactly the original)
//   restoredOff the individual restored features (src/restore/flag.ts `RESTORE_FEATURES`) the player switched off again; all on by default
// URL parameters override them for one session: `?wide=1|0`, `?intro=0`, `?debug=1`, `?restored=1|0`, `?restoredoff=a,b`.

export type DisplayMode = '4:3' | 'wide';
export interface Prefs { mode: DisplayMode; skipIntro: boolean; debugMenu: boolean; restored: boolean; restoredOff: string[] }
const KEY = 'le2-display';

export const ASPECT_ORIGINAL = 4 / 3;

function storage(): Storage | null {
  try { return (globalThis as { localStorage?: Storage }).localStorage ?? null; } catch { return null; }
}

export function storedPrefs(): Prefs {
  try {
    const v = JSON.parse(storage()?.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    return { mode: v?.mode === 'wide' ? 'wide' : '4:3', skipIntro: v?.skipIntro === true, debugMenu: v?.debugMenu === true, restored: v?.restored === true, restoredOff: Array.isArray(v?.restoredOff) ? v.restoredOff.filter((x) => typeof x === 'string') : [] };
  } catch { return { mode: '4:3', skipIntro: false, debugMenu: false, restored: false, restoredOff: [] }; }
}

export function storePrefs(p: Partial<Prefs>) {
  try { storage()?.setItem(KEY, JSON.stringify({ ...storedPrefs(), ...p })); } catch { /* private mode: the choice lasts for this session only */ }
}

/** the preferences for this session: URL parameters win over the stored choice */
export function currentPrefs(search = globalThis.location?.search ?? ''): Prefs {
  const q = new URLSearchParams(search), p = storedPrefs();
  const w = q.get('wide');
  if (w === '1' || w === 'wide') p.mode = 'wide'; else if (w === '0' || w === '4:3') p.mode = '4:3';
  if (q.get('intro') === '0') p.skipIntro = true;
  if (q.get('debug') === '1') p.debugMenu = true;
  const r = q.get('restored');
  if (r === '1') p.restored = true; else if (r === '0') p.restored = false;
  const ro = q.get('restoredoff');
  if (ro !== null) p.restoredOff = ro.split(',').filter((x) => x !== '');
  return p;
}

export const currentDisplayMode = (search?: string): DisplayMode => currentPrefs(search).mode;
export const storeDisplayMode = (mode: DisplayMode) => storePrefs({ mode });

/** CSS size of the game canvas inside a window: the largest 4:3 box (original) or the whole window (widescreen) */
export function canvasBox(mode: DisplayMode, W: number, H: number): { w: number; h: number } {
  if (mode === 'wide') return { w: Math.max(1, W), h: Math.max(1, H) };
  return { w: Math.min(W, Math.floor((H * 4) / 3)), h: Math.min(H, Math.floor((W * 3) / 4)) };
}
