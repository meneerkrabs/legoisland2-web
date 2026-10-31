import { loadBpk } from '../lib/bpk-load.mjs';
import { bpkBotStep, bpkSnapshot } from '../lib/bpk-bot.mjs';
import { createHarness, emuPass, snapshotWorld, restoreWorld, nativeSweep, emuSpectators, emuSetupCamera, emuText, f32 } from '../lib/m7-z01BPK-emu.mjs';
import { spectatorsTick } from '../../src/zones/z01bpk/setup.ts';
import { TRICK_NAMES } from '../../src/zones/z01bpk/run.ts';
import { bannerLines } from '../../src/zones/z01BPK.ts';
import { B } from '../../src/game/input.ts';
import { TRICKS } from '../../src/zones/z01bpk/skate.ts';

// z01BPK, differential test (docs/re/m6/z01BPK.md section "Differential test (WP-VERIFY)"): the ORIGINAL update functions of Pepper's chain in the zone (the clock FUN_00493dd8 with
// FUN_00493ba0 / FUN_00493ecd, the walk FUN_00494190, the skateboard FUN_00490e2e with FUN_004900d4 / FUN_0048f66d / FUN_0048e840 / FUN_00490cd2 / FUN_00490af4 / FUN_0048fece and the
// collision sweep FUN_00441270 on the .col objects of the original loader) run in the x86 emulation (tools/lib/m7-z01BPK-emu.mjs) from the port's state of every compared tick;
// the port then runs the same tick from that state. Compared: return codes / which nodes ran, the records (matrix, Euler, flags), every node field, the zone globals, the camera, the
// animation state of Pepper and the board, the game variables, the HUD texts and the sound calls. dt is a parameter (1 and 0.5).

const KEYS = [B.LEFT, B.RIGHT, B.UP, B.DOWN];
function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  return { next, int: (n) => Math.trunc(next() * n), pick: (a) => a[Math.trunc(next() * a.length)] };
}

const FLOAT_FIELDS = new Set(H_SK_FLOATS());
function H_SK_FLOATS() { return ['t', 'spin', 'trickRate', 'speed', 'maxSpeed', 'charge', 'y0', 'jumpY', 'v0', 'vy', 'progress', 'vx', 'vyv', 'vz', 'pipeN0', 'pipeN1', 'pipeN2', 'pipeSpeed']; }

