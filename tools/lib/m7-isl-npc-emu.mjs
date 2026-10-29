import { cRand } from './c-rand.mjs';
import { islandSlot2d } from '../../src/island/vehicles/crashsound.ts';
// WP-VERIFY M7: the island's NPC / behaviour-node families run from the ORIGINAL code in the x86 emulation (src/formats/x86emu.ts) as an oracle for src/island/npc/**
// (tools/tests/m7-isl-npc-emu.mjs, docs/re/m4/wp3-npc.md section "Differential test (WP-VERIFY)").
//
// What runs NATIVELY from the user's own executable (addresses only are stored here): the node constructors (SGMFIG 0x426151, Human1 0x4bec00 / 0x4bf329, Turn2Pep 0x52ff39 / 0x5306e5 /
// 0x5308f3, MeetPepp 0x530d69, BrickBot 0x531d45 ..., Bunny, buildings), the engine's node passes (FUN_0042226e update, FUN_00427233 controller probes, FUN_004225c5 pre-render,
// FUN_0042271b draw: the REAL controller lists / gates / return codes), the whole SGGen interaction code (0x422000 ..), the waypoint walker (FUN_004614d5 .. 0x4641xx with the compiled
// maps loaded by the original FUN_004630c0), the animation instance functions (FUN_0043b6a3 / 0043b76a / 0043b874 ... on instance blocks built from the rig), the game variable
// accessors, the COLLISION code (the .col files loaded by FUN_0043f370; sweep FUN_00441270, probe FUN_00441ac0, terrain ray FUN_0043cd62), the matrix helpers, the C runtime.
// Hosted (not the subject): the allocator, files, sounds (logged), speech / text lookup / cutscene manager (counters like the mock context of island-load.mjs), the render calls,
// the objective's globals are zero (FUN_00424e37's default branch runs natively), rand (FUN_004388ae: the sequence the port drew).
//
// The oracle starts from the port world's state (records, game variables, animation clips) after setup, builds the controllers and nodes by running the constructors on the
// attach list the island set-up logged (argument blocks, positions, gates), and then runs the original's passes once per tick. Pepper is scripted: her record (position / yaw) is
// written into both sides, her walk node is not run.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';
import { colMember } from '../../src/game/zone.ts';
import { decode } from '../../src/formats/x86.ts';

export const RB = 0x10000000, HEAP = 0x20000000, HEAP_SIZE = 0x10000000;
export const REC = 0x68;
export const CRT = [0x858d30, 0x873e00];
const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };
const FB = new Float32Array(1), UB = new Uint32Array(FB.buffer);
export const f32bits = (v) => { FB[0] = v; return UB[0]; };

/** globals of the NPC code (addresses of the original) */
export const G = {
  dt: 0x8b1718, invDt: 0x8b171c, ncount: 0x983800, nbase: 0x983804, pressed: 0x983840, held: 0x98383c, frame: 0x9da5cc, passOff: 0x9da5c8, probeOn: 0x9da868,
  pepper: 0x9da5d0, pepperMat: 0x9da5d8, camera: 0x9da5e8, best: 0x9da640, target: 0x9da6d0, lock: 0x9da844, exprTimer: 0x9da848, expr: 0x9da7d0, textTable: 0x9da7d8,
  mailbox: 0x8ae088, createMode: 0x8adc74, groundRec: 0x9dec18, skipGround: 0x9dec1c, seaLevel: 0x9da858, varArray: 0x8a2d2c, objMode: 0x9da82c,
  pizzaA: 0x9da874, pizzaB: 0x9da870, near: 0x9dec14,
};
export const VAR_COUNT = 319;
/** the node families of this verification (constructor addresses) */
export const CTORS = {
  SGMFIG: 0x426151, Human1: 0x4bec00, Launch: 0x4bf329, T2PA: 0x52ff39, T2PB: 0x5306e5, T2PC: 0x5308f3, MeetPepp: 0x530d69,
  BrickBotA: 0x531d45, BrickBotB: 0x5327b1, BrickBotC: 0x532acc, BrickBotD: 0x533ba8, Bunny1: 0x4b2d44, Bunny2: 0x4b3a92, Bunny3: 0x4b2149, BuildingA: 0x535e80, BuildingB: 0x5364a5,
};
/** a vtable that does nothing: stands in for the nodes of other families so the controller lists keep the original's order */

