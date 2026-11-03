import { beforeAll, describe, expect, it } from 'vitest';
import { Course } from '../src/game/course/course';
import { SynchronousChunkSource } from '../src/game/course/chunkSource';
import { FLIGHT_WARNING, flightCueAt, LANDING_WARNING } from '../src/game/course/flight';
import { initPhysics, Simulation } from '../src/game/simulation';
import { GameSession } from '../src/game/session';
import { controls } from './helpers';
import { cameraGoal } from '../src/render/cameraRig';
import { flightMessage } from '../src/ui/Hud';
import { CONFIG } from '../src/game/config';

beforeAll(initPhysics);

const zone = { start: 1000, from: 1090, to: 2800, end: 3000 };

describe('flight cues', () => {
  it('warn ahead, call the take-off, then flying, then the landing, then nothing', () => {
    expect(flightCueAt(zone, zone.start - FLIGHT_WARNING - 1)).toBeNull();
    expect(flightCueAt(zone, zone.start - 300)).toEqual({ phase: 'approach', metres: 300 });
    expect(flightCueAt(zone, zone.start + 10)).toEqual({ phase: 'takeoff', metres: 80 });
    expect(flightCueAt(zone, zone.from)?.phase).toBe('flying');
    expect(flightCueAt(zone, 2000)?.phase).toBe('flying');
    expect(flightCueAt(zone, zone.to - LANDING_WARNING + 1)).toEqual({ phase: 'landing', metres: LANDING_WARNING - 1 });
    expect(flightCueAt(zone, zone.to + 50)).toEqual({ phase: 'landing', metres: 0 });
    expect(flightCueAt(zone, zone.end)).toBeNull();
  });

  it('become short messages for the HUD, with touch wording on phones', () => {
    expect(flightMessage(null, false, false)).toBeNull();
    expect(flightMessage({ phase: 'approach', metres: 304 }, false, false)!.text).toContain('300 m');
    expect(flightMessage({ phase: 'takeoff', metres: 40 }, false, false)!.text).toContain('Space');
    expect(flightMessage({ phase: 'takeoff', metres: 40 }, false, true)!.text).toContain('LIFT');
    expect(flightMessage({ phase: 'flying', metres: 900 }, true, false)!.label).toContain('UNLIMITED FUEL');
    expect(flightMessage({ phase: 'landing', metres: 200 }, true, false)!.label).toBe('LAND');
    expect(flightMessage({ phase: 'landing', metres: 0 }, false, false)).toBeNull();
  });
});

describe('flight camera', () => {
  it('follows above and behind a car that is far outside the corridor, instead of clamping into it', () => {
    const car = { x: 14, y: 30, z: -500 };
    const driving = cameraGoal(car), flying = cameraGoal(car, true);
    expect(driving.position.y).toBeLessThanOrEqual(CONFIG.corridor.height);
    expect(flying.position.y).toBeGreaterThan(car.y);
    expect(flying.position.z).toBeGreaterThan(car.z);
    expect(flying.lookAt.z).toBeLessThan(car.z);
    expect(Math.abs(flying.position.x - car.x)).toBeLessThan(6);
  });
});

describe('flight in a session', () => {
  it('reports flying and the cue, and keeps fuel full through a section', () => {
    const seed = 42, source = new SynchronousChunkSource(seed, { flightAt: 150 });
    const session = new GameSession(seed, () => new Simulation({ createLevel: world => new Course(world, seed, { source }) }));
    const course = session.sim.level as Course;
    const zoneChunk = course.chunks.find(c => c.kind === 'fly')!;
    const z = zoneChunk.flight!.zone;
    expect(course.flightAt(z.from - 1)).toBe(false);
    expect(course.flightAt(z.from)).toBe(true);
    expect(course.flightCue(z.start - 100)).toEqual({ phase: 'approach', metres: 100 });
    session.startRun();
    session.sim.vehicle.body.setTranslation({ x: 0, y: 14, z: -(z.from + 10) }, true);
    session.sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -CONFIG.car.cruiseSpeed }, true);
    course.update(z.from + 10);
    session.step(controls({ thrust: true }));
    const snap = session.snapshot();
    expect(snap.flying).toBe(true);
    expect(snap.fuel).toBe(1);
    expect(snap.flightCue?.phase).toBe('flying');
    // Stream the end of the section too (the course only keeps what is near the car).
    course.update(z.to - 50);
    expect(course.flightAt(z.to)).toBe(true);
    expect(course.flightAt(z.end - 1)).toBe(true);
    expect(course.flightAt(z.end)).toBe(false);
  });
});
