// WP-VERIFY M7 island: the carried-prop node (Pizza.c, FUN_00429d1b: update FUN_00429794, draw hook FUN_0042992a, the carrier calls FUN_00429638 attach / FUN_004296a2 release / FUN_004295cb scale) of the records
// PIZ3 (the pizza box), CNST (the Constructopedia), RHCP, BRIK (era 0 / 4), PAPA / MAMA (era 3). The original's node framework + node run natively in the x86 emulation (tools/lib/m7-isl-veh-emu.mjs) next to the
// port's CarryNode + attachCarry / releaseCarry / scaleCarry (src/island/pizza/carry.ts), Pepper (his anim pose, hosted from the port's AnimInstance: not the subject) as the carrier; compared tick by tick: the prop's
// record (matrix, Euler angles, flags), the node's fields, all game variables, the sound / emitter calls.
import { Duel, B, REC, RECORDS_BASE, bitsOf } from '../lib/m7-isl-veh-emu.mjs';
import { attachCarry, releaseCarry, scaleCarry } from '../../src/island/pizza/carry.ts';
import { withCdHeap } from '../lib/m8-save-pizza.mjs';

const MAXFAIL = 30;
const PROPS = { 2: ['PIZ3', 'CNST', 'RHCP', 'BRIK'], 52: ['PAPA', 'MAMA'], 61: ['PIZ3', 'CNST', 'RHCP'] };

