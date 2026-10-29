import fs from 'node:fs';
import { loadExe } from '../lib/engine-load.mjs';
import { archiveParticleFiles } from '../../src/fx/particles/files.ts';
import { ParticleDefs } from '../../src/fx/particles/defs.ts';

// WP-PART-WIRE: every effect name the zone code starts (the zones of this package) is the string the original passes (read from the executable) and resolves to a record of the zone's
// Particle/ folder (the lookup of `FUN_0044f710` is by the first line of the file: "orsemud1.par", "mummy02", "Spray01" are not interchangeable with their stems).
const CALLS = [
  ['z28HAT', 'burp.par', 0x940310, 'src/zones/z28hat/nodes.ts'],
  ['z22BIP', 'Leaffall.par', 0x931d18, 'src/zones/z22BIP.ts'], ['z22BIP', 'Spray01', 0x931c58, 'src/zones/z22BIP.ts'],
  ['z18MMP', 'mmpfire.par', 0x92789c, 'src/zones/z18mmp/props.ts'], ['z18MMP', 'twinkle01.par', 0x927a44, 'src/zones/z18mmp/props.ts'], ['z18MMP', 'symtwin.par', 0x927aa4, 'src/zones/z18mmp/props.ts'],
  ['z18MMP', 'symtwin.par', 0x927b50, 'src/zones/z18mmp/coffin.ts'], ['z18MMP', 'mummy02', 0x927b5c, 'src/zones/z18mmp/coffin.ts'], ['z18MMP', 'mummy02', 0x927b64, 'src/zones/z18mmp/coffin.ts'],
  ['z15SSH', 'trexfeet', 0x91c8a4, 'src/zones/z15ssh/rules.ts'], ['z15SSH', 'trexfeet', 0x91c8b0, 'src/zones/z15ssh/rules.ts'],
  ['GENERICBITS', 'paul01', 0x95d9e0, 'src/zones/z50LTC/fx.ts'], ['GENERICBITS', 'paul01', 0x95d9e8, 'src/zones/z50LTC/fx.ts'], ['GENERICBITS', 'TWINKLE01.par', 0x95d9f0, 'src/zones/z50LTC/fx.ts'],   // z50LTC (WP-MINI worker E)
  ['z60FRE', 'trainsmoke01.par', 0x8c930c, 'src/shell/fenodes.ts'],
  ['z09JST', 'orsemud1.par', 0x90572c, 'src/zones/z09jst/game.ts'], ['z09JST', 'orsemud1.par', 0x90579c, 'src/zones/z09jst/game.ts'],
];
export default {
  name: 'm6-particle-names',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const pe = loadExe(ctx.dataRoot);
    const defsOf = new Map();
    for (const [zone, name, va, file] of CALLS) {
      checked += 2;
      if (pe.cstr(va) !== name) failures.push(`${zone}: the executable's string at 0x${va.toString(16)} is "${pe.cstr(va)}", the port starts "${name}"`);
      checked++;
      if (!fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').includes(`'${name}'`)) failures.push(`${file}: does not start "${name}" (the zone code passes another name)`);
      let d = defsOf.get(zone);
      if (!d) { const a = ctx.archives.find((x) => x.name === zone); d = new ParticleDefs(archiveParticleFiles(a)); defsOf.set(zone, d); }
      if (!d.findPar(name)) failures.push(`${zone}: effect "${name}" (${file}) is not found in the zone's Particle/ folder`);
    }
    notes.push(`${CALLS.length} effect names checked against the executable's strings and the archives' records`);
    return { checked, failures, notes };
  },
};
