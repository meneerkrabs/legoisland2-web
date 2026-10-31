import { loadIsland, tick, press, hold } from '../lib/island-load.mjs';
import { waypoints } from '../../src/game/walker.ts';
import { vehicles } from '../../src/island/vehicles/index.ts';
import { baseParts, partOverrides } from '../../src/island/trigger/parts.ts';
import { arrival, PTERA_RECORD } from '../../src/zones/z02LGI/arrival.ts';
import { setAmbientRandom } from '../../src/island/ambient/common.ts';
import { guarded } from '../lib/inject-guard.mjs';

const G2c = (w) => vehicles(w).current;

// M4 WP13: the ridden Ptera / glider (Ptera.c FUN_004bb1a6, update FUN_004b93b0, pre-render FUN_004baf1b) on the real island worlds of story nodes 52 / 61:
// parked, boarding with Ctrl, take-off, flight under the keys, ceiling, sea / wall bounce, landing on every free helipad, the glider, the arrival in the
// Ptera at the air portal and the exit through PORA.
// Run: node tools/test-formats.mjs --only m4-wp13-ptera -v

const finite = (r) => [r.x, r.y, r.z, r.rx, r.ry, r.rz, ...r.m].every(Number.isFinite);
const f = (v) => v.toFixed(1);

const __test = {
  name: 'm4-wp13-ptera',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let seed = 12345;
    setAmbientRandom(() => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; });
    try {
      // ------------------------------------------------------------------ era 3 (node 52) and era 4 (node 61): attaches
      for (const node of [52, 61]) {
        const I = loadIsland(ctx, { node });
        for (const [name, home, gate] of [['PTER', 406, 0xb6], ['GLDR', 270, 0x11]]) {
          const N = I.rec(name)?.ctrl?.find('Ptera');
          ok(N && N.home === home && N.var === gate && N.mask === 0, `node ${node}: ${name} has the Ptera node (home ${N?.home}, gate 0x${N?.var.toString(16)})`);
        }
        ok(I.index('GLDR') === 172 && I.index('PTER') === PTERA_RECORD, `node ${node}: GLDR = record 172, PTER = ${PTERA_RECORD}`);
      }

      // ------------------------------------------------------------------ the Ptera: parked, boarding, take-off, flight
      const I = loadIsland(ctx, { node: 52 });
      const W = I.world, P = I.pepper, G = vehicles(W);
      const R = I.rec('PTER'), N = R.ctrl.find('Ptera');
      tick(I, 2);
      ok(N.state === 3 && R.anim && R.anim.clip === 3 && N.pad === -1, `parked: state ${N.state}, clip ${R.anim?.clip}, no pad near its home (pad ${N.pad})`);
      P.x = R.x + 5; P.y = R.y; P.z = R.z;
      tick(I, 2);
      let icon = 0;
      tick(I, 1, () => { icon |= W.vars.get(0x0c); });
      ok((icon & 2) !== 0, `Pepper 5 away from the parked Ptera: interact icon bit 2 (var 0xc = ${icon})`);
      press(I, 'ControlLeft');
      ok((W.vars.get(0x5e) & 0xfff) === 0x40 && G.current === R && G.kind === -5, `Ctrl: PEPPER_CONTROL 0x${W.vars.get(0x5e).toString(16)}, current ${G.current?.name}, kind ${G.kind}`);
      ok(P.anim.clip === 0xed && R.anim.clip === 1, `Pepper sits on it (clip 0x${P.anim.clip.toString(16)}), the Ptera flaps (clip ${R.anim.clip})`);
      const g0 = W.col.terrainHeight(R.x, R.y, R.z, 8);
      let tOff = -1;
      tick(I, 200, (i) => { if (tOff < 0 && N.state === 0) tOff = i; });
      ok(tOff > 0 && R.y - g0 > 18, `take-off: flying (state 0) after ${tOff} ticks, ${f(R.y - g0)} above the ground`);
      ok(W.vars.get(0xa9) === 1 && W.vars.get(0xc5) === 5, `in flight: PEPP_IN_VEHICLE ${W.vars.get(0xa9)}, PEPPERSSHADOW ${W.vars.get(0xc5)}`);
      ok(Math.hypot(P.x - R.x, P.y - R.y, P.z - R.z) < 1e-3 && P.m[8] === R.m[8], 'Pepper is carried (position and matrix of the Ptera)');
      const c = W.camera.c;
      const back = (c[0] - R.x) * R.m[8] + (c[2] - R.z) * R.m[10];
      ok(c[3] === R.x && c[5] === R.z && back < -15 && back > -30 && c[1] > R.y + 8, `chase camera ${f(back)} behind, ${f(c[1] - R.y)} above, looking at the Ptera`);
      const snd = new Set(I.ictx.sounds.map((s) => s.id));
      ok(snd.has(0x303) && snd.has(0x302), 'wing beats 0x303 / 0x302');
      // speed
      let p0 = [R.x, R.z];
      tick(I, 10);
      const v1 = Math.hypot(R.x - p0[0], R.z - p0[1]) / 10;
      hold(I, ['Space'], 30);
      p0 = [R.x, R.z];
      tick(I, 10);
      const v2 = Math.hypot(R.x - p0[0], R.z - p0[1]) / 10;
      ok(Math.abs(v1 - 1) < 0.05 && Math.abs(v2 - 2) < 0.05 && N.speed === 2, `speed 1 -> Space -> 2 units / tick (${v1.toFixed(2)}, ${v2.toFixed(2)})`);
      hold(I, ['AltLeft'], 60);
      ok(Math.abs(N.speed - 0.5) < 1e-6, `Alt slows to 0.5 (${N.speed})`);
      hold(I, ['Space'], 30);
      const yaw0 = R.ry;
      hold(I, ['ArrowLeft'], 40);
      ok(R.ry < yaw0 - 0.5 && R.rz > 0.3 && N.yawRate <= -0.0499, `Left turns (ry ${yaw0.toFixed(2)} -> ${R.ry.toFixed(2)}, bank ${R.rz.toFixed(2)}, rate ${N.yawRate.toFixed(4)})`);
      tick(I, 60);
      ok(Math.abs(N.yawRate) < 0.002 && Math.abs(R.rz) < 0.02, `released: the turn eases out (rate ${N.yawRate.toFixed(4)})`);
      let y0 = R.y;
      hold(I, ['ArrowUp'], 40);
      ok(R.rx > 0.3 && R.y < y0 - 10, `Up dives (pitch ${R.rx.toFixed(2)}, ${f(y0 - R.y)} lower)`);
      hold(I, ['ArrowDown'], 70);
      y0 = R.y;
      tick(I, 60);
      ok(R.rx <= -0.349 && R.y > y0 + 20, `Down climbs (pitch ${R.rx.toFixed(2)}, ${f(R.y - y0)} higher in 60 ticks)`);
      let maxY = 0;
      tick(I, 200, () => { maxY = Math.max(maxY, R.y); });
      ok(maxY <= 184 && maxY > 183, `ceiling at 184 (max ${f(maxY)})`);
      ok(finite(R) && finite(P), 'no NaN after the flight');

      // sea bounce: diving into the sea far out
      R.setEuler(0.35, 0, 0, 700, W.seaLevel + 3, 700); R.rx = 0.35; R.ry = 0; R.rz = 0; N.pitchRate = 0.02; N.speed = 2;
      let bounced = -1, minY = 1e9;
      tick(I, 40, (i) => { if (bounced < 0 && N.bouncing) bounced = i; minY = Math.min(minY, R.y); });
      ok(bounced >= 0, `the sea bounces it (tick ${bounced})`);
      ok(R.y > W.seaLevel + 5 && minY > W.seaLevel - 6, `after the bounce it is above the sea again (y ${f(R.y)}, min ${f(minY)})`);
      // wall bounce: flying level into the hillside below the Ptera's home plateau (first direction whose start point is in the air)
      {
        const hx = 361.3, hz = -39.3, top = W.col.terrainHeight(hx, 200, hz, 8);
        let wall = null;
        for (let k = 0; k < 16 && !wall; k++) {
          const yaw = k * Math.PI / 8, sx = hx - Math.sin(yaw) * 90, sz = hz - Math.cos(yaw) * 90, y = top - 6;
          if (W.col.terrainHeight(sx, 400, sz, 8) < y - 8) wall = { yaw, sx, sz, y };
        }
        ok(!!wall, 'a hillside to fly into');
        if (wall) {
          R.setEuler(0, wall.yaw, 0, wall.sx, wall.y, wall.sz); R.rx = 0; R.ry = wall.yaw; R.rz = 0; N.pitchRate = 0; N.yawRate = 0; N.speed = 2; N.bouncing = false;
          let hitAt = -1, closest = 1e9;
          tick(I, 80, (i) => { if (hitAt < 0 && N.bouncing) hitAt = i; closest = Math.min(closest, Math.hypot(R.x - hx, R.z - hz)); });
          ok(hitAt >= 0 && closest > 10, `the hillside bounces it back (tick ${hitAt}, closest ${f(closest)} to the plateau centre)`);
        }
      }
      ok(finite(R), 'no NaN after the bounces');

      // ------------------------------------------------------------------ landing on every free helipad
      let landed = 0;
      const tried = [];
      for (let pi = 0; pi < G.pads.length; pi++) {
        const pad = G.pads[pi];
        if (pad.taken && N.pad !== pi) { tried.push(`${pi}: taken`); continue; }
        // (re)board where Pepper stands if the Ptera is parked
        if (N.state === 3) {
          P.x = R.x + 4; P.z = R.z; P.y = R.y;
          tick(I, 2); press(I, 'ControlLeft');
          if (N.state !== -1) { tried.push(`${pi}: re-board failed`); continue; }
          tick(I, 1);
        }
        const q = waypoints.nodePos(1, pad.node);
        N.state = 0; N.bouncing = false; N.pitchRate = 0; N.yawRate = 0;
        R.setEuler(0, 0, 0, q[0] + 20, q[1] + 40, q[2]); R.rx = 0; R.ry = 0; R.rz = 0; N.speed = 0.5;
        let near = 0;
        tick(I, 1, () => { near |= W.vars.get(0x0c); });
        press(I, 'ControlLeft');
        if (N.state !== 1) { tried.push(`${pi}: Ctrl -> state ${N.state}`); ok(false, `pad ${pi}: Ctrl near a free pad starts the landing (state ${N.state}, icons ${near})`); continue; }
        let t = -1, at = null;
        tick(I, 400, (i) => { if (t < 0 && N.state === 3) { t = i; at = { clip: P.anim.clip, mb: W.pep.mailbox, px: P.x, pz: P.z, a9: W.vars.get(0xa9), c5: W.vars.get(0xc5), ctl: W.vars.get(0x5e) & 0xfff, cur: G.current }; } });
        const e = waypoints.nodePos(1, pad.exit);
        const good = t > 0 && N.pad === pi && pad.taken && at.cur === null && at.ctl === 1 && at.clip === 0x1b && at.mb === 0x1b &&
          Math.hypot(at.px - e[0], at.pz - e[2]) < 1 && Math.hypot(R.x - q[0], R.z - q[2]) < 1 && at.a9 === 0 && at.c5 === 4 && finite(R);
        if (!good && at) notes.push(`pad ${pi}: ${JSON.stringify({ ...at, cur: at.cur?.name, pad: N.pad, taken: pad.taken })}`);
        ok(good, `pad ${pi}: landed after ${t} ticks (pad ${N.pad}, Pepper ${at ? f(Math.hypot(at.px - e[0], at.pz - e[2])) : '?'} from the exit node, Ptera ${f(Math.hypot(R.x - q[0], R.z - q[2]))} from the pad, ${f(R.y - q[1])} above it)`);
        if (good) landed++;
        tried.push(`${pi}: ${t}`);
      }
      ok(landed >= 8, `landed on ${landed} pads (${tried.join(', ')})`);
      // boarding at a pad frees it and resets the speed / pitch
      const lastPad = N.pad;
      P.x = R.x + 4; P.z = R.z; P.y = R.y; tick(I, 2); press(I, 'ControlLeft');
      ok(N.state === -1 && !G.pads[lastPad].taken && N.pitchRate === -0.019999999552965164 && N.pitchDir === 1, `boarding on pad ${lastPad} frees it, pitch rate -0.02`);
      notes.push(`Ptera: airborne after ${tOff} ticks, landings ${tried.join(' ')}`);

      // ------------------------------------------------------------------ exit through the air portal PORA
      {
        const J = loadIsland(ctx, { node: 52 });
        const W2 = J.world, R2 = J.rec('PTER'), N2 = R2.ctrl.find('Ptera'), A = J.rec('PORA');
        tick(J, 2);
        J.pepper.x = R2.x + 4; J.pepper.z = R2.z; J.pepper.y = R2.y;
        tick(J, 2); press(J, 'ControlLeft'); tick(J, 80);
        // aim at the portal from 60 away at its height
        const dx = A.x - R2.x, dz = A.z - R2.z, yaw = Math.atan2(dx, dz);
        R2.setEuler(0, yaw, 0, A.x - Math.sin(yaw) * 60, A.y, A.z - Math.cos(yaw) * 60); R2.rx = 0; R2.ry = yaw; R2.rz = 0; N2.speed = 1; N2.state = 0;
        let hit = -1;
        tick(J, 90, (i) => { if (hit < 0 && W2.vars.get(5) === 10) hit = i; });
        ok(hit > 0 && W2.vars.get(0xbb) === 2, `flying into PORA: var 5 = ${W2.vars.get(5)} (tick ${hit}), PORTAL_VEHICLE ${W2.vars.get(0xbb)} (= PTER in row 2)`);
      }

      // ------------------------------------------------------------------ arrival in the Ptera (prev zone 10, var 0xbb = 2)
      {
        const J = loadIsland(ctx, { node: 52 });
        const W2 = J.world, R2 = J.rec('PTER'), N2 = R2.ctrl.find('Ptera');
        const a = arrival(10, 52, (i) => [W2.records[i].x, W2.records[i].y, W2.records[i].z], (n) => waypoints.nodePos(1, n), PTERA_RECORD);
        ok(a && a.vehicle === PTERA_RECORD && a.control === 0x40, `arrival from zone 10 with var 0xbb = 2: record ${a?.vehicle}, PEPPER_CONTROL 0x${a?.control.toString(16)}`);
        // what the zone game's afterSetup does (src/zones/z02LGI/index.ts)
        R2.x = a.pos[0]; R2.y = a.pos[1]; R2.z = a.pos[2]; R2.ry = a.yaw; R2.rebuildYaw();
        W2.vars.set(0x5e, 0x40); vehicles(W2).current = R2;
        tick(J, 1);
        ok(N2.state <= 0 && R2.anim.clip === 1 && G2c(W2) === R2, `first tick: the Ptera takes off with Pepper (state ${N2.state}, clip ${R2.anim.clip})`);
        tick(J, 120);
        ok(N2.state === 0 && Math.hypot(J.pepper.x - R2.x, J.pepper.z - R2.z) < 1e-3 && (W2.vars.get(0x5e) & 0xfff) === 0x40, `then flies with Pepper on it (state ${N2.state})`);
      }

      // ------------------------------------------------------------------ the glider (no animation instance)
      {
        const J = loadIsland(ctx, { node: 61 });
        const W2 = J.world, P2 = J.pepper, D = J.rec('GLDR'), N2 = D.ctrl.find('Ptera'), G2 = vehicles(W2);
        tick(J, 2);
        ok(N2.state === 3 && !D.anim, 'glider parked, no animation instance');
        P2.x = D.x + 4; P2.y = D.y; P2.z = D.z - 3;
        tick(J, 2); press(J, 'ControlLeft');
        ok(G2.current === D && (W2.vars.get(0x5e) & 0xfff) === 0x40 && P2.anim.clip === 0x114, `Ctrl: on the glider (clip 0x${P2.anim.clip.toString(16)})`);
        tick(J, 150);
        const seat = D.toWorld([0, -5.5, -0.5]);
        ok(N2.state === 0 && W2.vars.get(0xc5) === 6 && Math.hypot(P2.x - seat[0], P2.y - seat[1], P2.z - seat[2]) < 1e-3, `glider flying, PEPPERSSHADOW 6, Pepper hangs 5.5 below it`);
        const parts = baseParts(W2, D);
        const live = partOverrides(W2, D);
        ok(!parts || parts.length <= 2 || (live && live.has(2) && N2.prop !== 0), `propeller (part 2 of ${parts?.length ?? 0}) turns: ${N2.prop.toFixed(2)}`);
        hold(J, ['ArrowRight'], 30);
        ok(N2.yawRate > 0.04 && finite(D) && finite(P2), 'the glider turns right, no NaN');
      }
    } finally { setAmbientRandom(null); }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
