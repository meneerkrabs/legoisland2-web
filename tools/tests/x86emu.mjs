import { Cpu, Memory, createCpu } from '../../src/formats/x86emu.ts';
import { loadExe } from '../lib/engine-load.mjs';

// The concrete x86 interpreter (src/formats/x86emu.ts, docs/re/m4/emu.md): hand-assembled snippets (integer ALU / flags / division, loops,
// setcc / movzx / shifts, string instructions, x87 with float32 stores, compares through fnstsw, rounding-control changes, host functions
// with cdecl and stdcall clean-up) and real functions of the user's executable (CRT strncmp / strlen / memset / __ftol / sprintf, the island's
// FUN_004c3226 with hosted game variables).

const CODE = 0x401000, DATA = 0x403000;
function snippet(bytes) {
  const mem = new Memory();
  mem.addRegion({ lo: CODE, hi: CODE + 0x1000, name: 'code', init: (va, page) => { if (va === CODE) page.set(bytes); } });
  mem.addRegion({ lo: DATA, hi: DATA + 0x1000, name: 'data' });
  return new Cpu(mem);
}
const f32u = (f) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, f, true); return d.getUint32(0, true); };

export default {
  name: 'x86emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const eq = (a, b, msg) => ok(a === b, `${msg}: got ${a}, expected ${b}`);

    // --- integer: cdq / idiv / imul by an immediate
    {
      const cpu = snippet([0x8b, 0x44, 0x24, 0x04, 0x8b, 0x4c, 0x24, 0x08, 0x99, 0xf7, 0xf9, 0x6b, 0xc0, 0x03, 0xc3]);
      eq(cpu.call(CODE, [-17 >>> 0, 5]) | 0, -9, 'idiv -17 / 5 * 3');
      eq(cpu.regs[2], -2, 'idiv remainder');
      eq(cpu.call(CODE, [1000000007, -3 >>> 0]) | 0, -333333335 * 3, 'idiv with a negative divisor');
    }
    // --- loop with dec / jnz
    {
      const cpu = snippet([0x8b, 0x4c, 0x24, 0x04, 0x31, 0xc0, 0x01, 0xc8, 0x49, 0x75, 0xfb, 0xc3]);
      eq(cpu.call(CODE, [100]), 5050, 'sum loop');
    }
    // --- cmp / setl / movzx / sar / shl / or
    {
      const cpu = snippet([0x8b, 0x44, 0x24, 0x04, 0x83, 0xf8, 0x0a, 0x0f, 0x9c, 0xc1, 0x0f, 0xb6, 0xc9, 0xc1, 0xf8, 0x02, 0xc1, 0xe1, 0x08, 0x09, 0xc8, 0xc3]);
      eq(cpu.call(CODE, [40]), 10, 'setl false, sar 40');
      eq(cpu.call(CODE, [-20 >>> 0]) | 0, -5, 'setl true, sar -20 (bit 8 already set)');
      eq(cpu.call(CODE, [5]), 0x101, 'setl true, shl, or');
    }
    // --- rep stosd + rep movsb
    {
      const cpu = snippet([0x8b, 0x7c, 0x24, 0x04, 0xb9, 0x08, 0, 0, 0, 0xb8, 0xcc, 0xcc, 0xcc, 0xcc, 0xf3, 0xab,
        0x8b, 0x74, 0x24, 0x04, 0x8b, 0x7c, 0x24, 0x08, 0xb9, 0x05, 0, 0, 0, 0xf3, 0xa4, 0xc3]);
      cpu.call(CODE, [DATA, DATA + 0x100]);
      eq(cpu.mem.u32(DATA + 28), 0xcccccccc, 'rep stosd fills 8 dwords');
      eq(cpu.mem.u32(DATA + 32), 0, 'rep stosd stops');
      eq(cpu.mem.r8(DATA + 0x104), 0xcc, 'rep movsb copies 5 bytes');
      eq(cpu.mem.r8(DATA + 0x105), 0, 'rep movsb stops');
      eq(cpu.regs[1], 0, 'ecx = 0 after rep');
    }
    // --- x87: float32 add with float32 store, compare via fnstsw / test ah, 0x41
    {
      const cpu = snippet([0xd9, 0x44, 0x24, 0x04, 0xd8, 0x44, 0x24, 0x08, 0xd9, 0x1d, 0x00, 0x30, 0x40, 0x00, 0xd9, 0x05, 0x00, 0x30, 0x40, 0x00,
        0xd8, 0x5c, 0x24, 0x08, 0xdf, 0xe0, 0xf6, 0xc4, 0x41, 0x0f, 0x94, 0xc0, 0x0f, 0xb6, 0xc0, 0xc3]);
      eq(cpu.call(CODE, [f32u(0.1), f32u(0.2)]), 1, 'fcomp: 0.1 + 0.2 > 0.2');
      eq(cpu.mem.f32(DATA), Math.fround(Math.fround(0.1) + Math.fround(0.2)), 'fstp m32 rounds to float32');
      eq(cpu.call(CODE, [f32u(-1), f32u(0.5)]), 0, 'fcomp: -0.5 < 0.5');
      eq(cpu.top, 0, 'x87 stack balanced');
    }
    // --- x87: rounding control (the __ftol pattern) and default round-to-nearest-even
    {
      const cpu = snippet([0xd9, 0x44, 0x24, 0x04, 0x83, 0xec, 0x08, 0xd9, 0x3c, 0x24, 0x66, 0x8b, 0x04, 0x24, 0x80, 0xcc, 0x0c, 0x66, 0x89, 0x44, 0x24, 0x02,
        0xd9, 0x6c, 0x24, 0x02, 0xdb, 0x5c, 0x24, 0x04, 0xd9, 0x2c, 0x24, 0x8b, 0x44, 0x24, 0x04, 0x83, 0xc4, 0x08, 0xc3]);
      eq(cpu.call(CODE, [f32u(-2.75)]) | 0, -2, 'fistp with truncation');
      eq(cpu.cw, 0x27f, 'control word restored');
      const near = snippet([0xd9, 0x44, 0x24, 0x04, 0xdb, 0x5c, 0x24, 0x04, 0x8b, 0x44, 0x24, 0x04, 0xc3]);
      eq(near.call(CODE, [f32u(-2.5)]) | 0, -2, 'fistp rounds half to even (-2.5)');
      eq(near.call(CODE, [f32u(3.5)]) | 0, 4, 'fistp rounds half to even (3.5)');
    }
    // --- host functions: cdecl (caller cleans) and stdcall (host pops its argument)
    {
      const code = [0x6a, 0x07, 0x6a, 0x05, 0xe8, 0, 0, 0, 0, 0x83, 0xc4, 0x08, 0x6a, 0x03, 0xe8, 0, 0, 0, 0, 0xc3];
      const rel = (at, to) => { const r = to - (CODE + at + 5); code[at + 1] = r & 0xff; code[at + 2] = (r >> 8) & 0xff; code[at + 3] = (r >> 16) & 0xff; code[at + 4] = (r >>> 24) & 0xff; };
      rel(4, 0x401100); rel(14, 0x401200);
      const cpu = snippet(code);
      cpu.hooks.set(0x401100, (c) => { c.eax = c.arg(0) * 10 + c.arg(1); });
      cpu.hooks.set(0x401200, (c) => { c.eax = c.eax + c.arg(0); return 4; });
      const sp = cpu.esp;
      eq(cpu.call(CODE), 60, 'hosted cdecl + stdcall calls');
      eq(cpu.esp, sp, 'stack balanced after the hosted calls');
      // the fallback catches call targets outside `exec`
      const cpu2 = snippet(code);
      const seen = [];
      cpu2.exec = [[CODE, CODE + 0x100]];
      cpu2.fallback = (a) => (c) => { seen.push(a); c.eax = 1; return a === 0x401200 ? 4 : 0; };
      eq(cpu2.call(CODE), 1, 'fallback host');
      ok(seen.length === 2 && seen[0] === 0x401100 && seen[1] === 0x401200, `fallback saw ${seen.map((x) => x.toString(16))}`);
    }
    // --- an unimplemented opcode reports its address
    {
      const cpu = snippet([0x90, 0x0f, 0x0b]);
      let msg = '';
      try { cpu.call(CODE); } catch (e) { msg = String(e.message); }
      ok(/unimplemented opcode 0x0f0b at 0x401001/.test(msg), `ud2 error: ${msg}`);
    }

    // --- real functions of the executable
    const pe = loadExe(ctx.dataRoot);
    const cpu = createCpu(pe);
    const HEAP = 0x20000000;
    cpu.mem.addRegion({ lo: HEAP, hi: HEAP + 0x10000, name: 'heap' });
    cpu.mem.write(HEAP, [...'PAG1\0'].map((c) => c.charCodeAt(0)));
    cpu.mem.write(HEAP + 0x10, [...'PAG2\0'].map((c) => c.charCodeAt(0)));
    eq(cpu.call(0x85e410, [HEAP, HEAP + 0x10, 3]), 0, 'strncmp(PAG1, PAG2, 3)');
    ok((cpu.call(0x85e410, [HEAP, HEAP + 0x10, 4]) | 0) < 0, 'strncmp(PAG1, PAG2, 4) < 0');
    eq(cpu.call(0x85b330, [HEAP]), 4, 'strlen');
    cpu.call(0x85c3f0, [HEAP + 0x101, 0x5a, 0x123]);
    ok(cpu.mem.r8(HEAP + 0x100) === 0 && cpu.mem.r8(HEAP + 0x101) === 0x5a && cpu.mem.r8(HEAP + 0x223) === 0x5a && cpu.mem.r8(HEAP + 0x224) === 0, 'memset (unaligned start, dword body, tail)');
    // __ftol: st0 -> eax (truncation)
    for (const v of [3.99, -3.99, 123456.5, -0.5]) {
      cpu.fpush(v);
      const r = cpu.call(0x85c920) | 0;
      eq(r, Math.trunc(v), `__ftol(${v})`);
    }
    // sprintf(buf, "%s_%d", "W_ROAD", -42) (FUN_0085ac00 = the CRT sprintf of the build)
    cpu.mem.write(HEAP + 0x400, [...'%s_%d\0'].map((c) => c.charCodeAt(0)));
    cpu.mem.write(HEAP + 0x420, [...'W_ROAD\0'].map((c) => c.charCodeAt(0)));
    try {
      cpu.call(0x85ac00, [HEAP + 0x500, HEAP + 0x400, HEAP + 0x420, -42 >>> 0], { maxSteps: 200000 });
      eq(cpu.mem.cstr(HEAP + 0x500), 'W_ROAD_-42', 'sprintf');
    } catch (e) { failures.push(`sprintf: ${e.message}`); }
    // FUN_004c3226(era): with the game-variable functions hosted
    {
      const vars = new Map();
      const log = [];
      cpu.hooks.set(0x417575, (c) => { c.eax = vars.get(c.arg(0)) ?? 0; });
      cpu.hooks.set(0x417597, (c) => { log.push(['set', c.arg(0), c.arg(1)]); vars.set(c.arg(0), c.arg(1)); });
      cpu.hooks.set(0x41761b, (c) => { log.push(['or', c.arg(0), c.arg(1)]); vars.set(c.arg(0), (vars.get(c.arg(0)) ?? 0) | c.arg(1)); });
      cpu.invalidate();
      cpu.call(0x4c3226, [2]);
      ok(log.length === 45 && log[0][0] === 'or' && log[0][1] === 0xc1 && log[0][2] === 4 && log[1][1] === 0xb3 && log[1][2] === 100 && log[44][1] === 0xc4, `FUN_004c3226(2) writes: ${JSON.stringify(log.slice(0, 3))} (${log.length})`);
      log.length = 0;
      cpu.call(0x4c3226, [2]);
      eq(log.length, 0, 'FUN_004c3226(2) a second time: bit 2 of var 0xc1 is set, nothing written');
    }
    notes.push(`executable functions: ${cpu.steps} instructions`);
    return { checked, failures, notes };
  },
};
