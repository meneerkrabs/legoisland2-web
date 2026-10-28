import { CentrifugeSim, S, SND, PEP, BOB, K, REC, REC_NAMES, readFrameTable, FRAME_TABLE_VA, MEDAL_MIN, MEDAL_SILVER, MEDAL_GOLD, VAR_HISCORE_CNT, VAR_TROPHY_CNT, TWO_PI, PI } from '../../src/zones/z36cnt/sim.ts';
import { layoutFrom, poseAt, ghostCount, ghostAlpha, ghostStep, SEAT, armShadows, SHADOW_POINTS, SHADOW_ORDER, SHADOW_TYPE } from '../../src/zones/z36cnt/pose.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { readExeSoundTable } from '../../src/formats/sound.ts';
import { loadExe, sceneOf } from '../lib/engine-load.mjs';

// z36CNT, the centrifuge (docs/re/m3/z36CNT.md): the rules of the DOM-free sim driven with scripted input (a perfect player = WIN, no input = LOSS, mistimed
// presses, the medal thresholds, the hi-score rule, Bob's controller, the monitor frame ranges, the lights), the arm / chair / Pepper placement, and the
// constants and tables checked against the executable (sound ids, frame table, immediates of the constructor and of the result code).

const L = 1, R = 2, BTN = 0x40;
const f32 = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };

/** deterministic PRNG */
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

