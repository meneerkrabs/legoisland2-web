// Audio: the shell's AudioHost logic in node with a fake GameAudio (docs/re/audio.md 11): zone start loads the original's list, the music starts at the moment the original calls
// Play (init / leaving the intro / leaving the help), the groove is set right before the play, a zone that is left while loading never plays, by-id sound calls find their slot,
// duplicates are picked like the original's separate slots, a sound outside the list is loaded and played when ready, the 3D listener follows the zone's rule, the speech
// preview and the zone sets (class registrations) are what the generated table says.
import { ZONE_SOUND_SETUP, SOUND_SETS, ZONE_CLASS_SETS } from '../../src/audio/zonesounds.ts';
import { ZONE_MUSIC } from '../../src/audio/zonemusic.ts';

// AudioHost imports the engine's AudioContext singleton: a stub is enough here
globalThis.AudioContext = class { constructor() { this.state = 'running'; this.destination = {}; this.currentTime = 0; } createGain() { return { connect() {}, gain: { value: 1 } }; } resume() { return Promise.resolve(); } };
const { AudioHost } = await import('../../src/shell/audiohost.ts');
const MODE = { PLAY: 2, PAUSE: 3, FADE_IN: 7, INIT: 0, INTRO: 1, HELP: 9, BANNER: 4, HELP2: 10 };

