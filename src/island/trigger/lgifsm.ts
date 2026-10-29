// LGI_FSM.c: the island's director / switch processor (docs/re/m4/wp4-triggers.md "LGI_FSM", wp7-ambient.md "Director", wp9-bricks.md "Director").
// Constructor FUN_004b8c73, vtable 0x8d9448: update FUN_004b7c78, destroy FUN_004b8eb7, draw FUN_004b8c37 (the default draw). One attach per era on a
// dummy record (PIZ4 / GETO), gate var 2 & 1 == 1 (forced by the constructor). Every tick it reads the switch variables the cutscene scripts write
// (SETSWITCH: SWITCH_GME_CSM_SFX1..30, SWITCH_LGI_*) and plays the effect each one stands for: 3D sound cues at records, the helicopter rotors, the INFC
// windows, PIZ3 going away, the rocket / zzz / bill / twinkle particle emitters, the wormhole (WORM, record 370) scaling in, collision on / off, the
// jail door, and switch 0xfe (SWITCH_LGI_CSM_FX_SWITCH03): finish brick effect n now (FUN_00447ef0). Update returns 0.
// Merged port (WP9): WP4's node and constants, WP7's particle emitters / cue sounds read from the executable / WORM = record 370 (verified: the
// decompile's +0x96b0 flags and +0x965c matrix are 370 * 0x68 + 0x60 / + 0xc), and the FX_Bricks manager's per-tick update (the original runs it in
// the draw pass, FUN_00442930 -> FUN_00447de0; it polls the SWITCH_LGI_BRICKFX_* variables itself: src/fx/bricks).
// FUN_00444550 of the constructor (render mode 2 of record 370) goes through ctx.partMode (WP-RENDER setPartMode).
import { NODE_NONE } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { RF_ENABLED, RF_NO_COLLIDE } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Pe } from '../../formats/exe.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { registerCtor } from '../../game/setup.ts';
import { tryCtx } from '../ctx.ts';
import { partMatrix, setRotation } from './parts.ts';
import { wrapAngle } from './startcsm.ts';
import { ad, sb, ml, dv, fr } from '../../zones/common/f32.ts';
import { islandSoundHandles } from '../ambient/common.ts';
import { GATE_OFF, GATE_ON, boneWorld, fxGate, fxMatrix, setupEmitter, staticMatrix } from '../emitters.ts';
import { islandBrickFx, tickIslandBrickFx, buildingSlot } from '../../fx/bricks/island.ts';

