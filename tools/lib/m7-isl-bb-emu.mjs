// WP-VERIFY M7b: BrickBot.c / botPConly.c (FUN_00531d45 / 005327b1 / 00532acc / 00533ba8 / 0053de63) and the NPC families of the eras 1-4 against the ORIGINAL's code in the x86 emulation.
// Built on the island NPC oracle (tools/lib/m7-isl-npc-emu.mjs, docs/re/m4/wp3-npc.md "Differential test (WP-VERIFY M7)"): this file only adds the bot node field maps, the 3D sound hook and the
// native range of botPConly (0x53d800 .. 0x53e000, outside the NPC oracle's range 0x4af2f7 .. 0x53d7da). Nothing of the existing lib is edited (NODE_MAPS gets entries for the new node kinds).
import { loadIsland } from './island-load.mjs';
import { startBrickBots } from '../../src/island/npc/brickbot.ts';
import { walkSpace } from '../../src/island/pizza/pizza.ts';
import { createPair, runPair, newStats, placePepper, pepperAt, sgOf, setVar, IslNpcEmu, NODE_MAPS, CTORS, RB, REC, G, stepPair, compareState, checkSubtitles } from './m7-isl-npc-emu.mjs';

export { runPair, newStats, placePepper, pepperAt, sgOf, setVar, CTORS, RB, REC, G };
export const BB_CTORS = { FOLLOW: 0x531d45, HIT: 0x5327b1, HARASS: 0x532acc, HIDE: 0x533ba8, PCONLY: 0x53de63 };
export const BB_KINDS = ['BotFollow', 'BotHit', 'BotHarass', 'BotHide', 'BotPcOnly'];
export const PIZZA_CTORS = { PIZZA: 0x42887c, HAND: 0x42900b, CARRY: 0x429d1b };
export const NPC_CTORS = [CTORS.SGMFIG, CTORS.Human1, CTORS.Launch, CTORS.T2PA, CTORS.T2PB, CTORS.T2PC, CTORS.MeetPepp];
export const MINE_BB = new Set([...NPC_CTORS, BB_CTORS.FOLLOW, BB_CTORS.HIT, BB_CTORS.HARASS, BB_CTORS.HIDE, BB_CTORS.PCONLY]);

const recPtr = (i) => RB + i * REC;
const ptrOf = (r) => (r ? recPtr(r.index) : 0);
const bool = (v) => (v ? 1 : 0);
// node field maps [offset, type, getter]: the node blocks of the original (sizes 0xc0 / 0x30 / 0x1c / 0x44 / 0x2c) and the port's fields (src/island/npc/brickbot.ts)
const hist = [];
for (let i = 0; i < 5; i++) for (let k = 0; k < 3; k++) { hist.push([0x1c + 12 * i + 4 * k, 'f32', (n) => n.hist[i][k]]); hist.push([0x58 + 12 * i + 4 * k, 'f32', (n) => n.eul[i][k]]); }
export const BB_MAPS = {
  BotFollow: [
    [0x14, 'f32', (n) => n.dist], [0x18, 'i32', (n) => n.type], [0x94, 'u32', (n) => ptrOf(n.leader)], [0x98, 'i32', (n) => n.idx],
    [0xa8, 'f32', (n) => n.gag], [0xac, 'i32', (n) => n.state], [0xb0, 'i32', (n) => n.leaderClip], [0xb8, 'f32', (n) => n.frame], [0xbc, 'i32', (n) => n.taps], ...hist,
  ],
  BotHit: [
    [0x1c, 'f32', (n) => n.scale], [0x20, 'i16', (n) => n.count], [0x22, 'i16', (n) => n.dying], [0x24, 'u8', (n) => n.armed], [0x25, 'u8', (n) => n.fresh], [0x26, 'i16', (n) => n.how],
    [0x28, 'i16', (n) => n.victim], [0x2a, 'i16', (n) => n.waving], [0x2c, 'f32', (n) => n.pause],
  ],
  BotHarass: [[0x18, 'f32', (n) => n.face]],
  BotHide: [
    [0x14, 'i16', (n) => n.anchor], [0x16, 'i16', (n) => n.actVar], [0x18, 'i16', (n) => n.actValue], [0x1a, 'i16', (n) => n.actOp], [0x1c, 'u32', (n) => ptrOf(n.target)], [0x20, 'i32', (n) => n.runClip],
    [0x24, 'i32', (n) => n.state], [0x28, 'i16', (n) => n.prev], [0x2a, 'i16', (n) => n.ring], [0x2c, 'f32', (n) => n.away], [0x30, 'f32', (n) => n.reloc], [0x34, 'f32', (n) => n.hidden],
  ],
  BotPcOnly: [
    [0x14, 'i32', (n) => n.args.nodeA], [0x18, 'i32', (n) => n.args.nodeB], [0x1c, 'u32', (n) => (n.args.tbob >= 0 ? recPtr(n.args.tbob) : 0)], [0x20, 'f32', (n) => n.lastY], [0x24, 'f32', (n) => n.run],
    [0x28, 'i16', (n) => n.which], [0x2a, 'u8', (n) => bool(n.arrived)], [0x2b, 'u8', (n) => bool(n.falling)],
  ],
};
Object.assign(NODE_MAPS, BB_MAPS);

