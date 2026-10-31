import { loadPya, tick, hold, press } from '../lib/m5-z16PYA-load.mjs';
import { HubContext } from '../../src/hub/ctx.ts';
import { replaySetupState } from '../../src/hub/setupstate.ts';
import { hubSlotSpecs } from '../../src/hub/game.ts';
import { PyaHud, fmt04d } from '../../src/zones/z16PYA/hud.ts';
import { PyaPepSwitch } from '../../src/zones/z16PYA/peppsw.ts';
import { hiddenList, ROSTER_VA } from '../../src/zones/z16PYA/roster.ts';
import { looksOf, VARIANT_VEHICLE } from '../../src/island/vehicles/looks.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { tickIslandBrickFx } from '../../src/fx/bricks/island.ts';
import { Hud } from '../../src/shell/hud.ts';
import { setIslandRandom } from '../../src/island/rng.ts';
import { loadExe } from '../lib/engine-load.mjs';
import { guarded } from '../lib/inject-guard.mjs';

// M5 z16PYA, node tests (no browser): the Pyramid's set-up through the emulation (attaches by node, chain, hidden templates, variants, arrival, texts, objective, cutscene slots), Pepper's
// mode switch PeppSw in the real node chain (board on / off, the groove level, the temple sound), the HUD, the roster's Speedster look, the shared Oasis nodes in this hub's world
// (gems, scorpions, tumbleweeds), the three story triggers (sphinx entrance, temple door, Speedster portal) and the story FSM's hand-over to z17WAS / z18MMP / z20DSP.
// The oracle tests against the original's code are m5-z16PYA-emu.

const NODES = { 36: { zone: 13, next: 14, flag: 0xfe, objective: 24, hol: 'AI/Data/advHOL2.str', npc: 'AI/Data/advfsm2.str', path: 0x19 },
  38: { zone: 13, next: 15, flag: 0xff, objective: 23, hol: 'AI/Data/ADVHOL6.str', npc: null, path: 0x1a },
  40: { zone: 13, next: 16, flag: 0x100, objective: 112, hol: 'AI/Data/ADVHOL7.str', npc: null, path: 0x18 } };
/** the attach counts per constructor name in the world after the set-up (regression values; foundation-ctors.md) */
const KINDS = {
  36: { Sky: 1, PeppSw: 1, scorpion: 11, SGwalk: 1, sgswim: 1, skate: 1, SGMFIG: 4, Turn2PepA: 3, Human1: 3, Turn2PepB: 3, StartCSM: 2, Tumblewd: 2, Gems: 5, hOLO: 1 },
  38: { Sky: 1, PeppSw: 1, scorpion: 11, SGwalk: 1, sgswim: 1, skate: 1, SGMFIG: 4, StartCSM: 2, Tumblewd: 2, Gems: 5, hOLO: 1 },
  40: { Sky: 1, PeppSw: 1, scorpion: 11, SGwalk: 1, sgswim: 1, skate: 1, Tumblewd: 2, Gems: 5, 'StartCSM.portal': 1, hOLO: 1, SGMFIG: 1 },
};

