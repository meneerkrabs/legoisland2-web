// Concrete 32-bit x86 interpreter (docs/re/m4/emu.md). Runs original functions of the game's executable (an MSVC debug build: ebp frames,
// cdecl, x87 floats, `rep stos` local fills, jump tables) on sparse paged memory initialised lazily from the PE image, with a host table
// that replaces functions by address (`hooks`): a host function sees the stack arguments through `cpu.arg(i)`, sets `eax` (or pushes st0
// with `fpush`) and returns the number of argument bytes the callee pops (0 / undefined = cdecl; stdcall / thiscall callees pop theirs).
// Nothing of the executable is stored here: code and data are read from the user's own file at run time.
//
// Not modelled: 16-bit addressing (0x67), segment registers other than fs (fs = a zero-filled thread block), protected-mode / privileged
// instructions, x87 80-bit memory operands, MMX / SSE, exceptions (a fault throws an Error naming the instruction address).
import { decode } from './x86.ts';
import type { Ins } from './x86.ts';

/** a host function: called instead of executing the code at its address; the return address is at [esp] */
export type HostFn = (cpu: Cpu) => number | void;

/** where the bytes of a memory range come from: an image (PE sections) or plain zero memory */
export interface MemRegion { lo: number; hi: number; init?: (va: number, page: Uint8Array) => void; name: string }

export interface ImageLike {
  sections: { va: number; vsize: number; rsize: number; roff: number }[];
  data: Uint8Array;
}

const PAGE = 4096;

export class EmuError extends Error {
  readonly eip: number;
  readonly trace: number[];
  constructor(msg: string, eip: number, trace: number[]) { super(msg); this.eip = eip; this.trace = trace; }
}

/** sparse paged little-endian memory: pages are created on first access when the address lies in a region, else the access faults */
export class Memory {
  readonly pages: (Uint8Array | null)[] = new Array(1 << 20).fill(null);
  readonly regions: MemRegion[] = [];
  /** set by the CPU so that faults name the instruction */
  eip = 0;
  /** write observer for the range [wlo, whi) (e.g. the record array): called with the address, size and value of every store into it */
  wlo = 0; whi = 0;
  onWrite: ((a: number, size: number, v: number) => void) | null = null;
  addRegion(r: MemRegion) { this.regions.push(r); }
  /** map the sections of a PE image (bytes beyond the raw size are zero) */
  mapImage(img: ImageLike) {
    for (const s of img.sections) {
      const size = Math.max(s.vsize, s.rsize);
      this.addRegion({
        lo: s.va, hi: s.va + size, name: 'image',
        init: (va, page) => {
          const r = va - s.va;
          const n = Math.min(PAGE, s.rsize - r);
          if (n > 0) page.set(img.data.subarray(s.roff + r, s.roff + r + n));
        },
      });
    }
  }
  miss(a: number): Uint8Array {
    a >>>= 0;
    const pva = a & ~(PAGE - 1);
    for (const r of this.regions) {
      // a page that straddles two regions (image sections are page aligned in this build; the others are ours)
      if (pva + PAGE > r.lo && pva < r.hi) {
        const page = new Uint8Array(PAGE);
        for (const q of this.regions) if (q.init && pva + PAGE > q.lo && pva < q.hi) q.init(pva, page);
        this.pages[a >>> 12] = page;
        return page;
      }
    }
    throw new EmuError(`x86emu: access to unmapped memory 0x${a.toString(16)} at eip 0x${this.eip.toString(16)}`, this.eip, []);
  }
  mapped(a: number): boolean {
    a >>>= 0;
    if (this.pages[a >>> 12]) return true;
    return this.regions.some((r) => a >= r.lo && a < r.hi);
  }
  r8(a: number): number { const p = this.pages[a >>> 12] ?? this.miss(a); return p[a & 0xfff]; }
  r16(a: number): number {
    const o = a & 0xfff;
    if (o > 0xffe) return this.r8(a) | (this.r8(a + 1) << 8);
    const p = this.pages[a >>> 12] ?? this.miss(a);
    return p[o] | (p[o + 1] << 8);
  }
  /** signed 32-bit */
  r32(a: number): number {
    const o = a & 0xfff;
    if (o > 0xffc) return this.r8(a) | (this.r8(a + 1) << 8) | (this.r8(a + 2) << 16) | (this.r8(a + 3) << 24);
    const p = this.pages[a >>> 12] ?? this.miss(a);
    return p[o] | (p[o + 1] << 8) | (p[o + 2] << 16) | (p[o + 3] << 24);
  }
  u32(a: number): number { return this.r32(a) >>> 0; }
  w8(a: number, v: number) { if (a >= this.wlo && a < this.whi) this.onWrite!(a, 1, v & 0xff); this.w8raw(a, v); }
  private w8raw(a: number, v: number) { const p = this.pages[a >>> 12] ?? this.miss(a); p[a & 0xfff] = v; }
  w16(a: number, v: number) {
    if (a >= this.wlo && a < this.whi) this.onWrite!(a, 2, v & 0xffff);
    const o = a & 0xfff;
    if (o > 0xffe) { this.w8raw(a, v); this.w8raw(a + 1, v >> 8); return; }
    const p = this.pages[a >>> 12] ?? this.miss(a);
    p[o] = v; p[o + 1] = v >> 8;
  }
  w32(a: number, v: number) {
    if (a >= this.wlo && a < this.whi) this.onWrite!(a, 4, v >>> 0);
    const o = a & 0xfff;
    if (o > 0xffc) { this.w8raw(a, v); this.w8raw(a + 1, v >> 8); this.w8raw(a + 2, v >> 16); this.w8raw(a + 3, v >> 24); return; }
    const p = this.pages[a >>> 12] ?? this.miss(a);
    p[o] = v; p[o + 1] = v >> 8; p[o + 2] = v >> 16; p[o + 3] = v >> 24;
  }
  f32(a: number): number { FI[0] = this.r32(a); return F32[0]; }
  wf32(a: number, v: number) { F32[0] = v; this.w32(a, FI[0]); }
  f64(a: number): number { DI[0] = this.r32(a); DI[1] = this.r32(a + 4); return F64[0]; }
  wf64(a: number, v: number) { F64[0] = v; this.w32(a, DI[0]); this.w32(a + 4, DI[1]); }
  read(a: number, n: number): Uint8Array { const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = this.r8(a + i); return out; }
  write(a: number, bytes: ArrayLike<number>) { for (let i = 0; i < bytes.length; i++) this.w8(a + i, bytes[i]); }
  fill(a: number, n: number, v = 0) { for (let i = 0; i < n; i++) this.w8(a + i, v); }
  cstr(a: number, max = 260): string {
    let s = '';
    for (let i = 0; i < max; i++) { const c = this.r8(a + i); if (!c) break; s += String.fromCharCode(c); }
    return s;
  }
}
const F32 = new Float32Array(1), FI = new Int32Array(F32.buffer);
const F64 = new Float64Array(1), DI = new Int32Array(F64.buffer);

