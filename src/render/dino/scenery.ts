import * as THREE from 'three';
import { CONFIG } from '../../game/config';
import { hashSeed, Rng } from '../../core/rng';
import type { ParallaxTile } from '../parallax';
import { PixelBuilder, tileFromBuilder, type ToneMaterials } from './pixels';
import { toneMaterial } from './trackStyle';
import { cactus, cloud, GRAVES, monument, MONUMENTS, pterodactyl, rock, tombstone, type MonumentKind } from './props';

/** How the dino desert scrolls: the roadside at the car's speed, then slower layers further out. */
export const DINO_SCENERY = {
  roadside: { speed: 1, tileLength: 120, ahead: 420, behind: 70 },
  middle: { speed: 0.4, tileLength: 160, ahead: 560, behind: 90 },
  monuments: { speed: 0.12, tileLength: 150, ahead: 650, behind: 100 },
  sky: { speed: 0.02, tileLength: 300, ahead: 1200, behind: 200 },
} as const;

/** Height of the sand beside the track; the track itself crosses a void (nothing to fall onto). */
export const GROUND_Y = -2.2;
/** Nearest roadside object to the centre line: well outside the walls at ±6. */
export const ROADSIDE_MIN_X = CONFIG.corridor.halfWidth + 4;

const seeded = (seed: number, layer: number, index: number) => new Rng(hashSeed(`${seed}:dino:${layer}:${index}`));

export interface Placed { x: number; s: number }
export interface RoadsideTile {
  cacti: (Placed & { height: number; arms: 0 | 1 | 2 })[];
  graves: (Placed & { name: string; years: string; cross: boolean })[];
  rocks: (Placed & { size: number })[];
  pebbles: Placed[];
}

/** Keeps a set of footprints apart: returns false (and records nothing) if the spot is taken. */
class Spots {
  private readonly taken: { x: number; s: number; r: number }[] = [];
  claim(x: number, s: number, r: number) {
    if (this.taken.some(t => Math.hypot(t.x - x, t.s - s) < t.r + r)) return false;
    this.taken.push({ x, s, r });
    return true;
  }
}

/** Roadside layout of one tile (s is the distance into the tile along the track). Pure and seeded. */
export function planRoadside(seed: number, index: number): RoadsideTile {
  const rng = seeded(seed, 0, index), spots = new Spots();
  const L = DINO_SCENERY.roadside.tileLength;
  const out: RoadsideTile = { cacti: [], graves: [], rocks: [], pebbles: [] };
  // A graveyard on one side in about every other tile: two rows of stones facing the road.
  if (rng.chance(0.6)) {
    const side = rng.chance(0.5) ? -1 : 1, count = rng.int(3, 5), s0 = rng.range(10, L - 40);
    for (let i = 0; i < count; i++) {
      const x = side * (ROADSIDE_MIN_X + 2 + (i % 2) * 5.5), s = s0 + i * 7.5;
      const [name, years] = rng.pick(GRAVES);
      if (spots.claim(x, s, 3.4)) out.graves.push({ x, s, name, years, cross: rng.chance(0.2) });
    }
  }
  for (let tries = 0, want = rng.int(6, 10); tries < 40 && out.cacti.length < want; tries++) {
    const x = rng.pick([-1, 1]) * rng.range(ROADSIDE_MIN_X, ROADSIDE_MIN_X + 30), s = rng.range(0, L), height = rng.range(3, 8);
    if (spots.claim(x, s, 2.5)) out.cacti.push({ x, s, height, arms: rng.pick([0, 1, 2, 2] as const) });
  }
  for (let tries = 0, want = rng.int(2, 4); tries < 20 && out.rocks.length < want; tries++) {
    const x = rng.pick([-1, 1]) * rng.range(ROADSIDE_MIN_X, ROADSIDE_MIN_X + 40), s = rng.range(0, L), size = rng.range(1, 2.4);
    if (spots.claim(x, s, size + 1)) out.rocks.push({ x, s, size });
  }
  for (let i = 0; i < 70; i++) out.pebbles.push({ x: rng.pick([-1, 1]) * rng.range(ROADSIDE_MIN_X - 1, 90), s: rng.range(0, L) });
  return out;
}

