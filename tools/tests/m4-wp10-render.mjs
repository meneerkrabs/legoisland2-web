// M4 WP10 (island rendering fixes, docs/re/m4/wp10-render.md): the face set-up extracted from the zone builder (Faces.c FUN_0043f1d0), the face groups'
// UVs / sheets, the view-frustum test behind IslandCtx.inFrustum (FUN_00444370), the renderer hook for WP4's live part matrices, SeaAmin's UV drift
// through ctx.uvScroll, and the lighting formula of the skinned path (FUN_0088589e + FUN_00885664) against the renderer's world-space formula.
import { loadIsland, tick } from '../lib/island-load.mjs';
import { parseMsh } from '../../src/formats/msh.ts';
import { parseWib } from '../../src/formats/wib.ts';
import { GameRenderer, clipPlanes } from '../../src/game/render.ts';
import { lookDirLH, mul } from '../../src/render/math.ts';
import { projection } from '../../src/render/camera.ts';
import { lightVertex } from '../../src/render/lighting.ts';
import { IslandContext } from '../../src/zones/z02LGI/ctx.ts';
import { partMatrix, partOverrides } from '../../src/island/trigger/parts.ts';
import { RF_ENABLED } from '../../src/game/record.ts';

export default {
  name: 'm4-wp10-render',
  run(ctx) {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };

    const I = loadIsland(ctx, { node: 2 });
    const { scene, archive, world: w } = I;

    // ---------------------------------------------------------------- faces (FUN_0043f1d0 calls of the builder FUN_004c34c0)
    const face = (n) => scene.records.find((r) => r.name === n)?.model?.face;
    for (const n of ['INFO', 'PAPA', 'MAMA', 'NICK', 'BILL', 'BBT0', 'NUBB', 'HOLO']) {
      const f = face(n);
      ok(f && f.slot === 4 && f.type === 1 && f.groups.join() === '1,1,1,1,1', `${n}: face set-up ${JSON.stringify(f)} (slot 4, .wib type 1, group 1 in every LOD)`);
    }
    ok(face('PEPP')?.groups.join() === '0,0,1,1,0' && face('PEPP')?.type === 1, `PEPP face groups ${JSON.stringify(face('PEPP'))} (HR/MR group 0, LR/SLR group 1)`);
    ok(face('SFT0')?.type === 0 && face('RBT0')?.type === 0, 'swifts / bunnies: type 0 calls (no head attachment: no face object)');
    const withFace = scene.records.filter((r) => r.model?.face).length;
    notes.push(`${withFace} records have a face set-up (SBRD, 9..66)`);

    // the head's face group maps into the top-left quarter of its 64x64 16-frame sheet; x4 about v = 1 (FUN_0087e260) fills the texture
    for (const n of ['INFO', 'PAPA', 'PEPP']) {
      const rec = scene.records.find((r) => r.name === n);
      const head = rec.model.attach[4].child, f = rec.model.face;
      for (let li = 0; li < head.parts.length; li++) {
        const p = head.parts[li];
        if (!p) continue;
        const g = f.groups[li];
        const member = scene.meshPaths[p.mesh].split('\\').slice(2).join('/');
        const msh = parseMsh(archive.read(archive.find(member)));
        const grp = msh.groups[g];
        let u0 = 9, u1 = -9, v0 = 9, v1 = -9;
        for (let i = grp.firstVertex; i < grp.firstVertex + grp.vertexCount; i++) {
          const u = msh.uvs[i * 2] * 4, v = (msh.uvs[i * 2 + 1] - 1) * 4 + 1;
          u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
        }
        ok(u0 > -0.05 && u1 < 1.05 && v0 > (li < 3 ? -0.05 : -0.4) && v1 < 1.05 && u1 - u0 > 0.8 && v1 - v0 > 0.7,   // the two lowest LODs reach below the face (chin, wraps)
           `${n} LOD ${li}: face group ${g} scaled UVs u ${u0.toFixed(2)}..${u1.toFixed(2)} v ${v0.toFixed(2)}..${v1.toFixed(2)}`);
        const tex = scene.texLists[p.texList][g];
        const e = archive.find(`textures/Text${String(tex).padStart(3, '0')}.wib`);
        const wib = e && parseWib(archive.read(e));
        ok(wib && wib.frameCount === 16, `${n} LOD ${li}: face texture ${tex} is a 16-frame .wib`);
      }
    }

    // ---------------------------------------------------------------- frustum (clipPlanes / sphereVisible)
    const eye = [0, 10, 0], fwd = [0, 0, 1];
    const vp = mul(lookDirLH(eye, fwd), projection({ fov: 1, near: 4, far: 450 }, 4 / 3));
    const fake = Object.create(GameRenderer.prototype);
    fake.planes = clipPlanes(vp, new Float32Array(24));
    ok(fake.sphereVisible([0, 10, 50], 1), 'a sphere straight ahead is visible');
    ok(!fake.sphereVisible([0, 10, -50], 1), 'a sphere behind the camera is not');
    ok(!fake.sphereVisible([0, 10, 600], 1), 'beyond the far plane: not visible');
    ok(fake.sphereVisible([0, 10, 455], 10), 'a sphere crossing the far plane is visible');
    ok(!fake.sphereVisible([200, 10, 50], 1) && !fake.sphereVisible([-45, 10, 50], 1) && fake.sphereVisible([30, 10, 50], 1) && fake.sphereVisible([-30, 10, 50], 1), 'left / right planes (half width at z 50: 36.4 for 4:3)');
    ok(!fake.sphereVisible([0, 10, 2], 1) && fake.sphereVisible([0, 10, 2], 3), 'near plane 4 (radius taken into account)');

    // IslandContext.inFrustum (FUN_00444370 rules) with a bound renderer
    const ictx = new IslandContext(w, I.pe, archive, I.profile.island, scene);
    const zg = { gr: fake, sh: { audio: null } };
    ictx.bind(zg, null);
    const withCol = w.records.find((r) => r.colObj && r.enabled && r.name === 'PIZB') ?? w.records.find((r) => r.colObj && r.enabled && r.index > 4);
    const noCol = w.records.find((r) => r.enabled && r.model && r.name === 'LAND');   // every island record has a collision object: test the rule with it removed
    if (withCol && noCol) {
      // camera 60 units in front of the record, looking at it / away from it
      const c = withCol.toWorld(withCol.colObj.col.center);
      fake.planes = clipPlanes(mul(lookDirLH([c[0], c[1], c[2] - 60], [0, 0, 1]), projection({ fov: 1, near: 4, far: 450 }, 4 / 3)), new Float32Array(24));
      ok(ictx.inFrustum(withCol), `${withCol.name} in view`);
      fake.planes = clipPlanes(mul(lookDirLH([c[0], c[1], c[2] - 60], [0, 0, -1]), projection({ fov: 1, near: 4, far: 450 }, 4 / 3)), new Float32Array(24));
      ok(!ictx.inFrustum(withCol), `${withCol.name} behind the camera`);
      { const co = noCol.colObj; noCol.colObj = null; ok(ictx.inFrustum(noCol), `${noCol.name}: no collision object -> flag set`); noCol.colObj = co; }
      const f0 = withCol.flags; withCol.flags &= ~RF_ENABLED;
      ok(!ictx.inFrustum(withCol), 'a disabled record is never in view');
      withCol.flags = f0;
      const bare = Object.create(GameRenderer.prototype); bare.planes = null;
      ictx.bind({ gr: bare, sh: { audio: null } }, null);
      ok(ictx.inFrustum(withCol), 'before the first frame: in view');
    } else ok(false, 'no records for the frustum check');

    // ---------------------------------------------------------------- live part matrices (WP4 contract): bind() wires partOverrides
    const infc = w.records.find((r) => r.name === 'INFC');
    const m = partMatrix(w, infc, 1);
    ok(!!m, 'INFC has MATL part 1 (a door)');
    ok(typeof zg.gr.partMatrices === 'function' && zg.gr.partMatrices(infc) === partOverrides(w, infc) && zg.gr.partMatrices(infc).get(1) === m, 'ctx.bind -> GameRenderer.partMatrices = partOverrides');

    // ---------------------------------------------------------------- SeaAmin: ctx.uvScroll gets the per-tick V delta (FUN_004b109e -> FUN_0043ebe0 mode 0 adds)
    const seae = w.records.find((r) => r.name === 'SEAE');
    const sea = seae?.ctrl?.nodes.find((n) => n.kind === 'SeaAmin');
    const got = [];
    I.ictx.uvScroll = (rec, du, dv) => got.push([rec, du, dv]);
    tick(I, 200);
    ok(sea && got.length >= 200 && got.every(([r, du]) => r === seae && du === 0), `SeaAmin calls uvScroll once per tick for SEAE (${got.length})`);
    const sum = got.reduce((s, x) => s + x[2], 0), mx = Math.max(...got.map((x) => Math.abs(x[2])));
    ok(mx <= 0.003 + 1e-9 && sum < 0, `V delta = sin(phase) * 0.003 (max ${mx.toFixed(4)}), net drift negative (${sum.toFixed(3)} over 200 ticks)`);
    notes.push(`shore foam V drift over 200 ticks: ${sum.toFixed(3)}`);
    delete I.ictx.uvScroll;

    // ---------------------------------------------------------------- lighting: FUN_00885664 (light into model space, negated) + FUN_0088589e == lightVertex(world normal)
    const L = { ambient: [0.18, 0.18, 0.24], directional: [{ dir: [0.70710677, 0.59966058, 0.37470952], color: [1, 1, 1] }], point: [] };
    { const d = L.directional[0].dir, l = Math.hypot(...d); L.directional[0].dir = d.map((x) => x / l); }
    let worst = 0;
    for (let k = 0; k < 50; k++) {
      const yaw = k * 0.37, c = Math.cos(yaw), s = Math.sin(yaw);
      const R = [c, 0, -s, 0, 1, 0, s, 0, c];                // row-vector rotation about y (rows = model axes in world)
      const nm = [Math.sin(k), Math.cos(k * 1.3), Math.sin(k * 0.7)]; const nl = Math.hypot(...nm); for (let i = 0; i < 3; i++) nm[i] /= nl;
      const d = L.directional[0].dir;
      // FUN_0043b0c5: R^T d (component i = d . row i), negated, normalised; FUN_0088589e: I = -(L . n)
      const lm = [0, 1, 2].map((i) => -(d[0] * R[i * 3] + d[1] * R[i * 3 + 1] + d[2] * R[i * 3 + 2]));
      const I0 = Math.max(0, -(lm[0] * nm[0] + lm[1] * nm[1] + lm[2] * nm[2]));
      const orig = [0, 1, 2].map((ch) => Math.max(I0 * L.directional[0].color[ch], L.ambient[ch]));
      const nw = [0, 1, 2].map((j) => nm[0] * R[j] + nm[1] * R[3 + j] + nm[2] * R[6 + j]);   // n * R
      const port = lightVertex(L, nw);
      for (let ch = 0; ch < 3; ch++) worst = Math.max(worst, Math.abs(orig[ch] - port[ch]));
    }
    ok(worst < 1e-6, `skinned lighting in model space == the renderer's world-space formula (max diff ${worst})`);

    return { checked, failures, notes };
  },
};
