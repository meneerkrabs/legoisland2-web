// "SGBoat" (Common\SGGen\c_src\SGBoat.c): the speedboat SPBT (the Res-Q boat), the jet ski JSKI and the dinghy DNGY of the island.
//   ctor FUN_00430e6c, handler table 0x8ae1f0 = { update FUN_0042f9a2, pre-render FUN_00430749, destroy FUN_00431207, draw FUN_00430c59, save FUN_00430e0e, load FUN_00430d81 }
//   engine sounds FUN_0042f666 (S) / FUN_0042f77a (J) / FUN_0042f88e (D), pitch wobble FUN_0042f5f0
// The node's gate is the boat's MOVE_* var with mask 0 (BOAT 0x82, JSKI 0xb2, DNGY 0x10 = MOVE_RIBB): the update gets the var's VALUE, 0 = parked (Pepper can
// get in with Ctrl), 1 = Pepper drives. Argument block (FUN_00430e6c reads param_2 + 4 .. + 0x10): the ripple record shown under the parked boat (RIPB /
// RIPJ / RIPD) and the three shared wake records WAKR (ripples), WAKP (plume, only above speed 2), WAKS (spray).
// Driving: Space = forward, Alt = reverse, Left / Right steer, Ctrl = "dock": the boat sails into the nearest free dock within 24 units and Pepper steps
// off at the dock's exit node. There is no other way out of a boat (PepSwitc only lets Pepper leave a car).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { ST } from '../../game/walk.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { wrapWorld } from '../../game/swim.ts';
import { ArgView } from '../args.ts';
import { ICON, VV, vehicles, berthPos, fabs, cutsceneActive, sfx, stopSfx, sfxFreq, setVehicleMatrix, leanFrame, padAxis } from './common.ts';

/** sound ids (FUN_00443580 in the constructor): DAT_009da9ec jet ski, DAT_009da9cc dinghy, DAT_009da9e0 speedboat, DAT_009da9d0 crash */
export const SND_JSKI = 0x8d, SND_DNGY = 299, SND_SPBT = 0x129, SND_BOAT_CRASH = 0x332;
/** engine frequency (Hz) idle / full and the change per tick: speedboat (DAT_008ae20c / 208 / 210), jet ski (224 / 220 / 228), dinghy (218 / 214 / 21c) */
const ENGINE: Record<string, [number, number, number, number]> = { S: [9966, 11443, 36, SND_SPBT], J: [10253, 12237, 66, SND_JSKI], D: [10738, 11500, 25, SND_DNGY] };
/** Pepper's clip for getting in / driving (FUN_00430749): speedboat 0x4c, jet ski 0x6f, dinghy 0x6e */
const SEAT_CLIP: Record<string, number> = { S: 0x4c, J: 0x6f, D: 0x6e };

// .rdata constants (floats, doubles where noted)
const STEER_EASE = 0.125;                 // DAT_0089208c
const YAW_RATE = 0.06283185482025147;     // double 0x892188
const YAW_SPEED_K = 0.390625;             // double 0x892190
const PITCH_K = 0.06872234120965004;      // double 0x892180
const ROLL_K = 0.4398229837417603;        // double 0x892178
const ACCEL_FWD = 0.11999999731779099;    // DAT_00892170
const ACCEL_REV = 0.06400000303983688;    // DAT_0089216c
const DRAG = 0.029999999329447746;        // DAT_00892168
const DEADZONE = 0.20000000298023224;     // DAT_008920f0
const SWEEP_UP = 2.799999952316284;       // DAT_0089206c: the boat's sweep runs 2.8 above the sea
const RADIUS = 0.800000011920929, SKIN = 2.0;
const CAM_BACK = -40.0, CAM_UP = 16.0, CAM_EASE = 0.3499999940395355, CAM_LOOK_UP = 8.0;   // DAT_00892164 / 160 / 090
const DOCK_NEAR = 24.0, DOCK_NEAR_SQ = 576.0, DOCK_ARRIVE_SQ = 0.6399999856948853;      // DAT_008921a4 / 8921a0 / 892198
const PARK_SEARCH = 80.0, PARK_SEARCH_SQ = 6400.0;                                        // DAT_008921b0

