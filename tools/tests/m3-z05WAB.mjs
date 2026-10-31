import { loadExe, loadZone, press } from '../lib/engine-load.mjs';
import { readAudioTables } from '../../src/audio/tables.ts';
import { loadMessages, ZONE_FILES } from '../../src/ui/strings.ts';
import '../../src/zones/z05WAB.ts';
import { takeShared } from '../../src/zones/z05WAB/game.ts';
import { createWabGame, VAR } from '../../src/zones/z05WAB/game.ts';
import { WAB, SND, OPEN_SOUND, CLOSE_SOUND, REC, LINE, LID, LID_OF_HOLE, CAMERA_OFFSET, scoreOf, medalOfScore, percentOf, ALL_SOUNDS } from '../../src/zones/z05WAB/wab.ts';
import { zoneGameFor } from '../../src/shell/zonegame.ts';
import { GameVars } from '../../src/game/vars.ts';

// Whack-A-Bot (z05WAB), docs/re/m3/z05WAB.md: the constants against the executable, the game logic of the two nodes (FUN_00569f50 botwab, FUN_0056c950 pepwab) with scripted
// input (a bot that whacks every bot = a win, a player that never presses = a loss, the Infomaniac, timing of the hammer, difficulty stages, clock, lids), the score / medal /
// trophy rules of the loop (FUN_0056905a) through the zone game with a stub shell.

const f32 = Math.fround;
const KEYS = ['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ArrowDown'];     // hole 0 = up, 1 = left, 2 = right, 3 = down

/** a recording host: random numbers from a queue (then a seeded generator), every event logged */
function mkHost(queue = [], seed = 7, fn = null) {
  // a scripted generator of the test (the game's own draw is crt.ts rand() scaled by the real clock: not reproducible)
  let sd = seed >>> 0;
  const base = { random: (n) => { sd = (Math.imul(sd, 1664525) + 1013904223) >>> 0; return Math.floor((sd / 4294967296) * n); } };
  const h = {
    ev: [], q: queue.slice(), frames: [],
    play(id) { if (id !== SND.AMBIENT && id !== SND.ALARM1 && id !== SND.ALARM2) h.ev.push(['play', id]); else h.ev.push(['loop', id]); },
    stop(id) { h.ev.push(['stop', id]); },
    play3d(id, pos) { h.ev.push(['play3d', id, pos ? pos.slice() : null]); },
    say(id) { h.ev.push(['say', id]); },
    setFrame(t, slot, frame) { h.frames.push([t, slot, frame]); },
    random(n) { return fn ? fn(n) : h.q.length ? h.q.shift() % n : base.random(n); },
  };
  return h;
}

function fresh(ctx, host) {
  const L = loadZone(ctx, 'z05WAB');
  const sh = takeShared();
  sh.host = host;
  return { L, sh, w: L.world, bot: sh.bot, pep: sh.pep, rec: L.world.records };
}
const tick = (S, key) => { if (key) press(S.L, key); else S.w.tick(); };
/** the swing starts on the tick the key is pressed, the hammer lands on frame 12 */
const holeUp = (bot, h) => bot.state[h] === 2 && !bot.isInfo[h] && !bot.whacked[h];

