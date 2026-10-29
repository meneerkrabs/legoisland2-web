// Small ambient nodes (docs/re/m4/wp7-ambient.md):
//   Spin     ctor FUN_004bdbb2, table 0x8da2b0 {update FUN_004bd900, prerender 1, draw default}: the portal spinners PORS / PORA
//   SeaAmin  ctor FUN_004b1212, table 0x8d91a0 {update 1, prerender 1, draw FUN_004b109e}: the shore foam SEAE (texture wobble only)
//   Sound3d  ctor FUN_00538779, table 0x8eafb8 {update FUN_005386d0 returns 2 and does nothing}: loads a 3D sound for a record (HSE2, LOON)
//   BOTMUSIC ctor FUN_00536e16 (table 0x8eadf8, the dancing bricksterbots) and FUN_00536961 (table 0x8eadd0, the ghetto blaster GETO), era 3
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import { RF_ENABLED, RF_NO_COLLIDE } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { mulGame } from '../../render/math.ts';
import { ad, sb, ml, dv, fr, fromBits } from '../../zones/common/f32.ts';
import { ArgView } from '../args.ts';
import { tryCtx } from '../ctx.ts';
import { FX_NONE, GATE_OFF, GATE_ON, boneWorld, fxGate, fxMatrix, fxParam, fxStart, registerFxStart } from '../emitters.ts';
import { wrapPi, ftol, setRot, ensureAnim } from './common.ts';

export const CTOR_SPIN = 0x4bdbb2, CTOR_SEAAMIN = 0x4b1212, CTOR_SOUND3D = 0x538779, CTOR_BOTMUSIC = 0x536e16, CTOR_GHETTO = 0x536961;

abstract class Node implements BehaviourNode {
  abstract readonly kind: string;
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  abstract update(w: World, rec: GameRecord, ctrl: Controller): number;
}

// ================================================================================================ Spin

export class SpinNode extends Node {
  readonly kind = 'Spin';
  readonly axis: number;   // +0x14 (short): 0 x, 1 y, 2 z
  readonly face: number;   // +0x16 (short, never set by the constructor: 0; non-zero = turn to the camera)
  readonly rate: number;   // +0x1c
  constructor(args: ArgView) { super(); this.axis = args.i16(0); this.face = 0; this.rate = args.f32(4); }
  /** FUN_004bd900 (no dt: the original adds the rate once per frame) */
  update(w: World, rec: GameRecord): number {
    if (this.axis === 0) rec.rx = wrapPi(ad(rec.rx, this.rate));
    else if (this.axis === 1) rec.ry = wrapPi(ad(rec.ry, this.rate));
    else if (this.axis === 2) rec.rz = wrapPi(ad(rec.rz, this.rate));
    if (this.face !== 0) {
      const e = w.camera.c;     // DAT_009da5e8: the camera eye
      rec.ry = fr(Math.atan2(sb(rec.x, e[0]), sb(rec.z, e[2])) + HALF_PI_F);     // (the sum of the unrounded atan2 and the constant, rounded once)
    }
    setRot(rec.m, rec.rx, rec.ry, rec.rz);
    return 1;
  }
}

// ================================================================================================ SeaAmin

/** the shore foam's texture wobble (FUN_004b109e, a draw hook: the original advances it once per drawn frame; the port once per tick) */
export class SeaAminNode extends Node {
  readonly kind = 'SeaAmin';
  phase = 0;     // +0x18
  scroll = 0;    // +0x1c
  prevScroll = 0;   // +0x20
  /** FUN_0043ebe0(model, 0, &0, &v): the V offset of material 0 = sin(phase) * 0.003 (renderer: src/game/render.ts uv offsets of SEAE) */
  vOffset = 0;
  private inited = false;
  update(w: World, rec: GameRecord): number {
    if (!this.inited) { this.inited = true; rec.flags |= RF_NO_COLLIDE; }
    void w;
    return 1;
  }
  prerender(w?: World, rec?: GameRecord) {
    const s = Math.sin(this.phase);
    this.vOffset = fr(s * SEA_WOBBLE);      // (the double sin times the float 0.003 at 0x892414, rounded once)
    // FUN_0043ebe0(model, 0, &0, &v) ADDS v to the V coordinates of the foam mesh (FUN_0088350d mode 0): the texture drifts (WP10: renderer via ctx)
    if (w && rec) tryCtx(w)?.uvScroll?.(rec, 0, this.vOffset);
    this.phase = ad(this.phase, this.vOffset >= 0 ? SEA_PHASE_UP : SEA_PHASE_DOWN);   // _DAT_00892534 / _DAT_008920d8
    this.prevScroll = this.scroll;
    this.scroll = ad(this.scroll, SEA_SCROLL);                                       // _DAT_00892030
  }
}

