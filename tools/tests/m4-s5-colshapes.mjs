import { loadIsland } from '../lib/island-load.mjs';
import { ColOracle } from '../lib/col-oracle.mjs';
import { headerOnlyColSlots } from '../../src/island/colshapes.ts';

// gaps S5: why the skateboard's sweeps do not lift Pepper onto the board record at his feet. The island's loader FUN_004f645b loads SkBoard.col (and the rig / head / hat / tool
// collision files of the minifigs, bots, swifts, the Ptera) with FUN_0043f700, the header-only loader: no polygons. This test reads that out of the loader code, strips the polygons
// (src/island/colshapes.ts), and runs the ORIGINAL FUN_00441270 in the x86 interpreter against the board record in both layouts: with polygons it hits the board exactly where
// the port's sweep does (a differential test of the port's collision on the board: random placements and sweeps), header-only it finds nothing.
// Run: node tools/test-formats.mjs --only m4-s5-colshapes -v

const f32 = Math.fround;
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

export default {
  name: 'm4-s5-colshapes',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    // --- the loader's header-only slots
    const I = loadIsland(ctx, { node: 2, headerCols: false, roster: false });
    const W = I.world, pe = I.pe, sc = I.scene;
    const slots = headerOnlyColSlots(pe, sc.loaderAt);
    ok(slots.size === 188, `the island's loader loads 188 collision files with FUN_0043f700 (${slots.size})`);
    ok([...slots].every(([s, p]) => sc.colPaths[s] === p), 'every header-only slot names the path the extraction has for that slot');
    const sbrd = sc.records[9];
    ok(sbrd.name === 'SBRD' && slots.get(sbrd.col)?.endsWith('SkBoard.col'), 'SBRD (record 9) uses SkBoard.col: header only');
    const hdrRecs = sc.records.filter((r) => r.col >= 0 && slots.has(r.col)).map((r) => r.name);
    ok(hdrRecs.length === 60 && ['SBRD', 'PEPP', 'PTER', 'CNST', 'RHCP', 'BBT0', 'SFT0', 'RBT0', 'INFO'].every((n) => hdrRecs.includes(n)), `60 records have a header-only collision object (${hdrRecs.length})`);
    ok(!slots.has(sc.records[4].col) && !slots.has(sc.records.find((r) => r.name === 'PHSE').col), 'LAND and the buildings keep their polygons');

    // --- the original FUN_00441270 against the board
    const file = I.archive.find('col/SkBoard.col');
    const bytes = I.archive.read(file);
    const poly = new ColOracle(pe), hdr = new ColOracle(pe);
    const colP = poly.collisionObject(bytes, false), colH = hdr.collisionObject(bytes, true);
    const board = W.records[9];
    for (const r of W.records) if (r && r !== board) r.flags |= 0x10;       // only the board counts in the port's sweeps
    const pep = I.pepper;
    pep.flags |= 0x10;
    board.flags |= 2;
    const rand = rng(12345);
    let both = 0, hits = 0, bad = 0, maxd = 0;
    const base = { name: 'PEPP', m: Array.from(pep.m), flags: 0x12 };
    for (let k = 0; k < 900; k++) {
      // the board at a random place / yaw / pitch, Pepper's sweep like FUN_00490e2e's ground sweep (down 8 from 1.2 above the feet) or a wall sweep (forward 0.75)
      const x = (rand() - 0.5) * 4, y = (rand() - 0.5) * 3, z = (rand() - 0.5) * 4;
      const ry = rand() * Math.PI * 2, rx = (rand() - 0.5) * 0.6;
      board.setEuler(rx, ry, 0, 100 + x, 20 + y, 100 + z);
      const bm = Array.from(board.m);
      const from = [100, 20 + 1.2, 100];
      const kind = k % 3;
      const delta = kind === 0 ? [0, -8, 0] : kind === 1 ? [0.75 * Math.sin(ry), 0, 0.75 * Math.cos(ry)] : [0, 1.2 + rand(), 0];
      const [radius, skin, mask] = kind === 2 ? [1.4, 0.2, 1] : [1.4, 0.2, 3];
      const mine = W.col.sweep(pep, from, delta, mask, f32(radius), f32(skin));
      const rec = { name: 'SBRD', m: bm, flags: 2 };
      poly.records([base, { ...rec, col: colP }]);
      hdr.records([base, { ...rec, col: colH }]);
      const orig = poly.sweep(0, from.map(f32), delta.map(f32), mask, radius, skin);
      const none = hdr.sweep(0, from.map(f32), delta.map(f32), mask, radius, skin);
      if (none) bad++;
      const portHit = !!mine && mine.rec === board;
      if (portHit !== !!orig) { bad++; if (failures.length < 6) failures.push(`placement ${k} (kind ${kind}): port ${portHit ? 'hit' : 'no hit'}, original ${orig ? 'hit' : 'no hit'}`); continue; }
      if (orig) {
        hits++;
        const d = Math.max(...orig.point.map((v, i) => Math.abs(v - mine.point[i])), ...orig.normal.map((v, i) => Math.abs(v - mine.normal[i])));
        maxd = Math.max(maxd, d);
        if (d > 2e-3) { bad++; if (failures.length < 6) failures.push(`placement ${k}: hit differs by ${d.toExponential(2)}`); }
      }
      both++;
    }
    ok(bad === 0, `${both} random sweeps against the board: the port and the original function agree on hit / no hit and on the point and normal (max difference ${maxd.toExponential(2)}, ${hits} hits); the header-only object is never hit (${bad} deviations)`);
    ok(hits > 100, `enough of the sweeps hit the polygons (${hits})`);

    // --- the same through the world: with the header-only objects applied the board is not solid
    const J = loadIsland(ctx, { node: 2 });
    const bj = J.world.records[9], pj = J.pepper;
    ok(bj.colObj.col.count === 0 && !bj.colObj.col.grid, 'applied: the board\'s collision object has no polygons');
    bj.show(); bj.m.set(pj.m);
    const g = J.world.col.terrainHeight(pj.x, pj.y, pj.z, 4);
    pj.y = g; bj.y = g; bj.x = pj.x; bj.z = pj.z;
    const h = J.world.col.sweep(pj, [pj.x, pj.y + 1.2, pj.z], [0, -8, 0], 3, 1.4, 0.2);
    ok(h && h.rec.name !== 'SBRD', `the ground sweep from Pepper's feet no longer sees the board (${h?.rec.name})`);
    notes.push(`S5: ${hits} board hits compared, max difference ${maxd.toExponential(2)}`);
    return { checked, failures, notes };
  },
};
