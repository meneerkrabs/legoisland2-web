// z08BKD (WP-VERIFY): the ORIGINAL zone code of "Brick Dive" runs in the x86 emulation next to the port (tools/tests/m7-z08BKD-emu.mjs, docs/re/m6/z08BKD.md "Differential test").
//
//  * Set-up: the original builder FUN_005b9430 runs natively (it calls the real attach FUN_00423532 / controller FUN_0042382c, so every constructor of the 12 node kinds
//    runs, the waypoint graph FUN_005bb2da is built from the compiled map by the real loader FUN_004630c0, the hurt zones FUN_005ba570 / FUN_005ba32c, the plants FUN_005b8ac0).
//    The nodes live in emulated memory as the original lays them out (linked list through +0x10, vtable at +4).
//  * Per tick (lockstep): the port's dynamic state (records, node fields, zone globals) is written into the emulated memory, the frame of the zone loop FUN_005b8368 mode 2 runs
//    natively (FUN_005baf8f the clock, FUN_005ba5d7 the hurt zones, FUN_0042226e the real update pass over all records, FUN_005b8d97 the plants, FUN_005b92d3 the HUD), and the
//    result is compared with the port's tick of the same state (`beforeTick`, `w.tick()`, `afterTick`).
//  * Hosted engine services (stand-ins, not the subject): the animation instance functions (FUN_0043b6a3 / 76a / 73f / 753 / 64d / 72b) operate on the port's own AnimInstance
//    (tests anim.mjs / engine-anim.mjs), the collision ray FUN_00441b10 calls the port's CollisionWorld (engine-collision.mjs), sounds / speech / the random numbers
//    (FUN_004388ae from a scripted sequence shared with the port) / game variables / the model-attach calls are logged or forwarded, FUN_00444550 (part flags), particles.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe, loadZone } from './engine-load.mjs';
import { prepareBkd } from '../../src/zones/z08bkd/run.ts';
import { REC, RIG_OF_RECORD, SND } from '../../src/zones/z08bkd/consts.ts';
import { BallNode } from '../../src/zones/z08bkd/bodies.ts';
import '../../src/zones/z08BKD.ts';
import { setRandSource, randF } from '../../src/game/crt.ts';

export const RB = 0x40000000, AB = 0x42000000, PB = 0x43000000, HB = 0x44000000;
const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };

/** the scripted rand() shared by both sides (FUN_0085daf0: seed * 0x343fd + 0x269ec3, (seed >> 16) & 0x7fff): the port's draws come through crt.ts `randF` on `setRandSource`, the original's FUN_004388ae is hosted with the same float32 formula */
export function makeU(seed) {
  const g = { s: seed >>> 0, pos: 0 };
  g.next = () => { g.s = (Math.imul(g.s, 0x343fd) + 0x269ec3) >>> 0; g.pos++; return (g.s >>> 16) & 0x7fff; };
  return g;
}

/** a booted world of the zone: the records mirrored BEFORE the zone's own bind (the emulated builder starts from that state) and the port's run */
export function bootBkd(ctx, { seed = 1, dt = 1 } = {}) {
  const L = loadZone(ctx, 'z08BKD');
  const w = L.world;
  w.dt = dt;
  const G = { L, w, log: [], speech: [], U: makeU(seed * 7919 + 13), draws: [], attaches: [] };
  // the records as the extraction's set-up leaves them (what the original's builder starts from)
  G.pre = w.records.map((r, i) => ({ name: r.name, m: Float32Array.from(r.m), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags, variant: r.variant, hasAnim: i in RIG_OF_RECORD, hasCol: !!r.colObj }));
  G.preVars = w.vars.a.slice();
  G.run = prepareBkd(w, L.archive, L.scene, {
    seed, speak: (id) => { G.speech.push(id); G.log.push(['say', id]); },
    attach: (rec, slot, bone, child) => G.log.push(['attach', rec.index, slot, bone, child ? child.index ?? 1 : 0]),
  });
  // the port's sound bank records its calls
  G.sndCalls = [];
  const sb = G.run.sound;
  const rec = (kind) => (name, ...a) => { G.sndCalls.push([kind, name, ...a]); G.log.push([kind, SND[name]]); };
  sb.play = rec('p'); sb.stop = rec('s');
  sb.at = (name, pos) => { G.sndCalls.push(['at', name, f32(pos[0]), f32(pos[1]), f32(pos[2])]); G.log.push(['at', SND[name], f32(pos[0]), f32(pos[1]), f32(pos[2])]); };
  // the port's draws of the random source
  const rng = G.run.env.rng;
  setRandSource(() => G.U.next());
  rng.float = (x) => { G.draws.push(x); return randF(x); };
  rng.int = (x) => Math.trunc(rng.float(x));
  Object.assign(G, { R: w.records, env: G.run.env });
  G.tick = (mask = 0) => { w.input.setVirtual(mask); G.run.beforeTick(); w.tick(); G.run.afterTick(); };
  return G;
}

