// WP-VERIFY z10RGB: coverage test (docs/re/m6/z10RGB.md, "Differential test (WP-VERIFY): coverage").
import { setRandSource } from '../../src/game/crt.ts';
import { createHarness, createCoverage, NODE_FUNCS, fr } from '../lib/m7-z10RGB-emu.mjs';
import { solveShot } from '../../src/zones/z10rgb/enemy.ts';
import { REC, VAR, MODE, PHASE, K } from '../../src/zones/z10rgb/consts.ts';
import { ROUTE, planShot, nextTarget, aimKeys } from '../../src/zones/z10rgb/bot.ts';
import { guarded } from '../lib/inject-guard.mjs';

/** the tolerance of every float comparison: relative to max(1, |value|); the original runs the x87 in 24-bit precision, the port rounds the same operations, what is left is the matrix builder / collision noise (a few ulps) */
const TOL = 0, S_TOL_SAMPLES = 0;
const lcg = (seed) => { let s = seed >>> 0; const r = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; r.int = (n) => Math.floor(r() * n); r.pick = (a) => a[Math.floor(r() * a.length)]; return r; };

const __test = {
  name: 'm7-z10RGB-cover',
  run(ctx) {
    const failures = [], notes = [];
    const T = { checked: 0, bad: (m) => { if (failures.length < 40) failures.push(m); }, ok: (c, m) => { T.checked++; if (!c) T.bad(m); }, eqv: (a, b, m) => { T.checked++; if (JSON.stringify(a) !== JSON.stringify(b)) T.bad(`${m}: port ${JSON.stringify(a)}, original ${JSON.stringify(b)}`); } };
    const Hn = createHarness(ctx, T);
    const cov = createCoverage(Hn.pe);
    const { open, tick, walkTo, setKeys, inj } = Hn;
    let scenarios = 0; const scenarioList = [];
    const visited = {};
    const mark = (k) => { visited[k] = (visited[k] ?? 0) + 1; };

    /** a scenario: both sides from the same constructors, `drive(S, n)` returns the keys held this tick and may inject; returns false to stop */
    const run = (name, seed, dt, ticks, drive, setup) => {
      const t0 = Date.now(), f0 = failures.length;
      const S = open(seed, { dt, cov: cov.trace });
      S.tol = TOL; S.tolSamples = S_TOL_SAMPLES; scenarios++; scenarioList.push(S);
      if (setup) setup(S);
      const st = S.st, w = S.w;
      let n = 0, prevMode = w.vars.get(VAR.MODE);
      const ev = { modes: new Set(), phases: new Set(), states: new Set() };
      for (; n < ticks; n++) {
        const keys = drive(S, n) ?? [];
        if (keys === false) break;
        setKeys(S, keys);
        try { tick(S, `${name} dt${dt} tick ${n}`); } catch (e) { T.bad(`${name} dt${dt} tick ${n}: ${e.stack}`); break; }
        const m = w.vars.get(VAR.MODE);
        if (m !== prevMode) { ev.modes.add(`${prevMode}>${m}`); prevMode = m; }
        ev.phases.add(st.phase);
        if (failures.length > f0 + 5) break;
      }
      notes.push(`${name} dt ${dt}: ${n} ticks, phases ${[...ev.phases]}, mode changes ${[...ev.modes]}, score ${st.score}, lives ${st.lives}, left ${st.cannonsLeft} (${Date.now() - t0} ms)`);
      return { S, n, ev };
    };
    const botDrive = (o = {}) => {
      let wi = 0, arrived = false, tgt = null, plan = null;
      const CODE = { 1: 'ArrowLeft', 2: 'ArrowRight', 4: 'ArrowUp', 8: 'ArrowDown' };
      const st = { shots: 0 };
      const f = (S, n) => {
        const { st: ps, w } = S, dt = w.dt;
        if (o.inject) o.inject(S, n);
        const mode = w.vars.get(VAR.MODE);
        let keys = [];
        if (mode === MODE.WALK) {
          if (!arrived) {
            const t = ROUTE[wi]; const dx = t[0] - ps.pepper.x, dz = t[1] - ps.pepper.z;
            if (Math.hypot(dx, dz) < 4 && wi < ROUTE.length - 1) wi++;
            if (wi === ROUTE.length - 1 && ps.phase >= 3 && Math.hypot(ROUTE[wi][0] - ps.pepper.x, ROUTE[wi][1] - ps.pepper.z) < 5) arrived = true;
            walkTo(S, t[0], t[1], (o.speed ?? 1.0) * dt);
          } else {
            let bk = -1, bd = 1e9;
            ps.cannons.forEach((c, k) => { if (!(c.rec.flags & 2)) return; const d = Math.hypot(c.rec.x - ps.pepper.x, c.rec.z - ps.pepper.z); if (d < bd) { bd = d; bk = k; } });
            if (bk >= 0) { const c = ps.cannons[bk].rec; if (Math.hypot(c.x - ps.pepper.x, c.z - ps.pepper.z) < 7) keys = ['ControlLeft']; else walkTo(S, c.x, c.z, (o.speed ?? 1.0) * dt); }
          }
        } else if (mode === MODE.CANNON && !o.idle) {
          const c = ps.cannons[ps.pepperCannon];
          const bl = ps.curBall >= 0 ? ps.balls[ps.curBall] : null;
          if (!tgt || !(ps.enemy[tgt.k].flags & 2) || !plan) { tgt = nextTarget(ps); plan = tgt ? planShot(ps, tgt.point) : null; }
          if (plan) {
            const k = aimKeys(c.rec.rx, c.rec.ry, plan);
            keys = Object.entries(CODE).filter(([b]) => k.keys & +b).map(([, cc]) => cc);
            if (k.onTarget && c.timer <= 0 && (!bl || bl.state === 0) && !keys.length) { keys = ['Space']; plan = null; st.shots++; }
          }
        }
        if (o.after && o.after(S, n, keys) === false) return false;
        return keys;
      };
      f.stats = st;
      return f;
    };

    const S0 = (S) => S;
    /** into phase 3 at once (rgbgame turns phase 2 into 3 on the first tick) with Pepper next to the player's cannon `k` */
    const toCannons = (k = 2, lives = 100) => (S) => {
      inj.phase(S, PHASE.CROSSED); inj.lives(S, lives);
      const c = S.st.cannons[k].rec;
      walkTo(S, c.x, c.z - 3, 1e9);
    };
    const alive = (S) => S.st.enemy.map((e, k) => k).filter((k) => S.st.enemy[k].flags & 2);
    const freeBall = (S) => S.st.balls.findIndex((b) => b.state === 0);
    const DOWN = -1.5707963705062866;
    /** a ball that falls straight down onto the record at (x, y, z), launched from 30 above */
    const dropOn = (S, x, y, z, o = {}) => {
      const i = o.idx ?? freeBall(S);
      if (i < 0) return -1;
      inj.ball(S, i, [x, y + (o.h ?? 30), z], [0, o.speed ?? 6, 0], DOWN);
      return i;
    };

    // ---- 1. scripted games with many lives (the old oracle's flow: bridge, cannon, shots)
    for (const [seed, dt, cap] of [[4, 1, 2000], [7, 0.5, 2400]]) {
      let over = 0;
      const d = botDrive({ after: (S) => { if (S.st.resultMode && ++over > 60) return false; } });
      run(`bot${seed}`, seed, dt, cap, d, (S) => { inj.lives(S, 100); });
    }

    // ---- 2. every enemy cannon destroyed: the player's own balls (dropped on the cannons, the aiming is the bot's business) in three orders, so Cedric stands on, hops to, or leaves each cannon
    for (const [seed, dt, rule] of [[11, 1, 'cedric'], [12, 0.5, 'random'], [13, 1, 'next'], [14, 0.5, 'cedric'], [15, 1, 'random']]) {
      const R = lcg(seed), period = Math.round(60 / dt);
      let over = 0, shots = 0;
      run(`kills(${rule})${seed}`, seed, dt, Math.round(1500 / dt), (S, n) => {
        const { st, w } = S;
        if (st.resultMode && ++over > 40) return false;
        if (n === 3) return ['ControlLeft'];
        if (w.vars.get(VAR.MODE) === MODE.CANNON && st.pepperCannon >= 0 && n > 5 && n % period === 0 && st.cannonsLeft > 0) {
          const ced = st.cedric.ctrl.find('cedric'), al = alive(S);
          let k = R.pick(al);
          if (rule === 'cedric' && ced.state === 0 && al.includes(ced.cur)) k = ced.cur;
          if (rule === 'next' && ced.state === 3 && al.includes(ced.next)) k = ced.next;
          const e = st.enemy[k];
          const i = freeBall(S);
          if (i >= 0) { inj.hitMark(S, i, REC.CC[k]); inj.curBall(S, i); shots++; }
        }
        return [];
      }, toCannons(R.int(4)));
    }

    // ---- 3. the end of the game: the result writer FUN_005f7cec for the three medals, the hi-score and the trophy against what the variables hold (both sides tick the same node)
    {
      const S = open(21, { dt: 1, cov: cov.trace }); S.tol = TOL;
      let n = 0;
      for (const [score, hi, trophy] of [[3000, 0, 0], [3000, 5000, 3], [4000, 100, 1], [4001, 100, 1], [4001, 9000, 2], [4001, 100, 3], [7000, 0, 0], [7001, 0, 0], [7001, 8000, 3], [8123, 100, 2], [0, 0, 0], [500, 600, 1]]) {
        inj.setVar(S, VAR.HISCORE_RGB, hi); inj.setVar(S, VAR.TROPHY_RGB, trophy);
        S.st.resultWritten = false; S.H.mem.w8(S.H.nodes.game + 0x15, 0);
        inj.score(S, score); inj.phase(S, PHASE.WON);
        for (let t = 0; t < 2; t++) { setKeys(S, []); try { tick(S, `result score ${score} hi ${hi} trophy ${trophy} tick ${t}`); } catch (e) { T.bad(e.stack); } n++; }
        T.ok(S.w.vars.get(VAR.HISCORE_RGB) === Math.max(hi, score) && S.w.vars.get(VAR.TROPHY_RGB) === Math.max(trophy, score >= 7001 ? 3 : score >= 4001 ? 2 : 1), `result score ${score}: hi-score ${S.w.vars.get(VAR.HISCORE_RGB)}, trophy ${S.w.vars.get(VAR.TROPHY_RGB)}`);
      }
      inj.phase(S, PHASE.LOST); for (let t = 0; t < 2; t++) { setKeys(S, []); tick(S, `lost banner tick ${t}`); n++; }
      notes.push(`result writer: 12 (score, hi-score, trophy) combinations and the loss banner, ${n} ticks`);
    }

    // ---- 4. a hit inside a cannon: a ball of an enemy cannon (state 4, waiting for it) lands on the player's cannon: the cannon is lost, a life, 1000 points, the variable bit; no life left: the game is lost
    for (const [seed, dt, k, lives] of [[31, 1, 0, 3], [32, 0.5, 1, 2], [33, 1, 2, 1], [34, 0.5, 3, 1]]) {
      let hitAt = -1;
      run(`hit inside ${k}`, seed, dt, Math.round(260 / dt), (S, n) => {
        const { st, w } = S;
        if (n === 3) return ['ControlLeft'];
        if (n === Math.round(40 / dt) && st.pepperCannon >= 0) {
          const c = st.cannons[st.pepperCannon].rec, i = freeBall(S);
          if (i >= 0) { dropOn(S, c.x, c.y + 3, c.z, { idx: i, h: 12 }); inj.enemyWaits(S, seed % 9, i); hitAt = n; }
        }
        return [];
      }, (S) => { toCannons(k, lives)(S); });
    }

    // ---- 5. random keys in a cannon: tilt and swivel to their limits, fire (and dry fire), leave and enter again, at both steps
    for (const [seed, dt] of [[41, 1], [42, 0.5]]) {
      const R = lcg(seed);
      let held = [], until = 0;
      run(`mash${seed}`, seed, dt, Math.round(900 / dt), (S, n) => {
        const { st, w } = S;
        if (n < 3) return [];
        if (n === 3) return ['ControlLeft'];
        if (n >= until) { held = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].filter(() => R() < 0.3); until = n + 3 + R.int(Math.round(60 / dt)); }
        const keys = held.slice();
        if (R() < 0.05) keys.push('Space');
        if (R() < 0.006 / dt) keys.push('ControlLeft');
        if (w.vars.get(VAR.MODE) === MODE.WALK) { const c = st.cannons[R.int(4)].rec; walkTo(S, c.x, c.z - 3, 1e9); }
        return keys;
      }, toCannons(R.int(4)));
    }

    // ---- 6. balls: ten balls dropped / thrown at random places around Pepper, the cannons' castle and the sea (near misses, hits, the sea, the cannons' boxes, the castle, every ball record)
    for (const [seed, dt] of [[51, 1], [52, 0.5]]) {
      const R = lcg(seed);
      run(`balls${seed}`, seed, dt, Math.round(500 / dt), (S, n) => {
        const { st } = S;
        if (n % Math.round(7 / dt) === 0) {
          const i = freeBall(S);
          if (i >= 0) {
            const p = st.pepper, kind = R.int(6);
            let pos, dir, pitch;
            if (kind < 3) { pos = [p.x + R.pick([-9, -5, -3, -1, 0, 2, 4.5, 7, 12, 25]), p.y + 30, p.z + R.pick([-9, -5, -3, -1, 0, 2, 4.5, 7, 12, 25])]; dir = [0, 6, 0]; pitch = DOWN; }
            else if (kind === 3) { pos = [R.pick([-300, -150, 0, 100, 200]), 50, R.pick([-90, -40, 0, 40, 90])]; dir = [0, 6, 0]; pitch = DOWN; }          // anywhere: the sea, the castle's foot
            else { const e = st.enemy[R.int(9)]; pos = [e.x + R.pick([-6, -3, 0, 3, 6]), e.y + R.pick([-4, 0, 6, 15]), e.z + R.pick([-6, -3, 0, 3, 6])]; dir = [R.pick([-2, 0, 2]), R.pick([4, 6]), R.pick([-2, 0, 2])]; pitch = R.pick([DOWN, 0.2, -0.4]); }
            inj.ball(S, i, pos, dir, pitch);
          }
        }
        return [];
      }, (S) => { inj.lives(S, 100); });
    }

    // ---- 7. standing on the bridge: the cannons shoot, Pepper is hit, flies, lies, gets up and blinks; the water guard (below y = 4 he is put back on the bridge point)
    for (const [seed, dt] of [[61, 1], [62, 0.5]]) {
      const R = lcg(seed);
      run(`stand${seed}`, seed, dt, Math.round(1100 / dt), (S, n) => {
        const { st, w } = S;
        if (w.vars.get(VAR.MODE) === MODE.WALK && n % Math.round(300 / dt) === 0) {
          const t = R.pick([[-10, -16.2], [30, -10], [-40, -14], [-20, -16.2], [100, -6]]);
          walkTo(S, t[0], t[1], 1e9);
        }
        if (n === Math.round(700 / dt) && w.vars.get(VAR.MODE) === MODE.WALK) { inj.pos(S, REC.PEPP, st.pepper.x, 2.0, st.pepper.z); }
        return [];
      }, (S) => { inj.lives(S, 100); });
    }

    // ---- 8. odd corners: Ctrl far from every cannon in phase 3, the pitch limits, a full ball pool (fire and the cannons' shots), phase 0 / phase 2 again, a stale hit on a destroyed cannon, Pepper hit high above the ground
    for (const [seed, dt] of [[71, 1], [72, 0.5]]) {
      const R = lcg(seed), sc = 1 / dt;
      run(`corners${seed}`, seed, dt, Math.round(1500 / dt), (S, n) => {
        const { st, w } = S, mem = S.H.mem, mode = w.vars.get(VAR.MODE);
        const t = Math.round(n * dt);          // game time in 30 Hz ticks
        if (t === 0 && n === 0) { inj.phase(S, PHASE.INIT); }
        if (t === 4 && n === Math.round(4 / dt)) { inj.phase(S, PHASE.CROSSED); }
        if (n === Math.round(8 / dt)) { const c = st.cannons[1].rec; walkTo(S, c.x + 60, c.z - 30, 1e9); return ['ControlLeft']; }      // phase 3, no cannon near
        if (n === Math.round(9 / dt)) { const c = st.cannons[1].rec; walkTo(S, c.x, c.z - 3, 1e9); return []; }
        if (n === Math.round(11 / dt)) return ['ControlLeft'];
        if (mode === MODE.CANNON && t >= 14 && t < 14 + 420) return ['ArrowUp'];                        // up to the limit 0.3
        if (mode === MODE.CANNON && t >= 440 && t < 440 + 330) return ['ArrowDown'];                    // down to the limit -0.5
        if (mode === MODE.CANNON && t >= 780 && t < 780 + 60) return ['ArrowLeft'];
        if (mode === MODE.CANNON && t >= 850 && t < 850 + 60) return ['ArrowRight'];
        if (t === 930 && n === Math.round(930 / dt)) { for (const b of st.balls) { if (b.state === 0) { b.state = 1; mem.w32(Hn.POOL + b.idx * 0xa8 + 4, 1); } } return ['Space']; }   // the pool is full: the shot finds no ball
        if (t === 936 && n === Math.round(936 / dt)) return ['Space'];
        if (t === 1000 && n === Math.round(1000 / dt)) { inj.phase(S, PHASE.CROSSED); }                  // phase 2 again: the line was said already
        if (t === 1010 && n === Math.round(1010 / dt)) { const i = st.balls.findIndex((b) => b.state === 1); for (const b of st.balls) { b.state = 0; mem.w32(Hn.POOL + b.idx * 0xa8 + 4, 0); } void i; }
        if (t === 1020 && n === Math.round(1020 / dt)) { inj.kill(S, 3); const i = freeBall(S); if (i >= 0 && st.pepperCannon >= 0) { inj.hitMark(S, i, REC.CC[3]); inj.curBall(S, i); } }      // a stale hit on a destroyed cannon
        return [];
      }, toCannons(1));
    }
    // Pepper knocked up high above the ground (the fall is faster than the first bounce can absorb)
    for (const [seed, dt] of [[73, 1], [74, 0.5]]) {
      run(`high hit${seed}`, seed, dt, Math.round(260 / dt), (S, n) => {
        if (n === 2) { const p = S.st.pepper; inj.pos(S, REC.PEPP, p.x, p.y + 45, p.z); }
        if (n === 3) inj.setVar(S, VAR.MODE, MODE.HIT);
        return [];
      }, (S) => { walkTo(S, -10, -16.2, 1e9); inj.lives(S, 100); });
    }
    // ball records: each of the ten balls lands on the ground (the sound slot chain of FUN_005f8291) with Pepper near (hit, near miss, clear)
    {
      const R = lcg(81);
      run('ball slots', 81, 1, 480, (S, n) => {
        if (n % 12 === 0) {
          const i = (n / 12) % 10, b = S.st.balls[i];
          if (b.state === 0) { const p = S.st.pepper; dropOn(S, p.x + R.pick([0, 2, 3.5, 5, 8, 30]), p.y, p.z + R.pick([0, 1, -2, 4]), { idx: i, h: 40 }); }
        }
        return [];
      }, (S) => { walkTo(S, -20, -16.2, 1e9); inj.lives(S, 100); });
    }

    // ---- 9. FUN_005f87e1 (the aim solver, with FUN_005f89c9) run natively against solveShot: bit for bit (single floats, 24-bit x87) over random shots
    {
      const S = open(91, { dt: 1, cov: cov.trace }), { cpu, mem } = S.H;
      const A = 0x34000100, r = lcg(12345), F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
      let n = 0, reach = 0;
      for (let it = 0; it < 1500; it++) {
        const p = [fr(-250 + r() * 60), fr(30 + r() * 40), fr(-30 + r() * 20)], t = [fr(-100 + r() * 400), fr(r() * 20), fr(-30 + r() * 40)], sp = r() < 0.5 ? K.SHOT_SPEED : 4;
        for (let i = 0; i < 3; i++) { mem.wf32(A + 4 * i, p[i]); mem.wf32(A + 16 + 4 * i, t[i]); }
        mem.wf32(A + 0x40, 0); mem.wf32(A + 0x44, 0);
        F32[0] = sp;
        cpu.call(0x5f87e1, [A, A + 16, U32[0], A + 0x40, A + 0x44], { trace: cov.trace });
        const o4 = mem.f32(A + 0x40), o5 = mem.f32(A + 0x44), q = solveShot(K.G, p, t, sp);
        n++;
        if (q) { reach++; T.ok(q.flat === o4 && q.lob === o5, `solveShot ${JSON.stringify([p, t, sp])}: port flat ${q.flat} lob ${q.lob}, original ${o4} ${o5}`); }
        else T.ok(o4 === 0 && o5 === 0, `solveShot out of reach: original wrote ${o4} ${o5}`);
      }
      notes.push(`aim solver: ${n} random shots bit for bit (${reach} in reach)`);
    }

    // ---- coverage: the conditional branch outcomes of the original node functions that the runs above took
    const rep = cov.report();
    notes.push(`branch outcomes of the zone's node functions (${NODE_FUNCS.length} functions): ${rep.covered} / ${rep.total} taken by the oracle runs`);
    const by = {};
    for (const m of rep.missing) (by[m.fn] ??= []).push(`${m.at.toString(16)}${m.out === 'taken' ? 'T' : 'F'}`);
    notes.push(`not taken (all classified in docs/re/m6/z10RGB.md, section "Differential test (WP-VERIFY): coverage"): ${Object.entries(by).map(([k, v]) => `${k}: ${v.join(' ')}`).join('; ')}`);
    T.ok(rep.covered >= 350, `branch coverage fell: ${rep.covered} / ${rep.total} (350 expected)`);
    notes.push(`tolerance: ${TOL} relative to max(1, |v|) on every float (all scenarios also pass at 2e-7: the 24-bit x87 is rounded per operation in the port; what is left is the matrix builder's 1 ulp); ground samples of the ball shadows ${S_TOL_SAMPLES} (the ground height at positions that differ by an ulp, slope amplified)`);
    setRandSource(null);
    return { checked: T.checked, failures, notes };
  },
};
export default guarded(__test);
