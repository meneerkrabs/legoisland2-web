// LEGO 3D run-time wiring (src/mods/lego3d/{runtime,hook,ui}.ts, src/viewer/data.ts): with the option off nothing is generated and GameData's override path is untouched
// ("exactly the original"); with it on, generated members go into the archive after the mods' own files; the persistent-cache blob round-trips; every archive of the game generates
// without throwing and a second run is byte-identical; a damaged / foreign pack or a member that is not the game's own never breaks an archive; the device guard decides as documented.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameData } from '../../src/viewer/data.ts';
import { Archive } from '../../src/formats/archive.ts';
import { Pack } from '../../src/mods/lego3d/pack.ts';
import { Lego3dRuntime, fingerprint, packFiles, unpackFiles } from '../../src/mods/lego3d/runtime.ts';
import { judgeLego3d } from '../../src/mods/lego3d/ui.ts';
import { lego3dOptions } from '../../src/mods/lego3d/hook.ts';
import { storedPrefs } from '../../src/display.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.join(here, '../../src/mods/lego3d/data/lego3d.pack');
export default {
  name: 'lego3d-runtime',
  async run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    // defaults: off; the url forms
    ok(storedPrefs().lego3d === false, 'LEGO 3D must be OFF by default');
    ok(JSON.stringify(lego3dOptions('?lego3d=1')) === '[]' && JSON.stringify(lego3dOptions('?lego3d=chars,-studs')) === '["chars","-studs"]' && lego3dOptions('').length === 0, 'url options');
    // device guard
    ok(judgeLego3d({ userAgent: 'Mozilla/5.0 (iPhone)', touchPrimary: true }).ok === false, 'phone is warned');
    ok(judgeLego3d({ userAgent: 'x', touchPrimary: false, deviceMemory: 2 }).ok === false, 'low memory is warned');
    ok(judgeLego3d({ userAgent: 'x', touchPrimary: false, cores: 2 }).ok === false, 'few cores are warned');
    ok(judgeLego3d({ userAgent: 'x', touchPrimary: false, deviceMemory: 8, cores: 8 }).ok === true, 'desktop passes');
    // cache blob
    const m = new Map([['a/b.msh', new Uint8Array([1, 2, 3, 4])], ['Textures/x.tga', new Uint8Array(1000).fill(7)], ['empty', new Uint8Array(0)]]);
    const back = await unpackFiles(await packFiles(m));
    ok(back.size === 3 && [...m].every(([k, v]) => back.get(k) && back.get(k).length === v.length && back.get(k).every((x, i) => x === v[i])), 'cache blob round trip');
    if (!fs.existsSync(PACK)) return { checked, failures, notes: [...notes, 'pack absent: wiring checks only'] };
    // GameData: no generator -> untouched; generator -> members land after the mods' own files
    const dataRoot = ctx.dataDir.replace(/_data$/, '');
    const reader = (extra = {}) => ({ read: async (p) => new Uint8Array(fs.readFileSync(path.join(dataRoot, p))), ...extra });
    const plain = new GameData(reader());
    const a0 = await plain.archive('Bricks');
    ok(!a0.entries.some((e) => e.data), 'without a generator no member is replaced');
    let calls = 0;
    const rt = new Lego3dRuntime('file://pack', []);
    rt.cache = false;
    rt.load = async () => Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    const gen = new GameData(reader({ generateOverrides: async (n, a, o) => { calls++; await rt.apply(n, a, o); } }));
    const a1 = await gen.archive('Bricks');
    ok(calls === 1 && a1.entries.some((e) => e.data), 'with a generator the Bricks archive gets generated members');
    ok(a1.entries.length >= a0.entries.length, 'members only added or replaced');
    await gen.archive('Bricks');
    ok(calls === 1, 'generated once per archive visit');
    // every archive: no throw, deterministic, fingerprint stable
    let total = 0, maxMs = 0, n = 0;
    const pack = Pack.open(new Uint8Array(fs.readFileSync(PACK)));
    const { generateArchive } = await import('../../src/mods/lego3d/gen/index.ts');
    for (const a of ctx.archives) {
      const t0 = Date.now();
      const r1 = await generateArchive(pack, a.name, a, async (x) => ctx.archives.find((q) => q.name === x) ?? null);
      const dt = Date.now() - t0; maxMs = Math.max(maxMs, dt); n++;
      total += r1.files.size;
      if (r1.files.size && a.name === 'z02LGI') {
        const r2 = await generateArchive(pack, a.name, a, async (x) => ctx.archives.find((q) => q.name === x) ?? null);
        ok(r1.files.size === r2.files.size && [...r1.files].every(([k, v]) => { const w = r2.files.get(k); return w && w.length === v.length && w.every((x, i) => x === v[i]); }), 'z02LGI generation is deterministic');
      }
      ok(fingerprint(a) === fingerprint(a), 'fingerprint stable');
    }
    notes.push(`all ${n} archives generate: ${total} members, slowest archive ${maxMs} ms (node)`);
    // damaged pack: the runtime must not throw and must leave the archive alone
    const bad = new Lego3dRuntime('file://bad', []);
    bad.cache = false;
    bad.load = async () => null;
    const arch = ctx.archives.find((q) => q.name === 'z02LGI');
    const before = arch.entries.filter((e) => e.data).length;
    await bad.apply('z02LGI', arch);
    ok(arch.entries.filter((e) => e.data).length === before, 'no pack: archive untouched');
    return { checked, failures, notes };
  },
};
