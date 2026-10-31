// WP-SAVE (NPC families): the save blocks of SGMFIG / Human1 / launch / Turn2Pep A B C / MeetPepp / BrickBot family / botPConly / BOTMUSIC / GETO against the original's serializers (vtable +0x14)
// and loaders (+0x10), run natively in the x86 emulation.
//   1. right after the set-up (all 5 island eras and the 6 hubs: the port world started like the zone game does, tools/lib/m8-save-npc.mjs)
//   2. after gameplay: the existing NPC / bot duel scenarios (tools/tests/m7-isl-npc-*.mjs, m7-isl-bb-*.mjs) with the observer of tools/lib/m8-save-npc.mjs: at EVERY tick the original's block of every node
//      equals the port's `saveBlock`; every 13 ticks a load round puts back into every node a block that node held earlier (the original's blocks, from the observer's corpus) into both machines (original loader natively, port `loadBlock`), after which the scenario's own
//      tick by tick comparison (tolerance 0: records, node fields, variables, events, random draws) goes on.
//   M8_ZONES=isl2,z07CSI  zones of part 1;  M8_SCEN=m7-isl-npc-emu,m7-isl-bb-hit  scenarios of part 2 (default: all, M8_SCEN=none skips);  M8_EVERY / M8_SNAP  observer cadence
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNpcOracle, NPC_CTORS, ZONES, installObserver, resetObs, obs, mergeVary, neverVaried, m8Nodes, m8Io, randomRoundTrip } from '../lib/m8-save-npc.mjs';
import { lcg } from '../lib/m7-isl-veh-emu.mjs';
import { compareBlocks } from '../lib/m8-save.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCEN = ['m7-isl-npc-emu', 'm7-isl-npc-human', 'm7-isl-bb-npc', 'm7-isl-bb-eras', 'm7-isl-bb-free', 'm7-isl-bb-gates', 'm7-isl-bb-hit', 'm7-isl-bb-pconly', 'm7-isl-bb-pizza', 'm8-save-npc-long', 'm5-z07CSI-npc'];

const __test = {
  name: 'm8-save-npc',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    for (const z of (process.env.M8_ZONES ? process.env.M8_ZONES.split(',').filter((x) => x && x !== 'none') : ZONES)) {
      const B = buildNpcOracle(ctx, z);
      const res = compareBlocks(B.P.world, B.emu, z, NPC_CTORS);
      checked += res.checked;
      for (const f of res.failures.slice(0, 10)) failures.push(f);
      notes.push(`set-up ${z}: ${res.checked} nodes`);
      // the walker handles of the controllers (+0x10): the NPC nodes share them with the walker table (F1's blob): the order of creation must equal the original's constructors'
      { let nw = 0, bad = 0; const mem = B.emu.cpu.mem;
        for (const [i, r] of B.P.world.records.entries()) {
          const c = mem.r32(0x10000000 + i * 0x68 + 0x5c); if (!c || !r.ctrl) continue;
          const o = mem.r32(c + 0x10);
          if (o === 0) continue;       // (Pepper's walker is made by the zone game's code, not by a constructor)
          if (r.name === 'HORS') continue;    // (z07CSI's horse walker: horse code (src/zones/z07CSI/horse), not an NPC constructor: reported separately)
          nw++;
          if (o !== (r.ctrl.walker ?? 0)) { bad++; if (failures.length < 40) failures.push(`${z} rec ${i} ${r.name}: walker handle original ${o} port ${r.ctrl.walker}`); }
        }
        notes.push(`walker handles ${z}: ${nw} controllers, ${bad} differ`); }
      // the random round trip on this zone's nodes (after the compare: the loads change the nodes)
      const rt = randomRoundTrip(m8Nodes(B.emu, B.P.world), m8Io(B.emu), B.P.world, lcg(77 + z.length), +(process.env.M8_RANDOM ?? 6));
      checked += rt.checked;
      for (const f of rt.fails) failures.push(`${z}: ${f}`);
      notes.push(`random round trip ${z}: ${rt.checked} loads, ${rt.fails.length} differences`);
    }
    const names = process.env.M8_SCEN ? process.env.M8_SCEN.split(',').filter((x) => x && x !== 'none') : SCEN;
    for (const name of names) {
      resetObs();
      const un = installObserver({ every: +(process.env.M8_EVERY ?? 1), snapEvery: +(process.env.M8_SNAP ?? 13) });
      obs.label = name;
      let res;
      const t0 = Date.now();
      try {
        const mod = (await import(pathToFileURL(path.join(here, name + '.mjs')).href)).default;
        res = await mod.run(ctx);
      } catch (e) { res = { checked: 0, failures: [`${name} crashed: ${e.stack || e}`] }; }
      un();
      mergeVary();
      for (const f of res.failures) failures.push(`${name} (scenario): ${f}`);
      for (const f of obs.failures) failures.push(`${name}: ${f}`);
      checked += obs.blocks;
      const per = [...obs.perCtor].map(([k, v]) => `${k}:${v}/${obs.distinct.get(k)?.size ?? 0}`).join(' ');
      const cov = [...obs.vary].map(([k, v]) => `${k}:${v.varied.reduce((a, b) => a + b, 0)}/${v.varied.length}`).join(' ');
      notes.push(`${name} bytes that varied ${cov}`);
      notes.push(`${name}: ${obs.compares} tick compares, ${obs.blocks} blocks, ${obs.restores} load rounds (${obs.loadedNodes} nodes loaded); blocks/distinct ${per} (${Date.now() - t0} ms)`);
    }
    for (const l of neverVaried()) notes.push(`never different in any scenario (covered by the random round trip only): ${l}`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
