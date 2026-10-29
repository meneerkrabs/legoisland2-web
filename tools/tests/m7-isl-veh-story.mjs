// WP-VERIFY M7 island: the story handler FUN_004b7040 (src/zones/z02LGI/story.ts + liveStoryEnv) against the ORIGINAL handler run natively in the x86 emulation (tools/lib/m7-isl-veh-story.mjs).
// Compared per call: return value, *next, *prev, the text-table calls (path strings), the objective globals (DAT_009da82c mode, DAT_009da830..3c records, DAT_008add70 node, DAT_009da840 radius^2),
// every record's 16-bit flag word, every store into the variable array (op + value) and the whole variable array, the hologram alert timer (DAT_05defbcc), the walker pins (FUN_0046140f / FUN_004625d7 arguments),
// the pizza-carry reset FUN_00429638 (node +0x20 / +0x24 / +0x2e / +0x34). Scenarios: all 73 story nodes x previous values {node-1 (just advanced), node-2, node+1, 0, -1, 72, the uninitialised 0xcccccccc} x cutscene
// on / off x seeded random flag words of the records the handler touches. The handler has no dt dependency (no reference to DAT_008b1718 in 0x4b7040..0x4b7b..: checked on the disassembly): it is run at both dt
// settings of the Duel (dt 1 and 0.5) only to show that the objective / record state does not depend on it.
import { storyDuel, origStory, portStory, setObjective, origTarget, portTarget } from '../lib/m7-isl-veh-story.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { pathPositions } from '../../src/zones/z02LGI/index.ts';
import { RECORDS_BASE, REC, VAR_ARRAY, VAR_COUNT, lcg, fr } from '../lib/m7-isl-veh-emu.mjs';

// records whose flag word the handler writes (DAT_00983804 + off): 0x4d8 0x610 0xc28 0x2de0 0x5a8 0x540 0xd60 0x1c00 0xcf8 (flags at +0x60)
const FLAG_RECS = [0x4d8, 0x610, 0xc28, 0x2de0, 0x5a8, 0x540, 0xd60, 0x1c00, 0xcf8].map((o) => (o - 0x60) / REC);
const WALKERS = [0x744, 0x7ac, 0x814, 0x87c, 0x8e4, 0x94c, 0xa84, 0xa1c, 0x9b4, 0xaec].map((o) => (o - 0x5c) / REC);
const PIZ_RECS = [(0x5a4 - 0x5c) / REC, (0x53c - 0x5c) / REC];

const _pp = new Map();
const portNode = (d, n) => { const f = (_pp.get(d) ?? _pp.set(d, pathPositions(d.O.archive)).get(d)); return f(n); };

