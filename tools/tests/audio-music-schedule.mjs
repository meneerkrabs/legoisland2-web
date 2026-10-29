// Audio: DirectMusic's start time (docs/re/audio.md 7.3 / 11.1). `PlaySegment(seg, DMUS_SEGF_AFTERPREPARETIME, 0)`: the segment starts one prepare time after the call and
// replaces the running primary segment exactly then. The renderer must put the first note of the new segment on that instant (sample accurate), keep the old segment
// sounding until it, and never let anything the old segment would still have played after the cut be heard. Canned-sequence segments (no random choices) make the
// comparison exact: Z08BKD1 (A) and Z17WAS2 (B).
import fs from 'node:fs';
import path from 'node:path';
import { readAudioTables } from '../../src/audio/tables.ts';
import { loadSegment } from '../../src/audio/dm/assets.ts';
import { MusicRenderer } from '../../src/audio/dm/player.ts';
import { parseSmf, smfTimeline, MidiRenderer } from '../../src/audio/midi.ts';
import { parseDls } from '../../src/audio/dm/dls.ts';
import { readTolerant } from '../../src/audio/files.ts';

const SR = 44100;
const ci = (dir, name) => { const f = fs.readdirSync(dir).find((x) => x.toLowerCase() === name.toLowerCase()); return f ? path.join(dir, f) : null; };

