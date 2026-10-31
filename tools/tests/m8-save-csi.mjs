// WP-SAVE, the castle (z07CSI) and the Adventure Island (z13CAI): the save blocks (serializer vtable +0x14) and the loaders (vtable +0x10) of the hubs' nodes against the ORIGINAL, AFTER GAMEPLAY.
// The family duels of M5 (tools/lib/m5-z07CSI-emu.mjs `makeCsiDuel`, tools/lib/m5-z13CAI-emu.mjs `makeCaiDuel`: the original's nodes run natively next to the port's nodes, tick by tick, the same
// buttons / random numbers) are driven through the same scenarios as their own tests; at many moments `compareBlocks` (tools/lib/m8-save.mjs) compares every node's block bytes (tolerance 0), and
// at round-trip moments `snapshotBlocks` takes the ORIGINAL's blocks, the duel ticks on (the state changes), `restoreBlocks` puts the snapshot back into BOTH machines (the original's loader
// natively, the port's `loadBlock`), the blocks must be equal again and the duel's usual comparison goes on for hundreds of ticks.
//   M8_CSI=rats,horse,cai  parts to run (default all)
import '../../src/zones/z07CSI/horse/index.ts';
import { makeCsiDuel, onodeOf, NATIVE_CTORS, B as BC, lcg as lcgC, RECORDS_BASE as RB, REC as RC, f32 as f32C } from '../lib/m5-z07CSI-emu.mjs';
import { makeCaiDuel, NATIVE_CTORS as CAI_CTORS, B as BI, lcg as lcgI, randomKeys, VAR_ARRAY } from '../lib/m5-z13CAI-emu.mjs';
import { castleSpots } from '../lib/m5-z07CSI-horse-spots.mjs';
import { horseAxes } from '../../src/zones/z07CSI/horse/hors.ts';
import { compareBlocks, snapshotBlocks, restoreBlocks, nativeNodes, origBlock, hex } from '../lib/m8-save.mjs';
import { vehicles, berthPos } from '../../src/island/vehicles/common.ts';
import { looksOf } from '../../src/island/vehicles/looks.ts';
import { guarded } from '../lib/inject-guard.mjs';

const PARTS = new Set((process.env.M8_CSI ?? 'rats,horse,cai').split(','));
const MAXFAIL = 40;

/** the block comparison as a duel check: every node of `only`'s constructors, every byte */
function blocks(d, only, cover) { return scratch(d.emu, () => blocks0(d, only, cover)); }
function blocks0(d, only, cover) {
  const res = compareBlocks(d.P.world, d.emu, `${d.label} t${d.t}`, only);
  d.checked += res.checked; cover.blocks += res.checked; cover.moments++;
  for (const m of res.failures) d.fail(m);
  for (const [k, v] of res.byCtor) cover.ctors.set(k, (cover.ctors.get(k) ?? 0) + v.n);
  // how varied the blocks were: the distinct block contents seen per constructor (a test that only ever sees the set-up's bytes proves little)
  for (const [i] of d.P.world.records.entries()) for (const n of nativeNodes(d.emu, i)) {
    if (only && !only.has(n.ctor)) continue;
    const b = origBlock(d.emu, n);
    if (!b) continue;
    const k = '0x' + n.ctor.toString(16);
    let st = cover.distinct.get(k); if (!st) cover.distinct.set(k, (st = new Set()));
    if (st.size < 100000) st.add(hex(b));
  }
}
/**
 * `origBlock` (tools/lib/m8-save.mjs) takes a fresh 8 byte cell and, for the buffer protocol (the horse returns -1), a fresh 0x20000 byte buffer from the machine's heap on EVERY call; a long duel
 * that compares blocks at thousands of moments would exhaust the mapped heap. While `fn` runs, the scratch memory of the serializer / loader calls is reused (the same cell / buffer every time;
 * the machine's own allocations are not affected: the original `alloc` is put back afterwards).
 */
function scratch(emu, fn) {
  const alloc = emu.alloc;
  const st = (emu.scratchMem ??= {});
  emu.alloc = (n) => {
    if (n === 8) return st.cell ??= alloc.call(emu, 8);
    if (n === 0x20000) return st.buf ??= alloc.call(emu, 0x20000);
    if (n <= 0x400) return st.load ??= alloc.call(emu, 0x400);          // origLoad's copy of a block (the loader reads it at once)
    return alloc.call(emu, n);
  };
  try { return fn(); } finally { emu.alloc = alloc; }
}
const newCover = () => ({ rosters: 0, distinct: new Map(), blocks: 0, moments: 0, trips: 0, loaded: 0, ctors: new Map(), ticks: 0 });

