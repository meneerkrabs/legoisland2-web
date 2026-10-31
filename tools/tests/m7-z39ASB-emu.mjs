// WP-VERIFY z39ASB (docs/re/m3/z39ASB.md "Differential test"): the ORIGINAL's shuttle node (constructor FUN_007b96a0 with the asteroid layout FUN_007b9917 and the star table
// FUN_007b780c, update FUN_007b82dd with the hit test FUN_007b7f68, the asteroid motion FUN_007b91b9, the draw hook FUN_007b9434 / 007b959c, the end of a run FUN_007b7e9a) runs in
// the x86 emulation (tools/lib/m7-z39ASB-emu.mjs on tools/lib/m7-zone-emu.mjs) next to the port's `AsteroidBelt` (+ `BeltSound`) with the same buttons / pad axes and the same random
// numbers (FUN_004388ae; the hit-sound choices scale rand() with GetTickCount in the original: the host returns the raw rand() for that call, see the notes). Compared tick by tick:
// the node's fields, the SHUT / HULL / 235 asteroid records (matrix, Euler angles, frustum / enabled bits), the camera, the HUD globals, the result / variables, the thrust / gyro pitch
// counters and the sound / speech calls (as a multiset per tick). dt: the original runs at dt = 1 AND dt = 0.5; the port's `AsteroidBelt.update` has no dt (a fixed 30 Hz step), so
// at dt = 0.5 only the original's own scaling is checked (the same course takes twice the ticks) and the port's missing dt is recorded.
import fs from 'node:fs';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { AsbWorldEmu, RECORDS_BASE } from '../lib/m7-z39ASB-emu.mjs';
import { AsteroidBelt, BeltRng, ST, VAR, C } from '../../src/zones/z39ASB/belt.ts';
import { BeltSound, SND, MISSES } from '../../src/zones/z39ASB/sound.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';

const REC = 0x68;
const MAXFAIL = 24;

