// Frame cost with many characters in view, original against LEGO 3D (docs/re/lego3d.md): the camera is fixed on a crowd, then for a few seconds the time of the game's own render call (CPU skinning + vertex
// lighting + the GL submission, `gl.finish` after it so the raster time is in) is recorded per frame together with the frame's triangle / draw counts. Run original and mod BACK TO BACK on a quiet machine:
//   MOD=<mod folder> | OFF=1   ZONE=z04IFC  CAM="ex,ey,ez,tx,ty,tz" (world coordinates)  SECS=6  PREFIX=perf  sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:5741/ tools/lego3d/steps/chars-perf.mjs --profile /tmp/p --size 800x600 --out DIR
export default async ({ page, shot, wait, log, evaluate }) => {
  page.on('dialog', (d) => d.accept());
  const base = new URL(page.url()).origin + '/';
  await page.waitForSelector('.bdb-start');
  if (process.env.MOD) {
    for (let i = 0; i < 5; i++) { const rm = page.locator('.bdb-mod').filter({ hasText: 'LEGO 3D (generated)' }).locator('button').last(); if (!(await rm.count())) break; await rm.click().catch(() => {}); await wait(500); }
    await page.click('.bdb-mods > summary').catch(() => {});
    await page.locator('.bdb-mods input[type=file]').nth(1).setInputFiles(process.env.MOD);
    await page.waitForFunction(() => !document.querySelector('.bdb-mods').classList.contains('bdb-busy') && /toegevoegd|geïmporteerd|klaar|imported/i.test(document.querySelector('.bdb-modstatus')?.textContent ?? ''), null, { timeout: 180000 }).catch(() => {});
  }
  const zone = process.env.ZONE ?? 'z04IFC', prefix = process.env.PREFIX ?? 'perf';
  await page.goto(`${base}?zone=${zone}&mute=1${process.env.OFF ? '&mods=off' : ''}`, { waitUntil: 'load' });
  for (let i = 0; i < 300; i++) {
    if (await evaluate(() => !!(window.__zone && window.__zone.world.tickCount > 5 && window.__zone.machine.mode === 2))) break;
    await page.keyboard.press('Enter').catch(() => {}); await wait(2000);
  }
  for (let i = 0; i < 80; i++) {
    if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) { await wait(250); if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) break; continue; }
    await page.keyboard.down('ShiftLeft'); await wait(60); await page.keyboard.up('ShiftLeft'); await wait(120);
  }
  await wait(1500);
  const cam = (process.env.CAM ?? '').split(',').map(Number);
  await evaluate((cam) => {
    const zz = window.__zone, gr = zz.gr, gl = gr.renderer.gl;
    if (cam.length === 6) window.__cam = () => { const c = zz.world.camera.c; for (let i = 0; i < 6; i++) c[i] = cam[i]; zz.world.camera.updateView(); };
    if (!gr.__wrapped) { const o = gr.render.bind(gr); gr.render = (...a) => { window.__cam?.(); const t = performance.now(); const r = o(...a); gl.finish(); (window.__rt ??= []).push([performance.now() - t, gr.info.triangles, gr.info.draws]); return r; }; gr.__wrapped = true; }
    window.__rt = [];
  }, cam);
  await wait(+(process.env.SECS ?? 6) * 1000);
  const r = await evaluate(() => { const d = [...(window.__rt ?? [])]; const ms = d.map((x) => x[0]).sort((a, b) => a - b); return { n: d.length, min: +ms[0]?.toFixed(2), median: +ms[ms.length >> 1]?.toFixed(2), p90: +ms[Math.floor(ms.length * 0.9)]?.toFixed(2), triangles: d[d.length >> 1]?.[1], draws: d[d.length >> 1]?.[2] }; });
  log(`${prefix} ${zone} ${process.env.OFF ? 'ORIGINAL' : 'MOD'} render ms:`, JSON.stringify(r));
  await shot(`${prefix}-${zone}-${process.env.OFF ? 'orig' : 'mod'}`);
};
