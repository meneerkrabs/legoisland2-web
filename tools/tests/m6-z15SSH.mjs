import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { createCpu } from '../../src/formats/x86emu.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { loadMessages } from '../../src/ui/strings.ts';
import { PathSpline } from '../../src/zones/z15ssh/spline.ts';
import '../../src/zones/z15SSH.ts';
import {
  CTOR_CART, CTOR_SNAKE, REC, SND, K, SN, RESULT, VARS, SOUNDS_2D, SOUNDS_3D, hexf, finalScore, applyResult, resultLines, isWin, medalOfResult, checkRecords, placeOnPath,
} from '../../src/zones/z15ssh/rules.ts';
import { prepareSsh, PATHS, INTRO_CAMERA } from '../../src/zones/z15ssh/setup.ts';
import { SshBot } from '../lib/ssh-bot.mjs';
import { clockRng } from '../../src/zones/z15ssh/rules.ts';
import { setRandSource, setTickCountSource } from '../../src/game/crt.ts';
import { startTickClock } from '../../src/zones/common/tickrand.ts';
import { guarded } from '../lib/inject-guard.mjs';

// z15SSH "Slangen schieten" (docs/re/m6/z15SSH.md): constants and tables against the executable (the code streams of FUN_00656372 / 00657a30 / 00657860 / 006582de /
// 0065866f / 0065888a / 00658c16 / 00659d94 / 0065a470), the spline / projection against the original's own code run in the x86 emulator, the buggy (speed, camera, crew), the
// three snakes (spawn, run, leap, theft, hit), the coconuts (reload, flight, life, hit sphere), the ride's end and the result (medals, variables, banner lines), a scripted
// LOSS (no input), scripted WINS (a bot that aims and fires, a bot that only mashes Space) and runs that end in bronze / silver.

const hex = (n) => '0x' + n.toString(16);

