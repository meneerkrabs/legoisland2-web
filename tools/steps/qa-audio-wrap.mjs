// Runs another bot step (INNER=tools/steps/<bot>.mjs) with the audio recorder installed and prints one `AUDIOQA {...}` line at the end: which sounds the zone played by id (2D / 3D, counts), the
// host's missed / lazily loaded / dropped sounds, the SoundEngine counters (loads, played, dropped by a full voice pool, culled by distance, missing files), the speech engine's counters (lines, missing,
// late reads, held ticks), the MIDI ambience starts and the music log (what was scheduled when). No mute=1 (that switches the audio engine off); the browser is muted by the flag.
//   INNER=tools/steps/m6-z10RGB.mjs sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5822/?zone=z10RGB" tools/steps/qa-audio-wrap.mjs --size 800x600
// Without INNER it waits WAIT_MS (default 15000) in the zone (after leaving the intro with Enter like tools/steps/audio-moments.mjs).
// The recorder is installed again after every page load (a bot that reloads the zone gets a new window: the counters then start again, `docs` says how many documents were seen).
export default async (h) => {
  const { page, wait, log, key } = h;
  let docs = 0;
  const install = async () => {
    await page.waitForFunction(() => window.__zone && window.__zone.machine && window.__shell && window.__shell.audio && window.__shell.audio.ga, null, { timeout: 600000 }).catch(() => {});
    const fresh = await page.evaluate(() => {
      if (window.__aq || !(window.__shell && window.__shell.audio && window.__shell.audio.ga)) return false;
      const a = window.__shell.audio, ga = a.ga, sfx = ga.sfx, R = (window.__aq = { play: {}, first: {}, t0: ga.ctx.currentTime, zone: window.__zone.info.archive });
      const wrap = (name, kind) => {
        const orig = sfx[name].bind(sfx);
        sfx[name] = (slot, ...rest) => {
          const k = `${kind}:${slot.id}:${slot.entry?.name ?? ''}`;
          const r = orig(slot, ...rest);
          const e = (R.play[k] ??= { calls: 0, nobuf: 0 });
          e.calls++; if (!slot.buffer) e.nobuf++;
          if (r && !(k in R.first)) R.first[k] = +(ga.ctx.currentTime - R.t0).toFixed(2);
          return r;
        };
      };
      wrap('play2D', '2d'); wrap('play3D', '3d');
      // the MIDI ambience beds: when each start was asked for, whether it began (files found) and when
      R.amb = [];
      { const amb = ga.ambience, st = amb.start.bind(amb); amb.start = async (k) => { const t = ga.ctx.currentTime; const ok = await st(k); R.amb.push(`asked ${(t - R.t0).toFixed(2)} ${k} ok=${ok} running@${(ga.ctx.currentTime - R.t0).toFixed(2)}`); return ok; }; }
      return true;
    }).catch(() => false);
    if (fresh) docs++;
  };
  await install();
  page.on('load', () => { install().catch(() => {}); });
  if (process.env.INNER) {
    const mod = await import(new URL(process.env.INNER, 'file://' + process.cwd() + '/').href);
    try { await mod.default(h); } catch (e) { log('[inner error] ' + (e.stack ?? e)); }
  } else {
    for (let i = 0; i < 100; i++) {
      const m = await page.evaluate(() => window.__zone.machine.mode).catch(() => -1);
      if (m === 2 || m === -1) break;
      if (m === 1 || m === 9 || m === 10) await key('Enter');
      await wait(600);
    }
    await wait(Number(process.env.WAIT_MS ?? 15000));
  }
  await install();
  const r = await page.evaluate(() => {
    const a = window.__shell.audio, ga = a.ga, R = window.__aq, z = window.__zone;
    return {
      nobuf: [...ga.sfx.slots2d, ...ga.sfx.slots3d].filter((x) => !x.buffer).map((x) => `${x.kind}:${x.entry && x.entry.name ? x.entry.name : x.id}`),
      amb: R.amb, ambNow: ga.ambience.current,
      zone: z ? z.info.archive : 'gone', mode: z && z.machine ? z.machine.mode : -1, seconds: +(ga.ctx.currentTime - R.t0).toFixed(1), firstZone: R.zone,
      played: Object.entries(R.play).map(([k, v]) => `${k} x${v.calls}${v.nobuf ? ' NOBUF' : ''} @${R.first[k] ?? '-'}`),
      missed: [...a.missed], host: a.stats, sfx: ga.sfx.stats, voices: ga.sfx.activeVoices, slots: ga.sfx.slotCounts, speech: ga.speech.stats,
      music: ga.music.log.map((e) => `${e.t.toFixed(2)} ${e.what} ${e.key ?? ''}${e.at !== undefined ? ' at ' + e.at.toFixed(2) : ''}${e.value !== undefined ? ' ' + e.value : ''}`),
      hostLog: a.log.map((e) => `${e.t.toFixed(2)} ${e.what} ${e.detail ?? ''}`).slice(-40),
    };
  });
  log('AUDIOQA ' + JSON.stringify({ ...r, docs }));
};
