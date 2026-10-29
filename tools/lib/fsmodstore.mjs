// A ModStore (src/mods/store.ts) on a plain directory, for node tests of the streaming import: same layout as the OPFS store (`<id>/f000001`, `mod.json` last).
import fs from 'node:fs';
import path from 'node:path';

export class FsModStore {
  persistent = true;
  constructor(dir) { this.dir = dir; fs.mkdirSync(dir, { recursive: true }); }
  async list() {
    const out = [];
    for (const d of fs.readdirSync(this.dir)) {
      const j = path.join(this.dir, d, 'mod.json');
      if (fs.existsSync(j)) out.push(JSON.parse(fs.readFileSync(j, 'utf8')));
      else fs.rmSync(path.join(this.dir, d), { recursive: true, force: true });
    }
    return out.sort((a, b) => a.seq - b.seq);
  }
  async begin() {
    const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const dir = path.join(this.dir, id);
    const seq = (await this.list()).reduce((n, m) => Math.max(n, m.seq), 0) + 1;
    fs.mkdirSync(dir);
    const files = [];
    return {
      id,
      addFile: async (p, size, stream) => {
        const key = `f${String(files.length + 1).padStart(6, '0')}`;
        const out = fs.createWriteStream(path.join(dir, key));
        let n = 0;
        await stream.pipeTo(new WritableStream({ write(c) { n += c.length; return new Promise((res, rej) => out.write(c, (e) => (e ? rej(e) : res()))); }, close() { return new Promise((res) => out.end(res)); } }));
        if (n !== size) throw new Error(`Verkeerde lengte: ${n} in plaats van ${size} bytes.`);
        files.push({ path: p, size, key });
      },
      commit: async (meta) => { const m = { ...meta, id, seq, enabled: true, addedAt: Date.now(), files }; fs.writeFileSync(path.join(dir, 'mod.json'), JSON.stringify(m)); return m; },
      abort: async () => { fs.rmSync(dir, { recursive: true, force: true }); },
    };
  }
  async setEnabled(id, enabled) { const j = path.join(this.dir, id, 'mod.json'); const m = JSON.parse(fs.readFileSync(j, 'utf8')); m.enabled = enabled; fs.writeFileSync(j, JSON.stringify(m)); }
  async move() {}
  async remove(id) { fs.rmSync(path.join(this.dir, id), { recursive: true, force: true }); }
  async readFile(id, key) { return new Uint8Array(fs.readFileSync(path.join(this.dir, id, key))); }
}
