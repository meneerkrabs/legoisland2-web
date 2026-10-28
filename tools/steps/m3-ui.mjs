// Generic intro / help / subtitle / banner of a mini-game zone without a port (src/shell/helpscreen.ts, zoneintro.ts): mode 1 panel + brief, mode 9 controls help,
// a subtitle while playing, the end banner of the stub (F9 / F10).
//   node tools/browse.mjs "http://localhost:5499/?zone=z08BKD&mute=1" tools/steps/m3-ui.mjs --size 1280x800 --out /tmp/m3/ui/z08BKD
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const st = () => page.evaluate(() => { const z = window.__zone; return z ? { arch: z.info.archive, mode: z.machine.mode, intro: z.machine.cfg.intro, help: z.machine.cfg.help, subs: z.ctx.subtitle()?.id ?? null } : null; });
  await page.waitForFunction(() => window.__zone && window.__zone.machine.mode !== 7, null, { timeout: 300000 });
  await page.waitForFunction(() => window.__zone.machine.mode === 1 || window.__zone.machine.mode === 2, null, { timeout: 60000 });
  let s = await st();
  log('start', JSON.stringify(s));
  expect('intro mode 1', s.mode === 1);
  await wait(300);
  await shot('1-intro');
  await key('Enter'); await wait(400);
  s = await st();
  expect('help mode 9 (or play when the zone has no help)', s.mode === 9 || (s.mode === 2 && !s.help), JSON.stringify(s));
  await shot('2-help');
  await key('Enter'); await wait(600);
  s = await st();
  expect('play mode 2', s.mode === 2);
  // a spoken line shown as subtitle while playing (option on by default)
  await page.evaluate(() => { const z = window.__zone; const e = (z.ctx.strings?.entries ?? []).filter((x) => x.text.length > 60 && !x.tag.startsWith('CONTROL')).sort((x, y) => y.text.length - x.text.length)[0]; if (e) z.ctx.say(e.tag); });
  await wait(300);
  await shot('3-play-subtitle');
  await key('F9'); await wait(1200);
  s = await st();
  expect('banner mode 4', s.mode === 4, JSON.stringify(s));
  await shot('4-banner');
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'ui checks passed');
  if (fail.length) process.exitCode = 1;
};
