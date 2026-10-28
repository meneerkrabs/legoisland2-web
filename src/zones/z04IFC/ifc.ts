// z04IFC, the Information Centre (docs/re/m3/z04IFC.md): the pure logic of the room, ported function by function from the executable (no DOM, no GL).
//   FUN_0054bce3  controller update   -> IfcRoom.update          (the camera state machine and its key handling)
//   FUN_0054c00d  controller prerender -> IfcRoom.camera         (camera eye / target per state, Pepper's animation clock)
//   FUN_0054b982  pin update          -> IfcRoom.pinUpdate       (selection with Left / Right, the bobbing of the selected pin, the caption)
//   FUN_0054caa1  door update         -> IfcRoom.doorUpdate
//   FUN_0054b7f2  menu step           -> IfcRoom.menuFrame       (the info menu: location page -> character page, FUN_0041fd45 engine)
//   FUN_0054c398  controller draw     -> IfcRoom.afterFrame      (state 2 runs the menu; its end goes back to the map)
//   FUN_0054996a  loop (kind 3 room)  -> the glue in src/zones/z04IFC.ts + the runner's loop template
// The room talks to the world through `IfcHost` (sounds, Pepper's animation, the clock, the texts), so node tests drive it with scripted keys.
import { MenuEngine } from '../../shell/menu.ts';
import type { MenuHooks, MenuPage, PointerState } from '../../shell/menu.ts';
import { B } from '../../game/input.ts';

const f32 = Math.fround;

/** sound ids loaded by FUN_0054cd70 (0x54cd70..): `FUN_00443580(id)` = load a 2D sound slot, `FUN_004435a0(slot)` = play it, `FUN_004435b0(slot)` = stop it */
export const SND = {
  MAINLOOP: 0x27b,   // 635 SND_IFC_MAINLOOP  (Info_Amb.wav, loop): played every tick by the controller
  MAINON: 0x27c,     // 636 SND_IFC_MAINON    (MF_Logon.wav): zoom in to the map (state 3 -> 5)
  MAINOFF: 0x27d,    // 637 SND_IFC_MAINOFF   (MF_EXIT.wav): zoom out of the map (state 1 -> 6)
  POINTER: 0x27e,    // 638 SND_IFC_POINTER   (movepointer.wav): a pin was selected with Left / Right
  INFO: [0x27f, 0x280, 0x281] as readonly number[],   // 639..641 SND_IFC_INFO1..3 (Display3 / 2 / 1.wav): a page was opened, one of the three at random
  TYPING: 0x2b9,     // 697 SND_IFC_TYPING    (InfoManiac.wav, loop): played every tick
  PRINTER: 0x2ba,    // 698 SND_IFC_PRINTER   (Printer.wav, loop): played every tick
  GARAGE2: 699, GARAGE3: 700, BOING: 0x2bd, WIBBLE: 0x2be,   // 699..702: the sporadic ambient sounds (about one per 2000 ticks each)
} as const;

/** the controller's states (+0x18 of its node): see `IfcRoom.update` */
export const ST = { ENTER: 0, MAP: 1, MENU: 2, IDLE: 3, SETTLE: 4, ZOOM_IN: 5, ZOOM_OUT: 6, TURN: 7, TURNED: 8, TURN_BACK: 9 } as const;

/** Pepper's animation clips of the MFIG rig: set up 0x3a (FUN_0054ce86), 0x73 when the info menu opens, 0x78 when it closes (FUN_0054bce3 / FUN_0054c398) */
export const CLIP = { SETUP: 0x3a, MENU_OPEN: 0x73, MENU_CLOSE: 0x78 } as const;

