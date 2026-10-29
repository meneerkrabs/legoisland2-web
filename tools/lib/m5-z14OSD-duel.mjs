// M5 z14OSD (the Oasis), the ORACLE harness: the ORIGINAL's node framework and the Oasis' node code run natively in the x86 emulation (src/formats/x86emu.ts) next to the port's nodes
// (src/zones/z14OSD/*), driven by the same scripted inputs, compared tick by tick (the structure of tools/lib/m7-isl-veh-emu.mjs `IslEmu` + `Duel`, generalised to a hub zone).
//   native (the user's own executable, addresses only): the node framework (update pass FUN_0042226e, the probe pass FUN_00427233, the pre-render pass FUN_004225c5, controller creation
//   FUN_0042382c, attach FUN_00423532, the squared distance FUN_0042216f, FUN_004242f0 "where is Pepper", the probe arming FUN_00427014), the zone's code 0x627a52..0x656400 (the node
//   constructors / update / pre-render handlers of Tumblewd 0x629d7e, scorpion 0x62ad35 + the grab node 0x62af8d, Gems 0x62b220, PEPPSW 0x62ba3b, the HUD function FUN_00628410, the sound
//   loader FUN_006285e0, the vehicle-look code 0x655dc0..0x656400), the walk code's sound loaders (FUN_004b037e / FUN_004b0b37 / FUN_004b0f16: the handles of the gem pick-up, the board ...),
//   the engine's random FUN_004388ae itself (only the CRT's rand() FUN_0085daf0 below it is a host: it returns the next integer of the shared script, and the port draws the same integers
//   through `setAmbientRandom`), the matrix helpers and the C runtime.
//   hosted (NOT the subject; each is commented in tools/lib/m7-zone-emu.mjs / m7-isl-veh-emu.mjs): game variables, collision (the port's CollisionWorld over a mirror of the original's records, or
//   a SCRIPTED ground when a scenario asks for one: the same function answers both sides), animation instances (the port's AnimInstance), sounds (logged with the id of the sound the
//   handle was loaded with), particles / render calls (logged or ignored), the music groove FUN_00443310 (logged).
//   The machine state (data / bss pages: the sound handle globals, the board record DAT_009daa7c, the tables of the vehicle looks ...) is the one the original's own set-up left in the
//   emulation of `IslandSetup` (src/formats/emusetup.ts); the pages are copied into this CPU.
import { ZoneEmu, RECORDS_BASE, REC, fr } from './m7-zone-emu.mjs';
import { IslEmu, VAR_ARRAY, VAR_COUNT, HEAP_BASE } from './m7-isl-veh-emu.mjs';
import { loadHub } from './hub-load.mjs';
import { loadExe } from './engine-load.mjs';
import '../../src/zones/index.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';
import { ctrlExtra, probeResult } from '../../src/island/npc/globals.ts';
import { applySubMatrices } from '../../src/zones/z14OSD/setup.ts';
import { TumbleweedNode } from '../../src/zones/z14OSD/tumbleweed.ts';
import { ScorpionNode, ScorpionGrabNode } from '../../src/zones/z14OSD/scorpion.ts';
import { GemNode } from '../../src/zones/z14OSD/gems.ts';
import { PeppSwNode } from '../../src/zones/z14OSD/peppsw.ts';
import { Hud } from '../../src/shell/hud.ts';
import { OsdHudState, initOsdHud, updateOsdHud } from '../../src/zones/z14OSD/hud.ts';

export { RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT, fr };
/** button bit -> browser key code is not needed: the duel sets the port's input words directly (as tools/lib/m7-isl-veh-emu.mjs `Duel.tick`) */
export const B = { LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, CTRL: 0x10, ALT: 0x20, SHIFT: 0x40, SPACE: 0x80, ENTER: 0x10000 };

/** the constructors of the nodes under test (the addresses the set-up attached them with) and the port classes they map to */
export const CTOR = { TUM: 0x629d7e, SCR: 0x62ad35, GRAB: 0x62af8d, GEM: 0x62b220, SW: 0x62ba3b };
const PORT_CLASS = { TUM: TumbleweedNode, SCR: ScorpionNode, GRAB: ScorpionGrabNode, GEM: GemNode, SW: PeppSwNode };

