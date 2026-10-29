// z04IFC: the Information Centre (docs/re/m3/z04IFC.md). A room without walking: Pepper stands at the information desk, the camera flies in and shows the wall map of the
// island with 17 pins (one per location); Left / Right move the selected pin, Enter opens the menu with the location's page and the people living there, a character
// page shows the 3D figure and its text (FUN_0041cbac); Down / Left at the far view asks whether to leave (mode 5, page 15).
// Registers the four behaviours of the room by constructor address (the node ports) and the zone game (menu drawing, record visibility, exit mapping).
import { registerCtor } from '../game/setup.ts';
import { NODE_CONTINUE, NODE_NONE, updatePass, prerenderPass } from '../game/controller.ts';
import type { BehaviourNode } from '../game/controller.ts';
import type { GameRecord } from '../game/record.ts';
import { RF_ENABLED } from '../game/record.ts';
import type { World } from '../game/world.ts';
import { AnimInstance } from '../game/anim.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { ZoneGame, ZoneGameCtx } from '../shell/zonegame.ts';
import { EXIT, MODE } from '../shell/loopmachine.ts';
import { B } from '../game/input.ts';
import { drawMenu, menuLabel, readRowTables } from '../shell/menudraw.ts';
import type { MenuGfx } from '../shell/menudraw.ts';
import { keyCodeName } from '../shell/dik.ts';
import type { Ui2D } from '../ui/renderer2d.ts';
import { CAPTION, CHAR_PAGE0, DOOR, EXIT_PAGE, IfcRoom, MODEL_OFFSET, PEPPER_PLACE, CLIP } from './z04IFC/ifc.ts';
import type { IfcHost } from './z04IFC/ifc.ts';
import { readIfcPages, labelId } from './z04IFC/pages.ts';
import { drawDialog } from './z04IFC/dialog.ts';
import { gameRandom } from './common/tickrand.ts';
import { euler24 } from './common/x87.ts';

/** constructor addresses of the room's four behaviours (the `Map.c` functions the set-up code attaches: FUN_0054ce86) */
export const IFC_CTOR = { CONTROLLER: 0x54c4a7, PIN: 0x54bc04, CHARACTER: 0x54c9f7, DOOR: 0x54ccae } as const;
/** record layout of the zone (FUN_0054e760): 0 LAND, 1..29 the characters (7 = PEPP), 30 DOOR, 31 G000, 32..48 the PONT pins, 49.. G001..G005; the pin first selected is record 47 (page 3) */
export const IFC_RECORDS = { LAND: 0, FIRST_CHAR: 1, LAST_CHAR: 29, PEPPER: 7, DOOR: 30, FIRST_PIN: 32, LAST_PIN: 48, START_PIN: 47 } as const;
const GV_SELECTED_PIN = 0xfa;

/** the link between the nodes (made when the set-up attaches the controller) and the zone game (which owns the room) */
interface Link { room: IfcRoom | null; pagesOfPin: Map<number, number> }
let link: Link = { room: null, pagesOfPin: new Map() };
/** the tick in which Esc opens the pause menu: the original's loop top (FUN_00549911 -> FUN_00423170) switches to mode 3 BEFORE the update pass, so that iteration runs no update and no pre-render */
const escTick = { on: false };

class ControllerNode implements BehaviourNode {
  readonly kind = 'IfcMap';
  var = 0; mask = 0; value = 0; stamp = 0xfffffffe;
  private l: Link;
  constructor(l: Link) { this.l = l; }
  /** FUN_0054bce3 */
  update(w: World, rec: GameRecord): number {
    const room = this.l.room;
    if (!room || escTick.on) return NODE_NONE;
    const r = room.update(w.input.pressed);
    if (r.placePepper) {
      rec.flags |= RF_ENABLED;
      rec.m.set(euler24(0, PEPPER_PLACE.yaw, 0, PEPPER_PLACE.x, PEPPER_PLACE.y, PEPPER_PLACE.z));   // FUN_0043a5e4, 24-bit x87
    }
    return NODE_CONTINUE;
  }
  /** FUN_0054c00d: the camera of the tick and Pepper's animation clock */
  prerender(w: World, rec: GameRecord) {
    const room = this.l.room;
    if (!room) return;
    room.camera();
    const c = w.camera.c;
    for (let i = 0; i < 3; i++) { c[i] = room.eye[i]; c[3 + i] = room.target[i]; }
    w.camera.updateView();
    rec.anim?.advance(1);
  }
}

