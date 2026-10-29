import { loadExe } from '../lib/engine-load.mjs';
import { loadBpk } from '../lib/bpk-load.mjs';
import { bpkBotStep, bpkSnapshot } from '../lib/bpk-bot.mjs';
import { B } from '../../src/game/input.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import { GameVars } from '../../src/game/vars.ts';
import { sceneOf, profileOf } from '../lib/engine-load.mjs';
import { PARK, TRICK, TRICKS, DECAY_CLIPS, dirX, dirY, trickFor, holdsTrick, BpkSkate, SND } from '../../src/zones/z01bpk/skate.ts';
import { BpkRun, BpkSwitch, BpkWalk, CTOR, REC, VAR, GAME_TICKS, MEDAL, WALK, WALK_TARGET, SCORE_STEP, TRICK_NAMES, finishGame } from '../../src/zones/z01bpk/run.ts';
import { readStartMatrix, spectatorsTick, SPECTATOR, START_FN } from '../../src/zones/z01bpk/setup.ts';
import { BPK_SOUND_IDS, BPK_WHEELS, BpkSoundBank } from '../../src/zones/z01bpk/sound.ts';
import { bannerLines } from '../../src/zones/z01BPK.ts';
import { registeredZoneGames } from '../../src/shell/zonegame.ts';
import { zoneIntroFor } from '../../src/shell/zoneintro.ts';
import { ZONE_FILES } from '../../src/ui/strings.ts';
import { LoopMachine, MODE, EXIT } from '../../src/shell/loopmachine.ts';

// z01BPK, the skate park (docs/re/m6/z01BPK.md): the constants against the executable, the zone's three behaviours (the clock and score node, the walk to the board, the
// skateboard with its stunts) on the real zone data with scripted input: the walk-in, the board physics, every stunt of the table, the landing judgement, the score
// counting, the clock, the trophy / hi-score rules, a WIN (a bot skating for the full two minutes), a LOSS (no stunts) and a crash, the spectators and the loop's exits.

const f32 = (pe, va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
const bitsOf = (x) => { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, x, true); return d.getUint32(0, true); };
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
/** does [lo, hi) contain the 32-bit immediate v (little endian) */
function hasImm(pe, lo, hi, v) {
  for (let a = lo; a < hi - 3; a++) if (pe.u32(a) === (v >>> 0)) return true;
  return false;
}

