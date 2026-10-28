import { readExeSoundTable } from '../../src/formats/sound.ts';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { prepareWorld, lcg, snapshot, CTOR, MODEL_RECORDS } from '../../src/zones/z41MAP/nodes.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import {
  SND, readTables, SLOT_POS, CITIZEN_CLIPS, CAM_LOOK, CAM_EYE, TOPPINGS_PER_ROUND, ROUNDS, medalOfScore, finishScore, VAR_TROPHY_MAP, VAR_HISCORE_MAP,
  PICKS, HAND_ROT_Z, HAND_OFFSET, TOPPING_HAND_OFFSET, GAUGE_START, GAUGE_DECAY,
} from '../../src/zones/z41MAP/rules.ts';
import { Bot, KEY } from '../lib/z41map-bot.mjs';

// z41MAP "Pizza making" (docs/re/m3/z41MAP.md): table checks against the executable, the medal / trophy rules of FUN_00812dbb, the node logic of Papa, Pepper,
// the toppings, the citizens, the camera, and scripted games: a WIN (all five pizzas, a medal, the trophy written) and a LOSS (every topping wrong, no medal).

const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;

export default {
  name: 'm3-z41MAP',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);

    // ---------------------------------------------------------------- tables of the executable
    const T = readTables(pe);
    ok(JSON.stringify(T.perRound) === JSON.stringify([...TOPPINGS_PER_ROUND, 0]), `toppings per round (0x955bd8): ${T.perRound}`);
    ok(ROUNDS === 5, 'five rounds');
    ok(T.slotPos.every((p, i) => p.every((v, k) => near(v, SLOT_POS[i][k]))), `citizen queue slots (0x955e00): ${JSON.stringify(T.slotPos)}`);
    ok(JSON.stringify(T.citizenClips) === JSON.stringify([...CITIZEN_CLIPS]), `citizen clip table (0x955d58): ${T.citizenClips}`);
    ok(T.camLook.every((p, i) => p.every((v, k) => near(v, CAM_LOOK[i][k]))), `camera look-at table (0x9560a8): ${JSON.stringify(T.camLook)}`);
    ok(T.camEye.every((p, i) => p.every((v, k) => near(v, CAM_EYE[i][k]))), `camera eye table (0x9560c0): ${JSON.stringify(T.camEye)}`);
    ok(near(T.hand[0], HAND_OFFSET[0]) && near(T.hand[1], HAND_OFFSET[1]) && near(T.hand[2], HAND_OFFSET[2]) && near(T.hand[3], HAND_ROT_Z), `Papa's hand offset (0x955bf0): ${T.hand}`);
    ok(T.toppingHand.every((v, k) => near(v, TOPPING_HAND_OFFSET[k])), `topping-in-hand offset (0x955fc8): ${T.toppingHand}`);
    // the bytes of FUN_00812dbb: thresholds and the two game variables
    {
      const fn = pe.slice(0x812dbb, 0xd0);
      const hasU32 = (v) => { for (let i = 0; i + 4 <= fn.length; i++) if ((fn[i] | (fn[i + 1] << 8) | (fn[i + 2] << 16) | (fn[i + 3] << 24)) >>> 0 === v) return true; return false; };
      // the compiler wrote `score > 0x1d4c`, `> 0x1388`, `> 0x9c4` (cmp dword [ebp+8], imm32; jle): the same as `< 0x1d4d` ... (bronze from 2501)
      ok(hasU32(0x1d4c) && hasU32(0x1388) && hasU32(0x9c4), 'medal thresholds (> 0x9c4 / 0x1388 / 0x1d4c = 2501 / 5001 / 7501) in FUN_00812dbb');
      ok(hasU32(VAR_HISCORE_MAP) && fn.includes(VAR_TROPHY_MAP), 'game variables 0x3f / 0xda in FUN_00812dbb');
      const vars = (() => { const g = loadZone(ctx, 'z41MAP', { subgame: 28 }); return g.world.vars; })();
      ok(vars.nameOf(VAR_TROPHY_MAP) === 'SWITCH_GME_TROPHY_MAP' && vars.nameOf(VAR_HISCORE_MAP) === 'SWITCH_GME_HISCORE_MAP', `var names: ${vars.nameOf(VAR_TROPHY_MAP)} / ${vars.nameOf(VAR_HISCORE_MAP)}`);
    }
    // sound ids -> SND_MAP_* names of the sound table
    {
      const tab = readExeSoundTable(pe.data);
      const want = {
        PIZ_CHEESE: 'SND_MAP_PIZ_CHEESE', HIT_CITIZEN: 'SND_MAP_HIT_CITIZEN', PIZ_PEPRON: 'SND_MAP_PIZ_PEPRON', PIZ_TOMATO: 'SND_MAP_PIZ_TOMATO', PAPA_EEK: 'SND_MAP_PAPA_EEK', PAPA_OUCH: 'SND_MAP_PAPA_OUCH',
        HIT_PAPA: 'SND_MAP_HIT_PAPA', PIZ_CAPS: 'SND_MAP_PIZ_CAPS', HIT_WINDOW: 'SND_MAP_HIT_WINDOW', PIZ_DONE: 'SND_MAP_PIZ_DONE', PICK_CHEESE: 'SND_MAP_PICK_CHEESE', PICK_TOMATO: 'SND_MAP_PICK_TOMATO',
        PICK_CAPS: 'SND_MAP_PICK_CAPS', PICK_PEPRON: 'SND_MAP_PICK_PEPRON', FOOD_MOVE: 'SND_MAP_FOOD_MOVE', RIGHT_TOP: 'SND_MAP_RIGHT_TOP', WRONG_TOP: 'SND_MAP_WRONG_TOP', PAPA_YEOW: 'SND_MAP_PAPA_YEOW',
        PAPA_CHEERS: 'SND_MAP_PAPA_CHEERS', PAPA_YEAH: 'SND_MAP_PAPA_YEAH', PAPA_CONGRATS: 'SND_MAP_PAPA_CONGRATS', THROW1: 'SND_MAP_THROW1', THROW2: 'SND_MAP_THROW2', THROW3: 'SND_MAP_THROW3',
        THROW4: 'SND_MAP_THROW4', VOCAL1: 'SND_MAP_VOCAL1', VOCAL2: 'SND_MAP_VOCAL2', PAPA_BOUNCE: 'SND_MAP_PAPA_BOUNCE', MAMA_CLAP: 'SND_MAP_MAMA_CLAP',
      };
      for (const [k, name] of Object.entries(want)) ok(tab[SND[k]]?.name === name, `sound ${k} = ${SND[k]} is ${tab[SND[k]]?.name}, want ${name}`);
      ok(tab[SND.FOOD_MOVE].loopCount === 0, 'the flight sound loops (loop count 0, FUN_004433b0: 3D)');
    }
    // the clip ids of the animation dictionary DAT_05d4d484 (FUN_0081bcf7: FUN_0045bff4(dict, name, id)): `push id; push name` in the code
    {
      const clip = { PEP_MAP_RTOMATO: 4, PEP_MAP_RGREENPEPP: 6, PEP_MAP_RCHEESE: 8, PEP_MAP_RPEPPERONI: 9, PEP_MAP_CHUCK: 7, PEP_MAP_STAND_IDLE: 3, PAPA_MAP_DELIVER: 5, PAPA_MAP_JUMP: 10, PAPA_MAP_JUMPLOOK: 13,
        MAMA_MAP_IDLE: 11, MAMA_MAP_CLAP: 1, MAMA_MAP_FAIL: 2, SLUG_SLUG_FLIP: 1, SLUG_SLUG_WALK: 2, SLUG_SLUG_BOUNCE: 3 };
      const text = pe.slice(0x81bcf7, 0x4000);
      for (const [name, id] of Object.entries(clip)) {
        const addrs = pe.findStrings(name).filter((a) => pe.cstr(a) === name);
        let found = false;
        for (const a of addrs) {
          const pat = [0x6a, id, 0x68, a & 255, (a >> 8) & 255, (a >> 16) & 255, (a >>> 24) & 255];
          for (let i = 0; i + pat.length <= text.length && !found; i++) if (pat.every((b, k) => text[i + k] === b)) found = true;
        }
        ok(found, `animation dictionary: ${name} = ${id}`);
      }
      // the keys: pick clips in PICKS
      ok(PICKS.find((p) => p.bit === 4).clip === clip.PEP_MAP_RTOMATO && PICKS.find((p) => p.bit === 2).clip === clip.PEP_MAP_RGREENPEPP
        && PICKS.find((p) => p.bit === 1).clip === clip.PEP_MAP_RCHEESE && PICKS.find((p) => p.bit === 8).clip === clip.PEP_MAP_RPEPPERONI, 'pick clips of the four keys');
    }

    // ---------------------------------------------------------------- medals, trophies, hi-score (FUN_00812dbb)
    for (const [s, m] of [[0, 0], [2500, 0], [2501, 1], [5000, 1], [5001, 2], [7500, 2], [7501, 3], [99999, 3]]) ok(medalOfScore(s) === m, `medal of ${s}: ${medalOfScore(s)}, want ${m}`);
    {
      const mk = (o = {}) => { const a = new Int32Array(400); for (const [k, v] of Object.entries(o)) a[k] = v; return { get: (i) => a[i], set: (i, v) => { a[i] = v; }, a }; };
      let v = mk();
      let r = finishScore(v, 6000);
      ok(r.medal === 2 && r.result === 1 && v.a[VAR_TROPHY_MAP] === 2 && v.a[VAR_HISCORE_MAP] === 6000, `silver run: ${JSON.stringify(r)} trophy ${v.a[VAR_TROPHY_MAP]} hi ${v.a[VAR_HISCORE_MAP]}`);
      r = finishScore(v, 3000);
      ok(r.medal === 1 && r.result === 1 && v.a[VAR_TROPHY_MAP] === 2 && v.a[VAR_HISCORE_MAP] === 6000, 'a worse later run: the trophy and the hi-score are only raised');
      r = finishScore(v, 1000);
      ok(r.medal === 0 && r.result === 1 && v.a[VAR_TROPHY_MAP] === 2, 'no medal this time but a stored trophy: the result flag stays "success" (DAT_05d5f3e8 = 2 - (trophy != 0))');
      v = mk();
      r = finishScore(v, 1250);
      ok(r.medal === 0 && r.result === 2 && v.a[VAR_TROPHY_MAP] === 0 && v.a[VAR_HISCORE_MAP] === 1250, `failed first run: ${JSON.stringify(r)}; the hi-score is written anyway`);
      r = finishScore(v, 9000);
      ok(r.medal === 3 && r.result === 1 && v.a[VAR_TROPHY_MAP] === 3 && v.a[VAR_HISCORE_MAP] === 9000, 'gold');
    }

    // ---------------------------------------------------------------- the zone set-up
    const fresh = (seed = 1, vars = {}) => {
      const L = loadZone(ctx, 'z41MAP', { subgame: 28 });
      for (const [k, x] of Object.entries(vars)) L.world.vars.set(+k, x);
      const S = prepareWorld(L.world, L.archive);
      S.env.rng = lcg(seed);
      L.world.externalInput = true;
      return { L, w: L.world, S };
    };
    const press = (w, mask) => { const i = w.input; i.prevHeld = i.held; i.held = mask; i.pressed = (mask ^ i.prevHeld) & mask; };
    const tick = (w, mask = 0) => { press(w, mask); w.tick(); };
    const rec = (w, n) => w.records.find((r) => r.name === n);

    {
      // a world that was not prepared (no rigs bound: what the stub-walk test of zonesetup.mjs builds): the nodes must not throw
      const L0 = loadZone(ctx, 'z41MAP', { subgame: 28 });
      let err = null;
      try { for (let i = 0; i < 200; i++) { L0.world.input.update?.(); L0.world.externalInput = true; L0.world.tick(); } } catch (e) { err = e; }
      ok(!err, `an unprepared world ticks without an exception: ${err}`);
    }
    {
      const { L, w, S } = fresh();
      ok(L.skipped.length === 0, `no attach is skipped (${L.skipped.length})`);
      for (const [name, addr] of Object.entries(CTOR)) ok(registeredCtors().includes(addr), `constructor ${name} 0x${addr.toString(16)} registered`);
      ok(L.setup.attaches.length === 11, `11 attaches in the set-up (${L.setup.attaches.length})`);
      const pep = rec(w, 'PEPP');
      ok(pep.ctrl.nodes.length === 1 && pep.ctrl.nodes[0].kind === 'Pepper', `Pepper's chain is the zone's own node: ${pep.ctrl.nodes.map((n) => n.kind)}`);
      ok(S.pepper && S.papa && S.mama && S.toppings && S.slug, 'the nodes registered themselves in the zone state');
      ok(['PIZ6', 'PIZ5', 'PIZ4', 'PIZ3', 'PIZ2'].every((n, i) => S.stack[i]?.name === n), 'the pizza stack: PIZ6 .. PIZ2 (array of FUN_008138bd)');
      ok(MODEL_RECORDS.every((n) => !rec(w, n).enabled), 'the model-holder records are hidden');
      ok(['PEPP', 'MAMA', 'PAPA', 'CIT1', 'CIT2', 'CIT3', 'CIT4', 'CIT5', 'SLUG'].every((n) => rec(w, n).anim), 'rig instances on the animated records');
      ok(rec(w, 'PEPP').anim.clip === 4 && rec(w, 'PAPA').anim.clip === 10 && rec(w, 'MAMA').anim.clip === 11 && rec(w, 'SLUG').anim.clip === 2, 'start clips (constructors): Pepper 4, Papa 10, mama 11, slug 2');
      // the camera of the constructor: eye = Pepper + (2, 4, -5), look-at = Pepper + (1.5, 2, 8)
      const c = w.camera.c, p = rec(w, 'PEPP');
      ok(near(c[0], p.x + 2) && near(c[1], p.y + 4) && near(c[2], p.z - 5) && near(c[3], p.x + 1.5) && near(c[4], p.y + 2) && near(c[5], p.z + 8), `start camera: ${Array.from(c).slice(0, 6).map((v) => v.toFixed(2))}`);
      // the planet and the galaxy
      tick(w);
      const pl = rec(w, 'PLAN');
      ok(near(pl.x, 25) && near(pl.y, 10) && near(pl.z, 30), 'the planet sits at (25, 10, 30)');
      ok(near(S.planetAngle, 0.005), 'the planet turns 0.005 per tick');
    }

    // ---------------------------------------------------------------- the camera (FUN_00816220)
    {
      const { w, S } = fresh();
      const p = rec(w, 'PEPP');
      ok(S.near === 1, `the constructor's camera call (the eye jumps from far away) sets the near plane to 1.0 (${S.near})`);
      for (let i = 0; i < 5; i++) tick(w);
      ok(S.near === 3, `the settled overview camera: near plane 3.0 (${S.near})`);
      ok(S.pepper.state === 1 || S.pepper.state === 2, `Pepper waits for Papa (state ${S.pepper.state})`);
      // the idle timer: after 60 ticks without anything in the air the camera moves to the close-up (mode 1), easing 0.25 per tick
      for (let i = 0; i < 400 && !(S.pepper.state === 2); i++) tick(w);
      ok(S.pepper.state === 2, 'Pepper is ready once Papa swings');
      S.pepper.timer = 1;
      tick(w); tick(w);                 // timer < 0 on the second tick: the camera heads for the close-up
      const eye = [w.camera.c[0], w.camera.c[1], w.camera.c[2]];
      const goal = [p.x, p.y + 5.65, p.z + 1.5];
      const prev = [...eye];
      tick(w);
      const e2 = [w.camera.c[0], w.camera.c[1], w.camera.c[2]];
      ok(near(e2[1], prev[1] + (goal[1] - prev[1]) * 0.25, 1e-3) && near(e2[2], prev[2] + (goal[2] - prev[2]) * 0.25, 1e-3), 'the eye eases 25 % of the way per tick');
      ok(near(w.camera.c[3], p.x) && near(w.camera.c[4], p.y + 3.2) && near(w.camera.c[5], p.z + 2), 'close-up look-at = Pepper + (0, 3.2, 2)');
      ok(S.near === 1, 'the close-up: near plane 1.0');
    }

    // ---------------------------------------------------------------- Papa: swing, wiggle, gauge, speed
    {
      const { w, S } = fresh(3);
      while (S.papa.state !== 2) tick(w);
      const P = S.papa;
      ok(P.gauge === GAUGE_START && P.layers === 0 && P.thrown === 0, 'a round starts with the gauge at 12');
      ok(P.count === TOPPINGS_PER_ROUND[0] && P.target.slice(0, 2).every((t) => [1, 2, 4, 8].includes(t)) && P.target[2] === -1, `round 1 wants 2 toppings: ${P.target}`);
      ok(S.hudIcons.slice(0, 2).every((t, i) => 1 << t === P.target[i]) && S.hudIcons[2] === -1, `HUD icons are the bit positions of the targets: ${S.hudIcons}`);
      S.env.rng = () => 0.99;               // never wiggle (parity odd)
      const a0 = P.angle, g0 = P.gauge;
      for (let i = 0; i < 100; i++) tick(w);
      ok(near(P.angle, a0 + 100 * 0.015, 1e-3) && P.state === 2, `the swing advances 0.015 per tick (${P.angle - a0})`);
      ok(near(P.gauge, g0 - 100 * GAUGE_DECAY, 1e-3), `the gauge falls 0.005 per tick (${g0 - P.gauge})`);
      ok(near(P.x, 3 * Math.sin(P.angle - 0.015), 1e-3), 'Papa x = 3 sin(angle) of the previous tick');
      // the wiggle: a zero crossing with an even random number
      P.angle = -0.01; S.env.rng = () => 0;
      tick(w);
      ok(P.state === 3 && P.slow === 1, 'zero crossing + even random: quick wiggle (state 3)');
      const ang = P.angle;
      tick(w);
      ok(P.state === 3, 'still wiggling');
      // in the wiggle the angle runs 4 x faster with the amplitude 0.75, until the next crossing
      P.angle = 0.1; P.state = 3; const x1 = P.x;
      tick(w);
      ok(near(P.angle, 0.1 + 4 * 0.015, 1e-4) && near(P.x, 0.75 * Math.sin(0.1), 1e-4) && x1 !== P.x, `wiggle: 4 substeps (${P.angle}), x ${P.x}`);
      void ang;
    }

    // ---------------------------------------------------------------- the queue of citizens
    {
      const { w, S } = fresh(4);
      for (let i = 0; i < 20; i++) tick(w);
      ok(S.slots[3].occ === 1 && S.slots.filter((q) => q.occ).length === 1, `the first citizen enters at slot 3 (${S.slots.map((q) => q.occ)})`);
      const cit1 = rec(w, 'CIT1');
      ok(cit1.ctrl.nodes[0].steps === 104, `the walk from x = 16.5 to 4.1 takes ftol(12.4 / 0.12 + 0.85) = 104 steps (${cit1.ctrl.nodes[0].steps})`);
      ok(cit1.enabled && near(cit1.x, 16.5 + (4.1 - 16.5) * (20 / Math.trunc(Math.hypot(4.1 - 16.5, 0, 0) / 0.12 + 0.85)), 0.2), `CIT1 walks in from x = 16.5 (${cit1.x.toFixed(2)})`);
      for (let i = 0; i < 400; i++) tick(w);
      ok(JSON.stringify(S.slots.map((q) => q.occ)) === '[0,1,1,1,0]', `three citizens wait at slots 1..3: ${S.slots.map((q) => q.occ)}`);
      ok(S.slots[1].rec.name === 'CIT1' && S.slots[2].rec.name === 'CIT2' && S.slots[3].rec.name === 'CIT3', `in the order of the records: ${S.slots.map((q) => q.rec?.name)}`);
      ok(S.papa.state >= 2, 'Papa starts the round when someone stands at the counter');
      const n1 = S.slots[1].rec.ctrl.nodes[0];
      ok(near(S.slots[1].rec.x, -1.9, 1e-3) && near(S.slots[1].rec.ry, Math.PI, 1e-3) && n1.state === 2, 'the front citizen stands at x = -1.9 facing the shop');
      ok(near(rec(w, 'CIT4').z, 0, 100) /* hidden: queue full */ && !rec(w, 'CIT4').enabled, 'the fourth citizen waits outside (hidden)');
    }

    // ---------------------------------------------------------------- Pepper and the topping in the air
    {
      const { w, S } = fresh(5);
      while (!(S.papa.state === 2 && S.pepper.state === 2)) tick(w);
      S.env.rng = () => 0.99;
      const want = S.papa.target[0];
      const key = { 1: KEY.RIGHT, 2: KEY.LEFT, 4: KEY.UP, 8: KEY.DOWN }[want];
      tick(w, key);
      ok(S.pepper.state === 3 && S.pepper.slot && S.pepper.slot.type === want && S.pepper.slot.state === 1, `pressing the key of type ${want} picks it up (state ${S.pepper.state})`);
      ok(rec(w, 'PEPP').anim.clip === PICKS.find((p) => p.type === want).clip, 'the pick-up clip of that pot');
      tick(w);
      let n = 0;
      while (S.pepper.state === 3 && n++ < 100) tick(w);
      ok(S.pepper.slot.active === 1 && S.sounds.includes({ 1: SND.PICK_CAPS, 2: SND.PICK_CHEESE, 4: SND.PICK_TOMATO, 8: SND.PICK_PEPRON }[want]), 'the topping is active and its pick-up sound played at frame 17');
      ok(S.pepper.state === 4 && rec(w, 'PEPP').anim.clip === 7, 'then Pepper holds it (CHUCK clip), waiting for Space');
      const held = S.pepper.slot;
      for (let i = 0; i < 30; i++) tick(w);
      const f0 = rec(w, 'PEPP').anim.frame;
      ok(S.pepper.state === 4 && f0 === 14, `the throw clip waits at frame 14 (${f0})`);
      ok(held.m[12] !== 0, 'the held topping follows the hand');
      // throw to the left: Space + Left at the release frame 18
      const flyingBefore = S.flying;
      tick(w, KEY.SPACE | KEY.LEFT);
      ok(S.pepper.state === 5, 'Space starts the throw');
      let k = 0;
      while (held.state === 1 && k++ < 20) tick(w, KEY.LEFT);
      ok(held.state === 2 && held.dir === -1 && S.flying === flyingBefore + 1 && k === 4, `released at frame 18 after ${k} ticks with direction -1`);
      ok(S.sounds.some((s) => s >= SND.THROW1 && s <= SND.THROW4) && S.sounds.some((s) => s === SND.VOCAL1 || s === SND.VOCAL2), 'a throw sound and a grunt played');
      // the flight (FUN_0081543e): z advances 0.264 per tick, x goes to -3, y to 3.04
      const s0 = [...held.start];
      const total = (rec(w, 'PAPA').z - s0[2]) / 0.264;
      tick(w); tick(w);
      const t = held.t;
      ok(t === 3 && near(held.m[14], s0[2] + t * 0.264, 1e-3) && near(held.m[12], s0[0] + (-3 - s0[0]) * (t / total), 1e-3) && near(held.m[13], s0[1] + (3.04 - s0[1]) * (t / total), 1e-3), `flight position after ${t} ticks (the release tick already flies one step)`);
      let guard = 0;
      while (held.state === 2 && guard++ < 100) tick(w);
      ok(guard > 30 && guard < 60, `the flight lasts ${guard} ticks`);
      ok(held.state === 3 || held.state === 4, `it ends as a miss/hit (state ${held.state})`);
    }

    // ---------------------------------------------------------------- hits: on the dough, on Papa, the window, the citizen
    {
      // a topping dropped exactly on Papa's hand: lands on the dough
      const { w, S } = fresh(6);
      while (S.papa.state !== 2) tick(w);
      const P = S.papa;
      const place = (s, type, dir, z, pos) => { s.tpl = rec(w, 'TOP1'); s.state = 2; s.active = 1; s.type = type; s.dir = dir; s.start = [pos[0], pos[1], z]; s.t = 0; s.rot = 0; S.flying++; };
      const slot = S.toppings.slots[0];
      const t0 = P.target[0];
      // arrange the flight so that it ends on the hand: x target 0 (dir 0): start x = the hand's x
      const hand = P.hand;
      place(slot, t0, 0, -1 - 0.264 * 0.5, [hand[12], hand[13], 0]);
      slot.start[2] = -1 - 0.264 * 0.5;       // reaches z > -1 on the first tick
      slot.t = 0;
      const before = P.score;
      tick(w);
      ok(slot.state === 4 && P.thrown === 1 && P.landed[0] === t0 && P.pending[0] === 0 && P.score === before + 250 && (P.layers & t0) === t0, `a matching topping on the dough: +250 (score ${P.score}), layers ${P.layers}`);
      ok(S.sounds.includes(SND.RIGHT_TOP) && S.sounds.includes(SND.MAMA_CLAP), 'right-topping and clap sounds');
      ok(S.mama.state === 1 || S.mama.state === 2, `mama cheers (state ${S.mama.state})`);
      // a wrong topping
      const slot2 = S.toppings.slots[1];
      const wrong = [1, 2, 4, 8].find((x) => x !== P.target[1]);
      place(slot2, wrong, 0, -1 - 0.264 * 0.5, [P.hand[12], P.hand[13], 0]);
      slot2.start[2] = -1 - 0.264 * 0.5;
      const sc = P.score;
      tick(w);
      ok(P.landed[1] === wrong && P.score === sc && S.sounds.includes(SND.WRONG_TOP), 'a wrong topping lands without points');
      ok(P.state === 6 && S.log.includes('wrong'), `after the last topping the round is done (state ${P.state})`);
      // life of the splat: 12 ticks, then the slot is free again
      let k = 0;
      while (slot.state === 4 && k++ < 30) tick(w);
      ok(slot.state === 0 && slot.active === 0 && k >= 10 && k <= 13, `the splat lasts ${k} ticks`);
      tick(w);
      ok(S.flying === 0, `no topping is left in the air (${S.flying})`);
    }
    {
      // a near miss (1.0 <= distance < 1.5): Papa is hit; a far miss: flies on to the window
      const { w, S } = fresh(7);
      while (S.papa.state !== 2) tick(w);
      const P = S.papa;
      const slot = S.toppings.slots[0];
      const mk = (dx) => { slot.tpl = rec(w, 'TOP1'); slot.state = 2; slot.active = 1; slot.type = 4; slot.dir = 0; slot.start = [P.hand[12] + dx, P.hand[13], -1 - 0.264 * 0.5]; slot.t = 0; S.flying++; };
      mk(1.2);
      tick(w);
      ok(P.state === 4 && slot.state === 4 && S.mama.state >= 1 && S.sounds.includes(SND.HIT_PAPA), `a hit on Papa's body: Papa state ${P.state}`);
      ok(S.sounds.some((s) => s === SND.PAPA_EEK || s === SND.PAPA_OUCH || s === SND.PAPA_YEOW), 'Papa yelps');
      tick(w);
      ok(P.state === 5 && rec(w, 'PAPA').anim.clip === 13, `Papa jumps (clip 13): state ${P.state}`);
      let k = 0;
      while (P.state === 5 && k++ < 200) tick(w);
      ok(P.state === 2 || P.state === 3, 'and goes on swinging');
      while (slot.state !== 0) tick(w);
      const t3 = S.toppings.slots[2];
      S.sounds.length = 0;
      t3.tpl = rec(w, 'TOP4'); t3.state = 2; t3.active = 1; t3.type = 4; t3.dir = 0; t3.start = [P.hand[12] - 2.5, P.hand[13], -1 - 0.264 * 0.5]; t3.t = 0; S.flying++;
      tick(w);
      ok(t3.state === 3 && S.mama.state === 3, `a far miss flies on (state ${t3.state}), mama is sad`);
      let g = 0;
      while (t3.state === 3 && g++ < 100) tick(w);
      ok(t3.state === 4 && S.sounds.includes(SND.HIT_WINDOW), 'it splats on the window');
    }
    {
      // the cheese straight through the window hits the citizen waiting at slot 2: +500 once
      const { w, S } = fresh(8);
      for (let i = 0; i < 500; i++) tick(w);
      ok(S.slots[2].occ === 1 && S.slots[2].rec.ctrl.nodes[0].state === 2, 'a citizen waits at slot 2');
      const victim = S.slots[2].rec;
      const P = S.papa;
      const slot = S.toppings.slots[0];
      const go = (slotN) => { slotN.tpl = rec(w, 'TOP2'); slotN.state = 3; slotN.active = 1; slotN.type = 2; slotN.dir = 0; slotN.start = [-0.7, 2.4, -11.7]; slotN.t = 54; S.flying++; };
      const sc = P.score;
      go(slot);
      tick(w);
      ok(slot.state === 4 && P.score === sc + 500 && S.toppings.bonus === 1 && S.log.includes('citizen') && S.sounds.includes(SND.HIT_CITIZEN), `cheese straight at slot 2: +500 (${P.score - sc})`);
      const node = victim.ctrl.nodes[0];
      ok(node.state === 3 || node.state === 4, `the citizen is knocked away (state ${node.state})`);
      tick(w);
      ok(node.state === 4 && S.hitCitizens === 1, 'he flies (counter 1)');
      let k = 0;
      while (node.state === 4 && k++ < 400) tick(w);
      ok(node.state === 0 && S.hitCitizens === 0 && !victim.enabled && S.slots[2].occ === 0, `after ${k} ticks he is back in the line-up (state ${node.state}, rx reset ${victim.rx})`);
      // a second hit pays nothing
      while (!(S.slots[2].occ && S.slots[2].rec.ctrl.nodes[0].state === 2)) tick(w);
      const sc2 = P.score, slot2 = S.toppings.slots[3];
      go(slot2);
      tick(w);
      ok(P.score === sc2 && S.toppings.bonus === 1, 'the bonus is paid once');
      // a cheese off to the side, or another type, just splats on the window
      S.sounds.length = 0;
      const slot3 = S.toppings.slots[4];
      go(slot3); slot3.dir = 1;
      tick(w);
      ok(S.sounds.includes(SND.HIT_WINDOW) && !S.sounds.includes(SND.HIT_CITIZEN), 'off the middle: only the window');
    }
    {
      // end of a round: 250 + the time bonus 50 per full gauge unit when everything matches
      const { w, S } = fresh(9);
      while (S.papa.state !== 2) tick(w);
      const P = S.papa;
      P.thrown = P.count; P.landed = [...P.target]; P.gauge = 7.9;
      P.state = 6;
      const sc = P.score;
      tick(w);
      ok(P.score === sc + 250 + 7 * 50 && P.level === 1 && P.state === 7 && rec(w, 'PAPA').anim.clip === 5, `a perfect round: +250 +350 (${P.score - sc}), deliver clip`);
      ok(S.sounds.includes(SND.PAPA_YEAH) || S.sounds.includes(SND.PAPA_CHEERS), 'Papa cheers');
      let k = 0;
      while (P.state === 7 && k++ < 100) tick(w);
      ok(P.state === 8 && k >= 23 && k <= 26 && P.showDough === 0 && S.slots[0].occ === 1 && S.slots[0].rec?.ctrl.nodes[0].slot === 0 && S.slots[1].occ === 0, `at frame 24 the dough is gone and the citizen leaves (${k} ticks)`);
      while (P.state === 8) tick(w);
      ok(P.state === 1 && near(P.speed, 0.015 + 0.0075, 1e-6) && S.stack[0].enabled === false && S.stack[1].enabled, `next round: speed ${P.speed}, the top pizza of the stack hidden`);
      // a wrong round: no bonus
      while (P.state !== 2) tick(w);
      P.thrown = P.count; P.landed = [...P.target]; P.landed[0] = P.target[0] === 1 ? 2 : 1; P.gauge = 10; P.state = 6;
      const sc2 = P.score;
      tick(w);
      ok(P.score === sc2 + 250, `a round with a wrong topping pays 250 only (${P.score - sc2})`);
    }

    // ---------------------------------------------------------------- scripted games
    const play = (mode, seed, vars = {}) => {
      const { w, S } = fresh(seed, vars);
      const bot = new Bot(mode);
      const rounds = [];
      let lastLevel = -1, t = 0;
      const trace = [];
      while (t < 30000 && !S.result) {
        const snap = snapshot(S);
        if (snap.papa.state === 2 && snap.papa.level !== lastLevel) { lastLevel = snap.papa.level; rounds.push({ level: lastLevel, count: snap.papa.count, speed: snap.papa.speed, target: snap.papa.target.slice(0, snap.papa.count) }); }
        tick(w, bot.step(snap));
        t++;
        if (t % 997 === 0) trace.push(snap.papa.state);
      }
      return { w, S, t, rounds, bot };
    };
    {
      const g = play('win', 1);
      const P = g.S.papa;
      ok(g.S.result === 1 && P.state === 10 && P.level === 5, `scripted WIN: result ${g.S.result}, state ${P.state}, level ${P.level}, ${g.t} ticks`);
      ok(g.rounds.length === 5 && g.rounds.every((r, i) => r.level === i && r.count === TOPPINGS_PER_ROUND[i]), `five rounds with 2, 3, 4, 4, 4 toppings: ${g.rounds.map((r) => r.count)}`);
      ok(g.rounds.every((r, i) => near(r.speed, 0.015 + 0.0075 * i, 1e-5)), `the swing speed grows 0.0075 per round: ${g.rounds.map((r) => r.speed.toFixed(4))}`);
      ok(P.medal >= 1 && P.score >= 2501, `a medal: score ${P.score}, medal ${P.medal}`);
      ok(g.w.vars.get(VAR_TROPHY_MAP) === P.medal && g.w.vars.get(VAR_HISCORE_MAP) === P.score, `TROPHY_MAP ${g.w.vars.get(VAR_TROPHY_MAP)} = medal, HISCORE_MAP ${g.w.vars.get(VAR_HISCORE_MAP)} = score`);
      ok(g.S.log.length > 0 && g.S.arrivals.length >= 17, `${g.S.arrivals.length} toppings arrived at Papa`);
      ok(g.S.stack.slice(0, 4).every((r) => !r.enabled) && g.S.stack[4].enabled, 'four of the five stacked pizzas are gone, the last stays');
      ok(g.S.flying >= 0, 'the count of flying toppings never went negative');
      ok(P.score >= 5 * 250 + 12 * 250, `at least the 5 x 250 round points and a dozen matches (${P.score})`);
      // the model-holder records and helper-less world: the zone keeps running in the banner (Papa dances: clip 10 loops)
      for (let i = 0; i < 100; i++) tick(g.w);
      ok(g.S.papa.state === 10 && g.w.records.find((r) => r.name === 'PAPA').anim.clip === 10, 'Papa dances after the result (state 10)');
      notes.push(`WIN seed 1: ${g.t} ticks (${(g.t / 30).toFixed(0)} s), score ${P.score}, medal ${P.medal}, throws ${g.bot.throws}`);
      const g2 = play('win', 3);
      ok(g2.S.result === 1 && g2.S.papa.medal >= 1, `a second WIN (seed 3): score ${g2.S.papa.score}, medal ${g2.S.papa.medal}`);
      notes.push(`WIN seed 3: score ${g2.S.papa.score}, medal ${g2.S.papa.medal}`);
    }
    {
      const g = play('lose', 1);
      const P = g.S.papa;
      ok(g.S.result === 2 && P.medal === 0 && P.score < 2501, `scripted LOSS: result ${g.S.result}, medal ${P.medal}, score ${P.score}`);
      ok(P.score === 5 * 250 && g.S.log.filter((x) => x === 'wrong').length === 17, `every one of the 17 toppings was wrong: only the 5 x 250 round points remain (${P.score})`);
      ok(g.w.vars.get(VAR_TROPHY_MAP) === 0 && g.w.vars.get(VAR_HISCORE_MAP) === P.score, `no trophy, the hi-score is written anyway (${g.w.vars.get(VAR_HISCORE_MAP)})`);
      notes.push(`LOSS seed 1: ${g.t} ticks, score ${P.score}`);
      // with a stored trophy from an earlier run, the same failing run still reports success (DAT_05d5f3e8)
      const g2 = play('lose', 2, { [VAR_TROPHY_MAP]: 1, [VAR_HISCORE_MAP]: 4000 });
      ok(g2.S.result === 1 && g2.S.papa.medal === 0 && g2.w.vars.get(VAR_HISCORE_MAP) === 4000 && g2.w.vars.get(VAR_TROPHY_MAP) === 1, 'an earlier bronze: this failing run is still a "success"; the hi-score stays');
    }
    // determinism of the logic: the same seed plays the same game
    {
      const a = play('win', 3), b = play('win', 3);
      ok(a.t === b.t && a.S.papa.score === b.S.papa.score, 'the simulation is deterministic');
    }
    return { checked, failures, notes };
  },
};
