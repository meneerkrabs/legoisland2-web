// z04IFC: the original's room code run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port (tools/tests/m5-audit-z04IFC-emu.mjs).
// Run natively from the user's executable: the controller update FUN_0054bce3 / camera FUN_0054c00d, the pin update FUN_0054b982 (+ its constructor FUN_0054bc04),
// the door update FUN_0054caa1, the sound loader FUN_0054cd70, the matrix builder, the C runtime. The engine (sounds, variables, animation, text, time, random) is a
// host table that records its calls. Nothing of the executable is stored here, only addresses.
import { createCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43af16, 0x43ae1e, 0x43cec0];
/** globals the room keeps (DAT_ addresses of the zone's code) */
export const G = { MENU_OPEN: 0x5d587c8, PINS_OFF: 0x5d587d0, EXIT_ASK: 0x5d587cc, DOOR_WANTED: 0x5d587d4, CAPTION: 0x5d4dd7c, CAM: 0x9da5e8, KEYS: 0x983840 };

export class IfcEmu {
  /** @param recs [{ name, m: 16 floats }] the record array; `rng()` returns the C runtime's rand() (0..32767), `clock()` FUN_00435c91 (ms since the zone clock base) */
  constructor(pe, recs, rng, clock = () => 0) {
    const cpu = (this.cpu = createCpu(pe));
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision (docs/re/engine-m1.md 8.1)
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x400000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x40000, name: 'records' });
    this.brk = HEAP_BASE;
    this.log = [];
    this.vars = new Map();
    this.ticks = 0;
    this.rng = rng;
    this.clock = clock;
    const L = this;
    mem.w32(0x983800, recs.length);
    mem.w32(0x983804, RECORDS_BASE);
    recs.forEach((r, i) => {
      const a = RECORDS_BASE + i * REC;
      for (let k = 0; k < 4; k++) mem.w8(a + k, k < r.name.length ? r.name.charCodeAt(k) : 0x20);
      r.m.forEach((v, k) => mem.wf32(a + 0xc + 4 * k, v));
      mem.w16(a + 0x60, 2);
    });
    // record 7 (Pepper) owns an animation object (record + 8)
    this.pepperAnim = this.alloc(16);
    mem.w32(RECORDS_BASE + 7 * REC + 8, this.pepperAnim);
    const H = cpu.hooks;
    const logf = (s) => this.log.push(s);
    H.set(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    H.set(0x433d60, (c) => { c.eax = 0; });
    H.set(0x417575, (c) => { c.eax = (L.vars.get(c.arg(0)) ?? 0) >>> 0; });
    H.set(0x417597, (c) => { L.vars.set(c.arg(0), c.arg(1) >>> 0); logf(`setVar ${c.arg(0)} ${((c.arg(1) - RECORDS_BASE) / REC) | 0}`); c.eax = 0; });
    H.set(0x435c91, (c) => { c.eax = L.clock(); });
    // FUN_004388ae(x) = x <= 0 ? 0 : (float)((float)rand() / 32767 * x) (24-bit x87: float32 per operation; no draw for x <= 0)
    H.set(0x4388ae, (c) => { const x = c.argf(0); c.fpush(x <= 0 ? 0 : Math.fround(Math.fround(L.rng() / 32767) * x)); });
    H.set(0x4359d5, (c) => { c.eax = 0; });
    H.set(0x41f17c, (c) => { c.eax = 0; });
    H.set(0x443580, (c) => { c.eax = c.arg(0); });                    // the sound loaders return the id
    H.set(0x4435a0, (c) => { logf(`p ${c.arg(0)}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s ${c.arg(0)}`); c.eax = 0; });
    H.set(0x43b6a3, (c) => { logf(`clip ${c.arg(1)}`); c.eax = 1; });
    H.set(0x43b76a, (c) => { logf(`adv ${c.argf(1)} ${mem.f32(0x8b1718)}`); c.eax = 0; });   // FUN_0043b76a steps by rate * DAT_008b1718
    H.set(0x43cc5c, (c) => { c.eax = 0; });                            // view basis
    H.set(0x4201aa, (c) => { c.eax = 0; });
    // FUN_00439788(table, id) returns the text (here: the id itself); FUN_0085ac00(dest, text) copies it (the caption)
    H.set(0x439788, (c) => { c.eax = c.arg(1); });
    H.set(0x85ac00, (c) => { const s = mem.cstr(c.arg(1)); for (let i = 0; i < s.length; i++) mem.w8(c.arg(0) + i, s.charCodeAt(i)); mem.w8(c.arg(0) + s.length, 0); c.eax = s.length; });
    cpu.exec = [[0x54916a, 0x568fe1], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { logf(`unhooked_${addr.toString(16)}`); c.eax = 0; };
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  f(a) { return this.cpu.mem.f32(a); }
  i(a) { return this.cpu.mem.r32(a); }
  /** FUN_0054cd70: the sound slots (DAT_05d587d8 .. 05d5880c): handles = sound ids */
  loadSounds() { this.cpu.call(0x54cd70, []); }
  /** the controller node (0x20 bytes: state +0x18 = 0, counter +0x1c = 0), the door node, and pin nodes through the constructor FUN_0054bc04(rec, {page, id}, 0, 0, 2, 1) */
  makeController() { this.ctl = this.alloc(0x20); return this.ctl; }
  makeDoor() { this.door = this.alloc(0x20); return this.door; }
  makePin(rec, page, id) {
    const mem = this.cpu.mem;
    const blk = this.alloc(32); mem.w32(blk, page);
    for (let k = 0; k < id.length; k++) mem.w8(blk + 4 + k, id.charCodeAt(k));
    const n = this.cpu.call(0x54bc04, [this.recPtr(rec), blk, 0, 0, 2, 1]);
    (this.pins ??= new Map()).set(rec, n);
    return n;
  }
  select(rec) { this.vars.set(0xfa, this.recPtr(rec)); }
  /** one tick in the order of the passes (records in index order): update pass (Pepper's controller 7, the door 30, the pins), then the pre-render of the controller */
  tick(pressed, pinRecs) {
    this.ticks++;
    this.log = [];
    const mem = this.cpu.mem, cpu = this.cpu;
    mem.w32(G.KEYS, pressed);
    cpu.call(0x54bce3, [this.recPtr(7), this.ctl]);
    cpu.call(0x54caa1, [this.recPtr(30), this.door]);
    for (const r of pinRecs) cpu.call(0x54b982, [this.recPtr(r), this.pins.get(r)]);
    cpu.call(0x54c00d, [this.recPtr(7), this.ctl]);
    return this.log;
  }
}
