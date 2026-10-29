// M7 (WP-VERIFY): Pepper's walk, the collision queries and the chase camera run from the ORIGINAL code in the x86 emulation (src/formats/x86emu.ts) as an oracle
// for src/game/walk.ts / collision.ts / camera.ts (tools/tests/m7-walk-*.mjs, docs/re/engine-m1.md section "Differential test (WP-VERIFY)").
// Native from the user's own executable (addresses only, nothing stored): the collision loader FUN_0043f370 (the .col files of the zone, read through hosted file calls), the
// sweep FUN_00441270 with the polygon / grid / box code, the terrain ray FUN_0043cd62 / 004425f0 / 00441b10, the probe FUN_00441ac0, the walk node FUN_0042d514 with
// FUN_0042a654 / 0042a487 / 0042a88f / 00429e00 / 0042baf6, the chase camera FUN_0042c227, the view basis FUN_0043cc5c, matrix helpers and the C runtime.
// Hosted engine services (not the subject): animation instances (the port's AnimInstance of the oracle's own world, as in the other m5 / m6 harnesses), game variables, sounds
// (logged), the allocator and file functions, the keyboard / pad reader FUN_004376f9.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from './engine-load.mjs';
import { colMember } from '../../src/game/zone.ts';
import { decode } from '../../src/formats/x86.ts';

export const RB = 0x30000000;                 // record array
export const HEAP = 0x20000000, HEAP_SIZE = 0x8000000;
const REC = 0x68;
export const CAM = 0x9da5e8;                  // DAT_009da5e8: the camera (18 floats)
export const G = {                            // globals of the walk code
  dt: 0x8b1718, invDt: 0x8b171c, mailbox: 0x8ae088, groundRec: 0x9dec18, skipGround: 0x9dec1c, lastPoly: 0x9deb78, seaLevel: 0x9da858, gravity: 0x9da9bc,
  heldKeys: 0x98383c, pressedKeys: 0x983840, held2: 0x983848, frame: 0x9da5cc, surfaceFeet: 0x9da9ac, onObject: 0x9da9b4, flagB8: 0x9da9b8,
  footPhase: 0x9da9c4, footWrapped: 0x9da8ec, footIdx: 0x9da9c0, landSnd: 0x9da958, jumpVel: 0x9da9a8, accessory: 0x9daa7c, camVel: 0x9da9c8, camPreset: 0x9da5e0,
  vehicle: 0x987660, curSub: 0, ncount: 0x983800, nbase: 0x983804,
};
const F32 = new Float32Array(1);
export const f32 = (v) => { F32[0] = v; return F32[0]; };
export const CRT = [0x858d30, 0x873e00];

/**
 * @param ctx test context (dataRoot, archives)
 * @param zone zone name (the archive that holds the .col files)
 * @param records the port world's records (GameRecord[]): names, matrices, flags, collision objects
 */
