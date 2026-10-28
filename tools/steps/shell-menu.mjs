// Front end menu walk: main menu -> options (sound / game / graphics / controls) -> change values -> back -> credits.
//   node tools/browse.mjs "http://localhost:5499/?start=frontend&mute=1" tools/steps/shell-menu.mjs --size 1280x800
export default async ({ page, shot, wait, log, key }) => {
  await page.waitForFunction(() => window.__fe && window.__fe.mode === 2, null, { timeout: 180000 });
  const st = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open, capture: e.capture, o: Array.from(__shell.options.a) }; });
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await key(k); await wait(160); } };
  const select = async (idx) => { for (let i = 0; i < 12 && (await st()).item !== idx; i++) await press('ArrowDown'); };
  const enter = async (idx) => { await select(idx); await press('Enter'); await wait(500); };
  const fail = [];
  const expect = (name, cond) => { log(cond ? 'ok  ' : 'FAIL', name); if (!cond) fail.push(name); };
  await wait(500);
  let s = await st();
  expect('main menu is page 0', s.page === 0);
  await shot('menu-1-main');
  await enter(2);                                   // Opties
  s = await st(); expect('options page 4', s.page === 4);
  await shot('menu-2-options');
  await enter(3);                                   // Geluid
  s = await st(); expect('sound page 11', s.page === 11);
  await press('ArrowRight'); await wait(300);      // music +10
  await select(2); await press('ArrowLeft', 2); await wait(300);   // sfx -20
  s = await st();
  expect('music 90 sfx 60 speech 80', s.o[0] === 90 && s.o[1] === 60 && s.o[0x16] === 80);
  await shot('menu-3-sound-changed');
  await press('Escape'); await wait(300);
  s = await st(); expect('back at options', s.page === 4);
  await enter(2);                                   // Afbeeldingen
  s = await st(); expect('graphics page 10', s.page === 10);
  await press('ArrowRight', 3); await wait(300);    // draw distance +30
  s = await st(); expect('draw distance 80', s.o[0x15] === 80);
  await shot('menu-4-graphics');
  await press('Escape'); await wait(300);
  await enter(1);                                   // Besturing
  s = await st(); expect('controls page 9', s.page === 9);
  await shot('menu-5-controls');
  await select(3); await press('ArrowRight', 2); await wait(300);   // sensitivity +20
  s = await st(); expect('sensitivity 65', s.o[0x14] === 65);
  await select(1); await press('Enter'); await wait(500);          // key list
  s = await st(); expect('key page 13', s.page === 13);
  await shot('menu-6-keys');
  // rebind the first key: Enter, then press 'KeyI'
  await press('Enter'); await wait(300);
  s = await st(); expect('capture started', s.capture !== 0);
  await shot('menu-7-key-capture');
  await key('KeyI'); await wait(600);
  s = await st(); expect('key 4 is now I (dik 0x17)', (s.o[4] & 0xffff) === 0x17);
  await shot('menu-8-key-bound');
  await select(13 + 0 === 13 ? 2 : 2);
  await press('Escape', 3); await wait(300);
  s = await st(); expect('back at main', s.page === 0);
  const persisted = await page.evaluate(async () => { const b = await __shell.saves.backend.get('Settings.set'); return b ? Array.from(b.slice(0, 8)) : null; });
  log('Settings.set persisted bytes', JSON.stringify(persisted));
  expect('Settings.set persisted (music 90)', !!persisted && persisted[0] === 90);
  await enter(3);                                   // Credits
  await wait(5000);
  await shot('menu-9-credits');
  await wait(25000);
  await shot('menu-10-credits-later');
  await press('Enter'); await wait(500);
  s = await st(); expect('menu is back after the credits', s.page === 0 && s.open);
  // the mouse: hovering selects, a click acts (Opties is the second button: about (640, 398) on a 1280x800 window)
  await page.mouse.move(640, 398); await wait(300);
  s = await st(); expect('hover selects Opties', s.page === 0 && s.item === 2, JSON.stringify(s));
  await page.mouse.down(); await wait(80); await page.mouse.up(); await wait(700);
  s = await st(); expect('click opens the options page', s.page === 4, JSON.stringify(s));
  await shot('menu-11-mouse');
  // sliders by mouse: Geluid page, click on the 4th bar of the music volume
  await page.mouse.move(640, 478); await wait(200);
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'all menu checks passed');
  if (fail.length) process.exitCode = 1;
};
