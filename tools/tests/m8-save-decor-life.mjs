// WP-DECOR: the LIFE CYCLE of the stored decor (DAT_009d9fd0 / flag DAT_008adbf0) over random sequences of the events a game goes through, the ORIGINAL's code run natively
// (tools/lib/m7-shell-save-emu.mjs) against the port's decorStore:
//   new game        FUN_00421fa0(1)                    <-> resetDecor            (the shell's menu context)
//   zone start      FUN_00420837's `if (DAT_008adbf0) { copy the defaults; flag = 0 }` + FUN_00421bbe(-1)  <-> ensureDefaults + applyDecorToRecords   (the copy is written out in the test)
//   save            FUN_00421f56                        <-> captureDecor
//   load            FUN_00421f7b + FUN_00421bbe(-1)     <-> applyDecor
// Sequences start the way a game can be entered in the original: a new game or a load (never a bare process: its zeros are not observable). Everything the original stores / writes must be equal.
// Then the PORT-ONLY guarantees: (1) a process that was entered any other way (?zone=, ?save=, dev corner: `startProcess` only) never writes a zero decor section; (2) a decor section with an all-zero
// group (what older builds of the port wrote, turning every NPC into the pine tree) is repaired to the defaults of that group on load (`repairDecorBlob`), a section the original could have written is not touched.
import { loadExe } from '../lib/engine-load.mjs';
import { SaveEmu, makeRng, A, RECORDS_BASE, REC } from '../lib/m7-shell-save-emu.mjs';
import { decorStore, DecorState, captureDecor, applyDecor, resetDecor, applyDecorToRecords, repairDecorBlob } from '../../src/island/decor.ts';
import { readDecorTables, defaultDecor } from '../../src/shell/tables.ts';

const NREC = 600;
const DECOR_ZONES = [2, 0x1f, 0x20, 0x21, 6, 0xb, 0xd, 0x13, 0x1b];
const OTHER_ZONES = [1, 3, 4, 5, 7, 8, 9, 10, 0xc, 0x22];
const FLAG = 0x8adbf0;

