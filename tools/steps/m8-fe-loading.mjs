// WP-SHELL: the loading card over the front end's first fade-in and the particle smoke of the train (headless, muted):
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5531/?start=frontend&mute=1" tools/steps/m8-fe-loading.mjs --size 1024x768 --out /tmp/m8-fe
export default async ({ page, shot, wait, log }) => {
  await page.waitForFunction(() => window.__fe, null, { timeout: 300000 });
  // the fade-in is 17 ticks (about 0.6 s): grab frames as fast as possible
  const t0 = Date.now();
  await shot('fe-fadein-1');
  const m1 = await page.evaluate(() => ({ mode: window.__fe.mode, tick: window.__feWorld.tickCount }));
  await shot('fe-fadein-2');
  log('fade-in shots after', Date.now() - t0, 'ms, state', JSON.stringify(m1));
  await page.waitForFunction(() => window.__fe.mode === 2, null, { timeout: 30000 });
  await wait(1000);
  await shot('fe-menu');
  // the train: waits 300 ticks (10 s), then rides 180 ticks: wait for it to be on the viaduct and look at the smoke
  const smoke = await page.evaluate(() => {
    const p = window.__particles; return p ? { handles: [0, 1].map((h) => p.liveParticles(h)), stats: p.stats } : null;
  });
  log('particles after 1 s', JSON.stringify(smoke));
  // wait for the train to ride past (x from 64 to -64 in 180 ticks after 300 ticks of waiting) and look at the smoke it leaves
  const t1 = Date.now();
  let shots = 0, maxVisible = 0;
  while (Date.now() - t1 < 60000 && shots < 3) {
    const st = await page.evaluate(() => ({ x: window.__feWorld.records[44].x, tick: window.__feWorld.tickCount, stats: window.__particles?.stats, live: window.__particles?.liveParticles(1) }));
    if (st.stats && st.stats.visible >= 3 && st.stats.polygons >= 8) { await shot(`fe-train-${shots++}`); maxVisible = Math.max(maxVisible, st.stats?.visible ?? 0); log('train', JSON.stringify(st)); await wait(900); } else await wait(400);
  }
  log('max visible smoke sprites', maxVisible);
};
