// WP-TIME oracle for the FX_Bricks SIMULATION: the original's brick code runs natively in the x86 interpreter (BrickEmu with `sim: true`, tools/lib/m8-save-bricks.mjs) next to the port's
// `BrickFxManager` (src/fx/bricks/manager.ts, sim.ts), both on the same models, stage callbacks, game variables, camera, record flags, burst / finish calls and per-frame dt, with the C runtime's
// rand() seeded the same (FUN_004388ae natively, `randF` of src/game/crt.ts in the port).
//
// NATIVE (the original's code): FUN_0044a180 (the per-frame update), FUN_0044c300 (the slot step), FUN_0044c180 + every action of Bricks.c (FUN_0044ad30 .. FUN_0044c030), the action pool
// (FUN_0044ac70 / aca0 / ad00 / ace0), the brick rebuild FUN_0044d330 / d1d0 / d2f0, the draw pass FUN_0044dae0 + FUN_0044d420 (world matrix, LOD), the stage callbacks (FUN_00449f50 and
// everything it returns), the pairing FUN_0044e410 / e5a0 / e660 / e6e0, the model normalisation FUN_0044dba0, the wrappers FUN_00447d20 / da0 / d70 / ed0 / e90, FUN_00449b00 (finish),
// FUN_004388ae + rand(), the matrix functions FUN_0043a340 / a9e5 / ac78 / cec0 (24-bit x87, control word 0x7f).
// HOSTED: the model parser FUN_0044d570 (its bricks are filled from the port's parse of the same file: the PARSE is not the subject, only what the simulation makes of it), the sounds
// (recorded), the mesh transform of the draw (FUN_00886be0).
import { BrickEmu, SLOT, SLOTS, BASE } from './m8-save-bricks.mjs';
import { A, RECORDS_BASE, REC } from './m7-shell-save-emu.mjs';
import { BrickFxManager, BrickModel } from '../../src/fx/bricks/manager.ts';
import { decodeSlotImage } from '../../src/fx/bricks/save.ts';
import { randF, srand } from '../../src/game/crt.ts';
import { STACK_TOP } from '../../src/formats/x86emu.ts';

export { SLOT, SLOTS, BASE };
const F = new Float32Array(1), U = new Uint32Array(F.buffer);
export const bits = (x) => { F[0] = x; return U[0]; };
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || bits(a) === bits(b);
const DT_ADDR = 0x8b1718, SEED_ADDR = 0x964aa4, CLICKS = 0x5d3701c, DROPS = 0x5d37020;

