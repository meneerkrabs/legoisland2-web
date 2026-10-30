// WP-VERIFY M7 island vehicles: PepSwitc, Pepper's mode switch of the island (update FUN_004bb630, pre-render FUN_004bb67d) and the Enter-looks hook it starts with (FUN_0051db5c nearest record -> FUN_00420404 next look,
// FUN_0051dbd7 / FUN_00420590 busy slots). The original's node framework + PepSwitc + the looks code run natively in the x86 emulation next to the port's IslandPepSwitch (src/island/vehicles/pepswitch.ts, looks.ts)
// with the same scripted inputs: the walk node's state (mailbox DAT_008ae088, PEPPER_CONTROL), Pepper's clip, her place (sea level / terrain probes), the held / pressed keys, the records in view. Compared per tick:
// Pepper's record, her and the board's animation clip / frame, record 9 (the board), all game variables, the vehicle globals, the sound calls, the hologram timer, the variant words, the busy list.
// (the vehicle modes 8 / 0x401: tools/tests/m7-isl-veh-car.mjs, boat, heli; the Ptera boarding: m7-isl-veh-ptera.mjs.) See tools/lib/m7-isl-veh-supe.mjs (switchSession).
import { switchSession, B, RECORDS_BASE, REC, lcg } from '../lib/m7-isl-veh-supe.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { looksOf, nearestLookRecord } from '../../src/island/vehicles/looks.ts';
import { compareChainBlocks, cdPatchChain, snapChainBlocks, pepSwitchLoadRounds } from '../lib/m8-save-pepper.mjs';

const MAXFAIL = 30;

