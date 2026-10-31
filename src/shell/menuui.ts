// The menu as the player sees it: the engine (menu.ts) + drawing (menudraw.ts) + the handler of the engine's events (FUN_0041b500) and the page
// set-up functions of the EXE by address (FUN_0041ae6e, 0041aef3, 0041afbc, 0041b037, 0041b2c1, 0041b2fd ...: they patch captions / disable masks).
// One MenuUi serves the front end and the pause menus; the shell supplies the rest of the world through `MenuContext`.
import type { Options } from './options.ts';
import { S } from './options.ts';
import type { GameVars } from '../game/vars.ts';
import type { MenuStrings } from '../ui/strings.ts';
import type { Ui2D, UiTextureSet } from '../ui/renderer2d.ts';
import type { MenuPage as RawPage, LevelEntry } from './tables.ts';
import { IT, MenuEngine } from './menu.ts';
import type { MenuItem, MenuPage, PointerState } from './menu.ts';
import { drawMenu, menuLabel, readRowTables } from './menudraw.ts';
import type { MenuGfx, MenuRowTables } from './menudraw.ts';
import { keyCodeLabel } from './dik.ts';
import { EMPTY_SLOT_CAPTION } from './save.ts';
import type { SaveHeader } from './save.ts';
import { applyUiOffsets } from './uioffsets.ts';

/** what the menu needs from the shell */
export interface MenuContext {
  options: Options;
  vars: GameVars;
  msgs: MenuStrings;
  keyNames: Map<number, string>;
  /** the 13 logical keys' table of the EXE (key bit per index) */
  keyBits: number[];
  rows: MenuRowTables;
  sound(kind: 'move' | 'select' | 'back' | 'onoff'): void;
  /** header of a save slot (null = empty): sync, from the shell's slot cache */
  slotHeader(slot: number): SaveHeader | null;
  /** FSM node -> `FSMSTATEnn` caption id */
  captionId(node: number): string | null;
  /** the current story node (var 0x58) */
  storyNode(): number;
  /** a cutscene is running (FUN_0045c432) */
  cutsceneRunning(): boolean;
  /** save into slot (FUN_0041a939); returns false when there is nothing to save */
  saveSlot(slot: number): boolean;
  /** FUN_00419bb9: 0 = no such save, 1 = restored in place, 2 = leave the zone (the shell queued the load) */
  loadSlot(slot: number): 0 | 1 | 2;
  /** FUN_0041a968 */
  eraseSlot(slot: number): void;
  /** FUN_0041a8f9 + FUN_0041786a + var 5 = 2: start a new game; true when the zone has to be left */
  newGame(): boolean;
  /** the key bindings changed: the input mapper must pick them up */
  keysChanged(): void;
  /** FUN_00437e82 / FUN_00437f6e / the key table's current key (entry +4): the live key table the input poll reads, separate from the Settings array (docs/re/input.md section 2) */
  bindKey?(index: number, code: number): void;
  cancelKeys?(): void;
  keyOf?(index: number): number;
  /** FUN_00438099 (the key capture of the key page): the key code that is down now and may be bound (`own` = the entry's current key), 0 = none */
  captureKey(own: number): number;
  /** options changed: apply (volumes, draw distance ...) */
  optionChanged(index: number): void;
  /** font metrics for the panel widths */
  measure(font: 0 | 1, s: string): number;
  /** "Beeld" (src/display.ts): the current mode, and the switch to the other one (the Graphics page's resolution entry becomes this choice) */
  display?: { wide(): boolean; toggle(): void };
  /** the original's story-checkpoint list (page 17, the Mod Manager's "Debug Mode") and what choosing an entry does (FUN_0041be4e); absent = the page stays empty */
  checkpoints?: LevelEntry[];
  gotoCheckpoint?(entry: LevelEntry): void;
  /** the original's QA zone list (page 26, reached from the alternative main menu 25 that nothing opens; debug mode only, src/devcorner) and its action (FUN_0041be4e, branch 0x1a) */
  allZones?: LevelEntry[];
  gotoZone?(entry: LevelEntry): void;
}

export function toEnginePages(raw: RawPage[]): MenuPage[] {
  return raw.map((p) => ({ kind: p.kind, theme: p.type, setupAt: p.setupFn, slotTypes: p.slotTypes, items: p.items.map((i): MenuItem => ({ label: i.label, type: i.type, value: i.id, disable: i.mask })) }));
}

/** result codes of the event handler (FUN_0041b500) */
export const MR = { STAY: 0, RESUME: 1, QUIT: -1, RESTART: -2, ABANDON: -3, CREDITS: -4 } as const;

