// The island's small animals (Common\Zone\...\Bunny.c family, docs/re/m4/wp7-ambient.md "Animals"):
//   Bunny     ctor FUN_004b2149, table 0x8d91f0 {update FUN_004b18fb, prerender FUN_004b1ffb, destroy FUN_004b23ac, draw FUN_004b20af}  (RBT0-4)
//   Butterfly ctor FUN_004b2d44, table 0x8d9230 {update FUN_004b24f8, prerender FUN_004b2539, destroy FUN_004b2f25, draw FUN_004b2b75}  (BFS0-9, BFG0-9)
//   Swift leader ctor FUN_004b31db, table 0x8d9250 {update FUN_004b2f64, prerender/draw return 1: the leader record is not drawn by it}  (SFT9, pos 0)
//   Swift     ctor FUN_004b3a92, table 0x8d9268 {update FUN_004b35f9, prerender FUN_004b39de, draw FUN_004b39f8}  (SFT0-9; SFT9 carries both)
// Node fields keep the byte offset of the original's node block in their comments. The constructors read the record when they are attached; the port
// does that on the first update (`init`), which sees the same record state.
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { parseMan } from '../../formats/anim.ts';
import type { Pe } from '../../formats/exe.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { PI, TWO_PI, wrapPi, ftol, rand, inView, sfxAt, soundOf, recPos, ensureAnim, rebuild, setRot, setScaled } from './common.ts';
import { ad, sb, ml, fr, sq, fromBits } from '../../zones/common/f32.ts';
import { probeSet, nextSeq } from '../npc/globals.ts';
import { TrackSpline } from '../../zones/z20dsp/spline.ts';
import { BlockIn, BlockOut, CD, CD16, CD32, CDF, keepRaw, recordTag } from '../blockio.ts';
import { EMU_RECORDS_BASE, EMU_RECORD_STRIDE } from '../args.ts';

export const CTOR_BUNNY = 0x4b2149, CTOR_BUTTERFLY = 0x4b2d44, CTOR_SWIFT_LEADER = 0x4b31db, CTOR_SWIFT = 0x4b3a92;

/** record 16 = PEPP (`DAT_00983804 + 0x6bc` / `+0x680`) */
const PEPP = 16;

/** the globals of the family (per world) */
export class AnimalGlobals {
  /** DAT_05d582f8: bunnies startled this frame (Shift near them); five at once give the extra score once (prerender FUN_004b1ffb) */
  pokes = 0;
  /** DAT_008d9208: the three burrows {x, y, z}; y is -1 in the executable until the first bunny puts them on the terrain */
  burrows: [number, number, number][] | null = null;
  /** _DAT_008d9248 / _DAT_05d582fc: the butterfly nearest to Pepper this frame (reset by the draw hook; nothing reads it) */
  nearestD = 1e38; nearest: GameRecord | null = null;
}
const GKEY = 'ambient.animals';
export function animalGlobals(w: World): AnimalGlobals {
  let g = w.ext.get(GKEY) as AnimalGlobals | undefined;
  if (!g) { g = new AnimalGlobals(); w.ext.set(GKEY, g); }
  return g;
}

const peF32 = (pe: Pe, va: number) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, pe.u32(va), true); return b.getFloat32(0, true); };

/** 0x7e967699 (1e38): "outside the box" of FUN_004b1330 / FUN_004b23dc */
const FAR = fr(1e38);
const TENTH = fromBits(0x3dcccccd), F02 = fromBits(0x3e4ccccd), QUARTER = 0.25, BORED_CHANCE = fromBits(0x3f6e147b);

abstract class Node implements BehaviourNode {
  abstract readonly kind: string;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord, ctrl: Controller): number;
}

// ================================================================================================ Bunny

/** DAT_008d9208: burrow table (3 x {x, y, z}) */
export const BURROWS_VA = 0x8d9208;
const BUNNY_SOUND = 0x05d58138;   // handle of sound 0x103 (FUN_004b037e)

