import fs from 'node:fs';
import { Pe, extractZone } from '/Users/sander/Documents/legoeiland2-web/src/formats/exe.ts';
const ZONES = ['z01BPK','z02LGI','z03PPH','z04IFC','z05WAB','z07CSI','z08BKD','z09JST','z10RGB','z13CAI','z14OSD','z15SSH','z16PYA','z17WAS','z18MMP','z20DSP','z21FSH','z22BIP','z23DIP','z27TRX','z28HAT','z36CNT','z38PAR','z39ASB','z40aPO','z40OGL','z41MAP','z42BRP','z50LTC','z60FRE'];
const pe = new Pe(fs.readFileSync('/Users/sander/Documents/legoeiland2-extract/game/Game/LEGO eiland 2.exe'));
const starts = pe.functionStarts();
const out = {};
for (const z of ZONES) {
  const s = extractZone(pe, z, undefined, starts);
  const rel = p => p ? p.split('\\').slice(2).join('/').toLowerCase() : null;
  const meshAll = new Set(s.meshPaths.filter(Boolean).map(rel));
  const colAll = new Set(s.colPaths.filter(Boolean).map(rel));
  const modelKey = m => m.array + ':' + m.index;
  const reach = new Map(); // models reachable from records
  const addModel = m => { if (!m || reach.has(modelKey(m))) return; reach.set(modelKey(m), m); for (const a of m.attach) if (a) addModel(a.child); };
  for (const r of s.records) addModel(r.model);
  const EXTRA={z20DSP:[0x7b],z27TRX:[0x2e,0x121,0x2d]}; for (const i of EXTRA[z]||[]) for (const m of s.models) if (m.index===i && m.array.includes('98380c')) addModel(m);
  const meshInModels = new Set(), meshReach = new Set(), texAll = new Set(), texReach = new Set();
  const partsOf = (m, set, tset) => { for (const p of m.parts) if (p) { const mp = rel(s.meshPaths[p.mesh]); if (mp) set.add(mp); const tl = s.texLists[p.texList]; if (tl) for (const t of tl) if (t >= 0) tset.add(t); } };
  for (const m of s.models) { partsOf(m, meshInModels, texAll); for (const a of m.attach) if (a) partsOf(a.child, meshInModels, texAll); }
  for (const m of reach.values()) { partsOf(m, meshReach, texReach); for (const a of m.attach) if (a) partsOf(a.child, meshReach, texReach); }
  const colReach = new Set(); for (const r of s.records) if (r.col >= 0 && s.colPaths[r.col]) colReach.add(rel(s.colPaths[r.col]));
  const allTexLists = new Set(); for (const l of s.texLists) if (l) for (const t of l) if (t >= 0) allTexLists.add(t);
  out[z] = { meshAll: [...meshAll], colAll: [...colAll], meshInModels: [...meshInModels], meshReach: [...meshReach], colReach: [...colReach], texAll: [...texAll], texReach: [...texReach], texInLists: [...allTexLists], nModels: s.models.length, nReach: reach.size, nRec: s.records.length,
    recNames: s.records.map(r => r.name) };
  console.log(z, 'models', s.models.length, 'reach', reach.size, 'mesh loaded', meshAll.size, 'inModels', meshInModels.size, 'reach', meshReach.size, 'col', colAll.size, colReach.size, 'tex inlists', allTexLists.size, 'inModels', texAll.size, 'reach', texReach.size);
}
fs.writeFileSync('zones.json', JSON.stringify(out));
