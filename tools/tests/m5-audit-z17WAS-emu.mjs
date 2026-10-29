import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { WasEmu } from '../lib/m5-was-emu.mjs';
import { parseBlk } from '../../src/formats/anim.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import '../../src/zones/z17WAS.ts';
import { REC, SN, prepareWas, WasShared, PepWasNode, ZoneWasNode, CTOR_PEPWAS, CTOR_ZONEWAS } from '../../src/zones/z17was/rules.ts';
import { registerCtor, unregisterCtor } from '../../src/game/setup.ts';
import { B } from '../../src/game/input.ts';

// z17WAS, M5 audit, ORACLE test: the original's whack-a-snake code (zonewas FUN_00699e80, pepwas FUN_0069b9b0, both constructors) is executed in the x86 interpreter
// (tools/lib/m5-was-emu.mjs) next to the TypeScript port; both get the same buttons and the same random numbers (the port draws `value % n`, the original's FUN_004388ae returns the
// value), and every record's matrix / flags, every animation's clip and frame, the node state, the globals, the HUD strings and every sound call are compared tick by tick over whole
// games. The head bone's matrix the original reads (FUN_0043bc58) is what the loop's render pass left in the animation's buffer: the harness evaluates it after every tick, as the draw does.

const RECP0 = 0x10000000;
const KEYBIT = { ArrowUp: B.UP, ArrowLeft: B.LEFT, ArrowRight: B.RIGHT, ArrowDown: B.DOWN };
const KEY_OF_BASKET = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];   // basket k0 = down, k1 = up, k2 = left, k3 = right
const gen = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s >>> 8; }; };

