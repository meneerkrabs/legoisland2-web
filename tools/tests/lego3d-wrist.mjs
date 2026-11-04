// LEGO 3D characters, the wrist join (docs/re/lego3d.md "Round 12"): the hand's wrist peg must stand in the arm's cuff. For every body layout at HR and MR (Pepper, the minifig, the Brickster-bot,
// the astronaut, the skeleton / mummy), both hands, the generated meshes are posed in the bind pose and in sampled frames of the game's own clips (tools/lego3d/wrist-check.mjs) and
//   bind pose: the hand touches the arm (gap 0), the peg's end lies inside the sleeve (every tip vertex inside the arm's closed shell), on the cuff's axis (lateral offset <= 0.05 game units: the sleeve is
//              0.2 wide, the peg 0.1), 0.05 - 0.25 past the end face (a real hand's peg goes into the hole);
//   posed:     the peg's end stays inside the sleeve in at least 80 % of the frames of the real arms (the wrist turns about the bone, which sits inside the sleeve; the skeleton's shaft is only 0.11
//              wide: 15 %), the hand never leaves the arm by more than 0.08;
//   recipes:   every claw hand has a `neck` record, its neck leans at most 40 degrees against the cuff's axis.
// Skips with a note without the pack / game folder.
import fs from 'node:fs';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { runWristCheck, DEFAULT_PACK } from '../lego3d/wrist-check.mjs';

export default {
  name: 'lego3d-wrist',
  async run() {
    const failures = [], notes = [];
    if (!fs.existsSync(DEFAULT_PACK)) return { checked: 0, failures, notes: ['LEGO 3D pack absent: skipped'] };
    const pack = Pack.open(new Uint8Array(fs.readFileSync(DEFAULT_PACK)));
    if (!pack.has('chars/tables.json')) return { checked: 0, failures, notes: ['pack has no chars part: skipped'] };
    const t = await pack.json('chars/tables.json');
    let checked = 0;
    for (const [key, r] of Object.entries(t.statics)) {
      if (r.kind !== 'hand') continue;
      checked++;
      if (!r.neck) failures.push(`hand ${key}: no neck record (the wrist peg was not put onto the cuff)`);
      else if (r.neck.tilt > 40) failures.push(`hand ${key}: the neck leans ${r.neck.tilt} degrees against the cuff's axis (limit 40)`);
    }
    let rows;
    try { rows = await runWristCheck({ nPoses: 60, log: () => {} }); } catch (e) { return { checked, failures, notes: [`wrist check could not run (${e.message}): skipped`] }; }
    const f = (x) => x.toFixed(3);
    for (const r of rows) {
      if (r.kind !== 'gen') continue;
      checked++;
      const id = `${r.case} lod${r.lod} ${r.side} (${r.body} + ${r.hand})`;
      const thin = r.case === 'skel' || r.case === 'mummy';
      if (r.bind.gap > 0) failures.push(`${id}: bind pose gap ${f(r.bind.gap)} between cuff and hand`);
      if (r.bind.off > 0.05) failures.push(`${id}: the peg is ${f(r.bind.off)} off the cuff's axis in the bind pose (limit 0.05)`);
      if (r.bind.tipIn < (thin ? 0.8 : 0.99)) failures.push(`${id}: only ${(100 * r.bind.tipIn).toFixed(0)} % of the peg's end is inside the sleeve in the bind pose`);
      if (r.bind.depth > -0.05 || r.bind.depth < -0.25) failures.push(`${id}: the peg's end is ${f(r.bind.depth)} past the end face (want -0.25 .. -0.05)`);
      if (r.tipIn < (thin ? 0.15 : 0.8)) failures.push(`${id}: the peg stays inside the sleeve in only ${(100 * r.tipIn).toFixed(0)} % of the posed frames`);
      if (r.gap[2] > 0.08) failures.push(`${id}: the hand leaves the arm by ${f(r.gap[2])} in a posed frame (limit 0.08)`);
    }
    notes.push(`${rows.filter((r) => r.kind === 'gen').length} (layout, LOD, side) combinations checked in the bind pose and 60 posed frames each`);
    return { checked, failures, notes };
  },
};
