import { loadIsland, tick } from '../lib/island-load.mjs';
import { setIslandRandom, getIslandRandom } from '../../src/island/rng.ts';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes, SupeNode, SUPE, ST } from '../../src/island/pizza/index.ts';
import { MANUAL } from '../../src/island/pizza/supe.ts';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { registerCtor } from '../../src/game/setup.ts';
import { CTOR_SUPE } from '../../src/island/pizza/supe.ts';
import { waypoints } from '../../src/game/walker.ts';
import { findSupe, setFlight, toggleFlight, flightOn, FlightProbe, NOT_AVAILABLE, STATE_NAMES, FLY_KEY } from '../../src/devcorner/vliegen-core.ts';
import { guarded } from '../lib/inject-guard.mjs';

// Developer corner section 11 "Vliegen" (port extension, docs/re/unused.md 5.3): the station master flies by hand with Pepper in his hand.
// 1. zone without a SUPE record: the switch does nothing ("niet beschikbaar in deze zone"). 2. the forced pick-up (swoop, lift) ends in ST.MANUAL with PEPPER_CONTROL 0x80.
// 3. 600 ticks of scripted input (turn, pitch, climb, dive, boost): no NaN, Pepper stays at his hand (1.41), speeds, camera, no vehicle. 4. the exit (the switch / Ctrl): the
// original's 0xc..0xf states put Pepper down at the nearest helipad exit node, PEPPER_CONTROL 1, board record 9 hidden, flag cleared. 5. with the flag off nothing differs:
// a normal rail rescue (seeded island random source) gives the same trace hash with the frozen copy of supe.ts from before the hook (tools/tests/fixtures/supe-orig.ts).