const __test = {
  name: 'm5-z16PYA-node',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const eq = (a, b, msg) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
    const pe = loadExe(ctx.dataRoot);
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;

    const kindsOf = (H) => { const o = {}; for (const r of H.world.records) for (const n of r.ctrl?.nodes ?? []) o[n.kind] = (o[n.kind] ?? 0) + 1; return o; };
    /** Pepper onto the ground at (x, z) facing (fx, fz) */
    const place = (H, x, z, fx = x, fz = z + 1, y = null) => {
      const p = H.pepper, w = H.world;
      p.x = x; p.z = z; p.y = y ?? ((g) => (g > -1e30 ? g : 0))(w.col.groundRay(x, 300, z));
      p.ry = Math.atan2(fx - x, fz - z); p.rebuildYaw(); p.savePrev(); w.camera.init(p);
    };
    const nearRec = (H, name, dist = 3, ang = 0) => { const r = H.rec(name); place(H, r.x + Math.sin(ang) * dist, r.z + Math.cos(ang) * dist, r.x, r.z); return r; };

    // ================================================================================================ the set-up of each story node
    for (const [n, want] of Object.entries(NODES)) {
      const node = +n;
      const H = loadPya(ctx, node, { bricks: true });
      const W = H.world, P = H.pepper;
      // ---- constructors: every attach of the emulated set-up has a node (the sky dome SSKY is the scene node of src/island/ambient/seabed.ts: kind 'Sky')
      eq(H.L.skipped.map((s) => s.ctorName), [], `node ${node}: skipped constructors`);
      eq(kindsOf(H), KINDS[node], `node ${node}: node kinds`);
      eq(P.ctrl.nodes.map((x) => x.kind), ['PeppSw', 'scorpion', 'SGwalk', 'sgswim', 'skate'], `node ${node}: Pepper's chain = the original's (PeppSw, grab, SGwalk, sgswim, skate)`);
      eq(P.ctrl.nodes.map((x) => [x.var, x.mask, x.value]), [[0x5e, 0, 0], [0x5e, 0x20, 0x20], [0x5e, 1, 1], [0x5e, 2, 2], [0x5e, 4, 4]], `node ${node}: the gates of Pepper's chain`);
      // ---- the zone's constants: sea -400, gravity -10, hub, the board record 17 (DAT_009daa7c), music / sounds
      eq([W.seaLevel, W.gravity, W.hub, vehicles(W).board], [-400, -10, true, 17], `node ${node}: sea level, gravity, hub flag, board record`);
      eq(W.records[17].name, 'SKBD', `node ${node}: record 17 is the skateboard`);
      ok(H.L.walk.accessory === W.records[17], `node ${node}: the walk node's accessory is the board`);
      // ---- arrival: the PATH node the builder uses (FUN_00462be9(1, n)), facing 1.5708
      const pn = H.ictx.pathPos(want.path);
      ok(pn && near(P.x, pn[0]) && near(P.z, pn[2]), `node ${node}: Pepper arrives at PATH node 0x${want.path.toString(16)} (${P.x.toFixed(1)}, ${P.z.toFixed(1)} vs ${pn})`);
      const emuP = H.emu.records[P.index];
      ok(near(emuP.euler[1], 1.5707879, 1e-5), `node ${node}: the emulated yaw is 1.5708 (${emuP.euler[1]})`);
      // ---- the framework's record writes: 15 hidden templates, the decor variants, SPED = 2
      for (const i of hiddenList(pe)) ok((W.records[i].flags & 2) === 0, `node ${node}: template record ${i} (${W.records[i].name}) is hidden`);
      eq(hiddenList(pe).length, 15, `node ${node}: the hidden list has 15 records`);
      eq(W.records[112].variant, VARIANT_VEHICLE, `node ${node}: SPED has the vehicle variant word`);
      eq(W.records.filter((r) => (r.variant & 0xff) === 1).length, 48, `node ${node}: the decor group 3's 48 records have the type 1 variant word`);
      eq(W.records.filter((r) => r.variant === 0).length, W.records.length - 49, `node ${node}: every other record has variant word 0`);
      // ---- texts and objective of the builder (replayed from the emulation like the hub game does)
      const real = new HubContext(W, pe, H.archive, H.emu, 'z16PYA', H.scene);
      real.messages = messages;
      replaySetupState(real);
      eq([real.textPaths.hol, real.textPaths.npc], [want.hol.replace(/^AI\/Data\//, 'AI/Data/'), want.npc], `node ${node}: hologram / npc text files`);
      eq([real.goal.mode, real.goal.recs[0]], [1, want.objective], `node ${node}: the objective arrow points at record ${want.objective}`);
      ok(!!real.text.hol, `node ${node}: the hologram table loads`);
      // ---- cutscene slots ADV02 / ADV03 exist in the data
      const specs = hubSlotSpecs(H.emu, 'z16PYA');
      eq(specs.map((s) => [s.slot, s.script, s.zone]), [[0, 'ADV02', 'z16PYA'], [1, 'ADV03', 'z16PYA']], `node ${node}: cutscene slots`);
      for (const sp of specs) ok(!!H.archive.find(`cutscene/${sp.script}.cut`), `node ${node}: ${sp.script}.cut exists`);
      // ---- HUD hints: 4 identical animation-set rows (the SGMFIG defaults)
      eq(H.emu.hudHints.map((h) => [h.index, h.a, h.b, h.c, h.d]), [0, 1, 2, 3].map((i) => [i, 113, 121, 130, 129]), `node ${node}: HUD hints`);
    }

    // ================================================================================================ the first visits' cutscenes
    {
      const H1 = loadPya(ctx, 36), H2 = loadPya(ctx, 38), H3 = loadPya(ctx, 40);
      tick(H1, 3); tick(H2, 3); tick(H3, 3);
      eq(H1.ictx.cutscenes.map((c) => c.slot), [0], 'node 36: ADV02 (slot 0) starts at the arrival');
      eq(H2.ictx.cutscenes.map((c) => c.slot), [1], 'node 38: ADV03 (slot 1) starts at the arrival');
      eq(H3.ictx.cutscenes.map((c) => c.slot), [], 'node 40: no cutscene at the arrival');
      eq([H1.vars.get(0xba) & 2, H2.vars.get(0xba) & 4], [2, 4], 'the visit flags 0xba bit 2 / bit 4 are set once the cutscene was started');
      // a second visit (the flag stays): no cutscene
      const H1b = loadPya(ctx, 36, { vars: { 0xba: 2 } });
      tick(H1b, 3);
      eq(H1b.ictx.cutscenes.length, 0, 'node 36 with the flag set: no arrival cutscene');
    }

    // ================================================================================================ PeppSw in the node chain
    {
      const H = loadPya(ctx, 36);
      const W = H.world, P = H.pepper;
      // (the cutscene of the arrival is over for the mock)
      H.ictx.cutsceneLeft = 0;
      tick(H, 40);
      ok((W.vars.get(0x5e) & 0xfff) === 1, 'walking after the arrival (PEPPER_CONTROL 1)');
      eq(H.ictx.grooves.length, 0, 'no groove change while walking (level 1, set at the zone start by the music code)');
      // Ctrl: on the skateboard (the getting-on clip 0x16 runs 60 ticks, then the board rolls)
      const x0 = P.x, z0 = P.z;
      H.ictx.sounds.length = 0;
      press(H, 'ControlLeft', 1);
      ok((W.vars.get(0x5e) & 0xfff) === 4, `Ctrl: on the board (PEPPER_CONTROL 0x${W.vars.get(0x5e).toString(16)})`);
      ok(H.ictx.sounds.some((s) => s.id === 0x150), 'board on sound (0x150) is played by the node');
      tick(H, 70);
      hold(H, ['ArrowUp'], 60);
      ok(Math.hypot(P.x - x0, P.z - z0) > 5, `the board carries Pepper (${Math.hypot(P.x - x0, P.z - z0).toFixed(1)} units)`);
      ok(H.ictx.grooves.some((g) => g.lvl === 0), `groove level 0 on the board (${JSON.stringify(H.ictx.grooves)})`);
      // Ctrl again: off the board (a press in the tick of a state change is lost: mailbox 0x20 / 0x32, like in the original: try again)
      for (let k = 0; k < 6 && (W.vars.get(0x5e) & 0xfff) === 4; k++) { press(H, 'ControlLeft', 1); tick(H, 3); }
      tick(H, 40);
      ok((W.vars.get(0x5e) & 0xfff) === 1, `Ctrl: off the board (0x${W.vars.get(0x5e).toString(16)})`);
      ok(H.ictx.grooves.some((g, i) => i > 0 && g.lvl === -2), `groove back to level -2 (${JSON.stringify(H.ictx.grooves)})`);
      ok(H.ictx.stopped.length >= 7, 'the rolling sounds are stopped when stepping off');
    }

    // ================================================================================================ the temple sound and the random sounds in a running world
    {
      const H = loadPya(ctx, 40);
      setIslandRandom(() => 0.5);
      H.ictx.sounds.length = 0;
      tick(H, 10);
      const temple = H.ictx.sounds.filter((s) => s.id === 0x307);
      eq(temple.length, 10, 'the temple sound (0x307) is refreshed every tick');
      const t = H.world.records[23];
      ok(temple.every((s) => near(s.pos[0], t.x) && near(s.pos[1], t.y) && near(s.pos[2], t.z)), 'at the position of TEMP (record 23)');
      setIslandRandom(null);
    }

    // ================================================================================================ the HUD
    {
      const H = loadPya(ctx, 36);
      const hud = new Hud(null), ph = new PyaHud();
      ph.init(hud);
      H.world.vars.set(0xde, 0b101); H.world.vars.set(0x17, 3000);
      ph.update(hud, H.world.vars, 1);
      eq([hud.leftText, hud.centreText, hud.left.tex], ['x2', '3000', 0], 'HUD: two gems, score 3000, the gem icon');
      eq(fmt04d(7), '0007', 'fmt04d');
      H.world.vars.set(0xc, 0x1e); H.world.vars.set(0x5e, 1);
      ph.update(hud, H.world.vars, 1);
      eq(hud.column[0].tex, 1, 'HUD: the talk icon (var 0xc & 0x1e)');
      eq(H.world.vars.get(0xc), 0, 'HUD: var 0xc is reset');
      H.world.vars.set(0xc, 0x20); ph.update(hud, H.world.vars, 1);
      eq(hud.column[0].tex, 3, 'HUD: icon 3 for 0x20');
    }

    // ================================================================================================ the Speedster's look (roster): Enter next to SPED
    {
      const H = loadPya(ctx, 40, { bricks: true });
      const W = H.world;
      tick(H, 2);
      const looks = looksOf(W);
      ok(!!looks && looks.entries.length === 1 && looks.entries[0].rec === 112 && looks.entries[0].varIdx === 0x24 && looks.entries[0].set === 0x37, `the roster has one entry: SPED, var 0x24, SwapText set 0x37 (${JSON.stringify(looks?.entries.map((e) => [e.rec, e.varIdx, e.set]))})`);
      ok(looks.entries[0].looks.length >= 2, `the Speedster has ${looks.entries[0].looks.length} looks`);
      const sped = nearRec(H, 'SPED', 6, 1.0);
      W.vars.set(0x5e, 1);
      const before = W.vars.get(0x24);
      H.ictx.sounds.length = 0;
      for (let k = 0; k < 4; k++) press(H, 'Enter', 1);
      ok(W.vars.get(0x24) !== before, `Enter near SPED changes the look (var 0x24 ${before} -> ${W.vars.get(0x24)})`);
      ok(H.ictx.sounds.some((s) => s.id === 0x2c0), 'the look sound 0x2c0');
    }

    // ================================================================================================ the shared Oasis nodes in this world
    {
      const H = loadPya(ctx, 36);
      const W = H.world;
      H.ictx.cutsceneLeft = 0;
      // gems: GEM1 (record 78) gets picked up: bit 2 of var 0xde, +1000 to 0x17 / 0xca
      const g = nearRec(H, 'GEM1', 0.5, 0.3);
      W.vars.set(0x5e, 1);
      const s0 = W.vars.get(0x17), t0 = W.vars.get(0xca);
      tick(H, 8);
      eq(W.vars.get(0xde) & 0x3ff, 2, 'GEM1: bit 2 of var 0xde');
      eq([W.vars.get(0x17) - s0, W.vars.get(0xca) - t0], [1000, 1000], 'GEM1: +1000 score');
      ok((g.flags & 2) === 0, 'GEM1: the gem is gone');
      ok(H.ictx.sounds.some((s) => s.id === 0x2f1), 'GEM1: the pick-up sound');
      // a gem collected earlier stays away (a second visit): bit set before the set-up
      const H2 = loadPya(ctx, 38, { vars: { 0xde: 5 } });
      ok(H2.rec('GEM0') && (H2.rec('GEM0').flags & 2) === 0 && (H2.rec('GEM2').flags & 2) === 0 && (H2.rec('GEM1').flags & 2) !== 0, 'collected gems (bits 1 and 4) are hidden at the next visit');
    }
    {
      // scorpions: SCR0 grabs Pepper (var 0x5e |= 0x20), the grab node plays clip 0x70 and releases her
      const H = loadPya(ctx, 38);
      const W = H.world, P = H.pepper;
      H.ictx.cutsceneLeft = 0;
      const scr = H.rec('SCR6');
      place(H, scr.x + 2.5, scr.z + 0.0, scr.x, scr.z);
      W.vars.set(0x5e, 1);
      let grabbed = false, released = false;
      for (let i = 0; i < 400 && !released; i++) {
        tick(H, 1);
        if ((W.vars.get(0x5e) & 0x20) !== 0) grabbed = true;
        else if (grabbed) released = true;
        if (!grabbed && i % 20 === 19) place(H, scr.x + 2.5, scr.z, scr.x, scr.z);
      }
      ok(grabbed && released, `a scorpion grabbed Pepper and let go (grabbed ${grabbed}, released ${released})`);
    }

    // ================================================================================================ the three triggers and the story FSM
    {
      // node 36: the sphinx entrance = PATH node 0x17 (radius 1.0 * 8, no button, icon 0x20 = INTERACT bit): walking in sets var 0xfe := 1, the story leaves for z17WAS
      const H = loadPya(ctx, 36);
      const W = H.world;
      H.ictx.cutsceneLeft = 0;
      tick(H, 5);
      const e = H.ictx.pathPos(0x17);
      place(H, e[0] - 30, e[2] - 30, e[0], e[2]);
      W.vars.set(0x5e, 1);
      tick(H, 5);
      eq(W.vars.get(0xfe), 0, 'node 36: 42 units from the entrance nothing happens');
      place(H, e[0] - 5, e[2] - 5, e[0], e[2]);
      W.vars.set(0x5e, 1);
      tick(H, 1);
      ok((W.vars.get(0xc) & 0x20) !== 0 || W.vars.get(0xfe) === 1, 'node 36: the interaction icon bit 0x20 near the entrance');
      tick(H, 4);
      eq(W.vars.get(0xfe) & 0x7fff, 1, 'node 36: walking into the sphinx entrance sets var 0xfe = 1');
      eq(H.story.frame(), 6, 'node 36: the story FSM leaves the hub');
      eq([H.story.node, H.story.zoneOf()], [37, 14], 'node 36 -> node 37, zone z17WAS');
    }
    {
      // node 38: the temple door = PATH node 0x18
      const H = loadPya(ctx, 38);
      const W = H.world;
      H.ictx.cutsceneLeft = 0;
      tick(H, 5);
      const e = H.ictx.pathPos(0x18);
      place(H, e[0] - 30, e[2] - 30, e[0], e[2]);
      W.vars.set(0x5e, 1);
      tick(H, 5);
      eq(W.vars.get(0xff), 0, 'node 38: 42 units from the temple door nothing happens');
      place(H, e[0] - 5, e[2] - 5, e[0], e[2]);
      W.vars.set(0x5e, 1);
      tick(H, 5);
      eq(W.vars.get(0xff) & 0x7fff, 1, 'node 38: walking to the temple door sets var 0xff = 1');
      eq(H.story.frame(), 6, 'node 38: the story FSM leaves the hub');
      eq([H.story.node, H.story.zoneOf()], [39, 15], 'node 38 -> node 39, zone z18MMP');
    }
    {
      // node 40: the Speedster portal (box portal, Ctrl): var 0x100 := 1
      const H = loadPya(ctx, 40);
      const W = H.world;
      H.ictx.cutsceneLeft = 0;
      tick(H, 40);
      const sp = H.rec('SPED');
      place(H, sp.x + 2, sp.z + 2, sp.x, sp.z);
      W.vars.set(0x5e, 1);
      tick(H, 3);
      press(H, 'ControlLeft', 1);
      tick(H, 6);
      const done = (W.vars.get(0x100) & 0x7fff) === 1 || W.vars.get(5) === 16;
      ok(done, `node 40: Ctrl at the Speedster (var 0x100 ${W.vars.get(0x100)}, next zone ${W.vars.get(5)})`);
      eq([H.story.zoneOf(41), H.story.zoneOf(40)], [16, 13], 'story: node 40 is the Pyramid, node 41 z20DSP');
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
void ROSTER_VA; void PyaPepSwitch;
