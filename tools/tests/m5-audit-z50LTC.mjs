// M5 audit z50LTC: the talk start turns Pepper to the person AND tilts him to the ground slope (FUN_0083a292 at 0x83a44a calls FUN_00429e00 = the walk node's alignToGround, right after
// FUN_0043a4a1): the port wires `LtcGlobals.alignPepper` to the walk node of Pepper's chain; the result equals "turn, then alignToGround" done by hand.
import { loadZone } from '../lib/engine-load.mjs';
import { buildLtc } from '../../src/zones/z50LTC.ts';
import { persisted } from '../../src/zones/z50LTC/people.ts';

export default {
  name: 'm5-audit-z50LTC',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    persisted.toggle = 0;
    const L = loadZone(ctx, 'z50LTC');
    const room = buildLtc(L.world, L, L.pe);
    const w = L.world, p = L.pepper;
    const walker = p.ctrl.nodes.find((n) => typeof n.alignToGround === 'function');
    ok(!!walker, 'Pepper keeps the walk node (SGwalk) in the room');
    let aligned = 0;
    room.g.alignPepper = (ww, rec) => { aligned++; walker.alignToGround(ww, rec); };
    const pb = room.people.find((q) => q.entry.name === 'Paul Baker');
    const rec = w.records[pb.entry.record];
    // run until Paul Baker is present (set 0 is shown from the start), stand next to him on his ground
    for (let i = 0; i < 60; i++) w.tick();
    p.x = rec.x; p.z = rec.z + 3; p.y = rec.y + 0.5; p.savePrev();
    for (let i = 0; i < 3; i++) w.tick();
    w.input.setKey('ShiftLeft', true); w.tick(); w.input.setKey('ShiftLeft', false);
    ok(pb.talk === 1, `Shift next to Paul Baker starts the talk (talk ${pb.talk})`);
    ok(aligned === 1, `the slope alignment ran once at the talk start (${aligned})`);
    // by hand: the turn (FUN_0043a4a1: yaw only) then FUN_00429e00 on the same record
    const ang = Math.atan2(rec.x - p.x, rec.z - p.z);
    const ref = { m: Float64Array.from(p.m) };
    p.setEuler(0, p.ry, 0, p.x, p.y, p.z);
    const before = Array.from(p.m);
    walker.alignToGround(w, p);
    const after = Array.from(p.m);
    ok(Math.abs(Math.atan2(rec.x - p.x, rec.z - p.z) - ang) < 2.0, 'Pepper faces the person');
    // the matrix the talk start left equals the by-hand result (position keeps; the rotation rows are the aligned ones)
    let d = 0; for (let i = 0; i < 16; i++) d = Math.max(d, Math.abs(after[i] - ref.m[i]));
    ok(d < 1e-4, `Pepper's matrix after the talk start = turn + alignToGround (max difference ${d})`);
    notes.push(`before align ${before.slice(0, 11).map((x) => x.toFixed(3)).join(' ')}; after ${after.slice(0, 11).map((x) => x.toFixed(3)).join(' ')}`);
    return { checked, failures, notes };
  },
};
