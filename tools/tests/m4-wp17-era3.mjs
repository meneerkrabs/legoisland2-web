// WP17: era 3 / era 4 of the island (story nodes 52..61, zone ids 33 / 2) on the real island world (docs/re/m4/wp17-era3.md); browser bot tools/steps/m4-era3.mjs.
//  * the era-3 StartCSM chain: HSE2 intro (slot 0), PIZB (node 0x35, slot 5, S277 = 4), RADI (node 0x37, slot 6, S277 = 12), POLB (node 0x39, slot 8, S277 = 7),
//    TOWE (node 0x3a, no cutscene, S284 = 1); era 4: TOWE (node 0x3d, slot 0 = LGI13, S284 = 2);
//  * regression of the BOTMUSIC fix (FUN_00536a44 returns 0 unless the bot dances): a bot away from Pepper walks, a bot next to Pepper dances, is danced
//    out after 600 ticks (var |= 0x1000000), falls over and is collected when Pepper walks into it (COLORED_BOTHEADS).
import { loadIsland, tick } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { waypoints as WP } from '../../src/game/walker.ts';
import { arrivalRule } from '../../src/zones/z02LGI/arrival.ts';

const nodesOf = (I, name, kind) => I.rec(name)?.ctrl?.nodes.filter((n) => n.kind === kind) ?? [];
const nodeXYZ = (map, id) => { const p = WP.nodePos(map, id); return p ? [...p] : null; };

