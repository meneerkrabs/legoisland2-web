// WP11 (docs/re/m4/wp11-brickbot.md): the Brickster's bots (BrickBot.c FUN_00531d45 / 005327b1 / 00532acc / 00533ba8, botPConly.c FUN_0053de63) on the
// real island world of story nodes 7 / 8 (era 1), 30 (era 2) and 52 (era 3): the attaches, the constructors' var writes, the bots wandering / following /
// hiding without leaving the world, a thrown pizza (WP5) hitting and dazing a bot, the hand-over pizza, the recovery, the collect (NUM_BOT_HEADS,
// COLORED_BOTHEADS, score, sounds, emitters, shrink, hidden), and the story: node 8 completes with the four coloured heads, the handler on 8 -> 9.
import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs, BotFollowNode, BotHitNode, BotHarassNode, BotHideNode, BotPcOnlyNode, mapClip, readRing, BOT_SND, BOT_CLIP } from '../../src/island/npc/index.ts';
import { pizzaSystem } from '../../src/island/pizza/index.ts';
import { waypoints, MAP_PATH } from '../../src/game/walker.ts';
import { storyHandler } from '../../src/zones/z02LGI/story.ts';
import { IslandContext } from '../../src/zones/z02LGI/ctx.ts';
import { liveStoryEnv, pathPositions } from '../../src/zones/z02LGI/index.ts';

const NUM_BOT_HEADS = 0x52, COLORED = 0x8e, SCORE = 0xa6;

function island(ctx, node) {
  const I = loadIsland(ctx, { node });
  loadIslandWalkMaps(I.archive, I.profile.island);
  startIslandNpcs(I.world);
  return I;
}
const nodesOf = (w, cls) => w.records.flatMap((r) => (r.ctrl?.nodes ?? []).filter((n) => n instanceof cls).map((n) => ({ r, n })));
const moveVar = (r) => r.ctrl.nodes[0].var;
const hitNode = (r) => r.ctrl.nodes.find((n) => n instanceof BotHitNode);

/** Pepper `d` units from the bot at `off` radians from its heading, facing it, on the ground */
function facePepper(I, bot, d = 14, off = 0) {
  const p = I.pepper, w = I.world, a = bot.ry + off;
  p.x = bot.x + Math.sin(a) * d; p.z = bot.z + Math.cos(a) * d;
  const g = w.col.terrainHeight(p.x, bot.y + 10, p.z, 0);
  p.y = g > -1e30 ? g : bot.y;
  p.ry = Math.atan2(bot.x - p.x, bot.z - p.z); p.rebuildYaw();
}
/** throw at the bot (Space) until the hit node registers a hit (armed 0); tries from the front, behind and the sides (the pizza can hit a tree or
 *  an umbrella the bot walks past). Returns the tick of the hit, -1 when none of the tries hit. */
function throwAt(I, bot, tries = 12) {
  const hn = hitNode(bot);
  for (let k = 0; k < tries; k++) {
    const off = [0, Math.PI, Math.PI / 2, -Math.PI / 2][k % 4];
    const d = [12, 16, 20][Math.floor(k / 4) % 3];
    facePepper(I, bot, d, off); tick(I, 1); facePepper(I, bot, d, off);
    press(I, 'Space');
    for (let t = 0; t < 100; t++) { if (hn.armed === 0) return k * 100 + t; tick(I, 1); }
    tick(I, 45);
  }
  return -1;
}

