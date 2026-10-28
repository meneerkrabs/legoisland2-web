import { PARTICLE_KEYS, PARTICLE_COMMANDS, EMI_PRIMITIVES, EMI_PROPERTIES, parseParticleKV, parseParScript, parseSwirl } from '../../src/formats/particles.ts';

const dec = (b) => Buffer.from(b).toString('latin1');
export default {
  name: 'particles',
  run(ctx) {
    const failures = []; const notes = []; let checked = 0;
    const bad = (f, m) => failures.push(`${f}: ${m}`);
    const counts = { par: 0, app: 0, emi: 0, mov: 0, swl: 0 };
    const unknown = new Map(), arity = [], nameDiff = [], dangling = [], absent = new Set();
    const lineShapes = new Map();
    for (const archive of ctx.archives) {
      for (const entry of archive.entries) {
        const m = /\.(par|app|emi|mov|swl)$/i.exec(entry.path);
        if (!m) continue;
        const ext = m[1].toLowerCase();
        const full = `_data/${archive.name}/${entry.path}`;
        const dir = entry.path.replace(/[^/]*$/, '');
        const base = entry.path.replace(/^.*\//, '').replace(/\.\w+$/, '');
        const text = dec(archive.read(entry));
        checked++; counts[ext]++;
        try {
          if (ext === 'swl') {
            const s = parseSwirl(text);
            if (s.rings.length === 0) bad(full, 'no rings');
            for (const r of s.rings) if (!archive.find(dir + r.app)) bad(full, `ring app ${r.app} missing`);
          } else if (ext === 'par') {
            const p = parseParScript(text);
            if (p.script.length === 0) bad(full, 'empty [SCRIPT]');
            if (p.name.toLowerCase().replace(/\.par$/, '') !== base.toLowerCase()) nameDiff.push(`${entry.path}: "${p.name}"`);
            for (const n of [...p.emits, ...p.splash]) if (!archive.find(dir + n) && !archive.find(dir + n.replace(/\.par$/i, '') + '.par')) dangling.push(`${entry.path} -> ${n}`);
            let exec = 0;
            for (const l of p.script) {
              const when = l.when.toUpperCase(), act = l.action.toUpperCase();
              const key = Object.keys(PARTICLE_KEYS).find((k) => k.toUpperCase() === act);
              const known = key || PARTICLE_COMMANDS[act] !== undefined;
              if (!known) { bad(full, `line ${l.line}: unknown action ${l.action}`); continue; }
              const shape = `${when === 'FORNEW' || when === 'FORALL' ? when : '(' + when + ')'} ${key ?? act} ${l.args.length}`;
              lineShapes.set(shape, (lineShapes.get(shape) ?? 0) + 1);
              if (act === 'EXECUTESCRIPT') {
                exec++;
                const f = l.args[1];
                if (typeof f !== 'string') bad(full, `line ${l.line}: ExecuteScript without file`); else if (!archive.find(dir + f)) dangling.push(`${entry.path} -> ${f}`);
              }
              if (act === 'SETEMIPRIMITIVE') {
                const prim = String(l.args[2]).toUpperCase(), prop = String(l.args[3]).toUpperCase();
                if (EMI_PRIMITIVES[prim] === undefined) bad(full, `line ${l.line}: primitive ${l.args[2]}`);
                if (EMI_PROPERTIES[prop] === undefined) bad(full, `line ${l.line}: primitive property ${l.args[3]}`);
              }
              for (const a of l.args) if (typeof a === 'number' && !Number.isFinite(a)) bad(full, `line ${l.line}: NaN`);
            }
            if (exec !== 3 && exec !== 0) notes.push(`${full}: ${exec} ExecuteScript lines (expected the .app/.mov/.emi triple)`);
            // the triple must exist next to the .par
            for (const e of ['app', 'emi', 'mov']) if (!archive.find(`${dir}${base}.${e}`)) notes.push(`${full}: no sibling .${e}`);
          } else {
            const kv = parseParticleKV(text, ext);
            if (kv.name.toLowerCase().replace(/\.\w+$/, '') !== base.toLowerCase()) nameDiff.push(`${entry.path}: "${kv.name}"`);
            for (const j of kv.junk) { const k = `${ext}: ${j.slice(0, 30)}`; unknown.set(k, (unknown.get(k) ?? 0) + 1); }
            for (const u of kv.unknown) unknown.set(`${ext} key ${u}`, (unknown.get(`${ext} key ${u}`) ?? 0) + 1);
            for (const [k, v] of Object.entries(kv.values)) {
              if (v.some((x) => !Number.isFinite(x))) { bad(full, `${k}: non-numeric value`); continue; }
              const d = PARTICLE_KEYS[k];
              if (d && d.file === ext && v.length !== d.n) arity.push(`${entry.path}: ${k} has ${v.length} values (expected ${d.n})`);
            }
            const need = { app: ['fSSize', 'fESize', 'iSSprite', 'iESprite'], emi: ['iMaxParticles', 'fLifespan', 'fDensity', 'fForce', 'fIncAngle'], mov: ['vGravity', 'fAir'] }[ext];
            for (const k of need) if (!(k in kv.values)) bad(full, `missing key ${k}`);
            for (const k of ['rgbaSColour', 'rgbaEColour']) if (ext === 'app' && !(k in kv.values)) absent.add(`${entry.path}:${k}`);
            const v = kv.values;
            if (ext === 'emi' && v.iMaxParticles && !(v.iMaxParticles[0] >= 1 && v.iMaxParticles[0] <= 5000)) bad(full, 'iMaxParticles range');
            if (ext === 'app') for (const k of ['rgbaSColour', 'rgbaEColour']) if (v[k] && v[k].length === 4 && !v[k].every((x) => x >= 0 && x <= 65280)) bad(full, `${k} range`);
          }
        } catch (e) { bad(full, e.message); }
      }
    }
    // each particle directory holds the shared sprite sheet
    for (const archive of ctx.archives) {
      const dirs = new Set(archive.entries.filter((e) => /\.par$/i.test(e.path)).map((e) => e.path.replace(/[^/]*$/, '')));
      for (const d of dirs) {
        checked++;
        if (!archive.find(d + 'text.opt') && !archive.find(d + 'Text.opt')) bad(`_data/${archive.name}/${d}`, 'no text.opt next to the particle scripts');
        if (!archive.find(d + 'Text000.tga')) bad(`_data/${archive.name}/${d}`, 'no Text000.tga sprite sheet');
      }
    }
    // Dangling references exist in the shipped data (scripts that point to files that were never shipped).
    const EXPECTED_DANGLING = 14;
    if (dangling.length !== EXPECTED_DANGLING) failures.push(`dangling script references: ${dangling.length}, expected ${EXPECTED_DANGLING}: ${dangling.join('; ')}`);
    notes.push(`dangling references (${dangling.length}): ${dangling.join('; ')}`);
    notes.push(`.app files without rgbaSColour/rgbaEColour (game defaults apply): ${absent.size}`);
    notes.unshift(`files: .par ${counts.par}, .app ${counts.app}, .emi ${counts.emi}, .mov ${counts.mov}, .swl ${counts.swl}`);
    notes.push(`script line shapes (when action n-args): ${[...lineShapes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' | ')}`);
    notes.push(`unknown keys or junk lines (ignored by the game): ${[...unknown].map(([k, v]) => `${k}x${v}`).join('; ')}`);
    notes.push(`known keys with a wrong value count (${arity.length}): ${arity.join('; ')}`);
    notes.push(`first line differs from file name in ${nameDiff.length} files (informational), e.g. ${nameDiff.slice(0, 3).join('; ')}`);
    return { checked, failures, notes };
  },
};
