import * as THREE from 'three';
import { hashSeed, Rng } from '../../core/rng';

/** One appearance per kind; WALL-E always brings EVE along. */
export const SHOW_KINDS = ['iss', 'shuttle', 'voyager', 'roadster', 'millennium', 'interstellar', 'wall-e'] as const;
export type ShowKind = (typeof SHOW_KINDS)[number];

/**
 * Metres of travel (one point per metre): each object is on screen for `visible`, then space is
 * empty for `gap` before the next. The run opens with a gap, so the first object comes into view
 * a few hundred metres in.
 */
export const SHOW_TIMING = { visible: { min: 500, max: 700 }, gap: { min: 200, max: 700 } } as const;

export interface ShowEvent { kind: ShowKind; start: number; length: number; seed: number }

/**
 * The run's sequence of appearances: kinds drawn from a shuffled bag, so every kind appears once
 * before any repeats, and never twice in a row across bags. Same seed, same show.
 */
export class ShowSchedule {
  private readonly events: ShowEvent[] = [];
  private readonly rng: Rng;
  private bag: ShowKind[] = [];
  private end = 0;

  constructor(seed: number) {
    this.rng = new Rng(hashSeed(`${seed >>> 0}:orbit-show`));
  }

  private draw(): ShowKind {
    if (!this.bag.length) {
      const last = this.events.at(-1)?.kind;
      do {
        this.bag = [...SHOW_KINDS];
        for (let i = this.bag.length - 1; i > 0; i--) {
          const j = this.rng.int(0, i);
          [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
        }
      } while (this.bag[this.bag.length - 1] === last);
    }
    return this.bag.pop()!;
  }

  private extend() {
    const { visible, gap } = SHOW_TIMING;
    const start = this.end + this.rng.range(gap.min, gap.max);
    const event = { kind: this.draw(), start, length: this.rng.range(visible.min, visible.max), seed: this.rng.int(0, 1e9) };
    this.events.push(event);
    this.end = event.start + event.length;
  }

  /** The first `count` appearances (for tests and planning). */
  first(count: number): ShowEvent[] {
    while (this.events.length < count) this.extend();
    return this.events.slice(0, count);
  }

  /** The appearance under way at a distance, with its progress from 0 to 1, or null in a gap. */
  at(distance: number): { event: ShowEvent; progress: number } | null {
    while (this.end <= distance) this.extend();
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (distance >= e.start + e.length) break;
      if (distance >= e.start) return { event: e, progress: (distance - e.start) / e.length };
    }
    return null;
  }
}

/**
 * Where each object is relative to the camera (x right, y up from the track, z forward is negative)
 * as its appearance progresses from 0 to 1. Control points of a smooth curve. Every path starts and
 * ends unseen (outside the view, which spans about ±51° across and −40° to +30° up and down, or so far
 * away the object is a speck), so nothing pops in or out: objects drift in across the frame edge,
 * from behind or from the distance, travel on their own course in view, and leave the same way.
 */
export const SHOW_PATHS: Record<ShowKind, [number, number, number][]> = {
  // Co-orbiting: drifts down into view from the upper right and slides away across to the left.
  iss: [[100, 170, -150], [35, 85, -175], [-75, 65, -165], [-210, 45, -130]],
  // Crosses in front of us from left to right, nose first, climbing a little, well above the track.
  shuttle: [[-154, 41, -99], [-47, 52, -118], [55, 60, -115], [160, 67, -94]],
  // Tumbles down into view on the left and slips past us.
  voyager: [[-36, 61, -58], [-33, 28, -73], [-26, 12, -38], [-20, 6, 13]],
  // Starman's roadster overtakes us close on the right, tumbling, then climbs away out of view.
  roadster: [[16, 12, 30], [14, 14, -45], [13, 24, -130], [12, 180, -200]],
  // Swoops down from the upper left, banks across ahead of us and climbs away to the right.
  millennium: [[-88, 100, -85], [-35, 42, -90], [50, 34, -80], [210, 52, -90]],
  // Spinning, it sinks into view from above and drifts away to the left.
  interstellar: [[30, 140, -150], [24, 70, -144], [-66, 56, -141], [-192, 52, -114]],
  // WALL-E overtakes us: from behind the camera he flies straight on along the left side of the road,
  // away from his extinguisher, until he is a speck far ahead; EVE follows. The line of sight from
  // the camera leaves the corridor below the ceiling (y = 10 at x = −6), so a ceiling never hides him.
  'wall-e': [[-13, 15, 60], [-13, 15, -240], [-13, 15, -520], [-13, 15, -800]],
};

const curves = new Map<ShowKind, THREE.CatmullRomCurve3>();
const curveFor = (kind: ShowKind) => {
  let curve = curves.get(kind);
  if (!curve) {
    curve = new THREE.CatmullRomCurve3(SHOW_PATHS[kind].map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
    curves.set(kind, curve);
  }
  return curve;
};

/** Camera-relative position of an object along its path (progress 0 to 1, clamped). */
export function showPosition(kind: ShowKind, progress: number, target = new THREE.Vector3()): THREE.Vector3 {
  return curveFor(kind).getPoint(THREE.MathUtils.clamp(progress, 0, 1), target);
}

/** Camera-relative direction of travel along the path. */
export function showHeading(kind: ShowKind, progress: number, target = new THREE.Vector3()): THREE.Vector3 {
  return curveFor(kind).getTangent(THREE.MathUtils.clamp(progress, 0.0001, 0.9999), target);
}