function fakeAudio() {
  const calls = [];
  const ga = {
    calls,
    ctx: { currentTime: 0 },
    sfx: {
      slotCounts: { d2: 0, d3: 0 },
      async load2D(id) { calls.push(`load2D ${id}`); return { id, kind: '2d', playing: false, entry: { loopCount: id === 9000 ? 0 : 1 } }; },
      async load3D(id) { calls.push(`load3D ${id}`); return { id, kind: '3d', playing: false, entry: { loopCount: id === 9001 ? 0 : 1 } }; },
      play2D(s) { calls.push(`play2D ${s.id}${s.n !== undefined ? '#' + s.n : ''}`); s.playing = true; return true; },
      play3D(s, p) { calls.push(`play3D ${s.id}${s.n !== undefined ? '#' + s.n : ''} ${p.x},${p.y},${p.z}`); s.playing = true; return true; },
      stop(s) { calls.push(`stop ${s.id}`); s.playing = false; },
      setRate(s, hz) { calls.push(`rate ${s.id} ${hz}`); },
      setListener(p, f, u) { calls.push(`listener ${p.x},${p.y},${p.z} f ${f.x},${f.y},${f.z} u ${u.x},${u.y},${u.z}`); },
    },
    music: {
      loaded: [],
      async load(key) { calls.push(`music.load ${key}`); return { key }; },
      warm() { calls.push('music.warm'); },
      play(h) { calls.push(`music.play ${h.key}`); },
      setGroove(n) { calls.push(`music.groove ${n}`); },
    },
    ambience: { async start(k) { calls.push(`ambience ${k}`); return true; } },
    speech: { say(i) { calls.push(`speech.say ${i}`); return true; }, tick(dt) { calls.push(`speech.tick ${dt}`); } },
    resetZone() { calls.push('resetZone'); },
    setMusicVolume() {}, setSfxVolume() {}, setSpeechVolume() {},
  };
  return ga;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

export default {
  name: 'audio-host',
  async run() {
    const failures = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const mk = () => { const h = new AudioHost(false); h.ga = fakeAudio(); return h; };
    const plays = (h) => h.ga.calls.filter((c) => c.startsWith('music.play') || c.startsWith('music.groove'));

    // ---- zone start: the generated list is loaded, in order, with the class sets; the menu clicks come from leaveZone / create
    {
      const h = mk();
      h.leaveZone(); await tick();
      h.ga.calls.length = 0;
      await h.enterZone('z10RGB');
      const loads = h.ga.calls.filter((c) => /^load[23]D/.test(c));
      const want = [...ZONE_SOUND_SETUP.z10RGB.loads, ...(ZONE_CLASS_SETS.z10RGB ?? []).flatMap((c) => SOUND_SETS[c].loads)].map(([k, id]) => `load${k === '2d' ? '2D' : '3D'} ${id}`);
      ok(JSON.stringify(loads) === JSON.stringify(want), `z10RGB loads ${loads.length}, want ${want.length}`);
      ok(h.slots('3d', 407).length === 11 || h.slots('3d', ZONE_SOUND_SETUP.z10RGB.loads.find((l) => l[0] === '3d' && ZONE_SOUND_SETUP.z10RGB.loads.filter((m) => m[1] === l[1]).length > 5)[1]).length > 5, 'duplicate loads keep separate slots');
      ok(h.enterZone('z10RGB') === h.enterZone('z10RGB'), 'enterZone for the same zone returns the same promise');
      ok(h.slots('2d', 606).length === 1 && h.slots('2d', 602).length === 1, 'the menu clicks loaded by leaveZone belong to the next zone (not dropped by its start)');
    }

    // ---- music moments
    const moments = {
      z08BKD: [[MODE.INTRO, MODE.HELP], [MODE.HELP, MODE.PLAY]],       // play at 9 -> 2
      z40aPO: [[MODE.INTRO, MODE.HELP], [MODE.HELP, MODE.PLAY]],       // play at 1 -> 9
    };
    for (const zone of ['z08BKD', 'z40aPO', 'z01BPK', 'z07CSI', 'z13CAI', 'z42BRP', 'z50LTC', 'z02LGI', 'z18MMP', 'z09JST']) {
      const h = mk();
      h.leaveZone(); await tick();
      h.ga.calls.length = 0;
      await h.enterZone(zone);
      await tick();
      const spec = ZONE_MUSIC[zone] ?? {};
      const atInit = plays(h);
      const wantInit = (spec.plays ?? []).filter((p) => p.at === 'init').flatMap((p) => [...(p.groove !== undefined ? [`music.groove ${p.groove}`] : []), `music.play ${spec.key}`]);
      ok(JSON.stringify(atInit) === JSON.stringify(wantInit), `${zone}: at init ${JSON.stringify(atInit)} want ${JSON.stringify(wantInit)}`);
      h.ga.calls.length = 0;
      // the loop's modes: fade in -> init -> intro -> help -> play (a zone with an intro and a help)
      h.modeChange(MODE.FADE_IN, MODE.INIT); h.modeChange(MODE.INIT, MODE.INTRO); await tick();
      ok(plays(h).length === 0 || zone === 'z01BPK' && false, `${zone}: nothing plays while the intro is shown (${plays(h)})`);
      h.modeChange(MODE.INTRO, MODE.HELP); await tick();
      const afterIntro = plays(h).slice();
      h.modeChange(MODE.HELP, MODE.PLAY); await tick();
      const afterHelp = plays(h).slice(afterIntro.length);
      const wantIntro = (spec.plays ?? []).filter((p) => p.at === 'leaveIntro').flatMap((p) => [...(p.groove !== undefined ? [`music.groove ${p.groove}`] : []), `music.play ${spec.key}`]);
      const wantHelp = (spec.plays ?? []).filter((p) => p.at === 'leaveHelp').flatMap((p) => [...(p.groove !== undefined ? [`music.groove ${p.groove}`] : []), `music.play ${spec.key}`]);
      ok(JSON.stringify(afterIntro) === JSON.stringify(wantIntro), `${zone}: leaving the intro plays ${JSON.stringify(afterIntro)} want ${JSON.stringify(wantIntro)}`);
      ok(JSON.stringify(afterHelp) === JSON.stringify(wantHelp), `${zone}: leaving the help plays ${JSON.stringify(afterHelp)} want ${JSON.stringify(wantHelp)}`);
      // a moment passes once: pause and resume does not play again
      h.ga.calls.length = 0;
      h.modeChange(MODE.PLAY, MODE.PAUSE); h.modeChange(MODE.PAUSE, MODE.PLAY); await tick();
      ok(plays(h).length === 0, `${zone}: pause / resume does not restart the music`);
    }
    void moments;

    // a zone without an intro / help in the port: the music starts when play starts
    {
      const h = mk(); h.leaveZone(); await tick(); await h.enterZone('z15SSH'); h.ga.calls.length = 0;
      h.modeChange(MODE.INIT, MODE.PLAY); await tick();
      ok(plays(h).join() === 'music.play z15ssh', `no intro / help: plays at play start (${plays(h)})`);
    }
    // the esc key during the intro (intro -> pause) does not start it
    {
      const h = mk(); h.leaveZone(); await tick(); await h.enterZone('z08BKD'); h.ga.calls.length = 0;
      h.modeChange(MODE.INTRO, MODE.PAUSE); await tick();
      ok(plays(h).length === 0, 'intro -> pause does not start the music');
    }
    // a zone left while its music key loads never plays
    {
      const h = mk(); h.leaveZone(); await tick();
      const p = h.enterZone('z07CSI');
      h.leaveZone();
      await p; await tick();
      ok(!h.ga.calls.some((c) => c.startsWith('music.play')), 'a zone left during its load does not play its music');
    }

    // ---- by-id sounds: slots, duplicates, lazy fallback
    {
      const h = mk(); h.leaveZone(); await tick(); await h.enterZone('z04IFC');
      h.ga.calls.length = 0;
      const id = ZONE_SOUND_SETUP.z04IFC.loads[0][1];
      h.play(id);
      ok(h.ga.calls.join() === `play2D ${id}`, `play(id) finds its slot (${h.ga.calls})`);
      h.ga.calls.length = 0;
      h.play(123456);   // not in the list, and out of range for the fake: loads (fake accepts any id) then plays
      await tick(); await tick();
      ok(h.ga.calls.join() === 'load2D 123456,play2D 123456', `a sound outside the list is loaded and played when ready (${h.ga.calls})`);
      ok(h.missed.has('2d:123456'), 'the gap is recorded in `missed`');
      h.ga.calls.length = 0;
      h.play(123456);
      ok(h.ga.calls.join() === 'play2D 123456', 'the second play finds the slot');
      // a play that is withdrawn by stop() before its load ends never sounds
      h.ga.calls.length = 0;
      h.play(777); h.stop(777); await tick(); await tick();
      ok(!h.ga.calls.includes('play2D 777'), 'stop() withdraws a pending play');
    }
    {
      // duplicates: three slots of a 3D sound; one-shots rotate over idle slots, a loop is refreshed on the slot that plays
      const h = mk(); h.leaveZone(); await tick(); h.ga.calls.length = 0;
      await h.loadSounds([['3d', 5], ['3d', 5], ['3d', 5], ['3d', 9001], ['3d', 9001]]);
      let n = 0; for (const s of h.slots('3d', 5)) s.n = n++;
      n = 0; for (const s of h.slots('3d', 9001)) s.n = n++;
      h.ga.calls.length = 0;
      h.playAt(5, [1, 2, 3]); h.playAt(5, [1, 2, 3]); h.playAt(5, [1, 2, 3]);
      ok(h.ga.calls.join('|') === 'play3D 5#0 1,2,3|play3D 5#1 1,2,3|play3D 5#2 1,2,3', `one-shot duplicates rotate over idle slots (${h.ga.calls})`);
      h.ga.calls.length = 0;
      h.playAt(9001, [0, 0, 0]); h.playAt(9001, [0, 0, 0]);
      ok(h.ga.calls.join('|') === 'play3D 9001#0 0,0,0|play3D 9001#0 0,0,0', `a loop keeps to the slot that plays (${h.ga.calls})`);
    }

    // ---- listener (FUN_004434d0): eye, target for z38PAR / z08BKD / z27TRX, none for the five zones that never set it
    {
      const cam = new Float32Array(18);
      cam.set([1, 2, 3, 4, 5, 6], 0); cam.set([0, 1, 0], 12); cam.set([0, 0, 1], 15);
      for (const [zone, want] of [['z02LGI', 'listener 1,2,3 f 0,0,1 u 0,1,0'], ['z38PAR', 'listener 4,5,6 f 0,0,1 u 0,1,0'], ['z08BKD', 'listener 4,5,6 f 0,0,1 u 0,1,0'], ['z27TRX', 'listener 4,5,6 f 0,0,1 u 0,1,0'], ['z01BPK', null], ['z17WAS', null], ['z21FSH', null], ['z03PPH', null], ['z04IFC', null], ['z50LTC', 'listener 1,2,3 f 0,0,1 u 0,1,0']]) {
        const h = mk(); h.leaveZone(); await tick(); await h.enterZone(zone); h.ga.calls.length = 0;
        h.frame(cam, 1);
        const got = h.ga.calls.find((c) => c.startsWith('listener')) ?? null;
        ok(got === want, `${zone}: listener ${got} want ${want}`);
        ok(h.ga.calls.includes('speech.tick 1'), `${zone}: the speech state machine ticks with the frame`);
      }
    }

    // ---- speech preview of the options menu: a changed speech volume says line 8; the first call only sets the volumes
    {
      const h = mk();
      h.setVolumes(80, 80, 80);
      ok(!h.ga.calls.includes('speech.say 8'), 'the first volume call does not preview');
      h.setVolumes(50, 80, 80);
      ok(!h.ga.calls.includes('speech.say 8'), 'the music slider does not preview speech');
      h.setVolumes(50, 80, 60);
      ok(h.ga.calls.includes('speech.say 8'), 'the speech slider previews line 8');
    }
    return { checked, failures };
  },
};
