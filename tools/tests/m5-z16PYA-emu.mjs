import { loadPya } from '../lib/m5-z16PYA-load.mjs';
import { emuPya, G, RECORDS_BASE } from '../lib/m5-z16PYA-emu.mjs';
import { PyaPepSwitch, setRosterHooks, SND, msClock } from '../../src/zones/z16PYA/peppsw.ts';
import { PyaHud, fmt04d } from '../../src/zones/z16PYA/hud.ts';
import { setRandSource, setTickCountSource } from '../../src/game/crt.ts';
import { setIslandRandom } from '../../src/island/rng.ts';
import { startTickClock } from '../../src/zones/common/tickrand.ts';
import { Hud } from '../../src/shell/hud.ts';
import { B } from '../../src/game/input.ts';
import { guarded } from '../lib/inject-guard.mjs';

// M5 z16PYA, the ORACLE tests: the original's code of the Pyramid's own nodes runs in the x86 interpreter (the emulated machine after the Pyramid's set-up, `IslandSetup.run`,
// tools/lib/m5-z16PYA-emu.mjs) next to the port:
//   (a) PeppSw's pre-render FUN_00676d95 (Pepper's mode switch: board on / off, water, groove level, the Enter / tick roster calls) over scripted states: PEPPER_CONTROL word, pressed
//       buttons, the state mailbox DAT_008ae088, Pepper's clip, her place (terrain ahead), the sea level -400;
//   (b) PeppSw's update FUN_00676cd0 (the temple's 3D sound, the random 2D sounds from rand * milliseconds mod 2000) with scripted random numbers and clocks;
//   (c) the HUD FUN_006760d0 (score "%04d", gem count "x%d", the interaction icon with the blink) over scripted variables.
// The machine's sound handles are tokens: the port's sound ids are compared through the ids the emulated loaders obtained.

const KEYS = { CTRL: B.CTRL, ENTER: B.ENTER };
const NODE = 36;

