import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import {
  CHUNK, CourseGenerator, difficultyAt, gapLimits, transitionFuelCost,
} from '../src/game/course/generator';
import { Course, STREAM } from '../src/game/course/course';
import { initPhysics } from '../src/game/simulation';
import { SURFACES } from '../src/game/surfaces';
import { CONFIG } from '../src/game/config';
import { makeSim, run } from './helpers';

const KM = 1000;

function gen(seed: number, metres = 6 * KM) {
  const g = new CourseGenerator(seed);
  g.generateUntil(metres / CHUNK);
  return g;
}

describe('CourseGenerator', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = gen(123), b = gen(123), c = gen(124);
    expect(a.route).toEqual(b.route);
    expect(a.pickups).toEqual(b.pickups);
    for (const s of SURFACES) expect([...a.lanes[s]].sort()).toEqual([...b.lanes[s]].sort());
    expect(c.route).not.toEqual(a.route);
  });

  it('starts with the spec scenario: floor, then ceiling, then a side wall', () => {
    const g = gen(1, KM);
    expect(g.route[0].surface).toBe('floor');
    expect(g.route[0].start * CHUNK).toBeLessThanOrEqual(-10); // car spawns on it at d=10
    expect(g.route[1].surface).toBe('ceiling');
    expect(['left', 'right']).toContain(g.route[2].surface);
    // ceiling begins before the floor ends (reachable), wall begins before the ceiling ends
    expect(g.route[1].start).toBeLessThan(g.route[0].end);
    expect(g.route[2].start).toBeLessThan(g.route[1].end);
    // Section 1 is plain floor: nothing but floor for the first 100 m
    for (let c = 0; c < 100 / CHUNK; c++) {
      expect(g.has('floor', c)).toBe(true);
      expect(g.has('ceiling', c) || g.has('left', c) || g.has('right', c)).toBe(false);
    }
  });

  it('every transition respects the feasibility gap limits for its difficulty', () => {
    for (const seed of [1, 2, 3, 99, 2024]) {
      const g = gen(seed, 10 * KM);
      for (let i = 4; i < g.route.length; i++) {
        const a = g.route[i - 1], b = g.route[i];
        const gapM = (b.start - a.end) * CHUNK;
        const lim = gapLimits(a.surface, b.surface, difficultyAt(a.end * CHUNK));
        expect(gapM).toBeGreaterThanOrEqual(lim.min - CHUNK);
        expect(gapM).toBeLessThanOrEqual(lim.max + CHUNK / 2 + 0.001);
        expect(b.end).toBeGreaterThan(a.end); // always progresses forward
        expect(b.start).toBeGreaterThan(a.start);
      }
    }
  });

  it('places fuel pickups so the estimated fuel need between pickups never exceeds the tank', () => {
    for (const seed of [1, 2, 3, 99, 2024, 777]) {
      const g = gen(seed, 10 * KM);
      let used = 0;
      let pi = 0;
      const pickups = [...g.pickups].sort((x, y) => x.d - y.d);
      for (let i = 1; i < g.route.length; i++) {
        const a = g.route[i - 1], b = g.route[i];
        const transitionAt = Math.min(a.end, b.start) * CHUNK;
        while (pi < pickups.length && pickups[pi].d <= transitionAt) {
          used = 0;
          pi++;
        }
        used += transitionFuelCost(a.surface, b.surface, (b.start - a.end) * CHUNK);
        expect(used).toBeLessThanOrEqual(CONFIG.fuel.capacity * 0.9);
      }
    }
  });

  it('pickups sit on a route surface that exists at that point', () => {
    const g = gen(5, 8 * KM);
    for (const p of g.pickups) expect(g.has(p.surface, Math.floor(p.d / CHUNK))).toBe(true);
  });

  it('all four surfaces appear and disappear independently (many combinations occur)', () => {
    const g = gen(42, 15 * KM);
    const combos = new Map<string, number>();
    const toggles: Record<string, number> = { floor: 0, ceiling: 0, left: 0, right: 0 };
    let prev: Record<string, boolean> | null = null;
    for (let c = 0; c < (15 * KM) / CHUNK - 200; c++) {
      const cur = Object.fromEntries(SURFACES.map((s) => [s, g.has(s, c)])) as Record<string, boolean>;
      const key = SURFACES.filter((s) => cur[s]).join('+') || 'none';
      combos.set(key, (combos.get(key) ?? 0) + 1);
      if (prev) for (const s of SURFACES) if (prev[s] !== cur[s]) toggles[s]++;
      prev = cur;
    }
    for (const s of SURFACES) expect(toggles[s]).toBeGreaterThan(20);
    // Spec examples: only floor, only ceiling, right wall + ceiling, both walls without floor, all four, flight gaps
    expect(combos.get('floor')).toBeGreaterThan(0);
    expect(combos.get('ceiling')).toBeGreaterThan(0);
    expect(combos.get('ceiling+right')).toBeGreaterThan(0);
    expect(combos.get('left+right')).toBeGreaterThan(0);
    expect(combos.get('floor+ceiling+left+right')).toBeGreaterThan(0);
    expect(combos.get('none')).toBeGreaterThan(0);
    expect(combos.size).toBeGreaterThanOrEqual(12);
  });

  it('difficulty ramps up: later sections have shorter pieces and larger gaps', () => {
    const lens: number[][] = [[], []], gaps: number[][] = [[], []];
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = gen(seed, 9 * KM);
      for (let i = 4; i < g.route.length; i++) {
        const d = g.route[i].start * CHUNK;
        const bucket = d < 1500 ? 0 : d > 5000 ? 1 : -1;
        if (bucket < 0) continue;
        lens[bucket].push(g.route[i].end - g.route[i].start);
        gaps[bucket].push(g.route[i].start - g.route[i - 1].end);
      }
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(lens[1])).toBeLessThan(avg(lens[0]) * 0.8);
    expect(avg(gaps[1])).toBeGreaterThan(avg(gaps[0]) + 1);
    expect(difficultyAt(0)).toBe(0);
    expect(difficultyAt(100 * KM)).toBe(1);
  });

  it('extends indefinitely', () => {
    const g = gen(9, 50 * KM);
    expect(g.lastPiece.end * CHUNK).toBeGreaterThan(50 * KM);
  });
});

