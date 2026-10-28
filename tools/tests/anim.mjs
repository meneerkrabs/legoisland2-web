import { parseBlk, sampleBlk, parseMan, manRotationMatrix, sampleMan, parseAnm, anmToQuaternion, parseCam, parseSvwl, skinPositions, skinNormals } from '../../src/formats/anim.ts';
import { parseMsh } from '../../src/formats/msh.ts';

export default {
  name: 'anim',
  run(ctx) {
    const failures = []; const notes = [];
    let checked = 0;

    // ---------------- .blk
    let foreignClips = 0, blkN = 0, askl = 0, offs = 0, emptyBlk = [], clips = 0, frames = 0, qBad = 0, qMax = 0, sampleBad = 0, loopFlag = 0;
    const blkByArchive = new Map(); // archive name -> [{name, blk}]
    const flagsSeen = {};
    for (const { archive, entry, data } of ctx.entries(/\.blk$/i)) {
      checked++; blkN++;
      try {
        const b = parseBlk(data);
        if (b.variant === 'OFFS') offs++;
        if (b.clips.length === 0) { emptyBlk.push(`${archive.name}/${entry.path}`); continue; }
        if (!b.skeleton || b.clips[0].kind !== 'ASKL') throw new Error('no skeleton in first chunk');
        askl++;
        if (!blkByArchive.has(archive.name)) blkByArchive.set(archive.name, []);
        blkByArchive.get(archive.name).push({ name: entry.path, blk: b });
        const buf = new Float32Array(b.skeleton.boneCount * 16);
        for (const c of b.clips) {
          clips++; frames += c.frameCount;
          flagsSeen[c.flags] = (flagsSeen[c.flags] ?? 0) + 1;
          if (c.flags & 0x08) loopFlag++;
          const st = 3 + 4 * c.boneCount;
          for (let f = 0; f < c.frameCount; f++) for (let k = 0; k < c.boneCount; k++) {
            const o = f * st + 3 + 4 * k;
            const d = Math.abs(Math.hypot(c.data[o], c.data[o + 1], c.data[o + 2], c.data[o + 3]) - 1);
            if (d > qMax) qMax = d;
            if (d > 1e-3) qBad++;
          }
          if (c.boneCount !== b.skeleton.boneCount) { foreignClips++; continue; } // clip of another rig stored in this file (z50LTC MFIG: 14/21-bone clips)
          for (const fr of [0, c.frameCount / 2, c.frameCount - 1, c.frameCount - 0.5]) {
            sampleBlk(b.skeleton, c, fr, true, buf);
            for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i]) || Math.abs(buf[i]) > 1e4) { sampleBad++; break; }
          }
        }
      } catch (e) { failures.push(`${archive.name}/${entry.path}: ${e.message}`); }
    }
    if (qBad) failures.push(`${qBad} non-unit quaternions (max dev ${qMax})`);
    if (sampleBad) failures.push(`${sampleBad} sampleBlk results non-finite / huge`);
    if (emptyBlk.length !== 4) failures.push(`expected 4 empty ABLK files (count 1, no chunks), got ${emptyBlk.length}: ${emptyBlk}`);
    notes.push(`blk: ${blkN} files (${askl} with skeleton, ${offs} offset-table variant, empty ABLK: ${emptyBlk.join(', ')}); ${clips} chunks, ${frames} frames; quaternion max |len-1| = ${qMax.toExponential(1)}; ${foreignClips} clips with a bone count different from their file's skeleton; flags ${JSON.stringify(flagsSeen)}`);

    // ---------------- .man
    let manN = 0; const trk = {}, dec = { 0: 0, 1: 0 };
    let rotMax = 0, scaleMin = 1e9, scaleMax = -1e9, transMax = 0, nonFinite = 0;
    for (const { archive, entry, data } of ctx.entries(/\.man$/i)) {
      checked++; manN++;
      try {
        const m = parseMan(data);
        trk[m.trackCount] = (trk[m.trackCount] ?? 0) + 1;
        dec[m.declaredFrames - m.frameCount]++;
        for (const t of m.tracks) for (let f = 0; f < m.frameCount; f++) for (let i = 0; i < 9; i++) {
          const v = t[f * 9 + i];
          if (!Number.isFinite(v)) { nonFinite++; continue; }
          if (i < 3) rotMax = Math.max(rotMax, Math.abs(v));
          else if (i < 6) transMax = Math.max(transMax, Math.abs(v));
          else { scaleMin = Math.min(scaleMin, v); scaleMax = Math.max(scaleMax, v); }
        }
      } catch (e) { failures.push(`${archive.name}/${entry.path}: ${e.message}`); }
    }
    if (nonFinite) failures.push(`${nonFinite} non-finite .man floats`);
    if (rotMax > 20) failures.push(`.man rotation max ${rotMax} rad looks wrong`);
    notes.push(`man: ${manN} files, tracks ${JSON.stringify(trk)}; stored frames = declared - {0:${dec[0]}, 1:${dec[1]}}; |rot| max ${rotMax.toFixed(2)} rad, |trans| max ${transMax.toFixed(0)}, scale ${scaleMin.toFixed(3)}..${scaleMax.toFixed(3)}`);

    // camera tracks must look at their target track along local -Z with manRotationMatrix (medium-confidence convention)
    for (const [camName, tgtName] of [['bbCrash1Cam', 'bbCrash1Target'], ['brikPalaceCam1', 'brikPalaceTarg1']]) {
      const find = (n) => { for (const { entry, data } of ctx.entries(new RegExp(`${n}\\.man$`, 'i'))) return parseMan(data); };
      const cam = find(camName), tgt = find(tgtName);
      let sum = 0, cnt = 0; const m = new Float32Array(9), a = new Float32Array(9), b = new Float32Array(9);
      for (let f = 0; f < cam.frameCount; f++) {
        sampleMan(cam, 0, f, a); sampleMan(tgt, 0, f, b);
        const d = [b[3] - a[3], b[4] - a[4], b[5] - a[5]]; const l = Math.hypot(...d); if (l < 1e-3) continue;
        manRotationMatrix(a[0], a[1], a[2], m);
        // forward = M * (0,0,-1) with M the returned (Rz*Ry*Rx)^T = minus its third column
        sum += -(m[2] * d[0] + m[5] * d[1] + m[8] * d[2]) / l; cnt++;
      }
      notes.push(`man camera ${camName}: mean cos(angle between -Z axis and camera->target) = ${(sum / cnt).toFixed(3)}`);
      if (sum / cnt < 0.9) failures.push(`${camName}: camera does not look at its target (${sum / cnt}); manRotationMatrix convention wrong`);
    }

    // ---------------- .cam
    let camN = 0, dMin = 9, dMax = 0;
    for (const { archive, entry, data } of ctx.entries(/\.cam$/i)) {
      checked++; camN++;
      try {
        const c = parseCam(data);
        if (c.version !== 1) throw new Error(`version ${c.version}`);
        const d = Math.hypot(c.look[0] - c.eye[0], c.look[1] - c.eye[1], c.look[2] - c.eye[2]);
        dMin = Math.min(dMin, d); dMax = Math.max(dMax, d);
        if (Math.abs(d - 1) > 1e-3) throw new Error(`look point at distance ${d}`);
      } catch (e) { failures.push(`${archive.name}/${entry.path}: ${e.message}`); }
    }
    notes.push(`cam: ${camN} files, |look-eye| ${dMin.toFixed(5)}..${dMax.toFixed(5)}`);

    // ---------------- .anm vs the same clip as .blk (RODD_Swish)
    let anmN = 0, anmErr = 0;
    for (const { archive, entry, data } of ctx.entries(/\.anm$/i)) {
      checked++; anmN++;
      try {
        const a = parseAnm(data);
        const sib = ctx.archives.find((x) => x.name === archive.name).find(entry.path.replace(/\.anm$/i, '.blk'));
        if (!sib) throw new Error('no sibling .blk');
        const b = parseBlk(archive.read(sib));
        const clip = b.clips[1];
        if (clip.boneCount !== a.boneCount || clip.frameCount !== a.frameCount) throw new Error('shape differs from sibling blk');
        const q = new Float32Array(4);
        for (let f = 0; f < a.frameCount; f++) for (let k = 0; k < a.boneCount; k++) {
          anmToQuaternion(a.words[f * (3 + a.boneCount) + 3 + k], q);
          const o = f * (3 + 4 * a.boneCount) + 3 + 4 * k;
          const dot = q[0] * clip.data[o] + q[1] * clip.data[o + 1] + q[2] * clip.data[o + 2] + q[3] * clip.data[o + 3];
          anmErr = Math.max(anmErr, 1 - Math.abs(dot));
        }
        if (anmErr > 2e-5) failures.push(`anm quaternions deviate from sibling blk (1-|dot| = ${anmErr})`);
      } catch (e) { failures.push(`${archive.name}/${entry.path}: ${e.message}`); }
    }
    if (anmN !== 1) failures.push(`expected 1 .anm file, got ${anmN}`);
    notes.push(`anm: ${anmN} file; max (1-|dot|) vs RODD_Swish.blk quaternions ${anmErr.toExponential(1)} (10-bit quantisation)`);

    // ---------------- SVWL / AVW2 of skinned meshes
    let skinned = 0, noRig = 0, extraTot = 0, vtxTot = 0, primaryUnskinned = 0, maxInf = 0, sumBad = 0, boneOver = 0;
    const consist = [];
    for (const { archive, entry, data } of ctx.entries(/\.msh$/i)) {
      let m;
      try { m = parseMsh(data); } catch { continue; } // msh failures belong to the msh test
      if (!m.svwl) continue;
      checked++; skinned++;
      try {
        const s = parseSvwl(m.svwl, m.vertexCount);
        const inf = new Uint8Array(m.vertexCount).fill(1);
        const sum = Float64Array.from(s.weight);
        let maxBone = -1;
        for (let i = 0; i < m.vertexCount; i++) { if (s.bone[i] < -1) throw new Error(`bone ${s.bone[i]}`); if (s.bone[i] < 0) primaryUnskinned++; maxBone = Math.max(maxBone, s.bone[i]); }
        let prev = -1;
        for (let i = 0; i < s.extra.count; i++) {
          const v = s.extra.vertex[i];
          if (v < prev) throw new Error('AVW2 not sorted by vertex');
          prev = v; sum[v] += s.extra.weight[i]; inf[v]++; maxBone = Math.max(maxBone, s.extra.bone[i]);
        }
        for (let i = 0; i < m.vertexCount; i++) { if (Math.abs(sum[i] - 1) > 2e-3) sumBad++; maxInf = Math.max(maxInf, inf[i]); }
        extraTot += s.extra.count; vtxTot += m.vertexCount;
        // skeleton candidates: blk files of the same archive with enough bones. The mesh does not name its rig, so every candidate
        // is tried and the best (lowest) mismatch is kept: a wrong rig has no way to line the influences up.
        const cands = (blkByArchive.get(archive.name) ?? []).filter((x) => x.blk.skeleton.boneCount > maxBone);
        if (!cands.length) { noRig++; continue; }
        if (!s.extra.count) continue;
        let ext = 0; for (let i = 0; i < m.vertexCount * 3; i++) ext = Math.max(ext, Math.abs(m.positions[i]));
        let best = null;
        for (const cand of cands) {
          const rig = cand.blk;
          const mats = new Float32Array(rig.skeleton.boneCount * 16);
          let err = 0, n = 0;
          const own = rig.clips.filter((c) => c.boneCount === rig.skeleton.boneCount);
          for (const clip of [own[0], own[1], own[2]].filter(Boolean)) {
            sampleBlk(rig.skeleton, clip, 0, true, mats);
            for (let i = 0; i < s.extra.count; i++) {
              const v = s.extra.vertex[i]; const b1 = s.bone[v]; const b2 = s.extra.bone[i];
              if (b1 < 0) continue;
              const P = [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]], L = [s.extra.local[i * 3], s.extra.local[i * 3 + 1], s.extra.local[i * 3 + 2]];
              const tf = (bi, p) => [0, 1, 2].map((r) => mats[bi * 16 + r] * p[0] + mats[bi * 16 + 4 + r] * p[1] + mats[bi * 16 + 8 + r] * p[2] + mats[bi * 16 + 12 + r]);
              const a = tf(b1, P), b = tf(b2, L);
              err += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); n++;
            }
          }
          const rel = n ? err / n / ext : 0;
          if (!best || rel < best.rel) { best = { rel, rig: cand.name, mats }; }
        }
        consist.push({ name: `${archive.name}/${entry.path}`, rel: best.rel, rig: best.rig });
        const out = skinPositions(m.positions, s, best.mats);
        const nrm = skinNormals(m.normals, s, best.mats, undefined, true);
        for (let i = 0; i < nrm.length; i++) if (!Number.isFinite(nrm[i])) throw new Error('skinNormals produced NaN');
        for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) throw new Error('skinPositions produced NaN');
      } catch (e) { failures.push(`${archive.name}/${entry.path}: SVWL ${e.message}`); }
    }
    if (skinned !== 399) failures.push(`expected 399 skinned meshes, got ${skinned}`);
    if (sumBad) failures.push(`${sumBad} vertices whose influence weights do not sum to 1`);
    consist.sort((a, b) => b.rel - a.rel);
    const med = consist.length ? consist[Math.floor(consist.length / 2)].rel : 0;
    const high = consist.filter((c) => c.rel > 0.25);
    notes.push(`svwl: ${skinned} skinned meshes, ${vtxTot} vertices, ${extraTot} extra influences, max ${maxInf} influences/vertex, ${primaryUnskinned} vertices with bone -1, no rig found for ${noRig}; primary-vs-extra world mismatch / mesh extent: median ${med.toFixed(3)}, worst ${consist[0]?.rel.toFixed(3)} (${consist[0]?.name}), ${high.length} meshes above 0.25: ${high.map((c) => c.name.replace('/meshes/', ':') + '=' + c.rel.toFixed(2)).join(' ')}`);
    // exact check of the sampleBlk conventions: the minifig skin (MFG_HR) lines up to float precision at the bind pose (clip 2, frame 0)
    {
      const z = ctx.archives.find((a) => a.name === 'z02LGI');
      const rig = parseBlk(z.read(z.find('anim/MFIG.blk')));
      const m = parseMsh(z.read(z.find('meshes/MFG_HR.msh')));
      const s = parseSvwl(m.svwl, m.vertexCount);
      const mats = sampleBlk(rig.skeleton, rig.clips[2], 0, true);
      let worst = 0;
      for (let i = 0; i < s.extra.count; i++) {
        const v = s.extra.vertex[i];
        const tf = (bi, p) => [0, 1, 2].map((r) => mats[bi * 16 + r] * p[0] + mats[bi * 16 + 4 + r] * p[1] + mats[bi * 16 + 8 + r] * p[2] + mats[bi * 16 + 12 + r]);
        const a = tf(s.bone[v], [m.positions[v * 3], m.positions[v * 3 + 1], m.positions[v * 3 + 2]]);
        const b = tf(s.extra.bone[i], [s.extra.local[i * 3], s.extra.local[i * 3 + 1], s.extra.local[i * 3 + 2]]);
        worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
      notes.push(`MFG_HR at MFIG clip 2 frame 0 (bind pose): worst influence mismatch ${worst.toExponential(2)}`);
      if (worst > 1e-3) failures.push(`MFG_HR does not line up at the bind pose (worst ${worst}): sampleBlk conventions broken`);
    }
    const mfgBad = consist.filter((c) => /MFG_HR/i.test(c.name) && c.rel > 0.1);
    if (mfgBad.length) failures.push(`MFG_HR influence mismatch too high (sampleBlk conventions broken?): ${mfgBad.map((c) => c.name + '=' + c.rel.toFixed(3) + ' via ' + c.rig)}`);
    return { checked, failures, notes };
  },
};
