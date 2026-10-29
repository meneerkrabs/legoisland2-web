// Entry of the Ontwikkelaarshoek for the shared loops (src/shell/playzone.ts, src/shell/frontend.ts). Only imported (dynamically) when the debug option is on (src/game/debug.ts), so
// the default game never loads, runs or even sees any of it.
import type { Shell } from '../shell/shell.ts';
import { EXIT } from '../shell/loopmachine.ts';
import { cornerOf, RunHandle } from './corner.ts';
import type { FrontRun, ZoneRun } from './types.ts';

export { cornerOf, DEV_KEY } from './corner.ts';
export type { RunHandle } from './corner.ts';

/** what the loop gives: the same as `ZoneRun` minus what this module fills in */
export type ZoneParts = Omit<ZoneRun, 'kind' | 'leaveTo'>;
export type FrontParts = Omit<FrontRun, 'kind' | 'leaveTo'>;

/** the zone starts (called by `runPlayZone` after its loop machine exists): returns the handle the loop calls, `exit` = a forced return value of the run function (the corner left the zone) */
export function attachZone(parts: ZoneParts): ZoneHandle {
  const corner = cornerOf(parts.sh);
  let forced: number | null = null;
  const run: ZoneRun = {
    ...parts, kind: 'zone',
    leaveTo(zone, node) {
      const sh = parts.sh;
      sh.loop.pending = { kind: 2, node: node ?? sh.story.node, zone };   // the front end's checkpoint exit: the zone loop's pending override (FUN_0041ad43) takes the node and the zone
      forced = -1;
      parts.machine.leave(EXIT.QUIT);
    },
  };
  const handle = corner.attach(run) as ZoneHandle;
  Object.defineProperty(handle, 'exit', { get: () => forced });
  parts.gr.debugDraw = handle.hasDraw3d() ? handle.draw3d : null;
  return handle;
}
export type ZoneHandle = RunHandle & { readonly exit: number | null };

/** the front end starts: `leaveRequest()` is polled by its loop (true once: leave for the zone that was set with `leaveTo`) */
export function attachFront(parts: FrontParts): FrontHandle {
  const corner = cornerOf(parts.sh);
  let leave = false;
  const run: FrontRun = { ...parts, kind: 'front', leaveTo(zone, node) { parts.sh.loop.pending = { kind: 2, node: node ?? parts.sh.story.node, zone }; leave = true; } };
  const handle = corner.attach(run) as FrontHandle;
  Object.defineProperty(handle, 'leaveRequest', { get: () => { const l = leave; leave = false; return l; } });
  parts.gr.debugDraw = handle.hasDraw3d() ? handle.draw3d : null;
  if (corner.pendingFrontPage !== null) { parts.openPage(corner.pendingFrontPage); corner.pendingFrontPage = null; }
  return handle;
}
export type FrontHandle = RunHandle & { readonly leaveRequest: boolean };

/** the start screen's "Ontwikkelaarshoek" button (src/main.ts): the corner opens as soon as the front end runs */
export function openOnStart(sh: Shell) { cornerOf(sh).openOnStart = true; }
