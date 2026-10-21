import { beforeAll, describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { Course, STREAM } from '../src/game/course/course';
import { ChunkSource, SynchronousChunkSource } from '../src/game/course/chunkSource';
import { GeneratedChunk, ReachableCourseGenerator } from '../src/game/course/routeGenerator';
import { PLANNER_CONFIG } from '../src/game/course/plannerConfig';
import { DECORATOR_CONFIG } from '../src/game/course/decorator';
import { SURFACES } from '../src/game/surfaces';
import { initPhysics } from '../src/game/simulation';
import { CONFIG } from '../src/game/config';
import { controls, makeSim, run } from './helpers';

beforeAll(initPhysics);

/** Delivery is deliberately controlled by the test, as with a delayed worker message. */
class QueuedSource implements ChunkSource {
  frontier = 0;
  error: string | null = null;
  requests: { until: number; forgetBefore: number }[] = [];
  pending: GeneratedChunk[] = [];
  disposed = false;
  request(until: number, forgetBefore: number) { this.requests.push({ until, forgetBefore }); }
  drain() { return this.pending.splice(0); }
  deliver(chunk: GeneratedChunk) { this.pending.push(chunk); this.frontier = chunk.d1; }
  dispose() { this.disposed = true; this.pending.length = 0; }
}

const withoutId = <T extends { id?: number }>({ id: _id, ...geometry }: T) => geometry;
const makeWorld = () => new RAPIER.World({ x: 0, y: -CONFIG.gravity, z: 0 });

describe('validated course streaming', () => {
  it('keeps physical colliders, pickups and retained plans bounded for 50 km', () => {
    const world = makeWorld();
    const source = new SynchronousChunkSource(7);
    const course = new Course(world, 7, { source });
    // Even the shortest recovery chunk has this much forward extent. One straddling
    // chunk can be retained at either edge of the streaming window.
    const minChunkLength = PLANNER_CONFIG.leadMin + CONFIG.car.maxForwardSpeed * PLANNER_CONFIG.recoverySeconds;
    const maxPlans = Math.ceil((STREAM.generateAhead + STREAM.keepBehind) / minChunkLength) + 1;
    const maxBuiltPlans = Math.ceil((STREAM.buildAhead + STREAM.keepBehind) / minChunkLength) + 1;
    const maxObstaclesPerChunk = SURFACES.reduce((sum, surface) => sum + DECORATOR_CONFIG.maxObstacles[surface], 0);
    try {
      for (let distance = 0; distance <= 50_000; distance += 500) {
        course.update(distance);
        expect(course.needsBuffer(distance)).toBe(false);
        expect(course.chunks.length).toBeLessThanOrEqual(maxPlans);
        expect(source.generator.chunks.length).toBeLessThanOrEqual(maxPlans);
        expect(course.activePickups.size).toBeLessThanOrEqual(maxBuiltPlans * 2);
        expect(course.slabs.active.size).toBeLessThanOrEqual(maxBuiltPlans * 7 + 1);
        expect(course.obstacles.active.size).toBeLessThanOrEqual(maxBuiltPlans * maxObstaclesPerChunk);
        expect(course.routeWaypoints.length).toBeLessThanOrEqual(maxPlans * Math.ceil(PLANNER_CONFIG.maxValidationSeconds * CONFIG.physicsHz / PLANNER_CONFIG.sampleEverySteps));
        for (const chunk of course.chunks) {
          expect(chunk.d1).toBeGreaterThanOrEqual(distance - STREAM.keepBehind);
          expect(chunk.validation.accepted).toBe(true);
        }
        for (const slab of course.builtSlabs) expect(slab.d1).toBeGreaterThanOrEqual(distance - STREAM.keepBehind);
        for (const pickup of course.activePickups.values()) expect(pickup.d).toBeGreaterThanOrEqual(distance - STREAM.keepBehind);
        for (const obstacle of course.obstacles.active.values()) expect(obstacle.d + obstacle.half.z).toBeGreaterThanOrEqual(distance - STREAM.keepBehind);
        // Adjacent logical slabs share one physical run, avoiding collision seams.
        // Count the owned colliders to catch orphaned allocations during run rebuilds.
        expect(course.slabs.colliderCount).toBeLessThanOrEqual(course.slabs.active.size);
        expect(world.colliders.len()).toBe(course.slabs.colliderCount + course.obstacles.active.size);
        expect(world.colliders.len()).toBeLessThanOrEqual(maxBuiltPlans * (7 + maxObstaclesPerChunk) + 1);
      }
      expect(course.chunks[0].id).toBeGreaterThan(70);
      expect(source.frontier).toBeGreaterThanOrEqual(50_000 + STREAM.generateAhead);
    } finally {
      course.dispose();
      expect(world.colliders.len()).toBe(0);
      world.free();
    }
  }, 120000);

  it('builds exactly the certified intervals, obstacles and pickups without quantization', () => {
    const world = makeWorld();
    const source = new SynchronousChunkSource(42, { template: 'multiple' });
    const course = new Course(world, 42, { source });
    try {
      for (const distance of [0, 350, 750, 1200, 1800]) {
        course.update(distance);
        const retained = course.chunks.filter(c => c.d0 <= distance + STREAM.buildAhead);
        const expectedSlabs = retained.flatMap(c => c.slabs).filter(s => s.d1 >= distance - STREAM.keepBehind);
        if (distance <= STREAM.keepBehind) expectedSlabs.unshift({ surface: 'floor', d0: -30, d1: 0, bevel: false });
        expect(course.builtSlabs.map(withoutId)).toEqual(expectedSlabs);
        expect([...course.obstacles.active.values()].map(withoutId)).toEqual(
          retained.flatMap(c => c.obstacles).filter(o => o.d + o.half.z >= distance - STREAM.keepBehind).map(withoutId));
        expect([...course.activePickups.values()].map(withoutId)).toEqual(
          retained.flatMap(c => c.pickups).filter(p => p.d >= distance - STREAM.keepBehind).map(withoutId));
        for (let i = 1; i < course.chunks.length; i++) {
          expect(course.chunks[i].d0).toBe(course.chunks[i - 1].d1);
          expect(course.chunks[i].entry).toEqual(course.chunks[i - 1].exit);
        }
      }
    } finally {
      course.dispose();
      expect(world.colliders.len()).toBe(0);
      world.free();
    }
  }, 30000);

  it('reproduces published geometry for a seed regardless of update cadence', () => {
    const a = new SynchronousChunkSource(123), b = new SynchronousChunkSource(123), c = new SynchronousChunkSource(124);
    try {
      a.request(1800, -100);
      const expected = a.drain();
      b.request(700, -100);
      const actual = b.drain();
      b.request(1800, -100);
      actual.push(...b.drain());
      expect(actual).toEqual(expected);
      c.request(700, -100);
      expect(c.drain()[0].slabs).not.toEqual(expected[0].slabs);
    } finally { a.dispose(); b.dispose(); c.dispose(); }
  }, 30000);

  it('waits for asynchronous terrain and consumes each pickup only once', () => {
    const world = makeWorld();
    const source = new QueuedSource();
    const course = new Course(world, 19, { source });
    try {
      expect(course.needsBuffer(10)).toBe(true);
      expect(course.terrainStatus).toBe('Preparing road…');
      expect(course.chunks).toHaveLength(0);
      expect(course.builtSlabs).toHaveLength(1);
      expect(source.requests[0]).toEqual({ until: STREAM.generateAhead, forgetBefore: -STREAM.keepBehind });
      const chunk = new ReachableCourseGenerator(19).next();
      source.deliver(chunk);
      course.update(10);
      expect(course.needsBuffer(10)).toBe(false);
      expect(course.terrainStatus).toBeNull();
      expect(course.chunks).toEqual([chunk]);
      expect(course.needsBuffer(chunk.d1 - CONFIG.car.maxForwardSpeed)).toBe(true);
      const pickup = [...course.activePickups.values()][0];
      expect(course.collect(pickup.id)).toBe(true);
      expect(course.collect(pickup.id)).toBe(false);
      source.deliver(chunk); // Duplicate worker delivery must not rebuild a consumed pickup.
      course.update(10);
      course.update(11);
      expect([...course.activePickups.values()].some(p => p.d === pickup.d)).toBe(false);
      expect(course.chunks).toHaveLength(1);
      source.error = 'worker failed';
      course.update(10);
      expect(course.needsBuffer(10)).toBe(true);
      expect(course.terrainStatus).toBe('Terrain generation failed · R to retry');
    } finally {
      course.dispose();
      expect(world.colliders.len()).toBe(0);
      world.free();
    }
    expect(source.disposed).toBe(true);
    expect(course.activePickups.size).toBe(0);
    expect(course.chunks).toHaveLength(0);
  });

  it('rejects a gap in the published chunk boundaries', () => {
    const world = makeWorld();
    const source = new QueuedSource();
    const course = new Course(world, 19, { source });
    try {
      const first = new ReachableCourseGenerator(19).next();
      source.deliver(first);
      course.update(0);
      const colliders = world.colliders.len();
      source.deliver({ ...first, id: first.id + 1, d0: first.d1 + 1, d1: first.d1 * 2 + 1 });
      expect(() => course.update(0)).toThrow('Non-contiguous terrain stream');
      expect(course.chunks).toEqual([first]);
      expect(world.colliders.len()).toBe(colliders);
    } finally {
      course.dispose();
      expect(world.colliders.len()).toBe(0);
      world.free();
    }
  });

  it('rejects an unvalidated candidate before building any of its geometry', () => {
    const world = makeWorld();
    const source = new QueuedSource();
    const course = new Course(world, 19, { source });
    try {
      const valid = new ReachableCourseGenerator(19).next();
      source.deliver({ ...valid, validation: { ...valid.validation, accepted: false, reasons: ['unreachable'] } });
      expect(() => course.update(0)).toThrow('Unvalidated terrain was not published');
      expect(course.chunks).toHaveLength(0);
      expect(course.builtSlabs).toHaveLength(1);
      expect(course.activePickups.size).toBe(0);
    } finally {
      course.dispose();
      expect(world.colliders.len()).toBe(0);
      world.free();
    }
  });
});

describe('fuel pickups', () => {
  it('collecting a pickup refills the tank and consumes it once', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 500 }]);
    try {
      sim.fuel.consume(3, 1);
      expect(sim.fuel.value).toBeCloseTo(2);
      sim.level.activePickups!.set(1, { id: 1, x: 0, y: 1.3, d: sim.distance + 40 });
      let collectedAt = -1;
      const steps = Math.round(3 / sim.dt);
      for (let i = 0; i < steps; i++) {
        sim.step(controls({ accelerate: true }));
        if (collectedAt < 0 && sim.refuelCount === 1) {
          collectedAt = i;
          expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity, 5);
        }
      }
      expect(collectedAt).toBeGreaterThanOrEqual(0);
      // Holding acceleration keeps spending fuel after the one-time refill.
      const afterPickupSeconds = (steps - collectedAt - 1) * sim.dt;
      expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - afterPickupSeconds * CONFIG.thrusters.boostFuelRate, 5);
      expect(sim.refuelCount).toBe(1);
      expect(sim.level.activePickups!.size).toBe(0);
    } finally { sim.dispose(); }
  });

  it('is not collected when the car passes far from it', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 500 }]);
    try {
      sim.level.activePickups!.set(1, { id: 1, x: 0, y: 8.7, d: sim.distance + 40 });
      run(sim, 3, { accelerate: true });
      expect(sim.refuelCount).toBe(0);
    } finally { sim.dispose(); }
  });

  it('does not tunnel through a pickup at maximum forward speed', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 2000 }]);
    try {
      run(sim, 4.5, { accelerate: true });
      sim.level.activePickups!.set(1, { id: 1, x: 0, y: 1.3, d: sim.distance + 30 });
      run(sim, 1.5, { accelerate: true });
      expect(sim.refuelCount).toBe(1);
    } finally { sim.dispose(); }
  });
});
