// z39ASB (Asteroid Belt): ported in M3, see docs/re/m3/z39ASB.md. Registers the zone game (registerZoneGame) and the shuttle behaviour (registerCtor 0x7b96a0).
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import { CTOR_SHUTTLE, ShuttleNode, createAsbGame } from './z39ASB/game.ts';

registerCtor(CTOR_SHUTTLE, () => new ShuttleNode());
registerZoneGame('z39ASB', createAsbGame);
