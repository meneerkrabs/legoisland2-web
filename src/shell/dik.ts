// DirectInput keyboard scancodes (the key codes of Settings.set: (device << 16) | DIK, docs/re/architecture.md 6.4 / 7.1) <-> browser `KeyboardEvent.code`,
// and the key names of the executable's name table (0x8aef28: {DIK, char* name} pairs ended by -1; FUN_0043839f turns a key code into text).
import type { Pe } from '../formats/exe.ts';

const LETTERS: [number, string][] = [[0x10, 'Q'], [0x11, 'W'], [0x12, 'E'], [0x13, 'R'], [0x14, 'T'], [0x15, 'Y'], [0x16, 'U'], [0x17, 'I'], [0x18, 'O'], [0x19, 'P'],
  [0x1e, 'A'], [0x1f, 'S'], [0x20, 'D'], [0x21, 'F'], [0x22, 'G'], [0x23, 'H'], [0x24, 'J'], [0x25, 'K'], [0x26, 'L'], [0x2c, 'Z'], [0x2d, 'X'], [0x2e, 'C'], [0x2f, 'V'], [0x30, 'B'], [0x31, 'N'], [0x32, 'M']];

const MAP: [number, string][] = [
  [0x01, 'Escape'], [0x0c, 'Minus'], [0x0d, 'Equal'], [0x0e, 'Backspace'], [0x0f, 'Tab'], [0x1a, 'BracketLeft'], [0x1b, 'BracketRight'], [0x1c, 'Enter'], [0x1d, 'ControlLeft'],
  [0x27, 'Semicolon'], [0x28, 'Quote'], [0x29, 'Backquote'], [0x2a, 'ShiftLeft'], [0x2b, 'Backslash'], [0x33, 'Comma'], [0x34, 'Period'], [0x35, 'Slash'], [0x36, 'ShiftRight'],
  [0x37, 'NumpadMultiply'], [0x38, 'AltLeft'], [0x39, 'Space'], [0x3a, 'CapsLock'], [0x45, 'NumLock'], [0x46, 'ScrollLock'],
  [0x47, 'Numpad7'], [0x48, 'Numpad8'], [0x49, 'Numpad9'], [0x4a, 'NumpadSubtract'], [0x4b, 'Numpad4'], [0x4c, 'Numpad5'], [0x4d, 'Numpad6'], [0x4e, 'NumpadAdd'],
  [0x4f, 'Numpad1'], [0x50, 'Numpad2'], [0x51, 'Numpad3'], [0x52, 'Numpad0'], [0x53, 'NumpadDecimal'], [0x56, 'IntlBackslash'], [0x57, 'F11'], [0x58, 'F12'],
  [0x9c, 'NumpadEnter'], [0x9d, 'ControlRight'], [0xb5, 'NumpadDivide'], [0xb8, 'AltRight'], [0xc7, 'Home'], [0xc8, 'ArrowUp'], [0xc9, 'PageUp'], [0xcb, 'ArrowLeft'],
  [0xcd, 'ArrowRight'], [0xcf, 'End'], [0xd0, 'ArrowDown'], [0xd1, 'PageDown'], [0xd2, 'Insert'], [0xd3, 'Delete'],
  ...LETTERS.map(([d, l]): [number, string] => [d, `Key${l}`]),
  ...Array.from({ length: 10 }, (_, i): [number, string] => [0x02 + i, `Digit${(i + 1) % 10}`]),
  ...Array.from({ length: 10 }, (_, i): [number, string] => [0x3b + i, `F${i + 1}`]),
];

const byDik = new Map<number, string[]>();
const byCode = new Map<string, number>();
for (const [d, c] of MAP) { byDik.set(d, [...(byDik.get(d) ?? []), c]); byCode.set(c, d); }
// the right-hand twins of the modifier keys share the scancode of their left-hand key in DirectInput terms (each has its own DIK; here both are accepted)
byDik.set(0x1d, ['ControlLeft', 'ControlRight']); byDik.set(0x2a, ['ShiftLeft', 'ShiftRight']); byDik.set(0x38, ['AltLeft', 'AltRight']); byDik.set(0x1c, ['Enter', 'NumpadEnter']);
byCode.set('ControlRight', 0x1d); byCode.set('ShiftRight', 0x2a); byCode.set('AltRight', 0x38); byCode.set('NumpadEnter', 0x1c);

/** browser key codes that produce this DIK (several for the modifier twins) */
export function dikToCodes(dik: number): string[] { return byDik.get(dik) ?? []; }
/** DIK of a browser key code, 0 = none */
export function codeToDik(code: string): number { return byCode.get(code) ?? 0; }

export const KEY_NAME_TABLE_VA = 0x8aef28;
/** name table of the executable: DIK -> upper-case name */
export function readKeyNames(pe: Pe): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i < 200; i++) {
    const dik = pe.u32(KEY_NAME_TABLE_VA + i * 8) | 0;
    if (dik === -1) break;
    const p = pe.u32(KEY_NAME_TABLE_VA + i * 8 + 4);
    if (p) out.set(dik, pe.cstr(p, 32));
  }
  return out;
}

/** FUN_0043839f: text of a key code ((device << 16) | id): 'MOUSE n', the table name, 'JOY n', else the name of the unknown entry */
export function keyCodeName(code: number, names: Map<number, string>): string {
  const dev = code >>> 16, id = code & 0xffff;
  if (dev === 0) return `MOUSE ${id}`;
  if (dev === 2) return `JOY ${id}`;
  return names.get(id) ?? `KEY ${id.toString(16)}`;
}
