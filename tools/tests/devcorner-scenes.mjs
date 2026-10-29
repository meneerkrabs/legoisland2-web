// Ontwikkelaarshoek, section 10 (scenes / animaties): src/devcorner/scenes-data.ts against docs/re/unused.md 7.4 / 8.7: every .cut and .man of every archive parses with the listing code,
// 87 compiled scripts, adv06 the only unreferenced one, csi03 a .txt stub, empty LGICI05-07, 76 + 5 + 1 unreferenced .man, 50 of 141 .cam, and the F9 "Choose cut-scene" logic
// (FUN_00458b71 list, FUN_00458bf8 / FUN_00458d15 choose) on the port's real cutscene runner.
import { loadExe } from '../lib/engine-load.mjs';
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { parseMan } from '../../src/formats/anim.ts';
import { CutsceneRunner } from '../../src/shell/cutscene.ts';
import { World } from '../../src/game/world.ts';
import { GameRecord } from '../../src/game/record.ts';
import { exeTextIndex } from '../../src/devcorner/text-data.ts';
import * as D from '../../src/devcorner/scenes-data.ts';
import { makeFlyPath, viewAt } from '../../src/devcorner/scenes-fly.ts';

export default {
  name: 'devcorner-scenes',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const pe = loadExe(ctx.dataRoot);
    const exe = D.exeNames(exeTextIndex(pe).strings.keys());
    const arc = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
    const cutArcs = D.CUTSCENE_ARCHIVES.map(arc);
    const rows = D.cutRows(cutArcs, exe);
    const scripts = rows.filter((r) => r.hasCut);
    ok(scripts.length === 87, `compiled scripts ${scripts.length}`);
    ok(rows.every((r) => !r.error), `parse errors: ${rows.filter((r) => r.error).map((r) => r.key + ' ' + r.error)}`);
    ok(rows.length - scripts.length === 52, `sources without .cut ${rows.length - scripts.length}`);
    // listing of every script
    for (const r of scripts) {
      const a = arc(r.archive), cut = parseCutscene(a.read(a.find(r.cutPath)));
      const l = D.listing(cut);
      ok(l.length === cut.commands.length && l.every((x) => x.command && typeof x.args === 'string'), `${r.key}: listing`);
      ok(D.listingText(cut).split('\n').length === Math.max(1, l.length) || l.length === 0, `${r.key}: listing text`);
    }
    // referenced / unreferenced
    const unref = scripts.filter((r) => !r.exeNamed).map((r) => r.name);
    ok(unref.join() === 'adv06', `unreferenced scripts: ${unref}`);
    const adv = rows.find((r) => r.key === 'z23DIP/adv06');
    ok(adv.commands === 9 && adv.scriptName.toUpperCase() === 'TREXCOMMUNICATION' && adv.sayCount === 3 && adv.textIds.join() === 'ADCSTR01', `adv06: ${adv.commands} cmds, ${adv.scriptName}, ${adv.textIds}`);
    ok(D.badgesOf(adv).some((b) => b.text === 'niet gerefereerd'), 'adv06 badge');
    const csi03 = rows.find((r) => r.key === 'z07CSI/csi03');
    ok(csi03 && !csi03.hasCut && csi03.stub && D.badgesOf(csi03).some((b) => b.text === 'verouderde stub'), 'csi03 is a NO LONGER USED stub (.txt only)');
    const empt = scripts.filter((r) => r.commands === 0).map((r) => r.name).sort().join();
    ok(empt === 'lgici05,lgici06,lgici07', `empty scripts ${empt}`);
    ok(D.badgesOf(rows.find((r) => r.name === 'lgi11')).some((b) => b.text.startsWith('nooit gestart')), 'lgi11 flagged by the research list');
    ok(rows.filter((r) => r.psx).length >= 40, 'psx variants');
    ok(D.badgesOf(rows.find((r) => r.name === 'csi02a')).some((b) => b.text === 'gerefereerd'), 'csi02a is referenced (EXE string)');
    // message file choice
    ok(D.pickStrings('x', ['ADCSTR01'], [{ path: 'AI/Data/ADV07.str', area: 'AI', stem: 'ADV07', tags: new Set(['ADCSTR01']) }]).file?.stem === 'ADV07', 'pickStrings best hit');

    // .man / .cam
    const corp = new Map(cutArcs.map((a) => [a.name, D.scriptCorpus(a, exe)]));
    const f = D.fileRows(ctx.archives, exe, corp, D.usedSplines(cutArcs, exe));
    const un = (a) => f.man.filter((r) => r.ref === null && r.archive === a).length;
    ok(f.man.length === 164, `man files ${f.man.length}`);
    ok(un('z02LGI') === 76 && un('z40OGL') === 5 && un('z40aPO') === 1, `unreferenced man ${un('z02LGI')} / ${un('z40OGL')} / ${un('z40aPO')}`);
    ok(f.man.filter((r) => r.ref === null).length === 82, 'unreferenced man total 82');
    ok(f.man.find((r) => r.name.toLowerCase() === 'cam_bbfly1').ref === null && f.man.find((r) => r.name === 'pepInShuttle')?.ref === null, 'cam_bbfly1 and pepinshuttle unreferenced');
    ok(f.man.find((r) => r.name.toLowerCase() === 'bat').ref === 'exe-pad' && f.man.find((r) => r.name.toLowerCase() === 'page1a').ref === 'script', 'bat = EXE path, page1a = script spline');
    ok(f.cam.length === 141 && f.cam.filter((r) => r.ref === null).length === 50, `cam ${f.cam.length} / ${f.cam.filter((r) => r.ref === null).length}`);
    // every .man parses, info + flight path sampler
    let bad = 0;
    for (const r of f.man) {
      const a = arc(r.archive), m = D.readMan(a, r.path);
      if (!m) { bad++; continue; }
      const i = D.manInfo(r.name, m);
      if (!(i.keys > 0 && i.seconds > 0 && i.min.every(Number.isFinite) && i.max.every(Number.isFinite))) bad++;
    }
    ok(bad === 0, `${bad} .man failed`);
    const lgi = arc('z02LGI');
    const e = lgi.entries.find((x) => /cam_bbfly1\.man$/i.test(x.path));
    const m = parseMan(lgi.read(e));
    const p = makeFlyPath('z02LGI', 'cam_bbfly1', m, null);
    const v0 = viewAt(p, 0, 'camera'), v1 = viewAt(p, 1, 'camera');
    ok(p.kind === 'camera' && v0.eye.every(Number.isFinite) && v1.target.every(Number.isFinite) && Math.hypot(...v0.eye.map((x, k) => x - v1.eye[k])) > 1, 'cam_bbfly1 flight samples');
    ok(D.targetPartner('bbcrashcam01', new Set(['bbcrashtarg01'])) === 'bbcrashtarg01', 'partner');
    ok(D.manKind('chopperchasecam', 1) === 'camera' && D.manKind('x', 4) === 'meerdere', 'kinds');

    // F9 list + choose on the real runner
    ok(pe.cstr(D.F9_NOT_LOADED_VA) === 'Not loaded', 'string at 0x8b8698');
    const w = new World();
    const rec = new GameRecord('PEPP'); rec.index = 0; w.records.push(rec);
    const env = { world: w, waypoint: () => null, text: (i) => i, say: () => false, speechIdle: () => true, stopSpeech() {}, setFov() {}, getFov: () => 1, skipPressed: () => false, speechOn: () => false, textOn: () => true, letterbox() {}, random: () => 0.5 };
    const r = new CutsceneRunner(env);
    r.allocate(3);
    const a = arc('z23DIP'), cut = parseCutscene(a.read(a.find('cutscene/adv06.cut')));
    r.define(1, 'adv06', cut);
    ok(D.f9List(D.runnerSlots(r), 'Not loaded').join() === 'Not loaded,adv06,Not loaded', `f9 list ${D.f9List(D.runnerSlots(r))}`);
    w.vars.set(0xb, 1);
    const t = D.f9Target(r, w.vars);
    ok(D.f9Choose(t, 7) === 'buiten-lijst', 'idx beyond the list');
    ok(D.f9Choose(t, 1) === 'gestart' && r.active() && w.vars.get(0xb) === 1, 'choose starts although var 0xb is set (and restores it)');
    ok(D.f9Choose(t, 1) === 'bezig', 'a running script blocks the click (DAT_05d47908 == 1)');
    r.abort();
    ok(r.start(1) === false, 'FUN_0045c40c path refuses with var 0xb set (contrast)');
    notes.push(`${scripts.length} scripts, ${rows.length - scripts.length} sources, man unreferenced 76/5/1, cam 50/141`);
    return { checked, failures, notes };
  },
};
