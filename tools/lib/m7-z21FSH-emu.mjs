// z21FSH (WP-VERIFY, docs/re/m6/z21FSH.md section "Differential test"): the ORIGINAL update / draw functions of the fishing zone run in the x86 emulation next to the port.
//   Fishing  FUN_006f6e2b (state machine) + FUN_006f665b (bobber) + FUN_006f6d71 / 6cd9 / 6d25 (camera)      FSwitch FUN_006f4bfa + FUN_006f49b3 / 48c9 / 4890 (popups)
//   Shoal    FUN_006f5dac + FUN_007061ee (fish) + FUN_006f5b50 (follower) + draw hook FUN_006f5e8d / FUN_00705e00 (bite picker)      Bertha FUN_006f54c0
//   rod      FUN_006f94d4 (draw hook)          Splash FUN_006f59e4 (draw hook)          constructors FUN_006f8e5a / 6f6034 / 6f56d0 / 6f51e6 / 6f9cdc, the spot table of FUN_006f3eec
// Hosted (not the subject): game variables, animation instances (the port's AnimInstance: FUN_0043b6a3 / 76a / 72b / 73f / 753 / 64d, the bone matrix FUN_0043bc58 from the port's pose),
// sound / speech / music / cutscene / emitter calls (logged), text draws (logged), the random numbers (the port's generator), atan2; the ground ray FUN_0043cd62 -> 004425f0 -> 00441b10 runs
// natively on the LAND collision object built by the original loader FUN_0043f370 from the archive.
import { createCpu } from '../../src/formats/x86emu.ts';
import { loadExe, loadZone } from './engine-load.mjs';
import { colMember } from '../../src/game/zone.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { GameRecord } from '../../src/game/record.ts';
import '../../src/zones/z21fsh/nodes.ts';
import { prepareFsh, sharedOf, silentEnv } from '../../src/zones/z21fsh/nodes.ts';
import { REC, TABLE } from '../../src/zones/z21fsh/rules.ts';

export const RB = 0x30000000, NB = 0x31000000, AB = 0x33000000, MB = 0x34000000, HEAP = 0x20000000, HEAP_SIZE = 0x4000000;
/** the node blocks (offsets from NB) */
export const N = { fishing: 0x0, fswitch: 0x100, splash: 0x140, rod: 0x180, fisherman: 0x1c0, bertha: 0x200, shoal: 0x400, fish: 0x500, mats: 0x1100, ctrl: 0x1500, args: 0x1600, lods: 0x1700 };
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
export const f32 = (v) => { F32[0] = v; return F32[0]; };
export const bitsOf = (v) => { F32[0] = v; return U32[0]; };

/** a deterministic generator whose draws are recorded (the constructors of the original are fed the same numbers) */
export function recordingRng(seed) {
  const r = { s: seed >>> 0, draws: [], count: 0, next() { r.s = (Math.imul(r.s, 1664525) + 1013904223) >>> 0; const v = r.s / 4294967296; r.count++; if (r.recording) r.draws.push(v); return v; }, recording: true };
  return r;
}

/** the zone world as the m6 test builds it, with the rods' / Bertha's animation instances, only the zone's own nodes on the records, and recorders for the environment */
export function loadFsh(ctx, { seed = 7, dt = 1 } = {}) {
  const pe = loadExe(ctx.dataRoot);
  const L = loadZone(ctx, 'z21FSH');
  const w = L.world;
  w.externalInput = true;
  w.dt = dt;
  const KEEP = new Set(['FSwitch', 'Fishing', 'Bertha', 'Shoal', 'Splash', 'rod', 'Fisherman']);
  for (const r of w.records) if (r.ctrl) r.ctrl.nodes = r.ctrl.nodes.filter((n) => KEEP.has(n.kind) && n.kind !== 'Fisherman');
  const rig = (n) => { const e = L.archive.find(`anim/${n}.blk`); return e ? parseBlk(L.archive.read(e)) : null; };
  const bigb = rig('BIGB'), rodd = rig('RODD');
  if (bigb) w.records[REC.BIGB].anim = new AnimInstance(bigb);
  if (rodd) w.records[REC.RODD].anim = new AnimInstance(rodd);
  const S = sharedOf(w);
  const rng = recordingRng(seed);
  S.rng = rng;
  const log = [];
  S.env = {
    ...silentEnv,
    play2D: (id) => log.push(['play', id]), stop2D: (id) => log.push(['stop', id]),
    play3D: (id, x, y, z) => log.push(['3d', id, x, y, z]), stop3D: (id) => log.push(['stop3d', id]),
    say: (a, b) => log.push(['say', a, b ?? null]), cutsceneStart: (s) => log.push(['cutscene', s]), cutsceneActive: () => false,
    fightMusic: (on) => log.push(['music', on]), splash: (x, y, z) => log.push(['splash', x, y, z]),
  };
  // the shoal's fish are drawn through 15 helper records (the zone game makes them: src/zones/z21FSH.ts)
  S.clones = [];
  for (let i = 0; i < 15; i++) { const c = new GameRecord('FISH'); c.index = w.records.length; c.hide(); w.records.push(c); S.clones.push(c); }
  prepareFsh(w, pe);
  const ctorDraws = rng.draws.slice();
  for (let i = 0; i < w.camera.c.length; i++) w.camera.c[i] = f32(w.camera.c[i]);      // the camera's initial eye is an unrounded double of the shared camera object: float32 like the original's
  w.camera.savePrev();
  const F = S.fishing;
  let prev = 0;
  /** one tick with the buttons `held` down (`pressed` = the buttons that went down this tick, derived) */
  const step = (held = 0) => { const i = w.input; i.prevHeld = prev; i.held = held; i.pressed = (held ^ prev) & held; prev = held; w.tick(); };
  return { L, w, S, F, pe, rng, seed, log, ctorDraws, step, held: () => prev };
}