export function createEmu(ctx, zone, records) {
  const pe = loadExe(ctx.dataRoot);
  const cpu = createCpu(pe);
  const mem = cpu.mem;
  mem.addRegion({ lo: RB, hi: RB + records.length * REC + 0x100, name: 'records' });
  mem.addRegion({ lo: HEAP, hi: HEAP + HEAP_SIZE, name: 'heap' });
  let heap = HEAP;
  const alloc = (size) => { const p = heap; heap = (heap + Math.max(4, size) + 15) & ~15; if (heap > HEAP + HEAP_SIZE) throw new Error('m7 emu: heap exhausted'); return p; };
  // Direct3D 7 leaves the x87 in 24-bit precision (no DDSCL_FPUPRESERVE in any SetCooperativeLevel call; the CRT's sin / cos / atan2 switch to 0x27f themselves): every arithmetic result rounds to a float
  // mantissa, so the oracle runs the original in that mode (cw 0x7f), as the render oracles do. M7_CW=0x27f runs the 53 bit mode for comparison.
  cpu.cw = process.env.M7_CW ? Number(process.env.M7_CW) : 0x7f;
  const E = { cpu, mem, pe, records, alloc, log: [], unhooked: new Map(), objs: new Map(), objPtr: new Map(), randQ: [] };
  const archive = ctx.archives.find((a) => a.name.toLowerCase() === zone.toLowerCase());
  const hook = (addr, fn) => cpu.hooks.set(addr, fn);
  E.hook = hook;

  // ---- file functions of the collision loader (FUN_0043f370: FUN_00435843 open, FUN_00435350 read, FUN_004358e9 close; FUN_00443c70 and the allocator)
  const files = new Map(); let nextFile = 0x7100;
  hook(0x435843, (c) => {
    const path = mem.cstr(c.arg(0));
    const m = colMember(path);
    const ent = archive.find(m);
    if (!ent) { c.eax = 0; return; }
    const h = nextFile++; files.set(h, { data: archive.read(ent), pos: 0 }); c.eax = h;
  });
  hook(0x435350, (c) => {
    const f = files.get(c.arg(3)); const buf = c.arg(0), size = c.arg(1), count = c.arg(2);
    let n = 0;
    while (n < count && f.pos + size <= f.data.length) { for (let i = 0; i < size; i++) mem.w8(buf + n * size + i, f.data[f.pos + i]); f.pos += size; n++; }
    c.eax = n;
  });
  hook(0x4358e9, (c) => { files.delete(c.arg(0)); });
  hook(0x443c70, () => {});
  hook(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });
  hook(0x433d60, () => {});
  hook(0x445ba0, () => {});        // debug line draw of the box shape (FUN_00440f30 -> FUN_00440ac0)
  hook(0x858d30, (c) => { c.eax = alloc(c.arg(0)); });

  // ---- records in emulated memory (layout of the original: name +0, anim +8, matrix +0xc, Euler +0x4c, collision +0x58, controller +0x5c, flags +0x60 (u16), variant +0x64)
  E.recPtr = (r) => RB + r.index * REC;
  E.recOfPtr = (p) => (p === 0 ? null : records[(p - RB) / REC]);
  mem.w32(G.nbase, RB); mem.w32(G.ncount, records.length);
  const path0 = alloc(128);
  const loadCol = (obj) => {
    if (E.objPtr.has(obj)) return E.objPtr.get(obj);
    const s = obj.path; for (let i = 0; i < s.length; i++) mem.w8(path0 + i, s.charCodeAt(i)); mem.w8(path0 + s.length, 0);
    cpu.steps = 0;
    const p = cpu.call(0x43f370, [path0], { maxSteps: 5e7 });
    if (p === 0xbabababa) throw new Error(`m7 emu: the original loader rejects ${s}`);
    // the analytic box shape of the zone's set-up (FUN_004427e0 / 00442780 / 004428b0, run with the port's dimensions: the set-up tables are not the subject)
    E.objPtr.set(obj, p); E.objs.set(p, obj);
    return p;
  };
  E.syncColObjects = () => {
    for (const r of records) {
      const o = r.colObj; if (!o) continue;
      const p = loadCol(o);
      if (o.shape === 3) {
        // write shape, box, radius like FUN_00442780 does (the call itself is run natively with a dummy record)
        mem.w32(p + 0x4c, 3); mem.wf32(p + 0x58, o.box[0]); mem.wf32(p + 0x5c, o.box[1]); mem.wf32(p + 0x60, o.box[2]); mem.wf32(p + 0x24, o.radius);
      }
    }
  };
  E.mirrorRecord = (r) => {
    const a = E.recPtr(r);
    for (let i = 0; i < 4; i++) mem.w8(a + i, r.name.charCodeAt(i) || 0x20);
    for (let i = 0; i < 16; i++) mem.wf32(a + 0xc + 4 * i, r.m[i]);
    mem.wf32(a + 0x4c, r.rx); mem.wf32(a + 0x50, r.ry); mem.wf32(a + 0x54, r.rz);
    mem.w32(a + 0x58, r.colObj ? E.objPtr.get(r.colObj) : 0);
    mem.w16(a + 0x60, r.flags & 0xffff); mem.w32(a + 0x64, r.variant | 0);
  };
  E.mirrorAll = () => { for (const r of records) E.mirrorRecord(r); };
  E.readRecord = (r) => {
    const a = E.recPtr(r);
    return { m: Array.from({ length: 16 }, (_, i) => mem.f32(a + 0xc + 4 * i)), e: [mem.f32(a + 0x4c), mem.f32(a + 0x50), mem.f32(a + 0x54)], flags: mem.r16(a + 0x60) };
  };
  E.setGround = (rec) => { mem.w32(G.groundRec, rec ? E.recPtr(rec) : 0); };
  // the global collision state of the original: DAT_009dec24 (the record of the last ray that hit), DAT_009debd0.. / DAT_009debb0.. (its start / end), DAT_009deb78 (the polygon of the last hit of any
  // query: found as (collision object, index) by its address)
  const polyId = (p) => {
    if (!p) return null;
    for (const [op, obj] of E.objs) { const base = mem.u32(op + 4), n = mem.u32(op); if (p >= base && p < base + n * 0x58) return [records.findIndex((r) => r.colObj === obj), (p - base) / 0x58]; }
    return ['?', p];
  };
  E.readCache = () => ({ rec: mem.u32(0x9dec24) ? (mem.u32(0x9dec24) - RB) / REC : -1, from: [0, 1, 2].map((i) => mem.f32(0x9debd0 + 4 * i)), to: [0, 1, 2].map((i) => mem.f32(0x9debb0 + 4 * i)), poly: polyId(mem.u32(0x9deb78)) });
  /** write the port's collision state (hit cache record / end points, polygon of the last hit) into the emulation (sync mode: both start a tick from the same state) */
  E.writeCache = (col) => {
    const c = E.portCache(col);
    mem.w32(0x9dec24, c.rec >= 0 ? E.recPtr(records[c.rec]) : 0);
    for (let i = 0; i < 3; i++) { mem.wf32(0x9debd0 + 4 * i, c.from[i]); mem.wf32(0x9debb0 + 4 * i, c.to[i]); }
    const lh = col.lastHit;
    mem.w32(0x9deb78, lh ? mem.u32(E.objPtr.get(lh.col) + 4) + 0x58 * lh.polygon : 0);
  };
  E.portCache = (col) => { const c = col.cacheRec ? col.cacheRec.index : -1; const lh = col.lastHit; return { rec: c, from: Array.from(col.cacheFrom), to: Array.from(col.cacheTo), poly: lh ? [records.findIndex((r) => r.colObj === lh.col), lh.polygon] : null }; };

  // ---- what runs natively
  cpu.exec = [[0x429e00, 0x42f000], [0x43a000, 0x43b100], [0x43cb00, 0x43e000], [0x43f160, 0x442a00], CRT, [0x890290, 0x890400], [0x416000, 0x417000], [0x40c000, 0x40d000]];
  cpu.fallback = (a) => (c) => { E.unhooked.set(a, (E.unhooked.get(a) ?? 0) + 1); throw new Error(`m7 emu: unhooked call to 0x${a.toString(16)} from 0x${c.retAddr.toString(16)}`); };
  // atan2 (the CRT version loads an 80 bit constant, not modelled): the double function
  hook(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  cpu.invalidate();
  return E;
}

