// Speech sync measurement (headless, muted browser; the audio graph still runs): how long from a speech request (`speech.say`, the moment the talk animation / subtitle start)
// to the audio actually starting (`onLineStart`), for every line the zone says in WAIT_MS (default 60 s). Works on a build with or without the speech prefetch (it hooks the engine from outside).
//   local:  sh tools/m4-snapshot-server.sh 5731 ; sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&trace=1" tools/steps/speech-sync.mjs --size 800x600
//   live:   sh tools/m5-botslot.sh node tools/browse.mjs "https://meneerkrabs.github.io/legoeiland2-web/?zone=z02LGI&trace=1" tools/steps/speech-sync.mjs --size 800x600
// KEYS=shift@3000,... is not needed: the island's first cutscene speaks by itself; SKIP=1 never presses Shift.
export default async ({ page, wait, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__shell && window.__shell.audio && window.__shell.audio.ga, null, { timeout: 600000 });
  await page.evaluate(() => {
    const sp = window.__shell.audio.ga.speech, ev = (window.__speechEv = []);
    const now = () => performance.now();
    const say = sp.say.bind(sp);
    sp.say = (a, b = -1) => {
      const ok = say(a, b);
      if (ok) ev.push({ ev: 'say', t: now(), id: sp.idOf(a), b: b >= 0 ? sp.idOf(b) : null, waiting: sp.waiting ?? null });
      return ok;
    };
    sp.onLineStart = (i, id) => ev.push({ ev: 'start', t: now(), id, ct: sp.ctx.currentTime });
    sp.onLineEnd = (i, id) => ev.push({ ev: 'end', t: now(), id });
  });
  await wait(Number(process.env.WAIT_MS ?? 60000));
  const r = await page.evaluate(() => {
    const ev = window.__speechEv, sp = window.__shell.audio.ga.speech;
    const lines = [];
    let pend = [];
    for (const e of ev) {
      if (e.ev === 'say') { pend.push({ id: e.id, t: e.t }); if (e.b) pend.push({ id: e.b, t: e.t, b: true }); }
      if (e.ev === 'start') { const k = pend.findIndex((p) => p.id === e.id); if (k >= 0) { const p = pend.splice(k, 1)[0]; lines.push({ id: e.id, lagMs: Math.round(e.t - p.t), b: !!p.b }); } }
    }
    const tr = (window.__le2Trace ?? []).filter((x) => /speech/i.test(x.path)).map((x) => ({ p: x.path.split('/').pop(), ms: x.ms, size: x.size, waited: x.waited }));
    return { n: lines.length, lines, unstarted: pend.map((p) => p.id), speechStats: sp.stats ?? null, reads: tr, route: window.__shell.data?.files?.route ?? null };
  });
  const lags = r.lines.filter((l) => !l.b).map((l) => l.lagMs).sort((a, b) => a - b);
  log('SPEECH-SYNC ' + JSON.stringify(r));
  log(`SPEECH-SYNC-SUMMARY lines=${r.n} (first lines: ${lags.length}) lag ms: min ${lags[0]} median ${lags[Math.floor(lags.length / 2)]} max ${lags[lags.length - 1]} >100ms: ${lags.filter((x) => x > 100).length}`);
};
