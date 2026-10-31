// WP-TIME item 3: the start value of a freshly loaded animated texture's timer. The original loader FUN_004112ac runs NATIVELY in the x86 interpreter (control word of the game) on a synthetic
// `.wib` (file, allocation, Direct3D surface and pixel conversion are host functions; the parsing, the struct set-up and the closing playback pass FUN_00410ff8 / __ftol / memcpy are the
// executable's own code) with `DAT_008b1718` set to several values; the struct's timer (+0x20), last (+0x24) and mode (+0x28) afterwards are compared with `newAnim` of the renderer
// (src/render/renderer.ts), which `Renderer.texture` uses with `loadDt`.
import { createGameCpu } from '../../src/formats/x86emu.ts';
import { newAnim } from '../../src/render/renderer.ts';
import { loadExe } from '../lib/engine-load.mjs';

const BASE = 0x30000000;
const DT = 0x8b1718, FMT_TABLE_PTR = 0x983cdc, DD_PTR = 0x983a30;

/** runs FUN_004112ac for a `.wib` with `seq` as playback sequence and `dt` in DAT_008b1718: { ok, timer, last, mode, locks } */
function loadWib(pe, seq, dt, fmtId = 0) {
  const cpu = createGameCpu(pe), mem = cpu.mem;
  mem.addRegion({ lo: BASE, hi: BASE + 0x200000, name: 'heap' });
  const W = 4, H = 4, FRAMES = Math.max(...seq) + 1, BPP = fmtId === 0 ? 3 : 4;
  // file: 'WIBF', count, entries, 'WIBT', width, height, format, frames, pixels
  const bytes = [];
  const u32 = (v) => { for (let i = 0; i < 4; i++) bytes.push((v >>> (8 * i)) & 255); };
  const tag = (s) => { for (const c of s) bytes.push(c.charCodeAt(0)); };
  tag('WIBF'); u32(seq.length); for (const e of seq) u32(e); tag('WIBT'); u32(W); u32(H); u32(fmtId); u32(FRAMES);
  for (let i = 0; i < FRAMES * W * H * BPP; i++) bytes.push((i * 7) & 255);
  const file = Uint8Array.from(bytes);
  let cur = 0, brk = BASE + 0x10000, locks = 0, unlocks = 0;
  const alloc = (n) => { const a = brk; brk += (n + 15) & ~15; return a; };
  cpu.hooks.set(0x435843, () => { cpu.eax = 0x1234; });                         // FUN_00435843(name, "rb", file, line): the open
  cpu.hooks.set(0x435350, (c) => { const [buf, size, count] = [c.arg(0), c.arg(1), c.arg(2)]; for (let i = 0; i < size * count; i++) mem.w8(buf + i, file[cur++]); c.eax = count; });   // the read
  cpu.hooks.set(0x4358e9, () => { cpu.eax = 0; });                              // the close
  cpu.hooks.set(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });                 // the allocator
  cpu.hooks.set(0x433d60, () => {});                                            // the free
  cpu.hooks.set(0x40dd5f, (c) => { c.eax = 3; });                               // the surface format lookup (index 3 of the table)
  cpu.hooks.set(0x40cfb5, () => {});                                            // the HRESULT check
  cpu.hooks.set(0x40dfa9, () => {});                                            // the pixel converter
  // the pixel format table: entry 3 at DAT_00983cdc + 3 * 0x44: +0 bits per pixel (16), +0x24.. the 8-dword pixel format
  const TABLE = BASE + 0x1000;
  mem.w32(FMT_TABLE_PTR, TABLE); mem.w32(TABLE + 3 * 0x44, 16);
  // DirectDraw: IDirectDraw7::CreateSurface (+0x18) hands out a surface whose Lock (+100) fills desc.lpSurface (desc + 0x24) and whose Unlock is +0x80
  const DD = BASE + 0x2000, DDV = BASE + 0x2100, SURF = BASE + 0x2200, SV = BASE + 0x2300, LOCKFN = BASE + 0x2400, UNLOCKFN = BASE + 0x2410, CREATEFN = BASE + 0x2420, PIX = BASE + 0x4000;
  mem.w32(DD_PTR, DD); mem.w32(DD, DDV); mem.w32(DDV + 0x18, CREATEFN); mem.w32(SURF, SV); mem.w32(SV + 100, LOCKFN); mem.w32(SV + 0x80, UNLOCKFN);
  cpu.hooks.set(CREATEFN, (c) => { mem.w32(c.arg(2), SURF); c.eax = 0; return 16; });
  cpu.hooks.set(LOCKFN, (c) => { locks++; mem.w32(c.arg(2) + 0x24, PIX); c.eax = 0; return 20; });
  cpu.hooks.set(UNLOCKFN, () => { unlocks++; return 8; });
  mem.wf32(DT, dt);
  const NAME = BASE + 0x3000, TEX = BASE + 0x3100;
  const name = 'water.wib'; for (let i = 0; i < name.length; i++) mem.w8(NAME + i, name.charCodeAt(i));
  const r = cpu.call(0x4112ac, [NAME, TEX, 3]);
  const tex35 = mem.u32(TEX + 0x35 * 4);
  return { ok: r, timer: mem.f32(tex35 + 0x20), last: mem.r32(tex35 + 0x24), mode: mem.r32(tex35 + 0x28), count: mem.r32(tex35 + 0x18), locks, unlocks };
}

export default {
  name: 'wp-time-wib-load',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    const seqs = [[0, 0, 1, 1, 2, 2, 3, 3], [0, 1], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]];
    for (const seq of seqs) {
      for (const dt of [1, 0.5, 0.25, Math.fround(0.1), 1.5, 3, 2.5, Math.fround(0.7)]) {
        const o = loadWib(pe, seq, dt);
        const frames = Array.from({ length: Math.max(...seq) + 1 }, () => new Uint8Array(4));
        const a = newAnim(frames, Uint32Array.from(seq), 0, dt);
        ok((o.ok & 0xff) === 1 && o.count === seq.length, `load ok (seq ${seq.length}, dt ${dt}): ${o.ok.toString(16)} ${o.count}`);
        ok(o.mode === 0 && o.last === 0 && o.locks === 1 && o.unlocks === 1, `mode ${o.mode} last ${o.last}, one playback pass (${o.locks} locks) (seq ${seq.length}, dt ${dt})`);
        ok(Object.is(o.timer, a.timer), `fresh timer: original ${o.timer}, port ${a.timer} (seq ${seq.length}, dt ${dt})`);
        ok(a.mode === o.mode && a.last === o.last && a.current === seq[0], `port mode / last / entry (seq ${seq.length}, dt ${dt})`);
      }
    }
    // the timer is `1.0 * DAT_008b1718` (not a constant 0.5): dt 1 gives 1, dt 0.5 gives 0.5; and the sequence-end restart (dt >= length) gives 0
    ok(loadWib(pe, [0, 1, 2, 3], 1).timer === 1 && loadWib(pe, [0, 1, 2, 3], 0.5).timer === 0.5, 'timer = dt at the load');
    ok(loadWib(pe, [0, 1], 3).timer === 0, 'a sequence not longer than the first step restarts at 0');
    // the initial value of the global in the executable image (before any loop pass) is 1.0
    ok(Math.abs(pe.data.subarray(pe.offset(DT), pe.offset(DT) + 4).reduce((s, b, i) => s + b * 256 ** i, 0) - 0x3f800000) === 0, 'DAT_008b1718 starts at 1.0');
    notes.push(`${seqs.length * 8} loads compared`);
    return { checked, failures, notes };
  },
};
