// M6 zone port z09JST (Jousting duel against the Dark Knight): the executable's constants, the clip tables, the B-spline camera, the mfig manager, the duel's state machine
// (charge, release, ride, aim, the three outcomes with their four reactions each, rounds, medals, variables, sounds, camera modes, gear) with scripted keys on the real zone's
// records, and scripted WIN / LOSS / GLANCE / TOO-SLOW matches (docs/re/m6/z09JST.md).
import { GameVars } from '../../src/game/vars.ts';
import { GameRecord } from '../../src/game/record.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { ctorFactory } from '../../src/game/setup.ts';
import '../../src/zones/z09JST.ts';
import { startDuel, readTables, checkRecords, giveAnimations, JstGameNode, FlagNode, AnimsNode, DrkkNode, INTRO_CAMERA } from '../../src/zones/z09jst/rig.ts';
import { JoustDuel, bspline, ST } from '../../src/zones/z09jst/duel.ts';
import { MsvcRng } from '../lib/msvc-rng.mjs';
import { MfigMan } from '../../src/zones/z09jst/mfig.ts';
import { CTOR, REC, NAMES, K, S2D, S3D, SAY, VAR, RIG_OF, START_CLIPS, SPECTATORS, ALL_2D, ALL_3D, hexf, readClipTable, TABLE_PLAYER_VA, TABLE_ENEMY_VA } from '../../src/zones/z09jst/consts.ts';
import { markLines, reticleLines, reticleMode } from '../../src/zones/z09jst/marker.ts';
import { JoustSound } from '../../src/zones/z09jst/sound.ts';
import { KEY, jstKeys } from '../lib/jst-bot.mjs';
import { loadExe, loadZone } from '../lib/engine-load.mjs';

