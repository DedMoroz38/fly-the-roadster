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
  /** Builds the level for this world (static test level or procedural course). */
  createLevel: (world: RAPIER.World) => Level;
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
  prevPose: Pose;

  constructor(opts: SimulationOptions) {
    this.world = new RAPIER.World({ x: 0, y: -CONFIG.gravity, z: 0 });
    this.world.timestep = this.dt;
    this.level = opts.createLevel(this.world);
    const spawn = opts.spawn ?? { x: 0, y: CONFIG.car.halfExtents.y + 0.02, z: -10 };
    this.vehicle = new Vehicle(this.world, spawn);
    if ('carBounds' in this.level) {
      const he = CONFIG.car.halfExtents;
      const m = Math.max(he.x, he.y, he.z) + 0.5;
      this.level.carBounds = () => {
        const p = this.vehicle.position;
        return { min: { x: p.x - m, y: p.y - m, z: p.z - m }, max: { x: p.x + m, y: p.y + m, z: p.z + m } };
      };
    }
    this.prevPose = this.pose();
  }

  /** Number of fuel pickups collected so far (renderers compare to trigger feedback). */
  refuelCount = 0;

  /** Forward distance travelled (metres along -Z). */
  get distance(): number {
    return -this.vehicle.position.z;
  }

  pose(): Pose {
    const p = this.vehicle.position;
    return { x: p.x, y: p.y, z: p.z, roll: this.vehicle.roll };
  }

  step(controls: ControlState) {
    this.prevPose = this.pose();
    this.level.update(this.distance);
    this.vehicle.applyControls(controls, this.dt, this.fuel);
    this.world.step();
    this.vehicle.afterStep(controls);
    this.collectPickups();
    this.time += this.dt;
  }

  /** Swept sphere test between last and current car position against every active pickup. */
  private collectPickups() {
    const pickups = this.level.activePickups;
    if (!pickups || pickups.size === 0) return;
    const a = this.prevPose;
    const b = this.vehicle.position;
    const r2 = CONFIG.fuel.pickupRadius ** 2;
    for (const p of pickups.values()) {
      const pz = -p.d;
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
    this.world.free();
  }
}
