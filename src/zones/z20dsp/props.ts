// The obstacles and pickups of z20DSP (one behaviour node each, docs/re/m6/z20DSP.md section 6):
//   falling (COW0..2)   FUN_006bfc10  cows hanging in the sky that drop when the car comes within 160
//   turbo   (TURB, TIME) FUN_006c00f0  the spinning pickup bricks (the Speedster hides them when it hits them)
//   WalkRock (RO01..05)  FUN_006c0250  a Brickbot rolls a rock at the track when the car is within 192
//   Bertha  (BIGB)       FUN_006c0b70  the big fish that jumps out of the oasis for the medal
//   Spin    (SPN0 / SPN1) FUN_006c0d50 debris orbiting the whirlwind
//   ScrCone (CON0..2)    FUN_006c1060  the tractor beam under a saucer (shrinks the car)
//   Saucer  (SCR0..2)    FUN_006c1630  the flying saucers on their ellipses
//   whirlwnd (WHRL)      FUN_006c1990  the twister on a Lissajous path that pulls the car and spins it
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { euler24, eulerScaled24, normalize24 } from '../common/x87.ts';
import { mulGame } from '../../render/math.ts';
import { DspShared, SND, VAR, terrain } from './shared.ts';

/** constructor addresses of the attaches of FUN_006be930 */
export const CTOR = {
  FALLING: 0x6bff0e, TURBO: 0x6c01ba, WALKROCK: 0x6c07d4, BERTHA: 0x6c0c7e, SPIN: 0x6c0f81, SCRCONE: 0x6c1524, SAUCER: 0x6c1856, WHIRLWIND: 0x6c1d79,
} as const;

const f32 = Math.fround;
const HALF_PI = 1.5707963705062866;

export abstract class PropNode implements BehaviourNode {
  abstract readonly kind: string;
  var = 2; mask = 0; value = 0;
  stamp = 0xfffffffe;
  shared!: DspShared;
  abstract update(w: World, rec: GameRecord, c: Controller): number;
  /** the constructor part that needs the world / the records (run by the zone's `prepare`) */
  abstract bind(shared: DspShared, w: World, rec: GameRecord): void;
}

const car = (sh: DspShared) => sh.rec(38);

/** the terrain height under (x, z) from 4 above y (FUN_0043ce45 against the ground record), NO_GROUND = -1e38 */
const ground = (w: World, x: number, y: number, z: number) => terrain(w, x, y, z, 4.0);

// ------------------------------------------------------------------ falling (FUN_006bff0e / FUN_006bfc10)
export class FallingNode extends PropNode {
  readonly kind = 'falling';
  /** +0x14 ground height, +0x18 trigger radius, +0x1c / +0x20 / +0x24 the cow's place, +0x28 state, +0x2c current y, +0x30 vertical speed */
  groundY = 0; radius = 160; x = 0; y = 0; z = 0; state = 0; curY = 0; vy = 0;
  bind(sh: DspShared, w: World, rec: GameRecord) {
    this.shared = sh;
    this.x = rec.x; this.y = rec.y; this.z = rec.z;
    this.groundY = ground(w, rec.x, rec.y, rec.z);                 // FUN_004425e0(LAND); FUN_0043ce45(pos, 4.0); FUN_004425e0(0)
    this.curY = f32(this.groundY + 80.0);
    this.state = 0; this.vy = 0;
    rec.anim?.start(4, 0);
  }
  update(w: World, rec: GameRecord): number {
    const sh = this.shared;
    if (!sh?.world) return 2;      // not prepared (generic stub test)
    const pep = car(sh);
    if (this.state === 0) {
      const dx = f32(rec.x - pep.x), dz = f32(rec.z - pep.z), r = this.radius;
      if (-r < dx && dx < r && -r < dz && dz < r && f32(f32(dz * dz) + f32(dx * dx)) < f32(r * r)) {
        rec.anim?.start(4, 0);
        this.state = 1; rec.flags |= RF_ENABLED; this.vy = 0;
      }
    } else if (this.state === 1) {
      this.curY = f32(this.curY + this.vy);
      this.vy = f32(this.vy - 0.3199999928474426);
      rec.anim?.advance(1.0);
      if (this.curY < this.groundY) {
        sh.sounds.play(sh.rng.int(2) === 0 ? SND.COW2 : SND.COW1);
        rec.anim?.start(3, 0);
        this.curY = this.groundY; this.state = 2;
      }
    } else if (this.state === 2) {
      if (rec.anim && rec.anim.advance(1.0) !== 0) { rec.anim.start(2, 0); this.state = 3; }
    } else if (rec.anim && rec.anim.advance(1.0) !== 0) rec.anim.start(2, 0);
    rec.m[13] = this.curY;
    return NODE_CONTINUE;
  }
}

