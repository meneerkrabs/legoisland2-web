// WP-INPUT, front end half (docs/re/input.md): key page (capture on release, fixed + current key, localised names, middle mouse button), gamepad (stubbed navigator.getGamepads),
// F10 screenshot download (Lego0000.bmp ...), the SDREAMS / RHUNRHEGED cheat codes through real key events, all headless and muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5491/?start=frontend&mute=1" tools/steps/wp-input-frontend.mjs --out /tmp/wp-input-shots
import fs from 'node:fs';
export default async ({ page, shot, wait, log }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.waitForFunction(() => window.__shell && window.__shell.menu, null, { timeout: 180000 });
  await wait(1000);
  const down = async (k, ms = 90) => { await page.keyboard.down(k); await wait(ms); await page.keyboard.up(k); await wait(160); };
  const eng = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, cap: e.capture }; });
  const held = () => page.evaluate(() => __shell.input.held);
  const opt = (i) => page.evaluate((i) => __shell.options.binding(i), i);

  // ---- F10: a Lego0000.bmp download, the next press Lego0001.bmp
  await page.evaluate(() => localStorage.removeItem('le2-photo-index'));
  const grab = async () => { const p = page.waitForEvent('download', { timeout: 8000 }); await page.keyboard.press('F10', { delay: 70 }); const d = await p; const f = '/tmp/wp-input-' + d.suggestedFilename(); await d.saveAs(f); return { name: d.suggestedFilename(), f }; };
  const s1 = await grab(), s2 = await grab();
  expect('F10 saves Lego0000.bmp then Lego0001.bmp', s1.name === 'Lego0000.bmp' && s2.name === 'Lego0001.bmp', `${s1.name} ${s2.name}`);
  const bmp = fs.readFileSync(s1.f), dv = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  const w = dv.getUint32(18, true), h = dv.getUint32(22, true);
  expect('BMP header', bmp[0] === 0x42 && bmp[1] === 0x4d && dv.getUint16(28, true) === 24 && dv.getUint32(10, true) === 0x36 && dv.getUint32(2, true) === bmp.length && dv.getUint32(38, true) === 2000, `${w}x${h} ${bmp.length}`);
  let nz = 0; for (let i = 0x36; i < bmp.length; i += 997) if (bmp[i]) nz++;
  expect('the picture is not blank', nz > 10, String(nz));

  // ---- the key page: Opties -> Besturing -> Toetsen
  await down('ArrowDown'); await down('Enter'); await wait(300); await down('Enter'); await wait(300); await down('Enter'); await wait(300);
  let e = await eng();
  expect('key page open', e.page === 13 && e.item === 10, JSON.stringify(e));
  await down('Enter'); await wait(600);
  e = await eng();
  expect('Enter on the first row starts the capture', e.cap !== 0, JSON.stringify(e));
  await shot('keys-capture');
  // keys that must be refused: another entry's key (ArrowDown), F10, the Windows key, the grave accent
  for (const k of ['ArrowDown', 'KeyZ', 'F10', 'Meta', 'Backquote']) { await down(k, 150); await wait(150); }
  expect('refused keys do not bind', (await eng()).cap !== 0 && (await opt(0)).dik === 0xc8);
  // a new key: nothing happens while it is held, it binds when it is let go
  await page.keyboard.down('KeyI'); await wait(300);
  expect('still waiting while the key is held', (await eng()).cap !== 0 && (await opt(0)).dik === 0xc8);
  await page.keyboard.up('KeyI'); await wait(300);
  expect('bound on release', (await eng()).cap === 0 && (await opt(0)).dik === 0x17, JSON.stringify(await opt(0)));
  await shot('keys-bound');
  const bind = await page.evaluate(() => { const b = __shell.input.bindings[0]; return { code: b.code, defaultCode: b.defaultCode, defaultActive: b.defaultActive }; });
  expect('the mapper has I and keeps the fixed arrow-up key live', bind.code === 0x10017 && bind.defaultCode === 0x100c8 && bind.defaultActive === true, JSON.stringify(bind));
  // both keys give Up in the mapper (the menu is still open: the front end loop samples the keys every tick)
  await page.keyboard.down('KeyI'); await wait(150);
  const hI = await held(); await page.keyboard.up('KeyI');
  await page.keyboard.down('ArrowUp'); await wait(150);
  const hA = await held(); await page.keyboard.up('ArrowUp'); await wait(100);
  expect('I and the fixed arrow both give the Up bit', hI === 4 && hA === 4, `${hI} ${hA}`);
  // the middle mouse button (DirectInput button 2) can be bound to the second row, the left / right buttons cannot
  await page.evaluate(() => { __shell.menu.engine.item = 20; }); await wait(200);
  await down('Enter'); await wait(600);
  expect('second row: capture', (await eng()).cap !== 0);
  await page.mouse.move(300, 300); await page.mouse.down({ button: 'left' }); await wait(200); await page.mouse.up({ button: 'left' }); await wait(200);
  await page.mouse.down({ button: 'right' }); await wait(200); await page.mouse.up({ button: 'right' }); await wait(200);
  expect('left / right buttons are not bindable', (await eng()).cap !== 0);
  await page.mouse.down({ button: 'middle' }); await wait(300); await page.mouse.up({ button: 'middle' }); await wait(300);
  const o1 = await opt(1);
  expect('middle button bound to row 2 (device 0, button 2)', o1.device === 0 && o1.dik === 2, JSON.stringify(o1));
  await shot('keys-mouse');
  // Esc leaves the page with "cancel": the old keys return
  await page.evaluate(() => { __shell.menu.engine.item = 3; }); await wait(200);
  await down('Enter'); await wait(500);
  const back = [await opt(0), await opt(1)];
  expect('cancelled: the old keys are back', back[0].dik === 0xc8 && back[0].device === 1 && back[1].dik === 0xd0 && back[1].device === 1, JSON.stringify(back));
  expect('and the mapper too', await page.evaluate(() => __shell.input.bindings[0].code === 0x100c8 && __shell.input.bindings[0].defaultActive === false));

  // ---- cheat codes (last: the letters wander through the menu): the first key re-arms the rows, then SDREAMS
  for (const k of 'XSDREAMS') await down('Key' + k);
  await wait(200);
  expect('SDREAMS sets var 0xd', (await page.evaluate(() => __shell.vars.get(0xd))) === 1);
  await page.evaluate(() => __shell.vars.set(0xd, 0));
  for (const k of 'XRHUNRHEGED') await down('Key' + k);
  await wait(300);
  const dlg = await page.evaluate(() => { const b = [...document.querySelectorAll('div')].find((d) => d.textContent?.includes('Error in Game') && d.style.position === 'fixed'); return b ? b.textContent : null; });
  expect('RHUNRHEGED opens the error dialog', !!dlg && /SDPad\.cpp/.test(dlg) && /better than EQ/.test(dlg), dlg ?? '');
  await shot('cheat-error-dialog');
  await page.evaluate(() => { for (const d of document.querySelectorAll('div')) if (d.style.position === 'fixed' && d.textContent?.includes('Error in Game')) d.remove(); });

  // ---- pad (stubbed): buttons are held, first pad only, the stick threshold, the setting
  // (a pad button is a menu button as well and the menu may flip the setting while the pad is down: the probe records every value the mapper had during the step)
  await page.evaluate(() => {
    const im = __shell.input, orig = im.update.bind(im);
    window.__seen = [];
    im.update = () => { orig(); window.__seen.push(im.held); };
    navigator.getGamepads = () => window.__pads;
    window.__pads = [];
  });
  const step = async (down, ax = 0, ay = 0, mapping = '', ms = 250) => {
    await page.evaluate(([down, ax, ay, mapping]) => { __shell.options.gamepad = true; __shell.optionChanged(0x13); window.__seen = []; window.__pads = [{ connected: true, mapping, axes: [ax, ay], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })) }]; }, [down, ax, ay, mapping]);
    await wait(ms);
    return page.evaluate(() => window.__seen.slice());
  };
  let seen = await step([1]);
  expect('pad button 1 gives 0x20 on the first tick and again later (held, not a pulse)', seen.filter((x) => x === 0x20).length >= 3, JSON.stringify(seen));
  seen = await step([], 0.9, -0.9);
  expect('stick up-right = 4 | 2', seen.includes(6), JSON.stringify(seen));
  seen = await step([], 0.5, 0);
  expect('stick at exactly 0.5 is below the threshold', !seen.includes(2), JSON.stringify(seen));
  seen = await step([], 0.51, 0);
  expect('stick at 0.51 is above', seen.includes(2), JSON.stringify(seen));
  seen = await step([8], 0, 0, 'standard');
  expect('standard pad: Back = DirectInput button 6 = 0x4000', seen.includes(0x4000), JSON.stringify(seen));
  seen = await step([6, 7, 12, 13], 0, 0, 'standard');
  expect('standard pad: triggers and D-pad are no buttons', seen.every((x) => x === 0), JSON.stringify(seen));
  await page.evaluate(() => { window.__seen = []; __shell.options.gamepad = false; __shell.optionChanged(0x13); window.__pads = [{ connected: true, mapping: '', axes: [0, 0], buttons: [{ pressed: true }, { pressed: true }] }]; });
  await wait(250);
  seen = await page.evaluate(() => window.__seen.slice());
  expect('pad option off: not read', seen.every((x) => x === 0), JSON.stringify(seen));

  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