// ================================================================================================ Sound3d

export class Sound3dNode extends Node {
  readonly kind = 'Sound3d';
  /** the sound id the constructor loads (FUN_004433b0(arg[0])): +0x14 = its handle; +0x18 = its distance (FUN_004433d0) */
  readonly soundId: number;
  constructor(args: ArgView) { super(); this.soundId = args.i32(0); }
  /** FUN_005386d0: returns 2, nothing else (the sound is never played by this node) */
  update(): number { return 2; }
}

// ================================================================================================ BOTMUSIC

/** DAT_05d586d4: a bot danced this frame (the ghetto blaster's pre-render hook unmutes the music then) */
const HALF_PI_F = fromBits(0x3fc90fdb), SEA_WOBBLE = fromBits(0x3b449ba6), SEA_PHASE_UP = fromBits(0x3d567704), SEA_PHASE_DOWN = fromBits(0x3c8efa03), SEA_SCROLL = fromBits(0x3c23d70a);
const DANCE_KEY = 'ambient.botDance';
const RADIO_VAR = 0x22;          // var 0x22: the ghetto blaster is on
const BONE_HAND = 10;            // FUN_0043bc58(anim, 10): where the notes come out
const DANCE_CLIP = 0xfa;

/** translation of `bone` of the record's pose in world space (FUN_0043bc58 + FUN_0043a9e5), the record's position without a pose */
export function bonePos(rec: GameRecord, bone: number): [number, number, number] {
  const p = rec.anim?.pose(1);
  if (!p || p.length < bone * 16 + 16) return [rec.x, rec.y, rec.z];
  const v = rec.toWorld([p[bone * 16 + 12], p[bone * 16 + 13], p[bone * 16 + 14]]);
  return [v[0], v[1], v[2]];
}

registerFxStart((w) => { for (const r of w.records) for (const n of r.ctrl?.nodes ?? []) if (n instanceof BotMusicNode) n.startFx(w); });

export class BotMusicNode extends Node {
  readonly kind = 'BOTMUSIC';
  timer = 0;   // +0x18
  /** +0x14: the music01 emitter (FUN_00442960 in the constructor FUN_00536e16: matrix = the node's own matrix buffer +0x1c, offset (0, 0.5, 0), no rotation, gate off) */
  fxH = FX_NONE;
  /** +0x1c: that matrix buffer (the bot's hand bone in world space, recomputed every dancing tick: FUN_0043bc58(anim, 10) + FUN_0043a9e5) */
  readonly fxMat = new Float32Array(16);
  constructor() { super(); }
  /** the constructor, at 0x536e7a (idempotent; also run by `finishEmitters`) */
  startFx(w: World) { if (this.fxH === FX_NONE) this.fxH = fxStart(w, 'music01.par', this.fxMat, [0, 0.5, 0], [0, 0, 0], GATE_OFF); }
  /** FUN_00536a44 (gate value = the bot's own var) */
  update(w: World, rec: GameRecord, c: Controller): number {
    const val = w.vars.get(this.var);
    const ctx = tryCtx(w);
    this.startFx(w);
    // return values as in the executable (0x536a8f / 0x536b1a: `xor eax, eax`, 0x536d4f: 1 only while dancing). Returning 0 when the bot does not dance
    // lets its walker nodes run and leaves the stamp (+8) alone, so the first dancing frame resets the dance timer (WP17: the port returned 1 always: the
    // bots stood still and the timer, counted down by 5 per tick while Pepper was away, never reached the 0x1000000 'danced out' state)
    if (w.vars.get(RADIO_VAR) === 0) {
      if (val & 0x4000000) w.vars.andNot(this.var, 0x4000000);
      return 0;
    }
    let near = c.distSq <= 576;
    if (!near) { this.timer = sb(this.timer, ml(5, fr(w.dt))); near = 0 < this.timer; }
    if (near) {
      w.ext.set(DANCE_KEY, true);
      const anim = rec.anim ?? ensureAnim(w, rec);
      if (w.frame !== this.stamp) {
        this.timer = 0;
        anim?.start(DANCE_CLIP, 0);
        w.vars.andNot(this.var, 0x1000000);
        w.vars.or(this.var, 1);
        fxGate(w, this.fxH, GATE_ON);                       // FUN_00442a20(h, 2, 1, 1)
        boneWorld(this.fxMat, rec, BONE_HAND);
        fxMatrix(w, this.fxH, this.fxMat);                  // FUN_00442a00(h, node + 0x1c)
      }
      if ((val & 0x4000000) === 0) w.vars.or(this.var, 0x4000000);
      ctx?.expression?.(rec, 7);
      this.timer = ad(ml(1, fr(w.dt)), this.timer);
      let n = Math.trunc(ftol(this.timer) / 0x78) + 1;
      if (3 < n && 144 < c.distSq) { n = 3; this.timer = 240; }
      boneWorld(this.fxMat, rec, BONE_HAND);
      // FUN_0044ebd0 modes 8 / 9 (density, its variation) = timer / 610, mode 0 (force) = that * 0.3 + 0.1 (single precision)
      let k = dv(this.timer, 610);
      fxParam(w, this.fxH, 8, k); fxParam(w, this.fxH, 9, k);
      k = fr(fr(k * 0.3) + 0.1);       // (`fmul qword 0.3`, `fadd qword 0.1`: the double constants, each result rounded to a float32)
      fxParam(w, this.fxH, 0, k);
      if (n < 6) anim?.advance(n, w.dt);
      else { w.vars.or(this.var, 0x1000000); this.timer = 0; fxGate(w, this.fxH, GATE_OFF); }
      return 1;
    }
    if (val & 0x4000000) {
      w.vars.andNot(this.var, 0x4000000);
      ctx?.expression?.(rec, 0);
      fxGate(w, this.fxH, GATE_OFF);
    }
    return 0;
  }
}

