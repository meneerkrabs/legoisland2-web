// M5 audit, z39ASB, ORACLE test: the original's shuttle node (FUN_007b96a0 / FUN_007b82dd with hit test, layout and asteroid recycling) run in the x86 interpreter
// (tools/lib/asb-emu.mjs) next to the port's `AsteroidBelt`; same buttons, same random numbers (layout and recycling; the hit test's tick-scaled choices of sound variants are
// compared by class only); state, hull / score, camera, records, HUD values and the node's sound calls compared tick by tick.
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { AsbEmu, RECORDS_BASE } from '../lib/asb-emu.mjs';
import { AsteroidBelt, VAR } from '../../src/zones/z39ASB/belt.ts';
import { BeltSound, SND } from '../../src/zones/z39ASB/sound.ts';
import { B } from '../../src/game/input.ts';

const REC = 0x68;
export default {
  name: 'm5-audit-z39ASB-emu',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0, cap = 0;
    const pe = loadExe(ctx.dataRoot);
    const scenario = async (label, seed, keys, maxTicks) => {
      cap = failures.length + 6;
      let a = seed, b = seed ^ 0x5555;
      const gen = (s) => { const o = { s }; return { next() { o.s = (Math.imul(o.s, 214013) + 2531011) >>> 0; return (o.s >>> 16) & 0x7fff; }, range(x) { return x <= 0 ? 0 : (this.next() / 32767) * x; } }; };
      const shared = gen(seed), sharedO = gen(seed), dummyP = gen(77), dummyO = gen(88);
      const L = loadZone(ctx, 'z39ASB');
      const W = L.world, recs = W.records;
      const shut = recs.find((r) => r.name === 'SHUT'), hull = recs.find((r) => r.name === 'HULL');
      const asts = recs.filter((r) => r.name.startsWith('AST')).slice(0, 256);
      const L2 = loadZone(ctx, 'z39ASB');
      const emuRecs = L2.world.records.map((r) => ({ name: r.name, m: Array.from(r.m), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags }));
      const emu = new AsbEmu(pe, emuRecs, { rng: sharedO, dummy: dummyO });
      const mem = emu.cpu.mem;
      const cam = W.camera.c;
      const plog = [];
      const snd = new BeltSound(null); snd.log = plog; await snd.load();
      const events = [];
      const rngPort = { next: () => dummyP.next(), range: (x) => shared.range(x) };
      const belt = new AsteroidBelt({ shut, hull, asteroids: asts }, cam, rngPort, W.vars, (e) => { events.push(e); snd.event(e); });
      emu.construct();
      const node = emu.node, nf = (o) => mem.f32(node + o), ni = (o) => mem.r32(node + o) | 0;
      const cmp = (t, name, o, p, tol = 1e-5) => { checked++; if (!(Math.abs(o - p) <= tol * Math.max(1, Math.abs(o))) && failures.length < cap) failures.push(`${label}: tick ${t} ${name}: original ${o} port ${p} (state ${belt.state})`); };
      const eq = (t, name, o, p) => { checked++; if (o !== p && failures.length < cap) failures.push(`${label}: tick ${t} ${name}: original ${JSON.stringify(o)} port ${JSON.stringify(p)} (state ${belt.state})`); };
      // construction: asteroid layout and camera
      eq(0, 'asteroid count', asts.length > 0, true);
      for (let i = 0; i < asts.length; i++) { const r = asts[i]; for (const k of [12, 13, 14]) cmp(0, `AST${i} m[${k}] after the constructor`, mem.f32(RECORDS_BASE + r.index * REC + 0xc + 4 * k), r.m[k]); }
      for (let i = 0; i < asts.length; i++) { const t = belt.ast[i], b = 0x5d5d538 + i * 0x18; [['rxv', 4], ['ryv', 8], ['rzv', 12], ['vx', 16], ['vy', 20]].forEach(([k, o]) => cmp(0, `AST${i} ${k} after the constructor`, mem.f32(b + o), t[k], 1e-6)); eq(0, `AST${i} record`, mem.r32(b), RECORDS_BASE + asts[i].index * REC); }
      for (let k = 0; k < 6; k++) cmp(0, `camera[${k}] after the constructor`, mem.f32(0x9da5e8 + 4 * k), cam[k]);
      const cls = (id) => ([SND.MISS1, SND.MISS2].includes(id) ? 'miss' : [SND.YELL1, SND.YELL2].includes(id) ? 'yell' : [SND.IMPACT1, SND.IMPACT2, SND.IMPACT3].includes(id) ? 'impact' : String(id));
      let t = 0; const cover = new Map();
      for (; t < maxTicks && belt.result === 0; t++) {
        const held = keys(t, belt);
        const olog = emu.tick(held);
        plog.length = 0; events.length = 0;
        belt.update({ held });
        snd.tick(belt.stateIn, belt.engine);
        const T = t + 1;
        eq(T, 'state', ni(0x18), belt.state);
        eq(T, 'score', ni(0x1c), belt.score);
        cmp(T, 'speed', nf(0x27c), belt.speed); cmp(T, 'maxSpeed', nf(0x280), belt.maxSpeed);
        cmp(T, 'hull', nf(0x284), belt.hull); eq(T, 'hullInt', ni(0x288), belt.hullInt);
        eq(T, 'warn', ni(0x28c) !== 0, belt.warn); eq(T, 'hits', ni(0x290), belt.hits); cmp(T, 'hitTimer', nf(0x294), belt.hitTimer);
        cmp(T, 'shakeX', nf(0x2a0), belt.shakeX); cmp(T, 'shakeVel', nf(0x2a4), belt.shakeVel);
        cmp(T, 'frame', nf(0x2c8), belt.frame); cmp(T, 'camOff', nf(0x2cc), belt.camOff); cmp(T, 'glow', nf(0x2d0), belt.glow);
        cmp(T, 'accZ', nf(0x2d4), belt.accZ); cmp(T, 'spacing', nf(0x2d8), belt.spacing);
        eq(T, 'result var', L2 && (emu.vars.get(0xfc) ?? 0), W.vars.get(VAR.RESULT));
        eq(T, 'result global', mem.r32(0x5d5d524) | 0, belt.result);
        for (const [o, r] of [[shut.index, shut]]) {  // (HULL is placed by the draw hook FUN_007b9434, not by the update)
          for (let k = 0; k < 16; k++) cmp(T, `${r.name} m[${k}]`, mem.f32(RECORDS_BASE + o * REC + 0xc + 4 * k), r.m[k]); }
        if (process.env.ASB_DEBUG && T >= 700 && T <= 771 && T % 10 === 0) { const i = 53, r = asts[i], a = RECORDS_BASE + r.index * REC; console.log(T, 'AST53 orig euler', [0x4c, 0x50, 0x54].map((o) => mem.f32(a + o)), 'port', r.rx, r.ry, r.rz, 'z', mem.f32(a + 0x44), r.z, 'ez', mem.f32(0x9da5f0)); }
        for (let i = 0; i < asts.length; i++) { const r = asts[i]; const base = RECORDS_BASE + r.index * REC + 0xc; for (const k of (T % 11 === 1 ? [...Array(16).keys()] : [12, 13, 14])) cmp(T, `AST${i} m[${k}]`, mem.f32(base + 4 * k), r.m[k], 1e-4); }
        for (let k = 0; k < 6; k++) cmp(T, `camera[${k}]`, mem.f32(0x9da5e8 + 4 * k), cam[k], 1e-5);
        eq(T, 'HUD text', mem.cstr(0x5d4dd60), belt.scoreText);
        eq(T, 'HUD hit icon tints', [0, 1, 2, 3, 4].map((i) => mem.r32(0x5d4e148 + 8 * i) >>> 0).join(), belt.slotTint.join());
        eq(T, 'HUD frame tint', mem.r32(0x5d4e0c4) >>> 0, belt.frameTint); cmp(T, 'HUD gauge', mem.f32(0x5d4e138), belt.gauge, 1e-5);
        // sounds of the node: class and kind (the variant of a miss / yell / impact is a tick-scaled random choice in the original)
        let a = olog.filter((e) => /^(p2|s2|p3|s3|say) /.test(e)).map((e) => { const [k, id] = e.split(' '); return `${k} ${k === 'say' ? (/^OGSGAB0[67]$/.test(id) ? 'hit' : id) : cls(+id)}`; }).sort();
        a = a.filter((e, i) => !(e.startsWith('s2') && a[i - 1] === e));
        const p = plog.map((e) => { const [k, id] = e.split(' '); return k === 'warn' ? `p3 ${cls(+id)}` : `${k === 'play' ? 'p2' : (+id === SND.MISS1 || +id === SND.MISS2 ? 's3' : 's2')} ${cls(+id)}`; });
        for (const e of events) if (e.type === 'warnEnd') p.push('s2 515', 's2 516', 's3 miss', 's3 miss');   // the alarm / miss stops (BeltSound.event does not log them)
        for (const e of events) if (e.type === 'hit') p.push('say hit');   // the zone game speaks OGSGAB06 / 07 (a tick-scaled random choice)
        const dedupe = (l) => l.filter((e, i) => !(e.startsWith('s2') && l[i - 1] === e));   // the end tick stops the gyro loop twice in the original (a repeated stop of a stopped loop: no effect)
        const ps = dedupe(p.sort());
        a = a.length ? a : a;
        for (const e of a) cover.set(e, (cover.get(e) ?? 0) + 1);
        checked++;
        if (a.join('|') !== ps.join('|') && failures.length < cap) failures.push(`${label}: tick ${T}: sounds differ (state ${belt.state})\n    original ${a.join(' | ')}\n    port     ${ps.join(' | ')}`);
        if (failures.length >= cap) break;
      }
      notes.push(`${label}: ${t} ticks, state ${belt.state}, score ${belt.score}, hits ${belt.hits}, result ${belt.result}; node sounds ${[...cover].map(([k, v]) => `${k}x${v}`).join(' ')}; unhooked ${[...(emu.unhooked ?? [])].map(([k, v]) => `${k.toString(16)}x${v}`).join(' ') || 'none'}`);
    };
    await scenario('no input', 1, () => 0, 3000);
    await scenario('steering', 2, (t) => { const ph = Math.floor(t / 40) % 8; return [B.LEFT, B.UP, B.RIGHT, B.DOWN, B.LEFT | B.UP, 0, B.RIGHT | B.DOWN, B.UP][ph]; }, 3000);
    // keep clear of the asteroids: a simple bot reading the port's layout would be nicer; random holds cover hits, the hull running out and the finish
    for (const seed of [5, 6]) { let q = seed, hold = 0, m = 0; await scenario(`random ${seed}`, seed, () => { if (hold-- <= 0) { q = (Math.imul(q, 1664525) + 1013904223) >>> 0; hold = 5 + (q >>> 24) % 30; m = [0, B.LEFT, B.RIGHT, B.UP, B.DOWN, B.LEFT | B.UP, B.RIGHT | B.DOWN][(q >>> 12) % 7]; } return m; }, 3200); }
    return { checked, failures, notes };
  },
};