// (WP-SAVE: the original is a debug build whose heap fills fresh node blocks with 0xCD; the nodes of this family keep that fill in the fields the constructors never write, so the oracle must allocate like it: tools/lib/m8-save-pizza.mjs)
const suite = {
  name: 'm7-isl-veh-carry',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { ticks: 0, sessions: 0, attaches: 0, bone0: 0, boneN: 0, scaled: 0, releases: 0, lies: 0, foreign: 0, detach: 0, varOne: 0 };
    const devs = new Map(), unhooked = new Map();

    const session = (label, node, dt) => {
      const names = PROPS[node];
      const d = new Duel(ctx, { node, keepKinds: ['Pizza', 'PizzaCarry'], keepRecords: (n) => names.includes(n), dt, maxFail: MAXFAIL, failures, draw: true, pepSwitc: false, seat: false, advancePepper: 1.0, exact: true });
      d.label = label; cover.sessions++;
      const W = d.P.world, emu = d.emu, mem = emu.cpu.mem, cpu = emu.cpu;
      const idx = (n) => W.records.findIndex((r) => r.name === n);
      const props = names.map(idx).filter((i) => i >= 0 && d.pnode(i, 'PizzaCarry'));
      const pep = d.O.pepper.index;
      const nodeKeys = (i) => ({ a: d.onode(i, 0x429d1b), pn: d.pnode(i, 'PizzaCarry'), n: W.records[i].name });
      const ri = (ptr) => (ptr ? (ptr - RECORDS_BASE) / REC : -1);
      const ctrlOf = (i) => mem.r32(RECORDS_BASE + i * REC + 0x5c);
      const attachBoth = (i, carrier, bone) => {
        // the cutscene command ATTACH (FUN_0045d2b9): FUN_00429638(ctrl, carrier, bone) + controller flags |= 2
        cpu.steps = 0; cpu.call(0x429638, [ctrlOf(i), carrier < 0 ? 0 : RECORDS_BASE + carrier * REC, bone], { maxSteps: 1_000_000 });
        mem.w32(ctrlOf(i) + 0xc, mem.r32(ctrlOf(i) + 0xc) | 2);
        attachCarry(W.records[i], carrier < 0 ? null : W.records[carrier], bone);
        cover.attaches++; if (bone < 1) cover.bone0++; else cover.boneN++;
      };
      const releaseBoth = (i, carrier, ticks) => {
        cpu.steps = 0; cpu.call(0x4296a2, [ctrlOf(i), RECORDS_BASE + carrier * REC, bitsOf(ticks)], { maxSteps: 1_000_000 });
        const ok = releaseCarry(W.records[i], W.records[carrier], ticks);
        cover.releases++; if (!ok) cover.foreign++;
      };
      const scaleBoth = (i, s) => { cpu.steps = 0; cpu.call(0x4295cb, [ctrlOf(i), bitsOf(s)], { maxSteps: 1_000_000 }); scaleCarry(W.records[i], s); if (s !== 1) cover.scaled++; };
      const compare = () => {
        for (const i of props) {
          const { a, pn, n } = nodeKeys(i);
          d.rec(i);
          d.eq(n + ' bone', mem.r32(a + 0x20) | 0, pn.bone); d.eq(n + ' carrier', ri(mem.r32(a + 0x24)), pn.carrier ? pn.carrier.index : -1);
          d.eq(n + ' varValue', mem.r32(a + 0x28) | 0, pn.varValue | 0);
          d.eq(n + ' scaled', mem.r16(a + 0x2c) !== 0, pn.scaled); d.cmp(n + ' scale', mem.f32(a + 0x30), pn.scale);
          d.eq(n + ' pushPending', mem.r16(a + 0x2e) !== 0, pn.pushPending); d.cmp(n + ' timer', mem.f32(a + 0x34), pn.timer);
          for (let k = 0; k < 3; k++) { d.cmp(n + ' push', mem.f32(a + 0x38 + 4 * k), pn.push[k], undefined, `[${k}]`, 1e-5); d.cmp(n + ' off', mem.f32(a + 0x14 + 4 * k), pn.off[k], undefined, `[${k}]`, 1e-6); }
          if (pn.timer > 0 && !pn.carrier) cover.lies++;
          if (mem.r32(a + 0x28) === 1) cover.varOne++;
        }
        d.eq('DAT_009da870', mem.r32(0x9da870), 0);
        d.vars(); d.sounds();
      };
      const step = (held = 0) => { d.tick(held); cover.ticks++; compare(); };
      const sc = 1 / dt;
      const run = (n) => { for (let t = 0; t < Math.round(n * sc); t++) step(0); };
      return { d, W, mem, props, idx, pep, attachBoth, releaseBoth, scaleBoth, step, run, nodeKeys, sc };
    };

    for (const [node, dt] of [[2, 1], [2, 0.5], [52, 1], [52, 0.5], [61, 1]]) {
      const label = `carry node${node} dt${dt}`;
      const S = session(label, node, dt);
      const { d, W, props, pep, attachBoth, releaseBoth, scaleBoth, step, run, mem } = S;
      const STATES = [0x1b, 0xd, 0x24, 0x1b];
      d.setState(0x1b);
      d.placePepper(160, 14, -40, 0.4);
      run(4);
      // bones of Pepper's rig (a bone past the rig reads the engine's pose buffer beyond the skeleton in the original: host dependent, not used)
      const nb = d.P.pepper.anim.pose(1).length / 16;
      notes.push(`${label}: carrier rig ${nb} bones`);
      let si = 0;
      for (const i of props) {
        // carried at several bones (the original's own bone of the prop, none = from the carrier's matrix, others), Pepper walking / turning meanwhile, the clip changing
        for (const bone of [d.pnode(i, 'PizzaCarry').bone, 0, 5, 14, 16, nb - 1]) {
          attachBoth(i, pep, bone);
          for (let k = 0; k < 4; k++) { d.placePepper(160 + k * 3, 14, -40 + k * 2, 0.4 + k * 0.7); d.setState(STATES[si++ % 4]); run(3); }
        }
        // the gate variable == 1 (the prop's update returns 1: nothing after it runs; the draw hook returns 1)
        { const v = d.pnode(i, 'PizzaCarry').var; const keep = d.getVar(v); d.setVar(v, 1); run(3); d.setVar(v, keep); }
        // scaled carrier matrix (FUN_004295cb), then back to 1.0
        scaleBoth(i, 1.5); run(3); scaleBoth(i, 0.75); run(2); scaleBoth(i, 1.0); run(2);
        // released by somebody else: ignored; by the carrier without a lying time; with a short lying time; the push depends on the carrier's facing
        { const other = W.records.findIndex((r, j) => j !== pep && j !== i && r.name === 'MFIG' || r.name === 'PETE'); releaseBoth(i, other >= 0 ? other : 0, 20); run(3); }
        for (const ticks of [0, 25, 7.5]) {
          attachBoth(i, pep, 16); run(2);
          d.placePepper(158, 14, -38, 1.2 + ticks * 0.05); run(2);
          releaseBoth(i, pep, ticks); run(ticks + 12);
        }
        // attached again while lying (resets the timer), then detached the way the story handler does (FUN_00429638(ctrl, 0, 0))
        releaseBoth(i, pep, 40); run(5); attachBoth(i, pep, 14); run(3); attachBoth(i, -1, 0); cover.detach++; run(4);
        // a long lying time that does not end within the run, then released again
        d.placePepper(150, 14, -45, 2.2); attachBoth(i, pep, 16); run(2); releaseBoth(i, pep, 480); run(60);
      }
      notes.push(`${label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
      for (const [a2, n] of d.emu.unhooked) unhooked.set(a2, (unhooked.get(a2) ?? 0) + n);
      for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      void step; void mem;
    }
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked, failures, notes };
  },
};
export default { ...suite, run: (ctx) => withCdHeap(() => suite.run(ctx)) };
