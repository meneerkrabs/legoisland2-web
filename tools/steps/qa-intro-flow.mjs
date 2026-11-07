// The start-up movies of the real flow (`?play=1`: LegoSoftware, SdLogo, IntroFmv, then the front end), headless, audio engine ON (no mute=1), through the bot slots:
//   sh tools/m4-snapshot-server.sh 5823 ; sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5823/?play=1" tools/steps/qa-intro-flow.mjs --size 640x480 --out /tmp/qa-intro
// Checks the order and the skip flags of FUN_00402990 (LegoSoftware ignores keys and clicks, SdLogo and IntroFmv end on a key), prints the player's statistics of each movie
// (`window.__le2Movies`: frames, audio frames, media / wall seconds, stalls, catch-ups) and screenshots at the start, the middle and the end of each. SKIPALL=0 plays SdLogo and IntroFmv to the end.
export default async ({ page, wait, log, shot, key }) => {
  const t0 = Date.now();
  const S = () => page.evaluate(() => ({
    movies: (window.__le2Movies ?? []).map((m) => ({ n: m.name, r: m.result, skipped: m.skipped, frames: m.frames, audio: m.audioFrames, media: +m.mediaSeconds.toFixed(2), wall: +m.wallSeconds.toFixed(2), startup: +m.startupSeconds.toFixed(2), stalls: m.stalls, late: m.catchUps, size: `${m.width}x${m.height}@${m.frameRate}` })),
    playing: !!document.querySelector('.le2-movie'), visible: document.querySelector('.le2-movie-canvas')?.style.visibility ?? null, hint: document.querySelector('.le2-movie-hint')?.textContent ?? null,
    zone: window.__zone && window.__zone.info ? window.__zone.info.archive : null, mode: window.__zone && window.__zone.machine ? window.__zone.machine.mode : null, loading: !!document.querySelector('.le2-loading'),
  })).catch(() => null);
  const skipAll = process.env.SKIPALL !== '0';
  const seen = [];
  let step = 0, last = null;
  for (let i = 0; i < 2400; i++) {
    await wait(250);
    const s = await S();
    if (!s) continue;
    const key_ = `${s.movies.length}|${s.playing}|${s.zone}`;
    if (key_ !== last) { last = key_; log(`t=${((Date.now() - t0) / 1000).toFixed(1)}s movies=${s.movies.map((m) => m.n + (m.skipped ? '(skipped)' : '')).join(',')} playing=${s.playing} zone=${s.zone} hint=${JSON.stringify(s.hint)}`); await shot(`flow-${String(seen.length).padStart(2, '0')}-${s.movies.length}-${s.playing ? 'movie' : 'idle'}`); seen.push(key_); }
    // 1: LegoSoftware is on screen: a key and a click must not end it
    if (step === 0 && s.playing && s.visible === 'visible' && s.movies.length === 0) {
      await wait(3000);
      await key('Enter'); await page.mouse.click(300, 200); await key('Space');
      await wait(800);
      const s2 = await S();
      log(`LegoSoftware after Enter / click / Space at ~4 s: still playing=${s2.playing} movies done=${s2.movies.length} (want playing, 0 done)`);
      await shot('flow-legosoftware-after-keys');
      step = 1;
    }
    // 2: SdLogo (movie 2) and IntroFmv (movie 3): a key skips them
    if (step >= 1 && s.playing && s.visible === 'visible' && s.movies.length >= 1 && s.movies.length <= 2 && skipAll && step === s.movies.length) {
      await wait(2500);
      await shot(`flow-movie${s.movies.length + 1}-2s`);
      await key('Enter');
      step = s.movies.length + 1;
      await wait(600);
    }
    // after the third movie the front end loads (a loading card, then the menu: no `__zone` for it): two screenshots, 4 s and 20 s after the movie
    if (s.movies.length >= 3 && !s.playing) { await wait(4000); await shot('flow-frontend-4s'); await wait(16000); await shot('flow-frontend-20s'); break; }
    if (Date.now() - t0 > 600000) { log('TIMEOUT'); break; }
  }
  const f = await S();
  log('MOVIES ' + JSON.stringify(f));
};
