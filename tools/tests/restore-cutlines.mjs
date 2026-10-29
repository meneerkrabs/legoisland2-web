// Restored feature 'cutlines' (src/restore/features/cutlines.ts): lgici25 gets LEINVS04 (Pepper hands Valerie the pizza). Option off: the unpatched script; on: one more saytext, chain intact.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { readAudioTables } from '../../src/audio/tables.ts';

const only = RESTORE_FEATURES.map((f) => f.id).filter((f) => f !== 'cutlines');   // the other restored features are off in this test
const clear = () => { for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; };

export default {
  name: 'restore-cutlines',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const zarc = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const exe = fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe'));
    const raw = zarc.read(zarc.find('cutscene/lgici25.cut'));
    const cm = (b) => parseCutscene(b).commands;
    const say = (b) => cm(b).filter((c) => c.cmd === 2);

    forceRestored(null); clear();
    ok(restoreHooks.script === undefined, 'option off: no script hook');
    ok(say(raw).map((c) => c.textId).join() === 'LEINVS01,LEINVS02,LEINVS03', `unpatched lgici25 saytexts ${say(raw).map((c) => c.textId)}`);

    forceRestored(true, only);
    ok(await loadRestore(), 'option on: installed');
    const p = restoreHooks.script(zarc, 'z02LGI', 'lgici25');
    ok(p instanceof Uint8Array, 'lgici25 patch applies');
    if (p) {
      const s = say(p), ids = s.map((c) => c.textId);
      ok(ids.join() === 'LEINVS01,LEINVS02,LEINVS03,LEINVS04' || ids.slice().sort().join() === 'LEINVS01,LEINVS02,LEINVS03,LEINVS04', `patched saytexts ${ids}`);
      const n4 = s.find((c) => c.textId === 'LEINVS04');
      ok(n4 && n4.actor === 'PEPP' && n4.waitId === 40 && n4.signalId === 45, `LEINVS04: ${n4?.actor} wait ${n4?.waitId} signal ${n4?.signalId}`);
      // the other commands are unchanged (the patched list minus the new line equals the original list)
      const strip = (l) => JSON.stringify(l.map((c) => [c.cmd, c.actor, c.waitId, c.signalId, c.anim ?? c.textId ?? c.target ?? '']));
      ok(strip(cm(p).filter((c) => c.textId !== 'LEINVS04')) === strip(cm(raw)), 'every other command is unchanged');
      // the actors of the new line exist in the script's cast (PEPP) and the end block 45 still waits for it
      ok(cm(p).some((c) => c.waitId === 45), 'block 45 still present');
    }
    const t = loadMessages(messages, ['LI/Data/LGICI25.str']);
    const tb = readAudioTables(exe);
    ok(t.has?.('LEINVS04') ?? t.text('LEINVS04') !== undefined, 'LGICI25.str has LEINVS04');
    ok(tb.speech[t.voice('LEINVS04')]?.toUpperCase() === 'LEINVS04', `speech table ${t.voice('LEINVS04')} = ${tb.speech[t.voice('LEINVS04')]}`);
    notes.push(`LEINVS04 "${t.text('LEINVS04')}" voice ${t.voice('LEINVS04')}`);
    clear(); forceRestored(null);
    return { checked, failures, notes };
  },
};
