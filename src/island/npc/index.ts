// WP3 (docs/re/m4/wp3-npc.md): the island's talking minifigs and their companions. Importing this registers the constructors:
//   0x426151 SGMFIG (talking NPC)   0x4bec00 Human1 (walking routes)   0x52ff39 / 0x5306e5 / 0x5308f3 Turn2Pep A / B / C   0x530d69 MeetPepp
// and gives the zone game `startIslandNpcs(world, archive)`: load the waypoint maps (FUN_004630c0 x 4 of the set-up) and run the constructors' work
// (walker, terrain snap, animation instance) before the first tick.
import { registerCtor, ctorFactory } from '../../game/setup.ts';
import type { World } from '../../game/world.ts';
import type { Archive } from '../../formats/archive.ts';
import type { IslandSetup } from '../../formats/emusetup.ts';
import { waypoints, MAP_NAMES } from '../../game/walker.ts';
import { ArgView } from '../args.ts';
import { CTOR_SGMFIG, SgmfigNode, decodeSgmfig } from './sgmfig.ts';
import { CTOR_HUMAN1, Human1Node, decodeHuman1 } from './human1.ts';
import { CTOR_LAUNCH, LaunchNode } from './launch.ts';
import { BunnyNode } from '../ambient/animals.ts';
import { BRICKBOT_FACTORIES, startBrickBots } from './brickbot.ts';
import { SpeederNode, DriverNode, CTOR_SPEEDER, CTOR_DRIVER } from '../pizza/speeder.ts';
import { TrainNode, CTOR_TRAIN } from '../pizza/train.ts';
import { CTOR_MEETPEPP, CTOR_TURN2PEP_A, CTOR_TURN2PEP_B, CTOR_TURN2PEP_C, MeetPeppNode, Turn2PepANode, Turn2PepBNode, Turn2PepCNode, decodeMeetPepp, decodeTurn2PepA, decodeTurn2PepB, decodeTurn2PepC } from './turn2pep.ts';

registerCtor(CTOR_SGMFIG, (a) => new SgmfigNode(decodeSgmfig(ArgView.of(a)), a));
registerCtor(CTOR_HUMAN1, (a) => new Human1Node(decodeHuman1(ArgView.of(a)), a));
registerCtor(CTOR_LAUNCH, (a) => LaunchNode.of(a));   // gaps S3: the kids' jump (FUN_004bf329)
registerCtor(CTOR_TURN2PEP_A, (a) => new Turn2PepANode(decodeTurn2PepA(ArgView.of(a)), a));
registerCtor(CTOR_TURN2PEP_B, (a) => new Turn2PepBNode(decodeTurn2PepB(ArgView.of(a)), a));
registerCtor(CTOR_TURN2PEP_C, (a) => new Turn2PepCNode(decodeTurn2PepC(ArgView.of(a)), a));
registerCtor(CTOR_MEETPEPP, (a) => new MeetPeppNode(decodeMeetPepp(ArgView.of(a)), a));
// the cars and the train create their walkers in their constructors as well (FUN_00462d4f: the walker handles are slot numbers in the order of the constructors): their nodes get a creation number
// from the same counter as the NPC nodes, so that `startWalkerNodes` can run all of them in the set-up's attach order
for (const addr of [CTOR_SPEEDER, CTOR_TRAIN, CTOR_DRIVER]) {
  const f = ctorFactory(addr);
  if (f) registerCtor(addr, (a) => { const n = f(a); stampSeq(n); return n; });
}
// WP11: BrickBot.c (0x531d45 / 0x5327b1 / 0x532acc / 0x533ba8) and botPConly.c (0x53de63), docs/re/m4/wp11-brickbot.md
for (const [addr, f] of BRICKBOT_FACTORIES) registerCtor(addr, f);

/**
 * FUN_004630c0 for the maps the set-up loads (`setup.waypointMaps`: slot, `_Data\z02LGI\Waypoints\W_<MAP>`; all four on the island): the walker table
 * is cleared (FUN_004613d0) and the compiled maps `Waypoints/W_<MAP>_C.wpt` are read from the archive. Returns the node counts per slot.
 */
