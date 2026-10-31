// Input mapper (SDPad.cpp, docs/re/architecture.md 7.1, docs/re/input.md): keys / mouse / pad -> logical button bits, once per simulation tick (FUN_004376f9, called by FUN_00423170).
// The key table lives in the executable (13 entries x 0x30 bytes at 0x8aeb20: default key, current key, logical bit, flag), so the default keys are read from it at run time;
// DirectInput scancodes are mapped to browser `KeyboardEvent.code` values in shell/dik.ts.
// Logical bits: 1 Left, 2 Right, 4 Up, 8 Down, 0x10 Ctrl, 0x20 Alt (jump), 0x40 Shift, 0x80 Space, 0x1000 `<>`, 0x2000 Z, 0x4000 X, 0x8000 C,
// 0x10000 Enter, 0x20000 pad button 9; Esc = 0x40000000 (pause), any key = 0x80000000.
import type { Pe } from '../formats/exe.ts';
import { dikToCodes, codeToDik } from '../shell/dik.ts';

export const KEY_TABLE_VA = 0x8aeb20;
export const KEY_ENTRIES = 13;
export const B = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CTRL: 0x10, ALT: 0x20, SHIFT: 0x40, SPACE: 0x80, KEY1000: 0x1000, Z: 0x2000, X: 0x4000, C: 0x8000, ENTER: 0x10000, PAD9: 0x20000, ESC: 0x40000000, ANY: 0x80000000 } as const;

/** key codes of the executable (FUN_00437148(device, id)): `(device << 16) | id`, device 0 = mouse button, 1 = keyboard DIK, 2 = joystick button */
export const KC = { MOUSE: 0, KEY: 1, JOY: 2 } as const;
export const keyCode = (device: number, id: number) => ((device << 16) | id) >>> 0;

/** convenience aliases that are not in the original (decision I3 of docs/re/gaps.md: kept): WASD for the arrows, Q for the key that does not exist on US keyboards, and the right-hand twins of Ctrl / Shift / Alt / Enter */
const ALIASES: Record<number, string[]> = {
  0xc8: ['KeyW'], 0xd0: ['KeyS'], 0xcb: ['KeyA'], 0xcd: ['KeyD'], 0x56: ['KeyQ'],
  0x1d: ['ControlRight'], 0x2a: ['ShiftRight'], 0x38: ['AltRight'], 0x1c: ['NumpadEnter'],
};
const codesCache = new Map<number, string[]>();
const codesOfDik = (dik: number): string[] => { let c = codesCache.get(dik); if (!c) { c = [...dikToCodes(dik), ...(ALIASES[dik] ?? [])]; codesCache.set(dik, c); } return c; };

/** DirectInput mouse button index (DIMOUSESTATE2.rgbButtons) -> `MouseEvent.button` */
const MOUSE_DI_TO_BROWSER = [0, 2, 1, 3, 4];
/** gamepads with the browser's "standard" layout: DirectInput's button order of an Xbox-type pad (A B X Y LB RB Back Start LS RS) -> standard button index (LT / RT are an axis and the D-pad a POV hat in DirectInput: no buttons) */
const STANDARD_TO_DI = [0, 1, 2, 3, 4, 5, 8, 9, 10, 11];
/** FUN_004376f9: pad buttons 0..9 -> logical bits (read through FUN_004371ea, which is the plain held state: see docs/re/input.md) */
export const PAD_BUTTON_BITS = [0x10, 0x20, 0x40, 0x80, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000];

/** FUN_004372d2(2, n): the axis (-65536 .. 65536 after DIPROP_RANGE) `>> 9`, rounded towards zero; FUN_004376f9 compares it with +-0x40 */
export function padAxisUnits(a: number): number {
  const v = Math.trunc(Math.max(-1, Math.min(1, a)) * 65536);
  return (v + ((v >> 31) & 0x1ff)) >> 9;
}
/** FUN_004376f9: the direction bits of the stick (X = axis 0, Y = axis 1; up = negative Y) */
export function padStickBits(ax: number, ay: number): number {
  const x = padAxisUnits(ax), y = padAxisUnits(ay);
  let m = 0;
  if (y > 0x40) m |= B.DOWN;
  if (y < -0x40) m |= B.UP;
  if (x < -0x40) m |= B.LEFT;
  if (x > 0x40) m |= B.RIGHT;
  return m;
}
/** FUN_004372d2(0, n) as FUN_00437ca5 uses it: `(int)(raw * ((sensitivity + 5) * 0.05f))`, the scale rounded to a float first, the product truncated towards zero */
export function mouseUnits(raw: number, sensitivity: number): number {
  const scale = Math.fround((sensitivity + 5) * Math.fround(0.05));
  return Math.trunc(raw * scale);
}

