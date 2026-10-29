// The look of the developer corner: a clean overlay panel (not the game's 2D layer: lists of hundreds of rows, search boxes and number fields need real text input). Dutch UI.
export const CSS = `
.dc-badge-hint{position:absolute;left:8px;bottom:8px;z-index:40;font:11px/1.3 ui-monospace,Menlo,monospace;color:#ffd400;background:rgba(10,18,44,.72);padding:3px 7px;border-radius:4px;pointer-events:none;white-space:pre}
.dc-root{position:absolute;inset:0;z-index:60;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.35);font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8ecf8}
.dc-root.open{display:flex}
.dc-root.side{justify-content:flex-end;background:transparent;pointer-events:none}
.dc-root.side .dc-panel{pointer-events:auto;width:min(520px,60vw);height:100%;max-height:none;border-radius:0}
.dc-panel{display:flex;flex-direction:column;width:min(1180px,97vw);height:min(820px,95vh);background:#0d1630;border:2px solid #ffd400;border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.6);overflow:hidden}
.dc-head{display:flex;align-items:center;gap:14px;padding:7px 12px;background:#d01012;color:#fff;font-weight:700;letter-spacing:.3px}
.dc-head .dc-title{font-size:15px}
.dc-head .dc-where{font-weight:400;opacity:.9;font-size:12px}
.dc-head .dc-sp{flex:1}
.dc-head label{font-weight:400;font-size:12px}
.dc-main{display:flex;flex:1;min-height:0}
.dc-tabs{display:flex;flex-direction:column;width:190px;flex:none;background:#09112a;border-right:1px solid #2a3a6a;overflow-y:auto}
.dc-tab{all:unset;cursor:pointer;padding:8px 12px;border-bottom:1px solid #16224a;color:#b8c4ea;font-size:13px}
.dc-tab:hover{background:#15234f}
.dc-tab.on{background:#0055bf;color:#fff;font-weight:700;box-shadow:inset 4px 0 0 #ffd400}
.dc-tab .n{display:inline-block;width:1.6em;color:#ffd400;opacity:.8}
.dc-body{flex:1;min-width:0;display:flex;flex-direction:column}
.dc-section{flex:1;min-height:0;overflow:auto;padding:12px 16px}
.dc-section>h2{margin:0 0 2px;font-size:17px;color:#ffd400}
.dc-blurb{margin:0 0 10px;color:#9fb0e0}
.dc-foot{padding:5px 12px;background:#09112a;border-top:1px solid #2a3a6a;color:#9fb0e0;font-size:12px;display:flex;gap:16px}
.dc-foot b{color:#ffd400;font-weight:600}
.dc-foot .dc-msg{margin-left:auto;color:#7fe08a}
.dc-block{margin:0 0 14px;padding:8px 10px;border:1px solid #243566;border-radius:6px;background:#101c3d}
.dc-block h3{margin:0 0 6px;font-size:13px;color:#ffd400;text-transform:none}
.dc-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:4px 0}
.dc-btn{all:unset;cursor:pointer;padding:3px 10px;border-radius:4px;background:#0055bf;color:#fff;border:1px solid #3d7fe0;font-size:12px}
.dc-btn:hover{background:#1a6fe0}
.dc-btn:active{background:#003f8f}
.dc-btn.warn{background:#a4600a;border-color:#e0a040}
.dc-btn.red{background:#a00d0f;border-color:#e04044}
.dc-btn[disabled],.dc-btn.off{opacity:.45;cursor:default}
.dc-input,.dc-select,.dc-panel textarea{background:#08102a;color:#fff;border:1px solid #3a4c85;border-radius:4px;padding:3px 6px;font:12px ui-monospace,Menlo,monospace}
.dc-input.num{width:7em;text-align:right}
.dc-check{display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none}
.dc-note{margin:4px 0;color:#9fb0e0;font-size:12px}
.dc-table{border-collapse:collapse;width:100%;font:12px ui-monospace,Menlo,monospace}
.dc-table th{position:sticky;top:0;background:#16264f;color:#ffd400;text-align:left;padding:3px 6px;font-weight:600;z-index:1}
.dc-table td{padding:2px 6px;border-bottom:1px solid #1a2850;vertical-align:top}
.dc-table tr:hover td{background:#14224a}
.dc-table tr.sel td{background:#1d3a80}
.dc-table tr.dim td{opacity:.5}
.dc-table td.num{text-align:right}
.dc-badge{display:inline-block;padding:0 6px;border-radius:9px;font-size:11px;background:#3a4c85;color:#fff;margin-right:4px;white-space:nowrap}
.dc-badge.warn{background:#a4600a}.dc-badge.info{background:#0055bf}.dc-badge.ok{background:#1d7a34}.dc-badge.red{background:#a00d0f}
.dc-grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.dc-cell{background:#08102a;border:1px solid #243566;border-radius:6px;padding:4px;cursor:pointer;font-size:11px;overflow:hidden}
.dc-cell:hover{border-color:#ffd400}
.dc-cell canvas,.dc-cell img{display:block;width:100%;image-rendering:pixelated;background:#222}
.dc-two{display:flex;gap:12px;align-items:flex-start}
.dc-two>*{min-width:0}
.dc-mono{font-family:ui-monospace,Menlo,monospace}
.dc-key{display:inline-block;padding:0 5px;border:1px solid #6a7cb5;border-radius:3px;background:#16264f;font:11px ui-monospace,Menlo,monospace;color:#ffd400}
.dc-scroll{overflow:auto}
.dc-jb{position:sticky;top:-12px;z-index:3;background:#0d1630;padding:6px 0;border-bottom:1px solid #243566}
.dc-jb-state{font:12px ui-monospace,Menlo,monospace;color:#7fe08a}
.dc-jb-state[data-phase=error]{color:#ff8a80}.dc-jb-state[data-phase=idle]{color:#9fb0e0}
.dc-jb-prog{display:inline-block;width:160px;height:6px;background:#1a2850;border-radius:3px;overflow:hidden}
.dc-jb-prog i{display:block;height:100%;width:0;background:#ffd400}
.dc-jb-row.bad{color:#ff8a80;font-size:11px}
.dc-sub{display:flex;gap:4px;margin:2px 0 8px}
.dc-sub .dc-btn.on{background:#d01012;border-color:#ff6a6e}
.dc-tx{max-width:30em;min-width:14em;white-space:normal;word-break:break-word}
.dc-table td.num{white-space:nowrap}
`;