/** code run natively: the node framework + SGGen (0x4201aa..0x433800), FUN_004388ae, the walk code's sound loaders, the zone code incl. the vehicle looks (0x627a52..0x656400) */
export const OSD_EXEC = [[0x4201aa, 0x433800], [0x4388ae, 0x4388e7], [0x4b0000, 0x4b2000], [0x627a52, 0x656400]];

/** a seeded generator in [0, 1): the port's `setAmbientRandom` source; the original's CRT rand() gets `floor(u * 32768)` (FUN_004388ae = rand / 32767 * max in the port's `rand`) */
export function stream(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
export const lcg = stream;

/** C printf for `%0Nd` / `%Nd` / `%d` (the host of FUN_0085ac00: m7-zone-emu's version pads negative numbers wrongly) */
function sprintf(fmt, args) {
  let ai = 0, out = '';
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') { out += c; continue; }
    let j = i + 1, zero = false, w = '';
    if (fmt[j] === '0') { zero = true; j++; }
    while (/\d/.test(fmt[j])) w += fmt[j++];
    if (fmt[j] === '%') { out += '%'; i = j; continue; }
    if (fmt[j] !== 'd') throw new Error(`sprintf: unsupported format ${fmt}`);
    const n = args[ai++] | 0;
    let s = String(Math.abs(n)); const neg = n < 0;
    if (w) { const width = +w - (neg ? 1 : 0); if (zero) s = s.padStart(width, '0'); }
    s = (neg ? '-' : '') + s;
    if (w && !zero) s = s.padStart(+w, ' ');
    out += s; i = j;
  }
  return out;
}

const IMPORTED = ['argBlock', 'attach', 'controller', 'append', 'rawNode', 'setFocus'];

export class OsdEmu extends ZoneEmu {
  /**
   * @param pe the executable
   * @param O the ORACLE world (`loadHub` result of z14OSD: records = the collision mirror, anims = animation instances, `O.emu` = the emulated set-up whose memory seeds this CPU)
   * @param o { dt }
   */
  constructor(pe, O, o) {
    const anims = new Map();
    for (const r of O.world.records) if (r.anim) anims.set(r.index, r.anim);
    super(pe, { records: O.world.records, world: O.world, anims, pepperIndex: O.pepper.index }, { ...o, rng: { range: () => 0 }, exec: OSD_EXEC, soundAddr: {}, native: [] });
    const cpu = this.cpu, mem = cpu.mem, H = cpu.hooks, L = this;
    cpu.cw = 0x7f;                       // 24-bit precision as Direct3D 7 leaves it
    this.O = O; this.setup = O.emu;
    mem.addRegion({ lo: HEAP_BASE, hi: HEAP_BASE + 0x4000000, name: 'heap2' });
    this.log = []; this.calls = []; this.groove = [];
    // ---- seed the machine with the state the original's own set-up left (data / bss pages and the heap; the record array stays the mirror of the oracle world)
    const src = this.setup.mem;
    let maxHeap = HEAP_BASE;
    for (let pg = 0; pg < src.pages.length; pg++) {
      const p = src.pages[pg];
      if (!p) continue;
      const a = pg << 12;
      if (a >= RECORDS_BASE && a < HEAP_BASE) continue;
      if (a >= HEAP_BASE + 0x4000000) continue;
      if (a >= HEAP_BASE) maxHeap = Math.max(maxHeap, a + 0x1000);
      mem.pages[pg] = new Uint8Array(p);
    }
    this.brk = Math.max(this.brk, maxHeap);
    mem.w32(0x983800, O.world.records.length); mem.w32(0x983804, RECORDS_BASE);
    mem.wf32(0x8b1718, o.dt); mem.wf32(0x8b171c, 1 / o.dt);
    for (let i = 0; i < VAR_COUNT; i++) mem.w32(VAR_ARRAY + 4 * i, O.vars.get(i) | 0);
    this.nodeOf = new Map();
    IslEmu.prototype.initHosts.call(this);
    // ---- own hosts
    H.delete(0x4388ae);                                            // FUN_004388ae runs natively; the CRT rand() under it is the script
    this.rngInt = () => 0;
    H.set(0x85daf0, (c) => { c.eax = L.rngInt() | 0; });
    H.set(0x443310, (c) => { L.log.push(`groove ${c.arg(0) << 24 >> 24}`); L.groove.push(c.arg(0) << 24 >> 24); c.eax = 0; });
    // FUN_0085ac00(buf, fmt, a, b, c): the HUD text (a correct C printf)
    H.set(0x85ac00, (c) => {
      const s = sprintf(mem.cstr(c.arg(1)), [c.arg(2), c.arg(3), c.arg(4)]);
      for (let i = 0; i < s.length; i++) mem.w8(c.arg(0) + i, s.charCodeAt(i));
      mem.w8(c.arg(0) + s.length, 0);
      c.eax = s.length;
    });
    // emitters (FX_Particles: logged by the zone code's callers; the port has none): FUN_0044e920 creates, FUN_0044ea00 moves, FUN_0044ea60 switches
    let em = 0;
    H.set(0x44e920, (c) => { L.log.push('emitter create'); c.eax = 0x100 + em++; });
    H.set(0x44ea00, (c) => { c.eax = 0; });
    H.set(0x4432c0, (c) => { c.eax = 0; });
    H.set(0x443290, (c) => { c.eax = 0x5000; });                  // FUN_00443290(name): the DirectMusic key handle (DAT_05d5bcc0)
    H.set(0x443370, (c) => { c.eax = 0; });
    // ---- the sound handle globals: the zone's loader and the walk code's loaders (the hosted loads hand out handles that remember the sound id)
    for (const fn of [0x6285e0, 0x4b037e, 0x4b0b37, 0x4b0f16]) { cpu.steps = 0; cpu.call(fn, [], { maxSteps: 5_000_000 }); }
  }

