// M5 audit z04IFC (the Information Centre) in the story: `?zone=z04IFC` = story node 70. Real key input, headless and muted:
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z04IFC&mute=1" tools/steps/m5-z04IFC.mjs --size 1280x800 --out /tmp/m5-ifc
// Checks the two things the oracle test (m5-audit-z04IFC-emu) found / the audit added, in the running game: (1) the fade-in runs the update pass (the selected pin has bobbed 16 steps
// when the room starts), (2) the turn towards the door (Left at the far view) really turns the camera (target z = 7.2 - cos a: 6.2 at the start, 6.89 at the end: it looks at the
// door side), the exit question, Annuleren turns back, OK completes node 70 and the story moves on to z50LTC (node 71).
export default async ({ page, shot, wait, log, key }) => {
  const fail = [];
  const expect = (name, cond, extra = '') => { log(cond ? 'ok  ' : 'FAIL', name, extra); if (!cond) fail.push(name); };
  const dbg = () => page.evaluate(() => { const z = window.__zone; if (!z) return null; return { arch: z.info.archive, mode: z.machine.mode, tick: z.world.tickCount, g: z.game?.debug?.() ?? null, node: z.sh.vars.get(0x58) }; });
  const until = async (fn, what, ms = 15000) => { const t0 = Date.now(); for (;;) { const s = await dbg(); if (s && fn(s)) return s; if (Date.now() - t0 > ms) { log('timeout waiting for', what, JSON.stringify(s)); return s; } await wait(50); } };
  const press = async (k) => { await key(k); await wait(120); };
  // the first state of the room (mode 2 reached)
  await page.waitForFunction(() => window.__zone && window.__zone.info.archive === 'z04IFC' && window.__zone.machine.mode === 2, null, { timeout: 300000 });
  let s = await dbg();
  expect('story node 70, the Information Centre', s.node === 70 && s.arch === 'z04IFC', JSON.stringify([s.node, s.arch]));
  // (1) the pin's bob angle: 16 steps of the fade-in plus one per mode-2 tick (30 ticks of 10 degrees wrap after 2 pi: replay the recurrence of FUN_0054b982)
  const check = await page.evaluate(() => {
    const z = window.__zone, f = Math.fround;
    const n = z.world.tickCount + 16, g = z.game.debug();
    let a = 0; for (let i = 0; i < n; i++) { a = f(a + f(0.1745319962501526)); if (f(Math.PI * 2) < a) a = 0; }
    return { ticks: z.world.tickCount, angle: g.pinAngle, expected: a, n };
  });
  expect('the fade-in ran the update pass: the pin bobbed 16 steps before the first mode-2 tick', Math.abs(check.angle - check.expected) < 1e-4 && check.n > 16 - 1, JSON.stringify(check));
  await until((x) => x.g.state === 3, 'the far view');
  await shot('ifc-far');
  // (1b) Esc: the loop top switches to the pause mode BEFORE the update pass, so the tick of the key press runs no update (the pin does not take its step although the world ticked)
  const steps = (extra) => page.evaluate((extra) => {
    const z = window.__zone, f = Math.fround, n = z.world.tickCount + 16 + extra, g = z.game.debug();
    let a = 0; for (let i = 0; i < n; i++) { a = f(a + f(0.1745319962501526)); if (f(Math.PI * 2) < a) a = 0; }
    return { mode: z.machine.mode, tick: z.world.tickCount, angle: g.pinAngle, expected: a };
  }, extra);
  await key('Escape');
  await until((x) => x.mode === 3, 'the pause menu');
  const paused = await steps(-1);
  expect('the Esc tick ran no update pass (one world tick fewer pin steps than ticks)', paused.mode === 3 && Math.abs(paused.angle - paused.expected) < 1e-4, JSON.stringify(paused));
  await key('Escape'); await until((x) => x.mode === 2, 'back in the room');
  // (2) Left: the turn
  await press('ArrowLeft');
  s = await until((x) => x.g.state === 8 || x.mode === 5, 'the end of the turn');
  s = await until((x) => x.mode === 5, 'the exit question');
  const t = s.g.target;
  expect('turned by 72 degrees about the eye (target (0.951, 6.89))', Math.abs(t[0] - Math.sin(1.2566370964050293)) < 1e-3 && Math.abs(t[2] - (7.199999809265137 - Math.cos(1.2566370964050293))) < 1e-3, JSON.stringify(t));
  expect('the door is open while the question is up', s.g.door[0] === 2 || s.g.door[0] === 1, JSON.stringify(s.g.door));
  await shot('ifc-exit-question');
  // Annuleren turns back (Down moves to the second item, Enter picks it)
  await press('ArrowDown'); await press('Enter');
  s = await until((x) => x.mode === 2 && x.g.state === 3 && x.g.door[0] === 0, 'back to the far view with the door closed');
  expect('Annuleren: back in the room, door closed', s.mode === 2 && s.g.state === 3 && s.g.door[0] === 0, JSON.stringify([s.mode, s.g.state, s.g.door]));
  // leave: Left again, OK
  await press('ArrowLeft');
  s = await until((x) => x.mode === 5, 'the exit question');
  await press('Enter');
  s = await until((x) => x.arch === 'z50LTC', 'z50LTC', 20000);
  expect('OK: node 70 completes and the story moves on to z50LTC (node 71)', s.arch === 'z50LTC' && s.node === 71, JSON.stringify([s.arch, s.node]));
  log(fail.length ? `FAILED: ${fail.join(', ')}` : 'Information Centre story part passed');
  if (fail.length) process.exitCode = 1;
};
