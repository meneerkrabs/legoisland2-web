// z38PAR: the zone's particle emitters, started where the original starts them (docs/re/m3/z38PAR.md "Particles"):
//   FUN_0046a926 (the pilot's constructor, first call): `footsmoke.par` x 2 on two static matrices (DAT_05d57de8 / DAT_05d57e28 = bones 7 and 5 of the pilot's pose x his record
//   matrix, refreshed every tick at the end of FUN_004686a3), `spray01` on record 3 (LAND, 0x144) at (92.8, 71.5, -126.8) when DAT_00987660 == 0 (the default display), all rotated
//   -pi / 2 about x with gate (2, 1, 1) = always on; FUN_004676cd (the boat's constructor, record 40): `James01` on its matrix (FUN_00442a00 gives it the live record matrix every tick).
// A restart of the pilot constructor (param_3 != NULL) switches the three on again (FUN_00442a20(.., 2, 1, 1)); the pilot's update switches the footsmokes off in the states 4 / 5
// (landing / over) and the spray in state 5.
import { GATE_ON } from '../../fx/particles/zone.ts';
import type { GameRecord } from '../../game/record.ts';
import { boneOfPose } from '../common/pose.ts';

/** the part of ZoneParticles the zone uses */
export interface FxApi {
  start(name: string, matrix: Float32Array | null, pos: ArrayLike<number>, rot: ArrayLike<number>, gate?: readonly [number, number, number]): number;
  on(h: number): void;
  off(h: number): void;
  setMatrix(h: number, m: Float32Array): void;
  finish(): void;
}

const HALF = -1.5707964;       // 0xbfc90fdb
/** 0x42b99b23 / 0x428ef7cf / 0xc2fdab02 (float32 immediates of FUN_0046a926) */
const SPRAY_POS = [92.8030014038086, 71.48400115966797, -126.83399963378906];

export class ParFx {
  private fx: FxApi;
  /** DAT_05d57de8 / DAT_05d57e28 */
  readonly boneM7 = new Float32Array(16); readonly boneM5 = new Float32Array(16);
  private smoke7 = -1; private smoke5 = -1; private spray = -1; private boat = -1;
  private pilotStarted = false;

  constructor(fx: FxApi) { this.fx = fx; this.boneM7[0] = this.boneM7[5] = this.boneM7[10] = this.boneM7[15] = 1; this.boneM5.set(this.boneM7); }

  /** FUN_0046a926 (pilot, in the order of the zone's attaches: records 8, then 40): the three emitters of the pilot, or on a restart the three gate-ons */
  pilotCtor(land: GameRecord | null, pilot: GameRecord, clip: number, frame: number) {
    const fx = this.fx;
    if (!this.pilotStarted) {
      this.pilotStarted = true;
      this.smoke7 = fx.start('footsmoke.par', this.boneM7, [0, 0, 0], [HALF, 0, 0], GATE_ON);
      this.smoke5 = fx.start('footsmoke.par', this.boneM5, [0, 0, 0], [HALF, 0, 0], GATE_ON);
      if (land) this.spray = fx.start('spray01', land.m, SPRAY_POS, [HALF, 0, 0], GATE_ON);
    } else {
      fx.on(this.smoke5); fx.on(this.smoke7);
      if (this.spray >= 0) fx.on(this.spray);
    }
    this.refresh(pilot, clip, frame);
  }

  /** FUN_004676cd: James01 on the boat's live matrix */
  boatCtor(boat: GameRecord) {
    this.boat = this.fx.start('James01', boat.m, [0, 0, 0], [HALF, 0, 0], GATE_ON);
  }
  /** FUN_00467520 (first call of the boat's update): FUN_00442a00(handle, record + 0xc) */
  boatTick(boat: GameRecord) { if (this.boat >= 0) this.fx.setMatrix(this.boat, boat.m); }

  /** the end of FUN_004686a3: states 4 / 5 switch the two footsmokes off, the others refresh the two bone matrices from the pose the last draw left (clip, frame at the start of the tick) */
  pilotTail(state: number, pilot: GameRecord, clip: number, frame: number) {
    if (state === 4 || state === 5) { this.fx.off(this.smoke5); this.fx.off(this.smoke7); }   // 0x46a734 (+0x88), 0x46a74f (+0x84)
    else this.refresh(pilot, clip, frame);
  }
  /** `case 5` of the state switch: the spray (+0x8c) off */
  pilotOver() { if (this.spray >= 0) this.fx.off(this.spray); }

  private refresh(pilot: GameRecord, clip: number, frame: number) {
    boneOfPose(this.boneM7, pilot, clip, frame, 7);
    boneOfPose(this.boneM5, pilot, clip, frame, 5);
  }
}
