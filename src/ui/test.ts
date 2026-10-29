// Headless test page of the 2D layer (dev server: /src/ui/test.html?scene=text|sprites|panel|fade&w=1280&h=800). Exposes window.__ui.
// Scenes are drawn with `Ui2D` on the context of a real `Renderer` (3D clear first, then ui.flush()), see tools/steps/ui-test.mjs.
import { Renderer } from '../render/renderer.ts';
import { GameData } from '../viewer/data.ts';
import { Ui2D } from './renderer2d.ts';
import type { UiTextureSet } from './renderer2d.ts';
import { loadMessages, loadMenuStrings, FRONTEND_FILES, IFC_FILES } from './strings.ts';
import type { MenuStrings, MessageTable } from './strings.ts';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = +(params.get('w') ?? 1280); canvas.height = +(params.get('h') ?? 800);
const status = document.getElementById('status')!;

interface Ctx { r: Renderer; ui: Ui2D; mo: UiTextureSet; hud: UiTextureSet; loading: UiTextureSet; back: UiTextureSet; frontend: MessageTable; ifc: MessageTable; menu: MenuStrings }
let ctx: Ctx;

const YELLOW = 0, WHITE = 1;
const ACCENT_UP = 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝ';
const ACCENT_LOW = ACCENT_UP.toLowerCase();
const PARAGRAPH = 'Welkom op LEGO eiland! Pepper bezorgt vandaag pizza\'s aan alle inwoners, maar de Brickster is weer op vrijwel iedere hoek van het eiland aan het rommelen met zijn gemene plannen.';

