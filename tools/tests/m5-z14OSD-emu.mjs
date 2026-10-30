// M5 z14OSD (the Oasis), ORACLE test: the original's node framework and the Oasis' node code run natively in the x86 interpreter (tools/lib/m5-z14OSD-duel.mjs) next to the port's nodes
// (src/zones/z14OSD/*) with the same scripted inputs (Pepper's place, buttons, game variables, the random integers, a scripted ground), compared tick by tick: Tumblewd (all states, sounds incl. the
// "TUM01" pattern, destroy), scorpion + the grab node (sight, attack, grab, return home; node fields, animation, sounds, the probe arming, the framework's controller words), Gems (pick-up, countdown,
// score, collected-before), PEPPSW (walk / swim / skateboard, the music level), the HUD function FUN_00628410. Collision answers are the port's CollisionWorld or a scripted ground, the SAME on both
// sides (collision is not the subject). The comparison is bit-exact except where a case says otherwise (framework `distSq`: a tolerance, see the notes).
import { OsdDuel, B, stream } from '../lib/m5-z14OSD-duel.mjs';
import { withCdAlloc } from '../lib/m8-save-hubs.mjs';

const TUM = [104, 105, 106, 107, 108, 109, 111], SCR = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17], GEM = [114, 115, 116, 117, 118, 119, 120, 121, 122, 123], PEP = 4, BOARD = 64;
const MAXFAIL = 25;

