// WP-TIME, shell: the numerics of the cutscene manager (src/shell/cutscene.ts) against the original's own code in the x86 interpreter (src/formats/x86emu.ts, x87 at 24 bit), tolerance 0:
//   * FUN_004466f0 (the camera's cubic B-spline, through FUN_00445660)        = CameraSpline.sample
//   * FUN_0043efa0 (an actor's matrix track)                                  = ActorSpline.apply
//   * FUN_0045edae / FUN_0045eff9 / FUN_0045f1bc / FUN_0045f2f4 (eased moves)  = EasedMove (per DRAWN frame: no dt in any of them), with the shared "last remaining" global
//   * FUN_00422f21 (+ FUN_00422e36, FUN_0043a340, FUN_0043abe6): camera beside an actor, incl. the blocked-view retries
//   * FUN_0045cd23 (SETTARGET of an actor: yaw towards a point), FUN_0042992a (the carry node's matrices)
//   * FUN_0045f771 (the letterbox bars: rate * DAT_008b1718 per drawn frame) = Ui2D.letterboxStep, at dt 1, 0.5 and the real sequence
// The code runs natively from the user's own executable; the engine calls around it (collision sweep, variables, the bone matrix, the screen size) are host functions that record / answer.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { CameraSpline, ActorSpline, EasedMove, actorCamera, carryMatrix, CutsceneRunner, SIDE_VEC_CSM, SIDE_VEC_END, END_HEIGHT, ACTOR_LOOK_HEIGHT } from '../../src/shell/cutscene.ts';
import { Ui2D } from '../../src/ui/renderer2d.ts';
import { World } from '../../src/game/world.ts';
import { GameRecord } from '../../src/game/record.ts';

const fr = Math.fround;
const F = new Float32Array(1), U = new Uint32Array(F.buffer);
const bits = (v) => { F[0] = v; return U[0]; };
class Rnd {
  constructor(s) { this.s = s >>> 0; }
  next() { this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0; return this.s / 4294967296; }
  range(lo, hi) { return fr(lo + (hi - lo) * this.next()); }
  int(n) { return Math.floor(this.next() * n); }
}
const CRT = [0x858d30, 0x873e00];
const NATIVE = [0x43a340, 0x43a4a1, 0x43a5e4, 0x43a742, 0x43a9e5, 0x43ab72, 0x43abe6, 0x43cec0];
const HEAP = 0x20000000;
const same = (a, b) => Object.is(a, b) || (a === 0 && b === 0);   // +0 / -0 are the same compare result

