import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { Course } from '../src/game/course/course';
import { SynchronousChunkSource } from '../src/game/course/chunkSource';
import { difficultyAt, paceFor } from '../src/game/course/generatorConfig';
import { ReachableCourseGenerator, type GeneratedChunk } from '../src/game/course/routeGenerator';
import { buildGroup, FLIGHT_COURSE, flightRoute, flightStartAfter, planGroups, planZone } from '../src/game/course/flight';
import { initPhysics, Simulation } from '../src/game/simulation';
import { FailureMonitor } from '../src/game/session';
import { FlightPilot, type FlightPath } from './flight-helpers';

beforeAll(initPhysics);

const SEEDS = [1, 42, 233, 2804205951];

/** Sections as the generator laid them out: contiguous runs of flight chunks. */
function sections(chunks: GeneratedChunk[]) {
  const out: GeneratedChunk[][] = [];
  for (const chunk of chunks) {
    if (chunk.kind !== 'fly') continue;
    const last = out.at(-1);
    if (last && last.at(-1)!.d1 === chunk.d0) last.push(chunk); else out.push([chunk]);
  }
  return out;
}

describe('flight schedule', () => {
  // Generating 20 km validates every ordinary chunk with real physics, so this takes a while.
  it('first flies at about 6000 m (±500, up to one chunk late) for about 2000 m, then again after about 6000 m of driving', { timeout: 150_000 }, () => {
    for (const seed of [42, 2804205951]) {
      const generator = new ReachableCourseGenerator(seed);
      generator.generateUntil(19500);
      const found = sections(generator.chunks);
      expect(found.length).toBeGreaterThanOrEqual(2);
      expect(found[0][0].d0).toBeGreaterThanOrEqual(FLIGHT_COURSE.firstAt - FLIGHT_COURSE.startJitter);
      expect(found[0][0].d0).toBeLessThan(FLIGHT_COURSE.firstAt + FLIGHT_COURSE.startJitter + 1200);
      found.forEach((section, i) => {
        const length = section.at(-1)!.d1 - section[0].d0;
        expect(length).toBeGreaterThanOrEqual(FLIGHT_COURSE.length - FLIGHT_COURSE.lengthJitter - FLIGHT_COURSE.chunkLength / 2);
        expect(length).toBeLessThanOrEqual(FLIGHT_COURSE.length + FLIGHT_COURSE.lengthJitter + FLIGHT_COURSE.chunkLength / 2);
        if (i > 0) {
          const drive = section[0].d0 - found[i - 1].at(-1)!.d1;
          expect(drive).toBeGreaterThanOrEqual(FLIGHT_COURSE.gap - FLIGHT_COURSE.startJitter);
          expect(drive).toBeLessThan(FLIGHT_COURSE.gap + FLIGHT_COURSE.startJitter + 1200);
        }
      });
    }
  });

  it('never flies before the first start, and drives ordinary chunks in between', () => {
    const generator = new ReachableCourseGenerator(42);
    generator.generateUntil(20000);
    const first = sections(generator.chunks)[0][0].d0;
    for (const chunk of generator.chunks) if (chunk.d0 < first) expect(chunk.kind).not.toBe('fly');
    expect(generator.chunks.filter(c => c.kind !== 'fly').length).toBeGreaterThan(20);
  });

  it('is seeded: the same seed gives the same sections, and a delayed start is deterministic', () => {
    const a = new ReachableCourseGenerator(5, { flightAt: 300 }), b = new ReachableCourseGenerator(5, { flightAt: 300 });
    a.generateUntil(3500); b.generateUntil(3500);
    expect(sections(a.chunks).map(s => [s[0].d0, s.at(-1)!.d1])).toEqual(sections(b.chunks).map(s => [s[0].d0, s.at(-1)!.d1]));
    expect(flightStartAfter(5, 0, 0)).toBe(flightStartAfter(5, 0, 0));
    expect(flightStartAfter(5, 1, 8000)).not.toBe(flightStartAfter(6, 1, 8000));
  });

  it('can be started early for demos and tests, and is off under a forced template unless asked', () => {
    const early = new ReachableCourseGenerator(3, { flightAt: 500 });
    early.generateUntil(4000);
    expect(sections(early.chunks)[0][0].d0).toBeGreaterThanOrEqual(500);
    expect(sections(early.chunks)[0][0].d0).toBeLessThan(1500);
    const forced = new ReachableCourseGenerator(3, { template: 'gap' });
    forced.generateUntil(8000);
    expect(forced.chunks.some(c => c.kind === 'fly')).toBe(false);
  });
});

