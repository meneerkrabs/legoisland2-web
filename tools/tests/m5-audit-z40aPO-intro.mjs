// M5 audit, z40aPO: the intro cutscene `ogl02` (z40OGL archive, strings apo01) run by the current cutscene runner (src/shell/cutscene.ts, the exact M4 WP2 port) on the REAL zone world
// (records PEPP / SHTL, the zone's CSM / PATH waypoints): what the script does to the real records, the camera, the FOV, the bars and PEPPER_CONTROL, the end of the script
// (docs/re/m5/audit-minigames-b.md section z40aPO). The script's commands are checked against the executable's table for the zone (FUN_007d0839: slot 0, "ogl02", "apo01").
import { parseCutscene } from '../../src/formats/cutscene.ts';
import { CutsceneRunner, SEC_PER_TICK } from '../../src/shell/cutscene.ts';
import { WaypointSystem, MAP_CSM, MAP_PATH, MAP_NAMES, NPC_SPEED, NPC_TURN_RATE, NPC_RADIUS_MIN, NPC_RADIUS_MAX, NPC_RADIUS_LIMIT } from '../../src/game/walker.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { loadZone } from '../lib/engine-load.mjs';
import { startApoRun, APO_CUTSCENE } from '../../src/zones/z40aPO.ts';

