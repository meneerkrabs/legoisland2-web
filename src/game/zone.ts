// Zone data -> records. Pure (no DOM): the archive of the zone + the placement tables read out of the executable (extractZone) give the
// record array; collision objects are loaded per .col slot and shared like in the original.
import type { Archive } from '../formats/archive.ts';
import type { ZoneScene } from '../formats/exe.ts';
import { parseCol } from '../formats/col.ts';
import { GameRecord } from './record.ts';
import { ColObject } from './collision.ts';

export interface ZoneData {
  zone: string;
  scene: ZoneScene;
  archive: Archive;
  records: GameRecord[];
  /** collision objects by slot */
  cols: (ColObject | null)[];
}

/** "_data\\z02LGI\\col\\land.col" -> member "col/land.col" */
export function colMember(path: string): string {
  const p = path.split('\\');
  return p.slice(2).join('/');
}

export function buildRecords(zone: string, scene: ZoneScene, archive: Archive): ZoneData {
  const cols: (ColObject | null)[] = [];
  for (let i = 0; i < scene.colPaths.length; i++) {
    const p = scene.colPaths[i];
    if (!p) { cols[i] = null; continue; }
    const e = archive.find(colMember(p));
    if (!e) { cols[i] = null; continue; }
    try { cols[i] = new ColObject(parseCol(archive.read(e)), p); } catch (err) { console.warn('col', p, err); cols[i] = null; }
  }
  const records: GameRecord[] = [];
  for (const r of scene.records) {
    const g = new GameRecord(r.name);
    g.index = r.index;
    g.model = r.model;
    g.colObj = r.col >= 0 ? (cols[r.col] ?? null) : null;
    g.flags = r.flags || 2;
    g.m.set(r.matrix);
    g.rx = r.rot[0]; g.ry = r.rot[1]; g.rz = r.rot[2];
    g.scale = r.scale;
    g.savePrev();
    records.push(g);
  }
  return { zone, scene, archive, records, cols };
}

export const recordByName = (records: GameRecord[], name: string): GameRecord | undefined => records.find((r) => r.name === name);