/** camera constants of FUN_0054c00d (addresses of the .rdata floats in the comments) */
export const CAM = {
  EYE_Y: f32(7.04),          // 0x40e147ae literal: eye height and target height
  EYE_Z: f32(-4.8),          // default eye z (0x892618)
  TARGET_Z: f32(-12.8),      // default target z
  FAR_Z: f32(7.2),           // 0x89261c: eye z while far from the wall (idle view, zoom, turn)
  START_X: 24,               // 0x8921a4: the fly-in starts 24 units to the side
  SLIDE: f32(0.15) * 8,      // 0x892624 * 0x892090: x per tick of the fly-in
  ZOOM: f32(0.065) * 8,      // 0x892620 * 0x892090: z per tick of the zoom
  PI: f32(Math.PI),          // 0x89207c
  TURN_DIV: 20,              // 0x89237c: the turn is `cnt * pi / 20`
  TURN_Z: -2,                // 0x892610: target z = -2 - cos(angle)
  HOLD: 1.2566370964050293,  // the double 0x3ff41b2f80000000 of state 8 (= 0.4 pi, the angle after 8 steps)
  STEPS: 0x14,               // fly-in / zoom: `0x14 < cnt`
  TURN_STEPS: 8,             // turn: `8 < cnt`
} as const;
/** where the controller puts Pepper's record (FUN_0043a5e4(rec + 0xc, 0, pi, 0, x, 0, z): Euler yaw pi) while the menu is not open */
export const PEPPER_PLACE = { yaw: f32(Math.PI), x: f32(2.657), y: 0, z: f32(-3.761) } as const;
/** the door record: opens by 5 degrees per tick down to -90 while `doorWanted` (FUN_0054caa1) */
export const DOOR = { RATE: 5, OPEN: -90, DEG: f32(0.01745319925248623), X: f32(17.792), Y: f32(4.455), Z: f32(-0.559) } as const;
/** pin bobbing: y += sin(angle) * 0.04, angle += 10 degrees, wraps after 2 pi (FUN_0054b982 / FUN_0054bc04: amplitude +0x14, angle +0x24) */
export const PIN = { AMP: f32(0.04), STEP: f32(0.1745319962501526), WRAP: f32(Math.PI * 2) } as const;
/** the character page model sits at target - 2.8 * view right - 2.16 * view up (FUN_0041cbac: 0x89206c / 0x892068) */
export const MODEL_OFFSET = { RIGHT: f32(2.8), UP: f32(2.16) } as const;
/** the pin id caption (FUN_00460003): centred at (400, 542) of the 800x600 reference grid in the csm font, colour 0 */
export const CAPTION = { X: 400, Y: 542, FONT: 0, COLOUR: 0 } as const;

/** what the room needs from its surroundings */
export interface IfcHost {
  /** FUN_004435a0: play / refresh a 2D sound (the host keeps loops running) */
  play(id: number): void;
  /** FUN_004435b0 + FUN_004435a0: stop and start again */
  restart(id: number): void;
  /** FUN_0043b6a3(Pepper's animation, clip, 0) */
  pepperClip(clip: number): void;
  /** FUN_00435c91: milliseconds since start-up */
  ms(): number;
  /** FUN_0085daf0 / 32767: a random number in [0, 1) */
  rand(): number;
  /** FUN_00439788(IFC table, id): the text of an `IFCxxx` / `LEVxxx` message */
  text(id: string): string;
  /** the menu engine's sounds (FUN_004b02d4 move, 0x25e select, 0x25f back, 0x260 on / off) */
  menuSound?(kind: 'move' | 'select' | 'back' | 'onoff'): void;
  /** game variable 0xfa (zone local): the selected pin record */
  setVar?(index: number, value: number): void;
}

/** one pin of the map (a record named PONT with the node of FUN_0054bc04): `page` = the location page of the info menu (+0x18), `id` = the location's message id (+0x1c) */
export interface Pin { rec: number; page: number; id: string; angle: number }

/** what `update` asks the glue to do with Pepper's record */
export interface UpdateResult { placePepper: boolean }

