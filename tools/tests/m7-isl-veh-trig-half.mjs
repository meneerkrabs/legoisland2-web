// WP-VERIFY M7 island triggers at dt 0.5 (the second half of m7-isl-veh-trig: same scenarios, the portal's age counter and the Duel's dt = 0.5)
import { makeTrigTest } from './m7-isl-veh-trig.mjs';
export default makeTrigTest('m7-isl-veh-trig-half', [0.5], [0, 1, 2, 3, 4]);
