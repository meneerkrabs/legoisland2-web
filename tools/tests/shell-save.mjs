// Save game format (FUN_00418ec7 writer, FUN_00419e82 reader, FUN_0041ac8f validation, FUN_00418e7f checksum), SaveStore and Options.
import fs from 'node:fs';
import path from 'node:path';
import { Pe } from '../../src/formats/exe.ts';
import { GameVars } from '../../src/game/vars.ts';
import { readFsmCaptions } from '../../src/shell/tables.ts';
import {
  SAVE_SIZE, OFF, M, SaveError, encodeSave, decodeSave, newSaveFromGame, saveChecksum, readSaveHeader, slotFileName, fsmCaptionId, saveCaption, EMPTY_SLOT_CAPTION,
  validateSave, saveWarnings, applySaveVars, captureVars, WALKER_BYTES, BRICK_SLOT_BYTES,
} from '../../src/shell/save.ts';
import { SaveStore, MemoryBackend, IdbBackend } from '../../src/shell/savestore.ts';
import { Options, readOptionDefaults, FALLBACK_DEFAULTS, SETTINGS_BYTES, S } from '../../src/shell/options.ts';

let seed = 12345;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
const rbytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = rnd() >>> 24; return b; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const f3 = (a, b, c) => Float32Array.of(a, b, c);

function gameLike() {
  const vars = new Int32Array(319);
  for (let i = 0; i < 319; i++) vars[i] = (i * 2654435761) | 0;
  const objects = [];
  for (let i = 0; i < 120; i++) objects.push({ tag: 0x50455050 + i, animState: rnd() % 200, animFrame: Math.fround((rnd() % 10000) / 7) });
  const entities = [];
  for (let i = 0; i < 40; i++) {
    const nodes = [];
    for (let k = 0; k < 1 + (i % 4); k++) {
      const kind = (i + k) % 3;
      nodes.push({ state: 0x20 + k + i, data: kind === 0 ? null : rbytes(kind === 1 ? (i * 3 + k) % 17 : 40 + ((i * 5) % 9)) });
    }
    entities.push({ tag: 0x4e4e4e00 + i, pos: f3(i, -i * 1.5, 100 + i), euler: f3(0, i / 10, 0), flags: 0x1000 + i, nodes });
  }
  const bricks = new Array(64).fill(null);
  for (const i of [0, 5, 17, 63]) { const b = rbytes(BRICK_SLOT_BYTES); b[0] = 1; bricks[i] = b; }
  const decor = rbytes(0x380);
  const walkers = rbytes(WALKER_BYTES), walkerTags = new Uint32Array(60).map(() => rnd());
  return newSaveFromGame({ vars, subgame: 31, fsmState: 11, time: 1700000000, camera: rbytes(0x48), frameCounter: 123456, objects, entities, bricks, decor, walkers, walkerTags });
}

const dvOf = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
function fixChecksum(b) { const dv = dvOf(b), len = dv.getUint32(0, true); dv.setUint32(len - 8, saveChecksum(b, len - 8), true); }
function reason(fn) { try { fn(); return 'none'; } catch (e) { return e instanceof SaveError ? e.reason : `other:${e.message}`; } }

