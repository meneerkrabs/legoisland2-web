// z28HAT (WP-VERIFY): the ORIGINAL code of the zone's nodes run in the x86 emulation next to the TypeScript port (tools/tests/m7-z28HAT-emu.mjs, docs/re/m6/z28HAT.md section
// "Differential test (WP-VERIFY)").
//
// Native (the executable's own code): the ten node updates (FUN_00797ba0 pepp + pre-render 00797c02, 00796e14 balloon + camera 00796b60 / 00796c0e, 00795770 winch, 00795f80 Bronty with
// 00795ec0, 007955f0 Mr Hates, 00794c26 big dinosaur + 00794a5c / 0079492a / 00794860, 00793c44 baby + 00793b12 / 00793a48, 00793370 fireball, 00792e60 sandbag, 00792ae0 pterodactyl), their
// constructors, the zone's attach function FUN_00791990 (the argument blocks of the dinosaurs are its immediates), the globals reset FUN_007918a0, the sound loads FUN_00792950, the per-tick
// HUD part FUN_007928a0, the .man loader FUN_0043ecd0 (Food.man, from the zone archive), the engine's matrix / vector helpers (FUN_0043a340 / 0043a4a1 / 0043a5e4 / 0043a742 / 0043a9e5 /
// 0043ab72 / 0043ad29 / 0043b00b / 0043cec0 / 0043cfee / 00433450), the terrain ray FUN_0043cd62 / 004425f0, FUN_00441a90, the C runtime.
// Hosted engine services (not the subject): game variables (the port's `GameVars`), animation instances (the port's `AnimInstance`: start / advance / frame / seek; the bone matrices
// FUN_0043bc58 are those of the animation state at the START of the tick = the pose of the last draw), collision (FUN_00441270 -> `CollisionWorld.sweep`, FUN_00441b10 -> `rayRecord`),
// sounds / speech / music fade (recorded), rumble (FUN_00438518 is an empty function), particles (no-ops), random numbers (a scripted integer keyed by tick, record and draw).
// One original pass is run from the same state as one port tick (snapshot / restore around it), like tools/lib/m7-z27TRX-emu.mjs.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';

export const RB = 0x30000000, NB = 0x31000000, CB = 0x32000000, AB = 0x33000000, MB = 0x34000000, GB = 0x35000000, PB = 0x36000000, HB = 0x37000000;
export const NREC = 154;
const NODE_SIZE = 0x100;
const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };
const SENT = 0xbabababa;
const REC_PEPP = 151;

const FLOATS = (n, off) => ({ off, n });

/** node specs: constructor, update address, [offset, label, type, getter(port node)]; types: f float32, f3 three float32, u8 byte, b8 byte-as-boolean, i int32, col collision pointer (null / sentinel = 0) */
const vec = (k) => (n) => n[k];
export const SPEC = {
  pepp: { ctor: 0x797d67, upd: 0x797ba0, pre: 0x797c02, port: 'hatpepp', fields: [[0x14, 'off', 'f3', vec('off')], [0x20, 'fence', 'f3', vec('fence')], [0x2c, 'camDone', 'b32', (n) => n.camDone]] },
  balloon: {
    ctor: 0x79798f, upd: 0x796e14, port: 'hatballoon',
    fields: [[0x1c, 'vel', 'f3', vec('vel')], [0x34, 'speed', 'f', (n) => n.speed], [0x38, 'timer', 'f', (n) => n.timer], [0x7c, 'hits', 'u8', (n) => n.hits], [0x80, 'fade', 'f', (n) => n.fade]],
  },
  winch: { ctor: 0x795da0, upd: 0x795770, port: 'hatwinch', fields: [[0x18, 'len', 'f', (n) => n.len], [0x28, 'heading', 'f', (n) => n.heading]] },
  bronty: {
    ctor: 0x796a05, upd: 0x795f80, port: 'hatbronty',
    fields: [[0x18, 'cur', 'u8', (n) => n.cur], [0x19, 'count', 'u8', (n) => n.count], [0x1a, 'ate', 'u8', (n) => n.ate], [0x1b, 'done', 'b8', (n) => n.done], [0x1c, 'hatesDone', 'b8', (n) => n.hatesDone],
      [0x20, 'rel', 'f', (n) => n.rel], [0x24, 'balD2', 'f', (n) => n.balD2], [0x28, 'frame', 'f', (n) => n.frame]],
  },
  hates: { ctor: 0x7956be, upd: 0x7955f0, port: 'hatmrhates', fields: [] },
  dino: {
    ctor: 0x7953d4, upd: 0x794c26, port: 'hatdino',
    fields: [[0x20, 'reachV', 'f', (n) => n.args.reachV], [0x24, 'reachH', 'f', (n) => n.args.reachH], [0x28, 'hang', 'f', (n) => n.args.hang],
      [0x3c, 'clip0', 'u8', (n) => n.args.clips[0]], [0x3d, 'clip1', 'u8', (n) => n.args.clips[1]], [0x3e, 'clip2', 'u8', (n) => n.args.clips[2]], [0x3f, 'clip3', 'u8', (n) => n.args.clips[3]],
      [0x40, 'clip4', 'u8', (n) => n.args.clips[4]], [0x41, 'clip5', 'u8', (n) => n.args.clips[5]],
      [0x46, 'state', 'u8', (n) => n.state], [0x47, 'animDone', 'b8', (n) => n.animDone], [0x48, 'counted', 'b8', (n) => n.counted], [0x58, 'walking', 'b8', (n) => n.walking],
      [0x5c, 'frame', 'f', (n) => n.frame], [0x6c, 'vanishTimer', 'f', (n) => n.vanishTimer], [0x4c, 'balD2', 'f', (n) => n.balD2], [0x50, 'savedCol', 'col', (n) => n.savedCol]],
  },
  baby: {
    ctor: 0x794679, upd: 0x793c44, port: 'hatbaby',
    fields: [[0x20, 'reachV', 'f', (n) => n.args.reachV], [0x24, 'reachH', 'f', (n) => n.args.reachH], [0x28, 'hang', 'f', (n) => n.args.hang],
      [0x3e, 'state', 'u8', (n) => n.state], [0x3f, 'animDone', 'b8', (n) => n.animDone], [0x40, 'counted', 'b8', (n) => n.counted], [0x42, 'animate', 'b8', (n) => n.animate],
      [0x54, 'vanishTimer', 'f', (n) => n.vanishTimer], [0x44, 'balD2', 'f', (n) => n.balD2], [0x48, 'savedCol', 'col', (n) => n.savedCol]],
  },
  fireball: {
    ctor: 0x793867, upd: 0x793370, port: 'hatfireball',
    fields: [[0x18, 'active', 'b8', (n) => n.active], [0x1c, 't', 'f', (n) => n.t], [0x20, 'v', 'f3', vec('v')], [0x2c, 'start', 'f3', vec('start')]],
  },
  sandbag: { ctor: 0x7932b6, upd: 0x792e60, port: 'hatsandbag', fields: [[0x18, 'active', 'b8', (n) => n.active]] },
  ptera: { ctor: 0x792d38, upd: 0x792ae0, port: 'hatptera', fields: [[0x18, 'heading', 'f', (n) => n.heading], [0x1c, 't', 'f', (n) => n.t]] },
};
export const KIND_OF_PORT = Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [s.port, k]));
const KIND_OF_CTOR = Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [s.ctor, k]));

