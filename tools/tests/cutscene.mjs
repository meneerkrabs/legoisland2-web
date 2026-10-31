import { parseCutscene, parseCutsceneText, compileCutscene, CUT_COMMAND_NAMES } from '../../src/formats/cutscene.ts';

const dec = (b) => Buffer.from(b).toString('latin1');
export default {
  name: 'cutscene',
  run(ctx) {
    const failures = []; const notes = [];
    let psx = 0, checked = 0, exact = 0, bin = 0, txt = 0, txtNoCut = 0, lines = 0, skippedLines = 0;
    const known = new Set(['lgici06']); // header name was read past the end of an EOF-truncated .txt (heap fill bytes in the .cut)
    const catalog = new Map(); // "command" -> { n, shapes: Map(shape -> count) }
    const textCatalog = new Map();
    const cuts = new Map(); // fullPath(lower, no ext) -> data
    for (const { archive, entry, data } of ctx.entries(/\.cut$/i)) cuts.set(`${archive.name}/${entry.path}`.toLowerCase().replace(/\.cut$/, ''), { entry, data });
    const shape = (c) => {
      switch (c.cmd) {
        case 0: case 15: return c.flag ? 'true' : 'false';
        case 1: return 'anim';
        case 2: return 'textId';
        case 3: case 5: return `${c.targetKind}${c.cmd === 5 && c.targetKind === 'actor' ? '+side' : ''}`;
        case 4: case 6: return `${c.targetKind}${c.signalId ? '+end' : ''}${c.duration ? '+dur' : ''}`;
        case 7: return 'actor';
        case 8: return 'name,int';
        case 10: case 11: return 'int,int';
        case 12: return 'float';
        case 13: return 'int';
        case 14: return 'actor,bone';
        default: return '?';
      }
    };
    // 1. every .cut parses with zero trailing bytes
    const parsed = new Map();
    for (const [key, { entry, data }] of cuts) {
      checked++; bin++;
      try {
        const c = parseCutscene(data);
        parsed.set(key, c);
        if (c.version !== 4) failures.push(`${entry.fullPath}: version ${c.version}`);
        if (c.commands.length > c.declaredCount) failures.push(`${entry.fullPath}: more records (${c.commands.length}) than declared (${c.declaredCount})`);
        if (c.commands.length < c.declaredCount - 6) failures.push(`${entry.fullPath}: implausibly few records ${c.commands.length}/${c.declaredCount}`);
        for (const x of c.commands) {
          if (x.actor.length === 0 || x.actor.length > 4) failures.push(`${entry.fullPath}: bad actor "${x.actor}"`);
          if (x.waitId > 512 || x.signalId > 512) failures.push(`${entry.fullPath}: id out of range`);
          if (!(x.delay >= 0 && x.delay < 100) || !(x.duration >= 0 && x.duration < 1000)) failures.push(`${entry.fullPath}: delay/duration ${x.delay}/${x.duration}`);
          // trailer = fixed-point (x4096) of delay and duration (compiler artefact)
          if (x.trailer[0] !== Math.trunc(x.delay * 4096) || x.trailer[1] !== Math.trunc(x.duration * 4096)) failures.push(`${entry.fullPath}: trailer ${x.trailer} != fixed(${x.delay},${x.duration})`);
          if (x.cmd === 13 && x.expression >= 16) failures.push(`${entry.fullPath}: expression ${x.expression}`);
          if (x.cmd === 12 && !(x.fov >= 0.01)) failures.push(`${entry.fullPath}: fov ${x.fov}`);
          if ((x.cmd === 4 || x.cmd === 6) && x.targetKind === 'spline' && x.splineCount > 0 && x.splineFirst >= x.splineCount) failures.push(`${entry.fullPath}: spline range ${x.splineFirst}..${x.splineCount}`);
          // S9 proof (gaps.md): no shipped script uses WAV / MIDI (cmd 9, a stub in the runner) or a camera MOVEPOSITION to an actor (FUN_0045ecec has no branch for target kind 1)
          if (x.cmd === 9) failures.push(`${entry.fullPath}: WAV/MIDI command used (the runner stubs it)`);
          if (x.cmd === 6 && x.actor === 'CMRA' && x.targetKind === 'actor') failures.push(`${entry.fullPath}: camera MOVEPOSITION to an actor (unsupported by the original)`);
          const e = catalog.get(x.name) ?? { n: 0, shapes: new Map() }; e.n++;
          const s = shape(x); e.shapes.set(s, (e.shapes.get(s) ?? 0) + 1); catalog.set(x.name, e);
        }
        if (c.splineNames.length && !c.commands.some((x) => x.targetKind === 'spline')) failures.push(`${entry.fullPath}: spline names without spline commands`);
      } catch (e) { failures.push(`${entry.fullPath}: ${e.message}`); }
    }
    // 2. every .txt in a Cutscene dir parses; those with a .cut compile byte-for-byte to the .cut
    for (const { archive, entry, data } of ctx.entries(/(^|\/)cutscene\/[^/]*\.txt$/i)) {
      checked++; txt++;
      const key = `${archive.name}/${entry.path}`.toLowerCase().replace(/\.txt$/, '');
      try {
        const t = parseCutsceneText(dec(data));
        lines += t.lines.length; skippedLines += t.skipped.length;
        if (t.version !== 0) failures.push(`${entry.fullPath}: CSMSCRIPTVERSION ${t.version}`);
        if (!t.name) { if (t.lines.length === 0 && /^\/\//.test(dec(data))) notes.push(`${entry.fullPath}: comment-only stub ("${dec(data).trim()}")`); else failures.push(`${entry.fullPath}: no script name`); }
        for (const l of t.lines) {
          const w = l.command.toUpperCase();
          const e = textCatalog.get(w) ?? { n: 0, shapes: new Map() }; e.n++;
          const sh = l.args.map((a) => (/^-?[\d.]+$/.test(a) ? '#' : /\.man$/i.test(a) ? 'path.man' : /^(waypoint|actor|spline)$/i.test(a) ? a.toLowerCase() : 'w')).join(' ');
          e.shapes.set(sh, (e.shapes.get(sh) ?? 0) + 1); textCatalog.set(w, e);
        }
      } catch (e) { failures.push(`${entry.fullPath}: ${e.message}`); continue; }
      const cut = cuts.get(key);
      if (!cut) { txtNoCut++; if (/psx$/i.test(key)) psx++; continue; }
      let ok = false;
      for (const st of [0, 12]) { // 12 = leftover start index of the previous file's spline list (process global in the original compiler)
        const comp = compileCutscene(dec(data), { splineStart: st });
        if (comp.length === cut.data.length && comp.every((v, i) => v === cut.data[i])) { ok = true; break; }
      }
      if (ok) exact++;
      else if (known.has(key.split('/').pop())) notes.push(`${entry.fullPath}: .cut name field contains heap fill (txt without trailing newline): tolerated`);
      else failures.push(`${entry.fullPath}: compiled text differs from .cut`);
    }
    notes.unshift(`.cut ${bin}, .txt ${txt} (${txt - txtNoCut} with .cut; ${exact} compile byte-identical; ${txtNoCut} text only: ${psx} *psx variants + ${txtNoCut - psx} others), script lines ${lines}, rejected lines ${skippedLines}`);
    notes.push(`commands in .cut files: ${[...catalog.values()].reduce((a, v) => a + v.n, 0)}; WAV/MIDI 0, camera MOVEPOSITION to an actor 0 (checked per command above)`);
    { const og = [...parsed].find(([k]) => /z40ogl\/cutscene\/ogl02$/.test(k)); if (og) notes.push('ogl02 uses: ' + [...new Set(og[1].commands.map((x) => x.name))].join(' ')); }
    notes.push('commands (binary): ' + [...catalog].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k}:${v.n}`).join(' '));
    // cross-check ids vs doc
    for (const k of catalog.keys()) if (!CUT_COMMAND_NAMES.includes(k)) failures.push(`unknown command name ${k}`);
    return { checked, failures, notes };
  },
};
