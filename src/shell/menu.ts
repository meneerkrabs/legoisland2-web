// The menu engine of the original (docs/re/architecture.md 2.4): one data-driven engine for the front end, the pause menus and the result menus.
// Ported from FUN_0041fd45 (engine step), FUN_0041fa84 (per-page input), FUN_0041f695 (cursor keys), FUN_0041f966 (key capture) and
// FUN_0041be4e / FUN_0041bd3d / FUN_0041c092 (the three frame wrappers). The page table itself is read from the EXE (src/shell/tables.ts).
// The engine state of the original is the int array at 0x8a9590: [0] page, [1] selected item (>= 10: list entry n / 10 - 1), [2] stack depth,
// [3] press-animation counter, [4] press-animation kind, [5] key capture state, [6] list scroll, [8] confirm target (-1), [9+2k] / [10+2k] page stack.
// Pure: no DOM. Drawing is in menudraw.ts.
import { B } from '../game/input.ts';

/** item types (item +0x40) */
export const IT = { TITLE: 0, GOTO: 1, BACK: 2, YES: 3, ACTION: 4, TOGGLE: 5, SLIDER: 6, KEY: 7, KEYSET: 8, LIST: 9, ICON: 10 } as const;

export interface MenuItem {
  /** label as in the EXE: '!ID' = message id, '@ n!ID' = message + prefix, '^' = raw, else literal */
  label: string;
  type: number;
  /** +0x44: target page (goto), action id, toggle 0/1, slider 0..100, key code of a key entry */
  value: number;
  /** +0x48: disable mask: the item is disabled when (mask & engine mask) != 0 (0x20 always) */
  disable: number;
}
export interface MenuPage {
  /** 0 normal, 1 scrolled list (8 visible entries), 2 dialog with a 3D object (unused by the shipped pages) */
  kind: number;
  /** colour theme (the page's fifth dword: 0 yellow, 1 green, 2 blue) */
  theme: number;
  /** address of the page's set-up function (0 = none) */
  setupAt: number;
  items: MenuItem[];
}

export type MenuSound = 'move' | 'select' | 'back' | 'onoff';

/** result of one engine step: `ev` is FUN_0041fd45's return value (0 nothing, 1 goto, 2 back, 3 yes, 4 action, 5 toggle, 6 slider, 7 key capture started, 8 key bound), `a` / `b` its out parameters */
export interface MenuEvent { ev: number; a: number; b: number }

/** callbacks for the pages' set-up functions (FUN_0041ae6e etc.): called when a page is drawn / entered */
export interface MenuHooks {
  /** a page's set-up function of the EXE (by address) runs: may rewrite items / list entries; `index` = -1 for the page, else the item or list index (the engine passes list entries with index + scroll) */
  setup?(page: number, setupAt: number, item: MenuItem | null, index: number, engine: MenuEngine): number;
  sound?(kind: MenuSound): void;
}

const NO_EVENT: MenuEvent = { ev: 0, a: 0, b: 0 };

export class MenuEngine {
  pages: MenuPage[];
  hooks: MenuHooks;
  /** the engine state (see the header) */
  page = 0;
  item = 1;
  stack: { page: number; item: number }[] = [];
  /** press animation: counter and kind (0 = pressed button, 1 scroll up, 2 scroll thumb, 3 scroll down) */
  press = 0;
  pressKind = 0;
  capture = 0;
  scroll = 0;
  /** DAT_008a95ac: -1 = closed */
  open = false;
  /** DAT_008a9918 / 991c: text offsets (14 / -4, the pause menu sets 0x12 / -2: FUN_004201aa) */
  titleDy = 14;
  itemDy = -4;
  /** list entries of the current kind-1 page (the original's DAT_009d9c38..: 8 visible) and their count */
  list: (MenuItem | null)[] = [];
  listCount = 0;
  /** the key a capture is waiting for (set by the host through `feedKey`), 0 = none yet */
  private capKey = 0;

  constructor(pages: MenuPage[], hooks: MenuHooks = {}) { this.pages = pages; this.hooks = hooks; }

  get cur(): MenuPage { return this.pages[this.page]; }

  /** FUN_0041bd3d / FUN_0041be4e initialisation: open at `page` */
  openAt(page: number) {
    this.page = page; this.item = 1; this.stack = []; this.press = 0; this.pressKind = 0; this.capture = 0; this.scroll = 0; this.open = true;
    this.enterPage();
  }
  close() { this.open = false; }

  /** the item under the cursor (page item or list entry) */
  current(): MenuItem | null {
    if (this.item < 10) return this.cur.items[this.item] ?? null;
    return this.list[this.item / 10 - 1] ?? null;
  }

  private snd(k: MenuSound) { this.hooks.sound?.(k); }