export default {
  name: 'audio-music-sched',
  async run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const dmRoot = path.join(ctx.soundsDir, 'DirectMusic');
    const read = async (p) => { let cur = dmRoot; for (const part of p.split('/')) { const n = ci(cur, part); if (!n) throw new Error('missing ' + p); cur = n; } return new Uint8Array(fs.readFileSync(cur)); };
    const tables = readAudioTables(new Uint8Array(fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe'))));
    const load = (key) => { const m = tables.music.find((t) => t.key.toLowerCase() === key.toLowerCase()); return loadSegment(read, m.dir.split('\\').pop(), m.segment, m.dls); };
    const A = await load('Z08BKD1'), B = await load('z17was2');

    // noteOn log of a renderer: frame of every note
    const watch = (r) => { const log = []; const orig = r.synth.noteOn.bind(r.synth); r.synth.noteOn = (pch, key, vel) => { log.push({ frame: r.frame + (r._done ?? 0), pch, key, vel }); return orig(pch, key, vel); }; return log; };
    const run = (r, fromSec, toSec, log) => {
      const L = new Float32Array(512), R = new Float32Array(512);
      const peaks = [];
      while (r.frame < toSec * SR) { r.render(L, R, 512); let p = 0; for (let i = 0; i < 512; i++) p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); peaks.push([r.frame - 512, p]); }
      return peaks;
    };
    // the renderer logs note-ons at block granularity (frame of the block start): enough to compare times within one block
    const BLOCK = 512;

    // reference: B alone started at 0 by the old API
    const ref = new MusicRenderer(SR, 1, 99); const refLog = watch(ref);
    ref.play(B, { boundary: 'immediate' });
    run(ref, 0, 10, refLog);
    ok(refLog.length > 10, 'reference: B plays notes');
    const refFirst = refLog[0].frame;

    // 1) nothing playing: B at T = 2.0 s while the clock is at 1.5 s: first note T + the reference's first note offset
    const r1 = new MusicRenderer(SR, 1, 99); const log1 = watch(r1);
    run(r1, 0, 1.5, log1);
    ok(log1.length === 0 && !r1.perf.playing, 'idle renderer is silent');
    r1.playAt(B, 2.0);
    run(r1, 1.5, 6, log1);
    ok(log1.length > 0, 'start at an exact time: notes follow');
    const want1 = Math.round(2.0 * SR) + refFirst;
    ok(log1.length > 0 && Math.abs(log1[0].frame - want1) <= BLOCK, `first note at ${log1[0]?.frame} (want ${want1} +- one block)`);
    // the notes after it follow the reference's rhythm (same canned events)
    for (let i = 0; i < Math.min(20, log1.length, refLog.length); i++) ok(log1[i].key === refLog[i].key && log1[i].pch === refLog[i].pch && Math.abs((log1[i].frame - log1[0].frame) - (refLog[i].frame - refLog[0].frame)) <= BLOCK, `note ${i} of the delayed start matches the reference`);

    // 2) A plays; B is started at an exact time inside already generated windows: A sounds until then, A's notes after it never sound, B starts there
    const r2 = new MusicRenderer(SR, 1, 99); const log2 = watch(r2);
    r2.play(A, { boundary: 'immediate' });
    run(r2, 0, 3.0, log2);
    const aNotesBefore = log2.length;
    ok(aNotesBefore > 5, 'A plays before the cut');
    const cutSec = 3.3;     // inside the 0.12 s lookahead the renderer has already generated (3.0 + 0.12 = 3.12 < 3.3: also test a cut inside generated material below)
    r2.playAt(B, cutSec);
    run(r2, 3.0, 8, log2);
    const aAfter = log2.filter((n) => n.frame > Math.round(cutSec * SR) + BLOCK && !refLog.some((q) => q.key === n.key && q.pch === n.pch && Math.abs((q.frame + Math.round(cutSec * SR)) - n.frame) <= BLOCK));
    ok(aAfter.length === 0, `after the cut only B's notes sound (${aAfter.length} foreign notes: ${aAfter.slice(0, 3).map((n) => `${n.pch}/${n.key}@${n.frame}`).join(' ')})`);
    const bFirst = log2.find((n) => n.frame >= Math.round(cutSec * SR) - BLOCK);
    ok(!!bFirst && Math.abs(bFirst.frame - (Math.round(cutSec * SR) + refFirst)) <= BLOCK, `B's first note at ${bFirst?.frame} (want ${Math.round(cutSec * SR) + refFirst})`);

    // 3) a cut inside material that was already generated and queued (start time earlier than the generated head): B at 3.05 s while A's events up to 3.12 are queued
    const r3 = new MusicRenderer(SR, 1, 99); const log3 = watch(r3);
    r3.play(A, { boundary: 'immediate' });
    run(r3, 0, 3.0, log3);
    r3.playAt(B, 3.05);
    run(r3, 3.0, 8, log3);
    const cut3 = Math.round(3.05 * SR);
    const foreign3 = log3.filter((n) => n.frame > cut3 + BLOCK && !refLog.some((q) => q.key === n.key && q.pch === n.pch && Math.abs((q.frame + cut3) - n.frame) <= BLOCK));
    ok(foreign3.length === 0, `cut inside generated windows: ${foreign3.length} foreign notes after it`);

    // 4) segment notifications (GUID_NOTIFICATION_SEGMENT): start at the start time, a loop at every wrap, abort + start when a primary segment is replaced
    const T = await load('Z02LGIT');   // 55296 ticks, loops forever
    const r4 = new MusicRenderer(SR, 1, 99);
    const nt = [];
    r4.onNotify = (option, frame) => nt.push([option, frame / SR]);
    r4.playAt(T, 0.5);
    const L = new Float32Array(1024), R = new Float32Array(1024);
    const secOfTicks = (ticks, bpm) => (ticks * 60) / (bpm * 768);
    while (r4.frame < 100 * SR) r4.render(L, R, 1024);
    ok(nt.length > 0 && nt[0][0] === 'start' && Math.abs(nt[0][1] - 0.5) < 0.05, `first notification is a start at 0.5 s (${nt[0]})`);
    const loops = nt.filter((n) => n[0] === 'loop');
    const period = loops.length > 1 ? loops[1][1] - loops[0][1] : 0;
    ok(loops.length >= 2 && period > 20 && period < 80, `loop notifications every ${period.toFixed(2)} s (${loops.length} in 100 s)`);
    ok(nt.every((n, i) => i === 0 || n[1] >= nt[i - 1][1] - 1e-9), 'notifications come in time order');
    const r5 = new MusicRenderer(SR, 1, 99);
    const n5 = [];
    r5.onNotify = (option, frame) => n5.push([option, frame / SR]);
    r5.playAt(A, 0.2);
    while (r5.frame < 3 * SR) r5.render(L, R, 1024);
    r5.playAt(B, 4.0);
    while (r5.frame < 8 * SR) r5.render(L, R, 1024);
    const ab = n5.filter((n) => n[0] === 'abort'), st = n5.filter((n) => n[0] === 'start');
    ok(ab.length === 1 && Math.abs(ab[0][1] - 4.0) < 0.05, `the replaced segment reports an abort at the cut (${JSON.stringify(ab)})`);
    ok(st.length === 2 && Math.abs(st[1][1] - 4.0) < 0.05, `the new segment reports its start at the cut (${JSON.stringify(st)})`);

    // 5) ambience beds (FUN_00443230 / FUN_00875b16): the first pass starts after the 6-frame delay, a pass ends at the SMF's end-of-track and the next one starts within a frame
    const files = { has: () => true, async read(rel) { let cur = ctx.dataRoot; for (const part of rel.split('/')) { const n = ci(cur, part); if (!n) throw new Error('missing ' + rel); cur = n; } return new Uint8Array(fs.readFileSync(cur)); } };
    const rd = (rel) => readTolerant(files, rel);
    for (const e of tables.ambience) {
      const mid = await rd(e.midi), dls = await rd(e.dls);
      if (!mid || !dls) { failures.push(`ambience ${e.key}: files missing`); continue; }
      const smf = parseSmf(mid), tl = smfTimeline(smf);
      ok(tl.length > 5, `${e.key}: sequence length ${tl.length}`);
      const r = new MidiRenderer(SR, 32);
      r.start(smf, parseDls(dls), 6 / 30);
      const Lb = new Float32Array(512), Rb = new Float32Array(512);
      const starts = [];
      let lastPass = 0;
      const startOf = (frame) => frame / SR;
      // the pass counter changes when the next pass starts
      while (r.frame < (0.2 + tl.length * 2.05) * SR) { r.render(Lb, Rb, 512); if (r.passes !== lastPass) { starts.push(startOf(r.frame)); lastPass = r.passes; } }
      ok(starts.length >= 2, `${e.key}: restarts (${starts.length})`);
      if (starts.length >= 1) ok(Math.abs(starts[0] - (0.2 + tl.length + 1 / 60)) < 0.03, `${e.key}: second pass starts at ${starts[0].toFixed(3)} s, want 0.2 + ${tl.length.toFixed(3)} + 1/60`);
      if (starts.length >= 2) ok(Math.abs(starts[1] - starts[0] - (tl.length + 1 / 60)) < 0.03, `${e.key}: pass period ${(starts[1] - starts[0]).toFixed(3)} s, want ${(tl.length + 1 / 60).toFixed(3)}`);
    }
    return { checked, failures };
  },
};
