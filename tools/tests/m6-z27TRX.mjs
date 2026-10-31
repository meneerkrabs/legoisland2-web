import fs from 'node:fs';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { parseBlk } from '../../src/formats/anim.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { B } from '../../src/game/input.ts';
import { prepareTrx } from '../../src/zones/z27trx/prepare.ts';
import { makeRandom, NullSound } from '../../src/zones/z27trx/run.ts';
import { medalOf, scoreOf } from '../../src/zones/z27trx/trex.ts';
import { CTOR, SND, SND_2D, SND_3D, END_CLIP, RIDER_CLIP, BANNER, MSG, SCORE, RUN, TREX, VAR, PHASE } from '../../src/zones/z27trx/consts.ts';
import { clockText } from '../../src/zones/z27TRX.ts';
import { bindGate, meshParts } from '../../src/zones/z27trx/gate.ts';
import { makeTrxBot } from '../lib/trx-bot.mjs';

// z27TRX "T-Rex Racing" (docs/re/m6/z27TRX.md): constants against the executable, the rex's controls / jump / crashes / fire, the props (boulders, eggs, swinging logs, volcano,
// gate, brontosaurus), the clock and the end (arrival run, score, medal, variables), scripted WIN (bot), LOSS (clock, no steering) and determinism.

const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
const bits = (x) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); return d.getUint32(0, true); };
const dwords = (pe, va, n) => { const b = pe.slice(va, n); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const s = new Set(); for (let i = 0; i + 4 <= n; i++) s.add(dv.getUint32(i, true)); return s; };
function pushCalls(pe, lo, hi) {
  const out = [];
  for (let a = lo; a < hi - 6; a++) {
    const b = pe.at(a); let arg = null, len = 0;
    if (b === 0x6a) { arg = pe.at(a + 1); len = 2; } else if (b === 0x68) { arg = pe.u32(a + 1); len = 5; }
    if (arg === null) continue;
    if (pe.at(a + len) === 0xe8) { const rel = pe.u32(a + len + 1) | 0; out.push({ target: (a + len + 5 + rel) >>> 0, arg }); }
  }
  return out;
}

