import * as THREE from 'three';
import { CONFIG } from '../game/config';
import type { SurfaceType } from '../game/surfaces';

/** Shared world-space texture origin: logical distance modulo a texture period, set by each view. */
export interface GridOrigin { value: number }

/** How a world draws the track's slabs. */
export interface SurfaceStyle {
  surface(surface: SurfaceType, origin: GridOrigin): THREE.Material;
  /** Glowing trims along the corridor edges and bars across slab ends. */
  edge(surface: SurfaceType, origin: GridOrigin): THREE.Material;
  /** Trim cross-section and end-bar depth, in metres. */
  trim: number;
  bar: number;
}

/** Full-width barriers are jumped, gates have one opening, everything else is a block to steer around. */
export type ObstacleKind = 'block' | 'gate' | 'barrier';
export function obstacleKind(o: { y: number; half: { x: number; y: number }; kind?: ObstacleKind }): ObstacleKind {
  if (o.kind) return o.kind;
  if (o.half.x >= CONFIG.corridor.halfWidth) return 'barrier';
  const onFloor = Math.abs(o.y - o.half.y) < 1e-6;
  // Ordinary floor blocks are 0.8 m half-wide; wider floor pieces belong to a gate.
  return onFloor && o.half.x > 0.85 ? 'gate' : 'block';
}

export interface ObstacleStyle {
  material(kind: ObstacleKind, origin: GridOrigin): THREE.Material;
  edges(kind: ObstacleKind): THREE.LineBasicMaterial | null;
}

/** The original look: one glowing crimson hazard material with bright edges for every kind. */
export function neonObstacles(): ObstacleStyle {
  const material = new THREE.MeshStandardMaterial({ color: 0x5b2438, emissive: 0x9d173e, emissiveIntensity: 0.45, metalness: 0.35, roughness: 0.55 });
  const edges = new THREE.LineBasicMaterial({ color: 0xff677b, toneMapped: false });
  return { material: () => material, edges: () => edges };
}

export interface PickupStyle {
  core: THREE.BufferGeometry;
  coreMaterial: THREE.Material;
  /** Spins around the core; built once per pickup. */
  ring(): THREE.Object3D;
  light: number;
  beam: number;
  burst: number;
  dispose(): void;
}
