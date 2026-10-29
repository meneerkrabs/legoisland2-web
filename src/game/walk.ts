// "SGwalk": Pepper walking (Common\SGGen\c_src\SGwalk.c). Ported from the decompile of
//   FUN_0042d514  the update (movement, ground following, wall sweeps, ledge detection, camera)    -> WalkNode.update
//   FUN_0042a88f  per-state transitions (input -> next state, jump arc, animation rate)           -> WalkNode.transition
//   FUN_0042a654 / FUN_0042a487  keyboard ramp -> stick -> camera relative velocity                -> WalkNode.readInput / ramp
//   FUN_0042baf6  footsteps from the animation frame                                              -> WalkNode.footsteps
//   FUN_00429e00  tilt of the character matrix to the ground                                      -> WalkNode.alignToGround
// The state byte of the node is the animation clip number of the player's rig (MFIG.blk): 0x01 jump, 0x03 idle gag (turn to the camera),
// 0x08 sneak, 0x0d walk, 0x1b idle (plays clip 0x3a), 0x24 run, 0x30 skid, 0x37 slide, 0x38 teeter on an edge, 0x57 hard landing, ...
// The state struct sits at node + 0x18; comments give the original offsets. The numbers are the original's (.rdata floats of the EXE, see
// docs/re/engine-m1.md for the list); they are plain constants here because each is a single value, not a data table.
// The pizza throw on Space (FUN_00427c15 + FUN_004277d0 / FUN_00428a0a) is a hook (`walkHooks.space`) that src/island/pizza installs. Not ported: the skateboard dismount state
// 0x1c, the camera of sub-game 9 (FUN_0042d4b1), mouse look.
import type { BehaviourNode, Controller } from './controller.ts';
import { NODE_STOP } from './controller.ts';
import type { GameRecord } from './record.ts';
import type { World } from './world.ts';
import type { CameraWalkIO } from './camera.ts';
import { RAMP_TABLE } from './camera.ts';
import { B } from './input.ts';
import { V } from './vars.ts';
import { walkSounds, landSound } from '../audio/footsteps.ts';

const fr = Math.fround;
/**
 * FUN_0043cec0: normalise in place; the sum of squares is a float32 local, k = 1 / sqrt(sum) is stored as float32, every component is stored as float32 (a zero vector is left alone).
 * The original is a debug build that stores every intermediate, see the float32 note in collision.ts.
 */
export function norm3(x: number, y: number, z: number): [number, number, number] {
  const s = fr(fr(fr(x * x) + fr(y * y)) + fr(z * z));
  if (s === 0) return [x, y, z];
  const k = fr(1 / fr(Math.sqrt(s)));
  return [fr(k * x), fr(k * y), fr(k * z)];
}

export const ST = {
  JUMP: 0x01, JUMPSTART: 0x02, TURN: 0x03, SNEAK: 0x08, THROW: 0x0b, THROW2: 0x0c, WALK: 0x0d, KNOCKBACK: 0x1a, IDLE: 0x1b, OFFBOARD: 0x1c,
  JUMP2: 0x1f, CRASH: 0x23, RUN: 0x24, OUTOFWATER: 0x25, SKID: 0x30, SLIDE: 0x37, TEETER: 0x38, RUNLEFT: 0x3f, RUNRIGHT: 0x40, THROWRUN: 0x42,
  LANDING: 0x57,
} as const;
/** hooks of other node families into the walk update: `space(w, pepper, state)` = the Space branch of FUN_0042d514 (returns the next state, 0 = keep) */
export const walkHooks: { space: ((w: World, rec: GameRecord, state: number) => number) | null } = { space: null };
/** clip number of the idle loop that state 0x1b plays (PEP_IDLE) */
export const CLIP_IDLE = 0x3a;

/** DAT_008ae088 and the other globals of the walk code (shared with the other player modes) */
/**
 * four ground probes around the feet (0.12 * the right / forward axes) give the surface normal; the matrix is rebuilt from it and the heading. Follows the machine code store by store
 * (float32 locals, FUN_0043cec0 on the two direction vectors, on the normal, on the heading and on the right axis).
 */
