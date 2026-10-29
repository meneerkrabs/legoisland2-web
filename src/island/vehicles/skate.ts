// The skateboard (Common\Z01BPK\c_src\skate.c, shared by the skate park mini-game z01BPK and the island). On the island the node is attached to PEPP with the
// gate PEPPER_CONTROL & 4 through FUN_0043310c (a thunk to the constructor FUN_00492cc2); handler table 0x8d2130 =
//   { update FUN_00490e2e, pre-render FUN_004928d2, destroy FUN_00492e90, draw FUN_00492c25 }
// The update: input FUN_00490cd2 (+ key ramp FUN_00490af4), the per-state logic FUN_004900d4, the state machine FUN_0048f66d, ground alignment FUN_0048e1b0,
// the rolling sounds FUN_0048fece / FUN_0048fdea.
// Every branch the code takes when CURRENT_SUBGAME == 1 (the skate park: half-pipes "QPIP", the arena bounds +-39.9 / +-24, the trick scoring) is NOT
// ported; the tricks of the air (FUN_0048e840: Space / Ctrl / Shift + a direction start a trick clip and fill the score DAT_05d58004) are skipped as well,
// which only removes the "crash on landing an unfinished trick" (state 0x23) from the island (docs/re/m4/wp6-vehicles.md).
// The state byte is Pepper's clip (MFIG.blk): 0x16 getting on, 0x2d push off, 0x29 rolling, 0x51 / 0x53 leaning (poses scrubbed by the steering),
// 0x2a crouch (Alt), 0x2b crouch held, 0x20 in the air, 0x21 landing, 0x23 crash, 0x1c getting off (the walk node's state, set by PepSwitc / the pre-render),
// 0x37 knocked off. The board record SBRD (DAT_009daa7c = 9) follows Pepper's matrix and plays SKBD.blk clips 1 (getting on), 2 (off), 3 (rolling), 4 (lean).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { RAMP_TABLE } from '../../game/camera.ts';
import { AnimInstance } from '../../game/anim.ts';
import { parseBlk } from '../../formats/anim.ts';
import { tryCtx } from '../ctx.ts';
import { vehicles, normalize, sfx, stopSfx } from './common.ts';

/** the rolling sound by surface id (FUN_004b0b37: DAT_05d57fe0 0, fd0 1 / 8, fc8 3, fd4 4, fe8 6, fcc 7, fdc 9, fd8 10) */
const ROLL_BY_SURFACE: Record<number, number> = { 0: 0x180, 1: 0x17f, 3: 0x181, 4: 0x184, 6: 0x182, 7: 0x185, 8: 0x17f, 9: 0x185, 10: 300 };
export const SKATE_ROLL_SOUNDS = [0x180, 0x17f, 0x182, 0x185, 300, 0x181, 0x184];
/** the landing sound by surface id (DAT_05d57fe4 0, ffc 1 / 8, ff0 3, 000 4, ff4 6, fec 7) */
const LAND_BY_SURFACE: Record<number, number> = { 0: 0x2c6, 1: 0x2c1, 3: 0x2c5, 4: 0x2c3, 6: 0x2c1, 7: 0x2c2, 8: 0x2c1 };
/** the states that roll (FUN_0048fece plays the surface's rolling sound in them) */
const ROLLING = [0x0e, 0x19, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2d];

const RADIUS = 1.399999976158142, SKIN = 0.20000000298023224;     // DAT_008d2120 / 8d2124 (the island's sweeps)
const FEET = 1.2000000476837158;                                  // DAT_008920e8
const TURN = 0.000750000006519258;                                // DAT_008924f8
const MAX_SPEED = 0.75, PUSH = 0.10000000149011612, BRAKE = 0.20000000298023224;
const JUMP_V0 = 15.0;                                             // DAT_008d2128 (the island: the crouch charge times 15, falling off an edge 15)
const CHARGE = 0.05999999865889549, CHARGE_MAX = 2.0;             // DAT_008921f8
const PUSH_TICKS = 50.0;                                          // DAT_00892254
const LEDGE = 2.0, AHEAD = 2.5;                                   // DAT_00892028 / 8920d0
const NO_GROUND = -1000.0;
const UNSET = -107374176.0;    // a local of the original that is not written on one path: the debug heap fill 0xcccccccc read as a float
const CAM_OFFSET = [0, 12.0, -14.0], CAM_EASE = 0.10000000149011612, CAM_NEAR = 13.0;

