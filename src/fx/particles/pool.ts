// Particle pool (CParticleArray.cpp), the emitter block with its active particle list and the particle record.
import { Rec } from './core.ts';
import { PART_SIZE, BLK_SIZE, BK, APP_SIZE, MOV_SIZE, EMI_SIZE, PT } from './layout.ts';

/** a pool element (0x308 bytes). The list links of the original (+0 next free, +4 state marker, +8 own index, +0xc next active) are fields here. */
export class Particle {
  readonly rec = new Rec(PART_SIZE);
  /** +0 (while free): next free particle */
  nextFree: Particle | null = null;
  /** +4: 0xfffffffe while allocated, else (index + 1) / 0xffffffff for the last */
  state = 0;
  /** +8: own index in the pool */
  readonly id: number;
  /** +0xc: next particle of the block's active list */
  next: Particle | null = null;
  /** incremented every time the pool hands the particle out (lets deferred work detect a recycled particle) */
  gen = 0;
  /** +0x304: the particle's own [EMITS] blocks (`nEmits` of them) */
  subBlocks: Block[] | null = null;
  /** zero-copy views of the three embedded records */
  readonly app: Rec; readonly mov: Rec; readonly emi: Rec;
  constructor(id: number) {
    this.id = id;
    this.app = this.rec.view(PT.APP_B, APP_SIZE);
    this.mov = this.rec.view(PT.MOV_B, MOV_SIZE);
    this.emi = this.rec.view(PT.EMI_B, EMI_SIZE);
  }
}

/** CParticleArray: n particles with a free list */
export class Pool {
  readonly n: number;
  readonly parts: Particle[] = [];
  /** +8 */
  freeHead: Particle | null = null;
  /** +4: allocated count */
  used = 0;
  constructor(n: number) {
    this.n = n;
    for (let i = 0; i < n; i++) this.parts.push(new Particle(i));
    this.init();
  }
  /** FUN_00456a30 */
  init(): void {
    this.used = 0;
    this.freeHead = this.parts[0] ?? null;
    for (let i = 0; i < this.n; i++) {
      const p = this.parts[i];
      p.nextFree = i + 1 < this.n ? this.parts[i + 1] : null;
      p.state = i + 1 < this.n ? i + 1 : 0xffffffff;
    }
  }
  /** FUN_004569d0: take the first free particle (null when the pool is empty) */
  alloc(): Particle | null {
    const p = this.freeHead;
    if (!p) return null;
    this.freeHead = p.nextFree;
    p.state = 0xfffffffe;
    p.gen++;
    this.used++;
    return p;
  }
  /** FUN_00456a00 */
  free(p: Particle): void {
    p.nextFree = this.freeHead;
    this.freeHead = p;
    this.used--;
  }
}

/** emitter block (0x350 bytes): the template of a source's particles (name 0, emitter +0x50, movement +0x104, appearance +0x248) + its active list */
export class Block {
  readonly rec = new Rec(BLK_SIZE);
  readonly emi: Rec; readonly mov: Rec; readonly app: Rec;
  /** +0x33c: the pool the particles come from (null = none: nothing is emitted) */
  pool: Pool | null = null;
  /** +0x348: head of the active list; +0x340 / +0x344: the iteration cursor and its predecessor */
  head: Particle | null = null;
  cursor: Particle | null = null;
  prev: Particle | null = null;
  constructor(from?: Rec) {
    if (from) this.rec.u8.set(from.u8.subarray(0, BLK_SIZE));
    this.emi = this.rec.view(BK.EMI_B, EMI_SIZE);
    this.mov = this.rec.view(BK.MOV_B, MOV_SIZE);
    this.app = this.rec.view(BK.APP_B, APP_SIZE);
  }
  get count(): number { return this.rec.i[BK.COUNT_D]; }
  set count(v: number) { this.rec.i[BK.COUNT_D] = v; }
  /** FUN_004568a0: take a particle from the pool and push it on the head of the active list (null without a pool / when the pool is empty) */
  allocParticle(): Particle | null {
    if (!this.pool) return null;
    const p = this.pool.alloc();
    if (p) { p.next = this.head; this.head = p; this.count = this.count + 1; }
    return p;
  }
  /** FUN_004568e0: unlink `p` from the active list (the iteration cursor follows) and give it back to the pool */
  remove(p: Particle): void {
    this.count = this.count - 1;
    if (this.head === p) {
      this.head = p.next;
      this.pool!.free(p);
      this.cursor = this.head; this.prev = this.head;
    } else {
      this.prev!.next = p.next;
      this.pool!.free(p);
      this.cursor = this.prev!.next;
    }
  }
  /** FUN_00456960: advance the cursor: prev = cursor, cursor = cursor.next; returns the new cursor */
  advance(): Particle | null {
    const c = this.cursor;
    if (c) { this.prev = c; this.cursor = c.next; }
    return this.cursor;
  }
  /** start an iteration: cursor = prev = head (`*(+0x340) = *(+0x344) = *(+0x348)`) */
  startIter(): Particle | null { this.cursor = this.head; this.prev = this.head; return this.cursor; }
}
