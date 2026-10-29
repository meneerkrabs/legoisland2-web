// WP-VERIFY M7 island: the hint hologram hOLO (ctor FUN_0088df51, update FUN_0088d41f, pre-render FUN_0088d666, activation FUN_0088d2cb) of src/island/trigger/holo.ts against the ORIGINAL's code run natively in the x86 emulation
// (tools/lib/m7-isl-veh-trig.mjs): Shift held for 20 ticks or the story's alert timer (DAT_05defbcc) calls it, it scales in, faces the objective (FUN_00424e37 native, objective set through the original's setters) or Pepper,
// speaks the next hint of the table (the SAME lihol N.str file feeds the original's hosted FUN_00439bf8 lookup and the port's table), flickers (random draws from identical streams), scales out on Shift / cutscene / timeout.
// Compared per tick: the record's matrix / Euler angles / flags (the frustum bit the renderer sets and the blink clears vs the port's RF_NO_DRAW), the node block (state / show / face / timer / hint letter / scale / shimmer /
// flicker counter), var 0xc6, DAT_009da844 (holoActive), the speech calls (voice ids, stop), the camera-hold calls, all variables; random draws are consumed in lockstep.
import { trigDuel, trigTick, holoServices, setObjective, lcg } from '../lib/m7-isl-veh-trig.mjs';
import { RECORDS_BASE, REC, fr } from '../lib/m7-isl-veh-emu.mjs';
import { loadMessages } from '../../src/ui/strings.ts';
import { setIslandRandom } from '../../src/island/rng.ts';
import { cRand } from '../lib/c-rand.mjs';
import { RF_NO_DRAW } from '../../src/game/record.ts';

const MAXFAIL = 30;

