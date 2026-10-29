// z42BRP first look (headless, muted): intro, help, the side run's start, the roof (phase forced) with the second help.
//   node tools/browse.mjs "http://localhost:5612/?zone=z42BRP&mute=1" tools/steps/m6-z42BRP-look.mjs --size 1280x800 --out /tmp/m6-z42BRP
export default async ({ page, shot, wait, log, key }) => {
  const dbg = () => page.evaluate(() => { const z = window.__zone; return z ? { mode: z.machine.mode, arch: z.info.archive, tick: z.world.tickCount, node: z.sh.vars.get(0x58), g: z.game ? z.game.debug() : null } : null; });
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z42BRP', null, { timeout: 120000 });
  await wait(1500);
  log('state', JSON.stringify((await dbg()).mode));
  await shot('1-intro');
  await key('Enter'); await wait(800);
  await shot('2-help');
  await key('Enter'); await wait(2500);
  log('state', JSON.stringify(await dbg()));
  await shot('3-start');
  await page.keyboard.down('ArrowLeft'); await wait(2500); await shot('4-run'); await page.keyboard.up('ArrowLeft');
  log('state', JSON.stringify((await dbg()).g.pepper));
  // force the roof phase
  await page.evaluate(() => { window.__zone.sh.vars.set(0xfa, 2); });
  await wait(1200);
  log('state', JSON.stringify(await dbg()).slice(0, 400));
  await shot('5-help2');
  await key('Enter'); await wait(1500);
  await shot('6-roof');
  log('state', JSON.stringify((await dbg()).mode));
};