export function loadIslandWalkMaps(archive: Archive, setup?: IslandSetup | null): number[] {
  waypoints.unload();
  const slots = setup?.waypointMaps?.length ? setup.waypointMaps.map((m) => ({ slot: m.index, base: (m.path ?? '').split('\\').pop() ?? '' })) : MAP_NAMES.map((n, slot) => ({ slot, base: `W_${n}` }));
  const counts = [0, 0, 0, 0];
  for (const { slot, base } of slots) {
    if (slot < 0 || slot > 3 || !base) continue;
    const e = archive.find(`Waypoints/${base}_C.wpt`);
    if (!e) continue;
    try { waypoints.loadMap(slot, archive.read(e)); counts[slot] = waypoints.mapCount(slot); } catch { /* a broken map stays unloaded */ }
  }
  return counts;
}

/**
 * The work of the constructors that needs the world (the factories of `registerCtor` only see the attach): every SGMFIG / Human1 node of the world
 * creates its walker, snaps to the ground and gets its animation instance now (in record order = the set-up's order). Call after `setupZone` and
 * `loadIslandWalkMaps`, with the island context installed. Nodes not initialised here do it on their first update.
 */
export function startIslandNpcs(w: World) {
  w.beforePrerender = islandProbePass;   // the first tick's emitter start; the probe pass itself is the shared one of World.tick (FUN_00427233)
  w.afterTick = clearNear;               // FUN_0042271b zeroes every controller's +0x14 after the draw (D3)
  startWalkerNodes(w, false);
}

/**
 * The constructors' world work in the original's attach order (D1): SGMFIG / Human1 / launch / the cars / the train / the bots' nodes of every record, interleaved as the set-up attaches them
 * (every node has a creation number: `seq`, or the one the factory wrapper above stamped). The walker handles are slot numbers handed out in this order (FUN_00462d4f in the constructors of
 * SGMFIG, the cars and the train): they must equal the original's because the save game's walker table is addressed by them. Idempotent (every node's `init` runs once); called by
 * `startIslandNpcs` (the NPCs and the bots only: the vehicles are the pizza module's: the test oracle of tools/lib/m7-isl-npc-emu.mjs builds no cars) and by `startPizzaNodes` (`vehicles`: also the
 * cars' and the train's walkers, which belong in the same sequence).
 */
export function startWalkerNodes(w: World, vehicles = true) {
  const all: { seq: number; run: () => void }[] = [];
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c) continue;
    for (const n of c.nodes) {
      if (n instanceof SgmfigNode || n instanceof Human1Node || n instanceof LaunchNode) all.push({ seq: n.seq, run: () => n.init(w, rec, c) });
      else if (n instanceof BunnyNode) all.push({ seq: n.seq, run: () => n.init(w, rec) });      // Bunny.c's constructor FUN_004b2149 (the start heading draws a random number)
      else if (vehicles && n instanceof DriverNode) { const s = seqOfNode(n); if (s !== undefined) all.push({ seq: s, run: () => n.init(w, rec) }); }      // the driver's constructor starts clip 0x43 after the NPC's own start clip
      else if (vehicles && (n instanceof SpeederNode || n instanceof TrainNode)) { const s = seqOfNode(n); if (s !== undefined) all.push({ seq: s, run: () => n.init(w, rec, c) }); }
    }
  }
  startBrickBots(w, all);   // WP11: the bots' constructors
}

export { LaunchNode } from './launch.ts';
export { SgmfigNode, Human1Node, Turn2PepANode, Turn2PepBNode, Turn2PepCNode, MeetPeppNode };
import { islandProbePass, clearNear, stampSeq, seqOfNode } from './globals.ts';
export { npcGlobals, npcGroup } from './globals.ts';
export * from './brickbot.ts';
export * from './interact.ts';
