// hOLO (Common\SDK...\hOLO.c): the hint hologram on record HOLO (WP4, docs/re/m4/wp4-triggers.md "hOLO"). Constructor FUN_0088df51, vtable 0x982bf0:
// update FUN_0088d41f, pre-render FUN_0088d666, draw FUN_0088dee0, destroy FUN_0088e003; activation FUN_0088d2cb.
// Holding the action button (Shift) for 20 ticks, or the story's alert timer running out (DAT_05defbcc = 90 by FUN_0088d2bc when the story advanced,
// ctx.objective.holoTimer), makes the hologram appear 4 units to the left of Pepper (view right axis) and 2 towards the camera, scale in, face the objective
// (FUN_00424e37) and speak the next hint `HOLOA`, `HOLOB` ... of the hint table (ctx.text.hol); Shift, a cutscene or 210 ticks send it away.
// While it is up var 0xc6 = 1 and DAT_009da844 (ctx.shared.holoActive) = 1.
// The flicker: state 3 (shimmer, gaps S6) multiplies the record's matrix by a shear: FUN_0043ac78 gives an identity matrix whose first row (1, 0, 0) has every component below
// 0.9 (_DAT_00892108) replaced by node +0x48 = rand(1) - 0.5 (set when the state starts, _DAT_0089204c), i.e. (1, r, r), and FUN_0043a9e5(rec + 0xc, copy of rec + 0xc, shear) makes
// rec' = shear * rec: the right row gets r times the up and forward rows added, for the 3 ticks of the state (the matrix is rebuilt every tick before). State 4 (blink) clears the
// frustum flag 1 of the record in the pre-render (FUN_00444370 sets the flag BEFORE the pre-render pass in FUN_004afaf7's loop, so the clear keeps the record out of this frame's
// draw): the port has no flag 1 in the record, RF_NO_DRAW is the same effect for the frame.
import { NODE_NONE, NODE_STOP } from '../../game/controller.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { RF_NO_COLLIDE, RF_NO_DRAW } from '../../game/record.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { buildMatrix } from '../../formats/matrix.ts';
import { registerCtor } from '../../game/setup.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { tryCtx } from '../ctx.ts';
import { BTN_ACTION } from './building.ts';
import { rand } from '../rng.ts';
import { ad, sb, ml, fr } from '../../zones/common/f32.ts';
import { mulGame } from '../../render/math.ts';

export const CTOR_HOLO = 0x88df51;
export const VAR_HOLO_ACTIVE = 0xc6, VAR_SPEECH_ON = 9;
/** 0x89237c: hold time; 0x898a3c: the longest a hint stays up */
export const HOLO_HOLD = 20, HOLO_TIMEOUT = 210;
/** 0x982c08: scale step per frame; 0x8921f0: full scale */
export const HOLO_SCALE_STEP = 0.10000000149011612, HOLO_SCALE = 0.75;
/** 0x892468: -4 x view right; + 2 x view forward; height (2 - 2 scale) + 3 */
export const HOLO_SIDE = -4, HOLO_FWD = 2;
/** animation clips: 0x82 on activation, 0x81 when it turns to the objective; 0x892074: below frame 15 the clip runs at speed 1 */
export const HOLO_CLIP_APPEAR = 0x82, HOLO_CLIP_POINT = 0x81;
/** state 0 flicker: per frame random(10) > 10 - L blinks (4), > 10 - 2L shimmers (3); L = 0.75 at story nodes 7..8, else 0.5 (0.3 when Pepper stands still: 0x892730 = 0.008) */
export const HOLO_FLICKER_FAR = 0.5, HOLO_FLICKER_STILL = 0.3, HOLO_FLICKER_78 = 0.75, HOLO_STILL_D2 = 0.008, HOLO_FLICKER_TICKS = 3;

/** _DAT_00892108: components of the identity row below this take the shimmer value */
export const HOLO_SHIMMER_MIN = 0.8999999761581421;
/** FUN_0043a9e5(m, copy of m, S) with S = identity whose first row is (x, y, z): m' = S * m (row vectors: the right row becomes x * right + y * up + z * forward) */
export function shearMatrix(m: Float32Array, x: number, y: number, z: number) {
  const s = new Float32Array(16); s[0] = x; s[1] = y; s[2] = z; s[5] = 1; s[10] = 1; s[15] = 1;
  m.set(mulGame(s, Float32Array.from(m)));
}

