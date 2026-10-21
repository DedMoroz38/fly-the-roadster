import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { RouteWaypoint } from '../src/game/course/planner';
import type { Level, SlabSet } from '../src/game/physics/level';
import { CameraRig } from '../src/render/cameraRig';
import { CourseRouteView, ObstacleView } from '../src/render/gameRenderer';
import { PickupView } from '../src/render/pickupView';
import { SurfaceView } from '../src/render/surfaceView';

describe('floating-origin rendering', () => {
  const origin = 1_000_000_000;

  it('preserves fractional route and slab geometry before Float32 conversion', () => {
    const route = new CourseRouteView();
    const point: RouteWaypoint = { d: origin + 10.125, x: 0, y: 0.35, roll: 0, forward: 24, fuel: 5, heat: 0, surface: 'floor', phase: 'drive' };
    const source = { version: 1, routeWaypoints: [point, { ...point, d: origin + 10.25 }] };
    route.sync(source, true, origin);
    const positions = route.line.geometry.getAttribute('position');
    expect(positions.getZ(0)).toBe(-10.125);
    expect(positions.getZ(1)).toBe(-10.25);
    route.sync(source, true, origin + 256);
    expect(route.line.geometry.getAttribute('position').getZ(0)).toBe(245.875);

    const surfaces = new SurfaceView();
    const slab = { id: 1, surface: 'floor' as const, d0: origin + 10.125, d1: origin + 30.375 };
    const slabs = { version: 1, active: new Map([[1, slab]]) } as SlabSet;
    surfaces.sync(slabs, origin);
    const holder = surfaces.group.children[0];
    const hull = holder.userData.ownGeometry as THREE.BufferGeometry;
    hull.computeBoundingBox();
    expect(hull.boundingBox!.min.z).toBe(-20.25);
    expect(hull.boundingBox!.max.z).toBeCloseTo(0, 8);
    expect(holder.position.z).toBe(-10.125);
    surfaces.sync(slabs, origin + 256);
    expect(surfaces.group.children[0]).toBe(holder);
    expect(holder.userData.ownGeometry).toBe(hull);
    expect(holder.position.z).toBe(245.875);
    route.dispose(); surfaces.dispose();
  });

  it('moves live hazards, pickups and collection bursts together when the origin shifts', () => {
    const obstacles = new ObstacleView();
    const hazard = { id: 1, x: 3, y: 1, d: origin + 20.125, half: { x: 1, y: 1, z: 1 } };
    const source = { version: 1, active: new Map([[1, hazard]]) };
    obstacles.sync(source, origin);
    expect(obstacles.group.children[0].position.z).toBe(-20.125);
    const obstacle = obstacles.group.children[0];
    obstacles.sync(source, origin + 256);
    expect(obstacles.group.children[0]).toBe(obstacle);
    expect(obstacle.position.z).toBe(235.875);

    const pickups = new PickupView();
    const pickup = { id: 1, x: 0, y: 1, d: origin + 20.125 };
    const level = { activePickups: new Map([[1, pickup]]) } as unknown as Level;
    pickups.sync(level, pickup.d, origin);
    expect(pickups.group.children[0].position.z).toBe(-20.125);
    pickups.sync(level, pickup.d, origin + 256);
    expect(pickups.group.children[0].position.z).toBe(235.875);
    level.activePickups!.delete(1);
    pickups.sync(level, pickup.d, origin + 256);
    const burst = pickups.group.children[0];
    expect(burst.position.z).toBe(235.875);
    pickups.sync(level, pickup.d, origin + 512);
    expect(pickups.group.children[0]).toBe(burst);
    expect(burst.position.z).toBe(491.875);
    pickups.dispose(); obstacles.dispose();
  });

  it('preserves camera smoothing and orientation across an origin shift', () => {
    const beforeCamera = new THREE.PerspectiveCamera();
    const afterCamera = new THREE.PerspectiveCamera();
    const before = new CameraRig(beforeCamera), after = new CameraRig(afterCamera);
    for (let i = 0; i < 30; i++) {
      const car = { x: 2, y: 3, z: -240 - i * 0.4 };
      before.update(car, 1 / 60); after.update(car, 1 / 60);
    }
    const oldQuaternion = afterCamera.quaternion.clone();
    const oldPosition = afterCamera.position.clone();
    after.rebase(256);
    expect(afterCamera.position.z).toBe(oldPosition.z + 256);
    expect(afterCamera.quaternion.equals(oldQuaternion)).toBe(true);
    before.update({ x: 2.2, y: 3.1, z: -253 }, 1 / 60);
    after.update({ x: 2.2, y: 3.1, z: 3 }, 1 / 60);
    expect(afterCamera.position.z - beforeCamera.position.z).toBeCloseTo(256, 8);
    expect(afterCamera.position.x).toBeCloseTo(beforeCamera.position.x, 8);
    expect(afterCamera.position.y).toBeCloseTo(beforeCamera.position.y, 8);
    expect(Math.abs(afterCamera.quaternion.dot(beforeCamera.quaternion))).toBeCloseTo(1, 8);
  });
});