export class IfcRoom {
  /** controller node +0x18 / +0x1c: state and its counter */
  state: number = ST.ENTER;
  cnt = 0;
  /** DAT_05d587c8: the info menu is open (the room mesh is hidden, the pause trigger is off) */
  menuOpen = 0;
  /** the menu was open when this tick started: the runner's pause trigger (Esc) must not fire (the menu uses the key) */
  pauseBlocked = false;
  /** DAT_05d587d0: state != 1, the pins ignore the keys */
  pinsOff = 1;
  /** DAT_05d587cc: the exit question is due (loop mode 5) */
  exitAsk = 0;
  /** DAT_05d587d4: the door wants to be open */
  doorWanted = 0;
  /** var 0xfa: the selected pin (record index) */
  selected = -1;
  /** DAT_05d4dd7c: the caption of the selected pin (empty = none) */
  caption = '';
  /** DAT_009da5e8..: camera eye and target, rewritten every tick by `camera()` */
  eye: [number, number, number] = [0, CAM.EYE_Y, CAM.EYE_Z];
  target: [number, number, number] = [0, CAM.EYE_Y, CAM.TARGET_Z];
  /** pins by record index (the records named PONT) */
  readonly pins = new Map<number, Pin>();
  /** the door node's state (+0x18) and angle in degrees (+0x1c) */
  doorState = 0;
  doorAngle = 0;
  /** DAT_00983840 as the pins see it: the controller's frame start copies the input, a pin that used a key clears it */
  keys = 0;
  /** the info menu: the pages of the IFC table (0..16 locations, 17..45 characters) on the engine of FUN_0041fd45 */
  readonly menu: MenuEngine;
  private menuInit = false;
  /** the page the menu was opened at / the last event, for tests */
  lastEvent = 0;
  /** how often the menu opened a page (the random info sound) */
  pagesOpened = 0;

  private host: IfcHost;
  constructor(pages: MenuPage[], host: IfcHost) {
    this.host = host;
    const hooks: MenuHooks = { sound: (k) => host.menuSound?.(k) };
    this.menu = new MenuEngine(pages, hooks);
    this.menu.titleDy = 0x12;     // FUN_004201aa (called by FUN_0054b968 when the menu opens): DAT_008a9918 = 0x12, DAT_008a991c = -2
    this.menu.itemDy = -2;
  }

  /** zone set-up (FUN_0054ce86): the INFC pin (page 3) is selected first; `pinRecords` = record indices of the pins by their attach order */
  setSelected(rec: number) { this.selected = rec; this.host.setVar?.(0xfa, rec); }

  addPin(rec: number, page: number, id: string) { this.pins.set(rec, { rec, page, id, angle: 0 }); }

  /** FUN_0054bce3: one tick of the controller. `pressed` = buttons that went down this tick (DAT_00983840). */
  update(pressed: number): UpdateResult {
    const h = this.host;
    this.pauseBlocked = this.menuOpen !== 0;   // FUN_00549911 (loop top): the pause trigger is skipped while the menu is open, judged before this frame's menu step
    this.keys = pressed;                       // the pins (updated later in the pass) read this and may clear it
    h.play(SND.MAINLOOP);
    h.play(SND.TYPING);
    h.play(SND.PRINTER);
    // 0x54bd2f: `rand() * ms` truncated, % 2000: four sporadic ambient sounds (each about 1 in 2000 ticks)
    const t = Math.trunc(h.rand() * h.ms()) % 2000;
    if (t < 0x47a) {
      if (t === 0x479) h.play(SND.WIBBLE);
      else if (t === 0xf4) h.play(SND.GARAGE3);
      else if (t === 0x330) h.play(SND.BOING);
    } else if (t === 0x635) h.play(SND.GARAGE2);
    const placePepper = this.state !== ST.MENU;
    if (this.state === ST.MAP) {
      if (pressed & B.SHIFT) this.openMenu();
      if (pressed & B.ENTER) this.openMenu();
      if (pressed & B.DOWN) { h.restart(SND.MAINOFF); this.state = ST.ZOOM_OUT; this.cnt = 0; }
    }
    if (this.state === ST.IDLE) {
      if (pressed & B.UP) { h.restart(SND.MAINON); this.state = ST.ZOOM_IN; this.cnt = 0; }
      if (pressed & B.SHIFT) { h.restart(SND.MAINON); this.state = ST.ZOOM_IN; this.cnt = 0; }
      if (pressed & B.ENTER) { h.restart(SND.MAINON); this.state = ST.ZOOM_IN; this.cnt = 0; }
      if (pressed & B.LEFT) { this.state = ST.TURN; this.cnt = 0; this.doorWanted = 1; }
      if (pressed & B.DOWN) { this.state = ST.TURN; this.cnt = 0; this.doorWanted = 1; }
    }
    return { placePepper };
  }

