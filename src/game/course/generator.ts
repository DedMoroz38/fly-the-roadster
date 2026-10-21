import { Rng } from '../../core/rng';
import { clamp, lerp } from '../../core/math';
import { CONFIG } from '../config';
import { SURFACES, SurfaceType } from '../surfaces';

/** Course is discretised into chunks of this many metres along the forward axis. */
export const CHUNK = 5;

export interface RoutePiece {
  surface: SurfaceType;
  /** First chunk (inclusive) and last chunk (exclusive). */
  start: number;
  end: number;
}

export type TransitionKind = 'same' | 'adjacent' | 'opposite';

export interface Pickup {
  id: number;
  x: number;
  y: number;
  d: number; // forward distance
  surface: SurfaceType;
}

export const OPPOSITE: Record<SurfaceType, SurfaceType> = {
  floor: 'ceiling',
  ceiling: 'floor',
  left: 'right',
  right: 'left',
};

export function transitionKind(a: SurfaceType, b: SurfaceType): TransitionKind {
  if (a === b) return 'same';
  return OPPOSITE[a] === b ? 'opposite' : 'adjacent';
}

/**
 * Allowed gap (metres, negative = overlap) between the end of one route piece and the start
 * of the next, as a function of difficulty 0..1. These limits are what keeps generated
 * sections possible with the car's movement abilities (validated by the bot tests).
 */
export function gapLimits(a: SurfaceType, b: SurfaceType, difficulty: number): { min: number; max: number } {
  const t = clamp(difficulty, 0, 1);
  const key = `${a}>${b}`;
  const table: Record<string, [number, number, number]> = {
    // [min gap, max gap at difficulty 0, max gap at difficulty 1]
    'floor>floor': [10, 20, 40],
    'ceiling>ceiling': [5, 10, 20],
    'left>left': [5, 10, 15],
    'right>right': [5, 10, 15],
    'floor>ceiling': [-40, -15, 15],
    'floor>left': [-40, -20, 5],
    'floor>right': [-40, -20, 5],
    'ceiling>floor': [-40, -10, 20],
    'ceiling>left': [-40, -25, 0],
    'ceiling>right': [-40, -25, 0],
    'left>floor': [-40, -15, 15],
    'right>floor': [-40, -15, 15],
    'left>ceiling': [-40, -25, 0],
    'right>ceiling': [-40, -25, 0],
    'left>right': [-40, -25, 0],
    'right>left': [-40, -25, 0],
  };
  const [min, max0, max1] = table[key];
  return { min, max: lerp(max0, max1, t) };
}

/** Estimated thruster fuel (seconds) a competent player spends on a transition. Conservative. */
export function transitionFuelCost(a: SurfaceType, b: SurfaceType, gap: number): number {
  const g = Math.max(0, gap);
  const k = transitionKind(a, b);
  if (k === 'same') return a === 'floor' ? 0.4 + g / 30 : 0.4 + g / 15;
  if (a === 'floor' && b === 'ceiling') return 1.0 + g / 30;
  if (a === 'floor') return 0.7 + g / 30; // floor -> wall
  if (b === 'floor') return 0.4 + g / 15; // falling onto the floor: hover over gaps
  if (b === 'ceiling') return 1.6 + g / 15; // wall -> ceiling: climb
  if (k === 'opposite') return 1.0 + g / 15; // wall -> opposite wall
  return 0.4 + g / 15; // ceiling -> wall
}

/**
 * Rough time (seconds) a competent player needs to complete a transition, from leaving one
 * surface to driving on the next. Used to keep enough usable surface after hard transitions.
 */
export function transitionTime(a: SurfaceType, b: SurfaceType): number {
  const k = transitionKind(a, b);
  if (k === 'same') return 0.6;
  if (a === 'floor' && b === 'ceiling') return 1.6;
  if (b === 'ceiling') return 2.4; // wall -> ceiling: roll roof-up, climb, roll again
  if (k === 'opposite') return a === 'ceiling' ? 1.2 : 1.5; // ceiling -> floor, wall -> wall
  if (a === 'floor') return 1.1; // floor -> wall
  return 1.0; // ceiling -> wall, wall -> floor
}

export const difficultyAt = (distance: number) => clamp((distance - 450) / 4000, 0, 1);

/** The hand-made opening sequence from the spec: floor, then ceiling, then a side wall, then floor. */
const INTRO: RoutePiece[] = [
  { surface: 'floor', start: -6, end: 30 }, // d -30..150
  { surface: 'ceiling', start: 24, end: 60 }, // d 120..300 (overlaps the floor's end)
  { surface: 'left', start: 55, end: 92 }, // d 275..460
  { surface: 'floor', start: 88, end: 120 }, // d 440..600
];
const INTRO_PICKUPS: { surface: SurfaceType; d: number }[] = [
  { surface: 'left', d: 380 },
];

/**
 * Seeded, incremental course generator. Produces a guaranteed route (a chain of surface
 * pieces with feasible gaps and enough fuel pickups), then decorates the other three surfaces
 * with independent random spans. Output is 4 boolean lanes indexed by chunk.
 */
export class CourseGenerator {
  readonly rng: Rng;
  readonly lanes: Record<SurfaceType, Set<number>> = { floor: new Set(), ceiling: new Set(), left: new Set(), right: new Set() };
  readonly route: RoutePiece[] = [];
  readonly pickups: Pickup[] = [];
  /** Chunks below this index are final (no later writes). */
  frontier = -Infinity;
  private fuelSincePickup = 0;
  private nextPickupId = 1;