// ------------------------------------------------------------------ turbo (FUN_006c01ba / FUN_006c00f0)
export class TurboNode extends PropNode {
  readonly kind = 'turbo';
  bind(sh: DspShared, _w: World, rec: GameRecord) { this.shared = sh; rec.ry = 0; }
  update(_w: World, rec: GameRecord): number {
    rec.ry = f32(rec.ry + 0.06981279700994492);
    const m = euler24(0, rec.ry, 0, rec.x, rec.y, rec.z);
    rec.m.set(m);
    return NODE_CONTINUE;
  }
}

// ------------------------------------------------------------------ Bertha (FUN_006c0c7e / FUN_006c0b70 / FUN_006c0d09)
export class BerthaNode extends PropNode {
  readonly kind = 'Bertha';
  bind(sh: DspShared, _w: World, rec: GameRecord) {
    this.shared = sh;
    rec.flags &= ~RF_ENABLED;
    sh.bertha = { show: (clip) => this.show(rec, clip) };
  }
  /** FUN_006c0d09(record, clip): the fish appears, plays the clip and splashes */
  show(rec: GameRecord, clip: number) {
    rec.flags |= RF_ENABLED;
    rec.anim?.start(clip, 0);
    this.shared.sounds.play(SND.FISHSPLASH);
  }
  update(_w: World, rec: GameRecord): number {
    if ((rec.flags & RF_ENABLED) !== 0 && rec.anim) {
      if (rec.anim.advance(1.0) !== 0) {
        rec.flags &= ~RF_ENABLED;
        rec.anim.start(0, 0);
        this.shared.sounds.play(SND.FISHSPLASH);
      }
    }
    return NODE_CONTINUE;
  }
}

// ------------------------------------------------------------------ Spin (FUN_006c0f81 / FUN_006c0d50)
export class SpinNode extends PropNode {
  readonly kind = 'Spin';
  /** +0x14 the whirlwind record, +0x18 / +0x1c phase, +0x20 radius, +0x24 / +0x28 / +0x2c Euler spin, +0x30 / +0x34 / +0x38 the place */
  whirl!: GameRecord; phase0 = 0;
  phase = 0; radius = 0; rx = 0; ry = 0; rz = 0; px = 0; py = 0; pz = 0;
  constructor(phase0: number) { super(); this.phase0 = phase0; }
  bind(sh: DspShared, w: World, rec: GameRecord) {
    this.shared = sh; this.whirl = w.records[58];
    rec.variant = this.whirl.variant;
    this.phase = this.phase0; this.radius = 0; this.rx = 0; this.ry = 0; this.rz = 0;
  }
  update(w: World, rec: GameRecord): number {
    const wh = this.whirl, dt = w.dt;
    rec.variant = wh.variant;
    const orbit = f32(this.radius * 0.25);
    this.px = f32(f32(f32(Math.cos(this.phase)) * orbit) + wh.x);          // FUN_0085d374 = cos, FUN_0085d1c4 = sin
    this.py = f32(wh.y + this.radius);
    this.pz = f32(f32(f32(Math.sin(this.phase)) * orbit) + wh.z);
    this.radius = f32(f32(Math.cos(f32(this.phase * 0.25)) * 8.0) + 24.0);
    const dphi = f32(f32(this.radius * 0.125) * 0.06981279700994492);
    if (this.radius <= 40.0) this.phase = f32(f32(dphi * dt) + this.phase); else this.radius = 40.0;
    this.rx = f32(f32(0.06981279700994492 * dt) + this.rx);
    this.rz = f32(f32(0.05235959589481354 * dt) + this.rz);
    rec.m.set(euler24(this.rx, this.ry, this.rz, this.px, this.py, this.pz));
    return NODE_CONTINUE;
  }
}