function scene(name: string) {
  const { r, ui, mo, hud, loading, back, frontend, ifc, menu } = ctx;
  const W = canvas.width, H = canvas.height;
  r.gl.viewport(0, 0, W, H);
  r.begin([0.25, 0.55, 0.75], new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  ui.begin(W, H);
  const v = ui.view;
  // 4:3 area marker
  ui.fillRect([0, 0, 640, 480], 0x40000000);
  if (name === 'text') {
    ui.text(1, 'Balloon24 (slot 1, 0.7): ' + menu.label('!FESTART') + ' / ' + menu.label('!FEOPTION'), 12, 40, { colour: YELLOW });
    ui.text(1, ACCENT_UP.slice(0, 14), 12, 70, { colour: WHITE });
    ui.text(1, ACCENT_UP.slice(14), 12, 100, { colour: WHITE });
    ui.text(1, ACCENT_LOW.slice(0, 14) + ' (folded)', 12, 130, { colour: 3 });
    ui.text(0, 'Balloon12 (slot 0): ' + frontend.text('FEQUIT') + ' ' + frontend.text('FECUTSCE') + ' ' + ifc.text('IFCBRIK01') + ' ' + ifc.text('IFCPOLB'), 12, 160, { colour: YELLOW });
    ui.text(0, ACCENT_UP, 12, 184, { colour: WHITE });
    ui.text(0, 'abcdefghijklmnopqrstuvwxyz 0123456789 (c)© \u009c ? ! , . : - \' "', 12, 208, { colour: WHITE });
    ui.text(0, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' + String.fromCharCode(0xa9, 0x9c), 12, 232, { colour: WHITE });
    for (let c = 0; c < 11; c++) ui.text(0, `colour ${c}`, 12 + (c % 4) * 150, 262 + Math.floor(c / 4) * 22, { colour: c });
    ui.text(0, 'raw ARGB 0xff40c0ff', 12 + 150, 262 + 2 * 22 + 22, { colour: 0xff40c0ff });
    ui.text(0, 'links x=630', 630, 340, { align: 'right', colour: WHITE });
    ui.text(0, 'gecentreerd x=320', 320, 360, { align: 'centre', colour: WHITE });
    ui.text(1, PARAGRAPH, 320, 392, { maxChars: 30, colour: YELLOW });
    ui.text(0, PARAGRAPH, 320, 400 + 100, { maxChars: 40, colour: WHITE });
  } else if (name === 'sprites') {
    const cols = 9, cw = 70, chh = 58;
    for (let i = 0; i < mo.length; i++) {
      const col = i % cols, row = Math.floor(i / cols), x = 8 + col * cw, y = 6 + row * chh;
      const s = mo.size(i);
      const k = Math.min(48 / s.w, 40 / s.h, 1.5);
      ui.sprite(mo, i, [x, y, x + s.w * k, y + s.h * k]);
      ui.text(0, String(i), x + 22, y + chh - 4, { colour: WHITE, shadow: false });
    }
  } else if (name === 'panel') {
    // yellow / green / red frame (variant 0 / 1 / 2): tile layout of menu/mOverlays (docs/re/ui-m2.md): edges 3 / 6 / 9 / 12, corners TL 15, TR 18, BL 21, BR 24, centre 27 (+ variant)
    const x0 = 160, y0 = 100, n = 8, m = 4;
    const grid = (vr: number) => [[15, 3, 18], [9, 27, 12], [21, 6, 24]].map((r) => r.map((t) => t + vr));
    for (let vr = 0; vr < 3; vr++) {
      const ox = x0 + vr * 6, oy = y0 + vr * 6;
      const g = grid(vr);
      const wc = [24, 24 * 3, 24], hc = [24, 24 * 2, 24];
      const xs = [ox, ox + 24, ox + 24 + wc[1]], ys = [oy, oy + 24, oy + 24 + hc[1]];
      if (vr === 0) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) ui.sprite(mo, g[row][col], [xs[col], ys[row], xs[col] + wc[col], ys[row] + hc[row]]);
    }
    void n; void m;
    ui.text(1, menu.label('!FEOPTION'), 320, y0 + 70, { colour: YELLOW, align: 'centre' });
    // all three variants as small panels (3x3 tiles of 24 px)
    for (let vr = 0; vr < 3; vr++) {
      const g = grid(vr), ox = 40 + vr * 200, oy = 300;
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) ui.sprite(mo, g[row][col], [ox + col * 48, oy + row * 48, ox + col * 48 + 48, oy + row * 48 + 48]);
    }
  } else if (name === 'tiles') {
    const a = +(params.get('from') ?? 3);
    for (let i = 0; i < 12; i++) { const x = 20 + (i % 6) * 100, y = 20 + Math.floor(i / 6) * 130; ui.sprite(mo, a + i, [x, y, x + 96, y + 96]); ui.text(0, String(a + i), x + 40, y + 120, { colour: WHITE }); }
  } else if (name === 'fade') {
    ui.sprite(mo, 2, [100, 100, 228, 228]);
    ui.text(1, 'fade 0.5 + letterbox 1', 320, 240, { align: 'centre', colour: YELLOW });
    for (let i = 0; i < 12; i++) ui.letterbox(1, 1);
    ui.fade(+(params.get('a') ?? 0.5));
    ui.text(0, 'tekst blijft boven de fade', 320, 300, { align: 'centre', colour: WHITE });
  } else if (name === 'card') {
    // the loading card of the fade overlay (FUN_0040d1be, loadingcard.ts): `?scene=card&a=<fade>&az=<angle about z>&ax=<angle about x>`; the first call of a Ui2D is the init branch (fade 0), so draw once to get past it
    ui.sprite(mo, 2, [100, 100, 228, 228]);
    ui.text(1, 'scene under the fade', 320, 200, { align: 'centre', colour: YELLOW });
    ui.cardState.angleZ = +(params.get('az') ?? 0.7); ui.cardState.angleX = +(params.get('ax') ?? 0.4);
    ui.fade(+(params.get('a') ?? 0));
  } else if (name === 'loading') {
    ui.spriteTex(back.get(0)!, [0, 0, 640, 480]);
    ui.sprite(hud, 0, [20, 20, 80, 80]);
    const s = loading.size(0);
    ui.text(1, frontend.text('LOADING'), 320, 400, { align: 'centre', colour: YELLOW });
    ui.text(0, `loading screen texture ${s.w}x${s.h}`, 12, 20, { colour: WHITE });
  }
  ui.flush();
  status.textContent = `${name} canvas ${W}x${H} view ${v.x},${v.y} ${v.w}x${v.h}`;
}

