// z13CAI, the Adventure Island (index 10, z90ADV): wrapper FUN_0061aebb, GameLoop FUN_0061a821, set-up FUN_0061b1f4 (root FUN_0061beae), per-frame FUN_0061bf8c, teardown FUN_0061bf1b.
// M5 hub module (docs/re/m5/z13CAI.md): the zone runs through the shared hub framework (src/hub: emulated set-up -> records, nodes, texts and objective of the story bands = nodes 33 /
// 51). What the Adventure Island's own code does and this module adds:
//   * the vehicle controller `pepswitc` (ctor 0x61c2a4, pepswitc.ts) on the helicopter / Ptera Pepper flies: the volcano / gull sounds, "Pepper stepped off -> var 5 = Oasis", the Enter
//     look change of PHEL (its roster table 0x914bc8 + brick effect, run in the emulation);
//   * the circling gulls (ctor 0x4b4000, bunny.ts; shared with the Oasis: the framework's `ctorInit` runs their constructor half), the flowing LAVA / FALL water node (ctor 0x426f55, flow.ts; the renderer draws it);
//   * Pepper's chain is only the vehicle seat (SGVehic 0x4333c2 / the Ptera ride 0x4bb582): the set-up's helipad table (ONE pad: PATH node 0, exit node 0) is read from the emulation;
//   * the HUD (hud.ts): centre hi-score, the interaction icon on the overlay set of the Oasis; the var 0xc5 (Pepper's shadow type) the loop sets before it starts.
import { startTickClock } from '../common/tickrand.ts';
import { registerHub } from '../../hub/index.ts';
import type { HubGame, HubContext } from '../../hub/index.ts';
import { vehicles } from '../../island/vehicles/common.ts';
import { tickIslandBrickFx } from '../../fx/bricks/island.ts';
import { emulatedArrival } from '../../hub/arrival.ts';
import { looksOf } from '../../island/vehicles/looks.ts';
import type { World } from '../../game/world.ts';
import type { GameRecord } from '../../game/record.ts';
import { CTOR_GULL, gullFactory } from './bunny.ts';
import { CTOR_PEPSWITC_CAI, CaiPepSwitch, constructRoster } from './pepswitc.ts';
import { CTOR_FLOW, flowFactory } from './flow.ts';
import { CaiHud, OVERLAY_SET } from './hud.ts';
import { ZoneParticles } from '../../fx/particles/zone.ts';

/** the helipad table the set-up fills (FUN_0061b1f4): DAT_009daa14 = count, DAT_009daa18 (16 bit nodes), DAT_009daa38 (16 bit exit nodes), DAT_009daa2c (the map of each) */
const PAD_COUNT = 0x9daa14, PAD_NODES = 0x9daa18, PAD_EXITS = 0x9daa38, PAD_MAPS = 0x9daa2c;
/** var 0xc5 SWITCH_GME_PEPPERSSHADOW: the loop sets 5 when Pepper arrives on the Ptera record, 1 otherwise (FUN_0061a821, before the loop starts) */
const VAR_SHADOW = 0xc5, SHADOW_PTERA = 5, SHADOW_HELI = 1;
/** the record the Ptera arrival uses (PTER) */
const PTERA_RECORD = 24;

const hudOf = new WeakMap<HubGame, CaiHud>();

/**
 * After `setupZone` and the framework's world work (src/hub/game.ts): Pepper's chain as the original's set-up built it, the helipad table, the arrival in the vehicle and the roster of the vehicle controller
 * (the gulls' constructor half is the framework's `ctorInit`, which runs just before this).
 */
