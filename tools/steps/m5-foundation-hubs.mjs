// M5 foundation: all six hubs through the shared hub framework (stub story handlers): each loads through the emulated set-up with the chapter-skip URL, the
// shared island node families attach, Pepper walks (or the hub reports why not). One screenshot per hub in --out.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5510/?zone=z07CSI&node=15&mute=1&hold=1" tools/steps/m5-foundation-hubs.mjs --size 1280x800 --out /tmp/m5-foundation
import { hub, hubUrl, HUBS } from './lib-hub.mjs';
export default async ({ page, wait, log, shot }) => {
  for (const [zone, h] of Object.entries(HUBS)) {
    const node = h.nodes[0];
    await page.goto(hubUrl(zone, node), { waitUntil: 'load' });
    const H = hub({ page, wait, log, shot }, zone);
    await H.waitHub();
    log(zone, h.name, 'mode', (await H.state()).mode);
    await wait(800);
    await H.start();
    const freed = await H.freePepper();
    const s0 = await H.state();
    const boat = (await H.state()).ctrl === 8;   // the castle arrival: Pepper drives the speedboat (Space = forward, Alt = reverse, Left / Right steer: SGBoat)
    await H.hold(boat ? 'Space' : 'ArrowUp', 1200);
    await wait(300);
    const s1 = await H.state();
    log(zone, 'freed with', freed, 'taps; node', s1.node, 'ctrl', s1.ctrl, 'from', JSON.stringify(s0.pos), 'to', JSON.stringify(s1.pos), 'kinds', JSON.stringify(await H.nodeKinds()));
    const dbg = await H.debug();
    log(zone, 'notes', JSON.stringify(dbg.notes), 'skipped', dbg.skipped, 'attaches', dbg.attaches);
    await shot(`hub-${zone}`);
  }
};