export interface KeyBinding {
  /** DIK of the current key (0 when it is a mouse / joystick button) */
  dik: number;
  bit: number;
  /** browser codes of the current key (keyboard only) */
  codes: string[];
  /** the current key: `(device << 16) | id` (entry +4 of the table) */
  code: number;
  /** the fixed key of the action (entry +0), active only while `defaultActive` (entry flag +0xc) */
  defaultCode: number;
  defaultActive: boolean;
}

/** the default table (used when no executable is at hand: tests) */
export const DEFAULT_BINDINGS: { dik: number; bit: number }[] = [
  { dik: 0xc8, bit: 4 }, { dik: 0xd0, bit: 8 }, { dik: 0xcb, bit: 1 }, { dik: 0xcd, bit: 2 }, { dik: 0x1d, bit: 0x10 }, { dik: 0x38, bit: 0x20 },
  { dik: 0x2a, bit: 0x40 }, { dik: 0x39, bit: 0x80 }, { dik: 0x56, bit: 0x1000 }, { dik: 0x2c, bit: 0x2000 }, { dik: 0x2d, bit: 0x4000 },
  { dik: 0x2e, bit: 0x8000 }, { dik: 0x1c, bit: 0x10000 },
];

export function readKeyTable(pe: Pe): { dik: number; bit: number }[] {
  const out: { dik: number; bit: number }[] = [];
  for (let i = 0; i < KEY_ENTRIES; i++) {
    const base = KEY_TABLE_VA + i * 0x30;
    const key = pe.u32(base), bit = pe.u32(base + 8);
    if ((key >>> 16) === 1) out.push({ dik: key & 0xffff, bit });
  }
  return out.length === KEY_ENTRIES ? out : DEFAULT_BINDINGS;
}

/** a binding table entry: the current key as `{ dik }` (keyboard, the old form) or `{ device, dik }` / `{ code }` */
export type BindingSpec = { dik?: number; device?: number; code?: number; bit: number };
const specCode = (t: BindingSpec): number => t.code !== undefined ? t.code >>> 0 : keyCode(t.device ?? KC.KEY, t.dik ?? 0);

/** a snapshot of the devices taken once per tick (the original polls DirectInput once per frame: FUN_00437411) */
interface Sample { keys: Set<string>; mouse: Set<number>; pad: boolean[]; }

export class InputMapper {
  bindings: KeyBinding[];
  /** DAT_0098383c: buttons held this tick */
  held = 0;
  /** DAT_0098383c of the previous tick */
  prevHeld = 0;
  /** DAT_00983840: buttons that went down this tick ((held ^ prev) & held) */
  pressed = 0;
  /** FUN_00437ca5 as of this tick: mouse buttons as 0x10 / 0x20 / 0x40 / 0x80 and the movement since the last tick (scaled by the sensitivity; dy: up is positive) */
  mouse = { buttons: 0, dx: 0, dy: 0 };
  /** Settings[0x13]: the pad is read at all */
  gamepad = true;
  /** Settings[0x14] (default 45): the mouse sensitivity */
  sensitivity = 45;
  /** the gamepads (the browser's `navigator.getGamepads`); overridable by tests */
  getPads: () => ArrayLike<Gamepad | null> = () => { try { return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : []; } catch { return []; } };   // (a permissions policy may forbid it)
  /**
   * TEST-ONLY switch: a key / button that was pressed and released between two ticks still counts for one tick. Off by default: like the original's poll (FUN_00437411, DirectInput
   * state read once per frame) the state is sampled once per tick and a tap shorter than that is not seen. Bots that tap must hold the key for at least 5 ticks of the fixed 60 Hz step (70 ms or more).
   */
  latchTaps = false;
  /** the cheat-code detector (FUN_004375a8): polled once per tick with FUN_00437fdf's result */
  cheats: { poll(code: number): void } | null = null;
  /** F10 went down (the original sets DAT_00986e28 while the key is held; the screenshot is taken after the frame has been drawn) */
  onScreenshot: (() => void) | null = null;

