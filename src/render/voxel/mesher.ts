import * as THREE from 'three';
import { atlasRect, type BlockTexture } from './textures';

/** Block ids stored in a Volume; 0 is air. */
export const B = {
  air: 0, stone: 1, dirt: 2, grass: 3, log: 4, leaves: 5, planks: 6, darkPlanks: 7, cobblestone: 8,
  glowstone: 9, lantern: 10, window: 11, coalOre: 12, snowyGrass: 13, vines: 14, cloud: 15,
  stoneBricks: 16, mossyBricks: 17, obsidian: 18, cryingObsidian: 19, snow: 20,
} as const;
export type BlockId = typeof B[keyof typeof B];

interface BlockDef {
  top: BlockTexture; side: BlockTexture; bottom: BlockTexture;
  /** Leaves and vines let neighbours show through and never darken them. */
  seeThrough?: boolean;
  /** Light sources: drawn at this brightness (above 1 so the bloom pass picks them up). */
  glow?: number;
}
const same = (t: BlockTexture, extra: Partial<BlockDef> = {}): BlockDef => ({ top: t, side: t, bottom: t, ...extra });

export const BLOCKS: Record<number, BlockDef> = {
  [B.stone]: same('stone'),
  [B.dirt]: same('dirt'),
  [B.grass]: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  [B.log]: { top: 'log_top', side: 'log_side', bottom: 'log_top' },
  [B.leaves]: same('leaves', { seeThrough: true }),
  [B.planks]: same('planks'),
  [B.darkPlanks]: same('dark_planks'),
  [B.cobblestone]: same('cobblestone'),
  [B.glowstone]: same('glowstone', { glow: 2.6 }),
  [B.lantern]: same('lantern', { glow: 2.8 }),
  [B.window]: same('window_lit', { glow: 2.2 }),
  [B.coalOre]: same('coal_ore'),
  [B.snowyGrass]: { top: 'snow', side: 'snow_side', bottom: 'dirt' },
  [B.vines]: same('vines', { seeThrough: true }),
  [B.cloud]: same('cloud'),
  [B.stoneBricks]: same('stone_bricks'),
  [B.mossyBricks]: same('mossy_bricks'),
  [B.obsidian]: same('obsidian'),
  [B.cryingObsidian]: same('crying_obsidian', { glow: 1.6 }),
  [B.snow]: same('snow'),
};

/** A dense block grid. Coordinates outside the grid read as air. */
export class Volume {
  readonly data: Uint8Array;
  constructor(readonly nx: number, readonly ny: number, readonly nz: number) {
    this.data = new Uint8Array(nx * ny * nz);
  }
  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return B.air;
    return this.data[(z * this.ny + y) * this.nx + x];
  }
  set(x: number, y: number, z: number, id: number) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return;
    this.data[(z * this.ny + y) * this.nx + x] = id;
  }
  /** Only fills air, so features never overwrite terrain. */
  place(x: number, y: number, z: number, id: number) {
    if (this.get(x, y, z) === B.air) this.set(x, y, z, id);
  }
}

type V3 = [number, number, number];
interface Face { n: V3; corners: V3[]; texture: 'top' | 'side' | 'bottom'; shade: number }
// Corners run counter-clockwise seen from outside: bottom-left, bottom-right, top-right, top-left.
const FACES: Face[] = [
  { n: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], texture: 'side', shade: 0.8 },
  { n: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], texture: 'side', shade: 0.8 },
  { n: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], texture: 'top', shade: 1 },
  { n: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], texture: 'bottom', shade: 0.52 },
  { n: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], texture: 'side', shade: 0.66 },
  { n: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], texture: 'side', shade: 0.66 },
];
const AO = [0.5, 0.68, 0.84, 1];

export interface MeshOptions {
  /** Metres per block. */
  blockSize: number;
  /** World position of block (0, 0, 0)'s minimum corner. */
  origin: V3;
  /** Per-face colour multiplier from a face normal, e.g. warm light on sun-facing faces. */
  light?: (n: V3) => V3;
}

/**
 * Builds one indexed geometry for a volume, emitting only faces next to air (or see-through
 * blocks), with per-vertex ambient occlusion and face shading baked into vertex colours.
 */
export function meshVolume(volume: Volume, { blockSize, origin, light }: MeshOptions): THREE.BufferGeometry | null {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const opaque = (x: number, y: number, z: number) => {
    const id = volume.get(x, y, z);
    return id !== B.air && !BLOCKS[id]?.seeThrough;
  };
  const lit = FACES.map(face => light?.(face.n) ?? [1, 1, 1] as V3);
  for (let z = 0; z < volume.nz; z++) for (let y = 0; y < volume.ny; y++) for (let x = 0; x < volume.nx; x++) {
    const id = volume.get(x, y, z);
    if (id === B.air) continue;
    const def = BLOCKS[id];
    FACES.forEach((face, f) => {
      const [nx, ny, nz] = face.n;
      const neighbour = volume.get(x + nx, y + ny, z + nz);
      if (neighbour !== B.air && (!BLOCKS[neighbour]?.seeThrough || neighbour === id)) return;
      const [u0, v0, u1, v1] = atlasRect(def[face.texture]);
      const quadUv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const base = positions.length / 3;
      const ao: number[] = [];
      face.corners.forEach((c, k) => {
        positions.push(origin[0] + (x + c[0]) * blockSize, origin[1] + (y + c[1]) * blockSize, origin[2] + (z + c[2]) * blockSize);
        uvs.push(quadUv[k][0], quadUv[k][1]);
        // Occlusion from the three blocks around this corner, in the layer the face looks into.
        const ox = x + nx, oy = y + ny, oz = z + nz;
        const t = [0, 1, 2].filter(axis => face.n[axis] === 0);
        const d1: V3 = [0, 0, 0], d2: V3 = [0, 0, 0];
        d1[t[0]] = c[t[0]] ? 1 : -1;
        d2[t[1]] = c[t[1]] ? 1 : -1;
        const s1 = opaque(ox + d1[0], oy + d1[1], oz + d1[2]) ? 1 : 0;
        const s2 = opaque(ox + d2[0], oy + d2[1], oz + d2[2]) ? 1 : 0;
        const corner = opaque(ox + d1[0] + d2[0], oy + d1[1] + d2[1], oz + d1[2] + d2[2]) ? 1 : 0;
        const level = s1 && s2 ? 0 : 3 - (s1 + s2 + corner);
        ao.push(level);
        const k2 = def.glow ?? face.shade * AO[level];
        const tint = def.glow ? [1, 1, 1] : lit[f];
        colors.push(k2 * tint[0], k2 * tint[1], k2 * tint[2]);
      });
      // Split each quad along the diagonal that keeps occlusion gradients smooth.
      if (ao[0] + ao[2] >= ao[1] + ao[3]) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    });
  }
  if (!indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(positions.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