export class IslNpcEmu {
  /**
   * @param ctx test context, @param I island world (tools/lib/island-load.mjs loadIsland), @param o { dt, ctors: Set of constructor addresses to run, rng: () => number in [0, 1),
   *   sayTicks, cutsceneTicks, objective: port-side Objective or null, text: MessageTable | null, pepperIndex, rigOf(rec) }
   */
  constructor(ctx, I, o) {
    const pe = (this.pe = loadExe(ctx.dataRoot));
    const cpu = (this.cpu = createCpu(pe));
    if (o.fpu24 !== false) cpu.cw = 0x7f;   // the original runs the x87 in 24-bit precision (D3D leaves it at single): every result rounds to float32
    const mem = (this.mem = cpu.mem);
    this.I = I; this.o = o; this.ctx = ctx;
    const w = (this.w = I.world);
    const recs = (this.records = w.records);
    mem.addRegion({ lo: RB, hi: RB + (recs.length + 8) * REC, name: 'records' });
    mem.addRegion({ lo: HEAP, hi: HEAP + HEAP_SIZE, name: 'heap' });
    this.heap = HEAP;
    this.log = [];           // event log of one tick: sounds, speech, cutscenes, faces ...
    this.unhooked = new Map();
    this.coverage = null;
    this.rand = o.rng ?? Math.random;
    this.randDraws = 0;
    this.say = { left: 0, ticks: o.sayTicks ?? 60 };
    this.cs = { left: 0, ticks: o.cutsceneTicks ?? 0, held: false };
    this.speechNames = [];
    this.subtitles = 0;
    this.strings = new Map();
    this.nodes = new Map();      // record index -> [node pointers in list order, with placeholder entries null]
    this.nodeOf = new Map();     // node pointer -> { rec, kind, ctor, attach }
    const H = cpu.hooks;
    const hook = (a, f) => H.set(a, f);
    this.hook = hook;
    const logf = (s) => this.log.push(s);
    const L = this;

    // ---- allocator, runtime
    hook(0x433d38, (c) => { c.eax = L.alloc(c.arg(0)); });
    hook(0x433d60, () => {});
    hook(0x858d30, (c) => { c.eax = L.alloc(c.arg(0)); });
    hook(0x443c70, () => {});
    hook(0x417570, () => {});          // FUN_00417570: the variable index check of the accessors
    hook(0x85abc0, () => {});          // __chkesp
    hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });   // CRT atan2 (80 bit constant)

    // ---- files: the collision loader (FUN_0043f370 reads through FUN_00435843 / 00435350 / 004358e9), the waypoint loader (FUN_00463xxx through FUN_0043bfb7 / 0043c1a0 / 0043c22e)
    const archive = I.archive;
    const files = new Map(); let nextFile = 0x7100;
    hook(0x435843, (c) => {
      const e = archive.find(colMember(mem.cstr(c.arg(0))));
      if (!e) { c.eax = 0; return; }
      const h = nextFile++; files.set(h, { data: archive.read(e), pos: 0 }); c.eax = h;
    });
    hook(0x435350, (c) => {
      const f = files.get(c.arg(3)); const buf = c.arg(0), size = c.arg(1), count = c.arg(2);
      let n = 0;
      while (n < count && f.pos + size <= f.data.length) { for (let i = 0; i < size; i++) mem.w8(buf + n * size + i, f.data[f.pos + i]); f.pos += size; n++; }
      c.eax = n;
    });
    hook(0x4358e9, (c) => { files.delete(c.arg(0)); });
    const zoneDirRe = /^\.?[\\/]*_data[\\/]+z\d\d\w{3}[\\/]+/i;   // any zone directory (M5: the hub oracles run the castle through this machine too)
    hook(0x43bfb7, (c) => {
      const path = mem.cstr(c.arg(0));
      const e = archive.find(path.replace(zoneDirRe, '').replace(/\\/g, '/'));
      if (!e) { c.eax = 0; return; }
      const h = (nextFile += 0x10); files.set(h, { data: archive.read(e), pos: 0 }); c.eax = h;
    });
    hook(0x43c1a0, (c) => {
      const f = files.get(c.arg(0)), dst = c.arg(1), len = c.arg(2);
      if (!f) { c.eax = 0; return; }
      const k = Math.max(0, Math.min(len, f.data.length - f.pos));
      mem.write(dst, f.data.subarray(f.pos, f.pos + k)); f.pos += k; c.eax = k;
    });
    hook(0x43c22e, (c) => { files.delete(c.arg(0)); });

    // ---- sound (FUN_00443580 load 2D, FUN_004433b0 load 3D, FUN_00443590 status (2 = ready to play), FUN_004435a0 play, FUN_004435b0 stop)
    const handles = new Map(); let nh = 0x1000;
    hook(0x443580, (c) => { const h = nh++; handles.set(h, c.arg(0) | 0); c.eax = h; });
    hook(0x4433b0, (c) => { const h = nh++; handles.set(h, c.arg(0) | 0); c.eax = h; });
    hook(0x443590, (c) => { c.eax = 2; });
    // (a handle below 0x1000 was never handed out by a load hook: a BSS / stale slot NUMBER, which the real FUN_004435a0 plays from the current 2D bank: the island's 2D slot k)
    hook(0x4435a0, (c) => { const a = c.arg(0); logf(`sfx ${handles.get(a) ?? (a < 0x1000 && islandSlot2d(a) >= 0 ? islandSlot2d(a) : `h${a}`)}`); c.eax = 0; });
    hook(0x4435b0, (c) => { logf(`stopsfx ${handles.get(c.arg(0)) ?? `h${c.arg(0)}`}`); c.eax = 0; });

    // ---- speech / text / cutscene manager (counters as in the mock context of island-load.mjs)
    hook(0x439bf8, (c) => {   // FUN_00439bf8(table, tag, &speechId) -> the text, or the tag itself when the table has none
      const tag = mem.cstr(c.arg(1));
      const t = L.o.text;
      if (!t || t.text(tag) === tag) { c.eax = c.arg(1); return; }
      let k = L.speechNames.indexOf(tag); if (k < 0) { k = L.speechNames.length; L.speechNames.push(tag); }
      mem.w32(c.arg(2), k + 1);
      let p = L.strings.get(tag);
      if (!p) { const s = t.text(tag); p = L.alloc(s.length + 1); for (let i = 0; i < s.length; i++) mem.w8(p + i, s.charCodeAt(i) & 0xff); mem.w8(p + s.length, 0); L.strings.set(tag, p); }
      c.eax = p;
    });
    hook(0x435a11, (c) => {   // FUN_00435a11(id, id2): speak (the mock's say(): busy = no-op)
      const a = c.arg(0), b = c.arg(1);
      if (L.say.left > 0) { c.eax = 0; return; }
      logf(`say ${L.speechNames[a - 1] ?? `?${a.toString(16)}`}${b !== 0xffffffff ? `+${L.speechNames[b - 1] ?? `?${b.toString(16)}`}` : ''}`);
      L.say.left = L.say.ticks; c.eax = 0;
    });
    hook(0x435ad3, (c) => { c.eax = L.say.left <= 0 ? 1 : 0; });
    hook(0x435a5e, () => {});
    hook(0x435b07, () => { logf('stopspeech'); L.say.left = 0; });
    hook(0x45d47f, (c) => { L.subtitles++; c.eax = 0; });
    hook(0x45c40c, (c) => { logf(`cutscene ${c.arg(0) | 0}`); L.cs.left = L.cs.ticks; c.eax = 1; });
    hook(0x45c432, (c) => { c.eax = L.cs.left > 0 || L.cs.held ? 1 : 0; });
    hook(0x45c456, (c) => { L.cs.held = c.arg(0) !== 0; });
    hook(0x45f750, (c) => { logf(`camhold ${c.arg(0) !== 0 ? 1 : 0}`); });
    hook(0x43f2f0, (c) => { logf(`face ${c.arg(1) | 0}`); });
    hook(0x4388ae, (c) => { const max = c.argf(0); if (!(max > 0)) { c.fpush(0); return; } L.randDraws++; c.fpush(cRand(L.rand(), max)); });     // (no draw for max <= 0, like the original)
    // render / model calls that only matter for the picture
    hook(0x44ebb0, (c) => { c.eax = 0xbabababa; });          // FUN_0044ebb0 (a compiled-out emitter creation) returns the engine's NO_HANDLE 0xbabababa, which every emitter call ignores (the hand-over pizza's Piza_Hit / splat guard: finding V1)
    for (const a of [0x4446c0, 0x444550, 0x444480, 0x445ba0, 0x445c70, 0x40ccce, 0x40cc4d, 0x43ebe0, 0x444940, 0x44ea60, 0x435c91, 0x4432c0]) hook(a, (c) => { c.eax = 0; });
    this.stub = this.alloc(16); mem.w8(this.stub, 0xc3);
    hook(this.stub, (c) => { c.eax = 0; });

    // ---- what runs natively
    cpu.exec = [
      [0x422000, 0x430000], [0x460800, 0x468000], [0x4af2f7, 0x53d7da], [0x43b600, 0x43b990], [0x417570, 0x417670],
      [0x43a000, 0x43b100], [0x43cb00, 0x43e000], [0x43f160, 0x442a00], [0x43f2f0, 0x43f310], CRT, [0x890290, 0x890400], [0x40c000, 0x40d000],
    ];
    cpu.fallback = (a) => (c) => {
      const k = a.toString(16);
      L.unhooked.set(k, (L.unhooked.get(k) ?? 0) + 1);
      if (L.strict) throw new Error(`isl-npc emu: unhooked call to 0x${k} from 0x${c.callAt.toString(16)}`);
      c.eax = 0;
    };
    this.strict = false;
    // ---- records, collision objects, animation instances, game variables
    mem.w32(G.nbase, RB); mem.w32(G.ncount, recs.length);
    this.objPtr = new Map(); this.path0 = this.alloc(128);
    this.animBlocks = new Map();      // record index -> instance block
    this.rigs = new Map();            // Blk -> rig block
    this.clipP = new Map();           // Blk -> clip pointers
    this.writeVars();
    this.syncColObjects();
    for (const r of recs) this.mirrorRecord(r, true);
    mem.w32(G.pepper, this.recPtr(o.pepperIndex)); mem.w32(G.pepperMat, this.recPtr(o.pepperIndex) + 0xc);
    mem.w32(G.textTable, o.text ? 0x5ed00001 : 0);
    mem.w32(G.passOff, 0);
    mem.w32(G.frame, w.frame);
    mem.wf32(G.dt, o.dt); mem.wf32(G.invDt, 1 / o.dt);
    mem.wf32(G.seaLevel, w.seaLevel);
    mem.w32(G.groundRec, w.col.groundRec ? this.recPtr(w.col.groundRec.index) : 0);
    mem.w32(G.skipGround, 0);
    cpu.invalidate();
  }

  alloc(n) { const p = this.heap; this.heap += (Math.max(4, n) + 15) & ~15; if (this.heap > HEAP + HEAP_SIZE) throw new Error('isl-npc emu: heap exhausted'); return p; }
  recPtr(i) { return RB + i * REC; }
  recIndexOf(p) { return p === 0 ? -1 : ((p - RB) / REC) | 0; }
  call(addr, args = [], max = 20_000_000, trace) { this.cpu.steps = 0; return this.cpu.call(addr, args, { maxSteps: max, trace }); }

  writeVars() {
    const mem = this.mem, v = this.w.vars;
    for (let i = 0; i < VAR_COUNT; i++) mem.w32(G.varArray + 4 * i, v.get(i) | 0);
  }
  readVars() { const mem = this.mem, out = new Array(VAR_COUNT); for (let i = 0; i < VAR_COUNT; i++) out[i] = mem.r32(G.varArray + 4 * i); return out; }

  loadCol(obj) {
    if (this.objPtr.has(obj)) return this.objPtr.get(obj);
    const mem = this.mem, s = obj.path;
    for (let i = 0; i < s.length; i++) mem.w8(this.path0 + i, s.charCodeAt(i)); mem.w8(this.path0 + s.length, 0);
    const p = this.call(0x43f370, [this.path0], 5e7);
    if (p === 0xbabababa) throw new Error(`isl-npc emu: the original loader rejects ${s}`);
    this.objPtr.set(obj, p);
    return p;
  }
  syncColObjects() {
    const mem = this.mem;
    for (const r of this.records) {
      const o = r.colObj; if (!o) continue;
      const p = this.loadCol(o);
      if (o.shape === 3) { mem.w32(p + 0x4c, 3); mem.wf32(p + 0x58, o.box[0]); mem.wf32(p + 0x5c, o.box[1]); mem.wf32(p + 0x60, o.box[2]); mem.wf32(p + 0x24, o.radius); }
    }
  }

  /** an animation instance block (SDAnim layout: +8 clip data, +0xc clip, +0x10 frame, +0x1c rig; rig +0 clip count, +4.. clip pointers; clip +0 flags, +8 frame count) */
  animBlockFor(rec, an) {
    const mem = this.mem;
    let b = this.animBlocks.get(rec.index);
    if (b) return b;
    let rig = this.rigs.get(an.rig);
    if (!rig) {
      rig = this.alloc(8 + 4 * an.rig.clips.length);
      const cp = [];
      mem.w32(rig, an.rig.clips.length);
      an.rig.clips.forEach((c, i) => { const p = this.alloc(0x20); mem.w32(p, c.flags | 0); mem.w32(p + 8, c.frameCount | 0); cp[i] = p; mem.w32(rig + 4 + 4 * i, p); });
      this.rigs.set(an.rig, rig); this.clipP.set(an.rig, cp);
    }
    b = this.alloc(0x40);
    mem.w32(b + 0x1c, rig);
    this.animBlocks.set(rec.index, b);
    return b;
  }
  /** write the port's animation state (clip, frame) of a record into its block (creating it) */
  pushAnim(rec, an = rec.anim) {
    if (!an) return;
    const mem = this.mem, b = this.animBlockFor(rec, an);
    mem.w32(b + 0xc, an.clip); mem.w32(b + 8, this.clipP.get(an.rig)[an.clip] ?? 0); mem.wf32(b + 0x10, an.frame);
    mem.w32(this.recPtr(rec.index) + 8, b);
  }
  readAnim(i) {
    const mem = this.mem, b = mem.r32(this.recPtr(i) + 8);
    return b ? { clip: mem.r32(b + 0xc), frame: mem.f32(b + 0x10) } : null;
  }

  mirrorRecord(r, first = false) {
    const mem = this.mem, a = this.recPtr(r.index);
    for (let i = 0; i < 4; i++) mem.w8(a + i, r.name.charCodeAt(i) || 0x20);
    if (first) mem.w32(a + 4, 0x40000000 + r.index * 0x100);
    for (let i = 0; i < 16; i++) mem.wf32(a + 0xc + 4 * i, r.m[i]);
    mem.wf32(a + 0x4c, r.rx); mem.wf32(a + 0x50, r.ry); mem.wf32(a + 0x54, r.rz);
    mem.w32(a + 0x58, r.colObj ? this.objPtr.get(r.colObj) : 0);
    mem.w16(a + 0x60, r.flags & 0xffff); mem.w32(a + 0x64, r.variant | 0);
  }
  readRecord(i) {
    const mem = this.mem, a = this.recPtr(i);
    return { m: Array.from({ length: 16 }, (_, k) => mem.f32(a + 0xc + 4 * k)), e: [mem.f32(a + 0x4c), mem.f32(a + 0x50), mem.f32(a + 0x54)], flags: mem.r16(a + 0x60) };
  }

  /** load the island's waypoint maps with the original loader (FUN_004630c0(slot, path)) */
  loadWaypoints() {
    const mem = this.mem, p = this.alloc(260);
    for (const m of this.I.profile.island.waypointMaps) {
      const s = m.path ?? '';
      for (let i = 0; i < s.length; i++) mem.w8(p + i, s.charCodeAt(i)); mem.w8(p + s.length, 0);
      this.call(0x4630c0, [m.index, p], 5e7);
    }
  }

  // ------------------------------------------------------------------------------------------------ controllers and nodes
  /** FUN_0042382c: the controller block of a record (0x68 bytes, flags 6, radius^2 512.0, +0x60 = -1.0) */
  makeController(i) {
    const mem = this.mem, c = this.alloc(0x68);
    mem.w32(c + 0xc, 6); mem.w32(c + 0x1c, 0x44000000); mem.w32(c + 0x60, 0xbf800000);
    mem.w32(this.recPtr(i) + 0x5c, c);
    return c;
  }
  ctrlOf(i) { return this.mem.r32(this.recPtr(i) + 0x5c); }

  /**
   * run the constructors of the island's attach list (order of the set-up), linking the nodes like FUN_00423532 does (pos 0: head, n: after n nodes, end: appended).
   * Attaches of other families get a placeholder node (a vtable whose update does nothing) so the list keeps its order.
   */
  buildNodes(attaches) {
    const mem = this.mem, cpu = this.cpu;
    const vt = this.alloc(0x20);
    mem.w32(vt, this.stub);
    mem.w32(G.createMode, 1);
    const flagsOf = new Map();
    for (const f of this.I.profile.island.ctrlFlags) flagsOf.set(f.record, f.flags);
    for (const at of attaches) {
      const i = at.record;
      let ctrl = this.ctrlOf(i);
      if (!ctrl) ctrl = this.makeController(i);
      if (at.ctrlFlags !== undefined) mem.w32(ctrl + 0xc, at.ctrlFlags);
      const mine = this.o.ctors.has(at.ctor);
      let node;
      if (mine) {
        const arg = this.alloc(0x100);
        mem.write(arg, at.args);
        node = this.call(at.ctor, [this.recPtr(i), arg, 0, at.var, at.mask & 0xffff, at.value & 0xffff], 20_000_000);
      } else { node = this.alloc(0x40); mem.w32(node, at.var); mem.w32(node + 4, vt); mem.w16(node + 0xc, at.mask); mem.w16(node + 0xe, at.value); }
      mem.w32(node + 8, 0xfffffffe);
      // gate (a ctor writes its own var / mask / value into +0 / +0xc / +0xe: FUN_00426151 does; the placeholders get them above)
      if (at.pos === 0) { mem.w32(ctrl, node); mem.w32(node + 0x10, 0); }
      else {
        let prev = mem.u32(ctrl), cur = mem.u32(prev + 0x10), k = 1, done = false;
        while (cur !== 0) {
          if (at.pos === k) { mem.w32(prev + 0x10, node); mem.w32(node + 0x10, cur); done = true; break; }
          prev = cur; cur = mem.u32(cur + 0x10); k++;
        }
        if (!done) { mem.w32(prev + 0x10, node); mem.w32(node + 0x10, 0); }
      }
      this.nodeOf.set(node, { rec: i, ctor: at.ctor, mine, attach: at });
      if (!this.nodes.has(i)) this.nodes.set(i, []);
    }
    mem.w32(G.createMode, 0);
    // final controller flags of the set-up
    for (const [rec, fl] of flagsOf) { const c = this.ctrlOf(rec); if (c) mem.w32(c + 0xc, fl); }
  }
  /** the nodes of a record in list order: [{ ptr, ctor, mine, attach }] */
  nodeList(i) {
    const mem = this.mem, out = [];
    const c = this.ctrlOf(i); if (!c) return out;
    for (let n = mem.u32(c); n !== 0; n = mem.u32(n + 0x10)) out.push({ ptr: n, ...this.nodeOf.get(n) });
    return out;
  }

  // ------------------------------------------------------------------------------------------------ one tick
  /** the original's passes (the island's loop: FUN_0042226e, FUN_00427233, FUN_004225c5, FUN_0042271b) */
  runPasses(trace) {
    const n = this.records.length;
    this.call(0x42226e, [RB, n], 5e7, trace);
    this.call(0x427233, [RB, n], 5e7, trace);
    this.call(0x4225c5, [RB, n], 5e7, trace);
    this.call(0x42271b, [RB, n, 0, G.camera], 5e7, trace);
  }
}

