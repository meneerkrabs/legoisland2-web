// Contact sheets of the vehicle shots (docs/re/lego3d.md section 17), composed in the headless page (muted, through the bot slot): a steps file for tools/browse.mjs.
//   SHEETS=/tmp/x/sheets.json  sh tools/m5-botslot.sh node tools/browse.mjs http://localhost:PORT/ tools/lego3d/vehicles-sheet.mjs --size 1600x1200 --out DIR
//   sheets.json: [{ out: 'name', cols: 5, cell: [400, 300], title: '...', items: [{ file: '/abs/a.png', label: 'front, off' }, ...] }]  (PNG written as DIR/name.png)
import fs from 'node:fs';
export default async ({ page, evaluate, shot, log }) => {
  const sheets = JSON.parse(fs.readFileSync(process.env.SHEETS, 'utf8'));
  for (const s of sheets) {
    const [cw, ch] = s.cell ?? [400, 300], cols = s.cols ?? 5, pad = 22, rows = Math.ceil(s.items.length / cols), W = cols * cw, H = rows * (ch + pad) + 26;
    const imgs = s.items.map((it) => (fs.existsSync(it.file) ? 'data:image/png;base64,' + fs.readFileSync(it.file).toString('base64') : null));
    await page.setViewportSize({ width: W, height: H });
    await page.setContent(`<body style="margin:0;background:#222"><canvas id=c width=${W} height=${H}></canvas></body>`);
    await evaluate(async ({ s, imgs, cw, ch, cols, pad, W, H }) => {
      const c = document.getElementById('c'), x = c.getContext('2d');
      x.fillStyle = '#222'; x.fillRect(0, 0, W, H); x.fillStyle = '#fff'; x.font = 'bold 15px sans-serif'; x.fillText(s.title ?? s.out, 6, 17);
      for (let i = 0; i < s.items.length; i++) {
        const ox = (i % cols) * cw, oy = 26 + Math.floor(i / cols) * (ch + pad);
        x.fillStyle = '#ddd'; x.font = '12px sans-serif'; x.fillText(s.items[i].label, ox + 4, oy + 14);
        if (!imgs[i]) { x.fillStyle = '#a33'; x.fillText('(missing)', ox + 4, oy + 40); continue; }
        const im = new Image(); im.src = imgs[i]; await im.decode();
        x.drawImage(im, ox, oy + pad - 6, cw - 2, ch - 2);
      }
    }, { s, imgs, cw, ch, cols, pad, W, H });
    await shot(s.out); log('sheet', s.out, s.items.length);
  }
};
