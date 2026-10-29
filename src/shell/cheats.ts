// The cheat-code detector of the input code (FUN_004375a8, called by the input poll FUN_004376f9 every frame in every zone): the typed key sequences are table rows of the
// executable (6 rows of 16 key codes at 0x8aed70, 0x40 bytes each, a row ends at the first 0; the "armed" flags at 0x8aeef0). It is polled once per tick with FUN_00437fdf's result
// (the lowest button that is down: a mouse button 0..7, else `0x10000 | DIK`, else `0x20000 | pad button`; `InputMapper.anyCode`), acts when that value changes, and so sees exactly
// the original's quirks (the keys of a sequence must be pressed one after the other; two keys down: the lowest scancode counts; mouse / pad buttons break a sequence).
// The rows (FUN_00437515 dispatches on the row index):
//   0 PEPPERONI    windowed mode only (FUN_0041b357: DAT_008a933c = 6; nothing in the executable reads it)       -> debug only here
//   1 FSMADVANCE   windowed mode only (FUN_00404c07(var 0x58 + 1): the story moves one node on)                 -> debug only here
//   2 RHUNRHEGED   FUN_00438cb0(0, "SDPad.cpp", 0x2f7, "You found something better than EQ?"): the error dialog "Error in Game"; every button but "Debug" ends the program (exit(0)),
//                  "Debug" executes int 3 (a crash without a debugger)
//   3 BAATAT       DAT_009da5b4 = 1 and FUN_00420674(-1): the building / decor era table for story nodes >= 0x40 uses era 4 instead of 3 (FUN_00420674: `era = node >= 0x40 ? (DAT_009da5b4 ? 4 : 3)`)
//   4 SDREAMS      FUN_00417597(0xd, 1): game variable 0xd = 1, which makes the island's wormhole WORM lead to the developers' cave z50LTC (docs/re/m5/audit-rooms.md)
//   5 DAFFODILE    no handler
// The first two rows are only scanned in windowed mode (the loop starts at row 2 when the exclusive / full-screen flag DAT_009dab70 is set: the retail default); the port treats
// the debug option (`?debug=1`, src/game/debug.ts) as the windowed mode.
import type { Pe } from '../formats/exe.ts';
import { debugAids } from '../game/debug.ts';

export const CHEAT_TABLE_VA = 0x8aed70, CHEAT_ARMED_VA = 0x8aeef0, CHEAT_ROWS = 6, CHEAT_ROW_BYTES = 0x40;
export const CHEAT_PEPPERONI_ROW = 0, CHEAT_FSMADVANCE_ROW = 1, CHEAT_RHUNRHEGED_ROW = 2, CHEAT_BAATAT_ROW = 3, CHEAT_SDREAMS_ROW = 4, CHEAT_DAFFODILE_ROW = 5;
export const VAR_SDREAMS = 0xd;

/** the session state the cheat handlers write (the original's globals) */
export const cheatState = {
  /** DAT_009da5b4 (BAATAT): FUN_00420674 picks era 4 instead of era 3 of the decor tables for story nodes >= 0x40 (read by the island's decor set-up) */
  baatat: false,
  /** DAT_008a933c (PEPPERONI, windowed mode only): written, never read by the executable */
  pepperoni: 0,
};

export class CheatDetector {
  /** DAT_009db008: the key code of the previous poll (0 = none) */
  last = 0;
  /** DAT_009db004: how many keys of the sequences were matched */
  pos = 0;
  /** DAT_008aeef0..: a row that has missed a key is off until the sequences reset */
  armed: number[];
  private rows: number[][];
  /** the first row the scan starts at (2 in full-screen mode, 0 in windowed mode) */
  firstRow: number;
  /** rows that were completed (the ones the port acts on call `onCheat`) */
  onCheat: (row: number) => void = () => {};
  constructor(pe: Pe, firstRow = 2) {
    this.firstRow = firstRow;
    this.rows = Array.from({ length: CHEAT_ROWS }, (_, r) => Array.from({ length: CHEAT_ROW_BYTES / 4 }, (_, k) => pe.u32(CHEAT_TABLE_VA + r * CHEAT_ROW_BYTES + k * 4)));
    this.armed = Array.from({ length: CHEAT_ROWS }, (_, r) => pe.u32(CHEAT_ARMED_VA + 4 * r));
  }
  /** FUN_004375a8 for one poll: `code` = FUN_00437fdf's result (0 = nothing down; keyboard: `0x10000 | DIK` of the lowest key that is down) */
  poll(code: number) {
    if (this.last === code) return;
    this.last = code;
    if (code === 0) return;
    let alive = false;
    for (let r = this.firstRow; r < CHEAT_ROWS; r++) {
      if (this.armed[r] === 0) continue;
      if (((this.rows[r][this.pos] | 0x10000) >>> 0) === code) {
        if (this.rows[r][this.pos + 1] === 0) {
          this.onCheat(r);
          this.armed.fill(1);
          this.pos = 0;
          return;
        }
        alive = true;
      } else this.armed[r] = 0;
    }
    if (alive) this.pos++;
    else { this.armed.fill(1); this.pos = 0; }
  }
}

