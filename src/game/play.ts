// Dev entry of the playable engine: ?play=1&zone=z02LGI|z03PPH[&pos=x,y,z][&from=z03PPH][&era=N][&mute=1] (docs/engine-api.md "Game engine").
// Loads the zone, runs the fixed 60 Hz simulation (src/game, one step per drawn frame, `World.advanceDt`) and draws it with GameRenderer; a small HUD (H toggles) and window.__game for scripts.
import { Renderer, lightSetFromLgt } from '../render/index.ts';
import { extractRenderParams } from '../formats/zoneparams.ts';
import { GameData } from '../viewer/data.ts';
import type { FileSource } from '../viewer/data.ts';
import { audio } from '../engine/audio.ts';
import { GameLoop } from './world.ts';
import { PROFILES, setupZone } from './setup.ts';
import type { Loaded } from './setup.ts';
import { InputMapper, readKeyTable } from './input.ts';
import { V } from './vars.ts';
import { GameRenderer } from './render.ts';
import { parseLgt } from '../formats/lights.ts';
import { walkSounds, landSound } from '../audio/footsteps.ts';

type Files = FileSource & { read(path: string): Promise<Uint8Array> };

/** sound table ids the walk / jump / camera code plays (docs/engine-api.md Audio); loaded at start so the first play is not dropped */
const PRELOAD_IDS = [302, 261, 301, 895, 296, 294, 295];

const CSS = `
.g-root{position:fixed;inset:0;background:#111;font:12px/1.35 ui-monospace,Menlo,monospace;color:#ddd;overflow:hidden}
.g-root canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.g-hud{position:absolute;left:8px;top:8px;background:rgba(0,0,0,.55);padding:6px 9px;border-radius:6px;white-space:pre;pointer-events:none;z-index:2}
.g-hud .help{opacity:.7;margin-top:4px}
.g-hide .g-hud{display:none}
`;

