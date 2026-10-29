// The interaction core of the island, as the decompile has it (docs/re/m4/wp3-npc.md 1):
//   * Space in Pepper's walk update (FUN_0042d514 0x42da7d) asks FUN_00427c15: 0 nothing, 1 throw a pizza (state 0x0b / 0x42, FUN_004277d0), 2 hand a
//     pizza to the targetable record right in front of Pepper (state 0x0c, FUN_00428a0a; the record goes to DAT_009da870 = `shared.pizzaTarget`).
//     FUN_00427c15 picks the target with FUN_0042796e (records with controller flags 0x40 targetable | 2 enabled within 200 units and 45 degrees).
//     WP5 ported both with the throw (src/island/pizza/pizza.ts `pizzaPrelude`, `findPizzaTarget`; the walk hook `walkHooks.space`): re-exported here
//     under the names of the M4 plan.
//   * Shift is NOT routed through the walk node: every talking NPC (SGMFIG, FUN_00425c13) reads the Shift press itself, the nearest one (squared XZ
//     distance < 256 after the first frame, the one already talking wins) becomes DAT_009da6d0 (`npcGlobals(w).target`), and its pre-render hook
//     (FUN_00425902) starts the conversation when Pepper is within its talk radius and in front of it (src/island/npc/sgmfig.ts).
//   * INTERACT_ICONS (var 0xc) bit 1 (the talk icon of the HUD) is set by FUN_00425902 while Pepper is within an NPC's talk radius (controller flag 0x10);
//     the other bits come from the boat (8, 0x80: FUN_0042f9a2), the helicopter (4, 0x40: FUN_00431425), StartCSM (cleared, FUN_0051dd7e) ...
export { pizzaPrelude as interact, findPizzaTarget as nearestTarget, incomingPizza, PRELUDE } from '../pizza/pizza.ts';
export type { PizzaTarget } from '../pizza/pizza.ts';
