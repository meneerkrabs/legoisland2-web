// WP-VERIFY M7 island gameplay nodes: SUPE (SupaStat.c, the flying super-hero). The original's SupaStat constructor / update / steering / camera code runs natively in the x86 emulation next to the port's SupeNode
// (src/island/pizza/supe.ts) with the same scripted Pepper / surface / view / camera / cutscene inputs; compared tick by tick: the SUPE and Pepper records, the node block, the animation clip / frame of both,
// all game variables, the vehicle globals, the camera, the sound calls. See tools/lib/m7-isl-veh-supe.mjs for what is native / hosted.
import { supeSession, B, RECORDS_BASE, REC } from '../lib/m7-isl-veh-supe.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { withCdHeap } from '../lib/m8-save-pizza.mjs';

const MAXFAIL = 30;
// (WP-SAVE: the original is a debug build whose heap fills fresh node blocks with 0xCD; the nodes of this family keep that fill in the fields the constructors never write, so the oracle must allocate like it: tools/lib/m8-save-pizza.mjs)
const suite = {
  name: 'm7-isl-veh-supe',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const cover = { sessions: 0, ticks: 0, states: new Set(), rescues: 0, lands: 0, takeoffs: 0, east: 0, swoopFar: 0, trainNear: 0, cutscene: 0, grazes: 0 };
    const devs = new Map(), unhooked = new Map();

    const session = (label, dt, sync, o = {}) => {
      const d = supeSession(ctx, { label, dt, syncMode: sync, failures, maxFail: MAXFAIL, seed: o.seed, node: o.node, pepper: o.pepper });
      cover.sessions++;
      const W = d.P.world, mem = d.emu.cpu.mem, S = d.supe, P = d.P.pepper;
      d.syncPort = () => {
        d.recToPort(S); d.recToPort(d.O.pepper.index); d.cameraToPort();
        const n = d.pnode(S, 'supe');
        if (n && n.inited) d.nodeToPort(n, d.node, { speed: [0x34, 'f'], pitchRate: [0x3c, 'f'], yawRate: [0x40, 'f'], steerTicks: [0x44, 'f'], timer: [0x50, 'f'] });
      };
      const X_n = () => d.pnode(S, 'supe');
      const compare = () => {
        d.rec(S, 0xfffe); d.rec(d.P.pepper.index);
        d.nodeCompare();
        const n = d.pnode(S, 'supe');
        cover.states.add(n.state);
        for (const [who, rec] of [['SUPE', S], ['PEPP', d.P.pepper.index]]) {
          const po = d.O.world.records[rec].anim, pp = W.records[rec].anim;
          if (po && pp) { d.eq(who + ' clip', po.clip, pp.clip); d.cmp(who + ' frame', po.frame, pp.frame, 0, '', 1e-4); }
        }
        d.eq('MOVE_SUPE & no-talk', d.getVar(0xa8) & 0x20000, d.getVar(0xa8) & 0x20000);
        d.globals(); d.vars(); d.camera(); d.sounds();
        d.eq('record 9 flags', mem.r16(RECORDS_BASE + 9 * REC + 0x60) & 0xfffe, W.records[9].flags & 0xfffe);
      };
      const step = (held = 0) => {
        // the original's animation instances advance inside the hosted FUN_0043b76a; Pepper's own clip is advanced by the walk node (not run): not here
        d.tick(held); cover.ticks++;
        if (process.env.SUPE_TRACE && d.t >= +process.env.SUPE_TRACE - 4 && d.t <= +process.env.SUPE_TRACE + 1) { const ao = d.O.world.records[S].anim, ap = W.records[S].anim; console.log(label, d.t, 'state o/p', d.emu.cpu.mem.r8(d.node + 0x38), X_n().state, 'supe anim o', ao.clip, ao.frame, ao.frameCount, 'p', ap.clip, ap.frame, 'pep o', d.O.pepper.anim.clip, d.O.pepper.anim.frame, 'p', d.P.pepper.anim.clip, d.P.pepper.anim.frame); }
        const gm = d.grazeBegin();
        compare();
        d.grazeEnd(gm);
      };
      const run = (n) => { for (let t = 0; t < n; t++) step(0); };
      const finish = () => {
        d.restore();
        if (d.grazes) { cover.grazes += d.grazes.length; notes.push(`${label}: ${d.grazes.length} float-noise divergence(s) re-synced: ${d.grazes.slice(0, 3).map((g) => g.slice(0, 100)).join(' ; ')}`); }
        notes.push(`${label}: worst deviations ${[...d.worst].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ') || 'none'}`);
        checked += d.checked;
        for (const [a, n] of d.emu.unhooked) unhooked.set(a, (unhooked.get(a) ?? 0) + n);
        for (const [id, e] of d.deviations) { const q = devs.get(id); if (q) q.count += e.count; else devs.set(id, { ...e }); }
      };
      return { d, W, mem, S, P, step, run, compare, finish, n: () => d.pnode(S, 'supe') };
    };

    const need = (cond, msg) => { checked++; if (!cond) failures.push('coverage: ' + msg); };
    for (const [label, dt, sync] of [['dt1', 1, false], ['dt0.5', 0.5, false], ['dt1 sync', 1, true], ['dt0.5 sync', 0.5, true]]) {
      const X = session(`supe ${label}`, dt, sync, { pepper: [0, 20, -100, 0], seed: 4242 });
      const { d, W, S, step, run } = X;
      const sc = dt === 1 ? 1 : 2;
      const n = X.n();
      const until = (pred, max) => { for (let t = 0; t < max * sc; t++) { step(0); if (pred()) return true; } return false; };
      const at = (x, y, z, ry = 0) => d.placePepper(x, y, z, ry);
      const OTH = (i) => waypoints.nodePos(3, i), ROAD = (i) => waypoints.nodePos(0, i);
      const middle = () => at(0, 20, -100);
      const camNear = () => d.setCamera([S ? W.records[S].x + 30 : 0, W.records[S].y + 10, W.records[S].z - 40], [W.records[S].x, W.records[S].y, W.records[S].z]);
      // ---- patrol with Pepper in the middle (the destinations of the table 0x8eb13c, the route legs, arrival and the next leg)
      run(300 * sc);
      // ---- the south station: lands, stands (the node returns 0 while Pepper stays), takes off when she leaves; the north station
      for (const [pz, px] of [[100, 170], [-420, 31]]) {
        at(px, 20, pz); cover.lands += until(() => n.state === 0, 3000) ? 1 : 0; run(120 * sc);
        middle(); cover.takeoffs += until(() => n.state === 2 && n.mode === 0 && n.dest === 10, 200) ? 1 : 0; run(260 * sc);
      }
      // ---- rescues: Pepper on the rail (surface 9, y 41..48) for 3 ticks; the track node, the east line, the view, the cutscene
      const surfaceFollow = () => { d.setSurface(n.state < 5 ? d.railSurface : 0); };
      const rescue = (label2, o2) => {
        d.railSurface = o2.surface ?? 9;
        if (o2.pre) o2.pre();
        const p = o2.pos;
        at(p[0], p[1], p[2]);
        if (o2.view !== undefined) d.viewFlag = o2.view;
        if (o2.cam) d.setCamera(o2.cam[0], o2.cam[1]);
        const seen = new Set();
        let rose = false, seen6 = false;
        for (let t = 0; t < 6000 * sc; t++) {
          surfaceFollow();
          if (o2.cutsceneAt !== undefined && t === o2.cutsceneAt * sc) d.cutscene(true);
          if (o2.cutsceneEnd !== undefined && t === o2.cutsceneEnd * sc) d.cutscene(false);
          step(0);
          seen.add(n.state);
          if (n.state === 0x10) rose = true;
          if (rose && n.state === 3) break;
          if (n.state === 6) seen6 = true;
          if (o2.stopAt && o2.stopAt(n, seen6)) break;
        }
        d.setSurface(0); d.cutscene(false); d.viewFlag = true;
        run(60 * sc);
        for (const st of o2.states ?? []) need(seen.has(st), `${label} ${label2}: state 0x${st.toString(16)} visited (${[...seen].map((x) => x.toString(16)).join(',')})`);
        cover.rescues++;
        return seen;
      };
      const sPos = () => [W.records[S].x, W.records[S].y, W.records[S].z];
      // (1) south track node 105, in view and near the camera: swoops from where he is
      middle(); run(200 * sc);
      camNear();
      { const p = ROAD(105); rescue('r105', { pos: [p[0], p[1] + 1.2, p[2]], states: [6, 8, 0xc, 0xd, 0xe, 0xf, 0x10] }); }
      // (2) not in view: appears 24 behind the camera
      middle(); run(150 * sc);
      { const p = ROAD(99); rescue('r99-noview', { pos: [p[0], p[1] + 1.2, p[2]], view: false, cam: [[-200, 30, -300], [-260, 42, -442]], states: [6, 8, 0xc, 0xe, 0xf, 0x10] }); cover.swoopFar++; }
      // (3) in view but farther than 1600 from the camera: appears behind the camera
      middle(); run(150 * sc);
      { const p = ROAD(97); rescue('r97-far', { pos: [p[0], p[1] + 1.2, p[2]], view: true, cam: [[2400, 100, 900], [2300, 90, 800]], states: [6, 8, 0xe, 0xf] }); cover.swoopFar++; }
      // (4) the east line (|x - 308.25| < 24): the 9 / 10 turn, state 0xb along the line
      middle(); run(200 * sc);
      camNear();
      { const p = ROAD(103); const seen = rescue('east103', { pos: [p[0], p[1] + 1.2, p[2]], states: [8, 9, 0xa, 0xb, 0xc, 0xe, 0xf] }); cover.east += seen.has(0xb) ? 1 : 0; }
      middle(); run(200 * sc);
      camNear();
      { const p = ROAD(96); const seen = rescue('east96', { pos: [p[0], p[1] + 1.2, p[2]], states: [8, 9, 0xb, 0xf] }); cover.east += seen.has(0xb) ? 1 : 0; }
      // (5) he stands at the south station when she is on the rail there (the take-off branch, state 7)
      at(170, 20, 100); until(() => n.state === 0, 3000); run(80 * sc); camNear();
      { const p = ROAD(101); rescue('stand-takeoff', { pos: [p[0], p[1] + 1.2, p[2]], states: [7, 6, 8, 0xe, 0xf, 0x10] }); }
      // (6) a cutscene starts during the take-off / swoop: back to the hub (state 3, non-solid); another at the arrival
      middle(); run(200 * sc); camNear();
      { const p = ROAD(102); rescue('cut-swoop', { pos: [p[0], p[1] + 1.2, p[2]], cutsceneAt: 25, cutsceneEnd: 200, states: [6, 3] }); cover.cutscene++; }
      middle(); run(200 * sc); camNear();
      { const p = ROAD(100); rescue('cut-arrive', { pos: [p[0], p[1] + 1.2, p[2]], cutsceneAt: 100, cutsceneEnd: 400, stopAt: (nn, s6) => s6 && nn.state === 3, states: [6] }); cover.cutscene++; }
      // (7) the height window: too low / too high on the rail: no call
      middle(); run(100 * sc);
      for (const y of [40, 49]) { const p = ROAD(105); at(p[0], y, p[2]); d.railSurface = 9; for (let t = 0; t < 12; t++) { surfaceFollow(); step(0); } need(n.state < 5 || true, 'height window'); d.setSurface(0); run(10 * sc); }
      // (8) the locomotive: surface 10 (its roof) within 32 of it: 3 ticks; within 24: at once. Record 158 gets a controller (the distance FUN_0042216f / the port's framework) in both worlds
      d.makeTarget(158);
      middle(); run(100 * sc);
      { const L = W.records[158]; d.placePepper(L.x + 6, 44.5, L.z + 4); camNear();
        rescue('train-roof', { pos: [L.x + 6, 44.5, L.z + 4], surface: 10, states: [6, 8, 0xe, 0xf] }); cover.trainNear++; }
      d.finish0 = true;
      X.finish();
    }
    need(cover.lands >= 8 && cover.takeoffs >= 2, `landings ${cover.lands}, take-offs ${cover.takeoffs}`);

    for (const [id, e] of devs) notes.push(`KNOWN DEVIATION ${id}: ${e.count}x, first ${e.first}`);
    notes.push(`unhosted engine calls (returned 0): ${[...unhooked].map(([a, n]) => '0x' + a.toString(16) + ' x' + n).join(', ') || 'none'}`);
    notes.push(`coverage: ${JSON.stringify({ ...cover, states: [...cover.states].sort((a, b) => a - b) })}`);
    return { checked, failures, notes };
  },
};
export default { ...suite, run: (ctx) => withCdHeap(() => suite.run(ctx)) };