// ---------------------------------------------------------------------------------------------------------------------------------- the emulation
export function createHarness(ctx, W, opts = {}) {
  const { w, S, L, pe, rng } = W;
  const rs = w.records, NREC = rs.length;
  const cpu = createCpu(pe), mem = cpu.mem;
  // Direct3D 7 leaves the x87 in 24-bit precision (docs/re/engine-m1.md 8.1): every arithmetic result rounds to a float; FSH_CW=0x27f runs the 53 bit mode for comparison
  cpu.cw = process.env.FSH_CW ? Number(process.env.FSH_CW) : 0x7f;
  for (const [lo, n] of [[RB, NREC * 0x68 + 0x100], [NB, 0x4000], [AB, NREC * 0x40 + 0x40], [MB, 0x20000], [HEAP, HEAP_SIZE]]) mem.addRegion({ lo, hi: lo + n, name: 'h' });
  mem.w32(0x983804, RB); mem.w32(0x983800, NREC);
  const recPtr = (r) => RB + r.index * 0x68;
  const recOf = (ptr) => (ptr === 0 ? null : rs[(ptr - RB) / 0x68]);
  const H = { cpu, mem, W, bones: [], log: [], texts: [], lines: [], parts: [], draws: [], handles: new Map(), tokens: new Map(), unhooked: new Set(), randQueue: null, randCalls: 0, notes: [] };
  const hook = (a, fn) => cpu.hooks.set(a, fn);
  const push = (e) => H.log.push(e);

  // ---- heap / files for the collision loader (FUN_0043f370: the LAND object)
  let heapTop = HEAP; const files = new Map(); let nextFile = 1;
  hook(0x433d38, (c) => { const n = (c.arg(0) + 15) & ~15; const p = heapTop; heapTop += Math.max(16, n); c.eax = p; });
  hook(0x433d60, () => {}); hook(0x443c70, () => {});
  hook(0x435843, (c) => { const e = files.get(c.arg(0)); if (!e) { c.eax = 0; return; } const h = nextFile++; files.set(h, { data: e, pos: 0 }); c.eax = h; });
  hook(0x435350, (c) => { const dst = c.arg(0), size = c.arg(1), count = c.arg(2), f = files.get(c.arg(3)); if (!f) { c.eax = 0; return; } const k = Math.max(0, Math.min(size * count, f.data.length - f.pos)); mem.write(dst, f.data.subarray(f.pos, f.pos + k)); f.pos += k; c.eax = size ? Math.floor(k / size) : 0; });
  hook(0x4358e9, () => {});
  hook(0x890290, (c) => { const a = c.arg(0), b = c.arg(1), n = c.arg(2); let r = 0; for (let i = 0; i < n && !r; i++) r = mem.r8(a + i) - mem.r8(b + i); c.eax = r < 0 ? -1 : r > 0 ? 1 : 0; });
  const loaderOf = new Map();
  for (const sva of pe.findStrings('_data\\z21FSH\\col\\')) for (const x of pe.pushXrefs(sva)) for (let k = 5; k < 14; k++) if (pe.at(x + k) === 0xe8) { loaderOf.set(pe.cstr(sva).toLowerCase(), ((x + k + 5 + (pe.u32(x + k + 1) | 0)) >>> 0)); break; }
  H.loaderOf = loaderOf;
  const loadCol = (colObj) => {
    const e = L.archive.find(colMember(colObj.path)); if (!e) return 0xbabababa;
    const key = MB + 0x8000 + files.size * 0x100;
    mem.write(key, [...colObj.path].map((ch) => ch.charCodeAt(0))); mem.w8(key + colObj.path.length, 0);
    files.set(key, L.archive.read(e));
    return cpu.call(loaderOf.get(colObj.path.toLowerCase()) ?? 0x43f370, [key], { maxSteps: 8000000 }) >>> 0;
  };

  // ---- game variables
  hook(0x417575, (c) => { c.eax = w.vars.get(c.arg(0)); });
  hook(0x417597, (c) => { w.vars.set(c.arg(0), c.arg(1) | 0); });
  hook(0x41761b, (c) => { w.vars.or(c.arg(0), c.arg(1) | 0); });
  hook(0x41766c, (c) => { w.vars.andNot(c.arg(0), c.arg(1) | 0); });
  hook(0x4175ca, (c) => { w.vars.add(c.arg(0), c.arg(1) | 0); });
  // ---- random numbers: FUN_004388ae(x) = rand * x from the port's generator (or the queue the constructors are fed from)
  hook(0x4388ae, (c) => { H.randCalls++; const v = H.randSource ? H.randSource.next() : rng.next(); c.fpush(c.argf(0) > 0 ? f32(f32(v) * f32(c.argf(0))) : 0); });      // FUN_004388ae: fild r; fdiv 32767.0f; fmul max (24-bit: both round); max <= 0 gives 0
  // GetTickCount: the original draws `ftol(FUN_004388ae(tick)) % N`; the port models it as randI(N). The host returns N (read from the `mov ecx, N; idiv ecx` that follows the call) so that both are the same decision
  hook(0x435c91, (c) => { let n = 3; const ra = c.retAddr; for (let k = 0; k < 48; k++) if (pe.at(ra + k) === 0xb9 && pe.at(ra + k + 5) === 0xf7 && pe.at(ra + k + 6) === 0xf9) { n = pe.u32(ra + k + 1); break; } c.eax = n; });
  // ---- animation instances (the port's own: not the subject)
  const animOf = (ptr) => rs[(ptr - AB) / 0x40]?.anim;
  hook(0x43b6a3, (c) => { push(['anim', (c.arg(0) - AB) / 0x40, c.arg(1) | 0, c.argf(2)]); animOf(c.arg(0))?.start(c.arg(1) | 0, c.argf(2)); });
  hook(0x43b76a, (c) => { c.eax = animOf(c.arg(0)).advance(c.argf(1), w.dt); });
  hook(0x43b72b, (c) => { c.eax = animOf(c.arg(0)).clip; });
  hook(0x43b73f, (c) => { c.fpush(animOf(c.arg(0)).frame); });
  hook(0x43b753, (c) => { c.fpush(animOf(c.arg(0)).frameCount); });
  hook(0x43b64d, (c) => { animOf(c.arg(0)).seek(c.argf(1)); });
  // the bone matrix FUN_0043bc58(anim, bone): the pose the port evaluates, into a scratch ring
  let ring = 0;
  hook(0x43bc58, (c) => { const a = animOf(c.arg(0)), bone = c.arg(1); const p = MB + 0x1000 + (ring++ & 7) * 0x40; const pose = a?.pose(1); for (let i = 0; i < 16; i++) mem.wf32(p + 4 * i, pose && pose.length >= (bone + 1) * 16 ? pose[bone * 16 + i] : (i % 5 === 0 ? 1 : 0)); H.bones.push([(c.arg(0) - AB) / 0x40, bone, mem.f32(p + 0x30), mem.f32(p + 0x34), mem.f32(p + 0x38)]); c.eax = p; });
  // ---- sounds: handles of FUN_006f52a0 map to the sound id
  let nextH = 0x1000;
  hook(0x443580, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4433b0, (c) => { const h = nextH++; H.handles.set(h, c.arg(0)); c.eax = h; });
  hook(0x4359d5, () => {});
  hook(0x4435a0, (c) => { push(['play', H.handles.get(c.arg(0))]); });
  hook(0x4435b0, (c) => { push(['stop', H.handles.get(c.arg(0))]); });
  hook(0x4433f0, (c) => { const p = c.arg(1); push(['3d', H.handles.get(c.arg(0)), mem.f32(p), mem.f32(p + 4), mem.f32(p + 8)]); });
  hook(0x4434b0, (c) => { push(['stop3d', H.handles.get(c.arg(0))]); });
  hook(0x4432c0, (c) => { push(['music', c.arg(0)]); });
  hook(0x439bf8, (c) => { const tok = 0x7000 + H.tokens.size; H.tokens.set(tok, mem.cstr(c.arg(1))); mem.w32(c.arg(2), tok); });
  hook(0x435a11, (c) => { push(['say', H.tokens.get(c.arg(0)), c.arg(1) === 0xffffffff ? null : H.tokens.get(c.arg(1))]); });
  hook(0x45c40c, (c) => { push(['cutscene', c.arg(0)]); });
  hook(0x45c432, (c) => { c.eax = H.cutsceneActive ? 1 : 0; });
  hook(0x442a00, (c) => { const p = c.arg(1); push(['emitterAt', mem.f32(p + 0x30), mem.f32(p + 0x34), mem.f32(p + 0x38)]); });
  hook(0x442a20, (c) => { const b = NB + N.fishing + 0x60; push(['emitter', c.arg(1), mem.f32(b), mem.f32(b + 4), mem.f32(b + 8)]); });
  hook(0x442960, (c) => { c.eax = 0x600d; });
  hook(0x443230, () => {});
  hook(0x45f9d2, () => {});
  // ---- text / drawing (logged)
  hook(0x439c6f, (c) => { H.texts.push({ table: c.arg(0), font: c.arg(1), text: mem.cstr(c.arg(2), 64), x: c.arg(5) & 0xffff, y: c.arg(6) & 0xffff, wrap: c.arg(7) }); });
  hook(0x460a3d, (c) => { H.texts.push({ panel: [c.arg(0), c.arg(1), c.arg(2)] }); });
  hook(0x43f160, () => { c0(); }); hook(0x43f180, () => { c0(); });
  const c0 = () => { cpu.eax = 0; };
  hook(0x43f1a0, (c) => { const p = c.arg(1), ra = c.retAddr, who = ra >= 0x6f665b && ra < 0x6f6d25 ? 'bobber' : ra >= 0x6f5e8d && ra < 0x6f5fd6 ? 'fish' : ra >= 0x6f59e4 && ra < 0x6f5aa1 ? 'splash' : 'other'; H.parts.push({ who, handle: c.arg(0), m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 4 * i)), a2: c.arg(2) }); });
  hook(0x444480, (c) => { H.draws.push({ rec: recOfPtr(c.arg(0)), pre: H.preT ? H.preT.slice() : null }); });
  hook(0x4440d0, (c) => { const p = c.arg(0); H.preT = p ? Array.from({ length: 16 }, (_, i) => mem.f32(p + 4 * i)) : null; });
  // FUN_0085ac00 = sprintf: the floating point formatting of the CRT needs its start-up tables (`%2.0f` of the catch popup), so the call is hosted: a small C-format implementation (d i u x c s f with flags / width / precision)
  hook(0x85ac00, (c) => {
    const buf = c.arg(0), fmt = mem.cstr(c.arg(1), 256);
    let ai = 2, out = '';
    const argI = () => c.arg(ai++), argD = () => { const v = mem.f64(c.esp + 4 + 4 * ai); ai += 2; return v; };
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') { out += fmt[i]; continue; }
      i++; let flags = '', width = '', prec = null;
      while ('-+ 0#'.includes(fmt[i])) flags += fmt[i++];
      while (/[0-9]/.test(fmt[i])) width += fmt[i++];
      if (fmt[i] === '.') { i++; prec = ''; while (/[0-9]/.test(fmt[i])) prec += fmt[i++]; prec = +prec || 0; }
      const t = fmt[i]; let body = '';
      if (t === 'd' || t === 'i') body = String(argI() | 0); else if (t === 'u') body = String(argI() >>> 0); else if (t === 'x') body = (argI() >>> 0).toString(16);
      else if (t === 'c') body = String.fromCharCode(argI() & 0xff); else if (t === 's') body = mem.cstr(argI(), 256); else if (t === 'f') body = argD().toFixed(prec ?? 6); else if (t === '%') body = '%'; else body = '?';
      const wd = +width || 0;
      out += flags.includes('-') ? body.padEnd(wd, ' ') : flags.includes('0') ? body.padStart(wd, '0') : body.padStart(wd, ' ');
    }
    for (let k = 0; k < out.length; k++) mem.w8(buf + k, out.charCodeAt(k)); mem.w8(buf + out.length, 0);
    c.eax = out.length;
  });
  // FUN_0085eb80 = the CRT's printf (printf.c): the rod hook calls it in state 0xb with the buffer DAT_05d5cbc4 as the format; nothing in the executable ever writes that buffer (.bss, 0): the format is ""
  H.printfs = [];
  hook(0x85eb80, (c) => { H.printfs.push(mem.cstr(c.arg(0), 32)); c.eax = 0; });
  hook(0x4445e0, (c) => { const a = c.arg(0), b = c.arg(1); H.lines.push({ a: [0, 1, 2].map((i) => mem.f32(a + 4 * i)), b: [0, 1, 2].map((i) => mem.f32(b + 4 * i)) }); });
  hook(0x416885, () => {});
  const recOfPtr = (p) => ((p - RB) % 0x68 === 0 ? rs[(p - RB) / 0x68]?.index : -1);
  cpu.exec = [[0x422b00, 0x422d00], [0x6f3000, 0x707000], [0x858d30, 0x873e00], [0x43a000, 0x43b100], [0x43cc00, 0x43d000], [0x43d000, 0x442b00]];
  cpu.fallback = (a) => { H.unhooked.add(a); throw new Error(`z21FSH emu: unhooked call to 0x${a.toString(16)} from 0x${cpu.callAt.toString(16)} (frames ${cpu.frames.slice(-12).map((f) => f.toString(16))}, last ${cpu.lastSteps().slice(-6).map((f) => f.toString(16))})`); };
  cpu.invalidate();
  H.recPtr = recPtr; H.recOf = recOf; H.recOfPtr = recOfPtr; H.animOf = animOf;

  // ---- the ground record's collision object (original loader) and the sound handles (FUN_006f52a0 natively)
  H.groundCol = loadCol(rs[REC.LAND].colObj);
  cpu.call(0x6f52a0, []);
  return H;
}

