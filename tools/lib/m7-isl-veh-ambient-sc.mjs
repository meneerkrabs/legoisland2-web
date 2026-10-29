// (scenarios of tools/tests/m7-isl-veh-ambient.mjs / m7-isl-veh-brikimal.mjs)
// WP-VERIFY M7 island ambient nodes (docs/re/m4/wp7-ambient.md): the ORIGINAL's node code (Butterfly FUN_004b24f8 / FUN_004b2539, ...) runs natively in the x86 emulation (tools/lib/m7-isl-veh-ambient.mjs, m7-isl-veh-emu.mjs)
// next to the port's nodes (src/island/ambient/**) with the same scripted Pepper position / buttons and the same random numbers; compared tick by tick: the records (matrix, Euler, flags), the node blocks, all game
// variables, the sound / emitter calls, the random draw count of every tick.
import { ambientDuel, CTOR, B, lcg, hostMusic, portMusic, MUSIC_RE, giveAnims } from './m7-isl-veh-ambient.mjs';

const MAXFAIL = 30;


/** shared bookkeeping of one test run */
export function makeEnv(ctx) {
  const env = { ctx, failures: [], notes: [], checked: 0, cover: { sessions: 0, ticks: 0, shifts: 0, followTicks: 0, resetTicks: 0, shapes: {}, musicCalls: {}, botCalls: {}, dancing: 0 }, devs: new Map(), unhooked: new Map() };
  env.finish = (d, label) => {
    const { cover, notes, devs, unhooked } = env;
    if (d.grazes) { cover.grazes = (cover.grazes ?? 0) + d.grazes.length; notes.push(`${label}: ${d.grazes.length} divergence(s) re-synced (float32 original vs double port): ${d.grazes.map((g) => g.slice(0, 140)).join(' ; ')}`); }
    notes.push(`${label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
    env.checked += d.checked;
    for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
    for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
    d.cleanup();
  };
  env.result = () => {
    const { notes, devs, unhooked, cover } = env;
    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    return { checked: env.checked, failures: env.failures, notes };
  };
  return env;
}

    // ---- butterflies
export const butterflies = async (env) => {
  const { ctx, failures, cover } = env, finish = env.finish;
      for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true]]) {
        const label = `butterfly ${dtLabel}`;
        const d = ambientDuel(ctx, { node: 2, dt, seed: 11, kinds: ['Butterfly'], ctors: new Set([CTOR.BUTTERFLY]), maxFail: MAXFAIL, failures });
        d.label = label; d.syncMode = sm; cover.sessions++;
        const W = d.P.world, mem = d.emu.cpu.mem;
        const bf = W.records.filter((r) => /^BF[SG]\d$/.test(r.name)).map((r) => r.index);
        const hidden = new Set();
        d.P.ictx.inFrustum = (r) => !hidden.has(r.index);
        const NODE = { flap: [0x34, 'f'], flapState: [0x38, 'i'], cnt: [0x3c, 'i'], cnt2: [0x40, 'i'], vy: [0x44, 'f'], off: [0x48, 'i'], speed: [0x50, 'f'], shiftT: [0x54, 'f'] };
        d.syncPort = () => { for (const i of bf) { d.recToPort(i); d.nodeToPort(d.pnode(i, 'Butterfly'), d.onode(i, CTOR.BUTTERFLY), NODE); } };
        const compare = () => {
          for (const i of bf) d.rec(i, 0xfffe);
          d.vars(); d.sounds();
          const s = d.script.settle(); d.eq('rand draws left (original)', 0, s.left); d.eq('rand draws over (port)', 0, s.over);
          for (const i of bf) {
            const n = W.records[i].name, pn = d.pnode(i, 'Butterfly'), a = d.onode(i, CTOR.BUTTERFLY);
            for (const [f, [off, ty]] of Object.entries(NODE)) { if (ty === 'f') d.cmp(`${n}.${f}`, mem.f32(a + off), pn[f], undefined, '', 1e-5); else d.eq(`${n}.${f}`, mem.r32(a + off) | 0, pn[f]); }
            const fol = mem.r32(a + 0x4c); if (fol) cover.followTicks++; if (mem.r32(a + 0x48) === 200) cover.resetTicks++; d.eq(n + '.follow', fol ? (fol - 0x10000000) / 0x68 : -1, pn.follow ? pn.follow.index : -1);
          }
        };
        const step = (held) => {
          // the frustum flag (record flag 1) of the original's records: set for every record except the hidden ones
          for (const r of W.records) { const a = 0x10000000 + r.index * 0x68; const f = mem.r16(a + 0x60); mem.w16(a + 0x60, hidden.has(r.index) ? f & ~1 : f | 1); }
          d.tick(held); cover.ticks++;
          const gm = d.grazeBegin(); compare(); d.grazeEnd(gm);
        };
        const sc = dt === 1 ? 1 : 2;
        d.placePepper(0, 0, 0, 0);
        for (let t = 0; t < 300 * sc; t++) step(0);
        // Pepper next to a butterfly (within 8 units): Shift after more than 4 ticks makes it follow him, a quick second Shift lets it go; Pepper walks a circle so the followers track him
        const rnd = lcg(5);
        for (const name of ['BFS3', 'BFG2', 'BFS8']) {
          const r = W.records.find((x) => x.name === name);
          for (let round = 0; round < (dt === 1 ? 3 : 2); round++) {
            d.placePepper(r.x + 2, r.y - 1, r.z + 2, 0);
            for (let t = 0; t < 12 * sc; t++) step(0);
            step(B.SHIFT); cover.shifts++;                                  // follow (if within 8)
            for (let t = 0; t < 140 * sc; t++) {
              const a = t * 0.05 / sc;
              d.placePepper(r.x + 2 + Math.sin(a) * 12, r.y - 1, r.z + 2 + Math.cos(a) * 12, a);
              step(t % (45 * sc) === 44 * sc ? B.SHIFT : 0);               // a second Shift 45 ticks later: let go (after more than 4 ticks)
              cover.shifts += t % (45 * sc) === 44 * sc ? 1 : 0;
            }
            // two quick Shifts
            step(B.SHIFT); step(0); step(B.SHIFT); step(0); cover.shifts += 2;
            for (let t = 0; t < 30 * sc; t++) step(rnd() < 0.1 ? B.SHIFT : 0);
          }
        }
        // out of view: the first half of the butterflies for 260 ticks (after 200 they are reset to their start and frozen), then in view again
        d.placePepper(0, 0, 0, 0);
        for (let k = 0; k < bf.length; k += 2) hidden.add(bf[k]);
        for (let t = 0; t < 260 * sc; t++) step(0);
        hidden.clear();
        for (let t = 0; t < 120 * sc; t++) step(0);
        finish(d, label);
      }
    };
    // ---- Spin (the portal spinners), SeaAmin (the shore foam), Sound3d (loads a sound only)
export const misc = async (env) => {
  const { ctx, failures, cover } = env, finish = env.finish;
      for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true]]) {
        const label = `spin/sea/s3d ${dtLabel}`;
        const d = ambientDuel(ctx, { node: 2, dt, seed: 3, kinds: ['Spin', 'SeaAmin', 'Sound3d'], ctors: new Set([CTOR.SPIN, CTOR.SEAAMIN, CTOR.SOUND3D]), maxFail: MAXFAIL, failures });
        d.label = label; d.syncMode = sm; cover.sessions++;
        const W = d.P.world, mem = d.emu.cpu.mem;
        const spinners = W.records.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'Spin')).map((r) => r.index);
        const sea = W.records.findIndex((r) => r.name === 'SEAE'), hse = W.records.findIndex((r) => r.name === 'HSE2');
        const all = [...spinners, sea, hse].filter((i) => i >= 0);
        d.syncPort = () => { for (const i of spinners) d.recToPort(i); const p = d.pnode(sea, 'SeaAmin'), a = d.onode(sea, CTOR.SEAAMIN); if (p) { p.phase = mem.f32(a + 0x18); p.scroll = mem.f32(a + 0x1c); } };
        const step = (held) => {
          d.tick(held); cover.ticks++;
          const gm = d.grazeBegin();
          for (const i of all) d.rec(i, 0xfffe);
          for (const i of spinners) { const n = W.records[i].name, pn = d.pnode(i, 'Spin'), a = d.onode(i, CTOR.SPIN); d.eq(n + '.axis', mem.r16(a + 0x14), pn.axis); d.eq(n + '.face', mem.r16(a + 0x16), pn.face); d.cmp(n + '.rate', mem.f32(a + 0x1c), pn.rate, 0, '', 1e-9); }
          const p = d.pnode(sea, 'SeaAmin'), a = d.onode(sea, CTOR.SEAAMIN);
          if (p) { d.cmp('SEAE.phase', mem.f32(a + 0x18), p.phase, undefined, '', 1e-6); d.cmp('SEAE.scroll', mem.f32(a + 0x1c), p.scroll, undefined, '', 1e-6); d.cmp('SEAE.prevScroll', mem.f32(a + 0x20), p.prevScroll, undefined, '', 1e-6); }
          d.vars(); d.sounds();
          d.grazeEnd(gm);
        };
        for (let t = 0; t < 520 * (dt === 1 ? 1 : 2); t++) step(0);
        finish(d, label);
      }
    };
    // ---- Brikimal (BML1 / BML3: the brick-morph animals; without a brick library the morph object is absent on both sides: FUN_00447d20 -> -1, FUN_00447e60 -> 2 = idle)
export const briki = async (env) => {
  const { ctx, failures, cover } = env, finish = env.finish;
      for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true]]) {
        const label = `brikimal ${dtLabel}`;
        const d = ambientDuel(ctx, { node: 2, dt, seed: 8, kinds: ['Brikimal'], ctors: new Set([CTOR.BRIKIMAL]), maxFail: MAXFAIL, failures });
        d.label = label; d.syncMode = sm; cover.sessions++;
        const W = d.P.world, mem = d.emu.cpu.mem;
        const bm = W.records.filter((r) => r.name === 'BML1' || r.name === 'BML3').map((r) => r.index);
        const NODE = { timerA: [0x28, 'f'], phase: [0x30, 'f'], morphT: [0x34, 'f'], wait: [0x7c, 'f'] };
        d.syncPort = () => { for (const i of bm) { d.recToPort(i); const pn = d.pnode(i, 'Brikimal'), a = d.onode(i, CTOR.BRIKIMAL); d.nodeToPort(pn, a, NODE); pn.toggle = mem.r8(a + 0x38); pn.prevToggle = mem.r8(a + 0x39); } };
        const step = (held) => {
          d.tick(held); cover.ticks++;
          const gm = d.grazeBegin();
          // (the record's flag 2 (visible) is not compared: the original hides the record for its brick-morph object, which needs the brick library the oracle world does not load; the port keeps the plain model visible, its documented fallback)
          for (const i of bm) d.rec(i, 0xfffc);
          d.vars(); d.sounds();
          const s = d.script.settle(); d.eq('rand draws left (original)', 0, s.left); d.eq('rand draws over (port)', 0, s.over);
          for (const i of bm) {
            const n = W.records[i].name, pn = d.pnode(i, 'Brikimal'), a = d.onode(i, CTOR.BRIKIMAL);
            d.eq(n + '.animal', mem.r32(a + 0x24) | 0, pn.animal);
            for (const [f, [off]] of Object.entries(NODE)) d.cmp(`${n}.${f}`, mem.f32(a + off), pn[f], undefined, '', 1e-5);
            d.eq(n + '.toggle', mem.r8(a + 0x38), pn.toggle); d.eq(n + '.prevToggle', mem.r8(a + 0x39), pn.prevToggle);
            for (let k = 0; k < 16; k++) d.cmp(n + '.matrix', mem.f32(a + 0x3c + 4 * k), pn.matrix[k], undefined, `[${k}]`, 3e-5);
            const v = d.getVar(n === 'BML1' ? 0xc3 : 0xe0); cover.shapes[v & 7] = (cover.shapes[v & 7] ?? 0) + 1;
          }
          d.grazeEnd(gm);
        };
        const sc = dt === 1 ? 1 : 2;
        const b1 = W.records.find((r) => r.name === 'BML1'), b3 = W.records.find((r) => r.name === 'BML3');
        // Pepper far away: the 300 tick counter; then next to each animal (within 4.8: it waits; within 16: Enter makes it morph on)
        d.placePepper(0, 0, 0, 0);
        for (let t = 0; t < 420 * sc; t++) step(0);
        for (let round = 0; round < (sm ? 12 : 8); round++) {
          const b = round % 2 ? b3 : b1;
          const dist = [10, 3, 14, 4, 12][round % 5];
          d.placePepper(b.x + dist, b.y, b.z, 0);
          for (let t = 0; t < 60 * sc; t++) step(t % 7 === 3 ? B.ENTER : 0);
          d.placePepper(0, 0, 0, 0);
          for (let t = 0; t < 140 * sc; t++) step(0);
        }
        finish(d, label);
      }
    };


// ---- Music (the island's music director on PEPP)
export const music = async (env) => {
  const { ctx, failures, cover } = env, finish = env.finish;
  const MAXFAIL = 30;
  for (const [node, label0, dt] of [[2, 'town', 1], [2, 'town', 0.5], [10, 'bots', 1], [30, 'bots+radio', 1], [52, 'bots+radio', 1], [61, 'bots', 1]]) {
    const label = `music node ${node} (${label0}) dt${dt}`;
    const d = ambientDuel(ctx, { node, dt, seed: 4, kinds: ['Music'], ctors: new Set(), pepperFirstKinds: ['Music'], pepperFirstCtors: new Set([CTOR.MUSIC]), maxFail: MAXFAIL, failures,
      beforeAttach: (emu, duel) => hostMusic(emu, duel) });
    d.label = label; d.syncMode = false; cover.sessions++;
    portMusic(d);
    const W = d.P.world, mem = d.emu.cpu.mem, pi = d.P.pepper.index;
    const mn = d.pnode(pi, 'Music'), ma = d.onode(pi, CTOR.MUSIC);
    const rnd = lcg(node * 7 + 1);
    const bld = ['INFC', 'RADI', 'PIZB', 'HSE3', 'POLB'].map((n) => W.records.find((r) => r.name === n));
    // the original's constructor ran at attach time (its engine calls are in the emulation's log before the first pass); the port's runs in its first update
    let ctorLog = d.emu.log.filter((l) => MUSIC_RE.test(l));
    const step = (held = 0) => {
      d.tick(held); cover.ticks++;
      const o = [...ctorLog, ...d.olog.filter((l) => MUSIC_RE.test(l))]; ctorLog = [];
      const p = d.psnd.filter((l) => MUSIC_RE.test(l));
      d.checked++; if (o.join('|') !== p.join('|')) d.fail(`${label} t${d.t} music calls: original ${o.join(' | ')} port ${p.join(' | ')}`);
      for (const l of o) cover.musicCalls[l] = (cover.musicCalls[l] ?? 0) + 1;
      d.rec(pi, 0xfffe);
      d.eq('Music.mode', mem.r32(ma + 0x48) | 0, mn.mode); d.eq('Music.building', mem.r8(ma + 0x4c), mn.building); d.eq('Music.main', mem.r8(ma + 0x54), mn.main);
      d.eq('Music.grooveWant', mem.r32(ma + 0x58) | 0, mn.grooveWant); d.eq('Music.grooveCur', mem.r32(ma + 0x5c) | 0, mn.grooveCur); d.eq('Music.node', mem.r32(ma + 0x60) | 0, mn.node);
      d.eq('Music.last', mem.r32(ma + 0x68) | 0, mn.last); d.eq('Music.sub', mem.r32(ma + 0x6c) | 0, mn.sub); d.eq('Music.flag', mem.r8(ma + 0x70), mn.flag); d.eq('Music.timer', mem.r32(ma + 0x74) | 0, mn.timer);
      d.vars();
    };
    const setCtl = (v) => { d.setVar(0x5e, v); };
    const clip = (c) => { d.O.pepper.anim?.start(c, 0); d.P.pepper.anim?.start(c, 0); };
    const note = () => { d.note = rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 3); };
    d.placePepper(0, 30, 0, 0);
    for (let t = 0; t < 8; t++) step();
    // walk the town: next to each building (within 40: its segment; the first of Info, Laura, Papa, Mama, Nick wins), away again; notifications flip the theme; the groove follows the mode / run clip
    for (let round = 0; round < 3; round++) for (let b = 0; b < bld.length; b++) {
      const r = bld[b];
      for (const dist of [60, 30, 20]) {
        d.placePepper(r.x + dist, r.y, r.z, 0);
        for (let t = 0; t < 14 / dt; t++) { if (rnd() < 0.04) note(); if (t % 5 === 0) setCtl([1, 4, 8, 0x40, 0x401, 2][Math.floor(rnd() * 6)]); if (t % 6 === 0) clip([0x1b, 0x24, 0x3f, 0x40, 0xd][Math.floor(rnd() * 5)]); step(); }
      }
    }
    // a long quiet stretch: the debounce (120 ticks) between notifications
    d.placePepper(0, 30, 0, 0); setCtl(1);
    for (let t = 0; t < 700 / dt; t++) { if (t % 90 === 0) note(); step(); }
    // story node 0x38 outside a cutscene switches to the radio (the node's own var 0x58)
    d.setVar(0x58, 0x38); for (let t = 0; t < 6; t++) step();
    d.cutscene(true); d.setVar(0x58, 0x37); for (let t = 0; t < 3; t++) step(); d.setVar(0x58, 0x38); for (let t = 0; t < 6; t++) step(); d.cutscene(false); for (let t = 0; t < 6; t++) step();
    finish(d, label);
  }
};


// ---- BOTMUSIC (the dancing bricksterbots) and GETO (the ghetto blaster), era 3 (story node 52)
export const bots = async (env) => {
  const { ctx, failures, cover } = env, finish = env.finish;
  const MAXFAIL = 30;
  for (const [dtLabel, dt, sm] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true]]) {
    const label = `bots ${dtLabel}`;
    const d = ambientDuel(ctx, { node: 52, dt, seed: 6, kinds: ['BOTMUSIC', 'GETO'], ctors: new Set([CTOR.BOTMUSIC, CTOR.GETO]), maxFail: MAXFAIL, failures,
      beforeAttach: (emu, duel) => {
        hostMusic(emu, duel);
        // FUN_0043f2f0(model, n): the face expression of a record's model (a render call: logged with the record)
        emu.cpu.hooks.set(0x43f2f0, (c) => { emu.log.push(`expr ${(c.arg(0) - 0x40000000) / 0x100} ${c.arg(1)}`); });
        emu.cpu.invalidate();
      } });
    d.label = label; d.syncMode = sm; cover.sessions++;
    portMusic(d);
    d.P.ictx.expression = (rec, n) => d.psnd.push(`expr ${rec.index} ${n}`);
    const W = d.P.world, mem = d.emu.cpu.mem;
    giveAnims(d, 'MFIG', /^BB[A-Z]\d$/);
    const bi = W.records.filter((r) => /^BB[A-Z]\d$/.test(r.name)).map((r) => r.index);
    const geto = W.records.findIndex((r) => r.name === 'GETO');
    const cd = bi.filter((i) => d.pnode(i, 'BOTMUSIC'));
    // fx calls: the port labels an emitter by the record whose matrix it follows (the bot's node buffer: no record), the original by the matrix pointer: names only
    const norm = (l) => l.replace(/@-?[\d.e+-]+/, '');
    d.syncPort = () => { for (const i of cd) { d.recToPort(i); const pn = d.pnode(i, 'BOTMUSIC'), a = d.onode(i, CTOR.BOTMUSIC); pn.timer = mem.f32(a + 0x18); } d.recToPort(geto); };
    const RE = /^(expr|fxg|fxm|fxp|mut) /;
    let wasHidden = true;
    const step = (held = 0) => {
      d.tick(held); cover.ticks++;
      const gm = d.grazeBegin();
      for (const i of cd) d.rec(i, 0xfffe);
      d.rec(geto, 0xfffe);
      d.vars();
      const o = d.olog.filter((l) => RE.test(l)).map(norm), p = d.psnd.filter((l) => RE.test(l)).map(norm);
      d.checked++; if (o.join('|') !== p.join('|')) d.fail(`${label} t${d.t} (story node ${d.getVar(0x58)}) bot calls: original ${o.join(' | ')} port ${p.join(' | ')}`);
      for (const l of o) cover.botCalls[l.split(' ').slice(0, 2).join(' ').replace(/ \d+$/, '')] = (cover.botCalls[l.split(' ').slice(0, 2).join(' ').replace(/ \d+$/, '')] ?? 0) + 1;
      for (const i of cd) {
        const n = W.records[i].name, pn = d.pnode(i, 'BOTMUSIC'), a = d.onode(i, CTOR.BOTMUSIC);
        d.cmp(n + '.timer', mem.f32(a + 0x18), pn.timer, undefined, '', 1e-4);
        for (let k = 0; k < 16; k++) d.cmp(n + '.fxMat', mem.f32(a + 0x1c + 4 * k), pn.fxMat[k], undefined, `[${k}]`, 1e-3);
        const oa = d.O.world.records[i].anim, pa = W.records[i].anim;
        if (pa) { d.eq(n + ' clip', oa.clip, pa.clip); d.cmp(n + ' frame', oa.frame, pa.frame, undefined, '', 1e-4); }
        if (mem.r32(a + 0x18)) cover.dancing++;
      }
      const g = d.pnode(geto, 'GETO'), ga = d.onode(geto, CTOR.GETO);
      if (g) { d.cmp('GETO.scale', mem.f32(ga + 0x1c), g.scale, undefined, '', 1e-5); d.cmp('GETO.phase', mem.f32(ga + 0x24), g.phase, undefined, '', 1e-5); }
      d.grazeEnd(gm);
    };
    const sc = dt === 1 ? 1 : 2;
    const rnd = lcg(2);
    const bots_ = cd.map((i) => W.records[i]);
    d.placePepper(0, 20, 0, 0); d.setVar(0x22, 0);
    for (let t = 0; t < 10; t++) step();
    // radio on, Pepper next to each bot (within 24: it dances: the clip 0xfa at rate 1 .. 5 growing every 120 ticks, the emitter), then walking away (the timer runs down 5 per tick), back, radio off
    d.setVar(0x22, 1);
    for (let k = 0; k < bots_.length; k++) {
      const b = bots_[k];
      d.placePepper(b.x + 6, b.y, b.z, 0);
      for (let t = 0; t < 300 * sc; t++) step();
      d.placePepper(b.x + 80, b.y, b.z, 0);
      for (let t = 0; t < 70 * sc; t++) step();
      if (k % 3 === 0) { d.placePepper(b.x + 6, b.y, b.z, 0); for (let t = 0; t < 40 * sc; t++) step(); d.setVar(0x22, 0); for (let t = 0; t < 10 * sc; t++) step(); d.setVar(0x22, 1); }
    }
    // the ghetto blaster: story nodes 0x38 .. 0x3c show it (var 0x22 on, the pulsing scale, the matrix at Pepper's bone 16), other nodes hide it
    d.setVar(0x22, 0);
    for (const node of [0x37, 0x38, 0x3a, 0x3c, 0x3d, 0x38]) { d.setVar(0x58, node); d.placePepper(0, 20, 0, 0.5); for (let t = 0; t < 60 * sc; t++) step(); }
    void rnd;
    finish(d, label);
  }
};