/** what the rows do in the port (FUN_00437515): SDREAMS, BAATAT and RHUNRHEGED always, PEPPERONI / FSMADVANCE only while they are scanned (debug) */
export interface CheatHandlers {
  /** SDREAMS: FUN_00417597(0xd, 1) */
  sdreams(): void;
  /** FSMADVANCE: FUN_00404c07(var 0x58 + 1) */
  fsmAdvance?(): void;
  /** RHUNRHEGED: the error dialog's exit(0) (default: reload the page, the browser's way to end the program) */
  exit?(): void;
}

/** the error dialog of FUN_00438cb0(0, ...): "Error in Game", the file / line / message the assert gives; any button ends the program ("Debug" = int 3, a crash) */
export function showErrorDialog(pe: Pe, exit: () => void) {
  if (typeof document === 'undefined') { exit(); return; }
  const file = pe.cstr(0x8b0f60, 120), msg = pe.cstr(0x8b0f3c, 120), title = pe.cstr(0x8b117c, 40);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:13px Tahoma,Arial,sans-serif;color:#000';
  const box = document.createElement('div');
  box.style.cssText = 'background:#ece9d8;border:2px outset #fff;min-width:420px;max-width:80vw;box-shadow:4px 4px 12px rgba(0,0,0,.5)';
  const bar = document.createElement('div');
  bar.textContent = title;
  bar.style.cssText = 'background:#0a246a;color:#fff;padding:3px 6px;font-weight:bold';
  const body = document.createElement('div');
  body.style.cssText = 'padding:10px 14px;line-height:1.5';
  const row = (k: string, v: string) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = k + ' '; d.append(b, document.createTextNode(v)); return d; };
  body.append(row('Error Message', ''), row('File:', file), row('Line:', String(0x2f7)), row('Message:', msg));
  const buttons = document.createElement('div');
  buttons.style.cssText = 'padding:8px 14px 12px;display:flex;gap:8px;justify-content:flex-end';
  const done = () => { wrap.remove(); exit(); };
  const mk = (t: string) => { const b = document.createElement('button'); b.textContent = t; b.style.cssText = 'min-width:80px;padding:3px 8px'; b.onclick = done; return b; };
  const cont = mk('Continue');
  buttons.append(cont, mk('Debug'), mk('Quit'));
  box.append(bar, body, buttons);
  wrap.append(box);
  wrap.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(wrap);
  cont.focus();
}

/** polls the detector from the input mapper (once per tick, FUN_004376f9) and wires the rows to their handlers */
export function installCheats(pe: Pe, input: { cheats: { poll(code: number): void } | null }, handlers: CheatHandlers): { detector: CheatDetector; detach(): void } {
  const detector = new CheatDetector(pe, debugAids() ? 0 : 2);
  detector.onCheat = (row) => {
    switch (row) {
      case CHEAT_PEPPERONI_ROW: cheatState.pepperoni = 6; break;
      case CHEAT_FSMADVANCE_ROW: handlers.fsmAdvance?.(); break;
      case CHEAT_RHUNRHEGED_ROW: showErrorDialog(pe, handlers.exit ?? (() => { if (typeof location !== 'undefined') location.reload(); })); break;
      case CHEAT_BAATAT_ROW: cheatState.baatat = true; break;
      case CHEAT_SDREAMS_ROW: handlers.sdreams(); break;
      default: break;   // DAFFODILE: no handler
    }
  };
  input.cheats = detector;
  return { detector, detach() { if (input.cheats === detector) input.cheats = null; } };
}
