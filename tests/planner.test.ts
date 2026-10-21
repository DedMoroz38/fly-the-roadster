import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics } from '../src/game/simulation';
import { initialReachableState, planChunk, type ScenarioKind } from '../src/game/course/planner';

beforeAll(initPhysics);
describe('constructive real-physics maneuver planning', () => {
  for (const kind of ['normal', 'gap', 'ceiling', 'wall-left', 'wall-right', 'multiple', 'flight'] as ScenarioKind[]) {
    it(`validates ${kind} with actual fuel, heat and human timing tolerance`, () => {
      const result = planChunk({ id: 0, seed: 123, d0: 0, difficulty: 1, kind, entry: initialReachableState() });
      expect(result.validation.reasons).toEqual([]);
      expect(result.validation.accepted).toBe(true);
      expect(result.validation.replayCount).toBeGreaterThanOrEqual(6);
      expect(result.exit.surface).toBe('floor');
      expect(result.exit.fuel).toBeGreaterThanOrEqual(1);
      expect(result.exit.heat).toBeLessThan(35);
    });
  }
});
