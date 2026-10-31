import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { WabEmu } from '../lib/m5-wab-emu.mjs';
import { crtPick } from '../../src/zones/z05WAB/wab.ts';
import { takeShared, wabEffects } from '../../src/zones/z05WAB/game.ts';
import { B } from '../../src/game/input.ts';
import { setRandSource, setTickCountSource } from '../../src/game/crt.ts';
import { msClock, startTickClock } from '../../src/zones/common/tickrand.ts';
import { guarded } from '../lib/inject-guard.mjs';

// z05WAB, M5 audit, ORACLE test: the original's whack-a-bot code (botwab FUN_00569f50 with the presentation FUN_0056bb20 / whack animation FUN_0056c6a5 / alarm FUN_0056c8f1, pepwab
// FUN_0056c950, both constructors, the camera helpers) is executed in the x86 interpreter (tools/lib/m5-wab-emu.mjs) next to the TypeScript port; both get the same buttons and the
// same random numbers (the port draws `value % n` from the scripted sequence, the original's FUN_004388ae returns the value) and the node state, every record's matrix / flags /
// Euler angles, the camera, the globals (stun, Pepper's clip, game over, percentage), the HUD strings and every sound / speech / texture-frame / UV-scroll call are compared tick by tick
// over whole games (3000 ticks: the 2700 of the game and the end).

const f32 = Math.fround;
const KEYBIT = { ArrowUp: B.UP, ArrowLeft: B.LEFT, ArrowRight: B.RIGHT, ArrowDown: B.DOWN };
const HOLE_KEY = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'];
const gen = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; }; };

