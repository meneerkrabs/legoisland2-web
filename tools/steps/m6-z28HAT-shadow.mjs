// z28HAT: the balloon's shadow record SHAD (draw hook FUN_00796d72): screenshots at the start and over the drop zone.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5513/?zone=z28HAT&mute=1" tools/steps/m6-z28HAT-shadow.mjs --size 1024x640 --out /tmp/m6-z28HAT-shadow
export default async ({ page, shot, wait, log, key }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z28HAT' && window.__zone.game && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  for (let i = 0; i < 160 && (await page.evaluate(() => __zone.game.debug().cutscene)); i++) { await page.keyboard.down('ShiftLeft'); await wait(90); await page.keyboard.up('ShiftLeft'); await wait(450); }
  await wait(600);
  await key('Enter'); await wait(500); await key('Enter'); await wait(1500);
  const info = () => page.evaluate(() => { const w = __zone.world, s = w.records[80], b = w.records[153]; return { flags: s.flags, balloon: [b.x, b.y, b.z], ry: b.ry }; });
  log('start', JSON.stringify(await info()));
  await shot('s1');
  await wait(2000); await shot('s2');
  // move the balloon to a few places (the drop zone is at the origin side)
  for (const [x, z] of [[0, 40], [60, -60], [-100, 100]]) {
    await page.evaluate(([x, z]) => { const S = __zone.world.ext.get('z28HAT'), b = S.recs.hotb; b.x = x; b.z = z; b.savePrev(); S.mom = [0, 0, 0]; }, [x, z]);
    await wait(900); log('at', x, z, JSON.stringify(await info())); await shot(`p_${x}_${z}`);
  }
};
