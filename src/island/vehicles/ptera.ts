// "Ptera" (Common\Z02LGI\c_src\Ptera.c): the ridden flying vehicles of eras 3 / 4, the pterodactyl PTER (record 66, animated rig PTER) and the hang glider
// GLDR (record 172, no animation instance: every `rec + 8 == 0` branch of the original is the glider). Docs: docs/re/m4/wp13-ptera.md.
//   ctor FUN_004bb1a6 (node block 0x88 bytes), handler table 0x8d9c70 = { update FUN_004b93b0, pre-render FUN_004baf1b, destroy FUN_004bb3f5 (frees the block),
//   draw FUN_004bb100 (= the default draw FUN_00444480), save FUN_004bb16d / load FUN_004bb148 (0x70 bytes from +0x18: not ported) }
//   attaches: PTER by FUN_004b4220 (era 3 / 4 roster) gate var 0xb6 mask 0, GLDR by FUN_00522e68 / FUN_0052c2b5 gate var 0x11 mask 0; argument +0 = the
//   home PATH node (PTER 406, GLDR 270), only used by the dead state 2 and as a "may land" flag.
// The riding half on PEPP (FUN_004bb582, gate PEPPER_CONTROL & 0x40) only returns 1 (pepswitch.ts PteraRide): this node moves Pepper (pre-render).
//
// States (+0x23): -1 take-off (climb 0.25 / tick to 18 above the ground), 0 flight, 1 landing on the nearest free helipad (the helicopters' pad table
// DAT_009daa14 / 18 / 2c / 38 / 50, shared with SGHeli), 2 dive away and go home when out of view (no code sets it: dead), 3 parked.
// Flight keys (DAT_0098383c held): Left / Right = yaw rate -/+ 0.0016 per tick up to 0.05 (bank = -8 * yaw rate), Down / Up = pitch rate -/+ 0.0011 up to
// 0.02 (nose up / down, pitch clamped to +-0.35), Space faster (+0.18 to 2.0), Alt slower (-0.06 to 0.5); Ctrl with a free pad within 32 lands.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { wrapWorld } from '../../game/swim.ts';
import { waypoints } from '../../game/walker.ts';
import { tryCtx } from '../ctx.ts';
import { partMatrix } from '../trigger/parts.ts';
import { ensureAnim, rand } from '../ambient/common.ts';
import { ICON, VV, vehicles, berthPos, fabs, cutsceneActive, sfx, setVehicleMatrix, normalize } from './common.ts';

/** FUN_004bb1a6: FUN_00443580(0x303) -> DAT_05d58638, FUN_00443580(0x302) -> DAT_05d5863c (the wing beats) */
export const SND_WING_A = 0x303, SND_WING_B = 0x302;
/** Pepper's clips: hanging under the glider, sitting on the Ptera, the Ptera's clip 2 variant, getting off (FUN_004b93b0 / FUN_004baf1b) */
export const CLIP_GLIDER = 0x114, CLIP_RIDE = 0xed, CLIP_RIDE2 = 0x134, CLIP_OFF = 0x1b;
/** the Ptera's clips: 1 flapping, 3 standing, 4 the 1-in-16 variant at a loop end */
export const PT_FLAP = 1, PT_STAND = 3, PT_GLIDE = 4;
/** `rec == DAT_00983804 + 0x45e0`: the glider record (PEPPERSSHADOW 6 for it, 5 for the Ptera) */
export const GLIDER_RECORD = 0x45e0 / 0x68;
/** var 0xc5 SWITCH_GME_PEPPERSSHADOW, var 0xa9 SWITCH_GME_PEPP_IN_VEHICLE */
const SHADOW_GLIDER = 6, SHADOW_PTERA = 5, SHADOW_OFF = 4;

