// WP-SAVE (worker d): the "pop in" node of the era 2 / 3 buildings (ctor FUN_00534b89, vtable 0x8eac08: update FUN_005341f4, pre-render FUN_00534409, loader FUN_00534ae0, saver FUN_00534a0a) of
// src/island/trigger/building.ts (`PopInNode`) against the ORIGINAL's code run natively in the x86 emulation. The node never runs in the shipped game (its constructor gates it with var 1 & 0 == 1), so the
// duel OPENS the gate in both machines (the original's gate value word +0xe := 0, the port's `unlockGate`): update / pre-render / the matrix FUN_0053436c then run for real. Scenarios: every flag
// combination of the node (+0x14: scale axes 1 / 2 / 4, height bounce 8, spin axes 0x10 / 0x20 / 0x40, shrink 0x100) with and without a running cutscene (FUN_0045c432: the animation only plays while a
// cutscene runs, otherwise the first pre-render finishes it), the target record visible / hidden. Compared per tick, tolerance 0: the node's save block (the original's saver vs `saveBlock`: 72 bytes), the
// target record's matrix / Euler angles / flags; the loaders: the block of the original is put into both machines (original loader natively incl. FUN_00419a79's record lookup, port `loadBlock`) in the middle of the scenarios.
import { trigDuel, trigTick, lcg } from '../lib/m7-isl-veh-trig.mjs';
import { m8Hook, m8Note } from '../lib/m8-d.mjs';
import { compareBlocks, snapshotBlocks, restoreBlocks, nativeNodes, portNodes } from '../lib/m8-save.mjs';
import { RECORDS_BASE, REC } from '../lib/m7-isl-veh-emu.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const CTOR = 0x534b89;
const FLAGS = [0x27, 0x127, 0x0f, 0x08, 0x01, 0x02, 0x04, 0x10, 0x20, 0x40, 0x70, 0x117, 0x147, 0x03, 0x2c, 0x100, 0x28];