export class BunnyNode extends Node {
  readonly kind = 'Bunny';
  /** attach order: the constructors' world work (heading draw, ground probe) runs in it before the first tick (`startIslandNpcs`) */ readonly seq = nextSeq();
  readonly args: ArgView;
  private inited = false;
  home: [number, number, number] = [0, 0, 0];   // +0x14
  range = 0;           // +0x20 = arg0 * 8
  range2 = 0;          // +0x24
  quarter2 = 0;        // +0x28 = (range / 2)^2
  reach = 1;           // +0x2c
  speed = 0;           // +0x30 = arg1 * 8
  state = 2;           // +0x34 (0 sit, 1 sit 2, 2 hop, 3 to the burrow, 4 into it, 5 out of the next one, 6 startled)
  saved = CD32;        // +0x38 (never written by the constructor: 0xCD)
  count = 0;           // +0x3c
  off = 0;             // +0x40 ticks out of view
  burrow = CD32;       // +0x44 (0xCD until the first state 3)
  bored = 0;           // +0x48
  private raw: Uint8Array | null = null;
  /**
   * Save block = node +0x34 .. +0x50 (saver FUN_004b20eb returns 0x1c and points at node + 0x34, loader FUN_004b2110 = 28 byte memcpy back): i32 state (+0x34), saved (+0x38), count (+0x3c), off (+0x40),
   * burrow (+0x44), bored (+0x48), and the node's last word (+0x4c, never written: 0). The home position, range, speed and reach (+0x14 .. +0x30) come from the constructor and are not saved.
   */
  saveBlock(): Uint8Array {
    const o = new BlockOut(0x1c, CD).i32(0, this.state).i32(4, this.saved).i32(8, this.count).i32(0xc, this.off).i32(0x10, this.burrow).i32(0x14, this.bored);
    keepRaw(o, this.raw, [[0x18, 4]]);   // node +0x4c is never written (0xCD)
    return o.bytes;
  }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.raw = data.slice();
    this.state = b.i32(0); this.saved = b.i32(4); this.count = b.i32(8); this.off = b.i32(0xc); this.burrow = b.i32(0x10); this.bored = b.i32(0x14);
  }
  constructor(args: ArgView) {
    super();
    this.args = args;
    // FUN_004b2149 (float32 per operation): speed = a1 * 8, range = a0 * 8, range^2, (a0 * 8 * 0.5)^2
    const a0 = args.f32(0), a1 = args.f32(4);
    this.speed = ml(a1, 8);
    this.range = ml(a0, 8); this.range2 = ml(this.range, this.range);
    const q = ml(ml(a0, 8), 0.5); this.quarter2 = ml(q, q);
  }

  /** the constructor FUN_004b2149 (run on the first update) */
  init(w: World, rec: GameRecord) {
    if (this.inited) return;
    this.inited = true;
    this.home = [rec.x, rec.y, rec.z];
    ensureAnim(w, rec)?.start(2, 0);
    rec.ry = sb(PI, rand(TWO_PI));
    const g = animalGlobals(w);
    if (!g.burrows) {
      const c = tryCtx(w);
      g.burrows = [0, 1, 2].map((i) => c ? [peF32(c.pe, BURROWS_VA + i * 12), peF32(c.pe, BURROWS_VA + i * 12 + 4), peF32(c.pe, BURROWS_VA + i * 12 + 8)] as [number, number, number] : [0, -1, 0]);
      // `if (_DAT_008d920c < 0)`: y = 0, then FUN_0043cd62(burrow, 40.0): the terrain below each burrow
      if (g.burrows[0][1] < 0) for (const b of g.burrows) { b[1] = 0; b[1] = w.col.terrainHeight(b[0], 0, b[2], 40); }
    }
    // FUN_00441ac0(rec, pos + (0, 8, 0), (0, -24, 0), mask 3): put the bunny on what lies below it (the probe skips the ground record)
    const hit = w.col.probe(rec, [rec.x, ad(rec.y, 8), rec.z], [0, -24, 0], 3);
    if (hit) rec.y = hit.point[1];
    // (the constructor does not rebuild the matrix: the placed heading moves the bunny until the first turn)
  }

  /** FUN_004b1330: the vector to the home and its squared length (FAR when the signed x / z difference exceeds the range) */
  private homeDelta(rec: GameRecord, d: number[]): number {
    d[0] = sb(this.home[0], rec.x); d[1] = sb(this.home[1], rec.y); d[2] = sb(this.home[2], rec.z);
    if (d[0] <= this.range && d[2] <= this.range) return ad(ad(ml(d[0], d[0]), ml(d[1], d[1])), ml(d[2], d[2]));
    return FAR;
  }

  /** FUN_004b13f4: wander inside the half range, else turn to the home by at most 0.25 */
  private steer(rec: GameRecord) {
    const d = [0, 0, 0];
    const d2 = this.homeDelta(rec, d);
    if (d2 <= this.quarter2) rec.ry = ad(sb(TENTH, rand(F02)), rec.ry);
    else {
      const yaw = fr(Math.atan2(d[0], d[2]));
      let t = sb(yaw, rec.ry);
      t = wrapPi(t);
      if (fr(Math.abs(t)) >= QUARTER) rec.ry = t >= 0 ? ad(QUARTER, rec.ry) : sb(rec.ry, QUARTER); else rec.ry = yaw;
      rec.ry = wrapPi(rec.ry);
    }
    rebuild(rec);
  }

  /** FUN_004b17eb: the next state when the count runs out; -1 when the (capped) draw equals the current state (nothing is entered, the count stays at -1: the next loop of the clip chooses again: finding D10) */
  private choose(): number {
    if (this.state === 6) { this.state = this.saved; return this.state; }
    if (this.bored < 10) this.bored++;
    else if (rand(1) > BORED_CHANCE) {
      this.bored = 0; this.state = 3;
      this.burrow = Math.min(2, ftol(rand(3)));
      return 3;
    }
    let s: number;
    do s = ftol(rand(4)); while (s === this.state);
    if (s > 2) s = 2;
    if (this.state === s) return -1;
    this.state = s;
    return s;
  }

  /** FUN_004b1712 + FUN_004b1647: enter a state (count, facing, clip); -1 matches no case of either switch */
  private enter(w: World, rec: GameRecord, s: number) {
    const g = animalGlobals(w);
    switch (s) {
      case 0: this.count = ftol(rand(2)); break;
      case 1: this.count = 0; break;
      case 2: this.count = ftol(rand(5)); this.steer(rec); break;
      case 3: {
        this.count = 100;
        const b = g.burrows![this.burrow];
        // FUN_004b15b7 -> FUN_00433450(rec, burrow, out): the yaw difference to the burrow, wrapped once
        const a = fr(Math.atan2(sb(b[0], rec.x), sb(b[2], rec.z)));
        rec.ry = sb(rec.ry, wrapPi(sb(rec.ry, a)));
        rebuild(rec);
        break;
      }
      case 6: this.count = 0; break;
      default: return;
    }
    const clip = s === 0 ? 1 : s === 1 ? 3 : s === 6 ? 4 : 2;
    rec.anim?.start(clip, 0);
  }

  update(w: World, rec: GameRecord, c: Controller): number {
    if (!this.inited) this.init(w, rec);
    const g = animalGlobals(w);
    const B = g.burrows!;
    if (c.distSq < 256) this.off = 0;
    if (this.off < 101) {
      if (this.state < 4 && (w.input.pressed & 0x40) !== 0 && c.distSq < 64) {
        this.saved = this.state;
        g.pokes++;
        this.state = 6;
        const p = w.records[PEPP] ?? rec;
        sfxAt(w, soundOf(w, BUNNY_SOUND), recPos(p));
        this.enter(w, rec, 6);
      }
      let r = 0;
      const anim = rec.anim;
      if (anim) r = anim.advance(this.state <= 1 || this.state === 6 ? 1 : 2, w.dt);
      if (r !== 0) {
        this.count--;
        if (this.count < 0) this.enter(w, rec, this.choose());
        else if (this.state === 2) this.steer(rec);
      }
      let v = -1;
      let px = rec.x, py = rec.y, pz = rec.z;          // local_44 / local_40 / local_3c: the position the step starts from (the cases that rebuild the matrix keep it)
      switch (this.state) {
        case 2: {
          const d = [0, 0, 0];
          const d2 = this.homeDelta(rec, d);
          if (this.range2 < d2) {
            const yaw = fr(Math.atan2(d[0], d[2]));
            if (TENTH < fr(Math.abs(sb(rec.ry, yaw)))) { rec.ry = yaw; rebuild(rec); }
          }
          v = this.speed;
          break;
        }
        case 3: {
          const b = B[this.burrow];
          px = rec.x; py = rec.y; pz = rec.z;
          if (fr(Math.abs(sb(b[0], px))) < this.reach && fr(Math.abs(sb(b[2], pz))) < this.reach) { this.state = 4; rec.rx = 0.75; rebuild(rec); }
          v = ml(this.speed, 1.5);
          break;
        }
        case 4: {
          const b = B[this.burrow];
          const dy = sb(b[1], rec.y);
          if (2 < dy) {
            this.state = 5;
            rec.ry = wrapPi(ad(rec.ry, PI));
            rec.rx = -0.75;
            let nb: number;
            do { nb = ftol(rand(3)); if (nb > 2) nb = 2; } while (nb === this.burrow);
            const ox = sb(rec.x, b[0]), oy = sb(rec.y, b[1]), oz = sb(rec.z, b[2]);
            this.burrow = nb;
            const n = B[nb];
            px = ad(ox, n[0]); py = ad(oy, n[1]); pz = ad(oz, n[2]);
            rec.setEuler(rec.rx, rec.ry, rec.rz, px, py, pz);
          } else { px = rec.x; py = rec.y; pz = rec.z; }
          v = ml(this.speed, 1.5);
          break;
        }
        case 5: {
          const b = B[this.burrow];
          if (sb(b[1], rec.y) < 0) {
            this.state = 2;
            this.count = ftol(rand(2)) + 2;
            rec.rx = 0;
            rebuild(rec);
          }
          px = rec.x; py = rec.y; pz = rec.z;
          v = this.speed;
          break;
        }
      }
      if (v > 0) {
        // local_44 = pos + speed * dt * forward (the position read BEFORE the case's own matrix rebuild, case 4: the moved burrow position)
        const k = ml(this.speed, fr(w.dt));
        rec.x = ad(px, ml(k, rec.m[8])); rec.y = ad(py, ml(k, rec.m[9])); rec.z = ad(pz, ml(k, rec.m[10]));
      }
    }
    // FUN_00427014(ctrl, (0, 8, 0), (0, -16, 0), 3, 0x50): the probe pass keeps a hopping bunny on the ground
    if (this.state === 2 || this.state === 3) probeSet(c, [0, 8, 0], [0, -16, 0], 3, 0x50);
    return 1;
  }

  /** FUN_004b1ffb */
  prerender(w: World, rec: GameRecord) {
    const g = animalGlobals(w);
    if (g.pokes === 5 && (w.vars.get(0xbd) & 1) === 0) {      // SWITCH_GME_LGI_EXTRA_SCOREITEMS bit 1, SCORE_LGI / HISCORE_LGI + 1000
      w.vars.or(0xbd, 1); w.vars.add(0xa6, 1000); w.vars.add(0x12, 1000);
    }
    g.pokes = 0;
    if (inView(w, rec)) this.off = 0;
    else if (this.off <= 100) this.off++;
  }
}

