// M5 z13CAI, the Adventure Island: node / set-up tests (no browser). The oracle comparisons against the original's code are m5-z13CAI-emu.mjs (nodes) and m5-z13CAI-hud-emu.mjs (HUD).
//   * registration: the zone's own constructors (0x4b4000, 0x61c2a4, 0x426f55) + every attach of the set-up for both story nodes (33, 51) and the three vehicles is ported
//     (only the environment records SEAB / SSEA / SSKY, drawn by src/render/environment.ts, stay "skipped");
//   * the set-up facts the module reads from the emulation: the ONE helipad (PATH node 0 / exit 0), PEPPER_CONTROL / vehicle per PORTAL_VEHICLE (0xbb) and PREV_SUBGAME (0xa3),
//     the arrival places, Pepper's chain = only the seat node, var 0xc5;
//   * the story texts / objective of the two nodes (hologram ADVHOLA / ADVHOL0, the arrow at PATH node 0 / the portal) from the set-up's calls;
//   * the flowing water, the look cycler (Enter) with the brick effect of PHEL, the exits (landing -> var 5 = Oasis; the portal -> the island);
//   * the HUD overlay set exists in the data (Overlays/z14OSD text000..005).
import { loadCai, tick, press, hold } from '../lib/m5-z13CAI-load.mjs';
import { loadHub } from '../lib/hub-load.mjs';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';
import { registeredCtors } from '../../src/game/setup.ts';
import { HubContext } from '../../src/hub/ctx.ts';
import { replaySetupState } from '../../src/hub/setupstate.ts';
import { vehicles, berthPos } from '../../src/island/vehicles/common.ts';
import { looksOf } from '../../src/island/vehicles/looks.ts';
import { tickIslandBrickFx } from '../../src/fx/bricks/island.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';
import { GullNode } from '../../src/zones/z13CAI/bunny.ts';
import { FlowNode } from '../../src/zones/z13CAI/flow.ts';
import { CaiPepSwitch, LOOK_RECORD } from '../../src/zones/z13CAI/pepswitc.ts';
import '../../src/zones/index.ts';
import { guarded } from '../lib/inject-guard.mjs';

const kindsOf = (world) => { const k = {}; for (const r of world.records) for (const n of r.ctrl?.nodes ?? []) k[n.kind] = (k[n.kind] ?? 0) + 1; return k; };

