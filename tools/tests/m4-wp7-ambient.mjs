import { loadIsland, tick, press } from '../lib/island-load.mjs';
import { setAmbientRandom, islandRigs, islandSoundHandles, cueTable, DirectorState, directorTick, musicKeysFor, MUSIC_BUILDINGS } from '../../src/island/ambient/index.ts';
import { animalGlobals, BSpline } from '../../src/island/ambient/animals.ts';
import { partMatrix } from '../../src/island/trigger/parts.ts';

// WP7 (src/island/ambient): the island's animals, Spin, Brikimal, Music and the director on the real island world (docs/re/m4/wp7-ambient.md).
export default {
  name: 'm4-wp7-ambient',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };
    let seed = 12345;
    setAmbientRandom(() => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 8) / 16777216; });
    const fin = (r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z);
    const node = (r, kind) => r?.ctrl?.nodes.find((n) => n.kind === kind);

    // ------------------------------------------------------------------ data read from the executable
    const I = loadIsland(ctx, { node: 2 });
    const w = I.world;
    const rigs = islandRigs(I.pe);
    ok(rigs.get(65) === 'RBBT' && rigs.get(60) === 'SWFT' && rigs.get(66) === 'PTER' && rigs.get(10) === 'MFIG' && rigs.get(9) === 'SKBD', `loader rigs: 9 ${rigs.get(9)} 10 ${rigs.get(10)} 60 ${rigs.get(60)} 65 ${rigs.get(65)} 66 ${rigs.get(66)}`);
    ok(rigs.size === 58, `58 records get an animation instance in the loader (${rigs.size})`);
    const H = islandSoundHandles(I.pe);
    ok(H.get(0x05d58138)?.id === 0x103 && H.get(0x05d581e8)?.id === 0xfd && H.get(0x05d580f0)?.id === 0x364, `sound handles (bunny 0x103, swift 0xfd, brikimal 0x364): ${H.get(0x05d58138)?.id} ${H.get(0x05d581e8)?.id} ${H.get(0x05d580f0)?.id}`);
    ok(H.get(0x05d58214)?.id === 0x339 && H.get(0x05d582b4)?.id === 0x384, `cue handle list copied (0x339 .. 0x384): ${H.get(0x05d58214)?.id} ${H.get(0x05d582b4)?.id}`);
    const cues = cueTable(I.pe);
    ok(cues.length === 33 && cues[0].v === 0xbf && cues[0].sound === 0x33a && cues[0].record === 10, `cue table: ${cues.length} entries, first ${JSON.stringify(cues[0])}`);
    notes.push(`island sound ids preloaded by FUN_004b037e: ${[...new Set([...H.values()].map((h) => h.id))].map((x) => x.toString(16)).join(' ')}`);

    // ------------------------------------------------------------------ the constructors are registered: the nodes are on their records
    for (const [n, k] of [['RBT0', 'Bunny'], ['BFS0', 'Butterfly'], ['BFG3', 'Butterfly'], ['SFT9', 'SwiftLeader'], ['SFT9', 'Swift'], ['SFT3', 'Swift'], ['PORA', 'Spin'], ['SEAE', 'SeaAmin'], ['BML1', 'Brikimal'], ['PEPP', 'Music'], ['HSE2', 'Sound3d']]) {
      ok(!!node(I.rec(n), k), `${n} has a ${k} node`);
    }
    const left = [...new Set(I.L.skipped.map((s) => s.ctorName ?? s.ctor.toString(16)))];
    notes.push(`still skipped at node 2: ${left.join(',')}`);

    // ------------------------------------------------------------------ bunnies, butterflies, swifts over 1800 ticks
    const bunnies = I.recs('RBT0').concat(I.recs('RBT1'), I.recs('RBT2'), I.recs('RBT3'), I.recs('RBT4'));
    const bf = I.world.records.filter((r) => /^BF[SG]\d$/.test(r.name));
    const sw = I.world.records.filter((r) => /^SFT\d$/.test(r.name));
    const home = new Map(bunnies.concat(bf, sw).map((r) => [r, [r.x, r.y, r.z]]));
    const states = new Map(bunnies.map((r) => [r, new Set()]));
    let maxBunnyAway = 0, maxBunnyGround = 0, bunnyBurrow = 0, maxBfAway = 0, maxBfDy = 0, swiftMin = 1e9, swiftMax = 0, nan = 0;
    const spin = I.rec('PORA'), rx0 = spin.rx;
    tick(I, 1800, () => {
      for (const r of bunnies) {
        const b = node(r, 'Bunny');
        states.get(r).add(b.state);
        if (!fin(r)) nan++;
        const h = home.get(r);
        maxBunnyAway = Math.max(maxBunnyAway, Math.hypot(r.x - h[0], r.z - h[2]));
        if (b.state === 2) { const g = w.col.terrainHeight(r.x, r.y, r.z, 8); if (g > -1e30) maxBunnyGround = Math.max(maxBunnyGround, Math.abs(r.y - g)); }
        if (b.state >= 3 && b.state <= 5) bunnyBurrow++;
      }
      for (const r of bf) {
        if (!fin(r)) nan++;
        const n = node(r, 'Butterfly');
        maxBfAway = Math.max(maxBfAway, Math.hypot(r.x - n.home[0], r.z - n.home[2]));
        maxBfDy = Math.max(maxBfDy, r.y - n.home[1]);
      }
      const L = node(I.rec('SFT9'), 'SwiftLeader');
      for (const r of sw) {
        if (!fin(r)) nan++;
        if (w.tickCount > 600) { const d = Math.hypot(r.x - L.target[0], r.y - L.target[1], r.z - L.target[2]); swiftMin = Math.min(swiftMin, d); swiftMax = Math.max(swiftMax, d); }
      }
    });
    ok(nan === 0, `no NaN positions (${nan})`);
    const allStates = new Set(); for (const s of states.values()) for (const x of s) allStates.add(x);
    ok(allStates.has(0) && allStates.has(1) && allStates.has(2), `bunny states cycle: ${[...allStates].sort().join(',')}`);
    ok(bunnies.every((r) => states.get(r).size >= 2), `every bunny changes state (${bunnies.map((r) => [...states.get(r)].join('')).join(' ')})`);
    ok(maxBunnyAway < 45, `bunnies stay near home (max ${maxBunnyAway.toFixed(1)} units; range 2.2 .. 3.2 * 8)`);
    ok(maxBunnyGround < 2.5, `hopping bunnies stay on the ground (max |y - terrain| ${maxBunnyGround.toFixed(2)})`);
    notes.push(`bunny ticks in burrow states: ${bunnyBurrow}`);
    ok(maxBfAway < 40, `butterflies stay near home (max ${maxBfAway.toFixed(1)}; range 16 / 24)`);
    ok(maxBfDy < 9, `butterflies fly at most ~6 above home (max ${maxBfDy.toFixed(2)})`);
    ok(node(I.rec('SFT9'), 'SwiftLeader').state === 4, 'the swift leader follows the spline (state 4)');
    ok(swiftMax < 120, `swifts circle the spline point (distance ${swiftMin.toFixed(1)} .. ${swiftMax.toFixed(1)})`);
    ok(I.ictx.sounds.some((s) => s.id === 0xfd), 'the swift flock plays sound 0xfd');
    ok(Math.abs(spin.rx - rx0) > 0.1, `PORA spins (rx ${rx0.toFixed(3)} -> ${spin.rx.toFixed(3)})`);
    // spline: the B-spline through swift.man
    {
      const e = I.archive.find('MatAnim/swift.man');
      const s = BSpline.fromMan(I.archive.read(e));
      const p0 = s.point(0), p1 = s.point(0.999);
      ok(s.n === 37 && Math.abs(p0[0] - 74.86) < 15 && Number.isFinite(p1[0]), `swift spline: ${s.n} points, p(0) ${p0.map((x) => x.toFixed(1))}, p(1) ${p1.map((x) => x.toFixed(1))}`);
    }

    // ------------------------------------------------------------------ Shift near a bunny: startled (state 6, sound 0x103 at Pepper)
    {
      const r = I.rec('RBT2'), b = node(r, 'Bunny'), p = I.pepper;
      for (let i = 0; i < 400 && b.state >= 4; i++) tick(I, 1);
      p.x = r.x + 3; p.z = r.z; p.y = r.y;
      const n0 = I.ictx.sounds.length;
      press(I, 'ShiftLeft');
      const snd = I.ictx.sounds.slice(n0).find((s) => s.id === 0x103);
      ok(b.state === 6 || b.saved !== undefined && snd, `Shift next to a bunny startles it (state ${b.state})`);
      ok(!!snd, 'startle sound 0x103 at Pepper');
      // five at once: SWITCH_GME_LGI_EXTRA_SCOREITEMS bit 1 and +1000 score
      const s0 = w.vars.get(0xa6);
      animalGlobals(w).pokes = 5;
      tick(I, 1);
      ok((w.vars.get(0xbd) & 1) === 1 && w.vars.get(0xa6) === s0 + 1000, `five startled bunnies: extra score (0xbd ${w.vars.get(0xbd)}, score ${s0} -> ${w.vars.get(0xa6)})`);
    }

    // ------------------------------------------------------------------ Shift near a butterfly: it follows Pepper
    {
      const r = I.rec('BFS0'), b = node(r, 'Butterfly'), p = I.pepper;
      tick(I, 10);
      p.x = r.x + 2; p.z = r.z; p.y = r.y - 1;
      press(I, 'ShiftLeft');
      ok(b.follow === p, 'a butterfly follows Pepper after Shift');
      tick(I, 200);
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      ok(d < 20, `... and stays near her (${d.toFixed(1)})`);
    }

    // ------------------------------------------------------------------ Brikimal: the shape var counts up every 300 ticks
    {
      const r = I.rec('BML1'), b = node(r, 'Brikimal');
      const v0 = w.vars.get(0xc3);
      tick(I, 310 - (b.morphT | 0));
      ok(w.vars.get(0xc3) === ((v0 + 1) & 7) || w.vars.get(0xc3) === (v0 < 7 ? v0 + 1 : 0), `BML1 var 0xc3 ${v0} -> ${w.vars.get(0xc3)}`);
      ok(I.ictx.sounds.some((s) => s.id === 0x364), 'morph sound 0x364');
      ok(fin(r) && r.y > w.seaLevel - 1, `BML1 on the ground (${r.y.toFixed(1)})`);
    }

    // ------------------------------------------------------------------ Music: the segment by distance to the buildings
    {
      const J = loadIsland(ctx, { node: 2 });
      const played = [], grooves = [];
      let notif = [];
      Object.assign(J.ictx, { music: (k) => played.push(k), musicGroove: (g) => grooves.push(g), musicNotified: () => notif.shift() ?? 0, ambience: (n) => played.push('amb:' + n) });
      const p = J.pepper;
      const far = [0, 13, -700];
      p.x = far[0]; p.z = far[2];
      tick(J, 2);
      ok(played.includes('amb:LGIBirds') && played.includes('Z02LGIT'), `node 2 far from the buildings: LGIBirds + Z02LGIT (${played.join(' ')})`);
      for (const b of MUSIC_BUILDINGS) {
        const r = J.world.records[b.record];
        p.x = r.x + 10; p.z = r.z + 10;
        tick(J, 2);   // the controller distances are one frame old (FUN_0042377a)
        ok(played[played.length - 1] === b.key, `within 40 of ${b.name}: ${b.key} (${played[played.length - 1]})`);
      }
      p.x = far[0]; p.z = far[2]; tick(J, 2);
      ok(played[played.length - 1] === 'Z02LGIT', `away again: Z02LGIT (${played[played.length - 1]})`);
      // a notification switches to the main theme (LGIM), the next one back to LGIT
      const m = J.pepper.ctrl.nodes.find((n) => n.kind === 'Music');
      tick(J, 130);
      notif = [1]; tick(J, 2);
      ok(m.sub === 1 && played[played.length - 1] === 'Z02LGIM', `notification: main theme (sub ${m.sub}, ${played[played.length - 1]})`);
      notif = [0]; tick(J, 250); notif = [1]; tick(J, 2);
      ok(m.sub === 0 && played[played.length - 1] === 'Z02LGIT', `next notification: town theme (sub ${m.sub}, ${played[played.length - 1]})`);
      ok(JSON.stringify(musicKeysFor(10)) === '["bbotsM"]' && musicKeysFor(0x38)[0] === 'radio' && musicKeysFor(0x40).includes('Z02Papa'), 'keys per story node');
    }
    {
      const K = loadIsland(ctx, { node: 0x38 });
      const played = [];
      K.ictx.music = (k) => played.push(k);
      tick(K, 3);
      ok(played[0] === 'radio' && played.length === 1, `node 0x38: radio only (${played.join(' ')})`);
    }

    // ------------------------------------------------------------------ the director reacts to the switch variables
    {
      const D = loadIsland(ctx, { node: 2 });
      D.ictx.scene = D.scene;
      // WP4 registers its own port of the same update (src/island/trigger/lgifsm.ts): take it off PIZ4 so only directorTick runs here
      for (const r of D.world.records) if (r.ctrl) r.ctrl.nodes = r.ctrl.nodes.filter((n) => n.kind !== 'LGI_FSM');
      const dw = D.world, st = new DirectorState();
      const run = (n) => tick(D, n, () => directorTick(dw, st));
      run(1);
      // a sound cue: SWITCH_GME_CSM_SFX1 (0xbf) = 1 -> sound 0x33a at record 10, var 2; 4 -> every tick; 8 -> stop, var 2
      D.ictx.sounds.length = 0;
      dw.vars.set(0xbf, 1); run(1);
      const s = D.ictx.sounds.find((x) => x.id === 0x33a);
      ok(!!s && dw.vars.get(0xbf) === 2 && Math.abs(s.pos[0] - dw.records[10].x) < 1e-3, `cue 0xbf=1: sound 0x33a at BRIK, var -> ${dw.vars.get(0xbf)}`);
      dw.vars.set(0xbf, 4); D.ictx.sounds.length = 0; run(3);
      ok(D.ictx.sounds.filter((x) => x.id === 0x33a).length === 3, 'cue value 4 plays every tick');
      dw.vars.set(0xbf, 8); run(1);
      ok(D.ictx.stopped.includes(0x33a) && dw.vars.get(0xbf) === 2, 'cue value 8 stops the sound');
      // INFC windows: SWITCH_LGI_CSM_FX_SWITCH00 = 1: open, bounce at 1.8, close, var back to 0
      const vWin = D.ictx.switchVar('SWITCH_LGI_CSM_FX_SWITCH00');
      ok(vWin === 0x106, `SWITCH_LGI_CSM_FX_SWITCH00 = var 0x${vWin?.toString(16)}`);
      const m1 = partMatrix(dw, dw.records[124], 1);
      dw.vars.set(vWin, 1);
      const seq = [];
      for (let i = 0; i < 200 && (i === 0 || dw.vars.get(vWin) !== 0); i++) { run(1); seq.push(dw.vars.get(vWin)); }
      ok(dw.vars.get(vWin) === 0 && seq.includes(2) && seq.includes(3), `windows: var 1 -> 2 -> 3 -> 0 in ${seq.length} ticks`);
      ok(!m1 || Number.isFinite(m1[0]), `INFC window part matrix ${m1 ? 'animated' : 'not available (no MATL)'}`);
      ok(D.ictx.sounds.some((x) => x.id === 0x33e), 'window sound 0x33e');
      // the wormhole scales in (node < 7: SWITCH_LGI_CSM_FX_SWITCH04)
      const vW = D.ictx.switchVar('SWITCH_LGI_CSM_FX_SWITCH04'), worm = dw.records[370];
      ok(!worm.enabled, 'WORM hidden by the constructor');
      dw.vars.set(vW, 1); run(1); run(15);
      ok(worm.enabled && st.scale > 0.4 && st.scale < 0.6, `wormhole scaling in (${st.scale.toFixed(3)})`);
      run(20);
      ok(st.scale === 1 && dw.vars.get(vW) === 0, `wormhole full size, var 0 (${st.scale}, ${dw.vars.get(vW)})`);
      dw.vars.set(vW, 3); run(1);
      ok(!worm.enabled && dw.vars.get(vW) === 0, 'value 3 hides the wormhole');
      // the jail door and the rotor
      const vJ = D.ictx.switchVar('SWITCH_LGI_CSM_FX_SWITCH01');
      dw.vars.set(vJ, 1); run(1);
      ok(dw.vars.get(vJ) === 2, 'jail door opening');
      run(20);
      ok(dw.vars.get(vJ) === 0 && Math.abs(st.jail - 1.9) < 0.11, `jail door open (${st.jail.toFixed(2)})`);
      dw.vars.set(D.ictx.switchVar('SWITCH_LGI_PHEL_ROTOR_SPEED'), 5); const r0 = st.rotor; run(10);
      ok(Math.abs(st.rotor - r0 - 5) < 1e-6, `rotor turns 0.5 per tick at speed 5 (${(st.rotor - r0).toFixed(3)})`);
      // the two rocket01 emitters (era 0: slot 0 / 1) at the feet of record 0x11 (bit 4, start bit 0x1000) and the stop bit 0x80: gates (2, 1, 1) / (1, 1, 1) on the set-up's handles
      const vR = D.ictx.switchVar('SWITCH_LGI_CSM_FX_SWITCH02');
      D.ictx.fx.clear();
      dw.vars.set(vR, 0x1004); run(1);
      const gates = (g) => D.ictx.fx.log.filter((f) => f.op === 'gate' && f.name === 'rocket01.par' && f.gate.join() === g).length;
      ok(gates('2,1,1') === 2 && dw.vars.get(vR) === 0x4, `rockets on (var ${dw.vars.get(vR).toString(16)})`);
      dw.vars.set(vR, 0x84); run(1);
      ok(gates('1,1,1') === 2, 'rockets off with 0x80');
      // SWITCH_LGI_CSM_FX_SWITCH11: Papa / Mama / BBT0 / BBT1 non-solid
      dw.vars.set(D.ictx.switchVar('SWITCH_LGI_CSM_FX_SWITCH11'), 1); run(1);
      ok([12, 13, 17, 18].every((i) => dw.records[i].flags & 0x10), 'FX_SWITCH11 = 1: four records non-solid');
    }
    setAmbientRandom(null);
    return { checked, failures, notes };
  },
};
