import { loadFsh, createHarness, attachMirrors, runConstructors, emuPass, snapshotWorld, restoreWorld, f32, FN } from '../lib/m7-z21FSH-emu.mjs';
import { readTables } from '../../src/zones/z21fsh/nodes.ts';
import { REC, ST, CAST, K, BTN } from '../../src/zones/z21fsh/rules.ts';

// z21FSH, differential test (docs/re/m6/z21FSH.md section "Differential test (WP-VERIFY)"): the ORIGINAL code of the fishing zone (the fishing state machine FUN_006f6e2b with the bobber FUN_006f665b
// and the camera FUN_006f6d71, the switch FUN_006f4bfa with the message slots FUN_006f48c9 / 49b3, the shoal FUN_006f5dac with the fish FUN_007061ee / follower FUN_006f5b50 / bite picker FUN_00705e00,
// Bertha FUN_006f54c0, the rod draw hook FUN_006f94d4, the constructors) runs in the x86 emulation (tools/lib/m7-z21FSH-emu.mjs) from the port's state of every compared tick; the port then runs the
// same tick from that state. Compared: which nodes ran, the records, every node field (Fishing node, 15 + 1 fish structs, followers, rod), the message slots and their text draws, the globals
// (result, camera, splash flag, rod tip, picker), the game variables, the animation state, the sound / speech / music / cutscene calls, the matrices handed to the model parts, the fishing line.

