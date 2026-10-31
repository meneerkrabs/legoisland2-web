// z22BIP: the scenarios of tests/m6-z22BIP.mjs that run the ORIGINAL node functions in the x86 interpreter (tools/lib/bip-emu.mjs) next to the TypeScript port and compare
// the node state, the records' matrices and the camera tick by tick. Each returns { checked, failures, notes }.
import { pinBipClock } from './bip-clock.mjs';
import { loadExe } from './engine-load.mjs';
import { BipEmu } from './bip-emu.mjs';
import { BipSpline } from '../../src/zones/z22bip/spline.ts';
import { parseMan, parseBlk } from '../../src/formats/anim.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { World } from '../../src/game/world.ts';
import { GameRecord } from '../../src/game/record.ts';
import { Controller } from '../../src/game/controller.ts';
import { PlaneNode } from '../../src/zones/z22bip/plane.ts';
import { TakeoffNode, parseSrc } from '../../src/zones/z22bip/takeoff.ts';
import { LandingNode } from '../../src/zones/z22bip/landing.ts';
import { RecoverNode } from '../../src/zones/z22bip/recover.ts';
import { JohnnyNode } from '../../src/zones/z22bip/johnny.ts';
import { MonkeyNode } from '../../src/zones/z22bip/monkey.ts';
import { RockyNode } from '../../src/zones/z22bip/rocky.ts';
import { RopeSlideNode, JerryCanNode, AnimPropNode, PropsNode } from '../../src/zones/z22bip/props.ts';
import { bipRun } from '../../src/zones/z22bip/run.ts';
import { buildMatrix } from '../../src/formats/matrix.ts';
import { B } from '../../src/game/input.ts';

/** what the scenarios share: the executable, the zone's archive and the course */
export function bipFixture(ctx) {
  const pe = loadExe(ctx.dataRoot);
  const a = ctx.archives.find((x) => x.name.toLowerCase() === 'z22bip');
  const file = (p) => a.read(a.find(p));
  const man = parseMan(file('matanim/bippath.man'));
  const src = (n) => parseSrc(file('source/' + n));
  const rs = src('Runwaystart.src'), re = src('Runwayend.src');
  const spline = BipSpline.fromMan(man, rs[0], re[2]);
  return { pe, a, file, src, rs, re, spline, blk: (n) => parseBlk(file(`anim/${n}.blk`)) };
}

/** a comparer: `chk(label, original, port, tol)` records the worst absolute difference per label and the first that exceeds `tol` (relative to max(1, |original|)) */
export function comparer(tol0 = 0) {
  const c = { checked: 0, failures: [], worst: {}, first: null };
  c.chk = (t, n, e, m, tol = tol0) => {
    c.checked++;
    const d = Math.abs(e - m);
    if (Number.isNaN(d)) { if (!c.first) c.first = { t, n, e, m }; return; }
    c.worst[n] = Math.max(c.worst[n] ?? 0, d);
    if (d > tol * Math.max(1, Math.abs(e)) && !c.first) c.first = { t, n, e, m };
  };
  c.result = (name) => {
    if (c.first) c.failures.push(`${name}: first difference at tick ${c.first.t}: ${c.first.n} original ${c.first.e} port ${c.first.m}`);
    const w = Object.entries(c.worst).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ');
    return { checked: c.checked, failures: c.failures, notes: [`${name}: worst differences ${w || 'none (bit-exact)'}`] };
  };
  return c;
}

