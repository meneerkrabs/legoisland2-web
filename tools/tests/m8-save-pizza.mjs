// WP-SAVE, pizza / speeder / footy / SUPE / train families (src/island/pizza/*): the save block (vtable +0x14) and the load (vtable +0x10) of
//   0x42887c Pizza (56 bytes)   0x42900b hand pizza (28)   0x429d1b carried prop (72)   0x538126 speeder (44)   0x5385d3 driver (8)   0x53955e football (132)   0x5399d8 flower (8)   0x539d44 bobbing balloon (12)
//   0x53c337 SUPE (44)   0x53d66c train (44)
// against the ORIGINAL's serializer / loader run natively in the x86 emulation (tools/lib/m8-save.mjs, tools/lib/m8-save-pizza.mjs). The machine allocates like the original: the debug heap fills fresh node blocks with 0xCD.
//   1. the state right after the set-up of every zone that has such nodes (the 5 island eras and the hubs z07CSI / z21FSH / z28HAT ...);
//   2. after GAMEPLAY: the family's duel tests (tools/tests/m7-isl-veh-pizza / -carry / -footy / -speeder / -supe / -train: the original's nodes natively next to the port's, tick by tick, all scenarios) run with a hook
//      that compares every node's block on every tick and does the load round trip every M8_RT ticks: snapshot of the ORIGINAL's blocks, a few ticks later restored into both machines (the original's loader natively,
//      the port's `loadBlock`), blocks equal again, and the duel goes on comparing (the node must behave like the original's node loaded from the same bytes).
//   M8_PIZZA=setup  (only 1)   M8_PIZZA=duel  (only 2)   M8_ONLY=0x42887c,...   M8_FAMILY=pizza,carry,footy,speeder,supe,train   M8_RT=53 (round trip period, 0 = off)
import { buildIslandOracle, buildHubOracle } from '../lib/m8-save.mjs';
import { Duel, B, REC, RECORDS_BASE } from '../lib/m7-isl-veh-emu.mjs';
import '../../src/island/pizza/index.ts';
import { withCdHeap, compareMasked, blockTick } from '../lib/m8-save-pizza.mjs';
import { setIslandRandom } from '../../src/island/rng.ts';

const MINE = new Set([0x42887c, 0x42900b, 0x429d1b, 0x538126, 0x5385d3, 0x53955e, 0x5399d8, 0x539d44, 0x53c337, 0x53d66c]);
const ONLY = process.env.M8_ONLY ? new Set(process.env.M8_ONLY.split(',').map(Number)) : MINE;
const ZONES = ['isl2', 'isl16', 'isl37', 'isl56', 'isl61', 'z07CSI', 'z13CAI', 'z14OSD', 'z16PYA', 'z23DIP', 'z40OGL'];
const FAMILIES = {
  pizza: 'm7-isl-veh-pizza', carry: 'm7-isl-veh-carry', footy: 'm7-isl-veh-footy', speeder: 'm7-isl-veh-speeder', supe: 'm7-isl-veh-supe', train: 'm7-isl-veh-train',
};

