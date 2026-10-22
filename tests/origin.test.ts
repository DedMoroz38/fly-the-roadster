import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../src/game/config';
import { emptyControls } from '../src/game/input';
import { StaticLevel } from '../src/game/physics/level';
import { initPhysics, Simulation } from '../src/game/simulation';

beforeAll(initPhysics);
const floorAt = (origin: number, length = 2000) => Array.from({ length: Math.ceil(length / 200) }, (_, i) =>
  ({ surface: 'floor' as const, d0: origin + i * 200, d1: origin + (i + 1) * 200, bevel: i === 0 }));

function runAt(originDistance: number) {
  const sim = new Simulation({ originDistance, createLevel: (w, origin) => new StaticLevel(w, floorAt(origin).map(s => ({ ...s, bevel: false })), [], [], origin) });
  let rebases = 0;
  try {
    for (let i = 0; i < 1800; i++) {
      const before = sim.originDistance;
      sim.step(emptyControls());
      if (before !== sim.originDistance) {
        rebases++;
        expect(Math.abs(sim.pose().z - sim.prevPose.z)).toBeLessThan(0.5);
      }
      expect(Math.abs(sim.vehicle.position.z)).toBeLessThan(CONFIG.origin.rebaseDistance + 1);
      if (i > 120) {
        expect(sim.vehicle.mode).toBe('grounded');
        expect(sim.vehicle.position.y).toBeCloseTo(CONFIG.car.halfExtents.y, 2);
      }
    }
    return { traveled: sim.distance - originDistance, speed: sim.vehicle.forwardSpeed, y: sim.vehicle.position.y, rebases };
  } finally { sim.dispose(); }
}