export default {
  name: 'shell-save',
  async run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const exePath = path.join(ctx.dataRoot, 'LEGO eiland 2.exe');
    if (!fs.existsSync(exePath)) return { checked: 0, failures: [`missing ${exePath}`] };
    const pe = new Pe(new Uint8Array(fs.readFileSync(exePath)));

    // -- fixed layout (offsets derived from the writer FUN_00418ec7, see src/shell/save.ts)
    ok(SAVE_SIZE === 0x51c8c, 'file size 0x51c8c (memset / fwrite size in FUN_00418ec7)');
    ok(OFF.MARK_HEADER === 0x14 && OFF.VARS === 0x18 && OFF.MARK_VARS === 0x4d8, 'header 5 dwords + marker, vars 0x4c0 bytes (FUN_00417908)');
    ok(OFF.WALKERS === 0x4dc && OFF.MARK_WALKERS === 0x4dc + 0x1ef0 + 0xf0 && OFF.CAMERA === 0x24c0, 'walker blob 0x1ef0 + 0x3c tags (FUN_00462d8b)');
    ok(OFF.FRAME === 0x2508 && OFF.MARK_CAMERA === 0x250c && OFF.OBJECTS === 0x2510, 'camera 0x48 + frame counter, then marker 0xa0aa00a');

    // -- empty file from the port
    const vars = new Int32Array(319); for (let i = 0; i < 319; i++) vars[i] = i * 7 - 100;
    const s0 = newSaveFromGame({ vars, subgame: 2, fsmState: 3, time: 1700000000 });
    const b0 = encodeSave(s0), dv0 = dvOf(b0);
    ok(b0.length === SAVE_SIZE, `empty save size ${b0.length}`);
    const used0 = OFF.OBJECTS + 4 + 4 + 0x380 + 4 + 4 + 4 + 64 + 4 + 4 + 4 + 4;
    ok(dv0.getUint32(0, true) === used0, `length field ${dv0.getUint32(0, true)} != ${used0}`);
    ok(dv0.getUint32(4, true) === 0xd && dv0.getUint32(8, true) === 2 && dv0.getUint32(0xc, true) === 1700000000 && dv0.getUint32(0x10, true) === 3, 'header dwords');
    ok(dv0.getUint32(0x14, true) === 0x8088008 && dv0.getUint32(0x4d8, true) === 0xf0ff00f && dv0.getUint32(0x24bc, true) === 0xe0ee00e && dv0.getUint32(0x250c, true) === 0xa0aa00a, 'markers 0x8088008 / 0xf0ff00f / 0xe0ee00e / 0xa0aa00a at fixed offsets');
    ok(dv0.getInt32(0x18, true) === vars[15] && dv0.getInt32(0x18 + 303 * 4, true) === vars[318], 'vars 15..318 stored at 0x18');
    ok(dv0.getUint32(0x2510, true) === 0x9099009 && dv0.getUint32(0x2514, true) === 0x380 && dv0.getUint32(0x2518 + 0x380, true) === 0x6066006, 'decor marker, size 0x380, entity marker');
    const tail = used0 - 16;
    ok(dv0.getUint32(tail, true) === 0x7077007 && dv0.getUint32(tail + 4, true) === M.END && dv0.getUint32(used0 - 4, true) === M.END, 'closing markers 0x7077007 0xc0cc00c checksum 0xc0cc00c');
    ok(dv0.getUint32(tail + 8, true) === saveChecksum(b0, used0 - 8), 'checksum dword');
    ok(b0.subarray(used0).every((x) => x === 0), 'the rest of the 0x51c8c bytes is zero');
    ok(validateSave(b0) === used0, 'validateSave');
    // checksum = xor of the dwords 2.. (from offset 8) up to the checksum dword minus one
    let x = 0; for (let i = 8; i < used0 - 8 - 4; i += 4) x ^= dv0.getUint32(i, true);
    ok((x >>> 0) === dv0.getUint32(used0 - 8, true), 'independent xor checksum');

    // -- round trip of the empty file
    const d0 = decodeSave(b0);
    ok(d0.subgame === 2 && d0.fsmState === 3 && d0.objects.length === 0 && d0.entities.length === 0 && d0.bricks.length === 64 && d0.bricks.every((b) => b === null), 'decode empty');
    ok(same(encodeSave(d0), b0), 'empty save re-encodes identically');
    ok(same(d0.vars, vars.subarray(15)), 'vars round trip');
    ok(same(encodeSave(newSaveFromGame({ vars: vars.subarray(15), subgame: 2, fsmState: 3, time: 1700000000 })), b0), '304-value vars input is the same as 319');

    // -- game-like file: every section filled with data
    const g = gameLike(), bg = encodeSave(g);
    ok(bg.length === SAVE_SIZE, 'game-like size');
    const dg = decodeSave(bg);
    ok(!dg.entitiesRaw && !dg.bricksRaw, 'entities and bricks parsed structurally');
    ok(dg.objects.length === 120 && dg.objects[7].tag === g.objects[7].tag && dg.objects[7].animState === g.objects[7].animState && dg.objects[7].animFrame === g.objects[7].animFrame, 'objects');
    ok(dg.entities.length === 40 && dg.entities.every((e, i) => e.tag === g.entities[i].tag && e.flags === g.entities[i].flags && same(new Uint8Array(e.pos.buffer), new Uint8Array(g.entities[i].pos.buffer)) && e.nodes.length === g.entities[i].nodes.length
      && e.nodes.every((n, k) => n.state === g.entities[i].nodes[k].state && (n.data === null) === (g.entities[i].nodes[k].data === null) && (n.data === null || same(n.data, g.entities[i].nodes[k].data)))), 'entities and nodes (with and without serializer blobs)');
    ok(dg.bricks.map((b, i) => b ? i : -1).filter((i) => i >= 0).join() === '0,5,17,63' && same(dg.bricks[17], g.bricks[17]), 'brick slots');
    ok(same(dg.walkers, g.walkers) && same(dg.walkerTags, g.walkerTags) && same(dg.camera, g.camera) && dg.frameCounter === 123456 && same(dg.decor, g.decor) && same(dg.vars, g.vars), 'raw sections');
    const bg2 = encodeSave(dg);
    ok(same(bg2, bg), 'game-like file re-encodes byte exact');
    ok(dvOf(bg).getUint32(0, true) < SAVE_SIZE && bg.subarray(dvOf(bg).getUint32(0, true)).every((v) => v === 0), 'game-like: zero padding after the used length');
    // layout of the filled sections
    const dgv = dvOf(bg);
    ok(same(bg.subarray(OFF.WALKERS, OFF.WALKERS + WALKER_BYTES), g.walkers) && dgv.getUint32(OFF.WALKERS + WALKER_BYTES, true) === g.walkerTags[0], 'walker blob at 0x4dc, tags after the 0x1ef0 raw bytes');
    ok(same(bg.subarray(OFF.CAMERA, OFF.CAMERA + 0x48), g.camera) && dgv.getUint32(OFF.FRAME, true) === 123456, 'camera + frame counter');
    ok(dgv.getUint32(OFF.OBJECTS, true) === g.objects[0].tag && dgv.getUint32(OFF.OBJECTS + 4, true) === g.objects[0].animState && dgv.getUint32(OFF.OBJECTS + 12, true) === M.OBJECT && dgv.getUint32(OFF.OBJECTS + 16, true) === g.objects[1].tag, 'object record = tag, state, float, marker 0xd0dd00d (16 bytes)');
    const entStart = OFF.OBJECTS + 120 * 16 + 4 + 4 + 0x380 + 4;
    ok(dgv.getUint32(entStart - 4, true) === M.ENTITIES && dgv.getUint32(entStart, true) === g.entities[0].tag && dgv.getUint16(entStart + 28, true) === g.entities[0].flags, 'entity record: tag, pos 12, euler 12, flags u16');
    ok(encodeSave({ ...dg, length: 0 }).length === SAVE_SIZE, 'length field is recomputed');

    // -- bit flips inside the used part are always detected
    const usedG = dgv.getUint32(0, true);
    let undetected = 0, flips = 0;
    for (let t = 0; t < 4000; t++) {
      const bad = bg.slice(), pos = rnd() % usedG;
      bad[pos] ^= 1 << (rnd() % 8);
      flips++;
      if (reason(() => decodeSave(bad, { strict: true })) === 'none') undetected++;
    }
    ok(undetected === 0, `${undetected} of ${flips} random bit flips went undetected`);
    // every byte of a small file
    let miss = 0;
    for (let pos = 0; pos < used0; pos++) { const bad = b0.slice(); bad[pos] ^= 0x10; if (reason(() => decodeSave(bad, { strict: true })) === 'none') miss++; }
    ok(miss === 0, `${miss} byte flips of the empty save went undetected`);
    // padding after the used length is ignored by the original too
    { const bad = b0.slice(); bad[used0 + 100] = 9; ok(reason(() => decodeSave(bad)) === 'none', 'padding after the used length is not validated'); }

    // -- error reasons
    ok(reason(() => decodeSave(b0.subarray(0, 1000))) === 'size' && reason(() => decodeSave(new Uint8Array(SAVE_SIZE + 1))) === 'size', 'wrong length -> size');
    { const bad = b0.slice(); bad[4] = 0xc; fixChecksum(bad); ok(reason(() => decodeSave(bad)) === 'version', 'version'); }
    { const bad = b0.slice(); dvOf(bad).setUint32(0, 0x60000, true); ok(reason(() => decodeSave(bad)) === 'length', 'length beyond the file'); }
    { const bad = b0.slice(); dvOf(bad).setUint32(0, 0x10, true); ok(reason(() => decodeSave(bad)) === 'length', 'length too small'); }
    { const bad = b0.slice(); bad[0x100] ^= 4; ok(reason(() => decodeSave(bad, { strict: true })) === 'checksum' && reason(() => decodeSave(bad)) === 'none' && saveWarnings(bad).length === 1, 'checksum: strict validation fails, the original-like load accepts it and the import warns'); }
    { const bad = b0.slice(); dvOf(bad).setUint32(used0 - 4, 0, true); ok(reason(() => decodeSave(bad, { strict: true })) === 'marker' && reason(() => decodeSave(bad)) === 'none', 'closing marker (strict only)'); }
    { const bad = b0.slice(); dvOf(bad).setUint32(0x4d8, 1, true); fixChecksum(bad); ok(reason(() => decodeSave(bad)) === 'marker', 'inner marker with a correct checksum'); }
    { const bad = b0.slice(); dvOf(bad).setUint32(0x2514, 0x100, true); fixChecksum(bad); ok(reason(() => decodeSave(bad)) === 'decor', 'decor size'); }
    // too much data
    { const e = []; for (let i = 0; i < 12000; i++) e.push({ tag: i + 1, pos: f3(0, 0, 0), euler: f3(0, 0, 0), flags: 0, nodes: [{ state: 1, data: rbytes(40) }] });
      ok(reason(() => encodeSave(newSaveFromGame({ vars, subgame: 0, fsmState: 0, entities: e }))) === 'too-big', 'writer refuses data beyond 0x51c8c bytes'); }

    // -- entity section that cannot be parsed: kept raw, byte exact
    {
      const s = newSaveFromGame({ vars, subgame: 6, fsmState: 15, time: 5 });
      const junk = rbytes(333); for (let i = 0; i + 3 < junk.length; i++) if (junk[i + 3] === 0x07 && junk[i] === 0x07) junk[i] = 1;
      s.entitiesRaw = junk;
      const b = encodeSave(s), d = decodeSave(b);
      ok(same(encodeSave(d), b), 'junk entity section round trips byte exact');
    }
    // brick blob with the wrong slot structure
    { const s = newSaveFromGame({ vars, subgame: 6, fsmState: 15, time: 5 }); s.bricksRaw = rbytes(100).map((v) => v | 1); const b = encodeSave(s), d = decodeSave(b); ok(!!d.bricksRaw && same(encodeSave(d), b), 'odd brick blob kept raw'); }

    // -- header, names, captions
    const h = readSaveHeader(bg);
    ok(h && h.subgame === 31 && h.fsmState === 11 && h.time === 1700000000 && h.length === usedG, 'readSaveHeader');
    ok(readSaveHeader(new Uint8Array(SAVE_SIZE)) === null && readSaveHeader(new Uint8Array(4)) === null, 'empty / short files have no header');
    ok(slotFileName(0) === 'Save00.lgo' && slotFileName(6) === 'Save06.lgo' && slotFileName(-2) === 'SaveDef.lgo', 'slot file names');
    const caps = readFsmCaptions(pe);
    ok(fsmCaptionId(11, caps) === 'FSMSTATE10' && fsmCaptionId(200, caps) === null, 'FSMSTATE caption id');
    ok(saveCaption(h, caps, (id) => `[${id}]`) === '[FSMSTATE10]' && saveCaption(null, caps, () => 'x') === EMPTY_SLOT_CAPTION && EMPTY_SLOT_CAPTION === pe.cstr(0x8a57d0), 'caption text / empty-slot caption (string at 0x8a57d0)');
    // vars apply / capture
    { const gv = new GameVars(); applySaveVars(g, gv); ok(gv.a[15] === g.vars[0] && gv.a[318] === g.vars[303] && gv.a[14] === 0 && same(captureVars(gv), g.vars), 'applySaveVars / captureVars'); }

    // -- store with the memory backend
    {
      const store = new SaveStore(new MemoryBackend());
      ok((await store.slotInfo(3)).empty && (await store.load(3)) === null && (await store.exportLgo(3)) === null, 'store: empty slot');
      await store.save(3, g);
      const info = await store.slotInfo(3);
      ok(!info.empty && info.header.fsmState === 11 && info.header.subgame === 31, 'store: slot info from the header');
      ok(same(encodeSave(await store.load(3)), bg) && same(await store.exportLgo(3), bg), 'store: load / export give the same bytes');
      await store.importLgo(0, bg);
      ok((await store.slotInfos()).map((i) => i.empty).join() === 'false,true,true,false,true,true,true', 'store: slot infos after save + import');
      let err = null; try { await store.importLgo(1, bg.subarray(0, 5000)); } catch (e) { err = e; }
      ok(err instanceof SaveError && (await store.slotInfo(1)).empty, 'store: invalid import rejected');
      const bad = bg.slice(); bad[0x300] ^= 1; err = null; let warn = null; try { warn = await store.importLgo(1, bad); } catch (e) { err = e; }
      ok(err === null && warn.length === 1, 'store: wrong checksum imports with a warning (the original never checks it)');
      await store.erase(1);
      await store.erase(3);
      ok((await store.slotInfo(3)).empty && (await store.backend.list()).join() === 'Save00.lgo', 'store: erase');
      // damaged file in the store: header still readable, load throws
      await store.backend.put('Save02.lgo', bad);
      ok(!(await store.slotInfo(2)).empty && (await store.load(2).then(() => 'ok', (e) => e.reason)) === 'ok', 'store: wrong checksum slot loads like the original');
    }
    // -- indexedDB backend falls back to memory when IndexedDB is unavailable (node)
    {
      const idb = new IdbBackend();
      await idb.put('a', Uint8Array.of(1, 2, 3));
      ok(idb.degraded === (typeof indexedDB === 'undefined') && same(await idb.get('a'), Uint8Array.of(1, 2, 3)) && (await idb.list()).join() === 'a', 'IdbBackend degrades to memory');
      await idb.delete('a'); ok((await idb.get('a')) === null, 'IdbBackend delete');
    }

    // -- options
    {
      const def = readOptionDefaults(pe);
      ok(def && def.length === 23 && same(def, Int32Array.from(FALLBACK_DEFAULTS)), `option defaults read from FUN_00403e30 = built-in constants: ${def && [...def].map((v) => v.toString(16)).join(',')}`);
      const o = Options.fromExe(pe);
      ok(o.musicVolume === 80 && o.sfxVolume === 80 && o.speechVolume === 80 && o.speechOn && o.subtitlesOn && o.sensitivity === 45 && o.drawDistance === 50 && o.textureQuality === 1 && o.gamepad, 'option defaults');
      ok(o.binding(0).dik === 0xc8 && o.binding(0).device === 1 && o.binding(12).dik === 0x1c && o.binding(13).dik === 0x53, 'default key bindings (Up 0xc8 ... Enter 0x1c, Del 0x53)');
      const enc = o.encode();
      ok(enc.length === 92 && SETTINGS_BYTES === 92, 'options file is 92 bytes');
      ok(dvOf(enc).getInt32(0, true) === 0x50 && dvOf(enc).getInt32(4 * 4, true) === 0x100c8 && dvOf(enc).getInt32(0x16 * 4, true) === 0x50, 'little-endian layout: [0] music, [4] up, [0x16] speech volume');
      const o2 = new Options(); o2.decode(enc);
      ok(same(o2.encode(), enc), 'options round trip');
      const seen = []; o2.onChange((i, v) => seen.push(`${i}=${v}`));
      o2.musicVolume = 33; o2.musicVolume = 33; o2.setBinding(4, 1, 0x1e);
      ok(seen.join() === '0=33,8=65566' && o2.musicVolume === 33, 'change notifications (only on a change)');
      // speech / subtitles: at least one stays on
      const o3 = new Options(); o3.setSpeechOn(false); ok(!o3.speechOn && o3.subtitlesOn, 'speech off keeps subtitles on');
      o3.setSubtitlesOn(false); ok(o3.speechOn && !o3.subtitlesOn, 'subtitles off with speech off forces speech on');
      o3.setSubtitlesOn(true); o3.setSpeechOn(false); ok(!o3.speechOn && o3.subtitlesOn, 'speech off with subtitles on is allowed');
      const gv = new GameVars(); o3.applyToVars(gv); ok(gv.get(9) === 0 && gv.get(0) === 1, 'vars 9 / 0 mirror speech / subtitles');
      o3.reset(); ok(o3.speechOn && o3.subtitlesOn, 'reset');
      // short file keeps the rest
      const o4 = new Options(); o4.decode(enc.subarray(0, 10)); ok(o4.get(0) === 0x50 && o4.get(2) === 1, 'short file');
      // persistence
      const store = new SaveStore(new MemoryBackend());
      ok(!(await store.loadOptions(new Options())), 'no options stored yet');
      o2.sfxVolume = 12; await store.saveOptions(o2);
      const o5 = new Options(); ok(await store.loadOptions(o5) && o5.sfxVolume === 12 && o5.musicVolume === 33 && (await store.backend.list()).join() === 'Settings.set', 'options persisted under Settings.set');
      const stop = store.autosaveOptions(o5); o5.drawDistance = 77; await Promise.resolve(); await Promise.resolve(); stop();
      const o6 = new Options(); await store.loadOptions(o6); ok(o6.drawDistance === 77, 'autosave on change');
      ok(S.SPEECH_VOLUME === 0x16 && S.KEY_FIRST === 4, 'index constants');
    }

    return { checked, failures, notes: [`game-like file: ${usedG} of ${SAVE_SIZE} bytes in use, ${flips} bit flips detected`] };
  },
};
