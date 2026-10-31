// WP-SAVE (NPC families, ambient): BOTMUSIC 0x536e16 (68 byte block: timer + the emitter matrix) and GETO 0x536961 (16 byte block) after gameplay, from the existing duel scenario of
// tools/lib/m7-isl-veh-ambient-sc.mjs `bots` (era 3: the dancing bricksterbots next to Pepper with the radio on / off, walking away, the ghetto blaster of the story nodes 0x37 .. 0x3d; dt 1, dt 0.5, synced).
// The Duel's tick is hooked: after every tick the original's serializer output (run natively) is compared with the port's `saveBlock` for every node of the two constructors (compareBlocks, tolerance 0);
// every 13 ticks a load round puts back into every node a block it held earlier (the observer's corpus of distinct ORIGINAL blocks) into BOTH machines (original loader natively, port `loadBlock`), after
// which the Duel's own per tick comparison (exact: records, timers, matrices, variables, sound / emitter / face calls) goes on.
import { Duel } from '../lib/m7-isl-veh-emu.mjs';
import { makeEnv, bots } from '../lib/m7-isl-veh-ambient-sc.mjs';
import { compareBlocks, nativeNodes, portNodes, origBlock, origLoad, hex } from '../lib/m8-save.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const ONLY = new Set([0x536e16, 0x536961]);

const __test = {
  name: 'm8-save-npc-music',
  async run(ctx) {
    const origTick = Duel.prototype.tick;
    const st = { compares: 0, blocks: 0, rounds: 0, loaded: 0, fails: [], distinct: new Map(), vary: new Map() };
    const corpus = new Map();
    Duel.prototype.tick = function (held) {
      origTick.call(this, held);
      const W = this.P.world, emu = this.emu, label = `${this.label} t${this.t}`;
      const res = compareBlocks(W, emu, label, ONLY);
      st.compares++; st.blocks += res.checked;
      for (const f of res.failures) if (st.fails.length < 30) st.fails.push(f);
      // corpus + variation
      const nodes = [];
      for (const [i, r] of W.records.entries()) {
        const on = nativeNodes(emu, i).filter((n) => ONLY.has(n.ctor)), pn = portNodes(r).filter((n) => ONLY.has(n.ctor));
        on.forEach((o, k) => nodes.push({ i, k, o, p: pn[k], r }));
      }
      for (const n of nodes) {
        const b = origBlock(emu, n.o), hx = hex(b), key = `${this.label}/${n.i}.${n.k}`;
        let c = corpus.get(key); if (!c) corpus.set(key, (c = { seen: new Set(), list: [] }));
        if (!c.seen.has(hx) && c.list.length < 60) { c.seen.add(hx); c.list.push({ state: n.o.state, bytes: b, hx }); }
        const ck = '0x' + n.o.ctor.toString(16);
        let ds = st.distinct.get(ck); if (!ds) st.distinct.set(ck, (ds = new Set())); if (ds.size < 5000) ds.add(hx);
        let vy = st.vary.get(ck); if (!vy) st.vary.set(ck, (vy = { first: Uint8Array.from(b), varied: new Uint8Array(b.length) }));
        for (let q = 0; q < b.length; q++) if (b[q] !== vy.first[q]) vy.varied[q] = 1;
      }
      if (this.t > 0 && this.t % 13 === 0) {
        let round = st.rounds;
        for (const n of nodes) {
          const c = corpus.get(`${this.label}/${n.i}.${n.k}`);
          if (!c || c.list.length < 2) continue;
          const cur = hex(origBlock(emu, n.o));
          const cand = c.list.filter((e) => e.hx !== cur);
          if (!cand.length) continue;
          const e = cand[(round + n.k) % cand.length];
          emu.cpu.mem.w32(n.o.ptr + 8, e.state); n.p.stamp = e.state >>> 0;
          origLoad(emu, n.o, e.bytes); n.p.loadBlock(W, n.r, n.r.ctrl, e.bytes);
          const pb = n.p.saveBlock(W, n.r, n.r.ctrl);
          if (hex(pb) !== hex(e.bytes) && st.fails.length < 30) st.fails.push(`${label} after load rec ${n.i} ctor 0x${n.o.ctor.toString(16)}: port block ${hex(pb)} loaded ${hex(e.bytes)}`);
          st.loaded++;
        }
        st.rounds++;
        const res2 = compareBlocks(W, emu, label + ' after load', ONLY);
        st.blocks += res2.checked;
        for (const f of res2.failures) if (st.fails.length < 30) st.fails.push(f);
      }
    };
    const env = makeEnv(ctx);
    try { await bots(env); } finally { Duel.prototype.tick = origTick; }
    const r = env.result();
    const failures = [...r.failures, ...st.fails];
    const cov = [...st.vary].map(([k, v]) => `${k}:${v.varied.reduce((a, b) => a + b, 0)}/${v.varied.length} bytes varied, ${st.distinct.get(k)?.size} distinct blocks`).join('; ');
    return { checked: r.checked + st.blocks, failures, notes: [`${st.compares} tick compares, ${st.blocks} blocks compared, ${st.rounds} load rounds (${st.loaded} nodes loaded); ${cov}`] };
  },
};
export default guarded(__test);
