// M5 audit z50LTC, the ORACLE test: the original's People update FUN_00839e20, pre-render FUN_0083a292 and pepswitc FUN_0083ab7b / 0083a9e0 / 0083aa48 / 0083aa8d run in the x86
// interpreter (tools/lib/ltc-emu.mjs) next to the port (PeopleNode / LtcPepSwitch). Same scripted keys and positions, compared every tick for all 26 people and Pepper: record flags and
// matrices, node fields (talk loops, pushed, twinkle, saved place, reaction flag), clips and frames, the globals (toggle, timer, candidate, candidate distance), the HUD name / job text,
// the cinematic bars, var 0x5e, the update return codes and the effect / sound / alignment calls in order.
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { LtcEmu, G, RECORDS_BASE } from '../lib/ltc-emu.mjs';
import { buildLtc } from '../../src/zones/z50LTC.ts';
import { persisted, PC_TALK } from '../../src/zones/z50LTC/people.ts';
import { AnimInstance } from '../../src/game/anim.ts';
import { B } from '../../src/game/input.ts';

const TOL = 2e-5;
export default {
  name: 'm5-audit-z50LTC-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);

    const run = (label, scriptOf) => {
      persisted.toggle = 0;
      const L = loadZone(ctx, 'z50LTC');
      const room = buildLtc(L.world, L, L.pe);
      const w = L.world, p = L.pepper, g = room.g, recs = w.records;
      // the effect calls of the port in the oracle's vocabulary
      const plog = [];
      const rowOfRec = new Map(room.people.map((q, i) => [q.entry.record, i]));
      g.onTwinkle = (rec, start) => plog.push(`tw ${rowOfRec.get(rec.index)} ${start ? 2 : 1}`);
      g.onPaul = (rec, start) => { const r = rowOfRec.get(rec.index), m = start ? 2 : 1; plog.push(`paul ${r} ${m}`, `paul ${r} ${m}`); };
      g.playSound = (id) => plog.push(`snd ${id}`);
      g.alignPepper = () => plog.push('align');
      // the oracle: its own world for the animation instances, the same start state
      const L2 = loadZone(ctx, 'z50LTC');
      const rig = L2.rigs.get('MFIG');
      const anims = new Map();
      anims.set(p.index, L2.pepper.anim);
      for (const q of room.people) { const a = new AnimInstance(rig); a.start(q.entry.idleClip, 0); anims.set(q.entry.record, a); }
      const init = recs.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags }));
      const emu = new LtcEmu(pe, init, anims);
      const mem = emu.cpu.mem;
      emu.loadSounds();
      mem.wf32(G.CAND_DIST, 12);
      const nodes = room.people.map((q, i) => emu.makePerson(i));
      const pepNode = emu.makePepSwitch(p.index);
      mem.w32(G.PEPPER, emu.recPtr(p.index));
      emu.vars.set(0x5e, 1);
      w.vars.set(0x5e, 1);
      const ctrlBuf = emu.alloc(0x40);
      const order = [...room.people.map((q, i) => ({ rec: q.entry.record, i })), { rec: p.index, i: -1 }].sort((a, b) => a.rec - b.rec);
      let worst = 0;
      const cmpN = (t, name, o, q, tol = TOL) => { checked++; const d = Math.abs(o - q); worst = Math.max(worst, d); if (!(d <= tol * Math.max(1, Math.abs(o))) && failures.length < 12) failures.push(`${label}: tick ${t} ${name}: original ${o} port ${q}`); };
      const cmpS = (t, name, o, q) => { checked++; if (o !== q && failures.length < 12) failures.push(`${label}: tick ${t} ${name}: original ${JSON.stringify(o)} port ${JSON.stringify(q)}`); };
      const stats = { talks: 0, pushes: 0, toggles: 0, appear: 0, sounds: 0 };
      const setPos = (rec, x, y, z) => { rec.x = x; rec.y = y; rec.z = z; rec.savePrev(); const a = emu.recPtr(rec.index) + 0xc; mem.wf32(a + 48, x); mem.wf32(a + 52, y); mem.wf32(a + 56, z); };
      for (let t = 0; ; t++) {
        const s = scriptOf(t, { room, recs, p, setPos });
        if (!s) break;
        const pressed = s.pressed ?? 0;
        w.input.pressed = pressed;
        mem.w32(G.KEYS, pressed);
        plog.length = 0; emu.log = [];
        const pc = w.vars.get(0x5e);
        const ran = [];
        // ---- update pass in record order (port)
        const prets = {}, orets = {};
        for (const { rec: ri, i } of order) {
          const rec = recs[ri];
          if (i < 0) {
            const r = room.pep.update(w, rec, rec.ctrl);
            prets.pep = r; ran.push({ i, r });
          } else {
            const dx = rec.x - p.x, dz = rec.z - p.z;
            const ctrl = { distSq: dx * dx + dz * dz };
            const r = room.people[i].update(w, rec, ctrl);
            prets[i] = r; ran.push({ i, r, ctrl });
          }
        }
        // ---- update pass (oracle); the walk node (SGwalk) resets the candidate distance when it runs (gate var 0x5e & 1)
        const pco = emu.vars.get(0x5e);
        for (const { rec: ri, i } of order) {
          if (i < 0) {
            orets.pep = emu.cpu.call(0x83a9e0, [emu.recPtr(ri), pepNode, 0, pco]) >>> 0;
            if (pco !== PC_TALK && (pco & 1)) mem.wf32(G.CAND_DIST, 576);
          } else {
            const rec = recs[ri];
            const dx = rec.x - p.x, dz = rec.z - p.z;
            mem.wf32(ctrlBuf + 0x18, dx * dx + dz * dz);
            orets[i] = emu.cpu.call(0x839e20, [emu.recPtr(ri), nodes[i], ctrlBuf]) >>> 0;
          }
        }
        cmpS(t, 'pepswitc return', orets.pep, prets.pep);
        for (const { i, r } of ran) if (i >= 0) cmpS(t, `person ${i} return`, orets[i], r);
        // ---- pre-render pass
        for (const { rec: ri, i, } of order) {
          const r = prets[i < 0 ? 'pep' : i];
          if (!r) continue;
          if (i < 0) { room.pep.prerender(w, recs[ri], recs[ri].ctrl); emu.cpu.call(0x83aa48, []); }
          else { room.people[i].prerender(w, recs[ri], null); emu.cpu.call(0x83a292, [emu.recPtr(ri), nodes[i]]); }
        }
        // ---- draw hook of pepswitc
        room.pep.draw(w, p, p.ctrl); emu.cpu.call(0x83aa8d, [emu.recPtr(p.index), pepNode, 0, 0]);
        // ---- compare
        cmpS(t, 'calls', emu.log.filter((x) => !x.startsWith('var ') && !x.startsWith('bars ')).join(','), plog.join(','));
        cmpN(t, 'bars', emu.letterbox, g.letterbox);
        cmpN(t, 'var 0x5e', emu.vars.get(0x5e), w.vars.get(0x5e));
        cmpN(t, 'toggle', emu.i(G.TOGGLE), g.toggle);
        cmpN(t, 'timer', emu.f(G.TIMER), g.timer);
        cmpN(t, 'candDist', emu.f(G.CAND_DIST), g.candDist);
        const cp = emu.i(G.CAND);
        cmpN(t, 'candidate', cp === 0 ? 0 : (cp - RECORDS_BASE) / 0x68, g.candidate ? g.candidate.entry.record : 0);
        cmpS(t, 'name', mem.cstr(G.NAME), g.name);
        cmpS(t, 'role', mem.cstr(G.ROLE), g.role);
        for (const ri of [p.index, ...room.people.map((q) => q.entry.record)]) {
          const r = recs[ri], a = emu.recPtr(ri);
          for (let k = 0; k < 16; k++) cmpN(t, `rec${ri}.m${k}`, emu.f(a + 0xc + 4 * k), r.m[k]);
          if (ri !== p.index) cmpN(t, `rec${ri}.flags`, mem.r16(a + 0x60) & 2, r.flags & 2);
          const an = emu.anims.get(mem.r32(a + 8));
          if (an && r.anim) { cmpN(t, `rec${ri}.clip`, an.clip, r.anim.clip); cmpN(t, `rec${ri}.frame`, an.frame, r.anim.frame); }
        }
        room.people.forEach((q, i) => {
          const n = nodes[i];
          cmpN(t, `p${i}.talk`, mem.r16(n + 0x34), q.talk);
          cmpN(t, `p${i}.pushed`, mem.r8(n + 0x24), q.pushed ? 1 : 0);
          cmpN(t, `p${i}.twinkle`, mem.r8(n + 0x25), q.twinkle);
          cmpN(t, `p${i}.reacted`, mem.r16(n + 0x36), q.reacted);
          if (q.pushed) for (let k = 0; k < 3; k++) cmpN(t, `p${i}.saved${k}`, emu.f(n + 0x28 + 4 * k), q.saved[k]);
        });
        if (plog.some((x) => x.startsWith('snd '))) stats.sounds++;
        if (plog.some((x) => x.startsWith('tw ') && x.endsWith(' 2'))) stats.appear++;
        stats.talks = g.talks;
      }
      notes.push(`${label}: worst difference ${worst.toExponential(1)}, ${stats.talks} talks, ${stats.sounds} sounds, ${stats.appear} appearances / vanishings`);
      return stats;
    };

    // scenario 1: every person in turn: walk up (3 units), Shift, the talk plays out (or is cut short by a second Shift), a step closer than 1.28 (push back), walk away
    const script1 = (() => {
      let person = 0, phase = 0, wait = 0, built = false;
      const SHIFT = B.SHIFT;
      return (t, { room, recs, p, setPos }) => {
        if (t < 70) return { pressed: 0 };                      // the sets appear / vanish, one person per 5 ticks
        if (person >= 2 * room.people.length) return null;       // two rounds: the second one meets the other half of the team (the switchers toggled the sets)
        const q = room.people[person % room.people.length], rec = recs[q.entry.record];
        if (wait > 0) { wait--; return { pressed: 0 }; }
        if (phase === 0) { setPos(p, rec.x, rec.y, rec.z + (person % 3 === 0 ? 1.0 : 3.0)); phase = 1; wait = 2; return { pressed: 0 }; }
        if (phase === 1) { phase = 2; wait = 0; return { pressed: SHIFT }; }
        if (phase === 2) {
          // wait for the talk to finish by itself (or press Shift after 12 ticks for every second person)
          if (q.talk === 0 && wait === 0) { phase = 3; wait = 0; return { pressed: 0 }; }
          wait = 0; phase = 2;
          if (person % 2 === 1 && q.talk > 0 && (built = !built)) return { pressed: 0 };
          return { pressed: person % 2 === 1 && room.g.talks > 0 && q.talk > 0 && (t % 14 === 0) ? SHIFT : 0 };
        }
        if (phase === 3) { setPos(p, rec.x, rec.y, rec.z + 40); phase = 4; wait = 8; return { pressed: 0 }; }
        phase = 0; person++; return { pressed: 0 };
      };
    })();
    const st1 = run('everyone', script1);
    checked++; if (st1.talks < 40) failures.push(`everyone: only ${st1.talks} talks`);
    // scenario 2: Shift presses without a person in range, pressing Shift while a person is still waiting to appear, a switcher (Lara Sweeney) swaps the sets, then everyone talks again
    const script2 = (() => {
      let n = 0;
      return (t, { room, recs, p, setPos }) => {
        const lara = room.people.find((q) => q.entry.name === 'Lara Sweeney'), lr = recs[lara.entry.record];
        if (t === 0) setPos(p, lr.x, lr.y, lr.z + 3);
        if (t >= 1 && t < 4) return { pressed: t === 2 ? B.SHIFT : 0 };     // Shift at tick 2, the people are still appearing
        if (t < 60) return { pressed: 0 };
        if (t === 60) { setPos(p, lr.x, lr.y, lr.z + 3); return { pressed: 0 }; }
        if (t === 62) return { pressed: B.SHIFT };
        if (t > 62 && t < 400) return { pressed: lara.talk === 0 && n++ > 3 && t > 100 ? 0 : 0 };
        if (t === 400) { setPos(p, lr.x + 60, lr.y, lr.z + 60); return { pressed: B.SHIFT }; }   // out of range
        if (t < 460) return { pressed: 0 };
        return null;
      };
    })();
    const st2 = run('switch', script2);

    // ---- the portal home (PORC, StartCSM box portal): Pepper walks in towards it, stays, walks out and in again; var 5, previous distance, age, spin / face-camera matrix
    {
      persisted.toggle = 0;
      const L = loadZone(ctx, 'z50LTC');
      const room = buildLtc(L.world, L, L.pe);
      const w = L.world, p = L.pepper, recs = w.records;
      const pr = recs.find((r) => r.ctrl?.nodes.includes(room.portal));
      const emu = new LtcEmu(pe, recs.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags })), new Map());
      const mem = emu.cpu.mem;
      const node = emu.makePortal(pr.index, room.portal.a);
      mem.w32(G.PEPPER, emu.recPtr(p.index));
      const ctrlBuf = emu.alloc(0x40);
      w.vars.set(5, 34); emu.vars.set(5, 34);
      w.focus = p;
      const eye = [3, 10, 20, 0, 0, 0];
      for (let k = 0; k < 6; k++) { w.camera.c[k] = eye[k]; mem.wf32(0x9da5e8 + 4 * k, eye[k]); }
      let worst = 0, fired = 0;
      const path = [];
      // z from 60 away to 4 away in steps of 1.5 (x offset 5), 40 ticks inside, out to 60, in again
      for (let z = 60; z >= 4; z -= 1.5) path.push(z);
      for (let k = 0; k < 40; k++) path.push(4);
      for (let z = 4; z <= 60; z += 3) path.push(z);
      for (let z = 60; z >= 6; z -= 4) path.push(z);
      for (let k = 0; k < 6; k++) path.push(6);
      path.forEach((dz, t) => {
        const x = pr.x + 5, y = pr.y + (t > 150 ? 30 : 2), z = pr.z + dz;
        p.x = x; p.y = y; p.z = z; p.savePrev();
        const a = emu.recPtr(p.index) + 0xc; mem.wf32(a + 48, x); mem.wf32(a + 52, y); mem.wf32(a + 56, z);
        const dx = pr.x - x, dzz = pr.z - z, d2 = dx * dx + dzz * dzz;     // the controller distance (x / z)
        w.input.pressed = 0; mem.w32(G.KEYS, 0);
        const ctrl = { distSq: d2 };
        room.portal.update(w, pr, ctrl);
        mem.wf32(ctrlBuf + 0x18, d2);
        emu.cpu.call(0x51e5ab, [emu.recPtr(pr.index), node, ctrlBuf]);
        const cmp = (name, o, q) => { checked++; const d = Math.abs(o - q); worst = Math.max(worst, d); if (!(d <= TOL * Math.max(1, Math.abs(o))) && failures.length < 12) failures.push(`portal: step ${t} ${name}: original ${o} port ${q}`); };
        cmp('var 5', emu.vars.get(5) ?? 34, w.vars.get(5));
        cmp('last', emu.f(node + 0x3c), room.portal.last);
        cmp('age', emu.f(node + 0x40), room.portal.age);
        for (let k = 0; k < 16; k++) cmp(`m${k}`, emu.f(emu.recPtr(pr.index) + 0xc + 4 * k), pr.m[k]);
        if (w.vars.get(5) === 2) fired++;
        w.vars.set(5, 34); emu.vars.set(5, 34);
      });
      checked++; if (fired < 3) failures.push(`portal: fired only ${fired} times`);
      notes.push(`portal: ${path.length} steps, worst difference ${worst.toExponential(1)}, fired ${fired} ticks`);
    }
    return { checked, failures, notes };
  },
};
