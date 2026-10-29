// M5 foundation example: the castle hub (z07CSI) through the shared hub framework with the stub story handler: loads through the emulated set-up, the shared island node
// families (Turn2Pep, MeetPepp, SGMFIG, Human1, StartCSM, building, Pizza, SGwalk, sgswim, PepSwitc ...) are attached, Pepper walks. Screenshots in --out.
//   sh tools/m5-botslot.sh node tools/browse.mjs "http://localhost:5510/?zone=z07CSI&node=15&mute=1&hold=1" tools/steps/m5-foundation-csi.mjs --size 1280x800 --out /tmp/m5-foundation
import { hub } from './lib-hub.mjs';
export default async ({ page, wait, log, shot }) => {
  const H = hub({ page, wait, log, shot }, 'z07CSI');
  await H.waitHub();
  log('mode', (await H.state()).mode);
  await wait(1500);
  await shot('csi-mode1');
  await H.start();
  log('state', JSON.stringify(await H.state()));
  log('kinds', JSON.stringify(await H.nodeKinds()));
  log('debug', JSON.stringify(await H.debug()).slice(0, 600));
  await H.hold('ArrowUp', 1500);
  await wait(500);
  await shot('csi-walk');
  log('state', JSON.stringify(await H.state()));
};
