// z08BKD "Brick Dive" (castle island, story node of the zone table index 7): Pepper dives for five bridge bricks in a 500 second dive (FUN_005b8368 is the loop,
// FUN_005ba1bd the set-up, the behaviours FUN_005bc592 .. FUN_005c23f9), docs/re/m6/z08BKD.md. This file registers the constructors by address and the zone game;
// the game is in src/zones/z08bkd/.
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import type { Attach } from '../formats/zonesetup.ts';
import { AnchorNode, BallNode, BrickNode, CannonNode, ClamNode, OctopusNode, PageNode, PirateNode } from './z08bkd/bodies.ts';
import { CamNode, DiverNode } from './z08bkd/diver.ts';
import { DolphinNode, FishNode } from './z08bkd/swimmers.ts';
import { createBkdGame } from './z08bkd/game.ts';
import { track } from './z08bkd/run.ts';

/** constructor addresses (FUN_00423532's second argument of FUN_005b9430 = the extraction's `Attach.ctor`) */
export const BKD_CTOR = {
  SWIM: 0x5c23f9, CAM: 0x5c06d7, BRICK: 0x5c01e8, PAGE: 0x5bfad5, DOLPHIN: 0x5bf7ce, ANCHOR: 0x5be9f0, OCTOPUS: 0x5be5e0, CLAM: 0x5be08a, PIRATE: 0x5bd8b4,
  CANNON: 0x5bd2b1, BALL: 0x5bcd17, FISH: 0x5bc592,
} as const;

registerCtor(BKD_CTOR.SWIM, () => track(new DiverNode()));
registerCtor(BKD_CTOR.CAM, () => track(new CamNode()));
registerCtor(BKD_CTOR.BRICK, () => track(new BrickNode()));
registerCtor(BKD_CTOR.PAGE, () => track(new PageNode()));
registerCtor(BKD_CTOR.DOLPHIN, () => track(new DolphinNode()));
registerCtor(BKD_CTOR.ANCHOR, () => track(new AnchorNode()));
registerCtor(BKD_CTOR.OCTOPUS, () => track(new OctopusNode()));
registerCtor(BKD_CTOR.CLAM, () => track(new ClamNode()));
registerCtor(BKD_CTOR.PIRATE, () => track(new PirateNode()));
registerCtor(BKD_CTOR.CANNON, () => track(new CannonNode()));
registerCtor(BKD_CTOR.BALL, () => track(new BallNode()));
registerCtor(BKD_CTOR.FISH, (a: Attach) => track(new FishNode((a as unknown as { argWords: number[] }).argWords ?? [0, 0, 0])));

registerZoneGame('z08BKD', async (ctx) => createBkdGame(ctx));