/** decode the conditional branches of the original functions `entries` ([[entry, name]]) and count which outcomes a run took (as m7-walk-emu.mjs does) */
export function createCoverage(E, entries) {
  const { mem } = E;
  const lo0 = Math.min(...entries.map((r) => r[0])), hi0 = Math.max(...entries.map((r) => r[0])) + 0x2000;
  const isBr = new Uint8Array(hi0 - lo0), tgt = new Int32Array(hi0 - lo0), hit = new Uint8Array((hi0 - lo0) * 2);
  const funcs = [];
  for (const [lo, name] of entries) {
    const buf = new Uint8Array(0x2000 + 16); for (let i = 0; i < buf.length; i++) buf[i] = mem.r8(lo + i);
    const f = { name, lo, branches: [] };
    for (let o = 0; o < 0x2000;) {
      const d = decode(buf, o, lo + o); if (!d) break;
      const a = d.addr - lo0;
      if ((d.op >= 0x70 && d.op <= 0x7f) || (d.op >= 0x0f80 && d.op <= 0x0f8f)) { isBr[a] = 1; tgt[a] = d.rel; f.branches.push(d.addr); }
      o += d.len;
      if ((d.op === 0xc3 || d.op === 0xc2) && buf[o] === 0x55 && buf[o + 1] === 0x8b && buf[o + 2] === 0xec) break;
    }
    funcs.push(f);
  }
  let pend = -1;
  const trace = (cpu, at) => {
    const a = at - lo0;
    if (pend >= 0) { hit[pend * 2 + (at === tgt[pend] ? 1 : 0)] = 1; pend = -1; }
    if (a >= 0 && a < isBr.length && isBr[a]) pend = a;
  };
  const report = () => {
    let total = 0, covered = 0; const per = [], missing = [];
    for (const f of funcs) {
      let t = 0, c = 0;
      for (const b of f.branches) { const a = b - lo0; for (const k of [0, 1]) { t++; if (hit[a * 2 + k]) c++; else missing.push(`${f.name} 0x${b.toString(16)}${k ? ' taken' : ' fallthrough'}`); } }
      per.push({ name: f.name, outcomes: t, covered: c }); total += t; covered += c;
    }
    return { total, covered, per, missing };
  };
  return { trace, report };
}

