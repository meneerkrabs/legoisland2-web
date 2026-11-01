// (copy of sets-zone.mjs for the surfaces: no mod import, PARAMS='&hd=0&lego3d=1' in the URL.) A record of another zone (the z38PAR / z22BIP seaplane ...) seen from a fixed camera, headless + muted.
//   MOD=<folder> | RM=1   ZONE=z38PAR REC=PLNE DIST=40 ANGS=0.7/3.6 CAMH=0.3 LOOKH=0.0 PREFIX=z38
export default async ({ page, wait, log, shot, evaluate }) => {
  page.on('dialog', (d) => d.accept());
  await page.waitForSelector('.bdb-start', { timeout: 60000 }).catch(() => {});
  await page.goto(`${process.env.BASE ?? 'http://localhost:5743/'}?zone=${process.env.ZONE}&mute=1${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode !== 7 && window.__zone.machine.mode !== 0 && window.__zone.world.tickCount >= 0, process.env.ZONE, { timeout: 240000 });
  await wait(2500);
  for (let i = 0; i < +(process.env.KEYS ?? 3); i++) { await page.keyboard.press('Space'); await wait(900); }   // the zone's intro / help panels
  await wait(1500);
  const rec = process.env.REC, d = +(process.env.DIST ?? 30), ch = +(process.env.CAMH ?? 0.3), lh = +(process.env.LOOKH ?? 0);
  for (const ang of (process.env.ANGS ?? '0.7').split('/')) {
    await evaluate(([n, d, a, ch, lh]) => {
      const zz = window.__zone, w = zz.world, r = w.records.find((x) => x.name === n), cam = w.camera;
      if (!cam.__uv) cam.__uv = cam.updateView.bind(cam);
      cam.updateView = function () { const c = this.c; c[0] = r.x + Math.sin(a) * d; c[1] = r.y + d * ch; c[2] = r.z + Math.cos(a) * d; c[3] = r.x; c[4] = r.y + d * lh; c[5] = r.z; cam.__uv(); };
    }, [rec, d, +ang, ch, lh]);
    await wait(1500);
    await shot(`${process.env.PREFIX ?? 'zone'}-${rec}-${ang}`);
    log(rec, ang, JSON.stringify(await evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? [r.x, r.y, r.z].map((v) => +v.toFixed(1)) : null; }, rec)), JSON.stringify(await evaluate(() => { const i = window.__zone.gr.info; return { draws: i.draws, triangles: i.triangles }; })));
  }
};
