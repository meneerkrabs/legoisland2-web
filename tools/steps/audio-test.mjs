// Headless, muted smoke test of the audio engine in the browser (Web Audio really runs, output is muted).
//   npx vite --port 5611 --strictPort &   then
//   node tools/browse.mjs "http://localhost:5611/src/audio/test.html?auto=1&mute=1" tools/steps/audio-test.mjs
export default async ({ page, wait, log, evaluate }) => {
  await page.waitForFunction(() => window.__audio && window.__audio.ga, null, { timeout: 120000 });
  log('ready:', await evaluate(() => document.getElementById('status').textContent));
  const r = await evaluate(async () => {
    const { ga, audio } = window.__audio;
    const out = {};
    out.ctx = { state: audio.ctx.state, rate: audio.ctx.sampleRate };
    // sound effects: 2D one shot, a loop, a 3D sound with cull
    const sel = await ga.sfx.load2D('SND_MENU_SELECT');
    out.select = { buffer: sel.buffer ? +sel.buffer.duration.toFixed(3) : null, native: sel.nativeRate, play: ga.sfx.play2D(sel), again: ga.sfx.play2D(sel), voices: ga.sfx.activeVoices };
    const walk = await ga.sfx.load2D('SND_WALK_GRASS1');
    out.walk = { buffer: walk.buffer ? +walk.buffer.duration.toFixed(3) : null, rateRatio: walk.entry.rate / walk.nativeRate };
    const sea = await ga.sfx.load3D('SND_LGI_SEA');
    ga.sfx.setListener({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 });
    out.sea = { maxDist: sea.maxDist, near: ga.sfx.play3D(sea, { x: 5, y: 0, z: 5 }), playing: sea.playing };
    out.seaFar = { far: ga.sfx.play3D(sea, { x: 5000, y: 0, z: 5000 }), playing: sea.playing, culled: ga.sfx.stats.culled };
    // every table sound decodes?
    let ok = 0, silent = 0; const bad = [];
    for (const e of ga.tables.sounds) {
      if (/^UNDEFINED|PSX ONLY/i.test(e.path)) { silent++; continue; }
      const s = await ga.sfx.load2D(e.id);
      if (s.buffer) ok++; else { silent++; bad.push(e.name); }
      if (ga.sfx.slotCounts.d2 >= 190) ga.sfx.reset();
    }
    out.allSounds = { ok, silent, badSample: bad.slice(0, 20), missing: ga.sfx.stats.missing };
    ga.sfx.reset();
    // speech
    const t0 = performance.now();
    const ids = ['LECSIN01', 'LECSPP02', 'OGSGPO11'];
    out.speech = [];
    for (const id of ids) {
      const idx = ga.tables.speechIndex.get(id);
      const ok2 = ga.speech.say(idx);
      out.speech.push({ id, idx, accepted: ok2, secondWhileBusy: ga.speech.say(idx) });
      await new Promise((res) => { const iv = setInterval(() => { if (ga.speech.idle) { clearInterval(iv); res(); } }, 50); setTimeout(() => { clearInterval(iv); res(); }, 15000); });
    }
    out.speechStats = { ...ga.speech.stats, ms: Math.round(performance.now() - t0) };
    // ambience
    out.ambience = await ga.ambience.start('LGIBirds');
    return out;
  });
  log(JSON.stringify(r, null, 1));
  // music: load and play for a few seconds, read the stream statistics
  for (const key of ['menu', 'Z02LGIM', 'Z41MAP', 'Z02LGIB']) {
    const r2 = await evaluate(async (k) => {
      const { ga } = window.__audio;
      const t0 = performance.now();
      const h = await ga.music.load(k);
      const loadMs = Math.round(performance.now() - t0);
      ga.music.setGroove(-1);
      ga.music.play(h);
      return { key: k, loaded: !!h, loadMs };
    }, key);
    await wait(4000);
    r2.stats = await evaluate(() => window.__audio.ga.music.stats);
    r2.cpuPercent = +(100 * r2.stats.renderMs / 1000 / r2.stats.seconds).toFixed(1);
    log(JSON.stringify(r2));
  }
  await evaluate(() => { const { ga } = window.__audio; ga.music.stopAll(); ga.ambience.stop(); });
};
