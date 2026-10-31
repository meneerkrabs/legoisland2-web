// z41MAP (pizza making): the ORIGINAL update functions of the zone run in the x86 emulation next to the port (tools/tests/m7-z41MAP-emu.mjs,
// docs/re/m3/z41MAP.md section "Differential test (WP-VERIFY)").
// One update pass of the engine (FUN_0042226e: the controllers of the records in record order) is run with the original functions
//   FUN_00816562 Pepper, FUN_00812399 Papa, FUN_00815f30 mama, FUN_00815576 toppings, FUN_008140cc citizens, FUN_00814f6e slug
// followed by the draw hooks that change record matrices (FUN_00812ea5 Papa, FUN_0081603e mama, FUN_00814964 planet + galaxy) on a mirror of the port's records / nodes in
// emulated memory (state resynchronised from the port before every tick, so the comparison is exactly one step at a time), then the port ticks from the same state.
// Host stand-ins (engine services, implemented from the decompile): animation instances (FUN_0043b6a3 / 76a / 874 / 72b / 73f on a shadow state in emulated memory with the
// rigs' clip table read from the port's rigs), pose buffers (FUN_0043ba7a / bc22 / bc58: the per-instance buffer of FUN_0043b4e2(rig, 1); the skeleton chain itself is the port's
// `sampleBlk`, which is not the subject; the draw pass of the previous tick fills the buffers like FUN_004440f0), game variables, sound / speech / particle calls (logged),
// FUN_004388ae (the port's own seeded source, state copied), FUN_00435c91 (GetTickCount: the value the original multiplies the random number with is the modulus of the
// following `& 1` / `& 3` / `% 3` / `% 5`, so the same random value gives the same decision as the port's `rand(n)`).
// The matrix helpers (FUN_0043a4a1 / 5e4 / 9e5 / ab72 / ac78 / ad29 / af16 / cec0), the CRT (sin, sqrt, floor, __ftol) and the zone's own functions run natively.
import { createCpu } from '../../src/formats/x86emu.ts';
import { sampleBlk } from '../../src/formats/anim.ts';
import { loadExe } from './engine-load.mjs';

export const RB = 0x30000000, NB = 0x31000000, CB = 0x32000000, AB = 0x33000000, PB = 0x34000000, MB = 0x35000000;
const NSTRIDE = 0x500, PSTRIDE = 0x1000, MODEL_TOK = 0x70000000;
const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };

const UPDATE = { Pepper: 0x816562, Papa: 0x812399, mama: 0x815f30, Topping: 0x815576, citizen: 0x8140cc, Slug: 0x814f6e };
export const DRAW_OFFSET_ADDR = 0x955e70;   // CIT4's draw offset (FUN_008146ea): three floats

/** a scripted rand() (FUN_0085daf0's LCG, 0 .. 32767) whose state can be copied */
export function makeRng(seed) {
  const g = { s: seed >>> 0, n: 0 };
  g.next = () => { g.s = (Math.imul(g.s, 0x343fd) + 0x269ec3) >>> 0; g.n++; return (g.s >>> 16) & 0x7fff; };
  return g;
}

