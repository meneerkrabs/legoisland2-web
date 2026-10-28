// z03PPH, Pepper's house (kind 3 room: pause page 29, mask 0x40): the trophy room (23 trophies), the computer menu (movies, sound test, replays of the
// mini-games), the hotspots / fixed cameras, the door. Ported in M3 (docs/re/m3/z03PPH.md): loop FUN_0053dfda, set-up FUN_0053ea4d, sounds FUN_0053e7c0, computer
// FUN_005400d5 / FUN_0053fbc0, hotspots FUN_0054042d, trophies FUN_0054116c / FUN_005413c4 / FUN_005414b0, map FUN_00541f94. Importing this module registers the zone
// game (registerZoneGame) and the behaviour constructors (registerCtor) of the house; src/zones/index.ts imports it.
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { registerCtor } from '../game/setup.ts';
import { EXIT } from '../shell/loopmachine.ts';
import { readLevelSelect } from '../shell/tables.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { FACTORIES, houseOf, swapInDisplayCamera, restoreCamera, KEEP_STALE_SCORE_LINE, TROPHY_SOUND, SOUND_NO_TROPHY, SOUND_NO_INDEX, MODE, PEPPER_CONTROL } from './z03PPH/house.ts';
import type { HouseState } from './z03PPH/house.ts';
import { ComputerMenu, COMPUTER_MASK, enterZone } from './z03PPH/computer.ts';
import { computeIslandTotals } from './z03PPH/totals.ts';

for (const [addr, f] of Object.entries(FACTORIES)) registerCtor(+addr, f);

/** the HUD subtitle slots (DrawHUD.c FUN_00460003): lines at y = 494 / 518 / 542 / 566 of the 800x600 grid, centred at x = 400; the 640x480 grid is 0.8 of it */
const LINE_Y = [494, 518, 542].map((y) => y * 0.8);
const LINE_X = 400 * 0.8;

class PepperHouse implements ZoneGame {
  readonly ctx: ZoneGameCtx;
  readonly st: HouseState;
  readonly computer: ComputerMenu;
  /** a movie of the computer is playing (the original blocks inside the menu step) */
  movie = false;
  private offKey: () => void;
  private oldMask = 0;

  constructor(ctx: ZoneGameCtx) {
    this.ctx = ctx;
    this.st = houseOf(ctx.world);
    // SetupFog is called three times (loop start: near 4; the set-up: near 5; the loop after the set-up: near 1, far 100..500, fog fraction 10): the last one is in effect
    ctx.gr.useFogCall(1);
    // FUN_00423bf0: the island totals / island trophies from the per-game high scores (run by the house loop before the first frame)
    computeIslandTotals(ctx.vars);
    // FUN_0053e7c0: the trophy jingles are loaded up front (the first play of an id only loads it)
    for (const id of [...TROPHY_SOUND, SOUND_NO_TROPHY, SOUND_NO_INDEX]) ctx.sfx(id);
    const sh = ctx.sh;
    this.oldMask = sh.menu.mask;
    this.computer = new ComputerMenu(sh.menu.engine, {
      vars: ctx.vars,
      levels: readLevelSelect(sh.pe),
      movie: (n) => this.playMovie(n),
      music: (key) => this.playMusic(key),
    });
    this.computer.attach();
    this.st.computer = this.computer;
    // dev aid kept from the M2 stub (tools/steps/shell-house.mjs): F9 leaves through the door
    const onKey = (e: KeyboardEvent) => { if (e.code === 'F9' && !this.computer.active) { this.st.leave = true; e.preventDefault(); } };
    addEventListener('keydown', onKey);
    this.offKey = () => removeEventListener('keydown', onKey);
  }

  config = { intro: false, help: false };

  /** FUN_0053fed3(1) in mode 0: after a replay the computer opens again at the replay list */
  onStart() {
    if (enterZone(this.ctx.vars)) this.computer.reset();
  }

  update(): number | undefined {
    const { st, ctx } = this, w = ctx.world, sh = ctx.sh;
    // FUN_0053df81 samples the pause key at the top of the frame, before the menu of this frame ran: the state of the previous frame counts
    this.pauseBlock = this.computer.active || this.movie;
    if (this.movie) return undefined;
    if (st.computerRan) {
      // the draw hook of PeppComp (FUN_0054003e -> FUN_0053fbc0): one step of the computer menu per frame
      st.computerRan = false;
      sh.menu.mask = COMPUTER_MASK;
      if (this.computer.step(sh.input.pressed, sh.pointer)) { w.vars.set(PEPPER_CONTROL, MODE.WALK); }
    }
    // the HUD: the hotspot icon in the bottom-left slot of the icon column (the HUD is not drawn while the computer menu is up)
    ctx.hud.visible = !this.computer.active;
    ctx.hud.column = st.icon >= 0 ? [{ tex: st.icon, tint: 0xffffffff }] : [];
    return undefined;
  }