describe('Course streaming', () => {
  it('builds slabs ahead, removes slabs behind, and stays bounded', async () => {
    await initPhysics();
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const course = new Course(world, 7);
    let maxActive = 0;
    for (let d = 0; d <= 8 * KM; d += 10) {
      course.update(d);
      const slabs = course.builtSlabs;
      maxActive = Math.max(maxActive, slabs.length);
      for (const s of slabs) {
        expect(s.d1).toBeGreaterThanOrEqual(d - STREAM.keepBehind);
        expect(s.d0).toBeLessThanOrEqual(d + STREAM.buildAhead);
      }
      // whatever the generator says exists in the next 300 m is physically built
      for (let c = Math.ceil(d / CHUNK) + 1; c < (d + 300) / CHUNK; c++) {
        for (const surf of SURFACES) {
          const built = slabs.some((s) => s.surface === surf && s.d0 <= c * CHUNK && s.d1 >= (c + 1) * CHUNK);
          expect(built).toBe(course.generator.has(surf, c));
        }
      }
      expect(world.colliders.len()).toBeGreaterThanOrEqual(slabs.length); // lead piece (+ box) per slab
    }
    expect(maxActive).toBeLessThan(80);
    world.free();
  });

  it('never overlaps two slabs on the same surface', async () => {
    await initPhysics();
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const course = new Course(world, 11);
    for (let d = 0; d <= 5 * KM; d += 25) {
      course.update(d);
      const slabs = course.builtSlabs;
      for (const a of slabs) for (const b of slabs) {
        if (a.id !== b.id && a.surface === b.surface) expect(a.d1 <= b.d0 || b.d1 <= a.d0).toBe(true);
      }
    }
    world.free();
  });

  it('does not create a slab where the car currently is', async () => {
    await initPhysics();
    const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    const course = new Course(world, 3);
    // Pretend the car is lodged inside where every future floor slab would be.
    let inside = true;
    course.carBounds = () => (inside
      ? { min: { x: -50, y: -2, z: -1e6 }, max: { x: 50, y: -0.2, z: 1e6 } }
      : { min: { x: 0, y: 3, z: 0 }, max: { x: 1, y: 4, z: 1 } });
    const before = course.builtSlabs.filter((s) => s.surface === 'floor').length;
    course.update(1500);
    expect(course.builtSlabs.filter((s) => s.surface === 'floor' && s.d0 > 1000).length).toBe(0);
    inside = false;
    course.update(1500);
    expect(course.builtSlabs.filter((s) => s.surface === 'floor').length).toBeGreaterThan(0);
    expect(before).toBeGreaterThanOrEqual(0);
    world.free();
  });
});

describe('fuel pickups', () => {
  it('collecting a pickup refills the tank; it is consumed once', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 500 }]);
    sim.fuel.consume(3, 1); // burn fuel first
    expect(sim.fuel.value).toBeCloseTo(2);
    const level = sim.level as unknown as { activePickups: Map<number, unknown> };
    level.activePickups.set(1, { id: 1, x: 0, y: 1.3, d: sim.distance + 40 });
    run(sim, 3, { accelerate: true });
    expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity, 5);
    expect(sim.refuelCount).toBe(1);
    expect(level.activePickups.size).toBe(0);
  });

  it('is not collected when the car passes far from it', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 500 }]);
    const level = sim.level as unknown as { activePickups: Map<number, unknown> };
    level.activePickups.set(1, { id: 1, x: 0, y: 8.7, d: sim.distance + 40 });
    run(sim, 3, { accelerate: true });
    expect(sim.refuelCount).toBe(0);
  });

  it('does not tunnel through a pickup at boost speed (swept test)', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 2000 }]);
    run(sim, 3, { accelerate: true });
    run(sim, 1.5, { accelerate: true, forwardThrust: true });
    const level = sim.level as unknown as { activePickups: Map<number, unknown> };
    level.activePickups.set(1, { id: 1, x: 0, y: 1.3, d: sim.distance + 30 });
    run(sim, 1.5, { accelerate: true });
    expect(sim.refuelCount).toBe(1);
  });
});
