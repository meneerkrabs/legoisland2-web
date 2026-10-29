// WP-VERIFY M2 shell: the original's menu engine run natively in the x86 emulator (src/formats/x86emu.ts) as an ORACLE for src/shell/menu.ts / menuui.ts.
// Run from the user's executable: the engine step FUN_0041fd45 (+ the page / list renderer FUN_0041d765 whose first half runs the page set-up functions, the per-page input
// FUN_0041fa84, the cursor keys FUN_0041f695, the mouse FUN_0041f181, the key capture FUN_0041f966), the page set-up functions 0x41ae6e .. 0x41b274, the event handler FUN_0041b500
// and the three wrappers FUN_0041bd3d / FUN_0041be4e / FUN_0041c092, the save-slot cache FUN_0041a9bf. The engine state is the int array at 0x8a9590 (docs/re/shell-m2.md), the page
// table is the exe's own .data (0x8a9338). Hosted: the sound calls (logged), the drawing and text functions (no-ops), the mouse (never moves), the message tables (an id is its own
// text), the file calls (the save slots), the game variables are the exe's own array 0x8a2d2c (FUN_00417575 / FUN_00417597 run natively). Nothing of the executable is stored here.
import { createCpu } from '../../src/formats/x86emu.ts';

export const HEAP_BASE = 0x20000000;
const CRT = [0x858d30, 0x873e00];
export const A = {
  CTX: 0x8a9590, OPEN: 0x8a95ac, W: 0x8a9920, H: 0x8a9924, KEYS: 0x983840, LIST: 0x9d9c38, LISTFLAGS: 0x9d9f98, PAGES: 0x8a9338, PAGE_COUNT: 30, ITEM: 0x4c,
  CAP_DOWN: 0x9d9fc0, CAP_KEY: 0x9d9fc4, CONFIRM_VALUE: 0x9d9fc8, VARS: 0x8a2d2c, CACHE_FLAG: 0x9d9c1a, OPTIONS: 0x9833f0,
};

