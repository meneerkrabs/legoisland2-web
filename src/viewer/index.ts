// Asset / zone viewer: ?viewer=1[&zone=z02LGI][&mode=grid][&data=data/le2/]
// Loads a zone archive (+ the placement tables read out of the executable), draws every placed object
// with its textures, free-fly camera (WASD + drag, Q/E down/up, Shift fast), object list + picking.
import { Renderer, SkyState, SeaState, SKY_MODE, SEA_MODE, SEABED_MODE, SEA_EDGE_MODE, DEFAULT_FOV, cameraFromFog, defaultLights, lightSetFromLgt, projection, selectLod } from '../render/index.ts';
import type { MeshGpu, TexGpu, CameraSetup } from '../render/index.ts';
import { GameData, type FileSource, ZONES, OTHER_ARCHIVES } from './data.ts';
import { lookDirLH, mul, transformPoint } from '../render/math.ts';
import type { Mat4 } from '../render/math.ts';
import { parseLgt } from '../formats/lights.ts';
import { extractRenderParams } from '../formats/zoneparams.ts';
import type { Archive } from '../formats/archive.ts';
import type { ZoneScene, Model } from '../formats/exe.ts';
import { parseBlk, sampleBlk, parseSvwl, skinPositions, skinNormals } from '../formats/anim.ts';
import type { Blk } from '../formats/anim.ts';

interface Part { meshPath: string | null; texList: number[]; lod: number; mesh?: MeshGpu | null }
interface Attach { bone: number; parts: Part[] }
interface Obj {
  label: string;
  /** child models bolted to skeleton bones (heads, hats, hands...), drawn with boneMatrix * world */
  attach?: Attach[];
  /** row-major bone matrices (16 floats per bone) when the object is a posed skinned model */
  bones?: Float32Array;
  matrix: Mat4;
  parts: Part[];
  center: number[]; radius: number;
  /** environment object (sky dome, sea plane, seabed): not pickable, ignored when framing the scene */
  sky?: boolean;
  /** special placement of the zone's SSKY / SSEA records (src/render/environment.ts) */
  kind?: 'sky' | 'sea';
  /** part draw mode (src/render/states.ts): 0 default, 2 sky / shore foam, 3 sea / seabed */
  mode?: number;
  info: string;
}

