// M5 audit z03PPH (Pepper's house): island -> house through the pause menu ("Huis van Pepper"), the zone the player came from is parked in var 0x4d's top byte (FUN_0053fed3),
// the pause menu of the house runs the pre-render pass of the nodes behind it (FUN_0053dfda: modes 2, 3 and 6; the update pass only in 2 and 6, so nothing moves), the door leaves to the island. Real key input, headless, muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z02LGI&node=5&mute=1" tools/steps/m5-z03PPH.mjs --size 1280x800 --out /tmp/m5-pph
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const press = async (k, n = 1, gap = 170) => { for (let i = 0; i < n; i++) { await key(k); await wait(gap); } };
  const menu = () => page.evaluate(() => { const e = __shell.menu.engine; return { page: e.page, item: e.item, open: e.open }; });
  const vars = (list) => page.evaluate((l) => l.map((i) => __zone.sh.vars.get(i)), list);
  const inZone = (arch) => page.waitForFunction((a) => window.__zone && window.__zone.info.archive === a && window.__zone.machine.mode === 2 && window.__zone.world.tickCount > 12, arch, { timeout: 300000 });
  const select = async (idx, max = 14) => { for (let i = 0; i < max && (await menu()).item !== idx; i++) await press('ArrowDown'); };
  await inZone('z02LGI');
  await press('Escape'); await wait(500);
  await select(5); await press('Enter'); await wait(500);
  await inZone('z03PPH');
  await wait(1500);
  let [v4d, v5e, v0b] = await vars([0x4d, 0x5e, 0xb]);
  expect("the house runs; the zone the player came from (the island, 2) is parked in var 0x4d's top byte", ((v4d >>> 24) & 0xff) === 2 && v5e === 1, `0x4d ${v4d.toString(16)} 0x5e ${v5e}`);
  // pause: Pepper's clock keeps going behind the menu
  const frame = () => page.evaluate(() => { const a = __zone.loaded.pepper.anim; return { frame: a ? a.frame : -1, clip: a ? a.clip : -1, mode: __zone.machine.mode, tick: __zone.world.tickCount, pass: __zone.world.frame }; });
  await press('Escape'); await wait(400);
  const f0 = await frame();
  await wait(1200);
  const f1 = await frame();
  expect('the pause menu is open (mode 3, page 29) and the world does not tick', f0.mode === 3 && f1.tick === f0.tick, JSON.stringify([f0, f1]));
  expect('the pre-render pass runs every tick of the pause (world.frame counts it) and Pepper stands still (his clip advances in the update pass)', f1.pass > f0.pass + 10 && f1.frame === f0.frame, JSON.stringify([f0, f1]));
  await shot('house-paused');
  await press('Escape'); await wait(500);
  expect('Esc closes the pause menu', (await frame()).mode === 2);
  // the door: the player starts inside its box: Shift leaves
  await press('Shift'); await wait(300);
  await inZone('z02LGI');
  const [prev, node] = await vars([0xa3, 0x58]);
  expect('the door leads back to the island (the zone the player came from)', prev === 3 && node === 5, JSON.stringify([prev, node]));
  void v0b;
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'house story part passed');
  if (fail.length) process.exitCode = 1;
};
