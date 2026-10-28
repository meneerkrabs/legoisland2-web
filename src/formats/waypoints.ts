// Waypoint formats: compiled `W_<MAP>_C.wpt` (loaded by the game), editor sources `*.way` / `*.wpt` (magic WPTP),
// the `.h` name enums and the `.wbt` build lists. See docs/re/fragments/script-text.md.
// Loader of the compiled form: FUN_004630c0 (0x004630c0), next-hop lookup FUN_00448049 (route matrix).
import { Reader, latin1 } from './reader.ts';

// ----------------------------------------------------------------------------- compiled `_C.wpt`

export interface WaypointNode {
  /** position (game coordinates: the editor's x is negated by the compiler) */
  x: number; y: number; z: number;
  /** node+0x0c: route group (index into the edge matrices; -1 = none) */
  group: number;
  /** node+0x0e: index of this node inside its group */
  index: number;
  /** node+0x10 (u8): 0xff for plain waypoints, other values mark special nodes (see doc) */
  kind: number;
  /** node+0x11 (u8): mask (0x3f in nearly all nodes) */
  mask: number;
  /** node+0x12 (i16): link to another node or -1 */
  link: number;
  /** name from the name blob (upper case) */
  name: string;
}
export interface WaypointMatrix { w: number; h: number; hops: Int16Array }
export interface CompiledWaypoints {
  version: number;
  nodes: WaypointNode[];
  matrices: WaypointMatrix[];
  /** size in bytes of the name blob */
  nameBlobSize: number;
}

