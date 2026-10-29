// WP-VERIFY M7 island: the speeder.c cars (AMBU / SPD0 / SPD1 / SPD2 / PCAR, FUN_00538126 + update FUN_00537689 + pre-render FUN_00537d54 + draw FUN_00537ea9) and their drivers (PETE / RICH / NUBB, FUN_005385d3),
// the original's own code run natively in the x86 emulation of tools/lib/m7-isl-veh-emu.mjs next to the port's src/island/pizza/speeder.ts.
// STAND-INS (not the subject; each is a host choice, said here once):
//   * the WALKER (FUN_00462d4f and friends, stepped by the Human1 node of the same record in the game) is not run: the walker calls of the constructor fall back to "return 0" in the emulation. Instead a scripted
//     "route" node sits after the speeder node in both worlds (the original's as a host node, the port's as a plain node) and moves the record exactly as the walker does: position + yaw (record matrix
//     translation and +0x50), nothing else; the pre-render of the speeder then rebuilds the matrix. The script is a function of the node's own record state (x, z, yaw) so both worlds follow the same path.
//   * the engine's collision (axle probes FUN_00441ac0 / FUN_0043cd62, the obstacle ray FUN_00441b10) is the port's CollisionWorld over the oracle world (as in all tools/lib/m7-* oracles).
//   * the brick burst FUN_00447e90 (FX_Bricks) is only logged ("fxp burst@<record> <kind>"); the end of the morph (the original's brick effect clears record flag 0x8000 again) is a scripted flag write in both worlds.
//   * the part matrices (FUN_0043ea60) start as the mesh's MATL entries (shared input), the wheel rotation applied to them is the original's.
import { Duel, B, REC, RECORDS_BASE, f32 } from './m7-isl-veh-emu.mjs';
import { partMatrix } from '../../src/island/trigger/parts.ts';
import { NODE_CONTINUE } from '../../src/game/controller.ts';

export { Duel, B, REC, RECORDS_BASE, f32 };
export const CARS = ['AMBU', 'SPD0', 'SPD1', 'SPD2', 'PCAR'];
export const DRIVERS = { PETE: 'AMBU', RICH: 'SPD1', NUBB: 'SPD0' };
export const CTOR_CAR = 0x538126, CTOR_DRIVER = 0x5385d3;
export const MOVE_VAR = { AMBU: 0xa7, SPD0: 0x80, SPD1: 0xa4, SPD2: 0x7f, PCAR: 0x60 };

