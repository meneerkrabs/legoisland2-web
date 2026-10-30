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
import { FX_NONE, GATE_OFF, GATE_ON, HALF_PI, fxGate, fxParam, fxStart, recMatrix, registerFxStart } from '../emitters.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { ST } from '../../game/walk.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { wrapWorld } from '../../game/swim.ts';
import { ad, sb, ml, dv, fr } from '../../zones/common/f32.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { Blk, DOCK_WORDS, FILL_CD, F_CD, ctorSeq, runSetups, ICON, VV, vehicles, berthPos, fabs, cutsceneActive, sfx, stopSfx, sfxFreq, setVehicleMatrix, leanFrame, padAxis } from './common.ts';

/** sound ids (FUN_00443580 in the constructor): DAT_009da9ec jet ski, DAT_009da9cc dinghy, DAT_009da9e0 speedboat, DAT_009da9d0 crash */
export const SND_JSKI = 0x8d, SND_DNGY = 299, SND_SPBT = 0x129, SND_BOAT_CRASH = 0x332;
/** engine frequency (Hz) idle / full and the change per tick: speedboat (DAT_008ae20c / 208 / 210), jet ski (224 / 220 / 228), dinghy (218 / 214 / 21c) */
const ENGINE: Record<string, [number, number, number, number]> = { S: [9966, 11443, 36, SND_SPBT], J: [10253, 12237, 66, SND_JSKI], D: [10738, 11500, 25, SND_DNGY] };
/** Pepper's clip for getting in / driving (FUN_00430749): speedboat 0x4c, jet ski 0x6f, dinghy 0x6e */
const SEAT_CLIP: Record<string, number> = { S: 0x4c, J: 0x6f, D: 0x6e };

// .rdata constants (floats; the doubles are used as doubles: the x87 multiplies by `qword` constants without rounding them to float first)
const STEER_EASE = 0.125;                 // DAT_0089208c
const YAW_RATE = 0.06283185482025147;     // double 0x892188
const YAW_SPEED_K = 0.390625;             // double 0x892190
const PITCH_K = 0.06872234120965004;      // double 0x892180
const ROLL_K = 0.4398229837417603;        // double 0x892178
const ACCEL_FWD = fr(0.11999999731779099);    // DAT_00892170
const ACCEL_REV = fr(0.06400000303983688);    // DAT_0089216c
const DRAG = fr(0.029999999329447746);        // DAT_00892168
const DEADZONE = fr(0.20000000298023224);     // DAT_008920f0
const SWEEP_UP = fr(2.799999952316284);       // DAT_0089206c: the boat's sweep runs 2.8 above the sea
/** FUN_0044ebd0 parameter types 2 / 3 (src/fx/particles PARAM.LIFE / DLIFE) */
const PARAM_LIFE = 2, PARAM_DLIFE = 3;
const RADIUS = fr(0.800000011920929), SKIN = 2.0;
const CAM_BACK = -40.0, CAM_UP = 16.0, CAM_EASE = fr(0.3499999940395355), CAM_LOOK_UP = 8.0;   // DAT_00892164 / literal 16.0 / 160 / 090
const DOCK_NEAR = 24.0, DOCK_NEAR_SQ = 576.0, DOCK_ARRIVE_SQ = fr(0.6399999856948853);      // DAT_008921a4 / 8921a0 / 892198
const PARK_SEARCH = 80.0, PARK_SEARCH_SQ = 6400.0;                                        // DAT_008921b0

registerFxStart((w) => { for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) if (n instanceof BoatNode) n.startPlume(w, r); });

export class BoatNode implements BehaviourNode {
  readonly kind = 'SGBoat';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly args: ArgView;
  readonly seq = ctorSeq();
  init = false;
  // node + 0x18 .. (FUN_00430e6c)
  rip: GameRecord | null = null;     // +0x18 (RIPB / RIPJ / RIPD)
  wakeR: GameRecord | null = null;   // +0x1c WAKR
  wakeP: GameRecord | null = null;   // +0x20 WAKP
  wakeS: GameRecord | null = null;   // +0x24 WAKS
  /** +0x2c: the plume's spray velocity (speed / 4 * 0.25, DAT_008ae22c; FUN_0044ebd0 modes 2 / 3 hand it to the emitter); +0x28 is the BOATPLUME emitter (`plume`) */
  plumeRate = F_CD;       // (the heap fill until the first pre-render)
  state = 0;                         // +0x38: 0 starting, 1 driving, 2 docking
  dock = -1;                         // +0x3a: the dock the boat occupies (-1 none)
  speed = 0;                         // +0x3c
  wobble = 0;                        // +0x40: phase of the engine's pitch wobble
  engineHz = 9966;                   // +0x44
  steer = 0;                         // +0x48
  half = 0;                          // +0x4c: the collision box's half length (FUN_00442570), the pitch lifts the bow by sin(-rx) * half
  fast = 0;                          // +0x58: above speed 2 (the plume is drawn)