// ------------------------------------------------------------------ Saucer (FUN_006c1856 / FUN_006c1630) and ScrCone (FUN_006c1524 / FUN_006c1060)
/** the argument blocks of FUN_006be930 (DAT_05d5c180 ..): [sound flag, a, b, c, speed] per saucer; the saucer orbits on x = sin(t + ry0) * a + x0, z = cos(t + ry0) * c + z0 */
export const SAUCER_ARGS: Record<number, { sound: number; ax: number; az: number; speed: number }> = {
  29: { sound: 0, ax: -20.0, az: 12.0, speed: 0.10471919178962708 },    // SCR0: 0xc1a00000 / 0x41400000 / 0x3dd67704
  27: { sound: 1, ax: 8.0, az: 28.0, speed: 0.10471919178962708 },      // SCR1: 0x41000000 / 0x41e00000
  28: { sound: 0, ax: 20.0, az: -12.0, speed: 0.10471919178962708 },    // SCR2: 0x41a00000 / 0xc1400000
};
export class SaucerNode extends PropNode {
  readonly kind = 'Saucer';
  x0 = 0; y0 = 0; z0 = 0; ry0 = 0; ax = 0; az = 0; speed = 0; sound = 0;
  /** +0x38 tilt, +0x3c spin, +0x40 orbit phase */
  tilt = 0.1745319962501526; spin = 0; orbit = 0;
  index: number;
  constructor(index: number) { super(); this.index = index; }
  bind(sh: DspShared, _w: World, rec: GameRecord) {
    this.shared = sh;
    const a = SAUCER_ARGS[this.index];
    this.x0 = rec.x; this.y0 = rec.y; this.z0 = rec.z; this.ry0 = rec.ry;
    this.ax = a.ax; this.az = a.az; this.speed = a.speed; this.sound = a.sound;
    this.tilt = 0.1745319962501526; this.spin = 0; this.orbit = 0;
  }
  update(w: World, rec: GameRecord): number {
    const dt = w.dt, sh = this.shared;
    const ang = f32(this.orbit + this.ry0);
    const x = f32(f32(Math.cos(ang) * this.ax) + this.x0);
    const z = f32(f32(Math.sin(ang) * this.az) + this.z0);
    rec.m.set(euler24(this.tilt, this.spin, 0, x, this.y0, z));
    rec.ry = this.ry0;
    this.orbit = f32(f32(this.speed * dt) + this.orbit);
    this.spin = f32(f32(0.06981279700994492 * dt) + this.spin);
    if (this.sound !== 0) sh.sounds.play3D(SND.UFO, x, this.y0, z);
    return NODE_CONTINUE;
  }
}