const GFX_DISPLAY_ITEM = 4, GFX_DISPLAY_ACTION = 14, CHECKPOINT_PAGE = 17, ALLZONES_PAGE = 26;
const LOAD_PAGE = 2, SAVE_PAGE = 3, ERASE_PAGE = 8, NEWGAME_LIST = 7, OPTIONS_SOUND = 11, OPTIONS_GAME = 12, OPTIONS_GFX = 10, OPTIONS_CTRL = 9, KEYS_PAGE = 13, PAUSE_ISLAND = 5;

export class MenuUi {
  readonly ctx: MenuContext;
  readonly engine: MenuEngine;
  /** the disable mask of the current caller (pause menus: 0x40 / 0x80) */
  mask = 0;
  /** key bindings when the key page was entered (restored when it is left with "cancel") */
  private keyBackup: number[] | null = null;
  /** DAT_009d9fc0 / DAT_009d9fc4: a bindable key was down at the last poll of the capture (it is bound when it is let go) and which one; never reset by Esc, like the original */
  private capHeld = false;
  private capCode = 0;
  private pages: MenuPage[];

  constructor(ctx: MenuContext, pages: RawPage[]) {
    this.ctx = ctx;
    this.pages = toEnginePages(pages);
    this.engine = new MenuEngine(this.pages, {
      sound: (k) => ctx.sound(k),
      setup: (page, at, item, index, e) => this.setup(page, at, item, index, e),
    });
    this.syncFromOptions();
  }

  /** FUN_0041bbd6: the items that show an option get its current value */
  syncFromOptions() {
    const o = this.ctx.options, p = this.pages;
    p[OPTIONS_SOUND].items[1].value = o.musicVolume;
    p[OPTIONS_SOUND].items[2].value = o.sfxVolume;
    p[OPTIONS_SOUND].items[3].value = o.speechVolume;
    p[OPTIONS_GAME].items[1].value = o.a[S.SPEECH_ON];
    p[OPTIONS_GAME].items[2].value = o.a[S.SUBTITLES_ON];
    p[OPTIONS_GFX].items[1].value = o.drawDistance;
    p[OPTIONS_GFX].items[2].value = o.a[S.TEXTURE_QUALITY];
    p[OPTIONS_CTRL].items[2].value = o.a[S.GAMEPAD];
    p[OPTIONS_CTRL].items[3].value = o.sensitivity;
  }

  /** open at `page` (FUN_0041bd3d: 5 / 0x12 / 0x1d, FUN_0041be4e: 0, FUN_0041c092: 0xf / 0x10 / 0x13) */
  open(page: number, mask = 0, pause = false) {
    this.mask = mask;
    this.pauseRoot = pause;
    // FUN_0041bd3d's opening call: var 10 (FX_PARTICLE_ONLYRENDER) = 1 while a pause menu is open (the particle and brick effects only draw), 0 again when it returns a result
    if (pause) this.ctx.vars.set(10, 1);
    this.syncFromOptions();
    // FUN_0041c080 (-> FUN_004201aa) runs before every menu of the original opens (pause trigger, result menu, the front end's set-up): the offsets are the executable's globals now
    applyUiOffsets();
    this.engine.openAt(page);
  }
  get isOpen() { return this.engine.open; }
  close() { this.engine.close(); if (this.pauseRoot) { this.ctx.vars.set(10, 0); this.pauseRoot = false; } }

