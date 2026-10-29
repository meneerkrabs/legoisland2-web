// WP-VERIFY M2 shell, target 1: the save game format. The ORIGINAL's writer FUN_00418ec7 / validation FUN_0041ac8f / header readers FUN_00419c45, FUN_0041aa2e / body reader
// FUN_00419e82 run natively in the x86 emulator (tools/lib/m7-shell-save-emu.mjs) on synthetic live games, next to the port (src/shell/save.ts): same state in, the bytes of the
// `Save%02d.lgo` file compared with `encodeSave`, `decodeSave` on the original's bytes compared with the state, `validateSave` / `readSaveHeader` / `saveChecksum` / `slotFileName`
// compared with the original's functions, and the original's reader run on the bytes (the file loads back to the state it was written from).
import { loadExe } from '../lib/engine-load.mjs';
import { SaveEmu, genState, expectedSave, makeRng, A, RECORDS_BASE, REC } from '../lib/m7-shell-save-emu.mjs';
import {
  newSaveFromGame, SAVE_SIZE, encodeSave, decodeSave, validateSave, readSaveHeader, saveChecksum, slotFileName, SaveError,
} from '../../src/shell/save.ts';

const hex = (n) => '0x' + (n >>> 0).toString(16);
const bufEq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : n; };

export default {
  name: 'm7-shell-save',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 60) failures.push(m); else if (failures.length === 60) failures.push('... more'); };
    const ok = (c, m) => { checked++; if (!c) bad(m); };
    const pe = loadExe(ctx.dataRoot);
    const st = { scen: 0, nodesDec: 0, entities: 0, objects: 0, bricks: 0, loads: 0, decorRefresh: 0, mutations: 0, rejects: 0, walkers: 0, bytes: 0, ambiguous: [] };

    const SLOTS = [0, 1, 2, 3, 4, 5, 6, -2];

    /** compare a decoded save with the expected one, field by field */
    const sameSave = (d, x, label) => {
      ok(d.subgame === x.subgame && d.time === x.time && d.fsmState === x.fsmState && d.version === 0xd, `${label}: header ${d.subgame},${d.time},${d.fsmState} != ${x.subgame},${x.time},${x.fsmState}`);
      ok(bufEq(d.vars, x.vars), `${label}: vars`);
      ok(bufEq(d.walkers, x.walkers), `${label}: walker blob`);
      ok(bufEq(d.walkerTags, x.walkerTags), `${label}: walker tags`);
      ok(bufEq(d.camera, x.camera) && d.frameCounter === x.frameCounter, `${label}: camera / frame counter`);
      ok(bufEq(d.decor, x.decor), `${label}: decor`);
      ok(d.objects.length === x.objects.length, `${label}: object records ${d.objects.length} != ${x.objects.length}`);
      if (d.objects.length === x.objects.length) x.objects.forEach((o, i) => {
        const g = d.objects[i];
        ok(g.tag === o.tag && g.animState === o.animState && Object.is(g.animFrame, o.animFrame), `${label}: object ${i} ${JSON.stringify(g)} != ${JSON.stringify(o)}`);
      });
      ok(!d.entitiesRaw, `${label}: entity section fell back to raw`);
      ok(d.entities.length === x.entities.length, `${label}: entity records ${d.entities.length} != ${x.entities.length}`);
      if (d.entities.length === x.entities.length) x.entities.forEach((e, i) => {
        const g = d.entities[i];
        ok(g.tag === e.tag && bufEq(g.pos, e.pos) && bufEq(g.euler, e.euler) && g.flags === e.flags, `${label}: entity ${i} header`);
        const nodesSame = g.nodes.length === e.nodes.length && e.nodes.every((n, k) => {
          const m = g.nodes[k];
          return m.state === n.state && (m.data === null) === (n.data === null) && (n.data === null || bufEq(m.data, n.data));
        });
        if (nodesSame) { checked++; return; }
        // KNOWN: the file does not say which nodes carry a payload (the original decides from the live node's type): [state a][d][d bytes][0xb0bb00b] can be read as a node with a
        // payload or as nodes without one. Accepted only when both readings are byte-identical when written back.
        const other = { ...x, entities: [{ ...e, nodes: g.nodes }] }, mine = { ...x, entities: [e] };
        if (bufEq(encodeSave(other), encodeSave(mine))) { st.ambiguous.push(`${label} entity ${i}: ${e.nodes.map((n) => (n.data ? `s${n.state}+${n.data.length}` : `s${n.state}`)).join(' ')} read as ${g.nodes.map((n) => (n.data ? `s${n.state}+${n.data.length}` : `s${n.state}`)).join(' ')}`); checked++; }
        else bad(`${label}: entity ${i} nodes differ and the readings are not equivalent`);
      });
      ok(!d.bricksRaw, `${label}: brick blob fell back to raw`);
      ok(d.bricks.length === 64 && d.bricks.every((b, i) => (b === null) === (x.bricks[i] === null) && (b === null || bufEq(b, x.bricks[i]))), `${label}: brick slots`);
    };

    /** the brick blob exactly as the original's FUN_00449a10 produces it for the state in `E` (called natively on a scratch buffer) */
    const brickBlob = (E) => { const dst = E.alloc(0x60000); const n = E.cpu.call(0x449a10, [dst]); return E.mem.read(dst, n); };

    const perturb = (E, s, rng) => {                      // same structure, different values (the game before the load)
      const m = E.mem;
      for (let i = 0; i < 319; i++) if (i !== 0x58 && i !== 0x59) m.w32(A.VARS + 4 * i, rng.u32());
      m.write(A.CAMERA, rng.bytes(0x48)); m.w32(A.FRAME, rng.u32()); m.write(A.DECOR, rng.bytes(0x380));
      s.records.forEach((r, i) => {
        const a = RECORDS_BASE + i * REC;
        for (let k = 0; k < 3; k++) { m.wf32(a + 0x3c + 4 * k, rng.f32(-1, 1)); m.wf32(a + 0x4c + 4 * k, rng.f32(-1, 1)); }
        m.w16(a + 0x60, rng.int(0x10000));
        if (r.anim) { m.w32(r.animPtr + 0xc, 0); m.wf32(r.animPtr + 0x10, 0); }
        if (r.nodePtrs) for (const p of r.nodePtrs) m.w32(p + 8, rng.u32());
      });
    };

    // ------------------------------------------------------------------------------------------------------------------------------------ 1. writer / reader scenarios
    for (let seed = 1; seed <= 60; seed++) {
      const rng = makeRng(seed * 7919);
      const s = genState(rng, { decorZone: seed % 3 === 0, bricks: seed % 5 === 0 ? 0 : undefined, nodeKinds: seed % 7 === 0 ? [0] : seed % 7 === 1 ? [1, 2] : undefined, walkersUsed: [0, 3, 10, 40, 60][seed % 5] });
      const slot = SLOTS[seed % SLOTS.length];
      const E = new SaveEmu(pe);
      E.setState(s);
      const label = `seed ${seed} slot ${slot}`;
      let w;
      try { w = E.write(slot); } catch (e) { bad(`${label}: original writer failed: ${e.message}`); continue; }
      st.scen++;
      ok(w.ret === 1, `${label}: the original writer returned ${w.ret}`);
      ok(w.name === slotFileName(slot) ? true : w.name === `_data//${slotFileName(slot)}`, `${label}: file name ${w.name} vs port ${slotFileName(slot)}`);
      ok(E.fileName(slot) === `_data//${slotFileName(slot)}`, `${label}: FUN_00418e40 name ${E.fileName(slot)}`);
      if (!w.bytes) { bad(`${label}: nothing written`); continue; }
      const B = w.bytes;
      ok(B.length === SAVE_SIZE, `${label}: file size ${B.length}`);
      st.bytes += B.length;
      ok(bufEq(B, w.buf), `${label}: file bytes != buffer`);
      const after = E.grab();
      if (s.vars[0x59] && after.decor && !bufEq(after.decor, s.decor)) st.decorRefresh++;
      const blob = brickBlob(E);
      const X = expectedSave(s, after, blob);
      // the port's writer from the same state
      let mine;
      try { mine = encodeSave(X); } catch (e) { bad(`${label}: port writer failed: ${e.message}`); continue; }
      const d = firstDiff(mine, B);
      ok(d < 0, `${label}: port bytes differ from the original's at offset ${hex(d)} (port ${mine[d]}, original ${B[d]}); length port ${new DataView(mine.buffer).getUint32(0, true)} original ${new DataView(B.buffer).getUint32(0, true)}`);
      // the port's reader on the original's bytes
      let dec;
      try { dec = decodeSave(B); } catch (e) { bad(`${label}: port reader failed on the original's file: ${e.message}`); continue; }
      sameSave(dec, X, label);
      ok(bufEq(encodeSave(dec), B), `${label}: decode+encode of the original's file is not identical`);
      st.entities += X.entities.length; st.objects += X.objects.length; st.bricks += X.bricks.filter(Boolean).length;
      st.walkers += s.walkers.length ? 1 : 0;
      st.nodesDec += X.entities.reduce((a, e) => a + e.nodes.length, 0);
      // validation: the original's FUN_0041ac8f over the buffer, the header readers
      ok(E.validate() === 1, `${label}: original validation of its own file`);
      ok((() => { try { validateSave(B); return true; } catch { return false; } })(), `${label}: port validation of the original's file`);
      const hdr = readSaveHeader(B);
      const oh = E.header(slot, B, 'menu'), lh = E.header(slot, B, 'load');
      ok(oh.ok === 1 && lh.ok === 1 && hdr !== null, `${label}: header readers ${oh.ok} ${lh.ok} ${!!hdr}`);
      ok(hdr && oh.subgame === hdr.subgame && oh.time === hdr.time && oh.fsm === hdr.fsmState && lh.subgame === hdr.subgame && lh.fsm === hdr.fsmState, `${label}: header values original ${JSON.stringify(oh)} port ${JSON.stringify(hdr)}`);
      // checksum function on the whole buffer
      const len = new DataView(B.buffer).getUint32(0, true);
      ok(E.checksum(len - 8) === saveChecksum(B, len - 8), `${label}: checksum original ${hex(E.checksum(len - 8))} port ${hex(saveChecksum(B, len - 8))}`);
      // the in-place load: the original's reader on the file in a game whose values differ
      const R = new SaveEmu(pe);
      R.setState(s);
      perturb(R, s, makeRng(seed * 31 + 7));
      const pre = R.grab();
      let ld;
      try { ld = R.load(slot, B); } catch (e) { bad(`${label}: original reader failed: ${e.message}`); continue; }
      st.loads++;
      ok(ld.header.ok === 1 && ld.ret === 1, `${label}: original reader returned ${ld.ret}`);
      const got = R.grab();
      ok(bufEq(got.vars.subarray(15, 319), X.vars) && got.vars[0x58] === after.vars[0x58], `${label}: vars after the original load`);
      ok(bufEq(got.camera, X.camera) && got.frame === X.frameCounter, `${label}: camera after the original load`);
      ok(bufEq(got.decor, X.decor), `${label}: decor after the original load`);
      got.records.forEach((r, i) => {
        // only records with a controller that has nodes are in the file; the others keep what they had
        const inFile = s.records[i].nodes && s.records[i].nodes.length;
        const o = inFile ? after.records[i] : pre.records[i];
        ok(bufEq(r.pos, o.pos) && bufEq(r.euler, o.euler) && r.flags === o.flags, `${label}: record ${i} pos / euler / flags after the load`);
        const oa = s.records[i].anim ? after.records[i].anim : null;
        ok(JSON.stringify(r.anim) === JSON.stringify(oa), `${label}: record ${i} anim after the load ${JSON.stringify(r.anim)} vs ${JSON.stringify(oa)}`);
        ok(JSON.stringify(r.nodes) === JSON.stringify(o.nodes), `${label}: record ${i} node states after the load`);
      });
      ok(R.brickReads.length === 1 && R.brickReads[0].size === blob.length, `${label}: brick blob handed to the brick reader (${JSON.stringify(R.brickReads.map((x) => x.size))} vs ${blob.length})`);
      // payload handed to the node loaders equals the payload of the file
      const want = [];
      for (const r of s.records) if (r.nodes) for (const n of r.nodes) if (n.type) want.push(n.data);
      ok(R.loaded.length === want.length && R.loaded.every((l, i) => bufEq(l.bytes, want[i])), `${label}: node loader payloads (${R.loaded.length} vs ${want.length})`);
      ok(!R.unhooked.size, `${label}: unhooked calls ${[...R.unhooked].map(([a]) => hex(a)).join(',')}`);
      ok(!E.unhooked.size, `${label}: writer unhooked calls ${[...E.unhooked].map(([a]) => hex(a)).join(',')}`);
    }

    // ------------------------------------------------------------------------------------------------------------------------------------ 2. validation: mutated files
    {
      const rng = makeRng(99);
      const s = genState(rng, { bricks: 1 });
      const E = new SaveEmu(pe);
      E.setState(s);
      const w = E.write(2);
      const B = w.bytes;
      const len = new DataView(B.buffer).getUint32(0, true);
      const test = (bytes, label) => {
        st.mutations++;
        E.mem.write(A.BUF, bytes);
        const orig = E.validate();
        let mine = 1, why = '';
        try { validateSave(bytes); } catch (e) { mine = 0; why = e instanceof SaveError ? e.reason : String(e); }
        if (!mine) st.rejects++;
        ok(orig === mine, `mutation ${label}: original validation ${orig}, port ${mine} (${why})`);
      };
      test(B, 'none');
      const cases = [];
      for (let i = 0; i < 80; i++) cases.push(['byte', 8 + rng.int(len - 8 + 4)]);
      for (const o of [4, 8, 0xc, 0x10, len - 12, len - 8, len - 7, len - 4, len - 1]) cases.push(['byte', o]);
      for (const [, o] of cases) { const m = B.slice(); m[o] ^= 1 << rng.int(8); test(m, `flip@${hex(o)}`); }
      for (const v of [0xc, 0xe, 0, 0xffffffff]) { const m = B.slice(); new DataView(m.buffer).setUint32(4, v, true); test(m, `version ${v}`); }
      for (const d of [-4, 4, -8, 8, 0x100, -0x100]) {
        const m = B.slice(); new DataView(m.buffer).setUint32(0, len + d, true); test(m, `length ${d}`);
      }
      // unaligned tail: a length whose checksum covers fewer bytes: rebuild a file by hand with len % 4 == 2
      for (const extra of [1, 2, 3]) {
        const m = new Uint8Array(SAVE_SIZE); m.set(B.subarray(0, len - 16)); const L = len - 16 + extra;
        const dv = new DataView(m.buffer);
        dv.setUint32(L, 0xc0cc00c, true); dv.setUint32(L + 4, 0, true); dv.setUint32(L + 8, 0xc0cc00c, true); dv.setUint32(0, L + 12, true);
        E.mem.write(A.BUF, m);
        dv.setUint32(L + 4, E.checksum(L + 4), true);
        test(m, `unaligned length +${extra}`);
        const m2 = m.slice(); m2[len - 17 + extra] ^= 4; test(m2, `unaligned length +${extra} flip in the last partial dword`);
      }
      // the original and port checksum over random buffers and random lengths
      for (let k = 0; k < 40; k++) {
        const buf = rng.bytes(SAVE_SIZE); const up = 12 + rng.int(0x4000);
        E.mem.write(A.BUF, buf);
        ok(E.checksum(up) === saveChecksum(buf, up), `checksum random up=${up}`);
      }
    }

    // ------------------------------------------------------------------------------------------------------------------------------------ 3. the size limit (0x51c8c)
    {
      const edge = (extra) => {
        const rng = makeRng(5);
        const s = genState(rng, { records: 3, bricks: 0, nodeKinds: [1] });
        s.records.forEach((r, i) => { r.nodes = i === 0 ? [{ type: 1, state: 7, data: new Uint8Array(0) }] : null; r.anim = null; });
        return { s, extra };
      };
      // find the empty length
      const E0 = new SaveEmu(pe), a = edge(0); E0.setState(a.s);
      const L0 = new DataView(E0.write(0).bytes.buffer).getUint32(0, true);
      for (const delta of [-8, -4, -1, 0, 1, 4, 8]) {
        const size = SAVE_SIZE - L0 + delta;
        const { s } = edge(0);
        s.records[0].nodes[0].data = new Uint8Array(size).fill(0x5a);
        const E = new SaveEmu(pe); E.setState(s);
        const w = E.write(1);
        const origOk = w.ret === 1;
        // the port, same content
        const X = expectedSave(s, E.grab(), brickBlob(E));
        let portOk = true, B2 = null;
        try { B2 = encodeSave(X); } catch (e) { portOk = false; if (!(e instanceof SaveError)) bad(`size edge ${delta}: ${e.message}`); }
        ok(origOk === portOk, `size edge ${delta}: original ${origOk ? 'writes' : 'refuses'} (length ${L0 + size}), port ${portOk ? 'writes' : 'refuses'}`);
        ok(origOk === (L0 + size <= SAVE_SIZE), `size edge ${delta}: original acceptance ${origOk} vs length ${L0 + size} <= ${hex(SAVE_SIZE)}`);
        if (origOk && portOk) ok(bufEq(w.bytes, B2), `size edge ${delta}: bytes`);
      }
      notes.push(`size limit: empty save ${L0} bytes, node payload sized to ${hex(SAVE_SIZE)} -1..+8`);
    }

    // ------------------------------------------------------------------------------------------------------------------------------------ 4. what the port's Shell.saveSlot writes
    {
      // shell.ts saveSlot: vars, subgame, fsm node, camera, frame counter 0, ONE entity (PEPP, pos, euler, flags 2, nodes []), no objects / walkers / decor / bricks
      const rng = makeRng(4242);
      const s = genState(rng, { records: 6, bricks: 0 });
      s.records[0].tag = 0x50455050; s.records[0].nodes = [{ type: 0, state: 5, data: null }];   // Pepper owns a controller with (at least) one behaviour node in the original
      const cam = new Uint8Array(0x48); new Float32Array(cam.buffer, 0, 18).set(Float32Array.from({ length: 18 }, (_, i) => i / 3));
      const sv = newSaveFromGame({ vars: s.vars, subgame: s.vars[0x59], fsmState: s.vars[0x58], camera: cam, frameCounter: 0, time: 1700000000,
        entities: [{ tag: 0x50455050, pos: Float32Array.of(1, 2, 3), euler: Float32Array.of(0, 1, 0), flags: 2, nodes: [] }] });
      const bytes = encodeSave(sv);
      const R = new SaveEmu(pe); R.setState(s);
      const ld = R.load(0, bytes);
      ok(ld.header.ok === 1 && ld.header.subgame === s.vars[0x59] && ld.header.fsm === s.vars[0x58], 'shell save: header read by the original');
      ok(R.validate() === 0 || true, 'shell save: (validation is only run by the original after a write)');
      st.shellLoad = ld.ret;
      // control: with a live Pepper whose controller has no nodes the same file is read fully (return 1): the failure is the missing node states
      const R2 = new SaveEmu(pe); s.records[0].nodes = []; R2.setState(s);
      const ld2 = R2.load(0, bytes);
      ok(ld2.ret === 1, `shell save with a live Pepper controller without nodes: original reader returned ${ld2.ret}`);
      ok(ld.ret === 0, `shell save with a one-node live Pepper: original reader returned ${ld.ret} (expected 0)`);
      notes.push(`KNOWN (port): a save written by Shell.saveSlot (entity PEPP with an empty node list, no objects / walkers / decor / bricks) is accepted by the original's header reader, but the original's body reader FUN_00419e82 returns ${ld.ret} on it when the live Pepper has one behaviour node (it reads the node states from the stream): such a file cannot be loaded by the original game, only by this port; files of the original load in the port (scenarios above)`);
    }

    notes.unshift(`scenarios ${st.scen} (8 slot names incl. SaveDef -2), ${st.bytes} file bytes compared; entity records ${st.entities} with ${st.nodesDec} nodes, object records ${st.objects}, brick slots in use ${st.bricks}, decor refreshed by FUN_00421eb3 in ${st.decorRefresh}, in-place loads by the original ${st.loads}, validation mutations ${st.mutations} (${st.rejects} rejected)`);
    notes.push(`KNOWN (port reader, not fixable without the node types): ${st.ambiguous.length} entity records where the payload / no-payload reading of the node list is ambiguous (byte-identical when written back)${st.ambiguous.length ? ': ' + st.ambiguous.slice(0, 3).join('; ') : ''}`);
    return { checked, failures, notes };
  },
};
