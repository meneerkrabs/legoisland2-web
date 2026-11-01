// Headless before / after gallery of the LEGO 3D characters (docs/re/lego3d.md): one shot per (record, view). Run through the bot slot, snapshot server (port 5741 for the characters worker):
//   MOD=<mod folder> | OFF=1   ZONE=z02LGI   SHOTS="INFO:front:3;INFO:side:3;PEPP:back:3"   PREFIX=g1   sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:5741/ tools/lego3d/steps/chars-gallery.mjs --profile ... --size 800x600 --out DIR
// SHOTS entries: RECORD:view:distance[:lookHeight]  with view = front | side | back | three | up ; the camera follows the record every frame (a harness patch of the camera in the page, no engine change); distance in character heights.
export default async ({ page, shot, wait, log, evaluate }) => {
  page.on('dialog', (d) => d.accept());
  const base = new URL(page.url()).origin + '/';
  await page.waitForSelector('.bdb-start');
  if (process.env.MOD) {
    for (let i = 0; i < 5; i++) { const rm = page.locator('.bdb-mod').filter({ hasText: 'LEGO 3D (generated)' }).locator('button').last(); if (!(await rm.count())) break; await rm.click().catch(() => {}); await wait(500); }
    await page.click('.bdb-mods > summary').catch(() => {});
    await page.locator('.bdb-mods input[type=file]').nth(1).setInputFiles(process.env.MOD);
    await page.waitForFunction(() => !document.querySelector('.bdb-mods').classList.contains('bdb-busy') && /toegevoegd|geïmporteerd|klaar|imported/i.test(document.querySelector('.bdb-modstatus')?.textContent ?? ''), null, { timeout: 180000 }).catch(() => {});
    log('mod status:', await page.evaluate(() => document.querySelector('.bdb-modstatus')?.textContent?.slice(0, 120)));
  } else if (!process.env.OFF) {
    // nothing imported: the profile may still hold the mod from an earlier run; OFF=1 plays the original
  }
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'g';
  await page.goto(`${base}?zone=${zone}&mute=1${process.env.OFF ? '&mods=off' : ''}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount > 5 && window.__zone.machine.mode === 2, null, { timeout: 600000 });
  await wait(1500);
  for (let i = 0; i < 80; i++) {
    if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) { await wait(250); if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) break; continue; }
    await page.keyboard.down('ShiftLeft'); await wait(60); await page.keyboard.up('ShiftLeft'); await wait(120);
  }
  log('active mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  for (const spec of (process.env.SHOTS ?? 'INFO:front:3').split(';')) {
    const [name, view = 'front', dist = '3', look = '0.45'] = spec.split(':');
    const ok = await evaluate(([name, view, dist, look]) => {
      const zz = window.__zone, w = zz.world, rec = w.records.find((r) => r.name === name && r.model);
      if (!rec) return false;
      const p = zz.loaded.pepper;
      const place = () => { const m = rec.m, sc = Math.max(Math.abs(rec.scale?.[1] ?? 1), 0.01); return { m, sc }; };
      const { m, sc } = place();
      p.x = m[12] + 8 * sc; p.z = m[14] + 8 * sc; p.savePrev?.(); w.camera.init(p);
      if (!w.camera.__chase) w.camera.__chase = w.camera.chase;
      w.camera.chase = function () {
        const { m, sc } = place(), c = this.c;
        let fx = m[8], fz = m[10]; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        const ang = { front: 0, side: Math.PI / 2, back: Math.PI, three: Math.PI / 4, up: 0 }[view] ?? 0, ca = Math.cos(ang), sa = Math.sin(ang);
        const dx = fx * ca + fz * sa, dz = -fx * sa + fz * ca, d = +dist * 4.2 * sc;
        c[3] = m[12]; c[4] = m[13] + 2.4 * sc * +look * 2; c[5] = m[14];
        c[0] = m[12] + dx * d; c[1] = m[13] + 2.4 * sc * (view === 'up' ? 0.2 : 0.9); c[2] = m[14] + dz * d;
        this.updateView();
      };
      return true;
    }, [name, view, dist, look]);
    if (!ok) { log(name, 'no such record'); continue; }
    await wait(+(process.env.SETTLE ?? 1500));
    await shot(`${prefix}-${zone}-${name}-${view}${dist === '3' ? '' : dist}`);
  }
};
