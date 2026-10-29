// z22BIP: the rock monsters ROC1 .. ROC5, the node "Rocky" (constructor FUN_0070cfd8, update FUN_0070ca17, stones FUN_0070c5f0 / FUN_0070c774 / FUN_0070c998, draw
// FUN_0070cdba). A rock watches the plane: within 84.8 (squared 7200) it attacks (clip 1) and throws a stone along its facing when the clip passes frame 87, at
// 84.8 .. 98 it plays clip 4, further away the idle clip 3. A banana within 8 of the rock scores 100 and sends it into its hit clip (2); a stone that touches the
// plane spins it out (-100).
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { bipRun, f32, REC } from './run.ts';
import { PLANE } from './plane.ts';
import { buildMatrix } from '../../formats/matrix.ts';

const F = Math.fround;
export const CTOR_ROCKY = 0x70cfd8;

export const ROCKY = {
  NEAR2: 7200, FAR2: 9600,      // 0x932124 / 0x932120 (squared distances, ints)
  THROW_FRAME: 87,              // 0x932138
  HIT_R: 8,                     // 0x932128
  HIT_SCORE: 100,
  STONES: 10, STONE_LIFE: 300,  // 0x93212c
  GRAVITY: f32(0xbd23d70a),     // 0x932130: -0.04 per tick
  LOB: 20,                      // 0x89237c: the throw is lifted by 0.04 * 20
  EYE: 8,                       // 0x892090: the stone starts 8 above the rock
  SPIN: f32(0x3ecccccd),        // FUN_004388ae(0.4) per axis
  STONE_RADIUS: f32(0x3fcccccd),// sweep radius / skin 1.6
  BOUNCE_Y: 0.6,                // double 0x892770
  STONE_SCALE: 2,
} as const;

/** `dax..daz`: the angles the draw (FUN_0070cdba) uses this tick: it draws with `ax..az` and only then adds the spin rates (the port adds them in the update) */
export interface Stone { active: boolean; vx: number; vy: number; vz: number; x: number; y: number; z: number; life: number; ax: number; ay: number; az: number; sx: number; sy: number; sz: number; dax: number; day: number; daz: number }
const newStone = (): Stone => ({ active: false, vx: 0, vy: 0, vz: 0, x: 0, y: 0, z: 0, life: 0, ax: 0, ay: 0, az: 0, sx: 0, sy: 0, sz: 0, dax: 0, day: 0, daz: 0 });

export class RockyNode implements BehaviourNode {
  readonly kind = 'Rocky';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;

  /** +0x24: 0 far (clip 3), 1 near (clip 1: throws), 2 medium (clip 4), 3 hit (clip 2) */
  state = 0;
  /** +0x34: this attack's stone has been thrown */
  thrown = false;
  stones: Stone[] = Array.from({ length: ROCKY.STONES }, newStone);
  private inited = false;

  update(w: World, rec: GameRecord): number {
    const run = bipRun(w);
    if (!this.inited) { this.inited = true; rec.anim?.start(3, 0); }
    const pl = w.records[REC.PLANE], walk = run.plane;
    const anim = rec.anim;
    // `dist` is the original's `local_14`: the plane's squared distance (float32) ... overwritten by the (not squared) distance of every ACTIVE banana in the loop below (a hit
    // or not), so the next state is chosen from the distance of the last active banana whenever one is in the air
    let dist = F(F(F(rec.x - pl.x) * F(rec.x - pl.x)) + F(F(rec.y - pl.y) * F(rec.y - pl.y)) + F(F(rec.z - pl.z) * F(rec.z - pl.z)));
    if (this.state !== 3 && walk) {
      for (const bn of walk.bananas) {
        if (!bn.active) continue;
        const dx = F(bn.x - rec.x), dy = F(bn.y - rec.y), dz = F(bn.z - rec.z);
        dist = F(Math.sqrt(dx * dx + dy * dy + dz * dz));
        if (dist < ROCKY.HIT_R && this.state !== 2) {
          anim?.start(2, 0);
          this.state = 3;
          walk.score += ROCKY.HIT_SCORE;
        }
      }
    }
    const next = () => this.pick(rec, dist);
    switch (this.state) {
      case 0: if (anim && anim.advance(1, w.dt) !== 0) this.state = next(); break;
      case 1:
        if (anim && anim.advance(1, w.dt) !== 0) this.state = next();
        if (anim && ROCKY.THROW_FRAME < anim.frame && !this.thrown) {
          run.sound.at('rmChuck', [rec.x, rec.y, rec.z]);
          this.spawn(run, rec);
          this.thrown = true;
        }
        break;
      case 2: if (anim && anim.advance(1, w.dt) !== 0) this.state = next(); break;
      case 3:
        if (anim && anim.advance(1, w.dt) !== 0) {
          run.sound.at('rmSmack', [rec.x, rec.y, rec.z]);
          this.state = 0;
          anim.seek(anim.frameCount - 1);
        }
        break;
    }
    this.moveStones(w, rec);
    return NODE_STOP;
  }