  constructor(args: ArgView) { this.args = args; }

  /**
   * The save block, FUN_00430d81 (vtable +0x14: `FUN_0085c0b0(buf, node + 0x38, 0x24); FUN_0085c0b0(buf + 0x24, &DAT_009da9fc, 0x14)`, size 0x38) and its loader FUN_00430e0e (the same copies the other way):
   *   +0x00 u8 state (node +0x38)   +0x01 (node +0x39, never written: kept in `raw`)   +0x02 i16 dock (+0x3a)   +0x04 f32 speed   +0x08 f32 wobble   +0x0c f32 engineHz   +0x10 f32 steer
   *   +0x14 f32 half length (+0x4c)   +0x18 / +0x1c (node +0x50 / +0x54: never written, `raw`)   +0x20 u32 fast (+0x58)
   *   +0x24 five dwords = the dock table's taken flags DAT_009da9fc (the fourth dock's successor is a dead word, `VehicleGlobals.dockSpare`): the same words in every boat's block
   * The port runs the constructor's world work at the first update (`setup`): a block asked for (or loaded) earlier runs it first, as the original's constructor had.
   */
  private readonly raw = FILL_CD(0x24);
  saveBlock(w: World, rec: GameRecord, _ctrl: Controller): Uint8Array {
    if (!this.init) runSetups(w);
    const o = new Blk(0x38);
    o.b.set(this.raw, 0);
    o.w8(0, this.state); o.w16(2, this.dock);
    o.wf(4, this.speed); o.wf(8, this.wobble); o.wf(0xc, this.engineHz); o.wf(0x10, this.steer); o.wf(0x14, this.half);
    o.w32(0x20, this.fast);
    for (let i = 0; i < 5; i++) o.w32(0x24 + 4 * i, DOCK_WORDS[i]);   // the static words DAT_009da9fc (module-wide, `common.ts`)
    return o.b;
  }
  loadBlock(w: World, rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    if (!this.init) runSetups(w, true);
    const i = new Blk(data);
    this.raw.set(data.subarray(0, 0x24));
    this.state = i.u8(0); this.dock = i.i16(2);
    this.speed = i.f32(4); this.wobble = i.f32(8); this.engineHz = i.f32(0xc); this.steer = i.f32(0x10); this.half = i.f32(0x14);
    this.fast = i.u32(0x20);
    for (let k = 0; k < 5; k++) DOCK_WORDS[k] = i.u32(0x24 + 4 * k);
  }

  /**
   * The BOATPLUME emitter (+0x28): FUN_00442960("BOATPLUME", rec + 0xc, 0, 1.0, -half length, -pi / 2, 0, 0, gate off) in the constructor, bound to the boat's LIVE matrix (no
   * per-tick move); FUN_0044ea60(h, 1, 1, 1) while the boat is parked; FUN_0044ea60(h, 2, 1, 1) every tick it moves, then FUN_0044ebd0 modes 2 (life) and 3 (life variation)
   * with `plumeRate`, the spray velocity (src/island/emitters.ts).
   */
  plumeH = FX_NONE;

  /** the constructor's FUN_00442570 (the box half length) and FUN_00442960 at 0x4311dd: idempotent (also run by `finishEmitters`, whatever the boat's gate) */
  startPlume(w: World, rec: GameRecord) {
    this.half = rec.colObj?.col.halfExtents[2] ?? 0;
    if (this.plumeH === FX_NONE) this.plumeH = fxStart(w, 'BOATPLUME', recMatrix(rec), [0, 1.0, -this.half], [-HALF_PI, 0, 0], GATE_OFF);
  }

