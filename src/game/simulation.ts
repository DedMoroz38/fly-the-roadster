import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from './config';
import { ControlState } from './input';
import { Level } from './physics/level';
import { Vec3, Vehicle } from './physics/vehicle';
import { FuelTank } from './fuel';

let rapierReady: Promise<void> | null = null;
/** Rapier's WASM must be initialised once before any world is created. */
export function initPhysics(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init().then(() => undefined);
  return rapierReady;
}

export interface SimulationOptions {
  spawn?: Vec3;
  /** Initial logical origin; spawn and all physics positions remain local. */
  originDistance?: number;
  /** Builds the level in the supplied origin frame; nonzero origins must be passed to its collider sets. */
  createLevel: (world: RAPIER.World, originDistance: number) => Level;
}

/** Snapshot of the car pose used for render interpolation. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  roll: number;
}

/**
 * Deterministic, render-independent game physics. One call to `step` advances exactly one
 * fixed timestep. Everything here is usable headlessly (tests run it in Node).
 */
export class Simulation {
  readonly dt = 1 / CONFIG.physicsHz;
  readonly world: RAPIER.World;
  readonly vehicle: Vehicle;
  readonly level: Level;
  readonly fuel = new FuelTank(CONFIG.fuel.capacity);
  time = 0;
  /** Logical forward coordinate represented by local physics Z=0. */
  originDistance: number;
  prevPose: Pose;
  private queriedSlabVersion = -1;
  private queriedObstacleVersion = -1;

  constructor(opts: SimulationOptions) {
    this.world = new RAPIER.World({ x: 0, y: -CONFIG.gravity, z: 0 });
    this.world.timestep = this.dt;
    this.originDistance = opts.originDistance ?? 0;
    this.level = opts.createLevel(this.world, this.originDistance);
    this.level.setOriginDistance?.(this.originDistance);
    const spawn = opts.spawn ?? { x: 0, y: CONFIG.car.halfExtents.y + 0.02, z: -10 };
    this.vehicle = new Vehicle(this.world, spawn);
    this.prevPose = this.pose();
  }

  /** Number of fuel pickups collected so far (renderers compare to trigger feedback). */
  refuelCount = 0;

  /** Forward distance travelled (metres along -Z). */
  get distance(): number {
    return this.originDistance - this.vehicle.position.z;
  }

  pose(): Pose {
    const p = this.vehicle.position;
    return { x: p.x, y: p.y, z: p.z, roll: this.vehicle.roll };
  }

  step(controls: ControlState) {
    this.prevPose = this.pose();
    this.level.update(this.distance);
    const slabVersion = this.level.slabs.version, obstacleVersion = this.level.obstacles?.version ?? 0;
    if (slabVersion !== this.queriedSlabVersion || obstacleVersion !== this.queriedObstacleVersion) {
      // Streaming may replace a joined surface collider between physics steps.
      // Its shape is ready immediately; Rapier's scene BVH updates during world.step.
      this.vehicle.invalidateSurfaceQueries();
      this.queriedSlabVersion = slabVersion;
      this.queriedObstacleVersion = obstacleVersion;
    }
    this.vehicle.applyControls(controls, this.dt, this.fuel);
    this.world.step();
    this.vehicle.afterStep(controls);
    this.rebaseOrigin();
    this.collectPickups();
    this.time += this.dt;
  }

  /** Changes only the coordinate frame, preserving motion and logical terrain metadata. */
  rebaseOrigin(): number {
    const threshold = CONFIG.origin.rebaseDistance;
    const shift = Math.trunc(-this.vehicle.position.z / threshold) * threshold;
    if (!shift) return 0;
    this.world.forEachRigidBody(body => {
      const p = body.translation();
      const next = body.isKinematic() ? body.nextTranslation() : null;
      body.setTranslation({ x: p.x, y: p.y, z: p.z + shift }, false);
      if (next) body.setNextKinematicTranslation({ x: next.x, y: next.y, z: next.z + shift });
    });
    this.world.forEachCollider(collider => {
      if (collider.parent()) return; // attached colliders follow their body exactly once
      const p = collider.translation();
      collider.setTranslation({ x: p.x, y: p.y, z: p.z + shift });
    });
    this.world.propagateModifiedBodyPositionsToColliders();
    this.originDistance += shift;
    this.prevPose.z += shift;
    this.level.setOriginDistance?.(this.originDistance);
    // Rapier 0.19 refreshes its scene BVH on the next real physics step. For that one
    // frame, surface probes query collider shapes directly instead of stale world bounds.
    this.vehicle.invalidateSurfaceQueries();
    return shift;
  }

  /** Swept sphere test between last and current car position against every active pickup. */
  private collectPickups() {
    const pickups = this.level.activePickups;
    if (!pickups || pickups.size === 0) return;
    const a = this.prevPose;
    const b = this.vehicle.position;
    const r2 = CONFIG.fuel.pickupRadius ** 2;
    for (const p of pickups.values()) {
      const pz = this.originDistance - p.d;
      const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
      const len2 = abx * abx + aby * aby + abz * abz;
      let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (pz - a.z) * abz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const dx = a.x + abx * t - p.x, dy = a.y + aby * t - p.y, dz = a.z + abz * t - pz;
      if (dx * dx + dy * dy + dz * dz <= r2 && this.level.collect?.(p.id)) {
        this.fuel.refill();
        this.refuelCount++;
      }
    }
  }

  dispose() {
    this.level.dispose?.();
    this.world.free();
  }
}