// =====================================================================================================================================================
// the two-sided harness: the port's island world next to the oracle, same inputs, compared tick by tick
// =====================================================================================================================================================
import { tick as portTick } from './island-load.mjs';
import { eulerMatrix } from '../../src/zones/exact.ts';
import { loadIslandWalkMaps, startIslandNpcs, npcGlobals } from '../../src/island/npc/index.ts';
import { probeResult } from '../../src/island/npc/globals.ts';
import { setIslandRandom } from '../../src/island/rng.ts';
import { npcRig } from '../../src/island/npc/sgmfig.ts';
import { Objective } from '../../src/zones/z02LGI/objective.ts';
import { waypoints } from '../../src/game/walker.ts';
import { AnimInstance } from '../../src/game/anim.ts';

export const MINE_KINDS = new Set(['SGMFIG', 'Human1', 'launch', 'Turn2PepA', 'Turn2PepB', 'Turn2PepC', 'MeetPepp', 'BrickBotA', 'BrickBotB', 'BrickBotC', 'BrickBotD']);

/** an inert node (update returns 0) that keeps the gate of a node of another family: the controller lists keep their order and the other families do not interfere */
class StubNode {
  constructor(n) { this.kind = 'stub'; this.var = n.var; this.mask = n.mask; this.value = n.value; this.stamp = 0xfffffffe; this.was = n.kind; }
  update() { return 0; }
}

