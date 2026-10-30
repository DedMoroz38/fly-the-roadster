import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hashSeed, Rng } from '../../core/rng';
import { CONFIG } from '../../game/config';
import { B, meshVolume, Volume } from './mesher';
import { fbm } from './noise';

/** Low sun ahead and to the right of the track; the sky and the baked block light both use it. */
export const SUN_DIR = new THREE.Vector3(0.55, 0.2, -0.81).normalize();

/** Warm light on sun-facing block faces, cool twilight on the rest. */
export function sunsetLight(n: [number, number, number]): [number, number, number] {
  const warm = Math.max(0, n[0] * SUN_DIR.x + n[1] * SUN_DIR.y + n[2] * SUN_DIR.z);
  const cool: [number, number, number] = [0.74, 0.78, 1.02], hot: [number, number, number] = [1.34, 1.0, 0.8];
  return [cool[0] + (hot[0] - cool[0]) * warm, cool[1] + (hot[1] - cool[1]) * warm, cool[2] + (hot[2] - cool[2]) * warm];
}

/** Distances in metres along scenery coordinates, which advance at a fraction of the car's speed. */
export const ISLAND_CONFIG = {
  tileLength: 160,
  blockSize: 2.5,
  /** Islands per tile. */
  count: { min: 4, max: 7 },
  radius: { min: 4, max: 12 },
  /** Gap between the corridor and the nearest island edge, so nothing ever crowds the track. */
  clearance: 38,
  maxLateral: 430,
  height: { min: -85, max: 65 },
  cloudHeight: { min: 125, max: 175 },
  /** A sea of cloud far below the track gives the void depth. */
  cloudSea: { min: -230, max: -185 },
  cloudBlock: 8,
} as const;

export type MobKind = 'creeper' | 'zombie' | 'skeleton' | 'spider';
export interface MobSpot { kind: MobKind; x: number; y: number; s: number; yaw: number }
export interface Waterfall { x: number; top: number; bottom: number; s: number; width: number; facing: 1 | -1 }
export interface IslandTile {
  /** All island blocks of the tile in one geometry (atlas UVs, baked light in vertex colours). */
  blocks: THREE.BufferGeometry | null;
  clouds: THREE.BufferGeometry | null;
  waterfalls: Waterfall[];
  mobs: MobSpot[];
  ghasts: { x: number; y: number; s: number }[];
}

interface Island { x: number; y: number; s: number; r: number }

/** Places islands without overlaps; positions are deterministic for a seed and tile index. */
function placeIslands(rng: Rng, s0: number): Island[] {
  const { count, radius, clearance, maxLateral, height, tileLength, blockSize } = ISLAND_CONFIG;
  const islands: Island[] = [];
  const target = rng.int(count.min, count.max);
  for (let attempt = 0; attempt < target * 6 && islands.length < target; attempt++) {
    const r = rng.int(radius.min, radius.max);
    const edge = CONFIG.corridor.halfWidth + clearance + r * blockSize;
    // Bias toward the nearer band so the track is framed, with a few far giants.
    const lateral = edge + Math.pow(rng.next(), 1.6) * (maxLateral - edge);
    const island = { x: (rng.chance(0.5) ? -1 : 1) * lateral, y: rng.range(height.min, height.max), s: s0 + rng.next() * tileLength, r };
    const clear = islands.every(o => Math.hypot(o.x - island.x, o.y - island.y, o.s - island.s) > (o.r + r) * blockSize * 1.15 + 12);
    if (clear) islands.push(island);
  }
  return islands;
}

function tree(v: Volume, x: number, y: number, z: number, rng: Rng) {
  const h = rng.int(4, 6);
  for (let i = 0; i < h; i++) v.set(x, y + i, z, B.log);
  for (let dy = h - 3; dy <= h + 1; dy++) {
    const r = dy >= h ? 1 : 2;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      const corner = Math.abs(dx) === r && Math.abs(dz) === r;
      if (corner && (dy >= h || rng.chance(0.6))) continue;
      v.place(x + dx, y + dy, z + dz, B.leaves);
    }
  }
}