/** the sweep / probe / terrain queries of the original on the emulated records (used by the collision test and the walk harness) */
export function colQueries(E) {
  const { cpu, mem } = E;
  const tmp = E.alloc(256);
  const [pF, pD, pN, pP, pS] = [tmp, tmp + 16, tmp + 32, tmp + 48, tmp + 64];
  const w3 = (p, v) => { for (let i = 0; i < 3; i++) mem.wf32(p + 4 * i, v[i]); };
  const r3 = (p) => [0, 1, 2].map((i) => mem.f32(p + 4 * i));
  return {
    /** FUN_00441270(ignore, from, delta, outNormal, outPoint, mask, radius, skin) -> { rec, normal, point, surface } | null */
    sweep(ignore, from, delta, mask, radius, skin, fn = 0x441270) {
      w3(pF, from); w3(pD, delta); cpu.steps = 0;
      const r = cpu.call(fn, [ignore ? E.recPtr(ignore) : 0, pF, pD, pN, pP, mask, f32tobits(radius), f32tobits(skin)].slice(0, fn === 0x441270 ? 8 : 6), { maxSteps: 2e7 });
      if (!r) return null;
      return { rec: E.recOfPtr(r), normal: r3(pN), point: r3(pP), surface: mem.u32(0x9deb78) ? mem.u32(mem.u32(0x9deb78) + 4) : 0 };
    },
    probe(ignore, from, delta, mask) { return this.sweep(ignore, from, delta, mask, 0, 0, 0x441ac0); },
    /** FUN_00441b10(rec, &{from*, delta*, normal*, point*, mask, radius, skin}, 0): the ray of one record with the hit cache; the struct is the one FUN_004425f0 builds */
    ray(rec, from, delta, mask, radius, skin) {
      w3(pF, from); w3(pD, delta);
      mem.w32(pS, pF); mem.w32(pS + 4, pD); mem.w32(pS + 8, pN); mem.w32(pS + 12, pP); mem.w32(pS + 16, mask); mem.wf32(pS + 20, radius); mem.wf32(pS + 24, skin);
      cpu.steps = 0;
      const r = cpu.call(0x441b10, [E.recPtr(rec), pS, 0], { maxSteps: 2e7 });
      if (r !== 1) return null;
      return { rec, normal: r3(pN), point: r3(pP), surface: mem.u32(0x9deb78) ? mem.u32(mem.u32(0x9deb78) + 4) : 0, poly: mem.u32(0x9deb78) };
    },
    /** FUN_0043cd62(&pos, dy) -> float */
    terrain(x, y, z, dy) { w3(pF, [x, y, z]); cpu.steps = 0; cpu.call(0x43cd62, [pF, f32tobits(dy)], { maxSteps: 2e7 }); return cpu.fpop(); },
  };
}
const FB = new Float32Array(1), UB = new Uint32Array(FB.buffer);
export const f32tobits = (v) => { FB[0] = v; return UB[0]; };

