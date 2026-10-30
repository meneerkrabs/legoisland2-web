// WP-VERIFY M7 island triggers: StartCSM trigger (FUN_0051e19c / update FUN_0051dd7e) and box portal (FUN_0051ea3c / FUN_0051e5ab) of src/island/trigger/startcsm.ts against the ORIGINAL's constructors and
// update code run natively in the x86 emulation (tools/lib/m7-isl-veh-trig.mjs): every attach of the five eras' set-ups (the original's own argument blocks), Pepper scripted around the waypoints / the portal boxes with
// random PEPPER_CONTROL, vehicle kinds, buttons, clips, cutscene lengths, gate variables; per tick compared: all game variables, the cutscene starts (FUN_0045c40c slot) and walker pins (FUN_004625d7 node), the node
// fields (slot / armed / nearest, portal distance memory / age), the portal records' matrix / Euler angles / flags.
import { m8Hook, m8Note } from '../lib/m8-d.mjs';
import { trigDuel, trigTick, setKind, setClip, lcg } from '../lib/m7-isl-veh-trig.mjs';
import { RECORDS_BASE, REC } from '../lib/m7-isl-veh-emu.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';

const MAXFAIL = 30;
const WATCH = [5, 0xc, 0x5e, 0xbb, 0x12, 0xa6, 0xb0, 0x51, 0x54, 0x58, 0x115, 0x119, 0x12f, 0x0d, 0x4f, 0xa5];
const ERA_NODES = [2, 10, 0x20, 0x36, 0x3f];
const CTOR_CSM = 0x51e19c, CTOR_PORTAL = 0x51ea3c;