describe('flight chunks', () => {
  let generator: ReachableCourseGenerator, section: GeneratedChunk[], zone: ReturnType<typeof planZone>;
  beforeAll(() => {
    generator = new ReachableCourseGenerator(42, { flightAt: 200 });
    generator.generateUntil(5000);
    section = sections(generator.chunks)[0];
    zone = planZone(42, 0, section[0].d0);
  });

  it('are contiguous, accepted and carry a flight stretch with no pickups', () => {
    for (let i = 1; i < generator.chunks.length; i++) expect(generator.chunks[i].d0).toBe(generator.chunks[i - 1].d1);
    for (const chunk of section) {
      expect(chunk.validation.accepted).toBe(true);
      expect(chunk.pickups).toHaveLength(0);
      expect(chunk.flight).toBeDefined();
      expect(chunk.d1 - chunk.d0).toBeLessThanOrEqual(FLIGHT_COURSE.chunkLength);
    }
    expect(section[0].flight!.from).toBe(zone.from);
    expect(section.at(-1)!.flight!.to).toBe(zone.end);
  });

  it('keep a floor for take-off and for landing, and nothing else', () => {
    const slabs = section.flatMap(c => c.slabs);
    expect(slabs).toHaveLength(2);
    expect(slabs[0]).toMatchObject({ surface: 'floor', d0: zone.start, d1: zone.from, bevel: false });
    expect(slabs[1]).toMatchObject({ surface: 'floor', d0: zone.to, d1: zone.end, bevel: true });
    expect(zone.to - zone.from).toBeGreaterThan(1200);
  });

  it('hand the next ordinary chunk a centred floor state to start from', () => {
    const last = section.at(-1)!;
    expect(last.exit.surface).toBe('floor');
    expect(last.exit.x).toBe(0);
    expect(Math.abs(last.exit.roll)).toBe(0);
    expect(last.exit.fuel).toBe(CONFIG.fuel.capacity);
    const next = generator.chunks.find(c => c.d0 === last.d1)!;
    expect(next.kind).not.toBe('fly');
    expect(next.validation.accepted).toBe(true);
    expect(next.slabs.some(s => s.surface === 'floor' && s.d0 === next.d0)).toBe(true);
  });
});

describe('flight route', () => {
  it('starts and ends on the floor, centred, and stays inside the play volume', () => {
    for (const seed of SEEDS) {
      const zone = planZone(seed, 0, 6000), route = flightRoute(seed, zone);
      expect(route(zone.from).x).toBeCloseTo(0, 6);
      expect(route(zone.to).x).toBeCloseTo(0, 6);
      expect(route(zone.from).y).toBeLessThan(1);
      expect(route(zone.to).y).toBeLessThan(1);
      for (let d = zone.from; d <= zone.to; d += 2) {
        const p = route(d);
        expect(Math.abs(p.x)).toBeLessThan(FLIGHT_COURSE.swing.main + FLIGHT_COURSE.swing.second + 0.01);
        expect(p.y).toBeGreaterThan(0.3);
        expect(p.y).toBeLessThan(FLIGHT_COURSE.altitude + FLIGHT_COURSE.swing.rise + 0.5);
      }
    }
  });

  it('bends gently enough for banking to follow it at boosted top speed', () => {
    const v = paceFor(1).max;
    for (const seed of SEEDS) for (let index = 0; index < 4; index++) {
      const zone = planZone(seed, index, 6000), route = flightRoute(seed, zone);
      let ax = 0, ay = 0;
      for (let d = zone.from + 1; d < zone.to - 1; d += 1) {
        const a = route(d - 1), b = route(d), c = route(d + 1);
        ax = Math.max(ax, Math.abs(a.x - 2 * b.x + c.x) * v * v);
        ay = Math.max(ay, Math.abs(a.y - 2 * b.y + c.y) * v * v);
      }
      // Banking at 60° can pull sideways at about 20 m/s² and up/down by about 10; use half of that.
      expect(ax).toBeLessThan(10);
      expect(ay).toBeLessThan(5.5);
    }
  });
});