export class HoloNode implements BehaviourNode {
  readonly kind = 'hOLO';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** node +0x1c: 0 idle, 3 action held, 2 up, 1 closing; +0x1d: 1 scale in, 0 shown, 3 / 4 flicker, 2 scale out; +0x57: 1 / 2 / 3 facing */
  st = 0; show = 0; face = 0;
  /** node +0x18 timer, +0x1f hint letter, +0x44 scale, +0x48 / +0x4c flicker */
  timer = 0; letter = 0x40; scale = 0; flick = 0;
  /** node +0x48: the shear of the shimmer (state 3), 0 after the activation */
  shimmer = 0;
  /** node +0x1e: hide the record again when it goes away (constructor arg 0) */
  readonly hideAfter: boolean;
  /** node +0x20..0x34: the record's position / Euler angles when it was called */
  saved = [0, 0, 0, 0, 0, 0];
  /** node +0x50: the hint id; +0x58: a line waiting for the speech channel */
  id = ''; queued: string | null = null;
  /** node +0x38..0x40: Pepper's position of the previous frame */
  prevPep = [0, 0, 0];
  private init = false;
  /** DAT_05defbc8 */
  private alert = false;
  constructor(at: Attach) { this.hideAfter = (at.arg ?? 0) === 0; }

  private setup(rec: GameRecord) {
    this.init = true;
    rec.flags |= RF_NO_COLLIDE;
    if (this.hideAfter) rec.hide();
  }

