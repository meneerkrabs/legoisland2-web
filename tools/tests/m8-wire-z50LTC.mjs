import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { buildLtc, ltc } from '../../src/zones/z50LTC.ts';
import { LtcFx } from '../../src/zones/z50LTC/fx.ts';
import { persisted } from '../../src/zones/z50LTC/people.ts';

// WP-PART-WIRE z50LTC: per person paul01 x 2 + TWINKLE01.par (FUN_0083a7d2), the twinkle gates (appear / vanish, 3 ticks), Paul Scully's hands (gate, matrices) during his talk.
export default {
  name: 'm8-wire-z50LTC',
  run(ctx) {
    const failures = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    const pe = loadExe(ctx.dataRoot);
    ok(pe.cstr(0x95d9e0) === 'paul01' && pe.cstr(0x95d9e8) === 'paul01' && pe.cstr(0x95d9f0) === 'TWINKLE01.par' && pe.cstr(0x95d960) === 'GENERICBITS', 'names / engine in the executable');
    persisted.toggle = 0;
    const L = loadZone(ctx, 'z50LTC');
    const room = buildLtc(L.world, L, L.pe);
    const calls = [];
    let nh = 0;
    const fake = {
      start: (name, m, pos, rot, gate) => { const h = nh++; calls.push({ op: 'start', h, name, m, pos: [...pos], rot: [...rot], gate: [...gate] }); return h; },
      on: (h) => calls.push({ op: 'on', h }), off: (h) => calls.push({ op: 'off', h }), setMatrix: (h, m) => calls.push({ op: 'setMatrix', h, m }),
      collideWith: (h, r) => calls.push({ op: 'coll', h, r }), finish() {},
    };
    const lf = new LtcFx(fake);
    const recs = L.world.records;
    for (const p of room.people) lf.ctor(recs[p.entry.record], recs[1]);
    lf.bind(room.g);
    const n = room.people.length;
    const st = calls.filter((c) => c.op === 'start');
    ok(st.length === 3 * n, `3 starts per person (${st.length} for ${n})`);
    ok(st.every((s, i) => (i % 3 < 2 ? s.name === 'paul01' && s.rot[0] === Math.fround(Math.PI / 2) && s.pos.join() === '0,0,0' : s.name === 'TWINKLE01.par' && s.pos.join() === '0,2,0' && s.rot.join() === '0,0,0') && s.gate.join() === '1,1,1'), 'start arguments (offsets, rotations, gate off)');
    ok(st.every((s, i) => i % 3 !== 2 || s.m === recs[room.people[(i - 2) / 3].entry.record].m), 'twinkle on the live record matrix');
    ok(calls.filter((c) => c.op === 'coll').length === 2 * n && calls.filter((c) => c.op === 'coll').every((c) => c.r === recs[1]), 'paul01 collision list = record 1');
    calls.length = 0;
    const tick = (k = 1) => { for (let i = 0; i < k; i++) { L.world.tick(); room.pep?.draw(L.world, L.pepper, L.pepper.ctrl); } };
    tick(80);
    const tw = calls.filter((c) => c.op === 'on' || c.op === 'off');
    ok(tw.some((c) => c.op === 'on') && tw.some((c) => c.op === 'off'), 'twinkles go on and off');
    ok(tw.every((c) => c.h % 3 === 2), 'only twinkle sources are switched while nobody talks');
    // Paul Scully (type 1)
    const ps = room.people.find((p) => p.entry.type === 1);
    const psr = recs[ps.entry.record];
    if (!psr.enabled) { room.g.toggle = room.g.toggle ? 0 : 1; tick(40); }
    ok(psr.enabled, 'Paul Scully is present');
    L.pepper.x = psr.x; L.pepper.z = psr.z + 3; L.pepper.y = psr.y + 0.5; L.pepper.savePrev();
    tick(2);
    calls.length = 0;
    L.world.input.setKey('ShiftLeft', true); tick(1); L.world.input.setKey('ShiftLeft', false);
    ok(ps.talk >= 1, `the talk started (${ps.talk})`);
    const idx = room.people.indexOf(ps);
    const h0 = 3 * idx, h1 = 3 * idx + 1;
    const on = calls.filter((c) => c.op === 'on').map((c) => c.h);
    ok(on.includes(h0) && on.includes(h1), 'both hands on at the start of the talk');
    const sm = calls.filter((c) => c.op === 'setMatrix');
    ok(sm.length >= 2 && sm[0].h === h0 && sm[1].h === h1 && sm[0].m !== sm[1].m, 'hand matrices set (bone 14 then 16)');
    calls.length = 0; tick(5);
    ok(calls.filter((c) => c.op === 'setMatrix').length >= 10, 'the matrices are refreshed every tick of the talk');
    calls.length = 0;
    L.world.input.setKey('ShiftLeft', true); tick(1); L.world.input.setKey('ShiftLeft', false);
    const off = calls.filter((c) => c.op === 'off').map((c) => c.h);
    ok(ps.talk === 0 && off.includes(h0) && off.includes(h1), 'both hands off when the talk ends');
    void ltc;
    return { checked, failures, notes: [`${n} people, ${st.length} sources`] };
  },
};
