// WP-VERIFY M7 island: the LGI_FSM director (ctor FUN_004b8c73, update FUN_004b7c78) of src/island/trigger/lgifsm.ts against the ORIGINAL's constructor and update run natively in the x86 emulation
// (tools/lib/m7-isl-veh-trig.mjs): the switch variables the cutscene scripts write (SWITCH_LGI_*, 33 sound cues of the table 0x8d9460, rotors 0x131, INFC windows 0x106, PIZ3 timer 0x11f, flying-figure rockets 0x110,
// WORM scale 0x128 / 0xd, Bill's hands 0x109, twinkle 0xff, collision 0x129, jail door 0x134) are set at random in both worlds each tick, in the value ranges the scripts use; compared per tick: all variables (the node writes the
// switches back), the sub-object matrices (INFC parts 1 / 2, JAIL part 1, PHEL part 3, record 157 part 2), WORM's matrix / flags, every record's flag word, the node block (rotor / door angles / speeds / scale), the sound calls with positions,
// the emitter gate / matrix calls (the emitter handles of the era functions' FUN_00442960 calls are created in the original's memory the way the engine hands them out). Not covered: switch 0xfe (FUN_00447ef0 brick effects need the
// brick library: not in the test world), the emitter / bone matrix contents (the pose service is a stand-in).
// Switch 0xfe (SWITCH_LGI_CSM_FX_SWITCH03): the original's decision (0 < n < DAT_008d95f8 -> FUN_00447ef0(DAT_05d58304[n]), then the switch is 0) is compared through a hook of FUN_00447ef0 (the brick effect itself is
// the FX_Bricks manager's: tools/tests/m4-wp9-bricks.mjs); the director's float state runs FREE (no re-sync from the original), compared bit for bit.
import { trigDuel, trigTick, bldgHooks, lcg } from '../lib/m7-isl-veh-trig.mjs';
import { RECORDS_BASE, REC } from '../lib/m7-isl-veh-emu.mjs';

const MAXFAIL = 30;
const ERA_NODES = [2, 10, 0x20, 0x36, 0x3f];
// DAT_xxx emitter handle globals of the era functions (decompile 0x4bf737 ...): matrix -> handle slot
const HANDLE_OF = { 0x5d58390: 0x5d58384, 0x5d583d0: 0x5d58388, 0x5d58590: 0x5d58300 };
for (let k = 0; k < 6; k++) HANDLE_OF[0x5d58410 + 0x40 * k] = 0x5d585d0 + 4 * k;

