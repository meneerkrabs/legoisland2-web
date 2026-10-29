// z50LTC, the "Meet the team" cave (docs/re/m3/z50LTC.md), played with real key input in the headless browser:
//   node tools/browse.mjs "http://localhost:5499/?zone=z50LTC&mute=1" tools/steps/m3-z50LTC.mjs --size 1280x800 --out /tmp/m3/z50LTC
// the room starts through the story (zone 34 = story node 71), the set of people changes, Pepper talks to Paul Baker (name + job text, cinematic bars), a second
// Shift ends a talk, Lara Sweeney swaps the two sets of people, the pause menu works, and walking into the wormhole PORC leads back to the island (z02LGI).
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.() ?? null);
  const st = () => page.evaluate(() => {
    const z = window.__zone; if (!z) return null; const p = z.loaded.pepper;
    return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), var5e: z.sh.vars.get(0x5e), var5: z.sh.vars.get(5), node: z.sh.vars.get(0x58), bars: z.hud.letterbox, clip: p.anim?.clip };
  });
  const near = (name, dx = 0, dz = 3) => page.evaluate(([n, dx, dz]) => {
    const z = window.__zone, r = z.world.records.find((q) => q.name === n); const p = z.loaded.pepper;
    p.x = r.x + dx; p.z = r.z + dz; p.y = r.y + 0.5; p.savePrev(); return [r.x, r.y, r.z];
  }, [name, dx, dz]);
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); } return false; };

  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount > 10, null, { timeout: 300000 });
  let s = await st();
  expect('z50LTC runs in mode 2 (story node 71 = zone 34)', s.arch === 'z50LTC' && s.mode === 2 && s.node === 71, JSON.stringify(s));
  await shot('ltc-1-start');
  let d = await dbg();
  expect('26 people, set 0 present at the start', d.visible.length >= 17 && d.toggle === 0, `${d.visible.length} visible`);
  // the people of set 1 vanish one by one
  expect('set 1 has vanished after a few seconds', await until(async () => (await dbg()).visible.length === 17, 30000), JSON.stringify((await dbg()).visible.length));
  await shot('ltc-2-set0');

  // ---- walking with the arrow keys
  const p0 = (await st()).pos;
  await page.keyboard.down('ArrowUp'); await wait(1500); await page.keyboard.up('ArrowUp'); await wait(300);
  s = await st();
  expect('Pepper walks with the arrow keys', Math.hypot(s.pos[0] - p0[0], s.pos[2] - p0[2]) > 4, `${JSON.stringify(p0)} -> ${JSON.stringify(s.pos)}`);

  // ---- talk to Paul Baker
  const pb = await near('PBAK', 0, 3);
  await wait(500);
  await shot('ltc-3-near-paul');
  await page.keyboard.press('Shift', { delay: 70 });
  expect('Shift starts the talk (var 0x5e = 0x20)', await until(async () => (await st()).var5e === 0x20, 5000), JSON.stringify(await st()));
  await wait(400);
  d = await dbg();
  s = await st();
  expect('name text, cinematic bars', d.name === 'Paul Baker' && d.letterbox === 1 && d.talking.includes('Paul Baker'), JSON.stringify(d));
  await shot('ltc-4-talking');
  expect('the talk ends by itself', await until(async () => (await st()).var5e === 1, 15000), JSON.stringify(await st()));
  s = await st(); d = await dbg();
  expect('walking again, bars and text gone', s.var5e === 1 && s.bars === 0 && d.name === '' && d.letterbox === 0);
  await shot('ltc-5-after-talk');

  // ---- Phil Hodgson (3 loops), skipped with a second Shift
  await near('PHIL', 0, 4);
  await wait(400);
  await page.keyboard.press('Shift', { delay: 70 });
  expect('talk with Phil Hodgson', await until(async () => (await st()).var5e === 0x20, 5000));
  await wait(1200);
  expect('he is still talking (3 loops)', (await dbg()).talking.includes('Phil Hodgson'));
  await page.keyboard.press('Shift', { delay: 70 });
  expect('a second Shift ends the talk', await until(async () => (await st()).var5e === 1, 5000), JSON.stringify(await st()));

  // ---- Lara Sweeney swaps the sets
  await near('LARA', 0, 3.5);
  await wait(400);
  await page.keyboard.press('Shift', { delay: 70 });
  expect('talk with Lara Sweeney', await until(async () => (await st()).var5e === 0x20, 5000));
  await wait(300);
  await shot('ltc-6-lara');
  expect('her talk ends', await until(async () => (await st()).var5e === 1, 20000));
  d = await dbg();
  expect('the sets swapped (toggle 1)', d.toggle === 1, JSON.stringify(d.toggle));
  expect('set 1 shows up, set 0 vanishes', await until(async () => { const v = (await dbg()).visible; return v.includes('Ade Smith') && !v.includes('Paul Baker'); }, 30000), JSON.stringify((await dbg()).visible));
  await wait(500);
  await shot('ltc-7-set1');

  // ---- pause menu (hub: page 5)
  await key('Escape'); await wait(700);
  s = await st();
  const pause = await page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, open: e.open }; });
  expect('Esc opens the pause menu (page 5)', s.mode === 3 && pause.page === 5, JSON.stringify({ mode: s.mode, ...pause }));
  await shot('ltc-8-pause');
  await key('Escape'); await wait(500);
  expect('Esc resumes', (await st()).mode === 2);

  // ---- the wormhole back to the island: walk into PORC (z = 156) with the real keys
  await page.evaluate(() => { const z = window.__zone, p = z.loaded.pepper; p.x = -4; p.z = 118; p.y = 5; p.ry = 0; p.rebuildYaw(); p.savePrev(); z.world.camera.init(p); });
  await wait(800);
  await shot('ltc-9-before-portal');
  await page.keyboard.down('ArrowUp'); await wait(100);   // ArrowUp = away from the camera = towards the portal now that Pepper faces +z
  const left = await until(async () => { const z = await st(); return !z || z.arch !== 'z50LTC' || z.var5 === 2; }, 40000);
  await page.keyboard.up('ArrowUp');
  const sNow = await st();
  log('portal walk', JSON.stringify(sNow));
  expect('the wormhole writes var 5 = 2 and the room is left', left);
  expect('arrived on the island (z02LGI)', await until(async () => { const z = await st(); return z && z.arch === 'z02LGI' && z.tick > 5; }, 120000), JSON.stringify(await st()));
  await shot('ltc-10-island');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'z50LTC passed');
  if (fail.length) process.exitCode = 1;
};
