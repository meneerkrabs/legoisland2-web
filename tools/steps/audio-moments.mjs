// A1 / A2 in the headless, muted browser (Web Audio really runs, the output is muted by the browser flag; do NOT pass mute=1, that disables the audio engine):
// a zone is entered, the loop modes are driven with Enter presses, and the audio host's and the music engine's logs say WHEN the music was scheduled against the loop's
// mode changes, which sounds were loaded before the loop began and whether a sound the zone played was missing from its list.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5611/?zone=z08BKD" tools/steps/audio-moments.mjs --size 800x600
// Prints one JSON line `AUDIO {...}`; the caller (tools/audio-moments-all.sh) collects them.
export default async ({ page, wait, log, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__shell && window.__shell.audio && window.__shell.audio.ga, null, { timeout: 180000 });
  const t0 = Date.now();
  // wait until the zone's sounds are ready (the runner awaits it before the loop, so the loop exists only after the loads)
  const trace = [];
  const state = () => page.evaluate(() => {
    const z = window.__zone, a = window.__shell.audio, m = a.ga.music;
    return { mode: z.machine.mode, now: a.ga.ctx.currentTime, playing: m.playing, cur: m.current ? m.current.key : null, mlog: m.log.length, zone: z.info.archive, hold: !!(z.game && z.game.introHold && z.game.introHold()) };
  }).catch((e) => ({ mode: -1, error: String(e.message).split('\n')[0] }));
  let s = await state();
  trace.push({ ms: Date.now() - t0, ...s });
  // drive the modes: Enter leaves the intro / help; stop when play is reached
  for (let i = 0; i < 150 && s.mode !== 2 && s.mode !== -1; i++) {
    await wait(700);
    if (!s.hold && (s.mode === 1 || s.mode === 9 || s.mode === 10)) await key('Enter');   // never while the zone is busy elsewhere (a cutscene hold): Enter would skip it
    s = await state();
    trace.push({ ms: Date.now() - t0, ...s });
  }
  await wait(2500);
  const r = await page.evaluate(() => {
    const a = window.__shell.audio, m = a.ga.music, z = window.__zone;
    if (!z || !z.machine) return { zone: 'gone', mode: -1, hostLog: [], musicLog: [], missed: [], stats: {}, slots: {}, voices: {} };
    return {
      zone: z.info.archive,
      mode: z.machine.mode,
      hostLog: a.log.map((e) => `${e.t.toFixed(2)} ${e.what} ${e.detail ?? ''}`),
      musicLog: m.log.map((e) => `${e.t.toFixed(2)} ${e.what} ${e.key ?? ''}${e.at !== undefined ? ' at ' + e.at.toFixed(2) : ''}${e.value !== undefined ? ' ' + e.value : ''}`),
      musicNow: m.current ? m.current.key : null,
      slots: a.ga.sfx.slotCounts,
      missed: [...a.missed],
      stats: a.stats,
      voices: a.ga.sfx.activeVoices,
    };
  });
  log('AUDIO ' + JSON.stringify({ ...r, trace }));
};