export default {
  name: 'm4-wp11-brickbot',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const hex = (v) => '0x' + (v >>> 0).toString(16);

    // ======================================================================== 1. node 7: attaches, constructors
    {
      const I = island(ctx, 7);
      const w = I.world;
      const f = nodesOf(w, BotFollowNode), h = nodesOf(w, BotHitNode), x = nodesOf(w, BotHarassNode), d = nodesOf(w, BotHideNode), pc = nodesOf(w, BotPcOnlyNode);
      ok(f.length + h.length + x.length + d.length === 35 && f.length === 13 && h.length === 10 && x.length === 9 && d.length === 3 && pc.length === 1,
        `era 1 attaches: follow ${f.length} (13), hit ${h.length} (10), harass ${x.length} (9), hide ${d.length} (3), botPConly ${pc.length} (1)`);
      const bots = w.records.filter((r) => /^BB[TRGBY]\d$/.test(r.name));
      ok(bots.length === 10 && bots.every((r) => r.enabled && (r.ctrl.flags & 0x40) && r.anim), 'ten bots, visible, targetable (controller flag 0x40), animated');
      ok(bots.every((r) => w.vars.get(moveVar(r)) === 0), `FUN_00532acc: every bot's MOVE var reset to 0 (${bots.map((r) => hex(w.vars.get(moveVar(r)))).join(',')})`);
      // FUN_005327b1: the harassed NPCs (argument +0 > 1) get 0x20000
      ok([0x61, 0x60, 0x7a, 0x5c].every((v) => (w.vars.get(v) & 0x20000) !== 0), `victims PAPA / NICK / POST / TBOB |= 0x20000 (${[0x61, 0x60, 0x7a, 0x5c].map((v) => hex(w.vars.get(v))).join(',')})`);
      const leaders = f.filter((e) => e.n.leader).map((e) => `${e.r.name}>${e.n.leader.name}:${e.n.type}`);
      ok(leaders.join(' ') === 'BBT1>PAPA:0 BBR0>BBT1:2 BBG0>JACK:3 BBB0>NICK:1082130432', `leaders and types (in attach order the shared counter DAT_05d586a4 for argument < 1; BBB0's argument is the float 4.0 read as an int): ${leaders.join(' ')}`);
      ok(f.every((e) => e.n.dist === 1), 'follow distance = argument 0.125 * 8');
      const ring = readRing(I.pe);
      ok(ring.join(',') === '369,370,371,372,373,374,375', `ring DAT_008eaaf8 (${ring.join(',')})`);
      ok(waypoints.get(I.rec('BBT0').ctrl.walker).from === 369, 'BBT0: walker re-pinned on ring node 0x171');
      ok(mapClip(0x73, 1) === 0x8d && mapClip(0x73, 0) === 0x113 && mapClip(0x73, 2) === 0x8e && mapClip(0x74, 1) === 0x91 && mapClip(0x74, 0) === 0x90 &&
        mapClip(0x85, 3) === 0x123 && mapClip(0x13, 3) === 0x29 && mapClip(0x8e, 0) === 0x113 && mapClip(0x8d, 0) === 0x8e && mapClip(0x78, 0) === 0x78, 'FUN_00531944 clip map');

      // ---- 2. they move, follow, hide without leaving the world / NaN
      const start = new Map(bots.map((r) => [r, [r.x, r.y, r.z]]));
      const ring0 = waypoints.nodePos(MAP_PATH, 369);
      let bad = '', maxGap = 0, riderGap = 0, ringMoved = false;
      const bbt0 = I.rec('BBT0'), hide0 = bbt0.ctrl.nodes.find((n) => n instanceof BotHideNode);
      tick(I, 1500, () => {
        for (const r of bots) if (![r.x, r.y, r.z].every(Number.isFinite) || Math.abs(r.x) > 600 || Math.abs(r.z) > 600 || r.y < w.seaLevel - 1) bad ||= `${r.name} at ${r.x},${r.y},${r.z}`;
        for (const e of f) if (e.n.leader && e.n.type !== 3 && e.n.stamp === w.frame) maxGap = Math.max(maxGap, Math.hypot(e.r.x - e.n.leader.x, e.r.z - e.n.leader.z));
        const g = I.rec('BBG0'), j = I.rec('JACK');
        riderGap = Math.max(riderGap, Math.abs(g.x - j.x) + Math.abs(g.z - j.z));
        if (hide0.ring !== 0) ringMoved = true;
      });
      ok(!bad, `1500 ticks: every bot finite and on the island (${bad})`);
      const moved = bots.filter((r) => Math.hypot(r.x - start.get(r)[0], r.z - start.get(r)[2]) > 5).map((r) => r.name);
      ok(['BBT1', 'BBR0', 'BBG0', 'BBB0', 'BBY0', 'BBT2'].every((n) => moved.includes(n)), `the walkers / followers moved (${moved.join(',')})`);
      ok(maxGap > 0.5 && maxGap < 6, `followers stay close behind their leaders (max XZ gap ${maxGap.toFixed(2)})`);
      ok(riderGap < 1 && Math.abs(I.rec('BBG0').y - I.rec('JACK').y - 3.75) < 0.6, `BBG0 rides on JACK (type 3: +4, -0.5 in clip 0x29, one tick behind JACK who updates later; gap ${riderGap.toFixed(3)}, dy ${(I.rec('BBG0').y - I.rec('JACK').y).toFixed(2)})`);
      ok((w.vars.get(moveVar(I.rec('BBT1'))) & 0x2000000) !== 0 && (w.vars.get(0x61) & 0x2000000) !== 0, 'leaders are marked followed (0x2000000)');
      ok(ringMoved, `BBT0 moved on along the ring after 300 ticks (index ${hide0.ring})`);
      const pr = waypoints.nodePos(MAP_PATH, ring[hide0.ring]);
      ok(Math.hypot(bbt0.x - pr[0], bbt0.z - pr[2]) < 4 || hide0.state >= 2, `BBT0 near its ring node or on the way (${Math.hypot(bbt0.x - pr[0], bbt0.z - pr[2]).toFixed(2)}, state ${hide0.state}, ring0 ${ring0.map((v) => v.toFixed(0))})`);
      notes.push(`node 7 after 1500 ticks: ${bots.map((r) => `${r.name}(${r.x.toFixed(0)},${r.z.toFixed(0)})`).join(' ')}`);
    }

    // ======================================================================== 3. the hit, the daze, the collect, the story (node 8)
    {
      const I = island(ctx, 8);
      const w = I.world, p = I.pepper;
      tick(I, 30);
      ok(I.story.node === 8 && !I.story.complete(), 'node 8 not complete at the start');
      const order = ['BBY0', 'BBB0', 'BBG0', 'BBR0'];
      const want = { BBY0: 1, BBR0: 2, BBG0: 4, BBB0: 8 };
      for (const name of order) {
        const bot = I.rec(name), V = moveVar(bot), hn = hitNode(bot);
        if (name === 'BBR0') {
          // BBR0 walks behind BBT1: from the front the pizza hits BBT1 first (BBT1 hit -> Turn2Pep C sets BBR0's bit 1: it stops following)
          const t1 = throwAt(I, I.rec('BBT1'));
          ok(t1 >= 0, `BBT1 hit (${t1})`);
          tick(I, 2);
          ok((w.vars.get(V) & 1) !== 0, `BBT1 hit: BBR0's MOVE |= 1 (Turn2Pep C) (${hex(w.vars.get(V))})`);
          ok((w.vars.get(0x61) & 0x20001) === 1, `the victim PAPA: |= 1, 0x20000 cleared (${hex(w.vars.get(0x61))})`);
          tick(I, 200);
        }
        I.ictx.sounds.length = 0; I.ictx.fx.clear();
        const t = throwAt(I, bot);
        ok(t >= 0, `${name}: the thrown pizza hits it (after ${t} ticks)`);
        const v = w.vars.get(V);
        ok((v & 0x1000) && (v & 1) && !(v & 0xfe), `${name}: MOVE 0x1000 | 1, bits 2..0x80 cleared (${hex(v)})`);
        ok(I.ictx.sounds.some((s) => s.id === BOT_SND.HIT && s.pos), `${name}: Piza_Hit at the bot`);
        tick(I, 2);
        ok(bot.anim.clip === BOT_CLIP.PIZZAHIT && (bot.flags & 0x40) === 0, `${name}: clip BB_PIZZAHIT, no box collision (clip ${hex(bot.anim.clip)})`);
        ok(I.ictx.fx.log.some((e) => e.op === 'gate' && e.name === 'swirl01.swl' && e.gate.join() === '2,1,1'), `${name}: swirl01.swl over the head`);
        const ref = [bot.x, bot.z];
        tick(I, 60);
        ok(bot.anim.clip === BOT_CLIP.PIZZADAZED && Math.hypot(bot.x - ref[0], bot.z - ref[1]) < 0.5, `${name}: dazed (0x95) and standing still (${hex(bot.anim.clip)})`);
        // Pepper walks into it
        const h0 = w.vars.get(NUM_BOT_HEADS), s0 = w.vars.get(SCORE);
        p.x = bot.x + 1.5; p.z = bot.z; p.y = bot.y; p.rebuildYaw();
        tick(I, 1);
        ok(hn.dying === 10 || hn.dying === -1 || hn.scale < 0.9, `${name}: collected when Pepper is within 2 units (dying ${hn.dying})`);
        ok(w.vars.get(NUM_BOT_HEADS) === h0 + 1 && w.vars.get(SCORE) === s0 + 1000, `${name}: NUM_BOT_HEADS + 1, SCORE_LGI + 1000 (${w.vars.get(NUM_BOT_HEADS)}, ${w.vars.get(SCORE)})`);
        ok((w.vars.get(COLORED) & want[name]) !== 0, `${name}: COLORED_BOTHEADS bit ${want[name]} (${hex(w.vars.get(COLORED))})`);
        ok(I.ictx.sounds.some((s) => s.id === BOT_SND.COLLECT) && I.ictx.fx.log.some((e) => e.op === 'gate' && e.name === 'Explode01.par' && e.gate.join() === '2,1,1'), `${name}: Collect.wav and Explode01.par`);
        p.x += 30; p.rebuildYaw();
        tick(I, 8);
        ok(!bot.enabled && (w.vars.get(V) & ~0xf00) === 0x4000, `${name}: shrunk away and hidden, MOVE = 0x4000 (SGMFIG may add its 0x100..0x400 Pepper bits) (${hex(w.vars.get(V))}, enabled ${bot.enabled})`);
      }
      ok(w.vars.get(COLORED) === 15 && w.vars.get(NUM_BOT_HEADS) === 4, `four coloured heads: COLORED_BOTHEADS 15, NUM_BOT_HEADS ${w.vars.get(NUM_BOT_HEADS)}`);
      ok(I.story.complete(), 'node 8 complete (COLORED_BOTHEADS == 15)');
      // the story moves on; the handler on 8 -> 9 (FUN_004b7040): hologram alert, record 11 hidden, MOVE_INFO 0x4000, objective record 124
      const ictx = new IslandContext(w, I.pe, I.archive, I.profile.island);
      ictx.messages = I.messages; ictx.pathPos = pathPositions(I.archive);
      I.story.advance();
      ok(I.story.node === 9, `advanced to node 9 (${I.story.node})`);
      w.records[11].show();
      const r = storyHandler(liveStoryEnv(ictx), { prev: 8, next: -10 }, 9);
      ok(r === 1 && !w.records[11].enabled && w.vars.get(0x62) === 0x4000 && ictx.goal.holoTimer === 90 && ictx.goal.recs[0] === 124,
        `node 9 handler: stays, record 11 hidden, MOVE_INFO 0x4000, alert 90, objective 124 (${r}, ${w.records[11].enabled}, ${hex(w.vars.get(0x62))}, ${ictx.goal.holoTimer}, ${ictx.goal.recs[0]})`);
      ok(I.story.nodes[9].var === 5 && I.story.nodes[9].value === 5, 'node 9 waits for NEXT_SUBGAME == 5 (the first mini-game)');
      // a collected bot stays gone
      tick(I, 60);
      ok(order.every((n) => !I.rec(n).enabled), 'the collected bots stay hidden');
    }

    // ======================================================================== 4. recovery without the collect; the hand-over pizza
    {
      const I = island(ctx, 7);
      const w = I.world;
      tick(I, 30);
      const bot = I.rec('BBY0'), V = moveVar(bot), hn = hitNode(bot);
      ok(throwAt(I, bot) >= 0, 'BBY0 hit');
      I.pepper.x += 40; I.pepper.rebuildYaw();
      let n = 0;
      while ((w.vars.get(V) & 0x1000) && n++ < 600) tick(I, 1);
      ok((w.vars.get(V) & 0x1000) === 0 && (bot.flags & 0x40) !== 0 && hn.armed === 1, `back on its feet after ${n} ticks (0x1000 cleared, box collision back, armed) (${hex(w.vars.get(V))})`);
      ok(w.vars.get(NUM_BOT_HEADS) === 0 && bot.enabled, 'not collected: no head, still there');
      // the hand-over (Space within 4.8 units: Pepper smashes the hand pizzas PIZ3 / PIZ4 onto it): BB_PIZZADOUBLEHIT1
      const s = pizzaSystem(w);
      ok(s.hand.every((h) => h && h.rec), `era 1: hand pizzas bound (${s.hand.map((h) => h?.rec?.name).join(',')})`);
      let hit2 = false, clip = -1;
      for (let k = 0; k < 3 && !hit2; k++) {
        tick(I, 40);
        facePepper(I, bot, 3); tick(I, 1); facePepper(I, bot, 3);
        press(I, 'Space');
        for (let t = 0; t < 90 && !hit2; t++) { tick(I, 1); if (hn.how === 2 && hn.armed === 0) { hit2 = true; tick(I, 2); clip = hn.dying ? -2 : bot.anim.clip; } }
      }
      ok(hit2 && (clip === BOT_CLIP.DOUBLEHIT || clip === -2), `the hand-over pizza (FUN_00429556 = 2) dazes it with BB_PIZZADOUBLEHIT1, or Pepper (3 units away) collects it at once (${hit2}, clip ${clip === -2 ? 'collected' : hex(clip)})`);
    }

    // ======================================================================== 5. eras 2 / 3
    {
      const I = island(ctx, 30);
      const w = I.world;
      const f = nodesOf(w, BotFollowNode).filter((e) => e.n.leader).map((e) => `${e.r.name}>${e.n.leader.name}`);
      ok(nodesOf(w, BotHitNode).length === 6 && !I.rec('BBR0')?.ctrl?.nodes.some((n) => n instanceof BotHitNode), `era 2: six grey bots, no coloured ones (${nodesOf(w, BotHitNode).length})`);
      ok(f.join(' ') === 'BBT1>TBOB BBT3>BBT2', `era 2 leaders (${f.join(' ')})`);
      tick(I, 600);
      ok(w.records.filter((r) => /^BBT/.test(r.name)).every((r) => [r.x, r.y, r.z].every(Number.isFinite)), 'era 2: 600 ticks finite');
    }
    {
      const I = island(ctx, 52);
      const w = I.world;
      ok(nodesOf(w, BotHitNode).every((e) => e.n.mask === 0), 'era 3: the hit node runs always (the wave gag)');
      tick(I, 30);
      // WP17: BOTMUSIC (before the walker nodes in the chain) now returns 0 when the bot does not dance, so the bots walk in era 3 and a follower's
      // BotFollow pre-render sets 0x20000 every frame, which (like in the original) blocks the wave gag for that bot: try the bots until one is free
      let bot = null, V = 0, waved = false;
      for (const cand of w.records.filter((r) => /^BB[YBGRT]/.test(r.name) && r.enabled)) {
        bot = cand; V = moveVar(bot);
        for (let t = 0; t < 90 && !waved; t++) { facePepper(I, bot, 20); tick(I, 1); if (bot.anim.clip === BOT_CLIP.SURPRISED) waved = true; }
        if (waved) break;
      }
      // Pepper waves (SGMFIG's 0x200: in front, within the near radius): the bot plays BB surprised (0x70)
      ok(waved, `era 3: ${bot?.name} answers Pepper in front with clip 0x70 (MOVE ${hex(w.vars.get(V))})`);
      notes.push(`era 3 wave gag: ${bot?.name}`);
      const t = throwAt(I, bot);
      ok(t < 0 && w.vars.get(NUM_BOT_HEADS) === 0, 'era 3 (node >= 0x34): pizzas no longer hit the bots (FUN_00429556)');
    }
    return { checked, failures, notes };
  },
};