describe('flight obstacles', () => {
  const difficulty = difficultyAt(6000);
  /** Smallest gap between the route (with the car's size) and any box, over the box's depth. */
  function clearance(box: { x: number; y: number; d: number; half: { x: number; y: number; z: number } }, route: FlightPath) {
    let best = Infinity;
    for (let d = box.d - box.half.z - 3; d <= box.d + box.half.z + 3; d += 0.5) {
      const p = route(d);
      const dx = Math.max(Math.abs(p.x - box.x) - box.half.x, 0), dy = Math.max(Math.abs(p.y - box.y) - box.half.y, 0);
      // Inside the box on both axes counts as negative clearance.
      best = Math.min(best, dx === 0 && dy === 0 ? -1 : Math.hypot(dx, dy));
    }
    return best;
  }

  it('leave the route clear by more than the car needs, for every group, seed and difficulty', () => {
    const half = CONFIG.car.halfExtents;
    const need = Math.hypot(half.x, half.y) + 1.2; // banked car plus room to be a little off the line
    for (const seed of SEEDS) for (const k of [0, 0.5, 1]) {
      const zone = planZone(seed, 0, 6000), route = flightRoute(seed, zone);
      for (const g of planGroups(seed, zone, () => k)) {
        const boxes = buildGroup(g.group, g.d, g.seed, route, k);
        expect(boxes.length).toBeGreaterThan(0);
        for (const box of boxes) {
          const gap = clearance(box, route);
          expect(gap, `${g.group} at ${g.d.toFixed(0)}`).toBeGreaterThan(need);
        }
      }
    }
  });

  it('close the whole play volume around every wall, so nothing can be flown around', () => {
    const zone = planZone(42, 0, 6000), route = flightRoute(42, zone), box = CONFIG.flight.bounds;
    const rings = planGroups(42, zone, () => difficulty).filter(g => g.group === 'ring');
    expect(rings.length).toBeGreaterThan(3);
    for (const ring of rings) {
      const parts = buildGroup('ring', ring.d, ring.seed, route, difficulty);
      expect(parts).toHaveLength(4);
      const left = Math.min(...parts.map(p => p.x - p.half.x)), right = Math.max(...parts.map(p => p.x + p.half.x));
      const bottom = Math.min(...parts.map(p => p.y - p.half.y)), top = Math.max(...parts.map(p => p.y + p.half.y));
      expect(left).toBeLessThan(-box.halfWidth);
      expect(right).toBeGreaterThan(box.halfWidth);
      expect(bottom).toBeLessThan(box.minY);
      expect(top).toBeGreaterThan(box.maxY);
    }
  });

  it('are spaced far enough apart to react, and nothing sits on the launch or landing strips', () => {
    for (const seed of SEEDS) {
      const zone = planZone(seed, 0, 6000);
      const groups = planGroups(seed, zone, d => difficultyAt(d));
      expect(groups.length).toBeGreaterThan(20);
      for (let i = 1; i < groups.length; i++) expect(groups[i].d - groups[i - 1].d).toBeGreaterThan(FLIGHT_COURSE.spacing.hard - 8);
      expect(groups[0].d).toBeGreaterThanOrEqual(zone.from + FLIGHT_COURSE.leadIn);
      expect(groups.at(-1)!.d).toBeLessThan(zone.to - FLIGHT_COURSE.leadOut + 1);
      expect(new Set(groups.map(g => g.group)).size).toBe(4);
    }
  });
});