const PI = 3.1415927410125732, TWO_PI = 6.2831854820251465;   // DAT_0089207c / 00892094 (-pi DAT_00892098)
const YAW_STEP = 0.0016, YAW_MAX = 0.05;                     // local_104 / local_c8
const PITCH_STEP = 0.0011, PITCH_RATE_MAX = 0.02;            // local_138 / local_114
const BANK = 8.0;                                            // local_20
const ACCEL = 0.18, DECEL = 0.06, SPEED_MAX = 2.0, SPEED_MIN = 0.5;   // local_3c / local_58 / local_c4 / local_1cc
const PITCH_MAX = 0.35;                                      // local_4c
const LAND_SINK = 0.1 + 0.6;                                 // local_c0 + DAT_0089213c
const DIVE_FWD = 0.8;                                        // local_100
const DIVE_PITCH_STEP = 0.05;                                // double 0x892158
const TAKEOFF_CLIMB = 0.25, TAKEOFF_ALT = 18.0;              // DAT_00892134 / DAT_0089257c
const PAD_NEAR = 32.0, PAD_FAR = 80.0, PAD_SQ = 6400.0;     // DAT_00892088 / DAT_008921b0 / local_10c
const LAND_EASE = 0.125;                                     // DAT_0089208c
const SWEEP_R = 2.0, CEILING_PROBE = 40.0;                   // 0x40000000 radius / skin, DAT_00892528
const BOUNCE_TIME = 10.0;                                    // 0x41200000
const CEILING_Y = 184.0;                                     // DAT_008d9c6c
const CAM_OFF = [0, 16.0, -24.0], CAM_EASE = 0.3499999940395355;      // 0x41800000 / 0xc1c00000, DAT_00892160
const GLIDER_SEAT = [0, -5.5, -0.5];                         // DAT_008d9c88
const PROP_RATE = 0.25;                                      // DAT_00892134 (the glider's part 2 about z)

const wrap = (a: number) => (-PI <= a ? (PI < a ? a - TWO_PI : a) : a + TWO_PI);
/** FUN_0043cfee(out, d, n): d - 2 n (d . n) (DAT_00892204 = -2) */
const reflect = (d: number[], n: ArrayLike<number>) => { const k = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; return [n[0] * -2 * k + d[0], n[1] * -2 * k + d[1], n[2] * -2 * k + d[2]]; };

export interface PteraState { state: number; speed: number; pad: number }

export class PteraNode implements BehaviourNode {
  readonly kind = 'Ptera';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** +0x14: the home PATH node (argument +0) */
  readonly home: number;
  yawRate = 0;        // +0x1c
  yawDir = 0;         // +0x20 byte: 1 left / 2 right was the last steering key
  pitchDir = 0;       // +0x21 byte
  bouncing = false;   // +0x22 byte
  state = -1;         // +0x23 signed byte
  pitchRate = 0;      // +0x24
  bounceT = 0;        // +0x28
  bounce = [0, 0, 0]; // +0x2c
  speed = 1.0;        // +0x38
  ground = 0;         // +0x40
  /** +0x78 short: the helipad the vehicle occupies (-1 none) */
  pad = -1;
  /** +0x7c: the glider's propeller angle */
  prop = 0;
  /** +0x84: the wing-beat sound phase 0..4 */
  wing = 0;
  /** DAT_05d58634 (written, never read by the executable) */
  lastSpeed = 0;
  private init = false;

  constructor(home: number) { this.home = home; }

  /** the constructor's world-dependent part (FUN_004bb1a6): clip 3, the nearest free pad within 80 (squared < 6400) is reserved */
  private setup(w: World, rec: GameRecord) {
    this.init = true;
    const a = ensureAnim(w, rec);
    a?.start(PT_STAND, 0);
    const G = vehicles(w);
    let best = -1, bestD = PAD_SQ;
    G.pads.forEach((p, i) => {
      if (p.taken) return;
      const q = berthPos(p);
      const dx = q[0] - rec.x, dz = q[2] - rec.z;
      if (fabs(dx) <= PAD_FAR && fabs(dz) <= PAD_FAR) { const d = dz * dz + dx * dx; if (d < bestD) { best = i; bestD = d; } }
    });
    this.pad = best;
    if (best >= 0) G.pads[best].taken = true;
  }

  private nearestPad(w: World, x: number, z: number, lim: number): number {
    let best = -1, bestD = PAD_SQ;
    vehicles(w).pads.forEach((p, i) => {
      if (p.taken) return;
      const q = berthPos(p);
      const dx = q[0] - x, dz = q[2] - z;
      if (fabs(dx) <= lim && fabs(dz) <= lim) { const d = dz * dz + dx * dx; if (d < bestD) { best = i; bestD = d; } }
    });
    return best;
  }

