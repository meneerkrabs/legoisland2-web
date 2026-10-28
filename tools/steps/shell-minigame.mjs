// A mini-game stub (Whack-A-Bot z05WAB): pause menu (page 18), finishing (F9 -> banner -> result menu page 16 -> Continue -> story advances),
// failing (F10 -> banner -> page 19 -> Abort -> rewinds to the last hub), restart from the pause menu.
//   node tools/browse.mjs "http://localhost:5499/?zone=z05WAB&mute=1" tools/steps/shell-minigame.mjs --size 1024x768
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const st = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, node: z.sh.vars.get(0x58) }; });
  const ready = (arch) => page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 5, arch, { timeout: 300000 });
  await ready('z05WAB');
  let s = await st(); expect('WAB at story node 10', s.node === 10, JSON.stringify(s));
  await press('Escape'); await wait(500);
  expect('mini-game pause page 18', (await menu()).page === 18);
  await shot('mg-1-pause');
  await select(4); await press('Enter'); await wait(2500);       // Opnieuw starten (restart)
  await ready('z05WAB');
  s = await st(); expect('restart re-runs the zone, story node unchanged', s.arch === 'z05WAB' && s.node === 10, JSON.stringify(s));
  await key('F10'); await wait(1200);
  s = await st(); expect('failing shows the banner (mode 4)', s.mode === 4);
  await shot('mg-2-failed-banner');
  await press('Enter'); await wait(500);
  expect('then the result menu page 19 (failed: retry / abort)', (await menu()).page === 19);
  await shot('mg-3-failed-menu');
  await select(2); await press('Enter'); await wait(2500);       // EndGame3M1 = Afbreken (abort)
  await ready('z02LGI');
  s = await st(); expect('abort rewinds the story to the last hub (island)', s.arch === 'z02LGI' && s.node < 10 && s.node >= 8, JSON.stringify(s));
  log('after abort', JSON.stringify(s));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'mini-game checks passed');
  if (fail.length) process.exitCode = 1;
};
