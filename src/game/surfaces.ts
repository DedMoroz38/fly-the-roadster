import { CONFIG } from './config';

export type SurfaceType = 'floor' | 'ceiling' | 'left' | 'right';
export const SURFACES: readonly SurfaceType[] = ['floor', 'ceiling', 'left', 'right'];

/** A slab of one surface type spanning forward distance [d0, d1) (distance = -z). */
export interface Slab {
  id: number;
  surface: SurfaceType;
  d0: number;
  d1: number;
  /** False when the slab directly continues another slab of the same surface (no leading ramp). */
  bevel?: boolean;
}

export interface Box {
  center: { x: number; y: number; z: number };
  half: { x: number; y: number; z: number };
}

/** Inward-facing normal of each surface (pointing into the corridor). */
export const SURFACE_NORMAL: Record<SurfaceType, { x: number; y: number; z: number }> = {
  floor: { x: 0, y: 1, z: 0 },
  ceiling: { x: 0, y: -1, z: 0 },
  left: { x: 1, y: 0, z: 0 },
  right: { x: -1, y: 0, z: 0 },
};

/** Physical box for a slab. Slabs live entirely outside the corridor interior. */
export function slabBox(surface: SurfaceType, d0: number, d1: number): Box {
  const { halfWidth: W, height: H, slabThickness: T } = CONFIG.corridor;
  const halfZ = (d1 - d0) / 2;
  const z = -(d0 + d1) / 2;
  switch (surface) {
    case 'floor':
      return { center: { x: 0, y: -T / 2, z }, half: { x: W + T, y: T / 2, z: halfZ } };
    case 'ceiling':
      return { center: { x: 0, y: H + T / 2, z }, half: { x: W + T, y: T / 2, z: halfZ } };
    case 'left':
      return { center: { x: -W - T / 2, y: H / 2, z }, half: { x: T / 2, y: H / 2, z: halfZ } };
    case 'right':
      return { center: { x: W + T / 2, y: H / 2, z }, half: { x: T / 2, y: H / 2, z: halfZ } };
  }
}

/** Classifies a contact normal (pointing away from the surface) into a surface type. */
export function classifyNormal(n: { x: number; y: number; z: number }): SurfaceType | null {
  if (n.y > 0.7) return 'floor';
  if (n.y < -0.7) return 'ceiling';
  if (n.x > 0.7) return 'left';
  if (n.x < -0.7) return 'right';
  return null;
}

/** Length (m) of the ramp cut into the inner leading edge of every slab. */
export const LEAD_BEVEL = 3;

/**
 * Slabs up to this length are a single convex piece (no internal seams). Longer slabs (only
 * used by recovery roads and debug levels) get a convex lead piece plus a
 * box, because one very long thin hull loses precision.
 */
export const MAX_HULL_LENGTH = 450;
export const LEAD_PIECE = 40;

/**
 * Geometry of one slab: a leading convex piece whose inner leading edge is bevelled into a
 * shallow ramp (so grazing the start of a slab deflects the car instead of stopping it dead),
 * followed by an exact box for the rest. The two meet LEAD_PIECE metres in, far enough that a
 * grazing car has already been pushed back inside the corridor. (Split because one long, thin
 * convex hull loses precision.)
 */
export function slabParts(
  surface: SurfaceType,
  d0: number,
  d1: number,
  withBevel = true,
): { box: Box | null; lead: Float32Array | null } {
  const { halfWidth: W, height: H, slabThickness: T } = CONFIG.corridor;
  if (!withBevel) return { box: slabBox(surface, d0, d1), lead: null };
  const leadEnd = d1 - d0 <= MAX_HULL_LENGTH ? d1 : d0 + LEAD_PIECE;
  const bevel = Math.min(LEAD_BEVEL, (leadEnd - d0) / 2);
  // (lateral, depth outward from the inner plane, z) -> world
  const map = (lat: number, depth: number, z: number): [number, number, number] => {
    switch (surface) {
      case 'floor': return [lat, -depth, z];
      case 'ceiling': return [lat, H + depth, z];
      case 'left': return [-W - depth, lat, z];
      case 'right': return [W + depth, lat, z];
    }
  };
  const lats = surface === 'floor' || surface === 'ceiling' ? [-W - T, W + T] : [0, H];
  const pts: number[] = [];
  for (const lat of lats) {
    pts.push(...map(lat, T, -d0)); // outer front edge
    pts.push(...map(lat, 0, -d0 - bevel)); // top of the ramp on the inner plane
    pts.push(...map(lat, T, -leadEnd)); // outer, end of lead piece
    pts.push(...map(lat, 0, -leadEnd)); // inner, end of lead piece
  }
  return { box: leadEnd < d1 ? slabBox(surface, leadEnd, d1) : null, lead: new Float32Array(pts) };
}