export const makeTrigTest = (name, dts, eras) => ({
  name,
  async run(ctx) {
    const failures = [], notes = [], m8Stats = [];
    let checked = 0;
    const cover = { sessions: 0, scenarios: 0, ticks: 0, triggers: 0, portals: 0, csStarts: 0, pins: 0, opApplied: 0, zoneSets: 0, controlSets: 0, iconOrs: 0, walkRequests: 0, synthetic: 0 };
    const devs = new Map();
    const dev = (id, d, detail) => { const e = devs.get(id); if (e) e.count++; else devs.set(id, { count: 1, first: `t${d.t} ${detail}` }); };

    for (const [era, node] of ERA_NODES.entries()) for (const dt of dts) {
      if (!eras.includes(era)) continue;
      const d = trigDuel(ctx, { node, dt, keepKinds: ['StartCSM', 'StartCSM.portal'], maxFail: MAXFAIL, failures });
      d.label = `trig e${era} dt${dt}`; cover.sessions++;
      m8Stats.push(m8Hook(d, [0x51e19c, 0x51ea3c], failures, { label: d.label, every: 5, period: 43, hold: 17 }));   // WP-SAVE: save blocks vs the original's serializer / loader during the duel
      d.pinSpy(true);
      try {
        const W = d.P.world, mem = d.emu.cpu.mem, att = d.O.profile.island.attaches;
        const G = vehicles(W);
        const rnd = lcg(1000 + era * 7 + (dt === 1 ? 0 : 3)), pick = (n) => Math.floor(rnd() * n);
        // pair the original's node blocks with the port's nodes of the same record, in attach order
        const pairs = [];
        const seen = new Map();
        for (const a of att) {
          if ((a.ctor !== CTOR_CSM && a.ctor !== CTOR_PORTAL) || !a.hasController) continue;
          const k = `${a.record}:${a.ctor}`, n = seen.get(k) ?? 0; seen.set(k, n + 1);
          const o = d.emu.nodeOf.get(a.record)?.filter((x) => x.ctor === a.ctor)[n]?.ptr;
          const p = W.records[a.record].ctrl?.nodes.filter((x) => x.kind === (a.ctor === CTOR_CSM ? 'StartCSM' : 'StartCSM.portal'))[n];
          if (!o || !p) { failures.push(`${d.label}: no node pair for record ${a.record} (${W.records[a.record].name}) ctor ${a.ctor.toString(16)} #${n} (orig ${!!o}, port ${!!p})`); continue; }
          pairs.push({ a, o, p, rec: a.record, csm: a.ctor === CTOR_CSM, init: null });
        }
        const eq = (what, x, y) => { checked++; if (JSON.stringify(x) !== JSON.stringify(y)) d.fail(`${d.label} t${d.t} ${what}: original ${JSON.stringify(x)} port ${JSON.stringify(y)}`); };
        const f32eq = (what, x, y) => d.cmp(what, x, y, 1e-6, '', 1e-6);
        const compareNode = (pr) => {
          const n = W.records[pr.rec].name;
          if (pr.csm) {
            eq(`${n} slot`, mem.r16(pr.o + 0x38) << 16 >> 16, pr.p.slot);
            eq(`${n} armed`, mem.r8(pr.o + 0x3a) !== 0, pr.p.armed);
            eq(`${n} nearest`, mem.r32(pr.o + 0x3c) | 0, pr.p.nearest);
          } else { f32eq(`${n} portal last`, mem.f32(pr.o + 0x3c), pr.p.last); f32eq(`${n} portal age`, mem.f32(pr.o + 0x40), pr.p.age); d.rec(pr.rec, 0xfffe); }
        };
        // constructor results: the original's node block against the port's decoded node (radius / icon radius / keys / slot) before any tick
        for (const pr of pairs) {
          const n = W.records[pr.rec].name, a = pr.p.a;
          if (pr.csm) {
            const o2 = mem.f32(pr.o + 0x1c), oi = mem.f32(pr.o + 0x20);
            eq(`${n} ctor: radius^2 / icon radius^2`, [o2, oi].map(Math.fround), [pr.p.r2, pr.p.r2icon].map(Math.fround));
            eq(`${n} ctor: slot / key mask / icon / walkTo / needVisible`, [mem.r16(pr.o + 0x38) << 16 >> 16, mem.r32(pr.o + 0x30), mem.r32(pr.o + 0x34), mem.r8(pr.o + 0x2e), mem.r8(pr.o + 0x2f)], [a.slot, a.keyMask, a.icon, a.walkTo ? 1 : 0, a.needVisible ? 1 : 0]);
            eq(`${n} ctor: op var / value / op`, [mem.r32(pr.o + 0x24), mem.r16(pr.o + 0x28) << 16 >> 16, mem.r16(pr.o + 0x2c) << 16 >> 16], [a.opVar, a.opValue, a.op]);
            if (a.waypoints.length) eq(`${n} ctor: map / count`, [mem.r8(pr.o + 0x19), mem.r8(pr.o + 0x18)], [a.map, a.waypoints.length]); else eq(`${n} ctor: no waypoints (count 0xff, list null)`, [mem.r8(pr.o + 0x18), mem.r32(pr.o + 0x14)], [0xff, 0]);
          } else {
            eq(`${n} ctor: half / radius^2`, [mem.f32(pr.o + 0x14), mem.f32(pr.o + 0x18), mem.f32(pr.o + 0x1c), Math.fround(mem.f32(pr.o + 0x20))], [...a.half, Math.fround(pr.p.radius2)].map(Math.fround));
            eq(`${n} ctor: var / bits / table / zone`, [mem.r32(pr.o + 0x24), mem.r32(pr.o + 0x28), mem.r16(pr.o + 0x2c), mem.r16(pr.o + 0x2e)], [a.orVar, a.orBits, a.table, a.target]);
            eq(`${n} ctor: face / spin / keys / icons`, [mem.r8(pr.o + 0x30), mem.r8(pr.o + 0x31), mem.r32(pr.o + 0x34), mem.r32(pr.o + 0x38)], [a.faceCamera ? 1 : 0, a.spin ? 1 : 0, a.keyMask, a.iconBits]);
          }
          pr.init = { slot: pr.csm ? mem.r16(pr.o + 0x38) << 16 >> 16 : 0 };
        }
        const reset = (pr) => {
          if (pr.csm) { mem.w16(pr.o + 0x38, pr.init.slot); mem.w8(pr.o + 0x3a, 0); mem.w32(pr.o + 0x3c, -1); pr.p.slot = pr.init.slot; pr.p.armed = false; pr.p.nearest = -1; }
          else { mem.wf32(pr.o + 0x3c, -1); mem.wf32(pr.o + 0x40, 0); pr.p.last = -1; pr.p.age = 0; }
        };
        // portal vehicle rows (the original's table at 0x5d58688): controllers for their records
        const rowRecs = new Set();
        for (let row = 0; row < 2; row++) for (let k = 0; k < 3; k++) { const p = mem.r32(0x5d58688 + row * 12 + k * 4); if (p) rowRecs.add((p - RECORDS_BASE) / REC); }
        for (const i of rowRecs) if (!W.records[i].ctrl) d.makeTarget(i);
        const step = (held, full = false) => {
          const { o, p } = trigTick(d, held); cover.ticks++;
          for (const w of d.emu.varWrites) { if (/^set 5 /.test(w)) cover.zoneSets++; else if (/^set 94 /.test(w)) cover.controlSets++; else if (/^or 12 /.test(w)) cover.iconOrs++; else if (/^or 94 4096$/.test(w)) cover.walkRequests++; }
          eq('cutscene starts / walker pins', o, p); cover.csStarts += o.filter((l) => l.startsWith('cs')).length; cover.pins += o.filter((l) => l.startsWith('pin')).length;
          // every tick: the variables the nodes read / write (and the log's writes); the whole array every 9th tick and at the end of a scenario (d.vars(): 316 variables)
          if (d.t % 9 === 0 || full) d.vars();
          else for (const i of WATCH) { checked++; const ov = mem.r32(0x8a2d2c + 4 * i), pv = W.vars.get(i) | 0; if (ov !== pv) d.fail(`${d.label} t${d.t} var ${i}: original ${ov} port ${pv}`); }
          eq('cutscene active', d.csLeft > 0, d.P.ictx.cutsceneActive());
          for (const pr of pairs) compareNode(pr);
          return o;
        };
        const PC = [1, 1, 1, 0x401, 8, 4, 2, 0x11, 0x1d, 0, 0x100, 0x1001];
        for (const pr of pairs) {
          const a = pr.a, r = W.records[pr.rec], n = r.name;
          cover[pr.csm ? 'triggers' : 'portals']++;
          // the scenarios: gate open (the variable set to the attach's value) mostly, closed once
          const nScen = 8;
          for (let sc = 0; sc < nScen; sc++) {
            cover.scenarios++;
            const gateOpen = sc !== 3;
            for (const q of pairs) reset(q);
            // gate variable
            const cur = d.getVar(a.var);
            if (a.var > 2) d.setVar(a.var, gateOpen ? ((cur & ~a.mask) | a.value) : ((cur & ~a.mask) | (a.value ^ 1 & a.mask)));
            // positions
            let pos;
            if (pr.csm) {
              const wl = pr.p.a.waypoints, rad = Math.sqrt(pr.p.r2 > 1e37 ? 400 : pr.p.r2);
              const base = wl.length ? waypoints.nodePos(pr.p.a.map, wl[pick(wl.length)], [0, 0, 0]) : [r.x, r.y, r.z];
              const f = [0.2, 0.7, 0.98, 1.02, 1.6, 4][pick(6)], ang = rnd() * 6.283;
              pos = [base[0] + Math.cos(ang) * rad * f, base[1] + (rnd() < 0.2 ? 6 : 0), base[2] + Math.sin(ang) * rad * f];
            } else {
              const h = pr.p.a.half, f = [0.1, 0.5, 0.9, 1.05, 2][pick(5)];
              pos = [r.x + (rnd() - 0.5) * 2 * h[0] * f, r.y + (rnd() - 0.5) * 2 * h[1] * f, r.z + (rnd() - 0.5) * 2 * h[2] * f];
            }
            d.placePepper(Math.fround(pos[0]), Math.fround(pos[1]), Math.fround(pos[2]), 0);
            const pc = PC[pick(PC.length)];
            d.setVar(0x5e, pc); d.setVar(0xc, 0);
            const kind = [-1, -2, -3, 0][pick(4)]; setKind(d, kind);
            if (rnd() < 0.2) setClip(d, 0x1c); else setClip(d, 0x1b);
            // synthetic variants (no shipped trigger has a key mask): a key mask 0x40 (action) with icon 0 -> 2 as the constructors derive it
            const saved = { k: pr.p.a.keyMask, i: pr.p.a.icon ?? pr.p.a.iconBits };
            const synth = sc >= 4;
            if (synth) {
              const ik = pr.csm ? 'icon' : 'iconBits';
              pr.p.a.keyMask = 0x40; pr.p.a[ik] = 2; mem.w32(pr.o + (pr.csm ? 0x30 : 0x34), 0x40); mem.w32(pr.o + (pr.csm ? 0x34 : 0x38), 2);
              cover.synthetic++;
            }
            const key = pr.p.a.keyMask;
            const keys = [0, key, key | 0x80, 0x40, 0x80, key, key][0];
            void keys;
            // portal vehicles: put the table rows near the portal
            if (!pr.csm && pr.p.a.table > 0) {
              const row = [0, 1, 2].map((k) => mem.r32(0x5d58688 + (pr.p.a.table - 1) * 12 + k * 4)).filter(Boolean).map((p2) => (p2 - RECORDS_BASE) / REC);
              for (const i of row) { const h = pr.p.a.half; const q = d.P.pepper, x = Math.fround(q.x + (rnd() - 0.5) * 4), y = Math.fround(q.y + (rnd() - 0.5) * 2), z = Math.fround(q.z + (rnd() - 0.5) * 4); void h; for (const rr of [d.P.world.records[i], d.O.world.records[i]]) { rr.setEuler(rr.rx, rr.ry, rr.rz, x, y, z); } d.emu.putRecord(i, d.O.world.records[i]); }
            }
            const n0 = pr.csm ? 36 : Math.ceil(44 / dt);
            let heldPrev = 0;
            const approach = !pr.csm && sc % 2 === 0;
            const hh = pr.csm ? null : pr.p.a.half, D0 = hh ? Math.max(8, Math.sqrt(pr.p.radius2) * (0.6 + rnd() * 0.8)) : 0, ang0 = rnd() * 6.283;
            const rowIdx = !pr.csm && pr.p.a.table > 0 ? [0, 1, 2].map((k) => mem.r32(0x5d58688 + (pr.p.a.table - 1) * 12 + k * 4)).filter(Boolean).map((p2) => (p2 - RECORDS_BASE) / REC) : [];
            for (let t = 0; t < n0; t++) {
              if (approach) {
                // Pepper walks towards the portal (it reacts only while the distance shrinks), the table's vehicles stay at his feet
                const k = 1 - t / (n0 - 1), x = Math.fround(r.x + Math.cos(ang0) * D0 * k), z = Math.fround(r.z + Math.sin(ang0) * D0 * k), y = Math.fround(r.y);
                d.placePepper(x, y, z, 0);
                for (const i of rowIdx) { for (const rr of [d.P.world.records[i], d.O.world.records[i]]) rr.setEuler(rr.rx, rr.ry, rr.rz, Math.fround(x + 1), y, z); d.emu.putRecord(i, d.O.world.records[i]); }
              }
              // buttons: the node's key mask (pressed edges) in about a third of the ticks
              let held = 0;
              if (key && rnd() < 0.35) held = key | (rnd() < 0.3 ? 0x80 : 0);
              else if (rnd() < 0.15) held = [0x40, 0x80, 4, 1][pick(4)];
              if (held === heldPrev && held) held = 0;
              heldPrev = held;
              const o = step(held);
              // the mode node (PepSwitc) answers the 0x1000 request: puts Pepper down (walking)
              if ((d.getVar(0x5e) & 0x1000) && rnd() < 0.4) d.setVar(0x5e, 1 | 0x1000);
              if (pr.csm && mem.r16(pr.o + 0x38) << 16 >> 16 === -0x1e && !pr.done) { pr.done = true; cover.opApplied++; }
              void o;
            }
            if (synth) { const ik = pr.csm ? 'icon' : 'iconBits'; pr.p.a.keyMask = saved.k; pr.p.a[ik] = saved.i; mem.w32(pr.o + (pr.csm ? 0x30 : 0x34), saved.k); mem.w32(pr.o + (pr.csm ? 0x34 : 0x38), saved.i); }
          }
        }
        void G; void dev;
        checked += d.checked;
        notes.push(`e${era} dt${dt}: triggers ${pairs.filter((x) => x.csm).map((x) => `${W.records[x.rec].name}(wp ${x.p.a.waypoints.length}, keys 0x${x.p.a.keyMask.toString(16)}, slot ${x.p.a.slot}, op ${x.p.a.op}, walkTo ${+x.p.a.walkTo})`).join(' ')}; portals ${pairs.filter((x) => !x.csm).map((x) => `${W.records[x.rec].name}(table ${x.p.a.table}, keys 0x${x.p.a.keyMask.toString(16)}, zone ${x.p.a.target})`).join(' ')}; ${pairs.filter((x) => x.csm).length} triggers, ${pairs.filter((x) => !x.csm).length} portals; worst ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      } finally { d.pinSpy(false); }
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    for (const st of m8Stats) notes.push(m8Note(st));
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
});

export default makeTrigTest('m7-isl-veh-trig', [1], [0, 1, 2, 3, 4]);
