// An oracle for z20DSP's Speedster: the ORIGINAL constructor FUN_006c6495 and update FUN_006c2627 (and everything they call inside the zone's code and the C runtime) run on the
// x86 interpreter of src/formats/x86emu.ts, next to the TypeScript port, on the same records. The engine functions the code calls (collision sweeps, the ground ray, the track
// spline, the game variables, animation, sound) are host functions that use the SAME TypeScript collision world / spline / variables as the port, so a difference between the two
// sides is a difference of the Speedster's own code. docs/re/m6/z20DSP.md section 11.
import { createCpu } from '../../src/formats/x86emu.ts';
import { terrain } from '../../src/zones/z20dsp/shared.ts';
import { TrackSpline } from '../../src/zones/z20dsp/spline.ts';
import { AnimInstance } from '../../src/game/anim.ts';

export const RB = 0x10000000, HEAP = 0x20000000, STRIDE = 0x68;
const VAR_ARRAY = 0x8a2d2c;
const MODEL_BASE = 0x32000000;          // DAT_0098380c: the model table (0x18 bytes per entry; the port's model index)
const NATIVE = [0x43a5e4, 0x43a742, 0x43a8bb, 0x43a9e5, 0x43ab72, 0x43b022, 0x43cec0, 0x43ceae, 0x43ce7d, 0x4388e7, 0x43eaf0, 0x4239d9, 0x6f3302, 0x6f331e, 0x6f3480, 0x6f3490, 0x6f3495, 0x6f349a, 0x6f3270];

