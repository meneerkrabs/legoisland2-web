// WP-SAVE, z40OGL (Ogel's island / Krystal): the save blocks of Overlay 0x7e31fc (krystals), PEPPSWIT 0x7e4f9c, void 0x7e539e, slugs 0x7e5ea7, robots 0x7e61e9, STAR 0x7e6498, citizens 0x7e69a2 AFTER
// GAMEPLAY and the load round trip. The original's nodes run natively next to the port's (tools/lib/m5-ogl-emu.mjs `OglDuel`, tools/lib/m5-z40OGL-emu.mjs `makeOglDuel`; tolerance 0 for the
// blocks); at many moments `compareBlocks` compares the original's serializer (vtable +0x14, native) with the port's `saveBlock`; at some moments the ORIGINAL's blocks are kept, the duel ticks on,
// then `restoreBlocks` puts them back into both machines (original loader natively / port `loadBlock`), the blocks must be equal again and the duel keeps comparing the nodes' records and
// states for a few hundred ticks. Uninitialised bytes of the original's node blocks are 0xCD (debug heap; the OglEmu allocator and `withCdAlloc` fill them).
import { OglDuel, CTORS, Lcg, B, RECORDS_BASE, REC } from '../lib/m5-ogl-emu.mjs';
import { makeOglDuel } from '../lib/m5-z40OGL-emu.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { oglGlobals } from '../../src/zones/z40OGL/peppswit/globals.ts';
import { compareBlocks, snapshotBlocks, restoreBlocks } from '../lib/m8-save.mjs';
import { withCdAlloc, eraDiff, ERA_VARS } from '../lib/m8-save-hubs.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const N = Number(process.env.M8_Z40_TICKS ?? 700);
const OVERLAY = 0x7e31fc;

