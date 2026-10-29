// WP-VERIFY M2 shell: the story FSM and the zone loop glue run natively in the x86 emulator as an ORACLE for src/shell/story.ts.
// Run from the user's executable: FUN_00404aa0 (node complete?), 00404be7 (zone of the node), 00404bb2 (advance), 00404b43 (rewind to the last hub), 00404af6 (step back),
// 00404c07 (jump to a node), 00423bad (the per-frame check of the hubs / mini-games), 00404d14 (mini-game exit), 004176c1 (variable class), 004177ed (zone locals),
// 0041ad43 (pending override), 0041adb5 (zone set-up: apply a load), 00419bb9 (load decision), 0041a8f9 (new game) and the zone loop FUN_00404dc9 itself. Hosted: the file
// calls (the sw.dat snapshot is a host copy: FUN_00417820 writes it, FUN_0041786a reads it back), the zone run functions (scripted), the loop's engine calls.
import { createCpu } from '../../src/formats/x86emu.ts';

export const HEAP_BASE = 0x20000000;
const CRT = [0x858d30, 0x873e00];
export const A = {
  VARS: 0x8a2d2c, SNAP: 0x983854, ZONES: 0x89a9c0, STORY: 0x89a758, PEND_NODE: 0x9d9c10, PEND_ZONE: 0x9d9c18, PEND_KIND: 0x9d9c19, SW_FIRST: 0x8a2d68, SW_BYTES: 0x370,
};

export class StoryEmu {
  constructor(pe) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = (this.mem = cpu.mem);
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    this.brk = HEAP_BASE;
    this.log = [];
    this.sw = new Uint8Array(A.SW_BYTES);
    this.zoneRuns = [];             // scripted: function(zone) -> next zone code
    this.runLog = [];
    this.files = new Map();
    this.handles = new Map();
    this.nextHandle = 0x1000;
    this.unhooked = new Map();
    this.loadBodies = 0;
    const L = this;
    const H = cpu.hooks;
    const nop = (c) => { c.eax = 0; };
    // the sw.dat snapshot: FUN_00417820 writes vars 15.. (0x370 bytes) out, FUN_0041786a reads them back and sets the start values (the decompile of both, hosted: the file layer is the shell's)
    H.set(0x417820, (c) => { L.sw = mem.read(A.SW_FIRST, A.SW_BYTES); L.log.push('sw-write'); c.eax = 0; });
    H.set(0x41786a, (c) => {
      mem.write(A.SW_FIRST, L.sw); L.log.push('sw-read');
      for (const [i, v] of [[0x4f, 0xb], [0xb0, 0xb], [0xb3, 0], [0xb4, 0], [0xb5, 1], [0x26, 0]]) mem.w32(A.VARS + 4 * i, v);   // FUN_00417597 sets (vars 1 / 2 are read-only: none of these)
      c.eax = 0;
    });
    // FUN_00404dc9's engine calls
    H.set(0x40a027, (c) => { c.eax = 1; });                // "wait for the display" loop
    for (const a of [0x85a410, 0x4426b0, 0x439126, 0x43406c, 0x45988b, 0x417990, 0x433efe, 0x873f74, 0x43ec80, 0x874186, 0x459820, 0x417956, 0x4340cd, 0x4359f3, 0x4395f7, 0x85a570, 0x85aa70]) H.set(a, nop);
    // the zone run functions: scripted
    for (let z = 0; z < 35; z++) {
      const fn = mem.u32(A.ZONES + z * 20);
      if (fn) H.set(fn, (c) => { z = mem.r32(A.VARS + 20); /* the island zones 2 / 31 / 32 / 33 share one run function: the loop has put the zone into var 5 */ L.runLog.push({ z, vars: L.vars(), pending: L.pending(), snap: L.snap(80) }); L.call(0x41adb5); const r = L.zoneRuns.length ? L.zoneRuns.shift()(z, L) : -2; c.eax = r; });   // every zone's set-up calls FUN_0041adb5 (applies a pending load)
    }
    H.set(0x419e82, (c) => { L.loadBodies++; L.log.push('load-body'); c.eax = 1; });     // the body reader (save.ts / m7-shell-save)
    H.set(0x421fa0, (c) => { L.log.push(`decor-reset ${c.arg(0)}`); c.eax = 0; });
    H.set(0x45c432, nop);
    H.set(0x85b1d0, (c) => {
      const name = mem.cstr(c.arg(0)); let mode = 'r'; try { mode = mem.cstr(c.arg(1)) || 'r'; } catch { /* mode argument */ }
      if (mode[0] === 'r' && !L.files.has(name)) { c.eax = 0; return; }
      const h = L.nextHandle++; L.handles.set(h, { name, pos: 0 }); c.eax = h;
    });
    H.set(0x85b9e0, (c) => {
      const f = L.handles.get(c.arg(3)), src = L.files.get(f.name) ?? new Uint8Array(0);
      const n = Math.min(c.arg(1) * c.arg(2), src.length - f.pos);
      mem.write(c.arg(0), src.subarray(f.pos, f.pos + n)); f.pos += n; c.eax = Math.floor(n / c.arg(1));
    });
    H.set(0x85af50, nop);
    H.set(0x85ac00, (c) => {
      const fmt = mem.cstr(c.arg(1)); let ai = 2, out = '';
      for (let i = 0; i < fmt.length; i++) {
        if (fmt[i] !== '%') { out += fmt[i]; continue; }
        i++; let pad = ''; while (fmt[i] >= '0' && fmt[i] <= '9') pad += fmt[i++];
        const v = c.arg(ai++);
        if (fmt[i] === 'd') out += String(v | 0).padStart(Number(pad) || 0, '0'); else if (fmt[i] === 's') out += mem.cstr(v); else throw new Error(`story-emu: sprintf ${fmt}`);
      }
      for (let i = 0; i < out.length; i++) mem.w8(c.arg(0) + i, out.charCodeAt(i));
      mem.w8(c.arg(0) + out.length, 0); c.eax = out.length;
    });
    cpu.exec = [[0x404a00, 0x404ee0], [0x417500, 0x417a00], [0x418e40, 0x418e7f], [0x419b9a, 0x419c45], [0x419c45, 0x419e82], [0x41a8f9, 0x41a939], [0x41ad43, 0x41ae00], [0x423bad, 0x423c00], [0x421b18, 0x421b90], CRT];
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  setVars(a) { for (let i = 0; i < 319; i++) this.mem.w32(A.VARS + 4 * i, a[i]); }
  vars() { return Int32Array.from({ length: 319 }, (_, i) => this.mem.r32(A.VARS + 4 * i)); }
  setSnap(a) { for (let i = 0; i < a.length; i++) this.mem.w32(A.SNAP + 4 * i, a[i]); }
  snap(n = 128) { return Int32Array.from({ length: n }, (_, i) => this.mem.r32(A.SNAP + 4 * i)); }
  call(fn, args = []) { return this.cpu.call(fn, args) | 0; }
  pending() { const m = this.mem; return { kind: m.r8(A.PEND_KIND), node: (m.r16(A.PEND_NODE) << 16) >> 16, zone: m.r8(A.PEND_ZONE) }; }
  setPending(p) { const m = this.mem; m.w8(A.PEND_KIND, p.kind); m.w16(A.PEND_NODE, p.node); m.w8(A.PEND_ZONE, p.zone); }
}
