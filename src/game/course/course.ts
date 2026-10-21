import RAPIER from '@dimforge/rapier3d-compat';
import { Level, SlabSet } from '../physics/level';
import { Slab, SURFACES, SurfaceType, slabBox } from '../surfaces';
import { CHUNK, CourseGenerator, Pickup } from './generator';

export const STREAM = {
  generateAhead: 900, // metres of lane data generated ahead of the car
  buildAhead: 380, // metres of physical slabs ahead of the car
  keepBehind: 60, // slabs whose end is further behind than this are removed
  maxRunChunks: 80, // longest single slab (400 m); longer runs are split
};

/** A closed run of consecutive chunks on one lane, ready to become a slab. */
interface Run {
  surface: SurfaceType;
  d0: number;
  d1: number;
  /** False when this run continues a split run (no leading ramp at the seam). */
  bevel: boolean;
}

/**
 * Streams the procedurally generated course into the physics world: converts lane chunks into
 * slabs ahead of the car and removes them behind it. Also owns fuel pickups.
 */
export class Course implements Level {
  readonly slabs: SlabSet;
  readonly generator: CourseGenerator;
  /** Pickups currently relevant (ahead or near the car), not yet collected. */
  readonly activePickups = new Map<number, Pickup>();
  private collected = new Set<number>();
  private pendingRuns: Run[] = [];
  private scanPos: Record<SurfaceType, number>;
  private openRun: Record<SurfaceType, number | null> = { floor: null, ceiling: null, left: null, right: null };
  private openIsContinuation: Record<SurfaceType, boolean> = { floor: false, ceiling: false, left: false, right: false };
  private nextSlabId = 1;
  private pickupCursor = 0;
  /** Optional guard so that slabs are never created overlapping the car. */
  carBounds: (() => { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) | null = null;

  constructor(world: RAPIER.World, seed: number) {
    this.slabs = new SlabSet(world);
    this.generator = new CourseGenerator(seed);
    const first = Math.min(...this.generator.route.map((p) => p.start));
    this.scanPos = { floor: first, ceiling: first, left: first, right: first };
    this.update(0);
  }

  update(carDistance: number) {
    const gen = this.generator;
    gen.generateUntil(Math.ceil((carDistance + STREAM.generateAhead) / CHUNK));
    this.scanRuns();

    // Build pending runs that come within range.
    const buildLimit = carDistance + STREAM.buildAhead;
    const remaining: Run[] = [];
    for (const run of this.pendingRuns) {
      if (run.d0 <= buildLimit && run.d1 >= carDistance - STREAM.keepBehind) {
        if (this.overlapsCar(run)) remaining.push(run);
        else this.slabs.add({ id: this.nextSlabId++, ...run });
      } else if (run.d1 >= carDistance - STREAM.keepBehind) {
        remaining.push(run);
      }
    }
    this.pendingRuns = remaining;

    // Remove slabs far behind.
    for (const slab of [...this.slabs.active.values()]) {
      if (slab.d1 < carDistance - STREAM.keepBehind) this.slabs.remove(slab.id);
    }

    // Pickups: activate ahead, drop far behind.
    while (this.pickupCursor < gen.pickups.length && gen.pickups[this.pickupCursor].d <= buildLimit) {
      const p = gen.pickups[this.pickupCursor++];
      if (!this.collected.has(p.id)) this.activePickups.set(p.id, p);
    }
    for (const p of [...this.activePickups.values()]) {
      if (p.d < carDistance - STREAM.keepBehind) this.activePickups.delete(p.id);
    }

    gen.forgetBefore(Math.floor((carDistance - STREAM.keepBehind) / CHUNK) - STREAM.maxRunChunks - 4);
  }

  /** Marks a pickup as collected. Returns true if it was available. */
  collect(id: number): boolean {
    if (!this.activePickups.has(id)) return false;
    this.activePickups.delete(id);
    this.collected.add(id);
    return true;
  }

  /** Turns finalized lane chunks into closed runs (split at maxRunChunks). */
  private scanRuns() {
    const gen = this.generator;
    const limit = gen.frontier;
    for (const s of SURFACES) {
      let i = this.scanPos[s];
      let open = this.openRun[s];
      for (; i < limit; i++) {
        if (gen.has(s, i)) {
          if (open === null) {
            open = i;
            this.openIsContinuation[s] = false;
          } else if (i - open >= STREAM.maxRunChunks) {
            this.pendingRuns.push({ surface: s, d0: open * CHUNK, d1: i * CHUNK, bevel: !this.openIsContinuation[s] });
            open = i;
            this.openIsContinuation[s] = true;
          }
        } else if (open !== null) {
          this.pendingRuns.push({ surface: s, d0: open * CHUNK, d1: i * CHUNK, bevel: !this.openIsContinuation[s] });
          open = null;
        }
      }
      this.scanPos[s] = i;
      this.openRun[s] = open;
    }
    this.pendingRuns.sort((a, b) => a.d0 - b.d0);
  }

  private overlapsCar(run: Run): boolean {
    if (!this.carBounds) return false;
    const b = slabBox(run.surface, run.d0, run.d1);
    const c = this.carBounds();
    return (
      b.center.x - b.half.x < c.max.x && b.center.x + b.half.x > c.min.x &&
      b.center.y - b.half.y < c.max.y && b.center.y + b.half.y > c.min.y &&
      b.center.z - b.half.z < c.max.z && b.center.z + b.half.z > c.min.z
    );
  }

  /** All slabs ever built so far are in `slabs.active`; exposed for tests. */
  get builtSlabs(): Slab[] {
    return [...this.slabs.active.values()];
  }
}