export default {
  name: 'm7-isl-veh-story',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const devs = new Map();
    const cover = { cases: 0, justCases: 0, cutsceneCases: 0, exit2: 0, holo: 0, pins: 0, pizzaResets: 0, texts: 0, varWrites: 0, flagChanges: 0, objModes: new Set() };
    for (const dt of [1, 0.5]) {
      const d = storyDuel(ctx, { dt, failures, maxFail: 30 });
      const { emu } = d, mem = emu.cpu.mem, W = d.P.world;
      d.label = `story dt${dt}`;
      const rnd = lcg(dt === 1 ? 77 : 99);
      for (const r of WALKERS) d.dummyCtrl(r);
      const pizNodes = PIZ_RECS.map((i) => ({ i, o: d.onode(i, 0x429d1b), p: d.pnode(i, 'PizzaCarry') }));
      const eq = (what, a, b) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) d.fail(`${d.label} ${what}: original ${JSON.stringify(a)} port ${JSON.stringify(b)}`); };
      const prevs = (n) => [n - 1, n - 2, n + 1, 0, -1, 72, 0xcccccccc | 0];
      for (let node = 0; node <= 72; node++) {
        for (const prev of prevs(node)) for (const cut of [false, true]) {
          if (cut && prev !== node - 1 && prev !== 0xcccccccc << 0) continue;
          d.t++;
          // identical random flag words and node state both sides
          for (const r of FLAG_RECS) { const v = Math.floor(rnd() * 65536); mem.w16(RECORDS_BASE + r * REC + 0x60, v); W.records[r].flags = (W.records[r].flags & ~0xffff) | v; }
          for (const n of pizNodes) {
            const b = 1 + Math.floor(rnd() * 20), t = 1 + Math.floor(rnd() * 400);
            mem.w32(n.o + 0x20, b); mem.w32(n.o + 0x24, 0x10000000 + REC * 3); mem.w32(n.o + 0x34, t); mem.w16(n.o + 0x2e, 1);
            n.p.bone = b; n.p.carrier = W.records[3]; n.p.timer = t; n.p.pushPending = true;
          }
          mem.wf32(0x5defbcc, 0); d.goal.holoTimer = 0;
          const flagsBefore = W.records.map((r) => r.flags & 0xffff);
          const o = origStory(d, prev, node, cut);
          const p = portStory(d, prev, node, cut);
          d.fail0 = d.nfail;
          const tag = `node ${node} prev ${prev}${cut ? ' cutscene' : ''}`;
          cover.cases++; if (prev === node - 1) cover.justCases++; if (cut) cover.cutsceneCases++;
          eq(`${tag}: return`, o.ret, p.ret); eq(`${tag}: *next`, o.next, p.next); eq(`${tag}: *prev`, o.prev, p.prev);
          if (o.ret === 2) cover.exit2++;
          const otext = o.log.filter((l) => /^(free|npc|hol) /.test(l)), opin = o.log.filter((l) => /^(place|pin) /.test(l));
          eq(`${tag}: text tables`, otext, p.texts); cover.texts += otext.length;
          eq(`${tag}: walker pins`, opin, p.log.filter((l) => /^(place|pin) /.test(l))); cover.pins += opin.length / 2;
          const oholo = mem.f32(0x5defbcc);
          eq(`${tag}: hologram alert`, oholo, d.goal.holoTimer); if (oholo) cover.holo++;
          eq(`${tag}: var writes`, o.vw, p.vw); cover.varWrites += o.vw.length;
          // objective globals
          const g = d.goal, rp = (a) => { const v = mem.r32(a); return v ? (v - RECORDS_BASE) / REC : -1; };
          eq(`${tag}: objective mode`, mem.r32(0x9da82c), g.mode);
          eq(`${tag}: objective records`, [0x9da830, 0x9da834, 0x9da838, 0x9da83c].map(rp), g.recs);
          if (g.mode === 3 || mem.r32(0x9da82c) === 3) eq(`${tag}: objective path node`, mem.r32(0x8add70) | 0, g.node);
          checked++; if (Math.abs(mem.f32(0x9da840) - g.radiusSq) > 1e-3 * Math.max(1, g.radiusSq)) d.fail(`${d.label} ${tag}: objective radius^2 original ${mem.f32(0x9da840)} port ${g.radiusSq}`);
          if (!cut) cover.objModes.add(mem.r32(0x9da82c));
          // record flags and the variable array
          for (let r = 0; r < W.records.length; r++) { const ov = mem.r16(RECORDS_BASE + r * REC + 0x60), pv = W.records[r].flags & 0xffff; checked++; if (ov !== pv) d.fail(`${d.label} ${tag}: record ${r} (${W.records[r].name}) flags original ${ov.toString(16)} port ${pv.toString(16)}`); if (pv !== flagsBefore[r]) cover.flagChanges++; }
          d.vars();
          // the pizza resets (FUN_00429638(ctrl, 0, 0) on records 12 / 13): bone / carrier / timer / push flag of the carry nodes
          for (const n of pizNodes) {
            const orig = [mem.r32(n.o + 0x20), mem.r32(n.o + 0x24), mem.r32(n.o + 0x34), mem.r16(n.o + 0x2e)];
            const port = [n.p.bone, n.p.carrier ? 1 : 0, n.p.timer, n.p.pushPending ? 1 : 0];
            eq(`${tag}: record ${n.i} carry node +0x20/+0x24/+0x34/+0x2e`, [orig[0], orig[1] !== 0 ? 1 : 0, orig[3]], [port[0], port[1], port[3]]);
            if (orig[1] === 0 && orig[0] === 0 && orig[2] === 0) cover.pizzaResets++;
          }
        }
      }
      checked += d.checked;
      notes.push(`dt ${dt}: ${d.nfail} failures`);
    }
    // ---- the objective's target FUN_00424e37: modes 0 (nearest talk NPC) / 1 / 2 / 3 (PATH node) / 4 (nearest visible of four), walking and the vehicle branch (var 0x5e & 8, kind -1 / -2 / -3, docks / pads taken or free)
    {
      const d = storyDuel(ctx, { dt: 1, failures, maxFail: 30 });
      d.label = 'objective target';
      const { emu } = d, mem = emu.cpu.mem, W = d.P.world, G = vehicles(W);
      const rnd = lcg(4242), pick = (n) => Math.floor(rnd() * n);
      const tc = { mode3: 0, mode3Falsy: 0, cases: 0, modes: {}, vehicle: 0, noBerth: 0, talk: 0, none: 0, kinds: {} };
      // the berth tables the original's set-up wrote (nodes: shorts, maps: BYTES at DAT_009da9e4 / DAT_009daa2c: the decompile's `(&DAT_009da9e4)[k]` dword indexing is a Ghidra artefact; counts: bytes 0x9da9e9 / 0x9daa14)
      checked++; if (mem.r8(0x9da9e9) !== G.docks.length || mem.r8(0x9daa14) !== G.pads.length) d.fail(`berth counts: original ${mem.r8(0x9da9e9)} / ${mem.r8(0x9daa14)} port ${G.docks.length} / ${G.pads.length}`);
      for (let k = 0; k < G.docks.length; k++) { checked += 2; if ((mem.r16(0x9da9d4 + 2 * k) << 16 >> 16) !== G.docks[k].node || mem.r8(0x9da9e4 + k) !== G.docks[k].map) d.fail(`dock ${k}: original node ${mem.r16(0x9da9d4 + 2 * k)} map ${mem.r8(0x9da9e4 + k)} port ${G.docks[k].node} / ${G.docks[k].map}`); }
      for (let k = 0; k < G.pads.length; k++) { checked += 2; if ((mem.r16(0x9daa18 + 2 * k) << 16 >> 16) !== G.pads[k].node || mem.r8(0x9daa2c + k) !== G.pads[k].map) d.fail(`pad ${k}: original node ${mem.r16(0x9daa18 + 2 * k)} map ${mem.r8(0x9daa2c + k)} port ${G.pads[k].node} / ${G.pads[k].map}`); }
      // candidate records: controllers (flags 0x43 as the targetables), a head node of the generic NPC (vtable 0x8adce0 + talk50) or another one
      const cand = [12, 13, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 30, 31, 40];
      for (const i of cand) if (!W.records[i].ctrl) d.makeTarget(i);
      const heads = new Map();
      for (const i of cand) {
        if (i === 12 || i === 13) continue;     // their head is the pizza-carry node
        const ctrl = mem.r32(emu.recPtr(i) + 0x5c);
        const a = emu.rawNode(i, 0x8adce0, 0x60, { var: 2, mask: 0, value: 0 });
        W.records[i].ctrl.nodes = [{ kind: 'fakeNpc', ctor: 0x426151, talk50: 0, var: 2, mask: 0, value: 0, stamp: 0xfffffffe, update: () => 0 }];
        heads.set(i, { a, p: W.records[i].ctrl.nodes[0], ctrl });
      }
      void heads;
      const eq = (what, a, b) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) d.fail(`${d.label} ${what}: original ${JSON.stringify(a)} port ${JSON.stringify(b)}`); };
      const F = (v) => fr(v);
      for (let n = 0; n < 4000; n++) {
        // randomise the world state both sides
        for (const i of [...cand, 3, 5, 9]) {
          const r = W.records[i], a = RECORDS_BASE + i * REC;
          const en = rnd() < 0.75;
          const fl = (r.flags & 0xffff & ~2) | (en ? 2 : 0);
          mem.w16(a + 0x60, fl); r.flags = (r.flags & ~0xffff) | fl;
          const x = F((rnd() - 0.5) * 800), y = F(rnd() * 40), z = F((rnd() - 0.5) * 800);
          mem.wf32(a + 0x3c, x); mem.wf32(a + 0x40, y); mem.wf32(a + 0x44, z); r.m[12] = x; r.m[13] = y; r.m[14] = z;
          if (r.ctrl) {
            const cp = mem.r32(a + 0x5c), cf = [0x43, 0x41, 0x10, 0x40, 0x50, 0x02, 0][pick(7)], ds = F(rnd() < 0.15 ? [0, 8, 4, 8.5][pick(4)] : rnd() * 3000);
            mem.w32(cp + 0xc, cf); r.ctrl.flags = cf; mem.wf32(cp + 0x18, ds); r.ctrl.distSq = ds;
            const h = heads.get(i);
            if (h) { const talk = rnd() < 0.6, t50 = rnd() < 0.7 ? 1 + pick(5) : 0; mem.w32(h.a + 4, talk ? 0x8adce0 : 0x8adf08); mem.w16(h.a + 0x50, t50); h.p.ctor = talk ? 0x426151 : 0x1234; h.p.talk50 = t50; }
          }
        }
        const kind = [-1, -2, -3][pick(3)], ctl = [1, 1, 8, 9, 0x401][pick(5)];
        mem.w16(0x9da9fa, kind & 0xffff); G.kind = kind;
        mem.w32(VAR_ARRAY + 4 * 0x5e, ctl); W.vars.set(0x5e, ctl);
        for (let k = 0; k < G.docks.length; k++) { const tk = rnd() < 0.5; mem.w32(0x9da9fc + 4 * k, tk ? 1 : 0); G.docks[k].taken = tk; }
        for (let k = 0; k < G.pads.length; k++) { const tk = rnd() < 0.5; mem.w32(0x9daa50 + 4 * k, tk ? 1 : 0); G.pads[k].taken = tk; }
        // the objective
        const rv = () => [...cand, 3, 5, 9][pick(cand.length + 3)];
        const m = pick(5);
        if (m === 0) setObjective(d, { kind: 'record', a: -1 });
        else if (m === 1) setObjective(d, { kind: 'record', a: rv() });
        else if (m === 2) setObjective(d, { kind: 'pair', a: rv(), b: rv() });
        else if (m === 3) { d.pathPos ??= null; let node; do { node = pick(0x1b0); } while (!(portNode(d, node))); setObjective(d, { kind: 'node', node }); }
        else { const v = rv; setObjective(d, { kind: 'four', a: v(), b: v(), c: v(), d: v() }); }   // (a null record pointer in mode 4 crashes the original: FUN_00424e37 reads +0x60 of it; the story never sets one)
        const from = [3, 5, 9, 16][pick(4)];
        // the vehicle branch with no free berth reads FUN_00462be9(1, -1): the 0x20 bytes before the node array (the debug heap header): not observable in the emulation's bump heap: counted, not compared
        const vehBranch = (ctl & 8) !== 0 && kind !== -1;
        const nofree = vehBranch && m !== 2 && ((kind === -3 && G.pads.every((p) => p.taken)) || (kind === -2 && G.docks.every((p) => p.taken)) || (kind === -1));
        const o = origTarget(d, from), p = portTarget(d, from);
        tc.cases++; tc.modes[mem.r32(0x9da82c)] = (tc.modes[mem.r32(0x9da82c)] ?? 0) + 1; tc.kinds[kind] = (tc.kinds[kind] ?? 0) + (vehBranch ? 1 : 0);
        if (vehBranch) tc.vehicle++;
        if (nofree) { tc.noBerth++; continue; }
        // mode 3 (walking): FUN_00424e37 returns its never-assigned local at [ebp - 0x40] (stack residue, 0x4252bc): the return value is indeterminate, the written target (&DAT_009da690 with the node position) is compared
        const m3 = mem.r32(0x9da82c) === 3 && !vehBranch;
        if (m3) { tc.mode3++; eq(`case ${n} mode 3 target written`, [!!o.written, true], [true, p.ok]); if (o.written && p.ok) { eq(`case ${n} mode 3 position`, o.pos, p.pos.map(F)); if (!o.ok) tc.mode3Falsy++; } continue; }
        eq(`case ${n} (mode ${mem.r32(0x9da82c)}, ctl ${ctl}, kind ${kind}) found`, o.ok, p.ok);
        if (o.ok && p.ok) { eq(`case ${n} record`, o.record, p.record); eq(`case ${n} target position`, o.pos, p.pos.map(F)); if (mem.r32(0x9da82c) === 0 && !vehBranch) tc.talk++; } else tc.none++;
      }
      checked += d.checked;
      notes.push(`objective target: ${JSON.stringify(tc)}`);
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    cover.objModes = [...cover.objModes].sort().join(',');
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
