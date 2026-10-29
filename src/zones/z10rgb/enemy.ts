// z10RGB: the enemy side (docs/re/m6/z10RGB.md section 6): Cedric ("Simon") and the nine cannons CC00..CC08 of his castle.
//   "cannon" (constructor FUN_0061a57f, update FUN_0061a06a, gated var 0xfa & 1): a small state machine 0 wait / 1 fire / 2 recoil / 3 rest / 4 wait for the ball; in
//     phase 1 (the bridge) every cannon aims straight at a random point between Pepper and the middle of the bridge and fires as soon as its ball pool allows; in the
//     cannon phase only the cannon Cedric stands on fires, once, when he leaves it (FUN_00619ec9 + FUN_00619c97 / 00619dbf / 00619c20 / 005f87e1 / 005f89c9).
//   "cedric" (constructor FUN_00619863, update FUN_00618ba6, gated var 0xfc & 1): stands on a cannon (state 0), turns its barrel at 0.001 rad per tick towards the
//     point he aims at, waves, then (state 1) picks a cannon that is still there and (state 3) hops to it along a parabola; when the last cannon is gone the game is won.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_CONTINUE } from '../../game/controller.ts';
import { RF_ENABLED } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { CLIP, K, MODE, PHASE, VAR, f32 } from './consts.ts';
import { allocBall, launchBall, placeBall } from './balls.ts';
import { rotate, wrapPi, yawError } from './shared.ts';
import type { Perch, RgbState } from './shared.ts';

/** FUN_005f89c9: the roots of a x^2 + b x + c (null when a = 0 or no real root); `low` = (-b + s) / 2a, `high` = (-b - s) / 2a (the first output of the original is the second here) */
export function quadratic(a: number, b: number, c: number): { first: number; second: number } | null {
  if (a === 0) return null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return { first: (-b - s) / (2 * a), second: (-b + s) / (2 * a) };
}

/**
 * FUN_005f87e1(muzzle, target, speed): the two launch angles (as tangents) that bring a shot of speed `speed` from `p` to `t` under the gravity `g`:
 * with D the horizontal distance and dy the height difference, a = -g D^2 / (2 speed^2) and a x^2 + D x + (a - dy) = 0. `flat` is the root of the original's
 * first output (-b + s) / 2a (the lower arc), `lob` the second (the higher arc). null = out of reach.
 */
export function solveShot(g: number, p: ArrayLike<number>, t: ArrayLike<number>, speed: number): { flat: number; lob: number } | null {
  const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2];
  const D = Math.hypot(dx, dz);
  const a = -(g * D * D) / (speed * speed + speed * speed);
  const r = quadratic(a, D, -dy + a);
  if (!r) return null;
  // FUN_005f89c9's outputs go to (param_5, param_4) of FUN_005f87e1: the first root (-b - s) / 2a is the HIGH lob, the second the flat one
  return { flat: r.second, lob: r.first };
}

/** Cedric's and the cannons' view of the player's cannon: the position they aim at when the player is inside one */
function playerPoint(st: RgbState): [number, number, number] {
  if (st.w.vars.get(VAR.MODE) === MODE.CANNON && st.pepperCannon >= 0) { const r = st.cannons[st.pepperCannon].rec; return [r.x, r.y, r.z]; }
  return [st.pepper.x, st.pepper.y, st.pepper.z];
}

/** FUN_00619bb0: something hit the record `hit`: Pepper (while he can be hit), or the cannon the player sits in: the mode word becomes 2 */
export function ballHit(st: RgbState, hit: GameRecord): void {
  let rec: GameRecord | null = hit;
  if (hit === st.pepper && st.vulnerable) { st.setMode(MODE.HIT); rec = null; }
  const pc = st.pepperCannon >= 0 ? st.cannons[st.pepperCannon].rec : null;
  if (pc === rec) st.setMode(MODE.HIT);
}

export class CannonNode implements BehaviourNode {
  readonly kind = 'cannon';
  var: number = VAR.GAME_ON; mask = 1; value = 1;
  stamp = 0xfffffffe;
  private st: RgbState;
  /** which cannon (CC0k) */
  readonly k: number;
  /** +0x18 ticks in the state, +0x1c delay, +0x20 state */
  ticks = 0; delay: number; state = 0;
  /** +0x34 the recoil velocity in the cannon's frame, +0x40 the recoil at the shot, +0x4c the rest height */
  recoil: [number, number, number] = [0, 0, 0];
  readonly recoil0: readonly number[] = [0, 2, 0];
  restY = NaN;
  /** +0x58 the muzzle in the world, +0x64 the launch vector */
  muzzle: [number, number, number] = [0, 0, 0];
  aimVec: [number, number, number] = [0, 0, 0];
  /** +0x54 the ball in flight (index into the pool), -1 none */
  ball = -1;
  constructor(st: RgbState, k: number, delay: number) { this.st = st; this.k = k; this.delay = delay; }