// ---------------------------------------------------------------------------------------------------------------------------------- field maps (offset, kind, port property)
/** the Fishing node (FUN_006f8e5a, 0xf8 bytes) */
export const FN = [
  [0x18, 'f', 'dist'], [0x1c, 'f', 'yaw'], [0x20, 'f', 'yawTarget'], [0x24, 'f', 'yawStep'], [0x2c, 'f', 'castRate'], [0x30, 'f', 'tension'], [0x34, 'f', 'taut'], [0x38, 'f', 'flight'],
  [0x3c, 'f', 'px'], [0x40, 'f', 'py'], [0x44, 'f', 'pz'], [0x48, 'f', 'sx'], [0x4c, 'f', 'sy'], [0x50, 'f', 'sz'], [0x54, 'f', 'stx'], [0x58, 'f', 'sty'], [0x5c, 'f', 'stz'],
  [0x60, 'f', 'bx'], [0x64, 'f', 'by'], [0x68, 'f', 'bz'], [0x6c, 'f', 'tx'], [0x70, 'f', 'ty'], [0x74, 'f', 'tz'], [0x78, 'f', 'vx'], [0x7c, 'f', 'vy'], [0x80, 'f', 'vz'],
  [0x84, 'i', 'state'], [0x88, 'i', 'walkFlag'], [0x8c, 'i', 'castFlag'], [0x94, 'i', 'sub'], [0x98, 'i', 'bite'], [0x9c, 'i', 'shown'], [0xa0, 'i', 'total'], [0xa4, 'i', 'count'],
  [0xa8, 'f', 'walkLeft'], [0xac, 'f', 'turnLeft'], [0xb0, 'f', 'power'], [0xb4, 'f', 'lure'], [0xb8, 'f', 'bobPhase'], [0xd8, 'i', 'endTicks'], [0xdc, 'b', 'spotFlag'], [0xe0, 'i', 'spotIdx'],
  [0xe4, 'i', 'casts'], [0xf0, 'u8', 'fightMusic'], [0xf4, 'i', 'counter'],
];
/** a fish struct (0xc0 bytes): float index -> property */
export const FISH = [
  [0, 'f', 'x'], [1, 'f', 'y'], [2, 'f', 'z'], [3, 'f', 'vx'], [4, 'f', 'vy'], [5, 'f', 'vz'], [6, 'f', 'rx'], [7, 'f', 'ry'], [8, 'f', 'rz'], [9, 'f', 'ax'], [10, 'f', 'ay'], [11, 'f', 'az'],
  [12, 'f', 'bx'], [13, 'f', 'by'], [14, 'f', 'bz'], [0x12, 'f', 'mx'], [0x13, 'f', 'my'], [0x14, 'f', 'mz'], [0x15, 'f', 'phase'], [0x16, 'f', 'phaseRate'], [0x17, 'f', 'unused17'], [0x18, 'f', 'speed'], [0x19, 'f', 'drawY'],
  [0x1a, 'f', 'turn'], [0x1b, 'f', 'biteTimer'], [0x1c, 'f', 'dist'], [0x20, 'i', 'approachLeft'], [0x21, 'b', 'approaching'], [0x22, 'f', 'stepX'], [0x23, 'f', 'stepY'], [0x24, 'f', 'stepZ'],
  [0x25, 'f', 'radiusB'], [0x26, 'f', 'weight'], [0x27, 'f', 'weight0'], [0x28, 'f', 'angle'], [0x29, 'f', 'angleRate'], [0x2a, 'f', 'radiusA'], [0x2b, 'f', 'radiusBase'], [0x2c, 'f', 'yawRate'],
  [0x2d, 'b', 'hooked'], [0x2e, 'b', 'biting'], [0x2f, 'b', 'bertha'],
];
/** the way-point follower (node + 0x18) */
export const FOL = [[0, 'i', 'from'], [1, 'i', 'to'], [2, 'b', 'moving'], [3, 'i', 'count'], [4, 'f', 'timer'], [5, 'f', 'reset'], [6, 'f', 'speed'], [8, 'f', 'sx'], [9, 'f', 'sy'], [10, 'f', 'sz'], [11, 'f', 'px'], [12, 'f', 'py'], [13, 'f', 'pz']];