const __test = {
  name: 'm8-save-popin',
  async run(ctx) {
    const failures = [], notes = [], m8Stats = [];
    let checked = 0;
    const cover = { sessions: 0, scenarios: 0, ticks: 0, activations: 0, finishes: 0, animTicks: 0, loads: 0 };
    for (const [era, node] of [2, 0x20, 0x36].entries()) {
      const d = trigDuel(ctx, { node, dt: 1, bldg: true, keepKinds: ['building.popin'], oracleCtors: new Set([CTOR]), maxFail: 30, failures, draw: true });
      d.label = `popin n${node}`; cover.sessions++;
      m8Stats.push(m8Hook(d, [CTOR], failures, { label: d.label, every: 1e9, period: 61, hold: 23 }));
      const W = d.P.world, mem = d.emu.cpu.mem;
      const rnd = lcg(900 + era), pick = (n) => Math.floor(rnd() * n);
      const pairs = [];
      for (const a of d.O.profile.island.attaches) {
        if (a.ctor !== CTOR || !a.hasController) continue;
        const k = pairs.filter((q) => q.rec === a.record).length;
        const o = nativeNodes(d.emu, a.record).filter((x) => x.ctor === CTOR)[k], p = portNodes(W.records[a.record]).filter((x) => x.ctor === CTOR)[k];
        if (!o || !p) { failures.push(`${d.label}: no node pair for record ${a.record} (${W.records[a.record]?.name})`); continue; }
        pairs.push({ a, o, p, rec: a.record });
      }
      if (!pairs.length) { notes.push(`${d.label}: no pop-in node`); continue; }
      // the gate of the constructor (var 1, mask 0, value 1) is checked, then opened in both machines
      for (const pr of pairs) {
        checked += 3;
        if (mem.r32(pr.o.ptr) !== 1 || mem.r16(pr.o.ptr + 0xc) !== 0 || mem.r16(pr.o.ptr + 0xe) !== 1) failures.push(`${d.label} ${W.records[pr.rec].name}: original gate var ${mem.r32(pr.o.ptr)} mask ${mem.r16(pr.o.ptr + 0xc)} value ${mem.r16(pr.o.ptr + 0xe)} (expected 1 / 0 / 1)`);
        if (pr.p.var !== 1 || pr.p.mask !== 0 || pr.p.value !== 1) failures.push(`${d.label} ${W.records[pr.rec].name}: port gate ${pr.p.var} / ${pr.p.mask} / ${pr.p.value} (expected 1 / 0 / 1)`);
        mem.w16(pr.o.ptr + 0xe, 0); pr.p.unlockGate(1, 0, 0);
        // the node's own update gate +0x1c / +0x1e is 0xCD / 0xCD in the original (never written): never open; the scenarios open it
        if (mem.r16(pr.o.ptr + 0x1c) !== 0xcdcd || mem.r16(pr.o.ptr + 0x1e) !== 0xcdcd || pr.p.m1c !== -12851 || pr.p.v1e !== -12851) failures.push(`${d.label}: the update gate words are not 0xCD`);
        mem.w16(pr.o.ptr + 0x1c, 0); mem.w16(pr.o.ptr + 0x1e, 0); pr.p.m1c = 0; pr.p.v1e = 0;
        // the constructor's own flags / variable arguments
        if (mem.r32(pr.o.ptr + 0x14) !== pr.p.flags || (mem.r32(pr.o.ptr + 0x18) | 0) !== pr.p.speedVar) failures.push(`${d.label} ${W.records[pr.rec].name}: flags / speed var original ${mem.r32(pr.o.ptr + 0x14)} / ${mem.r32(pr.o.ptr + 0x18) | 0} port ${pr.p.flags} / ${pr.p.speedVar}`);
      }
      const only = new Set([CTOR]);
      const snap0 = d.m8scratch(() => snapshotBlocks(d.emu, W, only));
      const cmpBlocks = (what) => { const r = d.m8scratch(() => compareBlocks(W, d.emu, `${d.label} ${what} t${d.t}`, only)); checked += r.checked; for (const f of r.failures.slice(0, 3)) if (failures.length < 30) failures.push(f); };
      const setVis = (i, on) => { const r = W.records[i]; r.flags = on ? (r.flags | 2) : (r.flags & ~2); const a = RECORDS_BASE + i * REC + 0x60, v = mem.r16(a); mem.w16(a, on ? v | 2 : v & ~2); };
      for (const pr of pairs) {
        const ti = pr.p.target?.index ?? pr.rec;
        for (let sc = 0; sc < FLAGS.length * 2; sc++) {
          cover.scenarios++;
          const F = FLAGS[sc % FLAGS.length];
          mem.w32(pr.o.ptr + 0x14, F); pr.p.flags = F;
          d.m8scratch(() => restoreBlocks(W, d.emu, snap0)); cover.loads++;
          pr.p.ensureInit(W, W.records[pr.rec]);
          setVis(ti, pick(3) !== 0);
          const cut = sc >= FLAGS.length ? 1 : (pick(5) === 0 ? 0 : 1);   // second round: always a cutscene (the animation plays); first round mostly
          d.cutscene(!!cut);
          const n = 200;
          let wasActive = 0;
          for (let t = 0; t < n; t++) {
            if (cut && t === 140 + pick(30)) d.cutscene(false);
            trigTick(d, 0); cover.ticks++;
            cmpBlocks('block');
            d.rec(ti, 0xfffe);
            const act = mem.r8(pr.o.ptr + 0x60);
            if (act && !wasActive) cover.activations++;
            if (!act && wasActive) cover.finishes++;
            if (act) cover.animTicks++;
            wasActive = act;
          }
          d.cutscene(false);
        }
      }
      checked += d.checked;
      notes.push(`${d.label}: ${pairs.length} pop-in nodes (${pairs.map((q) => W.records[q.rec].name).join(' ')}); worst ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
    }
    for (const st of m8Stats) notes.push(m8Note(st));
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
