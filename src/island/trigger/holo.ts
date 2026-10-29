// hOLO (Common\SDK...\hOLO.c): the hint hologram on record HOLO (WP4, docs/re/m4/wp4-triggers.md "hOLO"). Constructor FUN_0088df51, vtable 0x982bf0:
// update FUN_0088d41f, pre-render FUN_0088d666, draw FUN_0088dee0, destroy FUN_0088e003; activation FUN_0088d2cb.
// Holding the action button (Shift) for 20 ticks, or the story's alert timer running out (DAT_05defbcc = 90 by FUN_0088d2bc when the story advanced,
// ctx.objective.holoTimer), makes the hologram appear 4 units to the left of Pepper (view right axis) and 2 towards the camera, scale in, face the objective
// (FUN_00424e37) and speak the next hint `HOLOA`, `HOLOB` ... of the hint table (ctx.text.hol); Shift, a cutscene or 210 ticks send it away.
// While it is up var 0xc6 = 1 and DAT_009da844 (ctx.shared.holoActive) = 1. Not ported: the random shimmer of state 3 (FUN_0043ac78 / FUN_0043a9e5:
// a scaled copy of the matrix drawn on top); the flicker of state 4 is (record flag 1 cleared = not drawn this frame, approximated with RF_NO_DRAW).
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

export const CTOR_HOLO = 0x88df51;
export const VAR_HOLO_ACTIVE = 0xc6, VAR_SPEECH_ON = 9;
/** 0x89237c: hold time; 0x898a3c: the longest a hint stays up */
export const HOLO_HOLD = 20, HOLO_TIMEOUT = 210;
/** 0x982c08: scale step per frame; 0x8921f0: full scale */
export const HOLO_SCALE_STEP = 0.1, HOLO_SCALE = 0.75;
/** 0x892468: -4 x view right; + 2 x view forward; height (2 - 2 scale) + 3 */
export const HOLO_SIDE = -4, HOLO_FWD = 2;
/** animation clips: 0x82 on activation, 0x81 when it turns to the objective; 0x892074: below frame 15 the clip runs at speed 1 */
export const HOLO_CLIP_APPEAR = 0x82, HOLO_CLIP_POINT = 0x81;
/** state 0 flicker: per frame random(10) > 10 - L blinks (4), > 10 - 2L shimmers (3); L = 0.75 at story nodes 7..8, else 0.5 (0.3 when Pepper stands still: 0x892730 = 0.008) */
export const HOLO_FLICKER_FAR = 0.5, HOLO_FLICKER_STILL = 0.3, HOLO_FLICKER_78 = 0.75, HOLO_STILL_D2 = 0.008, HOLO_FLICKER_TICKS = 3;

export class HoloNode implements BehaviourNode {
  readonly kind = 'hOLO';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  /** node +0x1c: 0 idle, 3 action held, 2 up, 1 closing; +0x1d: 1 scale in, 0 shown, 3 / 4 flicker, 2 scale out; +0x57: 1 / 2 / 3 facing */
  st = 0; show = 0; face = 0;
  /** node +0x18 timer, +0x1f hint letter, +0x44 scale, +0x48 / +0x4c flicker */
  timer = 0; letter = 0x40; scale = 0; flick = 0;
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
    this.show = 1; this.scale = 0; this.flick = 0; this.face = 1; this.st = 2; this.timer = 0;
    rec.show();
    c?.cameraHold?.(true);
    if (c) c.shared.holoActive = 1;
    rec.anim?.start(HOLO_CLIP_APPEAR, 0);
  }

  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    if (!this.init) this.setup(rec);
    const c = tryCtx(w), obj = c?.objective;
    if (obj && 0 < obj.holoTimer) { obj.holoTimer -= 1 * w.dt; if (obj.holoTimer <= 0) this.alert = true; }
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
        this.timer += 1 * w.dt;
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
          this.timer += 1 * w.dt;
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
    const hx = pep.x + cam[9] * HOLO_SIDE + cam[15] * HOLO_FWD, hz = pep.z + cam[11] * HOLO_SIDE + cam[17] * HOLO_FWD;
    let hy = pep.y + cam[10] * HOLO_SIDE + cam[16] * HOLO_FWD;
    const target = this.face === 1 || this.face === 2 ? c?.objective?.target(rec) ?? null : null;
    if (this.face === 1) {
      if (target) { rec.anim?.start(HOLO_CLIP_POINT, 0); rec.ry = Math.atan2(target.pos[0] - hx, target.pos[2] - hz); this.face = 2; }
      else this.face = 3;
    } else if (this.face === 2 && target) rec.ry = Math.atan2(target.pos[0] - hx, target.pos[2] - hz);
    if (this.face === 0 || this.face === 3 || (this.face === 2 && !target)) rec.ry = Math.atan2(pep.x - hx, pep.z - hz);
    if (this.show === 0) {
      const node = w.vars.get(0x58);
      let L = HOLO_FLICKER_78;
      if (node < 7 || 8 < node) {
        const dx = pep.x - this.prevPep[0], dy = pep.y - this.prevPep[1], dz = pep.z - this.prevPep[2];
        L = HOLO_STILL_D2 <= dz * dz + dy * dy + dx * dx ? HOLO_FLICKER_FAR : HOLO_FLICKER_STILL;
      }
      if (this.queued && c?.speechIdle()) { const t = c.text.hol; if (t) c.say(t, this.queued); this.queued = null; }
      const r = Math.random() * 10;
      if (r > 10 - L) { this.show = 4; this.flick = 0; }
      else if (r > 10 - (L + L)) { this.show = 3; this.flick = 0; }
    } else if (this.show === 1) {
      this.scale += HOLO_SCALE_STEP;
      if (HOLO_SCALE < this.scale) {
        this.show = 0;
        const t = c?.text.hol;
        if (t && c) {
          if (w.vars.get(VAR_SPEECH_ON) === 0 || c.speechIdle()) { c.say(t, this.id); this.queued = null; }
          else this.queued = this.id;
        }
      }
    } else if (this.show === 2) {
      this.scale -= HOLO_SCALE_STEP;
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
    hy = (2 - (this.scale + this.scale)) + hy + 3;
    rec.m.set(buildMatrix(rec.rx, rec.ry, rec.rz, hx, hy, hz, this.scale, this.scale, this.scale));
    rec.flags &= ~RF_NO_DRAW;
    if (this.show === 3 || this.show === 4) {
      this.flick += 1 * w.dt;
      if (this.flick <= HOLO_FLICKER_TICKS) { if (this.show === 4) rec.flags |= RF_NO_DRAW; }
      else this.show = 0;
    }
    this.prevPep = [pep.x, pep.y, pep.z];
  }
}

registerCtor(CTOR_HOLO, (at: Attach) => new HoloNode(at));
