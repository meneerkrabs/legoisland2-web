import { loadIsland, tick } from '../lib/island-load.mjs';
import { loadIslandWalkMaps, startIslandNpcs } from '../../src/island/npc/index.ts';
import { startPizzaNodes } from '../../src/island/pizza/index.ts';
import { launchArc } from '../../src/island/npc/launch.ts';
import { SwimSplashNode } from '../../src/island/vehicles/swimsplash.ts';
import { shearMatrix, HoloNode } from '../../src/island/trigger/holo.ts';
import { applyRosterRecords, applyDecorSets, decorSetsOf, tickLooks } from '../../src/island/vehicles/looks.ts';
import { setIslandRandom } from '../../src/island/rng.ts';
import { crashSoundId, parkSession, parkSlotOf, islandSlot2d } from '../../src/island/vehicles/crashsound.ts';
import { createGameCpu } from '../../src/formats/x86emu.ts';
import { applyDecorEra, readDecorSetGroups, decorEraColumn } from '../../src/island/decorsets.ts';

// WP-ISLAND (gaps S3 / S6 / S8 / S11): the kids' jump node (FUN_004bf329), Pepper's swim splash ring (FUN_0088d1f6 / FUN_0088cfcb), the hologram's shimmer (FUN_0088d666 state 3),
// the records FUN_0051c823 hides, the NPC groups of the era set-ups. Run: node tools/test-formats.mjs --only m4-s-island -v

const f32 = Math.fround;

