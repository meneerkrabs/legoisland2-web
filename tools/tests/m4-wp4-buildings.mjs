// WP4: building.c (doors, swinging parts, Constructopedia pages, the music house, props), LGI_FSM and hOLO on the real island world
// (docs/re/m4/wp4-triggers.md).
import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { partOverrides, baseParts, BUILDING_PROPS, pageBuildings, pageSlots, DOOR_OPEN, DOOR_CLOSED } from '../../src/island/trigger/index.ts';

const put = (I, x, y, z) => { const p = I.pepper; p.x = x; p.y = y; p.z = z; };
const nodesOf = (I, name, kind) => I.rec(name)?.ctrl?.nodes.filter((n) => n.kind === kind) ?? [];
const yawOf = (m) => Math.atan2(m[8], m[10]);

export default {
  name: 'm4-wp4-buildings',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };

    // --- exit door: INFC (the info centre, exit zone 4) at node 2 opens by itself when Pepper comes near and writes var 5 = 4 at the threshold
    {
      const I = loadIsland(ctx, { node: 2 });
      tick(I, 1);
      const rec = I.rec('INFC');
      const d = nodesOf(I, 'INFC', 'building.door').find((n) => n.a.part === 1);
      ok(d && !d.dead && d.a.exit === 4 && d.r2 === 144, `INFC door: ${d && JSON.stringify(d.a)} r2 ${d?.r2}`);
      ok(baseParts(I.world, rec)?.length === 6, 'INFC mesh has 6 MATL sub-objects');
      const p = rec.toWorld(d.off);
      put(I, p[0], p[1], p[2] + 3);
      tick(I, 30);
      ok(d.state === DOOR_OPEN && Math.abs(d.angle - d.open) < 1e-6, `INFC door open (state ${d.state}, angle ${d.angle})`);
      const live = partOverrides(I.world, rec)?.get(1);
      ok(live && Math.abs(yawOf(live) - d.open) < 1e-4, `the live MATL matrix 1 has the door's angle (${live && yawOf(live)})`);
      ok(I.vars.get(5) === 2, 'no exit 3 units from the door point');
      put(I, p[0], p[1], p[2]);
      tick(I, 2);
      ok(I.vars.get(5) === 4, `INFC threshold: var 5 = ${I.vars.get(5)}`);
      // walking away: the door closes again
      for (let i = 0; i < 40; i++) { put(I, p[0] + 15, p[1], p[2] + 3); tick(I, 1); }   // (the door ignores Pepper more than 4 units above / below)
      ok(d.state === DOOR_CLOSED && Math.abs(d.angle - d.closed) < 1e-6, `INFC door closed again (state ${d.state})`);
    }

    // --- ordinary door: HSE1 (exit -1, flags 0x101 = stays open) needs the action button; Pepper next to it is pushed away while it swings
    {
      const I = loadIsland(ctx, { node: 2 });
      tick(I, 1);
      const rec = I.rec('HSE1');
      const d = nodesOf(I, 'HSE1', 'building.door').find((n) => n.a.part === 2);
      const p = rec.toWorld(d.off);
      put(I, p[0] + 3, p[1], p[2]);
      tick(I, 10);
      ok(d.state === DOOR_CLOSED, `HSE1 door stays shut without the action button (state ${d.state})`);
      put(I, p[0] + 3, p[1], p[2]);
      press(I, 'ShiftLeft');
      ok(d.state !== DOOR_CLOSED, `HSE1 door: Shift opens it (state ${d.state})`);
      const x0 = I.pepper.x;
      tick(I, 30);
      ok(d.state === DOOR_OPEN, `HSE1 door open (state ${d.state})`);
      ok(I.pepper.x > x0 || Math.hypot(I.pepper.x - p[0], I.pepper.z - p[2]) > 3, 'Pepper pushed away from the swinging door');
      for (let i = 0; i < 30; i++) { put(I, p[0] + 15, p[1], p[2]); tick(I, 1); }
      ok(d.state === DOOR_OPEN, 'flags & 1: it stays open when Pepper leaves');
      put(I, p[0] + 3, p[1], p[2]);
      press(I, 'ShiftLeft');
      tick(I, 40);
      ok(d.state === DOOR_CLOSED, `HSE1 door: Shift closes it (state ${d.state})`);
    }

    // --- swinging / spinning parts: the radio mast dish (RADI part 5, about y), the hospital's sign (HOSP, spins for ever: to = -1e38)
    {
      const I = loadIsland(ctx, { node: 2 });
      tick(I, 1);
      const s = nodesOf(I, 'RADI', 'building.swing')[0];
      const a0 = s.angle;
      tick(I, 30);
      ok(Math.abs(s.angle - a0 - 0.3) < 1e-4 && s.state === 1, `RADI swings at 0.01 / tick (${a0} -> ${s.angle})`);
      const live = partOverrides(I.world, I.rec('RADI'))?.get(s.a.part);
      ok(live && Math.abs(Math.atan2(live[8], live[10]) - Math.atan2(Math.sin(s.angle), Math.cos(s.angle))) < 1e-4, 'RADI part matrix follows');
      const h = nodesOf(I, 'HOSP', 'building.swing')[0];
      ok(h && h.a.to < -1e30, `HOSP part ${h?.a.part} spins without end (to ${h?.a.to})`);
    }

    // --- props: FUN_00533d30's pairs (RESQ -> SPBT, POLB -> its vehicles / jail ...)
    {
      const I = loadIsland(ctx, { node: 2 });
      const nm = (i) => I.world.records[i]?.name;
      ok(BUILDING_PROPS.get(I.index('RESQ'))?.map(nm).join() === 'SPBT', `RESQ props ${BUILDING_PROPS.get(I.index('RESQ'))?.map(nm)}`);
      ok(BUILDING_PROPS.get(I.index('POLB'))?.map(nm).includes('JAIL') && BUILDING_PROPS.get(I.index('POLB'))?.map(nm).includes('PHEL'), `POLB props ${BUILDING_PROPS.get(I.index('POLB'))?.map(nm)}`);
      notes.push(`props: ${[...BUILDING_PROPS].map(([b, ps]) => `${nm(b)} -> ${ps.map(nm).join('/')}`).join(', ')}`);
    }

    // --- Constructopedia pages (era 1, node 7): pickup -> NUM_PAGES + 1, 15 ticks later the page cutscene (slot table[PAGECOUNTER]), PAGES_SET |= bit
    {
      const I = loadIsland(ctx, { node: 7 });
      ok(pageBuildings(I.world).map((r) => r?.name).join() === 'RESQ,HSE1,PHSE,INFC', `page buildings ${pageBuildings(I.world).map((r) => r?.name)}`);
      ok(pageSlots(I.world).join() === '1,2,3,4', `page slots ${pageSlots(I.world)}`);
      tick(I, 2);
      const pg = I.rec('PAG1');
      ok(pg.enabled && (pg.flags & 0x10) !== 0, 'PAG1 visible, not solid');
      const ry0 = pg.ry;
      tick(I, 5);
      ok(Math.abs(pg.ry - ry0 - 0.5) < 1e-4, `PAG1 spins 0.1 / tick (${pg.ry - ry0})`);
      put(I, pg.x, pg.y, pg.z);
      tick(I, 2);
      ok(!pg.enabled && I.vars.get(0xa5) === 1 && I.ictx.sounds.some((s) => s.id === 0x2f0), `PAG1 picked up (visible ${pg.enabled}, NUM_PAGES ${I.vars.get(0xa5)})`);
      ok(I.ictx.cutscenes.length === 0, 'the page cutscene waits 15 ticks');
      tick(I, 16);
      ok(I.ictx.cutscenes.map((c) => c.slot).join() === '1' && I.vars.get(0xc4) === 1 && (I.vars.get(0x26) & 1) === 1, `page cutscene ${JSON.stringify(I.ictx.cutscenes)} PAGECOUNTER ${I.vars.get(0xc4)} PAGES_SET ${I.vars.get(0x26)}`);
      // the second page plays the next slot
      const pg2 = I.rec('PAG2');
      put(I, pg2.x, pg2.y, pg2.z);
      tick(I, 20);
      ok(I.ictx.cutscenes.map((c) => c.slot).join() === '1,2' && (I.vars.get(0x26) & 3) === 3, `second page ${JSON.stringify(I.ictx.cutscenes)}`);
    }
    {
      // the constructor's "collected before" branch: PAG1 hides itself and reveals the first rebuilt building (RESQ) and its prop SPBT. (The era 1 set-up
      // resets PAGES_SET right before it attaches the pages, so the shipped game never takes this branch; the buildings come back by story node instead.)
      // (the branch runs in the constructor, i.e. at set-up time, as in the original: PAGES_SET is set before the island is built; WP-SAVE moved the page's constructor work out of the first update)
      const I0 = loadIsland(ctx, { node: 7 });
      ok(!I0.rec('RESQ').enabled && !I0.rec('SPBT').enabled, 'node 7: RESQ / SPBT destroyed');
      // (the set-up resets PAGES_SET before it attaches the pages, so the test re-runs the page's constructor half with the variable set)
      const I = loadIsland(ctx, { node: 7 });
      I.vars.set(0x26, 1);
      const pn = I.rec('PAG1').ctrl.nodes.find((n) => n.kind === 'building.page'); pn.flagged = false; pn.ctorInit(I.world, I.rec('PAG1'));
      tick(I, 1);
      ok(!I.rec('PAG1').enabled && I.rec('PAG2').enabled, 'PAGES_SET 1: PAG1 gone');
      ok(I.rec('RESQ').enabled && I.rec('SPBT').enabled && !I.rec('HSE1').enabled, `PAGES_SET 1: RESQ ${I.rec('RESQ').enabled} SPBT ${I.rec('SPBT').enabled} HSE1 ${I.rec('HSE1').enabled}`);
    }

    // --- the music house HSE2 (era 0): 3D music loop at the house, the house bounces (matrix wobble after the tick, restored before the next update)
    {
      const I = loadIsland(ctx, { node: 2 });
      const h = I.rec('HSE2');
      const y0 = h.y, m0 = h.m.slice();
      tick(I, 10);
      ok(I.ictx.sounds.filter((s) => s.id === 0x8b).length === 10, `HSE2 music: ${I.ictx.sounds.filter((s) => s.id === 0x8b).length} x sfxAt(0x8b)`);
      const n = nodesOf(I, 'HSE2', 'building.musichouse')[0];
      ok(Math.abs(n.phase - 4) < 1e-4, `phase 0.4 / tick (${n.phase})`);
      const s = Math.abs(Math.sin(n.phase));
      ok(Math.abs(h.y - (y0 + s * 0.25)) < 1e-3 && Math.abs(Math.hypot(h.m[0], h.m[1], h.m[2]) - Math.hypot(m0[0], m0[1], m0[2]) * (0.9375 + 0.0625 * s)) < 1e-3, `HSE2 bounces (y ${y0} -> ${h.y})`);
    }

    // --- LGI_FSM: SWITCH sound table (1 -> sound at the record, var 2), the info centre doors (0x106), the jail door (0x134), collision switch (0x129)
    {
      const I = loadIsland(ctx, { node: 2 });
      tick(I, 1);
      const fsm = I.world.records.flatMap((r) => r.ctrl?.nodes ?? []).find((n) => n.kind === 'LGI_FSM');
      ok(fsm && fsm.sounds.length === 33, `LGI_FSM: ${fsm?.sounds.length} sound switches`);
      const s0 = fsm.sounds[0];
      I.vars.set(s0.var, 1);
      tick(I, 1);
      ok(I.vars.get(s0.var) === 2 && I.ictx.sounds.some((s) => s.id === 0x33a && s.pos), `sound switch ${s0.var.toString(16)} -> ${I.vars.get(s0.var)}, ${JSON.stringify(I.ictx.sounds.slice(-1))}`);
      I.vars.set(0x106, 1);
      tick(I, 1);
      ok(I.vars.get(0x106) === 2 && I.ictx.sounds.some((s) => s.id === 0x33e), 'info doors: 1 -> 2 + sound 0x33e');
      let n = 0;
      while (I.vars.get(0x106) === 2 && n < 100) { tick(I, 1); n++; }
      ok(I.vars.get(0x106) === 3 && n === 17, `info doors swing past 1.8 rad in ${n} ticks (var ${I.vars.get(0x106)})`);
      n = 0;
      while (I.vars.get(0x106) === 3 && n < 300) { tick(I, 1); n++; }
      ok(I.vars.get(0x106) === 0, `info doors at rest after ${n} ticks`);
      I.vars.set(0x134, 1);
      tick(I, 20);
      ok(I.vars.get(0x134) === 0 && Math.abs(fsm.jailAngle) > 1.8, `jail door: var 0x134 ${I.vars.get(0x134)} angle ${fsm.jailAngle}`);
      const jl = partOverrides(I.world, I.rec('JAIL'))?.get(1);
      ok(jl && Math.abs(Math.atan2(jl[8], jl[10]) - Math.atan2(Math.sin(fsm.jailAngle), Math.cos(fsm.jailAngle))) < 1e-4, 'jail door sub-object rotated');
      I.vars.set(0x129, 1); tick(I, 1);
      ok([12, 13, 17, 18].every((i) => (I.world.records[i].flags & 0x10) !== 0), 'switch 0x129 = 1: records 12/13/17/18 not solid');
      I.vars.set(0x129, 2); tick(I, 1);
      ok([12, 13, 17, 18].every((i) => (I.world.records[i].flags & 0x10) === 0), 'switch 0x129 = 2: solid again');
      I.vars.set(0x131, 5); const r0 = fsm.rotor; tick(I, 4);
      ok(Math.abs(fsm.rotor - r0 - 2) < 1e-5, `rotor 0x131 = 5: 0.5 rad / tick (${fsm.rotor - r0})`);
      // era 0: switch 0x128 scales record 370 (WORM) in
      I.vars.set(0x128, 1); tick(I, 1);
      ok(I.vars.get(0x128) === 2, 'scale switch 0x128: 1 -> 2');
      tick(I, 40);
      ok(I.vars.get(0x128) === 0 && I.world.records[370].enabled, `scale switch done (${I.vars.get(0x128)})`);
    }

    // --- hOLO: hold Shift 20 ticks -> hologram up (var 0xc6 = 1), scales in, speaks HOLOA of the hint table; Shift again -> it goes away
    {
      const I = loadIsland(ctx, { node: 2 });
      const holo = I.rec('HOLO');
      try { I.ictx.text.hol = { find: (id) => (/^HOLO[AB]$/.test(id) ? { tag: id } : null), text: (id) => id }; } catch { /* readonly in a real ctx */ }
      tick(I, 2);
      ok(!holo.enabled, 'HOLO hidden at the start (constructor arg 0)');
      I.vars.set(0x5e, 1);
      hold(I, ['ShiftLeft'], 25);
      ok(I.vars.get(0xc6) === 1 && holo.enabled, `hologram up after holding Shift (var 0xc6 ${I.vars.get(0xc6)})`);
      tick(I, 12);
      ok(I.ictx.said.some((s) => s.id === 'HOLOA'), `hint HOLOA spoken (${JSON.stringify(I.ictx.said)})`);
      const d = Math.hypot(holo.x - I.pepper.x, holo.z - I.pepper.z);
      ok(d > 2 && d < 6, `hologram next to Pepper (${d.toFixed(2)})`);
      press(I, 'ShiftLeft');
      tick(I, 12);
      ok(I.vars.get(0xc6) === 0 && !holo.enabled, `hologram gone (var 0xc6 ${I.vars.get(0xc6)}, visible ${holo.enabled})`);
      // the story's alert timer (ctx.objective.holoTimer) calls it without a key
      I.ictx.objective = { holoTimer: 3, target: () => null };
      tick(I, 6);
      ok(I.vars.get(0xc6) === 1, 'alert timer: hologram up by itself');
      tick(I, 12);
      ok(I.ictx.said.some((s) => s.id === 'HOLOB'), 'second call: HOLOB');
    }
    return { checked, failures, notes };
  },
};
