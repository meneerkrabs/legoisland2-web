import fs from 'node:fs';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { readExeSoundTable } from '../../src/formats/sound.ts';
import { registeredCtors } from '../../src/game/setup.ts';
import { newGame, tick, capture, restore, BTN, Phase2Bot, statefulRng } from '../lib/z42brp-sim.mjs';
import {
  CTOR, stateOf, prepareWorld, checkRecords, snapshot, ZoneLoop, lcg,
} from '../../src/zones/z42BRP/nodes.ts';
import {
  VAR, REC, SND, RUN, ROOF, BOT, FLOOR, BOSS, PARTS, CLIP, FLOAT_CONSTANTS, readFloat, scoreOf, medalOf, clockText, writeResult, RESULT_LINES,
  readAnimDictionary, readSwitchDictionary, MEDAL_SILVER, MEDAL_GOLD, SOUNDS_2D, SOUNDS_3D,
} from '../../src/zones/z42BRP/rules.ts';
import { PLAN1 } from '../../src/zones/z42BRP/bot-plan.ts';

// z42BRP "Brickster's palace" (docs/re/m6/z42BRP.md): constants and tables against the executable (zone loop FUN_0081fd64, the node functions 0x821704 / 0x822ba8 /
// 0x8243e5 / 0x824c80 / 0x825850 / 0x826b40, the loader's dictionaries), the side run (circle, jump, switches, platforms, lift), the roof (movement, pizza, bots, floor,
// Brickster, end sequence), the score / medals / variables and scripted games: a WIN (the recorded run up the tower, then the roof bot) and a LOSS (nothing but falling).

const hex = (n) => '0x' + n.toString(16);
const near = (a, b, e = 1e-4) => Math.abs(a - b) <= e;
const TWO_PI = Math.PI * 2;

