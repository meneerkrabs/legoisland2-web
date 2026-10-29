// WP-VERIFY M2 shell: the original's help / intro panel and key-label code run natively in the x86 emulator as an ORACLE for src/shell/helpscreen.ts and src/shell/dik.ts.
// Run from the user's executable: the panel FUN_00460a66, the controls help FUN_00461175, the CONTROLn line parser FUN_00460f31, the tile helpers FUN_00460720 / 00460868 / 004607c4 /
// 00460917 (their coordinate arithmetic), the key label FUN_004384c9 -> FUN_0043839f with the layout renames FUN_00438212. Hosted: the sprite / text primitives (recorded:
// FUN_0043c267, 0043a091 / 0043a25c / 0043a167), the text width, the message lookups (FUN_004396a0, FUN_00439788: scripted tables) and sprintf.
import { createCpu } from '../../src/formats/x86emu.ts';

export const HEAP_BASE = 0x20000000;
const CRT = [0x858d30, 0x873e00];
export const KEYTAB = 0x8aeb20;
export const FONT_MAIN = 0x1111, FONT_MENU = 0x2222;

export class HelpEmu {
  constructor(pe) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = (this.mem = cpu.mem);
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x100000, name: 'heap' });
    this.brk = HEAP_BASE;
    this.rec = [];                 // recorded draw calls
    this.tables = new Map();       // token -> (id) => text | null
    this.menuToken = 0x7777;
    this.feErase = 'ERASE';        // FUN_00439788(DAT_009d9c2c, "FEERASE")
    this.unhooked = new Map();
    const L = this;
    const H = cpu.hooks;
    const str = (s) => { const p = L.alloc(s.length + 2); for (let i = 0; i < s.length; i++) mem.w8(p + i, s.charCodeAt(i)); mem.w8(p + s.length, 0); return p; };
    this.str = str;
    H.set(0x43c267, (c) => {                                     // FUN_0043c267(&rect, argb, &{set, tex}): a sprite
      const r = c.arg(0), q = c.arg(2);
      L.rec.push({ k: 'sprite', tex: mem.u32(q + 4), rect: [mem.r32(r), mem.r32(r + 4), mem.r32(r + 8), mem.r32(r + 12)], argb: c.arg(1) >>> 0 });
      c.eax = 0;
    });
    for (const [a, align] of [[0x43a091, 'centre'], [0x43a25c, 'left'], [0x43a167, 'right']]) {
      H.set(a, (c) => { L.rec.push({ k: 'text', font: c.arg(0), colour: c.arg(2) >>> 0, s: mem.cstr(c.arg(3), 400), x: c.arg(4) | 0, y: c.arg(5) | 0, align, a2: c.arg(1) }); c.eax = 0; });
    }
    H.set(0x43a05b, (c) => { c.eax = 14 * mem.cstr(c.arg(0), 400).length; });                       // text width: 14 px per character (the stub of the port's test)
    H.set(0x41c270, (c) => { c.eax = c.arg(0); });                                                   // "!PRESS" / "!FECONTRL" stay as they are
    H.set(0x4396a0, (c) => {                                                                          // FUN_004396a0(table, id): the text, or the id itself
      const id = mem.cstr(c.arg(1)), t = c.arg(0) === L.menuToken ? L.menuText(id) : L.tables.get(c.arg(0))?.(id);
      c.eax = str(t ?? id);
    });
    H.set(0x439788, (c) => { c.eax = str(mem.cstr(c.arg(1)) === 'FEERASE' ? L.feErase : mem.cstr(c.arg(1))); });
    H.set(0x85ac00, (c) => {                                                                          // sprintf(dest, fmt, ...)
      const fmt = mem.cstr(c.arg(1));
      let ai = 2, out = '';
      for (let i = 0; i < fmt.length; i++) {
        if (fmt[i] !== '%') { out += fmt[i]; continue; }
        i++; let pad = ''; while (fmt[i] >= '0' && fmt[i] <= '9') pad += fmt[i++];
        const v = c.arg(ai++);
        if (fmt[i] === 'd' || fmt[i] === 'i') out += String(v | 0).padStart(Number(pad) || 0, '0'); else if (fmt[i] === 's') out += mem.cstr(v); else throw new Error(`help-emu: sprintf ${fmt}`);
      }
      for (let i = 0; i < out.length; i++) mem.w8(c.arg(0) + i, out.charCodeAt(i));
      mem.w8(c.arg(0) + out.length, 0); c.eax = out.length;
    });
    cpu.exec = [[0x460720, 0x460a3d], [0x460a66, 0x460f31], [0x460f31, 0x461155], [0x461175, 0x461347], [0x438212, 0x4384e5], [0x890300, 0x8905c0], CRT];       // 0x890340 is _strcmp
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
    mem.w32(0x8a9920, 640); mem.w32(0x8a9924, 480);
    mem.w32(0x8a95f8, FONT_MAIN); mem.w32(0x8a95fc, FONT_MENU); mem.w32(0x8a9600, L.menuToken); mem.w32(0x8a9604, 0x5555);   // DAT_008a9604 = the tile set
    // FUN_00461175 reads the engine context at 0x8a9590: [0x1c] = the menu text table, [0x1d] = the font of the key caps
    mem.w32(0x8a9590 + 4 * 0x1c, L.menuToken); mem.w32(0x8a9590 + 4 * 0x1d, 0x6666);
    this.menuText = () => null;
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  token(fn) { const t = 0x1000 + this.tables.size; this.tables.set(t, fn); return t; }
  setKeys(codes) { codes.forEach((v, i) => { this.mem.w32(KEYTAB + i * 0x30 + 4, v); }); }
  /** the 13 logical bits of the key table (+8) */
  bits() { return Array.from({ length: 13 }, (_, i) => this.mem.u32(KEYTAB + i * 0x30 + 8)); }
  draw(fn, args) { this.rec = []; this.cpu.call(fn, args); return this.rec; }
}