  /** browser key state */
  private down = new Set<string>();
  private virtual = 0;
  private target: EventTarget | null = null;
  /** keys / buttons that went down since the last tick, only used with `latchTaps` */
  private latched = new Set<string>();
  private mouseDown = new Set<number>();
  private mouseLatched = new Set<number>();
  private accDx = 0; private accDy = 0;
  /** the chase camera ran in the previous tick: the mouse look wants the pointer */
  private wantLook = false;
  private lookNow = false;
  private escFromUnlock = false;
  private lastSample: Sample = { keys: new Set(), mouse: new Set(), pad: [] };
  private f10Prev = false;

  private onDown = (e: Event) => {
    const k = e as KeyboardEvent;
    this.down.add(k.code); this.latched.add(k.code);
    if (this.isGameKey(k.code)) k.preventDefault();
    this.tryLock();
  };
  private onUp = (e: Event) => {
    const k = e as KeyboardEvent;
    this.down.delete(k.code);
    // macOS sends no key-up for the keys that are held while Meta is down: forget them with the Meta key
    if (k.code === 'MetaLeft' || k.code === 'MetaRight') this.down.clear();
  };
  private onBlur = () => { this.down.clear(); this.latched.clear(); this.mouseDown.clear(); this.mouseLatched.clear(); };
  private onMouseDown = (e: Event) => {
    const n = MOUSE_DI_TO_BROWSER.indexOf((e as MouseEvent).button);
    if (n >= 0) { this.mouseDown.add(n); this.mouseLatched.add(n); }
    this.tryLock();
  };
  private onMouseUp = (e: Event) => { const n = MOUSE_DI_TO_BROWSER.indexOf((e as MouseEvent).button); if (n >= 0) this.mouseDown.delete(n); };
  private onMouseMove = (e: Event) => {
    if (typeof document === 'undefined' || !document.pointerLockElement) return;
    const m = e as MouseEvent;
    this.accDx += m.movementX || 0; this.accDy += m.movementY || 0;
  };
  private onContext = (e: Event) => { if (this.lookNow) e.preventDefault(); };
  private onLockChange = () => {
    // Esc releases the pointer lock and the browser keeps that Esc from the page: it is the pause key
    if (typeof document !== 'undefined' && !document.pointerLockElement && this.lookNow) this.escFromUnlock = true;
  };

  constructor(table: BindingSpec[] = DEFAULT_BINDINGS) {
    this.defaults = table.map((t) => ({ code: specCode(t), bit: t.bit }));
    this.bindings = this.makeBindings(table);
  }
  /** the fixed keys of the table (entry +0), from the executable */
  private defaults: { code: number; bit: number }[];

  /**
   * FUN_00436f7d: the flag of an entry (+0xc, `defaultActive`) is on unless its fixed key is the current key of some entry (the key table of the options holds the current keys;
   * rebinding an action with FUN_00437e82 keeps the old fixed keys live again, so an action that was rebound answers to its new key AND its fixed key).
   */
  private makeBindings(table: BindingSpec[]): KeyBinding[] {
    const cur = table.map(specCode);
    return table.map((t, i) => {
      const code = cur[i];
      const def = this.defaults[i]?.code ?? code;
      const dev = code >>> 16, id = code & 0xffff;
      return {
        dik: dev === KC.KEY ? id : 0, bit: t.bit, code,
        codes: dev === KC.KEY ? codesOfDik(id) : [],
        defaultCode: def, defaultActive: !cur.includes(def),
      };
    });
  }
  /** the options' key bindings changed (Settings.set 4..0x10: the current key per logical bit) */
  rebind(table: BindingSpec[]) { this.bindings = this.makeBindings(table); }

  private isGameKey(code: string) {
    return code === 'Escape' || code === 'F10' || this.bindings.some((b) => b.codes.includes(code) || (b.defaultActive && (b.defaultCode >>> 16) === KC.KEY && codesOfDik(b.defaultCode & 0xffff).includes(code)));
  }

  attach(target: EventTarget = window) {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    addEventListener('blur', this.onBlur);
    addEventListener('mousedown', this.onMouseDown, true);
    addEventListener('mouseup', this.onMouseUp, true);
    addEventListener('mousemove', this.onMouseMove, true);
    addEventListener('contextmenu', this.onContext, true);
    if (typeof document !== 'undefined') document.addEventListener('pointerlockchange', this.onLockChange);
  }
  detach() {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    removeEventListener('blur', this.onBlur);
    removeEventListener('mousedown', this.onMouseDown, true);
    removeEventListener('mouseup', this.onMouseUp, true);
    removeEventListener('mousemove', this.onMouseMove, true);
    removeEventListener('contextmenu', this.onContext, true);
    if (typeof document !== 'undefined') document.removeEventListener('pointerlockchange', this.onLockChange);
    this.target = null;
  }

