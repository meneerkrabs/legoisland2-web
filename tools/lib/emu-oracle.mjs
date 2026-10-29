// Oracle comparison of an emulated set-up (src/formats/emusetup.ts) against the symbolic extraction (`extractZoneSetup`, src/formats/zonesetup.ts), shared by
// tools/tests/emusetup.mjs-style tests: every attach / flag write / box / cutscene / HUD hint / render mode the extraction reports as ACTIVE for the game
// variables of the node must be in the emulation (same record / constructor / position / gate; a store at the same instruction for flag writes).
import { activeEntries } from '../../src/formats/zonesetup.ts';

/** records a name loop entry applies to: ALL its name conditions (`==` and `!=`; `nameMatches` of zonesetup.ts ignores `!=`) */
function recordsOf(e, names) {
  const conds = (e.cond ?? []).filter((c) => c.src === 'name');
  if (!conds.length || !conds.some((c) => c.op === '==')) return [];
  const out = [];
  names.forEach((nm, i) => {
    for (const c of conds) {
      const v = c.value;
      let eq = true;
      for (let k = 0; k < v.length && c.id + k < 4; k++) if (v.charCodeAt(k) !== 0 && v[k] !== (nm[c.id + k] ?? '\0')) eq = false;
      if (c.op === '==' ? !eq : eq) return;
    }
    out.push(i);
  });
  return out;
}
/** an oracle value read from an uninitialised stack local (0xcccccccc as float): the extraction could not resolve it, the emulator did */
const UNRESOLVED = -107374176;

const hex = (v) => v.toString(16);
/** returns { checked, failures[], missing: { attaches, flags, boxes, cutscenes, hints, modes } } */
export function compareOracle(oracle, s, scene, node, explained = new Map(), explainedSeen = new Set()) {
  const failures = [];
  let checked = 0;
  const names = scene.records.map((r) => r.name);
  const gv = (v) => (v === 0x58 ? node : 0);
  const key = (a) => `${a.record}|${a.ctor}|${a.var}|${a.mask}|${a.value}`;
  const pool = new Map();
  for (const a of s.attaches) { const k = `${a.at}|${key(a)}`; (pool.get(k) ?? pool.set(k, []).get(k)).push(a); }
  const orcA = activeEntries(oracle.attaches, gv).filter((a) => a.record >= 0);
  let missA = 0, explainedMask = 0;
  for (const a of orcA) {
    const l = pool.get(`${a.at}|${key(a)}`);
    const hit = l?.find((e) => a.pos < 0 || e.pos === a.pos);
    if (hit) { l.splice(l.indexOf(hit), 1); continue; }
    const why = explained.get(a.at);
    if (why) { explainedSeen.add(a.at); continue; }
    // the gate mask is a local the extraction does not track (a loop variable shifted left after every attach, FUN_0052266a / FUN_007e36dd style): same site, record, ctor, var, value, a non-zero mask in the emulation
    if (a.mask === 0 && s.attaches.some((e) => e.at === a.at && e.record === a.record && e.ctor === a.ctor && e.var === a.var && e.value === a.value && e.mask !== 0)) { explainedMask++; continue; }
    missA++;
    failures.push(`node ${node}: oracle attach rec ${a.record} ${a.ctorName ?? hex(a.ctor)} pos ${a.pos} gate ${hex(a.var)}&${hex(a.mask)}=${hex(a.value)} at 0x${hex(a.at)} not in the emulation`);
  }
  checked += orcA.length;
  let missF = 0, nF = 0;
  for (const w of activeEntries(oracle.flagWrites, gv)) {
    const recs = w.record >= 0 ? [w.record] : recordsOf(w, names);
    for (const r of recs) {
      nF++;
      const st = s.stores.filter((x) => x.at === w.at && x.record === r && x.field >= 0x60 && x.field < 0x62);
      const v = st.length ? st[st.length - 1].value : null;
      const good = v !== null && (w.op === 'and' ? (v & ~w.mask & 0xffff) === 0 : w.op === 'or' ? (v & w.mask) === w.mask : w.op === 'set' ? v === w.mask : true);
      if (!good) { missF++; failures.push(`node ${node}: oracle flag write rec ${r} ${w.op} 0x${hex(w.mask)} at 0x${hex(w.at)}: emulator ${v === null ? 'no store' : '0x' + hex(v)}`); }
    }
  }
  checked += nF;
  const near = (a, b) => a.length === b.length && a.every((x, k) => Math.abs(x - b[k]) < 1e-5);
  let missB = 0;
  for (const b of activeEntries(oracle.boxes, gv)) {
    const recs = b.record >= 0 ? [b.record] : recordsOf(b, names);
    for (const r of recs) { checked++; if (!s.boxes.some((x) => x.at === b.at && x.record === r && x.kind === b.kind && (b.dims.some((d) => d === UNRESOLVED) || near(x.dims, b.dims)))) { missB++; failures.push(`node ${node}: oracle box ${JSON.stringify(b)} rec ${r} missing`); } }
  }
  let missC = 0;
  for (const c of activeEntries(oracle.cutscenes, gv)) { checked++; if (!s.cutscenes.some((x) => x.at === c.at && x.slot === c.slot && x.name === c.name && x.messages === c.messages)) { missC++; failures.push(`node ${node}: oracle cutscene ${JSON.stringify(c)} missing`); } }
  let missH = 0;
  for (const h of activeEntries(oracle.hudHints, gv)) { checked++; if (!s.hudHints.some((x) => x.at === h.at && x.index === h.index && x.a === h.a && x.b === h.b && x.c === h.c && x.d === h.d && Math.abs(x.scale - h.scale) < 1e-6)) { missH++; failures.push(`node ${node}: oracle HUD hint ${JSON.stringify(h)} missing`); } }
  let missM = 0;
  for (const m of activeEntries(oracle.modes, gv)) if (m.record >= 0) { checked++; if (!s.modes.some((x) => x.at === m.at && x.record === m.record && x.partMask === m.partMask && x.mode === m.mode)) { missM++; failures.push(`node ${node}: oracle render mode ${JSON.stringify(m)} missing`); } }
  return { checked, failures, oracleAttaches: orcA.length, explainedMask, missing: { attaches: missA, flags: missF, boxes: missB, cutscenes: missC, hints: missH, modes: missM }, flagWrites: nF };
}
