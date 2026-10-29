// BrickFX_Manager.c (ms\FX_Bricks, docs/re/m4/wp9-bricks.md): up to 64 brick effects, each bound to a record and a game variable, with up to 16 brick
// models (stages). When `var % stages` differs from the current stage the effect plays the stage callback of the target stage (bricks fly in / out /
// morph), and when every brick has finished (plus an optional wait) the record is hidden / shown as the stage asks and the effect moves on one stage.
//   FUN_00449ec0 register (FUN_00447d20)          FUN_0044a070 add a model (FUN_00447da0)     FUN_00449fe0 stage callback (FUN_00447d70)
//   FUN_0044a5a0 wait after the morph (00447ed0)  FUN_0044a350 parent matrix (00447e70)       FUN_0044a3b0 one-shot burst (00447e90)
//   FUN_0044a300 state (00447e60)                 FUN_00449b00 finish now (00447ef0)          FUN_0044a180 the per-frame update + draw (00447de0)
// Slot fields keep the original's byte offsets (slot = 0x1730 bytes at DAT_05cb58cc).
import type { BrickLibrary, BrickModelData } from '../../formats/bricks.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import { Brick, ACT, addDelay, addSpin, addUnspin, addFlyOut, addFlyHome, addSwap, addFloatAway, runActions, mulInto } from './sim.ts';
import type { SimEnv, Vec3 } from './sim.ts';

export const MAX_SLOTS = 0x40, MAX_MODELS = 0x10;
/** FUN_00449ec0's "no slot" (0xbabababa) */
export const NO_SLOT = -0x45454546;
/** DAT_008922bc: the wait after a morph runs down 0.03333 per tick */
const WAIT_STEP = Math.fround(0.03333);
/** DAT_00892030 / DAT_008922c0: the stagger of the morph (from / to bricks) */
const STAGGER_FROM = Math.fround(0.01), STAGGER_TO = Math.fround(0.02);
/** DAT_008922c8 / DAT_008922c4: LOD distances squared (FUN_0044d420) */
export const LOD1_D2 = 1280, LOD2_D2 = 7200;
/** sound handle globals the stage callbacks play at the record: id 4 / 5 DAT_05d582ec (stopped first), id 8 DAT_05d58130, id 7 one of DAT_05d582dc / e4 / e8 / e0 in turn (DAT_05d37020) */
export const SOUND_BLOW = 0x05d582ec, SOUND_PARTIAL = 0x05d58130, SOUNDS_DROP = [0x05d582dc, 0x05d582e4, 0x05d582e8, 0x05d582e0];
/** game variable 10 (SWITCH_NS_FX_PARTICLE_ONLYRENDER): the effects are drawn but not advanced */
export const VAR_RENDER_ONLY = 10;
/** FUN_0044a3b0's parameter block (locals of the function; 0xcccccccc where the original leaves the stack fill) */
const STACK_FILL = new Float32Array(new Uint32Array([0xcccccccc]).buffer)[0];
export const BURST_PARAMS = Float32Array.from([
  6.0, 6.4, 0.3, 0.2, 0.5, 0.3, 0.2, 0.5, 0, 0, 0, 0, 0.5, 0, STACK_FILL, 0.05, STACK_FILL, 0, 0, 0, 0, -5.0, 0, STACK_FILL,
]);

/** a brick model of a slot (TBrickModel: FUN_0044d570's block of 0x7c bytes) */
export class BrickModel {
  readonly file: string;
  readonly data: BrickModelData;
  /** the bricks in the original's list order (head first = the file's last brick) */
  readonly bricks: Brick[];
  /** +8: the matrix the bricks are drawn with (the record's, FUN_00447e70 replaces it) */
  parent: Float32Array | null;
  /** +0xc: the matrix of FUN_00447da0 (kept, never used by the draw) */
  readonly matrix = new Float32Array(16);
  constructor(file: string, data: BrickModelData, lib: BrickLibrary, parent: Float32Array | null, matrix: ArrayLike<number> | null) {
    this.file = file; this.data = data; this.parent = parent;
    this.bricks = data.bricks.map((b) => new Brick(b, lib.types[b.type] ?? null)).reverse();
    if (matrix) this.matrix.set(matrix); else { this.matrix[0] = this.matrix[5] = this.matrix[10] = this.matrix[15] = 1; }
  }
  /** +0x64 */ get count() { return this.bricks.length; }
  /** +0x68 */ get layers() { return this.data.layers; }
  /** the list from its tail (+4, +0x4c): the file order */
  tail(): Brick[] { return this.bricks.slice().reverse(); }
}