export class MenuEmu {
  constructor(pe) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = (this.mem = cpu.mem);
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    this.brk = HEAP_BASE;
    this.sounds = [];
    this.files = new Map();
    this.handles = new Map();
    this.nextHandle = 0x1000;
    this.cutscene = 0;               // FUN_0045c432
    this.poll = 0;                   // FUN_00438099: the key it reports
    this.unhooked = new Map();
    this.draws = 0;
    this.stack = [];                 // log of the wrappers' side effects (var writes)
    const L = this;
    const H = cpu.hooks;
    const nop = (c) => { c.eax = 0; };
    H.set(0x45c432, (c) => { c.eax = L.cutscene; });
    H.set(0x4435a0, (c) => { L.sounds.push(c.arg(0)); c.eax = 0; });      // FUN_004435a0(sound id)
    H.set(0x435a5e, nop);                                                   // speech / movie timer pump
    H.set(0x439f51, nop);                                                   // text queue flush
    for (const a of [0x442d60, 0x442d50, 0x41c478, 0x41c51f, 0x41c5c6, 0x41c670, 0x41c71b, 0x41c7cd, 0x41cbac, 0x43a091, 0x43839f, 0x41c3f6]) H.set(a, (c) => { L.draws++; c.eax = 0; });
    H.set(0x41c270, (c) => { c.eax = c.arg(0); });                          // label resolve: an id is its own text
    H.set(0x43a05b, nop);                                                   // text width
    H.set(0x439788, (c) => { c.eax = c.arg(1); });                          // message lookup: the id
    H.set(0x4396a0, (c) => { c.eax = c.arg(1); });
    H.set(0x437ca5, (c) => { const p = c.arg(0); mem.w32(p, 0); mem.w32(p + 4, 0); mem.w32(p + 8, 0); c.eax = 0; });    // mouse: no movement, no button
    H.set(0x438099, (c) => { c.eax = L.poll; });                            // key capture poll
    H.set(0x4066b9, (c) => { c.eax = 5; });                                 // resolution lists (device dependent)
    H.set(0x406715, (c) => { c.eax = 7; });
    H.set(0x85ac00, (c) => {                                                // sprintf (the formats of the menu code)
      const fmt = mem.cstr(c.arg(1));
      let ai = 2, out = '';
      for (let i = 0; i < fmt.length; i++) {
        if (fmt[i] !== '%') { out += fmt[i]; continue; }
        i++;
        let pad = '';
        while (fmt[i] >= '0' && fmt[i] <= '9') pad += fmt[i++];
        const v = c.arg(ai++);
        if (fmt[i] === 'd') out += String(v | 0).padStart(Number(pad) || 0, '0');
        else if (fmt[i] === 's') out += mem.cstr(v);
        else throw new Error(`menu-emu: sprintf format ${fmt}`);
      }
      for (let i = 0; i < out.length; i++) mem.w8(c.arg(0) + i, out.charCodeAt(i));
      mem.w8(c.arg(0) + out.length, 0);
      c.eax = out.length;
    });
    H.set(0x85b1d0, (c) => {                                                // fopen(name, mode)
      const name = mem.cstr(c.arg(0)); let mode = 'r'; try { mode = mem.cstr(c.arg(1)) || 'r'; } catch { /* the mode argument is not always a string pointer in the callers' decompile */ }
      if (mode[0] === 'r' && !L.files.has(name)) { c.eax = 0; return; }
      const h = L.nextHandle++; L.handles.set(h, { name, pos: 0 }); c.eax = h;
    });
    H.set(0x85b9e0, (c) => {                                                // fread(buf, size, count, file)
      const f = L.handles.get(c.arg(3));
      const src = L.files.get(f.name) ?? new Uint8Array(0);
      const n = Math.min(c.arg(1) * c.arg(2), src.length - f.pos);
      mem.write(c.arg(0), src.subarray(f.pos, f.pos + n)); f.pos += n; c.eax = Math.floor(n / c.arg(1));
    });
    H.set(0x85af50, (c) => { L.handles.delete(c.arg(0)); c.eax = 0; });
    // the wrappers' calls into the game (logged): story jumps, new game, slot functions are the original's own natively unless listed here
    H.set(0x40410f, (c) => { L.stack.push('save-settings'); c.eax = 0; });  // keys page leave (apply keys)
    H.set(0x437f6e, (c) => { L.stack.push('restore-keys'); c.eax = 0; });  // keys page leave (restore)
    H.set(0x40cf18, (c) => { L.stack.push(`FUN_0040cf18 ${c.arg(0)}`); c.eax = 0; });
    H.set(0x409792, (c) => { L.stack.push('FUN_00409792'); c.eax = 0; });
    H.set(0x443350, (c) => { L.stack.push(`music ${c.arg(0)}`); c.eax = 0; });
    H.set(0x4431d0, (c) => { L.stack.push(`sfx ${c.arg(0)}`); c.eax = 0; });
    H.set(0x435a11, (c) => { L.stack.push(`speech ${c.arg(0)} ${c.arg(1)}`); c.eax = 0; });
    H.set(0x4068ad, (c) => { L.stack.push(`FUN_004068ad ${c.arg(0)} ${c.arg(1)}`); c.eax = 0; });
    H.set(0x435c50, nop);
    H.set(0x41786a, (c) => { L.stack.push('newgame-defaults'); c.eax = 0; });
    H.set(0x421bbe, (c) => { L.stack.push('load-applied'); c.eax = 0; });
    H.set(0x404c07, (c) => { L.stack.push(`FUN_00404c07 ${c.arg(0) | 0}`); c.eax = 0; });
    H.set(0x4b0240, nop);
    // the slot functions the handler calls (their effects are the shell's business, compared by call): scripted results
    this.slotLog = [];
    this.saveRet = 1; this.loadRet = 1; this.newRet = 1;
    H.set(0x41a939, (c) => { L.slotLog.push(`save ${c.arg(0) | 0}`); c.eax = L.saveRet; });
    H.set(0x419bb9, (c) => { L.slotLog.push(`load ${c.arg(0) | 0}`); c.eax = L.loadRet; });
    H.set(0x41a968, (c) => { L.slotLog.push(`erase ${c.arg(0) | 0}`); c.eax = 0; });
    H.set(0x41a8f9, (c) => { L.slotLog.push('newgame'); c.eax = L.newRet; });
    cpu.exec = [[0x404000, 0x404100], [0x417500, 0x417a00], [0x418e00, 0x418ec7], [0x41a900, 0x41ac00], [0x41ac00, 0x41c270], [0x41d765, 0x41d7c0], [0x41d7c0, 0x41f160], [0x41f181, 0x420200], [0x437e72, 0x437e80], [0x437e82, 0x437f6e], [0x4b02d4, 0x4b0340], [0x419b9a, 0x419bb9], [0x419bb9, 0x419c45], [0x419c45, 0x419e82], CRT];
    // the page table region is big; every function the engine reaches is in [0x41f181, 0x420200] (engine) or listed above; unknown targets are logged
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
    // screen 640x480 (the layout arithmetic of the page renderer and the mouse code divides by these)
    mem.w32(A.W, 640); mem.w32(A.H, 480);
    // the mouse cursor starts at a fixed place and never moves (DAT_008a9a24 / 28, last position 2c / 30)
    mem.w32(0x8a9a24, 0); mem.w32(0x8a9a28, 0); mem.w32(0x8a9a2c, 0); mem.w32(0x8a9a30, 0);
    mem.w32(0x9dafe8, 0);
    this.out = this.alloc(16);
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }

  /** the save slot files for FUN_0041a9bf (name -> bytes) */
  setSlots(files) { this.files = new Map(files); this.mem.w8(A.CACHE_FLAG, 0); }
  setVar(i, v) { this.mem.w32(A.VARS + 4 * i, v); }
  getVar(i) { return this.mem.r32(A.VARS + 4 * i); }

  /** open like FUN_0041bd3d / FUN_0041be4e / FUN_0041c092 do: page, item 1, depth 0, counters 0, [8] = 0x14 */
  open(page) {
    const m = this.mem;
    m.w32(A.CTX, page); m.w32(A.CTX + 4, 1); m.w32(A.CTX + 8, 0); m.w32(A.CTX + 12, 0); m.w32(A.CTX + 16, 0); m.w32(A.CTX + 20, 0); m.w32(A.CTX + 24, 0); m.w32(A.CTX + 32, 0x14);
    m.w32(A.OPEN, 0);
    m.w32(A.CAP_DOWN, 0); m.w32(A.CAP_KEY, 0);
  }
  /** FUN_0041d765 alone: runs the set-up functions of the current page (patching its items) and fills the list entries */
  prepare(mask) { this.cpu.call(0x41d765, [A.CTX, (mask | 0x20) >>> 0]); }
  /** one engine step: FUN_0041fd45(ctx, &b, &a, mask) with `pressed` as the pressed-this-frame mask; returns { ev, a, b } (a / b = null when the original did not write them) */
  step(pressed, mask) {
    const m = this.mem;
    m.w32(A.KEYS, pressed >>> 0);
    const pb = this.out, pa = this.out + 4;
    m.w32(pb, 0xdead0001); m.w32(pa, 0xdead0002);
    this.sounds = [];
    const ev = this.cpu.call(0x41fd45, [A.CTX, pb, pa, mask >>> 0]) | 0;
    const b = m.u32(pb), a = m.u32(pa);
    return { ev, a: a === 0xdead0002 ? null : a | 0, b: b === 0xdead0001 ? null : b | 0, sounds: this.sounds.slice() };
  }
  /** a wrapper tick: kind 'front' FUN_0041be4e(0, mask), 'pause' FUN_0041bd3d(&saved, mask, kind), 'result' FUN_0041c092(&saved, mask, kind); the first call after a close only opens the menu */
  wrapper(which, mask, kind, pressed) {
    this.mem.w32(A.KEYS, pressed >>> 0);
    this.stack = []; this.slotLog = []; this.sounds = [];
    const saved = this.out + 8;
    if (which === 'front') return this.cpu.call(0x41be4e, [0, mask >>> 0]) | 0;
    return this.cpu.call(which === 'pause' ? 0x41bd3d : 0x41c092, [saved, mask >>> 0, kind]) | 0;
  }
  close() { this.mem.w32(A.OPEN, 0xffffffff); }
  /** FUN_0041b500(ev, b, a): the event handler of the wrappers; returns its result code */
  handle(ev, a, b) { this.stack = []; this.slotLog = []; return this.cpu.call(0x41b500, [ev >>> 0, b >>> 0, a >>> 0]) | 0; }
  options() { return Array.from({ length: 0x17 }, (_, i) => this.mem.r32(A.OPTIONS + 4 * i)); }
  setOptions(a) { a.forEach((v, i) => this.mem.w32(A.OPTIONS + 4 * i, v)); }
  vars() { return Int32Array.from({ length: 319 }, (_, i) => this.mem.r32(A.VARS + 4 * i)); }
  /** the engine state words [0..8] and the page stack */
  state() {
    const m = this.mem;
    const s = Array.from({ length: 9 }, (_, i) => m.r32(A.CTX + 4 * i));
    const depth = s[2];
    const stack = [];
    for (let k = 0; k < depth; k++) stack.push({ page: m.r32(A.CTX + 4 * (9 + 2 * k)), item: m.r32(A.CTX + 4 * (10 + 2 * k)) });
    return { page: s[0], item: s[1], depth, press: s[3], pressKind: s[4], capture: s[5], scroll: s[6], confirm: s[8] | 0, stack };
  }
  /** an item of a page: label (string), type, value, disable */
  item(page, i) {
    const m = this.mem;
    const items = m.u32(A.PAGES + page * 0x14 + 8);
    const a = items + i * A.ITEM;
    return { label: m.cstr(a, 0x40), type: m.r32(a + 0x40), value: m.r32(a + 0x44), disable: m.u32(a + 0x48) };
  }
  pageInfo(page) {
    const m = this.mem, p = A.PAGES + page * 0x14;
    return { kind: m.r32(p), nitems: m.r32(p + 4), setup: m.u32(p + 12), type: m.r32(p + 16) };
  }
  /** the 8 list entries and their set-up results (FUN_0041d765 fills them each step) */
  list() {
    const m = this.mem;
    return Array.from({ length: 8 }, (_, i) => {
      const a = A.LIST + i * A.ITEM;
      return { r: m.r32(A.LISTFLAGS + 4 * i), label: m.cstr(a, 0x40), type: m.r32(a + 0x40), value: m.r32(a + 0x44), disable: m.u32(a + 0x48) };
    });
  }
  /** run one page set-up function natively as the page renderer does: (ctx, itemPtr, index, listIndex) */
  callSetup(fn, itemPtr, idx, listIdx) { return this.cpu.call(fn, [A.CTX, itemPtr, idx >>> 0, listIdx >>> 0]) | 0; }
  /** a scratch item copy at a fresh address from a JS item { label, type, value, disable } */
  scratch(it) {
    const m = this.mem, p = this.alloc(A.ITEM);
    for (let i = 0; i < 0x40; i++) m.w8(p + i, i < it.label.length ? it.label.charCodeAt(i) : 0);
    m.w32(p + 0x40, it.type); m.w32(p + 0x44, it.value); m.w32(p + 0x48, it.disable);
    return p;
  }
}

/** a seeded generator */
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };
  return {
    u32: next, int: (n) => Math.floor((next() / 4294967296) * n), chance: (p) => next() / 4294967296 < p,
    pick: (a) => a[Math.floor((next() / 4294967296) * a.length)],
  };
}
