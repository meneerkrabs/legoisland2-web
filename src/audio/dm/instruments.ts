// Band instrument -> DLS instrument resolution.
import type { DmBandInstrument } from './format.ts';
import type { DlsCollection, DlsInstrument } from './dls.ts';

export interface ResolvedInstrument { collection: DlsCollection; instrument: DlsInstrument; exact: boolean }

export function patchParts(patch: number) {
  return { drum: (patch & 0x80000000) !== 0, msb: (patch >>> 16) & 0x7f, lsb: (patch >>> 8) & 0x7f, program: patch & 0x7f };
}

function find(col: DlsCollection, patch: number): DlsInstrument | null {
  const p = patchParts(patch);
  let best: DlsInstrument | null = null;
  for (const i of col.instruments) {
    if (i.drum !== p.drum || i.program !== p.program) continue;
    if (i.msb === p.msb && i.lsb === p.lsb) return i;
    if (!best && i.msb === p.msb) best = i;
  }
  return best;
}

/**
 * Find the DLS instrument a band entry asks for: first in the primary collection of the segment (the music table's .dls: the game
 * redirects every band to it), then in the collection the entry names. Returns null when the entry points at the default GM set (not shipped).
 */
export function resolveInstrument(inst: DmBandInstrument, collections: Map<string, DlsCollection>): ResolvedInstrument | null {
  // the game connects every band to the music table's .dls (GUID_ConnectToDLSCollection), so that collection ("") comes first
  const tried: DlsCollection[] = [];
  const names = ['', inst.ref?.file.toLowerCase() ?? ''];
  for (const n of names) {
    const c = collections.get(n);
    if (!c || tried.includes(c)) continue;
    tried.push(c);
    const i = find(c, inst.patch);
    if (i) return { collection: c, instrument: i, exact: i.msb === ((inst.patch >>> 16) & 0x7f) && i.lsb === ((inst.patch >>> 8) & 0x7f) };
  }
  for (const c of collections.values()) {
    if (tried.includes(c)) continue;
    tried.push(c);
    const i = find(c, inst.patch);
    if (i) return { collection: c, instrument: i, exact: i.msb === ((inst.patch >>> 16) & 0x7f) && i.lsb === ((inst.patch >>> 8) & 0x7f) };
  }
  return null;
}