const inner = {
  name: 'm5-z14OSD-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = {};
    const bump = (k, n = 1) => { cover[k] = (cover[k] ?? 0) + n; };
    const make = (label, o = {}) => { const d = new OsdDuel(ctx, { failures, label, maxFail: MAXFAIL, ...o }); return d; };
    const done = (d) => {
      checked += d.checked;
      const w = [...d.worst].filter(([k, v]) => v > 0 && !/distSq/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (w.length) notes.push(`${d.label}: largest deviations ${w.map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ')}`);
      for (const [a, n] of d.emu.unhooked) bump(`unhooked 0x${a.toString(16)}`, n);
    };
    /** the framework words every scenario compares: ran masks, squared distances (the port's framework computes them in doubles: 1e-6 relative), variables, sounds, probes */
    const common = (d, o = {}) => {
      d.compareControllers({ tolDist: 1e-6, pepperBits: !!o.pepperBits });
      d.compareVars();
      d.compareSounds({ dedupeStops: !!o.dedupeStops });
      d.compareProbes({ results: true });
    };

    // ============================================================================================================================ Tumblewd
    const tumCompare = (d) => {
      common(d);
      const m = d.emu.cpu.mem;
      for (const i of TUM) {
        d.compareRecord(i, { rotAbs: 1.3e-7 });   // rotation elements: the shared matrix builder (src/formats/matrix.ts) vs the original's x87 FUN_0043a4a1: up to 1 float32 ulp apart (sin / cos rounding order)
        const a = d.onode(i, 'TUM'), n = d.pnode(i, 'TUM');
        d.cmp('vy (+0x20)', m.f32(a + 0x20), n.vy); d.cmp('yNow (+0x24)', m.f32(a + 0x24), n.yNow); d.cmp('timer (+0x28)', m.f32(a + 0x28), n.timer);
        d.eq('state (+0x2c)', m.r32(a + 0x2c), n.state); d.cmp('spin (+0x30)', m.f32(a + 0x30), n.spin);
        for (let k = 0; k < 3; k++) d.cmp('home (+0x14)', m.f32(a + 0x14 + 4 * k), n.home[k], 0, `[${k}]`);
        bump(`tum state ${n.state}`);
      }
    };
    const bumpy = (x, z) => ((Math.floor(x / 40) + Math.floor(z / 40)) % 5 === 0 ? null : 20 + 6 * Math.sin(x / 17) + 4 * Math.cos(z / 13));
    const tumCases = [
      ['real collision', 1, null, 600], ['no ground (fall, sink, 120-tick rest, reset)', 1, () => null, 800], ['bumpy ground with holes', 1, bumpy, 1500], ['bumpy ground dt 0.5', 0.5, bumpy, 2200],
      ['half-plane ground dt 0.5', 0.5, (x) => (Math.floor(x / 25) & 1 ? null : 40), 1200], ['NPC rule: sweep hits a flag-0x40 record below the terrain sample', 1, 'npc', 700],
    ];
    for (const [label, dt, scr, ticks] of tumCases) {
      const d = make(`tum ${label}`, { kinds: ['TUM'], dt, seed: 11 });
      if (scr === 'npc') { for (const w of [d.P.world, d.O.world]) w.records[8].flags |= 0x40; d.setFlags(8, d.rec(8).flags); d.script((x, z) => 35 + 3 * Math.sin(x / 9 + z / 7), 8, (x) => (x > 0 ? 40 : null)); }
      else if (scr) d.script(scr);
      for (const i of TUM) d.setFlags(i, d.rec(i).flags | 1);       // in view: the sounds play
      tumCompare(d);
      for (let t = 0; t < ticks; t++) { d.tick(0); tumCompare(d); }
      // destroy handlers: TUM0 stops two handles (the "TUM01" pattern), TUM1 none
      for (const i of TUM) { d.destroyNode(i, 'TUM'); d.compareSounds(); }
      done(d);
    }

    // ============================================================================================================================ scorpions + the grab node
    const scrCompare = (d) => {
      common(d, { pepperBits: true });
      d.compareAnims([...SCR, PEP]);
      const m = d.emu.cpu.mem;
      for (const i of SCR) {
        d.compareRecord(i);
        const a = d.onode(i, 'SCR'), n = d.pnode(i, 'SCR');
        d.cmp('timer (+0x20)', m.f32(a + 0x20), n.timer); d.eq('state (+0x24)', m.r32(a + 0x24), n.state); d.cmp('heading (+0x28)', m.f32(a + 0x28), n.heading);
        for (let k = 0; k < 3; k++) d.cmp('home (+0x14)', m.f32(a + 0x14 + 4 * k), n.home[k], 0, `[${k}]`);
        bump(`scorpion state 0x${n.state.toString(16)}`);
      }
      d.compareRecord(PEP);
      d.eq('var 0x5e grab bit', d.emu.cpu.mem.r32(0x8a2d2c + 4 * 0x5e) & 0x20, d.getVar(0x5e) & 0x20);
    };
    for (const [label, dt, seed, ticks, flat] of [['dt 1 seed 1', 1, 1, 1800, true], ['dt 1 seed 2', 1, 2, 1800, false], ['dt 0.5', 0.5, 3, 2400, true]]) {
      const d = make(`scorpion ${label}`, { kinds: ['SCR', 'GRAB'], dt, seed });
      d.script(flat ? () => 10 : (x, z) => 10 + 2 * Math.sin(x / 5) + Math.cos(z / 4));
      for (const i of SCR) d.setFlags(i, d.rec(i).flags | 1);
      scrCompare(d);
      const rnd = stream(900 + seed);
      let grabbed = 0;
      for (let t = 0; t < ticks; t++) {
        // Pepper: placed at a random spot around a random scorpion every 12..40 ticks (out of sight, behind, in front, 1..10 units); sometimes a scorpion is moved far from its home
        if (t % 12 === 0 && rnd() < 0.6) {
          const s = d.rec(SCR[Math.floor(rnd() * SCR.length)]);
          const r = rnd() < 0.5 ? 1 + rnd() * 3 : rnd() < 0.5 ? 3 + rnd() * 7 : 10 + rnd() * 30, ang = rnd() * 6.2831853;
          d.place(PEP, s.x + Math.sin(ang) * r, s.y + 0.3, s.z + Math.cos(ang) * r, rnd() * 6 - 3);
        }
        if (t % 150 === 149) { const s = d.rec(SCR[Math.floor(rnd() * SCR.length)]); d.place(s.index, s.x + (rnd() - 0.5) * 70, s.y, s.z + (rnd() - 0.5) * 70, s.ry, s.rx, s.rz); }
        d.tick(0);
        scrCompare(d);
        if (d.getVar(0x5e) & 0x20) grabbed++;
      }
      bump('scorpion grab ticks', grabbed);
      done(d);
    }
    // a scripted attack: Pepper stands 1.5 units in front of a scorpion that has just seen her; the grab node plays clip 0x70 until it ends and clears bit 0x20
    {
      const d = make('scorpion attack', { kinds: ['SCR', 'GRAB'], seed: 5 });
      d.script(() => 10);
      for (const i of SCR) d.setFlags(i, d.rec(i).flags | 1);
      const s = d.rec(8);
      d.place(8, s.x, s.y, s.z, 0);
      d.place(PEP, s.x, s.y, s.z + 5, 0);
      for (let t = 0; t < 320; t++) {
        d.tick(0); scrCompare(d);
        const n = d.pnode(8, 'SCR');
        if (n.state === 0x10 && t > 2) { const e = d.rec(8); d.place(PEP, e.x - Math.sin(e.ry) * 1.4, e.y, e.z - Math.cos(e.ry) * 1.4, 0); }
      }
      done(d);
    }

    // ============================================================================================================================ Gems
    const gemCompare = (d) => {
      common(d);
      const m = d.emu.cpu.mem;
      for (const i of GEM) { d.compareRecord(i); d.eq('state (+0x1c)', m.r32(d.onode(i, 'GEM') + 0x1c), d.pnode(i, 'GEM').state); }
      d.compareRecord(PEP);
    };
    for (const [label, vars, dt] of [['nothing collected', {}, 1], ['gems 0, 2, 9 collected before', { 0x1d: 0x205 }, 1], ['dt 0.5', {}, 0.5]]) {
      const d = make(`gems ${label}`, { kinds: ['GEM'], vars, dt, seed: 4 });
      d.setFlags(114, d.rec(114).flags);                      // (in sync)
      gemCompare(d);
      for (const i of GEM) bump(`gem hidden at start`, (d.rec(i).flags & 2) === 0 ? 1 : 0);
      // Pepper visits every gem at distances around the pick-up radius (2.0: the squared XZ distance < 4.0), never inside the gem's squared radius twice
      for (const i of GEM) {
        const g = d.rec(i);
        for (const r of [3, 2.0001, 2.0, 1.9999, 1.5]) {
          d.place(PEP, g.x + r, g.y, g.z, 0);
          for (let t = 0; t < 2; t++) { d.tick(0); gemCompare(d); }
          if (d.pnode(i, 'GEM').state !== 0 && d.pnode(i, 'GEM').state !== 1) bump('gem picked up');
        }
        d.place(PEP, g.x + 100, g.y, g.z, 0);
        for (let t = 0; t < 6; t++) { d.tick(0); gemCompare(d); }
      }
      bump('gem score var 0x17', d.getVar(0x17)); bump('gem total var 0xca', d.getVar(0xca));
      done(d);
    }

    // ============================================================================================================================ PEPPSW
    const swCompare = (d) => {
      common(d, { dedupeStops: true });
      d.compareAnims([PEP, BOARD]);
      const m = d.emu.cpu.mem;
      d.compareRecord(PEP); d.compareRecord(BOARD);
      d.eq('mailbox (DAT_008ae088)', m.r8(0x8ae088), d.W.pep.mailbox);
      const a = d.onode(PEP, 'SW'), n = d.pnode(PEP, 'SW');
      d.eq('music level (+0x18)', m.r32(a + 0x18), n.level); d.eq('music level sent (+0x1c)', m.r32(a + 0x1c), n.sent);
    };
    for (const [label, dt, seed, sea, ticks] of [['sea 0 (the Oasis)', 1, 21, 0, 2500], ['sea 5 dt 1', 1, 22, 5, 2500], ['sea 5 dt 0.5', 0.5, 23, 5, 3500]]) {
      const d = make(`peppsw ${label}`, { kinds: ['SW'], dt, seed });
      d.setSea(sea);
      // a scripted ground with water: the ground sample FUN_0043cd62 answers 2 (under the sea) west of x = 0 and 12 east of it; around z = 50 a beach shelf at 6
      d.script((x, z) => (x < 0 ? 2 : Math.abs(z - 50) < 20 ? 6 : 12));
      d.setFlags(BOARD, d.rec(BOARD).flags & ~2);
      swCompare(d);
      const rnd = stream(31 + seed);
      const modes = [1, 1, 1, 2, 4], states = [27, 1, 2, 0x57, 0x1f, 0x20, 0x21, 0x32, 5], clips = [27, 99, 0x62, 0x24, 0x3f, 0x40, 0x25, 1, 3];
      let held = 0;
      for (let t = 0; t < ticks; t++) {
        if (t % 5 === 0 && rnd() < 0.5) {
          const mode = modes[Math.floor(rnd() * modes.length)] | (rnd() < 0.3 ? 0x1000 : 0);
          d.setVar(0x5e, mode);
          d.setMailbox(states[Math.floor(rnd() * states.length)]);
          d.setClip(PEP, clips[Math.floor(rnd() * clips.length)], 0);
          const px = (rnd() - 0.5) * 80, pz = 20 + rnd() * 70, hy = rnd() < 0.5 ? sea - 1 + rnd() * 2 : sea + 2 + rnd() * 6;
          const ry = rnd() * 6.2 - 3.1;
          d.place(PEP, px, hy, pz, ry);
          held = rnd() < 0.4 ? B.CTRL : rnd() < 0.2 ? B.UP : 0;
        }
        d.tick(held);
        swCompare(d);
        bump(`peppsw mode ${d.getVar(0x5e) & 0xfff}`);
        if (d.W.records[BOARD].flags & 2) bump('peppsw board shown');
        bump(`peppsw level ${d.pnode(PEP, 'SW').level}`);
        if (held & B.CTRL) { held = rnd() < 0.5 ? 0 : held; }
      }
      if (d.dupStops) bump('peppsw duplicate stop of sound 0x185 (original stops two handles)', d.dupStops);
      done(d);
    }

    // ============================================================================================================================ HUD
    for (const [label, dt] of [['dt 1', 1], ['dt 0.5', 0.5]]) {
      const d = make(`hud ${label}`, { kinds: [], hud: true, dt, seed: 9 });
      const rnd = stream(77), ICON = [0, 0x20, 1, 2, 4, 8, 0x10, 0x1e, 0x40, 0x80, 0xc0, 0x21, 0x41, 0x60, 0xe0];
      const cmpHud = () => {
        const o = d.emu.hud(), h = d.hud;
        d.eq('score text', o.centre, h.centreText); d.eq('items text', o.left, h.leftText); d.eq('icon slot 0', o.icon, h.column[0].tex);
        d.cmp('blink counter', o.blink, d.hudState.blink);
        common(d);
        bump(`hud icon ${o.icon}`);
      };
      d.tick(0); cmpHud();                                    // (the first frame settles the icon slot: the original's data starts at 0, initOsdHud at -1; var 0xc is 0 in the first frame of the game)
      for (let t = 0; t < 1500; t++) {
        if (rnd() < 0.2) d.setVar(0x5e, [1, 2, 4, 0x20, 0x21, 0][Math.floor(rnd() * 6)]);
        if (rnd() < 0.08) d.setVar(0x17, [0, 1000, 12000, 99999, 123456, -5, -1000][Math.floor(rnd() * 7)]);
        if (rnd() < 0.1) d.setVar(0x1d, Math.floor(rnd() * 4096) | (rnd() < 0.2 ? 0x7fffff00 : 0));
        // the nodes set their bit of var 0xc every frame, for a while (the blink needs a run of frames with the same bit)
        const hold = Math.floor(rnd() * 40);
        const ic = ICON[Math.floor(rnd() * ICON.length)];
        for (let k = 0; k < hold && t < 1500; k++, t++) { d.setVar(0xc, ic); d.tick(0); cmpHud(); }
      }
      done(d);
    }

    for (const [k, v] of Object.entries(cover)) notes.push(`coverage ${k}: ${v}`);
    return { checked, failures, notes };
  },
};

// the original's node memory is the debug heap's (0xCD-filled fresh blocks; only the node sizes here, the controllers' own uninitialised words are not modelled by this test): the words a constructor never writes (the Tumblewd's +0x24, the scorpion's +0x28) are compared with the port's initial values
export default { name: inner.name, run: (ctx) => withCdAlloc(() => inner.run(ctx), [0x34, 0x2c, 0x1c, 0x20, 0x38]) };
