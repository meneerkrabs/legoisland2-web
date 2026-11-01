// ATTRIBUTION.txt of the LEGO 3D data pack, from the file headers of every LDraw file / OMR model the pack's geometry is derived from (CC BY 2.0 / CC BY 4.0: creator, title, URL,
// licence, modifications). files: [{ file, title, author, license }], sets: [{ set, title, author, license, url }].
export function writeAttribution(files, sets) {
  const parts = files.filter((x) => x.file.startsWith('parts/') && !x.file.startsWith('parts/s/')).sort((a, b) => a.file.localeCompare(b.file));
  const rest = files.filter((x) => !parts.includes(x));
  const authors = new Map(); for (const x of [...files, ...sets]) if (x.author) authors.set(x.author, (authors.get(x.author) ?? 0) + 1);
  const lic = new Map(); for (const x of [...files, ...sets]) { const k = x.license || '(none in header)'; lic.set(k, (lic.get(k) ?? 0) + 1); }
  return `LEGO 3D - ATTRIBUTION

The 3D geometry in this data pack is derived from the LDraw.org Parts Library (https://www.ldraw.org, https://library.ldraw.org), a library of LEGO(R) part models made by the LDraw
community, and from models of the LDraw.org Official Model Repository (OMR, https://library.ldraw.org/omr), listed below.

Licence: the Parts Library files are licensed under Creative Commons Attribution 2.0 (CC BY 2.0, "CCAL version 2.0") and/or Creative Commons Attribution 4.0 International (CC BY 4.0), as
stated in each file's header (counts below), https://creativecommons.org/licenses/by/2.0/ and https://creativecommons.org/licenses/by/4.0/ (LDraw's summary: CAreadme.txt of the library).
Creators: the authors named in the file headers, listed below; each part's page: https://library.ldraw.org/parts/ (search by part number).
Modifications: the geometry was converted to a compact data format, flattened (sub-files expanded), scaled, rotated and fitted (per-axis scale and shift) to the proportions of a computer game's
models, hidden faces removed, simplified into several levels of detail, normals recomputed, skinned to a skeleton by position rules and split into material groups. It is NOT the original LDraw
geometry. No endorsement by LDraw.org or the authors is implied.
LDraw(TM) is a trademark owned and licensed by the Estate of James Jessiman. LEGO(R) is a trademark of the LEGO Group, which does not sponsor, endorse or authorize this work.

The pack contains NO pictures or meshes of the game "LEGO Island 2": those are read from the player's own game files in the browser and are never copied here.

Licence lines found in the ${files.length + sets.length} files used:
${[...lic.entries()].map(([k, v]) => `  ${v} x ${k}`).join('\n')}

Authors (${authors.size}): ${[...authors.keys()].sort().join('; ')}

OMR set models (${sets.length}):
${sets.map((s) => `  ${s.set} ${s.title} - ${s.author} - ${s.license} - ${s.url ?? ''}`).join('\n')}

Parts used (${parts.length}):
${parts.map((p) => `  ${p.file} - ${p.title} - ${p.author} - ${p.license}`).join('\n')}

Primitives and sub-parts used: ${rest.length} files (all under the same library licence; authors above).
`;
}