export function alignAxes(w: World, rec: GameRecord, reach = 6.0, side = 0.12): [number, number, number, number, number, number] {
  const sea = fr(w.seaLevel);
  const m = rec.m;
  const K = fr(side);
  // one probe: terrain height + a downward probe of everything but the ground record (the first probe tests the terrain against -1000, the others against the sea level);
  // returns the height (the original's local_30 / local_24 / local_18 / local_c)
  const probe = (x: number, y: number, z: number, first: boolean): number => {
    const h = w.col.terrainHeight(x, y, z, 4);                // local_78 = (float)FUN_0043cd62(&pos, 4.0)
    const fall = h <= sea ? -8 : fr(h - y);
    const hit = w.col.probe(rec, [x, y, z], [0, fall, 0], 3);
    if (hit) return hit.point[1];
    if (first ? h <= -1000 : h <= sea) return rec.y;
    return Math.abs(fr(y - rec.y)) <= reach ? h : rec.y;
  };
  const px = rec.x, py = rec.y, pz = rec.z;
  let rx = fr(m[0] * K), rz = fr(m[2] * K);              // local_64 / local_5c (the y component local_60 is not used)
  const lX = fr(px - rx), lZ = fr(pz - rz), lY0 = fr(py + fr(1.2));
  const lY = probe(lX, lY0, lZ, true);
  const rX = fr(rx + px), rZ = fr(rz + pz), rY0 = fr(py + fr(1.2));
  const rY = probe(rX, rY0, rZ, false);
  const ax = fr(rX - lX), ay = fr(rY - lY), az = fr(rZ - lZ);     // left -> right
  w.col.debug?.line('probe', [lX, lY, lZ], [rX, rY, rZ], 0xffffffff, 0xff000000);   // FUN_00445ba0 (LE2.c:20573): the debug-draw queue of the Ontwikkelaarshoek (null = off, no effect)
  const fx = fr(m[8] * K), fz = fr(m[10] * K);
  const bX = fr(px - fx), bZ = fr(pz - fz), bY0 = fr(py + 2);
  const bY = probe(bX, bY0, bZ, false);
  const fX = fr(fx + px), fZ = fr(fz + pz), fY0 = fr(py + 2);
  const fY = probe(fX, fY0, fZ, false);
  const bx = fr(fX - bX), by = fr(fY - bY), bz = fr(fZ - bZ);     // back -> front
  w.col.debug?.line('probe', [bX, bY, bZ], [fX, fY, fZ], 0xffff0000, 0xff00ff00);   // FUN_00445ba0 (LE2.c:20644)
  const [Bx, By, Bz] = norm3(bx, by, bz);
  const [Ax, Ay, Az] = norm3(ax, ay, az);
  return [Ax, Ay, Az, Bx, By, Bz];
}

export function alignRecordToGround(w: World, rec: GameRecord, reach = 6.0, side = 0.12) {
  const m = rec.m;
  const [Ax, Ay, Az, Bx, By, Bz] = alignAxes(w, rec, reach, side);
  // up = back->front x left->right
  let nx = fr(fr(By * Az) - fr(Bz * Ay)), ny = fr(fr(Bz * Ax) - fr(Bx * Az)), nz = fr(fr(Bx * Ay) - fr(By * Ax));
  let hx = fr(Math.sin(rec.ry)), hy = 0, hz = fr(Math.cos(rec.ry));
  // FUN_0043cec0(&up) (0x42a3a5): the cross product of two unit vectors that are not perpendicular is shorter than 1; the original normalises it before use and before storing it
  [nx, ny, nz] = norm3(nx, ny, nz);
  // d = up . heading (0x42a3c3)
  const d = fr(fr(fr(nx * hx) + fr(ny * hy)) + fr(nz * hz));
  hx = fr(hx - fr(d * nx)); hy = fr(hy - fr(d * ny)); hz = fr(hz - fr(d * nz));
  [hx, hy, hz] = norm3(hx, hy, hz);
  let qx = fr(fr(ny * hz) - fr(nz * hy)), qy = fr(fr(nz * hx) - fr(nx * hz)), qz = fr(fr(nx * hy) - fr(ny * hx));       // right = up x heading
  [qx, qy, qz] = norm3(qx, qy, qz);
  m[0] = qx; m[1] = qy; m[2] = qz;
  m[4] = nx; m[5] = ny; m[6] = nz;
  m[8] = hx; m[9] = hy; m[10] = hz;
}

export class PepperGlobals {
  /** DAT_008ae088: state mailbox / mirror of the current state (0x1b at set-up) */
  mailbox = 0x1b;
  /** DAT_009da9c4: footstep phase 0..2, DAT_009da8ec: animation wrapped flag, DAT_009da9c0: variant counter 0..15 */
  footPhase = 0; footWrapped = 0; footIdx = 0;
  /** DAT_009da958: take-off / landing sound state 0..2 */
  landSnd = 0;
  /** DAT_009da9b4: the ground sweep hit something other than the ground record */
  onObject = false;
  /** DAT_009da9ac / DAT_009da9b0: surface ids */
  surfaceAtFeet = 0; lastSurface = 0;
  /** DAT_009da9a8: velocity handed over by the node that requests the jump state (null = keep) */
  jumpVelocity: [number, number, number] | null = null;
}

/** the 16-step sound variant patterns of the footstep tables (DAT_008ae11c / 12c / 13c / 14c / 15c / 17c), values 1..4 */
const PATTERN_ROAD = [1, 2, 3, 4, 1, 4, 3, 2, 1, 2, 4, 1, 3, 2, 1, 4];
const PATTERN_GRASS = [1, 2, 3, 4, 1, 4, 3, 2, 1, 2, 3, 4, 3, 2, 1, 4];
const PATTERN_PLASTIC = [1, 2, 4, 2, 4, 2, 1, 2, 1, 2, 4, 3, 4, 1, 4, 2];
function patternFor(surface: number): number[] {
  switch (surface) {
    case 0: return PATTERN_GRASS;
    case 7: return PATTERN_PLASTIC;
    default: return PATTERN_ROAD;
  }
}

/** sound table ids (SND_PEPP_*): jump, skid, idle gag, teeter on an edge, leaving the water */
export const SND = { JUMP: 302, DOUBLE_JUMP: 751, SKID: 261, IDLE: 301, TEETER: 895, LEAVE_WATER: 296, DIVE: 294, SWIM: 295 };

