// M5 z07CSI horse, the node-level test (the port alone, through the framework's world: tools/lib/m5-z07CSI-load.mjs, real input keys): the three constructors are registered and attached to the
// records the emulated set-up names, the horse family starts like the emulated set-up left it (visibility, explicit placements), the ride starts from the story's variables (node 21) and from the
// arrival after the joust (previous zone 8), the keys drive the horse (Up / Space / Left / Alt / Down), Ctrl gets Pepper on and off, the rider / saddle records follow, and the horse goes home after
// 300 ticks out of sight. (The ORACLE tests next to the original: m5-z07CSI-horse-emu / -ride.)
import { loadCsi, tick, press, hold } from '../lib/m5-z07CSI-load.mjs';
import { vehicles } from '../../src/island/vehicles/common.ts';
import { waypoints } from '../../src/game/walker.ts';

const STAGES = [[15, 0], [16, 7], [17, 7], [19, 7], [20, 7], [21, 7], [22, 7], [24, 8], [25, 7], [27, 9], [28, 7], [29, 7]];
const HORS = 48, PEPP = 7, JKIT = 46, SADDLES = [51, 52, 53];

export default {
  name: 'm5-z07CSI-horse-nodes',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };

    // ---- (1) the attaches and the set-up state of every stage
    for (const [node, prev] of STAGES) {
      const H = loadCsi(ctx, { node, vars: { 0xa3: prev } });
      const W = H.world, G = vehicles(W);
      const kinds = (i) => (W.records[i].ctrl?.nodes ?? []).map((n) => n.kind);
      ok(kinds(HORS).includes('Horse') && kinds(JKIT).includes('Horse') && SADDLES.every((i) => kinds(i).includes('Horse')) && kinds(PEPP).at(-1) === 'Horse', `node ${node}: the horse nodes: HORS ${kinds(HORS)} JKIT ${kinds(JKIT)} PEPP ${kinds(PEPP)}`);
      const gates = W.records[PEPP].ctrl.nodes.at(-1);
      ok(gates.var === 0x5e && gates.mask === 0x10 && gates.value === 0x10, `node ${node}: Pepper's rider node is gated by PEPPER_CONTROL & 0x10`);
      const hn = W.records[HORS].ctrl.nodes.find((n) => n.kind === 'Horse');
      ok(hn.var === 0x112 && hn.mask === 0 && hn.value === 0, `node ${node}: the horse is gated by var 0x112 & 0`);
      ok(H.L.skipped.every((s) => s.ctorName !== 'Horse'), `node ${node}: no unported Horse attach left`);
      tick(H, 3);
      // the set-up's final state (the emulated machine): visibility of the horse family
      for (const i of [HORS, ...SADDLES]) {
        const e = H.emu.records[i];
        // (a record the story / stage code shows or hides is checked through the emulation's final flag; the node's first update applies it)
        ok(((e.flags & 2) !== 0) === ((W.records[i].flags & 2) !== 0), `node ${node}: ${W.records[i].name} visible ${(W.records[i].flags & 2) !== 0}, the emulated set-up ${(e.flags & 2) !== 0}`);
      }
      void G;
    }

    // ---- (2) the arrival after the joust (previous zone 8, node 24): Pepper rides at once, the jockey kit shows, the horse is the vehicle
    {
      const H = loadCsi(ctx, { node: 24, vars: { 0xa3: 8 } });
      const W = H.world, G = vehicles(W), hp = W.records[HORS];
      ok(W.vars.get(0x5e) === 0x10 && (W.vars.get(0x112) & 1) === 1, `arrival from the joust: PEPPER_CONTROL ${W.vars.get(0x5e)}, var 0x112 ${W.vars.get(0x112)}`);
      tick(H, 4);
      ok(G.current === hp, 'arrival from the joust: the horse is the vehicle after the first ticks');
      ok((hp.flags & 2) !== 0 && (W.records[JKIT].flags & 2) !== 0 && (W.records[PEPP].flags & 2) === 0, `stage 24 shows the jockey kit, not Pepper (HORS ${hp.flags.toString(16)}, JKIT ${W.records[JKIT].flags.toString(16)}, PEPP ${W.records[PEPP].flags.toString(16)})`);
      ok(Math.hypot(W.records[JKIT].x - hp.x, W.records[JKIT].z - hp.z) < 0.01 && Math.hypot(W.records[PEPP].x - hp.x, W.records[PEPP].z - hp.z) < 0.01, 'the rider records sit on the horse');
      ok(W.records[JKIT].anim.clip === 0xbc || W.records[JKIT].anim.clip === 0xc6 || W.records[JKIT].anim.clip === 0xb1 || W.records[JKIT].anim.clip === 0x8b, `the jockey kit's riding clip ${W.records[JKIT].anim.clip}`);
      // the keys: Up trots (clip 2, 1/3 a tick), Space toggles the gallop (clip 3, 1 a tick)
      const x0 = hp.x, z0 = hp.z;
      hold(H, ['ArrowUp'], 30);
      const d1 = Math.hypot(hp.x - x0, hp.z - z0);
      ok(d1 > 6 && d1 < 11 && hp.anim.clip === 2, `Up for 30 ticks: the horse trots ${d1.toFixed(1)} units (clip ${hp.anim.clip})`);
      press(H, 'Space', 2);
      const x1 = hp.x, z1 = hp.z;
      hold(H, ['ArrowUp'], 30);
      const d2 = Math.hypot(hp.x - x1, hp.z - z1);
      ok(d2 > 20 && hp.anim.clip === 3, `Space + Up for 30 ticks: the horse gallops ${d2.toFixed(1)} units (clip ${hp.anim.clip})`);
      const y0 = hp.ry;
      hold(H, ['ArrowRight'], 12);
      ok(((hp.ry - y0 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI > 0.2, `Right turns the horse (yaw ${y0.toFixed(2)} -> ${hp.ry.toFixed(2)})`);
      // Alt held and released: the jump (clip 6), the busy bit of var 0x112 while it lasts, Ctrl does not get off
      hold(H, ['AltLeft', 'ArrowUp'], 12);
      let busy = false, six = false;
      for (let i = 0; i < 40; i++) { tick(H, 1); if ((W.vars.get(0x112) & 0x10) !== 0) busy = true; if (hp.anim.clip === 6) six = true; if (i === 5) press(H, 'ControlLeft', 1); }
      ok(busy && six, `the jump: busy bit ${busy}, clip 6 ${six}`);
      ok((W.vars.get(0x5e) & 0xfff) === 0x10, 'Ctrl in the air does not get off');
      tick(H, 60);
      // on the ground: Ctrl gets off (the free spot, mode 0x401 for a tick, then walking), the horse stands (clip 5)
      press(H, 'ControlLeft', 1);
      tick(H, 3);
      ok((W.vars.get(0x5e) & 0xfff) === 1 && G.current === null && (W.vars.get(0x112) & 1) === 0, `Ctrl on the ground gets off: PEPPER_CONTROL ${W.vars.get(0x5e).toString(16)}, vehicle ${G.current?.name}, var 0x112 ${W.vars.get(0x112)}`);
      tick(H, 3);
      ok(hp.anim.clip === 5, `the horse grazes (clip ${hp.anim.clip})`);
      // next to the horse Ctrl takes her on again
      const pp = W.records[PEPP];
      pp.x = hp.x + 3; pp.z = hp.z; pp.y = hp.y; tick(H, 2);
      press(H, 'ControlLeft', 1);
      tick(H, 3);
      ok((W.vars.get(0x5e) & 0xfff) === 0x10 && G.current === hp && (W.vars.get(0x112) & 1) === 1, `Ctrl next to the horse mounts: PEPPER_CONTROL ${W.vars.get(0x5e).toString(16)}, vehicle ${G.current?.name}, kind ${G.kind}`);
      ok(G.kind === -4, `the vehicle kind is -4 after a Ctrl mount (${G.kind})`);
    }

    // ---- (3) the story starts the ride (node 21: var 0x112 := 1, var 0x5e := 0x10, HORS gets Pepper's matrix): the first ridden tick makes the horse the vehicle
    {
      const H = loadCsi(ctx, { node: 21, vars: { 0xa3: 7 } });
      const W = H.world, G = vehicles(W), hp = W.records[HORS], pp = W.records[PEPP];
      tick(H, 2);
      W.vars.set(0x112, 1); W.vars.set(0x5e, 0x10);
      hp.m.set(pp.m); hp.rx = pp.rx; hp.ry = pp.ry; hp.rz = pp.rz; hp.flags |= 2;
      tick(H, 3);
      ok(G.current === hp && hp.anim.clip === 2, `the story's ride start: the horse is the vehicle (${G.current?.name}), clip ${hp.anim.clip}`);
      ok(G.kind === 0, `without a Ctrl mount the vehicle kind stays ${G.kind} (the horse's pre-render leaves it)`);
    }

    // ---- (4) a ridden horse out of sight for 300 ticks goes to the PATH node 0x5a
    {
      const H = loadCsi(ctx, { node: 21, vars: { 0xa3: 7 } });
      H.ictx.inFrustum = () => false;
      const W = H.world, G = vehicles(W), hp = W.records[HORS], pp = W.records[PEPP];
      tick(H, 2);
      W.vars.set(0x112, 1); W.vars.set(0x5e, 0x10); hp.flags |= 2;
      tick(H, 3);                                                         // ridden: the node is active
      G.current = null; W.vars.set(0x5e, 1); W.vars.set(0x112, 0); pp.x = hp.x + 80; pp.z = hp.z;
      tick(H, 3);
      const moved = [hp.x, hp.z];
      tick(H, 295);
      ok(Math.hypot(hp.x - moved[0], hp.z - moved[1]) < 1e-3, 'the horse still stands where it was before the 300 ticks are over');
      tick(H, 15);
      const home = waypoints.nodePos(1, 0x5a);
      ok(Math.hypot(hp.x - home[0], hp.z - home[2]) < 1e-3 && hp.anim.clip === 5, `after 300 ticks out of sight the horse is on PATH node 0x5a (${hp.x.toFixed(1)}, ${hp.z.toFixed(1)} vs ${home[0].toFixed(1)}, ${home[2].toFixed(1)}), clip ${hp.anim.clip}`);
    }
    notes.push(`${STAGES.length} stages: attaches + gates + visibility; arrival after the joust; keys (Up, Space, Right, Alt, Ctrl); the story's ride start; the horse going home`);
    return { checked, failures, notes };
  },
};
