// Hex patches of the executable (patch.txt of a mod package), applied to the in-memory EXE bytes before the engine reads its tables from them
// (`GameData.exe()` -> `ModdedFiles.read(exe)`), plus the report of which patches can have an effect in this port.
import type { PatchLine } from './package.ts';

export type PatchStatus =
  /** written */
  | 'applied'
  /** the bytes were already the new ones (a patch applied twice, or a build that already has the change) */
  | 'already'
  /** the line's original bytes are not there (another version of the game, or another patch got there first): left alone */
  | 'mismatch'
  /** the offset lies outside the executable */
  | 'range';

export interface PatchResult { patch: PatchLine; status: PatchStatus }

const same = (a: Uint8Array, at: number, b: Uint8Array) => { for (let i = 0; i < b.length; i++) if (a[at + i] !== b[i]) return false; return true; };

/**
 * Apply `patches` in order to a COPY of `exe` (the original array is not touched; nothing is copied when there are no patches). A line with original bytes
 * is only written where those bytes are (the manager's rule: "29B2;01;00" writes 01 only if the byte was 00); without them the bytes are written unconditionally.
 */
export function applyPatches(exe: Uint8Array, patches: readonly PatchLine[]): { data: Uint8Array; results: PatchResult[] } {
  if (!patches.length) return { data: exe, results: [] };
  const data = exe.slice();
  const results: PatchResult[] = [];
  for (const p of patches) {
    const end = p.offset + p.bytes.length;
    if (p.offset < 0 || end > data.length) { results.push({ patch: p, status: 'range' }); continue; }
    if (same(data, p.offset, p.bytes)) { results.push({ patch: p, status: 'already' }); continue; }
    if (p.original && !same(data, p.offset, p.original)) { results.push({ patch: p, status: 'mismatch' }); continue; }
    data.set(p.bytes, p.offset);
    results.push({ patch: p, status: 'applied' });
  }
  return { data, results };
}

export const STATUS_TEXT: Record<PatchStatus, string> = {
  applied: 'toegepast',
  already: 'stond er al',
  mismatch: 'overgeslagen: de oorspronkelijke bytes kloppen niet (andere versie van het spel?)',
  range: 'overgeslagen: adres ligt buiten het programma',
};