  /** FUN_0054b968 (FUN_004201aa: the menu context is reset) + menu flag + Pepper's pose */
  private openMenu() {
    this.state = ST.MENU;
    this.menuInit = false;
    this.menuOpen = 1;
    this.host.pepperClip(CLIP.MENU_OPEN);
  }

  /** FUN_0054c00d: the camera of this tick (state machine of the counters) and the exit-question flag. Pepper's animation advances once per tick (the caller). */
  camera() {
    const e = this.eye, t = this.target;
    e[0] = 0; e[1] = CAM.EYE_Y; e[2] = CAM.EYE_Z; t[0] = 0; t[1] = CAM.EYE_Y; t[2] = CAM.TARGET_Z;
    const turn = (a: number) => { t[0] = Math.sin(a); t[2] = CAM.TURN_Z - Math.cos(a); };
    if (this.state === ST.ENTER) {
      e[0] = CAM.START_X - this.cnt * CAM.SLIDE;
      e[2] = CAM.FAR_Z;
      this.cnt++;
      if (CAM.STEPS < this.cnt) this.state = ST.SETTLE;
    }
    if (this.state === ST.ZOOM_IN) {
      e[2] = CAM.FAR_Z - this.cnt * CAM.ZOOM;
      this.cnt++;
      if (CAM.STEPS < this.cnt) this.state = ST.MAP;
    }
    if (this.state === ST.ZOOM_OUT) {
      e[2] = this.cnt * CAM.ZOOM + CAM.EYE_Z;
      this.cnt++;
      if (CAM.STEPS < this.cnt) this.state = ST.IDLE;
    }
    if (this.state === ST.TURN) {
      e[2] = CAM.FAR_Z;
      turn((this.cnt * CAM.PI) / CAM.TURN_DIV);
      this.cnt++;
      if (CAM.TURN_STEPS < this.cnt) { this.exitAsk = 1; this.state = ST.TURNED; }
    }
    if (this.state === ST.TURN_BACK) {
      e[2] = CAM.FAR_Z;
      turn(((10 - this.cnt) * CAM.PI) / CAM.TURN_DIV);
      this.cnt++;
      if (CAM.TURN_STEPS < this.cnt) this.state = ST.IDLE;
    }
    if (this.state === ST.TURNED) {
      if (this.exitAsk === 0) { this.cnt = 0; this.state = ST.TURN_BACK; this.doorWanted = 0; }
      e[2] = CAM.FAR_Z;
      turn(CAM.HOLD);
    }
    if (this.state === ST.SETTLE) { e[2] = CAM.FAR_Z; this.state = ST.IDLE; }
    if (this.state === ST.IDLE) e[2] = CAM.FAR_Z;
    this.pinsOff = this.state !== ST.MAP ? 1 : 0;
  }