const __test = {
  name: 'm8-save-csi',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = newCover();

    // ================================================================ 1. rats + goblets (the m5-z07CSI-pickups scenarios)
    if (PARTS.has('rats')) {
      const RATS = Array.from({ length: 10 }, (_, k) => 57 + k), GOBLETS = Array.from({ length: 10 }, (_, k) => 184 + k);
      const ONLY = new Set([NATIVE_CTORS.RAT, NATIVE_CTORS.GOBLET]);
      for (const [dt, seed] of [[1, 12345], [1, 777], [0.5, 4242]]) {
        const d = makeCsiDuel(ctx, { node: 15, seed, dt, failures, maxFail: MAXFAIL, kinds: [NATIVE_CTORS.RAT, NATIVE_CTORS.GOBLET], keepKinds: ['Rat', 'Goblet'] });
        d.label = `rats dt${dt} seed${seed}`;
        const W = d.P.world, scale = dt === 1 ? 1 : 2;
        const first = GOBLETS.find((i) => W.records[i].ctrl?.nodes.some((n) => n.kind === 'Goblet'));
        W.records[first].ctrl.nodes.find((n) => n.kind === 'Goblet').startEmitter(d.P.fx, W.records[first]);
        const compare = () => { for (const i of [...RATS, ...GOBLETS]) d.rec(i, 0xffff, 1e-6); d.vars(); if (d.olog) d.sounds(); };
        blocks(d, ONLY, cover);                                         // right after the constructors
        let rt = null;
        for (let t = 0; t < 1500 * scale; t++) {
          if (t > 0 && t % (300 * scale) === 0) {
            const i = RATS[(t / (300 * scale)) % RATS.length];
            for (const w of [W, d.O.world]) { const r = w.records[i]; r.m[12] += 40; r.m[14] -= 25; }
            d.emu.putRecord(i, d.O.world.records[i]); d.emu.sync();
          }
          // every 500 ticks Pepper stands on the next goblet for a few ticks (pick-up, the 3 ticks of the twinkle, the bit stored)
          if (t % (150 * scale) === 40 * scale) { const g = GOBLETS[((t / (150 * scale)) | 0) % GOBLETS.length], r = W.records[g]; if (r.ctrl) d.placePepper(r.x, r.y, r.z, 0); }
          if (t % (150 * scale) === 90 * scale) d.placePepper(0, 0, 0, 0);
          d.tick(0); cover.ticks++; compare();
          if (t % (4 * scale) === 0) blocks(d, ONLY, cover);
          // the load round trip (the loaders of the rats / goblets): the state of tick t, 120 ticks on, back to the snapshot of tick t, then the duel goes on comparing
          if (t === 250 * scale || t === 700 * scale || t === 1100 * scale) {
            const snap = scratch(d.emu, () => snapshotBlocks(d.emu, W, ONLY));
            for (let k = 0; k < 120 * scale; k++) { d.tick(0); cover.ticks++; compare(); }
            blocks(d, ONLY, cover);
            const n = scratch(d.emu, () => restoreBlocks(W, d.emu, snap));
            cover.loaded += n; cover.trips++;
            blocks(d, ONLY, cover);
            for (const s of snap) {
              const rec = W.records[s.i], pn = rec.ctrl.nodes.filter((q) => q.ctor !== undefined)[s.k];
              d.checked++;
              if (hex(pn.saveBlock()) !== hex(s.bytes)) d.fail(`${d.label} t${d.t} rec ${s.i}: port block after load ${hex(pn.saveBlock())} != snapshot ${hex(s.bytes)}`);
            }
          }
        }
        // a few hundred ticks of Pepper standing on goblets after the last restore are covered by the loop above
        checked += d.checked;
        notes.push(`${d.label}: ${d.nfail} failures`);
      }
    }

    // ================================================================ 2. the horse ride (the m5-z07CSI-horse-ride scenarios): Control, rider, horse, saddles
    if (PARTS.has('horse')) {
      const HORS = 48, PEPP = 7, JKIT = 46, SADDLES = [51, 52, 53];
      const KEYS = [0, 0, BC.UP, BC.UP, BC.UP, BC.DOWN, BC.LEFT, BC.RIGHT, BC.UP | BC.LEFT, BC.UP | BC.RIGHT, BC.SPACE, BC.ALT, BC.UP | BC.ALT, BC.UP | BC.SPACE, BC.CTRL];
      const ONLY = new Set([NATIVE_CTORS.CONTROL, NATIVE_CTORS.HORSE, NATIVE_CTORS.RIDER, NATIVE_CTORS.SADDLE]);
      const hc = { mounts: 0, dismounts: 0, ridden: 0, spotsSeen: new Set() };
      for (const [dt, seed, node, ticks] of [[1, 5, 21, 6000], [1, 99, 22, 5000], [0.5, 31, 25, 4000]]) {
        const d = makeCsiDuel(ctx, {
          node, seed, dt, failures, maxFail: MAXFAIL, chain: true, kinds: [NATIVE_CTORS.CONTROL, NATIVE_CTORS.HORSE, NATIVE_CTORS.RIDER, NATIVE_CTORS.SADDLE],
          keepKinds: ['Horse'], pepperKinds: ['Control', 'Horse'], vars: { 0xa3: 7 }, extraExec: [[0x461000, 0x466800]],
          beforeAttach: (dd) => {
            const P = dd.P.world.records, Ow = dd.O.world.records;
            for (let i = 0; i < P.length; i++) {
              Ow[i].m.set(P[i].m); Ow[i].rx = P[i].rx; Ow[i].ry = P[i].ry; Ow[i].rz = P[i].rz; Ow[i].flags = P[i].flags;
              dd.emu.putRecord(i, Ow[i]);
              if (P[i].anim && Ow[i].anim) Ow[i].anim.start(P[i].anim.clip, P[i].anim.frame);
            }
          },
        });
        d.label = `ride n${node} dt${dt} seed${seed}`;
        horseAxes.x = 0; horseAxes.y = 0;
        const W = d.P.world, mem = d.emu.cpu.mem, G = d.P.G;
        const hp = W.records[HORS], pp = W.records[PEPP];
        // Pepper's chain in the oracle has the walk node's stub (a raw node, ctor 0, `emu.stub`) between Control and the rider: the port's chain gets the same placeholder (gate PEPPER_CONTROL & 1,
        // returns 1 like the stub) so that the two lists have the same shape and the nodes after it are compared
        {
          const nodes = W.records[PEPP].ctrl.nodes, at = nodes.findIndex((n) => n.kind === 'Control') + 1;
          nodes.splice(at, 0, { kind: 'WalkStub', ctor: 0, var: 0x5e, mask: 1, value: 1, stamp: 0xfffffffe, update: () => 1 });
        }
        const pnode = d.pnode(HORS, 'Horse');
        pnode.setupApplied = true;
        for (const i of SADDLES) d.pnode(i, 'Horse').setupApplied = true;
        const rnd = lcgC(seed * 17 + 3);
        const scale = dt === 1 ? 1 : 2;
        d.reseed(seed);
        d.P.ictx.inFrustum = (rec) => (rec.flags & 1) !== 0;
        for (const r of [hp, d.O.world.records[HORS]]) r.flags |= 2;
        mem.w16(RB + HORS * RC + 0x60, mem.r16(RB + HORS * RC + 0x60) | 2);
        const putHorse = (x, z, ry) => {
          const y = W.col.terrainHeight(x, 200, z, 0);
          for (const r of [hp, d.O.world.records[HORS]]) { r.setEuler(0, ry, 0, x, y > -1e30 ? y : 0, z); r.rx = 0; r.ry = f32C(ry); r.rz = 0; }
          d.emu.putRecord(HORS, d.O.world.records[HORS]);
          mem.w16(RB + HORS * RC + 0x60, d.O.world.records[HORS].flags & 0xffff);
          d.emu.sync();
        };
        const { land: LAND } = castleSpots(W);
        const landSpot = () => LAND[Math.floor(rnd() * LAND.length)];
        const putPepper = (x, z) => { const y = W.col.terrainHeight(x, 200, z, 0); d.placePepper(x, y > -1e30 ? y : 0, z, rnd() * 6.28 - 3.14); };
        const fl = (a, b, name) => { d.checked++; const x = f32C(b); if (!(a === x || (Number.isNaN(a) && Number.isNaN(x)))) d.fail(`${d.label} t${d.t} ${name}: original ${a} port ${b}`); };
        const it = (a, b, name) => { d.checked++; if (a !== b) d.fail(`${d.label} t${d.t} ${name}: original ${a} port ${b}`); };
        const compare = () => {
          for (const i of [HORS, PEPP, JKIT, ...SADDLES, G.board]) {
            const a = RB + i * RC, r = W.records[i];
            for (let k = 0; k < 16; k++) fl(mem.f32(a + 0xc + 4 * k), r.m[k], `${r.name}.m[${k}]`);
            fl(mem.f32(a + 0x4c), r.rx, `${r.name}.rx`); fl(mem.f32(a + 0x50), r.ry, `${r.name}.ry`); fl(mem.f32(a + 0x54), r.rz, `${r.name}.rz`);
            it(mem.r16(a + 0x60), r.flags & 0xffff, `${r.name}.flags`);
            const ao = d.O.world.records[i].anim, ap = r.anim;
            if (ao && ap) { it(ao.clip, ap.clip, `${r.name} clip`); fl(ao.frame, ap.frame, `${r.name} frame`); }
          }
          d.vars(); d.globals();
          if (d.olog) d.sounds();
        };
        blocks(d, ONLY, cover);
        compare();
        let held = 0, hold = 0;
        const tickOnce = (t, free) => {
          const mode = W.vars.get(0x5e) & 0xfff;
          if (t % (3 * scale) === 0) {
            const r = rnd();
            if (mode === 1 || mode === 0x401) {
              if (r < 0.45) { const ang = rnd() * 6.28, rr = 1 + rnd() * 6; putPepper(hp.x + Math.cos(ang) * rr, hp.z + Math.sin(ang) * rr); d.setState([0x1b, 0x1b, 1, 0x24][Math.floor(rnd() * 4)], false); }
              else if (r < 0.52) { const [x, z] = landSpot(); putHorse(x, z, rnd() * 6.28 - 3.14); }
              else if (r < 0.56) d.setState([0x1b, 0x62, 1, 0x57][Math.floor(rnd() * 4)], false);
              held = rnd() < 0.5 ? BC.CTRL : 0;
            } else if (mode === 0x10) {
              if (r < 0.04) { const [x, z] = landSpot(); putHorse(x, z, rnd() * 6.28 - 3.14); }
              else if (r < 0.07) d.setVar(0x58, [0x11, 0x15, 0x16, 0x17, 0x18, 0x19][Math.floor(rnd() * 6)]);
              if (hold-- <= 0) { held = KEYS[Math.floor(rnd() * KEYS.length)]; hold = 1 + Math.floor(rnd() * 12); }
            } else {
              d.setVar(0x5e, 1); d.setState(0x1b, false); const ang = rnd() * 6.28; putPepper(hp.x + Math.cos(ang) * 3, hp.z + Math.sin(ang) * 3); held = 0;
            }
          }
          let press = held;
          if (mode === 0x10 && (held & BC.CTRL) !== 0) {
            const p = W.records[PEPP];
            if (!(W.col.terrainHeight(p.x, p.y + 80, p.z, 0) > W.seaLevel + 1)) press = 0;
          }
          d.tick(press); cover.ticks++;
          compare();
          const after = W.vars.get(0x5e) & 0xfff;
          if (mode !== 0x10 && after === 0x10) hc.mounts++;
          if (mode === 0x10 && after === 0x401) hc.dismounts++;
          if (after === 0x10) hc.ridden++;
          if (mode === 0x10 && after === 0x401) { const s = pnodeControl(); hc.spotsSeen.add(s.join()); }
        };
        const pnodeControl = () => W.records[PEPP].ctrl.nodes.find((n) => n.kind === 'Control').spot;
        for (let t = 0; t < ticks * scale; t++) {
          tickOnce(t);
          if (t % (3 * scale) === 1) blocks(d, ONLY, cover);
          // load round trips at six moments of the ride (riding, walking, jumping ...): the snapshot, 150 ticks on, the snapshot back into both machines, the duel goes on
          if (t > 0 && t % (900 * scale) === 450 * scale) {
            const snap = scratch(d.emu, () => snapshotBlocks(d.emu, W, ONLY));
            for (let k = 0; k < 150 * scale; k++) tickOnce(t + 1 + k);
            blocks(d, ONLY, cover);
            // the roster the loader of Control re-derives (FUN_005b2a00 -> FUN_004202ef: the stored look of each roster variable applied to its cycler): the variables hold other looks when the
            // loader runs. (The original's cycler handles are the sentinel 0xbabababa in this machine, the SwapText bank is not loaded: FUN_00443810 / FUN_004439f0 return at once, so the original's
            // roster state is not observable here; the port's roster is checked against the decompile's rule `part = var & 0xff, variant = var >> 8`.)
            const looksBefore = looksOf(W);
            const want = { 0xae: 0x0105 + (t % 3), 0xd7: 0x0203, 0x34: 0x0001 };
            for (const [v, x] of Object.entries(want)) d.setVar(+v, x);
            const n = scratch(d.emu, () => restoreBlocks(W, d.emu, snap));
            if (looksBefore) for (const e of looksBefore.entries) {
              d.checked++;
              const x = want[e.varIdx];
              if (x !== undefined && (e.part !== (x & 0xff) || e.variant !== x >> 8)) d.fail(`${d.label} t${d.t} roster entry var 0x${e.varIdx.toString(16)}: port look ${e.part}/${e.variant}, the loader's rule gives ${x & 0xff}/${x >> 8}`);
              if (looksBefore.busy.some((b) => b !== -1)) d.fail(`${d.label} t${d.t} roster busy list not cleared by the loader`);
              cover.rosters++;
            }
            cover.loaded += n; cover.trips++;
            blocks(d, ONLY, cover);
            for (const s of snap) {
              if (!s.bytes) continue;
              const rec = W.records[s.i], pn = rec.ctrl.nodes.filter((q) => q.ctor !== undefined)[s.k];
              d.checked++;
              const pb = pn.saveBlock?.(W, rec, rec.ctrl);
              if (pb && hex(pb) !== hex(s.bytes)) d.fail(`${d.label} t${d.t} rec ${s.i} ctor 0x${s.ctor.toString(16)}: port block after load ${hex(pb)} != snapshot ${hex(s.bytes)}`);
            }
            d.vars();
          }
        }
        checked += d.checked;
        notes.push(`${d.label}: ${d.nfail} failures`);
      }
      notes.push(`ride coverage: mounts ${hc.mounts}, dismounts ${hc.dismounts}, ridden ticks ${hc.ridden}, distinct dismount spots ${hc.spotsSeen.size}`);
      for (const k of ['mounts', 'dismounts', 'ridden']) if (hc[k] < 10) failures.push(`coverage: ${k} only ${hc[k]}`);
    }

    // ================================================================ 3. the Adventure Island (the m5-z13CAI-emu scenarios): pepswitc, the gulls, the flowing water
    if (PARTS.has('cai')) {
      const ONLY = new Set([CAI_CTORS.PEPSWITC, CAI_CTORS.GULL, CAI_CTORS.FLOW]);
      const POOL = [BI.SPACE, BI.SPACE, BI.SPACE | BI.LEFT, BI.SPACE | BI.RIGHT, BI.LEFT, BI.RIGHT, BI.ALT, BI.ALT | BI.LEFT, BI.UP, BI.DOWN, BI.UP | BI.SPACE, BI.DOWN | BI.SPACE, 0, 0, BI.SPACE | BI.UP | BI.LEFT];
      const GULLS = Array.from({ length: 16 }, (_, k) => 24 + k);
      const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
      const ct = { gullStates: new Set(), turns: new Set(), trips: 0 };
      const session = (label, o, dt) => {
        const d = makeCaiDuel(ctx, { ...o, dt, maxFail: MAXFAIL, failures });
        d.label = label;
        const W = d.P.world, mem = d.emu.cpu.mem, G = vehicles(W);
        const vehIdx = G.current ? G.current.index : -1;
        const heli = vehIdx >= 0 ? W.records[vehIdx] : null;
        const compare = () => {
          for (const i of GULLS) {
            d.rec(i, 0xffff, 1e-5);
            const pn = W.records[i].ctrl?.nodes.find((n) => n.kind === 'Gull');
            if (pn) { ct.gullStates.add(pn.state); ct.turns.add(pn.turn); }
          }
          d.rec(d.P.pepper.index, 0xffff, 1e-4);
          if (vehIdx >= 0) d.rec(vehIdx, 0xffff, 1e-4);
          d.globals(); d.vars();
        };
        const syncPort = () => {
          if (!o.sync) return;
          for (const i of [vehIdx, d.P.pepper.index]) if (i >= 0) d.recToPort(i);
          d.cameraToPort();
          for (const i of [vehIdx, d.P.pepper.index]) { const oa = d.O.world.records[i]?.anim, pa = W.records[i]?.anim; if (oa && pa && oa.clip === pa.clip) pa.frame = oa.frame; }
          const onodeOf = (rec, ctor) => d.emu.nodeOf.get(rec)?.find((n) => n.ctor === ctor)?.ptr ?? 0;
          const pn = heli?.ctrl?.nodes.find((n) => n.kind === 'SGHeli'), a = onodeOf(vehIdx, CAI_CTORS.HELI);
          const pt = heli?.ctrl?.nodes.find((n) => n.kind === 'Ptera'), pa = onodeOf(vehIdx, CAI_CTORS.PTERA);
          if (pt && pa) d.nodeToPort(pt, pa, { yawRate: [0x1c, 'f'], pitchRate: [0x24, 'f'], bounceT: [0x28, 'f'], speed: [0x38, 'f'], ground: [0x40, 'f'] });
          if (pn && a) d.nodeToPort(pn, a, { vx: [0x1c, 'f'], vy: [0x20, 'f'], vz: [0x24, 'f'], rotorMain: [0x2c, 'f'], rotorTail: [0x30, 'f'], wobble: [0x34, 'f'], engineHz: [0x38, 'f'] });
        };
        let nstep = 0;
        const step = (held) => { syncPort(); d.tick(held); cover.ticks++; compare(); if (++nstep % 3 === 0) blocks(d, ONLY, cover); };
        // snapshot / 150 ticks (keys) / restore into both machines / the duel goes on
        const trip = (keys, n) => {
          const snap = scratch(d.emu, () => snapshotBlocks(d.emu, W, ONLY));
          for (let k = 0; k < n; k++) step(keys());
          blocks(d, ONLY, cover);
          // pepswitc's loader (FUN_0061c266 -> FUN_006277a0 = FUN_004202ef(0x914bc8)) re-applies the stored look of the roster variable (0xd2, PHEL) to its cycler: another look in the variable
          // when the loader runs (the original's cycler is the sentinel in this machine, see the castle part: the port is checked against the decompile's rule)
          const looksBefore = looksOf(W), want = 0x0102 + (nstep % 3);
          d.setVar(0xd2, want);
          const loaded = scratch(d.emu, () => restoreBlocks(W, d.emu, snap));
          if (looksBefore) for (const e of looksBefore.entries) {
            d.checked++; cover.rosters++;
            if (e.varIdx === 0xd2 && (e.part !== (want & 0xff) || e.variant !== want >> 8)) d.fail(`${d.label} t${d.t} roster entry var 0xd2: port look ${e.part}/${e.variant}, the loader's rule gives ${want & 0xff}/${want >> 8}`);
            if (looksBefore.busy.some((b) => b !== -1)) d.fail(`${d.label} t${d.t} roster busy list not cleared by the loader`);
          }
          cover.loaded += loaded; cover.trips++; ct.trips++;
          blocks(d, ONLY, cover);
          for (const s of snap) {
            if (!s.bytes) continue;
            const rec = W.records[s.i], pn = rec.ctrl.nodes.filter((q) => q.ctor !== undefined)[s.k];
            d.checked++;
            const pb = pn.saveBlock?.(W, rec, rec.ctrl);
            if (pb && hex(pb) !== hex(s.bytes)) d.fail(`${d.label} t${d.t} rec ${s.i} ctor 0x${s.ctor.toString(16)}: port block after load ${hex(pb)} != snapshot ${hex(s.bytes)}`);
          }
        };
        return { d, W, mem, G, heli, vehIdx, step, trip };
      };

      // ---- 1. the free flight (node 33): the gulls circle, pepswitc plays its sounds: blocks after the constructors, every 3 ticks, three load round trips
      for (const dt of [1, 0.5]) {
        const S = session(`cai fly dt${dt}`, { node: 33, seed: 777, sync: true }, dt);
        const { d, step, trip } = S, scale = dt === 1 ? 1 : 2;
        const rnd = lcgI(4242), keys = randomKeys(rnd, POOL, 20 * scale);
        blocks(d, ONLY, cover);
        for (let t = 0; t < 30 * scale; t++) step(0);
        for (let t = 0; t < 900 * scale; t++) {
          step(keys());
          if (t === 250 * scale || t === 520 * scale || t === 760 * scale) trip(keys, 120 * scale);
        }
        checked += d.checked; notes.push(`${d.label}: ${d.nfail} failures`);
      }
      // ---- 2. landing on the pad: PEPPER_CONTROL 1, pepswitc sets var 5 = 11
      for (const dt of [1, 0.5]) {
        const S = session(`cai land dt${dt}`, { node: 33, seed: 99, sync: true }, dt);
        const { d, W, G, heli, step, trip } = S, scale = dt === 1 ? 1 : 2;
        const pad = berthPos(G.pads[0]);
        const spot = [pad[0] - 130, pad[1] + 45, pad[2] + 60];
        for (const [world, isOracle] of [[W, false], [d.O.world, true]]) {
          const r = world.records[heli.index];
          r.setEuler(0, Math.atan2(pad[0] - spot[0], pad[2] - spot[2]), 0, spot[0], spot[1], spot[2]); r.rx = 0; r.ry = Math.atan2(pad[0] - spot[0], pad[2] - spot[2]); r.rz = 0;
          if (isOracle) d.emu.putRecord(heli.index, r);
        }
        d.emu.sync();
        for (let t = 0; t < 30 * scale; t++) step(0);
        const pn = heli.ctrl.nodes.find((n) => n.kind === 'SGHeli');
        for (let t = 0; t < 900 * scale && pn.state !== 2; t++) {
          const dx = pad[0] - heli.x, dz = pad[2] - heli.z, dist = Math.hypot(dx, dz), ang = wrap(Math.atan2(dx, dz) - heli.ry);
          let k = 0;
          if (ang > 0.1) k |= BI.RIGHT; else if (ang < -0.1) k |= BI.LEFT;
          if (Math.abs(ang) < 0.6 && dist > 60) k |= BI.SPACE;
          if (dist <= 60 && Math.abs(ang) < 0.6) { step(k | BI.CTRL); break; }
          step(k);
        }
        for (let t = 0; t < 600 * scale && W.vars.get(0x5e) !== 1; t++) step(0);
        // PEPPER_CONTROL 1: pepswitc has set NEXT_SUBGAME = the Oasis; a load round trip right there
        trip(() => 0, 40 * scale);
        for (let t = 0; t < 20 * scale; t++) step(0);
        checked += d.checked; notes.push(`${d.label}: landed ${W.vars.get(0x5e) === 1}, var 5 = ${W.vars.get(5)}, ${d.nfail} failures`);
      }
      // ---- 3. the Ptera arrival and the rescue helicopter
      for (const [label, vars] of [['rhel', { 0xbb: 1 }], ['ptera', { 0xbb: 2 }]]) {
        const S = session(`cai ${label}`, { node: 33, seed: 31, vars, sync: true }, 1);
        const { d, step, trip } = S;
        const rnd = lcgI(777), keys = randomKeys(rnd, POOL, 20);
        blocks(d, ONLY, cover);
        for (let t = 0; t < 20; t++) step(0);
        for (let t = 0; t < 500; t++) { step(keys()); if (t === 200) trip(keys, 100); }
        checked += d.checked; notes.push(`${d.label}: ${d.nfail} failures`);
      }
      notes.push(`cai coverage: gull states ${[...ct.gullStates].map((x) => x.toString(16))}, distinct turns ${ct.turns.size}, round trips ${ct.trips}`);
    }

    notes.push(`blocks compared ${cover.blocks} at ${cover.moments} moments, roster checks ${cover.rosters}, load round trips ${cover.trips} (${cover.loaded} node loads), ticks ${cover.ticks}; by ctor ${[...cover.ctors].map(([k, v]) => `${k}:${v}`).join(' ')}; distinct block contents seen ${[...cover.distinct].map(([k, v]) => `${k}:${v.size}`).join(' ')}`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