export class ScrConeNode extends PropNode {
  readonly kind = 'ScrCone';
  saucer!: GameRecord; sauIndex: number;
  /** +0x1c / +0x20 / +0x24 / +0x28 the range (128, 128^2) and the catch radius (8, 8^2), +0x2c state, +0x30 timer, +0x34 / +0x38 the scales */
  rangeR = 128; rangeR2 = f32(128 * 128); catchR = 8; catchR2 = 64; state = 5; timer = 30; sy = 0; sxz = 0.03125;
  constructor(sauIndex: number) { super(); this.sauIndex = sauIndex; }
  bind(sh: DspShared, w: World, _rec: GameRecord) {
    this.shared = sh; this.saucer = w.records[this.sauIndex];
    this.state = 5; this.timer = 30; this.sy = 0; this.sxz = 0.03125;
  }
  update(w: World, rec: GameRecord): number {
    const sh = this.shared, dt = w.dt, pep = car(sh);
    switch (this.state) {
      case 0:
        this.sy = f32(f32(0.125 * dt) + this.sy);
        if (1 <= this.sy) { this.state = 1; this.sy = 1; }
        break;
      case 1:
        this.sxz = f32(f32(0.0625 * dt) + this.sxz);
        if (1 <= this.sxz) { this.state = 2; this.sxz = 1; this.timer = 0; }
        break;
      case 2:
        this.timer = f32(f32(1.0 * dt) + this.timer);
        if (this.timer < 250) {
          if (sh.get(VAR.SHRINK) === 0) {
            const dx = f32(pep.x - rec.x), dz = f32(pep.z - rec.z), r = this.catchR;
            this.timer = f32(f32(1.0 * dt) + this.timer);
            if (dx < r && -r < dx && dz < r && -r < dz && f32(f32(dz * dz) + f32(dx * dx)) < this.catchR2) { this.state = 6; sh.set(VAR.SHRINK, 1); }
          }
        } else this.state = 3;
        break;
      case 3:
        this.sxz = f32(this.sxz - f32(0.0625 * dt));
        if (this.sxz <= 0.0625) { this.state = 4; this.sxz = 0.0625; this.timer = 0; }
        break;
      case 4:
        this.sy = f32(this.sy - f32(0.125 * dt));
        if (this.sy <= 0) { this.state = 5; this.sy = 0; this.timer = 0; }
        break;
      case 5:
        this.timer = f32(f32(1.0 * dt) + this.timer);
        if (30 <= this.timer) {
          const dx = f32(pep.x - rec.x), dz = f32(this.saucer.z - rec.z);
          // `*(car + 0x44) - rec.z` in the original is the car's z
          const dzc = f32(pep.z - rec.z), r = this.rangeR;
          void dz;
          if (dx < r && -r < dx && dzc < r && -r < dzc && f32(f32(dzc * dzc) + f32(dx * dx)) < this.rangeR2) this.state = 0;
        }
        break;
      case 6:
        if (sh.get(VAR.SHRINK) === 0) this.state = 2;
        break;
      case 7:
        this.timer = f32(f32(1.0 * dt) + this.timer);
        if (30 < this.timer) { this.state = 2; this.timer = 0; }
        break;
    }
    const s = this.saucer;
    // FUN_0043a742(matrix, 0, 0, 0, saucer position, scale (+0x38, +0x34, +0x38))
    eulerScaled24(rec.m, 0, 0, 0, s.x, s.y, s.z, this.sxz, this.sy, this.sxz);
    rec.variant = s.variant;
    return NODE_CONTINUE;
  }
}

