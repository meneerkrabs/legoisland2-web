// M5 z07CSI, the ORACLE test of the castle's goblets (FUN_005766fb / FUN_0057652f) and rats (FUN_005763ca / FUN_00575e70): the original's nodes run natively in the x86 interpreter
// (tools/lib/m5-z07CSI-emu.mjs) next to the port's nodes with the same random numbers (the C runtime's rand() is one scripted LCG for both; FUN_004388ae's own x87 code runs natively), compared
// tick by tick: records (matrix, Euler angles, flags), the nodes' fields, the animation clips and frames, game variables, every sound and emitter call.
import { makeCsiDuel, onodeOf, NATIVE_CTORS, B } from '../lib/m5-z07CSI-emu.mjs';
import { guarded } from '../lib/inject-guard.mjs';

const MAXFAIL = 30;
const RATS = Array.from({ length: 10 }, (_, k) => 57 + k);       // RAT0..RAT9 (node 15 .. 29)
const GOBLETS = Array.from({ length: 10 }, (_, k) => 184 + k);   // GOB0..GOB9

const __test = {
  name: 'm5-z07CSI-pickups',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { ticks: 0, sessions: 0, modes: new Set(), picked: 0, displaced: 0, homing: 0 };

    // ---- 1. the rats: 1500 ticks of the whole stage with both time steps, several seeds
    for (const [dt, seed] of [[1, 12345], [1, 777], [0.5, 4242]]) {
      const d = makeCsiDuel(ctx, { node: 15, seed, dt, failures, maxFail: MAXFAIL, kinds: [NATIVE_CTORS.RAT, NATIVE_CTORS.GOBLET], keepKinds: ['Rat', 'Goblet'] });
      d.label = `rats dt${dt} seed${seed}`; cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem;
      const scale = dt === 1 ? 1 : 2;
      const compare = () => {
        for (const i of RATS) {
          d.rec(i, 0xffff);
          const pn = W.records[i].ctrl.nodes.find((n) => n.kind === 'Rat'), a = onodeOf(d, i, NATIVE_CTORS.RAT);
          if (!pn || !a) { d.fail(`${d.label} t${d.t} rat ${i}: node missing (port ${!!pn}, original ${!!a})`); continue; }
          d.eq(`rat${i} mode`, mem.r32(a + 0x24), pn.mode);
          d.eq(`rat${i} loops`, mem.r32(a + 0x2c) | 0, pn.loops);
          d.cmp(`rat${i} keep`, mem.f32(a + 0x20), pn.keep);
          d.cmp(`rat${i} timer`, mem.f32(a + 0x28), pn.timer);
          d.cmp(`rat${i} turn`, mem.f32(a + 0x30), pn.turn);
          for (let k = 0; k < 3; k++) d.cmp(`rat${i} home`, mem.f32(a + 0x14 + 4 * k), pn.home[k], 0, `[${k}]`);
          const an = d.O.world.records[i].anim, pa = W.records[i].anim;
          if (an && pa) { d.eq(`rat${i} clip`, an.clip, pa.clip); d.cmp(`rat${i} frame`, an.frame, pa.frame); }
          cover.modes.add(pn.mode);
        }
        d.vars();
        if (d.olog) d.sounds();
      };
      compare();
      for (let t = 0; t < 1500 * scale; t++) {
        // every 300 ticks a rat is carried 40 units away from its home in both worlds: the "head for home" branch (squared distance over 256)
        if (t > 0 && t % (300 * scale) === 0) {
          const i = RATS[(t / (300 * scale)) % RATS.length];
          for (const w of [W, d.O.world]) { const r = w.records[i]; r.m[12] += 40; r.m[14] -= 25; }
          d.emu.putRecord(i, d.O.world.records[i]); d.emu.sync();
          cover.displaced++;
        }
        d.tick(0); cover.ticks++; compare();
        for (const i of RATS) if (W.records[i].ctrl.nodes[0].keep < 0) cover.homing++;
      }
      checked += d.checked;
      notes.push(`${d.label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
    }

    // ---- 2. the goblets: Pepper stands on each one in turn (both worlds): score, the bit of var 0xbc, the shared TWINKLE01 emitter, the pick-up sound
    for (const dt of [1, 0.5]) {
      const d = makeCsiDuel(ctx, { node: 15, seed: 99, dt, failures, maxFail: MAXFAIL, kinds: [NATIVE_CTORS.GOBLET], keepKinds: ['Goblet'] });
      d.label = `goblets dt${dt}`; cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem, scale = dt === 1 ? 1 : 2;
      // the port's shared emitter: the first goblet's constructor (the zone game does this in `onCreate`)
      const first = GOBLETS.find((i) => W.records[i].ctrl?.nodes.some((n) => n.kind === 'Goblet'));
      W.records[first].ctrl.nodes.find((n) => n.kind === 'Goblet').startEmitter(d.P.fx, W.records[first]);
      const compare = () => {
        for (const i of GOBLETS) {
          d.rec(i, 0xffff);
          const pn = W.records[i].ctrl?.nodes.find((n) => n.kind === 'Goblet'), a = onodeOf(d, i, NATIVE_CTORS.GOBLET);
          if (pn && a) d.eq(`goblet${i} state`, mem.r32(a + 0x18) | 0, pn.state);
          else if (!!pn !== !!a) d.fail(`${d.label} t${d.t} goblet ${i}: node missing (port ${!!pn}, original ${!!a})`);
        }
        d.vars();
        if (d.olog) d.sounds();
      };
      compare();
      for (let t = 0; t < 10 * scale; t++) { d.tick(0); compare(); }
      for (const i of GOBLETS) {
        const r = W.records[i];
        if (!r.ctrl) continue;
        d.placePepper(r.x, r.y, r.z, 0);
        for (let t = 0; t < 8 * scale; t++) { d.tick(0); cover.ticks++; compare(); }
      }
      cover.picked += (mem.r32(0x8a2d2c + 4 * 0xbc) | 0).toString(2).split('1').length - 1;
      d.eq('var 0xaf (goblet score)', mem.r32(0x8a2d2c + 4 * 0xaf) | 0, W.vars.get(0xaf));
      checked += d.checked;
      notes.push(`${d.label}: var 0xbc ${W.vars.get(0xbc).toString(2)}, var 0xaf ${W.vars.get(0xaf)}, var 0xce ${W.vars.get(0xce)}; worst ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
    }
    notes.push(`coverage: ${JSON.stringify({ ...cover, modes: [...cover.modes] })}`);
    if (cover.picked < 10) failures.push(`only ${cover.picked} goblets were picked up`);
    if (cover.homing < 50) failures.push(`the head-for-home branch ran only ${cover.homing} rat-ticks`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
