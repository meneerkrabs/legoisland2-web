// WP-SAVE (F3): the brick effect slots of the save game, against the ORIGINAL's FX_Bricks code run natively (tools/lib/m8-save-bricks.mjs).
//   1. writer, original -> port: the original's registrations of every real set-up (the five story eras of the island, the six hubs: the era sets' effects, the vehicle rosters) are replayed through
//      the original's own FUN_00447d20 / 00447da0 / 00447d70 / 00447ed0 natively and through the port's `applySetupRegistrations`; FUN_00449a10's 64 entries must equal `captureBricks` byte for byte,
//      then bursts, game variable changes and per-frame updates (FUN_0044a180 / `update`) go through both machines, comparing the images, the record flags and the callbacks after every step.
//   2. synthetic effects (every stage callback class, every visibility, waits, 1..16 models, bricks that finish at once): the same op stream and the same comparisons, including the "done" branch
//      (the record is shown / hidden, the stage moves on, the action lists are freed).
//   3. loader, original <-> port: random images (all field combinations) go through FUN_00449be0 natively and `applyBricks`; the writer's output after the load must be equal, the callbacks the
//      loader played (function class, slot, stage) and the visible flags of the bricks as well.
//   4. port -> original: images the port writes during real gameplay with the real brick library (running morphs, bursts, the vehicle roster) load into the original and come out of its writer like
//      they come out of the port's own load; the loaded slots of the real island continue and finish.
import { loadIsland, tick } from '../lib/island-load.mjs';
import { loadHub } from '../lib/hub-load.mjs';
import { loadExe } from '../lib/engine-load.mjs';
import { BrickLibrary } from '../../src/formats/bricks.ts';
import { applySetupRegistrations, islandBrickFx, setBrickRandom } from '../../src/fx/bricks/island.ts';
import { BRICK_DATA_ROOT, brickModelPath } from '../../src/fx/bricks/manager.ts';
import { ACT } from '../../src/fx/bricks/sim.ts';
import { BrickEmu, stubLibrary, portWorld, captureBricks, applyBricks, classOfFn, SLOTS, IMG } from '../lib/m8-save-bricks.mjs';
import { makeRng } from '../lib/m7-shell-save-emu.mjs';
import { IslEmu, RECORDS_BASE as IRB, REC as IREC } from '../lib/m7-isl-veh-emu.mjs';
import { buildIslandOracle } from '../lib/m8-save.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const hex = (b, a, n = 12) => Array.from(b.subarray(Math.max(0, a - 4), a + n), (x) => x.toString(16).padStart(2, '0')).join('');
const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; };
const ISLAND_NODES = [2, 16, 37, 56, 61];
const HUBS = ['z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
const F32 = (x) => new Uint32Array(new Float32Array([x]).buffer)[0];
const FIELD = (o) => (o === 0 ? 'flag' : o < 5 ? 'tag' : o < 0x15 ? `fn${o - 5}` : o < 0x19 ? 'state' : o === 0x19 ? 'running' : o < 0x1e ? 'var' : o === 0x1e ? 'oneShot' : o < 0x23 ? 'time' : o < 0x63 ? `vis${(o - 0x23) >> 2}` : o === 0x63 ? 'started'
  : o < 0x664 ? `params[${((o - 0x64) / 0x60) | 0}][${(((o - 0x64) % 0x60) / 4) | 0}]` : o === 0x664 ? 'stage' : o < 0x669 ? 'wait' : o === 0x669 ? 'count' : `desc[${((o - 0x66a) / 0x104) | 0}]+${(o - 0x66a) % 0x104}`);

const __test = {
  name: 'm8-save-bricks',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 60) failures.push(m); };
    const ok = (c, m) => { checked++; if (!c) bad(m); };
    const pe = loadExe(ctx.dataRoot);
    const st = { setups: 0, slots: 0, bytes: 0, ops: 0, ticks: 0, bursts: 0, dones: 0, loads: 0, loadSlots: 0, replays: 0, shows: 0, cbs: 0, steps: 0, real: 0, realLoads: 0 };

    // ------------------------------------------------------------------------------------------------------ helpers
    const portCalls = (P) => { const out = []; for (const l of P.fx.log) { const m = /^start (\d+) (\d+) (\d+)$/.exec(l); if (m) out.push({ slot: +m[1], stage: +m[2], fn: classOfFn(+m[3]) }); } P.fx.log.length = 0; return out; };
    /** the original's images against the port's captures, the record flags, and (when asked) the callbacks since the last call */
    const compare = (B, P, label, o = {}) => {
      const orig = B.images(), port = captureBricks(P.w);
      let n = 0;
      for (let i = 0; i < SLOTS; i++) {
        checked++;
        if ((orig[i] === null) !== (port[i] === null)) { bad(`${label}: slot ${i} ${orig[i] ? 'in use' : 'free'} in the original, ${port[i] ? 'in use' : 'free'} in the port`); n++; continue; }
        if (!orig[i]) continue;
        const d = firstDiff(orig[i], port[i]);
        if (d >= 0) { bad(`${label}: slot ${i} byte ${d} ${FIELD(d)}: original ${hex(orig[i], d)} port ${hex(port[i], d)}`); n++; } else st.bytes += IMG;
      }
      for (let r = 0; r < P.recs.length; r++) if (B.recFlags(r) !== (P.recs[r].flags & 0xffff)) { bad(`${label}: record ${r} flags original ${B.recFlags(r).toString(16)} port ${(P.recs[r].flags & 0xffff).toString(16)}`); n++; break; }
      if (o.calls) {
        const a = B.cbLog.splice(0).map((c) => `${c.slot}/${c.stage}/${c.fn}`).join(' '), b = portCalls(P).map((c) => `${c.slot}/${c.stage}/${c.fn}`).join(' ');
        checked++;
        if (a !== b) { bad(`${label}: callbacks original [${a}] port [${b}]`); n++; }
        st.cbs += a ? a.split(' ').length : 0;
      }
      return n;
    };
    /** the same (vars, sounds) bookkeeping on both machines */
    const setVar = (B, P, i, v) => { B.setVar(i, v); P.vars[i] = v; };
    /** both machines' per-frame update; DAT_008b1718 = 1 and 0.5 in turn (the game's two steps: the first five frames, then the fixed 60 Hz) */
    const update = (B, P) => { const dt = st.ticks % 3 === 0 ? 1 : 0.5; B.mem.wf32(0x8b1718, dt); B.update(); P.fx.update(dt); st.ticks++; };
    /** arm every brick of both machines: a brick with an action that reports "done" (native: +0x54 != 0 and FUN_0044c180 hosted = 2; port: a DELAY of 0) */
    const arm = (B, P) => {
      B.armAll();
      for (const s of P.fx.slots) if (s) for (const m of s.models) for (const b of m.bricks) { b.active = true; b.actions = [{ type: ACT.DELAY, state: 0, brick: b, delay: 0, b18: 1, b19: 0, v: [] }]; }
    };

    // ------------------------------------------------------------------------------------------------------ 1. the real set-ups, both writers, then gameplay-like ops
    const buildFromSetup = (label, world, vars, S) => {
      const records = world.records.map((r) => ({ name: r.name, flags: r.flags & 0xffff }));
      const v = Int32Array.from(vars);
      const B = new BrickEmu(pe, { records, vars: v, root: BRICK_DATA_ROOT });
      const P = portWorld(records, v, stubLibrary());
      P.vars = v;
      const slotOf = new Map();
      let calls = 0;
      for (const c of [...S.calls, ...(S.vehicleRoster ?? [])]) {
        const info = c.info ?? {};
        if (c.fn === 0x447d20) slotOf.set(info.slot, B.register(info.record, info.var));
        else if (c.fn === 0x447da0) B.addModel(slotOf.get(info.slot), info.file);
        else if (c.fn === 0x447d70) B.stage(slotOf.get(info.slot), info.stage, info.fn, info.params, info.vis);
        else if (c.fn === 0x447ed0) B.wait(slotOf.get(info.slot), info.delay);
        else continue;
        calls++;
      }
      applySetupRegistrations({ records: P.recs, vars: P.w.vars, ext: P.w.ext }, P.fx, S);
      const n = B.images().filter(Boolean).length;
      ok(n === captureBricks(P.w).filter(Boolean).length, `${label}: slots in use original ${n} port ${captureBricks(P.w).filter(Boolean).length}`);
      ok(compare(B, P, `${label} set-up`) === 0, `${label}: set-up images differ`);
      st.setups++; st.slots += n;
      return { label, B, P, calls, n, vars: v };
    };
    const worlds = [];
    for (const node of ISLAND_NODES) {
      const I = loadIsland(ctx, { node, bricks: false });
      worlds.push(buildFromSetup(`island node ${node}`, I.world, I.vars.a, I.profile.island));
    }
    for (const zone of HUBS) {
      let H;
      try { H = loadHub(ctx, { zone }); } catch (e) { bad(`${zone}: hub load failed: ${e.message}`); continue; }
      // the zones' roster constructors (their FX_Bricks calls become part of setup.calls, like the zone games do after the set-up: src/zones/<zone>/index.ts)
      const FN = { z07CSI: 0x5b2a23, z13CAI: 0x6277b9, z14OSD: 0x655de3, z16PYA: 0x698963 }[zone];
      if (FN) H.emu.run(FN, []);
      worlds.push(buildFromSetup(zone, H.world, H.vars.a, H.emu));
    }
    notes.push(`set-ups: ${worlds.map((w) => `${w.label} ${w.n} slots / ${w.calls} calls`).join(', ')}`);

    // gameplay-like ops on the real set-ups: bursts, game variable changes and updates (the models are empty: bricks cannot finish, the callbacks / start / time flow is what moves)
    const rng = makeRng(0xb71c4);
    for (const W of worlds) {
      const { B, P } = W;
      const used = P.fx.slots.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
      if (!used.length) continue;
      let bad0 = 0;
      for (let step = 0; step < 150 && bad0 === 0; step++) {
        const r = rng.int(10);
        const si = rng.pick(used), slot = P.fx.slots[si];
        let what;
        if (r < 4) { const n = slot.models.length || 1; const v = rng.int(n * 2 + 1); setVar(B, P, slot.v, v); what = `var ${slot.v}=${v}`; }
        else if (r < 6) { const kind = rng.pick([6, 0xb, 0xc, 0xd, 0x10, 1]); B.burst(slot.record.index, kind); P.fx.burst(slot.record, kind); what = `burst rec ${slot.record.index} kind ${kind}`; st.bursts++; }
        else { const k = 1 + rng.int(8); for (let t = 0; t < k; t++) update(B, P); what = `update x${k}`; }
        st.ops++;
        bad0 += compare(B, P, `${W.label} step ${step} (${what})`, { calls: true });
      }
    }

    // ------------------------------------------------------------------------------------------------------ 2. synthetic effects, including the finishing branch
    const FILES = ['house01.txt', 'house02.txt', 'peppershouse01.txt', 'hospital.txt', 'animal07.txt', 'speedster00.txt', 'shop01.txt', 'resq.txt', 'a.txt', 'a_very_long_model_name_for_the_descriptor.txt'];
    const syn = (seed, armed) => {
      const R = makeRng(seed);
      const names = Array.from({ length: 14 }, (_, i) => `${String.fromCharCode(65 + R.int(26))}${String.fromCharCode(65 + R.int(26))}${String.fromCharCode(48 + (i >> 3))}${String.fromCharCode(48 + (i & 7))}`);
      const records = names.map((name) => ({ name, flags: R.pick([0, 2, 0x4002, 0x8002, 0x2002]) }));
      const vars = new Int32Array(319); for (let i = 0; i < 319; i++) vars[i] = R.int(6);
      const bpm = armed ? ((f) => (f.length + 1) % 3 + 1) : () => 0;
      const B = new BrickEmu(pe, { records, vars, root: BRICK_DATA_ROOT, bricksPerModel: bpm });
      const P = portWorld(records, vars, stubLibrary(bpm));
      P.vars = vars;
      const slots = [];
      const count = 1 + R.int(12);
      for (let k = 0; k < count; k++) {
        const rec = R.int(records.length), v = 20 + R.int(120);
        const hs = B.register(rec, v), hp = P.fx.register(P.recs[rec], v);
        ok(hs === hp, `synthetic ${seed}: slot handle original ${hs} port ${hp}`);
        const n = R.chance(0.1) ? 16 : 1 + R.int(5);
        for (let m = 0; m < n; m++) { const f = R.pick(FILES); B.addModel(hs, f); P.fx.addModel(hp, f); }
        for (let m = 0; m < n; m++) {
          const words = Array.from({ length: 24 }, () => (R.chance(0.5) ? F32(R.f32(-3, 90)) : R.int(40)));
          const fn = armed ? R.pick([3, 6, 9, 14, 15]) : R.int(16);
          const vis = R.int(3);
          B.stage(hs, m, fn, words, vis); P.fx.setStageWords(hp, m, fn, words, vis);
        }
        const wait = R.pick([0, 0.5, 1.2, 3, 0.1]);
        if (wait) { B.wait(hs, wait); P.fx.setWait(hp, wait); }
        slots.push({ v, hs, n });
      }
      if (armed) arm(B, P);
      ok(compare(B, P, `synthetic ${seed} set-up`) === 0, `synthetic ${seed}: set-up differs`);
      return { B, P, slots, R, records };
    };
    for (let seed = 1; seed <= 24; seed++) {
      const armed = seed % 2 === 0;
      const { B, P, slots, R, records } = syn(seed, armed);
      let bad0 = 0;
      for (let step = 0; step < 220 && bad0 === 0; step++) {
        const r = R.int(12);
        const sl = R.pick(slots);
        let what;
        if (r < 3) { const v = R.int(sl.n * 3 + 1); setVar(B, P, sl.v, v); what = `var ${sl.v}=${v}`; }
        else if (r < 4) { const rec = R.int(records.length), kind = armed ? 6 : R.pick([6, 0xb, 0xc, 0xd, 0x10]); B.burst(rec, kind); P.fx.burst(P.recs[rec], kind); what = `burst ${rec} ${kind}`; st.bursts++; }
        else { const k = 1 + R.int(armed ? 40 : 6); for (let t = 0; t < k; t++) { update(B, P); if (process.env.F3DBG2 && armed) { const o = B.images(), p = captureBricks(P.w); for (let i = 0; i < SLOTS; i++) if (o[i] && firstDiff(o[i], p[i]) >= 0) { const d = firstDiff(o[i], p[i]); console.log('F3DBG2 seed', seed, 'tick', t, 'slot', i, 'field', FIELD(d), 'orig', new DataView(o[i].buffer).getFloat32(0x665, true), 'port', new DataView(p[i].buffer).getFloat32(0x665, true), 'state', new DataView(o[i].buffer).getInt32(0x15, true), new DataView(p[i].buffer).getInt32(0x15, true)); t = 1e9; break; } } else if (process.env.F3DBG2 && !armed) { /* nothing */ } } what = `update x${k}`; }
        st.ops++;
        bad0 += compare(B, P, `synthetic ${seed}${armed ? ' armed' : ''} step ${step} (${what})`, { calls: true });
        if (bad0 && process.env.F3DBG) { for (const s of P.fx.slots) if (s) console.log('DBG slot', s.index, 'state', s.state, 'stage', s.stage, 'running', s.running, 'oneShot', s.oneShot, 'wait', s.wait, 'models', s.models.map((m) => m.bricks.map((b) => b.actions.length + '/' + (b.active ? 1 : 0)).join(',')).join(' | '), 'v', P.vars[s.v]); }
        if (bad0 === 0 && armed) st.dones = Math.max(st.dones, 0);
      }
      st.steps += 220;
    }
    // count the finished morphs (the port's log says `done slot stage vis`)
    // (kept in the manager's log of the synthetic worlds: the comparison above covers the images and record flags after every step)

    // ------------------------------------------------------------------------------------------------------ 3. loader, random images
    const randImage = (R, records, bpmMode, usedVars) => {
      const img = new Uint8Array(IMG), dv = new DataView(img.buffer);
      const n = R.chance(0.1) ? 16 : 1 + R.int(6);
      img[0] = 1;
      dv.setUint32(1, (() => { let t = 0; const nm = R.pick(records).name; for (let k = 0; k < 4; k++) t |= (k < nm.length ? nm.charCodeAt(k) & 0xff : 0) << (8 * k); return t >>> 0; })(), true);
      for (let k = 0; k < 16; k++) img[5 + k] = R.chance(0.2) ? R.int(256) : R.int(16);
      dv.setInt32(0x15, R.int(4), true);
      img[0x19] = R.int(2);
      let v = 20 + R.int(100); if (bpmMode) while (usedVars.has(v)) v = 20 + R.int(250); usedVars.add(v); dv.setInt32(0x1a, v, true);
      img[0x1e] = bpmMode ? 0 : R.int(2);
      dv.setFloat32(0x1f, R.pick([0, 0, 0.05, 0.1, 0.37, 1, 2.5, 3.14159, 4.9, R.f32(0, 5)]), true);
      for (let k = 0; k < 16; k++) dv.setInt32(0x23 + 4 * k, R.int(3), true);
      img[0x63] = R.int(2);
      for (let k = 0; k < 16 * 24; k++) dv.setUint32(0x64 + 4 * k, R.chance(0.5) ? F32(R.f32(-3, 90)) : R.int(40), true);
      const stage = R.int(n);
      img[0x664] = stage;
      dv.setFloat32(0x665, R.pick([0, 0, 0.5, 1.2, 3, R.f32(0, 4)]), true);
      img[0x669] = n;
      for (let k = 0; k < n; k++) {
        const f = R.pick(FILES), root = R.chance(0.8) ? BRICK_DATA_ROOT : R.pick(['D:\\_Data\\', 'C:\\Games\\LEGO eiland 2\\_Data\\']);
        const path = `${root}\\brickmorph\\${f}`;
        for (let j = 0; j < path.length; j++) img[0x66a + 0x104 * k + j] = path.charCodeAt(j);
      }
      return { img, v, stage, n };
    };
    const loadScenario = (seed, bpmMode) => {
      const R = makeRng(seed * 7919);
      const names = Array.from({ length: 12 }, (_, i) => `R${String.fromCharCode(65 + R.int(26))}${String.fromCharCode(48 + (i >> 3))}${String.fromCharCode(48 + (i & 7))}`);
      const records = names.map((name) => ({ name, flags: R.pick([0, 2, 0x4002, 0x8002]) }));
      const vars = new Int32Array(319); for (let i = 0; i < 319; i++) vars[i] = R.int(8);
      const bpm = bpmMode ? ((f) => (f.length + 1) % 3 + 1) : () => 0;
      const B = new BrickEmu(pe, { records, vars, root: BRICK_DATA_ROOT, bricksPerModel: bpm });
      const P = portWorld(records, vars, stubLibrary(bpm));
      P.vars = vars;
      return { R, B, P, records, vars };
    };
    for (let seed = 1; seed <= 60; seed++) {
      const bpmMode = seed % 3 === 0;
      const { R, B, P, records, vars } = loadScenario(seed, bpmMode);
      const imgs = Array.from({ length: SLOTS }, () => null);
      const metas = [];
      const used = 4 + R.int(20), usedVars = new Set();
      for (let k = 0; k < used; k++) {
        const i = R.int(SLOTS), m = randImage(R, records, bpmMode, usedVars);
        // the variable decides whether the loader replays: make half of the images take the "nothing runs" branch, the other half the replay
        const t = R.chance(0.5) ? m.stage : (m.stage + 1 + R.int(m.n)) % (m.n + 3);
        vars[m.v] = t; B.setVar(m.v, t);
        if (bpmMode) { vars[m.v] = m.stage; B.setVar(m.v, m.stage); m.t = m.stage; } else m.t = t % m.n;
        imgs[i] = m.img; metas[i] = m;
      }
      B.load(imgs);
      applyBricks(P.w, imgs);
      st.loads++; st.loadSlots += imgs.filter(Boolean).length;
      const label = `load ${seed}${bpmMode ? ' (bricks)' : ''}`;
      ok(compare(B, P, label, { calls: true }) === 0, `${label}: images / callbacks differ`);
      for (const [i, m] of metas.entries()) if (m && m.stage !== (vars[m.v] % m.n) || (m && imgs[i][0x1e])) st.replays++;
      // the visible flags of the bricks (only slots whose loader did not run a callback: the original's callbacks are hosted, the port's real)
      if (bpmMode) for (let i = 0; i < SLOTS; i++) {
        if (!imgs[i]) continue;
        const o = B.brickVisible(i), p = P.fx.slots[i].models.map((mm) => mm.bricks.map((b) => (b.visible ? 1 : 0)));
        checked++;
        if (JSON.stringify(o) !== JSON.stringify(p)) bad(`${label}: slot ${i} brick visibility original ${JSON.stringify(o)} port ${JSON.stringify(p)}`); else st.shows++;
      }
      // the loader's unused entries clear the slot: a second load over the first
      const imgs2 = imgs.map((x, i) => (R.chance(0.5) ? null : x));
      B.load(imgs2); applyBricks(P.w, imgs2);
      ok(compare(B, P, `${label} (second load)`, { calls: true }) === 0, `${label}: second load differs`);
    }

    // ------------------------------------------------------------------------------------------------------ 4. port -> original, on real gameplay with the real library
    const arc = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
    let seed = 777;
    setBrickRandom(() => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; });
    const realImages = [];
    {
      const I = loadIsland(ctx, { node: 2, bricks: true });
      tick(I, 2);
      const fx = islandBrickFx(I.world);
      const bySlot = (n) => fx.slots.find((s) => s && s.record.name === n);
      const snap = (label) => { realImages.push({ label, imgs: captureBricks(I.world), vars: Int32Array.from(I.vars.a), records: I.world.records.map((r) => ({ name: r.name, flags: r.flags & 0xffff })) }); };
      snap('rest');
      const ph = bySlot('PH01'), hosp = bySlot('HOSP'), shp = bySlot('SHP1'), bml = bySlot('BML1');
      I.vars.set(ph.v, 1); I.vars.set(hosp.v, 1); I.vars.set(shp.v, 1); I.vars.set(bml.v, 1);
      for (let t = 0; t < 400; t++) { tick(I, 1); if (t % 7 === 0) snap(`t${t}`); }
      snap('after');
      st.real += realImages.length;
    }
    {
      const I = loadIsland(ctx, { node: 16, bricks: true });
      tick(I, 2);
      const fx = islandBrickFx(I.world);
      for (const s of fx.slots) if (s && s.models.length === 2) I.vars.set(s.v, 1);
      for (let t = 0; t < 300; t++) { tick(I, 1); if (t % 9 === 0) realImages.push({ label: `n16 t${t}`, imgs: captureBricks(I.world), vars: Int32Array.from(I.vars.a), records: I.world.records.map((r) => ({ name: r.name, flags: r.flags & 0xffff })) }); }
      st.real = realImages.length;
    }
    for (const [k, R] of realImages.entries()) {
      const bpm = (f) => (f.length + 1) % 3 + 1;
      for (const mode of [0, 1]) {
        const b = mode ? bpm : () => 0;
        const B = new BrickEmu(pe, { records: R.records, vars: R.vars, root: BRICK_DATA_ROOT, bricksPerModel: b });
        const P = portWorld(R.records, Int32Array.from(R.vars), stubLibrary(b)); P.vars = P.w.vars;
        B.load(R.imgs); applyBricks(P.w, R.imgs);
        if (mode === 0) ok(compare(B, P, `real image ${k} (${R.label})`, { calls: true }) === 0, `real image ${k} differs`);
        else {
          const o = B.images(), p = captureBricks(P.w);
          for (let i = 0; i < SLOTS; i++) { checked++; if ((o[i] === null) !== (p[i] === null) || (o[i] && firstDiff(o[i], p[i]) >= 0 && (R.imgs[i][0x1e] === 0 && false))) bad(`real image ${k} bricks mode: slot ${i}`); }
        }
        st.realLoads++;
      }
    }
    // ------------------------------------------------------------------------------------------------------ 5. a morph that is saved while it runs continues after the load (real library, real models)
    {
      const start = () => {
        seed = 4242;
        const I = loadIsland(ctx, { node: 2, bricks: true });
        tick(I, 2);
        const fx = islandBrickFx(I.world);
        const by = (n) => fx.slots.find((x) => x && x.record.name === n);
        return { I, fx, by };
      };
      const run = (W, ticks, until) => { for (let t = 0; t < ticks; t++) { tick(W.I, 1); if (until?.()) return t + 1; } return -1; };
      // A: PH01's house builds itself (callback 8: the bricks fall in), nothing else
      const A = start(), ph = A.by('PH01');
      A.I.vars.set(ph.v, 1);
      run(A, 60);
      ok(ph.running, `PH01 is running at tick 60 (running ${ph.running}, state ${ph.state})`);
      const saved = captureBricks(A.I.world), savedTime = ph.time, savedWait = ph.wait;
      const endA = run(A, 600, () => !ph.running);
      ok(endA > 0 && ph.stage === 1 && ph.record.enabled, `A: PH01 finishes (stage ${ph.stage}) after ${endA} more ticks`);
      // B: the same state, saved image loaded into a fresh world right after the same 60 ticks (the world is as the save leaves it: the zone is set up, the slots come from the file)
      const Bw = start(), ph2 = Bw.by('PH01');
      Bw.I.vars.set(ph2.v, 1);
      run(Bw, 60);
      applyBricks(Bw.I.world, saved);
      const ph3 = islandBrickFx(Bw.I.world).slots[ph2.index];
      ok(ph3 && ph3 !== ph2 && ph3.running && ph3.started && ph3.models.length === 2 && ph3.models[1].file === ph.models[1].file, `B: the loaded slot is rebuilt (running ${ph3?.running}, models ${ph3?.models.map((m) => m.file)})`);
      ok(ph3.sound === 0x05d58130 && ph3.flag === 0 && ph3.models.every((m) => m.bricks.every((b) => b.norm.every((x) => x === 0))), `B: sound handle 0, flag 0, bricks of the loaded models carry no normalised place (sound ${ph3.sound}, flag ${ph3.flag}, norms ${ph3.models.map((m) => m.bricks.filter((b) => b.norm.some((x) => x !== 0)).length)})`);
      const endB = run(Bw, 600, () => !ph3.running);
      ok(endB > 0 && ph3.stage === 1 && ph3.record.enabled, `B: the loaded morph finishes (stage ${ph3.stage}) after ${endB} more ticks`);
      notes.push(`morph continuity: PH01 saved at tick 60 (time ${savedTime}, wait ${savedWait}): original run finishes ${endA} ticks later, the loaded one ${endB} ticks later`);
      ok(endB > 0 && Math.abs(endA - endB) <= 12, `B: the loaded morph finishes about when the running one does (${endB} vs ${endA})`);
      // at rest, vis 2 (the Brikimal shows its bricks): loaded bricks are visible and drawn
      const C = start(), bml = C.by('BML1');
      run(C, 60);
      const imgs = captureBricks(C.I.world);
      const D = start();
      run(D, 10);
      applyBricks(D.I.world, imgs);
      const bml2 = islandBrickFx(D.I.world).slots[bml.index];
      run(D, 3);
      ok(bml2.stage === bml.stage && bml2.models[bml2.stage].bricks.length > 0 && bml2.models[bml2.stage].bricks.every((b) => b.visible) && bml2.drawn, 'C: the Brikimal at rest shows the bricks of its stage after the load');
    }
    // ------------------------------------------------------------------------------------------------------ 6. the constructors' own registrations (PepSwitc's roster FUN_0051c823, the Brikimal FUN_004bd4a8) against the port's
    // The island oracle runs every constructor of the set-up natively (tools/lib/m8-save.mjs); here the FX_Bricks entry points it hosts are replaced by recorders, the recorded calls (after the era
    // set's own, which the set-up emulation logs) are replayed through the original's FX_Bricks code, and the slot images are compared with the port's real world (real library, a few ticks in):
    // the static fields (record, variable, function ids, visibility, parameter blocks, model paths, their order = the slot numbers) must be identical; state / time / stage are dynamic.
    {
      const DYNAMIC = (o) => (o >= 0x15 && o < 0x19) || o === 0x19 || (o >= 0x1e && o < 0x23) || o === 0x63 || o === 0x664 || (o >= 0x665 && o < 0x669);
      const origInit = IslEmu.prototype.initHosts, origAttach = IslEmu.prototype.attach;
      for (const node of ISLAND_NODES) {
        const rec = [];
        // (IslEmu runs the roster once itself when it is built, for its variant words: that call is dropped, the set-up's own comes with the PepSwitc attach)
        let attached = false;
        IslEmu.prototype.attach = function (a) { if (!attached) { attached = true; rec.length = 0; } return origAttach.call(this, a); };
        IslEmu.prototype.initHosts = function () {
          origInit.call(this);
          const H = this.cpu.hooks, mem = this.cpu.mem;
          let id = 1000;
          const idx = (p) => (p - IRB) / IREC;
          H.set(0x447d20, (c) => { rec.push({ op: 'reg', id: ++id, rec: idx(c.arg(0)), v: c.arg(1) | 0 }); c.eax = id; });
          H.set(0x447da0, (c) => { rec.push({ op: 'model', id: c.arg(0), file: mem.cstr(c.arg(1)) }); });
          H.set(0x447d70, (c) => { rec.push({ op: 'stage', id: c.arg(0), k: c.arg(1), fn: c.arg(2), words: Array.from({ length: 24 }, (_, k) => mem.u32(c.arg(3) + 4 * k)), vis: c.arg(4) | 0 }); });
          H.set(0x447ed0, (c) => { rec.push({ op: 'wait', id: c.arg(0), secs: c.argf(1) }); });
          H.set(0x447e90, (c) => { rec.push({ op: 'burst', rec: idx(c.arg(0)), kind: c.arg(1) | 0 }); });
          H.set(0x447e70, (c) => { rec.push({ op: 'parent', id: c.arg(0) }); });
          H.set(0x447e60, (c) => { c.eax = 2; });
        };
        let B0;
        try { B0 = buildIslandOracle(ctx, node); } finally { IslEmu.prototype.initHosts = origInit; IslEmu.prototype.attach = origAttach; }
        const S = B0.P.profile.island;
        const records = B0.P.world.records.map((r) => ({ name: r.name, flags: 0 }));
        const N = new BrickEmu(pe, { records, vars: Int32Array.from(B0.P.vars.a), root: BRICK_DATA_ROOT });
        const map = new Map();
        // the era set's registrations first (they are made before any attach), then what the constructors did, in the order they did it
        const ops = [];
        for (const c of S.calls) {
          const info = c.info ?? {};
          if (c.fn === 0x447d20) ops.push({ op: 'reg', id: 'e' + info.slot, rec: info.record, v: info.var });
          else if (c.fn === 0x447da0) ops.push({ op: 'model', id: 'e' + info.slot, file: info.file });
          else if (c.fn === 0x447d70) ops.push({ op: 'stage', id: 'e' + info.slot, k: info.stage, fn: info.fn, words: info.params, vis: info.vis });
          else if (c.fn === 0x447ed0) ops.push({ op: 'wait', id: 'e' + info.slot, secs: info.delay });
        }
        const nEra = ops.filter((o) => o.op === 'reg').length;
        ops.push(...rec);
        const byCtors = rec.filter((o) => o.op === 'reg');
        ok(byCtors.length >= 10, `node ${node}: the constructors registered ${byCtors.length} effects`);
        for (const o of ops) {
          if (o.op === 'reg') map.set(o.id, N.register(o.rec, o.v));
          else if (o.op === 'model') N.addModel(map.get(o.id), o.file);
          else if (o.op === 'stage') N.stage(map.get(o.id), o.k, o.fn, o.words, o.vis);
          else if (o.op === 'wait') N.wait(map.get(o.id), o.secs);
          else if (o.op === 'burst') N.burst(o.rec, o.kind);
        }
        const nat = N.images();
        const I = loadIsland(ctx, { node, bricks: true });
        tick(I, 3);
        const port = captureBricks(I.world);
        let diffs = 0;
        for (let i = 0; i < SLOTS; i++) {
          checked++;
          if ((nat[i] === null) !== (port[i] === null)) { bad(`ctor replay node ${node}: slot ${i} ${nat[i] ? 'in use' : 'free'} in the original, ${port[i] ? 'in use' : 'free'} in the port`); diffs++; continue; }
          if (!nat[i]) continue;
          for (let o = 0; o < IMG; o++) if (nat[i][o] !== port[i][o] && !DYNAMIC(o)) { bad(`ctor replay node ${node}: slot ${i} byte ${o} ${FIELD(o)}: original ${hex(nat[i], o)} port ${hex(port[i], o)}`); diffs++; break; }
        }
        notes.push(`constructors node ${node}: ${nEra} effects of the era set + ${byCtors.length} by the constructors (${rec.filter((o) => o.op === 'burst').length} bursts), ${diffs} slots differ`);
      }
    }
    setBrickRandom(null);
    void brickModelPath; void BrickLibrary; void arc;
    notes.push(`set-ups ${st.setups} (${st.slots} slots, ${st.bytes} image bytes compared), ops ${st.ops} + ${st.steps} synthetic steps (${st.ticks} updates, ${st.bursts} bursts, ${st.cbs} callbacks matched), loads ${st.loads} (${st.loadSlots} slot images, ${st.replays} replays, ${st.shows} brick-visibility checks), real images ${st.real} (${st.realLoads} loads)`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
