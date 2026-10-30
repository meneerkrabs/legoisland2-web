// "SGHeli" (Common\SGGen\c_src\SGHeli.c): the police helicopter PHEL and the rescue helicopter RHEL.
//   ctor FUN_004325e8, handler table 0x8ae288 = { update FUN_00431425, pre-render FUN_00432421, destroy FUN_004327c3, draw FUN_004324d2 }
//   engine sound FUN_004312fe, pitch wobble FUN_00431290
// Gate: MOVE_PHEL (0x3e) / MOVE_RHEL (0xbe), mask 0; the update gets the var's value: 0 parked, 1 flying. The constructor does not read its argument block.
// Flying: Space = nose down (forward), Alt = nose up (back), Up / Down = descend / climb (the pad's y axis: Up is -127), Left / Right turn.
// The helicopter keeps 16..40 above the ground (it climbs by itself below 40) and stays below 160; Ctrl = "land": it flies to the nearest free helipad
// within 80 units, descends on it and Pepper steps off at the pad's exit node.
// The rotors are the mesh's part matrices (FUN_0043ea60): RHEL main rotor = part 2 (spins about y by 0.8 per tick), tail rotor = part 3 (about x by 0.75);
// PHEL's rotor = part 3. They turn only while somebody flies (src/island/trigger/parts.ts keeps the live matrices for the renderer).
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { B } from '../../game/input.ts';
import { ST } from '../../game/walk.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { wrapWorld } from '../../game/swim.ts';
import { partMatrix } from '../trigger/parts.ts';
import { ad, sb, ml, dv, fr } from '../../zones/common/f32.ts';
import { Blk, PAD_WORDS, FILL_CD, ctorSeq, runSetups, ICON, VV, vehicles, berthPos, fabs, cutsceneActive, sfx, stopSfx, sfxFreq, setVehicleMatrix, leanFrame, padAxis, normalize } from './common.ts';

/** DAT_009daa4c (FUN_004b0f16): the helicopter's engine */
export const SND_HELI = 0x132;
const ENGINE_IDLE = 19756.0, ENGINE_FULL = 22050.0, ENGINE_STEP = 76.0;                 // DAT_008ae2b0 / 2ac / 2b4
const ROTOR_MAIN = fr(0.800000011920929), ROTOR_TAIL = 0.75;                               // DAT_00892084 / 8921f0
const MIN_ALT = 16.0, CRUISE_ALT = 40.0, MAX_Y = 160.0;                                 // DAT_008ae2a0 / 2a4 / 2a8
const YAW_RATE = 0.06283185482025147;           // double 0x892188
const PITCH_MAX = 0.5215043950080872;           // double 0x8921e0
const TILT_STEP = 0.031415927410125735;         // double 0x8921d8: the pitch / roll follow their targets by at most this per tick
const ROLL_MAX = 0.26389379024505616;           // double 0x8921d0
const THRUST = 0.7639437055824274;              // double 0x8921c8
const CLIMB = fr(0.1599999964237213);               // DAT_008921c4 (also the "moving" threshold of the squared horizontal speed)
const DRAG = fr(0.10000000149011612);               // DAT_008920cc
const VY_MIN = fr(0.4000000059604645);              // DAT_00892118
const DEADZONE = fr(0.20000000298023224);
const PAD_SEARCH = 80.0, PAD_SEARCH_SQ = 6400.0, PAD_LAND_SQ = 256.0, EASE = 0.125;
const CAM_BACK = -56.0, CAM_UP = 24.0, CAM_EASE = fr(0.3499999940395355);                  // DAT_008921c0 / 892160

export class HeliNode implements BehaviourNode {
  readonly kind = 'SGHeli';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  readonly seq = ctorSeq();
  init = false;
  state = 0;               // +0x18: 0 take-off, 1 flying, 2 landing
  vx = 0; vy = 0; vz = 0;  // +0x1c / +0x20 / +0x24
  pad = -1;                // +0x28: the helipad the helicopter occupies
  rotorMain = 0;           // +0x2c
  rotorTail = 0;           // +0x30
  wobble = 0;              // +0x34
  engineHz = ENGINE_IDLE;  // +0x38

