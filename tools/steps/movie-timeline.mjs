// Like movie.mjs, but logs wall-clock time against the page's clocks every 10 s (to check the playback timing).
export default async ({ page, wait, log, evaluate }) => {
  const t0 = Date.now();
  const timer = setInterval(async () => {
    const s = await evaluate(() => ({ perf: +(performance.now() / 1000).toFixed(1), movies: (window.__le2Movies ?? []).length, summary: !!document.getElementById('le2-summary') })).catch(() => null);
    log(`t=${((Date.now() - t0) / 1000).toFixed(1)}s page=${s?.perf}s movies done=${s?.movies} summary=${s?.summary}`);
  }, 10000);
  await page.waitForSelector('#le2-summary', { timeout: 240000 });
  clearInterval(timer);
  log(`summary at ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(JSON.stringify(await evaluate(() => window.__le2Movies.map((m) => ({ name: m.name, frames: m.frames, startup: m.startupSeconds, wall: m.wallSeconds, media: m.mediaSeconds, audio: m.audioFrames, stalls: m.stalls })))));
};
