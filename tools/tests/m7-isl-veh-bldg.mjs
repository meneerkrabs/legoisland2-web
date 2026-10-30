// WP-VERIFY M7 island buildings (building.c): door FUN_00535e80 / update FUN_0053594e, swinging part FUN_005364a5 / FUN_00536256, Constructopedia page FUN_00535281 / FUN_00534d98, music house FUN_005357cb / FUN_00535485 /
// draw FUN_00535550 of src/island/trigger/building.ts against the ORIGINAL's constructors + update / draw hooks run natively in the x86 emulation (tools/lib/m7-isl-veh-trig.mjs). Every building attach of the five eras'
// set-ups (the original's own argument blocks); Pepper scripted around the door points / pages with random PEPPER_CONTROL, Shift presses, cutscenes, record visibility. Compared per tick: the node blocks (state, angle,
// timers, phase), the part matrices (FUN_0043ea60 buffers vs `partMatrix`), all record flags, Pepper's record (the door pushes him), the music house's matrix at draw time, the variables, sounds / emitter calls, cutscene starts.
import { m8Hook, m8Note } from '../lib/m8-d.mjs';
import { trigDuel, trigTick, bldgHooks, setKind } from '../lib/m7-isl-veh-trig.mjs';
import { RECORDS_BASE, REC, lcg } from '../lib/m7-isl-veh-emu.mjs';

const MAXFAIL = 30;
// era 4 (node 0x3f) runs era 0's building blocks (docs/re/m4/emu.md): not repeated
const ERA_NODES = [2, 10, 0x20, 0x36];
const KINDS = { 0x535e80: 'building.door', 0x5364a5: 'building.swing', 0x535281: 'building.page', 0x5357cb: 'building.musichouse' };
const WATCH = [5, 0xc, 0x5e, 0x26, 0xa5, 0xc4, 0x12, 0xa6, 0xb0, 0x58];

