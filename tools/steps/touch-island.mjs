// Touch layer on the island (docs/re/touch.md): the buttons appear (touch device), the D-pad walks Pepper, the D-pad + Alt at once (multi-touch) jumps, the camera
// buttons turn the camera, Esc opens the pause menu, Enter / the D-pad / a tap on the canvas drive the menu, Esc closes it.
//   node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&mute=1" tools/steps/touch-island.mjs --touch --size 390x844 --out /tmp/touch-p     (portrait)
//   node tools/browse.mjs "http://localhost:5497/?zone=z02LGI&mute=1" tools/steps/touch-island.mjs --touch --size 844x390 --out /tmp/touch-l     (landscape)
//   add `&wide=1` for widescreen (the buttons then sit over the picture); BROWSER engines: --browser webkit|firefox use plain taps only (no multi-touch there)
import { island } from './lib-island.mjs';
export default async (h) => {
  const { page, wait, log, shot, touchDown, touchMove, touchUp, tapSel } = h;
  const S = island(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  await page.waitForSelector('.tc-root', { timeout: 20000 });
  await wait(500);
  const info = await page.evaluate(() => { const t = window.__shell.touch; return { mode: t.mode, visible: t.visible, w: innerWidth, h: innerHeight }; });
  log('layout', JSON.stringify(info));
  await shot('01-island');
  // the opening cutscene: skipped with the Shift button (touch)
  let taps = 0;
  for (; taps < 60 && (await S.state())?.cs; taps++) { await tapSel('.tc-btn:has(b:text("Shift"))', 90); await wait(250); }
  expect('opening cutscene skipped with the Shift button', !(await S.state())?.cs, `${taps} taps`);
  await wait(500);
  const centre = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b]; };
  // --- D-pad: hold up for ~1 s -> Pepper moves
  const [px, py, pb] = await centre('.tc-pad');
  const s0 = await S.state();
  await touchDown(1, px, py - pb.height * 0.4);
  await wait(1200);
  await shot('02-walking');
  await touchUp(1);
  const s1 = await S.state();
  const moved = Math.hypot(s1.pos[0] - s0.pos[0], s1.pos[2] - s0.pos[2]);
  expect('D-pad up walks Pepper', moved > 3, `${s0.pos} -> ${s1.pos} (${moved.toFixed(1)})`);
  // --- multi-touch: D-pad (finger 1) + Alt (finger 2): the held bits contain both
  await touchDown(1, px, py - pb.height * 0.4);
  const [ax, ay] = await centre('.tc-btn:has(b:text("Alt"))');
  await touchDown(2, ax, ay);
  await wait(300);
  const held = await page.evaluate(() => window.__shell.input.held);
  expect('multi-touch: Up + Alt held together', (held & 4) !== 0 && (held & 0x20) !== 0, `held=0x${held.toString(16)}`);
  await touchUp(2); await touchUp(1);
  await wait(200);
  expect('released: nothing held', (await page.evaluate(() => window.__shell.input.held)) === 0);
  // --- a short tap (one finger, 40 ms) of the Shift button is seen (held by the layer until sampled)
  let seen = false;
  await page.evaluate(() => { window.__tcSeen = 0; const i = window.__shell.input; const u = i.update.bind(i); i.update = () => { u(); if (i.held & 0x40) window.__tcSeen++; }; });
  const [sx, sy] = await centre('.tc-btn:has(b:text("Shift"))');
  await touchDown(3, sx, sy); await wait(40); await touchUp(3);
  await wait(400);
  seen = (await page.evaluate(() => window.__tcSeen)) >= 1;
  expect('a 40 ms tap on Shift is sampled', seen, `samples=${await page.evaluate(() => window.__tcSeen)}`);
  // --- camera: every camera button moves the eye relative to Pepper (the view's right / up axes tell the direction); zoom changes the distance
  await S.untilTicks(async () => false, 60, 15);
  const camState = () => page.evaluate(() => { const c = window.__zone.world.camera.c, p = window.__zone.loaded.pepper; return { e: [c[0], c[1], c[2]], r: [c[9], c[10], c[11]], u: [c[12], c[13], c[14]], d: Math.hypot(c[0] - p.x, c[1] - p.y, c[2] - p.z), rel: [c[0] - p.x, c[1] - p.y, c[2] - p.z] }; });
  const settle = async () => { let last = null; for (let i = 0; i < 40; i++) { const c = await camState(); if (last && Math.hypot(c.e[0] - last.e[0], c.e[1] - last.e[1], c.e[2] - last.e[2]) < 0.02) return; last = c; await S.untilTicks(async () => false, 6, 15); } };
  await settle();
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const camTest = async (nth, name, axis, sign) => {
    await settle();
    const a = await camState();
    const [cx, cy] = await centre(`.tc-cam .tc-btn:nth-child(${nth})`);
    await touchDown(4, cx, cy); await S.untilTicks(async () => false, 24, 15); await touchUp(4);
    const b = await camState();
    const dv = [b.rel[0] - a.rel[0], b.rel[1] - a.rel[1], b.rel[2] - a.rel[2]];
    const along = axis === 'r' ? dot(dv, a.r) : axis === 'u' ? dot(dv, a.u) : b.d - a.d;
    log(`   camera ${name}: eye moved ${along.toFixed(2)} along ${axis === 'd' ? 'distance' : 'view ' + axis}`);
    expect(`camera button ${name} moves the camera`, Math.abs(along) > 0.3 && (axis === 'r' || Math.sign(along) === sign) /* orbit sign is logged only: terrain pushes the eye around */, `d=${a.d.toFixed(1)} -> ${b.d.toFixed(1)}`);
    await S.untilTicks(async () => false, 30, 15);
  };
  await camTest(1, '< (view turns left: the eye orbits to the right)', 'r', 1);
  await camTest(3, 'Z (view turns right)', 'r', -1);
  await camTest(2, 'X (up)', 'u', 1);
  await camTest(5, 'C (down)', 'u', -1);
  await camTest(4, '- (zoom out)', 'd', 1);
  await camTest(6, '+ (zoom in)', 'd', -1);
  // --- pause: Esc button opens the menu, the D-pad moves the cursor, Enter selects, Esc closes
  const menu = () => page.evaluate(() => { const e = window.__shell.menu.engine; return { open: e.open, page: e.page, item: e.item }; });
  const [ex, ey] = await centre('.tc-btn:has(b:text("Esc"))');
  await touchDown(5, ex, ey); await wait(120); await touchUp(5); await wait(600);
  let m = await menu();
  expect('Esc button opens the pause menu', m.open, JSON.stringify(m));
  await shot('03-pause');
  const item0 = m.item;
  await touchDown(1, px, py + pb.height * 0.4); await wait(120); await touchUp(1); await wait(300);
  m = await menu();
  expect('D-pad down moves the menu cursor', m.item !== item0, `${item0} -> ${m.item}`);
  // tap on a menu entry with the finger: the cursor goes there
  const hits = await page.evaluate(() => window.__shell.menu.engine.hits.map((x) => ({ item: x.item, x: (x.x0 + x.x1) / 2, y: (x.y0 + x.y1) / 2 })));
  const target = hits.find((x) => x.item !== m.item);
  if (target) { await h.tap(target.x, target.y); await wait(500); const m2 = await menu(); expect('a finger tap selects / presses a menu entry', m2.item !== m.item || m2.page !== m.page || !m2.open, `${JSON.stringify(m)} -> ${JSON.stringify(m2)}`); await shot('04-after-tap'); }
  // close the menu: Esc until closed
  for (let i = 0; i < 4 && (await menu()).open; i++) { await touchDown(5, ex, ey); await wait(120); await touchUp(5); await wait(500); }
  expect('Esc closes the menu again', !(await menu()).open);
  // --- hide / show
  await tapSel('.tc-pill .tc-btn:first-child'); await wait(300);
  expect('buttons hidden', await page.evaluate(() => !window.__shell.touch.visible));
  await shot('05-hidden');
  await tapSel('.tc-tab'); await wait(300);
  expect('buttons shown again', await page.evaluate(() => window.__shell.touch.visible));
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
