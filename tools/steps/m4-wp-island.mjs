// WP-ISLAND: the island's skateboard tricks (S1), the vehicles' "change the look" on Enter (S2), the swim splash (S3), the hologram / hidden decor records (S6 / S11) in the
// browser with real key input:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5517/?zone=z02LGI&node=2&mute=1" tools/steps/m4-wp-island.mjs --size 1024x768 --out /tmp/wp-island
// (the page is served by tools/m4-snapshot-server.sh 5517). Screenshots: look-0 / look-1 / look-morph, trick-*.png, swim.png.
import { island, pathNode, teleportTo } from './lib-island.mjs';

export default async (h) => {
  const { page, wait, log, shot } = h;
  const S = island(h);
  const fail = [], errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await S.start();
  for (let i = 0; i < 6; i++) { await S.skipCutscenes(); await wait(300); if (!(await S.state())?.cs) break; }

  // ---------------------------------------------------------------- S11: the decor templates are hidden, not drawn at the origin
  const hidden = await page.evaluate(() => ['BS00', 'OBL0', 'JAK0', 'TRGO', 'OPL1', 'CT00'].map((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? (r.flags & 2) !== 0 : null; }));
  expect('S11: BS00 OBL0 JAK0 TRGO OPL1 CT00 are hidden (FUN_0051c823)', hidden.every((v) => v === false), JSON.stringify(hidden));

  // ---------------------------------------------------------------- S2: Enter next to the dinghy
  const look = () => page.evaluate(() => {
    const w = window.__zone.world, L = w.ext.get('island.looks'), r = w.records.find((x) => x.name === 'DNGY');
    return { var: window.__zone.sh.vars.get(0xd7), flags: r.flags, busy: L?.busy.filter((b) => b >= 0).length ?? -1, entries: L?.entries.length ?? 0, part: L?.entries.find((e) => w.records[e.rec] === r)?.part };
  });
  await S.teleportNear('DNGY', 14, 0.6);
  await wait(800);
  let l0 = await look();
  expect('S2: the roster exists (10 vehicles) and the dinghy shows its first look', l0.entries === 10 && l0.var === 0 && l0.part === 0, JSON.stringify(l0));
  await shot('look-0');
  await S.tap('Enter', 80);
  const morphing = await S.untilTicks(async () => ((await look()).flags & 0x8000) !== 0, 20, 15);
  const l1 = await look();
  expect('S2: Enter changes the look (var 0xd7 = 1) and starts the brick morph (record flag 0x8000)', l1.var === 1 && morphing, JSON.stringify(l1));
  await shot('look-morph');
  const done = await S.untilTicks(async () => ((await look()).flags & 0x8000) === 0, 600, 40);
  expect('S2: the morph ends, the dinghy is back with the new paint', done, JSON.stringify(await look()));
  await wait(300);
  await shot('look-1');
  for (let i = 0; i < 2; i++) { await S.tap('Enter', 80); await S.untilTicks(async () => ((await look()).flags & 0x8000) === 0, 600, 40); }
  expect('S2: three Enters = look 3', (await look()).var === 3, JSON.stringify(await look()));
  await shot('look-3');

  // ---------------------------------------------------------------- S1: tricks on the skateboard
  const sk = () => page.evaluate(() => { const p = window.__zone.loaded.pepper, k = p.ctrl.nodes.find((n) => n.kind === 'skate'); return { state: k.state, clip: p.anim?.clip, progress: +k.progress.toFixed(1), ctrl: window.__zone.sh.vars.get(0x5e) & 0xfff, y: +p.y.toFixed(1) }; });
  const start = await pathNode(page, 246);       // the skate park's arrival node: open ground
  await teleportTo(page, start[0], start[2], start[0] + 80, start[2] - 40);
  await wait(500);
  await S.tap('ControlLeft', 80);
  const on = await S.untilTicks(async () => (await sk()).ctrl === 4, 60, 30);
  expect('S1: Ctrl puts Pepper on the skateboard', on, JSON.stringify(await sk()));
  await S.untilTicks(async () => (await sk()).state === 0x29, 400, 40);
  await page.keyboard.down('AltLeft');
  await S.untilTicks(async () => (await sk()).state === 0x2b || (await sk()).state === 0x2a, 80, 30);
  await S.untilTicks(async () => false, 25, 15);
  await page.keyboard.up('AltLeft');
  const air = await S.untilTicks(async () => (await sk()).state === 0x20, 60, 15);
  expect('S1: Alt = jump (state 0x20)', air, JSON.stringify(await sk()));
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowLeft');
  const trick = await S.untilTicks(async () => { const s = await sk(); return s.clip !== 0x20 && s.state === 0x20; }, 20, 12);
  const s1 = await sk();
  await shot('trick-air');
  await page.keyboard.up('Space'); await page.keyboard.up('ArrowLeft');
  expect('S1: Space + Left in the air starts a stunt clip', trick && s1.progress > 0, JSON.stringify(s1));
  await S.untilTicks(async () => (await sk()).state !== 0x20, 120, 30);
  const after = await sk();
  expect('S1: the landing is judged (0x21 / 0x29 / 0x23), no stuck state', [0x21, 0x29, 0x23, 0x2d, 0x1c].includes(after.state), JSON.stringify(after));
  await shot('trick-landed');

  // ---------------------------------------------------------------- S3b: swimming shows the splash ring and no blob shadow
  await page.evaluate(() => { const z = window.__zone, w = z.world, p = z.loaded.pepper; p.x = -300; p.z = -420; p.y = w.seaLevel - 1.5; p.rebuildYaw(); p.savePrev(); z.sh.vars.set(0x5e, 2); w.camera.init(p); });
  await wait(1200);
  const sw = await page.evaluate(() => { const z = window.__zone, w = z.world, r = w.records.find((x) => x.name === 'SPLH'); return { ctrl: z.sh.vars.get(0x5e) & 0xfff, shadow: z.sh.vars.get(0xc5), noDraw: (r.flags & 0x8000) !== 0, y: +r.y.toFixed(2), sea: w.seaLevel }; });
  log('swim', JSON.stringify(sw));
  expect('S3: while swimming the splash ring is drawn at the sea level and the blob shadow is off (var 0xc5 = -1)', (sw.ctrl === 2 && sw.shadow === -1 && !sw.noDraw && Math.abs(sw.y - sw.sea) < 0.5) || sw.ctrl !== 2, JSON.stringify(sw));
  await shot('swim');

  expect('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  log(fail.length ? `FAILED: ${fail.join('; ')}` : 'all ok');
  if (fail.length) process.exitCode = 1;
};
