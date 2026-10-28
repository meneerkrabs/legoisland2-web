// Pepper's computer (z03PPH): the menu that runs while PEPPER_CONTROL (var 0x5e) is 4. Ported from FUN_0053fbc0 (the per-frame step: restore of the menu state
// after a replay, start of the menu, engine step, handling of the events), FUN_0053fed3 (entering the computer / the zone start), FUN_0041b9b1 (the actions of
// the pages 22 / 23 / 24) and the page set-up functions FUN_0041b08c (movies), FUN_0041b0d2 (sound test) and FUN_0041b12d (replay list). Pure: the menu
// engine (src/shell/menu.ts) and the game variables only; the host supplies the movie player and the music.
//
// Pages (src/shell/tables.ts `readMenuPages`): 21 = PPHM0 (root: sub-game replays / sound / movies / back), 22 = PPHMOVIES (2 actions 0x12 / 0x13: IntroFMV /
// OutroFMV), 23 = PPHSOUND (list of the 22 music keys of the sound test table 0x8a5bb0), 24 = PPHSUBGAME (list of the 19 replays of the table 0x8a57f0).
import { MenuEngine } from '../../shell/menu.ts';
import type { MenuItem, PointerState } from '../../shell/menu.ts';
import { replayEnabled, packMenuInternals } from '../../shell/tables.ts';
import type { LevelSelect } from '../../shell/tables.ts';
import type { GameVars } from '../../game/vars.ts';

/** menu pages of the computer */
export const PAGE = { ROOT: 0x15, MOVIES: 0x16, SOUND: 0x17, REPLAYS: 0x18 } as const;
/** actions of the movies page (items 1 / 2: ids 0x12 / 0x13) */
export const ACTION = { INTRO_MOVIE: 0x12, OUTRO_MOVIE: 0x13 } as const;
/** disable mask passed to the engine by FUN_0053fbc0 (FUN_0041fd45(engine, &a, &b, 3)) */
export const COMPUTER_MASK = 3;
/** story node from which the outro movie is selectable (FUN_0041b08c: `var 0x58 < 0x44` greys item 2 out) */
export const OUTRO_NODE = 0x44;
/** game variables the computer uses */
export const VAR = { PPH_MENU_INTERNALS: 0x4d, STARTED_FROM_MENU: 0xb, PREV_SUBGAME: 0xa3, NEXT_SUBGAME: 5, STORY: 0x58, PEPPER_CONTROL: 0x5e } as const;

export interface ComputerHost {
  vars: Pick<GameVars, 'get' | 'set'>;
  levels: LevelSelect;
  /** page 22: play IntroFMV (1) / OutroFMV (2); the original blocks until the movie ends */
  movie(which: 1 | 2): void;
  /** page 23: stop the music and play the DirectMusic segment `key` */
  music(key: string): void;
}

/** the three bytes of var 0x4d the replay start packs (`FUN_0041b9b1` case 0x18) and FUN_0053fbc0 unpacks */
export function unpackMenuInternals(v: number) {
  const sc = (x: number) => (x << 24) >> 24;
  return { page: v & 0x7f, restore: ((v >> 7) & 1) === 1, item: sc(v >> 8), scroll: sc(v >> 16), prev: sc(v >> 24) };
}

/** FUN_0053fed3 at the zone start (param 1): returns true when the computer has to open at once (the player returns from a replay: bit 7 of var 0x4d) */
export function enterZone(vars: Pick<GameVars, 'get' | 'set'>): boolean {
  const v = vars.get(VAR.PPH_MENU_INTERNALS);
  if (((v >> 7) & 1) !== 0) { vars.set(VAR.PEPPER_CONTROL, 4); return true; }
  // the zone the player came from is parked in the top byte of var 0x4d (var 0xa3 is overwritten by the sub-games)
  vars.set(VAR.PPH_MENU_INTERNALS, ((vars.get(VAR.PREV_SUBGAME) << 24) >> 24) << 24);
  return false;
}

export class ComputerMenu {
  readonly engine: MenuEngine;
  readonly host: ComputerHost;
  /** DAT_05d58784: the menu is running (the loop does not sample the pause key, the HUD is not drawn) */
  active = false;
  /** engine[7] != -1: the menu was initialised */
  started = false;
  /** the outcome of the last event: the entry that was started (diagnostics / tests) */
  lastAction: { kind: 'movie' | 'music' | 'replay' | 'leave'; arg?: number | string } | null = null;
  private oldSetup: MenuEngine['hooks']['setup'];
  private attached = false;

  constructor(engine: MenuEngine, host: ComputerHost) { this.engine = engine; this.host = host; }

  /** install the page set-up functions (replay list, sound test, movie item) into the engine's hooks */
  attach() {
    if (this.attached) return;
    this.attached = true;
    this.oldSetup = this.engine.hooks.setup;
    this.engine.hooks.setup = (page, at, item, index, e) => {
      const r = this.setup(page, at, item, index);
      return r !== undefined ? r : (this.oldSetup ? this.oldSetup(page, at, item, index, e) : -1);
    };
  }
  detach() {
    if (!this.attached) return;
    this.attached = false;
    this.engine.hooks.setup = this.oldSetup;
  }

