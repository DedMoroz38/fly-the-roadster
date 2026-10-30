import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Rng } from '../src/core/rng';
import { Course } from '../src/game/course/course';
import { difficultyAt, GENERATOR_CONFIG, paceFor } from '../src/game/course/generatorConfig';
import { PLANNER_CONFIG } from '../src/game/course/plannerConfig';
import { chunkTiming } from '../src/game/course/planner';
import { ReachableCourseGenerator } from '../src/game/course/routeGenerator';
import { CONFIG } from '../src/game/config';
import { initPhysics, Simulation } from '../src/game/simulation';
import { StaticLevel } from '../src/game/physics/level';
import { emptyControls } from '../src/game/input';

beforeAll(initPhysics);

describe('opening challenge pacing', () => {
  for (const seed of [1, 42, 233]) {
    it(`seed ${seed}: reaches the first recorded action within 200 m and 9 seconds`, () => {
      const sim = new Simulation({ createLevel: world => new Course(world, seed) });
      const course = sim.level as Course;
      const intro = course.chunks[0];
      try {
        expect(intro.kind).toBe('normal');
        expect(intro.d1).toBeGreaterThanOrEqual(PLANNER_CONFIG.introMin);
        expect(intro.d1).toBeLessThanOrEqual(PLANNER_CONFIG.introMax);
        expect(intro.pickups).toHaveLength(1);
        expect(intro.validation.accepted).toBe(true);
        expect(intro.validation.seconds).toBeLessThan(8);
        for (const chunk of course.chunks.slice(1, 3)) {
          expect(chunk.kind).not.toBe('normal');
          expect(chunk.generation.fallback).toBe(false);
          expect(chunk.validation.accepted).toBe(true);
          expect(chunk.validation.minReactionSeconds).toBeGreaterThanOrEqual(chunkTiming(chunk.difficulty).reaction);
          expect(chunk.validation.timingTolerance).toBe(PLANNER_CONFIG.timingTolerance);
          expect(chunk.exit.fuel).toBeGreaterThanOrEqual(PLANNER_CONFIG.exitFuelReserve);
        }
        let firstAction: { chunk: number; distance: number; seconds: number } | undefined;
        for (let id = 0; id <= GENERATOR_CONFIG.openingChallengeChunks && !firstAction; id++) {
          const chunk = course.chunks.find(c => c.id === id)!;
          for (const control of chunk.witness.controls) {
            if (Object.values(control).some(Boolean)) {
              firstAction = { chunk: id, distance: sim.distance, seconds: sim.time };
              break;
            }
            sim.step(control);
          }
        }
        expect(firstAction).toBeDefined();
        expect(firstAction!.chunk).toBe(1);
        expect(firstAction!.distance).toBeLessThan(200);
        expect(firstAction!.seconds).toBeLessThan(9);
        expect(sim.refuelCount).toBeGreaterThanOrEqual(2);
      } finally { sim.dispose(); }
    }, 30000);
  }

  it('keeps the first two challenges even when optional recovery is selected, then restores full recovery', () => {
    const chance = vi.spyOn(Rng.prototype, 'chance').mockReturnValue(true);
    try {
      const generator = new ReachableCourseGenerator(42);
      const chunks = Array.from({ length: 5 }, () => generator.next());
      expect(chunks.map(c => c.kind === 'normal')).toEqual([true, false, false, true, true]);
      for (const chunk of chunks) {
        expect(chunk.validation.accepted).toBe(true);
        expect(chunk.generation.fallback).toBe(false);
      }
      const fullRecoveryLength = PLANNER_CONFIG.leadMin + CONFIG.car.maxForwardSpeed * PLANNER_CONFIG.recoverySeconds;
      for (const chunk of chunks.slice(3)) expect(chunk.d1 - chunk.d0).toBeGreaterThanOrEqual(fullRecoveryLength);
      const forcedNormal = new ReachableCourseGenerator(42, { template: 'normal' }).next();
      expect(forcedNormal.d1).toBeGreaterThanOrEqual(fullRecoveryLength);
      expect(forcedNormal.validation.accepted).toBe(true);
    } finally { chance.mockRestore(); }
  }, 30000);

  it('keeps plain floor within two thirds of certified route time, with floor sections run as slaloms', () => {
    const generator = new ReachableCourseGenerator(42);
    const time: Record<string, number> = {};
    let samples = 0, centreBlocks = 0;
    while (generator.frontier < 3000) {
      const chunk = generator.next();
      expect(chunk.validation.accepted).toBe(true);
      for (const p of chunk.route) {
        const key = p.surface === 'floor' ? (p.phase.startsWith('slalom') ? 'slalom' : 'floor') : p.surface === null ? 'air' : 'surface';
        time[key] = (time[key] ?? 0) + 1;
        samples++;
      }
      // Slalom routes vacate the centre, so obstacles there force steering.
      centreBlocks += chunk.obstacles.filter(o => Math.abs(o.y - o.half.y) < 1e-9 && Math.abs(o.x) < 2 && o.half.x < CONFIG.corridor.halfWidth).length;
    }
    // Wall/ceiling suction overheats in ~4 s, so surface runs are short and floor time sits near 60%.
    expect(((time.floor ?? 0) + (time.slalom ?? 0)) / samples).toBeLessThan(0.68);
    expect((time.surface ?? 0) / samples).toBeGreaterThan(0.15);
    expect(((time.surface ?? 0) + (time.air ?? 0)) / samples).toBeGreaterThan(0.3);
    expect(time.slalom ?? 0).toBeGreaterThan(0);
    expect(centreBlocks).toBeGreaterThan(0);
  }, 120000);

  it('ramps difficulty quickly and keeps it climbing well past the first kilometre', () => {
    expect(difficultyAt(0)).toBe(0);
    expect(difficultyAt(200)).toBeGreaterThan(0.38);
    expect(difficultyAt(200)).toBeLessThan(0.46);
    expect(difficultyAt(5000) - difficultyAt(1000)).toBeGreaterThan(0.18);
    const distances = [0, 100, 500, 999, 1000, 1001, 2000, 5000, 1000000];
    for (let i = 1; i < distances.length; i++) {
      expect(difficultyAt(distances[i])).toBeGreaterThan(difficultyAt(distances[i - 1]));
      expect(difficultyAt(distances[i])).toBeLessThanOrEqual(1);
    }
    expect(difficultyAt(1001) - difficultyAt(999)).toBeLessThan(0.001);
  });

  it('raises cruise speed with difficulty and drives each chunk at its own validated pace', () => {
    expect(paceFor(0)).toEqual({ cruise: CONFIG.car.cruiseSpeed, max: CONFIG.car.maxForwardSpeed });
    expect(paceFor(1).cruise).toBe(CONFIG.car.cruiseSpeed + GENERATOR_CONFIG.speedGain);
    expect(paceFor(1).max - paceFor(1).cruise).toBe(CONFIG.car.maxForwardSpeed - CONFIG.car.cruiseSpeed);
    const chunks = new ReachableCourseGenerator(42).generateUntil(3000);
    expect(chunks[0].pace.cruise).toBe(CONFIG.car.cruiseSpeed);
    expect(chunks.at(-1)!.pace.cruise).toBeGreaterThan(CONFIG.car.cruiseSpeed + 9);
    for (const chunk of chunks) {
      expect(chunk.validation.accepted).toBe(true);
      expect(chunk.generation.fallback).toBe(false);
    }
    // The course reports each chunk's pace, and the simulation drives the car toward it.
    const course = new Simulation({ createLevel: world => new Course(world, 42) });
    try {
      const chunk = (course.level as Course).chunks[2];
      expect(course.level.paceAt!((chunk.d0 + chunk.d1) / 2)).toEqual(chunk.pace);
    } finally { course.dispose(); }
    const pace = paceFor(1);
    const sim = new Simulation({ createLevel: world => {
      const level = new StaticLevel(world, [{ surface: 'floor', d0: -20, d1: 2000 }]);
      level.paceAt = () => pace;
      return level;
    } });
    try {
      for (let i = 0; i < 6 * 60; i++) sim.step(emptyControls());
      expect(sim.vehicle.forwardSpeed).toBeCloseTo(pace.cruise, 1);
    } finally { sim.dispose(); }
  }, 120000);
});