  /** FUN_00619c97: turn the cannon straight at `target` and take the launch vector from its new heading (speed * (fx, 1, fz)) */
  private aimNow(rec: GameRecord, target: ArrayLike<number>, speed: number): void {
    const err = yawError(rec, target);
    rec.ry = wrapPi(rec.ry - err);
    rec.setEuler(rec.rx, rec.ry, rec.rz, rec.x, rec.y, rec.z);
    this.aimVec = [rec.m[8] * speed, 1 * speed, rec.m[10] * speed];
  }
  /** FUN_00619dbf: the same without moving the cannon (the matrix is computed on the side) */
  private aimSide(rec: GameRecord, target: ArrayLike<number>, speed: number): void {
    const err = yawError(rec, target);
    const ry = wrapPi(rec.ry - err);
    // the matrix is computed on the side: the forward row of (rx, ry, rz) at the cannon's position
    const m = new Float32Array(16);
    const save = rec.m.slice();
    rec.setEuler(rec.rx, ry, rec.rz, rec.x, rec.y, rec.z);
    m.set(rec.m);
    rec.m.set(save);
    this.aimVec = [m[8] * speed, 1 * speed, m[10] * speed];
  }
  /** FUN_00619c20: the muzzle (0, 4.8, 11.2) in the cannon's frame */
  private placeMuzzle(rec: GameRecord): void {
    const p = rec.toWorld(K.MUZZLE);
    this.muzzle = [p[0], p[1], p[2]];
  }

  /** FUN_00619ec9: true when this cannon can fire now (the aim and the launch angles are in `this.roots`) */
  roots: { flat: number; lob: number } | null = null;
  private wantsToFire(rec: GameRecord): boolean {
    const st = this.st;
    if (st.phase === PHASE.BRIDGE) {
      const d = [st.bridge[0] - st.pepper.x, st.bridge[1] - st.pepper.y, st.bridge[2] - st.pepper.z];
      const f = st.rand(1);
      const target = [d[0] * f + st.pepperPos[0], d[1] * f + st.pepperPos[1], d[2] * f + st.pepperPos[2]];
      this.aimNow(rec, target, st.shotSpeed);
      this.placeMuzzle(rec);
      this.roots = solveShot(st.g, this.muzzle, target, this.aimVec[1]);
      return this.roots !== null;
    }
    if (st.phase === PHASE.CANNONS && st.cedricFire && rec === st.enemy[st.cedricAt]) {
      st.cedricFire = false;
      this.aimSide(rec, st.target, st.shotSpeed);
      this.placeMuzzle(rec);
      this.roots = solveShot(st.g, this.muzzle, st.target, this.aimVec[1]);
      return this.roots !== null;
    }
    return false;
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    const st = this.st;
    st.bind(w);
    if (Number.isNaN(this.restY)) this.restY = rec.y;
    this.ticks++;
    st.pepperPos = [st.pepper.x, st.pepper.y, st.pepper.z];
    switch (this.state) {
      case 0:
        if (this.delay < this.ticks) { this.state = 1; this.ticks = 0; this.delay = 0; }
        break;
      case 1:
        if (this.delay < this.ticks && this.wantsToFire(rec)) {
          const b = allocBall(st);
          this.ball = b ? b.idx : -1;
          if (b) {
            st.fx('cannonFire', this.muzzle);
            this.recoil = [this.recoil0[0], this.recoil0[1], this.recoil0[2]];
            placeBall(b, this.muzzle, this.aimVec);
            const r = this.roots!;
            let tan: number;
            if (st.phase === PHASE.BRIDGE) tan = Math.trunc(st.rand(2)) === 0 ? r.lob : r.flat;
            else tan = r.flat;
            launchBall(b, Math.atan2(tan, 1));
            this.state = 2;
            this.ticks = 0;
          }
        }
        break;
      case 2: {
        // the recoil: the cannon moves along its own up / forward by the recoil velocity (rotated into the world), falls back and bounces
        const v = rotate(rec.m, this.recoil);
        rec.m[12] += v[0]; rec.m[13] += v[1]; rec.m[14] += v[2];
        if (this.restY < rec.y) this.recoil[1] -= 0.5;
        else {
          rec.m[13] = this.restY;
          this.recoil[1] *= -0.4;
          this.recoil[2] *= 0.5;
          if (Math.abs(this.recoil[1]) < K.RECOIL_REST) {
            this.recoil[1] = 0; this.recoil[2] = 0;
            this.state = 4;
          }
        }
        break;
      }
      case 3:
        this.ticks = 0; this.delay = K.CANNON_WAIT; this.state = 0;
        break;
      case 4: {
        const b = this.ball >= 0 ? st.balls[this.ball] : null;
        if (b && b.hit) ballHit(st, b.hit);
        if (b && b.state === 0) this.state = 3;
        break;
      }
    }
    return NODE_CONTINUE;
  }
}

