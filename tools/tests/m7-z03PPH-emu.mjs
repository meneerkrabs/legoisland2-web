import { loadZone } from '../lib/engine-load.mjs';
import { runDrawHooks } from '../../src/game/controller.ts';
import '../../src/zones/z03PPH.ts';
import { houseOf, CAM_POS, HOTSPOT_POS, HOTSPOT_TYPE, HOTSPOT_RADIUS, FORCE_MASK, REC, MODE, PEPPER_CONTROL, DOOR_POS } from '../../src/zones/z03PPH/house.ts';
import { createHarness, makeRng, f32, G } from '../lib/m7-z03PPH-emu.mjs';

// z03PPH, differential test (WP-VERIFY, docs/re/m3/z03PPH.md): one frame of the original loop (the engine's update pass FUN_0042226e, the view step FUN_0053dfa2, the pre-render
// pass FUN_004225c5 and the draw pass FUN_0042271b with the real node chains and vtables) runs in the x86 emulation from the port's state of every tick (tools/lib/m7-z03PPH-emu.mjs);
// then the port ticks. Compared: all 34 records (matrix, Euler, flags), the node fields (PeppHse camera easing, door, trophy browser, map view), the globals (door flag, leave, icon,
// HUD text slots), the camera after the pre-render pass, all game variables, the ran bits of every chain (the node return codes), the sounds, and the trophy part draws against the
// port's forced-part flags. The draw pass also tells which camera each record is drawn with (the "display camera" question of the doc).

const TOL = process.env.M7_TOL !== undefined ? +process.env.M7_TOL : 0;
const MAXFAIL = process.env.MAXFAIL ? +process.env.MAXFAIL : 40;

