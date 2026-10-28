// z40aPO: the obstacles and the canopy (behaviour nodes of 0x7d1429 .. 0x7d2fae): the spinning asteroids, the eight brickbot rockets that chase the pilot, the three
// rock monsters and the wing ("solaarwing") that opens at the pilot's pack.
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import { buildMatrix } from '../../formats/matrix.ts';
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

/** FUN_007d1778 / FUN_007d14b0: eight RKA and six RKB asteroids tumble: rx / ry += (rand(1) - 0.5) / 15 (RKA) or / 50 (RKB) per tick, chosen once at the start */
export class ApoAsteroids extends PropNode {
  readonly kind = 'ApoAsteroids';
  /** angular speeds (rx, ry) of the 8 + 6 records */
  readonly spin: [number, number][];
  constructor() {
    super();
    this.spin = [];
    for (let i = 0; i < 8; i++) this.spin.push([(rand(1) - 0.5) / 15, (rand(1) - 0.5) / 15]);
    for (let i = 0; i < 6; i++) this.spin.push([(rand(1) - 0.5) / 50, (rand(1) - 0.5) / 50]);
  }
  update(w: World): number {
    const R = apoRun(w).recs;
    [...R.rka, ...R.rkb].forEach((r, i) => {
      r.rx += this.spin[i][0] * w.dt;
      r.ry += this.spin[i][1] * w.dt;
      r.setEuler(r.rx, r.ry, r.rz, r.x, r.y, r.z);
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
export const BOT_LAUNCH: Vec3 = [38.6, 64.5, 54.1];     // 0x421a6666 / 0x42810000 / 0x42586666
export const BOT_PARK: Vec3 = [38.6, 3000, 54.1];       // the constructor parks every bot at y = 3000 (0x453b8000)

/**
 * FUN_007d2650 / FUN_007d19e0: eight rocket brickbots. While the pilot is above y = 500 a bot flies from the launch pad towards the point the pilot was at (2 units per
 * tick, re-aimed every 3 seconds while it is more than 100 below the pilot), for 30 s at most; anything it touches (except other bots, ring centres and the planet) blows it up
 * (30 ticks), then it is back at the pad.
 */
export class ApoBots extends PropNode {
  readonly kind = 'ApoBots';
  bots: Bot[] = Array.from({ length: 8 }, (_, i) => ({ aim: [0, 0, 0], flying: true, timer: 0, counter: i * 3, exploded: false }));
  private started = false;
  update(w: World): number {
    const run = apoRun(w), R = run.recs, snd = run.sound, dt = w.dt;
    const pil = R.pepp;
    if (!this.started) {
      this.started = true;
      R.bots.forEach((r, i) => { r.x = BOT_PARK[0]; r.y = BOT_PARK[1]; r.z = BOT_PARK[2]; r.savePrev(); this.bots[i].aim = [pil.x, pil.y, pil.z]; });
    }
    const start = R.bots.map((r) => [r.x, r.y, r.z] as Vec3);
    for (let i = 0; i < 8; i++) {
      const b = this.bots[i], r = R.bots[i];
      if (run.aborted) continue;
      if (!b.exploded) {
        if (!b.flying) {
          if (pil.y <= 500) r.hide();
          else {
            b.flying = true;
            r.x = BOT_LAUNCH[0]; r.y = BOT_LAUNCH[1]; r.z = BOT_LAUNCH[2];
            b.aim = [pil.x, pil.y, pil.z];
          }
        } else {
          const cur: Vec3 = [r.x, r.y, r.z];
          const d: Vec3 = [cur[0] - b.aim[0], cur[1] - b.aim[1], cur[2] - b.aim[2]];
          b.timer += 1 * dt;
          if (30 <= b.timer) { b.counter += 1; b.timer = 0; }
          if (b.counter < 30) {
            if (ftol(b.counter) % 3 === 0 && b.timer === 0 && cur[1] < pil.y - 100) b.aim = [pil.x, pil.y, pil.z];
            const l = Math.hypot(d[0], d[1], d[2]) || 1;
            const step = -(2 * dt);
            cur[0] += (d[0] / l) * step; cur[1] += (d[1] / l) * step; cur[2] += (d[2] / l) * step;
            r.ry += 0.3 * dt;
            r.setEuler(r.rx, r.ry, r.rz, cur[0], cur[1], cur[2]);
          } else { b.flying = false; b.timer = 0; b.counter = 0; }
        }
      } else {
        b.timer += 1 * dt;
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
      const delta: Vec3 = [start[i][0] - cur[0], start[i][1] - cur[1], start[i][2] - cur[2]];
      const hit = w.col.sweep(r, cur, delta, 3, 1.2, 1.2);
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
        const d = Math.hypot(pil.x - r.x, pil.y - r.y, pil.z - r.z);
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
          r.anim?.advance(1);
        } else {
          r.ry += 0.06 * dt;
          r.setEuler(r.rx, r.ry, r.rz, r.x, r.y, r.z);
        }
      }
    });
    return NODE_STOP;
  }
}

/** FUN_007d2fae / FUN_007d2dd8: the wing opens (scale 0 -> 0.6, +0.05 per tick) when the pilot opens it, tilted 30 degrees more than the pilot, and closes after the landing */
export class ApoWing extends PropNode {
  readonly kind = 'ApoWing';
  scale = 0;
  update(w: World, rec: GameRecord): number {
    const run = apoRun(w);
    const R = run.recs, pep = R.pepp;
    let pos: number[] = [pep.x, pep.y, pep.z];
    const pose = pep.anim?.pose(1);
    if (pose && pose.length >= 9 * 16) pos = pep.toWorld([pose[8 * 16 + 12], pose[8 * 16 + 13], pose[8 * 16 + 14]]);
    if (run.canopy === 1) { this.scale += 0.05 * w.dt; if (0.6 < this.scale) this.scale = 0.6; }
    if (run.canopy === 2) { this.scale -= 0.05 * w.dt; if (this.scale < 0) this.scale = 0; }
    rec.m.set(buildMatrix(pep.rx + 0.523596, pep.ry, pep.rz, pos[0], pos[1], pos[2], this.scale, this.scale, this.scale));
    rec.scale = [this.scale, this.scale, this.scale];
    if (this.scale <= 0) rec.flags |= 0x8000; else rec.flags &= ~0x8000;
    const sh = R.shad;
    if (sh) {
      if (run.shadowOn) {
        const g = run.groundHit;
        sh.m.set(buildMatrix(0, Math.atan2(rec.m[8], rec.m[10]), 0, g[0], g[1] + 0.4 * 8, g[2], 2.05, 2.05, 2.05));
        sh.show();
      } else sh.hide();
    }
    return NODE_STOP;
  }
}

/** FUN_007d1429: the sky sphere (SKY1); its update does nothing, its draw hook puts it behind everything (viewport depth 0), which the renderer does for the zone */
export class ApoSky extends PropNode {
  readonly kind = 'ApoSky';
  update(): number { return NODE_STOP; }
}
