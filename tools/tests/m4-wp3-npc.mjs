// WP3 (docs/re/m4/wp3-npc.md): the island's talking minifigs on the real island world (emulated set-up of story nodes 2 and 7, real collision, real
// waypoint maps, the real lifsm1.str / lifsm5.str): SGMFIG (0x426151), Human1 (0x4bec00), Turn2Pep A / B (0x52ff39 / 0x5306e5), MeetPepp (0x530d69).
import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs, npcGlobals, SgmfigNode, Human1Node } from '../../src/island/npc/index.ts';
import { waypoints, MAP_PATH } from '../../src/game/walker.ts';

const SHIFT = 'ShiftLeft';

function island(ctx, node, npcFile) {
  const I = loadIsland(ctx, { node, npcFile });
  const counts = loadIslandWalkMaps(I.archive, I.profile.island);
  startIslandNpcs(I.world);
  return { I, counts };
}
const sg = (r) => r.ctrl?.nodes.find((n) => n instanceof SgmfigNode);

/** distance in XZ from (x, z) to the nearest edge of the PATH map */
function pathDistance(x, z) {
  let best = 1e9;
  const n = waypoints.mapCount(MAP_PATH);
  for (let a = 0; a < n; a++) {
    const pa = waypoints.nodePos(MAP_PATH, a);
    best = Math.min(best, Math.hypot(x - pa[0], z - pa[2]));
    for (const b of waypoints.neighbors(MAP_PATH, a).nodes) {
      if (b <= a) continue;
      const pb = waypoints.nodePos(MAP_PATH, b);
      const dx = pb[0] - pa[0], dz = pb[2] - pa[2], l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - pa[0]) * dx + (z - pa[2]) * dz) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - (pa[0] + t * dx), z - (pa[2] + t * dz)));
    }
  }
  return best;
}

/** put Pepper `d` units from the NPC at `off` radians from its heading, facing it */
function placePepper(I, npc, d, off = 0) {
  const p = I.pepper, a = npc.ry + off;
  p.x = npc.x + Math.sin(a) * d; p.z = npc.z + Math.cos(a) * d; p.y = npc.y;
  p.ry = Math.atan2(npc.x - p.x, npc.z - p.z); p.rebuildYaw();
}