export const makeBldgTest = (name, dts, eras) => ({
  name,
  async run(ctx) {
    const failures = [], notes = [], m8Stats = [];
    let checked = 0;
    const cover = { sessions: 0, doors: 0, exitDoors: 0, swings: 0, pages: 0, houses: 0, scenarios: 0, ticks: 0, doorStates: [0, 0, 0, 0], exitWrites: 0, pushes: 0, pickups: 0, pageCutscenes: 0, swingWraps: 0, iconOrs: 0, dead: 0, houseDraws: 0 };
    const devs = new Map();
    for (const [era, node] of ERA_NODES.entries()) for (const dt of dts) {
      if (!eras.includes(era)) continue;
      const d = trigDuel(ctx, { node, dt, bldg: true, keepKinds: ['building', 'building.door', 'building.swing', 'building.page', 'building.musichouse', 'building.popin'], maxFail: MAXFAIL, failures, draw: true });
      d.label = `bldg e${era} dt${dt}`; cover.sessions++;
      m8Stats.push(m8Hook(d, [0x535e80, 0x5364a5, 0x535281, 0x5357cb, 0x534b89], failures, { label: d.label, every: 5, period: 43, hold: 17 }));   // WP-SAVE: save blocks vs the original's serializer / loader during the duel
      bldgHooks(d);
      const W = d.P.world, mem = d.emu.cpu.mem, att = d.O.profile.island.attaches;
      const rnd = lcg(5000 + era * 11 + (dt === 1 ? 0 : 5)), pick = (n) => Math.floor(rnd() * n);
      const pi = d.P.pepper.index;
      let swingRun = false, lastPep = null;
      const pairs = [], seen = new Map();
      for (const a of att) {
        if (!KINDS[a.ctor] && a.ctor !== 0x534b89) continue;
        if (!a.hasController) continue;
        if (a.ctor === 0x534b89) { cover.dead++; continue; }
        const k = `${a.record}:${a.ctor}`, n = seen.get(k) ?? 0; seen.set(k, n + 1);
        const o = d.emu.nodeOf.get(a.record)?.filter((x) => x.ctor === a.ctor)[n]?.ptr;
        const p = W.records[a.record].ctrl?.nodes.filter((x) => x.kind === KINDS[a.ctor])[n];
        if (!o || !p) { failures.push(`${d.label}: no node pair for record ${a.record} (${W.records[a.record].name}) ctor ${a.ctor.toString(16)} #${n} (orig ${!!o}, port ${!!p})`); continue; }
        pairs.push({ a, o, p, rec: a.record, kind: KINDS[a.ctor] });
      }
      const eq = (what, x, y) => { checked++; if (JSON.stringify(x) !== JSON.stringify(y)) d.fail(`${d.label} t${d.t} ${what}: original ${JSON.stringify(x)} port ${JSON.stringify(y)}`); };
      const mcmp = (what, om, pm) => { if (!om || !pm) { eq(`${what} exists`, !!om, !!pm); return; } for (let k = 0; k < 16; k++) d.cmp(what, om[k], pm[k], 1e-5, `[${k}]`, 2e-5); };
      const compareNode = (pr, first) => {
        const n = W.records[pr.rec].name, a = pr.p.a;
        if (pr.kind === 'building.door') {
          if (first && pr.p.init) {
            eq(`${n} door ctor: dead (gate var 1)`, mem.r32(pr.o) === 1, !!pr.p.dead);
            if (!pr.p.dead) {
              for (const [nm, off, v] of [['r2', 0x14, pr.p.r2], ['r2big', 0x18, pr.p.r2big], ['off x', 0x1c, pr.p.off[0]], ['off y', 0x20, pr.p.off[1]], ['off z', 0x24, pr.p.off[2]], ['closed', 0x28, pr.p.closed], ['open', 0x30, pr.p.open]]) d.cmp(`${n} door ctor ${nm}`, mem.f32(pr.o + off), v, 1e-5, '', 1e-4);
              eq(`${n} door ctor: -rate / part / flags / exit`, [Math.fround(mem.f32(pr.o + 0x2c)), mem.r16(pr.o + 0x34), mem.r16(pr.o + 0x36), mem.r32(pr.o + 0x38) | 0], [Math.fround(a.rate), a.part, a.flags, a.exit]);
            }
          }
          if (pr.p.dead) return;
          if (process.env.BLDG_DBG && mem.r32(pr.o + 0x3c) !== pr.p.state && !pr.dbg) { pr.dbg = 1; const r = W.records[pr.rec], pp = d.P.pepper, op = d.emu.cpu.mem; const m = (b) => [0x3c, 0x40, 0x44].map((k) => op.f32(b + k)); console.log('DBG', n, 't', d.t, 'orig state', mem.r32(pr.o + 0x3c), 'port', pr.p.state, 'recM orig', Array.from({ length: 16 }, (_, k) => op.f32(RECORDS_BASE + pr.rec * REC + 0xc + 4 * k)).join(','), 'port rec.m', [...r.m].join(','), 'pep orig', m(RECORDS_BASE + pi * REC), 'pep port', [pp.x, pp.y, pp.z], 'off orig', [0x1c, 0x20, 0x24].map((k) => mem.f32(pr.o + k)), 'port off', pr.p.off, 'r2', mem.f32(pr.o + 0x14), pr.p.r2, 'flags', r.flags.toString(16), mem.r16(RECORDS_BASE + pr.rec * REC + 0x60).toString(16), 'pc', d.getVar(0x5e), 'held/prev'); }
          eq(`${n} door state`, mem.r32(pr.o + 0x3c), pr.p.state);
          d.cmp(`${n} door angle`, mem.f32(pr.o + 0x40), pr.p.angle, 1e-5, '', 2e-5);
          mcmp(`${n} door part ${a.part}`, d.origPart(pr.rec, a.part), d.portPart(pr.rec, a.part));
          cover.doorStates[pr.p.state]++;
        } else if (pr.kind === 'building.swing') {
          if (first && pr.p.init) { eq(`${n} swing ctor dead`, mem.r32(pr.o) === 1, !!pr.p.dead); d.cmp(`${n} swing ctor rate`, mem.f32(pr.o + 0x18), a.rate, 1e-6, '', 1e-6); d.cmp(`${n} swing ctor from`, mem.f32(pr.o + 0x14), a.from, 1e-6, '', 1e-6); d.cmp(`${n} swing ctor to`, mem.f32(pr.o + 0x1c), a.to, 1e-6, '', 1e-6); eq(`${n} swing ctor part / flags`, [mem.r16(pr.o + 0x20), mem.r16(pr.o + 0x22)], [a.part, a.flags]); }
          if (pr.p.dead) return;
          eq(`${n} swing state`, mem.r32(pr.o + 0x24), pr.p.state);
          d.cmp(`${n} swing angle`, mem.f32(pr.o + 0x28), pr.p.angle, 1e-5, '', 2e-5);
          mcmp(`${n} swing part ${a.part}`, d.origPart(pr.rec, a.part), d.portPart(pr.rec, a.part));
        } else if (pr.kind === 'building.page') {
          eq(`${n} page done`, mem.r8(pr.o + 0x20) !== 0, pr.p.done);
          d.cmp(`${n} page timer`, mem.f32(pr.o + 0x24), pr.p.timer, 1e-6, '', 1e-6);
        } else {
          d.cmp(`${n} house phase`, mem.f32(pr.o + 0x60), pr.p.phase, 1e-5, '', 1e-5);
        }
      };
      const flagsAll = () => { if (d.t % 4 !== 0) return; for (let r = 0; r < W.records.length; r++) { const ov = mem.r16(RECORDS_BASE + r * REC + 0x60) & 0xfffe, pv = W.records[r].flags & 0xfffe; checked++; if (ov !== pv) d.fail(`${d.label} t${d.t} record ${r} (${W.records[r].name}) flags original ${ov.toString(16)} port ${pv.toString(16)}`); } };
      // the long-running accumulators (the swinging parts' angle, the house's phase) are float32 in the original and double in the port: their free-running difference is rounding noise (n * half an ulp), not logic;
      // they are copied from the original into the port before every tick (the per-tick step is then compared strictly); doors (short scenarios, clamped angle) and pages run free
      const syncAcc = () => { for (const pr of pairs) { if (pr.kind === 'building.swing' && pr.p.init && !pr.p.dead) pr.p.angle = mem.f32(pr.o + 0x28); else if (pr.kind === 'building.musichouse') pr.p.phase = mem.f32(pr.o + 0x60); } };
      // a door test that grazes a threshold (squared distance within float noise of a radius) decides differently in float32 and in double: the first tick with differences is taken back and the door's state / angle re-synced (see Duel.grazeEnd)
      d.syncPort = () => { d.recToPort(pi); for (const pr of pairs) if (pr.kind === 'building.door' && !pr.p.dead) { pr.p.state = mem.r32(pr.o + 0x3c); pr.p.angle = mem.f32(pr.o + 0x40); } };
      const step = (held, first = false) => {
        if (!first) syncAcc();
        // the renderer's frustum test (FUN_00444370) sets record flag bit 0: the draw pass only calls the draw hook of records in view
        for (const pr of pairs) if (pr.kind === 'building.musichouse') { const a = RECORDS_BASE + pr.rec * REC + 0x60; mem.w16(a, mem.r16(a) | 1); }
        const gm = d.grazeBegin();
        const { o, p } = trigTick(d, held); cover.ticks++;
        for (const w of d.emu.varWrites) { if (/^set 5 /.test(w)) cover.exitWrites++; else if (/^or 12 32$/.test(w)) cover.iconOrs++; else if (w === 'add 165 1') cover.pickups++; }
        cover.pageCutscenes += o.filter((l) => l.startsWith('cs')).length;
        if (lastPep && (Math.abs(d.P.pepper.x - lastPep[0]) > 1e-6 || Math.abs(d.P.pepper.z - lastPep[1]) > 1e-6)) { cover.pushes++; lastPep = [d.P.pepper.x, d.P.pepper.z]; }
        eq('cutscene starts', o, p); eq('cutscene active', !!d.emu.cutscene, d.P.ictx.cutsceneActive());
        if (d.t % 7 === 0) d.vars(); else for (const i of WATCH) { checked++; const ov = mem.r32(0x8a2d2c + 4 * i), pv = W.vars.get(i) | 0; if (ov !== pv) d.fail(`${d.label} t${d.t} var ${i}: original ${ov} port ${pv}`); }
        d.sounds();
        for (const pr of pairs) compareNode(pr, first);
        flagsAll();
        if (process.env.BLDG_DBG && Math.abs(mem.f32(RECORDS_BASE + pi * REC + 0x3c) - W.records[pi].m[12]) > 1e-3 && !globalThis.__dbgp) {
          globalThis.__dbgp = 1;
          for (const pr of pairs) if (pr.kind === 'building.door' && !pr.p.dead) {
            const r = W.records[pr.rec], p0 = r.toWorld(pr.p.off), pp = W.records[pi];
            const dx = pp.x - p0[0], dy = pp.y - p0[1], dz = pp.z - p0[2], d2 = dx * dx + dz * dz;
            if (d2 < 30) console.log('DBGP', r.name, 'state o/p', mem.r32(pr.o + 0x3c), pr.p.state, 'exit', pr.p.a.exit, 'd2', d2, 'dy', dy, 'r2', pr.p.r2, 'flags', r.flags.toString(16), 'pep o', mem.f32(RECORDS_BASE + pi * REC + 0x3c), 'p', pp.x, 'held', d.prevHeld, 'pc', d.getVar(0x5e));
          }
        }
        d.rec(pi, 0xfffe);
        // the music house's bounce lives during the draw
        for (const pr of pairs) if (pr.kind === 'building.musichouse' && W.records[pr.rec].enabled) { const om = d.emu.drawM.get(pr.rec), pm = W.records[pr.rec].m; if (om) { cover.houseDraws++; mcmp(`${W.records[pr.rec].name} house matrix at draw`, om, pm); } }
        d.emu.drawM.clear();
        // only a door whose state / angle differs (or Pepper's pushed position: the push repeats until Pepper's distance passes sqrt(16) = 4, where one 0.1 step more or less is decided by float noise) from the original's can be a threshold graze; any other mismatch stays a failure
        if (Math.abs(mem.f32(RECORDS_BASE + pi * REC + 0x3c) - W.records[pi].m[12]) > 1e-3 || Math.abs(mem.f32(RECORDS_BASE + pi * REC + 0x44) - W.records[pi].m[14]) > 1e-3 || pairs.some((pr) => pr.kind === 'building.door' && !pr.p.dead && (mem.r32(pr.o + 0x3c) !== pr.p.state || Math.abs(mem.f32(pr.o + 0x40) - pr.p.angle) > 1e-4))) d.grazeEnd(gm);
      };
      const setFlags = (i, on) => { for (const r of [W.records[i]]) r.flags = on ? (r.flags | 2) : (r.flags & ~2); const v = mem.r16(RECORDS_BASE + i * REC + 0x60); mem.w16(RECORDS_BASE + i * REC + 0x60, on ? v | 2 : v & ~2); };
      d.placePepper(0, 30, 0, 0); d.setVar(0x5e, 1);
      for (const pr of pairs) setFlags(pr.rec, true);
      step(0, true);
      for (let t = 0; t < 4; t++) step(0);
      const pepAt = (x, y, z) => { lastPep = [Math.fround(x), Math.fround(z)]; d.placePepper(Math.fround(x), Math.fround(y), Math.fround(z), 0); };
      const PC = [1, 1, 1, 0x401, 4, 2, 5, 0, 0x11];
      for (const pr of pairs) {
        const r = W.records[pr.rec], a = pr.p.a;
        if (pr.kind === 'building.swing') {
          cover.swings++;
          // (all swinging parts run together in the one world: one long run covers every one of them)
          if (!swingRun) { swingRun = true; for (let t = 0; t < Math.ceil(180 / dt); t++) step(0); }
          continue;
        }
        if (pr.kind === 'building.musichouse') {
          cover.houses++;
          for (let sc = 0; sc < 3; sc++) { setFlags(pr.rec, sc !== 1); for (let t = 0; t < Math.ceil(40 / dt); t++) step(0); }
          setFlags(pr.rec, true);
          continue;
        }
        if (pr.kind === 'building.page') {
          cover.pages++;
          // pages: gate var PAGES_SET (0x26) bit clear = not collected; Pepper walks onto the page
          for (let sc = 0; sc < 4; sc++) {
            cover.scenarios++;
            d.setVar(0xc4, ['PAG1', 'PAG2', 'PAG3', 'PAG4'].indexOf(r.name));   // the story picks the pages up in order: the counter indexes the cutscene slot table (0x5d586c4)
            if (sc === 3) { d.setVar(0x26, d.getVar(0x26) | pr.p.pageMask); } else d.setVar(0x26, d.getVar(0x26) & ~pr.p.pageMask);
            setFlags(pr.rec, true);
            d.setVar(0x5e, [1, 0x401, 1, 4][sc]); setKind(d, -1);
            const near = [0.5, 3, 1.4, 0.2][sc];
            pepAt(r.x + near * (sc === 1 ? 1.2 : 1), r.y + [0, 1, 3.4, 2.4][sc], r.z);
            for (let t = 0; t < Math.ceil(60 / dt); t++) { step(0); }
            // (the pickup: the NUM_PAGES / PAGECOUNTER writes and the delayed cutscene are in the compared variables / logs)
            // reset the node for the next scenario
            mem.w8(pr.o + 0x20, 0); mem.wf32(pr.o + 0x24, 0); pr.p.done = false; pr.p.timer = 0;
            d.setVar(0x26, d.getVar(0x26) & ~pr.p.pageMask);
          }
          continue;
        }
        // doors
        cover.doors++; if (a.exit >= 0) cover.exitDoors++;
        if (pr.p.dead) continue;
        for (let sc = 0; sc < (dt === 1 ? 4 : 3); sc++) {
          cover.scenarios++;
          const p0 = r.toWorld(pr.p.off), rad = Math.sqrt(pr.p.r2);
          d.setVar(0x5e, PC[pick(PC.length)]); d.setVar(0xc, 0);
          setFlags(pr.rec, sc !== 2);
          const f = [0.3, 0.985, 0.8, 0.6, 1.3, 0.6, 2.5][sc], ang = rnd() * 6.283, dy = [0, 0, 2, 0, 5, 0, 0][sc];
          pepAt(p0[0] + Math.cos(ang) * rad * f, p0[1] + dy, p0[2] + Math.sin(ang) * rad * f);
          let hp = 0;
          for (let t = 0; t < (dt === 1 ? 48 : 64); t++) {
            let held = 0;
            if (rnd() < 0.12 && hp === 0) held = 0x40;
            hp = held;
            if (t % 23 === 11) { d.cutscene(true); } else if (t % 23 === 14) d.cutscene(false);
            // Pepper walks a little towards / around the door point
            if (t % 5 === 0 && sc >= 3) pepAt(p0[0] + Math.cos(ang + t * 0.1) * rad * (f * (1 - t / 140)), p0[1] + dy, p0[2] + Math.sin(ang + t * 0.1) * rad * (f * (1 - t / 140)));
            step(held);
          }
          d.cutscene(false); d.csLeft = 0; d.emu.cutscene = false; d.P.ictx.cutsceneLeft = 0;
        }
      }
      if (d.grazes) { cover.grazes = (cover.grazes ?? 0) + d.grazes.length; notes.push(`e${era} dt${dt}: ${d.grazes.length} threshold-graze divergence(s) (float32 original vs double port, re-synced): ${d.grazes.map((g) => g.slice(0, 110)).join(' ; ')}`); }
      checked += d.checked;
      notes.push(`e${era} dt${dt}: ${pairs.length} building nodes (${pairs.filter((x) => x.kind === 'building.door').length} doors, ${pairs.filter((x) => x.kind === 'building.swing').length} swing, ${pairs.filter((x) => x.kind === 'building.page').length} pages, ${pairs.filter((x) => x.kind === 'building.musichouse').length} house); worst ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    for (const st of m8Stats) notes.push(m8Note(st));
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
});

export default makeBldgTest('m7-isl-veh-bldg', [1], [0, 1, 2, 3]);