function put(mem, a, kind, v) {
  if (kind === 'f') mem.wf32(a, v); else if (kind === 'i') mem.w32(a, v | 0); else if (kind === 'b') mem.w32(a, v ? 1 : 0); else mem.w8(a, v ? 1 : 0);
}
function get(mem, a, kind) {
  if (kind === 'f') return mem.f32(a); if (kind === 'i') return mem.r32(a); if (kind === 'b') return mem.r32(a) !== 0 ? 1 : 0; return mem.r8(a);
}
const asNum = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

/** the fish of the port as a struct view: `Fish` props, with the weight etc. */
function writeFish(mem, base, f, matAddr) {
  for (const [i, kind, key] of FISH) put(mem, base + 4 * i, kind, f[key]);
  mem.w32(base + 4 * 0x1f, matAddr);
}
function readFish(mem, base) { const o = {}; for (const [i, kind, key] of FISH) o[key] = get(mem, base + 4 * i, kind); return o; }
const tsFish = (f) => { const o = {}; for (const [, , key] of FISH) o[key] = asNum(f[key]); return o; };
function writeFollower(mem, base, fol) {
  for (const [i, kind, key] of FOL) put(mem, base + 4 * i, kind, key === 'sx' ? fol.step[0] : key === 'sy' ? fol.step[1] : key === 'sz' ? fol.step[2] : key === 'px' ? fol.pos[0] : key === 'py' ? fol.pos[1] : key === 'pz' ? fol.pos[2] : fol[key]);
}
function readFollower(mem, base) { const o = {}; for (const [i, kind, key] of FOL) o[key] = get(mem, base + 4 * i, kind); return o; }
const tsFollower = (fol) => ({ from: fol.from, to: fol.to, moving: asNum(fol.moving), count: fol.count, timer: fol.timer, reset: fol.reset, speed: fol.speed, sx: fol.step[0], sy: fol.step[1], sz: fol.step[2], px: fol.pos[0], py: fol.pos[1], pz: fol.pos[2] });