  /** the HUD overlay set-up (the wrapper's FUN_006283c0) is part of the set-up already; the blink counter and the icon slot live in the data pages */
  hud() { const m = this.cpu.mem; return { centre: m.cstr(0x5d4dd60), left: m.cstr(0x5d4dd20), icon: m.r32(0x5d4e144) | 0, blink: m.f32(0x5d5bc50) }; }

  /** run the original's update pass (FUN_0042226e), the probe pass (FUN_00427233), the pre-render pass (FUN_004225c5) and the HUD function FUN_00628410 as the GameLoop FUN_00627c90 does in mode 2 */
  passes(held, pressed, opts = {}) {
    const cpu = this.cpu, mem = cpu.mem, n = this.oracle.records.length;
    this.ticks++;
    this.log = []; this.groove = []; this.varWrites = []; this.drawn = [];
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed); mem.w32(0x983848, 0); mem.w32(0x98384c, 0); mem.w32(0x983850, 0);
    mem.w32(0x9da5c8, 0);
    this.sync();
    cpu.steps = 0;
    cpu.call(0x42226e, [RECORDS_BASE, n], { maxSteps: 50_000_000 });
    this.arms = this.armSnapshot();
    cpu.steps = 0;
    cpu.call(0x427233, [RECORDS_BASE, n], { maxSteps: 50_000_000 });
    cpu.steps = 0;
    cpu.call(0x4225c5, [RECORDS_BASE, n], { maxSteps: 50_000_000 });
    if (opts.hud) { cpu.steps = 0; cpu.call(0x628410, [], { maxSteps: 1_000_000 }); }
    return this.log;
  }

  /** the probes the update pass armed (FUN_00427014: mask +0x4c != 0): record index -> { from (+0x20), delta (+0x38), mask, flags (+0x5c) } */
  armSnapshot() {
    const mem = this.cpu.mem, out = new Map();
    for (let i = 0; i < this.oracle.records.length; i++) {
      const c = mem.r32(RECORDS_BASE + i * REC + 0x5c);
      if (!c || mem.r32(c + 0x4c) === 0) continue;
      out.set(i, { from: [0, 1, 2].map((k) => mem.f32(c + 0x20 + 4 * k)), delta: [0, 1, 2].map((k) => mem.f32(c + 0x38 + 4 * k)), mask: mem.r32(c + 0x4c), flags: mem.r32(c + 0x5c) >>> 0 });
    }
    return out;
  }
}
for (const k of IMPORTED) OsdEmu.prototype[k] = IslEmu.prototype[k];

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The duel
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const NO_GROUND = fr(-1e38);

