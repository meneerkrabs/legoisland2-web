import { parseStr, parseTagFile, parseTextOptions, parseMtl, parseSrc, parseGob, parseBrickModel, parseBrickSet, parseWhatsWhat, classifyTxt, decodeMessage, textureName } from '../../src/formats/text.ts';
import { parseFnt, measure } from '../../src/formats/fonts.ts';
import { parseLgt } from '../../src/formats/lights.ts';
import { parseCutsceneText } from '../../src/formats/cutscene.ts';

const dec = (b) => Buffer.from(b).toString('latin1');
export default {
  name: 'text',
  run(ctx) {
    const failures = []; const notes = []; let checked = 0;
    const byArchive = new Map(ctx.archives.map((a) => [a.name, a]));
    const bad = (f, m) => failures.push(`${f}: ${m}`);

    // ---- .str message files (+ the English tag file of z27TRX)
    const strByName = new Map(); // base name -> Set(tag): cutscene X uses messages/<area>/Data/X.str
    const strTags = new Set(); let emptyStr = 0, strLines = 0, strFiles = 0, dupTags = 0, sound = new Set();
    for (const { entry, data } of ctx.entries(/\.str$/i)) {
      checked++; strFiles++;
      try {
        const es = parseStr(data);
        const nonBlank = dec(data).split(/\r\n|\r|\n/).filter((l) => l !== '').length;
        if (es.length !== nonBlank) bad(entry.fullPath, `${es.length} entries for ${nonBlank} non-blank lines`);
        if (es.length === 0 && data.length > 0) bad(entry.fullPath, 'no entries'); if (data.length === 0) emptyStr++;
        const seen = new Set();
        strByName.set(entry.path.replace(/^.*\//, '').replace(/\.str$/i, '').toLowerCase(), new Set(es.map((e) => e.tag.toUpperCase())));
        for (const e of es) {
          strLines++;
          if (!/^[A-Za-z0-9_]{1,16}$/.test(e.tag)) bad(entry.fullPath, `odd tag "${e.tag}"`);
          if (seen.has(e.tag)) dupTags++; seen.add(e.tag); strTags.add(e.tag.toUpperCase());
          if (e.soundId < -1 || e.soundId > 5000) bad(entry.fullPath, `sound id ${e.soundId}`);
          sound.add(e.soundId);
          if (e.text.length > 400) bad(entry.fullPath, `very long text (${e.text.length}) for ${e.tag}`);
          decodeMessage(e.text);
        }
      } catch (e) { bad(entry.fullPath, e.message); }
    }
    for (const { entry, data } of ctx.entries(/messages\/english\/english\.txt$/i)) {
      checked++;
      const t = parseTagFile(data);
      if (t.length !== 11) bad(entry.fullPath, `expected 11 tags, got ${t.length}`);
    }
    notes.push(`.str files ${strFiles} (${emptyStr} are empty 0-byte files), entries ${strLines} (duplicate tags inside a file: ${dupTags}), distinct tags ${strTags.size}, distinct sound ids ${sound.size}`);

    // ---- cutscene SayText ids resolve to .str tags
    let sayTotal = 0, sayMissing = new Set(), sameName = 0, sameNameHit = 0, noStr = [];
    for (const { entry, data } of ctx.entries(/cutscene\/[^/]*\.txt$/i)) {
      const t = parseCutsceneText(dec(data));
      const mine = strByName.get(entry.path.replace(/^.*\//, '').replace(/\.txt$/i, '').toLowerCase());
      let any = false;
      for (const l of t.lines) if (l.command.toLowerCase() === 'saytext') {
        any = true; sayTotal++; const id = l.args[0].toUpperCase();
        if (!strTags.has(id)) sayMissing.add(`${entry.fullPath}:${id}`);
        if (mine) { sameName++; if (mine.has(id)) sameNameHit++; }
      }
      if (any && !mine) noStr.push(entry.path.replace(/^.*\//, ''));
    }
    notes.push(`SayText ids found in the same-named messages/<area>/Data/<script>.str: ${sameNameHit}/${sameName}; scripts with SayText but no same-named .str: ${noStr.length} (${noStr.slice(0, 5).join(', ')}...)`);
    if (sameNameHit < 0.95 * sameName) failures.push(`cutscene -> .str name mapping broken (${sameNameHit}/${sameName})`);
    notes.push(`cutscene SayText ids ${sayTotal}; not found in any .str: ${sayMissing.size}${sayMissing.size ? ' (' + [...sayMissing].slice(0, 6).join(', ') + (sayMissing.size > 6 ? ', ...' : '') + ')' : ''}`);
    if (sayMissing.size > 0.5 * sayTotal) failures.push(`most SayText ids unresolved (${sayMissing.size}/${sayTotal})`);

    // ---- .opt / .txl
    let optN = 0, shortFlags = 0, longFlags = 0; const flagVals = new Map();
    for (const { archive, entry, data } of ctx.entries(/\.(opt|txl)$/i)) {
      checked++; optN++;
      try {
        const o = parseTextOptions(data);
        for (const f of o.flags) flagVals.set(f, (flagVals.get(f) ?? 0) + 1);
        if (o.flags.length < o.count) shortFlags++; if (o.flags.length > o.count) longFlags++;
        if (o.count - o.flags.length > 2) bad(entry.fullPath, `flags ${o.flags.length} vs count ${o.count}`);
        if (o.flags.some((f) => (f & ~0x87) !== 0)) bad(entry.fullPath, 'unknown flag bits');
        // textures of the directory: Text000..Text(count-1) must exist (as .tga or .wib), allow the last one(s) to be flag-less
        const dir = entry.path.replace(/[^/]*$/, '');
        let missing = 0;
        if (/\/save\//i.test('/' + entry.path)) { // artist backup folders: named textures, text.opt lists the same number
          const n = archive.entries.filter((e) => e.path.toLowerCase().startsWith(dir.toLowerCase()) && /\.tga$/i.test(e.path)).length;
          if (n < o.count) bad(entry.fullPath, `count ${o.count} > ${n} textures in folder`);
          continue;
        }
        for (let i = 0; i < o.count; i++) {
          const n = textureName(i);
          if (!archive.find(dir + n) && !archive.find(dir + n.replace(/\.tga$/, '.wib'))) missing++;
        }
        if (missing) bad(entry.fullPath, `${missing} of ${o.count} textures missing`);
      } catch (e) { bad(entry.fullPath, e.message); }
    }
    notes.push(`.opt/.txl ${optN}: flag bytes shorter than count: ${shortFlags}, longer: ${longFlags}; values ${[...flagVals].sort((a, b) => a[0] - b[0]).map(([k, v]) => `0x${k.toString(16)}:${v}`).join(' ')}`);

    // ---- .mtl / .src
    let mtl = 0, src = 0, srcPts = 0;
    for (const { entry, data } of ctx.entries(/\.mtl$/i)) { checked++; mtl++; try { parseMtl(data); } catch (e) { bad(entry.fullPath, e.message); } }
    for (const { entry, data } of ctx.entries(/\.src$/i)) {
      checked++; src++;
      try {
        const s = parseSrc(data); srcPts += s.length;
        for (const p of s) {
          if (p.position.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e5)) bad(entry.fullPath, 'position out of range');
          if (p.direction.some((v) => !Number.isFinite(v) || Math.abs(v) > 10)) bad(entry.fullPath, 'direction out of range');
        }
      } catch (e) { bad(entry.fullPath, e.message); }
    }
    notes.push(`.mtl ${mtl} (all empty), .src ${src} (${srcPts} source points)`);

    // ---- .gob
    let gobs = 0;
    for (const { archive, entry, data } of ctx.entries(/\.gob$/i)) {
      checked++; gobs++;
      try {
        const g = parseGob(dec(data));
        const base = entry.path.replace(/[^/]*$/, '').replace(/chars\/$/i, '');
        if (g.name.toLowerCase() !== entry.path.replace(/^.*\//, '').replace(/\.gob$/i, '').toLowerCase()) bad(entry.fullPath, `name ${g.name} != file name`);
        if (g.zone.toLowerCase() !== archive.name.slice(1, 4).toLowerCase() && archive.name.length > 3) { /* zone code is the 3-letter suffix of the archive name */ }
        if (g.lods.length < 1) bad(entry.fullPath, 'no LOD');
        for (const l of g.lods) if (!archive.find(base + 'meshes/' + l.mesh)) bad(entry.fullPath, `mesh ${l.mesh} missing`);
        if (g.col && !archive.find(base + 'col/' + g.col)) bad(entry.fullPath, `col ${g.col} missing`);
        if (g.groups.length === 0) bad(entry.fullPath, 'no groups');
      } catch (e) { bad(entry.fullPath, e.message); }
    }
    notes.push(`.gob ${gobs}`);

    // ---- bricks
    const set = new Map();
    for (const { entry, data } of ctx.entries(/^brickset\.txt$/i)) {
      checked++;
      try { for (const b of parseBrickSet(dec(data))) { if (set.has(b.name.toLowerCase())) bad(entry.fullPath, `duplicate ${b.name}`); set.set(b.name.toLowerCase(), b); } } catch (e) { bad(entry.fullPath, e.message); }
    }
    if (set.size < 200) bad('brickset.txt', `only ${set.size} bricks`);
    const bricks = byArchive.get('Bricks');
    const lodNames = new Set(bricks.entries.map((e) => /^lods\/(.*)_lod\d\.msh$/i.exec(e.path)?.[1]?.toLowerCase()).filter(Boolean));
    for (const n of set.keys()) if (!lodNames.has(n)) notes.push(`brickset entry ${n} has no Bricks/lods mesh`);
    for (const n of lodNames) if (!set.has(n)) notes.push(`Bricks/lods mesh ${n} not in brickset.txt`);
    let legacyModels = 0, legacyUnknown = new Set(), models = 0, placed = 0, unknownBrick = new Set(), skippedLines = 0; const colours = new Set(), groups = new Set(), otherGroups = new Set();
    for (const { entry, data } of ctx.entries(/\.txt$/i)) {
      if (classifyTxt(entry.fullPath.split('/')[1], entry.path, data.length) !== 'brickmorph') continue;
      checked++; models++;
      try {
        const m = parseBrickModel(dec(data));
        if (m.bricks.length === 0 && m.legacy.length === 0) bad(entry.fullPath, 'no bricks');
        if (m.legacy.length) { legacyModels++; notes.push(`${entry.fullPath}: ${m.legacy.length} placements use the legacy BRICK_ORIENT syntax (not loadable by the game's sscanf format)`); }
        for (const b of m.legacy) if (!set.has(b.brick.toLowerCase())) legacyUnknown.add(b.brick);
        placed += m.bricks.length; skippedLines += m.skipped.length;
        for (const s of m.skipped) notes.push(`${entry.fullPath}:${s.line}: ignored line "${s.text.slice(0, 40)}"`);
        for (const b of m.bricks) {
          groups.add(b.group); colours.add(b.colour); if (b.colour2) colours.add(b.colour2);
          if (!set.has(b.brick.toLowerCase())) unknownBrick.add(b.brick);
          if (b.pos.some((v) => Math.abs(v) > 60) || b.rot.some((v) => Math.abs(v) > 360)) bad(entry.fullPath, `line ${b.line}: out of range`);
          if (!/^(AUTO0\d|PART(0\d|1\d))$/.test(b.group)) otherGroups.add(b.group);
        }
      } catch (e) { bad(entry.fullPath, e.message); }
    }
    if (unknownBrick.size) bad('BrickMorph', `bricks not in brickset: ${[...unknownBrick].join(',')}`);
    notes.push(`brick groups outside the AUTO00..09/PART00..19 table (map to id 255 in the game): ${[...otherGroups].sort().join(',')}`);
    notes.push(`legacy-syntax models ${legacyModels} (bricks not in brickset: ${legacyUnknown.size})`);
    notes.push(`brick models ${models}, placements ${placed}, ignored lines ${skippedLines}, groups ${[...groups].sort().join(',')}, colours ${[...colours].sort().join(',')}`);

    // ---- WhatsWhat + classification of every .txt
    const kinds = {};
    for (const { archive, entry, data } of ctx.entries(/\.txt$/i)) {
      const k = classifyTxt(archive.name, entry.path, data.length); kinds[k] = (kinds[k] ?? 0) + 1; checked++;
      if (k === 'whatswhat') {
        const w = parseWhatsWhat(dec(data));
        if (w.length === 0) bad(entry.fullPath, 'no mappings');
      }
    }
    notes.push('.txt by kind: ' + Object.entries(kinds).map(([k, v]) => `${k}:${v}`).join(' '));
    if ((kinds.cutscene ?? 0) !== 139 || (kinds.brickmorph ?? 0) !== 96) failures.push('txt classification counts changed');

    // ---- fonts
    for (const { entry, data } of ctx.entries(/\.fnt$/i)) {
      checked++;
      try {
        const f = parseFnt(data);
        for (const g of f.glyphs) if (!(g.u0 >= 0 && g.u1 <= 1.01 && g.v0 >= 0 && g.v1 <= 1.01 && g.u1 >= g.u0 && g.v1 >= g.v0)) { bad(entry.fullPath, 'glyph uv out of range'); break; }
        for (let c = 0; c < 256; c++) if (f.charMap[c] >= f.glyphCount) bad(entry.fullPath, `charMap[${c}] out of range`);
        if (measure(f, 'Hello') <= 0) bad(entry.fullPath, 'measure');
        notes.push(`${entry.fullPath}: line height ${f.lineHeight}, ${f.glyphCount} glyphs`);
      } catch (e) { bad(entry.fullPath, e.message); }
    }

    // ---- lights
    let lgt = 0, lights = 0, missingLights = 0;
    for (const { entry, data } of ctx.entries(/lights\/lights\.lgt/i)) {
      checked++; lgt++;
      try {
        const L = parseLgt(data); lights += L.lights.length;
        if (L.lights.length < 1) bad(entry.fullPath, 'no lights');
        if (L.declaredCount < L.lights.length) bad(entry.fullPath, `declared count ${L.declaredCount} < ${L.lights.length} records`); missingLights += L.declaredCount - L.lights.length;
        for (const l of L.lights) {
          if (l.type !== 0 && l.type !== 2) bad(entry.fullPath, `light type ${l.type}`);
          if (l.type === 2 && Math.abs(Math.hypot(...l.direction) - 1) > 0.01) bad(entry.fullPath, 'direction not unit');
          if (![...l.ambient, ...l.diffuse, ...l.specular].every((v) => v >= 0 && v <= 1)) bad(entry.fullPath, 'colour out of 0..1');
          if (!(l.range > 0 && l.range <= 100000)) bad(entry.fullPath, `range ${l.range}`);
        }
      } catch (e) { bad(entry.fullPath, e.message); }
    }
    notes.push(`.lgt files ${lgt} (30 lights.lgt + 8 editor variants), records ${lights}; records declared but absent from the files (zero-filled by the loader): ${missingLights}`);
    return { checked, failures, notes };
  },
};
