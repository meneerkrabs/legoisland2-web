// WP-SAVE (F3): the decor blob of the save game against the ORIGINAL's code run natively in the x86 emulator (tools/lib/m7-shell-save-emu.mjs hosts the save code):
//   FUN_00421f56 (writer: FUN_00421eb3 refreshes the CURRENT decor group from the live records, then 0x380 bytes of DAT_009d9fd0 are copied out)  <->  captureDecor
//   FUN_00421f7b (loader: copy when the size is 0x380)                                                                                           <->  applyDecor (copy part)
//   FUN_00421bbe(-1) (the stored decor applied to the records of the current group; the menu's load calls it after the load)                     <->  applyDecor / applyDecorToRecords
//   FUN_00421fa0(1) (a new game: every entry back to the defaults, then FUN_00421bbe)                                                              <->  resetDecor
//   FUN_00420837's `if (DAT_008adbf0)` (the defaults are copied ONCE per process)                                                                  <->  decorStore.blob getter / setter
// Many random states: the subgame (var 0x59: every decor zone and non-decor ones), the variant words of ALL records, the stored decor before the call. The compared bytes are the writer's
// 0x380 output, the stored decor afterwards (global DAT_009d9fd0 vs `decorStore.mem`) and the variant word (+0x64) of every record afterwards.
import { loadExe } from '../lib/engine-load.mjs';
import { SaveEmu, makeRng, A, RECORDS_BASE, REC } from '../lib/m7-shell-save-emu.mjs';
import { decorStore, DecorState, captureDecor, applyDecor, resetDecor, applyDecorToRecords } from '../../src/island/decor.ts';
import { readDecorTables, defaultDecor, decorGroupOfZone } from '../../src/shell/tables.ts';

const NREC = 600;
const SUBGAMES = [2, 0x1f, 0x20, 0x21, 6, 0xb, 0xd, 0x13, 0x1b, 1, 3, 4, 5, 7, 8, 9, 10, 0xc, 0x22, 0x28];