/**
 * @param ctx test context
 * @param o { node (story node, default 34), vars (game variables set before the set-up runs, both sides), kinds: which node kinds the duel keeps ('TUM' 'SCR' 'GRAB' 'GEM' 'SW'),
 *            dt, seed (random script), maxFail, failures (array shared with the test), hud: run the HUD function too }
 */
export class OsdDuel {
  constructor(ctx, o = {}) {
    this.o = o;
    this.dt = o.dt ?? 1;
    this.seed = o.seed ?? 1234;
    this.kinds = new Set(o.kinds ?? Object.keys(CTOR));
    const pe = (this.pe = loadExe(ctx.dataRoot));
    const optsHub = { zone: 'z14OSD', node: o.node ?? 34, vars: o.vars ?? {} };
    this.O = loadHub(ctx, optsHub);           // the oracle world: collision mirror, animation instances, the set-up memory (no node constructors run on it)
    this.P = loadHub(ctx, optsHub);           // the port
    const P = this.P, W = P.world;
    // ---- the port's context: the sound ids behind the handle globals (as tools/lib/m5-z14OSD-load.mjs) and the logs the comparison reads
    const handles = new Map(P.emu.soundHandles.map((h) => [h.addr, h]));
    const ic = P.ictx;
    ic.soundOf = (addr) => { const h = handles.get(addr); return h && h.kind !== 'music' ? h.id : -1; };
    this.psnd = [];
    ic.sfx = (id) => { this.psnd.push(`p2 #${id}`); };
    ic.stopSfx = (id) => { this.psnd.push(`s2 #${id}`); };
    ic.sfxAt = (id, pos) => { this.psnd.push(`p3 #${id} ${[...pos].map(fr)}`); };
    ic.musicGroove = (lvl) => { this.psnd.push(`groove ${lvl}`); };
    ic.particles = () => {};
    ic.fx = null;                         // (the hub mock's `fx: []` is not a ZoneParticles: `finishEmitters` of the island's probe pass would call `.finish()` on it)
    // ---- the port: only the nodes under test stay
    const keep = (n) => [...this.kinds].some((k) => n instanceof PORT_CLASS[k]);
    for (const r of W.records) {
      if (!r.ctrl) continue;
      r.ctrl.nodes = r.ctrl.nodes.filter(keep);
      if (!r.ctrl.nodes.length) r.ctrl = null;
    }
    // the framework's constructors' world half (`registerHub` calls ctorInit in record order after the set-up); the scorpions draw rand(3): both sides get the same script
    this.ctorSeed = o.ctorSeed ?? 777;
    const sctor = stream(this.ctorSeed);
    for (const rec of W.records) {
      for (const n of rec.ctrl?.nodes ?? []) {
        setAmbientRandom(n instanceof ScorpionNode ? sctor : () => 0.5);
        n.ctorInit?.(W, rec);
      }
    }
    setAmbientRandom(() => 0.5);
    P.subMatrices = applySubMatrices(W, P.emu);
    W.dt = this.dt; W.externalInput = true;
    this.heldNow = 0; this.prevHeld = 0;
    // wrap the port's probe pass to read the probes the update pass armed (before the island's pass consumes them)
    this.parms = new Map();
    const before = W.beforePrerender;
    W.beforePrerender = (w) => {
      this.parms = new Map();
      for (const rec of w.records) {
        const p = rec.ctrl ? ctrlExtra(rec.ctrl).probe : null;
        if (p) this.parms.set(rec.index, { from: [...p.from], delta: [...p.delta], mask: p.mask, flags: p.flags >>> 0 });
        else if (rec.ctrl?.probe && rec.ctrl.probe.mask) { const q = rec.ctrl.probe; this.parms.set(rec.index, { from: [...q.off], delta: [...q.delta], mask: q.mask, flags: q.pflags >>> 0 }); }
      }
      before?.(w);
    };
    // ---- the oracle machine
    this.emu = new OsdEmu(pe, { ...this.O, world: this.O.world }, { dt: this.dt });
    const emu = this.emu;
    this.rngSeq = (s) => { const u = stream(s); emu.rngInt = () => Math.floor(u() * 32768); };
    emu.setFocus(this.O.pepper.index);
    emu.cpu.mem.w8(0x8ae088, this.P.world.pep.mailbox);   // DAT_008ae088 = the state mailbox: the port's value
    this.ctrlFlagsOf = (rec) => this.P.world.records[rec].ctrl?.flags ?? 6;
    const att = this.O.emu.attaches;
    this.rngSeq(this.ctorSeed);
    // Pepper's controller first (as the set-up: FUN_0042382c, flags from the set-up), then the nodes in the set-up's order (each attach runs the constructor natively)
    const pi = this.O.pepper.index;
    for (const a of att) {
      const k = Object.keys(CTOR).find((q) => CTOR[q] === a.ctor);
      if (!k || !this.kinds.has(k) || !a.hasController) continue;
      emu.attach(a);
      const ctrl = emu.cpu.mem.r32(emu.recPtr(a.record) + 0x5c);
      emu.cpu.mem.w32(ctrl + 0xc, this.ctrlFlagsOf(a.record));
    }
    void pi;
    this.t = 0; this.nfail = 0; this.checked = 0; this.failures = o.failures ?? [];
    this.worst = new Map();
    this.label = o.label ?? '';
    this.hudState = new OsdHudState();
    this.hud = new Hud(null);
    initOsdHud(this.hud);
    this.olog = []; this.emu.arms = new Map();
    // port-side logs of animation starts (record, clip): the original's host logs `clip rec clip`
    this.pclips = [];
    for (const r of W.records) {
      const an = r.anim;
      if (!an || an.__wrapped) continue;
      const st = an.start.bind(an);
      an.start = (clip, frame = 0) => { this.pclips.push(`clip ${r.index} ${clip | 0}`); return st(clip, frame); };
      an.__wrapped = true;
    }
    this.baselineClips = this.O.world.records.map((r) => r.anim?.clip ?? -1);
  }

