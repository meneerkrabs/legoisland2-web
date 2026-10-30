// WP-SAVE: the ORIGINAL's whole writer FUN_00418ec7 and reader FUN_00419e82 (+ FUN_00419c45 header reader) run natively on an IslEmu machine that holds the original's own set-up state
// (tools/lib/m8-save.mjs `buildIslandOracle` / `buildHubOracle`: every node built by the original's constructors) and are compared with the port's `captureWorld` / `encodeSave` / `restoreWorld`.
// Hosted: the file calls (fopen / fwrite / fread / fclose), sprintf of the file name, time(), the demo check FUN_0045c432; everything else of the save code runs natively (vars, walkers,
// camera, anim accessors, decor, bricks, entity loop, the node serializers / loaders).
import { A } from './m7-shell-save-emu.mjs';
import { VAR_ARRAY, RECORDS_BASE, REC } from './m7-isl-veh-emu.mjs';

const SAVE_EXEC = [[0x417500, 0x417a00], [0x418e00, 0x41b700], [0x421b00, 0x421fa0], [0x43a4a1, 0x43a5e4], [0x447c90, 0x447cc0], [0x449a10, 0x449bd0], [0x462d8b, 0x462f40]];

/** add the save code's hosts to a machine (idempotent); `emu.time` = the value time() returns */
export function installSaveHost(emu) {
  if (emu._saveHost) return emu;
  emu._saveHost = true;
  const cpu = emu.cpu, mem = cpu.mem, H = cpu.hooks;
  emu.time = 0; emu.files = new Map(); emu.handles = new Map(); emu.nextHandle = 0x1000; emu.saveLog = [];
  for (const r of SAVE_EXEC) cpu.exec.push(r);
  H.set(0x85d410, (c) => { if (c.arg(0)) mem.w32(c.arg(0), emu.time); c.eax = emu.time; });
  H.set(0x85ac00, (c) => {       // sprintf(dest, fmt, ...): %02d / %d / %s occur at the save code's call sites
    const fmt = mem.cstr(c.arg(1));
    let ai = 2, out = '';
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] !== '%') { out += fmt[i]; continue; }
      i++;
      let pad = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') pad += fmt[i++];
      const v = c.arg(ai++);
      if (fmt[i] === 'd') out += String(v | 0).padStart(Number(pad) || 0, '0');
      else if (fmt[i] === 's') out += mem.cstr(v);
      else throw new Error(`m8-save-world: sprintf format ${fmt}`);
    }
    for (let i = 0; i < out.length; i++) mem.w8(c.arg(0) + i, out.charCodeAt(i));
    mem.w8(c.arg(0) + out.length, 0);
    c.eax = out.length;
  });
  H.set(0x85b1d0, (c) => {       // fopen(name, mode)
    const name = mem.cstr(c.arg(0)), mode = mem.cstr(c.arg(1));
    if (mode[0] === 'r' && !emu.files.has(name)) { c.eax = 0; return; }
    const h = emu.nextHandle++;
    emu.handles.set(h, { name, mode, pos: 0 });
    c.eax = h;
  });
  H.set(0x85bbb0, (c) => { const f = emu.handles.get(c.arg(3)); const n = c.arg(1) * c.arg(2); emu.files.set(f.name, mem.read(c.arg(0), n)); c.eax = c.arg(2); });
  H.set(0x85b9e0, (c) => {
    const f = emu.handles.get(c.arg(3)), src = emu.files.get(f.name) ?? new Uint8Array(0);
    const n = Math.min(c.arg(1) * c.arg(2), src.length - f.pos);
    mem.write(c.arg(0), src.subarray(f.pos, f.pos + n)); f.pos += n;
    c.eax = Math.floor(n / c.arg(1));
  });
  H.set(0x85af50, (c) => { emu.handles.delete(c.arg(0)); c.eax = 0; });
  H.set(0x45c432, (c) => { c.eax = emu.cutscene ? 1 : 0; });
  return emu;
}

/** make the machine's globals equal to the port world's (variables, camera, frame counter): what the writer reads that the oracle's own code did not produce */
export function syncGlobalsFromPort(emu, world) {
  const mem = emu.cpu.mem;
  for (let i = 0; i < 319; i++) mem.w32(VAR_ARRAY + 4 * i, world.vars.get(i) | 0);
  for (let k = 0; k < 18; k++) mem.wf32(A.CAMERA + 4 * k, world.camera.c[k]);
  mem.w32(A.FRAME, world.frame >>> 0);
}

/** FUN_00418ec7(slot): the file the original writes (0x51c8c bytes) */
export function originalWrite(emu, slot = 0, time = 1234567) {
  installSaveHost(emu);
  emu.time = time; emu.files.clear();
  emu.cpu.steps = 0;
  const ret = emu.cpu.call(0x418ec7, [slot >>> 0], { maxSteps: 400_000_000 }) | 0;
  const name = [...emu.files.keys()][0] ?? null;
  return { ret, name, bytes: name ? emu.files.get(name) : null };
}

/** FUN_00419c45 + FUN_00419e82 on `bytes` as the file of `slot`: the original's in-place load; { ok, ret } */
export function originalRead(emu, bytes, slot = 0) {
  installSaveHost(emu);
  const mem = emu.cpu.mem;
  emu.cpu.steps = 0;
  const name = mem.cstr(emu.cpu.call(0x418e40, [slot >>> 0]));
  emu.files.set(name, bytes);
  const out = emu.alloc(16);
  const ok = emu.cpu.call(0x419c45, [slot, out, out + 4, out + 8], { maxSteps: 50_000_000 }) | 0;
  if (!ok) return { ok, ret: -1 };
  emu.cpu.steps = 0;
  const ret = emu.cpu.call(0x419e82, [], { maxSteps: 400_000_000 }) | 0;
  return { ok, ret };
}

export { RECORDS_BASE, REC };

/** the C runtime's x87 math the interpreter cannot run (80 bit constants): sqrt of a double on the stack (FUN_0085d104), the 24 bit float wrappers FUN_004388e7; the 24 bit rounding of the result is the caller's */
export function installMathHosts(emu) {
  const H = emu.cpu.hooks, mem = emu.cpu.mem, f32 = (v) => Math.fround(v);
  H.set(0x85d104, (c) => { c.fpush(Math.sqrt(mem.f64(c.regs[4] + 4))); });
  H.set(0x85d1c4, (c) => { c.fpush(Math.sin(mem.f64(c.regs[4] + 4))); });   // sin(double) / cos(double) of FUN_0043a4a1 and the nodes
  H.set(0x85d374, (c) => { c.fpush(Math.cos(mem.f64(c.regs[4] + 4))); });
  H.set(0x85d640, (c) => { c.fpush(Math.atan2(mem.f64(c.regs[4] + 4), mem.f64(c.regs[4] + 12))); });
  H.set(0x4388e7, (c) => { c.fpush(f32(Math.sqrt(c.argf(0)))); });
  emu.cpu.invalidate?.();
  return emu;
}