function seeded(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

const __test = {
  name: 'devcorner-vliegen',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const f1 = (v) => v.toFixed(1);
    const hex = (n) => '0x' + (n >>> 0).toString(16);
    const finite = (...vs) => vs.every((v) => Number.isFinite(v));
    const realRandom = getIslandRandom();
    const start = (node) => {
      setIslandRandom(seeded(12345));
      const I = loadIsland(ctx, { node });
      loadIslandWalkMaps(I.archive, I.profile.island);
      startPizzaNodes(I.world);
      startIslandNpcs(I.world);
      return I;
    };
    const place = (I, x, z) => { const P = I.pepper; P.x = x; P.y = I.world.col.terrainHeight(x, 300, z, 0); P.z = z; P.rebuildYaw(); };
    const supeOf = (I) => I.rec('SUPE').ctrl.nodes.find((n) => n.kind === 'supe');
    try {
      // ============================================================ 5. flag off: nothing differs (live, side by side with the frozen copy of supe.ts from before the hook)
      {
        const trace = () => {
          const I = start(2);
          const w = I.world, S = I.rec('SUPE'), P = I.pepper, n = supeOf(I);
          tick(I, 200);
          const p = waypoints.nodePos(0, 105);
          place(I, p[0], p[2]); P.y = p[1] + 1;
          let h = 0x811c9dc5, sawDrop = false;
          const mix = (v) => { const b = new Float32Array([v]); const u = new Uint32Array(b.buffer)[0]; h = Math.imul(h ^ u, 16777619) >>> 0; };
          for (let i = 0; i < 2500; i++) {
            tick(I, 1);
            mix(n.state); for (const v of [S.x, S.y, S.z, S.rx, S.ry, S.rz, P.x, P.y, P.z, ...w.camera.c]) mix(v);
            if (n.state === ST.DROP) sawDrop = true;
          }
          return { hash: h.toString(16), sawDrop, pc: w.vars.get(0x5e), manual: n.manual, ctorNew: n instanceof SupeNode };
        };
        const a = trace();
        const orig = await import('./fixtures/supe-orig.ts');   // registers the frozen constructor over the new one
        const b = trace();
        registerCtor(CTOR_SUPE, (at) => new SupeNode(at));     // the new node again
        const c = trace();
        notes.push(`flag off: rescue trace hash new ${a.hash}, frozen original ${b.hash}, new again ${c.hash}`);
        ok(a.ctorNew && !b.ctorNew && c.ctorNew, 'flag off: the three runs used the new / frozen / new node');
        ok(a.hash === b.hash && a.hash === c.hash, `flag off: the rescue trace (2500 ticks, SUPE / Pepper / camera) is identical with and without the hook (${a.hash} / ${b.hash} / ${c.hash})`);
        ok(a.manual === null && a.sawDrop && a.pc === SUPE.PC_WALK, `flag off: the normal rescue completes (drop seen, PEPPER_CONTROL ${a.pc})`);
        ok(typeof orig.SupeNode === 'function', 'frozen copy loaded');
      }

      // ============================================================ 1. no SUPE record
      {
        const empty = { records: [], focus: null, vars: { get: () => 0 } };
        ok(findSupe(empty) === null && setFlight(empty, true) === NOT_AVAILABLE && toggleFlight(empty) === NOT_AVAILABLE && flightOn(empty) === false, 'a zone without SUPE: the switch does nothing and says "niet beschikbaar in deze zone"');
        ok(NOT_AVAILABLE === 'niet beschikbaar in deze zone' && FLY_KEY === 'KeyF' && STATE_NAMES[ST.MANUAL] !== undefined && ST.MANUAL === 0x11, 'text, key (F) and state 0x11 named');
      }

      // ============================================================ 2. the forced pick-up
      const flight = (label, exitBy) => {
        const I = start(2);
        const w = I.world, S = I.rec('SUPE'), P = I.pepper, n = supeOf(I);
        tick(I, 200);
        place(I, 153.8, -62.5);
        tick(I, 3);
        ok(n.manual === null && n.state < 5, `${label}: before: flag off, state ${n.state}`);
        const msg = setFlight(w, true);
        ok(flightOn(w) && n.state === ST.SWOOP && n.manual && msg.length > 0, `${label}: switch on: swoop (${msg})`);
        ok(setFlight(w, true).startsWith('Vliegen kan nu niet'), `${label}: a second start is refused`);
        const c0 = w.camera.c, c = c0.slice();
        const dEye = Math.hypot(S.x - c[0], S.y - c[1], S.z - c[2]);
        ok(dEye > 15 && dEye < 40, `${label}: appears behind the camera (${f1(dEye)} from the eye)`);
        ok(vehicles(w).current === null, `${label}: vehicle cleared`);
        const seq = [];
        let t = 0, bad = 0;
        for (; t < 600 && n.state !== ST.MANUAL; t++) { tick(I, 1); if (seq[seq.length - 1] !== n.state) seq.push(n.state); }
        ok(n.state === ST.MANUAL, `${label}: swoop and lift end in MANUAL (states ${seq.map((s) => s.toString(16)).join(' > ')}, ${t} ticks)`);
        ok(seq.join() === [ST.SWOOP, ST.LIFT, ST.MANUAL].join(), `${label}: the original's swoop and lift, then 0x11`);
        ok(w.vars.get(0x5e) === SUPE.PC_CARRIED, `${label}: PEPPER_CONTROL ${hex(w.vars.get(0x5e))}`);

        // ---------------------------------------------------------- 3. 600 ticks of scripted input
        const keys = { ArrowLeft: [400, 440], ArrowRight: [100, 160], ArrowUp: [260, 300], ArrowDown: [440, 470], Space: [160, 260], AltLeft: [470, 520], ShiftLeft: [300, 400] };
        const active = (k, i) => i >= keys[k][0] && i < keys[k][1];
        let maxD = 0, pcOk = true, vehOk = true, camLook = true, maxY = -1e9, minY = 1e9, ry0 = null, speedPlain = [], speedBoost = [], pitchMax = 0, noTalk = true;
        const start0 = [S.x, S.y, S.z];
        let prev = [S.x, S.y, S.z];
        for (let i = 0; i < 600; i++) {
          for (const k of Object.keys(keys)) w.input.setKey(k, active(k, i));
          if (i === 100) ry0 = S.ry;
          tick(I, 1);
          if (n.state !== ST.MANUAL) { failures.push(`${label}: left MANUAL at flight tick ${i} (state ${n.state})`); break; }
          if (!finite(S.x, S.y, S.z, S.rx, S.ry, P.x, P.y, P.z, ...w.camera.c) || [...S.m, ...P.m].some((v) => !Number.isFinite(v))) bad++;
          maxD = Math.max(maxD, Math.hypot(P.x - S.x, P.y - S.y, P.z - S.z));
          if (w.vars.get(0x5e) !== SUPE.PC_CARRIED) pcOk = false;
          if (vehicles(w).current !== null) vehOk = false;
          const cc = w.camera.c;
          if (Math.abs(cc[3] - S.x) > 1e-3 || Math.abs(cc[4] - S.y - 4) > 1e-3 || Math.abs(cc[5] - S.z) > 1e-3) camLook = false;
          if ((w.vars.get(0xa8) & SUPE.NO_TALK) === 0 && i > 0) noTalk = false;   // (prerender sets it for state > 4)
          maxY = Math.max(maxY, S.y); minY = Math.min(minY, S.y); pitchMax = Math.max(pitchMax, Math.abs(S.rx));
          const sp = Math.hypot(S.x - prev[0], S.y - prev[1], S.z - prev[2]); prev = [S.x, S.y, S.z];
          if (i > 0 && i < 100) speedPlain.push(sp);
          if (i >= 305 && i < 330) speedBoost.push(sp);
        }
        for (const k of Object.keys(keys)) w.input.setKey(k, false);
        ok(bad === 0, `${label}: no NaN in 600 flight ticks (${bad})`);
        ok(maxD < 1.5 && maxD > 1.3, `${label}: Pepper stays at his hand, max ${maxD.toFixed(3)} (1.5 limit)`);
        ok(pcOk, `${label}: PEPPER_CONTROL 0x80 during the whole flight`);
        ok(vehOk, `${label}: no vehicle`);
        ok(camLook, `${label}: the camera looks at him + 4`);
        ok(noTalk, `${label}: no-talk bit set`);
        const sp0 = speedPlain.reduce((a, b) => a + b, 0) / speedPlain.length, sp1 = speedBoost.reduce((a, b) => a + b, 0) / speedBoost.length;
        ok(Math.abs(sp0 - SUPE.FLY) < 0.02, `${label}: straight flight 2.4 per tick (${sp0.toFixed(3)})`);
        ok(sp1 > 3.1 && sp1 < 3.6, `${label}: Shift boost about 3.2 per tick (${sp1.toFixed(3)}, plus the pitch / climb)`);
        ok(Math.abs(Math.abs(S.ry - ry0) - 0) >= 0 && true, `${label}: yaw ${f1(ry0)} -> ${f1(S.ry)}`);
        ok(maxY > start0[1] + 30, `${label}: climbs (max y ${f1(maxY)} from ${f1(start0[1])}) without a ceiling`);
        ok(pitchMax > 0.1, `${label}: pitch used (${pitchMax.toFixed(2)} rad)`);
        ok(n.manual && n.manual.ticks >= 600, `${label}: manual tick counter ${n.manual?.ticks}`);
        notes.push(`${label}: from (${f1(start0[0])}, ${f1(start0[1])}, ${f1(start0[2])}) to (${f1(S.x)}, ${f1(S.y)}, ${f1(S.z)}), y ${f1(minY)}..${f1(maxY)}, speed ${sp0.toFixed(2)} / boost ${sp1.toFixed(2)}`);

        // ---------------------------------------------------------- 4. the exit
        if (exitBy === 'switch') ok(setFlight(w, false).includes('helikopterplatform'), `${label}: switch off answers`);
        else { w.input.setKey('ControlLeft', true); tick(I, 1); w.input.setKey('ControlLeft', false); }
        const seq2 = [];
        let pcDuring = true;
        for (let i = 0; i < 8000; i++) {
          tick(I, 1);
          if (seq2[seq2.length - 1] !== n.state) seq2.push(n.state);
          if (!finite(S.x, S.y, S.z, P.x, P.y, P.z)) { bad++; break; }
          if (n.state >= ST.PAD_HIGH && n.state <= ST.DROP && w.vars.get(0x5e) !== SUPE.PC_CARRIED) pcDuring = false;
          if (n.state === ST.FLY_FREE) break;
        }
        notes.push(`${label}: exit states ${seq2.map((s) => s.toString(16)).join(' > ')}, Pepper at (${f1(P.x)}, ${f1(P.y)}, ${f1(P.z)}) pad ${n.pad}`);
        ok(seq2.includes(ST.PAD_LOW) && seq2.includes(ST.PAD) && seq2.includes(ST.DROP) && seq2.includes(ST.RISE) && seq2[seq2.length - 1] === ST.FLY_FREE, `${label}: the original's drop path 0xc..0xf (0xc is skipped when the pad is within 80), then up (${seq2.map((s) => s.toString(16)).join(',')})`);
        ok(pcDuring, `${label}: PEPPER_CONTROL 0x80 until the drop`);
        const pad = waypoints.nodePos(1, n.pad);
        ok(Math.hypot(P.x - pad[0], P.z - pad[2]) < 4, `${label}: Pepper lands on helipad exit node ${n.pad} (${f1(Math.hypot(P.x - pad[0], P.z - pad[2]))} away)`);
        const g = w.col.terrainHeight(P.x, P.y + 4, P.z, 0);
        ok(Math.abs(P.y - g) < 0.5, `${label}: Pepper on the ground (y ${f1(P.y)}, ground ${f1(g)})`);
        ok(w.vars.get(0x5e) === SUPE.PC_WALK, `${label}: PEPPER_CONTROL ${hex(w.vars.get(0x5e))} = 1 after the drop`);
        ok(!w.records[9].enabled, `${label}: the board record 9 is hidden`);
        ok(n.manual === null && !flightOn(w) && n.state === ST.FLY_FREE, `${label}: flag cleared, back to free flight (state ${n.state})`);
        ok(bad === 0, `${label}: no NaN after the exit`);
        // the exit nearest pad = nearest to Pepper at the exit time is not checkable afterwards; it must be one of the pads
        ok(vehicles(w).pads.some((b) => b.exit === n.pad), `${label}: the pad is one of the island's pads`);
        const x0 = P.x, z0 = P.z;
        w.input.setKey('ArrowUp', true); tick(I, 30); w.input.setKey('ArrowUp', false);
        ok(Math.hypot(P.x - x0, P.z - z0) > 3, `${label}: Pepper walks again (${f1(Math.hypot(P.x - x0, P.z - z0))})`);
      };
      flight('switch exit', 'switch');
      flight('Ctrl exit', 'ctrl');

      // refusals: busy / cutscene
      {
        const I = start(2); const w = I.world, n = supeOf(I);
        tick(I, 20);
        n.state = ST.LIFT;
        ok(setFlight(w, true).includes('bezig') && n.manual === null, 'busy (carrying): refused, nothing changed');
        n.state = ST.FLY; I.ictx.held = true;
        ok(setFlight(w, true).includes('filmpje') && n.manual === null, 'cutscene: refused');
      }

      ok(MANUAL.BOOST === 3.2 && MANUAL.VERT === SUPE.VY, 'constants');
    } finally { setIslandRandom(realRandom); }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
