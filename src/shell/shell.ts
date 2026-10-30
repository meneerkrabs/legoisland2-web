// The game shell (docs/re/architecture.md sections 1.1, 2.1): the top-level flow of the original. Start-up movies, then the zone loop
// (FUN_00404dc9): a zone run function returns the next zone-table index (-1 = front end, <= -2 = quit); the story FSM and the global game variables
// live here and survive from zone to zone. Zones are run by `ZoneRunner`s: the front end (frontend.ts), the playable stub every other zone gets
// (playzone.ts) and, from M3 on, ported mini-games / hubs that register themselves with `registerZoneRunner`.
// One canvas (4:3, WebGL2) is shared by the 3D scene (src/render, src/game) and the 2D layer (src/ui); the menu, pause menu, HUD and fades are drawn on top.
import { Pe } from '../formats/exe.ts';
import { Renderer } from '../render/index.ts';
import { GameData } from '../viewer/data.ts';
import type { GameFiles } from '../files.ts';
import { INTRO_MOVIES } from '../files.ts';
import { audio } from '../engine/audio.ts';
import { canvasBox, currentDisplayMode, storeDisplayMode } from '../display.ts';
import type { DisplayMode } from '../display.ts';
import { playMovie } from '../engine/movie.ts';
import { installCheats, VAR_SDREAMS } from './cheats.ts';
import { installScreenshot } from './screenshot.ts';
import { GameVars, V } from '../game/vars.ts';
import { InputMapper, readKeyTable } from '../game/input.ts';
import { Ui2D } from '../ui/renderer2d.ts';
import type { UiTextureSet } from '../ui/renderer2d.ts';
import { loadMenuStrings, loadMessages, STD_FILES } from '../ui/strings.ts';
import type { MenuStrings, MessageTable } from '../ui/strings.ts';
import { readFsmCaptions, readInitialVars, readLevelSelect, readMenuPages, readStoryFsm, readZoneTable } from './tables.ts';
import type { ZoneInfo, StoryNode, MenuPage as RawMenuPage } from './tables.ts';
import { GV, StoryFsm, ZoneLoopState } from './story.ts';
import { Options, S } from './options.ts';
import { IdbBackend, SaveStore } from './savestore.ts';
import type { SaveHeader, SaveGame, NewSaveOptions } from './save.ts';
import { decodeSave, readSaveHeader, slotFileName, newSaveFromGame, applySaveVars, SAVE_SIZE, encodeSave, SLOT_DEFAULT } from './save.ts';
import { captureWorld } from './saveworld.ts';
import type { World } from '../game/world.ts';
import { AudioHost } from './audiohost.ts';
import { resetDecor, decorStore } from '../island/decor.ts';
import { stopLoading } from './loading.ts';
import { MenuUi, MR } from './menuui.ts';
import type { MenuContext } from './menuui.ts';
import { readRowTables } from './menudraw.ts';
import { localiseKeyNames, readKeyNames } from './dik.ts';
import type { PointerState } from './menu.ts';

export type ZoneRunner = (shell: Shell, zone: ZoneInfo) => Promise<number>;
const runners = new Map<string, ZoneRunner>();
/** register the run function of a zone (by its internal id such as 'z05WAB', or the archive name): M3+ mini-games replace the stub this way */
export function registerZoneRunner(id: string, fn: ZoneRunner) { runners.set(id.toLowerCase(), fn); }

/** the live game a save can snapshot (set by the running zone) */
export interface LiveGame {
  /** the world sections of FUN_00418ec7 (walkers, camera, frame counter, object / entity records, decor, bricks; src/shell/saveworld.ts `captureWorld`); null = nothing to save */
  capture(): Partial<NewSaveOptions> | null;
  /** apply a loaded save in place (FUN_00419e82) */
  restore(save: SaveGame): void;
  cutsceneRunning(): boolean;
}

export interface ShellParams {
  mute: boolean;
  /** skip the start-up movies */
  intro: boolean;
  /** begin directly in this zone (archive name or internal id) instead of the front end */
  zone?: string;
  /** story node to start at (with `zone`) */
  node?: number;
  /** load this save slot at start */
  save?: number;
  start?: string;
}