  /** run a page's set-up function for the page and (kind 1) refresh the list entries (FUN_0041d765 start: it copies the template item 8 times and asks the set-up function) */
  enterPage() {
    const p = this.cur;
    if (p.setupAt) this.hooks.setup?.(this.page, p.setupAt, null, -1, this);
    this.refreshList();
  }
  refreshList() {
    const p = this.cur;
    this.list = []; this.listCount = 0;
    if (p.kind !== 1) return;
    const tmpl = p.items[1];
    for (let i = 0; i < 8; i++) {
      const it: MenuItem = { ...tmpl };
      const r = p.setupAt ? this.hooks.setup?.(this.page, p.setupAt, it, i + this.scroll, this) ?? -1 : -1;
      if (r < 0) { this.list.push(null); continue; }
      this.list.push(it);
      // the set-up function returns the number of entries that follow this one (FUN_0041b037: 13 - index - 1, FUN_0041b0d2 / FUN_0041b12d: count - index - 1): they make the list scrollable
      this.listCount = Math.max(this.listCount, this.scroll + i + 1 + Math.max(0, r));
    }
  }

  /** the selectable cursor positions of the current page in order (FUN_0041f695 builds this list) */
  private cursorList(): number[] {
    const p = this.cur;
    const out: number[] = [];
    if (p.kind === 1) {
      if (this.scroll !== 0) out.push(-1);
      for (let i = 0; i < 8; i++) if (this.list[i]) out.push((i + 1) * 10);
      // -2 = "scroll down" marker when more entries follow the visible window (DAT_009d9fb4 > 0)
      if (this.listCount > this.scroll + 8) out.push(-2);
    } else if (p.items.length > 2) out.push(1);
    for (let i = 2; i < p.items.length; i++) out.push(i);
    return out;
  }

  /** one tick of the engine: `pressed` = buttons that went down this tick (the input mapper's `pressed`), `mask` = the caller's disable mask (FUN_0041fd45's param_4) */
  step(pressed: number, mask: number, pointer?: PointerState): MenuEvent {
    if (!this.open) return NO_EVENT;
    const p = this.cur;
    if (p.kind === 2) this.item = 2;   // FUN_0041fd45: a dialog page's cursor is always on item 2 (its "back" button); used by the z04IFC character pages
    if (p.kind === 1 && this.item === 1) { this.item = 10; this.scroll = 0; this.refreshList(); }
    mask |= 0x20;
    let ev = this.input(pressed, mask, pointer);
    let a = 0, b = 0;
    const cur = this.current();
    if (ev === 4) {
      if (cur) { ev = cur.type; b = cur.value; }
      this.snd('select');
    }
    if (ev === 2) b = cur?.value ?? 0;
    switch (ev) {
      case 5:
        this.snd('onoff');
        if (cur) { cur.value = cur.value === 0 ? 1 : 0; b = cur.value; }
        break;
      case 7:
        this.capture = 1; this.capKey = 0;
        break;
      case 8: b = cur?.value ?? 0; break;
      case 9:
        // list item (save slots, pause "abort" entries): the action id is the item's value; the original opens a confirm page only when [8] != -1
        return { ev: 4, a: 0, b };
      case 1:
        this.stack.push({ page: this.page, item: this.item });
        this.page = b; this.item = 1; this.capture = 0; this.scroll = 0;
        this.enterPage();
        break;
      case 2: {
        this.snd('back');
        if (this.stack.length === 0) a = -1;
        else {
          a = this.page;
          const s = this.stack.pop()!;
          this.page = s.page; this.item = s.item; this.capture = 0;
          this.scroll = 0;
          this.enterPage();
        }
        break;
      }
    }
    return { ev, a, b };
  }

  /** FUN_0041fa84 */
  private input(pressed: number, mask: number, pointer?: PointerState): number {
    let ev = 0;
    if (this.capture !== 0) return this.captureStep(pressed);
    const cur = this.current();
    // pointer: hover selects, press activates (the original's FUN_0041f181 does the same with the mouse cursor)
    if (pointer) this.pointer(pointer, mask);
    if (this.cur.kind !== 2) this.cursorKeys(pressed);
    const c = this.current();
    const type = c?.type ?? -1;
    const off = c ? (c.disable & mask) !== 0 : true;
    if (c && !off && (pressed & B.LEFT) && type === IT.SLIDER) { this.press = 2; this.pressKind = 0; c.value = Math.max(0, c.value - 10); }
    if (c && !off && (pressed & B.LEFT) && type === IT.TOGGLE) { this.press = 4; this.pressKind = 0; }
    if (c && !off && (pressed & B.RIGHT) && type === IT.SLIDER) { this.press = 2; this.pressKind = 0; c.value = Math.min(100, c.value + 10); }
    if (c && !off && (pressed & B.RIGHT) && type === IT.TOGGLE) { this.press = 4; this.pressKind = 0; }
    if (!c || !off || type === IT.KEY) {
      if (pressed & B.SHIFT) { this.pressKind = 0; this.press = 4; }
      if (pressed & B.ENTER) { this.pressKind = 0; this.press = 4; }
      if (pressed & B.SPACE) { this.pressKind = 0; this.press = 4; }
    }
    if (this.press === 1 && this.pressKind === 0) ev = 4;
    if (pressed & B.ESC) {
      if (this.item < 10) { ev = 2; this.press = 0; } else this.item = 2;
    }
    if (this.press > 0) this.press--;
    if (c && type !== IT.KEY && off) { this.press = 0; ev = 0; }
    void cur;
    return ev;
  }

