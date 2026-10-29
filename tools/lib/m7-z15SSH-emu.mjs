// z15SSH (WP-VERIFY): the ORIGINAL update function of the buggy node, FUN_00658c16 (and everything it calls in the zone: FUN_00657a30 the snakes, 006582de / 0065866f
// the coconuts, 00657860 the carts, 0065888a the sounds, 00658818 the HUD copy, the path code 00445680 / 004466f0 / 00447280 / 00447550 / 00447800 / 00447bf0, the
// matrix helpers 0043a340 / 0043a5e4 / 0043a9e5 / 0043ab72 / 0043abe6, the camera helper 00422ddc and the C runtime) runs in the x86 emulation on a mirror of the
// records / node / part matrices, next to the port's `CartNode.update` (tools/tests/m7-z15SSH-emu.mjs, docs/re/m6/z15SSH.md "Differential test").
// Hosted engine services (stand-ins, not the subject): the animation instance functions 0043b6a3 / 0043b76a / 0043b73f / 0043b753 / 0043b64d operate on the port's own
// AnimInstance (engine-anim.mjs / anim.mjs test those), the ground ray FUN_0043ce45 -> FUN_004425f0 calls the port's CollisionWorld (engine-collision.mjs tests it), the
// sound calls and the speech calls are logged, FUN_004388ae (rand) / FUN_00435c91 (GetTickCount) draw from a scripted sequence shared with the port, FUN_0043ea60
// (matrix i of a record's model) returns the address of the mirrored part matrix, the particle emitters (FUN_00442a20), the view-matrix builder (0043cc5c) are no-ops.
// The path objects are built in emulated memory from the same .man points as the port's PathSpline, then FUN_00447280 (the plane table) runs natively.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe, loadZone } from './engine-load.mjs';
import { REC, K } from '../../src/zones/z15ssh/rules.ts';
import { prepareSsh, PATHS } from '../../src/zones/z15ssh/setup.ts';
import { PathSpline } from '../../src/zones/z15ssh/spline.ts';
import '../../src/zones/z15SSH.ts';

export const RB = 0x40000000, NB = 0x41000000, AB = 0x42000000, PB = 0x43000000, HB = 0x44000000;
export const NREC = 285;
const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };

/** the scripted random source shared by both sides: `u` in [0, 1) in draw order; `pos` can be saved / restored */
export function makeU(seed) {
  const g = { s: seed >>> 0, pos: 0 };
  g.next = () => { g.s = (Math.imul(g.s, 1664525) + 1013904223) >>> 0; g.pos++; return g.s / 4294967296; };
  return g;
}

/** a booted zone world with recorders for sounds / speech / random draws; `dt` is the world's step (1 = 30 Hz, 0.5 = 60 Hz) */
export function bootSsh(ctx, { seed = 1, dt = 1 } = {}) {
  const L = loadZone(ctx, 'z15SSH');
  const w = L.world;
  w.dt = dt;
  const G = { L, w, log: [], U: makeU(seed * 7919 + 13), draws: [] };
  const sounds = {
    play: (id) => G.log.push(['p', id]), stop: (id) => G.log.push(['s', id]),
    rate: (id, hz) => G.log.push(['r', id, hz]), volume: (id, v) => G.log.push(['v', id, v]),
    play3D: (id, x, y, z) => G.log.push(['p3', id, f32(x), f32(y), f32(z)]), stop3D: (id) => G.log.push(['s3', id]),
  };
  // the port's draws: int(n) = trunc(u * n) (the original: ftol(rand(n)) with FUN_004388ae(x) = u * x)
  const rng = { int: (n) => { G.draws.push(n); return Math.trunc(G.U.next() * n); } };
  const S = prepareSsh(w, L, L.archive, L.scene, { sounds, rng, say: (id) => { G.log.push(['say', id]); return true; }, coco: false });
  // the particle engine: a recorder (the trexfeet emitters of the constructor FUN_00659d94; gate calls go to the log the original's hook fills the same way)
  G.fxStarts = [];
  S.node.startFx({
    start: (name, m, pos, rot, gate) => { G.fxStarts.push({ name, rec: w.records.findIndex((r) => r.m === m), pos: [...pos], rot: [...rot], gate: [...gate] }); return 0x3000 + G.fxStarts.length - 1; },
    on: (h) => G.log.push(['fx', h, 2, 1, 1]), off: (h) => G.log.push(['fx', h, 1, 1, 1]),
  }, S.cart);
  G.log.length = 0;
  Object.assign(G, { S, node: S.node, cart: S.cart, R: w.records, parts: S.parts, arch: L.archive, pe: L.pe });
  G.tick = (mask = 0) => { w.input.setVirtual(mask); w.tick(); };
  return G;
}

