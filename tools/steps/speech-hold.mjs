// Speech hold test (headless, muted browser): the data of every speech line is made late on purpose (HOLD_DELAY ms per file read, default 1500; caches emptied), then the island's first cutscene runs.
// Expected with the port's hold: while a line's data is on its way `speech.waiting` is true, the actors' faces (mouth frames) do not change and no subtitle is drawn; the audio starts in the
// tick after the data arrived (onLineStart), the mouth / subtitle resume in that same frame.
//   sh tools/m4-snapshot-server.sh 5732 ; sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5732/?zone=z02LGI" tools/steps/speech-hold.mjs --size 800x600
export default async ({ page, wait, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__shell && window.__shell.audio && window.__shell.audio.ga, null, { timeout: 600000 });
  await page.evaluate((delay) => {
    const sp = window.__shell.audio.ga.speech, z = window.__zone, ev = (window.__holdEv = []);
    const files = sp.files, read = files.read.bind(files);
    files.read = (p) => (/speech/i.test(p) ? new Promise((r) => setTimeout(r, delay)).then(() => read(p)) : read(p));
    sp.cache.clear(); sp.buffers.clear(); sp.raw.clear(); sp.rawOrder.length = 0; sp.queue.length = 0; sp.bulk.length = 0;
    const say = sp.say.bind(sp);
    sp.say = (a, b = -1) => { const ok = say(a, b); if (ok) ev.push({ ev: 'say', t: performance.now(), id: sp.idOf(a) }); return ok; };
    sp.onLineStart = (i, id) => ev.push({ ev: 'start', t: performance.now(), id });
    let last = null, waitingNow = false, faceChangesWhileWaiting = 0, subWhileWaiting = 0, frames = 0, waitFrames = 0;
    const faces = () => z.world.records.map((r) => (r ? r.face : 0)).join(',');
    const loop = () => {
      const w = sp.waiting, f = faces();
      frames++;
      if (w) { waitFrames++; if (last !== null && f !== last) faceChangesWhileWaiting++; if (z.ctx.subtitle() || (z.ctx.cutscene.runner.subtitle && !w)) subWhileWaiting++; }
      if (w !== waitingNow) { ev.push({ ev: w ? 'waiting' : 'ready', t: performance.now() }); waitingNow = w; }
      last = f;
      window.__holdStats = { frames, waitFrames, faceChangesWhileWaiting, subWhileWaiting };
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, Number(process.env.HOLD_DELAY ?? 1500));
  await wait(Number(process.env.WAIT_MS ?? 25000));
  const r = await page.evaluate(() => ({ ev: window.__holdEv, st: window.__holdStats, lags: window.__shell.audio.ga.speech.lags, stats: window.__shell.audio.ga.speech.stats }));
  const t0 = r.ev[0]?.t ?? 0;
  log('SPEECH-HOLD ' + r.ev.map((e) => `${e.ev}${e.id ? ':' + e.id : ''}@${Math.round(e.t - t0)}`).join(' '));
  log('SPEECH-HOLD-STATS ' + JSON.stringify({ ...r.st, speech: r.stats, lags: r.lags.slice(0, 6) }));
};