export function readField(mem, p, [off, , t]) {
  const a = p + off;
  switch (t) {
    case 'f': return mem.f32(a);
    case 'f3': return [mem.f32(a), mem.f32(a + 4), mem.f32(a + 8)];
    case 'u8': return mem.r8(a);
    case 'b8': return mem.r8(a) !== 0 ? 1 : 0;
    case 'b32': return mem.r32(a) !== 0 ? 1 : 0;
    case 'i': return mem.r32(a);
    case 'col': { const v = mem.u32(a); return v === 0 || v === SENT ? 0 : 1; }
    default: throw new Error(`field type ${t}`);
  }
}
export function writeField(mem, p, [off, , t], v, colPtr) {
  const a = p + off;
  switch (t) {
    case 'f': mem.wf32(a, v); break;
    case 'f3': for (let i = 0; i < 3; i++) mem.wf32(a + 4 * i, v[i]); break;
    case 'u8': mem.w8(a, v & 0xff); break;
    case 'b8': mem.w8(a, v ? 1 : 0); break;
    case 'b32': mem.w32(a, v ? 1 : 0); break;
    case 'i': mem.w32(a, v | 0); break;
    case 'col': mem.w32(a, v ? colPtr : SENT); break;
  }
}
export function portValue(n, [, , t, get]) {
  const v = get(n);
  if (t === 'b8' || t === 'b32') return v ? 1 : 0;
  if (t === 'col') return v ? 1 : 0;
  if (t === 'f3') return [v[0], v[1], v[2]];
  return v;
}

/** the zone's globals (DAT_05d5d2e4 .. 05d5d3c4) and HatShared fields */
const GL = [
  [0x5d5d2e8, 'mom', 'f3'], [0x5d5d320, 'push', 'f3'], [0x5d5d2d8, 'nest', 'f3'],
  [0x5d5d304, 'carrying', 'b8'], [0x5d5d30c, 'delivered', 'u8'], [0x5d5d310, 'score', 'i'], [0x5d5d32d, 'allDone', 'b8'], [0x5d5d2cc, 'result', 'i'],
  [0x5d5d2e4, 'eatCount', 'u8'], [0x5d5d316, 'fireballHit', 'b8'], [0x5d5d2f4, 'stegSpeech', 'u8'], [0x5d5d32c, 'tricSpeech', 'u8'], [0x5d5d3c0, 'winchLast', 'i'], [0x5d5d3c4, 'brontyVar', 'i'],
];

