// z50LTC: the zone's particle emitters, started where the original starts them (the engine is GENERICBITS: FUN_00442900 at 0x839c11, `twinkle01` / `paul01`):
//   FUN_0083a7d2 (the People constructor, once per person in the order of the table): `paul01` x 2 on the node's two matrices (+0x38 / +0x78 = the hand bones 14 and 16 of the person's pose x
//   the record matrix), rotation +pi / 2 about x, gate off, both with record 1 (0x68) in their collision list; then `TWINKLE01.par` through FUN_0044e920 on the person's live record matrix at (0, 2, 0), gate off.
//   FUN_00839e20 / FUN_0083a292 switch them: twinkle on (2, 1, 1) when the person appears / vanishes and off 3 ticks later; Paul Scully's (type 1) hands on at the start of his talk, their matrices
//   refreshed every tick of the talk, off when it ends.
import { GATE_OFF } from '../../fx/particles/zone.ts';
import type { GameRecord } from '../../game/record.ts';
import type { FxApi } from '../parachute/par-fx.ts';
import { boneOfPose } from '../common/pose.ts';
import type { LtcGlobals } from './people.ts';

export interface LtcFxApi extends FxApi { collideWith(h: number, rec: unknown): void }

const HALF_PI = 1.5707963705062866;   // 0x3fc90fdb

interface PersonFx { paul: [number, number]; hand: [Float32Array, Float32Array]; twinkle: number }

export class LtcFx {
  private fx: LtcFxApi;
  private by = new Map<GameRecord, PersonFx>();
  constructor(fx: LtcFxApi) { this.fx = fx; }

  /** FUN_0083a7d2, first call for `rec` */
  ctor(rec: GameRecord, collision: unknown) {
    const hand: [Float32Array, Float32Array] = [new Float32Array(16), new Float32Array(16)];
    const p0 = this.fx.start('paul01', hand[0], [0, 0, 0], [HALF_PI, 0, 0], GATE_OFF);
    const p1 = this.fx.start('paul01', hand[1], [0, 0, 0], [HALF_PI, 0, 0], GATE_OFF);
    this.fx.collideWith(p0, collision); this.fx.collideWith(p1, collision);
    const twinkle = this.fx.start('TWINKLE01.par', rec.m, [0, 2, 0], [0, 0, 0], GATE_OFF);
    this.by.set(rec, { paul: [p0, p1], hand, twinkle });
  }

  /** installs the node hooks */
  bind(g: LtcGlobals) {
    g.onTwinkle = (rec, start) => { const e = this.by.get(rec); if (e) { if (start) this.fx.on(e.twinkle); else this.fx.off(e.twinkle); } };
    g.onPaul = (rec, start, clip = 0, frame = 0) => {
      const e = this.by.get(rec); if (!e) return;
      if (start) { this.fx.on(e.paul[0]); this.fx.on(e.paul[1]); this.hands(rec, e, clip, frame); }
      else { this.fx.off(e.paul[0]); this.fx.off(e.paul[1]); }
    };
    g.onPaulTick = (rec, clip, frame) => { const e = this.by.get(rec); if (e) this.hands(rec, e, clip, frame); };
  }

  /** bones 14 / 16 (0xe / 0x10) x the record matrix into the node's matrices, handed to the sources (FUN_00442a00: a source keeps the reference) */
  private hands(rec: GameRecord, e: PersonFx, clip: number, frame: number) {
    boneOfPose(e.hand[0], rec, clip, frame, 14);
    boneOfPose(e.hand[1], rec, clip, frame, 16);
    this.fx.setMatrix(e.paul[0], e.hand[0]);
    this.fx.setMatrix(e.paul[1], e.hand[1]);
  }
}
