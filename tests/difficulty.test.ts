import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Rng } from '../src/core/rng';
import { CONFIG } from '../src/game/config';
import { decorateChunk, DECORATOR_CONFIG } from '../src/game/course/decorator';
import { GENERATOR_CONFIG } from '../src/game/course/generatorConfig';
import { chunkTiming, initialReachableState, planChunk, type ScenarioKind } from '../src/game/course/planner';
import { PLANNER_CONFIG } from '../src/game/course/plannerConfig';
import { ReachableCourseGenerator } from '../src/game/course/routeGenerator';
import { initPhysics } from '../src/game/simulation';

beforeAll(initPhysics);

const fullWidth = (o: { half: { x: number } }) => o.half.x >= CONFIG.corridor.halfWidth;
const onFloor = (o: { y: number; half: { y: number } }) => Math.abs(o.y - o.half.y) < 1e-9;

describe('difficulty you can feel', () => {
  it('stops forced floor runs once difficulty passes the breather cut-off', () => {
    // No optional easy sections: only forced breathers can produce a floor run after the opening.
    const chance = vi.spyOn(Rng.prototype, 'chance');
    try {
      const generator = new ReachableCourseGenerator(42);
      const chunks = generator.generateUntil(4000);
      const breathers = chunks.filter(c => c.id > 0 && c.id % GENERATOR_CONFIG.recoveryEvery === 0);
      expect(breathers.some(c => c.difficulty >= GENERATOR_CONFIG.recoveryUntil)).toBe(true);
      for (const c of breathers) {
        expect(c.kind === 'normal').toBe(c.difficulty < GENERATOR_CONFIG.recoveryUntil);
      }
    } finally { chance.mockRestore(); }
  }, 120000);

  it('shortens run-ups and recovery with difficulty and certifies chunks against them', () => {
    expect(chunkTiming(0)).toEqual({ reaction: PLANNER_CONFIG.reactionSeconds, recovery: PLANNER_CONFIG.recoverySeconds });
    expect(chunkTiming(1)).toEqual({ reaction: PLANNER_CONFIG.reactionSecondsHardest, recovery: PLANNER_CONFIG.recoverySecondsHardest });
    const easy = planChunk({ id: 1, seed: 77, d0: 0, kind: 'gap', difficulty: 0.05, entry: initialReachableState() });
    const hard = planChunk({ id: 1, seed: 77, d0: 0, kind: 'gap', difficulty: 1, entry: initialReachableState() });
    for (const chunk of [easy, hard]) {
      expect(chunk.validation.reasons).toEqual([]);
      expect(chunk.validation.minReactionSeconds).toBeGreaterThanOrEqual(chunkTiming(chunk.difficulty).reaction);
    }
    // Seconds of route time, independent of the faster pace.
    expect(hard.validation.seconds).toBeLessThan(easy.validation.seconds);
  });

  it('weaves through run-ups instead of driving them straight', () => {
    for (const kind of ['ceiling', 'hurdle', 'gap'] as ScenarioKind[]) {
      const chunk = planChunk({ id: 1, seed: 31, d0: 0, kind, difficulty: 1, entry: { ...initialReachableState(), lastArrival: -400 } });
      expect(chunk.validation.reasons).toEqual([]);
      const firstManeuver = chunk.plan.findIndex(p => p.action !== 'drive');
      expect(chunk.plan.slice(0, firstManeuver).some(p => p.label.startsWith('slalom'))).toBe(true);
    }
  });

  it('puts low full-width barriers inside hard floor runs', () => {
    const runs = [1, 2, 3, 4, 5].map(seed => planChunk({ id: 1, seed, d0: 0, kind: 'normal', difficulty: 1, entry: initialReachableState() }));
    const barriers = runs.flatMap(run => run.obstacles.filter(fullWidth));
    expect(barriers.length).toBeGreaterThan(0);
    for (const run of runs) {
      expect(run.validation.reasons).toEqual([]);
      expect(run.obstacles.filter(fullWidth).length).toBeLessThanOrEqual(PLANNER_CONFIG.floorBarrierMax);
    }
    for (const barrier of barriers) {
      expect(onFloor(barrier)).toBe(true);
      expect(barrier.half.y * 2).toBeLessThanOrEqual(PLANNER_CONFIG.floorBarrierHeight.max + 1e-9);
    }
  });

  it('adds gates with one opening where the certified route passes, only on harder chunks', () => {
    const gatePieces = (kind: ScenarioKind, difficulty: number) => {
      const chunk = decorateChunk(planChunk({ id: 1, seed: 217, d0: 0, kind, difficulty, entry: initialReachableState() }));
      expect(chunk.validation.accepted).toBe(true);
      return { chunk, pieces: chunk.obstacles.filter(o => onFloor(o) && !fullWidth(o) && o.half.z === DECORATOR_CONFIG.gateHalfLength) };
    };
    expect(gatePieces('wall-left', 0.1).pieces).toHaveLength(0);
    const { chunk, pieces } = gatePieces('wall-left', 1);
    expect(pieces.length).toBeGreaterThan(0);
    for (const piece of pieces) {
      // Each piece reaches a corridor wall; the opening between pieces is where the route drives.
      const edge = CONFIG.corridor.halfWidth;
      expect(Math.min(Math.abs(piece.x - piece.half.x + edge), Math.abs(piece.x + piece.half.x - edge))).toBeLessThan(1e-9);
      const nearby = chunk.route.filter(p => Math.abs(p.d - piece.d) < 1 && p.surface === 'floor');
      for (const p of nearby) expect(Math.abs(p.x - piece.x)).toBeGreaterThan(piece.half.x + CONFIG.car.halfExtents.x);
    }
  });
});