/** GL state before / after a flush with some non-default states set: returns the names of the states that changed (empty = restored). */
function checkState(): string[] {
  const { r, ui, mo } = ctx;
  const gl = r.gl;
  const white = gl.createTexture();
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, white); gl.activeTexture(gl.TEXTURE0);
  gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true); gl.colorMask(true, true, false, true);
  gl.blendFunc(gl.ONE, gl.ONE); gl.enable(gl.SCISSOR_TEST); gl.scissor(1, 2, 30, 40); gl.viewport(3, 4, 100, 50); gl.activeTexture(gl.TEXTURE2);
  const snap = () => ({
    depth: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE), blend: gl.isEnabled(gl.BLEND), scissor: gl.isEnabled(gl.SCISSOR_TEST), mask: gl.getParameter(gl.DEPTH_WRITEMASK), cmask: String(gl.getParameter(gl.COLOR_WRITEMASK)),
    src: gl.getParameter(gl.BLEND_SRC_RGB), dst: gl.getParameter(gl.BLEND_DST_RGB), vp: String(gl.getParameter(gl.VIEWPORT)), active: gl.getParameter(gl.ACTIVE_TEXTURE), prog: gl.getParameter(gl.CURRENT_PROGRAM),
    vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), abuf: gl.getParameter(gl.ARRAY_BUFFER_BINDING), tex: gl.getParameter(gl.TEXTURE_BINDING_2D), sc: String(gl.getParameter(gl.SCISSOR_BOX)),
  });
  const before = snap();
  ui.begin(canvas.width, canvas.height);
  ui.sprite(mo, 2, [10, 10, 60, 60]); ui.text(0, 'state', 100, 100); ui.fade(0.5); ui.letterbox(2, 1);
  ui.flush();
  const after = snap();
  const bad: string[] = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== after[k]);
  const err = gl.getError();
  if (err) bad.push(`GL error ${err}`);
  gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.colorMask(true, true, true, true); gl.disable(gl.SCISSOR_TEST); gl.activeTexture(gl.TEXTURE0);
  return bad;
}

async function main() {
  const data = new GameData('/data/le2/');
  const r = new Renderer(canvas);
  const ui = new Ui2D(r.gl);
  const [fonts, menuArc, overlays, generic, messages] = await Promise.all([data.archive('Fonts'), data.archive('menu'), data.archive('Overlays'), data.archive('GENERICBITS'), data.archive('messages')]);
  ui.loadFonts(fonts);
  const mo = ui.loadSet(menuArc, 'mOverlays');
  const loading = ui.loadSet(menuArc, 'loading');
  const hud = ui.loadSet(overlays, 'HUDFX');
  const back = ui.loadImage(generic, 'Backdrop/loadingscreen.tga');
  const frontend = loadMessages(messages, FRONTEND_FILES), ifc = loadMessages(messages, IFC_FILES);
  ctx = { r, ui, mo, hud, loading, back, frontend, ifc, menu: loadMenuStrings(messages) };
  // the loading card (the same assets as Shell.create)
  ui.card = { pizza: ui.loadImage(generic, 'Backdrop/Pizza.tga').get(0)!, cd: ui.loadImage(generic, 'Backdrop/CD.tga').get(0)!, text: frontend.text('LOADING') };
  ui.cardState.frame(640, 480, 0);   // the init branch (first call) is used up
  (window as unknown as { __ui: unknown }).__ui = { ...ctx, scene, checkState, ready: true };
  scene(params.get('scene') ?? 'text');
}
main().catch((e) => { status.textContent = String(e); console.error(e); });
