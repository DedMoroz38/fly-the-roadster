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
  /** Floors carry the slalom; walls and ceilings get sparser hazards. */
  maxObstacles: { floor: 6, ceiling: 3, left: 3, right: 3 } as Record<SurfaceType, number>,
  obstacleSpacing: { floor: 24, ceiling: 45, left: 45, right: 45 } as Record<SurfaceType, number>,
  /** Extra floor candidates along each slab, so obstacles can fill lanes the route vacates. */
  floorCandidateStep: 6,
  obstacleWidth: 0.8,
  obstacleDepth: 0.7,
  obstacleHalfLength: { min: 1.6, max: 2.4 },
  supportInset: 1,
  obstacleClearance: 0.6,
} as const;

const depthPadding = CONFIG.car.halfExtents.z + DECORATOR_CONFIG.routeClearance
  + CONFIG.car.maxForwardSpeed * (PLANNER_CONFIG.timingTolerance + PLANNER_CONFIG.sampleEverySteps / CONFIG.physicsHz);
function crossExtents(p: RouteWaypoint) {
  const { x, y } = CONFIG.car.halfExtents;
  return { x: Math.abs(Math.cos(p.roll)) * x + Math.abs(Math.sin(p.roll)) * y,
    y: Math.abs(Math.sin(p.roll)) * x + Math.abs(Math.cos(p.roll)) * y };
}
function protectedFromBox(route: RouteWaypoint[], o: ObstacleLike): boolean {
  return route.every(p => {
    if (Math.abs(p.d - o.d) > o.half.z + depthPadding) return true;
    const half = crossExtents(p);
    return Math.abs(p.x - o.x) > o.half.x + half.x + DECORATOR_CONFIG.routeClearance
      || Math.abs(p.y - o.y) > o.half.y + half.y + DECORATOR_CONFIG.routeClearance;
  });
}
function protectedFromSurface(route: RouteWaypoint[], slab: Omit<Slab, 'id'>): boolean {
  return route.every(p => {
    if (p.d < slab.d0 - depthPadding || p.d > slab.d1 + depthPadding) return true;
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
  for (const surface of SURFACES) {
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
          if (sameSurface.length >= DECORATOR_CONFIG.maxObstacles[surface]) break;
          if (sameSurface.some(obstacle => Math.abs(obstacle.d - d) < DECORATOR_CONFIG.obstacleSpacing[surface])) continue;
          for (const lane of lanes) {
            const obstacle = surfaceObstacle(surface, lane, d, halfLength, nextId);
            if (!protectedFromBox(base.route, obstacle)
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
    if (!overlaps && protectedFromSurface(base.route, slab)) extras.push(slab);
  }
  const obstacles = placeSurfaceObstacles(base, extras, rng);
  if (!extras.length && !obstacles.length) return base;
  const decorated = recertifyPlan({ ...base, slabs: [...base.slabs, ...extras], obstacles: [...base.obstacles, ...obstacles] });
  // Bounded work: one proposal and its full validation. Unsafe decoration never weakens a route.
  return decorated.validation.accepted ? decorated : base;
}