  /** the door / walking out of the house (DAT_05d587b0): leave through the fade-out as a finished room (exit state 2) */
  leaveRequest(): number | undefined {
    if (this.st.leave && !this.computer.active) { this.st.leave = false; return EXIT.FINISHED; }
    return undefined;
  }

  /** FUN_0053df81: the loop does not sample the pause key while the computer menu is active (the menu handles Esc itself); nor while a movie plays */
  blockPause(): boolean { return this.pauseBlock; }
  private pauseBlock = false;

  beforeRender() { swapInDisplayCamera(this.ctx.world); }

  /** FUN_0053dfda's exit block: when the house was not started from the menu (var 0xb == 0) the exit goes through FUN_00404d14 (back to the zone the player came from); a replay (var 5) goes to its zone */
  exitNext(exit: number): number | undefined {
    const sh = this.ctx.sh;
    if (exit === EXIT.QUIT || exit === EXIT.RESTART) return undefined;
    if (sh.vars.get(0xb) === 0) return sh.story.miniGameExit(exit === EXIT.FINISHED || exit === EXIT.ABANDON, true);
    if (exit === EXIT.VAR5) return sh.vars.get(5);
    return undefined;
  }

  draw2d(ui: Ui2D) {
    const { st, ctx } = this, sh = ctx.sh;
    if (this.computer.active && sh.menu.engine.open) { sh.menu.draw(ui, sh.menuSet); return; }
    // the HUD text slots of the trophy browser (message ids resolved against the IFC table first, then FRONTEND: FUN_005414b0)
    const l = st.lines;
    const keepScore = KEEP_STALE_SCORE_LINE || ctx.vars.get(PEPPER_CONTROL) === MODE.TROPHIES;
    const fe = sh.msgs.tables[0], ifc = sh.msgs.tables[2];
    const name = (id: string) => { const t = ifc.text(id); return t !== id ? t : fe.text(id); };
    if (l.line1) ui.text(1, fe.text(l.line1), LINE_X, LINE_Y[0], { colour: 1, align: 'centre' });
    if (l.line2 && keepScore) ui.text(1, l.line2, LINE_X, LINE_Y[1], { colour: 1, align: 'centre' });
    if (l.line3) ui.text(1, name(l.line3), LINE_X, LINE_Y[2], { colour: 1, align: 'centre' });
  }

  destroy() {
    restoreCamera(this.ctx.world);
    this.computer.detach();
    this.st.computer = null;
    this.offKey();
    this.ctx.sh.menu.mask = this.oldMask;
    if (this.computer.active) this.ctx.sh.menu.close();
  }

  debug() {
    const { st } = this;
    return { mode: this.ctx.vars.get(PEPPER_CONTROL), icon: st.icon, hotspot: st.lastHotspot, leave: st.leave, doorOpen: st.doorOpen, trophy: st.trophyIndex, lines: { ...st.lines },
      camIdx: st.camIdx, computer: { active: this.computer.active, page: this.ctx.sh.menu.engine.page, item: this.ctx.sh.menu.engine.item, scroll: this.ctx.sh.menu.engine.scroll, last: this.computer.lastAction },
      sounds: st.sounds.slice(-5), movie: this.movie };
  }

  // ---- host services of the computer
  /** FUN_0041b9b1 page 0x16: IntroFMV / OutroFMV; afterwards the menu music starts again (FUN_00443290("menu")) */
  private playMovie(which: 1 | 2) {
    const sh = this.ctx.sh;
    this.movie = true;
    void sh.runMovie(which === 1 ? 'IntroFmv' : 'outroFmv').finally(() => { this.movie = false; this.playMusic('menu'); });
  }
  /** FUN_0041b9b1 page 0x17: stop the music, load the segment of the key and play it */
  private playMusic(key: string) {
    const ga = this.ctx.sh.audio.ga;
    if (!ga) return;
    try { ga.music.stopAll(); void ga.music.load(key).then((h) => { if (h) ga.music.play(h); }).catch(() => { /* silent */ }); } catch { /* silent */ }
  }
}

registerZoneGame('z03PPH', (ctx) => new PepperHouse(ctx));

