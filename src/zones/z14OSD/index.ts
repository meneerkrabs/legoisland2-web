// z14OSD, the Oasis (zone table index 11, z90OSD; story nodes 34 and 45): wrapper FUN_00628252, GameLoop FUN_00627c90, set-up FUN_00629788 -> FUN_006290ea (+ FUN_0062c500 for node 34,
// FUN_0062bb80 for node 45), per-frame HUD FUN_00628410, teardown FUN_0062980d / FUN_006285d5 (docs/re/m5/z14OSD.md).
// M5 hub module: the zone runs through the shared hub framework (src/hub: emulated set-up, HubContext, HubGame); this folder adds what the Oasis has of its own:
//   * the hub's constructors (registerCtor by address): Gems 0x62b220, scorpion 0x62ad35 / grab node 0x62af8d, Tumblewd 0x629d7e (also used by z16PYA / z23DIP) and PEPPSW 0x62ba3b (Pepper's mode switch);
//   * the loop's per-frame code (HUD, the two ambience loops of mode 2);
//   * the set-up calls the emulation only logged (node 45's sub-object matrices).
import { startTickClock } from '../common/tickrand.ts';
import { registerHub } from '../../hub/index.ts';
import type { HubGame } from '../../hub/game.ts';
import type { HubContext } from '../../hub/ctx.ts';
import { registerCtor } from '../../game/setup.ts';
import './gems.ts';
import './scorpion.ts';
import './tumbleweed.ts';
import { CTOR_PEPPSW, PeppSwNode } from './peppsw.ts';
import { H, play } from './common.ts';
import { OsdHudState, initOsdHud, updateOsdHud } from './hud.ts';
import { applySubMatrices } from './setup.ts';
import { constructRoster, hiddenList } from './looks.ts';
import { looksOf } from '../../island/vehicles/looks.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import { tickIslandBrickFx } from '../../fx/bricks/island.ts';

/** the zone game's state kept on the hub context (`HubContext.hub`) */
export interface OsdState { hud: OsdHudState; subMatrices: { record: number; part: number; applied: boolean }[] }
export const osdState = (ic: HubContext): OsdState => (ic.hub.osd ??= { hud: new OsdHudState(), subMatrices: [] } satisfies OsdState) as OsdState;

registerCtor(CTOR_PEPPSW, (a) => new PeppSwNode(a));

registerHub({
  archive: 'z14OSD',
  // FUN_006290ea: from the Adventure Island (var 0xa3 == 10) Pepper stays where the scene puts her, otherwise she stands on the PATH node 0x10 with the yaw 1.5708 (`*(PEPP + 0x50) = 0x3fc90f94`, FUN_0043a5e4):
  // the emulated set-up's record holds both
  arrival(env) {
    const p = env.emu.records.find((r) => r.name === 'PEPP');
    return p ? { pos: [p.pos[0], p.pos[1], p.pos[2]], yaw: p.euler[1] } : null;
  },
  bricks: true,   // FX_Bricks: the parked helicopter's look change morphs through the brick manager (looks.ts)
  // FUN_006283c0 (the wrapper's HUD set-up)
  onCreate(h: HubGame) {
    startTickClock();   // FUN_00435c81 in the wrapper FUN_00628252 (nothing in this zone reads FUN_00435c91, the base only matters for a later reader)
    osdState(h.ictx);
    initOsdHud(h.ctx.hud);
    // FUN_00655de3: the decor templates are drawn in mode 1 (and hidden: looks.ts)
    for (const i of hiddenList(h.ictx.pe)) { const r = h.ctx.world.records[i]; if (r) h.ctx.gr.setPartMode(r, 0xff, 1); }
    // SwapText (FUN_00443810 / FUN_004439f0): the helicopter's look replaces the model's textures (island/vehicles/looks.ts, the roster is this zone's)
    h.ctx.sh?.data?.archive('SwapText').then((arc) => {
      h.ctx.gr.swapArchive = arc;
      h.ctx.gr.swapTextures = (rec, lod) => looksOf(h.ctx.world)?.textures(rec, lod) ?? null;
    }).catch((e: unknown) => console.warn('z14OSD swaptext', e));
    h.ictx.fx?.finish();   // FUN_0044e8d0 after the zone's emitters (the gems', started by `registerHub`)
  },
  // FUN_00627c90: the 2D ambience loops every pass of mode 2 (FUN_004435a0(DAT_05d5bc88), FUN_004435a0(DAT_05d5bc9c)); FUN_00628410 on every pass
  frame(h: HubGame, mode: number) {
    if (mode === 2) { play(h.ctx.world, H.LOOP_A); play(h.ctx.world, H.LOOP_B); }
    updateOsdHud(h.ctx.hud, h.ctx.vars, osdState(h.ictx).hud, h.ctx.world.dt);
    tickIslandBrickFx(h.ctx.world);   // FUN_00442930 -> FUN_00447de0 (the look change's brick morph), every pass of the loop
  },
  afterSetup({ ictx, world, loaded }) {
    // PEPPSW's constructor tail FUN_00655de3 (the roster); Pepper's chain as the original's set-up built it: setupZone's stub guard does not exist in the original; DAT_009daa7c = 0x40 (the board SKBD)
    constructRoster(world, ictx.pe, (fn) => ictx.setup.run(fn, []));
    const c = loaded.pepper.ctrl;
    if (c) c.nodes = c.nodes.filter((n) => n.kind !== 'StubGuard');
    const board = ictx.setup.mem.u32(0x9daa7c) | 0;
    if (board >= 0 && board < world.records.length) vehicles(world).board = board;
    // FUN_0062bb80 (node 45): FUN_0043ea60(rec[70].model, 1 / 2) + 0x30 := 0
    osdState(ictx).subMatrices = applySubMatrices(world, ictx.setup);
  },
  debug(h: HubGame) { return { osd: { blink: osdState(h.ictx).hud.blink, subMatrices: osdState(h.ictx).subMatrices } }; },
});