const __test = {
  name: 'm5-audit-z05WAB-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 12) failures.push(m); else if (failures.length === 12) failures.push('... more'); };
    const pe = loadExe(ctx.dataRoot);

    const scenario = (label, seed, player, ticks, dt = 1) => {
      const L = loadZone(ctx, 'z05WAB');
      const sh = takeShared();
      const w = L.world;
      w.externalInput = true;
      const next = gen(seed), drawn = [];
      // the port's own draws (crtPick: crt.ts rand() scaled by the real zone clock) run on a scripted 15 bit source and a scripted tick clock; the oracle replays them
      let tk = 0;
      setTickCountSource(() => 5000 + Math.floor(tk * 1000 / 60));
      setRandSource(() => { const v = next() & 0x7fff; drawn.push(v); return v; });
      startTickClock();
      const frames = [], ev = [];
      sh.host = {
        play: (id) => ev.push(`p ${id}`), stop: (id) => ev.push(`s ${id}`),
        play3d: (id, pos) => ev.push(pos ? `p3 ${id} ${pos.map((v) => v.toFixed(2)).join(',')}` : `p3 ${id} none`),
        say: (id) => ev.push(`say ${id}`),
        random: crtPick,
        setFrame: (t, slot, f) => frames.push([t, slot, f]),
        scrollV: (g, dv) => ev.push(`u ${g} ${dv.toFixed(6)}`),
      };
      const bot = sh.bot, pep = sh.pep;
      // the emitter calls: the port's wabEffects runs on a recording stub of ZoneParticles; the original's calls (FUN_004429a0 / 00442960 / 00442a50 / 00442a20 / 00442a00) are recorded by the harness
      const fxlog = [];
      {
        let nh = 0;
        const idx = (m) => w.records.findIndex((r) => r.m === m);
        const fl = (a) => Array.from(a, (v) => f32(v)).join(',');
        const g3 = (g) => `${g[0]}${g[1]}${g[2]}`;
        const stub = {
          startSwirl: (name, pos, rot, gate) => { fxlog.push(`swirl ${nh} ${name} ${fl(pos)} ${fl(rot)} ${g3(gate)}`); return nh++; },
          start: (name, m, pos, rot, gate) => { fxlog.push(`start ${nh} ${name} rec${idx(m)} ${fl(pos)} ${fl(rot)} ${g3(gate)}`); return nh++; },
          collideWith: (h, rec) => { fxlog.push(`coll ${h} rec${w.records.indexOf(rec)}`); },
          finish: () => {},
          on: (h) => fxlog.push(`gate ${h} 2 1 1`), off: (h) => fxlog.push(`gate ${h} 1 1 1`),
          setMatrix: (h, m) => fxlog.push(`matrix ${h} ${fl(m)}`),
        };
        sh.host.fx = wabEffects({ world: w }, stub);
      }
      const worst = {};
      const num = (tick, name, orig, port, tol = 0) => {
        checked++;
        const d = Math.abs(orig - port);
        worst[name] = Math.max(worst[name] ?? 0, d);
        if (!(d <= tol * Math.max(1, Math.abs(orig)))) bad(`${label}: tick ${tick} ${name}: original ${orig} port ${port}`);
      };
      const eq = (tick, name, orig, port) => { checked++; if (JSON.stringify(orig) !== JSON.stringify(port)) bad(`${label}: tick ${tick} ${name}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`); };
      // ---- the oracle: its own world (records, animation), then the original's constructors
      const L2 = loadZone(ctx, 'z05WAB');
      takeShared();
      const recs = L2.world.records.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags, rx: r.rx, ry: r.ry, rz: r.rz }));
      let di = 0;
      const emu = new WabEmu(pe, recs, L2.world.records[0].anim, { rand: () => drawn[di++], clock: () => msClock() });
      emu.cpu.mem.wf32(0x8b1718, dt);   // before the constructors (they read DAT_008b1718 too)
      emu.construct();
      eq(-1, 'constructor texture frames', emu.frames, [['flsh', 0, 0]]);
      eq(-1, 'constructor calls', emu.log, ['anim 1']);   // the idle clip
      eq(-1, 'emitter start calls', emu.fxlog, fxlog);
      fxlog.length = 0; emu.fxlog = [];
      const mem = emu.cpu.mem;
      mem.wf32(0x8b1718, dt); w.dt = dt;     // DAT_008b1718: the frame time factor (1.0 at 30 Hz, 0.5 at 60 Hz)
      // the camera: FUN_00422b50 (not run here) leaves the start view in DAT_009da5e8
      pep.init(w, w.records[0]); bot.init(w);
      eq(-1, 'port constructor frames', frames, [['flsh', 0, 0]]); frames.length = 0; ev.length = 0;
      for (let k = 0; k < 9; k++) mem.wf32(0x9da5e8 + 4 * k, w.camera.c[k]);
      const nf = (o) => mem.f32(emu.bot + o), ni = (o) => mem.r32(emu.bot + o), n16 = (o) => mem.r16(emu.bot + o), n8 = (o) => mem.r8(emu.bot + o);
      const pf = (o) => mem.f32(emu.pep + o), p8 = (o) => mem.r8(emu.pep + o);
      const s16 = (v) => (v << 16) >> 16, s8 = (v) => (v << 24) >> 24;

      let started = 0, overAt = -1, infoHits = 0, botLines = 0;
      const f0 = failures.length;
      for (let t = 0; t < ticks; t++) {
        const key = player(bot, pep, sh, t);
        ev.length = 0; frames.length = 0; drawn.length = 0; di = 0;
        w.input.pressed = key ? KEYBIT[key] : 0;      // the buttons that went down this tick, exactly (the shell samples the input itself)
        tk = t + 1;
        w.tick();
        const olog = emu.tick(key ? KEYBIT[key] : 0);
        if (key) started++;
        infoHits += ev.filter((e) => /^say LESGWB0[678]$/.test(e)).length; botLines += ev.filter((e) => /^say LESGWB(09|10)$/.test(e)).length;
        // the original's miss sound with no active hole passes uninitialised stack data (0xcccccccc coordinates, far outside the 3D range: nothing is heard): the port logs it as `none`
        eq(t, 'sounds / speech / scroll', olog.filter((e) => !e.startsWith('anim ')).map((e) => e.replace(/^(p3 \d+) -107374176.*$/, '$1 none')), ev);
        eq(t, 'random calls', di, drawn.length);
        eq(t, 'emitter calls (gate / matrix)', emu.fxlog, fxlog); fxlog.length = 0;
        const ofr = emu.frames.filter((f) => f[1] !== 0x1c);      // slot 0x1c of the radar TV hits a plain TGA in this build (the port does not call it)
        eq(t, 'texture frames', ofr, frames);
        // node
        num(t, 'timeLeft', nf(0xec), bot.timeLeft); num(t, 'elapsed', nf(0xf0), bot.elapsed);
        for (let i = 0; i < 4; i++) {
          eq(t, `state${i}`, n16(0xf4 + 2 * i), bot.state[i]); eq(t, `whacked${i}`, n16(0xfc + 2 * i), bot.whacked[i]); eq(t, `isInfo${i}`, n16(0x104 + 2 * i), bot.isInfo[i]);
          num(t, `y${i}`, nf(0x10c + 4 * i), bot.y[i]); eq(t, `tUp${i}`, ni(0x11c + 4 * i), bot.tUp[i]);
        }
        eq(t, 'hits', n8(0x12e), bot.hits); eq(t, 'misses', n8(0x12f), bot.misses); eq(t, 'clockOn', n8(0x12c) !== 0, bot.clockOn);
        num(t, 'hold', nf(0x138), bot.hold); num(t, 'gap', nf(0x13c), bot.gap); eq(t, 'lastDown', ni(0x188), bot.lastDown);
        for (const [o, k] of [[0x158, 'c158'], [0x15c, 'c15c'], [0x160, 'c160'], [0x164, 'c164'], [0x168, 'c168'], [0x16c, 'c16c'], [0x170, 'reactT'], [0x174, 'openT'], [0x178, 'closeT'], [0x190, 'hitT']]) num(t, k, nf(o), bot[k]);
        for (const [o, k] of [[0x17e, 'reactKind'], [0x180, 'openHole'], [0x182, 'closeHole'], [0x184, 'lidDone'], [0x18e, 'hitStage']]) eq(t, k, s16(n16(o)), bot[k]);
        eq(t, 'mark1740', n8(0x17c) !== 0, bot.mark1740); eq(t, 'mark780', n8(0x17d) !== 0, bot.mark780);
        // Pepper's node and the globals
        eq(t, 'pep clip', s8(p8(0x15)), pep.clip); eq(t, 'pep ret', p8(0x16), pep.ret); eq(t, 'pep busy', p8(0x17), pep.busy); eq(t, 'pep lock', p8(0x18), pep.lock);
        num(t, 'stun', mem.f32(0x5d5885c), sh.stun); eq(t, 'DAT_008f6c00 (clip)', mem.r32(0x8f6c00), sh.clip); eq(t, 'DAT_05d58864 (over)', mem.r32(0x5d58864), sh.over);
        if (sh.over) { const o = mem.f32(0x5d58860); if (!(Number.isNaN(o) && Number.isNaN(sh.pct))) num(t, 'percentage', o, sh.pct); }
        // HUD strings (the clock and counters are written to fixed buffers, the percentage line is queued as a text)
        eq(t, 'time text', mem.cstr(0x5d4dd60), bot.timeText); eq(t, 'hits text', mem.cstr(0x5d4dd20), bot.hitsText); eq(t, 'miss text', mem.cstr(0x5d4dd44), bot.missText);
        if (!sh.over) { eq(t, 'percentage line', emu.texts.map((x) => [x.text, x.x, x.y, x.wrap]), [[bot.pctText, 320, 400, 30]]); }
        // camera
        for (let k = 0; k < 6; k++) num(t, `camera${k}`, mem.f32(0x9da5e8 + 4 * k), w.camera.c[k]);
        // records
        for (let i = 0; i < w.records.length; i++) {
          const r = w.records[i], a = emu.recPtr(i);
          for (let k = 0; k < 16; k++) num(t, `rec${i}(${r.name}).m${k}`, mem.f32(a + 0xc + 4 * k), r.m[k]);
          eq(t, `rec${i}(${r.name}).flags`, mem.r16(a + 0x60) & 0xffff, r.flags & 0xffff);
        }
        if (sh.over && overAt < 0) overAt = t;
        if (failures.length > f0) { bad(`${label}: stopped at tick ${t}`); break; }
      }
      notes.push(`${label}: ${ticks} ticks, ${started} presses, hits ${bot.hits} misses ${bot.misses}, Infomaniac hits ${infoHits}, bot lines ${botLines}, game over at tick ${overAt}, pct ${sh.pct}, unhooked calls ${JSON.stringify([...emu.unhooked].map(([a, n]) => `${a.toString(16)}x${n}`))}`);
      return { bot, sh };
    };

    // ---- scenario 1: random button mashing (about one press per 9 ticks), including the Infomaniac stun and early / late presses
    const mash = (seed) => { const g = gen(seed); return (bot, pep, sh, t) => (g() % 9 === 0 ? HOLE_KEY[g() % 4] : null); };
    scenario('mash', 11, mash(5), 3000);
    // ---- scenario 2: a player that hits every bot as soon as it is up (the hammer lands 12 ticks after the press; it presses when the bot rises), ignoring the Infomaniac
    const smart = () => (bot, pep, sh, t) => {
      for (let h = 0; h < 4; h++) if (bot.state[h] === 1 && !bot.isInfo[h] && bot.y[h] > -1.2 && pep.busy === 0) return HOLE_KEY[h];
      return null;
    };
    const r2 = scenario('smart', 23, smart(), 3000);
    // ---- scenario 3: a player that never presses (every bot a miss, game over below 50 percent) and one that presses everything (stun, repeated presses)
    scenario('idle', 3, () => null, 3000);
    const spam = (bot, pep, sh, t) => HOLE_KEY[t % 4];
    scenario('spam', 99, spam, 3000);
    // ---- scenario 4: hits every bot including the Infomaniac (the stun: 90 ticks without input, the lose clip, red crosses)
    scenario('all', 41, (bot, pep, sh) => { for (let h = 0; h < 4; h++) if (bot.state[h] === 1 && bot.y[h] > -1.2 && pep.busy === 0) return HOLE_KEY[h]; return null; }, 3000);
    // ---- scenario 5: the same at dt = 0.5 (the 60 Hz step of WP-TIME: every counter of the node steps by rate * DAT_008b1718, the original's frame counts double)
    scenario('mash dt0.5', 12, mash(6), 6000, 0.5);
    scenario('smart dt0.5', 24, smart(), 6000, 0.5);
    scenario('idle dt0.5', 4, () => null, 6000, 0.5);
    scenario('all dt0.5', 42, (bot, pep, sh) => { for (let h = 0; h < 4; h++) if (bot.state[h] === 1 && bot.y[h] > -1.2 && pep.busy === 0) return HOLE_KEY[h]; return null; }, 6000, 0.5);
    setRandSource(null); setTickCountSource(null);
    void r2; void f32;
    return { checked, failures, notes };
  },
};
export default guarded(__test);
