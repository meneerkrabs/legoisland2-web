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
  // keys of the executable's name table (0x8aef28) that a browser reports: the DirectInput scancodes of the rest of a 105 / 109 key keyboard
  [0x64, 'F13'], [0x65, 'F14'], [0x66, 'F15'], [0x70, 'KanaMode'], [0x73, 'IntlRo'], [0x79, 'Convert'], [0x7b, 'NonConvert'], [0x7d, 'IntlYen'], [0x8d, 'NumpadEqual'],
  [0xb3, 'NumpadComma'], [0xb7, 'PrintScreen'], [0xc5, 'Pause'], [0xdb, 'MetaLeft'], [0xdc, 'MetaRight'], [0xdd, 'ContextMenu'],
  ...LETTERS.map(([d, l]): [number, string] => [d, `Key${l}`]),
  ...Array.from({ length: 10 }, (_, i): [number, string] => [0x02 + i, `Digit${(i + 1) % 10}`]),
  ...Array.from({ length: 10 }, (_, i): [number, string] => [0x3b + i, `F${i + 1}`]),
];

const byDik = new Map<number, string[]>();
const byCode = new Map<string, number>();
for (const [d, c] of MAP) { byDik.set(d, [...(byDik.get(d) ?? []), c]); byCode.set(c, d); }
// DirectInput gives the right-hand modifier keys and the numeric Enter their own scancodes (RCTRL 0x9d, RSHIFT 0x36, RALT 0xb8, NUM ENTER 0x9c): they are NOT the keys of the
// default bindings (LCTRL, LSHIFT, LALT, RETURN). The port lets them act as their left-hand twins (input.ts ALIASES, like WASD), but the key state, the cheat detector and the
// key capture use the exact scancodes.

/** browser key codes that produce this DIK (several for the modifier twins) */
export function dikToCodes(dik: number): string[] { return byDik.get(dik) ?? []; }
/** DIK of a browser key code, 0 = none */
export function codeToDik(code: string): number { return byCode.get(code) ?? 0; }

export const KEY_NAME_TABLE_VA = 0x8aef28;
/** name table of the executable: DIK -> upper-case name; the terminating entry (DIK -1) is stored under -1 (the name of every key the table does not know: `---`) */
export function readKeyNames(pe: Pe): Map<number, string> {
  const out = new Map<number, string>();
  for (let i = 0; i < 400; i++) {
    const dik = pe.u32(KEY_NAME_TABLE_VA + i * 8) | 0;
    const p = pe.u32(KEY_NAME_TABLE_VA + i * 8 + 4);
    if (dik === -1) { if (p) out.set(-1, pe.cstr(p, 32)); break; }
    if (p) out.set(dik, pe.cstr(p, 32));
  }
  return out;
}

/**
 * FUN_00438212 (run once, at the first key name lookup, DAT_008af6f0): the key names that depend on the keyboard layout of the game's language are replaced from one of nine tables,
 * chosen by the text of the message `FEERASE` (case-insensitive compare, the last match wins; no match = the table at 0x8af3b0, the French one: that is what an English game gets).
 * Entries are {DIK, name} pairs ended by -1; every DIK of the table replaces the name of the same DIK in the main table (`names`, from `readKeyNames`).
 */
const LAYOUT_TABLES: [number, number][] = [   // [VA of the word to compare with, VA of the table]
  [0x8b0ff0, 0x8af5e8], [0x8b0ff8, 0x8af498], [0x8b1000, 0x8af3b0], [0x8b100c, 0x8af430], [0x8b1014, 0x8af538], [0x8b101c, 0x8af590], [0x8b1024, 0x8af698], [0x8b102c, 0x8af4f0],
  [0x8b1034, 0x8af640],
];
export function localiseKeyNames(pe: Pe, names: Map<number, string>, feErase: string) {
  let table = 0x8af3b0;
  const f = feErase.toLowerCase();
  for (const [wordVa, tableVa] of LAYOUT_TABLES) if (pe.cstr(wordVa, 16).toLowerCase() === f) table = tableVa;
  for (let i = 0; i < 100; i++) {
    const dik = pe.u32(table + i * 8) | 0;
    if (dik === -1) break;
    const p = pe.u32(table + i * 8 + 4);
    if (p && names.has(dik)) names.set(dik, pe.cstr(p, 32));
  }
}

/**
 * FUN_0043839f: the label of a key code ((device << 16) | id) exactly as the original builds it: `MOUSE%d` (device 0), `!<name>` for the keyboard (the table name; an id the table
 * does not know gets the name of its terminating entry, `---`), `JOY:%d` (device 2), and for every other device the terminating entry's name too. The `!` makes the menu text
 * resolver (FUN_0041c270) look the name up as a message id (`UP` -> OMHOOG, `SPACE` -> SPATIE ...); a name that is no message id is shown as it is.
 */
export function keyCodeLabel(code: number, names: Map<number, string>): string {
  const dev = code >>> 16, id = code & 0xffff;
  if (dev === 0) return `MOUSE${id}`;
  if (dev === 2) return `JOY:${id}`;
  if (dev === 1) { const n = names.get(id); if (n !== undefined) return `!${n}`; }
  return `!${names.get(-1) ?? '---'}`;
}
/** the key name as the help screen shows it (FUN_00460f31 returns FUN_004384c9(bit) + 1: the first character of the label is skipped, the `!` of a keyboard name but also the `M` of `MOUSE2` / the `J` of `JOY:3`) */
export function keyCodeName(code: number, names: Map<number, string>): string { return keyCodeLabel(code, names).slice(1); }