const __test = {
  name: 'm5-z13CAI',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');

    // ---- registration + the three vehicles x two story nodes
    const regs = new Set(registeredCtors());
    for (const c of [0x4b4000, 0x61c2a4, 0x426f55, 0x4325e8, 0x4333c2, 0x4bb1a6, 0x4bb582, 0x51ea3c, 0x88df51]) ok(regs.has(c), `constructor 0x${c.toString(16)} registered`);
    for (const node of [33, 51]) for (const bb of [0, 1, 2]) {
      const H = loadCai(ctx, { node, vars: { 0xbb: bb } });
      const w = H.world, G = vehicles(w);
      const tag = `node ${node} vehicle ${bb}`;
      const skipped = H.L.skipped.map((s) => s.ctorName);
      ok(H.L.skipped.length === 0, `${tag}: no constructor is skipped (SEAB / SSEA / SSKY are the scene nodes of src/island/ambient/seabed.ts) (${JSON.stringify(skipped)})`);
      const k = kindsOf(w);
      ok(k.Gull === (bb === 2 ? 15 : 16) && k.pepswitc === 1 && k['seabed.c'] === 2 && k.Seabed === 1 && k.Sea === 1 && k.Sky === 1 && k.hOLO === 1 && k['StartCSM.portal'] === 1, `${tag}: nodes ${JSON.stringify(k)}`);
      ok(bb === 2 ? k.Ptera === 2 && !k.SGHeli : k.SGHeli === 1 && !k.Ptera, `${tag}: the vehicle's node`);
      // Pepper's chain: only the seat (SGVehic / the Ptera ride)
      const pk = H.pepper.ctrl.nodes.map((n) => n.kind);
      ok(pk.length === 1 && pk[0] === (bb === 2 ? 'Ptera' : 'SGVehic'), `${tag}: Pepper's chain ${pk}`);
      const veh = ['PHEL', 'RHEL', 'PTER'][bb];
      ok(G.current?.name === veh && w.vars.get(0x5e) === (bb === 2 ? 0x40 : 8), `${tag}: Pepper in ${G.current?.name}, control ${w.vars.get(0x5e)}`);
      ok(w.vars.get(0x3e) === 1, `${tag}: MOVE_PHEL = 1`);
      ok(w.vars.get(0xc5) === (bb === 2 ? 5 : 1), `${tag}: var 0xc5 (Pepper's shadow) = ${w.vars.get(0xc5)}`);
      // the vehicle node chain: pepswitc first (pos 0), the vehicle's node second
      const vn = G.current.ctrl.nodes.map((n) => n.kind);
      ok(vn[0] === 'pepswitc' && vn.length === 2, `${tag}: the vehicle's nodes ${vn}`);
      // the helipad table of the set-up: ONE pad, PATH node 0, exit node 0
      ok(G.pads.length === 1 && G.pads[0].node === 0 && G.pads[0].exit === 0 && G.pads[0].map === 1 && G.docks.length === 0, `${tag}: pads ${JSON.stringify(G.pads)}`);
      ok(H.pepper.x === G.current.x && H.pepper.z === G.current.z, `${tag}: Pepper at the vehicle`);
      // the birds: the heli branch puts the PTER record among them (16 attaches), the Ptera branch flies it (15)
      ok(w.records.filter((r) => /^GL\d\d$/.test(r.name)).every((r) => r.ctrl.nodes[0] instanceof GullNode), `${tag}: GL00..GL14 are gull nodes`);
      // the vehicle roster: PHEL has the variant word 2, every other record 0
      ok(w.records.every((r, i) => r.variant === (i === LOOK_RECORD ? 2 : 0)), `${tag}: variant words`);
    }

    // ---- the arrival places (docs/re/m5/foundation.md section 3: from the island / the Oasis / the Dino island)
    for (const [prev, pos] of [[0, [-654.3, 97.9, 644.1]], [2, [-654.3, 97.9, 644.1]], [11, [803.8, 44.6, -788.7]], [19, [-699.5, 93.9, 160.5]]]) {
      const H = loadCai(ctx, { node: 33, vars: { 0xa3: prev } });
      const p = H.pepper;
      ok(Math.abs(p.x - pos[0]) < 0.1 && Math.abs(p.y - pos[1]) < 0.1 && Math.abs(p.z - pos[2]) < 0.1, `arrival from zone ${prev}: ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
      tick(H, 5);
      ok([p.x, p.y, p.z].every(Number.isFinite), `arrival from zone ${prev}: 5 ticks`);
    }

    // ---- texts and objective of the two story nodes (the set-up's own calls, replayed on the hub context)
    for (const [node, hol, objMode, objWhat] of [[33, 'advholA.str', 3, 0], [51, 'advhol0.str', 1, 53]]) {
      const H = loadHub(ctx, { zone: 'z13CAI', node });
      const real = new HubContext(H.world, pe, H.archive, H.emu, 'z13CAI', H.scene);
      real.messages = messages;
      const r = replaySetupState(real);
      ok(r.texts >= 1 && r.objective === 1, `node ${node}: ${r.texts} text calls, ${r.objective} objective calls`);
      ok((real.textPaths.hol ?? '').toLowerCase().endsWith(`ai/data/${hol.toLowerCase()}`) && !!real.text.hol, `node ${node}: hologram table ${real.textPaths.hol}`);
      ok(real.goal.mode === objMode && (objMode === 3 ? real.goal.node === objWhat : real.goal.recs[0] === objWhat), `node ${node}: objective mode ${real.goal.mode} ${real.goal.node} ${real.goal.recs}`);
      const line = real.text.hol?.text?.('HOLOA') ?? real.text.hol?.text?.('HOLO');
      notes.push(`node ${node}: hologram line "${line}"`);
    }

    // ---- the flowing water: LAVA {0.0025, 0}, FALL {0.01, 0} (the renderer draws them)
    {
      const H = loadCai(ctx, { node: 33 });
      const lava = H.world.records[5].ctrl.nodes[0], fall = H.world.records[6].ctrl.nodes[0];
      ok(lava instanceof FlowNode && fall instanceof FlowNode, 'LAVA / FALL are flow nodes');
      ok(Math.abs(lava.dv - 0.0025) < 1e-6 && lava.du === 0 && Math.abs(fall.dv - 0.01) < 1e-6 && fall.du === 0, `flow arguments ${lava.dv} ${lava.du} / ${fall.dv} ${fall.du}`);
      ok(lava.var === 2 && lava.mask === 1 && lava.value === 1 && H.world.records[5].ctrl.nodes.length === 1, 'flow gate (var 2 & 1 == 1), position 0');
    }

    // ---- pepswitc: the sounds every tick, the cries, "stepped off -> var 5 = 11"
    {
      const H = loadCai(ctx, { node: 33 });
      const w = H.world, ic = H.ictx;
      // scripted random: 0.5 (no cry), 0.985 (n = 98: 0x302), 0.9999 (n = 99: 0x303)
      const seq = [0.5, 0.985, 0.9999];
      let i = 0;
      setAmbientRandom(() => seq[i++ % 3]);
      ic.sounds.length = 0;
      const sw = w.records[50].ctrl.nodes[0];
      ok(sw instanceof CaiPepSwitch, 'pepswitc on PHEL');
      for (let t = 0; t < 3; t++) sw.update(w, w.records[50], null);
      const log = ic.sounds.map((s) => `${s.id}${s.pos ? '@' + s.pos.map((v) => v.toFixed(1)) : ''}`).join(' ');
      ok(ic.sounds.filter((s) => s.id === 0x2f3).length === 3 && ic.sounds.filter((s) => s.id === 0x2f5).length === 3, `volcano / loop sounds every tick: ${log}`);
      const pter = w.records[24];
      const cries = ic.sounds.filter((s) => s.id === 0x302 || s.id === 0x303);
      ok(cries.length === 2 && cries[0].id === 0x302 && cries[1].id === 0x303 && Math.abs(cries[0].pos[0] - pter.x) < 1e-3, `gull cries 0x302 / 0x303 at the PTER record: ${JSON.stringify(cries)}`);
      ok(ic.sounds.find((s) => s.id === 0x2f3).pos.map((v) => v.toFixed(1)).join() === '-248.5,130.4,-223.3', 'volcano position (-248.5, 130.4, -223.3)');
      ok(w.vars.get(5) === 10, 'var 5 untouched while flying');
      w.vars.set(0x5e, 1);
      sw.update(w, w.records[50], null);
      ok(w.vars.get(5) === 0xb, `PEPPER_CONTROL & 1 -> var 5 = ${w.vars.get(5)}`);
      setAmbientRandom(null);
    }

    // ---- the exit through landing: fly to the pad, Ctrl, Pepper steps off, var 5 = 11 and the story FSM's node-33 condition ("var 5 == 11") holds
    {
      const H = loadCai(ctx, { node: 33 });
      const w = H.world, G = H.G, heli = G.current;
      const pad = berthPos(G.pads[0]);
      heli.setEuler(0, Math.atan2(pad[0] - heli.x, pad[2] - heli.z), 0, pad[0] - 100, pad[1] + 45, pad[2]); heli.ry = Math.atan2(100, 0);
      heli.rx = 0; heli.rz = 0;
      tick(H, 40);
      const hn = heli.ctrl.nodes[1];
      let landed = false;
      for (let t = 0; t < 700 && !landed; t++) {
        const dx = pad[0] - heli.x, dz = pad[2] - heli.z, dist = Math.hypot(dx, dz);
        let ang = Math.atan2(dx, dz) - heli.ry; while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
        const keys = [];
        if (ang > 0.1) keys.push('ArrowRight'); else if (ang < -0.1) keys.push('ArrowLeft');
        if (Math.abs(ang) < 0.6 && dist > 60) keys.push('Space');
        if (dist <= 60 && Math.abs(ang) < 0.6) keys.push('ControlLeft');
        hold(H, keys, 1);
        if (w.vars.get(0x5e) === 1) landed = true;
      }
      tick(H, 3);
      ok(landed && hn.state === 0, `landed on the pad (state ${hn.state})`);
      ok(w.vars.get(5) === 11 && w.vars.get(0x58) === 33, `var 5 = ${w.vars.get(5)}`);
      ok(Math.hypot(H.pepper.x - berthPos(G.pads[0], true)[0], H.pepper.z - berthPos(G.pads[0], true)[2]) < 1e-3, 'Pepper stands at the pad\'s exit node');
      ok(G.current === null, 'the vehicle is released');
    }

    // ---- the exit through the portal at node 51: fly into PORS -> var 250 |= 1 (the story node's condition) and var 5 = the island's era zone (33)
    {
      const H = loadCai(ctx, { node: 51, vars: { 0xa3: 19 } });
      const w = H.world, pors = w.records[53], heli = H.G.current;
      ok(w.vars.get(0xfa) === 0, 'S250 = 0 on arrival');
      let fired = -1;
      for (let t = 0; t < 900 && fired < 0; t++) {
        const dx = pors.x - heli.x, dz = pors.z - heli.z;
        let ang = Math.atan2(dx, dz) - heli.ry; while (ang > Math.PI) ang -= 2 * Math.PI; while (ang < -Math.PI) ang += 2 * Math.PI;
        const keys = [];
        if (ang > 0.08) keys.push('ArrowRight'); else if (ang < -0.08) keys.push('ArrowLeft');
        if (Math.abs(ang) < 0.5) keys.push('Space');
        hold(H, keys, 1);
        if ((w.vars.get(0xfa) & 1) === 1) fired = t;
      }
      ok(fired >= 0 && w.vars.get(5) === 33, `portal after ${fired} ticks: S250 ${w.vars.get(0xfa)}, var 5 = ${w.vars.get(5)}`);
      notes.push(`flew into the portal from the Dino island arrival in ${fired} ticks`);
    }

    // ---- the look cycler (Enter): PHEL's roster over the hub's table 0x914bc8 + the brick effect (var 0xd2) of FUN_006277b9
    {
      const H = loadCai(ctx, { node: 33, bricks: true });
      const w = H.world, ic = H.ictx;
      tick(H, 3);
      const looks = looksOf(w);
      ok(!!looks && looks.entries.length === 1 && looks.entries[0].rec === LOOK_RECORD && looks.entries[0].varIdx === 0xd2, `roster ${looks?.entries.map((e) => `${e.rec}:${e.varIdx}:${e.looks.length}`)}`);
      ok(looks.entries[0].slot !== -0x45454546, `PHEL's brick effect slot ${looks.entries[0].slot}`);
      const before = w.vars.get(0xd2);
      ic.sounds.length = 0;
      press(H, 'Enter');
      const word = w.vars.get(0xd2);
      ok(word !== before && (word & 0xff) === 1 || ((word >> 8) === 1), `Enter: var 0xd2 ${before} -> ${word}`);
      ok(ic.sounds.some((s) => s.id === 0x2c0), 'Enter plays the look sound 0x2c0');
      const phel = w.records[LOOK_RECORD];
      ok((phel.flags & 0x8020) === 0x8020 && looks.busy.some((b) => b === 0), `PHEL busy (flags 0x${phel.flags.toString(16)}, busy ${looks.busy})`);
      for (let t = 0; t < 900 && (phel.flags & 0x8000) !== 0; t++) { tickIslandBrickFx(w); tick(H, 1); }
      ok((phel.flags & 0x8020) === 0 && looks.busy.every((b) => b === -1), `after the morph PHEL is free again (flags 0x${phel.flags.toString(16)})`);
      // a second Enter while busy does nothing more than the sound
      press(H, 'Enter');
      const w2 = w.vars.get(0xd2);
      press(H, 'Enter');
      ok(w.vars.get(0xd2) === w2 || (phel.flags & 0x8000) !== 0, 'Enter while the morph runs changes nothing');
      notes.push(`look cycler: 0xd2 ${before} -> ${word} -> ${w2}`);
    }

    // ---- the HUD overlay set of the Oasis exists
    {
      const ov = ctx.archives.find((a) => a.name.toLowerCase() === 'overlays');
      ok(!!ov, 'Overlays archive');
      for (let i = 0; i < 6; i++) ok(!!ov?.find(`Z14OSD/Text${String(i).padStart(3, '0')}.tga`) || !!ov?.find(`z14OSD/text${String(i).padStart(3, '0')}.tga`), `Overlays/z14OSD/text00${i}.tga`);
    }
    void sceneOf;
    return { checked, failures, notes };
  },
};
export default guarded(__test);