export function createOracle(pe, w, S) {
  const cpu = createCpu(pe);
  // Direct3D 7 leaves the x87 in 24-bit precision (docs/re/engine-m1.md 8.1): every arithmetic result rounds to a float; the original runs in that mode (cw 0x7f), the CRT's sin / cos switch to 53 bit themselves
  cpu.cw = process.env.DSP_CW ? Number(process.env.DSP_CW) : 0x7f;
  const mem = cpu.mem;
  const f32 = Math.fround;
  // the oracle's own track object (the nearest() state of FUN_00447550 lives in the object: the port's nodes must not share it with the original's calls)
  const track = new TrackSpline(S.track.pts);
  const n = w.records.length;
  mem.addRegion({ lo: RB, hi: RB + n * STRIDE + 0x1000, name: 'records' });
  mem.addRegion({ lo: HEAP, hi: HEAP + 0x2000000, name: 'heap' });
  mem.addRegion({ lo: 0x30000000, hi: 0x30010000, name: 'anims' });
  let heap = HEAP;
  const alloc = (size) => { const p = heap; heap = (heap + Math.max(4, size) + 15) & ~15; return p; };
  const recPtr = (i) => RB + i * STRIDE;
  const recIdx = (p) => Math.floor((p - RB) / STRIDE);
  const calls = new Map();
  const log = [];
  const modelPtr = (rec) => (rec.model && rec.model.array === 'g98380c' ? MODEL_BASE + rec.model.index * 0x18 : rec.model ? MODEL_BASE + 0x10000 + rec.model.index * 0x18 : 0);
  // ---- records
  const putRecord = (i) => {
    const r = w.records[i], a = recPtr(i);
    for (let k = 0; k < 4; k++) mem.w8(a + k, r.name.charCodeAt(k) || 0);
    mem.w32(a + 4, modelPtr(r));
    mem.w32(a + 8, 0x30000000 + i * 0x20);                       // the animation handle
    for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, r.m[k]);
    mem.wf32(a + 0x4c, r.rx); mem.wf32(a + 0x50, r.ry); mem.wf32(a + 0x54, r.rz);
    mem.w16(a + 0x60, r.flags & 0xffff); mem.w32(a + 0x64, r.variant);
    mem.w32(a + 0x5c, 0);
  };
  for (let i = 0; i < n; i++) putRecord(i);
  mem.w32(0x983800, n); mem.w32(0x983804, RB); mem.w32(0x98380c, MODEL_BASE);
  // ---- variables
  const vars = (i) => mem.r32(VAR_ARRAY + 4 * i);
  for (let i = 0; i < 319; i++) mem.w32(VAR_ARRAY + 4 * i, w.vars.get(i));
  // ---- anim state for the hooks
  const anim = new Map();
  const A = (h) => { let a = anim.get(h); if (!a) anim.set(h, (a = { clip: 0, frame: 0, count: 30 })); return a; };
  let ground = 0;
  const f3 = (p) => [mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)];
  const wf3 = (p, v) => { mem.wf32(p, v[0]); mem.wf32(p + 4, v[1]); mem.wf32(p + 8, v[2]); };
  const H = new Map();
  /** the collision world is the port's; the original's records live in the emulator's memory: for the duration of a query the port's records take the emulator's matrices / flags (the nodes before the caller in record order moved this tick, the ones after did not) */
  const swapIn = (fn) => {
    const saved = [];
    for (let i = 0; i < n; i++) {
      const r = w.records[i];
      if (!r.colObj) continue;
      const a = recPtr(i);
      saved.push([r, r.m.slice(), r.flags]);
      for (let k = 0; k < 16; k++) r.m[k] = mem.f32(a + 0xc + 4 * k);
      r.flags = (r.flags & ~0xffff) | mem.r16(a + 0x60);
    }
    try { return fn(); } finally { for (const [r, m, f] of saved) { r.m.set(m); r.flags = f; } }
  };
  H.set(0x417575, (c) => { c.eax = vars(c.arg(0) | 0) | 0; });
  H.set(0x417597, (c) => { const i = c.arg(0) | 0; if (i !== 1 && i !== 2) mem.w32(VAR_ARRAY + 4 * i, c.arg(1)); });
  const allocs = [];
  H.set(0x433d38, (c) => { const sz = c.arg(0); const p = alloc(sz); allocs.push([p, sz]); c.eax = p; });
  H.set(0x85abc0, () => {});
  H.set(0x4425e0, (c) => { ground = c.arg(0); });
  H.set(0x4425c0, (c) => { c.eax = 0; });
  H.set(0x43ce45, (c) => { const p = f3(c.arg(0)); c.fpush(ground ? terrain(w, p[0], p[1], p[2], c.argf(1)) : -1e38); });
  H.set(0x4478f0, (c) => { c.fpush(track.nearest(f3(c.arg(0)))); });
  H.set(0x4478d0, (c) => { c.fpush(track.nearest(f3(c.arg(0) + 0x3c))); });
  H.set(0x445680, (c) => {
    const t = c.argf(1), p3 = c.arg(2), p4 = c.arg(3), mode = c.arg(4) | 0;
    if (mode === 0) wf3(p3, track.position(t));
    else {
      const fr = track.frame(t, mode === 2);
      wf3(p4, fr.r); mem.wf32(p4 + 12, 0); wf3(p4 + 16, fr.u); mem.wf32(p4 + 28, 0); wf3(p4 + 32, fr.t); mem.wf32(p4 + 44, 0); wf3(p4 + 48, fr.p); mem.wf32(p4 + 60, 1);
      if (mode === 2) wf3(p3, fr.d2);
    }
  });
  H.set(0x441270, (c) => {
    const hit = swapIn(() => w.col.sweep(w.records[recIdx(c.arg(0))], f3(c.arg(1)), f3(c.arg(2)), c.arg(5), c.argf(6), c.argf(7)));
    if (!hit) { c.eax = 0; return; }
    wf3(c.arg(3), hit.normal); c.eax = recPtr(hit.rec.index);
  });
  H.set(0x441ac0, (c) => {
    const hit = swapIn(() => w.col.probe(w.records[recIdx(c.arg(0))], f3(c.arg(1)), f3(c.arg(2)), c.arg(5)));
    if (!hit) { c.eax = 0; return; }
    wf3(c.arg(3), hit.normal); c.eax = 1;
  });
  H.set(0x441b10, (c) => {
    const rec = w.records[recIdx(c.arg(0))], s = c.arg(1);
    const hit = swapIn(() => w.col.rayRecord(rec, f3(mem.u32(s)), f3(mem.u32(s + 4)), mem.u32(s + 16), mem.f32(s + 20), mem.f32(s + 24)));
    if (!hit) { c.eax = 0; return; }
    wf3(mem.u32(s + 8), hit.normal); wf3(mem.u32(s + 12), hit.point); c.eax = 1;
  });
  // animation: a shadow AnimInstance per animated record (the same code as the port's), keyed by the handle written into rec + 8
  const shadow = new Map();
  for (let i = 0; i < n; i++) { const a = w.records[i].anim; if (a) { const sa = new AnimInstance(a.rig); sa.clip = a.clip; sa.frame = a.frame; shadow.set(0x30000000 + i * 0x20, sa); } }
  const SA = (h) => { let a = shadow.get(h); if (!a) { a = { clip: 0, frame: 0, frameCount: 30, start(c) { this.clip = c; this.frame = 0; return true; }, advance() { return 0; }, seek(f) { this.frame = f; return true; } }; shadow.set(h, a); } return a; };
  H.set(0x43b6a3, (c) => { c.eax = SA(c.arg(0)).start(c.arg(1) | 0, c.argf(2) || 0) ? 1 : 0; });
  H.set(0x43b72b, (c) => { c.eax = SA(c.arg(0)).clip; });
  H.set(0x43b76a, (c) => { c.eax = SA(c.arg(0)).advance(c.argf(1)); });
  H.set(0x43b64d, (c) => { c.eax = SA(c.arg(0)).seek(c.argf(1)) ? 1 : 0; });
  H.set(0x43b753, (c) => { c.fpush(SA(c.arg(0)).frameCount); });
  H.set(0x43b73f, (c) => { c.fpush(SA(c.arg(0)).frame); });
  // sounds, speech, particles, rumble, debug lines
  const sound = (name) => (c) => { log.push(`${name} ${c.arg(0) >>> 0}`); };
  for (const [a, nm] of [[0x4435a0, 'play'], [0x4435b0, 'stop'], [0x443600, 'rate'], [0x4433f0, '3d'], [0x4434b0, 'stop3d']]) H.set(a, sound(nm));
  H.set(0x439bf8, (c) => { log.push(`say ${mem.cstr(c.arg(1))}`); c.eax = 0; mem.w32(c.arg(2), 0); });
  H.set(0x435a11, () => {});
  for (const a of [0x438518, 0x6bd2e0, 0x445ba0, 0x85eb80, 0x444550, 0x435c91, 0x442900]) H.set(a, () => {});
  // the particle calls are logged (FUN_00442960 start: handles 100 + n; FUN_00442a00 setMatrix; FUN_00442a40 stop): `emitLog`
  const emitLog = [];
  const matLabel = (p) => (p >= RB && p < RB + n * STRIDE && (p - RB - 0xc) % STRIDE === 0 ? `rec ${(p - RB - 0xc) / STRIDE}` : `0x${(p >>> 0).toString(16)}`);
  let nextH = 100;
  H.set(0x442960, (c) => { const h = nextH++; const fl = (i) => c.argf(i); emitLog.push(`start ${mem.cstr(c.arg(0))} ${matLabel(c.arg(1))} ${[2, 3, 4].map((i) => f32(fl(i))).join(',')} ${[5, 6, 7].map((i) => f32(fl(i))).join(',')} ${[8, 9, 10].map((i) => c.arg(i) & 0xffff).join(',')} -> ${h}`); c.eax = h; });
  H.set(0x442a00, (c) => { emitLog.push(`setM ${c.arg(0)} ${matLabel(c.arg(1))}`); });
  H.set(0x442a40, (c) => { emitLog.push(`stop ${c.arg(0)}`); });
  // FUN_004388ae(max): fild rand(); fdiv 32767.0f; fmul max (24-bit: both operations round); 0 for max <= 0. The draws come from the test's generator and are recorded for the port.
  const O = { emitLog: [] };
  O.rngNext = () => 0.5;
  O.draws = [];
  H.set(0x4388ae, (c) => { const max = c.argf(0); if (!(max > 0)) { c.fpush(0); return; } const v = O.rngNext(); O.draws.push(v); c.fpush(f32(f32(v) * max)); });
  // FUN_006c0af1 (a rock was hit: its Brickbot reacts) dereferences the record's controller, which is null for the bot record itself (BBBB): a crash in the original, nothing here
  H.set(0x6c0af1, () => {});
  // atan2 (FUN_0085d640(double y, double x)): the CRT's version loads 80-bit constants the interpreter does not model
  H.set(0x85d640, (c) => { const sp = c.esp; c.fpush(Math.atan2(mem.f64(sp + 4), mem.f64(sp + 12))); });
  cpu.exec = [[0x6bd2e0, 0x6c6f40], [0x6f3270, 0x6f34a5], [0x858d30, 0x873e00]];
  for (const a of NATIVE) cpu.native.add(a);
  cpu.fallback = (addr) => { const h = H.get(addr); if (h) return h; return (c) => { calls.set(addr, (calls.get(addr) ?? 0) + 1); c.eax = 0; }; };
  for (const [a, h] of H) cpu.hooks.set(a, h);

  // ---- the set-up code itself (FUN_006be930(0)): its attaches run the original constructors; the records that carry a node are listed in `nodes`
  const buf = cpu.call(0x6f3270, [0x1a5e0]);
  mem.w32(0x5d5c1b0, buf);                                      // DAT_05d5c1b0: the replay buffer the set-up hands to the Speedster
  mem.w32(0x98381c, alloc(0x1000));                             // DAT_0098381c: a table the constructor reads one word of
  const car = w.records[38];
  const nodes = [];
  for (const a of [0x42382c, 0x4238b7, 0x4237b6, 0x423716]) H.set(a, () => {});
  H.set(0x423532, (c) => {
    const rp = c.arg(0), ctor = c.arg(1), arg = c.arg(2), v = c.arg(4), mask = c.arg(5), value = c.arg(6);
    if (ctor < 0x6bd2e0 || ctor >= 0x6c6f40) return;            // the engine's own behaviours (seabed) are not part of the zone
    const before = allocs.length;
    cpu.call(ctor, [rp, arg, 0, v >>> 0, mask & 0xffff, value & 0xffff]);
    const made = allocs.slice(before).at(-1);
    const nd = made ? made[0] : 0;
    nodes.push({ rec: recIdx(rp), ctor, node: nd, update: mem.u32(mem.u32(nd + 4)) });
  });
  for (const [a, h] of H) cpu.hooks.set(a, h);
  cpu.call(0x6be930, [0]);
  cpu.call(0x6bf633, []);                                       // FUN_006bf633: the seven particle emitters (logged)
  O.emitLog = emitLog;
  const sp = nodes.find((x) => x.ctor === 0x6c6495);
  const node = sp?.node ?? 0;
  return Object.assign(O, {
    cpu, mem, alloc, recPtr, putRecord, log, calls, vars, buf, node, car, H, nodes, shadow, track,
    setHeld(h, analog = 0) { mem.w32(0x98383c, h); mem.w32(0x98384c, analog); },
    update() { cpu.steps = 0; cpu.call(0x6c2627, [recPtr(38), this.node]); },
    /** one pass of the update chain in record order (FUN_0042226e): every node's update (rec, node), the Speedster's included */
    updateAll() { for (const nd of [...nodes].sort((a, b) => a.rec - b.rec)) { cpu.steps = 0; cpu.call(nd.update, [recPtr(nd.rec), nd.node]); } },
    setVar(i, v) { mem.w32(VAR_ARRAY + 4 * i, v); },
  });
}

