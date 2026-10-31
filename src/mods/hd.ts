// The HD Texture Pack (webfischi) as a start-screen option "HD-textures": a checkbox, CHECKED BY DEFAULT where it can work (docs/re/mods.md "HD-textures op de startpagina").
//
//   * The pack is the catalogue entry `hd-texture` (MEGA, 512 MB RAR, 2,16 GB / 5032 files unpacked into the mod store) and ends up as an ordinary, enabled entry of the
//     mod list, with its credits. When the player already imported it by hand, that copy is reused (nothing is downloaded).
//   * Never blocks play: the install runs in the background (`HdInstaller.start`), after the game data the player needs first; the game starts without it. The pack joins
//     the mod layer at the next zone change (`ModdedFiles.queue` / `zoneBoundary`) and is part of it from the next page load on.
//   * No half-imported files: the mod store writes `mod.json` last, a cut-off import (reload, closed tab) leaves a folder without it that the next visit removes. The
//     download goes to one temporary file in OPFS that is removed the same way. A reload mid-download therefore restarts cleanly (the download is not resumed).
//   * One installer at a time: a Web Lock (`INSTALL_LOCK`) is held while it runs, so a second tab neither downloads again nor cleans up the first one's files.
//   * TWO SOURCES behind the same checkbox. (a) archive.org, read ON DEMAND (src/mods/hdremote.ts, used when the relay serves the item): only the archives the player visits are fetched
//     and cached, nothing is imported as a mod. (b) MEGA, the whole pack imported into the mod store as an ordinary mod (below). `hdBackend()` picks (a) when it works, else (b).
//   * Default only where it can work (`hdCapability`): desktop-class (no phone / tablet, `deviceMemory` >= 8 when the browser tells), room in the browser's storage for
//     the download plus the unpacked files, a persistent mod store. Otherwise the box is unchecked with a short explanation; the player can still turn it on.
import { CATALOGUE, addFromCatalogue, cleanTemp } from './catalogue.ts';
import type { CatalogueEntry } from './catalogue.ts';
import { INSTALL_LOCK, openModStore } from './store.ts';
import type { InstalledMod, ModStore } from './store.ts';
import { storePrefs } from '../display.ts';
import { HdLazy, PRIORITY, hdZipUrl } from './hdremote.ts';
import type { LazyProgress } from './hdremote.ts';

export const HD_ID = 'hd-texture';
export const hdEntry = (): CatalogueEntry => CATALOGUE.find((e) => e.id === HD_ID)!;
/** MEGA: download + unpacked files at the same moment (the temporary RAR is removed after the import) */
export const HD_NEEDS = 2.8e9;
/** archive.org on demand: room for the zones the player visits (the island alone is 223 MB unpacked, everything 2,2 GB over time) */
export const HD_NEEDS_LAZY = 1.2e9;

const mbs = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1).replace('.', ',')} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

// ------------------------------------------------------------------------------------------------------------------------ capability

export interface HdCapability { ok: boolean; /** Dutch, why not (empty when ok) */ reason: string }
export interface CapabilityEnv {
  userAgent: string;
  mobileHint?: boolean;
  touchPrimary: boolean;
  deviceMemory?: number;
  persistent: boolean;
  /** free bytes in the browser's storage (null: unknown) */
  room: number | null;
}