export function createHarness(ctx, w, S, opts = {}) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  cpu.cw = process.env.M7_CW ? +process.env.M7_CW : 0x7f;      // the original runs the x87 in 24-bit precision (Direct3D leaves single precision)
  const mem = cpu.mem;
  const rs = w.records.slice(0, opts.nBase ?? w.records.length);     // the zone's own records (the zone game adds helper records after them)
  const NREC = rs.length;
  for (const [lo, n] of [[RB, NREC * 0x68], [NB, NREC * NSTRIDE], [CB, NREC * 0x80], [AB, NREC * 0x40], [PB, NREC * PSTRIDE], [MB, 0x10000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
  const H = { cpu, mem, w, S, log: [], handles: new Map(), tokens: new Map(), randCalls: 0, unhooked: new Set(), pe, calls: {} };
  const recPtr = (r) => RB + r.index * 0x68;
  const idxOfPtr = (p) => (p === 0 ? -1 : (p - RB) / 0x68);
  const byName = (n) => rs.find((r) => r.name === n);
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  const push = (e) => H.log.push(e);
  const dt = () => H.dt;
  H.dt = 1;

  // ---- sound handles (FUN_00813500 runs natively: the hooked creators hand out numbers that map to the sound id)
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  hook(0x4435a0, (c) => { push(['2d', H.handles.get(c.arg(0))]); });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['3d', mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)]); });
  hook(0x4434b0, () => { push(['stop3d']); });
  hook(0x439bf8, (c) => { const tok = 0x7000 + H.tokens.size; H.tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { push(['say', H.tokens.get(c.arg(0))]); });
  // particles: FUN_00442a00(emitter, matrix) sets the emitter matrix, FUN_00442a20(emitter, 2, 1, 1) starts it (the other values stop / hide it: not modelled by the port)
  let emitAt = [0, 0, 0];
  hook(0x442a00, (c) => { const p = c.arg(1); emitAt = [mem.f32(p + 0x30), mem.f32(p + 0x34), mem.f32(p + 0x38)]; });
  hook(0x442a20, (c) => { if (c.arg(1) === 2) push(['puff', ...emitAt]); else push(['emit', c.arg(1)]); });
  // the draw calls and the model getters (FUN_0043f160 / 180: model / texture list of a model pointer, here the token itself)
  hook(0x444480, () => {});
  // FUN_0043f1a0(model, matrix, texlist, 0): a hand-made draw of the draw hooks (the dough, its layers, the toppings in the air)
  H.draws = [];
  hook(0x43f1a0, (c) => { const p = c.arg(1); H.draws.push([c.arg(0), Array.from({ length: 16 }, (_, i) => mem.f32(p + 4 * i))]); });
  hook(0x43f160, (c) => { c.eax = c.arg(0); });
  hook(0x43f180, (c) => { c.eax = c.arg(0) + 1; });
  // game variables: a copy of the port's (synced per tick)
  H.vars = new Map();
  const vget = (i) => (H.vars.has(i) ? H.vars.get(i) : w.vars.get(i));
  hook(0x417575, (c) => { c.eax = vget(c.arg(0)); });
  hook(0x417597, (c) => { H.vars.set(c.arg(0), c.arg(1) | 0); push(['var', c.arg(0), c.arg(1) | 0]); });
  // random numbers: FUN_004388ae(x) = (float) rand / 32767.0f * x runs natively; its rand() (FUN_0085daf0) draws from the port's own scripted source (its state is copied in before the pass);
  // FUN_00435c91 (GetTickCount - base) is the scripted `H.msv`, the same value the port's `env.ms()` returns
  H.rng = makeRng(1);
  H.msv = 1000;
  hook(0x85daf0, () => { H.randCalls++; cpu.eax = H.rng.next(); });
  hook(0x435c91, () => { cpu.eax = H.msv; });
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });

  // ---- animation instances: shadow state at AB + index * 0x40 (+0x0c clip, +0x10 frame), clip table from the port's rig
  const animIdx = (ptr) => (ptr - AB) / 0x40;
  const rigOf = (ptr) => rs[animIdx(ptr)].anim.rig;
  const clipOf = (ptr) => rigOf(ptr).clips[mem.r32(ptr + 0xc)] ?? null;
  const frameOf = (ptr) => mem.f32(ptr + 0x10);
  hook(0x43b6a3, (c) => {
    const a = c.arg(0), clip = c.arg(1) | 0, sf = c.argf(2);
    const rig = rigOf(a);
    let r = 0;
    if (-1 < clip && clip < rig.clips.length) {
      mem.w32(a + 0xc, clip);
      const cd = rig.clips[clip];
      if (cd && 0 <= sf && sf <= cd.frameCount) { mem.wf32(a + 0x10, sf); r = 1; }
    }
    c.eax = r;
  });
  hook(0x43b72b, (c) => { c.eax = mem.r32(c.arg(0) + 0xc); });
  hook(0x43b73f, (c) => { c.fpush(frameOf(c.arg(0))); });
  // FUN_0043b76a(anim, rate): advance by rate * DAT_008b1718; 1 = loop wrapped, 2 = one-shot finished
  hook(0x43b76a, (c) => {
    const a = c.arg(0), rate = c.argf(1);
    const cd = clipOf(a);
    let res = 0;
    if (cd) {
      let f = f32(rate * dt() + frameOf(a));
      let n = cd.frameCount;
      if (n < 1) n = 1;
      if ((cd.flags & 0x10) === 0) {
        if (n - 1 < f) {
          if (n <= 1) f = 0; else do f = f32(f - (n - 1)); while (n - 1 < f);
          res = 2;
        }
      } else if (n <= f) { do f = f32(f - n); while (n <= f); res = 1; }
      mem.wf32(a + 0x10, f);
    }
    c.eax = res;
  });
  // FUN_0043b874(anim, rate, flags): advance, no wrap (the slug's clips)
  hook(0x43b874, (c) => {
    const a = c.arg(0), rate = c.argf(1), fl = c.arg(2) >>> 0;
    const cd = clipOf(a);
    let res = 0;
    if (cd) {
      let f = f32(rate * dt() + frameOf(a));
      const n = cd.frameCount;
      if ((fl & 0x10) === 0) { if (n < f) { f = n; res = 2; } }
      else if (n <= f) { do f = f32(f - n); while (n <= f); res = 1; }
      mem.wf32(a + 0x10, f);
    }
    c.eax = res;
  });
  // ---- pose buffers: the per-instance buffer (anim + 0x20 = PB + index * 0x1000) of FUN_0043b4e2(rig, 1)
  // FUN_0043a9e5(dst, b, s) = s * b on affine 3x4 matrices in 24-bit x87: ((s0 b0 + s1 b4) + s2 b8) per element, translation row + b's
  const mulJs = (s, b) => { const o = new Float32Array(16); for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) o[r * 4 + q] = f32(f32(f32(s[r * 4] * b[q]) + f32(s[r * 4 + 1] * b[4 + q])) + f32(s[r * 4 + 2] * b[8 + q])); for (let q = 0; q < 3; q++) o[12 + q] = f32(f32(f32(f32(s[12] * b[q]) + f32(s[13] * b[4 + q])) + f32(s[14] * b[8 + q])) + b[12 + q]); o[15] = 1; return o; };
  const rdMat = (p) => Float32Array.from({ length: 16 }, (_, i) => mem.f32(p + 4 * i));
  // FUN_0043a9e5(dst, a, b) is checked natively against the row-vector product dst = b * a in `selfCheck` below
  H.poseBones = (ai) => {
    const an = rs[ai].anim, rig = an.rig, a = AB + ai * 0x40;
    const cd = rig.clips[mem.r32(a + 0xc)], sk = rig.skeleton;
    if (!cd || !sk || cd.boneCount !== sk.boneCount) return null;
    return sampleBlk(sk, cd, frameOf(a), (cd.flags & 0x10) !== 0, undefined, an.noInterp ? 1e9 : 0.1);
  };
  // FUN_0043ba7a(anim, matrix): evaluate the pose into the instance's buffer, every bone times `matrix` (the chain starts with it: bone0 = a9e5(matrix, local0))
  const writePose = (ai, rootPtr) => {
    const bones = H.poseBones(ai);
    if (!bones) return;
    const root = rootPtr ? rdMat(rootPtr) : null;
    for (let k = 0; k < bones.length / 16; k++) {
      const b = bones.subarray(k * 16, k * 16 + 16);
      const m = root ? mulJs(b, root) : b;
      for (let i = 0; i < 16; i++) mem.wf32(PB + ai * PSTRIDE + k * 0x40 + 4 * i, m[i]);
    }
  };
  hook(0x43ba7a, (c) => { writePose(animIdx(c.arg(0)), c.arg(1)); c.eax = rs[animIdx(c.arg(0))].anim.rig.skeleton?.boneCount ?? 0; });
  hook(0x43bc22, (c) => { c.eax = PB + animIdx(c.arg(0)) * PSTRIDE; });
  hook(0x43bc58, (c) => { c.eax = PB + animIdx(c.arg(0)) * PSTRIDE + c.arg(1) * 0x40; });

  cpu.exec = [[0x811000, 0x820000], [0x4388ae, 0x4388e7], [0x858d30, 0x873e00], [0x43a4a1, 0x43b000], [0x43cec0, 0x43cf30], [0x4239d9, 0x4239ec]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z41MAP emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt.toString(16)}`); };
  cpu.invalidate();
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };

  // the zone's sound set (FUN_00813500, natively: the handles of the globals)
  cpu.call(0x813500, []);

  // FUN_0043a9e5 is the row-vector product dst = b * a (checked once on a random pair)
  {
    const aff = (a) => { a[3] = a[7] = a[11] = 0; a[15] = 1; return a; };
    const A = aff(Float32Array.from({ length: 16 }, (_, i) => Math.sin(i + 1))), B = aff(Float32Array.from({ length: 16 }, (_, i) => Math.cos(i * 2 + 1)));
    for (let i = 0; i < 16; i++) { mem.wf32(MB + 4 * i, A[i]); mem.wf32(MB + 0x40 + 4 * i, B[i]); }
    cpu.call(0x43a9e5, [MB + 0x80, MB, MB + 0x40]);
    const got = rdMat(MB + 0x80), want = mulJs(B, A);
    H.matMulOk = got.every((v, i) => i === 3 || i === 7 || i === 11 || i === 15 || v === want[i]); H.matDbg = [Array.from(got), Array.from(want), Array.from(mulJs(A, B))];
  }

  // ---- mirrors
  const nodeOf = (name) => rs.find((r) => r.ctrl?.nodes.some((n) => n.kind === name));
  const nodes = {
    Pepper: S.pepper, Papa: S.papa, mama: S.mama, Topping: S.toppings, Slug: S.slug,
  };
  const citizens = rs.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'citizen'));
  const entries = [];       // [record, node, kind]
  for (const r of rs) for (const n of r.ctrl?.nodes ?? []) if (UPDATE[n.kind]) entries.push([r, n, n.kind]);
  H.entries = entries;
  const nodePtr = (r) => NB + r.index * NSTRIDE;
  const TOPN = nodePtr(nodeOf('Topping'));
  const slotPtr = (k) => TOPN + 0x1c + 0x70 * k;
  const tokOf = (r) => (r ? MODEL_TOK + r.index * 0x100 : 0);
  const recOfTok = (t) => (t >= MODEL_TOK ? rs[(t - MODEL_TOK) / 0x100] : null);
  const papaRec = nodeOf('Papa'), pepRec = nodeOf('Pepper'), mamaRec = nodeOf('mama'), slugRec = nodeOf('Slug'), planRec = byName('PLAN'), galaRec = byName('GALA');
  const stackNames = ['PIZ6', 'PIZ5', 'PIZ4', 'PIZ3', 'PIZ2'];

  const writeMatrix = (p, m) => { for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, m[i]); };
  H.drawOffset = [0, 1, 2].map((i) => mem.f32(DRAW_OFFSET_ADDR + 4 * i));
  const cit4 = byName('CIT4');

  const mirrorRecords = () => {
    for (const r of rs) {
      const p = recPtr(r);
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, tokOf(r));
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      writeMatrix(p, r.m);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, 0);
      mem.w32(p + 0x5c, r.ctrl ? CB + r.index * 0x80 : 0);
      if (r.ctrl) mem.w32(CB + r.index * 0x80, r.ctrl.nodes.some((n) => UPDATE[n.kind]) ? nodePtr(r) : 0);
      mem.w16(p + 0x60, (r.flags | 1) & 0xffff);     // flag 1 = in the frustum, set by the draw pass of the engine for everything the camera sees
      if (r.anim) {
        const a = AB + r.index * 0x40;
        mem.w32(a + 0xc, r.anim.clip); mem.wf32(a + 0x10, r.anim.frame); mem.w32(a + 0x20, PB + r.index * PSTRIDE);
      }
    }
    // the citizens' logical position is the node's (the port's matrix carries the draw offset of CIT4: FUN_008146ea adds it only while drawing)
    for (const r of citizens) { const n = r.ctrl.nodes.find((x) => x.kind === 'citizen'), p = recPtr(r); mem.wf32(p + 0x3c, n.p[0]); mem.wf32(p + 0x40, n.p[1]); mem.wf32(p + 0x44, n.p[2]); }
    // the slug's matrix is stored scaled by 0.4 in the port (the original scales while drawing): the original's own is the unscaled one
    { const p = recPtr(slugRec); for (let i = 0; i < 12; i++) if (i % 4 !== 3) mem.wf32(p + 0xc + 4 * i, slugRec.m[i] / 0.4); }
  };
  const slotIndexOf = (s) => (s ? S.toppings.slots.indexOf(s) : -1);
  const NODE = {
    Pepper: {
      write(n, p) { mem.w32(p + 0x18, n.state); mem.w32(p + 0x1c, n.slot ? slotPtr(slotIndexOf(n.slot)) : 0); mem.wf32(p + 0x20, n.timer); },
      read(p) { const sp = mem.u32(p + 0x1c); return { state: mem.r32(p + 0x18), slot: sp ? (sp - slotPtr(0)) / 0x70 : -1, timer: mem.f32(p + 0x20) }; },
      ts(n) { return { state: n.state, slot: slotIndexOf(n.slot), timer: n.timer }; },
    },
    Papa: {
      write(n, p) {
        mem.w32(p + 0x18, n.state); mem.w32(p + 0x1c, n.level); mem.w32(p + 0x20, n.showDough);
        mem.wf32(p + 0x24, n.x); mem.wf32(p + 0x28, n.y); mem.wf32(p + 0x2c, n.z); mem.wf32(p + 0x30, n.swing); mem.wf32(p + 0x34, n.angle);
        for (let i = 0; i < 16; i++) mem.wf32(p + 0x38 + 4 * i, n.hand[i]);
        mem.w32(p + 0x78, n.slow); mem.w32(p + 0x84, n.layers); mem.w32(p + 0x88, 0x1234); mem.wf32(p + 0x8c, n.speed); mem.w32(p + 0x90, n.thrown); mem.w32(p + 0x94, n.count);
        for (let i = 0; i < 4; i++) { mem.w32(p + 0x98 + 0xc * i, n.target[i]); mem.w32(p + 0x9c + 0xc * i, n.landed[i]); mem.w32(p + 0xa0 + 0xc * i, n.pending[i]); }
        mem.wf32(p + 0xc8, n.gauge); mem.w32(p + 0xcc, n.score); mem.w32(p + 0xd0, n.medal); mem.w32(p + 0xd4, 0x5d5f448);
      },
      read(p) {
        const arr = (o) => [0, 1, 2, 3].map((i) => mem.r32(p + o + 0xc * i));
        return { state: mem.r32(p + 0x18), level: mem.r32(p + 0x1c), showDough: mem.r32(p + 0x20), x: mem.f32(p + 0x24), y: mem.f32(p + 0x28), z: mem.f32(p + 0x2c), swing: mem.f32(p + 0x30), angle: mem.f32(p + 0x34),
          hand: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0x38 + 4 * i)), slow: mem.r32(p + 0x78), layers: mem.r32(p + 0x84), speed: mem.f32(p + 0x8c), thrown: mem.r32(p + 0x90), count: mem.r32(p + 0x94),
          target: arr(0x98), landed: arr(0x9c), pending: arr(0xa0), gauge: mem.f32(p + 0xc8), score: mem.r32(p + 0xcc), medal: mem.r32(p + 0xd0) };
      },
      ts(n) { return { state: n.state, level: n.level, showDough: n.showDough, x: n.x, y: n.y, z: n.z, swing: n.swing, angle: n.angle, hand: Array.from(n.hand), slow: n.slow, layers: n.layers, speed: n.speed, thrown: n.thrown, count: n.count,
        target: [...n.target], landed: [...n.landed], pending: [...n.pending], gauge: n.gauge, score: n.score, medal: n.medal }; },
    },
    mama: {
      write(n, p) { mem.w32(p + 0x18, n.state); mem.wf32(p + 0x1c, n.pos[0]); mem.wf32(p + 0x20, n.pos[1]); mem.wf32(p + 0x24, n.pos[2]); },
      read(p) { return { state: mem.r32(p + 0x18) }; },
      ts(n) { return { state: n.state }; },
    },
    Topping: {
      write(n, p) {
        mem.w32(p + 0x18, n.bonus);
        n.slots.forEach((s, k) => {
          const q = slotPtr(k);
          mem.w32(q, s.state); mem.w32(q + 4, s.active); mem.w32(q + 8, s.type); mem.w32(q + 0xc, s.dir); mem.wf32(q + 0x10, s.t);
          mem.w32(q + 0x14, tokOf(s.tpl)); mem.w32(q + 0x18, tokOf(s.tpl) + 1);
          for (let i = 0; i < 16; i++) mem.wf32(q + 0x1c + 4 * i, s.m[i]);
          mem.wf32(q + 0x5c, s.start[0]); mem.wf32(q + 0x60, s.start[1]); mem.wf32(q + 0x64, s.start[2]); mem.wf32(q + 0x68, s.rot); mem.w32(q + 0x6c, s.life);
        });
      },
      read(p) {
        return { bonus: mem.r32(p + 0x18), slots: Array.from({ length: 10 }, (_, k) => {
          const q = slotPtr(k);
          return { state: mem.r32(q), active: mem.r32(q + 4), type: mem.r32(q + 8), dir: mem.r32(q + 0xc), t: mem.f32(q + 0x10), tpl: recOfTok(mem.u32(q + 0x14))?.index ?? -1,
            m: Array.from({ length: 16 }, (_, i) => mem.f32(q + 0x1c + 4 * i)), start: [0, 1, 2].map((i) => mem.f32(q + 0x5c + 4 * i)), rot: mem.f32(q + 0x68), life: mem.r32(q + 0x6c) };
        }) };
      },
      ts(n) { return { bonus: n.bonus, slots: n.slots.map((s) => ({ state: s.state, active: s.active, type: s.type, dir: s.dir, t: s.t, tpl: s.tpl ? s.tpl.index : -1, m: Array.from(s.m), start: [...s.start], rot: s.rot, life: s.life })) }; },
    },
    citizen: {
      write(n, p, r) {
        mem.w32(p + 0x18, n.state); mem.w32(p + 0x1c, n.slot); mem.wf32(p + 0x20, n.rate); mem.w32(p + 0x24, 0x955d58); mem.wf32(p + 0x28, n.steps); mem.wf32(p + 0x2c, n.prog);
        for (let i = 0; i < 3; i++) { mem.wf32(p + 0x30 + 4 * i, n.delta[i]); mem.wf32(p + 0x3c + 4 * i, n.from[i]); }
        const t = H.slotPos[n.slot] ?? [0, 0, 0];
        for (let i = 0; i < 3; i++) mem.wf32(p + 0x48 + 4 * i, t[i]);
      },
      read(p) { return { state: mem.r32(p + 0x18), slot: mem.r32(p + 0x1c), steps: mem.f32(p + 0x28), prog: mem.f32(p + 0x2c), delta: [0, 1, 2].map((i) => mem.f32(p + 0x30 + 4 * i)), from: [0, 1, 2].map((i) => mem.f32(p + 0x3c + 4 * i)) }; },
      ts(n) { return { state: n.state, slot: n.slot, steps: n.steps, prog: n.prog, delta: [...n.delta], from: [...n.from] }; },
    },
    Slug: {
      write(n, p) { mem.w32(p + 0x18, n.state); mem.wf32(p + 0x28, n.a1); mem.wf32(p + 0x2c, n.a2); },
      read(p) { return { state: mem.r32(p + 0x18), a1: mem.f32(p + 0x28), a2: mem.f32(p + 0x2c) }; },
      ts(n) { return { state: n.state, a1: n.a1, a2: n.a2 }; },
    },
  };
  H.NODE = NODE;
  H.slotPos = [0, 1, 2, 3, 4].map((i) => [0, 1, 2].map((k) => mem.f32(0x955e00 + 0x14 * i + 4 * k)));

  const G = {
    write() {
      mem.w32(0x5d5f3ec, nodePtr(papaRec)); mem.w32(0x5d5f4ac, TOPN); mem.w32(0x5d5f4b4, nodePtr(mamaRec)); mem.w32(0x5d5f4b8, nodePtr(pepRec)); mem.w32(0x5d5f4a8, nodePtr(slugRec));
      mem.w32(0x5d5f4b0, S.flying); mem.w32(0x5d5f4a0, S.hitCitizens); mem.w32(0x5d5f3e8, S.result); mem.wf32(0x5d5f4a4, S.planetAngle); mem.wf32(0x5d4e138, S.gauge);
      for (let i = 0; i < 4; i++) mem.w32(0x5d4e144 + 8 * i, S.hudIcons[i]);
      stackNames.forEach((n, i) => mem.w32(0x5d5f448 + 4 * i, recPtr(byName(n))));
      S.slots.forEach((q, i) => { mem.w32(0x955df8 + 0x14 * i, q.occ); mem.w32(0x955dfc + 0x14 * i, q.rec ? recPtr(q.rec) : 0); });
      for (let i = 0; i < 6; i++) mem.wf32(0x9da5e8 + 4 * i, w.camera.c[i]);
      mem.wf32(0x89df30, S.near ?? 1);
      mem.wf32(0x8b1718, H.dt); mem.wf32(0x8b171c, 1 / H.dt);
    },
    read() {
      return {
        flying: mem.r32(0x5d5f4b0), hit: mem.r32(0x5d5f4a0), result: mem.r32(0x5d5f3e8), planet: mem.f32(0x5d5f4a4), gauge: mem.f32(0x5d4e138), hud: [0, 1, 2, 3].map((i) => mem.r32(0x5d4e144 + 8 * i)),
        occ: [0, 1, 2, 3, 4].map((i) => mem.r32(0x955df8 + 0x14 * i)), qrec: [0, 1, 2, 3, 4].map((i) => idxOfPtr(mem.u32(0x955dfc + 0x14 * i))),
        camera: Array.from({ length: 6 }, (_, i) => mem.f32(0x9da5e8 + 4 * i)), near: mem.f32(0x89df30),
      };
    },
    ts() {
      return { flying: S.flying, hit: S.hitCitizens, result: S.result, planet: S.planetAngle, gauge: S.gauge, hud: [...S.hudIcons], occ: S.slots.map((q) => q.occ), qrec: S.slots.map((q) => (q.rec ? q.rec.index : -1)),
        camera: Array.from(w.camera.c).slice(0, 6), near: S.near ?? 1 };
    },
  };
  H.G = G;
  const readRec = (r) => { const p = recPtr(r); return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) }; };

  /** the draw pass of the engine for the pose buffers (FUN_00444480 -> FUN_004440f0: FUN_0043ba7a(anim, identity) for every visible animated record with a model) */
  H.drawPass = () => {
    // only Pepper's buffer is read before the next evaluation (Papa's is rewritten by his own update, the other animated records' buffers are never read by the zone code)
    const r = pepRec;
    const fl = mem.r16(recPtr(r) + 0x60);
    // flag bit 1 (in the frustum) is set by the engine's frustum test of the draw pass: Pepper counts as in view
    if ((fl & 0x8000) === 0 && (fl & 2) !== 0) writePose(r.index, 0);
  };


  /**
   * the constructors (FUN_00816ba0 Pepper, 008132e0 Papa, 0081611f mama, 00815e1a toppings, 0081529f slug, 0081483d citizens) run on zeroed node memory (the allocator FUN_00433d38 clears) and
   * clips of 0: what they leave in the node, in the animation instance and in the camera globals is the initial state the port's `init` must reproduce
   */
  H.runCtors = () => {
    mirrorRecords(); G.write();
    for (const r of rs) if (r.anim) { const a = AB + r.index * 0x40; mem.w32(a + 0xc, 0); mem.wf32(a + 0x10, 0.75); }
    for (let i = 0; i < 6; i++) mem.wf32(0x9da5e8 + 4 * i, 1234 + i);
    mem.wf32(0x89df30, 77);
    const out = { nodes: {}, rate: [] };
    const run = (kind, r, ctor, args) => {
      const p = nodePtr(r);
      for (let o = 0; o < NSTRIDE; o += 4) mem.w32(p + o, 0);
      for (let i = 0; i < 6; i++) mem.w32(MB + 0x2000 + 4 * i, 0);
      cpu.steps = 0;
      cpu.call(ctor, [recPtr(r), args, p, 2, 1, 1]);
      return p;
    };
    // Pepper
    out.nodes.Pepper = NODE.Pepper.read(run('Pepper', pepRec, 0x816ba0, 0));
    out.camera = Array.from({ length: 6 }, (_, i) => mem.f32(0x9da5e8 + 4 * i)); out.near = mem.f32(0x89df30);
    // Papa: the argument is a pointer to the address of the pizza stack array
    mem.w32(MB + 0x3000, 0x5d5f448);
    out.nodes.Papa = NODE.Papa.read(run('Papa', papaRec, 0x8132e0, MB + 0x3000));
    out.nodes.mama = NODE.mama.read(run('mama', mamaRec, 0x81611f, 0));
    { const p = nodePtr(mamaRec); out.mamaPos = [0, 1, 2].map((i) => mem.f32(p + 0x1c + 4 * i)); }
    out.nodes.Topping = NODE.Topping.read(run('Topping', nodeOf('Topping'), 0x815e1a, 0));
    out.nodes.Slug = NODE.Slug.read(run('Slug', slugRec, 0x81529f, 0));
    out.citizens = citizens.map((r, i) => {
      const n = r.ctrl.nodes.find((x) => x.kind === 'citizen');
      mem.wf32(MB + 0x4000 + 8 * i, n.rate); mem.w32(MB + 0x4004 + 8 * i, 0x955d58);
      const p = run('citizen', r, 0x81483d, MB + 0x4000 + 8 * i);
      return { rec: r, st: NODE.citizen.read(p), rate: mem.f32(p + 0x20), table: mem.u32(p + 0x24) };
    });
    out.anims = rs.map((r) => (r.anim ? [mem.r32(AB + r.index * 0x40 + 0xc), mem.f32(AB + r.index * 0x40 + 0x10)] : null));
    out.globals = { flying: mem.r32(0x5d5f4b0) };
    return out;
  };

  H.pass = (held, pressed, dtv = 1, stick = 0) => {
    H.dt = dtv;
    H.log.length = 0; H.randCalls = 0; H.draws.length = 0;
    mirrorRecords(); G.write();
    for (const [r, n, kind] of entries) NODE[kind].write(n, nodePtr(r), r);
    // game variables the zone touches
    H.vars.clear(); for (const i of [0x3f, 0xda]) H.vars.set(i, w.vars.get(i));
    mem.w32(0x98383c, held); mem.w32(0x983840, pressed); mem.w32(0x98384c, stick);
    for (const [r, n, kind] of entries) {
      cpu.steps = 0;
      try { cpu.call(UPDATE[kind], [recPtr(r), nodePtr(r)], { maxSteps: 2000000 }); }
      catch (e) { e.message += ` [record ${r.index} ${r.name} ${kind}]`; throw e; }
      H.calls[kind] = (H.calls[kind] ?? 0) + 1;
    }
    // the draw hooks that rewrite matrices (the engine's draw pass runs them in record order)
    cpu.steps = 0;
    cpu.call(0x81603e, [recPtr(mamaRec), nodePtr(mamaRec), 0, 0]);
    cpu.call(0x812ea5, [recPtr(papaRec), nodePtr(papaRec), 0, 0]);
    cpu.call(0x814964, [recPtr(planRec), 0, 0, 0]);
    cpu.call(0x815d2b, [recPtr(nodeOf('Topping')), nodePtr(nodeOf('Topping'))]);
    const out = { anims: rs.map((r) => (r.anim ? [mem.r32(AB + r.index * 0x40 + 0xc), mem.f32(AB + r.index * 0x40 + 0x10)] : null)), recs: rs.map(readRec), nodes: entries.map(([r, n, kind]) => NODE[kind].read(nodePtr(r))), globals: G.read(), log: H.log.slice(), draws: H.draws.map((d) => [d[0], d[1]]), rand: H.randCalls, rngS: H.rng.s,
      vars: { 0x3f: vget(0x3f), 0xda: vget(0xda) } };
    H.drawPass();
    return out;
  };
  H.tsState = () => ({ recs: rs.map((r) => ({ m: Array.from(r.m), e: [r.rx, r.ry, r.rz], flags: r.flags & 0xffff })), nodes: entries.map(([r, n, kind]) => NODE[kind].ts(n)), globals: G.ts() });
  H.cit4 = cit4;
  H.tokOf = tokOf;
  H.slug = slugRec;
  // the pose buffers as the previous draw left them (the first tick of a scenario has none: build them from the starting state)
  H.init = () => { mirrorRecords(); H.drawPass(); };
  return H;
}
