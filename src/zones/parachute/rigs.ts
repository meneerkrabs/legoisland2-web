// Animation instances for scene records that have a rig of their own (the port gives only the player an animation instance when it builds the world): the pterodactyls of
// z38PAR (anim/PTER.blk) and the rock monsters of z40aPO (anim/ROCK.blk).
import { parseBlk } from '../../formats/anim.ts';
import type { Archive } from '../../formats/archive.ts';
import { AnimInstance } from '../../game/anim.ts';
import type { World } from '../../game/world.ts';

/** every record named `name` without an animation gets an instance of `anim/<rig>.blk`, started at `clip` */
export function giveAnimations(world: World, archive: Archive, name: string, rig: string, clip = 1): number {
  const e = archive.find(`anim/${rig}.blk`);
  if (!e) return 0;
  const blk = parseBlk(archive.read(e));
  let n = 0;
  for (const r of world.records) if (r.name === name && !r.anim) { r.anim = new AnimInstance(blk); r.anim.start(clip, 0); n++; }
  return n;
}