// ------------------------------------------------------------------ whirlwind (FUN_006c1d79 / FUN_006c1990)
export class WhirlwindNode extends PropNode {
  readonly kind = 'whirlwnd';
  /** +0x14 inner radius 0.75, +0x18 pull radius 3.5, +0x1c strength 0.08 (0x3da3d70a), +0x20 amplitude 24 (0x41c00000), +0x24 speed 1 degree, +0x28 / +0x2c / +0x30 the home place, +0x34 caught flag, +0x38 phase */
  inner = 0.75; outer = 3.5; strength = 0.07999999821186066; amp = 24.0; dphi = 0.01745319925248623;   // 0x3f400000 / 0x40600000 / 0x3da3d70a / 0x41c00000 / 0x3c8efa03
  hx = 0; hy = 0; hz = 0; caught = 0; phase = 0; x = 0; z = 0;
  bind(sh: DspShared, _w: World, rec: GameRecord) {
    this.shared = sh;
    this.hx = rec.x; this.hy = rec.y; this.hz = rec.z;
    this.caught = 0; this.phase = 0;
  }
  update(w: World, rec: GameRecord): number {
    const sh = this.shared, dt = w.dt, pep = car(sh);
    const t = this.phase;
    const x = f32(f32(Math.cos(f32(t * 4)) * this.amp) + this.hx);
    const z = f32(f32(Math.sin(t) * this.amp) + this.hz);
    let y = ground(w, x, rec.y, z);
    if (y === -1e38) y = rec.y;
    rec.m.set(euler24(0, f32(t * 64.0), 0, x, y, z));
    this.phase = f32(t + this.dphi);
    this.x = x; this.z = z;
    let dx = f32(pep.x - x), dz = f32(pep.z - z);
    sh.sounds.play3D(SND.TWISTER, rec.x, rec.y, rec.z);
    if (sh.get(VAR.SPIN) === 0) {
      const R = this.outer;
      dx = f32(dx * 0.125); dz = f32(dz * 0.125);
      if (dx <= -R || R <= dx || dz <= -R || R <= dz) sh.sounds.stop3D(SND.TWISTER);
      else {
        const r0 = this.inner;
        const d2 = f32(f32(dz * dz) + f32(dx * dx));
        sh.sounds.play3D(SND.TWISTER, rec.x, rec.y, rec.z);
        if (f32(r0 * r0) <= d2) {
          if (this.caught === 0 && d2 < f32(R * R)) {
            const len = Math.sqrt(d2);
            const k = f32(this.strength * (f32((f32(R - len)) / R)));
            const ex = f32((f32(dx / len)) * k);
            sh.push[0] = f32(-ex + sh.push[0]);
            sh.push[2] = f32(-(f32((f32(dz / len)) * k)) + sh.push[2]);
          }
        } else {
          sh.set(VAR.SPIN, 1);
          this.caught = 1;
          sh.say('ADSGDS10');
        }
      }
    }
    void dt;
    return NODE_CONTINUE;
  }
}

