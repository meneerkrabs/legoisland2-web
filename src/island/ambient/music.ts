// Music.c of the island (docs/re/m4/wp7-ambient.md "Music", docs/re/audio.md 7.8): ctor FUN_004bc773 on PEPP (head of Pepper's chain, gate 0x5e & 0 =
// always), table 0x8d9db8 {update FUN_004bc533 (returns 2), prerender FUN_004bc6e4 (1), destroy FUN_004bcbb1, draw FUN_004bc6fe}; FUN_004bc190 picks the
// building segment by distance. The node loads the keys of the story node (var 0x58) and, in the town mode, switches the primary segment when Pepper
// comes within 40 units (squared distance 1600, the first match of Info, Laura, Papa, Mama, Nick wins) and between the town themes `Z02LGIT` / `Z02LGIM`
// on DirectMusic notifications; the groove follows Pepper's mode (walk 1, fast run 2, vehicles 3: FUN_00443310(level - 3)).
// The services are optional `IslandCtx` members (music / musicGroove / musicNotified / musicMute / ambience): the zone game forwards them to the
// audio host. Pure logic, testable in node.
import { registerCtor } from '../../game/setup.ts';
import type { BehaviourNode } from '../../game/controller.ts';
import type { GameRecord } from '../../game/record.ts';
import type { World } from '../../game/world.ts';
import { tryCtx } from '../ctx.ts';
import { ftol } from './common.ts';

export const CTOR_MUSIC = 0x4bc773;

/** the building anchors FUN_004bc190 measures (`DAT_00983804 + 0x3260 / 0x30c0 / 0x31f8 / 0x3330 / 0x3128`) and the segment each one plays */
export const MUSIC_BUILDINGS: readonly { record: number; name: string; key: string; id: number }[] = [
  { record: 124, name: 'INFC', key: 'Z02Info', id: 1 },
  { record: 120, name: 'RADI', key: 'Z02Laura', id: 2 },
  { record: 123, name: 'PIZB', key: 'Z02Papa', id: 3 },
  { record: 126, name: 'HSE3', key: 'Z02Mama', id: 4 },
  { record: 121, name: 'POLB', key: 'Z02Nick', id: 5 },
];
/** *(node + 0x14) = 0x640: the radius test compares ftol(squared distance) with it (unsigned) */
export const MUSIC_RADIUS2 = 0x640;

/** the keys the constructor loads per story node (FUN_00443290): which exist decides what can play */
export function musicKeysFor(node: number): string[] {
  const town = ['Z02LGIM', 'Z02LGIT', 'Z02LGIB', 'Z02Papa', 'Z02Mama', 'Z02Laura', 'Z02Nick', 'Z02Info', 'Z02Trom'];
  if (node < 7) return town;
  if (node < 0x1f) return ['bbotsM'];
  if (node < 0x38) return ['bbotsM', 'radio'];
  if (node < 0x3b) return ['radio'];
  if (node < 0x3e) return ['bbotsM'];
  return town;
}

export class MusicNode implements BehaviourNode {
  readonly kind = 'Music';
  var = 0; mask = 0; value = 0; stamp = 0xfffffffe;
  keys = new Set<string>();
  mode = 0;            // +0x48: 2 town, 0 bricksterbots, 1 radio
  building = 100;      // +0x4c (byte): 0 none, 1..5 the building segment playing, 100 = force a choice
  main = 0;            // +0x54 (byte): Z02LGIM (the main theme) is playing
  grooveWant = 1;      // +0x58
  grooveCur = 10;      // +0x5c
  node = 0;            // +0x60
  last = 0;            // +0x68: the previous notification value
  sub = 0;             // +0x6c: 0 town theme (LGIT) / building, 1 main theme (LGIM)
  flag = 1;            // +0x70 (byte): a new notification this tick
  timer = 0x78;        // +0x74
  /** what was asked of the music (tests): every FUN_004432c0 key and FUN_00443310 level in order */
  readonly log: string[] = [];
  private inited = false;

  private play(w: World, key: string) {
    if (!this.keys.has(key)) return;           // FUN_004432c0(0) for a key that was not loaded: nothing
    this.log.push(key);
    tryCtx(w)?.music?.(key);
  }
  private groove(w: World, level: number) { this.log.push(`groove ${level}`); tryCtx(w)?.musicGroove?.(level); }
  private notified(w: World): number { return (tryCtx(w)?.musicNotified?.() ?? 0) & 0xff; }