/**
 * build the port world and the oracle for a story node; `o`: { node, dt, ctors, keep (extra node kinds the port keeps), npcFile, sayTicks, cutsceneTicks, seed }
 */
export function createPair(ctx, loadIsland, o = {}) {
  const I = loadIsland(ctx, { node: o.node ?? 2, npcFile: o.npcFile ?? 'LI/Data/lifsm1.str' });
  const w = I.world;
  w.dt = o.dt ?? 1;
  I.ictx.sayTicks = o.sayTicks ?? 60; I.ictx.cutsceneTicks = o.cutsceneTicks ?? 0;
  // the port's random numbers: a recorded stream (the oracle replays what the port drew)
  const drawn = [];
  let seed = (o.seed ?? 1) >>> 0;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed >>> 8) / 16777216; };
  const draw = () => { const v = next(); drawn.push(v); return v; };
  setIslandRandom(draw);
  const realRandom = Math.random;
  Math.random = draw;
  const restore = () => { Math.random = realRandom; setIslandRandom(null); };
  // the oracle is built first, from the state the port's world has right after setup (the constructors of both sides then start from the same records)
  const E = new IslNpcEmu(ctx, I, { dt: w.dt, ctors: o.ctors, rng: () => 0, pepperIndex: w.focus.index, text: I.ictx.text.npc, sayTicks: I.ictx.sayTicks, cutsceneTicks: I.ictx.cutsceneTicks });
  E.loadWaypoints();
  const pep = w.focus;
  const pc = E.makeController(pep.index);
  E.mem.w32(pc + 0xc, pep.ctrl.flags);
  for (const r of w.records) if (r.anim) E.pushAnim(r);
  // the animation instances the original's builder gives to the minifigs (the port's SGMFIG init creates them from the MFIG rig: clip 0, frame 0)
  const rig = npcRig(w);
  for (const at of I.profile.island.attaches) if (at.ctor === CTORS.SGMFIG && !w.records[at.record].anim) E.pushAnim(w.records[at.record], new AnimInstance(rig));
  E.buildNodes(I.profile.island.attaches);
  for (let k = 0; k < 18; k++) E.mem.wf32(G.camera + 4 * k, w.camera.c[k]);
  loadIslandWalkMaps(I.archive, I.profile.island);
  // the constructors' world work: the port runs them in the original's attach order (FINDING D1 fixed: startIslandNpcs sorts the nodes by creation order)
  startIslandNpcs(w);
  // stubs for every node of other families (the start of the NPC nodes has run above)
  const keep = new Set([...MINE_KINDS, ...(o.keep ?? [])]);
  for (const r of w.records) {
    if (!r.ctrl) continue;
    r.ctrl.nodes = r.ctrl.nodes.map((n) => (keep.has(n.kind) ? n : new StubNode(n)));
    r.ctrl.exclusive = null;
  }
  const events = [];
  const ic = I.ictx;
  const sfx = ic.sfx.bind(ic), stopSfx = ic.stopSfx.bind(ic), say = ic.say.bind(ic), startCs = ic.startCutscene.bind(ic), stopSpeech = ic.stopSpeech.bind(ic);
  ic.sfx = (id) => { events.push(`sfx ${id}`); sfx(id); };
  ic.stopSfx = (id) => { events.push(`stopsfx ${id}`); stopSfx(id); };
  ic.say = (table, id, id2) => { const ok = say(table, id, id2); if (ok) events.push(`say ${id}${id2 ? `+${id2}` : ''}`); return ok; };
  ic.startCutscene = (slot) => { events.push(`cutscene ${slot}`); return startCs(slot); };
  ic.stopSpeech = () => { events.push('stopspeech'); stopSpeech(); };
  ic.expression = (rec, n) => { events.push(`face ${n}`); };
  ic.cameraHold = (on) => { events.push(`camhold ${on ? 1 : 0}`); };
  // the story's objective (WP8's `Objective`, the port's side of FUN_00424e37): both sides get the same mode / targets through `setObjective`
  const goal = new Objective();
  ic.objective = { target: (from) => goal.target(w.records, from, w.vars.get(0x5e), (n) => waypoints.nodePos(1, n), null), holoTimer: 0 };
  const P = { I, w, E, pep, events, drawn, restore, ic, goal };
  return P;
}