export const CTOR_LGI_FSM = 0x4b8c73;
/** 0x8d9460: {switch var, sound slot, record} x n, terminated by a var <= 0 (read from the EXE at run time) */
export const SOUND_SWITCHES_VA = 0x8d9460;
/** DAT_05d58214: the cue sounds' handles (FUN_004b037e copies 41 of them there; ids read from its code, islandSoundHandles) */
export const CUE_HANDLES = 0x05d58214;
/** the switches (game variable indices) the update reads (the names resolve to these through `ctx.switchVar`) */
export const SW = {
  ROTOR: 0x131, INFO_DOORS: 0x106, HIDE78: 0x11f, FX110: 0x110, BRICK_FINISH: 0xfe, FX109: 0x109, FXFF: 0xff, COLLIDE: 0x129, JAIL_DOOR: 0x134,
  /** the WORM scale-in: era 0 (node < 7) var 0x128, era 4 (node >= 0x3d) var 0xd, none between */
  SCALE_ERA0: 0x128, SCALE_ERA4: 0xd,
} as const;
/** records the update touches (record array byte offsets of the decompile / 0x68) */
export const REC = {
  ROTOR_A: 165, ROTOR_B: 157, INFO: 124, JAIL: 122, HIDE: 78, SCALE: 370, FX110_SOUND: 11, BILL: 15, NOCOLLIDE: [12, 13, 17, 18],
} as const;
/** sound handle globals: DAT_05d580f4 (the info centre doors, 0x33e), DAT_05d58180 (switch 0x110 = 1, 0x33d), DAT_05d581d8 (switch 0xff, 0x354) */
export const SND = { INFO_DOORS: 0x05d580f4, FX110: 0x05d58180, FXFF: 0x05d581d8 } as const;
/** 0x892060: rotor speed = switch value / 10; 0x892578 / 0x8920cc: door speeds -/+0.1 x value; 0x892570 (double 1.8): bounce angle; 0x892568: bounce factor -0.5; 0x892560 (double 0.05): rest angle */
export const ROTOR_DIV = 10, DOOR_SPEED = 0.10000000149011612, DOOR_BOUNCE_AT = 1.7999999523162842, DOOR_BOUNCE = -0.5, DOOR_REST = 0.05000000074505806;
/** 0x8d95fc: timer step of switch 0x11f; 0x8922b8: scale-in speed (1 / 30 per tick); 0x89255c / 0.1: the jail door (speed 0.1, stops past 1.8) */
export const HIDE_STEP = 0.009999999776482582, SCALE_STEP = 0.0333000011742115, JAIL_SPEED = 0.10000000149011612, JAIL_STOP = Math.fround(1.8);
/** the executable's private matrices of the era functions' emitters (BSS): the rocket01 pairs DAT_05d58410 + 0x40 k, zzz DAT_05d585e8, bill01 DAT_05d58390 / 05d583d0, twinkle03 DAT_05d58590 */
const DAT_ROCKET_M = 0x5d58410, DAT_ZZZ_M = 0x5d585e8, DAT_BILL_M = 0x5d58390, DAT_TWINKLE_M = 0x5d58590;
/** switch 0x110: bit -> (record, first rocket emitter DAT_05d585d0 + 4 k) of the flying figures (rocket01.par at bones 5 / 7) */
const ROCKETS: Record<number, [number, number]> = { 1: [0x0b, 0], 2: [0x17, 0], 4: [0x11, 0], 8: [0x12, 2], 0x10: [0x16, 0], 0x20: [0x0a, 4] };
/** switch 0xff: the value -> record twinkle03.par (DAT_05d58300) and its sound start at */
const TWINKLE: Record<number, number> = { 2: 0x15, 4: 0x13, 8: 0x16, 0x10: 0x14, 0x20: 0x12, 0x40: 0x11, 0x100: 0x17 };

/** `v` (WP7's name) = `var` (WP4's): the switch variable */
export interface Cue { v: number; var: number; sound: number; record: number }
const cueCache = new WeakMap<Pe, Cue[]>();
/** the cue table 0x8d9460 with the sound ids resolved (FUN_004b037e) */
export function cueTable(pe: Pe): Cue[] {
  let t = cueCache.get(pe);
  if (t) return t;
  t = [];
  const h = islandSoundHandles(pe);
  for (let i = 0; i < 64; i++) {
    const a = SOUND_SWITCHES_VA + i * 12;
    const v = pe.u32(a) | 0;
    if (v <= 0) break;
    t.push({ v, var: v, sound: h.get(CUE_HANDLES + pe.u32(a + 4) * 4)?.id ?? -1, record: pe.u32(a + 8) });
  }
  cueCache.set(pe, t);
  return t;
}
const handleId = (w: World, g: number) => { const c = tryCtx(w); return c ? islandSoundHandles(c.pe).get(g)?.id ?? -1 : -1; };
const pos = (r: GameRecord | undefined): [number, number, number] => (r ? [r.x, r.y, r.z] : [0, 0, 0]);

/** the LGI_FSM node's state (byte offsets of the node block) */
export class DirectorState {
  rotor = 0;                          // +0x18
  jail = 0; jailSpeed = 0;            // +0x20 / +0x24 (the jail door, JAIL part 1 = +0x1c)
  win = [0, 0]; winSpeed = [0, 0];    // +0x28 / +0x2c, +0x30 / +0x34 (INFC parts 1 and 2 = +0x40 / +0x44)
  scale = 1;                          // +0x48 (the wormhole's scale, also the BRICKESC_02 count-down)
  /** the cue table (switch var, sound id, record) */
  sounds: Cue[] = [];
  /** what the director did, for tests: `emit name owner mode`, `sfx id`, `stop id`, `finish slot` */
  readonly log: string[] = [];
  private inited = false;

  /** the constructor FUN_004b8c73 */
  init(w: World) {
    if (this.inited) return;
    this.inited = true;
    const pe = tryCtx(w)?.pe;
    if (pe) this.sounds = cueTable(pe);
    for (const k of [0, 1]) { const m = partMatrix(w, w.records[REC.INFO], k + 1); if (m) this.win[k] = fr(Math.atan2(m[8], m[10])); }
    this.scale = 1;
    const worm = w.records[REC.SCALE];
    worm?.hide();
    if (worm) tryCtx(w)?.partMode?.(worm, 0xff, 2);   // FUN_00444550(&rec370, 0xff, 2) at 0x4b8df4
    const j = partMatrix(w, w.records[REC.JAIL], 1);
    if (j) this.jail = wrapAngle(fr(Math.atan2(j[8], j[10])));
  }
}

