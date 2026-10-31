// M5 audit z03PPH, the ORACLE test: the original's house nodes (PeppHse hotspots / cameras, the door, the trophy browser, the wall map, PeppComp's place and camera, FUN_0053fed3) run in the
// x86 interpreter (tools/lib/pph-emu.mjs) next to the port's nodes (src/zones/z03PPH/house.ts). Random walks / keys over the whole house (all hotspots, both floors, the three modes, leaving
// by the door and by z > 15), compared every tick: var 0x5e, the leave / door / icon globals, the camera eye and target, the eased camera and floor index, the door node and matrix,
// the browser (record, focus, state, arrival flag, HUD lines, sounds), the map view (focus, state), Pepper's place. The computer MENU (UI engine, FUN_0053fbc0) is not run on either side:
// the host leaves the computer by setting var 0x5e = 1 after a few ticks (the menu's own exit does that).
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { PphEmu, G, RECORDS_BASE } from '../lib/pph-emu.mjs';
import '../../src/zones/z03PPH.ts';
import { houseOf, REC, PEPPER_CONTROL } from '../../src/zones/z03PPH/house.ts';
import { B } from '../../src/game/input.ts';

const TOL = 0;
export default {
  name: 'm5-audit-z03PPH-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const KEYS = [0, 0, 0, 0, B.SHIFT, B.SHIFT, B.LEFT, B.RIGHT, B.LEFT, B.RIGHT, B.UP, B.DOWN, B.ALT, B.SPACE, B.CTRL, B.ESC, B.ENTER, B.SHIFT | B.LEFT];

    const run = (label, seed, n, dt = 1) => {
      let s = seed >>> 0;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      const L = loadZone(ctx, 'z03PPH');
      const w = L.world, p = L.pepper, recs = w.records;
      w.dt = dt;
      w.focus = p;
      const st = houseOf(w);
      const node = (ri, kind) => recs[ri].ctrl.nodes.find((x) => x.kind === kind);
      const hs = node(REC.PHSE, 'PeppHse'), door = node(REC.DOOR, 'Door'), comp = node(REC.PEPP, 'PeppComp'), br = node(REC.PEPP, 'TrophyBrowser'), mp = node(REC.PEPP, 'MapView');
      // trophy variables: a spread of tiers and scores on both sides
      const tn = [];
      for (let ri = REC.FIRST_TROPHY; ri <= REC.LAST_TROPHY; ri++) tn.push({ ri, n: recs[ri].ctrl.nodes[0] });
      const init = recs.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags }));
      const emu = new PphEmu(pe, init);
      const mem = emu.cpu.mem;
      mem.wf32(0x8b1718, dt);     // DAT_008b1718
      emu.cpu.call(0x53e7c0, []);             // the sound loader: the slots hold the sound ids
      const ehs = emu.construct(0x5408c4, REC.PHSE), edoor = emu.construct(0x540db1, REC.DOOR);
      const attaches = L.setup.attaches;
      for (const { ri } of tn) {
        const a = attaches.find((x) => x.record === ri && (x.ctor === 0x54116c || x.ctor === 0x5413c4));
        emu.setNode(ri, emu.construct(a.ctor, ri, a.argWords ?? []));
      }
      const ebr = emu.construct(0x541b79, REC.PEPP), emp = emu.construct(0x541f94, REC.PEPP), ecomp = emu.alloc(0x40);
      // variables
      let v = 1;
      for (const { n: t } of tn) {
        if (t.trophyVar >= 0) { const val = v++ % 4; w.vars.set(t.trophyVar, val); emu.vars.set(t.trophyVar, val); }
        if (t.hiscoreVar >= 0) { const val = 1000 + 37 * v; w.vars.set(t.hiscoreVar, val); emu.vars.set(t.hiscoreVar, val); }
      }
      w.vars.set(PEPPER_CONTROL, 1); emu.vars.set(PEPPER_CONTROL, 1);
      // the first trophy of the browser is the island's (record 8): its node differs by kind; Pepper's start
      const place = (x, y, z, ry) => {
        p.x = x; p.y = y; p.z = z; p.ry = ry; p.rebuildYaw(); p.savePrev();
        const a = emu.recPtr(p.index) + 0xc;
        for (let k = 0; k < 16; k++) mem.wf32(a + 4 * k, p.m[k]);
        mem.wf32(emu.recPtr(p.index) + 0x50, ry);
      };
      place(-3.75, 0.33, 5.37, 0);
      for (let k = 0; k < 6; k++) { w.camera.c[k] = [10, 5, 3, 0, 0, 0][k]; mem.wf32(G.CAM + 4 * k, [10, 5, 3, 0, 0, 0][k]); }
      let worst = 0, compTicks = 0;
      const stats = { modes: new Set(), leaves: 0, sounds: 0, hotspots: new Set(), browseSteps: 0 };
      const cmpN = (t, name, o, q) => { checked++; const d = Math.abs(o - q); worst = Math.max(worst, d); if (!(d <= TOL * Math.max(1, Math.abs(o))) && failures.length < 12) failures.push(`${label}: tick ${t} ${name}: original ${o} port ${q} (mode ${w.vars.get(PEPPER_CONTROL)})`); };
      const cmpS = (t, name, o, q) => { checked++; if (o !== q && failures.length < 12) failures.push(`${label}: tick ${t} ${name}: original ${JSON.stringify(o)} port ${JSON.stringify(q)}`); };
      for (let t = 0; t < n; t++) {
        const mode = w.vars.get(PEPPER_CONTROL);
        // the player's place / heading changes now and then (walking mode only: other modes do not move Pepper in the house)
        if (mode === 1 && t % 6 === 0) {
          const r = rnd();
          if (r < 0.15) place(-6.5 + (rnd() - 0.5) * 2, 0.96, -6.6 + (rnd() - 0.5) * 2, rnd() * 6 - 3);
          else if (r < 0.3) place(-6 + (rnd() - 0.5) * 3, 0.96, 10 + (rnd() - 0.5) * 3, rnd() < 0.5 ? 0.3 : 3.0);
          else if (r < 0.4) place(-15 + (rnd() - 0.5) * 3, 0.96, 6 + (rnd() - 0.5) * 3, rnd() * 6 - 3);
          else if (r < 0.45) place(-3, 0.5, 14.9 + rnd() * 0.3, rnd() * 6 - 3);
          else place((rnd() - 0.5) * 40, rnd() < 0.2 ? 10 : 0.5, (rnd() - 0.5) * 24, rnd() * 6.28 - 3.14);
        }
        const BROWSE = [B.LEFT, B.RIGHT, B.LEFT];
        const pressed = mode === 2 && rnd() < 0.9 ? (rnd() < 0.06 ? BROWSE[Math.floor(rnd() * 3) % 3] : 0) : rnd() < 0.3 ? KEYS[Math.floor(rnd() * KEYS.length) % KEYS.length] : 0;
        w.input.pressed = pressed; mem.w32(G.KEYS, pressed);
        emu.log = [];
        st.sounds.length = 0;
        const hsLog = st.sounds;
        const pc = w.vars.get(PEPPER_CONTROL);
        // ---- update pass, record order: door (2), PHSE (6), Pepper's active node (33): the gate of Pepper's nodes is read when its record's turn comes (after PHSE wrote var 0x5e)
        door.update(w, recs[REC.DOOR]);
        hs.update(w, recs[REC.PHSE]);
        const pc2 = w.vars.get(PEPPER_CONTROL);
        let active = null, eactive = 0;
        if (pc2 & 4) { active = comp; compTicks++; } else if (pc2 & 2) active = br; else if (pc2 & 0x20) active = mp;
        if (active) active.update(w, recs[REC.PEPP]);
        const cpu = emu.cpu;
        cpu.call(0x540b96, [emu.recPtr(REC.DOOR), edoor]);
        cpu.call(0x54042d, [emu.recPtr(REC.PHSE), ehs]);
        const epc = emu.vars.get(PEPPER_CONTROL);
        if (epc & 4) { cpu.call(0x53ff69, [emu.recPtr(REC.PEPP), ecomp]); eactive = 4; }
        else if (epc & 2) { cpu.call(0x5414b0, [emu.recPtr(REC.PEPP), ebr]); eactive = 2; }
        else if (epc & 0x20) { cpu.call(0x541c98, [emu.recPtr(REC.PEPP), emp]); eactive = 0x20; }
        // ---- pre-render pass: PHSE camera, then Pepper's node camera
        hs.prerender(w, recs[REC.PHSE]);
        if (active && active.prerender) active.prerender(w, recs[REC.PEPP]);
        cpu.call(0x540733, [emu.recPtr(REC.PHSE), ehs]);
        if (eactive === 4) cpu.call(0x53ffa1, [emu.recPtr(REC.PEPP), ecomp]);
        else if (eactive === 2) cpu.call(0x5419dc, [emu.recPtr(REC.PEPP), ebr]);
        else if (eactive === 0x20) cpu.call(0x541e71, [emu.recPtr(REC.PEPP), emp]);
        // ---- compare
        cmpN(t, 'var 0x5e', emu.vars.get(PEPPER_CONTROL), w.vars.get(PEPPER_CONTROL));
        cmpN(t, 'leave', emu.i(G.LEAVE), st.leave ? 1 : 0);
        cmpN(t, 'door wanted', emu.i(G.DOOR), st.doorOpen ? 1 : 0);
        cmpN(t, 'icon', emu.i(G.ICON) | 0, st.icon);
        cmpN(t, 'camIdx', emu.i(ehs + 0xa4), st.camIdx);
        for (let k = 0; k < 3; k++) cmpN(t, `camCur${k}`, emu.f(ehs + 0x98 + 4 * k), st.camCur[k]);
        for (let k = 0; k < 6; k++) cmpN(t, `camera${k}`, emu.f(G.CAM + 4 * k), w.camera.c[k]);
        cmpN(t, 'door state', emu.i(edoor + 0x18), door.state);
        cmpN(t, 'door angle', emu.f(edoor + 0x1c), door.angle);
        for (let k = 0; k < 16; k++) cmpN(t, `door.m${k}`, emu.f(emu.recPtr(REC.DOOR) + 0xc + 4 * k), recs[REC.DOOR].m[k]);
        for (const k of ['x', 'y', 'z']) cmpN(t, `pepper.${k}`, emu.f(emu.recPtr(p.index) + 0xc + 4 * (k === 'x' ? 12 : k === 'y' ? 13 : 14)), p[k]);
        cmpN(t, 'browser record', (emu.i(ebr + 0x18) - RECORDS_BASE) / 0x68, st.trophyIndex);
        cmpN(t, 'browser state', emu.i(ebr + 0x4c) | 0, st.browseState);
        cmpN(t, 'browser moved', emu.i(ebr + 0x54), br.moved ? 1 : 0);
        for (let k = 0; k < 3; k++) cmpN(t, `browseFocus${k}`, emu.f(ebr + 0x1c + 4 * k), st.browseFocus[k]);
        cmpN(t, 'map state', emu.i(emp + 0x54) | 0, st.mapState);
        for (let k = 0; k < 3; k++) cmpN(t, `mapFocus${k}`, emu.f(emp + 0x18 + 4 * k), st.mapFocus[k]);
        cmpS(t, 'line1', mem.cstr(G.T1), st.lines.line1);
        cmpS(t, 'line3', mem.cstr(G.T3), st.lines.line3);
        cmpS(t, `line2 (record ${st.trophyIndex})`, mem.cstr(G.T2), st.lines.line2);
        cmpS(t, 'sounds', emu.log.filter((x) => x.startsWith('snd ')).map((x) => +x.slice(4)).join(','), hsLog.join(','));
        stats.modes.add(pc); stats.hotspots.add(st.lastHotspot); stats.sounds += hsLog.length;
        // ---- the host: leaving the house (the loop would fade out): reset the flag on both; the computer menu ends after a few ticks
        if (st.leave) { stats.leaves++; st.leave = false; mem.w32(G.LEAVE, 0); }
        if (compTicks > 4) { compTicks = 0; w.vars.set(PEPPER_CONTROL, 1); emu.vars.set(PEPPER_CONTROL, 1); }
      }
      notes.push(`${label}: ${n} ticks, worst difference ${worst.toExponential(1)}, modes ${[...stats.modes].sort().join('/')}, hotspots ${[...stats.hotspots].sort().join('')}, ${stats.sounds} trophy sounds, ${stats.leaves} leave requests`);
      return stats;
    };
    for (const seed of [3, 99, 2024]) {
      const st = run(`random${seed}`, seed, 5000);
      checked++; if (!(st.modes.has(1) && st.modes.has(2) && st.modes.has(0x20) && st.modes.has(4)) || st.sounds < 5 || st.leaves < 5) failures.push(`random${seed}: coverage ${[...st.modes]} sounds ${st.sounds} leaves ${st.leaves}`);
    }
    // the same at dt = 0.5 (the 60 Hz step)
    for (const seed of [4, 100]) {
      const st = run(`random${seed} dt0.5`, seed, 5000, 0.5);
      checked++; if (!(st.modes.has(1) && st.modes.has(2)) || st.leaves < 5) failures.push(`random${seed} dt0.5: coverage ${[...st.modes]} sounds ${st.sounds} leaves ${st.leaves}`);
    }
    return { checked, failures, notes };
  },
};
