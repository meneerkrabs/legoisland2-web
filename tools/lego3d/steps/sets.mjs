// Before / after screenshots of the LEGO 3D set models in the game (headless, muted). The vehicle stays where it is (AI off), Pepper hides `dist` units away at an angle.
//   sh tools/m4-snapshot-server.sh 5742
//   MOD=<mod folder> PREFIX=after sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5742/" tools/lego3d/steps/sets.mjs --profile /tmp/le2-sets --size 800x600 --out /tmp/l3d/w2/shots
//   OFF=1 PREFIX=before ...   (baseline: the page opens with &mods=off)
// env: MOVE=n (n shots of the running vehicle, GAP ticks apart), RM=1 (remove the imported LEGO 3D mod: baseline with the same other mods), MOD (import the folder; replaces an earlier copy of the same title), OFF, ZONE (default z02LGI), PREFIX, SCENES="REC:dist:ang1/ang2/...;REC2:..." (default list below), PERF=1 (render ms per scene)
import { island } from '../../steps/lib-island.mjs';
const DEF = 'AMBU:13:0.9/3.9;JSKI:11:4.0/1.2;SPD0:13:0.9/3.9;RHEL:16:0.9/3.9;SPBT:15:0.9/3.9;DNGY:9:0.9/3.9;TRNL:20:0.9/3.9';
export default async (h) => {
  const { page, wait, log, shot, evaluate } = h;
  page.on('dialog', (d) => d.accept());
  const S = island(h);
  const base = process.env.BASE ?? 'http://localhost:5742/';
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
    log('mod status:', await page.evaluate(() => document.querySelector('.bdb-modstatus')?.textContent?.slice(0, 200)));
    }
  }
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'sets';
  await page.goto(`${base}?zone=${zone}&mute=1${process.env.OFF ? '&mods=off' : ''}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  await S.start();
  await S.skipCutscenes();
  log('active mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  const stat = () => evaluate(() => { const i = window.__zone.gr.info; return { draws: i.draws, triangles: i.triangles }; });
  for (const sc of (process.env.SCENES ?? DEF).split(';')) {
    const [name, dist, angs, camh = '0.35', lookh = '0.25'] = sc.split(':');   // camh / lookh: camera / target height as a fraction of dist
    for (const ang of (angs ?? '0.9').split('/')) {
      await evaluate(([n, mv]) => { const r = window.__zone.world.records.find((x) => x.name === n); if (r?.ctrl && !mv) r.ctrl.flags &= ~2; window.__zone.loaded.pepper.flags &= ~2; }, [name, !!process.env.MOVE]);
      await S.teleportNear(name, +dist, +ang); await wait(300);
      await S.teleportNear(name, +dist, +ang);
      // a fixed camera around the (frozen) vehicle: yaw `ang` (rad), `dist` away, at camh * dist above it
      await evaluate(([n, d, a, ch, lh]) => {
        const zz = window.__zone, w = zz.world, r = w.records.find((x) => x.name === n);
        if (!w.camera.__chase) w.camera.__chase = w.camera.chase;
        w.camera.chase = function () { const c = this.c; c[0] = r.x + Math.sin(a) * d; c[1] = r.y + d * ch; c[2] = r.z + Math.cos(a) * d; c[3] = r.x; c[4] = r.y + d * lh; c[5] = r.z; this.updateView(); };
      }, [name, +dist, +ang, +camh, +lookh]);
      if (process.env.LOOK) {   // LOOK=n: the vehicle's look (Enter-key repaint: a texture list swap by group position) n, as tools/steps/restore-looks.mjs sets it
        await evaluate(([n, part]) => { const z = window.__zone, w = z.world, L = w.ext.get('island.looks'), r = w.records.findIndex((x) => x.name === n), e = L?.entries.find((q) => q.rec === r); if (e) { e.part = part; w.vars.set(e.varIdx, part); } }, [name, +process.env.LOOK]);
        await wait(600);
      }
      await S.untilTicks(async () => false, 90, 40);
      if (process.env.MOVE) {   // the vehicle runs (its AI / the story): the camera follows it, a shot every GAP ticks
        for (let k = 0; k < +(process.env.MOVE); k++) { await shot(`${prefix}-${name}-${ang}-m${k}`); log(name, 'at', JSON.stringify(await S.rec(name))); await S.untilTicks(async () => false, +(process.env.GAP ?? 20), 40); }
        continue;
      }
      if (!process.env.NOSHOT) await shot(`${prefix}-${name}-${ang}`);
      log(name, ang, JSON.stringify(await stat()));
      if (process.env.PERF) {   // CPU + raster time of the game's own render call (gl.finish after it): min / median / p90 over ~3 s, independent of the page's frame cap
        await evaluate(() => { const gr = window.__zone.gr; if (!gr.__wrapped) { const o = gr.render.bind(gr), gl = gr.renderer.gl; gr.render = (...a) => { const t = performance.now(); const r = o(...a); gl.finish(); (window.__rt ??= []).push(performance.now() - t); return r; }; gr.__wrapped = true; } window.__rt = []; });
        await wait(3000);
        log(name, ang, 'render ms', JSON.stringify(await evaluate(() => { const d = [...(window.__rt ?? [])].sort((a, b) => a - b); return { n: d.length, min: +d[0]?.toFixed(2), p50: +d[d.length >> 1]?.toFixed(2), p90: +d[Math.floor(d.length * 0.9)]?.toFixed(2) }; })));
      }
    }
  }
};