function cueSfx(w: World, st: DirectorState, id: number, p: [number, number, number]) {
  st.log.push(`sfx ${id}`);
  if (id < 0) return;
  const c = tryCtx(w);
  if (c) c.sfxAt(id, p); else w.playSound(id);
}

/** FUN_004b7c78 */
export function directorTick(w: World, st: DirectorState): number {
  st.init(w);
  const V = w.vars, R = w.records, dt = fr(w.dt), c = tryCtx(w);
  const node = V.get(0x58);

  // ---- 3D sound cues: 1 = play at the record (then 2), 4 = keep playing, 8 = stop (then 2)
  for (const s of st.sounds) {
    const v = V.get(s.v);
    if (v === 1) { cueSfx(w, st, s.sound, pos(R[s.record])); V.set(s.v, 2); }
    else if (v === 4) cueSfx(w, st, s.sound, pos(R[s.record]));
    else if (v === 8) { st.log.push(`stop ${s.sound}`); if (s.sound >= 0) c?.stopSfx(s.sound); V.set(s.v, 2); }
  }

  // ---- rotors: PHEL part 3, BHEL part 2 turn by value / 10 per tick
  let v = V.get(SW.ROTOR);
  if (v !== 0) {
    st.rotor = ad(ml(dv(fr(v), ROTOR_DIV), dt), st.rotor);
    for (const [r, p] of [[REC.ROTOR_A, 3], [REC.ROTOR_B, 2]] as const) { const m = R[r] ? partMatrix(w, R[r], p) : null; if (m) setRotation(m, 0, st.rotor, 0); }
  }

  // ---- the info centre's windows (SWITCH_LGI_CSM_FX_SWITCH00): 1 / -1 open (sound), 2 swinging until past 1.8 rad (-> 3, bouncing back at half
  //      speed), 3 until at rest (-> 0)
  v = V.get(SW.INFO_DOORS);
  if (v !== 0) {
    const parts = [1, 2].map((p) => (R[REC.INFO] ? partMatrix(w, R[REC.INFO], p) : null));
    if (v === -1 || v === 1) {
      st.win = [0, 0];
      st.winSpeed = [ml(fr(v), -DOOR_SPEED), ml(fr(v), DOOR_SPEED)];
      cueSfx(w, st, handleId(w, SND.INFO_DOORS), pos(R[REC.INFO]));
      V.set(SW.INFO_DOORS, 2);
    }
    if (v === -1 || v === 1 || v === 2) {
      for (const k of [0, 1]) {
        st.win[k] = ad(ml(st.winSpeed[k], dt), st.win[k]);
        if (Math.abs(st.win[k]) > DOOR_BOUNCE_AT) { st.winSpeed[k] = ml(st.winSpeed[k], DOOR_BOUNCE); V.set(SW.INFO_DOORS, 3); }
        const m = parts[k]; if (m) setRotation(m, 0, st.win[k], 0);
      }
    } else if (v === 3) {
      for (const k of [0, 1]) {
        st.win[k] = ad(ml(st.winSpeed[k], dt), st.win[k]);
        if (Math.abs(st.win[k]) < DOOR_REST) { st.winSpeed = [0, 0]; st.win = [0, 0]; V.set(SW.INFO_DOORS, 0); }
        const m = parts[k]; if (m) setRotation(m, 0, st.win[k], 0);
      }
    }
  }

  // ---- SWITCH_LGI_CSM_BRICKESC_02 bit 1: record 78 (PIZ3) goes away once the count-down +0x48 ran out
  if ((V.get(SW.HIDE78) & 1) !== 0) {
    if (st.scale <= 0) R[REC.HIDE]?.hide();
    else st.scale = sb(st.scale, ml(HIDE_STEP, dt));
  }

  // ---- SWITCH_LGI_CSM_FX_SWITCH02: 1 = a sound at INFO (record 11); bit 0x1000 starts the rocket emitters at the feet (bones 5 / 7) of the flying
  //      figures of the other bits, 0x80 stops them; the value 1 moves Info's zzz emitter to its bone 10
  v = V.get(SW.FX110);
  if (v !== 0) {
    let on = false;
    if (v === 1) cueSfx(w, st, handleId(w, SND.FX110), pos(R[REC.FX110_SOUND]));
    if (v & 0x1000) { on = true; v &= ~0x1000; V.set(SW.FX110, v); }
    for (let i = 0; i < 8; i++) {
      const hit = ROCKETS[v & (1 << i)];
      if (!hit) continue;
      const [ri, slot] = hit;
      const rec = R[ri];
      if (!rec) continue;
      const ma = staticMatrix(w, DAT_ROCKET_M + slot * 0x40), mb = staticMatrix(w, DAT_ROCKET_M + (slot + 1) * 0x40);
      const ha = setupEmitter(w, DAT_ROCKET_M + slot * 0x40), hb = setupEmitter(w, DAT_ROCKET_M + (slot + 1) * 0x40);   // DAT_05d585d0 + 4 slot, + 4 slot + 4
      if ((v & 0x80) === 0) {
        if ((v & 0x7f) === 1) {
          // FUN_0043a9e5(&DAT_05d585e8, record 11 + 0xc, bone 10): the matrix zzz.par (gate 0x110 & 1) is bound to
          const info = R[REC.FX110_SOUND];
          if (info) boneWorld(staticMatrix(w, DAT_ZZZ_M), info, 10);
        } else {
          // the two rocket01 emitters at bones 5 and 7 (feet) of the flying figure: their private matrices follow the bones every tick
          boneWorld(ma, rec, 5); boneWorld(mb, rec, 7);
          if (on) {   // bit 0x1000: FUN_00442a20(h, 2, 1, 1) + FUN_00442a00(h, matrix) for both
            fxGate(w, ha, GATE_ON); fxGate(w, hb, GATE_ON);
            fxMatrix(w, ha, ma); fxMatrix(w, hb, mb);
          }
        }
      } else { fxGate(w, ha, GATE_OFF); fxGate(w, hb, GATE_OFF); }   // 0x80: FUN_00442a20(h, 1, 1, 1) for both
    }
  }

  // ---- SWITCH_LGI_CSM_FX_SWITCH03 (0xfe) = n, 0 < n < DAT_008d95f8: finish building effect n now (FUN_00447ef0(DAT_05d58304[n])), then 0
  v = V.get(SW.BRICK_FINISH);
  if (v !== 0 && c?.setup) {
    const h = buildingSlot(c.setup, v);
    if (h >= 0) {
      const fx = islandBrickFx(w), slot = fx?.setupSlots.get(h);
      st.log.push(`finish ${h}`);
      if (fx && slot !== undefined) fx.finish(slot);
      V.set(SW.BRICK_FINISH, 0);
    }
  }

  // ---- the wormhole (WORM, record 370): 1 start, 2 scale in 1/30 per tick (then 0, or 5 for var 0xd), 3 hide
  const sv: number = node < 7 ? SW.SCALE_ERA0 : node < 0x3d ? 0 : SW.SCALE_ERA4;
  v = sv ? V.get(sv) : 0;
  const worm = R[REC.SCALE];
  if (v === 1) { st.scale = 0; V.set(sv, 2); }
  else if (v === 2) {
    if (st.scale < 1 && worm) {
      worm.flags |= RF_ENABLED;
      st.scale = ad(ml(SCALE_STEP, dt), st.scale);
      if (1 < st.scale) V.set(sv, sv === SW.SCALE_ERA4 ? 5 : 0);
      st.scale = Math.min(st.scale, 1);
      worm.m.set(buildMatrix(worm.rx, worm.ry, -worm.rz, worm.x, worm.y, worm.z, st.scale, st.scale, st.scale));
    }
  } else if (v === 3) { worm?.hide(); V.set(sv, 0); }

  // ---- SWITCH_LGI_CSM_FX_SWITCH05 (0x109): Bill's hands (bones 14 / 16): the bill01 emitters' private matrices DAT_05d58390 / 05d583d0 follow them every tick;
  //      1 = both emitters on (FUN_00442a20 + FUN_00442a00 with the matrices) and -> 2, 3 = both off and -> 0
  v = V.get(SW.FX109);
  if (v !== 0) {
    const bill = R[REC.BILL];
    const m1 = staticMatrix(w, DAT_BILL_M), m2 = staticMatrix(w, DAT_BILL_M + 0x40);
    const h1 = setupEmitter(w, DAT_BILL_M), h2 = setupEmitter(w, DAT_BILL_M + 0x40);   // DAT_05d58384 / 05d58388
    if (bill) { boneWorld(m1, bill, 0xe); boneWorld(m2, bill, 0x10); }
    if (v === 1) {
      fxGate(w, h1, GATE_ON); fxGate(w, h2, GATE_ON);
      fxMatrix(w, h1, m1); fxMatrix(w, h2, m2);
      V.set(SW.FX109, 2);
    } else if (v === 3) {
      fxGate(w, h1, GATE_OFF); fxGate(w, h2, GATE_OFF);
      V.set(SW.FX109, 0);
    }
  }

  // ---- SWITCH_LGI_CSM_FX_SWITCH06 (0xff): bit 1 = twinkle03.par (DAT_05d58300, bound to the private matrix DAT_05d58590 = a COPY of the record's matrix) + the sound at it; 0x80 = stop
  v = V.get(SW.FXFF);
  if (v !== 0) {
    let on = false;
    if (v & 1) { on = true; v &= ~1; V.set(SW.FXFF, v); }
    const h = setupEmitter(w, DAT_TWINKLE_M);
    if ((v & 0x80) === 0) {
      const ri = TWINKLE[v];
      const rec = ri !== undefined ? R[ri] : undefined;
      if (rec && on) {
        const m = staticMatrix(w, DAT_TWINKLE_M);
        m.set(rec.m);
        fxGate(w, h, GATE_ON);
        fxMatrix(w, h, m);
        cueSfx(w, st, handleId(w, SND.FXFF), [m[12], m[13], m[14]]);   // FUN_004433f0(DAT_05d581d8, &DAT_05d585c0)
      }
    } else {
      fxGate(w, h, GATE_OFF);
      V.set(SW.FXFF, v & ~0x80);
    }
  }

  // ---- SWITCH_LGI_CSM_FX_SWITCH11 (0x129): 1 = Papa, Mama, BBT0, BBT1 (records 12, 13, 17, 18) not solid, 2 = solid again
  v = V.get(SW.COLLIDE);
  if (v === 1) for (const i of REC.NOCOLLIDE) { if (R[i]) R[i].flags |= RF_NO_COLLIDE; }
  else if (v === 2) for (const i of REC.NOCOLLIDE) { if (R[i]) R[i].flags &= ~RF_NO_COLLIDE; }

  // ---- SWITCH_LGI_CSM_FX_SWITCH01 (0x134): the jail door swings open (1 -> 2 -> 0 past 1.8 rad)
  v = V.get(SW.JAIL_DOOR);
  if (v === 1 || v === 2) {
    if (v === 1) { st.jail = 0; st.jailSpeed = JAIL_SPEED; V.set(SW.JAIL_DOOR, 2); }
    st.jail = ad(ml(st.jailSpeed, dt), st.jail);
    if (Math.abs(st.jail) > JAIL_STOP) { st.jailSpeed = 0; V.set(SW.JAIL_DOOR, 0); }
    const m = R[REC.JAIL] ? partMatrix(w, R[REC.JAIL], 1) : null;
    if (m) setRotation(m, 0, st.jail, 0);
  }

  // ---- FX_Bricks (FUN_00447de0, the draw pass of the original): the building / house / animal brick effects follow their variables
  tickIslandBrickFx(w);
  return NODE_NONE;
}

export class LgiFsmNode implements BehaviourNode {
  readonly kind = 'LGI_FSM';
  /** the constructor sets its own gate: var 2 & 1 == 1 */
  get var() { return 2; } set var(_v: number) { /* FUN_004b8c73 */ }
  get mask() { return 1; } set mask(_v: number) { /* FUN_004b8c73 */ }
  get value() { return 1; } set value(_v: number) { /* FUN_004b8c73 */ }
  stamp = 0xfffffffe;
  readonly st = new DirectorState();
  get sounds() { return this.st.sounds; }
  get rotor() { return this.st.rotor; }
  get jailAngle() { return this.st.jail; }
  update(w: World, _rec: GameRecord, _ctrl: Controller): number { return directorTick(w, this.st); }
}

registerCtor(CTOR_LGI_FSM, () => new LgiFsmNode());
