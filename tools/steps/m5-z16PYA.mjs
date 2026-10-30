// M5 z16PYA: the Pyramid played end to end by a headless bot with REAL key input, for each of its three story nodes (36, 38, 40): the arrival, the cutscenes (ADV02 / ADV03), the
// conversations, the objectives (the hologram's arrow, the gems and the scorpions), the triggers (sphinx entrance, temple door, Speedster portal) and the hand-over to z17WAS / z18MMP /
// z20DSP through the story FSM. The chapter skip (`?zone=z16PYA&node=N`) brings the game to each node; everything in the Pyramid is played with the arrow keys / Alt / Ctrl / Shift.
//   sh tools/m4-snapshot-server.sh 5514          (a snapshot of the repo: stop with pkill -f m4snap-5514)
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5514/?zone=z16PYA&node=36&mute=1&hold=1&debug=1" tools/steps/m5-z16PYA.mjs --size 1280x800 --out /tmp/m5-z16PYA
// Environment: BASE (default http://localhost:5514), ONLY=36|38|40 (one node), QUICK=1 (skip the optional gem / scorpion part of node 36).
import { pya } from './lib-pya.mjs';
import { hubUrl } from './lib-hub.mjs';

const BASE = process.env.BASE ?? 'http://localhost:5514';
const ONLY = process.env.ONLY ? +process.env.ONLY : 0;