export class BrickFxSlot {
  readonly index: number;
  /** +0x1704 / +0x170c */
  readonly record: GameRecord;
  readonly v: number;
  /** +0x1711: FUN_00449ec0's third argument (0 from FUN_00447d20) */
  readonly flag: number;
  readonly models: BrickModel[] = [];
  /** +0x00 + 4 s: the record's visibility after a morph into stage s (0 hide, 1 show, 2 leave it and keep drawing the bricks) */
  readonly vis: number[] = new Array(MAX_MODELS).fill(0);
  /** +0x1712 + s: the callback's function id; +0x40 + 4 s: the callback (FUN_00449f50); +0x80 + 0x60 s: its 24 parameters */
  readonly fn: (number | null)[] = new Array(MAX_MODELS).fill(null);
  readonly params: Float32Array[] = Array.from({ length: MAX_MODELS }, () => new Float32Array(24));
  /** the same parameter blocks as 32-bit integers (callback 8 reads its brick range as ints) */
  readonly iparams: Int32Array[] = this.params.map((f) => new Int32Array(f.buffer));
  /** +0x1700: the sound handle of the running morph (0xbabababa none) */
  sound = NO_SLOT;
  /** +0x1708: 0 set up, 1 running, 2 done, 3 waiting */
  state = 0;
  /** +0x1722 morph running, +0x1724 one-shot (no stage step), +0x1725 a swap happened, +0x1726 callback played */
  running = false; oneShot = false; swapped = false; started = false;
  /** +0x1727 the current stage, +0x1728 time of the morph, +0x172c the wait after it (seconds, FUN_00447ed0; used up once) */
  stage = 0; time = 0; wait = 0;
  /** the bricks drawn this tick (FUN_0044c2c0 ran) */
  drawn = false;
  constructor(index: number, record: GameRecord, v: number, flag: number) { this.index = index; this.record = record; this.v = v; this.flag = flag; }
}

export interface BrickFxEnv {
  /** game variables */
  vars: { get(i: number): number; set(i: number, v: number): void };
  /** FUN_004433f0 (play 3D) / FUN_004434b0 (stop) by handle global */
  sound(handle: number, pos: Vec3 | null, stop?: boolean): void;
  /** FUN_004388ae */
  rand(max: number): number;
  /** the camera eye for the LOD choice (DAT_009da5e8) */
  eye(): Vec3;
}

export class BrickFxManager {
  readonly lib: BrickLibrary;
  readonly env: BrickFxEnv;
  readonly slots: (BrickFxSlot | null)[] = new Array(MAX_SLOTS).fill(null);
  /** DAT_05d37020: the drop-sound counter of callback 7 */
  drops = 0;
  private sim: SimEnv;
  /** the emulated set-up's slot handles -> this manager's slots (src/fx/bricks/island.ts) */
  readonly setupSlots = new Map<number, number>();
  /** a log of what happened (tests): `start slot stage fn`, `done slot stage vis`, `sound handle` */
  readonly log: string[] = [];

  constructor(lib: BrickLibrary, env: BrickFxEnv) {
    this.lib = lib; this.env = env;
    const self = this;
    this.sim = { rand: (m) => env.rand(m), sound: (h, p) => { self.log.push(`sound ${h.toString(16)}`); env.sound(h, p); }, dt: 1, clicks: 0 };
  }

  // ---------------------------------------------------------------------------------------- set-up