  /** FUN_0041f695: Up / Down move the cursor through the selectable entries, wrapping; plays the move sounds */
  private cursorKeys(pressed: number) {
    const list = this.cursorList();
    if (list.length === 0) return;
    if (pressed & B.DOWN) {
      this.press = 0;
      let i = list.indexOf(this.item);
      if (i >= 0 && i < list.length - 1) this.item = list[i + 1]; else this.item = list[0];
      if (this.item === -1) this.item = list[1];
      if (this.item === -2) { this.scrollBy(1); this.item = list[list.length - 2]; }
      this.snd('move');
    }
    if (pressed & B.UP) {
      this.press = 0;
      let i = list.indexOf(this.item);
      if (i > 0) this.item = list[i - 1]; else this.item = list[list.length - 1];
      if (this.item === -2) this.item = list[list.length - 2];
      if (this.item === -1) { this.scrollBy(-1); this.item = list[1]; }
      this.snd('move');
    }
  }
  private scrollBy(d: number) {
    this.scroll = Math.max(0, Math.min(Math.max(0, this.listCount - 8), this.scroll + d));
    this.refreshList();
  }

  /** FUN_0041f966: waiting for a key; the host calls feedKey with the new key code (device 1: 0x10000 | DIK) when one went down */
  feedKey(code: number) { if (this.capture !== 0 && code) { this.capKey = code; } }
  private captureStep(pressed: number): number {
    if (pressed & B.ESC) { this.capture = 0; return 0; }
    if (this.capKey) {
      const c = this.current();
      if (c) c.value = this.capKey;
      this.capture = 0; this.capKey = 0;
      return 8;
    }
    // blinking cursor: 1..5 then -1..-5 (the original's [5])
    if (this.capture > 0) { this.capture++; if (this.capture > 5) this.capture = -1; } else { this.capture--; if (this.capture < -5) this.capture = 1; }
    return 0;
  }

  // ---- pointer ----------------------------------------------------------------------------------------------------------------------------------
  /** hit rectangles (640x480 virtual px) recorded by the last draw: item index (or list cursor value) -> rect */
  hits: { item: number; x0: number; y0: number; x1: number; y1: number; slider?: { x0: number; x1: number } }[] = [];
  private pointerPrevDown = false;
  private pointerPrevItem = -99;
  private pointer(p: PointerState, mask: number) {
    const hit = this.hits.find((h) => p.x >= h.x0 && p.x < h.x1 && p.y >= h.y0 && p.y < h.y1);
    if (hit && (p.moved || (p.down && !this.pointerPrevDown)) && hit.item !== this.pointerPrevItem) {
      const it = hit.item < 10 ? this.cur.items[hit.item] : this.list[hit.item / 10 - 1];
      if (it && (it.type === IT.KEY || (it.disable & mask) === 0)) {
        if (this.item !== hit.item) this.snd('move');
        this.item = hit.item;
      }
    }
    if (p.moved || (p.down && !this.pointerPrevDown)) this.pointerPrevItem = hit ? hit.item : -99;
    p.moved = false;
    if (p.down && !this.pointerPrevDown && hit && hit.item === this.item) {
      const it = this.current();
      if (it && it.type === IT.SLIDER && hit.slider) {
        // 10 small bars; a click on bar n sets (n + 1) * 10 (FUN_0041f181)
        const f = (p.x - hit.slider.x0) / (hit.slider.x1 - hit.slider.x0);
        it.value = Math.max(0, Math.min(100, Math.round(f * 10) * 10));
        this.press = 2; this.pressKind = 0;
      } else if (it && (it.type !== IT.KEY ? (it.disable & mask) === 0 : true)) { this.press = 4; this.pressKind = 0; }
    }
    this.pointerPrevDown = p.down;
  }
}

export interface PointerState { x: number; y: number; down: boolean; /** the pointer moved or was pressed since the last engine step (hover only selects then) */ moved?: boolean }
