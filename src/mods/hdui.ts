// The start-screen option "HD-textures" (checkbox, checked by default where the device can take it) and the small in-game indicator of the background install.
// Logic and decisions: src/mods/hd.ts. Dutch UI text like the rest of the start screen.
import { currentPrefs, storePrefs } from '../display.ts';
import { HD_NEEDS, HD_NEEDS_LAZY, hd, hdBackend, hdCapability, hdEntry } from './hd.ts';
import { HdLazy } from './hdremote.ts';
import type { HdState } from './hd.ts';
import { openModStore } from './store.ts';
import type { InstalledMod } from './store.ts';
import type { ModdedFiles } from './overlay.ts';
import { loadActiveMods } from './manage.ts';

const mbs = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const n = Object.assign(document.createElement(tag), props) as HTMLElementTagNameMap[K];
  n.append(...kids);
  return n;
};
const percent = (s: HdState) => (s.total > 0 ? Math.min(100, Math.floor((100 * s.done) / s.total)) : 0);
/** "HD-textures downloaden 34% (170 van 512 MB)" for a state that is running */
export function describeHd(s: HdState): string {
  if (s.phase === 'download' || s.phase === 'import') return `${s.label}… ${percent(s)}% (${mbs(s.done)} van ${mbs(s.total)})`;
  if (s.phase === 'waiting') return `${s.label}…`;
  if (s.phase === 'done') return `${s.label}: ze gelden vanaf de volgende zone.`;
  if (s.phase === 'error') return s.message ?? s.label;
  return s.label;
}

export interface HdOption {
  element: HTMLElement;
  /** the install is wanted (box checked) and the pack is not there yet */
  wanted(): boolean;
}

/**
 * The checkbox + a status line + a thin progress bar. `gate` is what a background install waits for before it starts (the game data the player needs first); the start
 * screen passes a promise that resolves at once when the data is local.
 */