/** the addresses of the zone's globals (.bss of the executable) */
export const G = { result: 0x5d5c3d0, fishing: 0x5d5ca60, switchInit: 0x5d5ca64, spots: 0x5d5c3e8, popups: 0x5d5c4e0, bestFish: 0x5d5cbd4, bestMetric: 0x9316d4, splashOn: 0x5d5cb34, splashAt: 0x92f578, rodTip: 0x5d5cbb8,
  camPreset: 0x5d5cae0, camHeight: 0x5d5cb30, camera: 0x9da5e8 };

export function attachMirrors(H) {
  const { mem, W } = H;
  const { w, S } = W;
  const rs = w.records;
  const NBp = (off) => NB + off;
  H.ptr = { fishing: NBp(N.fishing), fswitch: NBp(N.fswitch), splash: NBp(N.splash), rod: NBp(N.rod), fisherman: NBp(N.fisherman), bertha: NBp(N.bertha), shoal: NBp(N.shoal), fish: NBp(N.fish), mats: NBp(N.mats), ctrl: NBp(N.ctrl) };
  const fishPtr = (i) => H.ptr.fish + i * 0xc0;
  const berthaFish = H.ptr.bertha + 0x50;
  /** the pointer of the port's fish object inside the emulation */
  const ptrOfFish = (f) => (!f ? 0 : f.bertha ? berthaFish : fishPtr(f.index));
  const fishOfPtr = (p) => (!p ? null : p === berthaFish ? S.bertha.fish : S.shoal.fish[(p - H.ptr.fish) / 0xc0]);
  H.ptrOfFish = ptrOfFish; H.fishOfPtr = fishOfPtr;

  // ---- records
  H.mirrorRecords = () => {
    for (const r of rs) {
      const p = RB + r.index * 0x68;
      for (let i = 0; i < 4; i++) mem.w8(p + i, r.name.charCodeAt(i) || 0x20);
      mem.w32(p + 4, 0);
      mem.w32(p + 8, r.anim ? AB + r.index * 0x40 : 0);
      for (let i = 0; i < 16; i++) mem.wf32(p + 0xc + 4 * i, r.m[i]);
      mem.wf32(p + 0x4c, r.rx); mem.wf32(p + 0x50, r.ry); mem.wf32(p + 0x54, r.rz);
      mem.w32(p + 0x58, r === rs[REC.LAND] ? H.groundCol >>> 0 : 0);
      mem.w32(p + 0x5c, 0);
      mem.w16(p + 0x60, r.flags & 0xffff); mem.w16(p + 0x62, 0); mem.w32(p + 0x64, r.variant | 0);
    }
  };
  H.readRec = (r) => {
    const p = RB + r.index * 0x68;
    return { m: Array.from({ length: 16 }, (_, i) => mem.f32(p + 0xc + 4 * i)), e: [mem.f32(p + 0x4c), mem.f32(p + 0x50), mem.f32(p + 0x54)], flags: mem.r16(p + 0x60) };
  };

  // ---- the Fishing node
  H.writeFishing = (F) => {
    const b = H.ptr.fishing;
    for (const [off, kind, key] of FN) put(mem, b + off, kind, key === 'yawStep' ? F.yawStep : F[key]);
    mem.w32(b + 0x84, F.state); mem.w32(b + 0xbc, RB + REC.RODD * 0x68); mem.w32(b + 0xc4, RB + REC.PEPP * 0x68); mem.w32(b + 0xe8, ptrOfFish(F.hooked));
    mem.w32(b + 0xec, 0x600d); mem.w32(b + 8, F.stamp >>> 0);
  };
  H.readFishing = () => { const b = H.ptr.fishing, o = {}; for (const [off, kind, key] of FN) o[key] = get(mem, b + off, kind); o.hooked = mem.u32(b + 0xe8); return o; };
  H.tsFishing = (F) => { const o = {}; for (const [, , key] of FN) o[key] = asNum(F[key]); o.hooked = ptrOfFish(F.hooked); return o; };

  // ---- shoal / Bertha (follower + fish)
  H.writeShoal = () => {
    const sh = S.shoal; writeFollower(mem, H.ptr.shoal + 0x18, sh.follower);
    mem.w32(H.ptr.shoal + 0x54, sh.fish.length);
    sh.fish.forEach((f, i) => writeFish(mem, fishPtr(i), f, H.ptr.mats + i * 0x40));
  };
  H.readShoal = () => ({ follower: readFollower(mem, H.ptr.shoal + 0x18), fish: S.shoal.fish.map((_, i) => readFish(mem, fishPtr(i))) });
  H.tsShoal = () => ({ follower: tsFollower(S.shoal.follower), fish: S.shoal.fish.map(tsFish) });
  H.writeBertha = () => { const b = S.bertha; writeFollower(mem, H.ptr.bertha + 0x18, b.follower); writeFish(mem, berthaFish, b.fish, RB + REC.BIGB * 0x68 + 0xc); };
  H.readBertha = () => ({ follower: readFollower(mem, H.ptr.bertha + 0x18), fish: readFish(mem, berthaFish) });
  H.tsBertha = () => ({ follower: tsFollower(S.bertha.follower), fish: tsFish(S.bertha.fish) });
  // the fish matrices (the shoal's own 4x4 blocks)
  H.writeFishMats = () => S.shoal.fish.forEach((f, i) => { for (let k = 0; k < 16; k++) mem.wf32(H.ptr.mats + i * 0x40 + 4 * k, f.m[k]); });
  H.readFishMat = (i) => Array.from({ length: 16 }, (_, k) => mem.f32(H.ptr.mats + i * 0x40 + 4 * k));
  // ---- the rod
  H.writeRod = () => { const r = S.rod, b = H.ptr.rod; mem.wf32(b + 0x18, r.bend); mem.wf32(b + 0x1c, r.vel); mem.wf32(b + 0x20, r.acc); mem.wf32(b + 0x24, r.target); };
  H.readRod = () => { const b = H.ptr.rod; return { bend: mem.f32(b + 0x18), vel: mem.f32(b + 0x1c), acc: mem.f32(b + 0x20), target: mem.f32(b + 0x24) }; };
  H.tsRod = () => ({ bend: S.rod.bend, vel: S.rod.vel, acc: S.rod.acc, target: S.rod.target });

  // ---- the spot table, popups, globals
  H.writeSpots = () => S.spots.forEach((s, i) => { const a = G.spots + i * 0x1c; mem.w32(a, s.record); mem.wf32(a + 4, s.x); mem.wf32(a + 8, s.y); mem.wf32(a + 0xc, s.z); mem.wf32(a + 0x10, s.dx); mem.wf32(a + 0x14, s.dy); mem.wf32(a + 0x18, s.dz); });
  H.readSpots = () => S.spots.map((_, i) => { const a = G.spots + i * 0x1c; return { record: mem.r32(a), x: mem.f32(a + 4), y: mem.f32(a + 8), z: mem.f32(a + 0xc), dx: mem.f32(a + 0x10), dy: mem.f32(a + 0x14), dz: mem.f32(a + 0x18) }; });
  H.writePopups = () => S.popups.slots.forEach((p, i) => {
    const a = G.popups + i * 0x2c;
    mem.w32(a, p.active ? 1 : 0);
    const str = p.text ?? p.id;
    for (let k = 0; k < 12; k++) mem.w8(a + 4 + k, 0);
    for (let k = 0; k < str.length && k < 12; k++) mem.w8(a + 4 + k, str.charCodeAt(k));
    mem.w32(a + 0x10, p.on); mem.w32(a + 0x14, p.off); mem.w32(a + 0x18, p.visible ? 1 : 0); mem.w32(a + 0x1c, p.count); mem.w32(a + 0x20, p.x); mem.w32(a + 0x24, p.y); mem.wf32(a + 0x28, p.timer);
  });
  H.readPopups = () => S.popups.slots.map((_, i) => { const a = G.popups + i * 0x2c; return { active: mem.r32(a) !== 0 ? 1 : 0, text: mem.cstr(a + 4, 12 + 5), on: mem.r32(a + 0x10), off: mem.r32(a + 0x14), visible: mem.r32(a + 0x18) !== 0 ? 1 : 0, count: mem.r32(a + 0x1c), x: mem.r32(a + 0x20), y: mem.r32(a + 0x24), timer: mem.f32(a + 0x28) }; });
  H.writeGlobals = () => {
    mem.w32(G.result, S.result); mem.w32(G.fishing, H.ptr.fishing); mem.w32(G.switchInit, 1);
    mem.wf32(0x8b1718, w.dt); mem.wf32(0x8b171c, 1 / w.dt);
    mem.w32(0x9dec18, RB + REC.LAND * 0x68);
    mem.w32(0x983840, w.input.pressed >>> 0); mem.w32(0x98383c, w.input.held >>> 0); mem.w32(0x983848, w.input.held >>> 0);
    mem.w32(0x9da5cc, w.frame >>> 0); mem.w32(0x987660, 0);
    mem.w32(G.splashOn, S.splash.on ? 1 : 0); mem.wf32(G.splashAt, S.splash.x); mem.wf32(G.splashAt + 4, S.splash.y); mem.wf32(G.splashAt + 8, S.splash.z);
    mem.wf32(G.camPreset, S.cam.x); mem.wf32(G.camPreset + 4, S.cam.y); mem.wf32(G.camPreset + 8, S.cam.z); mem.wf32(G.camHeight, S.cam.h);
    for (let i = 0; i < 18; i++) mem.wf32(G.camera + 4 * i, w.camera.c[i]);
    mem.wf32(G.rodTip, S.rodTip[0]); mem.wf32(G.rodTip + 4, S.rodTip[1]); mem.wf32(G.rodTip + 8, S.rodTip[2]);
    mem.w32(0x5d5c3dc, 0xA1); mem.w32(0x5d5c3d8, 0xA2);
    mem.wf32(G.bestMetric, S.pick.best); mem.w32(G.bestFish, ptrOfFish(S.pick.fish));
  };
  H.readGlobals = () => ({
    result: mem.r32(G.result), splashOn: mem.r32(G.splashOn) !== 0 ? 1 : 0, splash: [0, 1, 2].map((i) => mem.f32(G.splashAt + 4 * i)),
    cam: [0, 1, 2, 3, 4, 5].map((i) => mem.f32(G.camera + 4 * i)), camPreset: [0, 1, 2].map((i) => mem.f32(G.camPreset + 4 * i)), camHeight: mem.f32(G.camHeight),
    rodTip: [0, 1, 2].map((i) => mem.f32(G.rodTip + 4 * i)), best: mem.f32(G.bestMetric), bestFish: mem.u32(G.bestFish),
  });
  H.tsGlobals = () => ({
    result: S.result, splashOn: S.splash.on ? 1 : 0, splash: [S.splash.x, S.splash.y, S.splash.z], cam: Array.from(w.camera.c).slice(0, 6), camPreset: [S.cam.x, S.cam.y, S.cam.z], camHeight: S.cam.h,
    rodTip: [...S.rodTip], best: S.pick.best, bestFish: ptrOfFish(S.pick.fish),
  });
  H.reset = () => { const cpu = H.cpu; cpu.regs[4] = 0x7ff00000 - 0x100; cpu.top = 0; cpu.frames.length = 0; cpu.invalidate(); };
}

