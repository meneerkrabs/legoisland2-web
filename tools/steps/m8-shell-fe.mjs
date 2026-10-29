// WP-SHELL: the front end's menu, the options pages and the credits with the offsets of FUN_004201aa (0x12 / -2: the front end's set-up calls it before the menu opens).
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5531/?start=frontend&mute=1" tools/steps/m8-shell-fe.mjs --size 1280x800 --out /tmp/m8-fe-ui
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(200); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open, t: e.titleDy, i: e.itemDy }; });
  const select = async (idx) => { for (let i = 0; i < 12 && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 300000 });
  await wait(600);
  let m = await menu();
  expect('the front end opens its menu with 0x12 / -2', m.open && m.page === 0 && m.t === 0x12 && m.i === -2, JSON.stringify(m));
  await shot('fe-0-main');
  await select(2); await press('Enter'); await wait(400);
  m = await menu(); await shot('fe-1-options');
  log('options page', m.page);
  for (const [item, name] of [[1, 'controls'], [2, 'graphics'], [3, 'sound'], [4, 'game']]) {
    await select(item); await press('Enter'); await wait(400);
    m = await menu(); await shot(`fe-2-options-${name}`); log(name, 'page', m.page);
    await press('Escape'); await wait(300);
  }
  await press('Escape'); await wait(300);
  m = await menu();
  expect('back at the main menu', m.page === 0, JSON.stringify(m));
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all ok');
  if (fail.length) process.exitCode = 1;
};
