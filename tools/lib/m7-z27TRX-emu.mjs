// z27TRX (WP-VERIFY): the ORIGINAL code of the zone's nodes run in the x86 emulation next to the TypeScript port (tools/tests/m7-z27TRX-emu.mjs, docs/re/m6/z27TRX.md section
// "Differential test (WP-VERIFY)").
//
// Native (the executable's own code): the rex node FUN_0076a39b with its phases FUN_00768510 / 00769cb0 / 00769d6e / 0076a05c, the probes FUN_007692a1 / 007698cf, the footsteps
// FUN_00769b26, the rider copy FUN_0076a194, the cameras FUN_0076ab5e / 0076ac33, the rumble FUN_00769200 / 00769859 / 0076ab2b, the prop updates (gate 00766ef0, egg 007670e0 +
// 00767295, log 007674c0 + 007676ea, volcano 0076776f, boulder 00767a80, brontosaurus 00767e70, spectators 00768330, fly 007680c0), every constructor (FUN_0076adc5 ... 0076847b),
// the zone's record loop FUN_0076649a (attach by record name, flag changes), the sound loads FUN_00766060, the matrix builders FUN_0043a4a1 / 0043a5e4, the ground probe
// FUN_0043ce45 / 004425f0, the sprintf of the HUD text and the C runtime.
// Hosted engine services (the subject is the zone code, not these): game variables (the port's `GameVars`), animation instances (the port's own `AnimInstance`: start / advance /
// frame / clip / seek / 'near the end' FUN_0043b92a), collision (FUN_00441270 -> `CollisionWorld.sweep`, FUN_00441b10 -> `CollisionWorld.rayRecord`; FUN_00441a90 and FUN_004425f0 /
// FUN_0043ce45 run natively over them), sounds (a log; the 'is playing' state is the test's), speech, rumble, particles (no-ops, not ported), random numbers (a scripted
// integer per (tick, record, draw), FUN_00435c91 = 32767 so that `ftol(rand / 32767 * tick) % n` is the raw integer % n).
// One original pass is run from the same state as one port tick: the port's own objects are the shared state (snapshot / restore around the original pass).
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';

export const RB = 0x30000000, NB = 0x31000000, CB = 0x32000000, AB = 0x33000000, MB = 0x34000000, GB = 0x35000000;
export const NREC = 337;
const NODE_SIZE = 0x100;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export const f32 = (v) => { F32[0] = v; return F32[0]; };

/** node specs: update address, size, fields [offset, name (port node field), type] */
export const SPEC = {
  trex: {
    ctor: 0x76adc5, upd: 0x76a39b, size: 0xe0, port: 'trex',
    fields: [[0x14, 'minSpeed', 'f'], [0x18, 'maxSpeed', 'f'], [0x24, 'accel', 'f'], [0x28, 'laneRate', 'f'], [0x2c, 'baseX', 'f'], [0x3c, 'clock', 'f'], [0x40, 'jumpV', 'f'], [0x44, 'jumpG', 'f'],
      [0x48, 'jumpBase', 'f'], [0x4c, 'jumpY', 'f'], [0x50, 'jumping', 'b'], [0x54, 'jumpTime', 'f'], [0x58, 'stunned', 'b'], [0x5c, 'burning', 'b'], [0x60, 'speed', 'f'], [0x64, 'prevHeld', 'u'],
      [0x68, 'camZ', 'f'], [0x6c, 'z', 'f'], [0x70, 'offset', 'f'], [0x74, 'lane', 'f'], [0x78, 'prevLane', 'f'], [0xb8, 'blink', 'i'], [0xbc, 'blinkT', 'f'], [0xc0, 'hits', 'i'],
      [0xc8, 'rumbleOn', 'b'], [0xcc, 'rumbleT', 'f'], [0xd0, 'rumbleS', 'i'], [0xd4, 'roarToggle', 'i'], [0xd8, 'bridgeSpoken', 'b'], [0xdc, 'stepState', 'u8']],
  },
  gate: { ctor: 0x767023, upd: 0x766ef0, size: 0x20, port: 'trx-gate', fields: [[0x1c, 'angle', 'f']] },
  volc: { ctor: 0x7679e2, upd: 0x76776f, size: 0x1c, port: 'trx-volc', fields: [[0x14, 'reach', 'f'], [0x18, 'done', 'b']] },
  slog: { ctor: 0x767666, upd: 0x7674c0, size: 0x44, port: 'trx-slog', fields: [[0x40, 'phase', 'f']] },
  bldr: {
    ctor: 0x767d2e, upd: 0x767a80, size: 0x48, port: 'trx-bldr',
    fields: [[0x14, 'ground', 'f'], [0x28, 'state', 'i'], [0x2c, 'owner', 'b'], [0x30, 'px', 'f'], [0x34, 'py', 'f'], [0x38, 'pz', 'f'], [0x3c, 'vx', 'f'], [0x40, 'vy', 'f'], [0x44, 'vz', 'f']],
  },
  egg: { ctor: 0x767386, upd: 0x7670e0, size: 0x40, port: 'trx-egg', fields: [[0x14, 'ground', 'f'], [0x34, 'state', 'i'], [0x38, 'y', 'f'], [0x3c, 'vy', 'f']] },
  bronty: { ctor: 0x768015, upd: 0x767e70, size: 0x1c, port: 'trx-bronty', fields: [[0x18, 'state', 'i']] },
  anim: { ctor: 0x76847b, upd: 0x768330, size: 0x18, port: 'trx-anim', fields: [] },
  fly: { ctor: 0x768188, upd: 0x7680c0, size: 0x4c, port: 'trx-fly', fields: [] },
};
export const KIND_OF_PORT = Object.fromEntries(Object.entries(SPEC).filter(([, s]) => s.port).map(([k, s]) => [s.port, k]));
const KIND_OF_CTOR = Object.fromEntries(Object.entries(SPEC).map(([k, s]) => [s.ctor, k]));