export default {
  name: 'm8-save-decor-life',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c && failures.length < 40) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    const E = new SaveEmu(pe), mem = E.mem;
    E.cpu.exec.push([0x421fa0, 0x422070]);
    const t = readDecorTables(pe), defaults = defaultDecor(pe);
    const nsets = (() => { let n = 0; while ((pe.u32(0x8acb98 + n * 0x18) | 0) !== -1) n++; return n; })();
    const counts = Array.from({ length: nsets }, (_, s) => pe.u32(0x8acb98 + s * 0x18) | 0);
    for (let s = 0; s < nsets; s++) mem.w32(0x8acb98 + s * 0x18, counts[s]);
    mem.w32(A.RECN, NREC); mem.w32(A.RECP, RECORDS_BASE);
    const vars = new Int32Array(319);
    const records = Array.from({ length: NREC }, (_, i) => ({ index: i, variant: 0 }));
    const world = { vars: { get: (i) => vars[i] }, records, ext: new Map() };
    const host = { records, model: () => null, sfx() {}, setModel() {}, setAttach() {}, attachLocal() {}, shiny() {} };
    world.ext.set('island.decor', new DecorState(pe, host, counts));
    const setSubgame = (v) => { vars[0x59] = v; mem.w32(A.VARS + 4 * 0x59, v); };
    const setVariant = (i, v) => { records[i].variant = v >>> 0; mem.w32(RECORDS_BASE + i * REC + 0x64, v >>> 0); };
    const nativeBlob = () => mem.read(A.DECOR, 0x380);
    const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const buf = E.alloc(0x400);
    const rng = makeRng(0x11fec1e);
    const randBlob = () => {
      const b = new Uint8Array(0x380);
      for (let i = 0; i < 0x1c0; i++) { const set = rng.int(nsets); b[i * 2] = set; b[i * 2 + 1] = rng.int(Math.max(1, counts[set])); }
      return b;
    };
    const compareRecords = (label) => {
      for (let i = 0; i < NREC; i++) if (mem.u32(RECORDS_BASE + i * REC + 0x64) !== records[i].variant >>> 0) { ok(false, `${label}: record ${i} variant differs`); return; }
      checked++;
    };
    const flag = () => mem.read(FLAG, 1)[0];
    const nativeEnsure = () => {   // FUN_00420837's once-per-process copy
      if (flag()) { mem.write(A.DECOR, defaults); mem.write(FLAG, Uint8Array.of(0)); }
    };
    const randRecords = () => { for (let i = 0; i < NREC; i++) { const set = rng.int(nsets); setVariant(i, (set << 8 | 1 | rng.int(Math.max(1, counts[set])) << 16) >>> 0); } };   // (valid words only: the records of a running game never hold others, and the next save would store them)

    let seqs = 0, events = 0, saves = 0;
    for (let k = 0; k < 120; k++) {
      // a game enters through a new game or a load: the stored decor is the defaults / the file's bytes, the flag is still set (a fresh process)
      mem.write(FLAG, Uint8Array.of(1)); decorStore.pending = true; decorStore.mem.fill(0); mem.write(A.DECOR, new Uint8Array(0x380));
      const label = `sequence ${k}`;
      setSubgame(rng.chance(0.7) ? DECOR_ZONES[rng.int(DECOR_ZONES.length)] : OTHER_ZONES[rng.int(OTHER_ZONES.length)]); randRecords();
      const first = rng.chance(0.5);
      if (first) { E.cpu.call(0x421fa0, [1]); resetDecor(world, pe); }
      else { const b = randBlob(), src = E.alloc(0x400); mem.write(src, b); E.cpu.call(0x421f7b, [src, 0x380]); decorStore.loadRaw(b); }
      ok(eq(nativeBlob(), decorStore.mem), `${label}: entry`);
      seqs++;
      const n = 6 + rng.int(10);
      for (let e = 0; e < n; e++) {
        const kind = rng.int(5);
        events++;
        if (kind === 0) { E.cpu.call(0x421fa0, [1]); resetDecor(world, pe) ; compareRecords(`${label} new game`); }
        else if (kind === 1) {   // a zone starts (a decor zone applies the stored decor, other zones only run the pending copy)
          const sg = rng.chance(0.7) ? DECOR_ZONES[rng.int(DECOR_ZONES.length)] : OTHER_ZONES[rng.int(OTHER_ZONES.length)];
          setSubgame(sg); randRecords();
          nativeEnsure(); decorStore.ensureDefaults(pe);
          E.cpu.call(0x421bbe, [0xffffffff]); applyDecorToRecords(world, pe, -1);
          compareRecords(`${label} zone ${sg}`);
        } else if (kind === 2) {   // a save
          setSubgame(rng.chance(0.7) ? DECOR_ZONES[rng.int(DECOR_ZONES.length)] : OTHER_ZONES[rng.int(OTHER_ZONES.length)]);
          E.cpu.call(0x421f56, [buf]);
          const mine = captureDecor(world);
          ok(eq(mem.read(buf, 0x380), mine), `${label}: the save's decor section`);
          saves++;
        } else if (kind === 3) {   // a load (the file's section, then the menu's FUN_00421bbe(-1))
          const b = randBlob(), src = E.alloc(0x400); mem.write(src, b);
          E.cpu.call(0x421f7b, [src, 0x380]); E.cpu.call(0x421bbe, [0xffffffff]);
          applyDecor(world, b);
          compareRecords(`${label} load`);
        } else {   // change a record the way a swap does (the records are what the next save reads back)
          const sg = DECOR_ZONES[rng.int(DECOR_ZONES.length)]; setSubgame(sg); randRecords();
        }
        ok(eq(nativeBlob(), decorStore.mem), `${label} event ${e} (${kind}): the stored decor differs from the original's`);
        ok(decorStore.pending === !!flag(), `${label} event ${e} (${kind}): the pending flag differs`);
      }
    }

    // ---- port only 1: a process entered without a new game or a load (?zone=, ?save=, dev corner) never saves zeros
    for (const sg of [...DECOR_ZONES, ...OTHER_ZONES]) {
      decorStore.startProcess(pe);
      setSubgame(sg);
      for (let i = 0; i < NREC; i++) records[i].variant = 0;
      const blob = captureDecor(world);
      ok(eq(blob, defaults) || DECOR_ZONES.includes(sg), `startProcess, subgame ${sg}: the save holds zeros / not the defaults`);
      ok(decorStore.pending, 'startProcess leaves the one-time copy pending');
    }
    // ... and after the first zone set-up of such a process (the real entry of a decor zone)
    decorStore.startProcess(pe); setSubgame(2); decorStore.ensureDefaults(pe);
    ok(eq(decorStore.mem, defaults) && !decorStore.pending, 'startProcess + the pending copy = the defaults');

    // ---- port only 2: the all-zero group repair
    {
      const zero = new Uint8Array(0x380);
      const n = repairDecorBlob(zero, pe);
      const groupsWithDefaults = t.groups.filter((g) => { for (let i = g.first; i < g.first + g.count; i++) if (defaults[i * 2] | defaults[i * 2 + 1]) return true; return false; }).length;
      ok(n === groupsWithDefaults && eq(zero.subarray(0, t.groups.reduce((m, g) => Math.max(m, (g.first + g.count) * 2), 0)), defaults.subarray(0, t.groups.reduce((m, g) => Math.max(m, (g.first + g.count) * 2), 0))), `an all-zero section: repaired ${n} groups of ${groupsWithDefaults}`);
      // one group changed by the player, another all zero (written by an old build): only the zero one is replaced
      const b = randBlob(); const g0 = t.groups[0], g1 = t.groups[1];
      for (let i = g1.first; i < g1.first + g1.count; i++) { b[i * 2] = 0; b[i * 2 + 1] = 0; }
      const keep = b.slice();
      ok(repairDecorBlob(b, pe) === 1, 'one zero group repaired');
      ok(eq(b.subarray(g0.first * 2, (g0.first + g0.count) * 2), keep.subarray(g0.first * 2, (g0.first + g0.count) * 2)), 'a group the player changed is untouched');
      ok(eq(b.subarray(g1.first * 2, (g1.first + g1.count) * 2), defaults.subarray(g1.first * 2, (g1.first + g1.count) * 2)), 'the zero group is the defaults');
      // the defaults themselves and a normal blob are never changed
      const d2 = defaults.slice(); ok(repairDecorBlob(d2, pe) === 0 && eq(d2, defaults), 'the defaults are not touched');
      // through the loader: a zero section in a running game gives the defaults, not the pine tree (set 0 variant 0)
      decorStore.pe = pe; decorStore.startProcess(pe); decorStore.ensureDefaults(pe);
      setSubgame(2); randRecords();
      const origWarn = console.warn; console.warn = () => {};
      try { applyDecor(world, new Uint8Array(0x380)); } finally { console.warn = origWarn; }
      ok(eq(decorStore.mem.subarray(0, t.groups[0].count * 2 + t.groups[0].first * 2), defaults.subarray(0, t.groups[0].count * 2 + t.groups[0].first * 2)), 'loading a zero section gives the defaults');
      for (const g of t.groups.slice(0, 1)) for (let i = g.first; i < g.first + g.count; i++) if (defaults[i * 2] | defaults[i * 2 + 1]) { ok(records[t.entries[i].record].variant !== (1 | 0), 'the record is not set 0 variant 0'); break; }
    }
    decorStore.pe = null;
    decorStore.blob = null;
    notes.push(`${seqs} sequences / ${events} events (new game, zone start, save, load) compared to the original natively (stored decor, flag, section bytes, variant words), ${saves} saves; the port-only start / repair guarantees`);
    return { checked, failures, notes };
  },
};