describe('flying a whole section', () => {
  /** Streams the real course and flies it with the pilot: take-off, the section, landing and a bit of road after. */
  function flyThrough(seed: number, flightAt: number, gain = { p: 2.2, d: 2.6 }) {
    const source = new SynchronousChunkSource(seed, { flightAt });
    const sim = new Simulation({ createLevel: world => new Course(world, seed, { source }) });
    const course = sim.level as Course;
    const monitor = new FailureMonitor();
    const first = source.generator.chunks.find(c => c.kind === 'fly')!;
    const zone = planZone(seed, 0, first.d0);
    const route = flightRoute(seed, zone);
    const pilot = new FlightPilot(d => (d < zone.from ? { x: 0, y: 0.7 } : route(d)), gain, zone.from + 300);
    let flew = 0, failure: string | null = null, maxBank = 0, landed = false;
    // Start on the launch strip, as a player who has driven the road before it would arrive.
    sim.vehicle.body.setTranslation({ x: 0, y: 0.37, z: -(zone.start - 20) }, true);
    sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -CONFIG.car.cruiseSpeed }, true);
    // Stop where the road starts again: the ordinary chunk after it has obstacles this pilot would not steer around.
    while (sim.distance < zone.end + 2) {
      course.update(sim.distance);
      const flying = sim.vehicle.flying;
      let c = pilot.step(sim);
      // On the road the pilot only holds its lane; just before the floor ends it lifts off.
      if (sim.distance < zone.from - 8) c = { ...c, thrust: false, rollLeft: false, rollRight: false };
      else if (sim.distance < zone.from) c = { ...c, thrust: true, rollLeft: false, rollRight: false };
      sim.step(c);
      failure = monitor.check(sim);
      if (failure) break;
      if (flying) flew++;
      maxBank = Math.max(maxBank, Math.abs(sim.vehicle.roll));
      if (sim.distance > zone.to + 20 && sim.vehicle.mode === 'grounded') landed = true;
    }
    return { failure, flew, maxBank, landed, distance: sim.distance, zone, pilot, mode: sim.vehicle.mode, fuel: sim.fuel.fraction };
  }

  for (const [seed, flightAt] of [[1, 150], [42, 300], [233, 150]] as const) {
    it(`seed ${seed}: an autopilot with the player's inputs flies the whole section and lands`, () => {
      const r = flyThrough(seed, flightAt);
      expect(r.failure).toBeNull();
      expect(r.distance).toBeGreaterThanOrEqual(r.zone.end + 1);
      expect(r.flew / CONFIG.physicsHz).toBeGreaterThan(30);
      expect(r.maxBank).toBeLessThan(CONFIG.flight.maxBankDeg * Math.PI / 180 + 0.15);
      expect(r.landed).toBe(true);
      expect(r.mode).toBe('grounded');
      expect(r.pilot.worst.x).toBeLessThan(1.6);
      expect(r.pilot.worst.y).toBeLessThan(1.6);
    });
  }

  it('also works with a sloppier pilot (weaker gains), which is a fairer stand-in for a person', () => {
    const r = flyThrough(7, 200, { p: 1.3, d: 1.8 });
    expect(r.failure).toBeNull();
    expect(r.landed).toBe(true);
    expect(r.pilot.worst.x).toBeLessThan(2.4);
  });

  it('crashes into a ring wall if flown straight ahead without steering', () => {
    const seed = 42, source = new SynchronousChunkSource(seed, { flightAt: 150 });
    const sim = new Simulation({ createLevel: world => new Course(world, seed, { source }) });
    const course = sim.level as Course, monitor = new FailureMonitor();
    const zone = planZone(seed, 0, source.generator.chunks.find(c => c.kind === 'fly')!.d0);
    sim.vehicle.body.setTranslation({ x: 0, y: 0.37, z: -(zone.start - 20) }, true);
    sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -CONFIG.car.cruiseSpeed }, true);
    let failure: string | null = null;
    while (!failure && sim.distance < zone.end) {
      course.update(sim.distance);
      // Lift hard to altitude then hold it with a fixed duty, never banking.
      const climb = sim.vehicle.position.y < FLIGHT_COURSE.altitude && sim.distance > zone.from - 8;
      sim.step({ accelerate: false, thrust: climb, rollLeft: false, rollRight: false, steerLeft: false, steerRight: false, suction: false });
      failure = monitor.check(sim);
    }
    expect(failure).not.toBeNull();
  });
});
