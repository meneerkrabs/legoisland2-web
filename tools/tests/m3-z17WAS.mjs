import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { unregisterCtor } from '../../src/game/setup.ts';
import { parseBlk } from '../../src/formats/anim.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import '../../src/zones/z17WAS.ts';
import {
  CTOR_PEPWAS, CTOR_ZONEWAS, REC, SND, K, SN, CLIP, MEDAL, WAS_FOV, medalOfScore, isWin, checkRecords, prepareWas, applyResult, resultLine, medalText, resultOf,
  ALL_SOUNDS_2D, ALL_SOUNDS_3D,
} from '../../src/zones/z17was/rules.ts';

// z17WAS "Whack-A-Snake" (docs/re/m3/z17WAS.md): constants and tables against the executable (the code streams of FUN_00698efe / 00699e80 / 0069b337 / 0069b9b0 /
// 00699950), Pepper's button state machine, the four snake baskets (spawn, rise, whack, grab the gem, sink, penalty), the clock and its sounds, the result
// (medals, variables), a scripted WIN and LOSS, and a bot that plays the whole 90 seconds.

const u32f = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
const hex = (n) => '0x' + n.toString(16);

export default {
  name: 'm3-z17WAS',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z17WAS');
    const code = (va, n) => pe.slice(va, n);
    /** all dword immediates (as u32) in a code range that follow the given opcode prefix bytes */
    const dwordsAfter = (va, n, prefix) => {
      const b = code(va, n); const out = [];
      for (let i = 0; i + prefix.length + 4 <= n; i++) {
        let m = true;
        for (let j = 0; j < prefix.length; j++) if (b[i + j] !== prefix[j]) { m = false; break; }
        if (m) out.push((b[i + prefix.length] | (b[i + prefix.length + 1] << 8) | (b[i + prefix.length + 2] << 16) | (b[i + prefix.length + 3] << 24)) >>> 0);
      }
      return out;
    };
    const bytesAfter = (va, n, prefix) => {
      const b = code(va, n); const out = [];
      for (let i = 0; i + prefix.length + 1 <= n; i++) {
        let m = true;
        for (let j = 0; j < prefix.length; j++) if (b[i + j] !== prefix[j]) { m = false; break; }
        if (m) out.push(b[i + prefix.length]);
      }
      return out;
    };
    const rigs = () => ({ SNAK: parseBlk(arch.read(arch.find('anim/SNAK.blk'))), MFIG: parseBlk(arch.read(arch.find('anim/MFIG.blk'))) });

    try {
      // ============================================================ tables against the executable
      {
        // the constructors the set-up attaches
        const L = loadZone(ctx, 'z17WAS');
        const at = L.setup.attaches.map((a) => [a.record, a.ctor]);
        ok(at.length === 2 && at[0][0] === REC.PEPP && at[0][1] === CTOR_PEPWAS && at[1][0] === REC.WAS && at[1][1] === CTOR_ZONEWAS, `set-up attaches pepwas @ ${hex(CTOR_PEPWAS)} to record 0 and zonewas @ ${hex(CTOR_ZONEWAS)} to record 22: ${JSON.stringify(at)}`);
        ok(L.setup.attaches.every((a) => a.var === 2 && a.mask === 1 && a.value === 1), 'both attaches are gated by var 2 & 1 == 1 (always on)');
        ok(L.skipped.length === 0, `no attach left unported: ${JSON.stringify(L.skipped)}`);
        ok(checkRecords(L.world.records).length === 0, `record table names: ${checkRecords(L.world.records).join('; ')}`);
        ok(L.world.records.length === 52, `${L.world.records.length} records`);
        // hide / field writes of the set-up: SHFT (record 51) hidden, SKEL y 2.1 / 0.05
        ok((L.world.records[51].flags & 2) === 0 && L.world.records[51].name === 'SHFT', 'SHFT hidden by the set-up');
        ok(near(L.world.records[5].y, 2.1) && near(L.world.records[6].y, 0.05), `SKEL heights ${L.world.records[5].y} ${L.world.records[6].y}`);
        // the scene's positions match the builder: baskets in a diamond, LID0 closed height
        const R = L.world.records;
        ok(near(R[REC.LID[0]].y, 2.32, 0.01), `closed lid y ${R[REC.LID[0]].y}`);
        ok(near(R[REC.BAS[2]].x, 1.76, 0.01) && near(R[REC.BAS[3]].x, -1.76, 0.01) && near(R[REC.BAS[0]].z, 8.76, 0.01) && near(R[REC.BAS[1]].z, 5.24, 0.01), 'basket diamond: k2 left (x +1.76), k3 right (-1.76), k0 near (z 8.76), k1 far (5.24)');
        for (let k = 0; k < 4; k++) ok(near(R[REC.SNAKE[k]].x, R[REC.BAS[k]].x, 0.05) && near(R[REC.SNAKE[k]].z, R[REC.BAS[k]].z, 0.05) && near(R[REC.LID[k]].x, R[REC.BAS[k]].x, 0.05), `snake / lid / basket ${k} share the basket's place`);
      }
      {
        // FUN_00698efe: the medal thresholds (`cmp [DAT_05d5be54], imm`)
        const b = code(0x698efe, 0x1000);
        const imms = new Set();
        for (let i = 0; i < 0xfff; i++) {
          if (b[i] === 0x81 && b[i + 1] === 0x3d && b[i + 2] === 0x54 && b[i + 3] === 0xbe && b[i + 4] === 0xd5 && b[i + 5] === 0x05) imms.add(b[i + 6] | (b[i + 7] << 8) | (b[i + 8] << 16) | (b[i + 9] << 24));
          if (b[i] === 0x83 && b[i + 1] === 0x3d && b[i + 2] === 0x54 && b[i + 3] === 0xbe && b[i + 4] === 0xd5 && b[i + 5] === 0x05) imms.add(b[i + 6]);
        }
        const got = [...imms].sort((a, c) => a - c);
        ok(got.join() === [0x64, 0x1388, 0x2134].join(), `score compares in FUN_00698efe: ${got.map(hex)} (compares are score > 0x64 / 0x1388 / 0x2134 = the thresholds 101 / 5001 / 8501)`);
        ok(MEDAL.BRONZE === 0x65 && MEDAL.SILVER === 0x1389 && MEDAL.GOLD === 0x2135, 'MEDAL constants = 101 / 5001 / 8501');
        const cases = [[0, 0], [100, 0], [101, 1], [5000, 1], [5001, 2], [8500, 2], [8501, 3], [10000, 3]];
        for (const [s, m] of cases) ok(medalOfScore(s) === m, `medalOfScore(${s}) = ${medalOfScore(s)} expected ${m}`);
        ok(!isWin(100) && isWin(101), 'a game is won above 100 points (FUN_00404d14(.., 100 < score))');
        // the variables written: 200 (HISCORE_WAS) and 0xd5 (TROPHY_WAS): `mov ecx, 0xc8 / 0xd5` -> FUN_00417575 / FUN_00417597 calls
        const pushes = new Set(dwordsAfter(0x698efe, 0x1000, [0x68]));
        ok(pushes.has(0xc8) && pushes.has(0xd5), 'FUN_00698efe pushes the variable ids 0xc8 and 0xd5');
        const names = ['SWITCH_GME_HISCORE_WAS', 'SWITCH_GME_TROPHY_WAS'];
        const txt = [0xc8, 0xd5].map((i) => pe.cstr(pe.u32(0x8a3228 + i * 4), 64));
        ok(txt[0] === names[0] && txt[1] === names[1], `game variable names ${txt}`);
        // the strings of the banner
        const strs = ['ADSGWS01', 'ADSGWS02', 'ADSGWS03', 'ADSGWS04', 'ADSGWS06', 'SGGOLD', 'SGSILVER', 'SGBRONZE'];
        for (const s of strs) ok(pe.findStrings(s).length > 0, `string ${s} in the executable`);
        ok(resultLine(0) === 'ADSGWS04' && resultLine(101) === 'ADSGWS03' && resultLine(5001) === 'ADSGWS02' && resultLine(8501) === 'ADSGWS01', 'result lines by medal');
        ok(medalText(100) === '' && medalText(101) === 'SGBRONZE' && medalText(5001) === 'SGSILVER' && medalText(8501) === 'SGGOLD', 'medal texts');
        // applyResult only raises
        const v = new Map([[200, 500], [0xd5, 2]]);
        const vars = { get: (i) => v.get(i) ?? 0, set: (i, x) => v.set(i, x) };
        applyResult(vars, 300); ok(v.get(200) === 500 && v.get(0xd5) === 2, `a worse run changes nothing (${v.get(200)}, ${v.get(0xd5)})`);
        applyResult(vars, 9000); ok(v.get(200) === 9000 && v.get(0xd5) === 3, `a better run raises both (${v.get(200)}, ${v.get(0xd5)})`);
        v.set(0xd5, -1); applyResult(vars, 50); ok(v.get(0xd5) === 0, 'trophy -1 below 101 points becomes 0');
      }
      {
        // the zonewas constructor (0x69b337..) and the rules (0x699e80..): constants as stored in the code stream
        const ctorImm = new Set([...dwordsAfter(0x69b337, 0x400, [0xc7, 0x41]).slice(0), ...dwordsAfter(0x69b337, 0x400, [0xc7, 0x40]), ...dwordsAfter(0x69b337, 0x400, [0xc7, 0x42]), ...dwordsAfter(0x69b337, 0x400, [0xc7, 0x80])]);
        // constructor stores like `mov dword [reg+disp8], imm32`: the floats of the node
        const want = { 'time 2700.0': 0x4528c000, 'travel 2.664': 0x402a7efa, 'hidden y -0.4': 0xbecccccd, 'lid offset 2.264': 0x4010e560, 'rise 6.0': 0x40c00000, 'sink 9.0': 0x41100000, 'up 48.0': 0x42400000, 'gap 30.0': 0x41f00000 };
        const all = code(0x69b337, 0x900); const dv = new DataView(all.buffer, all.byteOffset, all.byteLength);
        const seen = new Set(); for (let i = 0; i + 4 <= 0x900; i++) seen.add(dv.getUint32(i, true));
        for (const [n, u] of Object.entries(want)) ok(seen.has(u), `zonewas constructor stores ${n} (${hex(u)})`);
        void ctorImm;
        ok(K.TIME === u32f(0x4528c000) && near(K.TRAVEL, u32f(0x402a7efa)) && near(K.HIDDEN_Y, u32f(0xbecccccd)) && near(K.LID_OFFSET, u32f(0x4010e560)), 'K constants = the stored floats');
        ok(K.RISE_TICKS === 6 && K.SINK_TICKS === 9 && K.UP_TICKS === 48, 'rise / sink / up ticks');
        // the rules: gaps 15 / 19 / 24 are immediates (0x41700000 / 0x41980000 / 0x41c00000), thresholds read from .rdata
        const rb = code(0x699e80, 0x1500); const rdv = new DataView(rb.buffer, rb.byteOffset, rb.byteLength);
        const rseen = new Set(); for (let i = 0; i + 4 <= 0x1500; i++) rseen.add(rdv.getUint32(i, true));
        for (const u of [0x41700000, 0x41980000, 0x41c00000]) ok(rseen.has(u), `rules store ${u32f(u)} (${hex(u)})`);
        ok(K.SPAWN_GAP.join() === [15, 19, 24].join(), 'spawn gaps 15 / 19 / 24');
        ok(u32f(pe.u32(0x892044)) === 480 && u32f(pe.u32(0x892634)) === 930 && u32f(pe.u32(0x892630)) === 1830, 'gap thresholds .rdata 480 / 930 / 1830');
        ok(K.GAP_AT.join() === [480, 930, 1830].join(), 'GAP_AT');
        ok(near(u32f(pe.u32(0x892084)), 0.8) && near(u32f(pe.u32(0x8921f0)), 0.75) && near(u32f(pe.u32(0x8920cc)), 0.1) && u32f(pe.u32(0x892038)) === 30 && u32f(pe.u32(0x892788)) === 7, '.rdata: 0.8 top margin, 0.75 holder lift, 0.1 gem lift, 30 ticks / s, 7.0 eye shift');
        ok(u32f(pe.u32(0x892074)) === 15, '_DAT_00892074 = 15.0: the start-up timer of pepwas');
        ok(near(WAS_FOV, u32f(0x3ecccccd)), 'the zoom 0x3ecccccd = 0.4 (FUN_00699c4e: FUN_0040cd1a(0x3ecccccd))');
        // the score steps in the code: add 300 (0x12c), 70 (0x46), the cap 10000 (0x2710), the loss 300
        const rbytes = [...rb];
        const find = (seq) => { const r = []; for (let i = 0; i + seq.length <= rbytes.length; i++) { let m = true; for (let j = 0; j < seq.length; j++) if (rbytes[i + j] !== seq[j]) { m = false; break; } if (m) r.push(0x699e80 + i); } return r; };
        ok(find([0x2c, 0x01, 0x00, 0x00]).length === 2, `the immediate 300 (0x12c) occurs twice in the rules (the gem +300 at 0x69ab97 and the lost-gem -300 at 0x69a4da): ${find([0x2c, 0x01, 0x00, 0x00]).map(hex)}`);
        ok(find([0x10, 0x27, 0x00, 0x00]).length === 4, 'the cap 10000 (0x2710) occurs in the rules (compare + store, twice)');
        ok(find([0x83, 0xc0, 0x46]).length + find([0x83, 0xc1, 0x46]).length + find([0x83, 0xc2, 0x46]).length === 1, 'score + 70 (add reg, 0x46) once in the rules');
        ok(K.SCORE_GEM === 300 && K.SCORE_WHACK === 70 && K.SCORE_MAX === 10000 && K.SCORE_LOST === 300, 'score constants');
        // the clip numbers pepwas stores in `next` (mov byte [reg+0x19], imm)
        const nexts = new Set([...bytesAfter(0x69b9b0, 0x500, [0xc6, 0x40, 0x19]), ...bytesAfter(0x69b9b0, 0x500, [0xc6, 0x41, 0x19]), ...bytesAfter(0x69b9b0, 0x500, [0xc6, 0x42, 0x19])]);
        for (const c of [3, 0xc, 4, 0xb, 6, 9, 7, 8, 0xff]) ok(nexts.has(c), `pepwas queues clip ${c}`);
        // sound ids FUN_00699950 loads: every id the port plays, with its table name
        const pushed = new Set(dwordsAfter(0x699950, 0x300, [0x68]));
        for (const id of [...ALL_SOUNDS_2D, ...ALL_SOUNDS_3D]) ok(pushed.has(id), `FUN_00699950 loads sound ${hex(id)}`);
        const left = [...pushed].filter((id) => ![...ALL_SOUNDS_2D, ...ALL_SOUNDS_3D].includes(id) && id > 0x100 && id < 0x400).map(hex);
        notes.push(`sounds loaded by FUN_00699950 and never played by the zone: ${left.join(' ')} (SND_WAS_BIGTHUMP / BIGSWING)`);
        const tab = readAudioTables(pe.data);
        const nm = (id) => tab.sounds[id]?.name;
        ok(SND.UP.map(nm).join() === 'SND_WAS_FLIP_R,SND_WAS_FLIP_U,SND_WAS_FLIP_L,SND_WAS_FLIP_D', `UP sounds ${SND.UP.map(nm)}`);
        ok(SND.SPAWN.map(nm).join() === 'SND_WAS_SNAKE_R,SND_WAS_SNAKE_U,SND_WAS_SNAKE_L,SND_WAS_SNAKE_D', `SPAWN sounds ${SND.SPAWN.map(nm)}`);
        ok(SND.HIT.map(nm).join() === 'SND_WAS_HIT_R,SND_WAS_HIT_U,SND_WAS_HIT_L,SND_WAS_HIT_D', `HIT sounds ${SND.HIT.map(nm)}`);
        ok(nm(SND.TORCH) === 'SND_WAS_TORCH' && tab.sounds[SND.TORCH].loopCount === 0, 'the torch is a loop');
        ok([SND.CLOCK_LOW, SND.CLOCK_MID, SND.CLOCK_HIGH, SND.OUT_OF_TIME, SND.GASP, SND.GET_CRYSTAL].map(nm).join() === 'SND_WAS_CLOCKLOW,SND_WAS_CLOCKMID,SND_WAS_CLOCKHIGH,SND_WAS_OUTOFTIME,SND_WAS_GASP,SND_WAS_GETCRYSTAL', 'clock / gasp / crystal sounds');
      }

      // ============================================================ scenarios
      const make = (opts = {}) => {
        const L = loadZone(ctx, 'z17WAS');
        const w = L.world;
        const nodes = prepareWas(w, L.pepper, rigs(), L.pe);
        const sh = nodes.shared;
        const log = [];
        sh.sounds = { play: (id) => log.push({ t: w.tickCount + 1, id }), play3D: (id) => log.push({ t: w.tickCount + 1, id, d3: true }) };
        // the random numbers by range: int(4) = the basket, int(3) = the gem (0 = this snake holds it), int(8) = Pepper's grunt (0 / 1)
        const plan = { 4: opts.baskets ?? [0, 1, 2, 3], 3: opts.gem ?? [], 8: opts.grunt ?? [] };
        let n4 = 0;
        // int(4): the scripted baskets once, then 0, 1, 2, 3 round robin; int(3): the scripted values, then 1 (no gem); int(8): the scripted values, then 7 (no grunt)
        sh.rng = { int: (n) => (n === 4 ? (n4 < plan[4].length ? plan[4][n4++] : n4++ % 4) : n === 3 ? (plan[3].length ? plan[3].shift() : 1) : n === 8 ? (plan[8].length ? plan[8].shift() : 7) : 0) };
        const P = { DOWN: 'ArrowDown', UP: 'ArrowUp', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' };
        const tick = (n = 1, key = null) => {
          for (let i = 0; i < n; i++) {
            if (key && i === 0) w.input.setKey(P[key], true);
            w.tick();
            if (key && i === 0) w.input.setKey(P[key], false);
          }
        };
        return { L, w, ...nodes, sh, log, tick, R: w.records, pep: L.pepper, snd: (id) => log.filter((e) => e.id === id) };
      };
      // the button of each basket k: DOWN (k0), UP (k1), LEFT (k2), RIGHT (k3)
      const BTN = ['DOWN', 'UP', 'LEFT', 'RIGHT'];

      // ---- start state
      {
        const g = make();
        const { w, node, R, pep, pepNode } = g;
        ok(R.every((r, i) => ![...REC.SNAKE].includes(i) || (r.flags & 2) === 0), 'snakes hidden at the start');
        ok((R[REC.GEMM].flags & 2) === 0, 'gem hidden at the start');
        ok(REC.SNAKE.every((i) => R[i].anim && R[i].anim.clip === CLIP.SNAKE_IDLE), 'snakes play clip 3');
        ok([0, 3, 7, 6].every((f, n) => R[[1, 2, 3, 4][n]].anim.frame === f), `snake start frames ${[1, 2, 3, 4].map((i) => R[i].anim.frame)}`);
        ok(R[REC.SKEL[0]].anim.clip === 13 && R[REC.SKEL[1]].anim.clip === 14, 'skeleton clips 13 / 14');
        ok(pep.anim.clip === 1 && pep.anim.frame === 0 && pepNode.busy, 'Pepper starts in clip 1, busy');
        ok(pep.ctrl.nodes.length === 1 && pep.ctrl.nodes[0].kind === 'pepwas', 'Pepper runs only pepwas');
        const c = w.camera.c;
        ok(near(c[0], 0, 1e-3) && near(c[1], 8.0 + pep.y, 1e-2) && near(c[2], 24.8 + pep.z + 7, 1e-2), `camera eye ${[c[0], c[1], c[2]].map((x) => x.toFixed(3))}`);
        ok(near(c[3], 0, 1e-3) && near(c[4], 4 + pep.y, 1e-2) && near(c[5], 9.6 + pep.z, 1e-2), `camera target ${[c[3], c[4], c[5]].map((x) => x.toFixed(3))}`);
        ok(node.timeLeft === 2700 && node.elapsed === 0 && node.score === 0, 'clock 2700, score 0');
        ok(near(node.closedY, 2.32, 0.01), 'closed lid y');
      }

      // ---- the first snake: tick 15 (elapsed > 14), then the rise
      {
        const g = make({ baskets: [0], gem: [1] });
        const { node, tick, R, sh, log } = g;
        tick(14);
        ok(node.state.every((s) => s === 0) && log.filter((e) => e.id !== SND.TORCH).length === 0, 'nothing spawns in the first 14 ticks');
        tick(1);
        ok(node.state[0] === SN.RISING && (R[REC.SNAKE[0]].flags & 3) === 3, `first snake at tick 15 in basket 0: ${node.state}`);
        ok(g.snd(SND.GASP).length === 1 && g.snd(SND.SPAWN[0]).length === 1 && g.snd(SND.GASP)[0].t === 15, 'Pepper gasps and the lid pops at tick 15');
        ok(!sh.done && node.first === false, 'first flag cleared');
        const ys = [];
        for (let i = 0; i < 6; i++) { tick(1); ys.push(node.y[0]); }
        ok(node.state[0] === SN.UP, `snake is up after 5 more ticks (${node.state[0]})`);
        ok(near(ys[0], -0.4 + 2.664 / 6) && near(ys[3], -0.4 + 4 * 2.664 / 6), `rising y ${ys.map((y) => y.toFixed(3))}`);
        ok(near(node.y[0], -0.4 + 2.664 - 0.8, 1e-4), `top y ${node.y[0]} = 1.464`);
        ok(g.snd(SND.UP[0]).length === 1 && g.snd(SND.UP[0])[0].t === 20, 'the "up" sound at tick 20');
        ok(node.holder === -1, 'no gem on this snake (int(3) = 1)');
        // the snake stays 48 ticks (topAt = elapsed 19), sinks 9 ticks, is hidden and nobody is penalised
        for (let i = 0; i < 80 && node.state[0] !== SN.HIDDEN; i++) tick(1);
        ok(node.state[0] === SN.HIDDEN && (R[REC.SNAKE[0]].flags & 2) === 0, 'the snake went down again');
        ok(node.score === 0, 'a plain snake that escapes costs nothing');
        ok(near(R[REC.LID[0]].y, node.closedY, 1e-3), `lid closed again (${R[REC.LID[0]].y})`);
        notes.push(`one snake: spawn tick 15, up at tick 20, hidden at tick ${g.w.tickCount} (elapsed ${node.elapsed})`);
      }

      // ---- Pepper: wind-up, whack, the sounds, the buttons
      {
        const g = make({ baskets: [2], grunt: [0, 1, 5, 7] });
        const { node, tick, R, pepNode, pep, log, w } = g;
        tick(16);                                                  // the start-up timer (15 ticks) has freed the buttons
        ok(!pepNode.busy, 'buttons free after the start-up timer');
        tick(1, 'LEFT');
        ok(pepNode.cur === CLIP.WINDUP && pepNode.next === 3 && pepNode.presses === 1 && pepNode.dir === 1 && pep.anim.clip === 10, `first LEFT: wind-up clip, then clip 3 (${pepNode.cur}/${pepNode.next}/${pepNode.presses})`);
        let n = 0; while (pepNode.cur === CLIP.WINDUP && n++ < 30) tick(1);
        ok(pepNode.cur === 3 && pep.anim.clip === 3 && n >= 8 && n <= 10, `after ${n} ticks the whack clip 3 starts`);
        ok(g.log.some((e) => e.d3 && e.id === SND.SWISH[0]), 'swish sound (3D) at the swing');
        ok(g.log.some((e) => e.id === SND.GRUNT[0]), 'the first int(8) = 0 gives grunt 1');
        // busy until the last 5 frames
        ok(pepNode.busy, 'busy during the whack');
        let m = 0; while (pepNode.busy && m++ < 40) tick(1);
        ok(!pepNode.busy && pep.anim.frame >= pep.anim.frameCount - 5 && pep.anim.clip === 3, `buttons free in the last 5 frames (frame ${pep.anim.frame})`);
        // back to idle
        let q = 0; while (pep.anim.clip !== 1 && q++ < 40) tick(1);
        ok(pep.anim.clip === 1 && g.sh.clip === 1 && pepNode.presses === 0, 'back to the idle clip 1');
        // double press: 2nd press during the wind-up replaces clip 3 by 6
        tick(1, 'RIGHT'); tick(1); tick(1, 'RIGHT');
        ok(pepNode.next === 7 && pepNode.presses === 2 && pepNode.busy, `RIGHT twice: grab clip 7 queued (${pepNode.next}, presses ${pepNode.presses})`);
        let r = 0; while (pepNode.cur === CLIP.WINDUP && r++ < 30) tick(1);
        ok(pepNode.cur === 7 && g.log.some((e) => e.d3 && e.id === SND.XSWISH[0]), 'grab clip 7 + the x-swish sound');
        // other buttons during the wind-up are ignored
        let q2 = 0; while (pep.anim.clip !== 1 && q2++ < 60) tick(1);
        tick(1, 'UP'); tick(1, 'LEFT');
        ok(pepNode.dir === 4 && pepNode.next === 0xb && pepNode.presses === 1, `a different button in the wind-up is ignored (dir ${pepNode.dir}, next ${pepNode.next})`);
        void node; void R; void log; void w;
      }

      // ---- whack a snake (basket 0 = DOWN): score 70, the squash, the dented basket, the reset
      {
        const g = make({ baskets: [0] });
        const { node, tick, R, pepNode, pep } = g;
        tick(22);                                                  // the snake is up (tick 20)
        ok(node.state[0] === SN.UP, 'snake 0 up');
        tick(1, 'DOWN');
        let t0 = g.w.tickCount, seen = new Set(), n = 0, firstHit = -1, kets = new Set();
        while (n++ < 60) {
          tick(1);
          if (node.hit[0] === 1 && firstHit < 0) firstHit = g.w.tickCount - t0;
          for (let i = 2; i <= 8; i++) if ((R[REC.KET_FIRST + i - 2].flags & 2) !== 0 && R[REC.KET_FIRST + i - 2].x === R[REC.BAS[0]].x) kets.add(i);
          seen.add(node.squash);
          if (node.hit[0] === 0 && firstHit >= 0) break;
        }
        ok(node.score === 70 && node.hits === 1 && node.gems === 0, `whack: score ${node.score}, hits ${node.hits}`);
        ok(firstHit > 0 && firstHit <= 14, `the hit lands ${firstHit} ticks after the press (wind-up 9 + frame 2)`);
        ok(g.snd(SND.HIT[0]).length === 1, 'the hit sound of basket 0 once');
        ok(kets.size >= 5 && kets.has(2), `the dented baskets KET${[...kets].join(',KET')} were shown at the basket's place`);
        ok(seen.has(true) && !node.squash, 'squash flag set during the swing and cleared after');
        ok(node.state[0] === SN.HIDDEN && (R[REC.SNAKE[0]].flags & 2) === 0, 'the whacked snake is gone');
        ok((R[REC.BAS[0]].flags & 3) === 3 && R.slice(REC.KET_FIRST, REC.KET_FIRST + 7).every((r) => r.x !== R[REC.BAS[0]].x || (r.flags & 2) === 0), 'the plain basket is back, all dented ones hidden');
        ok(near(R[REC.LID[0]].y, node.closedY, 1e-3), 'lid closed after the squash');
        ok(R[REC.SNAKE[0]].anim.clip === 3, 'snake animation back on clip 3');
        void pepNode; void pep;
      }

      // ---- the gem: grab on the holder = +300; a plain whack on the holder does nothing; an escaped holder costs 300
      {
        const g = make({ baskets: [2], gem: [0] });                // the first snake holds the gem
        const { node, tick, R, pep } = g;
        tick(22);
        ok(node.holder === 2 && (R[REC.GEMM].flags & 2) !== 0, 'basket 2 holds the gem (gem visible)');
        ok(near(R[REC.GEMM].x, R[REC.SNAKE[2]].x) && R[REC.GEMM].y > 1, 'gem sits on the snake');
        tick(1, 'LEFT'); tick(1); tick(1, 'LEFT');                 // double press = grab
        for (let i = 0; i < 25; i++) tick(1);
        ok(node.gems === 1 && node.hits === 1 && node.score === 300 && node.hit[2] === 2, `gem taken: gems ${node.gems} score ${node.score} hit ${node.hit[2]}`);
        ok((R[REC.GEMM].flags & 2) === 0, 'gem hidden after the grab');
        ok(g.snd(SND.GET_CRYSTAL).length === 1, 'get-crystal sound');
        for (let i = 0; i < 60 && node.state[2] !== SN.HIDDEN; i++) tick(1);
        ok(node.score === 300 && node.holder === -1, `the snake sinks without penalty after the grab (score ${node.score})`);
        void pep;
      }
      {
        const g = make({ baskets: [2, 0, 1], gem: [0, 1, 1, 1, 1, 1, 1, 1] });
        const { node, tick, R } = g;
        tick(22);
        ok(node.holder === 2, 'gem on basket 2');
        // a plain whack on the holder: nothing
        tick(1, 'LEFT');
        for (let i = 0; i < 40; i++) tick(1);
        ok(node.score === 0 && node.hits === 0 && node.hit[2] === 0 && !node.squash, `single press on the gem snake: no score (${node.score}, hits ${node.hits})`);
        // the snake leaves with the gem: score is 0, stays 0 (clamped)
        for (let i = 0; i < 80 && node.state[2] !== SN.HIDDEN; i++) tick(1);
        ok(node.state[2] === SN.HIDDEN && node.holder === -1 && node.score === 0, 'escaped holder: score clamped at 0');
        ok((R[REC.GEMM].flags & 2) === 0, 'gem hidden when the snake leaves');
      }
      {
        // -300 when there is something to lose: give the player 500 points, the holder escapes
        const g = make({ baskets: [3], gem: [0] });
        const { node, tick } = g;
        node.score = 500;
        tick(25);
        for (let i = 0; i < 120 && node.state[3] !== SN.HIDDEN; i++) tick(1);
        ok(node.score === 200, `holder escapes: 500 - 300 = ${node.score}`);
      }
      {
        // a grab on a snake that does not hold the gem, and a whack with a grab clip: nothing happens
        const g = make({ baskets: [0], gem: [1] });
        const { node, tick } = g;
        tick(22);
        tick(1, 'DOWN'); tick(1); tick(1, 'DOWN');
        for (let i = 0; i < 40; i++) tick(1);
        ok(node.score === 0 && node.hits === 0, `grab clip on a plain snake: nothing (${node.score})`);
        ok(g.snd(SND.HIT[0]).length === 1, 'but the hit sound plays');
      }
      {
        // a hit on a snake that is rising or sinking does not count (and plays no sound)
        const g = make();
        const { node, tick, sh, pep, pepNode } = g;
        node.state[1] = SN.RISING; node.state[2] = SN.SINKING; node.y[1] = 0; node.y[2] = 1;
        for (const [clip, k] of [[0xb, 1], [3, 2]]) {
          sh.clip = clip; pepNode.cur = clip; pep.anim.start(clip, 0); pepNode.busy = true; node.lock = false;
          tick(4);
          ok(node.score === 0 && node.hits === 0 && node.hit[k] === 0 && g.snd(SND.HIT[k]).length === 0, `clip ${clip} frame ${pep.anim.frame} on a ${k === 1 ? 'rising' : 'sinking'} snake: no hit`);
        }
        // and once it is up, the same swing hits
        node.state[1] = SN.UP; node.topAt[1] = node.elapsed; sh.clip = 0xb; pep.anim.start(0xb, 0); pepNode.cur = 0xb; node.lock = false;
        tick(4);
        ok(node.score === 70 && node.hit[1] === 1, `the swing on an up snake hits (${node.score})`);
      }

      // ---- the clock and its sounds
      {
        const g = make({ baskets: [0, 1, 2, 3] });
        const { node, tick, sh, w } = g;
        tick(2);
        ok(node.timeText === '01:29' || node.timeText === '01:30' || node.timeText === '01:29', `clock text ${node.timeText}`);
        // run to the end without input; collect the clock sounds
        let n = 2; while (!sh.done && n++ < 2800) tick(1);
        ok(sh.done && w.tickCount === 2701, `the game ends on tick ${w.tickCount} (done ${sh.done})`);
        const beeps = g.log.filter((e) => [SND.CLOCK_LOW, SND.CLOCK_MID, SND.CLOCK_HIGH, SND.OUT_OF_TIME].includes(e.id));
        const kinds = beeps.map((e) => e.id);
        const count = (id) => kinds.filter((x) => x === id).length;
        ok(beeps.length === 17 && count(SND.CLOCK_LOW) === 4 && count(SND.CLOCK_MID) === 4 && count(SND.CLOCK_HIGH) === 8 && count(SND.OUT_OF_TIME) === 1, `17 clock sounds: ${count(SND.CLOCK_LOW)} low, ${count(SND.CLOCK_MID)} mid, ${count(SND.CLOCK_HIGH)} high, ${count(SND.OUT_OF_TIME)} out of time`);
        ok(beeps[0].t === 2700 - 509 + 1 || Math.abs(beeps[0].t - (2700 - 509)) <= 1, `first clock sound at tick ${beeps[0].t} (16 s left)`);
        ok(beeps[beeps.length - 1].id === SND.OUT_OF_TIME, 'the last one is "out of time"');
        ok(g.log.filter((e) => e.id === SND.TORCH).length === w.tickCount, 'the torch loop is requested every tick');
        ok(sh.finalScore === 0 && resultOf(sh) === 2, `no input: score ${sh.finalScore}, result ${resultOf(sh)} = lost`);
        ok(g.pep.anim.clip === CLIP.LOSE, `Pepper plays the sad clip 5 (${g.pep.anim.clip})`);
        ok(medalOfScore(sh.finalScore) === 0 && resultLine(sh.finalScore) === 'ADSGWS04', 'no medal, the antidote line');
        notes.push(`LOSS (no input): done on tick ${w.tickCount}, score ${sh.finalScore}, ${beeps.length} clock sounds, first at tick ${beeps[0].t}`);
      }

      // ---- the spawn gap grows: 15, 19, 24 ticks
      {
        const g = make();
        const { node, tick } = g;
        const gaps = [];
        for (let i = 0; i < 2000; i++) { tick(1); if (gaps.length === 0 || gaps[gaps.length - 1][1] !== node.gap) gaps.push([node.elapsed, node.gap]); }
        ok(gaps.map((x) => x[1]).join() === '15,19,24', `gap sequence ${gaps.map((x) => x.join(':'))}`);
        ok(gaps[1][0] === 480 && gaps[2][0] === 930, `the gap changes at elapsed ${gaps[1][0]} / ${gaps[2][0]}`);
      }

      // ---- the skeletons cheer at 4 / 8 / 12 gems
      {
        const g = make();
        const { node, tick, R } = g;
        const s1 = R[REC.SKEL[0]].anim, s2 = R[REC.SKEL[1]].anim;
        tick(5);
        ok(s1.frame === 0 && node.stage === 0, 'skeletons wait below 4 gems');
        node.gems = 4;
        let n = 0; while (node.stage === 0 && n++ < 100) tick(1);
        ok(node.stage === 1 && n >= 44 && n <= 48, `skeleton 1 cheered (clip 13, 46 frames) in ${n} ticks`);
        const f2 = s2.frame;
        tick(5); ok(s2.frame === f2 && node.stage === 1, 'skeleton 2 waits for 8 gems');
        node.gems = 8; n = 0; while (node.stage === 1 && n++ < 150) tick(1);
        ok(node.stage === 2 && n >= 88 && n <= 92, `skeleton 2 cheered (clip 14, 91 frames) in ${n} ticks`);
        node.gems = 100; n = 0; while (node.stage < 8 && n++ < 1500) tick(1);
        ok(node.stage === 8, `all eight stages reached with 100 gems (stage ${node.stage})`);
      }

      // ---- scripted WIN: whack a few snakes (the same two baskets), the result is 1 and the medal bronze
      {
        const g = make({ baskets: [0, 1, 0, 1, 2, 3] });
        const { node, tick, sh, R, w } = g;
        let sec = 0;
        // a simple scripted player: press the button of every snake that has been up for 3 ticks and is not whacked yet
        const bot = () => {
          if (g.pepNode.busy || g.pepNode.presses) return null;
          for (let k = 0; k < 4; k++) if (node.state[k] === SN.UP && node.hit[k] === 0 && node.holder !== k && !node.squash && w.tickCount - (node.topAt[k] + 1) >= 0) return BTN[k];
          return null;
        };
        let n = 0;
        while (!sh.done && n++ < 3000) { const b = bot(); if (b) tick(1, b); else tick(1); sec++; }
        ok(sh.done, 'the scripted game ends');
        ok(sh.finalScore > 100 && resultOf(sh) === 1, `WIN: score ${sh.finalScore}, result ${resultOf(sh)}`);
        ok(medalOfScore(sh.finalScore) >= 1, `medal ${medalOfScore(sh.finalScore)} for ${sh.finalScore}`);
        ok(sh.finalScore % 10 === 0 && node.hits > 0, 'hits counted');
        ok(g.pep.anim.clip === CLIP.WIN, `Pepper cheers (clip ${g.pep.anim.clip})`);
        notes.push(`WIN (scripted bot, no gems): score ${sh.finalScore}, hits ${node.hits}, medal ${medalOfScore(sh.finalScore)}`);
        void R;
      }

      // ---- a bot that plays the whole 90 seconds with real random numbers: whacks and grabs the gem; deterministic seed
      {
        const g = make();
        const { node, tick, sh, w } = g;
        let s = 12345;
        const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        sh.rng = { int: (n) => Math.floor(rnd() * n) };
        let n = 0, grabs = 0;
        const act = () => {
          if (g.pepNode.busy || g.pepNode.presses || node.squash) return null;
          for (let k = 0; k < 4; k++) {
            if (node.state[k] !== SN.UP || node.hit[k] !== 0) continue;
            return k === node.holder ? [BTN[k], true] : [BTN[k], false];
          }
          return null;
        };
        let pendingSecond = null;
        while (!sh.done && n++ < 3000) {
          if (pendingSecond) { tick(1); tick(1, pendingSecond); pendingSecond = null; continue; }   // a tap needs a released tick in between to count as a new press
          const a = act();
          if (a) { tick(1, a[0]); if (a[1]) { pendingSecond = a[0]; grabs++; } } else tick(1);
        }
        ok(sh.done, 'the long game ends');
        ok(sh.finalScore >= 101 && sh.finalScore <= 10000, `bot score ${sh.finalScore} within 101..10000`);
        ok(node.gems > 0, `the bot took ${node.gems} gems`);
        notes.push(`bot (seed 12345, whack + double-press grab): score ${sh.finalScore}, gems ${node.gems}, hits ${node.hits}, medal ${medalOfScore(sh.finalScore)}, ${grabs} grab attempts`);
        // the result variables
        const v = new Map([[200, 0], [0xd5, 0]]);
        applyResult({ get: (i) => v.get(i) ?? 0, set: (i, x) => v.set(i, x) }, sh.finalScore);
        ok(v.get(200) === sh.finalScore && v.get(0xd5) === medalOfScore(sh.finalScore), 'HISCORE_WAS / TROPHY_WAS written');
      }
      {
        // the score cap
        const g = make({ baskets: [0], gem: [0] });
        g.node.score = 9900;
        g.tick(22);
        g.tick(1, 'DOWN'); g.tick(1); g.tick(1, 'DOWN');
        for (let i = 0; i < 25; i++) g.tick(1);
        ok(g.node.score === 10000, `score capped at 10000 (${g.node.score})`);
      }
    } finally {
      unregisterCtor(CTOR_PEPWAS); unregisterCtor(CTOR_ZONEWAS);
    }
    return { checked, failures, notes };
  },
};