export class Shell {
  readonly root: HTMLElement;
  readonly files: GameFiles;
  readonly data: GameData;
  readonly pe: Pe;
  readonly params: ShellParams;
  readonly zones: ZoneInfo[];
  readonly nodes: StoryNode[];
  readonly rawPages: RawMenuPage[];
  readonly captions: string[];
  readonly vars = new GameVars();
  readonly story: StoryFsm;
  readonly loop: ZoneLoopState;
  readonly options: Options;
  readonly saves: SaveStore;
  /** the 7 save files in memory (menus read them synchronously; writes go to IndexedDB in the background) */
  readonly slots: (Uint8Array | null)[] = new Array(7).fill(null);
  audio!: AudioHost;
  readonly wrap: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly gl: Renderer;
  readonly ui: Ui2D;
  menuSet: UiTextureSet | null = null;
  msgs!: MenuStrings;
  /** STD.str: the medal texts SGGOLD / SGSILVER / SGBRONZE of the end banner (FUN_00404dc9 loads it at start) */
  std!: MessageTable;
  readonly input: InputMapper;
  readonly keyNames: Map<number, string>;
  readonly keyBits: number[];
  readonly pointer: PointerState = { x: -100, y: -100, down: false, moved: false };
  menu!: MenuUi;
  live: LiveGame | null = null;
  /** a loaded save waiting for the zone it belongs to (applied by `applyPendingLoad` after that zone's set-up) */
  pendingSave: SaveGame | null = null;
  /** set when the player chose "Stoppen" */
  quit = false;
  /** "Beeld": 4:3 (original) or widescreen (src/display.ts): the canvas fills the window, the 3D scene uses its aspect, the 2D layer stays a 4:3 area */
  displayMode: DisplayMode = currentDisplayMode();
  /** how often each zone (table index) was started in this session: `ZoneGameCtx.attempt` */
  readonly zoneAttempts = new Map<number, number>();
  private keyTable: { dik: number; bit: number }[];
  private styleEl: HTMLStyleElement;

  private constructor(root: HTMLElement, files: GameFiles, params: ShellParams, data: GameData, pe: Pe, canvas: HTMLCanvasElement, wrap: HTMLDivElement, gl: Renderer, ui: Ui2D) {
    this.root = root; this.files = files; this.params = params; this.data = data; this.pe = pe;
    decorStore.startProcess(pe);   // the stored decor of a process without a game yet: the defaults, not zeros (src/island/decor.ts)
    this.canvas = canvas; this.wrap = wrap; this.gl = gl; this.ui = ui;
    this.zones = readZoneTable(pe);
    this.nodes = readStoryFsm(pe);
    this.rawPages = readMenuPages(pe);
    this.captions = readFsmCaptions(pe);
    this.vars.loadNames(pe);
    this.vars.a.set(readInitialVars(pe));
    this.story = new StoryFsm(this.vars, this.nodes, this.zones);
    this.loop = new ZoneLoopState(this.story);
    this.options = Options.fromExe(pe);
    this.saves = new SaveStore(new IdbBackend());
    this.keyNames = readKeyNames(pe);
    this.keyTable = readKeyTable(pe);
    this.keyBits = this.keyTable.map((k) => k.bit);
    this.input = new InputMapper(this.keyTable);
    this.styleEl = document.createElement('style');
  }

