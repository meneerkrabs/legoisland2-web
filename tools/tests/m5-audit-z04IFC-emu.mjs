// M5 audit z04IFC, the ORACLE test: the original's room code (controller FUN_0054bce3 / FUN_0054c00d, pins FUN_0054b982 with their constructor FUN_0054bc04, door FUN_0054caa1,
// sound loader FUN_0054cd70) is executed in the x86 interpreter (tools/lib/ifc-emu.mjs) next to the TypeScript port (`IfcRoom` of src/zones/z04IFC/ifc.ts); both get the same
// buttons and the same random numbers and the node state, the camera, the records' matrices, the caption, the selected pin, the sounds and the clips are compared tick by tick.
import { euler24 } from '../../src/zones/common/x87.ts';
import { loadExe, loadZone } from '../lib/engine-load.mjs';
import { IfcEmu, G } from '../lib/ifc-emu.mjs';
import { ifcNodesForTest } from '../../src/zones/z04IFC.ts';
import { IfcRoom, ST, SND, CLIP, PEPPER_PLACE, DOOR } from '../../src/zones/z04IFC/ifc.ts';
import { readIfcPages, labelId } from '../../src/zones/z04IFC/pages.ts';
import { B } from '../../src/game/input.ts';
import { setRandSource, setTickCountSource, randF } from '../../src/game/crt.ts';
import { msClock, startTickClock } from '../../src/zones/common/tickrand.ts';
import { guarded } from '../lib/inject-guard.mjs';

const TOL = 0;   // bit for bit (the oracle runs the x87 at 24 bit, like Direct3D leaves it)
/** the id strings the set-up copies into the pin nodes: `push <string>; push <dst>; call strcpy(0x85b570)` in FUN_0054ce86 (0x54ce86 .. 0x54e6e4), in code order */
function pinIds(pe) {
  const out = [];
  for (let a = 0x54ce86; a < 0x54e6e4 - 5; a++) {
    if (pe.at(a) !== 0xe8) continue;
    const rel = pe.u32(a + 1) | 0;
    if (((a + 5 + rel) >>> 0) !== 0x85b570) continue;
    for (let k = a - 1; k > a - 14; k--) {
      if (pe.at(k) === 0x68) { const va = pe.u32(k + 1); const s = pe.cstr(va, 16); if (/^IFC/.test(s)) { out.push(s); break; } }
    }
  }
  return out;
}

