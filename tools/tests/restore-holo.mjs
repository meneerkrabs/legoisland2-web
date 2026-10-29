// Restored feature 'holo' (src/restore/features/holo.ts): the hologram hints that duplicate `HOLOA` tags shadow (LIHOL9 681 vs 682, LIHOL6 177 vs 182). Node test: the original's binary search really returns
// the later duplicate; the state tests choose the shadowed line; the other letters, other tables (LIHOL16: unused, one line) and the feature off are untouched.
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { setIslandVars } from '../../src/restore/islandenv.ts';
import { resetHolo } from '../../src/restore/features/holo.ts';

const only = (id) => RESTORE_FEATURES.map((f) => f.id).filter((x) => x !== id);

export default {
  name: 'restore-holo',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const t9 = loadMessages(messages, ['LI/Data/LIHOL9.str']), t6 = loadMessages(messages, ['LI/Data/LIHOL6.str']), t16 = loadMessages(messages, ['LI/Data/LIHOL16.str']);
    const dups = (t) => t.entries.filter((e) => e.tag === 'HOLOA').map((e) => parseInt(e.field, 10));
    ok(dups(t9).join() === '681,682' && t9.voice('HOLOA') === 682, 'LIHOL9: HOLOA 681 is shadowed by 682 (the original\'s binary search returns the later one)');
    ok(dups(t6).join() === '177,182' && t6.voice('HOLOA') === 182, 'LIHOL6: HOLOA 177 is shadowed by 182');
    ok(dups(t16).join() === '685', 'LIHOL16: one HOLOA (685), selected by no band');

    forceRestored(true, only('holo'));
    ok(await loadRestore(), 'holo only: installed');
    const spoken = [];
    const speak = (ret = true) => (t, a, b) => { spoken.push([a, t.voice(a), t.raw(a)]); return ret; };
    const say = (t, id = 'HOLOA', ret = true) => { spoken.length = 0; const r = restoreHooks.say(t, id, undefined, speak(ret)); return { r, s: spoken.slice() }; };
    const vars = (pages, ctl, node = 33) => setIslandVars({ get: (i) => (i === 0xa5 ? pages : i === 0x5e ? ctl : i === 0x58 ? node : 0) });

    // ---- LIHOL9: 681 with the pages in hand on foot, else the shipped 682
    vars(2, 1);
    let r = say(t9);
    ok(r.r === true && r.s.length === 1 && r.s[0][1] === 681 && r.s[0][2] === t9.entries.find((e) => parseInt(e.field, 10) === 681).text, 'LIHOL9, 2 pages, on foot: speaks 681 (the shadowed line, its own text)');
    vars(2, 2); ok(say(t9).r === undefined, 'LIHOL9, in a vehicle: the shipped 682 (normal path)');
    vars(1, 1); ok(say(t9).r === undefined, 'LIHOL9, one page only: the shipped 682');
    setIslandVars(null); ok(say(t9).r === undefined, 'LIHOL9, no island known: the shipped 682');
    vars(2, 1); ok(say(t9, 'HOLOB').r === undefined, 'LIHOL9: HOLOB (683) is never touched');
    ok(say(t9, 'HOLOA', false).r === false, 'LIHOL9, busy channel: false (the hologram retries)');

    // ---- LIHOL6: 177 the first time, then the shipped 182
    resetHolo(); vars(0, 1, 8);
    r = say(t6); ok(r.r === true && r.s[0][1] === 177, 'LIHOL6, first HOLOA: 177');
    ok(say(t6).r === undefined, 'LIHOL6, second HOLOA: the shipped 182');
    ok(say(t6).r === undefined, 'LIHOL6, third HOLOA: the shipped 182');
    for (const L of 'BCDE') ok(say(t6, 'HOLO' + L).r === undefined, `LIHOL6: HOLO${L} untouched`);
    resetHolo(); ok(say(t6, 'HOLOA', false).r === false, 'LIHOL6, busy channel: false and NOT counted as seen');
    r = say(t6); ok(r.r === true && r.s[0][1] === 177, 'LIHOL6: still 177 after the busy attempt');

    // ---- LIHOL16 and the others
    ok(say(t16).r === undefined, 'LIHOL16 stays unused (one HOLOA: normal path)');
    let n = 0; for (const e of messages.entries) if (/LI\/Data\/LIHOL\d+\.str$/i.test(e.path) && !/LIHOL(9|6)\.str$/i.test(e.path)) { ok(say(loadMessages(messages, [e.path])).r === undefined, `${e.path}: untouched`); n++; }
    notes.push(`${n} other hologram tables pass through`);

    // ---- feature off
    forceRestored(true, RESTORE_FEATURES.map((f) => f.id));
    ok(await loadRestore() && say(t9).r === undefined && restoreHooks.messages('LI/Data/LIHOL9.str', t9) === t9, 'holo off: untouched');
    forceRestored(null); setIslandVars(null); for (const k of Object.keys(restoreHooks)) delete restoreHooks[k];
    return { checked, failures, notes };
  },
};
