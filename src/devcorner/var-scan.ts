// Evidence for the game-variable editor: which variables the executable touches with a CONSTANT index (unused.md 6.12, 8.4). A lower bound: 141 calls use computed indices.
// The accessors: FUN_00417575 get, FUN_00417597 set, FUN_0041761b or, FUN_0041766c and-not, FUN_004175ca add. MSVC debug code pushes the index last: `6A ib` / `68 id` right before `E8 rel32`.
import type { Pe } from '../formats/exe.ts';

export const VAR_FN = { get: 0x417575, set: 0x417597, or: 0x41761b, andnot: 0x41766c, add: 0x4175ca } as const;
export interface VarRefs { read: Uint32Array; write: Uint32Array }

export function scanVarRefs(pe: Pe, count = 319): VarRefs {
  const read = new Uint32Array(count), write = new Uint32Array(count);
  const kind = new Map<number, 'r' | 'w'>([[VAR_FN.get, 'r'], [VAR_FN.set, 'w'], [VAR_FN.or, 'w'], [VAR_FN.andnot, 'w'], [VAR_FN.add, 'w']]);
  const t = pe.text, d = pe.data;
  for (let i = 5; i + 5 <= t.rsize; i++) {
    const o = t.roff + i;
    if (d[o] !== 0xe8) continue;
    const target = (t.va + i + 5 + (d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16) | (d[o + 4] << 24))) >>> 0;
    const k = kind.get(target);
    if (!k) continue;
    let idx = -1;
    if (d[o - 2] === 0x6a) idx = d[o - 1];
    else if (d[o - 5] === 0x68) idx = (d[o - 4] | (d[o - 3] << 8) | (d[o - 2] << 16) | (d[o - 1] << 24)) >>> 0;
    if (idx >= 0 && idx < count) (k === 'r' ? read : write)[idx]++;
  }
  return { read, write };
}
