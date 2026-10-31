import { loadIsland, tick } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { composeBone, boneWorld, setupEmitter, staticMatrix } from '../../src/island/emitters.ts';
import { recFieldOfPtr } from '../../src/formats/emusetup.ts';
import { waypoints } from '../../src/game/walker.ts';
import { createCpu } from '../../src/formats/x86emu.ts';

// WP-ISLAND (gaps S7 / S10): the island's particle emitters are started, gated and moved exactly like the original's FUN_00442960 / FUN_00442a20 / FUN_00442a00 /
// FUN_0044ebd0 calls (src/island/emitters.ts, `ctx.fx` = ZoneParticles; here a recording FakeFx, tools/lib/fake-fx.mjs): the emulated set-up's emitters with the matrices
// they are bound to, the director's bone matrices (FUN_0043a9e5 against the original), the boat plume, the train, the bots, the pages, the music house, the dancing bots.
// Run: node tools/test-formats.mjs --only m4-fx-island -v

const f32 = Math.fround;
const HP = f32(1.5707964);

export default {
  name: 'm4-fx-island',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
    const world = (node, extra = {}) => {
      const I = loadIsland(ctx, { node, ...extra });
      loadIslandWalkMaps(I.archive, I.ictx.setup);
      startPizzaNodes(I.world); startIslandNpcs(I.world);
      return I;
    };
    const bits = (x) => { const a = new Float32Array([x]); return new Uint32Array(a.buffer)[0]; };
    const gateOf = (I, h) => I.ictx.fx.emitters.get(h).gate.join();

    // ---------------------------------------------------------------- FUN_0043a9e5 (bone x record matrix) against the original code
    {
      const I = world(2);
      const cpu = createCpu(I.pe), mem = cpu.mem;
      const HEAP = 0x20000000; mem.addRegion({ lo: HEAP, hi: HEAP + 0x1000, name: 'heap' });
      cpu.cw = 0x7f;      // 24-bit x87 as Direct3D 7 leaves it (every product and sum a float32)
      cpu.exec = [[0x43a9e5, 0x43abb0]];
      cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
      cpu.hooks.set(0x85abc0, () => {});
      let seed = 5; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return ((seed >>> 8) / 16777216 - 0.5) * 20; };
      let bad = 0, n = 0, worst = 0;
      for (let t = 0; t < 200; t++) {
        const a = new Float32Array(16).map(rnd), b = new Float32Array(16).map(rnd);
        for (let i = 0; i < 16; i++) { mem.w32(HEAP + 0x100 + i * 4, bits(a[i])); mem.w32(HEAP + 0x200 + i * 4, bits(b[i])); }
        cpu.call(0x43a9e5, [HEAP, HEAP + 0x100, HEAP + 0x200]);
        const mine = composeBone(new Float32Array(16), a, b);
        for (let i = 0; i < 16; i++) {
          const o = new Float32Array(new Uint32Array([mem.u32(HEAP + i * 4)]).buffer)[0];
          n++; worst = Math.max(worst, Math.abs(o - mine[i]) / (Math.abs(o) + 1));
          if (o !== mine[i]) bad++;
        }
      }
      ok(bad === 0, `composeBone: ${n} floats against FUN_0043a9e5 on the emulator, ${bad} differ (bit for bit)`);
      notes.push(`FUN_0043a9e5: ${n} floats compared, worst relative difference ${worst.toExponential(1)}`);
    }

    // ---------------------------------------------------------------- the emulated set-up's emitters (era functions), replayed with the same arguments
    for (const node of [2, 12, 33, 55]) {
      const I = world(node);
      tick(I, 2);
      const calls = I.ictx.setup.calls.filter((c) => c.fn === 0x442960);
      const started = [...I.ictx.fx.emitters.values()].filter((e) => calls.some((c) => I.pe.cstr(c.args[0]) === e.name && e.gate.length === 3));
      let okAll = calls.length > 0;
      let rock = 0;
      const used = new Set();
      for (const c of calls) {
        const name = I.pe.cstr(c.args[0]);
        const e = [...I.ictx.fx.log].find((l) => l.op === 'start' && !used.has(l.h) && l.name === name && l.pos.every((v, i) => bits(v) === (c.args[2 + i] >>> 0)) && l.rot.every((v, i) => bits(v) === (c.args[5 + i] >>> 0)) && l.gate.join() === [c.args[8] | 0, c.args[9] | 0, c.args[10] | 0].join());
        if (!e) { okAll = false; failures.push(`node ${node}: set-up emitter ${name} (${[...c.args].map((a) => (a >>> 0).toString(16))}) not started with the same arguments`); continue; }
        used.add(e.h);
        const em = I.ictx.fx.emitters.get(e.h);
        const f = recFieldOfPtr(c.args[1]);
        if (f) { if (f.field !== 0xc || em.matrix?.() !== I.world.records[f.record].m) { okAll = false; failures.push(`node ${node}: ${name} not bound to record ${f.record}'s matrix`); } }
        else if (setupEmitter(I.world, c.args[1] >>> 0) !== e.h && em.matrix !== staticMatrix(I.world, c.args[1] >>> 0)) { okAll = false; failures.push(`node ${node}: ${name} not bound to the static matrix ${(c.args[1] >>> 0).toString(16)}`); }
        if (name === 'rocket01.par') rock++;
      }
      ok(okAll, `node ${node}: ${calls.length} set-up emitters (${[...new Set(calls.map((c) => I.pe.cstr(c.args[0])))].join(', ')}) replayed with their arguments and matrices`);
      if (rock) {
        // DAT_05d585d0 + 4 k = the handle of the k-th rocket01: the static matrix 0x5d58410 + 0x40 k
        const hs = [...I.ictx.fx.log].filter((l) => l.op === 'start' && l.name === 'rocket01.par').map((l) => l.h);
        ok(hs.every((h, k) => setupEmitter(I.world, 0x5d58410 + k * 0x40) === h) && hs.length === rock, `node ${node}: rocket k -> matrix 0x5d58410 + 0x40 k -> handle (${hs})`);
      }
      ok(I.ictx.fx.log.filter((l) => l.op === 'start' && l.name === 'throwpizza.par').length === 3 && I.ictx.fx.log.filter((l) => l.op === 'start' && l.name === 'pizzasplat.par').length === 3, `node ${node}: the three pizza projectiles start throwpizza + pizzasplat each (the hand pizzas' FUN_0044ebb0 is a stub returning NO_HANDLE: no emitters)`);
    }

    // ---------------------------------------------------------------- the director: rocket01 / zzz / bill01 / twinkle03 follow bone matrices
    {
      const I = world(55);
      const W = I.world, fx = I.ictx.fx;
      tick(I, 2);
      // the director's own update is called here (the records' animations advance later in the same tick: the matrices are compared right after the call)
      const fsmRec = W.records.find((r) => r.ctrl?.nodes.some((n) => n.kind === 'LGI_FSM'));
      const fsmNode = fsmRec.ctrl.nodes.find((n) => n.kind === 'LGI_FSM');
      const dir = () => fsmNode.update(W, fsmRec, fsmRec.ctrl);
      const sw = (n) => I.ictx.switchVar(n);
      const v110 = sw('SWITCH_LGI_CSM_FX_SWITCH02'), v109 = sw('SWITCH_LGI_CSM_FX_SWITCH05'), vff = sw('SWITCH_LGI_CSM_FX_SWITCH06');
      const hs = (k) => setupEmitter(W, 0x5d58410 + k * 0x40);
      fx.clear();
      // bit 0x20 = record 10 (BRIK), slot 4 / 5; 0x1000 starts them
      W.vars.set(v110, 0x1020); dir();
      const rec = W.records[10];
      ok(W.vars.get(v110) === 0x20, `0x1000 is consumed (var ${W.vars.get(v110).toString(16)})`);
      ok(gateOf(I, hs(4)) === '2,1,1' && gateOf(I, hs(5)) === '2,1,1', `rockets 4 / 5 on: gates ${gateOf(I, hs(4))} / ${gateOf(I, hs(5))}`);
      const want5 = new Float32Array(16), want7 = new Float32Array(16);
      boneWorld(want5, rec, 5); boneWorld(want7, rec, 7);
      const m4 = fx.matrixOf(hs(4)), m5 = fx.matrixOf(hs(5));
      ok(m4 && m5 && want5.every((v, i) => v === m4[i]) && want7.every((v, i) => v === m5[i]), 'the rockets are bound to the record\'s bone 5 / 7 matrices (bone x record matrix)');
      ok(!!rec.anim?.pose(1) && rec.anim.pose(1).length >= 7 * 16 + 16, 'record 10 has a pose: the bone path (not the record matrix) is used');
      // the matrices follow every tick: move the record, tick, compare again
      rec.x += 10; rec.m[12] += 10;
      dir();
      boneWorld(want5, rec, 5);
      ok(want5.every((v, i) => v === fx.matrixOf(hs(4))[i]), 'the matrices are recomputed every tick while the switch holds a rocket bit');
      W.vars.set(v110, 0xa0); dir();
      ok(gateOf(I, hs(4)) === '1,1,1' && gateOf(I, hs(5)) === '1,1,1', 'bit 0x80: both rockets off (1, 1, 1)');
      W.vars.set(v110, 0);
      // zzz: switch value 1 -> the bone 10 matrix of record 11 in DAT_05d585e8
      W.vars.set(v110, 1); dir();
      const zz = new Float32Array(16); boneWorld(zz, W.records[11], 10);
      ok(zz.every((v, i) => v === staticMatrix(W, 0x5d585e8)[i]), 'switch value 1: the zzz matrix = bone 10 of record 11');
      W.vars.set(v110, 0);
      // bill01: 1 -> both on, matrices at bones 14 / 16 of Bill (record 15), var -> 2; 3 -> off, var -> 0
      const hb1 = setupEmitter(W, 0x5d58390), hb2 = setupEmitter(W, 0x5d583d0);
      W.vars.set(v109, 1); dir();
      ok(gateOf(I, hb1) === '2,1,1' && gateOf(I, hb2) === '2,1,1' && W.vars.get(v109) === 2, `bill01 x 2 on (${gateOf(I, hb1)} / ${gateOf(I, hb2)}, var ${W.vars.get(v109)})`);
      const b1 = new Float32Array(16), b2 = new Float32Array(16);
      boneWorld(b1, W.records[15], 0xe); boneWorld(b2, W.records[15], 0x10);
      ok(b1.every((v, i) => v === staticMatrix(W, 0x5d58390)[i]) && b2.every((v, i) => v === staticMatrix(W, 0x5d583d0)[i]), 'bill01 matrices = Bill\'s bones 14 / 16');
      ok(fx.log.some((l) => l.op === 'matrix' && l.h === hb1) && fx.log.some((l) => l.op === 'matrix' && l.h === hb2), 'FUN_00442a00 binds them');
      W.vars.set(v109, 3); dir();
      ok(gateOf(I, hb1) === '1,1,1' && gateOf(I, hb2) === '1,1,1' && W.vars.get(v109) === 0, 'bill01: 3 = off, var 0');
      // twinkle03: 1 | 0x40 -> record 0x11's matrix COPIED into DAT_05d58590, on, sound at it; 0x80 -> off
      const ht = setupEmitter(W, 0x5d58590);
      I.ictx.sounds.length = 0;
      W.vars.set(vff, 0x41); dir();
      const r11 = W.records[0x11];
      ok(gateOf(I, ht) === '2,1,1' && staticMatrix(W, 0x5d58590).every((v, i) => v === r11.m[i]), `twinkle03 on at record 0x11 (gate ${gateOf(I, ht)}), matrix = a copy of its matrix`);
      const mm = staticMatrix(W, 0x5d58590);
      r11.m[12] += 5; dir();
      ok(staticMatrix(W, 0x5d58590)[12] === mm[12] && I.ictx.sounds.some((s) => s.pos && s.pos[0] === mm[12]), 'a copy: it does not follow the record afterwards; the sound is at the copied translation');
      W.vars.set(vff, 0x80); dir();
      ok(gateOf(I, ht) === '1,1,1' && (W.vars.get(vff) & 0x80) === 0, 'twinkle03 off with 0x80');
    }

    // ---------------------------------------------------------------- the boat plume: FUN_00442960("BOATPLUME", rec + 0xc, 0, 1, -half, -pi / 2, gate off), gate / parameters per tick
    {
      const I = world(2);
      tick(I, 2);
      const W = I.world, fx = I.ictx.fx;
      const B = I.rec('SPBT') ?? I.rec('JSKI');
      const N = B.ctrl.nodes.find((n) => n.kind === 'SGBoat');
      const e = fx.emitters.get(N.plumeH);
      ok(e && e.name === 'BOATPLUME' && e.gate.join() === '1,1,1' && e.pos[0] === 0 && e.pos[1] === 1 && e.pos[2] === -N.half && near(e.rot[0], -HP) && e.matrix() === B.m, `BOATPLUME: bound to ${B.name}'s matrix, offset (0, 1, -${N.half.toFixed(3)}), -pi/2, gate off`);
      ok(!fx.isOn(N.plumeH), 'parked: not emitting');
      fx.clear();
      N.speed = 3; N.prerender(W, B);
      ok(gateOf(I, N.plumeH) === '2,1,1', 'speed > 0: FUN_0044ea60(h, 2, 1, 1)');
      const life = fx.log.filter((l) => l.op === 'param' && l.h === N.plumeH);
      ok(life.length === 2 && life[0].type === 2 && life[1].type === 3 && life[0].value === 0.1875 && life[1].value === 0.1875, `FUN_0044ebd0 modes 2 / 3 = speed / 4 * 0.25 (${life.map((l) => l.type + ':' + l.value)})`);
      fx.clear();
      N.speed = 0; N.prerender(W, B);
      const l0 = fx.log.filter((l) => l.op === 'param' && l.h === N.plumeH);
      ok(!fx.log.some((l) => l.op === 'gate') && l0.length === 2 && l0[0].value === 0, 'speed 0: the gate is not touched, the parameters are set to 0');
    }

    // ---------------------------------------------------------------- the train: FUN_0044e920(trainsmoke01, rec + 0xc, 0, 10, 7.25, -pi / 2, gate 2 / 1 / 1)
    {
      const I = world(2);
      tick(I, 3);
      const fx = I.ictx.fx;
      const s = fx.find('trainsmoke01.par');
      const rec = I.world.records[158];
      ok(s.length === 1 && s[0].pos.join() === '0,10,7.25' && s[0].gate.join() === '2,1,1' && s[0].matrix() === rec.m && fx.isOn(s[0].h), `the locomotive's smoke: matrix of ${rec.name}, offset (0, 10, 7.25), always on`);
    }

    // ---------------------------------------------------------------- the pages (TWINKLE01 / 02, era 1) and the music house (notes01, era 0)
    {
      const I = world(7);
      tick(I, 3);
      const fx = I.ictx.fx;
      const t1 = fx.find('TWINKLE01.par')[0], t2 = fx.find('TWINKLE02.par')[0];
      ok(!!t1 && !!t2 && t1.matrix() === I.world.records[4].m && t1.pos.join() === '0,4,0' && t1.rot.join() === '0,0,0' && t2.pos[1] === f32(1.6) && near(t2.rot[0], -HP) && t1.gate.join() === '1,1,1', 'page constructor: TWINKLE01 (0, 4, 0) and TWINKLE02 (0, 1.6, 0, -pi/2) bound to record 4\'s matrix');
      const spin = fx.log.filter((l) => l.op === 'gate' && l.name === 'TWINKLE02.par' && l.gate.join() === '2,1,1').length;
      ok(spin >= 3, `the spinning page switches TWINKLE02 on every tick (${spin} times in 3 ticks)`);
      const J = world(2);
      tick(J, 2);
      const nh = J.ictx.fx.find('notes01.par')[0], house = J.rec('HSE2');
      ok(nh && nh.gate.join() === '2,1,1' && nh.pos.join() === '0,0,0' && near(nh.rot[0], -HP), 'notes01: record 127, rotation -pi/2, gate 2 / 1 / 1');
      J.ictx.fx.clear();
      house.flags &= ~2; tick(J, 1);
      ok(J.ictx.fx.log.some((l) => l.op === 'gate' && l.name === 'notes01.par' && l.gate.join() === '1,1,1'), 'the music house off (flag 2 clear): notes01 gate (1, 1, 1)');
    }

    // ---------------------------------------------------------------- the dancing bot: music01 (matrix = the node's own buffer, offset (0, 0.5, 0)), gate on at the start, parameters per tick
    {
      const I = loadIsland(ctx, { node: 56, vars: { 0x54: 4, 0x115: 0xc, 0x26: 15 } });
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world); startIslandNpcs(I.world);
      const bot = I.rec('BBY0'), music = bot.ctrl.nodes.find((n) => n.kind === 'BOTMUSIC'), p = I.pepper, fx = I.ictx.fx;
      p.x = bot.x + 200; p.z = bot.z;
      tick(I, 3);
      const m = fx.emitters.get(music.fxH);
      ok(m && m.name === 'music01.par' && m.pos.join() === '0,0.5,0' && m.rot.join() === '0,0,0' && m.gate.join() === '1,1,1' && m.matrix === music.fxMat, 'BOTMUSIC: music01.par bound to the node\'s own matrix, offset (0, 0.5, 0), gate off');
      fx.clear();
      const stay = () => { p.x = bot.x + 5; p.y = bot.y; p.z = bot.z; };
      stay(); tick(I, 2);
      ok(gateOf(I, music.fxH) === '2,1,1' && fx.log.some((l) => l.op === 'matrix' && l.h === music.fxH), 'the bot starts to dance: gate (2, 1, 1) + FUN_00442a00(h, node matrix)');
      const pose = Float32Array.from(bot.anim.pose(1));   // the update advances the animation AFTER it composed the matrix
      music.update(I.world, bot, bot.ctrl);
      const want = composeBone(new Float32Array(16), bot.m, pose, 10 * 16);
      ok(want.every((v, i) => v === music.fxMat[i]), 'the matrix = bone 10 (the hand) in world space');
      const dens = fx.log.filter((l) => l.op === 'param' && l.h === music.fxH);
      const last = (t) => dens.filter((l) => l.type === t).pop();
      const k = f32(music.timer / 610);
      ok(last(8)?.value === k && last(9)?.value === k && last(0)?.value === f32(f32(k * f32(0.3)) + f32(0.1)), `density / its variation = timer / 610 (${k}), force = that * 0.3 + 0.1 (${last(0)?.value})`);
    }

    return { checked, failures, notes };
  },
};
