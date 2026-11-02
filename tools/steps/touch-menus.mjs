// Touch: the front end's menus with fingers and the on-screen buttons: tap an entry, D-pad + Enter, Esc back, the options screens (sliders by tap), a page with a list.
//   node tools/browse.mjs "http://localhost:5497/?start=frontend&mute=1" tools/steps/touch-menus.mjs --touch --size 844x390 --out /tmp/touch-fe
import { } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot, tap, tapSel, tapPage } = h;
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 120000 });
  await wait(800);
  const menu = () => page.evaluate(() => { const e = window.__shell.menu.engine; return { page: e.page, item: e.item, open: e.open, hits: e.hits.map((x) => ({ item: x.item, x: (x.x0 + x.x1) / 2, y: (x.y0 + x.y1) / 2, sl: x.slider ? [x.slider.x0, x.slider.x1] : null })) }; });
  const btn = (label) => tapSel(`.tc-btn:has(b:text("${label}"))`, 90);
  await page.waitForSelector('.tc-root');
  let m = await menu();
  log('main menu', JSON.stringify({ page: m.page, item: m.item, n: m.hits.length }));
  await shot('01-main');
  // D-pad down + Enter on the main menu moves the cursor and activates
  const pad = await page.locator('.tc-pad').boundingBox();
  const dir = async (dx, dy) => { await h.touchDown(1, pad.x + pad.width / 2 + dx * pad.width * 0.4, pad.y + pad.height / 2 + dy * pad.height * 0.4); await wait(110); await h.touchUp(1); await wait(350); };
  const it0 = m.item;
  await dir(0, 1); m = await menu();
  expect('D-pad down moves the cursor', m.item !== it0, `${it0} -> ${m.item}`);
  await dir(0, -1);
  // tap an entry with a finger: find the "Opties" page by trying entries until the page changes (goto)
  const startPage = (await menu()).page;
  let reached = false;
  for (const hit of (await menu()).hits) {
    await tap(hit.x, hit.y); await wait(700);
    const now = await menu();
    if (now.page !== startPage) { reached = true; log(`tap on item ${hit.item} -> page ${now.page}`); await shot(`02-page-${now.page}`); break; }
  }
  expect('a finger tap on a menu entry opens a sub page', reached);
  const seen = new Set([startPage]);
  // back with the Esc button, then D-pad down + Enter button = Opties (a page with sliders and a key page)
  await btn('Esc'); await wait(700);
  expect('Esc button returns to the main page', (await menu()).page === startPage);
  await dir(0, 1); await btn('Enter'); await wait(800);
  const op = await menu(); seen.add(op.page);
  expect('D-pad + Enter button open the options page', op.page !== startPage, `page ${op.page}`);
  await shot('03-options');
  const slider = op.hits.find((x) => x.sl);
  if (slider) {
    const opts = () => page.evaluate(() => JSON.stringify(Array.from({ length: 24 }, (_, i) => { try { return window.__shell.options.get(i); } catch { return null; } })));
    const before = await opts();
    const sx = slider.sl[0] + (slider.sl[1] - slider.sl[0]) * 0.15;
    await tap(sx, slider.y ?? 0); await wait(400);
    await tap(sx, slider.y ?? 0); await wait(500);
    const after = await opts();
    await shot('04-slider-tapped');
    expect('tapping a slider bar changes the option', before !== after);
  } else log('no slider hit rect on options page; hits', JSON.stringify(op.hits));
  // the key page (key capture needs a keyboard: reachable and leaves with Esc)
  for (const hit of (await menu()).hits) {
    const before = (await menu()).page;
    await tap(hit.x, hit.y); await wait(500);
    const now = await menu();
    if (now.page !== before && now.page !== startPage) { seen.add(now.page); await shot(`05-page-${now.page}`);
      const sl = now.hits.find((x) => x.sl);
      if (sl) {
        const opts = () => page.evaluate(() => JSON.stringify(Array.from(window.__shell.options.a ?? [])));
        const b0 = await opts();
        const w = sl.sl[1] - sl.sl[0];
        await tap(sl.sl[0] + w * 0.15, sl.y); await wait(500);
        await tap(sl.sl[0] + w * 0.85, sl.y); await wait(500);
        expect(`page ${now.page}: tapping slider bars changes the option`, b0 !== (await opts()));
        await shot(`06-slider-${now.page}`);
      }
      await btn('Esc'); await wait(600); }
  }
  log('pages visited', [...seen].join(','));
  // Esc button: back until the main page
  for (let i = 0; i < 6; i++) { await btn('Esc'); await wait(600); if ((await menu()).page === startPage) break; }
  expect('Esc button goes back to the main page', (await menu()).page === startPage, `page ${(await menu()).page}`);
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
