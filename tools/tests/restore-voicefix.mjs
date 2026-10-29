// Restored features 'voicefix' (TBOBA -> LEBEAA07) and 'voiceswap' (NICKA / LICKA -> LEPHAA03 / 04): overlay of the original tables, only the named tags change, separate feature ids, off = untouched.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { SPEECH_BASE, ORPHAN_NAMES } from '../../src/restore/overlay.ts';
import { ORPHAN_LINES, DOUBTFUL_LINES } from '../../src/restore/lines.nl.ts';
import { loadMessages } from '../../src/ui/strings.ts';

const only = (...ids) => RESTORE_FEATURES.map((f) => f.id).filter((x) => !ids.includes(x));
const idx = (n) => SPEECH_BASE + ORPHAN_NAMES.indexOf(n);

export default {
  name: 'restore-voicefix',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const p5 = 'LI/Data/LIFSM5.str', p2 = 'LI/Data/LIFSM2.str';
    const t5 = loadMessages(messages, [p5]), t2 = loadMessages(messages, [p2]);
    const dir = path.join(ctx.dataDir, 'sounds', 'speech', 'Data');
    const mp3 = (n) => !fs.existsSync(dir) || fs.existsSync(path.join(dir, n + '.mp3'));
    /** every tag of `b` other than `skip` is the same entry as in `a` */
    const sameBut = (a, b, skip) => a.entries.length === b.entries.length + 0 && a.entries.every((e) => skip.includes(e.tag) || b.find(e.tag)?.text === e.text && b.voice(e.tag) === a.voice(e.tag));
    const install = async (...ids) => { for (const k of Object.keys(restoreHooks)) delete restoreHooks[k]; forceRestored(true, only(...ids)); ok(await loadRestore(), `installed ${ids.join('+')}`); };

    // original facts the repair rests on
    ok(t5.voice('TBOBA') === 520 && t5.voice('TBOBC') === 500 && t5.raw('TBOBA') === t5.raw('TBOBC'), 'original: TBOBA carries 520 (= the C clip LEBEBB07) and repeats TBOBC\'s text');
    ok(t2.voice('NICKA') === 362 && t2.voice('LICKA') === 363, 'original: NICKA 362 / LICKA 363 (the band-1 clips)');

    // ---- voicefix only
    await install('voicefix');
    const f5 = restoreHooks.messages(p5, t5), f2 = restoreHooks.messages(p2, t2);
    ok(f5.voice('TBOBA') === idx('LEBEAA07') && f5.raw('TBOBA') === ORPHAN_LINES.LEBEAA07, 'voicefix: TBOBA speaks LEBEAA07 with its subtitle');
    ok(f5.voice('TBOBC') === 500 && f5.raw('TBOBC') === t5.raw('TBOBC'), 'voicefix: TBOBC unchanged');
    ok(sameBut(t5, f5, ['TBOBA']), 'voicefix: every other line of LIFSM5 is the original\'s');
    ok(f2 === t2, 'voicefix: LIFSM2 is returned as it is');
    ok(DOUBTFUL_LINES.includes('LEBEAA07'), 'LEBEAA07 is flagged doubtful');
    ok(mp3('LEBEAA07'), 'LEBEAA07.mp3 exists');

    // ---- voiceswap only
    await install('voiceswap');
    const s5 = restoreHooks.messages(p5, t5), s2 = restoreHooks.messages(p2, t2);
    ok(s5 === t5, 'voiceswap: LIFSM5 is returned as it is');
    ok(s2.voice('NICKA') === idx('LEPHAA03') && s2.voice('LICKA') === idx('LEPHAA04') && s2.raw('NICKA') === ORPHAN_LINES.LEPHAA03 && s2.raw('LICKA') === ORPHAN_LINES.LEPHAA04, `voiceswap: NICKA / LICKA speak LEPHAA03 / 04 with their subtitles (${s2.voice('NICKA')} ${s2.voice('LICKA')} ${idx('LEPHAA03')} ${idx('LEPHAA04')} ${s2.text('NICKA')})`);
    ok(sameBut(t2, s2, ['NICKA', 'LICKA']) && s2.voice('NICKC') === t2.voice('NICKC') && s2.voice('DARRA') === t2.voice('DARRA'), 'voiceswap: every other line of LIFSM2 is the original\'s');
    ok(mp3('LEPHAA03') && mp3('LEPHAA04'), 'LEPHAA03 / 04 mp3 exist');

    // ---- both off
    await install();   // every feature off
    ok(restoreHooks.messages(p5, t5) === t5 && restoreHooks.messages(p2, t2) === t2, 'both off: the original tables');

    forceRestored(null); for (const k of Object.keys(restoreHooks)) delete restoreHooks[k];
    return { checked, failures, notes };
  },
};
