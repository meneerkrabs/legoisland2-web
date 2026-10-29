// CSS of the two galleries (sections 6 and 7), injected once on first use (kept out of style.ts so the shared stylesheet stays untouched). Classes dg-*.
const CSS = `
.dg-row[hidden],.dg-cell[hidden],.dg-group[hidden]{display:none!important}
.dg-wrap{display:flex;gap:12px;align-items:flex-start}
.dg-left{flex:1 1 44%;min-width:0}
.dg-view{flex:0 0 min(520px,52%);position:sticky;top:0;min-width:0}
.dg-list{height:min(520px,58vh);overflow:auto;border:1px solid #243566;border-radius:6px;background:#08102a}
.dg-group>summary{cursor:pointer;padding:3px 8px;background:#16264f;color:#ffd400;position:sticky;top:0;z-index:1;font-weight:600;font-size:12px;list-style:none}
.dg-group>summary::before{content:'+ ';color:#9fb0e0}
.dg-group[open]>summary::before{content:'- '}
.dg-group>summary .n{color:#9fb0e0;font-weight:400;margin-left:6px}
.dg-sub{padding:2px 8px;color:#9fb0e0;font-size:11px;background:#0d1a3b;border-bottom:1px solid #14224a}
.dg-row{display:flex;gap:6px;align-items:center;padding:1px 8px 1px 14px;cursor:pointer;font:12px ui-monospace,Menlo,monospace;border-bottom:1px solid #14224a;white-space:nowrap}
.dg-row:hover{background:#14224a}
.dg-row.sel{background:#1d3a80}
.dg-row .nm{flex:1;overflow:hidden;text-overflow:ellipsis}
.dg-row .sz{color:#7f8fc0;font-size:11px}
.dg-canvas{width:100%;aspect-ratio:4/3;display:block;background:#12183a;border:1px solid #243566;border-radius:6px;outline:none;cursor:grab;touch-action:none}
.dg-canvas:focus{border-color:#ffd400}
.dg-info{margin-top:6px;font:12px/1.4 ui-monospace,Menlo,monospace;color:#c8d3f5;min-height:7.5em}
.dg-info b{color:#ffd400;font-weight:600}
.dg-sum{font:12px/1.5 ui-monospace,Menlo,monospace;color:#c8d3f5;margin:2px 0 8px}
.dg-sum .ok{color:#7fe08a}.dg-sum .diff{color:#ffb050}
.dg-block>summary{cursor:pointer;color:#ffd400;font-weight:600;padding:4px 0}
.dg-block{margin:0 0 12px;border:1px solid #243566;border-radius:6px;background:#101c3d;padding:2px 10px 8px}
.dg-gh{margin:8px 0 4px;color:#9fb0e0;font-size:12px}
.dg-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(132px,1fr))}
.dg-cell{background:#08102a;border:1px solid #243566;border-radius:6px;padding:4px;cursor:pointer;font-size:11px;overflow:hidden;min-height:150px}
.dg-cell:hover{border-color:#ffd400}
.dg-cell .th{width:100%;aspect-ratio:1;display:flex;align-items:center;justify-content:center;background-color:#2a2a2a;background-image:linear-gradient(45deg,#3a3a3a 25%,transparent 25%,transparent 75%,#3a3a3a 75%),linear-gradient(45deg,#3a3a3a 25%,transparent 25%,transparent 75%,#3a3a3a 75%);background-size:12px 12px;background-position:0 0,6px 6px;color:#778;font-size:10px}
.dg-cell canvas{display:block;max-width:100%;max-height:100%;image-rendering:pixelated}
.dg-cell .lb{margin-top:3px;line-height:1.25;word-break:break-all;color:#c8d3f5}
.dg-cell .lb i{color:#9fb0e0;font-style:normal;display:block}
.dg-zoom{position:absolute;inset:0;z-index:5;background:rgba(5,9,25,.94);display:flex;flex-direction:column;padding:10px 14px}
.dg-zoom .bar{display:flex;gap:10px;align-items:center;margin-bottom:8px;color:#c8d3f5;font:12px ui-monospace,Menlo,monospace}
.dg-zoom .pic{flex:1;overflow:auto;display:flex}
.dg-zoom canvas{margin:auto;image-rendering:pixelated;background-color:#2a2a2a;background-image:linear-gradient(45deg,#3a3a3a 25%,transparent 25%,transparent 75%,#3a3a3a 75%),linear-gradient(45deg,#3a3a3a 25%,transparent 25%,transparent 75%,#3a3a3a 75%);background-size:16px 16px;background-position:0 0,8px 8px}
`;
export function ensureGalleryStyle() {
  if (document.getElementById('dc-gallery-style')) return;
  const s = document.createElement('style');
  s.id = 'dc-gallery-style';
  s.textContent = CSS;
  document.head.append(s);
}
