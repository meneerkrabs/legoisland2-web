// M6 z09JST, the ORACLE test: the original's duel code (the constructor FUN_005d1f64, the update FUN_005ce506 with the whole state machine, mfigman, the camera, the spectator /
// flag nodes) is executed in the x86 interpreter (tools/lib/jst-emu.mjs) next to the TypeScript port; both get the same buttons and the same random numbers and the node state, the
// records' matrices and animations, the camera and every sound / speech / gear / effect call are compared tick by tick over whole scripted matches.
import { loadZone, loadExe } from '../lib/engine-load.mjs';
import { JstEmu } from '../lib/jst-emu.mjs';
import { jstKeys, KEY } from '../lib/jst-bot.mjs';
import '../../src/zones/z09JST.ts';
import { startDuel, giveAnimations, INTRO_CAMERA } from '../../src/zones/z09jst/rig.ts';
import { reticleLines, reticleMode } from '../../src/zones/z09jst/marker.ts';
import { MsvcRng } from '../../src/zones/z09jst/duel.ts';
import { RIG_OF } from '../../src/zones/z09jst/consts.ts';
import { popupLines, finalLines } from '../../src/zones/z09jst/screens.ts';

const T = 2e-3;
export default {
  name: 'm6-z09JST-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const stats = {};
    const pe = loadExe(ctx.dataRoot);

    /** one scenario: `keys(duel, tick)` -> the buttons of the tick; returns { ticks, states } */
    const scenario = (label, seed, keys, maxTicks, stop = (d) => d.result !== 0, mkRng = (sd) => new MsvcRng(sd)) => {
      // ---- the port
      const L = loadZone(ctx, 'z09JST');
      const plog = [];
      const snd = {
        play2D: (i) => plog.push(`p2 ${i}`), stop2D: (i) => plog.push(`s2 ${i}`), rate: (i, h) => plog.push(`r ${i} ${h}`),
        play3D: (i, p) => plog.push(`p3 ${i} ${[0, 1, 2].map((k) => p[k].toFixed(2)).join(',')}`),
      };
      const effects = [];
      const rngP = mkRng(seed), rngO = mkRng(seed);
      const S = startDuel({ world: L.world, archive: L.archive, pe, sound: snd, say: (a, b) => plog.push(`say ${a}${b ? `+${b}` : ''}`), stopSpeech: () => plog.push('stop'), rng: rngP, onGear: () => {} });
      const og = S.gear.set.bind(S.gear);
      S.gear.set = (r, s, on) => { plog.push(`gear ${r}:${s}:${on ? 'on' : 'off'}`); og(r, s, on); };
      S.duel.onEffect = (n) => effects.push(n);
      // the particle calls (the eight orsemud1 emitters: handles 1..8 of the oracle, 0 = botexpl01 whose start is the stub FUN_004429e0): gates and matrices, compared tick by tick
      const pfx = [];
      S.duel.host.fx = { gate: (i, on) => pfx.push(`fx ${i + 1} ${on ? 2 : 1}`), matrix: (i, m) => pfx.push(`fxm ${i + 1} ${Array.from(m).map((v) => v.toFixed(3)).join(',')}`) };
      plog.length = 0;                      // the constructor's calls are not compared tick by tick (checked after it)
      const d = S.duel, W = L.world;
      // ---- the oracle: its own world (records, animations) built the same way, then the original's constructor
      const L2 = loadZone(ctx, 'z09JST');
      giveAnimations(L2.world, L2.archive);
      const anims = new Map();
      for (const i of Object.keys(RIG_OF)) anims.set(+i, L2.world.records[+i].anim);
      const recs = L2.world.records.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags }));
      const emu = new JstEmu(pe, recs, anims, { rng: rngO });
      emu.loadSounds();
      emu.construct();
      const mem = emu.cpu.mem, node = emu.node;
      for (let k = 0; k < 6; k++) mem.wf32(0x9da5e8 + 4 * k, INTRO_CAMERA[k]);      // FUN_005ce1c6 (not run here) stores the intro camera after the constructors
      const nf = (o) => mem.f32(node + o), ni = (o) => mem.r32(node + o);

      let worst = {};
      const cmp = (tick, name, orig, port, tol = T) => {
        checked++;
        const dd = Math.abs(orig - port);
        worst[name] = Math.max(worst[name] ?? 0, dd);
        if (!(dd <= tol * Math.max(1, Math.abs(orig))) && failures.length < 12) failures.push(`${label}: tick ${tick} ${name}: original ${orig} port ${port} (state ${d.state.toString(16)}, port ticks ${d.ticks})`);
      };
      const compare = (tick) => {
        // node fields
        const I = { 0x3c: d.steer, 0x44: d.level, 0x48: d.variant, 0x4c: d.state, 0x54: d.splineMade ? 1 : 0, 0x58: d.hitsP, 0x5c: d.hitsE, 0xd0: d.toggle, 0xf8: d.bonusSpeed, 0xfc: d.precision, 0x100: d.camMode, 0x108: d.score, 0x10c: d.roundPts, 0x110: d.medal, 0x118: d.popup };
        for (const [o, v] of Object.entries(I)) cmp(tick, `node+0x${(+o).toString(16)}`, ni(+o), v, 0);
        cmp(tick, 'ready', mem.r8(node + 0x50), d.ready ? 1 : 0, 0); cmp(tick, 'reticle', mem.r8(node + 0x51), d.reticle ? 1 : 0, 0);
        const F = { 0x40: d.ang, 0xc0: d.r0, 0xc4: d.r1, 0xc8: d.speed, 0xcc: d.rider, 0xd4: d.step, 0xd8: d.decay, 0xdc: d.splineRate, 0xe0: d.splineT, 0xec: d.aimX, 0xf0: d.aimY, 0xf4: d.aimSq, 0x114: d.aimStep };
        for (const [o, v] of Object.entries(F)) cmp(tick, `node+0x${(+o).toString(16)}`, nf(+o), v);
        [[0x60, d.pPos], [0x6c, d.pRot], [0x78, d.ePos], [0x84, d.eRot], [0x90, d.camA], [0x9c, d.camB], [0xa8, d.camEye], [0xb4, d.camTgt]].forEach(([o, a]) => { for (let k = 0; k < 3; k++) cmp(tick, `node+0x${o.toString(16)}[${k}]`, nf(o + 4 * k), a[k]); });
        cmp(tick, 'gauge', mem.f32(0x5d4e138), d.gauge); cmp(tick, 'result', mem.r32(0x5d5ae9c), d.result, 0);
        for (let k = 0; k < 6; k++) cmp(tick, `camera[${k}]`, mem.f32(0x9da5e8 + 4 * k), W.camera.c[k], 3e-3);
        // records
        for (let i = 0; i < 30; i++) {
          const pr = W.records[i], a = RECORDS_BASE_PTR(i);
          for (let k = 0; k < 16; k++) cmp(tick, `rec${i}.m[${k}]`, mem.f32(a + 0xc + 4 * k), pr.m[k], 2e-3);
          cmp(tick, `rec${i}.flag2`, mem.r16(a + 0x60) & 2, pr.flags & 2, 0);
          const an = anims.get(i);
          if (an && pr.anim) { cmp(tick, `rec${i}.clip`, an.clip, pr.anim.clip, 0); cmp(tick, `rec${i}.frame`, an.frame, pr.anim.frame, 1e-3); }
        }
        // the player / dark knight groups
        cmp(tick, 'player.mode', mem.r32(mem.u32(0x5d5b284) + 8), d.player.mode, 0); cmp(tick, 'enemy.mode', mem.r32(mem.u32(0x5d5b288) + 8), d.enemy.mode, 0);
        for (let k = 0; k < 4; k++) cmp(tick, `player.clip${k}`, mem.r32(mem.u32(0x5d5b284) + 0x30 + 4 * k), d.player.clip[k], 0);
        for (let k = 0; k < 3; k++) cmp(tick, `enemy.clip${k}`, mem.r32(mem.u32(0x5d5b288) + 0x30 + 4 * k), d.enemy.clip[k], 0);
      };
      const RECORDS_BASE_PTR = (i) => 0x10000000 + i * 0x68;
      // after the constructors
      compare(-1);
      // the effects of the original's tick -> the port's effect names
      const fx = (log) => {
        const out = [];
        let mud2 = 0, mud1 = 0;
        for (const l of log) {
          const m = /^fx (\d+) (\d)$/.exec(l);
          if (!m) continue;
          const h = +m[1], mode = +m[2];
          if (h === 0) out.push('botexpl01');
          else if (mode === 2) { if (++mud2 % 8 === 0) out.push('orsemud1'); }
          else if (mode === 1) { if (++mud1 % 8 === 0) out.push('emitters-off'); }
        }
        return out;
      };
      const rest = (log) => log.filter((l) => !l.startsWith('fx ') && !l.startsWith('fxm ') && !l.startsWith('setVar'));
      const states = new Set();
      let n = 0, orderEx = '', panels = 0, post = 0;
      for (; n < maxTicks; n++) {
        const k = keys(d, n);
        const pre = { state: d.state, popup: d.popup, bonusSpeed: d.bonusSpeed, precision: d.precision, roundPts: d.roundPts, medal: d.medal, score: d.score };
        W.input.setVirtual(k);
        plog.length = 0; effects.length = 0; pfx.length = 0;
        W.tick();
        // the port's duel ran inside W.tick through the JSTGame node; the oracle gets the buttons the port's input mapper made of the keys
        const held = W.input.held, pressed = W.input.pressed;
        const olog = emu.tick(held, pressed);
        states.add(d.state);
        // the panels: the text lines the original drew in this tick (the popup in state 0x21, the end panel in state 0x23) against the port's tables
        {
          const want = pre.state === 0x21 ? popupLines(pre) : pre.state === 0x23 ? finalLines(pre) : [];
          const got = emu.texts.filter((x) => !x.panel);
          checked++;
          const A = want.map((l) => `${l.table} ${l.text} ${l.y} ${l.wrap}`).join('|'), B = got.map((l) => `${l.table} ${l.text} ${l.x === 320 ? '' : `x${l.x} `}${l.y} ${l.wrap}`).join('|');
          if (A !== B && failures.length < 12) failures.push(`${label}: tick ${n} panel texts (state ${pre.state.toString(16)}): port [${A}] original [${B}]`);
          if (pre.state === 0x21 || pre.state === 0x23) { checked++; if (emu.texts.filter((x) => x.panel).length !== 1 && failures.length < 12) failures.push(`${label}: tick ${n}: ${emu.texts.filter((x) => x.panel).length} panels drawn`); panels++; }
        }
        compare(n);
        {
          const o = olog.filter((l) => (l.startsWith('fx ') && !l.startsWith('fx 0 ')) || l.startsWith('fxm '));
          checked++;
          let same = o.length === pfx.length;
          for (let q = 0; same && q < o.length; q++) {
            if (o[q].startsWith('fxm')) {
              const [ho, mo] = [o[q].split(' ')[1], o[q].split(' ')[2].split(',').map(Number)], [hp, mp] = [pfx[q].split(' ')[1], pfx[q].split(' ')[2]?.split(',').map(Number)];
              if (!pfx[q].startsWith('fxm') || ho !== hp || !mp || mo.some((v, k) => !(Math.abs(v - mp[k]) <= 2e-3 * Math.max(1, Math.abs(v))))) same = false;
            } else if (o[q] !== pfx[q]) same = false;
          }
          if (!same && failures.length < 12) failures.push(`${label}: tick ${n} particle calls: original [${o.join(' ; ')}] port [${pfx.join(' ; ')}]`);
          stats.fxCalls = (stats.fxCalls ?? 0) + o.length;
        }
        const a = rest(olog), b = plog.slice();
        checked++;
        if (a.join('|') !== b.join('|')) { if (failures.length < 12) failures.push(`${label}: tick ${n} calls differ: original [${a.join(' ; ')}] port [${b.join(' ; ')}]`); }
        else if (a.join('|') !== b.join('|')) { worst.orderOnly = (worst.orderOnly ?? 0) + 1; if (!orderEx) orderEx = `tick ${n}: original [${a.join(' ; ')}] port [${b.join(' ; ')}]`; }
        checked++;
        if (fx(olog).join() !== effects.join() && failures.length < 12) failures.push(`${label}: tick ${n} effects: original ${fx(olog)} port ${effects}`);
        if (failures.length >= 12) break;
        if (stop(d) && post++ >= 6) { n++; break; }          // a few ticks more: the loop updates in the end banner (state 0x23) as well
      }
      const unh = [...emu.unhooked.entries()].map(([a, c]) => `0x${a.toString(16)}x${c}`).join(' ');
      const w = Object.entries(worst).filter(([, v]) => v > 1e-5).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([kk, v]) => `${kk} ${v.toExponential(1)}`).join(', ');
      if (orderEx) notes.push(`${label}: order of calls within a tick differs once: ${orderEx}`);
      notes.push(`${label}: ${n} ticks, states ${[...states].map((s) => s.toString(16)).sort().join(' ')}, panels ${panels}, worst ${w || 'none above 1e-5'}${unh ? `, unhooked ${unh}` : ''}`);
      return { n, states, d };
    };

    const botKeys = (style, ready = 40) => (d, t) => jstKeys(d, style, t, { ready });
    const mash = (seed) => {
      let s = seed;
      const r = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return (s >>> 8) / 16777216; };
      let hold = 0, left = 0;
      return (d) => {
        if (left-- <= 0) { left = Math.floor(r() * 12); const bits = [0, KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN, KEY.SPACE, KEY.LEFT | KEY.UP, KEY.RIGHT | KEY.DOWN]; hold = bits[Math.floor(r() * bits.length)]; }
        return d.state === 0x21 ? (left % 2 ? KEY.UP : 0) : hold;
      };
    };
    const visited = new Set();
    const flat = () => ({ range: (x) => x / 2 });
    const run = (label, seed, keys, max, stop, mkRng) => { const r = scenario(label, seed, keys, max, stop, mkRng); for (const s of r.states) visited.add(s); return r; };
    run('win', 1, botKeys('win'), 6000);
    run('win-2', 7, botKeys('win', 30), 6000);
    run('loss', 11, botKeys('loss'), 6000);
    run('slow', 31, botKeys('slow'), 1500, () => false);
    for (const seed of [3, 4]) run(`mash-${seed}`, seed, mash(seed), 2000, () => false);
    // glancing blows without the wobble (aim squared distance 49), more tournaments with other seeds until every reaction was seen
    run('glance', 41, botKeys('glance'), 2200, () => false, flat);
    for (const seed of [2, 10, 12, 13]) { run(`win-s${seed}`, seed, botKeys('win'), 6000); run(`loss-s${seed}`, seed + 100, botKeys('loss'), 6000); }
    // ---- the aim marker FUN_005d2814 run natively: the 16 lines (pixel coordinates, colours), the point it projects, the modes in which it draws
    {
      const L2 = loadZone(ctx, 'z09JST');
      giveAnimations(L2.world, L2.archive);
      const anims = new Map();
      for (const i of Object.keys(RIG_OF)) anims.set(+i, L2.world.records[+i].anim);
      const recs = L2.world.records.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags }));
      const emu = new JstEmu(pe, recs, anims, { rng: new MsvcRng(5) });
      emu.loadSounds(); emu.construct();
      let s = 99, n = 0;
      const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
      const eqLine = (a, b) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1 && a.color === b.color && a.color2 === b.color;
      for (let k = 0; k < 400; k++) {
        const o = { mode: [2, 2, 2, 1, 4, 5, 3, 9, 7][k % 9], reticle: k % 11 !== 0, aimX: Math.fround((rnd() - 0.5) * 24), aimY: Math.fround((rnd() - 0.5) * 24), visible: k % 7 !== 0, px: Math.fround(rnd() * 640), py: Math.fround(rnd() * 480), pz: 0.4 };
        if (k % 5 === 0) { o.aimX = Math.fround((rnd() - 0.5) * 8); o.aimY = Math.fround((rnd() - 0.5) * 8); }
        const r = emu.reticle(o);
        const drawn = o.reticle && o.mode !== 3 && o.mode !== 9 && o.visible;
        checked++;
        if (r.projected.length !== (o.reticle && o.mode !== 3 && o.mode !== 9 ? 1 : 0) || (r.projected[0] && (r.projected[0][0] !== 0 || r.projected[0][1] !== 0 || r.projected[0][2] !== 0))) failures.push(`marker ${k}: projected points ${JSON.stringify(r.projected)} (mode ${o.mode}, reticle ${o.reticle}): the origin (0, 0, 0) of the last world matrix is projected once`);
        const mine = reticleMode(o.mode) && o.reticle && o.visible ? reticleLines(o.px, o.py, o.aimX, o.aimY) : [];
        checked++;
        if (mine.length !== r.lines.length || mine.some((l, i) => !eqLine(r.lines[i], l))) { if (failures.length < 12) failures.push(`marker ${k}: lines differ: original ${JSON.stringify(r.lines.slice(0, 3))}... port ${JSON.stringify(mine.slice(0, 3))}...`); }
        if (drawn) n++;
      }
      notes.push(`aim marker: ${n} drawn markers (16 lines each) compared with FUN_005d2814 run natively`);
    }
    const want = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0xb, 0xc, 0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1f, 0x20, 0x21, 0x22, 0x23];
    const missing = want.filter((s) => !visited.has(s));
    notes.push(`particle calls compared with the original's: ${stats.fxCalls}`);
    notes.push(`states visited: ${[...visited].map((s) => s.toString(16)).sort().join(' ')}${missing.length ? ` (not reached: ${missing.map((s) => s.toString(16)).join(' ')})` : ''}`);
    checked++;
    if (missing.length) failures.push(`states not reached by the scenarios: ${missing.map((s) => s.toString(16)).join(' ')}`);
    return { checked, failures, notes };
  },
};