// ---------------------------------------------------------------------------------------------------------------------------------- constructors
const CT = { fishing: 0x6f8e5a, fswitch: 0x6f51e6, splash: 0x6f5aa1, shoal: 0x6f6034, bertha: 0x6f56d0, rod: 0x6f9cdc, fisherman: 0x6f937d };
export function runConstructors(H, tables) {
  const { cpu, mem, W } = H;
  const { w, S } = W;
  const P = H.ptr;
  for (const k of ['fishing', 'fswitch', 'splash', 'rod', 'fisherman']) mem.fill(P[k], 0x100, 0xcc);
  mem.fill(P.bertha, 0x110, 0xcc); mem.fill(P.shoal, 0x68, 0xcc); mem.fill(P.fish, 15 * 0xc0, 0xcc); mem.fill(P.mats, 15 * 0x40, 0);
  H.mirrorRecords();
  const A = NB + N.args;
  // argument blocks: Fishing [FLOT record], Bertha [0, 10 points, points], Shoal [15 fish, 3 models, models, 10 points, points]
  mem.w32(A, RB + REC.FLOT * 0x68);
  mem.w32(A + 0x20, 0); mem.w32(A + 0x24, 10); mem.w32(A + 0x28, TABLE.PATH);
  const lods = NB + N.lods;
  tables.lods.forEach((ri, i) => mem.w32(lods + 4 * i, RB + ri * 0x68));
  mem.w32(A + 0x40, 15); mem.w32(A + 0x44, 3); mem.w32(A + 0x48, lods); mem.w32(A + 0x4c, 10); mem.w32(A + 0x50, TABLE.PATH);
  const ctrl = P.ctrl; mem.fill(ctrl, 0x40, 0); mem.w32(ctrl, RB + REC.PEPP * 0x68);
  // the shoal's arrays are allocated by the constructor when it allocates its own node (param_3 == 0): done here
  mem.w32(P.shoal + 0x60, P.fish); mem.w32(P.shoal + 0x5c, P.mats);
  for (let i = 0; i < 15; i++) for (let k = 0; k < 16; k++) mem.wf32(P.mats + i * 0x40 + 4 * k, k % 5 === 0 ? 1 : 0);
  H.randSource = recordingRng(W.seed); H.randSource.recording = false;       // the same stream the port's constructors drew from, in the original's own order
  const call = (fn, rec, args, node, v, m, val) => { cpu.steps = 0; cpu.call(fn, [RB + rec * 0x68, args, node, v, m, val], { maxSteps: 2000000 }); };
  call(CT.bertha, REC.BIGB, A + 0x20, P.bertha, 2, 1, 1);
  call(CT.shoal, REC.WATE, A + 0x40, P.shoal, 2, 1, 1);
  call(CT.splash, REC.WATE, 0, P.splash, 2, 1, 1);
  call(CT.rod, REC.RODD, 0, P.rod, 2, 1, 1);
  call(CT.fswitch, REC.PEPP, 0, P.fswitch, 2, 1, 1);
  call(CT.fishing, REC.PEPP, A, P.fishing, 0xfb, 2, 2);
  H.ctorRandCalls = H.randCalls; H.randSource = null;
  // the controller links the switch reads (FUN_006f4bfa: DAT_05d5ca60 = *(*(node + 0x10) + 0x10) = the node at chain position 2)
  mem.w32(P.fswitch + 0x10, ctrl); mem.w32(ctrl + 0x10, P.fishing);
}

