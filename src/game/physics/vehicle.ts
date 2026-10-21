import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../config';
import { ControlState } from '../input';
import { approach, clamp, wrapAngle } from '../../core/math';
import { classifyNormal, SurfaceType } from '../surfaces';
import { FuelTank } from '../fuel';
import { evaluateSuction, SuctionState } from '../suction';

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
  /** Suction toggled on by the player (E). Off by default. */
  suctionOn = false;
  suctionState: SuctionState = 'off';
  /** True on the step where a suction attachment was newly made (for effects). */
  justAttached = false;
  /** Total number of suction attachments made (renderers compare to detect new ones). */
  attachCount = 0;
  /** Surface currently attached to / driven on, if any. */
  supportSurface: SurfaceType | null = null;

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
        .setDensity(1),
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
      const hit = this.world.castRayAndGetNormal(
        ray,
        he.y + maxGap,
        true,
        undefined,
        undefined,
        this.collider,
        this.body,
      );
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

  /** Applies driving/steering/roll/thrust control for one fixed step, before world.step(). */
  applyControls(c: ControlState, dt: number, fuel: FuelTank) {
    const car = CONFIG.car;
    if (c.toggleSuction) this.suctionOn = !this.suctionOn;
    this.probe = this.probeSurface(CONFIG.suction.range);
    const aligned = !!this.probe && this.probe.alignment >= Math.cos((CONFIG.suction.maxAlignAngleDeg * Math.PI) / 180);
    const touching = aligned && this.probe!.gap <= car.groundProbe;
    const suction = evaluateSuction(this.suctionOn, this.probe);
    const wasAttached = this.mode === 'attached';
    // Without suction only floors (gravity holds the car down) count as drivable support.
    if (suction.state === 'attached') this.mode = 'attached';
    else if (touching && this.probe!.surface === 'floor') this.mode = 'grounded';
    else this.mode = 'airborne';
    this.suctionState = suction.state;
    this.justAttached = this.mode === 'attached' && !wasAttached;
    if (this.justAttached) this.attachCount++;
    this.supportSurface = this.mode === 'airborne' ? null : this.probe!.surface;

    const v = this.body.linvel();
    const { right } = carAxes(this.roll);
    let fwd = -v.z;

    if (this.mode !== 'airborne') {
      // Forward: arcade acceleration / braking / coasting.
      if (c.accelerate && !c.brake) {
        if (fwd < car.maxForwardSpeed) fwd = Math.min(car.maxForwardSpeed, fwd + car.acceleration * dt);
      } else if (c.brake) {
        fwd =
          fwd > 0
            ? Math.max(0, fwd - car.braking * dt)
            : Math.max(-car.maxReverseSpeed, fwd - car.acceleration * dt);
      } else {
        fwd = approach(fwd, 0, car.coastDecel * dt);
      }
      // Lateral: steer along the car's local right (surface tangent), grip otherwise.
      const steer =
        (c.steerRight || c.rollRight ? 1 : 0) - (c.steerLeft || c.rollLeft ? 1 : 0);
      const lat = v.x * right.x + v.y * right.y;
      // Momentum carried in from flight (e.g. falling onto a wall) is gripped away quickly.
      // Braking sideways motion (excess speed or moving against the steering) uses the strong grip.
      const target = steer * car.steerSpeed;
      const braking = Math.abs(lat) > car.steerSpeed + 0.5 || (Math.abs(lat) > 0.5 && Math.sign(lat) !== Math.sign(target));
      let newLat = approach(lat, target, (braking ? car.landingGrip : car.steerAccel) * dt);
      // Soft corridor limit: while on a surface, sideways motion never carries the car's body
      // past the corridor boundary (flight momentum still can). Prevents clipping the leading
      // edge of side surfaces and driving off the side by accident.
      const p = this.position;
      const { halfWidth: W, height: H } = CONFIG.corridor;
      const alongX = Math.abs(right.x) > 0.7;
      const off = alongX ? p.x * Math.sign(right.x) : (p.y - H / 2) * Math.sign(right.y); // + = toward car-right side
      const limit = (alongX ? W : H / 2) - car.halfExtents.x;
      if ((off > limit && newLat > 0) || (off < -limit && newLat < 0)) newLat = 0;
      const dLat = newLat - lat;
      v.x += right.x * dLat;
      v.y += right.y * dLat;
    }
    // Thrusters share one tank; each active thruster burns 1 unit/s.
    const active = (c.thrust ? 1 : 0) + (c.forwardThrust ? 1 : 0);
    const power = fuel.consume(dt, active);
    this.liftThrust = c.thrust ? power : 0;
    this.forwardThrust = c.forwardThrust ? power : 0;
    if (this.liftThrust > 0) {
      const { up } = carAxes(this.roll);
      const dv = CONFIG.thrusters.liftAccel * dt * this.liftThrust;
      v.x += up.x * dv;
      v.y += up.y * dv;
    }
    if (this.forwardThrust > 0 && fwd < CONFIG.thrusters.maxBoostSpeed) {
      fwd = Math.min(CONFIG.thrusters.maxBoostSpeed, fwd + CONFIG.thrusters.forwardAccel * dt * this.forwardThrust);
    }

    // Suction: attraction toward the faced surface, or holding the car on it once attached.
    const n = this.probe?.normal;
    if (n && suction.state === 'attracting') {
      const pull = suction.pull * dt * (1 - this.liftThrust); // thrusting away overrides the pull
      v.x -= n.x * pull;
      v.y -= n.y * pull;
      // Limit approach speed so the car is drawn in smoothly rather than slammed.
      const toward = -(v.x * n.x + v.y * n.y);
      const max = CONFIG.suction.maxApproachSpeed;
      if (toward > max) {
        v.x += n.x * (toward - max);
        v.y += n.y * (toward - max);
      }
    } else if (n && this.mode === 'attached' && this.probe!.gap > 0.02) {
      // Gravity is disabled while attached (see below); press gently into the surface instead
      // so the car can drive on walls and ceilings.
      const press = CONFIG.suction.pressAccel * dt * (1 - this.liftThrust);
      v.x -= n.x * press;
      v.y -= n.y * press;
    }
    // Suction never drags the car through the surface plane: when the wheels are already at the
    // plane, motion further into it is removed (matters at surface ends, where part of the car
    // hangs over a gap and only some probe rays still see the surface).
    if (n && this.suctionOn && this.probe!.gap < 0.05) {
      const into = -(v.x * n.x + v.y * n.y);
      if (into > 0) {
        v.x += n.x * into;
        v.y += n.y * into;
      }
    }

    v.z = -fwd;
    this.body.setLinvel(v, true);
    this.body.setGravityScale(
      this.mode === 'attached' ? 0 : suction.state === 'attracting' ? CONFIG.suction.attractGravityScale : 1,
      true,
    );

    if (this.mode !== 'airborne') {
      this.stabilizeRoll(this.probe!.normal);
    } else {
      // Barrel roll about the longitudinal axis. Left arrow rolls the roof to the left.
      const input = (c.rollLeft ? 1 : 0) - (c.rollRight ? 1 : 0);
      const w = this.body.angvel().z;
      let nw: number;
      if (input !== 0) {
        nw = approach(w, input * car.rollSpeed, car.rollAccel * dt);
        this.popOffContacts();
      } else {
        // Released: brake the spin firmly so 90°/180° rolls are controllable...
        nw = approach(w, 0, car.rollBrake * dt);
        // ...and, once nearly stopped, settle onto the nearest surface-facing orientation.
        let target: number | null = null;
        if (suction.state === 'attracting' && n) {
          target = Math.atan2(-n.x, n.y); // wheels flat onto the surface being pulled toward
        } else if (Math.abs(nw) < 1.5) {
          const quarter = Math.round(this.roll / (Math.PI / 2)) * (Math.PI / 2);
          if (Math.abs(wrapAngle(quarter - this.roll)) < (car.rollAssistAngleDeg * Math.PI) / 180) target = quarter;
        }
        if (target !== null) {
          const err = wrapAngle(target - this.roll);
          nw = approach(nw, clamp(err * car.rollAssistGain, -car.rollSpeed, car.rollSpeed), car.rollAccel * dt);
        }
      }
      this.body.setAngvel({ x: 0, y: 0, z: nw }, true);
    }
  }

  /**
   * The car body is wider than it is tall, so it cannot rotate while its roof or a side lies
   * against a surface. When the player rolls in that situation, push the car off the surface
   * just enough to turn (self-righting), instead of leaving it stuck.
   */
  private popOffContacts() {
    const he = CONFIG.car.halfExtents;
    const { up, right } = carAxes(this.roll);
    const p = this.position;
    const v = this.body.linvel();
    let changed = false;
    const dirs = [
      { d: up, reach: he.y },
      { d: right, reach: he.x },
      { d: { x: -right.x, y: -right.y, z: 0 }, reach: he.x },
    ];
    for (const { d, reach } of dirs) {
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray(p, d), reach + 0.12, true, undefined, undefined, this.collider, this.body,
      );
      if (!hit) continue;
      const n = hit.normal;
      const vn = v.x * n.x + v.y * n.y;
      const pop = CONFIG.car.rollPopSpeed * (n.y > 0.7 ? 1 : 0.7);
      if (vn < pop) {
        v.x += n.x * (pop - vn);
        v.y += n.y * (pop - vn);
        changed = true;
      }
    }
    if (changed) this.body.setLinvel(v, true);
  }

  /** Rotates the car so its wheels sit flat on the surface with the given normal. */
  private stabilizeRoll(normal: Vec3) {
    const target = Math.atan2(-normal.x, normal.y);
    const err = wrapAngle(target - this.roll);
    const w = clamp(err * CONFIG.suction.stabilizeGain, -CONFIG.car.rollSpeed * 2, CONFIG.car.rollSpeed * 2);
    this.body.setAngvel({ x: 0, y: 0, z: w }, true);
  }

  /**
   * Called after world.step(). While supported and not thrusting away, removes any velocity
   * pushing the car off the surface: collision solvers can kick bodies at internal slab edges,
   * and an arcade car should hug the road instead.
   */
  afterStep(c: ControlState) {
    if (this.mode !== 'airborne' && this.probe && !c.thrust) {
      const n = this.probe.normal;
      const v = this.body.linvel();
      const vn = dot(v, n);
      if (vn > 0) this.body.setLinvel({ x: v.x - n.x * vn, y: v.y - n.y * vn, z: v.z - n.z * vn }, true);
      // Hard landings can sink the car slightly into the surface (the solver only resolves
      // penetration gradually). Lift it back onto the plane right away so it can't catch the
      // edge of the next slab while sunk.
      const after = this.probeSurface(0.2);
      if (after && after.gap < -0.03 && after.alignment > 0.7) {
        const p = this.position;
        const k = -after.gap;
        this.body.setTranslation({ x: p.x + after.normal.x * k, y: p.y + after.normal.y * k, z: p.z }, true);
      }
    }
    this.forwardSpeed = -this.body.linvel().z;
  }
}