const __test = {
  name: 'm8-save-z40',
  run(ctx) {
    return withCdAlloc(() => {
      const failures = [], notes = [];
      let checked = 0, moments = 0, loads = 0;
      const blocks = (D, what, only) => {
        const r = compareBlocks(D.P.world, D.emu, `${what} t${D.t}`, only);
        checked += r.checked; moments++;
        for (const f of r.failures) if (failures.length < 60) failures.push(f);
      };
      const roundTrip = (D, what, only, step, n, after, every, cmp, era = false) => {
        const snap = snapshotBlocks(D.emu, D.P.world, only);
        for (let k = 0; k < n; k++) step(k);
        if (era) for (const [v, x] of ERA_VARS) D.setVar(v, x);        // the era table the loader's FUN_00420674 rebuilds depends on these variables
        loads += restoreBlocks(D.P.world, D.emu, snap);
        if (era) { const e = eraDiff(D.emu, D.P.world); checked++; if (e) failures.push(`${what}: decor era table after the load: ${e}`); }
        blocks(D, `${what} after load`, only);
        const again = snapshotBlocks(D.emu, D.P.world, only);
        for (let i = 0; i < snap.length; i++) if (snap[i].bytes && Buffer.compare(Buffer.from(snap[i].bytes), Buffer.from(again[i].bytes)) !== 0) failures.push(`${what}: original block ${i} changed by its own load`);
        for (let k = 0; k < after; k++) { step(n + k); if (k % every === 0) blocks(D, `${what} run-on`, only); cmp?.(D); }
      };
      /** the real load path: a FRESH world (constructors ran at the set-up, nothing has ticked) gets the played duel's ORIGINAL blocks (native loader / port `loadBlock`), then both run on */
      const freshLoad = (mkD, played, only, ticks, every, cmp) => {
        const snap = snapshotBlocks(played.emu, played.P.world, only);
        const D2 = mkD();
        D2.label += ' fresh load';
        // the hub framework's `ctorInit` (src/hub/game.ts: right after the set-up, before any load) and the file's animation section (the clip / frame of every record's instance, FUN_0043b6a3 / 73f)
        for (const rec of D2.P.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(D2.P.world, rec);
        for (const rec of D2.P.world.records) { const oa = D2.O.world.records[rec.index].anim; if (rec.anim && oa) rec.anim.start(oa.clip, oa.frame); }
        loads += restoreBlocks(D2.P.world, D2.emu, snap);
        blocks(D2, D2.label, only);
        for (let t = 0; t < ticks; t++) { D2.tick(0); if (t % every === 0) blocks(D2, D2.label, only); cmp?.(D2); }
        fin(D2, D2.label);
      };
      const fin = (D, what) => { checked += D.checked; if (D.nfail) failures.push(...D.failures.slice(0, 5).map((s) => `${what}: ${s}`)); };

      // ---- 1. PEPPSWIT + the void node
      for (const node of [64, 66]) {
        const R = new Lcg(777 + node);
        const mkD = () => new OglDuel(ctx, { node, kinds: ['PeppSwit', 'PeppVoid'], ctors: [CTORS.PEPPSWIT, CTORS.VOID], records: (n) => n === 'PEPP', label: `pepper${node}` });
        const D = mkD();
        const pi = D.P.pepper.index, mem = D.emu.cpu.mem, W = D.P.world;
        const only = new Set([CTORS.PEPPSWIT, CTORS.VOID]);
        const clips = [0, 1, 2, 0x16, 99, 0x62, 0x1b, 0x1c, 5];
        const modes = {};
        const step = () => {
          if (R.next() < 0.08) D.setVar(0x5e, [1, 4, 8, 0x20, 0x101, 0x1001, 0x1004, 2][Math.floor(R.next() * 8)]);
          if (R.next() < 0.1) { const m = [0, 1, 2, 0x57, 0x1f, 0x38, 0x20, 0x32, 0x16, 3][Math.floor(R.next() * 10)]; mem.w32(0x8ae088, m); W.pep.mailbox = m; }
          if (R.next() < 0.1) { const c = clips[Math.floor(R.next() * clips.length)]; D.P.pepper.anim?.start(c, 0); D.O.pepper.anim?.start(c, 0); }
          if (R.next() < 0.05) { const p = D.P.pepper; D.place(pi, p.x + (R.next() - 0.5) * 20, R.next() < 0.5 ? p.y : -120 + R.next() * 40, p.z, 0); }
          if (R.next() < 0.03) { const cur = R.next() < 0.5 ? null : W.records[3]; mem.w32(0x9daa80, cur ? RECORDS_BASE + 3 * REC : 0); vehicles(W).current = cur; }
          let held = 0; if (R.next() < 0.3) held |= B.CTRL; if (R.next() < 0.05) held |= B.ENTER; if (R.next() < 0.3) held |= B.UP;
          D.tick(held);
          const m = D.getVar(0x5e) & 0xfff; modes[m] = (modes[m] ?? 0) + 1;
        };
        blocks(D, D.label, only);
        for (let i = 0; i < N; i++) { step(); if (i % 3 === 0) blocks(D, D.label, only); }
        const cmpPep = (d) => { d.rec(d.P.pepper.index, 0xffff, 0); d.vars(); d.cmp('fall', d.emu.cpu.mem.f32(0x5d5f3c0), oglGlobals(d.P.world).fall, 0); };
        roundTrip(D, `${D.label} load`, only, step, 120, 300, 3, cmpPep, true);
        freshLoad(mkD, D, only, 200, 3, cmpPep);
        for (const k of [1, 4, 8, 32]) if (!modes[k]) failures.push(`pepper${node}: mode ${k} never reached`);
        notes.push(`pepper node ${node}: modes ${JSON.stringify(modes)}`);
        fin(D, `pepper${node}`);
      }

      // ---- 2. the slugs
      for (const node of [64, 66]) {
        const R = new Lcg(4242 + node);
        const mkD = () => new OglDuel(ctx, { node, kinds: ['PeppSlug'], ctors: [CTORS.SLUG], records: (n) => /^SLG/.test(n) || n === 'PEPP', label: `slug${node}` });
        const D = mkD();
        const pi = D.P.pepper.index, mem = D.emu.cpu.mem;
        const slugs = D.P.world.records.filter((r) => /^SLG/.test(r.name)).map((r) => r.index);
        const only = new Set([CTORS.SLUG]);
        const st = {};
        const step = () => {
          if (R.next() < 0.03) { const s = D.P.world.records[slugs[Math.floor(R.next() * slugs.length)]]; D.place(pi, s.x + (R.next() - 0.5) * 30, s.y + 2, s.z + (R.next() - 0.5) * 30, 0); }
          if (R.next() < 0.01) { const c = R.next() < 0.5; D.emu.cutscene = c; D.P.ictx.held = c; }
          D.tick(0);
          for (const s of slugs) { const pn = D.P.world.records[s].ctrl.nodes[0]; st[pn.state] = (st[pn.state] ?? 0) + 1; }
        };
        const cmpSlug = (d) => { const mem = d.emu.cpu.mem; for (const s of slugs) { d.rec(s, 0xffff, 0); d.anim(s); const nd = d.emu.nodesOf(s)[0], pn = d.P.world.records[s].ctrl.nodes[0]; d.eq('state', mem.r32(nd + 0x20) | 0, pn.state); d.cmp('timer', mem.f32(nd + 0x2c), pn.timer, 0); } };
        blocks(D, D.label, only);
        for (let i = 0; i < N; i++) { step(); if (i % 3 === 0) blocks(D, D.label, only); }
        roundTrip(D, `${D.label} load`, only, step, 150, 400, 3, cmpSlug);
        freshLoad(mkD, D, only, 300, 3, cmpSlug);
        for (const k of [0, 1, 2]) if (!st[k]) failures.push(`slug${node}: state ${k} never reached`);
        notes.push(`slugs node ${node}: states ${JSON.stringify(st)}`);
        fin(D, `slug${node}`);
      }

      // ---- 3. the robots
      for (const node of [64, 66]) {
        const R = new Lcg(99 + node);
        const mkD = () => new OglDuel(ctx, { node, kinds: ['PeppRobot'], ctors: [CTORS.ROBOT], records: (n) => /^RBT/.test(n) || n === 'PEPP', label: `robot${node}` });
        const D = mkD();
        const pi = D.P.pepper.index;
        const rb = D.P.world.records.filter((r) => /^RBT/.test(r.name)).map((r) => r.index);
        const only = new Set([CTORS.ROBOT]);
        const step = () => {
          if (R.next() < 0.04) { const s = D.P.world.records[rb[Math.floor(R.next() * rb.length)]]; const k = R.next() < 0.4 ? 40 : 18; D.place(pi, s.x + (R.next() - 0.5) * k, s.y + 1, s.z + (R.next() - 0.5) * k, 0); }
          D.tick(0);
        };
        const cmpRb = (d) => { for (const s of rb) { d.rec(s, 0xffff, 0); d.anim(s); } };
        blocks(D, D.label, only);
        for (let i = 0; i < N; i++) { step(); if (i % 5 === 0) blocks(D, D.label, only); }
        roundTrip(D, `${D.label} load`, only, step, 100, 300, 5, cmpRb);
        freshLoad(mkD, D, only, 200, 5, cmpRb);
        fin(D, `robot${node}`);
      }

      // ---- 4. the citizens (node 64): the original's SGMFIG runs natively beneath them (it owns the walker); a load puts the ORIGINAL's citizen blocks back (SGMFIG's own are not mine)
      {
        const mkD = () => new OglDuel(ctx, { node: 64, kinds: ['SGMFIG', 'PeppCitizen'], ctors: [0x426151, CTORS.CITIZEN], records: (n) => /^CIT[1-5]/.test(n) || n === 'PEPP', label: 'citizen' });
        const D = mkD();
        const mem = D.emu.cpu.mem;
        const cs = D.P.world.records.filter((r) => /^CIT/.test(r.name)).map((r) => r.index);
        const only = new Set([CTORS.CITIZEN]);
        const st = {};
        const step = () => { D.tick(0); for (const s of cs) { const pn = D.P.world.records[s].ctrl.nodes.find((n) => n.kind === 'PeppCitizen'); st[pn.state] = (st[pn.state] ?? 0) + 1; } };
        blocks(D, D.label, only);
        for (let i = 0; i < N * 2; i++) { step(); if (i % 5 === 0) blocks(D, D.label, only); }
        // (the load keeps the node's cur / state; the walker's own state is the walker section's, not restored here: the citizens are compared as the blocks only, then run on)
        const snap = snapshotBlocks(D.emu, D.P.world, only);
        loads += restoreBlocks(D.P.world, D.emu, snap);
        blocks(D, 'citizen after load', only);
        for (const s of cs) {
          const pn = D.P.world.records[s].ctrl.nodes.find((n) => n.kind === 'PeppCitizen'), nd = D.emu.nodesOf(s)[1];
          D.eq('cur after load', mem.r32(nd + 0x20) | 0, pn.cur); D.eq('state after load', mem.r32(nd + 0x28) | 0, pn.state);
        }
        // the walker underneath is not restored by a node block: the fresh duel's citizens are compared on their blocks and node words (a falling citizen goes on falling from its place)
        freshLoad(mkD, D, only, 60, 3, (d) => {
          for (const s of cs) { const pn = d.P.world.records[s].ctrl.nodes.find((n) => n.kind === 'PeppCitizen'), nd = d.emu.nodesOf(s)[1]; d.eq('cur', d.emu.cpu.mem.r32(nd + 0x20) | 0, pn.cur); d.eq('state', d.emu.cpu.mem.r32(nd + 0x28) | 0, pn.state); }
        });
        if (!st[0] || !st[2]) failures.push(`citizens: states ${JSON.stringify(st)} (walking and falling expected)`);
        notes.push(`citizens: states ${JSON.stringify(st)}`);
        fin(D, 'citizen');
      }

      // ---- 5. STAR (the sky dome): the block never changes (one byte, never written): compared after the set-up and some ticks, load round trip
      {
        const D = new OglDuel(ctx, { node: 64, kinds: ['PeppHolo', 'PeppStar'], ctors: [CTORS.HOLO, CTORS.STAR], records: (n) => n === 'HOLO' || n === 'STAR' || n === 'PEPP', label: 'holo/star' });
        const only = new Set([CTORS.STAR, CTORS.HOLO]);
        blocks(D, D.label, only);
        for (let i = 0; i < 30; i++) { D.tick(0); blocks(D, D.label, only); }
        // a file with another byte in it: both loaders take it
        const snap = snapshotBlocks(D.emu, D.P.world, only);
        for (const s of snap) if (s.bytes) s.bytes = Uint8Array.from([0x5a]);
        loads += restoreBlocks(D.P.world, D.emu, snap);
        blocks(D, 'star after load of 0x5a', only);
        fin(D, 'holo/star');
      }

      // ---- 6. the krystals (Overlay): pick-ups, collected before, random walks, loads in the middle of the 3-tick countdown
      {
        const mk = (label, o, scenario) => {
          const d = makeOglDuel(ctx, { ...o, label, maxFail: 30, failures });
          scenario(d, d.P.world.records.filter((r) => /^KST[0-9]$/.test(r.name)));
          checked += d.checked;
          return d;
        };
        const only = new Set([OVERLAY]);
        const b = (d, what) => blocks(d, what, only);
        const tickB = (d, n, what) => { for (let i = 0; i < n; i++) { d.tick(); d.compare(); b(d, what); } };
        for (const node of [64, 66]) {
          mk(`krystal pick-ups node ${node}`, { node }, (d, ksts) => {
            b(d, 'start');
            for (const r of ksts) { d.placePepper(r.x + 2.5, r.y, r.z + 1); tickB(d, 6, 'pick'); }
            // load: the ORIGINAL's blocks of "all collected" put back after the krystals were reset by hand to "lying there" in both machines? no: take the blocks while the countdown runs
          });
          mk(`krystal load mid countdown node ${node}`, { node }, (d, ksts) => {
            const r = ksts[0];
            d.placePepper(r.x + 2.5, r.y, r.z + 1);
            d.tick(); d.compare(); b(d, 'tick 1');          // picked: state 3
            const snap = snapshotBlocks(d.emu, d.P.world, only);
            tickB(d, 4, 'run');                              // the countdown ran out: state 0, the bit set, gate closed
            // the loaded state goes back in (state 3 again): the node counts down again and sets the bit again
            loads += restoreBlocks(d.P.world, d.emu, snap);
            b(d, 'after load');
            tickB(d, 6, 'run-on');
          });
        }
        for (const bits of [0x2a, 0x155]) mk(`krystals collected before 0x${bits.toString(16)}`, { node: 66, vars: { 0x31: bits } }, (d, ksts) => { b(d, 'start'); for (const r of ksts) { d.placePepper(r.x + 2, r.y, r.z); tickB(d, 4, 'near'); } });
        for (const [seed, dt] of [[1, 1], [3, 0.5]]) {
          mk(`krystals random walk seed ${seed} dt ${dt}`, { node: seed % 2 ? 64 : 66, dt }, (d, ksts) => {
            let s = seed * 7919 >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
            for (let i = 0; i < 420; i++) {
              if (i % 5 === 0) { const r = ksts[Math.floor(rnd() * ksts.length)], a = rnd() * 6.2832, dist = 1 + rnd() * 6; d.placePepper(r.x + Math.cos(a) * dist, r.y + (rnd() - 0.5) * 2, r.z + Math.sin(a) * dist); }
              d.tick(); d.compare(); if (i % 2 === 0) b(d, 'walk');
            }
            const snap = snapshotBlocks(d.emu, d.P.world, only);
            for (let i = 0; i < 60; i++) { d.placePepper(ksts[i % ksts.length].x + 2, ksts[0].y, ksts[i % ksts.length].z); d.tick(); d.compare(); }
            loads += restoreBlocks(d.P.world, d.emu, snap);
            b(d, 'walk after load');
          });
        }
      }
      notes.push(`z40OGL: ${moments} comparison moments, ${loads} node loads`);
      return { checked, failures, notes };
    });
  },
};
export default guarded(__test);