export default {
  name: 'm8-save-pizza',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const mode = process.env.M8_PIZZA ?? 'all';
    if (mode === 'all' || mode === 'setup') {
      const agg = new Map();
      try { await withCdHeap(async () => {
        for (const z of (process.env.M8_ZONES ? process.env.M8_ZONES.split(',') : ZONES)) {
          let B;
          try { B = z.startsWith('isl') ? buildIslandOracle(ctx, Number(z.slice(3))) : buildHubOracle(ctx, z); } catch (e) { notes.push(`${z}: oracle build failed: ${String(e.message).slice(0, 100)}`); continue; }
          // (the oracle's random source answers 0: SUPE's first destination is the table's entry 0; the port's constructor draws from the same source. Set after the island load, which installs its own)
          setIslandRandom(() => 0);
          const res = compareMasked(B.P.world, B.emu, z, ONLY);
          setIslandRandom(null);
          checked += res.checked;
          for (const f of res.failures.slice(0, 12)) failures.push(f);
          for (const [k, v] of res.byCtor) { const a = agg.get(k) ?? { n: 0, bad: 0, size: v.size }; a.n += v.n; a.bad += v.bad; agg.set(k, a); }
        }
      }); } finally { setIslandRandom(null); }
      for (const [k, v] of [...agg].sort((a, b) => Number(a[0]) - Number(b[0]))) notes.push(`setup ${k.padEnd(9)} block ${String(v.size).padStart(4)} bytes  nodes ${String(v.n).padStart(3)}  ${v.bad ? 'DIFFERENT ' + v.bad : 'ok'}`);
    }
    if (mode === 'all' || mode === 'duel') {
      const fam = (process.env.M8_FAMILY ?? Object.keys(FAMILIES).join(',')).split(',');
      const rt = process.env.M8_RT !== undefined ? Number(process.env.M8_RT) : 53;
      for (const f of fam) {
        const mod = (await import(`./${FAMILIES[f]}.mjs`)).default;
        await withCdHeap(async () => {
          const hook = blockTick(ONLY, { every: process.env.M8_EVERY ? Number(process.env.M8_EVERY) : f === 'supe' ? 3 : 1, roundTrip: rt });
          let res;
          try { res = await mod.run(ctx); } finally { hook.off(); }
          checked += res.checked;
          // (the duel tests' own coverage assertions "state X was visited" belong to the unperturbed run: the load round trips send a node back to an earlier state mid-scenario, which can keep a scripted path
          //  from reaching it; the unperturbed runs assert it in m7-isl-veh-*)
          const cov = res.failures.filter((x) => /^coverage:/.test(x));
          for (const x of res.failures) if (!/^coverage:/.test(x)) failures.push(`[${f}] ${x}`);
          if (cov.length) notes.push(`${f}: ${cov.length} coverage assertion(s) of the duel test not asserted here (round trips perturb the scripted path)`);
          const st = hook.stats;
          notes.push(`${f}: ${st.compares} block comparisons of ${st.nodes} nodes, ${st.restores} load round trips of ${st.restoredNodes} nodes; ${[...st.byCtor].map(([k, v]) => `${k}:${v.n}${v.bad ? '!' + v.bad : ''}`).join(' ')}`);
        });
      }
    }
    // the hand pizzas' record pointers (+0x20 reached, +0x24) are written by the NPC code of the island (not part of the duel tests): set them in both machines, then compare / round trip the blocks
    if (mode === 'all' || mode === 'poke') {
      await withCdHeap(async () => {
        const rt = process.env.M8_RT !== undefined ? Number(process.env.M8_RT) : 53;
        const d = new Duel(ctx, { node: 10, keepKinds: ['Pizza', 'PizzaHand', 'PizzaCarry'], keepRecords: (n) => /^(PIZ\d|CNST|RHCP|BRIK|PAPA|MAMA)$/.test(n), dt: 1, maxFail: 30, failures, draw: true, pepSwitc: false, seat: false, advancePepper: 1.0, exact: true });
        d.label = 'poke e1';
        const W = d.P.world, mem = d.emu.cpu.mem;
        const hands = ['PIZ3', 'PIZ4'].map((n) => W.records.findIndex((r) => r.name === n)).filter((i) => i >= 0 && d.pnode(i, 'PizzaHand'));
        const named = ['SIGN', 'TREE', 'BBB0', 'PIZ0'].map((n) => W.records.findIndex((r) => r.name === n)).filter((i) => i >= 0);
        let k = 0;
        const hook = blockTick(new Set([0x42900b]), { every: 1, roundTrip: rt, poke: () => {
          k++;
          hands.forEach((i, j) => {
            const pn = d.pnode(i, 'PizzaHand'), a = d.onode(i, 0x42900b);
            const r1 = named[(k + j) % named.length], r2 = k % 7 < 3 ? -1 : named[(k + 2 * j + 1) % named.length];
            pn.reached = r1 >= 0 ? W.records[r1] : null; mem.w32(a + 0x20, r1 >= 0 ? RECORDS_BASE + r1 * REC : 0);
            pn.link24 = r2 >= 0 ? W.records[r2] : null; mem.w32(a + 0x24, r2 >= 0 ? RECORDS_BASE + r2 * REC : 0);
          });
        } });
        try { for (let t = 0; t < 400; t++) d.tick(t % 90 === 3 ? B.SPACE : 0); } finally { hook.off(); }
        checked += d.checked;
        notes.push(`poke: ${hook.stats.compares} block comparisons of ${hook.stats.nodes} hand pizza nodes (reached / +0x24 record pointers set), ${hook.stats.restores} load round trips of ${hook.stats.restoredNodes} nodes`);
      });
    }
    return { checked, failures, notes };
  },
};