export default {
  name: 'm5-audit-z17WAS-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 12) failures.push(m); else if (failures.length === 12) failures.push('... more'); };
    const pe = loadExe(ctx.dataRoot);
    // the constructors the zone module registered (another test may have unregistered them): the same factories as src/zones/z17WAS.ts
    let shared0 = new WasShared();
    registerCtor(CTOR_PEPWAS, () => { shared0 = new WasShared(); return new PepWasNode(shared0); });
    registerCtor(CTOR_ZONEWAS, () => new ZoneWasNode(shared0));
    const arch = ctx.archives.find((a) => a.name === 'z17WAS');
    const rigs = () => ({ SNAK: parseBlk(arch.read(arch.find('anim/SNAK.blk'))), MFIG: parseBlk(arch.read(arch.find('anim/MFIG.blk'))) });

    const scenario = (label, seed, player, ticks) => {
      WasShared.resetGlobals();
      const L = loadZone(ctx, 'z17WAS');
      const w = L.world;
      w.externalInput = true;
      const nodes = prepareWas(w, L.pepper, rigs(), L.pe);
      const sh = nodes.shared, node = nodes.node, pepNode = nodes.pepNode;
      const next = gen(seed), drawn = [];
      const ev = [];
      sh.sounds = { play: (id) => ev.push(`p ${id}`), play3D: (id, x, y, z) => ev.push(`p3 ${id} ${[x, y, z].map((v) => v.toFixed(2)).join(',')}`) };
      sh.rng = { int: (n) => { const v = next(); drawn.push(v); return v % n; } };
      // ---- the oracle: its own world, rigs bound the way the builder does, then the original's constructors
      const L2 = loadZone(ctx, 'z17WAS');
      const R2 = L2.world.records;
      const rg = rigs();
      const anims = new Map([[0, R2[0].anim]]);
      for (const i of REC.SNAKE) { R2[i].anim = new AnimInstance(rg.SNAK); anims.set(i, R2[i].anim); }
      for (const i of REC.SKEL) { R2[i].anim = new AnimInstance(rg.MFIG); anims.set(i, R2[i].anim); }
      const recs = R2.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags, rx: r.rx, ry: r.ry, rz: r.rz }));
      let di = 0;
      const emu = new WasEmu(pe, recs, anims, { rand: () => drawn[di++] });
      emu.construct(0, REC.WAS);
      const mem = emu.cpu.mem;
      const pbase = emu.pep, zbase = emu.was;
      const nf = (o) => mem.f32(zbase + o), ni = (o) => mem.r32(zbase + o), n16 = (o) => mem.r16(zbase + o), n8 = (o) => mem.r8(zbase + o);
      const worst = {};
      const num = (tick, name, orig, port, tol = 1e-5) => {
        checked++;
        const d = Math.abs(orig - port);
        worst[name] = Math.max(worst[name] ?? 0, d);
        if (!(d <= tol * Math.max(1, Math.abs(orig)))) bad(`${label}: tick ${tick} ${name}: original ${orig} port ${port}`);
      };
      const eq = (tick, name, orig, port) => { checked++; if (JSON.stringify(orig) !== JSON.stringify(port)) bad(`${label}: tick ${tick} ${name}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`); };
      const f0 = failures.length;
      const compareRecords = (t) => {
        for (let i = 0; i < w.records.length; i++) {
          const r = w.records[i], a = emu.recPtr(i);
          for (let k = 0; k < 16; k++) num(t, `rec${i}(${r.name}).m${k}`, mem.f32(a + 0xc + 4 * k), r.m[k], 1e-4);
          eq(t, `rec${i}(${r.name}).flags`, mem.r16(a + 0x60) & 0xffff, r.flags & 0xffff);
        }
        for (const [p, an] of emu.anims) {
          const i = emu.animRec.get(p), pa = w.records[i].anim;
          eq(t, `anim rec${i} clip`, an.clip, pa.clip); num(t, `anim rec${i} frame`, an.frame, pa.frame);
        }
      };
      compareRecords(-1);
      const visible = (i, flags) => (flags & 2) !== 0;
      emu.render(visible);
      let whacks = 0, grabs = 0, losses = 0, spawns = 0;
      const hist = [];
      for (let t = 0; t < ticks && failures.length === f0; t++) {
        const key = player(node, pepNode, sh, t);
        ev.length = 0; drawn.length = 0; di = 0;
        const sc0 = node.score, gm0 = node.gems;
        w.input.pressed = key ? KEYBIT[key] : 0;      // the buttons that went down this tick, exactly (the shell samples the input itself)
        w.tick();
        const olog = emu.tick(key ? KEYBIT[key] : 0, 0, REC.WAS);
        emu.render(visible);
        if (node.score - sc0 === 70) whacks++; else if (node.score - sc0 === 300) grabs++; else if (node.score - sc0 < 0) losses++;
        if (node.gems !== gm0) { /* counted by score */ }
        eq(t, 'sounds', olog, ev);
        eq(t, 'random calls', di, drawn.length);
        // node
        num(t, 'timeLeft', nf(0xc0), node.timeLeft); num(t, 'elapsed', nf(0xc4), node.elapsed);
        for (let k = 0; k < 4; k++) {
          eq(t, `state${k}`, n16(0xc8 + 2 * k), node.state[k]); eq(t, `hit${k}`, n16(0xd0 + 2 * k), node.hit[k]);
          num(t, `topAt${k}`, nf(0xd8 + 4 * k), node.topAt[k]); num(t, `y${k}`, nf(0xe8 + 4 * k), node.y[k]);
        }
        num(t, 'gap', nf(0x108), node.gap); eq(t, 'holder', (n8(0x10c) << 24) >> 24, node.holder);
        eq(t, 'gems', ni(0x110), node.gems); eq(t, 'hits', ni(0x114), node.hits); num(t, 'lastRise', nf(0x118), node.lastRise); eq(t, 'score', ni(0x11c), node.score);
        eq(t, 'flash', n8(0x130), node.flash); eq(t, 'flashFlag', n8(0xf9), node.flashFlag); eq(t, 'first', n8(0x131) !== 0, node.first);
        eq(t, 'beeps', ni(0x134), node.beeps); eq(t, 'lock', n8(0x138) !== 0, node.lock); eq(t, 'squash', ni(0x13c) !== 0, node.squash); eq(t, 'stage', ni(0x140), node.stage);
        // Pepper's node and the globals
        eq(t, 'pep cur', mem.r8(pbase + 0x18), pepNode.cur); eq(t, 'pep next', mem.r8(pbase + 0x19), pepNode.next); eq(t, 'pep res', mem.r8(pbase + 0x1a), pepNode.res);
        eq(t, 'pep busy', mem.r8(pbase + 0x1b) !== 0, pepNode.busy); eq(t, 'pep timer', mem.r8(pbase + 0x1c), pepNode.timer); eq(t, 'pep presses', mem.r8(pbase + 0x1d), pepNode.presses);
        eq(t, 'DAT_00925e58 (clip)', mem.r32(0x925e58), sh.clip); eq(t, 'DAT_05d5be4c (over)', mem.r32(0x5d5be4c) !== 0, sh.done);
        if (sh.done) { eq(t, 'final score', mem.r32(0x5d5be54), sh.finalScore); eq(t, 'final gems', mem.r32(0x5d5be50), sh.finalGems); }
        eq(t, 'time text', mem.cstr(0x5d4dd60), node.timeText); eq(t, 'gem text', mem.cstr(0x5d4dd20), node.gemText); eq(t, 'hit text', mem.cstr(0x5d4dd44), node.hitText);
        eq(t, 'score line', emu.texts.map((x) => [x.text, x.x, x.y, x.wrap]), [[node.scoreText, 320, 400, 28]]);
        compareRecords(t);
        hist.push(`t${t} key ${key} orig[cur ${mem.r8(pbase + 0x18)} next ${mem.r8(pbase + 0x19)} busy ${mem.r8(pbase + 0x1b)} pr ${mem.r8(pbase + 0x1d)} dir ${mem.r32(pbase + 0x20)} frame ${emu.anims.get(mem.r32(RECP0 + 8)).frame}] port[cur ${pepNode.cur} next ${pepNode.next} busy ${pepNode.busy} pr ${pepNode.presses} dir ${pepNode.dir}]`); if (hist.length > 14) hist.shift();
      }
      if (failures.length > f0 && process.env.WAS_HIST) notes.push(...hist);
      notes.push(`${label}: ${ticks} ticks, score ${node.score} gems ${node.gems} hits ${node.hits}, whacks ${whacks}, grabs ${grabs}, gem losses ${losses}, done ${sh.done}, unhooked ${JSON.stringify([...emu.unhooked].map(([a, n]) => `${a.toString(16)}x${n}`))}`);
      return { node, sh };
    };

    const mash = (seed) => { const g = gen(seed); return () => (g() % 7 === 0 ? ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'][g() % 4] : null); };
    scenario('mash', 17, mash(3), 2900);
    scenario('idle', 5, () => null, 2900);
    // a player that whacks every snake that is up and double-presses the gem holder (the second press during the wind-up grabs)
    const smart = () => {
      let pend = null;
      return (node, pep, sh, t) => {
        if (pend && pend.at === t) { const k = pend.key; pend = null; return k; }
        if (pep.busy) return null;
        for (let k = 0; k < 4; k++) {
          if (node.state[k] === SN.UP && node.hit[k] === 0) {
            const key = KEY_OF_BASKET[k];
            if (node.holder === k) pend = { key, at: t + 2 };
            return key;
          }
        }
        return null;
      };
    };
    scenario('smart', 77, smart(), 2900);
    scenario('smart2', 1234, smart(), 2900);
    // a spamming player (any button every tick)
    scenario('spam', 9, (n, p, s, t) => ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'][t % 4], 2900);
    unregisterCtor(CTOR_PEPWAS); unregisterCtor(CTOR_ZONEWAS);
    return { checked, failures, notes };
  },
};