export class BoatNode implements BehaviourNode {
  readonly kind = 'SGBoat';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: ArgView;
  private init = false;
  // node + 0x18 .. (FUN_00430e6c)
  rip: GameRecord | null = null;     // +0x18 (RIPB / RIPJ / RIPD)
  wakeR: GameRecord | null = null;   // +0x1c WAKR
  wakeP: GameRecord | null = null;   // +0x20 WAKP
  wakeS: GameRecord | null = null;   // +0x24 WAKS
  plumeRate = 0;                     // +0x2c (BOATPLUME particle emitter +0x28: not ported)
  state = 0;                         // +0x38: 0 starting, 1 driving, 2 docking
  dock = -1;                         // +0x3a: the dock the boat occupies (-1 none)
  speed = 0;                         // +0x3c
  wobble = 0;                        // +0x40: phase of the engine's pitch wobble
  engineHz = 9966;                   // +0x44
  steer = 0;                         // +0x48
  half = 0;                          // +0x4c: the collision box's half length (FUN_00442570), the pitch lifts the bow by sin(-rx) * half
  fast = 0;                          // +0x58: above speed 2 (the plume is drawn)
  /** the wake records are shown by this boat (the original draws them in the boat's draw hook, FUN_00430c59) */
  private wakeShown = false;

  constructor(args: ArgView) { this.args = args; }

  /** the constructor's work that needs the world (record pointers, docks): done at the first update */
  private setup(w: World, rec: GameRecord) {
    this.init = true;
    const r = (o: number) => this.args.rec(o, w);
    this.rip = r(4); this.wakeR = r(8); this.wakeP = r(0xc); this.wakeS = r(0x10);
    if (this.rip) this.rip.flags |= RF_NO_COLLIDE;                                  // + FUN_00444550(rip, 0xff, 2): render mode 2 (UNCERTAIN)
    for (const x of [this.wakeR, this.wakeP, this.wakeS]) if (x) { x.flags |= RF_NO_COLLIDE; x.hide(); }
    // the nearest free dock within 80 units (each axis) becomes the boat's
    const G = vehicles(w);
    let best = -1, bestD = PARK_SEARCH_SQ;
    G.docks.forEach((d, i) => {
      if (d.taken) return;
      const p = berthPos(d);
      const dx = p[0] - rec.x, dz = p[2] - rec.z;
      if (fabs(dx) <= PARK_SEARCH && fabs(dz) <= PARK_SEARCH) { const q = dz * dz + dx * dx; if (q < bestD) { best = i; bestD = q; } }
    });
    this.dock = best;
    if (best >= 0) G.docks[best].taken = true;
    this.half = rec.colObj?.col.halfExtents[2] ?? 0;
    this.engineHz = ENGINE[this.typeOf(rec)][0];
  }

  private typeOf(rec: GameRecord): string { const c = rec.name[0]; return c === 'J' || c === 'D' ? c : 'S'; }

