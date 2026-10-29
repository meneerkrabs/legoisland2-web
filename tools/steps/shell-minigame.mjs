// A mini-game STUB (zones with a ZoneGame bring their own gameplay and have no F9 / F10 aids; Whack-A-Bot z05WAB is ported, see m3-z05WAB.mjs): this runs on Brick Dive z08BKD, which
// still is a stub: intro / help (Enter), pause menu (page 18), finishing (F9 -> banner -> result menu page 16 -> Continue is not tested here), failing (F10 -> banner -> page 19 -> Abort ->
// rewinds to the last hub), restart from the pause menu. Change ZONE when z08BKD gets a port (any zone without a registered zone game works).
//   node tools/browse.mjs "http://localhost:5499/?zone=z08BKD&mute=1&debug=1" tools/steps/shell-minigame.mjs --size 1024x768
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const st = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, node: z.sh.vars.get(0x58) }; });
  const ZONE = 'z08BKD';
  // the stub shows the brief (mode 1) and the controls help (mode 9) first: a button press each
  const ready = async (arch) => {
    await page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && [1, 2, 9].includes(window.__zone.machine.mode), arch, { timeout: 300000 });
    for (let i = 0; i < 6; i++) { const m = (await st()).mode; if (m === 2) break; if (m === 1 || m === 9) { await key('Enter'); await wait(400); } else await wait(300); }
    await page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 5, arch, { timeout: 300000 });
  };
  await ready(ZONE);
  let s = await st(); const node0 = s.node; expect(ZONE + ' at its story node', node0 > 2, JSON.stringify(s));
  await press('Escape'); await page.waitForFunction(() => __shell.menu.engine.page === 18 && __shell.menu.engine.open, null, { timeout: 60000 }).catch(() => {});
  expect('mini-game pause page 18', (await menu()).page === 18);
  await shot('mg-1-pause');
  await select(4); await press('Enter'); await wait(2500);       // Opnieuw starten (restart)
  await ready(ZONE);
  s = await st(); expect('restart re-runs the zone, story node unchanged', s.arch === ZONE && s.node === node0, JSON.stringify(s));
  await key('F10'); await page.waitForFunction(() => window.__zone.machine.mode === 4, null, { timeout: 60000 }); await wait(300);
  s = await st(); expect('failing shows the banner (mode 4)', s.mode === 4);
  await shot('mg-2-failed-banner');
  await press('Enter'); await page.waitForFunction(() => __shell.menu.engine.page === 19 && __shell.menu.engine.open, null, { timeout: 60000 }).catch(() => {});
  expect('then the result menu page 19 (failed: retry / abort)', (await menu()).page === 19);
  await shot('mg-3-failed-menu');
  await press('ArrowDown'); log('page 19 item after one step down', JSON.stringify(await menu())); await key('Enter');       // the second item: EndGame3M1 = Afbreken (abort)
  // abort = exit 4: the story rewinds to the last hub (z07CSI, node 17) and the zone loop goes there. (A start with ?zone= never snapshotted the hub's variable, so the hub finds its node complete at once
  // and the story sends Pepper straight back into the mini-game: the intro of z08BKD shows again. After a normal story the hub stays; the island run of m3-z05WAB.mjs shows that.)
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z07CSI', null, { timeout: 300000, polling: 50 });
  s = await st(); expect('abort: the loop goes to the last hub (z07CSI)', s.arch === 'z07CSI' && s.node >= 17, JSON.stringify(s));
  log('after abort', JSON.stringify(s));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'mini-game checks passed');
  if (fail.length) process.exitCode = 1;
};
