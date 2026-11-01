// The one place where the LEGO 3D option meets the game's file layer (docs/re/lego3d.md section 8): with the option OFF nothing here runs and `attachLego3d` returns the
// files it was given, so the game is exactly the original. With it ON the files are wrapped in the mod layer (an empty layer changes nothing by itself) and the layer gets a
// generator that `GameData.archive` calls after the mods' own files are in an archive (so LEGO 3D's textures win over an HD pack's).
import type { GameFiles } from '../../files.ts';
import { ModdedFiles, ModLayer } from '../overlay.ts';
import { Lego3dRuntime } from './runtime.ts';

/** `?lego3d=1` -> [], `?lego3d=chars,-studs` -> ['chars', '-studs'] (debugging: only / without these generators) */
export function lego3dOptions(search: string): string[] {
  const v = new URLSearchParams(search).get('lego3d');
  return v && v !== '1' ? v.split(',').filter(Boolean) : [];
}

export let lego3dRuntime: Lego3dRuntime | null = null;

/** wraps `files` so that archives get generated members; resolves with the files untouched when the pack cannot be had in time (play is never held up for long) */
export async function attachLego3d(files: GameFiles, packUrl: string, options: string[], waitMs = 8000): Promise<GameFiles> {
  const rt = new Lego3dRuntime(packUrl, options);
  if (!(await rt.ready(waitMs))) return files;
  lego3dRuntime = rt;
  const out = files instanceof ModdedFiles ? files : new ModdedFiles(files, new ModLayer([]));
  out.generateOverrides = (name, archive, other) => rt.apply(name, archive, other);
  return out;
}