/** m(t) = the CARBUT parameter at world z (bisection on the port's own spline) */
export function makeTFor(arch) {
  const sp0 = PathSpline.fromMan(arch.read(arch.find(PATHS.CART)));
  const fr0 = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
  return (z) => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; sp0.eval(m, fr0); if (fr0.pos[2] < z) lo = m; else hi = m; } return lo; };
}

export function createHarness(ctx) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe); cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;   // the original runs the x87 in 24-bit precision (Direct3D 7)
  const mem = cpu.mem;
  for (const [lo, n] of [[RB, NREC * 0x68], [NB, 0x800], [AB, NREC * 0x40], [PB, NREC * 0x400], [HB, 0x800000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
  const H = { cpu, mem, G: null, log: [], unhooked: new Set(), draws: [], calls: {} };
  const recPtr = (i) => RB + i * 0x68;
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  const push = (e) => H.log.push(e);
  const animOf = (ptr) => H.G.R[(ptr - AB) / 0x40].anim;

  // ---- sound handles: FUN_0065a470 (run natively) gives every DAT_05d5bdxx a handle; here handle = 0x1000 (3D) / 0x2000 (2D) + the sound id
  const idOf = (h) => h & 0xfff;
  hook(0x4433b0, (c) => { c.eax = 0x1000 + c.arg(0); });
  hook(0x443580, (c) => { c.eax = 0x2000 + c.arg(0); });
  hook(0x4359d5, () => {});
  hook(0x4435a0, (c) => { push(['p', idOf(c.arg(0))]); });
  hook(0x4435b0, (c) => { push(['s', idOf(c.arg(0))]); });
  hook(0x443600, (c) => { push(['r', idOf(c.arg(0)), c.arg(1) | 0]); });
  hook(0x4435c0, (c) => { push(['v', idOf(c.arg(0)), c.arg(1) | 0]); });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['p3', idOf(c.arg(0)), mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)]); });
  hook(0x4434b0, (c) => { push(['s3', idOf(c.arg(0))]); });
  // ---- speech: FUN_00439bf8(table, string, &token) / FUN_00435a11(token, -1)
  const tokens = new Map();
  hook(0x439bf8, (c) => { const tok = 0x7000 + tokens.size; tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { push(['say', tokens.get(c.arg(0))]); });
  // ---- random numbers: GetTickCount (FUN_00435c91) feeds FUN_004388ae(tick) % 13 (theft) / % 15 (hit); the stand-in returns the modulus so that ftol(u * tick) % m = trunc(u * m)
  hook(0x435c91, (c) => { const f = c.frames[c.frames.length - 1]; c.eax = f === 0x6582de ? 15 : 13; });
  hook(0x4388ae, (c) => { const x = c.argf(0); H.draws.push(x); c.fpush(H.G.U.next() * x); });
  // ---- animation instances
  hook(0x43b6a3, (c) => { animOf(c.arg(0)).start(c.arg(1) | 0, c.argf(2)); });
  hook(0x43b76a, (c) => { c.eax = animOf(c.arg(0)).advance(c.argf(1), H.G.w.dt); });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b753, (c) => { c.fpush(animOf(c.arg(0)).frameCount); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  // ---- the ground ray FUN_0043ce45(pos, dy, mask) = FUN_004425f0(x, y + dy, z): the port's CollisionWorld (-1e38 when nothing is hit)
  hook(0x43ce45, (c) => {
    const p = c.arg(0), dy = c.argf(1);
    H.calls.ground = (H.calls.ground ?? 0) + 1;
    c.fpush(H.G.w.col.terrainHeight(mem.f32(p), mem.f32(p + 4), mem.f32(p + 8), dy));
  });
  // FUN_0043ea60(model, i): the address of matrix i of the model = the mirrored part matrices
  hook(0x43ea60, (c) => { const h = c.arg(0), i = c.arg(1) | 0; c.eax = i < 0 || i >= 8 ? 0 : h + 0x20 + i * 0x40; });
  // particle emitters, the view-matrix builder FUN_0043cc5c(scratch, camera)
  hook(0x442a20, (c) => { push(['fx', c.arg(0), c.arg(1), c.arg(2), c.arg(3)]); }); hook(0x43cc5c, () => {});
  // the CRT's atan2 loads an 80 bit constant (not modelled by the interpreter): double atan2
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  // the crosshair FUN_0065817c: the screen size (FUN_00435c50(&w, &h, ...)) and the rectangle of the draw call FUN_0043c267(rect, -1, &texture)
  H.screen = [640, 480]; H.rect = null;
  hook(0x435c50, (c) => { mem.w32(c.arg(0), H.screen[0]); mem.w32(c.arg(1), H.screen[1]); });
  hook(0x43c267, (c) => { const p = c.arg(0); H.rect = [mem.r32(p), mem.r32(p + 4), mem.r32(p + 8), mem.r32(p + 12)]; });
  // the heap of FUN_00447280 (plane table)
  let bump = HB + 0x1000;
  const alloc = (n) => { const p = bump; bump += (n + 15) & ~15; return p; };
  hook(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });
  cpu.exec = [[0x422ddc, 0x422e36], [0x43a300, 0x43b100], [0x43cec0, 0x43cf30], [0x445600, 0x445a00], [0x4466f0, 0x447e00], [0x657460, 0x65a600], [0x858d30, 0x873e00]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z15SSH emu: unhooked call to 0x${a.toString(16)}`); };
  cpu.invalidate();

  // the sound handles of the zone (FUN_0065a470 native: the id table of the original)
  cpu.call(0x65a470, []);
  H.soundHandles = Object.fromEntries([['bd78', 0x5d5bd78], ['bd84', 0x5d5bd84], ['bd58', 0x5d5bd58], ['bd74', 0x5d5bd74], ['bd80', 0x5d5bd80], ['bd5c', 0x5d5bd5c], ['bd4c', 0x5d5bd4c], ['bd64', 0x5d5bd64], ['bd68', 0x5d5bd68],
    ['bd60', 0x5d5bd60], ['bd70', 0x5d5bd70], ['bd88', 0x5d5bd88], ['bd8c', 0x5d5bd8c], ['bd6c', 0x5d5bd6c], ['bd54', 0x5d5bd54], ['bd50', 0x5d5bd50], ['bd7c', 0x5d5bd7c]].map(([k, a]) => [k, idOf(mem.u32(a))]));

  // ---- the paths: six `.man` objects like the constructor's, the table DAT_009e586c of FUN_00445680, the global DAT_05cb58a8 (the last loaded = CARBUT, the end test of FUN_00447800)
  H.pathsReady = false;
  H.buildPaths = (arch) => {
    if (H.pathsReady) return;
    const TB = alloc(0x40);
    mem.w32(0x9e586c, TB);
    const sp = { cart: PathSpline.fromMan(arch.read(arch.find(PATHS.CART))), crt: PathSpline.fromMan(arch.read(arch.find(PATHS.CRT))),
      l: PathSpline.fromMan(arch.read(arch.find(PATHS.SNAKE_L))), r: PathSpline.fromMan(arch.read(arch.find(PATHS.SNAKE_R))) };
    let next = 1;
    const make = (s) => {
      const N = s.n, pts = alloc(N * 12);
      for (let i = 0; i < N * 3; i++) mem.wf32(pts + i * 4, s.pts[i]);
      const obj = alloc(0x40);
      mem.w32(obj, 0x892268); mem.w32(obj + 8, N); mem.w32(obj + 0x14, N); mem.w32(obj + 0x18, pts); mem.w32(obj + 0x10, 1);
      cpu.regs[1] = obj; cpu.call(0x447280, []);
      const h = next++, e = alloc(0x40);
      mem.w32(e + 0x24, obj); mem.w32(TB + h * 4, e);
      return h;
    };
    // FUN_00659d94: bd30 = cartpos1, bd34 = cartpos1 (unused), bd38 = CARBUT (snake 1), bd3c = SNAKEPOSL, bd40 = SNAKEPOSR, bd2c = CARBUT (the buggy, and DAT_05cb58a8)
    const bd30 = make(sp.crt), bd34 = make(sp.crt), bd38 = make(sp.cart), bd3c = make(sp.l), bd40 = make(sp.r), bd2c = make(sp.cart);
    mem.w32(0x5d5bd30, bd30); mem.w32(0x5d5bd34, bd34); mem.w32(0x5d5bd38, bd38); mem.w32(0x5d5bd3c, bd3c); mem.w32(0x5d5bd40, bd40); mem.w32(0x5d5bd2c, bd2c); mem.w32(0x5cb58a8, bd2c);
    H.pathHandles = { bd30, bd34, bd38, bd3c, bd40, bd2c };
    H.pathsReady = true;
  };

  // ---- mirrors
  const mirrorRecords = () => {
    const { R } = H.G;
    for (const r of R) {
      const p = recPtr(r.index);
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, PB + r.index * 0x400);
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
    }
  };
  /** the matrices of the mesh parts the code uses: PEPP 0..7 (wheels, turret, seats), CRT1..3 5 (the seat) */
  const partSet = () => [[REC.CART, [0, 1, 2, 3, 4, 5, 6, 7]], ...REC.CRT.map((i) => [i, [5]])];
  const mirrorParts = () => {
    for (const [ri, ps] of partSet()) for (const i of ps) {
      const m = H.G.parts.get(H.G.R[ri], i); if (!m) continue;
      const a = PB + ri * 0x400 + 0x20 + i * 0x40;
      for (let k = 0; k < 16; k++) mem.wf32(a + 4 * k, m[k]);
    }
  };
  const nodeWrite = (n) => {
    const p = NB;
    mem.fill(p, 0x600, 0);
    mem.wf32(p + 0x18, n.yaw); mem.wf32(p + 0x1c, n.smoothYaw); mem.wf32(p + 0x20, n.yawRate); mem.wf32(p + 0x24, n.wheel);
    mem.wf32(p + 0x28, n.aimYaw); mem.wf32(p + 0x2c, n.aimPitch); mem.wf32(p + 0x30, n.prevYaw);
    mem.wf32(p + 0x34, n.speed); mem.wf32(p + 0x3c, n.maxSpeed); mem.w32(p + 0x40, n.score); mem.w32(p + 0x48, n.gems);
    for (let i = 0; i < 3; i++) { mem.wf32(p + 0x4c + 4 * i, n.timers[i]); mem.w32(p + 0x58 + 4 * i, n.states[i]); for (let k = 0; k < 3; k++) mem.wf32(p + 0x558 + 12 * i + 4 * k, n.saved[i][k]); }
    n.coconuts.forEach((c, k) => {
      const q = p + 0x64 + 0x54 * k;
      for (let i = 0; i < 16; i++) mem.wf32(q + 4 * i, c.m[i]);
      for (let i = 0; i < 3; i++) mem.wf32(q + 0x40 + 4 * i, c.vel[i]);
      mem.w32(q + 0x4c, c.birth); mem.w8(q + 0x50, c.active ? 1 : 0);
    });
    mem.wf32(p + 0x57c, n.time); mem.wf32(p + 0x580, n.reload); mem.w32(p + 0x584, n.flinch ? 1 : 0); mem.w32(p + 0x598, n.stage); mem.w32(p + 0x588, n.feet[0]); mem.w32(p + 0x58c, n.feet[1]);
  };
  const nodeRead = () => {
    const p = NB;
    return {
      yaw: mem.f32(p + 0x18), smoothYaw: mem.f32(p + 0x1c), yawRate: mem.f32(p + 0x20), wheel: mem.f32(p + 0x24), aimYaw: mem.f32(p + 0x28), aimPitch: mem.f32(p + 0x2c), prevYaw: mem.f32(p + 0x30),
      speed: mem.f32(p + 0x34), maxSpeed: mem.f32(p + 0x3c), score: mem.r32(p + 0x40), gems: mem.r32(p + 0x48),
      timers: [0, 1, 2].map((i) => mem.f32(p + 0x4c + 4 * i)), states: [0, 1, 2].map((i) => mem.r32(p + 0x58 + 4 * i)),
      saved: [0, 1, 2].map((i) => [0, 1, 2].map((k) => mem.f32(p + 0x558 + 12 * i + 4 * k))),
      coconuts: Array.from({ length: 15 }, (_, k) => { const q = p + 0x64 + 0x54 * k; return { active: mem.r8(q + 0x50), m: Array.from({ length: 16 }, (_, i) => mem.f32(q + 4 * i)), vel: [0, 1, 2].map((i) => mem.f32(q + 0x40 + 4 * i)), birth: mem.r32(q + 0x4c) }; }),
      time: mem.f32(p + 0x57c), reload: mem.f32(p + 0x580), flinch: mem.r32(p + 0x584), stage: mem.r32(p + 0x598),
    };
  };
  const GLOB = { result: 0x5d5bcdc, final: 0x5d5bd48, hudScore: 0x5d5bce8, hudGems: 0x5d5bd44, bcd4: 0x5d5bcd4, bcd8: 0x5d5bcd8 };

  /** the port's current state -> memory */
  H.mirrorIn = () => {
    const { w, node, R } = H.G;
    mirrorRecords(); mirrorParts(); nodeWrite(node);
    mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);
    mem.w32(GLOB.result, node.result); mem.w32(GLOB.final, node.finalScore); mem.w32(GLOB.hudScore, node.hudScore); mem.w32(GLOB.hudGems, node.hudGems);
    mem.w32(0x9da5d8, recPtr(REC.CART) + 0xc);
    for (let i = 0; i < 18; i++) mem.wf32(0x9da5e8 + 4 * i, w.camera.c[i] ?? 0);
  };
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };

  /** one tick of FUN_00658c16 from the port's state with the logical button mask `held` (`pressed` = the edge against the port's previous tick) */
  H.pass = (held) => {
    const { w } = H.G;
    H.log.length = 0; H.draws.length = 0;
    H.mirrorIn();
    mem.w32(0x98383c, held); mem.w32(0x983840, (held ^ w.input.held) & held); mem.w32(0x983848, held);
    cpu.steps = 0;
    const t0 = cpu.steps;
    cpu.call(0x658c16, [recPtr(REC.CART), NB], { maxSteps: 20000000 });
    const R = H.G.R;
    return {
      node: nodeRead(), steps: cpu.steps - t0,
      recs: R.map((r) => { const p = recPtr(r.index); return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60), variant: mem.r32(p + 0x64) }; }),
      parts: partSet().flatMap(([ri, ps]) => ps.map((i) => [ri, i, Array.from({ length: 16 }, (_, k) => mem.f32(PB + ri * 0x400 + 0x20 + i * 0x40 + 4 * k))])),
      camera: Array.from({ length: 9 }, (_, i) => mem.f32(0x9da5e8 + 4 * i)),
      globals: Object.fromEntries(Object.entries(GLOB).map(([k, a]) => [k, k === 'bcd4' || k === 'bcd8' || k === 'result' || k === 'final' || k === 'hudScore' || k === 'hudGems' ? mem.r32(a) : 0])),
      log: H.log.slice(), draws: H.draws.slice(),
    };
  };
  /** the original's constructor placement FUN_00445680(path, t, 0, matrix, 1) of a path handle: the 16 floats */
  H.placeOnPath = (handle, t) => {
    const out = HB + 0x7f0000;
    cpu.steps = 0; const fb = new Float32Array([t]); cpu.call(0x445680, [handle, new Uint32Array(fb.buffer)[0], 0, out, 1]);
    return Array.from({ length: 16 }, (_, i) => mem.f32(out + 4 * i));
  };
  /** FUN_0065817c(node, rec) on a node with the given aim and a record with the given pitch: the crosshair centre of the rectangle it draws */
  H.crosshair = (aimYaw, aimPitch, recPitch, W, H2) => {
    H.screen = [W, H2]; H.rect = null;
    mem.wf32(NB + 0x28, aimYaw); mem.wf32(NB + 0x2c, aimPitch);
    mem.wf32(RB + REC.CART * 0x68 + 0x4c, recPitch);
    cpu.steps = 0; cpu.call(0x65817c, [NB, RB + REC.CART * 0x68]);
    return { x: H.rect[0] + 32, y: H.rect[1] + 32, rect: H.rect };
  };
  /** FUN_00447550 on the object of a path handle: the parameter t (float32 at obj + 0x1c), the end flag (+0x24), the segment pair (+0x28 / +0x2c) */
  H.project = (handle, p) => {
    const TB = mem.u32(0x9e586c), obj = mem.u32(mem.u32(TB + handle * 4) + 0x24);
    const pp = HB + 0x7f1000;
    for (let i = 0; i < 3; i++) mem.wf32(pp + 4 * i, p[i]);
    cpu.steps = 0; cpu.regs[1] = obj; cpu.call(0x447550, [pp]);
    return { t: mem.f32(obj + 0x1c), end: mem.u32(obj + 0x24), lo: mem.r32(obj + 0x28), hi: mem.r32(obj + 0x2c) };
  };
  return H;
}

/** state of the port that the emulated pass changes through the hosted services (animations) + the random sequence: snapshot / restore around the emulated pass */
export function snapHosted(G) {
  return { anims: G.R.map((r) => (r.anim ? { clip: r.anim.clip, frame: r.anim.frame, prevFrame: r.anim.prevFrame, prevClip: r.anim.prevClip } : null)), u: { s: G.U.s, pos: G.U.pos } };
}
export function restoreHosted(G, s) {
  G.R.forEach((r, i) => { if (r.anim && s.anims[i]) Object.assign(r.anim, s.anims[i]); });
  G.U.s = s.u.s; G.U.pos = s.u.pos;
}