export default {
  name: 'm8-save-decor',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 40) failures.push(m); };
    const ok = (c, m) => { checked++; if (!c) bad(m); };
    const pe = loadExe(ctx.dataRoot);
    const E = new SaveEmu(pe);
    const mem = E.mem;
    E.cpu.exec.push([0x421fa0, 0x422070]);
    const t = readDecorTables(pe);
    const defaults = defaultDecor(pe);
    const nsets = (() => { let n = 0; while ((pe.u32(0x8acb98 + n * 0x18) | 0) !== -1) n++; return n; })();
    const counts = Array.from({ length: nsets }, (_, s) => pe.u32(0x8acb98 + s * 0x18) | 0);
    // the zone's decor sets state of the original: the count of every set (+0), read by FUN_00421bbe's `count < variant` test; the port's DecorState gets the same numbers
    for (let s = 0; s < nsets; s++) mem.w32(0x8acb98 + s * 0x18, counts[s]);

    // ---- the two worlds (the original's memory, a world stub for the port)
    mem.w32(A.RECN, NREC); mem.w32(A.RECP, RECORDS_BASE);
    const vars = new Int32Array(319);
    const records = Array.from({ length: NREC }, (_, i) => ({ index: i, variant: 0 }));
    const world = { vars: { get: (i) => vars[i] }, records, ext: new Map() };
    const host = { records, model: () => null, sfx() {}, setModel() {}, setAttach() {}, attachLocal() {}, shiny() {} };
    const state = new DecorState(pe, host, counts);
    world.ext.set('island.decor', state);
    const setSubgame = (v) => { vars[0x59] = v; mem.w32(A.VARS + 4 * 0x59, v); };
    const setVariant = (i, v) => { records[i].variant = v >>> 0; mem.w32(RECORDS_BASE + i * REC + 0x64, v >>> 0); };
    const setStored = (b) => { decorStore.mem.set(b); mem.write(A.DECOR, b); };
    const nativeBlob = () => mem.read(A.DECOR, 0x380);
    const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const firstDiff = (a, b) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };
    const buf = E.alloc(0x400);

    const rng = makeRng(0x0decc0de);
    // random stored decor with VALID sets (the original reads the set tables with the byte: a set beyond them is garbage) and variants around the count (the clamp)
    const randBlob = (clampy) => {
      const b = new Uint8Array(0x380);
      for (let i = 0; i < 0x1c0; i++) {
        const set = rng.int(nsets);
        b[i * 2] = set;
        b[i * 2 + 1] = clampy ? Math.min(255, Math.max(0, counts[set] - 2 + rng.int(5))) : rng.int(Math.max(1, counts[set]));
      }
      return b;
    };
    const randVariant = () => (rng.chance(0.5) ? (rng.int(nsets) << 8 | 1 | rng.int(40) << 16) : rng.u32()) >>> 0;
    const compareRecords = (label) => {
      let n = 0;
      for (let i = 0; i < NREC; i++) {
        const o = mem.u32(RECORDS_BASE + i * REC + 0x64);
        if (o !== records[i].variant >>> 0) { n++; bad(`${label}: record ${i} variant original ${o.toString(16)} port ${records[i].variant.toString(16)}`); if (n > 3) break; }
      }
      checked++;
      return n;
    };

    let writes = 0, refreshed = 0, loads = 0, applies = 0, clamps = 0, resets = 0, bytes = 0;
    // ---- 1. the writer: FUN_00421f56 <-> captureDecor, every subgame, random records / stored decor
    for (let k = 0; k < 400; k++) {
      const sg = SUBGAMES[k % SUBGAMES.length];
      setSubgame(sg);
      for (let i = 0; i < NREC; i++) setVariant(i, randVariant());
      setStored(randBlob(rng.chance(0.3)));
      const ret = E.cpu.call(0x421f56, [buf]) >>> 0;
      const orig = mem.read(buf, 0x380);
      const mine = captureDecor(world);
      ok(ret === 0x380, `writer returned ${ret}`);
      const d = firstDiff(orig, mine);
      ok(d < 0 && mine.length === 0x380, `subgame ${sg} capture: byte ${d} original ${orig[d]} port ${mine[d]}`);
      ok(eq(nativeBlob(), decorStore.mem), `subgame ${sg}: the stored decor after the refresh differs from the global`);
      writes++; bytes += 0x380;
      if (decorGroupOfZone(sg) >= 0) refreshed++;
    }
    // ---- 2. the loader: FUN_00421f7b <-> the copy of applyDecor; wrong sizes are ignored by the original (the port is only ever given 0x380)
    for (let k = 0; k < 60; k++) {
      setSubgame(SUBGAMES[k % SUBGAMES.length]);
      const before = randBlob(false); setStored(before);
      const b = rng.bytes(0x380);
      const src = E.alloc(0x400); mem.write(src, b);
      E.cpu.call(0x421f7b, [src, 0x380]);
      decorStore.loadRaw(b);
      ok(eq(nativeBlob(), b) && eq(decorStore.mem, b), 'loader copy');
      const keep = randBlob(false); setStored(keep);
      E.cpu.call(0x421f7b, [src, 0x37f]);
      decorStore.loadRaw(b.subarray(0, 0x37f));
      ok(eq(nativeBlob(), keep) && eq(decorStore.mem, keep), 'loader with a size other than 0x380 copies nothing');
      loads++;
    }
    // ---- 3. FUN_00421bbe(-1) (the menu's call after a load) <-> applyDecor (state + variant words of the records, the clamp writes back into the blob)
    for (let k = 0; k < 300; k++) {
      const sg = SUBGAMES[k % SUBGAMES.length];
      setSubgame(sg);
      for (let i = 0; i < NREC; i++) setVariant(i, randVariant());
      const b = randBlob(k % 2 === 0);
      setStored(randBlob(false));
      const src = E.alloc(0x400); mem.write(src, b);
      E.cpu.call(0x421f7b, [src, 0x380]);
      E.cpu.call(0x421bbe, [0xffffffff]);
      applyDecor(world, b);
      const d = firstDiff(nativeBlob(), decorStore.mem);
      ok(d < 0, `apply -1, subgame ${sg}: stored decor differs at byte ${d} (original ${nativeBlob()[d]} port ${decorStore.mem[d]})`);
      if (compareRecords(`apply -1, subgame ${sg}`)) break;
      const g = decorGroupOfZone(sg);
      if (g >= 0) { applies++; const grp = t.groups[g]; for (let i = grp.first; i < grp.first + grp.count; i++) if (b[i * 2 + 1] !== decorStore.mem[i * 2 + 1]) { clamps++; break; } }
    }
    // the generic path (a zone without a DecorState: the variant words only) gives the same words
    world.ext.delete('island.decor'); world.ext.set('island.decorsets', { groups: counts });
    for (let k = 0; k < 100; k++) {
      const sg = SUBGAMES[k % SUBGAMES.length];
      setSubgame(sg);
      for (let i = 0; i < NREC; i++) setVariant(i, randVariant());
      const b = randBlob(true);
      setStored(randBlob(false));
      const src = E.alloc(0x400); mem.write(src, b);
      E.cpu.call(0x421f7b, [src, 0x380]);
      E.cpu.call(0x421bbe, [0xffffffff]);
      decorStore.loadRaw(b);
      applyDecorToRecords(world, pe, -1);
      ok(eq(nativeBlob(), decorStore.mem), `generic apply, subgame ${sg}: stored decor`);
      if (compareRecords(`generic apply, subgame ${sg}`)) break;
    }
    world.ext.delete('island.decorsets'); world.ext.set('island.decor', state);
    // ---- 4. FUN_00421fa0(1) (a new game) <-> resetDecor: every entry to the defaults, then FUN_00421bbe(current group)
    for (let k = 0; k < 60; k++) {
      const sg = SUBGAMES[k % SUBGAMES.length];
      setSubgame(sg);
      for (let i = 0; i < NREC; i++) setVariant(i, randVariant());
      setStored(randBlob(true));
      E.cpu.call(0x421fa0, [1]);
      resetDecor(world, pe);
      ok(eq(nativeBlob(), decorStore.mem) && eq(decorStore.mem, defaults), `reset, subgame ${sg}: the stored decor is not the exe's defaults`);
      if (compareRecords(`reset, subgame ${sg}`)) break;
      resets++;
    }
    // ---- 5. the life cycle of the default copy (DAT_008adbf0): pending until a zone's set-up copies the defaults; a load does not clear it
    decorStore.blob = null;
    ok(decorStore.blob === null && decorStore.pending && decorStore.mem.every((x) => x === 0), 'a fresh process: the stored decor is zeros and no zone has copied the defaults');
    decorStore.loadRaw(randBlob(false));
    ok(decorStore.blob === null && decorStore.pending, 'a load does not clear the flag (FUN_00421f7b leaves DAT_008adbf0): the zone set-up still copies the defaults over it');
    decorStore.blob = defaults;
    ok(decorStore.blob !== null && eq(decorStore.blob, defaults) && !decorStore.pending, 'FUN_00420837 copies the defaults once and clears the flag');
    decorStore.reset(pe); decorStore.mem[0] ^= 1;
    ok(decorStore.blob !== null && !eq(decorStore.blob, defaults), 'the getter hands out the live array (DecorState writes into the global)');
    decorStore.blob = defaults;

    notes.push(`writer ${writes} states (${refreshed} with a decor group current, ${bytes} bytes), loader ${loads} (+ wrong sizes), FUN_00421bbe(-1) ${applies} states in a decor zone (${clamps} with the variant clamp) + 100 generic, reset ${resets}; every one compared to the original natively (blob bytes, global, ${NREC} variant words)`);
    return { checked, failures, notes };
  },
};
