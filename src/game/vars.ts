// The game-variable array (docs/re/architecture.md 6.1): one int[319] at VA 0x8a2d2c. Names come from the executable (table of 319
// string pointers at 0x8a3228), so they are read at run time. Var 1 (NS_OFF) is read-only 0, var 2 (NS_ON) is read-only 1
// (get FUN_00417575, set FUN_00417597 which ignores 1 and 2, or FUN_0041761b, and-not FUN_0041766c, add FUN_004175ca).
import type { Pe } from '../formats/exe.ts';

export const GAMEVAR_COUNT = 319;
export const GAMEVAR_NAMES_VA = 0x8a3228;

/** indices of the variables the engine core uses */
export const V = {
  NS_OFF: 1, NS_ON: 2, NS_NEXT_SUBGAME: 5, NS_CSM_ACTIVE: 7,
  FSM_CURRENT_STATE: 0x58, CURRENT_SUBGAME: 0x59, PEPPER_CONTROL: 0x5e, PIZZAS_THROWN: 0x63, PREV_SUBGAME: 0xa3,
  PEPPERSSHADOW: 0xc5,
} as const;

/** PEPPER_CONTROL mode bits (the low 12 bits select the active node; 0x1000 is kept across mode changes) */
export const PC = { WALK: 1, SWIM: 2, SKATE: 4, VEHICLE: 8, PIZZA_AIM: 0x10, TALK: 0x20, PTERA: 0x40, BUSY: 0x100, INTERACT: 0x1000 } as const;

export class GameVars {
  readonly a = new Int32Array(GAMEVAR_COUNT);
  names: string[] = [];

  /** read the variable names out of the executable */
  loadNames(pe: Pe) {
    this.names = [];
    for (let i = 0; i < GAMEVAR_COUNT; i++) {
      const p = pe.u32(GAMEVAR_NAMES_VA + i * 4);
      this.names.push(p ? pe.cstr(p, 64) : `VAR_${i}`);
    }
  }
  nameOf(i: number) { return this.names[i] ?? `VAR_${i}`; }
  indexOf(name: string): number { return this.names.findIndex((n) => n === name || n === `SWITCH_GME_${name}` || n === `SWITCH_NS_${name}`); }

  get(i: number): number { return i === 1 ? 0 : i === 2 ? 1 : this.a[i] | 0; }
  set(i: number, v: number) { if (i !== 1 && i !== 2) this.a[i] = v | 0; }
  /** FUN_0041761b */
  or(i: number, v: number) { if (i !== 1 && i !== 2) this.a[i] |= v; }
  /** FUN_0041766c */
  andNot(i: number, v: number) { if (i !== 1 && i !== 2) this.a[i] &= ~v; }
  /** FUN_004175ca */
  add(i: number, v: number) { if (i !== 1 && i !== 2) this.a[i] += v; }
  /** the node gate: (var & mask) == value (mask 0 / value 0 = always) */
  gate(i: number, mask: number, value: number): boolean { return (this.get(i) & mask) === value; }
}