export const makeHoloTest = (name, dts) => ({
  name,
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, activations: 0, byAlert: 0, byHold: 0, says: 0, stops: 0, queued: 0, blinks: 0, shimmers: 0, scaleOuts: 0, timeouts: 0, camCalls: 0, faceObjective: 0, hints: new Set() };
    const devs = new Map();
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const first = (() => { try { return new Map(); } catch { return null; } })(); void first;
    for (const dt of dts) for (const [node, file] of [[2, 'LI/Data/lihol1.str'], [7, 'LI/Data/lihol5.str'], [12, 'LI/Data/lihol8.str'], [20, 'LI/Data/lihol8.str']]) {
      const table = loadMessages(messages, [file]);
      // identical random streams for the original (hosted FUN_004388ae) and the port (island rng)
      const seed = 31 + node;
      const so0 = lcg(seed), sp0 = lcg(seed); let nO = 0, nP = 0; const drawsO = [], drawsP = [];
      const so = () => { nO++; const v = so0(); drawsO.push(v); return v; }, sp = () => { nP++; const v = sp0(); drawsP.push(v); return v; };
      const d = trigDuel(ctx, { node, dt, keepKinds: ['hOLO'], argZero: true, maxFail: MAXFAIL, failures, rng: { range: (x) => (x <= 0 ? 0 : cRand(so(), x)) } });
      d.label = `holo n${node} dt${dt}`; cover.sessions++;
      setIslandRandom(() => sp());
      try {
        holoServices(d, table);
        const W = d.P.world, mem = d.emu.cpu.mem, att = d.O.profile.island.attaches;
        const pr = att.find((a) => a.ctorName === 'hOLO');
        const oNode = d.emu.nodeOf.get(pr.record).find((x) => x.ctor === pr.ctor).ptr, pNode = W.records[pr.record].ctrl.nodes.find((x) => x.kind === 'hOLO');
        const hi = pr.record, pi = d.P.pepper.index;
        const rnd = lcg(700 + node), pick = (n) => Math.floor(rnd() * n);
        const eq = (what, x, y) => { checked++; if (JSON.stringify(x) !== JSON.stringify(y)) d.fail(`${d.label} t${d.t} ${what}: original ${JSON.stringify(x)} port ${JSON.stringify(y)}`); };
        const hflags = () => RECORDS_BASE + hi * REC + 0x60;
        // a camera (position / axes) both sides
        // (the view basis c[9..17] comes from the port's ChaseCamera.updateView for both: the camera maths is not the subject here, src/game/camera.ts has its own oracle; the original's loop computes it between the update and the pre-render pass)
        const setCam = () => { for (let k = 0; k < 6; k++) W.camera.c[k] = fr((rnd() - 0.5) * 120); W.camera.updateView(); for (let k = 0; k < 18; k++) { W.camera.c[k] = fr(W.camera.c[k]); mem.wf32(0x9da5e8 + 4 * k, W.camera.c[k]); } };
        setCam();
        d.setVar(0x5e, 1); d.setVar(9, 1);
        const setHoloTimer = (v) => { mem.wf32(0x5defbcc, v); d.goal.holoTimer = v; };
        const pepAt = (x, z) => d.placePepper(fr(x), fr(30), fr(z), 0);
        let px = 10, pz = 10; pepAt(px, pz);
        let held = false, alertLeft = 0;
        const total = Math.ceil(2600 / dt);
        let holdLeft = 0;
        for (let t = 0; t < total; t++) {
          // the scenario script
          if (t % 300 === 40) { holdLeft = 26; }                                   // Shift held 26 ticks: activation (20 ticks hold)
          if (t % 300 === 150) { setHoloTimer(Math.ceil(6 / dt)); alertLeft = 1; }   // the story's alert
          if (t % 300 === 233 && Math.floor(t / 300) % 2 === 0) { holdLeft = 2; }   // (every other cycle: the others run into the 210 tick timeout)                                    // a Shift tap while it is up: sends it away
          if (t % 300 === 260 && Math.floor(t / 300) % 4 === 1) { d.cutscene(true); }                       // a cutscene starts
          if (t % 300 === 270) d.cutscene(false);
          if (t % 300 === 5) { // (no PATH-node mode: FUN_00424e37 returns its unassigned local in mode 3, an indeterminate value, and the story handler never leaves that mode set; see m7-isl-veh-story)
            const m = pick(4); const pool = [['record', 3], ['pair', 5, 9], ['record', 7], ['record', -1]][m];
            if (pool[0] === 'record') setObjective(d, { kind: 'record', a: pool[1] }); else if (pool[0] === 'pair') setObjective(d, { kind: 'pair', a: pool[1], b: pool[2] }); else setObjective(d, { kind: 'node', node: pool[1] }); }
          if (t % 300 === 100 && pick(3) === 0) setCam();
          if (t % 300 === 120) d.setVar(9, pick(3) === 0 ? 0 : 1);
          if (t % 300 === 20) d.setVar(0x5e, [1, 1, 4][pick(3)]);
          if (t % 300 === 60) d.setVar(0x5e, 1);
          // Pepper moves or stands still (the flicker rate depends on it)
          if (t % 300 < 150 && t % 4 === 0) { px += (rnd() - 0.5) * 2; pz += (rnd() - 0.5) * 2; pepAt(px, pz); }
          const heldNow = holdLeft > 0 ? 0x40 : 0;
          if (holdLeft > 0) holdLeft--;
          // the renderer's frustum bit before the pre-render pass (FUN_00444370)
          mem.w16(hflags(), mem.r16(hflags()) | 1);
          d.said.length = 0; d.psaid.length = 0; d.camLog.length = 0; d.pcam.length = 0;
          const was = [mem.r8(oNode + 0x1c), mem.r8(oNode + 0x1d)];
          trigTick(d, heldNow); cover.ticks++;
          if (d.P.ictx.sayLeft > 0) d.P.ictx.sayLeft--; if (d.sayLeft > 0) d.sayLeft--;
          eq('random draws consumed', nO, nP);
          eq('speech calls', d.said, d.psaid); eq('camera-hold calls', d.camLog, d.pcam);
          cover.says += d.said.filter((x) => x.startsWith('say')).length; cover.stops += d.said.filter((x) => x === 'stop').length; cover.camCalls += d.camLog.length;
          eq('speech busy', d.sayLeft > 0, d.P.ictx.sayLeft > 0);
          // node block
          eq('state +0x1c', mem.r8(oNode + 0x1c), pNode.st); eq('show +0x1d', mem.r8(oNode + 0x1d), pNode.show); eq('face +0x57', mem.r8(oNode + 0x57), pNode.face); eq('letter +0x1f', mem.r8(oNode + 0x1f), pNode.letter);
          d.cmp('timer', mem.f32(oNode + 0x18), pNode.timer, 1e-6, '', 1e-6); d.cmp('scale', mem.f32(oNode + 0x44), pNode.scale, 1e-5, '', 1e-6);
          d.cmp('shimmer', mem.f32(oNode + 0x48), pNode.shimmer, 1e-6, '', 1e-6); d.cmp('flicker counter', mem.f32(oNode + 0x4c), pNode.flick, 1e-6, '', 1e-6);
          d.cmp('holoTimer', mem.f32(0x5defbcc), d.goal.holoTimer, 1e-6, '', 1e-6);
          eq('holoActive DAT_009da844', mem.r32(0x9da844), d.P.ictx.shared.holoActive ?? 0); eq('var 0xc6', mem.r32(0x8a2d2c + 4 * 0xc6), W.vars.get(0xc6) | 0);
          // the record: matrix / Euler / flags; the blink: the original clears the frustum bit, the port sets RF_NO_DRAW for the frame
          const r = W.records[hi];
          d.rec(hi, 0xfffe & ~RF_NO_DRAW);
          eq('blink (frustum bit 0 cleared / RF_NO_DRAW)', (mem.r16(hflags()) & 1) === 0, (r.flags & RF_NO_DRAW) !== 0);
          if (mem.r8(oNode + 0x1d) === 4) cover.blinks++; if (mem.r8(oNode + 0x1d) === 3) cover.shimmers++;
          if (was[0] !== 2 && mem.r8(oNode + 0x1c) === 2) { cover.activations++; if (alertLeft) cover.byAlert++; else cover.byHold++; alertLeft = 0; }
          if (was[1] !== 2 && mem.r8(oNode + 0x1d) === 2) { cover.scaleOuts++; if (pNode.timer > 210) cover.timeouts++; }
          if (mem.r8(oNode + 0x57) === 2) cover.faceObjective++;
          cover.hints.add(mem.r8(oNode + 0x1f));
          if (t % 11 === 0) d.vars(); 
        }
        for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
        checked += d.checked;
        notes.push(`n${node} dt${dt}: worst ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}; random draws original ${nO} port ${nP}`);
      } finally { setIslandRandom(null); }
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    cover.hints = [...cover.hints].map((x) => String.fromCharCode(x)).join('');
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
});
export default makeHoloTest('m7-isl-veh-holo', [1, 0.5]);