/**
 * the pair for a story node with the bot nodes (and optionally the pizza nodes) run natively. o: { node, dt, seed, pizza: bool, ctors (extra), keep (extra port kinds) }
 */
export function createBB(ctx, o = {}) {
  const ctors = new Set([...MINE_BB, ...(o.pizza ? [PIZZA_CTORS.PIZZA, PIZZA_CTORS.HAND, PIZZA_CTORS.CARRY] : []), ...(o.ctors ?? [])]);
  const keep = [...BB_KINDS, ...(o.pizza ? ['Pizza', 'PizzaHand', 'PizzaCarry'] : []), ...(o.keep ?? [])];
  const orig = IslNpcEmu.prototype.buildNodes;
  IslNpcEmu.prototype.buildNodes = function (att) {
    this.cpu.exec.push([0x53d800, 0x53e000]);      // botPConly.c (0x53d990 ..) is above the oracle's native range
    this.cpu.invalidate();
    return orig.call(this, att);
  };
  let P;
  try { P = createPair(ctx, loadIsland, { node: o.node ?? 7, dt: o.dt ?? 1, ctors, seed: o.seed ?? 5, keep, recordOrder: o.recordOrder }); } finally { IslNpcEmu.prototype.buildNodes = orig; }
  // the constructors' world work of the port's bot nodes (FUN_005327b1 / 00531d45 / 00532acc / 00533ba8 in attach order: what startIslandNpcs ends with)
  if (!o.recordOrder) startBrickBots(P.w);
  const { E, ic } = P, H = E.cpu.hooks, mem = E.mem;
  // 3D sounds (the hit's Piza_Hit.wav at the bot: FUN_004433f0(handle, pos)): logged on both sides as `sfx3d <id>`; the handles of the two sounds the bots play are loaded like the island set-up does
  const ids = new Map();
  const load3 = H.get(0x4433b0), load2 = H.get(0x443580);
  H.set(0x4433b0, (c) => { load3(c); ids.set(c.eax, c.arg(0) | 0); });
  H.set(0x443580, (c) => { load2(c); ids.set(c.eax, c.arg(0) | 0); });
  H.set(0x4433f0, (c) => { E.log.push(`sfx3d ${ids.get(c.arg(0)) ?? `h${c.arg(0)}`}`); c.eax = 0; });
  // the pose of an animation instance (FUN_0043bc22 / 0043bc58: the pizza in Pepper's hand follows her bone 0xe): the port's AnimInstance pose of the current frame (a host choice, as in tools/lib/m7-zone-emu.mjs)
  const poseBufs = new Map();
  const poseOf = (ptr) => {
    let b = poseBufs.get(ptr);
    if (!b) { b = E.alloc(64 * 64); poseBufs.set(ptr, b); for (let i = 0; i < 64; i++) for (let k = 0; k < 4; k++) mem.wf32(b + i * 64 + k * 20, 1); }
    let rec = -1; for (const [i, blk] of E.animBlocks) if (blk === ptr) { rec = i; break; }
    const p = rec >= 0 ? P.w.records[rec].anim?.pose(1) : null;
    if (p) for (let i = 0; i < p.length && i < 64 * 16; i++) mem.wf32(b + 4 * i, p[i]);
    return b;
  };
  H.set(0x43bc22, (c) => { c.eax = poseOf(c.arg(0)); });
  H.set(0x43bc58, (c) => { c.eax = poseOf(c.arg(0)) + c.arg(1) * 0x40; });
  E.cpu.invalidate();
  // the island's sound loads (FUN_004b037e / 004b0b37 / 004b0f16, native: every `DAT_xxx = FUN_004433b0 / 00443580(id)`: DAT_05d58164 Piza_Hit.wav, DAT_009da8f4 Collect.wav, the pizza throw sounds ...): handles that remember their ids
  for (const a of [0x4b037e, 0x4b0b37, 0x4b0f16]) E.call(a, [], 20_000_000);
  ic.inFrustum = (r) => (P.view ? P.view(r) : true);      // the renderer's frustum test (record flag 1): scripted by `P.view` on both sides
  const sfxAt = ic.sfxAt.bind(ic);
  ic.sfxAt = (id, pos) => { P.events.push(`sfx3d ${id}`); sfxAt(id, pos); };
  return P;
}