  /** tests / scripts: set the held logical buttons directly (cleared with setVirtual(0)) */
  setVirtual(mask: number) { this.virtual = mask; }
  /** press / release a browser key code programmatically */
  setKey(code: string, down: boolean) { if (down) { this.down.add(code); this.latched.add(code); } else this.down.delete(code); }
  /** press / release a mouse button programmatically (DirectInput index: 0 left, 1 right, 2 middle, 3 / 4 the side buttons) */
  setMouseButton(n: number, down: boolean) { if (down) { this.mouseDown.add(n); this.mouseLatched.add(n); } else this.mouseDown.delete(n); }
  /** mouse movement (raw counts, DirectInput lX / lY) that arrived since the last tick */
  addMouseDelta(dx: number, dy: number) { this.accDx += dx; this.accDy += dy; }

  /** the chase camera (FUN_0042c227) read the mouse this tick: the pointer is wanted from the next tick on */
  markMouseLook() { this.wantLook = true; }

  /**
   * the pointer lock the mouse look needs: a browser grants it only from a user action (a key / button press while the camera wants it), so it is asked for from the key and
   * mouse handlers. `unadjustedMovement` gives raw counts like DirectInput's relative mouse axes (no pointer acceleration) where the browser has it.
   */
  private lockTried = -1e9;
  private tryLock() {
    if (!this.wantLook || typeof document === 'undefined' || document.pointerLockElement) return;
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    if (now - this.lockTried < 400) return;
    this.lockTried = now;
    const el = document.querySelector('canvas.sh-canvas, canvas.bdb-screen') as HTMLElement | null;
    if (!el?.requestPointerLock) return;
    const swallow = (p: unknown) => { if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(() => { /* refused: no mouse look */ }); };
    const plain = () => { try { swallow(el.requestPointerLock()); } catch { /* refused: no mouse look */ } };
    try {
      const p = (el.requestPointerLock as (o?: object) => unknown).call(el, { unadjustedMovement: true });
      if (p && typeof (p as Promise<void>).catch === 'function') (p as Promise<void>).catch(plain); else swallow(p);
    } catch { plain(); }
  }

  // ---------------------------------------------------------------------------------------------------------------------- device state

  /** the first attached game controller only: `EnumDevices(DI8DEVCLASS_GAMECTRL, ATTACHEDONLY)` with the callback FUN_00436c5a returning DIENUM_STOP */
  private firstPad(): Gamepad | null {
    if (!this.gamepad) return null;
    for (const gp of Array.from(this.getPads())) if (gp && gp.connected !== false) return gp;
    return null;
  }
  /** the pad's buttons in DirectInput order */
  private padButtons(gp: Gamepad | null): boolean[] {
    if (!gp) return [];
    if (gp.mapping === 'standard') return STANDARD_TO_DI.map((i) => !!gp.buttons[i]?.pressed);
    return Array.from(gp.buttons, (b) => !!b?.pressed);
  }
  private takeSample(): Sample {
    const keys = new Set<string>(this.latchTaps ? [...this.down, ...this.latched] : this.down);
    const mouse = new Set<number>(this.latchTaps ? [...this.mouseDown, ...this.mouseLatched] : this.mouseDown);
    return { keys, mouse, pad: this.padButtons(this.firstPad()) };
  }
  /** FUN_00437148(device, id): is this key / button down in the sample of this tick */
  isDown(code: number, s: Sample = this.lastSample): boolean {
    const dev = code >>> 16, id = code & 0xffff;
    if (dev === KC.KEY) { for (const c of codesOfDik(id)) if (s.keys.has(c)) return true; return false; }
    if (dev === KC.MOUSE) return s.mouse.has(id);
    if (dev === KC.JOY) return !!s.pad[id];
    return false;
  }
  private dikDown(dik: number, s: Sample): boolean {
    for (const c of dikToCodes(dik)) if (s.keys.has(c)) return true;
    return false;
  }

  /** FUN_00437fdf: the lowest button that is down: mouse buttons 0..7 (as is), then keyboard (0x10000 | DIK), then joystick buttons (0x20000 | n); 0 = nothing (a lone left mouse button gives 0 as well) */
  anyCode(s: Sample = this.lastSample): number {
    for (let n = 0; n < 8; n++) if (s.mouse.has(n)) return n;
    let lo = 0;
    for (const c of s.keys) { const d = codeToDik(c) || 0xff; if (lo === 0 || d < lo) lo = d; }
    if (lo) return keyCode(KC.KEY, lo);
    for (let n = 0; n < s.pad.length && n < 0x80; n++) if (s.pad[n]) return keyCode(KC.JOY, n);
    return 0;
  }

