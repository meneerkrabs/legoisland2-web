// Restored content, feature 'arrow' (docs/re/restore.md): the objective arrow. Unit test of the bearing (four quadrants + diagonals), the hide rules (arrival radius = the objective's own
// radiusSq, cutscene, node >= 0x3d, mode 0, no target) and of the HUD callback on the real island world with the real Objective (record / pair / PATH node modes).
import { loadIsland } from '../lib/island-load.mjs';
import { Objective } from '../../src/zones/z02LGI/objective.ts';
import { Hud } from '../../src/shell/hud.ts';

export default {
  name: 'restore-arrow',
  async run(ctx) {
    const failures = [], notes = []; let checked = 0;
    const ok = (c, m) => { checked++; if (!c) failures.push(m); };
    const A = await import('../../src/restore/features/arrow.ts');
    const near = (a, b) => Math.abs(a - b) < 1e-9;

    // ---- bearing: the camera at the origin looks along +z (the view's right is +x: src/game/camera.ts updateView)
    const eye = [0, 5, 0], look = [0, 0, 10], me = [0, 0, 0];
    ok(near(A.bearing(eye, look, me, [0, 0, 50]), 0), 'ahead = 0');
    ok(near(A.bearing(eye, look, me, [50, 0, 0]), Math.PI / 2), 'right = +90');
    ok(near(Math.abs(A.bearing(eye, look, me, [0, 0, -50])), Math.PI), 'behind = 180');
    ok(near(A.bearing(eye, look, me, [-50, 0, 0]), -Math.PI / 2), 'left = -90');
    ok(near(A.bearing(eye, look, me, [30, 0, 30]), Math.PI / 4) && near(A.bearing(eye, look, me, [-30, 0, 30]), -Math.PI / 4), 'diagonals +-45');
    // the camera turned to look along +x: a target on +z is then to the RIGHT of the view (a left-handed view: right = (fz, -fx))
    ok(near(A.bearing([0, 5, 0], [10, 0, 0], me, [0, 0, 50]), -Math.PI / 2), 'camera turned right (+x): a target on +z is to its left');
    ok(near(A.bearing([0, 5, 0], [0, 0, -10], me, [50, 0, 0]), -Math.PI / 2), 'camera looking along -z: +x is to its left');
    // the pointer is relative to the focus, not to the camera eye
    ok(near(A.bearing([100, 5, 100], [100, 0, 110], [10, 0, 10], [10, 0, 60]), 0), 'from Pepper, not from the camera');

    // ---- hide rules
    const base = { mode: 1, radiusSq: 16384, target: { pos: [200, 0, 0] }, focus: me, eye, look, node: 8, cutscene: false };
    ok(A.arrowAngle(base) !== null, 'shown: far target');
    ok(A.arrowAngle({ ...base, target: { pos: [127, 0, 0] } }) === null && A.arrowAngle({ ...base, target: { pos: [129, 0, 0] } }) !== null, 'radius cut-off at sqrt(radiusSq) = 128');
    ok(A.arrowAngle({ ...base, mode: 0 }) === null, 'mode 0: none');
    ok(A.arrowAngle({ ...base, cutscene: true }) === null, 'cutscene: none');
    ok(A.arrowAngle({ ...base, node: 0x3d }) === null && A.arrowAngle({ ...base, node: 0x3c }) !== null, 'node >= 0x3d: none');
    ok(A.arrowAngle({ ...base, target: null }) === null && A.arrowAngle({ ...base, focus: null }) === null, 'no target / no focus: none');

    // ---- the real objective on the island world (nodes 8 / 12 / 31 use record / pair / PATH node objectives)
    const I = loadIsland(ctx, { node: 8 });
    const w = I.world, goal = new Objective();
    const pathPos = (n) => [100 * n, 0, 0];
    const hud = new Hud(null);
    const calls = [];
    const ui = { anchor() {}, spriteRot: (...a) => calls.push(a) };
    const game = { ictx: { world: w, goal, objective: { target: (from) => goal.target(w.records, from, 0, pathPos, null) }, cutsceneActive: () => false }, ctx: { hud } };
    A.install(game); A.install(game);
    ok(hud.extras.length === 1, 'installed once per HUD');
    const draw = () => { calls.length = 0; hud.extras[0](ui); return calls.length; };
    const P = I.pepper, c = w.camera.c;
    P.x = 0; P.y = 0; P.z = 0; w.focus = P;
    c.set([0, 5, -16, 0, 3, 0]);
    ok(draw() === 0, 'mode 0 (objective cleared): nothing drawn');
    const target = w.records.find((r) => r.name === 'PIZB') ?? w.records[30];
    // mode 1 (a record, node 8-like): the record straight ahead (+z) of Pepper, far
    goal.record(target.index, 16);
    target.x = 0; target.z = 300; target.y = 0;
    ok(draw() === 1 && near(calls[0][5] + Math.PI / 2, 0) && calls[0][1] === 8, 'mode 1: arrow drawn, texture 8, pointing up for straight ahead');
    target.x = 300; target.z = 0;
    ok(draw() === 1 && near(calls[0][5] + Math.PI / 2, Math.PI / 2), 'mode 1: target to the right turns the arrow clockwise');
    target.x = 3; target.z = 3;
    ok(draw() === 0, 'mode 1: inside the arrival radius: no arrow');
    // mode 2 (a pair: the target is the second record)
    goal.pair(target.index === 0 ? 1 : 0, target.index, 8);
    target.x = -400; target.z = 0;
    ok(draw() === 1 && near(calls[0][5] + Math.PI / 2, -Math.PI / 2), 'mode 2: the second record is the target');
    // mode 3 (a PATH node, node 31-like): node 4 at (400, 0, 0): to the right
    goal.pathNode(4, 16);
    ok(draw() === 1 && near(calls[0][5] + Math.PI / 2, Math.PI / 2), 'mode 3: PATH node position');
    w.vars.set(0x58, 0x3d);
    ok(draw() === 0, 'node 0x3d: nothing');
    w.vars.set(0x58, 8);
    hud.visible = false; ok(draw() === 0, 'hidden HUD: nothing'); hud.visible = true;
    w.focus = null; ok(draw() === 0, 'no focus: nothing');
    notes.push('bearing quadrants, radius cut-off and the callback on the real island world');
    return { checked, failures, notes };
  },
};
