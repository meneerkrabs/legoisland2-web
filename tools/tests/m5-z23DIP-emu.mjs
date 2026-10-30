// M5 z23DIP, the ORACLE test: the Dino island's own code (PeppSw's update FUN_00727360 and pre-render FUN_007277f1, the balloon FUN_007281aa / FUN_00727fe3, the HUD function
// FUN_00726610) is executed in the x86 interpreter after the emulated set-up (tools/lib/z23DIP-emu.mjs) next to the TypeScript port (src/zones/z23DIP/*); both get the same
// scripted state (buttons, PEPPER_CONTROL, Pepper's state mailbox / clip / place / forward row, a scripted terrain, the same random numbers, the cutscene flag, the game
// variables) and everything the code does is compared: Pepper's place, the game variables it writes, the animation starts, the board's flags, the sounds it asks for (2D play,
// 3D play at a place, stops), the music groove calls, the node's state words, the decor calls. See docs/re/m5/z23DIP.md section "Verification".
import { loadHub } from '../lib/hub-load.mjs';
import '../../src/zones/index.ts';
import { dipAfterSetup, } from '../../src/zones/z23DIP/index.ts';
import { dipOracle, STRIDE } from '../lib/z23DIP-emu.mjs';
import { setIslandRandom } from '../../src/island/rng.ts';
import { setDecorHooks } from '../../src/zones/z23DIP/pepsw.ts';
import { LoonNode } from '../../src/zones/z23DIP/loon.ts';
import { REC, CTOR } from '../../src/zones/z23DIP/consts.ts';
import { DipHudState, initDipHud, updateDipHud } from '../../src/zones/z23DIP/hud.ts';
import { Hud } from '../../src/shell/hud.ts';
import { GameVars } from '../../src/game/vars.ts';

const fr = Math.fround;
/** the records the update's sounds are played at */
const SOUND_RECORDS = [REC.HALL, REC.PTER, REC.REX1, REC.REX4, REC.BRON, REC.TRI1, REC.TRI2, REC.STE1, REC.STE2, REC.TRX1, REC.TRX2];
/** a small deterministic generator (mulberry32) */
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const pick = (r, l) => l[Math.floor(r() * l.length)];
const close = (a, b, tol = 0) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= tol * Math.max(1, Math.abs(a));

/** the scripted terrain both sides use: a function of the sample's place on a 0.05 grid and dy (null = no ground) */
function terrainOf(seed) {
  return (x, y, z, dy) => {
    const gx = Math.round(fr(x) * 20), gy = Math.round(fr(y) * 20), gz = Math.round(fr(z) * 20);
    let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ Math.imul(gz, 83492791) ^ seed ^ Math.round(dy)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const k = h % 8;
    return [null, -100, -80, -79.99, 5, 0.7, 12.5, -1e30][k];
  };
}