/** A small cottage: cobblestone base, plank walls with log corners, lit windows and a stepped roof. */
function cottage(v: Volume, cx: number, y: number, cz: number, rng: Rng) {
  const half = 3, wall = 4;
  for (let dx = -half; dx <= half; dx++) for (let dz = -half; dz <= half; dz++) {
    for (let dy = 1; dy <= wall + half + 1; dy++) v.set(cx + dx, y + dy, cz + dz, B.air);
    v.set(cx + dx, y, cz + dz, B.cobblestone);
    const edge = Math.abs(dx) === half || Math.abs(dz) === half;
    if (!edge) continue;
    const corner = Math.abs(dx) === half && Math.abs(dz) === half;
    for (let dy = 1; dy <= wall; dy++) {
      const windowSpot = !corner && dy === 2 && (Math.abs(dx) === 1 || Math.abs(dz) === 1);
      v.set(cx + dx, y + dy, cz + dz, corner ? B.log : windowSpot ? B.window : B.planks);
    }
  }
  // Door on a random side.
  const side = rng.int(0, 3), [ddx, ddz] = [[half, 0], [-half, 0], [0, half], [0, -half]][side];
  v.set(cx + ddx, y + 1, cz + ddz, B.air);
  v.set(cx + ddx, y + 2, cz + ddz, B.air);
  for (let layer = 0; layer <= half + 1; layer++) {
    const r = half + 1 - layer;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r || layer === half + 1) v.set(cx + dx, y + wall + 1 + layer, cz + dz, B.darkPlanks);
    }
  }
  v.set(cx + ddx + Math.sign(ddx), y + 3, cz + ddz + Math.sign(ddz), B.lantern);
}

/** Builds one floating island's blocks and records its waterfall and mob spots. */
function buildIsland(island: Island, rng: Rng, seed: number, out: IslandTile): THREE.BufferGeometry | null {
  const b = ISLAND_CONFIG.blockSize, r = island.r;
  const R = Math.ceil(r * 1.25) + 3;
  const depthMax = Math.ceil(r * 1.35) + 4, above = 16;
  const v = new Volume(2 * R + 1, depthMax + above, 2 * R + 1);
  const base = depthMax;
  const shape = fbm(seed, 3), hills = fbm(seed + 17, 3), drip = fbm(seed + 31, 2);
  const snowy = island.y > 40;
  const tops = new Map<string, number>();
  for (let i = -R; i <= R; i++) for (let k = -R; k <= R; k++) {
    const angle = Math.atan2(k, i);
    const edge = r * (0.78 + 0.45 * shape(Math.cos(angle) * 1.6 + 5, Math.sin(angle) * 1.6 + 5));
    const d = Math.hypot(i, k) / edge;
    if (d > 1) continue;
    const top = base + Math.round((hills(i * 0.18 + 9, k * 0.18 + 9) - 0.4) * 4 + (1 - d) * 1.5);
    const depth = Math.max(1, Math.round((1 - Math.pow(d, 1.3)) * r * 1.15 + (drip(i * 0.4, k * 0.4) - 0.5) * 4));
    for (let y = top - depth; y <= top; y++) {
      const below = top - y;
      const id = below === 0 ? (snowy ? B.snowyGrass : B.grass) : below <= 2 ? B.dirt : rng.chance(0.05) ? B.coalOre : B.stone;
      v.set(i + R, y, k + R, id);
    }
    // Hanging vines under the rim, like overgrown sky islands.
    if (d > 0.7 && rng.chance(0.22)) {
      const length = rng.int(1, 4);
      for (let y = 1; y <= length; y++) v.place(i + R, top - depth - y, k + R, B.vines);
    }
    tops.set(`${i},${k}`, top);
  }
  const origin: [number, number, number] = [island.x - (R + 0.5) * b, island.y - base * b, -island.s - (R + 0.5) * b];
  const world = (i: number, y: number, k: number) => ({ x: origin[0] + (i + R + 0.5) * b, y: origin[1] + y * b, s: -(origin[2] + (k + R + 0.5) * b) });
  const interior = [...tops.entries()].map(([key, top]) => ({ i: Number(key.split(',')[0]), k: Number(key.split(',')[1]), top }))
    .filter(c => Math.hypot(c.i, c.k) < r * 0.62);
  const used = new Set<string>();
  const claim = (i: number, k: number, size: number) => {
    for (let dx = -size; dx <= size; dx++) for (let dz = -size; dz <= size; dz++) if (used.has(`${i + dx},${k + dz}`)) return false;
    for (let dx = -size; dx <= size; dx++) for (let dz = -size; dz <= size; dz++) used.add(`${i + dx},${k + dz}`);
    return true;
  };
  if (r >= 8 && rng.chance(0.4)) {
    const top = tops.get('0,0') ?? base;
    if (claim(0, 0, 4)) cottage(v, R, top, R, rng);
  }
  const trees = Math.round(r / 2.5) + rng.int(0, 2);
  for (let t = 0; t < trees && interior.length; t++) {
    const c = rng.pick(interior);
    if (claim(c.i, c.k, 2)) tree(v, c.i + R, c.top + 1, c.k + R, rng);
  }
  for (let l = rng.int(0, 2); l > 0 && interior.length; l--) {
    const c = rng.pick(interior);
    if (!claim(c.i, c.k, 0)) continue;
    v.set(c.i + R, c.top + 1, c.k + R, B.cobblestone);
    v.set(c.i + R, c.top + 2, c.k + R, rng.chance(0.5) ? B.lantern : B.glowstone);
  }
  if (rng.chance(0.38) && interior.length) {
    const c = rng.pick(interior);
    if (claim(c.i, c.k, 0)) out.mobs.push({ kind: rng.pick<MobKind>(['creeper', 'zombie', 'skeleton', 'spider']), ...world(c.i, c.top + 1, c.k), yaw: 0 });
  }
  // A waterfall pours off the rim that faces the track.
  if (r >= 6 && rng.chance(0.45)) {
    const facing: 1 | -1 = island.x > 0 ? -1 : 1;
    let rim = 0;
    for (let i = 0; i <= R; i++) if (tops.has(`${facing * i},0`)) rim = i;
    const top = tops.get(`${facing * rim},0`) ?? base;
    const p = world(facing * rim, top, 0);
    out.waterfalls.push({ x: p.x + facing * b / 2, top: p.y + b * 0.9, bottom: p.y - b * (r * 1.4 + rng.int(6, 16)), s: p.s, width: b * rng.int(1, 2), facing });
  }
  return meshVolume(v, { blockSize: b, origin, light: sunsetLight });
}

