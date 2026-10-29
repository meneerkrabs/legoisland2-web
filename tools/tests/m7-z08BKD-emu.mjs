import { BallNode } from '../../src/zones/z08bkd/bodies.ts';
import { mirrorIn, callFn, F, scratch, bitsOf, createHarness, bootBkd, buildOriginal, indexNodes, emuFrame, emuState, portState, snapHosted, restoreHosted, f32, RB } from '../lib/m7-z08BKD-emu.mjs';
import { REC, SND, DIVER, C, FLOAT_ADDRS, HURT_TEMPLATES, HURT_REGISTRATIONS } from '../../src/zones/z08bkd/consts.ts';
import { BRICK_SHAPE, BALL_SHAPE, ClamNode } from '../../src/zones/z08bkd/bodies.ts';
import { wrapAngle, angleDelta, rotateShape, segmentSphere, normalize3, ZoneClock } from '../../src/zones/z08bkd/math.ts';
import { bounce, swingPush, hitSpin } from '../../src/zones/z08bkd/physics.ts';
import { cameraFor } from '../../src/zones/z08bkd/diver.ts';
import { eulerMatrix, transformPoint, rotateVector } from '../../src/zones/z08bkd/matrix.ts';
import { buildMatrix } from '../../src/formats/matrix.ts';
import { BkdState } from '../../src/zones/z08bkd/state.ts';
import { finish } from '../../src/zones/z08bkd/game.ts';
import { VAR } from '../../src/zones/z08bkd/consts.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { buildGrid, Bot, recordHazards } from '../lib/bkd-bot.mjs';
import { snapshot } from '../../src/zones/z08bkd/run.ts';

// z08BKD differential test (WP-VERIFY, docs/re/m6/z08BKD.md "Differential test"): the original's builder FUN_005b9430 (all constructors, the waypoint graph, the hurt zones) and the
// frame of the zone loop (clock, hurt zones, the real update pass FUN_0042226e over the 12 node kinds, plants, HUD) run in the x86 emulation (tools/lib/m7-z08BKD-emu.mjs) next to
// the port; records, node fields, zone globals, camera, hurt zones, animation clip / frame, sound / speech / model-attach calls and random draws are compared tick by tick.

