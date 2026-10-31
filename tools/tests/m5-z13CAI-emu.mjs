// M5 z13CAI, the ORACLE test: the original's Adventure Island nodes (pepswitc FUN_0061c0e0, the circling birds FUN_004b4000 / FUN_004b3bb7, SGHeli, SGVehic, the Ptera nodes, the
// flowing water) run natively in the x86 interpreter (tools/lib/m5-z13CAI-emu.mjs) next to the port's nodes with the same scripted buttons and the same random numbers; compared tick by
// tick: records (matrix, Euler angles, flags), the birds' node blocks and animations, the helicopter's node fields, all game variables, the vehicle globals, the camera, every sound call.
import { makeCaiDuel, onodeOf, NATIVE_CTORS, B, lcg, randomKeys, RECORDS_BASE, REC, VAR_ARRAY } from '../lib/m5-z13CAI-emu.mjs';
import { berthPos, vehicles } from '../../src/island/vehicles/common.ts';
import { NODE_STOP } from '../../src/game/controller.ts';
import { guarded } from '../lib/inject-guard.mjs';

const MAXFAIL = 30;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const POOL = [B.SPACE, B.SPACE, B.SPACE | B.LEFT, B.SPACE | B.RIGHT, B.LEFT, B.RIGHT, B.ALT, B.ALT | B.LEFT, B.UP, B.DOWN, B.UP | B.SPACE, B.DOWN | B.SPACE, 0, 0, B.SPACE | B.UP | B.LEFT];
/** the sound calls of the tick: the original's (logged by the machine) against the port's; the engine's playback rate (`r #306 Hz`, an integer truncation of a float sum) may differ by 1 Hz */
function sounds(d) {
  const keep = (l) => /^(p2|s2|r|p3) /.test(l);
  const o = d.olog.filter(keep), p = d.psnd.filter(keep);
  d.checked++;
  if (o.length !== p.length) { d.fail(`${d.label} t${d.t} sound calls: original ${o.join(' | ')} port ${p.join(' | ')}`); return; }
  for (let i = 0; i < o.length; i++) {
    const m = /^(r #\d+) (-?\d+)$/.exec(o[i]), n = /^(r #\d+) (-?\d+)$/.exec(p[i]);
    if (m && n) { d.checked++; if (m[1] !== n[1] || Math.abs(+m[2] - +n[2]) > 2) d.fail(`${d.label} t${d.t} sound call ${i}: original ${o[i]} port ${p[i]}`); continue; }
    const split = (l) => { const q = /^(p3 #\d+) (\S+)$/.exec(l); return q ? [q[1], q[2].split(',').map(Number)] : [l, null]; };
    const [a, pa] = split(o[i]), [b, pb] = split(p[i]);
    if (a !== b) { d.fail(`${d.label} t${d.t} sound call ${i}: original ${o[i]} port ${p[i]}`); continue; }
    if (pa) for (let k = 0; k < 3; k++) d.cmp(`${a} pos[${k}]`, pa[k], pb[k]);
  }
}
const GULLS = Array.from({ length: 16 }, (_, k) => 24 + k);       // PTER (24), GL00..GL14 (25..39)

const __test = {
  name: 'm5-z13CAI-emu',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { ticks: 0, sessions: 0, landed: 0, exited: 0, gullStates: new Set(), flips: 0, cries: 0, gullFramesStopped: 0 };

    const session = (label, o, dt) => {
      const d = makeCaiDuel(ctx, { ...o, dt, maxFail: MAXFAIL, failures });
      d.label = label; cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem, G = vehicles(W);
      const vehIdx = G.current ? G.current.index : -1;
      const heli = vehIdx >= 0 ? W.records[vehIdx] : null;
      const compare = () => {
        for (const i of GULLS) {
          d.rec(i, 0xffff);
          const pn = W.records[i].ctrl?.nodes.find((n) => n.kind === 'Gull'), a = onodeOf(d, i, NATIVE_CTORS.GULL);
          if (pn && a) {
            d.eq(`gull${i} state`, mem.r32(a + 0x20), pn.state);
            d.cmp(`gull${i} turn`, mem.f32(a + 0x24), pn.turn);
            for (let k = 0; k < 3; k++) d.cmp(`gull${i} home`, mem.f32(a + 0x14 + 4 * k), pn.home[k], 0, `[${k}]`);
            cover.gullStates.add(pn.state);
          }
          const an = d.O.world.records[i].anim, pa = W.records[i].anim;
          if (an && pa) { d.eq(`gull${i} clip`, an.clip, pa.clip); d.cmp(`gull${i} frame`, an.frame, pa.frame); }
        }
        // the vehicle chain (SGHeli / Ptera) is float32 per operation: tolerance 0 like the island oracles
        d.rec(d.P.pepper.index, 0xffff);
        if (vehIdx >= 0) d.rec(vehIdx, 0xffff);
        d.globals(); d.vars();
        for (let k = 0; k < 6; k++) d.cmp(`camera[${k}]`, mem.f32(0x9da5e8 + 4 * k), W.camera.c[k]);
        if (d.olog) sounds(d);
        for (const k of [0, 1]) d.eq('pad taken', mem.r32(0x9daa50 + 4 * k) !== 0, G.pads[k]?.taken ?? false, ` ${k}`);
      };
      // sync mode: the continuous state of the vehicle chain (float32 sums of the original vs the port's doubles: pose, velocities, rotor angles, pitch wobble, engine pitch, camera) is copied into
      // the port before each tick, so a free flight of 1600 ticks compares the LOGIC of one tick at a time (the island's heli test does the same)
      const syncPort = () => {
        if (!o.sync) return;
        for (const i of [vehIdx, d.P.pepper.index]) if (i >= 0) d.recToPort(i);
        d.cameraToPort();
        // the animation frames of the vehicle and Pepper (the wing-beat sounds fire when the integer part of the frame changes: float noise would move them by a tick)
        for (const i of [vehIdx, d.P.pepper.index]) { const oa = d.O.world.records[i]?.anim, pa = W.records[i]?.anim; if (oa && pa && oa.clip === pa.clip) pa.frame = oa.frame; }
        const pn = heli?.ctrl?.nodes.find((n) => n.kind === 'SGHeli'), a = onodeOf(d, vehIdx, NATIVE_CTORS.HELI);
        const pt = heli?.ctrl?.nodes.find((n) => n.kind === 'Ptera'), pa = onodeOf(d, vehIdx, NATIVE_CTORS.PTERA);
        if (pt && pa) d.nodeToPort(pt, pa, { yawRate: [0x1c, 'f'], pitchRate: [0x24, 'f'], bounceT: [0x28, 'f'], speed: [0x38, 'f'], ground: [0x40, 'f'] });
        if (pn && a) d.nodeToPort(pn, a, { vx: [0x1c, 'f'], vy: [0x20, 'f'], vz: [0x24, 'f'], rotorMain: [0x2c, 'f'], rotorTail: [0x30, 'f'], wobble: [0x34, 'f'], engineHz: [0x38, 'f'] });
      };
      const step = (held) => { syncPort(); d.tick(held); cover.ticks++; compare(); };
      const idle = (n, held = 0) => { for (let i = 0; i < n; i++) step(held); };
      return { d, W, mem, G, heli, vehIdx, step, idle, compare };
    };

    // ---- 1. a long free flight of the helicopter at the arrival from the island (node 33): the gulls circle, pepswitc plays its sounds every tick
    for (const dt of [1, 0.5]) {
      const S = session(`fly dt${dt}`, { node: 33, seed: 777, sync: true }, dt);
      const { d, W, step, idle } = S;
      const scale = dt === 1 ? 1 : 2;
      const rnd = lcg(4242), keys = randomKeys(rnd, POOL, 20 * scale);
      d.compare = S.compare;
      S.compare();                                                  // after the constructors
      idle(30 * scale);
      for (let t = 0; t < 900 * scale; t++) step(keys());
      notes.push(`${S.d.label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
    }

    // ---- 2. landing on the hub's one pad (PATH node 0): Ctrl within 80 units of it; Pepper steps off, PEPPER_CONTROL = 1 and pepswitc sets var 5 = 11 (the Oasis)
    for (const dt of [1, 0.5]) {
      const S = session(`land dt${dt}`, { node: 33, seed: 99, sync: true }, dt);
      const { d, W, mem, G, heli, step, idle } = S;
      const scale = dt === 1 ? 1 : 2;
      const pad = berthPos(G.pads[0]);
      // put the helicopter 150 units from the pad at flying height, in both worlds (the mirror of the oracle's records is updated through the machine's memory)
      const spot = [pad[0] - 130, pad[1] + 45, pad[2] + 60];
      for (const [world, isOracle] of [[W, false], [d.O.world, true]]) {
        const r = world.records[heli.index];
        r.setEuler(0, Math.atan2(pad[0] - spot[0], pad[2] - spot[2]), 0, spot[0], spot[1], spot[2]); r.rx = 0; r.ry = Math.atan2(pad[0] - spot[0], pad[2] - spot[2]); r.rz = 0;
        if (isOracle) d.emu.putRecord(heli.index, r);
      }
      d.emu.sync();
      // (the helicopter's take-off state is 0 until it is 40 above the ground: wait for flight)
      idle(30 * scale);
      const pn = heli.ctrl.nodes.find((n) => n.kind === 'SGHeli');
      for (let t = 0; t < 900 * scale && pn.state !== 2; t++) {
        const r = heli, dx = pad[0] - r.x, dz = pad[2] - r.z, dist = Math.hypot(dx, dz), ang = wrap(Math.atan2(dx, dz) - r.ry);
        let k = 0;
        if (ang > 0.1) k |= B.RIGHT; else if (ang < -0.1) k |= B.LEFT;
        if (Math.abs(ang) < 0.6 && dist > 60) k |= B.SPACE;
        if (dist <= 60 && Math.abs(ang) < 0.6) { step(k | B.CTRL); break; }
        step(k);
      }
      for (let t = 0; t < 600 * scale && W.vars.get(0x5e) !== 1; t++) step(0);
      if (pn.state === 0 && W.vars.get(0x5e) === 1) cover.landed++;
      d.eq('var 5 after landing', mem.r32(VAR_ARRAY + 4 * 5), W.vars.get(5));
      if (W.vars.get(5) === 11) cover.exited++;
      idle(10 * scale);
      notes.push(`${S.d.label}: landed ${W.vars.get(0x5e) === 1}, var 5 = ${W.vars.get(5)} (original ${mem.r32(VAR_ARRAY + 20)})`);
      checked += d.checked;
    }

    // ---- 3. the Ptera arrival (PORTAL_VEHICLE 2: PTER, PEPPER_CONTROL 0x40) and the rescue helicopter (1)
    for (const [label, vars, kinds] of [['rhel', { 0xbb: 1 }, null], ['ptera', { 0xbb: 2 }, null]]) {
      const S = session(`${label}`, { node: 33, seed: 31, vars, sync: true }, 1);
      const { d, step, idle } = S;
      const rnd = lcg(777), keys = randomKeys(rnd, POOL, 20);
      idle(20);
      for (let t = 0; t < 500; t++) step(keys());
      notes.push(`${label}: control ${S.W.vars.get(0x5e)}, vehicle ${S.heli?.name}, worst ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
      checked += d.checked;
    }
    notes.push(`coverage: ${JSON.stringify({ ...cover, gullStates: [...cover.gullStates].map((s) => s.toString(16)) })}`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
