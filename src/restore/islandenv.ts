// RECONSTRUCTION helper (no game data): what the message features (tips, holo) need to know about the running island: the story node and the game variables. The island zone game hands itself
// to `islandStart` (flag.ts); `say` hooks have no access to the world, so the features keep the variable reader here. Tests (node, no zone game) install a fake reader with `setIslandVars`.
export interface IslandVars { get(i: number): number }
let vars: IslandVars | null = null;

/** `islandStart(game)`: `game` is the IslandGame (src/zones/z02LGI/index.ts, `ctx.vars` = the shell's GameVars) */
export function captureIsland(game: unknown) {
  const v = (game as { ctx?: { vars?: IslandVars } } | null)?.ctx?.vars;
  if (v && typeof v.get === 'function') vars = v;
}
export function setIslandVars(v: IslandVars | null) { vars = v; }
export const islandVar = (i: number): number | undefined => (vars ? vars.get(i) : undefined);
/** FSM_CURRENT_STATE (var 0x58): the story node; undefined before an island ran */
export const storyNode = (): number | undefined => islandVar(0x58);
