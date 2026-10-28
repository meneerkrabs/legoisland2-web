// look at the dented basket shapes KET2..KET8 (placed over the four baskets by hand, in the paused scene)
export default async ({ page, shot, wait, key, log }) => {
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z17WAS' && window.__zone.machine.mode === 1, null, { timeout: 300000 });
  await wait(600);
  await page.evaluate(() => {
    const R = __zone.world.records;
    const BAS = [35, 41, 39, 37];
    const use = [[0, 3], [1, 5], [2, 7], [3, 8]];
    for (const [k, n] of use) { const b = R[BAS[k]], q = R[7 + n - 2]; q.m.set(b.m); q.prev.set(b.m); q.flags = 3; b.flags = 0; }
  });
  await key('Enter'); await wait(600); await shot('ket-help'); await key('Enter'); await wait(700);
  await shot('ket');
  await page.evaluate(() => { const R = __zone.world.records; for (const i of [1,2,3,4]) R[i].flags = 3; R[1].y = 1.4; R[2].y = 1.4; });
  await wait(300); await shot('ket2');
};