export default {
  name: 'm7-z21FSH-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const MAXFAIL = 40;
    const bad = (msg) => { if (failures.length < MAXFAIL) failures.push(msg); else if (failures.length === MAXFAIL) failures.push('... more failures'); };
    const TOL = 1e-6;       // only used to report how far a mismatch is
    const maxErr = {}, inexact = {}, inexactMax = {};
    let nums = 0;
    const num = (a, b, msg, cls = 'x') => {
      checked++; nums++;
      if (Number.isNaN(a) && Number.isNaN(b)) return;
      // the port keeps the original's float32 stores everywhere (WP-VERIFY): the values must be the same float32
      const e = Math.abs(a - b), t = TOL * Math.max(1, Math.abs(b)), rel = e / t;
      if (!(rel <= (maxErr[cls] ?? 0)) && !Number.isNaN(rel)) maxErr[cls] = rel;
      if (f32(a) !== f32(b)) { bad(`${msg}: port ${a}, original ${b}`); const k = msg.replace(/^.*?: /, '').replace(/\[\d+\]/g, '[]').replace(/ \d+/g, ''); inexact[k] = (inexact[k] ?? 0) + 1; inexactMax[k] = Math.max(inexactMax[k] ?? 0, rel); if (process.env.FSH_INEXACT && inexact[k] <= 3 && k.startsWith(process.env.FSH_INEXACT)) notes.push(`INEXACT ${msg}: port ${a} original ${b}`); }
    };
    const eq = (a, b, msg) => { checked++; if (a !== b) bad(`${msg}: port ${a}, original ${b}`); };
    const ok = (c, msg) => { checked++; if (!c) bad(msg); };
    const t0all = Date.now();
    const visited = {};
    const hit = (k) => { visited[k] = (visited[k] ?? 0) + 1; };

    const world = (seed, dt = 1) => {
      const W = loadFsh(ctx, { seed, dt });
      const H = createHarness(ctx, W);
      attachMirrors(H);
      return { W, H };
    };
    /** compare two flat number records */
    const UNSET_F = -107374176, UNSET_I = 0xcccccccc | 0;
    let unsetSkipped = 0;
    const cmpObj = (a, b, label, cls, skipUnset = false) => {
      for (const k of Object.keys(b)) {
        const x = a[k], y = b[k];
        if (skipUnset && (y === UNSET_F || y === UNSET_I || y === 0xcccccccc)) { unsetSkipped++; continue; }
        if (Array.isArray(y)) { for (let i = 0; i < y.length; i++) num(x[i], y[i], `${label}.${k}[${i}]`, cls); }
        else if (Number.isInteger(y) && Number.isInteger(x)) eq(x, y, `${label}.${k}`);
        else num(x, y, `${label}.${k}`, cls);
      }
    };

    const stats = { ticks: 0, ms: 0 };
    const MUSIC = { 0xA1: true, 0xA2: false };
    /** the original's call log normalised to the port's recorder format */
    const normOrig = (log) => {
      const out = [];
      let at = null;
      for (const e of log) {
        if (e[0] === 'anim') continue;
        if (e[0] === 'emitterAt') { at = e.slice(1); continue; }
        if (e[0] === 'emitter') { out.push(e[1] === 2 && at ? ['splash', ...at] : ['splash', e[2], e[3], e[4]]); at = null; continue; }
        if (e[0] === 'music') { out.push(['music', MUSIC[e[1]]]); continue; }
        out.push(e);
      }
      return out;
    };
    const sameEvent = (a, b) => a.length === b.length && a.every((v, i) => (typeof v === 'number' && typeof b[i] === 'number' && !(Number.isInteger(v) && Number.isInteger(b[i])) ? Math.abs(v - b[i]) <= 1e-5 * Math.max(1, Math.abs(v)) : v === b[i]));
    /** a * b of row-major row-vector 4x4 matrices */
    const mul4 = (a, b) => { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let v = 0; for (let k = 0; k < 4; k++) v += a[i * 4 + k] * b[k * 4 + j]; o[i * 4 + j] = v; } return o; };

    /** one tick: the original from the state, restore, the port from the same state, compare */
    const step = (E, held, label) => {
      const { W, H } = E, { w, S } = W;
      const F = S.fishing;
      if (process.env.FSH_NOCACHE) w.col.hitCache = false;
      const s0 = snapshotWorld(W);
      H.printfs.length = 0;
      const inp = w.input, prev = W.held();
      inp.prevHeld = prev; inp.held = held; inp.pressed = (held ^ prev) & held;
      const t0 = Date.now();
      if (process.env.FSH_CACHE && label.includes(process.env.FSH_CACHE)) { const m = H.mem; notes.push(`CACHE ${label} orig rec ${m.u32(0x9dec24).toString(16)} from ${[0,1,2].map((i)=>m.f32(0x9debd0+4*i))} to ${[0,1,2].map((i)=>m.f32(0x9debb0+4*i))} poly ${m.u32(0x9deb78).toString(16)}; port rec ${w.col.cacheRec?.index} from ${w.col.cacheFrom} to ${w.col.cacheTo} last ${w.col.lastHit?.polygon}`); }
      if (process.env.FSH_GR && label.includes(process.env.FSH_GR)) {
        const m = H.mem, B = 0x5d60000; H.mirrorRecords?.();
        const P = [42.27313995361328, 12.000041961669922, -10.584415435791016];
        for (let i = 0; i < 3; i++) m.wf32(B + 4 * i, P[i]);
        const sv = [0x9dec24, 0x9debd0, 0x9debd4, 0x9debd8, 0x9debb0, 0x9debb4, 0x9debb8, 0x9deb78].map((a) => m.u32(a));
        H.cpu.call(0x4425f0, [B, 0x8b1a30]);
        notes.push(`GR orig ret ${H.cpu.fpop()}`);
        notes.push(`GR orig mem ${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => m.f32(0x9debc0 + 4 * i))}`);
        const q = w.col.rayRecord(w.col.groundRec, P, [0, -500, 0], 3, 1.0, 0.1);
        notes.push(`GR port ${q && Array.from(q.point)} cache ${w.col.cacheRec?.index}`);
      }
      let o;
      try { o = emuPass(H); } catch (e) { bad(`${label}: the original failed: ${e.message}`); H.reset(); restoreWorld(W, s0); return false; }
      stats.ms += Date.now() - t0;
      if (process.env.FSH_WATCH && label.includes(process.env.FSH_WATCH)) {
        restoreWorld(W, s0); const inp3 = w.input; inp3.prevHeld = prev; inp3.held = held; inp3.pressed = (held ^ prev) & held;
        const base = H.ptrOfFish(S.shoal.fish[+process.env.FSH_FISH]); H.mem.wlo = base; H.mem.whi = base + 0xc0;
        H.mem.onWrite = (a, size, v) => { const f = new Float32Array(new Uint32Array([v]).buffer)[0]; notes.push(`WRITE +0x${(a - base).toString(16)} = ${size === 4 ? f : v} at eip 0x${H.cpu.eip.toString(16)}`); };
        try { emuPass(H); } catch (e) { /* */ }
        H.mem.wlo = 0; H.mem.whi = 0; H.mem.onWrite = null;
      }
      if (process.env.FSH_FISH && label.includes(process.env.FSH_FISHAT ?? '@@')) { const f = s0.fish[+process.env.FSH_FISH][1]; notes.push(`FISH before: ${JSON.stringify(f)}`); }
      if (process.env.FSH_DUMP && label.includes(process.env.FSH_DUMP)) notes.push(`DUMP ${label}: held ${held.toString(16)} pressed ${w.input.pressed.toString(16)} fb before ${s0.vars[0xfb]} after ${o.vars[0xfb]}; before state ${F.state} sub ${F.sub} bite ${F.bite}; original: state ${o.fishing.state} parts ${o.parts.map((x) => x.who).join('')} ran ${o.ran.map((x) => x[1])} lines ${o.lines.length} draws ${JSON.stringify(o.draws.map((d) => d.rec))} texts ${JSON.stringify(o.texts.map((t) => t.text))} bones ${JSON.stringify(o.bones)} Pepper clip ${W.w.records[REC.PEPP].anim.clip} frame ${W.w.records[REC.PEPP].anim.frame}`);
      for (const f of H.printfs) { stats.printf = (stats.printf ?? 0) + 1; if (f !== '') stats.printfNonEmpty = (stats.printfNonEmpty ?? 0) + 1; }
      if (process.env.FSH_TRACE && label.includes(process.env.FSH_TRACE)) {
        restoreWorld(W, s0); const inp2 = w.input; inp2.prevHeld = prev; inp2.held = held; inp2.pressed = (held ^ prev) & held;
        const seen = []; const lo = parseInt(process.env.FSH_RANGE.split('-')[0], 16), hi = parseInt(process.env.FSH_RANGE.split('-')[1], 16);
        try { emuPass(H, { trace: (c, at) => { if (at >= lo && at < hi) seen.push(at.toString(16)); } }); } catch (e) { seen.push('ERR ' + e.message); }
        notes.push(`TRACE ${label}: ${seen.join(' ').slice(0, 3000)}`);
      }
      restoreWorld(W, s0);
      const pre = { state: F.state, sub: F.sub, bite: F.bite, popups: s0.popups, logLen: s0.logLen };
      E.rngBefore = s0.rngCount;
      if (process.env.FSH_RAYLOG && label.includes(process.env.FSH_RAYLOG)) { const o0 = w.col.rayRecord.bind(w.col); w.col.rayRecord = (...a) => { notes.push(`RAY ${label} ${a[0].name} ${a[1]} ${new Error().stack.split('\n').slice(2, 6).map((l) => l.trim().replace(/.*\//, '')).join(' < ')}`); return o0(...a); }; }
      W.step(held);
      if (process.env.FSH_RAYLOG) delete w.col.rayRecord;
      if (process.env.FSH_DUMP && label.includes(process.env.FSH_DUMP)) { const a = w.records[REC.PEPP].anim, ps = a.pose(1); notes.push(`DUMP port after: Pepper clip ${a.clip} frame ${a.frame} prev ${a.prevFrame}/${a.prevClip} hand ${ps ? [12, 13, 14].map((i) => ps[14 * 16 + i]) : null} noInterp ${a.noInterp}`); }
      stats.ticks++;
      if (process.env.FSH_NONF32 && (notes.filter((n) => n.startsWith('NONF32')).length < 6)) for (const [i, f] of S.shoal.fish.entries()) for (const [k, v] of Object.entries(f)) if (typeof v === 'number' && f32(v) !== v && k !== 'index') notes.push(`NONF32 ${label} fish ${i}.${k} = ${v}`);
      compare(E, o, label, pre);
      return true;
    };

    const compare = (E, o, label, pre) => {
      const { W, H } = E, { w, S } = W;
      const F = S.fishing, rs = w.records;
      // which nodes ran
      const ranPort = [];
      for (const r of rs) if (r.ctrl) r.ctrl.nodes.forEach((n, i) => { if (r.ctrl.ran[i]) ranPort.push(`${r.index}:${n.kind}`); });
      eq(ranPort.join(), o.ran.map((x) => `${x[0]}:${x[1]}`).join(), `${label}: nodes that ran`);
      // records
      for (const r of rs) {
        if (r.index >= 96) continue;
        if (r.index === REC.FLOT || r.index === REC.SPLH) continue;      // drawn through model-part matrices (compared below)
        const q = o.recs[r.index];
        const big = r.index === REC.PEPP || r.index === REC.RODD || r.index === REC.FLOT || r.index === REC.SPLH;
        // the draw hooks set a pre-transform (the model is drawn at half size, Bertha also 1 back) the port bakes into the record matrix: expected = pre * matrix
        const dr = o.draws.find((d) => d.rec === r.index && d.pre);
        const em = dr ? mul4(dr.pre, q.m) : q.m;
        for (let k = 0; k < 16; k++) num(r.m[k], em[k], `${label}: record ${r.index} ${r.name} m[${k}]`, big ? 'rec' : 'other');
        if (![REC.RODD, REC.FLOT, REC.SPLH].includes(r.index)) eq(r.flags & 0xfffe, q.flags & 0xfffe, `${label}: record ${r.index} ${r.name} flags`);
      }
      for (const r of [rs[REC.PEPP]]) { const q = o.recs[r.index]; num(r.ry, q.e[1], `${label}: Pepper ry`, 'euler'); }
      // the Fisherman node (FUN_006f9090 with the walker of Common\WayPt run natively), its walker struct, the HUD the hook of the FSwitch node writes (FUN_006f514c -> FUN_00705c64)
      cmpObj(H.tsFisherman(), o.fisherman, `${label}: Fisherman`, 'node');
      cmpObj(H.tsWalker(), o.walker, `${label}: walker`, 'node');
      { const th = H.tsHud(), oh = o.hud;
        eq(th.leftText, oh.leftText, `${label}: HUD left text`); eq(th.rightText, oh.rightText, `${label}: HUD right text`); eq(th.centreText, oh.centreText, `${label}: HUD centre text`);
        eq(th.gaugeOn, oh.gaugeOn, `${label}: HUD gauge on`);
        if (oh.gaugeOn) { eq(th.marker, oh.marker, `${label}: HUD gauge marker`); num(th.gaugeValue, oh.gaugeValue, `${label}: HUD gauge value`, 'node'); }
        if (th.column0 !== null) eq(th.column0, oh.column0, `${label}: HUD column slot 0`); else eq(-1, oh.column0 | 0, `${label}: HUD column slot 0 (unset)`); }
      // the nodes
      cmpObj(H.tsFishing(F), o.fishing, `${label}: Fishing`, 'node');
      const st = H.tsShoal();
      cmpObj(st.follower, o.shoal.follower, `${label}: shoal follower`, 'node');
      o.shoal.fish.forEach((f, i) => cmpObj(st.fish[i], f, `${label}: shoal fish ${i}`, 'node'));
      const bt = H.tsBertha();
      cmpObj(bt.follower, o.bertha.follower, `${label}: Bertha follower`, 'node');
      cmpObj(bt.fish, o.bertha.fish, `${label}: Bertha fish`, 'node');
      cmpObj(H.tsRod(), o.rod, `${label}: rod`, 'node');
      // the message slots
      S.popups.slots.forEach((p, i) => {
        const q = o.popups[i];
        eq(p.active ? 1 : 0, q.active, `${label}: popup ${i} active`);
        if (!p.active && !q.active) return;
        eq(p.visible ? 1 : 0, q.visible, `${label}: popup ${i} visible`); eq(p.count, q.count, `${label}: popup ${i} count`); eq(p.on, q.on, `${label}: popup ${i} on`); eq(p.off, q.off, `${label}: popup ${i} off`);
        eq(p.x, q.x, `${label}: popup ${i} x`); eq(p.y, q.y, `${label}: popup ${i} y`); num(p.timer, q.timer, `${label}: popup ${i} timer`, 'node');
        eq(p.text ?? p.id, q.text, `${label}: popup ${i} text`);
      });
      // globals
      cmpObj(H.tsGlobals(), o.globals, `${label}: globals`, 'node');
      // variables
      for (let i = 0; i < w.vars.a.length; i++) { checked++; if ((w.vars.a[i] | 0) !== (o.vars[i] | 0)) bad(`${label}: variable 0x${i.toString(16)}: port ${w.vars.a[i]}, original ${o.vars[i]}`); }
      // animations
      for (const r of rs) if (r.anim) { const q = o.anims[r.index]; eq(r.anim.clip, q.clip, `${label}: record ${r.index} ${r.name} clip`); num(r.anim.frame, q.frame, `${label}: record ${r.index} ${r.name} frame`, 'frame'); }
      // the calls (sounds, speech, music, cutscene, emitter)
      const mine = W.log.slice(pre.logLen ?? 0);
      const orig = normOrig(o.log);
      checked++;
      if (mine.length !== orig.length || !mine.every((e, i) => sameEvent(e, orig[i]))) bad(`${label}: calls: port ${JSON.stringify(mine)} original ${JSON.stringify(orig)}`);
      // the random numbers: the same number of draws
      eq(W.rng.count - E.rngBefore, o.rand, `${label}: random draws`);
      // the model-part matrices the original hands to the draw (bobber, 15 fish, splash ring) against the port's records
      {
        const bob = o.parts.filter((x) => x.who === 'bobber'), fish = o.parts.filter((x) => x.who === 'fish'), spl = o.parts.filter((x) => x.who === 'splash');
        const flot = rs[REC.FLOT];
        eq(flot.enabled ? 1 : 0, bob.length ? 1 : 0, `${label}: bobber drawn`);
        if (bob.length && flot.enabled) for (let k = 0; k < 16; k++) num(flot.m[k], bob[bob.length - 1].m[k], `${label}: bobber matrix[${k}]`, 'rec');
        eq(fish.length, 15, `${label}: 15 fish drawn`);
        fish.forEach((f, i) => { const c = S.clones[i]; for (let k = 0; k < 16; k++) num(c.m[k], f.m[k], `${label}: fish ${i} model matrix[${k}]`, 'rec'); });
        const sp = rs[REC.SPLH];
        eq(sp.enabled ? 1 : 0, spl.length ? 1 : 0, `${label}: splash ring drawn`);
        if (spl.length && sp.enabled) for (let k = 0; k < 16; k++) num(sp.m[k], spl[0].m[k], `${label}: splash ring matrix[${k}]`, 'rec');
        // the rod: drawn (default draw of the rod record) iff the port shows it; the fishing line
        eq(rs[REC.RODD].enabled ? 1 : 0, o.draws.some((d) => d.rec === REC.RODD) ? 1 : 0, `${label}: rod drawn`);
        const ln = S.line;
        eq(ln ? 1 : 0, o.lines.length, `${label}: fishing line drawn`);
        if (ln && o.lines.length) for (let k = 0; k < 3; k++) { num(ln.a[k], o.lines[0].a[k], `${label}: line start[${k}]`, 'rec'); num(ln.b[k], o.lines[0].b[k], `${label}: line end[${k}]`, 'rec'); }
      }
      // the message texts the original draws (the visible slots of the state at the start of the tick)
      const vis = pre.popups.filter((p) => p.active && p.visible).map((p) => [p.text ?? p.id, p.x, p.y]);
      const drawn = o.texts.filter((t) => !t.panel && t.wrap === 0x24).map((t) => [t.text, t.x, t.y]);
      eq(JSON.stringify(vis), JSON.stringify(drawn), `${label}: message slots drawn`);
    };
    function makeRng(seed) {
      let st = seed >>> 0;
      const next = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
      return { next, int: (n) => Math.trunc(next() * n), pick: (a) => a[Math.trunc(next() * a.length)] };
    }
    /** a state-aware scripted angler: walks to a spot, aims, casts with a random power, waits for a bite, strikes, reels (tension kept in or out of range), reads the score */
    const angler = (rng, E, plan = {}) => {
      const { W } = E, { S, w } = W;
      let leaveWait = 0, wait = 3 + rng.int(8), hold = 0, aim = 0, aimLeft = 0, castPhase = 0, powerGoal = 0, strikeIn = -1, reelLimit = 38, reelHold = 0, scoreWait = 5 + rng.int(40), lastState = -1;
      return () => {
        const F = S.fishing, st = F.state;
        if (st !== lastState) { lastState = st; wait = 0; hold = 0; }
        let held = 0;
        // left fishing mode (Shift in the ready state): Shift again starts the walk to the nearest spot again
        if (w.vars.get(0xfb) === 1 && st !== ST.WALK_IDLE) { if (leaveWait-- <= 0) { leaveWait = 4; return BTN.ACTION; } return 0; }
        if (plan.leave && w.vars.get(0xfb) === 2 && (st === ST.READY || st === ST.ARRIVED) && rng.next() < 0.02) { leaveWait = 5 + rng.int(8); return BTN.ACTION; }
        switch (st) {
          case ST.WALK_IDLE: if (wait-- <= 0) { held = BTN.ACTION; wait = 3; } break;
          case ST.READY: {
            if (castPhase === 0 && aimLeft-- <= 0) { aim = rng.pick([0, 0, BTN.LEFT, BTN.RIGHT]); aimLeft = 3 + rng.int(25); }
            if (castPhase === 0 && F.casts > 0 && rng.next() < 0.04 + (plan.eager ? 0.2 : 0)) { castPhase = 1; held = BTN.CAST; powerGoal = plan.power ?? rng.pick([2, 8, 10, 14, 25, 40, 55, 60, 62, 70]); }
            else held = castPhase ? 0 : aim;
            break;
          }
          case ST.CAST:
            castPhase = 0;
            if (F.sub === CAST.CHARGE) { if (F.power >= powerGoal) held = BTN.CAST; } else if (F.sub === CAST.WINDUP) { held = 0; }
            break;
          case ST.WAIT: {
            if (strikeIn < 0 && F.bite === 1) strikeIn = plan.instant ? 0 : rng.int(30);
            if (strikeIn >= 0) { if (strikeIn-- === 0 && rng.next() < 0.85) held = BTN.UP; }
            else if (F.bite === 0 && wait++ > (plan.waitMax ?? 150) + rng.int(100)) held = BTN.DOWN;
            if (F.bite === 0 && rng.next() < 0.03) held |= BTN.DOWN;
            break;
          }
          case ST.REEL: held = BTN.DOWN; if (rng.next() < 0.1) held = 0; break;
          case ST.RETRIEVE: break;
          case ST.FIGHT:
            strikeIn = -1;
            if (reelHold-- <= 0) { reelLimit = plan.limit ?? rng.pick([20, 30, 38, 45, 50, 62, 70]); reelHold = 10 + rng.int(60); }
            held = F.tension < reelLimit ? BTN.DOWN : 0;
            if (plan.noReel) held = 0;
            break;
          case ST.SCORE: if (scoreWait-- <= 0) held = BTN.ACTION; break;
          default: strikeIn = -1; break;
        }
        if (st === ST.ARRIVED || st === ST.LANDED) { castPhase = 0; strikeIn = -1; }
        return held;
      };
    };
    const ticks = (E, n, drv, label, each) => {
      let prevState = E.W.S.fishing.state;
      for (let i = 0; i < n; i++) {
        const held = drv();
        if (!step(E, held, `${label} t${i}`)) return false;
        const F = E.W.S.fishing;
        hit(`state ${F.state}`); if (F.state === ST.CAST) hit(`cast sub ${F.sub}`);
        if (F.state !== prevState) hit(`transition ${prevState} -> ${F.state}`);
        { const fn = E.W.w.records[7].ctrl.nodes.find((n) => n.kind === 'Fisherman'); hit(`fisherman state ${fn.state}`); const wk = E.W.walker; void wk;
          if (fn.state !== (E.fprev ?? fn.state)) hit(`fisherman transition ${E.fprev} -> ${fn.state}`); E.fprev = fn.state; }
        { const g = E.W.hud.gauge; if (g) hit(`HUD gauge marker ${g.marker}`); if (E.W.hud.centreText !== '0' && E.W.hud.centreText) hit('HUD score counting'); }
        if (F.state === ST.FIGHT && F.bite === 2) hit('fight: line lost');
        if (F.hooked?.bertha && F.state === ST.LANDED) hit('Bertha landed');
        for (const p of E.W.S.popups.slots) if (p.active && p.visible && p.timer === p.on - 0) hit(`popup ${(p.text ?? p.id).slice(0, 12).trim()}`);
        const S2 = E.W.S;
        if (S2.shoal.fish.some((f) => f.approaching)) hit('a fish approaches the bait (last cast)');
        if (S2.shoal.fish.some((f) => f.biting) || S2.bertha.fish.biting) hit('a fish bites');
        if (F.bite === 1) hit('bite 1'); if (F.bite === 2) hit('bite 2 (gone)');
        if (S2.shoal.fish.some((f) => f.hooked) || S2.bertha.fish.hooked) hit('a fish is hooked');
        if (F.lure > 0) hit('lure active'); if (F.taut > 0) hit('taut line');
        prevState = F.state;
        each?.(i, F);
        if (E.W.S.result) { hit(`result ${E.W.S.result}`); }
        if (failures.length > MAXFAIL) return false;
        if (E.stop) break;
      }
      return true;
    };
    /** assists: bring a fish to the bobber while the line waits (state 8), so that the game reaches the bites / fights in few ticks */
    const attractor = (rng, E, plan = {}) => (i, F) => {
      const { S } = E.W;
      if (F.state === ST.WAIT && F.bite === 0 && rng.next() < (plan.attract ?? 0.05)) {
        const f = plan.bertha ? S.bertha.fish : S.shoal.fish[rng.int(S.shoal.fish.length)];
        f.x = f32(F.bx + (rng.next() - 0.5) * 1.5); f.y = -1; f.z = f32(F.bz + (rng.next() - 0.5) * 1.5);
      }
      if (plan.far && F.state === ST.ARRIVED) for (const f of [...S.shoal.fish, S.bertha.fish]) if (!f.hooked && !f.approaching) { f.x = 300; f.z = 300; }
    };
    const game = (seed, dt, plan, n, label) => {
      const E = world(seed + 10, dt), { W } = E;
      runConstructors(E.H, readTables(W.pe));
      const rng = makeRng(seed * 77 + dt * 5);
      const drv = angler(rng, E, plan);
      const P = W.w.records[REC.PEPP], sp = W.S.spots[rng.int(W.S.spots.length)];
      P.x = sp.x + (rng.next() - 0.5) * 12; P.z = sp.z + (rng.next() - 0.5) * 12; P.y = sp.y; P.savePrev();
      if (plan.casts !== undefined) W.S.fishing.casts = plan.casts;
      if (plan.far) for (const f of [...W.S.shoal.fish, W.S.bertha.fish]) { f.x = 300; f.z = 300; }
      ticks(E, n, drv, label, attractor(rng, E, plan));
      return E;
    };

    try {
      // ---- 1. the constructors: the original's against the port's bind (same random stream)
      {
        const { W, H } = world(7);
        runConstructors(H, readTables(W.pe));
        const { S } = W, F = S.fishing;
        const fo = H.readFishing();
        cmpObj(H.tsFishing(F), fo, 'ctor Fishing', 'node', true);
        const so = H.readShoal(), st = H.tsShoal();
        cmpObj(st.follower, so.follower, 'ctor Shoal follower', 'node', true);
        so.fish.forEach((f, i) => cmpObj(st.fish[i], f, `ctor shoal fish ${i}`, 'node', true));
        const bo = H.readBertha(), bt = H.tsBertha();
        cmpObj(bt.follower, bo.follower, 'ctor Bertha follower', 'node', true);
        cmpObj(bt.fish, bo.fish, 'ctor Bertha fish', 'node', true);
        cmpObj(H.tsRod(), H.readRod(), 'ctor rod', 'node');
        eq(W.ctorDraws.length, H.ctorRandCalls, 'constructors: number of random draws');
      }
      // ---- 2. games with a seeded angler (every tick compared): random casts, bites assisted by fish brought to the bobber
      const plans = [
        { eager: true, attract: 0.08, n: 1100 },
        { eager: true, attract: 0.08, instant: true, limit: 38, n: 1100 },
        { eager: true, attract: 0.08, limit: 70, n: 1100 },
        { eager: true, attract: 0.08, noReel: true, n: 1100 },
        { eager: true, attract: 0.1, bertha: true, instant: true, limit: 38, n: 1750 },
        { eager: true, casts: 1, attract: 0, n: 1000 },
        { eager: true, power: 5, attract: 0, n: 700 },
        { eager: true, power: 66, attract: 0, n: 700 },
        { eager: true, power: 30, attract: 0.15, instant: true, n: 1100 },
      ];
      const label = (pl) => Object.keys(pl).filter((k) => k !== 'n').join(',');
      plans.forEach((pl, i) => game(i + 1, 1, pl, pl.n, `game ${i + 1} dt 1 [${label(pl)}]`));
      // the same at the 60 Hz step the port will move to (dt = 0.5): the original's integer counters (`ftol(counter + dt)`) never advance then; the port must do the same
      for (const [i, pl] of [[0, plans[0]], [4, plans[4]], [2, plans[2]]]) game(i + 11, 0.5, { ...pl, n: pl.n * 1.4 | 0 }, pl.n * 1.4 | 0, `game ${i + 1} dt 0.5 [${label(pl)}]`);
    } catch (e) {
      bad(`test crashed: ${e.stack || e}`);
    }
    notes.push(`constructors: ${unsetSkipped} node fields the original leaves uninitialised (debug fill) are not compared`);
    notes.push(`FUN_0085eb80 (the CRT's printf, called by the rod hook in state 11): ${stats.printf ?? 0} calls, ${stats.printfNonEmpty ?? 0} with a non-empty format (the buffer DAT_05d5cbc4 is never written)`);
    notes.push(`${stats.ticks} ticks compared (original ${(stats.ms / Math.max(1, stats.ticks)).toFixed(1)} ms per pass)`);
    notes.push(`visited: ${Object.entries(visited).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
    notes.push(`float comparisons float32 mismatches (count): ${Object.entries(inexact).sort((x, y) => y[1] - x[1]).slice(0, 14).map(([k, v]) => `${k} ${v} (${inexactMax[k].toFixed(3)})`).join(', ')}`);
    notes.push(`${nums} float comparisons, ${((Date.now() - t0all) / 1000).toFixed(1)} s`);
    return { checked, failures, notes };
  },
};
