// M5 z40OGL (Ogel's island, story nodes 64 and 66): node tests of the hub's own code and of the emulated set-up the port runs on
// (docs/re/m5/z40OGL.md). The oracle tests against the original's code are tools/tests/m5-z40OGL-emu.mjs.
//   (a) registration: the zone game, the Overlay constructor 0x7e31fc; (b) the emulated set-up per node: attaches, the nine Overlay attaches, cutscene slots, HUD hints, render mode,
//   fog call, sound handles, arrival, texts, objective; (c) the krystals (pick-up, range, collected earlier, sounds per handle, emitter calls); (d) the HUD (strings, icon, blink);
//   (e) the wrapper's outfit restore; (f) the story: arrival cutscenes, the two waypoint triggers that complete nodes 64 / 66 and hand over to the next zone.
import { registeredZoneGames, zoneSetupFor } from '../../src/shell/zonegame.ts';
import { ctorFactory } from '../../src/game/setup.ts';
import { HubContext } from '../../src/hub/ctx.ts';
import { replaySetupState } from '../../src/hub/setupstate.ts';
import { liveHubStoryEnv } from '../../src/hub/story.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { Hud } from '../../src/shell/hud.ts';
import { GameVars } from '../../src/game/vars.ts';
import { FOG_PHASES, pickFogCall } from '../../src/game/fogphases.ts';
import { ZONE_SOUND_SETUP } from '../../src/audio/zonesounds.ts';
import { ZONE_MUSIC } from '../../src/audio/zonemusic.ts';
import '../../src/zones/index.ts';
import { hudInit, hudFrame, newHudState, OGL_HUD } from '../../src/zones/z40OGL/hud.ts';
import { krystalIndex, KRYSTAL_RANGE2, KRYSTAL_SCORE, TWINKLE_EMITTER, KrystalNode } from '../../src/zones/z40OGL/krystal.ts';
import { KST_HANDLES, SND_COLLECT } from '../../src/zones/z40OGL/common.ts';
import { restoreOutfits, OUTFIT_HUB } from '../../src/zones/z40OGL/index.ts';
import { loadOgl, CTOR_OVERLAY } from '../lib/m5-z40OGL-emu.mjs';
import { tick } from '../lib/hub-load.mjs';
import { loadExe } from '../lib/engine-load.mjs';

const f32 = Math.fround;
const MASKS = [1, 2, 4, 8, 0x10, 0x20, 0x40, 0x80, 0x100];
const KST_WITH_NODE = ['KST0', 'KST1', 'KST2', 'KST3', 'KST4', 'KST5', 'KST6', 'KST8', 'KST9'];

