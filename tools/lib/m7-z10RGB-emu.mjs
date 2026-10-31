// WP-VERIFY z10RGB: the oracle harness (a copy of the one of tools/tests/m6-z10RGB-emu.mjs, which stays untouched) extended for the coverage test
// tools/tests/m7-z10RGB-cover.mjs: the frame step dt is a parameter of both sides (the original reads DAT_008b1718 / DAT_008b171c, hosted animation advance
// and the port's `world.dt`), the x86 trace hook counts the executed instruction addresses (H.cov), the ball's shadow samples (FUN_005f8a7b: shadow flag and the
// five ground points at ball +0x68 / +0x6c) are compared, and the scenarios can inject state on both sides.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe, loadZone } from './engine-load.mjs';
import '../../src/island/ambient/misc.ts';   // registers SeaAmin: the port's SEAE record becomes non-solid like the original's (the oracle sets the same flag)
import * as Z from '../../src/zones/z10RGB.ts';
import { initRgb, bindRigs } from '../../src/zones/z10rgb/game.ts';
import { updateBalls, placeBall, launchBall } from '../../src/zones/z10rgb/balls.ts';
import { MsvcRng } from './msvc-rng.mjs';
import { setRandSource, randF } from '../../src/game/crt.ts';
import { shotScale } from '../../src/zones/z10rgb/pepper.ts';
import { REC, VAR, PHASE, MODE, K, RIGS } from '../../src/zones/z10rgb/consts.ts';
import { SOUND_DEFS } from '../../src/zones/z10rgb/sound.ts';
import { ROUTE, steerKeys, planShot, nextTarget, aimKeys } from '../../src/zones/z10rgb/bot.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { decode } from '../../src/formats/x86.ts';

const RB = 0x30000000, HEAP = 0x31000000, AB = 0x33000000, MB = 0x34000000;
const NREC = 147;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
const fr = (v) => { F32[0] = v; return F32[0]; };
export { fr, RB, NREC };

