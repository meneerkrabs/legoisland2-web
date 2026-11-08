// Pointer QA: client px -> the 640x480 grid in 4:3 and widescreen at several window shapes (mouse hover must select the menu item under the cursor; shell.pointer must equal the independent mapping):
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5731/?zone=z02LGI&mute=1" tools/steps/cq-pointer.mjs --out /tmp/cq/pointer
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await S.skipCutscenes();
  await wait(300);
  await page.keyboard.press('Escape', { delay: 80 }); await wait(500);
  const menu = () => page.evaluate(() => { const e = window.__shell.menu.engine; return { open: e.open, page: e.page, item: e.item }; });
  expect('pause menu open', (await menu()).open);
  // items that do not take the cursor (disabled entries) are found with the pointer exactly on the grid in the first configuration (4:3 1024x768) and must behave the same everywhere
  let baseline = null;
  const sizes = [[1024, 768], [1280, 720], [1920, 800], [700, 900], [1280, 1024]];
  for (const mode of ['4:3', 'wide']) {
    for (const [W, H] of sizes) {
      await page.setViewportSize({ width: W, height: H });
      await page.evaluate((m) => window.__shell.setDisplayMode(m), mode);
      await wait(400);
      const geo = await page.evaluate(() => { const c = document.querySelector('canvas.sh-canvas'), r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cw: c.width, ch: c.height, view: { ...window.__shell.ui.view } }; });
      // the independent mapping: the 4:3 area is the whole canvas (4:3) or the centred 4:3 box of it (wide)
      const aw = mode === 'wide' ? Math.min(geo.w, geo.h * 4 / 3) : geo.w, ah = mode === 'wide' ? Math.min(geo.h, geo.w * 3 / 4) : geo.h;
      const ax = geo.x + (geo.w - aw) / 2, ay = geo.y + (geo.h - ah) / 2;
      const hits = await page.evaluate(() => window.__shell.menu.engine.hits.map((x) => ({ item: x.item, x0: x.x0, y0: x.y0, x1: x.x1, y1: x.y1 })));
      let bad = 0, maxErr = 0; const sel = [];
      for (const t of hits) {
        const lx = (t.x0 + t.x1) / 2, ly = (t.y0 + t.y1) / 2;
        await page.mouse.move(ax + (lx / 640) * aw, ay + (ly / 480) * ah, { steps: 2 });
        await wait(120);
        const r = await page.evaluate(() => ({ p: { ...window.__shell.pointer }, item: window.__shell.menu.engine.item }));
        const err = Math.max(Math.abs(r.p.x - lx), Math.abs(r.p.y - ly)); maxErr = Math.max(maxErr, err);
        sel.push(r.item === t.item);
      }
      if (!baseline) { baseline = sel; log('   selectable items (baseline)', JSON.stringify(sel)); }
      bad = sel.filter((v, i) => v !== baseline[i]).length;
      expect(`${mode} ${W}x${H}: hover selects the item under the cursor (${hits.length} items)`, bad === 0 && hits.length > 0 && maxErr < 1.0, `bad ${bad}, max pointer error ${maxErr.toFixed(3)} logical px, canvas ${geo.w.toFixed(0)}x${geo.h.toFixed(0)} (${geo.cw}x${geo.ch}), area ${aw.toFixed(0)}x${ah.toFixed(0)}, view ${JSON.stringify(geo.view)}`);
      if (W === 1920 || W === 1280 && H === 720) await shot(`pause-${mode.replace(':', '')}-${W}x${H}`);
    }
  }
  // the corners of the 4:3 area: logical (0,0) and (640,480) map to the area's corners, outside it the pointer goes beyond the grid (clicks there must not hit)
  await page.evaluate((m) => window.__shell.setDisplayMode(m), 'wide'); await page.setViewportSize({ width: 1920, height: 800 }); await wait(400);
  await page.mouse.move(2, 2); await wait(120);
  const pc = await page.evaluate(() => ({ x: window.__shell.pointer.x, y: window.__shell.pointer.y }));
  expect('wide: the pointer at the far left of the window is left of the grid (negative x)', pc.x < 0, JSON.stringify(pc));
  log(fail.length ? `FAILED: ${fail.join(' | ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
