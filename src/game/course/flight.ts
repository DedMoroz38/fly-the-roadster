import { CONFIG } from '../config';
import { hashSeed, Rng } from '../../core/rng';
import type { ObstacleLike } from '../physics/level';
import type { Slab } from '../surfaces';
import { paceFor, type Pace } from './generatorConfig';
import { initialReachableState, type PlannedChunk, type ReachableState, type RouteWaypoint } from './planner';

/**
 * Flying sections: after about 6000 m of driving the floor, walls and ceiling disappear for about
 * 2000 m, and the road is a field of objects to fly around. Then the floor comes back, and 6000 m
 * of driving later it happens again. Distances are metres of travel, which equal points but for
 * flip bonuses.
 */
export const FLIGHT_COURSE = {
  firstAt: 6000,
  /** Added to every start (± this); 500 m is about 15 s of flying. */
  startJitter: 500,
  /** Driving between the end of one section and the start of the next. */
  gap: 6000,
  length: 2000,
  lengthJitter: 150,
  /** Flight is generated in pieces this long, so obstacles stream in like everything else. */
  chunkLength: 250,
  /** Floor kept at the start, so the car has road to take off from; the floor ends here. */
  launch: 90,
  /** Floor that returns at the end, to land on; it runs into the next ordinary chunk. */
  landing: 200,
  /** The route climbs from the floor over this distance after take-off... */
  climb: 300,
  /** ...and descends to the floor over this distance before the landing strip. */
  descent: 320,
  altitude: 14,
  /** Sideways and vertical swing of the route, which obstacles are built around. */
  swing: { main: 4.2, second: 1.6, rise: 1.8 },
  /** Opening of a ring wall at difficulty 0 and 1: half-width × half-height. */
  opening: { easy: { x: 4.2, y: 3.6 }, hard: { x: 3.6, y: 3.1 } },
  /** Distance between obstacle groups at difficulty 0 and 1. */
  spacing: { easy: 84, hard: 58 },
  /** First group this far into the flight and the last this far before the landing. */
  leadIn: 130,
  leadOut: 90,
} as const;

/** What a player should be told about the flying section that is near, in metres of road to the next event. */
export type FlightCue =
  | { phase: 'approach'; metres: number }
  | { phase: 'takeoff'; metres: number }
  | { phase: 'flying'; metres: number }
  | { phase: 'landing'; metres: number };

/** How far ahead of a section the approach warning starts. */
export const FLIGHT_WARNING = 500;
/** How far before the landing strip the "land now" call starts. */
export const LANDING_WARNING = 420;

/** The cue at a distance, given a section's bounds (null when no section is near). */
export function flightCueAt(zone: Pick<FlightZone, 'start' | 'from' | 'to' | 'end'>, distance: number): FlightCue | null {
  if (distance < zone.start - FLIGHT_WARNING || distance >= zone.end) return null;
  if (distance < zone.start) return { phase: 'approach', metres: zone.start - distance };
  if (distance < zone.from) return { phase: 'takeoff', metres: zone.from - distance };
  if (distance < zone.to - LANDING_WARNING) return { phase: 'flying', metres: zone.to - distance };
  if (distance < zone.to) return { phase: 'landing', metres: zone.to - distance };
  return { phase: 'landing', metres: 0 };
}

/** One flying section: all distances are logical, and `from`/`to` bound the part without a floor. */
export interface FlightZone {
  index: number;
  /** Where the first flight chunk starts (the launch strip begins here). */
  start: number;
  /** Where the last flight chunk ends (the landing strip's end). */
  end: number;
  /** First metre without a floor, and the first metre of the landing strip. */
  from: number;
  to: number;
}

/** Where the k-th section would start if nothing delayed it; the generator rounds up to a chunk boundary. */
export function flightStartAfter(seed: number, index: number, previousEnd: number): number {
  const rng = new Rng(hashSeed(`${seed >>> 0}:flight-start:${index}`));
  const base = index === 0 ? FLIGHT_COURSE.firstAt : previousEnd + FLIGHT_COURSE.gap;
  return base + rng.range(-FLIGHT_COURSE.startJitter, FLIGHT_COURSE.startJitter);
}