export class WalkNode implements BehaviourNode, CameraWalkIO {
  readonly kind = 'SGwalk';
  var: number; mask: number; value: number;
  stamp = 0xfffffffe;
  // ---- state struct (node + 0x18 ...)
  state: number = ST.IDLE;       // +0x18
  shift = 0;                      // +0x19: velocity divisor 1 << shift
  animResult = 0;                 // +0x1a: result of the last animation advance (1 looped, 2 one-shot ended)
  hideFlag = 0;                   // +0x1b
  landFlag = 0;                   // +0x1c
  dirFlag = 0;                    // +0x1e: direction of the idle turn
  slideFlag = 0;                  // +0x1f
  rampX = 16; stickX = 0;         // +0x20 / +0x24
  rampY = 16; stickY = 0;         // +0x28 / +0x2c
  camRampX = 16; camStickX = 0;   // +0x30 / +0x34
  camRampY = 16; camStickY = 0;   // +0x38 / +0x3c
  idleTimer = 0;                  // +0x40
  runTimer = 0;                   // +0x44
  t = 0;                          // +0x50: jump time (0 = on the ground)
  y0 = 0;                         // +0x54: height at take-off
  yJump = 0;                      // +0x58: height on the arc
  v0 = 0;                         // +0x5c: take-off speed
  vJump = 0;                      // +0x60: vertical speed on the arc
  speed = 0;                      // +0x64: speed factor 0..1 (negative while sliding back)
  vx = 0; vy = 0; vz = 0;         // +0x68 / +0x6c / +0x70: velocity per tick
  /** record whose visibility is tied to the walk state (DAT_009daa7c, the skateboard in the island) */
  accessory: GameRecord | null = null;
  /** pad analogue stick (-128..127) for gamepads; 0 for the keyboard */
  padX = 0; padY = 0;

  constructor(v: number = V.PEPPER_CONTROL, mask = 1, value = 1) { this.var = v; this.mask = mask; this.value = value; }

  // ----------------------------------------------------------------------------------------------- input (FUN_0042a487 / FUN_0042a654)
  /** FUN_0042a487: the key ramp. Holding a direction moves the index by 3 per tick towards 0 / 32, releasing returns by 4 to the centre 16 */
  private ramp(held: number) {
    let rx = this.rampX, ry = this.rampY, b1 = false, b2 = false;
    if (held & B.LEFT) { b1 = true; rx = rx < 0x11 ? rx - 3 : 0x10; if (rx < 1) rx = 0; }
    if (held & B.RIGHT) { b1 = true; rx = rx < 0x10 ? 0x10 : rx + 3; if (rx > 0x1f) rx = 0x20; }
    if (held & B.UP) { b2 = true; ry = ry < 0x11 ? ry - 3 : 0x10; if (ry < 1) ry = 0; }
    if (held & B.DOWN) { b2 = true; ry = ry < 0x10 ? 0x10 : ry + 3; if (ry > 0x1f) ry = 0x20; }
    if (!b1) {
      if (rx > 0x10) { rx -= 4; if (rx < 0x10) rx = 0x10; }
      if (rx < 0x10) { rx += 4; if (rx > 0x10) rx = 0x10; }
    }
    if (!b2) {
      if (ry > 0x10) { ry -= 4; if (ry < 0x10) ry = 0x10; }
      if (ry < 0x10) { ry += 4; if (ry > 0x10) ry = 0x10; }
    }
    this.rampY = ry; this.stickY = RAMP_TABLE[ry] - 128;
    this.rampX = rx; this.stickX = RAMP_TABLE[rx] - 128;
  }

  /** FUN_0042a654: stick -> camera relative velocity direction and speed factor; true when the stick is outside the dead zone (+-32) */
  private readInput(w: World): boolean {
    let moving = false;
    const st = this.state;
    if (st !== ST.JUMP && st !== ST.JUMP2 && st !== ST.LANDING) {
      this.vx = 0; this.vy = 0; this.vz = 0; this.speed = 0;
      this.ramp(w.input.held);
      if (this.padX > 0x20 || this.padX < -0x20 || this.padY > 0x20 || this.padY < -0x20) { this.stickX = this.padX; this.stickY = this.padY; }
      if (this.stickX > 32 || this.stickX < -32 || this.stickY > 32 || this.stickY < -32) {
        const c = w.camera.c;     // DAT_009da60c (right.x), 614 (right.z), 624 (forward.x), 62c (forward.z)
        this.vx = fr(fr((this.stickX / 128) * fr(c[9])) + this.vx);
        this.vz = fr(fr(-(this.stickY / 128) * fr(c[17])) + this.vz);
        this.vx = fr(fr(-(this.stickY / 128) * fr(c[15])) + this.vx);
        this.vz = fr(fr((this.stickX / 128) * fr(c[11])) + this.vz);
        this.vy = 0;
        this.speed = fr(Math.sqrt(fr(fr(fr(this.vx * this.vx) + fr(this.vy * this.vy)) + fr(this.vz * this.vz))));
        [this.vx, this.vy, this.vz] = norm3(this.vx, this.vy, this.vz);
        if (!(this.speed <= 1)) this.speed = 1;
        moving = true;
      }
    }
    if (st === ST.KNOCKBACK || st === ST.OFFBOARD || st === ST.SLIDE || st === ST.TEETER) moving = false;
    return moving;
  }