  /** FUN_00449ec0 (FUN_00447d20(rec, var)): a free slot, or NO_SLOT */
  register(rec: GameRecord, v: number, flag = 0): number {
    for (let i = 0; i < MAX_SLOTS; i++) if (!this.slots[i]) { this.slots[i] = new BrickFxSlot(i, rec, v, flag); return i; }
    return NO_SLOT;
  }
  slot(i: number): BrickFxSlot | null { return i >= 0 && i < MAX_SLOTS ? this.slots[i] : null; }
  /** FUN_0044a070 (FUN_00447da0(slot, file, matrix)): the next stage's brick model (`BrickMorph/<file>`), bound to the record's matrix */
  addModel(i: number, file: string, matrix: ArrayLike<number> | null = null): BrickModel | null {
    const s = this.slot(i);
    if (!s || s.models.length >= MAX_MODELS) return null;
    const data = this.lib.model(file) ?? { name: '', centreMode: -1, centre: [0, 0, 0], bricks: [], layers: 0, invExtent: [0, 0, 0], invExtentSq: 0 } as BrickModelData;
    const m = new BrickModel(file, data, this.lib, s.record.m, matrix);
    for (const b of m.bricks) b.visible = false;   // FUN_0044dba0
    s.models.push(m);
    return m;
  }
  /** FUN_00449fe0 (FUN_00447d70(slot, stage, fn, params, vis)) with float parameters; returns var / stages */
  setStage(i: number, stage: number, fn: number, params: ArrayLike<number>, vis: number): number {
    const w = new Uint32Array(new Float32Array(Array.from({ length: 24 }, (_, k) => params[k] ?? 0)).buffer);
    return this.setStageWords(i, stage, fn, w, vis);
  }
  /** FUN_00449fe0 with the 24 raw 32-bit words of the original's block (the emulated set-up copies them: floats and ints mixed) */
  setStageWords(i: number, stage: number, fn: number, words: ArrayLike<number>, vis: number): number {
    const s = this.slot(i);
    if (!s || stage < 0 || stage >= MAX_MODELS) return 0;
    s.state = 0;
    const iv = s.iparams[stage];
    iv.fill(0); for (let k = 0; k < 24 && k < words.length; k++) iv[k] = words[k] | 0;
    s.vis[stage] = vis; s.fn[stage] = fn;
    const v = this.env.vars.get(s.v), n = s.models.length || 1;
    s.stage = ((v % n) + n) % n;
    return Math.trunc(v / n);
  }
  /** FUN_0044a5a0 (FUN_00447ed0): the wait after the morph, seconds */
  setWait(i: number, seconds: number) { const s = this.slot(i); if (s) s.wait = seconds; }
  /** FUN_0044a350 (FUN_00447e70): draw every model of the slot with `m` instead of the record's matrix */
  setParent(i: number, m: Float32Array | null) { const s = this.slot(i); if (s && m) for (const x of s.models) x.parent = m; }

  /** FUN_0044a300 (FUN_00447e60): 2 = idle (no morph running and the record has no 0x8000 flag), else the slot's state */
  state(i: number): number {
    const s = this.slot(i);
    if (!s) return 2;
    if (!s.running && (s.record.flags & 0x8000) === 0) return 2;
    return s.state;
  }

  /** FUN_0044a3b0 (FUN_00447e90(rec, kind)): a one-shot effect on the current stage of every idle slot of `rec` (kind 6 just shows the bricks) */
  burst(rec: GameRecord, kind: number) {
    for (const s of this.slots) {
      if (!s || s.record !== rec || s.running) continue;
      s.started = false;
      const fn = kind === 6 ? 6 : kind === 0xb ? 0xb : kind === 0xc ? 0xc : kind === 0xd ? 0xd : 10;
      this.call(s, fn, BURST_PARAMS, s.stage, new Int32Array(BURST_PARAMS.buffer));
      s.oneShot = true;
    }
  }

  /** FUN_00449b00 (FUN_00447ef0(slot)): run the slot's morph to its end within this frame (dt 1) */
  finish(i: number) {
    const s = this.slot(i);
    if (!s || s.state === 2) return;
    const dt = this.sim.dt;
    this.sim.dt = 1;
    for (let guard = 0; guard < 100000; guard++) {
      this.step(s);
      if (!s.models.length) break;
      let any = false;
      for (const m of s.models) {
        // the original tests the HEAD brick's list for every brick (a slip in the loop); bricks are rebuilt on the way
        const head = m.bricks[0];
        for (const b of m.bricks) { if (head && head.actions.length) any = true; b.rebuild(); }
      }
      if (!any || s.state === 2) break;
    }
    this.sim.dt = dt;
  }

  // ---------------------------------------------------------------------------------------- stage callbacks (FUN_00449f50)

