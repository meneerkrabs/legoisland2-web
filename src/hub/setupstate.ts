// What the emulated set-up leaves behind in the engine's globals besides records and nodes (M5): the story's text tables (FUN_00423fe0 / FUN_0088d280 and their
// free functions) and the objective (FUN_00424270 / 00424230 / 0042419f / 004242b9), in the order the original's code called them. A hub whose set-up selects its
// texts and objective itself (OSD: `FUN_0062bb80` loads ADVHOL9, the objective arrow at record 0x208 ...) has no story-handler call that would do it in the live
// game: `replaySetupState` applies those calls to the hub context at construction. The island does the same through its story handler (the set-up calls it once).
import type { HubContext } from './ctx.ts';
import { recIndexOfPtr } from '../formats/emusetup.ts';

/** replay the set-up's text-file and objective calls on the context (in call order) */
export function replaySetupState(ictx: HubContext): { texts: number; objective: number } {
  let texts = 0, objective = 0;
  const g = ictx.goal;
  const f32 = (u: number) => { const d = new DataView(new ArrayBuffer(4)); d.setUint32(0, u >>> 0, true); return d.getFloat32(0, true); };
  for (const c of ictx.setup.calls) {
    switch (c.fn) {
      case 0x423ff6: ictx.setText('npc', null); texts++; break;                                      // FUN_00423ff6: free the story's npc table
      case 0x88d296: ictx.setText('hol', null); texts++; break;                                      // FUN_0088d296: free the hologram table
      case 0x423fe0: if (typeof c.info?.file === 'string') { ictx.setText('npc', c.info.file); texts++; } break;     // FUN_00423fe0(path)
      case 0x88d280: if (typeof c.info?.file === 'string') { ictx.setText('hol', c.info.file); texts++; } break;     // FUN_0088d280(path)
      case 0x424270: g.record(recIndexOfPtr(c.args[0]), f32(c.args[1])); objective++; break;       // FUN_00424270(rec, r): mode 1 (a null record = none)
      case 0x424230: g.pair(recIndexOfPtr(c.args[0]), recIndexOfPtr(c.args[1]), f32(c.args[2])); objective++; break;   // FUN_00424230(a, b, r): mode 2
      case 0x42419f: g.four(recIndexOfPtr(c.args[0]), recIndexOfPtr(c.args[1]), recIndexOfPtr(c.args[2]), recIndexOfPtr(c.args[3])); objective++; break;   // FUN_0042419f(a, b, c, d): mode 4
      case 0x4242b9: g.pathNode(c.args[0] | 0, f32(c.args[1])); objective++; break;                  // FUN_004242b9(node, r): mode 3
    }
  }
  return { texts, objective };
}
