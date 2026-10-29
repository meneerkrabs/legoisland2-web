// The particle directory of a zone archive (`<zone>/Particle/`): the file lists in archive order (FUN_00434f91 / FUN_00434eaa, suffix match on the extension).
import type { Archive } from '../../formats/archive.ts';
import type { ParticleFiles } from './defs.ts';

export function archiveParticleFiles(archive: Archive, dir = 'particle'): ParticleFiles {
  const prefix = dir.toLowerCase() + '/';
  const inDir = archive.entries.filter((e) => e.path.toLowerCase().startsWith(prefix) && !e.path.slice(prefix.length).includes('/'));
  return {
    list(ext: string) {
      const x = ext.toLowerCase();
      return inDir.filter((e) => e.path.toLowerCase().endsWith(x)).map((e) => ({ name: e.path.slice(prefix.length), data: archive.read(e) }));
    },
    read(name: string) {
      const e = archive.find(prefix + name);
      return e ? archive.read(e) : null;
    },
  };
}