export default {
  name: 'm6-z01BPK',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e, msg) => ok(Math.abs(a - b) <= e, `${msg}: ${a} vs ${b}`);
    const pe = loadExe(ctx.dataRoot);
    const pending = [];

    // ============================================================ numbers of the executable
    // the skateboard (FUN_00490e2e & co): float constants of .rdata
    const consts = [
      [0x8920e8, PARK.FEET, 'feet 1.2'], [0x8924f8, PARK.TURN, 'steer turn 0.00075'], [0x8920cc, PARK.PUSH, 'speed step 0.1'], [0x89237c, PARK.JUMP_V0, 'jump v0 factor 20'],
      [0x8921f8, PARK.CHARGE_STEP, 'charge 0.06'], [0x892028, PARK.CHARGE_MAX, 'charge max 2'], [0x89251c, PARK.WALL_X, 'wall +39.9'], [0x892520, -PARK.WALL_X, 'wall -39.9'],
      [0x8921a4, PARK.WALL_Z, 'wall +24'], [0x892518, -PARK.WALL_Z, 'wall -24'], [0x892514, PARK.FLOOR, 'floor 0.6479'], [0x892504, PARK.CAM_X, 'camera +37.9'], [0x892508, -PARK.CAM_X, 'camera -37.9'],
      [0x8924fc, PARK.CAM_Z, 'camera +21.9'], [0x892500, -PARK.CAM_Z, 'camera -21.9'], [0x8924ec, PARK.WALL_TURN, 'wall turn 0.19635'], [0x892510, PARK.LEDGE_Z, 'ledge z -25'],
      [0x89250c, PARK.PIPE_TOP, 'pipe top 9.25'], [0x8920d0, PARK.AHEAD, 'ledge probe 2.5'], [0x89213c, PARK.PIPE_WALL_Y, 'pipe wall 0.6'], [0x8924e4, PARK.FACE_DOT, 'facing 0.95'],
      [0x8924f0, PARK.SPIN_STOP, 'spin stop -0.65'], [0x8924f4, PARK.SPIN_LEFT_Y, 'spin pick -0.9'], [0x892528, PARK.GROUND_REACH, 'ground reach 40'], [0x89219c, TRICK.MAX, 'progress max 127'],
      [0x892100, TRICK.DIV, 'progress divisor 128'], [0x89201c, TRICK.JUDGE, 'landing judged at 100'], [0x892074, TRICK.SCORE_RUN, 'score 15 per tick'], [0x892038, TRICK.SCORE_END, 'score 30 per tick'],
      [0x892060, SCORE_STEP, 'score counts 10 per tick'], [0x892084, WALK.ARRIVE, 'arrival 0.8'], [0x892530, WALK.FACING_GO, 'facing 6.8'], [0x89228c, WALK.FACING_TURNED, 'facing 6.0'],
      [0x89252c, WALK.TURN, 'walk turn pi / 4'], [0x8920f0, WALK.STEP, 'walk step 0.2'], [0x8924e8, SPECTATOR.TURN, 'spectator turn pi / 8'], [0x892108, SPECTATOR.FACING, 'spectator facing 0.9'],
    ];
    for (const [va, v, name] of consts) near(f32(pe, va), v, 1e-6, `${name} (0x${va.toString(16)})`);
    ok(bitsOf(PARK.DEG) === pe.u32(0x8920d8), `degree 0x8920d8: ${bitsOf(PARK.DEG).toString(16)} vs ${pe.u32(0x8920d8).toString(16)}`);
    near(f32(pe, 0x8d2120), PARK.BUMP_RADIUS, 1e-6, 'bump radius 1.4 (0x8d2120)');
    // immediates of the update (0x490e2e .. 0x4928d2) and the tables
    const U = [0x490e2e, 0x4928d2];
    for (const [v, n] of [[PARK.RADIUS, 'sweep radius 0.8'], [PARK.SKIN, 'sweep skin 0.6'], [PARK.LAUNCH_V0, 'launch v0 30'], [12.0, 'camera y 12'], [-14.0, 'camera z -14'], [PARK.CAM_EASE_AIR, 'camera ease in the air 0.8'], [PARK.CAM_EASE, 'camera ease 0.1'], [PARK.RADIUS2, 'second wall sweep 0.6']]) {
      ok(hasImm(pe, U[0], U[1], bitsOf(v)), `update immediate ${n} = ${v}`);
    }
    ok(pe.u32(0x8d2130) === 0x490e2e && pe.u32(0x8d2134) === 0x4928d2 && pe.u32(0x8d2138) === 0x492e90, 'skate handler table 0x8d2130 = update / pre-render / destroy');
    ok(pe.u32(0x8d23e0) === 0x493dd8 && pe.u32(0x8d2468) === 0x494190, 'clock table 0x8d23e0 -> FUN_00493dd8, walk table 0x8d2468 -> FUN_00494190');
    // the clock and the score (FUN_00494091 / FUN_00493ba0 / FUN_00493ecd)
    ok(hasImm(pe, 0x494091, 0x494152, bitsOf(GAME_TICKS)) && GAME_TICKS === 3600, 'the clock starts at 3600 ticks = 2 minutes (0x45610000 in FUN_00494091)');
    ok(f32(pe, 0x892388) === 60 && f32(pe, 0x892038) === 30, 'clock text: seconds = ticks / 30, minutes = seconds / 60 (0x892038, 0x892388)');
    ok(hasImm(pe, 0x493ecd, 0x493fdd, 0x1388) && hasImm(pe, 0x493ecd, 0x493fdd, 0x9c4) && MEDAL.GOLD === 0x1388 + 1 && MEDAL.SILVER === 0x9c4 + 1 && MEDAL.BRONZE === 1, 'medals: gold above 0x1388 = 5000, silver above 0x9c4 = 2500, bronze above 0');
    {
      const v = new GameVars(); v.loadNames(pe);
      ok(v.nameOf(VAR.TROPHY) === 'SWITCH_GME_TROPHY_BPK' || /TROPHY_BPK/.test(v.nameOf(VAR.TROPHY)), `var 0x8d = ${v.nameOf(VAR.TROPHY)}`);
      ok(/HISCORE_BPK/.test(v.nameOf(VAR.HISCORE)), `var 0xc0 = ${v.nameOf(VAR.HISCORE)}`);
      ok(/PEPPER_CONTROL/.test(v.nameOf(VAR.PEPPER_CONTROL)), `var 0x5e = ${v.nameOf(VAR.PEPPER_CONTROL)}`);
    }
    // the walk-in target (FUN_00494190: 0x4207999a, 0x41826666, 0xc1e80000)
    ok(hasImm(pe, 0x494190, 0x494440, 0x4207999a) && hasImm(pe, 0x494190, 0x494440, 0x41826666) && hasImm(pe, 0x494190, 0x494440, 0xc1e80000), 'walk target 33.9 / 16.3 / -29');
    near(WALK_TARGET[0], 33.9, 1e-5, 'target x'); near(WALK_TARGET[1], 16.3, 1e-5, 'target y'); near(WALK_TARGET[2], -29, 1e-9, 'target z');
    // the texts of the stunts (FUN_0048d52b): BPK3 .. BPK23 at 0x8d1fc0 + 8 * (n - 3); and the other zone strings
    for (let n = 3; n <= 23; n++) ok(pe.cstr(0x8d1fc0 + 8 * (n - 3), 8) === `BPK${n}`, `string BPK${n} at 0x${(0x8d1fc0 + 8 * (n - 3)).toString(16)}: ${pe.cstr(0x8d1fc0 + 8 * (n - 3), 8)}`);
    ok(pe.cstr(0x8d1f8c, 8) === 'BPK2' && pe.cstr(0x8d1fb8, 8) === 'BPK1', 'BPK2 (the brief) at 0x8d1f8c, BPK1 (new hi-score) at 0x8d1fb8');
    ok(pe.cstr(0x8d1fb0, 8) === 'SGGOLD' && pe.cstr(0x8d1fa4, 12) === 'SGSILVER' && pe.cstr(0x8d1f98, 12) === 'SGBRONZE', 'medal texts SGBRONZE / SGSILVER / SGGOLD');
    ok(Object.values(TRICK_NAMES).length === 21 && new Set(Object.values(TRICK_NAMES)).size === 21, '21 stunt names');
    {
      // the switch of FUN_0048d52b: clip -> text; the original's cases: 10 -> BPK6, 0xf -> BPK4, 0x10 -> BPK7, 0x11 -> BPK5, 0x19 -> BPK8, 0x52 -> BPK3, 0x54 -> BPK10, 0x5c -> BPK12,
      // 0x5e -> BPK9, 0x5f -> BPK14, 0x60 -> BPK13, 100 -> BPK20, 0x65 -> BPK17, 0x66 -> BPK19, 0x67 -> BPK11, 0x68 -> BPK16, 0x69 -> BPK15, 0x6a -> BPK21, 0x6b -> BPK18, 0x6c -> BPK23, 0x6d -> BPK22
      const want = { 10: 6, 0xf: 4, 0x10: 7, 0x11: 5, 0x19: 8, 0x52: 3, 0x54: 10, 0x5c: 12, 0x5e: 9, 0x5f: 14, 0x60: 13, 100: 20, 0x65: 17, 0x66: 19, 0x67: 11, 0x68: 16, 0x69: 15, 0x6a: 21, 0x6b: 18, 0x6c: 23, 0x6d: 22 };
      for (const [clip, n] of Object.entries(want)) ok(TRICK_NAMES[clip] === `BPK${n}`, `clip 0x${(+clip).toString(16)} shows BPK${n}`);
      // every stunt of the table has a name
      for (const t of TRICKS) ok(TRICK_NAMES[t.clip], `stunt clip 0x${t.clip.toString(16)} has a text`);
    }
    // the sounds (FUN_00492ec0 loads): the wheels (3D 0x94) and every stunt sound are loads of the original
    {
      const calls = pushCalls(pe, 0x492ec0, 0x4931a0);
      const loaded = new Set(calls.filter((c) => c.target === 0x443580 || c.target === 0x4433b0).map((c) => c.arg));
      ok(loaded.has(BPK_WHEELS) && calls.some((c) => c.target === 0x4433b0 && c.arg === BPK_WHEELS), 'the wheels are the 3D load 0x94');
      for (const id of BPK_SOUND_IDS) ok(loaded.has(id), `sound 0x${id.toString(16)} is loaded by FUN_00492ec0`);
      for (const t of TRICKS) ok(loaded.has(t.sound), `stunt sound 0x${t.sound.toString(16)} is loaded by FUN_00492ec0`);
      ok(SND.FALLOFF === 0x1a8 && loaded.has(0x1a8), 'the crash sound 0x1a8');
    }
    // the start matrix / place read out of the code of FUN_00493506
    {
      const m = readStartMatrix(pe);
      ok(m.size === 12, `12 start values read (${m.size}) from 0x${START_FN[0].toString(16)}`);
      near(m.get(12), 0.25, 1e-6, 'start x'); near(m.get(13), 16, 1e-6, 'start y'); near(m.get(14), -38, 1e-6, 'start z');
      near(m.get(0), 0.998889, 5e-6, 'start m[0] (0x3f7fb731)');
    }

    // ============================================================ stunt table: structure
    ok(TRICKS.length === 20, `20 stunts in the table (${TRICKS.length}: 8 Space, 5 Ctrl, 7 Shift)`);
    ok(TRICKS.filter((t) => t.button === B.SPACE).length === 8 && TRICKS.filter((t) => t.button === B.CTRL).length === 5 && TRICKS.filter((t) => t.button === B.SHIFT).length === 7, 'stunts per button');
    ok(new Set(TRICKS.map((t) => t.clip)).size === 20, 'every stunt has its own clip');
    ok(new Set(TRICKS.map((t) => `${t.button}${t.x}${t.y}`)).size === 20, 'every (button, direction) once');
    for (const t of TRICKS) ok([2, 4, 8].includes(t.rate), `rate of 0x${t.clip.toString(16)} is 2 / 4 / 8`);
    ok(TRICKS.filter((t) => t.rate === 8).map((t) => t.clip).sort((a, b) => a - b).join() === [0x5c, 0x68, 0x6c].join(), 'the fast stunts are 0x5c, 0x68, 0x6c');
    ok(TRICKS.find((t) => t.clip === 0x65).rate === 2, 'Shift + Right is the slow stunt (2)');
    ok(DECAY_CLIPS.length === 9 && DECAY_CLIPS.every((c) => TRICKS.some((t) => t.clip === c)), 'the nine clips that decay when released are stunts of the table');
    ok(dirX(-31) === 'L' && dirX(-30) === null && dirX(-29) === 'C' && dirX(29) === 'C' && dirX(30) === null && dirX(31) === 'R', 'stick thresholds: strict, exactly +-30 is a dead zone');
    ok(dirY(-40) === 'U' && dirY(0) === 'M' && dirY(40) === 'D', 'vertical stick: U / M / D');
    ok(trickFor(B.SPACE, -48, -48)?.clip === 0x69 && trickFor(B.SPACE, 0, 0) === null && trickFor(B.CTRL, 0, -48) === null && trickFor(B.SHIFT, 48, 48) === null, 'trickFor');
    ok(holdsTrick(B.SPACE, -48, -48, 0x69) && !holdsTrick(B.SPACE, -48, -48, 0x52) && !holdsTrick(0, -48, -48, 0x69) && holdsTrick(B.SHIFT, 48, 48, 0x5f), 'holdsTrick (incl. the clip 0x5f only the held-test knows)');
    // the two quirks of the held test (compare chains 0x48e8d0 / 0x48e911 are tautologies on one axis)
    ok(holdsTrick(B.SPACE, -48, 0, 0x67) && holdsTrick(B.SPACE, -48, 96, 0x67) && holdsTrick(B.SPACE, -48, -96, 0x67) && !holdsTrick(B.SPACE, 0, 0, 0x67), '0x67 stays held for any vertical stick (steer < -30 only)');
    ok(holdsTrick(B.SPACE, 0, 96, 0x6d) && holdsTrick(B.SPACE, -96, 96, 0x6d) && holdsTrick(B.SPACE, 96, 96, 0x6d) && !holdsTrick(B.SPACE, 0, 0, 0x6d), '0x6d stays held for any horizontal stick (y > 30 only)');
    ok(!holdsTrick(B.SPACE, 0, 0, 0x52) && holdsTrick(B.SPACE, 0, -48, 0x52) && !holdsTrick(B.SPACE, 48, -48, 0x52), 'the others test both axes');

    // ============================================================ the zone's registration and set-up
    {
      const reg = registeredCtors();
      ok([CTOR.SWITCH, CTOR.WALK, CTOR.SKATE].every((a) => reg.includes(a)), 'the three constructors are registered');
      ok(registeredZoneGames().includes('z01bpk'), 'the zone game is registered');
      ok(zoneIntroFor('z01BPK')?.introId === 'BPK2' && zoneIntroFor('z01BPK')?.helpControls === 0, 'intro BPK2, no controls help');
      ok((ZONE_FILES.z01BPK ?? []).includes('LI/Data/BPK.str'), 'the zone table BPK.str');
      const scene = sceneOf(ctx, 'z01BPK');
      const prof = profileOf(ctx, 'z01BPK');
      const at = prof.setup.attaches;
      ok(at.length === 3 && at[0].ctor === 0x494091 && at[1].ctor === 0x4944f3 && at[2].ctor === 0x492cc2 && at.every((a) => a.record === 35 && a.var === 0x5e), 'three attaches on PEPP (35) gated by PEPPER_CONTROL');
      ok(at[0].mask === 0 && at[1].mask === 1 && at[1].value === 1 && at[2].mask === 4 && at[2].value === 4, 'gates: always / & 1 / & 4');
      ok(at.map((a) => a.pos).join() === '0,1,2', 'chain positions 0, 1, 2');
      ok(scene.records[35].name === 'PEPP' && scene.records[36].name === 'SKBD' && scene.records[37].name === 'INFO' && scene.records[55].name === 'SKEL', 'records: PEPP 35, SKBD 36, spectators 37 .. 55');
      ok(profileOf(ctx, 'z01BPK').setup.hide.some((h) => h.record === 36), 'the board is hidden at set-up');
    }
    const T0 = loadBpk(ctx);
    {
      const { g, P, w } = T0;
      ok(P.ctrl.nodes.map((n) => n.kind).join() === 'bpkSwitch,bpkWalk,bpkSkate', `PEPP chain ${P.ctrl.nodes.map((n) => n.kind)}`);
      ok(g.swc.var === 0x5e && g.swc.mask === 0 && g.walk.mask === 1 && g.walk.value === 1 && g.skate.mask === 4 && g.skate.value === 4, 'node gates');
      ok(w.vars.get(0x5e) === 1 && w.pep.mailbox === 0x1b && w.gravity === -10 && g.run.board === 36, 'FUN_004933c4: PEPPER_CONTROL 1, mailbox 0x1b, gravity -10, the board is record 36');
      ok(!g.board.enabled && g.board.anim?.clip === 0, 'the board is hidden, clip 0');
      ok(P.anim.clip === 0x1b, 'Pepper idles (clip 0x1b)');
      ok(g.spectators.length === 19, `19 spectators (${g.spectators.length})`);
      ok(g.spectators[0].anim.clip === 0x7a && g.spectators[1].anim.clip === 0x7b && g.spectators[16].anim.clip === 0x7a && g.spectators[17].anim.clip === 0x7b && g.spectators[18].anim.clip === 0x7a, 'spectator clips: pairs 0x7a / 0x7b, the judge 0x7a');
      near(P.x, 0.25, 1e-6, 'Pepper x'); near(P.y, 16, 1e-6, 'Pepper y'); near(P.z, -38, 1e-6, 'Pepper z');
      const c = w.camera.c;
      near(c[3], 0.25, 1e-5, 'camera target x'); near(c[4], 19, 1e-5, 'camera target y (3 above Pepper)'); near(c[5], -38, 1e-5, 'camera target z');
      near(c[0], 0.25, 1e-4, 'camera eye x'); near(c[1], 28, 1e-4, 'camera eye y (12 above)'); near(c[2], -22, 1e-4, 'camera eye z (16 in front: the offset turned half a circle)');
    }

    // ============================================================ the walk to the board
    {
      const { g, P, w, step } = loadBpk(ctx);
      let arrive = -1, state0d = -1;
      const seen = new Set();
      for (let i = 0; i < 400 && arrive < 0; i++) {
        step(0);
        seen.add(g.walk.state);
        if (g.walk.state === 0x0d && state0d < 0) state0d = i;
        if (w.vars.get(0x5e) === 4) arrive = i;
      }
      ok(arrive > 100 && arrive < 260, `Pepper reaches the board after ${arrive} ticks`);
      ok(state0d > 0 && state0d < 30, `the idle clip wraps and the walk clip 0x0d starts (tick ${state0d})`);
      const d = Math.hypot(P.x - WALK_TARGET[0], P.y - WALK_TARGET[1], P.z - WALK_TARGET[2]);
      ok(d <= WALK.ARRIVE + 1e-3, `arrived within 0.8 of the target (${d.toFixed(3)})`);
      ok(g.walk.turned === 1, 'he turned towards the board first');
      ok(P.anim.clip === 0x16 && g.board.anim.clip === 1 && g.board.enabled && w.pep.mailbox === 0x16, 'getting on: clip 0x16, board clip 1, board shown, mailbox 0x16');
      ok(g.run.timeLeft === GAME_TICKS && g.swc.time === GAME_TICKS, 'the clock has not started yet (the walk node runs first)');
      const t0 = g.swc.time;
      // the mount: 0x16 for the length of the clip (60 ticks), the clock stands still meanwhile, then push off 0x2d -> rolling 0x29
      const states = [];
      let first2d = -1;
      for (let i = 0; i < 200; i++) { step(0); if (states[states.length - 1] !== g.skate.state) states.push(g.skate.state); if (first2d < 0 && g.skate.state === 0x2d) first2d = i; }
      ok(states[0] === 0x16 && states.includes(0x2d) && states.includes(0x29), `mount sequence ${states.map((s) => s.toString(16))}`);
      ok(first2d >= 55 && first2d <= 70, `0x16 lasts the clip's 60 ticks (0x2d at tick ${first2d})`);
      ok(g.swc.time === t0 - (200 - first2d) + 1 || Math.abs(g.swc.time - (t0 - (200 - first2d))) <= 1, `the clock ran only after the mount (${t0 - g.swc.time} ticks of 200, mount ${first2d})`);
      ok(g.skate.speed > 0.5, `speeds up (${g.skate.speed})`);
      ok(Math.abs(g.board.x - P.x) < 1e-3 && Math.abs(g.board.z - P.z) < 1e-3 && Math.abs(g.board.m[8] - P.m[8]) < 1e-6, 'the board follows Pepper');
      ok(g.run.clockText.length > 0 && g.run.scoreText === '0', `HUD texts: clock "${g.run.clockText}", score "${g.run.scoreText}"`);
    }

    // ============================================================ the board: speed, walls, floor, pipes
    {
      const { g, P, w, step, sounds } = loadBpk(ctx);
      const range = { x: [1e9, -1e9], y: [1e9, -1e9], z: [1e9, -1e9] };
      let pipeTicks = 0, air = 0, launches = 0, prev = 0, maxY = 0, bad = 0, wheelsOn = 0, rolling = false;
      for (let i = 0; i < 1800; i++) {
        step(0);
        if (g.skate.state === 0x29) rolling = true;
        if (!rolling) continue;
        for (const [k, v] of [['x', P.x], ['y', P.y], ['z', P.z]]) { range[k][0] = Math.min(range[k][0], v); range[k][1] = Math.max(range[k][1], v); }
        if (g.skate.onPipe) pipeTicks++;
        if (g.skate.state === 0x20) air++;
        if (g.skate.state === 0x20 && prev !== 0x20) launches++;
        prev = g.skate.state;
        maxY = Math.max(maxY, P.y);
        if (![P.x, P.y, P.z, ...P.m].every(Number.isFinite)) bad++;
      }
      ok(bad === 0, 'no NaN in Pepper over 1800 ticks of free skating');
      ok(range.x[0] >= -PARK.WALL_X - 1e-3 && range.x[1] <= PARK.WALL_X + 1e-3, `x stays within +-39.9 (${range.x.map((v) => v.toFixed(2))})`);
      ok(range.z[0] >= -PARK.WALL_Z - 1e-3 && range.z[1] <= PARK.WALL_Z + 1e-3, `z stays within +-24 (${range.z.map((v) => v.toFixed(2))})`);
      ok(range.y[0] >= PARK.FLOOR - 1e-3, `y never below the floor 0.6479 (${range.y[0].toFixed(3)})`);
      ok(range.x[0] < -35 && range.x[1] > 35, `he reaches both walls (${range.x.map((v) => v.toFixed(1))})`);
      ok(range.z[0] < -15 && range.z[1] > 15, `and both pipes (${range.z.map((v) => v.toFixed(1))})`);
      ok(pipeTicks > 50, `the half-pipes were touched (${pipeTicks} ticks)`);
      ok(launches >= 3 && air > 30, `pipe tops launch him (${launches} launches, ${air} ticks in the air, top ${maxY.toFixed(1)})`);
      ok(maxY > 9.25, 'the launches start above 9.25');
      ok(g.skate.speed === g.skate.maxSpeed && g.skate.maxSpeed === 0.75, 'cruising speed 0.75');
      ok(sounds.some((s) => s.op === 'wheels' && s.on) && sounds.some((s) => s.op === 'wheels' && !s.on), 'the wheels play while rolling and stop in the air');
      wheelsOn = sounds.filter((s) => s.op === 'wheels' && s.on).length;
      ok(wheelsOn > 500, `the wheels loop is refreshed every rolling tick (${wheelsOn})`);
      ok(w.camera.c[0] >= -PARK.CAM_X - 1e-6 && w.camera.c[0] <= PARK.CAM_X + 1e-6 && w.camera.c[2] >= -PARK.CAM_Z - 1e-6 && w.camera.c[2] <= PARK.CAM_Z + 1e-6, 'the camera stays inside the arena');
      near(w.camera.c[4], P.y + 4, 1e-6, 'camera target 4 above Pepper');
    }
    // ---- steering and the key ramp (no brake in the park: Down only moves the vertical stick)
    {
      const { g, P, step, run } = loadBpk(ctx);
      run(260);                                      // on the board
      const ry0 = P.ry;
      run(6, B.LEFT);
      ok(P.ry < ry0 - 0.1, `Left turns (${ry0.toFixed(2)} -> ${P.ry.toFixed(2)})`);
      const sp = g.skate.speed;
      run(4, B.DOWN);
      ok(g.skate.speed === sp, 'Down does not brake in the park');
      ok(g.skate.stickY > 0 && g.skate.rampY > 0x10, `Down ramps the vertical stick (${g.skate.stickY})`);
      run(30, 0);
      ok(g.skate.rampX === 0x10 && g.skate.rampY === 0x10 && g.skate.steer === 0, 'the ramps return to the centre');
      run(3, B.RIGHT);
      ok(g.skate.steer > 0, 'Right steers right');
      void step;
    }

    // ============================================================ the jump: crouch, charge, air, landing; every stunt
    /** drive Pepper to open ground (rolling, on the ground) and return the harness */
    function onOpenGround() {
      const H = loadBpk(ctx);
      for (let i = 0; i < 1500; i++) {
        H.step(0);
        const p = H.P, s = H.g.skate;
        // the flat part of the arena is |z| < 12: start a short crouch + jump at one end heading towards the other
        const north = p.z > -11 && p.z < -6 && p.m[10] > 0.85, south = p.z > 6 && p.z < 11 && p.m[10] < -0.85;
        if (H.w.vars.get(0x5e) === 4 && s.state === 0x29 && p.y < 1 && Math.abs(p.x) < 36 && (north || south) && !s.onPipe) return H;
      }
      throw new Error('no open ground reached');
    }
    {
      const H = onOpenGround();
      const { g, P, step, w } = H;
      // crouch: Alt -> 0x2a (charge starts at 0.1) -> 0x2b held (charge + 0.06 per tick up to 2)
      const states = [];
      const mark = () => { if (states[states.length - 1] !== g.skate.state) states.push(g.skate.state); };
      step(B.ALT); mark();
      ok(g.skate.state === 0x2a && Math.abs(g.skate.charge - 0.1) < 0.07, `Alt starts the crouch 0x2a (charge ${g.skate.charge})`);
      for (let i = 0; i < 60 && g.skate.charge < 1.95; i++) { step(B.ALT); mark(); }
      ok(states.join() === [0x2a, 0x2b].join(), `crouch states ${states.map((s) => s.toString(16))}`);
      near(g.skate.charge, 2.0, 0.07, 'the charge is full (0.1 + 0.06 per tick: about 32 ticks)');
      const full = g.skate.charge;
      for (let i = 0; i < 4; i++) step(B.ALT);
      ok(g.skate.charge >= full && g.skate.charge < 2.07, 'charge is capped at 2 (the last step may overshoot by 0.06)');
      // let go: the jump with v0 = charge * 20
      step(0); mark();
      ok(g.skate.state === 0x20, 'releasing Alt jumps (0x20)');
      ok(g.skate.v0 > 38 && g.skate.v0 < 42 && Math.abs(g.skate.v0 - full * 20) < 1.3, `v0 = charge * 20 (${g.skate.v0})`);
      let ymax = 0, ticks = 0;
      const y0 = P.y;
      while (g.skate.state === 0x20 && ticks < 200) { ticks++; ymax = Math.max(ymax, P.y); step(0); }
      ok(ticks >= 24 && ticks <= 36, `the jump lasts ${ticks} ticks`);
      ok(ymax - y0 > 24 && ymax - y0 < 30, `a full jump goes ${(ymax - y0).toFixed(1)} high (v0 t - 15 t^2: 26.7)`);
      ok(g.skate.state === 0x21 || g.skate.state === 0x29, `landing (state ${g.skate.state.toString(16)})`);
      ok(g.skate.t === 0 && g.skate.grounded === 1, 'landed: no time in the air, grounded');
      ok(g.run.trickFlag === 1 || g.swc.counting === 1 || g.run.trickScore === 0, 'a jump without a stunt: the landing passes (trick flag 1, nothing to count)');
      for (let i = 0; i < 60; i++) step(0);
      ok(g.skate.state === 0x29, 'rolling again');
      void w;
    }
    // ---- all 20 stunts: the clip, the board clip, the rate, the sound
    for (const t of TRICKS) {
      const H = onOpenGround();
      const { g, P, step, sounds } = H;
      const dir = (t.x === 'L' ? B.LEFT : t.x === 'R' ? B.RIGHT : 0) | (t.y === 'U' ? B.UP : t.y === 'D' ? B.DOWN : 0);
      // pre-steer so that the stick is already deflected when the jump leaves the ground (the stunt starts in the air)
      for (let i = 0; i < 40 && !(g.skate.state === 0x2b && g.skate.charge >= 1.0); i++) step(B.ALT);
      let started = -1;
      let maxProg = 0;
      const n0 = sounds.length;
      for (let i = 0; i < 40 && g.skate.state !== 0x21; i++) {
        step(t.button | dir);       // Alt released = jump; the stunt keys are held from the first tick
        if (started < 0 && P.anim.clip === t.clip) started = i;
        maxProg = Math.max(maxProg, g.skate.progress);
      }
      const label = `stunt 0x${t.clip.toString(16)} (${t.button === B.SPACE ? 'Space' : t.button === B.CTRL ? 'Ctrl' : 'Shift'} + ${t.x}${t.y})`;
      ok(started >= 0 && started <= 4, `${label} starts in the air (tick ${started})`);
      ok(maxProg > 20, `${label}: progress rises (${maxProg.toFixed(0)})`);
      near(g.skate.trickRate, t.rate, 1e-9, `${label} rate`);
      if (t.board !== 0) ok(H.g.board.anim.clip === t.board, `${label}: board clip 0x${t.board.toString(16)} (${H.g.board.anim.clip})`);
      ok(sounds.slice(n0).some((s) => s.op === 'play' && s.id === t.sound), `${label} plays sound 0x${t.sound.toString(16)}`);
      ok([P.x, P.y, P.z, ...P.m].every(Number.isFinite), `${label}: no NaN`);
    }
    // ---- precedence: Space then Ctrl then Shift (a later one overrides, every one plays its sound)
    {
      const H = onOpenGround();
      const { g, P, step, sounds } = H;
      for (let i = 0; i < 40 && !(g.skate.state === 0x2b && g.skate.charge >= 1.0); i++) step(B.ALT);
      const n0 = sounds.length;
      for (let i = 0; i < 6; i++) step(B.SPACE | B.SHIFT | B.LEFT | B.UP);
      ok(P.anim.clip === 0x10 || P.anim.clip === 0x69, `Space + Shift + Left + Up: one of the two (0x${P.anim.clip.toString(16)})`);
      ok(sounds.slice(n0).some((s) => s.id === 0x1b2) && sounds.slice(n0).some((s) => s.id === 0x1ab), 'both stunts play their sound');
      void g;
    }

    // ============================================================ the stunt's progress, the landing judgement, the score
    /** a jump with a stunt, driven by the bot's rules; returns what happened */
    function oneJump(plan, extra = {}) {
      const H = onOpenGround();
      const { g, P, step } = H;
      const snap = () => bpkSnapshot({ ...g, world: H.w });
      let started = false, landed = false, crash = false, log = [];
      const sc0 = g.swc.score;
      for (let i = 0; i < 400 && !landed; i++) {
        const mask = bpkBotStep(snap(), plan);
        step(mask);
        if (g.skate.state === 0x20) started = true;
        if (started && g.skate.state === 0x23) crash = true;
        if (started && (g.skate.state === 0x21 || g.skate.state === 0x23)) { log.push({ tsc: g.run.trickScore, prog: g.skate.progress, mid: g.skate.trickMid, flag: g.run.trickFlag }); landed = true; }
      }
      // FUN_0048f66d case 0x21 resets `evaluated` at the end of the landing clip and judges again in the same call: the judgement of a landing after the first one of the
      // run happens when the landing clip (9 frames) ends, so a crash shows as 0x23 up to ~10 ticks after the touch-down
      for (let i = 0; i < 14 && !crash; i++) { step(0); if (g.skate.state === 0x23) crash = true; }
      // let the landing and the counting finish
      const peak = { tsc: 0, prog: 0 };
      for (let i = 0; i < 60; i++) step(0);
      return { H, crash, landed, log: log[0], gained: g.swc.score - sc0, pending: g.swc.pending, ...extra, peak, state: g.skate.state };
    }
    {
      const r = oneJump({});
      ok(r.landed && !r.crash, 'Space + Left + Up, released at 80: a clean landing');
      ok(r.gained > 300 && r.gained < 420 && r.pending === 0, `the stunt score moved into the total (${r.gained})`);
      ok(r.log.prog > 85 && r.log.prog <= 100, `progress at the landing ${r.log.prog.toFixed(0)} (<= 100: no crash)`);
      ok(r.log.tsc > 300 && r.log.tsc < 430 && r.log.tsc % 15 === 0, `trick score 15 per tick (${r.log.tsc})`);
    }
    {
      // the score counts up 10 per tick
      const H = onOpenGround();
      const { g, step } = H;
      const snap = () => bpkSnapshot({ ...g, world: H.w });
      let counting = null;
      for (let i = 0; i < 400; i++) {
        const prevScore = g.swc.score;
        step(bpkBotStep(snap(), {}));
        if (g.swc.counting && g.swc.score - prevScore > 0 && counting === null) { counting = g.swc.score - prevScore; }
        if (counting !== null) break;
      }
      ok(counting === 10, `the total counts up 10 per tick (${counting})`);
      for (let i = 0; i < 80; i++) step(0);
      ok(g.swc.pending === 0 && g.swc.score % 5 === 0, 'counting ends when the pending score is used up');
    }
    {
      // a stunt held through the landing past 100: the crash (state 0x23, the stunt score is lost, the speed is 0)
      const r = oneJump({ trick: { button: B.SPACE, dir: B.LEFT | B.DOWN }, hold: true });
      ok(r.landed && r.crash, 'Space + Left + Down (0x68, rate 8) held to the landing: a crash');
      ok(r.gained === 0 && r.H.g.run.trickScore === 0 && r.H.g.run.trickFlag === 0, `nothing is scored (${r.gained})`);
      ok(r.H.sounds.some((s) => s.op === 'play' && s.id === SND.FALLOFF), 'the crash sound 0x1a8');
      ok([0x29, 0x2d].includes(r.state) && r.H.g.skate.maxSpeed === PARK.MAX_SPEED, `after the crash clip: pushing off / rolling at the normal speed again (state 0x${r.state.toString(16)}, max ${r.H.g.skate.maxSpeed})`);
    }
    {
      // the same stunt released early decays and lands clean
      const r = oneJump({ trick: { button: B.SPACE, dir: B.LEFT | B.DOWN }, release: 60 });
      ok(r.landed && !r.crash, 'the decaying stunt released at 60 lands clean');
      ok(r.log.prog <= 100, `its progress fell to ${r.log.prog.toFixed(0)} by the landing`);
      ok(r.gained > 100, `and it scored (${r.gained})`);
    }
    {
      // a non-decaying stunt held to the landing: progress <= 100 at the landing = fine; a longer flight (the pipe launch, v0 30 from 9 up) goes past 100 = crash
      const r = oneJump({ hold: true });
      ok(r.landed, 'Space + Left + Up held: lands');
      ok(r.crash === (r.log.prog > 100), `landing judgement follows the progress (${r.log.prog.toFixed(0)}, crash ${r.crash})`);
    }
    {
      // the speed boost of a stunt: maxSpeed + 0.1 per completed stunt whose score is pending while the board is at full speed, up to 1.0
      const H = onOpenGround();
      const { g, step } = H;
      const snap = () => bpkSnapshot({ ...g, world: H.w });
      let boosted = 0;
      for (let i = 0; i < 1500 && boosted < 1; i++) {
        step(bpkBotStep(snap(), { trick: { button: B.SPACE, dir: B.LEFT | B.DOWN }, release: 70 }));
        if (g.skate.maxSpeed > 0.75) boosted = g.skate.maxSpeed;
      }
      ok(boosted > 0.75 && boosted <= 1.1, `a released stunt raises maxSpeed (${boosted})`);
    }

    // ============================================================ the clock, the hi-score rules
    {
      const v = new GameVars();
      const run = new BpkRun();
      finishGame(run, v, 0);
      ok(run.medal === 0 && v.get(VAR.TROPHY) === 0 && run.result === 2 && v.get(VAR.HISCORE) === 0 && run.newHiscore === 0, 'score 0: no medal, failed (result 2), no hi-score');
      const r2 = new BpkRun(); finishGame(r2, v, 1);
      ok(r2.medal === 1 && v.get(VAR.TROPHY) === 1 && r2.result === 1 && v.get(VAR.HISCORE) === 1 && r2.newHiscore === 1, 'score 1: bronze, success, new hi-score');
      const r3 = new BpkRun(); finishGame(r3, v, 2500);
      ok(r3.medal === 1 && v.get(VAR.TROPHY) === 1 && v.get(VAR.HISCORE) === 2500, '2500: still bronze');
      const r4 = new BpkRun(); finishGame(r4, v, 2501);
      ok(r4.medal === 2 && v.get(VAR.TROPHY) === 2 && v.get(VAR.HISCORE) === 2501, '2501: silver');
      const r5 = new BpkRun(); finishGame(r5, v, 5000);
      ok(r5.medal === 2 && v.get(VAR.TROPHY) === 2 && v.get(VAR.HISCORE) === 5000, '5000: still silver');
      const r6 = new BpkRun(); finishGame(r6, v, 5001);
      ok(r6.medal === 3 && v.get(VAR.TROPHY) === 3 && v.get(VAR.HISCORE) === 5001 && r6.finalScore === 5001, '5001: gold');
      const r7 = new BpkRun(); finishGame(r7, v, 100);
      ok(r7.medal === 1 && v.get(VAR.TROPHY) === 3 && v.get(VAR.HISCORE) === 5001 && r7.newHiscore === 0 && r7.result === 1, 'a worse run keeps the trophy and the hi-score; the stored trophy decides success (result 1)');
      const v2 = new GameVars(); v2.set(VAR.TROPHY, 2);
      const r8 = new BpkRun(); finishGame(r8, v2, 0);
      ok(r8.result === 1 && v2.get(VAR.TROPHY) === 2, 'a run without points still succeeds when a trophy exists already');
      // the banner lines (FUN_0048d3d1)
      const std = { text: (id) => id }, zone = { text: (id) => id };
      const b = bannerLines(r6, std, zone);
      ok(b.map((l) => `${l.text}@${l.y}/${l.wrap}`).join() === '5001@50/10,SGGOLD@100/6,BPK1@150/20', `gold banner ${b.map((l) => l.text + '@' + l.y)}`);
      ok(bannerLines(r7, std, zone).map((l) => `${l.text}@${l.y}/${l.wrap}`).join() === '100@50/10,SGBRONZE@100/8', 'bronze banner without the hi-score line');
      ok(bannerLines(r4, std, zone).some((l) => l.text === 'SGSILVER' && l.wrap === 8), 'silver banner');
      ok(bannerLines(new BpkRun(), std, zone).length === 0, 'no points: no banner text');
    }

    // ============================================================ WIN: a bot skates the full two minutes
    {
      const H = loadBpk(ctx);
      const { g, w, step } = H;
      let crashes = 0, jumps = 0, prev = 0, ticksAtEnd = 0;
      for (let i = 0; i < 4200 && !g.run.result; i++) {
        step(bpkBotStep(bpkSnapshot({ ...g, world: w }), {}));
        if (g.skate.state === 0x23 && prev !== 0x23) crashes++;
        if (g.skate.state === 0x20 && prev !== 0x20) jumps++;
        prev = g.skate.state;
      }
      ticksAtEnd = w.tickCount;
      ok(g.run.result === 1, `the bot's run ends with success (result ${g.run.result})`);
      ok(g.run.finalScore >= MEDAL.GOLD, `a gold score (${g.run.finalScore})`);
      ok(g.run.medal === 3 && w.vars.get(VAR.TROPHY) === 3 && w.vars.get(VAR.HISCORE) === g.run.finalScore && g.run.newHiscore === 1, 'TROPHY_BPK = 3, HISCORE_BPK = the score, new hi-score');
      ok(g.swc.time === 0 && g.swc.over === 0, 'the clock ran out');
      // 3600 ticks of the clock + the walk (~190) + the mount (60: the clock waits for it)
      ok(ticksAtEnd >= 3600 + 200 && ticksAtEnd <= 3600 + 400, `the whole game is ${ticksAtEnd} ticks (clock 3600 + walk-in + mount)`);
      ok(jumps >= 20, `${jumps} jumps, ${crashes} crashes`);
      ok(g.swc.pending === 0 || g.run.finalScore === Math.trunc(g.swc.score), 'the final score is the counted total (a stunt still being counted is lost)');
      ok(g.run.clockText === '0:00', `the clock text ends at 0:00 ("${g.run.clockText}")`);
      notes.push(`WIN: ${jumps} jumps, ${crashes} crashes, score ${g.run.finalScore}, ${ticksAtEnd} ticks`);
    }
    // ============================================================ LOSS: no stunts
    {
      const H = loadBpk(ctx);
      const { g, w, step } = H;
      for (let i = 0; i < 4200 && !g.run.result; i++) step(0);
      ok(g.run.result === 2 && g.run.finalScore === 0 && g.run.medal === 0, `no input: result 2 (failed), score ${g.run.finalScore}`);
      ok(w.vars.get(VAR.TROPHY) === 0 && w.vars.get(VAR.HISCORE) === 0 && g.run.newHiscore === 0, 'no trophy, no hi-score');
      ok(bannerLines(g.run, { text: (id) => id }, { text: (id) => id }).length === 0, 'the banner is empty (and skipped: DAT_05d580bc < 1)');
    }
    // ============================================================ the clock details
    {
      const H = loadBpk(ctx);
      const { g, w, step, P } = H;
      const texts = new Set();
      for (let i = 0; i < 400; i++) { step(0); if (w.vars.get(0x5e) === 4) texts.add(g.run.clockText); if (i > 270) break; }
      ok(texts.has('2:00') || texts.has('1:59'), `the clock starts at 2:00 / 1:59 (${[...texts]})`);
      g.swc.time = 61;
      step(0);
      ok(g.run.clockText === '0:02', `61 ticks - 1 = 60 ticks = ${g.run.clockText}`);
      g.swc.time = 1801; step(0); ok(g.run.clockText === '1:00', `1800 ticks = ${g.run.clockText}`);
      g.swc.time = 3600; step(0); ok(g.run.clockText === '1:59', `3599 ticks = ${g.run.clockText}`);
      g.swc.time = 90;
      step(0); ok(g.run.clockText === '0:02', `89 ticks = ${g.run.clockText}`);
      g.swc.time = 31; step(0); ok(g.run.clockText === '0:01', `30 ticks = ${g.run.clockText}`);
      g.swc.time = 30.5; step(0);
      ok(g.run.clockText === '0:00', `29.5 ticks = ${g.run.clockText}`);
      g.swc.time = 1; step(0);
      ok(g.swc.time === 0 && g.run.timeLeft === 0, 'the clock reaches 0');
      step(0);
      ok(g.run.result !== 0, 'the game ends when the time is up');
      void P;
    }
    {
      // the clock stands still while Pepper gets on (clip 0x16) and runs otherwise; PEPPER_CONTROL must be exactly 4
      const H = loadBpk(ctx);
      const { g, w, step } = H;
      for (let i = 0; i < 400 && w.vars.get(0x5e) !== 4; i++) step(0);
      step(0);
      const t = g.swc.time;
      ok(t === GAME_TICKS, 'time stands at 3600 while mounting');
      w.vars.set(0x5e, 4 | 0x1000);
      const before = g.swc.time;
      step(0);
      ok(g.swc.time === before, 'PEPPER_CONTROL != 4 exactly: the clock node does nothing');
      w.vars.set(0x5e, 4);
    }

    // ============================================================ the spectators
    {
      const H = loadBpk(ctx);
      const { g, w, P, step } = H;
      spectatorsTick(w, g);
      for (let i = 0; i < 30; i++) spectatorsTick(w, g);
      let facing = 0;
      for (const r of g.spectators) {
        const dx = P.x - r.x, dz = P.z - r.z, l = Math.hypot(dx, dz);
        const dot = (r.m[8] * dx + r.m[10] * dz) / l;
        if (dot > 0.99) facing++;
      }
      ok(facing >= 12, `the spectators turn to Pepper (${facing} of 19 face him)`);
      const a0 = g.spectators[0].anim.frame;
      spectatorsTick(w, g);
      ok(g.spectators[0].anim.frame !== a0 || g.spectators[0].anim.frameCount <= 1, 'their clips advance');
      void step;
    }

    // ============================================================ the loop around it (loopmachine.ts with the zone's config)
    {
      const cfg = { hub: false, pauseKind: 1, pauseMask: 0x40, intro: true, help: false, results: true };
      const m = new LoopMachine(cfg);
      let guard = 0;
      while (m.mode !== MODE.INTRO && guard++ < 100) m.tick({ pressed: 0 });
      ok(m.mode === MODE.INTRO, 'fade in -> intro');
      m.tick({ pressed: B.ENTER });
      ok(m.mode === MODE.PLAY, 'a button starts the game (no help screen)');
      m.tick({ pressed: 0, gameOver: 1 });
      ok(m.mode === MODE.BANNER, 'the game over goes to the banner');
      m.tick({ pressed: B.ENTER });
      ok(m.mode === MODE.RESULT, 'a button: the result menu');
      m.tick({ pressed: 0, resultResult: 1 });
      guard = 0; while (!m.done && guard++ < 100) m.tick({ pressed: 0 });
      ok(m.exit === EXIT.FINISHED, 'Continue: exit state 2');
      const m2 = new LoopMachine(cfg);
      guard = 0; while (m2.mode !== MODE.INTRO && guard++ < 100) m2.tick({ pressed: 0 });
      m2.tick({ pressed: B.ENTER });
      m2.tick({ pressed: 0, gameOver: 2 });
      m2.tick({ pressed: B.ENTER });
      m2.tick({ pressed: 0, resultResult: -3 });
      guard = 0; while (!m2.done && guard++ < 100) m2.tick({ pressed: 0 });
      ok(m2.exit === EXIT.ABANDON, 'failed: Abort leaves with exit state 4');
    }
    // ============================================================ sound bank
    {
      const calls = [];
      const backend = {
        load2D: async (id) => ({ id, k: '2d' }), load3D: async (id) => ({ id, k: '3d' }),
        play2D: (s) => { calls.push(['play2D', s.id]); return true; }, play3D: (s, p) => { calls.push(['play3D', s.id, p.x]); return true; }, stop: (s) => { calls.push(['stop', s.id]); }, setRate() {},
      };
      const bank = new BpkSoundBank(backend);
      ok(Object.keys(bank.bank.defs).length === 1 + BPK_SOUND_IDS.length, 'the bank has the wheels and every stunt sound');
      ok(bank.bank.defs.wheels.kind === '3d' && bank.bank.defs.s426.kind === '2d', 'the wheels are positional, the stunt sounds plain');
      // not loaded yet: calls are dropped without an error
      bank.play(0x1aa); bank.wheels(true, [1, 2, 3]);
      ok(calls.length === 0, 'nothing plays before the slots are loaded');
      pending.push(bank.load().then(() => {
        bank.play(0x1aa); bank.play(0x9999); bank.stop(0x1aa); bank.wheels(true, [1, 2, 3]); bank.wheels(false, [0, 0, 0]); bank.wheels(false, [0, 0, 0]);
        const names = calls.map((c) => c.join(':')).join();
        if (names !== 'play2D:426,stop:426,play3D:148:1,stop:148') failures.push(`sound bank calls: ${names}`);
        checked++;
      }));
    }
    notes.push(`${TRICKS.length} stunts checked in the air`);
    void bpkBotStep; void BpkWalk; void BpkSwitch; void BpkSkate; void REC; void SCORE_STEP; void TRICK; void CTOR; void holdsTrick;
    await Promise.all(pending);
    return { checked, failures, notes };
  },
};
