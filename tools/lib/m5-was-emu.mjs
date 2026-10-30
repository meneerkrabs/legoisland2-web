// z17WAS (M5 audit): the original's whack-a-snake code run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port (tools/tests/m5-audit-z17WAS-emu.mjs).
// Native from the user's own executable: the constructors FUN_0069b337 (zonewas) / FUN_0069bf24 (pepwas), the updates FUN_00699e80 / FUN_0069b9b0, the matrix helpers and the C runtime.
// Hosted engine: animation instances (the port's AnimInstance of the oracle's own world), the pose buffer (evaluated "by the renderer" after every tick, like the loop's draw),
// sounds, texts, random numbers (a scripted integer), particles. Nothing of the executable is stored here, only addresses.
import { createGameCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43af16, 0x43ae1e, 0x43cec0, 0x43b00b];

function sprintf(mem, fmt, args) {
  let ai = 0, out = '';
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') { out += c; continue; }
    let j = i + 1, zero = false, w = '';
    if (fmt[j] === '0') { zero = true; j++; }
    while (/\d/.test(fmt[j])) w += fmt[j++];
    const t = fmt[j];
    if (t === '%') { out += '%'; i = j; continue; }
    if (t === 'd') { let s = String(args[ai++] | 0); if (w) s = s.padStart(+w, zero ? '0' : ' '); out += s; i = j; continue; }
    throw new Error(`sprintf: unsupported format ${fmt}`);
  }
  return out;
}

export class WasEmu {
  /**
   * @param pe the executable
   * @param recs the records of the oracle's world ({ name, m, flags, rx, ry, rz })
   * @param anims Map(record index -> AnimInstance of the oracle's world)
   * @param o { rand(): number }
   */
  constructor(pe, recs, anims, o) {
    const cpu = (this.cpu = createGameCpu(pe));
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x100000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x10000, name: 'records' });
    this.brk = HEAP_BASE;
    this.log = []; this.texts = []; this.ticks = 0;
    this.rand = o.rand;
    this.unhooked = new Map();
    this.nodes = {};
    this.anims = new Map(); this.animRec = new Map(); this.poseBuf = new Map();
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    this.recs = recs;
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.wf32(a + 0x4c, r.rx); mem.wf32(a + 0x50, r.ry); mem.wf32(a + 0x54, r.rz);
      mem.w32(a + 4, 0x40000000 + i * 0x100);
      mem.w16(a + 0x60, r.flags);
      const an = anims.get(i);
      if (an) { const p = this.alloc(16); mem.w32(a + 8, p); this.anims.set(p, an); this.animRec.set(p, i); }
    });
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    const L = this;
    H.set(0x433d38, (c) => { const p = L.alloc(c.arg(0)); L.nodes[c.arg(0)] = p; c.eax = p; });
    H.set(0x435c91, (c) => { c.eax = Math.trunc(L.ticks * 1000 / 30); });
    // FUN_004388ae(range): rand() / 32767 * range. The tick-time calls (`ftol(rand(GetTickCount - start)) & 3` / `% 3`) take the scripted integer as it is (the port draws `value % n`);
    // the call with the constant range 8.0 (Pepper's grunt: `ftol(rand(8.0))` compared with 0 / 1) returns a value below 8
    H.set(0x4388ae, (c) => { const r = c.argf(0), v = L.rand(); c.fpush(r === 8 ? v % 8 : v); });
    H.set(0x443580, (c) => { c.eax = c.arg(0) | 0x100000; });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0) | 0x200000; });
    H.set(0x4435a0, (c) => { logf(`p ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4433f0, (c) => { const p = c.arg(1); logf(`p3 ${c.arg(0) & 0xfffff} ${[0, 1, 2].map((k) => mem.f32(p + 4 * k).toFixed(2)).join(',')}`); c.eax = 0; });
    for (const a of [0x4429a0, 0x442960, 0x442a50, 0x442a20, 0x442a00]) H.set(a, (c) => { c.eax = 0x100; });
    H.set(0x85ac00, (c) => {
      const s = sprintf(mem, mem.cstr(c.arg(1)), [c.arg(2), c.arg(3), c.arg(4)]);
      for (let i = 0; i < s.length; i++) mem.w8(c.arg(0) + i, s.charCodeAt(i));
      mem.w8(c.arg(0) + s.length, 0);
      c.eax = s.length;
    });
    H.set(0x439c6f, (c) => { L.texts.push({ text: mem.cstr(c.arg(2)), x: c.arg(5), y: c.arg(6), wrap: c.arg(7) }); c.eax = 0; });
    const inst = (c) => L.anims.get(c.arg(0));
    H.set(0x43b6a3, (c) => { const a = inst(c); c.eax = a && a.start(c.arg(1) & 0xff, c.argf(2)) ? 1 : 0; });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1)) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b753, (c) => { const a = inst(c); c.fpush(a ? a.frameCount : 0); });
    H.set(0x43b72b, (c) => { const a = inst(c); c.eax = a ? a.clip : 0; });
    H.set(0x43b64d, (c) => { const a = inst(c); c.eax = a && a.seek(c.argf(1)) ? 1 : 0; });
    // FUN_0043bc58(anim, bone): the matrices the renderer left in the animation's buffer (`render()` below fills them)
    H.set(0x43bc58, (c) => { c.eax = L.bufOf(c.arg(0)) + c.arg(1) * 0x40; });
    cpu.exec = [[0x6986fe, 0x6a21b0], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }

  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  bufOf(animPtr) {
    let b = this.poseBuf.get(animPtr);
    if (!b) { b = this.alloc(64 * 40); this.poseBuf.set(animPtr, b); }
    return b;
  }
  /** what the loop's render pass leaves behind: FUN_0043ba7a evaluates the pose of every visible animated record into its buffer */
  render(visible) {
    const mem = this.cpu.mem;
    for (const [p, a] of this.anims) {
      const i = this.animRec.get(p);
      if (!visible(i, mem.r16(RECORDS_BASE + i * REC + 0x60))) continue;
      const pose = a.pose(1);
      if (!pose) continue;
      const b = this.bufOf(p);
      for (let k = 0; k < pose.length; k++) mem.wf32(b + k * 4, pose[k]);
    }
  }
  construct(pepIndex, wasIndex) {
    const cpu = this.cpu;
    cpu.call(0x699950, []);           // FUN_00699950: the zone's sound loads (the handles of the player calls)
    cpu.steps = 0;
    cpu.call(0x69bf24, [this.recPtr(pepIndex), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.pep = this.nodes[0x24];
    cpu.call(0x69b337, [this.recPtr(wasIndex), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.was = this.nodes[0x154];
    return [this.pep, this.was];
  }
  tick(pressed, pepIndex, wasIndex) {
    this.ticks++;
    this.log = []; this.texts = [];
    this.cpu.mem.w32(0x983840, pressed);
    this.cpu.steps = 0;
    this.cpu.call(0x69b9b0, [this.recPtr(pepIndex), this.pep], { maxSteps: 5_000_000 });
    this.cpu.call(0x699e80, [this.recPtr(wasIndex), this.was], { maxSteps: 5_000_000 });
    return this.log;
  }
}
