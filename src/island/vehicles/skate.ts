// The skateboard (Common\Z01BPK\c_src\skate.c, shared by the skate park mini-game z01BPK and the island). On the island the node is attached to PEPP with the
// gate PEPPER_CONTROL & 4 through FUN_0043310c (a thunk to the constructor FUN_00492cc2); handler table 0x8d2130 =
//   { update FUN_00490e2e, pre-render FUN_004928d2, destroy FUN_00492e90, draw FUN_00492c25 }
// The update: input FUN_00490cd2 (+ key ramp FUN_00490af4), the per-state logic FUN_004900d4, the state machine FUN_0048f66d, ground alignment FUN_0048e1b0,
// the rolling sounds FUN_0048fece / FUN_0048fdea.
// Every branch the code takes when CURRENT_SUBGAME == 1 (the skate park: half-pipes "QPIP", the arena bounds +-39.9 / +-24, the trick scoring) is NOT
// ported; the tricks of the air (FUN_0048e840: Space / Ctrl / Shift + a direction start a trick clip and fill the score DAT_05d58004) run on the island too
// (shared with the park: `skateTricks` of src/zones/z01bpk/skate.ts), so the landing judgement can crash (state 0x23) an unfinished trick.
// The state byte is Pepper's clip (MFIG.blk): 0x16 getting on, 0x2d push off, 0x29 rolling, 0x51 / 0x53 leaning (poses scrubbed by the steering),
// 0x2a crouch (Alt), 0x2b crouch held, 0x20 in the air, 0x21 landing, 0x23 crash, 0x1c getting off (the walk node's state, set by PepSwitc / the pre-render),
// 0x37 knocked off. The board record SBRD (DAT_009daa7c = 9) follows Pepper's matrix and plays SKBD.blk clips 1 (getting on), 2 (off), 3 (rolling), 4 (lean).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { RAMP_TABLE } from '../../game/camera.ts';
import type { AnimInstance } from '../../game/anim.ts';
import { tryCtx } from '../ctx.ts';
import { vehicles, sfx, stopSfx } from './common.ts';
import { ad, sb, ml, dv, sq, fr, fromBits } from '../../zones/common/f32.ts';
import { toWorld, normalise3 } from '../../zones/exact.ts';
import { alignAxes } from '../../game/walk.ts';
import { islandSlot2d } from './crashsound.ts';
import { ensureAnim } from '../ambient/common.ts';
import { skateTricks } from '../../zones/z01bpk/skate.ts';
import { headerOnlyCol } from '../colshapes.ts';
import { crashSoundId } from './crashsound.ts';

/** the rolling sound by surface id (FUN_004b0b37: DAT_05d57fe0 0, fd0 1 / 8, fc8 3, fd4 4, fe8 6, fcc 7, fdc 9, fd8 10) */
const ROLL_BY_SURFACE: Record<number, number> = { 0: 0x180, 1: 0x17f, 3: 0x181, 4: 0x184, 6: 0x182, 7: 0x185, 8: 0x17f, 9: 0x185, 10: 300 };
export const SKATE_ROLL_SOUNDS = [0x180, 0x17f, 0x182, 0x185, 300, 0x181, 0x184];
/** the landing sound by surface id (DAT_05d57fe4 0, ffc 1 / 8, ff0 3, 000 4, ff4 6, fec 7) */
const LAND_BY_SURFACE: Record<number, number> = { 0: 0x2c6, 1: 0x2c1, 3: 0x2c5, 4: 0x2c3, 6: 0x2c1, 7: 0x2c2, 8: 0x2c1 };
/** the states that roll (FUN_0048fece plays the surface's rolling sound in them) */
const ROLLING = [0x0e, 0x19, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2d];

