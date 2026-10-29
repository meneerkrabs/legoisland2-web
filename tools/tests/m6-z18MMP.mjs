import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { createCpu } from '../../src/formats/x86emu.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { bootWorld, tickWorld, playBot, snapshotFromZone, Z18Bot, KEY } from '../lib/m6-z18MMP-bot.mjs';
import '../../src/zones/z18MMP.ts';
import { CTOR, REC, VAR, BIT, CLIP, PS, SND, SOUNDS_2D, SOUNDS_3D, MUSIC, K, RECORD_NAMES, medalOfScore } from '../../src/zones/z18mmp/consts.ts';
import { PK } from '../../src/zones/z18mmp/props.ts';
import { checkRecords, swapSymbols } from '../../src/zones/z18mmp/setup.ts';
import { scoreOf, clockText, resultLines, applyResult, MmpRun } from '../../src/zones/z18mmp/run.ts';
import { coffinOfMask } from '../../src/zones/z18mmp/pepper.ts';
import { CS } from '../../src/zones/z18mmp/coffin.ts';
import { MmpShared } from '../../src/zones/z18mmp/shared.ts';

// z18MMP "Matching Mummies" (docs/re/m6/z18MMP.md): the constants and tables of the port against the executable (the attaches of the set-up, the vtables of the nodes, the sound /
// music / message tables, the immediates and floats of the code), the coffin tables / the score / the game-over check against the ORIGINAL functions run in the x86 emulation, the
// loop's clock and score, Pepper (walking relative to the camera, the mummies' contact and the danger meter, knocking on coffins, the page, the chase, the gate), the memory game (a
// right pair, a wrong pair, three coffins), the key and the door, the collapse (boulder, pillars, stones), and complete games played by the scripted player (a win, a careless win
// after a wrong pair, no input = time up, caught by the mummies).

const hex = (n) => '0x' + (n >>> 0).toString(16);
const f32 = Math.fround;

