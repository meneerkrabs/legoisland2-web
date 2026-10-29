import { createHarness, bootSsh, makeTFor, snapHosted, restoreHosted, f32 } from '../lib/m7-z15SSH-emu.mjs';
import { REC, K, SN, SND, hexf, placeOnPath, finalScore } from '../../src/zones/z15ssh/rules.ts';
import { SshBot } from '../lib/ssh-bot.mjs';

// z15SSH differential test (WP-VERIFY, docs/re/m6/z15SSH.md "Differential test"): the ORIGINAL buggy update FUN_00658c16 with everything it calls in the zone code
// (snakes, coconuts, carts, sounds, crew, camera, the path code) runs in the x86 emulation (tools/lib/m7-z15SSH-emu.mjs) from the port's state of the same tick, next
// to the port's world tick; node state, record matrices / flags / Euler angles, part matrices, animation clip / frame, camera, globals, sound / speech calls and random
// draws are compared. Seeded scenarios, every one at dt = 1 and dt = 0.5.

const KEY = { L: 1, R: 2, U: 4, D: 8, FIRE: 0x80 };

export default {
  name: 'm7-z15SSH-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = 40;
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const TOL = 0;
    const maxErr = {};
    /** |a - b| <= TOL * max(1, |b|) (a = port, b = original); the largest normalised error per class is kept for the notes */
    const num = (cls, a, b, msg) => {
      checked++;
      const e = Math.abs(a - b) / Math.max(1, Math.abs(b));
      if (!(e <= (maxErr[cls] ?? 0))) { if (e === e) maxErr[cls] = e; }
      if (!(e <= TOL)) { bad(`${msg}: port ${a}, original ${b}`); return false; }
      return true;
    };
    const eq = (a, b, msg) => { checked++; if (a !== b) { bad(`${msg}: port ${a}, original ${b}`); return false; } return true; };
    const eqj = (a, b, msg) => { checked++; const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) { bad(`${msg}: port ${x}, original ${y}`); return false; } return true; };

    const H = createHarness(ctx);
    const rngOf = (seed) => { let s = seed >>> 0; const f = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; f.int = (n) => Math.trunc(f() * n); f.pick = (a) => a[f.int(a.length)]; return f; };
    const stats = { ticks: 0, steps: 0, ms: 0, states: {}, ev: {} };
    const count = (k) => { stats.ev[k] = (stats.ev[k] ?? 0) + 1; };

    const scaleRows = (m, s) => {
      for (let r = 0; r < 3; r++) { const l = Math.hypot(m[r * 4], m[r * 4 + 1], m[r * 4 + 2]); if (l > 0) { const k = s / l; m[r * 4] *= k; m[r * 4 + 1] *= k; m[r * 4 + 2] *= k; } }
    };

    /** one tick: the original from the port's state, then the port from the same state; compare */
    const step = (G, mask, label) => {
      H.G = G; H.buildPaths(G.arch);
      const { w, node, R } = G;
      const hs = snapHosted(G);
      const t0 = Date.now();
      let o;
      try { o = H.pass(mask); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); restoreHosted(G, hs); return false; }
      stats.ms += Date.now() - t0; stats.steps += o.steps;
      const origAnim = R.map((r) => (r.anim ? [r.anim.clip, r.anim.frame] : null));
      const origDraws = o.draws.slice();
      const u1 = G.U.pos;
      restoreHosted(G, hs);
      G.log.length = 0; G.draws.length = 0;
      const pre = { states: node.states.slice(), z: G.cart.z, nco: node.coconuts.filter((c) => c.active).length };
      G.tick(mask);
      stats.ticks++;
      // the snakes are drawn at scale 0.75: the port keeps the scale in the matrix rows (rules.ts updateSnakes), the original in the draw hook
      for (const i of REC.SNAKE) { const rr = o.recs[i]; const m = Float32Array.from(rr.m); scaleRows(m, K.SNAKE_SCALE); rr.m = Array.from(m); }
      // ---- node
      const n = o.node;
      for (const k of ['yaw', 'smoothYaw', 'yawRate', 'wheel', 'aimYaw', 'aimPitch', 'prevYaw', 'speed', 'maxSpeed', 'time', 'reload']) num('node', node[k], n[k], `${label}: node.${k}`);
      for (const k of ['score', 'gems', 'stage']) eq(node[k], n[k], `${label}: node.${k}`);
      eq(node.flinch ? 1 : 0, n.flinch, `${label}: node.flinch`);
      for (let i = 0; i < 3; i++) {
        num('node', node.timers[i], n.timers[i], `${label}: timers[${i}]`);
        eq(node.states[i], n.states[i], `${label}: states[${i}]`);
        for (let k = 0; k < 3; k++) num('node', node.saved[i][k], n.saved[i][k], `${label}: saved[${i}][${k}]`);
      }
      node.coconuts.forEach((c, k) => {
        const q = n.coconuts[k];
        eq(c.active ? 1 : 0, q.active, `${label}: coconut ${k} active`);
        if (c.active || q.active) {
          for (let i = 0; i < 16; i++) num('coconut', c.m[i], q.m[i], `${label}: coconut ${k} m[${i}]`);
          for (let i = 0; i < 3; i++) num('coconut', c.vel[i], q.vel[i], `${label}: coconut ${k} vel[${i}]`);
          eq(c.birth, q.birth, `${label}: coconut ${k} birth`);
        }
      });
      // ---- globals
      const g = o.globals;
      eq(node.result, g.result, `${label}: result`); eq(node.finalScore, g.final, `${label}: final score`);
      eq(node.hudScore, g.hudScore, `${label}: HUD score`); eq(node.hudGems, g.hudGems, `${label}: HUD gems`);
      if (g.result !== 0 && node.speed === 0) { eq(node.score, g.bcd4, `${label}: DAT_05d5bcd4 (points)`); eq(node.gems, g.bcd8, `${label}: DAT_05d5bcd8 (gems)`); }
      // ---- records
      for (const r of R) {
        const q = o.recs[r.index];
        const f = r.flags & 0xffff;
        let same = f === q.flags;
        let worst = 0;
        for (let k = 0; k < 16; k++) { const e = Math.abs(r.m[k] - q.m[k]) / Math.max(1, Math.abs(q.m[k])); if (e === e) worst = Math.max(worst, e); else worst = Infinity; }
        for (let k = 0; k < 3; k++) { const a = [r.rx, r.ry, r.rz][k], e = Math.abs(a - q.e[k]) / Math.max(1, Math.abs(q.e[k])); worst = Math.max(worst, e === e ? e : Infinity); }
        if (r.index === REC.CART || REC.SNAKE.includes(r.index) || REC.CRT.includes(r.index)) maxErr.rec = Math.max(maxErr.rec ?? 0, worst);
        else maxErr.crew = Math.max(maxErr.crew ?? 0, worst);
        if (!(worst <= TOL)) same = false;
        checked++;
        const dif = []; for (let k = 0; k < 16; k++) if (!(r.m[k] === q.m[k])) dif.push(`m[${k}] ${r.m[k]} vs ${q.m[k]}`); for (let k = 0; k < 3; k++) { const a2 = [r.rx, r.ry, r.rz][k]; if (!(a2 === q.e[k])) dif.push(`e[${k}] ${a2} vs ${q.e[k]}`); }
        if (!same) bad(`${label}: record ${r.index} ${r.name} [${dif.join('; ')}]: port flags ${f.toString(16)} m ${Array.from(r.m).map((v) => +v.toFixed(4))} e ${[r.rx, r.ry, r.rz].map((v) => +v.toFixed(4))} | original flags ${q.flags.toString(16)} m ${q.m.map((v) => +v.toFixed(4))} e ${q.e.map((v) => +v.toFixed(4))}`);
        const aa = r.anim ? [r.anim.clip, r.anim.frame] : null;
        if (aa && origAnim[r.index]) {
          checked++;
          if (aa[0] !== origAnim[r.index][0] || aa[1] !== origAnim[r.index][1]) bad(`${label}: record ${r.index} ${r.name} animation: port ${JSON.stringify(aa)}, original ${JSON.stringify(origAnim[r.index])}`);
        }
      }
      // ---- the part matrices
      for (const [ri, i, m] of o.parts) {
        const pm = G.parts.get(R[ri], i);
        let worst = 0;
        for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(pm[k] - m[k]) / Math.max(1, Math.abs(m[k])));
        maxErr.part = Math.max(maxErr.part ?? 0, worst);
        checked++;
        if (!(worst <= TOL)) bad(`${label}: part ${i} of record ${ri}: port ${Array.from(pm).map((v) => +v.toFixed(4))}, original ${m.map((v) => +v.toFixed(4))}`);
      }
      // ---- camera: eye, target
      for (let i = 0; i < 6; i++) num('camera', w.camera.c[i], o.camera[i], `${label}: camera[${i}]`);
      // ---- sounds / speech
      const a = G.log, b = o.log;
      let same = a.length === b.length;
      for (let i = 0; same && i < a.length; i++) {
        if (a[i].length !== b[i].length) same = false;
        else for (let k = 0; k < a[i].length; k++) if (typeof a[i][k] === 'number' ? !(Math.abs(a[i][k] - b[i][k]) <= 1e-4 * Math.max(1, Math.abs(b[i][k]))) : a[i][k] !== b[i][k]) same = false;
      }
      checked++;
      if (!same) bad(`${label}: sound / speech calls: port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`);
      for (const e of a) count(e[0] === 'say' ? 'say' : `snd:${e[0]}`);
      // ---- random draws
      eqj(G.draws, origDraws, `${label}: random draws`);
      eq(G.U.pos, u1, `${label}: random sequence position`);
      // visited states
      for (let i = 0; i < 3; i++) { const k = `snake${node.states[i]}`; stats.states[k] = (stats.states[k] ?? 0) + 1; }
      return true;
    };

    // ---------------------------------------------------------------- the constructor's emitters (FUN_00659d94: two FUN_00442960 calls, then FUN_00442a20(handle, 1, 1, 1) each): names, offsets, rotation, gate from the executable's code
    {
      const G = bootSsh(ctx, { seed: 1, dt: 1 });
      const pe = G.pe, st = G.fxStarts;
      eq(st.length, 2, 'two emitters started');
      const f32 = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
      const wantPos = [[0x3fda3d71, 0x3f9e5604, 0x3d27ef9e], [0xbfe0e560, 0x3fa020c5, 0x3c83126f]];
      for (let i = 0; i < 2; i++) {
        eq(st[i].name.toLowerCase(), pe.cstr(0x91c8a4 + i * 12).toLowerCase(), `emitter ${i}: name`);
        eqj(st[i].pos, wantPos[i].map(f32), `emitter ${i}: offset`);
        eqj([...st[i].rot, ...st[i].gate], [0, 0, 0, 1, 1, 1], `emitter ${i}: rotation, gate`);
        eq(st[i].rec, REC.CART, `emitter ${i}: parent = the buggy's matrix`);
      }
      // the immediates of the call sites are the ones above
      for (const u of wantPos.flat()) { let f = false; for (let a = 0x659e80; a < 0x659f40 && !f; a++) if (pe.u32(a) === u) f = true; ok(f, `immediate ${u.toString(16)} in the constructor`); }
      // every update starts with both gates ON (FUN_00442a20(handle, 2, 1, 1)); the log comparison of the whole game covers it too
      G.log.length = 0; G.tick(0);
      eqj(G.log.filter((e) => e[0] === 'fx'), [['fx', 0x3000, 2, 1, 1], ['fx', 0x3001, 2, 1, 1]], 'the first tick switches both emitters on');
    }
    // ---------------------------------------------------------------- the crosshair FUN_0065817c (screen sizes 640x480 .. 1280x800, random aim and pitch, the pitch wrap below -pi)
    {
      const G = bootSsh(ctx, { seed: 1, dt: 1 });
      H.G = G; H.buildPaths(G.arch);
      const rnd = rngOf(909);
      let n = 0, bad1 = 0;
      for (let k = 0; k < 600; k++) {
        const [W, Hh] = [[640, 480], [800, 600], [1024, 768], [1280, 800], [1920, 1080]][k % 5];
        const yaw = f32((rnd() - 0.5) * 2.6), pit = f32((rnd() - 0.5) * 1.6), rx = f32(k % 4 === 0 ? -3.0 - rnd() * 0.7 : (rnd() - 0.5) * 1.2);
        // the node fields the port's crosshair reads: aimYaw / aimPitch, and the record's pitch (+0x4c)
        G.node.aimYaw = yaw; G.node.aimPitch = pit; G.cart.rx = rx;
        const o = H.crosshair(yaw, pit, rx, W, Hh);
        const c = G.node.crosshair(G.cart, W, Hh);
        n++;
        checked += 2;
        if (c.x !== o.x || c.y !== o.y) { bad1++; bad(`crosshair ${W}x${Hh} yaw ${yaw} pitch ${pit} rx ${rx}: port ${JSON.stringify(c)}, original ${o.x},${o.y}`); }
      }
      notes.push(`crosshair: ${n} random aims on 5 screen sizes, ${bad1} mismatches`);
    }

    // ---------------------------------------------------------------- scenario machinery
    const arch = ctx.archives.find((a) => a.name === 'z15SSH');
    const tFor = makeTFor(arch);

    const summary = (G) => ({
      st: G.node.states.slice(), tm: G.node.timers.map((t) => (t === 0 ? 0 : t === 1 ? 1 : 2)), gems: G.node.gems, score: G.node.score,
      nco: G.node.coconuts.filter((c) => c.active).length, stage: G.node.stage, res: G.node.result, flinch: G.node.flinch, z: G.cart.z, speed: G.node.speed,
    });
    /** the events of one tick (from the summaries before / after and the port's call log): the plan picks the ticks around the rare ones */
    const events = (a, b, log, mask, pressed) => {
      const ev = [];
      for (let i = 0; i < 3; i++) {
        if (a.st[i] !== b.st[i]) ev.push(`snake:${a.st[i]}>${b.st[i]}${a.st[i] === 3 && a.tm[i] === 1 ? 'x' : ''}`);
        if (b.st[i] === 3 && a.tm[i] === 0 && b.tm[i] === 1) ev.push('hitleap');
      }
      if (b.gems !== a.gems) ev.push('theft');
      if (b.score !== a.score) ev.push('hit');
      if (b.nco > a.nco) ev.push('shot');
      if (b.nco < a.nco && b.score === a.score) ev.push('cocoend');
      if (b.stage !== a.stage) ev.push(`stage${b.stage}`);
      if (b.res !== a.res) ev.push(`result${b.res}`);
      if (b.flinch !== a.flinch) ev.push('flinch');
      if ((a.z < 3750) !== (b.z < 3750) || (a.z < 5020) !== (b.z < 5020)) ev.push('cartwindow');
      if (a.speed > 0 && b.speed === 0) ev.push('stopped');
      if (log.some((e) => e[0] === 'say')) ev.push('say');
      if (log.some((e) => e[0] === 'p' && (e[1] === SND.SKID_LARGE || e[1] === SND.SKID_SMALL))) ev.push('skid');
      if (pressed) ev.push('press');
      return ev;
    };
    const RARE = /^(snake|theft|hit|stage|result|flinch|cartwindow|stopped|say|skid|shot|cocoend)/;

    /**
     * a scenario = { name, seed, dt, setup(G, rnd), input(G, i, rnd) -> button mask, ticks, until(G, i) -> stop, every, budget }. Pass 1 plays the port alone and
     * records the inputs and the events of every tick; pass 2 replays them on a fresh world and compares the selected ticks against the original.
     */
    const runScenario = (spec) => {
      const label = `${spec.name} dt ${spec.dt}`;
      const mk = () => { const G = bootSsh(ctx, { seed: spec.seed ?? 1, dt: spec.dt }); const rnd = rngOf((spec.seed ?? 1) * 31 + 7), irnd = rngOf((spec.seed ?? 1) * 53 + 11); const inp = spec.input ? spec.input(G, irnd) : () => 0; spec.setup?.(G, rnd); return { G, inp }; };
      const P = mk();
      const masks = [], evs = [];
      let prev = summary(P.G), done = -1;
      const maxT = spec.ticks ?? 14000;
      for (let i = 0; i < maxT; i++) {
        const m = P.inp(P.G, i);
        P.G.log.length = 0;
        const pressed = (m ^ P.G.w.input.held) & m & KEY.FIRE;
        P.G.tick(m);
        const cur = summary(P.G);
        masks.push(m); evs.push(events(prev, cur, P.G.log, m, pressed));
        prev = cur;
        if (spec.until?.(P.G, i) && done < 0) done = i + (spec.after ?? 40);
        if (done >= 0 && i >= done) break;
      }
      const n = masks.length;
      // selection
      const sel = new Set();
      const budget = spec.budget ?? 200;
      for (let i = 0; i < Math.min(n, spec.head ?? 4); i++) sel.add(i);
      const byKind = new Map();
      evs.forEach((ev, i) => { for (const e of ev) if (RARE.test(e)) { if (!byKind.has(e)) byKind.set(e, []); byKind.get(e).push(i); } });
      const rnd = rngOf((spec.seed ?? 1) * 977 + 3);
      const kinds = [...byKind.keys()].sort();
      const used = new Map(kinds.map((k) => [k, new Set()]));
      let guard = 0;
      // round robin over the event kinds, a random not yet used occurrence each, the tick and its neighbours
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
      // replay
      const Q = mk();
      let cmp = 0;
      for (let i = 0; i < n; i++) {
        if (sel.has(i)) {
          if (!step(Q.G, masks[i], `${label} tick ${i}`)) break;
          cmp++;
          for (const e of evs[i]) count(e.replace(/^stage\d$/, 'stage'));
        } else { Q.G.log.length = 0; Q.G.tick(masks[i]); }
      }
      return { n, cmp, G: Q.G };
    };
    const results = [];
    const run = (spec) => {
      for (const dt of spec.dts ?? [1, 0.5]) {
        const t0 = Date.now();
        const r = runScenario({ ...spec, dt, ticks: spec.ticks ? (spec.fixed ? spec.ticks : Math.round(spec.ticks / dt)) : undefined, head: spec.head, budget: spec.budget });
        results.push({ name: spec.name, dt, n: r.n, cmp: r.cmp, gems: r.G.node.gems, score: r.G.node.score, result: r.G.node.result, ms: Date.now() - t0 });
      }
    };
    const FIRE = KEY.FIRE;
    const done = (G) => G.node.result !== 0;

    // ---------------------------------------------------------------- the constructor's placements: FUN_00445680 (native) against `placeOnPath` of the port
    {
      const G = bootSsh(ctx, { seed: 1, dt: 1 });
      H.G = G; H.buildPaths(G.arch);
      const PH = H.pathHandles;
      const cases = [[PH.bd2c, K.START_T, REC.CART], [PH.bd30, K.CRT_T[0], REC.CRT[0]], [PH.bd30, K.CRT_T[1], REC.CRT[1]], [PH.bd30, K.CRT_T[2], REC.CRT[2]],
        [PH.bd38, K.SNAKE_T[0], REC.SNAKE[0]], [PH.bd3c, K.SNAKE_T[1], REC.SNAKE[1]], [PH.bd40, K.SNAKE_T[2], REC.SNAKE[2]]];
      for (const [h, t, ri] of cases) {
        const m = H.placeOnPath(h, t);
        for (let k = 0; k < 15; k++) num('placement', G.R[ri].m[k], m[k], `the constructor's placement of record ${ri}: m[${k}]`);
      }
      // the handles of FUN_0065a470 against the port's SND table (ids)
      const hs = H.soundHandles;
      const want = { bd78: SND.FOUNTAIN, bd84: SND.WATERFALL, bd58: SND.TRAIN, bd74: SND.SNAKE_MOVE, bd80: SND.SNAKE_JUMP, bd5c: SND.SNAKE_GET_GEM, bd4c: SND.SNAKE_HIT, bd64: SND.ENGINE, bd68: SND.WIND,
        bd60: SND.AMBIENT, bd70: SND.OVER_STUDS, bd88: SND.GUN, bd8c: SND.SKID_LARGE, bd6c: SND.SKID_SMALL, bd54: SND.GUN_SWIVEL, bd50: SND.GUN_TILT, bd7c: SND.UNDER_TRACK };
      for (const [k, id] of Object.entries(want)) eq(id, hs[k], `sound id of DAT_05d5${k} (FUN_0065a470)`);
      // the unused-record check of the builder: the zone's record names
    }

    // ---------------------------------------------------------------- the path code: projection and frame at many points (spline.ts against FUN_00447550 / 004466f0, 4 files)
    {
      const G = bootSsh(ctx, { seed: 1, dt: 1 });
      H.G = G; H.buildPaths(G.arch);
      const PH = H.pathHandles;
      const files = [['CARBUT', PH.bd2c, G.node.b.paths.cart], ['cartpos1', PH.bd30, G.node.b.paths.crt], ['SNAKEPOSL', PH.bd3c, G.node.b.paths.snakes[1]], ['SNAKEPOSR', PH.bd40, G.node.b.paths.snakes[2]]];
      const rnd = rngOf(4242);
      const fr = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
      let nproj = 0, mism = 0;
      const worst = { t: 0, frame: 0 };
      for (const [name, h, sp] of files) {
        // the plane table of FUN_00447280 (tangent and dot product per control point) against the port's
        {
          const TB = H.mem.u32(0x9e586c), obj = H.mem.u32(H.mem.u32(TB + h * 4) + 0x24), tab = H.mem.u32(obj + 4);
          let bad4 = 0;
          for (let i = 0; i < sp.n * 4; i++) { checked++; if (H.mem.f32(tab + i * 4) !== sp.table[i]) { if (bad4++ < 3) bad(`${name} plane table [${i}]: port ${sp.table[i]}, original ${H.mem.f32(tab + i * 4)}`); } }
        }
        for (let k = 0; k < 450; k++) {
          // points: on the curve, beside it (lateral 0..10, up to 6 above / below), and a few far away / beyond the ends
          const t0 = k < 40 ? k / 39 : rnd() * 1.02 - 0.01;
          sp.eval(Math.min(1, Math.max(0, t0)), fr);
          const sc = k % 5 === 0 ? 0 : k % 7 === 0 ? 60 : 8;
          const p = [Math.fround(fr.pos[0] + (rnd() - 0.5) * sc), Math.fround(fr.pos[1] + (rnd() - 0.5) * sc * 0.6), Math.fround(fr.pos[2] + (rnd() - 0.5) * sc)];
          const o = H.project(h, p);
          const t = sp.project(p);
          nproj++;
          const dt = Math.abs(t - o.t);
          worst.t = Math.max(worst.t, dt);
          checked++;
          if (!(dt <= 0) || (sp.atEnd ? 1 : 0) !== o.end || sp.lo !== o.lo || sp.hi !== o.hi) { mism++; bad(`${name} projection of [${p}]: port t ${t} end ${sp.atEnd} lo/hi ${sp.lo}/${sp.hi}, original t ${o.t} end ${o.end} lo/hi ${o.lo}/${o.hi}`); }
          // the frame at t (the original's float32 argument)
          const tf = Math.fround(Math.min(1, Math.max(0, t0)));
          const m = H.placeOnPath(h, tf);
          sp.eval(tf, fr);
          const got = [...fr.right, 0, ...fr.up, 0, ...fr.fwd, 0, ...fr.pos];
          let w = 0;
          for (let i = 0; i < 15; i++) w = Math.max(w, Math.abs(got[i] - m[i]) / Math.max(1, Math.abs(m[i])));
          worst.frame = Math.max(worst.frame, w);
          checked++;
          if (!(w <= 0)) bad(`${name} frame at t ${tf}: port ${got.map((v) => +v.toFixed(5))}, original ${m.slice(0, 15).map((v) => +v.toFixed(5))}`);
        }
      }
      notes.push(`paths: ${nproj} projections (t, end flag, segment pair), ${nproj} frames; worst |dt| ${worst.t.toExponential(2)}, worst frame error ${worst.frame.toExponential(2)}, ${mism} mismatches`);
    }

    // ---------------------------------------------------------------- scenarios
    const bot = () => { const b = new SshBot(); return (G) => b.mask(G.node, G.cart, G.R, G.parts); };
    /** the buggy's path parameter now (for the snakes' places behind it) */
    const tOfCart = (G) => G.node.b.paths.cart.project([G.cart.x, G.cart.y, G.cart.z]);
    /** random held keys: a direction held for 3..40 ticks, Space pressed now and then */
    const randomKeys = (pFire = 0.15) => (G, i, r) => {
      const st = randomKeys.st ?? (randomKeys.st = {});
      void st; return 0;
    };
    const keyGen = (irnd, pFire) => {
      let hold = 0, dirs = 0, fire = 0;
      return (G, i) => {
        if (hold-- <= 0) { hold = 3 + irnd.int(38); dirs = 0; for (const k of [KEY.L, KEY.R, KEY.U, KEY.D]) if (irnd() < 0.3) dirs |= k; if ((dirs & 3) === 3) dirs &= ~irnd.pick([1, 2]); if ((dirs & 12) === 12) dirs &= ~irnd.pick([4, 8]); }
        fire = irnd() < pFire ? FIRE : 0;
        return dirs | fire;
      };
    };
    /** put the snakes / coconuts / node into a random but consistent state (the branches the ordinary rides reach rarely) */
    const inject = (G, rnd) => {
      const n = G.node, R = G.R, b = n.b, cart = G.cart;
      const tc = tOfCart(G);
      n.speed = rnd.pick([0, K.MAX_SPEED, f32(rnd() * K.MAX_SPEED), K.MAX_SPEED]);
      n.gems = rnd.int(21); n.score = 50 * rnd.int(40);
      n.aimYaw = f32((rnd() - 0.5) * 2.4); n.aimPitch = f32((rnd() - 0.5) * 1.4);
      n.wheel = f32(rnd() * 6); n.prevYaw = f32(rnd() * 0.3); n.stage = rnd.int(7); n.flinch = rnd() < 0.3;
      n.time = f32(rnd() * 3000); n.reload = rnd.pick([0, 0, 1, 3, 6, 7]);
      G.cart.variant = rnd.pick([0, 0, 300 << 16, 900 << 16, 1100 << 16]);
      R[REC.PIPP].anim.start(rnd.pick([1, 2, 3]), rnd.int(20)); R[REC.JOHN].anim.start(1, rnd.int(29));
      const hot = [];
      for (let i = 0; i < 3; i++) {
        const sn = R[REC.SNAKE[i]], st = rnd.pick([0, 1, 1, 2, 3, 3]);
        n.states[i] = st;
        n.timers[i] = 0;
        if (st !== 0) {
          placeOnPath(sn, b.paths.snakes[i], Math.max(0.001, tc - 0.004 - rnd() * 0.03));
          if (st === 3) { sn.m[12] = f32(cart.x + (rnd() - 0.5) * 14); sn.m[14] = f32(cart.z - 3 - rnd() * 40); }
          sn.flags |= 2;
          sn.anim.start(st === 1 ? 3 : st === 3 ? 2 : 1, rnd.int(st === 1 ? 16 : st === 3 ? 46 : 13));
          if (st === 3) { n.saved[i] = [f32(sn.x - rnd() * 5), f32(sn.y), f32(sn.z - rnd() * 5)]; if (rnd() < 0.4) n.timers[i] = 1; }
          if (st === 1 && rnd() < 0.15) n.timers[i] = f32(1.5);
          if (st !== 2) hot.push(sn);
        } else {
          sn.flags &= ~2;
          const limit = 30;
          n.timers[i] = rnd.pick([0, 5, limit - 1, limit, limit + 0.5, 20, 29.5]);
        }
      }
      for (const c of n.coconuts) c.active = false;
      const nc = rnd.int(6);
      for (let k = 0; k < nc; k++) {
        const c = n.coconuts[k];
        c.active = true;
        c.m.set(cart.m);
        const tgt = hot.length && rnd() < 0.6 ? rnd.pick(hot) : cart;
        c.m[12] = f32(tgt.x + (rnd() - 0.5) * 12); c.m[13] = f32(tgt.y + (rnd() - 0.5) * 6); c.m[14] = f32(tgt.z + (rnd() - 0.5) * 12);
        const a = rnd() * 6.28, e = (rnd() - 0.5) * 0.8;
        c.vel = [f32(-K.COCO_SPEED * Math.cos(e) * Math.sin(a) * 0.5), f32(K.COCO_SPEED * Math.sin(e) * 0.5), f32(K.COCO_SPEED * Math.cos(e) * Math.cos(a) * 0.5)];
        c.birth = Math.trunc(n.time) - rnd.int(540);
      }
      for (const r of R) r.savePrev();
    };
    const jump = (z) => (G) => { G.node.jumpTo(G.w, tFor(z)); G.node.speed = K.MAX_SPEED; };
    const quiet = (G) => { G.node.timers = [-1e9, -1e9, -1e9]; };

    // 1. no input: the whole ride, snakes spawn / run / leap / steal, the end of the ride
    run({ name: 'ride, no input', seed: 11, input: () => () => 0, until: done, budget: 100 });
    // 2. an aiming bot: hits on running and leaping snakes, coconuts, speech, medals
    run({ name: 'ride, aiming bot', seed: 12, input: () => bot(), until: done, budget: 100 });
    // 3. Space every 8 ticks
    run({ name: 'ride, Space every 8', seed: 13, input: () => (G, i) => (i % 8 === 0 ? FIRE : 0), until: done, budget: 60 });
    // 4. random keys from random places on the course
    for (const seed of [21, 22, 23]) {
      run({ name: `random keys ${seed}`, seed, input: (G, rnd) => keyGen(rnd, 0.2), setup: (G, rnd) => { G.node.jumpTo(G.w, 0.05 + rnd() * 0.85); G.node.speed = K.MAX_SPEED; }, ticks: 420, budget: 30, head: 2 });
    }
    // 5. the end of the ride with 0 / 11 / 12 / 17 / 18 / 20 gems, with a snake still running, at the end flag of the path (z < 7000)
    for (const [gems, dts] of [[0, [1, 0.5]], [11, [1]], [12, [1, 0.5]], [17, [1]], [18, [1]], [20, [1]]]) {
      run({ name: `end, ${gems} gems`, seed: 30 + gems, dts, setup: (G) => { jump(6975)(G); quiet(G); G.node.gems = gems; G.node.score = 400; }, until: done, after: 2, all: true, ticks: 140, budget: 100 });
    }
    run({ name: 'end, a snake still running', seed: 40, setup: (G) => { jump(6975)(G); quiet(G); G.node.states[0] = SN.RUN; G.R[REC.SNAKE[0]].flags |= 2; }, ticks: 40, all: true, budget: 60 });
    run({ name: 'end, path end flag', seed: 41, setup: (G) => { G.node.jumpTo(G.w, 0.9985); G.node.speed = K.MAX_SPEED; quiet(G); }, until: done, after: 2, ticks: 140, all: true, budget: 100 });
    // 6. the course: the carts' window (3750 .. 5020) and the sound stages (4402, 4813, 6166, 6276, 6320, 6407)
    for (const z of [3740, 4395, 4806, 5012, 6160, 6270, 6314, 6400]) {
      run({ name: `course z ${z}`, seed: 50 + (z % 97), setup: (G) => { jump(z)(G); quiet(G); }, ticks: 8, all: true, budget: 20 });
    }
    // 7. the snakes' waiting time by the difficulty word (variant >> 16)
    for (const v of [0, 900, 1100]) {
      run({ name: `difficulty ${v}`, seed: 60 + v % 7, setup: (G) => { G.cart.variant = v << 16; }, ticks: 24, budget: 36, all: true });
    }
    // 8. random states: every snake state with timers / clips / places, coconuts in flight near the snakes, random node values, random keys
    for (let seed = 100; seed < 130; seed++) {
      run({ name: `random state ${seed}`, seed, input: (G, rnd) => keyGen(rnd, 0.4), setup: (G, rnd) => { G.node.jumpTo(G.w, 0.1 + rnd() * 0.8); for (let i = 0; i < 4; i++) G.tick(0); inject(G, rnd); }, ticks: 8, fixed: true, all: true, budget: 8, dts: [seed % 2 ? 1 : 0.5] });
    }
        // ---- the pose range question (docs/re/gaps.md Z): the port poses animated records within `poseRange` 500 of the eye, the original every drawn record. How far from the eye is a SHOWN
    // snake (flag 2) at its farthest in whole rides (port only, no emulation)? Below 500 the range never excludes one.
    {
      let far = 0, farAt = '', gone = 0, shown = 0;
      const rides = [['no input', () => () => 0], ['aiming bot', () => bot()], ['Space every 8', () => (G, i) => (i % 8 === 0 ? FIRE : 0)], ['bot that stops at 3000', () => { const f = bot(); return (G, i) => (i < 3000 ? f(G) : 0); }]];
      for (const [name, mkInput] of rides) {
        const G = bootSsh(ctx, { seed: 77, dt: 1 });
        const inp = mkInput();
        let worst = 0;
        for (let i = 0; i < 6000 && G.node.result === 0; i++) {
          G.tick(inp(G, i));
          const e = G.w.camera.c;
          for (const ri of REC.SNAKE) { const r = G.R[ri]; if (r.flags & 2) { shown++; if (r.y > 1e6) { gone++; continue; } worst = Math.max(worst, Math.hypot(r.x - e[0], r.y - e[1], r.z - e[2])); } }
        }
        if (worst > far) { far = worst; farAt = name; }
      }
      ok(far < 500, `pose range: a shown snake (on the ground) is ${far.toFixed(0)} from the eye at most (${farAt})`);
      notes.push(`pose range: the farthest shown snake in 4 whole rides is ${far.toFixed(0)} units from the eye (< poseRange 500: nothing visible is left in the bind pose); ${gone} of ${shown} shown snake-ticks had y = 4.29e9 (no ground under the snake: the unsigned conversion of the original, far outside the view)`);
    }

    // ---- summary + coverage
    const groups = new Map();
    for (const r of results) { const g = r.name.replace(/^(course z|difficulty|random state|random keys) \d+$/, '$1').replace(/^end, \d+ gems$/, 'end of the ride (gems 0 .. 20)').replace(/^ride, Space every 8$/, 'ride, Space every 8'); const k = `${g} dt ${r.dt}`; const o = groups.get(k) ?? { runs: 0, n: 0, cmp: 0 }; o.runs++; o.n += r.n; o.cmp += r.cmp; groups.set(k, o); }
    for (const [k, o] of groups) notes.push(`${k}: ${o.runs} run(s), ${o.n} ticks played, ${o.cmp} compared against the original`);
    notes.push(`total: ${stats.ticks} ticks compared, ${(stats.steps / 1e6).toFixed(0)} M original instructions, ${stats.ms} ms of emulation`);
    notes.push(`snake states seen (snake-ticks): ${JSON.stringify(stats.states)}`);
    notes.push(`events in the compared ticks: ${JSON.stringify(Object.fromEntries(Object.entries(stats.ev).sort()))}`);
    const need = ['snake:0>1', 'snake:1>3', 'snake:1>2', 'snake:3>0', 'snake:3>0x', 'snake:2>0', 'theft', 'hit', 'hitleap', 'shot', 'cocoend', 'say', 'skid', 'flinch', 'stopped', 'result1', 'result3', 'result4', 'result5', 'stage', 'cartwindow', 'press', 'snd:p3', 'snd:s3', 'snd:r', 'snd:v'];
    for (const k of need) ok((stats.ev[k] ?? 0) > 0, `coverage: no compared tick with the event ${k}`);
    ok(stats.states.snake0 > 0 && stats.states.snake1 > 0 && stats.states.snake2 > 0 && stats.states.snake3 > 0, 'coverage: every snake state');
    notes.push(`max normalised errors (port vs original, tolerance ${TOL}): ${JSON.stringify(Object.fromEntries(Object.entries(maxErr).map(([k, v]) => [k, +v.toExponential(2)])))}`);
    return { checked, failures, notes };
  },
};
