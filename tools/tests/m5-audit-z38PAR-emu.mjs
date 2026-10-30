import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { ParEmu } from '../lib/m5-par-emu.mjs';
import { parBotStep } from '../lib/par-bot.mjs';
import { startParRun, parSnapshot } from '../../src/zones/z38PAR.ts';
import { ParHud } from '../../src/zones/parachute/par-hud.ts';
import { PAR_SOUNDS } from '../../src/zones/parachute/par-run.ts';
import { setRandomSource, segmentHitsRecordBox } from '../../src/zones/parachute/util.ts';
import { shadowPoints } from '../../src/zones/parachute/apo-pilot.ts';
import { B } from '../../src/game/input.ts';
import { NODE_STOP } from '../../src/game/controller.ts';

// z38PAR, M5 audit, ORACLE test: the original's pilot (constructor FUN_0046a926, update FUN_004686a3 with the dive, the parachute, the three rings, the landing score, the bounce, the
// wind and the camera) and the HUD feed FUN_00466f50 are executed in the x86 interpreter (tools/lib/m5-par-emu.mjs) next to the TypeScript `ParPilot` + `ParHud`. Both get the same
// buttons and the same random numbers and the pilot node, the run globals, the pilot's matrix and Euler angles, the camera, the animation, the visibility of the rings / targets /
// shadow and every sound / speech call are compared tick by tick over whole jumps. The engine's collision queries (sweep, probe, the ground ray, the pterodactyl box) are answered by the
// port's own code in both: they are not verified here.

