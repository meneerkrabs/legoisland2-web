// WP-SAVE (F3) oracle for the brick effect slots: the original's FX_Bricks manager code run natively in the x86 emulation (SaveEmu hosts the save code of the shell, tools/lib/m7-shell-save-emu.mjs)
// next to the port's `BrickFxManager` (src/fx/bricks/manager.ts, save.ts).
//
// NATIVE (the original's code, real): the registration / configuration wrappers FUN_00447d20 (register), FUN_00447da0 (add model: sprintf of the path + FUN_0044a070 + FUN_0044dba0), FUN_00447d70
// (stage), FUN_00447ed0 (wait), FUN_00447e70 (parent matrix), FUN_00447e90 (burst), the per-frame FUN_0044a180, the writer FUN_00449a10, the loader FUN_00449be0, the slot helpers FUN_0044c280 /
// FUN_0044c2c0 / FUN_0044c300 / FUN_0044c3f0, FUN_00449f50 (callback by id), FUN_00417575 (game variables), __ftol / sprintf of the C runtime.
// OBSERVED while running natively: the stage callbacks (their entry is logged: function class, slot, stage). HOSTED (replaced): FUN_0044d570 (the model parser: it returns a model block with
// `bricksPerModel` zeroed brick blocks and logs the path it was given), FUN_0045d5c0 (record by tag: the same strncmp walk over the record array), FUN_0043ac78 (identity), the engine calls that free
// things (FUN_0044db30, FUN_0044ad00) and stop sounds. The brick simulation itself (actions, drops, morphs) is NOT the subject: the port's side runs with an empty / stub library in these tests, so
// both machines work on models that cannot start brick actions, and every state the slots can be in is still reachable through the controlled fields.
import { SaveEmu, A, RECORDS_BASE, REC } from './m7-shell-save-emu.mjs';
import { BrickFxManager } from '../../src/fx/bricks/manager.ts';
import { captureBricks, applyBricks } from '../../src/fx/bricks/save.ts';
import { tagOf } from '../../src/shell/saveworld.ts';

export const SLOT = 0x1730, SLOTS = 64, BASE = A.BRICK0 - 0x1710, IMG = 0x16aa;
/** the callback entry points FUN_00449f50 returns, by function id (the default case FUN_0044cd30 serves every other id) */
export const CALLBACKS = { 0x44c4c0: 0, 0x44c550: 1, 0x44c5e0: 2, 0x44cd30: 'default', 0x44cbe0: 4, 0x44cd60: 5, 0x44ced0: 7, 0x44d010: 8, 0x44c6c0: 10, 0x44c820: 11, 0x44c980: 12, 0x44cad0: 13 };
export const classOfFn = (id) => ([0, 1, 2, 4, 5, 7, 8, 10, 11, 12, 13].includes(id) ? id : 'default');
export const STACK_FILL = 0xcccccccc;