export async function startPlay(root: HTMLElement, files: Files, params: URLSearchParams): Promise<void> {
  const zone = PROFILES[params.get('zone') ?? ''] ? params.get('zone')! : 'z02LGI';
  const profile = PROFILES[zone];
  const mute = params.get('mute') === '1';
  const era = params.has('era') ? Number(params.get('era')) : 0;
  const posParam = params.get('pos')?.split(',').map(Number);
  const pos = posParam && posParam.length === 3 && posParam.every(Number.isFinite) ? (posParam as [number, number, number]) : undefined;

  root.replaceChildren();
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.className = 'g-root';
  const canvas = document.createElement('canvas');
  const hud = document.createElement('div');
  hud.className = 'g-hud';
  wrap.append(canvas, hud);
  root.appendChild(wrap);
  const g = ((window as unknown as { __game?: Record<string, unknown> }).__game = { ready: false, era, zone } as Record<string, unknown>);
  const HELP = 'Pijltjes/WASD lopen, Alt springen, Z/X/C camera, H verbergt dit';
  hud.textContent = `${zone}: laden...`;

  try {
    const data = new GameData(files);
    let renderer: Renderer;
    try { renderer = new Renderer(canvas); } catch (e) { hud.textContent = `WebGL2 niet beschikbaar: ${e}`; return; }
    const [archive, pe] = await Promise.all([data.archive(zone, (m) => { hud.textContent = `${zone}: ${m}`; }), data.exe()]);
    hud.textContent = `${zone}: zone lezen...`;
    await new Promise((r) => setTimeout(r, 0));
    const scene = await data.zoneScene(zone);
    const fog = extractRenderParams(pe, scene.builderAt);
    let lights = null;
    const lgt = archive.find('lights/lights.lgt');
    if (lgt) { try { lights = lightSetFromLgt(parseLgt(archive.read(lgt))); } catch (e) { console.warn('lgt', e); } }
    let shadow = null;
    try { shadow = await data.archive('Shadow'); } catch (e) { console.warn('Shadow archive', e); }

    hud.textContent = `${zone}: wereld opbouwen...`;
    await new Promise((r) => setTimeout(r, 0));
    const loaded: Loaded = setupZone(scene, archive, profile, { pos, from: params.get('from') ?? '' });
    const world = loaded.world;
    world.vars.loadNames(pe);
    world.input = new InputMapper(readKeyTable(pe));
    world.input.attach(window);
    // the game window: blur is handled by the mapper; H toggles the HUD
    addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !e.repeat) wrap.classList.toggle('g-hide'); });

    const sfx = await setupAudio(files, world, zone, mute);

    const gr = new GameRenderer(renderer, data, archive, scene, loaded, fog, lights, shadow);
    let fps = 0;
    const loop = new GameLoop(world, (alpha, dt) => {
      gr.render(alpha, dt);
      if (!g.ready) g.ready = true;
    });

    const state = () => {
      const p = loaded.pepper, a = p.anim;
      return {
        tick: world.tickCount, pos: [p.x, p.y, p.z], yaw: p.ry, walkState: loaded.walk.state, clip: a?.clip ?? -1, frame: a?.frame ?? 0,
        speed: loaded.walk.speed, mode: world.vars.get(V.PEPPER_CONTROL), cam: Array.from(world.camera.c.subarray(0, 6)), fps: loop.fps, lastSurface: world.pep.lastSurface,
      };
    };
    Object.assign(g, {
      world, loaded, loop, renderer: gr, gl: renderer, sfx,
      setPepper(x: number, y: number, z: number, yaw?: number) {
        const p = loaded.pepper;
        p.x = x; p.y = y; p.z = z;
        if (yaw !== undefined) p.ry = yaw;
        p.rebuildYaw();
        p.prev.set(p.m);
        world.camera.init(p);
      },
      state,
    });

    // HUD
    const hex = (n: number) => '0x' + (n >>> 0).toString(16);
    const f = (n: number) => n.toFixed(1);
    setInterval(() => {
      if (wrap.classList.contains('g-hide')) return;
      fps = loop.fps;
      const s = state();
      hud.replaceChildren();
      const info = document.createElement('div');
      info.textContent = [
        `fps ${fps.toFixed(0)}  ${zone}  tick ${s.tick}`,
        `Pepper ${s.pos.map(f).join(', ')}  yaw ${f(s.yaw)}`,
        `toestand ${hex(s.walkState)}  clip ${s.clip} frame ${f(s.frame)}  snelheid ${s.speed.toFixed(2)}`,
        `camera afstand ${f(gr.info.camDist)}  ondergrond ${s.lastSurface}  draws ${gr.info.draws}`,
      ].join('\n');
      const help = document.createElement('div');
      help.className = 'help';
      help.textContent = HELP;
      hud.append(info, help);
    }, 250);

    loop.start();
  } catch (e) {
    console.error(e);
    hud.textContent = `${zone}: fout: ${e instanceof Error ? e.message : e}`;
    (g as Record<string, unknown>).error = String(e);
  }
}

/** world.sfx sink: the first play of an id loads it (and is dropped), later plays start the slot. Everything fails silently. */
async function setupAudio(files: Files, world: import('./world.ts').World, zone: string, mute: boolean): Promise<string> {
  if (mute) return 'mute';
  try {
    const { GameAudio } = await import('../audio/index.ts');
    const ga = await GameAudio.create(audio.ctx, audio.master, files as never);
    type Slot = Awaited<ReturnType<typeof ga.sfx.load2D>>;
    const slots = new Map<number, Slot | null | 'loading'>();
    const load = (id: number) => {
      if (slots.has(id)) return;
      slots.set(id, 'loading');
      ga.sfx.load2D(id).then((s) => slots.set(id, s)).catch(() => slots.set(id, null));
    };
    world.sfx = {
      play(id: number) {
        try {
          const s = slots.get(id);
          if (s === undefined) load(id);
          else if (s && s !== 'loading') ga.sfx.play2D(s);
        } catch { /* silent */ }
      },
    };
    const ids = new Set<number>(PRELOAD_IDS);
    for (let surface = 0; surface <= 10; surface++) {
      for (const i of walkSounds(surface) ?? []) ids.add(i);
      const l = landSound(surface);
      if (l !== null) ids.add(l);
    }
    for (const id of ids) load(id);
    const unlock = () => { void audio.unlock().catch(() => { /* ignore */ }); };
    addEventListener('keydown', unlock, { once: true });
    addEventListener('pointerdown', unlock, { once: true });
    if (zone === 'z02LGI') {
      ga.music.load('Z02LGIM').then((h) => { if (h) ga.music.play(h); }).catch(() => { /* ignore */ });
      ga.ambience.start('LGIBirds').catch(() => { /* ignore */ });
    }
    return 'on';
  } catch (e) {
    console.warn('audio disabled', e);
    return 'failed';
  }
}
