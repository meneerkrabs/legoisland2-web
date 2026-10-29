// The circling bird node of z13CAI / z14OSD (M5): constructor FUN_004b4000, handler table 0x8d9280 = { update FUN_004b3bb7, pre-render FUN_004b3f4c (returns 1),
// destroy FUN_004b41e1, draw FUN_004b3f66 (the default mesh draw FUN_00444480), save FUN_004b3fc7 / FUN_004b3fa2 (node + 0x20, 8 bytes) }. The source path of the node
// in the executable says "Bunny.c" (a copy-pasted file header: the rabbits of the island are FUN_004b2149); what it does is a seagull / pterodactyl that flies a
// wide circle around the spot where its record stands, flapping its wings while it climbs and gliding while it sinks:
//   z13CAI: GL00..GL14 (FUN_0061b06b: every record whose name starts with "GL", argument block {1, 1}) and the PTER record (record 24, {1, 1}) while Pepper flies a helicopter,
//   z14OSD: 7 attaches (the Oasis' birds).
// Argument block (the 0x80 bytes the set-up built): +0 = the animation clip to start, +4 = 0: put the bird on the terrain (+ 0..40 above 24 units over the ground), != 0: keep
// the record's own height (the Adventure Island's birds, which the scene places at 85).
// Node block (0x28 bytes): +0x14 / +0x18 / +0x1c = the home position and the altitude the bird wants (x, y, z), +0x20 = state (low nibble: 1 flying straight, 2 turning;
// high nibble: 0x10 sinking / gliding, 0x20 climbing / flapping), +0x24 = the turn step per tick (+- 1 degree).
// The original's constructor runs while the set-up attaches the node; the port's factory has no world, so the framework's `ctorInit` hook (src/hub/game.ts: called for every node
// after the set-up, once the loader's animation instances exist; a hub that does not use `registerHub` calls `constructGulls`) or the first update does that part.
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Attach } from '../../formats/zonesetup.ts';
import { ArgView } from '../../island/args.ts';
import { ensureAnim, rand, setRot, wrapPi, PI, TWO_PI } from '../../island/ambient/common.ts';

export const CTOR_GULL = 0x4b4000;

const fr = Math.fround;
/** a float constant of the executable from its bits (the decompile prints them as hex) */
const F = (u: number): number => new Float32Array(new Uint32Array([u]).buffer)[0];
/** 0x40c90f94 (the constructor's rand range) and _DAT_00892558: a heading in (-3.14158, 3.14158) */
const HEADING_RANGE = F(0x40c90f94), HEADING_BASE = F(0x40490f94);
/** the pitch of the two states: 0x3d8efa03 (+4 degrees, sinking) / 0xbe0efa03 (-8 degrees, climbing) and the turn step 0x3c8efa03 (1 degree) */
const PITCH_SINK = F(0x3d8efa03), PITCH_CLIMB = F(0xbe0efa03), TURN_STEP = F(0x3c8efa03);
/** _DAT_00892554 (90 degrees: start turning), _DAT_00892550 (30 degrees: straight again) */
const TURN_START = F(0x3fc90f94), TURN_END = F(0x3f060a63);
/** _DAT_008921f4 = 16 (the height difference the bird accepts), _DAT_008921a4 = 24 (the lowest altitude), 0x42200000 = 40 (the random extra height) */
const BAND = 16.0, MIN_ALT = 24.0, ALT_SPREAD = 40.0;
/** the wing flap clip loops through frames 8..10 only while the bird glides: the update stops advancing it there */
const GLIDE_FROM = 8.0, GLIDE_TO = 10.0;
/** _DAT_00892118: the speed per tick along the record's forward axis (not scaled by the frame time: the original does not) */
const SPEED = F(0x3ecccccd);
/** _DAT_0089228c: the random number above which the bird turns the other way when its state changes */
const FLIP = 6.0;

const STATE_STRAIGHT = 1, STATE_TURN = 2, FLAP_SINK = 0x10, FLAP_CLIMB = 0x20;

export class GullNode implements BehaviourNode {
  readonly kind = 'Gull';
  var = 2; mask = 1; value = 1;
  stamp = 0xfffffffe;
  readonly clip: number;
  /** argument +4 */
  readonly keepHeight: boolean;
  /** node +0x14 / +0x18 / +0x1c */
  home: [number, number, number] = [0, 0, 0];
  /** node +0x20 */
  state = 0;
  /** node +0x24 */
  turn = 0;
  private built = false;

  constructor(a: ArgView) {
    this.clip = a.i32(0);
    this.keepHeight = a.i32(4) !== 0;
  }

