// z50LTC ("Meet the team" cave): the ORIGINAL code of the room run in the x86 emulation next to the port (tools/tests/m7-z50LTC-emu.mjs, docs/re/m3/z50LTC.md section
// "Differential test (WP-VERIFY)"). Per tick the engine's three passes of the room's nodes (FUN_0042226e update with the node chain semantics, FUN_004225c5 pre-render, FUN_0042271b
// draw) run on a mirror of the port's records / nodes in emulated memory, resynchronised from the port before every tick, then the port ticks:
//   People  FUN_00839e20 (update) / FUN_0083a292 (pre-render)    pepswitc FUN_0083a9e0 / 0083aa48 / 0083aa8d    the box portal FUN_0051e5ab (+ its constructor 0051ea3c)
//   the constructors FUN_0083a7d2 (People), 0083ab7b (pepswitc), the set-up piece FUN_00839560 (sound handles) and FUN_00429e00 (the slope alignment of the talk start)
// run natively. The walk node SGwalk (0x42d514, verified by the other WP-VERIFY walk oracle) is represented by its first action in the room, `DAT_008ae330 = 576.0` at 0x42d554 (the walk
// itself is not run: the scenarios place Pepper by script). Host stand-ins (engine services, from the decompile): animation instances (shadow state, clip table from the port's rig),
// game variables, sound / emitter / twinkle calls (logged), the HUD text slots (the strings are copied natively by the CRT), FUN_0045f750 (bars), and the two collision queries
// FUN_0043cd62 (terrain height) / FUN_00441ac0 (probe) / FUN_00441270 (sweep) over the port's own collision world (the collision code is not the subject here).
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';

export const RB = 0x30000000, NB = 0x31000000, CB = 0x32000000, AB = 0x33000000, MB = 0x35000000;
const NSTRIDE = 0x100;
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export const f32 = (v) => { F32[0] = v; return F32[0]; };
export const bitsOf = (v) => { F32[0] = v; return U32[0]; };
export function makeRng(seed) { const g = { s: seed >>> 0 }; g.next = () => { g.s = (Math.imul(g.s, 1664525) + 1013904223) >>> 0; return g.s / 4294967296; }; return g; }

export const ADDR = {
  toggle: 0x5d5f6dc, timer: 0x5d5f6e0, candidate: 0x9daa80, candDist: 0x8ae330, focus: 0x9da5d0, name: 0x5d4df1c, role: 0x5d4dfec, slot1: 0x5d4dd7c, slot2: 0x5d4de4c, letterbox: 0x5d4dcbc,
  camera: 0x9da5e8, sea: 0x9da858, dt: 0x8b1718, invDt: 0x8b171c, held: 0x98383c, pressed: 0x983840, sounds: 0x5d5f660, table: 0x95d2c0,
};

