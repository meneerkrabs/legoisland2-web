// M5 z07CSI horse: the float32 matrix helpers of src/zones/z07CSI/horse/math.ts against the ORIGINAL's machine code run natively in the x86 interpreter:
// FUN_0043cec0 (normalise), FUN_0043ab72 (point * matrix), FUN_0043a4a1 / FUN_0043a5e4 (Euler rotation, + translation), on random vectors / matrices / angles (bit for bit).
import { makeCsiDuel, NATIVE_CTORS, lcg } from '../lib/m5-z07CSI-emu.mjs';
import { normalize, transformPoint, eulerRotation, f } from '../../src/zones/z07CSI/horse/math.ts';
import { GameRecord } from '../../src/game/record.ts';

const DVB = new DataView(new ArrayBuffer(4));
const bits = (x) => { DVB.setFloat32(0, x); return DVB.getUint32(0); };

export default {
  name: 'm5-z07CSI-horse-math',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const d = makeCsiDuel(ctx, { node: 21, seed: 1, dt: 1, failures, kinds: [], keepKinds: [], pepperKinds: [], vars: { 0xa3: 7 } });
    const cpu = d.emu.cpu, mem = cpu.mem;
    const buf = d.emu.alloc(0x400);
    const rnd = lcg(12345);
    const r = (lo, hi) => f(lo + rnd() * (hi - lo));
    const bad = { norm: 0, xform: 0, euler: 0, eulerT: 0 };
    const say = (k, m) => { bad[k]++; if (failures.length < 20) failures.push(m); };
    for (let n = 0; n < 4000; n++) {
      // normalise
      const v = [r(-100, 100), r(-100, 100), r(-100, 100)];
      if (n % 17 === 0) v[0] = 0; if (n % 19 === 0) v[1] = 0; if (n % 23 === 0) { v[0] = v[1] = v[2] = 0; }
      for (let k = 0; k < 3; k++) mem.wf32(buf + 4 * k, v[k]);
      cpu.steps = 0; cpu.call(0x43cec0, [buf], { maxSteps: 100000 });
      const p = [...v]; normalize(p);
      for (let k = 0; k < 3; k++) { checked++; if (mem.f32(buf + 4 * k) !== p[k]) say('norm', `normalise [${v}]: original ${mem.f32(buf + 4 * k)} port ${p[k]} (component ${k})`); }
      // point * matrix
      const m = new Float32Array(16);
      const a1 = r(-3, 3), a2 = r(-3, 3), a3 = r(-3, 3);
      const rot = eulerRotation(a1, a2, a3);
      m.set([rot[0], rot[1], rot[2], 0, rot[3], rot[4], rot[5], 0, rot[6], rot[7], rot[8], 0, r(-300, 300), r(-50, 80), r(-300, 300), 1]);
      const pt = [r(-30, 30), r(-30, 30), r(-30, 30)];
      for (let k = 0; k < 16; k++) mem.wf32(buf + 0x40 + 4 * k, m[k]);
      for (let k = 0; k < 3; k++) mem.wf32(buf + 0x80 + 4 * k, pt[k]);
      cpu.steps = 0; cpu.call(0x43ab72, [buf + 0x90, buf + 0x40, buf + 0x80], { maxSteps: 100000 });
      const q = transformPoint(m, pt);
      for (let k = 0; k < 3; k++) { checked++; if (mem.f32(buf + 0x90 + 4 * k) !== q[k]) say('xform', `xform: original ${mem.f32(buf + 0x90 + 4 * k)} port ${q[k]} (component ${k})`); }
      // Euler rotation (FUN_0043a4a1(matrix, rx, ry, rz)) and + translation (FUN_0043a5e4)
      const e = [r(-6.3, 6.3), r(-6.3, 6.3), r(-6.3, 6.3)];
      for (let k = 0; k < 16; k++) mem.wf32(buf + 0x100 + 4 * k, 0);
      cpu.steps = 0; cpu.call(0x43a4a1, [buf + 0x100, ...e.map(bits)], { maxSteps: 100000 });
      const rr = eulerRotation(...e);
      const idx = [0, 1, 2, 4, 5, 6, 8, 9, 10];
      for (let k = 0; k < 9; k++) { checked++; const o = mem.f32(buf + 0x100 + 4 * idx[k]); if (o !== rr[k]) say('euler', `euler [${e}]: m[${idx[k]}] original ${o} port ${rr[k]}`); }
    }
    notes.push(`mismatches: ${JSON.stringify(bad)}`);
    void GameRecord; void NATIVE_CTORS;
    return { checked, failures, notes };
  },
};