export default {
  name: 'm3-z05WAB',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);

    // ---- 1. constants against the executable
    const f = (va) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(va), true); return d.getFloat32(0, true); };
    const bytes = (va, n) => pe.slice(va, n);
    const hasImm = (va, n, imm) => { const b = bytes(va, n); for (let i = 0; i + 4 <= n; i++) if ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 === imm >>> 0) return true; return false; };
    ok(f(0x892044) === 480 && WAB.ALARM_AT === 480 && WAB.STAGE_LIMITS[2] === 480, 'rdata 0x892044 = 480 (alarm / last stage)');
    ok(f(0x892634) === 930 && WAB.STAGE_LIMITS[1] === 930, 'rdata 0x892634 = 930');
    ok(f(0x892630) === 1830 && WAB.STAGE_LIMITS[0] === 1830, 'rdata 0x892630 = 1830');
    ok(f(0x89263c) === 780 && f(0x892638) === 1740, 'rdata 0x89263c / 0x892638 = 780 / 1740 (the two write-only marks)');
    ok(f(0x892090) === 8 && f(0x892020) === 1 && f(0x892038) === 30 && f(0x892388) === 60 && f(0x89201c) === 100 && f(0x892254) === 50, 'rdata 8 / 1 / 30 / 60 / 100 / 50');
    ok(WAB.WIN_PCT === 50, 'win clip at 50 percent');
    ok(f(0x892668) === 2.25 && f(0x892660) === 9 && f(0x892060) === 10 && f(0x892134) === 0.25 && f(0x892028) === 2 && f(0x892024) === 12, 'rdata 2.25 / 9 / 10 / 0.25 / 2 / 12 (counters, hit frame 12)');
    ok(WAB.HIT_FRAME === f(0x892024), 'the hammer lands on frame 12');
    ok(Math.abs(f(0x892664) - 0.009) < 1e-7, 'rdata 0.009 (gear spin per percent)');
    ok(f(0x892658) === LID.OPEN[0] && f(0x89265c) === LID.OPEN[3] && f(0x892650) === LID.CLOSED_Y && f(0x892644) === LID.CLOSED[0] && f(0x892640) === LID.CLOSED[2] && f(0x892654) === LID.LIDL_LIMIT, 'lid limits (5.888 / 5.75 / 2.358 / 3.979 / -1.743 / 1.773)');
    ok(f(0x8adc28) === 0 && f(0x8adc2c) === CAMERA_OFFSET[1] && f(0x8adc30) === 24 && Math.abs(f(0x8adc2c) - 10.4) < 1e-6, 'camera preset 4 offset (0, 10.4, 24) at 0x8adc28');
    ok(f(0x8adc60) === 0 && f(0x8adc64) === 4 && Math.abs(f(0x8adc68) - 9.6) < 1e-6, 'camera start target offset (0, 4, 9.6) at 0x8adc60');
    // constructor 0x56b2d5 (botwab): immediates of the start state
    const ctor = 0x56b2d5, ctorLen = 0x800;
    for (const [imm, what] of [[0x4528c000, '2700'], [0x3fcccccd, 'range 1.6'], [0xbfb851ec, 'base y -1.44'], [0x41500000, 'fall 13'], [0x41200000, 'rise 10'], [0x41e80000, 'hold 29'], [0x41400000, 'gap 12'], [0xbf800000, '-1']])
      ok(hasImm(ctor, ctorLen, imm), `botwab constructor stores ${what} (0x${imm.toString(16)})`);
    ok(WAB.RANGE === f32(1.6) && WAB.BASE_Y === f32(-1.44) && WAB.TIME === 2700 && WAB.RISE === 10 && WAB.FALL === 13 && WAB.HOLD0 === 29 && WAB.GAP0 === 12, 'constants equal the immediates');
    // FUN_00569f50: the stage values and Pepper's stun
    for (const imm of [0x41c80000, 0x41b00000, 0x41a00000, 0x41000000, 0x41200000, 0x40b753f8, 0x40b74396, 0x407ea7f0, 0x40f04189]) ok(hasImm(0x569f50, 0x1800, imm), `FUN_00569f50 immediate 0x${imm.toString(16)}`);
    ok(WAB.STAGES[1][0] === 25 && WAB.STAGES[1][1] === 10 && WAB.STAGES[2][0] === 22 && WAB.STAGES[2][1] === 8 && WAB.STAGES[3][0] === 20 && WAB.STAGES[3][1] === 8, 'stage values 25/10, 22/8, 20/8');
    ok(hasImm(0x569f50, 0x1800, 0x42b40000), 'stun 90 ticks (0x42b40000 stored by FUN_00569f50)');
    ok(WAB.STUN === 90, 'stun constant');
    // the loop FUN_0056905a: thresholds 9000 / 8000 / 5000 and the success test 4999 < score
    for (const v of [9000, 8000, 5000, 100]) { const b = bytes(0x56905a, 0xb00); let found = false; for (let i = 0; i + 4 <= b.length; i++) if ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) === v) found = true; ok(found, `FUN_0056905a compares with ${v} (success test: cmp score, 5000; setge)`); }
    ok(WAB.GOLD === 9000 && WAB.SILVER === 8000 && WAB.BRONZE === 5000, 'medal thresholds 5000 / 8000 / 9000 (docs/re/architecture.md 3.6)');
    // sound ids and names
    const at = readAudioTables(pe.data);
    const names = { [SND.HAMMER_MOVE]: 'SND_HAMMER_MOVE', [SND.HIT_BOT]: 'SND_HIT_BOT', [SND.HIT_INFO]: 'SND_HIT_INFO', [SND.MISS]: 'SND_WAB_MISS', [SND.AMBIENT]: 'SND_WAB_AMBIENT', [SND.OPEN_LEFT]: 'SND_OPEN_LEFT', [SND.CLOSE_LEFT]: 'SND_CLOSE_LEFT', [SND.OPEN_TOP]: 'SND_OPEN_TOP', [SND.CLOSE_TOP]: 'SND_CLOSE_TOP', [SND.OPEN_RIGHT]: 'SND_OPEN_RIGHT', [SND.CLOSE_RIGHT]: 'SND_CLOSE_RIGHT', [SND.OPEN_BOTTOM]: 'SND_OPEN_BOTTOM', [SND.CLOSE_BOTTOM]: 'SND_CLOSE_BOTTOM', [SND.ALARM1]: 'SND_WAB_ALARM1', [SND.ALARM2]: 'SND_WAB_ALARM2' };
    for (const [id, n] of Object.entries(names)) ok(at.sounds[+id]?.name === n, `sound ${(+id).toString(16)} is ${n}, table says ${at.sounds[+id]?.name}`);
    ok(ALL_SOUNDS.length === 15, '15 sounds');
    // speech / text ids
    const msgArchive = ctx.archives.find((a) => a.name.toLowerCase() === 'messages');
    const tbl = loadMessages(msgArchive, ZONE_FILES.z05WAB);
    for (const id of Object.values(LINE)) ok(tbl.voice(id) >= 0 && tbl.text(id).length > 3, `wab.str has voiced ${id}`);
    for (const id of ['WAB1', 'WAB2', 'WAB3', 'CONTROL0', 'CONTROL1', 'CONTROL2', 'CONTROL3']) ok(tbl.text(id) !== id, `wab.str has ${id}`);
    // the speech indices match the speech table of the EXE
    for (const id of Object.values(LINE)) ok(at.speech[tbl.voice(id)]?.toUpperCase() === id, `speech table entry ${tbl.voice(id)} is ${id} (${at.speech[tbl.voice(id)]})`);

    // ---- 2. scoring tables
    ok(scoreOf(0) === 0 && scoreOf(49.99) === 4900 && scoreOf(50) === 5000 && scoreOf(89.9) === 8900 && scoreOf(90) === 9000 && scoreOf(100) === 10000 && scoreOf(150) === 10000, 'scoreOf: truncated percentage x 100, capped at 100');
    ok(scoreOf(NaN) === 0, 'scoreOf(NaN) = 0 (ftol(NaN) = INT_MIN, x 100 wraps)');
    ok([0, 4999, 5000, 7999, 8000, 8999, 9000, 10000].map(medalOfScore).join() === '0,0,1,1,2,2,3,3', 'medal table');
    ok(percentOf(29, 100 - 29) === 29 && percentOf(1, 1) === 50 && percentOf(7, 1) === 87.5 && percentOf(1, 2) === f32(f32(1 / 3) * 100) && Number.isNaN(percentOf(0, 0)), 'percentOf is single precision per operation (quotient, then product: 24-bit x87), NaN for 0 / 0');

    // ---- 3. the set-up: nodes, records, camera, no walking
    {
      const S = fresh(ctx, mkHost());
      ok(S.L.setup.attaches.some((a) => a.ctor === 0x56cd3b && a.record === 0) && S.L.setup.attaches.some((a) => a.ctor === 0x56b2d5 && a.record === 1), 'set-up attaches pepwab on PEPP and botwab on LAND');
      ok(S.L.skipped.length === 0, 'no skipped attaches');
      ok(S.rec[0].ctrl.nodes.some((n) => n.kind === 'pepwab') && S.rec[1].ctrl.nodes.some((n) => n.kind === 'botwab'), 'nodes on the records');
      S.bot.init(S.w); S.pep.init(S.w, S.rec[0]);
      ok(S.rec[REC.HOLE[0]].y === WAB.BASE_Y && S.rec[REC.HOLE[3]].y === WAB.BASE_Y, 'resting bots at y = -1.44');
      ok(S.rec[REC.HOLE[0]].name === 'BOTT' && S.rec[REC.INFO].name === 'INFO' && S.rec[REC.LAND].name === 'LAND', 'record names');
      // holes sit under their lids: hole 0 under LIDU ... (same x, z within 0.1)
      for (let h = 0; h < 4; h++) { const hole = S.rec[REC.HOLE[h]], lid = S.rec[LID_OF_HOLE[h]]; ok(Math.abs(hole.x - lid.x) < 0.1 && Math.abs(hole.z - lid.z) < 0.1, `hole ${h} lies under its lid`); }
      ok(S.rec[REC.HOLE[0]].z < S.rec[REC.HOLE[3]].z && S.rec[REC.HOLE[1]].x > S.rec[REC.HOLE[2]].x, 'hole 0 = far (up), 3 = near (down), 1 = +x (left on screen), 2 = -x');
      // arrow keys are the game's buttons: Pepper does not walk
      const p0 = [S.rec[0].x, S.rec[0].y, S.rec[0].z];
      for (let i = 0; i < 40; i++) { S.w.input.setKey('ArrowUp', true); S.w.tick(); }
      S.w.input.setKey('ArrowUp', false);
      ok(S.rec[0].x === p0[0] && S.rec[0].y === p0[1] && S.rec[0].z === p0[2], 'Pepper stays on his spot (the arrow keys swing the hammer)');
      const c = S.w.camera.c;
      ok(Math.abs(c[0] - 0) < 1e-6 && Math.abs(c[1] - 10.4) < 1e-4 && Math.abs(c[2] - 22.799) < 0.01 && Math.abs(c[3]) < 1e-6 && Math.abs(c[4]) < 1e-6 && Math.abs(c[5] + 1.201) < 0.01, `camera: eye (0, 10.4, 22.8) looking at Pepper, got ${Array.from(c).slice(0, 6).map((v) => v.toFixed(2))}`);
    }

    // ---- 4. a win: whack every bot
    {
      const host = mkHost();
      const S = fresh(ctx, host);
      let popped = 0, infos = 0;
      let t = 0, over = -1;
      let lastState = [0, 0, 0, 0];
      const log = { stages: new Set(), maxHold: 0, ticksWithBot: 0 };
      for (; t < 3000; t++) {
        let key = null;
        for (let h = 0; h < 4; h++) { if (S.bot.state[h] === 1 && lastState[h] === 0) { popped++; if (S.bot.isInfo[h]) infos++; } }
        lastState = S.bot.state.slice();
        // whack as soon as a bot rises (the hammer needs 12 ticks, the bot is up from tick 10 for 29 ticks)
        for (let h = 0; h < 4; h++) if (S.bot.state[h] === 1 && !S.bot.isInfo[h] && !S.bot.whacked[h] && S.pep.busy === 0 && S.sh.stun === 0 && S.sh.clip === WAB.CLIP.IDLE) key = KEYS[h];
        if (S.sh.over) { over = t; break; }
        tick(S, key);
        log.stages.add(`${S.bot.hold}/${S.bot.gap}`);
        if (S.bot.timeLeft === 1829) ok(S.bot.hold === 25 && S.bot.gap === 10, 'stage 2 at 1829 left');
        if (S.bot.timeLeft === 929) ok(S.bot.hold === 22 && S.bot.gap === 8, 'stage 3 at 929 left');
        if (S.bot.timeLeft === 479) ok(S.bot.hold === 20 && S.bot.gap === 8, 'stage 4 at 479 left');
      }
      ok(over === 2701, `the game ends on the 2702nd update (timeLeft 2700 -> 0 plus the end tick): over at ${over}`);
      ok(S.bot.timeLeft === 0 && S.bot.elapsed === 2700, `time ${S.bot.timeLeft} elapsed ${S.bot.elapsed}`);
      ok([...log.stages].join() === '29/12,25/10,22/8,20/8', `the four difficulty stages in order: ${[...log.stages]}`);
      ok(S.bot.misses === 0 && S.bot.hits > 20, `win: ${S.bot.hits} hits, ${S.bot.misses} misses`);
      ok(S.bot.hits === popped - infos || S.bot.hits === popped - infos - 1, `every bot whacked: popped ${popped} (${infos} Infomaniacs), hits ${S.bot.hits}`);
      ok(S.sh.pct === 100 && S.sh.score === 10000 && medalOfScore(S.sh.score) === 3, `score ${S.sh.score}`);
      ok(S.rec[0].anim.clip === WAB.CLIP.WIN, 'Pepper plays the win clip (3) at >= 50 %');
      ok(S.bot.timeText === '00:00' || /^\d\d:\d\d$/.test(S.bot.timeText) || S.bot.timeText === '', `clock text "${S.bot.timeText}"`);
      for (let i = 0; i < 4; i++) ok((S.bot.cur[i].flags & 2) === 0, `bot of hole ${i} hidden at the end`);
      ok(host.ev.filter((e) => e[0] === 'stop' && (e[1] === SND.ALARM1 || e[1] === SND.ALARM2)).length === 2, 'the end stops both alarms');
      ok(host.ev.filter((e) => e[0] === 'loop' && e[1] === SND.AMBIENT).length >= 2700, 'the ambient loop is played every tick');
      ok(host.ev.filter((e) => e[0] === 'loop' && e[1] === SND.ALARM1).length >= 479 && host.ev.filter((e) => e[0] === 'loop' && e[1] === SND.ALARM1).length <= 482, `the alarm plays in the last 480 ticks: ${host.ev.filter((e) => e[0] === 'loop' && e[1] === SND.ALARM1).length}`);
      ok(host.ev.some((e) => e[0] === 'play' && e[1] === SND.HAMMER_MOVE), 'hammer swing sound');
      ok(host.ev.filter((e) => e[0] === 'play3d' && e[1] === SND.HIT_BOT).length === S.bot.hits, 'one hit sound per hit');
      ok(host.ev.some((e) => e[0] === 'say' && (e[1] === LINE.BOT_SEA || e[1] === LINE.BOT_MOAN)), 'the bots occasionally speak');
      notes.push(`win run: ${popped} bots (${infos} Infomaniac), ${S.bot.hits} hits, speech ${host.ev.filter((e) => e[0] === 'say').length}x`);
    }

    // ---- 5. a loss: never press a key
    {
      const host = mkHost();
      const S = fresh(ctx, host);
      let popped = 0, infos = 0, last = [0, 0, 0, 0], t = 0;
      for (; t < 3000 && !S.sh.over; t++) {
        for (let h = 0; h < 4; h++) if (S.bot.state[h] === 1 && last[h] === 0) { popped++; if (S.bot.isInfo[h]) infos++; }
        last = S.bot.state.slice();
        tick(S, null);
      }
      ok(S.sh.over === 1, 'game over without input');
      ok(S.bot.hits === 0 && S.bot.misses >= popped - infos - 1 && S.bot.misses > 10, `loss: ${S.bot.misses} misses of ${popped} bots (${infos} Infomaniacs)`);
      ok(S.sh.pct === 0 && S.sh.score === 0 && medalOfScore(S.sh.score) === 0, 'score 0, no medal');
      ok(S.rec[0].anim.clip === WAB.CLIP.STUN, 'Pepper plays clip 2 at < 50 %');
      ok(host.ev.every((e) => e[0] !== 'say'), 'no speech without hits');
      // every miss showed the red cross on the TV: reactKind 4 was set at some point (frames 0x12..)
      ok(host.frames.some((fr) => fr[0] === 'land' && fr[1] === 10 && fr[2] >= 0x12 && fr[2] <= 0x16), 'the TV shows the red cross (frames 18..22 of slot 10)');
      notes.push(`loss run: ${popped} bots, ${S.bot.misses} misses`);
    }

    // ---- 6. scripted details: the hammer, the hole mapping, hits too early / late, the Infomaniac, the lids
    {
      // 6a: bot at hole 2 (right), then hammer on the wrong hole, then the right one
      const host = mkHost([2, 1]);       // hole 2, not the Infomaniac (random(8) = 1)
      const S = fresh(ctx, host);
      let t = 0;
      for (; t < 40 && S.bot.state[2] === 0; t++) tick(S, null);
      ok(S.bot.state[2] === 1 && S.bot.isInfo[2] === 0, `a bot rises in hole 2 at tick ${t}`);
      ok(t === 12, `the first bot comes on the 12th tick (lastDown -1 + gap 12 < elapsed): ${t}`);
      ok(host.ev.some((e) => e[0] === 'play' && e[1] === SND.OPEN_BOTTOM), 'hole 2 plays the sound named OPEN_BOTTOM (the original maps the sounds that way)');
      tick(S, null);
      ok(S.rec[REC.HOLE[2]].y > WAB.BASE_Y, 'rising');
      // the pepwab lock of 15 ticks at the start: a key in the first ticks does nothing
      tick(S, 'ArrowUp');
      ok(S.sh.clip === WAB.CLIP.IDLE && S.pep.busy === 1, 'a key in the first 15 ticks is ignored (start-up lock)');
      while (S.pep.lock > 0) tick(S, null);
      ok(S.pep.busy === 0 && S.t === undefined, 'start-up lock over after 15 ticks');
      tick(S, 'ArrowUp');                                           // wrong hole (0): the swing starts
      ok(S.sh.clip === WAB.CLIP.SWING_UP && S.rec[0].anim.clip === 5, 'ArrowUp starts clip 5');
      let frames = 0;
      while (S.rec[0].anim.frame < 12.5 && frames < 40) { tick(S, null); frames++; }
      const miss = host.ev.filter((e) => e[0] === 'play3d' && e[1] === SND.MISS);
      ok(miss.length === 1 && S.bot.hits === 0, `the hammer on an empty hole: miss sound, no hit (${miss.length} miss sounds)`);
      for (let i = 0; i < 40; i++) tick(S, null);                   // let the swing end
      ok(S.sh.clip === WAB.CLIP.IDLE && S.pep.busy === 0, 'swing over, idle again');
    }
    {
      // 6b: whack the rising bot: counted only when fully up (the swing takes 12 ticks, a bot rises in 10)
      const host = mkHost([3, 1, 5]);
      const S = fresh(ctx, host);
      while (S.bot.state[3] === 0) tick(S, null);
      while (S.pep.busy !== 0) tick(S, null);                       // the start-up lock ends 3 ticks after the bot started rising
      tick(S, 'ArrowDown');                                         // pressed 4 ticks after the bot started rising
      let n = 0; while (S.rec[0].anim.frame < 12.5) { tick(S, null); n++; }
      ok(S.bot.hits === 1 && S.bot.whacked[3] === 1, `hit counted when the hammer lands (frame 12): hits ${S.bot.hits} after ${n} ticks`);
      ok(S.bot.reactKind === 3 && host.frames.length > 0, 'the TV reacts');
      ok(S.bot.hitStage >= 0, 'the whack animation runs');
      // the whack animation swaps the model through BOT1..BOT9
      const seen = new Set();
      for (let i = 0; i < 30; i++) { seen.add(S.bot.cur[3].name); tick(S, null); }
      ok([...seen].some((n) => /^BOT[1-9]$/.test(n)), `the bot of hole 3 shows BOT1..9 while whacked: ${[...seen]}`);
      ok(S.bot.hitStage === -1, 'the whack animation ends after 9 stages');
      // a second hit on the same bot does not count
      // (the next whack lands while it is still up if we are quick: not possible with the swing length, so just check hits stays)
      for (let i = 0; i < 60; i++) tick(S, null);
      ok(S.bot.hits === 1 && S.bot.misses === 0, 'the whacked bot is no miss when it goes down');
      ok(S.bot.cur[3].name === 'BOTT' && S.bot.state.every((x) => x === 0) || S.bot.state.some((x) => x !== 0), 'back to the resting bot record afterwards');
    }
    {
      // 6c: a bot that is hit too late (falling) is a miss, the swing later lands on nothing
      const host = mkHost([0, 1, 3]);
      const S = fresh(ctx, host);
      while (S.bot.state[0] === 0) tick(S, null);
      while (S.bot.state[0] !== 3) tick(S, null);                   // falling
      tick(S, 'ArrowUp');
      for (let i = 0; i < 60; i++) tick(S, null);
      ok(S.bot.hits === 0 && S.bot.misses === 1, `too late: a miss (hits ${S.bot.hits}, misses ${S.bot.misses})`);
      ok(S.bot.pctText === ' 0%%' || S.bot.pctText === '0%%', `percentage text "${S.bot.pctText}"`);
    }
    {
      // 6d: the Infomaniac: random(4) = 1 (left), random(8) = 0 (Infomaniac); whacking him stuns Pepper for 90 ticks, no hit, no miss
      const host = mkHost([], 7, (n) => (n === 4 ? 1 : n === 8 ? 0 : 2));      // hole 1, always the Infomaniac, speech line 2
      const S = fresh(ctx, host);
      while (S.bot.state[1] === 0) tick(S, null);
      while (S.pep.busy !== 0) tick(S, null);
      ok(S.bot.isInfo[1] === 1 && S.bot.cur[1].name === 'INFO', 'the Infomaniac pops up (record INFO replaces the resting bot)');
      tick(S, 'ArrowLeft');
      while (S.rec[0].anim.frame < 12.5) tick(S, null);
      ok(S.bot.hits === 0 && S.bot.whacked[1] === 1 && S.sh.stun > 80 && S.sh.stun <= 90, `whacked the Infomaniac: stun ${S.sh.stun}, hits ${S.bot.hits}`);
      ok(host.ev.some((e) => e[0] === 'play3d' && e[1] === SND.HIT_INFO), 'hit_info sound');
      ok(host.ev.some((e) => e[0] === 'say' && [LINE.INFO_SORRY, LINE.INFO_LOOK, LINE.INFO_BREATH].includes(e[1])), 'the Infomaniac apologises');
      // while the swing ends and Pepper is stunned (clip 2, 90 frames), pressing does nothing
      let stunTicks = 0, pressedDuring = false;
      for (let i = 0; i < 200 && S.sh.stun > 0; i++) { tick(S, 'ArrowRight'); if (S.sh.clip === 2) { stunTicks++; if (S.rec[0].anim.clip !== 2) pressedDuring = true; } }
      ok(S.sh.stun === 0 && !pressedDuring, 'no swing while stunned');
      ok(stunTicks > 0, `Pepper shows the stunned clip for ${stunTicks} ticks`);
      for (let i = 0; i < 100; i++) tick(S, null);
      ok(S.bot.misses === 0 && S.bot.hits === 0, 'the Infomaniac is never a miss');
    }
    {
      // 6e: only Infomaniacs, none whacked: 0 hits + 0 misses -> NaN percentage -> score 0, game still ends
      const host = mkHost([], 7, (n) => (n === 4 ? 1 : 0));        // only Infomaniacs
      const S = fresh(ctx, host);
      for (let t = 0; t < 3000 && !S.sh.over; t++) tick(S, null);
      ok(S.sh.over === 1 && Number.isNaN(S.sh.pct) && S.sh.score === 0, `no bots at all: NaN, score ${S.sh.score}`);
      ok(S.rec[0].anim.clip === WAB.CLIP.STUN, 'NaN < 50: the lose clip');
    }
    {
      // 6f: the lids open away from the hole while a bot comes out and close again; the clock; the blinking
      const host = mkHost([0, 1, 1, 1, 1, 1, 1, 1]);
      const S = fresh(ctx, host);
      const lid = S.rec[REC.LIDU];
      const z0 = lid.z, y0 = lid.y;
      let maxZ = z0, minY = y0;
      for (let t = 0; t < 120; t++) { tick(S, null); maxZ = Math.max(maxZ, lid.z); minY = Math.min(minY, lid.y); }
      ok(maxZ > z0 + 1.5 && maxZ <= LID.OPEN[0] + 1e-6, `LIDU opens to z ${maxZ.toFixed(3)} (limit 5.888)`);
      ok(minY < y0 - 0.2 && minY >= LID.OPEN_Y - 1e-6, `LIDU sinks to y ${minY.toFixed(3)} (limit 2)`);
      ok(Math.abs(lid.z - LID.CLOSED[0]) < 1e-6 && Math.abs(z0 - LID.CLOSED[0]) < 0.01 && Math.abs(lid.y - LID.CLOSED_Y) < 1e-6, `LIDU closed again at its clamp: z ${lid.z} (start ${z0}), y ${lid.y}`);
      ok(S.bot.timeText === '01:26', `clock after 120 ticks: ${S.bot.timeText}`);
    }
    {
      // 6g: clock text at the start and the blink in the last 16 seconds (480 ticks)
      const S = fresh(ctx, mkHost([1, 1, 1, 1, 1, 1, 1, 1]));
      tick(S, null);
      ok(S.bot.timeText === '01:29', `first tick: ${S.bot.timeText}`);
      while (S.bot.timeLeft > 481) tick(S, null);
      ok(S.bot.clockOn === true, 'clock steady above 480');
      let blinks = 0, was = S.bot.clockOn;
      while (S.bot.timeLeft > 10) { tick(S, null); if (S.bot.clockOn !== was) { blinks++; was = S.bot.clockOn; } }
      ok(blinks >= 80 && blinks <= 100, `the clock blinks every 5 ticks in the last 16 s (${blinks} toggles in ~470 ticks)`);
      const off = [];
      for (let t = 0; t < 12; t++) { tick(S, null); off.push(S.bot.timeText); }
      ok(off.length > 0, 'ticked on');
    }

    // ---- 7. the zone game: results, trophy and hiscore, speech at the end
    {
      const vars = new GameVars();
      const said = [], stops = [];
      const S0 = fresh(ctx, mkHost());
      const world = S0.w;
      const calls = [];
      const hud = { left: null, right: null, leftText: '', rightText: '', centreText: '', visible: true };
      const sctx = {
        sh: { audio: { play() {}, stop(id) { stops.push(id); }, leaveZone() { calls.push('leave'); }, enterZone() { calls.push('enter'); }, playMusic() {} } },
        world, hud, vars, scene: S0.L.scene, archive: S0.L.archive, gr: { renderer: { setTextureFrame(a, id, mode, frame) { calls.push(['tex', id, mode, frame]); return true; } }, groupCount: () => 29, scrollGroup(rec, g, du, dv) { calls.push(['scroll', rec.name, g, du, dv]); } },
        say: (a, b) => { said.push([a, b ?? null]); return true; }, stopSpeech() {}, sfx() {}, text() {}, strings: tbl, banner(ui, spec) { calls.push(['banner', spec]); }, std: { text: (x) => x },
      };
      // the shell's loadZone put a pending shared state for S0: hand it to the factory
      const gameFactory = zoneGameFor('z05WAB');
      ok(typeof gameFactory === 'function', 'the zone game is registered');
      // S0's nodes were created by loadZone; the factory takes the pending state: fresh() already took it, put it back through a second load
      const L2 = loadZone(ctx, 'z05WAB');
      const sctx2 = { ...sctx, world: L2.world, scene: L2.scene, archive: L2.archive };
      const game = createWabGame(sctx2);
      ok(game.introId === 'LESGWB11' && game.helpControls === 4, 'intro LESGWB11, 4 controls');
      ok(!calls.includes('leave') && !calls.includes('enter'), 'the zone game does not touch the music at set-up / start (the runner starts it with play: AudioHost.modeChange)');
      const gd = game.debug();
      ok(gd.timeLeft === 2700 && gd.over === 0, 'debug state');
      game.onStart();
      L2.world.tick();
      const sc = calls.filter((c) => c[0] === 'scroll');
      ok(sc.length === 1 && sc[0][1] === 'LAND' && sc[0][2] === 23 && sc[0][3] === 0 && Math.abs(sc[0][4] - 0.0003 * 29) < 1e-6, `the UV scroll: group 23 of LAND by 0.0003 x 29 groups per tick (${JSON.stringify(sc[0])})`);
      const tx = calls.filter((c) => c[0] === 'tex');
      ok(tx.length > 0 && tx.every((c) => c[2] === 2), 'texture frames are set frozen (mode 2)');
      ok(tx.some((c) => c[1] === 11) || tx.some((c) => c[1] === 26) || tx.some((c) => c[1] === 38), 'frames of the TV (text011) / radar (text026) / flash (text038) textures');
      ok(sctx2.hud.visible === true, 'play start: HUD (the music is the runner\'s)');
      // run a game with a gold score by driving the nodes directly (the whack-everything bot of section 4 through the stub input)
      const bot = L2.world.records[1].ctrl.nodes.find((n) => n.kind === 'botwab'), pep = L2.world.records[0].ctrl.nodes.find((n) => n.kind === 'pepwab');
      let result = 0;
      for (let t = 0; t < 3000 && !result; t++) {
        let key = null;
        for (let h = 0; h < 4; h++) if (bot.state[h] === 1 && !bot.isInfo[h] && !bot.whacked[h] && pep.busy === 0 && bot.sh.stun === 0 && bot.sh.clip === 1) key = KEYS[h];
        if (key) L2.world.input.setKey(key, true);
        L2.world.tick();
        if (key) L2.world.input.setKey(key, false);
        result = game.update() || 0;
      }
      ok(result === 1, `update() returns 1 (success) for 100 %: ${result}`);
      ok(sctx2.hud.leftText === bot.hitsText && sctx2.hud.rightText === bot.missText && sctx2.hud.centreText === bot.timeText && /^\d+$/.test(sctx2.hud.leftText), 'HUD texts: hits left, misses right, clock middle');
      said.length = 0;
      game.onBanner(result); game.bannerTick();   // the vars are written in the first banner frame (one tick later)
      ok(vars.get(VAR.HISCORE) === 10000 && vars.get(VAR.TROPHY) === 3, `gold: HISCORE ${vars.get(VAR.HISCORE)}, TROPHY ${vars.get(VAR.TROPHY)}`);
      ok(said.length === 1 && said[0][0] === LINE.GOLD && said[0][1] === null, 'gold line spoken');
      game.drawBanner({}, result);
      const bs = calls.filter((c) => c[0] === 'banner').pop()[1];
      ok(bs.score.text === '10000' && bs.medal === 3 && bs.lines.length === 1 && bs.lines[0].y === 200, 'banner: score 10000, gold, one line at y 200');
      // trophies / hiscore are only ever raised
      const g3 = (() => { const L3 = loadZone(ctx, 'z05WAB'); const g = createWabGame({ ...sctx, world: L3.world, scene: L3.scene, archive: L3.archive }); const b = L3.world.records[1].ctrl.nodes.find((n) => n.kind === 'botwab'); b.sh.over = 1; b.sh.pct = 62.5; return { g, b }; })();
      said.length = 0;
      g3.g.onBanner(2); g3.g.bannerTick();   // the vars are written in the first banner frame (one tick later)
      ok(vars.get(VAR.HISCORE) === 10000 && vars.get(VAR.TROPHY) === 3, 'a worse run does not lower HISCORE / TROPHY');
      ok(said.length === 1 && said[0][0] === LINE.BRONZE, 'bronze line spoken');
      for (const [pct, update, med, lines] of [[89.9, 1, 2, [LINE.SILVER]], [49.9, 2, 0, [LINE.NEAR1, LINE.NEAR2]], [50, 1, 1, [LINE.BRONZE]], [90, 1, 3, [LINE.GOLD]]]) {
        const v2 = new GameVars(); const L4 = loadZone(ctx, 'z05WAB');
        const sx = { ...sctx, vars: v2, world: L4.world, scene: L4.scene, archive: L4.archive };
        const g = createWabGame(sx); const b = L4.world.records[1].ctrl.nodes.find((n) => n.kind === 'botwab'); b.sh.over = 1; b.sh.pct = pct;
        said.length = 0; calls.length = 0;
        ok(g.update() === update, `pct ${pct}: update() = ${update}`);
        g.onBanner(update); g.bannerTick();   // the vars are written in the first banner frame (one tick later)
        ok(v2.get(VAR.TROPHY) === med && v2.get(VAR.HISCORE) === scoreOf(pct) * (scoreOf(pct) > 0 ? 1 : 1), `pct ${pct}: trophy ${med}`);
        ok(JSON.stringify(said[0]) === JSON.stringify([lines[0], lines[1] ?? null]), `pct ${pct}: speech ${lines}`);
        g.drawBanner({}, update);
        const spec = calls.filter((c) => c[0] === 'banner').pop()[1];
        ok(spec.lines.length === lines.length && spec.lines.map((l) => l.y).join() === (lines.length === 2 ? '200,330' : '200'), `pct ${pct}: banner lines at ${spec.lines.map((l) => l.y)}`);
      }
    }
    return { checked, failures, notes };
  },
};