export async function startViewer(root: HTMLElement, files?: FileSource) {
  const params = new URLSearchParams(location.search);
  const data = new GameData(files ?? params.get('data') ?? `${import.meta.env.BASE_URL}data/le2/`);
  root.replaceChildren();
  const style = document.createElement('style');
  style.textContent = `
  .v-root{position:fixed;inset:0;background:#111;font:12px/1.35 ui-monospace,Menlo,monospace;color:#ddd}
  .v-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
  .v-hud{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.62);padding:8px 10px;border-radius:6px;max-width:360px;z-index:2}
  .v-hud select,.v-hud button,.v-hud input{font:inherit;background:#222;color:#eee;border:1px solid #555;border-radius:3px;margin:1px}
  .v-list{position:absolute;right:8px;top:8px;bottom:8px;width:290px;background:rgba(0,0,0,.62);border-radius:6px;display:flex;flex-direction:column;z-index:2}
  .v-list input{margin:6px;font:inherit;background:#222;color:#eee;border:1px solid #555;padding:3px}
  .v-items{overflow:auto;flex:1;padding:0 4px 6px}
  .v-items div{padding:1px 4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .v-items div:hover{background:#345}.v-items div.sel{background:#654}
  .v-status{white-space:pre-wrap;margin-top:4px;color:#9c9}.v-info{margin-top:4px;color:#fc6;white-space:pre-wrap}
  .v-hide .v-hud,.v-hide .v-list{display:none}
  `;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.className = 'v-root';
  const canvas = document.createElement('canvas');
  const hud = document.createElement('div'); hud.className = 'v-hud';
  const listBox = document.createElement('div'); listBox.className = 'v-list';
  wrap.append(canvas, hud, listBox);
  root.appendChild(wrap);

  let renderer: Renderer;
  try { renderer = new Renderer(canvas); } catch (e) { hud.textContent = String(e); return; }

  // ---- HUD
  const zoneSel = document.createElement('select');
  for (const z of [...ZONES, ...OTHER_ARCHIVES]) zoneSel.add(new Option(z, z));
  const modeSel = document.createElement('select');
  modeSel.add(new Option('placed objects (from exe)', 'scene')); modeSel.add(new Option('mesh grid (all .msh)', 'grid'));
  const lod0 = Object.assign(document.createElement('input'), { type: 'checkbox', checked: false });
  const chk = (v: boolean) => Object.assign(document.createElement('input'), { type: 'checkbox', checked: v });
  const gameLook = chk(params.get('game') !== '0');   // the game's projection (fov, range), fog, lighting, sky / sea placement
  const mips = chk(params.get('mips') === '1');       // the game has no mip maps
  const distRange = Object.assign(document.createElement('input'), { type: 'range', min: '0', max: '100', value: params.get('slider') ?? '50' }); // options slider: far = lerp(farMax, farMin, v / 100)
  const cullSel = document.createElement('select');
  cullSel.add(new Option('cull back (CW front)', 'cw')); cullSel.add(new Option('cull back (CCW front)', 'ccw')); cullSel.add(new Option('no culling', 'none'));
  const status = document.createElement('div'); status.className = 'v-status';
  const infoBox = document.createElement('div'); infoBox.className = 'v-info';
  const row = (label: string, el: HTMLElement) => { const d = document.createElement('div'); d.append(label + ' ', el); return d; };
  hud.append(row('zone', zoneSel), row('view', modeSel), row('game look', gameLook), row('draw distance', distRange), row('mip maps', mips), row('force LOD0', lod0), row('winding', cullSel), status, infoBox);
  const help = document.createElement('div');
  help.textContent = 'WASD move, Q/E down/up, Shift fast, drag = look, wheel = speed, click = select, H = hide UI';
  help.style.opacity = '.6'; hud.append(help);
  const search = document.createElement('input'); search.placeholder = 'filter objects…';
  const items = document.createElement('div'); items.className = 'v-items';
  listBox.append(search, items);

  zoneSel.value = ZONES.includes(params.get('zone') ?? '') || OTHER_ARCHIVES.includes(params.get('zone') ?? '') ? params.get('zone')! : 'z02LGI';
  modeSel.value = params.get('mode') === 'grid' ? 'grid' : 'scene';
  cullSel.value = params.get('cull') ?? 'cw';

  // ---- state
  let archive: Archive | null = null;
  let scene: ZoneScene | null = null;
  let objs: Obj[] = [];
  let selected = -1;
  const cam = { pos: [0, 100, -300], yaw: 0, pitch: -0.3, speed: 60 };
  let loadToken = 0;
  /** per-zone render parameters read from the executable (fog / range, sea level) and the zone's lights */
  let zoneFog: import('../formats/zoneparams.ts').ZoneRenderParams | null = null;
  let lights = defaultLights();
  const sky = new SkyState(false), sea = new SeaState();
  let fovNow = DEFAULT_FOV;
  const setStatus = (s: string) => { status.textContent = s; };

  const basis = () => {
    const cy = Math.cos(cam.pitch), sy = Math.sin(cam.pitch);
    const f = [Math.sin(cam.yaw) * cy, sy, Math.cos(cam.yaw) * cy];
    const right = [Math.cos(cam.yaw), 0, -Math.sin(cam.yaw)];
    const up = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
    // up = f x right  (left-handed: x = up x z => y = z x x)
    return { f, right, up };
  };

  const meshMember = (path: string): { arch: string; member: string } => {
    const p = path.split('\\');
    return { arch: p[1], member: p.slice(2).join('/') };
  };

  // ---- skinned meshes: posed once on the CPU at the minifig bind pose (MFIG.blk clip 2 frame 0)
  const blks = new Map<string, Blk | null>();
  const getBlk = (name: string): Blk | null => {
    if (!archive) return null;
    const key = `${archive.name}/${name}`;
    if (!blks.has(key)) {
      const e = archive.find(`anim/${name}.blk`);
      let b: Blk | null = null;
      try { b = e ? parseBlk(archive.read(e)) : null; } catch (err) { console.warn('blk', name, err); }
      blks.set(key, b);
    }
    return blks.get(key)!;
  };
  const rigOf = (meshPath: string): string => {
    const base = meshPath.split('\\').pop()!.toUpperCase();
    if (base.startsWith('SWFT')) return 'SWFT';
    if (base.startsWith('RBB')) return 'RBBT';
    if (base.startsWith('PTER')) return 'PTER';
    return 'MFIG';
  };
  const posed = new WeakMap<MeshGpu, MeshGpu>();
  const poseMesh = (m: MeshGpu, meshPath: string): MeshGpu => {
    const hit = posed.get(m);
    if (hit) return hit;
    let res = m;
    if (m.msh.svwl) {
      const blk = getBlk(rigOf(meshPath));
      try {
        if (blk && blk.skeleton && blk.clips.length > 2) {
          const sv = parseSvwl(m.msh.svwl, m.msh.vertexCount);
          let maxBone = -1; for (const b of sv.bone) if (b > maxBone) maxBone = b;
          if (maxBone < blk.skeleton.boneCount && blk.clips[2].boneCount === blk.skeleton.boneCount) {
            const mats = sampleBlk(blk.skeleton, blk.clips[2], 0);
            res = renderer.uploadMesh({ ...m.msh, positions: skinPositions(m.msh.positions, sv, mats), normals: skinNormals(m.msh.normals, sv, mats, undefined, true) });
          }
        }
      } catch (err) { console.warn('skin', meshPath, err); }
    }
    posed.set(m, res);
    return res;
  };

  const partMesh = (part: Part): MeshGpu | null => {
    if (part.mesh !== undefined) return part.mesh;
    part.mesh = null;
    if (part.meshPath && archive) {
      const { arch, member } = meshMember(part.meshPath);
      if (arch.toLowerCase() !== archive.name.toLowerCase()) {
        void data.archive(arch).then(() => { part.mesh = undefined; }); // load other archive in the background, retry later
        return null;
      }
      const raw = renderer.mesh(archive, member);
      part.mesh = raw ? poseMesh(raw, part.meshPath) : null;
    }
    return part.mesh;
  };

  const texFor = (part: Part, g: number): TexGpu | null => {
    if (!archive) return null;
    const id = part.texList[g] ?? -1;
    return id < 0 ? null : renderer.texture(archive, id);
  };

  // ---- loading
  async function load() {
    const token = ++loadToken;
    const zone = zoneSel.value;
    objs = []; selected = -1; items.replaceChildren(); infoBox.textContent = '';
    renderer.clearCaches();
    setStatus(`loading ${zone}…`);
    try {
      archive = await data.archive(zone, (m) => token === loadToken && setStatus(m));
      if (token !== loadToken) return;
      scene = null;
      if (ZONES.includes(zone)) {
        setStatus('reading placement tables from the executable…');
        await new Promise((r) => setTimeout(r, 0));
        scene = await data.zoneScene(zone);
        zoneFog = extractRenderParams(await data.exe(), scene.builderAt);
      } else zoneFog = null;
      lights = defaultLights();
      const lgt = archive.find('lights/lights.lgt');
      if (lgt) { try { lights = lightSetFromLgt(parseLgt(archive.read(lgt))); } catch (e) { console.warn('lgt', e); } }
      sky.spin = zone === 'z02LGI'; sky.angle = 0; sea.anchor = null;
      if (token !== loadToken) return;
      buildObjects(modeSel.value === 'grid' ? scene : null);
      const warn = scene?.warnings.length ? `, ${scene.warnings.length} warnings` : '';
      setStatus(`${zone}: ${scene && modeSel.value === 'scene' ? `${scene.records.length} placed records, ${scene.models.length} models, ${scene.meshPaths.filter(Boolean).length} mesh slots${warn}` : `${objs.length} meshes (grid)`}`);
      fillList();
      home();
    } catch (e) {
      console.error(e);
      setStatus(`error: ${e instanceof Error ? e.message : e}`);
    }
  }

  function buildObjects(gridScene: ZoneScene | null = null) {
    objs = [];
    if (!archive) return;
    if (scene && modeSel.value === 'scene') {
      const sc = scene;
      const seenSpecial = new Set<string>();
      for (const r of sc.records) {
        if (!r.model) continue;
        const parts: Part[] = [];
        for (const p of r.model.parts) {
          if (!p) continue;
          parts.push({ meshPath: sc.meshPaths[p.mesh] ?? null, texList: sc.texLists[p.texList] ?? [], lod: p.lod });
        }
        if (!parts.length) continue;
        const m0 = partMesh(parts[0]);
        const attach: Attach[] = [];
        const mkParts = (m: Model): Part[] => m.parts.filter(Boolean).map((p) => ({ meshPath: sc.meshPaths[p.mesh] ?? null, texList: sc.texLists[p.texList] ?? [], lod: p.lod }));
        for (const at of r.model.attach) if (at) attach.push({ bone: at.bone, parts: mkParts(at.child) });
        let bones: Float32Array | undefined;
        if (attach.length && parts[0].meshPath) {
          const blk = getBlk(rigOf(parts[0].meshPath));
          if (blk && blk.skeleton && blk.clips.length > 2 && blk.clips[2].boneCount === blk.skeleton.boneCount) {
            const col = sampleBlk(blk.skeleton, blk.clips[2], 0);
            bones = col; // sampleBlk's column-vector/column-major layout is byte-identical to our row-vector/row-major convention
          }
        }
        // SSKY / SSEA are unit shapes that the game re-places every frame (src/render/environment.ts); SSKY, SSEA, SEAB, SEAE get fixed draw modes
        // (only the first record of each name: z38PAR reuses SEAB for a palm tree, z20DSP has two SSKY records of which only the first has the sky behaviour)
        const special = ['SEAB', 'SSEA', 'SEAE', 'SSKY'].includes(r.name) && !seenSpecial.has(r.name);
        if (special) seenSpecial.add(r.name);
        const kind = special && r.name === 'SSKY' ? 'sky' : special && r.name === 'SSEA' ? 'sea' : undefined;
        const mode = !special ? 0 : r.name === 'SSKY' ? SKY_MODE : r.name === 'SSEA' ? SEA_MODE : r.name === 'SEAB' ? SEABED_MODE : SEA_EDGE_MODE;
        const matrix = r.matrix;
        const c = m0 ? transformPoint(r.matrix, m0.center) : [r.pos[0], r.pos[1], r.pos[2]];
        const sc3 = Math.max(Math.abs(r.scale[0]), Math.abs(r.scale[1]), Math.abs(r.scale[2]));
        objs.push({
          label: `${r.index} ${r.name} ${parts[0].meshPath?.split('\\').pop() ?? '?'}`,
          matrix, parts, attach: attach.length && bones ? attach : undefined, bones, center: c, radius: (m0?.radius ?? 5) * sc3, sky: !!kind, kind, mode,
          info: `record ${r.index} "${r.name}" model ${r.model.array}:${r.model.index}\npos ${r.pos.map((x) => x.toFixed(2)).join(', ')}\nrot ${r.rot.map((x) => x.toFixed(3)).join(', ')} scale ${r.scale.map((x) => x.toFixed(2)).join(', ')}\ncol ${r.col >= 0 ? sc.colPaths[r.col] : '-'}\n` +
            parts.map((p, i) => `LOD${i} @${p.lod}: ${p.meshPath?.split('\\').pop()} tex[${p.texList.join(',')}]`).join('\n'),
        });
      }
    } else {
      // grid of every mesh in the archive; meshes used by the zone's models get that model's texture list
      const texOfMesh = new Map<string, number[]>();
      if (gridScene) {
        for (const m of gridScene.models) for (const p of m.parts) {
          if (!p) continue;
          const mp = gridScene.meshPaths[p.mesh]; const tl = gridScene.texLists[p.texList];
          if (mp && tl && !texOfMesh.has(mp.split('\\').slice(2).join('/').toLowerCase())) texOfMesh.set(mp.split('\\').slice(2).join('/').toLowerCase(), tl);
        }
      }
      const members = archive.entries.filter((e) => /\.msh$/i.test(e.path)).sort((a, b) => a.path.localeCompare(b.path));
      // every mesh is scaled to a bounding radius of 5 and put on a square grid with 14 units spacing (originals keep their size in the scene view)
      const meshes = members.map((e) => ({ e, m: renderer.mesh(archive!, e.path) })).filter((q) => q.m);
      const cols = Math.max(1, Math.ceil(Math.sqrt(meshes.length)));
      meshes.forEach(({ e, m }, n) => {
        const mm = m!;
        const sc = 5 / Math.max(mm.radius, 1e-3);
        const mat = new Float32Array(16); mat[0] = mat[5] = mat[10] = sc; mat[15] = 1;
        mat[12] = (n % cols) * 14 - mm.center[0] * sc; mat[13] = -mm.min[1] * sc; mat[14] = Math.floor(n / cols) * 14 - mm.center[2] * sc;
        objs.push({ label: e.path.replace(/^meshes\//i, ''), matrix: mat, parts: [{ meshPath: null, texList: texOfMesh.get(e.path.toLowerCase()) ?? [], lod: 0, mesh: mm }], center: transformPoint(mat, mm.center), radius: 5, info: `${e.fullPath}\n${mm.msh.vertexCount} vertices, ${mm.triangles} triangles, ${mm.msh.groups.length} groups${mm.msh.svwl ? ', skinned (SVWL)' : ''}\nbounds ${mm.min.map((v) => v.toFixed(1))} .. ${mm.max.map((v) => v.toFixed(1))} (shown scaled x${sc.toFixed(3)})` });
      });
    }
  }

  function fillList() {
    items.replaceChildren();
    const q = search.value.toLowerCase();
    objs.forEach((o, i) => {
      if (q && !o.label.toLowerCase().includes(q)) return;
      const d = document.createElement('div');
      d.textContent = o.label; d.title = o.label;
      if (i === selected) d.className = 'sel';
      d.onclick = () => select(i, true);
      items.appendChild(d);
    });
  }
  search.oninput = fillList;

  function select(i: number, fly: boolean) {
    selected = i;
    infoBox.textContent = i >= 0 ? objs[i].info : '';
    if (i >= 0 && fly) {
      const o = objs[i];
      const { f } = basis();
      const d = Math.max(o.radius * 2.2, 6);
      cam.pos = [o.center[0] - f[0] * d, o.center[1] - f[1] * d, o.center[2] - f[2] * d];
    }
    fillList();
  }

  function home() {
    if (!objs.length) return;
    if (modeSel.value === 'grid') { const w = Math.ceil(Math.sqrt(objs.length)) * 14; cam.pos = [w / 2, w * 0.55, -w * 0.15]; cam.yaw = 0; cam.pitch = -1.2; cam.speed = w / 6; return; }
    // frame the bulk of the scene: median centre, 85th percentile distance (outliers such as far-away butterflies are ignored)
    const real = objs.filter((o) => !o.sky && o.radius < 3000);
    const med = (k: number) => { const v = real.map((o) => o.center[k]).sort((x, y) => x - y); return v[Math.floor(v.length / 2)] ?? 0; };
    const cx = med(0), cy = med(1), cz = med(2);
    const dist = real.map((o) => Math.hypot(o.center[0] - cx, o.center[2] - cz)).sort((x, y) => x - y);
    const ext = Math.max((dist[Math.floor(dist.length * 0.85)] ?? 20) * 2, 20);
    // with the game's draw distance (far plane) the overview has to stay inside it
    const farNow = gameLook.checked && zoneFog?.fog[0] ? cameraFromFog(zoneFog.fog[0], +distRange.value).far : Infinity;
    const back = Math.min(ext * 0.6, farNow * 0.3), up = Math.min(ext * 0.45, farNow * 0.1);
    cam.pos = [cx, cy + up, cz - back];
    cam.yaw = 0; cam.pitch = -0.2; cam.speed = ext / 6;
  }

  // ---- input
  const keys = new Set<string>();
  addEventListener('keydown', (e) => { if ((e.target as HTMLElement)?.tagName === 'INPUT' && (e.target as HTMLInputElement).type === 'text') return; keys.add(e.code); if (e.code === 'KeyH') wrap.classList.toggle('v-hide'); if (e.code === 'KeyR') home(); });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  let drag: { x: number; y: number; moved: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    cam.yaw += dx * 0.004; cam.pitch = Math.max(-1.55, Math.min(1.55, cam.pitch - dy * 0.004));
  });
  canvas.addEventListener('pointerup', (e) => { if (drag && drag.moved < 4) pick(e.clientX, e.clientY); drag = null; });
  canvas.addEventListener('wheel', (e) => { cam.speed *= e.deltaY < 0 ? 1.25 : 0.8; e.preventDefault(); }, { passive: false });

  function pick(px: number, py: number) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((px - rect.left) / rect.width) * 2 - 1, ny = 1 - ((py - rect.top) / rect.height) * 2;
    const { f, right, up } = basis();
    const th = Math.tan(fovNow / 2), asp = rect.width / rect.height;
    const d = [f[0] + right[0] * nx * th * asp + up[0] * ny * th, f[1] + right[1] * nx * th * asp + up[1] * ny * th, f[2] + right[2] * nx * th * asp + up[2] * ny * th];
    const dl = Math.hypot(d[0], d[1], d[2]); d[0] /= dl; d[1] /= dl; d[2] /= dl;
    let best = -1, bestT = Infinity;
    objs.forEach((o, i) => {
      if (o.sky) return;
      const oc = [o.center[0] - cam.pos[0], o.center[1] - cam.pos[1], o.center[2] - cam.pos[2]];
      const t = oc[0] * d[0] + oc[1] * d[1] + oc[2] * d[2];
      if (t < 0) return;
      const d2 = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - t * t;
      if (d2 <= o.radius * o.radius && t < bestT) { bestT = t; best = i; }
    });
    select(best, false);
  }

  let last = performance.now(), fpsT = 0, frames = 0, fps = 0;
  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
    const { f, right } = basis();
    const sp = cam.speed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1) * dt;
    const mv = (v: number[], s: number) => { cam.pos[0] += v[0] * s; cam.pos[1] += v[1] * s; cam.pos[2] += v[2] * s; };
    if (keys.has('KeyW')) mv(f, sp); if (keys.has('KeyS')) mv(f, -sp);
    if (keys.has('KeyD')) mv(right, sp); if (keys.has('KeyA')) mv(right, -sp);
    if (keys.has('KeyE') || keys.has('Space')) cam.pos[1] += sp; if (keys.has('KeyQ')) cam.pos[1] -= sp;

    // the game's camera range and fog (zone SetupFog call + the draw-distance slider); a plain free camera otherwise
    const game = gameLook.checked && scene && modeSel.value === 'scene' && zoneFog?.fog[0] ? cameraFromFog(zoneFog.fog[0], +distRange.value) : null;
    const camSetup: CameraSetup = game ?? { fov: (60 * Math.PI) / 180, near: 0.5, far: 12000, fog: { enabled: false, color: [0.45, 0.62, 0.85], start: 0, end: 1e6 }, clear: [0.45, 0.62, 0.85] };
    fovNow = camSetup.fov;
    renderer.setMipmaps(mips.checked);
    renderer.updateTextures(dt); sky.update(dt); sea.update(dt);
    renderer.cull = cullSel.value === 'none' ? 0 : 1;
    renderer.cwFront = cullSel.value !== 'ccw';
    renderer.fog = camSetup.fog;
    renderer.lights = game ? lights : defaultLights();
    const aspect = canvas.width / canvas.height;
    const view = lookDirLH(cam.pos, f);
    const viewProj = mul(view, projection(camSetup, aspect));
    renderer.begin(camSetup.clear, viewProj);
    const range = game ? Math.min(camSetup.far, camSetup.fog.enabled ? camSetup.fog.end : camSetup.far) : 3000;
    const seaLevel = zoneFog?.seaLevel ?? 0;
    // objects are drawn in record order, each with its three group passes (the game's order: SEAB, SSEA, SEAE, SSKY, LAND, ...)
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      const mx = o.matrix[12], my = o.matrix[13], mz = o.matrix[14];
      const dist = Math.hypot(mx - cam.pos[0], my - cam.pos[1], mz - cam.pos[2]);
      const cdist = Math.hypot(o.center[0] - cam.pos[0], o.center[1] - cam.pos[1], o.center[2] - cam.pos[2]);
      if (!o.sky && cdist - o.radius > (game ? camSetup.far * 1.5 : 6000)) continue;
      // LOD: distance from the camera to the record's world position (FUN_00443f90)
      const pi = lod0.checked ? 0 : selectLod(o.parts, dist, 1);
      let part = o.parts[pi], m = partMesh(part);
      if (!m) { for (const q of o.parts) { const mm = partMesh(q); if (mm) { part = q; m = mm; break; } } }
      if (!m) continue;
      let world = o.matrix;
      if (o.kind === 'sky') world = sky.matrix(cam.pos, range, o.matrix[13]);
      else if (o.kind === 'sea') world = sea.matrix(cam.pos, range, seaLevel);
      renderer.drawMesh(m, world, (g) => texFor(part, g), { mode: o.mode, highlight: i === selected, flat: modeSel.value === 'scene' ? null : [0.5 + 0.5 * Math.sin(i), 0.5 + 0.5 * Math.sin(i * 1.7 + 1), 0.6] });
      if (o.attach && o.bones) {
        for (const at of o.attach) {
          let cp = at.parts[0];
          if (!lod0.checked) cp = at.parts[selectLod(at.parts, dist, 1)] ?? cp;
          const cm = cp && partMesh(cp);
          if (!cm) continue;
          const bm = o.bones.subarray(at.bone * 16, at.bone * 16 + 16);
          if (bm.length < 16) continue;
          renderer.drawMesh(cm, mul(bm, world), (g) => texFor(cp, g), { highlight: i === selected });
        }
      }
    }
    if (selected >= 0) {
      const o = objs[selected];
      const m = partMesh(o.parts[0]);
      if (m) renderer.drawBox(o.matrix, m.min, m.max);
    }
    const hudLine = `fps ${fps.toFixed(0)}  draws ${renderer.stats.draws}  tris ${(renderer.stats.triangles / 1000).toFixed(0)}k  cam ${cam.pos.map((x) => x.toFixed(0))} yaw ${cam.yaw.toFixed(2)} pitch ${cam.pitch.toFixed(2)}${game ? `  far ${camSetup.far.toFixed(0)} fog ${camSetup.fog.start.toFixed(0)}..${camSetup.fog.end.toFixed(0)}` : ''}`;
    canvas.dataset.hud = hudLine;
    requestAnimationFrame(frame);
  }

  zoneSel.onchange = () => { const u = new URL(location.href); u.searchParams.set('zone', zoneSel.value); history.replaceState(null, '', u); void load(); };
  modeSel.onchange = () => void load();

  // debug / test hooks (used by tools/browse.mjs steps)
  (window as unknown as Record<string, unknown>).__viewer = {
    setCamera(x: number, y: number, z: number, yaw: number, pitch: number) { cam.pos = [x, y, z]; cam.yaw = yaw; cam.pitch = pitch; },
    select: (i: number) => select(i, true),
    selectByName(name: string) { const i = objs.findIndex((o) => o.label.includes(name)); if (i >= 0) select(i, true); return i; },
    /** place the camera around an object (by label substring): distance in object radii, yaw/pitch of the view direction */
    view(name: string, dist = 3, yaw = 0.6, pitch = -0.4) {
      const i = objs.findIndex((o) => o.label.includes(name));
      if (i < 0) return -1;
      selected = i; infoBox.textContent = objs[i].info; fillList();
      cam.yaw = yaw; cam.pitch = pitch;
      const { f } = basis(); const o = objs[i], d = Math.max(o.radius * dist, 4);
      cam.pos = [o.center[0] - f[0] * d, o.center[1] - f[1] * d, o.center[2] - f[2] * d];
      return i;
    },
    home,
    load,
    get ready() { return objs.length > 0; },
    get info() { return { objects: objs.length, scene: !!scene, hud: canvas.dataset.hud, status: status.textContent }; },
    objs: () => objs.map((o) => ({ label: o.label, center: o.center, radius: o.radius })),
    hide: () => wrap.classList.add('v-hide'),
    renderer,
  };
  requestAnimationFrame(frame);
  await load();
}