  static async create(root: HTMLElement, files: GameFiles, params: ShellParams, status?: (m: string) => void): Promise<Shell> {
    const data = new GameData(files);
    status?.('Spel lezen…');
    const pe = await data.exe();
    root.replaceChildren();
    const wrap = document.createElement('div');
    wrap.className = 'sh-root';
    const canvas = document.createElement('canvas');
    canvas.className = 'sh-canvas';
    wrap.appendChild(canvas);
    root.appendChild(wrap);
    const gl = new Renderer(canvas);
    const ui = new Ui2D(gl.gl, { fit: 'stretch' });
    const sh = new Shell(root, files, params, data, pe, canvas, wrap, gl, ui);
    ui.fit = sh.displayMode === 'wide' ? 'fit' : 'stretch';
    sh.installStyle();
    sh.fitCanvas();
    addEventListener('resize', () => sh.fitCanvas());
    status?.('Teksten en lettertypen laden…');
    const [fonts, menu, messages] = await Promise.all([data.archive('Fonts'), data.archive('menu'), data.archive('messages')]);
    ui.loadFonts(fonts);
    sh.menuSet = ui.loadSet(menu, 'mOverlays');
    sh.msgs = loadMenuStrings(messages);
    // the loading card of the fade overlay (FUN_0040d1be): Pizza.tga / CD.tga of GENERICBITS and the text LOADING (FRONTEND.str)
    try {
      const gb = await data.archive('GENERICBITS');
      const pizza = ui.loadImage(gb, 'Backdrop/Pizza.tga').get(0), cd = ui.loadImage(gb, 'Backdrop/CD.tga').get(0);
      if (pizza && cd) ui.card = { pizza, cd, text: sh.msgs.label('!LOADING') };
    } catch (e) { console.warn('loading card', e); }
    localiseKeyNames(sh.pe, sh.keyNames, sh.msgs.label('!FEERASE'));   // FUN_00438212: the layout dependent key names of the game's language
    sh.std = loadMessages(messages, STD_FILES);
    status?.('Geluid laden…');
    sh.audio = await AudioHost.create(files, params.mute);
    // options and saves
    status?.('Opties en opgeslagen spellen laden…');
    await sh.saves.loadOptions(sh.options).catch(() => false);
    sh.saves.autosaveOptions(sh.options);
    sh.applyOptions();
    sh.options.onChange((i) => sh.optionChanged(i));
    await sh.refreshSlots();
    status?.('Start…');
    sh.input.attach(window);
    installCheats(sh.pe, sh.input, { sdreams: () => sh.vars.set(VAR_SDREAMS, 1), fsmAdvance: () => sh.story.jump(sh.vars.get(0x58) + 1) });   // the typed cheat codes (FUN_004375a8), polled with the input
    installScreenshot(sh.input, sh.canvas);   // F10
    sh.attachPointer();
    sh.menu = new MenuUi(sh.menuContext(), sh.rawPages);
    return sh;
  }

  // ---------------------------------------------------------------------------------------------------------------------- display

  private installStyle() {
    this.styleEl.textContent = `
.sh-root{position:fixed;inset:0;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
.sh-canvas{display:block;background:#000;touch-action:none}
.sh-note{position:absolute;left:8px;top:8px;color:#ddd;font:12px/1.3 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.5);padding:4px 7px;border-radius:5px;pointer-events:none;white-space:pre}
`;
    document.head.appendChild(this.styleEl);
  }

  /** the canvas is the largest 4:3 box that fits the window (the original only knows 4:3 modes) or, in widescreen, the whole window */
  fitCanvas() {
    const { w, h } = canvasBox(this.displayMode, innerWidth, innerHeight);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }
  /** switch between 4:3 and widescreen while running (the 3D scene follows at the next frame, the 2D area is re-centred by `Ui2D.begin`) */
  setDisplayMode(mode: DisplayMode) {
    this.displayMode = mode;
    this.ui.fit = mode === 'wide' ? 'fit' : 'stretch';
    this.fitCanvas();
  }