describe('floating physics origin', () => {
  it('preserves traveled distance and floor contact at 50 km and millions of logical metres', () => {
    const near = runAt(0);
    for (const origin of [50_000, 10_000_000]) {
      const far = runAt(origin);
      expect(far.rebases).toBeGreaterThanOrEqual(2);
      expect(far.traveled).toBeCloseTo(near.traveled, 4);
      expect(far.speed).toBeCloseTo(near.speed, 5);
      expect(far.y).toBeCloseTo(near.y, 5);
    }
  });

  it('changes only coordinates and refreshes probes without stepping or altering momentum', () => {
    const sim = new Simulation({ spawn: { x: 0, y: 0.37, z: -260 }, createLevel: w => new StaticLevel(w,
      [{ surface: 'floor', d0: 250, d1: 280 }], [], [{ id: 1, x: 4, y: 1, d: 270, half: { x: 0.5, y: 1, z: 0.5 } }]) });
    const secondary = sim.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2, 20, -270));
    const secondaryCollider = sim.world.createCollider(RAPIER.ColliderDesc.ball(0.5), secondary);
    secondary.setLinvel({ x: 1, y: 2, z: 3 }, true);
    const kinematic = sim.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(3, 25, -280));
    kinematic.setNextKinematicTranslation({ x: 4, y: 26, z: -290 });
    sim.vehicle.body.setLinvel({ x: 2, y: 3, z: -31 }, true);
    sim.vehicle.body.setAngvel({ x: 0, y: 0, z: 1.2 }, true);
    sim.vehicle.suctionHeat = 22;
    sim.fuel.consume(1, 0.4);
    const before = { velocity: sim.vehicle.body.linvel(), angular: sim.vehicle.body.angvel(), rotation: sim.vehicle.body.rotation(), distance: sim.distance,
      fuel: sim.fuel.value, heat: sim.vehicle.suctionHeat, time: sim.time };
    try {
      expect(sim.rebaseOrigin()).toBe(256);
      expect(sim.originDistance).toBe(256);
      expect(sim.vehicle.position.z).toBe(-4);
      expect(sim.distance).toBe(before.distance);
      expect(sim.vehicle.body.linvel()).toEqual(before.velocity);
      expect(sim.vehicle.body.angvel()).toEqual(before.angular);
      expect(sim.vehicle.body.rotation()).toEqual(before.rotation);
      expect(sim.fuel.value).toBe(before.fuel);
      expect(sim.vehicle.suctionHeat).toBe(before.heat);
      expect(sim.time).toBe(before.time);
      expect(secondary.translation().z).toBe(-14);
      expect(secondaryCollider.translation().z).toBe(-14);
      expect(secondary.linvel()).toEqual({ x: 1, y: 2, z: 3 });
      expect(kinematic.translation().z).toBe(-24);
      expect(kinematic.nextTranslation().z).toBe(-34);
      const probe = sim.vehicle.probeSurface(CONFIG.suction.range);
      expect(probe?.surface).toBe('floor');
      expect(probe?.gap).toBeCloseTo(0.02, 4);
      expect(sim.rebaseOrigin()).toBe(0);
    } finally { sim.dispose(); }
  });

  it('collects global pickups correctly across a rebase without sweeping across unrelated pickups', () => {
    const originDistance = 2_000_000;
    const sim = new Simulation({ originDistance, spawn: { x: 0, y: 0.37, z: -254.4 },
      createLevel: (w, origin) => new StaticLevel(w, floorAt(origin).map(s => ({ ...s, bevel: false })), [
        { x: 0, y: 0.8, d: origin + 259.2 }, { x: 0, y: 0.8, d: origin + 600 },
      ], [], origin) });
    sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -24 }, true);
    sim.fuel.consume(1, 4);
    try {
      for (let i = 0; i < 30; i++) sim.step(emptyControls());
      expect(sim.originDistance).toBe(originDistance + 256);
      expect(sim.refuelCount).toBe(1);
      expect(sim.fuel.value).toBe(CONFIG.fuel.capacity);
      expect(sim.level.activePickups?.size).toBe(1);
      expect(sim.distance).toBeCloseTo(originDistance + 266.4, 2);
    } finally { sim.dispose(); }
  });

  it('places new slabs and obstacles in the current local frame after rebasing', () => {
    const sim = new Simulation({ spawn: { x: 0, y: 0.37, z: -260 },
      createLevel: w => new StaticLevel(w, [{ surface: 'floor', d0: 250, d1: 270 }]) });
    try {
      sim.rebaseOrigin();
      sim.level.slabs.add({ id: 100, surface: 'floor', d0: 270, d1: 320, bevel: false });
      sim.level.obstacles!.add({ id: 101, x: 4, y: 1, d: 300, half: { x: 1, y: 1, z: 1 } });
      sim.vehicle.body.setTranslation({ x: 0, y: 0.37, z: -24 }, true);
      expect(sim.vehicle.probeSurface(CONFIG.suction.range)?.surface).toBe('floor');
      let obstacleZ: number | undefined;
      sim.world.forEachCollider(c => { if (!c.parent() && c.translation().x === 4) obstacleZ = c.translation().z; });
      expect(obstacleZ).toBe(-44);
      expect(sim.level.slabs.active.get(100)?.d0).toBe(270);
      expect(sim.level.obstacles!.active.get(101)?.d).toBe(300);
    } finally { sim.dispose(); }
  });

  it('maintains ceiling suction through repeated origin changes', () => {
    const sim = new Simulation({ spawn: { x: 0, y: 9.65, z: -250 },
      createLevel: w => new StaticLevel(w, [{ surface: 'ceiling', d0: 0, d1: 1600 }]) });
    sim.vehicle.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -24 }, true);
    try {
      for (let i = 0; i < 1200; i++) {
        // Heat limits are covered elsewhere; keep suction cool so the hold spans two rebases.
        sim.vehicle.suctionHeat = 0;
        sim.step({ ...emptyControls(), suction: true });
        if (i > 10) {
          expect(sim.vehicle.mode).toBe('attached');
          expect(sim.vehicle.supportSurface).toBe('ceiling');
        }
      }
      expect(sim.originDistance).toBeGreaterThanOrEqual(512);
      expect(sim.vehicle.suctionOverheated).toBe(false);
      expect(sim.vehicle.suctionHeat).toBeCloseTo(CONFIG.suction.heatRate / 60, 4);
      expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - 20 * CONFIG.suction.fuelRate, 4);
    } finally { sim.dispose(); }
  });
});
