// WP-TIME item 4: the shore foam's hook (SeaAmin 0x4b1212, draw hook FUN_004b109e). The decompile: the draw pass FUN_0042271b calls the hook for every pass the node ran, with NO
// visibility / frustum / flag test (those belong to the record's default draw FUN_00444480, which a handled hook replaces); the hook adds its V step, draws part 0's mesh itself with draw mode 3
// (`FUN_0043f1a0(mesh, record + 0xc, entry + 0xc, 3)`) and ends `mov eax, 1` (handled). Checked on the port: the hook draws mode 3 for a hidden / not enabled / flagged record, only while the node
// ran, reports handled (the default draw is skipped), and the V steps of the pre-render reach the vertices through the exact float32 in-place scroll (`scrollGroup` over every group = the
// original's whole-buffer add once). The native run of the original hook itself is part of m7-isl-veh-ambient.
import { World } from '../../src/game/world.ts';
import { GameRecord, RF_NO_DRAW } from '../../src/game/record.ts';
import { Controller } from '../../src/game/controller.ts';
import { SeaAminNode } from '../../src/island/ambient/misc.ts';
import { GameRenderer } from '../../src/game/render.ts';
import { Renderer } from '../../src/render/renderer.ts';
import { scrollUvs } from '../../src/render/uvscroll.ts';
import { guarded } from '../lib/inject-guard.mjs';

const __test = {
  name: 'wp-time-foam-hook',
  run() {
    const failures = [], notes = [];
    let checked = 0;
    const ok = (c, msg) => { checked++; if (!c) failures.push(msg); };

    const w = new World();
    const rec = new GameRecord('SEAE');
    rec.index = 2;
    const node = new SeaAminNode();
    rec.ctrl = new Controller();
    rec.ctrl.attach(node, 0);
    w.records.push(rec);
    ok(node.draw() === 1, 'the hook ends with eax = 1 (handled)');

    const draws = [];
    const uvs = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]);
    const mesh = { msh: { vertexCount: 6, uvs, positions: new Float32Array(18), normals: new Float32Array(18), groups: [{ firstVertex: 0, vertexCount: 4 }, { firstVertex: 4, vertexCount: 2 }], svwl: null } };
    const part = { mode: 2, texList: [], slot: 0 };
    const G = Object.create(GameRenderer.prototype);
    G.loaded = { world: w }; G.eye = [0, 0, 0];
    G.views = [{ rec, parts: [part] }];
    G.partMesh = () => mesh;
    G.viewOf = (i) => G.views.find((v) => v.rec.index === i);
    G.texFor = () => null;
    G.renderer = { drawMesh: (m, mat, tex, o) => draws.push({ m, mat, o }), scrollMeshUV: Renderer.prototype.scrollMeshUV };

    // the node ran (the update returned 1): hook = handled, one draw in mode 3 (the part's mode 2 is not used), whatever the record's flags
    for (const flags of [0, RF_NO_DRAW, 0x20, 0xffff & ~2]) {
      rec.flags = flags; draws.length = 0; rec.ctrl.ran = [true];
      const handled = G.drawHooks(rec);
      ok(handled === true && draws.length === 1 && draws[0].o.mode === 3 && draws[0].m === mesh, `ran, flags ${flags.toString(16)}: handled ${handled}, draws ${draws.length} mode ${draws[0] && draws[0].o.mode}`);
    }
    // the node did not run this pass: no hook call, so the default draw happens
    draws.length = 0; rec.ctrl.ran = [false];
    ok(G.drawHooks(rec) === false && draws.length === 0, 'node did not run: no hook, no draw, default draw');
    // a disabled controller: no hooks at all
    rec.ctrl.ran = [true]; rec.ctrl.flags = 4; draws.length = 0;
    ok(G.drawHooks(rec) === false && draws.length === 0, 'disabled controller: default draw');
    rec.ctrl.flags = 6;

    // the V step: scrollGroup over every group adds (du, dv) once to every vertex, float32, exactly scrollUvs on the whole buffer
    const ref = Float32Array.from(uvs);
    for (let i = 0; i < 500; i++) {
      const v = Math.fround(Math.sin(i * 0.05) * 0.003);
      for (let g = 0; g < 2; g++) G.scrollGroup(rec, g, 0, v);
      scrollUvs(ref, 0, v);
    }
    ok(mesh.uvOwned === true && mesh.uvDirty === true && mesh.msh.uvs !== uvs, 'the mesh took its own UV copy and is marked for upload');
    ok(uvs[0] === Math.fround(0.1), 'the shared parsed array is untouched');
    let bad = 0; for (let i = 0; i < ref.length; i++) if (!Object.is(ref[i], mesh.msh.uvs[i])) bad++;
    ok(bad === 0, `${bad} of ${ref.length} UVs differ from the whole-buffer scroll`);
    notes.push('500 passes of the foam V step, 2 groups');
    return { checked, failures, notes };
  },
};
export default guarded(__test);