  /**
   * FUN_0054b982: the pin of record `rec` (y = the record's current y): returns the new y. The selected pin shows its caption (only while the map is the active
   * view), moves the selection with Left / Right to the neighbouring pin record (clearing the key), and bobs.
   */
  pinUpdate(rec: number, y: number): number {
    const pin = this.pins.get(rec);
    if (!pin || this.selected !== rec) return y;
    const h = this.host;
    if (this.menuOpen === 0 && this.pinsOff === 0) {
      this.caption = h.text(pin.id);
      if ((this.keys & B.LEFT) !== 0 && this.pins.has(rec - 1)) { this.setSelected(rec - 1); this.keys = 0; h.restart(SND.POINTER); }
      if ((this.keys & B.RIGHT) !== 0 && this.pins.has(rec + 1)) { this.setSelected(rec + 1); this.keys = 0; h.restart(SND.POINTER); }
    } else this.caption = '';
    y = f32(Math.sin(pin.angle) * PIN.AMP + y);
    pin.angle = f32(pin.angle + PIN.STEP);
    if (PIN.WRAP < pin.angle) pin.angle = 0;
    return y;
  }

  /** FUN_0054caa1: the door's angle in degrees for this tick */
  doorUpdate(): number {
    switch (this.doorState) {
      case 0:
        this.doorAngle = 0;
        if (this.doorWanted === 1) this.doorState = 1;
        break;
      case 1:
        this.doorAngle -= DOOR.RATE;
        if (this.doorAngle <= DOOR.OPEN) this.doorState = 2;
        if (this.doorWanted === 0) this.doorState = 3;
        break;
      case 2:
        this.doorAngle = DOOR.OPEN;
        if (this.doorWanted === 0) this.doorState = 3;
        break;
      case 3:
        this.doorAngle += DOOR.RATE;
        if (0 <= this.doorAngle) this.doorState = 0;
        if (this.doorWanted === 1) this.doorState = 1;
        break;
    }
    return this.doorAngle;
  }

  /** the location page of the selected pin (the first page of the info menu) */
  selectedPage(): number { return this.pins.get(this.selected)?.page ?? 0; }

  /** the record of the character the open page shows (page 17 + k -> record 1 + k), -1 on a location page */
  characterRecord(): number {
    if (!this.menu.open || this.menuOpen === 0) return -1;
    const p = this.menu.page;
    return p >= CHAR_PAGE0 ? p - CHAR_PAGE0 + 1 : -1;
  }

  /**
   * FUN_0054b7f2: one frame of the info menu. The first call only starts the engine at the selected pin's location page (DAT_05d587b8[7] == -1);
   * a page change plays one of the three info sounds; leaving the top page ends the menu. Returns true when it ended.
   */
  menuFrame(pressed: number, pointer?: PointerState): boolean {
    const m = this.menu;
    if (!this.menuInit) {
      m.openAt(this.selectedPage());
      this.menuInit = true;
      return false;
    }
    const r = m.step(pressed, 3, pointer);
    this.lastEvent = r.ev;
    if (r.ev === 1) {
      const n = Math.trunc(this.host.rand() * this.host.ms()) % 3;       // FUN_004388ae(ms) % 3
      this.host.play(SND.INFO[n]);
      this.pagesOpened++;
    } else if (r.ev === 2 && r.a === -1) {
      this.menuInit = false;
      m.close();
      return true;
    }
    return false;
  }

  /** FUN_0054c398 (the controller's draw hook): in state 2 the menu runs; when it ends the map comes back and Pepper takes his pose */
  afterFrame(pressed: number, pointer?: PointerState) {
    if (this.state === ST.MENU && this.menuFrame(pressed, pointer)) {
      this.menuOpen = 0;
      this.state = ST.MAP;
      this.host.pepperClip(CLIP.MENU_CLOSE);
    }
  }

  /** the exit question was answered (FUN_0054996a case 3): cancel = back to the map room (the turn back starts in `camera`) */
  exitAnswered(ok: boolean) { if (!ok) this.exitAsk = 0; }
}

/** the first page of the character pages (pages 0..16 are the locations, 17..45 the 29 characters; record 1..29) */
export const CHAR_PAGE0 = 17;
/** the exit question: loop page 15 (`FEEXIT` with `OK` and `Annuleren`), action 0x10 = leave, 0xf = stay (FUN_0041c092 results 1 / -2) */
export const EXIT_PAGE = 0xf;