  private call(s: BrickFxSlot, fn: number, P: Float32Array, t: number, I: Int32Array) {
    this.log.push(`start ${s.index} ${t} ${fn}`);
    const n = s.models.length;
    const M = s.models[t];
    if (!M) return;
    const N = s.models[(t + 1) % n];
    switch (fn) {
      case 0: this.cbAppear(M, P); break;
      case 1: this.cbVanish(M, P); break;
      case 2: this.cbSwap(M, N, P); break;
      case 4: this.cbBlow(s, M, P, false); break;
      case 5: this.cbBlow(s, M, P, true); break;
      case 7: this.cbDrop(s, M, P); break;
      case 8: this.cbDropRange(s, M, P, I); break;
      case 10: case 11: case 12: case 13: if (N) this.cbMorph(M, N, P, fn); break;
      default: for (const b of M.tail()) { b.visible = true; b.active = true; }   // FUN_0044cd30 (3, 6, 9 and the rest)
    }
  }
  private stepOf(M: BrickModel, P: Float32Array, div: number) { return P[0] > 0 ? Math.fround(P[0] / div) : P[1]; }
  /** FUN_0044c4c0 (0): the bricks appear one after another (file order) */
  private cbAppear(M: BrickModel, P: Float32Array) {
    const step = this.stepOf(M, P, M.count);
    let d = 0;
    for (const b of M.tail()) { b.visible = false; b.active = true; addDelay(b, d, 1, 1); d = Math.fround(step + d); }
  }
  /** FUN_0044c550 (1): they disappear one after another (list order) */
  private cbVanish(M: BrickModel, P: Float32Array) {
    const step = this.stepOf(M, P, M.count);
    let d = 0;
    for (const b of M.bricks) { b.visible = true; b.active = true; addDelay(b, d, 0, 1); d = Math.fround(step + d); }
  }
  /** LAB_0044c5e0 (2): this stage's bricks disappear, then the next stage's appear */
  private cbSwap(M: BrickModel, N: BrickModel | undefined, P: Float32Array) {
    const step = this.stepOf(M, P, M.count);
    let d = 0;
    for (const b of M.bricks) { b.visible = true; b.active = true; addDelay(b, d, 0, 1); d = Math.fround(step + d); }
    if (N) for (const b of N.tail()) { b.visible = false; b.active = true; addDelay(b, d, 1, 1); d = Math.fround(step + d); }
  }
  /** LAB_0044cbe0 (4) / LAB_0044cd60 (5): layer by layer from the top the bricks spin and float away (sound DAT_05d582ec at the record) */
  private cbBlow(s: BrickFxSlot, M: BrickModel, P: Float32Array, spinB: boolean) {
    const step = this.stepOf(M, P, M.layers);
    for (const b of M.bricks) {
      b.active = true; b.visible = true;
      const r = this.env.rand(step);
      b.offset[0] = 0; b.offset[1] = 0; b.offset[2] = 0;
      for (let k = 0; k < 3; k++) { b.rotA[k] = 0; b.rateA[k] = 0; b.rotB[k] = 0; }
      const delay = Math.fround(Math.fround((M.layers - b.layer) * step) + r);
      addSpin(b, delay, P.subarray(2), this.sim, ACT.SPIN_A);
      if (spinB) { addSpin(b, delay, P.subarray(11), this.sim, ACT.SPIN_B); addFloatAway(b, delay, P.subarray(20), 40000); }
      else addFloatAway(b, delay, P.subarray(11), P[14]);
    }
    s.sound = SOUND_BLOW;
    this.env.sound(SOUND_BLOW, null, true);
    this.env.sound(SOUND_BLOW, recPos(s.record));
    this.log.push(`sound ${SOUND_BLOW.toString(16)}`);
  }
  /** LAB_0044ced0 (7): every brick starts p[4] higher and falls home in file order, p[0] seconds for all, at p[2] + rand(p[3]) per tick */
  private cbDrop(s: BrickFxSlot, M: BrickModel, P: Float32Array) {
    for (const b of M.bricks) { b.active = true; b.visible = true; b.dirty = true; b.offset[1] = Math.fround(P[4] + b.offset[1]); b.rebuild(); }
    const step = this.stepOf(M, P, M.count);
    let d = step;
    for (const b of M.tail()) { addFlyHome(b, d, Math.fround(this.env.rand(P[3]) + P[2])); d = Math.fround(step + d); }
    this.drops++;
    const h = SOUNDS_DROP[this.drops & 3];
    s.sound = h;
    this.env.sound(h, recPos(s.record));
    this.log.push(`sound ${h.toString(16)}`);
  }
  /** LAB_0044d010 (8): bricks p[5] .. p[6] (file order; p[6] < 0 = to the end, written back) fall in from p[4] + 0.1 above; earlier ones stand, later ones are hidden */
  private cbDropRange(s: BrickFxSlot, M: BrickModel, P: Float32Array, I: Int32Array) {
    const lift = Math.fround(P[4] + Math.fround(0.1));   // DAT_008920cc
    if (I[6] < 0) I[6] = M.count;
    const first = I[5], last = I[6];
    const step = P[0] > 0 ? Math.fround(P[0] / (last - first)) : P[1];
    let d = step, i = 0;
    for (const b of M.tail()) {
      b.active = true;
      if (i < first) { b.visible = true; b.offset[0] = 0; b.offset[1] = 0; b.offset[2] = 0; }
      else if (i < last) {
        b.visible = true;
        addFlyHome(b, d, Math.fround(this.env.rand(P[3]) + P[2]));
        d = Math.fround(d + step);
        b.offset[0] = 0; b.offset[2] = 0; b.offset[1] = lift;
        b.dirty = true;
        b.rebuild();
      } else b.visible = false;
      i++;
    }
    s.sound = SOUND_PARTIAL;
    this.env.sound(SOUND_PARTIAL, recPos(s.record));
    this.log.push(`sound ${SOUND_PARTIAL.toString(16)}`);
  }
  /** FUN_0044c6c0 (10), FUN_0044c820 (11), FUN_0044c980 (12), FUN_0044cad0 (13): this stage's bricks fly apart, the next stage's take over their places and fly home */
  private cbMorph(M: BrickModel, N: BrickModel, P: Float32Array, fn: number) {
    pairBricks(M, N);
    let d = 0;
    for (const b of M.bricks) {
      b.visible = true; b.active = true;
      const dd = fn === 13 ? 0 : d;
      if (fn === 11) addSpin(b, dd, P.subarray(11), this.sim, ACT.SPIN_B); else addSpin(b, dd, P.subarray(2), this.sim, ACT.SPIN_A);
      addFlyOut(b, dd, P);
      if ((fn === 10 || fn === 11) && !b.partner) addDelay(b, dd, 0, 1);
      if (fn !== 13) d = Math.fround(d + STAGGER_FROM);
    }
    d = 0;
    for (const b of N.tail()) {
      b.visible = false; b.active = false;
      addUnspin(b, 0, fn === 11 ? ACT.UNSPIN_B : ACT.UNSPIN_A);
      const dd = fn === 13 ? 0 : d;
      addSwap(b, dd, b.partner);
      addFlyHome(b, dd, P[0]);
      if (fn !== 13) d = Math.fround(d + STAGGER_TO);
    }
  }