export default {
  name: 'm5-audit-z40aPO-intro',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const find = (n) => ctx.archives.find((a) => a.name.toLowerCase() === n.toLowerCase());
    const og = find('z40OGL'), apo = find('z40aPO'), msgs = find('messages');
    const cut = parseCutscene(og.read(og.find(`cutscene/${APO_CUTSCENE.script}.cut`)));
    const table = loadMessages(msgs, [`${APO_CUTSCENE.area.toUpperCase()}/Data/${APO_CUTSCENE.strings}.str`]);
    ok(cut.commands.length === 16 && cut.declaredCount === 16, 'ogl02 has 16 commands (declared 16)');

    const L = loadZone(ctx, 'z40aPO');
    startApoRun(L.world, L.archive);
    const W = L.world;
    const wp = new WaypointSystem();
    for (const slot of [MAP_PATH, MAP_CSM]) { const e = apo.find(`Waypoints/W_${MAP_NAMES[slot]}_C.wpt`); ok(!!e, `the zone has the ${MAP_NAMES[slot]} waypoint map (FUN_007d0b50 loads maps 1 PATH / 2 CSM from z40apo)`); if (e) wp.loadMap(slot, apo.read(e)); }
    const waypoint = (name) => { for (const m of [MAP_CSM, MAP_PATH]) { const i = wp.findNode(m, name.toUpperCase()); if (i >= 0) { const p = wp.nodePos(m, i); return [p[0], p[1], p[2]]; } } return null; };
    // every name the script uses must resolve in the zone's maps (an unresolved one would silently give (0, 0, 0))
    for (const c of cut.commands) if (c.targetKind === 'waypoint') ok(!!waypoint(c.target), `waypoint ${c.target} resolves in the zone's maps`);
    // every actor the script names exists in the zone's records (an unknown actor stops the original's loader)
    for (const c of cut.commands) ok(c.actor === 'CMRA' || W.records.some((r) => r.name.startsWith(c.actor)), `actor ${c.actor} is a record of the zone`);

    const log = [];
    let speaking = 0;
    const env = {
      world: W, wp, waypoint,
      text: (id) => table.text(id),
      say: (id) => { log.push(`say ${id}`); speaking = 20; return true; },
      speechIdle: () => speaking === 0,
      stopSpeech: () => { speaking = 0; },
      setFov: (f) => log.push(`fov ${f}`), getFov: () => 1, setNearPlane: () => {},
      skipPressed: () => false, speechOn: () => true, textOn: () => true,
      letterbox: (m) => log.push(`bars ${m}`),
      animClip: () => null, varIndex: () => -1, loadMan: () => null, random: () => 0.5,
    };
    const r = new CutsceneRunner(env);
    r.allocate(1); r.define(APO_CUTSCENE.slot, APO_CUTSCENE.script, cut);
    const pepp = W.records.find((x) => x.name === 'PEPP'), shtl = W.records.find((x) => x.name === 'SHTL');
    // FUN_0042207d(PEPP) (the zone game does the same): Pepper's walker on PATH, so the end of the script has its Pepper clean-up
    pepp.ctrl.walker = wp.create(MAP_PATH, pepp, -3);
    ok(pepp.ctrl.walker > 0, 'Pepper gets a walker on the PATH map');
    wp.setSpeed(pepp.ctrl.walker, NPC_SPEED); wp.setLane(pepp.ctrl.walker, 0.01); wp.setTurnRate(pepp.ctrl.walker, NPC_TURN_RATE);
    wp.setRadiusMin(pepp.ctrl.walker, NPC_RADIUS_MIN); wp.setRadiusMax(pepp.ctrl.walker, NPC_RADIUS_MAX); wp.setRadiusLimit(pepp.ctrl.walker, NPC_RADIUS_LIMIT);
    const clip0 = pepp.anim?.clip;
    ok(r.start(0) && r.active(), 'start(0) runs the script (FUN_0045c40c(0) at the top of the loop)');
    ok(log[0] === 'bars 1' && (W.vars.get(0x5e) & 0x100) === 0x100, 'the cutscene bars come on and PEPPER_CONTROL |= 0x100');
    r.tick();
    const shut1 = waypoint('PEPSHUTTLE01'), cam1 = waypoint('NEWCAM100'), look = waypoint('NEWCAM200');
    ok(!pepp.enabled && Math.abs(pepp.x - shut1[0]) < 1e-4 && Math.abs(pepp.z - shut1[2]) < 1e-4 && pepp.y >= shut1[1] - 1e-4 && pepp.y < shut1[1] + 5, `Pepper is hidden at PEPSHUTTLE01 ${shut1.map((v) => v.toFixed(1))} (real record PEPP: ${pepp.x.toFixed(1)}, ${pepp.y.toFixed(1)}, ${pepp.z.toFixed(1)}: the per-frame ground snap of the registered actor (FUN_00459740) puts him on the shuttle's floor)`);
    const c = W.camera.c;
    ok(Math.abs(c[0] - cam1[0]) < 1e-3 && Math.abs(c[1] - cam1[1]) < 1e-3 && Math.abs(c[3] - look[0]) < 1e-3 && Math.abs(c[4] - look[1]) < 1e-3, `camera at NEWCAM100 looking at NEWCAM200 (eye ${[c[0], c[1], c[2]].map((v) => v.toFixed(1))})`);
    const said = []; let seen = '', t = 1;
    while (r.active() && t < 6000) { r.tick(); if (speaking > 0) speaking--; t++; if (r.subtitle && r.subtitle.id !== seen) { seen = r.subtitle.id; said.push(seen); } }
    ok(said.join() === 'OGCSSD01,OGCSSD02,OGCSSD03,OGCSSD04,OGCSSD05,OGCSSD06,OGCSSD07,OGCSSD08', `the eight lines of the shuttle (actor SHTL) in order: ${said}`);
    ok(log.filter((l) => l.startsWith('fov')).join() === 'fov 1,fov 0.5,fov 1', `FOV 1, then 0.5, restored to 1 at the end (${log.filter((l) => l.startsWith('fov'))})`);
    ok(pepp.enabled, 'Pepper is visible again at the end (SETVISIBILITY PEPP at the end of the script)');
    ok(!r.active() && log.at(-1) === 'bars 0' && (W.vars.get(0x5e) & 0x100) === 0, 'the end of the script removes the bars and clears the busy bit');
    // the end-of-script clean-up of PEPP's walker: unregistered, his clip restarted with DAT_008ae088 (0x1b: the rig has 12 clips, 27 does not exist: the fall pose goes on), the camera put behind him
    ok(pepp.anim && pepp.anim.clip === clip0, `Pepper's clip is unchanged (${clip0}): FUN_0043b6a3 with the clip 0x1b of a 12 clip rig does nothing`);
    ok(Math.abs(c[3] - pepp.x) < 1e-2 && Math.abs(c[5] - pepp.z) < 1e-2 && Math.abs(c[4] - pepp.y - 3.2) < 0.5, `the end puts the camera behind Pepper: target ${[c[3], c[4], c[5]].map((v) => v.toFixed(1))} (Pepper ${[pepp.x, pepp.y, pepp.z].map((v) => v.toFixed(1))})`);
    const minTicks = cut.commands.filter((x) => x.cmd === 2).reduce((s, x) => s + Math.ceil(((table.text(x.textId).length + 20) / 20) / SEC_PER_TICK), 0);
    ok(t >= minTicks - 10, `the script lasts at least the sum of the line minimum times (${t} >= ${minTicks - 10} ticks = ${(t / 30).toFixed(1)} s)`);
    notes.push(`ogl02 on the real zone: ${t} ticks (${(t / 30).toFixed(1)} s) with a 20 tick voice; the real records PEPP (6) and SHTL (10) were driven; no unresolved waypoint or actor`);
    ok(shtl.enabled, 'the shuttle record stays visible during the intro');
    return { checked, failures, notes };
  },
};
