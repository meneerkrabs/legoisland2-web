// z16PYA, the Pyramid (index 13, z90PYA): wrapper FUN_00675f02, GameLoop FUN_00675930, set-up FUN_006768ce (root FUN_00676c22), per-frame FUN_006760d0, teardown FUN_00676ca2.
// M5 hub module (docs/re/m5/z16PYA.md): the zone runs through the shared hub framework (src/hub: emulated set-up -> records, nodes, cutscene slots ADV02 / ADV03, the three story
// bands <0x25 / <0x27 / <0x29 / else = nodes 36 / 38 / 40, texts and objective of FUN_00678000 / 00677900 / 006775d0). This module adds what the Pyramid's own code does:
//   * PeppSw (ctor 0x677350, src/zones/z16PYA/peppsw.ts): Pepper's mode switch with the temple sound, the random sounds and the music's groove level;
//   * the HUD (hud.ts): left gem count, centre hi-score, the interaction icon, on the overlay set of the Oasis (z14OSD);
//   * the two 2D ambience sounds the loop restarts every play pass (FUN_004435a0(DAT_05d5bdac) = sound 0x323, DAT_05d5bdb4 = 0x306);
//   * the scorpions 0x62ad35 / 0x62af8d, the gems 0x62b220 and the tumbleweeds 0x629d7e belong to the Oasis (z14OSD) and are shared by address.
import { registerHub } from '../../hub/index.ts';
import type { HubGame } from '../../hub/index.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import type { Pe } from '../../formats/exe.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { UiTextureSet } from '../../ui/renderer2d.ts';
import { PyaHud } from './hud.ts';
import { PyaPepSwitch, CTOR_PEPPSW, setRosterHooks } from './peppsw.ts';
import { constructRoster, hiddenList, pyaRosterHooks } from './roster.ts';
import { looksOf } from '../../island/vehicles/looks.ts';
import { tickIslandBrickFx } from '../../fx/bricks/island.ts';
import { startTickClock } from '../common/tickrand.ts';

/** DAT_009daa7c: the accessory (the skateboard record: SKBD, record 17 in this zone) */
const GLOBAL_ACCESSORY = 0x9daa7c;
/** DAT_05d5bdac = FUN_00443580(0x323), DAT_05d5bdb4 = FUN_00443580(0x306) (FUN_006762a0): the 2D sounds the loop starts every play pass */
const AMBIENCE = [{ addr: 0x5d5bdac, id: 0x323 }, { addr: 0x5d5bdb4, id: 0x306 }] as const;
/** the overlay set FUN_00676080 loads (`_data\Overlays\z14OSD\`) */
const OVERLAY_SET = 'z14OSD';

const hudOf = new WeakMap<HubGame, PyaHud>();

/**
 * After `setupZone` and the framework's world work (src/hub/game.ts): Pepper's chain as the original's set-up built it (PeppSw, 0x62af8d, SGwalk, sgswim, skate): `setupZone` adds
 * the stub guard (a fall-out-of-the-world net of the zones without a port) and, when a zone has its own mode switch it cannot attach, the island's PepSwitc: neither exists in
 * the original; the board record the mode switch and the skateboard node use (DAT_009daa7c, written by FUN_006768ce: 0x11, the island's is 9).
 */
export function applyPyaSetup(ictx: { setup: { mem: { u32(a: number): number }; run(fn: number, args?: number[]): unknown }; pe: Pe }, world: World, loaded: { pepper: GameRecord }) {
  constructRoster(world, ictx.pe, (fn) => ictx.setup.run(fn, []));   // PeppSw's constructor tail FUN_00698963
  setRosterHooks(world, pyaRosterHooks);
  const c = loaded.pepper.ctrl;
  if (c) c.nodes = c.nodes.filter((n) => n.kind !== 'StubGuard' && !(n.kind === 'PepSwitc' && c.nodes.some((x) => x.kind === 'PeppSw')));
  const board = ictx.setup.mem.u32(GLOBAL_ACCESSORY) | 0;
  if (board >= 0 && board < world.records.length) vehicles(world).board = board;
}

registerHub({
  archive: 'z16PYA',
  ctors: [[CTOR_PEPPSW, () => new PyaPepSwitch()]],
  // Pepper arrives where FUN_00678000 / 00677900 / 006775d0 put her: the PATH node 0x19 / 0x1a / 0x18 (nodes 36 / 38 / 40), facing 1.5708 (`*(PEPP + 0x50) = 0x3fc90f94`, then FUN_0043a5e4):
  // the emulated record holds both
  arrival(env) {
    const p = env.emu.records.find((r) => r.name === 'PEPP');
    return p ? { pos: [p.pos[0], p.pos[1], p.pos[2]], yaw: p.euler[1] } : null;
  },
  bricks: true,   // FX_Bricks: the Speedster's look change morphs through the brick manager (roster.ts)
  afterSetup({ ictx, world, loaded }) { applyPyaSetup(ictx, world, loaded); },
  onCreate(h) {
    startTickClock();   // FUN_00435c81 in the wrapper FUN_00675f02: the clock base of FUN_00435c91 (PeppSw's random sound draw)
    const hud = new PyaHud();
    hudOf.set(h, hud);
    hud.init(h.ctx.hud);
    // FUN_00676080: the overlay set of the Oasis (the zone's own name has none in the data)
    const sh = h.ctx.sh;
    sh?.data?.archive('Overlays').then((ov) => { h.ctx.hud.set = UiTextureSet.load(sh.gl.gl, ov, OVERLAY_SET); }).catch((e: unknown) => console.warn('z16PYA overlay', e));
    // FUN_00698963: the 15 decor templates are drawn in mode 1 (and hidden: roster.ts)
    for (const i of hiddenList(h.ictx.pe)) { const r = h.ctx.world.records[i]; if (r) h.ctx.gr.setPartMode(r, 0xff, 1); }
    // SwapText (FUN_00443810 / FUN_004439f0): the Speedster's look replaces the model's textures (island/vehicles/looks.ts, the roster is this zone's)
    sh?.data?.archive('SwapText').then((arc) => {
      h.ctx.gr.swapArchive = arc;
      h.ctx.gr.swapTextures = (rec, lod) => looksOf(h.ctx.world)?.textures(rec, lod) ?? null;
    }).catch((e: unknown) => console.warn('z16PYA swaptext', e));
  },
  frame(h, mode) {
    // GameLoop FUN_00675930: in play mode (2) every pass starts the two 2D ambience sounds (a sound that plays already only refreshes)
    if (mode === 2) for (const a of AMBIENCE) h.ictx.sfx(h.ictx.soundOf(a.addr) >= 0 ? h.ictx.soundOf(a.addr) : a.id);
    hudOf.get(h)?.update(h.ctx.hud, h.ctx.vars, h.ctx.world.dt);   // FUN_006760d0
    // FX_Bricks: the effects are updated in the draw pass (FUN_00442930 -> FUN_00447de0, called on every pass of the loop): the Speedster's look change morphs through it
    tickIslandBrickFx(h.ctx.world);
  },
});