  // ------------------------------------------------------------------------------------------------ scenario helpers (applied to both worlds)
  get W() { return this.P.world; }
  rec(i) { return this.P.world.records[i]; }
  orec(i) { return this.O.world.records[i]; }
  idx(name) { return this.P.world.records.findIndex((r) => r.name === name); }
  /** put a record at a spot with a heading (rx, rz 0) in both worlds and in the machine */
  place(i, x, y, z, ry = 0, rx = 0, rz = 0) {
    ry = fr(ry); rx = fr(rx); rz = fr(rz);       // (the record's Euler words are floats)
    for (const r of [this.P.world.records[i], this.O.world.records[i]]) { r.setEuler(rx, ry, rz, x, y, z); r.rx = rx; r.ry = ry; r.rz = rz; }
    this.emu.putRecord(i, this.O.world.records[i]);
    this.emu.sync();
  }
  setFlags(i, f) {
    this.P.world.records[i].flags = f; this.O.world.records[i].flags = f;
    this.emu.cpu.mem.w16(RECORDS_BASE + i * REC + 0x60, f & 0xffff);
    this.emu.sync();
  }
  setVar(i, v) { this.emu.cpu.mem.w32(VAR_ARRAY + 4 * i, v); this.P.world.vars.set(i, v); }
  getVar(i) { return this.P.world.vars.get(i) | 0; }
  /** DAT_008ae088 / the port's PepperGlobals.mailbox */
  setMailbox(v) { this.emu.cpu.mem.w8(0x8ae088, v); this.P.world.pep.mailbox = v; }
  /** DAT_009da858 / world.seaLevel */
  setSea(v) { this.emu.cpu.mem.wf32(0x9da858, v); this.P.world.seaLevel = fr(v); }
  /** start a clip on a record's animation instance in both worlds (the machine's host animation is the O world's instance) */
  setClip(i, clip, frame = 0) { this.P.world.records[i].anim?.start(clip, frame); this.O.world.records[i].anim?.start(clip, frame); this.pclips.length = 0; }
  /**
   * a scripted collision world for BOTH sides: `ground(x, z)` = the terrain height at a spot (null = no ground); the probe / sweep segments hit it at the ground's height when it lies inside the
   * segment, and report the record `hitRecord` (default: the zone's ground record) with the normal (0, 1, 0)
   */
  script(ground, hitRecord = null, terrain = null) {
    for (const world of [this.P.world, this.O.world]) {
      const col = world.col;
      const rec = () => world.records[hitRecord ?? col.groundRec?.index ?? 3];
      col.terrainHeight = (x, y, z) => { const g = (terrain ?? ground)(fr(x), fr(z)); return g === null ? NO_GROUND : fr(g); };
      const seg = (_ignore, from, delta) => {
        const g = ground(fr(from[0]), fr(from[2]));
        if (g === null) return null;
        const y0 = from[1], y1 = fr(y0 + delta[1]);
        if (!(g <= y0 && g >= y1)) return null;
        return { rec: rec(), point: [from[0], fr(g), from[2]], normal: [0, 1, 0] };
      };
      col.probe = (ig, from, delta) => seg(ig, from, delta);
      col.sweep = (ig, from, delta) => seg(ig, from, delta);
    }
  }

