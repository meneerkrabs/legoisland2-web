// The dedicated worker that fetches archives of the HD pack (src/mods/hdfill.ts): everything heavy (HTTP ranges, inflate, CRC, OPFS writes) happens here, off the game's thread.
import { HdFiller } from './hdfill.ts';
import type { FillMsg, FillReq } from './hdfill.ts';

type In = { t: 'fill'; req: FillReq } | { t: 'urgent'; k: string; on: boolean } | { t: 'cancel'; k?: string };
const scope = self as unknown as { postMessage(m: FillMsg): void; onmessage: ((e: MessageEvent<In>) => void) | null };
const filler = new HdFiller((m) => scope.postMessage(m));
scope.onmessage = (e) => {
  const m = e.data;
  if (m.t === 'fill') void filler.fill(m.req);
  else if (m.t === 'urgent') filler.setUrgent(m.k, m.on);
  else filler.cancel(m.k);
};
