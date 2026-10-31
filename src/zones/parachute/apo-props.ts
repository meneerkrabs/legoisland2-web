// z40aPO: the obstacles and the canopy (behaviour nodes of 0x7d1429 .. 0x7d2fae): the spinning asteroids, the eight brickbot rockets that chase the pilot, the three
// rock monsters and the wing ("solaarwing") that opens at the pilot's pack.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { toWorld as toWorldExact } from '../exact.ts';
import { apoRun } from './apo-run.ts';
import type { ApoSound } from './apo-run.ts';
import { ftol, rand } from './util.ts';
import type { Vec3 } from './util.ts';

abstract class PropNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord): number;
}

const f = Math.fround;

/** FUN_0043cec0: the float32 normalise (the sum of squares and the reciprocal length are stored as floats; a zero vector stays as it is) */
function normalize32(v: Vec3): Vec3 {
  const sq = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));      // (24-bit x87: every operation rounds; the machine code adds x, y, z)
  if (sq === 0) return [v[0], v[1], v[2]];
  const k = f(1 / f(Math.sqrt(sq)));
  return [f(k * v[0]), f(k * v[1]), f(k * v[2])];
}

/** FUN_007d1778 / FUN_007d14b0: eight RKA and six RKB asteroids tumble: rx / ry += (rand(1) - 0.5) / 15 (RKA) or / 50 (RKB) per tick, chosen once at the start (float32 node fields, float32 angles) */
export class ApoAsteroids extends PropNode {
  readonly kind = 'ApoAsteroids';
  /** angular speeds (rx, ry) of the 8 + 6 records */
  readonly spin: [number, number][];
  constructor() {
    super();
    this.spin = [];
    // the constructor draws rx then ry of one record at a time (the argument-less FUN_004388ae(1.0) calls alternate)
    for (let i = 0; i < 8; i++) this.spin.push([f(f(rand(1) - 0.5) / 15), f(f(rand(1) - 0.5) / 15)]);
    for (let i = 0; i < 6; i++) this.spin.push([f(f(rand(1) - 0.5) / 50), f(f(rand(1) - 0.5) / 50)]);
  }
  update(w: World): number {
    const R = apoRun(w).recs;
    [...R.rka, ...R.rkb].forEach((r, i) => {
      const x = r.x, y = r.y, z = r.z;
      r.rx = f(f(this.spin[i][0] * w.dt) + r.rx);
      r.ry = f(f(this.spin[i][1] * w.dt) + r.ry);
      r.setEuler(r.rx, r.ry, r.rz, x, y, z);
    });
    return NODE_STOP;
  }
}

/** per brickbot (stride 0x28 of DAT_05d5eed0) */
export interface Bot {
  /** aim point (the pilot's position when it was last aimed at) */
  aim: Vec3;
  /** DAT_05d5eee8: 1 = in flight, 0 = waiting at the launch pad */
  flying: boolean;
  timer: number; counter: number;
  /** DAT_05d5eef4: exploded */
  exploded: boolean;
}
export const BOT_LAUNCH: Vec3 = [f(38.6), f(64.5), f(54.1)];     // 0x421a6666 / 0x42810000 / 0x42586666
export const BOT_PARK: Vec3 = [f(38.6), 3000, f(54.1)];       // the constructor parks every bot at y = 3000 (0x453b8000)

/**
 * FUN_007d2650 / FUN_007d19e0: eight rocket brickbots. While the pilot is above y = 500 a bot flies from the launch pad towards the point the pilot was at (2 units per
 * tick, re-aimed every 3 seconds while it is more than 100 below the pilot), for 30 s at most; anything it touches (except other bots, ring centres and the planet) blows it up
 * (30 ticks), then it is back at the pad. The constructor parks every bot at (38.6, 3000, 54.1) in flight (flag 1, timer 0, counter 3 i) aimed at the pilot's start position.
 */