export function applyCaiSetup(ictx: HubContext, world: World, loaded: { pepper: GameRecord }) {
  // Pepper's chain: the set-up attaches only the seat (SGVehic) / the Ptera ride; the generic set-up added the island's walk / swim / mode nodes
  const c = loaded.pepper.ctrl;
  if (c) c.nodes = c.nodes.filter((n) => !['PepSwitc', 'SGwalk', 'sgswim'].includes(n.kind));
  const G = vehicles(world);
  // FUN_0061b1f4: DAT_009daa14 = 1 pad (PATH node 0, exit node 0, map 1); the island's boat docks are not set (count 0)
  const mem = ictx.setup.mem;
  const n = mem.r32(PAD_COUNT) | 0;
  // (the taken words are static process memory: FUN_0061b1f4 zeroes none of them, `useTables`)
  const pads = [];
  for (let i = 0; i < n; i++) pads.push({ map: mem.r8(PAD_MAPS + i), node: mem.r16(PAD_NODES + 2 * i), exit: mem.r16(PAD_EXITS + 2 * i) });
  G.useTables([], pads, 0, 0);
  // the vehicle the set-up put Pepper into (FUN_0051e4b0(2, 1): PHEL, RHEL or PTER by var 0xbb) and the control mode it wrote (setupZone reset var 0x5e)
  const a = emulatedArrival(ictx.setup);
  if (a.control !== null) world.vars.set(0x5e, a.control);
  const v = a.vehicle >= 0 ? world.records[a.vehicle] : undefined;
  if (v) {
    v.savePrev();
    G.current = v;
  }
  constructRoster(world, (fn) => ictx.setup.run(fn, []));   // FUN_006277b9
}

registerHub({
  archive: 'z13CAI',
  ctors: [[CTOR_GULL, gullFactory], [CTOR_PEPSWITC_CAI, () => new CaiPepSwitch()], [CTOR_FLOW, flowFactory]],
  // the emulated vehicle arrival of the framework needs a node gated by the control word's bit; here Pepper's seat has the gate (var 0x5e, mask 0): the module does it itself
  vehicleArrival: false,
  // FUN_0061bf50: the HUD's picture set is the Oasis' (the zone's own name has none in the data)
  overlay: OVERLAY_SET,
  bricks: true,
  afterSetup({ ictx, world, loaded }) { applyCaiSetup(ictx, world, loaded); },
  onCreate(h) {
    startTickClock();   // FUN_00435c81 in the wrapper FUN_0061aebb (nothing in this zone reads FUN_00435c91, the base only matters for a later reader)
    const hud = new CaiHud();
    hudOf.set(h, hud);
    hud.init(h.ctx.hud);
    const sh = h.ctx.sh;
    // FUN_0061bc41 (called by the set-up root): the ten emitters vol01-04, lava01-03, spray01 / 02 on LAND's matrix (gate always on). The emulated set-up recorded the calls; the
    // island's `finishEmitters` (src/island/emitters.ts, run by the probe pass of the first tick) starts them with their arguments in call order as soon as the engine is installed
    ZoneParticles.create(h.ctx).then((fx) => { h.ictx.fx = fx; }).catch((e: unknown) => console.warn('z13CAI particles', e));
    // GameLoop FUN_0061a821: var 0xc5 = 5 when the vehicle is the PTER record, else 1 (after FUN_00444850 made it 4)
    h.ctx.vars.set(VAR_SHADOW, vehicles(h.ctx.world).current?.index === PTERA_RECORD ? SHADOW_PTERA : SHADOW_HELI);
    // SwapText (FUN_00443810 / FUN_004439f0): the look of PHEL replaces the model's textures (island/vehicles/looks.ts, the cycler is the hub's roster)
    sh?.data?.archive('SwapText').then((arc) => {
      h.ctx.gr.swapArchive = arc;
      h.ctx.gr.swapTextures = (rec, lod) => looksOf(h.ctx.world)?.textures(rec, lod) ?? null;
    }).catch((e: unknown) => console.warn('z13CAI swaptext', e));
  },
  frame(h) {
    hudOf.get(h)?.update(h.ctx.hud, h.ctx.vars, h.ctx.world.dt);   // FUN_0061bf8c (every pass of the loop, any mode)
    // FX_Bricks: the effects are updated in the draw pass of EVERY loop mode (FUN_00442930 -> FUN_00447de0, called unconditionally before the mode switch of FUN_0061a821): PHEL's look change morphs through it
    tickIslandBrickFx(h.ctx.world);
  },
});
