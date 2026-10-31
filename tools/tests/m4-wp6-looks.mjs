import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { looksOf, ROSTER_VA, SWAP_VA, readLookGroup, nextLook, lookWord, nearestLookRecord, VehicleLooks, changeLookWith, tickLooksWith } from '../../src/island/vehicles/looks.ts';
import { islandBrickFx, setBrickRandom } from '../../src/fx/bricks/index.ts';
import { createGameCpu } from '../../src/formats/x86emu.ts';

// M4 WP6 / gaps S2: the vehicles' "change the look" (Enter): FUN_0051db5c / FUN_00420404 / FUN_00420590 / FUN_004202ef, the cycler FUN_00443b00 / FUN_004439f0 and the roster 0x8e9b28 / swap table 0x8b5028
// of the executable. Run: node tools/test-formats.mjs --only m4-wp6-looks -v

export default {
  name: 'm4-wp6-looks',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let seed = 99;
    setBrickRandom(() => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; });
    const archive = ctx.archives.find((a) => a.name.toLowerCase() === 'z02lgi');
    waypoints.load(archive);

    const I = loadIsland(ctx, { node: 2, bricks: true });
    const W = I.world, P = I.pepper, pe = I.pe;
    // ---------------------------------------------------------------- the tables of the executable
    const sets = [[0, 7], [8, 11], [20, 7], [28, 10], [39, 6], [46, 8], [55, 9], [65, 7]];
    for (const [s, n] of sets) ok(readLookGroup(pe, s).length === n, `swap set ${s}: ${n} looks (${readLookGroup(pe, s).length})`);
    const g0 = readLookGroup(pe, 0);
    ok(g0[0].parts.every((p) => p.list === null) && g0[0].parts.map((p) => p.n).join() === '25,18,10', 'look 0 of the ambulance set keeps the model\'s own textures (n 25 / 18 / 10)');
    ok(g0[1].parts[0].list.join() === '12,1,2,3,13,5,6,0,8,9,12,10,3,12,10,3,12,10,3,12,10,3,12,1,2', 'ambulance look 1, LOD 0: SwapText 12,1,2,3,13,5,6,0,8,9,12,10,3,...');
    ok(pe.u32(SWAP_VA + 7 * 24) === 0, 'the record after the 7 ambulance looks ends the group (nParts 0)');

    // the cycler FUN_00443b00 (variants 0: the next look at every step, wrapping to 0)
    const cyc = { looks: g0, part: 0, variant: 0 };
    const seen = [];
    for (let i = 0; i < 8; i++) { nextLook(cyc); seen.push(lookWord(cyc)); }
    ok(seen.join() === '1,2,3,4,5,6,0,1', `cycler: 1,2,3,4,5,6,0,1 (${seen})`);

    // every swap texture a look names exists in the SwapText bank (text000 .. text143.tga) and every look's tables are as long as the part's own group list
    {
      const sw = ctx.archives.find((a) => a.name.toLowerCase() === 'swaptext');
      let bad = 0, n = 0, maxv = 0;
      for (const [set] of [[0], [8], [20], [28], [39], [46], [55], [65]]) for (const lk of readLookGroup(pe, set)) for (const part of lk.parts) {
        if (!part.list) continue;
        for (const v of part.list) { n++; maxv = Math.max(maxv, v); if (!sw?.find(`text${String(v).padStart(3, '0')}.tga`)) bad++; }
        if (part.list.length !== part.n) bad++;
      }
      ok(sw && bad === 0, `${n} swap texture references (max index ${maxv}) all exist in SwapText, each list as long as its part (${bad} bad)`);
    }

    // the cycler against the ORIGINAL FUN_00443b00 (+ FUN_004439f0, FUN_0043eb70) run in the x86 interpreter on the executable's own swap table: 40 steps per set
    {
      const cpu = createGameCpu(pe), mem = cpu.mem;
      const HEAP = 0x20000000; mem.addRegion({ lo: HEAP, hi: HEAP + 0x40000, name: 'heap' });
      cpu.exec = [[0x4439c0, 0x443b70], [0x43eb70, 0x43eb90]];
      cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
      cpu.hooks.set(0x85abc0, () => {});
      mem.w32(0x9e06ec, 1);                       // DAT_009e06ec: the swap-texture system is up
      let steps = 0, bad = 0;
      for (const [set, n] of [[0, 7], [8, 11], [20, 7], [28, 10], [39, 6], [46, 8], [55, 9], [65, 7]]) {
        const model = HEAP + set * 0x400, parts = model + 0x100;
        mem.w32(model + 0x10, parts);
        const cyc = model + 0x200;
        mem.w32(cyc, n); mem.w32(cyc + 4, 0x8b5028 + set * 24); mem.w32(cyc + 8, model); mem.w32(cyc + 12, 0); mem.w32(cyc + 16, 0);
        const mine = { looks: readLookGroup(pe, set), part: 0, variant: 0 };
        for (let k = 0; k < 40; k++) {
          cpu.call(0x443b00, [cyc]);
          nextLook(mine);
          steps++;
          if (mem.u32(cyc + 12) !== mine.part || mem.u32(cyc + 16) !== mine.variant) bad++;
        }
      }
      ok(bad === 0, `the cycler: ${steps} steps over the 8 sets give the same (part, variant) as the original FUN_00443b00 (${bad} differences)`);
    }

    // FUN_00420404 + FUN_00420590 (the Enter and the per-tick release) against the original run in the interpreter: 10 roster records, the busy list DAT_009da590, record flags,
    // the game variables written (FUN_00417597), for a script of Enters / brick-effect states
    {
      const cpu = createGameCpu(pe), mem = cpu.mem;
      const HEAP = 0x20000000, RB = 0x10000000;
      mem.addRegion({ lo: HEAP, hi: HEAP + 0x80000, name: 'heap' });
      mem.addRegion({ lo: RB, hi: RB + 0x10000, name: 'records' });
      cpu.exec = [[0x420404, 0x420622], [0x4439c0, 0x443b70], [0x43eb70, 0x43eb90]];
      cpu.fallback = (a) => { throw new Error('call to 0x' + a.toString(16)); };
      cpu.hooks.set(0x85abc0, () => {});
      const vars = new Map(), played = [];
      const brickState = new Map();     // handle -> FUN_00447e60's answer
      cpu.hooks.set(0x417597, (c) => { vars.set(c.arg(0), c.arg(1) | 0); });
      cpu.hooks.set(0x4435a0, (c) => { played.push(c.arg(0)); });
      cpu.hooks.set(0x447e60, (c) => { c.eax = brickState.get(c.arg(0)) ?? 2; });
      mem.w32(0x9e06ec, 1); mem.w32(0x983804, RB); mem.w32(0x983800, 400);
      mem.w32(0x9da5b0, 7);               // the sound handle DAT_009da5b0
      for (let i = 0; i < 8; i++) mem.w32(0x9da590 + 4 * i, 0xffffffff);
      // the roster as FUN_004202ef leaves it: record pointer (+4), cycler handle (+8), brick effect handle (+0x14)
      const N = 10, cyclers = [];
      for (let c = 0; c < N; c++) {
        const e = ROSTER_VA + c * 0x18, rec = mem.u32(e), set = mem.u32(e + 12);
        const model = HEAP + c * 0x400; mem.w32(model + 0x10, model + 0x100);
        const cyc = model + 0x200; const n = readLookGroup(pe, set).length;
        mem.w32(cyc, n); mem.w32(cyc + 4, 0x8b5028 + set * 24); mem.w32(cyc + 8, model); mem.w32(cyc + 12, 0); mem.w32(cyc + 16, 0);
        mem.w32(e + 4, RB + rec * 0x68); mem.w32(e + 8, cyc); mem.w32(e + 0x14, 100 + c);
        mem.w16(RB + rec * 0x68 + 0x60, 2); mem.w32(RB + rec * 0x68 + 0x64, 2);
        cyclers.push(cyc);
      }
      // the port side: the same roster, brick states from the same table
      const W2 = { vars: new Map(), recs: new Map() };
      const fakeRec = (idx) => { let r = W2.recs.get(idx); if (!r) { r = { index: idx, flags: 2 }; W2.recs.set(idx, r); } return r; };
      const looks = Object.assign(Object.create(VehicleLooks.prototype), { entries: [], busy: new Array(8).fill(-1) });
      for (let c = 0; c < N; c++) { const e = ROSTER_VA + c * 0x18, set = pe.u32(e + 12); looks.entries.push({ rec: pe.u32(e), set, varIdx: pe.u32(e + 0x10) | 0, looks: readLookGroup(pe, set), part: 0, variant: 0, slot: 100 + c }); fakeRec(pe.u32(e)); }
      const script = [];
      let seed = 7; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
      for (let k = 0; k < 300; k++) script.push([rnd(10), rnd(4)]);   // [entry, what]: 0 Enter, 1 Enter, 2 brick effect becomes idle, 3 the record gets 0x8000 (a crash) or loses it
      let mism = 0, enters = 0, changed = 0, released = 0, refused = 0;
      for (const [c, what] of script) {
        const recIdx = pe.u32(ROSTER_VA + c * 0x18);
        if (what <= 1) {
          enters++;
          cpu.call(0x420404, [ROSTER_VA, RB + recIdx * 0x68]);
          // port
          const r = fakeRec(recIdx);
          const before = looks.busy.filter((b) => b >= 0).length, fl = r.flags;
          changeLookWith(looks, r, () => {}, (i, v) => { W2.vars.set(i, v); changed++; });
          if (looks.busy.filter((b) => b >= 0).length === before && (fl & 0x8000)) refused++;
        } else if (what === 2) {
          for (let k = 0; k < N; k++) brickState.set(100 + k, 2);
          cpu.call(0x420590, [ROSTER_VA]);
          released += looks.busy.filter((b) => b >= 0).length;
          tickLooksWith(looks, (i) => fakeRec(i), (slot) => brickState.get(slot) ?? 2);
          for (let k = 0; k < N; k++) brickState.delete(100 + k);
        } else {
          const f = mem.r16(RB + recIdx * 0x68 + 0x60) ^ 0x8000;
          mem.w16(RB + recIdx * 0x68 + 0x60, f); fakeRec(recIdx).flags ^= 0x8000;
          brickState.set(100 + c, 3);       // not idle while a morph runs
          if (!(fakeRec(recIdx).flags & 0x8000)) brickState.delete(100 + c);
        }
        // compare
        for (let k = 0; k < 8; k++) if (mem.r32(0x9da590 + 4 * k) !== looks.busy[k]) mism++;
        for (let k = 0; k < N; k++) {
          const e = ROSTER_VA + k * 0x18, rid = pe.u32(e);
          if (mem.r16(RB + rid * 0x68 + 0x60) !== fakeRec(rid).flags) mism++;
          if (mem.u32(cyclers[k] + 12) !== looks.entries[k].part || mem.u32(cyclers[k] + 16) !== looks.entries[k].variant) mism++;
        }
        for (const [v, val] of vars) if ((W2.vars.get(v) ?? 0) !== val) mism++;
      }
      notes.push(`look script: ${enters} Enters, ${changed} look changes, ${refused} refused by 0x8000, busy slots seen at releases ${released}`);
      ok(mism === 0 && changed > 50, `${enters} Enters / releases / crashes over the 10 roster entries: flags, busy list, cycler state and game variables identical to the original FUN_00420404 / FUN_00420590 (${mism} differences)`);
    }

    // ---------------------------------------------------------------- the roster in the world
    tick(I, 2);
    const L = looksOf(W);
    ok(!!L && L.entries.length === 10, `roster of 10 vehicles (${L?.entries.length})`);
    const byName = (n) => L.entries.find((e) => W.records[e.rec]?.name === n);
    const names = L.entries.map((e) => W.records[e.rec]?.name).join();
    ok(names === 'AMBU,DNGY,JSKI,SPBT,RHEL,PHEL,SPD0,SPD1,SPD2,PCAR', `roster records ${names}`);
    ok(byName('AMBU').set === 0 && byName('AMBU').varIdx === 0xb1 && byName('DNGY').set === 8 && byName('DNGY').varIdx === 0xd7 && byName('PCAR').set === 65 && byName('PCAR').varIdx === 0x99, 'entries: AMBU set 0 var 0xb1, DNGY set 8 var 0xd7, PCAR set 65 var 0x99');
    ok(L.entries.every((e) => e.slot >= 0), 'every entry has its brick effect slot');
    ok(L.entries.every((e) => W.records[e.rec].variant === 2), 'roster records carry the variant word 2');
    ok(W.records[byName('AMBU').rec] && L.textures(W.records[byName('AMBU').rec], 0) === null, 'look 0: no texture swap');

    // ---------------------------------------------------------------- Enter next to the dinghy (11 looks, var 0xd7)
    const din = I.rec('DNGY'), fx = islandBrickFx(W);
    const gD = readLookGroup(pe, 8);
    P.x = din.x + 3; P.y = din.y; P.z = din.z;
    ok(nearestLookRecord(W, P) === din.index, `the nearest record with a variant word is the dinghy (${nearestLookRecord(W, P)} / ${din.index})`);
    const snd0 = I.ictx.sounds.length;
    press(I, 'Enter');
    ok(I.ictx.sounds.slice(snd0).some((s) => s.id === 0x2c0), 'Enter plays sound 0x2c0');
    ok(W.vars.get(0xd7) === 1, `the look variable 0xd7 = 1 (${W.vars.get(0xd7)})`);
    ok(L.textures(din, 0)?.join() === gD[1].parts[0].list.join() && L.textures(din, 2)?.join() === gD[1].parts[2].list.join(), 'the record\'s texture tables are look 1\'s (LOD 0 and 2)');
    ok(gD[1].parts[0].list.join() === '9,24,0,16,9', 'dinghy look 1, LOD 0: SwapText 9,24,0,16,9');
    ok((din.flags & 0x8000) !== 0 && (din.flags & 0x20) !== 0, `the record is flagged 0x8020 while the bricks morph (${din.flags.toString(16)})`);
    ok(L.busy.includes(L.entries.indexOf(byName('DNGY'))), 'the entry took a busy slot');
    // Enter during the morph does nothing (flag 0x8000 / busy entry)
    const v = W.vars.get(0xd7);
    const snd1 = I.ictx.sounds.length;
    press(I, 'Enter');
    ok(W.vars.get(0xd7) === v && I.ictx.sounds.slice(snd1).some((s) => s.id === 0x2c0), 'Enter while the record has 0x8000: the sound plays, the look stays');
    let done = -1;
    for (let i = 0; i < 2000; i++) { tick(I, 1); if ((din.flags & 0x8000) === 0) { done = i; break; } }
    ok(done > 0, `the morph finished (${done} ticks), the record flag 0x8000 is clear again`);
    tick(I, 1);
    ok(L.busy.every((b) => b === -1) && (din.flags & 0x20) === 0 && (din.flags & 0x8000) === 0, `the busy slot is free, flags 0x8020 cleared (${din.flags.toString(16)})`);
    // wraps after the 11th look
    for (let k = 0; k < 10; k++) { press(I, 'Enter'); for (let i = 0; i < 2000 && (din.flags & 0x8000) !== 0; i++) tick(I, 1); }
    ok(W.vars.get(0xd7) === 0 && L.textures(din, 0) === null, `after 11 looks the original paint is back (var ${W.vars.get(0xd7)})`);

    // ---------------------------------------------------------------- out of range
    P.x = din.x + 40; P.z = din.z + 40;
    const before = W.vars.get(0xd7);
    press(I, 'Enter');
    ok(W.vars.get(0xd7) === before, 'farther than sqrt(800) (28.3): nothing happens');
    // the nearest wins: Pepper between the dinghy and the jet ski stands next to the jet ski
    const ski = I.rec('JSKI');
    P.x = (din.x + ski.x) / 2 + (ski.x - din.x) * 0.1; P.y = din.y; P.z = (din.z + ski.z) / 2 + (ski.z - din.z) * 0.1;
    const dDin = Math.hypot(P.x - din.x, P.z - din.z), dSki = Math.hypot(P.x - ski.x, P.z - ski.z);
    ok(dDin > 28.3 || nearestLookRecord(W, P) === (dSki < dDin ? ski.index : din.index) || dSki > 28.3, 'the nearer of two vehicles is chosen');
    notes.push(`morph ${done} ticks`);
    return { checked, failures, notes };
  },
};
