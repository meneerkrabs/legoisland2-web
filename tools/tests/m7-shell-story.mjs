// WP-VERIFY M2 shell, target 3a: the story FSM and the zone loop glue (src/shell/story.ts). The ORIGINAL's FUN_00404aa0 / 00404be7 / 00404bb2 / 00404b43 / 00404af6 / 00404c07 /
// 00423bad / 00404d14 / 004176c1 / 0041ad43 / 0041adb5 / 00419bb9 / 0041a8f9 and the zone loop FUN_00404dc9 run natively in the x86 emulator (tools/lib/m7-shell-story-emu.mjs)
// on random game variables and snapshot arrays, next to StoryFsm / ZoneLoopState: return values, all 319 variables, the node snapshots and the pending override are compared.
import { loadExe } from '../lib/engine-load.mjs';
import { StoryEmu, A } from '../lib/m7-shell-story-emu.mjs';
import { makeRng } from '../lib/m7-shell-menu-emu.mjs';
import { GameVars } from '../../src/game/vars.ts';
import { readZoneTable, readStoryFsm, readInitialVars } from '../../src/shell/tables.ts';
import { StoryFsm, ZoneLoopState, varClass, NEW_GAME_NODE, NEW_GAME_ZONE, SW_FIRST, SW_COUNT } from '../../src/shell/story.ts';

