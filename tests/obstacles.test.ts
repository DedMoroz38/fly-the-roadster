import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, Simulation } from '../src/game/simulation';
import { ObstacleSet, StaticLevel } from '../src/game/physics/level';
import { emptyControls } from '../src/game/input';
import { initialReachableState, planChunk, validatePlan, type ScenarioKind } from '../src/game/course/planner';
import { decorateChunk } from '../src/game/course/decorator';
import { FailureMonitor } from '../src/game/session';
import { CONFIG } from '../src/game/config';
import type { SurfaceType } from '../src/game/surfaces';

beforeAll(initPhysics);
describe('solid obstacle lifecycle', () => {
  it('adds and removes real colliders without duplicate allocation', () => {
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const obstacles = new ObstacleSet(world);
    const obstacle = { id: 1, x: 0, y: 1, d: 40, half: { x: 2, y: 1, z: 1 } };
    obstacles.add(obstacle); obstacles.add(obstacle);
    expect(world.colliders.len()).toBe(1);
    expect(obstacles.version).toBe(1);
    obstacles.remove(1);
    expect(world.colliders.len()).toBe(0);
    expect(obstacles.active.size).toBe(0);
    obstacles.add(obstacle); obstacles.clear();
    expect(world.colliders.len()).toBe(0);
    world.free();
  });
  it('a direct head-on impact triggers the actual game crash rule', () => {
    const sim = new Simulation({ createLevel: w => new StaticLevel(w, [{ surface: 'floor', d0: -20, d1: 200 }], [],
      [{ id: 1, x: 0, y: 2, d: 55, half: { x: 3, y: 2, z: 1 } }]) });
    const monitor = new FailureMonitor(); let failed = null;
    for (let i = 0; i < 300 && !failed; i++) { sim.step(emptyControls()); failed = monitor.check(sim); }
    expect(failed).toBe('crashed');
    sim.dispose();
  });
});
describe('certified procedural decoration', () => {
  for (const kind of ['normal', 'gap', 'ceiling', 'wall-left', 'wall-right', 'multiple', 'flight'] as ScenarioKind[]) {
    it(`keeps ${kind} physically feasible after adding optional geometry`, () => {
      const base = planChunk({ id: 0, seed: 217, d0: 0, kind, difficulty: 1, entry: initialReachableState() });
      const decorated = decorateChunk(base);
      expect(decorated.validation.reasons).toEqual([]);
      expect(decorated.slabs.length).toBeGreaterThan(base.slabs.length);
      expect(decorated.obstacles.length).toBeGreaterThan(0);
      expect(decorated.exit.surface).toBe('floor');
      if (kind === 'flight' || kind === 'gap') {
        const floors = base.slabs.filter(s => s.surface === 'floor');
        const from = floors[0].d1, to = floors[1].d0;
        expect(decorated.slabs.some(s => s.d0 < to && s.d1 > from)).toBe(false);
        expect(decorated.obstacles.some(o => o.d - o.half.z < to && o.d + o.half.z > from)).toBe(false);
      }
    });
  }
  it('mounts certified obstacles flush on floors, ceilings and both walls, including the opening road', () => {
    const { halfWidth, height } = CONFIG.corridor;
    const mountedOn = (o: { x: number; y: number; half: { x: number; y: number } }): SurfaceType | null =>
      Math.abs(o.y - o.half.y) < 1e-9 ? 'floor' : Math.abs(o.y + o.half.y - height) < 1e-9 ? 'ceiling'
        : Math.abs(o.x - o.half.x + halfWidth) < 1e-9 ? 'left' : Math.abs(o.x + o.half.x - halfWidth) < 1e-9 ? 'right' : null;
    const seen = new Set<SurfaceType>();
    const opening = decorateChunk(planChunk({ id: 0, seed: 5, d0: 0, kind: 'normal', difficulty: 0, entry: initialReachableState(), intro: true }));
    expect(opening.validation.accepted).toBe(true);
    expect(opening.obstacles.some(o => mountedOn(o) === 'floor')).toBe(true);
    for (const kind of ['multiple', 'wall-left', 'wall-right'] as ScenarioKind[]) {
      const chunk = decorateChunk(planChunk({ id: 1, seed: 217, d0: 0, kind, difficulty: 1, entry: initialReachableState() }));
      expect(chunk.validation.accepted).toBe(true);
      for (const o of chunk.obstacles) {
        const surface = mountedOn(o);
        expect(surface).not.toBeNull();
        // Every obstacle sits on real geometry of the surface it is mounted to.
        expect(chunk.slabs.some(s => s.surface === surface && s.d0 <= o.d - o.half.z && s.d1 >= o.d + o.half.z)).toBe(true);
        seen.add(surface!);
      }
    }
    expect([...seen].sort()).toEqual(['ceiling', 'floor', 'left', 'right']);
  });
  it('rejects a solid barrier through the certified route', () => {
    const chunk = planChunk({ id: 0, seed: 217, d0: 0, kind: 'normal', difficulty: 0, entry: initialReachableState() });
    chunk.obstacles.push({ id: 99, x: 0, y: 5, d: 90, half: { x: 6, y: 5, z: 1 } });
    const validation = validatePlan(chunk);
    expect(validation.accepted).toBe(false);
    expect(validation.reasons.some(reason => reason.includes('crashed'))).toBe(true);
  });
  it('reproduces decorated geometry and certified exit from the same seed', () => {
    const base = planChunk({ id: 0, seed: 13, d0: 5000, kind: 'multiple', difficulty: 0.5, entry: initialReachableState() });
    expect(decorateChunk(base)).toEqual(decorateChunk(base));
  });
});