// ================================================================================================ Butterfly

/** BFG butterflies share BFG0's place as their home (`memcmp(rec, "BFG", 3)`: `DAT_00983804 + 0x3a54` = record 143) */
const BFG_HOME = 143;

const F01 = fromBits(0x3dcccccd), F0005 = fromBits(0x3ba3d70a), F08 = fromBits(0x3f4ccccd), FLAP_RATE = fromBits(0x3f2aacda), F004 = fromBits(0x3d23d70a), F002 = fromBits(0x3ca3d70a), F008 = fromBits(0x3da3d70a), NEAR2 = fromBits(0x4023d70a);

export class ButterflyNode extends Node {
  readonly kind = 'Butterfly';
  private inited = false;
  readonly arg0: number;
  home: [number, number, number] = [0, 0, 0];   // +0x14
  start: [number, number, number] = [0, 0, 0];  // +0x20
  range = 0; range2 = 0;   // +0x2c / +0x30
  flap = 1;                // +0x34: the wing scale (1 .. -1)
  flapState = 0;           // +0x38
  cnt = 0;                 // +0x3c
  cnt2 = 0;                // +0x40
  vy = F004;               // +0x44 (0x3d23d70a)
  off = 0;                 // +0x48
  follow: GameRecord | null = null;   // +0x4c
  speed = F008;            // +0x50 (0x3da3d70a)
  shiftT = 0;              // +0x54
  constructor(args: ArgView) {
    super();
    this.arg0 = args.f32(0);
    this.range = ml(this.arg0, 8); this.range2 = ml(this.range, this.range);
  }
  /** the constructor FUN_004b2d44's reads of the record (start +0x20, home +0x14; the record flag): right after the set-up (`ctorInit`) */
  ctorInit(w: World, rec: GameRecord): void { this.init(w, rec); }
  private init(w: World, rec: GameRecord) {
    if (this.inited) return;
    this.inited = true;
    this.start = [rec.x, rec.y, rec.z];
    const h = rec.name.startsWith('BFG') ? w.records[BFG_HOME] ?? rec : rec;
    this.home = [h.x, h.y, h.z];
    rec.flags |= RF_NO_COLLIDE;
  }
  /**
   * Save block = node +0x34 .. +0x5c then the tag of the record at +0x4c (saver FUN_004b2bc5: the 0x28 bytes, then the first dword (4 name characters) of the record `follow` points at, 0 for none; loader
   * FUN_004b2c9b copies the 0x28 bytes back and sets +0x4c = FUN_00419a79(tag), the FIRST record of that name): +0x00 f32 flap (+0x34), +0x04 i32 flapState, +0x08 i32 cnt, +0x0c i32 cnt2, +0x10 f32 vy,
   * +0x14 i32 off, +0x18 u32 follow (the record pointer: the emulation's 0x10000000 + index * 0x68, the real process's heap address cannot be known and the loader replaces it), +0x1c f32 speed,
   * +0x20 f32 shiftT, +0x24 u32 0 (+0x58), +0x28 u32 tag.
   */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    this.init(w, rec);
    const f = this.follow;
    return new BlockOut(0x2c).f32(0, this.flap).i32(4, this.flapState).i32(8, this.cnt).i32(0xc, this.cnt2).f32(0x10, this.vy).i32(0x14, this.off)
      .u32(0x18, f ? (EMU_RECORDS_BASE + f.index * EMU_RECORD_STRIDE) >>> 0 : 0).f32(0x1c, this.speed).f32(0x20, this.shiftT).u32(0x28, f ? recordTag(f.name) : 0).bytes;
  }
  loadBlock(w: World, rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    this.init(w, rec);
    const b = new BlockIn(data);
    this.flap = b.f32(0); this.flapState = b.i32(4); this.cnt = b.i32(8); this.cnt2 = b.i32(0xc); this.vy = b.f32(0x10); this.off = b.i32(0x14); this.speed = b.f32(0x1c); this.shiftT = b.f32(0x20);
    const tag = b.u32(0x28);
    this.follow = null;
    if ((tag & 0xff) !== 0) for (const r of w.records) if (recordTag(r.name) === tag) { this.follow = r; break; }
  }
  /** FUN_004b24f8 */
  update(w: World, rec: GameRecord, c: Controller): number {
    this.init(w, rec);
    const g = animalGlobals(w);
    if (c.distSq < g.nearestD) { g.nearestD = c.distSq; g.nearest = rec; }
    return 1;
  }
  /** FUN_004b23dc: the vector to the home (or the followed record) and its squared XZ length (FAR outside the signed box) */
  private rel(rec: GameRecord, d: number[]): number {
    const t = this.follow;
    if (!t) { d[0] = sb(this.home[0], rec.x); d[1] = sb(this.home[1], rec.y); d[2] = sb(this.home[2], rec.z); }
    else { d[0] = sb(t.x, rec.x); d[1] = sb(t.y, rec.y); d[2] = sb(t.z, rec.z); }
    if (d[0] <= this.range && d[2] <= this.range) return ad(ml(d[2], d[2]), ml(d[0], d[0]));
    return FAR;
  }
  /** FUN_004b2539 (the movement runs in the pre-render hook) */
  prerender(w: World, rec: GameRecord, c: Controller) {
    const dt = fr(w.dt);
    if (!inView(w, rec)) {
      if (this.off > 200) return;
      if (this.off === 200) {
        this.flapState = 0; this.cnt = 0; this.cnt2 = 0; this.vy = F002; this.flap = 1; this.speed = F008;
        rec.x = this.start[0]; rec.y = this.start[1]; rec.z = this.start[2];
        return;
      }
      this.off++;
    } else this.off = 0;
    if ((w.input.pressed & 0x40) === 0) this.shiftT = ad(ml(1, dt), this.shiftT);
    else {
      if (4 < this.shiftT) {
        if (!this.follow && c.distSq < 64) { this.follow = w.focus; this.speed = F02; }
      } else { this.follow = null; this.speed = ad(ml(rand(1), F01), F0005); }
      this.shiftT = 0;
    }
    if (this.flapState === 0) {
      this.flap = sb(this.flap, ml(FLAP_RATE, dt));
      if (this.flap <= -1) { this.flap = -1; this.flapState = 2; }
    } else if (this.flapState === 2) {
      this.flap = ad(ml(FLAP_RATE, dt), this.flap);
      if (1 <= this.flap) { this.flap = 1; this.flapState = 0; }
    }
    const d = [0, 0, 0];
    const d2 = this.rel(rec, d);
    if (this.follow) this.off = 0;
    if (d2 <= this.range2) {
      if (!this.follow || NEAR2 <= d2) {
        const old = this.cnt; this.cnt++;
        if (10 < old) {
          this.cnt = ftol(rand(10));
          rec.ry = sb(PI, rand(TWO_PI));
          if (!this.follow) this.speed = ad(ml(rand(1), F01), F0005);
        }
      } else {
        rec.ry = -fr(Math.atan2(d[0], d[2]));
        this.cnt = ftol(rand(10));
      }
    } else {
      rec.ry = fr(Math.atan2(d[0], d[2]));
      this.cnt = ftol(rand(10));
      this.speed = ad(ml(rand(1), F01), F02);
    }
    let y = ad(rec.y, this.vy);
    const floor = this.follow ? ad(this.follow.y, F08) : this.home[1];
    if (floor <= y) {
      if (y <= ad(floor, 6)) {
        const old = this.cnt2; this.cnt2++;
        if (10 < old) {
          this.cnt2 = ftol(rand(10));
          this.vy = sb(F01, rand(F02));
          this.vy = this.vy >= 0 ? ad(this.vy, F01) : sb(this.vy, F01);
        }
      } else { this.vy = -ad(rand(F01), F01); this.cnt2 = ftol(rand(10)); }
    } else { this.vy = ad(rand(F01), F01); this.cnt2 = ftol(rand(10)); }
    const s = this.follow ? 2 : 1.5;
    setScaled(rec.m, rec.rx, rec.ry, rec.rz, rec.x, y, rec.z, s, ml(s, this.flap), s);
    const k = ml(this.speed, dt);
    rec.x = ad(ml(k, rec.m[8]), rec.x); rec.y = ad(ml(k, rec.m[9]), rec.y); rec.z = ad(ml(k, rec.m[10]), rec.z);
  }
  /** FUN_004b2b75: default draw, then the nearest-butterfly globals are reset */
  draw(w: World): number { const g = animalGlobals(w); g.nearestD = FAR; g.nearest = null; return 0; }
}