/** the bot nodes of a record in the port: { follow: [..], hit, harass, hide, pconly } */
export function botNodes(rec) {
  const ns = rec.ctrl?.nodes ?? [];
  return { follow: ns.filter((n) => n.kind === 'BotFollow'), hit: ns.find((n) => n.kind === 'BotHit'), harass: ns.find((n) => n.kind === 'BotHarass'), hide: ns.find((n) => n.kind === 'BotHide'), pconly: ns.find((n) => n.kind === 'BotPcOnly') };
}
export const botRecords = (P) => P.w.records.filter((r) => r.ctrl?.nodes.some((n) => BB_KINDS.includes(n.kind)));

/** coverage of the bot nodes (the PORT's state, which equals the original's: the node fields are compared every tick): states / paths reached, summed over the run */
export function newCov() { return { ticks: 0, ran: {}, follow: {}, hide: {}, hit: {}, pc: {}, npc: {} }; }
const lastFace = new WeakMap();
export function covTick(P, cov) {
  const w = P.w, bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
  cov.ticks++;
  for (const r of w.records) {       // SGMFIG's pizza reaction (state bits 0x1000 | 0x2000) of the ordinary NPCs
    const sg = r.ctrl?.nodes[0]?.kind === 'SGMFIG' ? r.ctrl.nodes[0] : null;
    if (sg && !/^BB/.test(r.name) && (w.vars.get(sg.var) & 0x3000) !== 0) bump(cov.npc, `${r.name}:${w.vars.get(sg.var) & 0x3000 ? '0x' + (w.vars.get(sg.var) & 0x3000).toString(16) : ''}`);
  }
  for (const r of botRecords(P)) {
    const b = botNodes(r);
    r.ctrl.nodes.forEach((n, i) => { if (BB_KINDS.includes(n.kind) && (n.stamp === w.frame || r.ctrl.ran[i])) bump(cov.ran, n.kind); });
    for (const f of b.follow) if (f.stamp === w.frame) { bump(cov.follow, `type${f.type}/state${f.state}`); if (f.leader) bump(cov.follow, `leader-${f.leader.name}`); }
    if (b.harass) { if (lastFace.get(b.harass) !== b.harass.face) { bump(cov.ran, 'BotHarass(timer)'); lastFace.set(b.harass, b.harass.face); } }
    if (b.hide && b.hide.stamp === w.frame) bump(cov.hide, `state${b.hide.state}`);
    if (b.hit) {
      const h = b.hit, c = h.dying !== 0 ? `dying${h.dying}` : h.fresh === 0 ? `dazed-count${h.count}-how${h.how}` : h.waving ? 'waving' : h.armed ? 'armed' : 'disarmed';
      bump(cov.hit, c);
    }
    if (b.pconly && b.pconly.stamp === w.frame) bump(cov.pc, `which${b.pconly.which}${b.pconly.falling ? '-falling' : ''}${b.pconly.arrived ? '-arrived' : ''}`);
  }
}
export function mergeCov(a, b) {
  a.ticks += b.ticks;
  for (const k of ['ran', 'follow', 'hide', 'hit', 'pc', 'npc']) for (const [x, v] of Object.entries(b[k])) a[k][x] = (a[k][x] ?? 0) + v;
}
export const showCov = (c) => ['ran', 'follow', 'hide', 'hit', 'pc', 'npc'].map((k) => `${k}{${Object.entries(c[k]).map(([x, v]) => `${x}:${v}`).join(' ')}}`).join(' ');

/** a script generator for Pepper: chase the records `names` in turn (distance 30 -> 2.5 over `per` ticks, circling), `far` ticks at the origin first */
export function chaseScript(P, names, per, far = 30) {
  const recs = names.map((n) => P.w.records.find((r) => r.name === n)).filter(Boolean);
  return (t) => {
    if (t < far) { placePepper(P, 0, 0, 0, 0); return []; }
    const k = Math.floor((t - far) / per), u = ((t - far) % per) / per, rec = recs[k % recs.length];
    pepperAt(P, rec, 30 - 27.5 * u, (t - far) * 0.07);
    return [];
  };
}