  private attachPointer() {
    const c = this.canvas;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect(), v = this.ui.view;
      // client px -> canvas px -> the 4:3 area of the 2D layer (the whole canvas in 4:3 mode) -> the 640x480 grid
      const cx = ((e.clientX - r.left) / r.width) * c.width, cy = ((e.clientY - r.top) / r.height) * c.height;
      this.pointer.x = ((cx - v.x) / v.w) * 640;
      this.pointer.y = ((cy - v.y) / v.h) * 480;
      this.pointer.moved = true;
    };
    c.addEventListener('pointermove', at);
    c.addEventListener('pointerdown', (e) => { at(e); this.pointer.down = true; void audio.unlock().catch(() => { /* ignore */ }); });
    addEventListener('pointerup', () => { this.pointer.down = false; });
    addEventListener('keydown', () => { void audio.unlock().catch(() => { /* ignore */ }); });
  }

  // ---------------------------------------------------------------------------------------------------------------------- options

  /** push the options to the parts that use them (volumes, key bindings, vars 0 / 9) */
  applyOptions() {
    const o = this.options;
    this.audio?.setVolumes(o.musicVolume, o.sfxVolume, o.speechVolume);
    this.options.applyToVars(this.vars);
    this.applyKeys();
    this.input.gamepad = o.gamepad;
    this.input.sensitivity = o.sensitivity;
  }
  applyKeys() {
    this.input.rebind(this.keyTable.map((k, i) => { const b = this.options.binding(i); return { device: b.device, dik: b.dik, bit: k.bit }; }));
  }
  optionChanged(i: number) {
    const o = this.options;
    if (i === S.MUSIC_VOLUME || i === S.SFX_VOLUME || i === S.SPEECH_VOLUME) this.audio.setVolumes(o.musicVolume, o.sfxVolume, o.speechVolume);
    if (i === S.GAMEPAD) this.input.gamepad = o.gamepad;
    if (i === S.SENSITIVITY) this.input.sensitivity = o.sensitivity;
    this.options.applyToVars(this.vars);
    for (const l of this.optionListeners) l(i);
  }
  private optionListeners = new Set<(i: number) => void>();
  onOption(fn: (i: number) => void): () => void { this.optionListeners.add(fn); return () => { this.optionListeners.delete(fn); }; }

  // ---------------------------------------------------------------------------------------------------------------------- saves

  async refreshSlots() {
    for (let i = 0; i < 7; i++) {
      try { this.slots[i] = await this.saves.backend.get(slotFileName(i)); } catch { this.slots[i] = null; }
    }
  }
  slotHeader(slot: number): SaveHeader | null {
    const b = this.slots[slot];
    return b ? readSaveHeader(b) : null;
  }
  /** FUN_00418ec7: write the live game into a slot; false = nothing to save (front end) */
  saveSlot(slot: number): boolean {
    const live = this.live?.capture();
    if (!live) return false;
    const save = newSaveFromGame({ ...live, vars: this.vars.a, subgame: this.vars.get(0x59), fsmState: this.vars.get(0x58) });
    let bytes: Uint8Array;
    try { bytes = encodeSave(save); } catch (e) { console.warn('save failed', e); return false; }   // the original's writer returns 0 when the buffer would overflow
    this.slots[slot] = bytes;
    this.saves.backend.put(slotFileName(slot), bytes).catch((e) => console.warn('save failed', e));
    return true;
  }
  /**
   * FUN_0041ad71 -> FUN_00418ec7(0xfffffffe): the file `SaveDef.lgo`, written by the front end's loop at its start from the live state of the front end's world (the stage's nodes and records, the
   * variables, the camera ...). Nothing reads it back (FUN_00419bb9 only gets the slots 0 .. 6). A failure never reaches the front end.
   */
  writeDefaultSave(world: World): boolean {
    try {
      const save = newSaveFromGame({ ...captureWorld(world), vars: this.vars.a, subgame: this.vars.get(0x59), fsmState: this.vars.get(0x58) });
      this.saves.backend.put(slotFileName(SLOT_DEFAULT), encodeSave(save)).catch((e) => console.warn('SaveDef.lgo not written', e));
      return true;
    } catch (e) { console.warn('SaveDef.lgo not written', e); return false; }   // (the original's writer returns 0 when the buffer would overflow)
  }
  /** FUN_00419bb9 */
  loadSlot(slot: number): 0 | 1 | 2 {
    const b = this.slots[slot];
    if (!b) return 0;
    let save: SaveGame;
    try { save = decodeSave(b); } catch (e) { console.warn('bad save', e); return 0; }
    const r = this.loop.beginLoad(save.subgame, save.fsmState);
    this.pendingSave = save;
    if (r === 1 && this.live) {
      this.loop.loadDone();
      this.applySave(save);
      return 1;
    }
    return 2;
  }
  eraseSlot(slot: number) {
    this.slots[slot] = null;
    this.saves.backend.delete(slotFileName(slot)).catch(() => { /* ignore */ });
  }
  /** vars + the live game */
  private applySave(save: SaveGame) {
    const keep5 = this.vars.get(5);
    applySaveVars(save, this.vars);
    this.vars.set(5, keep5);
    this.options.applyToVars(this.vars);
    this.live?.restore(save);
    this.pendingSave = null;
  }
  /** called by a zone's set-up (FUN_0041adb5): applies a loaded save that was waiting for this zone */
  applyPendingLoad() {
    if (this.loop.loadDone() === 1 && this.pendingSave) {
      const save = this.pendingSave;
      this.pendingSave = null;
      const keep5 = this.vars.get(5);
      applySaveVars(save, this.vars);
      this.vars.set(5, keep5);
      this.options.applyToVars(this.vars);
      return save;
    }
    return null;
  }
  /** the Save-slot import / export of the options screen (browser side): `.lgo` bytes <-> slot */
  async importSlot(slot: number, bytes: Uint8Array): Promise<string[]> { const w = await this.saves.importLgo(slot, bytes); await this.refreshSlots(); return w; }
  exportSlot(slot: number): Uint8Array | null { const b = this.slots[slot]; return b ? b.slice(0, SAVE_SIZE) : null; }

  // ---------------------------------------------------------------------------------------------------------------------- menus

  private menuContext(): MenuContext {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sh = this;
    return {
      options: this.options, vars: this.vars, get msgs() { return sh.msgs; }, keyNames: this.keyNames, keyBits: this.keyBits, rows: readRowTables(this.pe),
      sound: (k) => this.audio.menu(k),
      slotHeader: (s) => this.slotHeader(s),
      captionId: (n) => this.captions[n] ?? null,
      storyNode: () => this.vars.get(0x58),
      cutsceneRunning: () => this.live?.cutsceneRunning() ?? false,
      saveSlot: (s) => this.saveSlot(s),
      loadSlot: (s) => this.loadSlot(s),
      eraseSlot: (s) => this.eraseSlot(s),
      newGame: () => { resetDecor(null, this.pe); this.loop.newGame(); return true; },   // FUN_0041a8f9: FUN_00421fa0(1) (the stored decor back to the defaults) + the new game's defaults
      keysChanged: () => this.applyKeys(),
      captureKey: (own) => this.input.captureKey(own),
      optionChanged: (i) => this.optionChanged(i),
      measure: (font, s) => this.ui.measure(font === 0 ? 1 : 0, s).w,
      checkpoints: readLevelSelect(this.pe).checkpoints,
      allZones: readLevelSelect(this.pe).allZones,
      gotoZone: (e) => {   // page 26 (debug mode: reached through src/devcorner): var 5 = zone, var 0xb = 1 (FUN_0041be4e branch 0x1a)
        this.vars.set(V.NS_NEXT_SUBGAME, e.zone);
        this.vars.set(GV.STARTEDFROMMENU, 1);
        this.loop.pending = { kind: 2, node: this.story.node, zone: e.zone };
      },
      gotoCheckpoint: (e) => {
        if (e.node >= 0) { this.story.jump(e.node); this.vars.set(GV.LGI_GAMELOOP, 3); }
        this.vars.set(V.NS_NEXT_SUBGAME, e.zone);
        this.vars.set(GV.STARTEDFROMMENU, 0);
        this.loop.pending = { kind: 2, node: this.story.node, zone: e.zone };   // the front end hands over to this zone / node (like a new game does)
      },
      display: { wide: () => this.displayMode === 'wide', toggle: () => { const m = this.displayMode === 'wide' ? '4:3' : 'wide'; this.setDisplayMode(m); storeDisplayMode(m); this.audio.menu('onoff'); } },
    };
  }

  /** while a key-binding capture waits (FUN_00438099, polled by MenuUi through the input mapper) the keys are the capture's: no browser action (F5, Tab ...) */
  private keyCapture = (e: KeyboardEvent) => {
    if (!this.menu?.engine.capture) return;
    if (e.code === 'Escape') return;
    e.preventDefault();
  };
  /** E / I on the load, save and erase pages: export / import the highlighted slot as an original `.lgo` file */
  private slotKeys = (e: KeyboardEvent) => {
    const en = this.menu?.engine;
    if (!en?.open || (en.page !== 2 && en.page !== 3 && en.page !== 8) || e.repeat) return;
    const slot = en.item - 1;
    if (slot < 0 || slot > 6) return;
    if (e.code === 'KeyE') {
      const b = this.exportSlot(slot);
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([b as BlobPart], { type: 'application/octet-stream' }));
      a.download = slotFileName(slot);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } else if (e.code === 'KeyI') {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.lgo';
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        try { const w = await this.importSlot(slot, new Uint8Array(await f.arrayBuffer())); if (w.length) alert(`Let op: ${w.join(' ')} Het spel wordt toch geladen, zoals het origineel dat doet.`); } catch (err) { console.warn('import failed', err); alert(`Dit is geen geldig bewaard spel: ${err instanceof Error ? err.message : err}`); }
      };
      inp.click();
    }
  };
  attachMenuKeys() { addEventListener('keydown', this.keyCapture, true); addEventListener('keydown', this.slotKeys); }
  detachMenuKeys() { removeEventListener('keydown', this.keyCapture, true); removeEventListener('keydown', this.slotKeys); }

  // ---------------------------------------------------------------------------------------------------------------------- movies

  async runMovie(name: string): Promise<void> {
    const media = await this.files.movie(name);
    if (!media) { console.warn(`film ${name} niet gevonden`); return; }
    this.canvas.style.visibility = 'hidden';
    this.audio.ga?.music.stopAll();
    try { await playMovie(this.root, media, name, Number(new URLSearchParams(location.search).get('throttle') ?? 0)); }
    catch (e) { console.warn('movie', e); }
    finally { this.canvas.style.visibility = ''; }
  }
  async runIntro() { for (const name of INTRO_MOVIES) await this.runMovie(name); }

  // ---------------------------------------------------------------------------------------------------------------------- the zone loop

  zoneByName(name: string): ZoneInfo | undefined {
    const n = name.toLowerCase();
    return this.zones.find((z) => z.id.toLowerCase() === n || (z.archive ?? '').toLowerCase() === n);
  }

  /** FUN_00404dc9: run zones until one returns <= -2 */
  async run(): Promise<void> {
    if (this.params.zone) {
      const z = this.zoneByName(this.params.zone);
      if (z) {
        if (this.params.node !== undefined) this.story.jump(this.params.node);
        else {
          // the first story node that is in this zone
          const n = this.nodes.findIndex((nd) => nd.zone === z.index);
          if (n >= 0) this.story.jump(n);
        }
      }
    }
    let zone = this.loop.begin();
    if (this.params.save !== undefined && this.slots[this.params.save]) {
      const r = this.loadSlot(this.params.save);
      if (r === 2) zone = this.loop.afterZone(-1);
    }
    while (zone >= 0 && !this.quit) {
      const info = this.zones[zone];
      this.audio.leaveZone();
      const runner = runners.get(info.id.toLowerCase()) ?? runners.get((info.archive ?? '').toLowerCase()) ?? (zone === 0 ? runners.get('frontend') : undefined) ?? runners.get('default');
      if (!runner) throw new Error(`no runner for zone ${info.id}`);
      let next: number;
      try { next = await runner(this, info); } finally { stopLoading(); }
      this.live = null;
      this.gl.clearCaches();      // the zone's meshes and textures (the shared renderer would keep them for the whole session)
      await this.data.releaseZoneOverrides();   // the zone's mod files (src/mods) are let go of; they are read again when the zone is entered again
      zone = this.loop.afterZone(next);
    }
    this.audio.leaveZone();
  }

  // ---------------------------------------------------------------------------------------------------------------------- frame loop

  /** a fixed 30 Hz loop: `tick()` returns true to end, `render(alpha, dtSeconds)` draws a frame */
  runLoop(tick: () => boolean, render: (alpha: number, dt: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const STEP = 1000 / 30;
      let last = performance.now(), acc = 0, done = false;
      const frame = (now: number) => {
        if (done) return;
        acc += Math.min(1000, now - last);
        const dt = (now - last) / 1000;
        last = now;
        let n = 0;
        while (acc >= STEP && n < 5 && !done) { if (tick()) done = true; acc -= STEP; n++; }
        if (n === 5) acc = 0;
        render(Math.min(1, acc / STEP), dt);
        if (done) { resolve(); return; }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }
}

export { MR };