/** T = { checked, bad(msg), ok(cond, msg), eqv(a, b, msg) } of the calling test */
export function createHarness(ctx, T) {
  {
    const { bad, ok, eqv } = T;
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z10RGB');

    // ============================================================ the two sides
    const build = (seed, dt = 1) => {
      shotScale.value = K.SHOT_SCALE_FIRST;
      // the port: the zone as the game builds it, the walk node off
      const lcgP = new MsvcRng(seed * 7919 + 13);
      const replay = { q: [], calls: 0 };
      setRandSource(() => lcgP.next());      // the nine cannon delays are drawn at construction (same sequence as the original's): the port's rand() is the shared crt.ts one, scripted
      const P = loadZone(ctx, 'z10RGB');
      const w = P.world; w.externalInput = true; w.dt = dt;
      const st = Z.state;
      const walk = st.pepper?.ctrl?.find('SGwalk') ?? w.records[REC.PEPP].ctrl.find('SGwalk');
      walk.var = 1; walk.mask = 1; walk.value = 1;
      const said = [], snd = [];
      st.say = (id) => { said.push(['say', id, null]); return true; };
      const nameToId = Object.fromEntries(Object.entries(SOUND_DEFS).map(([n, d]) => [n, d.id]));
      st.sound = {
        play: (n) => snd.push(['2d', nameToId[n]]), stop: (n) => snd.push([SOUND_DEFS[n].kind === '2d' ? 'stop2d' : 'stop3d', nameToId[n]]),
        at: (n, p) => snd.push(['3d', nameToId[n], fr(p[0]), fr(p[1]), fr(p[2])]),
      };
      initRgb(st, w, { pe, archive: arch });
      // the port's draws of the tick replay the original's integers: `st.rand` checks the range asked, then FUN_004388ae's float32 formula (crt.ts randF) runs on the replayed rand()
      setRandSource(() => replay.r);
      st.rand = (x) => {
        const e = replay.q.shift(); replay.calls++;
        if (!e) { bad('the port draws a random number the original did not'); return 0; }
        if (e.x !== x) bad(`random number: port asks rand(${x}), original rand(${e.x})`);
        replay.r = e.r;
        const v = randF(x);
        if (v !== e.f) bad(`random number: port rand(${x}) = ${v}, original ${e.f}`);
        return v;
      };
      // the original's world: the same zone data, anims bound; its records are the mirror of the emulated memory
      const O = loadZone(ctx, 'z10RGB');
      const ow = O.world; ow.dt = dt;
      const rigs = {};
      for (const g of RIGS) { const e = arch.find(`anim/${g.name}.blk`); rigs[g.name] = e ? parseBlk(arch.read(e)) : null; }
      bindRigs(ow, rigs);
      return { P, w, st, O, ow, said, snd, replay, lcgP, dt };
    };

    /** the original: the emulated memory with the records, the hosted services and the constructors run natively */
    const emulate = (S) => {
      const { ow, w, st } = S;
      const cpu = createCpu(pe), mem = cpu.mem;
      // Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE; see tools/lib/m7-walk-emu.mjs): every arithmetic result of the original rounds to a float mantissa
      cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;
      mem.addRegion({ lo: RB, hi: RB + NREC * 0x68 + 0x100, name: 'rec' });
      mem.addRegion({ lo: HEAP, hi: HEAP + 0x100000, name: 'heap' });
      mem.addRegion({ lo: MB, hi: MB + 0x10000, name: 'misc' });
      const H = { cpu, mem, log: [], calls: [], brk: HEAP, handles: new Map(), tokens: new Map(), rands: [], lcg: new MsvcRng(S.seed * 7919 + 13), allocs: [], unhooked: new Set(), nodes: {} };
      const rs = ow.records;
      const recPtr = (r) => RB + r.index * 0x68;
      const recOf = (p) => (p === 0 ? null : rs[(p - RB) / 0x68]);
      H.recPtr = recPtr; H.recOf = recOf;
      mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
      // ---- records into memory
      const mirrorIn = () => {
        for (const r of rs) {
          const p = recPtr(r);
          for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
          mem.w32(p + 4, 0);
          mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
          for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
          mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
          mem.w32(p + 0x58, r.colObj ? 1 : 0);
          mem.w16(p + 0x60, r.flags & 0xffff);
        }
      };
      /** the emulated memory into the original-side port records (for the sweeps, and for the comparison) */
      const syncOut = () => {
        for (const r of rs) {
          const p = recPtr(r);
          for (let i = 0; i < 16; i++) r.m[i] = mem.f32(p + 0xc + 4 * i);
          r.rx = mem.f32(p + 0x4c); r.ry = mem.f32(p + 0x50); r.rz = mem.f32(p + 0x54);
          r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60);
        }
      };
      H.mirrorIn = mirrorIn; H.syncOut = syncOut;
      mirrorIn();
      // ---- hosts
      const hook = (a, f) => cpu.hooks.set(a, f);
      const push = (e) => H.log.push(e);
      hook(0x433d38, (c) => { const n = c.arg(0); c.eax = H.brk; H.allocs.push({ size: n, ptr: H.brk }); H.brk += (n + 15) & ~15; });
      hook(0x433d60, () => {});
      const anim = (ptr) => rs[(ptr - AB) / 0x40].anim;
      hook(0x417575, (c) => { c.eax = ow.vars.get(c.arg(0)); });
      hook(0x417597, (c) => { ow.vars.set(c.arg(0), c.arg(1) | 0); });
      hook(0x41761b, (c) => { ow.vars.or(c.arg(0), c.arg(1) | 0); });
      hook(0x41766c, (c) => { ow.vars.andNot(c.arg(0), c.arg(1) | 0); });
      hook(0x4388ae, (c) => {
        const x = c.argf(0);
        // FUN_004388ae: x <= 0 gives 0.0 without a draw, else `(float) rand() / 32767.0f * x` in float32 steps (24-bit x87) on the hosted CRT rand
        let f = 0, r = -1;
        if (x > 0) { r = H.lcg.next(); f = fr(fr(r / 32767) * fr(x)); }
        H.rands.push({ x, r, f });
        c.fpush(f);
      });
      hook(0x4388e7, (c) => { c.fpush(fr(Math.sqrt(c.argf(0)))); });      // fsqrt at 24-bit precision
      hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
      hook(0x85d1c4, (c) => { c.fpush(Math.sin(mem.f64(c.esp + 4))); });
      hook(0x85d374, (c) => { c.fpush(Math.cos(mem.f64(c.esp + 4))); });
      hook(0x85d260, (c) => { c.fpush(Math.abs(mem.f64(c.esp + 4))); });
      // animation instances
      hook(0x43b6a3, (c) => { anim(c.arg(0)).start(c.arg(1) | 0, c.argf(2)); });
      hook(0x43b76a, (c) => { c.eax = anim(c.arg(0)).advance(c.argf(1), ow.dt); });
      hook(0x43b753, (c) => { c.fpush(anim(c.arg(0)).frameCount); });
      hook(0x43b92a, (c) => { const a = anim(c.arg(0)); c.eax = a.frameCount < fr(fr(1.0 + a.frame) + fr(c.argf(1) * ow.dt)) ? 2 : 0; });      // FUN_0043b92a: (1.0 + frame) + n * DAT_008b1718 in float32 steps, as the asm 0x43b949 .. 0x43b95d
      hook(0x43bc22, (c) => { c.eax = MB; });
      // collision over the port's own world (records synced from the memory first)
      hook(0x441a90, (c) => {
        syncOut();
        const ig = recOf(c.arg(0)), f = [0, 1, 2].map((i) => mem.f32(c.arg(1) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(c.arg(2) + 4 * i));
        const h = ow.col.sweep(ig, f, d, c.arg(5), 0.01, 0);
        push(['sweep', ig?.name, h ? h.rec.name : null]);
        if (!h) { c.eax = 0; return; }
        for (let i = 0; i < 3; i++) { mem.wf32(c.arg(3) + 4 * i, h.normal[i]); mem.wf32(c.arg(4) + 4 * i, h.point[i]); }
        c.eax = recPtr(h.rec);
      });
      hook(0x441b10, (c) => {
        syncOut();
        const rec = recOf(c.arg(0)), q = c.arg(1);
        const f = [0, 1, 2].map((i) => mem.f32(mem.u32(q) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(mem.u32(q + 4) + 4 * i));
        const h = ow.col.rayRecord(rec, f, d, mem.r32(q + 0x10), mem.f32(q + 0x14), mem.f32(q + 0x18));
        push(['ray', rec?.name, h ? 1 : 0]);
        if (!h) { c.eax = 0; return; }
        const on = mem.u32(q + 8), op = mem.u32(q + 12);
        for (let i = 0; i < 3; i++) { mem.wf32(on + 4 * i, h.normal[i]); mem.wf32(op + 4 * i, h.point[i]); }
        c.eax = 1;
      });
      hook(0x43cd62, (c) => { syncOut(); const p = c.arg(0); c.fpush(ow.col.terrainHeight(mem.f32(p), mem.f32(p + 4), mem.f32(p + 8), c.argf(1))); });
      // sounds: slots are handles whose id is the sound id
      let nextH = 0x1000;
      hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
      hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
      hook(0x4435a0, (c) => { push(['2d', H.handles.get(c.arg(0))]); });
      hook(0x4435b0, (c) => { push(['stop2d', H.handles.get(c.arg(0))]); });
      hook(0x4433f0, (c) => { const p = c.arg(1); push(['3d', H.handles.get(c.arg(0)), mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)]); });
      hook(0x4434b0, (c) => { push(['stop3d', H.handles.get(c.arg(0))]); });
      hook(0x439bf8, (c) => { const tok = 0x7000 + H.tokens.size; H.tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
      hook(0x435a11, (c) => { const a = H.tokens.get(c.arg(0)), b = c.arg(1) === 0xffffffff ? null : H.tokens.get(c.arg(1)); push(['say', a, b]); });
      hook(0x435b07, () => {});
      // particles, fog, rumble, textures, ...: nothing to do
      for (const a of [0x442a00, 0x442a20, 0x442a40, 0x442a50, 0x438518, 0x4096b3, 0x442d90, 0x44ec30, 0x44450c, 0x442e80, 0x4359d5, 0x41f17c, 0x4359d0]) hook(a, () => {});
      for (const a of [0x442960, 0x4429a0, 0x442e40]) hook(a, (c) => { c.eax = 0x5000 + (nextH++); });
      hook(0x40cd1a, (c) => { mem.wf32(0x89df2c, c.argf(0)); });
      hook(0x41272b, (c) => { c.eax = 0; }); hook(0x443070, (c) => { c.eax = 0; });
      cpu.exec = [[0x5f2000, 0x5f9200], [0x618360, 0x61a821], [0x858d30, 0x873e00], [0x43a4a1, 0x43af80], [0x43cec0, 0x43cf30], [0x433450, 0x4334f0], [0x40ccd8, 0x40ccf0]];
      cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z10RGB emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt.toString(16)} (frames ${cpu.frames.slice(-4).map((f) => f.toString(16))})`); };
      cpu.invalidate();
      H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; };
      return H;
    };

    // ============================================================ the game, both sides
    const GL = {
      phase: 0x5d5b338, result: 0x5d5b29c, tickF: 0x5d5b348, ticks: 0x5d5b340, base: 0x5d5b344, shotSpeed: 0x90bc40, g: 0x90bc48, vuln: 0x90bc4c, blink: 0x90bdf8,
      pcannon: 0x5d5b334, selected: 0x5d5b2b8, cedAt: 0x5d5b330, cedFire: 0x5d5b33c, modeNow: 0x90bb70, modePrev: 0x90bb74, said2: 0x5d5b418, saidB: 0x5d5b41c, saidHit: 0x5d5bb00,
      scale: 0x90bb84, fov: 0x89df2c, gauge: 0x5d4e0b8, icon: 0x5d4e0c0, gmin: 0x5d4e134, gmax: 0x5d4e130, gval: 0x5d4e138,
    };
    const POOL = 0x5d5b428;
    const open = (seed, opts = {}) => {
      const S = { seed };
      Object.assign(S, build(seed, opts.dt ?? 1));
      const H = (S.H = emulate(S));
      const { cpu, mem } = H;
      H.cov = opts.cov ?? null;
      mem.wf32(0x8b1718, S.dt); mem.wf32(0x8b171c, 1 / S.dt);
      const rec = (i) => H.recPtr(S.ow.records[i]);
      cpu.call(0x5f6340, [], { trace: H.cov ?? undefined });
      const ctor = (addr, args, size) => { H.allocs.length = 0; cpu.call(addr, args, { maxSteps: 3_000_000, trace: H.cov ?? undefined }); return H.allocs.find((a) => a.size === size)?.ptr ?? 0; };
      // the port's initial camera (initRgb) is the original's too: the zone's set-up put it there
      for (let i = 0; i < 18; i++) mem.wf32(0x9da5e8 + 4 * i, S.w.camera.c[i]);
      mem.wf32(GL.fov, 1);
      H.nodes.game = ctor(0x5f77ad, [rec(REC.LAND), 0, 0, 2, 1, 1], 0x18);
      H.nodes.pep = ctor(0x5f4f14, [rec(REC.PEPP), 0, 0], 0x188);
      H.nodes.hit = ctor(0x61884d, [rec(REC.PEPP), 0, 0, 0xfb, 2, 2], 0x74);
      H.nodes.ced = ctor(0x619863, [rec(REC.CEDR), 0, 0, 0xfc, 1, 1], 0x124);
      H.nodes.cannon = [];
      for (let k = 0; k < 9; k++) {
        const blk = H.brk; H.brk += 32;
        mem.w32(blk, Math.trunc(fr(fr(H.lcg.next() / 32767) * 90))); mem.w32(blk + 4, 0); mem.w32(blk + 8, 0); mem.wf32(blk + 12, 2.0); mem.w32(blk + 16, 0);
        H.nodes.cannon.push(ctor(0x61a57f, [rec(REC.CC[k]), blk, 0, 0xfa, 1, 1], 0x78));
      }
      cpu.call(0x5f8050, [], { maxSteps: 3_000_000, trace: H.cov ?? undefined });
      // the game variables the set-up leaves: 0xfa, 0xfb, 0xfc = 1 (the zone's set-up code), 0xfe = 0
      S.ow.vars.set(0xfb, 1); S.ow.vars.set(0xfc, 1); S.ow.vars.set(0xfa, 1);
      mem.w32(GL.phase, 1);              // the button of the intro
      S.st.phase = PHASE.BRIDGE;
      H.syncOut();
      return S;
    };

    const ptrIdx = (H, p) => (p === 0 ? -1 : (p - RB) / 0x68);
    const readEmuState = (S) => {
      const { H, ow } = S, { mem } = H;
      const g = (a) => mem.r32(a), gf = (a) => mem.f32(a);
      const globals = {
        phase: g(GL.phase), result: g(GL.result), tickF: gf(GL.tickF), ticks: g(GL.ticks), base: gf(GL.base), shotSpeed: gf(GL.shotSpeed), left: (mem.r8(0x90bc44) << 24) >> 24, lives: (mem.r8(0x90bc45) << 24) >> 24,
        g: gf(GL.g), vuln: g(GL.vuln), score: (mem.r16(0x90bc50) << 16) >> 16, blink: gf(GL.blink), pcannon: ptrIdx(H, g(GL.pcannon)), cedAt: ptrIdx(H, g(GL.cedAt)), cedFire: g(GL.cedFire),
        target: [0, 1, 2].map((i) => gf(0x5d5b300 + 4 * i)), ppos: [0, 1, 2].map((i) => gf(0x5d5b310 + 4 * i)), modeNow: g(GL.modeNow), modePrev: g(GL.modePrev),
        said2: g(GL.said2), saidB: g(GL.saidB), saidHit: g(GL.saidHit), scale: gf(GL.scale), fov: gf(GL.fov), gauge: g(GL.gauge), icon: g(GL.gauge) ? g(GL.icon) : 0, gmin: g(GL.gauge) ? gf(GL.gmin) : 0, gmax: g(GL.gauge) ? gf(GL.gmax) : 0, gval: g(GL.gauge) ? gf(GL.gval) : 0,
      };
      const balls = Array.from({ length: 10 }, (_, i) => {
        const b = POOL + i * 0xa8;
        return { rec: ptrIdx(H, g(b)), state: g(b + 4), dir: [0, 1, 2].map((k) => gf(b + 8 + 4 * k)), vel: [0, 1, 2].map((k) => gf(b + 0x20 + 4 * k)), cos: gf(b + 0x38), sin: gf(b + 0x3c), t: gf(b + 0x40), hit: ptrIdx(H, g(b + 0x44)), count: mem.r8(b + 0x48), shadow: mem.r8(b + 0x68), samples: Array.from({ length: 15 }, (_, k) => gf(b + 0x6c + 4 * k)) };
      });
      const n = H.nodes;
      const pb = n.pep;
      const pep = {
        cannons: [0, 1, 2, 3].map((i) => { const b = pb + 0x70 + 0x3c * i; return { rec: ptrIdx(H, g(b)), pos: [0, 1, 2].map((k) => gf(b + 0x1c + 4 * k)), euler: [0, 1, 2].map((k) => gf(b + 0x28 + 4 * k)), timer: gf(b + 0x34), fresh: g(b + 0x38) }; }),
        curBall: g(pb + 0x160) === 0 ? -1 : (g(pb + 0x160) - POOL) / 0xa8, bell: mem.r8(pb + 0x184), savedFov: gf(pb + 0x6c), cam: Array.from({ length: 6 }, (_, i) => gf(pb + 0x24 + 4 * i)),   // eye and target (the derived rows 6..17 of the camera are the engine's, not the zone's)
      };
      const hit = { state: mem.r16(n.hit + 0x18), ts: g(n.hit + 0x1c), v: [0, 1, 2].map((k) => gf(n.hit + 0x20 + 4 * k)) };
      const cb = n.ced;
      const ced = {
        state: mem.r16(cb + 0xf0), timer: gf(cb + 0xf4), duration: gf(cb + 0xf8), cur: mem.r16(cb + 0xfc), next: mem.r16(cb + 0xfe), started: mem.r16(cb + 0x100), scale: gf(cb + 0x104), rate: gf(cb + 0x108),
        v: [0x110, 0x114, 0x118].map((o) => gf(cb + o)), scatter: gf(cb + 0x11c), taunts: mem.r8(cb + 0x120),
        perch: Array.from({ length: 9 }, (_, k) => [0, 1, 2].map((i) => gf(cb + 0x1c + 0x18 * k + 4 * i))),
      };
      const cannons = n.cannon.map((p) => ({ ticks: g(p + 0x18), delay: g(p + 0x1c), state: mem.r8(p + 0x20), recoil: [0, 1, 2].map((k) => gf(p + 0x34 + 4 * k)), restY: gf(p + 0x4c), ball: g(p + 0x54) === 0 ? -1 : (g(p + 0x54) - POOL) / 0xa8, muzzle: [0, 1, 2].map((k) => gf(p + 0x58 + 4 * k)), aim: [0, 1, 2].map((k) => gf(p + 0x64 + 4 * k)) }));
      const game = { written: mem.r8(n.game + 0x15) };
      const recs = ow.records.map((r) => { const p = H.recPtr(r); return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) }; });
      return { globals, balls, pep, hit, ced, cannons, game, recs, vars: Array.from(ow.vars.a), cam: Array.from({ length: 6 }, (_, i) => gf(0x9da5e8 + 4 * i)) };
    };
    const readPortState = (S) => {
      const { st, w } = S;
      const idx = (r) => (r ? r.index : -1);
      const globals = {
        phase: st.phase, result: st.resultMode, tickF: st.tickF, ticks: st.ticks, base: st.baseTick, shotSpeed: st.shotSpeed, left: st.cannonsLeft, lives: st.lives, g: st.g, vuln: st.vulnerable ? 1 : 0, score: st.score << 16 >> 16,
        blink: st.blink, pcannon: st.pepperCannon >= 0 ? idx(st.cannons[st.pepperCannon].rec) : -1, cedAt: idx(st.enemy[st.cedricAt]), cedFire: st.cedricFire ? 1 : 0, target: [...st.target], ppos: [...st.pepperPos],
        modeNow: st.modeNow, modePrev: st.modePrev, said2: st.saidPhase2 ? 1 : 0, saidB: st.saidBanner ? 1 : 0, saidHit: st.saidFirstHit ? 1 : 0, scale: shotScale.value, fov: st.fov, gauge: st.hud.gauge ? 1 : 0,
        icon: st.hud.gauge ? st.hud.icon : 0, gmin: st.hud.gauge ? st.hud.min : 0, gmax: st.hud.gauge ? st.hud.max : 0, gval: st.hud.gauge ? st.hud.value : 0,
      };
      const balls = st.balls.map((b) => ({ rec: b.rec.index, state: b.state, dir: [...b.dir], vel: [...b.vel], cos: b.cos, sin: b.sin, t: b.t, hit: idx(b.hit), count: b.count, shadow: b.shadow, samples: Array.from(b.samples) }));
      const sw = w.records[REC.PEPP].ctrl.find('PepSwitc');
      const pep = {
        cannons: st.cannons.map((c) => ({ rec: c.rec.index, pos: [...c.pos], euler: [...c.euler], timer: c.timer, fresh: c.fresh })), curBall: st.curBall, bell: st.bell ? 1 : 0, savedFov: st.savedFov, cam: Array.from(st.camBackup).slice(0, 6),
      };
      const hn = w.records[REC.PEPP].ctrl.find('PeppHit');
      const hit = { state: hn.state, ts: hn.ts, v: [hn.vx, hn.vy, hn.vz] };
      const cn = st.cedric.ctrl.find('cedric');
      const ced = { state: cn.state, timer: cn.timer, duration: cn.duration, cur: cn.cur, next: cn.next, started: cn.started ? 1 : 0, scale: cn.scale, rate: cn.rate, v: [cn.vx, cn.vy, cn.vz], scatter: cn.scatter, taunts: cn.taunts, perch: st.perches.map((p) => [...p.pos]) };
      const cannons = REC.CC.map((r) => { const n = w.records[r].ctrl.find('cannon'); return { ticks: n.ticks, delay: n.delay, state: n.state, recoil: [...n.recoil], restY: n.restY, ball: n.ball, muzzle: [...n.muzzle], aim: [...n.aimVec] }; });
      const game = { written: w.records[REC.LAND].ctrl.find('rgbgame') ? (st.resultWritten ? 1 : 0) : 0 };
      const recs = w.records.map((r) => ({ m: Array.from(r.m), e: [r.rx, r.ry, r.rz], flags: r.flags & 0xffff }));
      void sw;
      return { globals, balls, pep, hit, ced, cannons, game, recs, vars: Array.from(w.vars.a), cam: Array.from(w.camera.c).slice(0, 6) };
    };
    /** compare two states (port a, original b); `label` names the tick */
    const compare = (a, b, label, S) => {
      const tol = S.tol ?? 0;
      const cmpv = (x, y, path) => {
        if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) cmpv(x[i], y[i], `${path}[${i}]`); return; }
        if (x !== null && typeof x === 'object') { for (const k of Object.keys(x)) cmpv(x[k], y[k], `${path}.${k}`); return; }
        T.checked++;
        if (typeof x === 'number' && typeof y === 'number') { const tl = path.includes('.samples') ? (S.tolSamples ?? tol) : tol; if (!(Math.abs(x - y) <= tl * Math.max(1, Math.abs(y))) && !(Number.isNaN(x) && Number.isNaN(y))) bad(`${label}: ${path}: port ${x}, original ${y}`); }
        else if (x !== y) bad(`${label}: ${path}: port ${x}, original ${y}`);
      };
      const skipRec = new Set();
      for (const [name, va] of Object.entries(a)) {
        if (name === 'recs') {
          va.forEach((r, i) => {
            const ra = r, rb = b.recs[i];
            T.checked++;
            let same = ra.flags === rb.flags;
            for (let k = 0; k < 16 && same; k++) if (!(Math.abs(ra.m[k] - rb.m[k]) <= tol * Math.max(1, Math.abs(rb.m[k])))) same = false;
            if (!same) {
              const k = ra.flags !== rb.flags ? -1 : ra.m.findIndex((v, q) => !(Math.abs(v - rb.m[q]) <= tol * Math.max(1, Math.abs(rb.m[q]))));
              bad(`${label}: record ${i} ${S.w.records[i].name}: ${k < 0 ? `flags port ${ra.flags} original ${rb.flags}` : `m[${k}] port ${ra.m[k]} original ${rb.m[k]}`}`);
            }
            for (let k = 0; k < 3; k++) { T.checked++; if (!(Math.abs(ra.e[k] - rb.e[k]) <= tol * Math.max(1, Math.abs(rb.e[k])))) bad(`${label}: record ${i} ${S.w.records[i].name}: euler[${k}] port ${ra.e[k]}, original ${rb.e[k]}`); }
          });
        } else cmpv(va, b[name], name);
      }
      void skipRec;
    };
    const mapLog = (log) => log.filter((e) => ['2d', 'stop2d', '3d', 'stop3d', 'say'].includes(e[0])).map((e) => (e[0] === '3d' ? ['3d', e[1], fr(e[2]), fr(e[3]), fr(e[4])] : e));
    const sameLog = (a, b, label) => {
      T.checked++;
      const fa = JSON.stringify(a.map((e) => e.map((v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v)))), fb = JSON.stringify(b.map((e) => e.map((v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v))));
      const wild = (x, y) => x.length === y.length && x.every((e, i) => e.length === y[i].length && e.every((v, k) => y[i][k] === null || v === y[i][k] || (typeof v === 'number' && typeof y[i][k] === 'number' && Math.abs(v - y[i][k]) <= 0.011)));
      if (fa !== fb && !wild(JSON.parse(fa), JSON.parse(fb))) bad(`${label}: sounds / speech: port ${fa} original ${fb}`);
    };

    /** one tick of both sides; `script(S)` runs before (the player's input and the scripted walk, applied to both) */
    const tick = (S, label) => {
      const { st, w, H, ow } = S, { mem, cpu } = H;
      // the port's input (the original reads the same bits)
      w.input.update();
      const held = w.input.held, pressed = w.input.pressed;
      mem.w32(0x98383c, held); mem.w32(0x983840, pressed); mem.w32(0x983848, 0); mem.w32(0x98384c, 0); mem.w32(0x983850, 0);
      // ---- the original: pool, then the nodes in record order
      for (let i = 6; i < 18; i++) mem.wf32(0x9da5e8 + 4 * i, w.camera.c[i]);       // the derived rows of the camera (up vector, view basis) are the engine's, not under test: both sides see the same
      H.log.length = 0; H.rands.length = 0;
      { const sp = H.recPtr(ow.records[2]); ow.records[2].flags |= 0x10; mem.w16(sp + 0x60, mem.r16(sp + 0x60) | 0x10); }   // SeaAmin (src/island/ambient/misc.ts, not run here) makes the shore foam non-solid
      const at = (r) => H.recPtr(w.records[r]);
      const run = (addr, args) => { cpu.steps = 0; try { cpu.call(addr, args, { maxSteps: 4_000_000, trace: H.cov ?? undefined }); } catch (e) { e.message += ` [${label}: running 0x${addr.toString(16)}; last ${(e.trace ?? []).slice(-12).map((x) => x.toString(16)).join(' ')}]`; throw e; } };
      H.syncOut();
      run(0x5f8f91, []);
      const gate = (v, m, x) => (ow.vars.get(v) & m) === x;
      run(0x5f72c0, [at(REC.LAND), H.nodes.game]);
      if (gate(0xfc, 1, 1)) run(0x618ba6, [at(REC.CEDR), H.nodes.ced]);
      for (let k = 0; k < 9; k++) if (gate(0xfa, 1, 1)) run(0x61a06a, [at(REC.CC[k]), H.nodes.cannon[k]]);
      run(0x5f49c5, [at(REC.PEPP), H.nodes.pep]);
      if (gate(0xfb, 2, 2)) run(0x6186f2, [at(REC.PEPP), H.nodes.hit]);
      H.syncOut();
      // ---- the port: the same tick; its random numbers replay the original's
      S.replay.q = H.rands.map((r) => ({ x: r.x, r: r.r, f: r.f }));
      S.replay.calls = 0;
      S.snd.length = 0; S.said.length = 0;
      updateBalls(st);
      w.tick();
      eqv(S.replay.calls, H.rands.length, `${label}: the number of random numbers drawn`);
      const portLog = S.snd.concat(S.said);
      // the original's log has the sounds and the speech in call order; the port's two lists are merged by comparing each sub-sequence
      const origSnd = mapLog(H.log).filter((e) => e[0] !== 'say'), origSay = mapLog(H.log).filter((e) => e[0] === 'say');
      sameLog(S.snd, origSnd, `${label} sounds`);
      sameLog(S.said, origSay, `${label} speech`);
      void portLog;
      // the original's animation state is the original world's own anims
      S.ow.records.forEach((r, i) => {
        const pa = w.records[i].anim, oa = r.anim;
        if (!pa || !oa) return;
        T.checked++;
        if (pa.clip !== oa.clip || pa.frame !== oa.frame) bad(`${label}: animation of record ${i} ${r.name}: port clip ${pa.clip} frame ${pa.frame}, original clip ${oa.clip} frame ${oa.frame}`);
      });
      const a = readPortState(S), b = readEmuState(S);
      // KNOWN DEVIATION (docs/re/m6/z10RGB.md section 7): at the phases 4 / 5 the original writes COMPLETE_SUB_GAME (0x53) = 1, the port does not (its runner checks the story machine while playing)
      if (b.vars[0x53] !== a.vars[0x53]) { (S.known ??= { complete53: 0 }).complete53++; S.known.complete53At ??= `${label}: port ${a.vars[0x53]}, original ${b.vars[0x53]}`; a.vars[0x53] = b.vars[0x53]; }
      compare(a, b, label, S);
      return { a, b };
    };
    /** a scripted Pepper step (both sides): the walk node is off, so the script moves Pepper and the camera */
    const walkTo = (S, tx, tz, speed = 1.0) => {
      const { w, H } = S, { mem } = H;
      const p = w.records[REC.PEPP];
      let dx = tx - p.x, dz = tz - p.z; const d = Math.hypot(dx, dz) || 1;
      if (d < speed) { dx = tx - p.x; dz = tz - p.z; } else { dx = dx / d * speed; dz = dz / d * speed; }
      const x = p.x + dx, z = p.z + dz;
      const g = w.col.terrainHeight(x, p.y, z, 4);
      S.ow.col.terrainHeight(x, p.y, z, 4);      // the same query on the original side's world: the collision's hit cache (the original's, FUN_00441b10) must see the same calls
      const y = g > -1e30 ? g : p.y;
      p.m[12] = x; p.m[13] = y; p.m[14] = z; p.ry = Math.atan2(dx, dz);
      const pp = H.recPtr(p);
      mem.wf32(pp + 0x50, p.ry);
      mem.wf32(pp + 0x3c, x); mem.wf32(pp + 0x40, y); mem.wf32(pp + 0x44, z);
      const c = w.camera.c;
      c[0] += dx; c[3] += dx; c[2] += dz; c[5] += dz;
      for (const i of [0, 2, 3, 5]) mem.wf32(0x9da5e8 + 4 * i, c[i]);
    };
    const teleport = (S, x, y, z) => {
      const { w, H } = S, { mem } = H;
      const p = w.records[REC.PEPP];
      p.m[12] = x; p.m[13] = y; p.m[14] = z;
      const pp = H.recPtr(p);
      mem.wf32(pp + 0x3c, x); mem.wf32(pp + 0x40, y); mem.wf32(pp + 0x44, z);
    };
    const setKeys = (S, codes) => { for (const c of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ControlLeft', 'Space']) S.w.input.setKey(c, codes.includes(c)); };

    // ============================================================ state injection: the same change on both sides (the port's state and the emulated memory)
    const F32b = new Float32Array(1), U32b = new Uint32Array(F32b.buffer);
    const bitsOf = (v) => { F32[0] = v; return U32[0]; };
    const inj = {
      lives(S, n) { S.st.lives = n; S.H.mem.w8(0x90bc45, n & 0xff); },
      left(S, n) { S.st.cannonsLeft = n; S.H.mem.w8(0x90bc44, n & 0xff); },
      score(S, n) { S.st.score = n; S.H.mem.w16(0x90bc50, n & 0xffff); },
      phase(S, n) { S.st.phase = n; S.H.mem.w32(GL.phase, n); },
      vuln(S, v) { S.st.vulnerable = !!v; S.H.mem.w32(GL.vuln, v ? 1 : 0); },
      setVar(S, id, v) { S.w.vars.set(id, v); S.ow.vars.set(id, v); },
      /** record flags (bit 1 = shown) on both sides */
      flags(S, ri, set, clear = 0) {
        const r = S.w.records[ri], p = S.H.recPtr(S.ow.records[ri]);
        r.flags = (r.flags | set) & ~clear;
        S.H.mem.w16(p + 0x60, (S.H.mem.r16(p + 0x60) | set) & ~clear & 0xffff);
        S.ow.records[ri].flags = (S.ow.records[ri].flags | set) & ~clear;
      },
      /** a record's position (the matrix translation, +0x3c .. +0x44) */
      pos(S, ri, x, y, z) {
        const r = S.w.records[ri], p = S.H.recPtr(S.ow.records[ri]);
        r.m[12] = x; r.m[13] = y; r.m[14] = z;
        S.H.mem.wf32(p + 0x3c, x); S.H.mem.wf32(p + 0x40, y); S.H.mem.wf32(p + 0x44, z);
        S.ow.records[ri].m[12] = x; S.ow.records[ri].m[13] = y; S.ow.records[ri].m[14] = z;
      },
      /** the ball the player fired last (PepSwitc +0x160) */
      curBall(S, idx) { S.st.curBall = idx; S.H.mem.w32(S.H.nodes.pep + 0x160, idx < 0 ? 0 : POOL + idx * 0xa8); },
      /** ball `idx` is marked as having hit the record `ri` (state 3, the record in +0x44): what the player's kill code looks at (the sweeps that set it are compared elsewhere) */
      hitMark(S, idx, ri) {
        const b = S.st.balls[idx], bp = POOL + idx * 0xa8;
        b.hit = S.w.records[ri]; b.state = 3; b.count = 0;
        S.H.mem.w32(bp + 0x44, S.H.recPtr(S.ow.records[ri])); S.H.mem.w32(bp + 4, 3); S.H.mem.w8(bp + 0x48, 0);
      },
      /** the enemy cannon k is made to wait for its ball `idx` (state 4: it reports what the ball hit) */
      enemyWaits(S, k, idx) {
        const n = S.w.records[REC.CC[k]].ctrl.find('cannon');
        n.state = 4; n.ball = idx;
        const p = S.H.nodes.cannon[k];
        S.H.mem.w8(p + 0x20, 4); S.H.mem.w32(p + 0x54, POOL + idx * 0xa8);
      },
      /** the enemy cannon k is destroyed (hidden, one cannon less) like the player's shot does it */
      kill(S, k) { inj.flags(S, REC.CC[k], 0, 2); inj.left(S, S.st.cannonsLeft - 1); },
      /**
       * ball `idx` is launched (state 2) from `pos` with the launch vector `dir` and pitch `pitch`: the port through its own launch, the original through FUN_005f895d
       * (the record is shown and parked at `pos`, the struct holds the vector, state 1 as FUN_005f8197 leaves it)
       */
      ball(S, idx, pos, dir, pitch) {
        const b = S.st.balls[idx], { mem, cpu } = S.H, bp = POOL + idx * 0xa8;
        b.state = 1; b.rec.flags |= 2;
        placeBall(b, pos, dir);
        launchBall(b, pitch);
        const ri = b.rec.index;
        inj.pos(S, ri, pos[0], pos[1], pos[2]);
        inj.flags(S, ri, 2);
        mem.w32(bp + 4, 1);
        for (let k = 0; k < 3; k++) mem.wf32(bp + 8 + 4 * k, dir[k]);
        cpu.call(0x5f895d, [bp, S.H.recPtr(S.ow.records[ri]), bitsOf(pitch), bitsOf(S.st.shotSpeed)]);
      },
    };
    return { pe, arch, build, emulate, open, readEmuState, readPortState, compare, tick, walkTo, teleport, setKeys, GL, POOL, ptrIdx, inj };
  }
}

/** the original functions of the zone's nodes that the oracle runs natively (entry, name): the coverage is counted per conditional branch outcome of these */
export const NODE_FUNCS = [
  [0x5f4f14, 'PepSwitc ctor'], [0x5f49c5, 'PepSwitc update'], [0x5f6017, 'nearest cannon'], [0x5f554b, 'leave cannon'], [0x5f542f, 'cannon lost'], [0x5f56d9, 'aim'], [0x5f6120, 'fire'],
  [0x5f77ad, 'rgbgame ctor'], [0x5f72c0, 'rgbgame update'], [0x5f7d8a, 'flags wave'], [0x5f7cec, 'result'],
  [0x5f8197, 'ball alloc'], [0x5f825a, 'ball free'], [0x5f895d, 'ball launch'], [0x5f8a7b, 'ball step'], [0x5f8291, 'ball collide'], [0x5f8f91, 'ball pool'], [0x5f8050, 'pool set-up'], [0x5f87e1, 'aim solver'], [0x5f89c9, 'quadratic'],
  [0x61884d, 'PeppHit ctor'], [0x6186f2, 'PeppHit update'], [0x618360, 'PeppHit fly'], [0x618612, 'PeppHit 618612'], [0x618631, 'PeppHit 618631'], [0x6186af, 'PeppHit 6186af'],
  [0x619863, 'cedric ctor'], [0x618ba6, 'cedric update'], [0x61a57f, 'cannon ctor'], [0x61a06a, 'cannon update'], [0x619ec9, 'cannon wants to fire'], [0x619c97, 'aim now'], [0x619dbf, 'aim side'], [0x619c20, 'muzzle'], [0x619bb0, 'ball hit'],
  [0x5f6340, 'reset'],
];

/**
 * decode the conditional branches of the original functions `entries` ([[entry, name]]) and count which outcome (taken / fallthrough) a run took: `trace` goes into
 * `cpu.call(..., { trace })` (as tools/lib/m7-isl-npc-emu.mjs createCoverage and m7-walk-emu.mjs do); `report()` lists the outcomes that were never taken
 */
export function createCoverage(pe, entries = NODE_FUNCS) {
  const { mem } = createCpu(pe);
  const lo0 = Math.min(...entries.map((r) => r[0])), hi0 = Math.max(...entries.map((r) => r[0])) + 0x2000;
  const isBr = new Uint8Array(hi0 - lo0), tgt = new Int32Array(hi0 - lo0), hit = new Uint8Array((hi0 - lo0) * 2);
  const funcs = [];
  for (const [lo, name] of entries) {
    const buf = new Uint8Array(0x2000 + 16); for (let i = 0; i < buf.length; i++) buf[i] = mem.r8(lo + i);
    const f = { name, lo, branches: [] };
    for (let o = 0; o < 0x2000;) {
      const d = decode(buf, o, lo + o); if (!d) break;
      const a = d.addr - lo0;
      if ((d.op >= 0x70 && d.op <= 0x7f) || (d.op >= 0x0f80 && d.op <= 0x0f8f)) { isBr[a] = 1; tgt[a] = d.rel; f.branches.push(d.addr); }
      o += d.len;
      if (d.op === 0xc3 || d.op === 0xc2) {            // the function ends at a ret followed (after the padding) by the next prologue
        let q = o; while (buf[q] === 0xcc || buf[q] === 0x90) q++;
        if (buf[q] === 0x55 && buf[q + 1] === 0x8b && buf[q + 2] === 0xec) break;
      }
    }
    funcs.push(f);
  }
  let pend = -1;
  const trace = (cpu, at) => {
    const a = at - lo0;
    if (pend >= 0) { hit[pend * 2 + (at === tgt[pend] ? 1 : 0)] = 1; pend = -1; }
    if (a >= 0 && a < isBr.length && isBr[a]) pend = a;
  };
  const report = () => {
    let total = 0, covered = 0; const per = [], missing = [];
    for (const f of funcs) {
      let t = 0, c = 0;
      for (const b of f.branches) { const a = b - lo0; for (const k of [0, 1]) { t++; if (hit[a * 2 + k]) c++; else missing.push({ fn: f.name, at: b, out: k ? 'taken' : 'fallthrough' }); } }
      per.push({ name: f.name, outcomes: t, covered: c }); total += t; covered += c;
    }
    return { total, covered, per, missing };
  };
  return { trace, report };
}
