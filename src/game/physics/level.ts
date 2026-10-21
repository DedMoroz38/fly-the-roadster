import RAPIER from '@dimforge/rapier3d-compat';
import { Slab, SurfaceType, slabParts } from '../surfaces';

/**
 * Owns the static surface colliders in the physics world. Subclasses / users decide which
 * slabs exist; this class just keeps physics in sync and exposes the active set to renderers.
 */
export class SlabSet {
  readonly active = new Map<number, Slab>();
  private colliders = new Map<number, RAPIER.Collider[]>();
  private surfaceByCollider = new Map<number, SurfaceType>();
  /** Incremented whenever the active set changes, so renderers can cheaply detect diffs. */
  version = 0;

  constructor(private world: RAPIER.World) {}

  add(slab: Slab) {
    if (this.active.has(slab.id)) return;
    const { box, lead } = slabParts(slab.surface, slab.d0, slab.d1, slab.bevel !== false);
    const descs: RAPIER.ColliderDesc[] = [];
    if (box) descs.push(RAPIER.ColliderDesc.cuboid(box.half.x, box.half.y, box.half.z).setTranslation(box.center.x, box.center.y, box.center.z));
    if (lead) descs.push(RAPIER.ColliderDesc.convexHull(lead)!);
    const cols = descs.map((desc) => this.world.createCollider(desc.setFriction(0).setRestitution(0)));
    this.active.set(slab.id, slab);
    this.colliders.set(slab.id, cols);
    for (const c of cols) this.surfaceByCollider.set(c.handle, slab.surface);
    this.version++;
  }

  remove(id: number) {
    const cols = this.colliders.get(id);
    if (!cols) return;
    for (const c of cols) {
      this.surfaceByCollider.delete(c.handle);
      this.world.removeCollider(c, false);
    }
    this.colliders.delete(id);
    this.active.delete(id);
    this.version++;
  }

  clear() {
    for (const id of [...this.active.keys()]) this.remove(id);
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

/** Something that decides which slabs exist around the car (static test level or procedural course). */
export interface Level {
  readonly slabs: SlabSet;
  /** Called every fixed step with the car's current forward distance. */
  update(carDistance: number): void;
  /** Optional fuel pickups currently in play. */
  readonly activePickups?: Map<number, PickupLike>;
  collect?(id: number): boolean;
  /** Optional hook so the level can avoid spawning geometry inside the car. */
  carBounds?: (() => { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }) | null;
}

/** Fixed list of slabs (and optional pickups); used by tests and debugging. */
export class StaticLevel implements Level {
  readonly slabs: SlabSet;
  readonly activePickups = new Map<number, PickupLike>();
  constructor(world: RAPIER.World, slabs: Omit<Slab, 'id'>[], pickups: Omit<PickupLike, 'id'>[] = []) {
    this.slabs = new SlabSet(world);
    slabs.forEach((s, i) => {
      const continues = slabs.some((o) => o !== s && o.surface === s.surface && Math.abs(o.d1 - s.d0) < 1e-6);
      this.slabs.add({ bevel: !continues, ...s, id: i + 1 });
    });
    pickups.forEach((p, i) => this.activePickups.set(i + 1, { ...p, id: i + 1 }));
  }
  update() {}
  collect(id: number) {
    return this.activePickups.delete(id);
  }
}
