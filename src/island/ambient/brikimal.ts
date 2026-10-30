// Brikimal (ctor FUN_004bd4a8, table 0x8d9ef8 {update FUN_004bcc1b, prerender 1, destroy FUN_004bd8c8, draw FUN_004bd41a}): the brick-morph animals
// BML1 (record 366, kind 0) and BML3 (record 368, kind 1; record 367 would be kind 2, the swimmer, not attached). Their game variable (0xc3
// SWITCH_GME_MOVE_BML1 / 0xe0 SWITCH_GME_MOVE_BML3, gate mask 0) is the animal shape 0..7: every 300 ticks (or Enter close by) the node counts it on,
// the brick-morph object (FX_Bricks, WP9; `IslandCtx.brickMorph`) morphs to the next shape of `animalNN.txt`. The movement parameters per (kind, shape)
// are the 7-field rows of the table at 0x8d9f10 (read from the executable). Without a brick-morph service the record's plain model is shown.
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Pe } from '../../formats/exe.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { mulGame } from '../../render/math.ts';
import { ad, sb, ml, fr, fromBits } from '../../zones/common/f32.ts';
import { tryCtx } from '../ctx.ts';
import { BlockIn, BlockOut, CD, CDF, keepRaw } from '../blockio.ts';
import { wrapPi, rand, sfxAt, soundOf, recPos, setRot } from './common.ts';

export const CTOR_BRIKIMAL = 0x4bd4a8;
// float constants of FUN_004bcc1b: 23.04, the phase wrap 3.1415758 (0x892558), the tilts 0.0349064 / 0.0698132 (0x892584 / 0x3d8efa03), the rock 0.349064 (0x892150), 1.6 (0x892580), -0.45 (0x8da1b0), 0.174532 (0x89211c)
const WAIT_DIST2 = fromBits(0x41b851ec), PHASE_WRAP = fromBits(0x40490f94), TILT = fromBits(0x3d0efa03), TILT2 = fromBits(0x3d8efa03), ROCK = fromBits(0x3eb2b884), BOB1 = fromBits(0x3fcccccd), SIDE = fromBits(0xbee66666), LEAN = fromBits(0x3e32b884);
/** FUN_004bcc00(kind, v) = 0x8d9f10 + v * 0x1c + kind * 0xe0: {morph period, speed, turn rate, bob amplitude, phase rate, phase rate (negative half), flags} */
export const BRIKIMAL_TABLE = 0x8d9f10;
/** the records the constructor compares with (`DAT_00983804 + 0x94b0 / 0x9580 / 0x9518`) */
const KIND_OF_RECORD: Record<number, number> = { 366: 0, 368: 1, 367: 2 };
/** the brick-morph clips of each kind (0x8da1ec ..): FUN_00447da0(h, "animalNN.txt") */
export const BRIKIMAL_FILES = [
  ['animal07.txt', 'animal00.txt', 'animal06.txt', 'animal02.txt'],
  ['animal04.txt', 'animal01.txt', 'animal05.txt', 'animal03.txt'],
  ['animal04.txt', 'animal01.txt', 'animal05.txt', 'animal03.txt'],
];
const MORPH_SOUND = 0x05d580f0;   // handle of sound 0x364

export interface BrikimalRow { period: number; speed: number; turn: number; bob: number; rate: number; rateNeg: number; flags: number }
export function brikimalRow(pe: Pe, kind: number, v: number): BrikimalRow {
  const a = BRIKIMAL_TABLE + v * 0x1c + kind * 0xe0;
  const f = (o: number) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, pe.u32(a + o), true); return b.getFloat32(0, true); };
  return { period: f(0), speed: f(4), turn: f(8), bob: f(12), rate: f(16), rateNeg: f(20), flags: pe.u32(a + 24) | 0 };
}

