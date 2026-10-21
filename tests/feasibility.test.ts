import { beforeAll, describe, expect, it } from 'vitest';
import { Course, STREAM } from '../src/game/course/course';
import type { ChunkSource } from '../src/game/course/chunkSource';
import { GeneratedChunk, ReachableCourseGenerator } from '../src/game/course/routeGenerator';
import { emptyControls } from '../src/game/input';
import { CONFIG } from '../src/game/config';
import { PLANNER_CONFIG } from '../src/game/course/plannerConfig';
import { FailureMonitor } from '../src/game/session';
import { initPhysics, Simulation } from '../src/game/simulation';

beforeAll(initPhysics);

/**
 * These are fixed recorded inputs from each certified plan, not a runtime driver.
 * The same live world, vehicle, resources and collision history cross every boundary.
 */
describe('published terrain remains traversable in one continuous physics world', () => {
  for (const seed of [1, 42, 233]) {
    it(`seed ${seed}: recorded maneuvers cross 6 km without resets`, () => {
      const sim = new Simulation({ createLevel: world => new Course(world, seed) });
      const course = sim.level as Course;
      const monitor = new FailureMonitor();
      const world = sim.world, body = sim.vehicle.body;
      let chunkId = 0;
      try {
        while (sim.distance < 6000) {
          const chunk = course.chunks.find(c => c.id === chunkId);
          expect(chunk, `missing chunk ${chunkId} at ${sim.distance.toFixed(2)} m`).toBeDefined();
          if (!chunk) break;
          expect(chunk.validation.accepted).toBe(true);
          expect(chunk.witness.dt).toBe(sim.dt);
          expect(chunk.witness.controls.length).toBeGreaterThan(0);
          const startDrift = sim.distance - chunk.d0 - chunk.entry.distanceOffset;
          for (let step = 0; step < chunk.witness.controls.length; step++) {
            expect(course.needsBuffer(sim.distance)).toBe(false);
            sim.step(chunk.witness.controls[step]);
            const context = `seed ${seed}, chunk ${chunk.id} (${chunk.kind}), input ${step}, distance ${sim.distance.toFixed(2)} m`;
            expect(monitor.check(sim), context).toBeNull();
            expect(sim.vehicle.suctionOverheated, context).toBe(false);
            expect(sim.fuel.value, context).toBeGreaterThan(0);
            expect(Number.isFinite(sim.vehicle.position.x + sim.vehicle.position.y + sim.vehicle.position.z), context).toBe(true);
          }
          expect(sim.world).toBe(world);
          expect(sim.vehicle.body).toBe(body);
          const exitContext = `exit of chunk ${chunk.id} (${chunk.kind}) at ${sim.distance.toFixed(3)} m; `
            + `position ${JSON.stringify(sim.vehicle.position)}; velocity ${JSON.stringify(sim.vehicle.body.linvel())}; `
            + `roll ${sim.vehicle.roll}; certified ${JSON.stringify(chunk.exit)}`;
          expect(sim.vehicle.supportSurface, exitContext).toBe('floor');
          expect(sim.vehicle.mode).not.toBe('airborne');
          // Open-loop inputs never re-sync, so boundary offsets random-walk across many chunks
          // (measured up to ~6.6 m over 6 km, with every maneuver still completing). Each chunk's
          // own contribution must stay inside the certified ±0.15 s action-timing margin.
          const drift = sim.distance - chunk.d1 - chunk.exit.distanceOffset;
          expect(Math.abs(drift - startDrift), exitContext).toBeLessThan(CONFIG.car.maxForwardSpeed * PLANNER_CONFIG.timingTolerance);
          chunkId++;
        }
        expect(sim.distance).toBeGreaterThanOrEqual(6000);
        expect(chunkId).toBeGreaterThan(8);
        expect(sim.refuelCount).toBeGreaterThanOrEqual(chunkId * 2);
      } finally { sim.dispose(); }
    }, 60000);
  }

  it('streams 100 km of recorded normal driving with bounded local physics coordinates', () => {
    // Repeating one certified straight section isolates the origin/streaming lifecycle
    // from expensive route search. Its exact decoration and resource positions travel
    // with it; the varied-seed tests above independently cover procedural feasibility.
    const base = new ReachableCourseGenerator(117, { template: 'normal' }).next();
    expect(base.validation.accepted).toBe(true);
    expect(base.witness.controls.every(c => JSON.stringify(c) === JSON.stringify(emptyControls()))).toBe(true);
    // Retention bounds follow the streaming window and this repeated section's length.
    const length = base.d1 - base.d0;
    const maxPlans = Math.ceil((STREAM.generateAhead + STREAM.keepBehind) / length) + 1;
    const maxBuilt = Math.ceil((STREAM.buildAhead + STREAM.keepBehind) / length) + 1;
    let nextId = 0;
    const pending: GeneratedChunk[] = [];
    const source: ChunkSource = {
      frontier: 0,
      error: null,
      request(until) {
        while (this.frontier < until) {
          const offset = this.frontier - base.d0;
          const route = base.route.map(p => ({ ...p, d: p.d + offset }));
          const chunk: GeneratedChunk = {
            ...base, id: nextId++, d0: base.d0 + offset, d1: base.d1 + offset,
            slabs: base.slabs.map(s => ({ ...s, d0: s.d0 + offset, d1: s.d1 + offset })),
            obstacles: base.obstacles.map(o => ({ ...o, d: o.d + offset })),
            pickups: base.pickups.map(p => ({ ...p, d: p.d + offset })),
            route, witness: { ...base.witness, samples: route },
          };
          pending.push(chunk);
          this.frontier = chunk.d1;
        }
      },
      drain() { return pending.splice(0); },
      dispose() { pending.length = 0; },
    };
    const sim = new Simulation({ createLevel: world => new Course(world, 117, { source }) });
    const course = sim.level as Course;
    const world = sim.world, body = sim.vehicle.body;
    const monitor = new FailureMonitor();
    let steps = 0, rebases = 0;
    try {
      while (sim.distance < 100_000) {
        const before = sim.distance, previousOrigin = sim.originDistance;
        sim.step(base.witness.controls[steps % base.witness.controls.length]);
        if (sim.originDistance !== previousOrigin) rebases++;
        const failure = monitor.check(sim);
        if (failure) throw new Error(`${failure} at ${sim.distance.toFixed(2)} m after ${rebases} origin shifts`);
        if (steps % CONFIG.physicsHz === 0) {
          expect(sim.world).toBe(world);
          expect(sim.vehicle.body).toBe(body);
          expect(Math.abs(sim.vehicle.position.z)).toBeLessThan(CONFIG.origin.rebaseDistance + 1);
          expect(course.needsBuffer(sim.distance)).toBe(false);
          expect(course.chunks.length).toBeLessThanOrEqual(maxPlans);
          expect(course.activePickups.size).toBeLessThanOrEqual(maxBuilt * base.pickups.length);
          expect(world.colliders.len()).toBeLessThanOrEqual(maxBuilt * (base.slabs.length + base.obstacles.length));
          if (sim.time > 4) {
            expect(sim.vehicle.supportSurface).toBe('floor');
            expect(sim.vehicle.mode).toBe('grounded');
            expect(sim.vehicle.position.y, `distance ${sim.distance}, origin ${sim.originDistance}, step ${steps}, pose ${JSON.stringify(sim.vehicle.position)}, velocity ${JSON.stringify(sim.vehicle.body.linvel())}`).toBeLessThan(CONFIG.car.halfExtents.y + 0.1);
            expect(Math.abs((sim.distance - before) / sim.dt - sim.vehicle.forwardSpeed)).toBeLessThan(0.06);
          }
        }
        steps++;
      }
      expect(sim.distance).toBeGreaterThanOrEqual(100_000);
      expect(sim.originDistance).toBeGreaterThan(99_000);
      expect(rebases).toBeGreaterThan(300);
      expect(sim.refuelCount).toBeGreaterThan(500);
      expect(sim.fuel.value).toBe(CONFIG.fuel.capacity);
      expect(course.chunks[0].id).toBeGreaterThan(250);
      expect(course.debugInfo(sim.distance).frontier).toBeGreaterThan(sim.distance);
    } finally { sim.dispose(); }
  }, 60000);
});
