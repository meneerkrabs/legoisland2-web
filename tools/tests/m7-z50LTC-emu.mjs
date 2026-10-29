import { loadZone } from '../lib/engine-load.mjs';
import { buildLtc, ltc, PORTAL_ARGS } from '../../src/zones/z50LTC.ts';
import { persisted, LtcGlobals } from '../../src/zones/z50LTC/people.ts';
import { PortalNode } from '../../src/zones/z50LTC/portal.ts';
import { createHarness, makeRng, f32, ADDR } from '../lib/m7-z50LTC-emu.mjs';

// z50LTC, differential test (WP-VERIFY, docs/re/m3/z50LTC.md): the ORIGINAL code of the "Meet the team" cave runs in the x86 emulation next to the port, tick by tick, from the
// port's state (tools/lib/m7-z50LTC-emu.mjs): People update FUN_00839e20 / pre-render FUN_0083a292, pepswitc FUN_0083a9e0 / 0083aa48 / 0083aa8d, the box portal FUN_0051e5ab and its
// constructor FUN_0051ea3c (all argument variants: key mask, icon, variable bits, the record table DAT_05d58688), the constructors FUN_0083a7d2 / 0083ab7b, the slope alignment FUN_00429e00 of
// the talk start (over the port's collision world). Compared each tick: all 62 records (matrix, Euler, flags), the animation of Pepper and the people, every node field, the room's globals
// (toggle, timer, candidate, candidate distance, text slots, bars), all game variables, and the ordered log of the sounds / twinkles / hand emitters.

const TOL = process.env.M7_TOL !== undefined ? +process.env.M7_TOL : 0;
const MAXFAIL = process.env.MAXFAIL ? +process.env.MAXFAIL : 40;