// ================================================================================================ swifts

/** the spline objects of FUN_004454e0 (Common GSMS SplineBase.cpp, vtable 0x892268): a uniform cubic B-spline through the translations of a `.man`
 *  (x negated, FUN_0043ecd0), `n` = the header's frame count (a missing last frame repeats the previous one: the loader's fread fails and keeps its locals) */
export class BSpline {
  readonly pts: Float32Array;
  readonly n: number;
  private track: TrackSpline | null = null;
  constructor(pts: Float32Array, n: number) { this.pts = pts; this.n = n; }
  /** FUN_00445660 -> vtable[1] 0x4466f0 writes the whole frame into the caller's matrix: rows right R (0, 1, 2), up U (4, 5, 6), tangent T (8, 9, 10), position (12, 13, 14); the fourth column is left alone (src/zones/z20dsp/spline.ts `frame`) */
  frameMatrix(t: number, out: Float32Array): void {
    const f = (this.track ??= new TrackSpline(this.pts)).frame(t);
    out[0] = f.r[0]; out[1] = f.r[1]; out[2] = f.r[2];
    out[4] = f.u[0]; out[5] = f.u[1]; out[6] = f.u[2];
    out[8] = f.t[0]; out[9] = f.t[1]; out[10] = f.t[2];
    out[12] = f.p[0]; out[13] = f.p[1]; out[14] = f.p[2];
  }
  static fromMan(data: Uint8Array): BSpline {
    const man = parseMan(data);
    const n = man.declaredFrames, tr = man.tracks[0];
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = Math.min(i, man.frameCount - 1) * 9;
      pts[i * 3] = -tr[f + 3]; pts[i * 3 + 1] = tr[f + 4]; pts[i * 3 + 2] = tr[f + 5];
    }
    return new BSpline(pts, n);
  }
  /**
   * FUN_00445660 -> vtable[1] (0x4466f0), position part, operation by operation (x87 at 24 bit): the basis matrix (-1 3 -3 1 / 3 -6 3 0 / -3 0 3 0 / 1 4 1 0) times 1/6 (0x3e2aaaab), u = n * t,
   * segment i = trunc(u) (the next points are clamped to n - 1, the previous to 0), f = u - i, the four weights from f, f^2, f^3 and the sums in the compiled order (x: (b + d) + c + a; y: (c + b) + d + a; z: (a + c) + b + d).
   */
  point(t: number, out: number[] = [0, 0, 0]): number[] {
    const n = this.n;
    const u = fr(n * fr(t));
    let i = ftol(u);
    const i0 = Math.max(i - 1, 0);
    if (i >= n) i = n - 1;
    const i2 = Math.min(i + 1, n - 1), i3 = Math.min(i + 2, n - 1);
    const f = sb(u, i), f2 = ml(f, f), f3 = ml(f2, f);
    const m = SPLINE_M;
    const Wa = ad(ad(ad(ml(f, m[9]), ml(f2, m[5])), ml(f3, m[1])), m[13]);
    const Wd = ad(ad(ad(ml(f, m[11]), ml(f2, m[7])), ml(f3, m[3])), m[15]);
    const Wb = ad(ad(ad(ml(f, m[8]), ml(f2, m[4])), ml(f3, m[0])), m[12]);
    const Wc = ad(ad(ad(ml(f, m[10]), ml(f2, m[6])), ml(f3, m[2])), m[14]);
    const P = this.pts, P0 = i * 3, Pm = i0 * 3, P1 = i2 * 3, P2 = i3 * 3;
    out[0] = ad(ad(ad(ml(Wb, P[Pm]), ml(Wd, P[P2])), ml(Wc, P[P1])), ml(Wa, P[P0]));
    out[1] = ad(ad(ad(ml(Wc, P[P1 + 1]), ml(Wb, P[Pm + 1])), ml(Wd, P[P2 + 1])), ml(Wa, P[P0 + 1]));
    out[2] = ad(ad(ad(ml(Wa, P[P0 + 2]), ml(Wc, P[P1 + 2])), ml(Wb, P[Pm + 2])), ml(Wd, P[P2 + 2]));
    return out;
  }
}
/** the spline's basis matrix, every element times 1 / 6 stored as a float32 (0x4466f0 prologue) */
const SPLINE_M = [-1, 3, -3, 1, 3, -6, 3, 0, -3, 0, 3, 0, 1, 4, 1, 0].map((v) => ml(v, fromBits(0x3e2aaaab)));