/** the ghetto blaster carried by Pepper in nodes 0x38 .. 0x3c */
export class GhettoNode extends Node {
  readonly kind = 'GETO';
  scale = fromBits(0x3f4ccccd);     // +0x1c (_DAT_00892084)
  phase = 0;       // +0x24
  /** FUN_005366b0: returns 0 outside the story nodes 0x38 .. 0x3c (0x5366f7 `xor eax, eax`: the node did not run, so its pre-render hook FUN_005367b9 / draw hook FUN_00536806 are skipped: finding V10) and 1 inside (0x5367a6) */
  update(w: World, rec: GameRecord): number {
    const node = w.vars.get(0x58);
    if (node < 0x38 || 0x3c < node) { rec.flags &= ~RF_ENABLED; return 0; }
    rec.flags |= 0x12;
    w.vars.set(this.var, 1);
    this.phase = wrapPi(ad(this.phase, fromBits(0x3f060a63)));
    this.scale = fr(fr(Math.sin(this.phase) * fromBits(0x3e4ccccd)) + fromBits(0x3f4ccccd));
    return 1;
  }
  /** FUN_005367b9 (music muted unless a bot danced) + FUN_00536806 (the draw hook: the blaster at Pepper's bone 16, offset (0, -1.12, 0.2), scaled) */
  prerender(w: World, rec: GameRecord) {
    tryCtx(w)?.musicMute?.(!w.ext.get(DANCE_KEY));
    w.ext.set(DANCE_KEY, false);
    const p = w.focus;
    if (!p) return;
    const local = buildMatrix(0, 0, 0, 0, fromBits(0xbf8f5c29), fromBits(0x3e4ccccd), this.scale, this.scale, this.scale);   // FUN_0043a742 with DAT_008eade8 .. 0x8eadf0 = (0, -1.12, 0.2) and the scale
    const pose = p.anim?.pose(1);
    const tmp = new Float32Array(16);
    if (pose && pose.length >= 17 * 16) mulGame(local, pose.subarray(16 * 16, 17 * 16) as Float32Array, tmp); else tmp.set(local);
    mulGame(tmp, p.m, rec.m);
    rec.flags |= 3;
  }
}

registerCtor(CTOR_SPIN, (a: Attach) => new SpinNode(ArgView.of(a)));
registerCtor(CTOR_SEAAMIN, () => new SeaAminNode());
registerCtor(CTOR_SOUND3D, (a: Attach) => new Sound3dNode(ArgView.of(a)));
registerCtor(CTOR_BOTMUSIC, () => new BotMusicNode());
registerCtor(CTOR_GHETTO, () => new GhettoNode());
