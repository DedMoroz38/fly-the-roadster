import * as THREE from 'three';
import { hashSeed, Rng } from '../../core/rng';
import { CONFIG } from '../../game/config';
import { fbm, valueNoise } from '../voxel/noise';
import type { FormKind } from './landforms';

/**
 * The ground beside the causeway drifts past at the car's real speed. The track runs above a dry
 * channel, deep enough that a car falling out of the corridor never meets the ground before the run
 * ends; the plains on both sides sit just below the deck, as in a causeway across the desert.
 */
export const GROUND = {
  tileLength: 120,
  rowStep: 3,
  lateral: 1000,
  plain: -3.2,
  channel: { halfWidth: 22, floor: -21, bank: 7 },
  ahead: 760,
  behind: 60,
} as const;

const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground height at lateral x and course distance s (metres). */
export function groundSampler(seed: number) {
  const dunes = fbm(hashSeed(`${seed >>> 0}:dunes`), 4);
  const swell = fbm(hashSeed(`${seed >>> 0}:swell`), 3);
  const { plain, channel } = GROUND;
  return (x: number, s: number) => {
    const ax = Math.abs(x);
    // Gentle dunes next to the track, larger rolling ground and rises further out.
    let h = plain + (dunes(x * 0.03, s * 0.03) - 0.5) * 2 * (0.6 + smoothstep(30, 120, ax) * 0.8);
    // Landmarks scroll slower than the ground, so the band they stand in (to 500 m out) stays close
    // to plain level; the big rises are reserved for the far ground beyond them.
    const n = swell(x * 0.004 + 3, s * 0.004);
    h += (n - 0.5) * 3 * smoothstep(120, 400, ax) + (n - 0.35) * 40 * smoothstep(650, 1000, ax);
    const bank = smoothstep(channel.halfWidth, channel.halfWidth + channel.bank, ax);
    const bed = channel.floor + (dunes(x * 0.08 + 40, s * 0.05) - 0.5) * 1.2;
    return bed + (h - bed) * bank;
  };
}

/** Lateral sample positions: dense beside the track, sparser toward the horizon. */
export function groundColumns(): number[] {
  const half: number[] = [];
  for (let x = 0; x < GROUND.lateral; x += 1.4 + x * 0.075) half.push(x);
  half.push(GROUND.lateral);
  return [...half.slice(1).reverse().map(x => -x), ...half];
}

/** sRGB ground tones: rust plains, dark basalt patches, pale wind-blown dust, a dim channel bed. */
const SOIL = { rust: new THREE.Color(0xa34a22), basalt: new THREE.Color(0x4f2414), dust: new THREE.Color(0xc77c48), bed: new THREE.Color(0x5e2a15) };

export type NearFeatureKind = 'rover' | 'crew' | 'depot';
export interface NearFeature { kind: NearFeatureKind; x: number; y: number; t: number; yaw: number; seed: number }
export interface Outcrop { kind: FormKind; x: number; y: number; t: number; radius: number; height: number; yaw: number; seed: number }
export interface GroundTile {
  geometry: THREE.BufferGeometry;
  /** Boulder instances: position (x, y, local z), scale (x, y, z), yaw, brightness. */
  rocks: Float32Array;
  outcrops: Outcrop[];
  features: NearFeature[];
}
export const ROCK_STRIDE = 8;

/** How rare the near-track sights are: about one every 1.7 km, after a guaranteed early one. */
export const NEAR_FEATURES = { firstTile: 2, chance: 0.07, kinds: ['rover', 'crew', 'depot'] as NearFeatureKind[] } as const;

export function nearFeatureKind(seed: number, index: number): NearFeatureKind | null {
  const rng = new Rng(hashSeed(`${seed >>> 0}:near:${index}`));
  // The opening always shows a rover crossing the plain, so every run meets one.
  if (index === NEAR_FEATURES.firstTile) return 'rover';
  if (index <= NEAR_FEATURES.firstTile + 2) return null;
  if (!rng.chance(NEAR_FEATURES.chance)) return null;
  // Never two in a row: the previous tile wins.
  if (index > NEAR_FEATURES.firstTile + 3 && nearFeatureKind(seed, index - 1)) return null;
  return rng.pick(NEAR_FEATURES.kinds);
}