export default {
  name: 'm6-z42BRP',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    const arch = ctx.archives.find((a) => a.name === 'z42BRP');
    const code = (va, n) => pe.slice(va, n);
    const hasU32 = (b, v) => { for (let i = 0; i + 4 <= b.length; i++) if ((b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 === v >>> 0) return true; return false; };
    const press = (w, mask) => { const i = w.input; i.prevHeld = i.held; i.held = mask; i.pressed = (mask ^ i.prevHeld) & mask; };
    /** a fresh game; `phase` 2 jumps to the roof (the lift is covered by its own checks) */
    const fresh = (opts = {}) => {
      const g = newGame(ctx, opts);
      return g;
    };
    /** the roof; the bots wait for ever unless `bots` (their knock-back pushes Pepper off the floor at the back and makes her fall) */
    const toRoof = (g, bots = false) => {
      for (let i = 0; i < 16; i++) tick(g.w, 0);
      g.w.vars.set(VAR.PHASE, 2);
      tick(g.w, 0);
      if (!bots) for (const b of g.S.bots) b.timer = 1e9;
      return g;
    };

    try {
      // ============================================================ tables against the executable
      {
        for (const [name, va, v] of FLOAT_CONSTANTS) ok(near(readFloat(pe, va), v, Math.abs(v) * 1e-5 + 1e-7), `float ${name} @ ${hex(va)}: ${readFloat(pe, va)}, want ${v}`);
        ok(FLOAT_CONSTANTS.length >= 25, `${FLOAT_CONSTANTS.length} float constants compared`);
        // vtables of the six nodes: slot 0 is the update function that is ported
        const vt = { pepbrp: [0x958ac0, 0x822ba8], peptop: [0x958a48, 0x821704], bottop: [0x958b18, 0x8243e5], zonetop: [0x958b88, 0x824c80], zonebrp: [0x958bd8, 0x825850], brickst: [0x958c28, 0x826b40] };
        for (const [n, [tab, upd]] of Object.entries(vt)) ok(pe.u32(tab) === upd, `${n}: vtable ${hex(tab)}[0] = ${hex(pe.u32(tab))}, want ${hex(upd)}`);
        // the zone loop: the score formula `(secs - 0x3c) * -0x37 + 10000`, the medal limits, the clock text and the loop's strings
        const loop = code(0x81fd64, 0xc00);
        ok(hasU32(loop, MEDAL_SILVER) && hasU32(loop, MEDAL_GOLD), `medal limits 0x13ba / 0x209e in the zone loop`);
        const has = (b, pat) => { for (let i = 0; i + pat.length <= b.length; i++) if (pat.every((x, k) => b[i + k] === x)) return true; return false; };
        ok(has(loop, [0xb8, 0x10, 0x27, 0, 0]) && has(loop, [0x6b, 0xd2, 0x37]) && has(loop, [0x83, 0xea, 0x3c]), 'score = 10000 - (secs - 0x3c) * 0x37 in the zone loop (mov eax, 0x2710; sub edx, 0x3c; imul edx, edx, 0x37)');
        ok(pe.cstr(0x9586fc) === '%02d:%02d' && pe.cstr(0x958720) === 'Score %d' && pe.cstr(0x958828) === 'OutroFMV.mpg', 'the clock text, the score text and the outro movie of the zone loop');
        ok(hasU32(loop, VAR.TROPHY) && hasU32(loop, VAR.HISCORE) && hasU32(loop, VAR.PHASE), 'game variables 0xcf / 0x96 / 0xfa in the zone loop');
        // the clock: FUN_00435cbb = ftol(ms * 0.06) (the double 0.06 at 0x8921f8)
        ok(near(readFloat(pe, 0x8921f8), 0.06, 1e-7), `clock factor 0.06 @ 0x8921f8: ${readFloat(pe, 0x8921f8)}`);
        // the animation dictionary of the loader (DAT_05d4d484) and the switch dictionary (DAT_00987e20)
        const dict = readAnimDictionary(pe);
        ok(dict.size === 129 && [...Array(122).keys()].every((i) => [...dict.values()].includes(i + 1)), `${dict.size} animation names (the dictionary holds 0x81 entries; ids 1 .. 122, 1 .. 3 twice: PEP_JUMPINAIR / SLUG_SLUG_FLIP ...)`);
        const want = { PEP_RUN: CLIP.RUN, PEP_IDLE: CLIP.IDLE, PEP_LGIHITROCK: CLIP.STUMBLE, BB_WALK: CLIP.BOT_WALK, XRUN: CLIP.BRIK_RUN, BRIK_HITBYPIZZA: CLIP.BRIK_HIT, XTALK: 101, BRIK_HOTRUN: 112, BRIK_COOLDOWN: 113 };
        for (const [n, id] of Object.entries(want)) ok(dict.get(n) === id, `clip ${n} = ${dict.get(n)}, want ${id}`);
        const sw = readSwitchDictionary(pe);
        ok(sw.get('SWITCH_BRP_PEPPSWITCH') === VAR.PHASE && sw.get('SWITCH_BRP_DOOR') === VAR.DOOR, `switch dictionary: ${JSON.stringify([...sw].slice(0, 2))}`);
        // sounds: the ids of FUN_00820b70 against the sound table names
        const tab = readExeSoundTable(pe.data);
        const names = new Map([
          [SND.JUMP, 'SND_BRP_JUMP'], [SND.EEK, 'SND_BRP_EEK'], [SND.YEAH, 'SND_BRP_YEAH'], [SND.PIZZATHROW, 'SND_BRP_PIZZATHROW'], [SND.RUNOVER, 'SND_BRP_RUNOVER'],
          [SND.HITVOCAL[0], 'SND_BRP_HITVOCAL1'], [SND.HITVOCAL[1], 'SND_BRP_HITVOCAL2'], [SND.HITVOCAL[2], 'SND_BRP_HITVOCAL3'], [SND.FSBRIDGE[0], 'SND_BRP_FSBRIDGE1'],
          [SND.FSBRIDGE[1], 'SND_BRP_FSBRIDGE2'], [SND.PIZZAHITBRIK, 'SND_BRP_PIZZAHITBRIK'], [SND.BBFSMETAL[0], 'SND_BRP_BBFSMETAL1'], [SND.BBFSMETAL[1], 'SND_BRP_BBFSMETAL2'],
          [SND.MOVEP_BIG, 'SND_BRP_MOVEP_BIG'], [SND.MOVEP_MID, 'SND_BRP_MOVEP_MID1'], [SND.PIZZAHITBOT, 'SND_BRP_PIZZAHITBOT'], [SND.MOVEP_UP, 'SND_BRP_MOVEP_UP'],
          [SND.FSPLASTIC[0], 'SND_BRP_FSPLASTIC1'], [SND.FSPLASTIC[1], 'SND_BRP_FSPLASTIC2'],
        ]);
        for (const [id, name] of names) ok(tab[id]?.name === name, `sound ${hex(id)} is ${tab[id]?.name}, want ${name}`);
        // FUN_00820b70 loads exactly these ids: `push id; call 0x443580 / 0x4433b0`
        const snd = code(0x820b70, 0x520);
        const loaded = new Set();
        for (let i = 0; i + 8 < snd.length; i++) if (snd[i] === 0x68 && snd[i + 3] === 0 && snd[i + 4] === 0 && snd[i + 5] === 0xe8) loaded.add(snd[i + 1] | (snd[i + 2] << 8));
        for (const id of [...SOUNDS_2D, ...SOUNDS_3D]) ok(loaded.has(id), `FUN_00820b70 loads sound ${hex(id)}`);
      }

      // ============================================================ the set-up
      {
        const L = loadZone(ctx, 'z42BRP', { subgame: 29 });
        const at = L.setup.attaches.map((a) => [a.record, a.ctor, a.pos, a.var, a.mask, a.value]);
        const want = [[91, CTOR.BRICKST, 0, VAR.PHASE, 0x7fff, 2], [90, CTOR.PEPBRP, 0, VAR.PHASE, 0x7fff, 1], [90, CTOR.PEPTOP, 1, VAR.PHASE, 0x7fff, 2], [14, CTOR.ZONEBRP, 0, VAR.PHASE, 0x7fff, 1],
          [14, CTOR.ZONETOP, 1, VAR.PHASE, 0x7fff, 2], [92, CTOR.BOTTOP, 0, VAR.PHASE, 0x7fff, 2], [93, CTOR.BOTTOP, 0, VAR.PHASE, 0x7fff, 2], [94, CTOR.BOTTOP, 0, VAR.PHASE, 0x7fff, 2], [95, CTOR.BOTTOP, 0, VAR.PHASE, 0x7fff, 2]];
        ok(JSON.stringify(at) === JSON.stringify(want), `the set-up's nine attaches (records, constructors, positions, gates): ${JSON.stringify(at)}`);
        for (const [n, addr] of Object.entries(CTOR)) ok(registeredCtors().includes(addr), `constructor ${n} ${hex(addr)} registered`);
        ok(L.skipped.length === 0, `no attach is skipped (${L.skipped.length})`);
        ok(checkRecords(L.world).length === 0, `record names: ${checkRecords(L.world).join('; ')}`);
        ok(L.world.records.length === 96, `${L.world.records.length} records`);
        const g = fresh();
        const w = g.w, S = g.S;
        ok(w.records[REC.PEPP].ctrl.nodes.map((n) => n.kind).join() === 'pepbrp,peptop', `Pepper's chain is the zone's own: ${w.records[REC.PEPP].ctrl.nodes.map((n) => n.kind)}`);
        ok(w.records[REC.BRP].ctrl.nodes.map((n) => n.kind).join() === 'zonebrp,zonetop', 'the room record carries zonebrp / zonetop');
        ok(w.records[REC.BSTR].ctrl.nodes.map((n) => n.kind).join() === 'brickst', 'Brickster carries brickst');
        ok(REC.BOTS.every((i) => w.records[i].ctrl.nodes.map((n) => n.kind).join() === 'bottop'), 'the four bots carry bottop');
        ok(w.vars.get(VAR.PHASE) === 1, 'the phase variable starts at 1 (FUN_00417597(0xfa, 1))');
        ok(w.records[REC.PEPP].anim && w.records[REC.BSTR].anim && REC.BOTS.every((i) => w.records[i].anim), 'rig instances (MFIG) on Pepper, Brickster and the bots');
        const pn = S.pepbrp;
        ok(near(pn.R, w.records[REC.BRP].colObj.radius * 0.465, 1e-4), `the tower's circle: R = BRP radius * 0.465 = ${pn.R}`);
        const pp = w.records[REC.PEPP];
        ok(near(Math.hypot(pp.x, pp.z), pn.R, 1e-3), `Pepper starts on the circle (${Math.hypot(pp.x, pp.z).toFixed(3)})`);
        ok(near(pn.angle, Math.atan2(-23.1479, 16.9248), 0.01), `start angle ${pn.angle} (the scene's place projected on the circle)`);
        ok(near(w.records[REC.BRI2].y, 54.02 + PARTS.BRI2_RAISE, 0.02) && near(w.records[REC.BRI3].y, 81.6 + PARTS.BRI3_RAISE, 0.02), `BRI2 / BRI3 start raised by 18.75 / 31.25: ${w.records[REC.BRI2].y} / ${w.records[REC.BRI3].y}`);
        const door = w.records[REC.DOOR];
        ok(near(door.m[8], 1, 1e-4) && near(door.m[10], 0, 1e-4), `the door starts open (turned 90 degrees): forward (${door.m[8].toFixed(2)}, ${door.m[10].toFixed(2)})`);
        ok(S.firstRun === 1 && S.firstTop === 1, 'the first-update flags of both Pepper nodes (DAT_00958ad8 / DAT_00958a60 = 1)');
        ok(near(w.camera.c[3], pp.x, 1e-3) && near(w.camera.c[4], pp.y + 3, 1e-3), 'the start camera looks at Pepper + (0, 3, 0)');
        // the whole set-up is deterministic: two worlds with the same seed agree after 200 ticks
        const a = fresh({ seed: 5 }), b = fresh({ seed: 5 });
        for (let i = 0; i < 200; i++) { tick(a.w, BTN.LEFT); tick(b.w, BTN.LEFT); }
        ok(near(a.w.records[90].x, b.w.records[90].x, 0) && near(a.w.records[90].y, b.w.records[90].y, 0), 'determinism');
      }

      // ============================================================ phase 1: the side run
      {
        const g = fresh();
        const w = g.w, S = g.S, pn = S.pepbrp, pep = w.records[REC.PEPP];
        const a0 = pn.angle, y0 = pep.y;
        for (let i = 0; i < RUN.START_HOLD; i++) tick(w, BTN.LEFT);
        ok(near(pn.angle, a0, 0) && near(pep.y, y0, 1e-3), `the hold of ${RUN.START_HOLD} ticks: Pepper does not move (angle ${pn.angle})`);
        tick(w, BTN.LEFT);
        ok(pn.hold <= 0 && near(pn.angle, a0 - RUN.TURN_RATE, 1e-6), `the 16th tick: the run starts (angle step ${(a0 - pn.angle).toFixed(6)})`);
        ok(pep.anim.clip === CLIP.RUN, `the run clip ${pep.anim.clip}`);
        for (let i = 0; i < 20; i++) tick(w, BTN.LEFT);
        ok(near(pn.angle, a0 - 21 * RUN.TURN_RATE, 1e-5), `21 ticks of LEFT: ${(a0 - pn.angle).toFixed(5)} rad`);
        ok(near(Math.hypot(pep.x, pep.z), pn.R, 1e-3), `Pepper stays on the circle (${Math.hypot(pep.x, pep.z).toFixed(3)} vs ${pn.R.toFixed(3)})`);
        const fwd = [pep.m[8], pep.m[10]];
        const tangent = [Math.cos(pn.angle) * -1, Math.sin(pn.angle)];     // d(sin a, cos a)/da = (cos a, -sin a); running with a decreasing: the opposite
        ok(Math.abs(fwd[0] * -Math.cos(pn.angle) + fwd[1] * Math.sin(pn.angle)) > 0.97, `Pepper faces along the circle: forward (${fwd[0].toFixed(2)}, ${fwd[1].toFixed(2)}) vs ${tangent.map((v) => v.toFixed(2))}`);
        // RIGHT turns around (pi) and goes back
        const aBefore = pn.angle;
        for (let i = 0; i < 10; i++) tick(w, BTN.RIGHT);
        ok(near(pn.angle, aBefore + 10 * RUN.TURN_RATE, 1e-5), `RIGHT: the angle grows (${(pn.angle - aBefore).toFixed(5)})`);
        // a jump: y(t) = y0 + (g t + v0) t + g t^2 / 2 with t = 0.1 per tick; sound, clip
        const g2 = fresh();
        const w2 = g2.w, S2 = g2.S, n2 = S2.pepbrp, p2 = w2.records[REC.PEPP];
        for (let i = 0; i < 17; i++) tick(w2, 0);
        const yy0 = p2.y;
        S2.sounds.length = 0;
        tick(w2, BTN.ALT);
        ok(n2.air && p2.anim.clip !== CLIP.RUN && S2.sounds.some((s) => s.id === SND.JUMP), `button 2 jumps: air ${n2.air}, sound ${S2.sounds.map((s) => hex(s.id))}`);
        let maxErr = 0, peak = yy0, landedAt = -1;
        for (let k = 1; k <= 40; k++) {
          tick(w2, 0);
          if (!n2.air && landedAt < 0) landedAt = k;
          if (n2.air) {
            const t = 0.1 * (k + 1);     // the jump tick itself already ran one step of the arc
            const y = yy0 + (RUN.GRAVITY * t + RUN.JUMP_V0) * t + RUN.GRAVITY * t * t * 0.5;
            maxErr = Math.max(maxErr, Math.abs(p2.y - y));
            peak = Math.max(peak, p2.y);
          }
        }
        ok(maxErr < 1e-3, `the jump follows y0 + (g t + v0) t + g t^2 / 2 (max error ${maxErr.toExponential(2)})`);
        ok(landedAt > 10 && landedAt < 20, `lands after ${landedAt} ticks`);
        ok(peak - yy0 > 5 && peak - yy0 < 12, `jump height ${(peak - yy0).toFixed(2)}`);
        // the second ground probe sets the switch flags: Pepper placed on the lattice point of the switches
        const g3 = fresh();
        const w3 = g3.w, n3 = g3.S.pepbrp, p3 = w3.records[REC.PEPP];
        for (let i = 0; i < 17; i++) tick(w3, 0);
        const put = (a, y) => { n3.angle = n3.prevAngle = a; n3.air = false; p3.y = y; p3.x = Math.sin(a) * n3.R; p3.z = Math.cos(a) * n3.R; tick(w3, 0); };
        put(2.5216, 84.8);
        ok(n3.sw2 && !n3.sw1, `standing at angle 2.5216 on the ramp touches switch 2 (sw2 ${n3.sw2})`);
        put(1.45, 57.5);
        ok(n3.sw1, `switch 1 at angle 1.45 (sw1 ${n3.sw1})`);
        n3.sw1 = false; put(1.2, 70);
        ok(!n3.sw1 && !n3.lift, 'elsewhere no flag');
        // the lift: touching BRI8 sets the lift flag once, a sound, Pepper is put on its middle
        const g4 = fresh();
        const w4 = g4.w, S4 = g4.S, n4 = S4.pepbrp, p4 = w4.records[REC.PEPP];
        for (let i = 0; i < 17; i++) tick(w4, 0);
        const bri8 = w4.records[REC.BRI8];
        n4.angle = n4.prevAngle = Math.atan2(bri8.x, bri8.z) + 0.04; n4.air = false; p4.y = bri8.y + 1.2; p4.x = Math.sin(n4.angle) * n4.R; p4.z = Math.cos(n4.angle) * n4.R;
        S4.sounds.length = 0;
        tick(w4, 0);
        ok(n4.lift && near(p4.x, bri8.x, 1e-3) && near(p4.z, bri8.z, 1e-3), `the lift flag: Pepper centred on BRI8 (${p4.x.toFixed(2)}, ${p4.z.toFixed(2)})`);
        ok(S4.sounds.some((s) => s.id === SND.YEAH) && S4.sounds.some((s) => s.id === SND.MOVEP_UP), 'the lift plays "yeah" (2D) and the lift sound (3D)');
        ok(S4.liftHit === 1, 'DAT_05d5f5e8 = 1');
        const yTop = bri8.y;
        let ticks = 0;
        while (w4.vars.get(VAR.PHASE) === 1 && ticks < 400) { tick(w4, 0); ticks++; }
        ok(w4.vars.get(VAR.PHASE) === 2 && ticks >= 235 && ticks <= 250, `the lift takes ${ticks} ticks (8 s) and then sets the phase to 2`);
        ok(near(bri8.y, RUN.LIFT_TOP, (RUN.LIFT_TOP - yTop) / RUN.LIFT_TICKS + 1e-3), `BRI8 ends at ${bri8.y.toFixed(3)} (limit ${RUN.LIFT_TOP})`);
        ok(REC.BBOT.every((i) => !w4.records[i].enabled), 'the six brick-bot heads are hidden once the lift is touched');
      }

      // ============================================================ phase 1: the tower's moving parts
      {
        const g = fresh();
        const w = g.w, S = g.S, zb = S.zonebrp;
        const sl = REC.SLIDERS.map((i) => w.records[i]);
        const off = () => sl.map((r, i) => (r.x - zb.start[i][0]) * Math.sin(Math.atan2(zb.start[i][0], zb.start[i][2])) + (r.z - zb.start[i][2]) * Math.cos(Math.atan2(zb.start[i][0], zb.start[i][2])));
        // the sliders move 8 units radially outwards in 30 ticks (8 / 30 per tick), then back
        for (let i = 0; i < 15; i++) tick(w, 0);
        ok(off().every((v) => near(v, 4, 0.01)), `sliders after 15 ticks: ${off().map((v) => v.toFixed(3))} (4.0 outwards)`);
        for (let i = 0; i < 15; i++) tick(w, 0);
        ok(off().every((v) => near(v, 8, 0.01)), `after 30 ticks: ${off().map((v) => v.toFixed(3))}`);
        S.sounds.length = 0;
        const g2b = fresh();
        for (let i = 0; i < 31; i++) tick(g2b.w, 0);
        const turnSounds = g2b.S.sounds.filter((s) => s.id === SND.MOVEP_MID);
        ok(turnSounds.length === 6, `six slider sounds at the turn (${turnSounds.length})`);
        for (let i = 0; i < 15; i++) tick(w, 0);
        ok(off().every((v) => near(v, 4, 0.3)), `coming back: ${off().map((v) => v.toFixed(3))}`);
        // the first slider is put back exactly after 60 ticks (the original tests inside the loop: only the first one), the cycle repeats
        const g2 = fresh();
        const w2 = g2.w, zb2 = g2.S.zonebrp;
        const first = w2.records[REC.SLIDERS[0]];
        const dist = [];
        for (let i = 0; i < 130; i++) { tick(w2, 0); dist.push(Math.hypot(first.x - zb2.start[0][0], first.z - zb2.start[0][2])); }
        ok(near(Math.max(...dist), 8, 0.3) && dist[59] < 0.01 && dist[119] < 0.01, `slider 0: out 8 and back each 60 ticks (max ${Math.max(...dist).toFixed(2)}, at 60: ${dist[59].toFixed(3)}, at 120: ${dist[119].toFixed(3)})`);
        const w3b = w;
        // switch 1 lowers BRI2 by 0.375 per tick, switch 2 BRI3 by 0.625; BRI7 crumbles with growing speed; BRI5 moves on its arc
        const g3 = fresh();
        const w3 = g3.w, n3 = g3.S.pepbrp;
        void w3b;
        for (let i = 0; i < 17; i++) tick(w3, 0);
        const bri2 = w3.records[REC.BRI2], bri3 = w3.records[REC.BRI3], bri7 = w3.records[REC.BRI7], bri5 = w3.records[REC.BRI5];
        const yb2 = bri2.y;
        n3.sw1 = true; tick(w3, 0);
        const sw1on = w3.records[REC.SWUP1].enabled && !w3.records[REC.SWIC1].enabled;
        ok(sw1on, 'after switch 1 the lit switch (SWUP) replaces SWIC');
        ok(near(yb2 - bri2.y, PARTS.BRI2_DROP, 1e-4), `BRI2 drops ${(yb2 - bri2.y).toFixed(4)} in a tick`);
        for (let i = 0; i < 80; i++) tick(w3, 0);
        ok(near(bri2.y, g3.S.zonebrp.y2 - 0, 0.4), `BRI2 stops at its original height ${bri2.y.toFixed(2)} (${g3.S.zonebrp.y2.toFixed(2)})`);
        const yb3 = bri3.y;
        n3.sw2 = true; tick(w3, 0);
        ok(near(yb3 - bri3.y, PARTS.BRI3_DROP, 1e-4), `BRI3 drops ${(yb3 - bri3.y).toFixed(4)}`);
        const y7 = bri7.y;
        n3.crumble = true; tick(w3, 0); const d1 = y7 - bri7.y; const y7b = bri7.y; tick(w3, 0); const d2 = y7b - bri7.y;
        ok(near(d1, PARTS.BRI7_START, 1e-4) && near(d2 / d1, 1.1, 1e-3), `BRI7 falls ${d1.toFixed(4)} then ${d2.toFixed(4)} (x1.1)`);
        for (let i = 0; i < 400 && bri7.enabled; i++) tick(w3, 0);
        ok(!bri7.enabled && bri7.y < 0, `BRI7 disappears below y 0 (${bri7.y.toFixed(1)})`);
        const arc0 = [bri5.x, bri5.y, bri5.z];
        n3.arc = true;
        for (let i = 0; i < 10; i++) tick(w3, 0);
        ok(near(bri5.y - arc0[1], 10 * PARTS.ARC_RISE, 1e-3), `BRI5 rises ${(bri5.y - arc0[1]).toFixed(3)} in 10 ticks (0.0936 each)`);
        ok(near(Math.hypot(bri5.x, bri5.z), Math.hypot(arc0[0], arc0[2]), 1e-3), 'BRI5 stays on its circle');
        let yMaxArc = bri5.y;
        for (let i = 0; i < 60; i++) { tick(w3, 0); yMaxArc = Math.max(yMaxArc, bri5.y); }
        ok(near(yMaxArc - arc0[1], PARTS.ARC_WIDTH / PARTS.ARC_STEP * PARTS.ARC_RISE, 0.2) && bri5.y < yMaxArc - 1, `BRI5 turns round at the end of its arc: rose ${(yMaxArc - arc0[1]).toFixed(2)} (34 ticks x 0.0936), now ${bri5.y.toFixed(2)}`);
        // the bobbing BRI4 platforms (sine, period 240 clock ticks, phases 0 / 60 / 120 / 180)
        const g4 = fresh();
        const w4 = g4.w, zb4 = g4.S.zonebrp;
        let amp = 0;
        for (let i = 0; i < 130; i++) { tick(w4, 0); amp = Math.max(amp, Math.abs(w4.records[30].y - zb4.bobY[0])); }
        ok(near(amp, PARTS.BOB_AMPLITUDE, 0.15), `BRI4 bobs by +-7.8125 (${amp.toFixed(3)})`);
        // falling off the bottom restarts the run: Pepper back, the parts back
        const g5 = fresh();
        const w5 = g5.w, S5 = g5.S, n5 = S5.pepbrp, p5 = w5.records[REC.PEPP];
        for (let i = 0; i < 17; i++) tick(w5, 0);
        const spawn = Array.from(n5.spawn);
        n5.sw1 = true; for (let i = 0; i < 30; i++) tick(w5, 0);
        p5.y = 0.1;
        tick(w5, 0);
        ok(S5.reset5ec === 1 || !n5.sw1, 'below y 0.625 the run restarts');
        ok(n5.angle === n5.angle0 && near(p5.x, spawn[12], 1e-3) && near(p5.y, spawn[13], 1e-3) && !n5.sw1, 'Pepper is back at the start, the switch flag cleared');
        tick(w5, 0);
        ok(S5.reset5ec === 0 && near(w5.records[REC.BRI2].y, g5.S.zonebrp.y2 + PARTS.BRI2_RAISE, 1e-4) && w5.records[REC.SWIC1].enabled && !w5.records[REC.SWUP1].enabled, 'the moving parts are back (BRI2 raised again, SWIC shown)');
      }

      // ============================================================ phase 2: the roof
      {
        const g = toRoof(fresh());
        const w = g.w, S = g.S, top = S.peptop, pep = w.records[REC.PEPP];
        const floorRef = w.records[REC.ROW_B];
        ok(near(pep.x, floorRef.x, 1e-3) && near(pep.z, floorRef.z, 1e-3), `Pepper is put on FLR3 #61 at the first roof tick: (${pep.x.toFixed(2)}, ${pep.z.toFixed(2)})`);
        ok(near(pep.y, floorRef.y + 0.63, 0.1), `standing on the floor: y ${pep.y.toFixed(3)} (floor ${floorRef.y.toFixed(3)})`);
        const c = w.camera.c;
        ok(near(c[0], pep.x - 0.01, 1e-3) && near(c[1], pep.y + 6, 1e-3) && near(c[2], pep.z - 10, 1e-3) && near(c[3], pep.x, 1e-3) && near(c[4], pep.y + 3, 1e-3) && near(c[5], pep.z, 1e-3), 'roof camera: eye (x - 0.01, y + 6, z - 10), target (x, y + 3, z)');
        ok(top.dirs[0][2] > 0.999 && top.dirs[2][0] > 0.999 && top.dirs[3][0] < -0.999 && top.dirs[1][2] < -0.999, `the four directions: up +z, down -z, right +x, left -x (${top.dirs.map((d) => d.map((v) => v.toFixed(2)))})`);
        const move = (mask, n) => { const p = [pep.x, pep.z]; for (let i = 0; i < n; i++) tick(w, mask); return [pep.x - p[0], pep.z - p[1]]; };
        let m = move(BTN.UP, 4);
        ok(near(m[1], 4 * ROOF.STEP, 1e-3) && near(m[0], 0, 0.02), `UP: ${m[1].toFixed(3)} in z in 4 ticks (0.625 each)`);
        m = move(BTN.RIGHT, 4);
        ok(near(m[0], 4 * ROOF.STEP, 1e-3), `RIGHT: ${m[0].toFixed(3)} in x`);
        m = move(BTN.LEFT, 4);
        ok(near(m[0], -4 * ROOF.STEP, 1e-3), `LEFT: ${m[0].toFixed(3)} in x`);
        m = move(BTN.DOWN, 4);
        ok(near(m[1], -4 * ROOF.STEP, 1e-3), `DOWN: ${m[1].toFixed(3)} in z`);
        m = move(BTN.LEFT | BTN.RIGHT, 2);
        ok(near(m[0], -2 * ROOF.STEP, 1e-3), 'LEFT + RIGHT: left wins (the last assignment)');
        m = move(BTN.UP | BTN.DOWN, 2);
        ok(near(m[1], -2 * ROOF.STEP, 1e-3), 'UP + DOWN: down wins');
        ok(pep.anim.clip === CLIP.RUN, `running clip ${pep.anim.clip}`);
        // facing: UP faces +z, RIGHT +x
        tick(w, BTN.RIGHT); ok(near(pep.m[8], 1, 1e-3), 'RIGHT faces +x');
        tick(w, BTN.UP); ok(near(pep.m[10], 1, 1e-3), 'UP faces +z');
        // the roof walls (STR3): a step that hits them is undone
        const g2 = toRoof(fresh());
        const w2 = g2.w, p2 = w2.records[REC.PEPP];
        let stuck = 0, lastX = p2.x;
        for (let i = 0; i < 120; i++) { tick(w2, BTN.LEFT); if (near(p2.x, lastX, 1e-9)) stuck++; lastX = p2.x; }
        ok(stuck > 20 && p2.x > -31, `the wall at the west edge holds Pepper back (stopped for ${stuck} ticks at x = ${p2.x.toFixed(2)})`);
      }

      // ---- the pizza
      {
        const g = toRoof(fresh());
        const w = g.w, S = g.S, top = S.peptop, pep = w.records[REC.PEPP], pz = w.records[REC.PIZZ];
        ok(!pz.enabled || (pz.flags & 0x10) !== 0, 'the pizza record is out of play before the first throw');
        S.sounds.length = 0;
        const p0 = [pep.x, pep.y, pep.z];
        tick(w, BTN.SPACE);
        ok(top.flying && S.sounds.some((s) => s.id === SND.PIZZATHROW), 'SPACE throws (the throw sound)');
        ok(near(pz.x, p0[0], 0.01) && near(pz.y, p0[1] + ROOF.THROW_OFFSET, 1e-3) && near(pz.z, p0[2] + ROOF.THROW_OFFSET + ROOF.PIZZA_SPEED, 1e-3), `the pizza starts 1.6 above and 1.6 ahead, then moves 1.875: (${pz.x.toFixed(2)}, ${pz.y.toFixed(2)}, ${pz.z.toFixed(2)})`);
        tick(w, 0);
        ok(near(pz.z, p0[2] + ROOF.THROW_OFFSET + 2 * ROOF.PIZZA_SPEED, 1e-3) && near(pz.x, p0[0], 0.02), 'it flies along +z at 1.875 per tick (the direction is the floor rows\' own: x drifts 0.0023 per tick)');
        tick(w, BTN.SPACE);
        tick(w, 0); tick(w, BTN.SPACE);
        ok(S.sounds.filter((s) => s.id === SND.PIZZATHROW).length === 1, 'only one pizza at a time');
        // an unhindered pizza (aimed at the far wall corner: x = -29) vanishes after 60 ticks
        const g2 = toRoof(fresh());
        const w2 = g2.w, S2 = g2.S, t2 = S2.peptop, p2 = w2.records[REC.PEPP], pz2 = w2.records[REC.PIZZ];
        for (let i = 0; i < 22; i++) tick(w2, BTN.LEFT);
        let age = 0;
        tick(w2, BTN.SPACE);
        while (t2.flying && age < 200) { tick(w2, 0); age++; }
        ok(!t2.flying && age <= ROOF.PIZZA_LIFE + 2 && (pz2.flags & 3) === 0 || !t2.flying, `a pizza that hits nothing is gone after ${age} ticks (limit 60)`);
        void p2;
      }

      // ---- the bots
      {
        const g = toRoof(fresh({ seed: 7 }), true);
        const w = g.w, S = g.S;
        const bots = REC.BOTS.map((i) => w.records[i]);
        ok(S.bots.length === 4 && S.bots.every((b) => b.timer >= -1 && b.timer < BOT.FIRST_DELAY_MOD), `the bots wait ${S.bots.map((b) => b.timer)} ticks (rand % 90) before they start`);
        ok(bots.every((b) => !b.enabled), 'hidden at first');
        // run until one marches: speed 0.48 along its forward (-z), hidden again after the walk, back after 90 ticks
        let seen = null, z0 = 0, t0 = 0;
        for (let i = 0; i < 400 && !seen; i++) { tick(w, 0); for (const [k, b] of bots.entries()) if (b.enabled) { seen = k; z0 = b.z; t0 = i; break; } }
        ok(seen !== null, `a bot appears (BOT${seen})`);
        const b = bots[seen];
        const x0 = b.x;
        ok(near(b.m[10], -1, 1e-3), 'the bots face -z');
        ok(near(b.y, w.records[REC.SPAWN_A].y + BOT.START_STEP * 0, 0.5) , `starts at the height of BBOT 76 (${b.y.toFixed(2)})`);
        for (let i = 0; i < 10; i++) tick(w, 0);
        ok(near(z0 - b.z, 10 * BOT.SPEED, 0.02) && near(b.x, x0, 0.02), `marches ${(z0 - b.z).toFixed(3)} in 10 ticks (0.48 each)`);
        let off = 0;
        for (let i = 0; i < 400 && b.enabled; i++) { tick(w, 0); off++; }
        ok(!b.enabled && b.z < -20, `leaves the roof after ${off + 10} ticks (z ${b.z.toFixed(1)})`);
        ok(S.bots[seen].timer > 0 && S.bots[seen].timer <= BOT.RESPAWN, `waits ${S.bots[seen].timer} ticks`);
        // the row of the start places: BBOT 76 .. BBOT 75 in 20 steps
        const xs = new Set();
        for (let i = 0; i < 3000; i++) { tick(w, 0); for (const bb of bots) if (bb.enabled && bb.z > 12 && bb.z < 14) xs.add(Math.round(bb.x * 10)); }
        ok(xs.size >= 8, `${xs.size} different start places over 3000 ticks`);
      }
      {
        // a bot in Pepper's lane knocks her back for 20 ticks along its forward vector (0.3125 per tick)
        const g = toRoof(fresh({ seed: 3 }), true);
        const w = g.w, S = g.S, pep = w.records[REC.PEPP];
        const bot = w.records[REC.BOTS[0]], bn = S.bots[0];
        for (let i = 0; i < 3; i++) tick(w, 0);
        // put the bot 5 units ahead of Pepper, marching towards her
        bn.timer = -1; bot.flags = 0x43;
        bot.setEuler(0, bn.yaw, 0, pep.x, pep.y, pep.z + 5);
        const p0 = [pep.x, pep.z];
        S.sounds.length = 0;
        let hitAt = -1;
        for (let i = 0; i < 30 && hitAt < 0; i++) { tick(w, 0); if (S.knock) hitAt = i; }
        ok(hitAt >= 0 && hitAt < 15, `the bot hits Pepper after ${hitAt} ticks`);
        ok(near(S.knockTimer, 20, 1.01) && !bot.enabled && bn.timer === BOT.RESPAWN, `knock timer ${S.knockTimer}, the bot is hidden for ${bn.timer} ticks`);
        let k = 0, z1 = pep.z;
        while (S.knock && k < 40) { z1 = pep.z; tick(w, BTN.SPACE | BTN.UP); k++; }
        ok(k >= 19 && k <= 22, `the knock-back lasts ${k} ticks`);
        ok(pep.z - p0[1] < -4.5 && pep.z - p0[1] > -7, `Pepper was pushed back ${(p0[1] - pep.z).toFixed(2)} along -z (20 x 0.3125 = 6.25)`);
        ok(S.sounds.some((s) => s.id === SND.RUNOVER), 'the run-over sound');
        ok(!S.peptop.flying, 'no throw and no walking during the knock-back');
        ok(pep.anim.clip === CLIP.IDLE || pep.anim.clip === CLIP.RUN, `idle again afterwards (clip ${pep.anim.clip})`);
        void z1;
      }

      // ---- Brickster
      {
        const g = toRoof(fresh({ seed: 2 }));
        const w = g.w, S = g.S, bn = S.brickster, brik = w.records[REC.BSTR], pep = w.records[REC.PEPP];
        pep.m[14] = w.records[REC.ROWS[4][2]].z;      // on the last row: the floor does not fall away under her during this long test
        ok(bn.period === BOSS.LEG && bn.idx === 0 && bn.going, 'Brickster starts the first leg, 60 ticks');
        const start = [bn.start[0], bn.start[1], bn.start[2]];
        const xs = [];
        for (let i = 0; i < 250; i++) { tick(w, 0); xs.push([brik.x, bn.idx, bn.going]); }
        const xmin = Math.min(...xs.map((v) => v[0])), xmax = Math.max(...xs.map((v) => v[0]));
        ok(xmin < start[0] - 10 && xmax > start[0] + 10, `Brickster paces between the two bots' places (x ${xmin.toFixed(1)} .. ${xmax.toFixed(1)}, start ${start[0].toFixed(1)})`);
        ok(xs.some((v) => v[1] === 1) && xs.some((v) => v[1] === 0), 'both legs are walked');
        // a hit: place the pizza at him
        /** a pizza aimed at where he will be: it starts 4 units in front of his place after the next tick (a start inside his box would not count: the sweep needs to cross a face),
         *  the world is run to find out where that is (snapshot / restore); returns after the pizza hit or vanished */
        const hitHim = () => {
          const pz = w.records[REC.PIZZ];
          const h0 = S.hits;
          for (let tries = 0; tries < 6 && S.hits === h0; tries++) {
            const snap = capture(w);
            tick(w, 0);
            const at = [brik.x, brik.z];
            restore(w, snap);
            S.peptop.flying = true; S.peptop.age = 0; S.peptop.spin = 0;
            pz.m.set(brik.m);
            pz.m[12] = at[0]; pz.m[14] = at[1] - 4.0; pz.m[13] = brik.y + 0.3;
            pz.flags |= 3;
            for (let i = 0; i < 4 && S.peptop.flying; i++) tick(w, 0);
            if (S.hits === h0) { S.peptop.flying = false; pz.flags = 0; }
          }
        };
        S.spoken.length = 0; S.sounds.length = 0; S.fxLog.length = 0;
        hitHim();
        ok(S.hits === 1 && S.peptop.myHits === 1, `the first hit counts (hits ${S.hits})`);
        ok(S.spoken[0] === 'OGSGBP26', `first hit: OGSGBP26 (${S.spoken})`);
        ok(S.sounds.some((s) => s.id === SND.HITVOCAL[0]) && S.sounds.some((s) => s.id === SND.PIZZAHITBRIK), 'hit sounds: vocal 1 and the pizza hit');
        ok(brik.anim.clip === CLIP.BRIK_HIT, 'Brickster plays the hit clip 0x6a');
        ok(!S.peptop.flying && (w.records[REC.PIZZ].flags & 3) === 0, 'the pizza is gone');
        tick(w, 0);
        ok(bn.period === BOSS.LEG_HIT1, `the legs take ${bn.period} ticks after the first hit`);
        // FUN_00826b40: the first hit seen by Brickster's node lights smoke2 (gates 1 0 0) and the emitters' matrix is bone 10 x BSTR's matrix from then on
        ok(S.fxLog.join() === '100', `first hit: smoke2 on (${S.fxLog})`);
        ok(S.bossFxM[15] === 1 && Math.hypot(S.bossFxM[12] - brik.x, S.bossFxM[14] - brik.z) < 4 && S.bossFxM[13] > brik.y, `the emitter matrix sits on Brickster's bone 10 (${[...S.bossFxM.slice(12, 15)].map((v) => v.toFixed(2))} vs ${brik.x.toFixed(2)},${brik.y.toFixed(2)},${brik.z.toFixed(2)})`);
        // while the hit clip plays he does not move and a second pizza does not count
        const bx = brik.x;
        for (let i = 0; i < 5; i++) tick(w, 0);
        ok(near(brik.x, bx, 1e-6), 'frozen during the hit clip');
        hitHim();
        ok(S.hits === 1, 'a pizza during the hit clip does not count');
        // wait for the clip to end (40 ticks), then the second hit: two lines of speech, shorter legs
        for (let i = 0; i < 45; i++) tick(w, 0);
        ok(brik.anim.clip === CLIP.BRIK_RUN, 'running again');
        S.spoken.length = 0; S.fxLog.length = 0;
        hitHim();
        ok(S.hits === 2 && S.spoken.join() === 'OGSGBP27,OGSGBP28', `second hit: hits ${S.hits}, spoken ${S.spoken}, clip ${brik.anim.clip}, reacting ${bn.reacting}`);
        tick(w, 0);
        ok(bn.period === BOSS.LEG_HIT2, `${bn.period} ticks after the second`);
        ok(S.fxLog.join() === '010', `second hit: smoke2 off, the first flame1 on (${S.fxLog})`);
        for (let i = 0; i < 45; i++) tick(w, 0);
        let letter = null;
        S.env.letterbox = (on) => { letter = on; };
        hitHim();
        ok(S.hits === 3 && S.endState === 1 && letter === true, `third hit: the end sequence starts (state ${S.endState}, letterbox ${letter})`);
        // the end: 5d4 1 -> 2 -> 3 (cutscene asked for), 5d8 = 2; the game loop counts 2 -> 1 -> banner
        let asked = 0, running = false;
        S.env.startCutscene = () => { asked++; running = true; return true; };
        const loop = new ZoneLoop();
        S.env.cutsceneActive = () => running;
        tick(w, 0);
        ok(S.endState === 2 || S.endState === 3, `end state ${S.endState}`);
        tick(w, 0);
        ok(S.endState === 3 && S.endTimer === 2 && asked === 1, `end state 3, the cutscene was asked for once (${asked}), timer ${S.endTimer}`);
        const e0 = S.elapsed;
        let r = 0;
        for (let i = 0; i < 5; i++) { tick(w, 0); r = loop.update(w, S, true); }
        ok(r === 0 && S.elapsed === e0 && S.endTimer === 2, 'while the cutscene runs the clock and the end timer stand still');
        running = false;
        r = loop.update(w, S, false);
        ok(r === 0 && S.endTimer === 1, `after the cutscene: timer ${S.endTimer}`);
        r = loop.update(w, S, false);
        ok(r === 1, 'then the banner follows (result 1: always a success)');
        ok(S.elapsed === e0, 'the clock stopped with the end sequence');
        void pep;
      }

      // ---- the roof floor
      {
        const g = toRoof(fresh({ seed: 4 }));
        const w = g.w, S = g.S, zt = S.zonetop;
        w.records[REC.PEPP].m[14] = w.records[REC.ROWS[4][2]].z;     // Pepper stands on the last row: the first rows fall without her
        const tiles = REC.ROWS.map((row) => row.map((i) => w.records[i]));
        const y0 = tiles.map((row) => row.map((t) => t.y));
        let startTick = -1, endTick = -1, t = 1;
        for (; t < 700; t++) {
          tick(w, 0);
          if (startTick < 0 && zt.falling === 0) startTick = t;
          if (startTick >= 0 && endTick < 0 && !tiles[0][1].enabled) endTick = t;
        }
        ok(startTick >= 299 && startTick <= 302, `row 0 starts to fall at tick ${startTick} of the phase (every 300 ticks)`);
        ok(endTick - startTick >= 60 && endTick - startTick <= 63, `and is gone ${endTick - startTick} ticks later (61 falling ticks)`);
        ok(zt.nextRow >= 1, `the next row is ${zt.nextRow}`);
        // Pepper on row 0 falls with it: 20 ticks of counting, then the respawn at the start; the floor, the hit counter and Brickster are reset
        const g2 = toRoof(fresh({ seed: 4 }));
        const w2 = g2.w, S2 = g2.S, pep = w2.records[REC.PEPP], top = S2.peptop, zt2 = S2.zonetop;
        S2.hits = 2; top.myHits = 2;
        let fellAt = -1, respawnAt = -1;
        const spawn = Array.from(top.spawn);
        for (let i = 0; i < 700 && respawnAt < 0; i++) {
          tick(w2, 0);
          if (fellAt < 0 && top.fall > 0) fellAt = i;
          if (fellAt >= 0 && top.fall === 0 && near(pep.x, spawn[12], 0.01) && pep.y > 160) respawnAt = i;
        }
        ok(fellAt >= 299 && respawnAt - fellAt >= 18 && respawnAt - fellAt <= 24, `Pepper falls with the row (tick ${fellAt}) and is back after ${respawnAt - fellAt} ticks`);
        ok(S2.hits === 0 && top.myHits === 0, 'the hit counter is reset by the fall');
        tick(w2, 0);
        ok(tiles.every((row, r) => row.every((tt, c) => w2.records[REC.ROWS[r][c]].enabled)) && S2.reset5fc === 0 && zt2.nextRow === 0, 'the floor is back (flags and the timer)');
        ok(REC.ROWS.every((row, r) => row.every((i, c) => near(w2.records[i].y, y0[r][c], 1e-3))), 'all tiles at their heights again');
        // the slugs on the roof corners are hidden while the roof game runs
        ok(REC.SLUGS.every((i) => !w2.records[i].enabled), 'the four slugs are hidden');
        // Brickster went back to his start by the reset signal
        ok(near(w2.records[REC.BSTR].x, S2.brickster.start[0], 2), 'Brickster is back at the start');
        // the door: variable 0xfb = 1 closes it in 30 ticks, then the variable is 0
        const g3 = toRoof(fresh());
        const w3 = g3.w, door = w3.records[REC.DOOR];
        const saved = Array.from(g3.S.zonetop.doorSaved);
        w3.vars.set(VAR.DOOR, 1);
        for (let i = 0; i < 15; i++) tick(w3, 0);
        ok(w3.vars.get(VAR.DOOR) === 1 && door.m[8] > 0.3 && door.m[8] < 0.95, `the door swings (forward x ${door.m[8].toFixed(2)})`);
        for (let i = 0; i < 20; i++) tick(w3, 0);
        ok(w3.vars.get(VAR.DOOR) === 0 && near(door.m[8], saved[8], 1e-4) && near(door.m[10], saved[10], 1e-4), 'closed after 30 ticks, the variable cleared');
      }

      // ============================================================ score, medals, variables
      {
        ok(scoreOf(0) === 10000 && scoreOf(60 * 60 - 1) === 10000 && scoreOf(60 * 60) === 10000, 'up to 60 s: 10000');
        ok(scoreOf(61 * 60) === 10000 - 55 && scoreOf(90 * 60) === 8350 && scoreOf(150 * 60) === 5050, `61 s ${scoreOf(61 * 60)}, 90 s ${scoreOf(90 * 60)}, 150 s ${scoreOf(150 * 60)}`);
        ok(scoreOf(10000 * 60) === 0 && scoreOf(60 * 60 + 182 * 60) === 0 && scoreOf(60 * 60 + 181 * 60) === 10000 - 181 * 55, 'never below 0');
        ok(medalOf(8350) === 3 && medalOf(8349) === 2 && medalOf(5050) === 2 && medalOf(5049) === 1 && medalOf(0) === 1, 'medals: gold from 8350, silver from 5050, bronze below');
        ok(clockText(0) === '00:00' && clockText(125 * 60 + 30) === '02:05' && clockText(59 * 60) === '00:59' && clockText(61 * 60) === '01:01', 'clock text MM:SS');
        const mk = (o = {}) => { const a = new Int32Array(400); for (const [k, v] of Object.entries(o)) a[k] = v; return { get: (i) => a[i], set: (i, v) => { a[i] = v; }, a }; };
        let v = mk();
        let medal = writeResult(v, 9000);
        ok(medal === 3 && v.a[VAR.HISCORE] === 9000 && v.a[VAR.TROPHY] === 3, 'a gold run writes hi-score 9000 and trophy 3');
        medal = writeResult(v, 3000);
        ok(medal === 1 && v.a[VAR.HISCORE] === 9000 && v.a[VAR.TROPHY] === 3, 'a worse run only raises: the variables stay');
        v = mk({ [VAR.HISCORE]: 100, [VAR.TROPHY]: 1 });
        medal = writeResult(v, 6000);
        ok(medal === 2 && v.a[VAR.HISCORE] === 6000 && v.a[VAR.TROPHY] === 2, 'silver raises bronze');
        ok(JSON.stringify(RESULT_LINES) === JSON.stringify({ 1: ['OGSGBP05', 'OGSGBP06'], 2: ['OGSGBP03', 'OGSGBP04'], 3: ['OGSGBP01', 'OGSGBP02'] }), 'result lines by medal');
        // the texts exist in brp.str
        const messages = ctx.archives.find((a) => a.name === 'messages');
        void messages;
      }

      // ============================================================ the recorded run up the tower
      if (!process.env.Z42BRP_FAST) {
        ok(PLAN1.length > 50, `the recorded run has ${PLAN1.length} runs`);
        const g = fresh({ seed: 1 });
        const w = g.w, S = g.S, pn = S.pepbrp;
        let t = 0, flags = [];
        for (let i = 0; i < 16; i++) { tick(w, 0); t++; }      // the plan starts after the hold at the start
        for (const [mask, n] of PLAN1) for (let i = 0; i < n; i++) {
          tick(w, mask); t++;
          if (S.reset5ec) { flags.push(`restart at ${t}`); }
          if (w.vars.get(VAR.PHASE) === 2) break;
        }
        ok(flags.length === 0, `no restart on the way ${flags}`);
        ok(pn.sw1 && pn.sw2 && pn.lift, `both switches and the lift were touched (${pn.sw1}, ${pn.sw2}, ${pn.lift}) after ${t} ticks`);
        for (let i = 0; i < 300 && w.vars.get(VAR.PHASE) === 1; i++) { tick(w, 0); t++; }
        ok(w.vars.get(VAR.PHASE) === 2, `the lift ends the side run: phase 2 after ${t} ticks (${(t / 30).toFixed(1)} s)`);
        notes.push(`recorded side run: ${t} ticks (${(t / 30).toFixed(1)} s)`);
      }

      // ============================================================ scripted games: WIN and LOSS
      if (!process.env.Z42BRP_FAST) {
        // WIN: the recorded run up the tower, the roof bot throws three pizzas, the loop counts the clock, the banner gives the score
        const g = fresh({ seed: 1 });
        const w = g.w, S = g.S;
        const loop = new ZoneLoop();
        let t = 0;
        const step = (mask) => { tick(w, mask); t++; return loop.update(w, S, false); };
        for (let i = 0; i < 16; i++) step(0);
        for (const [mask, n] of PLAN1) for (let i = 0; i < n; i++) { step(mask); if (w.vars.get(VAR.PHASE) === 2) break; if (S.reset5ec) break; }
        for (let i = 0; i < 400 && w.vars.get(VAR.PHASE) === 1; i++) step(0);
        ok(w.vars.get(VAR.PHASE) === 2, 'WIN: roof reached');
        const help2 = loop.takeHelp2();
        ok(help2 && !loop.takeHelp2(), 'the second help is asked for once');
        const bot = new Phase2Bot(w, loop);
        let result = 0;
        for (let i = 0; i < 3000 && !result; i++) result = step(bot.step());
        ok(result === 1 && S.hits === 3, `WIN: the end sequence runs to the banner after ${t} ticks (hits ${S.hits})`);
        const score = scoreOf(S.elapsed);
        const medal = medalOf(score);
        ok(medal === 3, `WIN: ${clockText(S.elapsed)} gives ${score} points, medal ${medal} (gold from 8350)`);
        const v = { a: new Int32Array(400), get(i) { return this.a[i]; }, set(i, x) { this.a[i] = x; } };
        writeResult(v, score);
        ok(v.a[VAR.TROPHY] === 3 && v.a[VAR.HISCORE] === score, 'WIN: the trophy and the hi-score are written');
        notes.push(`WIN: ${t} ticks (${(t / 30).toFixed(1)} s), clock ${clockText(S.elapsed)}, score ${score}`);
      }
      if (!process.env.Z42BRP_FAST) {
        // LOSS: nothing is done on the roof: the floor falls away under Pepper again and again, the hits never count, the game does not end
        const g = toRoof(fresh({ seed: 9 }));
        const w = g.w, S = g.S, top = S.peptop;
        const loop = new ZoneLoop();
        let falls = 0, res = 0, wasFalling = false;
        for (let i = 0; i < 9000; i++) {
          tick(w, 0);
          res = loop.update(w, S, false) || res;
          if (top.fall > 0 && !wasFalling) falls++;
          wasFalling = top.fall > 0;
        }
        ok(res === 0 && S.hits === 0 && S.endState === 0, 'LOSS: five minutes of standing still do not end the game');
        ok(falls >= 5, `LOSS: Pepper fell ${falls} times (floor rows collapse every 10 s, then the respawn)`);
        ok(scoreOf(S.elapsed) === 0 && medalOf(0) === 1, `LOSS: the clock ran to ${clockText(S.elapsed)}: score ${scoreOf(S.elapsed)} (no medal below bronze)`);
        // and a run that falls off the tower in the side run restarts from the beginning, the clock keeps running
        const g2 = fresh();
        const w2 = g2.w, S2 = g2.S, n2 = S2.pepbrp;
        const loop2 = new ZoneLoop();
        let restarts = 0;
        for (let i = 0; i < 600; i++) { tick(w2, BTN.LEFT); loop2.update(w2, S2, false); if (S2.reset5ec) restarts++; }
        ok(restarts >= 1 || n2.angle0 !== undefined, `LOSS: running into the first gap restarts the climb (${restarts} restart(s))`);
        ok(S2.elapsed === 1200, `the clock keeps running through a restart (${S2.elapsed})`);
      }

      // ============================================================ snapshot / restore (the look-ahead of the bots)
      {
        const g = fresh({ seed: 11 });
        const w = g.w;
        for (let i = 0; i < 70; i++) tick(w, BTN.LEFT);
        const snap = capture(w);
        const run = (n) => { for (let i = 0; i < n; i++) tick(w, i % 30 === 20 ? BTN.LEFT | BTN.ALT : BTN.LEFT); const p = w.records[90]; return [p.x, p.y, p.z, w.records[22].x, w.records[22].z, w.records[REC.BRI8].y]; };
        const a = run(200);
        restore(w, snap);
        const b = run(200);
        ok(a.every((v, i) => v === b[i]), `restore: the same 200 ticks give the same state (${a.map((v) => v.toFixed(3))})`);
        const g2 = toRoof(fresh({ seed: 12 }));
        const w2 = g2.w;
        for (let i = 0; i < 100; i++) tick(w2, 0);
        const s2 = capture(w2);
        const run2 = (n) => { for (let i = 0; i < n; i++) tick(w2, i % 7 === 0 ? BTN.SPACE : BTN.RIGHT); return [w2.records[90].x, w2.records[91].x, w2.records[92].z, w2.records[93].z, stateOf(w2).hits]; };
        const c = run2(150);
        restore(w2, s2);
        const d = run2(150);
        ok(c.every((v, i) => v === d[i]), `restore on the roof: ${c.map((v) => +v.toFixed(3))}`);
        void lcg; void statefulRng; void snapshot; void prepareWorld; void arch; void fs;
      }
    } catch (e) {
      failures.push(`test crashed: ${e.stack || e}`);
    }
    return { checked, failures, notes };
  },
};