/**
 * runPair of the NPC oracle plus the bot nodes' coverage: every difference of the original and the port is a failure (tolerance 0, nothing is re-synchronised: the former findings
 * BB1 gate, BB2 shrink, D4 ran bit, D5 yaw wrap, D8 / D9 hop arc and the float32 yaw noise of the hiding bots are fixed in the port).
 */
export function runBB(P, ticks, script, st, label = '') {
  const { w } = P;
  for (let t = 0; t < ticks; t++) {
    const keys = script(t, P) ?? [];
    const s = stepPair(P, keys);
    const tag = `${label}t${t}`;
    const r = compareState(P, tag);
    st.checked += r.checks; st.ticks++;
    for (const d of r.diffs) {
      if (d.k === 'probe' && /^PIZ\d$/.test(w.records[d.rec]?.name ?? '')) continue;     // the pizza records' controllers are the pizza nodes' own business (their probe is not the NPC probe machinery)
      if (st.fail.length < 14) st.fail.push(d.msg);
    }
    st.checked++;
    if (JSON.stringify(s.portEvents) !== JSON.stringify(s.emuEvents)) { if (st.fail.length < 14) st.fail.push(`${tag}: events: original ${JSON.stringify(s.emuEvents)} port ${JSON.stringify(s.portEvents)}`); }
    st.checked++;
    if (s.portDraws !== s.emuDraws) { if (st.fail.length < 14) st.fail.push(`${tag}: random draws: original ${s.emuDraws} port ${s.portDraws}`); }
    checkSubtitles(s, st, tag);
    st.events += s.portEvents.length;
    for (const e of s.portEvents) { if (e.startsWith('say ')) st.said.add(e); if (e.startsWith('cutscene')) st.cutscenes++; if (e.startsWith('sfx')) (st.sfx ??= new Map()).set(e, ((st.sfx ??= new Map()).get(e) ?? 0) + 1); }
  }
}


// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Pepper's pizza throw (the walk node's Space branch FUN_0042d514 0x42da7d ..: prelude FUN_00427c15, launch FUN_004277d0, hand-over FUN_00428a0a) on both sides, as the veh oracle does it
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const FB = new Float32Array(1), UB = new Uint32Array(FB.buffer);
const bitsOf = (v) => { FB[0] = v; return UB[0]; };
/** Pepper's walk state (the mailbox DAT_008ae088) and clip on both sides */
export function setPepState(P, st) {
  P.E.mem.w32(G.mailbox, st); P.w.pep.mailbox = st;
  P.pep.anim?.start(st, 0); P.E.pushAnim(P.pep);
}
/** Pepper's clip plays on (the walk node's FUN_0043b76a(anim, 1.0)): the port's instance advances, the oracle's block is rewritten from it */
export function advancePepper(P) { P.pep.anim?.advance(1.0, P.w.dt); P.E.pushAnim(P.pep); }
/** Space as the walk node handles it: the next state of both implementations is compared (`P.spaceDiffs`), then applied */
export function spaceBoth(P, state) {
  const E = P.E, cpu = E.cpu, mem = E.mem;
  let orig = 0;
  E.log = []; P.events.length = 0;
  if (!(state === 1 || state === 0x1f || state === 0x57)) {
    cpu.steps = 0;
    const r = cpu.call(0x427c15, [E.recPtr(P.pep.index)], { maxSteps: 1_000_000 });
    const play = (a) => cpu.call(0x4435a0, [mem.r32(a)]);
    if (r === 1) {
      if (state === 8 || state === 0xd || state === 0x1b) { orig = 0xb; play(0x9da960); cpu.call(0x4277d0, [bitsOf(14), bitsOf(42)], { maxSteps: 1_000_000 }); }
      else if (state === 0x24 || state === 0x3f || state === 0x40) { orig = 0x42; play(0x9da984); cpu.call(0x4277d0, [bitsOf(4), bitsOf(10)], { maxSteps: 1_000_000 }); }
    } else if (r === 2) { orig = 0xc; cpu.call(0x428a0a, [10, 0x28], { maxSteps: 1_000_000 }); }
  }
  const port = walkSpace(P.w, P.pep, state);
  if (JSON.stringify(E.log) !== JSON.stringify(P.events)) (P.spaceDiffs ??= []).push(`space in state 0x${state.toString(16)}: sounds original ${JSON.stringify(E.log)} port ${JSON.stringify(P.events)}`);
  E.log = []; P.events.length = 0;
  (P.spaceLog ??= []).push({ state, orig, port });
  if (orig !== port) (P.spaceDiffs ??= []).push(`space in state 0x${state.toString(16)}: next state original 0x${orig.toString(16)} port 0x${port.toString(16)}`);
  if (orig) setPepState(P, orig);
  return orig;
}