/** pure decision (unit-testable): phone / tablet, little memory, little storage room, no persistent store -> not by default */
export function judgeCapability(e: CapabilityEnv, needs = HD_NEEDS): HdCapability {
  if (e.mobileHint || /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(e.userAgent) || e.touchPrimary) {
    return { ok: false, reason: 'Standaard uit op telefoons en tablets: het pakket is groot (tot 2,2 GB in de opslag van je browser) en het eiland vraagt er veel meer geheugen mee.' };
  }
  if (e.deviceMemory !== undefined && e.deviceMemory < 8) {
    return { ok: false, reason: `Standaard uit: dit apparaat meldt weinig geheugen (${e.deviceMemory} GB) en het eiland gebruikt met de HD-textures ongeveer 450 MB meer.` };
  }
  if (!e.persistent) return { ok: false, reason: 'Standaard uit: deze browser kan de HD-textures niet bewaren (geen bestandsopslag beschikbaar).' };
  if (e.room !== null && e.room < needs) {
    return { ok: false, reason: `Standaard uit: de opslag van deze browser heeft te weinig ruimte (${mbs(Math.max(0, e.room))} vrij, ongeveer ${mbs(needs)} nodig). Een privé- of tijdelijk venster heeft weinig ruimte.` };
  }
  return { ok: true, reason: '' };
}

/** the capability of this device; `override` is only for tests (`?hdcaps=mobile|lowmem|noroom`, see `capsOverride`) */
export async function hdCapability(store: ModStore, needs = HD_NEEDS): Promise<HdCapability> {
  const nav = globalThis.navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  const coarse = (() => { try { return globalThis.matchMedia?.('(pointer: coarse)').matches === true && (nav.maxTouchPoints ?? 0) > 0; } catch { return false; } })();
  let room: number | null = null;
  try { const est = await nav.storage?.estimate?.(); if (est?.quota) room = est.quota - (est.usage ?? 0); } catch { /* unknown */ }
  const env: CapabilityEnv = { userAgent: nav.userAgent ?? '', mobileHint: nav.userAgentData?.mobile === true, touchPrimary: coarse, deviceMemory: nav.deviceMemory, persistent: store.persistent, room };
  return judgeCapability({ ...env, ...capsOverride() }, needs);
}
/** test hook: `?hdcaps=mobile|lowmem|noroom` pretends to be such a device (the real checks stay in `judgeCapability`) */
function capsOverride(): Partial<CapabilityEnv> {
  const v = new URLSearchParams(globalThis.location?.search ?? '').get('hdcaps');
  return v === 'mobile' ? { touchPrimary: true } : v === 'lowmem' ? { deviceMemory: 4 } : v === 'noroom' ? { room: 500e6 } : {};
}

// ------------------------------------------------------------------------------------------------------------------------ installer

export type HdPhase = 'idle' | 'waiting' | 'download' | 'import' | 'done' | 'error';
export interface HdState { phase: HdPhase; /** what is going on, Dutch */ label: string; done: number; total: number; /** only with 'error' */ message?: string }

const IDLE: HdState = { phase: 'idle', label: '', done: 0, total: 0 };

export class HdInstaller {
  state: HdState = IDLE;
  private listeners = new Set<(s: HdState) => void>();
  private abort: AbortController | null = null;
  private lastEmit = 0;
  /** called once when a background install completed (the game adds the pack to its layer) */
  onInstalled: ((mod: InstalledMod) => void) | null = null;
  /** the on-demand source (archive.org) once it is chosen or was found in the cache; the running game's file layer reads from it */
  lazy: HdLazy | null = null;
  onLazy: ((lazy: HdLazy) => void) | null = null;
  private lazyUnsub: (() => void) | null = null;
  private lazyWasActive = false;

