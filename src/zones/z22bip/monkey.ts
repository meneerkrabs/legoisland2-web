// z22BIP: the monkeys (MNK0 .. MNKF), the node "monkey" (constructor FUN_0070fafb with the table at 0x931aa0, update FUN_0070f433, draw FUN_0070f6ec, the melons
// FUN_0070f2be / FUN_0070efc0). A monkey wakes up when the plane is within 160 units (square, then a circle of 160), plays its throwing clip and hurls a melon at the
// plane three times per loop of the clip (frames 15, 35, 54) while the plane flies above 320; a melon that touches the plane (within 6.4) spins it out (-100
// points). A banana that reaches a monkey scores 700 (the plane's FUN_00709258 sets its state to 2: the hit clip, then 3: dazed until the plane leaves).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { bipRun, f32, msClock, REC } from './run.ts';
import { setRotation } from './plane.ts';
import { PLANE } from './plane.ts';
import { buildMatrix } from '../../formats/matrix.ts';

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
    anim?.advance(1);
    const frame = Math.trunc(anim?.frame ?? 0);
    if (this.state === 1) {
      // a chatter sound now and then (ftol(FUN_004388ae(GetTickCount - start)) % 90 hits one of three values)
      const r = Math.trunc(run.crt.float(msClock(w))) % MONKEY.CHATTER_MOD;
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
      const v = [F(pl.x - rec.x), F(pl.y - rec.y), F(pl.z - rec.z)];
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      m.vx = F(v[0] / l); m.vy = F(v[1] / l); m.vz = F(v[2] / l);
      run.sound.at('chimpThrow', [rec.x, rec.y, rec.z]);
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
      m.x = F(F(m.vx * MONKEY.MELON_STEP) + m.x); m.y = F(F(m.vy * MONKEY.MELON_STEP) + m.y); m.z = F(F(m.vz * MONKEY.MELON_STEP) + m.z);
      m.spin = F(m.spin + MONKEY.MELON_SPIN);
      const d = Math.hypot(F(pl.x - m.x), F(pl.y - m.y), F(pl.z - m.z));
      if (d < MONKEY.MELON_HIT) {
        const vy = Math.abs(run.nextRandom()), vx = run.nextRandom(), vz = Math.abs(run.nextRandom());
        const l = Math.hypot(vx, vy, vz) || 1;
        m.vx = F(vx / l); m.vy = F(vy / l); m.vz = F(vz / l);
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

  /** FUN_0070f6ec (the draw): the monkey turns to face the plane (forward = the direction to it, up = world up, right = their horizontal cross) at twice its size */
  private face(rec: GameRecord, pl: GameRecord) {
    const d = [pl.x - rec.x, pl.y - rec.y, pl.z - rec.z];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    const f = [d[0] / l, d[1] / l, d[2] / l];
    const r = [f[2], 0, -f[0]], rl = Math.hypot(r[0], r[2]) || 1;
    const k = this.drawScale;
    const m = rec.m;
    m[0] = F(r[0] / rl * k); m[1] = 0; m[2] = F(r[2] / rl * k);
    m[4] = 0; m[5] = k; m[6] = 0;
    m[8] = F(f[0] * k); m[9] = F(f[1] * k); m[10] = F(f[2] * k);
  }
}

/** the matrix of a melon for drawing: the spin about z (FUN_0043a4a1 rewrites the rotation of the matrix the throw made with the yaw 0x40afeda2 on the first update) and the place, scaled by 4 (FUN_0070f6ec: FUN_0043a9e5(.., melon, diag 4)) */
export function melonMatrix(m: Melon): Float32Array {
  const r = buildMatrix(0, 0, m.spin, m.x, m.y, m.z);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) r[i] *= MONKEY.MELON_SCALE;
  return r;
}
void setRotation;