/** One tile of ground: heightfield mesh with baked colours, scattered boulders, outcrops and rare sights. */
export function buildGroundTile(seed: number, index: number): GroundTile {
  const { tileLength, rowStep, channel } = GROUND;
  const height = groundSampler(seed);
  const patches = fbm(hashSeed(`${seed >>> 0}:patches`), 4);
  const speck = valueNoise(hashSeed(`${seed >>> 0}:speck`));
  const xs = groundColumns();
  const rows = Math.round(tileLength / rowStep);
  const s0 = index * tileLength;
  const positions = new Float32Array((rows + 1) * xs.length * 3);
  const colors = new Float32Array(positions.length);
  const uvs = new Float32Array((rows + 1) * xs.length * 2);
  const c = new THREE.Color();
  let v = 0;
  for (let r = 0; r <= rows; r++) {
    const t = r * rowStep, s = s0 + t;
    for (const x of xs) {
      const y = height(x, s);
      positions.set([x, y, -t], v * 3);
      // Grit texture repeats every 6 m; 120 / 6 is whole, so it is seamless across tiles.
      uvs.set([x / 6, t / 6], v * 2);
      const p = patches(x * 0.012, s * 0.012), d = speck(x * 0.3, s * 0.3);
      c.copy(SOIL.rust).lerp(SOIL.basalt, smoothstep(0.58, 0.78, p) * 0.75).lerp(SOIL.dust, smoothstep(0.5, 0.25, p) * 0.55);
      c.multiplyScalar(0.9 + d * 0.2);
      // The channel bed and its banks are in shadow most of the day.
      c.lerp(SOIL.bed, 1 - smoothstep(channel.floor + 2, GROUND.plain - 1, y));
      c.toArray(colors, v * 3);
      v++;
    }
  }
  const indices: number[] = [];
  const n = xs.length;
  for (let r = 0; r < rows; r++) for (let k = 0; k < n - 1; k++) {
    const a = r * n + k, b = a + 1, d = a + n, e = d + 1;
    indices.push(a, b, d, b, e, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const rng = new Rng(hashSeed(`${seed >>> 0}:ground:${index}`));
  // Boulders: many small stones near the track, a few big ones further out, some in the channel.
  const rockCount = rng.int(70, 110);
  const rocks = new Float32Array(rockCount * ROCK_STRIDE);
  for (let i = 0; i < rockCount; i++) {
    const inChannel = rng.chance(0.12);
    const ax = inChannel ? rng.range(CONFIG.corridor.halfWidth + 2, channel.halfWidth + channel.bank) : channel.halfWidth + channel.bank + Math.pow(rng.next(), 2.2) * 420;
    const x = (rng.chance(0.5) ? -1 : 1) * ax;
    const t = rng.next() * tileLength;
    const big = rng.chance(0.08);
    const size = big ? rng.range(2.2, 5.5) : rng.range(0.25, 1.3) * (1 + ax / 300);
    const y = height(x, s0 + t) - size * 0.3;
    rocks.set([x, y, -t, size * rng.range(0.8, 1.3), size * rng.range(0.6, 1.1), size * rng.range(0.8, 1.3), rng.range(0, Math.PI * 2), rng.range(0.7, 1.05)], i * ROCK_STRIDE);
  }

  // Rock outcrops close to the track pass at full speed and sell the sense of speed.
  const outcrops: Outcrop[] = [];
  const outcropCount = rng.chance(0.55) ? rng.int(1, 2) : 0;
  for (let i = 0; i < outcropCount; i++) {
    const kind: FormKind = rng.pick(['ledge', 'ledge', 'butte', 'spire'] as const);
    const radius = kind === 'spire' ? rng.range(3, 6) : rng.range(8, 22);
    const ax = channel.halfWidth + channel.bank + radius * 1.5 + rng.range(10, 160);
    const x = (rng.chance(0.5) ? -1 : 1) * ax, t = rng.next() * tileLength;
    outcrops.push({
      kind, x, t, radius, yaw: rng.range(0, Math.PI * 2), seed: rng.int(0, 1e9),
      height: kind === 'ledge' ? rng.range(4, 12) : kind === 'spire' ? rng.range(14, 26) : rng.range(14, 30),
      y: height(x, s0 + t),
    });
  }

  const features: NearFeature[] = [];
  const kind = nearFeatureKind(seed, index);
  if (kind) {
    // Close enough to make out, never inside the channel or on the banks.
    const side = rng.chance(0.5) ? -1 : 1;
    const ax = { rover: rng.range(36, 60), crew: rng.range(31, 40), depot: rng.range(55, 95) }[kind];
    const t = rng.range(20, tileLength - 20);
    features.push({ kind, x: side * ax, y: height(side * ax, s0 + t), t, yaw: rng.range(0, Math.PI * 2), seed: rng.int(0, 1e9) });
  }
  return { geometry, rocks, outcrops, features };
}