/** one machine pair: the original's FX_Bricks natively, the port's manager, both fed the same operations */
export class BrickPair {
  /** coverage over all pairs: actions compared per type, bricks, sounds, the highest pool use, frames with a full pool, LOD values seen */
  static stats = { act: {}, bricks: 0, sounds: 0, poolMax: 0, poolFull: 0, lod: [0, 0, 0], frames: 0 };
  /** @param pe the executable; @param lib the port's BrickLibrary; @param records [{ name, flags, m }] */
  constructor(pe, lib, records, vars) {
    this.vars = vars;           // Int32Array(319), shared by value: `setVar` writes both
    this.recs = records.map((r, i) => ({ index: i, name: r.name, m: Float32Array.from(r.m), flags: r.flags & 0xffff, get enabled() { return (this.flags & 2) !== 0; } }));
    this.lib = lib;
    this.queue = [];            // the port's BrickModel of the next native addModel
    const self = this;
    this.B = new BrickEmu(pe, {
      records: records.map((r) => ({ name: r.name, flags: r.flags })), vars: Int32Array.from(vars), root: 'C:\\x\\_Data\\', sim: true,
      bricksPerModel: (file) => (self.loading ? self.loadModelOf(file).bricks.length : self.queue[0]?.bricks.length ?? 0),
      fill: (file, m, ptrs) => self.fillModel(m, ptrs, self.loading ? self.loadModelOf(file, true) : null),
    });
    const mem = this.B.mem;
    records.forEach((r, i) => { const a = RECORDS_BASE + i * REC; for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, this.recs[i].m[k]); });
    // the sound handle globals hold their own address as the handle (the port passes the address of the global: `SOUND_BLOW` ..., the original the value stored there)
    for (const a of [0x5d58200, 0x5d581f4, 0x5d581f8, 0x5d581fc, 0x5d582ec, 0x5d58130, 0x5d582dc, 0x5d582e4, 0x5d582e8, 0x5d582e0]) mem.w32(a, a);
    this.eye = [0, 0, 0];
    this.sounds = [];
    this.stats = BrickPair.stats;
    this.env = {
      vars: { get: (i) => this.vars[i], set: (i, v) => { this.vars[i] = v; } },
      sound: (h, pos, stop) => { this.sounds.push(stop ? { stop: h >>> 0 } : { play: h >>> 0, pos: pos ? [pos[0], pos[1], pos[2]] : null }); },
      rand: randF,
      eye: () => this.eye,
    };
    this.fx = new BrickFxManager(lib, this.env);
    this.setEye(0, 0, 0);
    this.setDt(1);
  }
  /** FUN_00449ec0 on both */
  register(recIndex, v) {
    const a = this.B.register(recIndex, v), b = this.fx.register(this.recs[recIndex], v);
    if (a !== b) throw new Error(`slot handles differ: native ${a} port ${b}`);
    return a;
  }
  addModel(slot, file) {
    const pm = this.fx.addModel(slot, file);
    this.queue.push(pm);
    this.B.addModel(slot, file);
    this.queue.shift();
    return pm;
  }
  stage(slot, k, fn, words, vis) { this.B.stage(slot, k, fn, words, vis); this.fx.setStageWords(slot, k, fn, words, vis); }
  wait(slot, secs) { this.B.wait(slot, secs); this.fx.setWait(slot, secs); }
  burst(recIndex, kind) {
    // FUN_0044a3b0's parameter block leaves 8 words of the stack as they were: the port assumes the compiler's 0xcc fill (BURST_PARAMS), so the native stack is filled the same way first
    this.B.mem.fill(STACK_TOP - 0x8000, 0x7f00, 0xcc);
    this.B.burst(recIndex, kind); this.fx.burst(this.recs[recIndex], kind);
  }
  finish(slot) { this.B.call(0x449b00, [slot]); this.fx.finish(slot); }
  setVar(i, v) { this.vars[i] = v; this.B.setVar(i, v); }
  setFlags(recIndex, f) { this.recs[recIndex].flags = f & 0xffff; this.B.mem.w16(RECORDS_BASE + recIndex * REC + 0x60, f & 0xffff); }
  setEye(x, y, z) { this.eye = [Math.fround(x), Math.fround(y), Math.fround(z)]; this.eye.forEach((v, k) => this.B.mem.wf32(A.CAMERA + 4 * k, v)); }
  setDt(dt) { this.dt = Math.fround(dt); this.B.mem.wf32(DT_ADDR, this.dt); }
  seed(s) { srand(s); this.B.mem.w32(SEED_ADDR, s >>> 0); }
  /** one frame of both: FUN_0044a180 and `update(dt)` */
  update() { this.B.update(); this.fx.update(this.dt); }

  /** the hosted FUN_0044d570: fill the native brick blocks and the layer count from the port's parse of the same model */
  fillModel(m, ptrs, loaded) {
    const mem = this.B.mem, pm = loaded ?? this.queue[0], bricks = pm.tail();
    mem.w32(m + 0x68, pm.layers);
    ptrs.forEach((b, k) => {
      const pb = bricks[k];
      mem.w8(b + 0x36, pb.sym);
      for (let j = 0; j < 3; j++) mem.wf32(b + 0x3c + 4 * j, pb.pivot[j]);
      for (let j = 0; j < 16; j++) mem.wf32(b + 0x5c + 4 * j, pb.local[j]);
      mem.w8(b + 0xdc, pb.dirty ? 1 : 0); mem.w8(b + 0xdd, pb.active ? 1 : 0); mem.w8(b + 0xde, pb.visible ? 1 : 0); mem.w8(b + 0xdf, pb.moving ? 1 : 0);
      mem.w32(b + 0xe4, pb.typeIndex); mem.w32(b + 0xe8, pb.colour >>> 0); mem.w32(b + 0xec, pb.colour2 >>> 0);
      mem.w16(b + 0xf0, pb.layer); mem.w8(b + 0xf3, pb.group);
      [pb.rotA, pb.rateA, pb.rotB, pb.rateB, pb.rotC, pb.rateC].forEach((v, g) => { for (let j = 0; j < 3; j++) mem.wf32(b + 0xf4 + 12 * g + 4 * j, v[j]); });
      for (let j = 0; j < 3; j++) { mem.wf32(b + 0x13c + 4 * j, pb.pos[j]); mem.wf32(b + 0x148 + 4 * j, pb.home[j]); mem.wf32(b + 0x154 + 4 * j, pb.norm[j]); mem.wf32(b + 0x160 + 4 * j, pb.offset[j]); }
      mem.w32(b + 0x178, 0x7f7fffff);
    });
  }

  /** the model the loader's FUN_0044d570 makes of a descriptor's file: bricks WITHOUT the normalised place and extent (FUN_0044dba0 does not run in the loader), as `restoreSlot` builds it */
  loadModelOf(file, fresh = false) {
    if (!fresh && this.loadCache?.file === file) return this.loadCache.model;
    const src = this.lib.model(file);
    const data = { ...src, bricks: src.bricks.map((b) => ({ ...b, norm: [0, 0, 0] })), invExtent: [0, 0, 0], invExtentSq: 0 };
    const model = new BrickModel(file, data, this.lib, null, new Float32Array(16));
    this.loadCache = { file, model };
    return model;
  }
  /** FUN_00449be0 on both: the original's loader reads the 64 images natively, the port's `restoreSlot` rebuilds the used slots (an unused image clears the slot) */
  loadImages(imgs) {
    this.loading = true;
    this.B.loadSteps = 1_500_000_000;     // (the replay of a long morph rebuilds every brick 10 x time times)
    this.B.mem.fill(STACK_TOP - 0x8000, 0x7f00, 0xcc);
    try {
      this.B.load(imgs);
      imgs.forEach((img, i) => {
        if (!img || img[0] === 0) { this.fx.slots[i] = null; return; }
        const dv = new DataView(img.buffer, img.byteOffset, img.byteLength);
        const tag = dv.getUint32(1, true);
        const rec = this.recs.find((r) => { const n = r.name; let t = 0; for (let k = 0; k < 4; k++) t |= (k < n.length ? n.charCodeAt(k) : 0) << (8 * k); return (t >>> 0) === tag; });
        this.fx.restoreSlot(i, rec, decodeSlotImage(img));
      });
    } finally { this.loading = false; }
  }

  // ---------------------------------------------------------------------------------------------------- comparison
  /** the native brick blocks of a slot, per model, head first (port order) */
  nativeBricks(slot) {
    const mem = this.B.mem, base = BASE + slot * SLOT, out = [];
    const n = mem.r8(base + 0x1723);
    for (let k = 0; k < n; k++) {
      const m = mem.u32(base + 0x16c0 + 4 * k), list = [];
      for (let b = mem.u32(m); b; b = mem.u32(b + 0x48)) list.push(b);
      out.push({ ptr: m, bricks: list });
    }
    return out;
  }
  /** all differences between the two machines now (strings), at most `limit` */
  diff(label, limit = 12) {
    const out = [], mem = this.B.mem;
    const bad = (msg) => { if (out.length < limit) out.push(`${label}: ${msg}`); };
    const f = (a) => mem.f32(a);
    const cmpF = (what, a, b) => { if (!same(a, b)) bad(`${what}: native ${a} (${bits(a).toString(16)}) port ${b} (${bits(b).toString(16)})`); };
    for (let i = 0; i < SLOTS; i++) {
      const base = BASE + i * SLOT, ps = this.fx.slots[i];
      const used = mem.r8(base + 0x1710) !== 0;
      if (used !== !!ps) { bad(`slot ${i} in use native ${used} port ${!!ps}`); continue; }
      if (!used) continue;
      const w = `slot ${i}`;
      if (mem.u32(base + 0x1708) !== ps.state) bad(`${w} state native ${mem.u32(base + 0x1708)} port ${ps.state}`);
      if (!!mem.r8(base + 0x1722) !== ps.running) bad(`${w} running`);
      if (!!mem.r8(base + 0x1724) !== ps.oneShot) bad(`${w} oneShot`);
      if (!!mem.r8(base + 0x1725) !== ps.swapped) bad(`${w} swapped`);
      if (!!mem.r8(base + 0x1726) !== ps.started) bad(`${w} started`);
      if (mem.r8(base + 0x1727) !== ps.stage) bad(`${w} stage native ${mem.r8(base + 0x1727)} port ${ps.stage}`);
      cmpF(`${w} time`, f(base + 0x1728), ps.time); cmpF(`${w} wait`, f(base + 0x172c), ps.wait);
      if ((mem.r32(base + 0x1700) | 0) !== (ps.sound | 0)) bad(`${w} sound handle native ${mem.r32(base + 0x1700) | 0} port ${ps.sound | 0}`);
      const nm = this.nativeBricks(i);
      if (nm.length !== ps.models.length) { bad(`${w} models ${nm.length} vs ${ps.models.length}`); continue; }
      const idOf = new Map();       // native brick pointer -> "model.index"
      nm.forEach((m, k) => m.bricks.forEach((b, j) => idOf.set(b, `${k}.${j}`)));
      const pid = new Map();
      ps.models.forEach((m, k) => m.bricks.forEach((b, j) => pid.set(b, `${k}.${j}`)));
      nm.forEach((m, k) => {
        const pm = ps.models[k];
        if (m.bricks.length !== pm.bricks.length) { bad(`${w} model ${k} bricks ${m.bricks.length} vs ${pm.bricks.length}`); return; }
        cmpF(`${w} m${k} invExtentSq`, f(m.ptr + 0x78), pm.data.invExtentSq);
        for (let j = 0; j < 3; j++) cmpF(`${w} m${k} invExtent[${j}]`, f(m.ptr + 0x6c + 4 * j), pm.data.invExtent[j]);
        m.bricks.forEach((nb, j) => {
          const pb = pm.bricks[j], bw = `${w} m${k}.b${j}`;
          for (let e = 0; e < 16; e++) { cmpF(`${bw} local[${e}]`, f(nb + 0x5c + 4 * e), pb.local[e]); }
          for (let e = 0; e < 16; e++) { cmpF(`${bw} world[${e}]`, f(nb + 0x9c + 4 * e), pb.world[e]); }
          [pb.rotA, pb.rateA, pb.rotB, pb.rateB, pb.rotC, pb.rateC].forEach((v, g) => { for (let e = 0; e < 3; e++) cmpF(`${bw} ${['rotA', 'rateA', 'rotB', 'rateB', 'rotC', 'rateC'][g]}[${e}]`, f(nb + 0xf4 + 12 * g + 4 * e), v[e]); });
          for (let e = 0; e < 3; e++) { cmpF(`${bw} pos[${e}]`, f(nb + 0x13c + 4 * e), pb.pos[e]); cmpF(`${bw} home[${e}]`, f(nb + 0x148 + 4 * e), pb.home[e]); cmpF(`${bw} norm[${e}]`, f(nb + 0x154 + 4 * e), pb.norm[e]); cmpF(`${bw} offset[${e}]`, f(nb + 0x160 + 4 * e), pb.offset[e]); }
          cmpF(`${bw} dist`, f(nb + 0x178), pb.dist);
          this.stats.bricks++; if (pb.visible) this.stats.lod[pb.lod]++;
          if (!!mem.r8(nb + 0xdc) !== pb.dirty) bad(`${bw} dirty`);
          if (!!mem.r8(nb + 0xdd) !== pb.active) bad(`${bw} active`);
          if (!!mem.r8(nb + 0xde) !== pb.visible) bad(`${bw} visible`);
          if (!!mem.r8(nb + 0xdf) !== pb.moving) bad(`${bw} moving`);
          if (mem.r8(nb + 0xf2) !== pb.lod && mem.r8(nb + 0xde)) bad(`${bw} lod native ${mem.r8(nb + 0xf2)} port ${pb.lod}`);
          const part = mem.u32(nb + 0x58);
          if ((idOf.get(part) ?? null) !== (pb.partner ? pid.get(pb.partner) : null)) bad(`${bw} partner native ${idOf.get(part) ?? null} port ${pb.partner ? pid.get(pb.partner) : null}`);
          // the action list, head first
          let a = mem.u32(nb + 0x54), k2 = 0;
          for (; a && k2 < pb.actions.length; a = mem.u32(a + 8), k2++) {
            const pa = pb.actions[k2], aw = `${bw} act${k2}`;
            this.stats.act[pa.type] = (this.stats.act[pa.type] ?? 0) + 1;
            if (mem.u32(a) !== pa.type) { bad(`${aw} type native ${mem.u32(a)} port ${pa.type}`); break; }
            if (mem.u32(a + 4) !== pa.state) bad(`${aw} (type ${pa.type}) state native ${mem.u32(a + 4)} port ${pa.state}`);
            cmpF(`${aw} (type ${pa.type}) delay`, f(a + 0x14), pa.delay);
            const v = pa.v;
            switch (pa.type) {
              case 1: if (mem.r8(a + 0x18) !== (pa.b18 & 0xff) || mem.r8(a + 0x19) !== (pa.b19 & 0xff)) bad(`${aw} delay vis/wait`); break;
              case 3: case 7:
                for (let e = 0; e < 6; e++) cmpF(`${aw} spin v[${e}]`, f(a + (e < 3 ? 0x18 + 4 * e : 0x24 + 4 * (e - 3))), v[e]);
                if (!!mem.r8(a + 0x3c) !== !!pa.first) bad(`${aw} first`);
                break;
              case 4: case 8: if (!!mem.r8(a + 0x3c) !== !!pa.first) bad(`${aw} first`); break;
              case 5:
                if (mem.r8(a + 0x18) !== (pa.b18 & 0xff)) bad(`${aw} flyout flag`);
                cmpF(`${aw} flyout time`, f(a + 0x1c), v[3]);
                for (let e = 0; e < 3; e++) cmpF(`${aw} flyout v[${e}]`, f(a + 0x24 + 4 * e), v[e]);
                break;
              case 6:
                if (mem.r8(a + 0x18) !== (pa.b18 & 0xff)) bad(`${aw} flyhome flag`);
                cmpF(`${aw} flyhome speed`, f(a + 0x20), v[0]);
                for (let e = 0; e < 3; e++) cmpF(`${aw} flyhome v[${e}]`, f(a + 0x24 + 4 * e), v[1 + e]);
                break;
              case 9: if ((idOf.get(mem.u32(a + 0x18)) ?? null) !== (pa.other ? pid.get(pa.other) : null)) bad(`${aw} swap partner`); break;
              case 0xc:
                cmpF(`${aw} floatAway limit`, f(a + 0x24), v[0]);
                for (let e = 0; e < 3; e++) { cmpF(`${aw} floatAway v[${e}]`, f(a + 0x28 + 4 * e), v[1 + e]); cmpF(`${aw} floatAway acc[${e}]`, f(a + 0x34 + 4 * e), v[4 + e]); }
                break;
            }
          }
          if (a || k2 !== pb.actions.length) bad(`${bw} action list length native ${k2 + (a ? '+' : '')} port ${pb.actions.length}`);
        });
      });
    }
    for (let r = 0; r < this.recs.length; r++) if (mem.r16(RECORDS_BASE + r * REC + 0x60) !== (this.recs[r].flags & 0xffff)) bad(`record ${r} flags native ${mem.r16(RECORDS_BASE + r * REC + 0x60).toString(16)} port ${(this.recs[r].flags & 0xffff).toString(16)}`);
    if ((mem.r32(CLICKS) | 0) !== this.fx.sim.clicks) bad(`click counter native ${mem.r32(CLICKS) | 0} port ${this.fx.sim.clicks}`);
    if ((mem.r32(DROPS) | 0) !== this.fx.drops) bad(`drop counter native ${mem.r32(DROPS) | 0} port ${this.fx.drops}`);
    // sounds: the native log against the port's, in order
    const ns = this.B.snd.splice(0), ps2 = this.sounds.splice(0);
    const fmt = (s) => ('play' in s ? `play ${s.play.toString(16)} ${s.pos ? s.pos.map((x) => bits(x).toString(16)).join(',') : '-'}` : `stop ${s.stop.toString(16)}`);
    const a1 = ns.map(fmt).join(' | '), b1 = ps2.map(fmt).join(' | ');
    this.stats.sounds += ns.length; this.stats.frames++;
    this.stats.poolMax = Math.max(this.stats.poolMax, this.fx.sim.pool.used); if (this.fx.sim.pool.used >= 2048) this.stats.poolFull++;
    if (a1 !== b1) bad(`sounds native [${a1}] port [${b1}]`);
    return out;
  }
}