// ---------------------------------------------------------------------------------------------------------------------------------- one pass
const KIND = { FSwitch: 'fswitch', Fishing: 'fishing', Bertha: 'bertha', Shoal: 'shoal', Splash: 'splash', rod: 'rod' };
export function vtableOf(H, kind) { return [0x92f398, 0x92f588, 0x92f3e8, 0x92f488, 0x92f438, 0x92f780, 0x92f708].map((a) => a); }
const VT = { fswitch: 0x92f398, fishing: 0x92f588, bertha: 0x92f3e8, shoal: 0x92f488, splash: 0x92f438, rod: 0x92f780, fisherman: 0x92f708 };

/**
 * one update pass + the draw hooks of the nodes that ran, in the ORIGINAL, from the port's current state; returns everything compared.
 * `trace`: optional instruction trace callback.
 */
export function emuPass(H, opts = {}) {
  const { cpu, mem, W } = H, { w, S, pe } = W;
  H.bones.length = 0; H.log.length = 0; H.texts.length = 0; H.lines.length = 0; H.parts.length = 0; H.draws.length = 0; H.randCalls = 0;
  H.mirrorRecords(); H.writeGlobals(); H.writeSpots(); H.writePopups(); H.writeFishing(S.fishing); H.writeShoal(); H.writeBertha(); H.writeFishMats(); H.writeRod();
  const P = H.ptr;
  const ran = [], rets = {};
  const run = (fn, args) => { cpu.steps = 0; cpu.call(fn, args, { maxSteps: 4000000, trace: opts.trace }); return cpu.eax | 0; };
  for (const rec of w.records) {
    const c = rec.ctrl;
    if (!c || !c.enabled) continue;
    for (let i = 0; i < c.nodes.length; i++) {
      const n = c.nodes[i];
      if (!w.vars.gate(n.var, n.mask, n.value)) continue;
      const k = KIND[n.kind];
      if (!k) continue;
      const fn = pe.u32(VT[k]);
      const r = run(fn, [H.recPtr(rec), P[k], P.ctrl]);
      ran.push([rec.index, n.kind, i]); rets[`${rec.index}:${n.kind}`] = r;
      if (r === 0) continue;
      if (r === 1) break;
    }
  }
  const afterUpdate = { texts: H.texts.slice() };
  H.texts.length = 0;
  // the draw hooks (FUN_0042271b): the nodes that ran, in record order
  for (const [ri, kind] of ran) {
    const k = KIND[kind];
    const fn = pe.u32(VT[k] + 12);
    if (!fn || !['shoal', 'splash', 'rod', 'bertha'].includes(k)) continue;
    run(fn, [H.recPtr(w.records[ri]), P[k], P.ctrl, 0]);
  }
  return {
    recs: w.records.map((r) => H.readRec(r)), fishing: H.readFishing(), shoal: H.readShoal(), bertha: H.readBertha(), rod: H.readRod(), popups: H.readPopups(), globals: H.readGlobals(), spots: H.readSpots(),
    fishMats: S.shoal.fish.map((_, i) => H.readFishMat(i)), vars: w.vars.a.slice(), log: H.log.slice(), texts: afterUpdate.texts.concat(H.texts), lines: H.lines.slice(), parts: H.parts.slice(), draws: H.draws.slice(),
    ran, rets, rand: H.randCalls, bones: H.bones.slice(),
    anims: Object.fromEntries(w.records.filter((r) => r.anim).map((r) => [r.index, { clip: r.anim.clip, frame: r.anim.frame }])),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------- snapshot / restore of the port's state
const own = (o) => {
  const c = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' || v === null) c[k] = v;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) c[k] = v.slice();
    else if (v && typeof v === 'object' && 'index' in v && ('m' in v || 'bertha' in v)) c[k] = v;      // record / fish references
  }
  return c;
};
export function snapshotWorld(W) {
  const { w, S, rng } = W;
  const fish = [...S.shoal.fish, S.bertha.fish].map((f) => [f, { ...own(f), m: new Float32Array(f.m) }]);
  const fols = [S.shoal.follower, S.bertha.follower].map((f) => [f, { ...own(f), step: [...f.step], pos: [...f.pos] }]);
  return {
    vars: w.vars.a.slice(), tickCount: w.tickCount, frame: w.frame, input: { ...own(w.input) },
    recs: w.records.map((r) => ({ m: new Float32Array(r.m), prev: new Float32Array(r.prev), rx: r.rx, ry: r.ry, rz: r.rz, flags: r.flags, anim: r.anim ? own(r.anim) : null })),
    F: own(S.fishing), shoalOwn: own(S.shoal), berthaOwn: own(S.bertha), rod: own(S.rod), fish, fols, popups: S.popups.slots.map((p) => ({ ...p })), shared: { result: S.result, splash: { ...S.splash }, rodTip: [...S.rodTip], cam: { ...S.cam }, pickBest: S.pick.best, pickFish: S.pick.fish, line: S.line },
    cam: { c: new Float64Array(w.camera.c), prev: new Float64Array(w.camera.prev), vel: w.camera.vel }, rng: rng.s, rngCount: rng.count, rngDraws: rng.draws.length, logLen: W.log.length,
  };
}
export function restoreWorld(W, s) {
  const { w, S, rng } = W;
  w.vars.a.set(s.vars); w.tickCount = s.tickCount; w.frame = s.frame; Object.assign(w.input, s.input);
  s.recs.forEach((q, i) => { const r = w.records[i]; r.m.set(q.m); r.prev.set(q.prev); r.rx = q.rx; r.ry = q.ry; r.rz = q.rz; r.flags = q.flags; if (q.anim) Object.assign(r.anim, q.anim); });
  const F = S.fishing; for (const [k, v] of Object.entries(s.F)) F[k] = Array.isArray(v) ? v.slice() : v;
  for (const [k, v] of Object.entries(s.shoalOwn)) if (k !== 'fish') S.shoal[k] = v;
  for (const [k, v] of Object.entries(s.berthaOwn)) if (k !== 'fish') S.bertha[k] = v;
  for (const [k, v] of Object.entries(s.rod)) S.rod[k] = v;
  for (const [f, o] of s.fish) { for (const [k, v] of Object.entries(o)) if (k !== 'm') f[k] = v; f.m.set(o.m); }
  for (const [f, o] of s.fols) { for (const [k, v] of Object.entries(o)) if (k !== 'step' && k !== 'pos') f[k] = v; f.step = [...o.step]; f.pos = [...o.pos]; }
  s.popups.forEach((p, i) => Object.assign(S.popups.slots[i], p));
  S.result = s.shared.result; Object.assign(S.splash, s.shared.splash); S.rodTip = [...s.shared.rodTip]; Object.assign(S.cam, s.shared.cam); S.pick.best = s.shared.pickBest; S.pick.fish = s.shared.pickFish; S.line = s.shared.line;
  w.camera.c.set(s.cam.c); w.camera.prev.set(s.cam.prev); w.camera.vel = s.cam.vel;
  rng.s = s.rng; rng.count = s.rngCount; rng.draws.length = s.rngDraws; W.log.length = s.logLen;
}