class PinNode implements BehaviourNode {
  readonly kind = 'IfcPin';
  var = 0; mask = 0; value = 0; stamp = 0xfffffffe;
  /** +0x18: the location page of the info menu */
  readonly page: number;
  private l: Link;
  constructor(l: Link, page: number) { this.l = l; this.page = page; }
  /** FUN_0054b982 */
  update(w: World, rec: GameRecord): number {
    const room = this.l.room;
    if (!room || escTick.on) return NODE_NONE;
    const y = room.pinUpdate(rec.index, rec.y);
    if (y !== rec.y) rec.y = y;
    return NODE_CONTINUE;
  }
}

class CharacterNode implements BehaviourNode {
  readonly kind = 'IfcChar';
  var = 0; mask = 0; value = 0; stamp = 0xfffffffe;
  /** FUN_0054c90b: the figure's animation runs on, shown or not */
  update(_w: World, rec: GameRecord): number { if (escTick.on) return NODE_NONE; rec.anim?.advance(1); return NODE_CONTINUE; }
}

class DoorNode implements BehaviourNode {
  readonly kind = 'IfcDoor';
  var = 0; mask = 0; value = 0; stamp = 0xfffffffe;
  private l: Link;
  constructor(l: Link) { this.l = l; }
  /** FUN_0054caa1 */
  update(_w: World, rec: GameRecord): number {
    const room = this.l.room;
    if (!room || escTick.on) return NODE_NONE;
    const a = room.doorUpdate();
    rec.m.set(euler24(0, Math.fround(a * DOOR.DEG), 0, DOOR.X, DOOR.Y, DOOR.Z));   // FUN_0043a5e4, 24-bit x87
    return NODE_CONTINUE;
  }
}

// the controller's constructor always starts a fresh link (it is the first attach of the set-up code, FUN_0054ce86); the other three share it
registerCtor(IFC_CTOR.CONTROLLER, () => { link = { room: null, pagesOfPin: new Map() }; return new ControllerNode(link); });
registerCtor(IFC_CTOR.PIN, (a) => { const page = (a.argWords?.[0] ?? 0) | 0; return new PinNode(link, page); });
registerCtor(IFC_CTOR.CHARACTER, () => new CharacterNode());
registerCtor(IFC_CTOR.DOOR, () => new DoorNode(link));

