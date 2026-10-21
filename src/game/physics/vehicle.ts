import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import { ControlState } from '../input';
import { clamp, wrapAngle } from '../../core/math';
import { classifyNormal, SurfaceType } from '../surfaces';
import { FuelTank } from '../fuel';
import { advanceSuctionHeat, evaluateSuction, SuctionState } from '../suction';

export type Vec3 = { x: number; y: number; z: number };

export interface SurfaceProbe {
  /** Gap between the wheels (car underside) and the surface. */
  gap: number;
  normal: Vec3;
  surface: SurfaceType | null;
  /** cos of the angle between the car's up and the surface normal (1 = wheels face it squarely). */
  alignment: number;
}

export type MovementMode = 'grounded' | 'attached' | 'airborne';

/** Car axes derived from the roll angle (rotation about world Z only). */
export function carAxes(roll: number) {
  const s = Math.sin(roll), c = Math.cos(roll);
  return {
    up: { x: -s, y: c, z: 0 },
    right: { x: c, y: s, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
  };
}

const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Arcade vehicle on top of a Rapier dynamic body. Rotation is locked to the world Z axis
 * (the car's longitudinal axis), so only barrel rolls are physically possible.
 */
export class Vehicle {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  mode: MovementMode = 'airborne';
  probe: SurfaceProbe | null = null;
  /** Forward speed after the last step (m/s along -Z). */
  forwardSpeed = 0;
  /** Thruster output this step, 0..1 each (for effects/HUD). */
  liftThrust = 0;
  forwardThrust = 0;
  rollLeftThrust = 0;
  rollRightThrust = 0;
  /** Effective held-E suction output after thermal and energy limits. */
  suctionOn = false;
  suctionHeat = 0;
  suctionOverheated = false;
  suctionState: SuctionState = 'off';
  /** True on the step where a suction attachment was newly made (for effects). */
  justAttached = false;
  /** Total number of suction attachments made (renderers compare to detect new ones). */
  attachCount = 0;
  /** Surface currently attached to / driven on, if any. */
  supportSurface: SurfaceType | null = null;
  private surfaceQueriesDirty = false;

  constructor(
    private world: RAPIER.World,
    spawn: Vec3,
  ) {
    const he = CONFIG.car.halfExtents;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawn.y, spawn.z)
        .enabledRotations(false, false, true)
        .setLinearDamping(0)
        .setAngularDamping(0)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const r = 0.18;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.roundCuboid(he.x - r, he.y - r, he.z - r, r)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setMass(CONFIG.car.mass),
      this.body,
    );
  }

  get position(): Vec3 {
    return this.body.translation();
  }

  /** Roll angle about world Z in radians, (-PI, PI]. */
  get roll(): number {
    const q = this.body.rotation();
    return wrapAngle(2 * Math.atan2(q.z, q.w));
  }

  /** Casts rays from the underside (along car-down) to find the surface the wheels face. */
  probeSurface(maxGap: number): SurfaceProbe | null {
    const he = CONFIG.car.halfExtents;
    const { up, right } = carAxes(this.roll);
    const down = { x: -up.x, y: -up.y, z: -up.z };
    const p = this.position;
    let best: SurfaceProbe | null = null;
    // A 3x3 grid of rays under the car (roughly where the wheels are), so contact holds while
    // any part of the underside is over the surface, e.g. near the edge of a wall.
    for (const dz of [-he.z * 0.7, 0, he.z * 0.7]) for (const dx of [-he.x * 0.7, 0, he.x * 0.7]) {
      const ray = new RAPIER.Ray({ x: p.x + right.x * dx, y: p.y + right.y * dx, z: p.z + dz }, down);
      const hit = this.castSurfaceRay(ray, he.y + maxGap);
      if (!hit) continue;
      const gap = hit.timeOfImpact - he.y;
      if (!best || gap < best.gap) {
        const n = hit.normal;
        best = {
          gap,
          normal: { x: n.x, y: n.y, z: n.z },
          surface: classifyNormal(n),
          alignment: dot(n, up),
        };
      }
    }
    return best;
  }

  /** Query shapes directly after coordinate/geometry changes until Rapier refreshes its BVH. */
  invalidateSurfaceQueries() { this.surfaceQueriesDirty = true; }

  private castSurfaceRay(ray: RAPIER.Ray, distance: number): { timeOfImpact: number; normal: Vec3 } | null {
    if (!this.surfaceQueriesDirty) {
      return this.world.castRayAndGetNormal(ray, distance, true, undefined, undefined, this.collider, this.body);
    }
    let closest: { timeOfImpact: number; normal: Vec3 } | null = null;
    this.world.forEachCollider(collider => {
      if (collider.handle === this.collider.handle || collider.parent()?.handle === this.body.handle) return;
      const hit = collider.castRayAndGetNormal(ray, distance, true);
      if (hit && (!closest || hit.timeOfImpact < closest.timeOfImpact)) closest = hit;
    });
    return closest;
  }

  /** Applies bounded forces and torque before Rapier resolves contacts. */
  applyControls(c: ControlState, dt: number, fuel: FuelTank) {
    const car = CONFIG.car;
    // Rapier keeps applied forces until explicitly cleared; controls describe this step only.
    this.body.resetForces(true);
    this.body.resetTorques(true);
    // Re-evaluate the held request every step: release always detaches immediately,
    // and holding E can resume after thermal recovery or a fuel pickup.
    this.suctionOn = c.suction && !fuel.isEmpty;
    this.probe = this.probeSurface(CONFIG.suction.range);
    const aligned = !!this.probe && this.probe.alignment >= Math.cos((CONFIG.suction.maxAlignAngleDeg * Math.PI) / 180);
    const touching = aligned && this.probe!.gap <= car.groundProbe;
    const floorContact = touching && this.probe!.surface === 'floor';
    const thermal = advanceSuctionHeat({ heat: this.suctionHeat, overheated: this.suctionOverheated, active: this.suctionOn }, dt, floorContact);
    this.suctionHeat = thermal.heat;
    this.suctionOverheated = thermal.overheated;
    this.suctionOn = thermal.active;
    const requestedRoll = (c.rollLeft ? 1 : 0) - (c.rollRight ? 1 : 0);
    // Allocate the shared tank once so simultaneous systems receive the same fractional power.
    const energyRate = (c.thrust ? CONFIG.thrusters.liftFuelRate : 0)
      + (c.accelerate ? CONFIG.thrusters.boostFuelRate : 0)
      + (requestedRoll ? CONFIG.thrusters.rollFuelRate : 0)
      + (this.suctionOn ? (floorContact ? CONFIG.suction.floorFuelRate : CONFIG.suction.fuelRate) : 0);
    const power = fuel.consume(dt, energyRate);
    this.liftThrust = c.thrust ? power : 0;
    if (fuel.isEmpty) this.suctionOn = false;
    const suction = evaluateSuction(this.suctionOn, this.probe);
    const wasAttached = this.mode === 'attached';
    if (suction.state === 'attached') this.mode = 'attached';
    else if (touching && this.probe!.surface === 'floor') this.mode = 'grounded';
    else this.mode = 'airborne';
    this.suctionState = this.suctionOverheated ? 'overheated' : fuel.isEmpty ? 'no-energy' : suction.state;
    this.justAttached = this.mode === 'attached' && !wasAttached;
    if (this.justAttached) this.attachCount++;
    this.supportSurface = this.mode === 'airborne' ? null : this.probe!.surface;

    const v = this.body.linvel();
    const { up } = carAxes(this.roll);
    const n = this.probe?.normal;
    const mass = this.body.mass();
    const acceleration = { x: 0, y: 0, z: 0 };
    // Automatic cruise remains free in every movement mode. Fund only the extra
    // acceleration toward W's higher target, sharing partial final fuel with other systems.
    // Exhaustion or release returns gently toward cruise without rewriting momentum.
    const cruiseDrive = clamp((car.cruiseSpeed + v.z) * car.driveGain, -car.coastDecel, car.acceleration);
    const boostedDrive = clamp((car.maxForwardSpeed + v.z) * car.driveGain, -car.coastDecel, car.acceleration);
    const boostPower = c.accelerate ? power : 0;
    const boostDrive = (boostedDrive - cruiseDrive) * boostPower;
    acceleration.z = -(cruiseDrive + boostDrive);
    if (this.suctionOn && floorContact) {
      acceleration.z -= Math.sign(v.z) * Math.min(1, Math.abs(v.z)) * CONFIG.suction.floorRollingResistance;
    }
    this.forwardThrust = boostPower * clamp((boostedDrive - cruiseDrive) / car.acceleration, 0, 1);

    if (this.mode !== 'airborne' && n) {
      // A/D alone steer along the surface. Roll keys never request lateral force.
      const tangent = { x: n.y, y: -n.x, z: 0 };
      const steer = (c.steerRight ? 1 : 0) - (c.steerLeft ? 1 : 0);
      const lat = dot(v, tangent);
      let target = steer * car.steerSpeed;
      const p = this.position;
      const { halfWidth: W, height: H } = CONFIG.corridor;
      const alongX = Math.abs(tangent.x) > 0.7;
      const offset = alongX ? p.x * Math.sign(tangent.x) : (p.y - H / 2) * Math.sign(tangent.y);
      const limit = (alongX ? W : H / 2) - car.halfExtents.x;
      // Brake through tyre grip before reaching the corridor edge, without clipping velocity.
      const stopDistance = lat * lat / (2 * car.landingGrip) + 0.08;
      if ((offset + stopDistance > limit && target > 0) || (offset - stopDistance < -limit && target < 0)) target = 0;
      const opposing = Math.abs(lat) > car.steerSpeed || lat * target <= 0;
      const maxGrip = opposing ? car.landingGrip : car.steerAccel;
      const lateralAccel = clamp((target - lat) * car.gripGain, -maxGrip, maxGrip);
      acceleration.x += tangent.x * lateralAccel;
      acceleration.y += tangent.y * lateralAccel;
    }

    acceleration.x += up.x * CONFIG.thrusters.liftAccel * this.liftThrust;
    acceleration.y += up.y * CONFIG.thrusters.liftAccel * this.liftThrust;

    if (n && suction.state === 'attracting') {
      const toward = -dot(v, n);
      // A bounded attraction/damping force replaces the old approach-speed clamp.
      const desired = Math.min(CONFIG.suction.maxApproachSpeed, Math.sqrt(2 * suction.pull * Math.max(0, this.probe!.gap)));
      const pull = clamp((desired - toward) * car.suctionApproachGain, -CONFIG.suction.maxAttractAccel, suction.pull);
      acceleration.x -= n.x * pull * (1 - this.liftThrust);
      acceleration.y -= n.y * pull * (1 - this.liftThrust);
    } else if (n && this.mode === 'attached') {
      // Finite spring/damper pressure keeps attachment stable through slab seams.
      const press = clamp(this.probe!.gap * car.contactSpring + dot(v, n) * car.contactDamping,
        -CONFIG.suction.pressAccel, CONFIG.suction.pressAccel);
      acceleration.x -= n.x * press * (1 - this.liftThrust);
      acceleration.y -= n.y * press * (1 - this.liftThrust);
    }
    this.body.addForce({ x: acceleration.x * mass, y: acceleration.y * mass, z: acceleration.z * mass }, true);
    this.body.setGravityScale(
      this.mode === 'attached' ? 0 : suction.state === 'attracting' ? CONFIG.suction.attractGravityScale : 1,
      true,
    );

    const input = power > 0 ? requestedRoll : 0;
    const w = this.body.angvel().z;
    let contact = false;
    this.world.contactPairsWith(this.collider, (other) => {
      this.world.contactPair(this.collider, other, (manifold) => {
        if (manifold.numSolverContacts() > 0) contact = true;
      });
    });
    let angularAccel: number;
    const limit = contact ? car.contactRollAccel : car.rollAccel;
    if (input) {
      // Pure torque has zero net linear force. The solver provides ground resistance and
      // pivot motion; enough sustained torque can tip the car without an artificial hop.
      angularAccel = clamp((input * car.rollSpeed - w) * car.rollInputGain, -limit, limit) * power;
    } else {
      let target: number | null = null;
      if (this.mode !== 'airborne' && n) target = Math.atan2(-n.x, n.y);
      else if (suction.state === 'attracting' && n) target = Math.atan2(-n.x, n.y);
      else if (Math.abs(w) < 1.5) {
        const quarter = Math.round(this.roll / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(wrapAngle(quarter - this.roll)) < car.rollAssistAngleDeg * Math.PI / 180) target = quarter;
      }
      const targetW = target === null ? 0 : clamp(wrapAngle(target - this.roll) * car.rollAssistGain, -car.rollSpeed, car.rollSpeed);
      angularAccel = clamp((targetW - w) * car.rollDamping, -car.rollBrake, car.rollBrake);
    }
    this.rollLeftThrust = input > 0 ? Math.max(0.2 * power, Math.max(0, angularAccel) / limit) : 0;
    this.rollRightThrust = input < 0 ? Math.max(0.2 * power, Math.max(0, -angularAccel) / limit) : 0;
    const inertia = this.body.effectiveAngularInertia().m33;
    this.body.addTorque({ x: 0, y: 0, z: inertia * angularAccel }, true);
  }

  /** Observe the solver result without rewriting position, rotation, or momentum. */
  afterStep(_c: ControlState) {
    this.surfaceQueriesDirty = false;
    this.forwardSpeed = -this.body.linvel().z;
  }
}
