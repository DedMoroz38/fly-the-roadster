import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Rng } from '../src/core/rng';
import { Course } from '../src/game/course/course';
import { difficultyAt, GENERATOR_CONFIG } from '../src/game/course/generatorConfig';
import { PLANNER_CONFIG } from '../src/game/course/plannerConfig';
import { ReachableCourseGenerator } from '../src/game/course/routeGenerator';
import { CONFIG } from '../src/game/config';
import { initPhysics, Simulation } from '../src/game/simulation';

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
          expect(chunk.validation.minReactionSeconds).toBeGreaterThanOrEqual(PLANNER_CONFIG.reactionSeconds);
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

  it('raises opening difficulty by 50% and continues increasing after the first kilometre', () => {
    expect(difficultyAt(0)).toBe(0);
    for (const distance of [100, 250, 500, 1000]) {
      const previousLog = Math.log1p(distance / GENERATOR_CONFIG.difficultyScale);
      const previousDifficulty = previousLog / (previousLog + GENERATOR_CONFIG.difficultyCurve);
      expect(difficultyAt(distance)).toBeCloseTo(previousDifficulty * 1.5, 8);
    }
    const distances = [0, 100, 500, 999, 1000, 1001, 2000, 5000, 1000000];
    for (let i = 1; i < distances.length; i++) {
      expect(difficultyAt(distances[i])).toBeGreaterThan(difficultyAt(distances[i - 1]));
      expect(difficultyAt(distances[i])).toBeLessThan(1);
    }
    expect(difficultyAt(1001) - difficultyAt(999)).toBeLessThan(0.001);
  });
});