export class ApoBots extends PropNode {
  readonly kind = 'ApoBots';
  bots: Bot[] = Array.from({ length: 8 }, (_, i) => ({ aim: [0, 0, 0], flying: true, timer: 0, counter: i * 3, exploded: false }));
  /** FUN_007d2650's record writes (the zone game calls this once the pilot is placed: its position is the first aim) */
  park(w: World) {
    const R = apoRun(w).recs;
    R.bots.forEach((r, i) => { r.x = BOT_PARK[0]; r.y = BOT_PARK[1]; r.z = BOT_PARK[2]; r.savePrev(); this.bots[i].aim = [R.pepp.x, R.pepp.y, R.pepp.z]; });
  }
  private parked = false;
  update(w: World): number {
    const run = apoRun(w), R = run.recs, snd = run.sound, dt = w.dt;
    const pil = R.pepp;
    if (!this.parked) { this.parked = true; this.park(w); }
    const start = R.bots.map((r) => [r.x, r.y, r.z] as Vec3);
    for (let i = 0; i < 8; i++) {
      const b = this.bots[i], r = R.bots[i];
      if (run.aborted) continue;
      if (!b.exploded) {
        if (!b.flying) {
          if (pil.y <= 500) { r.hide(); run.fx?.rocketGate(i, false); }     // FUN_00442a20(rocket01, 1, 1, 1)
          else {
            run.fx?.rocketGate(i, true);                                        // (2, 1, 1) at the launch (after the record writes in the original: no effect on the emitter)
            b.flying = true;
            r.x = BOT_LAUNCH[0]; r.y = BOT_LAUNCH[1]; r.z = BOT_LAUNCH[2];
            b.aim = [pil.x, pil.y, pil.z];
          }
        } else {
          const cur: Vec3 = [r.x, r.y, r.z];
          const d: Vec3 = [f(cur[0] - b.aim[0]), f(cur[1] - b.aim[1]), f(cur[2] - b.aim[2])];
          b.timer = f(1 * dt + b.timer);
          if (30 <= b.timer) { b.counter = f(b.counter + 1); b.timer = 0; }
          if (b.counter < 30) {
            if (ftol(b.counter) % 3 === 0 && b.timer === 0 && cur[1] < f(pil.y - 100)) b.aim = [pil.x, pil.y, pil.z];
            // FUN_0043cec0: normalise (float32 stores), then times -(2 * dt)
            const n: Vec3 = normalize32(d);
            const k = -(2 * dt);
            cur[0] = f(cur[0] + f(k * n[0])); cur[1] = f(cur[1] + f(k * n[1])); cur[2] = f(cur[2] + f(k * n[2]));
            r.ry = f(f(f(0.3) * dt) + r.ry);
            r.setEuler(r.rx, r.ry, r.rz, cur[0], cur[1], cur[2]);
          } else { b.flying = false; b.timer = 0; b.counter = 0; }
        }
      } else {
        b.timer = f(1 * dt + b.timer);
        if (30 <= b.timer) {
          r.flags = 2;
          b.exploded = false; b.flying = false; b.timer = 0; b.counter = 0;
          r.x = BOT_LAUNCH[0]; r.y = BOT_LAUNCH[1]; r.z = BOT_LAUNCH[2];     // back at the pad (38.6, 64.5, 54.1)
        }
      }
    }
    // what did each bot run into? anything but another bot ("BB"), a ring centre ("RC") or the planet ("OGEL")
    for (let i = 0; i < 8; i++) {
      const b = this.bots[i], r = R.bots[i];
      if (b.exploded) continue;
      const cur: Vec3 = [r.x, r.y, r.z];
      const delta: Vec3 = [f(start[i][0] - cur[0]), f(start[i][1] - cur[1]), f(start[i][2] - cur[2])];
      const hit = w.col.sweep(r, cur, delta, 3, f(1.2), f(1.2));
      if (hit && !hit.rec.name.startsWith('BB') && !hit.rec.name.startsWith('RC') && !hit.rec.name.startsWith('OGEL')) {
        r.hide();
        b.exploded = true; b.timer = 0; b.counter = 0;
      }
    }
    R.bots.forEach((r, i) => { if (r.y > 500) snd.at(`rocket${i}` as ApoSound, [r.x, r.y, r.z]); });
    return NODE_STOP;
  }
}

