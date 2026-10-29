// The part of the zone's set-up that needs no browser: the skeletons of the animated records, the track spline, the WalkRock nodes, the constructors' effects on the records
// (`bind` of every node) and the car's controller chain. Used by the zone game (src/zones/z20DSP.ts) and by the node tests.
import { Controller } from '../../game/controller.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import type { Loaded } from '../../game/setup.ts';
import type { Archive } from '../../formats/archive.ts';
import type { ZoneScene } from '../../formats/exe.ts';
import { parseBlk, parseMan } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import { DspShared, REC, VAR, STATE } from './shared.ts';
import { TrackSpline, trackPoints } from './spline.ts';
import { SpeedsterNode } from './speedster.ts';
import { WalkRockNode, PropNode, ROCK } from './props.ts';
import { DspCamera } from './camera.ts';

/** the record names the code compares and the indices it hard-codes: a mismatch means the executable is not the NL build */
export function checkRecords(records: readonly GameRecord[]): string[] {
  const bad: string[] = [];
  const want = (i: number, n: string) => { if (records[i]?.name !== n) bad.push(`record ${i} is ${records[i]?.name}, expected ${n}`); };
  want(REC.LAND, 'LAND'); want(REC.PEPP, 'PEPP'); want(REC.MFIG, 'MFIG'); want(REC.BIGB, 'BIGB');
  want(REC.WEBR, 'WEBR'); want(REC.WEBL, 'WEBL'); want(REC.WEFR, 'WEFR'); want(REC.WEFL, 'WEFL'); want(REC.WHRL, 'WHRL');
  REC.COW.forEach((i, k) => want(i, `COW${k}`));
  REC.TURB.forEach((i) => want(i, 'TURB')); REC.TIME.forEach((i) => want(i, 'TIME'));
  return bad;
}

export interface DspPrepared { speed: SpeedsterNode; camera: DspCamera; shared: DspShared }

/** the pairs (Brickbot, rock) of the table at 0x92af70 (`pe.u32`): FUN_006be930's attach loop */
export function rockPairs(pe: { u32(va: number): number }): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    const b = pe.u32(ROCK.PAIRS_VA + i * 8) | 0, r = pe.u32(ROCK.PAIRS_VA + i * 8 + 4) | 0;
    if (b === -1) break;
    out.push([b, r]);
  }
  return out;
}

export function prepareDsp(shared: DspShared, world: World, loaded: Loaded, archive: Archive, scene: ZoneScene, pe: { u32(va: number): number }): DspPrepared {
  const R = world.records;
  const bad = checkRecords(R);
  if (bad.length) throw new Error(`z20DSP: ${bad.join('; ')}`);
  const pep = loaded.pepper;
  const rig = (n: string): Blk => parseBlk(archive.read(archive.find(`anim/${n}.blk`)!));
  const MFIG = rig('MFIG'), COWS = rig('COWS'), BIGB = rig('BIGB');
  pep.anim = null;                                    // the car is a rigid mesh (the stub set-up gave it the figure's rig)
  R[REC.MFIG].anim = new AnimInstance(MFIG);
  for (const i of REC.BBT) R[i].anim = new AnimInstance(MFIG);
  for (const i of REC.COW) R[i].anim = new AnimInstance(COWS);
  R[REC.BIGB].anim = new AnimInstance(BIGB);

  shared.world = world;
  shared.track = new TrackSpline(trackPoints(parseMan(archive.read(archive.find('matanim/car1.man')!))));
  shared.smashedModel = scene.models.find((m) => m.array === 'g98380c' && m.index === 0x7b) ?? null;   // DAT_0098380c + 0x7b * 0x18: smashedcac.Msh

  // WalkRock: the pair gets the names the Speedster tests (BBBB / BBBA), the rock gets the node
  for (const [b, r] of rockPairs(pe)) {
    const bot = R[b], rock = R[r];
    bot.name = 'BBBB'; rock.name = 'BBBA';
    rock.ctrl = new Controller();
    const n = new WalkRockNode(bot);
    n.shared = shared;
    rock.ctrl.attach(n, 0);
  }

  const speed = pep.ctrl?.nodes.find((n): n is SpeedsterNode => n.kind === 'SpeedStr');
  if (!speed) throw new Error('z20DSP: the SpeedStr node was not attached by the set-up');
  for (const rec of R) for (const n of rec.ctrl?.nodes ?? []) if (n instanceof PropNode) n.bind(shared, world, rec);
  pep.ctrl!.nodes = [speed]; pep.ctrl!.exclusive = null;
  speed.bind(world, pep);
  for (const rec of R) rec.savePrev();

  world.vars.set(VAR.STATE, STATE.WAIT);
  for (const v of [VAR.RESULT, VAR.RECORD, VAR.WRONG_WAY, VAR.SPIN, VAR.SHRINK, VAR.REPLAY]) world.vars.set(v, 0);
  const camera = new DspCamera();
  camera.step(world, shared);
  world.camera.savePrev();
  return { speed, camera, shared };
}
