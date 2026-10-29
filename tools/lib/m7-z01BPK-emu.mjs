// z01BPK (WP-VERIFY, docs/re/m6/z01BPK.md section "Differential test"): the ORIGINAL update functions of the zone's player chain run in the x86 emulation next to the port.
//   PepSwitc  FUN_00493dd8 (+ FUN_00493ba0 clock, FUN_00493ecd result)   the clock / score node
//   Walk      FUN_00494190                                              the walk to the board
//   skate.c   FUN_00490e2e (+ FUN_004900d4, FUN_0048f66d, FUN_0048e840, FUN_00490cd2, FUN_00490af4, FUN_0048fece, FUN_0048fdea)   the board, the stunts
// The functions execute natively together with the engine code that is the subject of the board question: the collision sweep FUN_00441270 (+ FUN_00441a90, the terrain ray
// FUN_0043cd62 / FUN_004425f0 / FUN_00441b10, the polygon tests FUN_00440810 ...) runs on collision objects built by the ORIGINAL loader FUN_0043f370 from the archive's .col files.
// Hosted (not the subject, stand-ins reuse the port's own objects, as the M6 z18MMP harness does): the game variables, the animation instances (FUN_0043b6a3 / 0043b76a / 0043b72b /
// 0043b73f / 0043b753 / 0043b64d act on the port's AnimInstance of the record), the sound calls (logged), the file / heap functions of the .col loader, the gamepad (FUN_004376f9: none),
// atan2 (the CRT version loads an 80 bit constant the interpreter does not model).
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';
import { colMember } from '../../src/game/zone.ts';

export const RB = 0x30000000, NB = 0x31000000, AB = 0x33000000, MB = 0x34000000, HEAP = 0x20000000, HEAP_SIZE = 0x6000000, FB = 0x38000000;
const NODE_SIZE = 0x400;

const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export const f32 = (v) => { F32[0] = v; return F32[0]; };
export const bitsOf = (v) => { F32[0] = v; return U32[0]; };

/** the node blocks of the three chain nodes (base address + the constructor's arguments) */
export const NODES = { swc: { addr: 0x493dd8, ctor: 0x494091 }, walk: { addr: 0x494190, ctor: 0x4944f3 }, skate: { addr: 0x490e2e, ctor: 0x492cc2 } };

