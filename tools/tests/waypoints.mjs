import { parseCompiledWaypoints, parseEditorWaypoints, parseWaypointHeader, parseWbt, nextHop } from '../../src/formats/waypoints.ts';

const dec = (b) => Buffer.from(b).toString('latin1');
// `.wbt` layer names -> compiled file name (`W_<X>_C.wpt`)
const MAP_ALIAS = { OTHER: 'OTH' };
export default {
  name: 'waypoints',
  run(ctx) {
    const failures = []; const notes = []; let checked = 0;
    const bad = (f, m) => failures.push(`${f}: ${m}`);
    let comp = 0, ed = 0, wbt = 0, hdr = 0, nodes = 0, edges = 0, routes = 0, groupOut = 0;
    const kinds = new Map(), disconnected = new Map();
    for (const archive of ctx.archives) {
      const compiled = new Map(); // upper map name -> parsed (non-backup files)
      const full = (e) => `_data/${archive.name}/${e.path}`;
      // pass 1: compiled and editor files
      for (const entry of archive.entries) {
        if (!/\.(wpt|way)$/i.test(entry.path)) continue;
        checked++;
        const data = archive.read(entry);
        const isBackup = /(^|\/)backup\//i.test(entry.path);
        try {
          if (dec(data.subarray(0, 4)) === 'WPTP') {
            ed++;
            const e = parseEditorWaypoints(data);
            for (const l of e.links) if (l.a >= e.nodes.length || l.b >= e.nodes.length || !(l.length >= 0)) bad(full(entry), `bad link ${l.a}-${l.b}`);
            for (const n of e.nodes) {
              if (![n.x, n.y, n.z].every((v) => Number.isFinite(v) && Math.abs(v) < 3000)) bad(full(entry), `node ${n.name} out of range`);
              if (n.cls > 9) bad(full(entry), `class ${n.cls}`);
              if (n.reserved !== 0) bad(full(entry), 'reserved != 0');
            }
            continue;
          }
          comp++;
          const c = parseCompiledWaypoints(data);
          nodes += c.nodes.length; edges += c.matrices.length;
          const m = /W_(\w+)_C\.wpt$/i.exec(entry.path);
          if (!m) bad(full(entry), 'compiled waypoint file with unexpected name');
          else if (!isBackup) compiled.set(m[1].toUpperCase(), c);
          for (const n of c.nodes) {
            if (![n.x, n.y, n.z].every((v) => Number.isFinite(v) && Math.abs(v) < 3000)) bad(full(entry), `node ${n.name} out of range`);
            if (n.link >= c.nodes.length) bad(full(entry), `link ${n.link} out of range`);
            kinds.set(`${n.kind}/${n.mask}`, (kinds.get(`${n.kind}/${n.mask}`) ?? 0) + 1);
            if (c.matrices.length && n.group >= c.matrices.length) groupOut++;
          }
          // route matrices: group g owns a h x (h + groups) table; every in-group lookup must return a valid node
          for (let g = 0; g < c.matrices.length; g++) {
            const members = c.nodes.map((n, i) => ({ n, i })).filter((x) => x.n.group === g);
            const mat = c.matrices[g];
            if (mat.h !== members.length) bad(full(entry), `matrix ${g}: h ${mat.h} != group size ${members.length}`);
            if (mat.w !== mat.h + c.matrices.length) bad(full(entry), `matrix ${g}: w ${mat.w} != h + groups`);
            members.forEach((x, k) => { if (x.n.index !== k) bad(full(entry), `group ${g}: node ${x.i} has index ${x.n.index}, expected ${k}`); });
            for (const a of members) for (const b of members) {
              if (a === b) continue;
              routes++;
              const nx = nextHop(c, a.i, b.i);
              // -1 in a matrix cell = no route between the two nodes (disconnected sub-graph)
              if (nx === -1) { disconnected.set(full(entry), (disconnected.get(full(entry)) ?? 0) + 1); continue; }
              if (nx < 0 || nx >= c.nodes.length) { bad(full(entry), `nextHop(${a.i},${b.i}) = ${nx} out of range`); continue; }
              // follow the hops; a route may legitimately end because the group graph is disconnected
              let cur = a.i, steps = 0;
              while (cur !== b.i && steps++ <= members.length) { const n2 = nextHop(c, cur, b.i); if (n2 === cur || n2 < 0) break; cur = n2; }
              if (cur !== b.i) bad(full(entry), `hop chain ${a.i} -> ${b.i} does not reach the target`);
            }
          }
        } catch (e) { bad(full(entry), e.message); }
      }
      // pass 2: build lists and name headers
      for (const entry of archive.entries) {
        if (/\.wbt$/i.test(entry.path)) {
          checked++; wbt++;
          try {
            const lines = parseWbt(dec(archive.read(entry)));
            const dir = entry.path.replace(/[^/]*$/, '');
            const sums = new Map(), names = new Map();
            for (const l of lines) {
              if (l.commented) continue;
              const f = archive.find(dir + (/\.\w+$/.test(l.file) ? l.file : l.file + '.way'));
              if (!f) { bad(full(entry), `listed file ${l.file} missing`); continue; }
              const e = parseEditorWaypoints(archive.read(f));
              sums.set(l.layer, (sums.get(l.layer) ?? 0) + e.nodes.length);
              if (l.as) names.set(l.layer, l.as.toUpperCase());
            }
            for (const [layer, n] of sums) {
              const nm = names.get(layer);
              const c = compiled.get(MAP_ALIAS[nm] ?? nm);
              if (!c) { notes.push(`${full(entry)}: layer ${layer} (${nm}) has no compiled file in the archive`); continue; }
              if (c.nodes.length !== n) bad(full(entry), `layer ${layer} ${nm}: compiled ${c.nodes.length} nodes, build list sums to ${n}`);
            }
          } catch (e) { bad(full(entry), e.message); }
        } else if (/aW_\w+_\.h$/i.test(entry.path)) {
          checked++; hdr++;
          try {
            const h = parseWaypointHeader(dec(archive.read(entry)));
            if (!h.guard) bad(full(entry), 'no include guard');
            if (h.entries.length === 0) notes.push(`${full(entry)}: header lists no waypoints`);
            const seen = new Set();
            for (const en of h.entries) {
              if (seen.has(en.name)) bad(full(entry), `duplicate ${en.name}`); seen.add(en.name);
              const c = compiled.get(en.map);
              if (!c) { bad(full(entry), `no compiled map ${en.map}`); continue; }
              const idx = c.nodes.findIndex((x) => x.name === en.short);
              if (idx !== en.index) { if (idx < 0) notes.push(`${full(entry)}: ${en.name}=${en.index} is not in the compiled file (stale)`); else bad(full(entry), `${en.name} = ${en.index} but compiled index ${idx}`); }
            }
          } catch (e) { bad(full(entry), e.message); }
        }
      }
    }
    notes.unshift(`compiled _C.wpt ${comp} (${nodes} nodes, ${edges} route matrices, ${routes} in-group lookups checked), editor WPTP files ${ed}, .wbt ${wbt}, .h ${hdr}`);
    notes.push(`node kind/mask pairs: ${[...kinds].map(([k, v]) => `${k}:${v}`).join(' ')}; nodes with group >= matrix count: ${groupOut}`);
    notes.push(`in-group pairs with hop -1 (no route; disconnected sub-graphs) per file: ${[...disconnected].map(([k, v]) => `${k.replace('_data/', '')}:${v}`).join(' ') || 'none'}`);
    return { checked, failures, notes };
  },
};
