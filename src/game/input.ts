// Input mapper (SDPad.cpp, docs/re/architecture.md 7.1): keys -> logical button bits.
// The key table lives in the executable (13 entries x 0x30 bytes at 0x8aeb20: default DirectInput key code, current key, logical bit),
// so the default keys are read from it at run time; DirectInput scancodes are mapped to browser `KeyboardEvent.code` values below.
// Logical bits: 1 Left, 2 Right, 4 Up, 8 Down, 0x10 Ctrl, 0x20 Alt (jump), 0x40 Shift, 0x80 Space, 0x1000 `<>`, 0x2000 Z, 0x4000 X, 0x8000 C,
// 0x10000 Enter; Esc = 0x40000000 (pause), any key = 0x80000000.
import type { Pe } from '../formats/exe.ts';

export const KEY_TABLE_VA = 0x8aeb20;
export const KEY_ENTRIES = 13;
export const B = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CTRL: 0x10, ALT: 0x20, SHIFT: 0x40, SPACE: 0x80, KEY1000: 0x1000, Z: 0x2000, X: 0x4000, C: 0x8000, ENTER: 0x10000, ESC: 0x40000000, ANY: 0x80000000 } as const;

/** DirectInput keyboard scancode (key code = 0x10000 | scancode for the keyboard device) -> browser codes */
const DIK_TO_CODES: Record<number, string[]> = {
  0xc8: ['ArrowUp'], 0xd0: ['ArrowDown'], 0xcb: ['ArrowLeft'], 0xcd: ['ArrowRight'],
  0x1d: ['ControlLeft', 'ControlRight'], 0x38: ['AltLeft', 'AltRight'], 0x2a: ['ShiftLeft', 'ShiftRight'], 0x39: ['Space'],
  0x56: ['IntlBackslash'], 0x2c: ['KeyZ'], 0x2d: ['KeyX'], 0x2e: ['KeyC'], 0x1c: ['Enter', 'NumpadEnter'],
};
/** convenience aliases that are not in the original: WASD for the arrows, Q for the key that does not exist on US keyboards */
const ALIASES: Record<number, string[]> = { 0xc8: ['KeyW'], 0xd0: ['KeyS'], 0xcb: ['KeyA'], 0xcd: ['KeyD'], 0x56: ['KeyQ'] };

export interface KeyBinding { dik: number; bit: number; codes: string[] }

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

export class InputMapper {
  bindings: KeyBinding[];
  /** DAT_0098383c: buttons held this tick */
  held = 0;
  /** DAT_0098383c of the previous tick */
  prevHeld = 0;
  /** DAT_00983840: buttons that went down this tick ((held ^ prev) & held) */
  pressed = 0;
  /** browser key state */
  private down = new Set<string>();
  private virtual = 0;
  private target: EventTarget | null = null;
  /** keys that went down since the last tick: a tap shorter than one tick still counts (the original reads buffered DirectInput events) */
  private latched = new Set<string>();
  private onDown = (e: Event) => { const k = e as KeyboardEvent; this.down.add(k.code); this.latched.add(k.code); if (this.isGameKey(k.code)) k.preventDefault(); };
  private onUp = (e: Event) => { this.down.delete((e as KeyboardEvent).code); };
  private onBlur = () => { this.down.clear(); this.latched.clear(); };
  gamepad = true;

  constructor(table: { dik: number; bit: number }[] = DEFAULT_BINDINGS) {
    this.bindings = table.map((t) => ({ dik: t.dik, bit: t.bit, codes: [...(DIK_TO_CODES[t.dik] ?? []), ...(ALIASES[t.dik] ?? [])] }));
  }

  private isGameKey(code: string) { return this.bindings.some((b) => b.codes.includes(code)) || code === 'Escape'; }

  attach(target: EventTarget = window) {
    this.detach();
    this.target = target;
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    addEventListener('blur', this.onBlur);
  }
  detach() {
    if (!this.target) return;
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    removeEventListener('blur', this.onBlur);
    this.target = null;
  }

  /** tests / scripts: set the held logical buttons directly (cleared with setVirtual(0)) */
  setVirtual(mask: number) { this.virtual = mask; }
  /** press / release a browser key code programmatically */
  setKey(code: string, down: boolean) { if (down) { this.down.add(code); this.latched.add(code); } else this.down.delete(code); }

  /** FUN_004376f9 + FUN_00423170: sample the keys once per simulation tick */
  update() {
    let m = this.virtual;
    for (const b of this.bindings) for (const c of b.codes) if (this.down.has(c) || this.latched.has(c)) { m |= b.bit; break; }
    const esc = this.down.has('Escape') || this.latched.has('Escape');
    this.latched.clear();
    if (this.gamepad && typeof navigator !== 'undefined' && navigator.getGamepads) {
      for (const gp of navigator.getGamepads()) {
        if (!gp) continue;
        // stick beyond +-0.5 gives the direction bits (the original: beyond +-0x40 of +-512); buttons 0..9 -> 0x10, 0x20, 0x40, 0x80, 0x1000 ... 0x20000
        if (gp.axes[0] < -0.5) m |= B.LEFT; if (gp.axes[0] > 0.5) m |= B.RIGHT;
        if (gp.axes[1] < -0.5) m |= B.UP; if (gp.axes[1] > 0.5) m |= B.DOWN;
        const bits = [0x10, 0x20, 0x40, 0x80, 0x1000, 0x2000, 0x4000, 0x8000, 0x10000, 0x20000];
        gp.buttons.forEach((bt, i) => { if (bt.pressed && i < bits.length) m |= bits[i]; });
      }
    }
    if (esc) m = B.ESC;
    this.prevHeld = this.held;
    this.held = m;
    this.pressed = (this.held ^ this.prevHeld) & this.held;
  }
}
