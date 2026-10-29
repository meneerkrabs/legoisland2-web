import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { ST } from '../../src/game/walk.ts';
import { CF_TARGETABLE, Controller } from '../../src/game/controller.ts';
import {
  pizzaSystem, incomingPizza, pizzaHitOn, attachCarry, releaseCarry, carriedPizza, carryNodeOf, customerReward, customerVarOp, npcAction,
  chapterOneCounters, LGI_VAR, MOVE_TAKE_PIZZA, SND_PIZZA,
} from '../../src/island/pizza/index.ts';

// WP5: the carried prop (Pizza.c FUN_00429d1b: PIZ3 = the pizza box of era 0, attached by the cutscenes, taken by the customers), the delivery
// bookkeeping (FUN_00425c13 / FUN_0051dc50 lines: 11 pizzas, the house stages), and the era 1 hand-over (FUN_0042900b / FUN_00428a5f / FUN_00429183).
export default {
  name: 'm4-wp5-carry',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const hex = (n) => '0x' + (n >>> 0).toString(16);
    const onHill = (I) => {
      const p = I.pepper, g = I.world.col.terrainHeight(-475, 300, 275, 0);
      p.x = -475; p.z = 275; p.y = g; p.ry = 0; p.rebuildYaw();
      tick(I, 5);
    };

    // ============================================================ 1. the pizza box (era 0)
    {
      const I = loadIsland(ctx, { node: 2 });
      onHill(I);
      const w = I.world, p = I.pepper;
      const box = carriedPizza(w);
      ok(box && box.name === 'PIZ3', `the carried pizza (DAT_009da7d4) is PIZ3 (${box?.name})`);
      const n = carryNodeOf(box);
      ok(n && n.bone === 16 && Math.abs(n.off[1] + 1) < 1e-6 && n.carrier === null, `PIZ3 carry args: bone ${n?.bone}, offset (${n?.off.join(', ')}), no carrier`);
      ok(!box.enabled, 'PIZ3 hidden before the pick-up');
      ok(carryNodeOf(I.rec('CNST'))?.bone === 14 && carryNodeOf(I.rec('BRIK')) !== null, 'CNST (bone 14) and BRIK have carry nodes');
      // the pick-up cutscene: ATTACH PIZ3 PEPP 16
      ok(attachCarry(box, p, 16), 'attach PIZ3 to Pepper');
      tick(I, 1);
      ok(box.enabled, 'shown while carried');
      const d = Math.hypot(box.x - p.x, box.z - p.z);
      ok(d < 3 && box.y > p.y && box.y < p.y + 6, `at Pepper's hand (${d.toFixed(2)} away, y +${(box.y - p.y).toFixed(2)})`);
      // follows Pepper
      p.x += 10; p.rebuildYaw(); tick(I, 1);
      ok(Math.abs(box.x - p.x) < 3, `follows the carrier (${(box.x - p.x).toFixed(2)})`);
      // a release by another record is ignored
      ok(!releaseCarry(box, I.rec('LICK'), 480), 'release by a non-carrier is ignored');
      // the customer takes it: Turn2Pep releases with 480 ticks
      const fx = p.m[8], fz = p.m[10];
      const before = [box.x, box.z];
      ok(releaseCarry(box, p, 480), 'released by the carrier');
      tick(I, 1);
      const moved = ((box.x - before[0]) * fx + (box.z - before[1]) * fz);
      const ground = w.col.terrainHeight(box.x, box.y + 20, box.z, 0);
      ok(Math.abs(moved - 1.4) < 0.3, `pushed 1.4 along the carrier's facing (${moved.toFixed(2)})`);
      ok(Math.abs(box.y - ground) < 1.5, `put on the ground (y ${box.y.toFixed(2)}, ground ${ground.toFixed(2)})`);
      ok(Math.abs(box.m[5]) < 1e-3, `lying flat (up.y ${box.m[5].toFixed(3)})`);
      ok(box.enabled, 'visible while lying');
      tick(I, 478);
      ok(box.enabled, 'still there after 479 ticks');
      tick(I, 2);
      ok(!box.enabled, 'gone after 480 ticks');
    }

    // ============================================================ 2. the delivery bookkeeping: 11 pizzas, the house
    {
      const I = loadIsland(ctx, { node: 2 });
      const w = I.world;
      ok(w.vars.get(LGI_VAR.NUM_PIZZAS) === 11 && w.vars.get(LGI_VAR.NUM_BRICKS) === 11, `new game: 11 pizzas, 11 bricks (${w.vars.get(LGI_VAR.NUM_PIZZAS)}, ${w.vars.get(LGI_VAR.NUM_BRICKS)})`);
      const c0 = chapterOneCounters(w);
      ok(c0.pizzas === 0 && c0.pizzasOf === 11 && c0.bricks === 0, `HUD 0/11 0/11 (${JSON.stringify(c0)})`);
      const score0 = w.vars.get(LGI_VAR.SCORE_LGI);
      const MOVE = 0x69;   // LICK's MOVE var
      for (let i = 0; i < 11; i++) { customerVarOp(w, MOVE, 3, LGI_VAR.NUM_PIZZAS); customerReward(w, i % 2 ? 2 : 1); }
      ok(w.vars.get(LGI_VAR.NUM_PIZZAS) === 0, `11 deliveries: NUM_PIZZAS 0 (${w.vars.get(LGI_VAR.NUM_PIZZAS)})`);
      ok((w.vars.get(MOVE) & MOVE_TAKE_PIZZA) !== 0, `the customer's MOVE var gets 0x8000 (take the box) (${hex(w.vars.get(MOVE))})`);
      ok(w.vars.get(LGI_VAR.SCORE_LGI) - score0 === 11000, `SCORE_LGI +11000 (${w.vars.get(LGI_VAR.SCORE_LGI) - score0})`);
      ok(w.vars.get(LGI_VAR.HOUSECONTRUCTIONPHASE) === 5 && w.vars.get(LGI_VAR.NUM_BRICKS) === 6, `5 house customers: phase 5, bricks 6 (${w.vars.get(LGI_VAR.HOUSECONTRUCTIONPHASE)}, ${w.vars.get(LGI_VAR.NUM_BRICKS)})`);
      ok(I.ictx.cutscenes.map((c) => c.slot).join(',') === '26,27,28,29,30', `house stage cutscenes 0x1a + phase (${I.ictx.cutscenes.map((c) => c.slot).join(',')})`);
      const c1 = chapterOneCounters(w);
      ok(c1.pizzas === 11 && c1.bricks === 5, `HUD 11/11 5/11 (${JSON.stringify(c1)})`);
      ok(customerReward(w, 0) === -1 && w.vars.get(LGI_VAR.SCORE_LGI) - score0 === 11000, 'type 0: no reward');
      w.vars.set(LGI_VAR.NUM_PIZZAS, 3);
      npcAction(w, 0x40, 0x7a, 5);
      ok(w.vars.get(LGI_VAR.NUM_PIZZAS) === 2 && w.vars.get(0x7a) === 5, `action 0x40: NUM_PIZZAS -1 and var = value (${w.vars.get(LGI_VAR.NUM_PIZZAS)}, ${w.vars.get(0x7a)})`);
      const st = [];
      npcAction(w, 0x10, 0x7a, 0x40, (s, m) => st.push([s, m]));
      ok(st.length === 1 && st[0][0] === 0x40 && (w.vars.get(0x7a) & 0x40) !== 0, 'action 0x10: set state then OR the bits');
      npcAction(w, 4, 0x7a, 0x40);
      ok((w.vars.get(0x7a) & 0x40) === 0, 'action 4: clear the bits');
      w.vars.set(0x58, 6);
      ok(chapterOneCounters(w).pizzasOf === 12, 'node 6: pizzas of 12 (the one for the jail)');
    }

    // ============================================================ 3. era 1: the hand-over (PIZ3 / PIZ4)
    {
      const I = loadIsland(ctx, { node: 7 });
      onHill(I);
      const w = I.world, p = I.pepper;
      const walk = p.ctrl.find('SGwalk');
      const s = pizzaSystem(w);
      ok(s.hand[0]?.rec?.name === 'PIZ3' && s.hand[1]?.rec?.name === 'PIZ4', `hand pizzas PIZ3 / PIZ4 (${s.hand.map((h) => h?.rec?.name).join(',')})`);
      ok(s.hand[0].mask === 8 && s.hand[1].mask === 0x10, `their gates PIZZAS_THROWN & 8 / 0x10 (${s.hand.map((h) => hex(h.mask)).join(',')})`);
      const npc = I.rec('BBT0') ?? I.rec('LICK');
      if (!npc.ctrl) npc.ctrl = new Controller();
      npc.ctrl.nodes = [];   // a plain target (no NPC behaviour moving it)
      npc.ctrl.flags |= CF_TARGETABLE | 2; npc.flags |= 0x40; npc.show();
      npc.x = p.x + Math.sin(p.ry) * 3; npc.z = p.z + Math.cos(p.ry) * 3; npc.y = p.y;
      npc.ry = p.ry + Math.PI;   // facing Pepper
      tick(I, 1);
      ok(walk.state === ST.IDLE, `idle (${hex(walk.state)})`);
      I.ictx.sounds.length = 0;
      press(I, 'Space');
      ok(walk.state === ST.THROW2, `a target within 4.8: the hand-over, state 0x0c (${hex(walk.state)})`);
      ok(s.target === npc && I.ictx.shared.pizzaTarget === npc, 'DAT_009da870 = the target (ctx.shared.pizzaTarget)');
      ok((w.vars.get(0x63) & 0x18) === 0x18, `PIZZAS_THROWN | 8 | 0x10 (${hex(w.vars.get(0x63))})`);
      const h0 = s.hand[0].rec, h1 = s.hand[1].rec;
      let n = 0, shown = -1, gone = -1, reach = 0, hit = 0;
      const npcSide = () => { npc.ctrl.distSq = (npc.x - p.x) ** 2 + (npc.z - p.z) ** 2; const r = incomingPizza(w, npc); if (r.kind === 2) reach++; if (pizzaHitOn(w, npc) === 2) hit++; };
      while (n++ < 90) {
        tick(I, 1); npcSide();
        if (shown < 0 && h0.enabled) shown = p.anim.frame;
        if (shown >= 0 && gone < 0 && !h0.enabled) gone = p.anim.frame;
      }
      ok(shown >= 10 && shown < 12, `the hand pizzas appear at frame ${shown.toFixed(1)} (10)`);
      ok(gone > 40 && gone < 43, `and go at frame ${gone.toFixed(1)} (> 40)`);
      ok(reach > 0 && hit > 0, `the NPC in reach during the last 5 frames (incomingPizza 2 x${reach}, pizzaHitOn 2 x${hit})`);
      ok(I.ictx.sounds.some((x) => x.id === SND_PIZZA.HIT), 'Piza_Hit at the end of the hand-over');
      ok((w.vars.get(0x63) & 0x18) === 0 && !h0.enabled && !h1.enabled, `bits cleared, both hidden (${hex(w.vars.get(0x63))})`);
      ok(walk.state === ST.IDLE, `back to idle (${hex(walk.state)})`);
      notes.push(`hand-over: shown f${shown.toFixed(1)}, gone f${gone.toFixed(1)}, reach ${reach}, hit ${hit}`);
    }
    return { checked, failures, notes };
  },
};
