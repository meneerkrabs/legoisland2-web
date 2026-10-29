import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { ST } from '../../src/game/walk.ts';
import { CF_TARGETABLE, Controller } from '../../src/game/controller.ts';
import {
  pizzaSystem, launchPizza, pizzaPrelude, incomingPizza, pizzaHitOn, segCylinder, PIZZA, SND_PIZZA, PRELUDE,
} from '../../src/island/pizza/index.ts';

// WP5: Pepper's pizza throw (Pizza.c FUN_0042887c / FUN_00427e02 / FUN_00427c15 / FUN_004277d0) on the real island world of story node 2 (era 0):
// Space from idle -> throw clip 0x0b, the pizza appears in the hand at frame 14 and leaves it at frame 42, flies 4 units per tick straight ahead for
// at most 144 units (36 ticks) and vanishes, or splats on the first record it hits (here: a targetable NPC put in its way); the vars (PIZZAS_THROWN bits
// 1/2/4 and the in-flight bits 0x100..), the sounds; three pizzas in flight and the recycle; an interrupted throw; the story nodes without throws.
export default {
  name: 'm4-wp5-pizza',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const hex = (n) => '0x' + (n >>> 0).toString(16);
    const T = 0x63;   // PIZZAS_THROWN

    const fresh = (node = 2) => {
      const I = loadIsland(ctx, { node });
      // the start point lies in a hollow (every heading hits a wall or the hill within 50 units): stand on the western hill (-475, 275) by the sea
      const p0 = I.pepper, g = I.world.col.terrainHeight(-475, 300, 275, 0);
      p0.x = -475; p0.z = 275; p0.y = g; p0.rebuildYaw();
      tick(I, 5);
      const walk = I.pepper.ctrl.find('SGwalk');
      return { I, w: I.world, p: I.pepper, walk };
    };
    /** turn Pepper to a heading in which the first 160 units of the flight line (at hand height) are free, return the yaw (null = none) */
    const freeHeading = (w, p) => {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const dx = Math.sin(a), dz = Math.cos(a);
        const from = [p.x, p.y + 3, p.z];
        const h = w.col.sweep(p, from, [dx * 165, 0, dz * 165], 3, 1.0, 0.1);
        if (!h) return a;
      }
      return null;
    };

    // ============================================================ 1. the throw straight ahead, no target: 144 units, then gone
    {
      const { I, w, p, walk } = fresh();
      const s = pizzaSystem(w);
      ok(s.slots.every((n) => n && n.rec), `three projectile slots bound (${s.slots.map((n) => n?.rec?.name).join(',')})`);
      ok(s.hand.every((n) => !n), 'era 0: no hand pizzas (FUN_0042900b is an era 1-3 constructor)');
      const piz = s.slots[0].rec;
      ok(!piz.enabled, 'PIZ0 hidden at the start');
      const yaw = freeHeading(w, p);
      ok(yaw !== null, 'found a free heading for the throw');
      p.ry = yaw ?? 0; p.rebuildYaw();
      tick(I, 2);
      ok(walk.state === ST.IDLE, `idle before the throw (${hex(walk.state)})`);
      I.ictx.sounds.length = 0;
      press(I, 'Space');
      ok(walk.state === ST.THROW, `Space from idle: throw state 0x0b (${hex(walk.state)})`);
      ok(I.ictx.sounds.some((s) => s.id === SND_PIZZA.THROW_WALK), `Throw_1 played (${I.ictx.sounds.map((s) => s.id).join(',')})`);
      ok((w.vars.get(T) & 0xff) === 1, `PIZZAS_THROWN bit 1 set (${hex(w.vars.get(T))})`);
      // appears at frame 14 of the clip
      let n = 0;
      while (!piz.enabled && n++ < 60) tick(I, 1);
      const fAppear = p.anim.frame;
      ok(piz.enabled && fAppear >= 14 && fAppear < 16, `pizza appears in the hand at frame ${fAppear.toFixed(1)} (14)`);
      const node = s.slots[0];
      ok(node.held, 'held in the hand');
      const dHand = Math.hypot(piz.x - p.x, piz.z - p.z);
      ok(dHand < 4 && piz.y > p.y, `at Pepper's hand (${dHand.toFixed(2)} from Pepper, y +${(piz.y - p.y).toFixed(2)})`);
      // release at frame 42
      n = 0;
      while (node.held && n++ < 60) tick(I, 1);
      ok(!node.held && Math.abs(p.anim.frame - 42) < 1.5, `released at frame ${p.anim.frame.toFixed(1)} (42)`);
      ok((w.vars.get(T) & 0x100) !== 0, `in-flight bit 0x100 set (${hex(w.vars.get(T))})`);
      ok(I.ictx.fx.log.some((f) => f.op === 'gate' && f.name === 'throwpizza.par' && f.gate.join() === '2,1,1'), 'throwpizza.par emits on release (gate 2 / 1 / 1)');
      const fwd = [p.m[8], p.m[10]];
      const start = [piz.x, piz.y, piz.z];
      const spin0 = piz.rx;
      tick(I, 5);
      const step = Math.hypot(piz.x - start[0], piz.z - start[2]) / 5;
      const along = ((piz.x - start[0]) * fwd[0] + (piz.z - start[2]) * fwd[1]) / 5;
      ok(Math.abs(step - 4) < 0.05 && Math.abs(along - 4) < 0.1, `flies 4 per tick along Pepper's facing (${step.toFixed(3)}, along ${along.toFixed(3)})`);
      ok(Math.abs(piz.y - start[1]) < 0.01, `straight line, no gravity (dy ${(piz.y - start[1]).toFixed(3)})`);
      ok(Math.abs((piz.rx - spin0) + 1.0) < 0.01, `spins -0.2 rad per tick about x (${(piz.rx - spin0).toFixed(3)} in 5)`);
      // flies until travelled > 144 (36 steps incl. the release step), then 4 ticks hidden, then the slot is free
      let flown = 6; n = 0;
      while (piz.enabled && n++ < 60) { tick(I, 1); if (piz.enabled) flown++; }
      ok(flown === 36 && node.count === 4, `vanishes after ${flown} flight ticks (36 = 144 / 4), count ${node.count}`);
      ok(!I.ictx.sounds.some((s) => s.id === SND_PIZZA.HIT), 'no splat sound without a hit');
      ok((w.vars.get(T) & 0x100) === 0 && (w.vars.get(T) & 1) === 1, `in-flight bit cleared, slot bit still set while counting down (${hex(w.vars.get(T))})`);
      tick(I, 3);
      ok(w.vars.get(T) === 0, `slot bit cleared after the count-down (${hex(w.vars.get(T))})`);
      notes.push(`throw 1: appear f${fAppear.toFixed(1)}, ${flown} flight ticks, heading ${(yaw ?? 0).toFixed(2)}`);
      // Pepper is back to idle after the clip
      tick(I, 20);
      ok(walk.state === ST.IDLE, `back to idle after the throw clip (${hex(walk.state)})`);
    }

    // ============================================================ 1b. the running throw: state 0x42, Throw_2, in the hand at frame 4, out at 10
    {
      const { I, w, p, walk } = fresh();
      p.ry = freeHeading(w, p) ?? 0; p.rebuildYaw(); tick(I, 2);
      const s = pizzaSystem(w), node = s.slots[0], piz = node.rec;
      w.input.setKey('ArrowUp', true);
      let n = 0;
      while (walk.state !== ST.RUN && n++ < 120) tick(I, 1);
      ok(walk.state === ST.RUN, `running before the throw (${hex(walk.state)})`);
      I.ictx.sounds.length = 0;
      w.input.setKey('Space', true); tick(I, 1); w.input.setKey('Space', false);
      ok(walk.state === ST.THROWRUN && I.ictx.sounds.some((x) => x.id === SND_PIZZA.THROW_RUN), `Space while running: state 0x42 and Throw_2 (${hex(walk.state)})`);
      let fa = -1, fr = -1; n = 0;
      while (fr < 0 && n++ < 40) { tick(I, 1); if (fa < 0 && piz.enabled) fa = p.anim.frame; if (fa >= 0 && !node.held) fr = p.anim.frame; }
      w.input.setKey('ArrowUp', false);
      ok(fa >= 4 && fa < 6 && fr >= 10 && fr < 12, `in the hand at frame ${fa.toFixed(1)} (4), released at ${fr.toFixed(1)} (10)`);
      tick(I, 60);
      ok(w.vars.get(T) === 0, `done (${hex(w.vars.get(T))})`);
    }

    // ============================================================ 2. a targetable NPC in front: aim, hit, splat
    {
      const { I, w, p, walk } = fresh();
      const yaw = freeHeading(w, p) ?? 0;
      p.ry = yaw; p.rebuildYaw(); tick(I, 2);
      const npc = I.rec('LICK');
      const D = 40;
      // a bot-like target (controller flag 0x40: the island gives it to the BrickBots of eras 1-3), 40 units ahead, 6 degrees off the line
      const a2 = yaw + 0.1;
      npc.x = p.x + Math.sin(a2) * D; npc.z = p.z + Math.cos(a2) * D; npc.y = p.y; npc.show();
      if (!npc.ctrl) npc.ctrl = new Controller();
      npc.ctrl.nodes = [];   // a plain target: WP3's talking-NPC node would walk LICK back to its waypoint
      npc.ctrl.flags |= CF_TARGETABLE | 2;
      npc.flags |= 0x40;   // RF_NPC: the generic NPC constructor FUN_00426151 sets it (box collision)
      const s = pizzaSystem(w);
      const piz = s.slots[0].rec, node = s.slots[0];
      I.ictx.sounds.length = 0; I.ictx.fx.clear();
      press(I, 'Space');
      ok(walk.state === ST.THROW, `throw at a target 40 away: state 0x0b (no hand-over beyond 4.8) (${hex(walk.state)})`);
      let n = 0;
      while (!(piz.enabled && !node.held) && n++ < 80) tick(I, 1);
      ok(node.target === npc, `aimed at the NPC in the 10 degree cone (${node.target?.name})`);
      const dirToNpc = [npc.x - piz.x, npc.z - piz.z]; const l = Math.hypot(...dirToNpc);
      const cos = (node.dir[0] * dirToNpc[0] + node.dir[2] * dirToNpc[1]) / (l * Math.hypot(node.dir[0], node.dir[2]));
      ok(cos > 0.995, `flight direction towards the NPC (cos ${cos.toFixed(4)})`);
      const incoming = [];
      n = 0;
      while (node.hit !== npc && n++ < 40) { tick(I, 1); incoming.push(incomingPizza(w, npc).kind); }
      ok(node.hit === npc && node.count === 6, `hit the NPC (${node.hit?.name}, count ${node.count})`);
      ok(incoming.includes(1), `incomingPizza reports the pizza coming at the NPC (${incoming.join('')})`);
      ok(pizzaHitOn(w, npc) === 1, 'pizzaHitOn(npc) = 1 while the hit counts down');
      const dHit = Math.hypot(piz.x - npc.x, piz.z - npc.z);
      ok(dHit < 3, `stopped at the NPC (${dHit.toFixed(2)})`);
      tick(I, 1);
      ok(I.ictx.sounds.some((s) => s.id === SND_PIZZA.HIT && s.pos), 'Piza_Hit at the pizza');
      ok(I.ictx.fx.log.some((f) => f.op === 'gate' && f.name === 'pizzasplat.par' && f.gate.join() === '2,1,1'), 'pizzasplat.par emits (gate 2 / 1 / 1)');
      ok(!piz.enabled, 'pizza hidden after the splat');
      tick(I, 4);
      ok(w.vars.get(T) === 0 && node.hit === null && pizzaHitOn(w, npc) === 0, `slot free after the count-down (${hex(w.vars.get(T))})`);
    }

    // ============================================================ 3. three in flight, the fourth recycles the furthest
    {
      const { I, w, p } = fresh();
      const s = pizzaSystem(w);
      ok(launchPizza(w, 0, 0) === 0 && launchPizza(w, 0, 0) === 1 && launchPizza(w, 0, 0) === 2, 'launch fills slots 0, 1, 2');
      ok((w.vars.get(T) & 7) === 7, `PIZZAS_THROWN = 7 (${hex(w.vars.get(T))})`);
      // with start / release frame 0 they leave the hand at once: give them different distances
      tick(I, 3);
      ok(s.slots.every((n) => !n.held && n.rec.enabled), 'all three in flight');
      s.slots[1].travelled = 100;
      const r = launchPizza(w, 14, 42);
      ok(r === -1, 'a fourth launch launches nothing');
      ok((w.vars.get(T) & 7) === 5 && !s.slots[1].rec.enabled, `the furthest (slot 1) is recycled: hidden, its bit cleared (${hex(w.vars.get(T))})`);
      ok(launchPizza(w, 14, 42) === 1, 'the next launch takes the freed slot 1');
      void p;
    }

    // ============================================================ 4. stale states: interrupted throw, cutscene, story nodes without throws
    {
      const { I, w, p, walk } = fresh();
      const s = pizzaSystem(w);
      const node = s.slots[0], piz = node.rec;
      press(I, 'Space');
      let n = 0;
      while (!piz.enabled && n++ < 60) tick(I, 1);
      ok(node.held, 'held before the interruption');
      // the walk state changes (e.g. a knock-back): another clip -> the pizza is dropped
      w.pep.mailbox = ST.IDLE; walk.state = ST.IDLE; p.anim.start(0x3a, 0);
      tick(I, 1);
      ok(!piz.enabled && (w.vars.get(T) & 1) === 0, `interrupted throw: pizza gone, bit cleared (${hex(w.vars.get(T))}, enabled ${piz.enabled})`);
      // a cutscene during the hold
      tick(I, 5);
      press(I, 'Space');
      n = 0;
      while (!piz.enabled && n++ < 60) tick(I, 1);
      I.ictx.cutsceneTicks = 30; I.ictx.startCutscene(99);
      tick(I, 1);
      ok(!piz.enabled && (w.vars.get(T) & 1) === 0, 'a cutscene during the hold drops the pizza');
      // Space while already throwing: nothing
      I.ictx.cutsceneLeft = 0; tick(I, 30);
      press(I, 'Space');
      const v1 = w.vars.get(T);
      press(I, 'Space');
      ok(w.vars.get(T) === v1, `Space during the throw clip launches nothing more (${hex(v1)} -> ${hex(w.vars.get(T))})`);
      // story nodes 0x38..0x3c: no throw; 0x35..0x37: throw without a target
      w.vars.set(0x58, 0x39); ok(pizzaPrelude(w, p) === PRELUDE.NONE, 'node 0x39: no throw');
      w.vars.set(0x58, 0x36); ok(pizzaPrelude(w, p) === PRELUDE.THROW, 'node 0x36: blind throw');
      w.vars.set(0x58, 2);
    }

    // ============================================================ 5. segCylinder (FUN_0043d2af)
    {
      const t1 = segCylinder([-10, 2, 0], [10, 2, 0], [0, 0, 0], 4, 5.2);
      ok(Math.abs(t1 - 0.3) < 1e-6, `horizontal segment through the cylinder enters at t = 0.3 (${t1})`);
      ok(segCylinder([-10, 8, 0], [10, 8, 0], [0, 0, 0], 4, 5.2) === -1, 'above the cylinder: -1');
      ok(segCylinder([-10, 2, 10], [10, 2, 10], [0, 0, 0], 4, 5.2) === -1, 'beside the cylinder: -1');
    }
    void PIZZA;
    return { checked, failures, notes };
  },
};
