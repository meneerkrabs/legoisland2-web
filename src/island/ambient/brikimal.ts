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
import { mul } from '../../render/math.ts';
import { tryCtx } from '../ctx.ts';
import { wrapPi, rand, sfxAt, soundOf, recPos, setRot } from './common.ts';

export const CTOR_BRIKIMAL = 0x4bd4a8;
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
  wait = 0;            // +0x7c
  private inited = false;
  private rows: BrikimalRow[] = [];

  /** the constructor FUN_004bd4a8 (first update) */
  private init(w: World, rec: GameRecord) {
    this.inited = true;
    this.home = [rec.x, rec.y, rec.z];
    rec.colObj?.setBox(1.6, 6.0, 2.666);      // FUN_00442780(rec, 1.6, 6.0, 2.666)
    rec.flags = (rec.flags & ~RF_ENABLED) | 0x20;
    this.matrix.set(rec.m);
    this.animal = KIND_OF_RECORD[rec.index] ?? 0;
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
    this.timerA += 1 * w.dt;
    this.morphT += 1 * w.dt;
    const ready = (this.morph ? this.morph.state() : 2) === 2;
    if ((row.period < this.morphT || ((w.input.pressed & 0x10000) !== 0 && c.distSq < 256)) && ready) {
      if (v < 7) w.vars.add(this.var, 1); else w.vars.set(this.var, 0);
      this.morphT = 0;
      sfxAt(w, soundOf(w, MORPH_SOUND), recPos(rec));
    }
    const dx = this.home[0] - rec.x, dy = this.home[1] - rec.y, dz = this.home[2] - rec.z;
    const d2 = dz * dz + dy * dy + dx * dx;
    if (23.04 <= c.distSq) { if (0 < this.wait) this.wait -= 1 * w.dt; }
    else this.wait = 15;
    if (this.wait <= 0 && (row.flags & 4)) {
      if (100 < d2) {
        const yaw = wrapPi(Math.atan2(dx, dz));
        const t = wrapPi(yaw - rec.ry);
        const s = row.turn * w.dt;
        if (t < -s) rec.ry -= s; else if (s < t) rec.ry += s; else rec.ry = yaw;
      }
      moving = true;
    }
    if (0 <= this.phase || row.rateNeg < 0) this.phase += row.rate * w.dt; else this.phase += row.rateNeg * w.dt;
    if ((row.flags & 0x18) && this.phase < 0 && 0 <= row.rateNeg) moving = false;
    if (0 <= row.rateNeg) this.phase = wrapPi(this.phase);
    else if (3.14158 < this.phase) { this.phase -= 3.14158; this.toggle = this.toggle ? 0 : 1; }
    if (this.wait <= 0 && moving) {
      const k = row.speed * w.dt;
      rec.x += k * rec.fx; rec.y += k * rec.fy; rec.z += k * rec.fz;
    }
    if ((row.flags & 2) === 0) { rec.rx = 0; rec.rz = 0; }
    else { rec.rx = 0.0349064 - rand(0.0698132); rec.rz = 0.0349064 - rand(0.0698132); }
    if (this.animal !== 2) {
      const g = w.col.terrainHeight(rec.x, rec.y, rec.z, 8);     // FUN_0043cd62(pos, 8.0)
      if (w.seaLevel < g) rec.y = g;
    }
    if (row.flags & 1) {
      rec.rx = Math.sin(this.phase) * 0.349064;
      rec.y += Math.abs(Math.sin(rec.rx)) * 1.6;
    }
    if (0 <= this.phase || row.rateNeg < 0) rec.y += Math.sin(this.phase) * row.bob;
    setRot(rec.m, 0, rec.ry, 0);
    const m = this.matrix;
    setRot(m, rec.rx, rec.ry, rec.rz);
    m[12] = rec.m[0] * -0.45 + rec.x; m[13] = rec.m[1] * -0.45 + rec.y; m[14] = rec.m[2] * -0.45 + rec.z;
    if (row.flags & 0x10) {
      if (!moving) { if (this.prevToggle === this.toggle) this.toggle = this.toggle ? 0 : 1; }
      else {
        this.prevToggle = this.toggle;
        if (0 < this.phase) {
          const a = (this.toggle === 0 ? 1 : -1) * Math.sin(this.phase) * 0.174532;
          const r = buildMatrix(0, 0, a, 0, 0, 0);       // FUN_0043a340(tmp, 0, 0, a), then tmp * matrix
          const out = mul(r, m);
          m.set(out);
        }
      }
    }
    // (fallback without a brick-morph object: the record itself is shown with its yaw-only matrix, see init)
    return 1;
  }
}

registerCtor(CTOR_BRIKIMAL, () => new BrikimalNode());