  get running() { return this.abort !== null; }
  subscribe(fn: (s: HdState) => void): () => void { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  private set(s: HdState, force = true) {
    const now = Date.now();
    if (!force && now - this.lastEmit < 250) { this.state = s; return; }
    this.lastEmit = now;
    this.state = s;
    for (const l of [...this.listeners]) l(s);
  }

  /** the pack when it is in the store (installed by the background install or imported by hand) */
  async installed(store?: ModStore): Promise<InstalledMod | undefined> {
    const s = store ?? await openModStore();
    return (await s.list()).find((m) => m.origin?.catalog === HD_ID || m.source === `catalogus:${HD_ID}`);
  }

  /**
   * Download, unpack and store the pack in the background. `after` (optional) delays the start until the game has what it needs first. Resolves when finished, failed or
   * cancelled (never rejects). Does nothing when already running or already installed. A failure unchecks the option (stored as an explicit choice) and says why.
   */
  start(after?: Promise<unknown>): Promise<void> {
    if (this.abort) return this.last;
    const abort = this.abort = new AbortController();
    const prev = this.last;   // a cancelled run that is still cleaning up (its files and the install lock) finishes first
    return this.last = this.run(abort, prev, after);
  }
  private last: Promise<void> = Promise.resolve();

  private async run(abort: AbortController, prev: Promise<void>, after?: Promise<unknown>): Promise<void> {
    const entry = hdEntry();
    const idle = () => { if (!this.abort || this.abort === abort) this.set(IDLE); };   // a cancelled run must not wipe the state of a newer one
    try {
      if (after) {
        this.set({ phase: 'waiting', label: 'HD-textures beginnen na het laden van het spel', done: 0, total: 0 });
        await Promise.race([after, new Promise((r) => abort.signal.addEventListener('abort', r))]);
      }
      await prev;
      if (abort.signal.aborted) return idle();
      const store = await openModStore();
      if (!store.persistent) throw new Error('Deze browser kan de HD-textures niet bewaren (geen bestandsopslag beschikbaar).');
      if (await this.installed(store)) return idle();
      const lazy = this.lazy ?? await openLazyBackend();
      if (lazy) return await this.runLazy(lazy, abort, idle);
      await cleanTemp();   // what a cut-off earlier visit left (not while another tab holds the lock: cleanTemp checks)
      const run = async () => {
        this.set({ phase: 'download', label: 'HD-textures downloaden', done: 0, total: entry.size });
        const res = await addFromCatalogue(entry, store, {
          signal: abort.signal,
          progress: (p) => this.set({ phase: p.phase === 'import' ? 'import' : 'download', label: p.phase === 'import' ? 'HD-textures uitpakken' : 'HD-textures downloaden', done: p.done, total: p.total }, p.done >= p.total),
        });
        if (abort.signal.aborted) return idle();
        if (res.errors.length) throw new Error(res.errors.join(' '));
        this.set({ phase: 'done', label: 'HD-textures klaar', done: 1, total: 1 });
        const mod = await this.installed(store);
        if (mod) this.onInstalled?.(mod);
      };
      const locks = (globalThis.navigator as Navigator | undefined)?.locks;
      if (locks) {
        await locks.request(INSTALL_LOCK, { ifAvailable: true }, async (lock) => {
          if (!lock) { this.set({ phase: 'idle', label: 'HD-textures worden al in een ander venster geïnstalleerd', done: 0, total: 0 }); return; }
          await run();
        });
      } else await run();
    } catch (e) {
      if (abort.signal.aborted) idle();
      else {
        const msg = e instanceof Error ? e.message : String(e);
        storePrefs({ hd: false });
        this.set({ phase: 'error', label: 'HD-textures niet gelukt', done: 0, total: 0, message: `De HD-textures zijn niet geïnstalleerd en staan weer uit: ${msg}` });
      }
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  /** the on-demand source: fetch the archives the player needs first, then leave the rest to the zones (`HdLazy.prepare`) */
  private async runLazy(lazy: HdLazy, abort: AbortController, idle: () => void) {
    this.attachLazy(lazy);
    const todo = PRIORITY.filter((a) => lazy.has(a) && !lazy.isComplete(a));
    if (!todo.length) return idle();
    for (const a of todo) {
      if (abort.signal.aborted) return idle();
      await lazy.ensure(a);
    }
    if (abort.signal.aborted) return idle();
    this.set({ phase: 'done', label: 'HD-textures voor het eiland klaar', done: 1, total: 1 });
  }
  /** make `lazy` the page's on-demand source: its fetch progress drives the state (start screen note, in-game badge) */
  attachLazy(lazy: HdLazy) {
    if (this.lazy === lazy) return;
    this.lazyUnsub?.();
    this.lazy = lazy;
    this.lazyUnsub = lazy.subscribe((p: LazyProgress) => {
      if (p.active.length) {
        this.lazyWasActive = true;
        this.set({ phase: 'download', label: `HD-textures ophalen (${p.active.join(', ')})`, done: p.done, total: p.total }, p.done >= p.total);
      } else if (this.lazyWasActive) {
        this.lazyWasActive = false;
        if (lazy.failed) {
          storePrefs({ hd: false });
          this.set({ phase: 'error', label: 'HD-textures niet gelukt', done: 0, total: 0, message: `De HD-textures staan weer uit: ${lazy.failed.message}` });
        } else this.set({ phase: 'done', label: 'HD-textures bijgewerkt', done: 1, total: 1 });
      }
    });
    this.onLazy?.(lazy);
  }

  /** stop a running install; the download and the half-imported files are removed by the aborted import itself */
  cancel() {
    this.lazy?.cancel();
    if (this.state.phase === 'download' && this.lazy) this.set(IDLE);
    if (!this.abort) return;
    this.abort.abort();
    this.abort = null;
    if (this.state.phase === 'waiting') this.set(IDLE);
  }

  /** remove the stored pack (about 2 GB) */
  async remove(): Promise<void> {
    this.lazy?.cancel();
    this.lazyUnsub?.(); this.lazyUnsub = null; this.lazy = null;
    await HdLazy.removeAll();
    lazyOpening = null; backendProbe = null;   // the opened source (its list of cached archives) is stale now
    const store = await openModStore();
    const m = await this.installed(store);
    if (m) await store.remove(m.id);
    if (this.state.phase === 'done' || this.state.phase === 'error') this.set(IDLE);
  }
  async setEnabled(on: boolean): Promise<void> {
    const store = await openModStore();
    const m = await this.installed(store);
    if (m && m.enabled !== on) await store.setEnabled(m.id, on);
  }
}

/** the one installer of this page (the start screen, the in-game badge and the game's mod layer share it) */
export const hd = new HdInstaller();
(globalThis as { __le2Hd?: HdInstaller }).__le2Hd = hd;   // for the browser tests (tools/hd-check.mjs)


/** the on-demand source when it can be had: what is cached here, else the archive.org item through the relay (its zip index is read once and kept); null = use MEGA */
let lazyOpening: Promise<HdLazy | null> | null = null;
export function openLazyBackend(_signal?: AbortSignal): Promise<HdLazy | null> {
  // one attempt at a time per page (the start screen's wording and the install both ask); a failed attempt may be repeated later
  return (lazyOpening ??= (async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 10000);
    try {
      const cached = await HdLazy.openCached();
      if (cached) return cached;
      return await HdLazy.openRemote(hdZipUrl(), { signal: ac.signal });
    } catch (e) {
      console.info('hd: archive.org (op aanvraag) niet beschikbaar, terugval op MEGA:', e instanceof Error ? e.message : e);
      return null;
    } finally { clearTimeout(t); }
  })().then((l) => { if (!l) lazyOpening = null; return l; }));
}

/** which source a first install would use (for the start screen's wording); probes the relay once per page */
let backendProbe: Promise<'lazy' | 'mega'> | null = null;
export function hdBackend(): Promise<'lazy' | 'mega'> {
  return (backendProbe ??= openLazyBackend().then((l) => { if (l) { hd.attachLazy(l); return 'lazy' as const; } backendProbe = null; return 'mega' as const; }));
}

/** the on-demand source for a game that starts now, or null: off (`?hd=0` / unchecked), or never fetched here and nothing is being fetched */
export async function hdLazyForGame(want: boolean | null): Promise<HdLazy | null> {
  if (want === false) return null;
  if (hd.lazy) return hd.lazy;
  const cached = await HdLazy.openCached();
  if (cached) hd.attachLazy(cached);
  return cached;
}
