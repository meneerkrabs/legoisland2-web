// WP-SAVE browser check (headless, muted): play a little, save into a slot, reload the page, let the shell load that slot and compare the world:
//   sh tools/m5-botslot.sh env NOPRESS=1 M8_URL='?zone=z02LGI&node=2&mute=1' node tools/browse.mjs "http://localhost:5599/?zone=z02LGI&node=2&mute=1" tools/steps/m8-save.mjs --size 640x480
// What is compared: (1) the saved slot bytes against the slot written by the same shell right after the load (everything but the header's time and the checksum: i.e. all variables, the walker table,
// the camera, the frame counter, every object / entity record (position, angles, flags, node states and blocks), the decor and brick sections), (2) a summary of the live world read through
// `window.__zone` (Pepper's place, variables, vehicle) before the save and after the load, (3) the in-place load: move Pepper, load the slot again, the summary equals the saved one.
// Environment: M8_SCENARIO = walk (default) | boat | pizza | hub; the url's query decides zone / node. No browser of the user's: tools/browse.mjs is headless and muted.
export default async ({ page, wait, evaluate, shot }) => {
  const scenario = process.env.M8_SCENARIO ?? 'walk';
  const base = page.url().split('?')[0];
  const ready = (mode) => page.waitForFunction((m) => window.__zone && window.__zone.machine && (m === undefined || window.__zone.machine.mode === m) && window.__zone.world.tickCount !== undefined, mode, { timeout: 240000 });
  const tap = async (code, ms = 90) => { await page.keyboard.down(code); await wait(ms); await page.keyboard.up(code); };
  const hold = async (codes, ms) => { for (const c of codes) await page.keyboard.down(c); await wait(ms); for (const c of codes) await page.keyboard.up(c); };
  const summary = () => evaluate(() => {
    const z = window.__zone, w = z.world, v = w.vars.a;
    const r = (x) => +x.toFixed(4);
    const pep = w.focus;
    return {
      zone: z.info.archive, node: v[0x58], subgame: v[0x59], control: v[0x5e], frame: w.frame, tick: w.tickCount,
      pepper: [r(pep.x), r(pep.y), r(pep.z), r(pep.ry)],
      camera: Array.from(w.camera.c.slice(0, 6), r),
      vars: Array.from(v.slice(15, 319)).reduce((h, x, i) => (Math.imul(h ^ (x | 0) ^ i, 16777619) >>> 0), 2166136261),
      records: w.records.length,
      vehicles: Array.from(w.records.entries()).filter(([, q]) => q.ctrl?.nodes?.some((n) => ['SGBoat', 'SGHeli', 'SGCar'].includes(n.kind))).map(([i, q]) => [q.name, r(q.x), r(q.y), r(q.z)]),
    };
  });
  // the slot bytes of the shell (without time / checksum) as a comparable string hash, and the plain diff of two slots
  const saveInto = (slot) => evaluate((s) => { const sh = window.__shell; const ok = sh.saveSlot(s); return { ok, len: sh.slots[s]?.length ?? 0 }; }, slot);
  const diffSlots = (a, b) => evaluate(([a, b]) => {
    const sh = window.__shell, x = sh.slots[a], y = sh.slots[b];
    if (!x || !y) return { error: 'slot missing' };
    const dv = (u) => new DataView(u.buffer, u.byteOffset, u.byteLength);
    const lx = dv(x).getUint32(0, true), ly = dv(y).getUint32(0, true);
    const diffs = [];
    const end = Math.min(lx, ly) - 8;
    for (let i = 0; i < end && diffs.length < 40; i++) if ((i < 0xc || i >= 0x10) && x[i] !== y[i]) diffs.push(i);
    return { lengths: [lx, ly], same: lx === ly && diffs.length === 0, firstDiffs: diffs.slice(0, 20) };
  }, [a, b]);

  // ---- play
  await ready();
  const z0 = await evaluate(() => window.__zone.machine.mode);
  console.log('zone mode at start', z0);
  await ready(1);
  for (let i = 0; i < 20 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await tap('ArrowLeft'); await wait(300); }   // the island / hubs wait for a button in mode 1
  await ready(2);
  await wait(500);
  if (scenario === 'walk' || scenario.startsWith('hub')) {
    await hold(['ArrowUp'], 1800); await tap('Alt'); await wait(600);
    await hold(['ArrowLeft'], 700); await hold(['ArrowUp'], 1500); await hold(['ArrowRight'], 500); await hold(['ArrowUp'], 900);
  } else if (scenario === 'boat') {
    // put Pepper on the jetty next to the Res-Q speedboat (PATH node 0x18e) and take the boat (Ctrl, as tools/tests/m4-wp15-era1.mjs does)
    await evaluate(() => { const w = window.__zone.world, c = w.ext.get('island'), b = w.records.find((q) => q.name === 'SPBT'), p = w.focus; const e = c.pathPos(0x18e); p.x = e[0]; p.z = e[2]; p.y = b.y + 0.3; p.ry = Math.atan2(b.x - e[0], b.z - e[2]); p.rebuildYaw(); p.savePrev?.(); });
    for (let i = 0; i < 100 && ((await evaluate(() => window.__zone.world.vars.get(0x5e))) & 0x100); i++) await wait(300);   // a cutscene / dialog (PEPPER_CONTROL 0x100) may run first
    await wait(600); await tap('ControlLeft'); await wait(2500);
    console.log('control after Ctrl', await evaluate(() => window.__zone.world.vars.get(0x5e)));
    await hold(['ArrowUp'], 1500); await hold(['ArrowLeft'], 400); await hold(['ArrowUp'], 800);
  } else if (scenario === 'pizza') {
    await hold(['ArrowUp'], 1500); await tap('ShiftLeft'); await wait(800); await tap('Space'); await wait(800); await hold(['ArrowUp'], 800);
  }
  await wait(300);
  const before = await evaluate(() => { const sh = window.__shell; const t = sh.saveSlot(0); return t; }).then(async () => summary());   // (save + summary in two evaluations: the world may tick between: summary only for the plausibility)
  // exact same-instant pair: a save and the summary in ONE evaluation
  const snap = await evaluate(() => {
    const z = window.__zone, w = z.world, sh = window.__shell, v = w.vars.a, r = (x) => +x.toFixed(4), pep = w.focus;
    const ok = sh.saveSlot(0);
    return { ok, len: sh.slots[0].length, pepper: [r(pep.x), r(pep.y), r(pep.z), r(pep.ry)], control: v[0x5e], node: v[0x58], frame: w.frame, vars: Array.from(v.slice(15, 319)).reduce((h, x, i) => (Math.imul(h ^ (x | 0) ^ i, 16777619) >>> 0), 2166136261) };
  });
  console.log('saved slot 0', JSON.stringify(snap));
  await shot('m8-save-1-before');
  const url = page.url();

  // ---- reload the page: the shell finds the slot in IndexedDB and loads it at start
  await page.goto(`${base}?save=0&mute=1`);
  await ready(1);
  await wait(300);
  const loaded = await evaluate(() => {
    const z = window.__zone, w = z.world, sh = window.__shell, v = w.vars.a, r = (x) => +x.toFixed(4), pep = w.focus;
    const ok = sh.saveSlot(1);
    return { ok, mode: z.machine.mode, pepper: [r(pep.x), r(pep.y), r(pep.z), r(pep.ry)], control: v[0x5e], node: v[0x58], frame: w.frame, vars: Array.from(v.slice(15, 319)).reduce((h, x, i) => (Math.imul(h ^ (x | 0) ^ i, 16777619) >>> 0), 2166136261), slot0: !!sh.slots[0] };
  });
  console.log('after the reload + load', JSON.stringify(loaded));
  const dump = async (slot, file) => { const b64 = await evaluate((sl) => { const u = window.__shell.slots[sl]; let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(bin); }, slot); (await import('node:fs')).writeFileSync(file, Buffer.from(b64, 'base64')); };
  await dump(0, `/tmp/m8-${scenario}-slot0.lgo`); await dump(1, `/tmp/m8-${scenario}-slot1.lgo`);
  const d = await diffSlots(0, 1);
  console.log('slot 0 (saved) vs slot 1 (saved right after the load):', JSON.stringify(d));
  await shot('m8-save-2-after-load');
  const same = JSON.stringify([snap.pepper, snap.control, snap.node, snap.vars]) === JSON.stringify([loaded.pepper, loaded.control, loaded.node, loaded.vars]);
  console.log(same && d.same ? 'RESULT ok: the world after the load equals the saved one' : `RESULT DIFFERENT (summary equal: ${same}, slot bytes equal: ${d.same})`);
  if (!(same && d.same)) process.exitCode = 1;

  // ---- in place: move on, load the slot again
  for (let i = 0; i < 20 && (await evaluate(() => window.__zone.machine.mode)) !== 2; i++) { await tap('ArrowLeft'); await wait(300); }
  await ready(2); await wait(300);
  await hold(['ArrowUp'], 500); await wait(100);
  const moved = await summary();
  console.log('before the in-place load: header', JSON.stringify(await evaluate(() => window.__shell.slotHeader(0))), 'vars 0x58 / 0x59', JSON.stringify(await evaluate(() => [window.__shell.vars.get(0x58), window.__shell.vars.get(0x59)])));
  const back = await evaluate(() => {   // load and save in ONE evaluation: the loop cannot tick in between
    const z = window.__zone, w = z.world, sh = window.__shell, r = (x) => +x.toFixed(4), pep = w.focus;
    const ret = sh.loadSlot(0);
    sh.saveSlot(2);
    return { ret, pepper: [r(pep.x), r(pep.y), r(pep.z), r(pep.ry)], mode: z.machine.mode };
  });
  const r2 = back.ret;
  await dump(2, `/tmp/m8-${scenario}-slot2.lgo`);
  const d2 = await diffSlots(0, 2);
  console.log('in-place load returned', r2, 'moved to', JSON.stringify(moved.pepper), 'after the load', JSON.stringify(back.pepper), 'slot compare', JSON.stringify(d2));
  console.log(JSON.stringify(back.pepper) === JSON.stringify(snap.pepper) ? 'RESULT ok: in-place load restores Pepper' : 'RESULT DIFFERENT: in-place load');
  // import / export of .lgo files (the E / I keys of the load page call these): the exported bytes are the file, an import into another slot gives the same header; a wrong checksum is accepted with a warning (the original never checks it), a wrong version is rejected
  const io = await evaluate(async () => {
    const sh = window.__shell, b = sh.exportSlot(0);
    await sh.importSlot(5, b);
    const h0 = sh.slotHeader(0), h5 = sh.slotHeader(5);
    let bad = 'none';
    try { const c = b.slice(); c[0x100] ^= 1; const w = await sh.importSlot(6, c); bad = 'accepted, warnings ' + w.length; } catch (e) { bad = 'rejected: ' + (e.reason ?? e.message); }
    let ver = 'none';
    try { const c = b.slice(); c[4] ^= 1; await sh.importSlot(6, c); ver = 'accepted'; } catch (e) { ver = 'rejected: ' + (e.reason ?? e.message); }
    return { size: b.length, same: JSON.stringify(h0) === JSON.stringify(h5), damaged: bad, version: ver };
  });
  console.log('export / import', JSON.stringify(io));
  console.log(io.size === 0x51c8c && io.same && io.damaged === 'accepted, warnings 1' && io.version.startsWith('rejected') ? 'RESULT ok: export / import' : 'RESULT DIFFERENT: export / import');
  void before; void url;
};
