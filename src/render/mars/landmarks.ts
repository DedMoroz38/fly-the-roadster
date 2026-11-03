import { hashSeed, Rng } from '../../core/rng';
import type { FormKind } from './landforms';

/** Landmarks drift past at 8 % of the car's speed, so they read as far away and linger. */
export const LANDMARK_CONFIG = {
  tileLength: 220,
  speed: 0.08,
  ahead: 1400,
  behind: 260,
  /** Lateral band, metres from the track centre line. */
  lateral: { min: 230, max: 900 },
  /** Starship sites and outposts sit nearer, where they can be made out through the haze. */
  site: { min: 167, max: 287 },
  /** The ground there stays within a couple of metres of plain level; structures stand on deep
   *  foundations, so they neither float nor sink as the faster ground slides beneath them. */
  baseY: -2.6,
  /** How far foundations reach below baseY. */
  footing: 9,
} as const;

/** How rare colony sights are. The opening guarantees one of each, further away than they look. */
export const SITE_RARITY = { starshipTile: 2, outpostTile: 1, starship: 0.08, outpost: 0.12 } as const;

/**
 * When Starships launch. The opening ship stands far ahead and lifts off early in the run, while it
 * is still in front of the car; later ones lift off once they are this far ahead (scenery metres),
 * close enough to see and far enough to stay on screen while they climb.
 */
export const LAUNCH_TIMING = { openingAfter: { min: 250, max: 400 }, ahead: { min: 480, max: 600 } } as const;

export interface Formation { kind: FormKind; x: number; t: number; radius: number; height: number; yaw: number; seed: number }
export interface Arch { x: number; t: number; span: number; height: number; thickness: number; yaw: number; seed: number }
export interface StarshipSite {
  kind: 'starship';
  x: number; t: number; seed: number;
  /** Ships on the pad, relative to its centre; ship `launcher` lifts off when the camera reaches `launchAt` metres. */
  ships: { dx: number; dz: number }[];
  launcher: number | null;
  launchAt: number;
}
export interface OutpostSite { kind: 'outpost'; x: number; t: number; seed: number }
export interface LandmarkTile { formations: Formation[]; arches: Arch[]; site: StarshipSite | OutpostSite | null }

export function siteKind(seed: number, index: number): 'starship' | 'outpost' | null {
  if (index === SITE_RARITY.starshipTile) return 'starship';
  if (index === SITE_RARITY.outpostTile) return 'outpost';
  if (index <= Math.max(SITE_RARITY.starshipTile, SITE_RARITY.outpostTile) + 1) return null;
  const rng = new Rng(hashSeed(`${seed >>> 0}:site:${index}`));
  const roll = rng.next();
  if (roll < SITE_RARITY.starship) return 'starship';
  if (roll < SITE_RARITY.starship + SITE_RARITY.outpost) return 'outpost';
  return null;
}

/** The colony site of one tile, if any, planned on its own so neighbouring tiles can keep clear of it. */
export function planSite(seed: number, index: number): StarshipSite | OutpostSite | null {
  const kind = siteKind(seed, index);
  if (!kind) return null;
  const { tileLength, site: band } = LANDMARK_CONFIG;
  const rng = new Rng(hashSeed(`${seed >>> 0}:siteplan:${index}`));
  const opening = index === SITE_RARITY.starshipTile;
  const x = (rng.chance(0.5) ? -1 : 1) * rng.range(band.min, band.max), seed2 = rng.int(0, 1e9);
  // The opening Starship stands in the far half of its tile, well ahead of the car.
  const t = opening ? rng.range(tileLength * 0.55, tileLength - 30) : rng.range(40, tileLength - 40);
  if (kind === 'outpost') return { kind, x, t, seed: seed2 };
  const count = rng.chance(0.35) ? 2 : 1;
  const ships = count === 1 ? [{ dx: 0, dz: 0 }] : [{ dx: -26, dz: rng.range(-6, 6) }, { dx: 26, dz: rng.range(-6, 6) }];
  return {
    kind, x, t, seed: seed2, ships,
    // Most sites keep their ship on the ground; launches are an occasional treat.
    launcher: opening || rng.chance(0.5) ? rng.int(0, count - 1) : null,
    launchAt: opening
      ? rng.range(LAUNCH_TIMING.openingAfter.min, LAUNCH_TIMING.openingAfter.max)
      : (index * tileLength + t - rng.range(LAUNCH_TIMING.ahead.min, LAUNCH_TIMING.ahead.max)) / LANDMARK_CONFIG.speed,
  };
}

/** Rock keeps this much room around a site (beyond its own radius), in this tile and the next ones. */
export const SITE_CLEARANCE = 130;

/** Plans one tile of landmarks: mesas, buttes and spires, a rare arch, and at most one site. */
export function planLandmarkTile(seed: number, index: number): LandmarkTile {
  const { tileLength, lateral } = LANDMARK_CONFIG;
  const rng = new Rng(hashSeed(`${seed >>> 0}:landmarks:${index}`));
  const site = planSite(seed, index);
  // Sites of this tile and both neighbours, in this tile's coordinates.
  const sites = [-1, 0, 1].flatMap(k => {
    const other = k === 0 ? site : planSite(seed, index + k);
    return other ? [{ x: other.x, t: other.t + k * tileLength }] : [];
  });
  const clearOfSites = (x: number, t: number, radius: number) => sites.every(o => Math.hypot(o.x - x, o.t - t) > radius * 1.5 + SITE_CLEARANCE);

  const formations: Formation[] = [];
  const target = rng.int(3, 6);
  for (let attempt = 0; attempt < target * 5 && formations.length < target; attempt++) {
    const kind: FormKind = rng.pick(['mesa', 'mesa', 'butte', 'butte', 'spire'] as const);
    const radius = kind === 'mesa' ? rng.range(40, 110) : kind === 'butte' ? rng.range(16, 36) : rng.range(6, 11);
    const height = kind === 'mesa' ? rng.range(28, 70) : kind === 'butte' ? rng.range(36, 80) : rng.range(26, 46);
    const side = rng.chance(0.5) ? -1 : 1;
    // Big mesas stay further out; nothing crowds a site.
    const ax = Math.max(lateral.min + radius * 1.5, lateral.min + Math.pow(rng.next(), 1.3) * (lateral.max - lateral.min));
    const f = { kind, x: side * ax, t: rng.next() * tileLength, radius, height, yaw: rng.range(0, Math.PI * 2), seed: rng.int(0, 1e9) };
    if (formations.every(o => Math.hypot(o.x - f.x, o.t - f.t) > (o.radius + f.radius) * 1.3) && clearOfSites(f.x, f.t, f.radius)) formations.push(f);
  }

  const arches: Arch[] = [];
  if (rng.chance(0.22)) {
    const span = rng.range(30, 60);
    const arch = {
      x: (rng.chance(0.5) ? -1 : 1) * rng.range(240, 420), t: rng.next() * tileLength, span, height: span * rng.range(0.55, 0.85),
      thickness: span * rng.range(0.13, 0.2), yaw: rng.range(-0.5, 0.5), seed: rng.int(0, 1e9),
    };
    if (clearOfSites(arch.x, arch.t, span * 0.6)) arches.push(arch);
  }
  return { formations, arches, site };
}