  /** FUN_0042f666 / 0042f77a / 0042f88e: the engine pitch rises with Left / Right / Alt / Space held, falls back to the idle pitch with a wobble */
  private engine(w: World, t: string) {
    const [idle, full, step, id] = ENGINE[t];
    const busy = (w.input.held & 0xa3) !== 0;
    let hz: number;
    if (!busy) {
      if (this.engineHz <= idle) hz = this.wobbleHz(idle, w); else { this.engineHz -= step * w.dt; hz = this.engineHz; }
    } else if (full <= this.engineHz) hz = this.wobbleHz(full, w);
    else { this.engineHz += step * w.dt; hz = this.engineHz; }
    // (the dinghy's full-throttle branch sets the jet ski's sound: a slip of the original, kept)
    sfxFreq(w, t === 'D' && busy && full <= this.engineHz ? SND_JSKI : id, Math.trunc(hz));
    sfx(w, id);
  }
  /** FUN_0042f5f0: base + sin(phase) * base * 0.05, phase += 0.05 per tick, wraps at 360 */
  private wobbleHz(base: number, w: World): number {
    const s = Math.sin(this.wobble);
    this.wobble += w.dt * 0.05;
    if (this.wobble >= 360.0) this.wobble = 0;
    return s * (base * 0.05) + base;
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.init) this.setup(w, rec);
    const G = vehicles(w);
    const focusCtrl = w.focus?.ctrl;
    if (!focusCtrl || !focusCtrl.enabled) return NODE_NONE;
    const v = w.vars.get(this.var);
    const t = this.typeOf(rec);
    if (v === 0) {
      if (cutsceneActive(w)) return NODE_NONE;
      const d = ctrl.distSq;
      if (G.current === rec || ((w.input.pressed & B.CTRL) !== 0 && rec.enabled && d < G.range && 0 < d)) {
        G.boatEnter = true; G.current = rec; G.range = d;
        return NODE_STOP;
      }
      // parked: the ripple under the boat (FUN_0044ea60(plume, 1, 1, 1) stops the plume emitter)
      if (this.wakeShown) { for (const x of [this.wakeR, this.wakeP, this.wakeS]) x?.hide(); this.wakeShown = false; }
      if (this.rip) {
        if (rec.enabled) this.rip.show(); else this.rip.hide();
        this.rip.setEuler(0, rec.ry, 0, rec.x, rec.y, rec.z);
        this.rip.rx = rec.rx; this.rip.ry = rec.ry; this.rip.rz = rec.rz;
      }
      if (d < G.range && rec.enabled) w.vars.or(VV.ICONS, ICON.BOAT);
      return NODE_NONE;
    }
    // ---- driving
    const dt = w.dt;
    let x = rec.x, z = rec.z;
    let y = rec.y - Math.sin(-rec.rx) * this.half;          // local_3c
    const fx = rec.m[8], fz = rec.m[10];                     // local_10 / local_8 (local_c = 0)
    let yaw = rec.ry;                                        // local_44
    let steerIn = 0, thr = 0;                                // local_1c / local_18
    if (this.state === 1) {
      for (const dk of G.docks) {
        if (dk.taken) continue;
        const p = berthPos(dk);
        const dx = p[0] - x, dz = p[2] - z;
        if (fabs(dx) <= DOCK_NEAR && fabs(dz) <= DOCK_NEAR && dz * dz + dx * dx < DOCK_NEAR_SQ) { w.vars.or(VV.ICONS, ICON.DOCK); break; }
      }
      this.engine(w, t);
      if ((w.input.pressed & B.CTRL) === 0) {
        const held = w.input.held;
        const padY = padAxis(held, B.SPACE, B.ALT);    // Space -> -127 (forward), Alt -> 127
        const padX = padAxis(held, B.LEFT, B.RIGHT);
        steerIn = padX / 127.0;
        thr = -padY / 127.0;
        if (fabs(steerIn) < DEADZONE) steerIn = 0;
        if (fabs(thr) < DEADZONE) thr = 0;
      } else this.state = 2;
    } else if (this.state === 0) {
      if (this.dock >= 0) G.docks[this.dock].taken = false;
      this.state = 1;
    } else if (this.state === 2) {
      // into the nearest free dock within 24 units
      let best = -1, bestD = DOCK_NEAR_SQ;
      G.docks.forEach((dk, i) => {
        if (dk.taken) return;
        const p = berthPos(dk);
        const dx = p[0] - x, dz = p[2] - z;
        if (fabs(dx) <= DOCK_NEAR && fabs(dz) <= DOCK_NEAR) { const q = dz * dz + dx * dx; if (q < bestD) { best = i; bestD = q; } }
      });
      if (best < 0) this.state = 1;
      else {
        const p = berthPos(G.docks[best]);
        const dx = p[0] - x, dz = p[2] - z;
        if (dz * dz + dx * dx <= DOCK_ARRIVE_SQ) {
          // moored: Pepper steps off at the dock's exit node
          this.speed = 0; this.state = 0;
          const e = berthPos(G.docks[best], true);
          const pep = w.focus!;
          pep.x = e[0]; pep.y = e[1]; pep.z = e[2];
          w.vars.andNot(VV.PEPPER_CONTROL, 0x1ff);
          w.vars.set(VV.PEPPER_CONTROL, 1);
          w.vars.set(this.var, 0);
          pep.anim?.start(ST.IDLE, 0);
          w.pep.mailbox = ST.IDLE;
          G.current = null;
          w.vars.set(VV.SHADOW, 4);
          this.dock = best; G.docks[best].taken = true;
          stopSfx(w, SND_JSKI); stopSfx(w, SND_DNGY); stopSfx(w, SND_SPBT);
        } else {
          x = dx * STEER_EASE * dt + x;
          z = dz * STEER_EASE * dt + z;
          this.speed = 0;
        }
      }
    }
    this.steer = (steerIn - this.steer) * STEER_EASE * dt + this.steer;
    const st = this.steer;
    const k = this.speed < 0 ? 0 : 0.5;
    yaw = st * YAW_RATE * (this.speed * YAW_SPEED_K + k) * dt + yaw;
    const rx = this.speed <= 0 ? 0 : -(this.speed * PITCH_K);
    const rz = -(st * ROLL_K * this.speed * YAW_SPEED_K);
    this.speed = thr < 0 ? thr * ACCEL_REV * dt + this.speed : thr * ACCEL_FWD * dt + this.speed;
    this.speed = this.speed - this.speed * DRAG * dt;
    // move, then two sweeps: along the way 2.8 above the sea, and 8 up from the sea at the new spot (the shore)
    const ox = x, oy = y, oz = z;
    const vx = this.speed * fx, vz = this.speed * fz;
    const h1 = w.col.sweep(rec, [x, w.seaLevel + SWEEP_UP, z], [vx * dt, 0, vz * dt], 3, RADIUS, SKIN);
    x = vx * dt + x; z = vz * dt + z;
    const h2 = w.col.sweep(rec, [x, w.seaLevel, z], [0, 8.0, 0], 3, RADIUS, SKIN);
    if (h1 || h2) {
      x = ox; y = oy; z = oz;
      if (this.speed !== 0) sfx(w, SND_BOAT_CRASH);
      this.speed = 0;
    }
    setVehicleMatrix(rec, rx, yaw, rz, x, Math.sin(-rx) * this.half + y, z);
    // Pepper leans with the throttle
    if (w.focus) leanFrame(w.focus, thr, true);
    // the boat camera: 40 behind, 16 up, eased by 0.35; looks at 8 above the boat
    const c = w.camera.c;
    c[0] = ((x + fx * CAM_BACK) - c[0]) * CAM_EASE * dt + c[0];
    c[1] = ((y + CAM_UP) - c[1]) * CAM_EASE * dt + c[1];
    c[2] = ((z + fz * CAM_BACK) - c[2]) * CAM_EASE * dt + c[2];
    c[3] = x; c[5] = z; c[4] = y + CAM_LOOK_UP;
    wrapWorld(w, rec);
    return NODE_STOP;
  }

  /** FUN_00430749: the wake follows the boat, the boat sits on the sea; Ctrl (or the choice of the update) puts Pepper in */
  prerender(w: World, rec: GameRecord): void {
    const G = vehicles(w);
    const sea = w.seaLevel;
    if (this.rip) {
      let l18: number, f6: number;
      if (this.speed <= 0) { l18 = 0; f6 = 0; this.fast = 0; this.plumeRate = 0; }
      else {
        l18 = this.speed + this.speed;
        if (this.speed <= 2.0) { f6 = 0; this.fast = 0; } else { this.fast = 1; f6 = l18; }
        this.plumeRate = (this.speed / 4.0) * 0.25;
      }
      this.rip.hide();
      const yaw = rec.ry;
      const hx = this.half * rec.m[8], hz = this.half * rec.m[10];
      if (this.wakeR) {
        this.wakeR.m.set(buildMatrix(0, yaw, 0, rec.x, sea, rec.z, 2.0 * l18, 1.0, 2.0 * l18));
        const k = 1.0 - this.speed * 0.25;
        this.wakeR.x += k * hx; this.wakeR.z += k * hz;      // + (1 - 0.25 speed) * half * forward
        this.wakeR.scale = [2.0 * l18, 1.0, 2.0 * l18];
      }
      if (this.wakeP) {
        this.wakeP.m.set(buildMatrix(0, yaw, 0, rec.x, sea, rec.z, f6, l18 * 1.25, f6));
        this.wakeP.x -= hx; this.wakeP.z -= hz; this.wakeP.y = sea - 1.5;
        this.wakeP.scale = [f6, l18 * 1.25, f6];
      }
      if (this.wakeS) {
        this.wakeS.m.set(buildMatrix(0, yaw, 0, rec.x, sea, rec.z, 2.0 * l18, l18 + l18, 2.0 * l18));
        this.wakeS.x += hx; this.wakeS.z += hz; this.wakeS.y = sea - 0.05 * this.speed;
        this.wakeS.scale = [2.0 * l18, l18 + l18, 2.0 * l18];
      }
      for (const x of [this.wakeR, this.wakeP, this.wakeS]) if (x) { x.rx = rec.rx; x.ry = rec.ry; x.rz = rec.rz; }
      // the draw hook FUN_00430c59 draws WAKR and WAKS always and WAKP above speed 2 (the records stay hidden otherwise)
      if (this.wakeR) this.wakeR.show();
      if (this.wakeS) this.wakeS.show();
      if (this.wakeP) { if (this.fast) this.wakeP.show(); else this.wakeP.hide(); }
      this.wakeShown = true;
    }
    rec.y = sea;
    if (((w.input.pressed & B.CTRL) !== 0 || G.boatEnter) && G.current === rec && !cutsceneActive(w)) {
      G.boatEnter = false;
      w.vars.set(this.var, 1);
      w.vars.set(VV.PEPPER_CONTROL, 8);
      const clip = SEAT_CLIP[this.typeOf(rec)];
      const pa = w.focus?.anim;
      if (pa && pa.clip !== clip) pa.start(clip, 0);
      G.kind = -2; G.kind2 = -2;
    }
  }

  /** FUN_00431207: the engine sounds stop */
  destroy(w: World): void { stopSfx(w, SND_JSKI); stopSfx(w, SND_DNGY); stopSfx(w, SND_SPBT); }
}
