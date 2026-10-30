import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hashSeed } from '../../core/rng';
import { B, meshVolume, Volume } from './mesher';
import { fbm } from './noise';
import { sunsetLight } from './islands';

export const MOUNTAIN_CONFIG = {
  tileLength: 300,
  blockSize: 12,
  /** Lateral band (blocks from the track centre line) and peak height (blocks above the base). */
  inner: 72,
  outer: 122,
  peak: 46,
  baseY: -230,
  snowAbove: 35,
} as const;

/** Blocky, snow-capped ranges on both sides of the track, continuous from tile to tile. */
export function buildMountainTile(seed: number, index: number): THREE.BufferGeometry | null {
  const { tileLength, blockSize: b, inner, outer, peak, baseY, snowAbove } = MOUNTAIN_CONFIG;
  const depth = Math.round(tileLength / b);
  const ridges = fbm(hashSeed(`${seed >>> 0}:mountains`), 5);
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const width = outer - inner;
    const v = new Volume(width, peak + 2, depth);
    for (let i = 0; i < width; i++) for (let k = 0; k < depth; k++) {
      const lateral = inner + i;
      // Noise in course-wide coordinates keeps ranges continuous across tile seams. Block row k
      // sits at local z = −tileLength + k·b, i.e. (depth − k) blocks ahead of the tile start.
      const along = (index + 1) * depth - k;
      const n = ridges(lateral * 0.07 + (side > 0 ? 100 : 0), along * 0.07);
      const ridge = 1 - Math.abs(n * 2 - 1);
      // Ranges rise from nothing near the track and fall off again at the far edge.
      const profile = Math.sin(Math.PI * i / (width - 1));
      const h = Math.round(Math.pow(ridge, 2.2) * peak * profile);
      if (h <= 0) continue;
      for (let y = 0; y <= h; y++) {
        const top = y === h, worldY = baseY + (y + 1) * b;
        v.set(i, y, k, top ? (worldY > snowAbove ? B.snow : B.grass) : y >= h - 1 ? B.dirt : B.stone);
      }
    }
    const x0 = side > 0 ? inner * b : -outer * b;
    // Mirror the left range so its columns still run outward from the track.
    // Tile content runs from local z = 0 forward to −tileLength.
    const geometry = meshVolume(side > 0 ? v : mirror(v), { blockSize: b, origin: [x0, baseY, -tileLength], light: sunsetLight });
    if (geometry) parts.push(geometry);
  }
  if (!parts.length) return null;
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}

function mirror(v: Volume): Volume {
  const out = new Volume(v.nx, v.ny, v.nz);
  for (let z = 0; z < v.nz; z++) for (let y = 0; y < v.ny; y++) for (let x = 0; x < v.nx; x++) out.set(v.nx - 1 - x, y, z, v.get(x, y, z));
  return out;
}