  /** the constructor FUN_004bc773 (first update) */
  private init(w: World) {
    this.inited = true;
    const c = tryCtx(w);
    c?.musicMute?.(false);                     // FUN_00873e00(0)
    this.node = w.vars.get(0x58);
    for (const k of musicKeysFor(this.node)) this.keys.add(k);
    const n = this.node;
    if (n < 7 || 0x3e <= n) this.mode = 2;
    else if (n < 0x1f || (0x3b <= n && n < 0x3e)) { this.mode = 0; this.play(w, 'bbotsM'); }
    else if (n < 0x38) { this.mode = 0; this.play(w, 'bbotsM'); }
    else { this.play(w, 'radio'); this.mode = 1; }
    this.sub = 0; this.main = 0;
    c?.ambience?.('LGIBirds');                 // FUN_004431e0("LGIBirds", ...)
    this.groove(w, 0);                         // FUN_00443310(0)
    this.last = this.notified(w);
    this.flag = 1;
    this.timer = 0x78;
  }

  /** FUN_0042377a: the controller's +0x18 as the update pass left it: written when the building's own record was processed, so it is the value of THIS frame for a
   *  building earlier in the record order than the Music node and of the PREVIOUS frame (focus position included) for one after it. Without a controller: FUN_004221f2, live. */
  private dist2(w: World, idx: number): number {
    const r = w.records[idx], f = w.focus;
    if (!r || !f) return 1e38;
    if (r.ctrl) return r.ctrl.distSq;
    const dx = r.x - f.x, dz = r.z - f.z;
    return dx * dx + dz * dz;
  }

  /** FUN_004bc190 */
  private towns(w: World, rec: GameRecord, pc: number) {
    const R = MUSIC_RADIUS2;
    const u = (d: number) => { const t = ftol(d); return Number.isFinite(t) && Math.abs(t) < 2 ** 31 ? t >>> 0 : 0x80000000; };
    let hit: typeof MUSIC_BUILDINGS[number] | null = null;
    for (const b of MUSIC_BUILDINGS) if (!(R < u(this.dist2(w, b.record)))) { hit = b; break; }
    if (!hit) {
      if (this.building !== 0) {
        if (this.sub === 0) { this.play(w, 'Z02LGIT'); this.main = 0; this.groove(w, 0); }
        else { this.play(w, 'Z02LGIM'); this.main = 1; this.grooveCur = 10; }
        this.building = 0;
      }
    } else if (this.building !== hit.id) {
      this.play(w, hit.key);
      this.building = hit.id;
      this.main = 0;
    }
    if (this.main === 0) { this.grooveWant = 1; this.grooveCur = 1; }
    else {
      switch (pc & 0xfff) {
        case 1: { const clip = rec.anim?.clip ?? -1; this.grooveWant = clip === 0x24 || clip === 0x3f || clip === 0x40 ? 2 : 1; break; }
        case 4: case 8: case 0x40: this.grooveWant = 3; break;
        default: this.grooveWant = 1;
      }
      if (this.grooveWant !== this.grooveCur) { this.groove(w, this.grooveWant - 3); this.grooveCur = this.grooveWant; }
    }
  }

  /** FUN_004bc533 */
  update(w: World, rec: GameRecord): number {
    if (!this.inited) this.init(w);
    const pc = w.vars.get(0x5e);               // the gate var's value (PEPPER_CONTROL)
    this.node = w.vars.get(0x58);
    if (this.mode !== 0) {
      if (this.mode !== 2) return 2;
      const n = this.notified(w);
      if (n === this.last || 0 < this.timer) { this.flag = 0; this.timer = ftol(this.timer - 1 * w.dt); }
      else { this.flag = n !== 0 ? 1 : 0; this.last = n; this.timer = 0x78; }
      if (this.sub === 0) {
        if (!this.flag) this.towns(w, rec, pc);
        else { this.sub = 1; this.grooveCur = 10; this.main = 1; this.building = 100; }
      } else if (this.sub === 1) {
        if (!this.flag || !this.main) this.towns(w, rec, pc);
        else { this.play(w, 'Z02LGIT'); this.sub = 0; this.main = 0; this.groove(w, 0); }
      }
    }
    if (this.node === 0x38 && !(tryCtx(w)?.cutsceneActive() ?? false)) {
      this.play(w, 'radio');
      this.mode = 1;
    }
    return 2;
  }
}

registerCtor(CTOR_MUSIC, () => new MusicNode());