/** The front of a prop turns slightly toward the oncoming car so its face is readable early. */
const faceRoad = (x: number) => Math.atan2(-Math.sign(x) * Math.cos(0.5), Math.sin(0.5));

export function roadsideTile(seed: number, index: number, materials: ToneMaterials): ParallaxTile {
  const plan = planRoadside(seed, index), L = DINO_SCENERY.roadside.tileLength;
  const b = new PixelBuilder();
  for (const side of [-1, 1]) {
    // Sand, and the ground line that edges it nearest the road.
    b.place(side * 205, GROUND_Y - 0.1, -L / 2).box('light', 0, 0, 0, 392, 0.2, L);
    b.place(side * (ROADSIDE_MIN_X - 2.5), GROUND_Y + 0.02, -L / 2).box('ink', 0, 0, 0, 0.35, 0.1, L);
  }
  for (const p of plan.pebbles) b.place(p.x, GROUND_Y + 0.02, -p.s).box('mid', 0, 0, 0, 0.7, 0.08, 0.22);
  for (const c of plan.cacti) { b.place(c.x, GROUND_Y, -c.s); cactus(b, c.height, c.arms, c.height > 5.5 ? 'ink' : 'dark'); }
  for (const r of plan.rocks) { b.place(r.x, GROUND_Y, -r.s, r.x * 0.7); rock(b, r.size); }
  for (const g of plan.graves) { b.place(g.x, GROUND_Y, -g.s, faceRoad(g.x), 1.3); tombstone(b, g.name, g.years, g.cross); }
  return tileFromBuilder(b, materials);
}

export interface MiddleTile {
  cacti: (Placed & { height: number; arms: 0 | 1 | 2 })[];
  birds: (Placed & { y: number; speed: number; phase: number })[];
}

/** Distant giant cacti and the pterodactyls, which fly toward the car faster than the scenery drifts. */
export function planMiddle(seed: number, index: number): MiddleTile {
  const rng = seeded(seed, 1, index), L = DINO_SCENERY.middle.tileLength;
  const cacti: MiddleTile['cacti'] = [], birds: MiddleTile['birds'] = [];
  for (let i = 0, n = rng.int(3, 6); i < n; i++) {
    cacti.push({ x: rng.pick([-1, 1]) * rng.range(55, 160), s: rng.range(0, L), height: rng.range(8, 20), arms: rng.pick([1, 2, 2] as const) });
  }
  for (let i = 0, n = rng.int(1, 3); i < n; i++) {
    birds.push({ x: rng.pick([-1, 1]) * rng.range(14, 70), s: rng.range(0, L), y: rng.range(5, 22), speed: rng.range(8, 16), phase: rng.range(0, 1) });
  }
  return { cacti, birds };
}

