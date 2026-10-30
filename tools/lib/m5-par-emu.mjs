// z38PAR (M5 audit): the original's pilot code run in the x86 interpreter (src/formats/x86emu.ts) as an ORACLE for the TypeScript port (tools/tests/m5-audit-z38PAR-emu.mjs).
// Native from the user's own executable: the pilot constructor FUN_0046a926 and update FUN_004686a3 (649 lines: the dive, the chute, the rings, the landing, the bounce, the wind,
// the camera), the HUD feed FUN_00466f50, the sound loads FUN_00467370, the matrix helpers, the C runtime. Hosted: animation instances (the port's AnimInstance), sounds, speech,
// random numbers, particles, the BIG engine queries (sweep FUN_00441270, probe FUN_00441ac0, the shadow's ground ray FUN_00442a70, the pterodactyl box FUN_00468590), which are
// answered by the port's own collision code over the port's world (so they are NOT verified here: the oracle checks everything around them).
import { createGameCpu } from '../../src/formats/x86emu.ts';

export const RECORDS_BASE = 0x10000000, HEAP_BASE = 0x20000000;
const REC = 0x68;
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43ac78, 0x43af16, 0x43ae1e, 0x43cec0, 0x43ad29, 0x43b022, 0x43cfee, 0x890290, 0x43b00b];

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