export default {
  name: 'm7-z03PPH-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const known = new Map();
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const dev = (key, msg) => { const k = known.get(key); if (k) k.count++; else known.set(key, { count: 1, first: msg }); };
    const close = (a, b, tol = TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
    const stats = { ticks: 0, hotspots: new Set(), modes: new Set(), doorStates: new Set(), icons: new Set(), snd: 0, parts: 0, leaves: 0, trophySteps: 0, camIdx: new Set(), drawViews: {}, ran: {}, lines: new Set() };
    const press = (w, mask) => { const i = w.input; i.prevHeld = i.held; i.held = mask; i.pressed = (mask ^ i.prevHeld) & mask; };
    const lcgRnd = (seed) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; }; };
    const SHIFT = 0x40;

    const make = (seed, dt = 1) => {
      const L = loadZone(ctx, 'z03PPH');
      const w = L.world;
      w.externalInput = true;
      w.dt = dt;
      const p = L.pepper;
      // Pepper's chain: the zone's own nodes (ClimLadr, PeppComp, browser, map); the port's M1 safety net (StubGuard) and the walk node are not part of the oracle's chain
      const keep = p.ctrl.nodes.filter((n) => !['StubGuard', 'SGwalk'].includes(n.kind));
      p.ctrl.nodes.splice(0, p.ctrl.nodes.length, ...keep);
      w.vars.set(PEPPER_CONTROL, 1);
      const st = houseOf(w);
      const plog = [];
      w.sfx = { play: (id) => plog.push(['snd', id]) };
      const H = createHarness(ctx, w);
      H.runCtors();
      return { L, w, p, st, H, plog, rnd: lcgRnd(seed), t: 0 };
    };

    const compareTick = (E, orig, label) => {
      const { w, st, H, plog } = E;
      const ck = (c, msg) => { checked++; if (!c) bad(`${label}: ${msg}`); };
      const cn = (a, b, msg, key) => { checked++; if (!close(a, b)) { if (key && E.known?.[key]) dev(key, `${label}: ${msg}: port ${a}, original ${b}`); else bad(`${label}: ${msg}: port ${a}, original ${b}`); } };
      const mine = H.tsRecs();
      for (let i = 0; i < mine.length; i++) {
        const a = mine[i], b = orig.recs[i], r = w.records[i];
        const trophy = i >= REC.FIRST_TROPHY && i <= REC.LAST_TROPHY;
        const fm = trophy ? ~(FORCE_MASK | 1) : ~1;           // bit 1 = in the frustum (the engine's draw pass); the trophies' forced-part bits are the port's way of drawing the node's part
        ck((a.flags & fm) === (b.flags & fm), `record ${i} ${r.name} flags port ${a.flags.toString(16)}, original ${b.flags.toString(16)}`);
        for (let k = 0; k < 16; k++) cn(a.m[k], b.m[k], `record ${i} ${r.name} m[${k}]`);
        for (let k = 0; k < 3; k++) cn(a.e[k], b.e[k], `record ${i} ${r.name} euler[${k}]`);
      }
      const mn = H.tsNodes(st);
      mn.forEach(([ri, kind, a], q) => {
        const b = orig.nodes[q][2];
        const cmp = (x, y, path) => {
          if (Array.isArray(y)) y.forEach((v, i) => cmp(x[i], v, `${path}[${i}]`));
          else cn(x, y, `${w.records[ri].name} ${kind}.${path}`);
        };
        for (const k of Object.keys(b)) cmp(a[k], b[k], k);
      });
      const gb = orig.globals;
      ck((st.doorOpen ? 1 : 0) === gb.doorOpen, `doorOpen port ${st.doorOpen}, original ${gb.doorOpen}`);
      ck((st.leave ? 1 : 0) === gb.leave, `leave port ${st.leave}, original ${gb.leave}`);
      ck(st.icon === (gb.icon | 0), `icon port ${st.icon}, original ${gb.icon | 0}`);
      for (let i = 0; i < 9; i++) cn(w.camera.c[i], gb.camera[i], `camera[${i}] after the pre-render pass`);
      for (let i = 0; i < w.vars.a.length; i++) { if (i === 1 || i === 2) continue; if ((w.vars.a[i] | 0) !== (orig.vars[i] | 0)) { ck(false, `variable 0x${i.toString(16)} port ${w.vars.a[i]}, original ${orig.vars[i]}`); break; } }
      // the chains' ran bits (the nodes' return codes decide)
      for (const [r, slots] of H.nodeSlots) {
        const bits = orig.ran.get(r) | 0;
        slots.forEach((s, i) => { const o = (bits >> i) & 1, p = r.ctrl.ran[i] ? 1 : 0; ck(o === p, `${r.name} ${s.node.kind}: ran bit port ${p}, original ${o}`); stats.ran[s.node.kind] = (stats.ran[s.node.kind] ?? 0) + (o ? 1 : 0); });
      }
      // the sounds
      const o = orig.log.filter((e) => e[0] === 'snd');
      ck(o.length === plog.length && o.every((e, i) => e[1] === plog[i][1]), `sounds port ${JSON.stringify(plog)}, original ${JSON.stringify(o)}`);
      stats.snd += o.length;
      // the trophies' part draws against the forced-part flags of the port
      const parts = orig.draws.filter((d) => d.part !== undefined).map((d) => [d.rec, d.part]);
      const pp = [];
      for (let i = REC.FIRST_TROPHY; i <= REC.LAST_TROPHY; i++) { const f = w.records[i].flags & FORCE_MASK; if (f === 0x100) pp.push([i, 0]); else if (f === 0x200) pp.push([i, 1]); else if (f === 0x400) pp.push([i, 2]); }
      ck(JSON.stringify(parts) === JSON.stringify(pp), `trophy parts port ${JSON.stringify(pp)}, original ${JSON.stringify(parts)}`);
      stats.parts += parts.length;
      // the HUD text slots: the original's strings (sprintf into DAT_05d4dd7c / 4de4c / 4df1c) against the port's message ids / number; slot 2 is never cleared by the original
      ck(st.lines.line1 === gb.line1 && st.lines.line2 === gb.line2 && st.lines.line3 === gb.line3, `text slots port ${JSON.stringify(st.lines)}, original ${JSON.stringify([gb.line1, gb.line2, gb.line3])}`);
      stats.lines.add(`${gb.line1}|${gb.line3}`);
      // coverage
      stats.hotspots.add(st.lastHotspot); stats.modes.add(w.vars.get(PEPPER_CONTROL)); stats.icons.add(st.icon); stats.camIdx.add(st.camIdx);
      for (const [r, slots] of H.nodeSlots) for (const s of slots) if (s.node.kind === 'Door') stats.doorStates.add(s.node.state);
    };

    /** the cameras of the draw pass: which view each record is drawn with (original). The loop sets the view from the camera after the update pass (FUN_0053dfa2), but the nodes' camera
     *  functions (FUN_0043cc5c = SetTransform(view)) in the pre-render pass and the draw hook of PeppHse set it again: every record is drawn with the camera the pre-render pass left. */
    const analyseViews = (E, orig) => {
      const ck = (c, msg) => { checked++; if (!c) bad(`${E.label}: ${msg}`); };
      stats.viewTicks = (stats.viewTicks ?? 0) + 1;
      const v0 = orig.views.find((v) => v.phase === 'view');
      const post = orig.camAfterPre;
      const drawn = orig.draws.filter((d) => d.part === undefined);
      // ClimLadr's draw hook (FUN_005420c4): Pepper's record is drawn by the original only while he walks; the port's draw pass (runDrawHooks) must agree
      ck(drawn.some((d) => d.rec === REC.PEPP) === !runDrawHooks(E.w, E.w.records[REC.PEPP]), `Pepper drawn in the original: ${drawn.some((d) => d.rec === REC.PEPP)}, port default draw: ${!runDrawHooks(E.w, E.w.records[REC.PEPP])} (var 0x5e ${E.w.vars.get(0x5e)})`);
      for (const d of drawn) {
        const v = orig.views.find((x) => x.no === d.view);
        const ph = v?.phase ?? 'none';
        const k = `${d.rec >= REC.PHSE ? 'rec>=PHSE' : 'rec<PHSE'}:${ph}`; stats.drawViews[k] = (stats.drawViews[k] ?? 0) + 1;
        ck(!!v && [...v.eye, ...v.target].every((x, i) => close(x, post[i])), `record ${d.rec} is drawn with a view that is not the camera after the pre-render pass (phase ${ph})`);
      }
      if (v0 && [...v0.eye, ...v0.target].some((x, i) => Math.abs(x - post[i]) > 1e-4)) stats.viewDiffers = (stats.viewDiffers ?? 0) + 1;
    };

    const step = (E, mask, label) => {
      const { w, H, st } = E;
      press(w, mask);
      let orig;
      try { orig = H.frame(st, w.input.held, w.input.pressed); } catch (e) { bad(`${label}: the original function failed: ${e.message}`); H.reset(); return false; }
      E.plog.length = 0;
      w.tick();
      stats.ticks++;
      compareTick(E, orig, label);
      E.label = label; analyseViews(E, orig);
      if (st.leave) { stats.leaves++; st.leave = false; }
      return failures.length <= MAXFAIL;
    };

    const visit = (E, ticks, label) => {
      const { w, p, rnd, st } = E;
      const trophyVars = [];
      for (let i = REC.FIRST_TROPHY; i <= REC.LAST_TROPHY; i++) { const n = w.records[i].ctrl.nodes[0]; if (n.trophyVar >= 0) trophyVars.push(n.trophyVar); }
      let n = 0, modeAge = 0;
      const run = (k, maskFn) => { for (let i = 0; i < k && n < ticks; i++, n++) { if (!step(E, maskFn(i), `${label} t${n}`)) return false; } return true; };
      while (n < ticks) {
        // trophy values change now and then (the other zones write them)
        if (rnd() < 0.2) { const v = trophyVars[Math.floor(rnd() * trophyVars.length)]; w.vars.set(v, Math.floor(rnd() * 4)); }
        const mode = w.vars.get(PEPPER_CONTROL);
        if (mode === MODE.WALK) {
          // Pepper somewhere in (and around) the house, facing any way
          const a = rnd();
          const hx = HOTSPOT_POS[Math.floor(rnd() * 5)];
          if (a < 0.5) { p.x = f32(hx[0] + (rnd() * 2 - 1) * 10); p.z = f32(hx[2] + (rnd() * 2 - 1) * 10); }
          else { p.x = f32(-22 + rnd() * 40); p.z = f32(-14 + rnd() * 32); }
          p.y = f32([0.33, 0.96, 5, 9, 12, 14][Math.floor(rnd() * 6)]);
          const f = rnd();
          p.ry = f < 0.3 ? 0 : f < 0.5 ? (rnd() * 2 - 1) * 0.9 : f < 0.65 ? Math.PI + (rnd() * 2 - 1) * 0.9 : (rnd() * 2 - 1) * Math.PI;
          p.ry = f32(p.ry); p.setEuler(0, p.ry, 0, p.x, p.y, p.z); p.savePrev();
          modeAge = 0;
          if (!run(1 + Math.floor(rnd() * 6), (i) => (i === Math.floor(rnd() * 3) && rnd() < 0.5 ? SHIFT : 0))) return false;
          if (rnd() < 0.3 && !run(30 + Math.floor(rnd() * 50), () => 0)) return false;
        } else if (mode === MODE.COMPUTER) {
          // the computer menu is not part of the oracle: after a while the player leaves it
          if (!run(2 + Math.floor(rnd() * 12), () => 0)) return false;
          w.vars.set(PEPPER_CONTROL, MODE.WALK);
        } else {
          // browser / map: Left / Right / buttons at random moments, long stretches of easing
          const keys = [0, 0, 0, 1, 2, 1, 2, SHIFT, 0x10, 0x80, 0x20, 4, 8];
          if (!run(1 + Math.floor(rnd() * 25), () => (rnd() < 0.25 ? keys[Math.floor(rnd() * keys.length)] : 0))) return false;
          if (++modeAge > 8) { w.vars.set(PEPPER_CONTROL, MODE.WALK); modeAge = 0; }
        }
      }
      return true;
    };

    try {
      const t0 = Date.now();
      // ---- 0. the constructors: the constant tables the port uses
      {
        const E = make(1), { H, w } = E;
        const c = H.runCtors();
        const mem = H.mem;
        const ck = (cond, msg) => { checked++; if (!cond) bad(`ctor: ${msg}`); };
        const cn = (a, b, msg) => { checked++; if (!close(a, b)) bad(`ctor: ${msg}: port ${a}, original ${b}`); };
        const hse = H.slotOf(w.records[REC.PHSE], 'PeppHse').ptr;
        for (let k = 0; k < 2; k++) for (let i = 0; i < 3; i++) cn(CAM_POS[k][i], mem.f32(hse + 0x14 + 0xc * k + 4 * i), `camera ${k}[${i}]`);
        for (let h = 0; h < 5; h++) {
          for (let i = 0; i < 3; i++) cn(HOTSPOT_POS[h][i], mem.f32(hse + 0x34 + 0xc * h + 4 * i), `hotspot ${h} centre[${i}]`);
          ck(HOTSPOT_TYPE[h] === mem.r32(hse + 0x70 + 4 * h), `hotspot ${h} type`); cn(HOTSPOT_RADIUS[h], mem.f32(hse + 0x84 + 4 * h), `hotspot ${h} half size`);
        }
        for (let i = 0; i < 3; i++) cn(CAM_POS[1][i], mem.f32(hse + 0x98 + 4 * i), `the eased camera starts at camera 1 [${i}]`);
        ck(mem.r32(hse + 0xa4) === houseOf(w).camIdx, `initial camera index port ${houseOf(w).camIdx}, original ${mem.r32(hse + 0xa4)}`);
        // trophies: the three words of the attach and the kind
        for (let i = REC.FIRST_TROPHY; i <= REC.LAST_TROPHY; i++) {
          const r = w.records[i], n = r.ctrl.nodes[0], p = H.slotOf(r, n.kind).ptr;
          ck(mem.r32(p + 0x1c) === n.trophyVar && mem.r32(p + 0x20) === n.hiscoreVar && mem.r32(p + 0x24) === n.sound && mem.r32(p + 0x14) === n.islandKind, `${r.name} trophy words`);
        }
        ck(H.soundIdOf(mem.u32(0x5d58710)) !== undefined, 'the trophy jingle handles of FUN_0053e7c0');
        // the return codes the chains rely on: ClimLadr's update returns 3 (ran, chain continues: no controller of the house has an exclusive node), PeppHse / PeppComp / the trophies / the map / browser 1, the door 2
        {
          const rets = {};
          for (const [r, slots] of H.nodeSlots) for (const sl of slots) { const vt = { ClimLadr: 0x542090, PeppHse: 0x54042d, PeppComp: 0x53ff69, Door: 0x540b96, PeppHseLand: 0x540e6f, Trophy: 0x541000, TrophyIsland: 0x541258, TrophyBrowser: 0x5414b0, MapView: 0x541c98 }[sl.node.kind]; if (!vt || rets[sl.node.kind] !== undefined) continue; H.mirrorRecords(); H.writeGlobals(houseOf(w)); try { rets[sl.node.kind] = H.cpu.call(vt, [H.recPtr(r), sl.ptr, H.ctrlPtr(r), 0], { maxSteps: 1e6 }) | 0; } catch (e) { rets[sl.node.kind] = `error ${e.message}`; } }
          notes.push(`update return codes: ${JSON.stringify(rets)}`);
          ck(rets.ClimLadr === 3, `ClimLadr returns ${rets.ClimLadr}`);
        }
        notes.push(`constructors: PeppHse tables, ${REC.LAST_TROPHY - REC.FIRST_TROPHY + 1} trophy blocks checked`);
      }
      // ---- 1. scripted visits: walking (hotspots, cameras, door), the trophy browser, the map, the computer, trophies changing
      for (let sd = 0; sd < 6; sd++) { const E = make(10 + sd); visit(E, 2500, `visit${sd}`); }
      // the same at dt = 0.5 (the 60 Hz step: every dt-scaled node step halves, the per-frame counters do not)
      for (let sd = 0; sd < 3; sd++) { const E = make(30 + sd, 0.5); visit(E, 2500, `visit dt0.5 ${sd}`); }
      notes.push(`ticks ${stats.ticks} in ${Date.now() - t0} ms`);
    } catch (e) {
      bad(`test crashed: ${e.stack || e}`);
    }
    notes.push(`coverage: hotspots ${[...stats.hotspots].sort()}, modes ${[...stats.modes].sort()}, door states ${[...stats.doorStates].sort()}, icons ${[...stats.icons].sort()}, camera floors ${[...stats.camIdx].sort()}, leaves ${stats.leaves}, sounds ${stats.snd}, trophy part draws ${stats.parts}`);
    notes.push(`nodes that ran (ran bits): ${JSON.stringify(stats.ran)}`);
    notes.push(`records drawn per active view: ${JSON.stringify(stats.drawViews)}; ticks where the view set by the loop after the update pass (FUN_0053dfa2) differs from the camera the frame is drawn with: ${stats.viewDiffers ?? 0} of ${stats.viewTicks ?? 0}`);
    notes.push(`text lines seen: ${[...stats.lines].slice(0, 6).join(' ; ')}`);
    for (const [k, v] of known) notes.push(`KNOWN DEVIATION ${k}: ${v.count} x, first ${v.first}`);
    return { checked, failures, notes };
  },
};
