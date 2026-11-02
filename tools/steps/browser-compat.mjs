// Cross-browser smoke test (webkit / firefox / chromium), one scenario per URL; compare the three engines. Prints "ok"/"FAIL" lines.
//   front end : node tools/browse.mjs "http://localhost:5497/?start=frontend&mute=1" tools/steps/browser-compat.mjs --browser webkit --out /tmp/bc/w
//   island    : node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&mute=1"    tools/steps/browser-compat.mjs --browser firefox --out /tmp/bc/f
//   start     : node tools/browse.mjs "http://localhost:5497/?mute=1"                tools/steps/browser-compat.mjs --browser webkit
//   lego 3d   : ...?zone=z02LGI&lego3d=1&mute=1  (checks window.__lego3d)       hd: ...?zone=z02LGI&hd=1&mute=1
//   movie     : ...?play=1&movie=SdLogo&mute=1
//   save      : BC_SAVE=save|load, see tools/steps/browser-save.mjs
// The scenario is chosen from the URL. Screenshots go to --out; LOOK at them.
import { island } from './lib-island.mjs';
export default async ({ page, shot, wait, log, key, click, evaluate }) => {
  const q = new URL(page.url()).searchParams;
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const prefix = process.env.BC_NAME ?? 'bc';
  const info = await page.evaluate(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); return { ua: navigator.userAgent.replace(/.*(Firefox|Version|Chrome)\/([\d.]+).*/, '$1 $2'), gl: !!gl }; });
  log('engine', info.ua, 'webgl2', info.gl);
  if (q.has('movie')) {
    await wait(5000); await shot(`${prefix}-movie-5s`);
    const st = await page.evaluate(() => window.__le2Movies ?? null);
    log('movie stats', JSON.stringify(st));
    await wait(5000); await shot(`${prefix}-movie-10s`);
  } else if (q.get('start') === 'frontend') {
    await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 120000 });
    await wait(1500); await shot(`${prefix}-fe-menu`);
    const st = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item }; });
    expect('main menu page 0', (await st()).page === 0);
    const i0 = (await st()).item;
    await key('ArrowDown'); await wait(300);
    expect('selection moved', (await st()).item !== i0, `${i0} -> ${(await st()).item}`);
    for (let i = 0; i < 12 && (await st()).item !== 2; i++) { await key('ArrowDown'); await wait(250); }   // Opties
    await key('Enter'); await wait(800);
    expect('options page opened', (await st()).page === 4, JSON.stringify(await st()));
    await shot(`${prefix}-fe-options`);
    await key('Escape'); await wait(500);
    expect('back to main menu', (await st()).page === 0);
  } else if (q.has('zone') || q.has('save')) {
    await page.waitForFunction(() => window.__zone && window.__zone.machine && (window.__zone.machine.mode === 1 || window.__zone.machine.mode === 2), null, { timeout: 240000 });
    const tick = () => page.evaluate(() => window.__zone.world.tickCount);
    await wait(3000);
    const t0 = await tick(); await wait(2000); const t1 = await tick();
    expect('game ticks advance', t1 > t0 + 10, `${t0} -> ${t1}`);
    await shot(`${prefix}-zone-a`);
    if (q.get('zone') === 'z02LGI') { const S = island({ page, wait, log, shot }); await S.skipCutscenes(); await wait(500); await shot(`${prefix}-zone-island`); }
    const p0 = await page.evaluate(() => { const p = window.__zone.world.focus; return [p.x, p.z]; });
    await page.keyboard.down('ArrowUp'); await wait(1500); await page.keyboard.up('ArrowUp');
    const p1 = await page.evaluate(() => { const p = window.__zone.world.focus; return [p.x, p.z]; });
    expect('Pepper moves with the arrow key', Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 0.5, JSON.stringify([p0, p1]));
    await shot(`${prefix}-zone-b`);
    const l3 = await page.evaluate(() => window.__lego3d ?? null);
    if (l3) log('lego3d', JSON.stringify(l3).slice(0, 400));
    const mods = await page.evaluate(() => { const m = window.__le2Mods; return m ? { mods: m.mods, layerFiles: m.layer?.files?.size ?? null } : null; });
    if (mods) log('mods', JSON.stringify(mods));
  } else {
    await page.waitForSelector('#le2-mode', { timeout: 30000 }); await wait(500);
    await shot(`${prefix}-start`);
    const sel = await page.$('#le2-mode'); await sel.selectOption('wide');
    const skip = await page.$('#le2-skipintro'); await skip.check();
    expect('options respond', (await page.evaluate(() => JSON.parse(localStorage.getItem('le2-display') ?? '{}'))).mode === 'wide');
    await page.evaluate(() => document.querySelector('details.note summary')?.click());
    await shot(`${prefix}-start-opts`);
    log('compat notice', JSON.stringify(await page.evaluate(() => document.getElementById('le2-compat')?.innerText ?? null)));
  }
  if (fail.length) { log('FAILED:', fail.join('; ')); process.exitCode = 1; }
};
