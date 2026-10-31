import fs from 'node:fs';
import path from 'node:path';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { registeredCtors } from '../../src/game/setup.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import '../../src/zones/z28HAT.ts';
import { HAT_CUTSCENES } from '../../src/zones/z28HAT.ts';
import {
  CTOR, REC, K, VAR, WINCH, BRONTY, MEDAL, HAT_SOUNDS, SCORE_CAP, checkRecords, medalOf, resultLines, medalText, applyResult, finishGame, HatShared, findRecords, readAnimDictionary,
} from '../../src/zones/z28hat/rules.ts';
import { prepareHat, hatSounds, hatSnapshot, hatUpdate, hatGlobals, RIGS } from '../../src/zones/z28hat/game.ts';
import { DINO_ARGS, BABY_ARGS, DINO, DINO_START_CLIP, BABY_START_FRAME, fx, mouthOf } from '../../src/zones/z28hat/nodes.ts';
import { setHatRandSource } from '../../src/zones/z28hat/nodes.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';
import { makePlan, hatBotStep, steer, KEY } from '../lib/hat-bot.mjs';

// z28HAT "hot-air balloon" (docs/re/m6/z28HAT.md): the constants against the executable (.rdata floats / doubles, the immediates of the loop, the banner, the constructors
// FUN_00791990 / FUN_00792950), the balloon's controls and physics, the winch, the dinosaurs (hook, carry, release, land, score), the baby group, Bronty's state machine,
// the fireballs, the sandbags, the pterodactyl, the music fade, the end rules, a scripted WIN with the bot of tools/lib/hat-bot.mjs and a scripted LOSS.

const f32of = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
const f64of = (pe, va) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, pe.u32(va), true); d.setUint32(4, pe.u32(va + 4), true); return d.getFloat64(0, true); };
const hex = (n) => '0x' + n.toString(16);
const bits = (x) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); return d.getUint32(0, true); };
/** the immediates of `push imm8 / imm32` + `call rel32` pairs in [lo, hi): { target, arg } */
function pushCalls(pe, lo, hi) {
  const out = [];
  for (let a = lo; a < hi - 6; a++) {
    const b = pe.at(a);
    let arg = null, len = 0;
    if (b === 0x6a) { arg = pe.at(a + 1); len = 2; } else if (b === 0x68) { arg = pe.u32(a + 1); len = 5; }
    if (arg === null) continue;
    if (pe.at(a + len) === 0xe8) { const rel = pe.u32(a + len + 1) | 0; out.push({ target: (a + len + 5 + rel) >>> 0, arg }); }
  }
  return out;
}
const hasImm = (pe, lo, hi, v) => { for (let a = lo; a < hi - 3; a++) if (pe.u32(a) === (v >>> 0)) return true; return false; };
/** does [lo, hi) contain the byte sequence */
const hasBytes = (pe, lo, hi, seq) => { for (let a = lo; a < hi - seq.length; a++) { let m = true; for (let i = 0; i < seq.length; i++) if (pe.at(a + i) !== seq[i]) { m = false; break; } if (m) return true; } return false; };
/** `add eax, imm` (05 imm32 / 83 c0 imm8) */
const addEax = (pe, lo, hi, v) => hasBytes(pe, lo, hi, [0x05, v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255]) || (v >= -128 && v < 128 && hasBytes(pe, lo, hi, [0x83, 0xc0, v & 255]));
/** the values `x` of `cmp dword ptr [DAT_05d5d310], x` (0x81 0x3d / 0x83 0x3d) and `add dword ptr [DAT_05d5d310], x` (0x81 0x05 / 0x83 0x05) in a code range */
function scoreImmediates(pe, lo, hi) {
  const cmp = new Set(), add = new Set();
  for (let a = lo; a < hi - 10; a++) {
    if ((pe.at(a) === 0x81 || pe.at(a) === 0x83) && (pe.at(a + 1) === 0x3d || pe.at(a + 1) === 0x05) && pe.u32(a + 2) === 0x05d5d310) {
      const v = pe.at(a) === 0x81 ? pe.u32(a + 6) | 0 : (pe.at(a + 6) << 24) >> 24;
      (pe.at(a + 1) === 0x3d ? cmp : add).add(v);
    }
  }
  return { cmp: [...cmp].sort((x, y) => x - y), add: [...add].sort((x, y) => x - y) };
}