const f32 = Math.fround;
const shTmp = new Float32Array(15);
const gen = (a, b) => { let s = (Math.imul(a + 1, 2654435761) ^ Math.imul(b + 7, 40503)) >>> 0; s = (Math.imul(s ^ (s >>> 15), 2246822519)) >>> 0; s = (Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0; return ((s ^ (s >>> 16)) >>> 0) / 4294967296; };
const SOUND_ID = (n) => PAR_SOUNDS[n].id;
const SOUND_3D = (n) => PAR_SOUNDS[n].kind === '3d';

export default {
  name: 'm5-audit-z38PAR-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const bad = (m) => { if (failures.length < 12) failures.push(m); else if (failures.length === 12) failures.push('... more'); };
    const pe = loadExe(ctx.dataRoot);

    const scenario = (label, seed, player, ticks) => {
      const f0 = failures.length;
      // ---- the port
      let inPilot = false, nIn = 0, nOut = 0, tickNo = 0, initFrac = 0;
      setRandomSource(() => (inPilot ? gen(tickNo, nIn++) : (tickNo === 0 && nOut === 0 ? (initFrac = gen(seed, 99)) : gen(tickNo + 100000, nOut++))));
      const L = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) });
      const w = L.world;
      const run = startParRun(w, L.archive);
      const pepp = run.recs.pepp, pilot = pepp.ctrl.find('ParPilot');
      const hud = new ParHud();
      const spoken = [];
      run.say = (id) => spoken.push(`say ${id}`);
      // ---- the oracle: its own world (records, animation), the collision answered by the port's world
      const L2 = loadZone(ctx, 'z38PAR', { pe: loadExe(ctx.dataRoot) });
      const R2 = L2.world.records;
      const recs = R2.map((r) => ({ name: r.name, m: Array.from(r.m), flags: r.flags, rx: r.rx, ry: r.ry, rz: r.rz }));
      let oracleFrac = () => initFrac;
      const rec = (i) => w.records[i];
      const col = {
        sweep: (i, from, delta, mask, r, s) => { const h = w.col.sweep(rec(i), from, delta, mask, r, s); return h ? { rec: h.rec.name, recIdx: h.rec.index, point: h.point, normal: h.normal } : null; },
        probe: (i, from, delta, mask) => { const h = w.col.probe(rec(i), from, delta, mask); return h ? { rec: h.rec.name, recIdx: h.rec.index, point: h.point, normal: h.normal } : null; },
        // FUN_00442a70 = the centre ray plus the four corner rays of the blob shadow (`shadowPoints`, which the port's pilot runs too: M7 oracle, the corner rays move the engine's hit cache); the host
        // hands the lib the centre point (pts[3..5] with the lift of 0.4 * 8 taken off pts[4] again)
        ground: (i) => { const p = rec(i); const pts = shadowPoints(w, p, run.recs.land, 2.0, 0.4, shTmp); return pts ? [pts[3], pts[4] - f32(f32(0.4) * 8), pts[5]] : null; },
        box: (i, a, b, op, on) => segmentHitsRecordBox(rec(i), a, b, op, on),
      };
      const emu = new ParEmu(pe, recs, new Map([[pepp.index, R2[pepp.index].anim]]), { rand: (range) => (Math.floor(oracleFrac() * 32768) / 32767) * range, col });
      emu.construct(pepp.index);
      const mem = emu.cpu.mem, N = emu.node;
      const nf = (o) => mem.f32(N + o), ni = (o) => mem.r32(N + o);
      const worst = {};
      const num = (tick, name, orig, port, tol = 2e-5) => { checked++; const d = Math.abs(orig - port); worst[name] = Math.max(worst[name] ?? 0, d); if (!(d <= tol * Math.max(1, Math.abs(orig)))) bad(`${label}: tick ${tick} ${name}: original ${orig} port ${port}`); };
      const eq = (tick, name, orig, port) => { checked++; if (JSON.stringify(orig) !== JSON.stringify(port)) bad(`${label}: tick ${tick} ${name}: original ${JSON.stringify(orig)} port ${JSON.stringify(port)}`); };
      // the oracle's camera starts where the port's does (FUN_00422b50 / the loop's set-up are not run here)
      for (let k = 0; k < 9; k++) mem.wf32(0x9da5e8 + 4 * k, w.camera.c[k]);
      const recPtr = (i) => emu.recPtr(i);
      const compareInit = () => {
        num(-1, 'start y', mem.f32(recPtr(pepp.index) + 0x40), pepp.y); num(-1, 'windDir', mem.f32(0x5d57d04), run.windDir);
        for (const t of run.recs.targets) eq(-1, `${t.name} hidden`, (mem.r16(recPtr(t.index) + 0x60) & 2) !== 0, t.enabled);
        eq(-1, 'shadow hidden', (mem.r16(recPtr(run.recs.shad.index) + 0x60) & 2) !== 0, run.recs.shad.enabled);
        eq(-1, 'fourth bird hidden', (mem.r16(recPtr(run.recs.birds[3].index) + 0x60) & 2) !== 0, run.recs.birds[3].enabled);
      };
      compareInit();
      // ---- the patched update: the oracle runs on the state the port's pilot is about to see, then the port's pilot, then the comparison
      const orig = pilot.update.bind(pilot);
      let tickLog = ''; const hist = [];
      const stats = { sounds: 0, states: new Set() };
      pilot.update = (ww, r) => {
        run.sound.log.length = 0; spoken.length = 0;
        for (let i = 0; i < ww.records.length; i++) {
          if (i === pepp.index) continue;
          const a = recPtr(i);
          for (let k = 0; k < 16; k++) mem.wf32(a + 0xc + 4 * k, ww.records[i].m[k]);
        }
        // oracle first (the collision answers come from the port's world before the port's pilot moves)
        nIn = 0; inPilot = true;
        const myFracs = []; for (let n = 0; n < 40; n++) myFracs.push(gen(tickNo, n));
        let di = 0; oracleFrac = () => myFracs[di++];
        const held = ww.input.held, pressed = ww.input.pressed;
        const olog = emu.tick(pepp.index, held, pressed);
        const oCalls = di;
        di = 0;
        nIn = 0;
        const res = orig(ww, r);
        inPilot = false;
        const t = tickNo;
        eq(t, 'random calls', oCalls, nIn);
        // sounds / speech: the port's bank log (names) against the original's calls (ids)
        const portEv = [];
        for (const e of run.sound.log) {
          const id = SOUND_ID(e.name);
          if (e.op === 'play') portEv.push(`p ${id}`); else if (e.op === 'stop') portEv.push(`s ${id}`); else if (e.op === 'rate') portEv.push(`r ${id} ${e.hz}`);
          else if (e.op === 'at') portEv.push(`p3 ${id} ${e.pos.map((v) => v.toFixed(2)).join(',')}`);
        }
        const orgAll = olog.filter((e) => !/^(anim|sweep|probe|ground|box) /.test(e));
        const orgSpeech = orgAll.filter((e) => e.startsWith('say ')), orgEv = orgAll.filter((e) => !e.startsWith('say '));
        eq(t, 'speech', orgSpeech, spoken);          // (the port logs speech apart from the sounds: their relative order is not compared)
        // the order of the calls inside one tick is the same; speech lines are queued at the same places
        // (positions / pitches are compared with a tolerance: the original keeps float32 locals, the port computes in double and rounds on store)
        const evKey = (e) => e.replace(/-?\d+\.\d+/g, 'N').replace(/^r (\d+) \d+$/, 'r $1 N');
        checked++;
        if (JSON.stringify(orgEv.map(evKey)) !== JSON.stringify(portEv.map(evKey))) bad(`${label}: tick ${t} sounds / speech: original ${JSON.stringify(orgEv)} port ${JSON.stringify(portEv)}`);
        else for (let i = 0; i < orgEv.length; i++) {
          const a = orgEv[i].match(/-?\d+(\.\d+)?/g).map(Number), b = portEv[i].match(/-?\d+(\.\d+)?/g).map(Number);
          const tol = orgEv[i].startsWith('r ') ? 2 : 0.06;
          checked++;
          if (a.some((v, k) => Math.abs(v - b[k]) > tol)) bad(`${label}: tick ${t} sound args: original ${orgEv[i]} port ${portEv[i]}`);
        }
        stats.sounds += orgEv.length;
        // node
        eq(t, 'state', ni(0x30), pilot.state); eq(t, 'steerDir', ni(0x34), pilot.steerDir); eq(t, 'landed', ni(0x38) !== 0, pilot.landed); eq(t, 'crashed', ni(0x3c) !== 0, pilot.crashed);
        num(t, 'yawRate', nf(0x40), pilot.yawRate); num(t, 'fallTarget', nf(0x44), pilot.fallTarget); num(t, 'fall', nf(0x4c), pilot.fall); num(t, 'fwd', nf(0x50), pilot.fwd);
        num(t, 'windX', nf(0x54), pilot.windX); num(t, 'windZ', nf(0x58), pilot.windZ); num(t, 'camLerp', nf(0x5c), pilot.camLerp);
        for (let k = 0; k < 3; k++) { num(t, `camOff${k}`, nf(0x60 + 4 * k), pilot.camOff[k]); num(t, `bounce${k}`, nf(0x78 + 4 * k), pilot.bounce[k]); }
        // the run globals
        num(t, 'score', mem.f32(0x5d57d28), run.score, 1e-6); num(t, 'windDir', mem.f32(0x5d57d04), run.windDir); num(t, 'y', mem.f32(0x5d57d08), run.y); num(t, 'height', mem.f32(0x5d57d24), run.height);
        num(t, 'groundY', mem.f32(0x5d57db8), run.groundY);
        for (let k = 0; k < 3; k++) eq(t, `ring${k + 1}`, mem.r32(0x5d57d14 + 4 * k), run.ring[k]);
        eq(t, 'canopy', mem.r32(0x5d57d30), run.canopy); eq(t, 'shadowOn', mem.r32(0x5d57de4) !== 0, run.shadowOn); eq(t, 'over', mem.r32(0x5d57d2c) !== 0, run.over);
        eq(t, 'landScore', mem.r32(0x5d57d34), run.landScore); eq(t, 'landBonus', mem.r32(0x5d57d20), run.landBonus);
        // the pilot's record, the camera, the animation
        const pa = recPtr(pepp.index);
        for (let k = 0; k < 16; k++) num(t, `PEPP.m${k}`, mem.f32(pa + 0xc + 4 * k), pepp.m[k], 1e-4);
        num(t, 'PEPP.rx', mem.f32(pa + 0x4c), pepp.rx); num(t, 'PEPP.ry', mem.f32(pa + 0x50), pepp.ry); num(t, 'PEPP.rz', mem.f32(pa + 0x54), pepp.rz);
        for (let k = 0; k < 6; k++) num(t, `camera${k}`, mem.f32(0x9da5e8 + 4 * k), ww.camera.c[k], 1e-4);
        const oa = R2[pepp.index].anim;
        eq(t, 'anim clip', oa.clip, pepp.anim.clip); num(t, 'anim frame', oa.frame, pepp.anim.frame);
        for (const q of [...run.recs.rings, ...run.recs.targets, run.recs.birds[3]]) eq(t, `${q.name}${q.index} enabled`, (mem.r16(recPtr(q.index) + 0x60) & 2) !== 0, q.enabled);
        stats.states.add(pilot.state);
        hist.push(`t${t} held ${held} orig[state ${ni(0x30)} y ${mem.f32(pa + 0x40).toFixed(4)} height ${mem.f32(0x5d57d24).toFixed(4)} fall ${nf(0x4c).toFixed(4)} gY ${mem.f32(0x5d57db8).toFixed(4)} log ${olog.filter((e) => /sweep|probe|ground/.test(e)).join('|')}] port[state ${pilot.state} y ${pepp.y.toFixed(4)} height ${run.height.toFixed(4)} fall ${pilot.fall.toFixed(4)} gY ${run.groundY.toFixed(4)}]`); if (hist.length > 6) hist.shift();
        return res;
      };
      // ---- the jump
      let finished = -1;
      for (tickNo = 0; tickNo < ticks && failures.length === f0; tickNo++) {
        const snap = parSnapshot(w);
        const mask = player(snap, tickNo);
        w.input.setVirtual(mask);
        w.tick();
        if (failures.length > f0) break;
        // the HUD feed after the update: the original's FUN_00466f50 (native) against ParHud (the port)
        emu.hud();
        const fr = hud.update(run, pepp.ry);
        const t = tickNo;
        eq(t, 'HUD chuteOk', mem.r32(0x5d57d10) !== 0, run.chuteOk); num(t, 'HUD refAlt', mem.f32(0x5d57d00), run.refAlt);
        eq(t, 'HUD text', mem.cstr(0x5d4dd60), fr.text); eq(t, 'HUD compass', mem.r32(0x5d4dd14), fr.compass);
        eq(t, 'HUD rings', [mem.r32(0x5d4e144), mem.r32(0x5d4e14c), mem.r32(0x5d4e154)], fr.rings); eq(t, 'HUD chute icon', mem.r32(0x5d4dd38), fr.chuteIcon);
        if (pilot.state === 5 && finished < 0) finished = tickNo;
        if (finished >= 0 && tickNo > finished + 40) break;
      }
      if (failures.length > f0 && process.env.PAR_HIST) notes.push(...hist);
      if (process.env.PAR_WORST) notes.push(`${label} worst: ${Object.entries(worst).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v.toExponential(1)}`).join(', ')}`);
      const sn = parSnapshot(w);
      notes.push(`${label}: ${tickNo} ticks, states ${[...stats.states].sort().join('')}, rings ${run.ring.join('')}, score ${Math.trunc(run.score)}, landed ${pilot.landed}, finished at ${finished}, ${stats.sounds} sound calls, unhooked ${JSON.stringify([...emu.unhooked].map(([a, n]) => `${a.toString(16)}x${n}`))}, final (${sn.pepper.x.toFixed(0)}, ${sn.pepper.y.toFixed(0)}, ${sn.pepper.z.toFixed(0)})`);
    };

    const bot = (plan) => (snap) => parBotStep(snap, plan);
    const mashG = (a) => { let n = 0; return () => { n++; const r = gen(a, n); return (r < 0.3 ? B.UP : r < 0.5 ? B.DOWN : 0) | (gen(a + 1, n >> 3) < 0.4 ? B.LEFT : gen(a + 1, n >> 3) < 0.7 ? B.RIGHT : 0) | (gen(a + 2, n) < 0.03 ? B.SHIFT : 0); }; };
    scenario('bot, rings 3-2-1, land on target 3', 1, bot({}), 4200);
    scenario('bot, rings 3-1, land on target 1', 2, bot({ rings: [3, 1], land: 1 }), 4200);
    scenario('bot, no chute (crash)', 3, bot({ noChute: true }), 4200);
    scenario('bot, no dive', 4, bot({ dive: false, land: 2 }), 4200);
    scenario('mash', 5, mashG(7), 4200);
    scenario('mash 2', 6, mashG(11), 4200);
    setRandomSource(null);
    return { checked, failures, notes };
  },
};