export class SkateNode implements BehaviourNode {
  readonly kind = 'skate';
  var = 0x5e; mask = 4; value = 4;
  stamp = 0xfffffffe;
  // node + 0x18 .. (FUN_00492cc2)
  state = 0x16;            // +0x18
  evaluated = 0;           // +0x19 (the landing was judged)
  grounded = 1;            // +0x1a
  onPipe = 0;              // +0x1b (half-pipe "QPIP": the park only)
  trickMid = 0;            // +0x1c
  pushes = 0;              // +0x1d
  animResult = 0;          // +0x20
  rampX = 0x10; steer = 0; // +0x24 / +0x28
  rampY = 0x10; stickY = 0;// +0x2c / +0x30
  t = 0;                   // +0x38: time in the air
  spin = 0;                // +0x3c
  yaw = 0;                 // +0x54 (a copy of Pepper's yaw)
  speed = 0;               // +0x5c
  maxSpeed = MAX_SPEED;    // +0x60
  charge = 0;              // +0x64
  y0 = 0;                  // +0x68
  jumpY = 0;               // +0x6c
  v0 = 0;                  // +0x70
  vy = 0;                  // +0x74
  progress = 0;            // +0x78 (the trick progress: stays 0, the tricks are not ported)
  pushTimer = 0;           // +0x7c
  vx = 0; vz = 0; vyv = 0; // +0x8c / +0x94 / +0x90: the velocity of this tick

  private board(w: World): GameRecord | null {
    const b = w.records[vehicles(w).board] ?? null;
    if (b && !b.anim) {
      // the board's animation instance (the original's record has one: SKBD.blk); the port's records get one only for the player, so make it here
      const c = tryCtx(w);
      const e = c?.archive.find('anim/SKBD.blk');
      if (e && c) { try { b.anim = new AnimInstance(parseBlk(c.archive.read(e))); b.anim.start(3, 0); } catch { /* no rig */ } }
    }
    return b;
  }

  /** FUN_00490af4: the key ramp */
  private ramp(held: number) {
    let rx = this.rampX, ry = this.rampY, b1 = false, b2 = false;
    if (held & B.LEFT) { b1 = true; rx = rx < 0x11 ? rx - 3 : 0x10; if (rx < 1) rx = 0; }
    if (held & B.RIGHT) { b1 = true; rx = rx < 0x10 ? 0x10 : rx + 3; if (rx > 0x1f) rx = 0x20; }
    if (held & B.UP) { b2 = true; ry = ry < 0x11 ? ry - 3 : 0x10; if (ry < 1) ry = 0; }
    if (held & B.DOWN) { b2 = true; ry = ry < 0x10 ? 0x10 : ry + 3; if (ry > 0x1f) ry = 0x20; }
    if (!b1) { if (rx > 0x10) { rx -= 4; if (rx < 0x10) rx = 0x10; } if (rx < 0x10) { rx += 4; if (rx > 0x10) rx = 0x10; } }
    if (!b2) { if (ry > 0x10) { ry -= 4; if (ry < 0x10) ry = 0x10; } if (ry < 0x10) { ry += 4; if (ry > 0x10) ry = 0x10; } }
    this.rampY = ry; this.stickY = RAMP_TABLE[ry] - 0x80;
    this.rampX = rx; this.steer = RAMP_TABLE[rx] - 0x80;
  }

  /** FUN_00490cd2 (the island's branches): Down brakes, the board speeds up by itself to 0.75, the steering turns Pepper unless he is in the air */
  private input(w: World, rec: GameRecord) {
    const held = w.input.held;
    this.ramp(held);
    if ((held & B.DOWN) !== 0 && this.state !== 0x20) { if (this.speed <= 0) this.speed = 0; else this.speed -= BRAKE; }
    if (MAX_SPEED <= this.speed) this.speed = MAX_SPEED; else this.speed += PUSH;
    if (this.state !== 0x20) rec.ry = this.steer * TURN * w.dt + rec.ry;
  }

  /** FUN_0048fece: the rolling sound of the surface under the board */
  private rollSound(w: World) {
    const G = vehicles(w);
    const surf = w.col.lastSurface();
    if (ROLLING.includes(this.state)) {
      if (surf !== G.rollSurface) this.stopRoll(w);
      const id = ROLL_BY_SURFACE[surf];
      if (id !== undefined) sfx(w, id); else this.stopRoll(w);
      G.rollSurface = surf;
    } else this.stopRoll(w);
  }
  /** FUN_0048fdea */
  private stopRoll(w: World) { const id = ROLL_BY_SURFACE[vehicles(w).rollSurface]; if (id !== undefined) stopSfx(w, id); }