export function createHarness(ctx, G, opts = {}) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;   // the game runs the x87 in 24-bit precision (D3D7; docs/re/engine-m1.md 8.1)
  const mem = cpu.mem;
  const w = G.w, rs = w.records, g = G.g;
  const N = rs.length;
  for (const [lo, n] of [[RB, N * 0x68 + 0x100], [NB, 3 * NODE_SIZE], [AB, N * 0x40 + 0x40], [MB, 0x10000], [HEAP, HEAP_SIZE], [FB, 0x1000]]) mem.addRegion({ lo, hi: lo + n, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, N);
  const recPtr = (r) => RB + r.index * 0x68;
  const recOf = (ptr) => (ptr === 0 ? null : rs[(ptr - RB) / 0x68]);
  const H = { cpu, mem, G, log: [], handles: new Map(), unhooked: new Set(), colPtr: new Map(), colOf: new Map(), retvals: {}, notes: [] };
  const push = (e) => H.log.push(e);
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);

  // ---- heap + file functions of the collision loader (FUN_0043f370): the .col files come from the zone's archive
  let heapTop = HEAP;
  const files = new Map();
  let nextFile = 1;
  hook(0x433d38, (c) => { const n = (c.arg(0) + 15) & ~15; const p = heapTop; heapTop += Math.max(16, n); c.eax = p; });
  hook(0x433d60, () => {});
  hook(0x443c70, () => {});
  hook(0x435843, (c) => { const e = files.get(c.arg(0)); if (!e) { c.eax = 0; return; } const h = nextFile++; files.set(h, { data: e, pos: 0 }); c.eax = h; });
  hook(0x435350, (c) => {
    const dst = c.arg(0), size = c.arg(1), count = c.arg(2), f = files.get(c.arg(3));
    if (!f) { c.eax = 0; return; }
    const want = size * count, k = Math.max(0, Math.min(want, f.data.length - f.pos));
    mem.write(dst, f.data.subarray(f.pos, f.pos + k)); f.pos += k;
    c.eax = size ? Math.floor(k / size) : 0;
  });
  hook(0x4358e9, () => {});
  hook(0x890290, (c) => { const a = c.arg(0), b = c.arg(1), n = c.arg(2); let r = 0; for (let i = 0; i < n && !r; i++) r = mem.r8(a + i) - mem.r8(b + i); c.eax = r < 0 ? -1 : r > 0 ? 1 : 0; });
  // memcmp-like needs the file table: the loader is called with a path pointer; the 'file' key is the pointer itself
  // which loader the zone's code calls for a file: the push of the path string is followed by `call FUN_0043f370` (polygons) or `call FUN_0043f700` (header only): found from the code
  const loaderOf = new Map();
  for (const sva of pe.findStrings(`_data\\${G.L.scene.zone}\\col\\`)) {
    for (const x of pe.pushXrefs(sva)) for (let k = 5; k < 14; k++) if (pe.at(x + k) === 0xe8) { loaderOf.set(pe.cstr(sva).toLowerCase(), ((x + k + 5 + (pe.u32(x + k + 1) | 0)) >>> 0)); break; }
  }
  H.loaderOf = loaderOf;
  const loadCol = (colObj) => {
    const e = G.L.archive.find(colMember(colObj.path));
    if (!e) return 0xbabababa;
    const loader = loaderOf.get(colObj.path.toLowerCase()) ?? 0x43f370;
    const pathPtr = MB + 0x8000;
    const key = pathPtr + files.size * 0x100;
    mem.write(key, [...colObj.path].map((ch) => ch.charCodeAt(0))); mem.w8(key + colObj.path.length, 0);
    files.set(key, G.L.archive.read(e));
    return cpu.call(loader, [key], { maxSteps: 5000000 }) >>> 0;
  };

  // ---- sound: FUN_00492ec0 (the loads) runs natively, the hooked loaders hand out handles that map to the sound id
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '2d' }); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, { id: c.arg(0), kind: '3d' }); c.eax = h; });
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  const hid = (h) => H.handles.get(h);
  hook(0x4435a0, (c) => { push(['play', hid(c.arg(0))?.id]); });
  hook(0x4435b0, (c) => { push(['stop', hid(c.arg(0))?.id]); });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['wheels', true, mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)]); });
  hook(0x4434b0, () => { push(['wheels', false]); });
  // ---- game variables
  hook(0x417575, (c) => { c.eax = w.vars.get(c.arg(0)); });
  hook(0x417597, (c) => { w.vars.set(c.arg(0), c.arg(1) | 0); });
  hook(0x41761b, (c) => { w.vars.or(c.arg(0), c.arg(1) | 0); });
  hook(0x41766c, (c) => { w.vars.andNot(c.arg(0), c.arg(1) | 0); });
  hook(0x4175ca, (c) => { w.vars.add(c.arg(0), c.arg(1) | 0); });
  // ---- animation instances: the pointer is AB + record index * 0x40 (engine function, not the subject: the port's AnimInstance)
  const animOf = (ptr) => rs[(ptr - AB) / 0x40]?.anim;
  hook(0x43b6a3, (c) => { const a = animOf(c.arg(0)); push(['anim', (c.arg(0) - AB) / 0x40, c.arg(1) | 0, c.argf(2)]); a?.start(c.arg(1) | 0, c.argf(2)); });
  hook(0x43b76a, (c) => { c.eax = animOf(c.arg(0)).advance(c.argf(1), w.dt); });
  hook(0x43b72b, (c) => { c.eax = animOf(c.arg(0)).clip; });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b753, (c) => { c.fpush(animOf(c.arg(0)).frameCount); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  // the gamepad: none connected (the port does not read it either: z01BPK.md section 4)
  hook(0x4376f9, (c) => { const p = c.arg(1); mem.w32(p + 4, 0); mem.w32(p + 8, 0); c.eax = 0; });
  // atan2(y, x), sqrt: the CRT versions use 80 bit constants / x87 state the interpreter treats exactly except atan2
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  hook(0x43cc5c, () => {});       // FUN_0043cc5c (view matrix of the camera into a local: not part of the state compared)
  // the zone's text calls (FUN_00439c6f(table, font, text, 1, 0, x, y, wrap)) and the panel (FUN_00460a3d): logged for the loop's text functions
  H.texts = [];
  hook(0x439c6f, (c) => { H.texts.push({ table: c.arg(0), font: c.arg(1), text: mem.cstr(c.arg(2), 64), x: c.arg(5), y: c.arg(6), wrap: c.arg(7) }); });
  hook(0x460a3d, (c) => { H.texts.push({ panel: [c.arg(0), c.arg(1), c.arg(2)] }); });
  hook(0x46055f, () => {});       // the HUD refresh the clock calls after writing its texts
  // the stunt-name / overlay / text / hud calls do not occur in the update functions

  cpu.exec = [[0x422b00, 0x422d00], [0x48d000, 0x495000], [0x858d30, 0x873e00], [0x43a000, 0x43b100], [0x43cc00, 0x43cf30], [0x43d000, 0x442b00]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z01BPK emu: unhooked call to 0x${a.toString(16)}`); };
  cpu.invalidate();

  // ---- the .col objects (original loader), the record array
  const cols = new Map();
  for (const r of rs) {
    if (!r.colObj) continue;
    if (!cols.has(r.colObj)) cols.set(r.colObj, loadCol(r.colObj));
  }
  H.cols = cols;
  H.loadColFull = (colObj) => { const e = G.L.archive.find(colMember(colObj.path)); const key = MB + 0x9000 + files.size * 0x100; mem.write(key, [...colObj.path].map((ch) => ch.charCodeAt(0))); mem.w8(key + colObj.path.length, 0); files.set(key, G.L.archive.read(e)); return cpu.call(0x43f370, [key], { maxSteps: 5000000 }) >>> 0; };
  cpu.call(0x492ec0, []);          // FUN_00492ec0: the sound handles DAT_05d580xx, DAT_05d5804c (wheels), DAT_05d580a4 = 1
  mem.w8(0x5d580a4, 1);

  // ---- the node blocks: the original constructors initialise them (param_3 given)
  H.nodePtr = { swc: NB, walk: NB + NODE_SIZE, skate: NB + 2 * NODE_SIZE };
  for (const [k, spec] of Object.entries(NODES)) {
    const np = H.nodePtr[k];
    mem.fill(np, NODE_SIZE, 0xcc);
    const n = g[k === 'swc' ? 'swc' : k];
    cpu.call(spec.ctor, [recPtr(g.pepper), 0, np, n.var, n.mask, n.value]);
  }

  // ---- mirrors
  const colPtrOf = (r) => (r.colObj ? cols.get(r.colObj) : 0xbabababa);
  /** the engine's record array (matrices, flags, col object) from the port; the col object's shape / radius / box from the ColObject (set at run time by the zone: FUN_004427e0 ...) */
  H.mirrorRecords = () => {
    for (const r of rs) {
      const p = recPtr(r);
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, 0);
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, colPtrOf(r) >>> 0);
      mem.w32(p + 0x5c, 0);
      mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
      if (r.colObj) {
        const co = cols.get(r.colObj);
        if (co && co !== 0xbabababa) {
          mem.wf32(co + 0x24, r.colObj.radius); mem.w32(co + 0x4c, r.colObj.shape);
          if (r.colObj.shape === 3) for (let i = 0; i < 3; i++) mem.wf32(co + 0x58 + 4 * i, r.colObj.box[i]);
        }
      }
    }
  };
  const readRec = (r) => {
    const p = recPtr(r);
    return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) };
  };
  H.readRec = readRec;

  // the skate node: field map (offset, kind, port name)
  const SK = [
    [0x18, 'u8', 'state'], [0x19, 'u8', 'evaluated'], [0x1a, 'u8', 'grounded'], [0x1b, 'u8', 'onPipe'], [0x1c, 'u8', 'trickMid'], [0x1d, 'u8', 'pushes'], [0x1e, 'u8', 'locked'],
    [0x20, 'i32', 'animResult'], [0x24, 'i32', 'rampX'], [0x28, 'i32', 'steer'], [0x2c, 'i32', 'rampY'], [0x30, 'i32', 'stickY'], [0x38, 'f32', 't'], [0x3c, 'f32', 'spin'],
    [0x40, 'f32', 'trickRate'], [0x5c, 'f32', 'speed'], [0x60, 'f32', 'maxSpeed'], [0x64, 'f32', 'charge'], [0x68, 'f32', 'y0'], [0x6c, 'f32', 'jumpY'], [0x70, 'f32', 'v0'], [0x74, 'f32', 'vy'],
    [0x78, 'f32', 'progress'], [0x8c, 'f32', 'vx'], [0x90, 'f32', 'vyv'], [0x94, 'f32', 'vz'], [0x98, 'f32', 'pipeN0'], [0x9c, 'f32', 'pipeN1'], [0xa0, 'f32', 'pipeN2'],
  ];
  const getS = (s, k) => (k === 'pipeN0' ? s.pipeN[0] : k === 'pipeN1' ? s.pipeN[1] : k === 'pipeN2' ? s.pipeN[2] : s[k]);
  const rd = (m, a, kind) => (kind === 'u8' ? m.r8(a) : kind === 'i32' ? m.r32(a) : m.f32(a));
  H.SK = SK;
  H.writeSkate = (s) => {
    const np = H.nodePtr.skate;
    mem.w32(np + 8, s.stamp >>> 0);
    for (const [off, kind, key] of SK) {
      const v = getS(s, key);
      if (kind === 'u8') mem.w8(np + off, v); else if (kind === 'i32') mem.w32(np + off, v | 0); else mem.wf32(np + off, v);
    }
    mem.wf32(np + 0x50, s.pipeSpeed);
    mem.w32(np + 0xb0, s.pipeRec ? recPtr(s.pipeRec) : 0);
  };
  H.readSkate = () => {
    const np = H.nodePtr.skate, o = {};
    for (const [off, kind, key] of SK) o[key] = rd(mem, np + off, kind);
    o.pipeSpeed = mem.f32(np + 0x50);
    o.pipeRec = mem.u32(np + 0xb0);
    o.stamp = mem.u32(np + 8);
    return o;
  };
  H.tsSkate = (s) => { const o = {}; for (const [, , key] of SK) o[key] = getS(s, key); o.pipeSpeed = s.pipeSpeed; o.pipeRec = s.pipeRec ? recPtr(s.pipeRec) : 0; o.stamp = s.stamp >>> 0; return o; };
  // the clock node (FUN_00493dd8 / FUN_00493ba0): +0x18 counting, +0x19 over, +0x1a ended, +0x1c time, +0x20 score, +0x24 pending
  H.writeSwc = (n) => {
    const np = H.nodePtr.swc;
    mem.w32(np + 8, n.stamp >>> 0);
    mem.w8(np + 0x18, n.counting); mem.w8(np + 0x19, n.over); mem.w8(np + 0x1a, n.ended); mem.wf32(np + 0x1c, n.time); mem.wf32(np + 0x20, n.score); mem.wf32(np + 0x24, n.pending);
  };
  H.readSwc = () => { const np = H.nodePtr.swc; return { counting: mem.r8(np + 0x18), over: mem.r8(np + 0x19), ended: mem.r8(np + 0x1a), time: mem.f32(np + 0x1c), score: mem.f32(np + 0x20), pending: mem.f32(np + 0x24) }; };
  H.tsSwc = (n) => ({ counting: n.counting, over: n.over, ended: n.ended, time: n.time, score: n.score, pending: n.pending });
  // walk node: +0x15 state, +0x16 wrapped, +0x17 turned
  H.writeWalk = (n) => { const np = H.nodePtr.walk; mem.w32(np + 8, n.stamp >>> 0); mem.w8(np + 0x15, n.state); mem.w8(np + 0x16, n.wrapped); mem.w8(np + 0x17, n.turned); };
  H.readWalk = () => { const np = H.nodePtr.walk; return { state: mem.r8(np + 0x15), wrapped: mem.r8(np + 0x16), turned: mem.r8(np + 0x17) }; };
  H.tsWalk = (n) => ({ state: n.state, wrapped: n.wrapped, turned: n.turned });

  // the globals of the zone: DAT_05d58004 trick score (float), DAT_05d58008 trick flag, DAT_008ae088 mailbox (u8), DAT_05d58009 (u8), DAT_009da9ac surface at feet, camera 0x9da5e8 (18 floats)
  const camAt = 0x9da5e8;
  H.writeGlobals = () => {
    mem.wf32(0x5d58004, g.run.trickScore); mem.w32(0x5d58008, g.run.trickFlag); mem.w8(0x8ae088, w.pep.mailbox);
    mem.w32(0x9da9ac, w.pep.surfaceAtFeet | 0); mem.w32(0x9da5cc, w.frame >>> 0); mem.wf32(0x9da858, w.seaLevel); mem.wf32(0x9da9bc, w.gravity);
    mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);
    mem.w32(0x9dec18, w.col.groundRec ? recPtr(w.col.groundRec) : 0);
    for (let i = 0; i < 18; i++) mem.wf32(camAt + 4 * i, w.camera.c[i]);
    mem.w32(0x987660, 0); mem.w32(0x9daa7c, g.run.board);
    mem.w32(0x5d57fc4, g.run.result); mem.w32(0x5d580bc, g.run.finalScore); mem.w32(0x5d580c0, g.run.medal); mem.w32(0x5d580c4, g.run.newHiscore); mem.wf32(0x5d580c8, g.run.timeLeft);
    mem.w32(0x9da5d8, recPtr(g.pepper) + 0xc); mem.w32(0x9da5e0, 0);       // FUN_00493506: DAT_009da5d8 = Pepper's matrix; the camera preset 0
  };
  H.readGlobals = () => ({ trickScore: mem.f32(0x5d58004), trickFlag: mem.r32(0x5d58008), mailbox: mem.r8(0x8ae088), reset: mem.r8(0x5d58009), surface: mem.r32(0x9da9ac), camera: Array.from({ length: 9 }, (_, i) => mem.f32(camAt + 4 * i)) });
  H.tsGlobals = () => ({ trickScore: g.run.trickScore, trickFlag: g.run.trickFlag, mailbox: w.pep.mailbox, reset: undefined, surface: w.pep.surfaceAtFeet | 0, camera: Array.from(w.camera.c).slice(0, 9) });
  // the sweeps of the skateboard: which record the original's FUN_00441270 returned at each call site (watches on the instruction after the call): H.hits['site:NAME']
  H.hits = {};
  for (const site of [0x4906bd, 0x491124, 0x491161, 0x4918df, 0x491915, 0x491b56, 0x491bbd]) {
    cpu.watches.set(site + 5, (c) => { const e = c.eax; const k = `${site.toString(16)}:${e ? (rs[(e - RB) / 0x68]?.name ?? '?') : '-'}`; H.hits[k] = (H.hits[k] ?? 0) + 1; });
  }
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };
  H.recPtr = recPtr; H.recOf = recOf;
  return H;
}

/** one node's call in the original: returns the update function's return value (eax) */
export function callNode(H, kind) {
  const { cpu, G } = H;
  const np = H.nodePtr[kind];
  cpu.steps = 0;
  const pepper = H.recPtr(G.g.pepper);
  const a = NODES[kind].addr;
  cpu.call(a, [pepper, np, 0, 0], { maxSteps: 4000000, trace: H.trace ?? undefined });
  return cpu.eax | 0;
}

/** the texts the clock writes (sprintf into the HUD buffers) */
export function readTexts(H) {
  const { mem } = H;
  return { clock: mem.cstr(0x5d4dd60, 16), score: mem.cstr(0x5d4dd20, 16), trick: mem.cstr(0x5d4dfec, 16), result: { code: mem.r32(0x5d57fc4), final: mem.r32(0x5d580bc), medal: mem.r32(0x5d580c0), newHi: mem.r32(0x5d580c4), time: mem.f32(0x5d580c8) } };
}

/** the held-button mask (B bits of the port's input) into the original's input globals */
export function writeInput(H, held, pressed) {
  const { mem } = H;
  mem.w32(0x98383c, held >>> 0); mem.w32(0x983840, pressed >>> 0); mem.w32(0x983848, held >>> 0);
}

/**
 * one update pass of Pepper's controller chain in the ORIGINAL from the port's current state: mirrors records / nodes / globals into the emulation, runs the nodes in chain order
 * (gate = the original's own var test with the vars as the hosted calls leave them; stop on return 1), returns what changed.
 */
export function emuPass(H, held, pressed) {
  const { cpu, mem, G } = H;
  const w = G.w, g = G.g;
  H.log.length = 0;
  H.mirrorRecords(); H.writeGlobals(); writeInput(H, held, pressed);
  H.writeSwc(g.swc); H.writeWalk(g.walk); H.writeSkate(g.skate);
  const KIND = { bpkSwitch: 'swc', bpkWalk: 'walk', bpkSkate: 'skate' };
  const ran = [], rets = [];
  const nodes = g.pepper.ctrl.nodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (!w.vars.gate(n.var, n.mask, n.value)) continue;
    const k = KIND[n.kind];
    const r = callNode(H, k);
    ran[i] = true; rets[i] = r;
    if (r === 1) break;
  }
  return {
    pepper: H.readRec(g.pepper), board: H.readRec(g.board), recs: G.w.records.map((r) => H.readRec(r)),
    anims: Object.fromEntries(G.w.records.filter((r) => r.anim).map((r) => [r.index, { clip: r.anim.clip, frame: r.anim.frame }])),
    skate: H.readSkate(), swc: H.readSwc(), walk: H.readWalk(), globals: H.readGlobals(), texts: readTexts(H), log: H.log.slice(), ran, rets, vars: w.vars.a.slice(),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------- snapshot / restore of everything one tick changes
const own = (o) => {
  const c = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' || v === null) c[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) c[k] = v.slice();
    else if (v && typeof v === 'object' && 'index' in v && 'm' in v) c[k] = v;     // a record reference
  }
  return c;
};
export function snapshotWorld(G) {
  const { w, g } = G;
  const nodes = [g.swc, g.walk, g.skate].map((n) => [n, own(n)]);
  return {
    vars: w.vars.a.slice(), tickCount: w.tickCount, frame: w.frame, input: { held: w.input.held, prevHeld: w.input.prevHeld, pressed: w.input.pressed },
    recs: w.records.map((r) => ({ m: new Float32Array(r.m), prev: new Float32Array(r.prev), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags, anim: r.anim ? own(r.anim) : null })),
    nodes, run: own(g.run), pep: own(w.pep), cam: { c: new Float64Array(w.camera.c), prev: new Float64Array(w.camera.prev), vel: w.camera.vel },
    sounds: G.sounds.length,
  };
}
export function restoreWorld(G, s) {
  const { w, g } = G;
  w.vars.a.set(s.vars); w.tickCount = s.tickCount; w.frame = s.frame;
  s.recs.forEach((q, i) => { const r = w.records[i]; r.m.set(q.m); r.prev.set(q.prev); r.rx = q.rx; r.ry = q.ry; r.rz = q.rz; r.flags = q.flags; if (q.anim) Object.assign(r.anim, q.anim); });
  for (const [n, o] of s.nodes) { for (const [k, v] of Object.entries(o)) n[k] = Array.isArray(v) ? v.slice() : v; }
  for (const [k, v] of Object.entries(s.run)) g.run[k] = v;
  for (const [k, v] of Object.entries(s.pep)) w.pep[k] = Array.isArray(v) ? v.slice() : v;
  w.camera.c.set(s.cam.c); w.camera.prev.set(s.cam.prev); w.camera.vel = s.cam.vel;
  G.sounds.length = s.sounds;
}

/**
 * the original's FUN_00441270 on the mirrored records: returns { rec (index or -1), point, normal, surface } (surface = FUN_004425c0: the polygon hit last).
 * `boardFull`: give the board record the collision object of the FULL loader FUN_0043f370 instead of the bounds-only one of FUN_0043f700 (what the port had assumed before WP-VERIFY).
 */
export function nativeSweep(H, ignore, from, delta, mask, radius, skin, opts = {}) {
  const { cpu, mem, G } = H;
  const A = MB + 0x2000;
  for (let i = 0; i < 3; i++) { mem.wf32(A + 4 * i, from[i]); mem.wf32(A + 0x10 + 4 * i, delta[i]); }
  mem.fill(A + 0x20, 0x20, 0);
  if (opts.boardFull) {
    if (!H.fullBoard) {
      const b = G.g.board;
      H.fullBoard = H.loadColFull(b.colObj);
    }
    mem.w32(H.recPtr(G.g.board) + 0x58, H.fullBoard >>> 0);
  }
  cpu.steps = 0;
  const bits = (v) => bitsOf(v);
  const r = cpu.call(0x441270, [ignore ? H.recPtr(ignore) : 0, A, A + 0x10, A + 0x20, A + 0x30, mask, bits(radius), bits(skin)], { maxSteps: 4000000 });
  const hitRec = (r >>> 0) === 0 ? -1 : ((r >>> 0) - RB) / 0x68;
  const out = { rec: hitRec, point: hitRec < 0 ? null : [0, 1, 2].map((i) => mem.f32(A + 0x30 + 4 * i)), normal: hitRec < 0 ? null : [0, 1, 2].map((i) => mem.f32(A + 0x20 + 4 * i)) };
  const poly = mem.u32(0x9deb78);
  out.surface = hitRec < 0 || poly === 0 ? 0 : mem.u32(poly + 4);
  return out;
}

/** run the middle of a function: from `from` until execution reaches `stopAt`, with a scratch frame (ebp / esp) for the function's locals (cdecl callee, the frame is ours) */
const STOP = { stop: true };
export function runSlice(H, from, stopAt, maxSteps = 2000000) {
  const { cpu } = H;
  const saved = { esp: cpu.regs[4], ebp: cpu.regs[5] };
  const frame = 0x7ff00000 - 0x8000;
  cpu.regs[5] = frame; cpu.regs[4] = frame - 0x300;
  cpu.watches.set(stopAt, () => { throw STOP; });
  cpu.invalidate();
  cpu.steps = 0;
  try { cpu.call(from, [], { maxSteps }); throw new Error(`slice 0x${from.toString(16)} returned without reaching 0x${stopAt.toString(16)}`); }
  catch (e) { if (e !== STOP) throw e; }
  finally { cpu.watches.delete(stopAt); cpu.regs[4] = saved.esp; cpu.regs[5] = saved.ebp; cpu.invalidate(); cpu.frames.length = 0; }
}

/**
 * the spectators of the zone loop's mode 2 (FUN_0048d8bd 0x48db56 .. 0x48dd59: records 0x25 .. 0x37 advance their clip by 1.0 and turn towards Pepper) from the port's state:
 * returns the records' matrices / Euler angles / flags and their animation state after it.
 */
export function emuSpectators(H) {
  const { G, mem } = H, w = G.w, g = G.g;
  H.log.length = 0;
  H.mirrorRecords(); H.writeGlobals();
  runSlice(H, 0x48db56, 0x48dd59);
  const recs = {};
  for (let i = 0x25; i <= 0x37; i++) recs[i] = { ...H.readRec(w.records[i]), anim: { clip: w.records[i].anim.clip, frame: w.records[i].anim.frame } };
  void mem; void g;
  return recs;
}

/** the tail of the zone's set-up (FUN_00493506 0x49374d .. 0x49387b): the camera of the first frame (FUN_00422b50 preset, target = Pepper + (0, 3, 0), eye = the preset offset in Pepper's frame turned by pi) */
export function emuSetupCamera(H) {
  const { mem, G } = H;
  H.mirrorRecords(); H.writeGlobals();
  mem.fill(0x9da5e8, 18 * 4, 0);
  runSlice(H, 0x49374d, 0x49387b);
  return Array.from({ length: 18 }, (_, i) => mem.f32(0x9da5e8 + 4 * i));
}

/** the zone loop's text functions in the original: 'trick' = FUN_0048d52b with Pepper's clip, 'banner' = FUN_0048d3d1 with the result globals, 'intro' = FUN_0048d390; returns the text calls (table: 'zone' / 'std' / 'literal') */
export function emuText(H, which, a = {}) {
  const { cpu, mem, G } = H;
  H.mirrorRecords(); H.writeGlobals();
  const ZONE = 0x5034, STD = 0x3a14, FONT = 0x5058;
  mem.w32(0x5d58034, ZONE); mem.w32(0x983a14, STD); mem.w32(0x5d58058, FONT);
  H.texts.length = 0;
  if (which === 'trick') { G.g.pepper.anim.start(a.clip, 0); H.mirrorRecords(); cpu.call(0x48d52b, []); }
  else if (which === 'banner') { mem.w32(0x5d580bc, a.finalScore); mem.w32(0x5d580c0, a.medal); mem.w8(0x5d580c4, a.newHi); cpu.call(0x48d3d1, []); }
  else cpu.call(0x48d390, []);
  return H.texts.map((t) => (t.panel ? { panel: t.panel } : { table: t.table === ZONE ? 'zone' : t.table === STD ? 'std' : t.table === 0 ? 'literal' : `?${t.table}`, text: t.text, x: t.x, y: t.y, wrap: t.wrap }));
}