const mem0 = (E) => E.mem;

/** set the story's objective on both sides: mode 0 none (the default branch of FUN_00424e37), 1 record, 2 pair, 3 PATH node, 4 nearest of four records */
export function setObjective(P, mode, recs = [], node = -1) {
  const { goal, E } = P, mem = E.mem;
  const r4 = [recs[0] ?? -1, recs[1] ?? -1, recs[2] ?? -1, recs[3] ?? -1];
  goal.clear(); goal.mode = mode; goal.recs = r4; goal.node = node;
  mem.w32(G.objMode, mode);
  for (let k = 0; k < 4; k++) mem.w32(G.objMode + 4 + 4 * k, r4[k] >= 0 ? E.recPtr(r4[k]) : 0);
  mem.w32(0x8add70, node);
}
/** write a game variable on both sides */
export function setVar(P, i, v) { P.w.vars.set(i, v); P.E.mem.w32(G.varArray + 4 * i, v); }

/** place Pepper in BOTH worlds (position, yaw; y defaults to the terrain below) */
export function placePepper(P, x, z, ry, y) {
  const { w, E, pep } = P;
  const g = y ?? (w.col.terrainHeight(x, pep.y + 200, z, 0));
  pep.ry = f32(ry);
  eulerMatrix(pep.m, 0, pep.ry, 0, x, g > -1e30 ? g : pep.y, z);
  E.mirrorRecord(pep);
}

/** one tick of both sides: `keys` = browser key codes held during the tick (the port's input), the oracle gets the same pressed / held words */
export function stepPair(P, keys = []) {
  const { I, w, E, events, drawn, pep } = P;
  events.length = 0; drawn.length = 0;
  // record flag 1 (in the view frustum) is set by the renderer's draw in the original (FUN_00444480 -> FUN_00444370) and by `ctx.inFrustum` in the port: scripted here, the same in both
  const view = P.view ?? (() => true);
  for (const r of w.records) {
    if (!r.ctrl) continue;
    const on = view(r) ? 1 : 0;
    r.flags = (r.flags & ~1) | on;
    const a = E.recPtr(r.index) + 0x60;
    mem0(E).w16(a, (mem0(E).r16(a) & ~1) | on);
  }
  for (const k of keys) w.input.setKey(k, true);
  portTick(I, 1);
  for (const k of keys) w.input.setKey(k, false);
  const pe = events.slice(), pd = drawn.slice();
  // the oracle: the same input words, the same random numbers, the same dt
  const mem = E.mem;
  mem.w32(G.pressed, w.input.pressed); mem.w32(G.held, w.input.held);
  mem.wf32(G.dt, w.dt); mem.wf32(G.invDt, 1 / w.dt);
  E.log = []; E.randDraws = 0; E.subtitles = 0;
  let qi = 0; E.rand = () => (qi < pd.length ? pd[qi++] : 0);
  E.runPasses();
  if (E.say.left > 0) E.say.left--;
  if (E.cs.left > 0) E.cs.left--;
  return { portEvents: pe, emuEvents: E.log, portDraws: pd.length, emuDraws: E.randDraws, subtitles: E.subtitles };
}

