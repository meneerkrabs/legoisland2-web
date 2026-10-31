# Blender -b -P montage.py -- out.png cols in1.png in2.png ...   (tiles images, each scaled to the height of the first, for before/after comparisons)
import bpy, sys
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
out, cols, files = argv[0], int(argv[1]), argv[2:]
imgs = []
for f in files:
    im = bpy.data.images.load(f)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
    imgs.append(a)
th = imgs[0].shape[0]
tiles = []
for a in imgs:
    h, w, _ = a.shape
    if h != th:
        ys = (np.arange(th) * h / th).astype(int); xs = (np.arange(int(w * th / h)) * h / th).astype(int)
        a = a[ys][:, xs]
    tiles.append(a)
rows = []
for r in range(0, len(tiles), cols):
    row = tiles[r:r + cols]
    rows.append(np.concatenate(row, axis=1))
W = max(r.shape[1] for r in rows)
rows = [np.pad(r, ((0, 0), (0, W - r.shape[1]), (0, 0)), constant_values=1) for r in rows]
res = np.concatenate(rows[::-1], axis=0)  # pixels are bottom-up: the first row of files must come last
out_img = bpy.data.images.new('m', width=res.shape[1], height=res.shape[0], alpha=True)
out_img.pixels = np.ascontiguousarray(res).ravel()
out_img.filepath_raw = out; out_img.file_format = 'PNG'; out_img.save()
