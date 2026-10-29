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
    sp.tick(1);
    ok(sp.state === 1 && !sp.idle, 'a later request starts at the next tick (no delay)');
    await flush(); sp.tick(1);
    ok(sp.idle && !sp.hasRequest, 'and ends when its audio has');

    // two lines: A, then B when A has ended, then close
    ok(sp.say(1, 2) === true, 'a pair is accepted');
    sp.tick(1); ok(sp.state === 1, 'pair: A starts (state 1)');
    await flush(); sp.tick(1); ok(sp.state === 2, 'pair: B starts when A has ended (state 2)');
    await flush(); sp.tick(1); ok(sp.state === 0 && !sp.hasRequest, 'pair: closed when both are finished');

    // stop() = FUN_00435b07: closes at once
    sp.say(3); sp.tick(1); ok(sp.state === 1, 'a line started'); sp.stop(); ok(sp.state === 0 && !sp.hasRequest && sp.idle, 'stop closes both lines at once');
    // the 30 Hz loop with dt = 0.5 (60 Hz steps of the future simulation) takes twice as many ticks for the warm-up
    const sp2 = new SpeechEngine(ctx, {}, files, ['A0', 'A1']);
    sp2.say(1);
    let n = 0; while (sp2.state === 0 && n < 100) { sp2.tick(0.5); n++; await flush(); }
    ok(n === 13, `warm-up with dt 0.5 takes 13 ticks (6 frames of the original + the starting tick) (${n})`);
    return { checked, failures };
  },
};
