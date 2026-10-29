// "Tumblewd" (Common\Z14OSD\...\Tumblewd.c): ctor FUN_00629d7e, table 0x914dc8 = { update FUN_00629830, pre-render FUN_00629a6e, destroy FUN_00629eb5, draw FUN_00629ce4 = FUN_00444480,
// save FUN_00629d45 (0x14 bytes at +0x20), size FUN_00629d20 }. The tumbleweeds roll over the sand, hop when the ground probe finds ground and vanish into the sand after 120 ticks.
// Attached with no argument block (FUN_006287d6 for the 7 records TUM0..TUM5, TUM6; gate 2 & 1 = 1: always); also used by the Pyramid (z16PYA).
// Node (0x34 bytes): +0x14 / +0x18 / +0x1c home x / y / z (the record's position when the constructor ran), +0x20 vertical speed, +0x24 the y of this frame's update (before the +2.1 lift),
// +0x28 timer, +0x2c state (0 rising / settling, 1 hopping on the ground, 2 sunk), +0x30 spin rate.
// Frame order: update (moves, sounds, arms the ground probe in state 1) -> probe pass (src/game/probe.ts, the transliteration of FUN_00427233: writes the hit height into the record) -> pre-render (state machine).
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode, Controller } from '../../game/controller.ts';
import { NODE_STOP } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { armControllerProbe } from '../../game/probehost.ts';
import { PROBE_DEAD } from '../../game/probe.ts';
import { setRot } from '../../island/ambient/common.ts';
import { f32, playAt, posOf, stop } from './common.ts';
import { fb, nameIs4 } from './exact.ts';

export const CTOR_TUMBLEWD = 0x629d7e;
/**
 * the sound handle of each tumbleweed: the update compares the record name (4 bytes, `_strncmp`) with the strings at 0x914e1c / 0x914e24 / 0x914e2c / 0x914e34 / 0x914e3c / 0x914e44 in turn and plays the
 * handle of EVERY match. The strings are "TUM0", "TUM01" (a typo of the original: matches TUM0 again, so TUM0 plays two sounds and TUM1 none), "TUM2" .. "TUM5"; TUM6 has none.
 * The destroy function FUN_00629eb5 stops them by the same rule with the strings at 0x914e84 .. 0x914eac (its second one is "TUM01" too).
 */
export const TUM_SOUNDS: ReadonlyArray<readonly [number, number]> = [
  [0x914e1c, 0x5d5bcb8], [0x914e24, 0x5d5bca8], [0x914e2c, 0x5d5bcac], [0x914e34, 0x5d5bcb0], [0x914e3c, 0x5d5bcb4], [0x914e44, 0x5d5bca0],
];
export const TUM_STOPS: ReadonlyArray<readonly [number, number]> = [
  [0x914e84, 0x5d5bcb8], [0x914e8c, 0x5d5bca8], [0x914e94, 0x5d5bcac], [0x914e9c, 0x5d5bcb0], [0x914ea4, 0x5d5bcb4], [0x914eac, 0x5d5bca0],
];
// the constants of the code (float32 values of the data words / literals)
const DRIFT = f32(-0.4);            // _DAT_00914de0 / _DAT_00914de4: x and z drift per tick (and the heading's atan2 arguments)
const VY_START = f32(0.4);          // DAT_00914dec: +0x20 at the start; the fall is limited to -0.4
const GRAVITY = f32(0.004);         // _DAT_00914de8
const VY_HIT = f32(0.08);           // DAT_00914df0: the hop speed after the probe found ground
const SPIN_START = fb(0x3e32b884); // 0x3e32b884 (the float literal of the code, 0.1745319962...: NOT f32(pi / 18))
const SPIN_MIN = fb(0x3d0efa03);  // 0x3d0efa03 = _DAT_00892584 (0.0349063985)
const SPIN_DECAY = fb(0x3b8efa03); // _DAT_00892734 (0.0043632998)
const LIFT = f32(2.1);              // _DAT_00892728: the record is drawn 2.1 above the node's y
const SINK_STEP = f32(0.004);       // _DAT_00914de8 again (not scaled by dt)
const SINK_LIMIT = f32(0.008);      // _DAT_00892730: the hop ends at this height
const REST_TICKS = f32(120);        // _DAT_0089272c
const RISE_TICKS = f32(30);         // _DAT_00892038