  /** FUN_0070c998: the next state from the squared distance to the plane (and the clip that goes with it) */
  private pick(rec: GameRecord, d2: number): number {
    const a = rec.anim;
    if (ROCKY.NEAR2 <= d2) {
      if (ROCKY.FAR2 <= d2) { a?.start(3, 0); return 0; }
      a?.start(4, 0); return 2;
    }
    a?.start(1, 0); this.thrown = false; return 1;
  }

  /** FUN_0070c5f0: a stone from 8 above the rock along its forward row, lifted a little */
  private spawn(run: ReturnType<typeof bipRun>, rec: GameRecord) {
    for (const s of this.stones) {
      if (s.active) continue;
      s.active = true;
      s.x = rec.x; s.y = F(rec.y + ROCKY.EYE); s.z = rec.z;
      s.vx = F(1 * rec.m[8]); s.vy = F(1 * rec.m[9]); s.vz = F(1 * rec.m[10]);
      s.vy = F(s.vy - F(ROCKY.GRAVITY * ROCKY.LOB));
      s.life = ROCKY.STONE_LIFE;
      s.sx = F(run.crt.float(ROCKY.SPIN)); s.sy = F(run.crt.float(ROCKY.SPIN)); s.sz = F(run.crt.float(ROCKY.SPIN));
      s.ax = s.ay = s.az = 0;
      return;
    }
  }

  /** FUN_0070c774: gravity, a sweep along the velocity (radius 1.6), a bounce that costs the plane 100 points when it is the plane, then the step; the stone lives 300 ticks and dies below y = 0 */
  private moveStones(w: World, rec: GameRecord) {
    const run = bipRun(w), walk = run.plane, plane = w.records[REC.PLANE], dt = w.dt;
    for (const s of this.stones) {
      if (!s.active) continue;
      s.vy = F(F(ROCKY.GRAVITY * dt) + s.vy);
      const hit = w.col.sweep(rec, [s.x, s.y, s.z], [s.vx, s.vy, s.vz], 3, ROCKY.STONE_RADIUS, ROCKY.STONE_RADIUS);
      if (hit) {
        s.vx = F(s.vx * -1); s.vy = F(s.vy * -1); s.vz = F(s.vz * -1);
        s.vy = F(s.vy * ROCKY.BOUNCE_Y);
        if (hit.rec === plane && walk && !walk.rolling) {
          walk.rolling = true; walk.rollAngle = 0;
          walk.score -= PLANE.SPIN_COST;
          if (walk.score < 0) walk.score = 0;
          run.stats.stoneHits++;
          run.cue?.('bip-stone-hit', [s.x, s.y, s.z]);
        }
      }
      s.x = F(s.x + s.vx); s.y = F(s.y + s.vy); s.z = F(s.z + s.vz);
      s.life = Math.trunc(s.life - dt);
      if (s.life < 1 || s.y <= 0) { s.active = false; continue; }
      s.dax = s.ax; s.day = s.ay; s.daz = s.az;          // the draw uses these, then turns the stone
      s.ax = F(s.ax + s.sx); s.ay = F(s.ay + s.sy); s.az = F(s.az + s.sz);
    }
  }
}

/** the matrix of a stone for drawing: scale 2, then the spin and the place (FUN_0070cdba) */
export function stoneMatrix(s: Stone): Float32Array {
  const r = buildMatrix(s.dax, s.day, s.daz, s.x, s.y, s.z);
  for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10]) r[i] *= ROCKY.STONE_SCALE;
  return r;
}