export default {
  name: 'm7-isl-veh-switch',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, toSkate: 0, offSkate: 0, offWater: 0, swim: 0, blocked: 0, vehicle: 0, holo: 0, looks: 0, busy: 0, modes: new Set(), states: new Set() };
    const devs = new Map(), unhooked = new Map();
    const blocks = {};      // WP-SAVE: save blocks of Pepper's chain compared (original serializer vs port saveBlock) / loaded into both machines
    const need = (c, m) => { checked++; if (!c) failures.push('coverage: ' + m); };

    const session = (label, dt) => {
      const d = switchSession(ctx, { label, dt, failures, maxFail: MAXFAIL });
      cdPatchChain(d);      // WP-SAVE: the bytes of PepSwitc / SGVehic the constructors leave at the debug heap's 0xCD
      cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem, P = d.P.pepper;
      const compare = () => {
        d.rec(P.index);
        d.rec(d.board, 0xfffe);
        for (const [who, ao, ap] of [['PEPP', d.O.pepper.anim, P.anim], ['SBRD', d.O.world.records[d.board].anim, W.records[d.board].anim]]) if (ao && ap) { d.eq(who + ' clip', ao.clip, ap.clip); d.cmp(who + ' frame', ao.frame, ap.frame, 0, '', 1e-4); }
        d.globals(); d.vars(); d.sounds();
        compareChainBlocks(d, blocks);      // WP-SAVE: PepSwitc (spot, hologram flag), SGVehic
        d.cmp('holoTimer', mem.f32(0x5defbcc), d.P.ictx.objective.holoTimer, 0, '', 0);
        cover.modes.add(d.getVar(0x5e) & 0xfff); cover.states.add(mem.r32(0x8ae088));
        const L = looksOf(W);
        for (let k = 0; k < 8; k++) d.eq('busy slot', mem.r32(0x9da590 + 4 * k) | 0, L ? L.busy[k] : -1, ` ${k}`);
      };
      const checkVariants = () => { for (let i = 0; i < W.records.length; i++) d.eq('variant word', mem.r32(RECORDS_BASE + i * REC + 0x64) | 0, W.records[i].variant | 0, ` rec ${i} ${W.records[i].name}`); };
      const step = (held = 0) => { d.tick(held); cover.ticks++; compare(); };
      const idle = (n) => { for (let t = 0; t < n; t++) step(0); };
      /** Ctrl as a key press: one tick with it, one without */
      const tap = (bits = 0) => { step(bits | B.CTRL); step(bits); };
      const finish = () => {
        notes.push(`${label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
        checked += d.checked;
        for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
        for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      };
      return { d, W, mem, P, step, idle, tap, finish, compare, checkVariants };
    };

    for (const [label, dt] of [['dt1', 1], ['dt0.5', 0.5]]) {
      const S = session(`switch ${label}`, dt);
      const { d, W, mem, P, step, idle, tap } = S;
      const sea = W.seaLevel;
      // a dry spot well away from the vehicles, the decor and the water: the middle of the island
      const dry = [153.8, 15, -62.5];
      d.placePepper(...dry, 0);
      d.setPC(1); d.setState(0x1b);
      idle(3);
      S.checkVariants();
      // ---- walk: Ctrl in every walk state (the original lets some states keep Pepper off the board); PEPPER_CONTROL is set back to 1 before each
      for (let st = 0; st < 0x70; st++) {
        d.placePepper(...dry, 0); d.setPC(1); d.setState(st, false); d.setPepperClip(0x3a);
        d.setVar(0xc5, 0);
        tap();
        if (d.getVar(0x5e) === 4) cover.toSkate++; else cover.blocked++;
        // back to walking for the next state (the board hides again)
        idle(2);
      }
      // ---- the clips 99 / 0x62 (the dive) keep her off the board
      for (const clip of [99, 0x62, 0x16]) { d.placePepper(...dry, 0); d.setPC(1); d.setState(0x1b, false); d.setPepperClip(clip); tap(); idle(1); }
      // ---- skateboard (mode 4): Ctrl gets off unless in the air (mailbox 0x20 / 0x32); the 0x1000 bit survives
      for (const st of [0x29, 0x2a, 0x2b, 0x20, 0x21, 0x32, 0x2d, 0x16, 0x1b]) {
        for (const extra of [0, 0x1000]) {
          d.placePepper(...dry, 0); d.setPC(4 | extra); d.setState(st, false); d.setPepperClip(0x29);
          mem.w32(0x98383c, 0); tap(); if ((d.getVar(0x5e) & 0xfff) === 1) cover.offSkate++;
          idle(2);
        }
      }
      // ---- skateboard: water 4 units ahead (not in the air, not while getting on: clip 0x16) -> off. Spots at the shore: land here, terrain 4 ahead below the sea
      const shore = [], water = [];
      for (let x = -420; x <= 420; x += 6) for (let z = -420; z <= 420; z += 6) {
        for (let k = 0; k < 8; k++) {
          const yaw = k * Math.PI / 4, fx = Math.sin(yaw), fz = Math.cos(yaw);
          const hh = W.col.terrainHeight(x, 200, z, 0);
          if (hh <= -5000 || hh < sea + 1) continue;
          const ah = W.col.terrainHeight(x + fx * 4, hh + 4, z + fz * 4, 4.0);
          if (ah <= sea && shore.length < 12 && ((x + z) / 6) % 5 === 0) shore.push([x, hh, z, yaw]);
          // swimming: in the water, land one unit ahead
        }
      }
      for (let x = -420; x <= 420; x += 6) for (let z = -420; z <= 420; z += 6) {
        for (let k = 0; k < 8; k++) {
          const yaw = k * Math.PI / 4, fx = Math.sin(yaw), fz = Math.cos(yaw);
          const hh = W.col.terrainHeight(x, 200, z, 0);
          if (hh > sea - 0.5) continue;
          const ah = W.col.terrainHeight(x + fx, sea - 1 + 4, z + fz, 4.0);
          if (ah >= sea && water.length < 12 && ((x * 3 + z) / 6) % 7 === 0) water.push([x, sea - 1, z, yaw]);
        }
      }
      notes.push(`${label}: ${shore.length} shore spots, ${water.length} water spots (sea level ${sea})`);
      for (const [x, y, z, yaw] of shore) for (const st of [0x29, 0x20, 0x21]) for (const clip of [0x29, 0x16]) {
        d.placePepper(x, y, z, yaw); d.setPC(4); d.setState(st, false); d.setPepperClip(clip);
        step(0); if ((d.getVar(0x5e) & 0xfff) === 1) cover.offSkate++;
        idle(2);
      }
      // ---- swimming: out of the water where the terrain one unit ahead reaches the sea level (mode 1, state 0x25, the sound 0x128, Pepper put there 4 up)
      for (const [x, y, z, yaw] of water) { d.placePepper(x, y, z, yaw); d.setPC(2); d.setState(0x62, false); step(0); if ((d.getVar(0x5e) & 0xfff) === 1) cover.offWater++; idle(2); }
      // swimming far from any shore: nothing
      d.placePepper(0, sea - 1, 900, 0); d.setPC(2); d.setState(0x62, false); idle(3);
      // ---- walking with the feet below the sea: mode 2, state 0x62
      for (const [x, , z] of water.slice(0, 6)) { d.placePepper(x, sea - 2, z, 0); d.setPC(1); d.setState(0x1b, false); step(0); if ((d.getVar(0x5e) & 0xfff) === 2) cover.swim++; idle(2); }
      // ---- a vehicle chose Pepper (DAT_009daa80): the getting-in clip 0x4c; a pressed Ctrl alone with a vehicle chosen does not board the skateboard
      const amb = W.records.findIndex((r) => r.name === 'AMBU');
      for (const key of [0, B.CTRL]) { d.placePepper(...dry, 0); d.setPC(1); d.setState(0x1b, false); d.setCurrent(amb); step(key); step(0); d.setCurrent(-1); cover.vehicle++; idle(2); }
      // ---- the story node 30's hologram call timer (once)
      d.setVar(0x58, 0x1e); d.placePepper(...dry, 0); d.setPC(1); d.setState(0x1b, false); idle(3); if (d.P.ictx.objective.holoTimer === 90) cover.holo++; d.setVar(0x58, 2);
      // ---- 0x401 (leaving a car, one tick: the walk code takes over): PepSwitc's update puts Pepper on the spot (zero here); the pre-render goes to mode 1
      d.setPC(0x401); step(0); idle(2);

      // ---- Enter: the looks of the vehicles. Pepper beside each roster vehicle in view; the records out of view are skipped
      d.armLooks();
      const roster = looksOf(W)?.entries ?? [];
      for (const e of roster) {
        const r = W.records[e.rec];
        d.viewSet = new Set([e.rec]);
        d.placePepper(r.x + 5, r.y + 1, r.z + 4, 0); d.setPC(1); d.setState(0x1b, false);
        if (nearestLookRecord(W, P) !== e.rec) continue;     // a decor record nearer: the outfit / decor swap (FUN_00420bb7) is not part of this test
        for (let k = 0; k < 4; k++) { step(B.ENTER); step(0); idle(2); cover.looks++; }
        // out of view: nothing; Enter on a vehicle whose flag 0x8000 is set (the look change running): nothing
        d.viewSet = new Set(); step(B.ENTER); step(0);
        d.viewSet = new Set([e.rec]);
        for (const x of [d.O.world.records[e.rec], r]) x.flags |= 0x8000; d.emu.putRecord(e.rec, d.O.world.records[e.rec]);
        step(B.ENTER); step(0);
        for (const x of [d.O.world.records[e.rec], r]) x.flags &= ~0x8000; d.emu.putRecord(e.rec, d.O.world.records[e.rec]);
      }
      // two roster vehicles in view at once: the nearest; Enter twice in a row (the busy list: the second Enter on the same entry while its record is busy)
      if (roster.length > 1) {
        const a = W.records[roster[0].rec];
        d.viewSet = new Set(roster.map((e) => e.rec));
        d.placePepper(a.x + 3, a.y + 1, a.z + 2, 0);
        step(B.ENTER); step(B.ENTER | B.CTRL); step(B.ENTER); step(0); idle(3);
      }
      cover.busy = roster.length;
      // WP-SAVE: PepSwitc's loader (the 16 byte block, then FUN_0051c800: the decor era table, the stored looks, the busy list) in both machines after a hologram-flag state and a changed story
      { d.setVar(0x58, 0x1e); d.placePepper(...dry, 0); d.setPC(1); d.setState(0x1b, false); idle(3); d.viewSet = new Set(); }
      const snapC = snapChainBlocks(d, ['PepSwitc']);
      pepSwitchLoadRounds(d, snapC, [1, 20, 40, 70, 2], 31, blocks);
      idle(4);
      S.checkVariants();
      S.finish();
    }
    need(cover.toSkate >= 20 && cover.blocked >= 5, `walk -> skateboard ${cover.toSkate}, blocked ${cover.blocked}`);
    need(cover.offSkate >= 10, `skateboard off ${cover.offSkate}`); need(cover.offWater >= 4, `out of the water ${cover.offWater}`); need(cover.swim >= 4, `walk into the sea ${cover.swim}`);
    need(cover.looks >= 8, `looks ${cover.looks}`);
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`WP-SAVE save blocks of Pepper's chain compared (original serializer vs port saveBlock, tolerance 0): ${JSON.stringify(blocks)}`);
    notes.push(`coverage: ${JSON.stringify({ ...cover, modes: [...cover.modes], states: cover.states.size })}`);
    return { checked, failures, notes };
  },
};
