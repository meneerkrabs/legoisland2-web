// Mods (src/mods): zip reading (stored / deflate / zip64, streaming), package detection (LI2 Mod Manager format), patch.txt parsing + application,
// the override layer (loose files win over archive members exactly like the original's fopen-then-archive order) and the effect report on the real EXE.
import fs from 'node:fs';
import path from 'node:path';
import { buildZip } from '../lib/zipwrite.mjs';
import { listZip, readEntry, zipBytes, zipBlob, crc32 } from '../../src/mods/zip.ts';
import { planMods, describeMod, parsePatchText } from '../../src/mods/package.ts';
import { applyPatches } from '../../src/mods/patch.ts';
import { ModLayer, ModdedFiles, withMods } from '../../src/mods/overlay.ts';
import { MemoryModStore, loadPatches } from '../../src/mods/store.ts';
import { importPicked, loadActiveMods } from '../../src/mods/manage.ts';
import { EffectMap } from '../../src/mods/effects.ts';
import { Archive } from '../../src/formats/archive.ts';
import { GameData } from '../../src/viewer/data.ts';
import { Pe } from '../../src/formats/exe.ts';
import { MenuUi, MR } from '../../src/shell/menuui.ts';
import { Options } from '../../src/shell/options.ts';
import { readLevelSelect, readMenuPages } from '../../src/shell/tables.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';

const enc = (s) => new TextEncoder().encode(s);
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