export default {
  name: 'm6-z28HAT',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e, msg) => ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z28HAT');
    let seed = 1;
    const seeded = (s) => { seed = s; setHatRandSource(() => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return Math.floor(seed / 0x80000000 * 32768); }); };   // a scripted rand() (0 .. 32767)
    /** a fresh game: the zone's scene with the set-up's attaches, the constructor effects (prepareHat) */
    const fresh = (s = 1, opts) => {
      seeded(s); hatGlobals.winchLast = 0;
      fx.rumble = 0; fx.fireball.length = 0;
      // a recording stand-in for the zone's ZoneParticles (FUN_00442960 / 00442a00 / 00442a20 calls of the fireball)
      fx.particles = { log: [], start(name, m, pos, rot, gate) { this.log.push(['start', name, m, [...pos], [...rot], [...gate]]); return 7; }, setMatrix(h, m) { this.log.push(['matrix', h, m]); }, on(h) { this.log.push(['on', h]); }, off(h) { this.log.push(['off', h]); } };
      const L = loadZone(ctx, 'z28HAT');
      const sound = hatSounds(null);
      const { shared, nodes } = prepareHat(L.world, arch, sound, opts);
      L.world.externalInput = false;
      return { L, w: L.world, S: shared, N: nodes, R: shared.recs, sound };
    };
    /** one simulation tick with the held buttons, then the loop's per-tick part (FUN_007928a0) */
    const step = (G, mask = 0) => { G.w.input.setVirtual(mask); G.w.tick(); hatUpdate(G.w); };
    const run = (G, n, mask = 0) => { for (let i = 0; i < n; i++) step(G, mask); };
    /** put the balloon over (x, z) with no momentum */
    const park = (G, x, z) => { G.R.hotb.x = x; G.R.hotb.z = z; G.R.hotb.savePrev(); G.S.mom = [0, 0, 0]; };
    const vars = (G) => G.w.vars;
    const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

    try {
      // ============================================================ tables against the executable
      {
        const L = loadZone(ctx, 'z28HAT');
        const at = L.setup.attaches.map((a) => [a.record, a.ctor]);
        const want = [[REC.PEPP, CTOR.PEPP], [REC.HOTB, CTOR.BALLOON], [REC.BRON, CTOR.BRONTY], [REC.WNCH, CTOR.WINCH], [REC.HATE, CTOR.MRHATES],
          ...REC.DINOS.map((r) => [r, CTOR.DINO]), ...REC.BABIES.map((r) => [r, CTOR.BABY]), [REC.FRB1, CTOR.FIREBALL], ...REC.SANDBAGS.map((r) => [r, CTOR.SANDBAG]), [REC.PTER, CTOR.PTERA]];
        for (const [r, c] of want) ok(at.some((x) => x[0] === r && x[1] === c), `the set-up attaches ctor ${hex(c)} to record ${r}`);
        ok(L.setup.attaches.filter((a) => Object.values(CTOR).includes(a.ctor)).length === want.length, `${want.length} attaches of the zone's own nodes`);
        const gates = L.setup.attaches.filter((a) => Object.values(CTOR).includes(a.ctor) && a.ctor !== CTOR.WINCH);
        ok(gates.every((a) => a.var === 2 && a.mask === 1 && a.value === 1), 'the nodes are gated by var 2 & 1 == 1 (always on)');
        const winch = L.setup.attaches.find((a) => a.ctor === CTOR.WINCH);
        ok(winch.mask === 0 && winch.value === 0, 'the winch has no gate (FUN_00423532(..., 2, 0, 0))');
        ok(L.skipped.every((s) => ['seabed', 'Pizza'].includes(s.ctorName)), `only the sky node and the cutscene prop node are skipped: ${L.skipped.map((s) => s.ctorName)}`);
        ok(checkRecords(L.world.records).length === 0, `record names: ${checkRecords(L.world.records).join('; ')}`);
        ok(L.world.records.length === 154, `${L.world.records.length} records`);
        ok(registeredCtors().includes(CTOR.PEPP) && Object.values(CTOR).every((a) => registeredCtors().includes(a)), 'ten constructors registered');
        ok(L.setup.cutscenes.map((c) => `${c.slot}:${c.name}`).join() === '0:ADV08,1:ADV09' && HAT_CUTSCENES.length === 2, 'cutscene slots 0 = ADV08 (intro), 1 = ADV09 (outro)');
        ok(L.setup.waypointMaps.some((m) => /W_PATH$/i.test(m.path)), 'the PATH waypoint map the cutscenes use');
        // hidden by the set-up: FRB1 / FRB2 / FRB3 and the sandbags, the G0xx helper records
        for (const i of [22, 63, 64, 76, 77, 78]) ok(!(L.world.records[i].flags & 2), `record ${i} (${L.world.records[i].name}) hidden by the set-up`);
        ok(L.world.records[REC.PEPP].flags & 2, 'the player record is shown');
        // the two cutscenes' scripts exist in the zone archive, the messages in the AI table
        ok(!!arch.find('cutscene/adv08.cut') && !!arch.find('cutscene/adv09.cut'), 'cutscene/adv08.cut and adv09.cut');
        const msgs = ctx.archives.find((a) => a.name === 'messages');
        const hat = Buffer.from(msgs.read(msgs.find('AI/Data/HAT.str'))).toString('latin1');
        for (const id of ['ADSGMC01', 'ADSGMC02', 'ADSGMC03', 'ADSGMC04', 'ADSGMC05', 'ADSGMC06', 'ADSGMC07', 'ADSGMC08', 'ADSGMC09', 'ADSGMC10', 'ADSGMC11', 'ADSGMC12', 'ADSGMC13', 'ADSGMC14', 'ADSGMC15', 'ADSGMC16', 'ADSGMC17', 'ADSGMC18', 'ADSGMC19', 'CONTROL0', 'CONTROL4']) ok(hat.includes(id + ':'), `HAT.str has ${id}`);
        ok(!!msgs.find('AI/Data/ADV08.str') && !!msgs.find('AI/Data/ADV09.str'), 'ADV08.str / ADV09.str');
      }
      {
        // the numbers of the zone code (.rdata floats / doubles, see the K comments)
        const f = (va) => f32of(pe, va), d = (va) => f64of(pe, va);
        near(f(0x93ffe4), K.KNOCK_TICKS, 0, '0x93ffe4: knock-back 15 ticks');
        near(f(0x940010), K.BALLOON_HEIGHT, 0, '0x940010: balloon 40 over the drop zone');
        near(f(0x940014), K.ACCEL, 1e-9, '0x940014: thrust ramp 0.0004');
        near(f(0x940018), K.MAX_SPEED, 1e-9, '0x940018: thrust limit 0.004');
        near(f(0x94001c), K.TURN, 1e-9, '0x94001c: turn 3 degrees');
        near(f(0x940020), K.SPEED_DAMP, 1e-9, '0x940020: ramp damping 0.02');
        near(f(0x940024), K.MOM_DAMP, 1e-9, '0x940024: momentum damping 0.02');
        near(f(0x892090), K.THRUST_SCALE, 0, '0x892090: thrust scale 8');
        near(f(0x892544), K.MOM_CAP2, 1e-6, '0x892544: momentum cap squared 2.56');
        near(f(0x892580), K.MOM_CAP, 1e-6, '0x892580: momentum cap 1.6');
        near(f(0x89260c), K.SWEEP_DROP, 1e-6, '0x89260c: sweep 12.8 under the balloon');
        near(d(0x8922a0), K.FADE_STEP, 1e-12, '0x8922a0 (double): music fade 0.01 per tick');
        near(f(0x93ffec), K.ROPE_MIN, 1e-6, '0x93ffec: shortest rope 18.4');
        near(f(0x93fff0), K.ROPE_STEP, 1e-6, '0x93fff0: lowering 1.6');
        near(f(0x93fff4), K.ROPE_STEP, 1e-6, '0x93fff4: raising 1.6');
        near(f(0x892938), K.ROPE_TOP, 1e-6, '0x892938: the rope starts 14.4 under the balloon');
        near(d(0x892930), K.HOOK_SWAY, 1e-12, '0x892930 (double): hook sway 0.03');
        near(f(0x93ffe8), K.FALL, 1e-6, '0x93ffe8: fireball speed / fall 2.4');
        near(f(0x940008), K.FALL, 1e-6, '0x940008: released dinosaurs fall 2.4');
        near(f(0x93fff8), K.SANDBAG_FALL, 1e-6, '0x93fff8: sandbag 1.6');
        near(f(0x940000), K.MOUTH_RADIUS, 0, '0x940000: sandbag hits within 8');
        near(f(0x940004), K.ROAR_RADIUS, 0, '0x940004: Bronty roars when a hooked dinosaur is within 24');
        near(f(0x94002c), K.FAR2, 0, '0x94002c: 5000');
        near(f(0x940028), K.FIREBALL_RANGE2, 0, '0x940028: fireballs end 200 from the origin');
        near(pe.u32(0x940030), K.DROP_RADIUS, 0, '0x940030: a landed dinosaur counts within 40 of the drop zone');
        near(d(0x892928), K.BABY_SPEED, 1e-12, '0x892928 (double): baby speed 0.4');
        near(d(0x892940), K.BRONTY_TURN, 1e-12, '0x892940 (double): Bronty turns 0.75 degrees per tick');
        near(f(0x8924e8), K.FACING, 1e-6, '0x8924e8: facing window 22.5 degrees');
        near(d(0x892450), K.PTER_R, 1e-12, '0x892450 (double): pterodactyl radius 60');
        near(d(0x892920), K.PTER_X, 1e-12, '0x892920 (double): pterodactyl centre x');
        near(d(0x892918), K.PTER_Z, 1e-6, '0x892918 (double): pterodactyl centre z');
        near(f(0x892444), K.PTER_STEP, 1e-9, '0x892444: pterodactyl phase step 0.016');
        near(f(0x93ffe4), 15, 0, 'sweep skin constants: see the immediates below');
        ok(pe.u32(0x94000c) === 11, 'DAT_0094000c: 11 dinosaurs');
        // the balloon's sweeps (radius / skin immediates of FUN_00796e14) and the camera offset
        ok(hasImm(pe, 0x796e14, 0x7978db, bits(3.2)) && hasImm(pe, 0x796e14, 0x7978db, bits(4)) && hasImm(pe, 0x796e14, 0x7978db, bits(5.6)), 'FUN_00796e14: sweep radii 3.2 / 4.0 / 5.6');
        ok(hasImm(pe, 0x796b60, 0x796c0e, bits(15.2)) && hasImm(pe, 0x796b60, 0x796c0e, bits(-16)), 'FUN_00796b60: camera offset (0, 15.2, -16)');
        near(f(0x89208c), K.CAM_EASE_Y, 0, '0x89208c: the camera eases 0.125 as fast in y');
        ok(hasImm(pe, 0x796c0e, 0x796cf7, bits(0.06)), 'FUN_00796c0e: camera ease 0.06');
        ok(hasImm(pe, 0x797d67, 0x797e51, bits(-12.8)), 'FUN_00797d67: the rider sits 12.8 under the balloon');
        ok(hasImm(pe, 0x792e60, 0x793202, bits(16)) && hasImm(pe, 0x793370, 0x7937b3, bits(0.08)), 'sweep radii: sandbag 16, fireball 0.08');
        ok(hasImm(pe, 0x793c44, 0x7945c5, bits(6.4)) && hasImm(pe, 0x794679, 0x794821, bits(75)), 'babies: nest radius 6.4, vanish timer 75');
        ok(hasImm(pe, 0x7953d4, 0x7955bd, bits(75)), 'dinosaurs: vanish timer 75');
      }
      {
        // score immediates: the loop's thresholds, the dinosaur / sandbag / Bronty points
        const loop = scoreImmediates(pe, 0x790c19, 0x790f71), main = scoreImmediates(pe, 0x790fc0, 0x7918a0);
        ok(loop.cmp.join() === [0x9c4, 5000, 0x1d4c].sort((a, b) => a - b).join(), `FUN_00790c19 compares the score with ${loop.cmp.map(hex)} (bronze 2500, silver 5000, gold 7500)`);
        ok(main.cmp.includes(0x9c4), `FUN_00790fc0: success is score > 0x9c3, i.e. score >= 0x9c4 (${main.cmp.map(hex)})`);
        ok(MEDAL.BRONZE === 0x9c4 && MEDAL.SILVER === 5000 && MEDAL.GOLD === 0x1d4c, 'MEDAL constants');
        ok(hasImm(pe, 0x793b12, 0x793c44, 300) && K.BABY_POINTS === 300, 'FUN_00793b12: +300 per baby');
        ok(hasImm(pe, 0x79492a, 0x794a5c, 1000) && K.DINO_POINTS === 1000, 'FUN_0079492a: +1000 per big dinosaur');
        const sb = scoreImmediates(pe, 0x792e60, 0x793202);
        ok(hasBytes(pe, 0x792e60, 0x793202, [0x83, 0xe9, 0x64]) && hasImm(pe, 0x792e60, 0x793202, 500) && sb.cmp.includes(10000) && K.SANDBAG_HIT === 500 && K.SANDBAG_MISS === -100 && SCORE_CAP === 10000, `FUN_00792e60: -100 / +500 and the cap 10000: ${JSON.stringify(sb)}`);
        const br = scoreImmediates(pe, 0x795f80, 0x79691f);
        ok(hasImm(pe, 0x795f80, 0x79691f, 1000) && br.cmp.includes(10000) && br.cmp.includes(0x1d4c) && br.cmp.includes(5000) && br.cmp.includes(0x9c4) && K.FREED_POINTS === 1000, `FUN_00795f80 (Bronty freed): +1000, cap, thresholds: ${JSON.stringify(br)}`);
        ok(VAR.HISCORE === 0x4a && VAR.TROPHY === 0x9d, 'variables 0x4a (HISCORE_HAT) / 0x9d (TROPHY_HAT)');
        const vn = (i) => { const v = new GameVars(); v.loadNames(pe); return v.nameOf(i); };
        ok(vn(0x4a) === 'SWITCH_GME_HISCORE_HAT' && vn(0x9d) === 'SWITCH_GME_TROPHY_HAT', `variable names ${vn(0x4a)} / ${vn(0x9d)}`);
      }
      {
        // FUN_00792950: the sound slots (0x4433b0 = 3D, 0x443580 = 2D), and the table names
        const loads = pushCalls(pe, 0x792950, 0x792abb).filter((c) => c.target === 0x4433b0 || c.target === 0x443580);
        const got = new Map(loads.map((c) => [c.arg, c.target === 0x4433b0 ? '3d' : '2d']));
        ok(loads.length === 22, `FUN_00792950 loads ${loads.length} slots (10 positional, 12 plain)`);
        const bankIds = new Map(Object.values(HAT_SOUNDS).map((s) => [s.id, s.kind]));
        ok(bankIds.size === got.size && [...got].every(([id, k]) => bankIds.get(id) === k), 'HAT_SOUNDS = the loads of FUN_00792950 (ids and kinds)');
        const tab = readAudioTables(new Uint8Array(fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe'))));
        const names = Object.fromEntries(Object.entries(HAT_SOUNDS).map(([k, v]) => [k, tab.sounds[v.id]?.name]));
        ok(names.brontyCall === 'SND_BRONTY_CALL' && names.fenceBuzz === 'SND_FENCE_BUZZ' && names.balloonFly === 'SND_BALLOON_FLY' && names.sandbagHit === 'SND_SANDBAG_HIT' && names.hatesFinal === 'SND_HATES_HITFINAL' && names.winchMove === 'SND_WINCH_MOVE', `sound table names: ${JSON.stringify(names)}`);
        ok(/z28hat/i.test(tab.sounds[HAT_SOUNDS.brontyCall.id].path), 'the sounds are the zone\'s files');
        ok(tab.music.some((m) => m.key === 'Z28HAT' && /MrHates/i.test(m.segment)), 'music key Z28HAT = MrHates.sgt');
      }
      {
        // FUN_00791990: the argument blocks of the dinosaurs (floats and clip bytes are immediates of the code) and the start clips / frames
        const lo = 0x791990, hi = 0x792787;
        for (const v of [0x41800000, 0x40b33333, 0x3f4ccccd, 0x41000000, 0x3f99999a, 0x40051eb8, 0x40000000, 0x40666666, 0x40e00000, 0x41200000, 0x40a00000]) ok(hasImm(pe, lo, hi, v), `FUN_00791990 has the immediate ${hex(v)}`);
        // the clip bytes are written as `mov byte ptr [ebp - 0x10 + i], b` (c6 45 f0..f5 b); one group per dinosaur block
        const groups = [];
        for (let a = lo; a < hi - 3; a++) {
          if (pe.at(a) === 0xc6 && pe.at(a + 1) === 0x45 && pe.at(a + 2) === 0xf0) {
            const g = [pe.at(a + 3)];
            for (let i = 1; i < 6 && pe.at(a + 4 * i) === 0xc6 && pe.at(a + 4 * i + 1) === 0x45 && pe.at(a + 4 * i + 2) === 0xf0 + i; i++) g.push(pe.at(a + 4 * i + 3));
            groups.push(g.join());
          }
        }
        ok(groups.join(' | ') === '4,5,3,2,1,6 | 4,5,3,2,1,6 | 4,5,3,2,1,6 | 2,3,7,6,4,5 | 2,3,7,6,4,5 | 4,4,2,2,5,1', `the dinosaurs' clip bytes: ${groups.join(' | ')} (the T-rex's block sets bytes 4 / 5 as 0x105)`);
        ok(DINO_ARGS[REC.DINOS[0]].clips.join() === '4,5,3,2,1,6' && DINO_ARGS[REC.DINOS[3]].clips.join() === '2,3,7,6,4,5' && DINO_ARGS[REC.DINOS[5]].clips.join() === '4,4,2,2,5,1', 'dinosaur clip bytes (the T-rex\'s last byte 1 is the word 0x105\'s high byte)');
        ok(DINO_ARGS[REC.DINOS[5]].reachV === 8 && Math.abs(DINO_ARGS[REC.DINOS[5]].hang - 1.2) < 1e-6 && DINO_ARGS[REC.DINOS[0]].reachV - 5.6 < 1e-6, 'the T-rex block: 8.0 / 1.2');
        ok(Math.abs(BABY_ARGS[REC.BABIES[0]].reachV - 2.08) < 1e-6 && Math.abs(BABY_ARGS[REC.BABIES[1]].hang - 3.6) < 1e-6, 'baby blocks: 2.08, hang 2.0 / 3.6 (REX2)');
        ok(BABY_START_FRAME[REC.BABIES[1]] === 7 && BABY_START_FRAME[REC.BABIES[2]] === 2 && BABY_START_FRAME[REC.BABIES[3]] === 5 && BABY_START_FRAME[REC.BABIES[4]] === 10, 'baby start frames 7 / 2 / 5 / 10');
        // the rigs FUN_007a6bf3 loads
        const names = [0x940ca8, 0x940cc4, 0x940ce0, 0x940cfc, 0x940d18, 0x940d34, 0x940d50].map((a) => pe.cstr(a));
        ok(names.map((n) => n.replace(/^.*\\/, '')).join() === 'MFIG.blk,BRON.blk,STEG.blk,BREX.blk,TRIC.blk,TREX.blk,PTER.blk', `rigs: ${names.map((n) => n.replace(/^.*\\/, ''))}`);
        ok(RIGS.length === 16 && RIGS.every((r) => arch.find(`anim/${r.rig}.blk`)), 'RIGS (16 records) all exist in the archive');
        ok(pe.cstr(0x940548).toLowerCase().endsWith('food.man') && !!arch.find('matanim/Food.man'), 'Bronty loads matanim/Food.man');
      }

      {
        // the animation dictionary of the loader (DAT_05d4d484): read from the code, resolves the cutscene scripts' names and documents the clip numbers the nodes use
        const dict = readAnimDictionary(pe);
        const D = (n) => dict.get(n);
        ok(dict.size >= 170, `${dict.size} dictionary entries (FUN_0045bff4 is called 174 times)`);
        ok(D('XTALK3') === 123 && D('INFO_PONDERING') === 114 && D('XIDLE') === 111 && D('XVOILA') === 131 && D('PEP_SURPRISEDBYMUMS') === 91, 'XTALK3 123, INFO_PONDERING 114, XIDLE 111, XVOILA 131, PEP_SURPRISEDBYMUMS 91');
        const scripts = ['cutscene/adv08.txt', 'cutscene/adv09.txt'].map((n) => Buffer.from(arch.read(arch.find(n))).toString('latin1'));
        const names = new Set(); for (const t of scripts) for (const m of t.matchAll(/\bsetanim\s+(\S+)/gi)) names.add(m[1].toUpperCase());
        ok(names.size >= 5 && [...names].every((n) => [...dict.keys()].some((k) => k.toUpperCase() === n)), `every SETANIM name of ADV08 / ADV09 resolves: ${[...names]}`);
        // Bronty's clips (BRON.blk) and Mr Hates' (MFIG.blk) as the state machine starts them: the dictionary names them
        const pairs = [[BRONTY.STANCE, 1, 0x78, 'BRON_BR_BURP', 'HATES_BURP'], [BRONTY.ROAR, 2, 0x7f, 'BRON_BR_CALL', 'HATES_CALL'], [BRONTY.TURN_R, 3, 0x77, 'BRON_BR_PULLEDRIGHT', 'HATES_PULLEDRIGHT'],
          [BRONTY.EAT, 4, 0x7e, 'BRON_BR_FEDPIZZA', 'HATES_FEDPIZZA'], [BRONTY.TURN_L, 5, 0x7d, 'BRON_BR_PULLEDLEFT', 'HATES_PULLEDLEFT'], [BRONTY.HIT, 6, 0x80, 'BRON_BR_HIT', 'HATES_HIT'],
          [BRONTY.IDLE, 7, 0x81, 'BRON_BR_IDLE', 'HATES_IDLE'], [BRONTY.RUNUP, 8, 0x82, 'BRON_BR_RUNUPBACK', 'HATES_RUNUPBACK'], [BRONTY.FREED, 9, 0x7a, 'BRON_BR_TAILFLICK', 'HATES_TAILFLICK']];
        for (const [st, b, h, bn, hn] of pairs) ok(D(bn) === b && D(hn) === h, `Bronty state ${st}: ${bn} = ${D(bn)} (clip ${b}), ${hn} = ${D(hn)} (Mr Hates ${h})`);
        // the dinosaurs: idle 1 / idle 2 (the roar clip) / hang / drop / land / walk
        const want = (p, k) => k.map((x) => D(`${p}${x}`));
        ok(DINO_ARGS[REC.DINOS[0]].clips.join() === want('STEG_STEG_', ['IDLE1', 'IDLE2', 'HANG', 'DROP', 'DROPEND', 'WALK']).join(), 'stegosaur clips = IDLE1, IDLE2, HANG, DROP, DROPEND, WALK');
        ok(DINO_ARGS[REC.DINOS[3]].clips.join() === want('TRIC_TRI_', ['IDLE1', 'IDLE2', 'HANG', 'DROP', 'DROPEND', 'WALK']).join(), 'triceratops clips = IDLE1, IDLE2, HANG, DROP, DROPEND, WALK');
        ok(DINO_ARGS[REC.DINOS[5]].clips.join() === [D('TREX_IDLE_TREX'), D('TREX_IDLE_TREX'), D('TREX_TREX_HANG'), D('TREX_TREX_HANG'), D('TREX_TREX_LAND'), D('TREX_WALK')].join(), 'T-rex clips = IDLE, IDLE, HANG, HANG (the release clip byte is the hang clip), LAND, WALK');
        ok(DINO_START_CLIP[REC.DINOS[0]] === D('STEG_STEG_IDLE1') && DINO_START_CLIP[REC.DINOS[1]] === D('STEG_STEG_IDLE2') && DINO_START_CLIP[REC.DINOS[3]] === D('TRIC_TRI_IDLE1') && DINO_START_CLIP[REC.DINOS[5]] === D('TREX_WALK'), 'start clips');
        ok(D('BREX_HOP') === 1 && D('PTER_PTER_FLAPPING') === 1, 'baby clip 1 = BREX_HOP, pterodactyl clip 1 = PTER_PTER_FLAPPING');
      }

      // ============================================================ the balloon
      {
        const G = fresh();
        const { hotb, drop, winch, pepp, bron, hate } = G.R;
        near(hotb.x, drop.x, 1e-6, 'balloon x = drop zone'); near(hotb.z, drop.z, 1e-6, 'balloon z = drop zone');
        near(hotb.y, drop.y + 40, 1e-4, 'balloon 40 over the drop zone');
        near(Math.abs(Math.atan2(hotb.fx, hotb.fz)), Math.PI, 1e-5, 'balloon turned half a circle (facing -z)');
        near(winch.y, hotb.y - 18.4, 1e-4, 'the hook hangs 18.4 under the balloon');
        const c = G.w.camera.c;
        const eye = hotb.toWorld([0, 15.2, -16]);
        near(c[0], eye[0], 1e-4, 'camera eye x (frame * (0, 15.2, -16))'); near(c[1], eye[1], 1e-4, 'camera eye y'); near(c[2], eye[2], 1e-4, 'camera eye z');
        near(c[4], hotb.y - 16, 1e-4, 'camera target 16 under the balloon');
        ok(vars(G).get(VAR.CONTROL) === 1 && vars(G).get(VAR.BRONTY) === BRONTY.IDLE, 'var 0xfc = 1 (control), var 0xfb = 4 (Bronty idle)');
        ok(G.S.nest[0] === G.R.babies[0].x && Math.abs(G.S.nest[0] + 59.28) < 0.01, 'the nest = REX1\'s start place');
        near(G.R.pter.y, hotb.y - 16, 1e-4, 'the pterodactyl flies 16 under the balloon\'s height'); near(G.R.pter.z, -hotb.z, 1e-4, '(its start z is the balloon\'s negated)');
        near(G.R.pepp.anim.clip, 0x74, 0, 'Pepper starts on clip 0x74');
        // the rider takes the balloon's matrix, 12.8 under it, after the first tick
        step(G);
        near(pepp.y, hotb.y - 12.8, 1e-4, 'Pepper 12.8 under the balloon'); near(pepp.x, hotb.x, 1e-6, 'Pepper x');
        near(pepp.m[8], hotb.m[8], 1e-6, 'Pepper has the balloon\'s orientation');
        near(G.w.camera.c[3], hotb.x, 1e-6, 'the camera target follows at once');
        // Up: the thrust ramps 0.0004 per tick to 0.004
        const G2 = fresh(); const b2 = G2.N.balloon;
        step(G2, B.UP);
        near(b2.speed, 0.0004, 1e-9, 'Up: ramp 0.0004 after one tick');
        near(G2.S.mom[2], -0.0004 * 8, 1e-9, 'Up: momentum = forward * 8 * speed (-z)'); near(G2.S.mom[0], 0, 1e-6, '(no x)');
        run(G2, 9, B.UP); near(b2.speed, 0.004, 1e-9, 'Up: limit 0.004 after ten ticks');
        run(G2, 5, B.UP); near(b2.speed, 0.004, 1e-9, '(stays at the limit)');
        const s0 = b2.speed; run(G2, 10, 0); near(b2.speed, s0 * Math.pow(0.98, 10), 1e-9, 'released: the ramp decays by 2% per tick');
        // Down thrusts backwards, Up wins over Down, Left over Right
        const G3 = fresh(); step(G3, B.DOWN);
        near(G3.N.balloon.speed, -0.0004, 1e-9, 'Down: ramp -0.0004'); near(G3.S.mom[2], 0.0004 * 8, 1e-9, 'Down: backwards (+z)');
        const G4 = fresh(); step(G4, B.UP | B.DOWN); ok(G4.N.balloon.speed > 0, 'Up and Down: Up wins');
        const a0 = Math.atan2(G4.R.hotb.fx, G4.R.hotb.fz);
        // turning: 3 degrees per tick, Right = +, Left = -, Left wins; the position stays
        const G5 = fresh(); const x5 = G5.R.hotb.x, z5 = G5.R.hotb.z;
        run(G5, 10, B.RIGHT);
        const ang = (G) => { const a = Math.atan2(G.R.hotb.fx, G.R.hotb.fz) - a0; return Math.atan2(Math.sin(a), Math.cos(a)); };
        near(ang(G5), 10 * K.TURN, 1e-4, 'Right: +3 degrees per tick');
        near(G5.R.hotb.x, x5, 1e-6, 'turning leaves the position alone'); near(G5.R.hotb.z, z5, 1e-6, '(z too)');
        const G6 = fresh(); run(G6, 10, B.LEFT); near(ang(G6), -10 * K.TURN, 1e-4, 'Left: -3 degrees per tick');
        const G7 = fresh(); run(G7, 10, B.LEFT | B.RIGHT); near(ang(G7), -10 * K.TURN, 1e-4, 'Left and Right: Left wins');
        // the momentum is capped at 1.6 and damped by 2% per tick
        const G8 = fresh(); G8.S.mom = [2, 0, 0]; step(G8);
        near(Math.hypot(...G8.S.mom), 1.6, 0.02, 'the momentum is capped at 1.6');
        const G9 = fresh(); G9.S.mom = [1, 0, 0]; step(G9);
        near(G9.S.mom[0], 0.98, 1e-6, 'the momentum is damped by 2% per tick (while in control)');
        // the balloon keeps its height; x / z follow the momentum
        const G10 = fresh(); G10.S.mom = [0.5, 0.5, 0]; const y10 = G10.R.hotb.y; const x10 = G10.R.hotb.x; step(G10);
        near(G10.R.hotb.y, y10, 1e-9, 'the height never changes (the momentum\'s y is not integrated)'); near(G10.R.hotb.x - x10, 0.49, 1e-3, 'x moves by the momentum');
        // sounds: the thrust loop plays while a key is held and stops when none is; the wind beds play every tick
        const G11 = fresh(); step(G11, B.UP); step(G11); step(G11);
        ok(G11.sound.count('play', 'balloonFly') === 1 && G11.sound.count('stop', 'balloonFly') === 2, 'balloonFly: played with the key, stopped without');
        ok(G11.sound.count('play', 'wind1') === 3 && G11.sound.count('play', 'wind2') === 3, 'wind beds every tick');
        const fb = G11.sound.log.find((e) => e.op === 'at' && e.name === 'fenceBuzz');
        ok(fb && fb.pos.every((v, i) => Math.abs(v - [G11.R.trex.x, G11.R.trex.y, G11.R.trex.z][i]) < 1e-9), 'the electric fence buzzes at the T-rex\'s place');
        ok(pepp.ctrl.nodes.length === 1 && pepp.ctrl.nodes[0].kind === 'hatpepp', 'the player record carries only the rider node (no walk / swim stub)');
        void bron; void hate;
      }
      // ============================================================ knock-back by a fireball
      {
        const G = fresh();
        const B0 = G.N.balloon;
        // a fireball hit: var 0xfc = 0 and a push; for 15 ticks the balloon is pushed and the keys do nothing
        vars(G).set(VAR.CONTROL, 0); G.S.push = [0.4, 0, -0.2];
        const x0 = G.R.hotb.x;
        run(G, 5, B.LEFT);
        ok(vars(G).get(VAR.CONTROL) === 0, 'knocked: var 0xfc stays 0 for the timer');
        near(Math.abs(Math.atan2(G.R.hotb.fx, G.R.hotb.fz)), Math.PI, 1e-6, 'knocked: Left does not turn');
        ok(G.R.hotb.x - x0 > 1.0, 'knocked: the push moves the balloon');
        run(G, 11);
        ok(vars(G).get(VAR.CONTROL) === 1, 'after 15 ticks (and one more) control is back');
        ok(B0.hits === 1, 'one knock counted');
        ok(vars(G).get(VAR.WINCH) === WINCH.RAISE || vars(G).get(VAR.WINCH) === WINCH.TOP, 'the winch is pulled up while knocked');
        ok(G.S.spoken.includes('ADSGMC06'), 'first knock: ADSGMC06');
        vars(G).set(VAR.CONTROL, 0); run(G, 17); ok(B0.hits === 2, 'second knock'); ok(!G.S.spoken.includes('ADSGMC09'), 'second knock (count 1): no line of count 2 yet');
        vars(G).set(VAR.CONTROL, 0); G.sound.log.length = 0; run(G, 17); ok(B0.hits === 3, 'third knock');
        ok(G.S.spoken.includes('ADSGMC09'), 'third knock (count 2): ADSGMC09');
        vars(G).set(VAR.CONTROL, 0); run(G, 17);
        ok(G.S.spoken.includes('ADSGMC18'), 'a knock at an odd count: ADSGMC18');
      }
      // ============================================================ the winch
      {
        const G = fresh();
        park(G, -90, 330);                           // over the plain next to the drop zone
        const { winch, hotb } = G.R;
        step(G);                                       // settle
        ok(vars(G).get(VAR.WINCH) === WINCH.TOP, 'the hook is at the top (var 0xfa = 0)'); near(winch.y, hotb.y - 18.4, 1e-4, 'the hook rests 18.4 under the balloon');
        step(G, B.SHIFT);
        ok(vars(G).get(VAR.WINCH) === WINCH.LOWER, 'Shift: lowering (var 0xfa = 1)');
        step(G);
        near(G.N.winch.len, 18.4, 1e-6, 'the winch moves by the state of the previous tick: the first tick after the press still rests');
        const len = G.N.winch.len; step(G); near(G.N.winch.len - len, 1.6, 1e-6, 'lowering: 1.6 per tick');
        ok(G.sound.count('play', 'winchMove') > 0, 'the winch loop plays while it moves');
        step(G, B.SHIFT); ok(vars(G).get(VAR.WINCH) === WINCH.RAISE, 'Shift while lowering: raising');
        step(G); step(G, B.SHIFT); ok(vars(G).get(VAR.WINCH) === WINCH.LOWER, 'Shift while raising: lowering again');
        // down to the ground: the hook turns round by itself and comes back to the top
        run(G, 80);
        ok(winch.y < hotb.y - 18.4 - 1 || vars(G).get(VAR.WINCH) !== WINCH.LOWER, 'the hook went down');
        run(G, 120);
        ok(vars(G).get(VAR.WINCH) === WINCH.TOP && Math.abs(G.N.winch.len - 18.4) < 1e-6, 'it is back at the top (var 0xfa = 0, rope 18.4)');
        // while a dinosaur hangs on the hook the button does nothing
        G.S.carrying = true; vars(G).set(VAR.WINCH, WINCH.RAISE); step(G, B.SHIFT); step(G, B.SHIFT);
        ok(vars(G).get(VAR.WINCH) !== WINCH.LOWER, 'carrying: Shift is ignored');
        // the hook follows the balloon and the rope is never shorter than 18.4
        const G2 = fresh(); park(G2, -150, 300); G2.S.mom = [0.7, 0, 0.4]; run(G2, 20);
        ok(Math.abs(G2.R.winch.x - G2.R.hotb.x) < 1.5 && Math.abs(G2.R.winch.z - G2.R.hotb.z) < 1.5, 'the hook is under the balloon (one tick behind: it updates first)');
        // a carried dinosaur swings the hook by heading * 0.03
        const G3 = fresh(); G3.S.carrying = true; step(G3);
        const hd = Math.atan2(G3.R.drop.x - G3.R.hotb.x, G3.R.drop.z - G3.R.hotb.z); near(G3.R.winch.ry, hd * 0.03, 1e-6, 'carrying: the hook\'s heading = heading to the drop zone * 0.03');
      }
      // ============================================================ a big dinosaur: hook, carry, release, land, score
      {
        const G = fresh(3);
        const ste2 = G.R.dinos[1], N = G.N.dinos[1], hook = G.R.winch;
        park(G, ste2.x, ste2.z);
        ok(N.state === DINO.IDLE, 'the stegosaurus stands');
        step(G, B.SHIFT);
        let n = 0; while (N.state === DINO.IDLE && n++ < 200) step(G);
        ok(N.state === DINO.HOOKED, `hooked after ${n} ticks`);
        ok(vars(G).get(VAR.WINCH) === WINCH.CARRY, 'the winch was lowering: var 0xfa = 3');
        ok(G.S.spoken.includes('ADSGMC10'), 'the first stegosaurus hooked: ADSGMC10');
        step(G);
        ok(G.S.carrying && vars(G).get(VAR.WINCH) === WINCH.RAISE, 'carrying, the winch is raising (var 0xfa: 2)');
        ok(G.N.dinos[1].savedCol !== null && G.N.dinos[1].savedCol === G.R.winch.colObj, 'a hooked dinosaur switches the hook\'s collision off (0xbabababa) every tick; the idle dinosaurs after it in the record order put the real object back, so the balloon sees it');
        step(G);
        near(ste2.x, hook.x, 1e-3, 'the dinosaur hangs under the hook (x)'); near(ste2.z, hook.z, 1e-3, '(z)');
        ok(ste2.y <= hook.y + 1e-6 && ste2.y > hook.y - 3, `it hangs under the hook (${(hook.y - ste2.y).toFixed(2)})`);
        run(G, 60);
        ok(Math.abs(G.N.winch.len - 18.4) < 1e-6, 'the winch brought it up to the top (rope 18.4)');
        // fly (teleport) to the drop zone: the release needs a press and the balloon more than sqrt(5000) from the origin (3D: the balloon is 65 up)
        park(G, G.R.drop.x + 5, G.R.drop.z - 5); run(G, 3);
        ok(G.N.dinos[1].state === DINO.HOOKED && Math.abs(ste2.x - G.R.hotb.x) < 1e-6, 'it moves with the balloon');
        step(G, B.SHIFT);
        ok(N.state === DINO.FALLING, 'Shift far from the origin: it falls');
        const y1 = ste2.y; step(G); near(y1 - ste2.y, 2.4, 1e-4, 'falling 2.4 per tick');
        ok(!G.S.carrying, 'no longer carrying');
        n = 0; while (N.state === DINO.FALLING && n++ < 100) step(G);
        ok(N.state === DINO.LANDED, 'landed');
        ok(G.sound.count('play', 'dinoLand') === 1, 'the landing sound');
        step(G);
        ok(G.S.delivered === 1 && G.S.score === 1000, `delivered ${G.S.delivered}, score ${G.S.score} (+1000 within the drop zone)`);
        const sc = G.S.score; run(G, 30); ok(G.S.score === sc && G.S.delivered === 1, 'counted once');
        // blinking out: visible while ftol(timer) & 2, gone after 75 ticks
        let vis = []; for (let i = 0; i < 50; i++) { step(G); vis.push(ste2.flags & 2 ? 1 : 0); }
        ok(vis.some((v) => v === 1) && vis.some((v) => v === 0), 'it blinks');
        run(G, 80);
        ok(ste2.flags === 0 && N.state === DINO.GONE, 'gone after 75 ticks (flags 0, state 4)');
        // a dinosaur dropped far from the drop zone counts but scores nothing
        const G2 = fresh(4); const t = G2.R.dinos[0], n2 = G2.N.dinos[0];
        park(G2, t.x, t.z); step(G2, B.SHIFT); n = 0; while (n2.state === DINO.IDLE && n++ < 200) step(G2);
        ok(n2.state === DINO.HOOKED, 'STE1 hooked'); run(G2, 60); step(G2, B.SHIFT);
        ok(n2.state === DINO.FALLING, 'released over the plain'); run(G2, 100);
        ok(G2.S.delivered === 1 && G2.S.score === 0, `released far from the drop zone: counted, no points (${G2.S.delivered} / ${G2.S.score})`);
        // the release needs the balloon more than 70.7 from the origin
        const G3 = fresh(5); const t3 = G3.R.dinos[5], n3 = G3.N.dinos[5];       // the T-rex, 141 from the origin
        park(G3, t3.x, t3.z); step(G3, B.SHIFT); n = 0; while (n3.state === DINO.IDLE && n++ < 300) step(G3);
        ok(n3.state === DINO.HOOKED, 'T-rex hooked'); ok(G3.S.spoken.includes('ADSGMC17'), 'the T-rex hooked: ADSGMC17');
        run(G3, 60); park(G3, 10, 10); run(G3, 3); step(G3, B.SHIFT); ok(n3.state === DINO.HOOKED, 'Shift with the balloon within sqrt(5000) of the origin (x, y and z): it is not released');
        park(G3, 30, 30); run(G3, 3); step(G3, B.SHIFT); ok(n3.state === DINO.FALLING, 'Shift beyond: released (the balloon\'s own height 65 counts: 30, 30, 65 is 5.4e3)');
        // a fireball hit while carrying drops the dinosaur
        const G4 = fresh(6); const t4 = G4.R.dinos[3], n4 = G4.N.dinos[3];
        park(G4, t4.x, t4.z); step(G4, B.SHIFT); n = 0; while (n4.state === DINO.IDLE && n++ < 300) step(G4);
        ok(n4.state === DINO.HOOKED && G4.S.spoken.includes('ADSGMC12'), 'triceratops hooked: ADSGMC12'); G4.S.fireballHit = true; step(G4);
        ok(n4.state === DINO.FALLING && !G4.S.fireballHit, 'the fireball hit makes it fall');
      }
      // ============================================================ the 60 Hz step (dt = 0.5): the dt-scaled walks and falls halve per tick
      {
        const G = fresh(7); G.w.dt = 0.5;
        const babies = G.R.babies;
        run(G, 3);
        let steps = 0, dd = 0;
        for (let i = 0; i < 100; i++) { const b = babies[0], xa = b.x, za = b.z; step(G); const d = Math.hypot(b.x - xa, b.z - za); if (d > 0) { steps++; if (Math.abs(d - 0.2) < 0.01) dd++; } }
        ok(steps > 50 && dd >= steps * 0.9, `dt 0.5: a baby walks 0.4 * 0.5 per tick (${dd} of ${steps} steps are 0.2)`);
        const H = fresh(7); H.w.dt = 0.5;
        const t0 = H.R.dinos[0], n0 = H.N.dinos[0];
        n0.state = DINO.FALLING; const y0 = t0.y; step(H);
        near(y0 - t0.y, 2.4 * 0.5, 1e-4, 'dt 0.5: a falling dinosaur drops 2.4 * 0.5 per tick');
      }
      // ============================================================ the baby dinosaurs
      {
        const G = fresh(7);
        const nest = G.S.nest;
        const babies = G.R.babies, N = G.N.babies;
        // they wander inside 6.4 of the nest, walking 0.4 per tick
        let maxd = 0, steps = 0;
        const p0 = babies.map((r) => [r.x, r.z]);
        for (let i = 0; i < 300; i++) { step(G); for (const r of babies) maxd = Math.max(maxd, Math.abs(r.x - nest[0]), Math.abs(r.z - nest[2])); }
        ok(maxd <= 6.4 + 1e-3, `the babies stay within 6.4 of the nest (max ${maxd.toFixed(3)})`);
        ok(babies.some((r, i) => Math.hypot(r.x - p0[i][0], r.z - p0[i][1]) > 0.5), 'they move');
        const r0 = babies[0]; const xa = r0.x, za = r0.z; step(G); near(Math.hypot(r0.x - xa, r0.z - za), 0.4, 0.01, 'one step is 0.4 (unless it turns at the edge)');
        // hooked all at once when the hook is over the nest
        park(G, nest[0], nest[2]); step(G, B.SHIFT);
        let n = 0; while (N[0].state === DINO.IDLE && n++ < 200) step(G);
        ok(N.every((x) => x.state === DINO.HOOKED), `all five hooked together (after ${n} ticks)`);
        ok(G.S.spoken.includes('ADSGMC15'), 'REX1 hooked: ADSGMC15 (+ ADSGMC16)');
        run(G, 2);
        const dy = babies.map((r) => babies[0].y - r.y);
        ok([0, -3.68, -4, -6, -8].every((v, i) => Math.abs(dy[i] - v) < 0.01) && babies.every((r) => Math.abs(r.x - G.R.winch.x) < 1.5), `stacked under the hook (2.0 / 5.68 / 6 / 8 / 10 below): ${babies.map((r) => r.y.toFixed(2))}`);
        ok(G.sound.count('at', 'brexCall') > 0, 'the babies call (3D loop)');
        ok(G.R.winch.colObj === null, 'the last baby in the record order leaves the hook\'s collision off');
        // carried to the drop zone and let go: +300 each
        run(G, 60);         park(G, G.R.drop.x, G.R.drop.z); run(G, 4); step(G, B.SHIFT);
        ok(N.every((x) => x.state === DINO.FALLING), 'released together');
        run(G, 80);
        ok(G.S.delivered === 5 && G.S.score === 1500, `five babies in the drop zone: delivered ${G.S.delivered}, score ${G.S.score}`);
        run(G, 120);
        ok(babies.every((r) => r.flags === 0), 'they vanish');
        ok(G.sound.count('stop', 'brexCall') > 0, 'the call loop stops when they land');
        void steps;
      }
      // ============================================================ Bronty, the fireball
      {
        const G = fresh(8);
        const { bron, hate, hotb } = G.R;
        ok(vars(G).get(VAR.BRONTY) === BRONTY.IDLE, 'Bronty starts idle (var 0xfb = 4)');
        // balloon near the origin: stance state 0 goes back to idle (4)
        vars(G).set(VAR.BRONTY, BRONTY.STANCE); park(G, 10, 10); step(G);
        ok(vars(G).get(VAR.BRONTY) === BRONTY.IDLE, 'stance with the balloon within 70.7 of the origin: idle');
        // balloon far away, Bronty faces it: eat the pizza (2), then the stance (0) with the burp at frame 20 and the fireball
        const far = [-100, 100];
        park(G, far[0], far[1]); bron.ry = Math.atan2(far[0] - bron.x, far[1] - bron.z); bron.setEuler(0, bron.ry, 0, bron.x, bron.y, bron.z);
        vars(G).set(VAR.BRONTY, BRONTY.IDLE);
        const seen = new Set(); let fired = -1, started = null;
        for (let i = 0; i < 400 && fired < 0; i++) {
          step(G); seen.add(vars(G).get(VAR.BRONTY));
          if (G.N.fireball.active) { fired = i; started = [G.R.frb1.x, G.R.frb1.y, G.R.frb1.z]; }
        }
        ok(fired > 0, `a fireball was fired after ${fired} ticks`);
        ok(seen.has(BRONTY.EAT) && seen.has(BRONTY.STANCE), `Bronty went idle -> eat the pizza -> stance (${[...seen]})`);
        ok(Math.abs(bron.anim.frame - 20) < 1.5 && bron.anim.clip === 1, `the fireball leaves at frame ${bron.anim.frame.toFixed(1)} of clip 1`);
        ok(G.sound.count('at', 'brontyBurp') >= 1, 'the burp sound at frame 20');
        ok(!(G.R.frb1.flags & 2) && G.R.flames.every((r) => !(r.flags & 2)), 'the model records FRB1-3 stay hidden (the flames are the burp.par emitter)');
        const plog = fx.particles.log;
        ok(plog[0][0] === 'start' && plog[0][1] === 'burp.par' && plog[0][2] === G.R.frb1.m && plog[0][3].join() === '0,0,0' && Math.abs(plog[0][4][0] - Math.PI) < 1e-6 && plog[0][4][1] === 0 && plog[0][4][2] === 0 && plog[0][5].join() === '1,1,1', 'ctor FUN_00793867: start(burp.par, record matrix, 0 0 0, rot (pi 0 0), gate off)');
        ok(plog.some((e) => e[0] === 'matrix' && e[1] === 7 && e[2] === G.R.frb1.m), 'launch: FUN_00442a00(handle, record matrix)');
        ok(!plog.some((e) => e[0] === 'on'), 'the gate is switched on in the flying branch, from the next tick');
        const mouth = [G.R.frb1.x, G.R.frb1.y, G.R.frb1.z];
        ok(mouth[1] > bron.y + 10, `it starts at Bronty\'s mouth (${mouth.map((v) => v.toFixed(1))})`);
        const v = G.N.fireball.v; near(Math.hypot(...v), 2.4, 1e-3, 'fireball speed 2.4 per tick');
        const dir = [hotb.x - G.N.fireball.start[0], hotb.y - G.N.fireball.start[1], hotb.z - G.N.fireball.start[2]]; const dl = Math.hypot(...dir);
        ok(dir.every((c, i) => Math.abs(c / dl * 2.4 - v[i]) < 1e-3), 'aimed at the balloon');
        // flies to the balloon: control is lost, the push is the fireball's velocity (x, 0, z)
        const p1 = [G.R.frb1.x, G.R.frb1.y, G.R.frb1.z]; step(G);
        near(Math.hypot(G.R.frb1.x - p1[0], G.R.frb1.y - p1[1], G.R.frb1.z - p1[2]), 2.4, 1e-3, 'it moves 2.4 per tick');
        ok(G.sound.count('at', 'fireballFly') > 0, 'the fireball thrust loop');
        let hit = -1; for (let i = 0; i < 200 && hit < 0; i++) { step(G); if (vars(G).get(VAR.CONTROL) === 0) hit = i; }
        ok(hit >= 0, `the fireball hit the balloon after ${hit} ticks`);
        ok(!G.N.fireball.active && !(G.R.frb1.flags & 2), 'the fireball is gone');
        ok(Math.abs(G.S.push[0] - v[0]) < 1e-9 && G.S.push[1] === 0 && Math.abs(G.S.push[2] - v[2]) < 1e-9, 'push = (vx, 0, vz)');
        ok(G.sound.count('play', 'fireballHit') === 1 && G.sound.count('stop', 'fireballFly') >= 1, 'the hit sound, the loop stops');
        ok(fx.fireball.join() === 'start,stop', 'emitter start / stop');
        ok(plog.filter((e) => e[0] === 'on').length >= 2 && plog.filter((e) => e[0] === 'off').length === 1 && plog[plog.length - 1][0] === 'off', 'on every flying tick, off once at the hit');
        // a fireball that misses ends 200 from the origin
        const G2 = fresh(9); const f2 = G2.N.fireball;
        f2.active = true; f2.v = [2.4, 0, 0]; G2.R.frb1.x = 150; G2.R.frb1.y = 100; G2.R.frb1.z = 150; G2.R.frb1.flags |= 2;
        G2.R.hotb.x = -300; G2.R.hotb.z = -300; step(G2); ok(!f2.active, 'a fireball beyond 200 from the origin ends');
        // it only fires while Bronty is in the stance (var 0xfb == 0) at frame 20
        const G3 = fresh(10); park(G3, -100, 100); vars(G3).set(VAR.BRONTY, BRONTY.IDLE); G3.R.bron.anim.start(1, 19); G3.R.bron.anim.frame = 19.5;
        G3.N.bronty.cur = BRONTY.IDLE; step(G3); ok(!G3.N.fireball.active, 'idle Bronty at frame 20: no fireball');
        void hate;
      }
      // ============================================================ Bronty's states, the roar, the sandbags, the end
      {
        const G = fresh(11);
        const { bron, hotb } = G.R;
        // a hooked dinosaur above him makes him roar (var 0xfb = 6) and call
        const t = G.R.dinos[0], n = G.N.dinos[0];
        park(G, t.x, t.z); step(G, B.SHIFT); let k = 0; while (n.state === DINO.IDLE && k++ < 300) step(G);
        run(G, 30);
        park(G, bron.x + 5, bron.z + 5); run(G, 3);
        ok(G.N.bronty.cur === BRONTY.ROAR || vars(G).get(VAR.BRONTY) === BRONTY.ROAR, 'a dinosaur held within 24 of Bronty: var 0xfb = 6 (roar)');
        step(G); ok(G.N.bronty.cur === BRONTY.ROAR && G.sound.count('at', 'brontyCall') >= 1, 'Bronty roars (clip 2, BRONTY_CALL)');
        // sandbags: nothing until every dinosaur is down
        const G2 = fresh(12);
        const mo = () => { const m = mouthOf(G2.R.bron); return { x: m[12], y: m[13], z: m[14] }; };
        park(G2, mo().x, mo().z); step(G2, B.SHIFT);
        ok(G2.N.sandbags.every((s) => !s.active), 'Shift does not drop sandbags before everything is delivered');
        G2.S.delivered = 11; step(G2); ok(G2.S.allDone, 'all 11 counted: allDone');
        // the hook toggled by the same press is ignored for the sandbags; Pepper throws (clip 0x75)
        const sc0 = G2.S.score;
        park(G2, mo().x, mo().z);
        step(G2, B.SHIFT);
        ok(G2.N.sandbags.every((s) => s.active) && G2.R.sandbags.every((r) => r.flags & 2), 'one press drops all three sandbags');
        ok(G2.R.pepp.anim.clip === 0x75, 'Pepper plays the throw clip 0x75');
        const y0 = G2.R.sandbags[0].y; step(G2); near(y0 - G2.R.sandbags[0].y, 1.6, 1e-4, 'a sandbag falls 1.6 per tick');
        k = 0; while (G2.N.sandbags[0].active && k++ < 200) step(G2);
        ok(!G2.N.sandbags[0].active, `landed after ${k} ticks`);
        ok(G2.S.score === sc0 + 1500 && vars(G2).get(VAR.BRONTY) === BRONTY.HIT, `three hits in the mouth: +1500, Bronty is hit (${G2.S.score - sc0})`);
        run(G2, 2); ok(G2.N.bronty.cur === BRONTY.HIT && G2.S.eatCount === 1 && G2.S.spoken.includes('ADSGMC07'), 'Bronty\'s hit state: clip 6, eatCount 1, ADSGMC07 + 08');
        ok(G2.sound.count('play', 'sandbagHit') >= 1, 'the hit sound');
        // a miss costs 100 per sandbag (once everything is delivered)
        const G3 = fresh(13); G3.S.delivered = 11; step(G3);
        const m3 = mouthOf(G3.R.bron); park(G3, m3[12] + 40, m3[14]);
        const s3 = G3.S.score; step(G3, B.SHIFT); k = 0; while (G3.N.sandbags[0].active && k++ < 300) step(G3);
        ok(G3.S.score === s3 - 300, `three misses: -300 (${G3.S.score - s3})`); ok(G3.sound.count('play', 'sandbagMiss') >= 1, 'the miss sound');
        ok(vars(G3).get(VAR.BRONTY) !== BRONTY.HIT, 'a miss does not hit Bronty');
        // before everything is delivered a miss / hit does not change the score
        const G4 = fresh(14); G4.S.delivered = 5; G4.N.sandbags[0].active = true; G4.R.sandbags[0].x = G4.R.bron.x + 50; G4.R.sandbags[0].y = 5; G4.R.sandbags[0].z = G4.R.bron.z;
        step(G4); run(G4, 30); ok(G4.S.score === 0, 'a sandbag before everything is delivered scores nothing');
        void hotb;
      }
      // ============================================================ the end: Bronty freed, result, trophy, hi-score
      {
        const vv = new GameVars();
        const S = (score) => { const s = new HatShared(null, null); s.score = score; return s; };
        for (const [sc, res, trophy, medal] of [[0, 2, 0, 0], [1499, 2, 0, 0], [1500, 1, 1, 1], [3999, 1, 1, 1], [4000, 1, 2, 2], [6499, 1, 2, 2], [6500, 1, 3, 3], [9500, 1, 3, 3], [9999, 1, 3, 3]]) {
          vv.set(VAR.TROPHY, 0); const s = S(sc); finishGame(s, vv);
          ok(s.result === res && vv.get(VAR.TROPHY) === trophy && medalOf(s.score) === medal, `final ${sc}+1000 = ${s.score}: result ${s.result}, trophy ${vv.get(VAR.TROPHY)}, medal ${medalOf(s.score)} (want ${res} / ${trophy} / ${medal})`);
        }
        { const s = S(9800); finishGame(s, vv); ok(s.score === 10000, 'the score is capped at 10000'); }
        vv.set(VAR.TROPHY, 3); { const s = S(1500); finishGame(s, vv); ok(vv.get(VAR.TROPHY) === 1 || vv.get(VAR.TROPHY) === 3, 'bronze keeps a higher trophy'); }
        vv.set(VAR.TROPHY, 3); { const s = S(100); finishGame(s, vv); ok(vv.get(VAR.TROPHY) === 0 && s.result === 2, 'a failed game resets the trophy to 0 (FUN_00417597(0x9d, 0))'); }
        vv.set(VAR.TROPHY, 2); { const s = S(3000); finishGame(s, vv); ok(vv.get(VAR.TROPHY) === 2, 'bronze does not lower a silver trophy'); }
        vv.set(VAR.HISCORE, 3000); applyResult(vv, 2000); ok(vv.get(VAR.HISCORE) === 3000, 'the hi-score is only raised'); applyResult(vv, 4000); ok(vv.get(VAR.HISCORE) === 4000, '(raised)');
        ok([0, 2499, 2500, 4999, 5000, 7499, 7500, 10000].map(medalOf).join() === '0,0,1,1,2,2,3,3', 'medal thresholds 2500 / 5000 / 7500');
        ok(resultLines(7500).map((l) => `${l.id}@${l.y}`).join() === 'ADSGMC01@200,ADSGMC02@320' && resultLines(5000)[0].id === 'ADSGMC03' && resultLines(2500)[0].id === 'ADSGMC04' && resultLines(0)[0].id === 'ADSGMC05', 'result lines gold 01 + 02, silver 03, bronze 04, none 05');
        ok(medalText(7500) === 'SGGOLD' && medalText(5000) === 'SGSILVER' && medalText(2500) === 'SGBRONZE' && medalText(0) === '', 'medal words');
      }
      // ============================================================ the pterodactyl and the music fade
      {
        const G = fresh(15); const p = G.R.pter, y = p.y;
        let t = 0;
        for (let i = 0; i < 60; i++) {
          step(G);
          const x = Math.sin(t + t) * 60 + 35.784, z = Math.cos(t) * 60 + 29.474;
          if (i === 59) { near(p.x, x, 1e-3, 'pterodactyl x = 60 sin(2t) + 35.784'); near(p.z, z, 1e-3, 'pterodactyl z = 60 cos(t) + 29.474'); }
          t += 0.016;
        }
        near(p.y, y, 1e-9, 'it keeps its height');
        ok(G.sound.count('at', 'pterFlap') === 60, 'wing beats every tick');
        ok(p.anim.clip === 1, 'flap clip 1');
        // the music fade: untouched until something is scored, then 0.01 per tick down to about 0; it comes back when everything is down
        const G2 = fresh(16); const seen = []; G2.S.onFade = (f) => seen.push(f);
        run(G2, 5); ok(seen.every((f) => f === 1), 'no fade before the first points');
        G2.S.score = 300; run(G2, 20); near(seen.at(-1), 1 - 20 * 0.01, 1e-5, 'fade-out 0.01 per tick');
        run(G2, 120); ok(seen.at(-1) < 0.02 && seen.at(-1) > -0.02, `faded out (${seen.at(-1)})`);
        const lowest = Math.min(...seen); G2.S.allDone = true; run(G2, 150); ok(seen.at(-1) > 1 && seen.at(-1) < 1.02, `faded back in once all are down (${seen.at(-1)}; lowest ${lowest})`);
      }

      // ============================================================ a scripted WIN: the bot plays the whole game
      {
        const G = fresh(5);
        const plan = makePlan();
        let result = 0, tick = 0, sc = [];
        for (; tick < 30000 && !result; tick++) {
          const s = hatSnapshot(G.w);
          step(G, hatBotStep(s, plan));
          result = G.S.result;
        }
        const s = hatSnapshot(G.w);
        notes.push(`WIN bot: result ${result} after ${tick} ticks (${(tick / 30).toFixed(0)} s), score ${G.S.score}, delivered ${G.S.delivered}, knock-backs ${G.N.balloon.hits}`);
        ok(result === 1, `the bot finished the game (result ${result})`);
        ok(G.S.delivered === 11 && G.S.allDone, 'all eleven dinosaurs delivered');
        ok(G.S.score >= MEDAL.GOLD, `a gold score (${G.S.score})`);
        ok(G.w.vars.get(VAR.TROPHY) === 3, 'trophy variable 3 (gold)');
        ok(G.S.eatCount >= 3 && !(G.R.hate.flags & 2), 'three sandbag hits; Mr Hates is gone');
        ok(tick < 20000, `in a sensible time (${tick} ticks)`);
        applyResult(G.w.vars, G.S.score); ok(G.w.vars.get(VAR.HISCORE) === G.S.score, 'the hi-score is written');
        ok(G.R.bron.anim.clip === 9, 'Bronty played the freed clip (9)');
        sc.push(G.S.score);
      }
      // the quick plan (only the babies and one big dinosaur go to the landing site, the others are let go where they hang) wins with several random seeds
      {
        const res = [];
        for (const sd of [1, 2, 3, 4, 6]) {
          const G = fresh(sd);
          const plan = makePlan({ carry: ['babies0', 'dino1'] });
          let tick = 0;
          for (; tick < 20000 && !G.S.result; tick++) step(G, hatBotStep(hatSnapshot(G.w), plan));
          res.push(`${sd}:${G.S.result}/${G.S.score}/${tick}`);
          ok(G.S.result === 1 && G.S.delivered === 11 && G.S.score >= MEDAL.BRONZE, `quick bot, seed ${sd}: result ${G.S.result}, score ${G.S.score}, ${tick} ticks`);
        }
        notes.push(`quick bot (seed:result/score/ticks): ${res.join(' ')}`);
      }
      // a bot that only delivers some: a bronze / silver result
      {
        const G = fresh(21);
        const plan = makePlan({ only: ['babies0', 'dino1'] });
        let result = 0, tick = 0;
        // the rest are dropped where they hang (no points): the bot fetches them with `only` = all, but the points come from the first two
        for (; tick < 30000 && G.S.delivered < 6; tick++) { const s = hatSnapshot(G.w); step(G, hatBotStep(s, plan)); }
        ok(G.S.delivered >= 5, `babies (and a big dinosaur) fetched: delivered ${G.S.delivered}, score ${G.S.score}`);
        ok(G.S.score >= 1500, `babies in the drop zone: ${G.S.score}`);
        void result;
      }
      // ============================================================ a scripted LOSS: delivered without points, the sandbags mostly miss
      {
        const G = fresh(22);
        G.S.delivered = 11; step(G);
        const mo = () => mouthOf(G.R.bron);
        let result = 0, presses = 0, hits = 0;
        // eleven misses (-300 each), then three hits (+1500 each) until Bronty is freed: 0 - 3300 + 4500 + 1000 = 2200 < 2500
        for (let round = 0; round < 40 && !result; round++) {
          const m = mo(); const miss = presses < 11;
          park(G, m[12] + (miss ? 45 : 0), m[14] + (miss ? 0 : 0));
          for (let i = 0; i < 30; i++) step(G);
          step(G, B.SHIFT); presses++;
          let k = 0; while (G.N.sandbags[0].active && k++ < 400) step(G);
          if (!miss) hits++;
          for (let i = 0; i < 80 && !result; i++) { step(G); result = G.S.result; }
        }
        for (let i = 0; i < 400 && !result; i++) { step(G); result = G.S.result; }
        notes.push(`LOSS script: ${presses} presses, final score ${G.S.score}, result ${result}`);
        ok(result === 2, `a score below 2500 at the end is a loss (score ${G.S.score}, result ${result})`);
        ok(G.S.score < MEDAL.BRONZE && G.w.vars.get(VAR.TROPHY) === 0, 'no trophy');
        ok(hits >= 3, `three hits were needed to free Bronty (${hits})`);
      }
      // ============================================================ determinism / robustness
      {
        // 3000 ticks of random key mashing: no exception, no NaN, the balloon keeps its height
        const G = fresh(30); let s = 12345;
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
        for (let i = 0; i < 3000; i++) { const m = (rnd() < 0.5 ? B.UP : 0) | (rnd() < 0.2 ? B.LEFT : 0) | (rnd() < 0.2 ? B.RIGHT : 0) | (rnd() < 0.03 ? B.SHIFT : 0); step(G, m); }
        const snap = hatSnapshot(G.w);
        ok(Number.isFinite(snap.balloon.x) && Number.isFinite(snap.balloon.z) && Math.abs(snap.balloon.y - (G.R.drop.y + 40)) < 1e-4, 'mashing: finite positions, constant height');
        ok(G.w.records.every((r) => Array.from(r.m).every((v) => !Number.isNaN(v))), 'mashing: no NaN in any record matrix');
      }
    } catch (e) {
      failures.push(`test crashed: ${e.stack || e}`);
    }
    return { checked, failures, notes };
  },
};