  /** the constructor's work that needs the world (record pointers, docks): done at the first update */
  setup(w: World, rec: GameRecord) {
    this.init = true;
    const r = (o: number) => this.args.rec(o, w);
    this.rip = r(4); this.wakeR = r(8); this.wakeP = r(0xc); this.wakeS = r(0x10);
    if (this.rip) { this.rip.flags |= RF_NO_COLLIDE; tryCtx(w)?.partMode?.(this.rip, 0xff, 2); }   // FUN_00444550(rip, 0xff, 2) (ctor 0x430e6c)
    for (const x of [this.wakeR, this.wakeP, this.wakeS]) if (x) { x.flags |= RF_NO_COLLIDE; x.hide(); }
    for (const x of [this.wakeP, this.wakeS]) if (x) tryCtx(w)?.partMode?.(x, 0xff, 2);   // the ctor sets mode 2 on WAKP and WAKS only (not WAKR)
    // the nearest free dock within 80 units (each axis) becomes the boat's
    const G = vehicles(w);
    let best = -1, bestD = PARK_SEARCH_SQ;
    G.docks.forEach((d, i) => {
      if (d.taken) return;
      const p = berthPos(d);
      const dx = sb(p[0], rec.x), dz = sb(p[2], rec.z);
      if (fabs(dx) <= PARK_SEARCH && fabs(dz) <= PARK_SEARCH) { const q = ad(ml(dz, dz), ml(dx, dx)); if (q < bestD) { best = i; bestD = q; } }
    });
    this.dock = best;
    if (best >= 0) G.docks[best].taken = true;
    this.engineHz = ENGINE.S[0];       // the constructor FUN_00430e6c sets +0x44 = DAT_008ae20c (the speedboat's idle pitch 9966) for every boat type (finding: boat-engine-init)
    this.startPlume(w, rec);
  }

  private typeOf(rec: GameRecord): string { const c = rec.name[0]; return c === 'J' || c === 'D' ? c : 'S'; }

