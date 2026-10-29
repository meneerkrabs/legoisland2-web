// z09JST "Jousting" (Castle Island): the duel against the Dark Knight, ported in M6 (docs/re/m6/z09JST.md). Registers the four behaviour constructors of the zone
// (JSTGame 0x5d1f64, Flag 0x5d3e7c, Anims 0x5d3cc1, Drkk 0x5d3ad4) and the zone game. There is no PEPP record: the duel has its own player objects.
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import { CTOR } from './z09jst/consts.ts';
import { AnimsNode, DrkkNode, FlagNode, JstGameNode } from './z09jst/rig.ts';
import { createJstGame } from './z09jst/game.ts';

registerCtor(CTOR.JSTGAME, () => new JstGameNode());
registerCtor(CTOR.FLAG, () => new FlagNode());
registerCtor(CTOR.ANIMS, () => new AnimsNode());
registerCtor(CTOR.DRKK, () => new DrkkNode());
registerZoneGame('z09JST', createJstGame);