export default {
  name: 'm7-z50LTC-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const known = new Map();
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const dev = (key, msg) => { const k = known.get(key); if (k) k.count++; else known.set(key, { count: 1, first: msg }); };
    const close = (a, b, tol = TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
    const stats = { portalRets: new Set(), ticks: 0, talks: 0, swaps: 0, pushes: 0, returns: 0, portalFires: 0, falls: 0, types: new Set(), clips: new Set(), appear: 0, vanish: 0, snd: 0, branches: {} };
    const press = (w, mask) => { const i = w.input; i.prevHeld = i.held; i.held = mask; i.pressed = (mask ^ i.prevHeld) & mask; };
    const SHIFT = 0x40;
    const lcgRnd = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; };

    const make = (seed, dt = 1, toggle = 0) => {
      persisted.toggle = toggle;
      const L = loadZone(ctx, 'z50LTC');
      const w = L.world;
      const room = buildLtc(w, L, L.pe);
      const g = room.g;
      w.externalInput = true; w.dt = dt;
      const p = L.pepper;
      // Pepper's chain: the zone's pepswitc only (the walk node SGwalk is represented by its first action in the original's pass; the scenarios place Pepper by script); the walk node stays
      // reachable for the slope alignment hook of the talk start (g.alignPepper = alignToGround, as the zone game wires it)
      const walker = p.ctrl.nodes.find((n) => typeof n.alignToGround === 'function');
      p.ctrl.nodes = p.ctrl.nodes.filter((n) => n.kind === 'pepswitc');
      if (walker) g.alignPepper = (ww, rec) => walker.alignToGround(ww, rec);
      const plog = [];
      g.onTwinkle = (rec, start) => plog.push(['twinkle', rec.index, start]);
      g.onPaul = (rec, start) => plog.push(['paul', rec.index, start]);
      g.playSound = (id) => plog.push(['snd', id, f32(p.x), f32(p.y), f32(p.z)]);
      const H = createHarness(ctx, w);
      if (room.portal) H.portalCtor(w.records[53], room.portal.a, room.portal);
      return { L, w, room, g, p, H, plog, dt, label: '', t: 0, rnd: lcgRnd(seed) };
    };

    const compareTick = (E, orig, label) => {
      const { w, g, H, plog } = E;
      const ck = (c, msg) => { checked++; if (!c) bad(`${label}: ${msg}`); };
      const cn = (a, b, msg, key) => { checked++; if (!close(a, b)) { if (key && E.known?.[key]) dev(key, `${label}: ${msg}: port ${a}, original ${b}`); else bad(`${label}: ${msg}: port ${a}, original ${b}`); } };
      const mine = H.tsRecs();
      for (let i = 0; i < mine.length; i++) {
        const a = mine[i], b = orig.recs[i], r = w.records[i];
        ck(a.flags === b.flags, `record ${i} ${r.name} flags port ${a.flags.toString(16)}, original ${b.flags.toString(16)}`);
        for (let k = 0; k < 16; k++) cn(a.m[k], b.m[k], `record ${i} ${r.name} m[${k}]`, `rec.${r.name}`);
        for (let k = 0; k < 3; k++) cn(a.e[k], b.e[k], `record ${i} ${r.name} euler[${k}]`, `rec.euler.${r.name}`);
        if (r.anim && orig.anims[i]) {
          ck(r.anim.clip === orig.anims[i][0], `record ${i} ${r.name} clip port ${r.anim.clip}, original ${orig.anims[i][0]}`);
          cn(r.anim.frame, orig.anims[i][1], `record ${i} ${r.name} frame`);
        }
      }
      const mn = H.tsNodes();
      ck(mn.length === orig.nodes.length, 'node count');
      mn.forEach(([ri, kind, a], q) => {
        const b = orig.nodes[q][2];
        for (const k of Object.keys(b)) {
          if (Array.isArray(b[k])) b[k].forEach((v, i) => cn(a[k][i], v, `${w.records[ri].name} ${kind}.${k}[${i}]`, `${kind}.${k}`));
          else cn(a[k], b[k], `${w.records[ri].name} ${kind}.${k}`, `${kind}.${k}`);
        }
      });
      // the room's globals
      const ga = { toggle: g.toggle, timer: g.timer, candidate: g.candidate ? g.candidate.entry.record : -1, candDist: g.candDist, name: g.name, role: g.role, letterbox: g.letterbox }, gb = orig.globals;
      ck(ga.toggle === gb.toggle, `toggle port ${ga.toggle}, original ${gb.toggle}`);
      cn(ga.timer, gb.timer, 'timer'); ck(ga.candidate === gb.candidate, `candidate port ${ga.candidate}, original ${gb.candidate}`); cn(ga.candDist, gb.candDist, 'candDist');
      ck(ga.name === gb.name && ga.role === gb.role, `text slots port "${ga.name}" / "${ga.role}", original "${gb.name}" / "${gb.role}"`);
      ck(ga.letterbox === gb.letterbox, `bars port ${ga.letterbox}, original ${gb.letterbox}`);
      // all game variables
      for (let i = 0; i < w.vars.a.length; i++) { if (i === 1 || i === 2) continue; if ((w.vars.a[i] | 0) !== (orig.vars[i] | 0)) { ck(false, `variable 0x${i.toString(16)} port ${w.vars.a[i]}, original ${orig.vars[i]}`); break; } }
      checked++;
      // sounds / twinkles / hand emitters in order
      // Paul Scully has two hand emitters (+0x1c / +0x20): the original starts / stops both, the port's hook stands for the pair
      const o = [];
      for (const e of orig.log) {
        if (e[0] === 'bars') continue;
        if (e[0] === 'paul') { const last = o[o.length - 1]; if (last && last[0] === 'paul' && last[1] === e[1] && last[2] === e[2] && !last.pair) { last.pair = true; continue; } o.push(Object.assign([...e], { pair: false })); ck(true, ''); continue; }
        o.push(e);
      }
      for (const e of o) if (e[0] === 'paul') ck(e.pair === true, `the hand emitters of record ${e[1]} start / stop as a pair`);
      const same = o.length === plog.length && o.every((e, i) => e[0] === plog[i][0] && e.slice(1).every((v, q) => (typeof v === 'number' && typeof plog[i][q + 1] === 'number' ? close(plog[i][q + 1], v, 1e-4) : v === plog[i][q + 1])));
      if (!same) bad(`${label}: events: port ${JSON.stringify(plog)} original ${JSON.stringify(o)}`);
      // coverage
      for (const e of o) { if (e[0] === 'snd') stats.snd++; if (e[0] === 'twinkle') (e[2] ? stats.appear++ : stats.vanish++); }
    };

    /** one tick: the original from the state, then the port (the world tick + the zone game's pepswitc draw hook), then compare */
    const step = (E, mask, label) => {
      const { w, H, g } = E;
      press(w, mask);
      let orig;
      try { orig = H.pass(g, w.input.pressed, E.dt); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); return false; }
      for (const v of H.portalRets ?? []) stats.portalRets.add(v);
      E.plog.length = 0;
      const talksBefore = g.talks;
      w.tick();
      E.room.pep?.draw(w, E.p, E.p.ctrl);
      E.talkStarted = g.talks > talksBefore;
      stats.ticks++;
      compareTick(E, orig, label);
      return failures.length <= MAXFAIL;
    };

    const talking = (E) => E.room.people.filter((q) => q.talk > 0);

    /** a scripted visit: teleports next to people, Shift presses at random moments, long idle stretches */
    const visit = (E, ticks, label) => {
      const { w, p, rnd, room } = E;
      const people = room.people;
      const switchers = people.filter((q) => q.entry.cond === -1);
      let n = 0;
      const run = (k, mask = 0) => { for (let i = 0; i < k && n < ticks; i++, n++) { const talkBefore = talking(E).map((q) => q.entry.name).join(); if (!step(E, i === 0 ? mask : (rnd() < 0.02 ? SHIFT : 0), `${label} t${n}`)) return false; const after = talking(E).map((q) => q.entry.name).join(); if (talkBefore !== after) { if (after) { stats.talks++; for (const q of talking(E)) { stats.types.add(q.entry.type); stats.clips.add(q.entry.talkClip); } } } } return true; };
      while (n < ticks) {
        const a = rnd();
        const q = (rnd() < 0.3 ? switchers : people)[Math.floor(rnd() * (rnd() < 0.3 ? switchers.length : people.length))] ?? people[0];
        const r = w.records[q.entry.record];
        if (a < 0.7) {
          const d = rnd() < 0.5 ? 0.3 + rnd() * 1.5 : 1 + rnd() * 6, ang = rnd() * 6.28;
          p.x = r.x + Math.sin(ang) * d; p.z = r.z + Math.cos(ang) * d; p.y = r.y + 0.3 + rnd(); p.savePrev();
        } else if (a < 0.8) { const d = 20 + rnd() * 30, ang = rnd() * 6.28; p.x = r.x + Math.sin(ang) * d; p.z = r.z + Math.cos(ang) * d; p.savePrev(); }
        else if (a < 0.85) { p.y = -100 - rnd() * 20; stats.falls++; }
        if (!run(Math.floor(rnd() * 4))) return false;
        if (!run(1, rnd() < 0.85 ? SHIFT : 0)) return false;
        const k = rnd() < 0.5 ? Math.floor(rnd() * 30) : Math.floor(rnd() * 160);
        if (!run(k)) return false;
        if (rnd() < 0.3 && !run(1, SHIFT)) return false;
        if (toggleChanged(E)) stats.swaps++;
      }
      return true;
    };
    const toggleChanged = (E) => { const c = E.lastToggle !== undefined && E.lastToggle !== E.g.toggle; E.lastToggle = E.g.toggle; return c; };

    try {
      const t0 = Date.now();
      // ---- 0. the constructors: People (ground snap, idle clip), pepswitc (home), the portal block of the zone
      {
        const E = make(1);
        const { w, H, room, g, L, p } = E;
        const mem = H.mem;
        const ck = (c, msg) => { checked++; if (!c) bad(`ctor: ${msg}`); };
        const cn = (a, b, msg) => { checked++; if (!close(a, b)) bad(`ctor: ${msg}: port ${a}, original ${b}`); };
        // the records as the set-up leaves them before the constructors run (scene positions; RICH moved 8 along x first), then the original constructor of every person
        const saved = w.records.map((r) => ({ m: Float32Array.from(r.m), flags: r.flags }));
        H.mirrorRecords();
        for (const q of room.people) {
          const r = w.records[q.entry.record], sc = L.scene.records[q.entry.record];
          const rp = H.recPtr(r);
          mem.wf32(rp + 0x3c, sc.pos[0] + (q.entry.record === 28 ? 8 : 0)); mem.wf32(rp + 0x40, sc.pos[1]); mem.wf32(rp + 0x44, sc.pos[2]);
          const np = H.nodePtr(r);
          for (let o = 0; o < 0x100; o += 4) mem.w32(np + o, 0);
        }
        // the argument words (a pointer to the row index) per person
        let n = 0;
        for (const q of room.people) {
          const r = w.records[q.entry.record], rp = H.recPtr(r), np = H.nodePtr(r);
          const ap = 0x35000000 + 0x9000 + 4 * q.index;
          mem.w32(ap, q.index);
          H.cpu.steps = 0;
          H.cpu.call(0x83a7d2, [rp, ap, np, 2, 0, 0], { maxSteps: 1e6 });
          ck(mem.r32(np + 0x14) === q.index && mem.r8(np + 0x24) === 0, `${r.name} node row / pushed`);
          const sv = saved[r.index].m;
          cn(sv[12], mem.f32(rp + 0x3c), `${r.name} x after the ground snap`); cn(sv[13], mem.f32(rp + 0x40), `${r.name} y after the ground snap`); cn(sv[14], mem.f32(rp + 0x44), `${r.name} z after the ground snap`);
          ck(r.anim.clip === mem.r32(0x33000000 + r.index * 0x40 + 0xc), `${r.name} idle clip port ${r.anim.clip}, original ${mem.r32(0x33000000 + r.index * 0x40 + 0xc)}`);
          n++;
        }
        w.records.forEach((r, i) => { r.m.set(saved[i].m); r.flags = saved[i].flags; });
        // pepswitc: the home = the record's position at the constructor
        const pp = H.nodePtr(p), prec = H.recPtr(p);
        const home0 = [p.x, p.y, p.z];
        for (let o = 0; o < 0x100; o += 4) mem.w32(pp + o, 0);
        H.cpu.call(0x83ab7b, [prec, 0, pp, 94, 0, 0]);
        const oh = [0, 1, 2].map((i) => mem.f32(pp + 0x14 + 4 * i));
        // the port takes it at the first update (Pepper still at its set-up position)
        E.w.input.pressed = 0; E.w.tick(); E.room.pep.draw(w, p, p.ctrl);
        for (let i = 0; i < 3; i++) cn(room.pep.home[i], oh[i], `pepswitc home[${i}]`);
        ck(room.pep.home.every((v, i) => close(v, home0[i])), 'Pepper had not moved before the first update');
        // the portal block of the zone through the original constructor: radius^2, flags, defaults
        const por = w.records[53], pn = room.portal;
        const pc = H.portalCtor(por, PORTAL_ARGS, pn);
        cn(pc.radius2, pn.radius2, 'portal radius^2'); ck(pc.target === 2 && pc.face === 1 && pc.spin === 1 && pc.keyMask === 0 && pc.icon === 0 && pc.table === 0, `portal block ${JSON.stringify(pc)}`);
        // the process globals as the image holds them before anything ran (the port's LtcGlobals.reset values)
        { const mm = H.mem; ck(mm.r32(0x5d5f6dc) === 0 && mm.f32(0x5d5f6e0) === 0, 'toggle 0, timer 0 initially'); cn(new LtcGlobals().candDist, mm.f32(0x8ae330), 'candidate distance initial value (.data of DAT_008ae330)'); ck(mm.u32(0x9daa80) === 0, 'candidate none initially'); }
        notes.push(`constructors: ${n} People + pepswitc + the portal block checked`);
      }

      // ---- 1. a visit from the start: the sets appear / vanish (timer, twinkles), no input
      { const E = make(2); for (let i = 0; i < 150; i++) if (!step(E, 0, `idle t${i}`)) break; notes.push(`idle start: ${stats.appear} appear / ${stats.vanish} vanish events`); }
      // ---- 2. scripted visits (teleports next to people, Shift at random moments), dt = 1, several seeds
      for (let sd = 0; sd < 5; sd++) { const E = make(10 + sd); visit(E, 2600, `visit${sd}`); notes.push(`visit${sd}: ${E.g.talks} talks, toggle ${E.g.toggle}`); }
      // ---- 3. the room entered with the other half of the team (the toggle kept from an earlier visit)
      { const E = make(30, 1, 1); visit(E, 1500, 'toggle1'); }
      stats.dt1 = stats.ticks;
      // ---- 4. dt = 0.5
      for (let sd = 0; sd < 2; sd++) { const E = make(40 + sd, 0.5); visit(E, 2500, `dt0.5 visit${sd}`); }

      // ---- 5. the wormhole PORC (record 53): the zone's own block, Pepper around the box; the camera moves (the portal turns to it)
      const portalRun = (E, ticks, label, o = {}) => {
        const { w, p, rnd } = E;
        const por = w.records[53];
        const half = o.half ?? [16, 24, 16];
        const masks = o.masks ?? [0, 0, 0, 0x40, 0x80, 0x10];
        for (let i = 0; i < ticks; i++) {
          if (i % 9 === 0) {
            // Pepper: inside the box, at its rim, outside the radius; approaching or leaving
            const k = rnd(), s = k < 0.5 ? 0.9 : k < 0.8 ? 1.3 : 2.5;
            p.x = por.x + (rnd() * 2 - 1) * half[0] * s; p.y = por.y + (rnd() * 2 - 1) * half[1] * s; p.z = por.z + (rnd() * 2 - 1) * half[2] * s; p.savePrev();
            for (let q = 0; q < 3; q++) w.camera.c[q] = por.m[12 + q] + (rnd() * 2 - 1) * 60;
            for (const r of o.moving ?? []) { r.x = p.x + (rnd() * 2 - 1) * 20; r.y = p.y + (rnd() * 2 - 1) * 20; r.z = p.z + (rnd() * 2 - 1) * 20; }
          } else if (i % 3 === 0) { p.x += (rnd() - 0.5) * 3; p.z += (rnd() - 0.5) * 3; p.savePrev(); }
          if (rnd() < 0.05) for (const r of o.moving ?? []) { r.x += (rnd() - 0.5) * 4; r.z += (rnd() - 0.5) * 4; }
          const mask = masks[Math.floor(rnd() * masks.length)];
          if (!step(E, mask, `${label} t${i}`)) return false;
          if (w.vars.get(5) !== 0) { stats.portalFires++; w.vars.set(5, 0); }
          if (w.vars.get(0xbb) !== 0 && o.table) stats.tableHits = (stats.tableHits ?? 0) + 1;
        }
        return true;
      };
      for (let sd = 0; sd < 2; sd++) { const E = make(50 + sd, sd ? 0.5 : 1); portalRun(E, 900, `portal${sd}`); }
      // ---- 6. the portal node with every argument variant of the original constructor (key mask, icon, variable bits, target, spin / face flags, the record table DAT_05d58688)
      {
        const rnd0 = lcgRnd(777);
        const pick = (a) => a[Math.floor(rnd0() * a.length)];
        const variants = [];
        for (let v = 0; v < 12; v++) {
          variants.push({
            half: [pick([4, 8, 16, 30]), pick([4, 24, 40]), pick([4, 16, 30])], orVar: pick([0, 0x70, 0x71]), orBits: pick([0, 1, 4, 0x20]), table: pick([0, 0, 1, 2]), target: pick([0, 2, 5, 34]),
            faceCamera: rnd0() < 0.6, spin: rnd0() < 0.6, keyMask: pick([0, 0, 0x40, 0x80, 0x90]), iconBits: pick([0, 0, 1, 4, 8]),
          });
        }
        let vi = 0;
        for (const args of variants) {
          const E = make(60 + vi, vi % 3 === 2 ? 0.5 : 1), { w, H } = E;
          const por = w.records[53];
          // the table: rows of three records (the people have controllers: their distance to Pepper is the test)
          const cand = E.room.people.map((q) => w.records[q.entry.record]);
          const rows = [0, 1].map(() => [0, 1, 2].map(() => (rnd0() < 0.85 ? cand[Math.floor(rnd0() * cand.length)] : null)));
          const node = new PortalNode(args, rows);
          node.var = 2; node.mask = 1; node.value = 1;
          por.ctrl.nodes.splice(0, por.ctrl.nodes.length, node);       // in place: the harness holds the list
          const pc = H.portalCtor(por, args, node);
          checked += 8;
          const same = close(pc.radius2, node.radius2) && pc.icon === node.icon && pc.table === args.table && pc.target === args.target && pc.face === (args.faceCamera ? 1 : 0) && pc.spin === (args.spin ? 1 : 0) && pc.keyMask === args.keyMask && pc.orVar === args.orVar && pc.orBits === args.orBits && pc.half.every((v, i) => v === args.half[i]);
          if (!same) bad(`portal variant ${vi} constructor: original ${JSON.stringify(pc)}, port radius2 ${node.radius2} icon ${node.icon}`);
          H.setPortalTable(rows);
          const mv = [...new Set(rows.flat().filter(Boolean))];
          portalRun(E, 500, `variant${vi}`, { half: args.half, table: args.table > 0, moving: args.table > 0 ? mv : [], masks: args.keyMask ? [0, args.keyMask, args.keyMask, 0xff, 0x40, 0x80, 0x10] : [0, 0, 0x40] });
          vi++;
        }
        notes.push(`portal variants: ${vi}, table-variant hits of var 0xbb: ${stats.tableHits ?? 0}, portal firings: ${stats.portalFires}`);
      }
      notes.push(`dt=1: ${stats.dt1} ticks, dt=0.5: ${stats.ticks - stats.dt1} ticks in ${Date.now() - t0} ms`);
    } catch (e) {
      bad(`test crashed: ${e.stack || e}`);
    }
    checked++; if ([...stats.portalRets].some((v) => v !== 0)) bad(`the portal update returned ${[...stats.portalRets]} (the port returns 0: the node never counts as having run)`);
    notes.push(`coverage: talks ${stats.talks} (person types ${[...stats.types].sort()}, ${stats.clips.size} different talk clips), set swaps ${stats.swaps}, falls ${stats.falls}, sounds ${stats.snd}`);
    for (const [k, v] of known) notes.push(`KNOWN DEVIATION ${k}: ${v.count} x, first ${v.first}`);
    return { checked, failures, notes };
  },
};