  /** FUN_004b93b0 */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.init) this.setup(w, rec);
    if ((rec.flags & 2) === 0) return NODE_NONE;
    const G = vehicles(w);
    const anim = rec.anim;
    const dt = w.dt;
    // first update after a pause: the chosen vehicle flaps (the arrival starts Pepper in it), any other one is parked
    if (w.frame !== this.stamp) {
      if (rec === G.current) anim?.start(PT_FLAP, 0);
      else this.state = 3;
    }
    const pep = w.focus;
    if (!pep?.ctrl?.enabled) return NODE_STOP;
    let x = rec.x, y = rec.y, z = rec.z;                 // local_130 / 12c / 128
    const ox = x, oy = y, oz = z;                        // local_184 / 180 / 17c
    const held = w.input.held, pressed = w.input.pressed;
    switch (this.state) {
      case -1: {
        this.ground = w.col.terrainHeight(x, y, z, 8.0);
        y = TAKEOFF_CLIMB * dt + y;
        anim?.advance(this.speed, dt);
        if (TAKEOFF_ALT < y - this.ground) this.state = 0;
        break;
      }
      case 0: {
        if (!this.bouncing) {
          if (this.nearestPad(w, x, z, PAD_NEAR) >= 0) {
            w.vars.or(VV.ICONS, ICON.PAD);
            if ((pressed & B.CTRL) !== 0 && this.home >= 0) this.state = 1;
          }
          if ((held & B.SPACE) === 0) {
            if ((held & B.ALT) !== 0) { this.speed -= DECEL * dt; if (this.speed < SPEED_MIN) this.speed = SPEED_MIN; }
          } else { this.speed = ACCEL * dt + this.speed; if (SPEED_MAX < this.speed) this.speed = SPEED_MAX; }
          x += this.speed * rec.m[8]; y += this.speed * rec.m[9]; z += this.speed * rec.m[10];
          rec.x = x; rec.y = y; rec.z = z;
          const ky = YAW_STEP * dt, kp = PITCH_STEP * dt;
          if ((held & B.LEFT) === 0) { if (this.yawDir === 1 && this.yawRate < 0) this.yawRate += ky; }
          else { this.yawDir = 1; if (0 < this.yawRate) this.yawRate -= ky; if (-YAW_MAX < this.yawRate) this.yawRate -= ky; }
          if ((held & B.RIGHT) === 0) { if (this.yawDir === 2 && 0 < this.yawRate) this.yawRate -= ky; }
          else { this.yawDir = 2; if (this.yawRate < 0) this.yawRate += ky; if (this.yawRate < YAW_MAX) this.yawRate += ky; }
          if (this.yawDir === 1 && 0 < this.yawRate) this.yawRate -= ky;
          if (this.yawDir === 2 && this.yawRate < 0) this.yawRate += ky;
          if ((held & B.DOWN) === 0) { if (this.pitchDir === 1 && this.pitchRate < 0) this.pitchRate += kp; }
          else { this.pitchDir = 1; if (0 < this.pitchRate) this.pitchRate -= kp; if (-PITCH_RATE_MAX < this.pitchRate) this.pitchRate -= kp; }
          if ((held & B.UP) === 0) { if (this.pitchDir === 2 && 0 < this.pitchRate) this.pitchRate -= kp; }
          else { this.pitchDir = 2; if (this.pitchRate < 0) this.pitchRate += kp; if (this.pitchRate < PITCH_RATE_MAX) this.pitchRate += kp; }
          if (this.pitchDir === 1 && 0 < this.pitchRate) this.pitchRate -= kp;
          if (this.pitchDir === 2 && this.pitchRate < 0) this.pitchRate += kp;
          rec.ry = wrap(this.yawRate + rec.ry);
          rec.rz = -this.yawRate * BANK;
          if (anim && anim.advance(this.speed, dt) !== 0) anim.start(Math.trunc(rand(16.0)) < 1 ? PT_GLIDE : PT_FLAP, 0);
          // the way just flown, swept backwards (radius / skin 2, mask 3): a wall or the sea bounces the vehicle back for 10 ticks
          let d = [ox - x, oy - y, oz - z];
          const h = w.col.sweep(rec, [x, y, z], d, 3, SWEEP_R, SWEEP_R);
          if (h) this.bounce = normalize(reflect(d, h.normal));
          if (y <= w.seaLevel) this.bounce = normalize(reflect(d, [0, 1, 0]));
          if (h || y <= w.seaLevel) {
            this.bouncing = true; this.bounceT = BOUNCE_TIME; this.speed = SPEED_MIN;
            if (0 < this.bounce[1]) this.bounce[1] = -this.bounce[1];
            if (-0.5 < this.bounce[1]) this.bounce[1] = -0.5;
          }
          // ... and the same way 40 higher: something above the vehicle
          d = [ox - x, oy - (y - CEILING_PROBE), oz - z];
          const hc = w.col.sweep(rec, [x, y, z], d, 3, SWEEP_R, SWEEP_R);
          if (hc && y < hc.point[1]) {
            this.bounce = normalize(reflect(d, hc.normal));
            this.bouncing = true; this.bounceT = BOUNCE_TIME; this.speed = SPEED_MIN;
            if (0 < this.bounce[1]) this.bounce[1] = -this.bounce[1];
          }
        } else {
          const t = this.bounceT * 1.0;
          x = rec.x - t * this.bounce[0]; y = rec.y - t * this.bounce[1]; z = rec.z - t * this.bounce[2];
          rec.x = x; rec.y = y; rec.z = z;
          this.bounceT -= 1.0 * dt;
          if (this.bounceT < 0) this.bouncing = false;
          if (-PITCH_RATE_MAX * 1.0 < this.pitchRate) this.pitchRate -= PITCH_STEP * dt;
        }
        let rx = this.pitchRate + rec.rx;
        if (PITCH_MAX < rx) rx = PITCH_MAX;
        if (rx < -PITCH_MAX) rx = -PITCH_MAX;
        rec.rx = wrap(rx);
        break;
      }
      case 1: {
        const i = this.nearestPad(w, x, z, PAD_FAR);
        // (the original reads the table at index -1 when the pad was taken meanwhile; the port keeps flying instead)
        if (i < 0) { this.state = 0; break; }
        const q = berthPos(G.pads[i]);
        x = (q[0] - x) * LAND_EASE * dt + x;
        z = (q[2] - z) * LAND_EASE * dt + z;
        rec.rz = 0; rec.rx = 0;
        this.ground = w.col.terrainHeight(x, y, z, 8.0) + (anim ? 1.0 : 4.0);
        if (y <= this.ground) y = this.ground; else y -= LAND_SINK * dt;
        rec.x = x; rec.y = y; rec.z = z;
        anim?.advance(1.0, dt);
        if (y <= this.ground) {
          // landed: Pepper steps off at the pad's exit node
          this.state = 3;
          const e = berthPos(G.pads[i], true);
          pep.x = e[0]; pep.y = e[1]; pep.z = e[2];
          G.current = null;
          w.vars.set(VV.PEPPER_CONTROL, 1);
          pep.anim?.start(CLIP_OFF, 0);
          w.pep.mailbox = CLIP_OFF;
          this.pad = i; G.pads[i].taken = true;
          w.vars.set(VV.SHADOW, SHADOW_OFF);
          w.vars.set(VV.PEPP_IN_VEHICLE, 0);
          anim?.start(PT_STAND, 0);
        }
        break;
      }
      case 2: {
        // dive away; out of view: back home, parked (no code of the executable enters this state)
        rec.rx -= dt * DIVE_PITCH_STEP;
        if (rec.rx <= -0.5) {
          rec.rx = -0.5;
          x = rec.x + rec.m[8] * DIVE_FWD; y = rec.y + rec.m[9] * DIVE_FWD; z = rec.z + rec.m[10] * DIVE_FWD;
          rec.x = x; rec.y = y; rec.z = z;
        }
        anim?.advance(1.0, dt);
        const visible = tryCtx(w)?.inFrustum?.(rec) ?? true;
        if (!visible) {
          rec.ry = 0; rec.rx = 0;
          setVehicleMatrix(rec, 0, 0, rec.rz, x, y, z);
          const p = waypoints.nodePos(1, this.home);
          rec.x = p[0]; rec.y = p[1]; rec.z = p[2];
          this.state = 3;
          anim?.start(PT_STAND, 0);
        }
        break;
      }
      case 3: {
        anim?.advance(1.0, dt);
        if ((pressed & B.CTRL) === 0) {
          if (ctrl.distSq < G.range) w.vars.or(VV.ICONS, ICON.CAR);
          return NODE_NONE;
        }
        if ((w.vars.get(VV.PEPPER_CONTROL) & 1) === 0) return NODE_NONE;
        if (ctrl.distSq < G.range && 0 < ctrl.distSq) { G.current = rec; G.range = ctrl.distSq; }
        return NODE_STOP;
      }
      default: return NODE_STOP;
    }
    if (this.state < 3) {
      w.vars.set(VV.SHADOW, rec.index === GLIDER_RECORD ? SHADOW_GLIDER : SHADOW_PTERA);
      w.vars.set(VV.PEPP_IN_VEHICLE, 1);
      setVehicleMatrix(rec, rec.rx, rec.ry, rec.rz, x, y, z);
    }
    if (this.state < 2) {
      // the chase camera: eye eased (0.35) to (0, 16, -24) in the unrolled frame, looking at the vehicle
      const m = buildMatrix(rec.rx, rec.ry, 0, rec.x, rec.y, rec.z);
      const c = w.camera.c;
      c[3] = m[12]; c[4] = m[13]; c[5] = m[14];
      const ex = CAM_OFF[1] * m[4] + CAM_OFF[2] * m[8] + m[12];
      const ey = CAM_OFF[1] * m[5] + CAM_OFF[2] * m[9] + m[13];
      const ez = CAM_OFF[1] * m[6] + CAM_OFF[2] * m[10] + m[14];
      c[0] = (ex - c[0]) * CAM_EASE + c[0];
      c[1] = (ey - c[1]) * CAM_EASE + c[1];
      c[2] = (ez - c[2]) * CAM_EASE + c[2];
    }
    this.lastSpeed = this.speed;
    wrapWorld(w, rec);
    if (CEILING_Y < rec.y) rec.y = CEILING_Y;
    if (this.state !== 3) {
      const pa = pep.anim;
      if (!anim) {
        if (pa) { if (pa.clip === CLIP_GLIDER) pa.advance(1.0, dt); else pa.start(CLIP_GLIDER, 0); }
        const part = partMatrix(w, rec, 2);
        if (part) part.set(buildMatrix(0, 0, this.prop, part[12], part[13], part[14]));
        this.prop = wrap(PROP_RATE * dt + this.prop);
      } else if (pa) {
        const ptClip = anim.clip;
        if (pa.clip !== CLIP_RIDE) pa.start(CLIP_RIDE, 0);
        pa.start(ptClip === 2 ? CLIP_RIDE2 : CLIP_RIDE, Math.trunc(anim.frame));
      }
    }
    if (anim) {
      // the wing beats: sounds at frames 1, 15, 30, 45 of the flap; reset when the clip is about to wrap (FUN_0043b92a)
      const f = Math.trunc(anim.frame);
      const ending = anim.frameCount < 1.0 * dt + 1.0 + anim.frame;
      switch (this.wing) {
        case 0: if (0 < f) { sfx(w, SND_WING_A); this.wing = 1; } break;
        case 1: if (0xe < f) { sfx(w, SND_WING_B); this.wing = 2; } break;
        case 2: if (0x1d < f) { sfx(w, SND_WING_A); this.wing = 3; }
        // falls through
        case 3: if (0x2c < f) { sfx(w, SND_WING_B); this.wing = 4; }
        // falls through
        case 4: if (ending) this.wing = 0;
      }
    }
    return NODE_STOP;
  }

  /** FUN_004baf1b: Ctrl next to the parked vehicle (the update chose it) puts Pepper on; while it flies Pepper is carried */
  prerender(w: World, rec: GameRecord): void {
    if (cutsceneActive(w)) return;
    const G = vehicles(w);
    const pep = w.focus;
    if (!pep) return;
    if (this.state === 3 && (w.input.pressed & B.CTRL) !== 0 && G.current === rec) {
      if (!rec.anim) pep.anim?.start(CLIP_GLIDER, 0);
      else { rec.anim.start(PT_FLAP, 0); pep.anim?.start(CLIP_RIDE, 0); }
      G.kind = -5;
      this.state = -1;
      w.vars.set(VV.PEPPER_CONTROL, 0x40);
      if (this.pad >= 0) {
        G.pads[this.pad].taken = false;
        this.speed = 1.0; this.pitchDir = 1; this.pitchRate = -0.019999999552965164;   // 0xbca3d70a
      }
    }
    if (this.state !== 3) {
      pep.m.set(rec.m);                                   // FUN_0043b00b: the whole matrix
      if (!rec.anim) { const p = rec.toWorld(GLIDER_SEAT); pep.x = p[0]; pep.y = p[1]; pep.z = p[2]; }
      else { pep.x = rec.x; pep.y = rec.y; pep.z = rec.z; }
    }
  }
}
