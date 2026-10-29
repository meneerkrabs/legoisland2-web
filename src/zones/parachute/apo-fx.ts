// z40aPO: the zone's particle emitters, started where the original starts them:
//   FUN_007d53af (the pilot "Parogel", first of the zone's attaches): `footsmoke.par` x 2 on the static matrices DAT_05d5f210 / DAT_05d5f250 (bones 2 and 4 of the pilot's pose x his record matrix, refreshed
//   at the end of FUN_007d3187 outside the states 5 / 6) at (+-0.79, 0.07, -0.53), and `T_gold.par` on record 3 (TAR1, the gold target) at the origin; rotation -pi / 2 about x; then T_gold is switched
//   off and both footsmokes on (the constructor does that on every call). `T_gold` goes on (2, 1, 1) every tick below the third group's height while a ring of that group was passed.
//   FUN_007d2650 ("Brickbot"): `rocket01.par` on each of the eight brickbot records (BBT0..7, live matrix), gate (2, 1, 1); FUN_007d19e0 switches it off (1, 1, 1) while a bot is parked below
//   y = 500 and on at its launch. (`botexpl01.par` goes through FUN_004429e0, which returns the invalid handle 0xbabababa: nothing is started and no slot is used.)
import { GATE_OFF, GATE_ON } from '../../fx/particles/zone.ts';
import type { GameRecord } from '../../game/record.ts';
import { boneOfPose } from '../common/pose.ts';
import type { FxApi } from './par-fx.ts';

const HALF = -1.5707964;       // 0xbfc90fdb
const SMOKE_L = [0.7900000214576721, 0.07000000029802322, -0.5299999713897705];     // 0x3f4a3d71 / 0x3d8f5c29 / 0xbf07ae14
const SMOKE_R = [-0.7900000214576721, 0.07000000029802322, -0.5299999713897705];    // 0xbf4a3d71

export class ApoFx {
  private fx: FxApi;
  /** DAT_05d5f210 / DAT_05d5f250: static in the original (zero until the pilot's first update) */
  readonly boneM2 = new Float32Array(16); readonly boneM4 = new Float32Array(16);
  private smoke2 = -1; private smoke4 = -1; private gold = -1;
  private rocket: number[] = [];
  private started = false;

  constructor(fx: FxApi) { this.fx = fx; }

  /** FUN_007d53af */
  pilotCtor(tar1: GameRecord | null) {
    const fx = this.fx;
    if (!this.started) {
      this.started = true;
      this.smoke2 = fx.start('footsmoke.par', this.boneM2, SMOKE_L, [HALF, 0, 0], GATE_ON);      // +0xa4
      this.smoke4 = fx.start('footsmoke.par', this.boneM4, SMOKE_R, [HALF, 0, 0], GATE_ON);      // +0xa8
      this.gold = fx.start('T_gold.par', tar1 ? tar1.m : null, [0, 0, 0], [HALF, 0, 0], GATE_OFF); // +0xb0
    }
    fx.off(this.gold); fx.on(this.smoke2); fx.on(this.smoke4);
  }

  /** FUN_007d2650: the eight rockets (`bots` = BBT0..7) */
  botsCtor(bots: readonly GameRecord[]) {
    if (this.rocket.length) return;
    for (const b of bots) this.rocket.push(this.fx.start('rocket01.par', b.m, [0, 0, 0], [0, 0, 0], GATE_ON));
  }
  /** FUN_007d19e0: bot i parked below 500 (off) / launched (on) */
  rocketGate(i: number, on: boolean) { const h = this.rocket[i]; if (h !== undefined) { if (on) this.fx.on(h); else this.fx.off(h); } }
  /** FUN_007d3187: `T_gold` on (the third group was passed and the pilot is below its height) */
  goldOn() { this.fx.on(this.gold); }
  /** the end of FUN_007d3187's second block: states 5 / 6 switch the two footsmokes off (+0xa8, +0xa4); else the bones 2 and 4 refresh the two matrices (pose of the start of the tick) */
  pilotTail(state: number, pilot: GameRecord, clip: number, frame: number) {
    if (state === 5 || state === 6) { this.fx.off(this.smoke4); this.fx.off(this.smoke2); }
    else { boneOfPose(this.boneM2, pilot, clip, frame, 2); boneOfPose(this.boneM4, pilot, clip, frame, 4); }
  }
}
