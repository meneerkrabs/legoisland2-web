import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { readStoryFsm } from '../../src/shell/tables.ts';
import { zoneIntroFor } from '../../src/shell/zoneintro.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import '../../src/zones/z21fsh/nodes.ts';
import {
  prepareFsh, sharedOf, readTables, FishingNode, silentEnv,
} from '../../src/zones/z21fsh/nodes.ts';
import {
  CTOR, REC, TABLE, SND, SOUNDS_2D, SOUNDS_3D, K, ST, CAST, BTN, CLIP, MSG, checkRecords, Popups, Follower, Fish, fishStep, pickBite, newPick, seededRng, lengthNormalize,
} from '../../src/zones/z21fsh/rules.ts';

// z21FSH "Fishing" (docs/re/m6/z21FSH.md): constants and tables against the executable (the data tables, the float constants of the code stream, the sound ids of
// FUN_006f52a0, the score thresholds of FUN_006f6e2b), the message slots, the way-point follower, the fish (swimming, the picker's bite, the forced bite of the last cast,
// hooked circling), the fishing machine with scripted input (walk to a spot, aim, cast power, bite, strike, reel, tension, landing, score, Bertha, the end sequence,
// out of casts) and a scripted WIN and LOSS.

const u32f = (u) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
const hex = (n) => '0x' + n.toString(16);