export default {
  name: 'm4-s-island',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;
    const world = (node, extra = {}) => {
      const I = loadIsland(ctx, { node, ...extra });
      loadIslandWalkMaps(I.archive, I.ictx.setup);
      startPizzaNodes(I.world); startIslandNpcs(I.world);
      return I;
    };

    // ---------------------------------------------------------------- S3a: the kids' jump
    {
      // the constructor's arithmetic by hand: g = 0.032 (the animation set's DAT_008add08), H = 0.25 * 8 = 2, lift = 0.2, target 2.2: t(t+1) * g / 2 > 2.2 -> t = 12 (g * 12 * 13 / 2 = 2.496;
      // t = 11: 2.112); v = 12 g = 0.384; second loop: y(0) = g = 0.032, y(1) = 0.384 + 0.032 = 0.416 > 0.2 -> i = 1; time = 13 + 10 (the clip) = 23
      const arc = launchArc({ dist: 0.25, lift: 0, waypoint: -1, variable: 0x122, clip: 0x84, once: 1 }, 0.032);
      ok(near(arc.velocity, -f32(12 * f32(0.032))) && arc.time === 23, `launch arc: v ${arc.velocity}, time ${arc.time} (-0.384, 23)`);
      const arc2 = launchArc({ dist: 0.25, lift: 0, waypoint: -1, variable: 0, clip: 0, once: 0 }, 0.032);
      ok(arc2.time === 13, `without a clip no extra 10 ticks (${arc2.time})`);
      const I = world(2);
      const W = I.world;
      const kid = I.rec('XXX0');
      const nodes = kid.ctrl.nodes.filter((n) => n.kind === 'launch');
      ok(nodes.length === 2 && nodes[0].mask === 4 && nodes[0].value === 4 && nodes[1].mask === 2 && nodes[1].value === 3, `XXX0 has the two launch nodes (gates & 4 == 4 and the dead & 2 == 3): ${nodes.map((n) => n.mask + '/' + n.value)}`);
      ok(W.vars.get(0x122) === 23, `the constructor wrote the flight time into var 0x122 (${W.vars.get(0x122)})`);
      const n0 = nodes[0];
      ok(near(n0.velocity, arc.velocity) && n0.time === 23, 'the node holds the arc');
      // jump: MOVE_XXX0 (0x73) bit 4
      const head = kid.ctrl.nodes[0];
      kid.ctrl.flags |= 2;
      W.vars.set(0x73, W.vars.get(0x73) | 4);
      const y0 = kid.y;
      let ymax = y0, states = new Set(), launched = -1, ended = -1, clips = new Set();
      tick(I, 140, (i) => {
        ymax = Math.max(ymax, kid.y); states.add(n0.state); clips.add(kid.anim?.clip);
        if (launched < 0 && head.falling && head.fallVel < 0) launched = i;
        if (ended < 0 && (W.vars.get(0x73) & 4) === 0) ended = i;
      });
      ok(clips.has(0x84), `the jump clip 0x84 plays (${[...clips]})`);
      ok(launched >= 0 && launched <= 14, `launched (the head falls with velocity ${arc.velocity}) after the clip's frame 10 (tick ${launched})`);
      ok(ymax - y0 > 1.5 && ymax - y0 < 3.2, `the kid rises about the arc's height (${(ymax - y0).toFixed(2)} units; the apex of a launch with v 0.384, g 0.032 is ~2.4)`);
      ok(ended > 0 && (W.vars.get(0x73) & 4) === 0, `the node clears its gate bit 4 when the clip ended (tick ${ended})`);
      ok(Math.abs(kid.y - y0) < 0.6, `back on the ground after the arc (${(kid.y - y0).toFixed(2)})`);
      notes.push(`kid jump: apex ${(ymax - y0).toFixed(2)}, launched tick ${launched}, ended tick ${ended}, states ${[...states]}`);
    }

    // the constructor against the ORIGINAL FUN_004bf329 run in the x86 interpreter (head node, argument block, game-variable write as hosts)
    {
      const I = loadIsland(ctx, { node: 2 });
      const pe = I.pe;
      const cpu = createGameCpu(pe), mem = cpu.mem;
      const HEAP = 0x20000000;
      mem.addRegion({ lo: HEAP, hi: HEAP + 0x100000, name: 'heap' });
      let heap = HEAP;
      const alloc = (n) => { const p = heap; heap += (n + 15) & ~15; return p; };
      const wr32 = (a, v) => mem.w32(a, v >>> 0);
      const bits = (f) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f, true); return b.getUint32(0, true); };
      const written = [];
      cpu.exec = [[0x4bf329, 0x4bf598], [0x858d30, 0x873e00]];
      cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
      cpu.hooks.set(0x85abc0, () => {});
      cpu.hooks.set(0x433d38, (c) => { c.eax = alloc(c.arg(0)); });
      cpu.hooks.set(0x4239d9, (c) => { c.eax = mem.u32(c.arg(0)); });
      cpu.hooks.set(0x417597, (c) => { written.push([c.arg(0), c.arg(1) | 0]); });
      let agree = 0, total = 0, maxd = 0;
      for (const [dist, lift, clip, setIndex] of [[0.25, 0, 0x84, 0], [0.25, 0, 0, 0], [0.05, 0, 0, 0], [0.4, 1.5, 0x84, 1], [1, 0, 0x84, 2], [0.1, 0.3, 5, 0]]) {
        const rec = alloc(0x68), ctrlp = alloc(0x20), head = alloc(0x60), arg = alloc(0x18), node = alloc(0x30);
        wr32(rec + 0x5c, ctrlp); wr32(ctrlp, head);
        mem.w16(head + 0x28, setIndex);
        wr32(arg, bits(dist)); wr32(arg + 4, bits(lift)); wr32(arg + 8, 0xffffffff); wr32(arg + 12, 0x122); wr32(arg + 16, clip); wr32(arg + 20, 1);
        written.length = 0;
        cpu.call(0x4bf329, [rec, arg, node, 0x73, 4, 4]);
        const velO = mem.f32(node + 0x18), timeO = mem.f32(node + 0x1c);
        const g = (() => { const b = 0x8adcf8 + setIndex * 0x14 + 0x10; const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, pe.u32(b), true); return d.getFloat32(0, true); })();
        const mine = launchArc({ dist, lift, waypoint: -1, variable: 0x122, clip, once: 1 }, g);
        total++;
        const d = Math.max(Math.abs(mine.velocity - velO), Math.abs(mine.time - timeO));
        maxd = Math.max(maxd, d);
        if (d === 0 && written.length === 1 && written[0][0] === 0x122 && written[0][1] === Math.trunc(f32(mine.time + 0.5))) agree++;
        else failures.push(`launch arc ${dist}/${lift}/${clip}/set ${setIndex}: original v ${velO} t ${timeO} var ${JSON.stringify(written)}, port v ${mine.velocity} t ${mine.time}`);
      }
      checked++;
      notes.push(`launch constructor: ${agree} / ${total} cases identical to the original FUN_004bf329 (velocity, flight time, var 0x122 write)`);
    }

    // ---------------------------------------------------------------- S3b: the swim splash
    {
      const I = world(2);
      const W = I.world, splh = I.rec('SPLH'), pep = I.pepper;
      const node = splh.ctrl.nodes.find((n) => n.kind === 'swimSplash');
      ok(node instanceof SwimSplashNode && node.var === 0x5e && node.mask === 0, 'SPLH has the swim splash node (gate PEPPER_CONTROL, mask 0)');
      // not swimming: not drawn, the blob shadow comes back (var 0xc5 -1 -> 4)
      W.vars.set(0x5e, 1); W.vars.set(0xc5, -1);
      node.prerender(W, splh);
      ok((splh.flags & 0x8000) !== 0 && W.vars.get(0xc5) === 4, 'walking: SPLH is not drawn, var 0xc5 -1 -> 4');
      W.vars.set(0xc5, 1); node.prerender(W, splh);
      ok(W.vars.get(0xc5) === 1, 'var 0xc5 other than -1 is left alone');
      // swimming: at the sea level under Pepper, yaw of Pepper, trailing by the squared distance moved since the last draw
      pep.x = 50; pep.z = 60; pep.y = W.seaLevel; pep.ry = 0.7; pep.rebuildYaw();
      W.vars.set(0x5e, 2);
      node.prev = [50, 0, 60];
      node.prerender(W, splh);
      ok((splh.flags & 0x8000) === 0 && W.vars.get(0xc5) === -1, 'swimming: drawn, var 0xc5 := -1');
      ok(near(splh.x, 50, 1e-4) && near(splh.y, W.seaLevel, 1e-4) && near(splh.z, 60, 1e-4) && near(splh.ry, 0.7), `at Pepper's spot on the sea (${splh.x}, ${splh.y}, ${splh.z}) with his yaw`);
      pep.x = 53; pep.z = 64;      // moved (3, 4): d2 = 25
      node.prev = [50, 0, 60];
      node.prerender(W, splh);
      const k = -25;     // DAT_05defbb4 (0) - d2 * DAT_00982b84 (1)
      ok(near(splh.x, 53 + k * pep.m[8], 1e-3) && near(splh.z, 64 + k * pep.m[10], 1e-3) && near(splh.y, W.seaLevel + k * pep.m[9], 1e-3), `trails by d2 = 25 along Pepper's forward row: (${splh.x.toFixed(3)}, ${splh.y.toFixed(3)}, ${splh.z.toFixed(3)})`);
      ok(node.prev[0] === 53 && node.prev[2] === 64, 'the globals hold his position for the next call');
    }

    // the swim splash against the ORIGINAL draw hook FUN_0088cfcb run in the x86 interpreter (vars and the record draw as hosts; FUN_0043a742, the matrix builder, runs natively)
    {
      const I = loadIsland(ctx, { node: 2 });
      const W = I.world, splh = I.rec('SPLH'), pep = I.pepper;
      const node = splh.ctrl.nodes.find((n) => n.kind === 'swimSplash');
      const cpu = createGameCpu(I.pe), mem = cpu.mem;
      const RB = 0x10000000; mem.addRegion({ lo: RB, hi: RB + 0x1000, name: 'recs' });
      const bits = (f) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, f, true); return b.getUint32(0, true); };
      const vars = new Map(); let drawn = 0;
      cpu.exec = [[0x43a000, 0x43e000], [0x88cfcb, 0x88d1b0], [0x858d30, 0x873e00]];
      cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
      cpu.hooks.set(0x85abc0, () => {});
      cpu.hooks.set(0x417575, (c) => { c.eax = vars.get(c.arg(0)) ?? 0; });
      cpu.hooks.set(0x417597, (c) => { vars.set(c.arg(0), c.arg(1) | 0); });
      cpu.hooks.set(0x444480, () => { drawn++; });
      const PEP = RB, REC = RB + 0x100, NODE = RB + 0x200;
      mem.w32(0x9da5d0, PEP); mem.w32(0x9da858, bits(W.seaLevel));
      for (const a of [0x5defbb4, 0x5defbb8, 0x5defbbc, 0x5defbc0]) { try { mem.w32(a, 0); } catch { /* mapped by the image */ } }
      let rs = 11; const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
      let same = 0, total = 0, maxd = 0;
      for (let k = 0; k < 60; k++) {
        const swimming = rnd() < 0.7;
        const px = (rnd() - 0.5) * 800, py = rnd() * 3, pz = (rnd() - 0.5) * 800, yaw = (rnd() - 0.5) * 6.2;
        pep.x = px; pep.y = py; pep.z = pz; pep.ry = yaw; pep.rebuildYaw();
        const prev = [px + (rnd() - 0.5) * 3, 0, pz + (rnd() - 0.5) * 3];
        // memory side
        for (let j = 0; j < 16; j++) mem.w32(PEP + 0xc + 4 * j, bits(pep.m[j]));
        mem.w32(PEP + 0x50, bits(yaw));
        mem.w32(0x5defbb8, bits(prev[0])); mem.w32(0x5defbbc, bits(prev[1])); mem.w32(0x5defbc0, bits(prev[2]));
        mem.w32(REC + 0x50, bits(0.3)); for (let j = 0; j < 16; j++) mem.w32(REC + 0xc + 4 * j, bits(j % 5 === 0 ? 1 : 0));
        mem.w32(NODE, 0x5e);
        const pc = swimming ? 2 : 1, shadow0 = [-1, 4, 1][k % 3];
        vars.set(0x5e, pc); vars.set(0xc5, shadow0); drawn = 0;
        cpu.call(0x88cfcb, [REC, NODE, 0, 0]);
        // port side
        W.vars.set(0x5e, pc); W.vars.set(0xc5, shadow0); splh.flags &= ~0x8000; splh.ry = 0.3; node.prev = [prev[0], prev[1], prev[2]];
        node.prerender(W, splh);
        total++;
        const portDrawn = (splh.flags & 0x8000) === 0;
        let d = 0;
        if (swimming) {
          for (let j = 0; j < 16; j++) d = Math.max(d, Math.abs(mem.f32(REC + 0xc + 4 * j) - splh.m[j]));
          d = Math.max(d, Math.abs(mem.f32(REC + 0x50) - splh.ry));
        }
        maxd = Math.max(maxd, d);
        if (portDrawn === (drawn > 0) && (vars.get(0xc5) | 0) === (W.vars.get(0xc5) | 0) && d < 2e-3) same++;
        else failures.push(`splash case ${k} (swim ${swimming}): drawn port ${portDrawn} / original ${drawn > 0}, var 0xc5 ${W.vars.get(0xc5)} / ${vars.get(0xc5)}, max matrix diff ${d}`);
      }
      checked++;
      notes.push(`swim splash: ${same} / ${total} cases identical to the original FUN_0088cfcb (drawn flag, var 0xc5, matrix; max matrix difference ${maxd.toExponential(1)})`);
    }

    // ---------------------------------------------------------------- S6: the hologram's shimmer = a shear of the matrix
    {
      const m = Float32Array.from([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 1]);
      shearMatrix(m, 1, -0.25, 0.4);
      // right row' = 1 * right - 0.25 * up + 0.4 * forward; the other rows are untouched
      ok(near(m[0], 1 - 0.25 * 4 + 0.4 * 7) && near(m[1], 2 - 0.25 * 5 + 0.4 * 8) && near(m[2], 3 - 0.25 * 6 + 0.4 * 9) && m[4] === 4 && m[8] === 7 && m[12] === 10 && m[14] === 12, 'shearMatrix: S * M with S = identity whose first row is (1, r, r)');
      const I = loadIsland(ctx, { node: 2 });
      const W = I.world, holo = I.rec('HOLO');
      const hn = holo.ctrl.nodes.find((n) => n.kind === 'hOLO');
      let seq = [0.99, 0.7, 0.4];   // rand(10): 9.9 (> 10 - 2L for L = 0.5, but < 10 - L? 9.9 > 9.5: blink); use values that pick the shimmer
      // state 0, L = 0.5 (Pepper far away): shimmer when 9 < rand(10) <= 9.5, i.e. u * 10 in (9, 9.5]: u = 0.92; then rand(1) - 0.5 = u2 - 0.5
      const us = [0.92, 0.8];
      let i = 0;
      setIslandRandom(() => (new Error().stack ?? '').includes('trigger/holo') ? (us[i++] ?? 0.5) : 0.5);   // (the island's other nodes draw too: only the hologram's draws are scripted)
      hn.st = 2; hn.show = 0; hn.scale = 0.75; hn.face = 3; hn.letter = 0x40;
      W.vars.set(0x58, 2);
      W.focus = I.pepper; holo.flags |= 2;
      W.camera.c[9] = 1; W.camera.c[17] = 1;      // the view basis: the hologram stands 4 to the left and 2 ahead of Pepper (squared distance 20: finding V8, the far rate 0.5)
      tick(I, 1);
      ok(hn.show === 3 && near(hn.shimmer, 0.8 - 0.5, 1e-4), `state 0 -> shimmer (state 3) with node +0x48 = rand(1) - 0.5 = 0.3 (rand = floor(u * 32768) / 32767 (show ${hn.show}, shimmer ${hn.shimmer})`);
      setIslandRandom(null);
    }

    // ---------------------------------------------------------------- S11: the records FUN_0051c823 hides
    {
      const I = loadIsland(ctx, { node: 2, roster: false });
      const W = I.world;
      const names = ['BS00', 'OBL0', 'JAK0', 'BRL0', 'CT00', 'CA00', 'CR00', 'FO00', 'LE00', 'FL00', 'FF00', 'OS00', 'TS00', 'TRGO', 'TRSI', 'TRBR', 'OPL0', 'OPL1', 'OPL2'];
      ok(names.every((n) => I.rec(n)?.enabled), 'before: the 19 records of the roster call\'s hidden list are enabled (the emulated set-up dropped the writes)');
      applyRosterRecords(W, I.pe);
      ok(names.every((n) => !I.rec(n).enabled), 'after FUN_0051c823\'s writes they are hidden');
      ok(I.rec('JETT').enabled && I.rec('SPLH').enabled, 'JETT and SPLH are not in that list (SPLH is hidden by its own draw hook, S3b)');
      const veh = ['AMBU', 'DNGY', 'JSKI', 'SPBT', 'RHEL', 'PHEL', 'SPD0', 'SPD1', 'SPD2', 'PCAR'];
      ok(W.records.filter((r) => r && r.variant === 2).map((r) => r.name).sort().join() === [...veh].sort().join(), 'variant word 2: the ten roster vehicles');
      const typ1 = W.records.filter((r) => r && (r.variant & 0xff) === 1);
      ok(typ1.length > 100 && typ1.length <= 176 && W.records.every((r) => !r || r.variant === 0 || r.variant === 2 || (r.variant & 0xff) === 1), `type 1 (decor / outfit) variant words: ${typ1.length} records (set << 8 | 1 | variant << 16), all others 0`);
    }

    // ---------------------------------------------------------------- S8: the NPC groups of the era set-ups (FUN_0042407f, 8 call sites in the island region)
    {
      const want = { 2: 5, 12: 1, 31: 1, 55: 1, 70: 5 };   // era 4 runs era 0's function again
      for (const [node, n] of Object.entries(want)) {
        const I = world(+node);
        const calls = I.ictx.setup.calls.filter((c) => c.fn === 0x42407f).length;
        const groups = I.world.ext.get('npc')?.groups?.length ?? 0;
        ok(calls === n && groups === n, `node ${node}: ${calls} FUN_0042407f calls in the emulated set-up, ${groups} groups registered (${n})`);
      }
    }
    // ---------------------------------------------------------------- the probe pass (FUN_00427233): one pass per frame between the update and the pre-render pass
    {
      const I = world(2);
      const W = I.world;
      ok(typeof W.beforePrerender === 'function', 'startIslandNpcs installs the probe pass hook');
      let order = [];
      const hook = W.beforePrerender;
      W.beforePrerender = (w) => { order.push('probe'); hook(w); };
      for (const r of W.records) { const n = r.ctrl?.nodes[0]; if (n && !n.__w) { n.__w = 1; const pr = n.prerender; if (pr) n.prerender = function (...a) { order.push('pre'); return pr.apply(this, a); }; } }
      tick(I, 3);
      const firstPre = order.indexOf('pre');
      ok(order.filter((x) => x === 'probe').length === 3 && (firstPre < 0 || order.slice(0, 1)[0] === 'probe'), `the probe pass runs once per tick, before the pre-render nodes (${order.slice(0, 6)})`);
    }
    // the Brikimal draw hook FUN_004bd41a is the blob shadow (FUN_00444940): the renderer draws it for the record
    {
      const I = world(2);
      const bml = I.rec('BML1');
      ok(bml?.ctrl?.nodes.some((n) => n.kind === 'Brikimal' && n.blobShadow === true), 'Brikimal nodes carry the blob-shadow draw hook');
    }
    // FUN_00420674 (the decor sets' era table, BAATAT = DAT_009da5b4) against the original code on the x86 emulator: every story node, trophy level and cheat state
    {
      const I = world(2);
      const pe = I.pe;
      const cpu = createGameCpu(pe), mem = cpu.mem;
      cpu.exec = [[0x420674, 0x420837]];
      cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
      cpu.hooks.set(0x85abc0, () => {});
      const vars = new Map();
      cpu.hooks.set(0x417575, (c) => { c.eax = vars.get(c.arg(0)) ?? 0; });
      let cases = 0, bad = 0;
      const mine = readDecorSetGroups(pe);
      const rows = mine.length - 1;
      const sampled = new Set();
      for (const baatat of [0, 1]) for (let node = 0; node < 0x62; node++) for (let tro = 0; tro < 4; tro++) {
        // the trophy variables: all four at `tro` (the offsets 3 / 2 / 1 / 0 steps), and one lagging (keeps the step below)
        for (const lag of [0, 1]) {
          vars.clear(); vars.set(0x58, node);
          for (const v of [0x49, 0x90, 0xb9, 0x8f]) vars.set(v, tro);
          if (lag && tro > 0) vars.set(0x8f, tro - 1);
          mem.w32(0x9da5b4, baatat);
          cpu.call(0x420674, []);
          applyDecorEra(pe, mine, (v) => vars.get(v) ?? 0, !!baatat);
          cases++;
          for (let i = 0; i < rows; i++) if ((mem.u32(0x8acb98 + i * 0x18) | 0) !== mine[i]) bad++;
          sampled.add(`${decorEraColumn(node, !!baatat)}`);
        }
      }
      // the island's wiring: IslandCtx.baatat; typing the cheat re-runs the table at the next look tick (the cheat calls FUN_00420674 at once)
      const W = I.world;
      W.vars.set(0x58, 0x50);
      applyDecorSets(W, pe);
      ok(decorSetsOf(W).groups[1] === 44 && decorSetsOf(W).baatat === false, `node 0x50 without the cheat: set 1 -> era 3 column (${decorSetsOf(W).groups[1]})`);
      let cheat = false; I.ictx.baatat = () => cheat;
      cheat = true;
      tickLooks(W);
      ok(decorSetsOf(W).baatat === true && decorSetsOf(W).groups[1] === 64, `BAATAT typed: the table follows (${decorSetsOf(W).groups[1]})`);
      ok(bad === 0, `FUN_00420674: ${cases} cases (nodes 0..0x61, trophy levels, BAATAT on / off): ${bad} differing set rows`);
      ok(['0', '1', '2', '3', '4'].every((c) => sampled.has(c)), `all five era columns were exercised (${[...sampled]})`);
    }
    // the skateboard crash sound: DAT_05d58064 is only written by the park's sound set (S1)
    {
      const I = world(2), pe = I.pe;
      parkSession.visited = false;
      ok(crashSoundId(pe) === 880, `fresh process: slot 0 of the island's 2D bank = SND_PEPPS_CAR 880 (${crashSoundId(pe)})`);
      const k = parkSlotOf(pe, 0x5d58064);
      ok(k === 9 || k > 0, `the park stores the crash handle from its 2D load number ${k}`);
      parkSession.visited = true;
      ok(crashSoundId(pe) === islandSlot2d(k), `after a park visit: the island's 2D slot ${k} (${crashSoundId(pe)})`);
      parkSession.visited = false;
    }
    return { checked, failures, notes };
  },
};