  // ---------------------------------------------------------------------------------------- per frame

  /** FUN_0044c300: run every brick's actions; 3 while bricks are busy or the wait runs, 2 when done */
  private step(s: BrickFxSlot): number {
    s.state = 3;
    const pause = (s.record.flags & 0x2000) !== 0;
    const sw = { v: s.swapped };
    for (const m of s.models) for (const b of m.bricks) {
      if (!b.actions.length) continue;
      const r = runActions(b, this.sim, pause, sw);
      s.swapped = sw.v;
      if (s.swapped) s.record.flags |= 0x4000;
      if (s.state < r) continue;
      s.state = r;
    }
    if (s.state === 2 && s.wait > 0) { s.wait = Math.fround(s.wait - Math.fround(this.sim.dt * WAIT_STEP)); return 3; }
    return s.state;
  }

  /** FUN_0044a180 (+ FUN_0044c2c0 / FUN_0044dae0: the draw pass rebuilds and places the visible bricks). Call once per tick. */
  update(dt = 1) {
    this.sim.dt = dt;
    const renderOnly = this.env.vars.get(VAR_RENDER_ONLY);
    for (const s of this.slots) {
      if (!s) continue;
      s.drawn = false;
      const n = s.models.length;
      if (!n) continue;
      const v = this.env.vars.get(s.v);
      const t = ((v % n) + n) % n;
      if (s.stage === t && !s.oneShot) {
        if (s.vis[s.stage] === 2) this.draw(s);
        continue;
      }
      if (!s.started) {
        const fn = s.fn[t];
        if (fn !== null) this.call(s, fn, s.params[t], t, s.iparams[t]);
        s.time = 0; s.started = true; s.running = true;
      }
      if (renderOnly === 0) {
        const st = this.step(s);
        s.time = Math.fround(dt + s.time);
        s.state = st;
        if (st === 2) {
          const vis = s.vis[t], r = s.record;
          if (vis === 0) r.flags &= ~RF_ENABLED;
          else if (vis === 1) r.flags |= RF_ENABLED;
          r.flags &= ~(0x4000 | 0x8000);
          this.log.push(`done ${s.index} ${t} ${vis}`);
          s.state = 0;
          if (!s.oneShot) s.stage = (s.stage + 1) % n; else s.oneShot = false;
          // FUN_0044c3f0: free the action lists of the (new) current stage and the one after it
          for (const b of s.models[s.stage].bricks) b.actions = [];
          for (const b of s.models[(s.stage + 1) % n].bricks) b.actions = [];
          s.started = false; s.running = false; s.swapped = false;
          if (s.sound !== NO_SLOT) { this.env.sound(s.sound, null, true); s.sound = NO_SLOT; }
        }
      }
      this.draw(s);
    }
  }

