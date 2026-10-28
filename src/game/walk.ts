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
// Not ported: pizza throw / talk (Space calls FUN_00427c15, which returns 0 while no pizza or NPC target exists), the skateboard dismount state
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

export const ST = {
  JUMP: 0x01, JUMPSTART: 0x02, TURN: 0x03, SNEAK: 0x08, THROW: 0x0b, THROW2: 0x0c, WALK: 0x0d, KNOCKBACK: 0x1a, IDLE: 0x1b, OFFBOARD: 0x1c,
  JUMP2: 0x1f, CRASH: 0x23, RUN: 0x24, OUTOFWATER: 0x25, SKID: 0x30, SLIDE: 0x37, TEETER: 0x38, RUNLEFT: 0x3f, RUNRIGHT: 0x40, THROWRUN: 0x42,
  LANDING: 0x57,
} as const;
/** clip number of the idle loop that state 0x1b plays (PEP_IDLE) */
export const CLIP_IDLE = 0x3a;

/** DAT_008ae088 and the other globals of the walk code (shared with the other player modes) */
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
export const SND = { JUMP: 302, SKID: 261, IDLE: 301, TEETER: 895, LEAVE_WATER: 296, DIVE: 294, SWIM: 295 };

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
        this.vx = ((this.stickX * 1.0) / 128) * c[9] + this.vx;
        this.vz = -((this.stickY * 1.0) / 128) * c[17] + this.vz;
        this.vx = -((this.stickY * 1.0) / 128) * c[15] + this.vx;
        this.vz = ((this.stickX * 1.0) / 128) * c[11] + this.vz;
        this.vy = 0;
        this.speed = Math.sqrt(this.vz * this.vz + this.vy * this.vy + this.vx * this.vx);
        const l = Math.hypot(this.vx, this.vy, this.vz);
        if (l > 0) { this.vx /= l; this.vy /= l; this.vz /= l; }
        if (this.speed > 1) this.speed = 1;
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
  /** four ground probes around the feet (0.12 * the right / forward axes) give the surface normal; the matrix is rebuilt from it and the heading */
  alignToGround(w: World, rec: GameRecord) {
    const sea = w.seaLevel;
    // one probe: terrain height + a downward probe of everything but the ground record (the first probe tests the terrain against -1000, the others against the sea level)
    const probe = (x: number, y: number, z: number, first: boolean): number => {
      const h = w.col.terrainHeight(x, y, z, 4);
      const fall = h <= sea ? -8 : h - y;
      const hit = w.col.probe(rec, [x, y, z], [0, fall, 0], 3);
      if (hit) return hit.point[1];
      if (first ? h <= -1000 : h <= sea) return rec.y;
      return Math.abs(y - rec.y) <= 6.0 ? h : rec.y;
    };
    const k = 0.12;
    const rx = rec.m[0] * k, rz = rec.m[2] * k, fx = rec.m[8] * k, fz = rec.m[10] * k;
    const x = rec.x, y = rec.y, z = rec.z;
    const lX = x - rx, lZ = z - rz, rX = rx + x, rZ = rz + z;
    const lY = probe(lX, y + 1.2, lZ, true);
    const rY = probe(rX, y + 1.2, rZ, false);
    const bX = x - fx, bZ = z - fz, fX = fx + x, fZ = fz + z;
    const bY = probe(bX, y + 2.0, bZ, false);
    const fY = probe(fX, y + 2.0, fZ, false);
    let ax = rX - lX, ay = rY - lY, az = rZ - lZ;     // left -> right
    let bx = fX - bX, by = fY - bY, bz = fZ - bZ;     // back -> front
    let l = Math.hypot(ax, ay, az) || 1; ax /= l; ay /= l; az /= l;
    l = Math.hypot(bx, by, bz) || 1; bx /= l; by /= l; bz /= l;
    const nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;        // up = back->front x left->right
    let hx = Math.sin(rec.ry), hy = 0, hz = Math.cos(rec.ry);
    l = Math.hypot(hx, hy, hz) || 1; hx /= l; hy /= l; hz /= l;
    const d = nz * hz + ny * hy + nx * hx;
    hx -= d * nx; hy -= d * ny; hz -= d * nz;
    l = Math.hypot(hx, hy, hz) || 1; hx /= l; hy /= l; hz /= l;
    let qx = ny * hz - nz * hy, qy = nz * hx - nx * hz, qz = nx * hy - ny * hx;           // right = up x heading
    l = Math.hypot(qx, qy, qz) || 1; qx /= l; qy /= l; qz /= l;
    const m = rec.m;
    m[0] = qx; m[1] = qy; m[2] = qz;
    m[4] = nx; m[5] = ny; m[6] = nz;
    m[8] = hx; m[9] = hy; m[10] = hz;
  }

  // ----------------------------------------------------------------------------------------------- transitions (FUN_0042a88f)
  /** the jump arc shared by states 1 and 0x1f: y = y0 + (v0 + g t) t + g t^2 / 2 with t += 0.1 per tick (the original's formula, not a physical one) */
  private jumpArc(w: World, rec: GameRecord) {
    const g = w.gravity;
    this.t = 0.1 * w.dt + this.t;
    this.vJump = this.t * g + this.v0;
    let y = this.vJump * this.t + this.y0 + g * (this.t * this.t) * 0.5;
    const cy = rec.y;
    if (Math.abs(y - cy) > 4 && y - cy <= 0) y = cy - 4;      // at most 4 units of fall per tick
    if (y < cy) this.yJump = y;
    else {
      // rising: sweep the head against the ceiling
      const hit = w.col.sweep(rec, [rec.x, cy + 4, rec.z], [0, y - cy, 0], 1, 0.6, 0.2);
      this.yJump = hit ? (hit.point[1] - (y - cy)) - 4 : y;
    }
  }

  private startJump(rec: GameRecord) { this.animResult = 0; this.t = 0; this.v0 = 15; this.y0 = rec.y; }

  /** FUN_0042a88f: returns the new state (0 = keep) and sets this.rate */
  private transition(w: World, rec: GameRecord): number {
    const st = this.state;
    const pressed = w.input.pressed;
    const sub = w.vars.get(V.CURRENT_SUBGAME);
    const altJump = (pressed & B.ALT) !== 0 && sub !== 0x11 && sub !== 3;
    const g = w.pep;
    const c = w.camera.c;
    let next = 0;
    let rate = 1.0;
    switch (st) {
      case ST.JUMP:
        this.landFlag = 0;
        this.jumpArc(w, rec);
        rate = this.animResult === 1 ? 0 : 1.0;
        this.shift = 0;
        if (altJump) { next = ST.JUMP2; this.animResult = 0; this.t = 0.1 * w.dt; this.v0 = 17.5; this.y0 = this.yJump; w.playSound(SND.JUMP); }
        if (g.landSnd === 0) { w.playSound(SND.JUMP); g.landSnd = 1; }
        break;
      case ST.JUMP2:
        this.jumpArc(w, rec);
        rate = this.animResult === 0 ? 1.0 : 0;
        this.shift = 0;
        break;
      case ST.TURN: {
        // turn on the spot until the character faces the camera (right . -cameraForward)
        const tx = -c[15], ty = -c[16], tz = -c[17];
        const dot = rec.m[2] * tz + rec.m[1] * ty + rec.m[0] * tx;
        if (this.dirFlag === 0) { if (dot > 0) rec.ry = rec.ry - 0.1745319962501526 * w.dt; }
        else if (dot >= 0) this.dirFlag = 0;
        else rec.ry = 0.1745319962501526 * w.dt + rec.ry;
        rec.rebuildYaw();
        w.playSound(SND.IDLE);
        break;
      }
      case ST.SNEAK:
        if (altJump) { next = ST.JUMP; this.startJump(rec); }
        if (this.speed >= 0.01) { if (this.speed > 0.05) next = ST.WALK; } else next = ST.IDLE;
        this.shift = 0; rate = 1.0;
        this.footsteps(w, rec, st);
        break;
      case ST.THROW:
        this.speed = 0; this.t = 0; this.v0 = 15;
        break;
      case ST.THROW2: this.speed = 0; break;
      case ST.WALK:
        if (altJump) { next = ST.JUMP; this.startJump(rec); }
        if (this.speed >= 0.05) { if (this.speed >= 0.4) next = ST.RUN; } else next = ST.SNEAK;
        this.shift = 0; rate = 1.0;
        this.footsteps(w, rec, st);
        break;
      case ST.KNOCKBACK:
        // thrown backwards: velocity = -2 * forward, speed 0.05, with the jump arc while t != 0
        this.vx = -(rec.m[8] + rec.m[8]); this.vy = -(rec.m[9] + rec.m[9]); this.vz = -(rec.m[10] + rec.m[10]);
        this.speed = 0.05;
        if (this.t !== 0) {
          this.t = 0.01 * w.dt + this.t;
          this.vJump = this.t * w.gravity + this.v0;
          rec.y = this.vJump * this.t + this.y0 + w.gravity * (this.t * this.t) * 0.5;
        }
        this.shift = 0; rate = 1.0;
        break;
      case ST.IDLE: {
        if (this.speed >= 0.01) next = ST.SNEAK;
        if ((rec.anim?.clip ?? CLIP_IDLE) !== CLIP_IDLE) rec.anim?.start(CLIP_IDLE, 0);
        this.idleTimer += 1;
        if (this.idleTimer > 1000) {
          next = ST.TURN; this.idleTimer = 0;
          const dot = rec.m[2] * -c[17] + rec.m[1] * -c[16] + rec.m[0] * -c[15];
          this.dirFlag = dot >= 0 ? 0 : 1;
        }
        if (altJump) next = ST.JUMPSTART;
        this.shift = 0;
        rate = rec.anim?.clip === CLIP_IDLE ? 0.666 : 0;
        if (this.accessory) this.accessory.hide();
        break;
      }
      case ST.RUN: case ST.RUNLEFT: case ST.RUNRIGHT:
        if (altJump) { next = ST.JUMP; this.startJump(rec); }
        this.runTimer += 1;
        if (this.speed >= 0.4 || this.runTimer < 200) {
          if (this.speed < 0.4 && this.runTimer < 200) { next = ST.WALK; this.runTimer = 0; }
        } else { next = ST.SKID; this.runTimer = 0; }
        // the run variants follow the camera stick (which the camera scales down to +-3.2, so they fall back to the plain run)
        if (this.camStickX > 96 && st !== ST.RUNLEFT && st !== ST.RUNRIGHT) next = ST.RUNRIGHT;
        else if (this.camStickX < -96 && st !== ST.RUNLEFT && st !== ST.RUNRIGHT) next = ST.RUNLEFT;
        else if (this.camStickX > -32 && this.camStickX < 32 && st !== ST.RUN) next = ST.RUN;
        this.shift = 0; rate = 1.25;
        this.footsteps(w, rec, st);
        break;
      case ST.OUTOFWATER: this.speed = 0; rate = 1.0; break;
      case ST.SKID:
        this.vx = rec.m[8]; this.vy = rec.m[9]; this.vz = rec.m[10];
        rate = 1.2; this.speed = 0.1; this.shift = 0;
        if ((rec.anim?.frame ?? 0) <= 10) w.playSound(SND.SKID);
        break;
      case ST.SLIDE: {
        if (this.slideFlag === 0 && this.speed >= 0.01) next = ST.SNEAK;
        if (this.accessory) this.accessory.hide();
        const ux = rec.m[4], uy = rec.m[5], uz = rec.m[6];
        if (uy < 0.9) {
          // slide down the slope: velocity = the horizontal part of the surface normal
          const l = Math.hypot(ux, uz) || 1;
          this.vx = ux / l; this.vy = 0; this.vz = uz / l;
        }
        this.shift = 0; this.speed = 1.0; rate = 1.0;
        break;
      }
      case ST.TEETER:
        if (this.speed >= 0.01) next = ST.SNEAK;
        break;
      case ST.THROWRUN:
        this.shift = 0; rate = 1.25;
        this.footsteps(w, rec, st);
        break;
      case ST.LANDING:
        if (this.speed >= 0.4) next = ST.RUN;
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
    const dt = w.dt;
    const anim = rec.anim;
    const subgame = w.vars.get(V.CURRENT_SUBGAME);
    let next = 0;           // local_74
    let camMode = 0;        // local_48
    // ---- state mailbox: another node (or this one, last tick) asked for a state
    if (this.stamp !== w.frame || this.state !== g.mailbox) {
      this.idleTimer = 0; this.speed = 0; this.slideFlag = 0;
      if (g.mailbox === ST.OUTOFWATER) { this.t = 0; this.y0 = 0; this.yJump = 0; this.v0 = 0; this.vJump = 0; }
      if (g.mailbox === ST.JUMP) {
        this.state = ST.JUMP; this.t = 0; this.v0 = 15; this.y0 = rec.y; this.yJump = this.y0 + 2.0;
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
          next = ST.JUMP; this.animResult = 0; this.t = 0; this.v0 = 15; this.y0 = rec.y; this.yJump = this.y0 + 2.0;
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
            next = ST.JUMP; this.animResult = 0; this.landFlag = 0; this.idleTimer += 0.1; this.t = 0; this.v0 = 15; this.y0 = rec.y;
            this.yJump = this.y0 + 2.0; this.vx = rec.m[8]; this.vy = rec.m[9]; this.vz = rec.m[10];
          }
          break;
        case ST.THROWRUN: next = ST.RUN; break;
      }
    }
    if (this.hideFlag !== 0 && this.accessory) this.accessory.hide();
    // ---- heading: turn towards the movement direction (at most 0.349 rad per tick when turning right; the original does not wrap the angle)
    if (!moving || this.state === ST.TURN || this.state === ST.KNOCKBACK || this.state === ST.OUTOFWATER) {
      if (this.state === ST.JUMP || this.state === ST.JUMP2 || this.state === ST.LANDING) rec.rebuildYaw();
    } else {
      const ax = this.vx * dt, az = this.vz * dt;
      const sp = Math.sqrt(this.vz * this.vz + this.vy * this.vy + this.vx * this.vx);
      if (sp > 0) {
        const fwd = rec.m[8] * ax + rec.m[10] * az;
        if (fwd <= 0.9) {
          const diff = Math.atan2(ax, az) - rec.ry;
          const maxTurn = 0.3490639925003052 * dt;
          const step = maxTurn <= diff ? maxTurn : Math.abs(diff);
          if (rec.m[2] * az + rec.m[0] * ax <= 0) rec.ry -= step; else rec.ry += step;
        } else rec.ry = Math.atan2(ax, az);
        rec.rebuildYaw();
      }
    }
    // ---- ground following: sweep down (mask 3, radius 0.6, skin 0.2); in the air only along the arc
    const airborne = this.state === ST.JUMP || this.state === ST.JUMP2;
    let l64 = rec.y;                      // local_64
    let dX = 0, dY = -8, dZ = 0;
    if (airborne) {
      let d = this.yJump - rec.y;
      if (d > -0.6) d = -0.6;
      dY = d; dX = this.vx * dt; dZ = this.vz * dt;
    } else l64 += 4;
    const hit = w.col.sweep(rec, [x0, l64, z0], [dX, dY, dZ], 3, 0.6, 0.2);
    g.surfaceAtFeet = w.col.lastSurface();
    let groundY: number;
    if (!hit || dY >= 0 || hit.normal[1] <= 0.01) groundY = terrain0;
    else {
      groundY = hit.point[1];
      if (this.t === 0 || hit.point[1] < this.yJump) { if (this.t === 0) { l64 = hit.point[1]; rec.y = hit.point[1]; } }
      else { l64 = hit.point[1]; rec.y = hit.point[1]; }
      g.onObject = hit.rec !== w.col.groundRec;
    }
    if (this.t === 0) {
      if (!hit) rec.y = groundY <= w.seaLevel ? w.seaLevel : groundY;
    } else if (this.yJump <= groundY) {
      if (this.yJump - rec.y < 0 && this.yJump < groundY) {
        // reached the ground: hard landing
        rec.y = groundY; next = ST.LANDING;
        this.t = 0; this.y0 = 0; this.yJump = 0; this.v0 = 0; this.vJump = 0;
      }
    } else rec.y = this.yJump;
    // ---- tilt to the slope while moving on the ground
    if (!airborne && this.speed > 0.01 && !g.onObject) this.alignToGround(w, rec);
    // ---- steep slopes: slow down walking up, slide down when standing
    if (this.state !== ST.SLIDE && !airborne && this.state !== ST.TEETER && this.state !== ST.SKID && !g.onObject) {
      const up = rec.m[5];
      if (this.speed <= 0 || up >= 0.85 || rec.m[9] < 0) {
        if (this.speed === 0 && up < 0.85) { next = ST.SLIDE; rec.ry = Math.atan2(-rec.m[4], -rec.m[6]); }
      } else {
        this.speed -= 1 / (up + 1.1);
        if (this.speed < -0.25) this.speed = -0.25;
      }
    }
    // ---- velocity = direction * speed / 2^shift
    if (!airborne) {
      const k = 1.0 / (1 << (this.shift & 0x1f));
      this.vx = k * this.vx * this.speed;
      this.vz = k * this.vz * this.speed;
      this.vy = 0;
    }
    // ---- camera mode: too far (> 28) -> 1, too near (< 12) while pulling back -> 2
    {
      const c = w.camera.c;
      const dd = Math.sqrt((rec.z - c[2]) * (rec.z - c[2]) + (rec.x - c[0]) * (rec.x - c[0]));
      if (dd >= 12 || this.stickY <= 32) { if (dd > 28) camMode = 1; } else camMode = 2;
    }
    // ---- ledge: the ground more than 2 below the next position -> teeter, or jump / fall when running
    {
      const y6 = rec.y;
      const nx = this.vx * dt + x0, nz = this.vz * dt + z0;
      let below = w.col.terrainHeight(nx, y6, nz, 4);
      const pr = w.col.probe(rec, [nx, y6 + 80, nz], [0, -160, 0], 1);
      if (pr && below < pr.point[1]) below = pr.point[1];
      const st = this.state;
      const noLedge = st === ST.TEETER || st === ST.JUMP || st === ST.JUMPSTART || st === ST.LANDING || st === ST.JUMP2 || st === ST.KNOCKBACK || st === ST.OFFBOARD || st === ST.SLIDE;
      if (y6 - below > 2.0 && below < rec.y && w.seaLevel < rec.y && !noLedge && subgame !== 3) {
        if (this.speed >= 0.4 || this.landFlag !== 0) {
          if (this.speed > 0.4 || (this.speed > 0.01 && this.landFlag !== 0)) { next = ST.JUMP; this.animResult = 0; this.t = 0; this.v0 = 15; this.y0 = rec.y; this.yJump = this.y0 + 2.0; }
        } else { this.vx = 0; this.vy = 0; this.vz = 0; next = ST.TEETER; w.playSound(SND.TEETER); }
      }
    }
    // ---- wall sweeps (mask 1): sphere at chest height, then above the head
    {
      let from: number[], delta: number[];
      if (airborne) {
        let dy = this.yJump - rec.y; if (dy > -0.76) dy = -0.76;
        from = [x0, l64 + 0.6, z0]; delta = [this.vx * dt, dy, this.vz * dt];
      } else { from = [rec.x, rec.y + 1.48, rec.z]; delta = [this.vx * dt, 0, this.vz * dt]; }
      let h1 = w.col.sweep(rec, from, delta, 1, 0.6, 0.2);
      if (h1 && h1.normal[1] < 1.0 && !h1.rec.name.startsWith('PAG')) {
        const dot = h1.normal[2] * this.vz + h1.normal[1] * this.vy + h1.normal[0] * this.vx;
        this.vx -= h1.normal[0] * dot; this.vz -= h1.normal[2] * dot;
        const h2 = w.col.sweep(rec, from, [this.vx, this.vy, this.vz], 3, 0.6, 0.2);
        if (h2) { this.vx = 0; this.vy = 0; this.vz = 0; }
      }
      h1 = w.col.sweep(rec, [rec.x, rec.y + 4.0, rec.z], [this.vx * dt, 1.2, this.vz * dt], 1, 0.6, 0.2);
      if (h1 && h1.normal[1] < 0) {
        const dot = h1.normal[2] * this.vz + h1.normal[0] * this.vx;
        if (dot < 0) {
          this.vx -= h1.normal[0] * dot; this.vz -= h1.normal[2] * dot;
          const h2 = w.col.sweep(rec, [rec.x, rec.y + 4.0, rec.z], [this.vx, 1.2, this.vz], 1, 0.6, 0.2);
          if (h2 && this.state !== ST.SLIDE) {
            if (-1 < h2.normal[1]) { this.vx = 0; this.vy = 0; this.vz = 0; }
            if (rec.m[5] < 0.9) { next = ST.SLIDE; this.slideFlag = 1; }
          }
        }
      }
    }
    if (this.state !== ST.TEETER) { rec.x = this.vx * dt + rec.x; rec.z = this.vz * dt + rec.z; }
    // ---- state change: restart the clip, remember the state in the mailbox
    if (next !== 0) {
      this.idleTimer = 0;
      this.state = next;
      g.mailbox = next;
      anim?.start(next, 0);
    }
    // ---- camera
    if (subgame !== 9) w.camera.chase(w, rec, camMode, this);
    return NODE_STOP;
  }
}