export async function createHdOption(gate: () => Promise<unknown>): Promise<HdOption> {
  const store = await openModStore();
  let mod = await hd.installed(store);
  if (!mod && !hd.lazy) { const cached = await HdLazy.openCached(); if (cached) hd.attachLazy(cached); }   // fetched here before (on demand from archive.org)
  let backend: 'lazy' | 'mega' | null = hd.lazy ? 'lazy' : null;
  // the default depends on the source: on demand from archive.org needs little room, the MEGA whole pack a lot (the probe takes a moment; no answer in 3 s counts as MEGA)
  let cap = await hdCapability(store, HD_NEEDS_LAZY);
  if (cap.ok && !backend && !mod && currentPrefs().hd === null) {   // a device that fails the cheap checks (phone, little memory, little room) is not probed at all
    backend = await Promise.race([hdBackend(), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    if (backend !== 'lazy') cap = await hdCapability(store, HD_NEEDS);
  }
  const stored = currentPrefs().hd;
  // the store is the truth once the pack is there (the mod list can switch it off); before that the player's explicit choice, else the device's default
  let checked = mod ? mod.enabled : stored ?? cap.ok;
  if (mod && stored !== null && stored !== mod.enabled) storePrefs({ hd: mod.enabled });

  const box = el('input', { type: 'checkbox', id: 'le2-hd', checked });
  const note = el('div', { id: 'le2-hd-note', className: 'bdb-hdnote' });
  const bar = el('div', { className: 'bdb-loading-bar' });
  const track = el('div', { className: 'bdb-loading-track bdb-hdtrack', style: 'display:none' }, bar);
  const entry = hdEntry();
  let hdUnsub: (() => void) | null = null, seen = false;
  const idleText = () => {
    if (mod) return `Geïnstalleerd (${mbs(entry.unpacked)}). ${mod.enabled ? 'Geldt bij het spelen.' : 'Staat uit.'} Volledig beheer staat bij Mods.`;
    if (hd.lazy && (box.checked || hd.lazy.stats().completeArchives)) {
      const st = hd.lazy.stats();
      return `${box.checked ? 'Wordt per zone binnengehaald' : 'Staat uit'}: ${st.completeArchives} van ${st.totalArchives} onderdelen staan in je browser (${mbs(st.storedBytes)}). ${box.checked ? 'Een zone is scherper zodra zijn plaatjes binnen zijn (het eiland is ongeveer 65 MB); de rest komt op de achtergrond binnen.' : ''}`.trim();
    }
    if (box.checked && backend === 'lazy') return 'Wordt per zone op de achtergrond binnengehaald terwijl je speelt: alleen wat je bezoekt (het eiland is ongeveer 65 MB). Een zone is scherper zodra zijn plaatjes binnen zijn.';
    if (box.checked) return `Wordt op de achtergrond binnengehaald terwijl je speelt (${mbs(entry.size)} downloaden, ${mbs(entry.unpacked)} opslag in je browser). De plaatjes worden pas scherper vanaf de volgende zone na het downloaden.`;
    if (cap.ok) return backend === 'lazy'
      ? `Alle plaatjes vier keer zo scherp (door webfischi), per zone op aanvraag binnengehaald: het eiland is ongeveer 65 MB, alle zones samen ${mbs(entry.unpacked)} opslag in je browser.`
      : `Alle plaatjes vier keer zo scherp (door webfischi): ${mbs(entry.size)} downloaden, ${mbs(entry.unpacked)} opslag.`;
    return `${cap.reason} Je kunt het toch aanzetten.`;
  };
  const paint = (s: HdState) => {
    if (note.isConnected) seen = true;
    else if (seen) { hdUnsub?.(); hdUnsub = null; return; }   // the start screen is gone (the game started): the in-game badge takes over
    const active = s.phase === 'download' || s.phase === 'import';
    track.style.display = active ? '' : 'none';
    bar.style.width = `${percent(s)}%`;
    note.className = `bdb-hdnote${s.phase === 'error' ? ' bdb-warn' : ''}`;
    note.textContent = s.phase === 'idle' ? (s.label || idleText()) : s.phase === 'done' ? `HD-textures geïnstalleerd (${mbs(entry.unpacked)}). Ze gelden bij het spelen.` : describeHd(s);
    if (s.phase === 'error') box.checked = false;
    if (s.phase === 'done') void hd.installed(store).then((m) => { mod = m; });
  };
  hdUnsub = hd.subscribe(paint);

  if (box.checked && !mod && !backend) void hdBackend().then((b) => { backend = b; paint(hd.state); });   // the wording depends on the source (archive.org per zone / MEGA in one go)
  const begin = () => { if (!mod && !hd.running) void hd.start(gate()); };
  box.onchange = async () => {
    storePrefs({ hd: box.checked });
    if (box.checked) {
      if (!cap.ok && !mod && !confirm(`${cap.reason.replace(/^Standaard uit: /, '')}\n\nHet pakket downloaden (${mbs(entry.size)}) en bewaren (${mbs(entry.unpacked)}) toch aanzetten?`)) { box.checked = false; storePrefs({ hd: false }); paint(hd.state); return; }
      if (mod) { await hd.setEnabled(true); mod = await hd.installed(store); paint(hd.state); }
      else { begin(); if (!backend) void hdBackend().then((b) => { backend = b; paint(hd.state); }); paint(hd.state); }
    } else {
      hd.cancel();
      const stored = hd.lazy?.stats().storedBytes ?? 0;
      if (!mod && stored > 0) {
        if (confirm(`De opgeslagen HD-textures (${mbs(stored)}) ook van je browser verwijderen?\n\nOK = verwijderen, Annuleren = bewaren maar uitzetten.`)) { await hd.remove(); }
      } else if (mod) {
        if (confirm(`De opgeslagen HD-textures (${mbs(entry.unpacked)}) ook van je browser verwijderen?\n\nOK = verwijderen, Annuleren = bewaren maar uitzetten (je kunt ze later weer aanzetten zonder opnieuw te downloaden).`)) { await hd.remove(); mod = undefined; }
        else { await hd.setEnabled(false); mod = await hd.installed(store); }
      }
      paint(hd.state.phase === 'error' ? { phase: 'idle', label: '', done: 0, total: 0 } : hd.state);
    }
  };
  const element = el('div', { className: 'note bdb-hd' },
    el('label', { title: 'Het HD Texture Pack van webfischi (vier keer zo scherpe plaatjes, gemaakt met waifu2x). Uit = precies het originele beeld.' }, box, ' HD-textures'),
    note, track);
  return { element, wanted: () => !mod && box.checked };
}

/** a small indicator in the game's corner while the pack installs in the background, and for a moment when it is ready (it is not in the page when nothing is going on) */
export function showHdBadge(): () => void {
  document.getElementById('le2-hdbadge')?.remove();
  let badge: HTMLElement | null = null, hide = 0;
  const off = hd.subscribe((s) => {
    window.clearTimeout(hide);
    if (s.phase === 'idle') { badge?.remove(); badge = null; return; }
    if (!badge) { badge = el('div', { id: 'le2-hdbadge', className: 'le2-loadbadge le2-hdbadge' }); document.body.appendChild(badge); }
    badge.classList.toggle('le2-err', s.phase === 'error');
    badge.textContent = s.phase === 'download' || s.phase === 'import' ? `${s.label}: ${percent(s)}%` : describeHd(s);
    if (s.phase === 'done' || s.phase === 'error') hide = window.setTimeout(() => { badge?.remove(); badge = null; }, s.phase === 'error' ? 15000 : 8000);
  });
  return () => { off(); window.clearTimeout(hide); badge?.remove(); };
}

/** the running game's file layer takes the pack in at the next zone change once it is installed in the background */
export function hdJoinsGame(files: unknown) {
  const f = files as Partial<ModdedFiles>;
  hd.onLazy = (l) => { if (f.queue) f.lazy = l; };
  hd.onInstalled = async (mod: InstalledMod) => {
    if (!f.queue) return;
    const active = (await loadActiveMods(await openModStore())).filter((m) => m.id === mod.id);
    f.queue(active);
  };
}
