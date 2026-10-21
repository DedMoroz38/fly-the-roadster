import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { initPhysics, Simulation } from '../src/game/simulation';
import { SlabSet, StaticLevel } from '../src/game/physics/level';
import { emptyControls } from '../src/game/input';
import { CONFIG } from '../src/game/config';
import { SURFACES, SURFACE_NORMAL } from '../src/game/surfaces';

beforeAll(initPhysics);
function trace(offset: number) {
  const boundaries = [0, 351.68926365006, 486.2501, 800];
  const sim = new Simulation({ originDistance: offset, spawn: { x: 0, y: 0.37, z: -20 }, createLevel: (world, origin) => new StaticLevel(world,
    boundaries.slice(1).map((end, i) => ({ surface: 'floor', d0: offset + boundaries[i], d1: offset + end, bevel: i === 0 })), [], [], origin) });
  const ys: number[] = [], velocities: number[] = [];
  try {
    for (let i = 0; i < 60 * 26; i++) {
      sim.step(emptyControls());
      if (i > 120) { ys.push(sim.vehicle.position.y); velocities.push(sim.vehicle.body.linvel().y); }
    }
    const ray = new RAPIER.Ray({ x: 0, y: 5, z: sim.originDistance - (offset + 300) }, { x: 0, y: -1, z: 0 });
    const hit = sim.world.castRayAndGetNormal(ray, 10, true, undefined, undefined, sim.vehicle.collider);
    return { minY: Math.min(...ys), maxY: Math.max(...ys), maxVy: Math.max(...velocities.map(Math.abs)),
      floorHeight: hit ? 5 - hit.timeOfImpact : NaN, distance: sim.distance - offset, speed: sim.vehicle.forwardSpeed };
  } finally { sim.dispose(); }
}
describe('terrain collider precision far from the origin', () => {
  it('keeps floor plane and seam contact stable at 6 km and 50 km', () => {
    const near = trace(0);
    for (const offset of [6000, 50000]) {
      const far = trace(offset);
      expect(far.floorHeight).toBeCloseTo(0, 3);
      expect(far.maxY - far.minY).toBeLessThan(0.08);
      expect(Math.abs(far.maxY - near.maxY)).toBeLessThan(0.03);
      expect(far.maxVy).toBeLessThan(0.6);
      expect(far.speed).toBeCloseTo(CONFIG.car.cruiseSpeed, 1);
    }
  });

  it('lands across a continued slab without a vertical collision lip at any tested distance', () => {
    for (const offset of [0, 6000, 50000]) {
      const join = offset + 100.68926365006;
      const sim = new Simulation({ originDistance: offset, spawn: { x: 0.071, y: 0.6, z: -(join - offset - 3) },
        createLevel: (world, origin) => new StaticLevel(world, [
          { surface: 'floor', d0: offset, d1: join, bevel: true },
          { surface: 'floor', d0: join, d1: join + 100, bevel: false },
        ], [], [], origin) });
      sim.vehicle.body.setLinvel({ x: 0, y: -2, z: -24 }, true);
      let maxUpwardSpeed = 0, maxHeight = 0;
      try {
        for (let i = 0; i < 120; i++) {
          sim.step(emptyControls());
          maxUpwardSpeed = Math.max(maxUpwardSpeed, sim.vehicle.body.linvel().y);
          maxHeight = Math.max(maxHeight, sim.vehicle.position.y);
        }
        expect(maxUpwardSpeed).toBeLessThan(0.1);
        expect(maxHeight).toBeLessThan(0.6);
        expect(sim.vehicle.mode).toBe('grounded');
        expect(sim.vehicle.position.y).toBeCloseTo(CONFIG.car.halfExtents.y, 2);
      } finally { sim.dispose(); }
    }
  });

});

describe('continuous physical surface runs', () => {
  it('preserves all four inner planes in a long thin run without convex-hull face loss', () => {
    for (const surface of SURFACES) {
      const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
      const slabs = new SlabSet(world);
      try {
        slabs.add({ id: 1, surface, d0: 0, d1: 300, bevel: true });
        slabs.add({ id: 2, surface, d0: 300, d1: 2000, bevel: false });
        expect(slabs.active.size).toBe(2);
        expect(slabs.colliderCount).toBe(1);
        world.step();
        const n = SURFACE_NORMAL[surface];
        for (const d of [100, 299.9, 300.1, 900, 1900]) {
          const ray = new RAPIER.Ray({ x: 0, y: CONFIG.corridor.height / 2, z: -d }, { x: -n.x, y: -n.y, z: 0 });
          const hit = world.castRayAndGetNormal(ray, 20, true);
          expect(hit).not.toBeNull();
          // Keep ray error well below the vehicle's contact-gap tolerance across the full run.
          expect(Math.abs(hit!.timeOfImpact - (n.x ? CONFIG.corridor.halfWidth : CONFIG.corridor.height / 2))).toBeLessThan(0.005);
          expect(hit!.normal.x * n.x + hit!.normal.y * n.y).toBeGreaterThan(0.9999);
          expect(slabs.surfaceOf(hit!.collider.handle)).toBe(surface);
        }
      } finally { slabs.clear(); expect(world.colliders.len()).toBe(0); world.free(); }
    }
  });

  it('splits and rejoins physical runs when logical slabs are removed or added', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const slabs = new SlabSet(world);
    const middle = { id: 2, surface: 'floor' as const, d0: 100, d1: 200, bevel: false };
    try {
      slabs.add({ id: 1, surface: 'floor', d0: 0, d1: 100, bevel: false });
      slabs.add(middle);
      slabs.add({ id: 3, surface: 'floor', d0: 200, d1: 300, bevel: false });
      expect(slabs.colliderCount).toBe(1);
      expect(slabs.active.get(2)).toEqual(middle);
      slabs.remove(2);
      world.step();
      expect(slabs.colliderCount).toBe(2);
      expect(world.colliders.len()).toBe(2);
      expect(world.castRay(new RAPIER.Ray({ x: 0, y: 5, z: -150 }, { x: 0, y: -1, z: 0 }), 10, true)).toBeNull();
      slabs.add(middle);
      world.step();
      expect(slabs.colliderCount).toBe(1);
      expect(world.castRay(new RAPIER.Ray({ x: 0, y: 5, z: -150 }, { x: 0, y: -1, z: 0 }), 10, true)?.timeOfImpact).toBeCloseTo(5, 4);
    } finally { slabs.clear(); expect(world.colliders.len()).toBe(0); world.free(); }
  });

  it('keeps a partially exposed overlapping ramp instead of filling its geometry', () => {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    const slabs = new SlabSet(world);
    try {
      slabs.add({ id: 1, surface: 'floor', d0: 0, d1: 10, bevel: false });
      slabs.add({ id: 2, surface: 'floor', d0: 9, d1: 20, bevel: true });
      world.step();
      expect(slabs.colliderCount).toBe(2);
      const hit = world.castRay(new RAPIER.Ray({ x: 0, y: 5, z: -10.5 }, { x: 0, y: -1, z: 0 }), 10, true);
      expect(hit?.timeOfImpact).toBeCloseTo(5 + CONFIG.corridor.slabThickness / 2, 3);
    } finally { slabs.clear(); world.free(); }
  });
});