export function createHarness(ctx, w, o = {}) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  cpu.cw = process.env.M7_CW ? +process.env.M7_CW : 0x7f;      // the original runs the x87 in 24-bit precision (Direct3D leaves single precision)
  const mem = cpu.mem;
  const rs = w.records;
  const NREC = rs.length;
  for (const [lo, n] of [[RB, NREC * 0x68], [NB, NREC * NSTRIDE], [CB, NREC * 0x80], [AB, NREC * 0x40], [MB, 0x20000]]) mem.addRegion({ lo, hi: lo + n + 0x100, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
  const H = { cpu, mem, w, log: [], handles: new Map(), unhooked: new Set(), pe, dt: 1, calls: {}, vars: new Int32Array(w.vars.a.length) };
  const recPtr = (r) => RB + r.index * 0x68;
  const idxOfPtr = (p) => (p === 0 ? -1 : (p - RB) / 0x68);
  const hook = (a, fn) => cpu.hooks.set(a, fn);
  const push = (e) => { H.log.push(e); };
  const pepper = w.focus;
  H.pepper = pepper;

  // ---- sounds / emitters / twinkle: tokens map back to the person
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['snd', H.handles.get(c.arg(0)), f32(mem.f32(p)), f32(mem.f32(p + 4)), f32(mem.f32(p + 8))]); });
  hook(0x44ea60, (c) => { const t = c.arg(0); push(['twinkle', t - 0x4000, c.arg(1) === 2]); });                      // FUN_0044ea60(handle, 2 = start / 1 = stop, 1, 1)
  hook(0x442a20, (c) => { const t = c.arg(0); push(['paul', (t & 0xfff), c.arg(1) === 2]); });                       // FUN_00442a20(emitter, 2 start / 1 stop, 1, 1)
  hook(0x442a00, () => {});                                                                                           // emitter matrix
  hook(0x442960, () => { cpu.eax = 0x5000; }); hook(0x442a50, () => {}); hook(0x44e920, (c) => { cpu.eax = 0x4000; });   // creation (constructor run only)
  hook(0x43bc58, (c) => { cpu.eax = MB + 0x10000; });                                                                 // the hand bones' pose (the emitters' matrices: not compared)
  hook(0x4359d5, () => {}); hook(0x41f17c, () => {});
  hook(0x444480, () => {});
  hook(0x445ba0, () => {});
  hook(0x45f750, (c) => { mem.w32(ADDR.letterbox, c.arg(0)); mem.w32(0x5d4dcb8, 1); push(['bars', c.arg(0)]); });
  // ---- game variables: a copy of the port's (synced per tick)
  const vget = (i) => (i === 1 ? 0 : i === 2 ? 1 : H.vars[i] | 0);
  hook(0x417575, (c) => { cpu.eax = vget(c.arg(0)); });
  hook(0x417597, (c) => { const i = c.arg(0); if (i !== 1 && i !== 2) H.vars[i] = c.arg(1) | 0; });
  hook(0x41761b, (c) => { const i = c.arg(0); if (i !== 1 && i !== 2) H.vars[i] |= c.arg(1); });
  hook(0x41766c, (c) => { const i = c.arg(0); if (i !== 1 && i !== 2) H.vars[i] &= ~c.arg(1); });
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });

  // ---- animation instances: shadow state at AB + index * 0x40 (+0x0c clip, +0x10 frame), the clip table from the port's rig
  const animIdx = (ptr) => (ptr - AB) / 0x40;
  const rigOf = (ptr) => rs[animIdx(ptr)].anim.rig;
  const clipOf = (ptr) => rigOf(ptr).clips[mem.r32(ptr + 0xc)] ?? null;
  const frameOf = (ptr) => mem.f32(ptr + 0x10);
  hook(0x43b6a3, (c) => {
    const a = c.arg(0), clip = c.arg(1) | 0, sf = c.argf(2), rig = rigOf(a);
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
  hook(0x43b76a, (c) => {
    const a = c.arg(0), rate = c.argf(1), cd = clipOf(a);
    let res = 0;
    if (cd) {
      let f = f32(rate * H.dt + frameOf(a));
      let n = cd.frameCount;
      if (n < 1) n = 1;
      if ((cd.flags & 0x10) === 0) {
        if (n - 1 < f) { if (n <= 1) f = 0; else do f = f32(f - (n - 1)); while (n - 1 < f); res = 2; }
      } else if (n <= f) { do f = f32(f - n); while (n <= f); res = 1; }
      mem.wf32(a + 0x10, f);
    }
    c.eax = res;
  });

  // ---- collision queries over the port's world (records re-read from the emulated memory: a node before this one in the pass may have moved them)
  const syncFromMem = () => { for (const r of rs) { const p = recPtr(r); for (let i = 0; i < 16; i++) r.m[i] = mem.f32(p + 0xc + 4 * i); r.flags = (r.flags & ~0xffff) | mem.r16(p + 0x60); } };
  hook(0x441270, (c) => {
    syncFromMem();
    const ig = rs[idxOfPtr(c.arg(0))] ?? null, f = [0, 1, 2].map((i) => mem.f32(c.arg(1) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(c.arg(2) + 4 * i));
    const h = w.col.sweep(ig, f, d, c.arg(5), c.argf(6), c.argf(7));
    if (!h) { c.eax = 0; return; }
    for (let i = 0; i < 3; i++) { mem.wf32(c.arg(3) + 4 * i, h.normal[i]); mem.wf32(c.arg(4) + 4 * i, h.point[i]); }
    c.eax = recPtr(h.rec);
  });
  hook(0x441ac0, (c) => {
    syncFromMem();
    const ig = rs[idxOfPtr(c.arg(0))] ?? null, f = [0, 1, 2].map((i) => mem.f32(c.arg(1) + 4 * i)), d = [0, 1, 2].map((i) => mem.f32(c.arg(2) + 4 * i));
    const h = w.col.probe(ig, f, d, c.arg(5));
    if (!h) { c.eax = 0; return; }
    for (let i = 0; i < 3; i++) { mem.wf32(c.arg(3) + 4 * i, h.normal[i]); mem.wf32(c.arg(4) + 4 * i, h.point[i]); }
    c.eax = recPtr(h.rec);
  });
  hook(0x43cd62, (c) => { const p = c.arg(0); c.fpush(w.col.terrainHeight(mem.f32(p), mem.f32(p + 4), mem.f32(p + 8), c.argf(1))); });

  cpu.exec = [[0x839000, 0x83b000], [0x51e5ab, 0x51eba5], [0x429e00, 0x42a487], [0x42216f, 0x4221f2], [0x858d30, 0x873e00], [0x43a4a1, 0x43b000], [0x43cec0, 0x43cf30]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z50LTC emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt.toString(16)}`); };
  cpu.invalidate();
  H.reset = () => { cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };
  // the sound handles (FUN_00839560, natively): DAT_05d5f660[k]
  cpu.call(0x839560, []);
  H.soundOf = (k) => H.handles.get(mem.u32(ADDR.sounds + 4 * k));

  // ---- mirrors
  const nodePtr = (r) => NB + r.index * NSTRIDE;
  const ctrlPtr = (r) => CB + r.index * 0x80;
  const peopleRecs = rs.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'People'));
  const nodeKinds = new Map();      // record -> [{ kind, node }]
  for (const r of rs) if (r.ctrl) nodeKinds.set(r, r.ctrl.nodes);
  const mirrorRecords = () => {
    for (const r of rs) {
      const p = recPtr(r);
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, 0x70000000 + r.index);
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, 0); mem.w32(p + 0x5c, r.ctrl ? ctrlPtr(r) : 0);
      mem.w16(p + 0x60, r.flags & 0xffff);
      if (r.ctrl) { mem.w32(ctrlPtr(r) + 0xc, r.ctrl.flags); mem.w32(ctrlPtr(r) + 0x1c, 0); }
      if (r.anim) { const a = AB + r.index * 0x40; mem.w32(a + 0xc, r.anim.clip); mem.wf32(a + 0x10, r.anim.frame); }
    }
  };
  const readRec = (r) => { const p = recPtr(r); return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) }; };
  const NODE = {
    People: {
      write(n, p, r) {
        mem.w32(p + 0x14, n.index); mem.w32(p + 0x18, 0x4000 + r.index); mem.w32(p + 0x1c, 0x5000 + r.index); mem.w32(p + 0x20, 0x6000 + r.index);
        mem.w8(p + 0x24, n.pushed ? 1 : 0); mem.w8(p + 0x25, n.twinkle); for (let i = 0; i < 3; i++) mem.wf32(p + 0x28 + 4 * i, n.saved[i]);
        mem.w16(p + 0x34, n.talk); mem.w16(p + 0x36, n.reacted);
      },
      read(p) { return { pushed: mem.r8(p + 0x24), twinkle: mem.r8(p + 0x25), saved: [0, 1, 2].map((i) => mem.f32(p + 0x28 + 4 * i)), talk: (mem.r16(p + 0x34) << 16) >> 16, reacted: (mem.r16(p + 0x36) << 16) >> 16 }; },
      ts(n) { return { pushed: n.pushed ? 1 : 0, twinkle: n.twinkle, saved: [...n.saved], talk: n.talk, reacted: n.reacted }; },
    },
    pepswitc: {
      write(n, p) { for (let i = 0; i < 3; i++) mem.wf32(p + 0x14 + 4 * i, n.home[i]); },
      read(p) { return { home: [0, 1, 2].map((i) => mem.f32(p + 0x14 + 4 * i)) }; },
      ts(n) { return { home: [...n.home] }; },
    },
  };
  NODE['StartCSM.portal'] = {
    // the constant fields come from the native constructor (FUN_0051ea3c, `H.portalCtor`); the dynamic ones follow the port
    // `last` (the previous tick's squared distance) keeps the original's own float32 value while the port's (double) value is the same number: the comparison `dist < last` of a player who stands
    // still is an equality in both, writing the port's double rounded to float32 would make it spuriously smaller than the original's own distance (FUN_0042216f rounds every difference)
    write(n, p) { const cur = mem.f32(p + 0x3c); if (Math.abs(cur - n.last) > 1e-6 * Math.max(1, Math.abs(n.last))) mem.wf32(p + 0x3c, n.last); mem.wf32(p + 0x40, n.age); },
    read(p) { return { last: mem.f32(p + 0x3c), age: mem.f32(p + 0x40) }; },
    ts(n) { return { last: n.last, age: n.age }; },
  };
  /** FUN_0051ea3c(rec, args, node, var, mask, value) on the argument block of the port's PortalArgs (words as FUN_00839748 stores them) */
  H.portalCtor = (r, a, n) => {
    const b = MB + 0x8000;
    for (let i = 0; i < 12; i++) mem.w32(b + 4 * i, 0);
    for (let i = 0; i < 3; i++) mem.wf32(b + 4 * i, a.half[i]);
    mem.w32(b + 0xc, a.orVar); mem.w32(b + 0x10, a.orBits); mem.w16(b + 0x14, a.table); mem.w16(b + 0x18, a.target);
    mem.w8(b + 0x1a, a.faceCamera ? 1 : 0); mem.w8(b + 0x1b, a.spin ? 1 : 0); mem.w32(b + 0x1c, a.keyMask); mem.w32(b + 0x20, a.iconBits);
    const p = nodePtr(r);
    for (let o = 0; o < NSTRIDE; o += 4) mem.w32(p + o, 0);
    cpu.steps = 0; cpu.call(0x51ea3c, [recPtr(r), b, p, n.var, n.mask, n.value]);
    return { half: [0, 1, 2].map((i) => mem.f32(p + 0x14 + 4 * i)), radius2: mem.f32(p + 0x20), orVar: mem.r32(p + 0x24), orBits: mem.r32(p + 0x28), table: (mem.r16(p + 0x2c) << 16) >> 16, target: (mem.r16(p + 0x2e) << 16) >> 16,
      face: mem.r8(p + 0x30), spin: mem.r8(p + 0x31), keyMask: mem.r32(p + 0x34), icon: mem.r32(p + 0x38), last: mem.f32(p + 0x3c), age: mem.f32(p + 0x40), gate: [mem.r32(p), mem.r16(p + 0xc), mem.r16(p + 0xe)] };
  };
  /** DAT_05d58688: rows of 3 record pointers (FUN_0051e475 sets them); `rows` = arrays of records / null */
  H.setPortalTable = (rows) => { for (let g = 0; g < 4; g++) for (let i = 0; i < 3; i++) mem.w32(0x5d58688 + g * 12 + i * 4, rows?.[g]?.[i] ? recPtr(rows[g][i]) : 0); };
  H.NODE = NODE;
  const UPDATE = { People: 0x839e20, pepswitc: 0x83a9e0 };
  const PRERENDER = { People: 0x83a292, pepswitc: 0x83aa48 };
  const DRAW = { pepswitc: 0x83aa8d };
  H.UPDATE = UPDATE;

  const writeGlobals = (g) => {
    mem.w32(ADDR.toggle, g.toggle); mem.wf32(ADDR.timer, g.timer); mem.w32(ADDR.candidate, g.candidate ? recPtr(rs[g.candidate.entry.record]) : 0); mem.wf32(ADDR.candDist, g.candDist);
    mem.w32(ADDR.focus, recPtr(pepper));
    const put = (a, s) => { for (let i = 0; i < 64; i++) mem.w8(a + i, i < s.length ? s.charCodeAt(i) : 0); };
    put(ADDR.name, g.name); put(ADDR.role, g.role); mem.w32(ADDR.slot1, 0); mem.w32(ADDR.slot2, 0);
    mem.w32(ADDR.letterbox, g.letterbox);
    mem.wf32(ADDR.sea, w.seaLevel);
    for (let i = 0; i < 6; i++) mem.wf32(ADDR.camera + 4 * i, w.camera.c[i]);
  };
  const readGlobals = () => ({
    toggle: mem.r32(ADDR.toggle), timer: mem.f32(ADDR.timer), candidate: idxOfPtr(mem.u32(ADDR.candidate)), candDist: mem.f32(ADDR.candDist), name: mem.cstr(ADDR.name, 64), role: mem.cstr(ADDR.role, 64),
    letterbox: mem.r32(ADDR.letterbox),
  });
  H.globals = { write: writeGlobals, read: readGlobals };

  /** one engine frame of the room's nodes in the original: update pass with the chain semantics of FUN_0042226e, pre-render pass, draw pass */
  H.pass = (g, pressedMask, dtv = 1, hooks = {}) => {
    H.dt = dtv; H.log.length = 0;
    // the collision queries read the port's records: they are brought to the emulated state for the query (syncFromMem) and put back after the pass
    const saved = rs.map((r) => ({ m: Float32Array.from(r.m), flags: r.flags }));
    const colState = { lastHit: w.col.lastHit, cacheRec: w.col.cacheRec, cacheFrom: [...w.col.cacheFrom], cacheTo: [...w.col.cacheTo] };     // the ray hit cache of FUN_00441b10 is state of the collision world
    mirrorRecords(); writeGlobals(g);
    H.vars.set(w.vars.a);
    mem.wf32(ADDR.dt, dtv); mem.wf32(ADDR.invDt, 1 / dtv);
    mem.w32(ADDR.held, pressedMask); mem.w32(ADDR.pressed, pressedMask);
    for (const [r, nodes] of nodeKinds) for (const n of nodes) if (NODE[n.kind]) NODE[n.kind].write(n, nodePtr(r), r);
    const ran = new Map();
    // update pass
    for (const r of rs) {
      const c = r.ctrl;
      if (!c || (c.flags & 2) === 0) continue;
      // FUN_0042216f(rec, ...): the distance to the focus record (natively; y is zeroed by the function)
      cpu.steps = 0; cpu.call(0x42216f, [recPtr(r), 0]); mem.wf32(ctrlPtr(r) + 0x18, cpu.fpop());
      const flags = []; let stopped = false;
      ran.set(r, flags);
      for (let i = 0; i < c.nodes.length; i++) {
        const n = c.nodes[i];
        const varv = vget(n.var);
        if ((varv & n.mask) !== n.value) continue;
        let res = 0;
        if (UPDATE[n.kind]) {
          cpu.steps = 0;
          try { res = cpu.call(UPDATE[n.kind], [recPtr(r), nodePtr(r), ctrlPtr(r), varv], { maxSteps: 2000000 }) | 0; }
          catch (e) { e.message += ` [record ${r.index} ${r.name} ${n.kind}]`; throw e; }
          H.calls[n.kind] = (H.calls[n.kind] ?? 0) + 1;
        } else if (n.kind === 'SGwalk') {
          mem.wf32(ADDR.candDist, 576);        // 0x42d554: the first action of the walk node's update
          res = 2;
        } else if (n.kind === 'StartCSM.portal') {
          cpu.steps = 0; res = cpu.call(0x51e5ab, [recPtr(r), nodePtr(r), ctrlPtr(r)]) | 0; H.portalRets = (H.portalRets ?? new Set()).add(res);
          H.calls.portal = (H.calls.portal ?? 0) + 1;
        }
        if (res !== 0) flags[i] = true;
        if (res === 1) { stopped = true; break; }
      }
      // the walk node SGwalk follows pepswitc in Pepper's chain (gate var 0x5e & 1): its update starts with `DAT_008ae330 = 576.0` (0x42d554), the rest of it is not run here
      if (r === pepper && !stopped && (vget(0x5e) & 1) === 1) mem.wf32(ADDR.candDist, 576);
    }
    // pre-render pass
    for (const [r, flags] of ran) {
      const c = r.ctrl;
      for (let i = 0; i < c.nodes.length; i++) {
        if (!flags[i]) continue;
        const n = c.nodes[i];
        if (PRERENDER[n.kind]) {
          cpu.steps = 0;
          if (n.kind === 'People') cpu.call(PRERENDER.People, [recPtr(r), nodePtr(r)]);
          else cpu.call(PRERENDER.pepswitc, []);
        }
      }
    }
    // draw pass
    for (const [r, flags] of ran) {
      const c = r.ctrl;
      for (let i = 0; i < c.nodes.length; i++) {
        if (!flags[i]) continue;
        const n = c.nodes[i];
        if (DRAW[n.kind] && hooks.draw !== false) { cpu.steps = 0; cpu.call(DRAW[n.kind], [recPtr(r), nodePtr(r), 0, 0]); }
      }
    }
    rs.forEach((r, i) => { r.m.set(saved[i].m); r.flags = saved[i].flags; });
    Object.assign(w.col, colState);
    const nodes = [];
    for (const [r, ns] of nodeKinds) for (const n of ns) if (NODE[n.kind]) nodes.push([r.index, n.kind, NODE[n.kind].read(nodePtr(r))]);
    return { recs: rs.map(readRec), anims: rs.map((r) => (r.anim ? [mem.r32(AB + r.index * 0x40 + 0xc), mem.f32(AB + r.index * 0x40 + 0x10)] : null)), nodes, globals: readGlobals(), log: H.log.slice(), vars: Int32Array.from(H.vars) };
  };
  H.tsRecs = () => rs.map((r) => ({ m: Array.from(r.m), e: [r.rx, r.ry, r.rz], flags: r.flags & 0xffff }));
  H.tsNodes = () => { const out = []; for (const [r, ns] of nodeKinds) for (const n of ns) if (NODE[n.kind]) out.push([r.index, n.kind, NODE[n.kind].ts(n)]); return out; };
  H.recPtr = recPtr; H.nodePtr = nodePtr; H.ctrlPtr = ctrlPtr; H.mirrorRecords = mirrorRecords; H.readRec = readRec; H.rs = rs; H.idxOfPtr = idxOfPtr;
  return H;
}