// =====================================================================================================================================================
// state comparison
// =====================================================================================================================================================
/** the node fields (offsets of the original's node blocks) and the port fields they correspond to; types: f32 i32 u32 u8 i8 u16 i16 */
export const NODE_MAPS = {
  SGMFIG: [
    [0x14, 'f32', (n) => n.talkR2], [0x18, 'f32', (n) => n.nearR2], [0x1c, 'u16', (n) => n.needMask], [0x28, 'i16', (n) => n.animSetIndex], [0x2a, 'i16', (n) => n.rewardVar], [0x2c, 'i16', (n) => n.rewardOp],
    [0x32, 'i16', (n) => n.savedClip], [0x36, 'u8', (n) => n.falling], [0x37, 'u8', (n) => n.pushed], [0x38, 'u8', (n) => n.camDue], [0x3c, 'f32', (n) => n.saved[0]], [0x40, 'f32', (n) => n.saved[1]], [0x44, 'f32', (n) => n.saved[2]],
    [0x48, 'f32', (n) => n.fallVel], [0x4c, 'u32', (n) => n.talk], [0x50, 'i16', (n) => n.talk50], [0x52, 'i16', (n) => n.slot], [0x54, 'f32', (n) => n.timer], [0x58, 'u8', (n) => n.line], [0x59, 'u8', (n) => n.talks],
  ],
  Human1: [
    [0x18, 'u8', (n) => n.args.count], [0x19, 'u8', (n) => n.args.restart], [0x1a, 'i16', (n) => n.walkClip], [0x1c, 'i16', (n) => n.idleClip], [0x20, 'f32', (n) => n.speed], [0x28, 'i16', (n) => n.passed], [0x2a, 'u8', (n) => n.index],
    [0x2b, 'i8', (n) => n.due], [0x2c, 'f32', (n) => n.hop], [0x30, 'u8', (n) => n.hopping], [0x31, 'u8', (n) => n.restartClip], [0x33, 'u8', (n) => n.stopped], [0x34, 'f32', (n) => n.wait],
  ],
  Turn2PepA: [
    [0x1a, 'u8', (n) => n.timers], [0x24, 'f32', (n) => n.heading], [0x28, 'u8', (n) => n.back], [0x2a, 'u8', (n) => n.waved], [0x2c, 'f32', (n) => n.pause], [0x30, 'f32', (n) => n.delay],
  ],
  Turn2PepB: [[0x30, 'f32', (n) => n.heading], [0x34, 'f32', (n) => n.idleTime], [0x38, 'i16', (n) => n.back], [0x3a, 'i16', (n) => n.loops]],
  MeetPepp: [[0x24, 'i16', (n) => n.loops]],
};

const F = new DataView(new ArrayBuffer(8));
function readTyped(mem, a, t) {
  switch (t) {
    case 'f32': return mem.f32(a);
    case 'i32': return mem.r32(a);
    case 'u32': return mem.u32(a);
    case 'u8': return mem.r8(a);
    case 'i8': return (mem.r8(a) << 24) >> 24;
    case 'u16': return mem.r16(a);
    case 'i16': return (mem.r16(a) << 16) >> 16;
  }
  throw new Error(t);
}
const normPort = (v, t) => {
  if (typeof v === 'boolean') v = v ? 1 : 0;
  switch (t) {
    case 'f32': return v;     // exact: a float field of the port must already hold a float32 value
    case 'u8': return v & 0xff;
    case 'i8': return (v << 24) >> 24;
    case 'u16': return v & 0xffff;
    case 'i16': return (v << 16) >> 16;
    case 'u32': return v >>> 0;
    default: return v | 0;
  }
};
/** bit-exact comparison of float32 values (WP-ISLAND-FIX: tolerance 0; NaN equals NaN, -0 equals 0 as the walker oracles do) */
export const close = (a, b) => a === b || (a !== a && b !== b);

/** the records the comparison covers: every record with a node of the verified families, plus Pepper */
export function scopeOf(P) {
  return P.w.records.filter((r) => r === P.pep || (r.ctrl && r.ctrl.nodes.some((n) => MINE_KINDS.has(n.kind))));
}

/**
 * compare the whole state of both sides; returns { diffs: [string], checks, maxDev: { m, frame } }. opts.skipY: ignore the y translation (the first ticks: finding D2)
 */
