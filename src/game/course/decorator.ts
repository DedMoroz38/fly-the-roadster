import { Rng } from '../../core/rng';
import { CONFIG } from '../config';
import type { ObstacleLike } from '../physics/level';
import { LEAD_BEVEL, SURFACES, type Slab, type SurfaceType } from '../surfaces';
import { recertifyPlan, type PlannedChunk, type RouteWaypoint } from './planner';
import { PLANNER_CONFIG } from './plannerConfig';

export const DECORATOR_CONFIG = {
  maxExtraSurfaces: 3,
  routeClearance: 1.2,
  minSpan: 12,
  maxSpan: 24,
  /** [easiest, hardest] per surface. Floors carry the slalom; walls and ceilings get sparser hazards. */
  maxObstacles: { floor: [4, 9], ceiling: [2, 4], left: [2, 4], right: [2, 4] } as Record<SurfaceType, [number, number]>,
  /** Minimum gap between hazards at base top speed, [easiest, hardest]; scaled with chunk speed. */
  obstacleSpacing: { floor: [24, 15], ceiling: [45, 28], left: [45, 28], right: [45, 28] } as Record<SurfaceType, [number, number]>,
  /** Extra floor candidates along each slab, so obstacles can fill lanes the route vacates. */
  floorCandidateStep: 6,
  obstacleWidth: 0.8,
  obstacleDepth: 0.7,
  obstacleHalfLength: { min: 1.6, max: 2.4 },
  supportInset: 1,
  obstacleClearance: 0.6,
  /** Wall-to-wall gates with one opening on the route, [easiest, hardest] per chunk (rounded). */
  gates: [-1, 3] as [number, number],
  /** Minimum distance between gates at base top speed; scaled with chunk speed. */
  gateSpacing: 40,
  gateHalfLength: 0.6,
  /** Extra opening width beyond the route clearance on each side. */
  gateSlack: 0.3,
  /** Narrowest gate segment worth placing beside the opening. */
  gateMinWidth: 0.6,
} as const;

/** Route protection along the course grows with the chunk's top speed. */
const depthPadding = (maxSpeed: number) => CONFIG.car.halfExtents.z + DECORATOR_CONFIG.routeClearance
  + maxSpeed * (PLANNER_CONFIG.timingTolerance + PLANNER_CONFIG.sampleEverySteps / CONFIG.physicsHz);
const byDifficulty = ([easy, hard]: [number, number], difficulty: number) => easy + (hard - easy) * difficulty;
function crossExtents(p: RouteWaypoint) {
  const { x, y } = CONFIG.car.halfExtents;
  return { x: Math.abs(Math.cos(p.roll)) * x + Math.abs(Math.sin(p.roll)) * y,
    y: Math.abs(Math.sin(p.roll)) * x + Math.abs(Math.cos(p.roll)) * y };
}
function protectedFromBox(route: RouteWaypoint[], o: ObstacleLike, padding: number): boolean {
  return route.every(p => {
    if (Math.abs(p.d - o.d) > o.half.z + padding) return true;
    const half = crossExtents(p);
    return Math.abs(p.x - o.x) > o.half.x + half.x + DECORATOR_CONFIG.routeClearance
      || Math.abs(p.y - o.y) > o.half.y + half.y + DECORATOR_CONFIG.routeClearance;
  });
}
function protectedFromSurface(route: RouteWaypoint[], slab: Omit<Slab, 'id'>, padding: number): boolean {
  return route.every(p => {
    if (p.d < slab.d0 - padding || p.d > slab.d1 + padding) return true;
    const h = crossExtents(p), margin = DECORATOR_CONFIG.routeClearance;
    switch (slab.surface) {
      case 'floor': return p.y > h.y + margin;
      case 'ceiling': return CONFIG.corridor.height - p.y > h.y + margin;
      case 'left': return p.x + CONFIG.corridor.halfWidth > h.x + margin;
      case 'right': return CONFIG.corridor.halfWidth - p.x > h.x + margin;
    }
  });
}

