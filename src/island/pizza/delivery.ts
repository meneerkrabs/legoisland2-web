// The delivery rules of chapter 1 (docs/re/m4/wp5-pizza.md "Deliveries"): the bookkeeping the original does when a customer gets a pizza. In the
// executable it is not in Pizza.c: a delivery is a conversation with a talking NPC (generic NPC node FUN_00426151, update FUN_00425c13, WP3) whose
// cutscene ends, or an action of Turn2Pep / MeetPepp / BrickBot (FUN_0051dc50 op 0x40). These functions are the ports of exactly those lines, for the
// NPC nodes to call:
//   FUN_00425c13 (after the customer's cutscene, node +0x52 == -20): `customerReward(type)` with the type = word 0 of the NPC's argument block (node +0x50):
//       0 none, 1 pizza customer: SCORE_LGI += 1000, HISCORE_LGI += 1000; 2 house-building customer: the same, then cutscene slot 0x1a + HOUSECONTRUCTIONPHASE
//       (LGIPH01.. the next build stage of Pepper's house), HOUSECONTRUCTIONPHASE += 1, NUM_BRICKS -= 1.
//     and `customerVarOp(op, var)` with the op / var of the block (+0x2c / +0x2a): 1 var = 1, 2 var += 1, 3 var -= 1 (NUM_PIZZAS: then the NPC's
//       MOVE var gets 0x8000 = "take the pizza box": Turn2Pep / MeetPepp release PIZ3 with releaseCarry).
//   FUN_0051dc50(rec, op, var, value): the action table of Turn2Pep / MeetPepp / BrickBot / Spin: `npcAction`.
import type { World } from '../../game/world.ts';
import { tryCtx } from '../ctx.ts';

export const LGI_VAR = {
  NUM_BRICKS: 0x4f, SCORE_LGI: 0xa6, HISCORE_LGI: 0x12, HOUSECONTRUCTIONPHASE: 0xad, NUM_PIZZAS: 0xb0, MOVE_PIZ3: 0xb4, MOVE_CNST: 0xb5,
} as const;
/** points per delivery (FUN_004175ca(0xa6, 1000)) */
export const DELIVERY_SCORE = 1000;
/** cutscene slot of the first house build stage (LGIPH01): slot = 0x1a + HOUSECONTRUCTIONPHASE */
export const HOUSE_SLOT_BASE = 0x1a;
/** the MOVE bit that hands the pizza box over (Turn2Pep / MeetPepp test `param_4 & 0x8000`) */
export const MOVE_TAKE_PIZZA = 0x8000;

export const CUSTOMER = { NONE: 0, PIZZA: 1, HOUSE: 2 } as const;

/** FUN_00425c13 0x425ca1..: the reward of a customer of `type` (returns the house cutscene slot started, -1 = none) */
export function customerReward(w: World, type: number): number {
  if (type === CUSTOMER.NONE) return -1;
  w.vars.add(LGI_VAR.SCORE_LGI, DELIVERY_SCORE);
  w.vars.add(LGI_VAR.HISCORE_LGI, DELIVERY_SCORE);
  if (type !== CUSTOMER.HOUSE) return -1;
  const slot = w.vars.get(LGI_VAR.HOUSECONTRUCTIONPHASE) + HOUSE_SLOT_BASE;
  tryCtx(w)?.startCutscene(slot);
  w.vars.add(LGI_VAR.HOUSECONTRUCTIONPHASE, 1);
  w.vars.add(LGI_VAR.NUM_BRICKS, -1);
  return slot;
}

/** FUN_00425c13 0x425d0c..: the var op of the NPC's block (+0x2c op, +0x2a var); `moveVar` = the NPC's own (MOVE_*) var */
export function customerVarOp(w: World, moveVar: number, op: number, v: number) {
  if (op === 1) w.vars.set(v, 1);
  else if (op === 2) w.vars.add(v, 1);
  else if (op === 3) {
    w.vars.add(v, -1);
    if (v === LGI_VAR.NUM_PIZZAS) w.vars.or(moveVar, MOVE_TAKE_PIZZA);
  }
}

/**
 * FUN_0051dc50(rec, op, var, value) (the switch falls through like the original): 0x10 setState(value, 0) then 2; 2 var |= value; 0x20 setState(value, 2)
 * then 4; 4 var &= ~value; 0x40 the pizza delivery (SCORE_LGI += 1000, HISCORE_LGI += 1000, NUM_PIZZAS -= 1) then 1; 1 var = value.
 * `setState` = FUN_004240d1(rec, state, mode) of the generic NPC (WP3).
 */
export function npcAction(w: World, op: number, v: number, value: number, setState?: (state: number, mode: number) => void) {
  switch (op) {
    case 0x10: setState?.(value, 0); w.vars.or(v, value); break;
    case 2: w.vars.or(v, value); break;
    case 0x20: setState?.(value, 2); w.vars.andNot(v, value); break;
    case 4: w.vars.andNot(v, value); break;
    case 0x40:
      w.vars.add(LGI_VAR.SCORE_LGI, DELIVERY_SCORE);
      w.vars.add(LGI_VAR.HISCORE_LGI, DELIVERY_SCORE);
      w.vars.add(LGI_VAR.NUM_PIZZAS, -1);
      w.vars.set(v, value);
      break;
    case 1: w.vars.set(v, value); break;
  }
}

/**
 * The HUD counters of era 0 (FUN_004b908d with the totals of FUN_004b9008): "(11 - NUM_PIZZAS)/11" (".../12" in story node 6, the pizza to the jail) and
 * "(11 - NUM_BRICKS)/11", shown before story node 7.
 */
export function chapterOneCounters(w: World): { pizzas: number; pizzasOf: number; bricks: number; bricksOf: number } {
  const node = w.vars.get(0x58);
  return { pizzas: 11 - w.vars.get(LGI_VAR.NUM_PIZZAS), pizzasOf: node === 6 ? 12 : 11, bricks: 11 - w.vars.get(LGI_VAR.NUM_BRICKS), bricksOf: 11 };
}