/** The section that begins with a chunk starting at `start`. Its length is a whole number of chunks. */
export function planZone(seed: number, index: number, start: number): FlightZone {
  const rng = new Rng(hashSeed(`${seed >>> 0}:flight-zone:${index}`));
  const chunks = Math.max(3, Math.round((FLIGHT_COURSE.length + rng.range(-FLIGHT_COURSE.lengthJitter, FLIGHT_COURSE.lengthJitter)) / FLIGHT_COURSE.chunkLength));
  const end = start + chunks * FLIGHT_COURSE.chunkLength;
  return { index, start, end, from: start + FLIGHT_COURSE.launch, to: end - FLIGHT_COURSE.landing };
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
const FLOOR_HEIGHT = CONFIG.car.halfExtents.y + 0.3;

/**
 * The line the route follows through a section: swinging gently from side to side and up and down,
 * rising from the floor after take-off and settling back onto it for landing. Everything built
 * (openings, gaps between obstacles) is centred on or kept clear of this line, and its curvature
 * stays inside what banking can follow at top speed.
 */
export function flightRoute(seed: number, zone: FlightZone): (d: number) => { x: number; y: number } {
  const rng = new Rng(hashSeed(`${seed >>> 0}:flight-route:${zone.index}`));
  const { swing } = FLIGHT_COURSE;
  const main = { wavelength: rng.range(260, 330), phase: rng.range(0, Math.PI * 2) };
  const second = { wavelength: rng.range(160, 200), phase: rng.range(0, Math.PI * 2) };
  const rise = { wavelength: rng.range(200, 260), phase: rng.range(0, Math.PI * 2) };
  const turn = (a: { wavelength: number; phase: number }, d: number) => Math.sin(2 * Math.PI * d / a.wavelength + a.phase);
  return d => {
    // The swing fades in after take-off and out before landing, so the route meets the floor centred.
    const into = smooth((d - zone.from) / FLIGHT_COURSE.climb), out = smooth((zone.to - d) / FLIGHT_COURSE.descent);
    const envelope = Math.min(into, out);
    const x = envelope * (swing.main * turn(main, d) + swing.second * turn(second, d));
    const cruise = FLIGHT_COURSE.altitude + envelope * swing.rise * turn(rise, d);
    const y = FLOOR_HEIGHT + (cruise - FLOOR_HEIGHT) * envelope;
    return { x, y };
  };
}

/** Extent of the play volume that wall pieces must overshoot, so no object can be flown around. */
const VOLUME = { x: CONFIG.flight.bounds.halfWidth + 4, bottom: CONFIG.flight.bounds.minY - 6, top: CONFIG.flight.bounds.maxY + 6 };

type Group = 'ring' | 'pillars' | 'slot' | 'blocks';

/** The obstacle groups of a section, in order: where each one's centre lies, and what it is. */
export function planGroups(seed: number, zone: FlightZone, difficulty: (d: number) => number): { d: number; group: Group; seed: number }[] {
  const rng = new Rng(hashSeed(`${seed >>> 0}:flight-groups:${zone.index}`));
  const groups: { d: number; group: Group; seed: number }[] = [];
  let d = zone.from + FLIGHT_COURSE.leadIn, last: Group | null = null;
  while (d < zone.to - FLIGHT_COURSE.leadOut) {
    const weights: [Group, number][] = [['ring', 0.4], ['pillars', 0.22], ['slot', 0.16], ['blocks', 0.22]];
    let pick = rng.next() * weights.reduce((sum, [, w]) => sum + w, 0), group: Group = 'ring';
    for (const [kind, w] of weights) { if ((pick -= w) <= 0) { group = kind; break; } }
    // Two of a kind in a row are boring; take the next one along instead.
    if (group === last) group = weights[(weights.findIndex(([k]) => k === group) + 1) % weights.length][0];
    groups.push({ d, group, seed: hashSeed(`${seed >>> 0}:flight-group:${zone.index}:${groups.length}`) });
    last = group;
    const k = difficulty(d), { easy, hard } = FLIGHT_COURSE.spacing;
    d += easy + (hard - easy) * k + rng.range(-6, 10);
  }
  return groups;
}

/** Solid boxes for one group. Positions are absolute: x, y in metres, d in forward distance. */
export function buildGroup(group: Group, at: number, groupSeed: number, route: (d: number) => { x: number; y: number }, difficulty: number): Omit<ObstacleLike, 'id'>[] {
  const rng = new Rng(groupSeed);
  const o: Omit<ObstacleLike, 'id'>[] = [];
  const box = (x: number, y: number, d: number, hx: number, hy: number, hz: number, kind: ObstacleLike['kind'] = 'block') => o.push({ x, y, d, half: { x: hx, y: hy, z: hz }, kind });
  const centre = route(at);
  if (group === 'ring') {
    const { easy, hard } = FLIGHT_COURSE.opening;
    const wx = easy.x + (hard.x - easy.x) * difficulty, wy = easy.y + (hard.y - easy.y) * difficulty;
    const hz = 0.9, left = centre.x - wx, right = centre.x + wx, bottom = centre.y - wy, top = centre.y + wy;
    box((left - VOLUME.x) / 2, (VOLUME.top + VOLUME.bottom) / 2, at, (left + VOLUME.x) / 2, (VOLUME.top - VOLUME.bottom) / 2, hz, 'gate');
    box((right + VOLUME.x) / 2, (VOLUME.top + VOLUME.bottom) / 2, at, (VOLUME.x - right) / 2, (VOLUME.top - VOLUME.bottom) / 2, hz, 'gate');
    box(centre.x, (top + VOLUME.top) / 2, at, wx, (VOLUME.top - top) / 2, hz, 'gate');
    box(centre.x, (bottom + VOLUME.bottom) / 2, at, wx, (bottom - VOLUME.bottom) / 2, hz, 'gate');
  } else if (group === 'pillars') {
    // A slalom: columns on alternating sides of the route, staggered along it.
    const count = rng.int(2, 3 + Math.round(difficulty));
    let side = rng.chance(0.5) ? -1 : 1;
    for (let i = 0; i < count; i++) {
      const d = at + (i - (count - 1) / 2) * 15, r = route(d);
      box(r.x + side * rng.range(4.8, 5.8), (VOLUME.top + VOLUME.bottom) / 2, d, 1.3, (VOLUME.top - VOLUME.bottom) / 2, 1.3);
      side = -side;
    }
  } else if (group === 'slot') {
    // Two full-width beams, one above and one below the route: a slot to fly through.
    const gap = 3.4 - 0.4 * difficulty, thickness = 1.1;
    for (const side of [-1, 1]) {
      const y = centre.y + side * (gap + thickness);
      if (y - thickness < 0 && side < 0) continue;
      box(0, y, at, VOLUME.x, thickness, 1.1, 'barrier');
    }
  } else {
    // A scatter of crates, none within reach of the route.
    const count = rng.int(3, 5 + Math.round(difficulty * 2));
    for (let tries = 0; tries < 40 && o.length < count; tries++) {
      const size = rng.range(1.2, 2.2), d = at + rng.range(-22, 22);
      const x = rng.range(-16, 16), y = rng.range(3, 30);
      let clear = true;
      for (let s = -size; s <= size && clear; s += size / 2) {
        const r = route(d + s);
        if (Math.hypot(r.x - x, r.y - y) < 5.6 + size * 1.4) clear = false;
      }
      if (clear) box(x, y, d, size, size, size);
    }
  }
  return o;
}

/** The floor pieces of one flight chunk: the launch strip at the start, the landing strip at the end. */
function floors(zone: FlightZone, d0: number, d1: number): Omit<Slab, 'id'>[] {
  const slabs: Omit<Slab, 'id'>[] = [];
  // The launch strip continues the road before it (no bevel); the landing strip starts a new surface.
  if (d0 === zone.start) slabs.push({ surface: 'floor', d0, d1: zone.from, bevel: false });
  if (d1 === zone.end) slabs.push({ surface: 'floor', d0: zone.to, d1, bevel: true });
  return slabs;
}

export interface FlightChunkOptions {
  id: number; seed: number; d0: number; zone: FlightZone; difficulty: number; entry: ReachableState; pace?: Pace;
}

/**
 * One piece of a flying section. There is no physical validation: the route is built to be
 * flyable (its curvature is far below what banking can follow, and every opening sits on it), and
 * the test suite flies it with an autopilot that has only the player's three inputs.
 */
export function planFlightChunk(options: FlightChunkOptions): PlannedChunk {
  const { id, seed, d0, zone, difficulty, entry } = options;
  const pace = options.pace ?? paceFor(difficulty);
  const d1 = Math.min(zone.end, d0 + FLIGHT_COURSE.chunkLength);
  const route = flightRoute(seed, zone);
  const obstacles: ObstacleLike[] = [];
  for (const g of planGroups(seed, zone, () => difficulty)) {
    if (g.d < d0 || g.d >= d1) continue;
    for (const part of buildGroup(g.group, g.d, g.seed, route, difficulty)) obstacles.push({ ...part, id: obstacles.length + 1 });
  }
  const waypoints: RouteWaypoint[] = [];
  for (let d = d0; d <= d1; d += 10) {
    const flying = d >= zone.from && d < zone.to;
    const p = flying ? route(d) : { x: 0, y: FLOOR_HEIGHT };
    waypoints.push({ d, x: p.x, y: p.y, roll: 0, forward: pace.cruise, fuel: CONFIG.fuel.capacity, heat: 0, surface: flying ? null : 'floor', phase: flying ? 'flying' : 'floor traversal' });
  }
  const last = d1 >= zone.end;
  // Landing leaves the car centred on a floor, as every chunk's exit does; its touchdown is behind the boundary.
  const exit: ReachableState = last
    ? { ...initialReachableState(), forward: pace.cruise, distanceOffset: 0, lastArrival: -(FLIGHT_COURSE.landing - 40) }
    : { ...entry };
  return {
    id, seed, d0, d1, kind: 'fly', difficulty, pace,
    slabs: floors(zone, d0, d1), pickups: [], obstacles, route: waypoints,
    plan: [{ action: 'flight', label: 'flying' }],
    entry: { ...entry }, exit,
    flight: { from: Math.max(d0, zone.from), to: Math.min(d1, zone.end), zone: { start: zone.start, from: zone.from, to: zone.to, end: zone.end } },
    validation: {
      accepted: true, reasons: [], seconds: 0, steps: 0, minFuel: CONFIG.fuel.capacity, maxHeat: 0, timingTolerance: 0, replayCount: 0,
      visitedSurfaces: ['floor'], minReactionSeconds: 0, entrySpeedEnvelope: { min: pace.cruise, max: pace.max },
    },
    witness: { dt: 1 / CONFIG.physicsHz, controls: [], samples: waypoints, phaseIndices: [] },
  };
}