  // ----------------------------------------------------------------------------------------------- footsteps (FUN_0042baf6)
  /** a step sound when the animation passes frame 6 and 16 (walk) / 4 and 14 (run), variant from the 16 step pattern of the surface under the feet */
  private footsteps(w: World, rec: GameRecord, st: number) {
    const g = w.pep;
    g.lastSurface = w.col.lastSurface();
    const frame = Math.trunc(rec.anim?.frame ?? 0);
    let fire = false;
    switch (st) {
      case ST.SNEAK: case ST.WALK:
        if (g.footPhase === 0) { g.footWrapped = 0; fire = frame > 6; if (fire) g.footPhase = 1; }
        else if (g.footPhase === 1) { fire = frame > 0x10; if (fire) g.footPhase = 2; }
        else if (g.footPhase === 2 && g.footWrapped !== 0) g.footPhase = 0;
        break;
      case ST.RUN: case ST.RUNLEFT: case ST.RUNRIGHT: case ST.THROWRUN:
        if (g.footPhase === 0) { g.footWrapped = 0; fire = frame > 4; if (fire) g.footPhase = 1; }
        else if (g.footPhase === 1) { fire = frame > 0xe; if (fire) g.footPhase = 2; }
        else if (g.footPhase === 2 && g.footWrapped !== 0) g.footPhase = 0;
        break;
    }
    if (!fire) return;
    const list = walkSounds(g.lastSurface);
    const k = patternFor(g.lastSurface)[g.footIdx] - 1;
    if (list) w.playSound(list[k] ?? list[0]);
    // surface 8 (decking on the island) adds the matching SND_WALK_BRIDGE1..4 (ids 271..274) to the road step
    if (g.lastSurface === 8) w.playSound(271 + k);
    g.footIdx++;
    if (g.footIdx > 0xf) g.footIdx = 0;
  }

  // ----------------------------------------------------------------------------------------------- slope alignment (FUN_00429e00)
  /**
   * four ground probes around the feet (0.12 * the right / forward axes) give the surface normal; the matrix is rebuilt from it and the heading. Follows the machine code store by store
   * (float32 locals, FUN_0043cec0 on the two direction vectors, on the normal, on the heading and on the right axis).
   */
  alignToGround(w: World, rec: GameRecord) { alignRecordToGround(w, rec); }

  // ----------------------------------------------------------------------------------------------- transitions (FUN_0042a88f)
  /** the jump arc shared by states 1 and 0x1f: y = y0 + (v0 + g t) t + g t^2 / 2 with t += 0.1 per tick (the original's formula, not a physical one) */
  private jumpArc(w: World, rec: GameRecord) {
    const g = fr(w.gravity), dt = fr(w.dt);
    this.t = fr(fr(fr(0.1) * dt) + this.t);
    const l8c = fr(this.t * g);
    this.vJump = fr(l8c + this.v0);                       // node +0x60
    const l9c = fr(this.t * this.t);
    const la0 = fr(fr(g * l9c) * 0.5);
    const l84 = fr(this.vJump * this.t);
    const cy = rec.y;
    let y = fr(fr(l84 + this.y0) + la0);                  // local_88
    if (4 < Math.abs(fr(y - cy)) && fr(y - cy) <= 0) y = fr(cy - 4);      // at most 4 units of fall per tick
    if (y < cy) this.yJump = y;
    else {
      // rising: sweep the head against the ceiling (mask 1, from 4 above the feet, up by the distance still to rise)
      const hit = w.col.sweep(rec, [rec.x, fr(cy + 4), rec.z], [0, fr(y - cy), 0], 1, 0.6, 0.2);
      this.yJump = hit ? fr(fr(hit.point[1] - fr(y - cy)) - 4) : y;
    }
  }

  private startJump(rec: GameRecord) { this.animResult = 0; this.t = 0; this.v0 = 15; this.y0 = rec.y; }