  /** FUN_004900d4 (island): the per-state work; returns the requested state (0 = none) */
  private stateWork(w: World, rec: GameRecord): number {
    const board = this.board(w);
    let next = 0, rate = 1.0, boardRate = 1.0;
    const dt = w.dt, held = w.input.held;
    this.rollSound(w);
    const lean = (pepClip: number) => {
      // the lean poses: Pepper's clip pepClip and the board's clip 4, both scrubbed to frame n + n * steer / 127
      rec.anim?.start(pepClip, 0);
      board?.anim?.start(4, 0);
      const s = this.steer / 127.0;
      if (board?.anim) { const n = (board.anim.frameCount - 1) * 0.5; board.anim.seek(n * s + n); }
      if (rec.anim) { const n = (rec.anim.frameCount - 1) * 0.5; rec.anim.seek(n * s + n); }
    };
    switch (this.state) {
      case 0x0e: case 0x19: case 0x2a: rate = 1.0; break;
      case 0x16: this.speed = 0; boardRate = 0.5; break;
      case 0x20: {
        // the jump arc: y = vy t + y0 + g t^2 / 2 with vy = g t + v0 (so the arc is v0 t + 1.5 g t^2)
        this.t = 0.1 * dt + this.t;
        this.vy = this.t * w.gravity + this.v0;
        let y = this.vy * this.t + this.y0 + w.gravity * (this.t * this.t) * 0.5;
        const cur = rec.y;
        if (4.0 < Math.abs(y - cur) && y - cur < 0) y = cur - 4.0;
        if (y < cur) this.jumpY = y;
        else {
          const h = w.col.sweep(rec, [rec.x, cur + 4.0, rec.z], [0, y - cur, 0], 1, RADIUS, RADIUS);
          this.jumpY = h ? (h.point[1] - (y - cur)) - 4.0 : y;
        }
        this.grounded = 0;
        if (rec.anim?.clip === 0x20) rate = 1.0; else { rate = 0; boardRate = 0; }
        break;
      }
      case 0x27: case 0x28: rate = 0; break;
      case 0x29:
        if (this.speed <= 0.10000000149011612) next = 0x2d;
        vehicles(w).trickScore = 0;
        if (this.steer < 0x15 && -0x15 < this.steer) {
          if (rec.anim?.clip !== 0x29) { next = 0x29; board?.anim?.start(3, 0); }
        } else { lean(0x51); rate = 0; boardRate = 0; }
        if ((held & B.ALT) !== 0) { next = 0x2a; this.charge = 0.10000000149011612; }
        this.pushTimer = 1.0 * dt + this.pushTimer;
        if (PUSH_TICKS < this.pushTimer) { next = 0x2d; this.pushTimer = 0; }
        break;
      case 0x2b:
        if ((held & B.ALT) === 0) {
          this.t = 0; this.v0 = this.charge * JUMP_V0; this.charge = 0;
          this.jumpY = this.y0 + 4.0; this.y0 = rec.y;
          next = 0x20;
        } else {
          if (this.steer < 0x15 && -0x15 < this.steer) {
            if (rec.anim?.clip !== 0x2b) { next = 0x2b; board?.anim?.start(3, 0); }
          } else { lean(0x53); boardRate = 0; }
          if (this.charge < CHARGE_MAX) this.charge = CHARGE * dt + this.charge;
        }
        rate = 0;
        break;
      case 0x32:
        this.t = 0.1 * dt + this.t;
        this.vy = this.t * w.gravity + this.v0;
        this.jumpY = this.vy * this.t + this.y0 + w.gravity * (this.t * this.t) * 0.5;
        this.speed = -1.0;
        rate = 1.0;
        break;
      default: break;
    }
    if (rate !== 0 && rec.anim) this.animResult = rec.anim.advance(rate, dt);
    if (boardRate !== 0 && board?.anim) board.anim.advance(boardRate, dt);
    return next;
  }