/** the scripted FUN_00435c91 (milliseconds since the zone's start) of both sides */
export const TRX_MS = 123457;
export function readField(mem, p, [off, , t]) {
  const a = p + off;
  if (t === 'f') return mem.f32(a);
  if (t === 'i') return mem.r32(a);
  if (t === 'u') return mem.u32(a);
  if (t === 'b') return mem.r32(a) !== 0 ? 1 : 0;
  if (t === 'u8') return mem.r8(a);
  throw new Error(`field type ${t}`);
}
export function writeField(mem, p, [off, , t], v) {
  const a = p + off;
  if (t === 'f') mem.wf32(a, v);
  else if (t === 'i' || t === 'u') mem.w32(a, v | 0);
  else if (t === 'b') mem.w32(a, v ? 1 : 0);
  else if (t === 'u8') mem.w8(a, v);
}
/** the port node's value of a field in the original's representation */
export function portValue(n, [, name, t]) {
  const v = n[name];
  if (t === 'b') return v ? 1 : 0;
  return v;
}

export function createTrxHarness(ctx, G) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;     // the original runs the x87 in 24-bit precision (Direct3D 7 leaves single precision): every + - * / sqrt rounds to float32
  const mem = cpu.mem;
  for (const [lo, n] of [[RB, NREC * 0x68], [NB, NREC * NODE_SIZE + 0x1000], [CB, NREC * 0x80], [AB, NREC * 0x40], [MB, 0x10000], [GB, 0x10000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  const w = G.w, rs = w.records;
  const H = { cpu, mem, G, pe, log: [], fx: [], handles: new Map(), tokens: new Map(), unhooked: new Set(), draws: [], attaches: [], allocNext: 0, lastAlloc: 0, nodePtr: new Map() };
  const recPtr = (r) => (r ? RB + r.index * 0x68 : 0);
  const recOf = (ptr) => (ptr === 0 ? null : rs[(ptr - RB) / 0x68]);
  const push = (e) => H.log.push(e);
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  const sink = G.sink;                     // the port's sound sink: `on` = the sounds the engine reports as playing
  const idOf = (h) => H.handles.get(h)?.id;

  // ---- sounds: FUN_00766060 run natively gives every DAT_05d5dxxx a handle; the hooked loaders hand out numbers that map to the sound id
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '2d' }); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '3d' }); c.eax = h; });
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  hook(0x4435a0, (c) => { const id = idOf(c.arg(0)); push(['2d', id]); sink.on.add(id); });
  hook(0x4435b0, (c) => { const id = idOf(c.arg(0)); push(['stop', id]); sink.on.delete(id); });
  hook(0x4433f0, (c) => { const id = idOf(c.arg(0)), p = c.arg(1); push(['3d', id, f32(mem.f32(p)), f32(mem.f32(p + 4)), f32(mem.f32(p + 8))]); sink.on.add(id); });
  hook(0x4434b0, (c) => { const id = idOf(c.arg(0)); push(['stop', id]); sink.on.delete(id); });
  hook(0x443590, (c) => { c.eax = sink.on.has(idOf(c.arg(0))) ? 1 : 0; });
  hook(0x438518, (c) => { push(['rumble', c.arg(1) | 0, c.arg(2) | 0]); });
  // speech: FUN_00439bf8(table, "ID", &token) + FUN_00435a11(token, -1)
  hook(0x439bf8, (c) => { const tok = 0x7000 + H.tokens.size; H.tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { push(['say', H.tokens.get(c.arg(0))]); });
  // particles / overlays / force feedback bookkeeping: not ported (no-ops, counted)
  for (const a of [0x442a20, 0x442a00, 0x44ebd0, 0x443230, 0x444480]) hook(a, (c) => { H.fx.push(a); });
  hook(0x442d90, (c) => { push(['fog', c.arg(0), c.arg(1)]); });
  // FUN_0076a7da: the four shadow-corner points (+0x88 .. +0xb4: written, read nowhere in the zone): skipped
  hook(0x76a7da, () => {});
  // the banner's text calls FUN_00439c6f(table, font, text, 1, 0, x, y, wrap) (the loop's FUN_007653be) and the UI mode call
  H.text = [];
  hook(0x460a3d, () => {});
  hook(0x439c6f, (c) => { H.text.push({ table: c.arg(0) === mem.u32(0x5d5d1cc) ? 'trx' : c.arg(0) === mem.u32(0x983a14) ? 'std' : c.arg(0), text: mem.cstr(c.arg(2)), x: c.arg(5) & 0xffff, y: c.arg(6) & 0xffff, wrap: c.arg(7) & 0xff }); });
  // game variables
  hook(0x417575, (c) => { c.eax = w.vars.get(c.arg(0)); });
  hook(0x417597, (c) => { w.vars.set(c.arg(0), c.arg(1) | 0); });
  hook(0x41761b, (c) => { w.vars.or(c.arg(0), c.arg(1) | 0); });
  hook(0x41766c, (c) => { w.vars.andNot(c.arg(0), c.arg(1) | 0); });
  // random numbers: FUN_004388ae runs natively (float32 at the 24-bit control word); its rand() (FUN_0085daf0) draws the test's keyed integer source (record, tick, draw index);
  // FUN_00435c91 (ms since the zone's start, scaled into the pick) is a fixed scripted value shared with the port (`TRX_MS`)
  hook(0x85daf0, () => { const r = G.rk.draw(); H.draws.push(r); cpu.eax = r; });
  hook(0x435c91, () => { cpu.eax = TRX_MS; });
  // animation instances: AB + record index * 0x40 -> the port's AnimInstance of that record (explicitly not the subject: FUN_0043b6a3 / b76a / b72b / b73f / b64d / b92a)
  const animOf = (ptr) => rs[(ptr - AB) / 0x40].anim;
  hook(0x43b6a3, (c) => { const a = animOf(c.arg(0)); c.eax = a.start(c.arg(1) | 0, c.argf(2)) ? 1 : 0; });
  hook(0x43b76a, (c) => { c.eax = animOf(c.arg(0)).advance(c.argf(1), w.dt); });
  hook(0x43b72b, (c) => { c.eax = animOf(c.arg(0)).clip; });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b753, (c) => { c.fpush(animOf(c.arg(0)).frameCount); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  // FUN_0043b92a(anim, rate) from the decompile: 2 when the clip's frame count < rate * dt + 1.0 + frame
  hook(0x43b92a, (c) => { const a = animOf(c.arg(0)); c.eax = a.frameCount < f32(f32(c.argf(1) * w.dt) + 1.0) + a.frame ? 2 : 0; });
  // the controller's first node (FUN_004239d9): ctrl block word 0
  hook(0x4239d9, (c) => { c.eax = mem.u32(c.arg(0)); });
  // alloc (FUN_00433d38(size, 1, file, line)): the node block of the record the test is constructing
  hook(0x433d38, (c) => { H.lastAlloc = H.allocNext; c.eax = H.allocNext; mem.fill(H.allocNext, c.arg(0)); });
  // models of the global model array (FUN_0043eaf0(array, index)): a pointer per index
  hook(0x43eaf0, (c) => { c.eax = 0x0e000000 + c.arg(1); });
  // sub-object matrices of the gate's mesh (FUN_0043ea60(model, n)): two 4x4 buffers
  hook(0x43ea60, (c) => { c.eax = MB + (c.arg(1) - 1) * 0x40; });
  // collision: FUN_00441270(ignore, from, delta, outNormal, outPoint, mask, radius, skin) over the port's world; the records the nodes before this one moved are in emulated memory
  const dirty = new Set();
  H.dirty = dirty;
  const syncRecs = () => { for (const i of dirty) { const r = rs[i]; const p = recPtr(r); for (let i = 0; i < 16; i++) r.m[i] = mem.f32(p + 0xc + 4 * i); r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60); } };
  hook(0x441270, (c) => {
    syncRecs();
    const ig = recOf(c.arg(0)), f = [0, 1, 2].map((i) => mem.f32(c.arg(1) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(c.arg(2) + 4 * i));
    const h = w.col.sweep(ig, f, d, c.arg(5), c.argf(6), c.argf(7));
    H.sweeps++;
    if (!h) { c.eax = 0; return; }
    for (let i = 0; i < 3; i++) { mem.wf32(c.arg(3) + 4 * i, h.normal[i]); mem.wf32(c.arg(4) + 4 * i, h.point[i]); }
    c.eax = recPtr(h.rec);
  });
  // FUN_00441b10(record, &{ &from, &delta, &normalOut, &pointOut, mask, radius, skin }, 0): one record's ray query
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
  H.sweeps = 0; H.rays = 0;
  // atan2 / cos / sin of the CRT load 80-bit constants: hosted from Math (only atan2 is needed by the hooked-out parts; cos and sin run natively)
  // the engine's controller services used by the zone loop
  hook(0x4237b6, (c) => { mem.w32(0x8adc74, c.arg(0)); });
  hook(0x42382c, (c) => { const rp = c.arg(0), r = recOf(rp); if (mem.r32(0x8adc74) === 0) return; mem.w32(rp + 0x5c, CB + r.index * 0x80); mem.w32(CB + r.index * 0x80, 0); H.ctrlCreated.push(r.index); });
  hook(0x423532, (c) => {
    const rp = c.arg(0), r = recOf(rp), args = c.arg(2);
    H.attaches.push({ rec: r.index, ctor: c.arg(1), argsBytes: args >= 0x10000 && mem.mapped(args) ? mem.read(args, 0x20) : null, pos: c.arg(3) | 0, var: c.arg(4) | 0, mask: c.arg(5) & 0xffff, value: c.arg(6) & 0xffff });
  });
  hook(0x4425e0, (c) => { mem.w32(0x9dec18, c.arg(0)); });
  hook(0x444550, () => {}); hook(0x43ebe0, () => {});
  // the builder FUN_0076b230: model part set-up (FUN_0043e870 / 0043ec10 / 0043f1d0): not data the nodes read
  hook(0x43e870, () => {}); hook(0x43ec10, () => {}); hook(0x43f1d0, () => {}); hook(0x43e930, () => {});
  // FUN_0076b070 (the particle emitters of the restart pass): FUN_0044ec30 / FUN_00442960 return handles nobody reads here
  hook(0x44ec30, () => {}); hook(0x442960, () => { cpu.eax = 0; });
  // atan2 of the CRT is not needed (FUN_0076a7da is skipped)
  cpu.exec = [[0x765000, 0x76c000], [0x858d30, 0x873e00], [0x43a4a1, 0x43a8e0], [0x43ce45, 0x43ce7d], [0x4425f0, 0x442680], [0x441a90, 0x441ac0], [0x4388ae, 0x4388e7]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z27TRX emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt?.toString(16)} (frames ${cpu.frames.slice(-4).map((f) => f.toString(16))})`); };
  cpu.invalidate();
  H.ctrlCreated = [];

  // ---- pointers into the zone's data: the sound handles of FUN_00766060 (run natively once)
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; };
  H.reset();
  cpu.call(0x766060, []);
  H.handleCount = H.handles.size;

  // ---- mirrors of the port's state in emulated memory
  const modelPtr = (m) => (m ? 0x0e000000 + m.index : 0);
  H.modelPtr = modelPtr;
  H.mirrorRecords = (all = false) => {
    mem.whi = 0; mem.wlo = 0;
    mem.w32(0x983804, RB); mem.w32(0x983800, rs.length);
    if (!H.mirrored) { all = true; H.mirrored = true; }
    for (const r of (all ? rs : G.mut)) {
      const p = recPtr(r);
      const nm = r.name.toUpperCase();
      for (let i = 0; i < 4; i++) mem.w8(p + i, nm.charCodeAt(i) || 0x20);
      mem.w32(p + 4, modelPtr(r.model));
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, r.colObj ? 1 : 0);
      mem.w32(p + 0x5c, r.ctrl ? CB + r.index * 0x80 : 0);
      mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
      if (r.ctrl) mem.w32(CB + r.index * 0x80, NB + r.index * NODE_SIZE);
      if (r.anim) { mem.w32(AB + r.index * 0x40 + 8, 1); }
    }
    mem.w32(0x9dec18, recPtr(w.col.groundRec));
    dirty.clear();
    mem.wlo = RB; mem.whi = RB + rs.length * 0x68; mem.onWrite = (a) => { dirty.add(Math.floor((a - RB) / 0x68)); };
  };
  H.readRec = (r) => {
    const p = recPtr(r);
    return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60), model: mem.u32(p + 4), variant: mem.r32(p + 0x64) };
  };
  H.mirrorNode = (kind, n, r) => {
    const sp = SPEC[kind], p = NB + r.index * NODE_SIZE;
    for (let o = 0; o < sp.size; o += 4) mem.w32(p + o, 0);
    mem.w32(p, n.var); mem.w16(p + 0xc, n.mask); mem.w16(p + 0xe, n.value);
    for (const f of sp.fields) writeField(mem, p, f, portValue(n, f));
    const run = G.run;
    if (kind === 'trex') { mem.w32(p + 0x38, recPtr(n.rider)); mem.w32(p + 0x80, 1); }
    if (kind === 'gate') { mem.w32(p + 0x14, MB); mem.w32(p + 0x18, MB + 0x40); for (let i = 0; i < 16; i++) { mem.wf32(MB + 4 * i, n.door1 ? n.door1[i] : 0); mem.wf32(MB + 0x40 + 4 * i, n.door2 ? n.door2[i] : 0); } }
    if (kind === 'bldr') mem.w32(p + 0x24, recPtr(run.pepp) + 0x3c);
    if (kind === 'egg') { mem.w32(p + 0x24, recPtr(run.pepp) + 0x3c); mem.w32(p + 0x28, modelPtr(n.models.falling)); mem.w32(p + 0x2c, modelPtr(n.models.landed)); mem.w32(p + 0x30, modelPtr(n.models.broken)); }
    if (kind === 'bronty') mem.w32(p + 0x14, recPtr(run.pepp));
    return p;
  };
  H.readNode = (kind, p) => {
    const sp = SPEC[kind], o = {};
    for (const f of sp.fields) o[f[1]] = readField(mem, p, f);
    if (kind === 'gate') { o.door1 = Array.from({ length: 16 }, (_, i) => mem.f32(MB + 4 * i)); o.door2 = Array.from({ length: 16 }, (_, i) => mem.f32(MB + 0x40 + 4 * i)); }
    return o;
  };
  /** the port node in the original's representation */
  H.portNode = (kind, n) => {
    const o = {};
    for (const f of SPEC[kind].fields) o[f[1]] = portValue(n, f);
    if (kind === 'gate') { o.door1 = n.door1 ? Array.from(n.door1) : null; o.door2 = n.door2 ? Array.from(n.door2) : null; }
    return o;
  };
  const camAt = 0x9da5e8;
  H.mirrorGlobals = () => {
    const run = G.run;
    mem.w32(0x5d5d16c, run.timeout ? 1 : 0); mem.wf32(0x5d5d190, run.clock); mem.w32(0x5d5d170, run.score | 0);
    mem.w32(0x5d5d228, recPtr(run.bridge)); mem.w32(0x5d5d2ac, recPtr(run.volcano));
    mem.w32(0x9da5dc, run.arrivalCamera ? 0x2260000 : 0);
    for (let i = 0; i < 18; i++) mem.wf32(camAt + 4 * i, w.camera.c[i]);
    mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);
    mem.w32(0x5d5d178, 0);
  };
  H.readGlobals = () => ({
    timeout: mem.r32(0x5d5d16c) !== 0 ? 1 : 0, clock: mem.f32(0x5d5d190), score: mem.r32(0x5d5d170), bridge: mem.u32(0x5d5d228), volcano: mem.u32(0x5d5d2ac),
    camFlag: mem.u32(0x9da5dc) === 0x2260000 ? 1 : 0, camZ: mem.f32(0x5d5d178), text: mem.cstr(0x5d4dd20, 32), color: mem.u32(0x5d4dd3c),
  });
  H.readCamera = () => Array.from({ length: 6 }, (_, i) => mem.f32(camAt + 4 * i));

  /** the nodes of the port's controllers in update-pass order: [record, node, kind] */
  H.nodeList = () => {
    const out = [];
    for (const r of rs) {
      const c = r.ctrl;
      if (!c || !c.enabled) continue;
      for (const n of c.nodes) { const kind = KIND_OF_PORT[n.kind]; if (kind) out.push([r, n, kind]); }
    }
    return out;
  };

  /**
   * one update pass of the original from the port's current state: every record's node in record order. `held` = the buttons of this tick.
   * `inView(rec)` decides the frustum flag (bit 0) of the spectators' records (the port's distance test stands in for it).
   */
  H.cov = null;
  H.emuPass = (held, inView, free = false) => {
    H.reset();
    H.log.length = 0; H.fx.length = 0; H.draws.length = 0; H.sweeps = 0; H.rays = 0;
    if (!free) { H.mirrorRecords(); H.mirrorGlobals(); }
    else { dirty.clear(); mem.wlo = RB; mem.whi = RB + rs.length * 0x68; mem.onWrite = (a) => { dirty.add(Math.floor((a - RB) / 0x68)); }; mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt); }
    mem.w32(0x98383c, held >>> 0); mem.w32(0x983840, 0);
    const perNode = new Map();
    for (const r of rs) {
      const c = r.ctrl;
      if (!c || !c.enabled) continue;
      for (const n of c.nodes) {
        const kind = KIND_OF_PORT[n.kind];
        if (!kind) continue;
        if (!w.vars.gate(n.var, n.mask, n.value)) continue;
        const p = free ? NB + r.index * NODE_SIZE : H.mirrorNode(kind, n, r);
        if (kind === 'anim') { const fl = mem.r16(recPtr(r) + 0x60); mem.w16(recPtr(r) + 0x60, inView(r) ? fl | 1 : fl & ~1); }
        G.rk.begin(r.index);
        const d0 = H.draws.length;
        cpu.steps = 0;
        try { cpu.call(SPEC[kind].upd, [recPtr(r), p], { maxSteps: 3000000, trace: H.cov ? (c, at) => H.cov.add(at) : undefined }); }
        catch (e) { e.message += ` [record ${r.index} ${r.name} ${kind}]`; throw e; }
        perNode.set(n, { kind, p, draws: H.draws.length - d0, rec: r.index });
        break;
      }
    }
    // the node states AFTER the whole pass (a later node, e.g. the rex's probe, changes an egg's state)
    for (const o of perNode.values()) o.state = H.readNode(o.kind, o.p);
    return { recs: rs.map((r) => (dirty.has(r.index) ? H.readRec(r) : null)), globals: H.readGlobals(), camera: H.readCamera(), log: H.log.slice(), perNode, fx: H.fx.slice(), draws: H.draws.length, steps: cpu.steps };
  };
  /** free-running mode: the world's records / vars / anims are the ORIGINAL's own state (kept up to date from emulated memory), the nodes live in emulated memory */
  H.readBack = (out) => {
    for (let i = 0; i < rs.length; i++) {
      const b = out.recs[i]; if (!b) continue;
      const r = rs[i];
      for (let k = 0; k < 16; k++) r.m[k] = b.m[k];
      r.rx = b.e[0]; r.ry = b.e[1]; r.rz = b.e[2]; r.flags = (r.flags & ~0xffff) | b.flags; r.variant = b.variant;
    }
  };
  H.freeInit = () => {
    const init = H.emuInit();
    // the original's records into the world, the gate's door matrices into the buffers the constructor was handed
    const all = rs.map(H.readRec);
    H.readBack({ recs: all });
    const gn = G.g?.gate;
    if (gn?.door1) for (let i = 0; i < 16; i++) { mem.wf32(MB + 4 * i, gn.door1[i]); mem.wf32(MB + 0x40 + 4 * i, gn.door2[i]); }
    return init;
  };

  // ---- the original's set-up: the zone loop FUN_0076649a(1) and the constructors, run on a world that has NOT been through prepareTrx
  /** returns { attaches: [{ rec, ctor, kind, np }], nodes: Map(rec index -> { kind, state }), recs } */
  /**
   * The original's set-up as the loop FUN_007656f2 runs it before play: FUN_00766b85 (zone init: FUN_0076649a(1) creates the nodes, constructors get no node and allocate) and FUN_00766e19
   * (FUN_0076b230: the builder, then FUN_0076649a(0): the constructors are called again with the existing node, `DAT_008adc74` = 0). The deferred attaches of each pass are run here.
   */
  H.emuInit = () => {
    H.reset();
    H.log.length = 0; H.fx.length = 0; H.attaches.length = 0; H.ctrlCreated.length = 0;
    H.mirrorRecords(true); H.mirrorGlobals();
    for (const a of [0x983838, 0x983814, 0x98381c, 0x983824, 0x98382c]) mem.w32(a, GB);       // the builder's model tables (zeroed: its calls are hosted no-ops)
    const out = { attaches: [], nodes: new Map(), ctrlCreated: [], calls: 0, restart: { attaches: [] } };
    let scratch = MB + 0x2000;
    const runAttaches = (list, restart) => {
      for (const a of list) {
        const kind = KIND_OF_CTOR[a.ctor];
        if (!kind) throw new Error(`z27TRX emu: unknown constructor 0x${a.ctor.toString(16)}`);
        const argp = scratch; scratch += 0x40;
        if (a.argsBytes) mem.write(argp, a.argsBytes);
        const np = NB + a.rec * NODE_SIZE;
        if (!restart) mem.fill(np, NODE_SIZE);
        H.allocNext = np; H.lastAlloc = 0;
        cpu.steps = 0;
        cpu.call(a.ctor, [RB + a.rec * 0x68, argp, restart ? np : 0, a.var, a.mask, a.value], { maxSteps: 3000000 });
        mem.w32(CB + a.rec * 0x80, np);       // the controller's first node (FUN_004239d9)
        (restart ? out.restart.attaches : out.attaches).push({ rec: a.rec, ctor: a.ctor, kind, np, alloc: H.lastAlloc, var: a.var, mask: a.mask, value: a.value, args: a.argsBytes ? Array.from(a.argsBytes) : null });
        out.nodes.set(a.rec, { kind, state: H.readNode(kind, np) });
        out.calls++;
      }
    };
    // pass 1: FUN_0076649a(1) (the zone init FUN_00766b85 calls it with 1)
    mem.w32(0x8adc74, 1);
    cpu.steps = 0;
    cpu.call(0x76649a, [1], { maxSteps: 5000000 });
    out.ctrlCreated = H.ctrlCreated.slice();
    const first = H.attaches.slice(); H.attaches.length = 0;
    runAttaches(first, false);
    // pass 2: FUN_00766e19 = the builder FUN_0076b230 + FUN_0076649a(0) + fog + the rex's matrix
    cpu.steps = 0;
    cpu.call(0x766e19, [], { maxSteps: 5000000 });
    const second = H.attaches.slice(); H.attaches.length = 0;
    runAttaches(second, true);
    out.recs = rs.map(H.readRec);
    out.globals = H.readGlobals();
    out.camera = H.readCamera();
    out.log = H.log.slice();
    return out;
  };
  /** the loop's end banner FUN_007653be run for a medal / score: the text calls in order */
  H.banner = (medal, score) => {
    mem.w32(0x5d5d1cc, 0x1111); mem.w32(0x983a14, 0x2222);
    const old = w.vars.get(0xff); w.vars.set(0xff, medal);
    mem.w32(0x5d5d170, score); H.text.length = 0; H.reset();
    cpu.call(0x7653be, []);
    w.vars.set(0xff, old);
    return H.text.slice();
  };
  /** the HUD clock FUN_0076560f ("%d:%02d" of ftol(clock / 30)) */
  H.clockText = (clock) => { mem.wf32(0x5d5d190, clock); H.reset(); cpu.call(0x76560f, []); return mem.cstr(0x5d4dd60, 16); };
  return H;
}

/** snapshot / restore of everything one tick of the port changes (records, nodes, run, variables, anims, camera, sound state) */
export function snapshotWorld(G) {
  const { w, run, sink } = G, rs = w.records, mut = G.mut;
  const nodes = [];
  for (const r of mut) for (const n of r.ctrl?.nodes ?? []) {
    const o = {};
    for (const [k, v] of Object.entries(n)) {
      if (typeof v === 'number' || typeof v === 'boolean' || v === null) o[k] = v;
      else if (Array.isArray(v)) o[k] = v.slice();
      else if (ArrayBuffer.isView(v)) o[k] = v.slice();
      else if (v && typeof v === 'object' && 'index' in v) o[k] = v;
    }
    nodes.push([n, o]);
  }
  const rn = {};
  for (const [k, v] of Object.entries(run)) {
    if (typeof v === 'number' || typeof v === 'boolean' || v === null || typeof v === 'string') rn[k] = v;
    else if (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'number')) rn[k] = v.slice();
    else if (v && typeof v === 'object' && 'index' in v) rn[k] = v;
  }
  return {
    vars: w.vars.a.slice(), tickCount: w.tickCount, frame: w.frame, nodes, run: rn, spoken: run.spoken.length, on: new Set(sink.on), logLen: sink.log.length,
    recs: mut.map((r) => ({ i: r.index, m: new Float32Array(r.m), prev: new Float32Array(r.prev), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags, model: r.model, variant: r.variant, anim: r.anim ? { clip: r.anim.clip, frame: r.anim.frame, prevFrame: r.anim.prevFrame, prevClip: r.anim.prevClip } : null })),
    cam: { c: new Float64Array(w.camera.c), prev: new Float64Array(w.camera.prev), vel: w.camera.vel },
  };
}
export function restoreWorld(G, s) {
  const { w, run, sink } = G, rs = w.records;
  w.vars.a.set(s.vars); w.tickCount = s.tickCount; w.frame = s.frame;
  s.recs.forEach((q) => { const r = rs[q.i]; r.m.set(q.m); r.prev.set(q.prev); r.rx = q.rx; r.ry = q.ry; r.rz = q.rz; r.flags = q.flags; r.model = q.model; r.variant = q.variant; if (q.anim) Object.assign(r.anim, q.anim); });
  for (const [n, o] of s.nodes) for (const [k, v] of Object.entries(o)) { if (ArrayBuffer.isView(v)) n[k].set(v); else n[k] = Array.isArray(v) ? v.slice() : v; }
  for (const [k, v] of Object.entries(s.run)) run[k] = Array.isArray(v) ? v.slice() : v;
  run.spoken.length = s.spoken;
  sink.on.clear(); for (const x of s.on) sink.on.add(x);
  sink.log.length = s.logLen;
  w.camera.c.set(s.cam.c); w.camera.prev.set(s.cam.prev); w.camera.vel = s.cam.vel;
}

/** the original stores float32: the port's doubles are rounded to float32 at the start of a tick so both sides get the very same inputs (the last-bit noise of the inputs would otherwise be
 * amplified by terrain facet edges); results are still compared with a float32 tolerance */
export function quantize(G) {
  const { w, run } = G, rs = w.records;
  const q = (o, k) => { if (typeof o[k] === 'number') o[k] = f32(o[k]); };
  for (const r of G.mut) {
    for (const k of ['rx', 'ry', 'rz']) q(r, k);
    if (r.anim) q(r.anim, 'frame');
    for (const n of r.ctrl?.nodes ?? []) for (const k of Object.keys(n)) if (typeof n[k] === 'number' && !['var', 'mask', 'value', 'stamp'].includes(k)) q(n, k);
  }
  q(run, 'clock');
  for (let i = 0; i < 18; i++) w.camera.c[i] = f32(w.camera.c[i]);
}
