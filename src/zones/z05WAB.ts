// z05WAB (Whack-A-Bot / "Botten meppen"): ported in M3 (docs/re/m3/z05WAB.md). Registers its zone game (registerZoneGame) and the two behaviour constructors
// (registerCtor) when imported by src/zones/index.ts; the game logic is in z05WAB/wab.ts (pure), the shell binding in z05WAB/game.ts.
import { registerCtor } from '../game/setup.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import { CTOR, createBotNode, createPepNode, createWabGame } from './z05WAB/game.ts';

registerCtor(CTOR.PEPWAB, () => createPepNode());
registerCtor(CTOR.BOTWAB, () => createBotNode());
registerZoneGame('z05WAB', (ctx) => createWabGame(ctx));