export function compareState(P, tickLabel, opts = {}) {
  const { w, E, pep } = P;
  const mem = E.mem, diffs = [];
  let checks = 0;
  const maxDev = P.maxDev ?? (P.maxDev = { m: 0, frame: 0, dist: 0 });
  /** a difference: k = kind (matrix, euler, flags, clip, frame, ctrl, ran, dist, probe, stamp, node, var, global, camera), rec = record index (-1: global) */
  const bad = (k, rec, msg, orig, port) => { diffs.push({ tick: tickLabel, k, rec, msg: `${tickLabel}: ${msg}`, orig, port }); };
  const num = (k, what, orig, port) => { checks++; if (!close(orig, port)) bad(k, -1, `${what}: original ${orig} port ${port}`, orig, port); };
  const eq = (k, rec, what, orig, port) => { checks++; if (JSON.stringify(orig) !== JSON.stringify(port)) bad(k, rec, `${what}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`, orig, port); };
  const scope = P.scope ?? (P.scope = scopeOf(P));
  for (const r of scope) {
    const e = E.readRecord(r.index), an = E.readAnim(r.index), nm = `${r.name}#${r.index}`;
    for (let k = 0; k < 16; k++) {
      if (opts.skipY && k === 13) continue;
      checks++;
      const d = Math.abs(e.m[k] - r.m[k]);
      if (d > maxDev.m) maxDev.m = d;
      if (!close(e.m[k], r.m[k])) { bad('matrix', r.index, `${nm} matrix[${k}]: original ${e.m[k]} port ${r.m[k]}`, e.m[k], r.m[k]); break; }
    }
    for (let k = 0; k < 3; k++) {
      const pv = [r.rx, r.ry, r.rz][k];
      checks++;
      if (!close(e.e[k], pv)) bad('euler', r.index, `${nm} euler[${k}]: original ${e.e[k]} port ${pv}`, e.e[k], pv);
    }
    eq('flags', r.index, `${nm} flags`, e.flags, r.flags & 0xffff);
    if (r.anim && an) {
      eq('clip', r.index, `${nm} clip`, an.clip, r.anim.clip);
      checks++; const d = Math.abs(an.frame - r.anim.frame); if (d > maxDev.frame) maxDev.frame = d;
      if (!close(an.frame, r.anim.frame)) bad('frame', r.index, `${nm} frame: original ${an.frame} port ${r.anim.frame}`, an.frame, r.anim.frame);
    } else eq('anim', r.index, `${nm} has anim`, !!an, !!r.anim);
    const c = E.ctrlOf(r.index);
    if (r.ctrl && c) {
      eq('ctrl', r.index, `${nm} ctrl flags`, mem.r32(c + 0xc), r.ctrl.flags);
      let ranBits = 0; r.ctrl.ran.forEach((x, i) => { if (x) ranBits |= 1 << i; });
      eq('ran', r.index, `${nm} ran bits`, mem.r32(c + 8), ranBits);
      checks++;
      { const od = mem.f32(c + 0x18), pd = r.ctrl.distSq; if (!close(od, pd)) bad('dist', r.index, `${nm} dist2: original ${od} port ${pd}`, od, pd); }
      // (+0x14 is zeroed by the draw pass of the original at the end of every frame: FUN_0042271b `ctrl[5] = 0`; the port keeps bit 0x10 (finding D3), so only the observable effect is compared)
      const pr = probeResult(r.ctrl), er = mem.u32(c + 0x64);
      checks++;
      const prv = typeof pr === 'number' ? pr : (pr.rec?.index ?? pr.index) + 1000;     // (a hit is the collision object: its record)
      const erv = er === 0 || er === 1 || er === 0xbabababa ? er : E.recIndexOf(er) + 1000;
      if (prv !== erv) bad('probe', r.index, `${nm} probe result: original ${erv} port ${prv}`, erv, prv);
      const list = E.nodeList(r.index);
      for (let i = 0; i < r.ctrl.nodes.length && r !== pep; i++) {
        const pn = r.ctrl.nodes[i], en = list[i];
        if (!en) { bad('node', r.index, `${nm} node ${i}: no original node`); continue; }
        eq('stamp', r.index, `${nm} node ${i} (${pn.kind}) stamp`, mem.u32(en.ptr + 8) >>> 0, pn.stamp >>> 0);
        const map = NODE_MAPS[pn.kind];
        if (!map) continue;
        for (const [off, t, get] of map) {
          const ov = readTyped(mem, en.ptr + off, t), pv = normPort(get(pn), t);
          if (pn.kind === 'Turn2PepA' && off === 0x1a && get(pn) < 0) continue;     // set by the first update in the port, by the constructor in the original
          checks++;
          if (t === 'f32' ? !close(ov, pv) : ov !== pv) bad('node', r.index, `${nm} ${pn.kind}[${i}] +0x${off.toString(16)}: original ${ov} port ${pv}`, ov, pv);
        }
      }
    }
  }
  const ov = E.readVars();
  for (let i = 0; i < VAR_COUNT; i++) { checks++; if (ov[i] !== (w.vars.get(i) | 0)) bad('var', -1, `var ${i}: original 0x${(ov[i] >>> 0).toString(16)} port 0x${(w.vars.get(i) >>> 0).toString(16)}`, ov[i], w.vars.get(i) | 0); }
  const g = npcGlobals(w);
  num('global', 'best (DAT_009da640)', mem.f32(G.best), g.best);
  eq('global', -1, 'target (DAT_009da6d0)', mem.u32(G.target) ? E.recIndexOf(mem.u32(G.target)) : -1, g.target ? g.target.index : -1);
  eq('global', -1, 'lock (DAT_009da844)', mem.r32(G.lock), g.lock);
  eq('global', -1, 'mailbox (DAT_008ae088)', mem.r8(G.mailbox), w.pep.mailbox);
  eq('global', -1, 'cutscene held', E.cs.held, !!P.ic.held);
  eq('global', -1, 'cutscene left', E.cs.left, P.ic.cutsceneLeft);
  eq('global', -1, 'speech left', E.say.left, P.ic.sayLeft);
  for (let k = 0; k < 6; k++) num('camera', `camera[${k}]`, mem.f32(G.camera + 4 * k), w.camera.c[k]);
  return { diffs, checks };
}

// =====================================================================================================================================================
// scenario helpers
// =====================================================================================================================================================
/** Pepper at distance `d` from `npc`, `off` radians from the NPC's heading (0 = in front), facing the NPC */
export function pepperAt(P, npc, d, off = 0, faceOff = 0) {
  const a = npc.ry + off, x = npc.x + Math.sin(a) * d, z = npc.z + Math.cos(a) * d;
  placePepper(P, x, z, Math.atan2(npc.x - x, npc.z - z) + faceOff, npc.y);
}
/** the SGMFIG node of a record */
export const sgOf = (rec) => rec.ctrl?.nodes.find((n) => n.kind === 'SGMFIG');
export const hex = (v) => '0x' + (v >>> 0).toString(16);

/**
 * run `ticks` ticks of both sides; `script(t, P)` returns the keys held (and places Pepper). Everything that differs is a failure in `st.fail` (tolerance 0). `st` is shared between calls.
 */
export function newStats() { return { checked: 0, ticks: 0, fail: [], events: 0, states: new Set(), said: new Set(), cutscenes: 0, talks: 0 }; }
export function runPair(P, ticks, script, st, label = '') {
  const { w } = P;
  for (let t = 0; t < ticks; t++) {
    const keys = script(t, P) ?? [];
    const s = stepPair(P, keys);
    const tag = `${label}t${t}`;
    const r = compareState(P, tag);
    st.checked += r.checks; st.ticks++;
    for (const d of r.diffs) if (st.fail.length < 14) st.fail.push(d.msg);
    st.checked++;
    if (JSON.stringify(s.portEvents) !== JSON.stringify(s.emuEvents)) { if (st.fail.length < 14) st.fail.push(`${tag}: events: original ${JSON.stringify(s.emuEvents)} port ${JSON.stringify(s.portEvents)}`); }
    st.checked++;
    if (s.portDraws !== s.emuDraws) { if (st.fail.length < 14) st.fail.push(`${tag}: random draws: original ${s.emuDraws} port ${s.portDraws}`); }
    const says = (v) => s.portEvents.filter((e) => e.startsWith('say ')).length;
    st.checked++;
    if (s.subtitles !== (w.vars.get(0) !== 0 ? says() : 0)) { if (st.fail.length < 14) st.fail.push(`${tag}: subtitle calls ${s.subtitles} for ${says()} lines`); }
    st.events += s.portEvents.length;
    for (const e of s.portEvents) { if (e.startsWith('say ')) st.said.add(e); if (e.startsWith('cutscene')) st.cutscenes++; }
    for (const r2 of P.scope) { const n = sgOf(r2); if (n) { st.states.add(w.vars.get(n.var) & 0x7ff0f); if (n.talk & 0x40) st.talks++; } }
  }
}
