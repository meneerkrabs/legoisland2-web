// M5 z14OSD: the Oasis played end to end with real key input (headless, muted): story node 34 (arrival from the Adventure Island through the real hand-over, the ADV01 cutscene, the talk to
// Johnny / Pippin / Kilroy, gems, a scorpion attack, tumbleweeds, the skateboard, the helicopter's look change, the scorpion portal = node completion -> the next zone) 
// (see m5-z14OSD-bot45.mjs). Checks print "OK" / "FAIL"; screenshots in --out.
//   sh tools/m4-snapshot-server.sh 5512
//   BASE=http://localhost:5512 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z13CAI&node=33&mute=1&hold=1&debug=1" tools/steps/m5-z14OSD-bot.mjs --size 1280x800 --out /tmp/m5-z14OSD
import { hub, hubUrl } from './lib-hub.mjs';
export default async ({ page, wait, log, shot }) => {
  let fails = 0;
  const check = (c, msg) => { log(c ? 'OK  ' : 'FAIL', msg); if (!c) fails++; };
  page.on('pageerror', (e) => { log('PAGEERROR', String(e).slice(0, 300)); fails++; });
  const near = (H, a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]) < 1.5;
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const rec = (name) => ev((n) => { const r = window.__zone.world.records.find((x) => x.name === n); return r ? [r.x, r.y, r.z] : null; }, name);
  const nodeOf = (name, kind) => ev(([n, k]) => { const r = window.__zone.world.records.find((x) => x.name === n); const nd = r?.ctrl?.nodes.find((x) => x.kind === k); return nd ? { state: nd.state, timer: nd.timer, spin: nd.spin } : null; }, [name, kind]);
  /** Pepper `d` units in FRONT of a record (its heading: FUN_004242f0 / the talk need Pepper inside the cone of the NPC's yaw), facing it, camera behind */
  const front = (name, d) => ev(([n, dist]) => {
    const z = window.__zone, w = z.world, p = z.loaded.pepper, r = w.records.find((x) => x.name === n);
    const px = r.x + Math.sin(r.ry) * dist, pz = r.z + Math.cos(r.ry) * dist;
    p.x = px; p.z = pz; p.y = r.y + 1; const g = w.col.groundRay(px, r.y + 20, pz); if (g > -1e30) p.y = g;
    p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
  }, [name, d]);
  const walkTo = async (H, name, stop = 3) => {
    // real walking: put Pepper 14 units away facing the target, hold Up until close
    await H.teleportNear(name, 14, 0.7);
    for (let i = 0; i < 8; i++) { const p = (await H.state()).pos, t = await rec(name); if (Math.hypot(p[0] - t[0], p[2] - t[2]) <= stop + 0.5) break; await H.hold('ArrowUp', 700); }
  };
  // ---------------------------------------------------------------- node 34 from the Adventure Island
  let H = hub({ page, wait, log, shot }, 'z13CAI');
  await H.start();
  log('CAI', JSON.stringify(await H.state()));
  await H.setVar(5, 11);                       // the exit portal of the Adventure Island sets NS_NEXT_SUBGAME = 11 (the Oasis)
  H = hub({ page, wait, log, shot }, 'z14OSD');
  const left = await H.untilLeft('z13CAI', 90000);
  check(left === 'z14OSD', `hand-over CAI -> ${left}`);
  await H.start();
  let s = await H.state();
  log('OSD arrival', JSON.stringify(s));
  check(s.prev === 10 && Math.abs(s.pos[0] + 385.8) < 1 && Math.abs(s.pos[2] + 149.5) < 1, `arrival from the Adventure Island (prev ${s.prev}, ${s.pos})`);
  check(s.node === 34, `story node ${s.node}`);
  await wait(1200); await shot('osd34-adv01-a');
  await H.untilTicks(async () => false, 150);
  await shot('osd34-adv01-b');
  const n0 = await H.skipCutscenes();
  log('ADV01 skipped after', n0, 'taps');
  const freed = await H.freePepper();
  log('freed', freed);
  s = await H.state();
  check(s.ctrl === 1, `Pepper free (0x${s.ctrl.toString(16)})`);
  const hud = () => ev(() => ({ l: window.__zone.hud.leftText, c: window.__zone.hud.centreText, icon: window.__zone.hud.column[0].tex }));
  check((await hud()).c === '0000', 'HUD score 0000');
  await shot('osd34-hud');

  // talk: Johnny, then Pippin (real Shift): 6 units in front of the NPC, the last steps walked with the arrow key
  const talk = async (name, tag = 'osd34') => {
    // (Johnny and Pippin walk their routes at node 34 (Human1): catch up with the NPC where it is now, 2.5 units in front of it, and talk at once; up to four tries)
    let started = false, d = 0;
    for (let attempt = 0; attempt < 4 && !started; attempt++) {
      await front(name, 2.5);
      d = await ev((n) => { const z = window.__zone, r = z.world.records.find((x) => x.name === n), p = z.loaded.pepper; return Math.hypot(r.x - p.x, r.z - p.z); }, name);
      // watch the conversation from inside the page: speech started (the NPC's line plays) and / or Pepper's control word changed
      await page.evaluate(() => { const z = window.__zone; window.__talk = { speech: false, ctrl: 0 }; window.__talkIv = setInterval(() => { const t = window.__talk; if (!z.game.ictx.speechIdle()) t.speech = true; t.ctrl |= z.sh.vars.get(0x5e) & ~1; if (z.loaded.pepper.anim?.clip === 0x78) t.ctrl |= 0x8000; }, 5); });
      await H.tap('ShiftLeft', 90);
      await H.untilTicks(async () => (await page.evaluate(() => window.__talk.speech || window.__talk.ctrl !== 0)), 120);
      started = await page.evaluate(() => { clearInterval(window.__talkIv); return window.__talk.speech || window.__talk.ctrl !== 0; });
    }
    await shot(`${tag}-talk-${name}`);
    await H.untilTicks(async () => (await H.state()).ctrl === 1, 1500);
    for (let i = 0; i < 6 && (await H.state()).ctrl !== 1; i++) { await H.tap('ShiftLeft', 90); await wait(300); }
    log(name, `distance ${d.toFixed(1)}, conversation started ${started}, ctrl`, (await H.state()).ctrl.toString(16), 'markers', JSON.stringify(await H.vars([0x106, 0xfb, 0xfc])));
    check(started, `${name}: the conversation started`);
  };
  await talk('JTHN');
  await talk('MPRD');

  // gems: walk into GEM0 (real keys for the last metres)
  await walkTo(H, 'GEM0', 1.2);
  await H.hold('ArrowUp', 500);
  await wait(400);
  const hv = await H.vars([0x17, 0x1d, 0xca]);
  check(hv[0x17] >= 1000 && (hv[0x1d] & 1) === 1, `gem picked up: score ${hv[0x17]}, items 0x${hv[0x1d].toString(16)}`);
  const h1 = await hud();
  check(Number(h1.c) === hv[0x17] && h1.l === `x${[...Array(10).keys()].filter((i) => hv[0x1d] & (1 << i)).length}`, `HUD after the gems: ${h1.c} ${h1.l}`);
  await shot('osd34-gem-hud');

  // tumbleweeds roll
  const t0 = await rec('TUM0'); await wait(1500); const t1 = await rec('TUM0');
  check(Math.hypot(t1[0] - t0[0], t1[2] - t0[2]) > 0.3, `tumbleweed rolls (${t0} -> ${t1})`);
  await H.teleportNear('TUM0', 8, 0.5); await wait(500); await shot('osd34-tumbleweed');
  await H.teleportTo(-300, 100, -300, 101); await wait(300);   // (the tumbleweeds roll towards the shore: back onto dry ground, away from the sea)
  log('safe spot', JSON.stringify(await H.state()));

  // a scorpion: stand in front of SCR0 until it attacks (state 0x10 -> grab: var 0x5e & 0x20, clip 0x70)
  // (Pepper stands still in front of SCR0; the slopes of the dunes may carry her off: up to five tries from other sides)
  let res = null;
  for (let attempt = 0; attempt < 5 && !(res?.grab && res?.clip70); attempt++) {
    await front('SCR0', 6);
    res = await page.evaluate(() => new Promise((resolve) => {
      const z = window.__zone, r = z.world.records.find((x) => x.name === 'SCR0'), nd = r.ctrl.nodes.find((x) => x.kind === 'scorpion'), t0 = z.world.tickCount;
      const seen = { alert: false, grab: false, clip70: false, tick: 0, log: [] };
      const iv = setInterval(() => {
        const t = z.world.tickCount - t0;
        if (nd.state & 0x10) seen.alert = true;
        if (z.sh.vars.get(0x5e) & 0x20) { seen.grab = true; if (z.loaded.pepper.anim?.clip === 0x70) seen.clip70 = true; }
        if (t % 10 === 0) seen.log.push(`${t}:${nd.state.toString(16)}:${z.sh.vars.get(0x5e).toString(16)}`);
        if ((seen.grab && seen.clip70) || t > 120) { clearInterval(iv); resolve(seen); }
      }, 5);
    }));
    log('scorpion try', attempt, JSON.stringify(res));
    if (attempt === 0) await shot('osd34-scorpion');
  }
  check(res.alert, 'scorpion saw Pepper (state 0x10)');
  check(res.grab && res.clip70, 'scorpion grabbed Pepper (var 0x5e & 0x20, clip 0x70)');
  await shot('osd34-grabbed');
  await H.untilTicks(async () => (((await H.state()).ctrl) & 0x20) === 0, 400);
  check((((await H.state()).ctrl) & 0x20) === 0, 'the grab ended');

  // the skateboard: Ctrl = on, Ctrl = off
  await H.teleportTo(0, 0, 0, 1);
  await wait(300);
  const c0 = (await H.state()).ctrl;
  await H.tap('ControlLeft', 90); await wait(300);
  const c1 = (await H.state()).ctrl;
  check((c1 & 0xfff) === 4 || c0 !== 1, `Ctrl: skateboard (0x${c0.toString(16)} -> 0x${c1.toString(16)})`);
  await H.hold('ArrowUp', 700); await shot('osd34-skate');
  await H.tap('ControlLeft', 90); await wait(400);
  check(((await H.state()).ctrl & 0xfff) === 1, `Ctrl again: off the board (0x${(await H.state()).ctrl.toString(16)})`);

  // the parked helicopter: Enter changes its look (game variable 0xd2 = look + variant * 256)
  await H.teleportNear('PHEL', 5, 0.9);
  await wait(400);
  const l0 = (await H.vars([0xd2]))[0xd2];
  await H.tap('Enter', 90); await wait(600);
  const l1 = (await H.vars([0xd2]))[0xd2];
  await shot('osd34-helicopter-look');
  check(l1 !== l0, `Enter near the helicopter changed its look (${l0} -> ${l1})`);

  // the scorpion portal (SCRP): walk in, Ctrl = node 34 complete -> the next zone
  await H.teleportNear('SCRP', 9, 0.4);
  await H.hold('ArrowUp', 700);
  await H.untilTicks(async () => false, 20);
  const dp = await ev(() => { const z = window.__zone, r = z.world.records.find((x) => x.name === 'SCRP'), p = z.loaded.pepper; return [Math.hypot(r.x - p.x, r.z - p.z), p.y - r.y, z.sh.vars.get(0xc)]; });
  log('at the portal: distance, dy, icon bits', JSON.stringify(dp));
  await shot('osd34-portal');
  await H.tap('ControlLeft', 90);
  await wait(500);
  log('after the portal', JSON.stringify(await H.vars([0x101, 0x58, 5])));
  const nextArch = await H.untilLeft('z14OSD', 90000);
  check(nextArch !== 'z14OSD' && nextArch !== null, `node 34 done: the story moved on to ${nextArch}`);

  log(fails ? `FAILURES: ${fails}` : 'ALL OK');
};