/** the fields of the Speedster's node compared against the port: [name, offset, kind ('f' float / 'i' int), getter] */
export const NODE_FIELDS = (n) => [
  ['clock', 0x1c, 'f', n.clock], ['prevButtons', 0x20, 'i', n.prevButtons], ['accel', 0x24, 'f', n.accel], ['brake', 0x30, 'f', n.brake], ['steer', 0x3c, 'f', n.steer],
  ['spin', 0x58, 'i', n.spin], ['spinPhase', 0x5c, 'i', n.spinPhase], ['spinTimer', 0x60, 'f', n.spinTimer],
  ['shrunk', 0x6c, 'i', n.shrunk], ['shrinkPhase', 0x70, 'i', n.shrinkPhase], ['scale', 0x74, 'f', n.scale], ['shrinkTimer', 0x7c, 'f', n.shrinkTimer],
  ['turbo', 0x8c, 'i', n.turbo], ['turboTimer', 0x90, 'f', n.turboTimer], ['turn', 0x9c, 'i', n.turn], ['turnTimer', 0xa0, 'f', n.turnTimer], ['turnLen', 0xa4, 'f', n.turnLen],
  ['turnFrom', 0xa8, 'f', n.turnFrom], ['turnTo', 0xac, 'f', n.turnTo], ['turnDelta', 0xb0, 'f', n.turnDelta],
  ['auto', 0xb4, 'i', n.auto], ['autoTimer', 0xb8, 'f', n.autoTimer], ['autoX', 0xc4, 'f', n.autoX], ['autoZ', 0xcc, 'f', n.autoZ],
  ['bonus', 0xd4, 'i', n.bonus], ['bonusLeft', 0xd8, 'f', n.bonusLeft], ['wrongTimer', 0xe4, 'f', n.wrongTimer], ['phaseTimer', 0xec, 'f', n.phaseTimer],
  ['topSpeed', 0x240, 'f', n.topSpeed], ['accelScale', 0x244, 'f', n.accelScale], ['fwdSpeed', 0x258, 'f', n.fwdSpeed], ['lastAccel', 0x25c, 'f', n.lastAccel],
  ['vx', 0x278, 'f', n.vx], ['vy', 0x27c, 'f', n.vy], ['vz', 0x280, 'f', n.vz], ['yawRate', 0x284, 'f', n.yawRate],
  ['wheel0 steer', 0x288, 'f', n.wheels[0].steer], ['wheel1 steer', 0x2cc, 'f', n.wheels[1].steer],
  ['wheel0 roll', 0x28c, 'f', n.wheels[0].roll], ['wheel1 roll', 0x2d0, 'f', n.wheels[1].roll], ['wheel2 roll', 0x314, 'f', n.wheels[2].roll], ['wheel3 roll', 0x358, 'f', n.wheels[3].roll],
  ['wheel0 rollSpeed', 0x290, 'f', n.wheels[0].rollSpeed], ['wheel3 rollSpeed', 0x35c, 'f', n.wheels[3].rollSpeed],
  ['nx', 0x398, 'f', n.nx], ['ny', 0x39c, 'f', n.ny], ['nz', 0x3a0, 'f', n.nz], ['grounded', 0x3a4, 'f', n.grounded], ['bounce', 0x3a8, 'f', n.bounce], ['stuck', 0x3ac, 'i', n.stuck], ['turboSpoken', 0x410, 'i', n.turboSpoken],
];
export const VARS = [0xff, 0x101, 0x102, 0x103, 0x104, 0x105, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0x77, 0xdc, 0x1e];