/** the zone game of z04IFC */
export function createIfcGame(ctx: ZoneGameCtx): ZoneGame {
  const { sh, world, loaded } = ctx;
  const records = world.records;
  const pages = readIfcPages(sh.pe);
  const msg = (id: string) => sh.msgs.label('!' + id);
  const rand = (): number => gameRandom();     // RNG: the C runtime generator (src/zones/common/tickrand.ts)
  const host: IfcHost = {
    play: (id) => world.playSound(id),
    restart: (id) => sh.audio.restart(id),
    pepperClip: (clip) => { loaded.pepper.anim?.start(clip, 0); },
    ms: () => Math.trunc(performance.now()),
    rand,
    text: msg,
    menuSound: (k) => sh.audio.menu(k),
    setVar: (i, v) => ctx.vars.set(i, v),
  };
  const room = new IfcRoom(pages, host);
  link.room = room;

  // the player record keeps only the controller (the stub walk / guard nodes of the generic set-up are not part of the room)
  const pep = loaded.pepper;
  if (pep.ctrl) pep.ctrl.nodes = pep.ctrl.nodes.filter((n) => n.kind === 'IfcMap');
  // pins: the records with a pin node
  const pageTitle = (page: number) => labelId(pages[page].items[0].label);
  for (const rec of records) {
    const node = rec.ctrl?.nodes.find((n) => n.kind === 'IfcPin') as PinNode | undefined;
    if (node) room.addPin(rec.index, node.page, pageTitle(node.page));
  }
  room.setSelected(IFC_RECORDS.START_PIN);
  // the figures: MFIG rig, clip 0x73 (FUN_0054ce86 `FUN_0043b6a3(anim, 0x73, 0)`), hidden until their page is shown; Pepper's own clip is 0x3a
  const rig = loaded.rigs.get('MFIG') ?? null;
  if (rig) {
    for (let i: number = IFC_RECORDS.FIRST_CHAR; i <= IFC_RECORDS.LAST_CHAR; i++) {
      const r = records[i];
      if (!r || i === IFC_RECORDS.PEPPER) continue;
      r.anim = new AnimInstance(rig);
      r.anim.start(CLIP.MENU_OPEN, 0);
    }
  }
  pep.anim?.start(CLIP.SETUP, 0);

  // ---- records: pins are drawn only when selected (FUN_0054bb49), the room mesh is hidden while the menu is open (FUN_0054996a, mode 2), the figure of the open page is shown
  let shown = -1;
  const place = (rec: GameRecord) => {
    const m = rec.m, c = world.camera.c;
    // FUN_0041cbac: identity rotation, position = target - right * 2.8 - up * 2.16 (view basis of the camera of this tick)
    m.fill(0); m[0] = m[5] = m[10] = m[15] = 1;
    m[12] = c[3] - c[9] * MODEL_OFFSET.RIGHT - c[12] * MODEL_OFFSET.UP;
    m[13] = c[4] - c[10] * MODEL_OFFSET.RIGHT - c[13] * MODEL_OFFSET.UP;
    m[14] = c[5] - c[11] * MODEL_OFFSET.RIGHT - c[14] * MODEL_OFFSET.UP;
    rec.prev.set(m);
    rec.flags |= RF_ENABLED;
  };
  const syncRecords = () => {
    for (const p of room.pins.values()) {
      const r = records[p.rec];
      if (!r) continue;
      if (p.rec === room.selected) r.flags |= RF_ENABLED; else r.flags &= ~RF_ENABLED;
    }
    const land = records[IFC_RECORDS.LAND];
    if (land) { if (room.menuOpen === 0) land.flags |= RF_ENABLED; else land.flags &= ~RF_ENABLED; }
    const k = room.characterRecord();
    if (k !== shown) {
      if (shown >= 0 && records[shown]) records[shown].flags &= ~RF_ENABLED;   // FUN_0041fd45 case 2: the figure of the page that was left is hidden
      shown = k;
    }
    if (k >= 0 && records[k]) place(records[k]);
  };
  syncRecords();

  // ---- drawing of the menu pages
  const gfx = (ui: Ui2D): MenuGfx => ({
    tile: (tex, x0, y0, x1, y1, argb) => ui.sprite(sh.menuSet, tex, [x0, y0, x1, y1], argb),
    textWidth: (font, s) => sh.ui.measure(font === 0 ? 1 : 0, s).w,
    text: (font, align, s, x, y, colour) => { ui.text(font === 0 ? 1 : 0, s, x, y, { colour, align: align === -1 ? 'left' : align === 0 ? 'centre' : 'right' }); },
  });
  const rows = readRowTables(sh.pe);
  const dialogTable = Array.from({ length: 20 }, (_, i) => sh.pe.u32(0x8a99c8 + 4 * i) | 0);
  const drawMenuPage = (ui: Ui2D) => {
    const g = gfx(ui);
    const common = {
      gfx: g, rows, mask: 3 | 0x20, label: (it: { label: string }) => menuLabel(it.label, msg), onText: msg('FEON'), offText: msg('FEOFF'),
      keyName: (code: number) => keyCodeName(code, sh.keyNames), headers: ['', '', ''] as [string, string, string],
    };
    if (room.menu.cur.kind === 2) {
      drawDialog(room.menu, { ...common, dialogTable, look: msg, itemWidth: (s) => sh.ui.measure(0, s).w, line: (s, x, y) => { ui.text(0, s, x, y, { colour: 1, align: 'left' }); } });
    } else drawMenu(room.menu, common);
  };

  let lastMode: number = MODE.FADE_IN;
  const beginPass = () => { for (const r of records) { r.savePrev(); r.anim?.beginTick(); } world.camera.savePrev(); };
  const game: ZoneGame = {
    // rooms: no intro, no help, no result banner (configFor in playzone.ts)
    update() {
      escTick.on = false;
      // FUN_0054c398 (draw hook, state 2): the info menu
      room.afterFrame(sh.input.pressed, sh.pointer);
      syncRecords();
      return undefined;
    },
    /**
     * The passes of the loop (FUN_0054996a) outside mode 2 that the shared runner does not run: mode 7 (the fade in, 16 ticks) runs the UPDATE pass only (FUN_0042226e: the
     * ambient loops, the pins bob, the figures' clips advance; no pre-render, so the fly-in camera starts with mode 2), mode 5 (the exit question) runs the PRE-RENDER pass
     * only (FUN_004225c5: the camera hold and Pepper's clock keep going behind the question; the nodes that ran last are the ones that pre-render), before the menu step of
     * the same iteration (`resultTick`: the question's answer takes effect in the next iteration). `everyTick` gets the mode after the runner's transition, so the mode the
     * loop iteration started with is remembered here.
     */
    everyTick(mode) {
      const top = lastMode; lastMode = mode;
      if (top === MODE.FADE_IN) { beginPass(); updatePass(world); syncRecords(); }
    },
    resultTick() { beginPass(); world.camera.updateView(); prerenderPass(world); syncRecords(); },
    /**
     * Esc before the update pass: the original reads the input at the top of the iteration; with the info menu closed Esc switches to mode 3 there and the iteration runs neither the
     * update nor the pre-render pass. The runner ticks the world first, so the room's nodes are told to skip that tick (they return "did not run": no pre-render either) and the
     * pause-blocked state is judged at the top of the tick (the menu flag as the previous iteration left it).
     */
    beforeTick() {
      room.pauseBlocked = room.menuOpen !== 0;
      escTick.on = (sh.input.pressed & B.ESC) !== 0 && room.menuOpen === 0;
    },
    blockPause: () => room.pauseBlocked,
    dialog: {
      page: EXIT_PAGE,
      wanted: () => room.exitAsk !== 0 && room.menuOpen === 0,
      done: (ok) => { ctx.vars.set(0xb, 0); room.exitAnswered(ok); },
    },
    /**
     * FUN_0054996a end: every exit goes through FUN_00404d14(&next, exit == 2, 1) like a mini-game (the room is left to the zone the player came from). That includes the pause
     * menu's "quit" (result -1): the original sets exit state 0 and next = -1 but the code falls through (0x549d06 -> 0x549d1b) to exit state 4, so Stoppen does not reach the front end here.
     */
    exitNext(exit) {
      if (exit === EXIT.RESTART) return undefined;
      return sh.story.miniGameExit(exit === EXIT.FINISHED, true);
    },
    draw2d(ui, _dt, mode) {
      if (room.menuOpen !== 0 && room.menu.open && mode === 2) { drawMenuPage(ui); return; }
      // FUN_00460003 (HUD, mode 2 only, not while the menu is open): the caption of the selected pin
      if (mode === 2 && room.menuOpen === 0 && room.caption) {
        const k = 0.8;   // the 800x600 reference grid on the 640x480 grid
        ui.text(CAPTION.FONT, room.caption, Math.trunc(CAPTION.X * k), Math.trunc(CAPTION.Y * k), { colour: CAPTION.COLOUR, align: 'centre' });
      }
    },
    debug: () => ({
      state: room.state, cnt: room.cnt, menuOpen: room.menuOpen, exitAsk: room.exitAsk, door: [room.doorState, room.doorAngle], selected: room.selected, caption: room.caption,
      page: room.menu.open ? room.menu.page : -1, character: room.characterRecord(), eye: [...room.eye], target: [...room.target], pins: room.pins.size, var: ctx.vars.get(GV_SELECTED_PIN),
      pinAngle: room.pins.get(room.selected)?.angle ?? -1,
    }),
    destroy() { link.room = null; },
  };
  void CHAR_PAGE0;
  return game;
}

registerZoneGame('z04IFC', createIfcGame);
