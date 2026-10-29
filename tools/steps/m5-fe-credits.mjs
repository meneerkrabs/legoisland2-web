// M5 audit, front end: the credits with the stage characters that peek into the picture (FUN_00471c4c): Credits from the main menu with real keys, the characters rise from the bottom
// of the stage while the lines scroll, Space blinks one away, any other key returns to the menu.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5511/?start=frontend&mute=1" tools/steps/m5-fe-credits.mjs --size 1280x800 --out /tmp/m5-fe
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(170); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 300000 });
  await wait(800);
  await select(3);
  await press('Enter');
  const slots = () => page.evaluate(() => { const r = __feWorld.records; return [3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 0].filter((i) => (r[i].flags & 2) && r[i].y > 3.3 && r[i].z === 50).map((i) => [i, +r[i].x.toFixed(2), +r[i].y.toFixed(2), r[i].anim.clip]); });
  let shots = 0, seen = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 200000 && shots < 2) {
    const s = await slots();
    if (s.length) { seen++; if (seen === 3 || seen === 20) { await shot(`fe-credits-${shots++}`); log('peeking records', JSON.stringify(s)); } }
    await wait(250);
  }
  expect('stage characters peek in while the credits scroll', seen > 0, `seen ${seen}`);
  await press('Enter');
  await wait(600);
  const m = await menu();
  expect('a key ends the credits, the menu is back', m.page === 0 && m.open);
  log(fail.length ? 'FAILED: ' + fail.join(', ') : 'all ok');
};