  /** FUN_0044c2c0 -> FUN_0044dae0: rebuild the visible bricks, world matrix = local . parent, LOD by the squared distance to the eye (FUN_0044d420) */
  private draw(s: BrickFxSlot) {
    s.drawn = true;
    const eye = this.env.eye();
    for (const m of s.models) {
      if (!m.parent) continue;
      for (const b of m.bricks) {
        if (!b.visible) continue;
        b.rebuild();
        mulInto(b.world, b.local, m.parent);
        const dx = eye[0] - b.world[12], dy = eye[1] - b.world[13], dz = eye[2] - b.world[14];
        const d2 = dx * dx + dy * dy + dz * dz;
        b.lod = d2 < LOD1_D2 ? 0 : d2 < LOD2_D2 ? 1 : 2;
      }
    }
  }

  /** the bricks to draw this frame (the slots whose draw pass ran this tick) */
  *drawList(): Generator<Brick> {
    for (const s of this.slots) {
      if (!s || !s.drawn) continue;
      for (const m of s.models) { if (!m.parent) continue; for (const b of m.bricks) if (b.visible) yield b; }
    }
  }
}

const recPos = (r: GameRecord): Vec3 => [r.m[12], r.m[13], r.m[14]];

/** FUN_0044e410 + FUN_0044e5a0 + FUN_0044e660 + FUN_0044e6e0: which brick of `from` each brick of `to` morphs out of (and back) */
export function pairBricks(from: BrickModel, to: BrickModel) {
  const nd = (a: Brick, b: Brick) => { const x = a.norm[0] - b.norm[0], y = a.norm[1] - b.norm[1], z = a.norm[2] - b.norm[2]; return x * x + y * y + z * z; };
  // PART groups (and the unnamed ones, 255): the nearest brick of the same group
  for (const t of to.bricks) {
    t.dist = 65536; t.partner = null;
    if (t.group > 9) for (const f of from.bricks) {
      if (f.group !== t.group) continue;
      const d = Math.sqrt(nd(f, t));
      if (d <= t.dist) { t.dist = d; t.partner = f; }
    }
  }
  // AUTO groups: the same brick at the same place (within 0.005) and turned the same way
  for (const t of to.bricks) {
    if (t.group >= 10) continue;
    t.dist = Math.fround(0.005);
    for (const f of from.bricks) {
      if (f.group !== t.group || f.rotC[1] !== t.rotC[1] || f.typeIndex !== t.typeIndex) continue;
      const d = Math.sqrt(nd(f, t));
      if (d <= 0.005 && d <= t.dist) { t.dist = d; t.partner = f; }
    }
  }
  // the rest of the AUTO groups: the nearest of the group within the ratio of the models' extents
  const ratio = Math.fround(to.data.invExtentSq / from.data.invExtentSq);
  for (const t of to.bricks) {
    if (t.partner || t.group >= 10) continue;
    t.dist = ratio;
    for (const f of from.bricks) { if (f.group !== t.group) continue; const d = nd(f, t); if (d < t.dist) { t.dist = d; t.partner = f; } }
  }
  // still alone: the nearest brick of any group within what is left of the distance
  for (const t of to.bricks) {
    if (t.partner) continue;
    for (const f of from.bricks) { const d = nd(f, t); if (d < t.dist) { t.dist = d; t.partner = f; } }
  }
  // and back: each `from` brick points at the last `to` brick that chose it
  for (const f of from.bricks) {
    let p: Brick | null = null;
    for (const t of to.bricks) if (t.partner === f) p = t;
    f.partner = p;
  }
}