  // ---- the page set-up functions of the EXE ---------------------------------------------------------------------------------------------------
  private setup(page: number, at: number, item: MenuItem | null, index: number, e: MenuEngine): number {
    const c = this.ctx;
    switch (at) {
      case 0x41ae6e: case 0x41aef3: { // load / save / erase pages: item n shows slot n - 1 (FUN_0041ae6e)
        if (page !== LOAD_PAGE && page !== SAVE_PAGE && page !== ERASE_PAGE && page !== NEWGAME_LIST) break;
        return -1;
      }
      case 0x41afbc: break;
      case 0x41ade0: { // the confirm page (20, FUN_0041ade0): its title is the title of the page that opened it, or (the pause menus' "!PAUSE") the label of the item that was chosen
        if (item || e.stack.length === 0) return -1;
        const from = e.stack[e.stack.length - 1], src = this.pages[from.page];
        const title = src.items[0].label;
        e.cur.items[0].label = title.toLowerCase() === '!pause' ? src.items[from.item].label : title;
        return -1;
      }
      case 0x41b227: { // story checkpoints (page 17; reachable through the Debug Mode patch): list entry `index` = record `index` of the table at 0x8a5c68 (label, disable mask)
        if (!item) return 0;
        const t = c.checkpoints;
        if (!t || index < 0 || index >= t.length) return -1;
        item.label = t[index].label;
        item.disable = t[index].mask;
        return t.length - 1 - index;   // FUN_0041b227 returns 0x24 - index: the entries that follow this one
      }
      case 0x41b274: { // QA zone list (page 26): entry `index` = record `index` of the table at 0x8a62c8; FUN_0041b274 returns 0x19 - index
        if (!item) return 0;
        const t = c.allZones;
        if (!t || index < 0 || index >= t.length) return -1;
        item.label = t[index].label;
        item.disable = t[index].mask;
        return t.length - 1 - index;
      }
      case 0x41b037: { // key list (FUN_0041b037): entry `index` of the 13 keys
        if (!item) return 0;
        if (index < 0 || index >= 13) return -1;
        const label = c.msgs.label(this.keyLabelId(index));
        item.label = label;
        item.value = c.keyOf ? c.keyOf(index) : c.options.a[S.KEY_FIRST + index];   // entry +0x24 of the live key table
        item.disable = c.options.defaultOf(S.KEY_FIRST + index);   // the fixed key of the action (entry + 0x20)
        return 13 - index - 1;
      }
      default: break;
    }
    void e;
    return -1;
  }
  private keyLabelId(index: number) { return ['!UP', '!DOWN', '!LEFT', '!RIGHT', '@ 1!ACTION', '@ 2!ACTION', '@ 3!ACTION', '@ 4!ACTION', '@ 5!ACTION', '@ 6!ACTION', '@ 7!ACTION', '@ 8!ACTION', '!RETURN'][index] ?? ''; }

  /** per-frame patching of the current page (captions of the save slots, disabled entries) */
  private refreshPage() {
    const e = this.engine, c = this.ctx, p = e.cur;
    const slotPage = e.page === LOAD_PAGE || e.page === SAVE_PAGE || e.page === ERASE_PAGE || e.page === NEWGAME_LIST;
    if (slotPage) {
      // FUN_0041ae6e / FUN_0041aef3: item n shows the caption of slot n - 1 (FSMSTATEnn of its story state, or "<-------->" when empty); the slots are list items
      // (type 9) that are only greyed while a cutscene runs (FUN_0045c432), an empty slot is chosen like any other (loading it does nothing, saving fills it)
      for (let i = 1; i < 8 && i < p.items.length; i++) {
        const it = p.items[i];
        if (c.cutsceneRunning()) { it.label = EMPTY_SLOT_CAPTION; it.type = IT.TITLE;   // the exe's string at 0x8a976c / 0x8a9778 is "<-------->" like the empty caption
           it.disable = 0x20; continue; }
        const h = c.slotHeader(i - 1);
        const id = h ? c.captionId(h.fsmState) : null;
        it.label = (id && c.msgs.label('!' + id)) || EMPTY_SLOT_CAPTION;
        it.type = e.page === NEWGAME_LIST ? IT.ACTION : IT.LIST;
        it.disable = 0;
      }
    }
    if (e.page === OPTIONS_GFX) { for (let i = 3; i < p.items.length; i++) if (p.items[i].type !== IT.BACK) p.items[i].disable = 0x20; } // the device / resolution entries: nothing to choose in a browser (the back item stays enabled like the original's)
    // ... except the resolution entry (action 14, item 4): it is the browser's "Beeld" choice, 4:3 (original) or widescreen; the page keeps its rows
    if (e.page === OPTIONS_GFX && c.display && p.items[GFX_DISPLAY_ITEM]?.value === GFX_DISPLAY_ACTION) {
      const it = p.items[GFX_DISPLAY_ITEM];
      it.label = c.display.wide() ? 'Beeld: breedbeeld' : 'Beeld: 4:3 (origineel)';
      it.type = IT.ACTION;   // the original's entry is "go to page 14" (the resolution list); here it is a switch
      it.disable = 0;
    }
    if (e.page === OPTIONS_SOUND) p.items[3].disable = c.options.a[S.SPEECH_ON] === 0 ? 0x20 : 0;
    if (e.page === PAUSE_ISLAND) {
      for (const it of p.items) if (it.label === '!LEVPPH') it.disable = c.storyNode() < 4 ? 0x20 : c.cutsceneRunning() ? 0x20 : 0;
    }
  }

