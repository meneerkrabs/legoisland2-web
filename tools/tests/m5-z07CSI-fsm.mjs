// M5 z07CSI, the ORACLE test of CSIFSM (ctor FUN_00575b44, update FUN_005753b0, pre-render FUN_00575673): the original's node runs natively in the x86 interpreter
// (tools/lib/m5-z07CSI-emu.mjs) next to the port's node. Random scripts drive both worlds equally: the cutscene sound switches (every entry of the table 0x8f8110 gets 1 / 4 / 8),
// the cedric switch 0x113 (1 -> 2 -> 3), a running cutscene, Pepper's mode (var 0x5e), the clips and frames of the citizens / the horse / Pepper (the footstep cues, the music's
// activity level), the frustum flag of the records. Compared per tick: the node's level / matrix, the flags of HORS / BAR1, all game variables, every sound / emitter / groove call.
import { makeCsiDuel, onodeOf, NATIVE_CTORS, lcg } from '../lib/m5-z07CSI-emu.mjs';
import { readSoundTable, STEP_CUES, globalsOf } from '../../src/zones/z07CSI/csifsm.ts';

const MAXFAIL = 30;
const CLIPS = [1, 3, 3, 3, 0x24, 0x3f, 0x40, 0x79, 0x91, 0x92, 0x91, 0x92, 5];

export default {
  name: 'm5-z07CSI-fsm',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { ticks: 0, sessions: 0, cues: 0, steps: 0, grooves: new Set(), sw113: 0, cutscene: 0 };
    for (const [dt, seed] of [[1, 31], [1, 5150], [0.5, 777]]) {
      const d = makeCsiDuel(ctx, { node: 15, seed, dt, failures, maxFail: MAXFAIL, kinds: [NATIVE_CTORS.CSIFSM], keepKinds: ['CSIFSM'] });
      d.label = `fsm dt${dt} seed${seed}`; cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem, O = d.O.world;
      const rnd = lcg(seed * 7 + 1);
      const table = readSoundTable(d.pe);
      const pn = W.records.find((r) => r.ctrl?.nodes.some((n) => n.kind === 'CSIFSM')).ctrl.nodes[0];
      const home = W.records.findIndex((r) => r.ctrl?.nodes.some((n) => n.kind === 'CSIFSM'));
      const a = onodeOf(d, home, NATIVE_CTORS.CSIFSM);
      if (!a) { failures.push(`${d.label}: no original node`); continue; }
      pn.startEmitter(d.P.fx);
      d.P.ictx.inFrustum = (r) => (r.flags & 1) !== 0;
      // both worlds: the records the node reads get animation instances (the loader's rigs; others a default one)
      const watched = [...new Set([...STEP_CUES.map((c) => c[0]), 48, 7, 47, 29])];
      const setFlag = (i, on) => { for (const w of [W, O]) { const r = w.records[i]; r.flags = on ? r.flags | 1 : r.flags & ~1; } d.emu.putRecord(i, O.records[i]); };
      const scale = dt === 1 ? 1 : 2;
      const compare = () => {
        d.eq('level', mem.r32(a + 0x18) | 0, pn.level);
        d.eq('levelSet', mem.r32(a + 0x1c) | 0, pn.levelSet);
        for (let k = 0; k < 16; k++) d.cmp('cedric matrix', mem.f32(a + 0x24 + 4 * k), pn.m[k], 1e-6, `[${k}]`, 1e-6);
        for (const i of [48, 29]) d.eq(`record ${i} flags`, mem.r16(0x10000000 + i * 0x68 + 0x60) & 0x10, W.records[i].flags & 0x10);
        d.eq('DAT_008f81dc (last horse frame)', mem.r32(0x8f81dc) | 0, globalsOf(W).lastFrame);
        d.eq('DAT_05d5895c (last horse clip)', mem.r32(0x5d5895c) | 0, globalsOf(W).lastClip);
        d.vars();
        if (d.olog) d.sounds();
      };
      for (let t = 0; t < 2000 * scale; t++) {
        if (t % (3 * scale) === 0) {
          // new clips / frames / flags
          for (const i of watched) {
            const clip = CLIPS[Math.floor(rnd() * CLIPS.length)], frame = Math.floor(rnd() * 8);
            for (const w of [W, O]) { const an = w.records[i].anim; if (an) an.start(clip, frame); }
            setFlag(i, rnd() < 0.7);
          }
          // Pepper's mode
          if (rnd() < 0.2) d.setVar(0x5e, [1, 1, 2, 4, 8, 0x10, 0x401][Math.floor(rnd() * 7)]);
          // a cutscene
          if (rnd() < 0.1) { const on = rnd() < 0.5; d.cutscene(on); cover.cutscene += on ? 1 : 0; }
          // the cutscene sound switches
          if (rnd() < 0.5) {
            const e = table[Math.floor(rnd() * table.length)], v = [1, 4, 8][Math.floor(rnd() * 3)];
            d.setVar(e.var, v); cover.cues++;
          }
          // the cedric switch
          if (rnd() < 0.1) { const v = d.getVar(0x113); d.setVar(0x113, v === 0 ? 1 : v === 2 ? 3 : v === 3 ? 1 : v); cover.sw113++; }
        }
        d.tick(0); cover.ticks++;
        compare();
        for (const l of d.psnd) { if (/^p3 /.test(l)) cover.steps++; const g = /^groove (-?\d+)/.exec(l); if (g) cover.grooves.add(+g[1]); }
      }
      checked += d.checked;
      notes.push(`${d.label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
    }
    notes.push(`coverage: ${JSON.stringify({ ...cover, grooves: [...cover.grooves] })}`);
    if (cover.grooves.size < 3) failures.push(`groove levels seen: ${[...cover.grooves]}`);
    return { checked, failures, notes };
  },
};
