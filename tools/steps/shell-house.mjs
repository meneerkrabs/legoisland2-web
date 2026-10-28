// Island -> Pepper's house through the pause menu ("Huis van Pepper", var 5 = 3) and back with the stub aid (F9): arrives at the house door.
//   node tools/browse.mjs "http://localhost:5499/?zone=z02LGI&node=5&mute=1" tools/steps/shell-house.mjs --size 1280x800
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  const st = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; const p = z.loaded.pepper; return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, pos: [p.x, p.y, p.z].map((x) => +x.toFixed(1)), node: z.sh.vars.get(0x58) }; });
  await page.waitForFunction(() => window.__zone && window.__zone.world.tickCount > 10, null, { timeout: 300000 });
  let s = await st();
  expect('island at story node 5', s.arch === 'z02LGI' && s.node === 5, JSON.stringify(s));
  const start = s.pos;
  await press('Escape'); await wait(500);
  await select(5); await press('Enter'); await wait(500);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z03PPH' && window.__zone.world.tickCount > 10, null, { timeout: 300000 });
  s = await st(); expect("Pepper's house (room) is running", s.arch === 'z03PPH' && s.mode === 2, JSON.stringify(s));
  await shot('house-1-inside');
  await page.keyboard.down('ArrowUp'); await wait(1500); await page.keyboard.up('ArrowUp');
  await press('Escape'); await wait(500);
  expect('room pause menu is page 29', (await menu()).page === 29);
  await shot('house-2-pause');
  await press('Escape'); await wait(400);
  await key('F9'); await wait(800);
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z02LGI' && window.__zone.world.tickCount > 10, null, { timeout: 300000 });
  s = await st();
  log('island again', JSON.stringify(s), 'first arrival', JSON.stringify(start));
  expect('back on the island, at a different place (the house door)', Math.hypot(s.pos[0] - start[0], s.pos[2] - start[2]) > 20);
  await shot('house-3-back-on-island');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'house round trip passed');
  if (fail.length) process.exitCode = 1;
};