/** The outer face touches its support plane; every box protrudes into a driveable lane. */
function surfaceObstacle(surface: SurfaceType, lane: number, d: number, halfLength: number, id: number): ObstacleLike {
  const { obstacleWidth: width, obstacleDepth: depth } = DECORATOR_CONFIG;
  const { halfWidth: widthLimit, height } = CONFIG.corridor;
  switch (surface) {
    case 'floor': return { id, x: lane, y: depth, d, half: { x: width, y: depth, z: halfLength } };
    case 'ceiling': return { id, x: lane, y: height - depth, d, half: { x: width, y: depth, z: halfLength } };
    case 'left': return { id, x: -widthLimit + depth, y: lane, d, half: { x: depth, y: width, z: halfLength } };
    case 'right': return { id, x: widthLimit - depth, y: lane, d, half: { x: depth, y: width, z: halfLength } };
  }
}
function boxesOverlap(a: ObstacleLike, b: ObstacleLike): boolean {
  const clearance = DECORATOR_CONFIG.obstacleClearance;
  return Math.abs(a.x - b.x) < a.half.x + b.half.x + clearance
    && Math.abs(a.y - b.y) < a.half.y + b.half.y + clearance
    && Math.abs(a.d - b.d) < a.half.z + b.half.z + clearance;
}

/** Bounded proposals cover the route's own supports before optional surface islands. */
function placeSurfaceObstacles(base: PlannedChunk, extras: Omit<Slab, 'id'>[], rng: Rng): ObstacleLike[] {
  const obstacles: ObstacleLike[] = [];
  let nextId = base.obstacles.reduce((next, obstacle) => Math.max(next, obstacle.id + 1), 1);
  const edge = CONFIG.corridor.halfWidth;
  const padding = depthPadding(base.pace.max), speedScale = base.pace.max / CONFIG.car.maxForwardSpeed;
  for (const surface of SURFACES) {
    // Harder chunks carry more hazards, packed closer together (in seconds of travel).
    const limit = Math.round(byDifficulty(DECORATOR_CONFIG.maxObstacles[surface], base.difficulty));
    const spacing = byDifficulty(DECORATOR_CONFIG.obstacleSpacing[surface], base.difficulty) * speedScale;
    const spans = [...base.slabs, ...extras].filter(slab => slab.surface === surface);
    const sameSurface: ObstacleLike[] = [];
    const side = rng.chance(0.5) ? -1 : 1;
    const wall = surface === 'left' || surface === 'right';
    const wallLanes = [1.8, CONFIG.corridor.height - 1.8, 3.2, CONFIG.corridor.height - 3.2];
    const sideLanes = [side * (edge - 1.8), -side * (edge - 1.8), side * (edge - 2.8), -side * (edge - 2.8)];
    const centreLanes = [0, side * 1.6, -side * 1.6];
    const lanes = wall ? (side < 0 ? wallLanes : [...wallLanes].reverse()) : sideLanes;
    // Floors first sweep the centre, which is free only where a slalom route has moved aside,
    // so those blocks force steering. Then one central placement per slab and the slab ends.
    const passes: { pass: number | 'sweep'; lanes: number[] }[] = [
      ...(surface === 'floor' ? [{ pass: 'sweep' as const, lanes: centreLanes }] : []),
      ...[0.5, 0.2, 0.8].map(pass => ({ pass, lanes })),
    ];
    for (const { pass, lanes } of passes) {
      for (const slab of spans) {
        const halfLength = rng.range(DECORATOR_CONFIG.obstacleHalfLength.min, DECORATOR_CONFIG.obstacleHalfLength.max);
        const from = slab.d0 + (slab.bevel === false ? 0 : LEAD_BEVEL) + halfLength + DECORATOR_CONFIG.supportInset;
        const to = slab.d1 - halfLength - DECORATOR_CONFIG.supportInset;
        if (to < from) continue;
        const positions = pass === 'sweep'
          ? Array.from({ length: Math.floor((to - from) / DECORATOR_CONFIG.floorCandidateStep) + 1 }, (_, i) => from + i * DECORATOR_CONFIG.floorCandidateStep)
          : [from + (to - from) * pass];
        for (const d of positions) {
          if (sameSurface.length >= limit) break;
          if (sameSurface.some(obstacle => Math.abs(obstacle.d - d) < spacing)) continue;
          for (const lane of lanes) {
            const obstacle = surfaceObstacle(surface, lane, d, halfLength, nextId);
            if (!protectedFromBox(base.route, obstacle, padding)
              || [...base.obstacles, ...obstacles].some(existing => boxesOverlap(existing, obstacle))) continue;
            obstacles.push(obstacle);
            sameSurface.push(obstacle);
            nextId++;
            break;
          }
        }
      }
    }
  }
  return obstacles;
}

/**
 * Gates span the floor wall to wall except one opening where the route passes, so the player has to
 * line up with it. Openings away from the centre are preferred because they force a lane change.
 */