/** one cannon's constructor effect (FUN_00619863): the stored heading is negated (the matrix keeps the builder's until the cannon is aimed) */
export function negateCannonHeading(st: RgbState): void {
  for (const r of st.enemy) r.ry = -r.ry;
}

export class CedricNode implements BehaviourNode {
  readonly kind = 'cedric';
  var: number = VAR.CEDRIC_ON; mask = 1; value = 1;
  stamp = 0xfffffffe;
  private st: RgbState;
  /** +0xf0 state: 0 on a cannon, 1 getting ready to jump, 3 in the air */
  state = 0;
  /** +0xf4 / +0xf8: ticks in the state and its length */
  timer = 30; duration = 0;
  /** +0xfc: the cannon he stands on, +0xfe: the one he jumps to */
  cur = 5; next = 1;
  /** +0x100: the state's first tick has run */
  started = false;
  /** +0x104 vertical scale (0 until the first take-off), +0x108 animation rate, +0x110 / +0x114 / +0x118 the hop velocity (x, y at take-off, z) */
  scale = 0; rate = 1; vx = 0; vy = 0; vz = 0;
  /** +0x11c the scatter of the aim point, +0x120 the number of taunts spoken */
  scatter = 0; taunts = 0;
  /** the frame counts of the clips 0xd9 / 0xb3 / 0xba (DAT_05d5bb18 / 1c / 20, read in the constructor) */
  frames = { takeoff: 60, hopUp: 30, hopDown: 30 };
  constructor(st: RgbState) { this.st = st; }

  /** the constructor's effects that need the world (FUN_00619863): the perches, the clip lengths */
  init(w: World): void {
    if (this.ready) return;
    this.ready = true;
    const st = this.st;
    st.bind(w);
    negateCannonHeading(st);
    st.perches = st.enemy.map((r, i): Perch => ({ rec: r, pos: [0, 0, 0], bit: 1 << i }));
    st.enemy.forEach((r, i) => { const p = r.toWorld(K.CED_PERCH); st.perches[i].pos = [p[0], p[1], p[2]]; });
    const a = st.cedric.anim;
    if (a) {
      a.start(CLIP.CED_TAKEOFF, 0); this.frames.takeoff = Math.trunc(a.frameCount);
      a.start(CLIP.CED_HOP_UP, 0); this.frames.hopUp = Math.trunc(a.frameCount);
      a.start(CLIP.CED_HOP_DOWN, 0); this.frames.hopDown = Math.trunc(a.frameCount);
    }
    this.cur = 5; this.next = 1; this.timer = 30; this.rate = 1; this.state = 0; this.started = false; this.taunts = 0;
  }

  ready = false;