export class BrikimalNode implements BehaviourNode {
  readonly kind = 'Brikimal';
  /** draw hook FUN_004bd41a = FUN_00444940(rec) (then returns 1): the animal's blob shadow, also while the brick morph hides the mesh */
  readonly blobShadow = true;
  var = 0; mask = 0; value = 0; stamp = 0xfffffffe;
  home: [number, number, number] = [0, 0, 0];   // +0x14
  morph: { state(): number } | null = null;      // +0x20
  animal = 0;          // +0x24 kind
  timerA = 0;          // +0x28
  phase = 0;           // +0x30
  morphT = 0;          // +0x34
  toggle = 0;          // +0x38 (byte)
  prevToggle = 0;      // +0x39 (byte)
  /** +0x3c: the brick-morph object's matrix (rotation with the tilt, translation = position + right * -0.45) */
  readonly matrix = new Float32Array(16);
  wait = CDF;          // +0x7c (never written by the constructor: 0xCD; the update only tests it `<= 0`)
  private raw: Uint8Array | null = null;
  private inited = false;
  private stated = false;
  private rows: BrikimalRow[] = [];

  /** the constructor's reads of the record that the save block holds (home position +0x14, the matrix copy +0x3c, the kind +0x24): run right after the set-up (`ctorInit`) */
  ctorInit(_w: World, rec: GameRecord): void {
    if (this.stated) return;
    this.stated = true;
    this.home = [rec.x, rec.y, rec.z];
    this.matrix.set(rec.m);
    this.animal = KIND_OF_RECORD[rec.index] ?? 0;
    // the constructor hides the record (the brick-morph object draws the animal) and marks it 0x20; the fallback without a morph object re-enables it at the first update
    rec.colObj?.setBox(1.6, 6.0, 2.666);      // FUN_00442780(rec, 1.6, 6.0, 2.666)
    rec.flags = (rec.flags & ~RF_ENABLED) | 0x20;
  }
  /**
   * Save block = node +0x28 .. +0x80 (saver FUN_004bd44a returns 0x58 and points at node + 0x28, loader FUN_004bd46f = 88 byte memcpy back; the home position +0x14, the morph handle +0x20 and the kind +0x24 are not
   * in it): +0x00 f32 timerA (+0x28), +0x04 f32 0 (+0x2c), +0x08 f32 phase (+0x30), +0x0c f32 morphT (+0x34), +0x10 u8 toggle (+0x38), +0x11 u8 prevToggle (+0x39), +0x12 2 pad bytes,
   * +0x14 16 x f32 the morph object's matrix (+0x3c), +0x54 f32 wait (+0x7c).
   */
  saveBlock(w: World, rec: GameRecord): Uint8Array {
    this.ctorInit(w, rec);
    const o = new BlockOut(0x58, CD).f32(0, this.timerA).f32(4, 0).f32(8, this.phase).f32(0xc, this.morphT).u8(0x10, this.toggle).u8(0x11, this.prevToggle);
    for (let k = 0; k < 16; k++) o.f32(0x14 + 4 * k, this.matrix[k]);
    o.f32(0x54, this.wait);
    keepRaw(o, this.raw, [[0x12, 2]]);   // +0x3a / +0x3b: padding after the toggle bytes
    return o.bytes;
  }
  loadBlock(w: World, rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    this.ctorInit(w, rec);
    const b = new BlockIn(data);
    this.raw = data.slice();
    this.timerA = b.f32(0); this.phase = b.f32(8); this.morphT = b.f32(0xc); this.toggle = b.u8(0x10); this.prevToggle = b.u8(0x11);
    for (let k = 0; k < 16; k++) this.matrix[k] = b.f32(0x14 + 4 * k);
    this.wait = b.f32(0x54);
  }

  /** the constructor FUN_004bd4a8 (first update): the rest of its work (collision box, flags, the brick-morph object) */
  private init(w: World, rec: GameRecord) {
    this.inited = true;
    this.ctorInit(w, rec);
    const c = tryCtx(w);
    if (c) for (let v = 0; v < 8; v++) this.rows.push(brikimalRow(c.pe, this.animal, v));
    this.morph = c?.brickMorph?.(rec, this.var, BRIKIMAL_FILES[this.animal], this.matrix) ?? null;
    if (!this.morph) rec.flags |= RF_ENABLED;   // fallback: the plain model
  }