/** `\DATA\z02lgi\matanim\bat.man` (0x8d9338) / `swift.man` (0x8d9358) */
const SPLINE_FILES = ['MatAnim/bat.man', 'MatAnim/swift.man'];
const SWIFT_SOUND = 0x05d581e8;   // handle of sound 0xfd

export class SwiftLeaderNode extends Node {
  readonly kind = 'SwiftLeader';
  readonly type: number;     // arg +0: 0 bat.man, 1 swift.man
  spline: BSpline | null = null;   // +0x14
  fast: number;              // +0x18
  slow: number;              // +0x1c
  mode: number;              // +0x20 (0: fly the spline for ever; else perch 500 ticks between laps: the bats)
  clipA: number;             // +0x24
  clipB: number;             // +0x28
  turn: number;              // +0x2c (the followers' turn rate)
  t = 3;                     // +0x30
  perch = 0;                 // +0x34
  state = 0;                 // +0x38 (0 start, 1 perched, 2 fly home, 3 take off, 4 follow)
  homing = 10;               // +0x3c
  /** +0x40: the spline's frame matrix (FUN_00445660's output, 16 floats; the fourth column stays 0); only its translation (+0x70 .. +0x78, shifted by 16 in x by the update) is used: the followers' target */
  readonly matrix = ((m) => { m[15] = CDF; return m; })(new Float32Array(16));   // (FUN_00445660 writes 15 of the 16 floats, the 4th column's first three as 0; [15] stays 0xCD)
  target: [number, number, number] = [0, 0, 0];
  private inited = false;
  constructor(args: ArgView) {
    super();
    this.type = args.i32(0);
    this.fast = args.f32(4); this.slow = args.f32(8); this.mode = args.i32(12);
    this.clipA = args.i32(16); this.clipB = args.i32(20); this.turn = args.f32(24);
  }
  /** the constructor FUN_004b31db (loads the spline, evaluates it at t = 0 into the matrix): right after the set-up (`ctorInit`) */
  ctorInit(w: World): void { this.init(w); }
  private init(w: World) {
    if (this.inited) return;
    this.inited = true;
    const c = tryCtx(w);
    const f = SPLINE_FILES[this.type];
    const e = f && c ? c.archive.find(f) : undefined;
    if (e && c) { try { this.spline = BSpline.fromMan(c.archive.read(e)); } catch { this.spline = null; } }
    this.eval(0, false);
  }
  private eval(t: number, shift = true) {
    if (!this.spline) return;
    this.spline.frameMatrix(t, this.matrix);
    if (shift) this.matrix[12] = sb(this.matrix[12], 16);        // *(node + 0x70) -= 16 (_DAT_008921f4)
    this.target = [this.matrix[12], this.matrix[13], this.matrix[14]];
  }
  /**
   * Save block = node +0x30 .. +0x80 (saver FUN_004b317d returns 0x50 and points at node + 0x30, loader FUN_004b31a2 = 80 byte memcpy back): +0x00 f32 t (+0x30), +0x04 f32 perch (+0x34), +0x08 i32 state (+0x38),
   * +0x0c i32 homing (+0x3c), +0x10 the spline frame matrix, 16 floats (+0x40; the translation at +0x70 is what the followers chase).
   */
  saveBlock(w: World): Uint8Array {
    this.init(w);
    const o = new BlockOut(0x50, CD).f32(0, this.t).f32(4, this.perch).i32(8, this.state).i32(0xc, this.homing);
    for (let k = 0; k < 16; k++) o.f32(0x10 + 4 * k, this.matrix[k]);
    return o.bytes;
  }
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    this.init(w);
    const b = new BlockIn(data);
    this.t = b.f32(0); this.perch = b.f32(4); this.state = b.i32(8); this.homing = b.i32(0xc);
    for (let k = 0; k < 16; k++) this.matrix[k] = b.f32(0x10 + 4 * k);
    this.target = [this.matrix[12], this.matrix[13], this.matrix[14]];
  }
  /** FUN_004b2f64 */
  update(w: World, rec: GameRecord): number {
    this.init(w);
    sfxAt(w, soundOf(w, SWIFT_SOUND), recPos(rec));
    if (this.mode === 0) {
      if (this.state !== 4 && w.frame === this.stamp) this.state = 4;
      this.t = ad(ml(this.slow, fr(w.dt)), this.t);
    } else {
      if (this.perch < 500) {
        this.perch = ad(ml(1, fr(w.dt)), this.perch);
        if (this.homing === 0) this.state = 1; else this.homing = 0;
        return 2;
      }
      if (this.state === 1) { this.state = 3; this.t = 0; } else this.state = 4;
      if (0.5 <= this.t && this.t <= fromBits(0x3f19999a)) this.t = ad(ml(this.slow, fr(w.dt)), this.t); else this.t = ad(ml(this.fast, fr(w.dt)), this.t);
    }
    if (1 <= this.t) {
      if (this.mode === 0) this.t = 0;
      else { this.perch = 0; this.state = 2; this.homing = 0; }
    }
    this.eval(this.t);
    return 2;
  }
  /** prerender FUN_004b3149 / draw FUN_004b3163 return 1: the leader's record is not drawn */
  draw(): number { return 1; }
}