/** a small world of records (names / positions / optional matrices): the same description builds the emulated record array and the port's */
function makeWorld(specs) {
  const w = new World();
  pinBipClock(w);
  w.records = specs.map((s, i) => {
    const r = new GameRecord(s.name); r.index = i;
    if (s.m) r.m.set(s.m); else { r.x = s.x ?? 0; r.y = s.y ?? 0; r.z = s.z ?? 0; r.m[0] = r.m[5] = r.m[10] = 1; }
    return r;
  });
  w.col.records = [];
  return w;
}
const blank = (n) => Array.from({ length: n }, () => ({ name: 'XXXX', x: 0, y: -500, z: 0 }));
const placePlane = (emu, rec, x, y, z) => { rec.m[12] = x; rec.m[13] = y; rec.m[14] = z; const pb = 0x10000000 + rec.index * 0x68; emu.cpu.mem.wf32(pb + 0x3c, x); emu.cpu.mem.wf32(pb + 0x40, y); emu.cpu.mem.wf32(pb + 0x44, z); };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
/** FUN_00447280 / FUN_00446af0 / FUN_00447550: the path object */
export function oracleSpline(ctx) {
  const F = bipFixture(ctx), sp = F.spline;
  const emu = new BipEmu(F.pe, sp, [{ name: 'XXXX' }]);
  const cmp = comparer();
  const cpu = emu.cpu, mem = cpu.mem, curve = emu.curve;
  const planesP = mem.u32(curve + 4);
  for (let i = 0; i < sp.n * 4; i++) cmp.chk(0, 'plane', mem.f32(planesP + i * 4), sp.planes[i]);
  const matP = emu.alloc(64), posP = emu.alloc(16);
  const u32 = (f) => new Uint32Array(new Float32Array([f]).buffer)[0];
  for (const t of [0, 0.01, 0.0167, 0.03, 0.2, 0.5, 0.77, 0.9, 0.99, 0.998]) {
    cpu.regs[1] = curve; cpu.call(0x446af0, [matP, posP, u32(t)]);
    const my = sp.frame(Math.fround(t));
    for (let i = 0; i < 16; i++) cmp.chk(t, 'frame', mem.f32(matP + i * 4), my.m[i]);
    for (let i = 0; i < 3; i++) cmp.chk(t, 'normal', mem.f32(posP + i * 4), my.normal[i]);
  }
  let seed = 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const q = emu.alloc(16);
  for (let k = 0; k < 300; k++) {
    const pos = [rnd() * 2400 - 1600, rnd() * 140 - 20, rnd() * 2200 - 100].map(Math.fround);
    for (let i = 0; i < 3; i++) mem.wf32(q + i * 4, pos[i]);
    cpu.regs[1] = curve; cpu.call(0x447550, [q]);
    const t = sp.nearest(pos);
    cmp.chk(k, 'progress', mem.f32(curve + 0x1c), t);
    cmp.chk(k, 'idxA', mem.r32(curve + 0x28), sp.idxA); cmp.chk(k, 'idxB', mem.r32(curve + 0x2c), sp.idxB); cmp.chk(k, 'atEnd', mem.r8(curve + 0x24) ? 1 : 0, sp.atEnd ? 1 : 0);
  }
  return cmp.result('spline');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
/**
 * FUN_00709fac and its helpers (the flight node) for `ticks` ticks of scripted buttons: steering, pitch, thrust, brake, bananas, fuel, the score for being ahead of Johnny,
 * banana hits on a monkey, a banana target and a rope target, the pickups and the crash (a scripted collision), the camera. Stops when the course ends (landing mode).
 */
export function oracleFlight(ctx, ticks = 900) {
  const F = bipFixture(ctx), sp = F.spline;
  const FUEL = 76, BANP = 77, BANT = 78, MNK = 79, DTR = 70, DTH = 71;
  const seq = [0, B.UP, B.UP, B.LEFT, B.LEFT | B.UP, 0, B.RIGHT, B.DOWN, B.DOWN | B.RIGHT, B.ALT, B.SPACE, B.SPACE | B.LEFT, B.SHIFT, B.SHIFT | B.SPACE, B.SPACE, B.SPACE, 0, B.UP | B.SPACE];
  const sweepScript = (t) => (t === 60 ? 'LAND' : t === 200 ? 'FUEL' : t === 220 ? 'BANP' : null);
  /** the port's side: a world, the flight node and the stand-in records; `targets` = [x, y, z] of the monkey, the banana target and the rope target */
  const build = (targets) => {
    const specs = blank(80);
    specs[0] = { name: 'LAND' };
    specs[74] = { name: 'PEPP', x: 325, y: 24.5, z: 55 };
    specs[75] = { name: 'SEPL', x: 0, y: 0, z: 0 };
    specs[FUEL] = { name: 'FUEL' }; specs[BANP] = { name: 'BANP' };
    specs[BANT] = { name: 'BANT', x: targets[1][0], y: targets[1][1], z: targets[1][2] };
    specs[MNK] = { name: 'MNK0', x: targets[0][0], y: targets[0][1], z: targets[0][2] };
    specs[DTR] = { name: 'DTR1', x: targets[2][0], y: targets[2][1], z: targets[2][2] };
    specs[DTH] = { name: 'DTH1' };
    const w = makeWorld(specs);
    const run = bipRun(w); run.spline = sp;
    const node = new PlaneNode();
    w.records[74].ctrl = new Controller(); w.records[74].ctrl.attach(node, 0);
    node.init(w);
    const mk = new MonkeyNode(3, 4); mk.state = 1; w.records[MNK].ctrl = new Controller(); w.records[MNK].ctrl.attach(mk, 0);
    const rope = new RopeSlideNode(); w.records[DTH].ctrl = new Controller(); w.records[DTH].ctrl.attach(rope, 0);
    run.johnny = { progress: Math.fround(0.02), ahead: false };
    w.col.sweep = () => { const s = sweepScript(w.tickCount + 1); return s ? { rec: w.records[specs.findIndex((x) => x.name === s)], point: [0, 0, 0], normal: [0, 1, 0], polygon: 0, surface: 0, t: 0 } : null; };
    w.vars.set(0xfa, 2);
    node.speed = 400; node.alt = 24.5;
    return { specs, w, run, node, mk, rope };
  };
  // a pre-pass of the port alone puts the stand-ins where bananas will fly: the first active banana at ticks 110, 135 and 215
  const trace = build([[0, -500, 0], [0, -500, 0], [0, -500, 0]]);
  const pick = {};
  let twait = 0;
  for (let tick = 0; tick < 230; tick++) {
    trace.w.input.setVirtual(seq[Math.floor(tick / 7) % seq.length]); trace.w.input.update();
    if (trace.w.vars.get(0xfa) !== 2) { trace.w.tickCount++; if (++twait > 30) { twait = 0; trace.w.vars.set(0xfa, 2); } continue; }
    trace.node.update(trace.w, trace.w.records[74]); trace.w.tickCount++;
    for (const t of [110, 135, 215]) if (tick === t) { const b = trace.node.bananas.find((x) => x.active); if (b) pick[t] = [b.x, b.y, b.z]; }
  }
  const targets = [pick[110] ?? [150, 24, -130], pick[135] ?? [200, 40, -80], pick[215] ?? [250, 30, -20]];
  const T = build(targets);
  const { specs, w, run, node, mk, rope } = T;
  const emu = new BipEmu(F.pe, sp, specs);
  const J = emu.alloc(0x104); emu.cpu.mem.wf32(J + 0x28, 0.02); emu.setNode(75, J);
  const MN = emu.alloc(0x3a0); emu.cpu.mem.w8(MN + 0x39c, 1); emu.setNode(MNK, MN);
  const DH = emu.alloc(0x108); emu.setNode(DTH, DH);
  const P = emu.makePlane(74);
  let tick = 0;
  emu.sweep = () => { const s = sweepScript(emu.tick); return s ? specs.findIndex((x) => x.name === s) : -1; };
  const offs = { steer: 0x34, pitch: 0x40, thrust: 0x1c, brake: 0x28, alt: 0x4c, speed: 0x60, accel: 0x68, fuel: 0x70, heading: 0x7c, rollAngle: 0x84, headRef: 0xa0, headCorr: 0xa4 };
  const ioffs = { ammo: 0x6c, score: 0x74, pickFlag: 0x98 };
  const cmp = comparer();
  const rec = w.records[74], mem = emu.cpu.mem;
  emu.vars.set(0xfa, 2);
  mem.wf32(P + 0x60, 400); mem.wf32(P + 0x4c, 24.5);
  let wait = 0, landed = -1;
  for (tick = 0; tick < ticks; tick++) {
    const b = seq[Math.floor(tick / 7) % seq.length];
    emu.buttons = b; w.input.setVirtual(b); w.input.update();
    const gate = w.vars.get(0xfa);
    if (gate === 0x10) { landed = tick; break; }
    if (gate !== 2) { w.tickCount++; if (++wait > 30) { wait = 0; w.vars.set(0xfa, 2); emu.vars.set(0xfa, 2); } continue; }   // Recover is tested in the sequence
    emu.tc = w.tickCount;
    node.update(w, rec);
    w.tickCount++;
    emu.tick = tick; emu.flightTick(74);       // (flightTick counts up: the scripted sweeps are keyed by tick + 1 on both sides)
    emu.cpu.steps = 0; emu.cpu.call(0x70b58c, [emu.recPtr(74), P, 0, 0], { maxSteps: 5e6 });      // the draw turns the bananas
    for (const [k, o] of Object.entries(offs)) cmp.chk(tick, k, emu.f(P + o), node[k]);
    for (const [k, o] of Object.entries(ioffs)) cmp.chk(tick, k, emu.i(P + o), node[k]);
    cmp.chk(tick, 'rolling', mem.r8(P + 0x80), node.rolling ? 1 : 0);
    const base = 0x10000000 + 74 * 0x68;
    for (let i = 0; i < 3; i++) cmp.chk(tick, 'pos' + i, emu.f(base + 0x3c + 4 * i), rec.m[12 + i]);
    for (let i = 0; i < 11; i++) if (i % 4 !== 3) cmp.chk(tick, 'matrix', emu.f(base + 0xc + 4 * i), rec.m[i]);
    for (let i = 0; i < 6; i++) cmp.chk(tick, 'camera', emu.f(0x9da5e8 + 4 * i), w.camera.c[i]);
    cmp.chk(tick, 'result', mem.r8(0x5d5d044), run.result);
    for (let i = 0; i < 30; i++) {
      const bb = P + 0x118 + i * 0x6c;
      cmp.chk(tick, 'banana.active', mem.r8(bb + 0x50), node.bananas[i].active ? 1 : 0);
      if (node.bananas[i].active) { cmp.chk(tick, 'banana.x', emu.f(bb + 0x30), node.bananas[i].x); cmp.chk(tick, 'banana.vy', emu.f(bb + 0x44), node.bananas[i].vy); cmp.chk(tick, 'banana.spin', emu.f(bb + 0x60), node.bananas[i].ax); }
    }
    cmp.chk(tick, 'monkey.state', mem.r8(MN + 0x39c), mk.state); cmp.chk(tick, 'rope.hit', emu.i(DH + 0x4c), rope.hit);
    cmp.chk(tick, 'var', emu.vars.get(0xfa) ?? 0, w.vars.get(0xfa));
    cmp.chk(tick, 'random index', mem.u32(0x5d5d02c), run.randIdx);
    if (cmp.first) break;
  }
  const out = cmp.result('flight');
  out.notes.push(`flight: ${tick} ticks, score ${node.score}, bananas fired ${run.stats.bananasFired}, monkey hits ${run.stats.monkeyHits}, target hits ${run.stats.targetHits} + ${run.stats.bantHits}, cans ${run.stats.fuelCans}, bunches ${run.stats.bananaPickups}, crashes ${run.stats.crashes}${landed >= 0 ? `, landing mode at ${landed}` : ''}`);
  out.stats = { ...run.stats, score: node.score, ticks: tick, landed };
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
/**
 * The whole flight from the take-off to the landing: the constructors of Takeoff / Landing / Recover / csplane run natively (reading the `.SRC` files), a guided
 * pilot flies, a scripted crash at tick 400 and fuel cans at 300 + 500 n; compares the nodes, both records' matrices and the camera every tick, up to the result.
 */
export function oracleSequence(ctx, maxTicks = 4000) {
  const F = bipFixture(ctx), sp = F.spline;
  const specs = blank(80);
  specs[0] = { name: 'LAND' }; specs[74] = { name: 'PEPP', x: 454.549, y: -36.49, z: 197.63 }; specs[75] = { name: 'SEPL', x: 0, y: -7.5, z: 0 }; specs[76] = { name: 'FUEL' };
  const emu = new BipEmu(F.pe, sp, specs);
  emu.hostFiles(new Map([['runwaystart.src', F.file('source/Runwaystart.src')], ['runwayend.src', F.file('source/Runwayend.src')]]));
  const P = emu.makePlane(74);
  const Jn = emu.construct(0x70df00, 75, 0, [2, 1, 1]);
  const Tk = emu.construct(0x70c36b, 74, emu.block(['_Data\\Z22Bip\\Source\\Runwaystart.SRC']), [0xfa, 8, 8]);
  const Ld = emu.construct(0x70e8b0, 74, emu.block(['_Data\\Z22Bip\\Source\\Runwayend.SRC']), [0xfa, 16, 16]);
  const Rc = emu.construct(0x710167, 74, 0, [0xfa, 4, 4]);
  emu.chain(74, [emu.alloc(0x40), P, Rc, Tk, Ld]); emu.chain(75, [Jn]);
  emu.vars.set(0xfa, 8);
  const w = makeWorld(specs);
  const run = bipRun(w); run.spline = sp;
  const walk = new PlaneNode(), tk = new TakeoffNode(), ld = new LandingNode(), rc = new RecoverNode(), jn = new JohnnyNode();
  const pts = (v) => ({ pos0: v[0], rot0: v[1], pos1: v[2], rot1: v[3] });
  tk.src = pts(F.rs); ld.bind(pts(F.re));
  walk.init(w); jn.init(w); run.takeoff = tk;
  w.vars.set(0xfa, 8);
  const prec = w.records[74], jrec = w.records[75];
  const mem = emu.cpu.mem;
  w.camera.c[1] = w.camera.c[4] = 500; mem.wf32(0x9da5ec, 500); mem.wf32(0x9da5f8, 500);
  const sweepScript = (t) => (t === 400 ? 'LAND' : t % 500 === 300 ? 'FUEL' : null);
  let tick = 0;
  emu.sweep = () => { const s = sweepScript(emu.tick); return s ? specs.findIndex((x) => x.name === s) : -1; };
  w.col.sweep = () => { const s = sweepScript(tick + 1); return s ? { rec: w.records[specs.findIndex((x) => x.name === s)], point: [0, 0, 0], normal: [0, 1, 0], polygon: 0, surface: 0, t: 0 } : null; };
  const cmp = comparer();
  const f = (va) => emu.f(va), i32 = (va) => emu.i(va);
  const compare = (t) => {
    cmp.chk(t, 'takeoff.state', i32(Tk + 0x18), tk.state); cmp.chk(t, 'takeoff.wait', f(Tk + 0x1c), tk.wait); cmp.chk(t, 'takeoff.count', f(Tk + 0x20), tk.count);
    cmp.chk(t, 'takeoff.progress', f(Tk + 0x2c), tk.progress); cmp.chk(t, 'takeoff.climb', f(Tk + 0xc8), tk.climb); cmp.chk(t, 'takeoff.climbSpeed', f(Tk + 0xcc), tk.climbSpeed);
    cmp.chk(t, 'johnny.wait', f(Jn + 0x18), jn.wait); cmp.chk(t, 'johnny.waiting', f(Jn + 0x1c), jn.waiting); cmp.chk(t, 'johnny.bend', f(Jn + 0x20), jn.bend);
    cmp.chk(t, 'johnny.roll', f(Jn + 0x24), jn.roll); cmp.chk(t, 'johnny.progress', f(Jn + 0x28), jn.progress);
    cmp.chk(t, 'landing.phase', i32(Ld + 0x18), ld.phase);
    if (ld.phase) { cmp.chk(t, 'landing.approach', i32(Ld + 0x1c), ld.approach); cmp.chk(t, 'landing.slide', i32(Ld + 0x20), ld.slide); }
    cmp.chk(t, 'recover.phase', i32(Rc + 0x18), rc.phase); cmp.chk(t, 'recover.ticks', i32(Rc + 0x34), rc.ticks);
    for (const [k, o] of Object.entries({ steer: 0x34, pitch: 0x40, alt: 0x4c, speed: 0x60, fuel: 0x70, heading: 0x7c })) cmp.chk(t, 'flight.' + k, f(P + o), walk[k]);
    cmp.chk(t, 'flight.score', i32(P + 0x74), walk.score); cmp.chk(t, 'flight.landed', mem.r8(P + 0x9c), walk.landed ? 1 : 0);
    const base = 0x10000000 + 74 * 0x68, jb = 0x10000000 + 75 * 0x68;
    for (let k = 0; k < 16; k++) { cmp.chk(t, 'plane matrix', f(base + 0xc + 4 * k), prec.m[k]); cmp.chk(t, 'johnny matrix', f(jb + 0xc + 4 * k), jrec.m[k]); }
    for (let k = 0; k < 6; k++) cmp.chk(t, 'camera', f(0x9da5e8 + 4 * k), w.camera.c[k]);
    cmp.chk(t, 'var', emu.vars.get(0xfa) ?? 0, w.vars.get(0xfa)); cmp.chk(t, 'result', mem.r8(0x5d5d044), run.result);
  };
  const modes = [];
  for (tick = 0; tick < maxTicks; tick++) {
    emu.tick = tick + 1; emu.tc = tick;
    let b = 0;
    const gate = w.vars.get(0xfa);
    if (modes[modes.length - 1] !== gate) modes.push(gate);
    if (gate === 2) {
      const t0 = sp.nearest([prec.x, prec.y, prec.z]);
      const tg = sp.sample(Math.min(0.999, t0 + 0.025));
      let e = Math.atan2(tg[0] - prec.x, tg[2] - prec.z) - walk.heading;
      while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI;
      if (e > 0.04) b |= B.RIGHT; else if (e < -0.04) b |= B.LEFT;
      const want = Math.min(90, tg[1] + 14);
      if (walk.alt < want - 4) b |= B.DOWN; else if (walk.alt > want + 4) b |= B.UP;
      if (tick % 40 < 12) b |= B.SPACE;
    }
    emu.buttons = b; w.input.setVirtual(b); w.input.update();
    const pr = emu.recPtr(74), g = emu.vars.get(0xfa), cpu = emu.cpu;
    const go = (fn, rec, node) => { cpu.steps = 0; cpu.call(fn, [rec, node], { maxSteps: 5e6 }); };
    if (g & 2) go(0x709fac, pr, P); else if (g & 4) go(0x70fdc0, pr, Rc); else if (g & 8) go(0x70c014, pr, Tk); else if (g & 0x10) go(0x70e42c, pr, Ld);
    go(0x70db60, emu.recPtr(75), Jn);
    if (gate & 2) walk.update(w, prec); else if (gate & 4) rc.update(w, prec); else if (gate & 8) tk.update(w, prec); else if (gate & 0x10) ld.update(w, prec);
    jn.update(w, jrec);
    w.tickCount++;
    compare(tick);
    if (cmp.first || run.result) break;
  }
  const out = cmp.result('sequence');
  out.notes.push(`sequence: ${tick} ticks, modes ${modes.join(' > ')}, result ${run.result}, score ${walk.score}, landed ${walk.landed}`);
  out.modes = modes; out.result = run.result; out.ticks = tick;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
/** FUN_0070f433 / FUN_0070f6ec / FUN_0070efc0: a monkey and its melons against a plane that hovers and then passes (animation hosted with the port's AnimInstance) */
export function oracleMonkey(ctx, ticks = 700) {
  const F = bipFixture(ctx), sp = F.spline, blk = F.blk('MONK');
  const MK = 30;
  const specs = blank(80);
  specs[74] = { name: 'PEPP', x: 0, y: 40, z: 0 }; specs[MK] = { name: 'MNK4', x: 60, y: 45, z: 200 };
  const emu = new BipEmu(F.pe, sp, specs);
  emu.hostAnims();
  const instE = new AnimInstance(blk); emu.setAnim(MK, instE);
  const P = emu.makePlane(74);
  emu.chain(74, [emu.alloc(0x40), P]);
  emu.cpu.mem.wf32(P + 0x60, 400);
  const Mn = emu.construct(0x70fafb, MK, emu.block([4, 3, 4, 0x1111, 0x2222]), [2, 1, 1]);
  emu.chain(MK, [Mn]);
  const w = makeWorld(specs);
  const run = bipRun(w); run.spline = sp;
  const walk = new PlaneNode(); walk.init(w); walk.speed = 400;
  const mk = new MonkeyNode(3, 4); mk.drawScale = 1;
  const instT = new AnimInstance(blk);
  w.records[MK].anim = instT; w.records[MK].ctrl = new Controller(); w.records[MK].ctrl.attach(mk, 0);
  const prec = w.records[74], mem = emu.cpu.mem;
  const cmp = comparer();
  let hits = 0;
  for (let tick = 0; tick < ticks; tick++) {
    placePlane(emu, prec, tick < 350 ? 30 : -120 + tick * 0.55, 44, tick < 350 ? 140 : 40 + tick * 1.5);
    if (tick === 250) { mk.state = 2; mem.w8(Mn + 0x39c, 2); }
    if (tick === 100 || tick === 300) { walk.rolling = false; mem.w8(P + 0x80, 0); }
    emu.tc = tick; emu.tick = tick; w.tickCount = tick;
    emu.cpu.steps = 0; emu.cpu.call(0x70f433, [emu.recPtr(MK), Mn], { maxSteps: 5e6 });
    emu.cpu.steps = 0; emu.cpu.call(0x70f6ec, [emu.recPtr(MK), Mn, 0, 0], { maxSteps: 5e6 });
    mk.update(w, w.records[MK]);
    const rb = 0x10000000 + MK * 0x68;
    cmp.chk(tick, 'state', mem.r8(Mn + 0x39c), mk.state); cmp.chk(tick, 'clock', emu.i(Mn + 0x398), mk.clock);
    cmp.chk(tick, 'anim frame', instE.frame, instT.frame); cmp.chk(tick, 'anim clip', instE.clip, instT.clip);
    for (let i = 0; i < 10; i++) {
      const m = Mn + 0x28 + i * 0x58;
      cmp.chk(tick, 'melon.active', mem.r8(m + 0x54), mk.melons[i].active ? 1 : 0);
      if (mk.melons[i].active) { cmp.chk(tick, 'melon.x', emu.f(m + 0x30), mk.melons[i].x); cmp.chk(tick, 'melon.vy', emu.f(m + 0x44), mk.melons[i].vy); cmp.chk(tick, 'melon.spin', emu.f(m + 0x4c), mk.melons[i].spin); }
    }
    cmp.chk(tick, 'plane.rolling', mem.r8(P + 0x80), walk.rolling ? 1 : 0); cmp.chk(tick, 'plane.score', emu.i(P + 0x74), walk.score); cmp.chk(tick, 'random index', mem.u32(0x5d5d02c), run.randIdx);
    for (let k = 0; k < 11; k++) if (k % 4 !== 3) cmp.chk(tick, 'record matrix', emu.f(rb + 0xc + 4 * k), w.records[MK].m[k]);
    if (cmp.first) break;
  }
  hits = run.stats.melonHits;
  const out = cmp.result('monkey');
  out.notes.push(`monkey: melon hits ${hits}, plane rolling ${walk.rolling}`);
  out.melonHits = hits;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
/** FUN_0070ca17 / FUN_0070c774 / FUN_0070c998 / FUN_0070cdba: a rock monster, its clips, a banana hit and the stones (scripted sweeps: a wall and the plane) */
export function oracleRock(ctx, ticks = 800) {
  const F = bipFixture(ctx), sp = F.spline, blk = F.blk('ROCK');
  const RK = 5, yaw = 0.3;
  const specs = blank(200);
  specs[74] = { name: 'PEPP', x: 0, y: 40, z: 0 };
  specs[RK] = { name: 'ROC2', m: Array.from(buildMatrix(0, yaw, 0, 100, 30, 100)) };
  const emu = new BipEmu(F.pe, sp, specs);
  emu.hostAnims();
  const instE = new AnimInstance(blk); emu.setAnim(RK, instE);
  const P = emu.makePlane(74);
  emu.chain(74, [emu.alloc(0x40), P]);
  const Rk = emu.construct(0x70cfd8, RK, emu.block([0, 0]), [2, 1, 1]);
  emu.chain(RK, [Rk]);
  const w = makeWorld(specs);
  w.records[RK].m.set(specs[RK].m);
  const run = bipRun(w); run.spline = sp;
  const walk = new PlaneNode(); walk.init(w);
  const instT = new AnimInstance(blk); instT.start(3, 0);
  w.records[RK].anim = instT;
  const rk = new RockyNode(); w.records[RK].ctrl = new Controller(); w.records[RK].ctrl.attach(rk, 0);
  const prec = w.records[74], mem = emu.cpu.mem;
  let tick = 0;
  const plan = (t) => (t % 97 === 40 ? 74 : t % 53 === 20 ? 3 : -1);
  emu.sweep = () => plan(emu.tick);
  w.col.sweep = () => { const i = plan(tick); return i < 0 ? null : { rec: w.records[i], point: [0, 0, 0], normal: [0, 1, 0], polygon: 0, surface: 0, t: 0 }; };
  const cmp = comparer();
  for (tick = 0; tick < ticks; tick++) {
    const d = tick < 150 ? 150 : tick < 400 ? 60 : 90;
    placePlane(emu, prec, 100 + d * Math.sin(yaw), 40, 100 + d * Math.cos(yaw));
    if (tick === 300) { const bn = walk.bananas[0]; bn.active = true; bn.x = 100; bn.y = 32; bn.z = 102; const m = P + 0x118; mem.w8(m + 0x50, 1); mem.wf32(m + 0x30, 100); mem.wf32(m + 0x34, 32); mem.wf32(m + 0x38, 102); }
    if (tick === 310) { walk.bananas[0].active = false; mem.w8(P + 0x118 + 0x50, 0); }
    if (tick % 120 === 119) { walk.rolling = false; mem.w8(P + 0x80, 0); }
    emu.tc = tick; emu.tick = tick; w.tickCount = tick;
    emu.cpu.steps = 0; emu.cpu.call(0x70ca17, [emu.recPtr(RK), Rk], { maxSteps: 5e6 });
    emu.cpu.steps = 0; emu.cpu.call(0x70cdba, [emu.recPtr(RK), Rk, 0, 0], { maxSteps: 5e6 });
    rk.update(w, w.records[RK]);
    cmp.chk(tick, 'state', emu.i(Rk + 0x24), rk.state); cmp.chk(tick, 'anim frame', instE.frame, instT.frame); cmp.chk(tick, 'anim clip', instE.clip, instT.clip);
    const sb = emu.i(Rk + 0x30);
    for (let i = 0; i < 10; i++) {
      const s = sb + i * 0x3c, st = rk.stones[i];
      cmp.chk(tick, 'stone.active', mem.r32(s), st.active ? 1 : 0);
      if (st.active) for (const [n, o, v] of [['x', 0x10, st.x], ['y', 0x14, st.y], ['z', 0x18, st.z], ['vx', 4, st.vx], ['vy', 8, st.vy], ['angle', 0x24, st.ax]]) cmp.chk(tick, 'stone.' + n, emu.f(s + o), v);
      if (st.active) cmp.chk(tick, 'stone.life', mem.r32(s + 0x1c), st.life);
    }
    cmp.chk(tick, 'plane.rolling', mem.r8(P + 0x80), walk.rolling ? 1 : 0); cmp.chk(tick, 'plane.score', emu.i(P + 0x74), walk.score); cmp.chk(tick, 'random index', mem.u32(0x5d5d02c), run.randIdx);
    if (cmp.first) break;
  }
  const out = cmp.result('rock');
  out.notes.push(`rock: stone hits on the plane ${run.stats.stoneHits}, state ${rk.state}`);
  out.stoneHits = run.stats.stoneHits;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
/** the rope target (FUN_0070ed68 / FUN_0070ea60, reads DTH1.SRC), the fuel can's turn, the crocodile's clip and the three propellers */
export function oracleProps(ctx, ticks = 700) {
  const F = bipFixture(ctx), sp = F.spline;
  const specs = blank(100);
  const A = 90, Bi = 91, C = 92, JC = 93, CR = 94, PR = 76;
  specs[A] = { name: 'DTH1', x: -165, y: 85, z: 70 };
  specs[Bi] = { name: 'SLD1', m: Array.from(buildMatrix(0.3, 0.2, 0.1, -165, 85, 70)) };
  specs[C] = { name: 'DTR1', m: Array.from(buildMatrix(0.1, 1.2, 0.4, -165, 85, 70)) };
  specs[JC] = { name: 'FUEL', m: Array.from(buildMatrix(0, 0.5, 0, 10, 20, 30)) };
  specs[PR] = { name: 'PROP' };
  specs[74] = { name: 'PEPP', m: Array.from(buildMatrix(0.1, 0.7, 0, 100, 50, 20)) };
  specs[75] = { name: 'SEPL', m: Array.from(buildMatrix(0.0, 2.2, 0.3, -30, 20, 70)) };
  const emu = new BipEmu(F.pe, sp, specs);
  emu.hostFiles(new Map([['dth1.src', F.file('source/DTH1.src')]]));
  emu.hostAnims();
  const croc = F.blk('CROC');
  const instE = new AnimInstance(croc); emu.setAnim(CR, instE);
  const Rp = emu.construct(0x70ed68, A, emu.block(['_Data\\Z22Bip\\Source\\DTH1.SRC', 0, 0, 0, 0, 0, 0, 100, 10, emu.recPtr(Bi), emu.recPtr(C)]), [2, 1, 1]);
  emu.chain(A, [Rp]);
  const Jc = emu.construct(0x70daa6, JC, 0, [2, 1, 1]); emu.chain(JC, [Jc]);
  const Ac = emu.construct(0x70d523, CR, 0, [2, 1, 1]); emu.chain(CR, [Ac]);
  const angles = emu.alloc(36), offsets = emu.alloc(36), owners = emu.alloc(12), mats = emu.alloc(3 * 64);
  const off = [[0.085, -0.026, 6.795], [-7.375, 2.179, 3.06], [7.392, 2.179, 3.06]];
  off.forEach((o, i) => o.forEach((v, k) => emu.cpu.mem.wf32(offsets + i * 12 + k * 4, v)));
  [74, 75, 75].forEach((r, i) => emu.cpu.mem.w32(owners + i * 4, emu.recPtr(r)));
  const Pp = emu.construct(0x70d352, PR, emu.block([3, angles, offsets, owners, mats]), [2, 1, 1]); emu.chain(PR, [Pp]);
  const w = makeWorld(specs);
  w.records.forEach((r, i) => { if (specs[i].m) r.m.set(specs[i].m); });
  const run = bipRun(w); run.spline = sp;
  const pts = (v) => ({ pos0: v[0], rot0: v[1], pos1: v[2], rot1: v[3] });
  const rope = new RopeSlideNode(); rope.bind(pts(F.src('DTH1.src')), w.records[Bi], w.records[C]);
  w.records[A].ctrl = new Controller(); w.records[A].ctrl.attach(rope, 0);
  const can = new JerryCanNode(); w.records[JC].ctrl = new Controller(); w.records[JC].ctrl.attach(can, 0);
  const instT = new AnimInstance(croc); w.records[CR].anim = instT;
  const ap = new AnimPropNode(1); w.records[CR].ctrl = new Controller(); w.records[CR].ctrl.attach(ap, 0);
  const pn = new PropsNode(); pn.owners = [74, 75, 75]; pn.offsets = off; pn.angles = [0, 0, 0];
  w.records[PR].ctrl = new Controller(); w.records[PR].ctrl.attach(pn, 0);
  const mem = emu.cpu.mem;
  const cmp = comparer();
  const recM = (i, k) => emu.f(0x10000000 + i * 0x68 + 0xc + 4 * k);
  for (let tick = 0; tick < ticks; tick++) {
    if (tick === 130 || tick === 420) { rope.hit = 1; mem.w32(Rp + 0x4c, 1); }
    emu.tc = tick; emu.tick = tick; w.tickCount = tick;
    for (const [fn, rec, node] of [[0x70ea60, A, Rp], [0x70d960, JC, Jc], [0x70d437, CR, Ac], [0x70d140, PR, Pp]]) { emu.cpu.steps = 0; emu.cpu.call(fn, [emu.recPtr(rec), node], { maxSteps: 5e6 }); }
    rope.update(); can.update(w, w.records[JC]); ap.update(w, w.records[CR]); pn.update(w);
    cmp.chk(tick, 'rope.moving', emu.i(Rp + 0x48), rope.moving); cmp.chk(tick, 'rope.hit', emu.i(Rp + 0x4c), rope.hit); cmp.chk(tick, 'rope.step', emu.i(Rp + 0x58), rope.step);
    cmp.chk(tick, 'rope.wait', emu.i(Rp + 0x5c), rope.waitLeft); cmp.chk(tick, 'rope.turn', emu.f(Rp + 0x64), rope.turn);
    for (let k = 0; k < 3; k++) cmp.chk(tick, 'rope.position', emu.f(Rp + 0x30 + 4 * k), rope.cur[k]);
    for (const r of [Bi, C]) for (let k = 0; k < 16; k++) cmp.chk(tick, 'rope partner matrix', recM(r, k), w.records[r].m[k]);
    for (let k = 0; k < 16; k++) cmp.chk(tick, 'fuel can matrix', recM(JC, k), w.records[JC].m[k]);
    cmp.chk(tick, 'croc frame', instE.frame, instT.frame); cmp.chk(tick, 'croc clip', instE.clip, instT.clip);
    for (let i = 0; i < 3; i++) for (let k = 0; k < 16; k++) cmp.chk(tick, 'propeller matrix', emu.f(mats + i * 64 + 4 * k), pn.matrices[i][k]);
    if (cmp.first) break;
  }
  return cmp.result('props');
}