  /**
   * The save block, FUN_004324fd (vtable +0x14: `FUN_0085c0b0(buf, node + 0x18, 0x24); FUN_0085c0b0(buf + 0x24, &DAT_009daa50, 0x28)`, size 0x4c) and the loader FUN_0043258a (the copies back):
   *   +0x00 u8 state (node +0x18; +0x01..+0x03 never written: `raw`)   +0x04 / +0x08 / +0x0c f32 vx / vy / vz   +0x10 i16 pad (+0x28; +0x12 never written)   +0x14 f32 rotorMain   +0x18 f32 rotorTail
   *   +0x1c f32 wobble   +0x20 f32 engineHz   +0x24 ten dwords = the helipads' taken flags DAT_009daa50 (shared with the Ptera / glider constructors; the same words in every helicopter's block)
   */
  private readonly raw = FILL_CD(0x24);
  saveBlock(w: World, _rec: GameRecord, _ctrl: Controller): Uint8Array {
    if (!this.init) runSetups(w);
    const o = new Blk(0x4c);
    o.b.set(this.raw, 0);
    o.w8(0, this.state);
    o.wf(4, this.vx); o.wf(8, this.vy); o.wf(0xc, this.vz); o.w16(0x10, this.pad);
    o.wf(0x14, this.rotorMain); o.wf(0x18, this.rotorTail); o.wf(0x1c, this.wobble); o.wf(0x20, this.engineHz);
    for (let i = 0; i < 10; i++) o.w32(0x24 + 4 * i, PAD_WORDS[i]);   // the static words DAT_009daa50 (module-wide, `common.ts`)
    return o.b;
  }
  loadBlock(w: World, _rec: GameRecord, _ctrl: Controller, data: Uint8Array): void {
    if (!this.init) runSetups(w, true);
    const i = new Blk(data);
    this.raw.set(data.subarray(0, 0x24));
    this.state = i.u8(0);
    this.vx = i.f32(4); this.vy = i.f32(8); this.vz = i.f32(0xc); this.pad = i.i16(0x10);
    this.rotorMain = i.f32(0x14); this.rotorTail = i.f32(0x18); this.wobble = i.f32(0x1c); this.engineHz = i.f32(0x20);
    for (let k = 0; k < 10; k++) PAD_WORDS[k] = i.u32(0x24 + 4 * k);
  }

  setup(w: World, rec: GameRecord) {
    this.init = true;
    const G = vehicles(w);
    let best = -1, bestD = PAD_SEARCH_SQ;
    G.pads.forEach((p, i) => {
      if (p.taken) return;
      const q = berthPos(p);
      const dx = sb(q[0], rec.x), dz = sb(q[2], rec.z);
      if (fabs(dx) <= PAD_SEARCH && fabs(dz) <= PAD_SEARCH) { const d = ad(ml(dz, dz), ml(dx, dx)); if (d < bestD) { best = i; bestD = d; } }
    });
    this.pad = best;
    if (best >= 0) G.pads[best].taken = true;
  }

  /** FUN_004312fe (no dt: the pitch moves by 76 Hz per tick) */
  private engine(w: World) {
    const busy = (w.input.held & 0xaf) !== 0;
    let hz: number;
    if (!busy) {
      if (this.engineHz <= ENGINE_IDLE) hz = this.wobbleHz(ENGINE_IDLE); else { this.engineHz = sb(this.engineHz, ENGINE_STEP); hz = this.engineHz; }
    } else if (ENGINE_FULL <= this.engineHz) hz = this.wobbleHz(ENGINE_FULL);
    else { this.engineHz = ad(ENGINE_STEP, this.engineHz); hz = this.engineHz; }
    sfxFreq(w, SND_HELI, Math.trunc(hz));
    sfx(w, SND_HELI);
  }
  /** FUN_00431290: base + sin(phase) * (base * 0.05), phase += 0.02 (double 0x8921b8, added as a double), wraps at 360 */
  private wobbleHz(base: number): number {
    const k = fr(base * 0.05);
    const s = Math.sin(this.wobble);
    this.wobble = fr(this.wobble + 0.02);
    if (this.wobble >= 360.0) this.wobble = 0;
    return fr(fr(s * k) + base);
  }

