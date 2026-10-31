// z28HAT hot-air balloon, a LOSS and the other exits, in the headless browser (muted): the pause menu (page 18; the world stands still), a game that ends below 2500 points
// (the dinosaurs are marked as delivered without points, eleven sandbag presses miss Bronty's mouth for -300 each, three hit it, he is freed: 1000 + 4500 - 3300 = 2200, unless a press over the mouth misses as well),
// the failed banner (ADSGMC05, no medal), result menu page 19, Retry (second attempt: no intro cutscene), the pause menu's restart, a second loss (score lowered by hand) and Abort (the story rewinds).
// The keys are real key presses (Shift drops the sandbags); the balloon is moved over / beside Bronty's mouth by the test (`__zone.world.records[153]`), and the dinosaurs are
// skipped with `delivered = 11` (the WIN run covers fetching them).
//   node tools/browse.mjs "http://localhost:5608/?zone=z28HAT&mute=1" tools/steps/m6-z28HAT-loss.mjs --size 1024x640 --out /tmp/m6-z28HAT
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  page.on('pageerror', (e) => { log('PAGEERROR', e.message); fail.push('pageerror ' + e.message); });
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z && z.game ? { mode: z.machine.mode, arch: z.info.archive, tick: z.world.tickCount, attempt: z.ctx.attempt, ...z.game.debug() } : null; });
  const vars = () => page.evaluate(() => ({ hi: __zone.sh.vars.get(0x4a), trophy: __zone.sh.vars.get(0x9d), node: __zone.sh.vars.get(0x58), sub: __zone.sh.vars.get(0x59) }));
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  // the pause menu's restart / abort go through the confirm page (0x14: Annuleren, OK; src/shell/menu.ts case 9): choose OK
  const confirm = async () => {
    await wait(500);
    const m = await menu();
    if (m.open && m.page === 0x14) { for (let i = 0; i < 6 && (await menu()).item !== 2; i++) await press('ArrowDown'); await key('Enter'); }
  };
  const ready = (a) => page.waitForFunction((att) => window.__zone && window.__zone.info.archive === 'z28HAT' && window.__zone.game && window.__zone.ctx.attempt === att && window.__zone.machine.mode === 1, a, { timeout: 300000 });
  const skip = async () => { for (let i = 0; i < 160 && (await dbg()).cutscene; i++) { await page.keyboard.down('ShiftLeft'); await wait(70); await page.keyboard.up('ShiftLeft'); await wait(70); } await wait(600); };
  const startPlay = async () => { await key('Enter'); await wait(500); await key('Enter'); await wait(900); };
  /** over (x, z) with no momentum */
  const park = (dx) => page.evaluate((dx) => {
    const w = __zone.world, S = w.ext.get('z28HAT'), R = S.recs;
    const m = (() => { const b = R.bron, p = b.anim.pose(1); const bm = p.subarray(14 * 16, 14 * 16 + 16); const o = new Float32Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = bm[r * 4] * b.m[c] + bm[r * 4 + 1] * b.m[4 + c] + bm[r * 4 + 2] * b.m[8 + c] + bm[r * 4 + 3] * b.m[12 + c]; return o; })();
    R.hotb.x = m[12] + dx; R.hotb.z = m[14]; R.hotb.savePrev(); S.mom = [0, 0, 0];
  }, dx);
  const tapShift = async () => { await page.keyboard.down('ShiftLeft'); await wait(90); await page.keyboard.up('ShiftLeft'); };

  // ------------------------------------------------------------------------------------------------ attempt 0: intro, pause menu
  await ready(0);
  const v0 = await vars();
  log('start', JSON.stringify(v0));
  await skip();
  await startPlay();
  let s = await dbg();
  expect('play (mode 2)', s.mode === 2, JSON.stringify({ mode: s.mode }));
  await wait(1500);
  await key('Escape'); await wait(600);
  expect('pause menu page 18 (mini-game pause)', (await dbg()).mode === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  const p1 = (await dbg()).tick; await wait(900); const p2 = (await dbg()).tick;
  expect('the world stands still in the pause menu', p1 === p2, `${p1} / ${p2}`);
  await shot('l1-pause');
  await key('Escape'); await wait(700);
  expect('Esc resumes the game', (await dbg()).mode === 2 && (await dbg()).tick > p2);

  // ------------------------------------------------------------------------------------------------ the sandbags: misses, then hits
  await page.evaluate(() => { __zone.world.ext.get('z28HAT').delivered = 11; });
  await wait(300);
  s = await dbg();
  expect('everything counted: the HUD shows the sandbag icon (allDone)', s.allDone, JSON.stringify({ allDone: s.allDone }));
  await shot('l2-all-done');
  const round = async (dx) => {
    await park(dx); await wait(500);
    await tapShift();
    for (let i = 0; i < 80 && (await dbg()).sandbags.some((b) => b.active); i++) await wait(100);
  };
  let sc0 = (await dbg()).score;
  for (let i = 0; i < 11; i++) { await round(45); }
  s = await dbg();
  expect('eleven presses beside the mouth: all misses, -300 each', s.score - sc0 === -3300, `${sc0} -> ${s.score}`);
  expect('Bronty is not hit', s.brontyState !== 3 && s.eatCount === 0, JSON.stringify({ b: s.brontyState, e: s.eatCount }));
  await shot('l3-after-misses');
  // hits: the bags fall straight down while Bronto's head moves, so a press can miss; repeat until he has been hit three times
  for (let i = 0; i < 14 && (await dbg()).eatCount < 3 && (await dbg()).brontyState !== 1; i++) { await round(0); await wait(2600); if (i < 3) await shot(`l4-hit-${i}`); }
  s = await dbg();
  expect('presses over the mouth hit three times (eatCount 3, Bronto freed)', s.eatCount >= 3 || s.brontyState === 1, JSON.stringify({ e: s.eatCount, b: s.brontyState }));
  for (let i = 0; i < 200 && (await dbg()).mode === 2; i++) await wait(100);
  s = await dbg();
  log('end', JSON.stringify({ mode: s.mode, score: s.score, result: s.result }));
  expect('the game ended: result 2 (a score below 2500)', s.result === 2 && s.score < 2500 && s.mode === 4, JSON.stringify({ result: s.result, score: s.score, mode: s.mode }));
  await wait(600); await shot('l5-banner-failed');
  const v1 = await vars();
  expect('no medal: the trophy variable is 0, the hi-score keeps the score', v1.trophy === 0 && v1.hi >= s.score, JSON.stringify(v1));
  await key('Enter'); await wait(800);
  const m1 = await menu();
  expect('result menu page 19 (retry / abort), no outro cutscene without a medal', (await dbg()).mode === 5 && m1.page === 19 && !(await dbg()).cutscene, JSON.stringify(m1));
  await shot('l6-result-menu');

  // ------------------------------------------------------------------------------------------------ retry: a fresh game, no intro cutscene
  await select(1); await press('Enter'); await wait(2500);
  await ready(1);
  s = await dbg();
  expect('retry restarts the zone: attempt 1, score 0, no intro cutscene, balloon back at the start', s.attempt === 1 && s.score === 0 && s.delivered === 0 && !s.cutscene && s.mode === 1, JSON.stringify({ a: s.attempt, score: s.score, cut: s.cutscene, mode: s.mode }));
  expect('the same story node', (await vars()).node === v0.node);
  await shot('l7-retry-brief');
  await startPlay();
  await wait(800);
  expect('play again (mode 2)', (await dbg()).mode === 2);
  // the pause menu's "Opnieuw starten" (item 4, exit state 3) restarts the zone as well
  await key('Escape'); await wait(600);
  expect('pause menu page 18', (await menu()).page === 18, JSON.stringify(await menu()));
  await select(4); await press('Enter'); await confirm(); await wait(2500);
  await ready(2);
  s = await dbg();
  expect('pause menu restart: attempt 2, no intro cutscene', s.attempt === 2 && !s.cutscene && s.mode === 1, JSON.stringify({ a: s.attempt, cut: s.cutscene }));
  await startPlay();

  // ------------------------------------------------------------------------------------------------ a second loss (the score is lowered by hand), then Abort
  await page.evaluate(() => { const S = __zone.world.ext.get('z28HAT'); S.delivered = 11; S.score = -6000; });
  await wait(300);
  for (let i = 0; i < 14 && (await dbg()).eatCount < 3 && (await dbg()).brontyState !== 1; i++) { await round(0); await wait(2600); }
  for (let i = 0; i < 200 && (await dbg()).mode === 2; i++) await wait(100);
  s = await dbg();
  expect('second loss: result 2, banner', s.result === 2 && s.mode === 4, JSON.stringify({ result: s.result, score: s.score, mode: s.mode }));
  await key('Enter'); await wait(800);
  expect('result menu page 19 again', (await menu()).page === 19, JSON.stringify(await menu()));
  await select(2); await press('Enter'); await confirm(); await wait(2500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z28HAT', null, { timeout: 120000 });
  const after = await page.evaluate(() => ({ arch: __zone.info.archive, node: __zone.sh.vars.get(0x58) }));
  log('after abort', JSON.stringify(after));
  expect('Abort leaves the zone and rewinds the story to before the game', after.arch !== 'z28HAT' && after.node < v0.node, JSON.stringify(after));
  await wait(1200); await shot('l8-after-abort');
  if (fail.length) { log(`FAILED: ${fail.join('; ')}`); process.exitCode = 1; } else log('z28HAT loss run passed');
};