export function createHatHarness(ctx, G) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;     // the original runs the x87 in 24-bit precision (Direct3D 7 leaves single precision): every + - * / sqrt rounds to float32
  const mem = cpu.mem;
  for (const [lo, n] of [[RB, NREC * 0x68], [NB, NREC * NODE_SIZE + 0x1000], [CB, NREC * 0x80], [AB, NREC * 0x40], [MB, 0x10000], [GB, 0x10000], [PB, NREC * 0x1000], [HB, 0x100000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  const w = G.w, rs = w.records;
  const H = { cpu, mem, G, pe, log: [], fx: [], handles: new Map(), tokens: new Map(), unhooked: new Set(), draws: [], attaches: [], nodeAlloc: 0, heap: HB, ctrlCreated: [], files: new Map(), sweeps: 0, rays: 0 };
  const recPtr = (r) => (r ? RB + r.index * 0x68 : 0);
  const recOf = (ptr) => (ptr === 0 ? null : rs[(ptr - RB) / 0x68]);
  const push = (e) => H.log.push(e);
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  const idOf = (h) => H.handles.get(h)?.id;
  const COLP = (i) => 0x0c000000 + i;

  // ---- sounds
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '2d' }); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '3d' }); c.eax = h; });
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  hook(0x4435a0, (c) => { push(['2d', idOf(c.arg(0))]); });
  hook(0x4435b0, (c) => { push(['stop', idOf(c.arg(0))]); });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['3d', idOf(c.arg(0)), f32(mem.f32(p)), f32(mem.f32(p + 4)), f32(mem.f32(p + 8))]); });
  hook(0x4434b0, (c) => { push(['stop', idOf(c.arg(0))]); });
  hook(0x438518, () => {});                   // an empty function in this build
  hook(0x873e13, (c) => { push(['fade', f32(c.argf(0))]); });
  // speech: FUN_00439bf8(table, "ID", &token) + FUN_00435a11(token, token | -1)
  hook(0x439bf8, (c) => { const tok = 0x7000 + H.tokens.size; H.tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { const a = H.tokens.get(c.arg(0)), b = c.arg(1) === 0xffffffff ? null : H.tokens.get(c.arg(1)); push(['say', a, b]); });
  // particles / overlays / camera helpers of the draw path: no-ops
  for (const a of [0x442a20, 0x442a00, 0x444480, 0x46055f, 0x44ec30]) hook(a, () => { H.fx.push(a); });
  hook(0x442960, () => { cpu.eax = 0x7777; });
  // walker / waypoint set-up of FUN_00791990 (Pepper's and Mr Hates' path followers: not read by the nodes)
  hook(0x462d4f, () => { cpu.eax = 0x6666; });
  for (const a of [0x462206, 0x461ad6, 0x462324, 0x4623aa, 0x4623cd, 0x462436, 0x461fe4, 0x461f42, 0x43f160, 0x444530, 0x444550, 0x4238b7]) hook(a, () => {});
  hook(0x43f160, () => { cpu.eax = 0; });
  hook(0x43eaf0, (c) => { c.eax = 0x0e000000 + c.arg(1); });
  hook(0x43e870, () => {}); hook(0x43ec10, () => {}); hook(0x43e930, () => {}); hook(0x43f1d0, () => {});
  // game variables
  hook(0x417575, (c) => { c.eax = w.vars.get(c.arg(0)); });
  hook(0x417597, (c) => { w.vars.set(c.arg(0), c.arg(1) | 0); });
  hook(0x41761b, (c) => { w.vars.or(c.arg(0), c.arg(1) | 0); });
  hook(0x41766c, (c) => { w.vars.andNot(c.arg(0), c.arg(1) | 0); });
  // random numbers: FUN_004388ae(max) = rand / 32767 * max with the test's integer rand
  hook(0x85daf0, () => { const r = G.rk.draw(); H.draws.push(r); cpu.eax = r; });     // FUN_004388ae itself runs natively
  // animation instances (the port's AnimInstance of the record: AB + index * 0x40)
  const animOf = (ptr) => rs[(ptr - AB) / 0x40].anim;
  hook(0x43b6a3, (c) => { c.eax = animOf(c.arg(0)).start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; });
  hook(0x43b76a, (c) => { c.eax = animOf(c.arg(0)).advance(c.argf(1), w.dt); });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  // bone matrix FUN_0043bc58(anim, bone): the pose buffer the last draw left (written at the start of the pass from the animation state of that moment)
  hook(0x43bc58, (c) => { const i = (c.arg(0) - AB) / 0x40; c.eax = PB + i * 0x1000 + c.arg(1) * 0x40; });
  // the controller's first node (FUN_004239d9) is not used here; alloc: the node block of the record being constructed, then a bump heap (the .man loader)
  hook(0x433d38, (c) => {
    const size = c.arg(0);
    let p;
    if (H.nodeAlloc) { p = H.nodeAlloc; H.nodeAlloc = 0; for (let o = 0; o < size; o++) mem.w8(p + o, 0xcd); }
    else { p = H.heap; H.heap += (size + 15) & ~15; for (let o = 0; o < size; o++) mem.w8(p + o, 0xcd); }
    c.eax = p;
  });
  hook(0x433d60, () => {});
  hook(0x43ecb0, () => {});
  // files (the .man loader): FUN_00435843(path, mode, ...) -> handle, FUN_00435350(buf, size, count, handle), FUN_004358e9(handle, ...)
  hook(0x435843, (c) => {
    const path = mem.cstr(c.arg(0)).replace(/\\/g, '/'), arch = G.arch, e = arch.find(path.slice(path.toLowerCase().indexOf('matanim/')));
    if (!e) { c.eax = 0; return; }
    const h = 0x9000 + H.files.size; H.files.set(h, { data: arch.read(e), pos: 0 }); c.eax = h;
  });
  hook(0x435350, (c) => { const f = H.files.get(c.arg(3)), n = c.arg(1) * c.arg(2), b = f.data.subarray(f.pos, f.pos + n); mem.write(c.arg(0), b); f.pos += n; c.eax = c.arg(2); });
  hook(0x4358e9, () => {});
  // collision: FUN_00441270(ignore, from, delta, outNormal, outPoint, mask, radius, skin) over the port's world; the records the nodes before this one moved are in emulated memory
  const dirty = new Set();
  H.dirty = dirty;
  const syncRecs = () => {
    for (const i of dirty) {
      const r = rs[i], p = recPtr(r);
      for (let k = 0; k < 16; k++) r.m[k] = mem.f32(p + 0xc + 4 * k);
      r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60);
      const v = mem.u32(p + 0x58);
      r.colObj = v === 0 || v === SENT ? null : G.cols[i];
    }
  };
  hook(0x441270, (c) => {
    syncRecs();
    const ig = recOf(c.arg(0)), f = [0, 1, 2].map((i) => mem.f32(c.arg(1) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(c.arg(2) + 4 * i));
    const h = w.col.sweep(ig, f, d, c.arg(5), c.argf(6), c.argf(7));
    H.sweeps++;
    if (!h) { c.eax = 0; return; }
    for (let i = 0; i < 3; i++) { mem.wf32(c.arg(3) + 4 * i, h.normal[i]); mem.wf32(c.arg(4) + 4 * i, h.point[i]); }
    c.eax = recPtr(h.rec);
  });
  hook(0x441b10, (c) => {
    syncRecs();
    const rec = recOf(c.arg(0)), s = c.arg(1);
    const f = [0, 1, 2].map((i) => mem.f32(mem.u32(s) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(mem.u32(s + 4) + 4 * i));
    const h = w.col.rayRecord(rec, f, d, mem.u32(s + 16), mem.f32(s + 20), mem.f32(s + 24));
    H.rays++;
    if (!h) { c.eax = 0; return; }
    for (let i = 0; i < 3; i++) { mem.wf32(mem.u32(s + 8) + 4 * i, h.normal[i]); mem.wf32(mem.u32(s + 12) + 4 * i, h.point[i]); }
    c.eax = 1;
  });
  // atan2 of the CRT loads an 80-bit constant (not modelled): hosted from Math; the CRT's cos / sin / fabs run natively
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  // the controller services used by FUN_00791990
  hook(0x4237b6, (c) => { mem.w32(0x8adc74, c.arg(0)); });
  hook(0x42382c, (c) => { const rp = c.arg(0), r = recOf(rp); if (mem.r32(0x8adc74) === 0) return; mem.w32(rp + 0x5c, CB + r.index * 0x80); mem.w32(CB + r.index * 0x80, 0); mem.w32(CB + r.index * 0x80 + 0x10, 0); H.ctrlCreated.push(r.index); });
  hook(0x423532, (c) => {
    const rp = c.arg(0), r = recOf(rp), args = c.arg(2);
    H.attaches.push({ rec: r.index, ctor: c.arg(1), argsBytes: args >= 0x10000 && mem.mapped(args) ? mem.read(args, 0x20) : null, pos: c.arg(3) | 0, var: c.arg(4) | 0, mask: c.arg(5) & 0xffff, value: c.arg(6) & 0xffff });
  });
  hook(0x4425e0, (c) => { mem.w32(0x9dec18, c.arg(0)); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  cpu.exec = [[0x790000, 0x7a0000], [0x858d30, 0x873e00], [0x43a340, 0x43b100], [0x43cd62, 0x43cd9a], [0x43cec0, 0x43d100], [0x4425f0, 0x442680], [0x441a90, 0x441ac0], [0x433450, 0x4334e0], [0x43ecd0, 0x43ee00], [0x4388ae, 0x4388e7]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z28HAT emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt?.toString(16)} (frames ${cpu.frames.slice(-4).map((f) => f.toString(16))})`); };
  cpu.invalidate();

  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; };
  H.reset();
  cpu.call(0x792950, []);          // the sound loads: every DAT_05d5d3xx gets a handle
  // the roar handle of a sound id (the dinosaurs' argument blocks hold DAT_05d5d37c / 05d5d38c)
  /** the .man loader FUN_0043ecd0 on the zone's Food.man (Bronty's pizza path): the pointer the node holds at +0x14 */
  H.loadFood = () => {
    const str = '\\Data\\z28HAT\\matanim\\Food.man';
    for (let i = 0; i < str.length; i++) mem.w8(MB + 0x8000 + i, str.charCodeAt(i)); mem.w8(MB + 0x8000 + str.length, 0);
    H.reset();
    H.foodPtr = cpu.call(0x43ecd0, [MB + 0x8000]) >>> 0;
    return H.foodPtr;
  };
  H.handleOf = (id) => { for (const [h, d] of H.handles) if (d.id === id && d.kind === '3d') return h; return 0; };

  // ---- mirrors
  H.mirrored = false;
  H.mirrorRecords = (all = false) => {
    mem.whi = 0; mem.wlo = 0;
    mem.w32(0x983804, RB); mem.w32(0x983800, rs.length);
    for (const a of [0x983838, 0x983814, 0x98381c, 0x983824, 0x98382c]) mem.w32(a, GB);       // the builders' model tables (zeroed: their calls are hosted no-ops)
    if (!H.mirrored) { all = true; H.mirrored = true; }
    for (const r of (all ? rs : G.mut)) {
      const p = recPtr(r);
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, 0);
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, r.colObj ? COLP(r.index) : SENT);
      mem.w32(p + 0x5c, r.ctrl ? CB + r.index * 0x80 : 0);
      mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
      if (r.ctrl) mem.w32(CB + r.index * 0x80, NB + r.index * NODE_SIZE);
      if (r.anim) mem.w32(AB + r.index * 0x40 + 8, 1);
    }
    mem.w32(0x9dec18, recPtr(w.col.groundRec));
    dirty.clear();
    mem.wlo = RB; mem.whi = RB + rs.length * 0x68; mem.onWrite = (a) => { dirty.add(Math.floor((a - RB) / 0x68)); };
  };
  H.readRec = (r) => {
    const p = recPtr(r);
    const v = mem.u32(p + 0x58);
    return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60), col: v === 0 || v === SENT ? 0 : 1, variant: mem.r32(p + 0x64) };
  };
  H.mirrorNode = (kind, n, r) => {
    const sp = SPEC[kind], p = NB + r.index * NODE_SIZE;
    for (let o = 0; o < 0x80; o += 4) mem.w32(p + o, 0);
    mem.w32(p, n.var); mem.w16(p + 0xc, n.mask); mem.w16(p + 0xe, n.value);
    for (const f of sp.fields) writeField(mem, p, f, portValue(n, f), COLP(65));
    if (kind === 'dino') mem.w32(p + 0x60, H.handleOf(G.soundIdOf(n.args.roar)));
    if (kind === 'bronty') { mem.w32(p + 0x14, H.foodPtr ?? 0); }
    return p;
  };
  H.readNode = (kind, p) => { const o = {}; for (const f of SPEC[kind].fields) o[f[1]] = readField(mem, p, f); if (kind === 'dino') o.roar = idOf(mem.u32(p + 0x60)); return o; };
  /** the fields of a freshly allocated node that its constructor left uninitialised (0xcd bytes of the debug heap) */
  H.uninit = (kind, p) => {
    const out = new Set();
    for (const [off, name, t] of SPEC[kind].fields) {
      const size = t === 'f3' ? 12 : t === 'u8' || t === 'b8' ? 1 : 4;
      let all = true; for (let i = 0; i < size; i++) if (mem.r8(p + off + i) !== 0xcd) all = false;
      if (all) out.add(name);
    }
    return out;
  };
  H.portNode = (kind, n) => { const o = {}; for (const f of SPEC[kind].fields) o[f[1]] = portValue(n, f); if (kind === 'dino') o.roar = G.soundIdOf(n.args.roar); return o; };
  const camAt = 0x9da5e8;
  H.mirrorGlobals = () => {
    const S = G.S;
    for (const [a, name, t] of GL) writeField(mem, 0, [a, name, t], S[name]);
    mem.w32(0x94000c, S.total);
    mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);
    for (let i = 0; i < 18; i++) mem.wf32(camAt + 4 * i, w.camera.c[i]);
    // the pose buffers of the last draw: the animation state at the start of the pass (the original reads them through FUN_0043bc58)
    for (const r of rs) if (r.anim && r.index === 8) {
      const pose = r.anim.pose(1);
      if (pose) for (let i = 0; i < pose.length; i++) mem.wf32(PB + r.index * 0x1000 + 4 * i, pose[i]);
    }
    mem.w32(0x983848, 0); mem.w32(0x98384c, 0); mem.w32(0x983850, 0);     // the stick values (FUN_004376f9 zeroes them: only the digital bits act)
  };
  H.readGlobals = () => { const o = {}; for (const [a, name, t] of GL) o[name] = readField(mem, 0, [a, name, t]); o.text = mem.cstr(0x5d4dd60, 24); o.left = mem.cstr(0x5d4dd44, 24); o.icon = mem.r32(0x5d4dd14); return o; };
  H.readCamera = () => Array.from({ length: 6 }, (_, i) => mem.f32(camAt + 4 * i));
  H.portGlobals = () => { const S = G.S, o = {}; for (const [, name, t] of GL) o[name] = t === 'f3' ? [...S[name]] : t === 'b8' ? (S[name] ? 1 : 0) : S[name]; return o; };

  H.nodeList = () => {
    const out = [];
    for (const r of rs) {
      const c = r.ctrl;
      if (!c || !c.enabled) continue;
      for (const n of c.nodes) { const kind = KIND_OF_PORT[n.kind]; if (kind) out.push([r, n, kind]); }
    }
    return out;
  };

  H.cov = null;
  /** one update pass of the original from the port's current state: every record's node in record order, the pre-render of the nodes that have one, then the loop's HUD part FUN_007928a0 */
  H.emuPass = (held, prevHeld, free = false) => {
    H.reset();
    H.log.length = 0; H.fx.length = 0; H.draws.length = 0; H.sweeps = 0; H.rays = 0;
    if (!free) { H.mirrorRecords(); H.mirrorGlobals(); }
    else {
      // free-running mode: the records / nodes / globals live in emulated memory; only the clock, the input and the pose buffers of the last draw are put in
      dirty.clear(); mem.wlo = RB; mem.whi = RB + rs.length * 0x68; mem.onWrite = (a) => { dirty.add(Math.floor((a - RB) / 0x68)); };
      mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);
      const b = rs[8]; const pose = b.anim?.pose(1); if (pose) for (let i = 0; i < pose.length; i++) mem.wf32(PB + 8 * 0x1000 + 4 * i, pose[i]);
    }
    mem.w32(0x98383c, held >>> 0); mem.w32(0x983840, (held & ~prevHeld) >>> 0);
    const perNode = new Map(), ran = [];
    for (const r of rs) {
      const c = r.ctrl;
      if (!c || !c.enabled) continue;
      for (const n of c.nodes) {
        const kind = KIND_OF_PORT[n.kind];
        if (!kind) continue;
        if (!w.vars.gate(n.var, n.mask, n.value)) continue;
        const p = free ? NB + r.index * NODE_SIZE : H.mirrorNode(kind, n, r);
        G.rk.begin(r.index);
        const d0 = H.draws.length;
        cpu.steps = 0;
        try { cpu.call(SPEC[kind].upd, [recPtr(r), p], { maxSteps: 3000000, trace: H.cov ? (cc, at) => H.cov.add(at) : undefined }); }
        catch (e) { e.message += ` [record ${r.index} ${r.name} ${kind}]`; throw e; }
        perNode.set(n, { kind, p, draws: H.draws.length - d0, rec: r.index });
        ran.push([r, p, kind]);
        break;
      }
    }
    // the pre-render pass (FUN_004225c5): Pepper takes the balloon's matrix
    for (const [r, p, kind] of ran) if (SPEC[kind].pre) cpu.call(SPEC[kind].pre, [recPtr(r), p], { maxSteps: 1000000, trace: H.cov ? (cc, at) => H.cov.add(at) : undefined });
    // the loop's per-tick part of mode 2
    cpu.call(0x7928a0, [], { trace: H.cov ? (cc, at) => H.cov.add(at) : undefined });
    for (const o of perNode.values()) o.state = H.readNode(o.kind, o.p);
    return { recs: rs.map((r) => (dirty.has(r.index) ? H.readRec(r) : null)), globals: H.readGlobals(), camera: H.readCamera(), log: H.log.slice(), perNode, draws: H.draws.length, steps: cpu.steps };
  };

  /** free-running mode: the original's record state (read from emulated memory) into the world, so the collision queries and the hosted services see it */
  H.readBack = (out) => {
    for (let i = 0; i < rs.length; i++) {
      const b = out.recs[i]; if (!b) continue;
      const r = rs[i];
      for (let k = 0; k < 16; k++) r.m[k] = b.m[k];
      r.rx = b.e[0]; r.ry = b.e[1]; r.rz = b.e[2]; r.flags = (r.flags & ~0xffff) | b.flags; r.variant = b.variant; r.colObj = b.col ? G.cols[i] : null;
    }
  };
  /**
   * The original's set-up of the zone: FUN_007918a0 (the globals reset) and FUN_00791990(1) (the attaches; the constructors allocate their nodes and read the argument blocks the function builds
   * on its stack), the deferred constructors run here in the order of the attach calls.
   */
  H.emuInit = () => {
    H.reset();
    H.log.length = 0; H.fx.length = 0; H.attaches.length = 0; H.ctrlCreated.length = 0;
    H.mirrorRecords(true); H.mirrorGlobals();
    mem.w32(0x8adc74, 1);
    cpu.call(0x7918a0, []);
    cpu.steps = 0;
    cpu.call(0x791990, [1], { maxSteps: 5000000 });
    const out = { attaches: [], nodes: new Map(), ctrlCreated: H.ctrlCreated.slice(), unknown: [] };
    let scratch = MB + 0x2000;
    for (const a of H.attaches) {
      const kind = KIND_OF_CTOR[a.ctor];
      if (!kind) { out.unknown.push([a.rec, a.ctor]); continue; }
      const argp = scratch; scratch += 0x40;
      if (a.argsBytes) mem.write(argp, a.argsBytes);
      const np = NB + a.rec * NODE_SIZE;
      H.nodeAlloc = np;
      cpu.steps = 0;
      cpu.call(a.ctor, [RB + a.rec * 0x68, argp, 0, a.var, a.mask, a.value], { maxSteps: 3000000 });
      mem.w32(CB + a.rec * 0x80, np);
      out.attaches.push({ rec: a.rec, ctor: a.ctor, kind, np, var: a.var, mask: a.mask, value: a.value });
      out.nodes.set(a.rec, { kind, state: H.readNode(kind, np), uninit: H.uninit(kind, np) });
    }
    out.recs = rs.map(H.readRec);
    out.globals = H.readGlobals();
    out.camera = H.readCamera();
    out.log = H.log.slice();
    return out;
  };
  /** the loop's end banner FUN_00790c19 for a score: the text calls, the speech, the hi-score variable, the medal flag */
  H.text = [];
  hook(0x460a3d, () => {}); hook(0x435b07, () => {});
  hook(0x439c6f, (c) => { H.text.push({ table: c.arg(0) === mem.u32(0x5d5d330) ? 'hat' : c.arg(0) === mem.u32(0x983a14) ? 'std' : c.arg(0), text: mem.cstr(c.arg(2)), mode: c.arg(3), x: c.arg(5) & 0xffff, y: c.arg(6) & 0xffff, wrap: c.arg(7) & 0xff }); });
  H.banner = (score, hi) => {
    mem.w32(0x5d5d330, 0x1111); mem.w32(0x983a14, 0x2222); mem.w32(0x5d5d338, 0x3333);
    const old = w.vars.get(0x4a); w.vars.set(0x4a, hi);
    mem.w32(0x5d5d310, score); mem.w32(0x5d5d2d0, 0); mem.w8(0x5d5d314, 0);
    H.text.length = 0; H.log.length = 0; H.reset();
    cpu.call(0x790c19, []);
    const res = { text: H.text.slice(), log: H.log.slice(), medal: mem.r8(0x5d5d314), hi: w.vars.get(0x4a), spoken: mem.r32(0x5d5d2d0) };
    w.vars.set(0x4a, old);
    return res;
  };
  /** FUN_00797e90 alone (the zone's record reset, what the loop runs before a restart): the records as it leaves them */
  H.emuReset = () => {
    H.reset();
    H.mirrorRecords(true); H.mirrorGlobals();
    cpu.steps = 0;
    cpu.call(0x797e90, [], { maxSteps: 5000000 });
    return rs.map(H.readRec);
  };
  /** the restart sequence of the loop (FUN_00792868 = FUN_00797e90 + FUN_00791990(0) + FUN_0044ec30, then FUN_007918a0), from the state the port has: game variables and the winch's copy are NOT touched */
  H.emuRestart = () => {
    H.reset();
    H.attaches.length = 0;
    H.mirrorRecords(true); H.mirrorGlobals();
    mem.w32(0x8adc74, 1);
    for (const i of [REC_PEPP, 153, 8, 65, 7, 9, 14, 11, 12, 15, 13, 10, 17, 18, 19, 20, 22, 76, 77, 78, 16]) { mem.w32(RB + i * 0x68 + 0x5c, CB + i * 0x80); mem.w32(CB + i * 0x80, NB + i * NODE_SIZE); }
    cpu.steps = 0;
    cpu.call(0x792868, [], { maxSteps: 5000000 });
    const second = H.attaches.slice(); H.attaches.length = 0;
    let scratch = MB + 0x4000;
    for (const a of second) {
      const kind = KIND_OF_CTOR[a.ctor]; if (!kind) continue;
      const argp = scratch; scratch += 0x40; if (a.argsBytes) mem.write(argp, a.argsBytes);
      cpu.call(a.ctor, [RB + a.rec * 0x68, argp, NB + a.rec * NODE_SIZE, a.var, a.mask, a.value], { maxSteps: 3000000 });
    }
    cpu.call(0x7918a0, []);
    return { recs: rs.map(H.readRec), globals: H.readGlobals(), attaches: second.length };
  };
  // ---- the balloon's shadow draw hook FUN_00796d72 (src/zones/z28hat/shadow.ts): run natively on the mirrored records; the engine calls are captured, FUN_0043ebe0(model, 2, points, 0) with the 15 dwords
  // at balloon record + 0x40 (the record array is followed by the sentinel 0xbadfebad of FUN_00433cfe and the debug CRT's 4 guard bytes 0xfd; the heap's padding / next entry header words are free: `pad`)
  H.shadowRun = (idx = 153, pad = {}) => {
    H.mirrorRecords(true);
    const end = RB + NREC * 0x68, bp = RB + idx * 0x68;
    mem.w32(end, 0xbadfebad); mem.w32(end + 4, 0xfdfdfdfd); mem.w32(end + 8, pad.w12 ?? 0); mem.w32(end + 12, pad.w13 ?? 0x07d80000); mem.w32(end + 16, pad.w14 ?? 0x00000001);
    mem.w32(bp + 0x58, pad.col ?? 0x00c81230); mem.w32(bp + 0x5c, pad.ctrl ?? 0x00c9a410);      // heap addresses of the collision object / the controller
    let cap = null;
    hook(0x40ccce, () => { cpu.eax = 0; }); hook(0x40cc4d, () => {});
    hook(0x43ebe0, (c) => { cap = { model: c.arg(0), mode: c.arg(1), ptr: c.arg(2), arg4: c.arg(3), words: Array.from({ length: 15 }, (_, i) => mem.u32(c.arg(2) + 4 * i)) }; });
    cpu.invalidate();
    cpu.steps = 0; H.fx.length = 0;
    cpu.call(0x796d72, [bp, 0], { maxSteps: 100000 });
    return { cap, flags80: mem.r16(RB + 80 * 0x68 + 0x60), fx: H.fx.slice(), ptrOk: cap ? cap.ptr === bp + 0x40 : false };
  };
  return H;
}

/** snapshot / restore of everything one tick of the port changes (records incl. the collision object, nodes, shared state, variables, anims, camera) */
export function snapshotWorld(G) {
  const { w, S } = G, rs = w.records, mut = G.mut;
  const nodes = [];
  for (const r of mut) for (const n of r.ctrl?.nodes ?? []) {
    const o = {};
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'number' || typeof v === 'boolean' || v === null) o[k] = v;
      else if (Array.isArray(v)) o[k] = v.slice();
      else if (v && typeof v === 'object' && ('colObj' in v || 'sweep' in v || 'tracks' in v)) o[k] = v;      // collision objects / .man data are shared, not copied
      else if (v && typeof v === 'object' && 'index' in v) o[k] = v;
    }
    o.__col = n.savedCol;
    nodes.push([n, o]);
  }
  const sh = {};
  for (const [k, v] of Object.entries(S)) {
    if (typeof v === 'number' || typeof v === 'boolean') sh[k] = v;
    else if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'number')) sh[k] = v.slice();
  }
  return {
    vars: w.vars.a.slice(), tickCount: w.tickCount, frame: w.frame, spoken: S.spoken.length, sh, nodes,
    recs: mut.map((r) => ({ i: r.index, m: new Float32Array(r.m), prev: new Float32Array(r.prev), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags, colObj: r.colObj, variant: r.variant, face: r.face, anim: r.anim ? { clip: r.anim.clip, frame: r.anim.frame, prevFrame: r.anim.prevFrame, prevClip: r.anim.prevClip } : null })),
    cam: { c: new Float64Array(w.camera.c), prev: new Float64Array(w.camera.prev), vel: w.camera.vel },
  };
}
export function restoreWorld(G, s) {
  const { w, S } = G, rs = w.records;
  w.vars.a.set(s.vars); w.tickCount = s.tickCount; w.frame = s.frame;
  s.recs.forEach((q) => { const r = rs[q.i]; r.m.set(q.m); r.prev.set(q.prev); r.rx = q.rx; r.ry = q.ry; r.rz = q.rz; r.flags = q.flags; r.colObj = q.colObj; r.variant = q.variant; r.face = q.face; if (q.anim) Object.assign(r.anim, q.anim); });
  for (const [n, o] of s.nodes) { for (const [k, v] of Object.entries(o)) { if (k === '__col') continue; n[k] = Array.isArray(v) ? v.slice() : v; } n.savedCol = o.__col; }
  for (const [k, v] of Object.entries(s.sh)) S[k] = Array.isArray(v) ? v.slice() : v;
  S.spoken.length = s.spoken;
  w.camera.c.set(s.cam.c); w.camera.prev.set(s.cam.prev); w.camera.vel = s.cam.vel;
}

/** the original stores float32: the port's doubles are rounded to float32 at the start of a tick so both sides get the very same inputs */
export function quantize(G) {
  const { w, S } = G;
  const q = (o, k) => { if (typeof o[k] === 'number') o[k] = f32(o[k]); else if (Array.isArray(o[k])) for (let i = 0; i < o[k].length; i++) if (typeof o[k][i] === 'number') o[k][i] = f32(o[k][i]); };
  for (const r of G.mut) {
    for (const k of ['rx', 'ry', 'rz']) q(r, k);
    if (r.anim) q(r.anim, 'frame');
    for (const n of r.ctrl?.nodes ?? []) for (const k of Object.keys(n)) if (typeof n[k] === 'number' && !['var', 'mask', 'value', 'stamp', 'hits'].includes(k)) q(n, k); else if (Array.isArray(n[k]) && k !== 'args') q(n, k);
  }
  for (const k of ['mom', 'push', 'nest']) q(S, k);
  q(S, 'fade');
  for (let i = 0; i < 18; i++) w.camera.c[i] = f32(w.camera.c[i]);
}
