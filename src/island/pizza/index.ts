// WP5 (docs/re/m4/wp5-pizza.md): importing this registers the constructors of
//   Pizza.c     0x42887c projectile PIZ0-2, 0x42900b hand pizza PIZ3 / PIZ4 (eras 1-3), 0x429d1b carried prop (PIZ3 / CNST / RHCP / BRIK / PAPA / MAMA)
//   speeder.c   0x538126 the cars (AMBU, SPD0-2, PCAR), 0x5385d3 their drivers (PETE, RICH, NUBB)
//   Footy.c     0x53955e the football (BALL), 0x5399d8 the flowers (FLR1 / FLR2), 0x539d44 the bobbing LOON
//   SupaStat.c  0x53d66c the train (TRNL / TRNT / TRNC), 0x53c337 SUPE the flying rail rescuer (WP14, supe.ts)
// and installs the pizza throw into the walk node's Space branch (walkHooks.space). The zone game calls `startPizzaNodes(world)` after setupZone and
// WP3's loadIslandWalkMaps (the cars and the train create their walkers there; every node also does its set-up lazily on its first update).
import type { World } from '../../game/world.ts';
import { SpeederNode } from './speeder.ts';
import { TrainNode } from './train.ts';
import { FootballNode, FlowerNode } from './footy.ts';
import { pizzaSystem } from './pizza.ts';
import { tryCtx } from '../ctx.ts';
import { recIndexOfPtr } from '../args.ts';
import { npcGlobals, npcGroup } from '../npc/globals.ts';

export * from './pizza.ts';
export * from './carry.ts';
export * from './delivery.ts';
export * from './speeder.ts';
export * from './train.ts';
export * from './supe.ts';
export * from './footy.ts';

/** the constructors' work that needs the world (record order = the set-up's order): walkers of the cars / train, the ball on kid 0, the flowers at 0.5 */
export function startPizzaNodes(w: World) {
  pizzaSystem(w);
  registerNpcGroups(w);
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c) continue;
    for (const n of c.nodes) {
      if (n instanceof SpeederNode || n instanceof TrainNode) n.init(w, rec, c);
      else if (n instanceof FootballNode) n.init(w, rec);
      else if (n instanceof FlowerNode) n.start(rec);
    }
  }
}

/**
 * FUN_0042407f(a, b, c) of the era set-up (FUN_0052cba0 in era 0: REDG + HOGG + SNAP, CLIK + PETE, ROBB + STEV, DARR + RICH, NANC + NUBB): the NPC groups
 * whose conversation end ORs 1 (3 for a pizza customer) into the head-node vars of the other members (WP3's groupVarOp). The emulated set-up logs the calls
 * (`setup.calls`, fn 0x42407f, mislabelled 'hudItem'); nothing else registered them. This is how a driver gets out of his car: delivering to NANC sets
 * MOVE_NUBB | 3, SPD0's second Human1 route (gate 0x80 & 0xa == 2) drives to ROAD node 94 and its action ORs 8 there, the driver node lets NUBB out.
 * Runs once per world (skipped when groups exist already).
 */
export function registerNpcGroups(w: World) {
  const g = npcGlobals(w);
  if (g.groups.length) return;
  const calls = (tryCtx(w)?.setup as { calls?: { fn: number; args: number[] }[] } | undefined)?.calls ?? [];
  for (const c of calls) {
    if (c.fn !== 0x42407f) continue;
    const r = (p: number) => { const i = recIndexOfPtr(p >>> 0, w.records.length); return i >= 0 ? w.records[i] ?? null : null; };
    npcGroup(w, r(c.args[0]), r(c.args[1]), r(c.args[2]));
  }
}