  update(w: World, rec: GameRecord, ctrl: Controller): number {
    if (!this.init) runSetups(w);
    const G = vehicles(w);
    const focusCtrl = w.focus?.ctrl;
    if (!focusCtrl || !focusCtrl.enabled) return NODE_NONE;
    const v = w.vars.get(this.var);
    if (v === 0) {
      if (cutsceneActive(w)) return NODE_NONE;
      const d = ctrl.distSq;
      if (d < G.range && rec.enabled) w.vars.or(VV.ICONS, ICON.HELI);
      if (G.current === rec || ((w.input.pressed & B.CTRL) !== 0 && w.pep.mailbox !== 0x62 && rec.enabled &&
          (w.vars.get(VV.PEPPER_CONTROL) & 0x1ff) === 1 && d < G.range && 0 < d)) {
        G.heliEnter = true; G.current = rec; G.range = d;
        return NODE_STOP;
      }
      return NODE_NONE;
    }
    // ---- flying
    const cur = G.current ?? rec;
    const isR = rec.name === 'RHEL';
    const main = partMatrix(w, cur, isR ? 2 : 3);
    if (main) { this.rotorMain = ad(this.rotorMain, ROTOR_MAIN); main.set(buildMatrix(0, this.rotorMain, 0, main[12], main[13], main[14])); }
    if (isR) {
      const tail = partMatrix(w, cur, 3);
      if (tail) { this.rotorTail = ad(this.rotorTail, ROTOR_TAIL); tail.set(buildMatrix(this.rotorTail, 0, 0, tail[12], tail[13], tail[14])); }
    }
    let y = rec.y, x = rec.x, z = rec.z;                       // local_40 / 44 / 3c
    const fx = rec.m[8], fz = rec.m[10];                       // local_10 / local_8 (local_c = 0)
    const rx0 = rec.m[0], ry0 = rec.m[1], rz0 = rec.m[2];      // local_2c / 28 / 24
    let vx = this.vx, vy = this.vy, vz = this.vz;
    let turn = 0, pitchIn = 0, climb = 0;                      // local_20 / local_1c / local_48
    if (this.state === 1) {
      if ((w.input.pressed & B.CTRL) === 0) {
        const held = w.input.held;
        if ((held & B.SPACE) !== 0 && (held & B.ALT) === 0) pitchIn = 1.0;
        else if ((held & B.ALT) !== 0 && (held & B.SPACE) === 0) pitchIn = -1.0;
        const padY = padAxis(held, B.UP, B.DOWN), padX = padAxis(held, B.LEFT, B.RIGHT);
        turn = dv(padX, 127);
        climb = dv(padY, 127);
        this.engine(w);
        if (fabs(turn) < DEADZONE) turn = 0;
        if (fabs(pitchIn) < DEADZONE) pitchIn = 0;
      } else this.state = 2;
      const sea = fr(w.seaLevel);
      let g = w.col.terrainHeight(x, y, z, 160.0);
      if (g < sea) g = sea;
      let h = sb(y, g);
      if (MIN_ALT <= h) {
        if (CRUISE_ALT <= h) { if (h < CRUISE_ALT + 8.0 && climb < 0) climb = 0; }
        else climb = 1.0;
      } else { h = MIN_ALT; climb = 1.0; }
      y = ad(h, g);
      if (y <= MAX_Y) { if (MAX_Y - 8.0 < y && 0 < climb) climb = 0; } else climb = -1.0;
      for (const p of G.pads) {
        if (p.taken) continue;
        const q = berthPos(p);
        const dx = sb(q[0], x), dz = sb(q[2], z);
        if (fabs(dx) <= PAD_SEARCH && fabs(dz) <= PAD_SEARCH && ad(ml(dz, dz), ml(dx, dx)) < PAD_SEARCH_SQ) { w.vars.or(VV.ICONS, ICON.PAD); break; }
      }
    } else if (this.state === 0) {
      let g = w.col.terrainHeight(x, y, z, 4.0);
      if (g < fr(w.seaLevel)) g = fr(w.seaLevel);
      if (ad(g, CRUISE_ALT) < y) this.state = 1;
      climb = 0.5;
      if (this.pad >= 0) G.pads[this.pad].taken = false;
      this.engine(w);
    } else if (this.state === 2) {
      let best = -1, bestD = PAD_SEARCH_SQ;
      G.pads.forEach((p, i) => {
        if (p.taken) return;
        const q = berthPos(p);
        const dx = sb(q[0], x), dz = sb(q[2], z);
        if (fabs(dx) <= PAD_SEARCH && fabs(dz) <= PAD_SEARCH) { const d = ad(ml(dz, dz), ml(dx, dx)); if (d < bestD) { best = i; bestD = d; } }
      });
      if (best < 0) this.state = 1;
      else {
        const q = berthPos(G.pads[best]);
        let dx = sb(q[0], x), dy = sb(q[1], y), dz = sb(q[2], z);
        if (ad(ml(dz, dz), ml(dx, dx)) <= PAD_LAND_SQ) {
          if (y <= q[1]) {
            // landed: Pepper steps off at the pad's exit node
            y = w.col.terrainHeight(x, y, z, 8.0);
            this.vx = 0; this.vy = 0; this.vz = 0;
            this.state = 0;
            const e = berthPos(G.pads[best], true);
            const pep = w.focus!;
            pep.x = e[0]; pep.y = e[1]; pep.z = e[2];
            w.vars.set(VV.PEPPER_CONTROL, 1);
            w.vars.set(this.var, 0);
            pep.anim?.start(ST.IDLE, 0);
            w.pep.mailbox = ST.IDLE;
            G.current = null;
            this.pad = best; G.pads[best].taken = true;
            stopSfx(w, SND_HELI);
            w.vars.set(VV.SHADOW, 4);
            setVehicleMatrix(rec, rec.rx, rec.ry, rec.rz, x, y, z);
            return NODE_STOP;
          }
          // above the pad: turn the nose out of the way and sink
          if (fz <= 0) turn = fx <= 0 ? 1.0 : -1.0; else turn = -fx;
          climb = -0.5;
          x = ad(ml(dx, EASE), x);
          z = ad(ml(dz, EASE), z);
        } else {
          if (CRUISE_ALT <= -dy) {
            pitchIn = ml(ad(ad(ml(fx, ml(dx, EASE)), ml(0, EASE)), ml(fz, ml(dz, EASE))), 0.25);
            if (pitchIn <= 1.0) { if (pitchIn < -1.0) pitchIn = -1.0; } else pitchIn = 1.0;
          } else climb = 0.5;
          const d = normalize([ml(dx, EASE), ml(EASE, 0), ml(dz, EASE)]);
          dx = d[0]; dy = d[1]; dz = d[2];
          turn = ad(ad(ml(rx0, dx), ml(ry0, dy)), ml(rz0, dz));
          if (turn <= 1.0) { if (turn < -1.0) turn = -1.0; } else turn = 1.0;
          if (pitchIn < 0) turn = -turn;
          if (DEADZONE < fabs(turn)) pitchIn = 0;
        }
      }
    }
    // turn, tilt towards the targets, thrust along the nose, climb (no dt anywhere: the helicopter's step is per tick). The doubles (0x8921xx) are used as doubles, every result a float32.
    const yaw = ad(rec.ry, ml(turn, YAW_RATE));
    let rx = rec.rx, rz = rec.rz;
    const tx = ml(pitchIn, PITCH_MAX);
    if (tx <= ad(rx, TILT_STEP)) { rx = sb(rx, TILT_STEP) <= tx ? tx : sb(rx, TILT_STEP); } else rx = ad(rx, TILT_STEP);
    const tz = ml(-turn, ROLL_MAX);
    if (tz <= ad(rz, TILT_STEP)) { rz = sb(rz, TILT_STEP) <= tz ? tz : sb(rz, TILT_STEP); } else rz = ad(rz, TILT_STEP);
    const th = ml(rx, THRUST);
    const ax = sb(ml(fx, th), ml(vx, DRAG));
    const ay = sb(ad(ml(climb, CLIMB), ml(0, th)), ml(vy, DRAG));
    const az = sb(ml(fz, th), ml(vz, DRAG));
    vx = ad(vx, ax); vy = ad(vy, ay); vz = ad(vz, az);
    if (CLIMB < ad(ml(vx, vx), ml(vz, vz))) { x = ad(x, vx); z = ad(z, vz); }
    if (VY_MIN < fabs(vy)) y = ad(y, vy);
    setVehicleMatrix(rec, rx, yaw, rz, x, y, z);
    this.vx = vx; this.vy = vy; this.vz = vz;
    if (w.focus) leanFrame(w.focus, turn, true);        // (the multiplier is the turn: `[ebp - 0x1c]`, the yaw's factor)
    const c = w.camera.c;
    c[0] = ad(c[0], ml(sb(ad(x, ml(fx, CAM_BACK)), c[0]), CAM_EASE));
    c[1] = ad(c[1], ml(sb(ad(y, CAM_UP), c[1]), CAM_EASE));
    c[2] = ad(c[2], ml(sb(ad(z, ml(fz, CAM_BACK)), c[2]), CAM_EASE));
    c[3] = x; c[4] = y; c[5] = z;
    wrapWorld(w, rec);
    return NODE_STOP;
  }

  /** FUN_00432421: Ctrl (or the update's choice) puts Pepper in */
  prerender(w: World, rec: GameRecord): void {
    const G = vehicles(w);
    if (((w.input.pressed & B.CTRL) !== 0 || G.heliEnter) && G.current === rec && !cutsceneActive(w)) {
      const pa = w.focus?.anim;
      if (pa && pa.clip !== 0x4c) pa.start(0x4c, 0);
      w.vars.set(this.var, 1);
      w.vars.set(VV.PEPPER_CONTROL, 8);
      w.vars.set(VV.SHADOW, 1);
      G.kind = -3; G.kind2 = -3;
    }
  }

  /** FUN_004327c3: frees the first four helipads (sic) and stops the engine */
  destroy(w: World): void {
    const G = vehicles(w);
    for (let i = 0; i < 4 && i < G.pads.length; i++) G.pads[i].taken = false;
    stopSfx(w, SND_HELI);
  }
}
