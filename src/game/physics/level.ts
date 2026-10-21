import RAPIER from '@dimforge/rapier3d-compat';
import { Slab, SurfaceType, slabParts, slabBox, MAX_HULL_LENGTH, LEAD_BEVEL } from '../surfaces';

/** The six outward-facing quad faces of the eight-vertex slab prism. */
function slabHullIndices(points: Float32Array): Uint32Array {
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [0, 4, 6, 2], [1, 3, 7, 5], [2, 6, 7, 3]];
  const centre = [0, 0, 0];
  for (let i = 0; i < points.length; i++) centre[i % 3] += points[i] / 8;
  const indices: number[] = [];
  for (const face of faces) {
    const a = face[0] * 3, b = face[1] * 3, c = face[2] * 3;
    const u = [points[b] - points[a], points[b + 1] - points[a + 1], points[b + 2] - points[a + 2]];
    const v = [points[c] - points[a], points[c + 1] - points[a + 1], points[c + 2] - points[a + 2]];
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const outward = normal.reduce((sum, value, axis) => sum + value * (points[a + axis] - centre[axis]), 0);
    if (outward < 0) face.reverse();
    indices.push(face[0], face[1], face[2], face[0], face[2], face[3]);
  }
  return new Uint32Array(indices);
}

/**
 * Owns the static surface colliders in the physics world. Subclasses / users decide which
 * slabs exist; this class just keeps physics in sync and exposes the active set to renderers.
 */
export class SlabSet {
  readonly active = new Map<number, Slab>();
  private colliders = new Map<string, { surface: SurfaceType; collider: RAPIER.Collider }>();
  private surfaceByCollider = new Map<number, SurfaceType>();
  /** Incremented whenever the active set changes, so renderers can cheaply detect diffs. */
  version = 0;

  private originDistance = 0;
  constructor(private world: RAPIER.World) {}

  /** Existing colliders are shifted together by Simulation; this affects future additions. */
  setOriginDistance(total: number) { this.originDistance = total; }

  /** Logical slabs sharing an uninterrupted plane share a single physical collider. */
  get colliderCount() { return this.colliders.size; }

  add(slab: Slab) {
    if (this.active.has(slab.id)) return;
    this.active.set(slab.id, slab);
    this.rebuildSurface(slab.surface);
    this.version++;
  }

  remove(id: number) {
    const slab = this.active.get(id);
    if (!slab) return;
    this.active.delete(id);
    this.rebuildSurface(slab.surface);
    this.version++;
  }

  clear() {
    if (!this.active.size) return;
    for (const { collider } of this.colliders.values()) this.world.removeCollider(collider, false);
    this.colliders.clear();
    this.surfaceByCollider.clear();
    this.active.clear();
    this.version++;
  }

  private rebuildSurface(surface: SurfaceType) {
    const slabs = [...this.active.values()].filter(s => s.surface === surface).sort((a, b) => a.d0 - b.d0);
    const runs: { d0: number; d1: number; bevelLength: number }[] = [];
    for (const slab of slabs) {
      const previous = runs.at(-1);
      // A declared continuation has no visible ramp. Coalescing removes internal front
      // and back faces that otherwise kick slightly penetrating tyres at streaming seams.
      // An actual new bevel after a gap remains a separate landing surface.
      const bevelLength = slab.bevel === false ? 0 : Math.min(LEAD_BEVEL, (slab.d1 - slab.d0) / 2);
      if (previous && slab.d0 >= previous.d0 + previous.bevelLength - 1e-6 &&
        slab.d0 + bevelLength <= previous.d1 + 1e-6) {
        previous.d1 = Math.max(previous.d1, slab.d1);
      } else runs.push({ d0: slab.d0, d1: slab.d1, bevelLength });
    }
    const keyed = runs.map(run => ({ ...run, key: `${surface}:${run.d0}:${run.d1}:${run.bevelLength}` }));
    const desired = new Set(keyed.map(run => run.key));
    for (const [key, entry] of this.colliders) {
      if (entry.surface !== surface || desired.has(key)) continue;
      this.surfaceByCollider.delete(entry.collider.handle);
      this.world.removeCollider(entry.collider, false);
      this.colliders.delete(key);
    }
    for (const run of keyed) {
      if (this.colliders.has(run.key)) continue;
      const length = run.d1 - run.d0;
      let desc: RAPIER.ColliderDesc;
      if (!run.bevelLength) {
        const box = slabBox(surface, 0, length);
        desc = RAPIER.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z)
          .setTranslation(box.center.x, box.center.y, this.originDistance - run.d0 + box.center.z);
      } else {
        // A centered closed triangle mesh preserves the exact ramp and flat plane of
        // the bounded retained run. Splitting it creates internal collision faces;
        // convex hull inference can discard the thin inner face on a long road.
        // The short template fixes the ramp; extend only its back vertices.
        const templateLength = Math.min(length, MAX_HULL_LENGTH);
        const points = slabParts(surface, 0, templateLength, true).lead!;
        points[5] = points[17] = -run.bevelLength;
        const centreZ = -length / 2;
        for (let i = 2; i < points.length; i += 3) {
          const z = points[i] === -templateLength ? -length : points[i];
          points[i] = z - centreZ;
        }
        // Internal-edge fixing suppresses spurious contact normals at coplanar
        // triangle joins. Triangle ray intersections also avoid long-prism GJK error.
        desc = RAPIER.ColliderDesc.trimesh(points, slabHullIndices(points), RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
          .setTranslation(0, 0, this.originDistance - run.d0 + centreZ);
      }
      const collider = this.world.createCollider(desc.setFriction(0).setRestitution(0));
      this.colliders.set(run.key, { surface, collider });
      this.surfaceByCollider.set(collider.handle, surface);
    }
  }