const RADIUS = fr(1.399999976158142), SKIN = fr(0.20000000298023224);     // DAT_008d2120 / 8d2124 (the island's sweeps)
const FEET = fr(1.2000000476837158);                              // DAT_008920e8
const TURN = fromBits(0x3a449ba6);                                // DAT_008924f8 (0.00075)
const MAX_SPEED = 0.75, PUSH = fr(0.10000000149011612), BRAKE = fr(0.20000000298023224);
const JUMP_V0 = 15.0;                                             // DAT_008d2128 (the island: the crouch charge times 15, falling off an edge 15)
const CHARGE = fr(0.05999999865889549), CHARGE_MAX = 2.0;         // DAT_008921f8
const PUSH_TICKS = 50.0;                                          // DAT_00892254
const LEDGE = 2.0, AHEAD = 2.5;                                   // DAT_00892028 / 8920d0
const NO_GROUND = -1000.0;
const TENTH = fromBits(0x3dcccccd), SHRUG = fr(0.8999999761581421);
/** DAT_05d581f0 = FUN_00443580(0x1ab) (FUN_004b0f16, the island's sound set) */
const TRICK_SOUND = 0x1ab;
const UNSET = -107374176.0;    // a local of the original that is not written on one path: the debug heap fill 0xcccccccc read as a float
const CAM_OFFSET = [0, 12.0, -14.0], CAM_EASE = fr(0.10000000149011612), CAM_NEAR = 13.0;

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
  progress = 0;            // +0x78 (the trick progress of FUN_0048e840)
  trickRate = 0;           // +0x40 (the progress per tick of the running stunt)
  pushTimer = 0;           // +0x7c
  vx = 0; vz = 0; vyv = 0; // +0x8c / +0x94 / +0x90: the velocity of this tick

  private boardChecked = false;
  private board(w: World): GameRecord | null {
    const b = w.records[vehicles(w).board] ?? null;
    if (b && !this.boardChecked) {
      // every zone's loader loads SkBoard.col header-only (FUN_0043f700: z60FRE, z01BPK, z02LGI, z07CSI, z10RGB, z23DIP; src/island/colshapes.ts): the zones that did not strip the
      // polygons at their set-up (the hubs share this node) get the same board here
      this.boardChecked = true;
      const o = b.colObj;
      if (o && o.col.count > 0 && /skboard\.col$/i.test(o.path)) (o as { col: typeof o.col }).col = headerOnlyCol(o.col);
    }
    if (b && !b.anim) ensureAnim(w, b);      // the loader's instance (FUN_004f645b: the rig of record 9 = SKBD, clip 1, frame 0): a ride starts the board in clip 1 (getting on)
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
    if ((held & B.DOWN) !== 0 && this.state !== 0x20) { if (this.speed <= 0) this.speed = 0; else this.speed = sb(this.speed, BRAKE); }
    if (MAX_SPEED <= this.speed) this.speed = MAX_SPEED; else this.speed = ad(this.speed, PUSH);
    if (this.state !== 0x20) rec.ry = ad(ml(ml(this.steer, TURN), fr(w.dt)), rec.ry);
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

  /** FUN_004900d4 (island): the per-state work; returns the requested state (0 = none). Every operation a float32. */
  private stateWork(w: World, rec: GameRecord): number {
    const board = this.board(w);
    let next = 0, rate = 1.0, boardRate = 1.0;
    const dt = fr(w.dt), held = w.input.held, G = fr(w.gravity);
    this.rollSound(w);
    const lean = (pepClip: number) => {
      // the lean poses: Pepper's clip pepClip and the board's clip 4, both scrubbed to frame n + n * steer / 127, n = (frames - 1) * 0.5 (floats, not truncated)
      rec.anim?.start(pepClip, 0);
      board?.anim?.start(4, 0);
      const s = dv(this.steer, 127);
      const frame = (an: AnimInstance) => { const n = ml(sb(an.frameCount, 1), 0.5); return ad(ml(n, s), n); };
      if (board?.anim) board.anim.seek(frame(board.anim));
      if (rec.anim) rec.anim.seek(frame(rec.anim));
    };
    switch (this.state) {
      case 0x0e: case 0x19: case 0x2a: rate = 1.0; break;
      case 0x16: this.speed = 0; boardRate = 0.5; break;
      case 0x20: {
        // the jump arc: vy = g t + v0, y = (vy t + y0) + (g * t^2) * 0.5
        this.t = ad(ml(TENTH, dt), this.t);
        this.vy = ad(ml(this.t, G), this.v0);
        const tt = ml(this.t, this.t);
        const half = ml(ml(G, tt), 0.5);
        let y = ad(ad(ml(this.vy, this.t), this.y0), half);
        const cur = rec.y;
        if (4.0 < fr(Math.abs(sb(y, cur))) && sb(y, cur) < 0) y = sb(cur, 4.0);
        if (y < cur) this.jumpY = y;
        else {
          const d = sb(y, cur);
          const h = w.col.sweep(rec, [rec.x, ad(cur, 4.0), rec.z], [0, d, 0], 1, RADIUS, RADIUS);
          this.jumpY = h ? sb(sb(h.point[1], d), 4.0) : y;
        }
        this.grounded = 0;
        this.vx = 0; this.vyv = 0; this.vz = 0;
        if (rec.anim?.clip === 0x20) rate = 1.0; else { rate = 0; boardRate = 0; }
        break;
      }
      case 0x27: case 0x28: rate = 0; break;
      case 0x29:
        if (this.speed <= TENTH) next = 0x2d;
        vehicles(w).trickScore = 0;
        if (this.steer < 0x15 && -0x15 < this.steer) {
          if (rec.anim?.clip !== 0x29) { next = 0x29; board?.anim?.start(3, 0); }
        } else { lean(0x51); rate = 0; boardRate = 0; }
        if ((held & B.ALT) !== 0) { next = 0x2a; this.charge = TENTH; }
        this.pushTimer = ad(ml(1, dt), this.pushTimer);
        if (PUSH_TICKS < this.pushTimer) { next = 0x2d; this.pushTimer = 0; }
        break;
      case 0x2b:
        if ((held & B.ALT) === 0) {
          this.t = 0; this.v0 = ml(this.charge, JUMP_V0); this.charge = 0;
          this.jumpY = ad(this.y0, 4.0); this.y0 = rec.y;
          next = 0x20;
        } else {
          if (this.steer < 0x15 && -0x15 < this.steer) {
            if (rec.anim?.clip !== 0x2b) { next = 0x2b; board?.anim?.start(3, 0); }
          } else { lean(0x53); boardRate = 0; }
          if (this.charge < CHARGE_MAX) this.charge = ad(ml(CHARGE, dt), this.charge);
        }
        rate = 0;
        break;
      case 0x32:
        this.t = ad(ml(TENTH, dt), this.t);
        this.vy = ad(ml(this.t, G), this.v0);
        { const tt = ml(this.t, this.t), half = ml(ml(G, tt), 0.5); this.jumpY = ad(ad(ml(this.vy, this.t), this.y0), half); }
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
    const dt = fr(w.dt);
    switch (this.state) {
      case 0x0e: if (this.animResult === 2) next = 0x27; if (this.steer < 0x14) next = 0x29; break;
      case 0x19: if (this.animResult === 2) next = 0x28; if (-0x14 < this.steer) next = 0x29; break;
      case 0x27: if (this.steer < 0x14) next = 0x29; break;
      case 0x28: if (-0x14 < this.steer) next = 0x29; break;
      case 0x16: if (this.animResult === 2) { next = 0x2d; board?.anim?.start(3, 0); } break;
      case 0x20: if (this.grounded && this.onPipe) next = 0x21; break;
      case 0x21: {
        this.spin = 0;
        // FUN_004435b0(DAT_05d58020), FUN_004435b0(DAT_05d5806c): the park's handles, 0 on the island = slot 0 of the island's 2D bank (finding V12: the sound is stopped at every landing tick)
        stopSfx(w, islandSlot2d(0));
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
          if (crash) { next = 0x23; this.progress = 0; this.speed = 0; G.trickScore = 0; G.trickFlag = 0; const c = tryCtx(w), id = c ? crashSoundId(c.pe) : -1; if (id >= 0) sfx(w, id); }   // FUN_004435a0(DAT_05d58064): crashsound.ts
          this.evaluated = 1;
        }
        if (next !== 0x23) { const id = LAND_BY_SURFACE[w.col.lastSurface()]; if (id !== undefined) sfx(w, id); }
        break;
      }
      case 0x23: this.maxSpeed = MAX_SPEED; this.speed = 0; if (this.animResult === 2) next = 0x29; break;
      case 0x2a:
        if (this.charge < CHARGE_MAX) this.charge = ad(ml(CHARGE, dt), this.charge);
        if (this.animResult !== 0) {
          if ((w.input.held & B.ALT) !== 0) next = 0x2b;
          else { this.t = 0; this.v0 = ml(this.charge, JUMP_V0); this.charge = 0; this.jumpY = ad(this.y0, 4.0); this.y0 = rec.y; next = 0x20; }
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

  /** FUN_0048e1b0: the walk node's slope alignment (FUN_00429e00) with a vertical reach of 4 instead of 6 and the probes 0.8 to the sides instead of 0.12: tilt Pepper to the ground under four probes 0.8 to the sides (1.2 up) and to the front / back (2 up) */
  private alignToGround(w: World, rec: GameRecord) {
    const [Ax, Ay, Az, Bx, By, Bz] = alignAxes(w, rec, 4.0, 0.8);     // (two FUN_0043cec0 on the direction vectors)
    const m = rec.m;
    // up = back->front x left->right (not normalised), heading = (sin ry, 0, cos ry) (not normalised), heading -= (up . heading) up, then FUN_0043cec0 on it; right = up x heading (not normalised)
    const nx = sb(ml(By, Az), ml(Bz, Ay)), ny = sb(ml(Bz, Ax), ml(Bx, Az)), nz = sb(ml(Bx, Ay), ml(By, Ax));
    const hx0 = fr(Math.sin(rec.ry)), hz0 = fr(Math.cos(rec.ry));
    const d = ad(ad(ml(nx, hx0), ml(ny, 0)), ml(nz, hz0));
    const h = [sb(hx0, ml(d, nx)), sb(0, ml(d, ny)), sb(hz0, ml(d, nz))];
    normalise3(h);
    const rx = sb(ml(ny, h[2]), ml(nz, h[1])), ry = sb(ml(nz, h[0]), ml(nx, h[2])), rz = sb(ml(nx, h[1]), ml(ny, h[0]));
    m[0] = rx; m[1] = ry; m[2] = rz; m[4] = nx; m[5] = ny; m[6] = nz; m[8] = h[0]; m[9] = h[1]; m[10] = h[2];
  }

  // The board record SBRD never collides: the island's loader loads SkBoard.col header-only (FUN_0043f700, no polygons: src/island/colshapes.ts, gaps S5), so the sweeps of this
  // node, which start at Pepper's feet where the board sits, find nothing of it, exactly as in the original (it needs no flag trick).
  update(w: World, rec: GameRecord, _ctrl: Controller): number { void _ctrl; return this.ride(w, rec); }
  prerender(w: World, rec: GameRecord): void { this.afterRide(w, rec); }

  /** FUN_00490e2e (the island's branches) */
  private ride(w: World, rec: GameRecord): number {
    const g = w.pep;
    const dt = fr(w.dt);
    const sea = fr(w.seaLevel);
    let next = 0;              // local_80
    if (this.stamp !== w.frame || this.state !== g.mailbox) {
      this.animResult = 0;
      rec.show();
      this.maxSpeed = MAX_SPEED;
      this.speed = 0;
      if (g.mailbox === 1) {
        // the walk node was jumping: continue the jump on the board
        g.mailbox = 0x20; this.state = 0x20; this.t = 0; this.v0 = 20.0; this.y0 = rec.y; this.jumpY = ad(this.y0, LEDGE);
      } else if (g.mailbox !== 0) { this.state = g.mailbox; g.mailbox = 0; }
      // DAT_05d58009 (set by PeppSwit.c when Pepper fell into the void): the jump state is cleared (FUN_00490e2e)
      const V = vehicles(w);
      if (V.skateReset === 1) { this.t = 0; this.y0 = 0; this.jumpY = 0; this.v0 = 0; this.vy = 0; V.skateReset = 0; }
    }
    if (this.state !== 0x23 && this.state !== 0x16) { this.input(w, rec); this.yaw = rec.ry; }
    next = this.stateWork(w, rec);
    let ground = UNSET;          // local_2c
    let hitName = '';            // local_a8
    if (this.state !== 0x16) {
      const h = w.col.sweep(rec, [rec.x, ad(rec.y, FEET), rec.z], [0, -8.0, 0], 3, RADIUS, SKIN);
      if (!h) {
        ground = w.col.terrainHeight(rec.x, ad(rec.y, FEET), rec.z, 4.0);
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
    this.vx = ml(ml(this.speed, fx), dt); this.vyv = ml(ml(this.speed, fy), dt); this.vz = ml(ml(this.speed, fz), dt);
    // walls: slide along, a second hit stops the board
    const from = [rec.x, ad(rec.y, FEET), rec.z];
    let h = w.col.sweep(rec, from, [this.vx, this.vyv, this.vz], 3, RADIUS, SKIN);
    if (h && h.rec.name !== 'QPIP') {
      const d = ad(ad(ml(h.normal[0], this.vx), ml(h.normal[1], 0)), ml(h.normal[2], this.vz));
      this.vx = sb(this.vx, ml(h.normal[0], d)); this.vyv = sb(this.vyv, ml(h.normal[1], d)); this.vz = sb(this.vz, ml(h.normal[2], d));
      h = w.col.sweep(rec, from, [this.vx, this.vyv, this.vz], 3, RADIUS, SKIN);
      if (h) { this.vx = 0; this.vyv = 0; this.vz = 0; }
    }
    const ox = rec.x, oy = rec.y, oz = rec.z;                  // local_68 / 64 / 60
    const nx = ad(rec.x, this.vx), nz = ad(rec.z, this.vz);
    let ny = ad(rec.y, this.vyv);
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
    const px = ad(ml(rec.m[8], AHEAD), ox), py = ad(ml(rec.m[9], AHEAD), oy), pz = ad(ml(rec.m[10], AHEAD), oz);
    let below = w.col.terrainHeight(px, py, pz, 4.0);
    if (below < NO_GROUND) below = sea;
    const hd = w.col.sweep(rec, [px, ad(py, 80.0), pz], [0, -160.0, 0], 1, fromBits(0x3c23d70a), 0);   // FUN_00441a90 = FUN_00441270 with radius 0x3c23d70a and skin 0
    if (hd && below < hd.point[1]) below = hd.point[1];
    if (LEDGE < sb(yNow, below) && w.col.terrainHeight(ox, oy, oz, 4.0) < rec.y && this.state !== 0x20 && this.state !== 0x16 && next !== 0x20) {
      this.t = 0; this.v0 = JUMP_V0; this.charge = 0; this.jumpY = ad(this.y0, 4.0); this.y0 = rec.y;
      next = 0x20;
      sfx(w, islandSlot2d(0));     // FUN_004435a0(DAT_05d5802c) at 0x49222f: the park's jump handle, 0 on the island = slot 0 of the island's 2D bank (finding V12)
    }
    if (next !== 0) { rec.anim?.start(next, 0); this.state = next; g.mailbox = next; }
    // FUN_0048e840 (LE2.c:69866, not gated on CURRENT_SUBGAME): in state 0x20 the stunts of the air. `local_7c = FUN_0043b72b()` = Pepper's clip.
    // DAT_05d580a4 == 0 (the island's sound set): every stunt plays DAT_05d581f0 = sound 0x1ab instead of its own sound.
    if (this.state === 0x20) skateTricks(this, vehicles(w), w, rec, this.board(w), rec.anim?.clip ?? 0, () => sfx(w, TRICK_SOUND));
    // the board follows Pepper: the translation and the 3x3 (12 words of the matrix; the Euler fields stay)
    const board = this.board(w);
    if (board) { for (let i = 0; i < 15; i++) if (i !== 3 && i !== 7 && i !== 11) board.m[i] = rec.m[i]; }
    // the skateboard camera: looks at 4 above Pepper, the eye eases (0.1) to (0, 12, -14) in his frame
    const c = w.camera.c;
    c[3] = rec.m[12]; c[4] = ad(rec.m[13], 4.0); c[5] = rec.m[14];
    const ideal = toWorld(rec.m, CAM_OFFSET);
    if (w.camera.vehicle) {
      const dist = sq(ad(ad(ml(sb(c[0], c[3]), sb(c[0], c[3])), ml(sb(c[1], c[4]), sb(c[1], c[4]))), ml(sb(c[2], c[5]), sb(c[2], c[5]))));
      if (dist < CAM_NEAR) {
        if (this.speed <= 0) { c[0] = sb(c[0], ml(c[15], dt)); c[2] = sb(c[2], ml(c[17], dt)); } else { c[0] = ad(ml(this.vx, dt), c[0]); c[2] = ad(ml(this.vz, dt), c[2]); }
      }
    }
    c[0] = ad(ml(sb(ideal[0], c[0]), CAM_EASE), c[0]);
    c[1] = ad(ml(sb(ideal[1], c[1]), CAM_EASE), c[1]);
    c[2] = ad(ml(sb(ideal[2], c[2]), CAM_EASE), c[2]);
    return NODE_STOP;
  }

  /** FUN_004928d2 (island): a low ceiling knocks Pepper off on a slope; stopping (speed 0) gets him off */
  private afterRide(w: World, rec: GameRecord): void {
    const board = this.board(w);
    const dt = fr(w.dt);
    const from = [rec.x, ad(rec.y, 4.0), rec.z];
    const dx0 = ad(ml(this.vx, dt), 0), dz0 = ad(ml(this.vz, dt), 0);
    const h = w.col.sweep(rec, from, [dx0, FEET, dz0], 1, RADIUS, SKIN);
    if (h && h.normal[1] < 0) {
      const d = ad(ad(ml(h.normal[0], this.vx), ml(h.normal[1], 0)), ml(h.normal[2], this.vz));
      if (d <= 0) {
        this.vx = sb(this.vx, ml(h.normal[0], d)); this.vz = sb(this.vz, ml(h.normal[2], d));
        const up = sb(FEET, ml(h.normal[1], d));
        const h2 = w.col.sweep(rec, from, [ad(this.vx, 0), up, ad(this.vz, 0)], 1, RADIUS, SKIN);
        if (h2) {
          if (-1.0 < h2.normal[1]) { this.vx = 0; this.vyv = 0; this.vz = 0; }
          if (rec.m[5] < SHRUG) {
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