const inner = {
  name: 'm5-z23DIP-emu',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c && failures.length < 40) failures.push(msg); };
    const eq = (label, a, b, tol = 0) => { checked++; if (!close(a, b, tol) && failures.length < 40) failures.push(`${label}: original ${a} port ${b}`); };

    // ------------------------------------------------------------------------------------------------ PeppSw: update (sounds) + pre-render (modes)
    for (const node of [47, 50]) {
      const rnd = prng(7 + node);
      const terrain = terrainOf(node);
      const RAND_POOL = [0, 3277, 16384, 31130, 32456, 32500, 32550, 32600, 32700, 32767];       // hits 297 / 298 / 299 / 300 of 300 now and then
      const poolO = prng(5), poolP = prng(5);
      const O = dipOracle(ctx, { node, terrain, rand: () => RAND_POOL[Math.floor(poolO() * RAND_POOL.length)] / 32767 });
      const H = loadHub(ctx, { zone: 'z23DIP', node });
      for (const rec of H.world.records) for (const n of rec.ctrl?.nodes ?? []) n.ctorInit?.(H.world, rec);
      dipAfterSetup({ ictx: H.ictx, world: H.world, loaded: H.L, archive: H.archive });
      const w = H.world, pep = H.pepper;
      w.col.terrainHeight = (x, y, z, dy) => { const h = terrain(x, y, z, dy); return h === null ? -1e38 : h; };
      setIslandRandom(() => RAND_POOL[Math.floor(poolP() * RAND_POOL.length)] / 32768);
      const sw = pep.ctrl.nodes.find((n) => n.kind === 'PeppSw');
      ok(!!sw && pep.ctrl.nodes[0] === sw && !pep.ctrl.nodes.some((n) => n.kind === 'StubGuard') && pep.ctrl.nodes.map((n) => n.kind).join() === 'PeppSw,SGwalk,sgswim,skate', `node ${node}: Pepper's chain ${pep.ctrl.nodes.map((n) => n.kind)}`);
      // the port's context log
      const P = { snd: [], groove: [], decor: [], starts: [] };
      H.ictx.sfx = (id) => P.snd.push(['p2', id]);
      H.ictx.sfxAt = (id, pos) => P.snd.push(['p3', id, [...pos]]);
      H.ictx.stopSfx = (id) => P.snd.push(['stop', id]);
      H.ictx.musicGroove = (l) => P.groove.push(l);
      w.sfx = { play: (id) => P.snd.push(['p2', id]) };
      setDecorHooks(w, { enter: () => P.decor.push('enter'), tick: () => P.decor.push('tick') });
      const skbd = w.records[REC.SKBD];
      for (const r of [pep, skbd]) { const a = r.anim; const st = a.start.bind(a); a.start = (c, f) => { P.starts.push([r === pep ? 'PEPP' : 'SKBD', c, f]); return st(c, f); }; }
      const rex = [REC.REX1, REC.REX2, REC.REX3, REC.REX4, REC.REX5, REC.REX6, REC.REX7];

      // same start: Pepper's arrival place (the node's last good place), the board hidden
      const start = O.getPos(16);
      eq(`node ${node}: arrival x`, start[0], pep.x, 1e-6); eq(`node ${node}: arrival z`, start[2], pep.z, 1e-6);
      const nodeO = O.makeNode(node, start);
      ok(sw.returnVisit === (node === 50) && sw.safe[0] === pep.x, `node ${node}: constructor part (story node 50 flag, last good place)`);
      O.emu.setVar(0x5e, 1); w.vars.set(0x5e, 1);
      const kinds = {}, trans = {};
      const N = 4000;
      for (let t = 0; t < N; t++) {
        // ---- the scripted state of this tick
        const bits = (rnd() < 0.5 ? 0x10 : 0) | (rnd() < 0.15 ? 0x10000 : 0);
        const word = pick(rnd, [1, 1, 1, 2, 4, 4, 8, 0x1001, 0x1004, 0x1002, 0x41, 0x401, 0x1040, 0x104]);
        const mailbox = pick(rnd, [0x1b, 0x1b, 0, 1, 2, 0x20, 0x21, 0x32, 0x57, 0x1f, 0x38, 0x16, 0x1c]);
        const clip = pick(rnd, [0x1b, 0x3a, 99, 0x62, 0x24, 0x3f, 0x40, 0x16, 0x20, 0x1c, 0x0d]);
        const y = pick(rnd, [-200, -80, -79.99, -80.01, -10, 0.7, 50, 3.25]);
        const x = fr((rnd() - 0.5) * 200), z = fr((rnd() - 0.5) * 200);
        const a = rnd() * 6.283;
        const fx = fr(Math.sin(a) * 0.9), fy = fr((rnd() - 0.5) * 0.6), fz = fr(Math.cos(a) * 0.9);
        const frames = rex.map(() => pick(rnd, [0, 1.5, 3.99, 4, 7, 10.5]));
        const place = [x, fr(y), z];
        // original
        O.setPos(16, ...place); O.setFwd(16, fx, fy, fz);
        O.emu.setVar(0x5e, word); O.setInput(bits); O.setMailbox(mailbox); O.setClip(16, clip);
        O.setFlags(28, O.flags(28) & ~2);
        rex.forEach((r, k) => O.setFrame(r, frames[k]));
        // the records whose places the sounds read are static here (no tick runs), but the walkers / constructors of the port's node families put some of them on their waypoint
        // (the original's constructors do that too: the emulation does not run them), so both sides read the port's places
        for (const i of SOUND_RECORDS) O.setPos(i, w.records[i].x, w.records[i].y, w.records[i].z);
        // port
        pep.x = place[0]; pep.y = place[1]; pep.z = place[2]; pep.m[8] = fx; pep.m[9] = fy; pep.m[10] = fz;
        w.vars.set(0x5e, word); w.input.pressed = bits; w.pep.mailbox = mailbox; pep.anim.clip = clip;
        skbd.flags &= ~2;
        rex.forEach((r, k) => { w.records[r].anim.frame = frames[k]; });
        P.snd.length = 0; P.groove.length = 0; P.decor.length = 0; P.starts.length = 0;

        // ---- update (FUN_00727360)
        const ru = O.call(0x727360, [O.recPtr(16), nodeO]);
        const retP = sw.update(w, pep);
        eq(`node ${node} tick ${t}: update return`, ru.eax, retP);
        const so = ru.snd.map((s) => JSON.stringify([s[0], s[1], s[2]?.map((v) => +v.toFixed(3))])).join(' ');
        const sp = P.snd.map((s) => JSON.stringify([s[0], s[1], s[2]?.map((v) => +fr(v).toFixed(3))])).join(' ');
        ok(so === sp, `node ${node} tick ${t}: update sounds\n  original ${so}\n  port     ${sp}`);
        for (const s of ru.snd) kinds[`${s[0]}:${s[1]}`] = (kinds[`${s[0]}:${s[1]}`] ?? 0) + 1;
        P.snd.length = 0;

        // ---- pre-render (FUN_007277f1)
        const rp = O.call(0x7277f1, [O.recPtr(16), nodeO]);
        sw.prerender(w, pep);
        const pp = O.getPos(16);
        eq(`node ${node} tick ${t}: x`, pp[0], pep.x); eq(`node ${node} tick ${t}: y`, pp[1], pep.y); eq(`node ${node} tick ${t}: z`, pp[2], pep.z);
        eq(`node ${node} tick ${t}: PEPPER_CONTROL`, O.vars.get(0x5e), w.vars.get(0x5e));
        eq(`node ${node} tick ${t}: mailbox`, O.getMailbox(), w.pep.mailbox & 0xff);
        eq(`node ${node} tick ${t}: Pepper's clip`, O.getClip(16), pep.anim.clip);
        eq(`node ${node} tick ${t}: board shown`, O.flags(28) & 2, skbd.flags & 2);
        const st = (s) => s.map((q) => `${q[0]}:${q[1]}`).join(' ');
        const startsO = rp.starts.map((s) => [O.animToken(16) === s.token ? 'PEPP' : O.animToken(28) === s.token ? 'SKBD' : '?', s.clip, s.frame]);
        ok(st(startsO) === st(P.starts), `node ${node} tick ${t}: animation starts original ${st(startsO)} port ${st(P.starts)}`);
        const sndO = rp.snd.map((s) => s[0] + ':' + s[1]);
        // the original stops the eight rolling sounds one by one (two of them are the same id), the port each distinct id once
        const norm = (l) => [...new Set(l)].sort().join(' ');
        ok(norm(sndO.map((q) => q.replace(/^s[23]:/, 's:'))) === norm(P.snd.map((s) => (s[0] === 'stop' ? 's:' : s[0] + ':') + s[1])), `node ${node} tick ${t}: sounds original ${sndO} port ${P.snd.map((s) => s[0] + ':' + s[1])}`);
        ok(JSON.stringify(rp.groove) === JSON.stringify(P.groove), `node ${node} tick ${t}: groove original ${rp.groove} port ${P.groove}`);
        { const k = `${word & 0xfff}>${w.vars.get(0x5e) & 0xfff}/${w.pep.mailbox !== mailbox ? w.pep.mailbox.toString(16) : '-'}${(pep.y <= -80 || y <= -80) ? 'w' : ''}`; trans[k] = (trans[k] ?? 0) + 1; }
        const dO = rp.calls.filter((c) => c.fn === 0x765281 || c.fn === 0x765316).map((c) => (c.fn === 0x765281 ? 'enter' : 'tick'));
        ok(dO.join() === P.decor.join(), `node ${node} tick ${t}: decor calls original ${dO} port ${P.decor}`);
        const nsO = O.nodeState(nodeO);
        eq(`node ${node} tick ${t}: node level`, nsO.groove, sw.groove); eq(`node ${node} tick ${t}: node last level`, nsO.last, sw.lastGroove);
        for (let k = 0; k < 3; k++) eq(`node ${node} tick ${t}: node last good place ${k}`, nsO.safe[k], sw.safe[k]);
        // the original left the position it wrote: carry it as the next tick's start only through the scripted state above (each tick sets its own)
        if (failures.length >= 40) break;
      }
      notes.push(`node ${node}: ${N} ticks of PeppSw (update + pre-render); update sounds seen ${JSON.stringify(kinds)}`);
      notes.push(`node ${node}: pre-render transitions (control before > after / new mailbox, w = at or below the sea): ${Object.entries(trans).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
      for (const k of ['1>4/16', '4>1/1c', '2>1/25']) ok(Object.keys(trans).some((q) => q.startsWith(k)), `node ${node}: transition ${k} exercised`);
      if (node === 50) {
        // the rare branches of the random draws were hit
        for (const id of [0x322, 0x321, 0x320, 0x31f, 0x31e]) ok(Object.keys(kinds).some((k) => k === `p3:${id}`), `node 50: the random sound ${id.toString(16)} was exercised`);
      }
      setIslandRandom(null);
    }

    // ------------------------------------------------------------------------------------------------ the balloon LOON
    for (const dt of [1, 0.5]) {
      const rnd = prng(11);
      let cut = false;
      const O = dipOracle(ctx, { node: 50, cutscene: () => cut });
      const H = loadHub(ctx, { zone: 'z23DIP', node: 50 });
      const w = H.world, loon = w.records[REC.LOON];
      const n = loon.ctrl?.nodes.find((x) => x instanceof LoonNode);
      ok(!!n && n.var === 2 && n.mask === 1 && n.value === 1, `LOON: the balloon node attached with the gate var 2 & 1 == 1`);
      ok((loon.flags & 2) !== 0 && (O.flags(REC.LOON) & 2) !== 0, `LOON: visible after the node-50 set-up (port ${loon.flags}, original ${O.flags(REC.LOON)})`);
      O.mem.wf32(0x8b1718, dt); w.dt = dt;
      const nodeP = O.emu.alloc(0x40);
      O.mem.w32(nodeP, 2);
      const rc = O.call(CTOR.LOON, [O.recPtr(REC.LOON), 0, nodeP, 2, 1, 1]);
      // the port's constructor part runs at the framework's ctorInit
      const y0 = loon.y;
      n.ctorInit(w, loon);
      eq(`LOON dt ${dt}: constructor y`, O.getPos(REC.LOON)[1], loon.y); eq(`LOON dt ${dt}: constructor base`, O.mem.f32(nodeP + 0x14), n.baseY);
      ok(Math.abs(loon.y - fr(y0 + 17.600000381469727)) < 1e-4, `LOON: lifted by 17.6 (${y0} -> ${loon.y})`);
      let hidden = -1;
      for (let t = 0; t < 1200; t++) {
        if (t % 97 === 0) cut = rnd() < 0.4;
        const ru = O.call(0x727fe3, [O.recPtr(REC.LOON), nodeP]);
        const retP = n.update(w, loon);
        eq(`LOON dt ${dt} tick ${t}: return`, ru.eax, retP);
        eq(`LOON dt ${dt} tick ${t}: y`, O.getPos(REC.LOON)[1], loon.y); eq(`LOON dt ${dt} tick ${t}: z`, O.getPos(REC.LOON)[2], loon.z);
        eq(`LOON dt ${dt} tick ${t}: visible`, O.flags(REC.LOON) & 2, loon.flags & 2);
        eq(`LOON dt ${dt} tick ${t}: speed y`, O.mem.f32(nodeP + 0x18), n.vy); eq(`LOON dt ${dt} tick ${t}: speed z`, O.mem.f32(nodeP + 0x1c), n.vz);
        if (hidden < 0 && (loon.flags & 2) === 0) hidden = t;
        if (failures.length >= 40) break;
      }
      ok(hidden > 0, `LOON dt ${dt}: the balloon rose out of sight (hidden at tick ${hidden})`);
      notes.push(`LOON dt ${dt}: 1200 ticks, hidden at tick ${hidden}, y ${loon.y.toFixed(2)} z ${loon.z.toFixed(2)}`);
    }

    // ------------------------------------------------------------------------------------------------ the HUD function FUN_00726610
    {
      const rnd = prng(23);
      const O = dipOracle(ctx, { node: 47 });
      const mem = O.mem;
      mem.w32(0x5d4e144, 0xffffffff);                  // FUN_0045f9d2: the column slot starts at -1
      const hud = new Hud(null), vars = new GameVars(), st = new DipHudState();
      initDipHud(hud);
      for (const dt of [1, 0.5]) {
        mem.wf32(0x8b1718, dt); mem.wf32(0x5d5d104, 0); st.blink = 0;
        for (let t = 0; t < 1500; t++) {
          const score = pick(rnd, [0, 5, 123, 9999, 12345, 70000]), gems = Math.floor(rnd() * 0x800), ic = pick(rnd, [0, 0, 1, 2, 4, 8, 0x1e, 0x20, 0x21, 0x40, 0x80, 0xc0, 0xc1, 0x60]);
          const ctl = pick(rnd, [1, 1, 8, 4, 2, 0x101]);
          for (const [i, v] of [[0x17, score], [0x3c, gems], [0xc, ic], [0x5e, ctl]]) { O.emu.setVar(i, v); vars.set(i, v); }
          const r = O.call(0x726610, []);
          updateDipHud(hud, vars, st, dt);
          const s = (a) => mem.cstr(a);
          ok(s(0x5d4dd60) === hud.centreText, `HUD tick ${t}: centre "${s(0x5d4dd60)}" vs "${hud.centreText}"`);
          ok(s(0x5d4dd20) === hud.leftText, `HUD tick ${t}: left "${s(0x5d4dd20)}" vs "${hud.leftText}"`);
          eq(`HUD tick ${t}: icon (ic ${ic} ctl ${ctl})`, mem.r32(0x5d4e144) | 0, hud.column[0].tex);
          eq(`HUD tick ${t}: blink`, mem.f32(0x5d5d104), st.blink);
          eq(`HUD tick ${t}: var 0xc`, O.vars.get(0xc), vars.get(0xc));
          if (failures.length >= 40) break;
        }
      }
      notes.push('HUD: 3000 ticks of FUN_00726610 against updateDipHud (dt 1 and 0.5)');
    }
    setIslandRandom(null);
    return { checked, failures, notes };
  },
};

// the executable runs the x87 in 24-bit mode (Direct3D 7 leaves control word 0x7f): the emulator is created with it for this test only (the Cpu reads M7_CW when it is created; a
// module-level assignment would leak into every test that runs later in the same process, e.g. the default-control-word test of x86emu)
export default {
  name: inner.name,
  run(ctx) {
    const old = process.env.M7_CW;
    process.env.M7_CW = '127';
    try { return inner.run(ctx); } finally { if (old === undefined) delete process.env.M7_CW; else process.env.M7_CW = old; }
  },
};