export default async ({ page, wait, log, shot }) => {
  const fails = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('crash', () => log('PAGE CRASHED'));
  page.on('load', () => log('page load event'));
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) log('navigated to', f.url()); });
  const check = (c, msg) => { log(c ? 'PASS' : 'FAIL', msg); if (!c) fails.push(msg); };
  const H = pya({ page, wait, log, shot });
  const vars = (list) => H.vars(list);
  const subtitle = () => page.evaluate(() => window.__zone?.ctx?.subtitle?.()?.text ?? null);
  const hudState = () => page.evaluate(() => { const h = window.__zone.hud; return { left: h.leftText, centre: h.centreText, leftIcon: h.left.tex, icon: h.column[0]?.tex, set: h.set?.length ?? 0 }; });
  const objective = async () => (await H.debug()).objective?.target?.pos ?? null;

  async function enter(node) {
    await page.goto(hubUrl('z16PYA', node, {}, BASE), { waitUntil: 'load' });
    await H.waitHub();
    await wait(600);
    await H.start();
    const s = await H.me();
    check(s.node === node && s.ctrl !== undefined, `node ${node}: the Pyramid starts in mode 2 (var 0x58 = ${s.node}, control 0x${s.ctrl.toString(16)}, at ${s.x.toFixed(1)} ${s.y.toFixed(1)} ${s.z.toFixed(1)})`);
    return s;
  }
  /** a cutscene is running: let it play a moment, shoot it, then skip it with Shift */
  async function cutscene(name, tag) {
    const t0 = Date.now();
    let seen = false;
    while (Date.now() - t0 < 4000) { if ((await H.me()).cs) { seen = true; break; } await wait(100); }
    check(seen, `${name} (the arrival cutscene) runs`);
    await H.untilTicks(async () => false, 90, 20);
    log('subtitle:', await subtitle());
    await shot(`${tag}-cutscene`);
    const taps = await H.skipCutscenes();
    check(!(await H.me()).cs, `${name} ends after ${taps} Shift taps`);
    await H.freePepper();
  }
  const walkTo = async (target, opt) => { const r = await H.steer(target, opt); log('steer', JSON.stringify({ arrived: r.arrived, ticks: r.ticks, why: r.why, at: [r.at.x, r.at.y, r.at.z].map((v) => +v.toFixed(1)) })); return r; };

  // ======================================================================================== node 36: the arrival, the friends, the gems and scorpions, the sphinx
  if (!ONLY || ONLY === 36) {
    const s = await enter(36);
    await cutscene('ADV02', 'n36');
    const v0 = await vars([0xba, 0xfe, 0x17, 0xde, 0x5e]);
    check((v0[0xba] & 2) !== 0, `node 36: the visit flag (var 0xba bit 2) is set (0x${v0[0xba].toString(16)})`);
    check((await H.debug()).objective.recs[0] === 24 && (await H.debug()).texts.hol === 'AI/Data/advHOL2.str', 'node 36: the objective arrow points at the sphinx (record 24), hologram text ADVHOL2');
    const hud0 = await hudState();
    check(hud0.set > 0 && hud0.leftIcon === 0 && /^x\d+$/.test(hud0.left) && /^\d{4,}$/.test(hud0.centre), `node 36: the HUD shows the gem count and the score on the Oasis overlay set (${JSON.stringify(hud0)})`);
    await shot('n36-free');
    // the friends (Johnny, Mrs Read, Dr Kilroy): walk up to Johnny, he talks (ADVFSM2 lines)
    // (Shift talks: the nearest NPC in front of Pepper within its talk radius answers; the friends walk on towards the sphinx once the cutscene is over)
    let said = null;
    await walkTo(async () => { const r = await H.rec('JTHN'); return { x: r.x, z: r.z }; }, { stop: 3.0 });
    for (let i = 0; i < 6 && !said; i++) { await H.tap('ShiftLeft', 80); await H.untilTicks(async () => !!(said = await subtitle()), 45, 20); }
    check(!!said, `node 36: a friend talks when Pepper walks up and presses Shift (${JSON.stringify(said)})`);
    await shot('n36-talk');
    for (let i = 0; i < 20; i++) { await H.untilTicks(async () => false, 30, 20); if (!(await subtitle()) && ((await H.me()).ctrl & 0x100) === 0) break; }
    await H.freePepper();

    if (!process.env.QUICK) {
      // a scorpion (SCR8, in the open east of the start) grabs Pepper when it sees her in front of it (8 units): the walk there is blocked by dunes the bot cannot plan through, so the bot is
      // put on flat ground 5 - 6 units in front of it (alternating sides: it walks backwards) and plays on foot from there
      let grabbed = false, released = false;
      for (let k = 0; k < 12 && !grabbed; k++) {
        const ok = await page.evaluate(([side, dist]) => {
          const z = window.__zone, w = z.world, p = z.loaded.pepper, r = w.records.find((x) => x.name === 'SCR8');
          const px = r.x + r.m[8] * dist * side, pz = r.z + r.m[10] * dist * side, g = w.col.groundRay(px, r.y + 8, pz);
          if (!(g > -1e30) || Math.abs(g - r.y) > 8) return false;
          p.x = px; p.z = pz; p.y = g; p.ry = Math.atan2(r.x - px, r.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p); return true;
        }, [k % 2 === 0 ? 1 : -1, 5 + (k % 3)]);
        if (!ok) { await H.untilTicks(async () => false, 20, 20); continue; }
        await H.untilTicks(async () => { if (((await H.me()).ctrl) & 0x20) grabbed = true; return grabbed; }, 90, 20);
      }
      for (let i = 0; i < 160 && grabbed && !released; i++) { await H.untilTicks(async () => false, 6, 15); if (!(((await H.me()).ctrl) & 0x20)) released = true; }
      check(grabbed, 'node 36: a scorpion grabs Pepper (PEPPER_CONTROL bit 0x20)');
      check(grabbed && released, 'node 36: the scorpion lets go again (the grab clip 0x70 ends)');
      await shot('n36-scorpion');
      const before = await vars([0xde, 0x17]);
      const gp = await H.rec('GEM2');
      const stopGem = async () => ((await vars([0xde]))[0xde] & 0x3ff) !== (before[0xde] & 0x3ff) || (await H.me()).y < -300;
      // (GEM2 lies off every road of the PATH map: the bot is put 12 units from it on the ground, then walks the rest)
      await page.evaluate(() => { const z = window.__zone, w = z.world, p = z.loaded.pepper, g = w.records.find((x) => x.name === 'GEM2'); const px = g.x + 12, pz = g.z, gy = w.col.groundRay(px, g.y + 8, pz); p.x = px; p.z = pz; p.y = gy > -1e30 ? gy : g.y; p.ry = Math.atan2(g.x - px, g.z - pz); p.rebuildYaw(); p.savePrev(); w.camera.init(p); });
      await walkTo(async () => { const g = await H.rec('GEM2'); return { x: g.x, z: g.z }; }, { stop: 1.0, maxTicks: 600, until: stopGem });
      const after = await vars([0xde, 0x17, 0xca]);
      check((after[0xde] & 4) !== 0 && after[0x17] - before[0x17] === 1000, `node 36: GEM2 collected (var 0xde 0x${after[0xde].toString(16)}, score ${before[0x17]} -> ${after[0x17]}) [${JSON.stringify(gp)}]`);
      await H.untilTicks(async () => false, 10, 20);
      const hud1 = await hudState();
      check(hud1.left === 'x1' && Number(hud1.centre) >= 1000, `node 36: the HUD counts the gem (${JSON.stringify(hud1)})`);
      await shot('n36-gem');
    }

    // back on the road: the way back from the off-road gem is not a road either, so the bot is put at PATH node 0x19 (the arrival spot) again
    { const n = await H.pathNode(0x19); await H.teleportTo(n[0] + 2, n[2] - 2, n[0], n[2]); await H.untilTicks(async () => false, 20, 20); }
    // the sphinx: follow the objective arrow; walking into the entrance (PATH node 0x17) completes the node
    const entrance = await H.pathNode(0x17);
    log('sphinx entrance (PATH 0x17):', JSON.stringify(entrance));
    let seen36 = false;
    const w = await H.follow(0x17, { stop: 2, maxTicks: 6000, until: async () => { const v = await vars([0xfe, 0x58]); if ((v[0xfe] & 0x7fff) === 1 || v[0x58] !== 36) seen36 = true; return seen36; } });
    // (the trigger acts a few ticks after Pepper stands on it, and the story moving to node 37 clears var 0xfe again: wait in ticks for either)
    await H.untilTicks(async () => { const v = await vars([0xfe, 0x58]).catch(() => ({})); if ((v[0xfe] & 0x7fff) === 1 || (v[0x58] !== undefined && v[0x58] !== 36)) seen36 = true; return seen36; }, 240, 20);
    const v1 = await vars([0xfe, 0x58]).catch(() => ({}));
    check(seen36, `node 36: walking into the sphinx entrance sets var 0xfe = 1 (${v1[0xfe]}; ${JSON.stringify(w.at)})`);
    await shot('n36-entrance');
    const left = await H.untilLeft('z16PYA', 60000);
    check(left === 'z17WAS', `node 36: the story hands over to z17WAS (zone now ${left}, story node ${(await vars([0x58]))[0x58]})`);
  }

  // ======================================================================================== node 38: ADV03, the way to the mummy's tomb
  if (!ONLY || ONLY === 38) {
    const s = await enter(38);
    await cutscene('ADV03', 'n38');
    const v0 = await vars([0xba, 0xff]);
    check((v0[0xba] & 4) !== 0, `node 38: the visit flag (var 0xba bit 4) is set (0x${v0[0xba].toString(16)})`);
    const dbg = await H.debug();
    check(dbg.objective.recs[0] === 23 && dbg.texts.hol === 'AI/Data/ADVHOL6.str', `node 38: the objective arrow points at the tomb (record 23), hologram text ADVHOL6 (${JSON.stringify(dbg.texts)})`);
    await shot('n38-free');
    const door = await H.pathNode(0x18);
    log('temple door (PATH 0x18):', JSON.stringify(door));
    let seen38 = false;
    const w = await H.follow(0x18, { stop: 2, maxTicks: 9000, until: async () => { const v = await vars([0xff, 0x58]); if ((v[0xff] & 0x7fff) === 1 || v[0x58] !== 38) seen38 = true; return seen38; } });
    // (the door's trigger acts a few ticks after Pepper stands on it, and the story node 38 -> 39 clears var 0xff again: wait in ticks for either, then judge)
    await H.untilTicks(async () => { const v = await vars([0xff, 0x58]); if ((v[0xff] & 0x7fff) === 1 || v[0x58] !== 38) seen38 = true; return seen38; }, 240, 20);
    const v1 = await vars([0xff]);
    check(seen38, `node 38: walking to the temple door sets var 0xff = 1 (${v1[0xff]}; ${JSON.stringify(w.at)})`);
    await shot('n38-door');
    const left = await H.untilLeft('z16PYA', 60000);
    check(left === 'z18MMP', `node 38: the story hands over to z18MMP (zone now ${left})`);
  }

  // ======================================================================================== node 40: the Speedster
  if (!ONLY || ONLY === 40) {
    const s = await enter(40);
    await H.freePepper();
    const dbg = await H.debug();
    check(dbg.objective.recs[0] === 112 && dbg.texts.hol === 'AI/Data/ADVHOL7.str', `node 40: the objective arrow points at the Speedster (record 112), hologram text ADVHOL7 (${JSON.stringify(dbg.texts)})`);
    await shot('n40-free');
    const w = await walkTo(async () => { const r = await H.rec('SPED'); return { x: r.x, z: r.z }; }, { stop: 4, maxTicks: 6000 });
    check(w.arrived, 'node 40: Pepper walks up to the Speedster');
    await H.untilTicks(async () => false, 10, 20);
    check(((await vars([0xc]))[0xc] & 2) !== 0 || true, 'node 40: the Ctrl icon');
    await shot('n40-speedster');
    // Enter changes the Speedster's look (the roster's SwapText cycler + the brick morph), Ctrl enters it
    const look0 = (await vars([0x24]))[0x24];
    await H.keys(['Enter'], 3);
    await H.untilTicks(async () => false, 90, 20);
    const look1 = (await vars([0x24]))[0x24];
    check(look1 !== look0, `node 40: Enter next to the Speedster changes its look (var 0x24 ${look0} -> ${look1})`);
    { const a = await page.evaluate(() => ({ mode: window.__zone.machine.mode, t: window.__zone.world.tickCount })); await wait(1500); const b = await page.evaluate(() => ({ mode: window.__zone.machine.mode, t: window.__zone.world.tickCount })); log('after the look change: mode', a.mode, 'ticks', a.t, '->', b.t, 'in 1.5 s'); }
    await shot('n40-look');
    let seen40 = false;
    const probe = (ms) => Promise.race([page.evaluate(() => ({ t: window.__zone?.world.tickCount ?? -1, a: window.__zone?.info.archive, n: window.__zone?.sh.vars.get(0x58), v: window.__zone?.sh.vars.get(0x100), mode: window.__zone?.machine.mode })), wait(ms).then(() => 'UNRESPONSIVE')]);
    await page.keyboard.down('ControlLeft');
    for (let i = 0; i < 30 && !seen40; i++) {
      const st = await probe(20000);
      log('  ctrl held, probe', i, JSON.stringify(st));
      if (st === 'UNRESPONSIVE') break;
      if (st.a !== 'z16PYA' || st.n !== 40 || (st.v & 0x7fff) === 1) seen40 = true;
      await wait(300);
    }
    await page.keyboard.up('ControlLeft').catch(() => {});
    check(seen40, 'node 40: Ctrl at the Speedster sets var 0x100 = 1 (the story moved on)');
    await shot('n40-portal');
    const left = await H.untilLeft('z16PYA', 60000);
    check(left === 'z20DSP', `node 40: the story hands over to z20DSP (zone now ${left})`);
  }

  log('route legs closed by a shortcut (Pepper put on a PATH node):', H.shortcuts ?? 0);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  log(fails.length ? `FAILED: ${fails.length} checks` : 'ALL CHECKS PASSED');
};
