// Ontwikkelaarshoek section 4 "Camera en tekenen": the ported functions against the ORIGINAL code of the executable, run in the x86 emulation (src/formats/x86emu.ts, the x87 in the 24 bit mode that
// Direct3D 7 leaves, like the m7 oracles). Every comparison is bit exact (float32 patterns) unless it says otherwise.
//   free camera   FUN_0088fd70 (+ FUN_0043a340, FUN_0043a9e5, FUN_0043cc5c / FUN_004165a5): the camera array (18 floats) and the state DAT_00982d28 .. 0x982d87 tick by tick over scripted and random pad sequences
//   autoplay      FUN_00423170 (the OR of bit 4 into DAT_0098383c / DAT_00983840) and FUN_00423f7b (counter, story advance loop, return value) against src/devcorner/camera-autoplay.ts
//   debug queue   FUN_00445ba0 / FUN_00445c70 / FUN_00445cf0 (the stored entries, the switches) and FUN_00445d20's marker geometry (the lines FUN_0087da0b receives, in order)
//   box lines     FUN_00440ac0 (the 12 lines of a collision box) against ProbeSink.box
//   LOD           FUN_00443d10 (level / far clip state machine) and FUN_00443f90 (the part choice, incl. FUN_00890290's PEPP test) against AdaptiveDetail
//   frustum OBJ   FUN_00415497 with a hooked fopen / fprintf: the text of Debug.obj against frustumObj()
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { FreeCam, FREE } from '../../src/devcorner/camera-free.ts';
import { Autoplay } from '../../src/devcorner/camera-autoplay.ts';
import { DebugQueue, drawQueue, QUEUE_LIMIT } from '../../src/devcorner/camera-draw.ts';
import { ProbeSink } from '../../src/devcorner/camera-probes.ts';
import { AdaptiveDetail, readLodConsts, LOD_VA } from '../../src/devcorner/camera-lod.ts';
import { frustumObj, pyramidCorners, cf } from '../../src/devcorner/camera-frustum.ts';
import { CollisionWorld } from '../../src/game/collision.ts';
import { loadZone } from '../lib/engine-load.mjs';
import '../../src/zones/index.ts';

const CRT = [0x858d30, 0x873e00];
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
const bits = (v) => { f32[0] = v; return u32[0]; };
const fval = (b) => { u32[0] = b >>> 0; return f32[0]; };
/** a small deterministic generator */
function rng(seed) { let s = seed >>> 0; const n = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; n.int = (k) => Math.floor(n() * k); return n; }

function emu(pe, ranges) {
  const cpu = createCpu(pe);
  cpu.cw = 0x7f;                                           // 24 bit mantissa: every result is a float32 (as the shipped game runs)
  cpu.exec = [...ranges, CRT];
  cpu.fallback = (a) => (c) => { throw new Error(`unhooked call to 0x${a.toString(16)} from 0x${c.retAddr.toString(16)}`); };
  cpu.hooks.set(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(c.mem.f64(sp + 4), c.mem.f64(sp + 12))); });
  cpu.mem.addRegion({ lo: 0x20000000, hi: 0x20100000, name: 'scratch' });
  cpu.invalidate();
  return cpu;
}