export default {
  name: 'mods',
  async run(ctx) {
    const failures = []; let checked = 0;
    const ok = (cond, msg) => { checked++; if (!cond) failures.push(msg); };

    // ---- zip: stored, deflate, zip64, directory entries, bad CRC
    const big = new Uint8Array(100000).map((_, i) => (i * 7) & 255);
    for (const zip64 of [false, true]) {
      const z = await buildZip([
        { name: 'a/', data: new Uint8Array(0) },
        { name: 'a/stored.bin', data: big },
        { name: 'a/deflated.bin', data: big, method: 'deflate' },
        { name: 'ünï.txt', data: enc('hallo') },
      ], { zip64 });
      const es = await listZip(zipBytes(z));
      ok(es.length === 4 && es[3].name === 'ünï.txt', `zip${zip64 ? '64' : ''}: entry names`);
      ok(eq(await readEntry(zipBytes(z), es[1]), big) && eq(await readEntry(zipBytes(z), es[2]), big), `zip${zip64 ? '64' : ''}: stored + deflate contents`);
      ok(eq(await readEntry(zipBlob(new Blob([z])), es[2]), big), `zip${zip64 ? '64' : ''}: Blob source`);
      const bad = z.slice();
      const off = es[1].offset + 30 + enc('a/stored.bin').length + (zip64 ? 20 : 0) + 5; bad[off] ^= 0xff;
      let threw = false; try { await readEntry(zipBytes(bad), (await listZip(zipBytes(bad)))[1]); } catch { threw = true; }
      ok(threw, `zip${zip64 ? '64' : ''}: a damaged member is detected by its CRC`);
    }
    ok(crc32(enc('123456789')) === 0xcbf43926, 'crc32 check value');

    // ---- package detection
    const E = (...p) => p.map((x) => ({ path: x, size: 10 }));
    let plans = planMods(E('Bi-Plane Fix (Fullscreen)/info.txt', 'Bi-Plane Fix (Fullscreen)/patch.txt', 'Bi-Plane Fix (Fullscreen)/installed', 'Bi-Plane Fix (Windowed)/info.txt', 'Bi-Plane Fix (Windowed)/patch.txt'));
    ok(plans && plans.length === 2 && plans[0].files.length === 0 && plans[0].patch && plans[0].info, 'two mod folders in one zip (installed marker ignored)');
    plans = planMods(E('Island Grass/info.txt', 'Island Grass/_data/z02LGI/textures/text008.tga', 'Island Grass/_Data/z03PPH/textures/text033.tga', 'Island Grass/preview.png', '__MACOSX/x', 'Island Grass/.DS_Store'));
    ok(plans?.length === 1 && plans[0].files.length === 2 && plans[0].files[1].path === '_data/z03PPH/textures/text033.tga' && plans[0].warnings.length === 1, 'file replacement mod: _data in any case, junk and extra files dropped with a warning');
    plans = planMods(E('info.txt', 'patch.txt'));
    ok(plans?.length === 1 && plans[0].folder === '', 'mod files at the zip root');
    plans = planMods(E('top/inner/_data/menu/text000.tga'));
    ok(plans?.length === 1 && plans[0].folder === 'top/inner' && plans[0].files[0].path === '_data/menu/text000.tga', 'nested mod folder');
    ok(planMods(E('readme.md', 'pic.png')) === null, 'a zip without a mod is rejected');
    plans = planMods(E('m/_data/../x.tga', 'm/_data/a/b.tga'));
    ok(plans?.[0].files.length === 1 && plans[0].warnings.some((w) => w.includes('ongeldig')), '".." paths are refused');

    // ---- info / patch text
    const info = describeMod(planMods(E('X/info.txt'))[0], 'Nicer Skies\r\nJappa\r\nLine one\r\nLine two\r\n', null);
    ok(info.title === 'Nicer Skies' && info.author === 'Jappa' && info.description === 'Line one\nLine two', 'info.txt: title, author, description');
    ok(describeMod(planMods(E('Fold/patch.txt'))[0], null, '').title === 'Fold', 'missing info.txt: the folder name is the title');
    const pt = parsePatchText('4399FE;FFDD7F\r\n\r\n90DC2;3333933F;0000403F\n29B2 ; 01 ; 00\nzz;01\n1;2\n5;0102;01');
    ok(pt.patches.length === 3 && pt.errors.length === 3, `patch.txt: 3 good lines + 3 reported (${pt.patches.length}/${pt.errors.length})`);
    ok(pt.patches[1].offset === 0x90dc2 && eq(pt.patches[1].bytes, [0x33, 0x33, 0x93, 0x3f]) && eq(pt.patches[1].original, [0, 0, 0x40, 0x3f]), 'patch.txt: offset;new;original (new first)');
    ok(eq(pt.patches[2].bytes, [1]) && eq(pt.patches[2].original, [0]), 'patch.txt: spaces around the separators');

    // ---- applying patches
    const exe = new Uint8Array(32).map((_, i) => i);
    const r = applyPatches(exe, parsePatchText('2;AA;02\n4;BB;09\n6;CC\n40;01\n8;08;08\n2;AA;02').patches);
    ok(r.results.map((x) => x.status).join() === 'applied,mismatch,applied,range,already,already', `patch status: ${r.results.map((x) => x.status)}`);
    ok(r.data[2] === 0xaa && r.data[4] === 4 && r.data[6] === 0xcc && exe[2] === 2, 'patch: original array untouched, conditional write only on a match');
    ok(applyPatches(exe, []).data === exe, 'no patches: the very same bytes (nothing is copied)');

    // ---- archive override (loose file wins, case-insensitive, new members, undo)
    const arch = ctx.archives.find((a) => a.name === 'z02LGI');
    const probe = arch.entries.find((e) => /\.tga$/i.test(e.path));
    const orig = arch.read(probe).slice();
    const a2 = new Archive(arch.name, fs.readFileSync(path.join(ctx.dataDir, 'z02LGI.bod')), arch.bob);
    ok(a2.override(probe.path.toUpperCase().replace(/\//g, '\\'), enc('NEW')) === true && eq(a2.read(probe.path), enc('NEW')) && a2.find(probe.path).size === 3, 'override: replaces a member (any case, either slash)');
    ok(a2.override('textures/brand_new.tga', enc('X')) === false && a2.has('Textures/BRAND_NEW.tga') && a2.entries.at(-1).fullPath === '_data/z02LGI/textures/brand_new.tga', 'override: adds a member');
    a2.clearOverrides();
    ok(eq(a2.read(probe.path), orig) && a2.find(probe.path).size === orig.length && !a2.has('textures/brand_new.tga') && a2.entries.length === arch.entries.length, 'clearOverrides: back to the blob');

    // ---- layer + files wrapper + GameData
    const mkMod = (id, title, files, patches = []) => ({ id, title, files: files.map(([p, d]) => ({ path: p, size: d.length, read: async () => d })), patches });
    const m1 = mkMod('1', 'First', [[`_data/z02LGI/${probe.path}`, enc('ONE')], ['_data/sounds/x.wav', enc('W1')]]);
    const m2 = mkMod('2', 'Second', [[`_DATA/Z02lgi/${probe.path.toUpperCase()}`, enc('TWO')]]);
    const layer = new ModLayer([m1, m2]);
    ok(layer.shadowed.length === 1 && layer.shadowed[0].byTitle === 'Second' && eq(await layer.get(`_data/z02lgi/${probe.path}`).read(), enc('TWO')), 'later mod wins, the loser is listed');
    const exeBytes = new Uint8Array(fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe')));
    const base = {
      source: 'dev', loading: null, list: () => ['LEGO eiland 2.exe', '_data/z02LGI.bod'], has: (p) => /exe$/i.test(p), size: (p) => (/exe$/i.test(p) ? exeBytes.length : -1), totalSize: () => exeBytes.length,
      loaded: () => true, ready: async () => {}, movie: async () => null, read: async (p) => { if (/exe$/i.test(p)) return exeBytes; throw new Error('missing ' + p); },
    };
    const mf = new ModdedFiles(base, layer);
    ok(eq(await mf.read('_DATA\\sounds\\X.WAV'), enc('W1')) && mf.has('_data/sounds/x.wav') && mf.size('_data/sounds/x.wav') === 2, 'files: loose file found through any case / slash');
    ok(mf.list().includes('_data/sounds/x.wav'), 'files: list() shows added files');
    ok((await mf.read('LEGO eiland 2.exe')) === exeBytes, 'files: EXE untouched without patches');
    const patched = new ModdedFiles(base, new ModLayer([mkMod('3', 'P', [], parsePatchText('90DC2;3333933F;0000403F').patches)]));
    const pe = await patched.read('lego EILAND 2.exe');
    ok(pe.length === exeBytes.length && eq(pe.subarray(0x90dc2, 0x90dc6), [0x33, 0x33, 0x93, 0x3f]) && eq(exeBytes.subarray(0x90dc2, 0x90dc6), [0, 0, 0x40, 0x3f]) && patched.layer.patchResults[0].status === 'applied', 'files: patched EXE bytes, original untouched');
    ok(withMods(base, []) === base && withMods(base, [mkMod('4', 'empty', [])]) === base, 'no mods: the original files object is used as it is');
    // GameData opens the archive with the mod's files in it and lets zone archives go again
    const files2 = {
      ...base,
      read: async (p) => { const m = /_data\/(.+)\.(bod|bob)$/i.exec(p); if (m) return new Uint8Array(fs.readFileSync(path.join(ctx.dataDir, `${m[1]}.${m[2].toLowerCase()}`))); return base.read(p); },
      archiveOverrides: (n) => layer.archiveOverrides(n),
    };
    const gd = new GameData(files2);
    const ga = await gd.archive('z02LGI');
    ok(eq(ga.read(probe.path), enc('TWO')) && layer.applied.length === 1 && layer.applied[0].replaced === true, 'GameData.archive: members replaced, the layer records it');
    await gd.releaseZoneOverrides();
    ok(eq(ga.read(probe.path), orig), 'GameData.releaseZoneOverrides: the zone archive is back to its own data');
    const ga2 = await gd.archive('z02LGI');
    ok(ga2 === ga && eq(ga2.read(probe.path), enc('TWO')), 'GameData.archive: loaded again on the next visit');
    const gm = await new GameData(files2).archive('menu');
    ok(gm.entries.length === ctx.archives.find((a) => a.name === 'menu').entries.length, 'archives without mod files are untouched');

    // ---- the store and the import flow (zip + folder), ordering, enable
    const store = new MemoryModStore();
    const zip = await buildZip([
      { name: 'Grass/info.txt', data: enc('Grass\r\nXiron\r\nGreen') },
      { name: 'Grass/_data/z02LGI/textures/text008.tga', data: big, method: 'deflate' },
      { name: 'Grass/_data/z03PPH/textures/text033.tga', data: big },
      { name: 'Skies/patch.txt', data: enc('4399FE;FFDD7F\r\n') },
    ]);
    const prog = [];
    const res = await importPicked([{ path: 'grass.zip', file: new Blob([zip]) }], store, (p) => prog.push(p));
    ok(res.errors.length === 0 && res.added.length === 2 && res.added[0].files.length === 2 && res.added[1].patches.length === 1, `import zip: 2 mods (${res.errors.join('; ')})`);
    ok(prog.at(-1).label === 'Klaar' && prog.at(-1).done === 2 * big.length, 'import zip: progress counts the bytes');
    ok(eq(await store.readFile(res.added[0].id, res.added[0].files[0].key), big), 'import zip: file bytes in the store');
    const again = await importPicked([{ path: 'grass.zip', file: new Blob([zip]) }], store);
    ok(again.added.length === 2 && (await store.list()).length === 2, 'importing the same zip again replaces, not duplicates');
    let l = await store.list();
    await store.move(l[1].id, -1);
    l = await store.list();
    ok(l[0].title === 'Skies' || l[0].patches.length === 1, 'move: list order changes');
    await store.setEnabled(l[0].id, false);
    const active = await loadActiveMods(store);
    ok(active.length === 1 && active[0].title === 'Grass' && active[0].files.length === 2, 'only enabled mods are loaded, in list order');
    const bad = await importPicked([{ path: 'x.zip', file: new Blob([enc('not a zip at all, really not')]) }, { path: 'cat.tga', file: new Blob([big]) }], store);
    ok(bad.errors.length === 2 && bad.added.length === 0, 'import: non-zip and mod-less files are refused with a message');
    const folder = await importPicked([{ path: 'Pack/info.txt', file: new Blob([enc('Folder mod')]) }, { path: 'Pack/_data/menu/text000.tga', file: new Blob([big]) }], store);
    ok(folder.added.length === 1 && folder.added[0].title === 'Folder mod' && folder.added[0].files[0].path === '_data/menu/text000.tga', 'import: a picked folder');
    const cut = await importPicked([{ path: 'cut.zip', file: new Blob([zip.slice(0, 120)]) }], store);
    ok(cut.added.length === 0 && cut.errors.length === 1, 'import: a truncated zip is refused');
    const dmg = zip.slice();
    const idx = enc('Grass/_data/z03PPH/textures/text033.tga');
    const sAt = Buffer.from(zip).indexOf(Buffer.from(idx)) + idx.length + 2000;
    dmg[sAt] ^= 0x55;
    const nb = (await store.list()).length;
    const dres = await importPicked([{ path: 'dmg.zip', file: new Blob([dmg]) }], store);
    ok(dres.errors.length >= 1 && (await store.list()).length === nb + dres.added.length && dres.added.every((m) => m.title !== 'Grass'), 'import: a damaged member aborts that mod and leaves nothing half-written');

    // ---- effect report on the real EXE
    const em = new EffectMap(exeBytes);
    const p = (s) => parsePatchText(s).patches;
    const skies = p('4399FE;FFDD7F\n326E81;FFDD7F\n308517;FFDD7F\n307567;FFDD7F\n2BF958;FFDD7F\n2BE49E;FFDD7F\n22979B;FFDD7F\n21BAC3;FFDD7F\n21AAC9;FFDD7F\n13E013;FFDD7F\nB6B47;FFDD7F');
    ok(skies.every((x) => em.classify(x).effect === 'works' && /kleur/.test(em.classify(x).note)), 'effects: all 11 sky patches hit the zone fog / sky colour');
    const fuel = em.classify(p('00531EF8;00F69F46')[0]), skate = em.classify(p('90DC2;3333933F;0000403F')[0]);
    ok(fuel.effect === 'ignored' && /30 Hz/.test(fuel.note), 'effects: the bi-plane fuel fix is ignored (fixed 30 Hz)');
    ok(skate.effect === 'ignored', 'effects: the skateboard speed is a constant of the port');
    ok(em.classify(p('4A7834;0100000011;0400000002')[0]).effect === 'works', 'effects: a menu item of the page table counts');

    // ---- the Debug Mode: the Mod Manager's idea at the Dutch address, through the real menu code
    const dbgPatch = parsePatchText('4A7834;0100000011;0400000002').patches;
    const dbgExe = applyPatches(exeBytes, dbgPatch);
    ok(dbgExe.results[0].status === 'applied' && applyPatches(exeBytes, parsePatchText('572704;0100000011;0400000002').patches).results[0].status === 'mismatch', 'debug patch: applies at the Dutch address, a wrong-version offset is refused by its original bytes');
    const mkUi = (bytes, hits) => {
      const pe2 = new Pe(bytes);
      const mctx = { options: Options.fromExe(pe2), vars: new GameVars(), msgs: { label: (x) => x }, keyNames: new Map(), keyBits: [], rows: {}, sound() {}, slotHeader: () => null, captionId: () => null, storyNode: () => 0,
        cutsceneRunning: () => false, saveSlot: () => true, loadSlot: () => 0, eraseSlot() {}, newGame: () => true, keysChanged() {}, optionChanged() {}, measure: () => 10,
        checkpoints: readLevelSelect(pe2).checkpoints, gotoCheckpoint: (e) => hits.push(e) };
      return new MenuUi(mctx, readMenuPages(pe2));
    };
    const press = (ui, btn, n = 8) => { let r = 0; for (let i = 0; i < n && !r; i++) r = ui.step(i === 0 ? btn : 0); return r; };
    let hits = [];
    let ui = mkUi(exeBytes, hits); ui.open(0, 0, false); ui.engine.item = 3;
    ok(press(ui, B.ENTER) === MR.CREDITS, 'main menu unpatched: the third item is Credits');
    hits = []; ui = mkUi(dbgExe.data, hits); ui.open(0, 0, false); ui.engine.item = 3;
    press(ui, B.ENTER);
    ok(ui.engine.page === 17 && ui.engine.listCount === 37 && ui.engine.list[0].label === '!LEVFRE' && ui.engine.list[2].label === '!LEVLGI', `main menu patched: the third item opens the checkpoint list (page ${ui.engine.page}, ${ui.engine.listCount} entries)`);
    ui.engine.item = 40; // list entry 4 = record 3 = LGI node 7
    const res2 = press(ui, B.ENTER);
    ok(res2 === MR.ABANDON && hits.length === 1 && hits[0].zone === 2 && hits[0].node === 7, `choosing an entry hands zone / node to the shell and leaves the front end (${JSON.stringify(hits[0])})`);
    return { checked, failures };
  },
};
