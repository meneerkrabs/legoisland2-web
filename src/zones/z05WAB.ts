// z05WAB (Whack-A-Bot / "Botten meppen"): ported in M3 (docs/re/m3/z05WAB.md). Registers its zone game (registerZoneGame) and the two behaviour constructors
// (registerCtor) when imported by src/zones/index.ts; the game logic is in z05WAB/wab.ts (pure), the shell binding in z05WAB/game.ts.
import { registerCtor } from '../game/setup.ts';
import { ZoneParticles } from '../fx/particles/zone.ts';
import { registerZoneGame } from '../shell/zonegame.ts';
import { CTOR, createBotNode, createPepNode, createWabGame } from './z05WAB/game.ts';

registerCtor(CTOR.PEPWAB, () => createPepNode());
registerCtor(CTOR.BOTWAB, () => createBotNode());
/** FUN_0056905a's first statement: DAT_0089df2c = 0x3f11eb85 (the camera zoom, a vertical field of view of 0.57 rad; the default is 1.0), before the set-up that creates the particle engine (it reads the zoom) */
const WAB_FOV = new Float32Array(new Uint32Array([0x3f11eb85]).buffer)[0];
registerZoneGame('z05WAB', async (ctx) => { ctx.gr.fov = WAB_FOV; return createWabGame(ctx, await ZoneParticles.create(ctx)); });