  /**
   * FUN_00438099 (the key page's capture, polled every tick by FUN_0041f966): the key code to bind, 0 = none. `own` is the current key of the entry being bound
   * (FUN_0043808c): while that key is down it is the answer (the entry keeps it). Otherwise the first mouse button 2..7, then the first keyboard key, that is not the
   * current key of any entry; keys of the blocked list (Esc, F10, the Windows keys, the grave accent key: DAT_008aef08) answer 0.
   */
  captureKey(own: number, blocked: readonly number[] = CAPTURE_BLOCKED): number {
    const s = this.lastSample;
    if (this.dikDown(own & 0xfffeffff, s)) return own;
    const cur = this.bindings.map((b) => b.code);
    let k = 0;
    for (let n = 2; n < 8; n++) if (s.mouse.has(n) && !cur.includes(keyCode(KC.MOUSE, n))) { k = keyCode(KC.MOUSE, n); break; }
    for (let n = 0; n < 0x100; n++) if (this.dikDown(n, s) && !cur.includes(keyCode(KC.KEY, n))) { k = keyCode(KC.KEY, n); break; }
    return blocked.includes(k) ? 0 : k;
  }

  /** number of samples taken (`update` calls: one per loop pass of the shell); only read by the browser bots (tools/browse.mjs `key`) to hold a tap until the game has seen it */
  updates = 0;

  /** FUN_004376f9 + FUN_00423170: sample the devices once per simulation tick */
  update() {
    this.updates++;
    const s = this.takeSample();
    this.lastSample = s;
    this.latched.clear(); this.mouseLatched.clear();
    const keyDown = (c: string) => s.keys.has(c);
    let m = this.virtual;
    // the key table: the current key of an entry always, its fixed key while the entry's flag is set
    for (const b of this.bindings) {
      if (this.isDown(b.code, s)) m |= b.bit;
      if (b.defaultActive && this.isDown(b.defaultCode, s)) m |= b.bit;
    }
    // the pad: stick beyond +-0x40 of `axis >> 9` gives the direction bits (the axes themselves are zeroed after that, FUN_004376f9), buttons 0..9 their bits, held
    const gp = this.firstPad();
    if (gp) {
      m |= padStickBits(gp.axes[0] ?? 0, gp.axes[1] ?? 0);
      s.pad.forEach((down, i) => { if (down && i < PAD_BUTTON_BITS.length) m |= PAD_BUTTON_BITS[i]; });
    }
    if (keyDown('Escape') || this.escFromUnlock) m = B.ESC;
    this.escFromUnlock = false;
    // F10: the screenshot key (every mode)
    const f10 = keyDown('F10');
    if (f10 && !this.f10Prev) this.onScreenshot?.();
    this.f10Prev = f10;
    this.cheats?.poll(this.anyCode(s));
    // FUN_004376f9 last: no bit and some button down (FUN_00437fdf != 0) = "any key" (0x80000000)
    if (m === 0 && this.anyCode(s) !== 0) m = B.ANY;
    // the mouse (FUN_00437ca5, read by the chase camera): buttons 0..3 = 0x10..0x80, movement since the last tick
    let mb = 0;
    for (let i = 0; i < 4; i++) if (s.mouse.has(i)) mb |= 0x10 << i;
    this.mouse = { buttons: mb, dx: mouseUnits(this.accDx, this.sensitivity), dy: -mouseUnits(this.accDy, this.sensitivity) };
    this.accDx = 0; this.accDy = 0;
    // the pointer lock follows the chase camera
    this.lookNow = this.wantLook;
    if (!this.wantLook && typeof document !== 'undefined' && document.pointerLockElement) { try { document.exitPointerLock(); } catch { /* ignore */ } }
    this.wantLook = false;
    this.prevHeld = this.held;
    this.held = m >>> 0;
    this.pressed = ((this.held ^ this.prevHeld) & this.held) >>> 0;
  }
}

/** DAT_008aef08: keys the capture refuses (Esc, F10, LWIN, RWIN, APPMENU, the grave accent key): `0x10000 | DIK` */
export const CAPTURE_BLOCKED: readonly number[] = [0x10001, 0x10044, 0x100db, 0x100dc, 0x100dd, 0x10029];
