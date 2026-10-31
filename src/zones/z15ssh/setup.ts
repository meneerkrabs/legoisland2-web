// z15SSH: what the zone's set-up leaves behind around the nodes (the loader FUN_0066f47d's rigs, the constructor's paths FUN_00659d94, the helper records for the
// coconuts), done once per run on a freshly set-up world. Used by the zone game (src/zones/z15SSH.ts) and the node tests.
import type { Archive } from '../../formats/archive.ts';
import type { ZoneScene } from '../../formats/exe.ts';
import { parseBlk } from '../../formats/anim.ts';
import type { Blk } from '../../formats/anim.ts';
import type { Loaded } from '../../game/setup.ts';
import type { World } from '../../game/world.ts';
import { GameRecord } from '../../game/record.ts';
import { PathSpline } from './spline.ts';
import { PartStore } from './parts.ts';
import { CartNode, REC, K, hexf } from './rules.ts';
import type { SshSounds, SshRng } from './rules.ts';

/** the `.man` files of the constructor (FUN_00659d94: DAT_05d5bd30 / bd34 cartpos1, bd38 / bd2c CARBUT, bd3c SNAKEPOSL, bd40 SNAKEPOSR) */
export const PATHS = { CART: 'matanim/CARBUT.man', CRT: 'matanim/cartpos1.man', SNAKE_L: 'matanim/SNAKEPOSL.man', SNAKE_R: 'matanim/SNAKEPOSR.man' } as const;

/** the camera of the loop's mode 0 (FUN_00656372: DAT_009da5e8 = eye (0xc254825b, 0x42d04dd3, 0xc32d9efa), target (0xc25219b4, 0x42b84d9f, 0xc34d9eb8)) */
export const INTRO_CAMERA = {
  eye: [hexf(0xc254825b), hexf(0x42d04dd3), hexf(0xc32d9efa)] as const,
  target: [hexf(0xc25219b4), hexf(0x42b84d9f), hexf(0xc34d9eb8)] as const,
};

export interface SshSetup { node: CartNode; parts: PartStore; coco: GameRecord[]; cart: GameRecord }

export function loadPath(archive: Archive, member: string): PathSpline {
  const e = archive.find(member);
  if (!e) throw new Error(`z15SSH: ${member} missing from the archive`);
  return PathSpline.fromMan(archive.read(e));
}
function rig(archive: Archive, name: string): Blk | null {
  const e = archive.find(`anim/${name}.blk`);
  return e ? parseBlk(archive.read(e)) : null;
}

/**
 * Bind the buggy node of a set-up world: loads the paths and rigs, gives the records their animation instances, removes the stub chain, makes the coconut
 * helper records (pass `coco: false` in tests that do not render) and puts the camera where the loop leaves it in mode 0.
 */
export function prepareSsh(world: World, _loaded: Loaded, archive: Archive, scene: ZoneScene, opts: { sounds?: SshSounds; rng?: SshRng; say?: (id: string) => boolean; coco?: boolean } = {}): SshSetup {
  const R = world.records;
  const cart = R[REC.CART];
  const node = cart.ctrl?.find<CartNode>('Walk');
  if (!node) throw new Error('z15SSH: the buggy node is not attached (constructor 0x659d94 not registered)');
  // the zone has its own player node: the M1 chain (SGwalk, ...) of the generic set-up is dropped
  cart.ctrl!.nodes = [node];
  cart.ctrl!.exclusive = null;
  const parts = new PartStore(archive, scene);
  const cocoRecords: GameRecord[] = [];
  if (opts.coco !== false) {
    for (let k = 0; k < K.COCONUTS; k++) {
      const r = new GameRecord('COCO');
      r.index = R.length;
      r.model = R[REC.COCO].model;
      r.flags = 0;
      R.push(r);
      cocoRecords.push(r);
    }
  }
  const snakeL = loadPath(archive, PATHS.SNAKE_L), snakeR = loadPath(archive, PATHS.SNAKE_R), carbut = loadPath(archive, PATHS.CART);
  node.bind({
    records: R, parts, rigs: { MFIG: rig(archive, 'MFIG'), SNK1: rig(archive, 'SNK1') },
    // DAT_05d5bd2c (the buggy) and DAT_05d5bd38 (snake 1) are separate objects of the same file; `PathSpline` keeps no state between projections that matters
    paths: { cart: carbut, snakes: [loadPath(archive, PATHS.CART), snakeL, snakeR], crt: loadPath(archive, PATHS.CRT) },
    sounds: opts.sounds, rng: opts.rng, say: opts.say, cocoRecords,
  });
  const c = world.camera.c;
  c[0] = INTRO_CAMERA.eye[0]; c[1] = INTRO_CAMERA.eye[1]; c[2] = INTRO_CAMERA.eye[2];
  c[3] = INTRO_CAMERA.target[0]; c[4] = INTRO_CAMERA.target[1]; c[5] = INTRO_CAMERA.target[2];
  world.camera.updateView(); world.camera.savePrev();
  return { node, parts, coco: cocoRecords, cart };
}