export function createHarness(ctx) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe); cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;   // the original runs the x87 in 24-bit precision (Direct3D 7)
  const mem = cpu.mem;
  const H = { cpu, mem, pe, G: null, log: [], draws: [], unhooked: new Set(), calls: {}, built: false };
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  const push = (e) => H.log.push(e);
  const animOf = (ptr) => H.G.R[(ptr - AB) / 0x40].anim;
  let bump = HB + 0x1000;
  const alloc = (n) => { const p = bump; bump += (n + 15) & ~15; return p; };
  H.alloc = alloc;
  hook(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });
  // ---- sounds: the handles of FUN_005cd0d0 are not needed (the port's names are compared by id); here every handle = its sound id table index
  const idOf = (h) => h & 0xfff;
  hook(0x4433b0, (c) => { c.eax = 0x1000 + c.arg(0); });
  hook(0x443580, (c) => { c.eax = 0x2000 + c.arg(0); });
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  hook(0x4435a0, (c) => { push(['p', idOf(c.arg(0))]); });
  hook(0x4435b0, (c) => { push(['s', idOf(c.arg(0))]); });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['at', idOf(c.arg(0)), mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)]); });
  hook(0x4434b0, (c) => { push(['s', idOf(c.arg(0))]); });
  // ---- speech, random numbers, variables
  const tokens = new Map();
  hook(0x439bf8, (c) => { const tok = 0x7000 + tokens.size; tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { push(['say', tokens.get(c.arg(0))]); });
  hook(0x435c91, (c) => { c.eax = 1; });
  hook(0x4388ae, (c) => { const x = c.argf(0); H.draws.push(x); c.fpush(x <= 0 ? 0 : f32(f32(H.G.U.next() / 32767) * f32(x))); });      // FUN_004388ae: 0.0 for x <= 0 (no draw), else (float) rand() / 32767.0f * x in float32 steps
  hook(0x417575, (c) => { c.eax = H.G.w.vars.get(c.arg(0)); });
  hook(0x417597, (c) => { H.G.w.vars.set(c.arg(0), c.arg(1) | 0); });
  // ---- animation instances
  hook(0x43b6a3, (c) => { animOf(c.arg(0)).start(c.arg(1) | 0, c.argf(2)); });
  hook(0x43b76a, (c) => { c.eax = animOf(c.arg(0)).advance(c.argf(1), H.G.w.dt); });
  hook(0x43b72b, (c) => { c.eax = animOf(c.arg(0)).clip; });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b753, (c) => { c.fpush(animOf(c.arg(0)).frameCount); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  // ---- the files of the loader FUN_004630c0 (the compiled waypoint map)
  const files = new Map();
  let nextFile = 0x100;
  hook(0x43bfb7, (c) => {
    const path = mem.cstr(c.arg(0));
    const member = path.replace(/^.*[\\/]z08BKD[\\/]/i, '').replace(/\\/g, '/');
    const e = H.G.L.archive.find(member);
    if (!e) { c.eax = 0; return; }
    const h = (nextFile += 0x10);
    files.set(h, { data: H.G.L.archive.read(e), pos: 0 });
    c.eax = h;
  });
  hook(0x43c1a0, (c) => {
    const f = files.get(c.arg(0)), dst = c.arg(1), len = c.arg(2);
    if (!f) { c.eax = 0; return; }
    const k = Math.max(0, Math.min(len, f.data.length - f.pos));
    mem.write(dst, f.data.subarray(f.pos, f.pos + k));
    f.pos += k;
    c.eax = k;
  });
  hook(0x43c22e, (c) => { files.delete(c.arg(0)); });
  // ---- the collision ray FUN_00441b10(record, ray, 0): the ray block DAT_00903560 = { start*, delta*, normal-out*, point-out*, mask, radius, skin } -> the port's CollisionWorld (a hit writes normal and point)
  hook(0x441b10, (c) => {
    // the records the nodes before this one in the pass already moved (the emulated memory is the truth): the port's collision world sees them
    for (const r of H.G.R) { const p = RB + r.index * 0x68; for (let i = 0; i < 16; i++) r.m[i] = mem.f32(p + 0xc + 4 * i); r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60); }
    const rec = H.G.R[(c.arg(0) - RB) / 0x68], s = c.arg(1);
    const sp = mem.u32(s), dp = mem.u32(s + 4);
    const from = [mem.f32(sp), mem.f32(sp + 4), mem.f32(sp + 8)], delta = [mem.f32(dp), mem.f32(dp + 4), mem.f32(dp + 8)];
    H.calls.ray = (H.calls.ray ?? 0) + 1;
    const h = H.G.w.col.rayRecord(rec, from, delta, mem.r32(s + 0x10), mem.f32(s + 0x14), mem.f32(s + 0x18));
    if (!h) { c.eax = 0; return; }
    const np = mem.u32(s + 8), pp = mem.u32(s + 0xc);
    for (let i = 0; i < 3; i++) { mem.wf32(np + 4 * i, h.normal[i]); mem.wf32(pp + 4 * i, h.point[i]); }
    c.eax = 1;
  });
  // ---- the part bank: DAT_00983838 + 0x2c = the bank, FUN_0043eaf0(bank, i) = model i (here 0x5000 + i), FUN_0043e930(recModel, child, bone, slot) / FUN_0043e970(recModel, slot) attach / detach
  hook(0x43eaf0, (c) => { c.eax = 0x5000 + c.arg(1); });
  hook(0x43e930, (c) => { push(['attach', (c.arg(0) - PB) / 0x10, c.arg(3), c.arg(2), c.arg(1) - 0x5000]); });
  hook(0x43e970, (c) => { push(['attach', (c.arg(0) - PB) / 0x10, c.arg(1), 0, 0]); });
  // ---- the banner's text draws FUN_00439c6f(font, table, text, 1, 0, x, y, wrap) and its small engine calls
  hook(0x439c6f, (c) => { push(['draw', mem.cstr(c.arg(2)), c.arg(6)]); });
  hook(0x460a3d, () => {}); hook(0x435b07, () => {});
  // ---- no-ops (fog, part flags, particles, the engine's "attach controller" bookkeeping, model attach, texture / sound loads of the loop)
  for (const a of [0x442d90, 0x442900, 0x444550, 0x443c70, 0x442a50, 0x442960, 0x442930, 0x43cc5c, 0x43ebe0, 0x444790]) hook(a, () => { cpu.eax = 0; });
  // the CRT's atan2 loads an 80 bit constant (not modelled by the interpreter): double atan2
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  cpu.exec = [[0x5b7ef0, 0x5c2c00], [0x5cd0d0, 0x5cd2b0], [0x43a300, 0x43b100], [0x43cec0, 0x43cf30], [0x43d159, 0x43d2c0], [0x423532, 0x4237cd], [0x42382c, 0x42386a], [0x4237b6, 0x4237cd], [0x4238b7, 0x4238ce], [0x42216f, 0x4221f2], [0x431260, 0x43128b], [0x42226e, 0x4225c5], [0x422b50, 0x422c7e], [0x4b1000, 0x4b12f8],
    [0x462b00, 0x463b00], [0x858d30, 0x873e00]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z08BKD emu: unhooked call to 0x${a.toString(16)} (from ${cpu.frames.slice(-3).map((f) => f.toString(16)).join(' > ')})`); };
  cpu.invalidate();
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };
  return H;
}

/** mirror all records of the port (before the zone's own bind = the extraction's set-up) into emulated memory and build the zone with the original builder */
export function buildOriginal(H, G) {
  const { cpu, mem } = H;
  H.G = G;
  const N = G.R.length;
  if (!H.regions) {
    H.regions = true;
    mem.addRegion({ lo: RB, hi: RB + N * 0x68 + 0x100, name: 'rec' });
    mem.addRegion({ lo: AB, hi: AB + N * 0x40 + 0x100, name: 'anim' });
    mem.addRegion({ lo: HB, hi: HB + 0x400000, name: 'heap' });
    mem.addRegion({ lo: PB, hi: PB + N * 0x10 + 0x100, name: 'models' });
  }
  { const blk = H.alloc(0x40); mem.w32(0x983838, blk); mem.w32(blk + 0x2c, 0x6000); }
  mem.w32(0x983804, RB); mem.w32(0x983800, N);
  G.pre.forEach((r, i) => {
    const p = RB + i * 0x68;
    for (let k = 0; k < 4; k++) mem.w8(p + k, r.name.charCodeAt(k) || 0x20);
    mem.w32(p + 4, PB + i * 0x10);
    mem.w32(p + 8, r.hasAnim ? AB + i * 0x40 : 0);
    for (let k = 0; k < 16; k++) mem.wf32(p + 0xc + 4 * k, r.m[k]);
    mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
    mem.w32(p + 0x58, r.hasCol ? 1 : 0);
    mem.w32(p + 0x5c, 0);
    mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
  });
  H.log.length = 0;
  cpu.steps = 0;
  cpu.call(0x5cd0d0, []);       // FUN_005cd0d0: the sound handles (every handle = its sound id here)
  cpu.call(0x5b9430, [1], { maxSteps: 50000000 });
  H.built = true;
  return { steps: cpu.steps };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// node layouts (offsets of the original's node structs) <-> the port's node classes. `dyn` fields are mirrored into the emulated memory before every tick; every field is compared.

const VT = { 0x9035b8: 'FishBeh', 0x903608: 'CBallBeh', 0x903658: 'CannBeh', 0x9036a8: 'PiroBeh', 0x903708: 'ClamBeh', 0x903758: 'OctoBeh', 0x9037a8: 'AnchBeh', 0x9037f8: 'DolpBeh', 0x903848: 'PageBeh',
  0x903898: 'BrkBeh', 0x903930: 'CamBeh', 0x903980: 'SwimBeh', 0x8d91a0: 'SeaAmin' };
export const KIND_OF_VTABLE = VT;
const rk = (p) => (p ? (p - RB) / 0x68 : -1);
const pk = (i) => (i >= 0 ? RB + i * 0x68 : 0);
const f = (o, g, s) => ({ t: 'f', o, g, s });
const i32 = (o, g, s) => ({ t: 'i', o, g, s });
const u8 = (o, g, s) => ({ t: 'b', o, g, s });
const ptr = (o, g, s) => ({ t: 'p', o, g, s });

/** the bodies with the ball / brick layout: +0x7c last place, +0x88 velocity, +0x9c spin, +0xa0 active, +0xa4 age */
const bodyFields = () => [
  ...[0, 1, 2].map((k) => f(0x7c + 4 * k, (n) => n.last[k], (n, v) => { n.last[k] = v; })),
  f(0x88, (n) => n.b.vx, (n, v) => { n.b.vx = v; }), f(0x8c, (n) => n.b.vy, (n, v) => { n.b.vy = v; }), f(0x90, (n) => n.b.vz, (n, v) => { n.b.vz = v; }),
  f(0x9c, (n) => n.b.angVel, (n, v) => { n.b.angVel = v; }),
  i32(0xa0, (n) => (n.active ? 1 : 0), (n, v) => { n.active = v !== 0; }), f(0xa4, (n) => n.age, (n, v) => { n.age = v; }),
];
const blockFields = (base, get) => Array.from({ length: 13 }, (_, k) => f(base + 4 * k, (n) => get(n)[k], (n, v) => { get(n)[k] = v; }));

export const LAYOUT = {
  AnchBeh: [f(0x18, (n) => n.speed, (n, v) => { n.speed = v; }), f(0x1c, (n) => n.base, (n, v) => { n.base = v; })],
  PageBeh: [],
  BrkBeh: bodyFields(),
  CBallBeh: bodyFields(),
  CannBeh: [f(0x18, (n) => n.timer, (n, v) => { n.timer = v; }), ...Array.from({ length: 10 }, (_, k) => ptr(0x1c + 4 * k, (n) => (n.slots[k] ? n.slots[k].index : -1), (n, v, R) => { n.slots[k] = v >= 0 ? R[v] : null; }))],
  ClamBeh: [f(0x18, (n) => n.speed, (n, v) => { n.speed = v; }), i32(0x1c, (n) => (n.holding ? 1 : 0), (n, v) => { n.holding = v !== 0; }), f(0x20, (n) => n.timer, (n, v) => { n.timer = v; })],
  OctoBeh: [f(0x18, (n) => n.speed, (n, v) => { n.speed = v; }), i32(0x1c, (n) => (n.a ? 1 : 0), (n, v) => { n.a = v !== 0; }), i32(0x20, (n) => (n.firstHalf ? 1 : 0), (n, v) => { n.firstHalf = v !== 0; }),
    i32(0x24, (n) => (n.b ? 1 : 0), (n, v) => { n.b = v !== 0; }), i32(0x28, (n) => (n.secondHalf ? 1 : 0), (n, v) => { n.secondHalf = v !== 0; })],
  PiroBeh: [i32(0x18, (n) => (n.alerted ? 1 : 0), (n, v) => { n.alerted = v !== 0; }), i32(0x1c, (n) => (n.engaged ? 1 : 0), (n, v) => { n.engaged = v !== 0; }), i32(0x20, (n) => (n.near ? 1 : 0), (n, v) => { n.near = v !== 0; }),
    i32(0x24, (n) => n.state, (n, v) => { n.state = v; }), f(0x28, (n) => n.cooldown, (n, v) => { n.cooldown = v; })],
  FishBeh: [...blockFields(0x18, (n) => n.b), i32(0x58, (n) => n.index, (n, v) => { n.index = v; })],
  DolpBeh: [...blockFields(0xb4, (n) => n.b), i32(0xe8, (n) => n.state, (n, v) => { n.state = v; }), i32(0xec, (n) => n.kindOfJump, (n, v) => { n.kindOfJump = v; }),
    f(0xf4, (n) => n.speed, (n, v) => { n.speed = v; }), f(0xf8, (n) => n.targetSpeed, (n, v) => { n.targetSpeed = v; }), f(0xfc, (n) => n.accel, (n, v) => { n.accel = v; }), i32(0x118, (n) => n.pick, (n, v) => { n.pick = v; }),
    ...[0, 1, 2].map((k) => f(0x28 + 4 * k, (n) => n.goalPos[k], (n, v) => { n.goalPos[k] = v; }))],
  SwimBeh: [
    i32(0x1c, (n) => n.shape, (n, v) => { n.shape = v; }), i32(0x20, (n) => n.wantShape, (n, v) => { n.wantShape = v; }),
    ptr(0x104, (n) => (n.held ? n.held.index : -1), (n, v, R) => { n.held = v >= 0 ? R[v] : null; }),
    f(0x108, (n) => n.stun, (n, v) => { n.stun = v; }), f(0x10c, (n) => n.flicker, (n, v) => { n.flicker = v; }), f(0x110, (n) => n.spare, (n, v) => { n.spare = v; }),
    i32(0x114, (n) => n.flickerPhase, (n, v) => { n.flickerPhase = v; }), i32(0x118, (n) => n.view, (n, v) => { n.view = v; }), i32(0x11c, (n) => n.nearBrick, (n, v) => { n.nearBrick = v; }),
    i32(0x100, (n) => n.blocked, (n, v) => { n.blocked = v; }),
    f(0xf0, (n) => n.safe.x, (n, v) => { n.safe.x = v; }), f(0xf4, (n) => n.safe.y, (n, v) => { n.safe.y = v; }), f(0xf8, (n) => n.safe.z, (n, v) => { n.safe.z = v; }), f(0xfc, (n) => n.safe.heading, (n, v) => { n.safe.heading = v; }),
    u8(0x121, (n) => (n.surfaceFlag ? 1 : 0), (n, v) => { n.surfaceFlag = v !== 0; }), u8(0x122, (n) => (n.flipperFlag ? 1 : 0), (n, v) => { n.flipperFlag = v !== 0; }), u8(0xb8, (n) => (n.clamCatching ? 1 : 0), (n, v) => { n.clamCatching = v !== 0; }),
    i32(0x124, (n) => n.breathCount, (n, v) => { n.breathCount = v; }),
    f(0xc4, (n) => n.w.angVel, (n, v) => { n.w.angVel = v; }), f(0xd0, (n) => n.w.heading, (n, v) => { n.w.heading = v; }),
    f(0xd4, (n) => n.w.vx, (n, v) => { n.w.vx = v; }), f(0xd8, (n) => n.w.vy, (n, v) => { n.w.vy = v; }), f(0xdc, (n) => n.w.vz, (n, v) => { n.w.vz = v; }),
    f(0xe0, (n) => n.w.turn, (n, v) => { n.w.turn = v; }), f(0xe4, (n) => n.w.turnDrag, (n, v) => { n.w.turnDrag = v; }), f(0xe8, (n) => n.w.thrust, (n, v) => { n.w.thrust = v; }), f(0xec, (n) => n.w.drag, (n, v) => { n.w.drag = v; }),
  ],
  CamBeh: [],
  SeaAmin: [],
};

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// state mirror: the port's state -> memory; memory / port -> a comparable plain object

const GLB = { elapsed: 0x5d5897c, bricks: 0x5d58988, page: 0x5d58984, pageFlash: 0x5d58978, halfSpoken: 0x5d58980, dolphinMsg: 0x5d5898c, gauge: 0x5d4e138, clockDt: 0x5d5ab04, clockPhase: 0x5d5ab08,
  balls: 0x5d5ab88, jumping: 0x5d5ab90, pageTint: 0x5d4dd18 };
const TINT0 = 0x5d4e148;

/** the emulated nodes by record: [{ kind, ptr }] in list order */
export function indexNodes(H, G) {
  const mem = H.mem;
  H.nodes = [];
  for (let i = 0; i < G.R.length; i++) {
    const ctrl = mem.u32(RB + i * 0x68 + 0x5c);
    const list = [];
    if (ctrl) for (let n = mem.u32(ctrl); n; n = mem.u32(n + 0x10)) list.push({ kind: KIND_OF_VTABLE[mem.u32(n + 4)] ?? '?', ptr: n });
    H.nodes[i] = list;
  }
}

function writeField(mem, base, fld, v) {
  const a = base + fld.o;
  if (fld.t === 'f') mem.wf32(a, v);
  else if (fld.t === 'i') mem.w32(a, v | 0);
  else if (fld.t === 'b') mem.w8(a, v & 0xff);
  else if (fld.t === 'p') mem.w32(a, v >= 0 ? RB + v * 0x68 : 0);
}
function readField(mem, base, fld) {
  const a = base + fld.o;
  if (fld.t === 'f') return mem.f32(a);
  if (fld.t === 'i') return mem.r32(a);
  if (fld.t === 'b') return mem.r8(a);
  const v = mem.u32(a);
  return v ? (v - RB) / 0x68 : -1;
}
const portNodeOf = (G, i, kind) => G.R[i].ctrl?.nodes.find((n) => n.kind === kind);

/** the dolphin's shared fields: +0x24 (the previous patrol node / the route index) and +0x34 (the patrol node / the goal node) mean different things by state */
const dolphinShared = (n) => (n.state === 0 ? { a: n.prev, b: n.patrolNode } : { a: n.routeIdx, b: n.goalNode });

/** port state -> emulated memory (the dynamic fields); the static ones come from the original's own constructors */
export function mirrorIn(H, G, held) {
  const { mem } = H, w = G.w, R = G.R;
  // records
  for (const r of R) {
    const p = RB + r.index * 0x68;
    for (let k = 0; k < 16; k++) mem.wf32(p + 0xc + 4 * k, r.m[k]);
    mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
    mem.w16(p + 0x60, r.flags & 0xffff); mem.w32(p + 0x64, r.variant | 0);
  }
  // nodes
  for (let i = 0; i < R.length; i++) {
    for (const e of H.nodes[i]) {
      const L = LAYOUT[e.kind];
      const n = portNodeOf(G, i, e.kind);
      if (!L || !n) continue;
      for (const fld of L) writeField(mem, e.ptr, fld, fld.g(n));
      if (e.kind === 'DolpBeh') {
        const s = dolphinShared(n);
        mem.w32(e.ptr + 0x24, s.a | 0); mem.w32(e.ptr + 0x34, s.b | 0);
        n.route.forEach((v, k) => mem.w32(e.ptr + 0x38 + 4 * k, v));
      }
      if (e.kind === 'SwimBeh') {
        const q = n.quad;
        if (q && q.length === 4) for (let k = 0; k < 4; k++) for (let c = 0; c < 3; c++) mem.wf32(e.ptr + 0x88 + 12 * k + 4 * c, q[k][c]);
      }
    }
  }
  // zone globals
  const st = G.run.state, ck = G.run.clock;
  mem.wf32(GLB.elapsed, st.elapsed); mem.w8(GLB.bricks, st.bricks); mem.w8(GLB.page, st.page ? 1 : 0); mem.wf32(GLB.pageFlash, st.pageFlash); mem.w32(GLB.halfSpoken, st.halfSpoken ? 1 : 0);
  mem.w32(GLB.dolphinMsg, st.dolphinMessage); mem.wf32(GLB.gauge, st.gauge);
  mem.wf32(GLB.clockDt, ck.dt); mem.wf32(GLB.clockPhase, ck.phase);
  mem.w32(GLB.pageTint, st.pageTint);
  for (let k = 0; k < 5; k++) mem.w32(TINT0 + 8 * k, st.brickTint[k]);
  const dol = portNodeOf(G, REC.DLPH, 'DolpBeh');
  mem.w32(GLB.jumping, dol && dol.jumping ? 1 : 0);
  mem.w32(GLB.balls, BallNode.inFlight);
  // time step, input, camera
  mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);
  mem.w32(0x9da5d0, RB + REC.PEPP * 0x68); mem.w32(0x9da5c8, 0);
  mem.w32(0x98383c, held); mem.w32(0x983840, (held ^ w.input.held) & held);
  for (let k = 0; k < 6; k++) mem.wf32(0x9da5e8 + 4 * k, w.camera.c[k]);
}

/** the emulated memory -> the comparable state (the same shape as `portState`) */
export function emuState(H, G) {
  const { mem } = H, R = G.R;
  const recs = R.map((r) => {
    const p = RB + r.index * 0x68;
    return { m: Array.from({ length: 16 }, (_, k) => mem.f32(p + 0xc + 4 * k)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) };
  });
  const nodes = {};
  for (let i = 0; i < R.length; i++) {
    for (const e of H.nodes[i]) {
      const L = LAYOUT[e.kind];
      if (!L) continue;
      const o = {};
      for (const fld of L) o[`0x${fld.o.toString(16)}`] = readField(mem, e.ptr, fld);
      if (e.kind === 'DolpBeh') { o.shared24 = mem.r32(e.ptr + 0x24); o.shared34 = mem.r32(e.ptr + 0x34); o.route = Array.from({ length: 24 }, (_, k) => mem.r32(e.ptr + 0x38 + 4 * k)); o.routeCount = mem.r32(e.ptr + 0xb0); }
      if (e.kind === 'SwimBeh') o.quad = Array.from({ length: 12 }, (_, k) => mem.f32(e.ptr + 0x88 + 4 * k));
      nodes[`${i}:${e.kind}`] = o;
    }
  }
  const globals = {};
  for (const [k, a] of Object.entries(GLB)) globals[k] = k === 'bricks' || k === 'page' ? mem.r8(a) : k === 'pageTint' ? mem.u32(a) : (k === 'elapsed' || k === 'pageFlash' || k === 'gauge' || k === 'clockDt' || k === 'clockPhase') ? mem.f32(a) : mem.r32(a);
  globals.tints = Array.from({ length: 5 }, (_, k) => mem.u32(TINT0 + 8 * k));
  const camera = Array.from({ length: 6 }, (_, k) => mem.f32(0x9da5e8 + 4 * k));
  const hurt = [];
  for (let n = 0; n < mem.r32(0x5d5ab00); n++) {
    const e = 0x5d58c78 + n * 0xb4, sp = [];
    for (let k = 0; k < mem.r32(e + 0xac); k++) sp.push([0, 1, 2].map((c) => mem.f32(e + 0x20 + k * 0x1c + 0xc + 4 * c)));
    hurt.push({ rec: rk(mem.u32(e)), category: mem.r32(e + 0xb0), anchor: [0, 1, 2].map((c) => mem.f32(e + 0x10 + 4 * c)), spheres: sp });
  }
  return { recs, nodes, globals, camera, hurt };
}

export function portState(H, G) {
  const R = G.R;
  const recs = R.map((r) => ({ m: Array.from(r.m), e: [r.rx, r.ry, r.rz], flags: r.flags & 0xffff }));
  const nodes = {};
  for (let i = 0; i < R.length; i++) {
    for (const e of H.nodes[i]) {
      const L = LAYOUT[e.kind];
      const n = portNodeOf(G, i, e.kind);
      if (!L || !n) continue;
      const o = {};
      for (const fld of L) o[`0x${fld.o.toString(16)}`] = fld.g(n);
      if (e.kind === 'DolpBeh') { const s = dolphinShared(n); o.shared24 = s.a; o.shared34 = s.b; o.route = n.route.slice(0, 24); o.routeCount = null; }
      if (e.kind === 'SwimBeh') o.quad = n.quad.length === 4 ? n.quad.flat() : null;
      nodes[`${i}:${e.kind}`] = o;
    }
  }
  const st = G.run.state, ck = G.run.clock;
  const dol = portNodeOf(G, REC.DLPH, 'DolpBeh');
  const globals = { elapsed: st.elapsed, bricks: st.bricks, page: st.page ? 1 : 0, pageFlash: st.pageFlash, halfSpoken: st.halfSpoken ? 1 : 0, dolphinMsg: st.dolphinMessage, gauge: st.gauge, clockDt: ck.dt, clockPhase: ck.phase,
    balls: BallNode.inFlight, jumping: dol && dol.jumping ? 1 : 0, pageTint: st.pageTint >>> 0, tints: st.brickTint.map((v) => v >>> 0) };
  const camera = Array.from(G.w.camera.c).slice(0, 6);
  const hurt = G.run.env.hurt.entries.map((e) => ({ rec: e.rec.index, category: e.category, anchor: Array.from(e.anchorWorld), spheres: e.spheres.map((s) => Array.from(s.world)) }));
  return { recs, nodes, globals, camera, hurt, end: { over: G.run.state.over() ? 1 : 0, success: G.run.state.success() ? 1 : 0, percent: G.run.state.percentLeft() } };
}

/** one frame of the zone loop's mode 2 in the original, from the port's state (`held` = the logical button mask) */
export function emuFrame(H, G, held) {
  const { cpu } = H;
  H.log.length = 0; H.draws.length = 0;
  mirrorIn(H, G, held);
  cpu.steps = 0;
  const t0 = cpu.steps;
  for (const [fn, args] of [[0x5baf8f, []], [0x5ba5d7, []], [0x42226e, [RB, G.R.length]], [0x5b8d97, []], [0x5b92d3, []]]) cpu.call(fn, args, { maxSteps: 20000000 });
  // the loop's end test: FUN_005b8fa4 (over), FUN_005b8ffa (all five bricks), FUN_005b9014 (the percentage, a float10)
  const over = cpu.call(0x5b8fa4, []) & 0xff, success = cpu.call(0x5b8ffa, []) & 0xff;
  cpu.call(0x5b9014, []);
  const percent = cpu.fpop();
  const state = emuState(H, G);
  state.end = { over, success, percent };
  return { steps: cpu.steps - t0, state, log: H.log.slice(), draws: H.draws.slice() };
}

/** what the hosted services of an emulated frame change in the port (animations, the random source, game variables, the collision hit cache): snapshot / restore around it */
export function snapHosted(G) {
  const col = G.w.col;
  return {
    anims: G.R.map((r) => (r.anim ? { clip: r.anim.clip, frame: r.anim.frame, prevFrame: r.anim.prevFrame, prevClip: r.anim.prevClip } : null)),
    u: { s: G.U.s, pos: G.U.pos }, vars: G.w.vars.a.slice(), recs: G.R.map((r) => ({ m: new Float32Array(r.m), flags: r.flags })),
    col: { lastHit: col.lastHit, cacheRec: col.cacheRec, cacheFrom: col.cacheFrom.slice(), cacheTo: col.cacheTo.slice() },
  };
}
export function restoreHosted(G, s) {
  G.R.forEach((r, i) => { if (r.anim && s.anims[i]) Object.assign(r.anim, s.anims[i]); });
  G.U.s = s.u.s; G.U.pos = s.u.pos; G.w.vars.a.set(s.vars);
  G.R.forEach((r, i) => { r.m.set(s.recs[i].m); r.flags = s.recs[i].flags; });
  const col = G.w.col;
  col.lastHit = s.col.lastHit; col.cacheRec = s.col.cacheRec; col.cacheFrom = s.col.cacheFrom.slice(); col.cacheTo = s.col.cacheTo.slice();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// direct calls of single functions of the original (unit-level differential tests)
const FB = new Float32Array(1), UB = new Uint32Array(FB.buffer);
/** a float argument */
export const F = (x) => ({ f: x });
export const bitsOf = (x) => { FB[0] = x; return UB[0]; };
const SCRATCH = HB + 0x300000;
/** call `addr` (cdecl) with 32-bit args (floats as their bits); returns { eax, f } where f is the float the function left on the x87 stack (null when none) */
export function callFn(H, addr, args = []) {
  const { cpu } = H;
  const top0 = cpu.top;
  cpu.steps = 0;
  const eax = cpu.call(addr, args.map((a) => (a !== null && typeof a === 'object' ? bitsOf(a.f) : a)), { maxSteps: 50000000 });
  let f = null;
  if (cpu.top !== top0) f = cpu.fpop();
  return { eax: eax | 0, f };
}
/** scratch buffer `k` (0 .. 15) of 0x1000 bytes in emulated memory */
export const scratch = (k) => SCRATCH + k * 0x1000;
