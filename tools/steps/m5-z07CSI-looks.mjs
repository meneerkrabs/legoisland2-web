// M5 z07CSI, the Enter key of the castle (Control's pre-render FUN_005b2e9f): (1) the look change of the speedboat (roster table 0x9031d0, var 0xae = part + variant * 256, the brick morph of the speedboat),
// (2) the decor swap of a castle tree (decor group 1: the record's variant word, the stored decor), with REAL key presses; screenshots during the morph / the pop.
import { csi, url } from './lib-z07CSI.mjs';
export default async (h) => {
  const { page, wait, log } = h;
  const S = csi(h);
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  await page.goto(url(15), { waitUntil: 'load' });
  await S.waitHub();
  await S.start();
  await wait(800);
  const st = () => page.evaluate(() => {
    const z = window.__zone, w = z.world, b = w.records.find((r) => r.name === 'SPBT'), L = w.ext.get('island.looks'), fx = w.ext.get('island.brickfx');
    return { ae: z.sh.vars.get(0xae), flags: b.flags.toString(16), variant: b.variant, entries: L ? L.entries.map((e) => ({ rec: e.rec, var: e.varIdx, part: e.part, variant: e.variant, slot: e.slot })) : null, busy: L ? [...L.busy] : null };
  });
  let s0 = await st();
  log('roster', JSON.stringify(s0));
  expect('the castle roster exists (3 entries: SPBT / DNGY / JSKI) and SPBT has the vehicle variant word 2', s0.entries?.length === 3 && s0.entries[0].rec === 87 && s0.variant === 2, JSON.stringify(s0));
  await S.shot('csi-looks-01-before');
  // Enter in the boat: the nearest roster record is the boat itself
  await page.keyboard.down('Enter'); await wait(150); await page.keyboard.up('Enter');
  await wait(400);
  const s1 = await st();
  await S.shot('csi-looks-02-morph');
  log('after Enter', JSON.stringify(s1));
  expect('Enter changed the look: var 0xae = part + variant * 256 moved on, the boat is busy (flags 0x8020) or already done', s1.ae !== s0.ae && (s1.busy.some((b) => b >= 0) || (parseInt(s1.flags, 16) & 0x8020) === 0), JSON.stringify([s0.ae, s1.ae, s1.busy, s1.flags]));
  await wait(3000);
  const s2 = await st();
  await S.shot('csi-looks-03-new-paint');
  expect('the morph is over: the boat is free again (flags & 0x8020 clear, busy list empty)', (parseInt(s2.flags, 16) & 0x8020) === 0 && s2.busy.every((b) => b < 0), JSON.stringify(s2));

  // ---- the decor: a castle tree next to Pepper (walking), Enter
  // node 19 starts with the cutscene csi02 (skipped with Shift taps), Pepper then walks on land
  await page.goto(url(19), { waitUntil: 'load' });
  await S.waitHub();
  await S.start();
  await wait(800);
  await S.skipCutscenes();
  await wait(500);
  await page.evaluate(() => { const z = window.__zone, w = z.world, p = z.loaded.pepper; w.vars.set(0x5e, 1); const g = w.ext.get('island.vehicles'); if (g) g.current = null; });
  // the first TREE record by name is a plain one: the decor trees are the ones with a type-1 variant word
  await page.evaluate(() => { const z = window.__zone, w = z.world, p = z.loaded.pepper; const r = w.records.find((x) => x.index === 101);
    const px = r.x + Math.sin(0.5) * 4, pz = r.z + Math.cos(0.5) * 4; p.x = px; p.z = pz; p.y = r.y + 1; const g = w.col.groundRay(px, r.y + 20, pz); if (g > -1e30) p.y = g;
    p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p); });
  await wait(500);
  const dec = () => page.evaluate(() => {
    const w = window.__zone.world, p = w.records.find((r) => r.name === 'PEPP');
    let best = null;
    for (const r of w.records) if (r.name === 'TREE' || r.name === 'OAKS') { const d = Math.hypot(r.x - p.x, r.z - p.z); if (!best || d < best.d) best = { d, i: r.index, v: r.variant, name: r.name, model: r.model?.name ?? null }; }
    const D = w.ext.get('island.decor');
    return { best, cnt: D ? [...D.cnt] : null, blob: D?.blob ? D.blob.length : null };
  });
  const d0 = await dec();
  log('nearest tree', JSON.stringify(d0));
  await page.keyboard.down('Enter'); await wait(150); await page.keyboard.up('Enter');
  await wait(100);
  await S.shot('csi-looks-04-decor-pop');
  const d1 = await dec();
  log('after Enter', JSON.stringify(d1));
  await wait(1500);
  const d2 = await dec();
  await S.shot('csi-looks-05-decor-done');
  log('after the pop', JSON.stringify(d2));
  expect('Enter next to a castle tree: its variant word changed (decor type 1: set << 8 | 1 | variant << 16) after the pop', d2.best && d0.best && d2.best.v !== d0.best.v && (d2.best.v & 0xff) === 1, JSON.stringify([d0.best, d2.best]));
  log(fail.length ? `FAILED: ${fail.join(' | ')}` : 'ALL OK');
  if (fail.length) process.exitCode = 1;
};
