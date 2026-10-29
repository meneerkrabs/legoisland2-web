// WP-SHELL, U8: z50LTC's loop waits for any button in mode 1 (FUN_00838e41 case 1: `DAT_00983840 != 0`), no panel:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5531/?zone=z50LTC&mute=1&hold=1" tools/steps/m8-ltc-intro.mjs --size 1024x768 --out /tmp/m8-ltc
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const mode = () => page.evaluate(() => window.__zone?.machine.mode);
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await wait(2500);
  expect('the room waits in mode 1 without a key', (await mode()) === 1);
  await shot('ltc-intro-wait');
  await key('ArrowLeft'); await wait(400);
  expect('a button ends it (mode 2)', (await mode()) === 2);
  log(fail.length ? 'FAILED: ' + fail.join('; ') : 'all ok');
  if (fail.length) process.exitCode = 1;
};
