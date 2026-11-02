// Browser compatibility: what this browser can do, found out by trying (not by looking at the user agent), and a short Dutch notice on the start screen ONLY when something is missing.
// The game itself degrades per feature (src/opfsio.ts writes OPFS files without createWritable, src/mods/store.ts falls back to memory, src/shell/savestore.ts to memory, ...);
// this module tells the player what that means. Also the shared "phone / tablet" signals of the HD and LEGO 3D options (Safari and Firefox have no `deviceMemory`,
// no `userAgentData`; an iPad reports itself as a Mac).
import { canWriteFiles, openWritable } from './opfsio.ts';

export interface CompatIssue {
  id: 'webgl2' | 'audio' | 'indexeddb' | 'opfs' | 'opfs-write' | 'inflate';
  /** fatal: the game cannot run at all */
  fatal: boolean;
  /** Dutch, one sentence */
  text: string;
}

type Nav = Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };

/** an iPad with "desktop sites" on reports `Macintosh` but has a touch screen (a real Mac reports 0 touch points) */
export function isIPadOs(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = globalThis.navigator): boolean {
  return /Macintosh/.test(nav?.userAgent ?? '') && (nav?.maxTouchPoints ?? 0) > 1;
}
/** phone / tablet by every signal a browser gives: Client Hints (Chromium), the user agent, iPadOS, and a touch-first pointer */
export function looksMobile(nav: Nav = globalThis.navigator as Nav): boolean {
  let coarse = false;
  try { coarse = globalThis.matchMedia?.('(pointer: coarse)').matches === true && (nav.maxTouchPoints ?? 0) > 0; } catch { /* no matchMedia */ }
  return nav.userAgentData?.mobile === true || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(nav.userAgent ?? '') || isIPadOs(nav) || coarse;
}

const hasWebGl2 = (): boolean => {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
};
const hasIndexedDb = (): Promise<boolean> => new Promise((resolve) => {
  try {
    const idb = globalThis.indexedDB;
    if (!idb) return resolve(false);
    const r = idb.open('le2-compat-probe');
    r.onsuccess = () => { r.result.close(); resolve(true); };
    r.onerror = () => resolve(false);
    r.onblocked = () => resolve(false);
    setTimeout(() => resolve(false), 4000);
  } catch { resolve(false); }
});
/** really creates a file in OPFS, writes to it, reads it back and removes it */
async function probeOpfs(): Promise<'ok' | 'none' | 'nowrite'> {
  const nav = globalThis.navigator as Navigator | undefined;
  let dir: FileSystemDirectoryHandle;
  try {
    if (!nav?.storage?.getDirectory) return 'none';
    dir = await nav.storage.getDirectory();
  } catch { return 'none'; }   // Safari / Firefox private windows: getDirectory() rejects
  if (!canWriteFiles()) return 'nowrite';
  const name = `le2-compat-probe-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await openWritable(fh);
    await w.write(new Uint8Array([1, 2, 3, 4]));
    await w.close();
    const back = new Uint8Array(await (await fh.getFile()).arrayBuffer());
    return back.length === 4 && back[3] === 4 ? 'ok' : 'nowrite';
  } catch { return 'nowrite'; } finally { await dir.removeEntry(name).catch(() => { /* gone */ }); }
}

export async function checkCompat(): Promise<CompatIssue[]> {
  const out: CompatIssue[] = [];
  if (!hasWebGl2()) out.push({ id: 'webgl2', fatal: true, text: 'Deze browser kan WebGL 2 niet starten (niet ondersteund of hardwareversnelling staat uit), dus het spel kan hier niet draaien. Gebruik een recente Chrome, Edge, Firefox of Safari (15 of nieuwer).' });
  const g = globalThis as { AudioContext?: unknown; webkitAudioContext?: unknown };
  if (!g.AudioContext && !g.webkitAudioContext) out.push({ id: 'audio', fatal: true, text: 'Deze browser heeft geen Web Audio, dus het spel kan hier niet draaien. Gebruik een recente Chrome, Edge, Firefox of Safari.' });
  if (!(await hasIndexedDb())) out.push({ id: 'indexeddb', fatal: false, text: 'Deze browser (of dit privévenster) laat geen opslag in IndexedDB toe: spelstanden worden alleen onthouden zolang dit venster openstaat.' });
  const o = await probeOpfs();
  if (o === 'none') out.push({ id: 'opfs', fatal: false, text: 'Deze browser (of dit privévenster) laat geen bestanden bewaren: een eigen ISO, mods en HD-textures blijven alleen bewaard zolang dit venster openstaat, en HD-textures staan standaard uit. Het spel zelf werkt gewoon.' });
  else if (o === 'nowrite') out.push({ id: 'opfs-write', fatal: false, text: 'Deze browser kan geen bestanden in zijn opslag schrijven (te oude versie?): een eigen ISO, mods en HD-textures kunnen niet bewaard worden. Het spel zelf werkt gewoon; werk de browser bij voor de rest.' });
  if (typeof DecompressionStream === 'undefined') out.push({ id: 'inflate', fatal: false, text: 'Deze browser is wat ouder (geen DecompressionStream): grote gecomprimeerde mods (meer dan 256 MB uitgepakt per bestand) kunnen niet worden uitgepakt.' });
  return out;
}

/** the notice for the start screen: null when everything works; `fatal` = the Play button cannot work */
export async function compatNotice(): Promise<{ element: HTMLElement | null; fatal: boolean }> {
  let issues: CompatIssue[] = [];
  try { issues = await checkCompat(); } catch (e) { console.warn('compat: controle mislukt', e); }
  (globalThis as { __le2Compat?: unknown }).__le2Compat = issues.map((i) => i.id);
  if (!issues.length) return { element: null, fatal: false };
  const box = document.createElement('div');
  box.id = 'le2-compat';
  box.className = 'note';
  box.setAttribute('role', 'alert');
  for (const i of issues) { const p = document.createElement('div'); p.textContent = i.text; p.style.cssText = `margin:.3em 0;${i.fatal ? 'color:#ff9a8a;font-weight:600' : 'color:#f0d890'}`; box.append(p); }
  return { element: box, fatal: issues.some((i) => i.fatal) };
}