const __test = {
  name: 'm5-audit-z04IFC-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const pages = readIfcPages(pe);

    // ---- the zone: pins (records with the attach of FUN_0054bc04) and their id strings
    const Lz = loadZone(ctx, 'z04IFC');
    const pinAttaches = Lz.setup.attaches.filter((a) => a.ctor === 0x54bc04);
    const ids = pinIds(pe);
    checked++;
    if (pinAttaches.length !== 17 || ids.length !== 17) failures.push(`pins ${pinAttaches.length} ids ${ids.length}`);
    pinAttaches.forEach((a, k) => {
      checked++;
      const portId = labelId(pages[a.argWords[0]].items[0].label);
      if (portId !== ids[k]) failures.push(`pin record ${a.record} page ${a.argWords[0]}: the original's id ${ids[k]}, the port derives ${portId}`);
    });
    const pinRecs = pinAttaches.map((a) => a.record);
    const START_PIN = 47;

    /** one scripted run: `seed` drives the keys and the random numbers; `n` ticks */
    const run = (label, seed, n, pick, dt = 1) => {
      let s = seed >>> 0;
      const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
      const uQueue = [];
      const nextU = () => (uQueue.length ? uQueue.shift() : Math.floor(rnd() * 32768));     // the C runtime's rand(): 0..32767
      // port
      const L = loadZone(ctx, 'z04IFC');
      const recs = L.world.records;
      const init = recs.map((r) => ({ name: r.name, m: Array.from(r.m) }));
      const plog = [];
      let tick = 0;
      const host = {
        play: (id) => plog.push(`p ${id}`), restart: (id) => { plog.push(`s ${id}`, `p ${id}`); }, pepperClip: (c) => plog.push(`clip ${c}`),
        // the port's own draw (ifc.ts IfcHost.pick = z04IFC.ts: ftol(FUN_004388ae((float) FUN_00435c91())) % n on crt.ts rand() and the zone clock), on a scripted rand() and tick clock
        pick: (n) => Math.trunc(randF(Math.fround(msClock()))) % n, text: (id) => id, setVar: (i, v) => plog.push(`setVar ${i} ${v}`),
      };
      setTickCountSource(() => 5000 + Math.floor(tick * 1000 / 60)); setRandSource(() => nextU() & 0x7fff); startTickClock();
      const room = new IfcRoom(pages, host);
      const ctrlNode = ifcNodesForTest.controller(room);
      const pw = { dt, camera: { c: new Float32Array(18), updateView() { /* the matrices are not compared */ } } };
      const prec = { anim: { advance: (rate, d) => plog.push(`adv ${rate} ${d}`) } };
      pinAttaches.forEach((a, k) => room.addPin(a.record, a.argWords[0], ids[k]));
      room.setSelected(START_PIN);
      // oracle
      const uQueue2 = [];
      const emu = new IfcEmu(pe, init, () => (uQueue2.length ? uQueue2.shift() : 0), () => msClock());
      emu.cpu.mem.wf32(0x8b1718, dt);   // DAT_008b1718
      emu.loadSounds();
      emu.makeController(); emu.makeDoor();
      pinAttaches.forEach((a, k) => emu.makePin(a.record, a.argWords[0], ids[k]));
      emu.select(START_PIN);
      const mem = emu.cpu.mem;
      let worst = 0;
      const cmpN = (t, name, o, p) => {
        checked++;
        const d = Math.abs(o - p); worst = Math.max(worst, d);
        if (!(d <= TOL * Math.max(1, Math.abs(o))) && failures.length < 12) failures.push(`${label}: tick ${t} ${name}: original ${o} port ${p} (state ${room.state})`);
      };
      const cmpS = (t, name, o, p) => { checked++; if (o !== p && failures.length < 12) failures.push(`${label}: tick ${t} ${name}: original ${JSON.stringify(o)} port ${JSON.stringify(p)}`); };
      const stats = { sounds: 0, states: new Set(), askTurns: 0, menus: 0, maxPinMoves: 0, moves: 0 };
      let sinceMenu = 0, sinceAsk = 0;
      for (let t = 0; t < n; t++) {
        const pressed = pick(t, rnd, room);
        // the same random number for both (rand() is called at most once per tick in the controller)
        const u = Math.floor(rnd() * 32768); uQueue.push(u); uQueue2.push(u);
        tick++;
        // ---- port: the nodes' update order is the record order: Pepper's controller (7), the door (30), the pins; then the controller's pre-render
        plog.length = 0;
        const r = room.update(pressed);
        if (r.placePepper) recs[7].m.set(euler24(0, PEPPER_PLACE.yaw, 0, PEPPER_PLACE.x, PEPPER_PLACE.y, PEPPER_PLACE.z));
        const a = room.doorUpdate();
        recs[30].m.set(euler24(0, Math.fround(a * DOOR.DEG), 0, DOOR.X, DOOR.Y, DOOR.Z));
        for (const pr of pinRecs) { const y = room.pinUpdate(pr, recs[pr].y); if (y !== recs[pr].y) recs[pr].y = y; }
        ctrlNode.prerender(pw, prec);   // FUN_0054c00d: the camera and Pepper's `FUN_0043b76a(anim, 1.0)` (the port's node code itself, the advance logged with the dt it passes)
        // ---- oracle
        const olog = emu.tick(pressed, pinRecs);
        uQueue.length = 0; uQueue2.length = 0;
        cmpS(t, 'calls', olog.join(','), plog.join(','));
        const ctl = emu.ctl, door = emu.door;
        cmpN(t, 'state', emu.i(ctl + 0x18), room.state);
        cmpN(t, 'cnt', emu.i(ctl + 0x1c), room.cnt);
        cmpN(t, 'menuOpen', emu.i(G.MENU_OPEN), room.menuOpen);
        cmpN(t, 'pinsOff', emu.i(G.PINS_OFF), room.pinsOff);
        cmpN(t, 'exitAsk', emu.i(G.EXIT_ASK), room.exitAsk);
        cmpN(t, 'doorWanted', emu.i(G.DOOR_WANTED), room.doorWanted);
        cmpN(t, 'doorState', emu.i(door + 0x18), room.doorState);
        cmpN(t, 'doorAngle', emu.f(door + 0x1c), room.doorAngle);
        const sel = emu.vars.get(0xfa);
        cmpN(t, 'selected', ((sel - 0x10000000) / 0x68) | 0, room.selected);
        for (let k = 0; k < 3; k++) { cmpN(t, `eye${k}`, emu.f(G.CAM + 4 * k), room.eye[k]); cmpN(t, `target${k}`, emu.f(G.CAM + 12 + 4 * k), room.target[k]); }
        for (const ri of [7, 30]) for (let k = 0; k < 16; k++) cmpN(t, `rec${ri}.m${k}`, emu.f(emu.recPtr(ri) + 0xc + 4 * k), recs[ri].m[k]);
        for (const pr of pinRecs) {
          cmpN(t, `pin${pr}.y`, emu.f(emu.recPtr(pr) + 0xc + 4 * 13), recs[pr].m[13]);
          cmpN(t, `pin${pr}.angle`, emu.f(emu.pins.get(pr) + 0x24), room.pins.get(pr).angle);
        }
        cmpS(t, 'caption', mem.cstr(G.CAPTION), room.caption);
        for (const x of olog) if (x.startsWith('p ')) { stats.sounds++; if (+x.slice(2) >= 0x2bb) stats.sporadic = (stats.sporadic ?? 0) + 1; }
        stats.states.add(room.state);
        // ---- the host's part: the info menu ends after a few ticks (FUN_0054c398: state 1, menu flag off, Pepper's clip 0x78), the exit question is answered (cancel)
        if (room.state === ST.MENU) { stats.menus += sinceMenu === 0 ? 1 : 0; sinceMenu++; } else sinceMenu = 0;
        if (sinceMenu > 4) {
          mem.w32(emu.ctl + 0x18, 1); mem.w32(G.MENU_OPEN, 0); emu.cpu.call(0x43b6a3, [emu.pepperAnim, 0x78, 0]);
          room.state = ST.MAP; room.menuOpen = 0; host.pepperClip(CLIP.MENU_CLOSE);
          emu.log = []; plog.length = 0; sinceMenu = 0;
        }
        if (room.exitAsk) { stats.askTurns += sinceAsk === 0 ? 1 : 0; sinceAsk++; } else sinceAsk = 0;
        if (sinceAsk > 3) { mem.w32(G.EXIT_ASK, 0); room.exitAnswered(false); sinceAsk = 0; }
      }
      notes.push(`${label}: ${n} ticks, worst difference ${worst.toExponential(1)}, ${stats.sounds} sounds, ${stats.menus} menu openings, ${stats.askTurns} exit questions, states ${[...stats.states].sort().join('')}`);
      return stats;
    };

    // a scripted walk through the room: fly-in, zoom to the map, pin keys, open and close the menu, zoom out, the turn (exit question, cancel), zoom again
    const script = [[40, 0], [1, B.UP], [30, 0], [1, B.LEFT], [2, 0], [1, B.RIGHT], [1, B.RIGHT], [1, B.LEFT], [1, B.SHIFT], [10, 0], [1, B.ENTER], [10, 0], [1, B.DOWN], [30, 0], [1, B.LEFT], [20, 0], [1, B.DOWN], [20, 0], [1, B.UP | B.LEFT], [30, 0]];
    const flat = []; for (const [c, k] of script) for (let i = 0; i < c; i++) flat.push(i === 0 ? k : 0);
    const st1 = run('script', 11, flat.length, (t) => flat[t]);
    checked++; if (st1.menus < 1 || st1.askTurns < 1) failures.push('script: menu / exit question not reached');
    // random keys (every combination of the six keys the room reads, often idle) over many ticks: sporadic sounds, pins at both ends, key combos
    const KEYS = [0, 0, 0, 0, B.LEFT, B.RIGHT, B.LEFT, B.RIGHT, B.UP, B.DOWN, B.SHIFT, B.ENTER, B.LEFT | B.RIGHT, B.UP | B.SHIFT, B.ESC, B.CTRL];
    for (const seed of [5, 77, 1234]) {
      const st = run(`random${seed}`, seed, 6000, (_t, rnd) => (rnd() < 0.3 ? KEYS[Math.floor(rnd() * KEYS.length) % KEYS.length] : 0));
      checked++; if (st.sounds < 20 || !(st.sporadic > 0)) failures.push(`random${seed}: too few sounds (${st.sounds}), sporadic ${st.sporadic}`);
      notes.push(`random${seed}: sporadic ambient sounds ${st.sporadic}`);
    }
    // the same at dt = 0.5 (the 60 Hz step: the counters of the room are per frame, only Pepper's / the figures' animation steps by rate * DAT_008b1718)
    run('script dt0.5', 12, flat.length, (t) => flat[t], 0.5);
    run('random dt0.5', 78, 6000, (_t, rnd) => (rnd() < 0.3 ? KEYS[Math.floor(rnd() * KEYS.length) % KEYS.length] : 0), 0.5);
    // the sound ids of the room's slots (FUN_0054cd70: DAT_05d587d8 .. 05d5880c hold the ids the controller plays)
    const e0 = new IfcEmu(pe, [{ name: 'PEPP', m: new Array(16).fill(0) }], () => 0);
    e0.loadSounds();
    const slot = (a) => e0.i(a);
    for (const [a, id, nm] of [[0x5d587ec, SND.MAINLOOP, 'MAINLOOP'], [0x5d587d8, SND.MAINON, 'MAINON'], [0x5d5880c, SND.MAINOFF, 'MAINOFF'], [0x5d58804, SND.TYPING, 'TYPING'], [0x5d58808, SND.PRINTER, 'PRINTER'],
      [0x5d587dc, SND.GARAGE2, 'GARAGE2'], [0x5d587e0, SND.GARAGE3, 'GARAGE3'], [0x5d587e4, SND.BOING, 'BOING'], [0x5d587e8, SND.WIBBLE, 'WIBBLE'],
      [0x5d587f8, SND.INFO[0], 'INFO1'], [0x5d587fc, SND.INFO[1], 'INFO2'], [0x5d58800, SND.INFO[2], 'INFO3']]) {
      checked++; if (slot(a) !== id) failures.push(`sound slot ${nm}: original ${slot(a)}, port ${id}`);
    }
    setRandSource(null); setTickCountSource(null);
    return { checked, failures, notes };
  },
};
export default guarded(__test);
