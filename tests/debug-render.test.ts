import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { GameSession, type CourseDebugInfo } from '../src/game/session';
import type { RouteWaypoint } from '../src/game/course/planner';
import { CourseRouteView, ObstacleView } from '../src/render/gameRenderer';
import { PickupView } from '../src/render/pickupView';
import { SurfaceView } from '../src/render/surfaceView';
import type { Level, SlabSet } from '../src/game/physics/level';
import type { Slab } from '../src/game/surfaces';
import { DebugPanel } from '../src/ui/Hud';
import { makeSim } from './helpers';

describe('development route view', () => {
  it('stays opt-in, maps forward distance to -Z and releases superseded geometry', () => {
    const view = new CourseRouteView();
    let reads = 0;
    const point: RouteWaypoint = { d: 50, x: 2, y: 7, roll: 0, forward: 24, fuel: 4, heat: 8, surface: null, phase: 'flight' };
    const source = { version: 1, get routeWaypoints() { reads++; return [point, { ...point, d: 55 }]; } };
    view.sync(source, false);
    expect(view.group.visible).toBe(false);
    expect(reads).toBe(0);
    view.sync(source, true);
    expect(view.group.visible).toBe(true);
    expect([...view.line.geometry.getAttribute('position').array]).toEqual([2, 7, -50, 2, 7, -55]);
    const oldGeometry = view.line.geometry;
    const release = vi.spyOn(oldGeometry, 'dispose');
    view.sync(source, true);
    expect(reads).toBe(1);
    expect(view.line.geometry).toBe(oldGeometry);
    source.version++;
    point.d = 100;
    view.sync(source, false);
    expect(reads).toBe(1);
    view.sync(source, true);
    expect(reads).toBe(2);
    expect(release).toHaveBeenCalledOnce();
    expect(view.line.geometry.getAttribute('position').getZ(0)).toBe(-100);
    view.clear();
    expect(view.group.visible).toBe(false);
    expect(view.line.geometry.getAttribute('position')).toBeUndefined();
    view.dispose();
  });

  it('removes streamed obstacle meshes and clears an old world on restart', () => {
    const view = new ObstacleView();
    const first = { id: 1, x: -4, y: 1, d: 80, half: { x: 0.5, y: 1, z: 2 } };
    const second = { ...first, id: 2, d: 120 };
    const source = { version: 1, active: new Map([[1, first], [2, second]]) };
    view.sync(source);
    expect(view.group.children).toHaveLength(2);
    const mesh = view.group.getObjectByName('obstacle-1')!;
    expect(mesh.position.toArray()).toEqual([-4, 1, -80]);
    expect(mesh.scale.toArray()).toEqual([1, 2, 4]);
    source.active.delete(1);
    source.version++;
    view.sync(source);
    expect(view.group.children).toHaveLength(1);
    expect(mesh.parent).toBeNull();
    const geometry = (view.group.children[0].children[0] as THREE.Mesh).geometry;
    const release = vi.spyOn(geometry, 'dispose');
    view.sync({ version: source.version, active: new Map() });
    expect(view.group.children).toHaveLength(0);
    expect(release).not.toHaveBeenCalled(); // Shared geometry survives ordinary streaming.
    view.dispose();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('renderer resource lifecycle', () => {
  it('discards pickup bursts on restart and disposes shared assets only on final teardown', () => {
    const view = new PickupView();
    const pickup = { id: 1, x: 0, y: 1, d: 50 };
    const level = { activePickups: new Map([[1, pickup]]) } as unknown as Level;
    view.sync(level, 50);
    const coreGeometry = (view.group.children[0].children[0] as THREE.Mesh).geometry;
    const releaseCore = vi.spyOn(coreGeometry, 'dispose');
    level.activePickups!.delete(1);
    view.sync(level, 50);
    expect(view.group.children).toHaveLength(1);
    const burst = view.group.children[0] as THREE.Mesh;
    const releaseBurst = vi.spyOn(burst.material as THREE.Material, 'dispose');
    view.clear();
    expect(view.group.children).toHaveLength(0);
    expect(releaseBurst).toHaveBeenCalledOnce();
    expect(releaseCore).not.toHaveBeenCalled();
    view.update(1);
    expect(releaseBurst).toHaveBeenCalledOnce();
    level.activePickups!.set(1, pickup);
    view.sync(level, 50);
    expect(view.group.children).toHaveLength(1);
    view.dispose();
    expect(view.group.children).toHaveLength(0);
    expect(releaseCore).toHaveBeenCalledOnce();
  });

  it('releases custom slab hulls on clearing and shared slab geometry on final teardown', () => {
    const view = new SurfaceView();
    const slabs: Slab[] = [
      { id: 1, surface: 'floor', d0: 0, d1: 100 },
      { id: 2, surface: 'floor', d0: 100, d1: 200, bevel: false },
    ];
    view.sync({ version: 1, active: new Map(slabs.map(s => [s.id, s])) } as SlabSet);
    const hull = view.group.children[0].userData.ownGeometry as THREE.BufferGeometry;
    const shared = (view.group.children[1].children[0] as THREE.Mesh).geometry;
    const releaseHull = vi.spyOn(hull, 'dispose');
    const releaseShared = vi.spyOn(shared, 'dispose');
    view.clear();
    expect(releaseHull).toHaveBeenCalledOnce();
    expect(releaseShared).not.toHaveBeenCalled();
    view.dispose();
    expect(releaseHull).toHaveBeenCalledOnce();
    expect(releaseShared).toHaveBeenCalledOnce();
  });
});

describe('debug telemetry', () => {
  it('reports actual velocity/resources and retains route cues while debug details are hidden', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 300 }]);
    const session = new GameSession(123, () => sim);
    const debug: CourseDebugInfo = {
      difficulty: 0.45, chunkSeed: 789, chunkId: 3, kind: 'ceiling', validated: true,
      minFuel: 3.8, maxHeat: 15, phase: 'launch toward ceiling', nextAction: 'Roll 180°, then E for suction', frontier: 900,
    };
    Object.assign(sim.level, { debugInfo: () => debug, terrainStatus: 'Preparing road…' });
    sim.vehicle.body.setLinvel({ x: 3, y: 4, z: -12 }, true);
    sim.vehicle.suctionHeat = 42;
    try {
      const hidden = session.snapshot();
      expect(hidden.totalSpeed).toBe(13);
      expect(hidden.forwardVelocity).toBe(12);
      expect(hidden.debug).toEqual(debug);
      expect(hidden.terrainStatus).toBe('Preparing road…');
      expect(renderToStaticMarkup(createElement(DebugPanel, { snapshot: hidden }))).toBe('');
      session.debugEnabled = true;
      const shown = renderToStaticMarkup(createElement(DebugPanel, { snapshot: session.snapshot() }));
      expect(shown).toContain('13.00 / 12.00 m/s');
      expect(shown).toContain('789');
      expect(shown).toContain('42.0 / 100');
      expect(shown).toContain('PASSED');
      expect(shown).toContain('Roll 180°');
    } finally {
      sim.dispose();
    }
  });
});
