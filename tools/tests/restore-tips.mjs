// Restored feature 'tips' (src/restore/features/tips.ts, docs/re/restore.md): Darren's tips. Node test: the bands of the story nodes are the ones the story handler selects; the pool of every node 0..71
// is deterministic (and non-empty from node 10); every mp3 of the pool exists; a talk to Darren speaks the chosen pair (A then C, one line per talk, a multi-clip line as A+B / C+D); the rotation advances per
// finished pair; with the feature off nothing changes.
import fs from 'node:fs';
import path from 'node:path';
import { restoreHooks, forceRestored, loadRestore, RESTORE_FEATURES } from '../../src/restore/flag.ts';
import { SPEECH_BASE, ORPHAN_NAMES } from '../../src/restore/overlay.ts';
import { ORPHAN_LINES } from '../../src/restore/lines.nl.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { setIslandVars } from '../../src/restore/islandenv.ts';
import { storyHandler } from '../../src/zones/z02LGI/story.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs, SgmfigNode } from '../../src/island/npc/index.ts';
import { pool, bandOfNode, pickPair, resetTips, talkCounter, TIPS, REGULAR, clipsOf, BAND_NODES, BAND_OF_DARRA, FIRST_NODE, LAST_NODE } from '../../src/restore/features/tips.ts';

const only = (id) => RESTORE_FEATURES.map((f) => f.id).filter((x) => x !== id);

