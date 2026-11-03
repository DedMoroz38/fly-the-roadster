import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config';
import { vehicleWorld } from '../src/render/vehicles';
import { WORLDS } from '../src/render/worlds';
import { EARTH, EARTH_ROUTES, horizonDip, routeOrientation } from '../src/render/orbit/earth';
import { ShowSchedule, showPosition, SHOW_KINDS, SHOW_PATHS, SHOW_TIMING } from '../src/render/orbit/show';
import { SPACE_MODELS } from '../src/render/orbit/spaceProps';

describe('orbit world', () => {
  it('is the Roadster world', () => {
    expect(vehicleWorld('roadster')).toBe('orbit');
    expect(WORLDS.orbit.id).toBe('orbit');
  });

  it('puts each route under the track, heading along its bearing', () => {
    for (const route of EARTH_ROUTES) {
      const q = routeOrientation(route.lat, route.lon, route.bearing);
      const φ = THREE.MathUtils.degToRad(route.lat), λ = THREE.MathUtils.degToRad(route.lon);
      const place = new THREE.Vector3(Math.cos(λ) * Math.cos(φ), Math.sin(φ), -Math.sin(λ) * Math.cos(φ));
      expect(place.clone().applyQuaternion(q).distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-9);
      // North of the place lies ahead and to the left or right according to the bearing.
      const north = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      const ahead = new THREE.Vector3(0, 0, -1);
      expect(north.clone().projectOnPlane(new THREE.Vector3(0, 1, 0)).normalize().dot(ahead)).toBeCloseTo(Math.cos(THREE.MathUtils.degToRad(route.bearing)), 6);
    }
  });

  it('keeps Earth far below play and its horizon low but in view', () => {
    expect(EARTH.altitude).toBeGreaterThan(CONFIG.fail.outsideMargin * 5);
    const dip = THREE.MathUtils.radToDeg(horizonDip());
    expect(dip).toBeGreaterThan(6);
    expect(dip).toBeLessThan(16);
  });
});

describe('space show', () => {
  it('alternates 500–700 m appearances with 200–700 m gaps, starting with a gap', () => {
    for (const seed of [1, 42, 233]) {
      const events = new ShowSchedule(seed).first(60);
      expect(events[0].start).toBeGreaterThanOrEqual(SHOW_TIMING.gap.min);
      expect(events[0].start).toBeLessThanOrEqual(SHOW_TIMING.gap.max);
      events.forEach((e, i) => {
        expect(e.length).toBeGreaterThanOrEqual(SHOW_TIMING.visible.min);
        expect(e.length).toBeLessThanOrEqual(SHOW_TIMING.visible.max);
        if (i === 0) return;
        const gap = e.start - (events[i - 1].start + events[i - 1].length);
        expect(gap).toBeGreaterThanOrEqual(SHOW_TIMING.gap.min);
        expect(gap).toBeLessThanOrEqual(SHOW_TIMING.gap.max);
      });
    }
  });

  it('shows every kind once before any repeats, never the same twice in a row, the same for a seed', () => {
    const events = new ShowSchedule(42).first(SHOW_KINDS.length * 6);
    for (let bag = 0; bag < 6; bag++) {
      const kinds = events.slice(bag * SHOW_KINDS.length, (bag + 1) * SHOW_KINDS.length).map(e => e.kind);
      expect(new Set(kinds).size).toBe(SHOW_KINDS.length);
    }
    for (let i = 1; i < events.length; i++) expect(events[i].kind).not.toBe(events[i - 1].kind);
    expect(new ShowSchedule(42).first(20)).toEqual(new ShowSchedule(42).first(20));
  });

  it('reports the appearance under way at any distance, and nothing in the gaps', () => {
    const schedule = new ShowSchedule(7);
    const events = new ShowSchedule(7).first(5);
    for (const e of events) {
      const mid = schedule.at(e.start + e.length / 2)!;
      expect(mid.event.kind).toBe(e.kind);
      expect(mid.progress).toBeCloseTo(0.5, 6);
      expect(schedule.at(e.start + e.length + 1)).toBeNull();
    }
    // Restarting a run (distance going back to zero) replays the same show.
    expect(schedule.at(events[0].start + 10)!.event).toEqual(events[0]);
  });

  /** Camera looks down the track: about ±51° across and −40° to +30° vertically at 16:9. */
  const inView = (p: THREE.Vector3) => {
    if (p.z >= -1) return false;
    const across = Math.atan2(Math.abs(p.x), -p.z), up = Math.atan2(p.y - 4, Math.hypot(p.x, p.z));
    return across < THREE.MathUtils.degToRad(51) && up < THREE.MathUtils.degToRad(30) && up > THREE.MathUtils.degToRad(-40);
  };

  /** Out of view, or so far away (60 times its size) that it is only a speck. */
  const unseen = (kind: (typeof SHOW_KINDS)[number], p: THREE.Vector3) =>
    !inView(p) || p.distanceTo(new THREE.Vector3(0, 4, 0)) > 60 * SPACE_MODELS[kind].size;

  it('enters and leaves unseen, stays in view most of the way, and never touches the track', () => {
    const { halfWidth: W, height: H } = CONFIG.corridor;
    for (const kind of SHOW_KINDS) {
      expect(unseen(kind, showPosition(kind, 0)), kind).toBe(true);
      expect(unseen(kind, showPosition(kind, 1)), kind).toBe(true);
      let visible = 0;
      for (let i = 0; i <= 100; i++) {
        const p = showPosition(kind, i / 100);
        if (inView(p)) visible++;
        // Clear of the corridor (walls at |x| = W, ceiling top at H + 1) by more than the object's own reach.
        const gap = Math.hypot(Math.max(0, Math.abs(p.x) - W), Math.max(0, p.y - (H + 1), -p.y));
        const model = kind === 'wall-e' ? 'wall-e' : kind;
        expect(gap, `${kind} at ${i}%`).toBeGreaterThan(SPACE_MODELS[model].size / 2 + 1);
      }
      expect(visible, kind).toBeGreaterThanOrEqual(60);
    }
    expect(Object.keys(SHOW_PATHS).sort()).toEqual([...SHOW_KINDS].sort());
    // Much closer than before: every object passes within 200 m of the camera.
    for (const kind of SHOW_KINDS) {
      const nearest = Math.min(...Array.from({ length: 101 }, (_, i) => showPosition(kind, i / 100).distanceTo(new THREE.Vector3(0, 4, 0))));
      expect(nearest, kind).toBeLessThan(200);
    }
  });
});

describe('WALL-E and EVE', () => {
  it('overtake the car: straight along the road from behind the camera to far ahead', () => {
    const start = showPosition('wall-e', 0), end = showPosition('wall-e', 1);
    expect(start.z).toBeGreaterThan(0);
    expect(end.z).toBeLessThan(-600);
    for (let i = 0; i <= 50; i++) {
      const p = showPosition('wall-e', i / 50);
      expect(p.x).toBeCloseTo(start.x, 6);
      expect(p.y).toBeCloseTo(start.y, 6);
      if (i) expect(p.z).toBeLessThan(showPosition('wall-e', (i - 1) / 50).z);
    }
    // Seen from the camera (about 4.5 m up on the centre line) he passes beside the ceiling, not through it.
    const yAtWall = 4.5 + (start.y - 4.5) * CONFIG.corridor.halfWidth / Math.abs(start.x);
    expect(yAtWall).toBeLessThan(CONFIG.corridor.height);
  });
});
