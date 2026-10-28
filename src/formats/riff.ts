// Generic RIFF chunk tree walker (WAV, DirectMusic .sty/.sgt/.dls, ...). Pure, no DOM.
export interface RiffChunk {
  /** 4-char chunk id ("fmt ", "data", "LIST", "RIFF", ...) */
  id: string;
  /** for RIFF/LIST: the form/list type ("WAVE", "DMST", "DMSG", "DLS ", "INFO", "ins ", "lrgn", ...) */
  type: string | null;
  /** absolute offset of the chunk header (the id) */
  offset: number;
  /** absolute offset of the payload (after the type tag for RIFF/LIST) */
  dataOffset: number;
  /** payload size in bytes as stored (including the 4 type bytes for RIFF/LIST) */
  size: number;
  /** payload length actually available (can be smaller if the file is truncated) */
  available: number;
  children: RiffChunk[];
}

function tag(d: Uint8Array, p: number): string {
  return String.fromCharCode(d[p], d[p + 1], d[p + 2], d[p + 3]);
}

function walk(d: Uint8Array, dv: DataView, start: number, end: number, out: RiffChunk[], problems: string[]) {
  let o = start;
  while (o + 8 <= end) {
    const id = tag(d, o);
    const size = dv.getUint32(o + 4, true);
    const dataOffset = o + 8;
    const available = Math.min(size, end - dataOffset);
    if (available < size) problems.push(`chunk "${id}" at ${o} claims ${size} bytes, only ${available} available`);
    const c: RiffChunk = { id, type: null, offset: o, dataOffset, size, available, children: [] };
    if ((id === 'RIFF' || id === 'LIST') && available >= 4) {
      c.type = tag(d, dataOffset);
      walk(d, dv, dataOffset + 4, dataOffset + available, c.children, problems);
    }
    out.push(c);
    o = dataOffset + size + (size & 1);
  }
  if (o < end && end - o > 1) problems.push(`${end - o} trailing bytes at ${o}`);
}

export interface RiffFile {
  chunks: RiffChunk[];
  /** non-fatal anomalies (truncated chunk, trailing bytes) */
  problems: string[];
}

/** Parse the top-level chunks (usually exactly one "RIFF"). Throws if the file does not start with RIFF. */
export function parseRiff(data: Uint8Array): RiffFile {
  if (data.length < 12 || tag(data, 0) !== 'RIFF') throw new Error('not a RIFF file');
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const chunks: RiffChunk[] = [];
  const problems: string[] = [];
  walk(data, dv, 0, data.length, chunks, problems);
  return { chunks, problems };
}

/** First direct child with the given id (and, for LIST, optionally the given list type). */
export function findChunk(parent: RiffChunk, id: string, type?: string): RiffChunk | undefined {
  return parent.children.find((c) => c.id === id && (type === undefined || c.type === type));
}

export function findChunks(parent: RiffChunk, id: string, type?: string): RiffChunk[] {
  return parent.children.filter((c) => c.id === id && (type === undefined || c.type === type));
}

/** Payload bytes of a chunk (for RIFF/LIST the bytes after the type tag). */
export function chunkData(data: Uint8Array, c: RiffChunk): Uint8Array {
  const skip = c.type !== null ? 4 : 0;
  return data.subarray(c.dataOffset + skip, c.dataOffset + c.available);
}

/** Count chunks by "id" or "LIST:type" over the whole tree. */
export function countChunks(root: RiffChunk[], into: Record<string, number> = {}): Record<string, number> {
  for (const c of root) {
    const k = c.type !== null && c.id === 'LIST' ? `LIST:${c.type}` : c.id === 'RIFF' ? `RIFF:${c.type}` : c.id;
    into[k] = (into[k] ?? 0) + 1;
    countChunks(c.children, into);
  }
  return into;
}