  // ---- one tick ----------------------------------------------------------------------------------------------------------------------------
  /** run one engine tick; returns an MR code */
  step(pressed: number, pointer?: PointerState): number {
    const e = this.engine;
    if (!e.open) return 0;
    this.refreshPage();
    if (!this.ctx.cancelKeys && e.cur.kind === 1 && e.page === KEYS_PAGE && !this.keyBackup) this.keyBackup = Array.from({ length: 13 }, (_, i) => this.ctx.options.a[S.KEY_FIRST + i]);
    if (e.page === KEYS_PAGE && e.capture !== 0) this.pollCapture();
    const r = e.step(pressed, this.mask, pointer);
    return this.handle(r.ev, r.a, r.b);
  }

  /**
   * FUN_0041f966 + FUN_00438099: while a key is waited for, the keys are polled every tick. A key that may be bound (not the current key of any entry, not Esc / F10 / the Windows keys /
   * the grave accent key; the entry's own current key counts) is remembered while it is down; the entry is bound to it in the tick after it is let go (not when it goes down).
   */
  private pollCapture() {
    const e = this.engine, c = this.ctx;
    const idx = e.item / 10 - 1 + e.scroll;
    const own = idx >= 0 && idx < 13 ? (c.keyOf ? c.keyOf(idx) : c.options.a[S.KEY_FIRST + idx]) >>> 0 : 0;
    const k = c.captureKey(own);
    if (k !== 0) { this.capHeld = true; this.capCode = k; }
    else if (this.capHeld) { this.capHeld = false; e.feedKey(this.capCode); }
  }

  /** FUN_0041b500 (and the tail of FUN_0041be4e / FUN_0041bd3d) */
  private handle(ev: number, a: number, b: number): number {
    const e = this.engine, c = this.ctx, o = c.options;
    let res = 0;
    switch (ev) {
      case 2: {
        if (a === KEYS_PAGE) {
          // FUN_0041b500 case 2, page 0xd: OK saves the settings (FUN_0040410f, the options object does that at every change); anything else FUN_00437f6e: the live key table goes back (only it: the
          // Settings array keeps the keys that were bound, and the options page writes it to the file when it is left)
          if (b !== 1) { if (c.cancelKeys) c.cancelKeys(); else if (this.keyBackup) { this.keyBackup.forEach((v, i) => o.set(S.KEY_FIRST + i, v)); c.keysChanged(); } }
          else if (!c.cancelKeys) c.keysChanged();
          this.keyBackup = null;
        }
        if (a === -1 && e.stack.length === 0 && this.isPauseRoot()) res = MR.RESUME; // Esc at the root of a pause menu resumes
        break;
      }
      case 3: res = MR.QUIT; break;
      case 4: res = this.action(b); break;
      case 5: this.toggle(b); break;
      case 6: this.slider(b); break;
      case 8: {
        // key bound (FUN_00437e82): the key becomes this entry's current key at once (no other entry can have it: the capture skips those; the entry's fixed key stays live
        // again unless another entry's current key is the same, which InputMapper.makeBindings derives); leaving the page with "cancel" puts the old keys back (FUN_00437f6e)
        const idx = e.item / 10 - 1 + e.scroll;
        if (idx >= 0 && idx < 13) {
          o.set(S.KEY_FIRST + idx, b);        // Settings[idx + 4] = key (FUN_00437e82 writes it through FUN_004040ec)
          if (c.bindKey) c.bindKey(idx, b); else c.keysChanged();
          e.refreshList();
        }
        break;
      }
    }
    return res;
  }
  private isPauseRoot() { return this.pauseRoot; }
  /** set by the pause wrapper: the root page of this open */
  pauseRoot = false;

