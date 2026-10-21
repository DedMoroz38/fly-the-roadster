import { beforeAll, describe, expect, it, vi } from 'vitest';
import { initPhysics } from '../src/game/simulation';
import { ReachableCourseGenerator, SCENARIOS } from '../src/game/course/routeGenerator';
import { difficultyAt, GENERATOR_CONFIG } from '../src/game/course/generatorConfig';
import { CONFIG } from '../src/game/config';
import * as planner from '../src/game/course/planner';

beforeAll(initPhysics);

describe('constructive seeded course', () => {
  it('reproduces geometry, inputs, resources and exit states exactly from a seed', () => {
    const a = new ReachableCourseGenerator(77), b = new ReachableCourseGenerator(77);
    for (let i = 0; i < 5; i++) expect(a.next()).toEqual(b.next());
    const c = new ReachableCourseGenerator(78);
    expect(c.next()).not.toEqual(a.chunks[0]);
  });

  it('carries the actual reachable exit across chunks and includes periodic recovery', () => {
    const gen = new ReachableCourseGenerator(19);
    for (let i = 0; i < 9; i++) {
      const previous = gen.chunks.at(-1);
      const next = gen.next();
      expect(next.validation.accepted).toBe(true);
      expect(next.generation.fallback).toBe(false);
      expect(next.exit.surface).toBe('floor');
      expect(next.exit.fuel).toBeGreaterThan(1);
      expect(next.exit.heat).toBeLessThan(CONFIG.suction.recoveryHeat);
      if (previous) {
        expect(next.d0).toBe(previous.d1);
        expect(next.entry).toEqual(previous.exit);
      }
      if (i % GENERATOR_CONFIG.recoveryEvery === 0) expect(next.kind).toBe('normal');
    }
  });

  for (const template of SCENARIOS) {
    it(`reproduces the requested ${template} template without disguising fallback`, () => {
      const gen = new ReachableCourseGenerator(42, { template });
      const next = gen.next();
      expect(next.kind).toBe(template);
      expect(next.generation.requested).toBe(template);
      expect(next.generation.fallback).toBe(false);
      expect(next.validation.accepted).toBe(true);
      expect(next.witness.controls.length).toBeGreaterThan(0);
    });
  }

  it('prunes historical plans without altering future random choices or exit compatibility', () => {
    const pruned = new ReachableCourseGenerator(9), retained = new ReachableCourseGenerator(9);
    for (let i = 0; i < 5; i++) { pruned.next(); retained.next(); }
    pruned.forgetBefore(pruned.frontier);
    expect(pruned.chunks.length).toBeLessThanOrEqual(1);
    expect(pruned.next()).toEqual(retained.next());
  });

  it('bounds rejected attempts and validates a recovery floor before publishing it', () => {
    const realPlan = planner.planChunk;
    const spy = vi.spyOn(planner, 'planChunk').mockImplementation(options => {
      const result = realPlan(options);
      return options.kind === 'normal' ? result : {
        ...result, validation: { ...result.validation, accepted: false, reasons: ['injected unreachable candidate'] },
      };
    });
    try {
      const result = new ReachableCourseGenerator(91, { template: 'gap' }).next();
      expect(result.generation.fallback).toBe(true);
      expect(result.generation.attempts).toBe(GENERATOR_CONFIG.candidateAttempts);
      expect(result.generation.rejectedReasons).toContain('injected unreachable candidate');
      expect(result.kind).toBe('normal');
      expect(result.validation.accepted).toBe(true);
      expect(spy).toHaveBeenCalledTimes(GENERATOR_CONFIG.candidateAttempts + 1);
    } finally { spy.mockRestore(); }
  });

  it('raises difficulty smoothly without exceeding the configured capability envelope', () => {
    expect(difficultyAt(0)).toBe(0);
    expect(difficultyAt(-100)).toBe(0);
    let previous = 0;
    for (let distance = 100; distance < 1e7; distance *= 1.15) {
      const d = difficultyAt(distance);
      expect(d).toBeGreaterThan(previous);
      expect(d).toBeLessThan(1);
      expect(d - previous).toBeLessThan(0.08);
      previous = d;
    }
  });
});
