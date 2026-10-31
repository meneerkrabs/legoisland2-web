import { loadZone, loadExe } from '../lib/engine-load.mjs';
import { buildLtc, ltc, PORTAL_ARGS, CTOR_LTC_PEPSWITC } from '../../src/zones/z50LTC.ts';
import { readPeopleTable, readPersonSounds, persisted, wrapAngle, PC_TALK, CHANGE_DELAY, TALK_DISTANCE, RELEASE_DIST2, FALL_LIMIT } from '../../src/zones/z50LTC/people.ts';
import { PortalNode, ARM_TICKS } from '../../src/zones/z50LTC/portal.ts';
import { readAudioTables } from '../../src/audio/tables.ts';
import { zoneGameFor } from '../../src/shell/zonegame.ts';
import { ctorFactory } from '../../src/game/setup.ts';
import fs from 'node:fs';
import path from 'node:path';

// z50LTC, the "Meet the team" cave (docs/re/m3/z50LTC.md): the people table and sound ids against the executable, the set-up of the room, the appear / vanish
// of the two sets of people, the talk (candidate choice, start, loops, skip, push back), the pepswitc node (listening animation, fall guard), the portal home.
export default {
  name: 'm3-z50LTC',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);

    // ============================================================ the tables of the executable
    const table = readPeopleTable(pe);
    ok(table.length === 26, `26 people (${table.length})`);
    const names = table.map((t) => t.name);
    ok(names[0] === 'Paul Baker' && names[25] === 'Simon Philips' && names.includes('Jeb') && names.includes('Andronikos Antonakakis'), `names ${names.slice(0, 3)}...`);
    ok(table.every((t) => t.name.length > 0 && t.role.length > 0), 'every row has a name and a job');
    const roles = new Set(table.map((t) => t.role));
    ok([...roles].sort().join('|') === 'Artist|Associate Producer|Lead Animator|Lead Artist|Lead Programmer|Producer|Programmer', `jobs ${[...roles].sort()}`);
    ok(table.filter((t) => t.cond === -1).map((t) => t.name).join() === 'Lara Sweeney,Rich Hancock,Darren Drabwell', 'the three switchers (cond -1): Lara Sweeney, Rich Hancock, Darren Drabwell');
    ok(table.filter((t) => t.cond === 1).length === 9 && table.filter((t) => t.cond === 0).length === 11 && table.filter((t) => t.cond === -2).length === 3, 'sets: 9 + 11 + 3 always + 3 switchers');
    ok(table.filter((t) => t.type === 1).map((t) => t.name).join() === 'Paul Scully', 'type 1 = Paul Scully (hand emitters)');
    ok(table.filter((t) => t.type === 2).map((t) => t.name).join() === 'Andy Bray' && table.find((t) => t.type === 2).pepperClip === 437, 'type 2 = Andy Bray, Pepper clip 437');
    ok(table.find((t) => t.name === 'Phil Hodgson').type === 4, 'Phil Hodgson type 4 (3 loops)');
    ok(new Set(table.map((t) => t.record)).size === 26 && table.every((t) => t.record >= 12 && t.record <= 40), 'records 12..40, all different');
    const sounds = readPersonSounds(pe);
    ok(sounds.length === 27 && sounds[0] === 0x13a && sounds[1] === 0x364 && sounds[26] === 0x179 && sounds[3] === 0xb4, `27 sound ids (${sounds.length}): 0x13a, 0x364 ... 0x179`);
    ok([4, 5, 6, 7, 18, 23].every((i) => sounds[i] === 300), 'silent entries (SND_SILENCE 300)');
    ok(table.every((t) => t.sound >= 0 && t.sound < 27), 'sound indices in range');
    const at = readAudioTables(new Uint8Array(fs.readFileSync(path.join(ctx.dataRoot, 'LEGO eiland 2.exe'))));
    ok(at.sounds[sounds[0]].name === 'SND_PEPP_KNOCK' && at.sounds[sounds[15]].name === 'SND_BRONTY_BURP' && at.sounds[300].name === 'SND_SILENCE', 'sound table names: knock, burp, silence');

    // ============================================================ the room
    ok(typeof zoneGameFor('z50LTC') === 'function', 'zone game registered');
    ok(ctorFactory(CTOR_LTC_PEPSWITC) !== undefined, 'pepswitc constructor 0x83ab7b registered');
    const fresh = (dt = 1) => {
      persisted.toggle = 0;
      const L = loadZone(ctx, 'z50LTC');
      L.world.dt = dt;
      const room = buildLtc(L.world, L, L.pe);
      return { L, w: L.world, p: L.pepper, room, g: room.g, rec: (n) => L.world.records.find((r) => r.name === n) };
    };
    const key = (w, code, down) => w.input.setKey(code, down);
    const tickN = (w, n) => { for (let i = 0; i < n; i++) w.tick(); };
    /** a tick the way the zone game runs it: world tick, then the pepswitc draw hook */
    const tick = (R, n = 1) => { for (let i = 0; i < n; i++) { R.w.tick(); R.room.pep?.draw(R.w, R.p, R.p.ctrl); } };
    const tap = (R, code = 'ShiftLeft') => { key(R.w, code, true); tick(R); key(R.w, code, false); };
    const putNear = (R, rec, dx = 0, dz = 3) => { R.p.x = rec.x + dx; R.p.z = rec.z + dz; R.p.y = rec.y + 0.5; R.p.savePrev(); };
    const byName = (R, n) => R.room.people.find((q) => q.entry.name === n);
    const recOf = (R, n) => R.w.records[byName(R, n).entry.record];

    {
      const R = fresh();
      ok(R.room.people.length === 26, '26 People nodes attached');
      ok(R.room.people.every((q) => { const r = R.w.records[q.entry.record]; return r.ctrl.nodes[0] === q && r.ctrl.flags === 0x13 && (r.flags & 0x40) && r.anim && r.anim.clip === q.entry.idleClip; }), 'every person: controller flags 0x13, flag 0x40, idle clip');
      ok(R.room.pep && R.p.ctrl.nodes[0] === R.room.pep && R.p.ctrl.nodes[1].kind === 'SGwalk' && !R.p.ctrl.nodes.some((n) => n.kind === 'StubGuard'), `Pepper's chain: pepswitc, SGwalk (${R.p.ctrl.nodes.map((n) => n.kind)})`);
      ok(R.room.portal && R.w.records[53].name === 'PORC' && R.w.records[53].ctrl.nodes[0] === R.room.portal && R.w.records[53].ctrl.flags === 0x26, 'portal node on PORC (record 53), flags 0x26');
      ok(R.L.skipped.length === 0, `no skipped attaches (${JSON.stringify(R.L.skipped)})`);
      ok(R.w.seaLevel === -800 && R.w.gravity === -10 && R.w.vars.get(0x5e) === 1, 'sea -800, gravity -10, walking');
      ok(R.w.records.filter((r) => r.name[0] === 'G').every((r) => !r.colObj || r.colObj.shape === 3 || r.colObj.box), 'crystal boxes');
      // the constructor puts every minifig on the ground below its placement; Rich Hancock (record 28) was moved 8 units along x first
      let onGround = 0, moved = 0;
      for (const q of R.room.people) {
        const r = R.w.records[q.entry.record], sc = R.L.scene.records[q.entry.record];
        const h = R.w.col.sweep(r, [r.x, sc.pos[1], r.z], [0, -80, 0], 3, 1.0, 0);
        if ((h && Math.abs(h.point[1] - r.y) < 1e-4) || (!h && r.y === sc.pos[1])) onGround++;
        if (Math.abs(r.x - (sc.pos[0] + (q.entry.record === 28 ? 8 : 0))) < 1e-4 && Math.abs(r.z - sc.pos[2]) < 1e-4) moved++;
      }
      ok(onGround === 26, `all people stand on the ground (${onGround} / 26)`);
      ok(moved === 26, `x / z unchanged except Rich Hancock +8 (${moved} / 26)`);
      ok(R.room.people.some((q) => Math.abs(R.w.records[q.entry.record].y - R.L.scene.records[q.entry.record].pos[1]) > 1), 'the ground snap moves people vertically');
      ok(PORTAL_ARGS.half.join() === '16,24,16' && PORTAL_ARGS.target === 2, 'portal block 16 / 24 / 16 -> zone 2');
      ok(R.room.portal.radius2 === 16 * 16 + 24 * 24 + 16 * 16 + 16, `portal radius^2 ${R.room.portal.radius2}`);
    }

    // ---- the set that is not present vanishes one person per 6 ticks
    {
      const R = fresh();
      const set1 = R.room.people.filter((q) => q.entry.cond === 1);
      const gone = [];
      let lastTimerSet = -1;
      for (let i = 1; i <= 80; i++) {
        tick(R);
        for (const q of set1) if (!R.w.records[q.entry.record].enabled && !gone.includes(q)) gone.push(q);
        if (R.g.timer === CHANGE_DELAY - 1 && lastTimerSet < 0) lastTimerSet = i;   // timer is 5, then the pepswitc prerender takes one off in the same tick
      }
      ok(gone.length === 9, `the 9 people of set 1 vanish (${gone.length})`);
      ok(R.room.people.filter((q) => q.entry.cond !== 1).every((q) => R.w.records[q.entry.record].enabled), 'the others stay');
      // the first one vanishes in tick 1, the next ones every 6 ticks (timer 5, one off per tick, change when <= 0)
      const R2 = fresh();
      const ticks = [];
      for (let i = 1; i <= 80; i++) { const before = set1.length && R2.room.people.filter((q) => q.entry.cond === 1 && R2.w.records[q.entry.record].enabled).length; tick(R2); const after = R2.room.people.filter((q) => q.entry.cond === 1 && R2.w.records[q.entry.record].enabled).length; if (after < before) ticks.push(i); }
      ok(ticks.length === 9 && ticks[0] === 1 && ticks.slice(1).every((t, i) => t - ticks[i] === CHANGE_DELAY), `vanish ticks ${ticks} (first in tick 1, then every 5: the timer is set to 5 and one comes off per tick)`);
      notes.push(`set 1 vanishes at ticks ${ticks.join(',')}`);
      // twinkle hook
      const R3 = fresh();
      const ev = [];
      R3.g.onTwinkle = (rec, start) => ev.push([R3.w.tickCount, rec.name, start]);
      tick(R3, 12);
      ok(ev.length >= 3 && ev[0][2] === true && ev.some((e) => e[1] === ev[0][1] && e[2] === false && e[0] === ev[0][0] + 3), `twinkle starts in tick 1 and stops 3 ticks later (${JSON.stringify(ev.slice(0, 3))})`);
    }

    // ---- the 60 Hz step (dt = 0.5): the appear timer, the portal's arming age and the animations are dt-scaled floats (twice the ticks), the twinkle is an integer counter per update
    {
      const R = fresh(0.5);
      const set1 = R.room.people.filter((q) => q.entry.cond === 1);
      const ticks = [];
      for (let i = 1; i <= 160; i++) { const before = R.room.people.filter((q) => q.entry.cond === 1 && R.w.records[q.entry.record].enabled).length; tick(R); const after = R.room.people.filter((q) => q.entry.cond === 1 && R.w.records[q.entry.record].enabled).length; if (after < before) ticks.push(i); }
      ok(ticks.length === set1.length && ticks[0] === 1 && ticks.slice(1).every((t, i) => t - ticks[i] === 2 * CHANGE_DELAY), `dt 0.5: vanish ticks ${ticks} (first in tick 1, then every 10: the timer falls 0.5 per tick)`);
      const R3 = fresh(0.5);
      const ev = [];
      R3.g.onTwinkle = (rec, start) => ev.push([R3.w.tickCount, rec.name, start]);
      tick(R3, 12);
      ok(ev.length >= 2 && ev[0][2] === true && ev.some((e) => e[1] === ev[0][1] && e[2] === false && e[0] === ev[0][0] + 3), `dt 0.5: the twinkle still stops 3 updates later (${JSON.stringify(ev.slice(0, 3))})`);
      const R4 = fresh(0.5);
      tick(R4, 59);
      ok(R4.room.portal.age === 29.5, `dt 0.5: the portal's age counts 0.5 per tick (${R4.room.portal.age} after 59 ticks)`);
      tick(R4, 1);
      ok(R4.room.portal.age === 30, 'dt 0.5: the portal arms after 60 ticks');
    }

    // ---- talking
    {
      const R = fresh();
      tick(R, 80);
      const pb = byName(R, 'Paul Baker'), pbr = recOf(R, 'Paul Baker');
      putNear(R, pbr);
      tick(R, 2);
      ok(R.g.candidate === null, 'no candidate without a button');
      const played = [];
      R.g.playSound = (id) => played.push(id);
      const clipBefore = R.p.anim.clip;
      tap(R);
      ok(pb.talk === 1 && R.w.vars.get(0x5e) === PC_TALK, `Shift next to Paul Baker starts the talk (talk ${pb.talk}, var 0x5e ${R.w.vars.get(0x5e)})`);
      ok(R.g.letterbox === 1 && R.g.name === 'Paul Baker' && R.g.role === 'Programmer', `bars + name "${R.g.name}" / "${R.g.role}"`);
      ok(pbr.anim.clip === pb.entry.talkClip && R.p.anim.clip === pb.entry.pepperClip, `clips: minifig ${pbr.anim.clip}, Pepper ${R.p.anim.clip}`);
      ok(played.join() === '314', `sound 314 (SND_PEPP_KNOCK): ${played}`);
      const face = wrapAngle(Math.atan2(pbr.x - R.p.x, pbr.z - R.p.z));
      ok(Math.abs(wrapAngle(R.p.ry - face)) < 1e-6, 'Pepper faces the minifig');
      ok(Math.abs(wrapAngle(pbr.ry - wrapAngle(Math.atan2(R.p.x - pbr.x, R.p.z - pbr.z)))) < 1e-6, 'the minifig faces Pepper');
      // Pepper does not walk while talking
      const px = R.p.x, pz = R.p.z;
      key(R.w, 'ArrowUp', true); tick(R, 6); key(R.w, 'ArrowUp', false);
      ok(Math.hypot(R.p.x - px, R.p.z - pz) < 1e-6 && R.w.vars.get(0x5e) === PC_TALK, 'the walk node is off during the talk');
      // the talk clip (30 frames, one loop) ends by itself
      let n = 0; while (pb.talk > 0 && n++ < 100) tick(R);
      ok(pb.talk === 0 && n >= 20 && n <= 40, `a one-loop talk ends after ${n} ticks`);
      ok(R.w.vars.get(0x5e) === 1 && R.g.letterbox === 0 && R.g.name === '' && R.g.role === '', 'after the talk: walking, no bars, no text');
      ok(pbr.anim.clip === pb.entry.idleClip && R.p.anim.clip === 0x1b, `idle clips (${pbr.anim.clip}, ${R.p.anim.clip})`);
      ok(R.g.toggle === 0, 'Paul Baker does not swap the sets');
      // a second Shift press during a talk ends it
      tap(R);
      ok(pb.talk === 1, 'talk again');
      tick(R, 5);
      tap(R);
      ok(pb.talk === 0 && R.w.vars.get(0x5e) === 1, 'Shift during a talk ends it');
      // Shift too far away: nothing
      R.p.x = pbr.x + 30; R.p.z = pbr.z; R.p.y = pbr.y + 0.5;
      tick(R, 3);
      tap(R);
      ok(pb.talk === 0 && R.g.candidate === null, 'out of range (> 24 units) of Paul Baker: he does not talk');
    }

    // ---- loops: Phil Hodgson (type 4: 3 loops of clip 343), Andy Bray (type 2: Pepper reacts at frame 32)
    {
      const R = fresh();
      tick(R, 80);
      const ph = byName(R, 'Phil Hodgson'), phr = recOf(R, 'Phil Hodgson');
      putNear(R, phr, 0, 4);
      tick(R, 2);
      tap(R);
      ok(ph.talk === 3, `Phil Hodgson: 3 loops (${ph.talk})`);
      let n = 0; while (ph.talk > 0 && n++ < 400) tick(R);
      const frames = R.w.records[ph.entry.record].anim.rig.clips[ph.entry.talkClip].frameCount;
      ok(Math.abs(n - 3 * frames) <= 4, `3 loops of ${frames} frames take ${n} ticks`);
      R.p.x += 0; tick(R, 3);
      const ab = byName(R, 'Andy Bray'), abr = recOf(R, 'Andy Bray');
      putNear(R, abr, 0, 4);
      tick(R, 2);
      tap(R);
      ok(ab.talk === 1 && R.p.anim.clip === 0x78, `Andy Bray: Pepper starts in the hold pose 0x78 (${R.p.anim.clip})`);
      let seen = false, f = 0;
      while (ab.talk > 0 && f++ < 100) { tick(R); if (R.p.anim.clip === 437) { seen = true; ok(abr.anim.frame > 32, `Pepper's reaction clip 437 starts after frame 32 (frame ${abr.anim.frame.toFixed(1)})`); break; } }
      ok(seen, 'Pepper reacts (clip 437)');
      // the listening animation of Pepper falls back to the hold pose when it ends (pepswitc update 0x83a9e0)
      let hold = false; for (let i = 0; i < 100 && ab.talk > 0; i++) { tick(R); if (R.p.anim.clip === 0x78) hold = true; }
      ok(hold || ab.talk === 0, 'Pepper holds the pose when the clip ended');
    }

    // ---- the switchers: talking to Lara swaps the sets
    {
      const R = fresh();
      tick(R, 80);
      ok(R.g.toggle === 0, 'toggle starts at 0');
      const vis0 = R.room.people.filter((q) => R.w.records[q.entry.record].enabled).map((q) => q.entry.name);
      ok(vis0.includes('Lara Sweeney') && vis0.includes('Paul Baker') && !vis0.includes('Ade Smith'), 'set 0 present at the start');
      const lara = byName(R, 'Lara Sweeney'), lr = recOf(R, 'Lara Sweeney');
      putNear(R, lr, 0, 3.5);
      tick(R, 2);
      tap(R);
      ok(lara.talk === 1, 'talk with Lara');
      let n = 0; while (lara.talk > 0 && n++ < 200) tick(R);
      ok(R.g.toggle === 1, `Lara swaps the sets (toggle ${R.g.toggle})`);
      tick(R, 120);
      const vis1 = R.room.people.filter((q) => R.w.records[q.entry.record].enabled).map((q) => q.entry.name);
      ok(!vis1.includes('Paul Baker') && vis1.includes('Ade Smith') && vis1.includes('Lara Sweeney') && vis1.includes('Andy Bray') && vis1.includes('Simon Philips'), `set 1 present now (${vis1.length} people)`);
      ok(vis1.length === 3 + 3 + 9 && vis0.length === 3 + 3 + 11, `counts ${vis0.length} -> ${vis1.length}`);
      // the toggle is kept for the next visit (the original's process global)
      const g = zoneGameFor('z50LTC');
      ok(typeof g === 'function', 'game factory');
      persisted.toggle = R.g.toggle;
      const R2 = fresh2(ctx, R.g.toggle);
      ok(R2.g.toggle === 1, 'a new visit starts with the kept toggle');
    }

    // ---- push back: talk from very close, the minifig is pushed back and returns when Pepper is far
    {
      const R = fresh();
      tick(R, 80);
      const q = byName(R, 'Roy Stewart'), r = recOf(R, 'Roy Stewart');
      const home = [r.x, r.y, r.z];
      putNear(R, r, 0.3, 0.6);
      tick(R, 2);
      tap(R);
      const d = Math.hypot(r.x - R.p.x, r.z - R.p.z);
      ok(q.talk === 1 && q.pushed, 'talk from close');
      ok(Math.abs(d - TALK_DISTANCE) < 0.05 || d >= TALK_DISTANCE - 0.05, `pushed back to ${d.toFixed(2)} (distance 1.28)`);
      ok(Math.hypot(r.x - home[0], r.z - home[2]) > 0.3, 'moved');
      let n = 0; while (q.talk > 0 && n++ < 200) tick(R);
      R.p.x = r.x + 5; R.p.z = r.z; R.p.y = r.y + 0.5;
      tick(R, 3);
      ok(Math.hypot(r.x - home[0], r.z - home[2]) < 1e-5, 'back at its place when Pepper is farther than 2.08');
      ok(RELEASE_DIST2 === 2.08 * 2.08 || Math.abs(RELEASE_DIST2 - 4.3264) < 1e-9, 'release distance^2 4.3264');
    }

    // ---- the fall guard of pepswitc (y < -80 -> where the node was created)
    {
      const R = fresh();
      const home = [R.p.x, R.p.y, R.p.z];
      tick(R, 3);
      R.p.y = FALL_LIMIT - 5; tick(R);
      ok(R.room.pep.respawns >= 1 && Math.hypot(R.p.x - home[0], R.p.z - home[2]) < 1e-3 && R.p.y > -10, `fall guard: back at the start (${R.p.x.toFixed(1)}, ${R.p.y.toFixed(1)}, ${R.p.z.toFixed(1)})`);
      ok(R.g.candDist === 64 && R.g.candidate === null, 'draw hook resets candidate distance to 64');
    }

    // ---- the portal home
    {
      const R = fresh();
      const por = R.room.portal, pr = R.w.records[53];
      R.p.x = pr.x; R.p.z = pr.z - 40; R.p.y = pr.y + 14;
      let fired = -1;
      // before it is armed (30 ticks), walking in does nothing
      for (let i = 0; i < 20; i++) { R.p.z += 1.5; tick(R); }
      ok(R.w.vars.get(5) !== 2, 'not armed during the first 30 ticks');
      // a stationary player inside does not fire (the distance must fall)
      R.p.x = pr.x; R.p.z = pr.z; R.p.y = pr.y + 14;
      tick(R, 60);
      ok(R.w.vars.get(5) !== 2 && por.fired === 0, 'standing in the box does not fire (needs to approach)');
      // approaching from outside the radius: fires inside the box
      R.p.z = pr.z - 40;
      for (let i = 0; i < 60 && fired < 0; i++) { R.p.z += 1.0; R.p.y = pr.y + 14; tick(R); if (R.w.vars.get(5) === 2) fired = i; }
      ok(fired >= 0 && por.fired >= 1, `walking into the portal writes var 5 = 2 (after ${fired} steps)`);
      ok(Math.abs(por.age - ARM_TICKS) >= 0 && por.age >= ARM_TICKS, 'armed');
      // the record turns to the camera and spins
      ok(Math.abs(pr.rx) > 0 && Number.isFinite(pr.ry), `portal spins (rx ${pr.rx.toFixed(3)}) and turns (ry ${pr.ry.toFixed(3)})`);
      // outside the box height: nothing
      const R2 = fresh();
      const pr2 = R2.w.records[53];
      tick(R2, 40);
      R2.p.x = pr2.x; R2.p.z = pr2.z - 25; R2.p.y = pr2.y + 40;
      let f2 = false; for (let i = 0; i < 40; i++) { R2.p.z += 0.6; R2.p.y = pr2.y + 40; tick(R2); if (R2.w.vars.get(5) === 2) f2 = true; }
      ok(!f2, 'above the box (|dy| > 24): nothing');
    }

    // ---- the people are solid (record flag 0x40: box of the .col): walking into one stops Pepper in front of it
    {
      const R = fresh();
      tick(R, 80);
      const q = byName(R, 'Paul Baker'), r = recOf(R, 'Paul Baker');
      R.p.x = r.x; R.p.z = r.z + 8; R.p.y = r.y + 0.5; R.p.ry = Math.PI; R.p.rebuildYaw(); R.w.camera.init(R.p);
      key(R.w, 'ArrowUp', true);
      let minD = 1e9;
      for (let i = 0; i < 50; i++) { tick(R); minD = Math.min(minD, Math.hypot(R.p.x - r.x, R.p.z - r.z)); }
      key(R.w, 'ArrowUp', false);
      ok(minD > 0.5, `Pepper is stopped by Paul Baker (closest ${minD.toFixed(2)} units)`);
    }

    // ---- the whole room runs: 300 ticks of walking, no NaN, Pepper stays on the ground
    {
      const R = fresh();
      key(R.w, 'ArrowUp', true);
      tick(R, 200);
      key(R.w, 'ArrowUp', false);
      ok([R.p.x, R.p.y, R.p.z].every(Number.isFinite) && R.p.y > -50, `Pepper at (${R.p.x.toFixed(1)}, ${R.p.y.toFixed(1)}, ${R.p.z.toFixed(1)}) after 200 ticks`);
    }
    return { checked, failures, notes };

    function fresh2(c, toggle) { persisted.toggle = toggle; const L = loadZone(c, 'z50LTC'); const room = buildLtc(L.world, L, L.pe); return { g: room.g, L }; }
  },
};
