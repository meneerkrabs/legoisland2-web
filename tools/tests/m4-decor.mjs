import { loadIsland } from '../lib/island-load.mjs';
import { DecorState, decorModel, decorStore } from '../../src/island/decor.ts';
import { readDecorSetGroups, applyDecorEra } from '../../src/island/decorsets.ts';
import { readDecorTables, defaultDecor, decorGroupOfZone } from '../../src/shell/tables.ts';
import { createGameCpu } from '../../src/formats/x86emu.ts';

// WP-ISLAND (gaps S2): the type-1 decor / outfit swap: FUN_00420bb7 (start), FUN_00420dc4 (per tick), FUN_00421bbe (apply the stored decor) against the ORIGINAL code on the x86
// emulator: records with models / collision boxes, the sets' entries resolved to fake model / collision pointers, a script of Enters and Pepper's movements; after every tick the
// records' variant word, model pointer, collision pointer, matrix, attachments (slot, bone, child, animation matrix) and the 8 swap slots are compared.
// Run: node tools/test-formats.mjs --only m4-decor -v

const f32 = Math.fround;
export default {
  name: 'm4-decor',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const I = loadIsland(ctx, { node: 2 });
    const pe = I.pe;
    const bits = (x) => new Uint32Array(new Float32Array([x]).buffer)[0];
    const fl = (u) => new Float32Array(new Uint32Array([u >>> 0]).buffer)[0];

    // ---- the set-up shared by both sides
    const era = readDecorSetGroups(pe);
    applyDecorEra(pe, era, (v) => (v === 0x58 ? 0x50 : v === 0x49 || v === 0x90 || v === 0xb9 || v === 0x8f ? 1 : 0), false);
    const t = readDecorTables(pe), grp = t.groups[decorGroupOfZone(2)];
    const decorRecs = []; for (let i = grp.first; i < grp.first + grp.count; i++) decorRecs.push(t.entries[i].record);
    const NREC = 420;
    let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    // fake geometry: per record a model (unique key), a collision box, a matrix and position
    const recs = [];
    for (let i = 0; i < NREC; i++) recs.push({ i, model: { key: 'R' + i, parts: [], attach: [] }, col: { col: { center: [rnd() * 2 - 1, rnd() * 3, rnd() * 2 - 1], halfExtents: [1 + rnd() * 3, 1 + rnd(), 1 + rnd() * 3] } }, x: rnd() * 60, y: rnd() * 5, z: rnd() * 60, ry: rnd() * 6 });

    // ---- the emulator
    const cpu = createGameCpu(pe), mem = cpu.mem;
    const RB = 0x10000000, HEAP = 0x20000000;
    mem.addRegion({ lo: RB, hi: RB + NREC * 0x68 + 0x1000, name: 'records' });
    mem.addRegion({ lo: HEAP, hi: HEAP + 0x400000, name: 'heap' });
    cpu.exec = [[0x420bb7, 0x421b18], [0x43e900, 0x43eb00], [0x43a700, 0x43ac80], [0x442570, 0x4425c0], [0x858d30, 0x873e00]];
    cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
    cpu.hooks.set(0x85abc0, () => {});
    const sounds = [];
    cpu.hooks.set(0x4435a0, (c) => { sounds.push(c.arg(0)); });
    mem.w32(0x983804, RB);
    // pointers: record models / collision objects / extra models / extra col
    const modelPtr = new Map(), ptrModel = new Map(), colPtr = new Map(), ptrCol = new Map();
    let heap = HEAP;
    const alloc = (n) => { const a = heap; heap += (n + 15) & ~15; return a; };
    const mkModel = (obj) => { const p = alloc(0x20); const arr = alloc(0xa0); mem.w32(p + 0xc, arr); modelPtr.set(obj, p); ptrModel.set(p, obj); return p; };
    const mkCol = (obj) => {
      const p = alloc(0x40); const c = obj.col;
      [0, 1, 2].forEach((k) => { mem.w32(p + 0xc + k * 4, bits(c.center[k])); mem.w32(p + 0x18 + k * 4, bits(c.halfExtents[k])); });
      colPtr.set(obj, p); ptrCol.set(p, obj); return p;
    };
    const setMatrix = (base, rec) => {
      // the record's matrix = a rotation about y, translation (x, y, z): the port keeps the same numbers
      const cy = f32(Math.cos(rec.ry)), sy = f32(Math.sin(rec.ry));
      const m = new Float32Array(16); m[0] = cy; m[2] = -sy; m[5] = 1; m[8] = sy; m[10] = cy; m[12] = f32(rec.x); m[13] = f32(rec.y); m[14] = f32(rec.z); m[15] = 1;
      for (let k = 0; k < 16; k++) mem.w32(base + 0xc + k * 4, bits(m[k]));
      mem.w32(base + 0x3c, bits(m[12])); mem.w32(base + 0x40, bits(m[13])); mem.w32(base + 0x44, bits(m[14]));
      return m;
    };
    for (const r of recs) {
      const b = RB + r.i * 0x68;
      mem.w32(b + 4, mkModel(r.model)); mem.w32(b + 0x58, mkCol(r.col)); mem.w32(b + 0x64, 0);
      r.m = setMatrix(b, r);
    }
    // the sets' entries, resolved like FUN_00420837 (+8 model, +0xc collision, +0x10 / +0x14 second model + bone)
    const extra = new Map();   // "g/i" -> model
    const xm = (g, i) => { const k = g + '/' + i; if (!extra.has(k)) { const o = { key: 'X' + k, parts: [], attach: [] }; extra.set(k, o); mkModel(o); } return extra.get(k); };
    const r32 = (a) => mem.u32(a) | 0;
    const nsets = readDecorSetGroups(pe).length - 1;
    for (let s = 0; s < nsets; s++) {
      const rowb = 0x8acb98 + s * 0x18, ent = r32(rowb + 4), n = r32(0x8accd0 + s * 0x14 + 16), list = r32(rowb + 0x14);
      for (let k = 0; k < n; k++) {
        const e = ent + k * 0x18, g = r32(e), idx = r32(e + 4);
        if (g === -1) { mem.w32(e + 8, modelPtr.get(recs[idx].model)); mem.w32(e + 0xc, colPtr.get(recs[idx].col)); }
        else {
          mem.w32(e + 8, modelPtr.get(xm(g, idx)));
          if (list) for (let j = 0; r32(list + j * 12) !== -1; j++) if (r32(list + j * 12) === idx) { mem.w32(e + 0x10, modelPtr.get(xm(g, r32(list + j * 12 + 4)))); mem.w32(e + 0x14, r32(list + j * 12 + 8)); }
        }
      }
    }
    // the era counts the original reads (+0 of every set)
    for (let s = 0; s < nsets; s++) mem.w32(0x8acb98 + s * 0x18, era[s]);
    for (let i = 0; i < 8; i++) { mem.w32(0x9da350 + i * 0x48, 0xffffffff); mem.w32(0x9da354 + i * 0x48, 0xffffffff); }
    // Pepper: the record after the decor ones
    const pep = { i: 400, model: { key: 'P', parts: [], attach: [] }, col: { col: { center: [0, 4, 0], halfExtents: [1.5, 4, 1.5] } }, x: 0, y: 0, z: 0, ry: 0 };
    recs[400] = pep; { const b = RB + 400 * 0x68; mem.w32(b + 4, mkModel(pep.model)); mem.w32(b + 0x58, mkCol(pep.col)); pep.m = setMatrix(b, pep); }

    // ---- the port side
    const W = I.world;
    const portRecs = recs.map((r) => ({ index: r.i, model: r.model, colObj: r.col, m: Float32Array.from(r.m), x: r.x, y: r.y, z: r.z, variant: 0 }));
    const attach = new Map(), local = new Map();   // MODEL object -> Map(slot -> {child, bone}) / Map(slot -> matrix) (the original keeps the attachments in the model's array: records that share a model share them)
    const am = (map, rec) => { let m = map.get(rec); if (!m) map.set(rec, (m = new Map())); return m; };
    const host = {
      records: portRecs,
      model: (g, i) => xm(g, i),
      sfx: (id) => sounds.push('port' + id),
      setModel: (rec, m) => { rec.model = m; },
      setAttach: (rec, slot, bone, child) => { if (child) am(attach, rec.model).set(slot, { child, bone }); else am(attach, rec.model).delete(slot); },
      attachLocal: (rec, slot, m) => { if (m) am(local, rec.model).set(slot, m); else am(local, rec.model).delete(slot); },
      shiny: () => {},
    };
    const st = new DecorState(pe, host, era);
    st.resolve();
    // the stored decor: the defaults; the original's FUN_00421bbe on the emulator (it is not run natively here: apply by the same rule on both sides)
    const blob = defaultDecor(pe);
    st.applyStored(pe, decorGroupOfZone(2), blob);
    // mirror the applied state into the emulator memory (variant word, model, collision, attachments) by the original's FUN_00421bbe rules
    // the ORIGINAL FUN_00421bbe(-1) on the same stored decor (the zone is the island: var 0x59 = 2)
    cpu.exec.push([0x421b18, 0x421fa0]);
    cpu.hooks.set(0x417575, (c) => { c.eax = c.arg(0) === 0x59 ? 2 : 0; });
    for (let i = 0; i < blob.length; i++) mem.w8(0x9d9fd0 + i, blob[i]);
    cpu.call(0x421bbe, [0xffffffff]);

    // ---- the script
    const cmp = (label) => {
      let bad = 0;
      for (const ri of decorRecs) {
        const p = portRecs[ri], b = RB + ri * 0x68;
        if ((mem.u32(b + 0x64) | 0) !== (p.variant | 0)) { bad++; failures.push(`${label}: record ${ri} variant ${mem.u32(b + 0x64).toString(16)} / ${p.variant.toString(16)}`); }
        if (ptrModel.get(mem.u32(b + 4)) !== p.model) { bad++; failures.push(`${label}: record ${ri} model ${ptrModel.get(mem.u32(b + 4))?.key} / ${p.model?.key}`); }
        const cp = mem.u32(b + 0x58);
        if ((cp === 0xbabababa ? null : ptrCol.get(cp)) !== p.colObj) { bad++; failures.push(`${label}: record ${ri} collision`); }
        for (let k = 0; k < 16; k++) if (bits(p.m[k]) !== mem.u32(b + 0xc + k * 4) && Math.abs(fl(mem.u32(b + 0xc + k * 4)) - p.m[k]) > 1e-5 * (1 + Math.abs(p.m[k]))) { bad++; failures.push(`${label}: record ${ri} matrix[${k}] ${fl(mem.u32(b + 0xc + k * 4))} / ${p.m[k]}`); break; }
        const arr = mem.u32(modelPtr.get(ptrModel.get(mem.u32(b + 4))) ?? 0) ;
        const marr = mem.u32(mem.u32(b + 4) + 0xc);
        const a = attach.get(p.model) ?? new Map(), l = local.get(p.model) ?? new Map();
        for (let slot = 0; slot < 10; slot++) {
          const on = mem.u32(marr + slot * 16) !== 0, v = a.get(slot);
          if (on !== !!v) { bad++; failures.push(`${label}: record ${ri} attachment ${slot} ${on} / ${!!v}`); continue; }
          if (!on) continue;
          if (ptrModel.get(mem.u32(marr + slot * 16 + 8)) !== v.child || (mem.u32(marr + slot * 16 + 4) | 0) !== v.bone) { bad++; failures.push(`${label}: record ${ri} attachment ${slot} child / bone`); }
          const mp = mem.u32(marr + slot * 16 + 12), lm = l.get(slot);
          if ((mp === 0) !== !lm) { bad++; failures.push(`${label}: record ${ri} attachment ${slot} matrix pointer ${mp.toString(16)} / ${!!lm}`); }
          else if (mp !== 0) for (let k = 0; k < 16; k++) if (Math.abs(fl(mem.u32(mp + k * 4)) - lm[k]) > 1e-5) { bad++; failures.push(`${label}: record ${ri} attachment ${slot} matrix[${k}] ${fl(mem.u32(mp + k * 4))} / ${lm[k]}`); break; }
        }
        void arr;
      }
      for (let s = 0; s < 8; s++) {
        if ((mem.u32(0x9da350 + s * 0x48) | 0) !== st.cnt[s] || (mem.u32(0x9da354 + s * 0x48) | 0) !== st.rec[s]) { bad++; failures.push(`${label}: slot ${s} ${mem.u32(0x9da350 + s * 0x48) | 0}/${mem.u32(0x9da354 + s * 0x48) | 0} vs ${st.cnt[s]}/${st.rec[s]}`); }
      }
      return bad;
    };
    ok(cmp('start') === 0, 'the applied stored decor is identical (variant words, models, collision, attachments)');
    let ticks = 0, enters = 0, bad = 0;
    const pepperAt = (x, z) => { pep.x = x; pep.z = z; pep.m = setMatrix(RB + 400 * 0x68, pep); portRecs[400].m = Float32Array.from(pep.m); portRecs[400].x = pep.x; portRecs[400].y = pep.y; portRecs[400].z = pep.z; };
    for (let step = 0; step < 900 && bad === 0; step++) {
      const r = rnd();
      if (r < 0.12) {
        // Enter next to a random decor record (also while it runs; with 8+ running the oldest slot is taken over)
        const ri = decorRecs[Math.floor(rnd() * decorRecs.length)];
        if (((portRecs[ri].variant & 0xff) === 1)) { cpu.call(0x420bb7, [ri]); st.enter(ri); enters++; }
        bad += cmp('enter ' + ri) ? 1 : 0;
      }
      if (rnd() < 0.3) { const q = decorRecs[Math.floor(rnd() * decorRecs.length)]; pepperAt(recs[q].x + rnd() * 3 - 1.5, recs[q].z + rnd() * 3 - 1.5); }
      cpu.call(0x420dc4, [0, RB + 400 * 0x68]);
      st.tick(portRecs[400]);
      ticks++;
      bad += cmp('tick ' + step) ? 1 : 0;
    }
    ok(bad === 0 && enters > 30, `FUN_00420bb7 / FUN_00420dc4: ${enters} Enters and ${ticks} ticks identical to the original (records, models, collision, attachments, slots)`);
    ok(sounds.filter((s) => typeof s === 'number').length === sounds.filter((s) => typeof s === 'string').length, 'the swap sound is played once per Enter on both sides');
    // ---- WP-SAVE (F3): the loader's apply. A random stored decor (valid sets, variants around the set's count so that the `count < variant` fall-back happens) goes into the global
    // DAT_009d9fd0 (what FUN_00421f7b does) and FUN_00421bbe(-1) applies it natively; the port's `applyStored` on a copy must leave the same records (variant words, models, collision
    // objects, attachments), the same 8 swap slots and the same (clamped) stored decor.
    {
      let sb = 0, n = 0, clamped = 0;
      const nsetsB = nsets;
      for (let k = 0; k < 80 && sb === 0; k++) {
        const b = new Uint8Array(0x380);
        // (an entry keeps the KIND of its default set: a set with slot -1 swaps the record's model for a template's (shared by records), the others attach to the record's own model; Enter never changes the set)
        const kindOf = (set) => st.rows[set].slot === -1;
        for (let i = 0; i < 0x1c0; i++) { let set; do { set = Math.floor(rnd() * nsetsB); } while (kindOf(set) !== kindOf(t.entries[i].set)); b[i * 2] = set;
          const off = [-3, -2, -1, 1, 2][Math.floor(rnd() * 5)]; b[i * 2 + 1] = Math.max(0, Math.min(255, era[set] + off)); }   // (not `count` itself: the original's `count < variant` lets it through and reads one entry past the set)
        for (let i = 0; i < b.length; i++) mem.w8(0x9d9fd0 + i, b[i]);
        cpu.call(0x421bbe, [0xffffffff]);
        const pb = Uint8Array.from(b);
        st.applyStored(pe, decorGroupOfZone(2), pb);
        sb += cmp('blob ' + k);
        const nat = mem.read(0x9d9fd0, 0x380);
        if (nat.some((x, i) => x !== pb[i])) { sb++; failures.push(`blob ${k}: the clamped stored decor differs from the original's global`); }
        if (b.some((x, i) => x !== pb[i])) clamped++;
        n++;
      }
      ok(sb === 0 && clamped > 20, `FUN_00421bbe(-1) on ${n} random stored decors (${clamped} with the variant fall-back): records, models, attachments and the stored decor identical to the original`);
      notes.push(`decor blob apply: ${n} random stored decors compared with FUN_00421bbe(-1) natively`);
    }
    notes.push(`decor swap: ${enters} Enters, ${ticks} ticks compared with the original`);
    void W; void decorModel; void decorStore;
    return { checked, failures: failures.slice(0, 30), notes };
  },
};