  /** FUN_0048f66d (island): the state machine; `next` = the state asked for so far, returns the state to switch to */
  private machine(w: World, rec: GameRecord, next: number): number {
    const board = this.board(w);
    const G = vehicles(w);
    switch (this.state) {
      case 0x0e: if (this.animResult === 2) next = 0x27; if (this.steer < 0x14) next = 0x29; break;
      case 0x19: if (this.animResult === 2) next = 0x28; if (-0x14 < this.steer) next = 0x29; break;
      case 0x27: if (this.steer < 0x14) next = 0x29; break;
      case 0x28: if (-0x14 < this.steer) next = 0x29; break;
      case 0x16: if (this.animResult === 2) { next = 0x2d; board?.anim?.start(3, 0); } break;
      case 0x20: if (this.grounded && this.onPipe) next = 0x21; break;
      case 0x21: {
        this.spin = 0;
        if (this.animResult === 2) { next = 0x29; this.evaluated = 0; }
        board?.anim?.start(3, 0);
        if (this.evaluated === 0) {
          // the trick judgement (with no trick in the air, progress stays 0 and the landing always passes)
          let crash = false;
          if (this.trickMid === 0) {
            if (this.progress <= 100.0 || G.trickFlag !== 0) { this.progress = 0; G.trickFlag = 1; } else crash = true;
          } else if (100.0 <= this.progress || G.trickFlag !== 0) {
            if (100.0 < this.progress && G.trickFlag === 0) { this.progress = 0; G.trickFlag = 1; }
          } else crash = true;
          if (crash) { next = 0x23; this.progress = 0; this.speed = 0; G.trickScore = 0; G.trickFlag = 0; }
          this.evaluated = 1;
        }
        if (next !== 0x23) { const id = LAND_BY_SURFACE[w.col.lastSurface()]; if (id !== undefined) sfx(w, id); }
        break;
      }
      case 0x23: this.maxSpeed = MAX_SPEED; this.speed = 0; if (this.animResult === 2) next = 0x29; break;
      case 0x2a:
        if (this.charge < CHARGE_MAX) this.charge = CHARGE * w.dt + this.charge;
        if (this.animResult !== 0) {
          if ((w.input.held & B.ALT) !== 0) next = 0x2b;
          else { this.t = 0; this.v0 = this.charge * JUMP_V0; this.charge = 0; this.jumpY = this.y0 + 4.0; this.y0 = rec.y; next = 0x20; }
        }
        break;
      case 0x2d:
        if (this.animResult === 2) {
          if (this.pushes === 0) { this.pushes = 1; this.animResult = 0; } else { next = 0x29; this.pushes = 0; }
        }
        break;
      case 0x32: if (this.animResult === 2) { next = 0x29; w.pep.mailbox = 0; } break;
    }
    return next;
  }

