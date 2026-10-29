// WP-SHELL, U4: the text offsets of the menus / panels are the executable's globals (src/shell/uioffsets.ts): a zone started without the front end shows its intro / help with the
// start-up values (14 / -4); the first pause menu (FUN_0041c080 -> FUN_004201aa) switches them to 0x12 / -2 for good. Real keys, headless, muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5531/?zone=z08BKD&mute=1" tools/steps/m8-shell-zone.mjs --size 1280x800 --out /tmp/m8-zone
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const off = () => page.evaluate(() => ({ t: __shell.menu.engine.titleDy, i: __shell.menu.engine.itemDy, mode: window.__zone?.machine.mode }));
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await wait(300);
  let o = await off();
  expect('before any menu the offsets are the start-up values 14 / -4', o.t === 14 && o.i === -4, JSON.stringify(o));
  await shot('1-intro-startup-offsets');
  await key('Enter'); await wait(500);
  o = await off();
  expect('the help (mode 9) is drawn with the same start-up values', o.mode === 9 && o.t === 14 && o.i === -4, JSON.stringify(o));
  await shot('2-help-startup-offsets');
  await key('Enter'); await wait(700);
  await key('Escape'); await wait(500);
  o = await off();
  expect('the pause menu (mode 3) switches the globals to 0x12 / -2', o.mode === 3 && o.t === 0x12 && o.i === -2, JSON.stringify(o));
  await shot('3-pause');
  await key('Escape'); await wait(500);
  o = await off();
  expect('back in play the globals keep 0x12 / -2', o.mode === 2 && o.t === 0x12 && o.i === -2, JSON.stringify(o));
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all ok');
  if (fail.length) process.exitCode = 1;
};