  /** FUN_0088d2cb */
  private activate(w: World, rec: GameRecord) {
    const c = tryCtx(w);
    this.alert = false;
    this.letter = (this.letter + 1) & 0xff;
    this.id = 'HOLO' + String.fromCharCode(this.letter);
    if (!c?.text.hol?.find(this.id)) { this.letter = 0x40; this.id = 'HOLOA'; }
    this.saved = [rec.x, rec.y, rec.z, rec.rx, rec.ry, rec.rz];
    w.vars.set(VAR_HOLO_ACTIVE, 1);
    this.show = 1; this.scale = 0; this.shimmer = 0; this.face = 1; this.st = 2; this.timer = 0;
    rec.show();
    c?.cameraHold?.(true);
    if (c) c.shared.holoActive = 1;
    rec.anim?.start(HOLO_CLIP_APPEAR, 0);
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.init) this.setup(rec);
    const c = tryCtx(w), obj = c?.objective;
    if (obj && 0 < obj.holoTimer) { obj.holoTimer = sb(obj.holoTimer, ml(1, fr(w.dt))); if (obj.holoTimer <= 0) this.alert = true; }
    const busy = () => !!c?.cutsceneActive();
    switch (this.st) {
      case 0:
        if (!this.alert) {
          if ((w.input.pressed & BTN_ACTION) !== 0) { this.timer = 0; this.st = 3; }
          return NODE_NONE;
        }
        this.activate(w, rec);
        break;
      case 1:
        w.vars.set(VAR_HOLO_ACTIVE, 0);
        this.st = 0;
        if (c) c.shared.holoActive = 0;
        return NODE_NONE;
      case 2:
        this.timer = ad(ml(1, fr(w.dt)), this.timer);
        if (this.timer <= HOLO_TIMEOUT) {
          if (!busy()) {
            if ((w.input.pressed & BTN_ACTION) !== 0) { if (w.vars.get(VAR_SPEECH_ON) !== 0) c?.stopSpeech(); this.show = 2; }
          } else { this.show = 2; this.scale = 0; }
        } else this.show = 2;
        break;
      case 3:
        if (!this.alert) {
          if (busy() || c?.shared.holoActive === 1 || (w.vars.get(0x5e) & 4) !== 0) { this.st = 0; return NODE_NONE; }
          if ((w.input.held & BTN_ACTION) === 0) { this.st = 1; return NODE_NONE; }
          this.timer = ad(ml(1, fr(w.dt)), this.timer);
          if (this.timer <= HOLO_HOLD) return NODE_NONE;
        }
        this.activate(w, rec);
        break;
    }
    this.alert = false;
    return NODE_STOP;
  }

  /** FUN_0088d666 */
  prerender(w: World, rec: GameRecord) {
    const c = tryCtx(w), pep = w.focus, cam = w.camera.c;
    if (!pep) return;
    // (the view's forward row is added twice: `... + DAT_009da624 + DAT_009da624`)
    const hx = ad(ad(pep.x, ml(cam[9], HOLO_SIDE)), ad(cam[15], cam[15])), hz = ad(ad(pep.z, ml(cam[11], HOLO_SIDE)), ad(cam[17], cam[17]));
    let hy = ad(ad(pep.y, ml(cam[10], HOLO_SIDE)), ad(cam[16], cam[16]));
    const target = this.face === 1 || this.face === 2 ? c?.objective?.target(rec) ?? null : null;
    if (this.face === 1) {
      if (target) { rec.anim?.start(HOLO_CLIP_POINT, 0); rec.ry = fr(Math.atan2(sb(target.pos[0], hx), sb(target.pos[2], hz))); this.face = 2; }
      else this.face = 3;
    } else if (this.face === 2 && target) rec.ry = fr(Math.atan2(sb(target.pos[0], hx), sb(target.pos[2], hz)));
    if (this.face === 0 || this.face === 3 || (this.face === 2 && !target)) rec.ry = fr(Math.atan2(sb(pep.x, hx), sb(pep.z, hz)));
    if (this.show === 0) {
      const node = w.vars.get(0x58);
      let L = HOLO_FLICKER_78;
      if (node < 7 || 8 < node) {
        // (finding V8: the squared distance Pepper - the hologram's spot (hx, hy, hz), ~20: always the far rate in play)
        const dx = sb(pep.x, hx), dy = sb(pep.y, hy), dz = sb(pep.z, hz);
        L = HOLO_STILL_D2 <= ad(ad(ml(dx, dx), ml(dy, dy)), ml(dz, dz)) ? HOLO_FLICKER_FAR : HOLO_FLICKER_STILL;
      }
      if (this.queued && c?.speechIdle()) { const t = c.text.hol; if (t) c.say(t, this.queued); this.queued = null; }
      const r = rand(10);
      if (r > sb(10, L)) { this.show = 4; this.flick = 0; }
      else if (r > sb(10, ad(L, L))) { this.show = 3; this.flick = 0; this.shimmer = sb(rand(1), 0.5); }
    } else if (this.show === 1) {
      this.scale = ad(HOLO_SCALE_STEP, this.scale);
      if (HOLO_SCALE < this.scale) {
        this.show = 0;
        const t = c?.text.hol;
        if (t && c) {
          // (finding V9: with the speech option off (var 9 == 0) FUN_00435a11 is not called: only the subtitle)
          if (w.vars.get(VAR_SPEECH_ON) === 0) { c.say(t, this.id, undefined, false); this.queued = null; }
          else if (c.speechIdle()) { c.say(t, this.id); this.queued = null; }
          else this.queued = this.id;
        }
      }
    } else if (this.show === 2) {
      this.scale = sb(this.scale, HOLO_SCALE_STEP);
      if (this.scale < HOLO_SCALE_STEP) {
        const s = this.saved;
        rec.rx = s[3]; rec.ry = s[4]; rec.rz = s[5];
        rec.setEuler(s[3], s[4], s[5], s[0], s[1], s[2]);
        if (this.hideAfter) rec.hide();
        rec.flags &= ~RF_NO_DRAW;
        this.st = 1;
        c?.cameraHold?.(false);
        return;
      }
    }
    hy = ad(ad(sb(2, ad(this.scale, this.scale)), hy), 3);
    rec.m.set(buildMatrix(rec.rx, rec.ry, rec.rz, hx, hy, hz, this.scale, this.scale, this.scale));
    rec.flags &= ~RF_NO_DRAW;
    if (this.show === 3 || this.show === 4) {
      this.flick = ad(ml(1, fr(w.dt)), this.flick);
      if (this.flick <= HOLO_FLICKER_TICKS) {
        if (this.show === 4) rec.flags |= RF_NO_DRAW;
        else {
          // FUN_0043ac78 + the clamps + FUN_0043a9e5(rec + 0xc, copy, shear)
          const pick = (v: number) => (v < HOLO_SHIMMER_MIN ? this.shimmer : v);
          shearMatrix(rec.m, pick(1), pick(0), pick(0));
        }
      } else this.show = 0;
    }
    this.prevPep = [pep.x, pep.y, pep.z];
  }
}

registerCtor(CTOR_HOLO, (at: Attach) => new HoloNode(at));
