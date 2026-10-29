// z21FSH splash01.par proof (headless, muted): walk to a spot, cast, screenshot the moment the bobber lands (the emitter is switched on) and the first ticks after it.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5511/?zone=z21FSH&mute=1" tools/steps/wa-z21FSH-splash.mjs --size 1024x768 --out /tmp/wa-z21FSH-splash
export default async ({ page, shot, wait, log, key }) => {
  const dbg = () => page.evaluate(() => window.__zone?.game?.debug?.());
  const tap = (k, ms = 70) => page.keyboard.press(k, { delay: ms });
  const until = async (name, f, ms = 60000) => { const t0 = Date.now(); for (;;) { const d = await dbg(); if (d && f(d)) return d; if (Date.now() - t0 > ms) { log('TIMEOUT', name, JSON.stringify(d)); return d; } await wait(30); } };
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z21FSH' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  for (let i = 0; i < 80 && (await page.evaluate(() => __zone.ctx.cutscene.active())); i++) { await tap('Shift', 40); await wait(60); }
  await wait(600); await key('Enter'); await wait(600); await key('Enter'); await wait(800);
  await tap('Shift');
  await until('ready', (d) => d.state === 6);
  await wait(250); await tap('Control');
  await until('charge', (d) => d.state === 7 && d.sub === 1 && d.power >= 30);
  await tap('Control');
  await until('landed', (d) => d.state === 7 && d.sub === 4 || d.state === 8, 20000);
  const st = () => page.evaluate(() => ({ stats: window.__particles?.stats, live: window.__particles?.engine.drawList.length, ticks: window.__particles?.ticks }));
  for (let i = 0; i < 4; i++) { log('splash', JSON.stringify(await st())); await shot('splash-' + i); await wait(120); }
};
