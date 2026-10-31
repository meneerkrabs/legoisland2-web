// M5 z07CSI, the castle's set-up and the shared node families with the castle's argument blocks (docs/re/m5/z07CSI.md):
//  (1) the world the framework + src/zones/z07CSI build for every story stage: Pepper's chain as the original's set-up attached it (Control, SGwalk, sgswim, skate, SGVehic [, Horse]), no stub
//      guard / island mode switch, the boat dock table of FUN_00573527 (ONE dock: PATH node 0x6f, exit 0x72), the board record DAT_009daa7c = 0x44, the roster (variant words), the hidden
//      decor templates, every attach of the emulated set-up either ported or in the list of the nodes other workers own (Horse);
//  (2) the arrival: from the island by speedboat, from the three mini-games on foot (the emulated places), tested against the values of docs/re/m5/foundation.md;
//  (3) the castle's MeetPepp nodes (the ten flags BFG0..7 / BBFG / PFLG: clips 1 / 2 looping, gate always open) against the ORIGINAL's FUN_00530d69 / FUN_005309c0 running natively.
import { readDecorTables, decorGroupOfZone } from '../../src/shell/tables.ts';
import { loadCsi, tick } from '../lib/m5-z07CSI-load.mjs';
import { makeCsiDuel } from '../lib/m5-z07CSI-emu.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { readHiddenList } from '../../src/zones/z07CSI/looks.ts';
import { guarded } from '../lib/inject-guard.mjs';

const STAGES = [15, 16, 17, 19, 20, 21, 22, 24, 25, 27, 28, 29];
/** the constructors the castle's set-up attaches that this worker does NOT own (the horse worker's src/zones/z07CSI/horse/**) */
const OTHER_OWNERS = new Set(['Horse']);

