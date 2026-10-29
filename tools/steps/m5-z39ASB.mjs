// M5 audit run of the story part of z39ASB: copy of the M3 step, run against the audit's snapshot server: sh tools/m5-botslot.sh node tools/browse.mjs 'http://localhost:5514/?zone=z39ASB&mute=1&debug=1' tools/steps/m5-z39ASB.mjs --size 1280x800 --out /tmp/m5-z39ASB
// M3 z39ASB (Asteroid Belt), headless and muted, with REAL key input: intro -> help -> flight; a dodging bot flies the whole course (WIN: banner, medal, result menu,
// Continue -> story node 63); then a second run flies without steering (LOSS: five hits, banner, result menu page 19 -> Retry -> a fresh run -> Abort -> back to the hub).
// Also: pause menu (Esc) page 18 and the end of the first-run variables.
//   node tools/browse.mjs "http://localhost:5499/?zone=z39ASB&mute=1&debug=1" tools/steps/m3-z39ASB.mjs --size 1280x800 --out /tmp/m3/z39ASB
// (other workers' edits make the dev server reload the page; a run of ~5 minutes wants a server without HMR / file watching: docs/re/m3/z39ASB.md "How to run")
// (env ASB_QUICK=1 uses the test aids F9 / F10 instead of flying the whole course; the default plays the full course with the bot)
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const st = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null;
    const d = z.game?.debug?.() ?? {};
    return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, node: z.sh.vars.get(0x58), skipped: z.loaded.skipped.length, ...d };
  });
  const waitZone = (arch, mode = 2) => page.waitForFunction(([a, m]) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === m && (m !== 2 || window.__zone.world.tickCount > 3), [arch, mode], { timeout: 300000 });
  const waitMode = (m) => page.waitForFunction((mm) => window.__zone && window.__zone.machine.mode === mm, m, { timeout: 300000 });
  const quick = !!process.env.ASB_QUICK;

  // the bot: runs in the page, returns the keys it wants held ('L' 'R' 'U' 'D' = the arrow keys; ArrowUp makes the shuttle go DOWN)
  const decide = () => page.evaluate(() => {
    const b = window.__zone?.game?.belt;
    if (!b || b.state !== 1) return '';
    const shut = b.recs.shut, cam = b.cam;
    let worst = null;
    for (const a of b.recs.asteroids) {
      const dz = a.z - cam[0 + 2];
      if (dz < -2 || dz > 75) continue;
      const dx = cam[0] - a.x, dy = cam[1] - a.y;
      if (Math.abs(dx) < 5.8 && Math.abs(dy) < 5.5 && (!worst || dz < worst.dz)) worst = { dz, dx, dy };
    }
    if (!worst) return '';
    const needX = 5.8 - Math.abs(worst.dx), needY = 5.5 - Math.abs(worst.dy);
    if (needX <= needY * 1.2) return worst.dx >= 0 ? (shut.x < 16 ? 'R' : 'L') : (shut.x > -16 ? 'L' : 'R');
    return worst.dy >= 0 ? (shut.y < 12 ? 'D' : 'U') : (shut.y > -12 ? 'U' : 'D');
  });
  const KEY = { L: 'ArrowLeft', R: 'ArrowRight', U: 'ArrowUp', D: 'ArrowDown' };
  let down = '';
  const hold = async (want) => {
    if (want === down) return;
    if (down) await page.keyboard.up(KEY[down]);
    if (want) await page.keyboard.down(KEY[want]);
    down = want;
  };
  const release = async () => { await hold(''); };

  // ================================================================================================= run 1: the whole course, WIN
  await waitZone('z39ASB', 1);
  let s = await st();
  expect('z39ASB starts at story node 62, the Shuttle attach is handled (no skipped attaches)', s.node === 62 && s.skipped === 0, JSON.stringify(s));
  expect('intro state: score 10000, hull 1000, shuttle at z -768 + 2.4 (the original runs one update of the node before the loop), camera 396 behind', s.score === 10000 && s.hull === 1000 && Math.abs(s.z + 765.6) < 1e-2 && Math.abs(s.eyeZ + 1165.6) < 1e-2, JSON.stringify(s));
  await wait(700);
  await shot('asb-1-intro');
  await press('Enter'); await wait(500);
  s = await st(); expect('mode 9: the controls help', s.mode === 9, JSON.stringify(s));
  await shot('asb-2-help');
  await press('Enter'); await wait(300);
  s = await st(); expect('mode 2: play', s.mode === 2, JSON.stringify(s));
  await wait(1200); await shot('asb-3-flyin');
  await page.waitForFunction(() => window.__zone.game.belt.state === 1, null, { timeout: 60000 });
  s = await st(); expect('after the fly-in the shuttle is under control (state 1, camera 8 behind)', s.state === 1 && s.camOff === -8, JSON.stringify(s));
  await shot('asb-4-cockpit');

  // pause menu: Esc -> page 18, continue
  await press('Escape'); await wait(500);
  s = await st(); expect('Esc opens the pause menu (mode 3, page 18)', s.mode === 3 && (await menu()).page === 18, JSON.stringify(await menu()));
  const tickP = s.tick; await wait(500);
  expect('the world is frozen while paused', (await st()).tick === tickP);
  await shot('asb-5-pause');
  await press('Escape'); await wait(500);
  s = await st(); expect('Esc again resumes (mode 2)', s.mode === 2, JSON.stringify(s));

  // keys: UP goes down, LEFT goes left (real key events)
  {
    const y0 = (await st()).y;
    await page.keyboard.down('ArrowUp'); await wait(400); await page.keyboard.up('ArrowUp');
    const y1 = (await st()).y;
    expect('ArrowUp moves the shuttle DOWN (inverted controls, "Omlaag gaan")', y1 < y0 - 2, `${y0} -> ${y1}`);
    await page.keyboard.down('ArrowDown'); await wait(400); await page.keyboard.up('ArrowDown');
    const y2 = (await st()).y; expect('ArrowDown moves it up', y2 > y1 + 2, `${y1} -> ${y2}`);
    const x0 = (await st()).x;
    await page.keyboard.down('ArrowLeft'); await wait(400); await page.keyboard.up('ArrowLeft');
    const x1 = (await st()).x; expect('ArrowLeft moves left', x1 < x0 - 2, `${x0} -> ${x1}`);
    await page.keyboard.down('ArrowRight'); await wait(400); await page.keyboard.up('ArrowRight');
    const x2 = (await st()).x; expect('ArrowRight moves right', x2 > x1 + 2, `${x1} -> ${x2}`);
  }
  const hullAfterTests = (await st()).hull;
  expect('steering cost hull and score', hullAfterTests < 1000, String(hullAfterTests));

  if (quick) { await key('F9'); }
  let shots = 0, lastShot = 0, t0 = Date.now(), hitShot = false;
  for (let guard = 0; guard < 12000; guard++) {
    s = await st();
    if (!s || s.mode !== 2) break;
    if (!quick) await hold(await decide()); else await wait(100);
    if (s.z > lastShot + 1500 && shots < 4) { lastShot = s.z; shots++; await shot(`asb-6-flight-${shots}`); }
    if (s.hits > 0 && !hitShot && s.state === 2) { hitShot = true; await shot('asb-6-hit'); }
    if (Date.now() - t0 > 600000) break;
  }
  await release();
  s = await st();
  log('end of run 1', JSON.stringify(s));
  expect('run 1: the course was flown (result 1 = success), mode 4 banner', s.result === 1 && s.mode === 4, JSON.stringify(s));
  const finalScore = s.score;
  expect('run 1: a medal (score > 2000 with a dodging bot; its dodging is timing dependent, the layout is random)', s.score > 2000, String(s.score));
  expect('run 1: hiscore var 0x29 = score, medal var 0x102, trophy var 0x44 raised', s.hiscore === s.score && s.medal === (s.score > 7000 ? 2 : s.score > 5000 ? 1 : 0) && s.trophy === s.medal + 1, JSON.stringify({ h: s.hiscore, m: s.medal, t: s.trophy }));
  await wait(600);
  await shot('asb-7-banner');
  await press('Enter'); await wait(600);
  s = await st(); expect('result menu (mode 5), success page 16', s.mode === 5 && (await menu()).page === 16, JSON.stringify(await menu()));
  await shot('asb-8-result-menu');
  await select(1); await press('Enter'); await wait(1500);       // Doorgaan (continue)
  log('after Continue', JSON.stringify(await page.evaluate(() => ({ az: window.__zone?.info.archive, mode: window.__zone?.machine.mode, node: __shell.vars.get(0x58), menu: __shell.menu.engine.page + '/' + __shell.menu.engine.item }))));
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive !== 'z39ASB' && (window.__zone.machine.mode === 1 || window.__zone.world.tickCount > 3), null, { timeout: 60000 });
  s = await st();
  expect('Continue: the story advanced to node 63 (z40aPO)', s.node === 63 && s.arch === 'z40aPO', JSON.stringify(s));
  const trophyAfter = await page.evaluate(() => [__shell.vars.get(0x44), __shell.vars.get(0x29), __shell.vars.get(0x102)]);
  expect('variables kept: trophy / hiscore / medal', trophyAfter[0] >= 1 && trophyAfter[1] === finalScore, JSON.stringify(trophyAfter));
  await shot('asb-9-next-zone');

  // ================================================================================================= run 2: LOSS (no steering)
  await page.goto(page.url().replace(/zone=[^&]*/, 'zone=z39ASB'), { waitUntil: 'load' });
  await waitZone('z39ASB', 1);
  await page.evaluate(() => { __shell.vars.set(0x44, 2); __shell.vars.set(0x29, 7777); });        // a silver trophy and a hiscore of an earlier run
  await press('Enter'); await wait(400); await press('Enter'); await wait(300);
  await page.waitForFunction(() => window.__zone.game.belt.state === 1, null, { timeout: 60000 });
  if (quick) await key('F10');
  let crashShot = false;
  for (let guard = 0; guard < 12000; guard++) {
    s = await st();
    if (!s || s.mode !== 2) break;
    if (s.state === 2 && !crashShot && s.hits >= 1) { crashShot = true; await shot('asb-10-first-hit'); }
    if (s.hits >= 3 && s.state === 2) await shot('asb-10-hit-3');
    await wait(150);
  }
  s = await st();
  log('end of run 2', JSON.stringify(s));
  expect('run 2: crashed (result 2) after 5 hits (or the hull use-up with the aid)', s.result === 2 && s.mode === 4 && (quick || s.hits === 5), JSON.stringify(s));
  expect('run 2: the trophy and hiscore stayed (only ever raised)', s.trophy === 2 && s.hiscore === 7777, JSON.stringify({ t: s.trophy, h: s.hiscore }));
  await wait(600);
  await shot('asb-11-banner-failed');
  await press('Enter'); await wait(600);
  expect('failed result menu is page 19 (retry / abort)', (await menu()).page === 19, JSON.stringify(await menu()));
  await shot('asb-12-result-menu-failed');
  await select(0); await press('Enter'); await wait(2500);          // Opnieuw (retry)
  await waitZone('z39ASB', 1);
  s = await st();
  expect('Retry runs the zone again from the start (new run: score 10000, 0 hits, node 62)', s.score === 10000 && s.hits === 0 && s.node === 62 && s.state === 0, JSON.stringify(s));
  await press('Enter'); await wait(400); await press('Enter'); await wait(300);
  await page.waitForFunction(() => window.__zone.game.belt.state === 1, null, { timeout: 60000 });
  await key('F10');          // fail again through the aid (hull)
  await waitMode(4); await wait(600); await press('Enter'); await wait(600);
  await select(2); await press('Enter'); await wait(2500);           // Afbreken (abort)
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.world.tickCount > 3, null, { timeout: 300000 });
  s = await st();
  expect('Abort rewinds the story to the last hub (island)', s.arch === 'z02LGI' && s.node >= 60 && s.node <= 62, JSON.stringify(s));
  await shot('asb-13-hub');

  // ================================================================================================= entry from the island: node 61 completes (F9 aid of the hub) -> the story moves to node 62 -> z39ASB
  await key('F9'); await wait(800);
  await waitZone('z39ASB', 1);
  s = await st();
  expect('from the island: the story step to node 62 enters z39ASB (intro, fresh run)', s.node === 62 && s.mode === 1 && s.state === 0 && s.score === 10000, JSON.stringify(s));

  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z39ASB checks passed');
  if (fail.length) process.exitCode = 1;
};