export default {
  name: 'm5-z40OGL',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);

    // ---- (a) registration
    ok(registeredZoneGames().includes('z40ogl'), 'z40OGL zone game registered');
    const hooks = zoneSetupFor('z40OGL');
    ok(!!hooks?.beforeSetup && !!hooks.afterSetup, 'z40OGL set-up hooks');
    ok(typeof ctorFactory(CTOR_OVERLAY) === 'function', 'Overlay constructor 0x7e31fc registered');
    ok(krystalIndex('KST7') === 7 && krystalIndex('KST0') === 0 && krystalIndex('KSTX') === -1 && krystalIndex('PZ00') === -1, 'krystalIndex: the first four characters name the krystal (strncmp "KST0" .. "KST9")');

    for (const node of [64, 66]) {
      const H = loadOgl(ctx, { node });
      const emu = H.emu, w = H.world, recs = w.records;
      const name = (i) => recs[i]?.name;
      // ---- (b) the emulated set-up
      ok(emu.unhooked.length === 0, `node ${node}: no unhooked engine call in the set-up (${JSON.stringify(emu.unhooked)})`);
      ok(emu.attaches.length === (node === 64 ? 64 : 59), `node ${node}: attach count ${emu.attaches.length}`);
      const ov = emu.attaches.filter((a) => a.ctor === CTOR_OVERLAY);
      ok(ov.length === 9 && ov.every((a, i) => a.var === 0x31 && a.mask === MASKS[i] && a.value === 0 && name(a.record) === KST_WITH_NODE[i]), `node ${node}: nine Overlay attaches on KST0..KST6, KST8, KST9, var 0x31 bits 1 .. 0x100 (${ov.map((a) => `${name(a.record)}:${a.mask}`)})`);
      ok(w.records.filter((r) => r.ctrl?.nodes.some((n) => n.kind === 'Overlay')).length === 9, `node ${node}: nine krystal nodes in the world`);
      ok(!H.L.skipped.some((s) => s.ctor === CTOR_OVERLAY), `node ${node}: no Overlay attach skipped`);
      ok(JSON.stringify(emu.cutscenes.map((c) => [c.slot, c.name, c.messages, c.area, c.zoneDir])) === JSON.stringify([[0, 'OGL01', 'OGL01', 'og', 'z40OGL'], [1, 'OGL03', 'OGL03', 'og', 'z40OGL'], [2, 'OGL04', 'OGL04', 'og', 'z40OGL']]), `node ${node}: cutscene slots ${JSON.stringify(emu.cutscenes.map((c) => [c.slot, c.name]))}`);
      ok(emu.hudHints.length === 4 && emu.hudHints.every((h, i) => h.index === i && h.a === 0x71 && h.b === 0x79 && h.c === 0x82 && h.d === 0x81 && h.scale === f32(0.032)), `node ${node}: four HUD hints (0x71, 0x79, 0x82, 0x81, 0.032)`);
      ok(emu.modes.length === 1 && emu.modes[0].record === 5 && name(5) === 'HOLO' && emu.modes[0].partMask === 0xff && emu.modes[0].mode === 2, `node ${node}: FUN_00444550(HOLO, 0xff, 2) from the set-up: ${JSON.stringify(emu.modes)}`);
      const fog = emu.calls.filter((c) => c.name === 'fog');
      ok(fog.length === 1 && JSON.stringify(fog[0].args.slice(0, 6)) === JSON.stringify([0x40800000, 0x42c80000, 0x43960000, 0x43480000, 0, 1]), `node ${node}: one SetupFog call (4.0, 100, 300, 200, black, on): ${JSON.stringify(fog.map((f) => f.args.map((a) => a.toString(16))))}`);
      ok(FOG_PHASES.z40OGL?.play === 0x7e3c43 && fog[0]?.at === 0x7e3c43, 'the play fog is the 32-bit call of FUN_007e3bd1 (0x7e3c43)');
      ok(pickFogCall('z40OGL', [{ at: 0x7e3bf1 }, { at: 0x7e3c43 }], { loopMode: 2, playedYet: true, restarted: false }).call?.at === 0x7e3c43, 'pickFogCall: the 32-bit call wins');
      ok(JSON.stringify(emu.waypointMaps.map((m) => [m.index, m.path])) === JSON.stringify([[1, '_Data\\z40OGL\\Waypoints\\W_PATH'], [2, '_Data\\z40OGL\\Waypoints\\W_CSM']]), `node ${node}: waypoint maps W_PATH (1) and W_CSM (2)`);
      ok(emu.loaderRigs.length === 38 && emu.loaderRigs.some((r) => r.rig === 'BATT') && emu.loaderRigs.some((r) => r.rig === 'SLUG') && emu.loaderRigs.some((r) => r.rig === 'RBBT') && emu.loaderRigs.some((r) => r.rig === 'MONK'), `node ${node}: loader rigs ${emu.loaderRigs.length} (MFIG, CIT1..5, MONK, RBBT, SLUG, SKBD, BATT)`);
      // the sound handles: ten krystal handles, all 3D sound 0x267 = 615, in load order; the music handle 'ogel'
      ok(emu.soundHandles.length === 45 && emu.soundHandles.filter((h) => h.kind !== 'music').length === 44, `node ${node}: 44 sound handles + the music (${emu.soundHandles.length})`);
      ok(KST_HANDLES.every((a) => H.ictx.soundOf(a) === 615) && new Set(KST_HANDLES).size === 10, `node ${node}: the ten krystal handles are 3D sound 615`);
      ok(emu.soundHandles.find((h) => h.kind === 'music')?.name === 'ogel' && ZONE_MUSIC.z40OGL?.key === 'ogel', `node ${node}: music key 'ogel'`);
      const list = ZONE_SOUND_SETUP.z40OGL?.loads ?? [];
      const first615 = list.findIndex((l) => l[1] === 615);
      ok(list.length === 44 && list.slice(first615, first615 + 10).every((l) => l[0] === '3d' && l[1] === 615) && list.filter((l) => l[1] === 615).length === 10, 'the zone sound list holds the ten 615 slots in a row, in load order (slot n = KSTn)');
      // arrival (FUN_00462be9(1, 0x3e) -> Pepper's matrix for node 64; node 66: the map's own record)
      const p = H.pepper;
      const want = node === 64 ? [35.30314636230469, 27.1, 209.07586669921875] : [-143.742, -65.8, 122.137];
      ok(Math.abs(p.x - want[0]) < 0.01 && Math.abs(p.z - want[2]) < 0.01 && Math.abs(p.y - want[1]) < 0.7, `node ${node}: Pepper arrives at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
      ok(w.vars.get(0x5e) === 1, `node ${node}: PEPPER_CONTROL 1 (FUN_00417597(0x5e, 1))`);
      ok(w.vars.get(0x59) === 27 && w.vars.get(0x58) === node, `node ${node}: sub-game 27, story node`);
      // gravity -7 (DAT_009da9bc = 0xc0e00000), sea level -96 (DAT_009da858 = 0xc2c00000), the ground record OGEL (FUN_004425e0(record 1))
      ok(H.profile.gravity === -7 && w.gravity === -7 && H.profile.seaLevel === -96 && w.seaLevel === -96 && H.profile.ground === 'OGEL' && H.profile.hub === true, `node ${node}: gravity ${w.gravity}, sea ${w.seaLevel}, ground ${H.profile.ground}`);
      // texts and objective of the set-up (FUN_007e3bd1 -> FUN_0088d280 / FUN_00423fe0 / FUN_004242b9): replayed by the framework
      const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
      const real = new HubContext(w, pe, H.archive, emu, 'z40OGL', H.scene);
      real.messages = messages;
      replaySetupState(real);
      ok(real.textPaths.hol === 'OG/Data/OGLhol1.str' || node === 66 && real.textPaths.hol === 'OG/Data/OGLhol2.str', `node ${node}: hologram table ${real.textPaths.hol}`);
      ok(node === 64 ? real.textPaths.npc === null : real.textPaths.npc === 'OG/Data/OGLfsm2.str', `node ${node}: npc table ${real.textPaths.npc}`);
      ok(real.goal.mode === 3 && real.goal.node === (node === 64 ? 63 : 3), `node ${node}: objective = PATH node ${real.goal.node} (mode ${real.goal.mode})`);
      ok(!!real.text.hol?.find('HOLOA'), `node ${node}: the hologram's first hint HOLOA exists`);
      // the shared families that need the zone's texts
      ok(H.L.skipped.every((s) => s.ctorName === 'PeppSwit') , `node ${node}: skipped constructors: ${[...new Set(H.L.skipped.map((s) => s.ctorName))]}`);
    }

    // ---- (c) the krystals on top of the set-up
    {
      const H = loadOgl(ctx, { node: 64 });
      const w = H.world, ksts = w.records.filter((r) => /^KST[0-9]$/.test(r.name));
      ok(ksts.length === 10, 'ten KST records');
      const nodeOf = (r) => r.ctrl?.nodes.find((n) => n.kind === 'Overlay');
      ok(ksts.filter((r) => nodeOf(r)).length === 9 && !nodeOf(w.records.find((r) => r.name === 'KST7')), 'KST7 has no Overlay node (FUN_007e36dd attaches nine)');
      // constructor work: record flags (+0x60 |= 0x10 = no collision), state 0, one shared TWINKLE01 emitter created idle on the first krystal
      ok(ksts.filter((r) => nodeOf(r)).every((r) => (r.flags & 0x12) === 0x12 && nodeOf(r).state === 0), 'constructors: flags |= 0x10, state 0');
      const starts = H.fx.log.filter((l) => l.op === 'start');
      ok(starts.length === 1 && starts[0].name === TWINKLE_EMITTER && JSON.stringify(starts[0].gate) === '[1,1,1]' && JSON.stringify(starts[0].pos) === JSON.stringify([0, 4, 0]) && JSON.stringify(starts[0].rot) === '[0,0,0]', `one shared TWINKLE01.par emitter (off, offset 0 4 0): ${JSON.stringify(starts)}`);
      const first = H.fx.emitters.get(starts[0].h);
      ok(first.matrix() === w.records.find((r) => nodeOf(r)).m, 'the emitter follows the first krystal\'s live matrix');
      // sounds: the krystal handle's 3D slot n each tick; none for a hidden one
      H.log.length = 0;
      tick(H, 1);
      const p3 = H.log.filter((l) => l.startsWith('p3 KST'));
      ok(p3.length === 9 && KST_WITH_NODE.every((n) => p3.some((l) => l.startsWith(`p3 ${n} `))), `each visible krystal plays its own 3D slot every tick (${p3.length})`);
      // pick-up at 3.5: 1000 points twice, the 3D loop of that krystal stops, the collect jingle, hidden, state 3 -> 0, the bit set after the third tick, the emitter moved + emitting + stopped
      const k = ksts.find((r) => r.name === 'KST3'), n3 = nodeOf(k);
      const pep = H.pepper;
      pep.x = k.x + 3.5; pep.y = k.y; pep.z = k.z; pep.savePrev();
      H.log.length = 0; H.fx.log.length = 0;
      tick(H, 1);
      ok(n3.state === 3 && (k.flags & 2) === 0 && H.vars.get(0x31) === 0 && H.vars.get(0x25) === KRYSTAL_SCORE && H.vars.get(199) === KRYSTAL_SCORE, `pick-up at 3.5: state ${n3.state}, flags 0x${k.flags.toString(16)}, var 0x31 ${H.vars.get(0x31)}, score ${H.vars.get(0x25)}`);
      ok(H.log.includes('s3 KST3') && H.log.includes(`p2 #${SND_COLLECT}`), `pick-up sounds: ${H.log.filter((l) => !l.startsWith('p3 KST')).join(' | ')}`);
      ok(H.fx.log.map((l) => l.op + (l.gate ? l.gate.join('') : '')).join() === 'matrix,matrix,gate211', `pick-up emitter calls: ${H.fx.log.map((l) => l.op)}`);
      ok(H.fx.emitters.get(starts[0].h).matrix() === k.m, 'the emitter now follows the picked krystal');
      tick(H, 2);
      ok(n3.state === 1 && H.vars.get(0x31) === 0, 'two ticks later: state 1, bit not yet set');
      tick(H, 1);
      ok(n3.state === 0 && H.vars.get(0x31) === 8 && H.fx.log.at(-1).op === 'gate' && H.fx.log.at(-1).gate[0] === 1, `third tick: state 0, var 0x31 = ${H.vars.get(0x31)}, the emitter stops`);
      H.log.length = 0;
      tick(H, 3);
      ok(!H.log.some((l) => l.startsWith('p3 KST3')) && H.vars.get(0x25) === KRYSTAL_SCORE, 'a collected krystal is never played or scored again');
      // out of range (3.7): nothing
      const k2 = ksts.find((r) => r.name === 'KST5');
      pep.x = k2.x + 3.7; pep.y = k2.y; pep.z = k2.z; pep.savePrev();
      tick(H, 3);
      ok((k2.flags & 2) !== 0 && nodeOf(k2).state === 0, 'at 3.7 units a krystal stays (range 3.6)');
      ok(f32(KRYSTAL_RANGE2) === f32(12.96) && Math.abs(Math.sqrt(KRYSTAL_RANGE2) - 3.6) < 1e-6, 'range 12.96 = 3.6 squared');
      // collected in an earlier visit: hidden by the constructor, never plays
      const H2 = loadOgl(ctx, { node: 66, vars: { 0x31: 0x5 } });
      const hid = H2.world.records.filter((r) => /^KST[0-9]$/.test(r.name) && (r.flags & 2) === 0).map((r) => r.name);
      ok(JSON.stringify(hid) === JSON.stringify(['KST2', 'KST0']), `collected before (bits 1, 4): hidden ${hid}`);
      H2.log.length = 0; tick(H2, 1);
      ok(!H2.log.some((l) => /^p3 KST[02] /.test(l)) && H2.log.filter((l) => l.startsWith('p3 KST')).length === 7, 'hidden krystals do not play (their gates are closed)');
      // the node's save state (FUN_007e319e / FUN_007e31c3: 4 bytes at +0x18)
      const kn = new KrystalNode({ var: 0x31, mask: 1, value: 0 });
      kn.loadState(3); ok(kn.saveState() === 3, 'save / load state');
    }

    // ---- (d) the HUD
    {
      const hud = new Hud(null), st = newHudState(), vars = new GameVars();
      hudInit(hud, st);
      ok(hud.left.tex === OGL_HUD.KRYSTAL && hud.right.tex === -1 && hud.column.length === 5 && hud.column.every((c) => c.tex === -1), 'hudInit: krystal icon left, no right icon, empty column');
      vars.set(0x25, 7); vars.set(0x31, 0b1000100111); vars.set(0x5e, 1);
      hudFrame(hud, vars, st, 1);
      ok(hud.centreText === '0007' && hud.leftText === 'x5', `texts "${hud.centreText}" / "${hud.leftText}" (bit 9 = 0x200 counts: the loop covers ten bits)`);
      vars.set(0x31, 0x400 | 0x3); hudFrame(hud, vars, st, 1);
      ok(hud.leftText === 'x2', 'bits above the tenth are not counted');
      for (const [word, tex] of [[0x20, OGL_HUD.ICON_SWITCH], [1, OGL_HUD.ICON_ACTION], [0x1e, OGL_HUD.ICON_TALK], [2, OGL_HUD.ICON_TALK], [0x21, OGL_HUD.ICON_SWITCH]]) {
        vars.set(0xc, word); hudFrame(hud, vars, st, 1);
        ok(hud.column[0].tex === tex && vars.get(0xc) === 0, `var 0xc = 0x${word.toString(16)} -> icon ${tex}, the word is cleared`);
      }
      vars.set(0xc, 0); hudFrame(hud, vars, st, 1);
      ok(hud.column[0].tex === -1, 'no word: no icon');
      // not walking: the icon keeps the last value
      vars.set(0x5e, 2); vars.set(0xc, 0x20); hudFrame(hud, vars, st, 1);
      ok(hud.column[0].tex === -1, 'PEPPER_CONTROL & 1 = 0: the icon is not set');
      vars.set(0x5e, 1); vars.set(0xc, 1); hudFrame(hud, vars, st, 1); vars.set(0x5e, 2); vars.set(0xc, 0x20); hudFrame(hud, vars, st, 1);
      ok(hud.column[0].tex === OGL_HUD.ICON_ACTION, 'the last icon stays while Pepper does not walk');
      // blink: 15 frames texture 4, then 5 until the counter passes 30
      vars.set(0x5e, 1); vars.set(0xc, 0); hudFrame(hud, vars, st, 1);
      const seq = [];
      for (let i = 0; i < 40; i++) { vars.set(0xc, 0x40); hudFrame(hud, vars, st, 1); seq.push(hud.column[0].tex); }
      ok(seq.slice(0, 14).every((t) => t === OGL_HUD.ICON_BLINK_A) && seq[14] === OGL_HUD.ICON_BLINK_B && seq[30] === OGL_HUD.ICON_BLINK_B && seq[31] === OGL_HUD.ICON_BLINK_A, `blink: ${seq.join('')}`);
    }

    // ---- (e) the wrapper's outfit restore (FUN_00421bbe(5)) on a fresh game
    {
      const H = loadOgl(ctx, { node: 64 });
      restoreOutfits(H.world, pe);
      const marked = H.world.records.filter((r) => r.variant === 1).map((r) => r.name);
      ok(OUTFIT_HUB === 5 && JSON.stringify(marked) === JSON.stringify(['MAMA', 'PAPA', 'G002', 'G003', 'G004', 'G005', 'G006', 'G007', 'G008', 'G009', 'G010', 'KKKK', 'KKKK']), `outfit restore: variant word 1 on ${marked}`);
      restoreOutfits(H.world, pe, (i) => (i === 435 ? [2, 3] : [0, 0]));
      ok(H.world.records[3].variant === (2 << 8 | 1 | 3 << 16), `a saved phase / outfit goes into the variant word (0x${H.world.records[3].variant.toString(16)})`);
    }

    // ---- (f) the story: the arrival cutscene and the waypoint trigger that completes the node
    for (const node of [64, 66]) {
      const H = loadOgl(ctx, { node });
      H.ictx.cutsceneTicks = 5;
      tick(H, 10);
      const started = H.ictx.cutscenes.map((c) => c.slot);
      ok(JSON.stringify(started) === JSON.stringify(node === 64 ? [2] : [0]), `node ${node}: arrival cutscene slot ${started} (${node === 64 ? 'OGL04 land_on_ogel' : 'OGL01 stuffed_croanies'})`);
      ok(H.vars.get(256) === 0 && H.vars.get(257) === 0, `node ${node}: the switches start at 0`);
      const tgt = H.ictx.pathPos(node === 64 ? 63 : 3);
      H.pepper.x = tgt[0]; H.pepper.y = tgt[1] + 0.5; H.pepper.z = tgt[2]; H.pepper.savePrev();
      tick(H, 40);
      ok(node === 64 ? H.vars.get(256) === 1 : H.vars.get(257) === 1, `node ${node}: standing on PATH node ${node === 64 ? 63 : 3} sets SWITCH_OGL_AT_OGEL_${node === 64 ? 'PIZZERIA (256)' : 'HQ (257)'}`);
      if (node === 66) ok(H.ictx.cutscenes.some((c) => c.slot === 1), 'node 66: the palace trigger starts OGL03 (slot 1)');
      const r = H.story.frame();
      ok(r === 6 && H.vars.get(0x58) === node + 1, `node ${node}: the story FSM completes it (frame ${r}, node ${H.vars.get(0x58)})`);
    }
    return { checked, failures, notes };
  },
};