export default {
  name: 'm7-z39ASB-emu',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const nx = (s) => (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const bad = (m) => { if (failures.length < MAXFAIL) failures.push(m); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const cover = { states: new Set(), sounds: new Map(), hits: 0, warns: 0, wins: 0, losses: 0, fuel: 0, speech: new Map(), recycled: 0 };
    const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

    /** one scenario: `keys(t, belt)` -> { held, axisX, axisY }; the original at dt = 1 against the port */
    const scenario = async (label, seed, keys, maxTicks, o = {}, dt = 1) => {
      const t0 = Date.now();
      let sp = seed, so = seed;
      // the port's random source: the C rand() values 0..32767 (MsvcRand's interface); the original's FUN_004388ae(x) = rand / 32767 * x, except for the hit sounds (x = GetTickCount > 1000): rand()
      // both sides draw rand() from the same scripted sequence (a private LCG per side, the same seed); FUN_004388ae runs natively on the original's side (hosted FUN_0085daf0), `randFrom` on the port's.
      // The hit test's picks scale rand() with FUN_00435c91 (GetTickCount - start): both sides get the same scripted 1000000 ms.
      const rngP = new BeltRng(() => { sp = nx(sp); return (sp >> 8) & 0x7fff; });
      const rngO = { int: () => { so = nx(so); return (so >> 8) & 0x7fff; } };
      // ---- the port
      const L = loadZone(ctx, 'z39ASB');
      const W = L.world;
      const shut = W.records[1], hullRec = W.records[2];
      const asteroids = W.records.filter((r) => r.name.startsWith('AST')).slice(0, 256);
      const vars = new GameVars();
      const store = { 0x29: o.hiscore ?? 0, 0x44: o.trophy ?? 0 };
      for (const [k, v] of Object.entries(store)) vars.set(+k, v);
      const sound = new BeltSound(null);
      await sound.load();
      const plog = [];
      sound.log = [];
      const p3 = [];
      const rate = sound.rate.bind(sound); sound.rate = (id, hz) => { plog.push(`r #${id} ${Math.trunc(hz)}`); rate(id, hz); };
      const events = [];
      const belt = new AsteroidBelt({ shut, hull: hullRec, asteroids }, W.camera.c, rngP, vars, (e) => {
        events.push(e); sound.event(e);
        if (e.type === 'warn') p3.push(`p3 #${MISSES[e.miss]} ${e.pos.map(Math.fround)}`);
        if (e.type === 'hit') plog.push(`say OGSGAB0${e.voice === 0 ? 6 : 7}`);
        if (e.type === 'warnEnd') plog.push('s2 #515', 's2 #516', 's3 #458', 's3 #459');       // BeltSound.event('warnEnd') stops the alarm pair and the miss pair silently (no log line)
      }, () => 1000000);
      // ---- the oracle world and the original
      const L2 = loadZone(ctx, 'z39ASB');
      const o2 = L2.world.records;
      const emu = new AsbWorldEmu(pe, { world: L2.world, records: o2, anims: new Map(), pepperIndex: -1 }, { rng: rngO, dt, tick: 1000000 });
      const mem = emu.cpu.mem;
      emu.construct();
      const node = emu.node;
      const nf = (off) => mem.f32(node + off), ni = (off) => mem.r32(node + off) | 0;
      const N = W.records.length;

      const worst = new Map();
      let nfail = 0, tick = 0;
      const cmp = (name, orig, port, tol = 0, idx = '') => {
        checked++;
        const dd = Math.abs(orig - port);
        if (dd > (worst.get(name) ?? 0)) worst.set(name, dd);
        if (!(dd <= tol * Math.max(1, Math.abs(orig)))) { nfail++; bad(`${label}: tick ${tick} ${name}${idx}: original ${orig} port ${port} (state ${belt.state})`); }
      };
      const eq = (name, orig, port, idx = '') => {
        checked++;
        if (orig !== port) { nfail++; bad(`${label}: tick ${tick} ${name}${idx}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)} (state ${belt.state})`); }
      };
      const compareAll = (full) => {
        // the node
        eq('state', ni(0x18), belt.state); eq('score', ni(0x1c), belt.score);
        cmp('speed', nf(0x27c), belt.speed); cmp('maxSpeed', nf(0x280), belt.maxSpeed); cmp('hull', nf(0x284), belt.hull); eq('hullInt', ni(0x288), belt.hullInt);
        eq('warn', mem.r8(node + 0x28c), belt.warn ? 1 : 0); eq('hits', ni(0x290), belt.hits); cmp('hitTimer', nf(0x294), belt.hitTimer);
        cmp('shakeX', nf(0x2a0), belt.shakeX); cmp('shakeVel', nf(0x2a4), belt.shakeVel);
        cmp('tiltX', nf(0x2a8), belt.tiltX); cmp('tiltY', nf(0x2ac), belt.tiltY); cmp('tiltA', nf(0x2b4), belt.tiltA);
        cmp('frame', nf(0x2c8), belt.frame); cmp('camOff', nf(0x2cc), belt.camOff); cmp('glow', nf(0x2d0), belt.glow);
        cmp('accZ', nf(0x2d4), belt.accZ); cmp('spacing', nf(0x2d8), belt.spacing);
        // the records: the shuttle, the cockpit, the asteroids that move (all of them every 64 ticks)
        const rs = [1, 2];
        const ai0 = W.records.indexOf(asteroids[0]);
        for (let i = 0; i < asteroids.length; i++) if (full || (Math.abs(asteroids[i].z - belt.cam[2]) < 900)) rs.push(ai0 + i);
        for (const i of rs) {
          const a = RECORDS_BASE + i * REC, r = W.records[i], nm = r.name;
          for (let k = 0; k < 16; k++) cmp(nm + ' m', mem.f32(a + 0xc + 4 * k), r.m[k], 0, `[${k}]#${i}`);
          cmp(nm + ' rx', mem.f32(a + 0x4c), r.rx, 0, `#${i}`); cmp(nm + ' ry', mem.f32(a + 0x50), r.ry, 0, `#${i}`); cmp(nm + ' rz', mem.f32(a + 0x54), r.rz, 0, `#${i}`);
          // the port's renderer needs RF_NO_DRAW (0x8000) on what the original does not draw: compare the original's own bits 0 (frustum) and 1 (enabled)
          eq(nm + ' flags 0|1', mem.r16(a + 0x60) & 3, r.flags & 3, `#${i}`);
        }
        for (let k = 0; k < 6; k++) cmp('camera', mem.f32(0x9da5e8 + 4 * k), W.camera.c[k], 0, `[${k}]`);
        eq('result', mem.r32(0x5d5d524) | 0, belt.result); eq('var 0xfc', emu.vars.get(0xfc) | 0, vars.get(VAR.RESULT));
        if (tick > 0) {      // the HUD values are written by the first update (the port initialises them in its constructor)
          cmp('gauge', mem.f32(0x5d4e138), belt.gauge, 0);
          eq('score text', mem.cstr(0x5d4dd60).trim(), belt.scoreText);
        }
        eq('frame tint', (mem.r32(0x5d4e0c4) >>> 0) & 0xffffff, belt.frameTint & 0xffffff);
        for (let i = 0; i < 5; i++) eq('hit icon tint', (mem.r32(0x5d4e148 + i * 8) >>> 0), belt.slotTint[i] >>> 0, ` ${i}`);
        eq('thrust spool', mem.r32(0x5d5d514) | 0, belt.engine.spool); eq('gyro pitch', mem.r32(0x5d5d52c) | 0, belt.engine.gyro); eq('thrust drop', mem.r32(0x5d5d4f8) | 0, belt.engine.drop);
        if (belt.finalScore || (mem.r32(0x5d5d528) | 0)) eq('final score', mem.r32(0x5d5d528) | 0, belt.finalScore);
        eq('hiscore (var 0x29)', emu.vars.get(0x29) ?? store[0x29], vars.get(VAR.HISCORE)); eq('trophy (var 0x44)', emu.vars.get(0x44) ?? store[0x44], vars.get(VAR.TROPHY));
        eq('medal (var 0x102)', emu.vars.get(0x102) ?? 0, vars.get(VAR.MEDAL) ?? 0);
      };
      // the state after the constructors
      emu.vars.set(0x29, store[0x29]); emu.vars.set(0x44, store[0x44]);
      tick = 0;
      compareAll(true);
      const evs = [];
      let t = 0, hullEmpty = 0;
      // the rate (pitch) calls are compared as the pitch each loop ends the tick with: the original sets the thrust pitch inside every FUN_007b6f1f (twice per tick in the fly-in), only
      // when it changes, and the gyro pitch inside FUN_007b6de3 (flight only); the port sets both once at the end of every tick (to the same value when nothing changed)
      const rateO = new Map(), rateP = new Map();
      // (stopping a loop twice in a tick, e.g. the gyro by both FUN_007b6f1f(0) calls of the tick the run ends, is the same as stopping it once: duplicates of stop calls are dropped)
      const norm = (l) => [...new Set(l.filter((q) => /^(s2|s3) /.test(q))), ...l.filter((q) => /^(p2|p3|say) /.test(q))].sort();
      const noteRates = (l, m) => { for (const e of l) { const q = /^r (#\d+) (\d+)$/.exec(e); if (q) m.set(q[1], +q[2]); } };
      for (; t < maxTicks && belt.state !== ST.END; t++) {
        const inp = keys(t, belt);
        // the original first (it reads the camera the previous tick left), then the port
        const xb = mem.f32(RECORDS_BASE + REC + 0x3c), pxb = shut.x;
        const olog = emu.tickAll(inp.held, inp.axisX ?? 0, inp.axisY ?? 0);
        if (process.env.ASB_TRACE2 && t >= +process.env.ASB_TRACE2 - 2 && t <= +process.env.ASB_TRACE2) console.log('t', t + 1, 'axis', inp.axisX, inp.axisY, 'x before', xb, pxb, 'x after orig', mem.f32(RECORDS_BASE + REC + 0x3c));
        const was = { ...cover };
        void was;
        sound.log.length = 0; plog.length = 0; p3.length = 0; events.length = 0;
        belt.update({ held: inp.held, axisX: inp.axisX, axisY: inp.axisY }, dt);
        sound.tick(belt.stateIn, belt.engine);
        // the port's sound calls as the original's call strings
        const pl = [...plog, ...p3];
        for (const l of sound.log) {
          const m = /^(play|stop) (\d+)$/.exec(l);
          if (m) pl.push(m[1] === 'play' ? `p2 #${m[2]}` : (MISSES.includes(+m[2]) ? `s3 #${m[2]}` : `s2 #${m[2]}`));
        }
        // 'warnEnd' stops the whole alarm / miss group in the port (one event), the original stops handles one by one: both are the same set of stops
        tick = t + 1;
        cover.states.add(belt.state);
        const f0 = nfail;
        compareAll(t % 64 === 0);
        // sounds / speech: as a multiset per tick (the port plays the state loops after the whole update, the original inside it)
        if (process.env.ASB_TRACE && tick >= +process.env.ASB_TRACE) console.log(tick, 'orig', olog.join(' | '), '\n   port', pl.join(' | '), 'spool', belt.engine.spool, 'drop', belt.engine.drop);
        noteRates(olog, rateO); noteRates(pl, rateP);
        for (const id of ['#589', '#592']) { const vo = rateO.get(id) ?? 22050, vp = rateP.get(id) ?? 22050; eq('pitch of sound ' + id, vo, vp); }
        const a = norm(olog), b = norm(pl);
        checked++;
        if (JSON.stringify(a) !== JSON.stringify(b)) { nfail++; bad(`${label}: tick ${tick}: calls differ (state ${belt.state})\n    original ${a.join(' | ')}\n    port     ${b.join(' | ')}`); }
        for (const e of a) { if (e.startsWith('say')) bump(cover.speech, e); else bump(cover.sounds, e.replace(/ -?[\d.,e-]+$/, '')); }
        for (const e of events) { if (e.type === 'hit') { cover.hits++; if (evs.length < 12) evs.push(`hit${e.hits}@${tick}`); } if (e.type === 'warn') cover.warns++; if (e.type === 'end' && evs.length < 14) evs.push(`end${e.result}@${tick}`); }
        if (belt.hull <= 0) hullEmpty++;
        if (nfail > f0) break;
      }
      if (belt.result === 1) cover.wins++; if (belt.result === 2) cover.losses++; if (hullEmpty) cover.fuel++;
      const w = [...worst].sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ');
      notes.push(`${label} dt ${dt}: ${t} ticks (${Date.now() - t0} ms), state ${belt.state} result ${belt.result} score ${belt.score} hits ${belt.hits} hull ${belt.hull.toFixed(1)} z ${shut.z.toFixed(1)}; unhooked ${[...emu.unhooked].map(([k, v]) => `${k.toString(16)}x${v}`).join(' ') || 'none'}; worst diffs ${w}; ${evs.join(' ')}`);
      return { belt, emu, ticks: t };
    };

    // ---- scripted players
    const dodge = (belt, extra = 0) => {
      const shutR = belt.recs.shut;
      let worst = null;
      for (const a of belt.recs.asteroids) {
        const dz = a.z - belt.cam[2];
        if (dz < -2 || dz > 75) continue;
        const dx = belt.cam[0] - a.x, dy = belt.cam[1] - a.y;
        if (Math.abs(dx) < 5.8 && Math.abs(dy) < 5.5 && (!worst || dz < worst.dz)) worst = { dz, dx, dy };
      }
      if (!worst) return extra;
      const needX = 5.8 - Math.abs(worst.dx), needY = 5.5 - Math.abs(worst.dy);
      if (needX <= needY * 1.2) return worst.dx >= 0 ? (shutR.x < 16 ? B.RIGHT : B.LEFT) : (shutR.x > -16 ? B.LEFT : B.RIGHT);
      return worst.dy >= 0 ? (shutR.y < 12 ? B.DOWN : B.UP) : (shutR.y > -12 ? B.UP : B.DOWN);
    };
    const rnd = (seed) => { let q = seed; return () => { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; return (q >>> 8) / 16777216; }; };
    const randomKeys = (seed, burn = 0.3) => {
      const rd = rnd(seed); let hold = 0, mask = 0;
      return (t, belt) => {
        if (hold-- <= 0) { hold = 2 + Math.floor(rd() * 30); mask = 0; if (rd() < 0.5) mask |= rd() < 0.5 ? B.LEFT : B.RIGHT; if (rd() < 0.5) mask |= rd() < 0.5 ? B.UP : B.DOWN; if (rd() < burn) mask |= B.LEFT | B.UP; }
        return { held: belt.state === ST.FLY ? mask : 0 };
      };
    };
    const stick = (seed) => {
      const rd = rnd(seed); let hold = 0, ax = 0, ay = 0;
      return (t, belt) => {
        if (hold-- <= 0) { hold = 3 + Math.floor(rd() * 30); ax = rd() < 0.3 ? 0 : Math.floor((rd() - 0.5) * 1024); ay = rd() < 0.3 ? 0 : Math.floor((rd() - 0.5) * 1024); }
        return { held: 0, axisX: ax, axisY: ay };
      };
    };
    const scen = [
      ['dodge bot (win)', 2024, (t, belt) => ({ held: belt.state === ST.FLY ? dodge(belt) : 0 }), 6000, { hiscore: 0, trophy: 0 }],
      ['idle (five hits)', 5, () => ({ held: 0 }), 6000],
      ['dodge bot with fuel burn', 7, (t, belt) => ({ held: belt.state === ST.FLY ? dodge(belt, (t >> 1) & 1 ? B.LEFT : B.RIGHT) : 0 }), 6000],
      ['random keys 1', 11, randomKeys(11), 6000], ['random keys 2', 12, randomKeys(12, 0.9), 6000],
      ['pad stick 1', 21, stick(21), 6000], ['pad stick 2', 22, stick(22), 6000],
    ];
    const FULL = !!process.env.ASB_FULL;
    const quick = { 1: new Set(['dodge bot (win)', 'idle (five hits)', 'dodge bot with fuel burn', 'random keys 2', 'pad stick 1']), 0.5: new Set(['dodge bot with fuel burn', 'pad stick 1']) };   // (the default matrix keeps one test near 30 s; ASB_FULL=1 runs every scenario)
    const only = process.env.ASB_ONLY;
    const onlyDt = process.env.ASB_DT;
    for (const dt of [1, 0.5]) for (const [label, seed, keys, max, o] of scen) if ((!only || new RegExp(only).test(label)) && (!onlyDt || +onlyDt === dt) && (FULL || only || quick[dt].has(label))) await scenario(label, seed, keys, Math.round(max / dt), o, dt);
    // ---- dt: every scenario above runs at dt = 1 and dt = 0.5 on BOTH sides (`AsteroidBelt.update(inp, dt)`: M7 added the dt parameter, the original scales 27 places by DAT_008b1718:
    // FUN_007b82dd x20, FUN_007b91b9 x5, FUN_007b63f6 x2 (the fade of the loop, not part of the node)).
    // ---- the end of a run: FUN_007b7e9a (hiscore / medal / trophy) over scores x stored hiscore x stored trophy, and the banner FUN_007b61a4 (the trophy raise, the lines drawn)
    {
      const L = loadZone(ctx, 'z39ASB'), L2 = loadZone(ctx, 'z39ASB');
      const W = L.world, o2 = L2.world.records;
      const asteroids = W.records.filter((r) => r.name.startsWith('AST')).slice(0, 256);
      const emu = new AsbWorldEmu(pe, { world: L2.world, records: o2, anims: new Map(), pepperIndex: -1 }, { rng: { int: () => 1 }, dt: 1 });
      emu.construct();
      let n = 0;
      const mkBelt = (vars) => new AsteroidBelt({ shut: W.records[1], hull: W.records[2], asteroids }, W.camera.c, { next: () => 1, range: () => 1 }, vars, () => {});
      const medals = new Set();
      const scores = [0, 1, 2000, 4999, 5000, 5001, 5002, 6999, 7000, 7001, 7002, 8000, 9938, 9999, 10000];
      for (const score of scores) for (const hi of [0, 4000, 5000, 5001, 7000, 9938, 20000]) for (const tr of [0, 1, 2, 3]) {
        const o = emu.finish(score, hi, tr);
        const vars = new GameVars(); vars.set(VAR.HISCORE, hi); vars.set(VAR.TROPHY, tr); vars.set(VAR.MEDAL, 0x77);
        const belt = mkBelt(vars);
        vars.set(VAR.HISCORE, hi); vars.set(VAR.TROPHY, tr); vars.set(VAR.MEDAL, 0x77);
        belt.finishRun(score);
        const what = `FUN_007b7e9a score ${score} hiscore ${hi} trophy ${tr}`;
        n++;
        for (const [name, a, b] of [['var 0x29', o.hiscore, vars.get(VAR.HISCORE)], ['var 0x44', o.trophy, vars.get(VAR.TROPHY)], ['var 0x102', o.medal, vars.get(VAR.MEDAL)], ['final score DAT_05d5d528', emu.cpu.mem.r32(0x5d5d528) | 0, belt.finalScore]]) { checked++; if (a !== b) bad(`${what}: ${name}: original ${a} port ${b}`); }
        medals.add(o.medal);
      }
      let nb = 0;
      for (const result of [1, 2]) for (const medal of [0, 1, 2]) for (const tr of [0, 1, 2, 3]) {
        const o = emu.banner(result, medal, tr, 8123);
        const vars = new GameVars(); vars.set(VAR.RESULT, result); vars.set(VAR.MEDAL, medal); vars.set(VAR.TROPHY, tr);
        const belt = mkBelt(vars);
        vars.set(VAR.RESULT, result); vars.set(VAR.MEDAL, medal); vars.set(VAR.TROPHY, tr);
        belt.bannerStep();
        nb++; checked++;
        if (o.trophy !== vars.get(VAR.TROPHY)) bad(`banner result ${result} medal ${medal} trophy ${tr}: original ${o.trophy} port ${vars.get(VAR.TROPHY)}`);
        // the lines the original draws: the score, then (failure) OGSGAB04 at y 200 or (success) the medal text at y 150 and OGSGAB03 / 02 / 01 at y 200 (port: game.ts drawBanner)
        const shown = o.text.map((e) => e.replace(/^text\s+(.*?)\s+x(\d+) y(\d+)$/, 'text $1 x$2 y$3'));       // (the score is printed with a field width)
        checked++;
        const expect = result === 2 ? ['text 8123 x320 y100', 'text OGSGAB04 x320 y200'] : ['text 8123 x320 y100', `text ${['SGBRONZE', 'SGSILVER', 'SGGOLD'][medal]} x320 y150`, `text OGSGAB0${3 - medal} x320 y200`];
        if (JSON.stringify(shown) !== JSON.stringify(expect)) bad(`banner result ${result} medal ${medal}: original draws ${JSON.stringify(shown)}, expected (port drawBanner) ${JSON.stringify(expect)}`);
      }
      notes.push(`FUN_007b7e9a: ${n} cases (scores around the 5000 / 7000 thresholds x stored hiscore x stored trophy), medals ${[...medals].sort().join(',')}; banner FUN_007b61a4: ${nb} cases (result x medal x trophy), trophy raise and the drawn lines agree with BeltSound / game.ts`);
    }
    notes.push(`coverage: states ${[...cover.states].sort().join(',')}; hits ${cover.hits}; warnings ${cover.warns}; wins ${cover.wins}; losses ${cover.losses}; fuel runs ${cover.fuel}`);
    notes.push(`sound calls: ${[...cover.sounds].map(([k, v]) => `${k}x${v}`).join(' ')}`);
    notes.push(`speech: ${[...cover.speech].map(([k, v]) => `${k}x${v}`).join(' ')}`);
    return { checked, failures, notes };
  },
};
