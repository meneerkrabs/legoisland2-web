// The ORIGINAL particle engine (FX_Particle.c / CParticle*.cpp: LE2.EXE 0x44e860 .. 0x458a00) run in the x86 interpreter as an oracle for the TypeScript port
// in src/fx/particles (tools/tests/particles-oracle.mjs). The engine code, the C runtime, the text file reader and the matrix helpers execute natively from the
// user's executable; everything outside (file system, archive listing, allocation, game variables, the collision query, the RNG of the C runtime) is a host
// function. Nothing of the executable is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';

export const HEAP_BASE = 0x20000000, HEAP_SIZE = 0x8000000;
const CRT = [0x858d30, 0x873e00];
/** particle engine code, the text file reader, the zone-independent matrix helpers */
const EXEC = [[0x44e860, 0x458b00], [0x87d100, 0x87d700], [0x887a00, 0x887f00], [0x888500, 0x888c00], CRT];
const NATIVE = [0x43a340, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43ad29, 0x43af16, 0x43cec0, 0x43cfee, 0x4388ae];
const f32bits = (f) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, f, true); return d.getUint32(0, true); };
export { f32bits };

/** engine globals (DAT_05d3b0xx ...) */
export const G = {
  engine: 0x5d3b09c, nApp: 0x5d3b0a8, nEmi: 0x5d3b0ac, nMov: 0x5d3b0b0, nPar: 0x5d3b0b4, nSwl: 0x5d3b0b8,
  apps: 0x5d3b0bc, emis: 0x5d3b0c0, movs: 0x5d3b0c4, pars: 0x5d3b0c8, swls: 0x5d3b0cc,
  lod: 0x5d3b0a0, invZoom: 0x5d3b098,
  sin: 0x5d3b0f0, cos: 0x5d3b4f0, table: 0x5d3b8f0, idx: 0x5d478f0, ident: 0x5d37030,
  frame: 0x9da5cc, dt: 0x8b1718, zoom: 0x89df2c, paused: 0x5d37028, cam: 0x9da5e8, vars: 0x8a2d2c,
};