  surfaceOf(colliderHandle: number): SurfaceType | undefined {
    return this.surfaceByCollider.get(colliderHandle);
  }
}

export interface PickupLike {
  id: number;
  x: number;
  y: number;
  d: number;
  surface?: string;
}

/** A solid hazard box, using forward distance rather than world Z. */
export interface ObstacleLike {
  id: number;
  x: number;
  y: number;
  d: number;
  half: { x: number; y: number; z: number };
}

/** Static hazard colliders with the same bounded add/remove lifecycle as surface slabs. */
export class ObstacleSet {
  readonly active = new Map<number, ObstacleLike>();
  private colliders = new Map<number, RAPIER.Collider>();
  version = 0;

  private originDistance = 0;
  constructor(private world: RAPIER.World) {}

  /** Existing colliders are shifted together by Simulation; this affects future additions. */
  setOriginDistance(total: number) { this.originDistance = total; }

  add(obstacle: ObstacleLike) {
    if (this.active.has(obstacle.id)) return;
    const { x, y, z } = obstacle.half;
    const collider = this.world.createCollider(RAPIER.ColliderDesc.cuboid(x, y, z)
      .setTranslation(obstacle.x, obstacle.y, this.originDistance - obstacle.d).setFriction(0).setRestitution(0));
    this.colliders.set(obstacle.id, collider);
    this.active.set(obstacle.id, { ...obstacle, half: { ...obstacle.half } });
    this.version++;
  }

  remove(id: number) {
    const collider = this.colliders.get(id);
    if (!collider) return;
    this.world.removeCollider(collider, false);
    this.colliders.delete(id);
    this.active.delete(id);
    this.version++;
  }

  clear() {
    for (const id of [...this.active.keys()]) this.remove(id);
  }
}

/** Something that decides which slabs exist around the car (static test level or procedural course). */
export interface Level {
  readonly slabs: SlabSet;
  readonly obstacles?: ObstacleSet;
  dispose?(): void;
  setOriginDistance?(total: number): void;
  /** Called every fixed step with the car's current forward distance. */
  update(carDistance: number): void;
  /** Optional fuel pickups currently in play. */
  readonly activePickups?: Map<number, PickupLike>;
  collect?(id: number): boolean;
}

/** Fixed list of slabs (and optional pickups); used by tests and debugging. */
export class StaticLevel implements Level {
  readonly slabs: SlabSet;
  readonly obstacles: ObstacleSet;
  readonly activePickups = new Map<number, PickupLike>();
  constructor(world: RAPIER.World, slabs: Omit<Slab, 'id'>[], pickups: Omit<PickupLike, 'id'>[] = [], obstacles: ObstacleLike[] = [], originDistance = 0) {
    this.slabs = new SlabSet(world);
    this.obstacles = new ObstacleSet(world);
    this.setOriginDistance(originDistance);
    slabs.forEach((s, i) => {
      const continues = slabs.some((o) => o !== s && o.surface === s.surface && Math.abs(o.d1 - s.d0) < 1e-6);
      this.slabs.add({ bevel: !continues, ...s, id: i + 1 });
    });
    pickups.forEach((p, i) => this.activePickups.set(i + 1, { ...p, id: i + 1 }));
    obstacles.forEach(o => this.obstacles.add(o));
  }
  update() {}
  setOriginDistance(total: number) {
    this.slabs.setOriginDistance(total);
    this.obstacles.setOriginDistance(total);
  }
  dispose() {
    this.slabs.clear();
    this.obstacles.clear();
    this.activePickups.clear();
  }
  collect(id: number) {
    return this.activePickups.delete(id);
  }
}
