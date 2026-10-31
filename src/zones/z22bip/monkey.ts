// z22BIP: the monkeys (MNK0 .. MNKF), the node "monkey" (constructor FUN_0070fafb with the table at 0x931aa0, update FUN_0070f433, draw FUN_0070f6ec, the melons
// FUN_0070f2be / FUN_0070efc0). A monkey wakes up when the plane is within 160 units (square, then a circle of 160), plays its throwing clip and hurls a melon at the
// plane three times per loop of the clip (frames 15, 35, 54) while the plane flies above 320; a melon that touches the plane (within 6.4) spins it out (-100
// points). A banana that reaches a monkey scores 700 (the plane's FUN_00709258 sets its state to 2: the hit clip, then 3: dazed until the plane leaves).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { bipRun, f32, msClock, REC } from './run.ts';
import { randF } from '../../game/crt.ts';
import { setRotation } from './plane.ts';
import { PLANE } from './plane.ts';
import { eulerMatrix, matThen } from '../common/matrix.ts';
import { normalise3 } from '../exact.ts';
import { ad, sb, ml, sq } from '../common/f32.ts';

const F = Math.fround;
export const CTOR_MONKEY = 0x70fafb;

export const MONKEY = {
  WAKE: 160,                    // 0x8928ec: the box around the monkey that wakes it (then the circle: 25600 = 160 squared, 0x8928e8)
  WAKE2: 25600,
  THROW_FRAMES: [[15, 16], [35, 36], [54, 55]] as const,   // the frames of the throwing clip (0x892074 / 0x8921f4, 0x89279c / 0x89269c, 0x8928e4 / 0x8928e0)
  CHATTER_MOD: 0x5a, CHATTER: [[0xf, 'chatter1'], [0x34, 'chatter2'], [0x47, 'chatter3']] as const,
  MELONS: 10, MELON_LIFE: 0x32, MELON_STEP: 4, MELON_SPIN: f32(0x3f060a63),
  MELON_HIT: f32(0x40cccccd),   // 6.4
  SCALE: 2,                     // FUN_004440d0(diag 2): the monkey is drawn twice its size
  MELON_SCALE: 4,
} as const;

export interface Melon { active: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; born: number }
const newMelon = (): Melon => ({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, born: 0 });

export class MonkeyNode implements BehaviourNode {
  readonly kind = 'monkey';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;

  /** +0x39c: 0 asleep, 1 throwing, 2 hit (by a banana), 3 dazed */
  state = 0;
  /** +0x20 / +0x24: the clip played while awake / after a hit (the table's second and third value) */
  clipActive: number;
  clipHit: number;
  /** +0x398: the clock of the melons */
  clock = 0;
  melons: Melon[] = Array.from({ length: MONKEY.MELONS }, newMelon);
  /** the size the record is drawn at: the original scales at draw time (FUN_004440d0), the port bakes it into the record's matrix (1 in the node tests) */
  drawScale: number = MONKEY.SCALE;

  constructor(clipActive: number, clipHit: number) { this.clipActive = clipActive; this.clipHit = clipHit; }

  update(w: World, rec: GameRecord): number {
    const run = bipRun(w);
    const pl = w.records[REC.PLANE];
    const dx = Math.abs(F(pl.x - rec.x)), dz = Math.abs(F(pl.z - rec.z));
    const anim = rec.anim;
    if (MONKEY.WAKE <= dz) this.state = 0;
    else if (MONKEY.WAKE <= dx) this.state = 0;
    else {
      const d2 = F(F(dz * dz) + F(dx * dx));
      if (MONKEY.WAKE2 <= d2) this.state = 0;
      else if (this.state === 0) { anim?.start(this.clipActive, 0); this.state = 1; }
    }
    anim?.advance(1, w.dt);
    const frame = Math.trunc(anim?.frame ?? 0);
    if (this.state === 1) {
      // a chatter sound now and then (ftol(FUN_004388ae(GetTickCount - start)) % 90 hits one of three values)
      const r = Math.trunc(randF(msClock())) % MONKEY.CHATTER_MOD;
      for (const [v, snd] of MONKEY.CHATTER) if (r === v) { run.sound.at(snd, [rec.x, rec.y, rec.z]); break; }
      for (const [a, b] of MONKEY.THROW_FRAMES) if (a <= frame && frame < b) { this.throwMelon(w, rec); break; }
    } else if (this.state === 2) { anim?.start(this.clipHit, 0); this.state = 3; }
    this.moveMelons(w, rec);
    this.face(rec, pl);
    return NODE_STOP;
  }