// =====================================================================================================================================================
// the walk harness: the port's world (src/game) next to the original's walk node (FUN_0042d514) and chase camera (FUN_0042c227) in the emulation
// =====================================================================================================================================================

export const NODE_OFF = { state: 0x18, shift: 0x19, animResult: 0x1a, hideFlag: 0x1b, landFlag: 0x1c, dirFlag: 0x1e, slideFlag: 0x1f, rampX: 0x20, stickX: 0x24, rampY: 0x28, stickY: 0x2c,
  camRampX: 0x30, camStickX: 0x34, camRampY: 0x38, camStickY: 0x3c, idleTimer: 0x40, runTimer: 0x44, t: 0x50, y0: 0x54, yJump: 0x58, v0: 0x5c, vJump: 0x60, speed: 0x64, vx: 0x68, vy: 0x6c, vz: 0x70 };
const NODE_U8 = ['state', 'shift', 'animResult', 'hideFlag', 'landFlag', 'dirFlag', 'slideFlag'];
const NODE_I32 = ['rampX', 'rampY', 'camRampX', 'camRampY'];
const NODE_F32 = ['stickX', 'stickY', 'camStickX', 'camStickY', 'idleTimer', 'runTimer', 't', 'y0', 'yJump', 'v0', 'vJump', 'speed', 'vx', 'vy', 'vz'];
export const NODE_FIELDS = [...NODE_U8, ...NODE_I32, ...NODE_F32];

