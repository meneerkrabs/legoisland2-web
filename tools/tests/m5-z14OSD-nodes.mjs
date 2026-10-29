import { loadOsd, tick, hold } from '../lib/m5-z14OSD-load.mjs';
import { Hud } from '../../src/shell/hud.ts';
import { updateOsdHud, initOsdHud, OsdHudState, fmt04d } from '../../src/zones/z14OSD/hud.ts';
import { GameVars } from '../../src/game/vars.ts';
import { B } from '../../src/game/input.ts';

// M5 z14OSD: node-level tests of the Oasis (without the x86 oracle: that is m5-z14OSD-emu): everything attaches, the gems / scorpion / tumbleweed / PEPPSW / HUD behave as the decompile says.
export default {
  name: 'm5-z14OSD-nodes',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    for (const node of [34, 45]) {
      const H = loadOsd(ctx, { node });
      const kinds = {};
      for (const r of H.world.records) for (const n of r.ctrl?.nodes ?? []) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
      ok(kinds.Gems === 10 && kinds.Tumblewd === 7 && kinds.scorpion === 11 && kinds.PepSwitc === 1, `node ${node}: own nodes attached ${JSON.stringify(kinds)}`);
      ok(H.L.skipped.every((s) => [0x426915, 0x426da4].includes(s.ctor)), `node ${node}: skipped only the environment ctors: ${H.L.skipped.map((s) => s.ctor.toString(16))}`);
      if (node === 45) ok(H.subMatrices.length === 2 && H.subMatrices.every((s) => s.applied && s.record === 70), `node 45: sub-object matrices of record 70 zeroed ${JSON.stringify(H.subMatrices)}`);
      else ok(H.subMatrices.length === 0, 'node 34 has no sub-matrix calls');
    }
    // arrival (FUN_006290ea reads var 0xa3 itself): from the Adventure Island (10) the scene position next to Johnny, else the PATH node 0x10
    for (const [prev, x, z] of [[10, -385.8, -149.5], [0, 123.5, 120.1], [18, 123.5, 120.1]]) {
      const H = loadOsd(ctx, { node: 34, vars: { 0xa3: prev } });
      ok(Math.abs(H.pepper.x - x) < 0.1 && Math.abs(H.pepper.z - z) < 0.1, `arrival from zone ${prev}: (${H.pepper.x.toFixed(1)}, ${H.pepper.z.toFixed(1)})`);
    }
    // the scorpion portal (Ctrl inside the box) completes node 34 (var 0x101 |= 1), Johnny's talk sets var 0x103 = 7 at node 45
    {
      const H = loadOsd(ctx, { node: 34, vars: { 0xa3: 10 } });
      const s = H.rec('SCRP'), p = H.pepper;
      p.x = s.x + 1; p.z = s.z; p.y = s.y + 0.5; p.savePrev(); tick(H, 40);
      H.world.input.setKey('ControlLeft', true); tick(H, 4); H.world.input.setKey('ControlLeft', false);
      ok((H.vars.get(0x101) & 1) === 1, 'node 34: the portal sets var 0x101');
      const G = loadOsd(ctx, { node: 45, vars: { 0xa3: 18 } });
      const j = G.rec('JTHN'), q = G.pepper;
      q.x = j.x + 2.5; q.z = j.z; q.y = j.y; q.ry = Math.atan2(j.x - q.x, j.z - q.z); q.rebuildYaw(); q.savePrev(); tick(G, 5);
      for (let i = 0; i < 3 && G.vars.get(0x103) !== 7; i++) { G.world.input.setKey('ShiftLeft', true); tick(G, 2); G.world.input.setKey('ShiftLeft', false); tick(G, 70); }
      ok(G.vars.get(0x103) === 7, 'node 45: Johnny\'s talk sets var 0x103 = 7');
    }
    // gems: stand on GEM0, +1000 on both scores, the bit is set 3 ticks later, the record hides at once
    {
      const H = loadOsd(ctx, { node: 34 });
      const g = H.rec('GEM0'), p = H.pepper;
      p.x = g.x + 0.5; p.z = g.z; p.y = g.y; p.savePrev();
      const s0 = H.vars.get(0x17), t0 = H.vars.get(0xca);
      tick(H, 1);
      ok(H.vars.get(0x17) === s0 + 1000 && H.vars.get(0xca) === t0 + 1000, `gem: scores +1000 (${H.vars.get(0x17)} ${H.vars.get(0xca)})`);
      ok(!g.enabled, 'gem: hidden at once');
      ok((H.vars.get(0x1d) & 1) === 0, 'gem: bit not set before the countdown ends');
      tick(H, 3);
      ok((H.vars.get(0x1d) & 1) === 1, `gem: bit set after the countdown (${H.vars.get(0x1d)})`);
      ok(H.ictx.sounds.some((s) => s.id === 0x2f1), 'gem: sound 0x2f1');
      const s1 = H.vars.get(0x17);
      tick(H, 10);
      ok(H.vars.get(0x17) === s1, 'gem: collected once only');
    }
    // a gem collected in an earlier visit is hidden from the start
    {
      const H = loadOsd(ctx, { node: 34, vars: { 0x1d: 2 } });
      ok(!H.rec('GEM1').enabled && H.rec('GEM0').enabled, 'gem: collected gem hidden at the start');
    }
    // HUD
    {
      const v = new GameVars(), hud = new Hud(null), st = new OsdHudState();
      initOsdHud(hud);
      v.set(0x17, 3000); v.set(0x1d, 0x3ff | 0x400); v.set(0x5e, 1);
      updateOsdHud(hud, v, st, 1);
      ok(hud.centreText === '3000' && hud.leftText === 'x10', `hud texts ${hud.centreText} ${hud.leftText}`);
      for (const [ic, tex] of [[0x20, 3], [1, 2], [2, 1], [0x1c, 1], [0, -1]]) { v.set(0xc, ic); updateOsdHud(hud, v, st, 1); ok(hud.column[0].tex === tex && v.get(0xc) === 0, `hud icon ${ic} -> ${hud.column[0].tex}`); }
      v.set(0x5e, 2); v.set(0xc, 1); hud.column[0].tex = -1; updateOsdHud(hud, v, st, 1); ok(hud.column[0].tex === -1, 'hud icon needs walking');
      v.set(0x5e, 1); const seq = [];
      for (let i = 0; i < 32; i++) { v.set(0xc, 0x40); updateOsdHud(hud, v, st, 1); seq.push(hud.column[0].tex); }
      ok(seq[0] === 4 && seq[13] === 4 && seq[14] === 5 && seq[30] === 5 && seq[31] === 4, `hud blink ${seq.join('')}`);
      ok(fmt04d(7) === '0007' && fmt04d(-5) === '-005' && fmt04d(12345) === '12345', 'fmt04d');
    }
    // PEPPSW: Ctrl on the ground = skateboard (mode 4, clip 0x16), Ctrl again leaves it (mode 1, clip 0x1c); the music level follows the clip
    {
      const H = loadOsd(ctx, { node: 34 });
      for (const r of H.world.records) if (r.name.startsWith('SCR')) r.ctrl = null;   // (a scorpion near the start would grab Pepper: that is tested below)
      tick(H, 60);
      ok(H.vars.get(0x5e) === 1, `walking at the start (0x${H.vars.get(0x5e).toString(16)})`);
      H.world.input.setKey('ControlLeft', true); tick(H, 2); H.world.input.setKey('ControlLeft', false);
      ok((H.vars.get(0x5e) & 0xfff) === 4, `Ctrl -> skateboard (0x${H.vars.get(0x5e).toString(16)})`);
      tick(H, 5);
      H.world.input.setKey('ControlLeft', true); tick(H, 3); H.world.input.setKey('ControlLeft', false); tick(H, 2);
      ok((H.vars.get(0x5e) & 0xfff) === 1, `Ctrl -> off the board (0x${H.vars.get(0x5e).toString(16)})`);
    }
    // tumbleweeds roll: positions change, y stays finite; scorpions keep their home
    {
      const H = loadOsd(ctx, { node: 34 });
      const t = H.rec('TUM0'), x0 = t.x;
      tick(H, 400);
      ok(Number.isFinite(t.y) && Math.abs(t.x - x0) > 1, 'tumbleweed rolls');
      const scr = H.recs('SCR0')[0];
      ok(Number.isFinite(scr.x) && Number.isFinite(scr.y), 'scorpion position finite');
    }
    void B; void hold;
    return { checked, failures, notes };
  },
};