/** differences between the emulated original (`O`) and the port (node `n`, shared `S`, world `w`) after a tick: [name, emu, ts] */
export function compare(O, n, S, w, tol = 2e-3) {
  const out = [];
  const m = O.mem;
  const car = w.records[38], a = O.recPtr(38);
  const chk = (name, e, v, t = tol) => { if (!(Math.abs(e - v) <= t * Math.max(1, Math.abs(v)))) out.push([name, e, v]); };
  for (const [nm, off, kind, v] of NODE_FIELDS(n)) chk(nm, kind === 'i' ? m.r32(O.node + off) : m.f32(O.node + off), kind === 'i' ? (v | 0) : v);
  chk('car x', m.f32(a + 0x3c), car.x); chk('car y', m.f32(a + 0x40), car.y); chk('car z', m.f32(a + 0x44), car.z); chk('car yaw', m.f32(a + 0x50), car.ry);
  for (let k = 0; k < 12; k++) if (k % 4 !== 3) chk(`car m[${k}]`, m.f32(a + 0xc + 4 * k), car.m[k]);
  for (let i = 0; i < 4; i++) { const wr = w.records[34 + i]; for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) chk(`wheel rec ${34 + i} m[${k}]`, m.f32(O.recPtr(34 + i) + 0xc + 4 * k), wr.m[k], 4e-3); }
  const dr = w.records[13]; for (const k of [12, 13, 14]) chk(`driver m[${k}]`, m.f32(O.recPtr(13) + 0xc + 4 * k), dr.m[k], 4e-3);
  for (const v of VARS) if ((O.vars(v) | 0) !== (w.vars.get(v) | 0)) out.push([`var ${v.toString(16)}`, O.vars(v) | 0, w.vars.get(v) | 0]);
  chk('score', m.r32(0x5d5c0a4), S.score, 0); chk('push x', m.f32(0x5d5c078), S.push[0]); chk('push z', m.f32(0x5d5c080), S.push[2]);
  chk('speed mirror', m.f32(0x5d5c084), S.speedMirror); chk('gauge', m.f32(0x5d4e138), S.gauge);
  return out;
}


/** the props: matrices, flags and animation clips of every record with a node (except the car), emulated original vs port */
export function compareProps(O, w, tol = 2e-3) {
  const out = [];
  const m = O.mem;
  for (const nd of O.nodes) {
    if (nd.rec === 38) continue;
    const r = w.records[nd.rec], a = O.recPtr(nd.rec);
    const chk = (name, e, v, t = tol) => { if (!(Math.abs(e - v) <= t * Math.max(1, Math.abs(v)))) out.push([`rec ${nd.rec} ${r.name} ${name}`, e, v]); };
    for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) chk(`m[${k}]`, m.f32(a + 0xc + 4 * k), r.m[k], k >= 12 ? tol : 5e-3);
    if (((m.r16(a + 0x60) ^ r.flags) & 2) !== 0) out.push([`rec ${nd.rec} ${r.name} visible`, m.r16(a + 0x60) & 2, r.flags & 2]);
    const sa = O.shadow.get(m.u32(a + 8));
    if (sa && r.anim && sa.clip !== r.anim.clip) out.push([`rec ${nd.rec} ${r.name} anim clip`, sa.clip, r.anim.clip]);
  }
  return out;
}