export class ParEmu {
  /**
   * @param recs the records of the oracle's world ({ name, m, flags, rx, ry, rz })
   * @param anims Map(record index -> AnimInstance of the oracle's own world)
   * @param o { rand(range): number (the port's FUN_004388ae), col: { sweep(recIdx, from, delta, mask, r, s) -> {rec, point, normal} | null, probe(...), ground(from) -> point | null, box(recIdx, a, b, outP, outN) -> boolean } }
   */
  constructor(pe, recs, anims, o) {
    const cpu = (this.cpu = createGameCpu(pe));
    const mem = cpu.mem;
    this.pe = pe;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x100000, name: 'heap' });
    mem.addRegion({ lo: RECORDS_BASE, hi: RECORDS_BASE + 0x10000, name: 'records' });
    this.brk = HEAP_BASE;
    this.log = []; this.nodes = {}; this.anims = new Map(); this.animRec = new Map(); this.unhooked = new Map(); this.speechIds = [];
    this.rand = o.rand; this.col = o.col;
    this.nRecs = recs.length;
    mem.w32(0x983800, recs.length); mem.w32(0x983804, RECORDS_BASE);
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
    H.set(0x4388ae, (c) => { c.fpush(L.rand(c.argf(0))); });
    H.set(0x443580, (c) => { c.eax = c.arg(0) | 0x100000; });
    H.set(0x4433b0, (c) => { c.eax = c.arg(0) | 0x200000; });
    H.set(0x4435a0, (c) => { logf(`p ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4435b0, (c) => { logf(`s ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x4434b0, (c) => { logf(`s ${c.arg(0) & 0xfffff}`); c.eax = 0; });
    H.set(0x443600, (c) => { logf(`r ${c.arg(0) & 0xfffff} ${c.arg(1) | 0}`); c.eax = 0; });
    H.set(0x4433f0, (c) => { const p = c.arg(1); logf(`p3 ${c.arg(0) & 0xfffff} ${[0, 1, 2].map((k) => mem.f32(p + 4 * k).toFixed(2)).join(',')}`); c.eax = 0; });
    H.set(0x439bf8, (c) => { const id = pe.cstr(c.arg(1)); let t = L.speechIds.indexOf(id); if (t < 0) { t = L.speechIds.length; L.speechIds.push(id); } mem.w32(c.arg(2), t + 1); c.eax = 0; });
    H.set(0x435a11, (c) => { const a = c.arg(0), b = c.arg(1); logf(`say ${L.speechIds[a - 1]}${b !== 0xffffffff ? `+${L.speechIds[b - 1]}` : ''}`); c.eax = 0; });
    for (const a of [0x442960, 0x4429a0, 0x442a50, 0x442a20, 0x442a00]) H.set(a, (c) => { c.eax = 0x100; });
    H.set(0x85ac00, (c) => {
      const s = sprintf(mem, mem.cstr(c.arg(1)), [c.arg(2), c.arg(3), c.arg(4)]);
      for (let i = 0; i < s.length; i++) mem.w8(c.arg(0) + i, s.charCodeAt(i));
      mem.w8(c.arg(0) + s.length, 0);
      c.eax = s.length;
    });
    const inst = (c) => L.anims.get(c.arg(0));
    H.set(0x43b6a3, (c) => { const a = inst(c); logf(`anim ${L.animRec.get(c.arg(0))} ${c.arg(1) & 0xff} ${c.argf(2)}`); c.eax = a && a.start(c.arg(1) & 0xff, c.argf(2)) ? 1 : 0; });
    H.set(0x43b76a, (c) => { const a = inst(c); c.eax = a ? a.advance(c.argf(1)) : 0; });
    H.set(0x43b73f, (c) => { const a = inst(c); c.fpush(a ? a.frame : 0); });
    H.set(0x43b72b, (c) => { const a = inst(c); c.eax = a ? a.clip : 0; });
    H.set(0x43b753, (c) => { const a = inst(c); c.fpush(a ? a.frameCount : 0); });
    H.set(0x43b64d, (c) => { const a = inst(c); c.eax = a && a.seek(c.argf(1)) ? 1 : 0; });
    H.set(0x43bc58, (c) => { c.eax = L.bufOf(c.arg(0)) + c.arg(1) * 0x40; });
    const recIdx = (p) => ((p - RECORDS_BASE) / REC) | 0;
    const v3 = (p) => [mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)];
    const put3 = (p, v) => { mem.wf32(p, v[0]); mem.wf32(p + 4, v[1]); mem.wf32(p + 8, v[2]); };
    // FUN_00441270(rec, from*, delta*, outNormal*, outPoint*, mask, radius, skin) -> the hit record (pointer) or 0; FUN_00441ac0: the probe
    H.set(0x441270, (c) => {
      const h = L.col.sweep(recIdx(c.arg(0)), v3(c.arg(1)), v3(c.arg(2)), c.arg(5), c.argf(6), c.argf(7));
      logf(`sweep ${h ? h.rec : '-'}`);
      if (!h) { c.eax = 0; return; }
      put3(c.arg(3), h.normal); put3(c.arg(4), h.point); c.eax = RECORDS_BASE + h.recIdx * REC;      // (the 4th argument receives the NORMAL, the 5th the point: FUN_0043cfee(bounce, delta, local_18))
    });
    H.set(0x441ac0, (c) => {
      const h = L.col.probe(recIdx(c.arg(0)), v3(c.arg(1)), v3(c.arg(2)), c.arg(5));
      logf(`probe ${h ? h.rec : '-'}`);
      if (!h) { c.eax = 0; return; }
      put3(c.arg(3), h.normal); put3(c.arg(4), h.point); c.eax = RECORDS_BASE + h.recIdx * REC;      // (the 4th argument receives the NORMAL, the 5th the point: FUN_0043cfee(bounce, delta, local_18))
    });
    // FUN_00442a70(canopy record, land record, 2.0, 0.4, out[15 floats], 0): the ray from 150 above the canopy record onto the land; the hit point goes to out[3..5], its height + 8 * 0.4 to out[4]
    H.set(0x442a70, (c) => {
      const p = L.col.ground(recIdx(c.arg(0)));
      logf(`ground ${p ? p.map((v) => v.toFixed(2)).join(',') : '-'}`);
      if (!p) { c.eax = 0; return; }
      const out = c.arg(4);
      put3(out + 12, p);
      mem.wf32(out + 16, p[1] + c.argf(3) * 8);
      c.eax = 1;
    });
    // FUN_00468590(rec, a*, b*, outPoint*, outNormal*): the segment against the record's collision box
    H.set(0x468590, (c) => {
      const op = [0, 0, 0], on = [0, 0, 0];
      const hit = L.col.box(recIdx(c.arg(0)), v3(c.arg(1)), v3(c.arg(2)), op, on);
      logf(`box ${recIdx(c.arg(0))} ${hit ? 1 : 0}`);
      if (hit) { put3(c.arg(3), op); put3(c.arg(4), on); }
      c.eax = hit ? 1 : 0;
    });
    cpu.exec = [[0x465539, 0x470a20], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = (addr) => (c) => { L.unhooked.set(addr, (L.unhooked.get(addr) ?? 0) + 1); c.eax = 0; };
  }
  alloc(n) { const p = this.brk; this.brk += (n + 15) & ~15; return p; }
  recPtr(i) { return RECORDS_BASE + i * REC; }
  bufOf(animPtr) {
    this.poseBuf ??= new Map();
    let b = this.poseBuf.get(animPtr);
    if (!b) { b = this.alloc(64 * 40); this.poseBuf.set(animPtr, b); }
    return b;
  }
  construct(peppIdx) {
    const cpu = this.cpu;
    cpu.call(0x467370, []);        // FUN_00467370: the zone's sound loads
    cpu.steps = 0;
    cpu.call(0x46a926, [this.recPtr(peppIdx), 0, 0, 2, 1, 1], { maxSteps: 5_000_000 });
    this.node = this.nodes[0xe0];
    return this.node;
  }
  /** the pilot's update (record PEPP, node) */
  tick(peppIdx, held, pressed) {
    this.log = [];
    const mem = this.cpu.mem;
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed);
    this.cpu.steps = 0;
    this.cpu.call(0x4686a3, [this.recPtr(peppIdx), this.node], { maxSteps: 20_000_000 });
    return this.log;
  }
  /** the HUD feed FUN_00466f50 (every tick after the update) */
  hud() {
    this.cpu.steps = 0;
    this.cpu.call(0x466f50, [], { maxSteps: 5_000_000 });
  }
}
