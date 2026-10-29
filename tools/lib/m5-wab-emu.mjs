// z05WAB (M5 audit): the original's whack-a-bot code run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port (tools/tests/m5-audit-z05WAB-emu.mjs).
// Executed natively from the user's own executable: the two constructors FUN_0056b2d5 (botwab) / FUN_0056cd3b (pepwab), the updates FUN_00569f50 / FUN_0056c950 with everything
// they call in the zone (FUN_0056bb20 presentation, FUN_0056c6a5 whack animation, FUN_0056c8f1 alarm light, FUN_0056b1dc), the camera helpers FUN_00422c7e / FUN_00422ddc, the
// matrix builder, the C runtime. The engine (animation instances = the port's AnimInstance, sounds, speech, texture frames, random numbers, particles) is a host table that
// records its calls. Nothing of the executable is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43af16, 0x43ae1e, 0x43cec0, 0x43b00b, 0x422c7e, 0x422ddc];

/** a small printf for the formats the zone uses: %d, %02d, %2d, %%, %s */
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
    if (t === 's') { out += mem.cstr(args[ai++]); i = j; continue; }
    throw new Error(`sprintf: unsupported format ${fmt}`);
  }
  return out;
}

export class WabEmu {
  /**
   * @param pe the executable
   * @param recs the records of the oracle's own world ({ name, m, flags, rx, ry, rz })
   * @param pepAnim the AnimInstance of the oracle's world for record 0
   * @param o { rand(): number } the scripted integer the random-number function returns (FUN_004388ae, the port draws `value % n` from the same sequence)
   */
  constructor(pe, recs, pepAnim, o) {
    const cpu = (this.cpu = createCpu(pe));
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x100000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x10000, name: 'records' });
    this.brk = HEAP_BASE;
    this.log = []; this.fxlog = [];
    this.texts = [];
    this.ticks = 0;
    this.rand = o.rand;
    this.speechIds = [];
    this.unhooked = new Map();
    this.nodes = {};
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    this.recs = recs;
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.wf32(a + 0x4c, r.rx); mem.wf32(a + 0x50, r.ry); mem.wf32(a + 0x54, r.rz);
      mem.w32(a + 4, 0x40000000 + i * 0x100);          // the model pointer: a token per record
      mem.w16(a + 0x60, r.flags);
    });
    this.anim = pepAnim;
    const pa = this.alloc(16); mem.w32(RECORDS_BASE + 8, pa); this.animPtr = pa;
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    const L = this;
    H.set(0x433d38, (c) => { const p = L.alloc(c.arg(0)); L.nodes[c.arg(0)] = p; c.eax = p; });
    H.set(0x435c91, (c) => { c.eax = Math.trunc(L.ticks * 1000 / 30); });
    // FUN_004388ae(range): the scripted integer (the port draws `value % n` from the same sequence)
    H.set(0x4388ae, (c) => { c.fpush(L.rand()); });
    // sounds
    H.set(0x443580, (c) => { c.eax = c.arg(0) | 0x100000; });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0) | 0x200000; });
    H.set(0x4435a0, (c) => { logf(`p ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4433f0, (c) => { const p = c.arg(1); logf(`p3 ${c.arg(0) & 0xfffff} ${[0, 1, 2].map((k) => mem.f32(p + 4 * k).toFixed(2)).join(',')}`); c.eax = 0; });
    // speech
    H.set(0x439bf8, (c) => { const id = pe.cstr(c.arg(1)); let t = L.speechIds.indexOf(id); if (t < 0) { t = L.speechIds.length; L.speechIds.push(id); } mem.w32(c.arg(2), t + 1); c.eax = 0; });
    H.set(0x435a11, (c) => { const a = c.arg(0), b = c.arg(1); logf(`say ${L.speechIds[a - 1]}${b !== 0xffffffff ? `+${L.speechIds[b - 1]}` : ''}`); c.eax = 0; });
    // particles: the calls are recorded in `fxlog` (handles are numbered in the order of the start calls) and compared with the port's emitter calls (tools/tests/m5-audit-z05WAB-emu.mjs)
    L.nh = 0;
    const recIdx = (m) => (m - RECORDS_BASE - 0xc) / REC;
    const f3 = (a) => [0, 1, 2].map((k) => mem.f32(a + 4 * k)).join(',');
    const startLog = (kind) => (c) => {
      const h = L.nh++; const a = (k) => c.arg(k), fl = (k) => c.argf(k);
      L.fxlog.push(kind === 'swirl' ? `swirl ${h} ${pe.cstr(a(0))} ${fl(2)},${fl(3)},${fl(4)} ${fl(5)},${fl(6)},${fl(7)} ${a(8)}${a(9)}${a(10)}`
        : `start ${h} ${pe.cstr(a(0))} rec${recIdx(a(1))} ${fl(2)},${fl(3)},${fl(4)} ${fl(5)},${fl(6)},${fl(7)} ${a(8)}${a(9)}${a(10)}`);
      c.eax = h;
    };
    H.set(0x4429a0, startLog('swirl')); H.set(0x442960, startLog('start'));
    H.set(0x442a50, (c) => { L.fxlog.push(`coll ${c.arg(0)} rec${(c.arg(1) - RECORDS_BASE) / REC}`); c.eax = 0; });
    H.set(0x442a20, (c) => { L.fxlog.push(`gate ${c.arg(0)} ${c.arg(1)} ${c.arg(2)} ${c.arg(3)}`); c.eax = 0; });
    H.set(0x442a00, (c) => { L.fxlog.push(`matrix ${c.arg(0)} ${Array.from({ length: 16 }, (_, k) => mem.f32(c.arg(1) + 4 * k)).join(',')}`); c.eax = 0; });
    // texture frames / uv scroll: FUN_00443120(model, 0, slot, 2, frame), FUN_0043ebe0(model, 0x1642, &group, &dv)
    H.set(0x443120, (c) => {
      const rec = ((c.arg(0) - 0x40000000) / 0x100) | 0;
      const target = rec === 45 ? 'flsh' : rec === 1 ? 'land' : `?${rec}`;
      L.frames.push([target, c.arg(2), c.arg(4) | 0]);
      c.eax = 0;
    });
    this.frames = [];
    H.set(0x43ebe0, (c) => { logf(`u ${mem.f32(c.arg(2))} ${mem.f32(c.arg(3)).toFixed(6)}`); c.eax = 0; });
    // sprintf(dest, fmt, args...)
    H.set(0x85ac00, (c) => {
      const f = mem.cstr(c.arg(1));
      const s = sprintf(mem, f, [c.arg(2), c.arg(3), c.arg(4)]);
      for (let i = 0; i < s.length; i++) mem.w8(c.arg(0) + i, s.charCodeAt(i));
      mem.w8(c.arg(0) + s.length, 0);
      c.eax = s.length;
    });
    H.set(0x439c6f, (c) => { L.texts.push({ text: mem.cstr(c.arg(2)), x: c.arg(5), y: c.arg(6), wrap: c.arg(7) }); c.eax = 0; });
    // animation instances (the port's AnimInstance of record 0)
    const inst = () => L.anim;
    H.set(0x43b6a3, (c) => { logf(`anim ${c.arg(1) & 0xff}`); c.eax = inst().start(c.arg(1) & 0xff, c.argf(2)) ? 1 : 0; });
    H.set(0x43b76a, (c) => { c.eax = inst().advance(c.argf(1), mem.f32(0x8b1718)); });   // FUN_0043b76a steps by rate * DAT_008b1718
    H.set(0x43b73f, (c) => { c.fpush(inst().frame); });
    H.set(0x43b72b, (c) => { c.eax = inst().clip; });
    cpu.exec = [[0x56885a, 0x5726f0], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }

  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }

  /** FUN_00569dd0 (the zone's sounds), the two constructors as the attach calls them (record 0 pepwab, record 1 botwab) */
  construct() {
    const cpu = this.cpu;
    cpu.call(0x569dd0, []);
    cpu.steps = 0;
    cpu.call(0x56cd3b, [this.recPtr(0), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.pep = this.nodes[0x1c];
    cpu.call(0x56b2d5, [this.recPtr(1), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.bot = this.nodes[0x194];
    return [this.pep, this.bot];
  }
  /** one tick: the buttons that went down, Pepper's update (record 0), then the game's (record 1) */
  tick(pressed) {
    this.ticks++;
    this.fxlog = [];
    this.log = []; this.texts = []; this.frames = [];
    const mem = this.cpu.mem;
    mem.w32(0x983840, pressed);
    this.cpu.steps = 0;
    this.cpu.call(0x56c950, [this.recPtr(0), this.pep], { maxSteps: 5_000_000 });
    this.cpu.call(0x569f50, [this.recPtr(1), this.bot], { maxSteps: 5_000_000 });
    return this.log;
  }
}