  /** FUN_004bcc1b */
  update(w: World, rec: GameRecord, c: Controller): number {
    if (!this.inited) this.init(w, rec);
    const v = w.vars.get(this.var);
    const row = this.rows[v & 7] ?? { period: 300, speed: 0, turn: 0, bob: 0, rate: 0, rateNeg: 0, flags: 0 };
    let moving = false;
    const dt = fr(w.dt);
    this.timerA = ad(ml(1, dt), this.timerA);
    this.morphT = ad(ml(1, dt), this.morphT);
    const ready = (this.morph ? this.morph.state() : 2) === 2;
    if ((row.period < this.morphT || ((w.input.pressed & 0x10000) !== 0 && c.distSq < 256)) && ready) {
      if (v < 7) w.vars.add(this.var, 1); else w.vars.set(this.var, 0);
      this.morphT = 0;
      sfxAt(w, soundOf(w, MORPH_SOUND), recPos(rec));
    }
    const dx = sb(this.home[0], rec.x), dy = sb(this.home[1], rec.y), dz = sb(this.home[2], rec.z);
    const d2 = ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz));
    if (WAIT_DIST2 <= c.distSq) { if (0 < this.wait) this.wait = sb(this.wait, ml(1, dt)); }
    else this.wait = 15;
    if (this.wait <= 0 && (row.flags & 4)) {
      if (100 < d2) {
        const yaw = wrapPi(fr(Math.atan2(dx, dz)));
        const t = wrapPi(sb(yaw, rec.ry));
        const s = ml(row.turn, dt);
        if (-s <= t) { if (t <= s) rec.ry = yaw; else rec.ry = ad(s, rec.ry); } else rec.ry = sb(rec.ry, s);
      }
      moving = true;
    }
    if (0 <= this.phase || row.rateNeg < 0) this.phase = ad(ml(row.rate, dt), this.phase); else this.phase = ad(ml(row.rateNeg, dt), this.phase);
    if ((row.flags & 0x18) && this.phase < 0 && 0 <= row.rateNeg) moving = false;
    if (0 <= row.rateNeg) this.phase = wrapPi(this.phase);
    else if (PHASE_WRAP < this.phase) { this.phase = sb(this.phase, PHASE_WRAP); this.toggle = this.toggle ? 0 : 1; }
    if (this.wait <= 0 && moving) {
      const k = ml(row.speed, dt);
      rec.x = ad(ml(k, rec.fx), rec.x); rec.y = ad(ml(k, rec.fy), rec.y); rec.z = ad(ml(k, rec.fz), rec.z);
    }
    if ((row.flags & 2) === 0) { rec.rx = 0; rec.rz = 0; }
    else { rec.rx = sb(TILT, rand(TILT2)); rec.rz = sb(TILT, rand(TILT2)); }
    if (this.animal !== 2) {
      const g = w.col.terrainHeight(rec.x, rec.y, rec.z, 8);     // FUN_0043cd62(pos, 8.0)
      if (fr(w.seaLevel) < g) rec.y = g;
    }
    if (row.flags & 1) {
      rec.rx = fr(Math.sin(this.phase) * ROCK);
      rec.y = ad(fr(Math.abs(Math.sin(rec.rx)) * BOB1), rec.y);
    }
    if (0 <= this.phase || row.rateNeg < 0) rec.y = ad(fr(Math.sin(this.phase) * row.bob), rec.y);
    setRot(rec.m, 0, rec.ry, 0);
    const m = this.matrix;
    setRot(m, rec.rx, rec.ry, rec.rz);
    m[12] = ad(ml(rec.m[0], SIDE), rec.x); m[13] = ad(ml(rec.m[1], SIDE), rec.y); m[14] = ad(ml(rec.m[2], SIDE), rec.z);
    if (row.flags & 0x10) {
      if (!moving) { if (this.prevToggle === this.toggle) this.toggle = this.toggle ? 0 : 1; }
      else {
        this.prevToggle = this.toggle;
        if (0 < this.phase) {
          const sn = Math.sin(this.phase);
          const a = this.toggle === 0 ? fr(sn * LEAN) : -fr(sn * LEAN);
          const r = buildMatrix(0, 0, a, 0, 0, 0);       // FUN_0043a340(tmp, 0, 0, a), then tmp * matrix
          const out = mulGame(r, m);
          m.set(out);
        }
      }
    }
    // (fallback without a brick-morph object: the record itself is shown with its yaw-only matrix, see init)
    return 1;
  }
}

registerCtor(CTOR_BRIKIMAL, () => new BrikimalNode());