export function middleTile(seed: number, index: number, materials: ToneMaterials): ParallaxTile {
  const plan = planMiddle(seed, index);
  const b = new PixelBuilder();
  for (const c of plan.cacti) { b.place(c.x, GROUND_Y, -c.s); cactus(b, c.height, c.arms, 'dark'); }
  const tile = tileFromBuilder(b, materials);
  // Each bird has two wing positions that swap about four times a second, like the original's sprite.
  const frames = plan.birds.map(bird => {
    const group = new THREE.Group();
    const geometries: THREE.BufferGeometry[] = [];
    const poses = [true, false].map(up => {
      const pb = new PixelBuilder().place(0, 0, 0, Math.PI, 1);
      pterodactyl(pb, up);
      const pose = new THREE.Group();
      for (const { tone, geometry } of pb.build()) { pose.add(new THREE.Mesh(geometry, materials.get(tone))); geometries.push(geometry); }
      group.add(pose);
      return pose;
    });
    group.scale.setScalar(1.8);
    group.position.set(bird.x, bird.y, -bird.s);
    tile.object.add(group);
    return { bird, group, poses, geometries, start: -1 };
  });
  const dispose = tile.dispose;
  return {
    object: tile.object,
    animate: time => {
      for (const f of frames) {
        if (f.start < 0) f.start = time;
        const t = time - f.start;
        f.group.position.z = -f.bird.s + Math.min(200, t * f.bird.speed);
        f.group.position.y = f.bird.y + Math.sin(t * 1.3 + f.bird.phase * 6) * 0.8;
        const flap = Math.floor((t + f.bird.phase) * 4) % 2;
        f.poses[0].visible = flap === 0;
        f.poses[1].visible = flap === 1;
      }
    },
    dispose: () => { dispose(); for (const f of frames) for (const g of f.geometries) g.dispose(); },
  };
}

export interface MonumentSpot { kind: MonumentKind; x: number; s: number; scale: number }

/**
 * One monument per tile, alternating sides, so Google's greatest hits march past at a tenth of the
 * car's speed. Kinds cycle through a seeded shuffle, so each appears once before any repeats.
 */
export function planMonument(seed: number, index: number): MonumentSpot {
  const n = MONUMENTS.length, round = Math.floor(index / n);
  const order = MONUMENTS.map((_, i) => i);
  const rng = seeded(seed, 2, round);
  for (let i = n - 1; i > 0; i--) { const j = rng.int(0, i); [order[i], order[j]] = [order[j], order[i]]; }
  const at = seeded(seed, 3, index);
  const side = (index & 1) === 0 ? -1 : 1;
  const kind = MONUMENTS[order[((index % n) + n) % n]];
  return { kind, x: side * at.range(45, 85), s: at.range(20, DINO_SCENERY.monuments.tileLength - 20), scale: at.range(1.6, 2.3) * (kind === 'waymo' ? 1.6 : 1) };
}

export function monumentTile(seed: number, index: number, materials: ToneMaterials): ParallaxTile {
  const m = planMonument(seed, index);
  const b = new PixelBuilder().place(m.x, GROUND_Y, -m.s, faceRoad(m.x), m.scale);
  monument(b, m.kind);
  return tileFromBuilder(b, materials);
}

/** Wide flat clouds high up, and two far dune ridges that give the horizon some shape. */
export function skyTile(seed: number, index: number, materials: ToneMaterials): ParallaxTile {
  const rng = seeded(seed, 4, index), L = DINO_SCENERY.sky.tileLength;
  const b = new PixelBuilder();
  for (let i = 0, n = rng.int(3, 5); i < n; i++) {
    b.place(rng.range(-260, 260), rng.range(55, 130), -rng.range(0, L), 0, rng.range(3, 6));
    cloud(b, rng.range(8, 14));
  }
  const ridges = new THREE.Group();
  const ridgeMaterial = toneMaterial('mist', { side: THREE.DoubleSide });
  const geometries: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(0, GROUND_Y - 5);
    const steps = 12;
    for (let k = 0; k <= steps; k++) shape.lineTo((k / steps) * L, GROUND_Y + 4 + (rng.next() * 0.6 + 0.4) * 38 * Math.sin((k / steps) * Math.PI) ** 0.7);
    shape.lineTo(L, GROUND_Y - 5);
    const geometry = new THREE.ShapeGeometry(shape);
    // The shape lies in the XY plane with x along the track; turn x into forward (-Z) and stand it on the side.
    geometry.rotateY(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, ridgeMaterial);
    mesh.position.set(side * 480, 0, 0);
    ridges.add(mesh);
    geometries.push(geometry);
  }
  return tileFromBuilder(b, materials, undefined, ridges, () => { ridgeMaterial.dispose(); for (const g of geometries) g.dispose(); });
}