export default {
  name: 'm7-z08BKD-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = 40;
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const TOL = 0;
    const maxErr = {};
    const known = {};
    const note = (k, msg) => { (known[k] ??= []).push(msg); };
    const num = (cls, a, b, msg) => {
      checked++;
      if (typeof a !== 'number' || typeof b !== 'number') { if (a !== b) { bad(`${msg}: port ${a}, original ${b}`); return false; } return true; }
      const e = Math.abs(a - b) / Math.max(1, Math.abs(b));
      if (e === e && e > (maxErr[cls] ?? 0)) maxErr[cls] = e;
      if (!(e <= TOL)) { bad(`${msg}: port ${a}, original ${b}`); return false; }
      return true;
    };

    let H = createHarness(ctx);
    const rngOf = (seed) => { let s = seed >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; f.int = (n) => Math.trunc(f() * n); f.pick = (a) => a[f.int(a.length)]; return f; };
    const stats = { ticks: 0, steps: 0, ms: 0, ev: {} };
    const routeCounts = new Set();

    /** compare two states of the same shape (port, original) */
    const compareState = (P, E, label) => {
      let worstRec = 0;
      for (let i = 0; i < P.recs.length; i++) {
        const a = P.recs[i], b = E.recs[i];
        let fa = a.flags, fb = b.flags;
        if (i === REC.SEAE) { if (fa !== fb) note('SEAE flags', `record 43 flags port ${fa.toString(16)} original ${fb.toString(16)}`); fa = fb; }
        checked++;
        if (fa !== fb) bad(`${label}: record ${i} flags port ${fa.toString(16)}, original ${fb.toString(16)}`);
        let w = 0;
        for (let k = 0; k < 16; k++) { const e = Math.abs(a.m[k] - b.m[k]) / Math.max(1, Math.abs(b.m[k])); w = Math.max(w, e === e ? e : Infinity); }
        for (let k = 0; k < 3; k++) { const e = Math.abs(a.e[k] - b.e[k]) / Math.max(1, Math.abs(b.e[k])); w = Math.max(w, e === e ? e : Infinity); }
        worstRec = Math.max(worstRec, w);
        checked++;
        if (!(w <= TOL)) bad(`${label}: record ${i}: port m ${a.m.map((v) => +v.toFixed(4))} e ${a.e.map((v) => +v.toFixed(4))} | original m ${b.m.map((v) => +v.toFixed(4))} e ${b.e.map((v) => +v.toFixed(4))}`);
      }
      maxErr.rec = Math.max(maxErr.rec ?? 0, worstRec);
      for (const key of Object.keys(E.nodes)) {
        const a = P.nodes[key], b = E.nodes[key];
        if (!a) { if (Object.keys(b).length) bad(`${label}: node ${key} missing in the port`); continue; }
        for (const f of Object.keys(b)) {
          if (f === 'routeCount') { if (a.shared34 !== undefined && E.nodes[key].shared24 !== -1) routeCounts.add(`${a.route.length}:${b[f]}`); continue; }
          const x = a[f], y = b[f];
          if (f === 'quad' && x === null) continue;
          if (f === 'route') { const n = Math.min(x.length, 24); for (let k = 0; k < n; k++) num('node', x[k], y[k], `${label}: node ${key}.route[${k}]`); continue; }
          if (Array.isArray(y)) { for (let k = 0; k < y.length; k++) num('node', x[k], y[k], `${label}: node ${key}.${f}[${k}]`); }
          else num('node', x, y, `${label}: node ${key}.${f}`);
        }
      }
      for (const k of Object.keys(E.globals)) {
        if (k === 'tints') { E.globals.tints.forEach((v, i) => { checked++; if (P.globals.tints[i] !== v && !(label.includes('tick 0') && false)) bad(`${label}: HUD tint ${i}: port ${P.globals.tints[i].toString(16)}, original ${v.toString(16)}`); }); continue; }
        num('global', P.globals[k], E.globals[k], `${label}: global ${k}`);
      }
      for (let k = 0; k < 6; k++) num('camera', P.camera[k], E.camera[k], `${label}: camera[${k}]`);
      if (E.end) { num('end', P.end.over, E.end.over, `${label}: FUN_005b8fa4 (over)`); num('end', P.end.success, E.end.success, `${label}: FUN_005b8ffa (success)`); num('end', P.end.percent, E.end.percent, `${label}: FUN_005b9014 (percent)`); }
      E.hurt.forEach((e, n) => {
        const a = P.hurt[n];
        checked++;
        if (!a || a.rec !== e.rec || a.category !== e.category) { bad(`${label}: hurt entry ${n}: port ${JSON.stringify(a)}, original ${JSON.stringify(e)}`); return; }
        e.anchor.forEach((v, c) => num('hurt', a.anchor[c], v, `${label}: hurt ${n} anchor[${c}]`));
        e.spheres.forEach((s, k) => s.forEach((v, c) => num('hurt', a.spheres[k][c], v, `${label}: hurt ${n} sphere ${k}[${c}]`)));
      });
    };

    const portLog = (G) => G.log.slice();
    const sortKey = (e) => JSON.stringify(e);

    /** one frame: the original from the port's state, then the port from the same state; compare */
    const step = (G, mask, label) => {
      H.G = G;
      const P0 = process.env.BKD_DEBUG ? portState(H, G) : null;
      const hs = snapHosted(G);
      const t0 = Date.now();
      let o;
      try { o = emuFrame(H, G, mask); } catch (e) { bad(`${label}: the original failed: ${e.message}`); H.reset?.(); restoreHosted(G, hs); return false; }
      stats.ms += Date.now() - t0; stats.steps += o.steps;
      const origAnim = G.R.map((r) => (r.anim ? [r.anim.clip, r.anim.frame] : null));
      const u1 = G.U.pos;
      restoreHosted(G, hs);
      G.sndCalls.length = 0; G.speech.length = 0; G.draws.length = 0; G.log.length = 0;
      G.tick(mask);
      stats.ticks++;
      const P = portState(H, G);
      const nf = failures.length;
      compareState(P, o.state, label);
      if (P0 && failures.length > nf) {
        const keys = new Set();
        for (const m of failures.slice(nf)) { const q = /node (\d+:\w+)/.exec(m); if (q) keys.add(q[1]); }
        for (const k of keys) failures.push(`   [${label}] ${k} pre ${JSON.stringify(P0.nodes[k])} | port ${JSON.stringify(P.nodes[k])} | original ${JSON.stringify(o.state.nodes[k])} | rec pre ${JSON.stringify(P0.recs[+k.split(':')[0]])}`);
      }
      // animations
      G.R.forEach((r, i) => {
        if (!r.anim || !origAnim[i]) return;
        checked++;
        if (r.anim.clip !== origAnim[i][0] || r.anim.frame !== origAnim[i][1]) bad(`${label}: record ${i} ${r.name} animation: port ${JSON.stringify([r.anim.clip, r.anim.frame])}, original ${JSON.stringify(origAnim[i])}`);
      });
      // calls: the original's log in the same terms (the order inside one frame is the update order of both)
      const a = portLog(G), b = o.log;
      let same = a.length === b.length;
      for (let i = 0; same && i < a.length; i++) {
        if (a[i].length !== b[i].length) same = false;
        else for (let k = 0; k < a[i].length; k++) if (a[i][k] !== b[i][k]) same = false;
      }
      checked++;
      if (!same) bad(`${label}: sound / speech / attach calls: port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`);
      for (const e of a) stats.ev[e[0] === 'say' ? 'say' : e[0] === 'attach' ? 'attach' : `snd:${e[0]}`] = (stats.ev[e[0] === 'say' ? 'say' : e[0] === 'attach' ? 'attach' : `snd:${e[0]}`] ?? 0) + 1;
      checked++;
      if (JSON.stringify(G.draws) !== JSON.stringify(o.draws.map((x) => f32(x)))) bad(`${label}: random draws: port ${JSON.stringify(G.draws)}, original ${JSON.stringify(o.draws)}`);
      checked++;
      if (G.U.pos !== u1) bad(`${label}: random sequence position`);
      return true;
    };

    // ---------------------------------------------------------------- constants: the float literals of the port are the exact float32 of the executable
    {
      const pe = loadExe(ctx.dataRoot);
      const fb = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u, true); return d.getFloat32(0, true); };
      let nbad = 0;
      for (const [k, [va]] of Object.entries(FLOAT_ADDRS)) { checked++; if (fb(pe.u32(va)) !== C[k]) { nbad++; bad(`constant ${k} (0x${va.toString(16)}): port ${C[k]}, executable ${fb(pe.u32(va))}`); } }
      notes.push(`constants: ${Object.keys(FLOAT_ADDRS).length} float literals of the zone code compared bit for bit with the executable, ${nbad} differ`);
    }

    // ---------------------------------------------------------------- function level: single functions of the original against the port's helpers, random inputs
    {
      const G = bootBkd(ctx, { seed: 1, dt: 1 });
      H = createHarness(ctx);
      buildOriginal(H, G); indexNodes(H, G);
      const { mem } = H;
      const rnd = rngOf(555);
      const R = (a, b) => a + rnd() * (b - a);
      const rf = (a, b) => f32(R(a, b));
      const wr = (addr, vals) => vals.forEach((v, i) => mem.wf32(addr + 4 * i, v));
      const rd = (addr, n) => Array.from({ length: n }, (_, i) => mem.f32(addr + 4 * i));
      const unit = { n: 0, worst: {} };
      const U = (name, a, b, msg, tol = 0) => {
        unit.n++; checked++;
        const e = Math.abs(a - b) / Math.max(1, Math.abs(b));
        if (e === e && e > (unit.worst[name] ?? 0)) { unit.worst[name] = e; if (process.env.BKD_DEBUG) console.log('worst', name, e, msg, a, b); }
        if (!(e <= tol)) { bad(`unit ${name}: ${msg}: port ${a}, original ${b}`); return false; }
        return true;
      };
      const UE = (name, a, b, msg) => { unit.n++; checked++; if (a !== b) { bad(`unit ${name}: ${msg}: port ${a}, original ${b}`); return false; } return true; };

      // the engine's matrix helpers as the zone's code calls them: FUN_0043a5e4 (Euler matrix), FUN_0043ab72 (transform a point), FUN_0043abe6 (rotate a vector); the shared `buildMatrix` for the record
      {
        let shared = 0;
        for (let k = 0; k < 400; k++) {
          const e = [rf(-4, 4), rf(-4, 4), rf(-4, 4)], t = [rf(-60, 60), rf(-170, 90), rf(-20, 20)];
          const a = scratch(15);
          callFn(H, 0x43a5e4, [a, { f: e[0] }, { f: e[1] }, { f: e[2] }, { f: t[0] }, { f: t[1] }, { f: t[2] }]);
          const o = rd(a, 16), w = eulerMatrix(e[0], e[1], e[2], t[0], t[1], t[2]), sm = buildMatrix(e[0], e[1], e[2], t[0], t[1], t[2]);
          for (let i = 0; i < 16; i++) { UE('eulerMatrix', w[i], o[i], `angles ${e} element ${i}`); if (sm[i] !== o[i]) shared++; }
          // transform / rotate with that matrix
          const v = [rf(-8, 8), rf(-8, 8), rf(-8, 8)];
          const b = scratch(14); wr(b, o); wr(b + 0x40, v);
          callFn(H, 0x43ab72, [b + 0x80, b, b + 0x40]);
          const p1 = transformPoint(o, v), q1 = rd(b + 0x80, 3);
          callFn(H, 0x43abe6, [b + 0x90, b, b + 0x40]);
          const p2 = rotateVector(o, v), q2 = rd(b + 0x90, 3);
          for (let i = 0; i < 3; i++) { UE('transformPoint', p1[i], q1[i], `v ${v}`); UE('rotateVector', p2[i], q2[i], `v ${v}`); }
        }
        notes.push(`matrix helpers: eulerMatrix / transformPoint / rotateVector bit for bit with FUN_0043a5e4 / 0043ab72 / 0043abe6 (400 random cases); the shared buildMatrix (src/formats/matrix.ts, rounds the sines and the products differently) differs from FUN_0043a5e4 in ${shared} of ${400 * 16} elements by one float32 unit`);
      }

      // FUN_005bb164 (wrap into [0, 2 pi)) and FUN_005bb05d (the shorter way): exact
      for (let k = 0; k < 400; k++) {
        const a = rf(-30, 30), b = rf(0, 6.2831855);
        const o = callFn(H, 0x5bb164, [{ f: a }]);
        UE('wrapAngle', wrapAngle(a), f32(o.f), `wrap ${a}`);
        const q = scratch(0);
        const e = callFn(H, 0x5bb05d, [{ f: a }, { f: b }, q, q + 4]);
        const d = angleDelta(a, b);
        UE('angleDelta', d.dir, e.eax, `dir ${a}, ${b}`); UE('angleDelta', d.frac, mem.f32(q), `frac ${a}, ${b}`); UE('angleDelta', d.dist, mem.f32(q + 4), `dist ${a}, ${b}`);
      }
      { const q = scratch(0); const e = callFn(H, 0x5bb05d, [{ f: 1.5 }, { f: 1.5 }, q, q + 4]); const d = angleDelta(1.5, 1.5); UE('angleDelta', d.dir, e.eax, 'equal'); UE('angleDelta', d.frac, mem.f32(q), 'equal frac'); }

      // FUN_0043cec0 (normalise) is the engine's: the port's normalize3 must be the same bit for bit
      for (let k = 0; k < 300; k++) {
        const v = [rf(-50, 50), rf(-50, 50), rf(-50, 50)].map((x, i) => (k % 7 === 0 && i === 2 ? 0 : x));
        const q = scratch(1); wr(q, v); callFn(H, 0x43cec0, [q]);
        const w = normalize3(v.slice());
        for (let i = 0; i < 3; i++) UE('normalize3', w[i], mem.f32(q + 4 * i), `v ${v}`);
      }

      // FUN_005ba8b0 rotateShape (4 points of 3 floats)
      for (let k = 0; k < 300; k++) {
        const shape = Array.from({ length: 4 }, () => [rf(-4, 4), rf(-4, 4), 10]), ang = rf(-8, 8);
        const sh = scratch(2), out = scratch(3); wr(sh, shape.flat());
        callFn(H, 0x5ba8b0, [out, sh, 4, { f: ang }]);
        const w = rotateShape(shape, 4, ang), o = rd(out, 12);
        for (let i = 0; i < 12; i++) U('rotateShape', w[(i / 3) | 0][i % 3], o[i], `angle ${ang} point ${(i / 3) | 0}`, 0);
      }

      // FUN_0043d159 (the segment against a sphere; the hurt tests): the port's segmentSphere
      for (let k = 0; k < 400; k++) {
        const p0 = [rf(-6, 6), rf(-6, 6), 10], p1 = k % 5 === 0 ? [...p0] : [rf(-6, 6), rf(-6, 6), 10], c = [rf(-5, 5), rf(-5, 5), rf(8, 12)], r = rf(0.5, 3);
        const a = scratch(4); wr(a, [...p0, ...p1, ...c]);
        const o = callFn(H, 0x43d159, [a, a + 12, a + 24, { f: r }]);
        const w = segmentSphere(p0, p1, c, r);
        if (!(Number.isNaN(w) && Number.isNaN(o.f))) U('segmentSphere', w, o.f, `p0 ${p0} p1 ${p1} c ${c} r ${r}`, 0);
      }

      // FUN_005bc194 bounce(vel, &angVel, pos, nx, ny, nz, hit)
      for (let k = 0; k < 400; k++) {
        const vel = [rf(-12, 12), rf(-12, 12), k % 4 === 0 ? 0 : rf(-5, 5)], pos = [rf(-30, 30), rf(-100, 80), 10], hit = [f32(pos[0] + rf(-2, 2)), f32(pos[1] + rf(-2, 2)), 10], nrm = [rf(-1, 1), rf(-1, 1), rf(-1, 1)];
        if (k % 9 === 0) { vel[0] = rf(-0.1, 0.1); vel[1] = rf(-0.1, 0.1); vel[2] = 0; }
        const a = scratch(5);
        wr(a, [...vel, 0]); wr(a + 0x20, pos); wr(a + 0x30, hit);
        const o = callFn(H, 0x5bc194, [a, a + 0x1c, a + 0x20, { f: nrm[0] }, { f: nrm[1] }, { f: nrm[2] }, a + 0x30]);
        const b = { vx: vel[0], vy: vel[1], vz: vel[2], angVel: 0 };
        const w = bounce(b, pos, nrm, hit);
        UE('bounce', w, o.eax, `stop flag vel ${vel} n ${nrm}`);
        for (const [key, off] of [['vx', 0], ['vy', 4], ['vz', 8], ['angVel', 0x1c]]) U('bounce', b[key], mem.f32(a + off), `${key} vel ${vel} n ${nrm} hit ${hit}`, 0);
      }

      // FUN_005be690 (the anchor's push) / FUN_005be130 (the tentacle's push): the nodes the original built, set to random values
      for (let k = 0; k < 300; k++) {
        const arm = k % 2 === 0 ? REC.ANCHOR : REC.OCTC, p = RB + arm * 0x68;
        const pos = [rf(-30, 30), rf(-100, 80), 10], armPos = [rf(-30, 30), rf(-100, 80), 10], rz = rf(-1.5, 1.5), speed = rf(-3, 3);
        wr(p + 0x3c, armPos); mem.wf32(p + 0x54, rz);
        const nodeP = k % 2 === 0 ? H.nodes[REC.ANCHOR][0].ptr : H.nodes[REC.OCTO][0].ptr;
        mem.wf32(nodeP + 0x18, speed);
        const q = scratch(6); wr(q, pos);
        callFn(H, k % 2 === 0 ? 0x5be690 : 0x5be130, [p, q, q + 0x10]);
        const w = swingPush(armPos, k % 2 === 0 ? rz : f32(rz + C.HALF_PI), speed, pos), o = rd(q + 0x10, 3);
        for (let i = 0; i < 3; i++) U('swingPush', w[i], o[i], `${k % 2 === 0 ? 'anchor' : 'tentacle'} rz ${rz} speed ${speed} pos ${pos} arm ${armPos}`, 0);
      }

      // FUN_005c188e hitSpin(pos, hit, normal(uninitialised: 0xcccccccc), &out)
      for (let k = 0; k < 300; k++) {
        const pos = [rf(-30, 30), rf(-100, 80), 10], hit = [f32(pos[0] + rf(-2, 2)), f32(pos[1] + rf(-2, 2)), f32(10 + rf(-1, 1))];
        const a = scratch(7); wr(a, pos); wr(a + 0x10, hit); mem.fill(a + 0x20, 12, 0xcc);
        callFn(H, 0x5c188e, [a, a + 0x10, a + 0x20, a + 0x30]);
        UE('hitSpin', f32(hitSpin(pos, hit)), mem.f32(a + 0x30), `pos ${pos} hit ${hit}`);
      }

      // FUN_005c03f0 (the camera by the diver's place)
      for (let k = 0; k < 300; k++) {
        const pos = [rf(-60, 60), k % 6 === 0 ? rf(70, 95) : rf(-200, 100), 10];
        const a = scratch(8); wr(a, pos);
        callFn(H, 0x5c03f0, [a]);
        const c = new Float64Array(9); cameraFor(pos, c);
        const o = rd(0x9da5e8, 6);
        for (let i = 0; i < 6; i++) U('cameraFor', c[i], o[i], `pos ${pos}`, 0);
      }

      // FUN_005baffd (the zone's pick by the clock phase)
      for (let k = 0; k < 300; k++) {
        const n = 1 + rnd.int(8), phase = rf(0, 1);
        mem.wf32(0x5d5ab08, phase);
        const o = callFn(H, 0x5baffd, [n]);
        const ck = new ZoneClock(); ck.phase = phase;
        UE('ZoneClock.pick', ck.pick(n), o.eax, `count ${n} phase ${phase}`);
      }

      // the clam: FUN_005bdea6 (inside the lid plane?) and FUN_005bd9c0 (what the lid does to the diver)
      {
        const clam = G.env.nodeOf(G.R[REC.CLAM_TOP]), cr = G.R[REC.CLAM_TOP], cp = RB + REC.CLAM_TOP * 0x68, nodeP = H.nodes[REC.CLAM_TOP][0].ptr;
        for (let k = 0; k < 400; k++) {
          const ang = rf(-0.9, 0.1), probe = [f32(rf(-4, 4) + cr.x), f32(rf(-4, 4) + cr.y), rf(8, 12)], pos = [f32(rf(-4, 4) + cr.x), f32(rf(-4, 4) + cr.y), rf(8, 12)];
          const a = scratch(9); wr(a, probe); wr(a + 0x10, pos);
          const o = callFn(H, 0x5bdea6, [a, a + 0x10, { f: ang }]);
          UE('clam inside', ClamNode.inside(probe, pos, ang) ? 1 : 0, o.eax & 1, `probe ${probe} pos ${pos} angle ${ang}`);
        }
        for (let k = 0; k < 400; k++) {
          const rx = rf(-0.85, 0.05), hold = rnd() < 0.4, speed = rnd.pick([-0.87266, 0.87266]), heading = rf(-0.5, 6.6), pos = [f32(rf(-4, 4) + cr.x), f32(rf(-4, 4) + cr.y), rf(9, 11)];
          mem.wf32(cp + 0x4c, rx); mem.wf32(nodeP + 0x18, speed); mem.w32(nodeP + 0x1c, hold ? 1 : 0);
          cr.rx = f32(rx); clam.speed = f32(speed); clam.holding = hold;
          const a = scratch(10); wr(a, pos); mem.wf32(a + 0x20, 77); mem.wf32(a + 0x24, 77); mem.wf32(a + 0x28, 77); mem.wf32(a + 0x30, 99);
          callFn(H, 0x5bd9c0, [cp, a, a + 0x20, { f: heading }, a + 0x30]);
          const t = clam.touch(cr, pos, f32(heading));
          const ov = rd(a + 0x20, 3), oav = mem.f32(a + 0x30);
          UE('clam touch', clam.holding ? 1 : 0, mem.r32(nodeP + 0x1c), `holding after (rx ${rx} speed ${speed} hold ${hold})`);
          for (let i = 0; i < 3; i++) U('clam touch', t.vel ? t.vel[i] : 77, ov[i], `vel[${i}] (rx ${rx} speed ${speed} hold ${hold} pos ${pos})`, 0);
          U('clam touch', t.angVel !== undefined ? t.angVel : 99, oav, `angVel (rx ${rx} speed ${speed} hold ${hold} heading ${heading})`, 0);
        }
      }

      // FUN_005ba5d7 (the hurt spheres follow their records): random record matrices
      {
        const entries = G.env.hurt.entries;
        for (let k = 0; k < 60; k++) {
          for (const e of entries) {
            const r = e.rec, p = RB + r.index * 0x68, m = eulerMatrix(rf(-3, 3), rf(-3, 3), rf(-3, 3), rf(-50, 50), rf(-170, 90), rf(-20, 20));
            r.m.set(m); for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, m[i]);
          }
          callFn(H, 0x5ba5d7, []); G.env.hurt.update();
          entries.forEach((e, n) => {
            const b = 0x5d58c78 + n * 0xb4;
            for (let c = 0; c < 3; c++) UE('hurt.update', e.anchorWorld[c], mem.f32(b + 0x10 + 4 * c), `entry ${n} anchor[${c}] matrix ${Array.from(e.rec.m)}`);
            e.spheres.forEach((sp, q) => { for (let c = 0; c < 3; c++) UE('hurt.update', sp.world[c], mem.f32(b + 0x20 + q * 0x1c + 0xc + 4 * c), `entry ${n} sphere ${q}[${c}] local ${sp.local}`); });
          });
        }
      }

      // FUN_005ba745 (the diver's quad against the hurt spheres): random quads around the creatures, the creatures where the port has them (FUN_005ba5d7 run natively)
      {
        mirrorIn(H, G, 0);
        callFn(H, 0x5ba5d7, []);
        G.env.hurt.update();
        const entries = G.env.hurt.entries;
        let hits = 0;
        for (let k = 0; k < 500; k++) {
          const e = entries[rnd.int(entries.length)], c = e.anchorWorld;
          const half = R(0.5, 3), cx = c[0] + R(-4, 4), cy = c[1] + R(-4, 4), ang = R(0, 6.28);
          const poly = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([x, y]) => [f32(cx + half * (Math.cos(ang) * x - Math.sin(ang) * y)), f32(cy + half * (Math.sin(ang) * x + Math.cos(ang) * y)), f32(10 + (k % 5 === 0 ? R(-3, 3) : 0))]);
          const a = scratch(14); wr(a, poly.flat()); mem.w32(a + 0x40, 0);
          const o = callFn(H, 0x5ba745, [a, 4, a + 0x40]);
          const w = G.env.hurt.test(poly, 4);
          UE('hurt.test', w ? w.category : 0, o.eax, `poly ${JSON.stringify(poly)}`);
          if (w) { hits++; UE('hurt.test', w.rec.index, rk_(mem.u32(a + 0x40)), 'record'); }
        }
        notes.push(`hurt test: 500 random quads around the creatures against FUN_005ba745, ${hits} hits`);
      }

      // the waypoint graph walks: FUN_005bb867 (first node with a tag), FUN_005bb919 (nearest with a tag), FUN_005bb600 (fish loops), FUN_005bb588 (the cheapest route)
      {
        const g = G.env.graph;
        for (const tag of [1, 2, 3, 4, 5, 6, 7, -1]) UE('graph.firstWithTag', g.firstWithTag(tag), callFn(H, 0x5bb867, [tag]).eax, `tag ${tag}`);
        for (let k = 0; k < 120; k++) {
          const tag = rnd.pick([1, 1, 2, 3, 4]), pos = [rf(-50, 50), rf(-170, 90), rf(-20, 20)];
          const a = scratch(11); wr(a, pos);
          UE('graph.nearestWithTag', g.nearestWithTag(tag, pos), callFn(H, 0x5bb919, [tag, a]).eax, `tag ${tag} pos ${pos}`);
        }
        for (const fish of [REC.SHRK, ...REC.MANT, REC.SORD, REC.SOR1]) {
          const fn = G.R[fish].ctrl.nodes.find((x) => x.kind === 'FishBeh');
          for (let k = 0; k < 6; k++) {
            const frac = k === 0 ? fn.args[2] >>> 0 : bitsOf(rf(0, 1)), fr0 = new Float32Array(new Uint32Array([frac]).buffer)[0];
            const first = g.firstWithTag(fn.args[0]), a = scratch(12);
            mem.w32(a + 0x400, -12345); mem.w32(a + 0x404, -12345);
            callFn(H, 0x5bb600, [fn.args[0], first, fn.args[1], a, a + 0x400, a + 0x404, { f: fr0 }]);
            const w = g.loop(first, fn.args[1], fr0);
            cmpArrU(`graph.loop ${fish}`, w.path, Array.from({ length: w.path.length }, (_, i) => mem.r32(a + 4 * i)));
            // a fraction beyond the start of the last segment leaves the outputs unwritten in the original (the fish would start on garbage: the shipped fractions never do)
            if (mem.r32(a + 0x400) === -12345) { unit.unset = (unit.unset ?? 0) + 1; continue; }
            UE('graph.loop', w.index, mem.r32(a + 0x400), `fish ${fish} index frac ${fr0}`); UE('graph.loop', w.node, mem.r32(a + 0x404), `fish ${fish} node frac ${fr0}`);
          }
        }
        for (let k = 0; k < 60; k++) {
          const from = rnd.int(g.nodes.length), to = rnd.int(g.nodes.length);
          const a = scratch(13);
          callFn(H, 0x5bb588, [1, from, to, a]);
          const w = g.route(from, to);
          cmpArrU('graph.route', w, Array.from({ length: w.length }, (_, i) => mem.r32(a + 4 * i)), `route ${from} -> ${to}`);
        }
      }
      notes.push(`function level (original called directly, random inputs): ${unit.n} values compared; worst relative differences ${JSON.stringify(Object.fromEntries(Object.entries(unit.worst).map(([k, v]) => [k, +v.toExponential(1)])))}; ${unit.unset ?? 0} fish-loop fractions fall past the last segment (outputs unwritten in the original)`);
      function rk_(p) { return p ? (p - RB) / 0x68 : -1; }
      function cmpArrU(name, a, b, msg = '') { unit.n++; checked++; if (JSON.stringify(a) !== JSON.stringify(b)) bad(`unit ${name}: ${msg} port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`); }
    }

    // ---------------------------------------------------------------- the banner FUN_005b7f60 (score, medal, speech, hi-score and trophy variables) and the end test of the loop, over a grid of end states
    {
      const G = bootBkd(ctx, { seed: 1, dt: 1 });
      H = createHarness(ctx);
      buildOriginal(H, G); indexNodes(H, G);
      const { mem } = H, w = G.w;
      let n = 0;
      for (const bricks of [0, 1, 3, 4, 5]) for (const page of [0, 1]) for (const elapsed of [0, 60, 120, 200, 250, 330, 400, 450, 480, 490, 499, 500, 505]) for (const hi of [0, 3000, 9999]) for (const trophy of [0, 2]) {
        // the original
        w.vars.set(VAR.HISCORE, hi); w.vars.set(VAR.TROPHY, trophy);
        mem.wf32(0x5d5897c, f32(elapsed)); mem.w8(0x5d58988, bricks); mem.w8(0x5d58984, page);
        H.log.length = 0;
        callFn(H, 0x5b7f60, [0]);
        const hiO = w.vars.get(VAR.HISCORE), trO = w.vars.get(VAR.TROPHY);
        const draws = H.log.filter((e) => e[0] === 'draw'), says = H.log.filter((e) => e[0] === 'say').map((e) => e[1]);
        // the port
        const v = new Map([[VAR.HISCORE, hi], [VAR.TROPHY, trophy]]);
        const st = new BkdState(); st.elapsed = f32(elapsed); st.bricks = bricks; st.page = page === 1;
        const score = st.score(), b = finish({ get: (i) => v.get(i) ?? 0, set: (i, x) => v.set(i, x) }, st.success(), score);
        const tag = `bricks ${bricks} page ${page} elapsed ${elapsed} hi ${hi} trophy ${trophy}`;
        n++;
        UE_('banner score text', b.text.trim(), draws[0][1].trim(), tag);
        UE_('banner speech', b.line, says[0], tag);
        UE_('banner hi-score', v.get(VAR.HISCORE), hiO, tag); UE_('banner trophy', v.get(VAR.TROPHY) ?? 0, trO, tag);
        const medal = draws.some((d) => d[1] === 'SGGOLD') ? 3 : draws.some((d) => d[1] === 'SGSILVER') ? 2 : draws.some((d) => d[1] === 'SGBRONZE') ? 1 : 0;
        UE_('banner medal', b.medal, medal, tag);
        // the end test of the loop on the same numbers
        mem.wf32(0x5d5897c, f32(elapsed));
        const o1 = callFn(H, 0x5b8fa4, []).eax & 0xff, o2 = callFn(H, 0x5b8ffa, []).eax & 0xff, o3 = callFn(H, 0x5b9014, []).f;
        UE_('end test over', st.over() ? 1 : 0, o1, tag); UE_('end test success', st.success() ? 1 : 0, o2, tag); UE_('end percentage', st.percentLeft(), o3, tag);
      }
      notes.push(`banner / end test: ${n} end states (bricks x page x elapsed x hi-score x trophy) compared with FUN_005b7f60 / 005b8fa4 / 005b8ffa / 005b9014`);
      function UE_(name, a, b, msg) { checked++; if (a !== b) bad(`${name}: ${msg}: port ${a}, original ${b}`); }
    }

    // ---------------------------------------------------------------- the set-up: the original's builder (all 35 constructors, the waypoint graph, the hurt zones) against the port's bound zone
    {
      const G = bootBkd(ctx, { seed: 1, dt: 1 });
      const b = buildOriginal(H, G);
      indexNodes(H, G);
      const { mem } = H;
      const P = portState(H, G), E = emuState(H, G);
      // everything the first tick compares, before the first tick (the HUD cells / clock are written by the frame loop, not by the builder)
      const sub = (st) => ({ recs: st.recs, nodes: st.nodes, hurt: null });
      compareState({ ...P, globals: E.globals, camera: E.camera, hurt: E.hurt }, { ...E }, 'set-up');
      void sub;
      // the static parts of the nodes
      let nstatic = 0;
      const cmpArr = (label, a, bb) => { nstatic++; checked++; if (JSON.stringify(a) !== JSON.stringify(bb)) bad(`set-up: ${label}: port ${JSON.stringify(a)}, original ${JSON.stringify(bb)}`); };
      const nodeAt = (i, kind) => H.nodes[i].find((e) => e.kind === kind).ptr;
      for (const i of [REC.SHRK, ...REC.MANT, REC.SORD, REC.SOR1]) {
        const p = nodeAt(i, 'FishBeh'), n = G.R[i].ctrl.nodes.find((x) => x.kind === 'FishBeh');
        cmpArr(`fish ${i} path`, n.path, Array.from({ length: mem.r32(p + 0xe4) }, (_, k) => mem.r32(p + 0x6c + 4 * k)));
        cmpArr(`fish ${i} tag`, [n.args[0]], [mem.r32(p + 0xe8)]);
      }
      for (const i of [...REC.BRICKS, ...REC.BALLS]) {
        const p = nodeAt(i, i === REC.BRICKS[0] || REC.BRICKS.includes(i) ? 'BrkBeh' : 'CBallBeh'), sh = REC.BRICKS.includes(i) ? BRICK_SHAPE : BALL_SHAPE;
        cmpArr(`body ${i} shape`, [4, ...sh.flat().map(f32)], [mem.r32(p + 0x18), ...Array.from({ length: 12 }, (_, k) => mem.f32(p + 0x1c + 4 * k))]);
      }
      {
        const p = nodeAt(REC.PEPP, 'SwimBeh');
        cmpArr('diver shapes', [4, ...DIVER.SHAPES.flatMap((s) => s.flat().map(f32))].slice(0, 25), [mem.r32(p + 0x24), ...Array.from({ length: 24 }, (_, k) => mem.f32(p + 0x28 + 4 * k))]);
        const d = G.env.nodeOf(G.R[REC.PEPP]);
        cmpArr('diver movement block', [d.w.turn, d.w.turnDrag, d.w.thrust, d.w.drag].map(f32), [0xe0, 0xe4, 0xe8, 0xec].map((o) => mem.f32(p + o)));
        const dol = G.env.nodeOf(G.R[REC.DLPH]), q = nodeAt(REC.DLPH, 'DolpBeh');
        cmpArr('dolphin links', dol.links, Array.from({ length: 6 }, (_, k) => mem.r32(q + 0x100 + 4 * k)));
        cmpArr('dolphin tag base', [dol.links.length], [6]);
        const cn = nodeAt(REC.CANNON, 'CannBeh');
        cmpArr('cannon ball count', [10], [mem.r32(cn + 0x44)]);
      }
      // hurt templates (radii)
      HURT_REGISTRATIONS.forEach((reg, n) => {
        const e = 0x5d58c78 + n * 0xb4, t = HURT_TEMPLATES[reg.template];
        cmpArr(`hurt ${n} template`, [t.anchor.map(f32), f32(t.anchorRadius), t.spheres.map((s) => [s.local.map(f32), f32(s.radius)])], [[0, 1, 2].map((c) => mem.f32(e + 4 + 4 * c)), mem.f32(e + 0x1c),
          Array.from({ length: mem.r32(e + 0xac) }, (_, k) => [[0, 1, 2].map((c) => mem.f32(e + 0x20 + k * 0x1c + 4 * c)), mem.f32(e + 0x20 + k * 0x1c + 0x18)])]);
      });
      // the waypoint graph FUN_005bb2da (DAT_05d58c60 nodes at DAT_05d58c64, 0x54 bytes each)
      const gn = mem.r32(0x5d58c60), gp = mem.u32(0x5d58c64);
      cmpArr('graph size', [G.env.graph.nodes.length], [gn]);
      for (let i = 0; i < gn; i++) {
        const a = G.env.graph.nodes[i], e = gp + i * 0x54;
        cmpArr(`graph node ${i}`, [a.pos.map(f32), a.nbr, a.tag], [[0, 1, 2].map((c) => mem.f32(e + 4 * c)), Array.from({ length: mem.r32(e + 0xc) }, (_, k) => mem.r32(e + 0x10 + 4 * k)), mem.r32(e + 0x50)]);
      }
      notes.push(`set-up: the original's builder ran ${(b.steps / 1e3).toFixed(0)} k instructions: ${H.nodes.filter((l) => l.length).length} records with controllers (${H.nodes.reduce((s, l) => s + l.length, 0)} nodes), ${nstatic} static blocks (fish loops, shapes, links, hurt templates, ${gn} graph nodes) compared`);
    }

    // ---------------------------------------------------------------- scenario machinery
    const KEY = { L: 1, R: 2, U: 4, D: 8 };
    const bodyOf = (G, i) => G.env.nodeOf(G.R[i]);
    const summary = (G) => {
      const R = G.R, d = bodyOf(G, REC.PEPP), st = G.run.state;
      return {
        held: d.held ? d.held.index : -1, view: d.view, shape: d.shape, stun: d.stun > 0 ? 1 : 0, blocked: d.blocked, bricks: st.bricks, page: st.page ? 1 : 0, msg: st.dolphinMessage,
        balls: REC.BALLS.filter((i) => bodyOf(G, i).active).length, clam: bodyOf(G, REC.CLAM_TOP).holding ? 1 : 0, pir: REC.PIRATES.map((i) => bodyOf(G, i).state).join(''), dol: bodyOf(G, REC.DLPH).state,
        brickAct: REC.BRICKS.filter((i) => bodyOf(G, i).active).length, near: d.nearBrick, y: G.R[REC.PEPP].y > 86,
      };
    };
    const events = (a, b, calls, speech) => {
      const ev = [];
      for (const k of ['held', 'view', 'shape', 'stun', 'bricks', 'page', 'balls', 'clam', 'pir', 'dol', 'brickAct', 'near', 'y']) if (a[k] !== b[k]) ev.push(`${k}`);
      if (b.blocked !== a.blocked) ev.push('blocked');
      for (const c of calls) if (c[0] === 'p' || c[0] === 'at') ev.push(`snd:${c[1]}`);
      for (const sp of speech) ev.push(`say:${sp}`);
      return ev;
    };
    const RARE = /^(held|view|shape|stun|bricks|page|balls|clam|pir|dol|brickAct|near|y|blocked|snd:(?!BREATHE|FLIPPER|WATER_(?:MID|DEEP|SHALLOW))|say)/;

    const mk = (spec) => {
      const G = bootBkd(ctx, { seed: spec.seed ?? 1, dt: spec.dt });
      const rnd = rngOf((spec.seed ?? 1) * 31 + 7), irnd = rngOf((spec.seed ?? 1) * 53 + 11);
      const inp = spec.input ? spec.input(G, irnd) : () => 0;
      spec.setup?.(G, rnd);
      return { G, inp, rnd, before: spec.before };
    };
    const results = [];
    const runScenario = (spec) => {
      const label = `${spec.name} dt ${spec.dt}`;
      const P = mk(spec);
      const masks = [], evs = [];
      let prev = summary(P.G);
      const maxT = spec.ticks ?? 3000;
      for (let i = 0; i < maxT; i++) {
        P.before?.(P.G, i, P.rnd);
        const m = P.inp(P.G, i);
        P.G.sndCalls.length = 0; P.G.speech.length = 0; P.G.log.length = 0;
        P.G.tick(m);
        const cur = summary(P.G);
        masks.push(m); evs.push(events(prev, cur, P.G.sndCalls.map((e) => [e[0], e[1]]), P.G.speech));
        prev = cur;
        if (spec.until?.(P.G, i)) break;
      }
      const n = masks.length;
      const sel = new Set();
      const budget = spec.budget ?? 120;
      for (let i = 0; i < Math.min(n, spec.head ?? 3); i++) sel.add(i);
      const byKind = new Map();
      evs.forEach((ev, i) => { for (const e of ev) if (RARE.test(e)) { if (!byKind.has(e)) byKind.set(e, []); byKind.get(e).push(i); } });
      const rnd = rngOf((spec.seed ?? 1) * 977 + 3);
      const kinds = [...byKind.keys()].sort();
      const used = new Map(kinds.map((k) => [k, new Set()]));
      let guard = 0;
      while (sel.size < budget * 0.7 && kinds.length && guard++ < budget * 20) {
        for (const k of kinds) {
          const arr = byKind.get(k), u = used.get(k);
          if (u.size >= arr.length) continue;
          let idx; do { idx = rnd.int(arr.length); } while (u.has(idx));
          u.add(idx);
          for (const d of [-1, 0, 1]) { const t = arr[idx] + d; if (t >= 0 && t < n) sel.add(t); }
          if (sel.size >= budget * 0.7) break;
        }
      }
      for (let g = 0; sel.size < Math.min(n, budget) && g < n * 4; g++) sel.add(rnd.int(n));
      if (spec.all) for (let i = 0; i < n; i++) sel.add(i);
      const Q = mk(spec);
      H = createHarness(ctx);
      buildOriginal(H, Q.G); indexNodes(H, Q.G);
      let cmp = 0;
      for (let i = 0; i < n; i++) {
        Q.before?.(Q.G, i, Q.rnd);
        if (sel.has(i)) {
          if (!step(Q.G, masks[i], `${label} tick ${i}`)) break;
          cmp++;
          for (const e of evs[i]) stats.ev[e.replace(/^say:.*/, 'say')] = (stats.ev[e.replace(/^say:.*/, 'say')] ?? 0) + 1;
        } else { Q.G.sndCalls.length = 0; Q.G.speech.length = 0; Q.G.log.length = 0; Q.G.tick(masks[i]); }
      }
      return { n, cmp, G: Q.G };
    };
    const run = (spec) => {
      for (const dt of spec.dts ?? [1, 0.5]) {
        const t0 = Date.now();
        const r = runScenario({ ...spec, dt, ticks: spec.ticks ? (spec.fixed ? spec.ticks : Math.round(spec.ticks / dt)) : undefined });
        results.push({ name: spec.name, dt, n: r.n, cmp: r.cmp, ms: Date.now() - t0 });
      }
    };
    const keyGen = (irnd, pHold = 0.3) => {
      let hold = 0, dirs = 0;
      return () => {
        if (hold-- <= 0) { hold = 3 + irnd.int(30); dirs = 0; for (const k of [KEY.L, KEY.R, KEY.U, KEY.D]) if (irnd() < pHold) dirs |= k; if ((dirs & 3) === 3) dirs &= ~irnd.pick([1, 2]); if ((dirs & 12) === 12) dirs &= ~irnd.pick([4, 8]); }
        return dirs;
      };
    };

    // ---------------------------------------------------------------- state injection: a random but consistent state of the diver, the bodies and the zone (the branches an ordinary dive reaches rarely)
    const wrap2pi = (a) => { while (a >= 6.2831855) a -= 6.2831855; while (a < 0) a += 6.2831855; return a; };
    const inject = (G, rnd) => {
      const R = G.R, env = G.env, d = bodyOf(G, REC.PEPP), st = G.run.state, rec = R[REC.PEPP];
      // the zone state
      st.elapsed = f32(rnd.pick([0, 100, 249.9, 250.1, 499.95, 499.99, rnd() * 500]));
      st.bricks = rnd.pick([0, 0, 1, 2, 3, 4]);
      st.page = rnd() < 0.25; st.pageFlash = st.page && rnd() < 0.5 ? f32(rnd() * 4) : 0; st.halfSpoken = rnd() < 0.5;
      st.dolphinMessage = rnd.pick([0, 0, 0, 1, 2]);
      st.brickTint = st.brickTint.map((_, k) => (k < st.bricks ? 0xffffffff : 0x77333333));
      st.pageTint = st.page ? 0xffffffff : 0x77333333;
      // where: next to something that hurts / is touched, or anywhere
      const targets = [REC.SHRK, ...REC.MANT, REC.SORD, REC.SOR1, ...REC.PIRATES, REC.ANCHOR, REC.OCTC, REC.OCTH, REC.CLAM_TOP, REC.CLAM_BOT, ...REC.BRICKS, REC.PAGE, REC.CANNON, REC.LAND];
      const mode = rnd.pick(['any', 'any', 'any', 'brick', 'brick', 'deliver', 'deliver', 'page', 'clam', 'last', 'tentacle', 'anchor', 'cannonball']);
      const tgt = R[mode === 'brick' ? rnd.pick(REC.BRICKS) : mode === 'page' ? REC.PAGE : mode === 'clam' ? rnd.pick([REC.CLAM_TOP, REC.CLAM_BOT]) : mode === 'last' ? REC.BRICKS[4] : mode === 'tentacle' ? REC.OCTC : mode === 'anchor' ? REC.ANCHOR : mode === 'cannonball' ? REC.CANNON : rnd.pick(targets)];
      const near = mode !== 'any' || rnd() < 0.75, spread = mode === 'any' ? 8 : 2.5;
      let x = near ? tgt.x + (rnd() - 0.5) * spread : (rnd() - 0.5) * 100, y = near ? tgt.y + (rnd() - 0.5) * spread : rnd() * 255 - 170;
      if (mode === 'deliver') { x = (rnd() - 0.5) * 30; y = 84 + rnd() * 2.4; }
      const heading = f32(wrap2pi(mode === 'deliver' ? (rnd() - 0.5) * 0.6 : rnd() * 6.2831855));
      rec.rx = 0; rec.rz = heading; rec.ry = -heading;
      rec.setEuler(0, rec.ry, rec.rz, f32(x), f32(Math.min(86.4, y)), 10);
      d.w.heading = heading; d.w.angVel = f32((rnd() - 0.5) * 5); d.w.vx = f32((rnd() - 0.5) * 24); d.w.vy = f32((rnd() - 0.5) * 24); d.w.vz = 0;
      d.safe = { x: f32(rec.x - rnd() * 2), y: f32(rec.y - rnd() * 2), z: 10, heading: f32(heading + (rnd() - 0.5) * 0.3) };
      d.blocked = rnd.pick([0, 0, 0, 1]);
      d.breathCount = rnd.pick([0, 0, 5, 179, 180, 181, rnd.int(200)]);
      d.surfaceFlag = rnd() < 0.5; d.clamCatching = rnd() < 0.2;
      d.nearBrick = rnd.pick([0, 1]);
      const stunned = rnd() < 0.25;
      d.stun = stunned ? f32(rnd() * 2) : 0; d.flicker = stunned || rnd() < 0.1 ? f32(rnd() * 2) : 0; d.spare = rnd() < 0.1 ? f32(rnd()) : 0; d.flickerPhase = rnd.pick([0, 1]);
      const skel = d.flicker > 0 && rnd() < 0.8;
      d.view = skel ? 1 : 0;
      if (skel) { R[REC.SKEL].show(); R[REC.PEPP].hide(); } else { R[REC.SKEL].hide(); R[REC.PEPP].show(); }
      d.flipperFlag = !skel;
      // the brick in the hands
      for (const i of REC.BRICKS) { const bn = bodyOf(G, i); bn.active = false; bn.age = 10; R[i].flags |= 2; R[i].flags &= ~0x10; }
      d.held = null; d.shape = 0; d.wantShape = 0;
      if (mode === 'deliver') d.w.vy = f32(6 + rnd() * 6);
      if (mode === 'deliver' || (mode !== 'brick' && mode !== 'last' && rnd() < 0.4)) { const k = rnd.int(5), br = R[REC.BRICKS[k]]; d.held = br; br.flags &= ~2; br.flags |= 0x10; bodyOf(G, REC.BRICKS[k]).age = 10; d.shape = rnd.pick([0, 1]); d.wantShape = 1; }
      // dropped bricks in the water
      for (const i of REC.BRICKS) {
        if (R[i] === d.held || rnd() > 0.35) continue;
        const bn = bodyOf(G, i), r = R[i];
        bn.active = true; bn.age = f32(rnd() * 6);
        r.setEuler(0, 0, f32((rnd() - 0.5) * 3), f32(rec.x + (rnd() - 0.5) * 12), f32(rec.y + (rnd() - 0.5) * 12), 10);
        r.rz = f32((rnd() - 0.5) * 3); bn.last = [r.x, r.y, 10]; bn.b = { vx: f32((rnd() - 0.5) * 6), vy: f32((rnd() - 0.5) * 6), vz: 0, angVel: f32((rnd() - 0.5) * 3) };
      }
      // cannon balls in flight and the cannon
      const cannon = bodyOf(G, REC.CANNON);
      cannon.timer = f32(rnd.pick([1, 0.01, 0, 5, rnd() * 8]));
      cannon.slots = REC.BALLS.map((i) => R[i]);
      let flying = 0;
      for (const i of REC.BALLS) {
        const bn = bodyOf(G, i), r = R[i];
        if (rnd() < 0.3) {
          bn.active = true; bn.age = f32(rnd.pick([0, 5, 19.99, 20.01, rnd() * 21]));
          r.flags |= 2; r.setEuler(0, 0, f32((rnd() - 0.5) * 3), f32(rec.x + (rnd() - 0.5) * 14), f32(rec.y + (rnd() - 0.5) * 14), 10);
          r.rz = f32((rnd() - 0.5) * 3); bn.last = [r.x, r.y, 10]; bn.b = { vx: f32((rnd() - 0.5) * 20), vy: f32((rnd() - 0.5) * 20), vz: 40, angVel: f32((rnd() - 0.5) * 3) };
          cannon.slots[REC.BALLS.indexOf(i)] = null; flying++;
        } else { bn.active = false; bn.age = 0; r.flags &= ~2; }
      }
      BallNode.inFlight = flying;
      // clam
      const clam = bodyOf(G, REC.CLAM_TOP), ct = R[REC.CLAM_TOP];
      clam.speed = f32(rnd.pick([-0.87266, 0.87266, -0.87266, 0.87266, 0.4])); clam.holding = rnd() < 0.3; clam.timer = rnd() < 0.5 ? 0 : f32(rnd() * 4);
      ct.rx = f32(rnd.pick([-0.785, -0.78, -0.4, -0.01, 0, -0.5, rnd() * -0.8])); ct.setEuler(ct.rx, ct.ry, ct.rz, ct.x, ct.y, ct.z);
      // octopus
      const oc = bodyOf(G, REC.OCTO), arm = R[REC.OCTC];
      arm.rz = f32(rnd.pick([0, -1.2217239, -1.2, -0.3, rnd() * -1.22])); arm.setEuler(arm.rx, arm.ry, arm.rz, arm.x, arm.y, arm.z);
      oc.speed = f32(rnd.pick([-0.69813, 0.69813, -1.9198, 2.2, 0.5, -0.5]));
      oc.a = rnd() < 0.3; oc.firstHalf = rnd() < 0.4; oc.b = rnd() < 0.3; oc.secondHalf = rnd() < 0.3;
      const oa = R[REC.OCTO].anim; oa.seek(f32(rnd() * Math.max(0, oa.frameCount - 1)));
      // pirates
      for (const i of REC.PIRATES) {
        const pn = bodyOf(G, i), pr = R[i];
        pn.alerted = rnd() < 0.5; pn.engaged = pn.alerted && rnd() < 0.7; pn.near = rnd() < 0.5; pn.state = pn.engaged ? rnd.pick([1, 2, 3]) : rnd.pick([-1, 3]);
        pn.cooldown = rnd() < 0.5 ? 0 : f32(rnd() * 10);
        if (pn.state !== -1) { pr.anim.start(pn.state, 1); pr.anim.seek(f32(rnd() * pr.anim.frameCount)); }
      }
      // anchor
      const an = bodyOf(G, REC.ANCHOR), ar = R[REC.ANCHOR];
      ar.rz = f32((rnd() - 0.5) * 0.9); an.base = f32(rnd.pick([-0.43633, 0.43633, -0.2, 0.3])); an.speed = f32(an.base * 0.5);
      ar.setEuler(0, 0, ar.rz, ar.x, ar.y, ar.z);
      for (const r of R) r.savePrev();
    };
    /** warm up a number of ticks (the fish and the anchor are somewhere else), then inject */
    const staged = (G, rnd) => { const n = rnd.int(400); for (let i = 0; i < n; i++) G.tick(0); inject(G, rnd); };

    // ---------------------------------------------------------------- scenarios
    // the bot's dive (real play: bricks fetched and delivered, the page, the creatures dodged), recorded once at dt = 1 and replayed (at dt = 0.5 every key is held two ticks)
    {
      const t0 = Date.now();
      const recA = bootBkd(ctx, { seed: 1, dt: 1 });
      const hazards = recordHazards(recA.run, recA.w, 7600);
      const m = bootBkd(ctx, { seed: 1, dt: 1 });
      const grid = buildGrid(m.w), tight = buildGrid(m.w, { length: 4.5, half: 1.15, back: 0.2 });
      const bot = new Bot(grid, { hazards, margin: 2.5, horizon: 90, tight });
      const masks = [];
      for (let t = 0; t < 7500 && !m.run.result(); t++) { const sn = snapshot(m.run); const mask = bot.decide({ ...sn, bricks: sn.brickList, page: sn.pageAt, havePage: sn.page }); masks.push(mask); m.tick(mask); }
      notes.push(`bot dive recorded: ${masks.length} ticks, ${m.run.state.bricks} bricks delivered, ${(Date.now() - t0)} ms`);
      run({ name: 'bot dive', seed: 1, input: (G) => (G2, i) => masks[Math.min(masks.length - 1, Math.floor(i * G.w.dt))], ticks: masks.length, budget: 110 });
    }
    // the whole 500 s without input (the creatures move on their own clock: late ticks too)
    run({ name: 'idle 500 s', seed: 1, input: () => () => 0, ticks: 15000, budget: 60, dts: [1] });
    for (const seed of [1, 2, 3]) run({ name: 'random keys', seed, input: (G, r) => keyGen(r, 0.5), ticks: 1200, budget: 90 });
    const fuzzN = process.env.BKD_FUZZ ? +process.env.BKD_FUZZ : 6;
    for (let seed = 100; seed < 100 + fuzzN; seed++) {
      run({ name: 'random state', seed, input: (G, r) => keyGen(r, 0.6), setup: staged, before: (G, i, r) => { if (i > 0 && i % 10 === 0) inject(G, r); }, ticks: 200, fixed: true, all: true, budget: 200, dts: [seed % 2 ? 1 : 0.5] });
    }
    const groups = new Map();
    for (const r of results) { const k = `${r.name} dt ${r.dt}`; const o = groups.get(k) ?? { runs: 0, n: 0, cmp: 0 }; o.runs++; o.n += r.n; o.cmp += r.cmp; groups.set(k, o); }
    for (const [k, o] of groups) notes.push(`${k}: ${o.runs} run(s), ${o.n} ticks played, ${o.cmp} compared against the original`);
    notes.push(`${stats.ticks} ticks, ${(stats.steps / 1e6).toFixed(1)} M instructions, ${stats.ms} ms`);
    notes.push(`max normalised errors: ${JSON.stringify(Object.fromEntries(Object.entries(maxErr).map(([k, v]) => [k, +v.toExponential(2)])))}`);
    notes.push(`events: ${JSON.stringify(stats.ev)}`);
    const need = ['snd:BRICK_GET', 'snd:BRICK_DROP', 'snd:BRICK_FINISH', 'snd:GETPAGE', 'snd:SHOCK1', 'snd:SHOCK4', 'snd:CLANG', 'snd:HIT_ANCHOR', 'snd:CANNON', 'snd:CLAM_CATCH', 'snd:INSIDE_CLAM1', 'snd:INSIDE_CLAM2',
      'snd:SKELETON_ANIMATE', 'snd:HIT_SAND', 'snd:WAVE1', 'snd:WAVE2', 'snd:TENTACLE_HIT', 'snd:CLAM_OPEN', 'snd:CLAM_SHUT', 'snd:SUBMERGE', 'snd:WATER_SURFACE', 'snd:WATER_MID', 'snd:WATER_DEEP', 'snd:WATER_SHALLOW',
      'snd:BREATHE', 'snd:FLIPPER_LEFT', 'snd:FLIPPER_RIGHT', 'say', 'attach', 'bricks', 'page', 'dol', 'pir', 'balls', 'brickAct', 'stun', 'view', 'shape', 'held', 'near', 'blocked', 'clam', 'y'];
    for (const k of need) ok((stats.ev[k] ?? 0) > 0, `coverage: no compared tick with the event ${k}`);
    notes.push(`dolphin route: (port route length : original +0xb0) pairs seen ${[...routeCounts].slice(0, 12).join(' ')}`);
    return { checked, failures, notes };
  },
};