export class BrickEmu {
  /**
   * @param pe the executable; @param o { records: [{ name, flags }], vars (Int32Array 319, shared), root (the path root DAT_009836f8), bricksPerModel (fn(file) -> n), lib (port library) }
   */
  constructor(pe, o) {
    const E = (this.E = new SaveEmu(pe));
    const cpu = (this.cpu = E.cpu), mem = (this.mem = E.mem), H = cpu.hooks, L = this;
    this.records = o.records;
    this.bricksPerModel = o.bricksPerModel ?? (() => 0);
    this.cbLog = [];          // { fn (class), slot (index), stage }
    this.models = [];         // FUN_0044d570 calls: { path, ptr }
    cpu.exec.push([0x447c90, 0x44a5f0], [0x44c280, 0x44d170], [0x44dba0, 0x44dc90], [0x44dae0, 0x44db30], [0x44db70, 0x44dba0]);
    H.delete(0x449be0);       // the loader runs natively here
    // the memory the original reads: the record array, the game variables, the path root
    mem.w32(A.RECN, o.records.length); mem.w32(A.RECP, RECORDS_BASE);
    o.records.forEach((r, i) => { const a = RECORDS_BASE + i * REC; mem.fill(a, REC, 0); mem.w32(a, tagOf(r.name)); mem.w16(a + 0x60, r.flags ?? 0); });
    for (let i = 0; i < 319; i++) mem.w32(A.VARS + 4 * i, o.vars[i]);
    this.root = E.alloc(0x200);
    const root = o.root;
    for (let i = 0; i < root.length; i++) mem.w8(0x9836f8 + i, root.charCodeAt(i));
    mem.w8(0x9836f8 + root.length, 0);
    // FUN_0044d570(path): a model block (0x7c bytes zeroed) with N zeroed brick blocks (0x180: next +0x48, visible +0xde) chained head (+0) .. tail (+4), count +0x64
    H.set(0x44d570, (c) => {
      const path = mem.cstr(c.arg(0));
      const file = path.slice(path.toLowerCase().lastIndexOf('brickmorph\\') + 11);
      const m = L.pmalloc(0x7c);
      const n = path.toLowerCase().includes('brickmorph\\') ? L.bricksPerModel(file) : 0;
      let head = 0, tail = 0;
      const ptrs = [];
      for (let k = 0; k < n; k++) { const b = L.pmalloc(0x180); mem.w32(b + 0x48, head); if (head) mem.w32(head + 0x4c, b); else tail = b; head = b; ptrs.push(b); }
      mem.w32(m, head); mem.w32(m + 4, tail); mem.w32(m + 0x64, n);
      L.models.push({ path, ptr: m, n });
      o.fill?.(file, m, ptrs, L);     // (simulation oracle: the bricks' fields and the model's layer count come from the port's parse of the same file)
      c.eax = m;
    });
    for (const a of [0x44d330, 0x44db30, 0x4434b0, 0x4433f0, 0x44d420, 0x43a9e5, 0x44ac70]) H.set(a, () => {});
    // FUN_0044ad00(&brick->actions) frees a brick's action list and clears the pointer; FUN_0044c180(list, pause, &swapped) runs it: an armed brick (+0x54 = 1) always reports "done" (2)
    H.set(0x44ad00, (c) => { mem.w32(c.arg(0), 0); });
    H.set(0x44c180, (c) => { c.eax = 2; });
    H.set(0x43ac78, (c) => { const p = c.arg(0); for (let k = 0; k < 16; k++) mem.wf32(p + 4 * k, k % 5 === 0 ? 1 : 0); });
    // FUN_0045d5c0(&tag): the first record whose 4 bytes equal the tag by strncmp (0 = none)
    H.set(0x45d5c0, (c) => {
      const tag = c.arg(0);
      for (let i = 0; i < L.records.length; i++) {
        const rp = RECORDS_BASE + i * REC;
        let same = true;
        for (let k = 0; k < 4; k++) { const a = mem.r8(tag + k) & 0xff, b = mem.r8(rp + k) & 0xff; if (a !== b) { same = false; break; } if (a === 0) break; }
        if (same) { c.eax = rp; return; }
      }
      c.eax = 0;
    });
    // the stage callbacks run for real (on models without bricks, or the default callback on `bricksPerModel` bricks): observed, not replaced
    for (const [addr, id] of Object.entries(CALLBACKS)) {
      cpu.watches.set(Number(addr), (c) => { L.cbLog.push({ fn: id, slot: (c.arg(0) - BASE) / SLOT, stage: c.arg(2) & 0xff }); });
    }
    if (o.sim) {
      // the simulation oracle (tools/lib/brick-sim-emu.mjs): the brick actions, the brick matrices, the pairing and the stage callbacks run natively; only the model parser, the sounds and the mesh
      // transform of the draw (FUN_00886be0) stay hosted. The pool of actions is set up by FUN_0044ac70 like the original's start-up does.
      for (const a of [0x44d330, 0x44d420, 0x43a9e5, 0x44ac70, 0x44ad00, 0x44c180, 0x43ac78]) H.delete(a);
      cpu.exec.push([0x438880, 0x438970], [0x43a340, 0x43acb0], [0x43cec0, 0x43cf50], [0x447c90, 0x44e800]);
      this.snd = [];
      const at = (p) => (p ? [mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)] : null);
      H.set(0x4433f0, (c) => { this.snd.push({ play: c.arg(0) >>> 0, pos: at(c.arg(1)) }); c.eax = 0; });
      H.set(0x4434b0, (c) => { this.snd.push({ stop: c.arg(0) >>> 0 }); c.eax = 0; });
      H.set(0x886be0, (c) => { c.eax = 0; });
    }
    // scratch buffers (the heap of SaveEmu is small: nothing is allocated per call)
    this.bufImg = this.alloc(0x60000); this.bufLoad = this.alloc(0x60000); this.bufStr = this.alloc(0x400); this.bufWords = this.alloc(0x80);
    this.poolBase = this.alloc(0x300000); this.pool = this.poolBase;
    if (o.sim) this.call(0x44ac70, []);
  }
  alloc(n) { return this.E.alloc(n); }
  /** model / brick blocks (zeroed); rewound when the loader rebuilds the whole table */
  pmalloc(n) { const p = this.pool; this.pool += (n + 15) & ~15; this.mem.fill(p, n, 0); return p; }
  call(a, args = [], maxSteps = 20_000_000) { this.cpu.steps = 0; return this.cpu.call(a, args, { maxSteps }); }
  rec(i) { return RECORDS_BASE + i * REC; }
  setVar(i, v) { this.mem.w32(A.VARS + 4 * i, v); }
  str(s) { const p = this.bufStr; for (let i = 0; i < s.length; i++) this.mem.w8(p + i, s.charCodeAt(i)); this.mem.w8(p + s.length, 0); return p; }
  words(w) { const p = this.bufWords; for (let k = 0; k < 24; k++) this.mem.w32(p + 4 * k, (w[k] ?? 0) >>> 0); return p; }

  // ---- the original's API (FUN_00447xxx wrappers)
  register(recIndex, v) { return this.call(0x447d20, [this.rec(recIndex), v]) | 0; }
  addModel(slot, file) { this.call(0x447da0, [slot, this.str(file), 0]); }
  stage(slot, k, fn, words, vis) { this.call(0x447d70, [slot, k, fn, this.words(words), vis]); }
  wait(slot, secs) { this.call(0x447ed0, [slot, new Uint32Array(new Float32Array([secs]).buffer)[0]]); }
  burst(recIndex, kind) { this.call(0x447e90, [this.rec(recIndex), kind]); }
  update() { this.call(0x44a180, []); }
  state(slot) { return this.call(0x447e60, [slot]) | 0; }
  /** FUN_00449a10 split into the 64 entries (null = the single 0 byte) */
  images() {
    const dst = this.bufImg;
    const n = this.call(0x449a10, [dst]);
    const out = []; let p = 0;
    const all = this.mem.read(dst, n);
    for (let i = 0; i < SLOTS; i++) { if (all[p] === 0) { out.push(null); p += 1; } else { out.push(all.slice(p, p + IMG)); p += IMG; } }
    if (p !== n) throw new Error(`brick writer returned ${n} bytes, entries add up to ${p}`);
    return out;
  }
  /** FUN_00449be0 on 64 entries laid out the way the file has them */
  load(imgs) {
    const total = imgs.reduce((s, b) => s + (b ? IMG : 1), 0);
    const src = this.bufLoad; let p = src;
    for (const b of imgs) { if (b) { this.mem.write(p, b); p += IMG; } else { this.mem.w8(p, 0); p += 1; } }
    this.cbLog.length = 0; this.models.length = 0; this.pool = this.poolBase;
    this.call(0x449be0, [src], this.loadSteps ?? 20_000_000);
  }
  /** the original's slot memory (for the fields the image does not carry) */
  slotBytes(i) { return this.mem.read(BASE + i * SLOT, SLOT); }
  recFlags(i) { return this.mem.r16(RECORDS_BASE + i * REC + 0x60); }
  /** give every brick of every model of every slot in use an "action" (+0x54 = 1: FUN_0044c180 is hosted and answers 2) */
  armAll() {
    for (let i = 0; i < SLOTS; i++) {
      if (!this.mem.r8(BASE + i * SLOT + 0x1710)) continue;
      const cnt = this.mem.r8(BASE + i * SLOT + 0x1723);
      for (let k = 0; k < cnt; k++) for (let b = this.mem.u32(this.mem.u32(BASE + i * SLOT + 0x16c0 + 4 * k)); b; b = this.mem.u32(b + 0x48)) this.mem.w32(b + 0x54, 1);
    }
  }
  /** model brick visibility of a slot: per model, the bytes +0xde of the chain (head first) */
  brickVisible(i) {
    const out = [];
    const cnt = this.mem.r8(BASE + i * SLOT + 0x1723);
    for (let k = 0; k < cnt; k++) {
      const mp = this.mem.u32(BASE + i * SLOT + 0x16c0 + 4 * k), v = [];
      for (let b = this.mem.u32(mp); b; b = this.mem.u32(b + 0x48)) v.push(this.mem.r8(b + 0xde));
      out.push(v);
    }
    return out;
  }
}

