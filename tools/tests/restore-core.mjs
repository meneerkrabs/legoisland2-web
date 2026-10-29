// Restored content R0 (src/restore/, docs/re/restore.md): with the option OFF nothing changes: no hook is set, nothing of src/restore/index.ts is loaded; with the option on but every feature switched
// off the hooks pass everything through unchanged (same message tables, same scripts, same sound / speech tables); the speech base matches the executable; overlay + rule P mechanics.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, restoredOn, restoredFeature, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { SPEECH_BASE, ORPHAN_NAMES, extendSpeech, overlay, line, orphanIndex } from '../../src/restore/overlay.ts';
import { patchText } from '../../src/restore/scripts.ts';
import { ORPHAN_LINES, DOUBTFUL_LINES } from '../../src/restore/lines.nl.ts';
import { loadMessages, MessageTable } from '../../src/ui/strings.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { compileCutscene } from '../../src/formats/cutscene.ts';

export default {
  name: 'restore-core',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const exe = fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe'));
    const hooksUnset = () => Object.values(restoreHooks).every((v) => v === undefined);

    // ---- option off (the default)
    forceRestored(null);
    ok(!restoredOn() && RESTORE_FEATURES.every((f) => !restoredFeature(f.id)), 'default: the option and every feature are off');
    ok(hooksUnset(), 'option off: no hook is set');
    ok((await loadRestore()) === false && hooksUnset(), 'option off: loadRestore loads nothing, hooks stay unset');
    const base = readAudioTables(exe);
    ok(base.speech.length === SPEECH_BASE, `SPEECH_BASE ${SPEECH_BASE} = the executable's speech table length (${base.speech.length})`);
    ok(new Set(ORPHAN_NAMES.map((n) => n.toUpperCase())).size === ORPHAN_NAMES.length, 'orphan names are unique');
    ok(DOUBTFUL_LINES.every((n) => n in ORPHAN_LINES), 'every doubtful line has a text');

    // ---- option on, every feature off: pass-through
    const allOff = RESTORE_FEATURES.map((f) => f.id);
    forceRestored(true, allOff);
    ok(restoredOn() && allOff.every((f) => !restoredFeature(f)), 'forced: option on, features off');
    ok(await loadRestore(), 'option on: loadRestore installs');
    const t2 = readAudioTables(exe);
    ok(JSON.stringify(t2.sounds) === JSON.stringify(base.sounds), 'all features off: the sound table is unchanged');
    ok(t2.speech.length === SPEECH_BASE && JSON.stringify(t2.speech) === JSON.stringify(base.speech), 'all features off: the speech table is unchanged');
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    let nTables = 0;
    for (const e of messages.entries) {
      if (!/\.str$/i.test(e.path)) continue;
      const t = loadMessages(messages, [e.path]);
      ok(restoreHooks.messages(e.path, t) === t, `all features off: ${e.path} is returned as it is`); nTables++;
    }
    let nScripts = 0;
    for (const a of ctx.archives) for (const e of a.entries) if (/^cutscene\/[^/]+\.cut$/i.test(e.path)) { ok(restoreHooks.script(a, a.name, path.basename(e.path, path.extname(e.path))) === undefined, `all features off: ${a.name}/${e.path} unpatched`); nScripts++; }
    let startCalled = 0;
    ok(restoreHooks.startCutscene(8, (s) => { startCalled = s; return true; }) === undefined && startCalled === 0, 'all features off: startCutscene passes through');
    ok(restoreHooks.cutsceneActive(false) === false && restoreHooks.cutsceneActive(true) === true, 'all features off: cutsceneActive passes the answer through');
    ok(restoreHooks.say(new MessageTable([]), 'X', undefined, () => true) === undefined, 'all features off: say passes through');
    notes.push(`${nTables} message tables, ${nScripts} scripts pass through unchanged`);

    // ---- mechanics (independent of features)
    const sp = base.speech.slice(); extendSpeech(sp);
    ok(sp.length === SPEECH_BASE + ORPHAN_NAMES.length && sp[SPEECH_BASE] === ORPHAN_NAMES[0], 'extendSpeech appends the orphans behind the table');
    ok(orphanIndex(ORPHAN_NAMES[3].toLowerCase()) === SPEECH_BASE + 3 && orphanIndex('NOSUCHLINE') === -1, 'orphanIndex');
    const t = new MessageTable([[{ tag: 'AAA', field: '12  ', text: 'oud' }, { tag: 'BBB', field: '-1  ', text: 'blijft' }]]);
    const ov = overlay(t, [line('AAA', ORPHAN_NAMES[0]), line('CCC', 5, 'nieuw')]);
    ok(ov.text('AAA') === ORPHAN_LINES[ORPHAN_NAMES[0]] && ov.voice('AAA') === SPEECH_BASE && ov.voice('CCC') === 5 && ov.text('BBB') === 'blijft' && ov.text('CCC') === 'nieuw', 'overlay replaces / adds tags, voice field carries the orphan index');
    // rule P on a toy script
    const toy = ['//10 0.0 a saytext X 20', '5 0.0 b saytext Y 30', '30 0.0 b saytext Z 40'].join('\n');
    const patched = patchText(toy, { zone: 'z', script: 't', unComment: [1], setNext: [{ line: 2, from: 30, to: 10 }], insert: [{ after: 3, lines: ['40 0.0 c saytext W 50'] }] });
    ok(patched.split('\n')[0] === '10 0.0 a saytext X 20' && patched.split('\n')[1].endsWith(' 10') && patched.split('\n')[3] === '40 0.0 c saytext W 50', 'patchText: un-comment, set next, insert');
    let threw = false; try { patchText(toy, { zone: 'z', script: 't', setNext: [{ line: 2, from: 99, to: 1 }] }); } catch { threw = true; }
    ok(threw, 'patchText refuses a line that is not what the patch expects');

    forceRestored(null);
    for (const k of Object.keys(restoreHooks)) delete restoreHooks[k];
    return { checked, failures, notes };
  },
};
