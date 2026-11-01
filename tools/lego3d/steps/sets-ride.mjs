// The set vehicles in their gameplay state (headless, muted): Pepper takes the vehicle (Ctrl next to it) and drives it (Space / arrows); a shot every GAP ticks with the game's own chase camera.
//   MOD=<mod folder> | RM=1 | (nothing: whatever mods the profile has)   RIDE=JSKI|SPBT|RHEL|SPD0   N=shots (default 6)   GAP=ticks (default 20)   PREFIX=name   KEYS="ArrowUp" (held while driving, default Space)
import { island } from '../../steps/lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot, evaluate } = h;
  page.on('dialog', (d) => d.accept());
  const S = island(h);
  await page.waitForSelector('.bdb-start', { timeout: 60000 }).catch(() => {});
  if (process.env.MOD || process.env.RM) {
    await page.click('.bdb-mods > summary').catch(() => {}); await wait(400);
    for (let i = 0; i < 5; i++) {
      const rm = page.locator('.bdb-mod').filter({ hasText: process.env.MODTITLE ?? 'LEGO 3D' }).locator('button').last();
      if (!(await rm.count())) break;
      await rm.click().catch(() => {}); await wait(500);
    }
    if (process.env.MOD) {
      await page.locator('.bdb-mods input[type=file]').nth(1).setInputFiles(process.env.MOD);
      await page.waitForFunction(() => !document.querySelector('.bdb-mods').classList.contains('bdb-busy') && /toegevoegd|geïmporteerd|klaar|imported/i.test(document.querySelector('.bdb-modstatus')?.textContent ?? ''), null, { timeout: 180000 }).catch(() => {});
    }
  }
  await page.goto(`${process.env.BASE ?? 'http://localhost:5742/'}?zone=z02LGI&mute=1${process.env.PARAMS ?? ""}`, { waitUntil: 'load' });
  await S.start(); await S.skipCutscenes();
  const name = process.env.RIDE ?? 'JSKI', prefix = process.env.PREFIX ?? 'ride';
  const rec = await S.rec(name);
  await S.teleportNear(name, 3, 0.6); await wait(500);
  await evaluate((n) => { const r = window.__zone.world.records.find((x) => x.name === n); if (r?.ctrl) r.ctrl.flags |= 2; }, name);
  await S.tap('ControlLeft', 120);
  await wait(800);
  log('state after Ctrl', JSON.stringify(await S.state()), JSON.stringify(await S.rec(name)));
  if (process.env.CAM) {   // CAM="side,back,up" in the vehicle's own frame (default 5,-7,3): a close camera that follows the record
    const [cs, cb, cu] = process.env.CAM.split(',').map(Number);
    await evaluate(([cs, cb, cu, n]) => {
      const zz = window.__zone, w = zz.world, r = w.records.find((x) => x.name === n);
      const cam = w.camera;
      if (!cam.__uv) { cam.__uv = cam.updateView.bind(cam); }
      cam.updateView = function () { const c = this.c, a = r.ry ?? 0, sa = Math.sin(a), ca = Math.cos(a); c[0] = r.x + sa * cb + ca * cs; c[1] = r.y + cu; c[2] = r.z + ca * cb - sa * cs; c[3] = r.x; c[4] = r.y + 1.2; c[5] = r.z; cam.__uv(); };
    }, [cs, cb, cu, name]);
  }
  const key = process.env.KEYS ?? 'Space';
  await page.keyboard.down(key);
  for (let k = 0; k < +(process.env.N ?? 6); k++) {
    await S.untilTicks(async () => false, +(process.env.GAP ?? 20), 40);
    await shot(`${prefix}-${name}-${k}`);
    log(k, JSON.stringify(await S.rec(name)));
  }
  await page.keyboard.up(key);
};