export default {
  name: 'm7-shell-story',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 60) failures.push(m); else if (failures.length === 60) failures.push('... more'); };
    const ok = (c, m) => { checked++; if (!c) bad(m); };
    const pe = loadExe(ctx.dataRoot);
    const zones = readZoneTable(pe), nodes = readStoryFsm(pe), init = readInitialVars(pe);
    const stats = { ops: {}, loops: 0, zonesRun: 0, loads: { 0: 0, 1: 0, 2: 0 }, pendingKinds: {} };

    // ---- 1. FUN_004176c1: the class of every variable
    {
      const E = new StoryEmu(pe);
      let n = 0;
      for (let i = 0; i < 319; i++) { const c = E.call(0x4176c1, [i]); n++; ok(c === varClass(i), `variable class of ${i}: port ${varClass(i)}, original ${c}`); }
      notes.push(`variable classes: ${n} compared`);
    }

    const hubBelow = (cur) => { for (let n = cur - 1; n > 0; n--) if (zones[nodes[n].zone].kind === 1) return true; return false; };
    const sameState = (label, E, vars, story) => {
      const nv = E.vars();
      let bad1 = '';
      for (let i = 0; i < 319; i++) if (i !== 1 && i !== 2 && nv[i] !== vars.get(i)) { bad1 = `var ${i}: port ${vars.get(i)}, original ${nv[i]}`; break; }
      checked += 319;
      if (bad1) { bad(`${label}: ${bad1}`); return false; }
      const ns = E.snap(128);
      checked += 128;
      for (let i = 0; i < 128; i++) if (ns[i] !== story.snap[i]) { bad(`${label}: snapshot ${i}: port ${story.snap[i]}, original ${ns[i]}`); return false; }
      return true;
    };

    // ---- 2. single operations on random states
    for (let seed = 1; seed <= 60; seed++) {
      const rng = makeRng(seed * 7919);
      const E = new StoryEmu(pe);
      for (let round = 0; round < 40; round++) {
        const vars = new GameVars();
        const a = Int32Array.from({ length: 319 }, () => (rng.chance(0.5) ? rng.int(40) : rng.u32() | 0));
        const cur = 1 + rng.int(70);          // node 71 is the last: the original reads past the table when it advances from there (never happens: the story ends)
        a[0x58] = cur;
        a[0x59] = rng.chance(0.7) ? nodes[cur].zone : rng.int(35);
        a[0xa3] = rng.int(35);
        const nd = nodes[cur];
        if (rng.chance(0.5)) a[nd.var] = (a[nd.var] & ~nd.mask) | nd.value;          // the node's gate satisfied
        vars.a.set(a); vars.a[1] = 0; vars.a[2] = 1;
        const story = new StoryFsm(vars, nodes, zones);
        const snap = Int32Array.from({ length: 128 }, () => (rng.chance(0.5) ? rng.int(20) : rng.u32() | 0));
        story.snap.set(snap);
        E.setVars(vars.a); E.setSnap(snap);
        const op = rng.pick(['complete', 'zoneOf', 'advance', 'stepBack', 'jump', 'jump', 'frame', 'frame', 'exit', 'rewind']);
        const label = `seed ${seed} round ${round} ${op} (node ${cur}, zone var ${a[0x59]})`;
        stats.ops[op] = (stats.ops[op] ?? 0) + 1;
        let r, m;
        if (op === 'complete') { r = E.call(0x404aa0) & 0xff; m = story.complete() ? 1 : 0; r = r ? 1 : 0; ok(r === m, `${label}: complete port ${m}, original ${r}`); }
        else if (op === 'zoneOf') { r = E.call(0x404be7); m = story.zoneOf(); ok(r === m, `${label}: zoneOf port ${m}, original ${r}`); }
        else if (op === 'advance') { E.call(0x404bb2); story.advance(); }
        else if (op === 'stepBack') { E.call(0x404af6); story.stepBack(); }
        else if (op === 'rewind') { if (!hubBelow(cur)) continue; E.call(0x404b43); story.rewind(); }
        else if (op === 'jump') { const n = rng.int(72); E.call(0x404c07, [n]); story.jump(n); }
        else if (op === 'frame') { r = E.call(0x423bad); m = story.frame(); ok(r === m, `${label}: frame port ${m}, original ${r}`); }
        else if (op === 'exit') {
          if (!hubBelow(cur)) continue;
          const c = rng.int(2), s = rng.int(2), out = E.alloc(8);
          E.mem.w32(out, 0xdead);
          E.call(0x404d14, [out, c, s]);
          r = E.mem.r32(out); m = story.miniGameExit(c !== 0, s !== 0);
          ok(r === m, `${label}: miniGameExit(${c},${s}) port ${m}, original ${r}`);
        }
        sameState(label, E, vars, story);
      }
    }

    // ---- 3. pending override / load decision / new game / set-up hook
    for (let seed = 1; seed <= 80; seed++) {
      const rng = makeRng(seed * 104729);
      const E = new StoryEmu(pe);
      const vars = new GameVars();
      const a = Int32Array.from({ length: 319 }, () => rng.int(100));
      vars.a.set(a); vars.a[1] = 0; vars.a[2] = 1;
      const story = new StoryFsm(vars, nodes, zones), loop = new ZoneLoopState(story);
      E.setVars(vars.a);
      const label = `seed ${seed}`;
      // the load decision FUN_00419bb9 for a file with the same / another node and subgame
      const sub = rng.chance(0.4) ? a[0x59] : rng.int(40), fsm = rng.chance(0.4) ? a[0x58] : rng.int(72) - (rng.chance(0.1) ? 100 : 0);
      const slot = rng.int(7);
      const hdr = new Uint8Array(0x40), dv = new DataView(hdr.buffer);
      dv.setUint32(0, 0x40, true); dv.setUint32(4, 0xd, true); dv.setInt32(8, sub, true); dv.setUint32(0xc, 1, true); dv.setInt32(0x10, fsm, true); dv.setUint32(0x14, 0x8088008, true);
      E.files.set(`_data//Save${String(slot).padStart(2, '0')}.lgo`, hdr);
      E.setPending({ kind: 0, node: 0, zone: 0 });
      E.loadBodies = 0;
      const r = E.call(0x419bb9, [slot]);
      stats.loads[r] = (stats.loads[r] ?? 0) + 1;
      const mine = loop.beginLoad(sub, fsm);
      ok(r === mine, `${label}: load decision port ${mine}, original ${r} (file ${sub}/${fsm}, game ${a[0x59]}/${a[0x58]})`);
      ok((r === 1) === (E.loadBodies === 1), `${label}: the in-place restore (body reader) ran ${E.loadBodies} times for result ${r}`);
      const pn = E.pending();
      if (r === 2) { ok(pn.kind === loop.pending.kind && pn.node === loop.pending.node && pn.zone === loop.pending.zone, `${label}: pending original ${JSON.stringify(pn)}, port ${JSON.stringify(loop.pending)}`); stats.pendingKinds[pn.kind] = (stats.pendingKinds[pn.kind] ?? 0) + 1; }
      else ok(pn.kind === 0 && loop.pending.kind === 0, `${label}: no pending after an in-place load`);
      // FUN_0041ad43: the override applied to var 0x58, the zone returned
      const z0 = E.call(0x41ad43) >>> 0, zp = loop.takeOverride();
      ok((z0 === 0xffffffff ? -1 : z0) === zp, `${label}: override zone original ${z0}, port ${zp}`);
      ok(E.vars()[0x58] === vars.get(0x58), `${label}: override node original ${E.vars()[0x58]}, port ${vars.get(0x58)}`);
      // the zone set-up FUN_0041adb5: applies a pending load (kind 1), clears the kind
      E.loadBodies = 0; const k0 = E.pending().kind;
      E.call(0x41adb5);
      const k1 = loop.loadDone();
      ok(k1 === k0 && E.pending().kind === 0 && loop.pending.kind === 0 && (E.loadBodies === 1) === (k0 === 1), `${label}: set-up: kind original ${k0} -> ${E.pending().kind} (bodies ${E.loadBodies}), port ${k1} -> ${loop.pending.kind}`);
    }
    {
      // the new game: FUN_0041a8f9 (arg -17 .. -11, never -1) sets the pending node / zone / kind 2
      const E = new StoryEmu(pe), story = new StoryFsm(new GameVars(), nodes, zones), loop = new ZoneLoopState(story);
      E.setPending({ kind: 0, node: 0, zone: 0 });
      const ret = E.call(0x41a8f9, [(-14) >>> 0]);
      loop.newGame();
      const pn = E.pending();
      ok(ret === 1 && pn.kind === 2 && pn.node === NEW_GAME_NODE && pn.zone === NEW_GAME_ZONE, `new game: original ${ret} ${JSON.stringify(pn)}, port constants ${NEW_GAME_NODE}/${NEW_GAME_ZONE}`);
      ok(loop.pending.kind === 2 && loop.pending.node === pn.node && loop.pending.zone === pn.zone, 'new game: port pending equals the original');
      ok(E.log.includes('decor-reset 1'), 'new game: the original also resets the decor (FUN_00421fa0(1)): not part of the story state');
    }

    // ---- 4. the whole zone loop FUN_00404dc9 with scripted zone functions
    for (let seed = 1; seed <= 80; seed++) {
      const rng = makeRng(seed * 15485863);
      const E = new StoryEmu(pe);
      const startVars = Int32Array.from(init);
      // random start node (as a loaded launch state would not be: the game starts at node 0) - both start at the exe's initial state, the first zone is the zone of var 0x58
      E.setVars(startVars);
      // the script: per zone call -> { ret, set: [[var, value]], pending, node override }
      const script = [];
      const len = 3 + rng.int(12);
      const hasRun = (z) => !!zones[z]?.hasRun;
      for (let k = 0; k < len; k++) {
        const step = { ret: rng.chance(0.15) ? -1 : rng.chance(0.75) ? rng.int(35) : 0, sets: [] };
        if (rng.chance(0.4)) step.sets.push([0x58, rng.int(72)]);                    // the zone moved the story (e.g. FUN_00404bb2 inside)
        if (rng.chance(0.3)) step.sets.push([0x53, 1]);
        if (rng.chance(0.25)) step.pending = { kind: 1 + rng.int(2), node: rng.int(72) - (rng.chance(0.1) ? 40 : 0), zone: rng.int(35) };
        if (rng.chance(0.2)) step.clear = true;
        script.push(step);
      }
      script.push({ ret: -2, sets: [] });
      for (const st of script) {
        E.zoneRuns.push((z, L) => {
          for (const [i, v] of st.sets) L.mem.w32(A.VARS + 4 * i, v);
          if (st.pending) L.setPending(st.pending);
          if (st.clear) L.setPending({ kind: 0, node: 0, zone: 0 });
          return st.ret;
        });
      }
      const label = `loop ${seed}`;
      // the port
      const vars = new GameVars(); vars.a.set(startVars);
      const story = new StoryFsm(vars, nodes, zones), loop = new ZoneLoopState(story);
      let ran;
      try { E.call(0x404dc9); } catch (e) { bad(`${label}: the original loop failed: ${e.message}`); continue; }
      ran = E.runLog;
      stats.loops++;
      let z = loop.begin();
      let idx = 0;
      const portRuns = [];
      for (const st of script) {
        if (z < 0) break;
        const rec = ran[idx];
        if (!rec) { bad(`${label}: the original stopped after ${idx} zone runs, the port wants to run zone ${z}`); break; }
        portRuns.push(z);
        checked++;
        if (rec.z !== z) { bad(`${label}: run ${idx}: zone original ${rec.z}, port ${z}`); break; }
        // state at the entry of the zone
        let diff = '';
        for (let i = 0; i < 319; i++) if (i !== 1 && i !== 2 && rec.vars[i] !== vars.get(i)) { diff = `var ${i}: port ${vars.get(i)}, original ${rec.vars[i]}`; break; }
        checked += 319;
        if (diff) { bad(`${label}: run ${idx} (zone ${z}) entry ${diff}`); break; }
        ok(rec.pending.kind === loop.pending.kind && rec.pending.node === loop.pending.node && rec.pending.zone === loop.pending.zone || rec.pending.kind === 0 && loop.pending.kind === 0, `${label}: run ${idx} pending original ${JSON.stringify(rec.pending)}, port ${JSON.stringify(loop.pending)}`);
        stats.zonesRun++;
        { const k = loop.loadDone(); void k; }         // the zone's set-up call FUN_0041adb5
        // the zone's effects
        for (const [i, v] of st.sets) vars.set(i, v);
        if (st.pending) loop.pending = { ...st.pending };
        if (st.clear) loop.pending = { kind: 0, node: 0, zone: 0 };
        z = loop.afterZone(st.ret);
        idx++;
      }
      checked++;
      if (z >= 0) bad(`${label}: the port still wants to run zone ${z} after the script`);
      ok(E.runLog.length === portRuns.length || z >= 0, `${label}: zone runs original ${E.runLog.length}, port ${portRuns.length}`);
      if (E.unhooked.size) bad(`${label}: unhooked calls in the original loop ${[...E.unhooked].map(([a]) => a.toString(16)).join(',')}`);
    }

    notes.unshift(`operations ${JSON.stringify(stats.ops)}; load decisions ${JSON.stringify(stats.loads)}; zone loops ${stats.loops}, zone runs ${stats.zonesRun}`);
    return { checked, failures, notes };
  },
};
