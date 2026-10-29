// The loading card FUN_0040d1be (+ FUN_0043ec80, the fade setter) run natively in the x86 interpreter as an ORACLE for src/ui/loadingcard.ts (tools/tests/m8-shell-loadcard.mjs).
// The Direct3D device is a fake object whose vtable entries are host functions (SetTexture +0x8c, DrawPrimitiveUP +0x64, Get / SetRenderState +0x54 / +0x50); every draw call, texture,
// state block (FUN_004090a7) and text call (FUN_00439c6f) is recorded. The matrix helpers, the CRT (`__ftol`, strcpy) and the function itself execute from the user's executable.
import { createCpu } from '../../src/formats/x86emu.ts';

export const HEAP_BASE = 0x20000000;
const CRT = [0x858d30, 0x873e00];
/** the loading context (ctx = 0x987880) and the viewport (DAT_00983a50 .. 5c) */
export const CTX = 0x987880, VP = 0x983a50, DEV = 0x983a38, LAST_TICK = 0x987770, DRAWS = 0x987bac;
export const TEX = { pizza: 0x1111, cd: 0x2222, loading: 0x3333 };

export class LoadCardEmu {
  constructor(pe) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = (this.mem = cpu.mem);
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x100000, name: 'heap' });
    this.brk = HEAP_BASE;
    this.tick = 0;
    this.rec = [];
    this.unhooked = new Map();
    const L = this, H = cpu.hooks;
    const str = (s) => { const p = L.alloc(s.length + 2); for (let i = 0; i < s.length; i++) mem.w8(p + i, s.charCodeAt(i)); mem.w8(p + s.length, 0); return p; };
    // the device: an object whose first word points at the vtable
    const dev = this.alloc(16), vt = this.alloc(0x200);
    mem.w32(dev, vt); mem.w32(DEV, dev);
    // the vtable entries point at stubs in the heap (the decoder reads the target's bytes before it looks for a host function)
    const stubs = this.alloc(0x100);
    for (let i = 0; i < 0x100; i++) mem.w8(stubs + i, 0xc3);
    const slot = (off, addr, fn) => { addr = stubs + (addr & 0xff); mem.w32(vt + off, addr); H.set(addr, fn); };
    slot(0x8c, 0x7f000008, (c) => { L.rec.push({ k: 'texture', stage: c.arg(1), tex: c.arg(2) }); c.eax = 0; });
    slot(0x64, 0x7f000010, (c) => {
      const p = c.arg(3), n = c.arg(4), verts = [];
      for (let i = 0; i < n; i++) { const b = p + 28 * i; verts.push({ x: mem.f32(b), y: mem.f32(b + 4), z: mem.f32(b + 8), rhw: mem.f32(b + 12), colour: mem.u32(b + 16), u: mem.f32(b + 20), v: mem.f32(b + 24) }); }
      L.rec.push({ k: 'draw', prim: c.arg(1), fvf: c.arg(2), count: n, flags: c.arg(5), verts }); c.eax = 0;
    });
    slot(0x54, 0x7f000018, (c) => { mem.w32(c.arg(2), 0x77); L.rec.push({ k: 'getstate', state: c.arg(1) }); c.eax = 0; });
    slot(0x50, 0x7f000020, (c) => { L.rec.push({ k: 'setstate', state: c.arg(1), value: c.arg(2) }); c.eax = 0; });
    const nop = (c) => { c.eax = 0; };
    // fog / z-enable / render-state helpers, the error check, the texture loader, the font scale
    for (const a of [0x4095a1, 0x40ccce, 0x40cfb5, 0x413fbd, 0x4395f7, 0x4100a1, 0x409563, 0x40cc4d]) H.set(a, nop);
    H.set(0x439126, (c) => { c.eax = 0x1000; });                                  // FUN_00439126(path): the message table
    H.set(0x439788, (c) => { c.eax = str(mem.cstr(c.arg(1)) === 'INSERTCD' ? 'INSERT CD' : 'LOADING'); });   // FUN_00439788(table, id)
    H.set(0x4090a7, (c) => { L.rec.push({ k: 'block', block: c.arg(0) }); c.eax = 0; });          // FUN_004090a7(block) (thiscall)
    // FUN_00439c6f uses the low 16 bits of x and y only (`and eax, 0xffff`): the card pushes `mov dx, [0x98766c]; push edx` with a garbage high word
    H.set(0x439c6f, (c) => { L.rec.push({ k: 'text', table: c.arg(0), font: c.arg(1), text: mem.cstr(c.arg(2)), flag: c.arg(3), colour: c.arg(4), x: c.arg(5) & 0xffff, y: c.arg(6) & 0xffff, maxChars: c.arg(7) }); c.eax = 0; });
    H.set(0x439f51, (c) => { L.rec.push({ k: 'flush' }); c.eax = 0; });
    // GetTickCount: the IAT slot at 0x5df14bc holds the address of the import
    const gtc = mem.u32(0x5df14bc);
    H.set(gtc, (c) => { c.eax = L.tick >>> 0; return 0; });
    this.gtcAddr = gtc;
    cpu.exec = [[0x40d02f, 0x40d0a1], [0x40d1be, 0x40d9e9], [0x40ce32, 0x40cef0], [0x43ec80, 0x43ecad], CRT];
    for (const a of [0x43a340, 0x43a9e5, 0x43ab72]) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
    this.str = str;
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  /** the constructor FUN_0040d02f's state: kind 2 (LOADING), the init flag set, the texture pointers empty, the angles 0 */
  construct() { this.cpu.regs[1] = CTX; this.cpu.call(0x40d02f, []); }
  setViewport(w, h) { const m = this.mem; m.w32(VP, 0); m.w32(VP + 4, 0); m.w32(VP + 8, w); m.w32(VP + 12, h); }
  /** FUN_0043ec80(fade) */
  setFade(fade) { this.cpu.steps = 0; this.cpu.call(0x43ec80, [new Uint32Array(new Float32Array([fade]).buffer)[0]]); }
  /** FUN_0040d1be (thiscall, ecx = the context) at GetTickCount() = tick; returns the recorded calls */
  draw(tick) {
    this.rec = []; this.tick = tick;
    this.cpu.regs[1] = CTX; this.cpu.steps = 0;
    this.cpu.call(0x40d1be, [], { maxSteps: 5_000_000 });
    return this.rec;
  }
  /** the context fields: angles, fade, flags, kind, text; the globals */
  state() {
    const m = this.mem;
    return { angleZ: m.f32(CTX + 0x248), angleX: m.f32(CTX + 0x24c), fade: m.f32(CTX + 0x90), active: m.r32(CTX + 0x8c), first: m.r32(CTX + 0x84), kind: m.r32(CTX), text: m.cstr(CTX + 4, 128), lastTick: m.r32(LAST_TICK), draws: m.r32(DRAWS) };
  }
  /** pre-load the three texture pointers that the init branch would have stored */
  setTextures() { const m = this.mem; m.w32(CTX + 0x14c, TEX.pizza); m.w32(CTX + 0x224, TEX.cd); m.w32(CTX + 0x308, TEX.loading); }
}
