// M5 z07CSI, the ORACLE test of Control (Pepper's mode switch, FUN_0057a579 / 00579a10 / 00579ebe / 00579a96): the original's node runs natively in the x86 interpreter
// (tools/lib/m5-z07CSI-emu.mjs, Pepper's chain = Control + the walk node's range write) next to the port's `CsiControl`. Random scripts drive both worlds equally: Ctrl presses, Pepper's walk
// state (the mailbox) and clip, teleports over land / shore / sea (collision and terrain: the port's CollisionWorld answers both), PEPPER_CONTROL forced to every mode, the vehicle Pepper
// sits in (the speedboat / the horse), the story node 0x11 hook, the cutscene switch 0x112. Compared per tick: Pepper's record, JKIT / the board / the horse (flags, clips), all game
// variables, the walk mailbox, the vehicle globals, every sound call.
import { makeCsiDuel, NATIVE_CTORS, B, lcg } from '../lib/m5-z07CSI-emu.mjs';

const MAXFAIL = 30;
const MAILBOX = [0x1b, 0x1b, 0x0d, 0x24, 0x3f, 0x40, 1, 2, 0x57, 0x1f, 0x38, 0x20, 0x21, 0x16, 0x1c, 0x25];
const CLIPS = [0x1b, 0x1b, 0x0d, 0x24, 99, 0x62, 0x15, 0x16, 3, 1];
const MODES = [1, 1, 1, 1, 2, 4, 4, 8, 0x10, 0x10, 0x401, 0x1001, 0x1004, 0x1002];

export default {
  name: 'm5-z07CSI-control',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { ticks: 0, sessions: 0, modes: new Map(), horseOff: 0, boardOn: 0, boardOff: 0, intoWater: 0, outOfWater: 0, storyHook: 0, toVehicle: 0 };
    for (const [dt, seed, node] of [[1, 17, 15], [1, 4711, 19], [0.5, 99, 24]]) {
      const d = makeCsiDuel(ctx, { node, seed, dt, failures, maxFail: MAXFAIL, chain: true, kinds: [NATIVE_CTORS.CONTROL], keepKinds: [], pepperKinds: ['Control'], vars: { 0xa3: 7 } });
      d.label = `control n${node} dt${dt} seed${seed}`; cover.sessions++;
      const W = d.P.world, O = d.O.world, mem = d.emu.cpu.mem, G = d.P.G;
      const rnd = lcg(seed * 13 + 5);
      const pi = d.P.pepper.index, jk = 46, bd = G.board, hs = 48;
      const scale = dt === 1 ? 1 : 2;
      const place = (x, z, yOff = 0) => {
        const y = W.col.terrainHeight(x, 200, z, 0);
        const yy = (y > -1e30 ? y : 0) + yOff;
        d.placePepper(x, yy, z, rnd() * 6.28 - 3.14);
      };
      const setClip = (c) => { for (const w of [W, O]) w.records[pi].anim?.start(c, 0); };
      const compare = () => {
        d.rec(pi, 0xffff, 1e-6);
        for (const i of [jk, hs, bd]) d.eq(`record ${i} flags`, mem.r16(0x10000000 + i * 0x68 + 0x60), W.records[i].flags & 0xffff);
        const ao = O.records[pi].anim, ap = W.records[pi].anim;
        if (ao && ap) d.eq('Pepper clip', ao.clip, ap.clip);
        const bo = O.records[bd].anim, bp = W.records[bd].anim;
        if (bo && bp) { d.eq('board clip', bo.clip, bp.clip); }
        d.globals();
        d.vars();
        if (d.olog) d.sounds();
        const m = W.vars.get(0x5e) & 0xfff;
        cover.modes.set(m, (cover.modes.get(m) ?? 0) + 1);
      };
      // the start: walking on land
      d.setVar(0x5e, 1); d.setCurrent(-1);
      place(W.records[pi].x, W.records[pi].z);
      compare();
      let held = 0, prev = { mode: 1, clip: 0 };
      for (let t = 0; t < 4000 * scale; t++) {
        if (t % (4 * scale) === 0) {
          const r = rnd();
          if (r < 0.08) { const x = rnd() * 700 - 350, z = rnd() * 700 - 350; place(x, z, rnd() < 0.3 ? -3 : 0); }
          else if (r < 0.12) place(-100 - rnd() * 150, -50 + rnd() * 100);               // x < -60: the story hook of node 0x11
          else if (r < 0.2) d.setVar(0x5e, MODES[Math.floor(rnd() * MODES.length)]);
          else if (r < 0.32) d.setState(MAILBOX[Math.floor(rnd() * MAILBOX.length)], false);
          else if (r < 0.4) setClip(CLIPS[Math.floor(rnd() * CLIPS.length)]);
          else if (r < 0.46) { const c = rnd(); d.setCurrent(c < 0.4 ? -1 : c < 0.7 ? hs : 87); }
          else if (r < 0.5) d.setVar(0x112, rnd() < 0.5 ? 0 : 0x10);
          else if (r < 0.54) d.setVar(0x58, rnd() < 0.5 ? 0x11 : 15 + Math.floor(rnd() * 14));
          else if (r < 0.58) d.setVar(0x56, 0);
          held = rnd() < 0.5 ? B.CTRL : 0;
        }
        const before = W.vars.get(0x5e) & 0xfff;
        // the original's FUN_00579a96 never gives up (it loops for ever when no free spot exists: Pepper far out at sea): Ctrl on the horse only where land is within reach
        let press = held;
        if (before === 0x10 && (held & B.CTRL) !== 0) {
          const p = W.records[pi];
          if (!(W.col.terrainHeight(p.x, p.y + 80, p.z, 0) > W.seaLevel + 1)) press = 0;
        }
        d.tick(press); cover.ticks++;
        compare();
        const after = W.vars.get(0x5e) & 0xfff;
        if (before !== after) {
          if (before === 0x10 && after === 0x401) cover.horseOff++;
          else if (after === 4) cover.boardOn++;
          else if (before === 4 && after === 1) cover.boardOff++;
          else if (before === 1 && after === 2) cover.intoWater++;
          else if (before === 2 && after === 1) cover.outOfWater++;
          else if ((after === 8 || after === 0x10) && before === 1) cover.toVehicle++;
        }
        if (W.vars.get(0x58) === 0x11 && W.vars.get(0x56) === 2) cover.storyHook++;
        void prev;
      }
      checked += d.checked;
      notes.push(`${d.label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
    }
    notes.push(`coverage: ${JSON.stringify({ ...cover, modes: Object.fromEntries([...cover.modes].map(([k, v]) => [k.toString(16), v])) })}`);
    for (const k of ['horseOff', 'boardOn', 'boardOff', 'intoWater', 'outOfWater', 'toVehicle']) if (cover[k] < 5) failures.push(`coverage: ${k} only ${cover[k]}`);
    return { checked, failures, notes };
  },
};
