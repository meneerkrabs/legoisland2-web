// z03PPH (Pepper's house): the ORIGINAL engine passes and node code of the room run in the x86 emulation next to the port (tools/tests/m7-z03PPH-emu.mjs,
// docs/re/m3/z03PPH.md section "Differential test (WP-VERIFY)"). One frame of the loop FUN_0053dfda is run natively on a mirror of the port's records / controllers / nodes in
// emulated memory (resynchronised from the port before every tick):
//   FUN_0042226e (the engine's update pass, with the real node chain semantics: gates, return codes 1 / 2 / 3, ran bits)  ->  FUN_0053dfa2 (the loop's view matrix: FUN_0043cc5c)
//   ->  FUN_004225c5 (pre-render pass)  ->  FUN_0042271b (draw pass: the nodes' draw hooks, every FUN_00444480 / FUN_0043f1a0 / FUN_0043cc5c is logged with the view that is active)
// The node code (vtables at 0x8eb480 PeppComp, 0x8eb538 PeppHse, 0x8eb568 DOOR, 0x8eb580 LND1, 0x8eb640 / 0x8eb658 trophies, 0x8eb670 browser, 0x8eb688 map, 0x8eb7b8 ClimLadr) runs natively
// from the executable; the constructors run natively into zeroed node memory (the allocator clears) to give the constant tables. Hosted from the decompile: game variables, sounds
// (FUN_004435a0 logged by sound id), the model getters, the draw call, the view transform FUN_0043cc5c (logs eye / target / up of the camera it is given: nothing else of the render
// device exists here) and the computer menu step FUN_0053fbc0 (the menu is not the subject). The walk node SGwalk is not in the scenarios' chain (Pepper is placed by script).
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';

export const RB = 0x30000000, NB = 0x31000000, CB = 0x32000000, MB = 0x35000000;
const NSTRIDE = 0x100;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export const f32 = (v) => { F32[0] = v; return F32[0]; };
export const bitsOf = (v) => { F32[0] = v; return U32[0]; };
export function makeRng(seed) { const g = { s: seed >>> 0 }; g.next = () => { g.s = (Math.imul(g.s, 1664525) + 1013904223) >>> 0; return g.s / 4294967296; }; return g; }

export const VT = { ClimLadr: 0x8eb7b8, PeppComp: 0x8eb480, PeppHse: 0x8eb538, Door: 0x8eb568, PeppHseLand: 0x8eb580, Trophy: 0x8eb640, TrophyIsland: 0x8eb658, TrophyBrowser: 0x8eb670, MapView: 0x8eb688 };
export const CTOR = { ClimLadr: 0x5421af, PeppComp: 0x5400d5, PeppHse: 0x5408c4, Door: 0x540db1, PeppHseLand: 0x540f4e, Trophy: 0x54116c, TrophyIsland: 0x5413c4, TrophyBrowser: 0x541b79, MapView: 0x541f94 };
export const G = {
  doorOpen: 0x5d587ac, leave: 0x5d587b0, icon: 0x5d4e144, computerActive: 0x5d58784, line1: 0x5d4dd7c, line2: 0x5d4de4c, line3: 0x5d4df1c, camera: 0x9da5e8, held: 0x98383c, pressed: 0x983840,
  frozen: 0x9da5c8, frame: 0x9da5cc, focus: 0x9da5d0, fx: 0x5d58790, dt: 0x8b1718,
};

