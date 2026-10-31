// M5 z07CSI, the whole ride: Pepper's chain as the castle attaches it (Control FUN_0057a579 = the mode switch, the rider node FUN_00579725 @5) + the horse HORS + the jockey kit JKIT + the saddles,
// all of them natively in the x86 interpreter next to the port (tools/lib/m5-z07CSI-emu.mjs `makeCsiDuel`, `chain: true`: Control natively, the walk node's one effect on the vehicle range).
// Pepper walks next to the horse and presses Ctrl: Control + the horse's update decide who takes her (the horse FUN_005769a8 chooses `DAT_009daa80`, Control's pre-render FUN_00579ebe sets
// PEPPER_CONTROL 0x10, the horse's pre-render FUN_00578f2d sets var 0x112), she rides (random keys, teleports over land / shore / walls, story variables), Ctrl gets her off at the free spot
// FUN_00579a96 finds (mode 0x401, the clip 0x1b), the horse stands again. Compared EVERY tick bit for bit: the records HORS / PEPP / JKIT / RSAD / GSAD / CLOK (matrix, angles, flags, clips,
// frames), the horse node's block, the camera, every game variable, the vehicle globals, every sound call, the random numbers consumed.
import '../../src/zones/z07CSI/horse/index.ts';
import { makeCsiDuel, NATIVE_CTORS, B, lcg, RECORDS_BASE, REC, f32 } from '../lib/m5-z07CSI-emu.mjs';
import { castleSpots } from '../lib/m5-z07CSI-horse-spots.mjs';
import { horseAxes } from '../../src/zones/z07CSI/horse/hors.ts';
import { guarded } from '../lib/inject-guard.mjs';

const HORS = 48, PEPP = 7, JKIT = 46, SADDLES = [51, 52, 53];
const KEYS = [0, 0, B.UP, B.UP, B.UP, B.DOWN, B.LEFT, B.RIGHT, B.UP | B.LEFT, B.UP | B.RIGHT, B.SPACE, B.ALT, B.UP | B.ALT, B.UP | B.SPACE, B.CTRL];
const NODE_F = { 0x1c: 'omega', 0x20: 'jumpY0', 0x24: 'hop', 0x2c: 'turnRate', 0x34: 'pitch', 0x38: 'backTicks', 0x3c: 'sx', 0x40: 'sy', 0x44: 'sz', 0x48: 'syaw', 0x50: 'idle', 0x58: 'standT' };
const NODE_I = { 0x18: 'st', 0x4c: 'sound', 0x54: 'active' };