/**
 * @param L a world from loadZone (tools/lib/engine-load.mjs); only the player's walk node stays in the update pass (all other records are static collision)
 * @param o { zone, sounds: true }
 */
export function createWalkHarness(ctx, L, o) {
  const w = L.world, rec = L.pepper, walk = L.walk;
  // only the player's walk (and swim / mode switch) nodes run; everything else is static
  for (const r of w.records) if (r !== rec) r.ctrl = null;
  rec.ctrl.nodes = [walk];      // no mode switch / swim / stub guard: this harness compares the walk node alone (tools/tests/m7-walk-swim.mjs does the switch)
  const E = createEmu(ctx, o.zone, w.records);
  const { cpu, mem } = E;
  E.syncColObjects(); E.mirrorAll(); E.setGround(w.col.groundRec);
  const H = { E, w, rec, walk, log: [], stops: 0, unhooked: E.unhooked };
  const recP = E.recPtr(rec);
  const NODE = E.alloc(0x100), JV = E.alloc(0x40), SCR = E.alloc(0x100);
  H.NODE = NODE;
  // ---- the player's animation instance (SDAnim: instance +8 clip data, +0xc clip, +0x10 frame, +0x1c rig; rig +0 clip count, +4 clip pointers; clip +0 flags, +8 frame count)
  const ANIM = E.alloc(0x40);
  const rig = rec.anim.rig;
  const rigP = E.alloc(8 + 4 * rig.clips.length), clipP = [];
  mem.w32(rigP, rig.clips.length);
  rig.clips.forEach((c, i) => { const p = E.alloc(0x20); mem.w32(p, c.flags | 0); mem.w32(p + 8, c.frameCount | 0); clipP[i] = p; mem.w32(rigP + 4 + 4 * i, p); });
  mem.w32(ANIM + 0x1c, rigP);
  mem.w32(recP + 8, ANIM);
  // ---- hosted engine services
  const hook = E.hook;
  hook(0x417575, (c) => { c.eax = w.vars.get(c.arg(0)); });
  hook(0x4376f9, (c) => { mem.w32(c.arg(1) + 4, walk.padX | 0); mem.w32(c.arg(1) + 8, walk.padY | 0); c.eax = 0; });    // the pad stick (-128..127; 0 for the keyboard): the port's walk.padX / padY
  H.mouse = { buttons: 0, dx: 0, dy: 0 };
  hook(0x437ca5, (c) => { const m = H.mouse; mem.w32(c.arg(0), m.buttons); mem.w32(c.arg(0) + 4, m.dx | 0); mem.w32(c.arg(0) + 8, m.dy | 0); c.eax = m.buttons; });   // FUN_00437ca5: mouse buttons (0x10 / 0x20 ..) and the movement since the last tick (default: centred, no buttons)
  hook(0x445c70, () => {});                                                                       // debug line draw
  hook(0x416961, () => {});                                                                       // the render device's SetTransform(view) of FUN_0043cc5c (FUN_004165a5, the look-at, runs natively)
  hook(0x427c15, () => { cpu.eax = 0; });                                                         // pizza prelude (Space is never pressed by the oracle scenarios)
  let nextH = 0x1000; const handles = new Map();
  hook(0x443580, (c) => { const h = nextH++; handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4359d5, () => {});
  hook(0x48fdea, () => { H.stops++; });                                                           // FUN_0048fdea: stops the speech sound of the current sub-game (no counterpart in the port)
  hook(0x4435a0, (c) => { H.log.push(handles.get(c.arg(0)) ?? `h${c.arg(0)}`); });
  hook(0x4435b0, () => { H.stops++; });
  cpu.exec.push([0x4b0b00, 0x4b1060], [0x43b600, 0x43b950], [0x415000, 0x418000], [0x85abc0, 0x85abf0]);
  cpu.invalidate();
  cpu.steps = 0; cpu.call(0x4b0b37, []); cpu.call(0x4b0f16, []);
  // ---- globals the walk code reads
  const accIdx = w.records.indexOf(walk.accessory);
  mem.w32(G.accessory, accIdx >= 0 ? accIdx : w.records.length);
  // the accessory record has an animation instance without clips (state 0x1c advances it: FUN_0043b76a returns 0 for an instance with no clip data)
  { const ap = E.recPtr({ index: accIdx >= 0 ? accIdx : w.records.length }); mem.w32(ap + 8, E.alloc(0x40)); }
  const setGlobals = () => {
    mem.wf32(G.dt, w.dt); mem.wf32(G.invDt, 1 / w.dt);
    mem.wf32(G.seaLevel, w.seaLevel); mem.wf32(G.gravity, w.gravity);
    mem.w32(0x9da5d0, recP); mem.w32(0x9da5d8, recP + 0xc); mem.w32(G.camPreset, w.camera.preset | 0); mem.w32(G.vehicle, w.camera.vehicle ? 1 : 0);
    mem.w32(G.frame, w.frame);
    E.setGround(w.col.groundRec);
  };
  const f32 = (v) => { F32[0] = v; return F32[0]; };
  /** write the port's state into the emulation (the original starts from exactly the port's state, rounded to float32) */
  H.setInput = (held, pressed) => { mem.w32(G.heldKeys, held); mem.w32(G.pressedKeys, pressed); mem.w32(G.held2, held); };
  H.push = (held, pressed) => {
    H.pushState();
    H.setInput(held, pressed);
  };
  // Speed: the oracle runs the original's sweeps over all records (393 on the island); records whose collision sphere is further than `cull` from the player (xz) cannot be reached by any
  // query of a tick (the longest ones are the 160 / 500 unit vertical probes, which only look at the ground record, kept), so their flags are zeroed in the emulated memory
  // (the loop of FUN_00441270 then skips them after 8 instructions). Order, pointers and the records that matter (player, accessory, ground) are untouched.
  const cullFlags = new Map();
  const cullTo = o.cull ?? 120;
  const tmpW = [0, 0, 0];
  H.cullRecords = () => {
    for (const r of w.records) {
      if (r === rec || r === walk.accessory || r === w.col.groundRec || !r.colObj) continue;
      r.toWorld(r.colObj.col.center, tmpW);
      const far = Math.hypot(tmpW[0] - rec.x, tmpW[2] - rec.z) > cullTo + r.colObj.radius * Math.max(1, r.scale[0], r.scale[1], r.scale[2]);
      const want = far ? 0 : r.flags & 0xffff;
      if (cullFlags.get(r) !== want) { cullFlags.set(r, want); mem.w16(E.recPtr(r) + 0x60, want); }
    }
  };
  H.pushState = () => {
    setGlobals();
    E.mirrorRecord(rec);
    E.writeCache(w.col);
    H.cullRecords();
    if (walk.accessory) E.mirrorRecord(walk.accessory);
    // node
    for (const k of NODE_U8) mem.w8(NODE + NODE_OFF[k], walk[k]);
    for (const k of NODE_I32) mem.w32(NODE + NODE_OFF[k], walk[k] | 0);
    for (const k of NODE_F32) mem.wf32(NODE + NODE_OFF[k], walk[k]);
    mem.w32(NODE + 8, walk.stamp >>> 0);
    // globals of the walk code
    const g = w.pep;
    mem.w8(G.mailbox, g.mailbox); mem.w32(G.footPhase, g.footPhase); mem.w8(G.footWrapped, g.footWrapped); mem.w32(G.footIdx, g.footIdx); mem.w32(G.landSnd, g.landSnd);
    mem.w8(G.onObject, g.onObject ? 1 : 0); mem.w32(G.surfaceFeet, g.surfaceAtFeet); mem.w32(0x9da9b0, g.lastSurface);
    if (g.jumpVelocity) { for (let i = 0; i < 3; i++) mem.wf32(JV + 0x2c + 4 * i, g.jumpVelocity[i]); mem.w32(G.jumpVel, JV); } else mem.w32(G.jumpVel, 0);
    // animation
    const a = rec.anim;
    mem.w32(ANIM + 0xc, a.clip); mem.w32(ANIM + 8, clipP[a.clip] ?? 0); mem.wf32(ANIM + 0x10, a.frame);
    // camera
    for (let i = 0; i < 18; i++) mem.wf32(CAM + 4 * i, w.camera.c[i]);
    mem.wf32(G.camVel, w.camera.vel);
  };
  const ghostLog = () => H.log.slice();
  /** one tick of the original from the pushed state */
  H.run = () => {
    H.log.length = 0; H.stops = 0;
    cpu.steps = 0; cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0;
    // FUN_0042d514 does not initialise its locals (no stack fill in its prologue): `local_5c` (the input reader's result, "moving") keeps whatever the stack held when the reader is not called
    // (states 2 / 0x1c, slide flag set). The value depends on the call history of the real game and is not derivable; the port assumes the debug fill (non-zero), so the oracle fills the
    // stack below the call with 0xCC to run the same path (UNCERTAIN item of docs/re/engine-m1.md, section "Differential test").
    for (let a = cpu.regs[4] - 0x600; a < cpu.regs[4]; a += 4) mem.w32(a >>> 0, 0xcccccccc);
    cpu.call(H.fn ?? 0x42d514, [recP, H.nodeArg ?? NODE], { maxSteps: 5e6, trace: H.trace ?? undefined });
    H.steps = cpu.steps;
    // the pre-render pass (FUN_004225c5): the node's stamp = frame + 1, the frame counter advances; the draw time view basis (FUN_0043cc5c)
    mem.w32(NODE + 8, (mem.r32(G.frame) + 1) >>> 0); mem.w32(G.frame, mem.r32(G.frame) + 1);
    cpu.steps = 0; cpu.call(0x43cc5c, [SCR, CAM], { maxSteps: 1e6 });
    return ghostLog();
  };
  /** read the original's state after the tick */
  H.pull = () => {
    const nodeS = {};
    for (const k of NODE_U8) nodeS[k] = mem.r8(NODE + NODE_OFF[k]);
    for (const k of NODE_I32) nodeS[k] = mem.r32(NODE + NODE_OFF[k]);
    for (const k of NODE_F32) nodeS[k] = mem.f32(NODE + NODE_OFF[k]);
    nodeS.stamp = mem.u32(NODE + 8);
    const r = E.readRecord(rec);
    return {
      node: nodeS, rec: r, camera: Array.from({ length: 18 }, (_, i) => mem.f32(CAM + 4 * i)), camVel: mem.f32(G.camVel),
      glob: { mailbox: mem.r8(G.mailbox), footPhase: mem.r32(G.footPhase), footWrapped: mem.r8(G.footWrapped), footIdx: mem.r32(G.footIdx), landSnd: mem.r32(G.landSnd), onObject: mem.r8(G.onObject), surfaceAtFeet: mem.r32(G.surfaceFeet), lastSurface: mem.r32(0x9da9b0), frame: mem.r32(G.frame), jumpVel: mem.u32(G.jumpVel) },
      anim: { clip: mem.r32(ANIM + 0xc), frame: mem.f32(ANIM + 0x10) },
      cache: E.readCache(),
      accessoryFlags: walk.accessory ? mem.r16(E.recPtr(walk.accessory) + 0x60) : 0,
      sounds: ghostLog(), stops: H.stops,
    };
  };
  /** the port's state in the same shape */
  H.portState = () => {
    const nodeS = {};
    for (const k of NODE_FIELDS) nodeS[k] = walk[k];
    nodeS.stamp = walk.stamp >>> 0;
    const g = w.pep;
    return {
      node: nodeS, rec: { m: Array.from(rec.m), e: [rec.rx, rec.ry, rec.rz], flags: rec.flags & 0xffff }, camera: Array.from(w.camera.c), camVel: w.camera.vel,
      glob: { mailbox: g.mailbox, footPhase: g.footPhase, footWrapped: g.footWrapped, footIdx: g.footIdx, landSnd: g.landSnd, onObject: g.onObject ? 1 : 0, surfaceAtFeet: g.surfaceAtFeet, lastSurface: g.lastSurface, frame: w.frame, jumpVel: g.jumpVelocity ? 1 : 0 },
      anim: { clip: rec.anim.clip, frame: rec.anim.frame },
      cache: E.portCache(w.col),
      accessoryFlags: walk.accessory ? walk.accessory.flags & 0xffff : 0,
    };
  };
  return H;
}

// =====================================================================================================================================================
// branch coverage of the original's code by the scenarios (conditional jumps of the functions in `ranges`, both outcomes), decoded from the user's own executable at run time
// =====================================================================================================================================================
/**
 * @param E the emulation, entries [[entry, name], ...]: each function is decoded from its entry to the `ret` that is followed by the next function's prologue (push ebp; mov ebp, esp)
 */
export function createCoverage(E, entries) {
  const { mem } = E;
  const lo0 = Math.min(...entries.map((r) => r[0])), hi0 = Math.max(...entries.map((r) => r[0])) + 0x2000;
  const isBr = new Uint8Array(hi0 - lo0), tgt = new Int32Array(hi0 - lo0), nxt = new Int32Array(hi0 - lo0), hit = new Uint8Array((hi0 - lo0) * 2), seen = new Uint8Array(hi0 - lo0);
  const funcs = [];
  for (const [lo, name] of entries) {
    const buf = new Uint8Array(0x2000 + 16); for (let i = 0; i < buf.length; i++) buf[i] = mem.r8(lo + i);
    const f = { name, lo, hi: lo, branches: [], instructions: 0 };
    for (let o = 0; o < 0x2000;) {
      const d = decode(buf, o, lo + o); if (!d) break;
      f.instructions++;
      const a = d.addr - lo0;
      if ((d.op >= 0x70 && d.op <= 0x7f) || (d.op >= 0x0f80 && d.op <= 0x0f8f)) { isBr[a] = 1; tgt[a] = d.rel; nxt[a] = d.addr + d.len; f.branches.push(d.addr); }
      o += d.len;
      if ((d.op === 0xc3 || d.op === 0xc2) && buf[o] === 0x55 && buf[o + 1] === 0x8b && buf[o + 2] === 0xec) break;
    }
    f.hi = lo + 0; funcs.push(f);
  }
  let pend = -1;
  const trace = (cpu, at) => {
    const a = at - lo0;
    if (pend >= 0) { hit[pend * 2 + (at === tgt[pend] ? 1 : 0)] = 1; pend = -1; }
    if (a >= 0 && a < isBr.length) { seen[a] = 1; if (isBr[a]) pend = a; }
  };
  const report = () => {
    let total = 0, covered = 0; const per = [], missing = [];
    for (const f of funcs) {
      let t = 0, c = 0;
      for (const b of f.branches) { const a = b - lo0; for (const k of [0, 1]) { t++; if (hit[a * 2 + k]) c++; else missing.push(`0x${b.toString(16)}${k ? ' taken' : ' fallthrough'}`); } }
      per.push({ name: f.name, branches: f.branches.length, outcomes: t, covered: c }); total += t; covered += c;
    }
    const coveredList = []; for (const f of funcs) for (const b of f.branches) { const a = b - lo0; for (const k of [0, 1]) if (hit[a * 2 + k]) coveredList.push(`${b.toString(16)}${k ? 't' : 'f'}`); }
    return { total, covered, per, missing, coveredList, funcs: funcs.map((f) => ({ name: f.name, lo: f.lo, branches: f.branches })) };
  };
  return { trace, report };
}