// ------------------------------------------------------------------ WalkRock (FUN_006c07d4 / FUN_006c0250)
/** the argument blocks of the attach loop (FUN_006be930: DAT_05d5c140 ..): the record pairs (bot, rock) of the table at 0x92af70 and the constants 9 / 4.8 / 80 / 192 */
export const ROCK = { PAIRS_VA: 0x92af70, BOT_CLIP_HIT: 12, STAND: f32(4.8), ROLL: 80.0, TRIGGER: 192.0 } as const;
export class WalkRockNode extends PropNode {
  readonly kind = 'WalkRock';
  bot: GameRecord | null = null;
  /** +0x20 side (0 / 1), +0x24 1 / 4.8, +0x28 4.8 (the bot's height), +0x2c / +0x34 start x / z, +0x38 / +0x40 direction, +0x44 80, +0x48 192, +0x4c 192^2 */
  side = 0; invH = 0; h = 4.8; sx = 0; sy = 0; sz = 0; dirx = 0; diry = 0; dirz = 0; span = 80; trig = 192; trig2 = f32(192 * 192);
  /** +0x50 yaw -+ pi/2, +0x54 the sound, +0x58 state, +0x5c phase, +0x60 roll, +0x64 distance, +0x68 the bot's yaw */
  yaw = 0; soundId = 0; state = 0; phase = 0; roll = 0; dist = 0; botYaw = 0;
  constructor(bot: GameRecord | null) { super(); this.bot = bot; }
  bind(sh: DspShared, w: World, rec: GameRecord) {
    this.shared = sh;
    this.sx = rec.x; this.sy = rec.y; this.sz = rec.z;
    const t = sh.track.nearest([rec.x, rec.y, rec.z]);        // FUN_004478d0: the path parameter nearest to the rock
    const p = sh.track.position(t);                            // FUN_00445680(DAT_05d5cc14, t, ., ., 0): the position on the track
    const d = [f32(rec.x - p[0]), f32(rec.y - p[1]), f32(rec.z - p[2])];
    normalize24(d);                                            // FUN_0043cec0
    this.dirx = -d[0]; this.diry = -d[1]; this.dirz = -d[2];
    this.h = ROCK.STAND; this.invH = f32(1 / ROCK.STAND); this.span = ROCK.ROLL; this.trig = ROCK.TRIGGER; this.trig2 = f32(ROCK.TRIGGER * ROCK.TRIGGER);
    // the side test reads two locals of the empty function FUN_0043ce7d (0xcccccccc = -1.0737418e8): -a * dz + b * dx with a = b = -1.0737418e8
    const K = -107374176;
    const side = f32(f32(-K * this.dirz) + f32(K * this.dirx));
    if (side <= 0) { this.yaw = f32(rec.ry - HALF_PI); this.side = 0; this.soundId = sh.rockL === 0 ? SND.LROCK1 : SND.LROCK2; sh.rockL++; }
    else { this.yaw = f32(rec.ry + HALF_PI); this.side = 1; this.soundId = sh.rockR === 0 ? SND.RROCK1 : SND.RROCK2; sh.rockR++; }
    this.botYaw = rec.ry;
    this.state = 0; this.phase = 0; this.roll = 0; this.dist = 0;
    this.bot?.anim?.start(15, 0);
    void w;
  }
  update(w: World, rec: GameRecord): number {
    const sh = this.shared, dt = w.dt, pep = car(sh), bot = this.bot;
    let clip = 0;
    const h = this.h;
    if (this.state === 0) {
      const dz = f32(rec.z - pep.z), dx = f32(rec.x - pep.x), r = this.trig;
      if (dz < r && -r < dz && dx < r && -r < dx && f32(f32(dz * dz) + f32(dx * dx)) < this.trig2) { this.state = 1; clip = 9; }
    } else if (this.state === 1) {
      const dist = f32(Math.sin(this.phase) * this.span);
      this.dist = f32(dist);
      this.roll = f32((f32(dist - this.span)) * this.invH);
      this.phase = f32(f32(0.05235959589481354 * dt) + this.phase);
      if (this.phase <= HALF_PI) sh.sounds.play3D(this.soundId, rec.x, rec.y, rec.z);
      else {
        sh.sounds.stop3D(this.soundId);
        if (!bot) this.state = 3;
        else if (this.side === 0) { clip = 13; this.state = 2; }
        else if (this.side === 1) { clip = 16; this.state = 2; }
        else { clip = 15; this.state = 3; this.botYaw = this.yaw; }
      }
      const x = f32(f32(this.dirx * dist) + this.sx), z = f32(f32(this.dirz * dist) + this.sz);
      const ox = f32(this.dirx * 8), oz = f32(this.dirz * 8);
      const y1 = terrain(w, f32(x + ox), 30.0, f32(z + oz), 4.0);
      const y2 = terrain(w, f32(x - ox), 30.0, f32(z - oz), 4.0);
      const cy = f32((f32(y1 + y2)) * 0.5);
      const tilt = Math.atan2(f32(y2 - y1), 16.0);
      const tm = euler24(0, rec.ry, tilt, x, cy, z);
      const up = [tm[4], tm[5], tm[6]];
      tm[12] += f32(up[0] * h); tm[13] += f32(up[1] * h); tm[14] += f32(up[2] * h);
      const rm = euler24(this.roll, 0, 0, 0, 0, 0);
      rec.m.set(mulGame(rm, tm));
    }
    if (bot) {
      if (clip === 0) {
        if (bot.anim && bot.anim.advance(1.0) !== 0) {
          if (this.state === 3) bot.anim.start(15, 0);
          else if (this.state === 2) { bot.anim.start(15, 0); this.state = 3; this.botYaw = this.yaw; }
        }
      } else bot.anim?.start(clip, 0);
      bot.m.set(euler24(0, this.botYaw, 0, rec.x, f32(h + rec.y), rec.z));
      bot.variant = rec.variant;
    }
    return NODE_CONTINUE;
  }
}
