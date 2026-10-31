import { loadExe } from '../lib/engine-load.mjs';
import { createGameCpu } from '../../src/formats/x86emu.ts';
import { clampHeading, courseHeading } from '../../src/zones/z22bip/plane.ts';

// z22BIP heading clamp (FUN_0070afxx .. 0x70b0c2, `fcomp / fadd / fsub qword` with the band +-0.9 as a DOUBLE) at control word 0x7f (24-bit x87): the original's instructions run in the emulator
// and are compared with `clampHeading` of the port at tolerance 0, on random inputs and on the hard cases: a float32 `la` so small that la + 0.9 (exact) is NOT a double and the
// double sum lands exactly on a 24-bit tie (rounding the double sum to float32 rounds twice and picks the wrong neighbour). A BigInt reference (exact sum, one rounding) is the third judge.
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
const f32 = Math.fround;
const fromBits = (u) => { U32[0] = u >>> 0; return F32[0]; };
const bitsOf = (v) => { F32[0] = v; return U32[0]; };
const D64 = new Float64Array(1), B64 = new BigUint64Array(D64.buffer);
/** exact rational of a double as [numerator BigInt, exponent] (value = n * 2^e) */
function parts(v) {
  if (v === 0) return [0n, 0];
  D64[0] = Math.abs(v); const b = B64[0];
  const ex = Number((b >> 52n) & 0x7ffn); let m = b & 0xfffffffffffffn;
  let e = ex - 1075; if (ex) m |= 1n << 52n; else e = -1074;
  return [v < 0 ? -m : m, e];
}
/** x + y exactly, rounded once to 24 bits (round to nearest even), normal range only; returns the float32 */
function refSum(x, y) {
  const [a, ea] = parts(x), [b, eb] = parts(y);
  const e = Math.min(ea, eb);
  const n = (a << BigInt(ea - e)) + (b << BigInt(eb - e));           // value = n * 2^e exactly
  if (n === 0n) return 0;
  const neg = n < 0n, m = neg ? -n : n;
  const len = m.toString(2).length, sh = len - 24;                   // keep 24 bits
  let q, r, half;
  if (sh <= 0) { q = m << BigInt(-sh); r = 0n; half = 1n; } else { q = m >> BigInt(sh); r = m & ((1n << BigInt(sh)) - 1n); half = 1n << BigInt(sh - 1); }
  if (sh > 0 && (r > half || (r === half && (q & 1n)))) q += 1n;
  const v = Number(q) * 2 ** (e + Math.max(sh, 0));
  return neg ? -v : v;
}
const BAND = 0.9;
export default {
  name: 'm8-z22BIP-clamp',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const cpu = createGameCpu(pe);
    if (cpu.cw !== 0x7f) return { checked: 0, failures: [`control word ${cpu.cw.toString(16)}, expected 7f`] };
    const mem = cpu.mem;
    const EBP = cpu.esp - 0x2000, OBJ = EBP - 0x1000;     // frame and plane object on the stack
    // the original's clamp, entered at 0x70b060 and left at 0x70b0c2 (a hook there returns to the call's magic return address)
    cpu.hooks.set(0x70b0c2, () => 0);
    const orig = (la, heading) => {
      mem.w32(EBP - 0x298, OBJ); mem.wf32(EBP - 0x224, la);
      mem.w32(OBJ + 0x7c, bitsOf(heading));
      cpu.regs[5] = EBP;
      cpu.call(0x70b060, []);
      return fromBits(mem.u32(OBJ + 0x7c));
    };
    const cmp = (la, heading, tag) => {
      checked++;
      const a = orig(la, heading), b = clampHeading(la, heading);
      if (bitsOf(a) !== bitsOf(b)) failures.push(`${tag}: la ${la} heading ${heading}: original ${a} (0x${bitsOf(a).toString(16)}) port ${b} (0x${bitsOf(b).toString(16)})`);
    };
    // ---- random inputs around the band's edges
    let s = 12345; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < 4000; i++) {
      const la = f32((rnd() - 0.5) * 12), heading = f32(la + (rnd() - 0.5) * 3);
      cmp(la, heading, 'random');
    }
    // ---- the hard cases: la = tiny, la + 0.9 within half a double ulp of a 24-bit tie
    let hard = 0, wrongOld = 0, refBad = 0;
    for (let sign = -1; sign <= 1; sign += 2) {
      const jc = Math.round(BAND * 2 ** 25);
      for (let dj = -64; dj <= 64; dj++) {
        const j = jc + dj; if (!(j & 1)) continue;                      // odd multiples of 2^-25: the 24-bit ties of [0.5, 1)
        const T = j * 2 ** -25;
        const x0 = sign > 0 ? T - BAND : BAND - T;   // la + sign*0.9 = +-T
        const b0 = bitsOf(f32(x0));
        for (let k = -40; k <= 40; k++) {
          const la = fromBits(b0 + k);
          if (!Number.isFinite(la) || la === 0) continue;
          const want = sign > 0 ? refSum(la, BAND) : refSum(la, -BAND);
          const dbl = f32(sign > 0 ? la + BAND : la - BAND);
          const isHard = want !== dbl;
          if (isHard) { hard++; wrongOld++; }
          // heading far enough that the clamp fires: la - heading < -0.9 for the fadd arm, > 0.9 for the fsub arm
          const heading = sign > 0 ? f32(la + 2) : f32(la - 2);
          const port = clampHeading(la, heading);
          if (port !== want) { refBad++; failures.push(`reference: la ${la} sign ${sign}: port ${port} exact ${want}`); }
          cmp(la, heading, isHard ? 'tie' : 'near-tie');
        }
      }
    }
    // with the band constant 0.9 = 0x3FECCCCCCCCCCCCD no float32 can make float + 0.9 a double-rounding case (its low mantissa bits 0xCCCCCD cannot be cancelled): `hard` is 0 here, the
    // ties are therefore exercised by the sum of FUN_0085d640's double result below
    notes.push(`clamp: random 4000 + ${checked - 4000} near-tie inputs (la + 0.9 hard cases: ${hard}), emulator == port == exact reference`);
    // ---- 0x70af94 .. 0x70afa0: la = (double) atan2 + headCorr (float): the double sum is NOT the exact sum when the double is wider than the sum's binade allows
    cpu.hooks.set(0x70afa6, () => 0);
    const origSum = (a, hc) => {
      mem.w32(EBP - 0x298, OBJ); mem.wf32(OBJ + 0xa4, hc); cpu.regs[5] = EBP;
      const top0 = cpu.top; cpu.fpush(a);
      cpu.call(0x70af94, []);
      cpu.top = top0;
      return mem.f32(EBP - 0x224);
    };
    let hard2 = 0, n2 = 0;
    const H = [fromBits(0x40c90fdb), -fromBits(0x40c90fdb), fromBits(0x41490fdb), -fromBits(0x41490fdb), fromBits(0x3fc90fdb), -fromBits(0x3fc90fdb)];   // 2 pi, 4 pi, pi / 2 and negatives
    for (const hc of H) {
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        for (let q = 0; q < 6000; q++) {
          // a = T - hc + sgn * 2^-51 around an odd multiple T of half an ulp24 of the sum's binade, with |a| < pi
          const tgt = (Math.abs(hc) + 2.5 + q * 1e-4) * Math.sign(hc);
          const ulp = 2 ** (Math.floor(Math.log2(Math.abs(tgt))) - 23);
          const T = (Math.floor(Math.abs(tgt) / ulp) + 0.5) * ulp * Math.sign(tgt);       // a 24-bit tie
          const a = (T - hc) + sgn * 2 ** -51;
          if (!(Math.abs(a) < 3.1415927410125732)) continue;
          const want = refSum(a, hc);
          n2++; checked++;
          if (want !== f32(a + hc)) hard2++;
          const o = origSum(a, hc), p = courseHeading(a, hc);
          if (bitsOf(o) !== bitsOf(p) || p !== want) failures.push(`sum: a ${a} headCorr ${hc}: original ${o} port ${p} exact ${want}`);
        }
      }
    }
    if (hard2 < 100) failures.push(`only ${hard2} of ${n2} sum cases are ones where float32(double sum) is wrong`);
    notes.push(`course heading sum: ${n2} tie-adjacent inputs, ${hard2} of them are cases where float32(double a + headCorr) rounds twice and is wrong; emulator == port == exact reference`);
    return { checked, failures, notes };
  },
};