export class ParticleEmu {
  /**
   * @param ctx the test context (dataRoot) @param files { list(ext), read(name) } the particle directory (ParticleFiles of the port)
   */
  constructor(ctx, files, opts = {}) {
    const pe = (this.pe = loadExe(ctx.dataRoot));
    const cpu = (this.cpu = createCpu(pe));
    cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;   // the original runs the x87 in 24-bit precision (Direct3D 7: the particle engine is built when a zone loads, after the device exists)
    const mem = (this.mem = cpu.mem);
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + HEAP_SIZE, name: 'heap' });
    this.brk = HEAP_BASE;
    this.files = files;
    this.vars = new Map();
    this.log = [];
    this.collide = opts.collide ?? (() => 0);
    this.rand = opts.rand ?? (() => 0);
    this.randCalls = 0;
    cpu.exec = EXEC;
    cpu.native.add(0x85b230);
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { this.log.push({ unhooked: addr, from: c.callAt }); throw new Error(`particle oracle: unhooked call 0x${addr.toString(16)} from 0x${c.callAt.toString(16)} frames ${c.frames.slice(-8).map((f) => f.toString(16)).join('>')}`); };
    const H = cpu.hooks;
    const L = this;
    // ---- allocation: (size, 1, file, line) and operator new(size)
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x4341a4, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x434188, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x4341c0, () => 0);
    H.set(0x4341d1, () => 0);
    // ---- the random number generator of the C runtime: rand()
    H.set(0x85daf0, (c) => { L.randCalls++; c.eax = L.rand() & 0x7fff; });
    // ---- FUN_00890290 = _strnicmp(a, b, n): ASCII case folding, stops at a NUL
    H.set(0x890290, (c) => {
      let r = 0;
      for (let k = 0; k < c.arg(2); k++) {
        let x = mem.r8(c.arg(0) + k), y = mem.r8(c.arg(1) + k);
        if (x > 0x40 && x < 0x5b) x += 0x20;
        if (y > 0x40 && y < 0x5b) y += 0x20;
        if (x !== y) { r = x < y ? -1 : 1; break; }
        if (x === 0) break;
      }
      c.eax = r;
    });
    // ---- game variables
    H.set(0x417575, (c) => { c.eax = L.vars.get(c.arg(0)) ?? 0; });
    // ---- progress callback of the loaders
    H.set(0x443c70, () => 0);
    // ---- the Win32 FindFirstFile family: always "nothing" so that the archive listing is used
    H.set(0x59f1ac2, () => { return (this.cpu.eax = 0xffffffff, 8); });
    H.set(0x59f1ab2, () => { this.cpu.eax = 0; return 8; });
    H.set(0x59f1aa6, () => { this.cpu.eax = 1; return 4; });
    // ---- archive listing: FUN_00434f91(dir, ext, out) / FUN_00434eaa(handle, out)
    const lists = new Map();
    let nextH = 0x40000000;
    H.set(0x434f91, (c) => {
      const ext = mem.cstr(c.arg(1)).toLowerCase();
      const names = files.list(ext).map((f) => f.name);
      if (!names.length) { c.eax = 0; return; }
      const h = nextH; nextH += 0x10;
      lists.set(h, { names, i: 0 });
      c.eax = L.next(h, c.arg(2));
    });
    H.set(0x434eaa, (c) => { c.eax = L.next(c.arg(0), c.arg(1)); });
    this.next = (h, out) => {
      const l = lists.get(h);
      if (!l || l.i >= l.names.length) return 0;
      const nm = l.names[l.i++];
      for (let k = 0; k < nm.length; k++) mem.w8(out + k, nm.charCodeAt(k));
      mem.w8(out + nm.length, 0);
      return h;
    };
    // ---- the file functions used by FUN_0087d248: FUN_00435843(path, mode, srcfile, line) / 004356a4 seek / 00435611 tell / 00435350 read / 004358e9 close
    const open = new Map();
    let nextF = 0x30000000;
    H.set(0x435843, (c) => {
      const path = mem.cstr(c.arg(0)).replace(/\\/g, '/');
      const name = path.slice(path.lastIndexOf('/') + 1);
      const data = files.read(name);
      if (!data) { c.eax = 0; return; }
      open.set(nextF, { data, pos: 0 }); c.eax = nextF; nextF += 4;
    });
    H.set(0x4356a4, (c) => {
      const f = open.get(c.arg(0)); const off = c.arg(1) | 0, wh = c.arg(2);
      f.pos = wh === 0 ? off : wh === 1 ? f.pos + off : f.data.length + off; c.eax = 0;
    });
    H.set(0x435611, (c) => { c.eax = open.get(c.arg(0)).pos; });
    H.set(0x435350, (c) => {
      const f = open.get(c.arg(3)); const n = c.arg(1) * c.arg(2);
      for (let i = 0; i < n; i++) mem.w8(c.arg(0) + i, f.data[f.pos + i] ?? 0);
      f.pos += n; c.eax = c.arg(2);
    });
    H.set(0x4358e9, (c) => { open.delete(c.arg(0)); c.eax = 0; });
    // ---- the collision query FUN_00441b10(record, query, 1) -> hit (0 / 1); the query block is at 0x8b85a0 (pos*, vel*, &normal, &point, ..., radius at +0x14)
    H.set(0x441b10, (c) => {
      const q = 0x8b85a0;
      const posP = mem.u32(q), velP = mem.u32(q + 4), nP = mem.u32(q + 8), hP = mem.u32(q + 12);
      const f = (a) => [mem.f32(a), mem.f32(a + 4), mem.f32(a + 8)];
      const r = L.collide(c.arg(0), f(posP), f(velP), mem.f32(q + 0x14));
      if (!r) { c.eax = 0; return; }
      for (let k = 0; k < 3; k++) { mem.wf32(nP + 4 * k, r.normal[k]); mem.wf32(hP + 4 * k, r.point[k]); }
      c.eax = 1;
    });
    this.initCrt();
  }
  /** CRT start-up pieces the engine code relies on: the float conversion table of sscanf (FUN_0085b230 = __cfltcvt_init) */
  initCrt() { this.call(0x85b230); }
  alloc(n) { const p = this.brk; this.brk = (this.brk + n + 15) & ~15; return p; }
  /** allocate and write a C string */
  cstr(s) { const p = this.alloc(s.length + 1); for (let i = 0; i < s.length; i++) this.mem.w8(p + i, s.charCodeAt(i)); this.mem.w8(p + s.length, 0); return p; }
  u32(a) { return this.mem.u32(a); }
  f32(a) { return this.mem.f32(a); }
  bytes(a, n) { return this.mem.read(a, n); }
  call(addr, args = [], ecx = null, steps = 80_000_000) {
    if (ecx !== null) this.cpu.regs[1] = ecx;
    this.cpu.steps = 0;
    return this.cpu.call(addr, args, { maxSteps: steps });
  }
  setF32(a, v) { this.mem.wf32(a, v); }
  setU32(a, v) { this.mem.w32(a, v); }
  /** the engine's file loader FUN_0044fe30(dir) (apps, movs, emis, pars, swls into DAT_05d3b0a8 ..) */
  loadDir(dir = 'particle/') { return this.call(0x44fe30, [this.cstr(dir)]); }
  /** the first `n` bytes of the global tables the port's PState mirrors */
  setTables(ps) {
    for (let i = 0; i < 256; i++) { this.mem.wf32(G.sin + 4 * i, ps.sin[i]); this.mem.wf32(G.cos + 4 * i, ps.cos[i]); }
    for (let i = 0; i < 4096; i++) this.mem.wf32(G.table + 4 * i, ps.table[i]);
    this.mem.w32(G.idx, ps.idx);
  }
}
