// M5 z14OSD node 45: the Oasis played end to end with real key input (headless, muted): story node 45
// (arrival, the objective, the walk to the NPCs at PATH node 6, the ADV05 cutscene played to its end = the node's condition var 0x103 = 7, the hand-over to the next zone). Checks print "OK" / "FAIL"; screenshots in --out.
//   sh tools/m4-snapshot-server.sh 5512
//   BASE=http://localhost:5512 sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5512/?zone=z14OSD&node=45&mute=1&hold=1&debug=1" tools/steps/m5-z14OSD-bot45.mjs --size 1280x800 --out /tmp/m5-z14OSD
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
  let H = hub({ page, wait, log, shot }, 'z14OSD');
  const hud = () => ev(() => ({ l: window.__zone.hud.leftText, c: window.__zone.hud.centreText, icon: window.__zone.hud.column[0].tex }));
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
  await H.start();
  let s = await H.state();
  log('node 45', JSON.stringify(s));
  check(s.node === 45, 'story node 45');
  check(s.pos[0] > 100, `arrival (not from the Adventure Island): PATH node 0x10 (${s.pos})`);
  await H.skipCutscenes(); await H.freePepper();
  check((await H.state()).ctrl === 1, 'Pepper free');
  const sm = await ev(() => window.__zone.game.debug().osd.subMatrices);
  check(sm.length === 2 && sm.every((x) => x.applied), `node 45 sub-object matrices ${JSON.stringify(sm)}`);
  const goal = await ev(() => window.__zone.game.debug().objective);
  log('objective', JSON.stringify(goal));
  check(goal.target && goal.recs[0] === 5, 'the objective arrow points at Johnny (record 5)');
  // the story: the three NPCs wait at PATH node 6 (516.6, 5.1, -223.5); the StartCSM trigger there (radius 2.5 * 8 around the waypoint) plays ADV05 and then sets var 0x103 = 7 (the node's condition).
  // Walk there with the arrow key from 90 units away (the long first part of the way is skipped by the teleport; the approach is real)
  await H.teleportTo(516.6 - 90, -223.5 + 40, 516.6, -223.5);
  let sawCs = false;
  for (let i = 0; i < 40 && !sawCs; i++) { await H.hold('ArrowUp', 600); sawCs = (await H.state()).cs; if (i % 5 === 4) await H.teleportTo(...(await H.state()).pos.filter((_, k) => k !== 1), 516.6, -223.5); }
  check(sawCs, 'the ADV05 cutscene starts at the NPCs (PATH node 6)');
  await wait(1500); await shot('osd45-adv05-a');
  await H.untilTicks(async () => false, 120);
  await shot('osd45-adv05-b');
  // let it play to the end (no skip): the trigger applies its variable operation when the script finishes
  const ended = await H.untilTicks(async () => !(await H.state()).cs, 3000);
  log('ADV05 ended', ended, JSON.stringify(await H.vars([0x103, 0xba])));
  const v103 = await page.evaluate(() => window.__zone?.sh.vars.get(0x103)).catch(() => null);
  const next45 = await H.untilLeft('z14OSD', 120000);
  check(next45 !== 'z14OSD' && next45 !== null, `node 45 done (var 0x103 = ${v103}): the story moved on to ${next45}`);
  log(fails ? `FAILURES: ${fails}` : 'ALL OK');
};