  /** FUN_0070f2be: a melon from the monkey's place towards the plane (the plane flies above the minimum speed) */
  private throwMelon(w: World, rec: GameRecord) {
    const run = bipRun(w), pl = w.records[REC.PLANE], walk = run.plane;
    if (!walk || walk.speed < PLANE.FIRE_MIN_SPEED) return;
    for (const m of this.melons) {
      if (m.active) continue;
      m.active = true;
      m.born = this.clock;
      m.x = rec.x; m.y = rec.y; m.z = rec.z;
      m.spin = 0;
      const v = [sb(pl.x, rec.x), sb(pl.y, rec.y), sb(pl.z, rec.z)];
      normalise3(v);                                          // FUN_0043cec0
      m.vx = v[0]; m.vy = v[1]; m.vz = v[2];
      run.sound.at('chimpThrow', [rec.x, rec.y, rec.z]);
      run.cue?.('bip-melon-throw', [rec.x, rec.y, rec.z]);
      return;
    }
  }

  /** FUN_0070efc0: the melons fly 4 times their direction per tick for 50 ticks; one that gets within 6.4 of the plane bounces off in a random direction and spins the plane out */
  private moveMelons(w: World, rec: GameRecord) {
    void rec;
    const run = bipRun(w), pl = w.records[REC.PLANE], walk = run.plane;
    for (const m of this.melons) {
      if (!m.active) continue;
      if (m.born + MONKEY.MELON_LIFE < this.clock) { m.active = false; continue; }
      m.x = ad(ml(m.vx, MONKEY.MELON_STEP), m.x); m.y = ad(ml(m.vy, MONKEY.MELON_STEP), m.y); m.z = ad(ml(m.vz, MONKEY.MELON_STEP), m.z);
      m.spin = ad(m.spin, MONKEY.MELON_SPIN);
      // FUN_0085d104(sqrt) of dx*dx + dy*dy + dz*dz, the asm adds x, y, z (0x70f0e6 .. 0x70f0fa), stored as a float
      const dx = sb(pl.x, m.x), dy = sb(pl.y, m.y), dz = sb(pl.z, m.z);
      const d = sq(ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)));
      if (d < MONKEY.MELON_HIT) {
        const ry = Math.abs(run.nextRandom()), rx = run.nextRandom(), rz = Math.abs(run.nextRandom());   // drawn in the order y (fabs), x, z (fabs)
        const v = [rx, ry, rz];
        normalise3(v);                                          // FUN_0043cec0
        m.vx = v[0]; m.vy = v[1]; m.vz = v[2];
        if (walk && !walk.rolling) {
          run.sound.play('melonHit');
          walk.rolling = true; walk.rollAngle = 0;
          walk.score -= PLANE.SPIN_COST;
          if (walk.score < 0) walk.score = 0;
          run.stats.melonHits++;
        }
      }
    }
    this.clock++;
  }

  /** FUN_0070f6ec (the draw): the monkey turns to face the plane (forward = the direction to it, up = world up, right = their horizontal cross, FUN_0043cec0 on each) at twice its size */
  face(rec: GameRecord, pl: GameRecord) {
    const f = [sb(pl.x, rec.x), sb(pl.y, rec.y), sb(pl.z, rec.z)];
    normalise3(f);
    // right = up x forward with up = (0, 1, 0): (1 * fz - 0 * fy, 0 * fx - 0 * fz, 0 * fy - 1 * fx)
    const r = [sb(ml(1, f[2]), ml(0, f[1])), sb(ml(0, f[0]), ml(0, f[2])), sb(ml(0, f[1]), ml(1, f[0]))];
    normalise3(r);
    const k = this.drawScale;
    const m = rec.m;
    m[0] = ml(r[0], k); m[1] = ml(r[1], k); m[2] = ml(r[2], k);
    m[4] = 0; m[5] = k; m[6] = 0;
    m[8] = ml(f[0], k); m[9] = ml(f[1], k); m[10] = ml(f[2], k);
  }
}

const MELON_SCALE_M = new Float32Array([4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]);
/** the matrix of a melon for drawing: the spin about z (FUN_0043a4a1 rewrites the rotation of the matrix the throw made) and the place, then FUN_0043a9e5(.., melon, diag 4) (FUN_0070f6ec) */
export function melonMatrix(m: Melon): Float32Array {
  return matThen(MELON_SCALE_M, eulerMatrix(0, 0, m.spin, m.x, m.y, m.z));
}
void setRotation;