/** FUN_007d2bf2 / FUN_007d28e0: three rock monsters (ROC1 .. ROC3, rig ROCK.blk): asleep until the pilot is within 80, then they growl through their 30 frame clip and spin on */
export class ApoRockMonsters extends PropNode {
  readonly kind = 'ApoRockMonsters';
  awake = [false, false, false];
  private started = false;
  update(w: World, rec: GameRecord): number {
    const run = apoRun(w), R = run.recs, snd = run.sound, dt = w.dt;
    if (!this.started) { this.started = true; for (const r of R.rocks) r.anim?.start(2, 0); }
    const pil = R.pepp;
    R.rocks.forEach((r, i) => {
      if (!this.awake[i]) {
        const dx = f(pil.x - r.x), dy = f(pil.y - r.y), dz = f(pil.z - r.z);
        const d = f(Math.sqrt(dz * dz + dy * dy + dx * dx));
        if (d < 80) {
          if (!run.monstersWoke) run.speak('OGSGPO08');
          run.monstersWoke = true;
          this.awake[i] = true;
        }
      } else {
        const frame = r.anim ? ftol(r.anim.frame) : 99;
        if (frame < 30) {
          // the sound test compares the node's own record (ROC1: the node is attached to it) with "ROC1" / "ROC2" / "ROC3": always the first slot
          const name = rec.name;
          const slot: ApoSound = name.startsWith('ROC1') ? 'rockMonster1' : name.startsWith('ROC2') ? 'rockMonster2' : 'rockMonster3';
          snd.at(slot, [rec.x, rec.y, rec.z]);
          r.anim?.advance(1, dt);
        } else {
          const x = r.x, y = r.y, z = r.z;
          r.ry = f(f(0.06) * dt + r.ry);
          r.setEuler(r.rx, r.ry, r.rz, x, y, z);
        }
      }
    });
    return NODE_STOP;
  }
}

/**
 * FUN_007d2fae / FUN_007d2dd8 (the draw hook): the wing opens (scale 0 -> 0.6, +0.05 per tick) when the pilot opens it, tilted 0.523596 rad more than the pilot, and closes after the
 * landing. The matrix is built from the scale of the previous frame (the scale moves on after it).
 */
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export class ApoWing extends PropNode {
  readonly kind = 'ApoWing';
  scale = 0;
  /**
   * FUN_007d2cf0 (first thing the wing's draw hook FUN_007d2dd8 does): while the pilot glides the SHAD record is drawn with the live vertices `run.shadow` and the z test OFF (FUN_0040cc4d(0)
   * around FUN_00444480, flag 2 set only for that draw). The zone game installs the draw call (`GameRenderer.drawRecordLive`); 0 = the default draw of the wing goes on.
   */
  drawShadow: ((rec: GameRecord, verts: Float32Array) => void) | null = null;
  draw(w: World, rec: GameRecord): number {
    const run = apoRun(w);
    if (run.shadowOn && run.recs.shad) this.drawShadow?.(run.recs.shad, run.shadow);
    return 0;
  }
  update(w: World, rec: GameRecord): number {
    const run = apoRun(w);
    const R = run.recs, pep = R.pepp;
    let pos: number[] = [pep.x, pep.y, pep.z];
    const pose = pep.anim?.pose(1);
    if (pose && pose.length >= 9 * 16) pos = toWorldExact(pep.m, [pose[8 * 16 + 12], pose[8 * 16 + 13], pose[8 * 16 + 14]]);   // FUN_0043ab72 at 24 bit
    // FUN_007d2cf0 (the shadow patch of the glide) comes first, then the matrix with the scale of this moment, then the scale moves on (DAT_05d5ee64: 1 opening, 2 closing)
    const sh = R.shad;
    if (sh) {
      // while DAT_05d5f208 (the pilot glides) the SHAD record (identity matrix, position zeroed by the pilot's constructor) is drawn by the hook with its five vertices set to the shadow points
      // of FUN_00442a70 (`run.shadow`): a patch that follows the terrain. The hook sets flag 2, draws and clears it again: the record is never enabled between the draws (`ApoWing.draw`)
      if (run.shadowOn) sh.m.set(IDENTITY);
      sh.hide();
    }
    const s = this.scale;
    rec.m.set(buildMatrix(f(pep.rx + f(0.523596)), pep.ry, pep.rz, pos[0], pos[1], pos[2], s, s, s));
    rec.scale = [s, s, s];
    if (run.canopy === 1) { this.scale = f(f(0.05) * w.dt + this.scale); if (f(0.6) < this.scale) this.scale = f(0.6); }
    if (run.canopy === 2) { this.scale = f(this.scale - f(0.05) * w.dt); if (this.scale < 0) this.scale = 0; }
    if (this.scale <= 0) rec.flags |= 0x8000; else rec.flags &= ~0x8000;
    return NODE_STOP;
  }
}

/** FUN_007d1429: the sky sphere (SKY1); its update does nothing, its draw hook puts it behind everything (viewport depth 0), which the renderer does for the zone */
export class ApoSky extends PropNode {
  readonly kind = 'ApoSky';
  update(): number { return NODE_STOP; }
}