export default {
  name: 'm7-shell-cutscene-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const cpu = createCpu(pe);
    cpu.cw = 0x7f;   // Direct3D 7 leaves the x87 in 24-bit precision
    const mem = cpu.mem;
    mem.addRegion({ lo: HEAP, hi: HEAP + 0x400000, name: 'heap' });
    mem.addRegion({ lo: 0x10000000, hi: 0x10004000, name: 'records' });
    let brk = HEAP;
    const alloc = (n) => { const p = brk; brk += (n + 15) & ~15; return p; };
    cpu.exec = [[0x45e000, 0x45fa00], [0x446600, 0x446ae4], [0x43ef00, 0x43f160], [0x422e00, 0x423400], [0x429900, 0x429b00], [0x45cd00, 0x45ce80], CRT];
    for (const a of NATIVE) cpu.native.add(a);
    cpu.fallback = () => (c) => { c.eax = 0; };
    const H = cpu.hooks;
    const call = (addr, args, ecx) => { cpu.steps = 0; if (ecx !== undefined) cpu.regs[1] = ecx | 0; return cpu.call(addr, args, { maxSteps: 5_000_000 }); };
    const cmp = (label, name, a, b) => {
      checked++;
      if (!same(a, b) && failures.length < 14) failures.push(`${label}: ${name}: original ${a} port ${b}`);
    };
    const floats = (p, n) => Array.from({ length: n }, (_, i) => mem.f32(p + 4 * i));

    // ---------------------------------------------------------------- the camera spline (FUN_004466f0)
    {
      const r = new Rnd(11);
      let n = 0;
      for (let sc = 0; sc < 60; sc++) {
        const count = 2 + r.int(60);
        const pts = new Float32Array(count * 3).map(() => r.range(-200, 200));
        const ptr = alloc(count * 12), obj = alloc(0x40), out = alloc(0x80);
        pts.forEach((v, i) => mem.wf32(ptr + 4 * i, v));
        mem.w32(obj + 0x14, count); mem.w32(obj + 0x18, ptr);
        const sp = Object.create(CameraSpline.prototype); sp.pts = pts; sp.count = count;
        const ts = [0, 1, fr(1 - 2 ** -24), 2 ** -20, 0.5, 1 / count, fr(1 - 1 / count)];
        for (let k = 0; k < 120; k++) ts.push(fr(r.next()));
        for (const t of ts) {
          call(0x4466f0, [out, bits(t)], obj);
          const o = floats(out + 0x30, 3), p = sp.sample(t);
          for (let k = 0; k < 3; k++) cmp(`spline ${sc} t ${t}`, `p${k}`, o[k], p[k]);
          n++;
        }
      }
      notes.push(`camera spline: ${n} samples of 60 random splines (2 .. 61 points) equal to FUN_004466f0`);
    }

    // ---------------------------------------------------------------- an actor's matrix track (FUN_0043efa0)
    {
      const r = new Rnd(23);
      let n = 0;
      for (let sc = 0; sc < 40; sc++) {
        const count = 2 + r.int(40);
        const rec = new Float32Array((count + 1) * 9);
        for (let i = 0; i <= count; i++) {
          const b = i * 9;
          rec[b] = r.range(-3, 3); rec[b + 1] = r.range(-3, 3); rec[b + 2] = r.range(-3, 3);
          rec[b + 3] = r.range(-100, 100); rec[b + 4] = r.range(-20, 20); rec[b + 5] = r.range(-100, 100);
          rec[b + 6] = r.range(0.3, 2); rec[b + 7] = r.range(0.3, 2); rec[b + 8] = r.range(0.3, 2);
        }
        const ptr = alloc(rec.length * 4), obj = alloc(16), outM = alloc(64);
        rec.forEach((v, i) => mem.wf32(ptr + 4 * i, v));
        mem.w32(obj, count); mem.w32(obj + 4, ptr);
        const sp = Object.create(ActorSpline.prototype); sp.rec = rec; sp.count = count;
        const ts = [-0.5, 0, 1, 1.5, 0.5, fr(1 - 2 ** -24)];
        for (let k = 0; k < 80; k++) ts.push(fr(r.next()));
        for (const t of ts) {
          call(0x43efa0, [obj, outM, bits(t)]);
          const o = floats(outM, 16), m = new Float32Array(16);
          sp.apply(t, m);
          for (let k = 0; k < 16; k++) cmp(`actor spline ${sc} t ${t}`, `m${k}`, o[k], m[k]);
          n++;
        }
      }
      notes.push(`actor spline: ${n} matrices of 40 random tracks equal to FUN_0043efa0 (t clamped to 0 .. 1)`);
    }

    // ---------------------------------------------------------------- eased moves (FUN_0045edae + FUN_0045f2f4)
    {
      const r = new Rnd(37);
      const cmd = alloc(0x80), eye = alloc(16), lastP = alloc(16);
      mem.w32(0x983840, 0);   // no Shift
      let moves = 0, steps = 0, arrivedFast = 0, stuck = 0;
      const portLast = { v: 0 };   // the shared global of the original (DAT_05d4dca8): one for all the moves of this run, like the port's runner
      mem.wf32(lastP, 0);
      for (let sc = 0; sc < 500; sc++) {
        const near = r.int(6);
        const from = [r.range(-80, 80), r.range(-30, 30), r.range(-80, 80)];
        const to = near === 0 ? from.slice() : near === 1 ? from.map((v) => fr(v + r.range(-0.05, 0.05))) : near === 2 ? from.map((v) => fr(v + r.range(-3, 3))) : [r.range(-80, 80), r.range(-30, 30), r.range(-80, 80)];
        const maxStep = r.int(3) === 0 ? fr(0.4) : fr(fr(1 + r.int(30)) * fr(0.1));
        const ease = r.int(3) === 0 ? fr(0.08) : fr(fr(1 + r.int(10)) * fr(0.02));
        mem.fill(cmd, 0x80, 0);
        mem.w8(cmd + 0x24, 0);
        for (let k = 0; k < 3; k++) { mem.wf32(cmd + 0x28 + 4 * k, to[k]); mem.wf32(eye + 4 * k, from[k]); }
        call(0x45edae, [cmd, eye, bits(maxStep), bits(ease)]);
        const mv = new EasedMove(from, to, maxStep, ease);
        const p = from.slice();
        const label = `move ${sc} (${near})`;
        cmp(label, 'set-up remaining', mem.f32(cmd + 0x48), mv.left);
        for (let k = 0; k < 3; k++) cmp(label, `set-up unit${k}`, mem.f32(cmd + 0x4c + 4 * k), mv.unit[k]);
        let done = false, t = 0;
        for (; t < 2500 && !done && failures.length < 14; t++) {
          const ret = call(0x45f2f4, [cmd, eye, lastP, 0]) & 0xff;
          const arrived = mv.step(p, portLast);
          cmp(label, `step ${t} result`, ret, arrived ? 1 : 0);
          for (let k = 0; k < 3; k++) cmp(label, `step ${t} eye${k}`, mem.f32(eye + 4 * k), p[k]);
          cmp(label, `step ${t} phase`, mem.f32(cmd + 0x38), mv.phase);
          cmp(label, `step ${t} travelled`, mem.f32(cmd + 0x40), mv.travelled);
          cmp(label, `step ${t} remaining`, mem.f32(cmd + 0x48), mv.remaining);
          for (let k = 0; k < 3; k++) cmp(label, `step ${t} v${k}`, mem.f32(cmd + 0x58 + 4 * k), mv.v[k]);
          cmp(label, `step ${t} last`, mem.f32(lastP), portLast.v);
          steps++;
          done = arrived;
        }
        if (!done) stuck++;   // the original's move can circle the target for ever too (both sides agree at every step)
        if (t <= 2) arrivedFast++;
        moves++;
      }
      notes.push(`eased moves: ${moves} moves (${steps} steps; ${arrivedFast} arrive at once, ${stuck} circle the target for 2500 steps in the original too), eye, phase, travelled, remaining, step vector and the shared last-remaining global equal at every step`);
    }

    // ---------------------------------------------------------------- spline playback (FUN_0045f2f4 kind 2): `t += rate * DAT_008b1718`, done at t >= 1.0
    {
      const r = new Rnd(29);
      const cmd = alloc(0x80), eye = alloc(16), lastP = alloc(16), outS = alloc(0x80);
      let sp = null;
      // FUN_00445660(spline, t, out): the evaluation itself is the verified FUN_004466f0 above; here the host answers with the port's, so the progress arithmetic is what is compared
      H.set(0x445660, () => { const p = sp.sample(cpu.argf(1)); for (let k = 0; k < 3; k++) mem.wf32(cpu.arg(2) + 0x30 + 4 * k, p[k]); cpu.eax = 0; });
      mem.w32(0x983840, 0);
      let n = 0;
      for (const mode of ['dt1', 'dt05', 'real']) {
        for (let sc = 0; sc < 30; sc++) {
          const count = 2 + r.int(120);
          sp = Object.create(CameraSpline.prototype); sp.pts = new Float32Array(count * 3).map(() => r.range(-50, 50)); sp.count = count;
          mem.fill(cmd, 0x80, 0);
          mem.w8(cmd + 0x24, 2); mem.wf32(cmd + 0x3c, sp.rate); mem.wf32(cmd + 0x40, 0);
          const wS = new World();
          const runnerS = new CutsceneRunner({ world: wS, waypoint: () => null, text: (i) => i, say: () => false, speechIdle: () => true, stopSpeech() {}, setFov() {}, skipPressed: () => false, speechOn: () => false, textOn: () => false, letterbox() {} });
          const mS = { c: { targetKind: 'spline' }, camSpline: sp, t: 0, x: {}, timer: 0 };
          const camS = new Float32Array(18);
          const label = `spline play ${mode} ${sc}`;
          for (let step = 0; step < 4 * count + 20; step++) {
            const dt = mode === 'dt1' ? 1 : mode === 'dt05' ? 0.5 : step < 5 ? 1 : 0.5;
            mem.wf32(0x8b1718, dt); wS.dt = dt;
            const ret = call(0x45f2f4, [cmd, eye, lastP, 2]) & 0xff;
            const done = runnerS.camStep(mS, camS, 0);        // the runner's own step (the private method of the eased / spline camera moves)
            cmp(label, `step ${step} result`, ret, done ? 1 : 0);
            cmp(label, `step ${step} t`, mem.f32(cmd + 0x40), mS.t);
            for (let k = 0; k < 3; k++) cmp(label, `step ${step} eye${k}`, mem.f32(eye + 4 * k), camS[k]);
            n++;
            if (done) break;
          }
        }
      }
      notes.push(`spline playback: ${n} steps at dt 1, 0.5 and the real sequence: progress, result and the written position equal to FUN_0045f2f4`);
    }

    // ---------------------------------------------------------------- the camera beside an actor (FUN_00422f21)
    {
      const r = new Rnd(41);
      const RECS = 0x10000000, REC = 0x68;
      const vecP = alloc(16);
      let blockedSeq = [], bi = 0, nodeVar = 0, calls = 0;
      H.set(0x441270, () => { cpu.eax = blockedSeq[bi++] ?? 0; });         // FUN_00441270: the sweep, nonzero = blocked
      H.set(0x417575, () => { cpu.eax = nodeVar; });                        // FUN_00417575(0x58): the story node
      let n = 0;
      for (let sc = 0; sc < 400; sc++) {
        const vec = sc % 2 ? SIDE_VEC_CSM : SIDE_VEC_END;
        const pos = [r.range(-100, 100), r.range(-20, 40), r.range(-100, 100)];
        const yaw = sc % 7 === 0 ? 0 : r.range(-4, 4);
        const side = r.int(6) | (r.int(2) ? 0x1000 : 0);
        const height = sc % 3 === 0 ? ACTOR_LOOK_HEIGHT : sc % 3 === 1 ? END_HEIGHT : r.range(0, 6);
        nodeVar = r.int(2) ? 12 : 3;
        blockedSeq = Array.from({ length: 6 }, () => (r.int(3) === 0 ? 0 : 1));
        const rp = RECS;
        for (let k = 0; k < 3; k++) mem.wf32(rp + 0x3c + 4 * k, pos[k]);
        for (let k = 0; k < 3; k++) mem.wf32(vecP + 4 * k, vec[k]);
        for (let k = 0; k < 18; k++) mem.wf32(0x9da5e8 + 4 * k, 0);
        bi = 0;
        call(0x422f21, [rp, bits(yaw), side, bits(height), vecP]);
        const eyeO = floats(0x9da5e8, 3), lookO = floats(0x9da5f4, 3);
        const w = new World();
        w.vars.set(0x58, nodeVar);
        const seq = blockedSeq.slice(); let pi = 0;
        w.col.sweep = () => (seq[pi++] ?? 0) !== 0;
        const rec = new GameRecord('TEST');
        rec.m[12] = pos[0]; rec.m[13] = pos[1]; rec.m[14] = pos[2];
        actorCamera(w, rec, yaw, side, height, vec);
        const c = w.camera.c;
        for (let k = 0; k < 3; k++) { cmp(`actor camera ${sc}`, `eye${k}`, eyeO[k], c[k]); cmp(`actor camera ${sc}`, `look${k}`, lookO[k], c[3 + k]); }
        cmp(`actor camera ${sc}`, 'sweeps asked', bi, pi);
        n++; calls += bi;
      }
      notes.push(`actor camera: ${n} cases (all sides, blocked-view retries, node < 8 / >= 8), eye and look-at equal; ${calls} sweeps asked in the same order`);
    }

    // ---------------------------------------------------------------- SETTARGET of an actor (FUN_0045cd23)
    {
      const r = new Rnd(53);
      const RECS = 0x10000000, REC = 0x68, cmd = alloc(0x80);
      const runner = new CutsceneRunner({ world: new World(), waypoint: () => null, text: (i) => i, say: () => false, speechIdle: () => true, stopSpeech() {}, setFov() {}, skipPressed: () => false, speechOn: () => false, textOn: () => false, letterbox() {} });
      let n = 0;
      for (let sc = 0; sc < 300; sc++) {
        const a = RECS + 0x100, tgt = RECS + 0x200;
        const pos = [r.range(-100, 100), r.range(-5, 5), r.range(-100, 100)], tp = [r.range(-100, 100), r.range(-5, 5), r.range(-100, 100)];
        const e = [r.range(-0.3, 0.3), r.range(-3, 3), r.range(-0.3, 0.3)];
        const kind = r.int(2);
        mem.fill(cmd, 0x80, 0);
        for (let k = 0; k < 3; k++) { mem.wf32(a + 0x3c + 4 * k, pos[k]); mem.wf32(a + 0x4c + 4 * k, e[k]); mem.wf32(tgt + 0x3c + 4 * k, tp[k]); mem.wf32(cmd + 0x2c + 4 * k, tp[k]); }
        mem.w32(cmd + 0x14, a); mem.w32(cmd + 0x28, tgt); mem.w8(cmd + 0x24, kind);
        call(0x45cd23, [cmd]);
        const rec = new GameRecord('ACTR'), target = new GameRecord('TRGT');
        rec.m[12] = pos[0]; rec.m[13] = pos[1]; rec.m[14] = pos[2]; rec.rx = e[0]; rec.ry = e[1]; rec.rz = e[2];
        target.m[12] = tp[0]; target.m[13] = tp[1]; target.m[14] = tp[2];
        runner.turnTo({ c: { targetKind: kind === 1 ? 'actor' : 'waypoint' }, target, wpPos: tp }, rec);
        cmp(`turn ${sc}`, 'ry', mem.f32(a + 0x50), rec.ry);
        const o = floats(a + 0xc, 16);
        for (let k = 0; k < 16; k++) cmp(`turn ${sc}`, `m${k}`, o[k], rec.m[k]);
        n++;
      }
      notes.push(`SETTARGET of an actor: ${n} turns (yaw field and the record matrix) equal to FUN_0045cd23`);
    }

    // ---------------------------------------------------------------- the carry node's matrices (FUN_0042992a)
    {
      const r = new Rnd(67);
      const RECS = 0x10000000, node = alloc(0x80), boneM = alloc(64);
      H.set(0x43bc58, () => { cpu.eax = boneM; });         // FUN_0043bc58(anim, bone): the bone matrix of the pose
      H.set(0x444480, () => { cpu.eax = 0; });
      let n = 0;
      for (let sc = 0; sc < 200; sc++) {
        const child = RECS + 0x300, parent = RECS + 0x400;
        const pm = Array.from({ length: 16 }, () => r.range(-3, 3)), bm = Array.from({ length: 16 }, () => r.range(-3, 3));
        const off = [r.range(-2, 2), r.range(-2, 2), r.range(-2, 2)];
        const bone = r.int(2) ? 0 : 1 + r.int(5);
        mem.fill(node, 0x80, 0);
        mem.fill(child, 0x68, 0);
        pm.forEach((v, i) => mem.wf32(parent + 0xc + 4 * i, v));
        bm.forEach((v, i) => mem.wf32(boneM + 4 * i, v));
        off.forEach((v, i) => mem.wf32(node + 0x14 + 4 * i, v));
        mem.w32(node + 0x20, bone); mem.w32(node + 0x24, parent);
        call(0x42992a, [child, node, 0, 0]);
        const c = new GameRecord('CHLD'), p = new GameRecord('PRNT');
        p.m.set(pm);
        p.anim = { pose: () => { const a = new Float32Array((bone + 1) * 16); a.set(bm, bone * 16); return a; } };
        carryMatrix(c, p, bone, off);
        const o = floats(child + 0xc, 16);
        for (let k = 0; k < 16; k++) cmp(`carry ${sc} bone ${bone}`, `m${k}`, o[k], c.m[k]);
        n++;
      }
      notes.push(`carry node: ${n} matrices (bone 0 = parent copy, bones >= 1 = offset x bone x parent) equal to FUN_0042992a`);
    }

    // ---------------------------------------------------------------- the letterbox (FUN_0045f750 / FUN_0045f771)
    {
      const dtOf = (mode, t) => (mode === 'dt1' ? 1 : mode === 'dt05' ? 0.5 : t < 5 ? 1 : 0.5);
      let screenH = 600;
      H.set(0x40ccd8, () => { mem.wf32(cpu.arg(1), screenH); cpu.eax = 0; });   // FUN_0040ccd8(&w, &h, &?): the back buffer size
      H.set(0x40ccce, () => { cpu.eax = 0; });
      H.set(0x40cc4d, () => { cpu.eax = 0; });
      let draws = [];
      H.set(0x43c267, () => { draws.push([cpu.arg(0)]); cpu.eax = 0; });
      cpu.exec.push([0x45f700, 0x45fa00]);
      let n = 0;
      for (const mode of ['dt1', 'dt05', 'real']) for (const H_ of [480, 600, 1080]) for (const bars of [1, 2]) {
        screenH = H_;
        const ui = Object.create(Ui2D.prototype);
        ui.ch = H_; ui.cw = Math.round(H_ * 4 / 3); ui.lbMode = 0; ui.lbState = 0; ui.lbH = 0; ui.lbRate = 0; ui.lbMax = 0;
        call(0x45f750, [bars]);
        const label = `letterbox ${mode} H ${H_} bars ${bars}`;
        for (let t = 0; t < 400 && failures.length < 14; t++) {
          const dt = dtOf(mode, t);
          mem.wf32(0x8b1718, dt);
          call(0x45f771, []);
          ui.letterboxStep(bars, dt);
          cmp(label, `step ${t} state`, mem.r32(0x5d4dcb8), ui.lbState);
          if (ui.lbState === 2) {
            cmp(label, `step ${t} height`, mem.f32(0x5d4dce4), ui.lbH);
            cmp(label, `step ${t} rate`, mem.f32(0x5d4dce8), ui.lbRate);
            cmp(label, `step ${t} max`, mem.f32(0x5d4dcf0), ui.lbMax);
            if (t > 0) cmp(label, `step ${t} bar rows`, mem.r32(0x5d4dcd0), Math.trunc(ui.lbH));   // (the arming pass does not write the rows)
          }
          n++;
        }
      }
      notes.push(`letterbox: ${n} passes at dt 1, 0.5 and the real sequence (3 screen heights, 1 and 2 bars): state, height, rate, max and the bar rows equal to FUN_0045f771`);
    }
    return { checked, failures, notes };
  },
};