export default {
  name: 'm6-z18MMP',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
    const eq = (a, b, msg) => ok(a === b, `${msg}: got ${a}, expected ${b}`);
    const pe = loadExe(ctx.dataRoot);
    const dvf = new DataView(new ArrayBuffer(8));
    const fl = (va) => { dvf.setUint32(0, pe.u32(va), true); return dvf.getFloat32(0, true); };
    const dbl = (va) => { dvf.setUint32(0, pe.u32(va), true); dvf.setUint32(4, pe.u32(va + 4), true); return dvf.getFloat64(0, true); };
    const arch = ctx.archives.find((a) => a.name === 'z18MMP');

    try {
      // ============================================================ the set-up: attaches, records, vtables
      {
        const L = loadZone(ctx, 'z18MMP');
        const at = L.setup.attaches;
        eq(at.length, 41, 'attaches found in the set-up (the 12 symbols are attached through a record lookup: not in the extraction)');
        const want = [[121, CTOR.WALK], [0, CTOR.CAMERA], [123, CTOR.MUMMY], [124, CTOR.MUMMY], [125, CTOR.MUMMY], [11, CTOR.KEY], [94, CTOR.PAGE], [83, CTOR.ROCK],
          ...REC.PILLAR.map((r) => [r, CTOR.PILLAR]), ...REC.STONE.map((r) => [r, CTOR.DEBRIS]), ...REC.TORCH.map((r) => [r, CTOR.TORCH]), ...REC.SPIDER.map((r) => [r, CTOR.SPIDER]), ...REC.RAT.map((r) => [r, CTOR.RAT])];
        eq(at.map((a) => `${a.record}:${hex(a.ctor)}`).join(), want.map(([r, c]) => `${r}:${hex(c)}`).join(), 'attach order (record : constructor)');
        ok(at.every((a) => a.var === 2 && a.mask === 0 && a.value === 0 || a.record === 83), 'every attach is ungated (var 2) but the boulder');
        const rock = at.find((a) => a.record === 83);
        ok(rock.var === 0xfe && rock.mask === 0x4000 && rock.value === 0x4000, `the boulder is gated by var 0xfe & 0x4000 == 0x4000: ${rock.var} ${rock.mask} ${rock.value}`);
        eq(L.skipped.length, 0, 'no attach of the set-up left unported');
        eq(L.world.records.length, 137, 'records');
        eq(checkRecords(L.world.records).join('; '), '', 'record table names');
        ok(Object.keys(RECORD_NAMES).length > 80, `name table: ${Object.keys(RECORD_NAMES).length} records named`);
        // the three set-up facts the port relies on: Pepper's start (y 11.9 from the init, z -67.122 from the builder: + 15 by FUN_006a3861), the hidden records, the barriers
        const R = L.world.records;
        ok(near(R[121].y, 11.9, 1e-3) && near(R[121].z, -67.122, 1e-3), `Pepper at the set-up: y ${R[121].y} z ${R[121].z} (the +15 is added by prepareMmp)`);
        ok(REC.HIDDEN.every((i) => (R[i].flags & 2) === 0) && REC.LURK.every((i) => (R[i].flags & 2) === 0) && REC.STONE.every((i) => (R[i].flags & 2) === 0), 'G00x / POLL / LURK / STON hidden');
        ok(REC.MUMMY_OF.every((i) => (R[i].flags & 2) === 0), 'the 12 coffin mummies hidden');
        ok(REC.COLL.every((i) => (R[i].flags & 2) !== 0), 'the two barriers shown');
        ok(near(R[REC.KEY].y, 8.202, 1e-2) && near(R[REC.DOOR].y, 4.529, 1e-2) && near(R[REC.TRAP].y, 25.58, 1e-2) && near(R[REC.GATE].y, 20.794, 1e-2) && near(R[REC.ROCK].z, 217.337, 1e-2), 'key / door / trap / gate / boulder at their builder positions');
        // the vtables: the update of each node (the port is the function at slot 0)
        const vt = { walk: [0x9276d0, 0x6a4fd0], camera: [0x927b70, 0x6ac810], mummy: [0x927ab0, 0x6aa600], key: [0x927a58, 0x6aa070], page: [0x9279f8, 0x6a9cc0], rock: [0x9279a8, 0x6a9930],
          pillar: [0x927958, 0x6a95d5], debris: [0x927908, 0x6a9280], torch: [0x9277f0, 0x6a8cf0], spider: [0x9277a0, 0x6a8a40], rat: [0x927740, 0x6a8350], coffin: [0x927b00, 0x6aadf6] };
        for (const [n, [v, upd]] of Object.entries(vt)) eq(pe.u32(v), upd, `vtable of ${n}: update`);
        eq(pe.u32(0x927b70 + 12), 0x6ac844, 'the camera works in the draw slot (FUN_006ac844)');
        // the constructors of the zone: symbol (coffin) node attached through FUN_006ac699: its constructor is FUN_006abf47, vtable 0x927b00
        const have = (va, len, imm) => { const b = pe.slice(va, len); for (let i = 0; i + 4 <= len; i++) if ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 === imm) return true; return false; };
        ok(have(0x6abf47, 0x100, 0x927b00), 'FUN_006abf47 (the symbol constructor) stores the vtable 0x927b00');
      }

      // ============================================================ the code streams: immediates and tables
      {
        const bytes = (va, n) => pe.slice(va, n);
        const dwords = (va, n) => { const b = bytes(va, n), s = new Set(); for (let i = 0; i + 4 <= n; i++) s.add((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0); return s; };
        // FUN_006a2355 (the banner): `cmp score, 0x1f40` (> 8000 = gold) and `cmp score, 0x1770` (> 6000 = silver)
        const ban = dwords(0x6a2355, 0x300);
        ok(ban.has(0x1f40) && ban.has(0x1770), 'banner compares with 0x1f40 / 0x1770');
        ok(K.GOLD === 0x1f40 + 1 && K.SILVER === 0x1770 + 1, 'K.GOLD / K.SILVER = the immediates + 1 (score > immediate)');
        const loop = dwords(0x6a26a8, 0xa00);
        ok(loop.has(0x1f40) && loop.has(0x1770), 'the loop (speech) uses the same thresholds');
        // FUN_006a2290: score = 10000 - ftol((seconds - 60) * 33.3); 0x3c = 60, 0x2710 = 10000
        const sc = dwords(0x6a2290, 0x90);
        ok(sc.has(0x2710), 'FUN_006a2290 clamps at 10000');
        ok(Math.abs(dbl(0x892790) - 33.3) < 1e-12 && K.SCORE_PER_SECOND === 33.3, 'the double 33.3 at 0x892790');
        const sb = bytes(0x6a2290, 0x30);
        ok(sb[0x20] === 0x83 && sb[0x21] === 0xe8 && sb[0x22] === 0x3c, 'sub eax, 0x3c: the base seconds are 60');
        eq(K.SCORE_BASE_SECONDS, 60, 'K.SCORE_BASE_SECONDS');
        // FUN_006a21b0: 300 seconds (mov eax, 0x12c), the countdown starts at 10 (the init stores 10 into DAT_05d5beec)
        ok(dwords(0x6a21b0, 0x60).has(0x12c), 'FUN_006a21b0: 300');
        eq(K.SECONDS, 300, 'K.SECONDS');
        ok(dwords(0x6a30c0, 0x800).has(10) && K.WARN_FROM === 10, 'the init writes the countdown start 10');
        eq(fl(0x89278c), K.DANGER_MAX, '0x89278c = 145.0 (the danger meter at which the game is lost)');
        eq(fl(0x8921a4), K.DANGER_HIT, '0x8921a4 = 24.0 (a hit adds this to the danger meter)');
        ok(near(fl(0x8920f0), K.DANGER_DECAY, 1e-6), '0x8920f0 = 0.2 (the danger decays per tick)');
        eq(fl(0x892038), K.SECOND_TICKS, '0x892038 = 30.0 ticks per second');
        eq(fl(0x892074), K.PEPPER_START_Z, '0x892074 = 15.0 (Pepper moves 15 forward)');
        // the floats of the nodes (address, value): see the comments of consts.ts / props.ts / pepper.ts
        const F = [[0x892254, 50], [0x892114, 200], [0x892468, -4], [0x892080, 4], [0x892090, 8], [0x892198, 0.64], [0x8927b8, -0.64], [0x892028, 2], [0x8927b4, 0.32], [0x892084, 0.8], [0x8924e4, 0.95],
          [0x892580, 1.6], [0x892108, 0.9], [0x892150, 0.349064], [0x89212c, 0.08], [0x8927ac, -12.5], [0x89206c, 2.8], [0x8927a8, 0.576], [0x8927a4, 0.256], [0x8927a0, 0.128], [0x89208c, 0.125],
          [0x892528, 40], [0x89279c, 35], [0x892798, 17], [0x8927b0, 8.47], [0x892118, 0.4], [0x8924d4, 3.2], [0x9276c8, -0.9], [0x892674, 4.8], [0x892690, 6.4], [0x89280c, 22.4], [0x892024, 12],
          [0x892588, 27], [0x89228c, 6], [0x892808, -28], [0x8920a8, 2.4], [0x892804, 4.4], [0x89274c, 42], [0x8926a4, 0.087266], [0x8927f4, 0.24], [0x8927f0, 14], [0x8927f8, 5.76], [0x892534, 0.0523596],
          [0x8927e4, 1.00356], [0x8927e0, -1.00356], [0x8921f4, 16], [0x8927e8, 0.85], [0x8927ec, -22], [0x892800, 0.072], [0x8927fc, 2.88], [0x89211c, 0.174532], [0x8925ec, 0.04], [0x89268c, 45],
          [0x927758, 10.24], [0x92775c, 0.2], [0x927760, 0.12], [0x927764, 0.087266], [0x89237c, 20], [0x89204c, 0.5]];
        for (const [va, v] of F) ok(near(fl(va), v, Math.abs(v) * 1e-5 + 1e-6), `float at ${hex(va)}: ${fl(va)} expected ${v}`);
        const D = [[0x8927d8, 18], [0x8927d0, 32], [0x8927c8, 173], [0x8927c0, 188]];
        for (const [va, v] of D) ok(dbl(va) === v, `double at ${hex(va)}: ${dbl(va)} expected ${v} (the bridge steps: z 18..32 and 173..188)`);
        ok(near(PK.CAM_UP, 4.8) && near(PK.CAM_Y, 8) && near(PK.CAM_BACK, 12) && near(PK.CAM_CHASE_Y, 6.4) && near(PK.CAM_CHASE_BACK, 22.4) && near(PK.SIDE, 4.4) && near(PK.MUMMY_SPEED, 0.072), 'camera / mummy constants');
        ok(near(PK.PIT_LOOK, 12.971) && near(PK.MUMMY_Y, 4.56) && near(PK.ROCK_BOUNCE, 0.24) && near(PK.STONE_SPIN, 6.2657, 1e-3), 'the hex immediates: 0x414f8937, 0x4091eb85, 0x3e75c28f, 0x40c8809a');
        ok(near(K.WALK_SPEED, 0.32) && near(K.CHASE_VZ, -0.9) && near(K.HIT_RADIUS, 2.88) && near(K.TURN_STEP, 0.349064, 1e-5) && near(K.GRAVITY, 0.08) && near(K.SWEEP_Y, 2.8), 'Pepper constants');
        // the sound loads of FUN_006a4a60: `push id / call FUN_00443580 (2D) | FUN_004433b0 (3D)`
        const code = bytes(0x6a4a60, 0x500), s2 = new Set(), s3 = new Set();
        for (let i = 0; i + 10 <= 0x500; i++) {
          if (code[i] !== 0x68 || code[i + 5] !== 0xe8) continue;
          const id = (code[i + 1] | (code[i + 2] << 8) | (code[i + 3] << 16) | (code[i + 4] << 24)) >>> 0;
          const rel = code[i + 6] | (code[i + 7] << 8) | (code[i + 8] << 16) | (code[i + 9] << 24);
          const tgt = (0x6a4a60 + i + 10 + rel) >>> 0;
          if (tgt === 0x443580) s2.add(id); else if (tgt === 0x4433b0) s3.add(id);
        }
        eq([...s2].sort((a, b) => a - b).map(hex).join(), [...SOUNDS_2D, 0x1f6].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b).map(hex).join(), '2D sounds loaded');
        const un3 = [...s3].filter((id) => !SOUNDS_3D.includes(id)).sort();
        eq(un3.map(hex).join(), '0x137,0x139', '3D sounds loaded and not played by the port (RAT_MOVE, SPIDER_WRIGGLE: no node plays them)');
        ok(SOUNDS_3D.every((id) => s3.has(id)), 'every 3D sound the port plays is loaded by the zone');
        const tab = readAudioTables(pe.data);
        const nm = (id) => tab.sounds[id]?.name;
        eq([...SND.SQUEAL, SND.MATCH_OK, SND.MATCH_FAIL, SND.KEY_APPEAR, SND.KEY_COLLECT, SND.TIME_FINISH, SND.CLOCK_TICK, SND.GET_PAGE, SND.MELD].map(nm).join(),
          'SND_PEPP_SQUEAL1,SND_PEPP_SQUEAL2,SND_PEPP_SQUEAL3,SND_MATCH_SUCEED,SND_MATCH_FAIL,SND_KEY_APPEAR,SND_KEY_COLLECT,SND_TIME_FINISH,SND_CLOCK_TICK,SND_MMP_GET_PAGE,SND_MMP_SYMBOLS_HIT', '2D sound names');
        eq([...SND.STEP_FLOOR, ...SND.STEP_BRIDGE].map(nm).join(), 'SND_MMP_FSTEP1,SND_MMP_FSTEP2,SND_MMP_FSTEP3,SND_MMP_FSTEP4,SND_MMP_BRIDGE1,SND_MMP_BRIDGE2,SND_MMP_BRIDGE3,SND_MMP_BRIDGE4', 'step sounds');
        eq([SND.RAT_SQUEAK, SND.LAUGH.ARCO, SND.LAUGH.SEXO, SND.LAUGH.CAMO, SND.LAUGH.CUPO, SND.LAUGH.TEAO, SND.LAUGH.BINO].map(nm).join(), 'SND_RAT_SQUEEK,SND_LAUGH_1,SND_LAUGH_2,SND_LAUGH_3,SND_LAUGH_4,SND_LAUGH_5,SND_LAUGH_6', 'squeak and the laughs by symbol');
        eq([SND.TORCH, SND.SPIDER_DROP, SND.KNOCK, SND.KEY_SPIN, SND.COFFIN_CLOSE, SND.COFFIN_OPEN, SND.SYMBOL_SPIN, SND.GATE_LOOP, SND.GATE_OPENED, SND.WATER, SND.PAGE_SPIN, SND.BOULDER, SND.COLUMN_FALL, ...SND.GROAN, SND.BONES].map(nm).join(),
          'SND_TORCH,SND_SPIDER_DROP,SND_PEPP_KNOCK,SND_KEY_SPIN,SND_COFFIN_CLOSE,SND_COFFIN_OPEN,SND_SYMBOL_SPIN,SND_GATE_OPEN,SND_GATE_OPENED,SND_MMP_WATER,SND_PAGE_SPIN,SND_BOULDER_ROLL,SND_COLUMN_FALL,SND_KING_BUMP,SND_EXPLORER_BUMP,SND_SOLDIER_BUMP,SND_MMP_BONES', '3D sound names');
        ok(tab.sounds[SND.TORCH].loopCount === 0 && tab.sounds[SND.WATER].loopCount === 0 && tab.sounds[SND.BOULDER].loopCount === 0, 'torch / water / boulder are loops');
        // the music keys the loop loads (FUN_00443290 with the strings at 0x927418 ..) and the four segments of the table
        const strs = ['Z18MMP', 'Z18MMPPre', 'Hotep', 'Z28HAT'];
        eq(strs.map((s) => pe.findStrings(s).length > 0).join(), 'true,true,true,true', 'music strings in the executable');
        eq(Object.values(MUSIC).join(), strs.join(), 'MUSIC keys');
        for (const k of strs) ok(tab.music.some((m) => m.key.toLowerCase() === k.toLowerCase()), `music table has ${k}`);
        // the message ids the zone code pushes (FUN_006a21b0 .. FUN_006a8000): exactly the ones of MMP.str the port uses
        const msg = new Set();
        const mc = bytes(0x6a21b0, 0x5e00);
        for (let i = 0; i + 5 <= 0x5e00; i++) {
          if (mc[i] !== 0x68) continue;
          const va = (mc[i + 1] | (mc[i + 2] << 8) | (mc[i + 3] << 16) | (mc[i + 4] << 24)) >>> 0;
          if (va < 0x900000 || va > 0x940000) continue;
          const s = pe.cstr(va, 12);
          if (/^ADSGMM\d\d$/.test(s)) msg.add(s);
        }
        const strFile = arch ? null : null; void strFile;
        const mm = ctx.archives.find((a) => a.name === 'messages');
        const e = mm.entries.find((x) => /MMP\.str/i.test(x.path));
        const text = new TextDecoder('latin1').decode(mm.read(e));
        const ids = new Set([...text.matchAll(/^(\w+):/gm)].map((m) => m[1]));
        for (const id of ['ADSGMM02', 'ADSGMM06', 'ADSGMM07', 'ADSGMM08', 'ADSGMM09', 'ADSGMM10', 'ADSGMM11', 'ADSGMM12', 'ADSGMM13', 'ADSGMM14', 'ADSGMM18', 'CONTROL0', 'CONTROL1', 'CONTROL2', 'CONTROL3', 'CONTROL4']) ok(ids.has(id), `MMP.str has ${id}`);
        eq([...msg].sort().join(), 'ADSGMM02,ADSGMM06,ADSGMM07,ADSGMM08,ADSGMM09,ADSGMM10,ADSGMM11,ADSGMM12,ADSGMM13,ADSGMM14,ADSGMM18', 'message ids pushed by the zone code');
        for (const s of ['SGGOLD', 'SGSILVER', 'SGBRONZE']) ok(pe.findStrings(s).length > 0, `string ${s}`);
        eq(pe.cstr(0x927390, 8), '%5d', 'the score is drawn with %5d');
        eq(pe.cstr(0x9276c0, 8), '%d:%02d', 'the clock is drawn with %d:%02d');
        // game variables
        const vname = (i) => pe.cstr(pe.u32(0x8a3228 + i * 4), 64);
        eq(vname(VAR.HISCORE), 'SWITCH_GME_HISCORE_MMP', 'var 0x14');
        eq(vname(VAR.TROPHY), 'SWITCH_GME_TROPHY_MMP', 'var 0x48');
        notes.push(`sounds loaded and never played: ${[...s3].filter((id) => !SOUNDS_3D.includes(id)).map(hex)} (SND_RAT_MOVE / SND_SPIDER_WRIGGLE)`);
      }

      // ============================================================ the coffin tables, the score and the game-over check: the ORIGINAL functions in the x86 emulation
      {
        const cpu = createCpu(pe);
        const B = 0x30000000;
        cpu.mem.addRegion({ lo: B, hi: B + 0x68 * 140, name: 'records' });
        cpu.mem.w32(0x983804, B);
        const idx = (ptr) => (ptr === 0 ? -1 : (ptr - B) / 0x68);
        for (let n = 0; n < 12; n++) {
          const bit = cpu.call(0x6ac310, [n]);
          eq(bit, 1 << n, `FUN_006ac310(${n})`);
          eq(idx(cpu.call(0x6ac3bb, [bit])), REC.COFFIN[n], `coffin record of ${n} (FUN_006ac3bb)`);
          eq(idx(cpu.call(0x6ac52a, [bit])), REC.CASE[n], `case record of ${n} (FUN_006ac52a)`);
          eq(idx(cpu.call(0x6ac699, [bit])), REC.SYMBOL[n], `symbol record of ${n} (FUN_006ac699)`);
          eq(coffinOfMask(bit), n, `coffinOfMask(${bit})`);
        }
        for (const bad of [0, 3, 5, 0x1000, 0x1001, 0x4000, 0xfff]) { eq(cpu.call(0x6ac699, [bad]), 0, `FUN_006ac699(${hex(bad)}) = 0`); eq(coffinOfMask(bad), -1, `coffinOfMask(${hex(bad)}) = -1`); }
        // the mummy table of FUN_006aabf1 (the init of the 12 mummy slots): [record ptr, state, state] per coffin
        cpu.call(0x6aabf1, []);
        for (let n = 0; n < 12; n++) eq(idx(cpu.mem.u32(0x5d5c010 + n * 8)), REC.MUMMY_OF[n], `mummy table entry ${n}`);
        // FUN_006a2290: the score from the seconds and the win bit (var 0xfc & 0x4000)
        const vars = new Map();
        cpu.hooks.set(0x417575, (c) => { c.eax = vars.get(c.arg(0)) ?? 0; });
        cpu.invalidate();
        for (const won of [false, true]) {
          vars.set(0xfc, won ? 0x4000 : 0);
          for (const sec of [0, 1, 30, 59, 60, 61, 90, 120, 121, 150, 179, 180, 181, 240, 299, 300, 301, 1000]) {
            cpu.mem.w32(0x5d5beb0, sec);
            const got = cpu.call(0x6a2290, []) | 0;
            eq(got, scoreOf(sec, won), `score(seconds ${sec}, ${won ? 'won' : 'lost'}) = the original FUN_006a2290`);
          }
        }
        notes.push('score: fewer than 60 seconds give 0 in the original (the 64 bit load of a negative int): ported');
        // FUN_006a21b0: the game-over check, with the sound calls logged
        const log = [];
        cpu.hooks.set(0x4435a0, (c) => { log.push(['play', c.arg(0)]); });
        cpu.hooks.set(0x4435b0, (c) => { log.push(['stop', c.arg(0)]); });
        cpu.mem.w32(0x5d5bfa8, 0xaaa1); cpu.mem.w32(0x5d5bf04, 0xaaa2);
        cpu.invalidate();
        const dvv = new DataView(new ArrayBuffer(4));
        const setF = (a, v) => { dvv.setFloat32(0, v, true); cpu.mem.w32(a, dvv.getUint32(0, true)); };
        const cases = [];
        for (const sec of [0, 100, 289, 290, 291, 295, 299, 300, 301]) for (const danger of [-0.2, 0, 144.9, 145, 160]) for (const warn of [10, 9, 5, 1, 0]) for (const win of [0, 0x4000]) cases.push([sec, danger, warn, win]);
        for (const [sec, danger, warn, win] of cases) {
          cpu.mem.w32(0x5d5beb0, sec); cpu.mem.w32(0x5d5beec, warn); setF(0x5d5bef0, danger); vars.set(0xfc, win);
          log.length = 0;
          const got = cpu.call(0x6a21b0, []) & 0xff;
          const warnAfter = cpu.mem.u32(0x5d5beec) | 0;
          const sh = new MmpShared();
          sh.seconds = sec; sh.danger = danger; sh.warnNext = warn;
          const mine = [];
          sh.sounds = { play2D: (id) => mine.push(['play', id === SND.CLOCK_TICK ? 0xaaa1 : id === SND.TIME_FINISH ? 0xaaa2 : id]), stop2D: (id) => mine.push(['stop', id === SND.CLOCK_TICK ? 0xaaa1 : id]), play3D() {}, stop3D() {}, idle3D: () => true, music() {}, say() {} };
          const run = new MmpRun(sh);
          const over = run.afterTick({ get: (i) => vars.get(i) ?? 0 });
          const tag = `sec ${sec} danger ${danger} warn ${warn} win ${win}`;
          eq(over ? 1 : 0, got, `game over (${tag})`);
          eq(JSON.stringify(mine), JSON.stringify(log), `sounds (${tag})`);
          eq(sh.warnNext, warnAfter, `countdown (${tag})`);
        }
        // FUN_006a4f60: the clock text (sprintf "%d:%02d" of 300 - seconds) and the danger copied to the HUD state
        cpu.hooks.set(0x46055f, () => {});
        cpu.invalidate();
        for (const sec of [0, 1, 59, 60, 61, 119, 120, 299, 300]) {
          cpu.mem.w32(0x5d5beb0, sec); setF(0x5d5bef0, 12.5);
          cpu.call(0x6a4f60, []);
          eq(cpu.mem.cstr(0x5d4dd60), clockText(sec), `clock text for ${sec} seconds`);
        }
        ok(cpu.mem.f32(0x5d4e138) === 12.5, 'FUN_006a4f60 copies the danger meter to the gauge value');
      }

      // ============================================================ pure helpers: score, medal, banner lines, the variables
      {
        eq(scoreOf(60, true), 10000, 'score at 60 s'); eq(scoreOf(120, true), 8003, 'score at 120 s (60 * 33.3 = 1997.99.. in double: 1997)'); eq(scoreOf(121, true), 7969, 'score at 121 s'); eq(scoreOf(180, true), 6005, 'score at 180 s');
        eq(scoreOf(181, true), 5971, 'score at 181 s'); eq(scoreOf(300, true), 2009, 'score at 300 s'); eq(scoreOf(59, true), 0, 'fewer than 60 seconds: 0 (the unsigned load)'); eq(scoreOf(0, true), 0, 'score at 0 s');
        eq(scoreOf(200, false), 0, 'lost: 0');
        const med = (won, s) => medalOfScore(won, s);
        eq(med(true, 8003), 3, 'gold'); eq(med(true, 8001), 3, 'gold at 8001'); eq(med(true, 8000), 2, 'silver at 8000'); eq(med(true, 6001), 2, 'silver at 6001'); eq(med(true, 6000), 1, 'bronze at 6000'); eq(med(false, 9000), 0, 'lost: no medal');
        eq(clockText(0), '5:00', 'clock at the start'); eq(clockText(1), '4:59', '4:59'); eq(clockText(241), '0:59', '0:59'); eq(clockText(300), '0:00', '0:00');
        const rl = (w, s) => JSON.stringify(resultLines(w, s));
        eq(rl(false, 0), JSON.stringify({ lines: [['ADSGMM11', 100], ['ADSGMM12', 350]], medal: 0 }), 'lost banner');
        eq(rl(true, 9000), JSON.stringify({ lines: [['ADSGMM06', 150], ['ADSGMM07', 250]], medal: 3 }), 'gold banner');
        eq(rl(true, 7000), JSON.stringify({ lines: [['ADSGMM08', 150], ['ADSGMM09', 350]], medal: 2 }), 'silver banner');
        eq(rl(true, 3000), JSON.stringify({ lines: [['ADSGMM10', 150]], medal: 1 }), 'bronze banner');
        const v = new Map([[VAR.HISCORE, 5000], [VAR.TROPHY, 3]]);
        const vars = { get: (i) => v.get(i) ?? 0, set: (i, x) => v.set(i, x) };
        applyResult(vars, true, 4000); ok(v.get(VAR.HISCORE) === 5000 && v.get(VAR.TROPHY) === 3, 'a worse run changes nothing');
        applyResult(vars, false, 0); ok(v.get(VAR.HISCORE) === 5000 && v.get(VAR.TROPHY) === 3, 'a lost run changes nothing');
        applyResult(vars, true, 7000); ok(v.get(VAR.HISCORE) === 7000 && v.get(VAR.TROPHY) === 2, 'a better run sets the high score and ITS medal (the trophy can go down: the original writes it, not max)');
        applyResult(vars, true, 9000); ok(v.get(VAR.HISCORE) === 9000 && v.get(VAR.TROPHY) === 3, 'gold');
        // the clock: a second takes 31 ticks the first time (the fraction must pass 30), then 30
        const sh = new MmpShared(), run = new MmpRun(sh);
        const at = [];
        for (let t = 1; t <= 125; t++) { const s0 = sh.seconds; run.beforeTick(); if (sh.seconds !== s0) at.push(t); }
        eq(at.join(), '31,61,91,121', 'the clock ticks at 31, 61, 91, 121 ticks');
        sh.stopClock = true; const s1 = sh.seconds; for (let t = 0; t < 100; t++) run.beforeTick(); eq(sh.seconds, s1, 'the clock stands still when stopped');
        // the danger meter decays 0.2 per tick while >= 0 and can end at -0.2
        sh.danger = 24; for (let t = 0; t < 120; t++) run.beforeTick(); ok(Math.abs(sh.danger) < 1e-3 || near(sh.danger, 0.2, 0.01), `danger 24 decays to 0 in 120 ticks: ${sh.danger}`);
        for (let t = 0; t < 3; t++) run.beforeTick(); const dd = sh.danger; ok(dd < 0 && dd > -0.25, `ends just below 0 (the test is >= 0 before subtracting): ${dd}`);
        run.beforeTick(); eq(sh.danger, dd, 'and no further');
        sh.danger = 130; sh.hit(); eq(sh.danger, 145, 'a hit is capped at 145');
      }

      // ============================================================ worlds: helpers
      const rec = () => {
        const log = [];
        return { log, sounds: {
          play2D: (id) => log.push(['2d', id]), stop2D: (id) => log.push(['stop2d', id]), play3D: (h, id) => log.push(['3d', id, h]), stop3D: (h) => log.push(['stop3d', h]),
          idle3D: () => true, music: (k) => log.push(['music', k]), say: (a, b) => log.push(['say', a, b ?? null]) } };
      };
      const mk = (seed = 1, o = {}) => {
        const G = bootWorld(ctx, seed);
        const r = rec(); G.sh.sounds = r.sounds; G.log = r.log;
        if (o.noGuards) for (const i of REC.GUARD) { G.rs[i].ctrl.nodes = []; G.rs[i].y = 800; G.rs[i].z = -8000; }
        G.p = G.rs[REC.PEPPER];
        G.tick = (n = 1, keys = []) => { let over = false; for (let i = 0; i < n; i++) over = tickWorld(G, keys) || over; return over; };
        G.vars = G.w.vars;
        G.put = (x, y, z, ry) => { G.p.x = x; G.p.y = y; G.p.z = z; if (ry !== undefined) G.p.ry = ry; G.p.rebuildYaw(); G.p.savePrev(); };
        G.ev = (kind, id) => G.log.filter((e) => e[0] === kind && (id === undefined || e[1] === id));
        return G;
      };
      const sym = (G, n) => G.rs[REC.SYMBOL[n]], cas = (G, n) => G.rs[REC.CASE[n]];
      /** put Pepper next to coffin n (within reach of its symbol, in front of its case) */
      const beside = (G, n, d = 2.3) => { const s = sym(G, n), c = cas(G, n); G.put(s.x + c.m[8] * d, 4.5, s.z + c.m[10] * d, Math.atan2(-c.m[8], -c.m[10])); };
      const pairOf = (G, n) => { for (let m = 0; m < 12; m++) if (m !== n && sym(G, m).name === sym(G, n).name) return m; return -1; };
      const wrongOf = (G, n) => { for (let m = 0; m < 12; m++) if (m !== n && sym(G, m).name !== sym(G, n).name) return m; return -1; };
      const knock = (G, n) => { beside(G, n); G.tick(2); const before = G.p.x; void before; G.tick(1, [KEY.SHIFT]); };

      // ---- the start state
      {
        const G = mk(1);
        const { p, w } = G;
        ok(near(p.x, 0) && near(p.y, 11.9, 0.2) && near(p.z, -52.122, 1e-2), `Pepper starts at (0, 11.9, -52.122): ${p.x} ${p.y} ${p.z}`);
        ok(p.anim.clip === CLIP.IDLE && p.anim.frame === 0, 'idle clip 0x3a');
        ok(p.ctrl.nodes.length === 1 && p.ctrl.nodes[0].kind === 'mmpWalk', 'Pepper runs only the Walk node');
        const c = w.camera.c;
        ok(near(c[0], 0) && near(c[1], p.y + 8, 1e-3) && near(c[2], p.z - 12, 1e-3) && near(c[3], 0) && near(c[4], p.y + 4.8, 1e-3) && near(c[5], p.z, 1e-3), `camera behind and above Pepper: ${[...c].slice(0, 6).map((v) => v.toFixed(2))}`);
        eq(G.sh.danger, 0, 'danger 0'); eq(G.sh.seconds, 0, 'seconds 0');
        ok(w.col.groundRec === G.rs[0], 'the ground record is the tomb mesh (FUN_004425e0)');
        for (const v of [0xfb, 0xfc, 0xfd, 0xfe, 0xff]) eq(G.vars.get(v), 0, `var ${hex(v)} cleared by the init`);
        ok(REC.COFFIN.every((i) => G.rs[i].ctrl === null) && REC.SYMBOL.every((i) => G.rs[i].ctrl.nodes[0].kind === 'mmpCoffin'), 'the 12 symbols carry the coffin node');
        ok(REC.MUMMY_OF.every((i) => G.rs[i].anim.clip === CLIP.M_SLEEP && (G.rs[i].flags & 2) === 0), 'coffin mummies sleep (clip 0x59, hidden)');
        ok(REC.GUARD.every((i) => G.rs[i].anim.clip === CLIP.M_STAND && near(G.rs[i].y, 4.56, 1e-3)), 'the roaming mummies stand (clip 0x5a, y 4.56)');
        const homes = REC.GUARD.map((i, k) => [G.rs[i].x, G.rs[i].z].map((v) => v.toFixed(2)).join()), want = REC.GUARD_HOME.map((i) => [G.rs[i].x, G.rs[i].z].map((v) => v.toFixed(2)).join());
        eq(homes.join(';'), want.join(';'), 'roaming mummies start at the LURK records (81, 82, 80)');
        ok(near(G.rs[REC.KEY].y, 8.202 + 5.76, 1e-2), 'the key hangs 5.76 above its place');
        ok(G.rs[REC.SPIDER[0]].anim.clip === 2 && G.rs[REC.RAT[0]].anim.clip === 4, 'spiders start clip 2, rats clip 4');
        // the symbols: two of each type, the 50 swaps left every record in its place
        const names = REC.SYMBOL.map((i) => G.rs[i].name).sort();
        eq(names.join(), 'ARCO,ARCO,BINO,BINO,CAMO,CAMO,CUPO,CUPO,SEXO,SEXO,TEAO,TEAO', 'two symbols of each type');
        for (const i of REC.SYMBOL) ok(near(G.rs[i].y, 9.69, 0.02), 'symbol height 9.69');
        // different seeds give different arrangements, the same seed the same
        const arr = (s) => REC.SYMBOL.map((i) => mk(s).rs[i].name).join();
        void arr;
        const a1 = REC.SYMBOL.map((i) => mk(1).rs[i].name).join(), a2 = REC.SYMBOL.map((i) => mk(2).rs[i].name).join(), a1b = REC.SYMBOL.map((i) => mk(1).rs[i].name).join();
        ok(a1 === a1b && a1 !== a2, 'the arrangement follows the random numbers');
      }
      {
        // swapSymbols exchanges everything but the place
        const G = mk(3);
        const a = sym(G, 0), b = sym(G, 1);
        const na = a.name, nb = b.name, ma = a.model, mb = b.model, ax = a.x, bx = b.x, ca = a.colObj, cb = b.colObj;
        swapSymbols(a, b);
        ok(a.name === nb && b.name === na && a.model === mb && b.model === ma && a.colObj === cb && b.colObj === ca && a.x === ax && b.x === bx, 'swap: names, models, collision objects exchanged, positions kept');
      }

      // ---- walking: speed 0.32 per tick, relative to the camera, clips by speed, the walls
      {
        const G = mk(1, { noGuards: true });
        const { p, w } = G;
        G.tick(30, [KEY.U]);
        ok(near(p.z, -52.122 + 9.6, 0.25) && near(p.x, 0, 1e-3), `30 ticks UP: z ${p.z.toFixed(3)} (+9.6)`);
        eq(p.anim.clip, CLIP.WALK, 'walk clip 0x0d at 0.32 per tick'); eq(G.nodes.pepper.cur, 2, 'category 2');
        G.tick(4, []);
        eq(G.nodes.pepper.cur, 0, 'idle category after the keys are released'); eq(p.anim.clip, CLIP.IDLE, 'idle clip (after the 2 tick hold)');
        const z0 = p.z; G.tick(10, [KEY.D]);
        ok(p.z < z0 - 2.5, 'DOWN walks backwards (-z)');
        // left / right follow the camera's right vector (x at the start)
        G.put(0, 9.3, 0, 0); G.tick(3); const x0 = p.x; G.tick(10, [KEY.R]); ok(p.x > x0 + 2.5, 'RIGHT: +x'); G.tick(30, [KEY.L]); ok(p.x < x0 - 2, 'LEFT: -x');
        // a diagonal is faster (the two unit vectors add): speed 0.45 -> still the walk category
        G.put(0, 9.3, 0, 0); G.tick(3); const q = [p.x, p.z]; G.tick(10, [KEY.U, KEY.R]); ok(Math.hypot(p.x - q[0], p.z - q[1]) > 4.2, `diagonal faster: ${Math.hypot(p.x - q[0], p.z - q[1]).toFixed(2)}`);
        // the camera pans with Pepper's x (look at x -/+ 4.4) so the controls turn at the sides: the basis is read from the camera
        G.put(15, 5, 62, 0); G.tick(2); const c = w.camera.c; ok(Math.abs(c[9]) < 0.95 && c[11] < -0.2, `camera right at x = 15: (${c[9].toFixed(2)}, ${c[11].toFixed(2)})`);
        // walls: walking straight into the left wall of the entrance corridor stops
        G.put(0, 9, 0, 0); G.tick(3); G.tick(60, [KEY.L]); ok(p.x > -6 && p.x < -3, `stopped by the corridor wall: x ${p.x.toFixed(2)}`);
      }
      // ---- footsteps: floor steps, bridge steps on z 18..32 / 173..188 round robin
      {
        const G = mk(1, { noGuards: true });
        G.put(0, 9, 5, 0); G.tick(70, [KEY.U]);
        const floor = G.ev('2d').filter((e) => SND.STEP_FLOOR.includes(e[1])).length, bridge = G.ev('2d').filter((e) => SND.STEP_BRIDGE.includes(e[1])).length;
        ok(floor >= 3 && bridge === 0 || p3(G) > 0, `floor steps before the bridge: ${floor}`);
        function p3(g) { return g.p.z; }
        G.log.length = 0; G.put(0, 9, 14, 0); G.tick(50, [KEY.U]);
        const steps = G.log.filter((e) => e[0] === '2d' && (SND.STEP_FLOOR.includes(e[1]) || SND.STEP_BRIDGE.includes(e[1])));
        ok(steps.some((e) => SND.STEP_BRIDGE.includes(e[1])), 'wooden steps on the bridge (z 18..32)');
        const ids = steps.map((e) => e[1]);
        let rr = true; for (let i = 1; i < ids.length; i++) { const a = [...SND.STEP_FLOOR, ...SND.STEP_BRIDGE]; if ((a.indexOf(ids[i]) % 4) !== ((a.indexOf(ids[i - 1]) % 4) + 1) % 4) rr = false; }
        ok(rr, 'the four step variants round robin');
      }

      // ---- the roaming mummies: wander near home, chase when Pepper comes within 8 of the home
      {
        const G = mk(1);
        const g = G.rs[REC.GUARD[0]], home = [g.x, g.z];
        G.put(0, 5, 20, 0);
        G.tick(300);
        ok(Math.hypot(g.x - home[0], g.z - home[1]) < 8, `a roaming mummy stays around its home: ${Math.hypot(g.x - home[0], g.z - home[1]).toFixed(1)}`);
        const nodeG = G.nodes.guards[0];
        ok(near(nodeG.home[0], home[0], 1e-6), 'home kept');
        // chase: Pepper 6 from the home -> the mummy walks towards him at 0.072 per tick
        G.put(home[0] - 6, 4.5, home[1], 0); G.p.flags |= 0; const d0 = Math.hypot(g.x - G.p.x, g.z - G.p.z);
        const dists = []; for (let i = 0; i < 20; i++) { G.put(home[0] - 6, 4.5, home[1], 0); G.tick(1); G.put(home[0] - 6, 4.5, home[1], 0); dists.push(Math.hypot(g.x - G.p.x, g.z - G.p.z)); }
        ok(dists[19] < d0 - 0.5, `the mummy closes in: ${d0.toFixed(2)} -> ${dists[19].toFixed(2)}`);
        const step = Math.abs(dists[10] - dists[9]); ok(near(step, 0.072, 0.03), `at about 0.072 per tick: ${step.toFixed(3)}`);
      }
      // ---- contact: 3D distance < 2.88: danger +24, the hit clip, the knock-back, no second hit during the clip, decay 0.2 per tick
      {
        const G = mk(1);
        const g = G.rs[REC.GUARD[1]];
        G.put(g.x + 2.0, g.y, g.z, 0); G.p.savePrev();
        G.tick(1);
        eq(G.sh.danger > 23.5 && G.sh.danger <= 24 ? 24 : G.sh.danger, 24, `the first contact adds 24: ${G.sh.danger}`);
        eq(G.nodes.pepper.state, PS.HIT, 'hit state'); eq(G.p.anim.clip, CLIP.HIT, 'hit clip 0x50');
        ok(G.ev('2d').some((e) => SND.SQUEAL.includes(e[1])), 'Pepper squeals (one of three)');
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.GROAN[1]), 'the mummy groans (guard 2: SND_EXPLORER_BUMP)');
        // the knock-back pushes Pepper away from the mummy
        const x1 = G.p.x; G.tick(5); ok(Math.abs(G.p.x - g.x) > Math.abs(x1 - g.x) - 0.01, 'moves');
        let d = 0; const hits0 = G.sh.danger;
        for (let i = 0; i < 40; i++) { G.tick(1); }
        ok(G.sh.danger < hits0 || G.nodes.pepper.state !== PS.HIT, 'the hit state ends and the meter decays');
        // the state lasts the clip: 29 frames at 2.5 = 12 ticks
        const G2 = mk(1);
        const g2 = G2.rs[REC.GUARD[1]];
        G2.put(g2.x + 2.0, g2.y, g2.z, 0);
        G2.tick(1); let n = 0; while (G2.nodes.pepper.state === PS.HIT && n < 40) { G2.tick(1); n++; }
        ok(n >= 10 && n <= 13, `the hit clip lasts about 12 ticks: ${n}`);
        void d;
      }
      // ---- danger 145 = caught = lost
      {
        const G = mk(1);
        const g = G.rs[REC.GUARD[0]];
        let over = false, t = 0;
        while (!over && t < 3000) {
          // stand next to the mummy again and again
          if (G.nodes.pepper.state !== PS.HIT) G.put(g.x + 1.5, g.y, g.z, 0);
          over = G.tick(1); t++;
        }
        ok(over && G.run.result === 2 && G.run.reason === 'caught', `caught after ${t} ticks: ${G.run.reason}`);
        ok(G.sh.danger >= 145, `danger ${G.sh.danger}`);
        ok(G.ev('2d', SND.TIME_FINISH).length >= 1, 'the finish sound plays');
        eq(G.run.score(G.vars), 0, 'caught: score 0');
        const bl = resultLines(false, 0); eq(bl.medal, 0, 'no medal');
      }

      // ---- the memory game
      const until = (G, cond, max = 600) => { let t = 0; while (!cond() && t < max) { G.tick(1); t++; } return t; };
      /** knock on coffin q and wait until Pepper is free again (Pepper walks to the lid, knocks, steps back) */
      const open = (G, q) => { beside(G, q); G.tick(2); G.tick(1, [KEY.SHIFT]); return until(G, () => G.nodes.pepper.state === PS.FREE && G.nodes.coffins[q].state !== CS.IDLE, 400); };
      {
        const G = mk(4, { noGuards: true });
        const n = 5, m = pairOf(G, n), name = sym(G, n).name;
        // knock on coffin n: Pepper walks to the lid, knocks (clip 0x4d: 45 frames at 1.5 = 30 ticks), the coffin opens
        beside(G, n);
        G.tick(2);
        eq(G.vars.get(VAR.NEAR) & 0xfff, 1 << n, 'next to the coffin its bit is in NEAR');
        G.tick(1, [KEY.SHIFT]);
        eq(G.nodes.pepper.state, PS.TO_COFFIN, 'Shift: walk to the lid');
        let t = until(G, () => G.nodes.pepper.state !== PS.TO_COFFIN, 100);
        eq(G.nodes.pepper.state, PS.KNOCK, 'then knock'); eq(G.p.anim.clip, CLIP.KNOCK, 'knock clip 0x4d');
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.KNOCK), 'the knock sound');
        const k = until(G, () => G.nodes.pepper.state !== PS.KNOCK, 100);
        ok(k >= 29 && k <= 31, `the knock lasts 30 ticks (45 frames at 1.5): ${k}`);
        ok((G.vars.get(VAR.OPEN) & (1 << n)) !== 0, 'the coffin is flagged OPEN after the knock');
        eq(G.nodes.pepper.state, PS.BACK_OFF, 'Pepper steps back');
        const cn = G.nodes.coffins[n];
        G.tick(1);
        eq(cn.state, CS.OPENING, 'the symbol opens (the tick after the flag)'); eq(G.vars.get(VAR.PENDING) & 0xfff, 1 << n, 'the first of a pair is pending');
        eq(cn.partner, 0, 'no partner yet');
        ok((G.rs[REC.MUMMY_OF[n]].flags & 2) !== 0 && G.sh.track[n] === 1, 'the coffin\'s mummy appears (track 1)');
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.COFFIN_OPEN), 'the lid sound');
        const y0 = sym(G, n).y, ry0 = G.rs[REC.COFFIN[n]].ry;
        G.tick(11); eq(cn.state, CS.OPENING, 'still opening after 11 more ticks');
        G.tick(1);
        eq(cn.state, CS.OPEN, 'open after 12 ticks'); ok(near(sym(G, n).y, y0 + 3.84, 0.01), `symbol rose 12 * 0.32: ${sym(G, n).y - y0}`);
        ok(near(G.rs[REC.COFFIN[n]].ry, ry0 - 12 * 0.174532, 0.01), 'lid turned 12 * 10 degrees');
        ok((G.vars.get(VAR.READY) & (1 << n)) !== 0, 'READY bit set');
        ok(!G.log.some((e) => e[0] === 'music' && e[1] === MUSIC.PUZZLE), 'the puzzle music only when armed');
        // the partner: Pepper opens it (a second knock)
        until(G, () => G.nodes.pepper.state === PS.FREE);
        open(G, m);
        const cm = G.nodes.coffins[m];
        ok(cm.partner === (1 << n), `the second knows its partner: ${cm.partner}`);
        until(G, () => (G.vars.get(VAR.MATCHED) & ((1 << n) | (1 << m))) !== 0, 200);
        ok((G.vars.get(VAR.MATCHED) & ((1 << n) | (1 << m))) === ((1 << n) | (1 << m)), `the pair ${name} matched: MATCHED ${hex(G.vars.get(VAR.MATCHED))}`);
        ok(G.ev('2d', SND.MATCH_OK).length >= 1, 'the success jingle');
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.LAUGH[name]), `the laugh of ${name}`);
        eq(G.vars.get(VAR.PENDING) & 0xfff, 0, 'nothing pending');
        // the symbols float to the key's place and the mummies vanish in smoke
        until(G, () => (G.vars.get(VAR.PENDING) & 0x1000) !== 0, 600);
        const key = G.rs[REC.KEY];
        for (const q of [n, m]) ok(Math.hypot(sym(G, q).x - key.x, sym(G, q).z - key.z) < 0.9, `symbol ${q} arrived at the key's place`);
        ok(G.ev('2d', SND.MELD).length === 1, 'the meld sound once');
        ok((G.vars.get(VAR.PENDING) & 0x1000) !== 0, 'PENDING 0x1000 set');
        G.tick(60);
        ok(G.nodes.coffins.every((c) => c.state === CS.IDLE), 'all coffins idle again');
        ok((G.rs[REC.MUMMY_OF[n]].flags & 2) === 0 && (G.rs[REC.MUMMY_OF[m]].flags & 2) === 0, 'both mummies gone');
        ok(G.sh.track[n] === 6 && G.sh.track[m] === 6, `the smoke timer ended (track 6): ${G.sh.track[n]} ${G.sh.track[m]}`);
        // a matched coffin cannot be knocked again
        beside(G, n); G.tick(2); G.tick(1, [KEY.SHIFT]); ok(G.nodes.pepper.state === PS.FREE, 'a matched coffin ignores the knock');
        // the music: armed only when play starts
        const G2 = mk(4, { noGuards: true });
        G2.sh.puzzleMusicArmed = true;
        open(G2, 2); G2.tick(80);
        eq(G2.log.filter((e) => e[0] === 'music' && e[1] === MUSIC.PUZZLE).length, 1, 'the puzzle music starts with the first coffin that opens, once');
      }
      {
        // a wrong pair: both close again after 20 ticks (sound, mummy goes back), nothing matched
        const G = mk(4, { noGuards: true });
        const n = 3, m = wrongOf(G, n);
        open(G, n); open(G, m);
        const cm = G.nodes.coffins[m], cn = G.nodes.coffins[n];
        until(G, () => cm.state === CS.WRONG, 100);
        ok(cm.partner === (1 << n), 'the second coffin knows the first');
        ok(G.ev('2d', SND.MATCH_FAIL).length === 1, 'the failure sound');
        eq(G.vars.get(VAR.MATCHED) & 0xfff, 0, 'nothing matched');
        eq(G.vars.get(VAR.READY) & 0xfff, 0, 'the READY bits of the pair are cleared');
        G.tick(1); eq(cn.state, CS.WRONG, 'the first follows one tick later');
        let w = 1; while (cm.state === CS.WRONG && w < 40) { G.tick(1); w++; }
        eq(w, 20, 'the wait is 20 ticks'); eq(cm.state, CS.CLOSING, 'closing');
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.COFFIN_CLOSE), 'the lid closes with its sound');
        eq(G.sh.track[m], 3, 'the mummy goes back (track 3)'); eq(G.rs[REC.MUMMY_OF[m]].anim.clip, CLIP.M_OUT, 'clip 0x58');
        const yTop = sym(G, m).y;
        let c = 0; while (cm.state === CS.CLOSING && c < 40) { G.tick(1); c++; }
        eq(c, 12, 'closing takes 12 ticks'); eq(cm.state, CS.IDLE, 'closed'); ok(near(sym(G, m).y, 9.688, 1e-3), `symbol back at 9.688: ${sym(G, m).y}`); ok(yTop > 12, 'it had risen');
        until(G, () => cn.state === CS.IDLE, 20);
        eq(G.vars.get(VAR.OPEN) & 0xfff, 0, 'OPEN cleared');
        G.tick(300);
        ok(G.nodes.coffins.every((x) => x.state === CS.IDLE) && G.sh.track.every((x) => x === 0), `mummies back to sleep: ${G.sh.track}`);
        ok(REC.MUMMY_OF.every((i) => (G.rs[i].flags & 2) === 0), 'all coffin mummies hidden again');
        open(G, n); ok(G.nodes.coffins[n].state !== CS.IDLE, 'knock again after a wrong pair');
      }
      {
        // three coffins: the third opened after a pair is the first of the next pair (PENDING)
        const G = mk(5, { noGuards: true });
        const a = 4, b = 5, c = 8;
        open(G, a); eq(G.vars.get(VAR.PENDING) & 0xfff, 1 << a, 'a pending');
        open(G, b); until(G, () => G.nodes.coffins[b].state === CS.OPEN, 60); eq(G.vars.get(VAR.PENDING) & 0xfff, 0, 'b was the second: nothing pending');
        G.tick(60);
        open(G, c); G.tick(1);
        eq(G.vars.get(VAR.PENDING) & 0xfff, 1 << c, 'c is the first of the next pair');
      }

      // ---- the key and the door
      {
        const G = mk(2, { noGuards: true });
        // all pairs matched by the variables (the memory game is tested above): the key is released and comes down
        G.vars.set(VAR.MATCHED, 0xfff); G.vars.set(VAR.OPEN, 0);
        const key = G.rs[REC.KEY], door = G.rs[REC.DOOR];
        G.tick(1);
        ok((G.vars.get(VAR.OPEN) & BIT.KEY) !== 0, 'the key is released (OPEN 0x1000)');
        ok(G.ev('2d', SND.KEY_APPEAR).length === 1, 'key appear sound');
        const y0 = key.y; G.tick(10); ok(near(y0 - key.y, 10 * 0.24, 0.05), `the key falls 0.24 per tick: ${y0 - key.y}`);
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.KEY_SPIN), 'the key spins with its loop');
        const t0 = G.ticks; while ((G.vars.get(VAR.READY) & BIT.KEY) === 0 && G.ticks - t0 < 100) G.tick(1);
        ok(near(key.y, 8.202, 0.3), `landed at its place: ${key.y}`); ok(G.ticks - t0 > 15 && G.ticks - t0 < 25, `about (13.96 - 8.2) / 0.24 = 24 ticks in all: ${G.ticks - t0}`);
        // Pepper takes it within squared distance 1.6 (xz)
        G.put(0, 4.5, key.z - 1.2, 0); G.tick(2);
        ok((G.vars.get(VAR.MATCHED) & BIT.KEY) !== 0 && (key.flags & 2) === 0, 'taken: MATCHED 0x1000, hidden');
        eq(G.vars.get(VAR.OPEN) & BIT.KEY, 0, 'OPEN 0x1000 cleared');
        ok(G.ev('2d', SND.KEY_COLLECT).length === 1 && G.log.some((e) => e[0] === 'music' && e[1] === MUSIC.HOTEP), 'collect sound, Hotep');
        const d0 = door.y; G.tick(10); ok(near(door.y - d0, 0.8, 0.1), `the door rises 0.08 per tick: ${door.y - d0}`);
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.GATE_LOOP), 'gate loop');
        G.tick(130); ok(door.y >= 14 && door.y < 14.1, `open at 14 (the record keeps the unclamped step value): ${door.y}`); ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.GATE_OPENED) && G.log.some((e) => e[0] === 'stop3d' && e[1] === 'gateLoop'), 'the loop stops, the opened sound plays');
        const k0 = key.ry; G.tick(5); ok(key.ry !== k0, 'spin');
      }
      {
        // the key is out of reach of a Pepper that is too far
        const G = mk(2, { noGuards: true });
        G.vars.set(VAR.MATCHED, 0xfff); G.tick(40);
        const key = G.rs[REC.KEY];
        G.put(0, 4.5, key.z - 2.0, 0); G.tick(3); ok((G.vars.get(VAR.MATCHED) & BIT.KEY) === 0, 'at 2.0 (squared 4.0 > 1.6) the key stays');
        G.put(0, 4.5, key.z - 1.2, 0); G.tick(1); ok((G.vars.get(VAR.MATCHED) & BIT.KEY) !== 0, 'at 1.2 it is taken');
        const H = mk(2, { noGuards: true });
        H.vars.set(VAR.MATCHED, 0xfff); H.vars.set(VAR.OPEN, 0x2); H.tick(3);
        ok((H.vars.get(VAR.OPEN) & BIT.KEY) === 0, 'a coffin still open: the key waits');
      }

      // ---- the page and the collapse
      {
        const G = mk(1, { noGuards: true });
        const page = G.rs[REC.PAGE], trap = G.rs[REC.TRAP], rock = G.rs[REC.ROCK];
        G.vars.set(VAR.MATCHED, 0x1fff); G.vars.set(VAR.READY, 0x10db);
        G.put(0, 13.6, 199, 0); G.tick(3);
        eq(G.vars.get(VAR.READY) & BIT.PAGE, 0, 'too far: 4.4 squared > 2.4');
        G.put(0, 13.6, 201.9, 0); G.tick(1);
        ok((G.vars.get(VAR.READY) & BIT.PAGE) !== 0, 'the page is touched within squared 2.4');
        G.tick(1);
        eq(G.nodes.pepper.state, PS.TO_PEDESTAL, 'Pepper walks to the pedestal'); ok((G.vars.get(VAR.READY) & BIT.CHASE) !== 0, 'READY 0x4000: the camera stands still');
        ok(G.log.some((e) => e[0] === 'say' && e[1] === 'ADSGMM02' && e[2] === 'ADSGMM13'), 'Pepper speaks (ADSGMM02, the queen ADSGMM13)');
        ok(G.rs[REC.COLL[0]].flags & 2, 'the barriers are still there');
        let t = 0; while (G.nodes.pepper.state === PS.TO_PEDESTAL && t < 200) { G.tick(1); t++; }
        eq(G.nodes.pepper.state, PS.TAKE_PAGE, 'taking the page'); eq(G.p.anim.clip, CLIP.PAGE_TAKE, 'clip 0x47');
        ok(near(G.p.z, 206.642 - 8, 1), `Pepper stands 8 before the pedestal: ${G.p.z}`);
        ok(REC.COLL.every((i) => (G.rs[i].flags & 2) === 0), 'the two barriers open');
        ok(trap.y > 25.6, 'the trap door rises since the page was touched');
        while (G.nodes.pepper.state === PS.TAKE_PAGE) G.tick(1);
        ok((page.flags & 2) === 0 && (G.vars.get(VAR.MATCHED) & BIT.PAGE) !== 0, 'the page is hidden and taken');
        eq(G.nodes.pepper.state, PS.TURN_BACK, 'Pepper turns back'); eq(G.p.anim.clip, CLIP.PAGE_RETURN, 'clip 0x51');
        ok(G.ev('2d', SND.GET_PAGE).length === 1, 'collect page sound');
        eq(G.vars.get(VAR.READY) & BIT.CHASE, 0, 'the camera is free again');
        // the trap finishes at 42 and starts the collapse; the boulder waits while MATCHED 0x4000 is set
        while (trap.y < 42 && G.ticks < 4000) G.tick(1);
        G.tick(2); ok((G.vars.get(VAR.OPEN) & BIT.CHASE) !== 0, 'OPEN 0x4000: the collapse');
        ok(REC.STONE.every((i) => (G.rs[i].flags & 2) !== 0), 'the stones appear');
        const z0 = rock.z; G.tick(3); ok(rock.z === z0 || (G.vars.get(VAR.MATCHED) & BIT.CHASE) === 0, 'the boulder is parked while Pepper turns back (MATCHED 0x4000)');
        while (G.nodes.pepper.state === PS.TURN_BACK) G.tick(1);
        eq(G.vars.get(VAR.MATCHED) & BIT.CHASE, 0, 'MATCHED 0x4000 cleared at the end of the turn');
        G.tick(1); eq(G.nodes.pepper.state, PS.CHASE, 'the run starts');
        const zr = rock.z; G.tick(10); ok(near(zr - rock.z, 8.5, 0.2), `the boulder rolls 0.85 per tick: ${zr - rock.z}`);
        ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.BOULDER) && G.log.some((e) => e[0] === 'music' && e[1] === MUSIC.CHASE), 'rumble and the chase music');
        const rx = rock.rx; G.tick(5); ok(rock.rx < rx - 1.5, 'the boulder turns');
        // Pepper runs at 0.9 per tick towards -z; left / right steer, clamped to +-4
        const pz = G.p.z; G.tick(10); ok(near(pz - G.p.z, 9, 1.0), `Pepper runs 0.9 per tick: ${pz - G.p.z}`);
        eq(G.p.anim.clip, CLIP.RUN, 'run clip 0x24');
        G.tick(40, [KEY.R]); ok(G.p.x <= 4.01, `clamped at x = 4: ${G.p.x}`);
        // mummies go away during the collapse
              }
      {
        // the camera: normal, collapse (further back, higher), the pit, frozen while READY 0x4000
        const G = mk(1, { noGuards: true });
        const c = G.w.camera.c;
        G.put(0, 10, 100, 0); G.tick(2);
        ok(near(c[1], 18, 1e-3) && near(c[2], 88, 1e-3) && near(c[4], 14.8, 1e-3) && near(c[5], 100, 1e-3) && c[0] === 0 && c[3] === 0, `normal camera at z 100: ${[...c].slice(0, 6).map((v) => v.toFixed(2))}`);
        G.put(9, 10, 100, 0); G.tick(1); ok(near(c[3], 4.6, 1e-2) && c[0] === 0, `looks at x - 4.4 when x >= 4.4: ${c[3]}`);
        G.put(-9, 10, 100, 0); G.tick(1); ok(near(c[3], -4.6, 1e-2), 'x + 4.4 on the other side');
        G.put(3, 10, 100, 0); G.tick(1); ok(c[3] === 0, 'within 4.4: looks along the middle');
        G.p.ctrl.nodes = [];          // (Pepper stays where the test puts him)
        G.vars.set(VAR.OPEN, BIT.CHASE); G.put(0, 10, 100, 0); G.tick(1);
        ok(near(c[1], 16.4, 1e-3) && near(c[2], 77.6, 1e-3) && near(c[4], 14, 1e-3), `chase camera: ${[...c].slice(0, 6).map((v) => v.toFixed(2))}`);
        G.put(0, 10, 70, 0); G.tick(1); ok(near(c[2], 47.6, 1e-3) && near(c[1], 16.4 + 6, 1e-3), `lifted between z 27 and 50 of the camera: ${c[1]}`);
        G.put(0, 10, -30, 0); G.tick(1); ok(near(c[4], PK.PIT_LOOK, 1e-3) && near(c[1], PK.PIT_LOOK + 2.4, 1e-3), `at the gate: ${c[1]} ${c[4]}`);
        G.vars.set(VAR.READY, BIT.CHASE); const before = [c[1], c[2], c[4], c[5]]; G.put(0, 30, 20, 0); G.tick(1);
        ok(c[1] === before[0] && c[4] === before[2] && c[5] === before[3], `READY 0x4000: only x is set: ${[c[1], c[4], c[5]].map((v) => v.toFixed(2))}`);
      }
      {
        // pillars: fall towards the middle when Pepper is within 16 ahead, reset by MATCHED 0x4000
        const G = mk(1, { noGuards: true });
        const pil = G.nodes.pillars, R = REC.PILLAR.map((i) => G.rs[i]);
        G.tick(2);
        ok(R.every((r) => r.rz === 0), 'upright without the collapse');
        G.p.ctrl.nodes = [];          // (Pepper stays where the test puts him)
        G.vars.set(VAR.OPEN, BIT.CHASE);
        G.put(0, 12, 190, 0); G.tick(1);
        ok(pil.every((n) => n.state === 0), 'too far');
        G.put(0, 12, R[0].z + 15.9, 0); G.tick(1);
        eq(pil[0].state, 1, 'the pillar at x > 0 falls: state 1'); ok(G.log.some((e) => e[0] === '3d' && e[1] === SND.COLUMN_FALL), 'with its sound');
        G.tick(1); ok(near(R[0].rz, 0.0523596, 1e-4), `rz grows 0.0524 per tick: ${R[0].rz}`);
        G.tick(25); eq(pil[0].state, 3, 'down after 20 ticks'); ok(near(R[0].rz, 1.00356, 1e-4), 'at 57.5 degrees');
        G.put(0, 12, R[1].z + 12, 0); G.tick(1); eq(pil[1].state, 2, 'a pillar at x <= 0 leans the other way'); G.tick(30); ok(near(R[1].rz, -1.00356, 1e-4), `negative angle ${R[1].rz}`);
        G.put(0, 12, 400, 0); G.vars.set(VAR.MATCHED, BIT.CHASE); G.tick(1);
        ok(pil.every((n) => n.state === 0) && R.every((r) => r.rz === 0), 'MATCHED 0x4000 raises them again');
      }
      {
        // the stones fall 2.4 per tick and start again around Pepper
        const G = mk(1, { noGuards: true });
        const S = REC.STONE.map((i) => G.rs[i]);
        G.tick(2); ok(S.every((s) => (s.flags & 2) === 0), 'hidden before the collapse');
        G.vars.set(VAR.OPEN, BIT.CHASE);
        G.put(0, 10, 100, 0);
        const y0 = S[0].y; G.tick(1); ok((S[0].flags & 2) !== 0 && near(S[0].y, y0 - 2.4, 1e-3), 'shown, falling 2.4 per tick');
        G.tick(60);
        ok(S.every((s) => s.y > 10 - 40 - 3 && s.y < 10 + 40 + 80 + 3) && S.every((s) => Math.abs(s.x) <= 32 + 64 && Math.abs(s.z - 100) <= 64), 'respawned within the box around Pepper');
      }
      {
        // the boulder: parked while MATCHED 0x4000, rolls to z -22, bounces along the floor (vy random 0 .. 0.24)
        const G = mk(1, { noGuards: true });
        const rock = G.rs[REC.ROCK], node = G.nodes.rock;
        G.p.ctrl.nodes = [];          // (Pepper is out of the picture)
        G.vars.set(VAR.OPEN, BIT.CHASE); G.vars.set(VAR.MATCHED, BIT.CHASE);
        G.put(0, 12, 120, 0); G.tick(10);
        ok(rock.z === 217.337 || near(rock.z, 217.337, 1e-2), 'parked at its start place');
        G.vars.set(VAR.MATCHED, 0);
        const ys = []; for (let i = 0; i < 100; i++) { G.tick(1); ys.push(rock.y); }
        ok(rock.z < 217.337 - 80, `rolls: ${rock.z}`); ok(Math.max(...ys.slice(30)) - Math.min(...ys.slice(30)) < 25, 'stays on the floor');
        ok(node.vy >= 0 || node.vy < 0, 'vy');
        for (let i = 0; i < 500; i++) G.tick(1);
        ok(rock.z <= -22 && rock.z > -22 - 1, `stops at z -22: ${rock.z}`);
      }
      // ---- the boulder catches Pepper: squashed (clip 0x55), bumped -> back to the pedestal, the chase starts over
      {
        const G = mk(1, { noGuards: true });
        const rock = G.rs[REC.ROCK];
        G.vars.set(VAR.OPEN, BIT.CHASE); G.vars.set(VAR.MATCHED, 0x1fff); G.vars.set(VAR.READY, 0x10db);
        G.rs[REC.PAGE].flags &= ~2; G.rs[REC.TRAP].y = 42;
        G.put(0, 9, 150, Math.PI); G.nodes.pepper.state = PS.CHASE;
        rock.m[14] = 154; rock.m[13] = 12; rock.savePrev();           // (the boulder right behind him)
        G.tick(1);
        eq(G.nodes.pepper.state, PS.SQUASHED, 'squashed within 3.2'); eq(G.p.anim.clip, CLIP.SQUASH, 'clip 0x55');
        ok(G.log.some((e) => e[0] === 'say' && e[1] === 'ADSGMM14'), 'ADSGMM14 is spoken');
        let t = 0; while (G.nodes.pepper.state === PS.SQUASHED && t < 200) { G.tick(1); t++; }
        ok(t >= 56 && t <= 58, `clip 0x55 has 57 frames: ${t}`);
        G.tick(1);
        eq(G.nodes.pepper.state, PS.TURN_BACK, 'restart: clip 0x51 at the pedestal'); ok(near(G.p.z, 206.642 - 8 - 0.4, 1.5), `Pepper is back at the pedestal: z ${G.p.z.toFixed(2)}`);
        ok((G.vars.get(VAR.MATCHED) & BIT.CHASE) !== 0, 'MATCHED 0x4000 set: the boulder and the pillars start over');
        G.tick(1); ok(near(rock.z, 217.337, 0.01), `the boulder is back: ${rock.z}`);
        while (G.nodes.pepper.state === PS.TURN_BACK) G.tick(1);
        G.tick(1); eq(G.nodes.pepper.state, PS.CHASE, 'and he runs again');
        // a wall: x + vx beyond 4.4 bumps (clip 0x50) and also ends in a restart
        const H = mk(1, { noGuards: true });
        H.vars.set(VAR.OPEN, BIT.CHASE); H.vars.set(VAR.MATCHED, 0x1fff); H.rs[REC.PAGE].flags &= ~2;
        H.put(4.3, 9, 150, Math.PI); H.nodes.pepper.state = PS.CHASE; H.nodes.pepper.vx = 0.32;
        H.tick(1);
        ok(H.nodes.pepper.state === PS.BUMP || H.p.x <= 4.01, `a wall at 4.4: state ${H.nodes.pepper.state} x ${H.p.x}`);
      }
      // ---- the gate and the win
      {
        const G = mk(1, { noGuards: true });
        const gate = G.rs[REC.GATE];
        G.vars.set(VAR.OPEN, BIT.CHASE); G.vars.set(VAR.MATCHED, 0x1fff); G.vars.set(VAR.READY, 0x10db);
        G.rs[REC.PAGE].flags &= ~2; G.rs[REC.TRAP].y = 42; G.rs[REC.ROCK].m[14] = 400;
        G.put(0, 9, -26, Math.PI); G.nodes.pepper.state = PS.CHASE;
        let over = false, t = 0; const g0 = gate.y;
        while (!over && t < 400) { over = G.tick(1); t++; if (G.sh.stopClock && t < 400 && gate.y === g0 && false) break; }
        ok(over && G.run.result === 1 && G.run.reason === 'escaped', `escaped: ${G.run.reason} after ${t}`);
        ok(G.sh.stopClock, 'the clock stopped when Pepper passed the gate'); ok(near(gate.y, 8.47, 1e-5), `the gate came down to 8.47: ${gate.y}`); ok((G.p.flags & 2) === 0, 'Pepper hidden (clip 0x5b ended)');
        ok((G.vars.get(VAR.NEAR) & BIT.CHASE) !== 0 && (G.vars.get(VAR.MATCHED) & BIT.CHASE) !== 0, 'NEAR 0x4000 = won, MATCHED 0x4000');
        eq(G.p.anim.clip, CLIP.LEAP, 'the leap clip 0x5b'); ok(near(G.p.z, -28.495 - 0.9 * 0 , 1.5) || G.p.z < -26, `stopped at the gate: ${G.p.z}`);
        const sec = G.sh.seconds; G.tick(100, []); eq(G.sh.seconds, sec, 'no more seconds');
        const s = scoreOf(sec, true); eq(G.run.score(G.vars), s, 'score from the seconds');
      }
      // ---- losing by time: the countdown beeps of the last 10 seconds, the finish sound
      {
        const G = mk(1, { noGuards: true });
        G.sh.seconds = 285;
        let over = false, t = 0, beeps = [];
        while (!over && t < 1000) { const n0 = G.log.length; over = G.tick(1); t++; for (const e of G.log.slice(n0)) if (e[0] === '2d' && e[1] === SND.CLOCK_TICK) beeps.push(G.sh.seconds); }
        ok(over && G.run.result === 2 && G.run.reason === 'time', `time up: ${G.run.reason}`);
        eq(beeps.join(), '290,291,292,293,294,295,296,297,298,299,300', 'a beep at each of the last 10 seconds and once more at 300 (the countdown reaches 0 = 300 - 300)');
        ok(G.ev('stop2d', SND.CLOCK_TICK).length >= 1 && G.ev('2d', SND.TIME_FINISH).length >= 1, 'stop the beep, play the finish sound');
        eq(G.sh.seconds, 300, '300 seconds'); eq(G.run.score(G.vars), 0, 'score 0');
        eq(clockText(G.sh.seconds), '0:00', 'clock 0:00');
      }

      // ============================================================ complete games played by the scripted player
      {
        const results = [];
        for (const seed of [1, 2, 3, 4, 5, 6]) {
          const G = bootWorld(ctx, seed);
          const bot = new Z18Bot({ mode: 'smart' });
          const n = playBot(G, bot, 12000);
          results.push([seed, G.run.result, G.run.reason, G.sh.seconds, G.run.score(G.w.vars), n]);
          ok(G.run.result === 1 && G.run.reason === 'escaped', `smart bot, seed ${seed}: ${G.run.reason} after ${G.sh.seconds} s`);
          ok(G.vars?.get === undefined, 'x');
          eq(G.w.vars.get(VAR.MATCHED) & 0xfff, 0xfff, `seed ${seed}: all 12 matched`);
          ok((G.w.vars.get(VAR.MATCHED) & BIT.KEY) !== 0 && (G.w.vars.get(VAR.MATCHED) & BIT.PAGE) !== 0, `seed ${seed}: key and page taken`);
          const sc = G.run.score(G.w.vars);
          ok(sc > 5000 && sc <= 10000 && sc === scoreOf(G.sh.seconds, true), `seed ${seed}: score ${sc}`);
        }
        notes.push(`smart bot (seeds 1..6): ${results.map((r) => `${r[0]}:${r[3]}s/${r[4]}`).join(' ')}`);
        // the careless bot: opens a wrong pair first
        const G = bootWorld(ctx, 9);
        const bot = new Z18Bot({ mode: 'careless' });
        const log = []; G.sh.sounds = rec().sounds; const r2 = rec(); G.sh.sounds = r2.sounds;
        playBot(G, bot, 12000);
        ok(G.run.result === 1, `careless bot wins: ${G.run.reason}`);
        ok(r2.log.filter((e) => e[0] === '2d' && e[1] === SND.MATCH_FAIL).length >= 1, 'the wrong pair played the failure sound');
        ok(r2.log.filter((e) => e[0] === '2d' && e[1] === SND.MATCH_OK).length >= 12, 'twelve success jingles (two per pair)');
        void log;
        // no input: the clock runs out
        const H = bootWorld(ctx, 8);
        const idle = new Z18Bot({ mode: 'idle' });
        // (the idle bot returns [] for ever: play the game for 9100 ticks)
        for (let i = 0; i < 9200 && H.run.result === 0; i++) tickWorld(H, idle.step(snapshotFromZone(H.zone)));
        ok(H.run.result === 2 && H.run.reason === 'time' && H.sh.seconds === 300, `no input: lost on time at ${H.sh.seconds} s`);
        eq(H.run.score(H.w.vars), 0, 'score 0'); eq(H.run.medal(H.w.vars), 0, 'no medal');
        notes.push('idle game: 300 seconds = 9001 ticks (the first second takes 31 ticks)');
        eq(H.w.tickCount, 9001, 'ticks until time up');
      }

      // ============================================================ the snapshot of the bot
      {
        const G = bootWorld(ctx, 1);
        const s = snapshotFromZone(G.zone);
        ok(s.sym.length === 12 && s.symPos.length === 12 && s.caseFwd.length === 12 && s.guards.length === 3, 'snapshot shape');
        ok(typeof snapshotFromZone.toString() === 'string' && !/\bimport\b/.test(snapshotFromZone.toString()), 'the snapshot function has no imports (the browser steps send its source to the page)');
      }
    } catch (e) {
      failures.push(`test crashed: ${e.stack || e}`);
    }
    return { checked, failures, notes };
  },
};