  /** FUN_0042a88f: returns the new state (0 = keep) and advances the clip */
  private transition(w: World, rec: GameRecord): number {
    const st = this.state;
    const pressed = w.input.pressed;
    const sub = w.vars.get(V.CURRENT_SUBGAME);
    const altJump = (pressed & B.ALT) !== 0 && sub !== 0x11 && sub !== 3;
    const g = w.pep;
    const c = w.camera.c;
    const dt = fr(w.dt);
    let next = 0;
    let rate = 1.0;
    switch (st) {
      case ST.JUMP:
        this.landFlag = 0;
        this.jumpArc(w, rec);
        rate = this.animResult === 1 ? 0 : 1.0;
        this.shift = 0;
        if (altJump) { next = ST.JUMP2; this.animResult = 0; this.t = fr(fr(0.1) * dt); this.v0 = 17.5; this.y0 = this.yJump; w.playSound(SND.DOUBLE_JUMP); }   // 0x42b477: DAT_009da968 = sound 0x2ef
        if (g.landSnd === 0) { w.playSound(SND.JUMP); g.landSnd = 1; }
        break;
      case ST.JUMP2:
        this.jumpArc(w, rec);
        rate = this.animResult === 0 ? 1.0 : 0;
        this.shift = 0;
        break;
      case ST.TURN: {
        // turn on the spot until the character faces the camera (right . -cameraForward)
        const tx = -fr(c[15]), ty = -fr(c[16]), tz = -fr(c[17]);
        const dot = fr(fr(fr(rec.m[0] * tx) + fr(rec.m[1] * ty)) + fr(rec.m[2] * tz));
        if (this.dirFlag === 0) { if (dot > 0) rec.ry = fr(rec.ry - fr(fr(0.1745319962501526) * dt)); }
        else if (dot >= 0) this.dirFlag = 0;
        else rec.ry = fr(fr(fr(0.1745319962501526) * dt) + rec.ry);
        rec.rebuildYaw();
        w.playSound(SND.IDLE);
        break;
      }
      case ST.SNEAK:
        if (altJump) { next = ST.JUMP; this.startJump(rec); }
        if (this.speed >= fr(0.01)) { if (this.speed > fr(0.05)) next = ST.WALK; } else next = ST.IDLE;
        this.shift = 0; rate = 1.0;
        this.footsteps(w, rec, st);
        break;
      case ST.THROW:
        this.speed = 0; this.t = 0; this.v0 = 15;
        break;
      case ST.THROW2: this.speed = 0; break;
      case ST.WALK:
        if (altJump) { next = ST.JUMP; this.startJump(rec); }
        if (this.speed >= fr(0.05)) { if (this.speed >= fr(0.4)) next = ST.RUN; } else next = ST.SNEAK;
        this.shift = 0; rate = 1.0;
        this.footsteps(w, rec, st);
        break;
      case ST.KNOCKBACK:
        // thrown backwards: velocity = -2 * forward, speed 0.05, with the jump arc while t != 0
        this.vx = -fr(rec.m[8] + rec.m[8]); this.vy = -fr(rec.m[9] + rec.m[9]); this.vz = -fr(rec.m[10] + rec.m[10]);
        this.speed = fr(0.05);
        if (this.t !== 0) {
          this.t = fr(fr(fr(0.01) * dt) + this.t);
          this.vJump = fr(fr(this.t * fr(w.gravity)) + this.v0);
          const l60 = fr(this.t * this.t);
          this.yJump = fr(fr(fr(this.vJump * this.t) + this.y0) + fr(fr(fr(w.gravity) * l60) * 0.5));      // node +0x58 (param_1 + 0x40 of FUN_0042a88f), not the record's height
        }
        this.shift = 0; rate = 1.0;
        break;
      case ST.IDLE: {
        if (this.speed >= fr(0.01)) next = ST.SNEAK;
        if ((rec.anim?.clip ?? CLIP_IDLE) !== CLIP_IDLE) rec.anim?.start(CLIP_IDLE, 0);
        this.idleTimer = fr(this.idleTimer + 1);
        if (this.idleTimer > 1000) {
          next = ST.TURN; this.idleTimer = 0;
          const dot = fr(fr(fr(rec.m[0] * -fr(c[15])) + fr(rec.m[1] * -fr(c[16]))) + fr(rec.m[2] * -fr(c[17])));
          this.dirFlag = dot >= 0 ? 0 : 1;
        }
        if (altJump) next = ST.JUMPSTART;
        this.shift = 0;
        rate = rec.anim?.clip === CLIP_IDLE ? fr(0.666) : 0;
        if (this.accessory) this.accessory.hide();
        break;
      }
      case ST.RUN: case ST.RUNLEFT: case ST.RUNRIGHT:
        if (altJump) { next = ST.JUMP; this.startJump(rec); }
        this.runTimer = fr(this.runTimer + 1);
        if (this.speed >= fr(0.4) || this.runTimer < 200) {
          if (this.speed < fr(0.4) && this.runTimer < 200) { next = ST.WALK; this.runTimer = 0; }
        } else { next = ST.SKID; this.runTimer = 0; }
        // the run variants follow the camera stick (which the camera scales down to +-3.2, so they fall back to the plain run)
        if (this.camStickX > 96 && st !== ST.RUNLEFT && st !== ST.RUNRIGHT) next = ST.RUNRIGHT;
        else if (this.camStickX < -96 && st !== ST.RUNLEFT && st !== ST.RUNRIGHT) next = ST.RUNLEFT;
        else if (this.camStickX > -32 && this.camStickX < 32 && st !== ST.RUN) next = ST.RUN;
        this.shift = 0; rate = 1.25;
        this.footsteps(w, rec, st);
        break;
      case ST.OUTOFWATER: this.speed = 0; rate = 1.0; break;
      case ST.OFFBOARD:
        // getting off the skateboard (0x1c, set by the island's skateboard node): no movement, the accessory record's own clip advances (its result is the hide flag at node + 0x1b)
        this.vx = 0; this.vy = 0; this.vz = 0; this.speed = 0;
        rate = 1.0;
        this.hideFlag = this.accessory?.anim ? this.accessory.anim.advance(1.0, w.dt) : 0;
        break;
      case ST.SKID:
        this.vx = rec.m[8]; this.vy = rec.m[9]; this.vz = rec.m[10];
        rate = fr(1.2); this.speed = fr(0.1); this.shift = 0;
        if ((rec.anim?.frame ?? 0) <= 10) w.playSound(SND.SKID);
        break;
      case ST.SLIDE: {
        if (this.slideFlag === 0 && this.speed >= fr(0.01)) next = ST.SNEAK;
        if (this.accessory) this.accessory.hide();
        const ux = rec.m[4], uy = rec.m[5], uz = rec.m[6];
        if (uy < fr(0.9)) {
          // slide down the slope: velocity = the horizontal part of the surface normal (FUN_0043cec0)
          [this.vx, this.vy, this.vz] = norm3(ux, 0, uz);
        }
        this.shift = 0; this.speed = 0.5; rate = 1.0;       // the speed word is set to 0x3f000000 (0.5); the animation rate is 1.0
        break;
      }
      case ST.TEETER:
        if (this.speed >= fr(0.01)) next = ST.SNEAK;
        break;
      case ST.THROWRUN:
        this.shift = 0; rate = 1.25;
        this.footsteps(w, rec, st);
        break;
      case ST.LANDING:
        if (this.speed >= fr(0.4)) next = ST.RUN;
        if (g.landSnd === 1) {
          g.lastSurface = w.col.lastSurface();
          const snd = landSound(g.lastSurface);
          if (snd !== null) w.playSound(snd);
          g.landSnd = 2;
        }
        break;
      default: break;
    }
    if (g.landSnd === 2 && st !== ST.LANDING) g.landSnd = 0;
    if ((rec.anim?.clip ?? 0) === 99) { this.vx = 0; this.vy = 0; this.vz = 0; rate = 1.5; }
    // the clip advances here, before the rest of the update changes state (FUN_0042a88f ends with FUN_0043b76a)
    if (rate !== 0 && rec.anim) this.animResult = rec.anim.advance(rate, w.dt);
    return next;
  }