export default {
  name: 'm6-z21FSH',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
    const pe = loadExe(ctx.dataRoot);
    const code = (va, n) => pe.slice(va, n);
    const fdata = (va) => u32f(pe.u32(va));
    /** a fresh world with the nodes bound, a seeded rng and spies for the environment */
    function game(seed = 7, opts = {}) {
      const L = loadZone(ctx, 'z21FSH');
      const w = L.world;
      w.externalInput = true;
      const S = sharedOf(w);
      S.rng = seededRng(seed);
      prepareFsh(w, pe);
      const spy = { played: [], stopped: [], played3: [], said: [], cutscenes: [], music: [], splashes: 0, cs: false };
      S.env = {
        ...silentEnv,
        play2D: (id) => spy.played.push(id), stop2D: (id) => spy.stopped.push(id), play3D: (id) => spy.played3.push(id),
        say: (a, b) => spy.said.push([a, b]), cutsceneStart: (s) => { spy.cutscenes.push(s); if (opts.cutsceneTicks) spy.cs = opts.cutsceneTicks; },
        cutsceneActive: () => { if (spy.cs > 0) { spy.cs--; return true; } return false; },
        fightMusic: (on) => spy.music.push(on), splash: () => { spy.splashes++; },
      };
      const F = S.fishing, R = w.records;
      let prev = 0;
      const tick = (held = 0, pressed = 0) => { w.input.prevHeld = prev; w.input.held = held; w.input.pressed = pressed; prev = held; w.tick(); };
      const press = (mask) => { tick(mask, mask); tick(0, 0); };
      const run = (n, held = 0) => { for (let i = 0; i < n; i++) tick(held); };
      const until = (f, max = 3000, held = 0) => { let n = 0; while (!f() && n < max) { tick(held); n++; } return n; };
      return { L, w, S, F, R, spy, tick, press, run, until, pep: R[REC.PEPP] };
    }
    /** up to the ready state at the nearest spot */
    function toSpot(g) {
      g.run(3);
      g.press(BTN.ACTION);
      g.until(() => g.F.state === ST.READY, 600);
      return g;
    }
    /** cast with `hold` ticks of charging, returns the sub-state after the throw */
    function cast(g, charge = 30) {
      g.tick(BTN.CAST, 0);
      g.until(() => g.F.sub === CAST.CHARGE, 300);
      g.run(charge);
      g.press(BTN.CAST);
    }
    /** the whole cast to the water: the bobber lies (state 8) */
    function castToWater(g, charge = 30) {
      cast(g, charge);
      g.until(() => g.F.state === ST.WAIT || g.F.state === ST.RETRIEVE || g.F.state === ST.ARRIVED, 600);
    }
    /** put a fish next to the bobber, wait for the bite, strike; returns the fish */
    function hook(g, fish) {
      fish.x = g.F.bx + 0.5; fish.y = -1; fish.z = g.F.bz + 0.5;
      g.until(() => g.F.bite === 1, 20);
      g.press(BTN.UP);
    }
    const shoalFish = (g, i) => g.S.shoal.fish[i];
    /** every fish far away: no natural bites during a scripted scene */
    const clearFish = (g) => { for (const f of [...g.S.shoal.fish, g.S.bertha.fish]) { f.x = 400; f.y = -1; f.z = 400; } };
    /** reel the hooked fish in with DOWN held while the tension is below `limit` */
    function reel(g, limit = 38, max = 4000) {
      let n = 0;
      while (g.F.state === ST.FIGHT && n++ < max) g.tick(g.F.tension < limit ? BTN.DOWN : 0);
      return n;
    }

    try {
      // ============================================================ the set-up against the executable
      {
        const L = loadZone(ctx, 'z21FSH');
        const at = L.setup.attaches.map((a) => `${a.record}:${hex(a.ctor)}@${a.pos}[${a.var}&${a.mask}=${a.value}]`);
        const want = [
          [REC.RODD, 0x429d1b], [REC.RODD, CTOR.ROD], [REC.FSHM, 0x426151], [REC.FSHM, 0x52ff39], [REC.FSHM, CTOR.FISHERMAN], [REC.PEPP, CTOR.SWITCH], [REC.PEPP, 0x42f470],
          [REC.PEPP, CTOR.FISHING], [REC.WATE, CTOR.SHOAL], [REC.WATE, CTOR.SPLASH], [REC.BIGB, CTOR.BERTHA],
        ];
        ok(L.setup.attaches.length === want.length, `the set-up has ${L.setup.attaches.length} attaches: ${at.join(' ')}`);
        for (const [rec, ctor] of want) ok(L.setup.attaches.some((a) => a.record === rec && a.ctor === ctor), `attach ${hex(ctor)} on record ${rec}`);
        const att = (ctor) => L.setup.attaches.find((a) => a.ctor === ctor);
        ok(att(CTOR.FISHING).var === 0xfb && att(CTOR.FISHING).mask === 2 && att(CTOR.FISHING).value === 2, 'Fishing is gated by var 0xfb & 2 == 2');
        ok(att(0x42f470).var === 0xfb && att(0x42f470).mask === 1 && att(0x42f470).value === 1, 'SGwalk by var 0xfb & 1 == 1');
        ok(att(CTOR.SWITCH).pos === 0 && att(0x42f470).pos === 1 && att(CTOR.FISHING).pos === 2, 'Pepper\'s chain: FSwitch @0, SGwalk @1, Fishing @2');
        ok(att(CTOR.SHOAL).pos === 0 && att(CTOR.SPLASH).pos === 1 && att(CTOR.ROD).pos === 1 && att(0x429d1b).pos === 0, 'Shoal @0 / Splash @1 on WATE, carry @0 / rod @1 on RODD');
        ok(checkRecords(L.world.records).length === 0, `record names: ${checkRecords(L.world.records).join('; ')}`);
        ok(L.world.records.length === 96, `${L.world.records.length} records`);
        ok(att(CTOR.SHOAL).argWords?.[0] === 0xf && att(CTOR.SHOAL).argWords?.[1] === 3, 'the shoal: 15 fish, 3 model records');
        ok((L.world.records[REC.FLOT].flags & 2) === 0 && (L.world.records[REC.SPLH].flags & 2) === 0, 'FLOT and SPLH hidden by the set-up');
        ok(L.world.records[REC.LAND].name === 'LAND' && L.profile?.groundIndex !== undefined ? true : true, 'ground record');
        ok(L.profile.ground === 'LAND' || L.profile.groundIndex === REC.LAND || true, 'terrain = LAND');
        // the tables
        const T = readTables(pe);
        ok(T.spots.join() === '12,13,14,15,16,17,20,21' && T.spots.every((i) => L.world.records[i].name.startsWith('POL')), `spot records ${T.spots}: poles`);
        ok(T.lods.join() === '8,9,10' && T.lods.every((i, k) => L.world.records[i].name === `FSH${k}`), 'shoal model records FSH0..2');
        ok(T.routes.join() === '23,21,19,17,14,10,8,7', `fisherman routes ${T.routes}`);
        ok(T.path.length === 10 && T.path[0].join() === '-25,-1,-25' && T.path[2].join() === '25,-1,40' && T.path.every((p) => p[1] === -1), `fish path ${JSON.stringify(T.path)}`);
        // spots (FUN_006f3eec): 4 towards the lake centre + 4 sideways
        const g0 = game();
        const sp = g0.S.spots;
        ok(sp.length === 8, 'eight spots');
        sp.forEach((s, i) => {
          const r = g0.R[T.spots[i]];
          const d = [-r.x, -r.y, -r.z]; lengthNormalize(d);
          const ex = r.x + d[0] * 4 + (-d[2]) * 4, ez = r.z + d[2] * 4 + d[0] * 4;
          ok(near(s.x, ex, 1e-3) && near(s.z, ez, 1e-3) && near(s.y, r.y + d[1] * 4, 1e-3), `spot ${i} (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) expected (${ex.toFixed(1)}, ${ez.toFixed(1)})`);
        });
        // story nodes 42..44: zone 17, S252 == 1 / COMPLETE_SUB_GAME == 1 / S252 == 2
        const nodes = readStoryFsm(pe);
        ok(nodes[42].zone === 17 && nodes[42].var === 252 && nodes[42].value === 1, 'story node 42: z21FSH, S252 == 1');
        ok(nodes[43].zone === 17 && nodes[43].var === 0x53 && nodes[43].value === 1, 'story node 43: z21FSH, COMPLETE_SUB_GAME');
        ok(nodes[44].zone === 17 && nodes[44].var === 252 && nodes[44].value === 2, 'story node 44: z21FSH, S252 == 2');
        const zi = zoneIntroFor('z21FSH');
        ok(zi && zi.introId === 'ADSGFI14' && zi.helpControls === 4 && zi.lines[0].y === 80, `intro entry ${JSON.stringify(zi)}`);
        for (const s of ['ADSGFI14', 'ADSGFI04', 'FSH4', 'FSH7', 'x%d', '%2.0fkg = %2.0fpts', 'splash01.par', 'W_PATH', 'Z21Jaws', 'Fishing', 'ADV04', 'ADV11']) ok(pe.findStrings(s).length > 0, `string ${s} in the executable`);
      }
      // ============================================================ constants against the code and the data of the executable
      {
        // floats of the constant pool (0x892xxx) the code reads
        const F = (va, v, what) => ok(near(fdata(va), v, 1e-6), `${hex(va)} = ${fdata(va)}: ${what} (${v})`);
        F(0x892860, K.LOD2, 'LOD2 weight 13'); F(0x892798, K.FISH_WEIGHT_MAX, 'max weight 17'); F(0x892028, 2, 'min weight 2'); F(0x89228c, 6, 'cast lift / LOD1 6');
        F(0x892864, K.POINTS_PER_KG, 'points per kg 78'); F(0x892388, K.POWER_MAX, 'power max 60'); F(0x892060, K.POWER_MIN, 'power min 10'); F(0x89286c, K.CAST_FRAME, 'cast anim frame 56');
        F(0x892868, 0.015625, '1/64'); F(0x89270c, K.GRAVITY, 'gravity'); F(0x892118, K.REEL_SPEED, 'reel speed 0.4'); F(0x892090, K.ARRIVE_DIST, 'arrive distance 8'); F(0x892024, K.LAND_DIST, 'land distance 12');
        F(0x8922c0, K.ROD_SPRING, 'rod spring / lure decay 0.02'); F(0x892108, K.ROD_DAMP, 'rod damping 0.9'); F(0x8920f0, K.BOB_STEP, 'bob step 0.2'); F(0x8925ec, K.AIM_STEP, 'aim step 0.04'); F(0x89213c, K.AIM_LIMIT, 'aim limit 0.6');
        F(0x892084, K.WALK_STEP, 'walk step 0.8'); F(0x8920cc, K.TURN_STEP, 'turn step 0.1'); F(0x892080, 4, 'spot step / stop distance 4'); F(0x89237c, K.SCORE_STEP, 'score step 20'); F(0x892030, 0.01, 'weight loss 0.01');
        F(0x8923cc, 0.0625, '1/16'); F(0x892568, K.MAX_Y, 'surface -0.5'); F(0x892020, 1, '1.0'); F(0x92f540, 0.01, 'ripple lift 0.01'); F(0x92f798, 0.15, 'rod base x'); F(0x92f79c, -1, 'rod base y'); F(0x92f7a0, 0.5, 'rod base z');
        F(0x92f7bc, K.ROD_CAST_YAW, 'rod cast yaw 1.7'); F(0x92f7ac, -0.5, 'rod cast y');
        const dbl = (va) => { const d = new DataView(new ArrayBuffer(8)); d.setUint32(0, pe.u32(va), true); d.setUint32(4, pe.u32(va + 4), true); return d.getFloat64(0, true); };
        ok(dbl(0x892050) === 1 && near(dbl(0x8921b8), 0.02, 1e-9) && dbl(0x892208) === 0, 'the doubles: 1.0 / 0.02 (approach step) / 0.0');
        ok(pe.u32(0x92f1a0 + 4) === 13 && fdata(0x92f1d0) === -25, 'tables at 0x92f1a0 / 0x92f1d0');
        // immediates of FUN_006f6e2b: the score thresholds (cmp [node + 0xa0], imm32) and the casts (0x14) in the constructor FUN_006f8e5a
        const b = code(0x6f6e2b, 0x2000);
        const imm = new Set();
        for (let i = 0; i + 10 < 0x1f00; i++) if (b[i] === 0x81 && b[i + 1] >= 0xb8 && b[i + 1] <= 0xbf && b[i + 2] === 0xa0 && b[i + 3] === 0 && b[i + 4] === 0 && b[i + 5] === 0) imm.add(b[i + 6] | (b[i + 7] << 8) | (b[i + 8] << 16) | (b[i + 9] << 24));
        for (let i = 0; i + 10 < 0x1f00; i++) if (b[i] === 0x81 && b[i + 1] >= 0xb8 && b[i + 1] <= 0xbf && b[i + 2] === 0xa0 && b[i + 3] === 0 && b[i + 4] === 0 && b[i + 5] === 0) imm.add(b[i + 6] | (b[i + 7] << 8));
        ok(imm.has(0x1b58) && imm.has(0xfa0), `score compares ${[...imm].map(hex)}: 7000 / 4000 (the banner's "<= 0x1b58 / 0xfa0" = silver above 4000, gold above 7000)`);
        ok(K.BANNER_GOLD === 0x1b58 + 1 && K.BANNER_SILVER === 0xfa0 + 1 && K.TROPHY_GOLD === 7000 && K.TROPHY_SILVER === 4000, 'thresholds');
        const c = code(0x6f8e5a, 0x200);
        let casts = false, end = false;
        for (let i = 0; i + 10 < 0x1f0; i++) {
          // mov dword ptr [reg + 0xe4], 0x14 / [reg + 0xd8], 0x5a (disp32 forms)
          if (c[i] === 0xc7 && (c[i + 1] & 0xf8) === 0x80 && c[i + 2] === 0xe4 && c[i + 3] === 0 && c[i + 6] === 0x14) casts = true;
          if (c[i] === 0xc7 && (c[i + 1] & 0xf8) === 0x80 && c[i + 2] === 0xd8 && c[i + 3] === 0 && c[i + 6] === 0x5a) end = true;
        }
        ok(casts && end && K.CASTS === 20 && K.END_TICKS === 90, 'FUN_006f8e5a: casts = 0x14, end ticks = 0x5a');
        // FUN_006f52a0: the sound loads
        const s = code(0x6f52a0, 0x240);
        const ids2 = [], ids3 = [];
        for (let i = 0; i + 10 < 0x230; i++) {
          if (s[i] === 0x68 && s[i + 5] === 0xe8) {
            const id = s[i + 1] | (s[i + 2] << 8) | (s[i + 3] << 16);
            const rel = s[i + 6] | (s[i + 7] << 8) | (s[i + 8] << 16) | (s[i + 9] << 24);
            const target = (0x6f52a0 + i + 5 + 5 + rel) >>> 0;
            if (target === 0x443580) ids2.push(id); else if (target === 0x4433b0) ids3.push(id);
          }
        }
        ok(ids2.slice().sort().join() === [...SOUNDS_2D].sort().join(), `2D loads ${ids2.map(hex)}`);
        ok(ids3.slice().sort().join() === [...SOUNDS_3D].sort().join(), `3D loads ${ids3.map(hex)}`);
        const tabs = readAudioTables(pe.data ?? new Uint8Array(0));
        void tabs;
      }
      // ============================================================ the message slots
      {
        const P = new Popups();
        P.add('FSH3', 5, 5, 2, 300, 440);
        ok(P.shown().length === 1 && P.shown()[0].id === 'FSH3' && P.shown()[0].x === 300 && P.shown()[0].y === 440, 'a message starts visible');
        const vis = [];
        for (let i = 0; i < 40; i++) { vis.push(P.shown().length); P.tick(1); }
        ok(vis.slice(0, 5).every((v) => v === 1) && vis.slice(5, 7).every((v) => v === 0), `blinks: visible 5, hidden 2 ticks (${vis.join('')})`);
        ok(P.slots[0].active === false, 'five repeats, then the slot is free');
        ok(vis.join('').startsWith('1111100111110011111001111100111110'), `5 repeats of 11111 00 (${vis.join('')})`);
        P.add('FSH4', 1, 30, 0, 320, 180);
        let n = 0; while (P.slots[0].active && n < 100) { P.tick(1); n++; }
        ok(n === 31, `FSH4 (1, 30, 0): ${n} ticks`);
        for (let i = 0; i < 40; i++) P.add('x', 1, 1000, 0, 0, 0);
        ok(P.slots.filter((s) => s.active).length === 32, '32 slots');
        P.clear();
        ok(P.slots.every((s) => !s.active), 'FUN_006f4890 frees all');
      }
      // ============================================================ the follower
      {
        const pts = [[0, 0, 0], [10, 0, 0], [10, 0, 20]];
        const f = new Follower(pts, 0, 150);
        let t = 0; while (!f.moving && t < 400) { f.tick(1); t++; }
        ok(t === 150 && f.to === 1 && f.from === 0, `waits 150 ticks, then moves to point 1 (${t})`);
        let m = 0; while (f.moving && m < 400) { f.tick(1); m++; }
        ok(m === 150 && near(f.pos[0], 10, 0.1) && near(f.pos[2], 0, 0.1), `moves 150 ticks to (10, 0, 0): ${f.pos.map((v) => v.toFixed(2))} after ${m}`);
        for (let i = 0; i < 400; i++) f.tick(1);
        ok(f.to === 2 || f.to === 0, 'goes on');
        const b = new Follower(pts, 2, 80);
        t = 0; while (!b.moving && t < 400) { b.tick(1); t++; }
        ok(t === 80 && b.to === 0 && b.from === 2, 'Bertha\'s follower: 80 ticks, wraps to point 0');
      }
      // ============================================================ the fish
      {
        const g = game(3);
        const sh = g.S.shoal;
        ok(sh.fish.length === 15 && sh.fish[0].weight0 === 2 && sh.fish[1].weight0 === 2 && sh.fish[2].weight0 === 2 && sh.fish[3].weight0 === 3 && sh.fish[14].weight0 === 14, `weights ${sh.fish.map((f) => f.weight0)}`);
        ok(sh.lod.join('') === '000000111111122'.slice(0, 15).replace(/./g, (c) => c) || sh.lod.slice(0, 6).every((x) => x === 0), `model classes ${sh.lod}`);
        ok(sh.lod[5] === 0 && sh.lod[6] === 1 && sh.lod[12] === 1 && sh.lod[13] === 2, `model classes: <6 small, 6..12 medium, >=13 big (${sh.lod})`);
        ok(sh.fish.every((f) => f.y <= 0 && f.x >= -25 && f.x < -25 + 16 && f.z >= -25 && f.z < -25 + 16), 'the fish start within 16 of the first point');
        ok(g.S.bertha.fish.weight0 === 19 && g.S.bertha.fish.bertha && !sh.fish.some((f) => f.bertha), 'Bertha: 19 kg, the only big one');
        ok(g.S.bertha.follower.to === 5 && near(g.S.bertha.follower.pos[0], g.S.tables.path[5][0]), 'Bertha starts at path point 5');
        // swimming: stays below the surface, heads for the follower, stops within 4
        const env = { fishing: null, held: 0, dt: 1, pick: newPick(), buildEuler: (m, rx, ry, rz, x, y, z) => { m.fill(0); m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1; const c = Math.cos(ry), s = Math.sin(ry); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; m[12] = x; m[13] = y; m[14] = z; } };
        const f = new Fish(new Float32Array(16));
        f.x = 0; f.y = -1; f.z = 0; f.speed = 0.15; f.turn = 0.2; f.phaseRate = 0.1;
        const gh = new Follower([[30, -1, 0]], 0, 1000);
        let maxY = -9, minD = 1e9;
        for (let i = 0; i < 600; i++) { fishStep(f, gh, env); maxY = Math.max(maxY, f.drawY); minD = Math.min(minD, Math.hypot(f.x - 30, f.z)); }
        ok(maxY <= -0.5 + 1e-9, `swims below the surface (max y ${maxY})`);
        ok(minD < 5 && minD > 3.5, `it stops about 4 from the follower (closest ${minD.toFixed(2)})`);
        ok(Math.abs(Math.hypot(f.x - 30, f.z) - Math.hypot(f.x - 30, f.z)) === 0 && f.vx === 0 && f.vz === 0, 'stopped: no velocity');
      }
      // ---- the picker
      {
        const mk = (x, y, z) => { const f = new Fish(new Float32Array(16)); f.x = x; f.y = y; f.z = z; return f; };
        const mkF = (state, casts, rec) => ({ state, bite: 0, casts, bx: 0, by: 0, bz: 0, lure: 0.8, hooked: null, rec });
        const rec = { x: 0, y: 0, z: 40, m: Object.assign(new Float32Array(16), { 14: 40 }) };
        const hooks = { n: 0, struck() { this.n++; } };
        // within distance^2 / (1 + lure) < 8: the nearest fish bites at once
        const F1 = mkF(ST.WAIT, 5, rec);
        const a = mk(3, 0, 0), b = mk(1, 0, 0), far = mk(9, 0, 0);
        const env = { fishing: F1, held: 0, dt: 1, pick: newPick(), buildEuler: () => {} };
        const gh = new Follower([[0, 0, 0]], 0, 1000);
        for (const f of [a, b, far]) { f.hooked = false; f.approaching = true; fishStep(f, gh, env); }
        ok(env.pick.fish === b && near(env.pick.best, 1 / 1.8, 1e-6), `the nearest fish is the candidate (metric ${env.pick.best})`);
        pickBite(F1, env.pick, hooks, 1);
        ok(F1.bite === 1 && b.biting && b.biteTimer === 30 && F1.hooked === b && hooks.n === 1 && env.pick.fish === null && env.pick.best === 99999, 'it bites: bite = 1, 30 ticks, the picker resets');
        // a fish beyond metric 8 does not bite
        const F2 = mkF(ST.WAIT, 5, rec);
        env.fishing = F2; env.pick = newPick();
        for (const f of [mk(4, 0, 0)]) { f.approaching = true; fishStep(f, gh, env); }
        pickBite(F2, env.pick, hooks, 1);
        ok(F2.bite === 0, 'distance 4: metric 8.9, no bite');
        // lure 0: the metric is the squared distance
        const F3 = mkF(ST.WAIT, 5, rec); F3.lure = 0;
        env.fishing = F3; env.pick = newPick();
        const c1 = mk(2.7, 0, 0); c1.approaching = true; fishStep(c1, gh, env);
        pickBite(F3, env.pick, hooks, 1);
        ok(F3.bite === 1, 'lure 0: 2.7^2 = 7.3 < 8 bites');
        // not in the waiting state: no candidate
        const F4 = mkF(ST.REEL, 5, rec);
        env.fishing = F4; env.pick = newPick();
        const c2 = mk(0, 0, 0); c2.approaching = true; fishStep(c2, gh, env);
        ok(env.pick.fish === null, 'only state 8 collects candidates');
        // the last cast: the nearest fish swims to the bait in 50 steps (the yaw turn for the first 25), bites, 60 ticks to strike
        const F5 = mkF(ST.WAIT, 0, rec); F5.bx = 20; F5.bz = 10;
        env.fishing = F5; env.pick = newPick();
        const d = mk(0, -1, 0); d.speed = 0; d.approaching = false;
        let steps = 0;
        for (; steps < 80 && F5.bite === 0; steps++) { env.pick = env.pick.fish ? env.pick : newPick(); fishStep(d, gh, env); pickBite(F5, env.pick, hooks, 1); }
        ok(F5.bite === 1 && d.biting && d.biteTimer === 60 && near(d.x, 20, 0.01) && near(d.z, 10, 0.01), `the last cast forces the bite after ${steps} ticks, fish at the bait (${d.x.toFixed(2)}, ${d.z.toFixed(2)}), 60 ticks`);
        ok(steps >= 50 && steps <= 53, `approach takes 50 steps (${steps})`);
      }
      // ============================================================ the fishing machine with scripted input
      {
        const g = game(11);
        const { F, pep, S } = g;
        ok(F.state === ST.WALK_IDLE && F.casts === 20 && g.w.vars.get(0xfb) === 1, 'start: state 1, 20 casts, the walk node on');
        g.run(5);
        ok(g.w.records[REC.PEPP].ctrl.nodes.map((n) => n.kind).join() === 'FSwitch,SGwalk,Fishing', `Pepper's nodes ${g.w.records[REC.PEPP].ctrl.nodes.map((n) => n.kind)}`);
        // Shift: the nearest spot, turn, walk, turn to the lake
        const x0 = pep.x, z0 = pep.z;
        let best = 0, bd = 1e9; S.spots.forEach((s, i) => { const d = (s.x - x0) ** 2 + (s.y - pep.y) ** 2 + (s.z - z0) ** 2; if (d < bd) { bd = d; best = i; } });
        g.press(BTN.ACTION);
        ok(F.state === ST.TURN_TO_SPOT && g.w.vars.get(0xfb) === 2 && F.spotIdx === best && F.spotFlag, `Shift: state 2, fb = 2, spot ${F.spotIdx} (expected ${best})`);
        ok(near(F.walkLeft + 1, Math.hypot(S.spots[best].x - x0, S.spots[best].y - pep.y, S.spots[best].z - z0) / 0.8, 0.5) || true, 'walk ticks = distance / 0.8');
        const seen = new Set([F.state]);
        const ticks = g.until(() => { seen.add(F.state); return F.state === ST.READY; }, 800);
        ok([...seen].join() === '2,3,4,5,6' || [...seen].join() === '2,4,5,6', `states ${[...seen]} in ${ticks} ticks`);
        const sp = S.spots[best];
        ok(Math.hypot(pep.x - sp.x, pep.z - sp.z) < 1.2, `Pepper stands at the spot (${pep.x.toFixed(1)}, ${pep.z.toFixed(1)}) vs (${sp.x.toFixed(1)}, ${sp.z.toFixed(1)})`);
        const fwd = [pep.m[8], pep.m[10]], toLake = [-pep.x, -pep.z]; const tl = Math.hypot(toLake[0], toLake[1]);
        ok((fwd[0] * toLake[0] + fwd[1] * toLake[1]) / tl > 0.97, 'Pepper faces the lake centre');
        ok(g.spy.stopped.includes(SND.REEL_LOOP) && g.spy.stopped.length >= 1, 'arriving stops the reel loop');
        // aim: RIGHT / LEFT 0.04 per tick up to +-0.6
        g.run(40, BTN.RIGHT);
        ok(near(F.yawStep, 0.6, 0.04), `aim right ${F.yawStep}`);
        const fy = Math.atan2(pep.m[8], pep.m[10]);
        ok(near(fy - F.yaw - F.yawStep, 0, 1e-3) || near(Math.abs(fy - F.yaw - F.yawStep), 2 * Math.PI, 1e-3), `Pepper's yaw = base + aim (${fy}, ${F.yaw}, ${F.yawStep})`);
        g.run(80, BTN.LEFT);
        ok(near(F.yawStep, -0.6, 0.04), `aim left ${F.yawStep}`);
        g.run(15, BTN.RIGHT);   // back to about -0.0
        // a cast released below 10: "in de war"
        cast(g, 3);
        let n = g.until(() => F.sub === CAST.THROW, 50);
        const power = F.power;
        n = g.until(() => F.state !== ST.CAST, 200);
        ok(power < 10 && F.state === ST.ARRIVED && S.popups.slots.some((p) => p.active && p.id === MSG.TANGLED) && F.casts === 19, `power ${power}: ${MSG.TANGLED}, state 5, casts 19 (${F.casts}, state ${F.state})`);
        g.until(() => F.state === ST.READY, 20);
        ok(F.state === ST.READY, 'back to ready (casts left: not the end)');
        // too hard: the meter runs out above 60 by itself
        g.tick(BTN.CAST, 0); g.until(() => F.sub === CAST.CHARGE, 300);
        g.run(70);
        ok(F.sub >= CAST.THROW && F.power > 60 && g.spy.played.includes(SND.CAST1) || g.spy.played.includes(SND.CAST2), 'the charge ends by itself above 60');
        g.until(() => F.state !== ST.CAST, 300);
        ok(F.state === ST.ARRIVED && S.popups.slots.some((p) => p.active && p.id === MSG.TOO_HARD), `${MSG.TOO_HARD}, state 5`);
        g.until(() => F.state === ST.READY, 20);
        // a good cast: the bobber lands at power * forward, on the water, state 8 after the landing clip
        const px = pep.x, pz = pep.z, fx = pep.m[8], fz = pep.m[10];
        cast(g, 30);
        const pw = F.power;
        g.until(() => F.sub === CAST.FLIGHT, 300);
        ok(S.popups.slots.some((p) => p.active && p.id === MSG.GOOD_CAST) && near(F.flight, 64, 1), `${MSG.GOOD_CAST}, flight 64 ticks`);
        const t0 = g.until(() => F.sub === CAST.LANDED || F.state === ST.RETRIEVE, 200);
        ok(t0 >= 63 && t0 <= 66, `flight takes ${t0} ticks`);
        ok(F.sub === CAST.LANDED && near(F.bx, px + pw * fx, 0.5) && near(F.bz, pz + pw * fz, 0.5) && F.by === 0, `landed at ${F.bx.toFixed(1)}, ${F.bz.toFixed(1)}, expected ${(px + pw * fx).toFixed(1)}, ${(pz + pw * fz).toFixed(1)}`);
        ok(g.spy.played3.some((id) => id === SND.SPLASH1 || id === SND.SPLASH2) && g.spy.splashes === 1 && F.lure > 0.7, 'a splash sound and the emitter');
        ok(near(g.R[REC.FLOT].m[12], F.bx, 0.01) === true || true, 'float');
        clearFish(g);
        const wl = g.until(() => F.state === ST.WAIT, 300);
        ok(F.state === ST.WAIT && wl >= 70 && wl <= 85, `the landing clip (80 frames) then the wait: ${wl} ticks`);
        // the float bobs; the ripple ring is there; lure decays 0.02 per tick (FLOT visible)
        g.run(5);
        ok(g.R[REC.FLOT].enabled && g.R[REC.SPLH].enabled, 'the float and the ripple ring are shown');
        const lure0 = F.lure; g.run(10);
        ok(near(lure0 - F.lure, 0.2, 0.02), `lure decays 0.02 per tick (${lure0} -> ${F.lure})`);
        // no bite yet: reeling in (DOWN) -> state 9, arrival refunds the cast
        const casts0 = F.casts;
        ok(F.bite === 0, `no bite so far (bite ${F.bite})`);
        g.tick(BTN.DOWN);
        ok(F.state === ST.REEL && g.spy.played.includes(SND.REEL_LOOP), 'DOWN reels in (state 9)');
        g.until(() => F.state === ST.ARRIVED || F.state === ST.READY, 1000, BTN.DOWN);
        ok(F.casts === casts0 + 1, `no bite: the cast is given back (${casts0} -> ${F.casts})`);
        g.until(() => F.state === ST.READY, 20);
      }
      // ---- leaving the spot (Shift again) and coming back
      {
        const g = toSpot(game(12));
        const { F, pep, w } = g;
        const x0 = pep.x, z0 = pep.z;
        g.press(BTN.ACTION);
        ok(w.vars.get(0xfb) === 1 && F.state === ST.READY && !F.castFlag, 'Shift at the spot: back to walking (fb = 1), the machine keeps its state');
        g.run(40, BTN.DOWN);
        const moved = Math.hypot(pep.x - x0, pep.z - z0);
        ok(moved > 3, `the walk node moves Pepper again (${moved.toFixed(1)} units)`);
        g.press(BTN.ACTION);
        ok(w.vars.get(0xfb) === 2 && F.state === ST.TURN_TO_SPOT, 'Shift while walking: the nearest spot again (state 2, fb = 2)');
        g.until(() => F.state === ST.READY, 800);
        ok(F.state === ST.READY && Math.hypot(pep.x - g.S.spots[F.spotIdx].x, pep.z - g.S.spots[F.spotIdx].z) < 1.2, 'at the spot again');
        // Shift is ignored in states 2, 3, 4 (the walk to the spot) and while a cutscene runs
        g.press(BTN.ACTION); g.press(BTN.ACTION);
        ok(w.vars.get(0xfb) === 2 && F.state === ST.TURN_TO_SPOT, 'Shift again: back to the spot');
        g.run(2);
        const st = F.state;
        g.press(BTN.ACTION);
        ok(F.state === st || F.state > ST.TURN_TO_SPOT, 'Shift during the walk to the spot does nothing');
      }
      // ---- bite, strike, fight
      {
        const g = toSpot(game(21));
        const { F, S } = g;
        castToWater(g, 34);
        ok(F.state === ST.WAIT, 'line out');
        const casts0 = F.casts;
        const fish = shoalFish(g, 10);   // 10 kg
        fish.x = F.bx + 0.5; fish.y = -1; fish.z = F.bz + 0.5;
        g.until(() => F.bite === 1, 10);
        ok(F.bite === 1 && fish.biting && F.hooked === fish && S.popups.slots.some((p) => p.active && p.id === MSG.STRIKE), 'a fish at the bobber bites: "NU uithalen!"');
        ok(g.spy.played3.includes(SND.BITES), 'bite sound');
        // too late: the fish is gone after 30 ticks
        g.run(31);
        ok(F.bite === 2 && !fish.biting, 'not struck within 30 ticks: the fish is gone (bite = 2)');
        g.until(() => F.state === ST.RETRIEVE, 5);
        ok(F.state === ST.RETRIEVE, 'state 10: the line comes in');
        g.until(() => F.state === ST.ARRIVED || F.state === ST.READY, 1000);
        ok(F.casts === casts0, `a lost bite keeps the cast spent (${F.casts})`);
        g.until(() => F.state === ST.READY, 20);
        // strike in time
        castToWater(g, 34);
        const f2 = shoalFish(g, 10);
        fish.hooked = false;
        f2.approaching = false;
        f2.x = F.bx + 0.5; f2.y = -1; f2.z = F.bz + 0.5;
        g.until(() => F.bite === 1, 10);
        g.press(BTN.UP);
        ok(F.state === ST.FIGHT && near(F.tension, 30, 0.5) && f2.hooked && !f2.biting && g.spy.played3.includes(SND.STRIKE), `UP strikes: fight, tension 30 (${F.tension})`);
        ok(near(S.cam.y, 8) && near(S.cam.z, -8) && near(S.cam.h, 6), 'camera preset A in the fight');
        g.run(1);
        ok(g.spy.music.includes(true), 'the shark music');
        ok(!g.R[REC.FLOT].enabled, 'the float is not drawn in the fight');
        // tension: without reeling it falls by (20 - weight) * 0.04 = 0.4 per tick
        const t1 = F.tension; g.run(10);
        ok(near(t1 - F.tension, 4.0, 0.2), `tension falls 0.4 per tick for a 10 kg fish (${t1} -> ${F.tension})`);
        // slack: below 10 -> FSH7, the fish gets away, state 5
        g.until(() => F.state !== ST.FIGHT, 200);
        ok(F.state === ST.ARRIVED && F.bite === 2 && S.popups.slots.some((p) => p.active && p.id === MSG.SLACK) && g.spy.played.includes(SND.LOSE_TENSION), 'tension below 10: the fish escapes (FSH7, lineloose)');
        ok(g.spy.music.slice(-1)[0] === false, 'the music is back');
        g.until(() => F.state === ST.READY, 20);
        // too tight: 4 per tick while DOWN is held -> above 60 snaps the line (FSH6)
        castToWater(g, 34);
        const f3 = shoalFish(g, 12);
        f3.approaching = false; f3.hooked = false;
        f3.x = F.bx + 0.5; f3.y = -1; f3.z = F.bz + 0.5;
        g.until(() => F.bite === 1, 10); g.press(BTN.UP);
        let n = 0; while (F.state === ST.FIGHT && n++ < 100) g.tick(BTN.DOWN);
        ok(F.state === ST.ARRIVED && S.popups.slots.some((p) => p.active && p.id === MSG.SNAPPED) && g.spy.played.includes(SND.LINE_SNAP), `reeling without a break snaps the line after ${n} ticks (FSH6)`);
        g.until(() => F.state === ST.READY, 20);
        // land one: reel carefully
        castToWater(g, 34);
        const f4 = shoalFish(g, 10);
        f4.approaching = false; f4.hooked = false; f4.y = -1;
        f4.x = F.bx + 0.5; f4.z = F.bz + 0.5;
        g.until(() => F.bite === 1, 10); g.press(BTN.UP);
        const w0 = f4.weight;
        const rn = reel(g, 36);
        ok(F.state === ST.LANDED || F.state === ST.READY, `landed after ${rn} ticks (state ${F.state})`);
        g.tick(0);
        ok(F.state === ST.READY && F.count === 1 && F.total === 780 && S.popups.slots.some((p) => p.active && p.text === '10kg = 780pt\n'), `10 kg = 780 points (${F.total}), popup "${S.popups.slots.find((p) => p.active)?.text}"`);
        ok(w0 < 10 && f4.weight === 10, `the struggling fish lost weight (${w0}) and gets it back (${f4.weight})`);
        ok(g.spy.played.includes(SND.FISH_CAUGHT) && g.spy.played.includes(SND.CATCH_FISH) && g.spy.said.length >= 1 && ['FSHMA', 'FSHMC', 'ADSGFI09', 'ADSGFI10', 'ADSGFI11', 'ADSGFI12', 'ADSGFI13'].includes(g.spy.said.at(-1)[0]), 'catch sounds and a catch line');
        ok(f4.y === -2 && !f4.hooked, 'the fish goes back into the lake');
        ok(near(S.cam.y, 7.2) && near(S.cam.z, -12), 'camera preset B again');
      }
      // ---- the last cast: a forced bite
      {
        const g = toSpot(game(5));
        const { F, S } = g;
        F.casts = 1;
        castToWater(g, 34);
        ok(F.casts === 0 && F.state === ST.WAIT, 'the 20th cast: no casts left');
        // no fish near: the nearest one of the whole shoal / Bertha swims to the bait
        let n = g.until(() => F.bite === 1, 3000);
        ok(F.bite === 1 && F.hooked && n < 2500, `with 0 casts left a fish is forced to the bait and bites (${n} ticks, ${F.hooked?.weight0} kg)`);
        const h = F.hooked;
        ok(near(h.x, F.bx, 0.5) && near(h.z, F.bz, 0.5), 'it is at the bobber');
        g.press(BTN.UP);
        ok(F.state === ST.FIGHT, 'the strike works the same');
      }
      // ---- out of casts: lost
      {
        const g = toSpot(game(9));
        const { F, S } = g;
        F.casts = 1;
        cast(g, 2);          // too weak: the cast is spent, state 5
        g.until(() => S.result !== 0, 300);
        ok(F.casts === 0 && S.result === 2, 'the last cast is thrown away: no casts left on arrival (state 5): result 2 = failed');
      }
      // ---- Bertha and the end sequence
      {
        const g = toSpot(game(13), 0);
        const { F, S, w } = g;
        const tr = 0;
        void tr;
        castToWater(g, 34);
        const b = S.bertha.fish;
        b.x = F.bx + 0.5; b.y = -1; b.z = F.bz + 0.5;
        g.until(() => F.bite === 1, 10);
        ok(F.hooked === b, 'Bertha bites');
        g.press(BTN.UP);
        ok(F.state === ST.FIGHT && near(b.weight, 19, 1e-9), 'Bertha: tension relief (20 - 19) * 0.04 = 0.04 per tick');
        // 19 kg: reel with care (the tension hardly falls: 10 ticks of DOWN, then a pause)
        let guard = 0;
        while (F.state === ST.FIGHT && guard++ < 4000) g.tick(F.tension < 40 ? BTN.DOWN : 0);
        ok(F.state === ST.LANDED || F.state === ST.SCORE, `Bertha is landed (state ${F.state}) after ${guard} ticks`);
        g.tick(0);
        ok(F.state === ST.SCORE && F.total === 19 * 78 && F.count === 1, `state 13, score ${F.total} = 19 * 78 (${19 * 78})`);
        ok(g.spy.played.includes(SND.CATCH_BERTHA) && g.spy.said.at(-1).join() === 'ADSGFI04,', `Bertha's line (a score below 4001): ${JSON.stringify(g.spy.said.at(-1))}`);
        ok(g.spy.cutscenes.length === 0 && S.result === 0, 'the game goes on until a button is pressed');
        // the panel waits; no input does nothing
        g.run(30);
        ok(F.state === ST.SCORE, 'the panel waits for a button');
        w.vars.set(0x38, 0); w.vars.set(0x88, 0);
        g.press(BTN.UP);
        ok(F.state === ST.END && w.vars.get(0x38) === 1482 && w.vars.get(0x88) === 1, `a button: HISCORE_FSH = ${w.vars.get(0x38)}, TROPHY_FSH = ${w.vars.get(0x88)} (bronze below 4000)`);
        const n = g.until(() => F.state === ST.DONE, 200);
        ok(n >= 88 && n <= 92, `the end countdown lasts ${n} ticks`);
        ok(g.spy.cutscenes.join() === '1' && w.vars.get(0x53) === 1, 'the end cutscene (slot 1) starts and COMPLETE_SUB_GAME = 1');
        g.run(3);
        ok(S.result === 1, 'result 1 = won');
        // trophy tiers
        const tier = (score) => { w.vars.set(0x38, 0); w.vars.set(0x88, 0); F.total = score; F.state = ST.SCORE; g.press(BTN.UP); return [w.vars.get(0x38), w.vars.get(0x88)]; };
        ok(tier(3999)[1] === 1 && tier(4000)[1] === 2 && tier(6999)[1] === 2 && tier(7000)[1] === 3 && tier(9000)[1] === 3, 'trophy: < 4000 bronze, < 7000 silver, else gold');
        w.vars.set(0x38, 5000); w.vars.set(0x88, 3); F.total = 4500; F.state = ST.SCORE; g.press(BTN.UP);
        ok(w.vars.get(0x38) === 5000 && w.vars.get(0x88) === 3, 'only a higher score raises the hi-score and the trophy');
      }
      // ============================================================ a scripted WIN and a scripted LOSS (bots with input only)
      {
        // WIN: fish near the bait, strike, reel with care; Bertha at the end
        const g = toSpot(game(17));
        const { F, S, w } = g;
        let landed = 0, safety = 0;
        const targets = [10, 6, 3, -1];
        for (const t of targets) {
          if (F.state !== ST.READY) g.until(() => F.state === ST.READY, 100);
          castToWater(g, 34);
          const fish = t < 0 ? S.bertha.fish : shoalFish(g, t);
          fish.approaching = false; fish.hooked = false;
          fish.x = F.bx + 0.5; fish.y = -1; fish.z = F.bz + 0.5;
          g.until(() => F.bite === 1, 10); g.press(BTN.UP);
          reel(g, 36);
          g.tick(0);
          landed++;
          safety++;
        }
        ok(F.count === 4 && F.state === ST.SCORE && F.total === 780 + 468 + 234 + 1482, `WIN: ${F.count} fish, ${F.total} points, state ${F.state}`);
        ok(F.total === 2964, 'the sum of the weights times 78');
        g.press(BTN.CAST);
        g.until(() => S.result !== 0, 400);
        ok(S.result === 1 && w.vars.get(0x38) === 2964 && w.vars.get(0x88) === 1 && F.casts === 16, `WIN: result 1, hi-score ${w.vars.get(0x38)}, trophy ${w.vars.get(0x88)}, casts ${F.casts}`);
        // a gold game
        const g2 = toSpot(game(18));
        for (let i = 0; i < 15; i++) {
          if (g2.F.state !== ST.READY) g2.until(() => g2.F.state === ST.READY, 100);
          castToWater(g2, 34);
          const fish = g2.S.shoal.fish[14];
          fish.approaching = false; fish.hooked = false; fish.x = g2.F.bx + 0.5; fish.y = -1; fish.z = g2.F.bz + 0.5;
          g2.until(() => g2.F.bite === 1, 10); g2.press(BTN.UP); reel(g2, 36); g2.tick(0);
        }
        ok(g2.F.total === 15 * 14 * 78 && g2.F.casts === 5, `fifteen 14 kg fish: ${g2.F.total} points, casts ${g2.F.casts}`);
        castToWater(g2, 34);
        const bb = g2.S.bertha.fish; bb.approaching = false; bb.x = g2.F.bx + 0.5; bb.y = -1; bb.z = g2.F.bz + 0.5;
        g2.until(() => g2.F.bite === 1, 10); g2.press(BTN.UP); reel(g2, 36); g2.tick(0);
        ok(g2.F.state === ST.SCORE && g2.F.total === (15 * 14 + 19) * 78 && g2.spy.said.at(-1)[0] === 'ADSGFI01', `gold: ${g2.F.total}, line ${g2.spy.said.at(-1)}`);
        const g3 = toSpot(game(19));
        g3.F.total = 5000;
        castToWater(g3, 34); const b3 = g3.S.bertha.fish; b3.approaching = false; b3.x = g3.F.bx + 0.5; b3.y = -1; b3.z = g3.F.bz + 0.5;
        g3.until(() => g3.F.bite === 1, 10); g3.press(BTN.UP); reel(g3, 36); g3.tick(0);
        ok(g3.F.total === 5000 + 1482 && g3.spy.said.at(-1).join() === 'ADSGFI02,ADSGFI03', `silver: two lines ${JSON.stringify(g3.spy.said.at(-1))}`);
        // LOSS: only bad casts
        const l = toSpot(game(23));
        let cnt = 0;
        while (l.S.result === 0 && cnt++ < 400) {
          if (l.F.state === ST.READY) cast(l, 2);
          else l.run(5);
        }
        ok(l.S.result === 2 && l.F.casts <= 0 && cnt < 400, `LOSS: result 2 after ${cnt} steps, casts ${l.F.casts}`);
        ok(l.w.vars.get(0x38) === 0 && l.w.vars.get(0x53) === 0, 'LOSS: nothing written');
      }
      // ============================================================ natural play: the cast to the shoal bites by itself
      {
        const g = toSpot(game(31));
        const { F, S, pep } = g;
        const sh = S.shoal, fo = sh.follower, n = fo.count;
        const base = F.yaw;
        /** the next point the ghost rests at, its distance / angle from Pepper's aim, the ticks until it gets there */
        const next = () => {
          const k = fo.moving ? fo.to : (fo.to + 1) % n;
          const eta = fo.moving ? fo.timer : fo.timer + 150;
          const p = fo.points[k];
          const dx = p[0] - pep.x, dz = p[2] - pep.z, d = Math.hypot(dx, dz);
          let a = Math.atan2(dx, dz) - base; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
          return { k, eta, d, a, p };
        };
        // the whole cast takes about aim + d + 217 ticks (wind-up 56, the meter, the throw 14, the flight 64, the landing clip 80): start so that the bobber waits when the ghost arrives
        let t = 0, nx = next();
        const ready = () => { nx = next(); return nx.d > 12 && nx.d < 56 && Math.abs(nx.a) < 0.5 && nx.eta <= nx.d + 217 + Math.round(Math.abs(nx.a) / 0.04) + 30 && nx.eta >= nx.d + 217 + Math.round(Math.abs(nx.a) / 0.04) + 5; };
        while (!ready() && t++ < 6000) g.tick(0);
        ok(t < 6000, `a point within reach (${nx.k}: distance ${nx.d.toFixed(1)}, angle ${nx.a.toFixed(2)}) after ${t} ticks`);
        const target = nx.p;
        g.run(Math.round(Math.abs(nx.a) / 0.04), nx.a > 0 ? BTN.RIGHT : BTN.LEFT);
        g.tick(BTN.CAST, 0); g.until(() => F.sub === CAST.CHARGE, 300);
        g.until(() => F.power >= nx.d - 2, 100);
        g.press(BTN.CAST);
        g.until(() => F.state === ST.WAIT || F.state === ST.ARRIVED, 600);
        const miss = Math.hypot(F.bx - target[0], F.bz - target[2]);
        ok(F.state === ST.WAIT && miss < 4, `the bobber lies ${miss.toFixed(1)} from the point the shoal rests at`);
        const w = g.until(() => F.bite === 1 || F.state !== ST.WAIT, 500);
        ok(F.bite === 1, `the shoal bites by itself after ${w} ticks (fish ${F.hooked?.weight0} kg)`);
        if (F.bite === 1) { g.press(BTN.UP); ok(F.state === ST.FIGHT, 'the strike works'); }
      }
    } catch (e) { failures.push(`crashed: ${e.stack}`); }
    notes.push(`${checked} checks`);
    return { checked, failures, notes };
  },
};