function placeGates(base: PlannedChunk, rng: Rng): ObstacleLike[] {
  const count = Math.round(byDifficulty(DECORATOR_CONFIG.gates, base.difficulty));
  if (count <= 0) return [];
  const { gateHalfLength, gateSlack, gateMinWidth, obstacleDepth, supportInset } = DECORATOR_CONFIG;
  const edge = CONFIG.corridor.halfWidth;
  const padding = depthPadding(base.pace.max);
  const spacing = DECORATOR_CONFIG.gateSpacing * base.pace.max / CONFIG.car.maxForwardSpeed;
  const halfGap = CONFIG.car.halfExtents.x + DECORATOR_CONFIG.routeClearance + gateSlack;
  const floors = base.slabs.filter(s => s.surface === 'floor');
  const supported = (d: number) => floors.some(s => s.d0 + LEAD_BEVEL + supportInset <= d - gateHalfLength && s.d1 - supportInset >= d + gateHalfLength);
  const candidates = base.route.filter(p => p.surface === 'floor' && Math.abs(p.roll) < 0.1 && supported(p.d))
    .map(p => ({ p, order: Math.abs(p.x) + rng.next() * 0.5 }))
    .sort((a, b) => b.order - a.order);
  const gates: ObstacleLike[] = [];
  let nextId = base.obstacles.reduce((next, obstacle) => Math.max(next, obstacle.id + 1), 1);
  for (const { p } of candidates) {
    if (gates.length / 2 >= count) break;
    if (gates.some(g => Math.abs(g.d - p.d) < spacing)) continue;
    const parts = ([[-edge, p.x - halfGap], [p.x + halfGap, edge]] as const).filter(([a, b]) => b - a >= gateMinWidth);
    const pieces = parts.map(([a, b]) => ({ id: 0, x: (a + b) / 2, y: obstacleDepth, d: p.d,
      half: { x: (b - a) / 2, y: obstacleDepth, z: gateHalfLength } }));
    if (!pieces.length || !pieces.every(o => protectedFromBox(base.route, o, padding))) continue;
    if (pieces.some(o => base.obstacles.some(existing => boxesOverlap(existing, o)))) continue;
    for (const piece of pieces) gates.push({ ...piece, id: nextId++ });
  }
  return gates;
}

/** Seeded optional geometry is only retained after every actual-physics replay succeeds again. */
export function decorateChunk(base: PlannedChunk): PlannedChunk {
  if (!base.validation.accepted) return base;
  const rng = new Rng(base.seed ^ 0xdec0a7e);
  const extras: Omit<Slab, 'id'>[] = [];
  const floorSpans = base.slabs.filter(s => s.surface === 'floor');
  // Decorative islands occur above intact floor, preserving completely surface-free flight gaps.
  const regions = floorSpans.filter(s => s.d1 - s.d0 > 60);
  for (let i = 0; i < DECORATOR_CONFIG.maxExtraSurfaces; i++) {
    const region = regions[i % regions.length];
    if (!region) break;
    const length = rng.range(DECORATOR_CONFIG.minSpan, DECORATOR_CONFIG.maxSpan);
    const start = rng.range(region.d0 + 20, region.d1 - length - 20);
    const surface = rng.pick<SurfaceType>(['left', 'right', 'ceiling']);
    const slab = { surface, d0: start, d1: start + length };
    const overlaps = [...base.slabs, ...extras].some(s => s.surface === surface && s.d0 < slab.d1 + 2 && s.d1 > slab.d0 - 2);
    if (!overlaps && protectedFromSurface(base.route, slab, depthPadding(base.pace.max))) extras.push(slab);
  }
  const gates = placeGates(base, rng);
  const obstacles = placeSurfaceObstacles({ ...base, obstacles: [...base.obstacles, ...gates] }, extras, rng);
  if (!extras.length && !obstacles.length && !gates.length) return base;
  // Bounded work: at most two proposals, each fully revalidated. If the full set fails, gates are the
  // likeliest cause, so retry without them. Unsafe decoration never weakens a route.
  for (const added of gates.length ? [[...gates, ...obstacles], obstacles] : [obstacles]) {
    if (!extras.length && !added.length) break;
    const decorated = recertifyPlan({ ...base, slabs: [...base.slabs, ...extras], obstacles: [...base.obstacles, ...added] });
    if (decorated.validation.accepted) return decorated;
  }
  return base;
}