export default {
  name: 'm3-z36cnt',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, t = 1e-5) => Math.abs(a - b) <= t;
    const pe = loadExe(ctx.dataRoot);
    const archive = ctx.archives.find((a) => a.name === 'z36CNT');
    if (!archive) return { checked: 0, failures: ['archive z36CNT not found'], notes };
    const rigData = parseBlk(archive.read(archive.find('anim/MFIG.blk')));
    const table = readFrameTable((va) => pe.u32(va));

    // ============================================================ the executable: tables and immediates
    ok(JSON.stringify(table) === JSON.stringify([[0, 0], [0, 9], [10, 40], [40, 51], [51, 67], [67, 87], [87, 98], [98, 98], [100, 110]]), `frame table at 0x${FRAME_TABLE_VA.toString(16)}: ${JSON.stringify(table)}`);
    const snd = readExeSoundTable(pe.data);
    const names = { 0xca: 'SND_CNT_AMBIENT', 0xcb: 'SND_CENT_SEATBELT', 0xcc: 'SND_CNT_VISOR', 0xcd: 'SND_CNT_PHEW', 0xce: 'SND_CNT_BIGBUTTON', 0xcf: 'SND_CNT_START', 0xd0: 'SND_CNT_BRAKE_OFF', 0xd1: 'SND_CNT_BRAKE', 0xd2: 'SND_CNT_ENGINE', 0xd3: 'SND_CNT_SWISH', 0xd4: 'SND_CNT_LRED', 0xd5: 'SND_CNT_LGREEN', 0xd6: 'SND_RRED', 0xd7: 'SND_RGREEN', 0xd8: 'SND_CNT_KLAXON', 0xd9: 'SND_BOB_BUTTON1', 0xda: 'SND_BOB_BUTTON2', 0xdb: 'SND_BOB_BUTTON3', 0xdc: 'SND_BOB_BUTTON4' };
    for (const [id, n] of Object.entries(names)) ok(snd[+id]?.name === n, `sound ${(+id).toString(16)} is ${snd[+id]?.name}, expected ${n}`);
    ok(Object.values(SND).length === 19 && Object.values(SND).every((id) => names[id]), 'SND covers the 19 ids FUN_007af780 loads');
    // FUN_007af780: FUN_00443580(0xca..0xdc) as push imm8/imm32 + call: the 19 ids appear in order
    {
      const code = pe.slice(0x7af780, 0x170);
      let found = 0;
      for (let i = 0; i < code.length - 1; i++) if (code[i] === 0x68 && (code[i + 1] >= 0xca && code[i + 1] <= 0xdc) && code[i + 2] === 0 && code[i + 3] === 0 && code[i + 4] === 0) found++;
      ok(found === 19, `FUN_007af780 pushes the 19 sound ids (${found})`);
    }
    // immediates of the TRAI constructor FUN_007b20a8 (stored as dwords): the controller constants
    {
      const code = pe.slice(0x7b20a8, 0x3a0);
      const has = (u) => { for (let i = 0; i + 4 <= code.length; i++) if ((code[i] | code[i + 1] << 8 | code[i + 2] << 16 | code[i + 3] << 24) >>> 0 === u) return true; return false; };
      for (const [what, u] of [['OMEGA_MIN', 0x3d567704], ['OMEGA_MAX', 0x3e860a63], ['BOOST', 0x3c23d70a], ['WINDOW', 0x40300000], ['TIME', 0x44e10000], ['seat y', 0xc04ccccd], ['seat z', 0x3fcccccd], ['visor y', 0x3f3a5e35]]) ok(has(u), `constructor immediate 0x${u.toString(16)} (${what})`);
      ok(near(K.OMEGA_MIN, 3 * Math.PI / 180, 1e-4) && near(K.OMEGA_MAX, 15 * Math.PI / 180, 1e-4), `speeds are 3 and 15 degrees per tick (${K.OMEGA_MIN}, ${K.OMEGA_MAX})`);
      ok(K.WINDOW === 2.75 && K.TIME === 1800 && near(K.BOOST, 0.01, 1e-8), 'window factor 2.75, time 1800, boost 0.01');
    }
    // the result code: the medal limits 1999 / 3999 (< 4000) / 5999 (< 6000) / 2000 compare as immediates of FUN_007b0c6e and FUN_007b0085
    {
      const has = (va, len, bytes) => { const c = pe.slice(va, len); outer: for (let i = 0; i + bytes.length <= c.length; i++) { for (let j = 0; j < bytes.length; j++) if (c[i + j] !== bytes[j]) continue outer; return true; } return false; };
      ok(has(0x7b0c6e, 0xd00, [0x81, 0xba, 0x2c, 0x01, 0x00, 0x00, 0xd0, 0x07, 0x00, 0x00]), 'score (+0x12c) compared with 2000 (1999 < score) in the stop state');
      ok(has(0x7b0c6e, 0xd00, [0x70, 0x17, 0x00, 0x00]) && has(0x7b0c6e, 0xd00, [0xa0, 0x0f, 0x00, 0x00]), '6000 / 4000 compared in the result state');
      ok(has(0x7b0c6e, 0xd00, [0xd0, 0x07, 0x00, 0x00]), '2000 compared for the final result');
      ok(MEDAL_MIN === 2000 && MEDAL_SILVER === 4000 && MEDAL_GOLD === 6000, 'medal constants');
    }
    // the scene
    {
      const sc = sceneOf(ctx, 'z36CNT');
      ok(REC_NAMES.every((n, i) => sc.records[i]?.name === n), `scene records are ${sc.records.map((r) => r.name).join(' ')}`);
      ok(sc.records.length === 20, '20 records');
      const gv = pe.cstr(0x8a3228); void gv;
    }
    ok(rigData.clips.length === 16 && rigData.clips[PEP.BELT].frameCount === 57 && rigData.clips[PEP.VISOR].frameCount === 56 && rigData.clips[PEP.SPIN].frameCount === 60, `MFIG.blk of the zone: ${rigData.clips.length} clips, belt ${rigData.clips[PEP.BELT]?.frameCount}, visor ${rigData.clips[PEP.VISOR]?.frameCount}`);

    // ============================================================ host
    function makeHost(seed = 1) {
      const vars = new Map([[VAR_HISCORE_CNT, 0], [VAR_TROPHY_CNT, 0]]);
      const r = rng(seed);
      const h = {
        pep: new AnimInstance(rigData), bob: new AnimInstance(rigData),
        vis: Array(20).fill(true), plays: [], stops: [], rates: [], said: [], visorAngles: [],
        show(i, on) { h.vis[i] = on; },
        play(id) { h.plays.push(id); }, stop(id) { h.stops.push(id); }, rate(id, hz) { h.rates.push([id, hz]); },
        say(id) { h.said.push(id); },
        getVar: (i) => vars.get(i) ?? 0, setVar: (i, v) => vars.set(i, v), vars,
        rand: () => r(), visor(a) { h.visorAngles.push(a); },
      };
      return h;
    }
    const mk = (seed, host = makeHost(seed)) => ({ host, sim: new CentrifugeSim(host, table) });
    /** one world tick: Bob's controller (record 0) first, then the machine (record 18), like the record order */
    const tick = (sim, pressed = 0) => { sim.bobStep(); sim.step(pressed); };
    /** the intro / seat-belt / start sequence up to the first RUN tick; returns the ticks used */
    function startRun(sim) {
      let n = 0;
      tick(sim); n++;                                   // state 0 -> 1
      ok(sim.state === S.BELT, 'state 1 (seat belt) after the first tick');
      tick(sim, BTN); n++;
      ok(sim.state === S.WAIT && sim.clip === PEP.BELT, 'the button starts the belt clip');
      while (sim.state !== S.START && n < 400) { tick(sim); n++; }
      ok(sim.state === S.START && sim.clip === PEP.IDLE, `belt + visor clips end in state 2 after ${n} ticks`);
      tick(sim, BTN); n++;
      ok(sim.state === S.WAIT && sim.clip === PEP.START, 'the button releases the brake (start clip)');
      while (sim.state !== S.RUN && n < 800) { tick(sim); n++; }
      ok(sim.state === S.RUN && sim.clip === PEP.SPIN && sim.power === 0 && sim.time === 1800, 'start clip ends: running, power 0, 1800 ticks left');
      return n;
    }
    /** the perfect player: press left in the top window, right in the bottom window, as soon as the latch allows */
    const perfect = (sim) => { const z = sim.zoneOf(); if (z === 'top' && !sim.latchL) return L; if (z === 'bottom' && !sim.latchR) return R; return 0; };
    function runGame(sim, pick, maxTicks = 4000) {
      let n = 0;
      while (sim.result === 0 && n < maxTicks) { tick(sim, sim.state === S.RUN ? pick(sim) : 0); n++; }
      return n;
    }

    // ============================================================ scripted WIN: a perfect player
    {
      const { host, sim } = mk(7);
      const used = startRun(sim);
      notes.push(`intro to run: ${used} ticks`);
      ok(sim.launch === true && sim.score === 0, 'launch phase: no scoring yet');
      // launch phase: presses do nothing, START plays
      tick(sim, L); ok(sim.score === 0, 'a press during the launch phase scores nothing');
      ok(host.plays.includes(SND.START) && host.plays.includes(SND.BIGBUTTON), 'START and BIGBUTTON sounds during the launch');
      let launchTicks = 1; while (sim.launch && launchTicks < 100) { tick(sim); launchTicks++; }
      ok(!sim.launch && launchTicks < 40 && sim.angle > K.WINDOW * K.OMEGA_MAX, `launch ends when the arm passes ${(K.WINDOW * K.OMEGA_MAX).toFixed(3)} rad (${launchTicks} ticks)`);
      const runTicks0 = sim.time;
      // run the whole game
      let maxStreak = 0, sawFull = false, speech = 0;
      let n = 0;
      while (sim.result === 0 && n < 4000) { tick(sim, sim.state === S.RUN ? perfect(sim) : 0); n++; maxStreak = Math.max(maxStreak, sim.streak); if (sim.power === 1) sawFull = true; }
      ok(sim.result === 1, `a perfect player wins (result ${sim.result})`);
      ok(sim.score >= MEDAL_GOLD, `perfect score ${sim.score} reaches gold (${MEDAL_GOLD})`);
      ok(sim.medalOk && sim.shownScore === sim.score, 'medal flag set, the shown score is the final score');
      ok(host.vars.get(VAR_HISCORE_CNT) === sim.score && host.vars.get(VAR_TROPHY_CNT) === 3, `hi-score ${host.vars.get(VAR_HISCORE_CNT)}, trophy ${host.vars.get(VAR_TROPHY_CNT)} (gold = 3)`);
      ok(maxStreak === 20 && sawFull && sim.bonus && sim.reached75, 'streak caps at 20, power reaches 1.0, the bonus phase starts');
      ok(host.said.filter((x) => x === 'LESGCE08').length === 1, 'LESGCE08 (dizzy) spoken once at full power');
      ok(host.said.includes('LESGCE09'), 'LESGCE09 spoken in the belt clip');
      ok(host.plays.includes(SND.PHEW) && host.plays.includes(SND.BRAKE), 'PHEW (anim 8) and BRAKE at the stop');
      ok(host.stops.includes(SND.ENGINE) && host.stops.includes(SND.SWISH), 'engine / swish loops stopped at the result');
      ok(sim.angle === 0 && sim.power === 0 && sim.clip === PEP.IDLE, 'the arm stops at angle 0, power 0, Pepper back to idle');
      ok(sim.bonusHits > 0, `bonus hits counted: ${sim.bonusHits}`);
      notes.push(`perfect run: score ${sim.score}, ${n} ticks after the launch, time left at the end of RUN: ${runTicks0}`);
      // the time: RUN lasts exactly 1800 ticks (the timer is decremented once per RUN tick)
    }

    // ============================================================ scripted LOSS: no input
    {
      const { host, sim } = mk(3);
      startRun(sim);
      const n = runGame(sim, () => 0);
      ok(sim.result === 2 && sim.score === 0, `no input: result 2 (lost), score ${sim.score}`);
      ok(host.vars.get(VAR_HISCORE_CNT) === 0 && host.vars.get(VAR_TROPHY_CNT) === 0, 'no hi-score / trophy written for score 0 (0 < 0 is false)');
      ok(!sim.reached75 && !host.plays.includes(SND.PHEW), 'power never passed 0.75: no PHEW clip');
      ok(host.plays.includes(SND.LRED) || host.plays.includes(SND.RRED), 'the red lights / sounds play for missed windows');
      // exactly 1800 RUN ticks: the launch tick count is irrelevant, count from the first RUN tick
      notes.push(`no input: ${n} ticks from the start of the run (1800 + stop + result)`);
    }

    // ============================================================ the time limit
    {
      const { sim } = mk(4);
      startRun(sim);
      let runTicks = 0;
      while (sim.state === S.RUN && runTicks < 3000) { tick(sim); runTicks++; }
      ok(runTicks === 1800 && sim.state === S.STOP, `the RUN state lasts 1800 ticks (${runTicks}) = 60 s`);
      ok(sim.clip === PEP.SPIN && sim.time === 0, 'at the time-out Pepper is back on the spin clip, time 0');
    }

    // ============================================================ the windows, latches, early presses
    {
      // helper: a sim at the first TOP window after the launch, power 0
      const prep = () => { const m = mk(5); startRun(m.sim); let g = 0; while (m.sim.launch && g++ < 200) tick(m.sim); return m; };
      // the window code runs on the angle BEFORE the tick's rotation: after entering an in-between zone one more tick runs its block (the window that ended is evaluated)
      const toZone = (sim, z, pick = () => 0) => { let g = 0; while (sim.zoneOf() !== z && g++ < 2000) tick(sim, pick()); if (z === 'right' || z === 'left') tick(sim); };
      // zones in order of the angle: top -> right -> bottom -> left -> top
      {
        const { sim } = prep();
        const seen = []; let last = '';
        for (let i = 0; i < 400 && seen.length < 6; i++) { tick(sim); const z = sim.zoneOf(); if (z !== last) { seen.push(z); last = z; } }
        ok(seen.join(',') === 'right,bottom,left,top,right,bottom' || seen.join(',') === 'top,right,bottom,left,top,right', `window order ${seen.join(',')}`);
      }
      // a right press in the TOP window scores nothing; a left press scores 20 and sets the latch; a second left press in the same window scores nothing
      {
        const { sim, host } = prep();
        toZone(sim, 'right'); toZone(sim, 'bottom'); toZone(sim, 'left'); toZone(sim, 'top');
        const before = sim.score;
        tick(sim, R); ok(sim.score === before, 'right press in the top window: no score');
        tick(sim, L); ok(sim.score === before + 20 && sim.streak === 1 && sim.latchL && sim.hit, 'left press in the top window: +20, streak 1');
        ok(host.plays.at(-1) === SND.LGREEN || host.plays.includes(SND.LGREEN), 'LGREEN sound');
        tick(sim, L); ok(sim.score === before + 20, 'second left press in the same window: nothing');
        ok(near(sim.power, K.BOOST, 1e-7), `power +0.01 (${sim.power})`);
        // leaving the window with a hit: the yellow light, no red; the second hit in a row adds another 0.01
        toZone(sim, 'right');
        ok(host.vis[REC.RYEL] && !host.vis[REC.RGRN] && !host.vis[REC.RLIT], 'right zone after a hit: RYEL on, RGRN / RLIT off');
        ok(sim.prevHit === true && sim.hit === false && sim.latchL === false && !sim.inWindow, 'hit remembered as prevHit, latch released');
        toZone(sim, 'bottom');
        tick(sim, R); ok(sim.score === before + 20 + 25 && sim.streak === 2, `right press in the bottom window: +20 + 5 * streak (${sim.score - before - 20})`);
        const p1 = sim.power;
        toZone(sim, 'left');
        ok(near(sim.power, p1 + K.BOOST, 1e-6), 'two hits in a row: +0.01 more when the window closes');
        ok(host.vis[REC.LYEL] && !host.vis[REC.LGRN], 'left zone after a hit: LYEL on, LGRN off');
      }
      // missing a window: the red light, the streak resets, no extra power
      {
        const { sim, host } = prep();
        toZone(sim, 'right'); toZone(sim, 'bottom'); tick(sim, R); tick(sim, R); // streak 1
        toZone(sim, 'left'); toZone(sim, 'top'); toZone(sim, 'right');           // the top window is missed
        ok(sim.streak === 0, 'a missed window resets the streak');
        ok(host.vis[REC.RLIT] && host.plays.includes(SND.RRED), 'RLIT on and RRED played after a missed top window');
      }
      // an early press in the right zone (before the bottom window) blocks the bottom press; in the left zone it blocks the top press
      {
        const { sim } = prep();
        toZone(sim, 'right'); tick(sim, R); ok(sim.latchR, 'right press in the right zone sets the right latch');
        toZone(sim, 'bottom'); const s0 = sim.score; tick(sim, R); ok(sim.score === s0, 'the early press blocks the bottom press');
        toZone(sim, 'left'); ok(!sim.latchR, 'the left zone clears the right latch');
        tick(sim, L); ok(sim.latchL, 'left press in the left zone sets the left latch');
        toZone(sim, 'top'); const s1 = sim.score; tick(sim, L); ok(sim.score === s1, 'the early press blocks the top press');
        toZone(sim, 'right'); ok(!sim.latchL, 'the right zone clears the left latch');
      }
      // the window edges: win = 2.75 * 15 degrees
      {
        const { sim } = mk(1);
        const win = K.WINDOW * K.OMEGA_MAX;
        const z = (a) => sim.zoneOf(a);
        ok(z(0) === 'top' && z(win - 1e-3) === 'top' && z(win + 1e-3) === 'right', 'top / right edge at +0.72 rad');
        ok(z(PI - win - 1e-3) === 'right' && z(PI - win + 1e-3) === 'bottom' && z(PI) === 'bottom', 'right / bottom edge at pi - 0.72');
        ok(z(TWO_PI - win - 1e-3) === 'left' && z(TWO_PI - win + 1e-3) === 'top' && z(PI + win - 1e-3) === 'bottom' && z(PI + win + 1e-3) === 'left', 'bottom / left / top edges (angle > pi wraps)');
      }
    }

    // ============================================================ score, streak and power arithmetic
    {
      const { sim } = mk(9);
      startRun(sim);
      let g = 0; while (sim.launch && g++ < 200) tick(sim);
      let expect = 0;
      for (let k = 0; k < 25; k++) {
        const before = sim.score;
        const z0 = sim.zoneOf();
        const want = z0 === 'top' ? L : R;
        let guard = 0;
        // wait for the next window of the other kind, then press
        while (!((sim.zoneOf() === 'top' || sim.zoneOf() === 'bottom') && !(sim.zoneOf() === 'top' ? sim.latchL : sim.latchR)) && guard++ < 3000) tick(sim);
        const z = sim.zoneOf();
        tick(sim, z === 'top' ? L : R);
        void want;
        const streakBefore = Math.min(20, k);
        const gained = sim.score - before;
        if (!sim.bonus) expect = 20 + streakBefore * 5;
        ok(gained === expect || sim.bonus, `press ${k}: +${gained} (expected ${expect})`);
        // go through the next in-between zone so the window closes with a hit
        guard = 0; while ((sim.zoneOf() === 'top' || sim.zoneOf() === 'bottom') && guard++ < 3000) tick(sim);
      }
      ok(sim.streak === 20, 'streak counts to 20 (+100 per press at the cap)');
    }

    // ============================================================ medal thresholds and the hi-score rule (the result states)
    {
      // drive the end of a game directly: score at the time-out, power at the stop
      const finish = (score, reached75, seedHi = 0) => {
        const { host, sim } = mk(11);
        host.vars.set(VAR_HISCORE_CNT, seedHi);
        startRun(sim);
        sim.score = score; sim.reached75 = reached75; sim.power = 0.05; sim.time = 1;
        runGame(sim, () => 0);
        return { sim, host };
      };
      const cases = [[1999, 0, 2], [2000, 1, 1], [3999, 1, 1], [4000, 2, 1], [5999, 2, 1], [6000, 3, 1], [8000, 3, 1]];
      for (const [score, trophy, result] of cases) {
        const { sim, host } = finish(score, false);
        ok(host.vars.get(VAR_HISCORE_CNT) === score && host.vars.get(VAR_TROPHY_CNT) === trophy && sim.result === result,
          `score ${score}: hi-score ${host.vars.get(VAR_HISCORE_CNT)}, trophy ${host.vars.get(VAR_TROPHY_CNT)} (expected ${trophy}), result ${sim.result} (expected ${result})`);
        ok(sim.shownScore === score, `shown score ${sim.shownScore}`);
        ok(sim.medalOk === (score >= 2000), `medal flag at ${score}`);
      }
      // the result follows the hi-score, not this run: a bad run after a good one still counts as success; a lower score never lowers the hi-score
      {
        const { sim, host } = finish(500, false, 4500);
        ok(host.vars.get(VAR_HISCORE_CNT) === 4500 && sim.result === 1, `hi-score 4500 stays, a 500 run still returns success (${sim.result})`);
        ok(host.vars.get(VAR_TROPHY_CNT) === 0, 'the trophy variable is untouched when the hi-score is not beaten');
      }
      {
        const { sim, host } = finish(2500, false, 2500);
        ok(host.vars.get(VAR_HISCORE_CNT) === 2500 && sim.result === 1, 'an equal score does not rewrite (strict <) but the result is success');
      }
      // PHEW clip when power passed 0.75
      {
        const { sim, host } = finish(3000, true);
        ok(host.plays.includes(SND.PHEW) && sim.result === 1, 'power > 0.75: the phew clip plays before the result');
      }
    }

    // ============================================================ power / angle / pitch
    {
      const { sim, host } = mk(2);
      ok(CentrifugeSim.pitchOf(0).engine === 0x3880 && CentrifugeSim.pitchOf(1).engine === 0x3880 + 0xfd94 && CentrifugeSim.pitchOf(0).swish === 0x204c && CentrifugeSim.pitchOf(1).swish === 0x204c + 0x8bf8, 'pitch table 0x3880 + 0xfd94 p / 0x204c + 0x8bf8 p');
      startRun(sim);
      let g = 0; while (sim.launch && g++ < 200) tick(sim);
      tick(sim);
      ok(host.rates.some(([id]) => id === SND.ENGINE) && host.plays.filter((x) => x === SND.ENGINE).length >= 1, 'engine sound is re-triggered each RUN tick with its pitch');
      // the angular speed goes from 3 to 15 degrees per tick with the power
      const a0 = sim.angle; sim.power = 0; tick(sim); ok(near(sim.angle - a0, K.OMEGA_MIN, 1e-5), 'power 0: 3 degrees per tick');
      const a1 = sim.angle; sim.power = 1; tick(sim); ok(near(sim.angle - a1, K.OMEGA_MAX, 1e-5) || sim.angle < a1, 'power 1: 15 degrees per tick');
    }

    // ============================================================ lights follow the quarter turn
    {
      const { sim, host } = mk(6);
      startRun(sim);
      const quarters = new Map();
      let g = 0;
      while (g++ < 400) {
        tick(sim);
        const q = Math.floor(sim.angle / (Math.PI / 2));
        if (sim.angle > 0.01) quarters.set(q, host.vis.slice(REC.LIGH0, REC.LION3 + 1).map(Number).join(''));
      }
      // quarter 0 (0..pi/2): LIGH0 + LION3 shown, LIGH3 + LION0 hidden; quarter 1: LION0 + LIGH1; quarter 2: LION1 + LIGH2; quarter 3: LION2 + LIGH3
      // order of the flags: LIGH0..3, LION0..3
      const want = { 0: '1000' + '0001', 1: '0100' + '1000', 2: '0010' + '0100', 3: '0001' + '0010' };
      const mask = (s) => s;
      for (const q of [0, 1, 2, 3]) {
        // only the pair that changes in the quarter is defined; compare those two bits
        const got = quarters.get(q) ?? '';
        const pairs = { 0: [[REC.LIGH3, 0], [REC.LION3, 1], [REC.LION0, 0], [REC.LIGH0, 1]], 1: [[REC.LIGH0, 0], [REC.LION0, 1], [REC.LION1, 0], [REC.LIGH1, 1]], 2: [[REC.LIGH1, 0], [REC.LION1, 1], [REC.LION2, 0], [REC.LIGH2, 1]], 3: [[REC.LIGH2, 0], [REC.LION2, 1], [REC.LION3, 0], [REC.LIGH3, 1]] }[q];
        ok(got.length === 8 && pairs.every(([r, v]) => +got[r - REC.LIGH0] === v), `quarter ${q}: lights ${got}`);
      }
      void want; void mask;
    }

    // ============================================================ the monitor's frame ranges
    {
      const { sim } = mk(8);
      ok(sim.mon.cur === 7 && sim.mon.frame === 98, 'at the start the monitor shows range 7 (frame 98)');
      // the controller's frame advance: single-frame ranges "wrap" every tick; by power the loop ranges move on
      const probe = (power) => {
        const { sim: s } = mk(8);
        s.mon.cur = 0; s.mon.start = 0; s.mon.end = 0; s.mon.frame = 0;
        s.power = power;
        for (let i = 0; i < 60; i++) s.step(0);
        return s.mon.cur;
      };
      // from range 0 the power picks 0 (< 0.125), 1 -> 2 (< 0.5), 3 -> 4 (< 0.75), 5 -> 6
      ok(probe(0) === 0 && probe(0.3) === 2 && probe(0.6) === 4 && probe(0.9) === 6, `loop ranges by power: ${[0, 0.3, 0.6, 0.9].map(probe)}`);
      // the visor clip puts the monitor on range 8 (100..110) and then back to range 0 after frame 34
      const { sim: v, host: vh } = mk(8);
      v.state = S.BELT;
      let seen8 = false, back0 = false, n = 0;
      tick(v); tick(v, BTN);
      while (v.state !== S.START && n++ < 400) { tick(v); if (v.mon.cur === 8) seen8 = true; if (seen8 && v.mon.cur === 0) back0 = true; }
      ok(seen8 && back0, 'monitor: range 8 during the visor clip, range 0 afterwards');
      ok(vh.plays.includes(SND.VISOR) && vh.plays.includes(SND.SEATBELT), 'visor and seat belt sounds');
      ok((vh.visorAngles?.length ?? 0) > 0 && near(vh.visorAngles.at(-1), 0.9, 0.02), `visor closes by 9 * 0.1 rad (${vh.visorAngles?.at(-1)})`);
    }

    // ============================================================ Bob (FUN_007b24a2)
    {
      const { sim, host } = mk(10);
      const clips = [];
      const origStart = host.bob.start.bind(host.bob);
      host.bob.start = (c, f) => { clips.push(c); return origStart(c, f); };
      for (let i = 0; i < 6; i++) sim.bobStep();
      ok(clips[0] === BOB.IDLE, `Bob starts with the idle clip ${clips[0]}`);
      // belt button: next state 1 -> button clip 9 -> 10 -> idle
      sim.setBobNext(1);
      let g = 0; while (clips.length < 4 && g++ < 400) sim.bobStep();
      ok(clips.slice(1, 4).join(',') === `${BOB.BUTTON_A},${BOB.BUTTON_B},${BOB.IDLE}`, `Bob's belt sequence ${clips.slice(1, 4)}`);
      // random mode: power 0 -> always idle; power 1 -> one of the four button clips with their sounds, speed 3 p + 1
      sim.setBobNext(4); sim.bobPower = 1; clips.length = 0; g = 0; while (clips.length < 40 && g++ < 4000) sim.bobStep();
      const set = new Set(clips);
      ok([9, 10, 0xb, 6].every((c) => set.has(c)) && !set.has(BOB.IDLE), `power 1: Bob presses buttons ${[...set]}`);
      ok(near(sim.bobSpeed, 4, 1e-6), 'Bob plays at 3 * power + 1');
      ok([SND.BOB_BUTTON1, SND.BOB_BUTTON2, SND.BOB_BUTTON3, SND.BOB_BUTTON4].every((s) => host.plays.includes(s)), 'the four Bob button sounds play');
      sim.bobPower = 0; clips.length = 0; g = 0; while (clips.length < 10 && g++ < 4000) sim.bobStep();
      ok(clips.every((c) => c === BOB.IDLE), 'power 0: Bob idles');
      ok(CentrifugeSim.prototype.setBobNext && (() => { const t = mk(1).sim; t.setBobNext(-3); const a = t.bobNext; t.setBobNext(2); const b = t.bobNext; t.setBobNext(9); return a === 0 && b === 2 && t.bobNext === 4; })(), 'FUN_007b2460 clamps: <1 -> 0, > 3 -> 4');
    }

    // ============================================================ placement of the machine (FUN_007b1a1b)
    {
      const sc = sceneOf(ctx, 'z36CNT');
      const P = (i) => sc.records[i].pos;
      const layout = layoutFrom(P(REC.TRAI), P(REC.CHAI), P(REC.WEIG));
      ok(near(layout.chair[0], 4.7, 1e-3) && near(layout.weight[0], -4.749, 1e-3) && near(layout.chair[1], 5.976, 1e-3), `layout from the scene: chair ${layout.chair}, weight ${layout.weight}`);
      ok(near(SEAT[1], -3.2, 1e-6) && near(SEAT[2], 1.6, 1e-6), 'seat offset (0, -3.2, 1.6)');
      const p0 = poseAt(layout, 0, 0);
      ok(near(p0.chair[12], 4.7, 1e-3) && near(p0.chair[13], 5.976, 1e-3) && near(p0.weight[12], -4.749, 1e-3), 'angle 0: the chair is at its scene position');
      ok(near(p0.pepper[12], 4.7, 1e-3) && near(p0.pepper[13], 5.976 - 3.2, 1e-3) && near(p0.pepper[14], 0.414 + 1.6, 1e-3), `angle 0: Pepper at the chair + seat offset (${p0.pepper[12]}, ${p0.pepper[13]}, ${p0.pepper[14]})`);
      const p1 = poseAt(layout, Math.PI / 2, 0);
      ok(Math.abs(p1.chair[12] - 0.414) < 0.02 && near(p1.chair[14], 4.7, 0.02) || Math.abs(p1.chair[14] - 4.7) < 0.02, `a quarter turn moves the chair toward +z (${p1.chair[12].toFixed(2)}, ${p1.chair[14].toFixed(2)})`);
      const pw = poseAt(layout, Math.PI, 0);
      ok(near(pw.chair[12], -4.7, 0.02) && near(pw.weight[12], 4.749, 0.02), 'half a turn swaps chair and weight');
      // tilt: the chair tips outward, the weight the other way (rotZ +- tilt about their own origins)
      const pt = poseAt(layout, 0, Math.PI / 2);
      ok(Math.abs(pt.chair[1]) > 0.9 && Math.abs(pt.chair[0]) < 1e-3, 'tilt pi/2 turns the chair a quarter about z');
      ok(pt.chair[12] === p0.chair[12] && pt.chair[13] === p0.chair[13], 'tilt does not move the chair origin');
      // ghosts
      ok(ghostCount(0) === 1 && ghostCount(0.19) === 1 && ghostCount(0.2) === 2 && ghostCount(1) === 6 && ghostCount(1, true) === 1, `ghost count 5 p + 1: ${[0, 0.19, 0.2, 1].map((p) => ghostCount(p))}`);
      ok(ghostAlpha(0, 6) === 255 && ghostAlpha(1, 6) === 60 && ghostAlpha(5, 6) === 20, `ghost alpha ${[0, 1, 5].map((j) => ghostAlpha(j, 6))}`);
      ok(near(ghostStep(1), 0.2, 1e-6), 'ghost step 0.2 p');
      // the arm's two blob shadows (FUN_007afe61 / FUN_007b1a1b)
      {
        const near = (a, b) => Math.abs(a - b) < 1e-5;
        ok(SHADOW_POINTS.map((p) => p.map((v) => +v.toFixed(3)).join(',')).join(';') === '4,0.8,0;1.6,0.8,0.8;1.6,0.8,-0.8;8,0.8,-1.6;8,0.8,1.6' && SHADOW_ORDER.join() === '1,0,2,3,4' && SHADOW_TYPE === 2, 'the five shadow points and their order');
        const s0 = armShadows(poseAt(layout, 0, 0).arm);
        ok(s0.length === 2 && s0[0].length === 15, 'two shadow polygons of 5 points');
        ok(near(s0[0][0], 1.6) && near(s0[0][2], 0.8) && near(s0[0][3], 4) && near(s0[0][9], 8) && near(s0[0][11], -1.6), `angle 0: the first shadow runs along +x (${s0[0].slice(0, 6).map((v) => v.toFixed(2))})`);
        ok(near(s0[1][0], -1.6) && near(s0[1][3], -4) && near(s0[1][9], -8), 'the second shadow is the first turned by pi');
        const s1 = armShadows(poseAt(layout, Math.PI / 2, 0).arm);
        ok(near(s1[0][3], 0) && near(s1[0][5], 4), 'a quarter turn: the first shadow runs along +z, like the chair');
      }
      const g1 = poseAt(layout, 1.0, 0, 0.2);
      const g0 = poseAt(layout, 0.8, 0, 0);
      ok(near(g1.chair[12], g0.chair[12], 1e-4) && near(g1.chair[14], g0.chair[14], 1e-4), 'a trailing copy sits at the earlier angle');
    }

    return { checked, failures, notes };
  },
};