  // ----------------------------------------------------------------------------------------------- update (FUN_0042d514)
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    const g = w.pep;
    const dt = fr(w.dt);
    const anim = rec.anim;
    const subgame = w.vars.get(V.CURRENT_SUBGAME);
    const grav = fr(w.gravity), sea = fr(w.seaLevel);
    let next = 0;           // local_74
    let camMode = 0;        // local_48
    // ---- state mailbox: another node (or this one, last tick) asked for a state
    if (this.stamp !== w.frame || this.state !== g.mailbox) {
      this.idleTimer = 0; this.speed = 0; this.slideFlag = 0;
      if (g.mailbox === ST.OUTOFWATER) { this.t = 0; this.y0 = 0; this.yJump = 0; this.v0 = 0; this.vJump = 0; }
      if (g.mailbox === ST.JUMP) {
        this.state = ST.JUMP; this.t = 0; this.v0 = 15; this.y0 = rec.y; this.yJump = fr(this.y0 + 2.0);
        if (w.pep.jumpVelocity) { this.vx = w.pep.jumpVelocity[0]; this.vy = w.pep.jumpVelocity[1]; this.vz = w.pep.jumpVelocity[2]; w.pep.jumpVelocity = null; }
      } else if (g.mailbox !== 0) {
        if (g.mailbox === ST.IDLE) { this.t = 0; this.y0 = 0; this.yJump = 0; this.v0 = 0; this.vJump = 0; }
        this.state = g.mailbox;
        g.mailbox = 0;
      }
    }
    if (anim && anim.clip !== this.state && anim.clip !== CLIP_IDLE) anim.start(this.state, 0);
    // the original calls the input reader only in some states; in the others its result variable is the debug heap fill (non-zero = "moving")
    let moving = true;
    if (this.state !== ST.OUTOFWATER && this.state !== ST.OFFBOARD && this.state !== ST.KNOCKBACK && this.state !== ST.JUMPSTART && this.slideFlag === 0) {
      moving = this.readInput(w);

    }
    const x0 = rec.x, y0 = rec.y, z0 = rec.z;      // local_68 / local_64 / local_60
    const terrain0 = w.col.terrainHeight(x0, y0, z0, 4);       // local_84
    next = this.transition(w, rec);
    // ---- a one-shot clip ended: where to go next
    if (this.animResult === 2) {
      g.footWrapped = 1;
      switch (this.state) {
        case ST.JUMP: if (anim && anim.clip === 99) anim.start(0x62, 0); break;   // the dive jump clip continues with its landing clip
        case ST.JUMPSTART:
          next = ST.JUMP; this.animResult = 0; this.t = 0; this.v0 = 15; this.y0 = rec.y; this.yJump = fr(this.y0 + 2.0);
          break;
        case ST.TURN: case ST.THROW: case ST.THROW2: case ST.OFFBOARD: case ST.CRASH: case ST.SKID: case ST.LANDING:
          next = ST.IDLE; break;
        case ST.KNOCKBACK:
          next = ST.IDLE; this.t = 0; this.y0 = 0; this.yJump = 0; this.v0 = 0; this.vJump = 0; break;
        case ST.OUTOFWATER: w.playSound(SND.LEAVE_WATER); next = ST.IDLE; break;
        case ST.SLIDE: this.slideFlag = 0; next = ST.IDLE; break;
        case ST.TEETER:
          if (this.landFlag === 0) { next = ST.IDLE; this.landFlag = 1; }
          else {
            next = ST.JUMP; this.animResult = 0; this.landFlag = 0; this.idleTimer = fr(this.idleTimer + fr(0.1)); this.t = 0; this.v0 = 15; this.y0 = rec.y;
            this.yJump = fr(this.y0 + 2.0); this.vx = rec.m[8]; this.vy = rec.m[9]; this.vz = rec.m[10];
          }
          break;
        case ST.THROWRUN: next = ST.RUN; break;
      }
    }
    if (this.hideFlag !== 0 && this.accessory) this.accessory.hide();
    // ---- Space (0x42da7d): the pizza throw prelude FUN_00427c15 and the launch / hand-over (src/island/pizza/throw.ts installs walkHooks.space)
    if ((w.input.pressed & B.SPACE) !== 0 && walkHooks.space && this.state !== ST.JUMP && this.state !== ST.JUMP2 && this.state !== ST.LANDING) {
      const n = walkHooks.space(w, rec, this.state);
      if (n !== 0) next = n;
    }
    // ---- heading: turn towards the movement direction (at most 0.349 rad per tick when turning right; the original does not wrap the angle)
    if (!moving || this.state === ST.TURN || this.state === ST.KNOCKBACK || this.state === ST.OUTOFWATER) {
      if (this.state === ST.JUMP || this.state === ST.JUMP2 || this.state === ST.LANDING) rec.rebuildYaw();
    } else {
      const ax = fr(this.vx * dt), az = fr(this.vz * dt);       // local_a8 / local_a0
      const sp = Math.sqrt(fr(fr(fr(this.vx * this.vx) + fr(this.vy * this.vy)) + fr(this.vz * this.vz)));
      if (0 < sp) {
        const fwd = fr(fr(fr(rec.m[8] * ax) + 0) + fr(rec.m[10] * az));          // (x, y, z order of the machine code; the decompile lists the terms reversed)
        if (fwd <= fr(0.9)) {
          const maxTurn = fr(fr(0.3490639925003052) * dt);
          const diff = fr(Math.atan2(ax, az) - rec.ry);        // local_cc: not wrapped
          const step = maxTurn <= diff ? maxTurn : fr(Math.abs(diff));
          if (fr(fr(fr(rec.m[0] * ax) + 0) + fr(rec.m[2] * az)) <= 0) rec.ry = fr(rec.ry - step); else rec.ry = fr(step + rec.ry);
        } else rec.ry = fr(Math.atan2(ax, az));
        rec.rebuildYaw();
      }
    }
    // ---- ground following: sweep down (mask 3, radius 0.6, skin 0.2); in the air only along the arc
    const airborne = this.state === ST.JUMP || this.state === ST.JUMP2;
    let l64 = rec.y;                      // local_64
    let dX = 0, dY = -8, dZ = 0;
    if (airborne) {
      let d = fr(this.yJump - rec.y);
      if (fr(-0.6) < d) d = fr(-0.6);
      dY = d; dX = fr(fr(this.vx * dt) + 0); dZ = fr(fr(this.vz * dt) + 0);
    } else l64 = fr(l64 + 4);
    const hit = w.col.sweep(rec, [x0, l64, z0], [dX, dY, dZ], 3, 0.6, 0.2);
    g.surfaceAtFeet = w.col.lastSurface();
    let groundY: number;
    if (!hit || 0 <= dY || hit.normal[1] <= fr(0.01)) groundY = terrain0;
    else {
      groundY = hit.point[1];
      if (this.t === 0 || hit.point[1] < this.yJump) { if (this.t === 0) { l64 = hit.point[1]; rec.y = hit.point[1]; } }
      else { l64 = hit.point[1]; rec.y = hit.point[1]; }
      g.onObject = hit.rec !== w.col.groundRec;
    }
    if (this.t === 0) {
      if (!hit) rec.y = groundY <= sea ? sea : groundY;
    } else if (this.yJump <= groundY) {
      if (this.yJump - rec.y < 0 && this.yJump < groundY) {
        // reached the ground: hard landing
        rec.y = groundY; next = ST.LANDING;
        this.t = 0; this.y0 = 0; this.yJump = 0; this.v0 = 0; this.vJump = 0;
      }
    } else rec.y = this.yJump;
    // the original calls the terrain ray once more here (FUN_0043cd62(&local_68, 4.0) at 0x42dd..: from the start position, result unused): it refreshes the hit cache of FUN_00441b10
    w.col.terrainHeight(x0, l64, z0, 4);
    // ---- tilt to the slope while moving on the ground
    if (!airborne && this.speed > fr(0.01) && !g.onObject) this.alignToGround(w, rec);
    // ---- steep slopes: slow down walking up, slide down when standing
    if (this.state !== ST.SLIDE && !airborne && this.state !== ST.TEETER && this.state !== ST.SKID && !g.onObject) {
      const up = rec.m[5];
      if (this.speed <= 0 || fr(0.85) <= up || rec.m[9] < 0) {
        if (this.speed === 0 && up < fr(0.85)) { next = ST.SLIDE; rec.ry = fr(Math.atan2(-rec.m[4], -rec.m[6])); }
      } else {
        this.speed = fr(this.speed - fr(1.0 / fr(up + fr(1.1))));
        if (this.speed < fr(-0.25)) this.speed = fr(-0.25);
      }
    }
    // ---- velocity = direction * speed / 2^shift
    if (!airborne) {
      const k = 1.0 / (1 << (this.shift & 0x1f));
      this.vx = fr(fr(k * this.vx) * this.speed);
      this.vz = fr(fr(k * this.vz) * this.speed);
      this.vy = 0;
    }
    // ---- camera mode: too far (> 28) -> 1, too near (< 12) while pulling back -> 2
    {
      const c = w.camera.c;
      const lx = fr(rec.x - fr(c[0])), lz = fr(rec.z - fr(c[2]));
      const dd = fr(Math.sqrt(fr(fr(fr(lx * lx) + 0) + fr(lz * lz))));
      if (dd >= 12 || this.stickY <= 32) { if (dd > 28) camMode = 1; } else camMode = 2;
    }
    // ---- ledge: the ground more than 2 below the next position -> teeter, or jump / fall when running
    {
      const y6 = rec.y;
      const nx = fr(fr(this.vx * dt) + x0), nz = fr(fr(this.vz * dt) + z0);
      let below = w.col.terrainHeight(nx, y6, nz, 4);
      const pr = w.col.probe(rec, [nx, fr(y6 + 80), nz], [0, -160, 0], 1);
      if (pr && below < pr.point[1]) below = pr.point[1];
      const st = this.state;
      const noLedge = st === ST.TEETER || st === ST.JUMP || st === ST.JUMPSTART || st === ST.LANDING || st === ST.JUMP2 || st === ST.KNOCKBACK || st === ST.OFFBOARD || st === ST.SLIDE;
      if (2 < fr(y6 - below) && below < rec.y && sea < rec.y && !noLedge && subgame !== 3) {
        if (this.speed >= fr(0.4) || this.landFlag !== 0) {
          if (this.speed > fr(0.4) || (this.speed > fr(0.01) && this.landFlag !== 0)) { next = ST.JUMP; this.animResult = 0; this.t = 0; this.v0 = 15; this.y0 = rec.y; this.yJump = fr(this.y0 + 2.0); }
        } else { this.vx = 0; this.vy = 0; this.vz = 0; next = ST.TEETER; w.playSound(SND.TEETER); }
      }
    }
    // ---- wall sweeps (mask 1): sphere at chest height, then above the head
    {
      let from: number[], delta: number[];
      if (airborne) {
        let dy = fr(this.yJump - rec.y); if (fr(-0.76) < dy) dy = fr(-0.76);
        from = [x0, fr(l64 + fr(0.6)), z0]; delta = [fr(this.vx * dt), dy, fr(this.vz * dt)];
      } else { from = [rec.x, fr(rec.y + fr(1.48)), rec.z]; delta = [fr(this.vx * dt), 0, fr(this.vz * dt)]; }
      let h1 = w.col.sweep(rec, from, delta, 1, 0.6, 0.2);
      if (h1 && h1.normal[1] < 1.0 && !h1.rec.name.startsWith('PAG')) {
        const dot = fr(fr(fr(h1.normal[0] * this.vx) + fr(h1.normal[1] * this.vy)) + fr(h1.normal[2] * this.vz));
        this.vx = fr(this.vx - fr(h1.normal[0] * dot)); this.vz = fr(this.vz - fr(h1.normal[2] * dot));
        const h2 = w.col.sweep(rec, from, [this.vx, this.vy, this.vz], 3, 0.6, 0.2);
        if (h2) { this.vx = 0; this.vy = 0; this.vz = 0; }
      }
      const head = [rec.x, fr(rec.y + 4.0), rec.z];
      h1 = w.col.sweep(rec, head, [fr(fr(this.vx * dt) + 0), 1.2, fr(fr(this.vz * dt) + 0)], 1, 0.6, 0.2);
      if (h1 && h1.normal[1] < 0) {
        const dot = fr(fr(fr(h1.normal[0] * this.vx) + fr(h1.normal[1] * 0)) + fr(h1.normal[2] * this.vz));
        if (dot < 0) {
          this.vx = fr(this.vx - fr(h1.normal[0] * dot)); this.vz = fr(this.vz - fr(h1.normal[2] * dot));
          const h2 = w.col.sweep(rec, head, [this.vx, 1.2, this.vz], 1, 0.6, 0.2);
          if (h2 && this.state !== ST.SLIDE) {
            if (-1 < h2.normal[1]) { this.vx = 0; this.vy = 0; this.vz = 0; }
            if (rec.m[5] < fr(0.9)) { next = ST.SLIDE; this.slideFlag = 1; }
          }
        }
      }
    }
    if (this.state !== ST.TEETER) { rec.x = fr(fr(this.vx * dt) + rec.x); rec.z = fr(fr(this.vz * dt) + rec.z); }
    // ---- state change: restart the clip, remember the state in the mailbox
    if (next !== 0) {
      this.idleTimer = 0;
      this.state = next;
      g.mailbox = next;
      anim?.start(next, 0);
    }
    void grav; void y0;
    // ---- camera. Sub-game 9 (the cannon duel's bridge): the original moves the camera with Pepper's velocity instead (FUN_0042d4b1: eye and target += v * dt, then eye height y + 8, target height y);
    // that is done by the zone's own node (src/zones/z10rgb), not here (m7-walk-states checks the formula against the original with the camera fields excluded)
    if (subgame !== 9) w.camera.chase(w, rec, camMode, this);
    return NODE_STOP;
  }
}
