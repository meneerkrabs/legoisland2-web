// WP-SAVE (worker d): the scene nodes SEAB (ctor FUN_004266ca), SSEA (FUN_00426da4) and SSKY (FUN_00426915) of src/island/ambient/seabed.ts against the ORIGINAL's code run natively in the x86 emulation: their DRAW hooks
// (FUN_00426a43 the sea plane, FUN_004267d2 the sky dome; the engine's range / fog queries FUN_00443cb0 / FUN_00442d60 / FUN_00442dc0 hosted with scripted values) are run by the original's own draw pass
// FUN_0042271b after every tick, the port's `SeaNode.place` / `SkyNode.place` are called with the same camera / fog / sea level / frame time. The state the nodes own (the sky's angle, the sea plane's anchor and
// its flag; saved by FUN_004268cf / FUN_00426d5e / FUN_00426684) is compared as bytes with the original's serializers at every tick (tolerance 0), the records' matrices / Euler angles / flags after the draw
// (the entity header of the save holds the record's position) too; the original's loaders are run in the middle of the scenes with the blocks the original saved earlier (m8Hook round trips: both machines).
// The camera jumps (to run the anchor's 200 round follow loop) and drifts; the fog is on / off, nearer / farther than the far plane; the sea level changes.
import { trigDuel, lcg } from '../lib/m7-isl-veh-trig.mjs';
import { m8Hook, m8Note } from '../lib/m8-d.mjs';
import { RECORDS_BASE, REC } from '../lib/m7-isl-veh-emu.mjs';
import { CTOR_SEABED, CTOR_SEA, CTOR_SKY, SkyNode, SeaNode } from '../../src/island/ambient/seabed.ts';

export default {
  name: 'm8-save-seabed',
  async run(ctx) {
    const failures = [], notes = [], m8Stats = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, jumps: 0, fogOff: 0, fogNear: 0, loops: 0, loads: 0 };
    for (const [node, dt] of [[2, 1], [0x20, 0.5], [0x36, 1]]) {
      const d = trigDuel(ctx, { node, dt, keepKinds: ['Seabed', 'Sky', 'Sea'], oracleCtors: new Set([CTOR_SEABED, CTOR_SEA, CTOR_SKY]), extraExec: [[0x426000, 0x427000]], maxFail: 30, failures, draw: false });
      d.label = `seabed n${node} dt${dt}`; cover.sessions++;
      m8Stats.push(m8Hook(d, [CTOR_SEABED, CTOR_SEA, CTOR_SKY], failures, { label: d.label, every: 1, period: 53, hold: 17 }));
      const W = d.P.world, mem = d.emu.cpu.mem, H = d.emu.cpu.hooks, fr = Math.fround;
      const env = { far: 600, fogOn: 1, fogEnd: 450, domeBase: 450, seaLevel: 0 };
      // the engine's queries the draw hooks make (hosted: the video state is not the subject): FUN_00442d60(&fogOn, &, &fogEnd (int), &), FUN_00443cb0() -> far (st0), FUN_00442dc0(&r) -> *r = domeBase * 1.2
      H.set(0x442d60, (c) => { mem.w32(c.arg(0), env.fogOn); mem.w32(c.arg(1), 0); mem.w32(c.arg(2), env.fogEnd); mem.w32(c.arg(3), 0); });
      H.set(0x443cb0, (c) => { c.fpush(fr(env.far)); });
      H.set(0x442dc0, (c) => { mem.wf32(c.arg(0), fr(fr(env.domeBase) * 1.2000000476837158)); });
      d.emu.cpu.invalidate();
      const recs = W.records.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'Seabed' || n.kind === 'Sky' || n.kind === 'Sea'));
      const rnd = lcg(40 + node), pick = (n) => Math.floor(rnd() * n);
      let eye = [0, 25, 0];
      const setEye = (e) => { eye = e.map(fr); for (let k = 0; k < 3; k++) { W.camera.c[k] = eye[k]; mem.wf32(0x9da5e8 + 4 * k, eye[k]); } };
      const setLevel = (l) => { env.seaLevel = fr(l); W.seaLevel = env.seaLevel; mem.wf32(0x9da858, env.seaLevel); };
      setEye(eye); setLevel(0);
      const total = 1400;
      for (let t = 0; t < total; t++) {
        // the scene
        if (t % 90 === 40) { env.fogOn = pick(4) === 0 ? 0 : 1; env.far = [300, 600, 1200, 2000][pick(4)]; env.fogEnd = [200, 450, 700, 1500][pick(4)]; env.domeBase = [200, 450, 700][pick(3)] + pick(50) / 4; if (!env.fogOn) cover.fogOff++; if (env.fogEnd < env.far && env.fogOn) cover.fogNear++; }
        if (t % 140 === 70) setLevel([0, 0, 12.5, -3.25][pick(4)]);
        if (t === 700) { setEye([60000, 20, -45000]); cover.loops++; }   // farther than 200 snap steps: the follow loop stops after 200 rounds
        else if (t % 111 === 50) { setEye([(rnd() - 0.5) * 6000, 5 + rnd() * 90, (rnd() - 0.5) * 6000]); cover.jumps++; }
        else setEye([eye[0] + (rnd() - 0.5) * 40, eye[1] + (rnd() - 0.5) * 2, eye[2] + (rnd() - 0.5) * 40]);
        d.tick(0); cover.ticks++;
        // the original's draw pass (FUN_0042271b(records, count, 0, &camera eye)): the draw hooks of the three nodes run natively
        d.emu.cpu.steps = 0;
        d.emu.cpu.call(0x42271b, [RECORDS_BASE, d.O.world.records.length, 0, 0x9da5e8], { maxSteps: 50_000_000 });
        // the port's renderer calls: the nodes place their records with the camera of the frame
        const v = { far: env.far, fogOn: !!env.fogOn, fogEnd: env.fogEnd, domeBase: env.domeBase, seaLevel: env.seaLevel, dt: d.dt };
        for (const r of recs) for (const n of r.ctrl.nodes) if (n instanceof SkyNode || n instanceof SeaNode) n.place(r, W.camera.c, W.camera.c, v);
        for (const r of recs) { d.rec(r.index, 0xffff); checked++; }
        d.m8check('tick');
      }
      // the original really ran its draw hooks: the sky's angle turned (spin flag), the sea anchor left the first camera, the records' matrices follow the camera
      for (const r of recs) for (const [k, n] of r.ctrl.nodes.entries()) {
        const o = d.emu.nodeOf.get(r.index)?.[k]?.ptr;
        if (n instanceof SkyNode) { cover.angle = (cover.angle ?? 0) + (Math.abs(mem.f32(o + 0x18)) > 0 ? 1 : 0); if (!(Math.abs(mem.f32(o + 0x18)) > 0 || !n.spin)) failures.push(`${d.label}: the sky never turned`); }
        if (n instanceof SeaNode) { cover.anchorMoved = (cover.anchorMoved ?? 0) + (mem.f32(o + 0x18) !== 0 ? 1 : 0); if (mem.r32(o + 0x24) !== 1) failures.push(`${d.label}: the sea anchor was never set`); }
      }
      checked += d.checked;
      notes.push(`${d.label}: ${recs.map((r) => `${r.name}(${r.ctrl.nodes.map((n) => n.kind).join('+')})`).join(' ')}; worst ${[...d.worst].filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, x]) => `${k} ${x.toExponential(1)}`).join(', ') || 'none'}`);
    }
    for (const st of m8Stats) notes.push(m8Note(st));
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