  private taunt(): void {
    const st = this.st;
    this.taunts++;
    const n = this.taunts - 1;
    if (n >= 0 && n <= 5) st.say(`CASGRB${String(9 + n).padStart(2, '0')}`);
    else this.taunts = 10;
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    const st = this.st;
    st.bind(w);
    this.init(w);
    const dt = w.dt;
    const cannon = st.enemy[this.cur];
    st.cedricAt = this.cur;
    this.timer += 1 * dt;
    rec.anim?.advance(this.rate);
    const perch = st.perches[this.cur];
    switch (this.state) {
      case 0: {
        if (!this.started) {
          rec.anim?.start(CLIP.CED_WAVE, 0);
          st.sound.at(Math.trunc(st.rand(10)) < 5 ? 'wave2' : 'wave1', [rec.x, rec.y, rec.z]);
          this.scatter = 4.5 * 8;
          const p = playerPoint(st);
          st.target = [p[0], p[1], p[2]];
          st.target[0] = st.rand(this.scatter) - this.scatter * 0.5 + st.target[0];
          st.target[2] = st.rand(this.scatter) - this.scatter * 0.5 + st.target[2];
          this.timer = 0; this.duration = 100;
          this.started = true;
        }
        if ((cannon.flags & RF_ENABLED) === 0) {
          if (st.cannonsLeft > 0) this.taunt();
          st.score += 300;
          this.state = 1; this.started = false;
        }
        let err = yawError(cannon, st.target);
        if (err <= K.CED_TURN) { if (err < -K.CED_TURN) err = -K.CED_TURN; } else err = K.CED_TURN;
        cannon.ry -= err * dt;
        cannon.ry = wrapPi(cannon.ry);
        cannon.setEuler(cannon.rx, cannon.ry, cannon.rz, cannon.x, cannon.y, cannon.z);
        rec.m.set(cannon.m);
        const pp = cannon.toWorld(K.CED_PERCH);
        rec.m[12] = pp[0]; rec.m[13] = pp[1]; rec.m[14] = pp[2];
        perch.pos = [rec.m[12], rec.m[13], rec.m[14]];
        rec.rx = cannon.rx; rec.ry = cannon.ry; rec.rz = cannon.rz;
        if (Math.abs(err) < K.CED_TURN) {
          this.state = 1; this.started = false;
          st.cedricFire = false;
          st.sound.at('cedCannon', perch.pos);
        }
        break;
      }
      case 1: {
        if (!this.started) {
          rec.anim?.start(CLIP.CED_TAKEOFF, 0);
          this.rate = 1;
          this.timer = 0;
          this.duration = this.frames.takeoff;
          this.started = true;
          st.cedricFire = false;
        }
        if ((cannon.flags & RF_ENABLED) === 0) this.duration = 0;
        if (this.duration < this.timer) {
          if (st.cannonsLeft < 2) {
            if (st.cannonsLeft === 1) {
              this.next = 0;
              while (this.next < 9 && (st.enemy[this.next].flags & RF_ENABLED) === 0) this.next++;
            } else {
              st.phase = PHASE.WON;
              w.vars.set(VAR.CEDRIC_ON, 0);
            }
          } else {
            let guard = 0;
            do {
              do { this.next = Math.trunc(st.rand(9)) % 9; } while (this.next === this.cur && guard++ < 1000);
            } while ((st.enemy[this.next].flags & RF_ENABLED) === 0 && guard++ < 1000);
          }
          if (this.next === this.cur) {
            this.vx = 0; this.vy = f32(0x3fcccccd); this.vz = 0;
            this.scale = 1;
            this.duration = 30;
          } else {
            const sx = rec.x, sy = rec.y, sz = rec.z;
            const dest = st.perches[this.next].pos;
            let vy = st.hop[this.cur][this.next] / 2;
            this.scale = 1;
            const dx = dest[0] - sx, dy = dest[1] - sy, dz = dest[2] - sz;
            this.vy = vy;
            let r = quadratic(-(st.g * K.CED_SCALE), this.vy * K.CED_SCALE, -(dy * K.CED_SCALE));
            let guard = 0;
            while (!r && guard++ < 1000) { this.vy += K.CED_VY_STEP; r = quadratic(-(st.g * K.CED_SCALE), this.vy * K.CED_SCALE, -(dy * K.CED_SCALE)); }
            vy = this.vy;
            this.duration = r ? (r.second <= r.first ? r.first : r.second) : 30;
            this.vx = dx / this.duration; this.vz = dz / this.duration;
          }
          if (this.duration <= K.CED_SHORT) { rec.anim?.start(CLIP.CED_WAVE, 0); this.rate = 1; }
          else if (this.vz < 0) { rec.anim?.start(CLIP.CED_HOP_DOWN, 0); this.rate = this.frames.hopDown / this.duration; }
          else { rec.anim?.start(CLIP.CED_HOP_UP, 0); this.rate = this.frames.hopUp / this.duration; }
          if (cannon.flags & RF_ENABLED) st.cedricFire = true;
          this.timer = 0;
          this.state = 3; this.started = false;
        }
        break;
      }
      case 3: {
        if (this.timer < this.duration) {
          rec.m[12] += this.vx * dt;
          rec.m[13] = (this.vy * this.scale - this.timer * st.g) * this.timer + perch.pos[1];
          rec.m[14] += this.vz * dt;
          st.sound.at(Math.trunc(st.rand(100)) < 50 ? 'jump2' : 'jump1', [rec.x, rec.y, rec.z]);
        } else {
          this.timer = 0; this.duration = 10;
          this.cur = this.next;
          this.state = 0; this.started = false;
          const d = st.perches[this.next].pos;
          rec.m[12] = d[0]; rec.m[13] = d[1]; rec.m[14] = d[2];
          rec.savePrev();
          st.sound.stop('jump1'); st.sound.stop('jump2');
        }
        break;
      }
    }
    return NODE_CONTINUE;
  }
}

