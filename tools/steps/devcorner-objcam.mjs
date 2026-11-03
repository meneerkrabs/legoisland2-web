// Headless shots with the developer corner's "Camera op dit object" (docs/re/devcorner.md section 5): drives the real corner UI (` -> "Records / Objecten" -> filter, numbers, button), closes the panel and takes the picture.
// Through the bot slot and a snapshot server (headless, muted):
//   ZONE=z02LGI  VIS=1 (switch an inactive record on)  HINT=1 (keep the status badge)  L3D=1|0  PREFIX=oc  SKIPCUT=0|1 (default 1: Shift skips cutscenes first)  PARAMS="&x=y"
//   BACK=1 (Esc afterwards + a picture of the game's own camera)
//   SHOTS="RECORD:azimuth:distance[:height[:aim[:follow]]];..."   RECORD = the four letters of the record (the first one the filter finds; "NAME#3" = the 4th match), azimuth in degrees (0 = front, 45 = three-quarter)
//   sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:5742/ tools/steps/devcorner-objcam.mjs --profile /tmp/p --size 800x600 --out DIR
export default async ({ page, shot, wait, log, evaluate, key }) => {
  page.on('dialog', (d) => d.accept());
  const base = new URL(page.url()).origin + '/';
  const zone = process.env.ZONE ?? 'z02LGI', prefix = process.env.PREFIX ?? 'oc', l3d = process.env.L3D ?? '0';
  await page.goto(`${base}?zone=${zone}&mute=1&debug=1&lego3d=${l3d}${process.env.PARAMS ?? ''}`, { waitUntil: 'load' });
  for (let i = 0; i < 300; i++) {
    if (await evaluate(() => !!(window.__zone && window.__zone.world.tickCount > 5 && window.__zone.machine.mode === 2))) break;
    await page.keyboard.press('Enter').catch(() => {}); await wait(2000);
  }
  await wait(1500);
  if (process.env.SKIPCUT !== '0') {
    for (let i = 0; i < 80; i++) {
      if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) { await wait(250); if (!(await evaluate(() => !!window.__zone.game?.debug?.().cutscene))) break; continue; }
      await page.keyboard.down('ShiftLeft'); await wait(60); await page.keyboard.up('ShiftLeft'); await wait(120);
    }
  }
  log('lego3d mods:', JSON.stringify(await evaluate(() => window.__le2Mods && window.__le2Mods.mods)));
  if (process.env.HINT !== '1') await page.addStyleTag({ content: '.dc-badge-hint{display:none!important}' });   // HINT=1 keeps the status badge in the picture
  const open = async () => {
    if (!(await evaluate(() => document.querySelector('.dc-root')?.classList.contains('open')))) { await page.keyboard.press('Backquote'); await wait(300); }
    await page.locator('.dc-tab').filter({ hasText: 'Records' }).click(); await wait(300);
  };
  const close = async () => { await page.keyboard.press('Backquote'); await wait(200); };
  for (const spec of (process.env.SHOTS ?? 'PEPP:0:5.5').split(';')) {
    const [name, az = '0', dist = '5.5', height = '2.5', aim = '1.5', follow = '1'] = spec.split(':');
    const [nm, nth = '0'] = name.split('#');
    await open();
    await page.fill('.dc-section input[placeholder^="filter"]', nm); await wait(300);
    const pick = await evaluate(([nth]) => { const sel = document.querySelector('.dc-section select'); const o = sel.options[+nth]; if (!o) return null; sel.value = o.value; sel.dispatchEvent(new Event('change')); return o.textContent; }, [nth]);
    if (!pick) { log(name, 'no such record'); await close(); continue; }
    if (process.env.VIS === '1' && /V:N/.test(pick)) await page.locator('.dc-bar button', { hasText: 'Zichtbaar omzetten' }).click();   // VIS=1: an inactive record (V:N: not spawned yet) is switched on for the shot
    await evaluate(([az, dist, height, aim, follow]) => {
      const bar = [...document.querySelectorAll('.dc-bar')].find((b) => b.textContent.startsWith('Camera op dit object:'));
      const ins = bar.querySelectorAll('input[type=number]');
      [dist, height, az, aim].forEach((v, i) => { ins[i].value = v; ins[i].dispatchEvent(new Event('change')); });
      const ck = bar.querySelector('input[type=checkbox]'); if (ck.checked !== (follow === '1')) ck.click();
    }, [az, dist, height, aim, follow]);
    await page.locator('.dc-bar button', { hasText: /^Camera op dit object$/ }).click(); await wait(200);
    await close(); await wait(+(process.env.SETTLE ?? 1500));
    log('cutscene running:', await evaluate(() => !!window.__zone.game?.debug?.().cutscene), 'mode', await evaluate(() => window.__zone.machine.mode), 'tick', await evaluate(() => window.__zone.world.tickCount));
    log(name, pick.trim(), await evaluate(() => document.querySelector('.dc-badge-hint')?.textContent?.replace(/\n/g, ' | ')));
    await shot(`${prefix}-${zone}-${nm}${nth !== '0' ? nth : ''}-az${az}-d${dist}-l${l3d}`);
    if (process.env.BACK === '1') {   // BACK=1: Esc (panel closed) gives the game's camera back; a second picture shows the game's own view again
      await page.keyboard.press('Escape'); await wait(+(process.env.SETTLE ?? 1500));
      log('after Esc:', await evaluate(() => document.querySelector('.dc-badge-hint')?.textContent?.replace(/\n/g, ' | ')), 'paused:', await evaluate(() => window.__zone.machine.mode === 3));
      await shot(`${prefix}-${zone}-${nm}-back-l${l3d}`);
    }
  }
};
