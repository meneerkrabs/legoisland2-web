import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev only: lists the extracted game files in public/data/le2 (the installed Game folder) and the movies in
// public/data/le2-movies, so the app can use them without the cabinet. public/data is gitignored and never built.
function devManifest(): Plugin {
  const walk = (root: string, rel = '', out: { path: string; size: number }[] = []) => {
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = fs.statSync(path.join(root, r)); // follows symlinks
      if (st.isDirectory()) walk(root, r, out);
      else out.push({ path: r, size: st.size });
    }
    return out;
  };
  return {
    name: 'le2-dev-manifest',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__le2/manifest.json', (_req, res) => {
        const data = path.join(server.config.root, 'public/data');
        const files = fs.existsSync(path.join(data, 'le2')) ? walk(path.join(data, 'le2')) : [];
        const movies: Record<string, number> = {};
        if (fs.existsSync(path.join(data, 'le2-movies'))) for (const f of walk(path.join(data, 'le2-movies'))) movies[f.path] = f.size;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ files, movies }));
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devManifest()],
  // public/ only holds dev-extracted game data (gitignored); never ship it
  build: { target: 'es2022', copyPublicDir: false },
  worker: { format: 'es' },
  server: { port: 5499, watch: { ignored: ['**/public/data/**'] } },
});