export function parseCompiledWaypoints(data: Uint8Array): CompiledWaypoints {
  const r = new Reader(data);
  if (r.i32() !== -1) throw new Error('bad magic (expected -1)');
  const version = r.i32();
  if (version !== 5) throw new Error(`unsupported version ${version}`);
  if (r.i32() !== 0) throw new Error('reserved field not 0');
  const nodeCount = r.i32(), edgeCount = r.i32();
  if (nodeCount < 0 || edgeCount < 0 || nodeCount > 100000 || edgeCount > 100000) throw new Error('implausible counts');
  const raw: Omit<WaypointNode, 'name'>[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const p = r.pos;
    const x = r.f32(), y = r.f32(), z = r.f32();
    const group = r.i16(), index = r.i16();
    const kind = r.u8(), mask = r.u8();
    const link = r.i16();
    r.skip(12); // runtime fields (zero in the file)
    if (r.pos - p !== 32) throw new Error('node size');
    raw.push({ x, y, z, group, index, kind, mask, link });
  }
  const dims: [number, number][] = [];
  for (let i = 0; i < edgeCount; i++) {
    const w = r.i32(), h = r.i32();
    r.skip(8); // runtime pointer + pad
    if (w < 0 || h < 0) throw new Error('negative matrix size');
    dims.push([w, h]);
  }
  const matrices: WaypointMatrix[] = dims.map(([w, h]) => {
    const hops = new Int16Array(w * h);
    for (let i = 0; i < w * h; i++) hops[i] = r.i16();
    return { w, h, hops };
  });
  const blobSize = r.u32();
  const offsets = r.u32s(nodeCount);
  const blob = r.bytes(blobSize);
  if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes`);
  const nodes: WaypointNode[] = raw.map((n, i) => {
    const o = offsets[i];
    if (o >= blobSize && blobSize > 0) throw new Error(`name offset ${o} out of blob`);
    let e = o; while (e < blobSize && blob[e] !== 0) e++;
    return { ...n, name: latin1(blob.subarray(o, e)) };
  });
  return { version, nodes, matrices, nameBlobSize: blobSize };
}

/**
 * Next node on the route from `a` to `b` (port of the lookup FUN_00448049 as documented by Moreno.LegoIsland2's
 * waypoints.gd and verified against the matrices: every (a,b) of the same group resolves to a valid node).
 */
export function nextHop(wp: CompiledWaypoints, a: number, b: number): number {
  const n = wp.nodes.length;
  if (a < 0 || b < 0 || a >= n || b >= n) return Math.min(Math.max(a, 0), n - 1);
  if (a === b) return a;
  let result = a;
  let target = b;
  if (wp.nodes[b].group < 0) { result = b; target = wp.nodes[b].index; if (a === target) return result; }
  const na = wp.nodes[a];
  if (na.group < 0) return na.index;
  const m = wp.matrices[na.group];
  if (!m || m.w <= 0 || m.h <= 0) return result;
  const nt = wp.nodes[target];
  const column = na.group === nt.group ? nt.index : nt.group + m.h;
  const cell = na.index * m.w + column;
  if (cell < 0 || cell >= m.hops.length) return result;
  return m.hops[cell];
}

// ----------------------------------------------------------------------------- editor `WPTP` files

export interface EditorWaypoint {
  /** editor coordinates (x is mirrored relative to the compiled file) */
  x: number; y: number; z: number;
  /** +12 u32: class 0..9 (meaning unknown, 0 for most nodes) */
  cls: number;
  /** +16 u32: 0x3f normally; 0x00ffff00 / 0x00ffff01 / 0xffffffff on some nodes */
  flags: number;
  /** +20 u32: always 0 */
  reserved: number;
  name: string;
}
export interface EditorWaypoints {
  nodes: EditorWaypoint[];
  /** WPTL: links (a, b, length) */
  links: { a: number; b: number; length: number }[];
  /** WPTG: (value, id) pairs, 8 bytes each */
  groups: { value: number; id: number }[];
}

export function parseEditorWaypoints(data: Uint8Array): EditorWaypoints {
  const r = new Reader(data);
  r.expectTag('WPTP');
  const n = r.u32();
  const nodes: EditorWaypoint[] = [];
  for (let i = 0; i < n; i++) {
    const x = r.f32(), y = r.f32(), z = r.f32();
    const cls = r.u32(), flags = r.u32(), reserved = r.u32();
    const name = r.cstr(16);
    nodes.push({ x, y, z, cls, flags, reserved, name });
  }
  r.expectTag('WPTL');
  const m = r.u32();
  const links: EditorWaypoints['links'] = [];
  for (let i = 0; i < m; i++) { const a = r.u32(), b = r.u32(), length = r.f32(); links.push({ a, b, length }); }
  r.expectTag('WPTG');
  const g = r.u32();
  const groups: EditorWaypoints['groups'] = [];
  for (let i = 0; i < g; i++) { const value = r.f32(), id = r.u32(); groups.push({ value, id }); }
  if (r.remaining !== 0) throw new Error(`${r.remaining} trailing bytes`);
  return { nodes, links, groups };
}

// ----------------------------------------------------------------------------- `.h` name enums and `.wbt`

/** Parse an `aW_<MAP>_.h` waypoint name header: `WPT_<MAP>_<NAME> = <index>,` entries inside `enum { ... };`. */
export function parseWaypointHeader(text: string): { guard: string; entries: { name: string; map: string; short: string; index: number }[] } {
  const guard = /#ifndef\s+(\w+)/.exec(text)?.[1] ?? '';
  const entries: { name: string; map: string; short: string; index: number }[] = [];
  const re = /^\s*(WPT_([A-Z0-9]+)_(\w+))\s*=\s*(\d+)\s*,?\s*$/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) entries.push({ name: m[1], map: m[2], short: m[3], index: parseInt(m[4], 10) });
  return { guard, entries };
}

export interface WbtLine { kind: 'main' | 'merge'; layer: number; file: string; as?: string; commented: boolean; line: number }
/** Parse a `.wbt` waypoint build list: `Main|Merge <layer> <file.way> [as <name>]`, `//` comments (kept with commented=true). */
export function parseWbt(text: string): WbtLine[] {
  const out: WbtLine[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    let t = raw.trim();
    if (t === '') return;
    let commented = false;
    if (t.startsWith('//')) { commented = true; t = t.slice(2).trim(); }
    const m = /^(main|merge)\s+(\d+)\s+(\S+)(?:\s+as\s+(\S+))?/i.exec(t);
    if (!m) { if (!commented) throw new Error(`wbt line ${i + 1}: unparsable "${raw}"`); return; }
    out.push({ kind: m[1].toLowerCase() as 'main' | 'merge', layer: parseInt(m[2], 10), file: m[3], as: m[4], commented, line: i + 1 });
  });
  return out;
}