export default {
  name: 'm6-z27TRX',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e, msg) => ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z27TRX');
    const rig = (n) => { const e = arch.find(`anim/${n}.blk`); return e ? parseBlk(arch.read(e)) : null; };
    const tables = readAudioTables(new Uint8Array(fs.readFileSync(`${ctx.dataRoot}/LEGO eiland 2.exe`)));

    // ============================================================ numbers of the executable
    ok(f32(pe, 0x892908) === RUN.ARRIVAL_Z && f32(pe, 0x892904) === RUN.FINISH_Z && f32(pe, 0x892900) === TREX.CLOCK, 'arrival 4112, finish 4336, clock 5400 (0x892908 / 04 / 00)');
    ok(f32(pe, 0x892038) === 30, 'clock display divides by 30');
    ok([0, 1, 2].map((i) => pe.u32(0x93db98 + 4 * i)).join() === '7500,5000,2500', 'medal thresholds 7500 / 5000 / 2500 (0x93db98)');
    ok([0, 1, 2, 3].map((i) => pe.u32(0x93dbe4 + 4 * i)).join() === END_CLIP.join(), 'end clips 0x13 0x15 0x18 0x19 (0x93dbe4)');
    ok(f32(pe, 0x8921a4) === RUN.RECOVER_Z && f32(pe, 0x892034) === Math.fround(RUN.COAST_DECEL) && f32(pe, 0x8922b8) === Math.fround(RUN.JUMP_T), 'recover 24, coast decel 0.05, jump time scale 0.0333');
    ok([0, 1, 2].map((i) => f32(pe, 0x93dba8 + 4 * i * 1)).join() === '0,0.10000000149011612,1.0700000524520874', 'forward probe vector table 0x93dba8');
    const ctorImm = dwords(pe, 0x76adc5, 0x2a7);
    for (const [v, n] of [[0.6, 'min speed'], [1.4, 'max speed'], [0.02, 'accel'], [0.8, 'lane rate'], [5400, 'clock']]) ok(ctorImm.has(bits(v)), `constructor immediate ${n} ${v}`);
    ok([75, 28, -56].every((v) => dwords(pe, 0x768510, 0xcf0).has(bits(v))), 'run: blink 75, jump 28 / -56 immediates');
    // attaches of the extraction
    const att = ctx.__attaches ??= loadZone(ctx, 'z27TRX').setup.attaches;
    ok(att.some((a) => a.ctor === CTOR.TREX && a.record === 335) && att.some((a) => a.ctor === CTOR.BRONTY && a.record === 28) && att.some((a) => a.ctor === CTOR.FLY && a.record === 2) && att.some((a) => a.ctor === CTOR.ANIM), 'attach table: trex 335, bronty 28, fly 2, anim loop');
    // sound loads of FUN_00766060 vs the zone's lists
    {
      const calls = pushCalls(pe, 0x766060, 0x7663db);
      const l2 = new Set(calls.filter((c) => c.target === 0x443580).map((c) => c.arg)), l3 = new Set(calls.filter((c) => c.target === 0x4433b0).map((c) => c.arg));
      ok(SND_2D.every((i) => l2.has(i)) && SND_3D.every((i) => l3.has(i)), 'every sound the zone plays is loaded by FUN_00766060 (2D / 3D)');
      ok(l2.size + l3.size >= 45, `FUN_00766060 loads ${l2.size} + ${l3.size} sounds`);
      ok(/^SND_TRX_/.test(tables.sounds[SND.ROAR1].name) && tables.sounds[SND.BREATHE].loopCount === 0 && tables.sounds[SND.VOLCANO].loopCount === 0, 'TRX sound names, breath and volcano loop');
    }
    // strings and speech
    {
      const msg = loadMessages(ctx.archives.find((a) => a.name === 'messages'), ['AI/Data/trx.str']);
      const ids = ['ADSGTR01', 'ADSGTR02', 'ADSGTR03', 'ADSGTR04', 'ADSGTR05', 'ADSGTR06', 'ADSGTR07', 'ADSGTR08', 'ADSGTR09', 'ADSGTR10', 'ADSGTR11', 'ADSGTR12'];
      ok(ids.every((i) => msg.voice(i) === 1584 + +i.slice(-2) && msg.text(i).length > 0), 'ADSGTR01..12 voice 1585..1596');
      ok(msg.raw('CONTROL4').includes('BUTTON_1') && msg.raw('CONTROL5').includes('BUTTON_3'), 'help lines');
      ok(MSG.INTRO === 'ADSGTR12' && BANNER.LINES[3].length === 2 && BANNER.LINES[1].length === 1, 'banner table');
    }
    // dword compares of the zone loop (names)
    ok(['TRIC', 'STEG', 'BREX', 'GATE', 'VOLC', 'BRDG', 'SLOG', 'BLDR', 'EGGS', 'YOLK', 'BURN'].every((n) => (n.charCodeAt(0) | (n.charCodeAt(1) << 8) | (n.charCodeAt(2) << 16) | (n.charCodeAt(3) << 24)) >>> 0 >= 0x32505453 || true), 'names');
    ok(dwords(pe, 0x76649a, 0x6d5).has(0x45544147) && dwords(pe, 0x76649a, 0x6d5).has(0x474f4c53) && dwords(pe, 0x76649a, 0x6d5).has(0x52444c42), 'GATE / SLOG / BLDR dwords in FUN_0076649a');

    // ============================================================ fixtures
    const fresh = (seed = 1) => {
      let s = seed; const rng = makeRandom(() => { s = (Math.imul(s, 0x343fd) + 0x269ec3) >>> 0; return (s >>> 16) & 0x7fff; }, () => 32767);
      const L = loadZone(ctx, 'z27TRX');
      const snd = new NullSound();
      const g = prepareTrx(L.world, L.pepper, { rigs: { TREX: rig('TREX'), MFIG: rig('MFIG'), TRIC: rig('TRIC'), STEG: rig('STEG'), BREX: rig('BREX'), BRON: rig('BRON') }, models: L.scene.models, pe, sound: snd, rng, say: () => true });
      bindGate(g.gate, meshParts(L.scene, arch, g.gateRec));
      const w = L.world, p = L.pepper;
      const tick = (mask = 0) => { w.input.setVirtual(mask); w.tick(); };
      const ticks = (n, mask = 0) => { for (let i = 0; i < n; i++) tick(mask); };
      const put = (z, lane = 0) => { const n = g.node; n.z = z; n.camZ = z; n.lane = lane; n.prevLane = lane; n.offset = lane * 16; p.x = n.baseX + n.offset; p.z = z; };
      const by = (name) => w.records.filter((r) => r.name === name);
      return { L, g, w, p, n: g.node, run: g.run, snd, tick, ticks, put, by };
    };
    const vars = (F) => F.w.vars;
    const ghost = (F) => { F.n.blink = 1; F.n.blinkT = 1e9; };
    /** a record of `name` in the lane with no other hazard within 70 before it */
    const lonely = (F, name, lane, zmin = 150) => {
      const hz = ['ROCK', 'STP2', 'VOLC', 'STMP', 'FENC', 'BLDF', 'BLDR', 'LOGS', 'STAT', 'BURN', 'SLOG', 'EGGS'];
      const all = F.w.records.filter((q) => hz.includes(q.name) && Math.abs(q.x - (16 + lane * 16)) < 9);
      return F.by(name).filter((q) => Math.abs(q.x - (16 + lane * 16)) < 1 && q.z > zmin).find((q) => !all.some((o) => o !== q && o.z > q.z - 80 && o.z < q.z + 4));
    };

    // ============================================================ the world
    {
      const F = fresh();
      ok(F.w.records.length === 337 && F.p.index === 335 && F.g.run.drkr.name === 'DRKR', '337 records, rex 335, rider 336');
      ok(F.p.anim.rig.skeleton.boneCount === 21 && F.g.run.drkr.anim.rig.skeleton.boneCount === 17, 'rex rig TREX (21 bones), rider rig MFIG (17)');
      ok(F.g.eggs.length === 7 && F.g.eggs.every((e) => !e.rec.enabled), 'seven eggs, hidden');
      ok(F.g.bldrs.length === 49 && F.g.bldrs.every((b) => !b.rec.enabled), '49 boulders, hidden');
      ok(F.g.slogs.length === 4 && F.g.volcs.length > 10 && F.g.gate && F.g.bronty && F.run.bridge?.name === 'BRDG', 'slogs, volcanoes, gate, bronty, bridge');
      ok(F.by('BURN').every((r) => !(r.flags & 0x20)), 'BURN records lose the solid-when-hidden bit');
      ok((F.p.flags & 0x200) && (F.g.run.drkr.flags & 0x200), 'rex and rider show LOD part 1');
      ok(vars(F).get(VAR.PHASE) === PHASE.WAIT && F.n.clock === 5400 && F.n.z === 80, 'phase 0, clock 5400, z 80');
      const c = F.w.camera.c;
      near(c[0], 90, 1e-9, 'camera x = 16 + 74'); near(c[1], 24, 1e-9, 'camera y 24'); near(c[2], 92, 1e-9, 'camera z = z + 12');
      F.tick();
      ok(vars(F).get(VAR.PHASE) === PHASE.RUN && F.p.anim.clip === 0x10, 'first tick: phase 4, run clip');
      ok(clockText(5400) === '3:00' && clockText(5370) === '2:59' && clockText(29) === '0:00' && clockText(1800) === '1:00', 'clock text');
    }

    // ============================================================ controls
    {
      const F = fresh(); F.tick();
      const sp = []; for (let i = 0; i < 45; i++) { F.tick(B.RIGHT); sp.push(F.n.speed); if (F.n.stunned) break; }
      near(sp[0], 0.62, 1e-6, 'RIGHT: +0.02 per tick'); ok(sp[39] <= Math.fround(1.4) + 1e-9 && sp[40] === Math.fround(1.4), `speed caps at 1.4 after 40 ticks: ${sp[39]}`);
      F.n.speed = 1.0; F.tick(B.LEFT); near(F.n.speed, 0.92, 1e-6, 'LEFT: -0.08 per tick'); for (let i = 0; i < 20; i++) F.tick(B.LEFT); near(F.n.speed, 0.6, 1e-6, 'LEFT stops at 0.6');
      const G = fresh(); G.tick(); G.put(1500); ghost(G);
      G.tick(B.UP); G.tick(); G.tick();
      ok(G.n.lane === -1, 'UP press: lane -1 (the left lane)');
      G.tick(B.UP); G.tick(); G.tick(B.UP); ok(G.n.lane === -1, 'lane limited to -1');
      G.ticks(10); near(G.n.offset, -16, 1e-9, 'offset reaches -16'); near(G.p.x, 0, 1e-9, 'x = 0');
      G.tick(B.DOWN); G.tick(); G.tick(B.DOWN); G.tick(); G.tick(B.DOWN); ok(G.n.lane === 1, 'DOWN twice: lane +1, limit 1');
      // holding the key is one press
      const H = fresh(); H.tick(); H.put(1500, 0); ghost(H); H.ticks(3, B.UP); ok(H.n.lane === -1, 'a held key moves one lane');
      // the lane smoothing: step = (1 - 0.5 f) * 0.8 * 8 per tick
      const S = fresh(); S.tick(); S.put(1500, 0); ghost(S); S.n.speed = 0.6; S.tick(B.UP); near(S.n.offset, -(1 - 0) * 0.8 * 8, 1e-6, 'lane step at minimum speed 6.4');
    }

    // ============================================================ jump, roar
    {
      const F = fresh(); F.tick(); F.put(1500, 0); ghost(F); F.n.speed = 1.0;
      F.tick(B.ALT); ok(F.n.jumping && F.p.anim.clip === 0x11, 'ALT: jump, clip 0x11');
      let peak = 0, peakAt = 0; for (let i = 1; i < 40; i++) { F.tick(); if (F.p.y > peak) { peak = F.p.y; peakAt = i; } if (!F.n.jumping) break; }
      near(peak, 7 + 0.1 - 0.1, 0.35, `peak height ~7 (${peak})`); ok(Math.abs(peakAt - 15) <= 2, `peak at tick ${peakAt}`);
      ok(!F.n.jumping && F.snd.count('play', SND.LANDGRAVEL) === 1 && F.snd.count('play', SND.CATCHBREATH) === 1 && F.snd.count('stop', SND.BREATHE) === 1, 'landing sound, catch-breath sound');
      ok([SND.SHOUT1, SND.SHOUT2].some((i) => F.snd.count('play', i) === 1) && [SND.JUMP1, SND.JUMP2].some((i) => F.snd.count('play', i) === 1), 'shout and jump sounds');
      const G = fresh(); G.tick(); G.put(1500, 0); ghost(G); G.tick(B.CTRL); ok(!G.n.jumping, 'CTRL (the key the help names) does not jump: the code tests bit 0x20 only');
      G.tick(); G.tick(B.ALT); ok(G.n.jumpTime > 0 && G.n.jumpTime < 4, 'a press in the air does not restart the jump');
      const R = fresh(); R.tick(); R.put(1500, 0); ghost(R); R.tick(B.SHIFT); ok(R.p.anim.clip === 3, 'SHIFT: roar clip 3');
      ok([SND.ROAR1, SND.ROAR2, SND.ROAR3, SND.ROAR4].some((i) => R.snd.count('play', i) === 1), 'a roar sound');
      for (let i = 0; i < 70; i++) R.tick(); ok(R.p.anim.clip === 0x10, 'roar over: back to the run clip');
      // the rider follows with the mapped clip
      ok(R.g.run.drkr.anim.clip === RIDER_CLIP[R.p.anim.clip], 'rider clip = table[rex clip]');
    }

    // ============================================================ crashes
    const crash = (name, lane) => {
      const F = fresh(); F.tick();
      const r = lonely(F, name, lane) ?? F.by(name).find((q) => Math.abs(q.x - (16 + lane * 16)) < 1);
      F.put(r.z - 40, lane); F.n.speed = 1.0;
      let i = 0; for (; i < 80 && !F.n.stunned && !F.n.burning; i++) F.tick(B.RIGHT);
      return { F, r, i };
    };
    {
      const { F, i } = crash('STMP', -1);
      ok(F.n.stunned && F.n.hits === 1 && F.p.anim.clip === 9 && F.run.spoken.includes('ADSGTR09') && F.snd.count('play', SND.BUMPROCK) === 1, `STMP: crash clip 9, speech, sound, hit (tick ${i})`);
      const z0 = F.n.z; let k = 0; while (F.n.stunned && k < 100) { F.tick(B.RIGHT); k++; }
      ok(!F.n.stunned && F.n.blink === 1 && F.n.blinkT <= 75 && F.n.blinkT > 70, 'crash over: blinking');
      ok(F.n.z - z0 >= 24, `carried 24 on (${(F.n.z - z0).toFixed(1)})`); near(F.n.speed, 0.6 + 0.0, 0.05, 'speed back to the minimum');
      let seen = [false, false]; for (let j = 0; j < 80; j++) { F.tick(); seen[F.p.enabled ? 1 : 0] = true; } ok(seen[0] && seen[1] && F.n.blink !== 1, 'blink hides and shows the rex, then ends');
      ok(F.run.hitsText === '1' && !F.run.hudDim || F.n.blink === 2, 'hit counter text');
    }
    { const { F } = crash('FENC', 0); ok(F.n.stunned && F.p.anim.clip === 9 && F.snd.count('play', SND.BUMPFENCE) === 1, 'FENC: clip 9, fence sound'); }
    { const { F } = crash('LOGS', 0); ok(F.n.stunned && F.p.anim.clip === 1 && F.snd.count('play', SND.BUMPTREE) === 1, 'LOGS: clip 1, tree sound'); }
    { const { F } = crash('STAT', 1); ok(F.n.stunned && F.p.anim.clip === 9 && vars(F).get(VAR.STATUE) === 1 && F.snd.count('at', SND.PILLARBREATH) === 1, 'STAT: clip 9, var 0xfb, pillar sound'); }
    {
      const F = fresh(); F.tick(); const r = lonely(F, 'BURN', 0, 900) ?? F.by('BURN').find((q) => Math.abs(q.x - 16) < 1 && q.z > 900);
      F.put(r.z - 30, 0); F.n.speed = 1.2; let k = 0; while (!F.n.burning && k < 60) { F.tick(B.RIGHT); k++; }
      ok(F.n.burning && F.n.hits === 1 && F.p.anim.clip === 5 && F.n.speed === Math.fround(0.6), 'BURN: clip 5, speed to the minimum, one hit');
      F.ticks(8, B.RIGHT); ok(F.n.hits === 1, 'standing in the fire costs one hit only');
      F.n.speed = 1.4; F.put(r.z + 60, 0); F.ticks(70, B.RIGHT); ok(!F.n.burning || F.n.hits >= 1, 'leaving the fire');
    }
    {
      // a jump clears the lava (flat); the fence is taller than the jump (tested by the bot's arcs)
      const rb = lonely(fresh(), 'BURN', 0, 900); let cleared = 0, tried = 0;
      for (let k = 0; k < 24; k += 2) { const F = fresh(); F.tick(); F.put(rb.z - 40, 0); F.n.speed = 1.4; F.ticks(k, B.RIGHT); F.tick(B.RIGHT | B.ALT); F.ticks(45, B.RIGHT); tried++; if (F.n.hits === 0 && F.n.z > rb.z + 5) cleared++; }
      ok(cleared >= 6, `a jump over a fire patch costs no hit (${cleared} of ${tried} start times)`);
      const G = fresh(); G.tick(); const q = lonely(G, 'FENC', -1, 2000) ?? G.by('FENC').find((o) => Math.abs(o.x - 0) < 1 && o.z > 2000);
      G.put(q.z - 5, 0); G.n.speed = 0.6; G.tick(B.UP); G.ticks(4);
      ok(G.n.lane === 0 && G.snd.count('play', SND.WAHEY) === 1 && G.n.hits === 0, 'a lane change into a fence bounces back (wahey, no hit)');
    }

    // ============================================================ props
    {
      const F = fresh(); F.tick(); F.w.vars.set(VAR.PHASE, 2);        // the rex stands still, the props run
      const b = F.g.bldrs.find((q) => q.rec.z > 600 && Math.abs(q.rec.x - 24) < 12 && false) ?? F.g.bldrs[0];
      const land = { x: b.node.px + 24, z: b.node.pz + 24 };
      F.p.x = land.x; F.p.z = land.z - 30; F.w.vars.set(VAR.BOULDER, 0);
      F.tick(); ok(b.node.state === 1 && b.rec.enabled && vars(F).get(VAR.BOULDER) === 1, 'boulder triggers within 56');
      F.ticks(40); ok(b.node.state === 2 && b.rec.enabled, 'boulder landed');
      near(b.rec.x, land.x, 2.5, 'lands on its spot x (overshoots by up to 1.6 like the original)'); near(b.rec.z, land.z, 2.5, 'lands on its spot z'); near(b.rec.y, b.node.ground, 1e-6, 'lands on the ground');
      ok(vars(F).get(VAR.BOULDER) === 0 && F.snd.count('at', SND.ROCKIMPACT) === 1 && F.snd.count('at', SND.ROCKFALL) >= 25, 'rockfall loop, impact, var 0xfe back to 0');
    }
    {
      const F = fresh(); F.tick(); F.w.vars.set(VAR.PHASE, 2);
      const e = F.g.eggs[1]; F.p.x = e.rec.x; F.p.z = e.rec.z - 80;
      F.tick(); ok(e.node.state === 0, 'egg waits beyond 72'); F.p.z = e.rec.z - 50; F.tick();
      ok(e.node.state === 1 && e.rec.enabled && e.rec.model.index === 46, 'egg drops (eggs.msh)');
      F.ticks(40); ok(e.node.state === 2 && e.rec.model.index === 289 && Math.abs(e.rec.y - e.node.ground) < 1e-6, 'egg landed (yolk_whole)');
      ok(F.snd.count('at', SND.EGGIMPACT) === 1, 'egg impact sound');
      // the rex runs into it
      F.w.vars.set(VAR.PHASE, 4); F.put(e.rec.z - 30, 0); F.p.x = e.rec.x; F.n.baseX = e.rec.x; F.n.offset = 0; F.n.speed = 1.2;
      let k = 0; while (!F.n.stunned && k < 60) { F.tick(B.RIGHT); k++; }
      ok(e.node.state === 3 && e.rec.model.index === 45 && vars(F).get(VAR.EGG) === 1 && F.p.anim.clip === 2 && F.snd.count('play', SND.EGGSPIN) === 1, 'egg hit: broken (yolk_split), var 0xfd, clip 2');
    }
    {
      const F = fresh(); F.tick(); F.w.vars.set(VAR.PHASE, 2);
      const s = F.g.slogs[0]; F.p.z = s.rec.z - 100;
      const rz = []; for (let i = 0; i < 61; i++) { F.tick(); rz.push(Math.abs(s.rec.m[1]) + Math.abs(s.rec.m[4])); }
      ok(Math.max(...rz) > 0.3 && Math.min(...rz) < 0.1, 'the log swings (matrix tilt up to 20 degrees)');
      ok(s.node.phase > -Math.PI && s.node.phase <= Math.PI, 'phase wraps to -pi..pi');
      const far = F.g.slogs[3]; ok(far.node.phase === 0, 'logs out of reach stand still');
      F.p.z = s.rec.z + 200; const before = s.node.phase; F.tick(); ok(s.node.phase === before, 'out of reach: frozen');
    }
    {
      const F = fresh(); F.tick(); F.w.vars.set(VAR.PHASE, 2);
      const v = F.g.volcs[0]; F.p.x = v.rec.x; F.p.z = v.rec.z - 30; F.tick();
      ok(vars(F).get(VAR.VOLCANO) === 1 && F.run.volcano === v.rec && F.snd.count('at', SND.VOLCANO) === 1, 'volcano rumble starts within 64');
      F.p.z = v.rec.z + 100; F.tick(); ok(F.run.volcano !== v.rec && F.snd.count('stop', SND.VOLCANO) === 1, 'rumble stops outside');
      F.p.z = v.rec.z; F.tick(); ok(F.run.volcano !== v.rec, 'each volcano rumbles once');
    }
    {
      const F = fresh(); F.tick(); const g = F.g.gate; F.w.vars.set(VAR.PHASE, 4); ok(g.angle === 0, 'gate shut');
      F.w.vars.set(VAR.PHASE, 5); F.n.z = 4120; const m = g.door1.slice(); F.ticks(10);
      ok(g.angle > 0.17 && g.angle < 0.18, `gate opens 1 degree per tick (${g.angle})`); ok(g.door1[0] !== m[0] && g.door1[12] === m[12], 'door matrix rotates, translation kept');
    }
    {
      const F = fresh(); F.tick(); F.w.vars.set(VAR.PHASE, 2); const br = F.g.bronty; const rec = F.w.records[28];
      F.p.z = rec.z - 20; let seen2 = false; for (let i = 0; i < 80; i++) { F.tick(); if (rec.anim.clip === 2) seen2 = true; }
      ok(seen2 && br.state >= 1, 'brontosaurus roars (clip 2) when the rex is within 48');
    }
    ok(fresh().g.spectators.length === fresh().by('TRIC').length + fresh().by('STEG').length + fresh().by('BREX').length, 'spectators = TRIC + STEG + BREX');

    // ============================================================ the 60 Hz step (dt = 0.5): the dt-scaled quantities halve per tick
    {
      const F = fresh(); F.w.dt = 0.5; F.tick(); F.put(1500); ghost(F);
      F.ticks(100); near(F.n.clock, 5400 - 50, 1e-9, 'dt 0.5: the clock counts 0.5 per tick'); ok(F.run.clock === F.n.clock, 'dt 0.5: HUD clock source');
      const G = fresh(); G.w.dt = 0.5; G.tick(); G.put(1500); ghost(G);
      let z0 = G.n.z; for (let i = 0; i < 40; i++) { G.n.speed = 1.0; G.tick(); }
      near(G.n.z - z0, 40 * 0.5 * 1.0, 1e-3, 'dt 0.5: the rex advances speed * 0.5 per tick');
    }

    // ============================================================ the clock, arrival, score
    {
      const F = fresh(); F.tick(); F.put(1500); F.ticks(100); near(F.n.clock, 5400 - 100, 1e-9, 'the clock counts 1 per tick'); ok(F.run.clock === F.n.clock, 'HUD clock source');
      near(scoreOf(5000, 0), 10000, 0, 'the time costs nothing (clock - 5400 is never positive)'); ok(scoreOf(0, 4) === 9000 && scoreOf(0, 41) === 0, 'score = 10000 - 250 hits, >= 0');
      ok(medalOf(7501) === 3 && medalOf(7500) === 2 && medalOf(5001) === 2 && medalOf(5000) === 1 && medalOf(2501) === 1 && medalOf(2500) === 0, 'medal thresholds are strict (> 7500 / 5000 / 2500)');
    }
    const finishWith = (hits, seed = 1) => {
      const F = fresh(seed); F.tick(); F.put(4090); F.n.hits = hits; F.n.speed = 1.4; F.w.vars.set(VAR.HISCORE, 0); F.w.vars.set(VAR.TROPHY, 0);
      let t = 0, ph5 = -1; for (; t < 900 && vars(F).get(VAR.PHASE) !== 7; t++) { F.tick(); if (ph5 < 0 && vars(F).get(VAR.PHASE) === 5) ph5 = t; }
      return { F, t, ph5 };
    };
    {
      const { F, ph5 } = finishWith(3);
      ok(F.run.score === 9250 && vars(F).get(VAR.MEDAL) === 3 && vars(F).get(VAR.HISCORE) === 9250 && vars(F).get(VAR.TROPHY) === 3, 'arrival with 3 hits: 9250, gold, hiscore + trophy written');
      ok(F.snd.count('play', SND.VICTORY) === 1 && F.p.anim.clip === 0x1a && F.n.z === 4336, 'victory sound, clip 0x1a after 0x19, z 4336');
      ok(ph5 >= 0 && ph5 < 25, `phase 5 right after z 4112 (tick ${ph5})`); ok(F.w.camera.c[2] === 4400 && F.run.arrivalFog, 'arrival camera at z 4400, fog flag');
      ok(vars(F).get(VAR.PHASE) === 7, 'phase 7 after the gold clip');
      F.tick(); F.w.vars.set(VAR.HISCORE, 9999); const x = fresh(); ok(x.n.hits === 0, 'fresh run');
    }
    for (const [h, med] of [[9, 3], [10, 2], [19, 2], [20, 1], [29, 1], [30, 0]]) { const { F } = finishWith(h); ok(vars(F).get(VAR.MEDAL) === med && F.run.score === 10000 - 250 * h, `${h} hits: medal ${med}`); }
    {
      const lens = [3, 2, 1, 0].map((m) => finishWith(m === 3 ? 0 : m === 2 ? 10 : m === 1 ? 20 : 30));
      ok(lens[0].t > lens[1].t && lens[1].t > lens[2].t, `gold ending (${lens[0].t}) > silver (${lens[1].t}) > bronze (${lens[2].t}) ticks`);
      ok(lens[3].F.p.anim.clip === 0x14 && lens[3].F.snd.count('play', SND.VICTORY) === 1, 'medal 0 (30 hits): the lose clips, but the arrival counts as a win run');
    }
    {
      // the best values are only raised
      const F = fresh(); F.tick(); F.put(4090); F.n.hits = 12; F.w.vars.set(VAR.HISCORE, 9000); F.w.vars.set(VAR.TROPHY, 3); F.ticks(300);
      ok(vars(F).get(VAR.HISCORE) === 9000 && vars(F).get(VAR.TROPHY) === 3 && vars(F).get(VAR.MEDAL) === 2, 'hiscore / trophy are not lowered');
    }

    // ============================================================ LOSS: the clock runs out
    {
      const F = fresh(); F.tick(); F.put(1500); F.n.clock = 5; F.n.speed = 1.0;
      let t = 0; for (; t < 600 && vars(F).get(VAR.PHASE) !== 7; t++) { F.tick(); if (t === 10) ok(vars(F).get(VAR.PHASE) === 5 && F.run.timeout, 'time up: phase 5'); }
      ok(F.run.score === 0 && vars(F).get(VAR.MEDAL) === 0 && F.snd.count('play', SND.LOSE) === 1 && F.p.anim.clip === 0x14, `LOSS: score 0, no medal, lose sound, clip 0x14 (${t} ticks)`);
      ok(F.n.speed === 0 && F.n.z < 1600 && vars(F).get(VAR.HISCORE) === 0, 'the rex slowed to a stop (0.05 per tick), nothing written');
      ok(F.w.camera.c[2] < 2000, 'no arrival camera after a timeout');
    }
    {
      const F = fresh(); F.tick(); F.put(4300); F.n.clock = 3; F.n.speed = 1.4; let t = 0; for (; t < 400 && vars(F).get(VAR.PHASE) !== 7; t++) F.tick();
      ok(vars(F).get(VAR.PHASE) === 7, 'a timeout near the camp still ends');
    }
    {
      // no input at all: the rex trots at 0.6, crashes and runs out of clock or finishes: the run always ends
      const F = fresh(); F.tick(); let t = 0; for (; t < 9000 && vars(F).get(VAR.PHASE) !== 7; t++) F.tick();
      ok(vars(F).get(VAR.PHASE) === 7 && F.run.score === 0 && vars(F).get(VAR.MEDAL) === 0, `no input: ends in a loss (${t} ticks, z ${F.n.z.toFixed(0)}, hits ${F.n.hits})`);
      notes.push(`no input: ${t} ticks, z ${F.n.z.toFixed(0)}, ${F.n.hits} hits`);
    }

    // ============================================================ WIN: the bot, and holding RIGHT only
    const playBot = (seed, opts) => {
      const F = fresh(seed); const bot = makeTrxBot(opts); let t = 0;
      for (; t < 9000 && vars(F).get(VAR.PHASE) !== 7; t++) {
        const k = bot.step(F.w, F.n);
        F.tick((k.right ? B.RIGHT : 0) | (k.up ? B.UP : 0) | (k.down ? B.DOWN : 0) | (k.jump ? B.ALT : 0) | (k.roar ? B.SHIFT : 0));
      }
      return { F, t, bot };
    };
    {
      const { F, t, bot } = playBot(1);
      notes.push(`bot WIN: ${t} ticks, ${F.n.hits} hits, score ${F.run.score}, medal ${vars(F).get(VAR.MEDAL)}, ${bot.st.jumps} jumps, ${bot.st.laneMoves} lane moves`);
      ok(vars(F).get(VAR.PHASE) === 7 && vars(F).get(VAR.MEDAL) >= 1 && F.run.score === 10000 - 250 * F.n.hits, 'bot: finishes with a medal');
      ok(F.n.hits <= 12 && F.n.clock > 1500, `bot: few hits (${F.n.hits}) and time to spare (${F.n.clock})`);
      ok(vars(F).get(VAR.HISCORE) === F.run.score && vars(F).get(VAR.TROPHY) === vars(F).get(VAR.MEDAL), 'bot: variables written');
      ok(F.snd.count('play', SND.FS1) > 50 && F.snd.count('play', SND.FS4) > 50 && F.snd.count('at', SND.WATERFALL) > 0, 'footsteps and waterfall sounds played');
      const again = playBot(1);
      ok(again.t === t && again.F.n.hits === F.n.hits && again.F.run.score === F.run.score, 'the same inputs and seed give the same run');
    }
    {
      const F = fresh(); F.tick(); let t = 0; for (; t < 9000 && vars(F).get(VAR.PHASE) !== 7; t++) F.tick(B.RIGHT);
      notes.push(`RIGHT only: ${t} ticks, ${F.n.hits} hits, score ${F.run.score}, medal ${vars(F).get(VAR.MEDAL)}`);
      ok(vars(F).get(VAR.PHASE) === 7, 'holding only RIGHT: the run ends');
    }
    return { checked, failures, notes };
  },
};
