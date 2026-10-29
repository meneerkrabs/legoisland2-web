// M5 z40OGL PeppSwit bot (real key input): Ogel's island special modes in the hub: the skateboard (Ctrl on / off), a slug that bites, the decor swap (Enter next to the crystal G003 and MAMA's outfit),
// the void fall and respawn (PEPPER_CONTROL 0x20), citizens / robots moving. Pepper is placed with the hub helpers (teleportNear), everything else is played with keys.
//   BASE=http://localhost:5517 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5517/?zone=z40OGL&node=64&mute=1&hold=1&debug=1" tools/steps/m5-z40OGL-peppswit.mjs --size 1280x800 --out /tmp/m5-z40OGL-peppswit
// Env: NODE=64|66 (default 64)
import { hub, hubUrl } from './lib-hub.mjs';
export default async ({ page, wait, log, shot }) => {
  const node = Number(process.env.NODE ?? 64);
  await page.goto(hubUrl('z40OGL', node), { waitUntil: 'load' });
  const H = hub({ page, wait, log, shot }, 'z40OGL');
  await H.waitHub(); await wait(800);
  await H.start();
  for (let i = 0; i < 400 && (await H.state()).cs; i++) await wait(250);
  await H.freePepper();
  const q = (fn, arg) => page.evaluate(fn, arg);
  const ctrl = async () => (await H.state()).ctrl & 0xfff;
  const ok = (c, m) => log(c ? 'OK  ' : 'FAIL', m);
  const res = [];
  const chk = (c, m) => { res.push(c); ok(c, m); };
  await shot(`n${node}-start`);

  // ---- the skateboard: Ctrl (pressed, real key) -> mode 4, Ctrl again -> walking
  chk((await ctrl()) === 1, `walking at the start (ctrl ${(await H.state()).ctrl.toString(16)})`);
  await H.tap('ControlLeft', 90); await wait(400);
  chk((await ctrl()) === 4, `Ctrl: skateboard (ctrl ${(await H.state()).ctrl.toString(16)})`);
  await shot(`n${node}-skateboard`);
  await H.hold('ArrowUp', 900); await H.tap('ControlLeft', 90); await wait(500);
  chk((await ctrl()) === 1, `Ctrl again: off the board (ctrl ${(await H.state()).ctrl.toString(16)})`);

  // ---- a slug: Pepper next to SLG1 (record 22): the slug bites (state 2) and the walk code staggers (mailbox 1)
  if (node === 64) {
    await H.teleportNear('SLG1', 4, 0);
    await wait(300);
    let st = 0, mb = 0;
    for (let i = 0; i < 40 && st !== 2; i++) { await wait(100); st = await q(() => window.__zone.world.records.find((r) => r.name === 'SLG1').ctrl.nodes.find((n) => n.kind === 'PeppSlug').state); }
    chk(st === 2, `slug SLG1 bites (state ${st})`);
    await shot(`n${node}-slug`);
  }

  // ---- the decor swap: Enter next to the crystal G003 (record 75) changes its variant word
  {
    const name = node === 64 ? 'G002' : 'G003';
    await H.teleportNear(name, 3, 0.5); await wait(500);
    const v0 = await q((n) => window.__zone.world.records.find((r) => r.name === n).variant, name);
    await H.tap('Enter', 90);
    await H.untilTicks(async () => false, 45, 20);
    const v1 = await q((n) => window.__zone.world.records.find((r) => r.name === n).variant, name);
    chk(v1 !== v0, `Enter next to ${name}: the look changed (${v0.toString(16)} -> ${v1.toString(16)})`);
    await shot(`n${node}-decor`);
  }

  // ---- the void: the walk node only lets Pepper drop below the sea level while he is airborne (a jump off an edge), which a bot cannot aim at: the entry (y < -96 -> mode 0x20) is proven against the
  // original in m5-z40OGL-peppswit-emu; here the mode is set the way PEPPSWIT sets it and the void node's work is watched: Pepper is put 160 above PATH node 0x3e, falls, lands, walks again
  {
    await H.setVar(0x5e, 0x20);
    let saw = false, maxY = -1e9;
    for (let i = 0; i < 300; i++) { await wait(30); const st = await H.state(); if ((st.ctrl & 0xfff) === 1) break; saw = true; maxY = Math.max(maxY, st.pos[1]); }
    const n63 = await H.pathNode(0x3e);
    chk(saw && maxY > n63[1] + 100, `void node: Pepper reappeared above PATH node 0x3e (y ${maxY} vs node ${n63[1].toFixed(1)})`);
    await shot(`n${node}-void`);
    chk(await H.until(async () => (await ctrl()) === 1, 30000, 150), 'the fall ends: walking again (mode 1)');
    const s = await H.state(); chk(Math.abs(s.pos[1] - n63[1]) < 3 && Math.hypot(s.pos[0] - n63[0], s.pos[2] - n63[2]) < 3, `landed on PATH node 0x3e (${s.pos})`);
    await shot(`n${node}-landed`);
  }

  // ---- citizens / robots: their records move / animate while the game runs
  if (node === 64) {
    const a = await q(() => ['CIT1', 'CIT2', 'CIT3'].map((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return [r.x, r.z]; }));
    await H.untilTicks(async () => false, 120, 30);
    const b = await q(() => ['CIT1', 'CIT2', 'CIT3'].map((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return [r.x, r.z]; }));
    chk(a.some((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1]) > 0.1), 'the citizens walk');
    await H.teleportNear('RBT0', 8, 1); await wait(3000);
    chk((await q(() => window.__zone.world.records.find((r) => r.name === 'RBT0').anim.clip)) === 3, 'a robot near Pepper watches him (clip 3)');
    await shot(`n${node}-robots`);
  }
  log(res.every(Boolean) ? 'ALL OK' : 'SOME FAILED', res.filter(Boolean).length + '/' + res.length);
};
