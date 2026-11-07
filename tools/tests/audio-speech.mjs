// Audio: the speech request / state machine of FUN_00435a11 / FUN_00435a5e / FUN_004436d0 / FUN_00435ad3 (src/audio/speech.ts) with files that do not exist (every line is "done" as soon as it
// is started), so only the machine is under test: the 6-tick warm-up of the very first request of a session (never reset), a request that is ignored while another exists, idle between a
// request and its first tick, line B starting when line A has ended, and the close when both are finished.
import { SpeechEngine } from '../../src/audio/speech.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

export default {
  name: 'audio-speech',
  async run() {
    const failures = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const ctx = { createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }, createBufferSource() { return { connect() {}, disconnect() {}, start() {}, stop() {} }; }, decodeAudioData() { return Promise.reject(new Error('no audio')); } };
    const files = { read: () => Promise.reject(new Error('missing')) };
    const sp = new SpeechEngine(ctx, {}, files, ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']);

    ok(sp.idle && !sp.hasRequest, 'idle at the start');
    ok(sp.say(5) === true, 'a request is accepted');
    await flush();             // the (missing) file's read fails: the port's `waiting` hold (audio data still on its way) is over, only the machine is under test
    ok(sp.idle && sp.hasRequest, 'idle between the request and its first tick (state 0)');
    ok(sp.say(6) === false, 'a second request is ignored while one exists');
    // the first request of the session: 6 ticks of warm-up (the counter runs 0..5 while <= 5.0), the machine starts on the 7th
    const states = [];
    for (let i = 1; i <= 7; i++) { sp.tick(1); states.push(sp.state); await flush(); }
    ok(states.slice(0, 6).every((s) => s === 0), `no state change during the warm-up (${states})`);
    ok(states[6] === 1 && !sp.idle, `the 7th tick starts line A (state ${states[6]})`);
    sp.tick(1);                // A is done (the file is missing): finished -> state 0, both closed
    ok(sp.state === 0 && sp.idle && !sp.hasRequest, 'a finished line closes the request');
    ok(sp.warm > 5, 'the warm-up counter is never reset');

    // later requests start at the very next tick
    ok(sp.say(7) === true, 'the next request is accepted');
    await flush();
    sp.tick(1);
    ok(sp.state === 1 && !sp.idle, 'a later request starts at the next tick (no delay)');
    await flush(); sp.tick(1);
    ok(sp.idle && !sp.hasRequest, 'and ends when its audio has');

    // two lines: A, then B when A has ended, then close
    ok(sp.say(1, 2) === true, 'a pair is accepted');
    await flush();
    sp.tick(1); ok(sp.state === 1, 'pair: A starts (state 1)');
    await flush(); sp.tick(1); ok(sp.state === 2, 'pair: B starts when A has ended (state 2)');
    await flush(); sp.tick(1); ok(sp.state === 0 && !sp.hasRequest, 'pair: closed when both are finished');

    // stop() = FUN_00435b07: closes at once
    sp.say(3); await flush(); sp.tick(1); ok(sp.state === 1, 'a line started'); sp.stop(); ok(sp.state === 0 && !sp.hasRequest && sp.idle, 'stop closes both lines at once');
    // the warm-up counter adds the constant 1.0 per pass (_DAT_00892020), not DAT_008b1718: dt 0.5 (the 60 Hz sim) takes the same 6 passes + the starting one
    const sp2 = new SpeechEngine(ctx, {}, files, ['A0', 'A1']);
    sp2.say(1); await flush();
    let n = 0; while (sp2.state === 0 && n < 100) { sp2.tick(0.5); n++; await flush(); }
    ok(n === 7, `warm-up with dt 0.5 takes 7 ticks like dt 1 (6 passes of the original + the starting tick) (${n})`);

    // prefetch: a list decodes its first 10 lines ahead (the rest is only read); lines nobody used keep the budget, so an `urgent` list (a script that starts: the cutscene host) must have the budget to
    // itself (it used to wait for its own read + decode line by line behind the lines of the NPCs near Pepper) and come before the lists already queued
    const names = Array.from({ length: 60 }, (_, i) => 'B' + i);
    const dctx = { ...ctx, decodeAudioData: () => Promise.resolve({ duration: 1 }) };
    const dfiles = { read: () => Promise.resolve(new Uint8Array([1, 2, 3, 4])) };
    const sp3 = new SpeechEngine(dctx, {}, dfiles, names);
    const settle = async () => { for (let i = 0; i < 40; i++) await flush(); };
    const has = (i) => sp3.buffers.has('b' + i);
    sp3.prefetch(Array.from({ length: 15 }, (_, i) => i)); await settle();
    ok([...Array(10).keys()].every(has) && ![10, 11, 12, 13, 14].some(has), 'prefetch: the first 10 lines of a list are decoded ahead, the rest only read');
    sp3.prefetch(Array.from({ length: 10 }, (_, i) => 20 + i)); await settle();
    ok(![20, 21, 22, 23, 24, 25, 26, 27, 28, 29].some(has), 'prefetch: a second plain list finds the decode budget taken by the unused lines of the first');
    sp3.prefetch(Array.from({ length: 10 }, (_, i) => 30 + i), { urgent: true }); await settle();
    ok(Array.from({ length: 10 }, (_, i) => 30 + i).every(has), 'prefetch: an urgent list is decoded ahead at once whatever lines other lists hold');
    const sp4 = new SpeechEngine(dctx, {}, dfiles, names);
    sp4.prefetch([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);      // (the pump takes its first group of 6 at once: 6 lines stay queued)
    sp4.prefetch([40, 41, 42], { urgent: true });
    ok(sp4.queue.slice(0, 3).join() === 'B40,B41,B42', `prefetch: an urgent list goes before what is queued (${sp4.queue.slice(0, 4)})`);
    await settle();
    return { checked, failures };
  },
};