export default {
  name: 'm4-wp17-era3',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const stand = (I, at) => { const p = I.pepper; p.x = at[0]; p.y = at[1]; p.z = at[2]; };

    // --- node 52: the era intro (HSE2, no waypoint, gate 0x54 & 4 == 0) fires at once, slot 0 (LGIBR08), then var 0x54 = 4
    {
      const I = loadIsland(ctx, { node: 52 });
      I.ictx.cutsceneTicks = 10;
      tick(I, 1);
      ok(I.ictx.cutscenes.length === 1 && I.ictx.cutscenes[0].slot === 0, `node 52 intro: ${JSON.stringify(I.ictx.cutscenes)}`);
      tick(I, 15);
      ok((I.vars.get(0x54) & 4) === 4, `node 52: var 0x54 = ${I.vars.get(0x54)}`);
      for (const n of ['TOWE', 'CTRL', 'PLAT', 'SHTL']) ok((I.rec(n).flags & 2) === 0, `node 52: ${n} not built yet`);
    }
    // --- node 53: PIZB (gate node 0x35, no waypoint) -> slot 5 (LGI09) -> S277 = 4
    {
      const I = loadIsland(ctx, { node: 53, vars: { 0x54: 4 } });
      I.ictx.cutsceneTicks = 10;
      tick(I, 2);
      ok(I.ictx.cutscenes.some((c) => c.slot === 5), `node 53: PIZB -> slot 5 (${JSON.stringify(I.ictx.cutscenes)})`);
      tick(I, 15);
      ok(I.vars.get(0x115) === 4, `node 53: S277 = ${I.vars.get(0x115)}`);
    }
    // --- nodes 55 / 57 / 58 / 61: the waypoint triggers
    for (const [node, rec, slot, v, val, vars] of [
      [55, 'RADI', 6, 0x115, 0xc, { 0x54: 4, 0x115: 4, 0x26: 15 }],
      [57, 'POLB', 8, 0x115, 7, { 0x54: 4, 0x115: 0xc, 0x26: 15, 0x8e: 15 }],
      [58, 'TOWE', -1, 0x11c, 1, { 0x54: 4, 0x115: 7, 0x26: 15, 0x8e: 15 }],
      [61, 'TOWE', 0, 0x11c, 2, { 0x11c: 1 }],
    ]) {
      const I = loadIsland(ctx, { node, vars });
      I.ictx.cutsceneTicks = 10;
      tick(I, 2);
      const n = nodesOf(I, rec, 'StartCSM').find((x) => x.value === node);
      ok(!!n, `node ${node}: ${rec} has its StartCSM (gate node ${node})`);
      if (!n) continue;
      const before = I.ictx.cutscenes.length;
      tick(I, 5);
      ok(I.vars.get(v) !== val, `node ${node}: nothing before Pepper comes`);
      const at = nodeXYZ(n.a.map, n.a.waypoints[0]);
      if (at) stand(I, at);
      tick(I, 3);
      const started = I.ictx.cutscenes.slice(before);
      ok(slot < 0 ? started.length === 0 : started.some((c) => c.slot === slot), `node ${node}: ${rec} -> slot ${slot} (${JSON.stringify(started)})`);
      tick(I, 15);
      ok(I.vars.get(v) === val, `node ${node}: var ${v.toString(16)} = ${I.vars.get(v)} (want ${val})`);
    }
    // --- node 56: dancing the bots out with the ghetto blaster (BOTMUSIC FUN_00536a44 + BotHit FUN_00531e97 / FUN_00532557)
    {
      const I = loadIsland(ctx, { node: 56, vars: { 0x54: 4, 0x115: 0xc, 0x26: 15 } });
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world);
      startIslandNpcs(I.world);
      const bot = I.rec('BBY0'), music = nodesOf(I, 'BBY0', 'BOTMUSIC')[0], hit = nodesOf(I, 'BBY0', 'BotHit')[0];
      ok(!!music && !!hit, 'node 56: BBY0 has BOTMUSIC and BotHit');
      // Pepper far away: the radio is on but the bot does not dance, BOTMUSIC returns 0 (did not run) and the bot's walker nodes move it
      const p = I.pepper;
      p.x = bot.x + 200; p.z = bot.z;
      tick(I, 3);
      ok(I.vars.get(0x22) === 1, `node 56: the ghetto blaster switches the radio on (var 0x22 = ${I.vars.get(0x22)})`);
      const r0 = music ? music.update(I.world, bot, bot.ctrl) : -1;
      ok(r0 === 0, `node 56: BOTMUSIC returns 0 while the bot does not dance (got ${r0})`);
      const x0 = bot.x, z0 = bot.z;
      tick(I, 150);
      ok(Math.hypot(bot.x - x0, bot.z - z0) > 1, `node 56: the bot walks while Pepper is away (moved ${Math.hypot(bot.x - x0, bot.z - z0).toFixed(2)})`);
      // Pepper next to it: it dances (clip 0xfa, var bits 1 | 0x4000000), the timer starts at 0, and after 600 ticks it is danced out and falls over
      const stay = () => { p.x = bot.x + 5; p.y = bot.y; p.z = bot.z; };
      stay(); tick(I, 2);
      const vb = I.vars.get(music?.var ?? 0);
      ok((vb & 0x4000001) === 0x4000001 && bot.anim?.clip === 0xfa && music?.timer < 5, `node 56: the bot dances (var ${vb.toString(16)}, clip ${bot.anim?.clip}, timer ${music?.timer})`);
      let out = -1;
      for (let t = 0; t < 700 && out < 0; t++) { stay(); tick(I, 1); if (hit && hit.armed === 0) out = t; }
      ok(out > 560 && out < 640, `node 56: danced out and down after ~600 ticks (${out})`);
      // walk into it: collected (COLORED_BOTHEADS |= 1 for the yellow bot)
      const h0 = I.vars.get(0x8e);
      p.x = bot.x + 0.5; p.z = bot.z;
      tick(I, 3);
      ok((I.vars.get(0x8e) & 1) === 1 && (h0 & 1) === 0, `node 56: BBY0's head collected (COLORED_BOTHEADS ${h0} -> ${I.vars.get(0x8e)})`);
    }
    // --- the arrival places of the Space Port mini-games and the end (FUN_004c2d22): PATH 0xff while node < 0x3b (also after an abort to node 58),
    //     0xd7 / 0x18e later; z42BRP (0x29) at node 68 takes the default (skate park, PATH 0xf6)
    for (const [prev, node, want] of [[0x18, 58, 0xff], [0x19, 58, 0xff], [0x18, 61, 0xd7], [0x19, 61, 0x18e], [0x29, 68, 0xf6]]) {
      const r = arrivalRule(prev, node);
      ok(r.node === want, `arrival from ${prev.toString(16)} at node ${node}: PATH ${r.node.toString(16)} (want ${want.toString(16)})`);
    }
    return { checked, failures, notes };
  },
};
