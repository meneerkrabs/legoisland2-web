// Dev loop for the gear (hair, headgear, tools) WITHOUT the bodies: the real buildGear on a throw-away table, the replaced meshes written as .msh to a folder.
//   GEAR_ONLY='Sword|Axe' [GEAR_TRACE=1] node tools/lego3d/pack/chars-gear-try.mjs [--out /tmp/gear-try]
// (the hands are decided like chars.mjs buildHands does: the claw replaces every single-group 36-90 triangle hand it fits within 0.1; nothing is written to the pack)
import fs from 'node:fs';
import path from 'node:path';
import { archive } from '../lib.mjs';
import { loadInventory } from '../chars-inventory.mjs';
import { parseMsh } from '../../../src/formats/msh.ts';
import { assembleStatic, encodeStatic, decodeStatic } from '../../../src/mods/lego3d/chars/static.ts';
import { fitHand } from './chars-hand.mjs';
import { buildGear } from './chars-gear.mjs';

const args = process.argv.slice(2), oi = args.indexOf('--out'), OUT = oi >= 0 ? args[oi + 1] : '/tmp/gear-try';
fs.mkdirSync(OUT, { recursive: true });
const inv = loadInventory();
const tables = { members: {}, statics: {} };
const seen = new Set();
for (const o of inv.models) for (const a of o.attach) {
  if (!a || (a.slot !== 6 && a.slot !== 8)) continue;
  a.parts.forEach((p, li) => {
    if (!p?.hash || seen.has(p.hash)) return;
    seen.add(p.hash);
    const A = archive(o.zone), m = parseMsh(A.read(A.find(p.member)));
    const tris = m.indices.length / 3, lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9];
    for (let i = 0; i < m.positions.length; i += 3) for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], m.positions[i + c]); hi[c] = Math.max(hi[c], m.positions[i + c]); }
    if (m.groups.length !== 1 || tris < 36 || tris > 90 || Math.max(...hi.map((x, i) => x - lo[i])) > 0.9 || /^HATE/i.test(p.name)) return;
    if (fitHand(m.positions, Array.from(m.indices), li === 0 ? 'std' : 'low').d <= 0.1) tables.statics[`hand:${p.hash}`] = { kind: 'hand' };
  });
}
let last = null;
const h = {
  archive, parseMsh, encodeStatic, decodeStatic,
  assembleStatic: (orig, blob, roles, nrm, opts) => { const r = assembleStatic(orig, blob, roles, nrm, opts); last = r; return r; },
  addStatic(ctx, t, key, member, hash, bytes, recipe) {
    t.statics[key] = { ...recipe, blob: key };
    (t.members[member.toLowerCase()] ??= {})[hash] = key;
    fs.writeFileSync(path.join(OUT, path.basename(member)), last.bytes);
    fs.writeFileSync(path.join(OUT, path.basename(member) + '.recipe.json'), JSON.stringify(recipe, null, 1));
  },
};
process.env.GEAR_TRACE ??= '1';
const res = buildGear({ use() {}, log: (m) => console.log(m) }, tables, inv, h);
console.log(res.filter((r) => r.status === 'replaced').map((r) => `${r.name}: ${r.part} ${r.origTris} -> ${r.newTris} iou ${r.metrics.iou.toFixed(2)} score ${r.metrics.score.toFixed(3)} ${JSON.stringify(r.grip ?? {})}`).join('\n'));