export class TumbleweedNode implements BehaviourNode {
  readonly kind = 'Tumblewd';
  var = 0; mask = 0; value = 0;
  stamp = 0xfffffffe;
  home: [number, number, number] = [0, 0, 0];   // +0x14 / +0x18 / +0x1c
  vy = VY_START;     // +0x20
  yNow = 0;          // +0x24
  timer = 0;         // +0x28
  state = 0;         // +0x2c
  spin = SPIN_START; // +0x30

  /** the constructor's work on the record (called by `registerHub` after the set-up: ctorInit) */
  ctorInit(_w: World, rec: GameRecord) {
    this.home = [rec.m[12], rec.m[13], rec.m[14]];
    rec.ry = f32(Math.atan2(DRIFT, DRIFT));
    rec.flags |= 0x10;
    // FUN_00444550(rec, 0xff, 2) = the render mode (applied from the constructor's render calls by the set-up extraction); FUN_0043ebe0(model, 0x14, &0xff555555, 0): the part-0 vertex
    // colour. Mode 2 draws the texture alone (block 1), so the vertex colour has no visible effect.
  }

  /** FUN_00629830 */
  update(w: World, rec: GameRecord, ctrl: Controller): number {
    const dt = w.dt;
    if ((rec.flags & 1) !== 0) {
      for (const [va, handle] of TUM_SOUNDS) if (nameIs4(w, rec, va)) playAt(w, handle, posOf(rec));
    }
    rec.m[13] = f32(rec.m[13] - LIFT);
    this.yNow = rec.m[13];
    rec.m[12] = f32(f32(DRIFT * dt) + rec.m[12]);
    rec.m[14] = f32(f32(DRIFT * dt) + rec.m[14]);
    if (this.state === 1) {
      // FUN_00427014(ctrl, &(0, 4, 0), &(0, -(vy * dt + 4), 0), 1, 0x110)
      armControllerProbe(ctrl, [0, 4.0, 0], [0, -f32(f32(this.vy * dt) + 4.0), 0], 1, 0x110);
    }
    rec.rx = f32(f32(this.spin * dt) + rec.rx);
    setRot(rec.m, rec.rx, rec.ry, rec.rz);
    return NODE_STOP;
  }

  /** FUN_00629a6e */
  prerender(w: World, rec: GameRecord, ctrl: Controller): void {
    const dt = w.dt;
    if (this.state === 0) {
      this.vy = f32(this.vy - f32(GRAVITY * dt));
      if (this.vy < -VY_START) this.vy = -VY_START;
      this.timer = f32(f32(1.0 * dt) + this.timer);
      if (RISE_TICKS < this.timer) this.state = 1;
    } else if (this.state === 1) {
      const hit = ctrl.probe?.result ?? 0;      // FUN_00427228(ctrl, 1): the controller's +0x64 (0 nothing, 1 / a record, 0xbabababa switched off)
      if (hit === 0 || hit === PROBE_DEAD) {
        // no ground below: falling on
        rec.m[13] = f32(f32(this.vy * dt) + this.yNow);
        this.vy = f32(this.vy - f32(GRAVITY * dt));
        if (this.vy < -VY_START) this.vy = -VY_START;
        this.spin = f32(this.spin - f32(SPIN_DECAY * dt));
        if (this.spin < SPIN_MIN) this.spin = SPIN_MIN;
      } else {
        // the probe found ground (the pass moved the record to it): hop
        this.vy = VY_HIT;
        this.spin = SPIN_START;
      }
      if (rec.m[13] <= SINK_LIMIT) {
        this.state = 2; this.timer = 0; this.vy = 0; this.spin = SPIN_MIN;
      }
    } else if (this.state === 2) {
      rec.m[13] = f32(rec.m[13] - SINK_STEP);
      this.timer = f32(f32(1.0 * dt) + this.timer);
      if (REST_TICKS < this.timer) {
        this.timer = 0;
        rec.m[13] = this.home[1]; rec.m[12] = this.home[0]; rec.m[14] = this.home[2];
        this.vy = VY_HIT; this.state = 0; this.spin = SPIN_START;
      }
    }
    rec.m[13] = f32(rec.m[13] + LIFT);
  }

  /** FUN_00629eb5: the sounds of the matching patterns are stopped */
  destroy(w: World, rec: GameRecord): void {
    for (const [va, handle] of TUM_STOPS) if (nameIs4(w, rec, va)) stop(w, handle);
  }
}

registerCtor(CTOR_TUMBLEWD, () => new TumbleweedNode());