const f32 = Math.fround;
const fv = (pe, va) => hexf(pe.u32(va));
const f64 = (pe, va) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, pe.u32(va), true); d.setUint32(4, pe.u32(va + 4), true); return d.getFloat64(0, true); };
const hasImm = (pe, start, end, v) => { const o = pe.offset(start); const n = end - start; const b = [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; for (let i = 0; i + 4 <= n; i++) if (pe.data[o + i] === b[0] && pe.data[o + i + 1] === b[1] && pe.data[o + i + 2] === b[2] && pe.data[o + i + 3] === b[3]) return true; return false; };

export default {
  name: 'm6-z09JST',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e * Math.max(1, Math.abs(b));
    const pe = loadExe(ctx.dataRoot);

    // ============================================================================================================= the executable
    // (a) floats the update / camera / helpers read (.rdata)
    const FLOATS = {
      0x892020: 1, 0x89202c: 0, 0x892024: 12, 0x892038: 30, 0x89204c: 0.5, 0x892070: 5, 0x892074: 15, 0x892080: 4, 0x892090: 8, 0x8920d0: 2.5, 0x892100: 128, 0x892114: 200, 0x892170: 0.12,
      0x892200: 3, 0x8921f4: 16, 0x892250: 240, 0x892254: 50, 0x8922c0: 0.02, 0x89237c: 20, 0x892388: 60, 0x8923cc: 0.0625, 0x89245c: 0.3, 0x892464: 0.55, 0x89213c: 0.6, 0x8924d4: 3.2,
      0x8924e0: 180, 0x892528: 40, 0x892540: 64, 0x89257c: 18, 0x892664: 0.009, 0x892684: -8, 0x892690: 6.4, 0x892694: 170, 0x8926dc: 190, 0x8926e0: 224, 0x8926e4: 1.3, 0x8926e8: 3.8,
      0x8926ec: 4.3, 0x892700: 70, 0x892704: 3.75, 0x892708: 3.7, 0x89270c: 0.03125, 0x892710: 245, 0x892714: -75, 0x905658: 0.0075, 0x89207c: Math.PI, 0x892288: 1 / 6, 0x8921fc: 32767,
    };
    const bad = [];
    for (const [a, v] of Object.entries(FLOATS)) if (!near(fv(pe, +a), v, 1e-5)) bad.push(`0x${(+a).toString(16)} = ${fv(pe, +a)} (want ${v})`);
    ok(bad.length === 0, `float constants: ${bad.join('; ')}`);
    ok(f64(pe, 0x8926f8) === 1.4 && f64(pe, 0x8926f0) === 10, 'doubles: the aim wobble divisor 1.4 and the pull-back divisor 10');
    // the K object of the port holds the same numbers
    ok(K.FORTY === fv(pe, 0x892528) && K.EIGHTEEN === fv(pe, 0x89257c) && K.SIXTY === fv(pe, 0x892388) && K.TWENTY === fv(pe, 0x89237c) && K.X224 === fv(pe, 0x8926e0) && K.X190 === fv(pe, 0x8926dc), 'K: 40 / 18 / 60 / 20 / 224 / 190');
    ok(K.RIDER === fv(pe, 0x8922c0) && K.DECAY === fv(pe, 0x905658) && K.RATE === fv(pe, 0x89270c) && K.CLASH_GAP === fv(pe, 0x892684) && K.CAM_E_STEP === fv(pe, 0x892664), 'K: 0.02 / 0.0075 / 1/32 / -8 / 0.009');
    // (b) immediates inside the functions: FUN_005d4860 (round set-up), FUN_005ce506 (update), FUN_005d4698 (result), FUN_005d2782 (power pitch)
    const RESET = [0x5d4860, 0x5d4add], UPD = [0x5ce506, 0x5d1ab6], RES = [0x5d4698, 0x5d4860];
    ok([0x42200000, 0x41500000, 0xc2aa0000, 0x3fc8f5c3, 0x434c0000, 0xc29e0000, 0xbfc8f5c3, 0x3e4ccccd, 0x3f000000, 0x3f800000].every((v) => hasImm(pe, RESET[0], RESET[1], v)),
      'FUN_005d4860: start places (40, 13, -85) / (204, 13, -79), facing +-1.5700, decay factor 0.2, rates 0.5, charge step 1.0');
    ok(hasImm(pe, UPD[0], UPD[1], 0x40b66666) && hasImm(pe, UPD[0], UPD[1], 0x3fc90f94), 'FUN_005ce506: end camera angles 5.7 and 1.5708 (0x40b66666, 0x3fc90f94)');
    ok(hasImm(pe, 0x5d2782, 0x5d27e0, 0x5bcc) && hasImm(pe, 0x5d2782, 0x5d27e0, 0x5fb4) && hasImm(pe, 0x5d2782, 0x5d27e0, 0x3c), 'FUN_005d2782: pitch = ftol(gauge) * 0x5bcc / 0x3c + 0x5fb4');
    {
      const code = [...pe.slice(RES[0], RES[1] - RES[0])];
      const has = (...bytes) => { for (let i = 0; i + bytes.length <= code.length; i++) if (bytes.every((b, k) => code[i + k] === b)) return true; return false; };
      ok(has(0x68, 0xcb, 0, 0, 0) && has(0x6a, 0x18), 'FUN_005d4698: variables 0xcb (trophy) and 0x18 (hi-score) are read and written');
    }
    // (c) the constructors (the attaches of the set-up code) and the node vtables
    ok(CTOR.JSTGAME === 0x5d1f64 && CTOR.FLAG === 0x5d3e7c && CTOR.ANIMS === 0x5d3cc1 && CTOR.DRKK === 0x5d3ad4, 'constructor addresses');
    const vt = (va) => [0, 4, 8, 12].map((o) => pe.u32(va + o));
    ok(vt(0x905640)[0] === 0x5ce506 && vt(0x905640)[2] === 0x5d243e && vt(0x905640)[3] === 0x5d1e8f, 'JSTGame vtable: update 0x5ce506, destroy 0x5d243e, draw 0x5d1e8f');
    ok(vt(0x905850)[0] === 0x5d27e0 && vt(0x905850)[3] === 0x5d2814 && vt(0x9058a0)[0] === 0x5d3b80 && vt(0x9058f0)[0] === 0x5d3d90, 'Drkk update 0x5d27e0 / draw 0x5d2814, Anims 0x5d3b80, Flag 0x5d3d90');
    // (d) the sound table: ids and names, the files are the zone's
    const snd = await import('../../src/formats/sound.ts');
    const table = snd.readExeSoundTable(pe.data);
    const NAMES_S = {
      0x5d: 'SND_WIND_JST', 0x5f: 'SND_CROW_1', 0x5e: 'SND_CROW_2', 0x62: 'SND_CROWD_WIN', 0x63: 'SND_CROWD_LOSE', 0x61: 'SND_CROWD_FALL', 0x60: 'SND_CROWD_BK_FALLEN', 0x64: 'SND_CROWD_CHARGE',
      0xf5: 'SND_FANFARE_SHORT', 0xf6: 'SND_FANFARE_MED', 0xf7: 'SND_FANFARE_LONG', 0xf8: 'SND_WINDUP', 0x2b6: 'SND_JST_ONLANCE', 0x2b7: 'SND_JST_OFFLANCE', 0x255: 'SND_JST_GRAB', 0x256: 'SND_JST_THROW', 0x257: 'SND_JST_LAND',
      0x4e: 'SND_HOOF_SLOW_1', 0x4c: 'SND_HOOF_SLOW_2', 0x4d: 'SND_HOOF_SLOW_3', 0x4b: 'SND_HOOF_SLOW_4', 0x50: 'SND_HOOF_MID_1', 0x4f: 'SND_HOOF_MID_2', 0x51: 'SND_HOOF_MID_3', 0x52: 'SND_HOOF_MID_4',
      0x53: 'SND_HOOF_FAST_1', 0x54: 'SND_HOOF_FAST_2', 0x56: 'SND_HOOF_FAST_3', 0x55: 'SND_HOOF_FAST_4', 0x58: 'SND_HORSE1_NEIGH', 0x57: 'SND_HORSE1_1', 0x59: 'SND_HORSE1_2', 0x5a: 'SND_HORSE2_NEIGH',
      0x5c: 'SND_HORSE2_1', 0x5b: 'SND_HORSE2_2', 0x65: 'SND_PEPP_HIT_BK', 0x68: 'SND_PEPP_KNOCKED_OFF', 0x67: 'SND_BK_FALLEN', 0x6a: 'SND_PEPP_FALLEN', 0x66: 'SND_BK_HIT_PEPP', 0x69: 'SND_PEPP_LANCE_TWANG',
      0x253: 'SND_JST_BLKWALK1', 0x254: 'SND_JST_BLKWALK2',
    };
    for (const [id, name] of Object.entries(NAMES_S)) ok(table[+id]?.name === name && /z09JST/i.test(table[+id].path), `sound ${id}: ${table[+id]?.name} ${table[+id]?.path}`);
    ok(S2D.WINDUP === 0xf8 && S3D.HOOF_SLOW.join() === [0x4e, 0x4c, 0x4d, 0x4b].join() && S3D.HOOF_FAST.join() === [0x53, 0x54, 0x56, 0x55].join() && S3D.HOOF_MID.join() === [0x50, 0x4f, 0x51, 0x52].join(), 'sound id sets of the port');
    ok(table[0xf8].loopCount === 0 && table[0x5d].loopCount === 0 && table[0x64].loopCount === 0 && table[0x62].loopCount === 1, 'WINDUP / WIND / CROWD_CHARGE loop (count 0), CROWD_WIN plays once');
    // (e) the message table (CI/Data/jst.str)
    const messages = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const strings = await import('../../src/ui/strings.ts');
    const tab = strings.loadMessages(messages, ['CI/Data/jst.str']);
    for (let i = 1; i <= 13; i++) { const id = `CASGJO${String(i).padStart(2, '0')}`; ok(tab.has(id) && tab.voice(id) === 1122 + i, `jst.str ${id} voice ${tab.voice(id)}`); }
    for (let i = 1; i <= 15; i++) ok(tab.has(`JST${i}`), `jst.str JST${i}`);
    for (let i = 0; i < 7; i++) ok(tab.raw(`CONTROL${i}`) !== null, `jst.str CONTROL${i}`);
    ok(tab.raw('CONTROL7') === null, 'jst.str has no CONTROL7 (help = 7 lines)');
    ok(tab.raw('CONTROL4').startsWith('BUTTON_LEFT') && tab.raw('CONTROL5').startsWith('BUTTON_RIGHT') && tab.raw('CONTROL6').startsWith('BUTTON_4'), 'help: LEFT / RIGHT build up power, button 4 lets go');
    for (const id of [...SAY.PLAYER_HIT, ...SAY.ENEMY_HIT, ...SAY.BOTH_MISS, SAY.INTRO]) ok(tab.has(id), `speech id ${id} exists`);
    // (f) clip tables and the final tableau
    const tp = readClipTable(pe, TABLE_PLAYER_VA), te = readClipTable(pe, TABLE_ENEMY_VA);
    ok(tp.length === 19 && te.length === 19, 'two tables of 19 rows');
    ok(tp[6].join() === '4,4,4,143' && tp[7].join() === '13,13,13,146' && tp[8].join() === '8,8,8,189' && tp[10].join() === '9,9,9,213' && tp[18].join() === '11,11,11,188', 'player rows 6 / 7 / 8 / 10 / 18');
    ok(te[4].slice(0, 3).join() === '3,3,158' && te[2].slice(0, 3).join() === '6,6,152' && te[17].slice(0, 3).join() === '10,10,154' && te[18].slice(0, 3).join() === '12,12,156', 'enemy rows 2 / 4 / 17 / 18');
    const T = readTables(pe);
    ok(T.end.length === 8 && T.end[0].slice(0, 3).join() === '120,13.5,-97' && near(T.end[0][3], Math.PI / 4, 1e-4) && near(T.end[3][3], Math.PI / 2, 1e-4) && T.end[3].slice(0, 3).join() === '128,13.5,-72' && T.end[4][0] === 118 && T.end[7].slice(0, 3).join() === '120,13.5,-72' && near(T.end[7][3], 3.927, 1e-4) && near(T.end[5][3], 0.3491, 1e-3) && T.end[4][3] === 0, 'final tableau rows (x y z yaw)');
    ok(T.spline.points.length === 5 && T.spline.points[0].join() === [25, f32(21.3), -80].join() && T.spline.points[3].join() === [95, 30, -120].join() && T.spline.end.join() === [184, 24, -96].join() && T.spline.follow.join() === [-5, f32(8.35), -12.5].join() && near(T.spline.blend, 0.4, 1e-6), 'camera spline: 5 control points, end offset (184, 24, -96), follow offset (-5, 8.35, -12.5), blend 0.4');
    {
      const o = pe.offset(0x5ce1c6), n = 0x5ce26e - 0x5ce1c6;
      let all = true;
      for (const v of [0x41dbf766, 0x41a00069, 0xc2a66b44, 0x43506c4a, 0x418de4f7, 0xc29e3b4a]) if (!hasImm(pe, 0x5ce1c6, 0x5ce26e, v)) all = false;
      ok(all && o > 0 && n > 0, 'FUN_005ce1c6 stores the six intro camera floats');
      ok(INTRO_CAMERA.join() === [0x41dbf766, 0x41a00069, 0xc2a66b44, 0x43506c4a, 0x418de4f7, 0xc29e3b4a].map(hexf).join(), 'INTRO_CAMERA = those floats');
    }
    ok(INTRO_CAMERA.length === 6 && near(INTRO_CAMERA[0], 27.49, 1e-3) && near(INTRO_CAMERA[1], 20, 1e-3) && near(INTRO_CAMERA[2], -83.21, 1e-3) && near(INTRO_CAMERA[3], 208.42, 1e-3) && near(INTRO_CAMERA[5], -79.12, 1e-3), 'intro camera literals (FUN_005ce1c6: eye (27.49, 20, -83.2), target (208.4, 17.7, -79.1))');

    // ============================================================================================================= the zone
    const L0 = loadZone(ctx, 'z09JST');
    const recs0 = L0.world.records;
    ok(checkRecords(recs0).length === 0, `record names: ${checkRecords(recs0).join('; ')}`);
    ok(!L0.hasPlayer && L0.pepper.name === 'PEPP', 'z09JST has no PEPP record: the engine adds an invisible dummy (the duel brings its own player objects)');
    const att = L0.setup.attaches;
    const by = (c) => att.filter((a) => a.ctor === c).map((a) => a.record).sort((a, b) => a - b);
    ok(by(CTOR.JSTGAME).join() === '4' && by(CTOR.FLAG).join() === REC.FLAGS.join() && by(CTOR.ANIMS).join() === [...SPECTATORS].sort((a, b) => a - b).join() && by(CTOR.DRKK).join() === '11', 'attaches: JSTGame on 4, Flag on 5..10, Anims on the eight spectators, Drkk on 11');
    ok(ctorFactory(CTOR.JSTGAME) && ctorFactory(CTOR.FLAG) && ctorFactory(CTOR.ANIMS) && ctorFactory(CTOR.DRKK), 'the four constructors are registered');
    const kinds = (i) => recs0[i].ctrl?.nodes.map((n) => n.kind).join();
    ok(kinds(4) === 'JSTGame' && kinds(5) === 'Flag' && kinds(10) === 'Flag' && kinds(11) === 'Drkk' && SPECTATORS.every((i) => kinds(i) === 'Anims'), 'the nodes of the set-up are attached');
    ok(L0.skipped.every((s) => ['SeaAmin', 'seabed'].includes(s.ctorName)), `no other skipped attach: ${JSON.stringify(L0.skipped.map((s) => s.ctorName))}`);
    ok(recs0[4].ctrl.nodes[0] instanceof JstGameNode && recs0[5].ctrl.nodes[0] instanceof FlagNode && recs0[19].ctrl.nodes[0] instanceof AnimsNode && recs0[11].ctrl.nodes[0] instanceof DrkkNode, 'node classes');
    ok(Object.entries(RIG_OF).length === 25 && Object.entries(NAMES).length === 27 && RIG_OF[15] === 'MFIG' && RIG_OF[12] === 'HORS' && RIG_OF[29] === 'HORS' && RIG_OF[5] === 'LFLG' && RIG_OF[10] === 'BBFG', 'rig table');
    // animations given, start clips, the soldiers hidden
    giveAnimations(L0.world, L0.archive);
    ok(Object.keys(RIG_OF).every((i) => !!recs0[+i].anim), 'every animated record has an instance');
    ok(recs0[23].anim.clip === 0x86 && recs0[24].anim.clip === 0x86 && recs0[19].anim.clip === 0x43 && recs0[20].anim.clip === 0x43 && [21, 22, 25, 26, 27, 28].every((i) => recs0[i].anim.clip === 0x3a) && [5, 6, 7, 8, 9, 10].every((i) => recs0[i].anim.clip === 1) && recs0[15].anim.clip === 1, 'start clips (FUN_005cdb60): bugles 0x86, king / queen 0x43, the others 0x3a, flags 1');
    ok([25, 26, 27, 28].every((i) => recs0[i].flags === 0) && [19, 20, 21, 22].every((i) => recs0[i].enabled), 'the four soldiers are hidden (flags = 0), king / queen visible');
    // every clip number the tables use exists in the rigs
    {
      const nHors = recs0[12].anim.rig.clips.length, nMfig = recs0[15].anim.rig.clips.length;
      ok(tp.slice(0, 19).every((r) => r[0] < nHors && r[1] < nHors && r[2] < nHors && r[3] < nMfig), `player clips exist in HORS.blk (${nHors} clips) / MFIG.blk (${nMfig})`);
      ok(te.slice(0, 19).every((r) => r[0] < nHors && r[1] < nHors && r[2] < nMfig), 'enemy clips exist');
      const used = [0x5e, 0xbe, 0x86, 0x43, 0x3a, 0x9f, 0xd9, 0x48];
      ok(used.every((c) => c < nMfig), `clips used by the zone code exist in MFIG.blk (<= ${Math.max(...used)} of ${nMfig})`);
    }

    // ============================================================================================================= helpers
    const flat = { range: (x) => x / 2 };                       // the wobble is exactly 0, ambient sounds never fire
    const mk = (o = {}) => {
      const L = loadZone(ctx, 'z09JST');
      const snd = { log: [], play2D(i) { this.log.push(`p2 ${i}`); }, stop2D(i) { this.log.push(`s2 ${i}`); }, play3D(i) { this.log.push(`p3 ${i}`); }, rate(i, h) { this.log.push(`r ${i} ${h}`); } };
      const said = [], gearLog = [];
      const S = startDuel({ world: L.world, archive: L.archive, pe: L.pe, sound: snd, say: (a, b) => said.push(b ? `${a}+${b}` : a), stopSpeech: () => said.push('stop'), rng: o.rng ?? new MsvcRng(o.seed ?? 1), onGear: () => {} });
      const og = S.gear.set.bind(S.gear);
      S.gear.set = (r, s, on) => { gearLog.push(`${r}:${s}:${on ? 'on' : 'off'}`); og(r, s, on); };
      return { L, w: L.world, d: S.duel, node: S.node, gear: S.gear, snd, said, gearLog, S };
    };
    const tick = (m, keys = 0) => { m.w.input.setVirtual(keys); m.w.tick(); };
    const until = (m, pred, max = 4000, keysFn = () => 0) => { let n = 0; while (!pred(m.d) && n < max) { tick(m, keysFn(m.d, n)); n++; } return n; };
    const toState = (m, s, keysFn) => until(m, (d) => d.state === s, 4000, keysFn);
    const calls = (m, re) => m.snd.log.filter((l) => re.test(l)).length;

    // ============================================================================================================= B-spline of the camera
    {
      const pts = [[0, 0, 0], [6, 12, -6], [12, 0, 6], [18, 6, 0], [24, 0, 0]];
      const p0 = bspline(pts, 0);
      ok(near(p0[0], (pts[0][0] + 4 * pts[0][0] + pts[1][0]) / 6) && near(p0[1], (pts[0][1] * 5 + pts[1][1]) / 6), 'bspline t = 0: (P0 + 4 P0 + P1) / 6 (the index before 0 is clamped to 0)');
      const pe1 = bspline(pts, 1);
      // t = 1: u = 5, the index is clamped to 4: P[3], P[4], P[4], P[4] with f = 1 (weights 0, 1/6, 4/6, 1/6)
      ok(near(pe1[0], (pts[4][0] + 4 * pts[4][0] + pts[4][0]) / 6) && near(pe1[1], pts[4][1], 1e-6), `bspline t = 1 = the last control point (${pe1.map((v) => v.toFixed(2))})`);
      // partition of unity: constant control points give the constant at every t
      const flatPts = [[3, 4, 5], [3, 4, 5], [3, 4, 5], [3, 4, 5], [3, 4, 5]];
      ok([0, 0.13, 0.5, 0.77, 1].every((t) => bspline(flatPts, t).every((v, k) => near(v, flatPts[0][k], 1e-6))), 'partition of unity: constant points give a constant curve');
      // a mid-point of an interval equals the cubic B-spline value (1/48 weights)
      const mid = bspline(pts, 0.5 / 5 * 1 + 1 / 5 * 1);
      const u = 1.5, i = 1, f = u - i;
      const f3 = f * f * f, b = [(-f3 + 3 * f * f - 3 * f + 1) / 6, (3 * f3 - 6 * f * f + 4) / 6, (-3 * f3 + 3 * f * f + 3 * f + 1) / 6, f3 / 6];
      const ex = [0, 1, 2].map((k) => b[0] * pts[0][k] + b[1] * pts[1][k] + b[2] * pts[2][k] + b[3] * pts[3][k]);
      ok(mid.every((v, k) => near(v, ex[k], 1e-5)), 'bspline interior value = B0 P[i-1] + B1 P[i] + B2 P[i+1] + B3 P[i+2]');
      ok(b.reduce((s, v) => s + v, 0) > 0.999999 && b.reduce((s, v) => s + v, 0) < 1.000001, 'basis weights sum to 1');
      // smooth: successive samples never jump
      let jump = 0, prev = bspline(T.spline.points, 0);
      for (let k = 1; k <= 200; k++) { const q = bspline(T.spline.points, k / 200); jump = Math.max(jump, Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2])); prev = q; }
      ok(jump < 6, `the camera path is continuous (largest step ${jump.toFixed(2)} of 200)`);
    }

    // ============================================================================================================= the mfig manager (fake records)
    {
      const rec = (frames, flags = 0) => {
        const r = new GameRecord('X');
        let frame = 0, clip = 0; const log = [];
        r.anim = {
          get frame() { return frame; }, get clip() { return clip; }, get frameCount() { return frames; }, log,
          start(c, f) { clip = c; frame = f; log.push(`start ${c} ${f}`); return true; },
          seek(f) { log.push(`seek ${f}`); if (f < 0 || f > frames) return false; frame = f; return true; },
          advance(rate) { log.push(`adv ${rate}`); frame += rate; if (frame > frames - 1) { frame -= frames - 1; return 2; } return 0; },
        };
        void flags;
        return r;
      };
      const table = [[1, 2, 3], [4, 5, 6]];
      const pos = [1, 2, 3], rot = [0, 0.5, 0];
      const m = new MfigMan(table, pos, rot);
      const a = rec(10), b = rec(10), c = rec(10), prev = rec(5);
      prev.flags = 2;
      m.recs = [prev];
      m.bind([a, b, c], 1);
      ok((prev.flags & 2) === 0, 'bind hides the records of the previous binding (flag 2 cleared)');
      ok(m.mode === 1 && m.clip.join() === '4,5,6' && a.anim.clip === 4 && b.anim.clip === 5 && c.anim.clip === 6 && a.enabled && c.enabled, 'bind: mode 1, clips of the row, records shown');
      m.setClips(0);
      ok(m.clip.join() === '1,2,3' && c.anim.clip === 3 && c.anim.log.at(-1) === 'start 3 0', 'setClips starts the clips of the row at frame 0');
      const r1 = m.advance(2, 0);
      ok(near(a.x, 1) && near(a.y, 2) && near(a.z, 3), 'advance: the master is placed at the position');
      ok(r1.t === 2 && r1.res === 0 && b.anim.log.at(-1) === 'seek 2' && c.anim.log.at(-1) === 'seek 2' && b.m.every((v, i) => v === a.m[i]) && c.m.every((v, i) => v === a.m[i]), 'mode 1: the frame t = master frame, the other records follow with the same matrix and frame');
      m.advance(7, 0);
      const r2 = m.advance(1, 0);
      // the result in mode 1 is the master's (2 when the master's one-shot ends)
      const a2 = rec(4), b2 = rec(4), c2 = rec(4);
      const m2 = new MfigMan(table, [0, 0, 0], [0, 0, 0]); m2.bind([a2, b2, c2], 0);
      ok(m2.advance(5, 0).res === 2, 'mode 1: result 2 when the master\'s clip ends (asm 0x5f3df7 keeps it in a local)');
      // mode 0: the last record runs on its own
      const a3 = rec(10), b3 = rec(10), c3 = rec(3);
      const m3 = new MfigMan(table, [0, 0, 0], [0, 0, 0]); m3.bind([a3, b3, c3], 0); m3.setMode(0);
      c3.m[12] = 99;
      const r3 = m3.advance(2.5, 0);
      ok(c3.m[12] === 99 && r3.res === 2 && c3.anim.log.at(-1) === 'seek 2', 'mode 0: the last record keeps its matrix, its own animation ends (result 2) and holds on the last frame (seek length - 1)');
      c3.anim.start(1, 0);
      const r4 = m3.advance(2.5, 1);
      ok(r4.res === 2 && c3.anim.log.at(-1) === 'adv 2.5', 'noWrap = 1: no hold on the last frame');
      // seek
      const t = m.seek(3);
      ok(t === 3 && b.anim.log.at(-1) === 'seek 3', 'seek: master and followers on that frame');
      const a5 = rec(10), b5 = rec(10), c5 = rec(10);
      const m5 = new MfigMan(table, [0, 0, 0], [0, 0, 0]); m5.bind([a5, b5, c5], 0); m5.setMode(0);
      m5.seek(6);
      ok(c5.anim.log.at(-1) === 'seek 6', 'mode 0 seek: the last record gets the frame itself');
    }

    // ============================================================================================================= the duel: start, bugle, charge
    {
      const m = mk({ rng: flat });
      const d = m.d;
      ok(d.state === 0 && d.speed === 0 && d.reticle && d.hitsP === 0 && d.hitsE === 0 && d.aimStep === 1, 'constructor: state 0, no charge, marker shown, no points');
      ok(d.pPos.join() === [40, 13, -85].join() && d.ePos.join() === [204, 13, -79].join() && near(d.pRot[1], 1.5700, 1e-4) && near(d.eRot[1], -1.5700, 1e-4), 'start places (40, 13, -85) facing +x, (204, 13, -79) facing -x');
      const R = m.w.records;
      ok(R[REC.HORS].x === 40 && R[REC.JKIT].x === 40 && R[REC.GSAD].x === 40 && R[REC.CLOK].x === 40 && R[REC.DRKH].x === 204 && R[REC.DRKK].x === 204 && R[REC.RSAD].x === 204, 'the player group at x 40, the dark knight group at x 204');
      ok(m.d.player.clip.join() === tp[0].join() && m.d.enemy.clip.slice(0, 3).join() === te[0].slice(0, 3).join(), 'both groups start with row 0');
      ok(m.w.focus === R[REC.JKIT], 'the focus record is the player\'s knight');
      ok(m.gear.has(11, 7) && m.gear.has(11, 9) && m.gear.has(15, 7) && m.gear.has(15, 9), 'both knights carry lance (slot 7) and shield (slot 9) at the start');
      tick(m);
      ok(d.state === 1 && m.node.ran === 1, 'first tick: state 0 -> 1 through the JSTGame node');
      for (let i = 0; i < 20; i++) tick(m);
      ok(d.state === 1, 'state 1 waits for a button');
      tick(m, KEY.UP);
      ok(d.state === 2 && d.speed === 0 && d.reticle && !d.ready, 'a held button starts the bugle (state 2)');
      // bugle length: BUG2's clip 0x86 plays from 0 at 1.0 per tick until the clip ends
      const blk = parseBlk(m.L.archive.read(m.L.archive.find('anim/MFIG.blk')));
      const ref = new AnimInstance(blk); ref.start(0x86, 0);
      let nb = 0, f40 = 0; for (; nb < 2000; nb++) { const fr = Math.trunc(ref.frame); if (fr >= 40 && fr <= 50) f40++; if (ref.advance(1.0) !== 0) { nb++; break; } }
      const n2 = toState(m, 3);
      ok(n2 === nb - 1 || n2 === nb, `bugle lasts ${n2} ticks (the clip ends after ${nb})`);
      ok(calls(m, /^p2 245$/) === f40, `the short fanfare plays on every tick of frames 40..50 (${calls(m, /^p2 245$/)} = ${f40})`);
      ok(m.snd.log.includes('s2 245'), 'the fanfare is stopped when the bugle ends');
      ok(d.player.clip.join() === tp[6].join() && d.enemy.clip.slice(0, 3).join() === te[2].slice(0, 3).join(), 'state 3: player row 6, dark knight row 2');
      ok(d.toggle === 0, 'RIGHT is the first key (toggle 0 when LEFT was not held)');
      ok(calls(m, /^p2 93$/) > 0, 'the wind is played every tick');
    }
    // a held LEFT at the end of the bugle makes LEFT the first key
    {
      const m = mk({ rng: flat });
      tick(m); tick(m, KEY.UP);
      until(m, (d) => d.state === 3, 2000, () => KEY.LEFT);
      ok(m.d.toggle === 1, 'LEFT held when the bugle ends: toggle 1 (LEFT counts first)');
    }

    // ---- charge dynamics, replayed with an independent model
    {
      const m = mk({ rng: flat }), d = m.d;
      tick(m); tick(m, KEY.UP); toState(m, 3);
      ok(d.speed === 0 && d.gauge === 0 && !d.ready, 'charge starts at 0');
      let s = 0, tg = 0, okSeq = true, firstReady = -1, okPitch = true;
      for (let i = 0; i < 90; i++) {
        const keys = i % 2 === 0 ? KEY.RIGHT : KEY.LEFT;     // every tick a fresh press, alternating, RIGHT first
        const wantRate = Math.trunc((Math.trunc(tg) * 0x5bcc) / 0x3c) + 0x5fb4;      // FUN_005d2782 uses the gauge of the tick before
        m.snd.log.length = 0;
        tick(m, keys);
        if (m.snd.log.filter((l) => l.startsWith('r 248 ')).at(-1) !== `r 248 ${wantRate}`) okPitch = false;
        s = f32(s + 1);
        s = f32(s - f32(s * f32(0.0075)));
        if (s < 0) s = 0; if (s > 60) s = 60;
        if (Math.abs(d.speed - s) > 1e-3) okSeq = false;
        if (s > 18 && firstReady < 0) firstReady = i;
        tg = d.gauge;
      }
      ok(okSeq, 'alternating presses: speed += 1 per press, speed -= 0.0075 speed per tick (replayed for 90 ticks)');
      ok(near(tg, d.speed, 1e-6) && d.speed > 30, `the gauge shows the speed (${d.speed.toFixed(2)})`);
      ok(d.ready, 'ready above 18');
      ok(okPitch, 'the power loop pitch = ftol(gauge) * 0x5bcc / 0x3c + 0x5fb4 Hz, set every tick (24500 .. 48000)');
      ok(m.snd.log.filter((l) => l === 'p2 248').length === 1, 'the power loop is played every tick');
    }
    // the same key pressed again does not count; a held key counts once
    {
      const m = mk({ rng: flat }), d = m.d;
      tick(m); tick(m, KEY.UP); toState(m, 3);
      tick(m, KEY.RIGHT);
      const s1 = d.speed;
      tick(m, KEY.RIGHT); tick(m, 0); tick(m, KEY.RIGHT);
      ok(s1 > 0.9 && d.speed < s1, `after RIGHT the next press must be LEFT (a held / repeated RIGHT does not add): ${s1.toFixed(3)} -> ${d.speed.toFixed(3)}`);
      tick(m, KEY.LEFT);
      ok(d.speed > s1 * 0.95, 'LEFT adds');
      // speed limit 60 and a floor of 0
      d.speed = 59.9; d.gauge = 59.9; d.toggle = 0;
      tick(m, KEY.RIGHT);
      ok(d.speed <= 60 && d.speed > 59, `charge is capped at 60 (${d.speed})`);
      d.speed = 0; d.toggle = 0; d.step = 1; d.gauge = 0;
      tick(m, 0);
      ok(d.speed === 0, 'no negative charge');
    }
    // the charge animation: scrubbed with the gauge up to 18, played above 18 (rows 6 / 7)
    {
      const m = mk({ rng: flat }), d = m.d;
      tick(m); tick(m, KEY.UP); toState(m, 3);
      d.speed = 10; d.gauge = 10; d.toggle = 1;
      tick(m, 0);
      ok(d.ready === false && d.player.clip[0] === 4 && Math.abs(m.w.records[REC.HORS].anim.frame - d.gauge) < 0.2, `speed <= 18: the horse is scrubbed to the gauge (clip ${d.player.clip[0]}, frame ${m.w.records[REC.HORS].anim.frame.toFixed(2)} of gauge ${d.gauge.toFixed(2)})`);
      d.speed = 19.5; d.gauge = 19.5;
      tick(m, 0);
      ok(d.ready === true && d.player.clip.join() === tp[7].join(), 'speed > 18: ready, the horse rears (row 7, clip 13)');
      for (let i = 0; i < 60; i++) { d.speed = 25; d.gauge = 25; d.toggle = 1; tick(m, 0); }
      ok(d.player.clip[0] === 13 && d.ready, 'above 18 the rearing clip keeps playing (one-shot restarts)');
      d.speed = 10; d.gauge = 10;
      let guard = 0; while (d.player.clip[0] === 13 && guard++ < 100) { d.speed = 10; d.gauge = 10; tick(m, 0); }
      ok(d.player.clip[0] === 4 && !d.ready, `back below 18 the rearing clip ends and the group goes back to row 6 (${guard} ticks)`);
    }

    // ============================================================================================================= released too early: the dark knight laughs, walks over and throws the player (4, 5, 6, 7)
    {
      const m = mk({ rng: flat }), d = m.d;
      tick(m); tick(m, KEY.UP); toState(m, 3);
      for (let i = 0; i < 10; i++) tick(m, i % 2 ? KEY.LEFT : KEY.RIGHT);
      ok(d.speed < 18 && d.speed > 5 && !d.ready, `10 presses: charge ${d.speed.toFixed(1)}, not ready`);
      m.snd.log.length = 0; m.gearLog.length = 0;
      tick(m, KEY.SPACE);
      ok(d.state === 4 && d.popup === 4 && m.snd.log.includes('s2 248'), 'SPACE with a charge <= 18: state 4, popup 4, the power loop stops');
      const seq = [];
      d.log = seq;
      let guard = 0;
      while (d.state !== 0x21 && guard++ < 1500) tick(m, 0);
      ok(seq.join(' ') === '4>5 5>6 6>7 7>1f 1f>21', `states ${seq.join(' ')}`);
      ok(m.gearLog.join() === '11:7:off,11:9:off', `state 4 -> 5 takes the dark knight's lance and shield away: ${m.gearLog}`);
      ok(d.hitsP === 0 && d.hitsE === 0 && d.score === 0, 'nobody scores');
      ok(!d.reticle && d.gauge === 0, 'the marker is hidden, the gauge back to 0');
      ok(m.snd.log.includes('p2 599') && m.snd.log.includes('p2 597') && m.snd.log.includes('p2 598'), 'the dark knight grabs (597) and throws (598), the player lands (599)');
      ok(m.snd.log.some((l) => l === 'p3 595') && m.snd.log.some((l) => l === 'p3 596'), 'footsteps of the dark knight (595 / 596) while he walks over');
      ok(near(m.w.records[REC.DRKK].x, m.w.records[REC.HORS].x + 3.7, 0.02) || m.w.records[REC.DRKK].x < 50, `the dark knight stands at the horse (x ${m.w.records[REC.DRKK].x.toFixed(2)})`);
      // popup lines of state 4 and the next round
      tick(m, 0); ok(d.state === 0x21, 'popup waits for a button');
      d.log = null; m.gearLog.length = 0;
      tick(m, KEY.UP);
      ok(d.state === 0x22, 'a button press goes on');
      tick(m, 0);
      ok(d.state === 0 && d.hitsP === 0 && d.hitsE === 0 && d.speed === 0 && d.level === 0 && d.reticle, 'state 0x22: next round (state 0, charge 0, level 0)');
      ok(m.gearLog.join() === '11:7:on,11:9:on', 'the dark knight gets his gear back at the round start');
      ok(d.ePos.join() === [204, 13, -79].join() && d.pPos.join() === [40, 13, -85].join(), 'both knights back at their start');
      ok(m.w.records[REC.BUG1].anim.clip === 0x86 && m.w.records[REC.LKNG].anim.clip === 0x43 && m.w.records[REC.BKNG].anim.clip === 0x3a, 'spectator clips restart');
    }

    // ============================================================================================================= the ride and the clash
    const ride = (m, speed, ax, ay, o = {}) => {
      const d = m.d;
      d.state = 9; d.steer = 1; d.speed = speed; d.gauge = speed; d.rider = f32(speed * f32(0.02));
      d.player.setClips(4); d.enemy.setClips(4);
      d.pPos[0] = 40; d.ePos[0] = 204; d.aimX = ax; d.aimY = ay;
      if (o.keys === undefined) o.keys = 0;
      let n = 0;
      m.snd.log.length = 0;
      while (d.state === 9 && n < 3000) { tick(m, o.keys); n++; }
      return n;
    };
    {
      // ride duration: 2 * rider * n > 156 (the knights meet when player.x - enemy.x > -8)
      for (const sp of [20, 30, 45, 60]) {
        const m = mk({ rng: flat });
        const r = f32(sp * f32(0.02));
        const n = ride(m, sp, 0, 0);
        let want = 0, px = 40, ex = 204; while (!(px - ex > -8)) { px = f32(px + r); ex = f32(ex - r); want++; }
        ok(n === want, `speed ${sp}: the ride takes ${n} ticks (model ${want})`);
        ok(near(m.d.rider, r, 1e-6), `rider speed = ${r} at charge ${sp}`);
      }
      // classification by the squared aim distance: < 40 hit, 40..60 glance, > 60 hurt
      const cls = (ax, ay) => { const m = mk({ rng: flat }); ride(m, 30, ax, ay); return m.d.state; };
      ok(cls(0, 0) === 0xb && cls(6.3, 0) === 0xb && cls(0, -6.3) === 0xb, 'aim inside radius sqrt(40) (6.32): player hits (state 0xb)');
      ok(cls(2, 6) === 0xe && cls(6.4, 0) === 0xe && cls(-5, 5) === 0xe && cls(7.74, 0) === 0xe, 'squared distance 40 .. 60 (exactly 40: (2, 6)): glancing blow, nobody scores (0xe)');
      ok(cls(7.75, 0) === 0xc && cls(0, 20) === 0xc && cls(-15, -15) === 0xc, 'squared distance > 60: the dark knight hits (0xc)');
      // the marker is hidden at the clash, the crowd loop stops
      const m = mk({ rng: flat }); ride(m, 30, 1, 1);
      ok(!m.d.reticle && m.snd.log.includes('s2 100') && m.d.popup === 0xb, 'clash: marker off, crowd charge loop stopped, popup state recorded');
      ok(m.d.aimSq === f32(f32(1) + f32(1)), 'aimSq = x^2 + y^2');
      // the crowd loop plays every tick of the ride, the camera mode is 1
      const m2 = mk({ rng: flat });
      m2.d.state = 9; m2.d.steer = 1; m2.d.speed = 30; m2.d.rider = 0.6; m2.d.player.setClips(4); m2.d.enemy.setClips(4);
      for (let i = 0; i < 10; i++) tick(m2);
      ok(calls(m2, /^p2 100$/) === 10 && m2.d.camMode === 1, 'ride: crowd charge loop every tick, camera mode 1');
      // aim keys: 1 unit per tick each, the opposite direction of the screen: UP = y - 1, DOWN = y + 1, LEFT = x - 1, RIGHT = x + 1
      const m3 = mk({ rng: flat }); m3.d.state = 9; m3.d.steer = 0; m3.d.speed = 30; m3.d.rider = 0.1; m3.d.player.setClips(4); m3.d.enemy.setClips(4);
      tick(m3, KEY.UP);
      ok(m3.d.aimY === -1 && m3.d.aimX === 0 && m3.d.steer === 1, 'UP: aim y - 1 (and the drift is off from now on)');
      tick(m3, KEY.DOWN | KEY.LEFT); ok(m3.d.aimY === 0 && m3.d.aimX === -1, 'DOWN + LEFT: y + 1, x - 1');
      tick(m3, KEY.RIGHT); ok(m3.d.aimX === 0, 'RIGHT: x + 1');
      tick(m3, 0); ok(m3.d.aimX === 0 && m3.d.aimY === 0, 'no key after a key: no drift (steer stays 1)');
      // without any key since the start of the ride the aim drifts (+1, -1) per tick
      const m4 = mk({ rng: flat }); m4.d.state = 9; m4.d.steer = 0; m4.d.speed = 30; m4.d.rider = 0.1; m4.d.player.setClips(4); m4.d.enemy.setClips(4);
      for (let i = 0; i < 5; i++) tick(m4, 0);
      ok(m4.d.aimX === 5 && m4.d.aimY === -5, 'drift without keys: +1 / -1 per tick');
      // the wobble: uniform in [-s, s), s = (speed / 16 + 1) / 1.4; the pull-back beyond 20 (the original compares both sides with +20)
      const w = mk({ rng: { range: (x) => (x > 100 ? 0 : 0) } });
      w.d.state = 9; w.d.steer = 1; w.d.speed = 60; w.d.rider = 0.1; w.d.player.setClips(4); w.d.enemy.setClips(4); w.d.aimX = 0; w.d.aimY = 0;
      tick(w, 0);
      const sMax = f32(f32(60 * 0.0625 + 1) / 1.4);
      ok(near(w.d.aimX, sMax, 1e-4) && near(w.d.aimY, sMax, 1e-4), `rand = 0 gives the full +s = ${sMax.toFixed(4)} in both axes (${w.d.aimX})`);
      const w2 = mk({ rng: { range: (x) => x } });
      w2.d.state = 9; w2.d.steer = 1; w2.d.speed = 60; w2.d.rider = 0.1; w2.d.player.setClips(4); w2.d.enemy.setClips(4);
      tick(w2, 0);
      ok(near(w2.d.aimX, -sMax, 1e-4), 'rand = max gives -s');
      // pull-back: aim x = 30 > 20 with a positive step: step -= x / 10
      const w3 = mk({ rng: { range: () => 0 } });
      w3.d.state = 9; w3.d.steer = 1; w3.d.speed = 0; w3.d.rider = 0.1; w3.d.player.setClips(4); w3.d.enemy.setClips(4); w3.d.aimX = 30; w3.d.aimY = 0;
      tick(w3, 0);
      const s0 = f32(1 / 1.4);
      ok(near(w3.d.aimX, 30 + (s0 - 3), 1e-4), `above 20 a positive step is reduced by x / 10 (${w3.d.aimX.toFixed(4)})`);
      // the original compares the negative step with +20 too: aim x = 5 and a negative step: step - x / 10
      const w4 = mk({ rng: { range: (x) => x } });
      w4.d.state = 9; w4.d.steer = 1; w4.d.speed = 0; w4.d.rider = 0.1; w4.d.player.setClips(4); w4.d.enemy.setClips(4); w4.d.aimX = 5; w4.d.aimY = 0;
      tick(w4, 0);
      ok(near(w4.d.aimX, 5 + (-s0 - 0.5), 1e-4), `a negative step below x = 20 gets x / 10 more (${w4.d.aimX.toFixed(4)})`);
    }

    // ---- hoofbeats: class by charge, sound by the frame of the gallop
    {
      const m = mk({ rng: flat }), d = m.d;
      const exp = (sp, f) => {
        const set = sp <= 40 ? (sp <= 30 ? S3D.HOOF_SLOW : S3D.HOOF_MID) : S3D.HOOF_FAST;
        if (f < 12) { if (f < 11) { if (f < 10) return f > 3 && f < 7 ? set[0] : null; return set[1]; } return set[2]; } return set[3];
      };
      let allOk = true, count = 0;
      for (const sp of [20, 30, 31, 40, 41, 60]) for (let f = 0; f < 16; f++) {
        d.speed = sp; m.snd.log.length = 0; d.hooves(f);
        const want = exp(sp, f), got = m.snd.log.filter((l) => l.startsWith('p3 ')).map((l) => +l.slice(3));
        if (want === null ? got.length !== 0 : got.length !== 1 || got[0] !== want) allOk = false;
        count++;
      }
      ok(allOk, `hoofbeat sound by speed class (<= 30 slow, <= 40 mid, else fast) and gallop frame (${count} combinations)`);
    }

    // ============================================================================================================= the outcomes: scoring and the four reactions of each
    {
      const mkHit = (variant, speed = 40, ax = 3, ay = 4) => {
        const m = mk({ rng: flat }); ride(m, speed, ax, ay); m.d.variant = variant; return m;
      };
      // score: speed bonus = ftol(2 * speed), precision = ftol(40 - aimSq) (min 1), round points = product, total += points
      {
        const m = mkHit(0, 40, 3, 4);                          // aimSq 25
        const d = m.d, sp = d.speed;
        tick(m);
        ok(d.bonusSpeed === Math.trunc(sp * 2) && d.precision === 15 && d.roundPts === d.bonusSpeed * 15 && d.score === d.roundPts && d.hitsP === 1, `hit: speed bonus ${d.bonusSpeed} x precision ${d.precision} = ${d.roundPts}, total ${d.score}`);
        ok(d.level === 1 && m.snd.log.includes('p2 96') && m.snd.log.includes('p3 101') && m.snd.log.includes('p3 90'), 'hit: level 1, crowd cheers (96), lance hit (101), the dark knight\'s horse (90)');
        ok(d.enemy.mode === 0 && d.r1 === 1, 'the dark knight\'s group goes to mode 0 (the knight alone), rate 1.0');
        ok(d.camMode === 9 && d.state === 0xf && m.said.at(-1) === 'CASGJO11', `variant 0: camera 9, state 0xf, speech ${m.said.at(-1)}`);
        ok(m.snd.log.includes('p3 105'), 'the lance twang (105) at the dark knight');
      }
      {
        const m = mkHit(1, 40, 6, 0); const d = m.d; tick(m);             // aimSq 36: precision 4
        ok(d.precision === 4 && d.bonusSpeed === 80 + 0 || d.precision === 4, `precision ${d.precision} for aimSq 36`);
        ok(d.camMode === 10 && d.state === 0x11 && d.enemy.clip[2] === te[0xc][2] && m.said.at(-1) === 'CASGJO11', 'variant 1: camera 10, state 0x11, enemy row 0xc');
      }
      {
        const m = mkHit(2, 40, 0, 0); const d = m.d; tick(m);              // aimSq 0: precision 40
        ok(d.precision === 40 && d.camMode === 0xb && d.state === 0x12 && d.enemy.clip[2] === te[0xd][2] && m.said.at(-1) === 'CASGJO10', 'variant 2: precision 40, camera 0xb, state 0x12, speech CASGJO10');
      }
      {
        const m = mkHit(3, 40, 6.3, 0); const d = m.d; tick(m);            // aimSq 39.69: ftol(0.31) = 0 -> 1
        ok(d.precision === 1 && d.camMode === 0xc && d.state === 0x13 && d.enemy.clip[2] === te[5][2] && m.said.at(-1) === 'CASGJO12', 'variant 3: precision floor 1 (aimSq 39.69), camera 0xc, state 0x13, speech CASGJO12');
      }
      // the dark knight hits (0xc): level 2, +1 for him, four reactions
      for (const [v, st, cam, row, say] of [[0, 0x16, 3, 0xb, 'CASGJO07'], [1, 0x18, 5, 0xc, 'CASGJO07'], [2, 0x19, 6, 0xd, 'CASGJO08'], [3, 0x1a, 7, 5, 'CASGJO07']]) {
        const m = mk({ rng: flat }); ride(m, 30, 20, 20); m.d.variant = v; const d = m.d;
        ok(d.state === 0xc, 'setup: the dark knight hits');
        tick(m);
        ok(d.level === 2 && d.hitsE === 1 && d.hitsP === 0 && d.state === st && d.camMode === cam && d.player.clip[0] === tp[row][0] && m.said.at(-1) === say && d.player.mode === 0 && d.bonusSpeed === 0 && d.roundPts === 0,
          `hurt variant ${v}: state 0x${st.toString(16)}, camera ${cam}, row ${row}, speech ${say}`);
        ok(m.snd.log.includes('p2 97') && m.snd.log.includes('p3 102') && m.snd.log.includes('p3 88'), 'crowd boos (97), the dark knight\'s lance (102), the player\'s horse (88)');
      }
      // glance: 0xe -> both mode 0, state 0x20, camera 0xf, level 3, the spectators on clip 0x48
      {
        const m = mk({ rng: flat }); ride(m, 30, 7, 0); const d = m.d;
        ok(d.state === 0xe, 'setup: glancing blow');
        tick(m);
        ok(d.state === 0x20 && d.camMode === 0xf && d.level === 3 && d.hitsP === 0 && d.hitsE === 0 && d.player.mode === 0 && d.enemy.mode === 0 && m.said.at(-1) === 'CASGJO09' && m.w.records[REC.LKNG].anim.clip === 0x48, 'glance: state 0x20, camera 0xf, level 3, speech CASGJO09, spectators on clip 0x48');
        const seq = []; d.log = seq;
        let guard = 0; while (d.state !== 0x21 && guard++ < 800) tick(m, 0);
        ok(seq.join(' ') === '20>1f 1f>21', `0x20 ends at the pass (x > 190): ${seq.join(' ')}`);
        ok(d.hitsP === 0 && d.hitsE === 0 && d.popup === 0xe, 'no points, the popup is the glance popup');
      }
      // every reaction runs to the popup within a bounded time and ends with the knights on their spots
      for (const [kind, ax] of [['hit', 0], ['hurt', 25]]) for (let v = 0; v < 4; v++) {
        const m = mk({ rng: flat }); ride(m, 35, ax, 0); m.d.variant = v; const d = m.d;
        const n = until(m, (x) => x.state === 0x21, 1500);
        ok(d.state === 0x21 && n < 1200, `${kind} reaction ${v} reaches the popup in ${n} ticks`);
        ok(m.d.gauge === 0, 'gauge 0 at the popup');
      }
    }
    // spectators advance only at levels 1..3 (Anims nodes), flags always (Flag nodes)
    {
      const m = mk({ rng: flat }), R = m.w.records;
      const f0 = R[REC.BKNG].anim.frame, g0 = R[5].anim.frame;
      tick(m); tick(m);
      ok(R[REC.BKNG].anim.frame === f0 && R[5].anim.frame > g0, 'level 0: the spectators stand, the flags wave');
      m.d.level = 1; tick(m); tick(m);
      ok(R[REC.BKNG].anim.frame > f0, 'level 1: the spectators cheer');
      const f1 = R[REC.BKNG].anim.frame; m.d.level = 4; tick(m);
      ok(R[REC.BKNG].anim.frame === f1, 'level 4: nobody moves');
      // the spectators face the knights (FUN_005ce3a0): LKNG / LQUN / LSD1 / LSD2 the player, the B* the dark knight
      const k = R[REC.LKNG], jk = R[REC.JKIT];
      const yaw = Math.atan2(k.x - jk.x, k.z - jk.z) + Math.PI;
      ok(near(k.m[10], Math.cos(yaw), 1e-4) && near(k.m[2], -Math.sin(yaw), 1e-4), `the king turns to the player: yaw ${yaw.toFixed(3)}`);
    }
    // the HUD counters change when a round ends (state 0x1f), not before
    {
      const m = mk({ rng: flat }), d = m.d;
      ride(m, 30, 0, 0); d.variant = 2;
      tick(m);
      ok(d.hitsP === 1 && d.shown.hitsP === 0 && d.shown.score === 0, 'during the reaction the HUD still shows 0 / 0 / 0');
      until(m, (x) => x.state === 0x21, 1500);
      ok(d.shown.hitsP === 1 && d.shown.score === d.score && d.score > 0, 'at the end of the round (0x1f) the counters are refreshed');
    }

    // ============================================================================================================= the end of the match: medals, speech, variables
    {
      const finish = (hp, he, vars = new GameVars(), score = 4321) => {
        const m = mk({ rng: flat });
        m.w.vars.a.set(vars.a);
        const d = m.d;
        d.hitsP = hp; d.hitsE = he; d.score = score; d.state = 0x22;
        tick(m);
        return m;
      };
      const gold = finish(3, 0), silver = finish(3, 1), bronze = finish(3, 2), lost = finish(0, 3), lost2 = finish(2, 3);
      ok(gold.d.result === 1 && gold.d.medal === 3 && silver.d.medal === 2 && bronze.d.medal === 1 && silver.d.result === 1 && bronze.d.result === 1, 'win with 0 / 1 / 2 points of the dark knight: gold / silver / bronze');
      ok(lost.d.result === 2 && lost.d.medal === 0 && lost2.d.result === 2 && lost2.d.medal === 0, 'loss: result 2, no medal');
      ok(gold.said.join('|') === 'stop|CASGJO01+CASGJO02' && silver.said.join('|') === 'stop|CASGJO03' && bronze.said.join('|') === 'stop|CASGJO04' && lost.said.join('|') === 'stop|CASGJO05+CASGJO06', `speech: gold ${gold.said}, silver ${silver.said}, bronze ${bronze.said}, loss ${lost.said}`);
      ok(gold.w.vars.get(VAR.HISCORE) === 4321 && gold.w.vars.get(VAR.TROPHY) === 3 && silver.w.vars.get(VAR.TROPHY) === 2 && bronze.w.vars.get(VAR.TROPHY) === 1 && lost.w.vars.get(VAR.TROPHY) === 0, 'variables: hi-score 0x18 and trophy 0xcb written');
      ok(lost.w.vars.get(VAR.HISCORE) === 4321, 'a lost match still counts its score as the hi-score (the original writes it at the end whatever the result)');
      // only raised
      const v = new GameVars(); v.set(VAR.HISCORE, 9000); v.set(VAR.TROPHY, 3);
      const worse = finish(3, 2, v, 100);
      ok(worse.w.vars.get(VAR.HISCORE) === 9000 && worse.w.vars.get(VAR.TROPHY) === 3 && worse.d.medal === 1, 'hi-score and trophy are only ever raised');
      // the end tableau, sounds, camera, gear
      ok(gold.d.state === 0x23 && gold.d.camMode === 0xe && near(gold.d.ang, 1.5708, 1e-3) && near(lost.d.ang, 5.7, 1e-4), 'state 0x23, camera 0xe, angle 1.5708 (won) / 5.7 (lost)');
      ok(gold.snd.log.includes('p2 98') && gold.snd.log.includes('p2 246') && lost.snd.log.includes('p2 99') && !lost.snd.log.includes('p2 98'), 'sounds: crowd wins (98) + medium fanfare (246) / crowd loses (99)');
      ok(gold.gearLog.slice(-2).join() === '11:7:off,11:9:off' && lost.gearLog.slice(-2).join() === '15:7:off,15:9:off', `gear: the dark knight loses lance and shield when he is beaten, the player when he loses (${gold.gearLog.slice(-2)} / ${lost.gearLog.slice(-2)})`);
      const R = gold.w.records, tt = T.end;
      ok(near(R[REC.JKIT].x, tt[0][0]) && near(R[REC.DRKK].x, tt[2][0]) && near(gold.d.pPos[0], tt[1][0]) && near(gold.d.ePos[0], tt[3][0]) && near(gold.d.pRot[1], tt[1][3]) && near(gold.d.eRot[1], tt[3][3]), 'won: knights on rows 0..3 of the tableau');
      const R2 = lost.w.records;
      ok(near(R2[REC.JKIT].x, tt[4][0]) && near(R2[REC.DRKK].x, tt[6][0]) && near(lost.d.pPos[0], tt[5][0]) && near(lost.d.ePos[0], tt[7][0]) && near(lost.d.eRot[1], tt[7][3]), 'lost: rows 4..7');
      ok(gold.d.player.mode === 0 && gold.d.enemy.mode === 0 && gold.d.player.clip[0] === tp[0x11][0] && gold.d.enemy.clip[2] === te[0x12][2] && lost.d.player.clip[0] === tp[0x12][0] && lost.d.enemy.clip[2] === te[0x11][2], 'won: player row 0x11 / enemy row 0x12; lost: the other way round');
      // state 0x23 keeps the knights animated, the angle grows by 0.009
      const a0 = gold.d.ang; tick(gold); tick(gold);
      ok(near(gold.d.ang, a0 + 0.018, 1e-3) && gold.d.finalShown && gold.d.state === 0x23, 'state 0x23: the camera angle grows by 0.009 per tick');
      // the match goes on below 3 points each
      const mid = mk({ rng: flat }); mid.d.hitsP = 2; mid.d.hitsE = 2; mid.d.state = 0x22; tick(mid);
      ok(mid.d.result === 0 && mid.d.state === 0, '2:2 -> the next round');
    }
    // the camera modes
    {
      const m = mk({ rng: flat }), d = m.d, c = m.w.camera.c, R = m.w.records;
      const set = (mode) => { d.camera(mode); return [...c].slice(0, 6); };
      c.set([0, 0, 0, 0, 0, 0]);
      let v = set(3); ok(v[3] === R[REC.DRKK].x && v[4] === R[REC.DRKK].y && v[5] === R[REC.DRKK].z, 'camera 3: target = the dark knight');
      v = set(4); ok(v[3] === R[REC.DRKK].x, 'camera 4: the same');
      c[0] = 100; v = set(6); ok(near(v[3], R[REC.JKIT].x) && near(v[4], R[REC.JKIT].y + 8) && near(v[1], hexf(0x41c66666)) && near(v[0], 100 + d.speed * 0.03125), 'camera 6: target = player + 8, eye y 24.8, eye x moves by speed / 32 (below 245)');
      c[0] = 250; v = set(6); ok(v[0] === 250, 'camera 6: eye x stops at 245');
      {
        // modes 5 and 10: bone 0 of the knight's pose in MODEL space (the draw poses with the identity root), x = the record's x + 64 / + 200, y doubled
        R[REC.JKIT].anim.start(170, 3);
        const b0 = d.player.boneLocal(0);
        v = set(5);
        ok(near(v[3], R[REC.JKIT].x + 64) && near(v[4], 2 * b0[1], 1e-4) && near(v[5], b0[2], 1e-4) && b0[1] > 2, `camera 5: target (player x + 64, 2 * bone 0 y, bone 0 z) = (${v[3].toFixed(1)}, ${v[4].toFixed(2)}, ${v[5].toFixed(2)})`);
        R[REC.DRKK].anim.start(0x5e, 2);
        const e0 = d.enemy.boneLocal(0);
        c[2] = -90; c[0] = 100;
        v = set(10);
        ok(near(v[3], R[REC.DRKK].x + 200) && near(v[4], 2 * e0[1], 1e-4) && near(v[5], e0[2], 1e-4), 'camera 10: target (dark knight x + 200, 2 * bone 0 y, bone 0 z)');
      }
      v = set(7); ok(near(v[4], R[REC.DRKK].y + 8), 'camera 7: dark knight + 8');
      c[0] = 100; v = set(8); ok(near(v[0], 100.55, 1e-5), 'camera 8: eye x + 0.55 below 170'); c[0] = 171; v = set(8); ok(v[0] === 171, 'camera 8: stops at 170');
      d.speed = 32; c[0] = 100; v = set(9); ok(near(v[2], -68) && near(v[0], 101) && near(v[4], R[REC.JKIT].y + 8), 'camera 9: eye z -68, eye x + speed / 32 below 240');
      c[0] = 100; c[2] = -90; v = set(10); ok(near(v[2], -89.7, 1e-5) && near(v[0], 99.7, 1e-5), 'camera 10: eye z + 0.3 and x - 0.3 below z -75'); c[2] = -70; c[0] = 100; v = set(10); ok(v[2] === -70 && v[0] === 100, 'camera 10: stops above -75');
      d.speed = 40; c[0] = 100; v = set(0xb); ok(near(v[4], R[REC.DRKK].y + 4) && near(v[1], hexf(0x41c66666)) && near(v[0], 100 - 40 * 0.03125 * 0.5, 1e-5), 'camera 0xb: dark knight + 4, eye x - speed / 64 above 50');
      c[0] = 40; v = set(0xb); ok(v[0] === 40, 'camera 0xb: stops at 50');
      v = set(0xc); ok(near(v[4], R[REC.JKIT].y + 8), 'camera 0xc: player + 8');
      c[0] = 100; c[2] = -90; v = set(0xd); ok(near(v[0], 99.45, 1e-5) && near(v[2], -89.4, 1e-5), 'camera 0xd: x - 0.55, z + 0.6 above x 60'); c[0] = 50; v = set(0xd); ok(v[0] === 50, 'camera 0xd: stops at 60');
      d.ang = 0.5; v = set(0xe);
      const l = R[REC.LKNG];
      ok(v[0] === 120 && v[1] === 20 && v[2] === -82 && near(v[3], l.x + Math.sin(0.5) * l.x, 1e-4) && near(v[4], l.y - 16) && near(v[5], l.z - Math.cos(0.5) * l.z, 1e-4), 'camera 0xe: eye (120, 20, -82), target = king with the angle mixed in');
      v = set(0xf); ok(v[3] === R[REC.BQUN].x && v[4] === R[REC.BQUN].y && v[5] === R[REC.BQUN].z, 'camera 0xf: the black queen');
      // mode 0: follow point behind the player (-5, 8.35, -12.5), y 20, z - 3.2 + gauge / 15, the dark knight's bone 10, smoothed by a quarter
      d.gauge = 30; d.camMode = 0; d.camEye = [0, 0, 0]; d.camTgt = [0, 0, 0];
      d.camera(0);
      const fp = R[REC.JKIT].toWorld(T.spline.follow);
      ok(near(d.camA[0], fp[0], 1e-4) && d.camA[1] === 20 && near(d.camA[2], fp[2] - f32(3.2) + 30 / 15, 1e-4), `mode 0 follow point (${d.camA.map((x) => x.toFixed(2))})`);
      ok(near(d.camEye[0], d.camA[0] * 0.25, 1e-4) && near(d.camTgt[0], d.camB[0] * 0.25, 1e-4), 'mode 0: the smoothed eye / target move a quarter of the way');
      ok(c[0] === 0 && c[3] === 0, 'mode 0: the camera takes the values of the last tick (one tick behind)');
      // mode 1: the spline made once, then evaluated; the target is the player master minus 0.4 x (player - enemy) + 6.4 up
      d.pPos[0] = 100; d.ePos[0] = 160; d.rider = 0.5;
      d.player.advance(0, 1); d.enemy.advance(0, 1);
      d.splineMade = false; d.camera(1);
      ok(d.splineMade && near(d.splineRate, 1 / ((160 - 100) * 0.5 / 0.5), 1e-5) && d.splineT === 0, 'mode 1, first call: spline made, rate = 1 / ((enemy.x - player.x) / 2 / rider)');
      const last = m.d.host.spline.points.at(-1);
      const Pm = d.player.master, Em = d.enemy.master;
      ok(near(last[0], (Pm.x - Em.x) * 0.5 + 184) && near(last[1], (Pm.y - Em.y) * 0.5 + 24) && near(last[2], (Pm.z - Em.z) * 0.5 - 96), 'the fifth control point = half the knights\' distance + (184, 24, -96)');
      d.camera(1);
      const p0 = bspline(m.d.host.spline.points, 0);
      ok(near(c[0], p0[0], 1e-4) && near(c[3], Pm.x - (Pm.x - Em.x) * 0.4, 1e-4) && near(c[4], Pm.y - (Pm.y - Em.y) * 0.4 + 6.4, 1e-4) && d.splineT > 0, 'mode 1: the eye on the B-spline, the target 40% of the way to the dark knight, 6.4 up');
      const t1 = d.splineT; for (let i = 0; i < 4000; i++) d.camera(1);
      ok(d.splineT >= 1 && d.splineT < 1 + d.splineRate + 1e-6, `the spline parameter stops at 1 (${d.splineT})`);
      d.camera(0);
      ok(!d.splineMade && t1 > 0, 'mode 0 frees the spline');
    }

    // ============================================================================================================= whole matches with scripted keys through the engine tick
    const play = (style, seed, ready = 40, max = 9000) => {
      const m = mk({ seed });
      let n = 0;
      for (; n < max && !m.d.result; n++) { tick(m, jstKeys(m.d, style, n, { ready })); }
      return { m, n };
    };
    {
      const { m, n } = play('win', 1);
      const d = m.d;
      ok(d.result === 1 && d.hitsP === 3 && d.hitsE < 3 && d.medal === 3 - d.hitsE, `WIN: 3 points to ${d.hitsE} after ${n} ticks, medal ${d.medal}`);
      ok(d.score > 3000 && d.score < 14000, `WIN: score ${d.score}`);
      ok(m.w.vars.get(VAR.HISCORE) === d.score && m.w.vars.get(VAR.TROPHY) === d.medal, 'WIN: variables');
      ok(d.state === 0x23, 'WIN: the match ends in state 0x23');
      // the score is the sum of the rounds (speed bonus x precision), every hit round counted once
      ok(m.said.at(-1) === ['CASGJO01+CASGJO02', 'CASGJO03', 'CASGJO04'][d.hitsE], `WIN: result speech ${m.said.at(-1)}`);
    }
    {
      // a deterministic scripted win over several seeds: every seed wins in the end
      let wins = 0, tot = 0;
      for (const seed of [2, 3, 4, 5, 6, 7]) { const { m } = play('win', seed, 40, 9000); tot++; if (m.d.result === 1) wins++; }
      ok(wins === tot, `WIN: the bot wins every seed (${wins}/${tot})`);
    }
    {
      const { m, n } = play('loss', 11);
      const d = m.d;
      ok(d.result === 2 && d.hitsE === 3 && d.hitsP < 3 && d.medal === 0, `LOSS: the dark knight scores 3 after ${n} ticks (player ${d.hitsP})`);
      ok(m.w.vars.get(VAR.TROPHY) === 0 && d.state === 0x23, 'LOSS: no trophy, state 0x23');
      ok(m.said.at(-1) === 'CASGJO05+CASGJO06', 'LOSS: the knights\' verdict');
    }
    {
      // a bot that keeps a glancing aim (7.5 off): rounds end 0xe, nobody scores, the match never ends
      const m = mk({ rng: flat });
      const seq = [];
      m.d.log = seq;
      for (let n = 0; n < 2600; n++) tick(m, jstKeys(m.d, 'glance', n, { ready: 40 }));
      const rounds = seq.filter((s) => s.endsWith('>21')).length;
      const glances = seq.filter((s) => s === '9>e').length, hits = seq.filter((s) => s === '9>b').length, hurts = seq.filter((s) => s === '9>c').length;
      ok(rounds >= 3 && glances >= 2, `GLANCE: ${rounds} rounds, ${glances} glancing blows, ${hits} hits, ${hurts} hurts`);
      ok(m.d.result === 0 && m.d.hitsP === 0 && m.d.hitsE === 0, 'GLANCE: nobody scored, no result');
      ok(m.d.hitsP === hits && m.d.hitsE === hurts, 'GLANCE: points match the outcomes');
    }
    {
      // SPACE too early, over and over: never a point for anybody
      const m = mk({ seed: 31 });
      const seq = [];
      m.d.log = seq;
      for (let n = 0; n < 4000; n++) tick(m, jstKeys(m.d, 'slow', n));
      ok(seq.filter((s) => s === '7>1f').length >= 6 && m.d.hitsP === 0 && m.d.hitsE === 0 && m.d.result === 0, `TOO SLOW: ${seq.filter((s) => s === '7>1f').length} thrown-off rounds, no points`);
    }
    // the JSTGame node is the only thing that ticks the duel: no node, no progress
    {
      const m = mk({ rng: flat });
      m.node.duel = null;
      for (let i = 0; i < 5; i++) tick(m);
      ok(m.d.ticks === 0 && m.d.state === 0, 'the duel runs only through the JSTGame node');
    }

    // ============================================================================================================= the zone game's pure parts
    {
      // the marker FUN_005d2814: 2 marks x 8 lines; the short part of a side is the INTEGER size / 3 (6 for 20, 10 for 30); white 20, yellow 30 (red inside sqrt(40)); not in the modes 3 / 9
      const segs = markLines(100, 100, 20, 0xffffffff);
      ok(segs.length === 8 && segs.every((s) => Math.abs(s.x0 - 100) <= 20 && Math.abs(s.x1 - 100) <= 20 && Math.abs(s.y0 - 100) <= 20 && Math.abs(s.y1 - 100) <= 20), 'marker: 8 corner segments within +-20');
      ok([segs[0].x0, segs[0].y0, segs[0].x1, segs[0].y1].join() === [80, 94, 80, 80].join() && [segs[3].x0, segs[3].y0, segs[3].x1, segs[3].y1].join() === [120, 80, 120, 94].join() && [segs[4].x0, segs[4].y0, segs[4].x1, segs[4].y1].join() === [120, 106, 120, 120].join(), 'marker segments: the short part is the int 20 / 3 = 6 at the corners');
      const L = reticleLines(300, 200, 3, 4), M = reticleLines(300, 200, 7, 0);
      ok(L.length === 16 && L[0].color === 0xffffffff && L[8].color === 0xffff0000 && M[8].color === 0xffffff00, 'marker: 16 lines, white fixed marks, the aim marks red inside the squared radius 40 (3^2 + 4^2 = 25), else yellow (49)');
      ok(L[8].x0 === 300 + 3 - 30 && L[8].y0 === 200 + 4 - 10 && L[8].y1 === 200 + 4 - 30, 'marker: the aim marks are centred on the projected point + the aim, short part 30 / 3 = 10');
      ok(reticleMode(2) && reticleMode(1) && reticleMode(4) && !reticleMode(3) && !reticleMode(9), 'marker: drawn in every loop mode except 3 (pause) and 9 (controls help)');
    }
    // the sound layer on a fake sound engine: every sound of FUN_005d24b0 is loaded (17 2D with load2D, 26 3D with load3D) and the calls reach the engine
    {
      const calls2 = [];
      const loaded = { l2: [], l3: [] };
      const fake = { sfx: {
        load2D: async (id) => { loaded.l2.push(id); return { id, kind: '2d' }; }, load3D: async (id) => { loaded.l3.push(id); return { id, kind: '3d' }; },
        play2D: (s) => calls2.push(`p2 ${s.id}`), play3D: (s, p) => calls2.push(`p3 ${s.id} ${p.x},${p.y},${p.z}`), stop: (s) => calls2.push(`st ${s.id}`), setRate: (s, hz) => calls2.push(`rate ${s.id} ${hz}`),
        setListener: (p, f, u) => calls2.push(`ls ${p.x},${p.y},${p.z} ${f.x.toFixed(2)},${f.y.toFixed(2)},${f.z.toFixed(2)} ${u.y}`),
      } };
      const js = new JoustSound(fake);
      js.play2D(0x5d);
      ok(calls2.length === 0, 'before the sounds are loaded nothing is played');
      await js.load();
      ok(loaded.l2.length === 17 && loaded.l3.length === 26 && ALL_2D.length === 17 && ALL_3D.length === 26 && new Set([...loaded.l2, ...loaded.l3]).size === 43, '17 2D + 26 3D sounds are loaded');
      ok(loaded.l2.includes(0x255) && loaded.l2.includes(0x256) && loaded.l2.includes(0x257) && !loaded.l3.includes(0x255), 'GRAB / THROW / LAND are 2D sounds (FUN_00443580), BLKWALK 3D');
      js.play2D(0xf8); js.rate(0xf8, 30000); js.play3D(0x4e, [1, 2, 3]); js.stop2D(0x5d); js.listener([0, 0, 0], [0, 0, 10]);
      ok(calls2.join('|') === 'p2 248|rate 248 30000|p3 78 1,2,3|st 93|ls 0,0,0 0.00,0.00,1.00 1', `sound calls: ${calls2.join('|')}`);
      const mute = new JoustSound(null);
      await mute.load(); mute.play2D(1); mute.play3D(1, [0, 0, 0]);
      ok(mute.ready, 'without audio everything is a no-op');
    }
    // the bot helper: keys by state
    {
      ok(jstKeys({ state: 1 }) === KEY.UP && jstKeys({ state: 3, gauge: 10 }, 'win', 0) === KEY.RIGHT && jstKeys({ state: 3, gauge: 10 }, 'win', 1) === KEY.LEFT && jstKeys({ state: 3, gauge: 50 }, 'win', 1) === KEY.SPACE, 'bot: any key in 1, alternating RIGHT / LEFT in 3, SPACE when charged');
      ok(jstKeys({ state: 9, aimX: 5, aimY: -5 }) === (KEY.LEFT | KEY.DOWN) && jstKeys({ state: 9, aimX: 0, aimY: 0 }) === 0, 'bot: steers the aim to the centre in 9');
    }
    notes.push(`records ${Object.keys(NAMES).length}, rigs ${Object.keys(RIG_OF).length}, start clips ${START_CLIPS.length} groups`);
    return { checked, failures, notes };
  },
};
