// Restored feature 'joke' (src/restore/features/joke.ts): the castle's three-line joke BAR2C - UNUSED(1293) - BAR2D and BAR4C - UNUSED(1303) - BAR4D. Node test: the state machine on the real table
// (speech indices 1292 / 1293 / 1294 and 1302 / 1303 / 1304), then the REAL SGMFIG code (an island NPC renamed BAR2, the real conversation / pending retry of src/island/npc/sgmfig.ts) with the hook
// wired into the mock context's `say`; the feature off leaves everything as it is.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs, SgmfigNode } from '../../src/island/npc/index.ts';
import { resetJoke, jokeStage } from '../../src/restore/features/joke.ts';

const only = (id) => RESTORE_FEATURES.map((f) => f.id).filter((x) => x !== id);
const SHIFT = 'ShiftLeft';

export default {
  name: 'restore-joke',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const path4 = 'CI/Data/CSIFSM4.str';
    const orig = loadMessages(messages, [path4]);
    const dir = path.join(ctx.dataDir, 'sounds', 'speech', 'Data');
    ok(!fs.existsSync(dir) || fs.existsSync(path.join(dir, 'CAJOBB12.mp3')), 'CAJOBB12.mp3 (the middle line) exists');
    ok(orig.entries.filter((e) => e.tag === 'UNUSED').map((e) => parseInt(e.field, 10)).sort().join() === '1293,1303', 'original: two UNUSED lines, 1293 / 1303');

    // ---- the state machine on the real table
    forceRestored(true, only('joke'));
    ok(await loadRestore(), 'joke only: installed');
    const T = restoreHooks.messages(path4, orig);
    ok(T === orig, 'no message overlay (the lines are the table\'s own)');
    const spoken = [];
    const speak = (ret = true) => (t, a, b) => { spoken.push([a, b ?? null, t.voice(a), b ? t.voice(b) : null, t.raw(a), b ? t.raw(b) : null]); return ret; };
    for (const [n, c, m, d] of [['BAR2', 1292, 1293, 1294], ['BAR4', 1302, 1303, 1304]]) {
      resetJoke(); spoken.length = 0;
      ok(restoreHooks.say(T, `${n}A`, undefined, speak()) === undefined && spoken.length === 0, `${n}A: the original path`);
      const r1 = restoreHooks.say(T, `${n}C`, `${n}D`, speak());
      ok(r1 === false && spoken.length === 1 && spoken[0][2] === c && spoken[0][3] === m && spoken[0][5] === orig.entries.find((e) => e.tag === 'UNUSED' && parseInt(e.field, 10) === m).text && jokeStage(n) === 1, `${n}: first request speaks C (${c}) + the middle line (${m}) and returns false (the NPC asks again when idle)`);
      const r2 = restoreHooks.say(T, `${n}C`, `${n}D`, speak());
      ok(r2 === true && spoken.length === 2 && spoken[1][0] === `${n}D` && spoken[1][1] === null && spoken[1][2] === d && jokeStage(n) === 0, `${n}: the retry speaks D (${d}) alone, true`);
      // a busy channel at the first request: nothing advances
      resetJoke(); spoken.length = 0;
      ok(restoreHooks.say(T, `${n}C`, `${n}D`, speak(false)) === false && jokeStage(n) === 0, `${n}: busy speech channel: stage stays 0`);
      // a skipped conversation: the next talk starts with A, which resets
      restoreHooks.say(T, `${n}C`, `${n}D`, speak()); ok(jokeStage(n) === 1, `${n}: stage 1`);
      restoreHooks.say(T, `${n}A`, undefined, speak()); ok(jokeStage(n) === 0, `${n}: a request for A starts over`);
    }
    ok(restoreHooks.say(T, 'BAR1C', undefined, speak()) === undefined && restoreHooks.say(T, 'LAR1C', 'LAR1D', speak()) === undefined, 'other figures pass through');
    const noJoke = loadMessages(messages, ['CI/Data/CSIFSM3.str']);
    ok(restoreHooks.say(noJoke, 'BAR2C', 'BAR2D', speak()) === undefined, 'a table without the middle line passes through');

    // ---- the real SGMFIG conversation
    const run = (withHook) => {
      resetJoke();
      const I = loadIsland(ctx, { node: 2, npcFile: 'LI/Data/lifsm1.str' });
      loadIslandWalkMaps(I.archive, I.profile.island); startIslandNpcs(I.world);
      const rec = I.rec('INFO'); rec.name = 'BAR2';
      const sg = rec.ctrl.nodes.find((n) => n instanceof SgmfigNode);
      const raw = I.ictx.say;
      I.ictx.text.npc = orig;
      if (withHook) I.ictx.say = function (t, a, b) { const r = restoreHooks.say?.(t, a, b, (tt, aa, bb) => raw.call(I.ictx, tt, aa, bb)); return r ?? raw.call(I.ictx, t, a, b); };
      const p = I.pepper;
      const place = () => { const a = rec.ry; p.x = rec.x + Math.sin(a) * 4; p.z = rec.z + Math.cos(a) * 4; p.y = rec.y; p.ry = Math.atan2(rec.x - p.x, rec.z - p.z); p.rebuildYaw(); };
      const talk = () => { place(); tick(I, 2); place(); tick(I, 1); press(I, SHIFT); let n = 0; while ((sg.talk & 0x40) && n < 1500) { tick(I, 1); n++; } return n; };
      I.ictx.said.length = 0;
      talk(); talk();
      return I.ictx.said.map((s) => `${s.id}${s.id2 ? '+' + s.id2 : ''}`);
    };
    const withJoke = run(true), without = run(false);
    ok(JSON.stringify(withJoke) === JSON.stringify(['BAR2A', 'BAR2C+BAR2M', 'BAR2D']), `SGMFIG, feature on: said ${withJoke.join(' | ')}`);
    ok(JSON.stringify(without) === JSON.stringify(['BAR2A', 'BAR2C+BAR2D']), `SGMFIG, hook not applied: the original says ${without.join(' | ')}`);
    notes.push(`SGMFIG conversation with the joke: ${withJoke.join(' | ')}; original: ${without.join(' | ')}`);

    // ---- feature off
    forceRestored(true, RESTORE_FEATURES.map((f) => f.id));
    ok(await loadRestore(), 'all off: installed');
    ok(restoreHooks.say(orig, 'BAR2C', 'BAR2D', speak()) === undefined, 'joke off: say passes through');
    forceRestored(null); for (const k of Object.keys(restoreHooks)) delete restoreHooks[k];
    return { checked, failures, notes };
  },
};