/** Duel with the speeder nodes of the cars + drivers only, the hosts for the burst log, the wheel snapshot at draw time, the route scripts */
export function speederDuel(ctx, o) {
  const d = new Duel(ctx, { keepKinds: ['speeder', 'speederDriver'], keepRecords: (n) => CARS.includes(n) || n in DRIVERS, pepSwitc: false, seat: false, draw: true, ...o });
  const W = d.P.world, emu = d.emu, cpu = emu.cpu, mem = cpu.mem, H = cpu.hooks;
  const idx = (n) => W.records.findIndex((r) => r.name === n);
  d.idx = idx;
  d.cars = CARS.map(idx).filter((i) => i >= 0 && d.pnode(i, 'speeder'));
  d.drivers = Object.keys(DRIVERS).map(idx).filter((i) => i >= 0 && d.pnode(i, 'speederDriver'));
  // ---- brick burst: logged as `fxp burst@<rec> <kind>` (the comparison of the sound / emitter calls keeps `fxp` lines)
  H.set(0x447e90, (c) => { emu.log.push(`fxp burst@${(c.arg(0) - RECORDS_BASE) / REC} ${c.arg(1) | 0}`); c.eax = 0; });
  d.P.ictx.brickBurst = (rec, kind) => { d.psnd.push(`fxp burst@${rec.index} ${kind}`); };
  // FUN_004427e0(rec): the collision object of the record becomes the box of its box file (an engine function, the port's implementation `setBoxFromFile` on the oracle world's record; the constructor calls it)
  H.set(0x4427e0, (c) => { d.O.world.records[(c.arg(0) - RECORDS_BASE) / REC].colObj?.setBoxFromFile(); c.eax = 0; });
  // (the constructors already ran inside the Duel's set-up, before this host existed: their FUN_004427e0 call is done here)
  for (const i of d.cars) d.O.world.records[i].colObj?.setBoxFromFile();
  // the renderer's frustum flag (record flag 1) is the "in view" test of the port's `inFrustum`
  d.P.ictx.inFrustum = (rec) => (rec.flags & 1) !== 0;
  // ---- wheel snapshot: FUN_00444480 (the default mesh draw) is called by the draw hook after it set the wheel matrices (and the hook resets them afterwards): the part matrices at that moment
  d.wheels = new Map();
  const draw0 = H.get(0x444480);
  H.set(0x444480, (c) => {
    const i = (c.arg(0) - RECORDS_BASE) / REC, buf = emu.partBufs.get(i);
    if (buf && d.cars.includes(i)) { const m = []; for (let k = 2; k < 6; k++) { const a = []; for (let q = 0; q < 16; q++) a.push(mem.f32(buf + 0x40 * k + 4 * q)); m.push(a); } d.wheels.set(i, m); }
    return draw0(c);
  });
  // which cars' wheel draw hook (FUN_00537ea9) ran in the draw pass of this tick (the framework calls it only for a node that returned 1 / 2 in the update)
  d.drawRan = new Set();
  cpu.watches.set(0x537ea9, (c) => { d.drawRan.add((c.arg(0) - RECORDS_BASE) / REC); });
  // coverage of FUN_005373a6 (the axle ground probes): both axles on ground / only the front / only the back / neither
  d.axle = { both: 0, front: 0, back: 0, none: 0 };
  for (const [a, k] of [[0x5375c0, 'both'], [0x537640, 'front'], [0x53765a, 'back'], [0x53766e, 'none']]) cpu.watches.set(a, () => { d.axle[k]++; });
  // ---- the scripted routes
  d.route = new Map();
  const A = (i) => RECORDS_BASE + i * REC;
  const stepOf = (st, cfg, t) => { const ry = st.ry + cfg.turn(t) * d.dt; const v = cfg.v * d.dt; return { ry, x: st.x + Math.sin(ry) * v, z: st.z + Math.cos(ry) * v }; };
  const hold = (i, flags) => (flags & 0x2000) !== 0;
  const portNode = (i) => ({ kind: 'route', var: 2, mask: 0, value: 0, stamp: 0xfffffffe, update: (w, rec) => {
    const cfg = d.route.get(i);
    if (cfg && !cfg.paused && !hold(i, rec.flags)) { const n = stepOf({ x: rec.x, z: rec.z, ry: rec.ry }, cfg, d.t); rec.x = f32(n.x); rec.z = f32(n.z); rec.ry = f32(n.ry); }
    return NODE_CONTINUE;
  } });
  for (const i of d.cars) {
    const r = W.records[i];
    r.ctrl.nodes.push(portNode(i));
    emu.stub(i, { var: 2, mask: 0, value: 0 }, (c) => {
      const cfg = d.route.get(i);
      if (cfg && !cfg.paused && !hold(i, mem.r16(A(i) + 0x60))) {
        const n = stepOf({ x: mem.f32(A(i) + 0x3c), z: mem.f32(A(i) + 0x44), ry: mem.f32(A(i) + 0x50) }, cfg, d.t);
        mem.wf32(A(i) + 0x3c, n.x); mem.wf32(A(i) + 0x44, n.z); mem.wf32(A(i) + 0x50, n.ry);
      }
      c.eax = 2;
    });
  }
  /** put record i at a pose in both worlds (matrix rebuilt from the Euler angles) */
  d.placeRec = (i, x, y, z, ry, rx = 0) => {
    emu.sync();
    for (const r of [d.P.world.records[i], d.O.world.records[i]]) { r.setEuler(rx, ry, 0, x, y, z); r.rx = rx; r.ry = ry; r.rz = 0; }
    emu.putRecord(i, d.O.world.records[i]);
    emu.sync();
  };
  /** record flags set / clear in both worlds (the renderer's frustum bit, the morph's end ...) */
  d.flagsBoth = (i, set, clear) => {
    const r = W.records[i], a = A(i);
    r.flags = (r.flags | set) & ~clear & 0xffff;
    mem.w16(a + 0x60, (mem.r16(a + 0x60) | set) & ~clear & 0xffff);
    emu.sync();
  };
  // the constructor's walker start (FUN_00462d4f + FUN_00461fe4 put the record at its ROAD start node) is the walker's work (not run in the emulation): the port's init() is run now and BOTH worlds start at the pose it gave
  for (const i of d.cars) { const r = W.records[i], pn = d.pnode(i, 'speeder'); pn.init(W, r, r.ctrl); d.placeRec(i, r.x, r.y, r.z, r.ry, r.rx); }
  d.fwd = (i) => { const m = W.records[i].m; return [m[8], m[9], m[10]]; };
  return d;
}

export const wheelsOfPort = (d, i) => [2, 3, 4, 5].map((k) => partMatrix(d.P.world, d.P.world.records[i], k));
