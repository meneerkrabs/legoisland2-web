// WP-DECOR browser check (headless, muted): the island's NPCs / signs / flowers keep their own models through island -> castle -> back -> save -> page reload -> load, and a slot written by an older
// build of the port (decor section all zeros = every entry { set 0, variant 0 } = the pine tree) loads as the defaults instead of turning the island into pine trees.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5599/?zone=z02LGI&node=30&mute=1" tools/steps/m8-save-decor.mjs --size 640x480
// (the page the url points at is only the starting point: the steps navigate on their own). Exit code 1 on a failed check.
export default async ({ page, wait, evaluate }) => {
  const base = page.url().split('?')[0];
  const ready = (zone) => page.waitForFunction((zn) => window.__zone && window.__zone.info.archive === zn && window.__zone.world.tickCount > 5, zone, { timeout: 240000 });
  const NAMES = ['BRIK', 'INFO', 'PAPA', 'MAMA', 'NICK', 'BILL', 'NANC', 'LICK', 'VALS', 'POST', 'SIGN', 'FLR1', 'TREE', 'PALM'];
  const models = () => evaluate((names) => {
    const w = window.__zone.world, out = {};
    for (const n of names) { const r = w.records.find((q) => q.name === n); out[n] = r ? (r.model ? `${r.model.array}:${r.model.index}` : 'none') : 'absent'; }
    return out;
  }, NAMES);
  const decorNonZero = () => evaluate(async () => {
    const m = await import('/src/island/decor.ts');
    return { pending: m.decorStore.pending, nonzero: m.decorStore.mem.reduce((a, x) => a + (x ? 1 : 0), 0) };
  });
  let failed = false;
  const check = (c, msg) => { console.log(c ? 'ok   ' : 'FAIL ', msg); if (!c) failed = true; };
  /** NPCs must have their own models: not the pine tree's, and (the ones that exist) not all the same one */
  const own = (m, base0) => {
    const npcs = NAMES.filter((n) => !['TREE', 'PALM', 'SIGN', 'FLR1'].includes(n) && m[n] !== 'absent');
    const pineLike = npcs.filter((n) => m[n] === m.TREE).length;
    return { pineLike, distinct: new Set(npcs.map((n) => m[n])).size, same: base0 ? NAMES.every((n) => m[n] === base0[n]) : true };
  };
  const goZone = (zone) => evaluate((zn) => { const sh = window.__shell, i = sh.zones.findIndex((z) => z.archive === zn); sh.vars.set(5, i); sh.loop.pending = { kind: 2, node: sh.vars.get(0x58), zone: i }; }, zone);
  const goIsland = () => evaluate(() => { const sh = window.__shell; sh.vars.set(5, 2); sh.loop.pending = { kind: 2, node: sh.vars.get(0x58), zone: 2 }; });

  await ready('z02LGI'); await wait(1500);
  const m0 = await models();
  console.log('start', JSON.stringify(m0));
  const o0 = own(m0);
  check(o0.pineLike === 0 && o0.distinct > 3, `island start: the NPCs have their own models (${o0.pineLike} pine-like, ${o0.distinct} distinct)`);
  // island -> castle -> back
  await goZone('z07CSI'); await ready('z07CSI'); await wait(1500);
  check((await decorNonZero()).nonzero > 300, 'castle: the stored decor is not zeros');
  await goIsland(); await ready('z02LGI'); await wait(1500);
  const m1 = await models();
  check(own(m1, m0).same, 'back on the island: every model as at the start');
  // save, check the section, reload, load
  const saved = await evaluate(() => { const sh = window.__shell; const ok = sh.saveSlot(0); const s = sh.slots[0], dv = new DataView(s.buffer, s.byteOffset, s.length); let p = -1; for (let i = 0x2510; i < s.length; i += 4) if (dv.getUint32(i, true) === 0x9099009 && dv.getUint32(i + 4, true) === 0x380) { p = i + 8; break; } return { ok, nonzero: s.subarray(p, p + 0x380).reduce((a, x) => a + (x ? 1 : 0), 0) }; });
  check(saved.ok && saved.nonzero > 300, `the save's decor section is not zeros (${saved.nonzero} non-zero bytes)`);
  await wait(800);
  // an older build's slot: the same file with a zero decor section, in slot 1 (and persisted)
  await evaluate(async () => {
    const sh = window.__shell, s = sh.slots[0].slice(), dv = new DataView(s.buffer, s.byteOffset, s.length);
    let p = -1; for (let i = 0x2510; i < s.length; i += 4) if (dv.getUint32(i, true) === 0x9099009 && dv.getUint32(i + 4, true) === 0x380) { p = i + 8; break; }
    s.fill(0, p, p + 0x380); sh.slots[1] = s;
    await sh.saves.backend.put('Save01.lgo', s);
  });
  await page.goto(`${base}?save=0&mute=1`);
  await ready('z02LGI'); await wait(1500);
  const m2 = await models();
  check(own(m2, m0).same, 'after the page reload + load of the saved slot: every model as before the save');
  check((await decorNonZero()).nonzero > 300, 'after the load: the stored decor is not zeros');
  await page.goto(`${base}?save=1&mute=1`);
  await ready('z02LGI'); await wait(1500);
  const m3 = await models();
  const o3 = own(m3, m0);
  console.log('legacy slot', JSON.stringify(m3));
  check(o3.pineLike === 0 && o3.same, 'an older build\'s slot (zero decor section) loads with the NPCs\' own models, not as pine trees');
  const s1 = await evaluate(() => { const sh = window.__shell; sh.saveSlot(2); const s = sh.slots[2], dv = new DataView(s.buffer, s.byteOffset, s.length); let p = -1; for (let i = 0x2510; i < s.length; i += 4) if (dv.getUint32(i, true) === 0x9099009 && dv.getUint32(i + 4, true) === 0x380) { p = i + 8; break; } return s.subarray(p, p + 0x380).reduce((a, x) => a + (x ? 1 : 0), 0); });
  check(s1 > 300, `a save made after loading the old slot holds the repaired decor (${s1} non-zero bytes)`);
  console.log(failed ? 'RESULT FAILED' : 'RESULT ok');
  if (failed) process.exitCode = 1;
};