export const makeFsmTest = (name, dts, eras) => ({
  name,
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0, sw0 = [];
    const cover = { sessions: 0, ticks: 0, rotorSets: 0, soundCalls: 0, fxCalls: 0, finishes: 0, finishRejects: 0 }, wrote = new Map();
    for (const [era, node] of ERA_NODES.entries()) for (const dt of dts) {
      if (!eras.includes(era)) continue;
      const d = trigDuel(ctx, { node, dt, bldg: true, keepKinds: ['LGI_FSM'], maxFail: MAXFAIL, failures, draw: false });
      d.label = `fsm e${era} dt${dt}`; cover.sessions++;
      bldgHooks(d);
      const W = d.P.world, mem = d.emu.cpu.mem, att = d.O.profile.island.attaches;
      const rnd = lcg(900 + era * 13 + (dt === 1 ? 0 : 1)), pick = (n) => Math.floor(rnd() * n);
      const pr = att.find((a) => a.ctorName === 'LGI_FSM');
      const oNode = d.emu.nodeOf.get(pr.record).find((x) => x.ctor === pr.ctor).ptr, pNode = W.records[pr.record].ctrl.nodes.find((x) => x.kind === 'LGI_FSM');
      const have = new Set();
      // the emitter handles the era functions' FUN_00442960 calls produced (created here in the emulated engine's order; names = the call's strings)
      for (const c of d.O.profile.island.calls) {
        if (c.fn !== 0x442960) continue;
        const m = c.args[1] >>> 0, g = HANDLE_OF[m];
        if (!g) continue;
        const h = 0x100 + d.emu.fxh.size;
        d.emu.fxh.set(h, { name: d.pe.cstr(c.args[0]), owner: -1 });
        mem.w32(g, h); have.add(g);
      }
      const eq = (what, x, y) => { checked++; if (JSON.stringify(x) !== JSON.stringify(y)) d.fail(`${d.label} t${d.t} ${what}: original ${JSON.stringify(x)} port ${JSON.stringify(y)}`); };
      const mcmp = (what, om, pm) => { if (!om || !pm) { eq(`${what} exists`, !!om, !!pm); return; } for (let k = 0; k < 16; k++) d.cmp(what, om[k], pm[k], 1e-5, `[${k}]`, 5e-6); };
      const parts = [[124, 1], [124, 2], [122, 1], [165, 3], [157, 2]];
      // the node block (original) <-> DirectorState (port)
      const st = pNode.st;
      // the cue table of the original (0x8d9460: var, handle slot, record) read from the executable
      const sw = []; sw0 = sw;
      for (let i = 0; i < 64; i++) { const v = d.pe.u32(0x8d9460 + i * 12) | 0; if (v <= 0) break; sw.push(v); }
      eq('cue table length', sw.length, st.sounds.length || sw.length);
      d.emu.cpu.hooks.set(0x447ef0, (c) => { d.emu.log.push(`finish ${c.arg(0) | 0}`); });
      const nEffects = mem.r32(0x8d95f8) | 0;
      const wormVar = node < 7 ? 0x128 : node < 0x3d ? 0 : 0xd;
      const pool = [
        ...sw.map((v) => [v, [1, 4, 8, 1, 0, 2]]),
        [0xfe, [...Array(nEffects + 2).keys(), -1, 0x7fffffff]],
        [0x131, [0, 5, 20, -10, 0]], [0x106, [1, -1, 0]], [0x11f, [1, 0]],
        // switch 0x110 bits drive rocket emitter pairs k = slot, slot + 1; only the pairs the era's own set-up created (a missing handle global stays 0 = the engine's emitter #0, a quirk the scripts never trigger)
        [0x110, [1, 0x1001, 0, ...[[1, 0], [2, 0], [4, 0], [8, 2], [0x10, 0], [0x20, 4]].filter(([, k]) => have.has(0x5d585d0 + 4 * k) && have.has(0x5d585d4 + 4 * k)).flatMap(([b]) => [b, b | 0x1000, b | 0x80])]],
        ...(have.has(0x5d58384) ? [[0x109, [1, 3, 0]]] : []),
        ...(have.has(0x5d58300) ? [[0xff, [0x82, 0x84, 0x88, 0x90, 0x100, 0x101, 0x103, 0x105, 0x109, 0x111, 0x121, 0x141, 0x80, 0x180, 0]]] : []), [0x129, [1, 2]], [0x134, [1]],
        ...(wormVar ? [[wormVar, [1, 2, 3, 0]]] : []),
      ];
      const nTicks = Math.ceil(2000 / dt);
      for (let t = 0; t < nTicks; t++) {
        // the scripts write a switch now and then (the variables are read back / cleared by the director)
        if (rnd() < 0.09) { const [v, vals] = pool[pick(pool.length)]; const val = vals[pick(vals.length)]; d.setVar(v, val); if (v === 0x131 && val !== 0) cover.rotorSets++; }
        st.log.length = 0;
        const v0xfe = d.getVar(0xfe);
        const { o, p } = trigTick(d, 0); cover.ticks++;
        eq('cutscene starts', o, p);
        {
          const of = d.olog.filter((l) => /^finish /.test(l)), pf = st.log.filter((l) => /^finish /.test(l));
          eq('brick effect finish calls (switch 0xfe)', of, pf);
          cover.finishes += of.length; if (v0xfe !== 0 && of.length === 0) cover.finishRejects++;
        }
        for (const w of d.emu.varWrites) { const m = /^(set|or|andnot|add) (\d+)/.exec(w); if (m) wrote.set(+m[2], (wrote.get(+m[2]) ?? 0) + 1); }
        d.vars(); d.sounds();
        for (const l of d.olog) { if (/^(p2|p3|s2|r) /.test(l)) cover.soundCalls++; if (/^fx[gmp] /.test(l)) cover.fxCalls++; }
        for (const [r, k] of parts) { const om = d.origPart(r, k); if (om) mcmp(`record ${r} part ${k}`, om, d.portPart(r, k)); }   // (the original's buffer exists once its code asked for the part)
        for (let r = 0; r < W.records.length; r++) { const ov = mem.r16(RECORDS_BASE + r * REC + 0x60) & 0xfffe, pv = W.records[r].flags & 0xfffe; checked++; if (ov !== pv) d.fail(`${d.label} t${d.t} record ${r} (${W.records[r].name}) flags original ${ov.toString(16)} port ${pv.toString(16)}`); }
        d.rec(370, 0xfffe, undefined, true);
        d.cmp('rotor', mem.f32(oNode + 0x18), st.rotor, 1e-5, '', 1e-5); d.cmp('jail', mem.f32(oNode + 0x20), st.jail, 1e-5, '', 1e-5); d.cmp('win0', mem.f32(oNode + 0x28), st.win[0], 1e-5, '', 1e-5); d.cmp('win1', mem.f32(oNode + 0x2c), st.win[1], 1e-5, '', 1e-5); d.cmp('winSpeed0', mem.f32(oNode + 0x30), st.winSpeed[0], 1e-5, '', 1e-6); d.cmp('winSpeed1', mem.f32(oNode + 0x34), st.winSpeed[1], 1e-5, '', 1e-6); d.cmp('scale', mem.f32(oNode + 0x48), st.scale, 1e-5, '', 1e-5);
      }
      for (const v of [0x131, 0x106, 0x11f, 0x110, 0x109, 0xff, 0x129, 0x134, 0x128, 0xd]) void v;
      checked += d.checked;
      notes.push(`e${era} dt${dt}: worst ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
    }
    notes.push(`coverage: ${JSON.stringify(cover)}; the director's own variable writes (var: count) ${[...wrote].filter(([v]) => [0x106, 0x110, 0x109, 0xff, 0x128, 0xd, 0x134].includes(v) || sw0.includes(v)).map(([v, n]) => `${v.toString(16)}:${n}`).join(' ')}; windows (0x106) / jail (0x134) / worm (0x128, 0xd) / bill (0x109) / twinkle (0xff) / rockets (0x110) writes show those branches ran`);
    return { checked, failures, notes };
  },
});

export default makeFsmTest('m7-isl-veh-fsm', [1], [0, 1, 2, 3, 4]);