/** the stub library of the port's side: every model name resolves to a model with `n(file)` bricks of an unknown type (they never start an action here) */
export function stubLibrary(bricksPerModel = () => 0) {
  return {
    types: [],
    model(file) {
      const n = bricksPerModel(file);
      return { name: file, centreMode: 0, centre: [0, 0, 0], layers: 0, invExtent: [1, 1, 1], invExtentSq: 3, bricks: Array.from({ length: n }, (_, i) => ({ type: 0, pos: [i, 0, 0], rot: [0, 0, 0], colour: 7, colour2: -1, layer: 0, group: 255, norm: [i / 4, 0, 0], line: i + 1 })) };
    },
  };
}

/** a port world with a manager over the stub library, sharing `vars` with the native machine; `captureBricks(w)` / `applyBricks(w, imgs)` run on it */
export function portWorld(records, vars, lib) {
  const recs = records.map((r, i) => ({ index: i, name: r.name, m: new Float32Array(16).fill(0).map((_, k) => (k % 5 === 0 ? 1 : 0)), flags: r.flags ?? 0 }));
  const sounds = [];
  let rseed = 1;
  const env = {
    vars: { get: (i) => vars[i], set: (i, v) => { vars[i] = v; } },
    sound: (h, p, stop) => { sounds.push([h, !!stop]); },
    rand: (m) => { rseed = (Math.imul(rseed, 1103515245) + 12345) >>> 0; return Math.fround(((rseed >>> 8) / 16777216) * m); },
    eye: () => [0, 0, 0],
  };
  const fx = new BrickFxManager(lib, env);
  const w = { records: recs, vars: env.vars, ext: new Map([['brickFx', fx]]), dt: 1 };
  return { w, fx, recs, sounds };
}
export { captureBricks, applyBricks };