  /** FUN_0041b08c / FUN_0041b0d2 / FUN_0041b12d; `undefined` = not a page of the computer */
  private setup(_page: number, at: number, item: MenuItem | null, index: number): number | undefined {
    const g = (i: number) => this.host.vars.get(i);
    switch (at) {
      case 0x41b08c: {
        // page 22: item 2 (the outro) needs story node 0x44; the engine only calls the page-level function (index -1, item null): patch the page's items
        const it = this.engine.pages[PAGE.MOVIES]?.items[2];
        if (it) it.disable = g(VAR.STORY) < OUTRO_NODE ? 0x20 : 0;
        return -1;
      }
      case 0x41b0d2: {
        // page 23: list entry `index` of the sound table (label LEVxxx, value = the entry: the music key)
        const s = this.host.levels.sounds;
        if (!item) return -1;
        if (index < 0 || index >= s.length) return -1;
        item.label = '!' + s[index].label;
        item.value = index;
        return s.length - index - 1;
      }
      case 0x41b12d: {
        // page 24: list entry `index` of the replay list; greyed out until its gate variable (the TROPHY_xxx) is non-zero
        const r = this.host.levels.replays;
        if (!item) return -1;
        if (index < 0 || index >= r.length) return -1;
        item.label = r[index].label;
        item.disable = replayEnabled(r[index], g) ? 0 : 0x20;
        return r.length - index - 1;
      }
      default: return undefined;
    }
  }

  /** FUN_0053fed3(0) (a hotspot opens the computer) / the engine part of the zone-start call: the menu has to be initialised again */
  reset() {
    this.started = false;
    this.engine.titleDy = 0x12; this.engine.itemDy = -2;     // FUN_004201aa
  }

  /**
   * FUN_0053fbc0: one frame of the computer. Returns true when the computer is left (back from the root page, or a replay was started); the caller then
   * sets PEPPER_CONTROL back to 1 (FUN_0054003e).
   */
  step(pressed: number, pointer?: PointerState): boolean {
    const v = this.host.vars;
    this.active = true;
    const raw = v.get(VAR.PPH_MENU_INTERNALS);
    const u = unpackMenuInternals(raw);
    v.set(VAR.PPH_MENU_INTERNALS, raw & ~0x80);
    v.set(VAR.PREV_SUBGAME, u.prev);
    const e = this.engine;
    let leave = false;
    if (!u.restore) {
      if (!this.started) {
        // engine[7] == -1: start at the root page
        e.openAt(PAGE.ROOT);
        this.started = true;
        v.set(VAR.STARTED_FROM_MENU, 0);
      } else {
        const r = e.step(pressed, COMPUTER_MASK, pointer);
        leave = this.handle(r.ev, r.a, r.b);
        if (leave) { this.started = false; e.close(); }
      }
    } else {
      // back from a replay: the replay list again, with the cursor where it was (the root page is on the stack)
      e.openAt(u.page);
      e.stack = [{ page: PAGE.ROOT, item: 1 }];
      e.item = u.item; e.scroll = u.scroll;
      e.refreshList();
      this.started = true;
      v.set(VAR.STARTED_FROM_MENU, 0);
    }
    if (leave) this.active = false;
    return leave;
  }

  /** the wrapper of FUN_0053fbc0 around FUN_0041b9b1: `ev` / `a` / `b` are the engine's event, its first out value `b` (item value) and second `a` (page left / -1) */
  private handle(ev: number, a: number, b: number): boolean {
    const e = this.engine, v = this.host.vars;
    if (ev === 2 && a === -1) { this.lastAction = { kind: 'leave' }; return true; }
    if (ev !== 4) return false;
    if (e.page === PAGE.MOVIES) {
      if (b === ACTION.INTRO_MOVIE) { this.lastAction = { kind: 'movie', arg: 1 }; this.host.movie(1); }
      else if (b === ACTION.OUTRO_MOVIE) { this.lastAction = { kind: 'movie', arg: 2 }; this.host.movie(2); }
    } else if (e.page === PAGE.SOUND) {
      const s = this.host.levels.sounds[b];
      if (s) { this.lastAction = { kind: 'music', arg: s.musicKey }; this.host.music(s.musicKey); }
    } else if (e.page === PAGE.REPLAYS) {
      const idx = e.scroll - 1 + Math.trunc(e.item / 10);
      const rep = this.host.levels.replays[idx];
      if (rep) {
        v.set(VAR.NEXT_SUBGAME, rep.zone);
        v.set(VAR.STARTED_FROM_MENU, 1);
        v.set(VAR.PPH_MENU_INTERNALS, packMenuInternals(e.page, e.item, e.scroll, v.get(VAR.PREV_SUBGAME)));
        this.lastAction = { kind: 'replay', arg: idx };
        return true;
      }
    }
    return false;
  }
}
