// The start-screen option "LEGO 3D" (checkbox, OFF by default: the original look stays the default; docs/re/lego3d.md section 8). Same shape as "HD-textures" (src/mods/hdui.ts):
// an explicit stored choice (`lego3d` in `le2-display`, `?lego3d=1|0` for one visit), a note, never blocks play, a guard that warns on weak devices, unchecking removes what was cached.
import { currentPrefs, storePrefs } from '../../display.ts';
import { removeLego3dCache } from './runtime.ts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  n.append(...kids);
  return n;
};

export interface Lego3dEnv { userAgent: string; mobileHint?: boolean; touchPrimary: boolean; deviceMemory?: number; cores?: number }
/** pure decision (testable): a phone / tablet, little memory or few cores can leave LEGO 3D off; it stays selectable. The generated meshes have more triangles and lit vertices (CPU lighting like the original) than the originals. */
export function judgeLego3d(e: Lego3dEnv): { ok: boolean; reason: string } {
  if (e.mobileHint || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(e.userAgent) || e.touchPrimary) return { ok: false, reason: 'Op telefoons en tablets kan dit traag lopen: er komen veel meer driehoeken in beeld.' };
  if (e.deviceMemory !== undefined && e.deviceMemory < 4) return { ok: false, reason: `Dit apparaat meldt weinig geheugen (${e.deviceMemory} GB): met LEGO 3D kan het spel haperen.` };
  if (e.cores !== undefined && e.cores <= 2) return { ok: false, reason: 'Dit apparaat heeft weinig processorkernen: het spel rekent het licht van elk punt zelf uit en dat wordt met LEGO 3D meer werk.' };
  return { ok: true, reason: '' };
}
export function lego3dCapability(): { ok: boolean; reason: string } {
  const nav = globalThis.navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const coarse = (() => { try { return globalThis.matchMedia?.('(pointer: coarse)').matches === true && (nav.maxTouchPoints ?? 0) > 0; } catch { return false; } })();
  const v = new URLSearchParams(globalThis.location?.search ?? '').get('hdcaps');   // the same test switch as the HD option
  return judgeLego3d({ userAgent: nav.userAgent ?? '', mobileHint: nav.userAgentData?.mobile === true, touchPrimary: coarse || v === 'mobile', deviceMemory: v === 'lowmem' ? 2 : nav.deviceMemory, cores: nav.hardwareConcurrency });
}

export function createLego3dOption(): HTMLElement {
  const prefs = currentPrefs();
  const box = el('input', { type: 'checkbox', id: 'le2-lego3d', checked: prefs.lego3d });
  const note = el('div', { id: 'le2-lego3d-note', className: 'bdb-hdnote' });
  const cap = lego3dCapability();
  const idle = () => (box.checked
    ? 'Aan: bij het spelen worden personages, stenen, voertuigen, noppen en plaatjes uit LEGO-onderdelen opgebouwd, met jouw eigen spelbestanden als basis (ongeveer 1 MB data, daarna lokaal bewaard). Als het niet laadt, speelt het spel gewoon met het origineel.'
    : 'Uit = precies het originele spel. Aan = echte LEGO-onderdelen (LDraw): minifiguren, stenen, noppen, plaatjes en zeven setmodellen. Kost meer rekenwerk (meer driehoeken).');
  const paint = (t?: string) => { note.textContent = t ?? idle(); };
  paint();
  box.onchange = async () => {
    if (box.checked && !cap.ok && !confirm(`${cap.reason}\n\nLEGO 3D toch aanzetten?`)) { box.checked = false; storePrefs({ lego3d: false }); paint(); return; }
    storePrefs({ lego3d: box.checked });
    if (box.checked) {
      paint('Gegevenspakket ophalen…');
      try { const { packUrl } = await import('./packurl.ts'); const r = await fetch(packUrl); if (!r.ok) throw new Error(String(r.status)); paint(`Klaar (${Math.round((await r.arrayBuffer()).byteLength / 1e5) / 10} MB). Geldt bij het spelen.`); }
      catch { paint('Het pakket kon nu niet worden opgehaald; het spel start dan zonder LEGO 3D.'); }
    } else { await removeLego3dCache(); paint('Uit. Wat LEGO 3D in je browser bewaarde is verwijderd.'); }
  };
  return el('div', { className: 'note bdb-hd' },
    el('label', { title: 'Zet het spel om naar echte LEGO-onderdelen uit de LDraw-bibliotheek (CC BY). Standaard uit: het originele beeld blijft de standaard.' }, box, ' LEGO 3D'),
    note,
    el('a', { href: '#', textContent: 'Bronnen en licenties', onclick: async (e: Event) => { e.preventDefault(); const { attributionUrl } = await import('./packurl.ts'); window.open(attributionUrl, '_blank', 'noopener'); } }));
}