export function createHarness(ctx, w) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  cpu.cw = process.env.M7_CW ? +process.env.M7_CW : 0x7f;      // the original runs the x87 in 24-bit precision (Direct3D leaves single precision)
  const mem = cpu.mem;
  const rs = w.records;
  const NREC = rs.length;
  for (const [lo, n] of [[RB, NREC * 0x68], [NB, NREC * NSTRIDE * 3], [CB, NREC * 0x80], [MB, 0x20000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
  const H = { cpu, mem, w, log: [], views: [], draws: [], handles: new Map(), unhooked: new Set(), pe, vars: new Int32Array(w.vars.a.length), calls: 0 };
  const recPtr = (r) => RB + r.index * 0x68;
  const hook = (a, fn) => cpu.hooks.set(a, fn);
  const push = (e) => { H.log.push(e); };
  const pepper = w.focus;
  H.pepper = pepper;

  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  hook(0x4435a0, (c) => { push(['snd', H.handles.get(c.arg(0))]); });
  const vget = (i) => (i === 1 ? 0 : i === 2 ? 1 : H.vars[i] | 0);
  hook(0x417575, (c) => { cpu.eax = vget(c.arg(0)); });
  hook(0x417597, (c) => { const i = c.arg(0); if (i !== 1 && i !== 2) H.vars[i] = c.arg(1) | 0; });
  hook(0x41761b, (c) => { const i = c.arg(0); if (i !== 1 && i !== 2) H.vars[i] |= c.arg(1); });
  hook(0x41766c, (c) => { const i = c.arg(0); if (i !== 1 && i !== 2) H.vars[i] &= ~c.arg(1); });
  hook(0x4201aa, () => {});                                    // menu reset (the menu is not the subject)
  hook(0x53fbc0, (c) => { cpu.eax = H.menuLeaves ? 1 : 0; });  // the menu step of the computer's draw hook
  hook(0x439126, () => { cpu.eax = 1; }); hook(0x439788, () => { cpu.eax = MB + 0x18000; mem.w8(MB + 0x18000, 0); });
  hook(0x444370, () => {}); hook(0x88fc6f, () => {});      // frustum update of the loop's view step; the 3D sound listener setup of the PeppHse constructor                                    // frustum update of the loop's view step
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  // the view transform: FUN_0043cc5c(matrix buffer, camera) builds the look-at from the camera block (eye +0, target +0xc, up +0x18) and sets the device's view; here it only logs which camera it got
  let viewNo = 0, phase = '';
  hook(0x43cc5c, (c) => {
    const p = c.arg(1);
    H.views.push({ no: ++viewNo, phase, from: cpu.callAt, eye: [0, 1, 2].map((i) => mem.f32(p + 4 * i)), target: [0, 1, 2].map((i) => mem.f32(p + 0xc + 4 * i)), up: [0, 1, 2].map((i) => mem.f32(p + 0x18 + 4 * i)) });
  });
  // the draw calls: the record draw (FUN_00444480(rec, ...)) with the view active at that moment, and the part draw of the trophies (FUN_0043f160 / 180 / 1a0)
  hook(0x444480, (c) => { H.draws.push({ rec: (c.arg(0) - RB) / 0x68, view: viewNo }); });
  hook(0x43f160, (c) => { cpu.eax = 0x100 + c.arg(1); });
  hook(0x43f180, (c) => { cpu.eax = 0x100 + c.arg(1); });
  hook(0x43f1a0, (c) => { H.draws.push({ rec: (c.arg(1) - 0xc - RB) / 0x68, part: c.arg(0) - 0x100, view: viewNo }); });

  cpu.exec = [[0x53df00, 0x543000], [0x422100, 0x422a00], [0x858d30, 0x873e00], [0x43a4a1, 0x43b000], [0x43cec0, 0x43cf30]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z03PPH emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt.toString(16)}`); };
  cpu.invalidate();
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };
  H.setPhase = (p) => { phase = p; };
  cpu.call(0x53e7c0, []);                                      // the sound set (handles of the trophy jingles)
  H.soundIdOf = (h) => H.handles.get(h);

  // ---- records, controllers and node chains (the layout the engine functions read: controller +0 first node, +4 exclusive, +8 ran bits, +0xc flags, +0x18 distance;
  //      node +0 var, +4 vtable, +8 stamp, +0xc mask, +0xe value, +0x10 next)
  const ctrlPtr = (r) => CB + r.index * 0x80;
  const nodeSlots = new Map();          // record -> [{ node (port), ptr }]
  let nbNext = NB;
  const allocNode = () => { const p = nbNext; nbNext += NSTRIDE; return p; };
  for (const r of rs) {
    if (!r.ctrl) continue;
    nodeSlots.set(r, r.ctrl.nodes.map((n) => ({ node: n, ptr: allocNode() })));
  }
  H.nodeSlots = nodeSlots;
  const slotOf = (r, kind) => nodeSlots.get(r)?.find((s) => s.node.kind === kind);
  H.slotOf = slotOf;
  const mirrorRecords = () => {
    for (const r of rs) {
      const p = recPtr(r);
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, 0x70000000 + r.index);
      mem.w32(p + 8, 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, 0); mem.w32(p + 0x5c, r.ctrl ? ctrlPtr(r) : 0);
      mem.w16(p + 0x60, r.flags & 0xffff);
      if (r.ctrl) {
        const slots = nodeSlots.get(r), c = ctrlPtr(r);
        mem.w32(c, slots.length ? slots[0].ptr : 0); mem.w32(c + 4, 0); mem.w32(c + 8, 0); mem.w32(c + 0xc, r.ctrl.flags);
        slots.forEach((s, i) => {
          mem.w32(s.ptr + 0x10, i + 1 < slots.length ? slots[i + 1].ptr : 0);
          mem.w32(s.ptr + 4, VT[s.node.kind]);
          mem.w32(s.ptr, s.node.var); mem.w16(s.ptr + 0xc, s.node.mask); mem.w16(s.ptr + 0xe, s.node.value);
          mem.w32(s.ptr + 8, 0xfffffffe);
        });
      }
    }
  };
  const readRec = (r) => { const p = recPtr(r); return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) }; };

  // ---- node state: the dynamic fields (the constant tables come from the native constructors)
  const f3 = (p) => [0, 1, 2].map((i) => mem.f32(p + 4 * i));
  const w3 = (p, v) => { for (let i = 0; i < 3; i++) mem.wf32(p + 4 * i, v[i]); };
  const NODE = {
    PeppHse: {
      write(n, p, st) { w3(p + 0x98, st.camCur); mem.w32(p + 0xa4, st.camIdx); },
      read(p) { return { camCur: f3(p + 0x98), camIdx: mem.r32(p + 0xa4) }; },
      ts(n, st) { return { camCur: [...st.camCur], camIdx: st.camIdx }; },
    },
    Door: {
      write(n, p) { mem.w32(p + 0x18, n.state); mem.wf32(p + 0x1c, n.angle); },
      read(p) { return { state: mem.r32(p + 0x18), angle: mem.f32(p + 0x1c) }; },
      ts(n) { return { state: n.state, angle: n.angle }; },
    },
    TrophyBrowser: {
      write(n, p, st) {
        mem.w32(p + 0x18, RB + st.trophyIndex * 0x68); w3(p + 0x1c, st.browseFocus); mem.w32(p + 0x4c, st.browseState); mem.w32(p + 0x54, n.moved ? 1 : 0);
        w3(p + 0x28, [10.4, 10.0, -11.52].map(f32));         // the home copy: set when the state is -1 (or written by the constructor's caller), equal to the port's BROWSE_HOME
      },
      read(p) { return { trophy: (mem.u32(p + 0x18) - RB) / 0x68, focus: f3(p + 0x1c), state: mem.r32(p + 0x4c), moved: mem.r32(p + 0x54) }; },
      ts(n, st) { return { trophy: st.trophyIndex, focus: [...st.browseFocus], state: st.browseState, moved: n.moved ? 1 : 0 }; },
    },
    MapView: {
      write(n, p, st) { w3(p + 0x18, st.mapFocus); mem.w32(p + 0x54, st.mapState); w3(p + 0x24, [10.4, 10.0, -11.52].map(f32)); },
      read(p) { return { focus: f3(p + 0x18), state: mem.r32(p + 0x54) }; },
      ts(n, st) { return { focus: [...st.mapFocus], state: st.mapState }; },
    },
  };
  H.NODE = NODE;
  /** the constructors, natively, into zeroed memory: constants (tables, vtable-independent) the port has to agree with */
  H.runCtors = () => {
    mirrorRecords();
    const out = {};
    for (const [r, slots] of nodeSlots) for (const s of slots) {
      const k = s.node.kind;
      for (let o = 0; o < NSTRIDE; o += 4) mem.w32(s.ptr + o, 0);
      mem.w32(s.ptr + 4, VT[k]);
      let args = 0;
      if (k === 'Trophy' || k === 'TrophyIsland') { args = MB + 0x1000; mem.w32(args, s.node.trophyVar); mem.w32(args + 4, s.node.hiscoreVar); mem.w32(args + 8, s.node.sound); }
      cpu.steps = 0;
      cpu.call(CTOR[k], [recPtr(r), args, s.ptr, s.node.var, s.node.mask, s.node.value]);
      out[`${r.name}.${k}`] = { ptr: s.ptr, gate: [mem.r32(s.ptr), mem.r16(s.ptr + 0xc), mem.r16(s.ptr + 0xe)] };
    }
    return out;
  };
  const writeGlobals = (st) => {
    mem.w32(G.doorOpen, st.doorOpen ? 1 : 0); mem.w32(G.leave, st.leave ? 1 : 0); mem.w32(G.icon, st.icon); mem.w32(G.computerActive, 0);
    const put = (a, s) => { for (let i = 0; i < 64; i++) mem.w8(a + i, i < s.length ? s.charCodeAt(i) : 0); };
    put(G.line1, st.lines.line1); put(G.line2, st.lines.line2); put(G.line3, st.lines.line3);
    for (let i = 0; i < 9; i++) mem.wf32(G.camera + 4 * i, w.camera.c[i]);
    mem.w32(G.focus, recPtr(pepper)); mem.w32(G.frozen, 0); mem.w32(G.frame, w.frame);
    mem.wf32(G.dt, w.dt);     // DAT_008b1718: the frame time factor (1.0 at 30 Hz, 0.5 at the 60 Hz step)
  };
  const readGlobals = () => ({
    doorOpen: mem.r32(G.doorOpen), leave: mem.r32(G.leave), icon: mem.r32(G.icon),
    line1: mem.cstr(G.line1, 64), line2: mem.cstr(G.line2, 64), line3: mem.cstr(G.line3, 64),
    camera: Array.from({ length: 9 }, (_, i) => mem.f32(G.camera + 4 * i)),
  });
  H.readGlobals = readGlobals;

  /** one frame of the loop in the original, from the port's state */
  H.frame = (st, held, pressed, o = {}) => {
    H.log.length = 0; H.views.length = 0; H.draws.length = 0; H.menuLeaves = !!o.menuLeaves;
    mirrorRecords(); writeGlobals(st);
    H.vars.set(w.vars.a);
    mem.w32(G.held, held); mem.w32(G.pressed, pressed);
    for (const [r, slots] of nodeSlots) for (const s of slots) if (NODE[s.node.kind]) NODE[s.node.kind].write(s.node, s.ptr, st);
    const mat = MB + 0x2000, camAddr = G.camera;
    cpu.steps = 0;
    try {
      H.setPhase('update'); cpu.call(0x42226e, [RB, NREC], { maxSteps: 4e6 });
      const ran = [...nodeSlots].map(([r, slots]) => [r, mem.r32(ctrlPtr(r) + 8)]);
      H.ran = new Map(ran);
      const camAfterUpdate = Array.from({ length: 9 }, (_, i) => mem.f32(camAddr + 4 * i));
      H.setPhase('view'); cpu.call(0x53dfa2, [mat], { maxSteps: 4e6 });
      H.setPhase('prerender'); cpu.call(0x4225c5, [RB, NREC], { maxSteps: 4e6 });
      const camAfterPre = Array.from({ length: 9 }, (_, i) => mem.f32(camAddr + 4 * i));
      H.setPhase('draw'); cpu.call(0x42271b, [RB, NREC, mat, camAddr], { maxSteps: 4e6 });
      H.camAfterUpdate = camAfterUpdate; H.camAfterPre = camAfterPre;
    } catch (e) { e.message += ' [z03PPH frame]'; throw e; }
    const nodes = [];
    for (const [r, slots] of nodeSlots) for (const s of slots) if (NODE[s.node.kind]) nodes.push([r.index, s.node.kind, NODE[s.node.kind].read(s.ptr)]);
    return { recs: rs.map(readRec), nodes, globals: readGlobals(), log: H.log.slice(), vars: Int32Array.from(H.vars), ran: H.ran, views: H.views.slice(), draws: H.draws.slice(), camAfterUpdate: H.camAfterUpdate, camAfterPre: H.camAfterPre };
  };
  H.tsRecs = () => rs.map((r) => ({ m: Array.from(r.m), e: [r.rx, r.ry, r.rz], flags: r.flags & 0xffff }));
  H.tsNodes = (st) => { const out = []; for (const [r, slots] of nodeSlots) for (const s of slots) if (NODE[s.node.kind]) out.push([r.index, s.node.kind, NODE[s.node.kind].ts(s.node, st)]); return out; };
  H.recPtr = recPtr; H.ctrlPtr = ctrlPtr; H.mirrorRecords = mirrorRecords; H.readRec = readRec; H.rs = rs; H.writeGlobals = writeGlobals; H.NREC = NREC;
  return H;
}