  private action(id: number): number {
    const c = this.ctx;
    let res: number = MR.RESUME;
    if (id === GFX_DISPLAY_ACTION && this.engine.page === OPTIONS_GFX && c.display) { c.display.toggle(); return MR.STAY; }
    if (this.engine.page === CHECKPOINT_PAGE && c.gotoCheckpoint) {
      // FUN_0041be4e, page 0x11: the chosen record's zone goes to var 5, its node (when >= 0) is jumped to; the front end then starts the game there
      const entry = c.checkpoints?.[this.engine.scroll + this.engine.item / 10 - 1];
      if (!entry) return MR.STAY;
      c.gotoCheckpoint(entry);
      return MR.ABANDON;
    }
    if (this.engine.page === ALLZONES_PAGE && c.gotoZone) {
      const entry = c.allZones?.[this.engine.scroll + this.engine.item / 10 - 1];
      if (!entry) return MR.STAY;
      c.gotoZone(entry);
      return MR.ABANDON;
    }
    if (id === 1) res = MR.ABANDON;
    if (id === 0x11) { c.vars.set(5, 3); c.vars.set(0xb, 0); }
    if (id === 0xf) res = MR.RESTART;
    if (id === 2) return MR.CREDITS;   // FUN_0041be4e: the front end turns action 2 into -4
    if (id > 2 && id < 10) {
      if (c.newGame()) res = MR.ABANDON;
    }
    if (id > 0x13 && id < 0x1b) {
      const r = c.loadSlot(id - 0x14);
      if (r === 0) res = MR.STAY; else if (r === 2) res = MR.ABANDON;
    }
    if (id > 0x1d && id < 0x25) { if (!c.saveSlot(id - 0x1e)) res = MR.STAY; }
    if (id > 0x27 && id < 0x2f) { c.eraseSlot(id - 0x28); res = MR.STAY; }
    if (res === MR.ABANDON) c.vars.set(0xb, 0);
    return res;
  }

  private toggle(value: number) {
    const e = this.engine, o = this.ctx.options;
    if (e.page === OPTIONS_GAME) {
      if (e.item === 1) o.setSpeechOn(value !== 0); else if (e.item === 2) o.setSubtitlesOn(value !== 0);
      // the options keep at least one of the two on: show the forced value
      this.pages[OPTIONS_GAME].items[1].value = o.a[S.SPEECH_ON];
      this.pages[OPTIONS_GAME].items[2].value = o.a[S.SUBTITLES_ON];
      o.applyToVars(this.ctx.vars);
      this.ctx.optionChanged(S.SPEECH_ON);
    } else if (e.page === OPTIONS_GFX && e.item === 2) { o.textureQuality = value; this.ctx.optionChanged(S.TEXTURE_QUALITY); }
    else if (e.page === OPTIONS_CTRL && e.item === 2) { o.gamepad = value !== 0; this.ctx.optionChanged(S.GAMEPAD); }
  }
  private slider(value: number) {
    const e = this.engine, o = this.ctx.options;
    if (e.page === OPTIONS_CTRL && e.item === 3) { o.sensitivity = value; this.ctx.optionChanged(S.SENSITIVITY); }
    else if (e.page === OPTIONS_GFX && e.item === 1) { o.drawDistance = value; this.ctx.optionChanged(S.DRAW_DISTANCE); }
    else if (e.page === OPTIONS_SOUND) {
      if (e.item === 1) { o.musicVolume = value; this.ctx.optionChanged(S.MUSIC_VOLUME); }
      else if (e.item === 2) { o.sfxVolume = value; this.ctx.optionChanged(S.SFX_VOLUME); }
      else if (e.item === 3) { o.speechVolume = value; this.ctx.optionChanged(S.SPEECH_VOLUME); }
    }
  }

  // ---- drawing -------------------------------------------------------------------------------------------------------------------------------
  draw(ui: Ui2D, set: UiTextureSet | null) {
    if (!this.engine.open) return;
    const c = this.ctx;
    const gfx: MenuGfx = {
      tile: (tex, x0, y0, x1, y1, argb) => ui.sprite(set, tex, [x0, y0, x1, y1], argb),
      textWidth: (font, s) => c.measure(font, s),
      text: (font, align, s, x, y, colour) => {
        // `y` is the top of the 24 px row text box of the original; the 2D layer wants the bottom of the line cell
        void y;
        ui.text(font === 0 ? 1 : 0, s, x, y, { colour, align: align === -1 ? 'left' : align === 0 ? 'centre' : 'right' });
      },
    };
    const msg = (id: string) => c.msgs.label('!' + id);
    const pg = this.engine.page;
    if (pg === LOAD_PAGE || pg === SAVE_PAGE || pg === ERASE_PAGE) ui.text(0, 'E = exporteren, I = importeren (.lgo)', 320, 476, { colour: 9, align: 'centre', shadow: false });
    drawMenu(this.engine, {
      gfx, rows: c.rows, mask: this.mask | 0x20,
      label: (it) => menuLabel(it.label, msg),
      onText: msg('FEON'), offText: msg('FEOFF'),
      keyName: (code) => c.msgs.label(keyCodeLabel(code, c.keyNames)),   // FUN_0043839f's label through the menu text resolver: `!UP` -> OMHOOG, `MOUSE2` as is
      headers: [msg('ACTION'), msg('SET') + ' 1', msg('SET') + ' 2'],
    });
  }
}

export { readRowTables };