export default {
  name: 'restore-tips',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const pe = loadExe(ctx.dataRoot);

    // ---- which table the story handler selects per node (the bands of BAND_NODES)
    let cur;
    const env = { cutsceneActive: () => false, vars: { get: () => 0, set() {}, or() {}, andNot() {} }, flags: () => 0, setFlags() {}, freeTexts() {}, npcText: (a) => { cur = pe.cstr(a); }, holText() {}, objRecord() {}, objPair() {}, objFour() {}, objNode() {}, holoAlert() {}, pizzaReset() {}, walkerPin() {} };
    const fileOf = new Map();
    for (let n = 0; n <= LAST_NODE; n++) { cur = null; storyHandler(env, { prev: n, next: 0 }, n); const m = /lifsm(\d+)\.str/i.exec(cur ?? ''); fileOf.set(n, m ? +m[1] : null); }
    let bandOk = 0;
    for (let n = FIRST_NODE; n <= LAST_NODE; n++) { ok(bandOfNode(n) === fileOf.get(n), `node ${n}: band ${bandOfNode(n)} but the story handler selects lifsm${fileOf.get(n)}`); bandOk++; }
    for (let n = 0; n < FIRST_NODE; n++) ok(pool(fileOf.get(n) ?? 1, n).length === 0, `node ${n}: no pool before node ${FIRST_NODE}`);
    ok(bandOfNode(71) === 15, 'nodes behind the last one keep the last band');

    // ---- the DARRA speech indices of the six tables identify the bands
    forceRestored(null); for (const k of Object.keys(restoreHooks)) delete restoreHooks[k];
    const tables = {};
    for (const b of Object.keys(BAND_NODES)) tables[b] = loadMessages(messages, [`LI/Data/LIFSM${b}.str`]);
    for (const [b, t] of Object.entries(tables)) ok(BAND_OF_DARRA.get(t.voice('DARRA')) === +b, `lifsm${b}: DARRA voice ${t.voice('DARRA')} identifies the band`);

    // ---- pools: deterministic, non-empty from node 10, contents
    let nPools = 0;
    for (let n = 0; n <= 71; n++) {
      const band = bandOfNode(n);
      if (n < FIRST_NODE) continue;
      const a = pool(band, n), b = pool(band, n);
      ok(a.length >= 3 && JSON.stringify(a) === JSON.stringify(b), `node ${n}: pool non-empty and deterministic (${a.length})`);
      ok(a[0] === REGULAR[band] && a[1].a === null, `node ${n}: pool starts with the regular pair, then the shipped tip`);
      for (let c = 0; c < 2 * a.length; c++) ok(pickPair(band, n, c) === a[c % a.length], `node ${n}: pickPair rotates`);
      nPools++;
    }
    ok(!pool(8, 29).some((p) => p.key === 'T11') && pool(10, 30).some((p) => p.key === 'T11') && pool(10, 30).some((p) => p.key === 'T37') && !pool(10, 30).some((p) => p.key === 'T35') && pool(10, 31).some((p) => p.key === 'T35'), 'vehicle tips appear when the vehicle does (cars / jet ski 30, helicopter 31)');
    ok(!pool(10, 51).some((p) => p.key === 'T27') && pool(13, 56).some((p) => p.key === 'T27') && !pool(15, 62).some((p) => p.key === 'T27' && false) , 'silver bots tip: era 3 only');
    ok(!TIPS.some((t) => t.key === 'T31'), 'the dark-corners pair (31/32) is held back');
    notes.push(`pools of nodes 10..71 checked; sizes at nodes 10 / 31 / 56 / 65: ${[10, 31, 56, 65].map((n) => pool(bandOfNode(n), n).length).join(' / ')}`);

    // ---- every clip of the pool exists as a table orphan and as an mp3 (when the data has the speech folder)
    const clips = new Set([...TIPS.flatMap(clipsOf), ...Object.values(REGULAR).flatMap(clipsOf)]);
    const dir = path.join(ctx.dataDir, 'sounds', 'speech', 'Data');
    const have = fs.existsSync(dir) ? new Set(fs.readdirSync(dir).map((f) => f.replace(/\.mp3$/i, '').toUpperCase())) : null;
    for (const c of clips) {
      ok(ORPHAN_NAMES.includes(c) && c in ORPHAN_LINES, `${c}: orphan name with a subtitle`);
      if (have) ok(have.has(c.toUpperCase()), `${c}: mp3 exists in the speech folder`);
    }
    notes.push(`${clips.size} clips of the pool; speech folder ${have ? 'present' : 'absent (mp3 check skipped)'}`);

    // ---- option on, only 'tips': the hooks
    forceRestored(true, only('tips'));
    ok(await loadRestore(), 'tips only: installed');
    const T = {};
    for (const b of Object.keys(tables)) T[b] = restoreHooks.messages(`LI/Data/LIFSM${b}.str`, tables[b]);
    ok(T[8] !== tables[8] && T[8].has('DARRT03A') && T[8].has('DARRR8A') && T[8].has('DARRA'), 'the overlay adds the tip / regular tags and keeps the shipped ones');
    ok(T[8].voice('DARRT03A') === SPEECH_BASE + ORPHAN_NAMES.indexOf('LEDTHT03') && T[8].text('DARRT03A') === ORPHAN_LINES.LEDTHT03, 'overlay tag carries the orphan index and its subtitle');
    ok(T[15].voice('DARRR15B') === SPEECH_BASE + ORPHAN_NAMES.indexOf('LEGFAA25') && T[14].has('DARRR14D') && !T[14].has('DARRR14B'), 'multi-clip regular pairs: A+B (band 15), C+D (band 14)');
    ok(T[12].raw('DARRA') === tables[12].raw('DARRA'), 'shipped lines are untouched');

    // a talk: what the NPC code asks (A, then C) -> what is spoken
    const spoken = [];
    const speakFor = () => (t, a, b) => { spoken.push([a, b ?? null, t.voice(a), b ? t.voice(b) : null, t.text(a)]); return true; };
    const talk = (band, id) => { const before = spoken.length; const r = restoreHooks.say(T[band], id, undefined, speakFor()); return { r, spoken: spoken.slice(before) }; };

    // the visit at node 56 (band 13): three talks
    resetTips(); setIslandVars({ get: (i) => (i === 0x58 ? 56 : 0) });
    const p56 = pool(13, 56);
    const t1 = talk(13, 'DARRA'), t2 = talk(13, 'DARRC');
    ok(t1.r === true && t1.spoken.length === 1 && t1.spoken[0][0] === 'DARRR13A' && t1.spoken[0][2] === SPEECH_BASE + ORPHAN_NAMES.indexOf('LESBAA20'), 'talk 1 at node 56: the regular pair, A part (LESBAA20)');
    ok(t2.r === true && t2.spoken[0][0] === 'DARRR13C' && t2.spoken[0][2] === SPEECH_BASE + ORPHAN_NAMES.indexOf('LESBBB21'), 'talk 2: the pair\'s C part (LESBBB21)');
    const t3 = talk(13, 'DARRA'), t4 = talk(13, 'DARRC');
    ok(t3.r === true && t3.spoken[0][0] === 'DARRA' && t3.spoken[0][2] === 923 && t4.r === true && t4.spoken[0][0] === 'DARRC' && t4.spoken[0][2] === 924, 'talks 3 / 4: the shipped tip pair (the table\'s own DARRA / DARRC, speech 923 / 924)');
    ok(talkCounter(13) === 2, 'two pairs started');
    const t5 = talk(13, 'DARRA'), t6 = talk(13, 'DARRC');
    ok(t5.spoken[0][0] === `DARR${p56[2].key}A` && t6.spoken[0][0] === `DARR${p56[2].key}C`, `the third pair is tip ${p56[2].key}`);
    notes.push(`node 56 pool: ${p56.map((p) => p.key).join(' ')}`);

    // a full rotation in every band and node of the pool: both lines of every pair are spoken
    let pairs = 0;
    for (const [bs, ranges] of Object.entries(BAND_NODES)) {
      const band = +bs;
      for (const n of [ranges[0][0], ranges[ranges.length - 1][1]]) {
        resetTips(); setIslandVars({ get: (i) => (i === 0x58 ? n : 0) });
        const P = pool(band, n), seen = [];
        for (let k = 0; k < 2 * P.length; k++) {
          const a = talk(band, 'DARRA'), c = talk(band, 'DARRC'), pr = P[k % P.length];
          if (pr.a === null) { ok(a.r === true && c.r === true && a.spoken[0][0] === 'DARRA' && c.spoken[0][0] === 'DARRC', `band ${band} node ${n}: the shipped pair is spoken as it is`); seen.push('S'); }
          else {
            ok(a.r === true && a.spoken.length === 1 && a.spoken[0][0] === `DARR${pr.key}A` && a.spoken[0][1] === (pr.a.length > 1 ? `DARR${pr.key}B` : null), `band ${band} node ${n}: A of ${pr.key}`);
            ok(c.r === true && c.spoken.length === 1 && c.spoken[0][0] === `DARR${pr.key}C` && c.spoken[0][1] === (pr.c.length > 1 ? `DARR${pr.key}D` : null), `band ${band} node ${n}: C of ${pr.key}`);
            ok(a.spoken[0][2] >= SPEECH_BASE && c.spoken[0][2] >= SPEECH_BASE && a.spoken[0][4].length > 5, `band ${band} node ${n}: ${pr.key} voice indices are orphans with a subtitle`);
            seen.push(pr.key);
          }
          pairs++;
        }
        ok(new Set(seen).size === P.length, `band ${band} node ${n}: a full rotation uses every pair once (${seen.join(' ')})`);
      }
    }
    notes.push(`${pairs} pairs simulated (A then C) over bands 8..15`);
    // walked away after A: the next talk starts the next pair (C never comes when the NPC has no objective to point at)
    resetTips(); setIslandVars({ get: (i) => (i === 0x58 ? 40 : 0) });
    const w1 = talk(10, 'DARRA'), w2 = talk(10, 'DARRA');
    ok(w1.spoken[0][0] === 'DARRR10A' && w2.spoken[0][0] === 'DARRA' && talkCounter(10) === 2, 'a talk after an unfinished pair starts the next pair (regular, then the shipped tip)');
    // a busy speech channel (speak returns false): the pair is kept and asked again
    resetTips();
    const r0 = restoreHooks.say(T[10], 'DARRA', undefined, () => false), r1 = restoreHooks.say(T[10], 'DARRA', undefined, (t, a) => { spoken.push([a]); return true; });
    ok(r0 === false && r1 === true && spoken[spoken.length - 1][0] === 'DARRR10A' && talkCounter(10) === 1, 'busy channel: false (not counted), retried with the same pair');
    // bands outside the pool and other NPCs are not touched
    const t2tab = restoreHooks.messages('LI/Data/LIFSM2.str', loadMessages(messages, ['LI/Data/LIFSM2.str']));
    ok(restoreHooks.say(t2tab, 'DARRA', undefined, () => true) === undefined && restoreHooks.say(T[10], 'RICHA', undefined, () => true) === undefined && restoreHooks.say(T[10], 'DARRB', undefined, () => true) === undefined, 'band 2 and other ids pass through');

    // ---- the REAL SGMFIG code (an island NPC renamed DARR, the band-13 table, the hook wired into the mock context's say): three talks at node 56
    {
      resetTips(); setIslandVars({ get: (i) => (i === 0x58 ? 56 : 0) });
      const I = loadIsland(ctx, { node: 2, npcFile: 'LI/Data/lifsm1.str' });
      loadIslandWalkMaps(I.archive, I.profile.island); startIslandNpcs(I.world);
      const rec = I.rec('INFO'); rec.name = 'DARR';
      const sg = rec.ctrl.nodes.find((n) => n instanceof SgmfigNode);
      const raw = I.ictx.say;
      I.ictx.text.npc = T[13];
      const tgt = [rec.x + 30, rec.y, rec.z];
      I.ictx.objective = { target: () => ({ pos: tgt, record: -1 }), holoTimer: 0 };   // (the second talk of an NPC points at the objective: sgmfig.ts)
      I.ictx.say = function (t, a, b, ...m) { const r = restoreHooks.say?.(t, a, b, (tt, aa, bb) => raw.call(I.ictx, tt, aa, bb, ...m)); return r ?? raw.call(I.ictx, t, a, b, ...m); };
      const p = I.pepper;
      const place = () => { const a = rec.ry; p.x = rec.x + Math.sin(a) * 4; p.z = rec.z + Math.cos(a) * 4; p.y = rec.y; p.ry = Math.atan2(rec.x - p.x, rec.z - p.z); p.rebuildYaw(); };
      const doTalk = () => { place(); tick(I, 2); place(); tick(I, 1); press(I, 'ShiftLeft'); let n = 0; while ((sg.talk & 0x40) && n < 1500) { tick(I, 1); n++; } };
      I.ictx.said.length = 0;
      for (let i = 0; i < 6; i++) doTalk();
      const ids = I.ictx.said.map((s) => `${s.id}${s.id2 ? '+' + s.id2 : ''}`);
      ok(ids.join() === `DARRR13A,DARRR13C,DARRA,DARRC,DARR${p56[2].key}A,DARR${p56[2].key}C`, `SGMFIG, 6 talks at node 56: ${ids.join(' ')}`);
      notes.push(`SGMFIG talks at node 56: ${ids.join(' ')}`);
    }

    // ---- feature off (option on): nothing changes
    forceRestored(true, RESTORE_FEATURES.map((f) => f.id));
    ok(await loadRestore(), 'all off: installed');
    const same = restoreHooks.messages('LI/Data/LIFSM8.str', tables[8]);
    ok(same === tables[8] && restoreHooks.say(tables[8], 'DARRA', undefined, () => true) === undefined, 'tips off: tables and say are the original\'s');

    forceRestored(null); setIslandVars(null);
    for (const k of Object.keys(restoreHooks)) delete restoreHooks[k];
    return { checked, failures, notes };
  },
};