const __test = {
  name: 'm5-z07CSI-horse-ride',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { ticks: 0, mounts: 0, dismounts: 0, ridden: 0, spots: 0, modes: {}, joust: 0, board: 0 };
    for (const [dt, seed, node] of [[1, 5, 21], [1, 99, 22], [0.5, 31, 25]]) {
      const d = makeCsiDuel(ctx, {
        node, seed, dt, failures, maxFail: 40, chain: true, kinds: [NATIVE_CTORS.CONTROL, NATIVE_CTORS.HORSE, NATIVE_CTORS.RIDER, NATIVE_CTORS.SADDLE],
        keepKinds: ['Horse'], pepperKinds: ['Control', 'Horse'], vars: { 0xa3: 7 }, extraExec: [[0x461000, 0x466800]],
        beforeAttach: (dd) => {
          const P = dd.P.world.records, Ow = dd.O.world.records;
          for (let i = 0; i < P.length; i++) {
            Ow[i].m.set(P[i].m); Ow[i].rx = P[i].rx; Ow[i].ry = P[i].ry; Ow[i].rz = P[i].rz; Ow[i].flags = P[i].flags;
            dd.emu.putRecord(i, Ow[i]);
            if (P[i].anim && Ow[i].anim) Ow[i].anim.start(P[i].anim.clip, P[i].anim.frame);
          }
        },
      });
      d.label = `ride n${node} dt${dt} seed${seed}`;
      horseAxes.x = 0; horseAxes.y = 0;
      const W = d.P.world, mem = d.emu.cpu.mem, G = d.P.G;
      const hp = W.records[HORS], pp = W.records[PEPP];
      const onode = d.emu.nodeOf.get(HORS)[0].ptr;
      const pnode = d.pnode(HORS, 'Horse');
      pnode.setupApplied = true;                                  // (the tests place the records themselves)
      for (const i of SADDLES) d.pnode(i, 'Horse').setupApplied = true;
      const rnd = lcg(seed * 17 + 3);
      const scale = dt === 1 ? 1 : 2;
      d.reseed(seed);
      const rng0 = { o: d.rngCount.o, p: d.rngCount.p };
      d.P.ictx.inFrustum = (rec) => (rec.flags & 1) !== 0;
      for (const r of [hp, d.O.world.records[HORS]]) r.flags |= 2;
      mem.w16(RECORDS_BASE + HORS * REC + 0x60, mem.r16(RECORDS_BASE + HORS * REC + 0x60) | 2);
      const putHorse = (x, z, ry) => {
        const y = W.col.terrainHeight(x, 200, z, 0);
        for (const r of [hp, d.O.world.records[HORS]]) { r.setEuler(0, ry, 0, x, y > -1e30 ? y : 0, z); r.rx = 0; r.ry = f32(ry); r.rz = 0; }
        d.emu.putRecord(HORS, d.O.world.records[HORS]);
        mem.w16(RECORDS_BASE + HORS * REC + 0x60, d.O.world.records[HORS].flags & 0xffff);
        d.emu.sync();
      };
      const { land: LAND } = castleSpots(W);
      const landSpot = () => LAND[Math.floor(rnd() * LAND.length)];
      const putPepper = (x, z) => { const y = W.col.terrainHeight(x, 200, z, 0); d.placePepper(x, y > -1e30 ? y : 0, z, rnd() * 6.28 - 3.14); };
      const fl = (a, b, name) => { checked++; const x = f32(b); if (!(a === x || (Number.isNaN(a) && Number.isNaN(x)))) d.fail(`${d.label} t${d.t} ${name}: original ${a} port ${b}`); };
      const it = (a, b, name) => { checked++; if (a !== b) d.fail(`${d.label} t${d.t} ${name}: original ${a} port ${b}`); };
      const compare = () => {
        for (const i of [HORS, PEPP, JKIT, ...SADDLES, G.board]) {
          const a = RECORDS_BASE + i * REC, r = W.records[i];
          for (let k = 0; k < 16; k++) fl(mem.f32(a + 0xc + 4 * k), r.m[k], `${r.name}.m[${k}]`);
          fl(mem.f32(a + 0x4c), r.rx, `${r.name}.rx`); fl(mem.f32(a + 0x50), r.ry, `${r.name}.ry`); fl(mem.f32(a + 0x54), r.rz, `${r.name}.rz`);
          it(mem.r16(a + 0x60), r.flags & 0xffff, `${r.name}.flags`);
          const ao = d.O.world.records[i].anim, ap = r.anim;
          if (ao && ap) { it(ao.clip, ap.clip, `${r.name} clip`); fl(ao.frame, ap.frame, `${r.name} frame`); }
        }
        for (const [off, name] of Object.entries(NODE_F)) fl(mem.f32(onode + +off), pnode[name], `node.${name}`);
        for (const [off, name] of Object.entries(NODE_I)) it(mem.r32(onode + +off) | 0, pnode[name] | 0, `node.${name}`);
        for (let k = 0; k < 6; k++) fl(mem.f32(0x9da5e8 + 4 * k), W.camera.c[k], `camera[${k}]`);
        d.vars();
        d.globals();
        if (d.olog) d.sounds();
        it(d.rngCount.o - rng0.o, d.rngCount.p - rng0.p, 'random numbers consumed');
      };
      compare();
      let held = 0, hold = 0;
      for (let t = 0; t < 9000 * scale; t++) {
        const mode = W.vars.get(0x5e) & 0xfff;
        if (t % (3 * scale) === 0) {
          const r = rnd();
          if (mode === 1 || mode === 0x401) {
            // walking: next to the horse most of the time (Ctrl takes her on), sometimes elsewhere
            if (r < 0.45) { const ang = rnd() * 6.28, rr = 1 + rnd() * 6; putPepper(hp.x + Math.cos(ang) * rr, hp.z + Math.sin(ang) * rr); d.setState([0x1b, 0x1b, 1, 0x24][Math.floor(rnd() * 4)], false); }
            else if (r < 0.52) { const [x, z] = landSpot(); putHorse(x, z, rnd() * 6.28 - 3.14); }
            else if (r < 0.56) d.setState([0x1b, 0x62, 1, 0x57][Math.floor(rnd() * 4)], false);
            held = rnd() < 0.5 ? B.CTRL : 0;
          } else if (mode === 0x10) {
            if (r < 0.04) { const [x, z] = landSpot(); putHorse(x, z, rnd() * 6.28 - 3.14); }
            else if (r < 0.07) d.setVar(0x58, [0x11, 0x15, 0x16, 0x17, 0x18, 0x19][Math.floor(rnd() * 6)]);
            if (hold-- <= 0) { held = KEYS[Math.floor(rnd() * KEYS.length)]; hold = 1 + Math.floor(rnd() * 12); }
          } else {
            // swimming / on the board / anything else: back to walking next to the horse (the walk / swim / skate nodes are not in this chain)
            d.setVar(0x5e, 1); d.setState(0x1b, false); const ang = rnd() * 6.28; putPepper(hp.x + Math.cos(ang) * 3, hp.z + Math.sin(ang) * 3); held = 0;
          }
        }
        // Ctrl on the horse gets off at a free spot the original finds by looping (for ever when there is none: Pepper far out at sea): only where land is within reach
        let press = held;
        if (mode === 0x10 && (held & B.CTRL) !== 0) {
          const p = W.records[PEPP];
          if (!(W.col.terrainHeight(p.x, p.y + 80, p.z, 0) > W.seaLevel + 1)) press = 0;
        }
        if (process.env.RIDE_TR && d.t <= +process.env.RIDE_TR) console.log('t', d.t, 'press', press, 'mode', mode, 'v112', W.vars.get(0x112), 'cur', G.current?.name, 'range', G.range, mem.f32(0x8ae330), 'orig cur', mem.r32(0x9daa80), 'dist', pp.x - hp.x, pp.z - hp.z, 'mailbox', W.pep.mailbox, mem.r32(0x8ae088), 'pepflags', pp.flags.toString(16), mem.r16(RECORDS_BASE + PEPP * REC + 0x60).toString(16));
        d.tick(press); cover.ticks++;
        compare();
        const after = W.vars.get(0x5e) & 0xfff;
        cover.modes[after] = (cover.modes[after] ?? 0) + 1;
        if (mode !== 0x10 && after === 0x10) cover.mounts++;
        if (mode === 0x10 && after === 0x401) cover.dismounts++;
        if (after === 0x10) cover.ridden++;
        if (after === 4) cover.board++;
      }
      checked += d.checked;
      notes.push(`${d.label}: ${d.nfail} failures`);
    }
    notes.push(`coverage: ${JSON.stringify(cover)}`);
    for (const k of ['mounts', 'dismounts', 'ridden']) if (cover[k] < 10) failures.push(`coverage: ${k} only ${cover[k]}`);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