const __test = {
  name: 'm5-z07CSI-setup',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };

    // ---- (1) the world of every stage
    for (const node of STAGES) {
      const H = loadCsi(ctx, { node, vars: { 0xa3: node === 15 || node === 16 || node === 17 ? 0 : 7 } });
      const chain = H.pepper.ctrl.nodes.map((n) => n.kind);
      ok(chain[0] === 'Control' && !chain.includes('StubGuard') && !chain.includes('PepSwitc'), `node ${node}: Pepper's chain ${chain}`);
      ok(['SGwalk', 'sgswim', 'skate', 'SGVehic'].every((k) => chain.includes(k)), `node ${node}: the chain has the walk / swim / skate / seat nodes: ${chain}`);
      const gates = H.pepper.ctrl.nodes.map((n) => `${n.var.toString(16)}&${n.mask.toString(16)}=${n.value.toString(16)}`).join(' ');
      ok(/^5e&0=0 5e&1=1 5e&2=2 5e&4=4 5e&8=8/.test(gates), `node ${node}: the chain's gates ${gates}`);
      const G = vehicles(H.world);
      ok(G.docks.length === 1 && G.docks[0].node === 0x6f && G.docks[0].exit === 0x72 && G.docks[0].map === 1 && G.pads.length === 0, `node ${node}: dock table ${JSON.stringify(G.docks)} pads ${G.pads.length}`);
      ok(G.board === 0x44 && H.world.records[0x44].name === 'SKBD', `node ${node}: the board record ${G.board} (${H.world.records[G.board]?.name})`);
      // FUN_005b2a23: every record's variant word 0, then FUN_00420837(1) gives the castle's decor group its DEFAULT word (set << 8 | 1 | variant << 16, the exe's table) and the roster's vehicles get 2
      // (verified against the original's constructor in tools/tests/m8-save-world.mjs: the records' +0x64 after the constructors)
      {
        const want = new Map();
        const dt = readDecorTables(H.pe), grp = dt.groups[decorGroupOfZone(6)];
        for (let i = grp.first; i < grp.first + grp.count; i++) want.set(dt.entries[i].record, ((dt.entries[i].set << 8) | 1 | (dt.entries[i].variant << 16)) >>> 0);
        for (let va = 0x9031d0; (H.pe.u32(va) | 0) !== -1; va += 0x18) want.set(H.pe.u32(va) | 0, 2);
        const bad = H.world.records.filter((r) => r.variant !== (want.get(r.index) ?? 0));
        ok(bad.length === 0, `node ${node}: variant words after the constructor: ${bad.slice(0, 5).map((r) => `${r.name}#${r.index} ${r.variant.toString(16)}`)}`);
      }
      // the hidden list is hidden by Control's constructor at the attach (0x573936) in the middle of the set-up: a record ends visible only when the set-up code shows it AFTER that attach
      // (execution order of the emulated set-up: `EmuAttach.storeIndex`; the tail's own stores 0x5b2a61 / 0x5b2adc come from the later `run` and are not the set-up's)
      const ctl = H.emu.attaches.find((a) => a.ctor === 0x57a579 && a.record === H.pepper.index);
      ok(!!ctl, `node ${node}: Control's attach found`);
      for (const i of readHiddenList(H.pe)) {
        const late = H.emu.stores.slice(ctl.storeIndex).filter((s) => s.record === i && s.field === 0x60 && s.at !== 0x5b2adc);
        const want = late.length > 0 && (late[late.length - 1].value & 2) !== 0;
        ok(((H.world.records[i].flags & 2) !== 0) === want, `node ${node}: the hidden-list record ${i} (${H.world.records[i].name}) is ${want ? 'shown by the set-up after the constructor' : 'hidden'}`);
      }
      // the horse set at the stages that show it (docs/re/m5/z07CSI.md section 5): HORS visible from node 21 on, hidden before
      ok(((H.world.records[48].flags & 2) !== 0) === (node >= 21), `node ${node}: HORS ${(H.world.records[48].flags & 2) ? 'visible' : 'hidden'}`);
      const skipped = H.L.skipped.filter((s) => !OTHER_OWNERS.has(s.ctorName) && s.ctorName !== 'seabed');
      ok(skipped.length === 0, `node ${node}: unported attaches ${JSON.stringify(skipped.slice(0, 5))}`);
    }

    // ---- (2) the arrival
    {
      const H = loadCsi(ctx, { node: 15, vars: { 0xa3: 0 } });
      const G = vehicles(H.world);
      ok(G.current?.name === 'SPBT' && H.world.vars.get(0x5e) === 8, `arrival from the island: the speedboat (${G.current?.name}, control ${H.world.vars.get(0x5e)})`);
      ok(Math.abs(G.current.x + 377.5) < 0.5 && Math.abs(G.current.z + 213.5) < 0.5, `the boat's place (${G.current.x}, ${G.current.z})`);
      // every other previous zone walks: the place is the one the ORIGINAL's set-up code gave Pepper's record (the emulation), whatever the stage band
      for (const prev of [2, 31, 32, 33]) {
        const J = loadCsi(ctx, { node: 24, vars: { 0xa3: prev } });
        ok(vehicles(J.world).current?.name === 'SPBT' && J.world.vars.get(0x5e) === 8, `arrival from zone ${prev}: the speedboat`);
      }
      for (const [prev, node] of [[7, 19], [8, 24], [9, 27], [6, 15], [7, 15], [8, 15], [9, 15], [8, 27]]) {
        const J = loadCsi(ctx, { node, vars: { 0xa3: prev } });
        const e = J.emu.records[J.pepper.index].pos;
        // (the wrapper's FUN_0042207d puts Pepper's walker on the PATH map: the framework does it after the set-up, which moves her a few units to the nearest node)
        // after the joust (previous zone 8) the ORIGINAL's set-up writes var 0x5e := 0x10 + var 0x112 := 1 and copies Pepper's matrix to HORS: she rides on (the horse worker's Horse@5 takes the mode);
        // the expectation is the emulated machine's own var 0x5e (every other arrival walks: 1); node 15 with previous zone 8 never happens in the story (HORS is still hidden in that stage set: nothing rides)
        const emuMode = (J.emu.varWrites.filter((v) => v.var === 0x5e).pop()?.after ?? 1), rides = emuMode === 0x10;
        ok(rides === (prev === 8), `arrival from zone ${prev} at node ${node}: the emulated original's var 0x5e = ${emuMode}`);
        if (rides) tick(J, 2);   // the horse starts the ride itself on its first tick (stamp != frame: clip 2, current := HORS)
        const cur = vehicles(J.world).current;
        ok(Math.hypot(J.pepper.x - e[0], J.pepper.z - e[2]) < 6 && J.world.vars.get(0x5e) === emuMode && (rides ? (cur?.name === 'HORS' || (J.emu.records[48].flags & 2) === 0) : !cur), `arrival from zone ${prev} at node ${node}: ${rides ? 'on the horse' : 'walking'} at (${J.pepper.x.toFixed(1)}, ${J.pepper.z.toFixed(1)}) = the emulated place (${e[0].toFixed(1)}, ${e[2].toFixed(1)})`);
      }
    }
    notes.push(`${STAGES.length} stages: chain, docks, board, hidden list, unported attaches checked; arrival from the island + three mini-games`);

    // ---- (3) the castle's flags: MeetPepp against the original (600 ticks, dt 1 and 0.5)
    for (const dt of [1, 0.5]) {
      const d = makeCsiDuel(ctx, { node: 15, dt, failures, maxFail: 20, kinds: [0x530d69], keepKinds: ['MeetPepp'] });
      d.label = `meetpepp dt${dt}`;
      const W = d.P.world, mem = d.emu.cpu.mem;
      const mp = W.records.map((r, i) => [r, i]).filter(([r]) => r.ctrl?.nodes.some((n) => n.kind === 'MeetPepp'));
      ok(mp.length === 10, `${d.label}: ${mp.length} MeetPepp records`);
      for (let t = 0; t < 600 * (dt === 1 ? 1 : 2); t++) {
        d.tick(0);
        for (const [r, i] of mp) {
          d.rec(i, 0xffff);
          const a = d.emu.nodeOf.get(i)?.find((n) => n.ctor === 0x530d69)?.ptr;
          if (a) d.eq(`${r.name} loops`, mem.r32(a + 0x24) | 0, r.ctrl.nodes.find((n) => n.kind === 'MeetPepp').loops);
          const an = d.O.world.records[i].anim, pa = r.anim;
          if (an && pa) { d.eq(`${r.name} clip`, an.clip, pa.clip); d.cmp(`${r.name} frame`, an.frame, pa.frame); }
        }
      }
      checked += d.checked;
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