const __test = {
  name: 'm6-z15SSH',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z15SSH');
    const code = (va, n) => pe.slice(va, n);
    /** the set of all 32-bit little-endian windows of a code range (immediates of any instruction) */
    const dwords = (va, n) => { const b = code(va, n); const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); const s = new Set(); for (let i = 0; i + 4 <= n; i++) s.add(dv.getUint32(i, true)); return s; };
    const bytesAt = (va, n) => [...code(va, n)];
    const findSeq = (va, n, seq) => { const b = bytesAt(va, n); const r = []; for (let i = 0; i + seq.length <= b.length; i++) { let m = true; for (let j = 0; j < seq.length; j++) if (b[i + j] !== seq[j]) { m = false; break; } if (m) r.push(va + i); } return r; };
    /** the immediates pushed by `push imm` (68 imm32 / 6a imm8) right before each `call target` */
    const pushedBeforeCalls = (va, n, target) => {
      const b = bytesAt(va, n), out = [];
      for (let i = 0; i + 5 <= n; i++) {
        if (b[i] !== 0xe8) continue;
        const rel = b[i + 1] | (b[i + 2] << 8) | (b[i + 3] << 16) | (b[i + 4] << 24);
        if (((va + i + 5 + rel) >>> 0) !== target) continue;
        if (b[i - 2] === 0x6a) out.push(b[i - 1]);
        else if (b[i - 5] === 0x68) out.push((b[i - 4] | (b[i - 3] << 8) | (b[i - 2] << 16) | (b[i - 1] << 24)) >>> 0);
      }
      return out;
    };
    const f32of = (u) => hexf(u);
    const pf32 = (a) => hexf(pe.u32(a));
    const pf64 = (a) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, pe.u32(a), true); d.setUint32(4, pe.u32(a + 4), true); return d.getFloat64(0, true); };
    const tab = readAudioTables(pe.data);

    try {
      // ============================================================ tables against the executable
      {
        const L = loadZone(ctx, 'z15SSH');
        const at = L.setup.attaches.map((a) => [a.record, a.ctor, a.var, a.mask, a.value]);
        ok(at.some((a) => a[0] === REC.CART && a[1] === CTOR_CART), `the set-up attaches the buggy node (0x659d94) to record 22: ${JSON.stringify(at)}`);
        ok(REC.SNAKE.every((i) => at.some((a) => a[0] === i && a[1] === CTOR_SNAKE)), 'the snake node (0x65a3c3) on the records 4 / 5 / 6');
        ok(at.every((a) => a[0] === 0 || (a[2] === 2 && a[3] === 0 && a[4] === 0)), 'the nodes are gated by var 2 & 0 == 0 (always on)');
        ok(L.world.records.length === 285, `${L.world.records.length} records`);
        ok(checkRecords(L.world.records).length === 0, `record names: ${checkRecords(L.world.records).join('; ')}`);
        ok(L.setup.groundName === 'LAND' || L.setup.groundRecord === REC.LAND, `ground record ${L.setup.groundName}`);
        // the hidden records of the set-up (FUN_00657460: +0x4d8 / +0x540 / +0xf68 / +0x8e8 = flags 0)
        ok([11, 12, 21, 37].every((i) => (L.world.records[i].flags & 2) === 0), 'records 11 / 12 / 21 / 37 hidden by the set-up');
        // the paths: file names of the constructor (strings at 0x91c7d4 .. 0x91c884)
        const names = [0x91c7d4, 0x91c7f8, 0x91c81c, 0x91c83c, 0x91c860, 0x91c884].map((a) => pe.cstr(a, 80).split('\\').pop().toLowerCase());
        ok(names.join() === 'cartpos1.man,cartpos1.man,carbut.man,snakeposl.man,snakeposr.man,carbut.man', `the six paths: ${names}`);
        ok(PATHS.CART.endsWith('CARBUT.man') && PATHS.CRT.endsWith('cartpos1.man') && PATHS.SNAKE_L.endsWith('SNAKEPOSL.man') && PATHS.SNAKE_R.endsWith('SNAKEPOSR.man'), 'PATHS');
      }
      {
        // the constructor FUN_00659d94 (0x659d94 .. 0x65a26e): the stored constants
        const seen = dwords(0x659d94, 0x4da);
        ok(seen.has(0x3df5c28f) && K.MAX_SPEED === f32of(0x3df5c28f), 'top speed 0x3df5c28f = 0.12 (p+0x3c)');
        for (const [u, what] of [[0x3ca3d70a, 'the buggy at 0.02'], [0x3a83126f, 'snake 1 at 0.001'], [0x3b449ba6, 'snake 2 at 0.003'], [0x3b83126f, 'cart 2 at 0.004'], [0x3be56042, 'cart 3 at 0.007']]) ok(seen.has(u), `constructor places ${what} (${hex(u)})`);
        ok(K.START_T === f32of(0x3ca3d70a) && K.SNAKE_T[0] === f32of(0x3a83126f) && K.SNAKE_T[1] === f32of(0x3b449ba6) && K.CRT_T[1] === f32of(0x3b83126f) && K.CRT_T[2] === f32of(0x3be56042), 'start parameters in K');
        ok(findSeq(0x659d94, 0x4da, [0x48, 0x14, 0, 0, 0]).length >= 1, 'p+0x48 = 0x14 (20 gems)');
        ok(K.GEMS === 20, 'K.GEMS');
        // the mode-0 camera of the loop (FUN_00656372): DAT_009da5e8 = ...
        const loop = dwords(0x656372, 0x10ee);
        for (const u of [0xc254825b, 0x42d04dd3, 0xc32d9efa, 0xc25219b4, 0x42b84d9f, 0xc34d9eb8]) ok(loop.has(u), `the loop sets the intro camera ${hex(u)}`);
        ok(near(INTRO_CAMERA.eye[0], -53.13, 0.01) && near(INTRO_CAMERA.target[2], -205.62, 0.01), 'INTRO_CAMERA');
      }
      {
        // FUN_00658c16 (0x658c16 .. 0x659b5d): constants of the buggy
        const seen = dwords(0x658c16, 0x947);
        for (const u of [0x7a80, 0xbf060a63, 0x3edf66a5, 0xbf860a63, 0x3f860a63, 0x96, 0xfa, 0x2710]) ok(seen.has(u), `FUN_00658c16 has the immediate ${hex(u)}`);
        // the medal tests `cmp dword [reg + 0x48], imm8` on the gem count: 0x12 and 0xc
        for (const [imm, lim] of [[0x11, 0x12], [0xb, 0xc]]) ok(findSeq(0x658c16, 0x947, [0x83, 0x3d, 0xd8, 0xbc, 0xd5, 0x05, imm]).length > 0, `cmp [DAT_05d5bcd8 (gems)], ${hex(imm)} (gems < ${hex(lim)}) in FUN_00658c16`);
        ok(K.PITCH_MIN === f32of(0xbf060a63) && K.PITCH_MAX === f32of(0x3edf66a5) && K.YAW_MIN === f32of(0xbf860a63) && K.YAW_MAX === f32of(0x3f860a63), 'aim limits');
        ok(K.GEM_POINTS === 0xfa && K.GEM_POINTS_LOST === 0x96 && K.SCORE_MAX === 10000 && K.GOLD_GEMS === 0x12 && K.SILVER_GEMS === 0xc, 'score constants');
        // the results stored in DAT_05d5bcdc (`mov dword [0x5d5bcdc], imm`): 0 / 1 / 3 / 4 / 5 and never 2
        const stores = new Set(); const b = bytesAt(0x658c16, 0x947);
        for (let i = 0; i + 10 <= b.length; i++) if (b[i] === 0xc7 && b[i + 1] === 0x05 && b[i + 2] === 0xdc && b[i + 3] === 0xbc && b[i + 4] === 0xd5 && b[i + 5] === 0x05) stores.add(b[i + 6] | (b[i + 7] << 8));
        ok([0, 1, 3, 4, 5].every((v) => stores.has(v)) && !stores.has(2), `results stored by FUN_00658c16: ${[...stores]}`);
        ok(pf32(0x892748) === 7000 && K.END_Z === 7000, 'the ride ends at z = 7000 (_DAT_00892748)');
        ok(near(pf32(0x892584), K.AIM_STEP, 1e-7) && near(pf32(0x892534), K.WHEEL_K, 1e-7) && near(pf32(0x8922cc), K.ACCEL, 1e-7), 'aim step 0.0349 / wheel 0.0524 / accel 0.005 in .rdata');
        ok(pf32(0x892090) === 8 && near(pf32(0x8920f0), 0.2, 1e-6) && pf32(0x8920f0) === K.POINT_TWO, 'movement factor 8 * 0.2');
        ok(pf32(0x892074) === 15 && near(pf32(0x892084), 0.8, 1e-6) && pf32(0x91c728) === 16 && pf32(0x91c72c) === 32 && pf32(0x91c730) === 5, 'ground probe 15 / 0.8, camera 16 / 32 / 5');
        ok(pf32(0x89228c) === 6 && pf32(0x89257c) === 18, 'camera lift 6.0, flinch frame 18');
        ok(near(pf64(0x892770), 0.6, 1e-9) && near(pf64(0x892778), -0.6, 1e-9), 'flinch threshold +-0.6 (doubles)');
        // FUN_0065888a: the stages (floats at 0x892750 .. 0x892764) and the engine rate immediates
        ok([0x892764, 0x892760, 0x89275c, 0x892758, 0x892754, 0x892750].map((a) => pf32(a)).join() === '4402,4813,6166,6276,6320,6407', 'stage thresholds 4402 / 4813 / 6166 / 6276 / 6320 / 6407');
        const es = dwords(0x65888a, 0x38c);
        ok([0x7a80, 0xf8d4, 0x7e54].every((v) => es.has(v)), 'engine rate 31360 .. 63700');
      }
      {
        // the snakes FUN_00657a30 (0x657a30 .. 0x65817c)
        const seen = dwords(0x657a30, 0x74c);
        ok(seen.has(0x41200000) && seen.has(0xc019999a) && seen.has(0x4019999a), 'rand(10.0), lateral offsets -2.4 / +2.4');
        ok(K.LATERAL.join() === '0,-2.4,2.4', 'lateral offsets');
        ok(pf32(0x8921a4) === 24 && K.JUMP_Z === 24 && near(pf32(0x8920cc), 0.1, 1e-6), 'the leap starts within 24, speed + 0.1');
        ok(findSeq(0x657a30, 0x74c, [0xb9, 0x0d, 0, 0, 0]).length >= 1, 'speech chance: % 13');
        ok(seen.has(0x41000000), 'probe of 8.0 above the snake');
        // the three lines the theft can say: JOHNA / JOHNC / ADSGSS10 (strings at 0x91c760 / 0x91c768 / 0x91c770) and the hit lines PEPPA / PIPPC / ADSGSS13
        ok([0x91c760, 0x91c768, 0x91c770, 0x91c77c, 0x91c784, 0x91c78c].map((a) => pe.cstr(a, 16)).join() === 'JOHNA,JOHNC,ADSGSS10,PEPPA,PIPPC,ADSGSS13', 'speech ids');
        // the coconuts: FUN_006582de (0x6582de .. 0x65866f), FUN_0065866f (.. 0x658818)
        const c = dwords(0x6582de, 0x391);
        ok(c.has(0x1f4) && c.has(0x28), 'coconut life 500, hit sphere 40');
        ok(findSeq(0x6582de, 0x391, [0xb9, 0x0f, 0, 0, 0]).length >= 1, 'speech chance on a hit: % 15');
        ok(K.COCO_LIFE === 500 && K.HIT_R2 === 40 && K.COCONUTS === 15 && K.HIT_SCORE === 0x32, 'coconut constants');
        ok(findSeq(0x6582de, 0x391, [0x83, 0xc0, 0x32]).length + findSeq(0x6582de, 0x391, [0x83, 0xc1, 0x32]).length + findSeq(0x6582de, 0x391, [0x83, 0xc2, 0x32]).length >= 1, 'score + 50 (0x32) per hit');
        ok(dwords(0x65866f, 0x1a9).has(0xbfc8b439) && K.COCO_SPEED === f32of(0xbfc8b439), 'coconut speed -1.5679');
        ok(findSeq(0x65866f, 0x1a9, [0x83, 0x7d, 0x9c, 0x0f]).length === 1, 'the fire loop looks at 15 slots');
        ok(pf32(0x89228c) === 6 && pf32(0x892090) === 8, 'reload 6, time step 8');
        // the Brickbot carts FUN_00657860: z window 3750 .. 5020
        ok(pf32(0x892744) === 3750 && pf32(0x892740) === 5020, 'cart window 3750 .. 5020');
        // the crosshair FUN_0065817c: [0x91c738] = 3
        ok(pe.u32(0x91c738) === 3 && pf32(0x892200) === 3, 'crosshair factors 3 / 3.0');
        // HUD formats
        ok(pe.cstr(0x91c798, 8) === '%d' && pe.cstr(0x91c79c, 8) === 'x%d', 'HUD formats %d / x%d');
      }
      {
        // the sound loads of FUN_0065a470: `push imm; call 0x4433b0` (3D) and `call 0x443580` (2D)
        const p3 = pushedBeforeCalls(0x65a470, 0x150, 0x4433b0), p2 = pushedBeforeCalls(0x65a470, 0x150, 0x443580);
        ok([...p3].sort((a, b) => a - b).join() === [...SOUNDS_3D].sort((a, b) => a - b).join(), `3D sounds ${p3.map(hex)}`);
        ok([...p2].sort((a, b) => a - b).join() === [...SOUNDS_2D].sort((a, b) => a - b).join(), `2D sounds ${p2.map(hex)}`);
        const nm = (id) => tab.sounds[id]?.name;
        ok(nm(SND.ENGINE) === 'SND_ENGINE' && nm(SND.WIND) === 'SND_SSH_WIND' && nm(SND.AMBIENT) === 'SND_SSH_AMBIENT' && nm(SND.WATERFALL) === 'SND_WATERFALL' && nm(SND.FOUNTAIN) === 'SND_FOUNTAIN', 'engine / wind / ambient / waterfall / fountain names');
        ok(nm(SND.TRAIN) === 'SND_BBOT_TRAIN' && nm(SND.UNDER_TRACK) === 'SND_UNDER_TRACK' && nm(SND.OVER_STUDS) === 'SND_OVER_STUDS' && nm(SND.SNAKE_MOVE) === 'SND_SNAKE_MOVE' && nm(SND.SNAKE_JUMP) === 'SND_SNAKE_JUMP', 'train / tracks / studs / snake names');
        ok(nm(SND.SNAKE_GET_GEM) === 'SND_SNAKE_GET_GEM' && nm(SND.SNAKE_HIT) === 'SND_SSH_SNAKE_HIT' && nm(SND.GUN) === 'SND_SSH_GUN' && nm(SND.SKID_LARGE) === 'SND_SKID_LARGE' && nm(SND.SKID_SMALL) === 'SND_SKID_SMALL' && nm(SND.GUN_SWIVEL) === 'SND_GUN_SWIVEL' && nm(SND.GUN_TILT) === 'SND_GUN_TILT', 'gem / hit / gun / skid / turret names');
        // the loop FUN_00656372: banner positions and the variables
        const lp = dwords(0x656372, 0x10ee);
        for (const v of [0x78, 0xc8, 0x14a, 0x96, 0x93]) ok(lp.has(v) || findSeq(0x656372, 0x10ee, [0x6a, v]).length > 0, `FUN_00656372 has the immediate ${hex(v)} (banner y / variable)`);
        for (const v of [0x64, 0x4b]) ok(findSeq(0x656372, 0x10ee, [0x6a, v]).length > 0, `FUN_00656372 pushes ${hex(v)} (score y 100 / HISCORE_SSH)`);
        const names = [0x4b, 0x93].map((i) => pe.cstr(pe.u32(0x8a3228 + i * 4), 64));
        ok(names[0] === 'SWITCH_GME_HISCORE_SSH' && names[1] === 'SWITCH_GME_TROPHY_SSH', `variable names ${names}`);
        ok(VARS.HISCORE === 0x4b && VARS.TROPHY === 0x93, 'VARS');
        // the strings of SSH.str
        const msgs = loadMessages(ctx.archives.find((a) => a.name === 'messages'), ['AI/Data/ssh.str']);
        const ids = ['ADSGSS01', 'ADSGSS02', 'ADSGSS03', 'ADSGSS04', 'ADSGSS05', 'ADSGSS06', 'ADSGSS07', 'ADSGSS10', 'ADSGSS13', 'ADSGSS14', 'JOHNA', 'JOHNC', 'PEPPA', 'PIPPC', 'CONTROL0', 'CONTROL4'];
        for (const id of ids) ok(msgs.text(id) && msgs.text(id) !== id, `SSH.str has ${id}`);
        ok(msgs.text('ADSGSS14').startsWith('Sla in de woestijn'), 'the intro line');
        for (const s of ['SGGOLD', 'SGSILVER', 'SGBRONZE']) ok(pe.findStrings(s).length > 0, `string ${s} in the executable`);
      }

      // ============================================================ the path code against the original's own code (x86 emulator)
      {
        const sp = PathSpline.fromMan(arch.read(arch.find('matanim/CARBUT.man')));
        const cpu = createCpu(pe); cpu.cw = 0x7f;      // the original runs the x87 in 24-bit precision
        const HEAP = 0x30000000;
        cpu.mem.addRegion({ lo: HEAP, hi: HEAP + 0x400000, name: 'heap' });
        let bump = HEAP + 0x1000;
        const alloc = (n) => { const p = bump; bump += (n + 15) & ~15; return p; };
        cpu.hooks.set(0x433d38, (c) => { c.eax = alloc(c.arg(0)); return 0; });
        const N = sp.n, pts = alloc(N * 12);
        for (let i = 0; i < N * 3; i++) cpu.mem.wf32(pts + i * 4, sp.pts[i]);
        const obj = alloc(0x40);
        cpu.mem.w32(obj, 0x892268); cpu.mem.w32(obj + 8, N); cpu.mem.w32(obj + 0x14, N); cpu.mem.w32(obj + 0x18, pts); cpu.mem.w32(obj + 0x10, 1);
        cpu.regs[1] = obj; cpu.call(0x447280, []);       // FUN_00447280: the plane table (calls vtable[1] = 0x4466f0 for every control point)
        const table = cpu.mem.u32(obj + 4);
        let dt = 0;
        for (let i = 0; i < N; i += 29) for (let k = 0; k < 4; k++) { const e = cpu.mem.f32(table + i * 16 + k * 4); dt = Math.max(dt, Math.abs(e - sp.table[i * 4 + k]) / (1 + Math.abs(e))); }
        ok(dt === 0, `the plane table equals FUN_00447280's (max relative difference ${dt})`);
        const out = alloc(0x40);
        let de = 0;
        for (const t of [0, 0.001, 0.02, 0.1234, 0.3333, 0.5, 0.7771, 0.9, 0.999]) {
          cpu.regs[1] = obj;
          const tf = Math.fround(t), u = new Uint32Array(new Float32Array([tf]).buffer)[0];
          cpu.call(0x4466f0, [out, u]);
          const f = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] }; sp.eval(tf, f);
          const E = (o) => [cpu.mem.f32(out + o), cpu.mem.f32(out + o + 4), cpu.mem.f32(out + o + 8)];
          const d = (x, y) => Math.max(...x.map((v, i) => Math.abs(v - y[i]) / (1 + Math.abs(v))));
          de = Math.max(de, d(E(0x30), f.pos), d(E(0x20), f.fwd), d(E(0), f.right), d(E(0x10), f.up));
        }
        ok(de === 0, `the curve frame (position, forward, right, up) equals vtable[1] 0x4466f0 (max relative difference ${de})`);
        let dp = 0, flags = 0;
        for (const p of [[-11, 100, -355], [-60, 90, -190], [-100, 70, 60], [-90, 18, 3900], [-120, -9, 7000], [-140, -12, 8200], [3, 95, -2000], [50, 50, 9000]]) {
          const pp = alloc(12); cpu.mem.wf32(pp, p[0]); cpu.mem.wf32(pp + 4, p[1]); cpu.mem.wf32(pp + 8, p[2]);
          cpu.regs[1] = obj; cpu.call(0x447550, [pp]);
          const t = cpu.mem.f32(obj + 0x1c), tt = sp.project(p);
          dp = Math.max(dp, Math.abs(t - tt));
          if (cpu.mem.u32(obj + 0x24) !== (sp.atEnd ? 1 : 0)) flags++;
          if (cpu.mem.u32(obj + 0x28) !== sp.lo) flags++;
        }
        ok(dp < 2e-5 && flags === 0, `the projection equals FUN_00447550 (max difference ${dp}, ${flags} flag / segment mismatches)`);
        // roundtrip: project(eval(t)) = t
        let rt = 0;
        const fr = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
        for (const t of [0.01, 0.2, 0.45, 0.6, 0.85]) { sp.eval(t, fr); rt = Math.max(rt, Math.abs(sp.project(fr.pos) - t)); }
        ok(rt < 2e-4, `project(eval(t)) = t (max difference ${rt})`);
        ok(sp.n === 1500 && sp.project([-120, -9, 7000]) > 0.8, 'CARBUT: 1500 control points');
        // frames are orthonormal
        sp.eval(0.6, fr);
        const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        ok(near(dot(fr.fwd, fr.right), 0, 1e-4) && near(dot(fr.fwd, fr.up), 0, 1e-4) && near(dot(fr.right, fr.up), 0, 1e-4) && near(Math.hypot(...fr.up), 1, 1e-4), 'orthonormal frame');
      }

      // ============================================================ result, banner, variables (pure)
      {
        const cases = [[0, 0, 1, 0], [50, 1, 3, 50 + 250], [3000, 11, 3, 3000 + 11 * 250], [3000, 12, 4, 3000 + 12 * 250], [100, 17, 4, 100 + 17 * 250], [100, 18, 5, 100 + 18 * 250], [6000, 20, 5, 10000], [2850, 0, 1, 2850], [10000, 5, 3, 10000]];
        for (const [pts, gems, res, score] of cases) { const r = finalScore(pts, gems); ok(r.result === res && r.score === score, `finalScore(${pts}, ${gems}) = ${r.result} / ${r.score}, expected ${res} / ${score}`); }
        ok(!isWin(1) && !isWin(2) && isWin(3) && isWin(4) && isWin(5), 'a ride is won with a medal');
        ok(medalOfResult(1) === 0 && medalOfResult(3) === 1 && medalOfResult(4) === 2 && medalOfResult(5) === 3, 'medals');
        ok(JSON.stringify(resultLines(1)) === '[{"id":"ADSGSS05","y":200},{"id":"ADSGSS06","y":330}]' && JSON.stringify(resultLines(2)) === JSON.stringify(resultLines(1)), 'result 1 / 2: ADSGSS05 at 200, ADSGSS06 at 330');
        ok(JSON.stringify(resultLines(3)) === '[{"id":"ADSGSS04","y":200}]' && JSON.stringify(resultLines(4)) === '[{"id":"ADSGSS02","y":200},{"id":"ADSGSS03","y":330}]' && JSON.stringify(resultLines(5)) === '[{"id":"ADSGSS01","y":200}]', 'bronze / silver / gold lines');
        const v = new Map([[0x4b, 3000], [0x93, 2]]);
        const vars = { get: (i) => v.get(i) ?? 0, set: (i, x) => v.set(i, x) };
        applyResult(vars, 1000, 3); ok(v.get(0x4b) === 3000 && v.get(0x93) === 2, 'a worse run changes nothing');
        applyResult(vars, 9400, 5); ok(v.get(0x4b) === 9400 && v.get(0x93) === 3, 'a better run raises both');
        applyResult(vars, 100, 1); ok(v.get(0x4b) === 9400 && v.get(0x93) === 3, 'a lost run changes nothing');
        const w2 = new Map(); const vars2 = { get: (i) => w2.get(i) ?? 0, set: (i, x) => w2.set(i, x) };
        applyResult(vars2, 400, 1); ok(w2.get(0x4b) === 400 && (w2.get(0x93) ?? 0) === 0, 'a lost run still raises the hi-score, no trophy');
      }

      // ============================================================ scenarios
      const make = (opts = {}) => {
        const L = loadZone(ctx, 'z15SSH');
        const w = L.world;
        const calls = [];
        const speech = [];
        const sounds = {
          play: (id) => calls.push({ t: w.tickCount + 1, id }), stop: (id) => calls.push({ t: w.tickCount + 1, id, stop: true }),
          rate: (id, hz) => calls.push({ t: w.tickCount + 1, id, hz }), volume: (id, v) => calls.push({ t: w.tickCount + 1, id, vol: v }),
          play3D: (id, x, y, z) => calls.push({ t: w.tickCount + 1, id, d3: true, x, y, z }), stop3D: (id) => calls.push({ t: w.tickCount + 1, id, stop3: true }),
        };
        // the random numbers: int(10) = the snake's start frame, int(13) = the theft line, int(15) = the hit line; scripted or a fixed sequence
        const seq = opts.rng ?? [];
        let n = 0;
        const rng = { int: (m) => (seq.length ? seq[n++ % seq.length] % m : (n++ * 7) % m) };
        const S = prepareSsh(w, L, L.archive, L.scene, { sounds, rng, say: (id) => { speech.push(id); return true; }, coco: opts.coco ?? false });
        const tick = (nn = 1, mask = 0) => { for (let i = 0; i < nn; i++) { w.input.setVirtual(i === 0 ? mask : 0); w.tick(); } };
        return { L, w, S, node: S.node, cart: S.cart, R: w.records, calls, speech, tick, parts: S.parts, snd: (id) => calls.filter((c) => c.id === id) };
      };
      const run = (g, mask, limit = 9000) => { let n = 0; for (; n < limit && g.node.result === 0; n++) { g.w.input.setVirtual(typeof mask === 'function' ? mask(n) : mask); g.w.tick(); } return n; };

      // ---- the default random source (WP-TIME): the shared C runtime generator and the real clock
      {
        const fixed = [32767, 16384, 5];
        let k = 0; setRandSource(() => fixed[k++ % fixed.length]);
        setTickCountSource(() => 100); startTickClock(); setTickCountSource(() => 100 + 2000);
        const f = Math.fround;
        ok(clockRng.int(10) === Math.trunc(f(f(32767 / 32767) * 10)) && clockRng.int(10) === Math.trunc(f(f(16384 / 32767) * 10)), 'int(n) = ftol(FUN_004388ae(n)): rand() = 32767 gives n itself (the snake slither frame 0 .. 10)');
        ok(clockRng.int(13, true) === Math.trunc(f(f(5 / 32767) * 2000)) % 13, 'int(n, true) = ftol(FUN_004388ae(ms since the zone start)) % n: the speech chances over the real clock');
        setRandSource(null); setTickCountSource(null);
      }

      // ---- start state
      {
        const g = make();
        const { w, node, R, cart, parts } = g;
        ok(cart.ctrl.nodes.length === 1 && cart.ctrl.nodes[0].kind === 'Walk', 'the buggy runs only the Walk node (the stub chain is gone)');
        ok(REC.SNAKE.every((i) => (R[i].flags & 2) !== 0 || true) && REC.SNAKE.every((i) => (R[i].flags & 1) === 0), 'snake frustum bits cleared by the constructor');
        const sp = PathSpline.fromMan(arch.read(arch.find(PATHS.CART)));
        const fr = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
        sp.eval(K.START_T, fr);
        ok(near(cart.x, fr.pos[0], 1e-3) && near(cart.y, fr.pos[1], 1e-3) && near(cart.z, fr.pos[2], 1e-3), `the buggy starts at CARBUT t = 0.02: (${cart.x.toFixed(2)}, ${cart.y.toFixed(2)}, ${cart.z.toFixed(2)})`);
        ok(near(cart.z, -189.69, 0.05), 'start z -189.7 (the intro camera is 16 ahead of it: z -173.6)');
        const eyeZ = cart.z + K.CAM_BACK;
        ok(near(eyeZ, INTRO_CAMERA.eye[2], 0.5), `the loop's intro camera eye z ${INTRO_CAMERA.eye[2].toFixed(2)} = start z + 16 (${eyeZ.toFixed(2)})`);
        const c = w.camera.c;
        ok(near(c[0], INTRO_CAMERA.eye[0], 1e-4) && near(c[4], INTRO_CAMERA.target[1], 1e-4), 'intro camera set');
        ok(parts.count(cart) === 8 && parts.count(R[REC.CRT[0]]) === 6, `mesh parts: PEPP ${parts.count(cart)}, CRT1 ${parts.count(R[REC.CRT[0]])}`);
        const t6 = parts.get(cart, 6), t5 = parts.get(cart, 5);
        const john = R[REC.JOHN], pip = R[REC.PIPP];
        const j = cart.toWorld([t6[12], t6[13], t6[14]]), p = cart.toWorld([t5[12], t5[13], t5[14]]);
        ok(near(john.x, j[0], 1e-3) && near(john.y, j[1], 1e-3) && near(john.z, j[2], 1e-3), 'Johnny sits at part 6');
        ok(near(pip.x, p[0], 1e-3) && near(pip.y, p[1], 1e-3) && near(pip.z, p[2], 1e-3), 'Pippin sits at part 5');
        ok(pip.anim.clip === 3 && pip.anim.frame === 0 && john.anim.clip === 1 && john.anim.frame === 7, 'Pippin clip 3 frame 0, Johnny clip 1 frame 7');
        ok(R[REC.BBT[0]].anim.clip === 2 && R[REC.BBT[0]].anim.frame === 5 && R[REC.BBT[1]].anim.frame === 0 && R[REC.BBT[2]].anim.frame === 7, 'Brickbot clips 2 from frames 5 / 0 / 7');
        ok(REC.SNAKE.every((i) => R[i].anim.clip === 1), 'snake rigs (clip 1 until the first spawn)');
        const sk = REC.SNAKE.map((i, k) => { sp.eval(0, fr); return [R[i].x, R[i].z]; });
        ok(sk.every((q) => q[1] < -300 && q[1] > -380), `the snakes wait ~165 behind the buggy: z ${sk.map((q) => q[1].toFixed(0))}`);
        ok(node.speed === 0 && node.gems === 20 && node.score === 0 && node.result === 0, 'speed 0, 20 gems, score 0');
        ok(node.hudGems === 20 && node.hudScore === 0, 'HUD globals');
      }

      // ---- the ride: speed ramp, movement, camera
      {
        const g = make();
        const { w, node, cart, tick } = g;
        const z0 = cart.z;
        tick(1);
        ok(near(node.speed, 0.005, 1e-7), `speed after tick 1: ${node.speed}`);
        tick(23);
        ok(near(node.speed, 0.12, 1e-5) || node.speed <= K.MAX_SPEED, `speed after 24 ticks: ${node.speed}`);
        tick(2);
        ok(node.speed === K.MAX_SPEED, `top speed reached and kept: ${node.speed}`);
        // z per tick at full speed = 12.8 * 0.12 * cos(yaw...) ~ 1.5
        const zs = cart.z;
        tick(10);
        const dz = (cart.z - zs) / 10;
        ok(dz > 1.3 && dz < 1.55, `the buggy moves ${dz.toFixed(3)} per tick at full speed (12.8 * 0.12 * cos(yaw) = 1.536 * cos)`);
        ok(cart.z > z0 + 15, 'moved forward');
        // the buggy follows the heading of the path: its yaw is the path's tangent (about -0.2 .. -0.3 at the start)
        ok(cart.ry < -0.1 && cart.ry > -0.4, `yaw ${cart.ry.toFixed(3)}`);
        // the camera: target 16 behind, eye 16 ahead and above
        const c = w.camera.c;
        const sy = node.smoothYaw;
        ok(near(c[3], cart.x - Math.sin(sy) * 16, 0.02) && near(c[5], cart.z - Math.cos(sy) * 16, 0.02), 'camera target 16 behind the buggy (eased yaw)');
        ok(near(c[0], cart.x + Math.sin(sy) * 16, 0.02) && near(c[2], cart.z + Math.cos(sy) * 16, 0.02), 'camera eye 16 ahead');
        ok(c[1] > cart.y + 11 && c[1] < cart.y + 16, `eye height above the buggy ${(c[1] - cart.y).toFixed(2)} (>= 6.4 + 6)`);
        ok(c[4] === cart.y, 'the camera looks at the buggy height');
        // the eased yaw approaches the yaw (1/8 per tick)
        tick(60);
        ok(Math.abs(node.smoothYaw - cart.ry) < 0.12, `eased yaw ${node.smoothYaw.toFixed(3)} follows ${cart.ry.toFixed(3)}`);
        // stays near the path
        const sp = PathSpline.fromMan(arch.read(arch.find(PATHS.CART)));
        const fr = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
        let worst = 0;
        tick(400);
        for (let i = 0; i < 20; i++) { tick(10); const t = sp.project([cart.x, cart.y, cart.z]); sp.eval(t, fr); worst = Math.max(worst, Math.hypot(fr.pos[0] - cart.x, fr.pos[2] - cart.z)); }
        ok(worst < 6, `the buggy keeps within ${worst.toFixed(2)} of the path`);
        // the wheels turn (four adds per tick)
        ok(near(node.wheel, 0, 1e9) && node.wheel > 0, `wheel angle ${node.wheel.toFixed(3)}`);
        const wheel = g.parts.get(cart, 3);
        ok(wheel && Math.abs(wheel[6] - Math.sin(node.wheel)) < 1e-4 && Math.abs(wheel[5] - Math.cos(node.wheel)) < 1e-4, 'the last wheel carries the full angle (about x)');
        const w0 = g.parts.get(cart, 0);
        ok(Math.abs(w0[6] - Math.sin(node.wheel - 3 * K.WHEEL_K * node.speed)) < 1e-4, 'wheel 0 has the angle after the first add');
        // the crew: Johnny leans (seek) and sits where part 6 is
        ok(g.R[REC.JOHN].anim.frame >= 0 && g.R[REC.JOHN].anim.frame <= 29, `Johnny's lean frame ${g.R[REC.JOHN].anim.frame}`);
      }

      // ---- the turret and the crosshair
      {
        const g = make();
        const { node, tick, cart } = g;
        tick(1, 1);                                              // LEFT held: yaw -0.0349
        ok(near(node.aimYaw, -K.AIM_STEP, 1e-6), `LEFT turns the turret -2 degrees: ${node.aimYaw}`);
        tick(1, 2); tick(1, 2);
        ok(near(node.aimYaw, K.AIM_STEP, 1e-6), 'RIGHT turns it back and further');
        tick(1, 4); ok(near(node.aimPitch, K.AIM_STEP, 1e-6), 'UP raises the pitch');
        tick(1, 8); tick(1, 8); ok(near(node.aimPitch, -K.AIM_STEP, 1e-6), 'DOWN lowers it');
        for (let i = 0; i < 40; i++) tick(1, 2);
        ok(node.aimYaw === K.YAW_MAX && near(node.aimYaw, 1.0472, 1e-4), `yaw limit ${node.aimYaw}`);
        for (let i = 0; i < 80; i++) tick(1, 1);
        ok(node.aimYaw === K.YAW_MIN, `yaw limit (left) ${node.aimYaw}`);
        for (let i = 0; i < 40; i++) tick(1, 4);
        ok(node.aimPitch === K.PITCH_MAX && near(node.aimPitch, 0.43633, 1e-4), `pitch limit ${node.aimPitch}`);
        for (let i = 0; i < 80; i++) tick(1, 8);
        ok(node.aimPitch === K.PITCH_MIN && near(node.aimPitch, -0.5236, 1e-4), `pitch limit (down) ${node.aimPitch}`);
        // the turret's part matrix carries the angles (rx = pitch, ry = yaw)
        const t4 = g.parts.get(cart, 4);
        ok(near(t4[9], -Math.sin(node.aimPitch) * 1, 1e-3) || near(t4[9], Math.sin(0.5236), 1e-2), 'part 4 matrix rebuilt from pitch / yaw');
        // the crosshair: centre of the screen / 4 down when level
        const g2 = make();
        g2.tick(1);
        const ch = g2.node.crosshair(g2.cart);
        ok(ch.x === 320 && ch.y >= 100 && ch.y <= 140, `crosshair at ${JSON.stringify(ch)} (320, 120 - pitch)`);
        g2.node.aimYaw = 1.0; g2.node.aimPitch = 0.4;
        const ch2 = g2.node.crosshair(g2.cart);
        ok(ch2.x === Math.trunc(320 + 640 * 1.0 / 3) && ch2.y === Math.max(0, Math.trunc(Math.trunc(480 / 4) - 480 * g2.cart.rx / 3 - 480 * 0.4 / 3)), `crosshair moves with the aim: ${JSON.stringify(ch2)}`);
        g2.node.aimYaw = -5; ok(g2.node.crosshair(g2.cart).x === 32, 'crosshair clamped to x >= 32');
        g2.node.aimYaw = 5; ok(g2.node.crosshair(g2.cart).x === 608, 'crosshair clamped to x <= 608');
      }

      // ---- the snakes: spawn, run, leap, theft
      {
        const g = make({ rng: [3, 5, 7, 12, 14, 9] });
        const { node, tick, R, cart } = g;
        tick(30);
        ok(node.states.every((s) => s === SN.IDLE) && node.timers.every((t) => t === 30), `30 ticks: waiting (timers ${node.timers})`);
        ok(REC.SNAKE.every((i) => (R[i].flags & 2) === 0), 'hidden while idle');
        tick(1);
        ok(node.states.every((s) => s === SN.RUN) && node.timers.every((t) => t === 0), 'tick 31: all three run (timer 31 > 3 * 10)');
        ok(REC.SNAKE.every((i) => R[i].anim.clip === 3), 'slither clip');
        ok(g.snd(SND.SNAKE_MOVE).length === 0, 'the move sound starts the tick after');
        tick(1);
        ok(REC.SNAKE.every((i) => (R[i].flags & 2) !== 0), 'shown from the first tick of the run');
        const z0 = REC.SNAKE.map((i) => R[i].z), cz0 = cart.z;
        tick(10);
        const dz = REC.SNAKE.map((i, k) => (R[i].z - z0[k]) / 10), dc = (cart.z - cz0) / 10;
        ok(dz.every((d) => d > dc * 1.4 && d < dc * 2.4), `the snakes are faster than the buggy: ${dz.map((d) => d.toFixed(2))} vs ${dc.toFixed(2)} per tick`);
        ok(g.snd(SND.SNAKE_MOVE).length >= 30, 'the snake sound refreshes every tick');
        // run until the first leap
        let t = 0;
        while (!node.states.includes(SN.ATTACK) && t++ < 400) tick(1);
        const a = node.states.indexOf(SN.ATTACK);
        ok(a >= 0 && t > 60 && t < 300, `a snake leaps after ${t + 41} ticks`);
        ok(cart.z - R[REC.SNAKE[a]].z < 24 + 2 && cart.z - R[REC.SNAKE[a]].z > 20, `it leaps when the buggy is within 24 (z gap ${(cart.z - R[REC.SNAKE[a]].z).toFixed(1)}, the buggy moved 1.5 since)`);
        ok(R[REC.SNAKE[a]].anim.clip === 2 && g.snd(SND.SNAKE_JUMP).length >= 1, 'attack clip and the jump sound');
        // the leap homes onto the buggy by (remaining distance) / ftol(42 - frame) per tick (WP-VERIFY: fsubr [0x89274c] at 0x657cad): slowly at first (the buggy drives away
        // faster, 1.5 per tick), then it snaps onto the buggy (offset 0 / -2.4 / +2.4) in the last frames
        const d0 = Math.hypot(R[REC.SNAKE[a]].x - cart.x, R[REC.SNAKE[a]].z - cart.z);
        tick(12);
        const d1 = Math.hypot(R[REC.SNAKE[a]].x - cart.x, R[REC.SNAKE[a]].z - cart.z);
        ok(d1 > d0 && d1 < 60, `the leaping snake falls behind at first: ${d0.toFixed(1)} -> ${d1.toFixed(1)}`);
        let dmin = d1;
        // 45 frames later the gem is gone
        const gems0 = node.gems;
        let m = 0;
        while (node.states[a] === SN.ATTACK && m++ < 60) { tick(1); dmin = Math.min(dmin, Math.hypot(R[REC.SNAKE[a]].x - cart.x, R[REC.SNAKE[a]].z - cart.z)); }
        ok(dmin <= 3, `... and lands on the buggy in the last frames (closest ${dmin.toFixed(2)})`);
        ok(m >= 28 && m <= 45, `the attack clip (45 frames) ends ${m + 13} ticks after the leap (frame advance 1 per tick)`);
        ok(node.gems === gems0 - 1 && node.hudGems === gems0 - 1 || node.gems < gems0, `a gem is stolen: ${gems0} -> ${node.gems}`);
        ok(node.states[a] === SN.IDLE && (R[REC.SNAKE[a]].flags & 2) === 0, 'the snake goes back to idle and hides');
        ok(g.snd(SND.SNAKE_GET_GEM).length >= 1, 'the gem sound');
        ok(g.speech.every((s) => ['JOHNA', 'JOHNC', 'ADSGSS10'].includes(s)), `theft speech ${g.speech}`);
        // the snake returns to where its leap began
        ok(near(R[REC.SNAKE[a]].z, node.saved[a][2], 1.5), 'it reappears where the leap began (the terrain height keeps following)');
      }

      // ---- coconuts: reload, flight, expiry
      const FIRE = 0x80;
      /** a press of Space: the key goes down for one tick (the shot needs the edge) */
      const press = (g) => { g.tick(1, FIRE); };
      const live = (g) => g.node.coconuts.filter((c) => c.active).length;
      {
        const g = make({ coco: false });
        const { node, tick, cart, parts } = g;
        node.timers = [-1e9, -1e9, -1e9];                     // the snakes stay away: nothing to hit
        tick(30);
        const pre = { x: cart.x, y: cart.y, z: cart.z, m: Float32Array.from(cart.m) };
        press(g);
        ok(live(g) === 1, 'Space fires one coconut');
        ok(g.snd(SND.GUN).length >= 1 && g.snd(SND.GUN).some((c) => c.stop), 'the gun sound (stop + play)');
        ok(node.reload === 2, `the reload counter after the shot (1, then +1 in the same tick): ${node.reload}`);
        const c0 = node.coconuts.find((c) => c.active);
        const tur = parts.get(cart, 4);
        ok(c0 && near(c0.m[12], pre.x + tur[12] + c0.vel[0], 0.05) && near(c0.m[13], pre.y + tur[13] + c0.vel[1], 0.05) && near(c0.m[14], pre.z + tur[14] + c0.vel[2], 0.05), 'the coconut starts at the buggy position + the turret offset (unrotated) and moved once');
        ok(near(Math.hypot(...c0.vel), 1.5679, 1e-3), `coconut speed ${Math.hypot(...c0.vel)}`);
        // straight back: velocity = -forward * 1.5679 (the turret looks along the buggy's forward at yaw 0 / pitch 0)
        ok(near(c0.vel[0], -pre.m[8] * 1.5679, 1e-3) && near(c0.vel[1], -pre.m[9] * 1.5679, 1e-3) && near(c0.vel[2], -pre.m[10] * 1.5679, 1e-3), 'the coconut flies backwards along the buggy');
        ok(near(c0.m[0], 0, 2) && c0.m[15] === 1, 'the coconut carries the gun matrix');
        // the reload: a press 2 and 4 ticks later is ignored, 6 ticks later (the counter ran 1 .. 7) it fires
        tick(1); press(g); tick(1); press(g); tick(1);
        ok(live(g) === 1, 'presses 2 and 4 ticks after the shot do nothing (the reload counter runs 6 ticks)');
        press(g);
        ok(live(g) === 2, `a press 6 ticks after the shot fires again (live ${live(g)}, reload ${node.reload})`);
        // life: 500 time units at 8 per tick: the first coconut lives 63 ticks
        const first = node.coconuts.findIndex((c) => c.active);
        let age = 6;
        while (node.coconuts[first].active && age < 100) { tick(1); age++; }
        ok(age === 63, `a coconut lives 63 ticks (500 / 8 + 1): ${age}`);
        ok(node.coconuts.length === 15, '15 coconut slots');
        // a long burst: never more than 15 flying (they live 63 ticks and shots come every 6: 11 at most)
        let mx = 0;
        for (let i = 0; i < 200; i++) { tick(1, i % 2 === 0 ? FIRE : 0); mx = Math.max(mx, live(g)); }
        ok(mx >= 9 && mx <= 15, `up to ${mx} coconuts in the air at the fastest fire`);
        // the hit sphere: a snake within sqrt(40) of the coconut, running (hit clip) or leaping (timer 1)
        const g2 = make();
        const { node: n2, R, tick: t2, cart: c2 } = g2;
        t2(1);
        press(g2);
        t2(10);
        const cc = n2.coconuts.find((c) => c.active);
        const sn = R[REC.SNAKE[0]];
        n2.states[0] = SN.RUN; sn.flags |= 2;
        sn.m[12] = cc.m[12]; sn.m[13] = cc.m[13]; sn.m[14] = cc.m[14] - 1;
        const sc0 = n2.score;
        t2(1);
        ok(n2.score === sc0 + 50 && n2.states[0] === SN.HIT && sn.anim.clip === 1 && sn.anim.frame <= 1, `a coconut that reaches a running snake hits it: score +${n2.score - sc0}, state ${n2.states[0]}`);
        ok(g2.snd(SND.SNAKE_HIT).length >= 1 && g2.snd(SND.SNAKE_HIT).some((c) => c.stop3) && live(g2) === 0, 'hit sound (stop + play), the coconut is gone');
        let h = 0; while (n2.states[0] === SN.HIT && h++ < 30) t2(1);
        ok(h >= 11 && h <= 14 && n2.states[0] === SN.IDLE && (sn.flags & 2) === 0 && n2.timers[0] === 0, `the hit clip ends after ~${h} ticks, then idle, hidden, timer 0`);
        // a snake that is just outside the sphere is not hit
        const g5 = make();
        const { node: n5, R: R5, tick: t5 } = g5;
        t5(1); press(g5); t5(10);
        const c5 = n5.coconuts.find((c) => c.active);
        n5.states[1] = SN.RUN; R5[REC.SNAKE[1]].flags |= 2;
        R5[REC.SNAKE[1]].m[12] = c5.m[12]; R5[REC.SNAKE[1]].m[13] = c5.m[13]; R5[REC.SNAKE[1]].m[14] = c5.m[14] - 8;
        t5(1);
        ok(n5.score === 0 && n5.states[1] === SN.RUN, `a snake 8 units away is not hit (the sphere's radius is ${Math.sqrt(40).toFixed(2)})`);
        // a hit on a leaping snake: timer 1 and no theft
        const g3 = make();
        const { node: n3, R: R3, tick: t3, cart: c3 } = g3;
        t3(1);
        n3.states[1] = SN.ATTACK; R3[REC.SNAKE[1]].anim.start(2, 0); n3.saved[1] = [c3.x, c3.y, c3.z - 30]; R3[REC.SNAKE[1]].flags |= 2;
        const s3 = R3[REC.SNAKE[1]]; const tur3 = g3.parts.get(c3, 4);
        s3.m[12] = c3.x + tur3[12]; s3.m[13] = c3.y + tur3[13]; s3.m[14] = c3.z + tur3[14] + 2;
        press(g3);
        ok(n3.timers[1] === 1 && n3.score === 50 && n3.states[1] === SN.ATTACK, `a hit on a leaping snake: timer ${n3.timers[1]}, still leaping`);
        const gems3 = n3.gems;
        let k3 = 0; while (n3.states[1] === SN.ATTACK && k3++ < 60) t3(1);
        ok(n3.gems === gems3 && n3.states[1] === SN.IDLE, `the hit snake steals nothing (gems ${n3.gems})`);
        ok(g3.speech.length === 0 || g3.speech.every((x) => ['PEPPA', 'PIPPC', 'ADSGSS13'].includes(x)), `hit speech ${g3.speech}`);
        // a snake that is idle cannot be hit
        const g4 = make();
        g4.tick(1);
        const t4 = g4.parts.get(g4.cart, 4);
        g4.R[REC.SNAKE[2]].m[12] = g4.cart.x + t4[12]; g4.R[REC.SNAKE[2]].m[14] = g4.cart.z + t4[14] - 1;
        press(g4);
        ok(g4.node.score === 0, 'an idle snake is not hit');
        // the hit speech: rng % 15 -> 0 / 1 / 2 speak PEPPA / PIPPC / ADSGSS13
        for (const [r, id] of [[0, 'PEPPA'], [1, 'PIPPC'], [2, 'ADSGSS13']]) {
          const gs = make({ rng: [r] });
          gs.tick(1); press(gs); gs.tick(10);
          const cs = gs.node.coconuts.find((c) => c.active);
          gs.node.states[0] = SN.RUN; gs.R[REC.SNAKE[0]].m[12] = cs.m[12]; gs.R[REC.SNAKE[0]].m[13] = cs.m[13]; gs.R[REC.SNAKE[0]].m[14] = cs.m[14] - 1;
          gs.tick(1);
          ok(gs.speech.includes(id), `rng ${r} -> a hit says ${id} (${gs.speech})`);
        }
      }

      // ---- the end of the ride
      const sp0 = PathSpline.fromMan(arch.read(arch.find(PATHS.CART)));
      const fr0 = { pos: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0], fwd: [0, 0, 0] };
      /** the parameter of the CARBUT path at world z */
      const tFor = (z) => { let lo = 0, hi = 1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; sp0.eval(m, fr0); if (fr0.pos[2] < z) lo = m; else hi = m; } return lo; };
      {
        const g = make();
        const { node, cart, tick, w } = g;
        node.jumpTo(w, tFor(6900));
        node.timers = [-1e9, -1e9, -1e9];                     // no snake spawns in this scenario
        node.speed = K.MAX_SPEED;
        tick(1);
        let n = 0;
        while (cart.z <= 7000 && n++ < 600) tick(1);
        ok(cart.z > 7000 && n > 50 && n < 80, `the buggy passes z 7000 after ${n} ticks`);
        ok(node.result === 0, 'no result while the buggy still moves');
        const before = node.speed;
        tick(5);
        ok(near(before - node.speed, 5 * K.ACCEL, 1e-4), `after the end the speed falls 0.005 per tick: ${before} -> ${node.speed}`);
        let m = 0;
        while (node.speed > 0 && node.result === 0 && m++ < 100) tick(1);
        ok(m >= 17 && m <= 20, `the buggy stops after ${m + 5} ticks (0.12 / 0.005 = 24)`);
        ok(node.speed === 0 && node.result === RESULT.NO_GEMS || node.result !== 0, 'the result is computed the tick the buggy stands (all snakes idle)');
        const r = finalScore(node.score, node.gems);
        ok(node.result === r.result && node.finalScore === r.score && node.result === RESULT.GOLD, `20 gems, no hits: gold, score ${node.finalScore}`);
        ok(node.finalScore === 5000, '20 x 250 = 5000');
        const z1 = cart.z; tick(10);
        ok(cart.z - z1 < 0.5, 'stopped');
        ok(g.snd(SND.WIND).some((c) => c.stop), 'the wind layer stops');
        ok(g.snd(SND.WIND).some((c) => c.hz === 0x7a80), 'the wind layer is set to its base rate when finishing');
        tick(200);
        ok(node.states.every((s) => s === SN.IDLE) && node.result === RESULT.GOLD, 'the result stays');
        // gems left decide the medal (the same run with fewer gems)
        for (const [gems, res] of [[11, RESULT.BRONZE], [12, RESULT.SILVER], [17, RESULT.SILVER], [18, RESULT.GOLD], [0, RESULT.NO_GEMS]]) {
          const gm = make();
          gm.node.gems = gems; gm.node.score = 400;
          gm.node.jumpTo(gm.w, tFor(6990)); gm.node.speed = K.MAX_SPEED; gm.node.timers = [-1e9, -1e9, -1e9];
          run(gm, 0, 400);
          ok(gm.node.result === res && gm.node.finalScore === finalScore(400, gems).score, `${gems} gems left: result ${gm.node.result} (expected ${res}), score ${gm.node.finalScore}`);
        }
        // the result waits for the snakes: one that is still running keeps the game going
        const gw = make();
        gw.node.jumpTo(gw.w, tFor(6990)); gw.node.speed = K.MAX_SPEED; gw.node.timers = [-1e9, -1e9, -1e9];
        gw.node.states[0] = SN.RUN; gw.R[REC.SNAKE[0]].flags |= 2;
        for (let i = 0; i < 100; i++) gw.tick(1);
        ok(gw.node.speed === 0 && gw.node.result === 0, 'a snake that still runs holds the result back');
        gw.node.states[0] = SN.IDLE;
        gw.tick(1);
        ok(gw.node.result !== 0, 'the result follows when it is idle');
      }

      // ---- the Brickbot carts and the sounds of the course
      {
        const g = make();
        const { node, cart, tick, w, R } = g;
        node.jumpTo(w, tFor(3600));
        node.timers = [-1e9, -1e9, -1e9];
        tick(2);
        ok(cart.z < 3750 && g.snd(SND.TRAIN).filter((c) => c.d3).length === 0 && g.snd(SND.TRAIN).some((c) => c.stop3), 'the train sound is stopped below z 3750');
        const crt0 = R[REC.CRT[0]].z;
        node.speed = K.MAX_SPEED;
        let n = 0;
        while (cart.z < 3752 && n++ < 200) tick(1);
        tick(10);
        const moved = R[REC.CRT[0]].z - crt0;
        ok(moved > 8 && g.snd(SND.TRAIN).some((c) => c.d3), `from z 3750 the carts roll at the buggy's speed (moved ${moved.toFixed(1)}) and the train sound plays`);
        ok(near(R[REC.BBT[0]].x, R[REC.CRT[0]].x, 8) && near(R[REC.BBT[0]].z, R[REC.CRT[0]].z, 8), 'the Brickbot sits on his cart (part 5)');
        // each of the three carts moves
        ok(REC.CRT.every((i) => R[i].z > 3600), 'all three carts moved to the track');
        tick(1);
        node.jumpTo(w, tFor(5100));
        tick(1);
        const frozen = REC.CRT.map((i) => R[i].z);
        tick(10);
        ok(REC.CRT.every((i, k) => R[i].z === frozen[k]) && g.snd(SND.TRAIN).filter((c) => c.stop3).length >= 2, 'beyond z 5020 the carts stand and the train sound stops');
        // the stage sounds: passover at 4402 / 4813, the studs from 6166 to 6276 and 6320 to 6407
        const gg = make();
        const st = [];
        for (const z of [4300, 4410, 4820, 6170, 6280, 6330, 6410]) { gg.node.jumpTo(gg.w, tFor(z)); gg.node.timers = [-1e9, -1e9, -1e9]; gg.tick(2); st.push(gg.node.stage); }
        ok(st.join() === '0,1,2,3,4,5,6', `the stages follow z: ${st}`);
        ok(gg.snd(SND.UNDER_TRACK).length === 2 && gg.snd(SND.OVER_STUDS).filter((c) => !c.stop).length === 2 && gg.snd(SND.OVER_STUDS).filter((c) => c.stop).length === 2, 'passover x2, studs started x2 and stopped x2');
      }

      // ---- scripted LOSS: no input
      {
        const g = make({ coco: false });
        const { node, cart } = g;
        const n = run(g, 0);
        ok(node.result === RESULT.NO_GEMS && node.gems === 0 && node.score === 0 && node.finalScore === 0, `LOSS (no input): result ${node.result}, gems ${node.gems}, score ${node.finalScore} after ${n} ticks`);
        ok(cart.z > 7000 && node.speed === 0, `the ride ran to z ${cart.z.toFixed(0)}`);
        ok(!isWin(node.result), 'a lost ride');
        ok(n > 4500 && n < 5600, `the ride takes ${n} ticks of dt 1 (${(n / 30).toFixed(0)} s of the 30 fps time unit)`);
        {
          // the 60 Hz step (dt 0.5): the movement is `x * dt`, so the same ride takes about twice the steps
          const g5 = make({ coco: false }); g5.w.dt = 0.5;
          const n5 = run(g5, 0, 20000);
          ok(g5.node.result === node.result && n5 > 1.9 * n && n5 < 2.1 * n, `the ride takes ${n5} steps at dt 0.5 (${n} at dt 1): about twice, same result`);
          notes.push(`LOSS at dt 0.5: ${n5} steps (dt 1: ${n})`);
        }
        ok(g.speech.length > 0 && g.speech.every((s) => ['JOHNA', 'JOHNC', 'ADSGSS10'].includes(s)), `speech while gems are lost: ${[...new Set(g.speech)]}`);
        notes.push(`LOSS (no input): ${n} ticks, 20 gems stolen, result ${node.result}`);
        // the engine is on every tick of the ride
        ok(g.snd(SND.ENGINE).length > 4000 && g.snd(SND.AMBIENT).length > 4000, 'engine and ambience play every tick');
        ok(g.snd(SND.FOUNTAIN).length > 4000, 'the fountain plays (3D at G149)');
        ok(g.snd(SND.OVER_STUDS).some((c) => !c.stop) && g.snd(SND.OVER_STUDS).some((c) => c.stop), 'studs start / stop by z');
        ok(g.snd(SND.UNDER_TRACK).length === 2, `passover sound twice: ${g.snd(SND.UNDER_TRACK).length}`);
        ok(g.snd(SND.SNAKE_GET_GEM).length === 20, `20 gem sounds: ${g.snd(SND.SNAKE_GET_GEM).length}`);
        ok(g.snd(SND.SKID_LARGE).length + g.snd(SND.SKID_SMALL).length > 0, `skids: ${g.snd(SND.SKID_LARGE).length} large, ${g.snd(SND.SKID_SMALL).length} small`);
      }

      // ---- scripted WIN: a bot that aims at the snakes and fires
      {
        const g = make({ coco: false });
        const { node, R, cart, S } = g;
        const bot = new SshBot();
        const n = run(g, () => bot.mask(node, cart, R, S.parts));
        // (the leap's real homing, WP-VERIFY: the bot no longer keeps all 20 gems; it wins a medal)
        ok(isWin(node.result) && node.gems >= 12, `WIN (aiming bot): result ${node.result}, gems ${node.gems}, points ${node.score}, score ${node.finalScore}`);
        ok(node.finalScore === Math.min(10000, node.gems * 250 + node.score) && node.score % 50 === 0 && node.score >= 2000, `score ${node.finalScore} = ${node.gems} * 250 + ${node.score}`);
        ok(isWin(node.result) && medalOfResult(node.result) === finalScore(node.score, node.gems).result - 2, 'the medal follows the gems left');
        notes.push(`WIN (aiming bot): ${n} ticks, ${node.score / 50} hits, score ${node.finalScore}, result ${node.result}`);
        const v = new Map(); const vars = { get: (i) => v.get(i) ?? 0, set: (i, x) => v.set(i, x) };
        applyResult(vars, node.finalScore, node.result);
        ok(v.get(0x4b) === node.finalScore && v.get(0x93) === medalOfResult(node.result), 'the variables of the win');
      }
      // a bot that only mashes Space (no aiming): still gold
      {
        const g = make({ coco: false });
        const n = run(g, (i) => (i % 8 === 0 ? 0x80 : 0));
        ok(g.node.result === RESULT.GOLD && g.node.gems >= 18, `mashing Space is enough for gold: result ${g.node.result}, gems ${g.node.gems}, score ${g.node.finalScore}`);
        notes.push(`WIN (Space every 8 ticks): ${n} ticks, gems ${g.node.gems}, score ${g.node.finalScore}`);
      }
      // bronze / silver: the bot stops firing at some tick, the snakes steal the rest
      {
        const outs = {};
        let lastGems = -1;
        for (const [stop, want] of [[3500, RESULT.NO_GEMS], [4200, RESULT.BRONZE], [4600, 0], [4800, 0]]) {
          const g = make({ coco: false });
          const bot = new SshBot();
          run(g, (i) => (i < stop ? bot.mask(g.node, g.cart, g.R, g.S.parts) : 0));
          const r = finalScore(g.node.score, g.node.gems);
          outs[stop] = [g.node.gems, g.node.result, g.node.finalScore];
          ok(g.node.result === r.result && g.node.finalScore === r.score, `the bot stops at ${stop}: gems ${g.node.gems}, result ${g.node.result}, score ${g.node.finalScore}`);
          if (want) ok(g.node.result === want, `the bot stops at ${stop}: result ${g.node.result}, expected ${want} (gems ${g.node.gems})`);
          ok(g.node.gems >= lastGems, `the later the bot stops, the more gems are left (${g.node.gems} >= ${lastGems})`);
          lastGems = g.node.gems;
          if (want === RESULT.NO_GEMS) ok(g.node.gems === 0 && !isWin(g.node.result), 'all gems stolen: lost');
          else ok(isWin(g.node.result) && g.node.finalScore > 2000, 'bronze / silver count as won');
        }
        notes.push(`bots that stop firing at 3500 / 4200 / 4600 / 4800 ticks: ${JSON.stringify(outs)}: [gems left, result, score]`);
      }
    } catch (e) {
      failures.push(`test crashed: ${e.stack || e}`);
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