export default {
  name: 'm4-wp3-npc',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const hex = (v) => '0x' + (v >>> 0).toString(16);

    // ======================================================================== era 0 (story node 2)
    {
      const { I, counts } = island(ctx, 2, 'LI/Data/lifsm1.str');
      const w = I.world, v = I.vars;
      ok(counts.every((c) => c > 0), `the four waypoint maps load (${counts.join(' / ')})`);
      const npcs = w.records.filter((r) => sg(r));
      ok(npcs.length === 38, `38 SGMFIG nodes in era 0 (${npcs.length})`);
      const walkers = npcs.filter((r) => r.ctrl.nodes.some((n) => n instanceof Human1Node));
      ok(npcs.every((r) => r.ctrl.walker > 0 && r.anim), 'every NPC has its walker and an animation instance (MFIG)');
      ok(npcs.every((r) => (r.flags & 0x40) !== 0), 'record flag 0x40 (NPC) set by the constructor');
      ok(npcs.every((r) => r.ctrl.flags === 0x13), `controller flags 0x13 of the set-up (${[...new Set(npcs.map((r) => hex(r.ctrl.flags)))].join(',')})`);

      // ---- walking: 600 ticks (20 s)
      const start = new Map(npcs.map((r) => [r, [r.x, r.y, r.z]]));
      let maxOff = 0, worst = '', below = [];
      for (let t = 0; t < 600; t += 20) {
        tick(I, 20);
        for (const r of walkers) {
          // only while one of its Human1 routes runs (other WPs' nodes, e.g. NUBB's speeder driver, may move the record elsewhere)
          if (!r.enabled || !r.ctrl.nodes.some((n, i) => n instanceof Human1Node && r.ctrl.ran[i])) continue;
          const d = pathDistance(r.x, r.z);
          if (d > maxOff) { maxOff = d; worst = r.name; }
          const g = w.col.terrainHeight(r.x, r.y, r.z, 8);
          if (g > -1e30 && r.y < g - 0.6) below.push(`${r.name}@${t}: y ${r.y.toFixed(2)} ground ${g.toFixed(2)}`);
        }
      }
      const moved = walkers.filter((r) => r.enabled && Math.hypot(r.x - start.get(r)[0], r.z - start.get(r)[2]) > 10);
      notes.push(`era 0: ${walkers.length} NPCs with Human1 routes, ${moved.length} walked > 10 units in 20 s; furthest from the PATH network ${maxOff.toFixed(2)} (${worst})`);
      ok(moved.length >= 12, `the route walkers walk (${moved.length} of ${walkers.length} moved > 10 units in 600 ticks)`);
      ok(maxOff < 3.5, `the walkers stay on the paths (max ${maxOff.toFixed(2)} units from a PATH edge, ${worst})`);
      ok(below.length === 0, `no walker below the terrain: ${below.slice(0, 3).join('; ')}`);

      // ---- Turn2Pep A: Pepper in front within the near radius (32): the state word gets 0x700, PAPA turns to her and waves (clip 0x74)
      const papa = I.rec('PAPA'), pn = sg(papa);
      placePepper(I, papa, 20, 0.9);
      tick(I, 1); placePepper(I, papa, 20, 0.9);
      const want = Math.atan2(I.pepper.x - papa.x, I.pepper.z - papa.z);
      let faced = false, waved = false;
      for (let i = 0; i < 60; i++) {
        tick(I, 1);
        if (Math.abs(Math.atan2(Math.sin(papa.ry - want), Math.cos(papa.ry - want))) < 0.05) faced = true;
        if (papa.anim.clip === 0x74) waved = true;
      }
      ok((v.get(pn.var) & 0x700) === 0x700, `PAPA's state word has 0x700 with Pepper 20 units in front (${hex(v.get(pn.var))})`);
      ok(faced, `PAPA turns to face Pepper (Turn2Pep A, ry ${papa.ry.toFixed(2)} vs ${want.toFixed(2)})`);
      ok(waved, 'PAPA waves (clip 0x74)');

      // ---- talking: INFO (no cutscene slot): Shift in front within the talk radius (8)
      const info = I.rec('INFO'), inode = sg(info), p = I.pepper;
      placePepper(I, info, 4); tick(I, 2); placePepper(I, info, 4); tick(I, 1);
      ok((v.get(0xc) & 1) !== 0, `INTERACT_ICONS bit 1 (talk icon) near INFO (${hex(v.get(0xc))})`);
      I.ictx.said.length = 0;
      press(I, SHIFT);
      ok(I.ictx.said[0]?.id === 'INFOA', `Shift talks: INFO says INFOA (${JSON.stringify(I.ictx.said[0])})`);
      ok((inode.talk & 0x40) !== 0 && npcGlobals(w).target === info, 'INFO is talking and the Shift target');
      ok((p.ctrl.flags & 2) === 0, 'Pepper\'s controller is disabled during the conversation');
      ok(p.anim.clip === 0x78 && w.pep.mailbox === 0x78, `Pepper's talk pose 0x78 (${hex(p.anim.clip)})`);
      ok(info.anim.clip === inode.set.talk && inode.set.talk === 130, `INFO plays the talk clip of DAT_008adcf8 (${info.anim.clip})`);
      const face = Math.atan2(info.x - p.x, info.z - p.z);
      ok(Math.abs(Math.atan2(Math.sin(p.ry - face), Math.cos(p.ry - face))) < 0.01, 'Pepper faces INFO (FUN_004252c3)');
      const cam = w.camera.c;
      ok(Math.abs(cam[3] - info.x) < 0.01 && Math.abs(cam[4] - (info.y + 3.2)) < 0.01, `the conversation camera looks at INFO (+3.2) (${cam[3].toFixed(1)}, ${cam[4].toFixed(1)})`);
      let n = 0; while ((inode.talk & 0x40) && n < 400) { tick(I, 1); n++; }
      ok(n >= 59 && n <= 62, `the conversation ends with the speech, timer below 30 (${n} ticks)`);
      // (the controller is re-enabled by INFO's update, before Pepper's own record runs in the same tick: the walk node has already taken the idle mailbox 0x1b into its state; a disabled controller runs neither pre-render nor draw hooks like FUN_004225c5 / FUN_0042271b)
      ok((p.ctrl.flags & 2) !== 0 && v.get(0x5e) === 1 && (w.pep.mailbox === 0x1b || I.L.walk.state === 0x1b), `back to walking (PEPPER_CONTROL ${hex(v.get(0x5e))}, mailbox ${hex(w.pep.mailbox)}, walk state ${hex(I.L.walk.state)})`);
      ok(inode.line === 1 && info.anim.clip === inode.savedClip, 'next pair of lines (C / D), the clip of before');
      // the second conversation points the way: the objective's target (WP8's FUN_00424e37; mocked: PAPA's place)
      const tgt = [papa.x, papa.y, papa.z];
      I.ictx.objective = { target: () => ({ pos: tgt, record: papa.index }), holoTimer: 0 };
      placePepper(I, info, 4); tick(I, 2); placePepper(I, info, 4); tick(I, 1);
      const ry0 = info.ry;
      press(I, SHIFT);
      ok(I.ictx.said.at(-1)?.id === 'INFOC', `the second conversation says INFOC (${I.ictx.said.at(-1)?.id})`);
      ok((inode.talk & 2) !== 0 && info.anim.clip === inode.set.point && inode.set.point === 129, `INFO points (talk flags ${hex(inode.talk)}, clip ${info.anim.clip})`);
      tick(I, 20);
      const toT = Math.atan2(tgt[0] - info.x, tgt[2] - info.z);
      const dA = (a) => Math.abs(Math.atan2(Math.sin(a - toT), Math.cos(a - toT)));
      ok(dA(info.ry) < dA(ry0) - 0.1 || dA(info.ry) < 0.05, `INFO turns towards the target (${dA(ry0).toFixed(2)} -> ${dA(info.ry).toFixed(2)} rad off)`);
      // Shift again cuts it short
      press(I, SHIFT);
      ok((inode.talk & 0x40) === 0 && (p.ctrl.flags & 2) !== 0, 'Shift during the conversation ends it');
      ok(inode.line === 0, 'the line pair wraps to A / B');

      // ---- a customer with a cutscene: LICK (type 2, slot 9, NUM_PIZZAS -1): Shift starts the slot, the reward follows
      const lick = I.rec('LICK'), ln = sg(lick);
      for (let i = 0; i < 3; i++) { placePepper(I, lick, 4); tick(I, 1); }
      const before = { score: v.get(0xa6), phase: v.get(0xad), bricks: v.get(0x4f), pizzas: v.get(0xb0) };
      I.ictx.cutscenes.length = 0;
      press(I, SHIFT);
      ok(I.ictx.cutscenes[0]?.slot === 9, `LICK starts its cutscene slot 9 (${JSON.stringify(I.ictx.cutscenes)})`);
      tick(I, 3);
      ok(ln.slot === -30, `LICK's slot word -10 -> -20 -> -30 (${ln.slot})`);
      ok(v.get(0xa6) === before.score + 1000, `SCORE_LGI + 1000 (${before.score} -> ${v.get(0xa6)})`);
      ok(v.get(0xad) === before.phase + 1 && v.get(0x4f) === before.bricks - 1, `house customer: HOUSECONTRUCTIONPHASE + 1, NUM_BRICKS - 1 (${v.get(0xad)}, ${v.get(0x4f)})`);
      ok(I.ictx.cutscenes.some((c) => c.slot === 0x1a + before.phase), `the house stage cutscene 0x1a + phase (${JSON.stringify(I.ictx.cutscenes)})`);
      ok(v.get(0xb0) === before.pizzas - 1 && (v.get(ln.var) & 0x48003) === 0x48003, `NUM_PIZZAS - 1, the state word | 0x40003 | 0x8000 (${hex(v.get(ln.var))})`);
      ok(ln.talk50 === 0, 'the reward is paid once');
    }

    // ======================================================================== Human1's waypoint action (FUN_004bdde2 -> FUN_0051dc50)
    {
      // NICK's second route (gate MOVE_NICK & 4): one waypoint, PATH node 193, action 4 (and-not) with the value 5: arriving clears bits 4 | 1, the
      // first route (gate & 1 == 0) takes over (bit 0x20000000 of MOVE_NICK belongs to NICK's car, WP6). NICK is put on node 54 (the node before 193 on the PATH route) to keep the walk short.
      const { I } = island(ctx, 2, 'LI/Data/lifsm1.str');
      const nick = I.rec('NICK'), nv = sg(nick).var;
      tick(I, 2);
      waypoints.setNode(nick.ctrl.walker, 54, nick);
      I.vars.set(nv, 5);
      const dest = waypoints.nodePos(MAP_PATH, 193);
      let t = 0;
      while ((I.vars.get(nv) & 5) !== 0 && t < 1500) { tick(I, 1); t++; }
      const d = Math.hypot(nick.x - dest[0], nick.z - dest[2]);
      ok((I.vars.get(nv) & 5) === 0, `NICK walks to node 193 and clears MOVE_NICK & 5 there (${hex(I.vars.get(nv))} after ${t} ticks, ${d.toFixed(1)} units from the node)`);
      ok(d < 3, `NICK is at node 193 when the action runs (${d.toFixed(2)})`);
      tick(I, 60);
      const route0 = nick.ctrl.nodes.filter((n) => n instanceof Human1Node)[0];
      ok(nick.ctrl.ran[nick.ctrl.nodes.indexOf(route0)] === true, 'the first route (MOVE_NICK & 1 == 0) runs again');
    }

    // ======================================================================== era 1 (story node 7): MeetPepp, the bots walk
    {
      const { I } = island(ctx, 7, 'LI/Data/lifsm5.str');
      const w = I.world;
      const npcs = w.records.filter((r) => sg(r));
      const meet = npcs.filter((r) => r.ctrl.nodes.some((n) => n.kind === 'MeetPepp'));
      ok(meet.length >= 25, `era 1: MeetPepp on ${meet.length} NPCs`);
      let err = null;
      try { tick(I, 300); } catch (e) { err = e; }
      ok(!err, `era 1 runs 300 ticks (${err?.stack?.split('\n').slice(0, 3).join(' | ')})`);
      const vals = I.rec('VALS');
      for (let i = 0; i < 3; i++) { placePepper(I, vals, 4); tick(I, 1); }
      press(I, SHIFT);
      ok(I.ictx.said.at(-1)?.id === 'VALSA', `era 1: VALS says VALSA from lifsm5.str (${I.ictx.said.at(-1)?.id})`);
      // Turn2Pep C (0x5308f3) on TBOB: gate var 0x91 & 0x10 -> MOVE_TBOB (0x5c) |= 0x10
      I.vars.andNot(0x5c, 0x10); I.vars.or(0x91, 0x10); tick(I, 2);
      ok((I.vars.get(0x5c) & 0x10) !== 0, `Turn2Pep C: MOVE_TBOB |= 0x10 while var 0x91 has 0x10 (${hex(I.vars.get(0x5c))})`);
      notes.push(`era 1: ${npcs.length} SGMFIG, ${meet.length} with MeetPepp; skipped attaches ${I.L.skipped.length}`);
    }
    return { checked, failures, notes };
  },
};
