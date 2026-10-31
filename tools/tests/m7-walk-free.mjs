import { createRunner, makeScript } from '../lib/m7-walk-run.mjs';

// M7 / WP-VERIFY: FREE runs: the port and the original start from the same state and then run alone, no re-synchronisation (the original keeps its own float32 memory for the record, the node, the
// camera, the hit cache, the animation; the port its own): after hundreds of ticks of random keys (walls, jumps, slopes, the camera orbit) they must still be identical to the last bit, i.e. no
// drift, no tie that resolves differently. The first difference ends a scenario and is reported.
export default {
  name: 'm7-walk-free',
  async run(ctx) {
    const R = await createRunner(ctx);
    const F = (name, zone, dt, ticks, seed, o = {}) => R.scenario({ name, zone, dt, free: true, held: makeScript(seed, ticks, { jump: 0.03, ...(o.script ?? {}) }), ...o });
    F('free z03PPH', 'z03PPH', 1, 700, 71);
    F('free z03PPH', 'z03PPH', 0.5, 700, 72);
    F('free z03PPH subgame 0', 'z03PPH', 1, 500, 73, { subgame: 0 });
    F('free z03PPH subgame 0', 'z03PPH', 0.5, 700, 78, { subgame: 0 });
    F('free z50LTC', 'z50LTC', 1, 300, 74);
    F('free z50LTC', 'z50LTC', 0.5, 400, 79);
    F('free z18MMP', 'z18MMP', 0.5, 300, 75);
    F('free z18MMP', 'z18MMP', 1, 200, 81);
    F('free z02LGI', 'z02LGI', 1, 350, 76);
    F('free z02LGI', 'z02LGI', 0.5, 450, 80);
    F('free z02LGI beach', 'z02LGI', 0.5, 250, 77, { pos: [505, 3.5, -88], yaw: 1.2 });
    return { checked: R.checked, failures: R.failures, notes: R.summary() };
  },
};