  // ------------------------------------------------------------------------------------------------ the tick
  /** advance both one tick with the buttons `held` (bit mask) */
  tick(held = 0) {
    const W = this.P.world;
    const pressed = (held ^ this.prevHeld) & held;
    this.prevHeld = held;
    W.input.held = held; W.input.pressed = pressed; W.input.prevHeld = held & ~pressed;
    const seed = (this.seed ^ Math.imul(this.t + 1, 2654435761)) >>> 0;
    this.psnd.length = 0; this.pclips.length = 0;
    this.rngSeq(seed);
    this.olog = this.emu.passes(held, pressed, { hud: this.o.hud });
    setAmbientRandom(stream(seed));
    W.tick();
    if (this.o.hud) updateOsdHud(this.hud, W.vars, this.hudState, W.dt);
    this.t++;
  }

  // ------------------------------------------------------------------------------------------------ comparison helpers
  fail(msg) { this.nfail++; if (this.failures.length < (this.o.maxFail ?? 40)) this.failures.push(msg); else if (this.failures.length === (this.o.maxFail ?? 40)) this.failures.push('... more failures'); }
  /** |orig - port| <= tol * max(1, |orig|) + abs; the default is exact equality (the port rounds with Math.fround where the original's x87 does) */
  cmp(name, orig, port, tol = 0, idx = '', abs = 0) {
    this.checked++;
    const d = Math.abs(orig - port);
    if (d > (this.worst.get(name) ?? 0)) this.worst.set(name, d);
    if (Number.isNaN(orig) && Number.isNaN(port)) return;
    if (!(d <= tol * Math.max(1, Math.abs(orig)) + abs)) this.fail(`${this.label} t${this.t} ${name}${idx}: original ${orig} port ${port}`);
  }
  eq(name, orig, port, idx = '') {
    this.checked++;
    if (orig !== port) this.fail(`${this.label} t${this.t} ${name}${idx}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`);
  }
  /** a record against the original's memory: matrix, Euler angles, flags (& mask) */
  compareRecord(i, o = {}) {
    const mem = this.emu.cpu.mem, a = RECORDS_BASE + i * REC, r = this.P.world.records[i];
    const tolM = o.tol ?? 0, tolT = o.tolT ?? tolM, abs = o.abs ?? 0, rotAbs = o.rotAbs ?? 0;
    for (let k = 0; k < 16; k++) this.cmp(`${r.name}.m`, mem.f32(a + 0xc + 4 * k), r.m[k], k >= 12 ? tolT : tolM, `[${k}]`, k >= 12 || k % 4 === 3 ? abs : rotAbs);
    this.cmp(`${r.name}.rx`, mem.f32(a + 0x4c), r.rx, tolM, '', abs); this.cmp(`${r.name}.ry`, mem.f32(a + 0x50), r.ry, tolM, '', abs); this.cmp(`${r.name}.rz`, mem.f32(a + 0x54), r.rz, tolM, '', abs);
    this.eq(`${r.name}.flags`, mem.r16(a + 0x60) & (o.flagMask ?? 0xffff), r.flags & (o.flagMask ?? 0xffff));
  }
  /** all game variables (3..318) */
  compareVars(skip = []) {
    const mem = this.emu.cpu.mem, W = this.P.world.vars;
    for (let i = 3; i < VAR_COUNT; i++) {
      if (skip.includes(i)) continue;
      this.checked++;
      const o = mem.r32(VAR_ARRAY + 4 * i), p = W.get(i) | 0;
      if (o !== p) this.fail(`${this.label} t${this.t} var ${i} (0x${i.toString(16)}): original ${o} port ${p}`);
    }
  }
  /** the sound / groove calls of the tick, in order: 2D play / stop, 3D play with the position, the music groove */
  compareSounds(o = {}) {
    // (the port's context has one `stopSfx` for the 2D stop FUN_004435b0 and the 3D stop FUN_004434b0: the machine's `s3` lines are compared as `s2`)
    const keep = (l) => /^(p2|s2|s3|p3|r|groove) /.test(l);
    let ol = this.olog.filter(keep).map((l) => (l.startsWith('s3 ') ? 's2 ' + l.slice(3) : l)), pl = this.psnd.filter(keep);
    // known deviation of peppsw.ts (reported): the original stops 8 handles (two of them of sound 0x185), the port's id list stops each id once; `dedupeStops` compares each stop once per tick
    if (o.dedupeStops) { const dd = (l) => { const seen = new Set(); return l.filter((x) => { if (!x.startsWith('s2 ')) return true; if (seen.has(x)) { this.dupStops = (this.dupStops ?? 0) + 1; return false; } seen.add(x); return true; }); }; ol = dd(ol); pl = dd(pl); }
    this.checked++;
    if (ol.length !== pl.length) { this.fail(`${this.label} t${this.t} sound calls: original [${ol.join(' | ')}] port [${pl.join(' | ')}]`); return; }
    for (let i = 0; i < ol.length; i++) {
      const m = /^(p3 #\d+) (\S+)$/.exec(ol[i]), n = /^(p3 #\d+) (\S+)$/.exec(pl[i]);
      if (m && n) {
        this.eq('sound call', m[1], n[1], ` ${i}`);
        const a = m[2].split(',').map(Number), b = n[2].split(',').map(Number);
        for (let k = 0; k < 3; k++) this.cmp(`${m[1]} pos`, a[k], b[k], o.tolPos ?? 0, `[${k}]`);
      } else this.eq('sound call', ol[i], pl[i], ` ${i}`);
    }
  }
  /** the animation starts of the tick (record, clip) and the current clip / frame of the records `idxs` */
  compareAnims(idxs, tolFrame = 0) {
    const ol = this.olog.filter((l) => l.startsWith('clip ')), pl = this.pclips;
    this.checked++;
    if (ol.join('|') !== pl.join('|')) this.fail(`${this.label} t${this.t} animation starts: original [${ol.join(' | ')}] port [${pl.join(' | ')}]`);
    for (const i of idxs) {
      const a = this.O.world.records[i].anim, b = this.P.world.records[i].anim;
      if (!a || !b) continue;
      this.eq(`${this.P.world.records[i].name} clip`, a.clip, b.clip);
      this.cmp(`${this.P.world.records[i].name} frame`, a.frame, b.frame, tolFrame);
    }
  }
  /** the framework's per-controller words of every record that has a controller on either side: ran mask (+0x08), squared distance (+0x18), the "where is Pepper" bits (+0x14 & 0xe) */
  compareControllers(o = {}) {
    const mem = this.emu.cpu.mem;
    for (const r of this.P.world.records) {
      const c = mem.r32(RECORDS_BASE + r.index * REC + 0x5c);
      if (!c && !r.ctrl) continue;
      if (!c || !r.ctrl) { this.fail(`${this.label} t${this.t} ${r.name}: controller original ${!!c} port ${!!r.ctrl}`); continue; }
      let mask = 0;
      r.ctrl.ran.forEach((v, k) => { if (v) mask |= 1 << k; });
      this.eq(`${r.name} ran mask (+0x08)`, mem.r32(c + 8) >>> 0, mask >>> 0);
      this.cmp(`${r.name} distSq (+0x18)`, mem.f32(c + 0x18), r.ctrl.distSq, o.tolDist ?? 0);
      if (o.pepperBits) this.eq(`${r.name} side bits (+0x14 & 0xe)`, mem.r32(c + 0x14) & 0xe, ctrlExtra(r.ctrl).f14 & 0xe);
    }
  }
  /** the probes armed by the update pass (FUN_00427014 arguments) and the result codes after the probe pass (ctrl +0x64) */
  compareProbes(o = {}) {
    const oa = this.emu.arms, pa = this.parms;
    const keys = new Set([...oa.keys(), ...pa.keys()]);
    for (const i of keys) {
      const a = oa.get(i), b = pa.get(i);
      this.checked++;
      if (!a || !b) { this.fail(`${this.label} t${this.t} probe of ${this.P.world.records[i].name}: original ${a ? 'armed' : 'none'} port ${b ? 'armed' : 'none'}`); continue; }
      for (let k = 0; k < 3; k++) { this.cmp(`${this.P.world.records[i].name} probe offset`, a.from[k], b.from[k], 0, `[${k}]`); this.cmp(`${this.P.world.records[i].name} probe delta`, a.delta[k], b.delta[k], 0, `[${k}]`); }
      this.eq(`${this.P.world.records[i].name} probe mask`, a.mask, b.mask);
      this.eq(`${this.P.world.records[i].name} probe flags`, a.flags, b.flags);
    }
    if (o.results) {
      const mem = this.emu.cpu.mem;
      for (const r of this.P.world.records) {
        if (!r.ctrl) continue;
        const c = mem.r32(RECORDS_BASE + r.index * REC + 0x5c);
        if (!c) continue;
        const ov = mem.r32(c + 0x64) >>> 0;
        const pv = r.ctrl.probe ? r.ctrl.probe.result : probeResult(r.ctrl);
        // the original's result: 0 nothing, 1 moved without a hit record, a record pointer, 0xbabababa switched off; the island's probe: the same (a record object for a hit)
        const pn = typeof pv === 'object' ? RECORDS_BASE + (pv.rec ?? pv).index * REC : pv >>> 0;
        if (ov === 0 && !keys.has(r.index)) continue;
        this.eq(`${r.name} probe result (+0x64)`, ov, pn >>> 0);
      }
    }
  }
  /** run the node's destroy handler (vtable +8: FUN_00629eb5 ...) on both sides; the sound calls are then compared like a tick's */
  destroyNode(i, kind) {
    const mem = this.emu.cpu.mem, a = this.onode(i, kind), n = this.pnode(i, kind);
    this.psnd.length = 0; this.emu.log = [];
    this.emu.cpu.steps = 0;
    this.emu.cpu.call(mem.r32(mem.r32(a + 4) + 8), [this.emu.recPtr(i), a], { maxSteps: 1_000_000 });
    this.olog = this.emu.log;
    n.destroy?.(this.P.world, this.P.world.records[i], this.P.world.records[i].ctrl);
  }
  /** a node's block in the machine: `kind` TUM / SCR / GRAB / GEM / SW on record `i` */
  onode(i, kind) { return this.emu.nodeOf.get(i)?.find((n) => n.ctor === CTOR[kind])?.ptr ?? 0; }
  pnode(i, kind) { return this.P.world.records[i].ctrl?.nodes.find((n) => n instanceof PORT_CLASS[kind]); }
}