export default {
  name: 'm7-z01BPK-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = 40;
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const maxErr = {}, inexact = {}, inexactMax = {};
    let nums = 0;
    const TOL = 0, TOL_CAMERA = 0, ABS = 0;     // bit-exact: every float of the port equals the original's (WP-TIME: skate.ts / run.ts are float32 per operation)
    const num = (a, b, msg, cls = 'x') => {
      checked++;
      const tol = cls === 'camera' ? TOL_CAMERA : TOL;
      const e = Math.abs(a - b), t = tol * Math.max(1, Math.abs(b)) + ABS;
      const rel = e / t;
      if (!(rel <= (maxErr[cls] ?? 0)) && !Number.isNaN(rel)) maxErr[cls] = rel;
      if (!(e <= t) && !(Number.isNaN(a) && Number.isNaN(b))) bad(`${msg}: port ${a}, original ${b}`);
      // bit exactness (as float32): counted per field, so the places where the port is not bit-identical are visible
      if (f32(a) !== f32(b) && !(Number.isNaN(a) && Number.isNaN(b))) { const k = msg.replace(/^.*?: /, '').replace(/\[\d+\]/, '[]'); inexact[k] = (inexact[k] ?? 0) + 1; if (process.env.BPK_INEXACT && (inexact[k] <= 3) && k.startsWith(process.env.BPK_INEXACT)) notes.push(`INEXACT ${msg}: port ${a} original ${b}`); inexactMax[k] = Math.max(inexactMax[k] ?? 0, rel); }
      nums++;
    };
    const eq = (a, b, msg) => { checked++; if (a !== b) bad(`${msg}: port ${a}, original ${b}`); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const stats = { ticks: 0, states: new Set(), clips: new Set(), flags: {}, ms: 0 };
    const hit = (k) => { stats.flags[k] = (stats.flags[k] ?? 0) + 1; };

    /** a world + harness for the step dt (built once per dt, every scenario starts from the same restored state) */
    const worlds = new Map();
    const make = (dt = 1) => {
      let W = worlds.get(dt);
      if (!W) {
        const G = loadBpk(ctx);
        G.w.vars.set(0x59, 1);          // CURRENT_SUBGAME == 1: the park's branches of the shared functions
        G.w.dt = dt;
        const H = createHarness(ctx, G);
        W = { G, H, dt, base: snapshotWorld(G) };
        worlds.set(dt, W);
      }
      restoreWorld(W.G, W.base);
      W.G.sounds.length = 0;
      return W;
    };

    /** one tick: the original from the state, restore, the port from the same state, compare */
    const step = (S, held, label) => {
      const { G, H } = S, w = G.w, g = G.g;
      const prev = w.input.held, pressed = (held ^ prev) & held;
      const clockRuns = w.vars.get(0x5e) === 4;          // the clock (and its texts) runs while PEPPER_CONTROL == 4 at the start of the tick
      const s0 = snapshotWorld(G);
      const dumping = process.env.BPK_DUMP && label.includes(process.env.BPK_DUMP);
      const hits0 = dumping ? { ...H.hits } : null;
      let o;
      const t0 = Date.now();
      try { o = emuPass(H, held, pressed); } catch (e) { bad(`${label}: the original failed: ${e.message}`); H.reset(); restoreWorld(G, s0); return false; }
      stats.ms += Date.now() - t0;
      if (dumping) {
        const P = g.pepper, sk = g.skate;
        const d = {}; for (const [k, v] of Object.entries(H.hits)) if (v !== (hits0[k] ?? 0)) d[k] = v - (hits0[k] ?? 0);
        notes.push(`DUMP ${label}: before state 0x${sk.state.toString(16)} pos ${[P.x, P.y, P.z].map((v) => v.toFixed(3))} ry ${P.ry} speed ${sk.speed} spin ${sk.spin} t ${sk.t} onPipe ${sk.onPipe} grounded ${sk.grounded} clip ${P.anim.clip}; original ry ${o.pepper.e[1]} state ${o.skate.state.toString(16)} sweeps ${JSON.stringify(d)}`);
      }
      if (dumping) {
        // the original again with a trace of every change of Pepper's yaw (+0x50) and position
        restoreWorld(G, s0);
        const P = H.recPtr(g.pepper); let last = null;
        H.trace = (c, at) => { const v = H.mem.f32(P + 0x50), x = H.mem.f32(P + 0x3c); if (last !== null && (v !== last.v || x !== last.x)) notes.push(`  [${label}] at 0x${at.toString(16)} frames ${c.frames.slice(-3).map((f) => f.toString(16))}: ry ${last.v} -> ${v}, x ${last.x} -> ${x}`); last = { v, x }; };
        try { emuPass(H, held, pressed); } catch (e) { notes.push(`  trace failed ${e.message}`); }
        H.trace = null;
      }
      restoreWorld(G, s0);
      G.sounds.length = 0;
      G.step(held);
      const sounds = G.sounds.slice();
      stats.ticks++;
      compare(S, o, sounds, label, clockRuns);
      const sk = g.skate;
      stats.states.add(sk.state); stats.clips.add(g.pepper.anim?.clip);
      return true;
    };

    const compare = (S, o, sounds, label, clockRuns) => {
      const { G, H } = S, w = G.w, g = G.g, P = g.pepper;
      // which nodes ran
      const ranPort = P.ctrl.ran.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).join();
      const ranOrig = o.ran.map((v, i) => (v ? i : -1)).filter((i) => i >= 0).join();
      eq(ranPort, ranOrig, `${label}: nodes that ran`);
      // records: matrix, Euler, flags of every record
      for (let i = 0; i < w.records.length; i++) {
        const r = w.records[i], q = o.recs[i];
        const important = r === P || r === g.board;
        for (let k = 0; k < 16; k++) num(r.m[k], q.m[k], `${label}: record ${i} ${r.name} m[${k}]`, important ? 'rec' : 'other');
        if (important) { num(r.rx, q.e[0], `${label}: record ${i} rx`, 'euler'); num(r.ry, q.e[1], `${label}: record ${i} ry`, 'euler'); num(r.rz, q.e[2], `${label}: record ${i} rz`, 'euler'); }
        eq(r.flags & 0xfffe, q.flags & 0xfffe, `${label}: record ${i} ${r.name} flags`);
      }
      // animations of Pepper and the board
      for (const r of [P, g.board]) {
        const q = o.anims[r.index];
        eq(r.anim.clip, q.clip, `${label}: ${r.name} anim clip`);
        num(r.anim.frame, q.frame, `${label}: ${r.name} anim frame`, 'frame');
      }
      // nodes
      const sk = H.tsSkate(g.skate), qs = o.skate;
      for (const k of Object.keys(sk)) {
        if (k === 'stamp') continue;
        if (FLOAT_FIELDS.has(k)) num(sk[k], qs[k], `${label}: skate.${k}`, 'node');
        else eq(sk[k], qs[k], `${label}: skate.${k}`);
      }
      const sw = H.tsSwc(g.swc), qw = o.swc;
      for (const k of Object.keys(sw)) { if (k === 'time' || k === 'score' || k === 'pending') num(sw[k], qw[k], `${label}: clock.${k}`, 'clock'); else eq(sw[k], qw[k], `${label}: clock.${k}`); }
      const wk = H.tsWalk(g.walk), qk = o.walk;
      for (const k of Object.keys(wk)) eq(wk[k], qk[k], `${label}: walk.${k}`);
      // globals
      const ga = H.tsGlobals(), gb = o.globals;
      num(ga.trickScore, gb.trickScore, `${label}: trick score`, 'node');
      eq(ga.trickFlag, gb.trickFlag, `${label}: trick flag`);
      eq(ga.mailbox, gb.mailbox, `${label}: mailbox`);
      eq(ga.surface, gb.surface, `${label}: surface at feet`);
      for (let i = 0; i < 6; i++) num(ga.camera[i], gb.camera[i], `${label}: camera[${i}]`, 'camera');
      // variables
      for (let i = 0; i < w.vars.a.length; i++) if ((w.vars.a[i] | 0) !== (o.vars[i] | 0)) { checked++; bad(`${label}: variable 0x${i.toString(16)}: port ${w.vars.a[i]}, original ${o.vars[i]}`); } else checked++;
      // texts: the clock writes them while PEPPER_CONTROL == 4
      if (clockRuns) {
        const t = o.texts;
        if (o.swc.time >= 0) eq(g.run.clockText, t.clock, `${label}: clock text`);
        eq(g.run.scoreText, t.score, `${label}: score text`);
        eq(g.run.trickText, t.trick, `${label}: stunt score text`);
      }
      // sounds: the original's calls in order against the port's recorder
      const mine = sounds.map((e) => (e.op === 'wheels' ? (e.on ? ['wheels', true, ...e.pos] : ['wheels', false]) : [e.op, e.id]));
      // sound 300 (DAT_05d5802c, FUN_00443580(300) = the silent slot): the original plays it at every launch off the ground, the port leaves the call out (z01BPK.md: nothing to hear); counted, not compared
      const orig = o.log.filter((e) => { if (e[0] === 'play' && e[1] === 300) { hit('sound 300 (silent) played by the original'); return false; } return e[0] !== 'anim'; });
      checked++;
      const same = mine.length === orig.length && mine.every((e, i) => e.length === orig[i].length && e.every((v, k) => (typeof v === 'number' && k >= 2 && e[0] === 'wheels' ? Math.abs(v - orig[i][k]) <= 1e-4 * Math.max(1, Math.abs(v)) : v === orig[i][k])));
      if (!same) bad(`${label}: sounds: port ${JSON.stringify(mine)} original ${JSON.stringify(orig)}`);
    };

    /** a seeded driver: arrows in random segments, Alt (crouch) bursts while rolling, a random stunt (or random keys) in the air */
    const driver = (rng, S) => {
      let arrows = 0, arrowsLeft = 0, altLeft = 0, airKeys = 0, airLeft = 0;
      return () => {
        const { G } = S, sk = G.g.skate, st = sk.state;
        if (G.w.vars.get(0x5e) !== 4) return 0;
        if (arrowsLeft-- <= 0) { arrows = 0; for (const k of KEYS) if (rng.next() < 0.3) arrows |= k; arrowsLeft = 3 + rng.int(40); }
        let held = arrows;
        if ((st === 0x29 || st === 0x2d) && altLeft <= 0 && rng.next() < 0.025) altLeft = 12 + rng.int(70);
        if (altLeft > 0) { held |= B.ALT; altLeft--; }
        if (st === 0x20) {
          if (airLeft-- <= 0) {
            const t = rng.pick(TRICKS);
            airKeys = rng.next() < 0.75 ? (t.button | (t.x === 'L' ? B.LEFT : t.x === 'R' ? B.RIGHT : 0) | (t.y === 'U' ? B.UP : t.y === 'D' ? B.DOWN : 0)) : rng.int(0x100) & (B.LEFT | B.RIGHT | B.UP | B.DOWN | B.CTRL | B.SHIFT | B.SPACE);
            airLeft = 4 + rng.int(70);
          }
          held = airKeys;
        } else airLeft = 0;
        return held;
      };
    };
    /** what the tick visited (counted from the port's state, which the comparison has just shown to equal the original's) */
    const visit = (S, before) => {
      const sk = S.G.g.skate, P = S.G.g.pepper;
      hit(`state 0x${sk.state.toString(16)}`);
      if (sk.onPipe) hit('on a half-pipe'); if (sk.spin !== 0) hit('pipe air spin'); if (sk.trickMid) hit('trickMid 1'); if (sk.locked) hit('locked (getting on / landing)');
      if (Math.abs(P.x) >= 39.89) hit('x wall'); if (P.z >= 23.99 || (P.z <= -23.99 && P.z > -24.01)) hit('z wall');
      if (before.state !== 0x20 && sk.state === 0x20) hit(sk.v0 === 30 ? 'launch v0 30 (ledge / pipe top)' : 'jump from a crouch');
      if (before.state === 0x21 && sk.state === 0x23) hit('crash'); if (before.trickFlag === 0 && S.G.g.run.trickFlag === 1) hit('landing judged good');
      if (sk.state === 0x20 && P.anim?.clip !== 0x20) hit(`stunt clip 0x${P.anim.clip.toString(16)}`);
      if (sk.progress > 100) hit('progress > 100');
      if (sk.maxSpeed > 0.75) hit('maxSpeed raised');
      if (sk.pipeN[1] < 0.6 && sk.pipeN[1] > 0 && sk.state === 0x20) hit('steep pipe wall in the air');
    };
    /** one scenario tick; `sparse`: the dull ticks (rolling on the floor, nothing happening) are only run in the port, every 6th is compared */
    const tickOf = (S, held, label, sparse, ctl) => {
      const sk = S.G.g.skate, P = S.G.g.pepper;
      const before = { state: sk.state, trickFlag: S.G.g.run.trickFlag };
      const dull = sparse && sk.state === 0x29 && !sk.onPipe && Math.abs(P.x) < 36.5 && Math.abs(P.z) < 21 && ctl.quiet > 5 && ctl.n % 6 !== 0;
      ctl.n++;
      if (dull) { S.G.step(held); ctl.quiet++; return true; }
      if (!step(S, held, label)) return false;
      visit(S, before);
      if (sk.state !== before.state || S.G.g.run.trickFlag !== before.trickFlag) ctl.quiet = 0; else ctl.quiet++;
      return true;
    };
    const runTicks = (S, n, drv, label, ctl) => {
      for (let i = 0; i < n; i++) {
        if (!tickOf(S, drv(), `${label} t${i}`, true, ctl)) return false;
        if (failures.length > MAXFAIL) return false;
      }
      return true;
    };
    const t0all = Date.now();
    /** a ride world: the walk-in and the mount run (and compared) up to the rolling state */
    const rideWorld = (dt, label) => {
      const S = make(dt);
      for (let i = 0; i < 700; i++) {
        if (!step(S, 0, `${label} intro t${i}`)) return null;
        visit(S, { state: S.G.g.skate.state, trickFlag: 0 });
        if (S.G.g.skate.state === 0x29) break;
      }
      return S;
    };
    const dirBits = (t) => (t.x === 'L' ? B.LEFT : t.x === 'R' ? B.RIGHT : 0) | (t.y === 'U' ? B.UP : t.y === 'D' ? B.DOWN : 0);
    const only = (process.env.BPK_ONLY ?? '').split(',').filter(Boolean);
    const want = (name) => !only.length || only.some((o) => name.startsWith(o));
    const scenario = (name, f) => { if (!want(name)) return; const t = Date.now(), n0 = stats.ticks; f(name); stats.byScenario.push(`${name}: ${stats.ticks - n0} ticks ${Date.now() - t} ms`); };
    stats.byScenario = [];
    try {
      for (const dt of [1, 0.5]) {
        // ---- 1. the walk-in and the mount, no input; the ride on its own after it (falls off the platform: the ledge launch)
        scenario(`walk-in dt ${dt}`, (name) => {
          const S = make(dt);
          for (let i = 0; i < (dt === 1 ? 420 : 760); i++) { if (!step(S, 0, `${name} t${i}`)) break; visit(S, { state: S.G.g.skate.state, trickFlag: 0 }); }
        });
        // ---- 2. walk-ins from other places / headings (turning, the facing tests, arrival) up to the push-off
        for (let seed = 1; seed <= (dt === 1 ? 3 : 1); seed++) scenario(`walk seed ${seed} dt ${dt}`, (name) => {
          const rng = makeRng(seed * 31 + dt * 7);
          const S = make(dt), { G } = S, P = G.g.pepper;
          P.x = -4 + rng.next() * 30; P.z = -40 + rng.next() * 8; P.y = 16; P.ry = (rng.next() - 0.5) * 6.28; P.rebuildYaw(); P.savePrev();
          for (let i = 0; i < 700; i++) { if (!step(S, 0, `${name} t${i}`)) break; visit(S, { state: G.g.skate.state, trickFlag: 0 }); if (G.g.skate.state === 0x2d) break; }
        });
        // ---- 3. random riding (seeded): arrows, crouch jumps, stunts, teleports around the arena (60 % towards a half-pipe)
        for (let seed = 1; seed <= (dt === 1 ? 2 : 1); seed++) scenario(`ride seed ${seed} dt ${dt}`, (name) => {
          const rng = makeRng(seed * 977 + dt * 13);
          const S = rideWorld(dt, name);
          if (!S) return;
          const { G } = S, P = G.g.pepper, ctl = { quiet: 0, n: 0 };
          const drv = driver(rng, S);
          const n = +process.env.BPK_N || (dt === 1 ? 1000 : 1300), segs = 5;
          for (let seg = 0; seg < segs && failures.length <= MAXFAIL; seg++) {
            if (seg > 0 && G.g.skate.state === 0x29) {
              if (rng.next() < 0.6) { const side = rng.next() < 0.5 ? 1 : -1; P.x = (rng.next() * 2 - 1) * 30; P.z = side * (6 + rng.next() * 8); P.ry = (side > 0 ? 0 : Math.PI) + (rng.next() - 0.5) * 0.6; }
              else { P.x = (rng.next() * 2 - 1) * 36; P.z = (rng.next() * 2 - 1) * 20; P.ry = rng.next() * 6.28; }
              P.y = 4; P.rebuildYaw(); P.savePrev(); ctl.quiet = 0;
            }
            runTicks(S, Math.floor(n / segs), drv, `${name} seg ${seg}`, ctl);
          }
        });
      }
      // ---- 4. every stunt of the table: crouch (charge), jump, the stunt held / released at several progress values, the landing (pass or crash)
      for (const dt of [1, 0.5]) scenario(`stunts dt ${dt}`, (name) => {
        const S = rideWorld(dt, name);
        if (!S) return;
        const { G } = S, base = snapshotWorld(G);
        const variants = dt === 1 ? [{ release: 80, crouch: 1.2 }, { release: Infinity, crouch: 1.2, hold: true }] : [{ release: 80, crouch: 1.2 }];
        for (const [ti, t] of TRICKS.entries()) for (const [vi, v] of variants.entries()) {
          if (vi === 1 && ti % 4) continue;                  // the held-to-the-landing variant (crash / pass by progress) for every fourth stunt
          if (dt !== 1 && ti % 3) continue;
          restoreWorld(G, base);
          const plan = { trick: { button: t.button, dir: dirBits(t) }, crouch: v.crouch, release: v.release, hold: v.hold, area: { x: 40, zMin: -12, zMax: 12 } };
          const label = `${name} stunt 0x${t.clip.toString(16)} v${vi}`;
          let airTicks = 0, doneAt = -1;
          const ctl = { quiet: 0, n: 0 };
          for (let i = 0; i < 260 && doneAt < 0; i++) {
            const sk = G.g.skate;
            const held = bpkBotStep(bpkSnapshot(G.g), plan);
            const interesting = sk.state !== 0x29 || held !== 0;
            if (interesting) { if (!tickOf(S, held, `${label} t${i}`, false, ctl)) break; } else G.step(held);
            if (sk.state === 0x20) airTicks++;
            if (airTicks > 0 && (sk.state === 0x29 || sk.state === 0x23) && i > 5) doneAt = i;
            if (failures.length > MAXFAIL) break;
          }
        }
      });
      // ---- 4b. the collision sweep FUN_00441270 itself (S5): random sweeps around Pepper and the board against the original's code on the original loader's collision objects
      scenario('collision sweeps', (name) => {
        const S = make(1), { G, H } = S, g = G.g, P = g.pepper, Bd = g.board, rng = makeRng(4242);
        Bd.show();
        let fullHits = 0, boundHits = 0, near = 0, hitsByRec = {};
        const sizes = [[0.8, 0.6, 3], [0.6, 0.6, 3], [1.4, 0.2, 3], [0.01, 0, 1], [0.8, 0.6, 0x43], [1.0, 0.1, 3]];
        for (let trial = 0; trial < 260; trial++) {
          // Pepper / the board somewhere in the park (on the floor, on a pipe, in the air), a random yaw and sometimes a tilt
          P.x = (rng.next() * 2 - 1) * 40; P.z = (rng.next() * 2 - 1) * 26; P.y = rng.next() * 18; P.ry = rng.next() * 6.28; P.rebuildYaw();
          for (let i = 0; i < 15; i++) if (i !== 3 && i !== 7 && i !== 11) Bd.m[i] = P.m[i];
          H.mirrorRecords();
          for (const [radius, skin, mask] of sizes) {
            const kind = rng.int(3);
            const from = kind === 0 ? [P.x, P.y + 1.2, P.z] : [P.x + (rng.next() - 0.5) * 6, P.y + rng.next() * 4, P.z + (rng.next() - 0.5) * 6];
            const L = kind === 1 ? 40 : rng.next() * 6;
            const dir = kind === 1 ? [0, -1, 0] : [rng.next() * 2 - 1, rng.next() * 2 - 1, rng.next() * 2 - 1];
            const dl = Math.hypot(...dir) || 1;
            const delta = kind === 1 ? [0, -40, 0] : dir.map((v) => (v / dl) * L);
            const fromF = from.map(f32), deltaF = delta.map(f32);
            const o = nativeSweep(H, P, fromF, deltaF, mask, radius, skin);
            const h = G.w.col.sweep(P, fromF, deltaF, mask, f32(radius), f32(skin));
            const label = `${name} #${trial} r ${radius} s ${skin} m ${mask}`;
            eq(h ? h.rec.index : -1, o.rec, `${label}: the record hit`);
            hit(h ? `sweep hit ${h.rec.name}` : 'sweep no hit');
            if (h && o.rec >= 0) {
              for (let i = 0; i < 3; i++) { num(h.point[i], o.point[i], `${label}: point[${i}]`, 'sweep'); num(h.normal[i], o.normal[i], `${label}: normal[${i}]`, 'sweep'); }
              eq(h.surface, o.surface, `${label}: surface id`);
            }
            if (Math.hypot(fromF[0] - P.x, fromF[1] - P.y, fromF[2] - P.z) < 3.5) {
              near++;
              if (o.rec === Bd.index) boundHits++;
              // the same sweep with the board's collision object of the FULL loader (FUN_0043f370: the 384 polygons the file holds): the board is hit
              const f = nativeSweep(H, P, fromF, deltaF, mask, radius, skin, { boardFull: true });
              if (f.rec === Bd.index) fullHits++;
              H.mirrorRecords();
            }
          }
        }
        ok(boundHits === 0, `the board (header-only collision object) is never hit by the original's sweeps near it (${boundHits} of ${near})`);
        notes.push(`S5: of ${near} sweeps starting within 3.5 of the board, the original hits the board record ${boundHits} times with the object of its loader FUN_0043f700 (header only, 0 polygons) and ${fullHits} times if it had the 384 polygons of SkBoard.col (FUN_0043f370)`);
        ok(fullHits > 0, 'with the full object the board would be hit');
      });
      // ---- 4c. the zone's loop: the spectators of mode 2 (FUN_0048d8bd 0x48db56 .. 0x48dd59) and the camera of the set-up (FUN_00493506 0x49374d .. 0x49387b)
      for (const dt of [1, 0.5]) scenario(`spectators dt ${dt}`, (name) => {
        const S = make(dt), { G, H } = S, g = G.g, P = g.pepper, w = G.w;
        if (dt === 1) {
          const cam = emuSetupCamera(H);
          for (let i = 0; i < 9; i++) num(w.camera.c[i], cam[i], `${name}: set-up camera[${i}]`, 'camera');
        }
        const rng = makeRng(99 + dt * 3);
        for (let place = 0; place < 4; place++) {
          // Pepper somewhere in / around the park: the spectators turn towards him (turn left / turn right / face him)
          P.x = (rng.next() * 2 - 1) * 50; P.y = 16 + rng.next() * 3; P.z = (rng.next() * 2 - 1) * 60; P.savePrev();
          for (let tick = 0; tick < 36; tick++) {
            const s0 = snapshotWorld(G);
            for (const r of g.spectators) {
              const dx = P.x - r.x, dy = P.y - r.y, dz = P.z - r.z, dot = r.m[10] * dz + r.m[9] * dy + r.m[8] * dx;
              hit(dot > 0.9 ? 'spectator faces Pepper' : dot > 0 ? 'spectator turns right' : 'spectator turns left');
            }
            const o = emuSpectators(H);
            restoreWorld(G, s0);
            spectatorsTick(w, g);
            stats.ticks++;
            for (const r of g.spectators) {
              const q = o[r.index], label = `${name} place ${place} t${tick} record ${r.index}`;
              for (let k = 0; k < 16; k++) num(r.m[k], q.m[k], `${label}: m[${k}]`, 'rec');
              num(r.ry, q.e[1], `${label}: ry`, 'euler');
              eq(r.anim.clip, q.anim.clip, `${label}: clip`); num(r.anim.frame, q.anim.frame, `${label}: frame`, 'frame');
            }
            if (failures.length > MAXFAIL) return;
          }
        }
      });
      // ---- 4d. the zone loop's texts: the stunt name of every clip (FUN_0048d52b), the end banner (FUN_0048d3d1), the brief (FUN_0048d390)
      scenario('loop texts', (name) => {
        const S = make(1), { H } = S;
        for (let clip = 0; clip < 0x80; clip++) {
          const t = emuText(H, 'trick', { clip });
          eq(t.length, 1, `${name}: clip 0x${clip.toString(16)} one text call`);
          eq(t[0].table, 'zone', `${name}: the stunt names come from the zone's BPK.str`);
          eq(t[0].x === 325 && t[0].y === 450 && t[0].wrap === 30, true, `${name}: clip 0x${clip.toString(16)} at (325, 450) wrap 30`);
          eq(TRICK_NAMES[clip] ?? '', t[0].text.trim(), `${name}: the text of clip 0x${clip.toString(16)} (the default is a blank string: nothing visible)`);
        }
        const std = { text: (id) => `std:${id}` }, zone = { text: (id) => `zone:${id}` };
        for (const finalScore of [0, 1, 999, 2501, 5001, 12345]) for (const medal of [0, 1, 2, 3]) for (const newHi of [0, 1]) {
          const t = emuText(H, 'banner', { finalScore, medal, newHi }).filter((x) => !x.panel);
          const mine = bannerLines({ finalScore, medal, newHiscore: newHi }, std, zone);
          const orig = t.map((x) => ({ text: x.table === 'literal' ? x.text : `${x.table}:${x.text}`, y: x.y, wrap: x.wrap, x: x.x }));
          const want = mine.map((x) => ({ text: x.text, y: x.y, wrap: x.wrap, x: 320 }));
          eq(JSON.stringify(want), JSON.stringify(orig), `${name}: banner score ${finalScore} medal ${medal} hi ${newHi}`);
        }
        const t = emuText(H, 'intro');
        eq(JSON.stringify(t.filter((x) => !x.panel).map((x) => [x.table, x.text, x.x, x.y, x.wrap])), JSON.stringify([['zone', 'BPK2', 320, 60, 30]]), `${name}: the brief BPK2 at (320, 60) wrap 30`);
        notes.push(`loop texts: intro panel call ${JSON.stringify(t.find((x) => x.panel)?.panel)}`);
      });
      // ---- 5. the clock and the result: the last ticks of a game with several scores, trophies and hi-scores (FUN_00493ba0 / FUN_00493ecd)
      scenario('clock and result', (name) => {
        const S = make(1), { G } = S, g = G.g;
        for (let i = 0; i < 200; i++) G.step(0);            // walk-in (not compared again here)
        const base = snapshotWorld(G);
        const cases = [];
        for (const score of [0, 10, 2490, 2500, 2510, 4990, 5000, 5010, 7000]) for (const [hi, tro] of [[0, 0], [3000, 1], [9000, 3], [0, 2]]) cases.push({ score, hi, tro });
        for (const c of cases) {
          restoreWorld(G, base);
          G.w.vars.set(0xc0, c.hi); G.w.vars.set(0x8d, c.tro); G.w.vars.set(0x5e, 4);
          g.run.result = 0; g.run.finalScore = 0; g.run.medal = 0; g.run.newHiscore = 0;
          g.swc.time = 3; g.swc.score = c.score; g.swc.pending = 0; g.swc.counting = 0; g.swc.over = 0;
          g.skate.state = 0x29; g.pepper.anim.start(0x29, 0);
          for (let i = 0; i < 6; i++) {
            if (!step(S, 0, `${name}: score ${c.score} hi ${c.hi} trophy ${c.tro} t${i}`)) break;
            if (g.run.result) { hit('game over'); hit(`medal ${g.run.medal}`); hit(`result ${g.run.result}`); if (g.run.newHiscore) hit('new hi-score'); break; }
          }
        }
        // the stunt score is judged into the total: a pending score counts up 10 per tick, the trick flag moves the stunt score over
        for (const [ts, pend, flag] of [[0, 0, 0], [450, 0, 1], [15, 25, 1], [300, 305, 0], [30, 7, 1]]) {
          restoreWorld(G, base);
          G.w.vars.set(0x5e, 4); g.skate.state = 0x29; g.pepper.anim.start(0x29, 0);
          g.run.trickScore = ts; g.run.trickFlag = flag; g.swc.pending = pend; g.swc.counting = pend > 0 ? 1 : 0;
          for (let i = 0; i < 45; i++) if (!step(S, 0, `${name}: score counting ${ts}/${pend}/${flag} t${i}`)) break;
        }
      });
      notes.push(`${stats.ticks} ticks compared in ${((Date.now() - t0all) / 1000).toFixed(1)} s (original ${(stats.ms / Math.max(1, stats.ticks)).toFixed(2)} ms per pass)`);
      notes.push('exact: tolerance 0 (the port\'s float32 operations of skate.ts / run.ts and the shared float32 CollisionWorld agree with the original bit for bit)');
      notes.push(`per scenario: ${stats.byScenario.join('; ')}`);
      notes.push(`visited: ${Object.entries(stats.flags).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
      notes.push(`float comparisons ${nums}, not bit-identical as float32 (count, max error / tolerance): ${Object.entries(inexact).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${k} ${v} (${inexactMax[k].toFixed(3)})`).join(', ')}`);
      notes.push(`max error / tolerance by class: ${Object.entries(maxErr).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ')}`);
    } catch (e) {
      bad(`test crashed: ${e.stack || e}`);
    }
    return { checked, failures, notes };
  },
};