/** FUN_004b336d: turn (yaw and pitch, at most dist * turn * dt) towards `target`; 0 when within `min` (in units / 8). Every operation a float32. */
function steerTo(w: World, rec: GameRecord, target: readonly number[], min: number, turn: number): number {
  const dx = sb(target[0], rec.x), dy = sb(target[1], rec.y), dz = sb(target[2], rec.z);
  const dist = ml(sq(ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz))), 0.125);
  if (!(min < dist)) return 0;
  const yaw = fr(Math.atan2(dx, dz));
  const pitch = fr(Math.atan2(-dy, sq(ad(ml(dx, dx), ml(dz, dz)))));
  const step = ml(ml(dist, turn), fr(w.dt));
  const a = wrapPi(sb(yaw, rec.ry)), b = wrapPi(sb(pitch, rec.rx));
  if (step <= fr(Math.abs(a))) rec.ry = a >= 0 ? ad(step, rec.ry) : sb(rec.ry, step); else rec.ry = yaw;
  if (step <= fr(Math.abs(b))) rec.rx = b >= 0 ? ad(step, rec.rx) : sb(rec.rx, step); else rec.rx = pitch;
  setRot(rec.m, rec.rx, rec.ry, rec.rz);
  return 1;
}

export class SwiftNode extends Node {
  readonly kind = 'Swift';
  speed = 2;          // +0x14
  approach = 1;       // +0x18
  start: [number, number, number] = [0, 0, 0];   // +0x1c
  readonly leaderIndex: number;   // +0x28 (record pointer of the argument)
  cnt = CD16;         // +0x2c (short; never written by the constructor: 0xCD)
  perched = CD16;     // +0x2e (short; 0xCD)
  dyaw = CDF;         // +0x30 (0xCD)
  dpitch = CDF;       // +0x34 (0xCD)
  timer: number;      // +0x38
  private inited = false;
  constructor(args: ArgView) {
    super();
    this.leaderIndex = args.recIndex(0);
    this.timer = rand(200);
  }
  /**
   * Save block = node +0x2c .. +0x3c (saver FUN_004b3a34 returns 0x10 and points at node + 0x2c, loader FUN_004b3a59 = 16 byte memcpy back): i16 cnt (+0x2c), i16 perched (+0x2e), f32 dyaw (+0x30),
   * f32 dpitch (+0x34), f32 timer (+0x38). The speed, approach, start position and the leader's record pointer (+0x14 .. +0x28) are the constructor's and are not saved.
   */
  saveBlock(): Uint8Array { return new BlockOut(0x10).i16(0, this.cnt).i16(2, this.perched).f32(4, this.dyaw).f32(8, this.dpitch).f32(0xc, this.timer).bytes; }
  loadBlock(_w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    const b = new BlockIn(data);
    this.cnt = b.i16(0); this.perched = b.i16(2); this.dyaw = b.f32(4); this.dpitch = b.f32(8); this.timer = b.f32(0xc);
  }
  private leader(w: World): SwiftLeaderNode | null {
    const r = w.records[this.leaderIndex];
    const n = r?.ctrl?.nodes[0];      // FUN_004239d9(ctrl): the head node of the leader's controller
    return n instanceof SwiftLeaderNode ? n : null;
  }
  /** FUN_004b35f9 */
  update(w: World, rec: GameRecord): number {
    if (!this.inited) { this.inited = true; this.start = [rec.x, rec.y, rec.z]; ensureAnim(w, rec); }
    const L = this.leader(w);
    if (!L) return 1;
    const anim = rec.anim;
    let moving = false;
    let s = L.state;
    if (s === 2 && this.perched === 0) {
      if (steerTo(w, rec, this.start, 0.25, L.turn) === 0) {
        rec.rx = 0;
        rec.setEuler(rec.rx, rec.ry, rec.rz, this.start[0], this.start[1], this.start[2]);
        this.perched = 1;
        anim?.start(L.clipB, 0);
        this.timer = 0;
      } else { moving = true; L.homing++; }
      s = -1;
    } else if (s === 2) s = 1;
    switch (s) {
      case 0: anim?.start(L.mode === 0 ? L.clipA : L.clipB, 0); break;
      case 1:
        if (0 <= this.timer) this.timer = sb(this.timer, ml(1, fr(w.dt)));
        else if (anim && anim.advanceTo(1, w.dt, 0) !== 0) { anim.seek(0); this.timer = rand(200); }     // FUN_0043b874(anim, 1.0, 0): advance without wrapping, 2 at the end
        break;
      case 3:
        anim?.start(L.clipA, 0);
        rec.rx = fromBits(0x3fc90fdb);
        setRot(rec.m, rec.rx, rec.ry, rec.rz);
        moving = true;
        this.perched = 0;
        break;
      case 4:
        if (steerTo(w, rec, L.target, this.approach, L.turn) === 0) {
          if (this.cnt === 0) {
            this.cnt = 1;
            this.dpitch = sb(fromBits(0x3ec90fdb), rand(fromBits(0x3f490fdb)));
            this.dyaw = sb(fromBits(0x3ec90fdb), rand(fromBits(0x3f490fdb)));
          } else {
            const old = this.cnt; this.cnt++;
            if (old < 20) { rec.rx = ad(rec.rx, this.dpitch); rec.ry = ad(rec.ry, this.dyaw); setRot(rec.m, rec.rx, rec.ry, rec.rz); }
          }
        } else this.cnt = 0;
        moving = true;
        break;
    }
    if (moving) {
      anim?.advance(2, w.dt);
      const k = ml(this.speed, fr(w.dt));
      rec.x = ad(ml(k, rec.fx), rec.x); rec.y = ad(ml(k, rec.fy), rec.y); rec.z = ad(ml(k, rec.fz), rec.z);
    }
    return 1;
  }
}

registerCtor(CTOR_BUNNY, (a: Attach) => new BunnyNode(ArgView.of(a)));
registerCtor(CTOR_BUTTERFLY, (a: Attach) => new ButterflyNode(ArgView.of(a)));
registerCtor(CTOR_SWIFT_LEADER, (a: Attach) => new SwiftLeaderNode(ArgView.of(a)));
registerCtor(CTOR_SWIFT, (a: Attach) => new SwiftNode(ArgView.of(a)));