const __test = {
  name: 'm5-z16PYA-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const eq = (a, b, msg) => { checked++; if (JSON.stringify(a) !== JSON.stringify(b)) failures.push(`${msg}: original ${JSON.stringify(a)} port ${JSON.stringify(b)}`); };
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };

    // ------------------------------------------------------------------------------------------------ the oracle machine
    let clip = 0, rng = 0, ms = 0;
    const hooks = new Map();
    hooks.set(0x43b72b, (c) => { c.eax = clip; });                   // FUN_0043b72b(anim): the clip (scripted)
    hooks.set(0x4388ae, (c) => { c.fpush(rng); });                   // FUN_004388ae(x) = rand() / 32767 * x: scripted value
    hooks.set(0x435c91, (c) => { c.eax = ms; });                     // FUN_00435c91: GetTickCount - start
    const origRoster = [];
    hooks.set(0x698da4, (c) => { origRoster.push('enter'); c.eax = 0; });   // FUN_00698da4 (Enter) / FUN_00698e39 (every tick): logged, not run (the island's look cycler is tested by m4-wp6-looks)
    hooks.set(0x698e39, (c) => { origRoster.push('tick'); c.eax = 0; });
    const O = emuPya(ctx, NODE, { hooks });
    const { s, mem } = O;
    O.loadWalkSounds();
    const tok = O.soundIds();
    const idOf = (h) => tok.get(h) ?? `?${(h >>> 0).toString(16)}`;
    const glob = (a) => mem.u32(a);
    // handle globals -> ids the loaders obtained
    const walk = { on: idOf(glob(0x9da978)), off: idOf(glob(0x9da940)) };
    ok(walk.on === SND_ON && walk.off === SND_OFF, `walk sounds: board on / off = ${walk.on} / ${walk.off}`);
    ok(mem.f32(G.SEA) === -400, `sea level -400 (${mem.f32(G.SEA)})`);
    ok(mem.u32(G.BOARD) === 17, `DAT_009daa7c = 17 (${mem.u32(G.BOARD)})`);
    const PEPP = 3, BOARD = 17;

    // ------------------------------------------------------------------------------------------------ the port
    const H = loadPya(ctx, NODE);
    const W = H.world, pep = H.pepper, board = W.records[BOARD];
    const portLog = [];
    const rosterLog = [];
    setRosterHooks(W, { enter: () => rosterLog.push('enter'), tick: () => rosterLog.push('tick') });
    H.ictx.musicGroove = (l) => portLog.push(['groove', l]);   // (replaces the helper's recorder)
    const ic = H.ictx;
    const spyAnim = (rec, who) => { const a = rec.anim; if (!a || a.__spy) return; const o = a.start.bind(a); a.start = (c, f) => { portLog.push(['anim', who, c]); return o(c, f); }; a.__spy = true; };
    spyAnim(pep, 'pep'); spyAnim(board, 'board');
    ok(!!pep.anim && !!board.anim, 'Pepper and the board have animation instances');
    const clipOfPort = () => pep.anim.clip;
    const nodeKinds = pep.ctrl.nodes.map((n) => n.kind).join();
    ok(nodeKinds === 'PeppSw,scorpion,SGwalk,sgswim,skate' || nodeKinds.startsWith('PeppSw'), `Pepper's chain: ${nodeKinds}`);
    const portNode = () => pep.ctrl.nodes.find((n) => n.kind === 'PeppSw');
    ok(!!portNode(), 'PeppSw attached to Pepper');

    // ids of the sounds as the port plays them: SND_ON etc. are the ids the loaders gave the original's handles
    const SND_ON_ID = SND_ON, SND_OFF_ID = SND_OFF;
    void SND_ON_ID; void SND_OFF_ID;

    const tally = { anim: 0, groove: 0, p2: 0, s2: 0, enter: 0, tick: 0 };
    /** run one pre-render of the original and of the port from the same scripted state; compare everything observable */
    function pre(name, st) {
      const word = st.word ?? 1, pressed = st.pressed ?? 0, mailbox = st.mailbox ?? 0x1b, c = st.clip ?? 0x1;
      const pos = st.pos ?? [2.0, 1.9, 313.8], yaw = st.yaw ?? 0;
      // ---- the original's node (a fresh one: its groove state starts at 1 / 1 like the port's)
      const created = s.run(0x677350, [O.rec(PEPP), 0, 0, 0x5e, 0, 0]);
      const node = created.eax;
      if (st.groove) { mem.w32(node + 0x18, st.groove); mem.w32(node + 0x1c, st.lastGroove ?? st.groove); }
      // ---- the shared state
      pep.x = pos[0]; pep.y = pos[1]; pep.z = pos[2]; pep.ry = yaw; pep.rebuildYaw(); pep.savePrev();
      O.putMatrix(PEPP, pep.m, pep.rx, pep.ry, pep.rz);
      s.setVar(0x5e, word); W.vars.set(0x5e, word);
      mem.w32(G.MAILBOX, mailbox); W.pep.mailbox = mailbox;
      mem.w32(G.PRESSED, pressed); W.input.pressed = pressed;
      clip = c; pep.anim.clip = c;
      board.flags &= ~2; mem.w16(RECORDS_BASE + BOARD * 0x68 + 0x60, board.flags);
      const pn = portNode();
      pn.groove = st.groove ?? 1; pn.lastGroove = st.lastGroove ?? pn.groove;
      portLog.length = 0; rosterLog.length = 0; origRoster.length = 0; ic.sounds.length = 0; ic.stopped.length = 0;
      // ---- run both
      const r = s.run(0x676d95, [O.rec(PEPP), node]);
      pn.prerender(W, pep);
      // ---- compare: PEPPER_CONTROL, mailbox, groove state
      eq(mem.u32(0x8a2d2c + 4 * 0x5e) | 0, W.vars.get(0x5e) | 0, `${name}: var 0x5e`);
      eq(mem.u32(G.MAILBOX) & 0xff, W.pep.mailbox & 0xff, `${name}: mailbox`);
      eq([mem.u32(node + 0x18), mem.u32(node + 0x1c)], [pn.groove, pn.lastGroove], `${name}: groove state`);
      // ---- the calls, in order, as comparable events
      const orig = [];
      for (const cl of r.calls) {
        const a = cl.args;
        if (cl.name === 'animStart') orig.push(['anim', a[0] === mem.u32(O.rec(PEPP) + 8) ? 'pep' : a[0] === mem.u32(O.rec(BOARD) + 8) ? 'board' : '?', a[1] | 0]);
        else if (cl.fn === 0x4435a0) orig.push(['p2', idOf(a[0])]);
        else if (cl.fn === 0x4435b0) orig.push(['s2', idOf(a[0])]);
        else if (cl.fn === 0x443310) orig.push(['groove', (a[0] << 24) >> 24]);
        else if (cl.fn === 0x698da4) orig.push(['enter']);
        else if (cl.fn === 0x698e39) orig.push(['tick']);
      }
      const port = [];
      // the port's calls arrive in three logs (anim / groove, sounds, roster hooks): merge them in the order the original makes them: sounds + anim as one list by the code order is not
      // recoverable, so compare each kind as an ordered list
      const kinds = (l, ks) => l.filter((e) => ks.includes(e[0]));
      const sndPort = [...ic.sounds.map((x) => ['p2', x.id]), ...ic.stopped.map((x) => ['s2', x])];
      void port;
      eq(kinds(orig, ['anim']), kinds(portLog, ['anim']), `${name}: animation starts`);
      eq(kinds(orig, ['groove']), kinds(portLog, ['groove']), `${name}: groove calls`);
      eq(orig.filter((e) => e[0] === 'p2').map((e) => e[1]), ic.sounds.map((x) => x.id), `${name}: sounds played`);
      // (the original stops 8 handles, two of them DAT_05d57fcc / fdc loaded with the same id 0x185: AudioHost.stop(id) stops every voice of an id, so the distinct ids are compared)
      eq([...new Set(orig.filter((e) => e[0] === 's2').map((e) => e[1]))].sort(), [...new Set(ic.stopped)].sort(), `${name}: sounds stopped`);
      eq(origRoster.slice(), rosterLog.slice(), `${name}: roster calls`);
      eq((mem.r16 ? mem.r16(RECORDS_BASE + BOARD * 0x68 + 0x60) : mem.u32(RECORDS_BASE + BOARD * 0x68 + 0x60) & 0xffff) & 2, board.flags & 2, `${name}: the board is shown`);
      void sndPort;
      tally.anim += orig.filter((e) => e[0] === 'anim').length; tally.groove += orig.filter((e) => e[0] === 'groove').length; tally.p2 += orig.filter((e) => e[0] === 'p2').length; tally.s2 += orig.filter((e) => e[0] === 's2').length; tally.enter += origRoster.filter((e) => e === 'enter').length; tally.tick += origRoster.filter((e) => e === 'tick').length;
      return { orig, node, word: W.vars.get(0x5e), mailbox: W.pep.mailbox };
    }

    // ------------------------------------------------------------------------------------------------ (a) pre-render scenarios
    const WALK = 1, SWIM = 2, SKATE = 4;
    pre('walk idle', {});
    for (const c of [0x24, 0x3f, 0x40, 0x25, 0x41, 99, 0x62]) pre(`walk clip ${c}`, { clip: c });
    { const r = pre('walk Ctrl -> board', { pressed: KEYS.CTRL }); ok(r.word === 4 && r.mailbox === 0x16, `walk + Ctrl: mode 4, state 0x16 (${r.word}, ${r.mailbox})`); }
    for (const mb of [1, 2, 0x57, 0x1f, 0x38, 0x16, 0x1c, 0x20]) pre(`walk Ctrl, mailbox ${mb}`, { pressed: KEYS.CTRL, mailbox: mb });
    for (const c of [99, 0x62, 0x24]) pre(`walk Ctrl, clip ${c}`, { pressed: KEYS.CTRL, clip: c });
    pre('walk Enter', { pressed: KEYS.ENTER });
    pre('walk Ctrl + Enter', { pressed: KEYS.CTRL | KEYS.ENTER });
    pre('walk with the interact bit', { word: WALK | 0x1000, pressed: KEYS.CTRL });
    // the sea: Pepper at or below -400 swims (state 0x15), also with Ctrl
    for (const y of [-400, -400.5, -399.9, -1000]) { const r = pre(`walk y ${y}`, { pos: [2.0, y, 313.8] }); ok((r.word === 2 && r.mailbox === 0x15) === (y <= -400), `walk at y ${y}: swim iff y <= -400 (${r.word}, ${r.mailbox})`); }
    pre('walk Ctrl below the sea', { pos: [2.0, -401, 313.8], pressed: KEYS.CTRL });
    // the board
    pre('board idle', { word: SKATE, groove: 1, mailbox: 0x29 });
    { const r = pre('board Ctrl', { word: SKATE, pressed: KEYS.CTRL, mailbox: 0x29 }); ok(r.word === 1 && r.mailbox === 0x1c, `board + Ctrl: mode 1, state 0x1c (${r.word}, ${r.mailbox})`); }
    pre('board interact bit', { word: SKATE | 0x1000, mailbox: 0x29 });
    for (const mb of [0x20, 0x32, 0x21, 0x16]) pre(`board Ctrl, mailbox ${mb}`, { word: SKATE, pressed: KEYS.CTRL, mailbox: mb });
    for (const mb of [0x20, 0x21, 0x29]) pre(`board off the map (water ahead), mailbox ${mb}`, { word: SKATE, pos: [5000, 0, 5000], mailbox: mb });
    pre('board off the map, Ctrl', { word: SKATE, pos: [5000, 0, 5000], pressed: KEYS.CTRL, mailbox: 0x29 });
    // swimming: out of the water where the terrain one unit ahead is above the sea
    { const r = pre('swim on land', { word: SWIM, mailbox: 0x62 }); ok(r.word === 1 && r.mailbox === 0x25, `swim on land: mode 1, state 0x25 (${r.word}, ${r.mailbox})`); }
    pre('swim off the map', { word: SWIM, pos: [5000, 0, 5000], mailbox: 0x62 });
    pre('swim at the pyramid', { word: SWIM, pos: [92.1, 0.6, 268.2], yaw: 1.2 });
    pre('swim interact bit', { word: SWIM | 0x1000, mailbox: 0x62 });
    // other modes do nothing
    for (const w of [8, 0x40, 0x20, 0x101, 0x401]) pre(`mode word 0x${w.toString(16)}`, { word: w });
    // groove transitions from a state other than the default
    pre('groove 2 -> clip 0x24 stays', { clip: 0x24, groove: 2, lastGroove: 2 });
    pre('groove 3 -> walk', { groove: 3, lastGroove: 3 });
    pre('groove 3 pending', { groove: 3, lastGroove: 1, word: SKATE, mailbox: 0x29 });

    notes.push(`pre-render events seen in the original: ${JSON.stringify(tally)}`);
    ok(tally.anim >= 10 && tally.groove >= 4 && tally.p2 >= 3 && tally.s2 >= 40 && tally.enter >= 2 && tally.tick >= 40, `the oracle scenarios exercise the node (${JSON.stringify(tally)})`);
    // ------------------------------------------------------------------------------------------------ (b) the update: temple sound, random sounds
    // the port's draw: rand() = floor(v * 32768) in 0..32767, FUN_004388ae(x) = fround(fround(rand / 32767) * fround(x)) (src/island/rng.ts): the test scripts rand() = k and gives the
    // original the same float product
    const fr32 = Math.fround;
    const valOf = (k, msv) => fr32(fr32(k / 32767) * fr32(msv));
    const kFor = (msv, want, skip = 0) => { for (let k = 0; k < 32768; k++) if (Math.trunc(valOf(k, msv)) % 2000 === want && skip-- <= 0) return k; return -1; };
    const upd = (name, st) => {
      const node = s.run(0x677350, [O.rec(PEPP), 0, 0, 0x5e, 0, 0]).eax;
      ms = st.ms; rng = valOf(st.k, st.ms);
      // the port's clock = FUN_00435c91 on the shared real clock: pinned (the zone start FUN_00435c81 at tick 5000, now 5000 + ms)
      setTickCountSource(() => 5000); startTickClock(); setTickCountSource(() => 5000 + st.ms);
      setIslandRandom(null);   // (an earlier test of the same process may have left the island's own source behind: draw from the shared crt.ts rand())
      setRandSource(() => st.k);
      eq(msClock(), st.ms, `${name}: msClock = real ms since the zone start`);
      ic.sounds.length = 0;
      const r = s.run(0x676cd0, [O.rec(PEPP), node]);
      const pn = portNode();
      pn.update(W, pep);
      const orig = [];
      for (const cl of r.calls) {
        if (cl.fn === 0x4435a0) orig.push(['p2', idOf(cl.args[0])]);
        else if (cl.fn === 0x4433f0) orig.push(['p3', idOf(cl.args[0]), [0, 1, 2].map((k) => mem.f32(cl.args[1] + 4 * k))]);
      }
      const port = ic.sounds.map((x) => (x.pos ? ['p3', x.id, x.pos.map(Math.fround)] : ['p2', x.id]));
      eq(r.eax, 2, `${name}: update returns 2`);
      eq(orig, port, `${name}: sounds`);
      return orig;
    };
    const MS = 9000;
    const temple = upd('no hit', { ms: MS, k: kFor(MS, 5) });
    ok(temple.length === 1 && temple[0][0] === 'p3' && temple[0][1] === 775, `the temple sound every tick (${JSON.stringify(temple)})`);
    for (const [v, id] of [[0x557, 0x30b], [0x15c, 0x30a], [0x2a7, 0x309]]) {
      for (const skip of [0, 3]) {
        const k = kFor(MS, v, skip);
        const r = upd(`hit 0x${v.toString(16)} (k ${k})`, { ms: MS, k });
        ok(k >= 0 && r.length === 2 && r[1][0] === 'p2' && r[1][1] === id, `hit 0x${v.toString(16)} plays ${id} (${JSON.stringify(r)})`);
      }
      for (const miss of [v - 1, v + 1]) { const k = kFor(MS, miss); const r = upd(`near miss ${miss}`, { ms: MS, k }); ok(r.length === 1, `near miss ${miss} plays only the temple sound`); }
    }
    for (const want of [0, 1, 1999]) upd(`value ${want}`, { ms: 30000, k: kFor(30000, want) });
    for (const k of [0, 1, 32767, 16384]) upd(`k ${k}`, { ms: 12345, k });
    setRandSource(null); setTickCountSource(null);

    // ------------------------------------------------------------------------------------------------ (c) the HUD FUN_006760d0
    {
      const hud = new Hud(null), ph = new PyaHud();
      ph.init(hud);
      ok(hud.left.tex === 0 && hud.left.tint === 0xffffffff && hud.right.tex === -1 && hud.column.length === 5 && hud.column.every((c) => c.tex === -1), 'HUD init = FUN_0045f9d2 + FUN_00676080');
      const text = (addr) => { let t = ''; for (let k = 0; mem.u32(addr + k) & 0xff; k++) t += String.fromCharCode(mem.u32(addr + k) & 0xff); return t; };
      // the original's HUD block: texts at DAT_05d4dd60 (score) / DAT_05d4dd20 (left), the icon of column slot 0 at DAT_05d4e144, the blink timer DAT_05d5bd9c
      const script = [];
      const icons = [0, 0x20, 1, 0x1e, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0, 0x21, 3, 0x40, 0x80, 0x40];
      for (let i = 0; i < 60; i++) script.push({ ic: icons[i % icons.length], ctrl: i % 7 === 3 ? 4 : 1, score: [0, 7, 1234, 99999, 0x7fffffff][i % 5], gems: [0, 1, 0x3ff, 0x400, 0x7, 0xffff][i % 6] });
      const f32 = (a) => mem.f32(a);
      for (const dt of [1, 0.5]) {   // the blink timer counts `1.0 * DAT_008b1718` (float32)
      mem.wf32(0x8b1718, dt); mem.wf32(0x8b171c, 1 / dt);
      mem.w32(0x5d5bd9c, 0); ph.blink = 0;
      for (const [i, sc] of script.entries()) {
        s.setVar(0xc, sc.ic); s.setVar(0x5e, sc.ctrl); s.setVar(0x17, sc.score); s.setVar(0xde, sc.gems);
        W.vars.set(0xc, sc.ic); W.vars.set(0x5e, sc.ctrl); W.vars.set(0x17, sc.score); W.vars.set(0xde, sc.gems);
        s.run(0x6760d0, []);
        ph.update(hud, W.vars, dt);
        const iconO = mem.u32(0x5d4e144) | 0;
        eq(text(0x5d4dd60), hud.centreText, `HUD dt ${dt} #${i}: centre text`);
        eq(text(0x5d4dd20), hud.leftText, `HUD dt ${dt} #${i}: left text`);
        if (i === 0 || sc.ic === 0 || ((sc.ic & 0x20) === 0 && (sc.ic & 1) === 0 && (sc.ic & 0x1e) === 0)) eq(iconO, hud.column[0].tex, `HUD dt ${dt} #${i}: icon`);
        else eq(iconO, hud.column[0].tex, `HUD dt ${dt} #${i}: icon (sticky)`);
        eq(f32(0x5d5bd9c), ph.blink, `HUD dt ${dt} #${i}: blink timer`);
        eq(s.mem.u32(0x8a2d2c + 4 * 0xc) | 0, W.vars.get(0xc) | 0, `HUD dt ${dt} #${i}: var 0xc reset`);
      }
      }
      // fmt04d against the C runtime for the values above and negatives
      for (const v of [0, 7, -5, 12345, -12345, 1234]) { s.setVar(0x17, v); s.run(0x6760d0, []); eq(text(0x5d4dd60), fmt04d(v), `%04d of ${v}`); }
    }
    return { checked, failures, notes };
  },
};
export default guarded(__test);
const SND_ON = 0x150, SND_OFF = 0x106;
void SND;