  /** `registerHub` (src/hub/game.ts) calls this for every node that defines it, in record order, right after the set-up's world work (the loader's animation instances exist then) */
  ctorInit(w: World, rec: GameRecord): void { this.construct(w, rec); }

  /** FUN_004b4000 after the node block is allocated: the random heading / state / turn direction, the home position, the first clip */
  construct(w: World, rec: GameRecord): void {
    if (this.built) return;
    this.built = true;
    rec.ry = fr(rand(HEADING_RANGE) - HEADING_BASE);                         // RNG: FUN_004388ae via island/ambient/common.ts
    this.state = 2;
    if (rand(10.0) <= 5.0) { this.state |= FLAP_SINK; rec.rx = fr(PITCH_SINK); } else { this.state |= FLAP_CLIMB; rec.rx = fr(PITCH_CLIMB); }
    setRot(rec.m, rec.rx, rec.ry, rec.rz);                                    // FUN_0043a4a1
    this.home = [rec.x, rec.y, rec.z];
    if (!this.keepHeight) {
      let g = fr(w.col.terrainHeight(this.home[0], this.home[1], this.home[2], 0));   // FUN_0043cd62(node + 0x14, 0)
      if (g < MIN_ALT) g = MIN_ALT;
      rec.y = fr(rand(ALT_SPREAD) + g);
      this.home[1] = fr(g + MIN_ALT);
    }
    this.turn = rand(10.0) <= 5.0 ? fr(TURN_STEP) : fr(-TURN_STEP);
    ensureAnim(w, rec)?.start(this.clip, 0);                                  // FUN_0043b6a3(rec + 8, arg0, 0)
  }

  /** FUN_004b3bb7 */
  update(w: World, rec: GameRecord, _ctrl: Controller): number {
    void _ctrl;
    if (!this.built) this.construct(w, rec);
    const dx = fr(this.home[0] - rec.x), dy = fr(this.home[1] - rec.y), dz = fr(this.home[2] - rec.z);
    const bearing = fr(Math.atan2(dx, dz));                                   // FUN_0085d640(dx, dz)
    let err = fr(bearing - rec.ry);
    if (-PI <= err) { if (PI < err) err = fr(err - TWO_PI); } else err = fr(err + TWO_PI);
    const low = this.state & 0xf;
    if (low === STATE_STRAIGHT) {
      if (TURN_START < Math.abs(err)) this.state = (this.state & 0xf0) | STATE_TURN;     // FUN_0085d260 = fabs
    } else if (low === STATE_TURN) {
      if (TURN_END <= Math.abs(err)) rec.ry = fr(wrapPi(fr(rec.ry + this.turn)));
      else this.state = (this.state & 0xf0) | STATE_STRAIGHT;
    }
    const high = this.state & 0xf0;
    const anim = rec.anim;
    if (high === FLAP_SINK) {
      if (dy <= BAND) {
        const f = anim ? anim.frame : 0;                                      // FUN_0043b73f
        if (f < GLIDE_FROM || GLIDE_TO < f) anim?.advance(1.0, w.dt);         // FUN_0043b76a(anim, 1.0)
      } else {
        this.state = (this.state & 0xf) | FLAP_CLIMB;
        rec.rx = fr(PITCH_CLIMB);
        if (FLIP < rand(10.0)) this.turn = -this.turn;
      }
    } else if (high === FLAP_CLIMB) {
      if (dy < -BAND) {
        this.state = (this.state & 0xf) | FLAP_SINK;
        rec.rx = fr(PITCH_SINK);
        if (FLIP < rand(10.0)) this.turn = -this.turn;
      }
      anim?.advance(1.0, w.dt);
    }
    setRot(rec.m, rec.rx, rec.ry, rec.rz);                                    // FUN_0043a4a1
    rec.x = fr(fr(rec.m[8] * SPEED) + rec.x);
    rec.y = fr(fr(rec.m[9] * SPEED) + rec.y);
    rec.z = fr(fr(rec.m[10] * SPEED) + rec.z);
    return NODE_STOP;
  }
  /** FUN_004b3f4c returns 1 and does nothing */
  prerender(): void { /* nothing */ }
}

/** the constructor FUN_004b4000 of every gull the set-up attached (run once after the set-up, when the loader's animation instances exist) */
export function constructGulls(w: World): number {
  let n = 0;
  for (const rec of w.records) for (const node of rec.ctrl?.nodes ?? []) if (node instanceof GullNode) { node.construct(w, rec); n++; }
  return n;
}

export const gullFactory = (a: Attach) => new GullNode(ArgView.of(a as Attach & { args?: Uint8Array }));