  constructor(readonly seed: number) {
    this.rng = new Rng(seed);
    for (const piece of INTRO) this.addPiece(piece);
    for (const p of INTRO_PICKUPS) this.addPickup(p.surface, p.d);
    this.fuelSincePickup = 0;
    this.frontier = INTRO[INTRO.length - 1].start;
  }

  get lastPiece(): RoutePiece {
    return this.route[this.route.length - 1];
  }

  has(surface: SurfaceType, chunk: number): boolean {
    return this.lanes[surface].has(chunk);
  }

  /** Generates until every chunk below `chunk` is final. */
  generateUntil(chunk: number) {
    while (this.frontier < chunk) this.step();
  }

  /** Forget lane data far behind the player to bound memory. */
  forgetBefore(chunk: number) {
    for (const s of SURFACES) for (const c of this.lanes[s]) if (c < chunk) this.lanes[s].delete(c);
  }

  private addPiece(p: RoutePiece) {
    this.route.push(p);
    for (let c = p.start; c < p.end; c++) this.lanes[p.surface].add(c);
  }

  private addPickup(surface: SurfaceType, d: number) {
    const { halfWidth: W, height: H } = CONFIG.corridor;
    const off = 1.3; // pickup centre above the surface
    const pos: Record<SurfaceType, { x: number; y: number }> = {
      floor: { x: 0, y: off },
      ceiling: { x: 0, y: H - off },
      left: { x: -W + off, y: H / 2 },
      right: { x: W - off, y: H / 2 },
    };
    this.pickups.push({ id: this.nextPickupId++, surface, d, ...pos[surface] });
  }

  /** Adds one route piece (plus decorations and pickups) after the current last piece. */
  private step() {
    const prev = this.lastPiece;
    const dist = prev.end * CHUNK;
    const diff = difficultyAt(dist);
    const r = this.rng;

    // Choose the next surface: more surface switching as difficulty grows.
    const options: { s: SurfaceType; w: number }[] = SURFACES.map((s) => {
      const k = transitionKind(prev.surface, s);
      const w = k === 'same' ? lerp(1.2, 0.5, diff) : k === 'adjacent' ? 1.0 : lerp(0.5, 0.9, diff);
      return { s, w };
    });
    // Floors are the "rest" surface: favour them when nothing else is going on early on.
    const total = options.reduce((a, o) => a + o.w, 0);
    let pickW = r.next() * total;
    let next = options[0].s;
    for (const o of options) {
      if ((pickW -= o.w) <= 0) {
        next = o.s;
        break;
      }
    }

    const lim = gapLimits(prev.surface, next, diff);
    // Bias toward easier gaps: difficulty widens the distribution's upper part.
    const u = Math.pow(r.next(), lerp(1.8, 0.8, diff));
    const gapM = lim.min + (lim.max - lim.min) * u;
    let gap = Math.round(gapM / CHUNK);
    // Overlaps can't exceed the previous piece's length minus a lead-in.
    const prevLen = prev.end - prev.start;
    gap = Math.max(gap, -(prevLen - 6));
    const start = prev.end + gap;
    const lenM = lerp(170, 80, diff) * r.range(0.7, 1.3);
    let len = Math.max(14, Math.round(lenM / CHUNK));
    // The piece must stay usable well past the point where the previous one ends, so a player
    // who lands late (after a slow transition) still has room to set up the next move.
    const usableM = transitionTime(prev.surface, next) * CONFIG.car.maxForwardSpeed + lerp(80, 45, diff);
    const usable = Math.round(usableM / CHUNK);
    len = Math.max(len, Math.max(start, prev.end) + usable - start);

    // Fuel: if this transition would exceed the safe budget, place a pickup on the previous piece.
    const cost = transitionFuelCost(prev.surface, next, gap * CHUNK);
    const safeBudget = CONFIG.fuel.capacity * 0.6;
    // On the previous piece, shortly before the transition begins (but well after the car lands on it).
    const transitionAt = Math.min(prev.end, start) * CHUNK;
    const pickupD = clamp(transitionAt - 30, prev.start * CHUNK + 20, transitionAt - 5);
    const needPickup = this.fuelSincePickup + cost > safeBudget;
    const bonusPickup = r.chance(lerp(0.35, 0.1, diff));
    if (needPickup || bonusPickup) {
      this.addPickup(prev.surface, pickupD);
      this.fuelSincePickup = 0;
    }
    this.fuelSincePickup += cost;

    const piece: RoutePiece = { surface: next, start, end: start + len };
    this.addPiece(piece);
    this.decorate(Math.min(prev.end, start), piece.end, piece.surface, diff);
    // Everything before the new piece's start can no longer change (decorations stay inside the range).
    this.frontier = Math.max(this.frontier, Math.min(prev.end, start));
  }

  /** Random spans on the non-route surfaces in [from, to). Purely optional extra geometry. */
  private decorate(from: number, to: number, routeSurface: SurfaceType, diff: number) {
    const r = this.rng;
    for (const s of SURFACES) {
      if (s === routeSurface) continue;
      if (!r.chance(lerp(0.55, 0.3, diff))) continue;
      const len = r.int(4, 24);
      const a = r.int(from, Math.max(from, to - len));
      for (let c = a; c < Math.min(to, a + len); c++) this.lanes[s].add(c);
    }
  }
}