/** Flat, blocky clouds: a few high above the islands and a broad sea of them far below. */
function buildClouds(rng: Rng, s0: number): THREE.BufferGeometry | null {
  const { cloudBlock: b, tileLength, cloudHeight, cloudSea } = ISLAND_CONFIG;
  const parts: THREE.BufferGeometry[] = [];
  const high = rng.int(2, 4), low = rng.int(4, 7);
  for (let n = 0; n < high + low; n++) {
    const below = n >= high;
    const w = below ? rng.int(14, 30) : rng.int(8, 18), d = below ? rng.int(10, 20) : rng.int(6, 14);
    const v = new Volume(w, 1, d);
    for (let blob = rng.int(2, 4); blob > 0; blob--) {
      const x0 = rng.int(0, w - 4), z0 = rng.int(0, d - 3), x1 = rng.int(x0 + 3, w - 1), z1 = rng.int(z0 + 2, d - 1);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) v.set(x, 0, z, B.cloud);
    }
    const x = rng.range(below ? -950 : -650, below ? 950 : 650) - (w * b) / 2, s = s0 + rng.next() * tileLength;
    const band = below ? cloudSea : cloudHeight;
    // Low clouds catch less light, so they sit back into the dusk.
    const light: [number, number, number] = below ? [0.5, 0.44, 0.7] : [1.05, 1.0, 1.08];
    const geometry = meshVolume(v, { blockSize: b, origin: [x, rng.range(band.min, band.max), -s], light: () => light });
    if (geometry) parts.push(geometry);
  }
  return merge(parts);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

/**
 * Everything one scenery tile contains, in tile-local coordinates: `s` runs 0..tileLength forward
 * from the tile's start (local z = −s). Same seed and index always give the same tile.
 */
export function buildIslandTile(seed: number, index: number): IslandTile {
  const tileSeed = hashSeed(`${seed >>> 0}:islands:${index}`);
  const rng = new Rng(tileSeed);
  const s0 = 0;
  const out: IslandTile = { blocks: null, clouds: null, waterfalls: [], mobs: [], ghasts: [] };
  const parts = placeIslands(rng, s0).map((island, i) => buildIsland(island, rng, tileSeed + i * 101, out))
    .filter((g): g is THREE.BufferGeometry => g !== null);
  out.blocks = merge(parts);
  out.clouds = buildClouds(rng, s0);
  // Mobs look toward the track.
  for (const mob of out.mobs) mob.yaw = (mob.x > 0 ? -1 : 1) * Math.PI / 2 + rng.range(-0.5, 0.5);
  if (rng.chance(0.35)) {
    const side = rng.chance(0.5) ? -1 : 1;
    out.ghasts.push({ x: side * rng.range(70, 260), y: rng.range(25, 90), s: s0 + rng.next() * ISLAND_CONFIG.tileLength });
  }
  return out;
}