  /**
   * FUN_0042f666 / 0042f77a / 0042f88e: the engine pitch rises with Left / Right / Alt / Space held, falls back to the idle pitch with a wobble. The tests compare the pitch BEFORE the step (`full <= hz`
   * runs the wobble branch), and the dinghy's wobble branch while busy sets the rate of the jet ski's handle DAT_009da9ec (a slip of the original: the other branches use DAT_009da9cc).
   */
  private engine(w: World, t: string) {
    const [idle, full, step, id] = ENGINE[t];
    const busy = (w.input.held & 0xa3) !== 0;
    const dt = fr(w.dt);
    let hz: number, rateId = id;
    if (!busy) {
      if (this.engineHz <= idle) hz = this.wobbleHz(idle, w); else { this.engineHz = sb(this.engineHz, ml(step, dt)); hz = this.engineHz; }
    } else if (full <= this.engineHz) { hz = this.wobbleHz(full, w); if (t === 'D') rateId = SND_JSKI; }
    else { this.engineHz = ad(ml(step, dt), this.engineHz); hz = this.engineHz; }
    sfxFreq(w, rateId, Math.trunc(hz));
    sfx(w, id);
  }
  /** FUN_0042f5f0: base + sin(phase) * (base * 0.05), phase += dt * 0.05 per tick (the double constant 0x892158), wraps at 360 */
  private wobbleHz(base: number, w: World): number {
    const k = fr(base * 0.05);
    const s = Math.sin(this.wobble);
    this.wobble = ad(fr(fr(w.dt) * 0.05), this.wobble);
    if (this.wobble >= 360.0) this.wobble = 0;
    return fr(fr(s * k) + base);
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.init) runSetups(w);
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
      fxGate(w, this.plumeH, GATE_OFF);
      if (this.rip) {
        if (rec.enabled) this.rip.show(); else this.rip.hide();
        this.rip.setEuler(0, rec.ry, 0, rec.x, rec.y, rec.z);
        this.rip.rx = rec.rx; this.rip.ry = rec.ry; this.rip.rz = rec.rz;
      }
      if (d < G.range && rec.enabled) w.vars.or(VV.ICONS, ICON.BOAT);
      return NODE_NONE;
    }
    // ---- driving
    const dt = fr(w.dt);
    let x = rec.x, z = rec.z;
    let y = fr(rec.y - fr(Math.sin(-rec.rx) * this.half));          // local_3c (the x87 multiplies the double sin by the float half length, rounds once)
    const fx = rec.m[8], fz = rec.m[10];                     // local_10 / local_8 (local_c = 0)
    let yaw = rec.ry;                                        // local_44
    let steerIn = 0, thr = 0;                                // local_1c / local_18
    if (this.state === 1) {
      for (const dk of G.docks) {
        if (dk.taken) continue;
        const p = berthPos(dk);
        const dx = sb(p[0], x), dz = sb(p[2], z);
        if (fabs(dx) <= DOCK_NEAR && fabs(dz) <= DOCK_NEAR && ad(ml(dz, dz), ml(dx, dx)) < DOCK_NEAR_SQ) { w.vars.or(VV.ICONS, ICON.DOCK); break; }
      }
      this.engine(w, t);
      if ((w.input.pressed & B.CTRL) === 0) {
        const held = w.input.held;
        const padY = padAxis(held, B.SPACE, B.ALT);    // Space -> -127 (forward), Alt -> 127
        const padX = padAxis(held, B.LEFT, B.RIGHT);
        steerIn = dv(padX, 127);
        thr = dv(-padY, 127);
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
        const dx = sb(p[0], x), dz = sb(p[2], z);
        if (fabs(dx) <= DOCK_NEAR && fabs(dz) <= DOCK_NEAR) { const q = ad(ml(dz, dz), ml(dx, dx)); if (q < bestD) { best = i; bestD = q; } }
      });
      if (best < 0) this.state = 1;
      else {
        const p = berthPos(G.docks[best]);
        const dx = sb(p[0], x), dz = sb(p[2], z);
        if (ad(ml(dz, dz), ml(dx, dx)) <= DOCK_ARRIVE_SQ) {
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
          x = ad(ml(ml(dx, STEER_EASE), dt), x);
          z = ad(ml(ml(dz, STEER_EASE), dt), z);
          this.speed = 0;
        }
      }
    }
    this.steer = ad(ml(ml(sb(steerIn, this.steer), STEER_EASE), dt), this.steer);
    const st = this.steer;
    const k = this.speed < 0 ? 0 : 0.5;
    yaw = ad(ml(ml(ml(st, YAW_RATE), ad(ml(this.speed, YAW_SPEED_K), k)), dt), yaw);
    const rx = this.speed <= 0 ? 0 : -ml(this.speed, PITCH_K);
    const rz = -ml(ml(this.speed, YAW_SPEED_K), ml(st, ROLL_K));
    this.speed = thr < 0 ? ad(ml(ml(thr, ACCEL_REV), dt), this.speed) : ad(ml(ml(thr, ACCEL_FWD), dt), this.speed);
    this.speed = sb(this.speed, ml(ml(this.speed, DRAG), dt));
    // move, then two sweeps: along the way 2.8 above the sea, and 8 up from the sea at the new spot (the shore)
    const ox = x, oy = y, oz = z;
    const vx = ml(this.speed, fx), vz = ml(this.speed, fz);
    const sea = fr(w.seaLevel);
    const h1 = w.col.sweep(rec, [x, ad(sea, SWEEP_UP), z], [ml(vx, dt), 0, ml(vz, dt)], 3, RADIUS, SKIN);
    x = ad(ml(vx, dt), x); z = ad(ml(vz, dt), z);
    const h2 = w.col.sweep(rec, [x, sea, z], [0, 8.0, 0], 3, RADIUS, SKIN);
    if (h1 || h2) {
      x = ox; y = oy; z = oz;
      if (this.speed !== 0) sfx(w, SND_BOAT_CRASH);
      this.speed = 0;
    }
    setVehicleMatrix(rec, rx, yaw, rz, x, ad(fr(Math.sin(-rx) * this.half), y), z);
    // Pepper leans with the throttle
    if (w.focus) leanFrame(w.focus, st, true);       // (the eased steering: `[ebp - 0x18]` of the asm, the same variable as the yaw's factor)
    // the boat camera: 40 behind, 16 up, eased by 0.35; looks at 8 above the boat
    const c = w.camera.c;
    c[0] = ad(ml(ml(sb(ad(x, ml(fx, CAM_BACK)), c[0]), CAM_EASE), dt), c[0]);
    c[1] = ad(ml(ml(sb(ad(y, CAM_UP), c[1]), CAM_EASE), dt), c[1]);
    c[2] = ad(ml(ml(sb(ad(z, ml(fz, CAM_BACK)), c[2]), CAM_EASE), dt), c[2]);
    c[3] = x; c[5] = z; c[4] = ad(y, CAM_LOOK_UP);
    wrapWorld(w, rec);
    return NODE_STOP;
  }

  /**
   * The draw hook FUN_00430c59 (vtable slot, returns 1): WAKR (+0x1c) then WAKS (+0x24), each through the default draw with its flags | 3 set for the call and cleared (& 0xfffc) after,
   * then the boat itself, then WAKP (+0x20) only while `fast` (+0x58). The wake records' own flags stay cleared (the constructor hides them): they are drawn only here, in this order
   * (renderer: `drawSeq`). Parked, the pre-render still positions them with speed 0, i.e. scale 0.
   */
  drawSeq(_w: World, _rec: GameRecord) {
    return { before: [this.wakeR, this.wakeS].filter((x): x is GameRecord => !!x), after: this.wakeP && this.fast ? [this.wakeP] : [] };
  }

  /** FUN_00430749: the wake follows the boat, the boat sits on the sea; Ctrl (or the choice of the update) puts Pepper in */
  prerender(w: World, rec: GameRecord): void {
    const G = vehicles(w);
    const sea = fr(w.seaLevel);
    if (this.rip) {
      let l18: number, f6: number;
      if (this.speed <= 0) { l18 = 0; f6 = 0; this.fast = 0; this.plumeRate = 0; }
      else {
        l18 = ad(this.speed, this.speed);
        if (this.speed <= 2.0) { f6 = 0; this.fast = 0; } else { this.fast = 1; f6 = l18; }
        fxGate(w, this.plumeH, GATE_ON);               // FUN_0044ea60(plume, 2, 1, 1, f6)
        this.plumeRate = ml(dv(this.speed, 4), 0.25);
      }
      fxParam(w, this.plumeH, PARAM_LIFE, this.plumeRate);    // FUN_0044ebd0(plume, 2, &rate) / (plume, 3, &rate): every tick, also at rate 0
      fxParam(w, this.plumeH, PARAM_DLIFE, this.plumeRate);
      this.rip.hide();
      const yaw = rec.ry;
      const hx = ml(this.half, rec.m[8]), hy = ml(this.half, 0), hz = ml(this.half, rec.m[10]);
      const l2 = ml(2, l18);
      if (this.wakeR) {
        this.wakeR.m.set(buildMatrix(0, yaw, 0, rec.x, sea, rec.z, l2, 1.0, l2));
        this.wakeR.scale = [l2, 1.0, l2];
      }
      if (this.wakeP) {
        this.wakeP.m.set(buildMatrix(0, yaw, 0, rec.x, sea, rec.z, f6, ml(l18, 1.25), f6));
        this.wakeP.x = sb(this.wakeP.x, hx); this.wakeP.y = sb(this.wakeP.y, hy); this.wakeP.z = sb(this.wakeP.z, hz);
        this.wakeP.y = sb(sea, 1.5);
        this.wakeP.scale = [f6, ml(l18, 1.25), f6];
      }
      if (this.wakeS) {
        this.wakeS.m.set(buildMatrix(0, yaw, 0, rec.x, sea, rec.z, l2, ad(l18, l18), l2));
        this.wakeS.x = ad(hx, this.wakeS.x); this.wakeS.y = ad(hy, this.wakeS.y); this.wakeS.z = ad(hz, this.wakeS.z);
        this.wakeS.y = sb(sea, ml(0.05000000074505806, this.speed));
        this.wakeS.scale = [l2, ad(l18, l18), l2];
      }
      if (this.wakeR) {       // (the ripple's offset uses the product computed above: `(1 - 0.25 speed) * half * forward`, added after the others in the original's order)
        const k = sb(1, ml(this.speed, 0.25));
        this.wakeR.x = ad(ml(k, hx), this.wakeR.x); this.wakeR.y = ad(ml(k, hy), this.wakeR.y); this.wakeR.z = ad(ml(k, hz), this.wakeR.z);
      }
      for (const x of [this.wakeR, this.wakeP, this.wakeS]) if (x) { x.rx = rec.rx; x.ry = rec.ry; x.rz = rec.rz; }
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