  /** FUN_0048e1b0: tilt Pepper to the ground under four probes 0.8 to the sides (1.2 up) and to the front / back (2 up) */
  private alignToGround(w: World, rec: GameRecord) {
    const x = rec.x, y = rec.y, z = rec.z, sea = w.seaLevel;
    const probe = (px: number, py: number, pz: number, first: boolean): number => {
      const t = w.col.terrainHeight(px, py, pz, 4.0);
      const dy = t <= sea ? -8.0 : t - py;
      const h = w.col.probe(rec, [px, py, pz], [0, dy, 0], 3);
      if (h) return h.point[1];
      if (first ? t <= NO_GROUND : t <= sea) return y;
      return Math.abs(py - y) <= 4.0 ? t : y;
    };
    const k = 0.800000011920929;
    const rx = rec.m[0] * k, rz = rec.m[2] * k;
    const a0 = [x - rx, 0, z - rz], a1 = [x + rx, 0, z + rz];
    a0[1] = probe(a0[0], y + FEET, a0[2], true); a1[1] = probe(a1[0], y + FEET, a1[2], false);
    const A = normalize([a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]]);
    const fx = rec.m[8] * k, fz = rec.m[10] * k;
    const b0 = [x - fx, 0, z - fz], b1 = [x + fx, 0, z + fz];
    b0[1] = probe(b0[0], y + 2.0, b0[2], false); b1[1] = probe(b1[0], y + 2.0, b1[2], false);
    const Bv = normalize([b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]]);
    const up = [Bv[1] * A[2] - Bv[2] * A[1], Bv[2] * A[0] - Bv[0] * A[2], Bv[0] * A[1] - Bv[1] * A[0]];
    const s = Math.sin(rec.ry), c = Math.cos(rec.ry);
    const d = up[2] * c + up[0] * s;
    const f = normalize([s - d * up[0], -d * up[1], c - d * up[2]]);
    const r = [up[1] * f[2] - up[2] * f[1], up[2] * f[0] - up[0] * f[2], up[0] * f[1] - up[1] * f[0]];
    const m = rec.m;
    m[0] = r[0]; m[1] = r[1]; m[2] = r[2]; m[4] = up[0]; m[5] = up[1]; m[6] = up[2]; m[8] = f[0]; m[9] = f[1]; m[10] = f[2];
  }

  /**
   * The board record (SkBoard.col, 384 polygons with flags 0x23) sits at Pepper's feet; the port's sweeps from 1.2 above his feet start inside the skin of the
   * board's chamfer planes and lift him onto it every tick. The original evidently does not (UNCERTAIN why: same rules in FUN_00441270), so the board is
   * left out of the skateboard's own sweeps (docs/re/m4/wp6-vehicles.md, approximations).
   */
  private withoutBoard<T>(w: World, f: () => T): T {
    const b = w.records[vehicles(w).board];
    if (!b || (b.flags & RF_NO_COLLIDE)) return f();
    b.flags |= RF_NO_COLLIDE;
    try { return f(); } finally { b.flags &= ~RF_NO_COLLIDE; }
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number { void _ctrl; return this.withoutBoard(w, () => this.ride(w, rec)); }
  prerender(w: World, rec: GameRecord): void { this.withoutBoard(w, () => this.afterRide(w, rec)); }

  /** FUN_00490e2e (the island's branches) */
  private ride(w: World, rec: GameRecord): number {
    const g = w.pep;
    const dt = w.dt;
    let next = 0;              // local_80
    if (this.stamp !== w.frame || this.state !== g.mailbox) {
      this.animResult = 0;
      rec.show();
      this.maxSpeed = MAX_SPEED;
      this.speed = 0;
      if (g.mailbox === 1) {
        // the walk node was jumping: continue the jump on the board
        g.mailbox = 0x20; this.state = 0x20; this.t = 0; this.v0 = 20.0; this.y0 = rec.y; this.jumpY = this.y0 + 2.0;
      } else if (g.mailbox !== 0) { this.state = g.mailbox; g.mailbox = 0; }
    }
    if (this.state !== 0x23 && this.state !== 0x16) { this.input(w, rec); this.yaw = rec.ry; }
    next = this.stateWork(w, rec);
    let ground = UNSET;          // local_2c
    let hitName = '';            // local_a8
    if (this.state !== 0x16) {
      const h = w.col.sweep(rec, [rec.x, rec.y + FEET, rec.z], [0, -8.0, 0], 3, RADIUS, SKIN);
      if (!h) {
        ground = w.col.terrainHeight(rec.x, rec.y + FEET, rec.z, 4.0);
        if (this.jumpY < ground) rec.y = ground;
      } else {
        hitName = h.rec.name;
        w.pep.surfaceAtFeet = w.col.lastSurface();
        if (hitName === 'QPIP') this.onPipe = 1;
        else if (this.grounded !== 0) this.onPipe = 0;
        if (this.jumpY <= h.point[1]) {
          ground = h.point[1]; rec.y = ground;
          if (this.t !== 0) { next = 0x21; this.t = 0; this.y0 = 0; this.jumpY = 0; this.v0 = 0; this.vy = 0; this.grounded = 1; }
        }
      }
    }
    rec.rebuildYaw();
    if (!(this.state === 0x20 || this.onPipe || this.state === 0x16) && hitName === 'LAND') this.alignToGround(w, rec);
    const fx = rec.m[8], fy = rec.m[9], fz = rec.m[10];
    this.vx = this.speed * fx * dt; this.vyv = this.speed * fy * dt; this.vz = this.speed * fz * dt;
    // walls: slide along, a second hit stops the board
    const from = [rec.x, rec.y + FEET, rec.z];
    let h = w.col.sweep(rec, from, [this.vx, this.vyv, this.vz], 3, RADIUS, SKIN);
    if (h && h.rec.name !== 'QPIP') {
      const d = h.normal[2] * this.vz + h.normal[1] * 0 + h.normal[0] * this.vx;
      this.vx -= h.normal[0] * d; this.vyv -= h.normal[1] * d; this.vz -= h.normal[2] * d;
      h = w.col.sweep(rec, from, [this.vx, this.vyv, this.vz], 3, RADIUS, SKIN);
      if (h) { this.vx = 0; this.vyv = 0; this.vz = 0; }
    }
    const ox = rec.x, oy = rec.y, oz = rec.z;                  // local_68 / 64 / 60
    const nx = rec.x + this.vx, nz = rec.z + this.vz;
    let ny = rec.y + this.vyv;
    if (this.t !== 0) {
      if (this.jumpY <= ground) {
        ny = ground; next = 0x21;
        this.t = 0; this.y0 = 0; this.jumpY = 0; this.v0 = 0; this.vy = 0; this.grounded = 1;
      } else ny = this.jumpY;
    }
    rec.x = nx; rec.y = ny; rec.z = nz;
    next = this.machine(w, rec, next);
    // an edge in front: off it in a small jump (v0 15)
    const yNow = rec.y;
    const px = rec.m[8] * AHEAD + ox, py = rec.m[9] * AHEAD + oy, pz = rec.m[10] * AHEAD + oz;
    let below = w.col.terrainHeight(px, py, pz, 4.0);
    if (below < NO_GROUND) below = w.seaLevel;
    const hd = w.col.sweep(rec, [px, py + 80.0, pz], [0, -160.0, 0], 1, 0.009999999776482582, 0);   // FUN_00441a90
    if (hd && below < hd.point[1]) below = hd.point[1];
    if (LEDGE < yNow - below && w.col.terrainHeight(ox, oy, oz, 4.0) < rec.y && this.state !== 0x20 && this.state !== 0x16 && next !== 0x20) {
      this.t = 0; this.v0 = JUMP_V0; this.charge = 0; this.jumpY = this.y0 + 4.0; this.y0 = rec.y;
      next = 0x20;
      // (FUN_004435a0(DAT_05d5802c): the jump sound handle is only set up by the skate park, 0 on the island)
    }
    if (next !== 0) { rec.anim?.start(next, 0); this.state = next; g.mailbox = next; }
    // (state 0x20: the tricks FUN_0048e840, not ported)
    // the board follows Pepper
    const board = this.board(w);
    if (board) { for (let i = 0; i < 15; i++) if (i !== 3 && i !== 7 && i !== 11) board.m[i] = rec.m[i]; board.rx = rec.rx; board.ry = rec.ry; board.rz = rec.rz; }
    // the skateboard camera: looks at 4 above Pepper, the eye eases (0.1) to (0, 12, -14) in his frame
    const c = w.camera.c;
    c[3] = rec.x; c[4] = rec.y + 4.0; c[5] = rec.z;
    const ideal = rec.toWorld(CAM_OFFSET);
    if (w.camera.vehicle) {
      const dist = Math.hypot(c[2] - c[5], c[1] - c[4], c[0] - c[3]);
      if (dist < CAM_NEAR) {
        if (this.speed <= 0) { c[0] -= c[15] * dt; c[2] -= c[17] * dt; } else { c[0] = this.vx * dt + c[0]; c[2] = this.vz * dt + c[2]; }
      }
    }
    c[0] = (ideal[0] - c[0]) * CAM_EASE + c[0];
    c[1] = (ideal[1] - c[1]) * CAM_EASE + c[1];
    c[2] = (ideal[2] - c[2]) * CAM_EASE + c[2];
    return NODE_STOP;
  }

  /** FUN_004928d2 (island): a low ceiling knocks Pepper off on a slope; stopping (speed 0) gets him off */
  private afterRide(w: World, rec: GameRecord): void {
    const board = this.board(w);
    const from = [rec.x, rec.y + 4.0, rec.z];
    const h = w.col.sweep(rec, from, [this.vx * w.dt, FEET, this.vz * w.dt], 1, RADIUS, SKIN);
    if (h && h.normal[1] < 0) {
      const d = h.normal[2] * this.vz + h.normal[1] * 0 + h.normal[0] * this.vx;
      if (d <= 0) {
        this.vx -= h.normal[0] * d; this.vz -= h.normal[2] * d;
        const up = FEET - h.normal[1] * d;
        const h2 = w.col.sweep(rec, from, [this.vx, up, this.vz], 1, RADIUS, SKIN);
        if (h2) {
          if (-1.0 < h2.normal[1]) { this.vx = 0; this.vyv = 0; this.vz = 0; }
          if (rec.m[5] < 0.8999999761581421) {
            w.pep.mailbox = 0x37; rec.anim?.start(0x37, 0);
            board?.hide();
            w.vars.set(this.var, 1);
          }
        }
      }
    }
    if (this.speed <= 0 && this.state !== 0x16 && this.state !== 0x2d && this.state !== 0x20) {
      w.pep.mailbox = 0x1c; rec.anim?.start(0x1c, 0);
      board?.anim?.start(2, 0);
      w.vars.set(this.var, 1);
    }
  }
}