/** decoded instruction + what the executor needs */
interface D extends Ins {
  next: number;
  /** operand size 1 / 2 / 4 for the instruction's main operand (set per opcode at run time; here 2 or 4 from the 0x66 prefix) */
  os: number;
  /** 0 none, 1 = f3 (rep / repe), 2 = f2 (repne) */
  rp: number;
  /** fs segment override */
  fs: boolean;
  hook: HostFn | null;
  watch: HostFn | null;
}

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) { let b = i, p = 1; while (b) { p ^= b & 1; b >>= 1; } PARITY[i] = p; }

export const RET_MAGIC = 0xfffff000;
export const STACK_TOP = 0x7ff00000, STACK_SIZE = 0x100000;
export const FS_BASE = 0x7ffd0000;

export interface RunOptions {
  /** step limit (default 50 million) */
  maxSteps?: number;
  /** called before every instruction (slow: debugging only) */
  trace?: (cpu: Cpu, at: number) => void;
}

export class Cpu {
  readonly mem: Memory;
  readonly regs = new Int32Array(8);
  eip = 0;
  // flags (0 / 1), pf from the low byte of the last result
  cf = 0; zf = 0; sf = 0; of = 0; df = 0; pfb = 0;
  // x87
  readonly st = new Float64Array(8);
  top = 0; c0 = 0; c1 = 0; c2 = 0; c3 = 0; cw = ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.M7_CW !== undefined) ? Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process!.env!.M7_CW) : 0x27f;
  /** functions replaced by host code (address -> host function); `fallback` gets every call target that `exec` rejects */
  hooks = new Map<number, HostFn>();
  /** observers: called when execution reaches the address, then the original code runs (logging of functions that execute natively) */
  watches = new Map<number, HostFn>();
  /** which code may execute: when set, a call / jump target outside every range goes to `fallback` */
  exec: [number, number][] | null = null;
  /** single functions (entry addresses) outside `exec` that execute anyway */
  native = new Set<number>();
  /** set by call instructions: only a call target can be redirected to `fallback` (a jump inside a native function never is) */
  private entering = false;
  fallback: ((addr: number) => HostFn) | null = null;
  /** address of the last call instruction (for host functions: the call site) */
  callAt = 0;
  /** shadow call stack of executed functions (entry addresses), innermost last */
  readonly frames: number[] = [];
  steps = 0;
  private cache = new Map<number, D>();
  private ring = new Int32Array(64);
  private fetchBuf = new Uint8Array(32);

  constructor(mem: Memory) {
    this.mem = mem;
    mem.addRegion({ lo: STACK_TOP - STACK_SIZE, hi: STACK_TOP, name: 'stack' });
    mem.addRegion({ lo: FS_BASE, hi: FS_BASE + PAGE, name: 'tib' });
    this.regs[4] = STACK_TOP - 0x100;
  }

  // ------------------------------------------------------------------ host-function helpers
  get eax() { return this.regs[0] >>> 0; }
  set eax(v: number) { this.regs[0] = v; }
  get ecx() { return this.regs[1] >>> 0; }
  get esp() { return this.regs[4] >>> 0; }
  /** stack argument i (0 = first) as an unsigned 32-bit value, inside a host function (return address at [esp]) */
  arg(i: number): number { return this.mem.u32(this.regs[4] + 4 + 4 * i); }
  /** stack argument i as a float32 */
  argf(i: number): number { return this.mem.f32(this.regs[4] + 4 + 4 * i); }
  /** the return address of the current host call */
  get retAddr(): number { return this.mem.u32(this.regs[4]); }
  push(v: number) { this.regs[4] -= 4; this.mem.w32(this.regs[4], v); }
  pop(): number { const v = this.mem.u32(this.regs[4]); this.regs[4] += 4; return v; }
  fpush(v: number) { this.top = (this.top - 1) & 7; this.st[this.top] = v; }
  fpop(): number { const v = this.st[this.top]; this.top = (this.top + 1) & 7; return v; }
  sti(i: number): number { return this.st[(this.top + i) & 7]; }
  invalidate() { this.cache.clear(); }

  /**
   * Call the function at `entry` with the given 32-bit stack arguments (cdecl) and run until it returns; returns eax. Hooks apply to the
   * entry too (a hooked entry runs the host function).
   */
  call(entry: number, args: number[] = [], opts: RunOptions = {}): number {
    const sp0 = this.regs[4];
    for (let i = args.length - 1; i >= 0; i--) this.push(args[i]);
    this.push(RET_MAGIC);
    this.eip = entry >>> 0;
    this.frames.push(entry >>> 0);
    this.entering = true;
    this.run(opts);
    this.regs[4] = sp0;
    return this.eax;
  }

  private decodeAt(a: number): D {
    const b = this.fetchBuf;
    for (let i = 0; i < 16; i++) b[i] = this.mem.r8(a + i);
    let rp = 0, fs = false;
    for (let p = 0; p < 5; p++) {
      const c = b[p];
      if (c === 0xf3) rp = 1; else if (c === 0xf2) rp = 2; else if (c === 0x64) fs = true;
      else if (c === 0x67) throw new EmuError(`x86emu: address-size prefix at 0x${a.toString(16)}`, a, this.lastSteps());
      else if (c !== 0x66 && c !== 0x2e && c !== 0x36 && c !== 0x3e && c !== 0x26 && c !== 0x65 && c !== 0xf0) break;
    }
    const ins = decode(b, 0, a);
    if (!ins) throw new EmuError(`x86emu: undecodable bytes at 0x${a.toString(16)}`, a, this.lastSteps());
    const d = ins as D;
    d.next = (a + ins.len) >>> 0;
    d.os = ins.prefix66 ? 2 : 4;
    d.rp = rp; d.fs = fs;
    let h = this.hooks.get(a) ?? null;
    if (!h && this.entering && this.exec && this.fallback && !this.native.has(a) && !this.exec.some(([lo, hi]) => a >= lo && a < hi)) h = this.fallback(a);
    d.hook = h;
    d.watch = this.watches.get(a) ?? null;
    this.cache.set(a, d);
    return d;
  }
  lastSteps(): number[] {
    const out: number[] = [];
    for (let i = 0; i < 64; i++) { const v = this.ring[(this.steps + i) & 63]; if (v) out.push(v >>> 0); }
    return out;
  }
  fault(msg: string, at: number): never {
    throw new EmuError(`x86emu: ${msg} at 0x${at.toString(16)} (steps ${this.steps}, frames ${this.frames.slice(-6).map((f) => f.toString(16)).join(' > ')})`, at, this.lastSteps());
  }

  // ------------------------------------------------------------------ operands
  private ea(d: D): number {
    let a = d.disp;
    if (d.base >= 0) a += this.regs[d.base];
    if (d.index >= 0) a += this.regs[d.index] * d.scale;
    if (d.fs) a += FS_BASE;
    return a >>> 0;
  }
  getReg(r: number, size: number): number {
    if (size === 4) return this.regs[r] >>> 0;
    if (size === 2) return this.regs[r] & 0xffff;
    return r < 4 ? this.regs[r] & 0xff : (this.regs[r - 4] >>> 8) & 0xff;
  }
  setReg(r: number, size: number, v: number) {
    if (size === 4) this.regs[r] = v;
    else if (size === 2) this.regs[r] = (this.regs[r] & 0xffff0000) | (v & 0xffff);
    else if (r < 4) this.regs[r] = (this.regs[r] & ~0xff) | (v & 0xff);
    else this.regs[r - 4] = (this.regs[r - 4] & ~0xff00) | ((v & 0xff) << 8);
  }
  private rdMem(a: number, size: number): number { return size === 4 ? this.mem.u32(a) : size === 2 ? this.mem.r16(a) : this.mem.r8(a); }
  private wrMem(a: number, size: number, v: number) { if (size === 4) this.mem.w32(a, v); else if (size === 2) this.mem.w16(a, v); else this.mem.w8(a, v); }
  private rdRM(d: D, size: number): number { return d.mod === 3 ? this.getReg(d.rm, size) : this.rdMem(this.ea(d), size); }
  private wrRM(d: D, size: number, v: number) { if (d.mod === 3) this.setReg(d.rm, size, v); else this.wrMem(this.ea(d), size, v); }

  // ------------------------------------------------------------------ flags / ALU
  private szp(r: number, size: number) {
    this.zf = r === 0 ? 1 : 0;
    this.sf = (r >>> (size * 8 - 1)) & 1;
    this.pfb = r & 0xff;
  }
  /** a, b unsigned within `size`; returns the unsigned result (op 7 = cmp: result of sub, not written by the caller) */
  alu(op: number, a: number, b: number, size: number): number {
    const bits = size * 8, M = size === 4 ? 0xffffffff : (1 << bits) - 1;
    let r: number;
    switch (op) {
      case 0: case 2: { // add, adc
        const c = op === 2 ? this.cf : 0;
        const full = a + b + c;
        r = size === 4 ? full >>> 0 : full & M;
        this.cf = full > M ? 1 : 0;
        this.of = ((~(a ^ b) & (a ^ r)) >>> (bits - 1)) & 1;
        break;
      }
      case 3: case 5: case 7: { // sbb, sub, cmp
        const c = op === 3 ? this.cf : 0;
        const full = a - b - c;
        r = size === 4 ? full >>> 0 : full & M;
        this.cf = full < 0 ? 1 : 0;
        this.of = (((a ^ b) & (a ^ r)) >>> (bits - 1)) & 1;
        break;
      }
      case 1: r = (a | b) & M; if (size === 4) r >>>= 0; this.cf = this.of = 0; break;
      case 4: r = (a & b) & M; if (size === 4) r >>>= 0; this.cf = this.of = 0; break;
      default: r = (a ^ b) & M; if (size === 4) r >>>= 0; this.cf = this.of = 0; break;
    }
    this.szp(r, size);
    return r;
  }
  cond(cc: number): boolean {
    switch (cc) {
      case 0: return this.of === 1;
      case 1: return this.of === 0;
      case 2: return this.cf === 1;
      case 3: return this.cf === 0;
      case 4: return this.zf === 1;
      case 5: return this.zf === 0;
      case 6: return this.cf === 1 || this.zf === 1;
      case 7: return this.cf === 0 && this.zf === 0;
      case 8: return this.sf === 1;
      case 9: return this.sf === 0;
      case 10: return PARITY[this.pfb] === 1;
      case 11: return PARITY[this.pfb] === 0;
      case 12: return this.sf !== this.of;
      case 13: return this.sf === this.of;
      case 14: return this.zf === 1 || this.sf !== this.of;
      default: return this.zf === 0 && this.sf === this.of;
    }
  }
  get eflags(): number {
    return this.cf | (PARITY[this.pfb] << 2) | (this.zf << 6) | (this.sf << 7) | (this.df << 10) | (this.of << 11) | 2;
  }
  set eflags(v: number) {
    this.cf = v & 1; this.pfb = (v & 4) ? 0 : 1; this.zf = (v >> 6) & 1; this.sf = (v >> 7) & 1; this.df = (v >> 10) & 1; this.of = (v >> 11) & 1;
  }
  private shift(op: number, a: number, cnt: number, size: number): number {
    const bits = size * 8, M = size === 4 ? 0xffffffff : (1 << bits) - 1;
    let c = cnt & 0x1f;
    if (c === 0) return a;
    let r = a;
    switch (op) {
      case 0: { c %= bits; if (c === 0) return a; r = ((a << c) | (a >>> (bits - c))) & M; this.cf = r & 1; this.of = ((r >>> (bits - 1)) ^ this.cf) & 1; break; } // rol
      case 1: { c %= bits; if (c === 0) return a; r = ((a >>> c) | (a << (bits - c))) & M; this.cf = (r >>> (bits - 1)) & 1; this.of = ((r >>> (bits - 1)) ^ (r >>> (bits - 2))) & 1; break; } // ror
      case 2: case 3: { // rcl / rcr (bitwise)
        for (let i = 0; i < c; i++) {
          if (op === 2) { const hi = (r >>> (bits - 1)) & 1; r = ((r << 1) | this.cf) & M; this.cf = hi; }
          else { const lo = r & 1; r = ((r >>> 1) | (this.cf << (bits - 1))) & M; this.cf = lo; }
        }
        if (size === 4) r >>>= 0;
        return r;
      }
      case 4: case 6: { // shl / sal
        if (c > bits) { r = 0; this.cf = 0; }
        else { this.cf = c === bits ? a & 1 : (a >>> (bits - c)) & 1; r = c === 32 ? 0 : (a << c) & M; }
        this.of = ((r >>> (bits - 1)) ^ this.cf) & 1;
        break;
      }
      case 5: { // shr
        this.cf = (a >>> (c - 1)) & 1; r = c >= bits ? 0 : a >>> c; this.of = (a >>> (bits - 1)) & 1; break;
      }
      default: { // sar
        const sa = (a << (32 - bits)) >> (32 - bits);
        this.cf = (sa >> Math.min(c - 1, 31)) & 1; r = (sa >> Math.min(c, 31)) & M; this.of = 0; break;
      }
    }
    if (size === 4) r >>>= 0;
    this.szp(r, size);
    return r;
  }

  // ------------------------------------------------------------------ x87
  private fcmp(a: number, b: number) {
    if (Number.isNaN(a) || Number.isNaN(b)) { this.c0 = this.c2 = this.c3 = 1; }
    else { this.c2 = 0; this.c0 = a < b ? 1 : 0; this.c3 = a === b ? 1 : 0; }
  }
  private fcomi(a: number, b: number) {
    if (Number.isNaN(a) || Number.isNaN(b)) { this.zf = 1; this.pfb = 0; this.cf = 1; }
    else { this.zf = a === b ? 1 : 0; this.cf = a < b ? 1 : 0; this.pfb = 1; }
    this.of = 0; this.sf = 0;
  }
  get fsw(): number { return (this.c0 << 8) | (this.c1 << 9) | (this.c2 << 10) | ((this.top & 7) << 11) | (this.c3 << 14); }
  private fround(v: number): number {
    switch ((this.cw >> 10) & 3) {
      case 0: { const f = Math.floor(v), d = v - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : f % 2 === 0 ? f : f + 1; }
      case 1: return Math.floor(v);
      case 2: return Math.ceil(v);
      default: return Math.trunc(v);
    }
  }
  /** precision control (cw bits 8-9 = 0, the 24-bit mode Direct3D 7 sets): every arithmetic result rounds to a 24-bit mantissa; the exponent range stays the extended one */
  private p24(v: number): number {
    if (((this.cw >> 8) & 3) !== 0 || v === 0 || !Number.isFinite(v)) return v;
    const a = Math.abs(v);
    if (a >= 1.1754943508222875e-38 && a <= 3.4028234663852886e38) return Math.fround(v);
    const t = v * 536870913, hi = t - (t - v);   // Veltkamp split: the 24 high bits (outside the float range, where fround would saturate)
    return hi;
  }
  private farith(op: number, a: number, b: number): number {
    switch (op) {
      case 0: return this.p24(a + b);
      case 1: return this.p24(a * b);
      case 4: return this.p24(a - b);
      case 5: return this.p24(b - a);
      case 6: return this.p24(a / b);
      default: return this.p24(b / a);
    }
  }
  private x87(d: D) {
    const op = d.op, reg = d.reg, mem = this.mem;
    const T = this.top;
    if (d.mod !== 3) {
      const a = this.ea(d);
      switch (op) {
        case 0xd8: case 0xdc: case 0xda: case 0xde: {
          const v = op === 0xd8 ? mem.f32(a) : op === 0xdc ? mem.f64(a) : op === 0xda ? mem.r32(a) : (mem.r16(a) << 16) >> 16;
          if (reg === 2 || reg === 3) { this.fcmp(this.st[T], v); if (reg === 3) this.fpop(); }
          else this.st[T] = this.farith(reg, this.st[T], v);
          return;
        }
        case 0xd9:
          switch (reg) {
            case 0: this.fpush(mem.f32(a)); return;
            case 2: mem.wf32(a, this.st[T]); return;
            case 3: mem.wf32(a, this.fpop()); return;
            case 5: this.cw = mem.r16(a); return;
            case 7: mem.w16(a, this.cw); return;
            case 4: case 6: break;
          }
          break;
        case 0xdb:
          switch (reg) {
            case 0: this.fpush(mem.r32(a)); return;
            case 2: case 3: { const v = this.fround(this.st[T]); mem.w32(a, v >= -2147483648 && v <= 2147483647 ? v : 0x80000000); if (reg === 3) this.fpop(); return; }
          }
          break;
        case 0xdd:
          switch (reg) {
            case 0: this.fpush(mem.f64(a)); return;
            case 2: mem.wf64(a, this.st[T]); return;
            case 3: mem.wf64(a, this.fpop()); return;
            case 7: mem.w16(a, this.fsw); return;
          }
          break;
        case 0xdf:
          switch (reg) {
            case 0: this.fpush((mem.r16(a) << 16) >> 16); return;
            case 2: case 3: { const v = this.fround(this.st[T]); mem.w16(a, v >= -32768 && v <= 32767 ? v : 0x8000); if (reg === 3) this.fpop(); return; }
            case 5: this.fpush(mem.r32(a + 4) * 4294967296 + mem.u32(a)); return;
            case 7: {
              const v = this.fround(this.fpop());
              if (!Number.isFinite(v) || Math.abs(v) >= 2 ** 63) { mem.w32(a, 0); mem.w32(a + 4, 0x80000000); return; }
              const hi = Math.floor(v / 4294967296), lo = v - hi * 4294967296;
              mem.w32(a, lo); mem.w32(a + 4, hi);
              return;
            }
          }
          break;
      }
      this.fault(`unimplemented x87 memory op ${op.toString(16)}/${reg}`, d.addr);
    }
    const i = d.rm, si = (T + i) & 7;
    switch (op) {
      case 0xd8:
        if (reg === 2 || reg === 3) { this.fcmp(this.st[T], this.st[si]); if (reg === 3) this.fpop(); }
        else this.st[T] = this.farith(reg, this.st[T], this.st[si]);
        return;
      case 0xdc: case 0xde: {
        if (op === 0xde && reg === 3 && i === 1) { this.fcmp(this.st[T], this.st[si]); this.fpop(); this.fpop(); return; } // fcompp
        if (reg === 2 || reg === 3) { this.fcmp(this.st[T], this.st[si]); if (reg === 3) this.fpop(); return; }
        const x = this.st[si], s0 = this.st[T];
        // register forms: st(i) = st(i) op st0, with the Intel meanings of the sub / div variants (DC E0 = fsubr: st0 - st(i) ...)
        const r = reg === 0 ? x + s0 : reg === 1 ? x * s0 : reg === 4 ? s0 - x : reg === 5 ? x - s0 : reg === 6 ? s0 / x : x / s0;
        this.st[si] = this.p24(r);
        if (op === 0xde) this.fpop();
        return;
      }
      case 0xd9: {
        const m = d.modrm;
        if (m >= 0xc0 && m <= 0xc7) { const v = this.st[si]; this.fpush(v); return; }
        if (m >= 0xc8 && m <= 0xcf) { const v = this.st[si]; this.st[si] = this.st[T]; this.st[T] = v; return; }
        switch (m) {
          case 0xd0: return;
          case 0xe0: this.st[T] = -this.st[T]; return;
          case 0xe1: this.st[T] = Math.abs(this.st[T]); return;
          case 0xe4: this.fcmp(this.st[T], 0); return;
          case 0xe5: { const v = this.st[T]; this.c1 = v < 0 || Object.is(v, -0) ? 1 : 0; if (Number.isNaN(v)) { this.c3 = 0; this.c2 = 0; this.c0 = 1; } else if (!Number.isFinite(v)) { this.c3 = 0; this.c2 = 1; this.c0 = 1; } else if (v === 0) { this.c3 = 1; this.c2 = 0; this.c0 = 0; } else { this.c3 = 0; this.c2 = 1; this.c0 = 0; } return; }
          case 0xe8: this.fpush(1); return;
          case 0xe9: this.fpush(Math.log2(10)); return;
          case 0xea: this.fpush(Math.LOG2E); return;
          case 0xeb: this.fpush(Math.PI); return;
          case 0xec: this.fpush(Math.log10(2)); return;
          case 0xed: this.fpush(Math.LN2); return;
          case 0xee: this.fpush(0); return;
          case 0xf0: this.st[T] = 2 ** this.st[T] - 1; return;
          case 0xf1: { const x = this.fpop(); this.st[this.top] = this.st[this.top] * Math.log2(x); return; }
          case 0xf2: this.st[T] = Math.tan(this.st[T]); this.fpush(1); this.c2 = 0; return;
          case 0xf3: { const x = this.fpop(); this.st[this.top] = Math.atan2(this.st[this.top], x); return; }
          case 0xf8: case 0xf5: { const a = this.st[T], b = this.st[(T + 1) & 7]; this.st[T] = a % b; this.c2 = 0; return; }
          case 0xfa: this.st[T] = this.p24(Math.sqrt(this.st[T])); return;
          case 0xfb: { const v = this.st[T]; this.st[T] = Math.sin(v); this.fpush(Math.cos(v)); this.c2 = 0; return; }
          case 0xfc: this.st[T] = this.fround(this.st[T]); return;
          case 0xfd: this.st[T] = this.st[T] * 2 ** Math.trunc(this.st[(T + 1) & 7]); return;
          case 0xfe: this.st[T] = Math.sin(this.st[T]); this.c2 = 0; return;
          case 0xff: this.st[T] = Math.cos(this.st[T]); this.c2 = 0; return;
        }
        break;
      }
      case 0xda:
        if (d.modrm === 0xe9) { this.fcmp(this.st[T], this.st[(T + 1) & 7]); this.fpop(); this.fpop(); return; }
        break;
      case 0xdb:
        if (d.modrm === 0xe2 || d.modrm === 0xe3) { if (d.modrm === 0xe3) { this.top = 0; this.cw = 0x37f; } this.c0 = this.c1 = this.c2 = this.c3 = 0; return; }
        if (reg === 5 || reg === 6) { this.fcomi(this.st[T], this.st[si]); return; }
        break;
      case 0xdd:
        if (reg === 0) return; // ffree
        if (reg === 2) { this.st[si] = this.st[T]; return; }
        if (reg === 3) { this.st[si] = this.st[T]; this.fpop(); return; }
        if (reg === 4 || reg === 5) { this.fcmp(this.st[T], this.st[si]); if (reg === 5) this.fpop(); return; }
        break;
      case 0xdf:
        if (d.modrm === 0xe0) { this.setReg(0, 2, this.fsw); return; }
        if (reg === 5 || reg === 6) { this.fcomi(this.st[T], this.st[si]); this.fpop(); return; }
        break;
    }
    this.fault(`unimplemented x87 op ${op.toString(16)} ${d.modrm.toString(16)}`, d.addr);
  }

  // ------------------------------------------------------------------ string instructions
  private strop(d: D, op: number) {
    const size = (op & 1) === 0 ? 1 : d.os;
    const step = this.df ? -size : size;
    const regs = this.regs, mem = this.mem;
    const rep = d.rp !== 0;
    let n = rep ? regs[1] >>> 0 : 1;
    switch (op) {
      case 0xa4: case 0xa5:
        while (n > 0) { this.wrMem(regs[7] >>> 0, size, this.rdMem(regs[6] >>> 0, size)); regs[6] += step; regs[7] += step; n--; }
        break;
      case 0xaa: case 0xab: {
        const v = this.getReg(0, size);
        if (size === 4 && step > 0 && n > 16 && !((regs[7] >>> 0) < mem.whi && (regs[7] >>> 0) + n * 4 > mem.wlo)) {
          // fast path for the debug fills (`rep stosd` of 0xcccccccc)
          let a = regs[7] >>> 0;
          while (n > 0 && (a & 0xfff) <= 0xffc) {
            const p = mem.pages[a >>> 12] ?? mem.miss(a);
            let o = a & 0xfff;
            while (n > 0 && o <= 0xffc) { p[o] = v; p[o + 1] = v >> 8; p[o + 2] = v >> 16; p[o + 3] = v >>> 24; o += 4; a += 4; n--; }
            if (n > 0 && (a & 0xfff) !== 0) break;
          }
          regs[7] = a;
        }
        while (n > 0) { this.wrMem(regs[7] >>> 0, size, v); regs[7] += step; n--; }
        break;
      }
      case 0xac: case 0xad:
        while (n > 0) { this.setReg(0, size, this.rdMem(regs[6] >>> 0, size)); regs[6] += step; n--; }
        break;
      case 0xa6: case 0xa7: case 0xae: case 0xaf: {
        const cmps = op <= 0xa7;
        if (!rep) {
          const a = cmps ? this.rdMem(regs[6] >>> 0, size) : this.getReg(0, size);
          const b = this.rdMem(regs[7] >>> 0, size);
          this.alu(7, a, b, size);
          if (cmps) regs[6] += step;
          regs[7] += step;
          return;
        }
        while (n > 0) {
          const a = cmps ? this.rdMem(regs[6] >>> 0, size) : this.getReg(0, size);
          const b = this.rdMem(regs[7] >>> 0, size);
          this.alu(7, a, b, size);
          if (cmps) regs[6] += step;
          regs[7] += step;
          n--;
          if (d.rp === 1 ? this.zf === 0 : this.zf === 1) break;
        }
        break;
      }
    }
    if (rep) regs[1] = n;
  }

  // ------------------------------------------------------------------ main loop
  run(opts: RunOptions = {}) {
    const max = opts.maxSteps ?? 50_000_000;
    const trace = opts.trace;
    const regs = this.regs, mem = this.mem, cache = this.cache, ring = this.ring;
    for (;;) {
      const at = this.eip;
      if (at === RET_MAGIC) return;
      const d = cache.get(at) ?? this.decodeAt(at);
      this.entering = false;
      if (d.hook) {
        mem.eip = at;
        if (this.frames[this.frames.length - 1] === at) this.frames.pop();
        const n = d.hook(this) || 0;
        this.eip = this.pop();
        regs[4] += n;
        continue;
      }
      ring[this.steps & 63] = at;
      if (++this.steps > max) this.fault(`step limit ${max} reached`, at);
      if (trace) trace(this, at);
      if (d.watch) d.watch(this);
      mem.eip = at;
      this.eip = d.next;
      const op = d.op;
      if (op < 0x40 && (op & 7) < 6) {
        // ALU group
        const aop = op >> 3, form = op & 7;
        const size = form & 1 ? d.os : 1;
        if (form === 0 || form === 1) {
          if (d.mod === 3) {
            const r = this.alu(aop, this.getReg(d.rm, size), this.getReg(d.reg, size), size);
            if (aop !== 7) this.setReg(d.rm, size, r);
          } else {
            const a = this.ea(d);
            const r = this.alu(aop, this.rdMem(a, size), this.getReg(d.reg, size), size);
            if (aop !== 7) this.wrMem(a, size, r);
          }
        } else if (form === 2 || form === 3) {
          const r = this.alu(aop, this.getReg(d.reg, size), this.rdRM(d, size), size);
          if (aop !== 7) this.setReg(d.reg, size, r);
        } else {
          const M = size === 4 ? 0xffffffff : (1 << (size * 8)) - 1;
          const r = this.alu(aop, this.getReg(0, size), size === 4 ? d.imm >>> 0 : d.imm & M, size);
          if (aop !== 7) this.setReg(0, size, r);
        }
        continue;
      }
      switch (op) {
        case 0x40: case 0x41: case 0x42: case 0x43: case 0x44: case 0x45: case 0x46: case 0x47:
        case 0x48: case 0x49: case 0x4a: case 0x4b: case 0x4c: case 0x4d: case 0x4e: case 0x4f: {
          const r = op & 7, size = d.os, cf = this.cf;
          this.setReg(r, size, this.alu(op < 0x48 ? 0 : 5, this.getReg(r, size), 1, size));
          this.cf = cf;
          break;
        }
        case 0x50: case 0x51: case 0x52: case 0x53: case 0x54: case 0x55: case 0x56: case 0x57:
          this.push(regs[op & 7]); break;
        case 0x58: case 0x59: case 0x5a: case 0x5b: case 0x5c: case 0x5d: case 0x5e: case 0x5f:
          regs[op & 7] = this.pop(); break;
        case 0x60: { const sp = regs[4]; for (let r = 0; r < 8; r++) this.push(r === 4 ? sp : regs[r]); break; }
        case 0x61: { for (let r = 7; r >= 0; r--) { const v = this.pop(); if (r !== 4) regs[r] = v; } break; }
        case 0x68: case 0x6a: this.push(d.imm); break;
        case 0x69: case 0x6b: case 0x0faf: {
          const size = d.os;
          const a = this.rdRM(d, size), b = op === 0x0faf ? this.getReg(d.reg, size) : d.imm;
          const sa = size === 4 ? a | 0 : (a << 16) >> 16, sb = size === 4 ? b | 0 : (b << 16) >> 16;
          const r = size === 4 ? Math.imul(sa, sb) : ((sa * sb) << 16) >> 16;
          this.cf = this.of = sa * sb !== r ? 1 : 0;
          this.setReg(d.reg, size, r);
          break;
        }
        case 0x70: case 0x71: case 0x72: case 0x73: case 0x74: case 0x75: case 0x76: case 0x77:
        case 0x78: case 0x79: case 0x7a: case 0x7b: case 0x7c: case 0x7d: case 0x7e: case 0x7f:
          if (this.cond(op & 15)) this.eip = d.rel; break;
        case 0x80: case 0x81: case 0x83: {
          const size = op === 0x80 ? 1 : d.os;
          const M = size === 4 ? 0xffffffff : (1 << (size * 8)) - 1;
          const b = size === 4 ? d.imm >>> 0 : d.imm & M;
          if (d.mod === 3) {
            const r = this.alu(d.reg, this.getReg(d.rm, size), b, size);
            if (d.reg !== 7) this.setReg(d.rm, size, r);
          } else {
            const a = this.ea(d);
            const r = this.alu(d.reg, this.rdMem(a, size), b, size);
            if (d.reg !== 7) this.wrMem(a, size, r);
          }
          break;
        }
        case 0x84: case 0x85: { const size = op === 0x84 ? 1 : d.os; this.alu(4, this.rdRM(d, size), this.getReg(d.reg, size), size); break; }
        case 0x86: case 0x87: {
          const size = op === 0x86 ? 1 : d.os;
          const a = this.rdRM(d, size), b = this.getReg(d.reg, size);
          this.wrRM(d, size, b); this.setReg(d.reg, size, a);
          break;
        }
        case 0x88: case 0x89: { const size = op === 0x88 ? 1 : d.os; this.wrRM(d, size, this.getReg(d.reg, size)); break; }
        case 0x8a: case 0x8b: { const size = op === 0x8a ? 1 : d.os; this.setReg(d.reg, size, this.rdRM(d, size)); break; }
        case 0x8d: { if (d.mod === 3) this.fault('lea with register operand', at); const fs = d.fs; d.fs = false; this.setReg(d.reg, d.os, this.ea(d)); d.fs = fs; break; }
        case 0x8f: { const v = this.pop(); this.wrRM(d, 4, v); break; }
        case 0x90: break;
        case 0x91: case 0x92: case 0x93: case 0x94: case 0x95: case 0x96: case 0x97: {
          const r = op & 7, size = d.os, a = this.getReg(0, size);
          this.setReg(0, size, this.getReg(r, size)); this.setReg(r, size, a);
          break;
        }
        case 0x98: if (d.os === 2) this.setReg(0, 2, (regs[0] << 24) >> 24); else regs[0] = (regs[0] << 16) >> 16; break;
        case 0x99: if (d.os === 2) this.setReg(2, 2, (regs[0] << 16) >> 31); else regs[2] = regs[0] >> 31; break;
        case 0x9b: break; // fwait
        case 0x9c: this.push(this.eflags); break;
        case 0x9d: this.eflags = this.pop(); break;
        case 0x9e: { const ah = (regs[0] >>> 8) & 0xff; this.cf = ah & 1; this.pfb = ah & 4 ? 0 : 1; this.zf = (ah >> 6) & 1; this.sf = (ah >> 7) & 1; break; }
        case 0x9f: this.setReg(4, 1, this.eflags & 0xff); break;
        case 0xa0: case 0xa1: { const size = op === 0xa0 ? 1 : d.os; this.setReg(0, size, this.rdMem(((d.imm >>> 0) + (d.fs ? FS_BASE : 0)) >>> 0, size)); break; }
        case 0xa2: case 0xa3: { const size = op === 0xa2 ? 1 : d.os; this.wrMem(((d.imm >>> 0) + (d.fs ? FS_BASE : 0)) >>> 0, size, this.getReg(0, size)); break; }
        case 0xa4: case 0xa5: case 0xa6: case 0xa7: case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf:
          this.strop(d, op); break;
        case 0xa8: case 0xa9: { const size = op === 0xa8 ? 1 : d.os; const M = size === 4 ? 0xffffffff : (1 << (size * 8)) - 1; this.alu(4, this.getReg(0, size), d.imm & M, size); break; }
        case 0xb0: case 0xb1: case 0xb2: case 0xb3: case 0xb4: case 0xb5: case 0xb6: case 0xb7:
          this.setReg(op & 7, 1, d.imm); break;
        case 0xb8: case 0xb9: case 0xba: case 0xbb: case 0xbc: case 0xbd: case 0xbe: case 0xbf:
          this.setReg(op & 7, d.os, d.imm); break;
        case 0xc0: case 0xc1: case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
          const size = (op & 1) === 0 ? 1 : d.os;
          const cnt = op <= 0xc1 ? d.imm & 0xff : op <= 0xd1 ? 1 : regs[1] & 0xff;
          this.wrRM(d, size, this.shift(d.reg, this.rdRM(d, size), cnt, size));
          break;
        }
        case 0xc2: { const ret = this.pop(); regs[4] += d.imm & 0xffff; this.eip = ret; this.frames.pop(); break; }
        case 0xc3: { this.eip = this.pop(); this.frames.pop(); break; }
        case 0xc6: case 0xc7: { const size = op === 0xc6 ? 1 : d.os; this.wrRM(d, size, d.imm); break; }
        case 0xc9: regs[4] = regs[5]; regs[5] = this.pop(); break;
        case 0xcc: return this.fault('int3 (failed assertion?)', at);
        case 0xd8: case 0xd9: case 0xda: case 0xdb: case 0xdc: case 0xdd: case 0xde: case 0xdf:
          this.x87(d); break;
        case 0xd7: this.setReg(0, 1, mem.r8((regs[3] + (regs[0] & 0xff) + (d.fs ? FS_BASE : 0)) >>> 0)); break;
        case 0xe0: case 0xe1: case 0xe2: {
          regs[1] -= 1;
          const nz = regs[1] !== 0;
          if (op === 0xe2 ? nz : op === 0xe1 ? nz && this.zf === 1 : nz && this.zf === 0) this.eip = d.rel;
          break;
        }
        case 0xe3: if (regs[1] === 0) this.eip = d.rel; break;
        case 0xe8: this.callAt = at; this.push(d.next); this.frames.push(d.rel); this.eip = d.rel; this.entering = true; break;
        case 0xe9: case 0xeb: this.eip = d.rel; break;
        case 0xf5: this.cf ^= 1; break;
        case 0xf6: case 0xf7: this.grp3(d, op === 0xf6 ? 1 : d.os); break;
        case 0xf8: this.cf = 0; break;
        case 0xf9: this.cf = 1; break;
        case 0xfc: this.df = 0; break;
        case 0xfd: this.df = 1; break;
        case 0xfe: case 0xff: {
          const size = op === 0xfe ? 1 : d.os;
          switch (d.reg) {
            case 0: case 1: { const cf = this.cf; this.wrRM(d, size, this.alu(d.reg === 0 ? 0 : 5, this.rdRM(d, size), 1, size)); this.cf = cf; break; }
            case 2: { const t = this.rdRM(d, 4); this.callAt = at; this.push(d.next); this.frames.push(t); this.eip = t; this.entering = true; break; }
            case 4: this.eip = this.rdRM(d, 4); break;
            case 6: this.push(this.rdRM(d, 4)); break;
            default: this.fault(`unimplemented ff /${d.reg}`, at);
          }
          break;
        }
        default:
          if ((op & 0xff00) === 0x0f00) { this.twoByte(d, op & 0xff, at); break; }
          this.fault(`unimplemented opcode 0x${op.toString(16)}`, at);
      }
    }
  }

  private grp3(d: D, size: number) {
    const regs = this.regs;
    const M = size === 4 ? 0xffffffff : (1 << (size * 8)) - 1;
    switch (d.reg) {
      case 0: case 1: this.alu(4, this.rdRM(d, size), d.imm & M, size); return;
      case 2: { let r = ~this.rdRM(d, size) & M; if (size === 4) r >>>= 0; this.wrRM(d, size, r); return; }
      case 3: { const a = this.rdRM(d, size); const r = this.alu(5, 0, a, size); this.cf = a !== 0 ? 1 : 0; this.wrRM(d, size, r); return; }
      case 4: case 5: {
        const b = this.rdRM(d, size);
        if (size === 1) {
          const a = regs[0] & 0xff;
          const r = d.reg === 4 ? a * b : ((a << 24) >> 24) * ((b << 24) >> 24);
          this.setReg(0, 2, r & 0xffff);
          this.cf = this.of = d.reg === 4 ? (r > 0xff ? 1 : 0) : (r !== ((r << 24) >> 24) ? 1 : 0);
          return;
        }
        if (size === 2) {
          const a = regs[0] & 0xffff;
          const r = d.reg === 4 ? a * b : ((a << 16) >> 16) * ((b << 16) >> 16);
          this.setReg(0, 2, r & 0xffff); this.setReg(2, 2, (r >> 16) & 0xffff);
          this.cf = this.of = d.reg === 4 ? (r > 0xffff ? 1 : 0) : (r !== ((r << 16) >> 16) ? 1 : 0);
          return;
        }
        const p = d.reg === 4 ? BigInt(regs[0] >>> 0) * BigInt(b >>> 0) : BigInt(regs[0] | 0) * BigInt(b | 0);
        const lo = Number(BigInt.asUintN(32, p)), hi = Number(BigInt.asUintN(32, p >> 32n));
        regs[0] = lo; regs[2] = hi;
        this.cf = this.of = d.reg === 4 ? (hi !== 0 ? 1 : 0) : (BigInt.asIntN(32, p) !== p ? 1 : 0);
        return;
      }
      case 6: case 7: {
        const b = this.rdRM(d, size);
        if (b === 0) this.fault('division by zero', d.addr);
        if (size === 4) {
          let q: number, r: number;
          const lo = regs[0], hi = regs[2];
          if (d.reg === 6) {
            if (hi === 0) { q = Math.floor((lo >>> 0) / (b >>> 0)); r = (lo >>> 0) - q * (b >>> 0); }
            else {
              const n = (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
              const qb = n / BigInt(b >>> 0);
              if (qb > 0xffffffffn) this.fault('divide overflow', d.addr);
              q = Number(qb); r = Number(n % BigInt(b >>> 0));
            }
          } else {
            const sb = b | 0;
            if (hi === lo >> 31) { q = Math.trunc(lo / sb); r = lo - q * sb; if (q > 2147483647) this.fault('divide overflow', d.addr); }
            else {
              const n = (BigInt(hi) << 32n) | BigInt(lo >>> 0);
              const qb = n / BigInt(sb);
              if (qb > 2147483647n || qb < -2147483648n) this.fault('divide overflow', d.addr);
              q = Number(qb); r = Number(n % BigInt(sb));
            }
          }
          regs[0] = q; regs[2] = r;
          return;
        }
        if (size === 2) {
          const n = ((regs[2] & 0xffff) << 16) | (regs[0] & 0xffff);
          let q: number, r: number;
          if (d.reg === 6) { q = Math.floor((n >>> 0) / b); r = (n >>> 0) - q * b; }
          else { const sb = (b << 16) >> 16; q = Math.trunc(n / sb); r = n - q * sb; }
          this.setReg(0, 2, q); this.setReg(2, 2, r);
          return;
        }
        const n = regs[0] & 0xffff;
        let q: number, r: number;
        if (d.reg === 6) { q = Math.floor(n / b); r = n - q * b; }
        else { const sn = (n << 16) >> 16, sb = (b << 24) >> 24; q = Math.trunc(sn / sb); r = sn - q * sb; }
        this.setReg(0, 1, q); this.setReg(4, 1, r);
        return;
      }
    }
  }

  private twoByte(d: D, b: number, at: number) {
    const regs = this.regs;
    if (b >= 0x80 && b <= 0x8f) { if (this.cond(b & 15)) this.eip = d.rel; return; }
    if (b >= 0x90 && b <= 0x9f) { this.wrRM(d, 1, this.cond(b & 15) ? 1 : 0); return; }
    if (b >= 0x40 && b <= 0x4f) { const v = this.rdRM(d, d.os); if (this.cond(b & 15)) this.setReg(d.reg, d.os, v); return; }
    if (b >= 0xc8 && b <= 0xcf) { const r = b & 7, v = regs[r]; regs[r] = ((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24); return; }
    switch (b) {
      case 0xb6: this.setReg(d.reg, d.os, this.rdRM(d, 1)); return;
      case 0xb7: this.setReg(d.reg, d.os, this.rdRM(d, 2)); return;
      case 0xbe: this.setReg(d.reg, d.os, (this.rdRM(d, 1) << 24) >> 24); return;
      case 0xbf: this.setReg(d.reg, d.os, (this.rdRM(d, 2) << 16) >> 16); return;
      case 0xa3: case 0xab: case 0xb3: case 0xbb: case 0xba: {
        const size = d.os, bits = size * 8;
        const kind = b === 0xba ? d.reg - 4 : b === 0xa3 ? 0 : b === 0xab ? 1 : b === 0xb3 ? 2 : 3;
        const bit = (b === 0xba ? d.imm : this.getReg(d.reg, size)) & (bits - 1);
        if (d.mod !== 3 && b !== 0xba) {
          // bit string in memory: the register offset may address beyond the operand
          const off = this.getReg(d.reg, size) | 0;
          const a = (this.ea(d) + (off >> 3)) >>> 0;
          const v = this.mem.r8(a), m = 1 << (off & 7);
          this.cf = v & m ? 1 : 0;
          if (kind === 1) this.mem.w8(a, v | m); else if (kind === 2) this.mem.w8(a, v & ~m); else if (kind === 3) this.mem.w8(a, v ^ m);
          return;
        }
        const v = this.rdRM(d, size), m = (1 << bit) >>> 0;
        this.cf = (v >>> bit) & 1;
        if (kind === 1) this.wrRM(d, size, v | m); else if (kind === 2) this.wrRM(d, size, v & ~m); else if (kind === 3) this.wrRM(d, size, v ^ m);
        return;
      }
      case 0xa4: case 0xa5: case 0xac: case 0xad: {
        const size = d.os, bits = size * 8;
        const c = (b === 0xa4 || b === 0xac ? d.imm : regs[1]) & 0x1f;
        if (!c) return;
        const a = this.rdRM(d, size), s = this.getReg(d.reg, size);
        let r: number;
        if (b <= 0xa5) { this.cf = (a >>> (bits - c)) & 1; r = size === 4 ? ((a << c) | (s >>> (32 - c))) >>> 0 : ((a << c) | (s >>> (bits - c))) & 0xffff; }
        else { this.cf = (a >>> (c - 1)) & 1; r = size === 4 ? ((a >>> c) | (s << (32 - c))) >>> 0 : ((a >>> c) | (s << (bits - c))) & 0xffff; }
        this.szp(r, size);
        this.wrRM(d, size, r);
        return;
      }
      case 0xbc: case 0xbd: {
        const v = this.rdRM(d, d.os);
        if (v === 0) { this.zf = 1; return; }
        this.zf = 0;
        this.setReg(d.reg, d.os, b === 0xbc ? 31 - Math.clz32(v & -v) : 31 - Math.clz32(v));
        return;
      }
      case 0xa2: regs[0] = 0; regs[1] = 0; regs[2] = 0; regs[3] = 0; return; // cpuid: nothing supported
      case 0x31: regs[0] = this.steps; regs[2] = 0; return; // rdtsc
    }
    this.fault(`unimplemented opcode 0x0f${b.toString(16).padStart(2, '0')}`, at);
  }
}

/** a fresh CPU with the image mapped (image sections, stack, thread block) */
export function createCpu(img: ImageLike): Cpu {
  const mem = new Memory();
  mem.mapImage(img);
  return new Cpu(mem);
}