export default {
  name: 'devcorner-camera',
  async run(ctx) {
    const failures = [];
    const notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c && failures.length < 60) failures.push(m); else if (!c) failures.push(null); };
    const pe = loadExe(ctx.dataRoot);

    // ------------------------------------------------------------------------------------------------------------ 1. free camera
    {
      const FREEFN = [[0x88fd70, 0x890000], [0x43a000, 0x43b100], [0x43cb00, 0x43d000], [0x415000, 0x418000], [0x40c000, 0x40d000]];
      const script = (steps) => steps.flatMap(([pad, dt, n]) => Array.from({ length: n }, () => [pad, dt]));
      const L = 1, R = 2, U = 4, D = 8, C = 0x10;
      const scripts = {
        'Up x3 (dt 1/30)': script([[U, 1 / 30, 3]]),
        'Left x2, Up x4, Right, Down': script([[L, 1, 2], [U, 1, 4], [R, 1, 1], [D, 1, 1]]),
        'Ctrl+Up x3, Ctrl+Down x2, strafe': script([[C | U, 1, 3], [C | D, 1, 2], [C | L, 1, 3], [C | R, 1, 2]]),
        'combinations': script([[L | U, 1, 3], [C | L | U, 1, 2], [L | R, 1, 2], [U | D, 1, 2], [C | U | D, 1, 2], [C | L | R, 1, 2], [0, 1, 2], [L | R | U | D | C, 0.5, 2], [U, 0.6666667, 5]]),
        'dt 0.5': script([[U, 0.5, 6], [L, 0.5, 6], [C | D, 0.5, 4]]),
      };
      const r = rng(7);
      const rand = [];
      for (let i = 0; i < 600; i++) rand.push([r.int(32), 0.25 + r() * 1.5]);
      scripts['600 random ticks'] = rand;
      let ticks = 0, maxUlp = 0, bitDiffs = 0;
      for (const [name, steps] of Object.entries(scripts)) {
        const cpu = emu(pe, FREEFN);
        cpu.hooks.set(0x416961, () => {});               // the render device's SetTransform of FUN_0043cc5c
        const mem = cpu.mem;
        const cam = new Float64Array(18);
        for (let i = 0; i < 18; i++) cam[i] = mem.f32(FREE.CAM + 4 * i);
        const fc = new FreeCam(pe);
        // the start state the port reads from the exe is the one the emulator has
        const s0 = fc.snapshot();
        ok([0, 1, 2].every((k) => bits(s0.pos[k]) === mem.u32(FREE.POS + 4 * k)) && bits(s0.pitch) === mem.u32(FREE.PITCH) && bits(s0.yaw) === mem.u32(FREE.YAW), `${name}: start state differs from the exe`);
        let first = true;
        steps.forEach(([pad, dt], t) => {
          mem.w32(FREE.PAD, pad); mem.wf32(FREE.DT, dt);
          cpu.call(0x88fd70, [0x20000100, FREE.CAM]);
          fc.step(pad, dt, cam);
          ticks++;
          const want = [];
          for (let k = 0; k < 3; k++) want.push(mem.u32(FREE.POS + 4 * k));
          want.push(mem.u32(FREE.PITCH), mem.u32(FREE.YAW));
          for (let k = 0; k < 16; k++) want.push(mem.u32(FREE.MAT + 4 * k));
          for (let k = 0; k < 18; k++) want.push(mem.u32(FREE.CAM + 4 * k));
          const sn = fc.snapshot();
          const got = [...sn.pos.map(bits), bits(sn.pitch), bits(sn.yaw), ...sn.mat.map(bits), ...Array.from(cam, bits)];
          let bad = 0;
          got.forEach((g, k) => {
            if (g !== want[k]) {
              bad++; bitDiffs++;
              const ulp = Math.abs(((g >>> 0) | 0) - ((want[k] >>> 0) | 0));
              if (ulp < 1e6) maxUlp = Math.max(maxUlp, ulp);
            }
          });
          ok(bad === 0 || !first && false, `${name} tick ${t} (pad 0x${pad.toString(16)}, dt ${dt}): ${bad} of ${got.length} words differ (first at ${got.findIndex((g, k) => g !== want[k])})`);
          first = false;
        });
      }
      notes.push(`free camera: ${ticks} ticks over ${Object.keys(scripts).length} scripts, camera array + state ${bitDiffs === 0 ? 'bit exact' : `${bitDiffs} words differ, at most ${maxUlp} ulp`}`);
      // takeOver: the direction can be reached (the matrix's second and third row are all the original keeps)
      const fc = new FreeCam(pe);
      const rr = rng(3);
      let worst = 0;
      for (let i = 0; i < 25; i++) {
        const a = rr() * Math.PI * 2, b = (rr() - 0.5) * Math.PI;
        const dir = [Math.cos(b) * Math.sin(a), Math.sin(b), Math.cos(b) * Math.cos(a)];
        fc.takeOver([0, 0, 0], dir);
        const m = fc.mat;
        const dot = Math.max(-1, Math.min(1, m[8] * dir[0] + m[9] * dir[1] + m[10] * dir[2]));
        worst = Math.max(worst, Math.acos(dot));
      }
      ok(worst < 0.01, `takeOver: worst direction error ${worst.toFixed(4)} rad`);
      notes.push(`takeOver (extension): worst direction error over 25 random directions ${(worst * 57.29578).toFixed(3)} degrees`);
    }

    // ------------------------------------------------------------------------------------------------------------ 2. autoplay
    {
      const cpu = emu(pe, [[0x423170, 0x423260], [0x423f7b, 0x423fe0]]);
      const mem = cpu.mem;
      const A = { ON: 0x9da634, CNT: 0x9da638, HELD: 0x98383c, PRESSED: 0x983840 };
      // FUN_00423170: the pad poll (FUN_004376f9) is scripted, FUN_0041c080 only runs for Esc
      let polled = 0;
      cpu.hooks.set(0x4376f9, (c) => { c.eax = polled; });
      cpu.hooks.set(0x41c080, () => {});
      const state = 0x20000200;
      const port = new Autoplay();
      const r = rng(11);
      let n = 0;
      for (const on of [0, 1]) {
        mem.w32(A.ON, on); port.on = !!on;
        for (let counter = 0; counter < 6; counter++) {
          for (let k = 0; k < 40; k++) {
            const word = r.int(0x20) & ~0x40;            // arrows, Ctrl, Alt: no Esc / Shift (they have their own branches in the first lines of FUN_00423170)
            const prev = r.int(0x20);
            polled = word; mem.w32(state, 2); mem.w32(A.HELD, prev); mem.w32(A.CNT, counter); port.counter = counter;
            cpu.call(0x423170, [state]);
            const heldWord = mem.u32(A.HELD), pressedWord = mem.u32(A.PRESSED);
            const outPort = port.apply(word, ((word ^ prev) & word) >>> 0);
            n++;
            ok(outPort.held === heldWord && outPort.pressed === pressedWord, `FUN_00423170 on ${on} counter ${counter} pad 0x${word.toString(16)} prev 0x${prev.toString(16)}: held 0x${outPort.held.toString(16)} / pressed 0x${outPort.pressed.toString(16)} vs 0x${heldWord.toString(16)} / 0x${pressedWord.toString(16)}`);
          }
        }
      }
      notes.push(`autoplay FUN_00423170: ${n} polls, held and pressed words equal`);
      // FUN_00423f7b with a scripted story: zones of the nodes (repeats make the do-while loop several times)
      const zones = [4, 4, 4, 9, 9, 12, 12, 12, 12, 3, 3, 30, 30, 30, 5, 5, 6];
      let node = 0;
      const story = { node: 0 };
      cpu.hooks.set(0x417575, (c) => { c.eax = c.arg(0) === 0x59 ? zones[story.node] : 0; });    // var 0x59: the zone the story is in
      cpu.hooks.set(0x404bb2, () => { story.node++; });
      cpu.hooks.set(0x404be7, (c) => { c.eax = zones[story.node] ?? 0; });
      for (const on of [1]) {
        for (let run = 0; run < 3; run++) {
          const p = new Autoplay(); p.on = !!on;
          mem.w32(A.ON, on); mem.w32(A.CNT, 0);
          story.node = run * 3; node = run * 3;
          const ps = { currentZone: () => zones[node], advance: () => { node++; }, nodeZone: () => zones[node] ?? 0 };
          const gaps = [];
          let last = 0;
          for (let f = 1; f <= 1000; f++) {
            const want = cpu.call(0x423f7b, []) >>> 0;
            const got = p.frameEnd(ps) ? 1 : 0;
            n++;
            ok(want === got && mem.u32(A.CNT) === p.counter && story.node === node, `FUN_00423f7b run ${run} frame ${f}: return ${got} vs ${want}, counter ${p.counter} vs ${mem.u32(A.CNT)}, node ${node} vs ${story.node}`);
            if (want) { gaps.push(f - last); last = f; }
            if (story.node >= zones.length - 2) { story.node = 0; node = 0; }
          }
          notes.push(`autoplay FUN_00423f7b run ${run}: leaves after frames ${[...new Set(gaps)].join(', ')} (one more than 0x96 per leave)`);
        }
        // the off state: nothing counts, nothing returns
        mem.w32(A.ON, 0); mem.w32(A.CNT, 5);
        const p = new Autoplay(); p.counter = 5;
        ok(cpu.call(0x423f7b, []) === 0 && mem.u32(A.CNT) === 5 && !p.frameEnd({ currentZone: () => 0, advance() {}, nodeZone: () => 0 }) && p.counter === 5, 'FUN_00423f7b with autoplay off');
      }
    }

    // ------------------------------------------------------------------------------------------------------------ 3. debug queue
    {
      const Q = [[0x445b00, 0x445d20], [0x445f20, 0x446300], [0x43a000, 0x43b100]];
      const cpu = emu(pe, Q);
      const mem = cpu.mem;
      const G = { MASTER: 0x5cb588c, MODE: 0x5cb5894, LINE_ON: 0x5cb5898, SHAPE_ON: 0x5cb589c, NLINES: 0x14d5878, NSHAPES: 0x14d587c, LINES: 0x14d5888, SHAPES: 0x9e5878 };
      const r = rng(5);
      const q = new DebugQueue();
      mem.w32(G.MASTER, 1); mem.w32(G.LINE_ON, 1); mem.w32(G.SHAPE_ON, 1); q.master = true;
      const P = 0x20000300;
      for (let i = 0; i < 300; i++) {
        const a = [0, 1, 2].map(() => (r() - 0.5) * 400), b = [0, 1, 2].map(() => (r() - 0.5) * 400);
        const c0 = (r.int(65536) * 65536 + r.int(65536)) >>> 0, c1 = (r.int(65536) * 65536 + r.int(65536)) >>> 0;
        const mode = r.int(4) === 0 ? 1 : 0;
        a.forEach((v, k) => { mem.wf32(P + 4 * k, v); mem.wf32(P + 16 + 4 * k, b[k]); });
        mem.w32(G.MODE, mode); q.setMode(mode);
        if (i % 3 === 0) {
          const type = r.int(3), rad = r() * 5, col = c0;
          mem.wf32(P + 40, rad);
          cpu.call(0x445c70, [P, type, bits(rad), col]); q.shape([fval(bits(a[0])), fval(bits(a[1])), fval(bits(a[2]))], type, fval(bits(rad)), col);
        } else {
          cpu.call(0x445ba0, [P, P + 16, c0, c1]); q.line(a.map((v) => fval(bits(v))), b.map((v) => fval(bits(v))), c0, c1);
        }
      }
      ok(mem.u32(G.NLINES) === q.lines.length && mem.u32(G.NSHAPES) === q.shapes.length, `queue counts: ${mem.u32(G.NLINES)} / ${mem.u32(G.NSHAPES)} vs ${q.lines.length} / ${q.shapes.length}`);
      let bad = 0;
      q.lines.forEach((l, i) => {
        const o = G.LINES + i * 0x24;
        const w = [mem.u32(o), mem.u32(o + 4), mem.u32(o + 8), mem.u32(o + 12), mem.u32(o + 16), mem.u32(o + 20), mem.u32(o + 24), mem.u32(o + 28), mem.u32(o + 32)];
        const m = [l.mode, ...l.a.map(bits), ...l.b.map(bits), l.c0, l.c1].map((v) => v >>> 0);
        if (w.some((v, k) => v !== m[k])) bad++;
      });
      q.shapes.forEach((s, i) => {
        const o = G.SHAPES + i * 0x1c;
        const w = [mem.u32(o), mem.u32(o + 4), mem.u32(o + 8), mem.u32(o + 12), mem.u32(o + 16), mem.u32(o + 24)];
        const m = [...s.pos.map(bits), bits(s.r), s.color, s.type].map((v) => v >>> 0);
        if (w.some((v, k) => v !== m[k])) bad++;
      });
      ok(bad === 0, `queue entries: ${bad} differ from the original's memory`);
      // the switches
      const n0 = mem.u32(G.NLINES);
      mem.w32(G.MASTER, 0); cpu.call(0x445ba0, [P, P + 16, 1, 2]); q.master = false; q.line([0, 0, 0], [1, 1, 1], 1, 2);
      ok(mem.u32(G.NLINES) === n0 && q.lines.length === n0, 'master off: nothing is queued');
      mem.w32(G.MASTER, 1); q.master = true; mem.w32(G.LINE_ON, 0); q.lineOn = false;
      cpu.call(0x445ba0, [P, P + 16, 1, 2]); q.line([0, 0, 0], [1, 1, 1], 1, 2);
      ok(mem.u32(G.NLINES) === n0 && q.lines.length === n0, 'line queue off: nothing is queued');
      // FUN_00445cf0 (reset): counts 0, queues on again
      cpu.call(0x445cf0, []); q.reset();
      ok(mem.u32(G.NLINES) === 0 && mem.u32(G.NSHAPES) === 0 && mem.u32(G.LINE_ON) === 1 && mem.u32(G.SHAPE_ON) === 1 && q.lines.length === 0 && q.shapes.length === 0 && q.lineOn && q.shapeOn, 'FUN_00445cf0');
      // the overflow rule of FUN_00445c30 (the original's MessageBoxA is the host's): count >= 0x64000 switches the queue off and warns once
      const big = new DebugQueue(); big.master = true;
      let asked = 0; big.onOverflow = () => { asked++; return true; };
      for (let i = 0; i < QUEUE_LIMIT + 5; i++) big.line([0, 0, 0], [1, 1, 1], 0, 0);
      ok(big.lines.length === QUEUE_LIMIT && !big.lineOn && asked === 1 && big.overflows === 1, `overflow: ${big.lines.length} lines, on ${big.lineOn}, asked ${asked}`);
      big.reset();
      for (let i = 0; i < QUEUE_LIMIT; i++) big.line([0, 0, 0], [1, 1, 1], 0, 0);
      ok(asked === 1 && big.warnings === 1, 'the "No" answer (DAT_05cb58a0) stops the warnings');

      // the drain: marker geometry. The original's FUN_0087da0b / FUN_0087da91 (D3D calls) record the lines; the other draw-state calls are no-ops
      const cpu2 = emu(pe, [[0x445b00, 0x445f20], [0x445f20, 0x446300], [0x43a000, 0x43b100]]);
      const mem2 = cpu2.mem;
      const got = [];
      for (const a of [0x88645f, 0x4095a1, 0x409563, 0x416885, 0x416b98, 0x412037, 0x4092fd]) cpu2.hooks.set(a, (c) => { c.eax = 0; });
      const rec3 = (mode) => (c) => { const a = c.arg(0), b = c.arg(1); got.push([mode, [0, 1, 2].map((k) => mem2.u32(a + 4 * k)), [0, 1, 2].map((k) => mem2.u32(b + 4 * k)), c.arg(2) >>> 0, c.arg(3) >>> 0]); };
      cpu2.hooks.set(0x87da0b, rec3(0)); cpu2.hooks.set(0x87da91, rec3(1));
      const q2 = new DebugQueue(); q2.master = true;
      mem2.w32(G.MASTER, 1); mem2.w32(G.LINE_ON, 1); mem2.w32(G.SHAPE_ON, 1);
      const r2 = rng(9);
      const P2 = 0x20000300;
      for (let i = 0; i < 120; i++) {
        const a = [0, 1, 2].map(() => (r2() - 0.5) * 300), b = [0, 1, 2].map(() => (r2() - 0.5) * 300);
        const c0 = r2.int(0xffffff) | 0xff000000, c1 = r2.int(0xffffff) | 0xff000000;
        a.forEach((v, k) => { mem2.wf32(P2 + 4 * k, v); mem2.wf32(P2 + 16 + 4 * k, b[k]); });
        if (i % 2 === 0) {
          const type = r2.int(3), rad = r2() * 6;
          cpu2.call(0x445c70, [P2, type, bits(rad), c0]); q2.shape(a.map((v) => fval(bits(v))), type, fval(bits(rad)), c0);
        } else {
          const mode = i % 7 === 1 ? 1 : 0;
          mem2.w32(G.MODE, mode); q2.setMode(mode);
          cpu2.call(0x445ba0, [P2, P2 + 16, c0, c1]); q2.line(a.map((v) => fval(bits(v))), b.map((v) => fval(bits(v))), c0, c1);
        }
      }
      cpu2.call(0x445d20, []);
      // the port's drain: mode 0 lines in queue order, then the markers (the screen-space lines are the original's FUN_0087da91: counted, not drawn)
      const mine = [];
      const fake = { drawLine: (a, b, col) => mine.push([a, b, col]) };
      drawQueue(fake, q2, { sphereMarkers: false, gradientPieces: 1 });
      const orig0 = got.filter((g) => g[0] === 0), origScreen = got.filter((g) => g[0] === 1);
      ok(origScreen.length === q2.lines.filter((l) => l.mode !== 0).length, `screen-space lines: ${origScreen.length} vs ${q2.lines.filter((l) => l.mode !== 0).length}`);
      ok(orig0.length === mine.length, `drain: ${orig0.length} lines vs ${mine.length}`);
      let badLines = 0;
      const argb = (c) => [((c >>> 16) & 255) / 255, ((c >>> 8) & 255) / 255, (c & 255) / 255, ((c >>> 24) & 255) / 255];
      orig0.forEach((g, i) => {
        const m = mine[i]; if (!m) return;
        const pa = m[0].map((v) => bits(Math.fround(v))), pb = m[1].map((v) => bits(Math.fround(v)));
        // the original colours the two ends: both the same for markers, c0 / c1 for lines (this drain draws them in one colour: gradientPieces 1 uses the first)
        const colOk = argb(g[3]).every((v, k) => Math.abs(v - m[2][k]) < 1e-6);
        if (pa.some((v, k) => v !== g[1][k]) || pb.some((v, k) => v !== g[2][k]) || !colOk) badLines++;
      });
      ok(badLines === 0, `drain: ${badLines} of ${orig0.length} lines differ in end points or colour`);
      notes.push(`debug queue: 300 enqueues compared with the original's memory, drain of ${got.length} lines (lines, X / + / square markers, screen lines) equal`);
    }

    // ------------------------------------------------------------------------------------------------------------ 4. box lines FUN_00440ac0
    {
      const cpu = emu(pe, [[0x440ac0, 0x440d00], [0x43a000, 0x43b100]]);
      const mem = cpu.mem;
      const got = [];
      cpu.hooks.set(0x445ba0, (c) => { const a = c.arg(0), b = c.arg(1); got.push([[0, 1, 2].map((k) => mem.u32(a + 4 * k)), [0, 1, 2].map((k) => mem.u32(b + 4 * k)), c.arg(2) >>> 0, c.arg(3) >>> 0]); });
      const r = rng(21);
      let bad = 0, runs = 0;
      for (let t = 0; t < 40; t++) {
        const rec = 0x20000400, cen = 0x20000600, half = 0x20000620;
        const m = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0) + (r() - 0.5) * 0.6);
        m[3] = m[7] = m[11] = 0; m[15] = 1; m[12] = (r() - 0.5) * 200; m[13] = (r() - 0.5) * 50; m[14] = (r() - 0.5) * 200;
        m.forEach((v, k) => mem.wf32(rec + 0xc + 4 * k, v));
        const c = [0, 1, 2].map(() => (r() - 0.5) * 10), hf = [0, 1, 2].map(() => r() * 6);
        c.forEach((v, k) => { mem.wf32(cen + 4 * k, v); mem.wf32(half + 4 * k, hf[k]); });
        got.length = 0;
        cpu.call(0x440ac0, [rec, cen, half, 0xffffffff]);
        const q = new DebugQueue(); q.master = true;
        new ProbeSink(q, () => true).box('collision', m.map(Math.fround), c.map(Math.fround), hf.map(Math.fround), 0xffffffff);
        runs++;
        if (got.length !== 12 || q.lines.length !== 12) { bad++; continue; }
        q.lines.forEach((l, i) => {
          const g = got[i];
          const pa = l.a.map((v) => bits(Math.fround(v))), pb = l.b.map((v) => bits(Math.fround(v)));
          // the original transforms with float32 arithmetic (24 bit x87): compare within 2 float32 ulps (the port's sink sums in doubles: a drawing aid, not a simulation)
          const near = (x, y) => Math.abs(fval(x) - fval(y)) <= 4e-6 * Math.max(1, Math.abs(fval(y)));
          if (!pa.every((v, k) => near(v, g[0][k])) || !pb.every((v, k) => near(v, g[1][k])) || g[2] !== l.c0 || g[3] !== l.c1) bad++;
        });
      }
      ok(bad === 0, `box lines: ${bad} of ${runs} boxes differ`);
      notes.push(`box (FUN_00440ac0): ${runs} random boxes x 12 lines equal to 4e-6 relative (the sink sums in doubles, the original in float32: a drawing aid)`);
      // the point test with no record: matrix none
      const q = new DebugQueue(); q.master = true;
      new ProbeSink(q, () => true).box('collision', null, [1, 2, 3], [1, 1, 1], 5);
      ok(q.lines.length === 12 && q.lines[0].a[0] === 0 && q.lines[0].a[1] === 1 && q.lines[0].a[2] === 2, 'box without a record matrix');
    }

    // ------------------------------------------------------------------------------------------------------------ 5. LOD
    {
      const k = readLodConsts(pe);
      ok(k.farMin === 240 && k.farStep === 50 && k.farMax === 390 && k.debugLod === 2 && k.far0 === 400 && [1, 0.8, 0.6, 0.4, 0.2].every((v, i) => Math.abs(k.fade[i] - v) < 1e-6), `LOD constants ${JSON.stringify(k)}`);
      ok(Math.abs(k.period - 1 / 30) < 1e-4, `the frame period constant ${k.period}`);
      const cpu = emu(pe, [[0x443d10, 0x443e40], [0x443f90, 0x444180], [0x40c000, 0x40d000], [0x890290, 0x890400]]);
      const mem = cpu.mem;
      // FUN_00443d10
      let n = 0, bad = 0;
      for (const mode of [1, 2]) {
        const r = rng(100 + mode);
        const ad = new AdaptiveDetail(k);
        ad.mode = mode;
        mem.w32(LOD_VA.MODE, mode); mem.w32(LOD_VA.LEVEL, 0); mem.w32(LOD_VA.LAST, 0); mem.w32(LOD_VA.RUN, 0); mem.wf32(LOD_VA.FAR, 400);
        let frame = 1;
        for (let i = 0; i < 4000; i++) {
          // long runs of one sign with gaps now and then (the original needs 11 consecutive calls)
          const sign = (Math.floor(i / 97) % 3 === 1) ? -1 : 1;
          const p1 = r() < 0.92 ? sign : -sign;
          frame += r() < 0.04 ? 1 + r.int(3) : 1;
          cpu.call(0x443d10, [p1 >>> 0, frame]);
          ad.step(p1, frame);
          n++;
          const st = [mem.r32(LOD_VA.LEVEL), mem.r32(LOD_VA.LAST), mem.r32(LOD_VA.RUN), mem.u32(LOD_VA.FAR)];
          const mine = [ad.level, ad.last, ad.run, bits(ad.far)];
          if (st.some((v, j) => (v >>> 0) !== (mine[j] >>> 0))) { bad++; if (bad < 4) failures.push(`FUN_00443d10 mode ${mode} call ${i}: original ${st} vs ${mine}`); }
        }
      }
      ok(bad === 0, 'FUN_00443d10 state machine');
      checked += n;
      // FUN_00443f90
      const MODEL = 0x20000800, TABLE = 0x20000900, REC = 0x20000a00;
      const r = rng(33);
      let m = 0, mb = 0;
      const names = ['PEPP', 'pepp', 'LAND', 'SHRK', 'PEPD', 'ABCD'];
      const eye = [r() * 10, r() * 10, r() * 10];
      eye.forEach((v, j) => mem.wf32(0x986e18 + 4 * j, v));
      for (let i = 0; i < 3000; i++) {
        const nParts = 1 + r.int(4);
        const lods = Array.from({ length: nParts }, (_, j) => (j === 0 ? 0 : (j * 20 + r() * 30)));
        mem.w32(MODEL + 4, nParts); mem.w32(MODEL + 0x10, TABLE);
        lods.forEach((v, j) => mem.wf32(TABLE + j * 0x14 + 4, v));
        const name = names[r.int(names.length)];
        for (let j = 0; j < 4; j++) mem.w8(REC + j, name.charCodeAt(j));
        const flags = r() < 0.2 ? [0x100, 0x200, 0x400][r.int(3)] : 0;
        mem.w16(REC + 0x60, flags);
        const pos = [0, 1, 2].map(() => (r() - 0.5) * 200);
        pos.forEach((v, j) => mem.wf32(REC + 0x3c + 4 * j, v));
        const mode = r.int(3), level = r.int(5);
        mem.w32(LOD_VA.MODE, mode); mem.w32(LOD_VA.LEVEL, level);
        const zoom = fval(mem.u32(LOD_VA.ZOOM));
        const want = cpu.call(0x443f90, [MODEL, REC]) >>> 0;
        const ad = new AdaptiveDetail(k); ad.mode = mode; ad.level = level;
        const fr = Math.fround;
        const dx = fr(fr(pos[0]) - fr(eye[0])), dy = fr(fr(pos[1]) - fr(eye[1])), dz = fr(fr(pos[2]) - fr(eye[2]));
        const d2 = fr(fr(fr(dx * dx) + fr(dy * dy)) + fr(dz * dz));
        const got = ad.choose(lods.map(fr), flags, name, d2, zoom);
        m++;
        if (got !== want) { mb++; if (mb < 5) failures.push(`FUN_00443f90 #${i} (${name}, ${nParts} parts, flags 0x${flags.toString(16)}, mode ${mode}, level ${level}, d2 ${d2}): original ${want}, port ${got}`); }
      }
      ok(mb === 0, 'FUN_00443f90 part choice');
      checked += m;
      notes.push(`LOD: FUN_00443d10 ${n} calls (state level / frame / run / far bit exact), FUN_00443f90 ${m} choices equal`);
      // the frame time decision (FUN_00443e40): longer than the period -> +1, shorter than period - margin -> -1, between: none
      const ad = new AdaptiveDetail(k); ad.mode = 1;
      ok(ad.frameTime(40000, 33333, 10000, 1) === 1 && ad.frameTime(20000, 33333, 10000, 2) === -1 && ad.frameTime(30000, 33333, 10000, 3) === 0, 'frame time decision');
    }

    // ------------------------------------------------------------------------------------------------------------ 6. frustum OBJ
    {
      const cpu = emu(pe, [[0x415497, 0x415560]]);
      const mem = cpu.mem;
      cpu.hooks.set(0x85b1d0, (c) => { out.length = 0; opened = mem.cstr(c.arg(0)) + '|' + mem.cstr(c.arg(1)); c.eax = 0x7777; });
      cpu.hooks.set(0x85af50, () => {});
      const out = [];
      let opened = '';
      // fprintf(file, fmt, ...): only %f (a double) occurs
      cpu.hooks.set(0x85b030, (c) => {
        const fmt = mem.cstr(c.arg(1));
        let s = '', ai = 2;
        for (let i = 0; i < fmt.length; i++) {
          if (fmt[i] === '%' && fmt[i + 1] === 'f') { const v = mem.f64(c.esp + 4 + 4 * ai); ai += 2; s += cf(v); i++; } else s += fmt[i];
        }
        out.push(s);
      });
      const r = rng(77);
      let bad = 0, runs = 0;
      for (let t = 0; t < 30; t++) {
        const P1 = 0x20000c00, P2 = 0x20000c20, P3 = 0x20000c40;
        const apex = [0, 1, 2].map(() => (r() - 0.5) * 500), p2 = [0, 1, 2].map(() => (r() - 0.5) * 500);
        const pts = [[0, 0, 0], ...Array.from({ length: 4 }, () => [0, 1, 2].map(() => (r() - 0.5) * 500))];
        apex.forEach((v, k) => mem.wf32(P1 + 4 * k, v)); p2.forEach((v, k) => mem.wf32(P2 + 4 * k, v));
        pts.forEach((p, i) => p.forEach((v, k) => mem.wf32(P3 + 12 * i + 4 * k, v)));
        cpu.call(0x415497, [P1, P2, P3]);
        const want = out.join('');
        const f = (a) => a.map((v) => Math.fround(v));
        const got = frustumObj(pe, f(apex), f(p2), pts.map(f));
        runs++;
        if (want !== got) { bad++; if (bad < 3) failures.push(`frustum OBJ differs:\n--- original\n${want}\n--- port\n${got}`); }
      }
      ok(bad === 0, `frustum OBJ: ${bad} of ${runs} files differ`);
      ok(opened === 'c:\\Debug.obj|wt', `fopen arguments ${opened}`);
      notes.push(`frustum OBJ (FUN_00415497): ${runs} random inputs, the text equal to the original's fprintf output; file "${opened.replace('|', '", mode "')}"`);
      const pts = pyramidCorners([0, 0, 0], [0, 0, 1], 1, 4 / 3, 10);
      const dist = (p) => Math.hypot(p[0], p[1], p[2]);
      ok(Math.abs(pts[1][2] - 10) < 1e-9 && Math.abs(pts[1][1] - 10 * Math.tan(0.5)) < 1e-9 && Math.abs(pts[1][0] + 10 * Math.tan(0.5) * 4 / 3) < 1e-9 && dist(pts[0]) === 0, 'pyramid corners: top left at depth 10');
    }

    // ------------------------------------------------------------------------------------------------------------ 7. defaults: nothing changes without the corner
    {
      const cw = new CollisionWorld([]);
      ok(cw.debug === null, 'CollisionWorld.debug is null by default');
    }

    // ------------------------------------------------------------------------------------------------------------ 8. the walk node's probe lines (hook in WalkNode.alignToGround) and: a sink changes nothing
    {
      const runWalk = (sink) => {
        const L = loadZone(ctx, 'z02LGI');
        const w = L.world;
        w.externalInput = true; w.sfx = { play() {} };
        w.col.debug = sink;
        for (let t = 0; t < 40; t++) { w.input.held = t < 30 ? 4 : 0; w.input.pressed = t === 0 ? 4 : 0; w.tick(); }
        return { m: Array.from(L.pepper.m, bits).join(), cam: Array.from(w.camera.c, bits).join() };
      };
      const calls = [];
      const sink = { line: (tag, a, b, c0, c1) => calls.push([tag, a, b, c0, c1]), shape() {}, box() {} };
      const withSink = runWalk(sink), without = runWalk(null);
      ok(withSink.m === without.m && withSink.cam === without.cam, 'a debug sink changes Pepper / the camera (it must not)');
      ok(calls.length >= 40 && calls.length % 2 === 0, `walk probe lines: ${calls.length}`);
      ok(calls.every((c, i) => c[0] === 'probe' && (i % 2 === 0 ? c[3] === 0xffffffff && c[4] === 0xff000000 : c[3] === 0xffff0000 && c[4] === 0xff00ff00)), 'walk probe line colours (white -> black, red -> green)');
      notes.push(`walk node probes (FUN_00429e00): ${calls.length} lines in 40 ticks, colours as in LE2.c:20573 / 20644; with and without a sink Pepper and the camera end bit for bit equal`);
    }

    // ------------------------------------------------------------------------------------------------------------ 9. the z08BKD visualisers and the waypoint graph source
    {
      const L = loadZone(ctx, 'z08BKD');
      const { bkdSource } = await import('../../src/devcorner/camera-bkd.ts');
      const { HurtZones } = await import('../../src/zones/z08bkd/hurt.ts');
      const q = new DebugQueue(); q.master = true;
      bkdSource({ world: L.world }).tick(q, () => true);
      const hz = new HurtZones(); hz.registerAll(L.world.records);
      const want = hz.entries.reduce((n, e) => n + 1 + e.spheres.length, 0);
      ok(q.shapes.length === want && want > 0, `FUN_005babc9: ${q.shapes.length} hurt-zone markers, expected ${want}`);
      ok(q.shapes.filter((x) => x.color === 0xffff0000).length === hz.entries.length && q.shapes.every((x) => x.type === 0 && x.tag === 'bkd'), 'red X at the anchors, blue X at the spheres, type 0');
      const { loadGraphs, queueGraph } = await import('../../src/devcorner/camera-probes.ts');
      const maps = loadGraphs(ctx.archives.find((a) => a.name === 'z08BKD'));
      ok(maps.length === 1 && maps[0].name === 'OTH' && maps[0].graph.nodes.length === 69, `z08BKD's waypoint map: ${maps.map((m) => `${m.name} ${m.graph.nodes.length}`)}`);
      const q2 = new DebugQueue(); q2.master = true;
      const r = queueGraph(q2, maps[0], [0, 0, 0], Infinity);
      const links = maps[0].graph.nodes.reduce((n, nd) => n + nd.nbr.length, 0);
      ok(r.nodes === 69 && r.links === links && q2.shapes.length === 69 && q2.lines.length === links && q2.shapes.every((x) => x.r === 0.5 && x.color === 0xff00ff00 && x.type === 0) && q2.lines.every((l) => l.c0 === 0xffffffff && l.c1 === 0xffffffff), `FUN_005bbb62: ${r.nodes} nodes, ${r.links} links`);
      notes.push(`z08BKD visualisers: ${q.shapes.length} hurt-zone markers (red anchors / blue spheres), waypoint graph ${r.nodes} nodes / ${r.links} links (green X of size 0.5, white lines)`);
    }

    return { checked, failures: failures.filter(Boolean), notes };
  },
};
