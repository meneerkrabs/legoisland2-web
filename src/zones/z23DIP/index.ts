// z23DIP, the Dino island (zone table index 19, z90DIP; story nodes 47 and 50): wrapper FUN_0072645c, GameLoop FUN_00725ec1, set-up FUN_00726e25 (root FUN_007272ee), per-frame
// HUD FUN_00726610, teardown FUN_00727336. M5 hub module: the zone runs through the shared hub framework (src/hub: emulated set-up, HubContext, HubGame); this folder holds what is
// the Dino island's own (docs/re/m5/z23DIP.md): Pepper's mode switch PeppSw (pepsw.ts), the balloon (loon.ts), the HUD (hud.ts), the set-up leftovers (setup.ts).
//   * the set-up (bands < 0x30 / < 0x33 / else: FUN_0072a2b0 / FUN_007283e0, sea -80, gravity -10, 5 point lights, the main camp, the T-Rex / Pterodactyl hologram triggers,
//     2 cutscenes ADV07 / ADV10, music `ad2` with groove -2) is RUN out of the executable in the x86 emulation (the framework); the shared families (SGMFIG, Turn2Pep, MeetPepp,
//     Human1, StartCSM, hOLO, SGwalk, sgswim, the skateboard) are the island's, the gems (0x62b220) belong to z14OSD's worker;
//   * there is no story handler in this zone's loop: the hologram texts / the objective arrow are chosen by the set-up (FUN_007283e0 / FUN_0072a2b0: FUN_00423fe0 / FUN_0088d280 /
//     FUN_00424270, replayed by the framework), the story FSM's own conditions (var 0x101 = 2 for node 47, 1 for node 50) end the visit (src/shell/story.ts).
import { tickIslandBrickFx } from '../../fx/bricks/island.ts';
import { startTickClock } from '../common/tickrand.ts';
import { registerHub } from '../../hub/index.ts';
import type { HubGame, HubSpec } from '../../hub/game.ts';
import { CTOR, HUD } from './consts.ts';
import { DipPepSwitch, setDecorHooks } from './pepsw.ts';
import { dipDecorHooks, ensureDipLooks } from './decor.ts';
import { LoonNode } from './loon.ts';
import { DipHudState, initDipHud, updateDipHud } from './hud.ts';
import { applyAnimTimes, applyDecorRecords, setBoardRecord } from './setup.ts';

const HUD_KEY = 'z23DIP.hud';
const hudState = (h: HubGame): DipHudState => (h.ictx.hub[HUD_KEY] as DipHudState | undefined) ?? (h.ictx.hub[HUD_KEY] = new DipHudState());

/** the zone's part of the world work after `setupZone` (`HubSpec.afterSetup`; tools/tests call it after `loadHub`) */
export function dipAfterSetup({ ictx, world, loaded }: Parameters<NonNullable<HubSpec['afterSetup']>>[0]) {
  // (the M1 mode switch the generic set-up adds when the zone's chain has the swim node but no node of the island's PepSwitc family)
  const chain = loaded.pepper.ctrl;
  if (chain) chain.nodes = chain.nodes.filter((n) => n.kind !== 'PepSwitc');
  const i = loaded.notes.findIndex((n) => n.startsWith('mode switch: M1 PepSwitc added'));
  if (i >= 0) loaded.notes.splice(i, 1, 'mode switch: the zone\'s own PeppSw (src/zones/z23DIP/pepsw.ts) replaces the generic M1 switch');
  setBoardRecord(world);
  applyDecorRecords(world, ictx.pe);
  setDecorHooks(world, dipDecorHooks);   // Enter / every tick of FUN_00765281 / FUN_00765316: the outfit swap of the stage figures
  ictx.hub.animTimes = applyAnimTimes(world, ictx.setup);
}

registerHub({
  archive: 'z23DIP',
  ctors: [
    [CTOR.PEPPSW, () => new DipPepSwitch()],
    [CTOR.LOON, () => new LoonNode()],
  ],
  overlay: HUD.OVERLAY,
  afterSetup: dipAfterSetup,
  onCreate(h) { startTickClock();   // FUN_00435c81 in the wrapper FUN_0072645c (nothing in this zone reads FUN_00435c91, the base only matters for a later reader)
    initDipHud(h.ctx.hud);
    ensureDipLooks(h.ctx.world); },   // the wrapper's FUN_00421bbe(4): the stored decor applied before the first frame
  frame(h) { updateDipHud(h.ctx.hud, h.ctx.vars, hudState(h), h.ctx.world.dt); tickIslandBrickFx(h.ctx.world); /* FUN_00442930 in every pass (no brick effect is registered here: a no-op) */ },
  debug(h) { return { hud: { blink: hudState(h).blink } }; },
});
