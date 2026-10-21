/**
 * Test-only autopilot that plays the real simulation with ordinary controls, following the
 * generator's guaranteed route. Used to prove generated courses are completable. Not part of the game.
 */
import { Simulation } from '../src/game/simulation';
import { ControlState, emptyControls } from '../src/game/input';
import { CHUNK, RoutePiece } from '../src/game/course/generator';
import { Course } from '../src/game/course/course';
import { CONFIG } from '../src/game/config';
import { SURFACE_NORMAL, SurfaceType } from '../src/game/surfaces';
import { clamp, wrapAngle } from '../src/core/math';
import { FailureMonitor } from '../src/game/session';

const { halfWidth: W, height: H } = CONFIG.corridor;

/** Roll at which the car's roof points along unit vector (x, y). */
const rollForRoof = (x: number, y: number) => Math.atan2(-x, y);
/** Roll at which the wheels sit flat on the given surface. */
const rollFor = (s: SurfaceType) => rollForRoof(SURFACE_NORMAL[s].x, SURFACE_NORMAL[s].y);

/** Lateral coordinate of the car along a surface (x for floor/ceiling, y for walls). */
type Phase = 'drive' | 'launch' | 'orient' | 'boost' | 'flip' | 'catch';

export class Bot {
  k = 0; // index of the route piece we are on / heading to
  phase: Phase = 'drive';
  phaseTime = 0;
  log: string[] = [];

  constructor(
    private sim: Simulation,
    private course: Course,
  ) {}

  private get route(): RoutePiece[] {
    return this.course.generator.route;
  }

  private setPhase(p: Phase) {
    if (p !== this.phase) this.log.push(`${this.sim.distance.toFixed(0)}m ${this.phase}->${p} k=${this.k}`);
    this.phase = p;
    this.phaseTime = 0;
  }

  /** Signed distance from the car's centre to the plane of surface s (positive = inside corridor). */
  private distTo(s: SurfaceType): number {
    const p = this.sim.vehicle.position;
    switch (s) {
      case 'floor': return p.y;
      case 'ceiling': return H - p.y;
      case 'left': return p.x + W;
      case 'right': return W - p.x;
    }
  }

  /** Velocity component toward surface s. */
  private speedToward(s: SurfaceType): number {
    const v = this.sim.vehicle.body.linvel();
    const n = SURFACE_NORMAL[s];
    return -(v.x * n.x + v.y * n.y);
  }

  private onPiece(piece: RoutePiece): boolean {
    const v = this.sim.vehicle;
    const d = this.sim.distance;
    return v.mode !== 'airborne' && v.supportSurface === piece.surface && d >= piece.start * CHUNK - 4 && d <= piece.end * CHUNK + 4;
  }

  /** Steering input (-1..1, car-relative right) to move the car toward lateral target. */
  private steerToward(target: { x?: number; y?: number }): number {
    const v = this.sim.vehicle;
    const p = v.position;
    const right = { x: Math.cos(v.roll), y: Math.sin(v.roll) };
    const dx = (target.x ?? p.x) - p.x, dy = (target.y ?? p.y) - p.y;
    const along = dx * right.x + dy * right.y;
    return Math.abs(along) < 0.4 ? 0 : Math.sign(along);
  }

  /** Lateral parking spot on surface `cur` that sets up the jump to `next`. */
  private setupSpot(cur: SurfaceType, next: SurfaceType | null): { x?: number; y?: number } {
    const edge = 4.2;
    const curP = this.route[this.k], nextP = this.route[this.k + 1];
    const floorGap = !!nextP && next === 'floor' && nextP.start >= curP.end - 2;
    if ((cur === 'left' || cur === 'right') && floorGap) return { y: 6 }; // need height to glide over the gap
    if (cur === 'floor' || cur === 'ceiling') {
      if (next === 'left') return { x: -edge };
      if (next === 'right') return { x: edge };
      return { x: 0 };
    }
    if (next === 'floor') return { y: 3 };
    if (next === 'ceiling') return { y: H - 1.5 };
    return { y: H - 2 }; // crossing to the opposite wall: start high, gravity eats height mid-air
  }

  private rollTo(target: number, c: ControlState) {
    const err = wrapAngle(target - this.sim.vehicle.roll);
    const w = this.sim.vehicle.body.angvel().z;
    // stop early to account for braking distance
    const brake = (w * w) / (2 * CONFIG.car.rollBrake);
    if (Math.abs(err) < 0.06) return;
    if (Math.sign(err) === Math.sign(w) && Math.abs(err) < brake) return;
    if (err > 0) c.rollLeft = true;
    else c.rollRight = true;
  }

  controls(): ControlState {
    const c = emptyControls();
    const sim = this.sim;
    const v = sim.vehicle;
    const d = sim.distance;
    this.phaseTime += sim.dt;
    const route = this.route;

    // Advance k when we're settled on a later piece.
    for (let j = this.k + 1; j < Math.min(route.length, this.k + 3); j++) {
      if (this.onPiece(route[j])) {
        this.k = j;
        this.setPhase('drive');
      }
    }
    const cur = route[this.k];
    const next = route[this.k + 1];
    const wantSuction = (on: boolean) => {
      if (v.suctionOn !== on) c.toggleSuction = true;
    };

    if (this.phase === 'drive') {
      c.accelerate = v.forwardSpeed < CONFIG.car.maxForwardSpeed;
      // keep suction on for non-floor surfaces
      wantSuction(cur.surface !== 'floor');
      // pickups on this surface ahead take priority for lateral placement
      let spot = this.setupSpot(cur.surface, next?.surface ?? null);
      const pickups = [...(this.course.activePickups.values())].filter((p) => p.surface === cur.surface && p.d > d - 1 && p.d < d + 70);
      if (pickups.length && (sim.fuel.value < CONFIG.fuel.capacity - 0.3)) {
        const p = pickups[0];
        spot = cur.surface === 'floor' || cur.surface === 'ceiling' ? { x: p.x } : { y: p.y };
      }
      const s = this.steerToward(spot);
      if (s > 0) c.steerRight = true;
      if (s < 0) c.steerLeft = true;
      if (!next) return c;
      if (next.surface === cur.surface && cur.surface !== 'floor') {
        // Gap in a wall/ceiling: keep suction on and carry momentum across, boosting forward;
        // the suction beam re-grabs the surface where it resumes.
        const gapStart = cur.end * CHUNK - 25, gapEnd = next.start * CHUNK + 3;
        if (d > gapStart && d < gapEnd) {
          c.accelerate = true;
          c.forwardThrust = sim.fuel.value > 0.3;
          c.steerLeft = c.steerRight = false;
        }
        return c;
      }
      const triggerD = this.triggerDistance(cur, next);
      const setup = this.setupSpot(cur.surface, next.surface);
      const p = v.position;
      const lateralErr = Math.abs((setup.x ?? p.x) - p.x) + Math.abs((setup.y ?? p.y) - p.y);
      const vel = v.body.linvel();
      const settled = lateralErr < 0.8 && Math.hypot(vel.x, vel.y) < 2;
      if (d >= triggerD && (settled || d >= cur.end * CHUNK - 8)) this.setPhase('launch');
      return c;
    }

    if (!next) return c;
    const target = next.surface;
    const targetStartD = next.start * CHUNK;

    // Landed on some floor mid-transition (e.g. an extra floor section): relaunch from it.
    if (this.phase !== 'launch' && target !== 'floor' && v.mode === 'grounded') this.setPhase('launch');

    if (this.phase === 'launch') {
      if (v.mode === 'grounded') {
        // On a floor: hop up with the main thruster (floor gaps are handled by the hover logic).
        if (target === 'floor') this.setPhase('orient');
        else c.thrust = true;
      } else if (v.mode === 'attached' && v.supportSurface !== 'floor') {
        wantSuction(false);
      } else {
        wantSuction(false);
        if (v.mode === 'airborne') this.setPhase('orient');
      }
      if (v.mode !== 'airborne' && this.distTo('floor') > 1.6 && v.supportSurface === 'floor') this.setPhase('orient');
      c.accelerate = true;
      return c;
    }

    // Airborne phases.
    if (target === 'floor') {
      // Roof up, hover over any gap until the floor starts, then land.
      wantSuction(false);
      this.rollTo(0, c);
      const overFloor = d >= targetStartD + 2;
      const y = v.position.y, vy = v.body.linvel().y;
      const hoverY = cur.surface === 'floor' ? 1.8 : 3;
      if (!overFloor && Math.abs(wrapAngle(v.roll)) < 0.5 && y + vy * 0.35 < hoverY) c.thrust = true;
      if (d < targetStartD - 10 && v.forwardSpeed < 40 && sim.fuel.value > 1.5) c.forwardThrust = true;
      return c;
    }

    const T = { x: -SURFACE_NORMAL[target].x, y: -SURFACE_NORMAL[target].y }; // direction toward target plane
    const dist = this.distTo(target) - CONFIG.car.halfExtents.y;
    const approach = this.speedToward(target);
    const vy = v.body.linvel().y;

    // Gravity works against reaching a ceiling, so only skip the boost when already rising.
    const closeEnough = target === 'ceiling' ? dist < 4.5 && vy > 3 : dist < 4.5;
    if (this.phase === 'orient' && closeEnough && d >= targetStartD - 25) {
      // Already parked next to the target surface: just turn the wheels toward it.
      this.setPhase('flip');
    }
    if (this.phase === 'orient' || this.phase === 'boost') {
      wantSuction(false);
      // Roof toward the target (plus lift so we don't sink); thrust there.
      const lift = target === 'ceiling' ? 0 : clamp(0.8 - vy * 0.1, 0.4, 1.6);
      // Climbing: tilt the thrust to cancel sideways drift and stay inside the corridor.
      const vx = v.body.linvel().x;
      const drift = target === 'ceiling' ? clamp(-vx * 0.12 - v.position.x * 0.06, -0.6, 0.6) : 0;
      const rx = T.x + drift, ry = T.y + lift;
      const len = Math.hypot(rx, ry);
      const desired = rollForRoof(rx / len, ry / len);
      this.rollTo(desired, c);
      // Thrust as soon as the roof points roughly the right way (within ~40°).
      const aligned = Math.cos(wrapAngle(desired - v.roll)) > 0.75;
      // Approach speed needed to arrive within flip time.
      const flipTime = 0.75;
      // Climbing to a ceiling fights gravity: need ballistic speed to coast up during the flip.
      const needed = target === 'ceiling'
        ? clamp(Math.sqrt(2 * CONFIG.gravity * Math.max(0, dist - 2)) + 2, 4, 15)
        : clamp(dist / flipTime, 3, 14);
      const roofUp = Math.cos(v.roll); // y component of the roof
      if (aligned) this.phase = 'boost';
      if ((aligned || (target === 'ceiling' && roofUp > 0.5)) && (approach < needed || (target !== 'ceiling' && vy < 1.5))) {
        c.thrust = true;
      }
      if (d < targetStartD - 15 && v.forwardSpeed < 40) c.forwardThrust = sim.fuel.value > 2;
      const timeToPlane = approach > 0.5 ? dist / approach : Infinity;
      if (aligned && approach >= needed * 0.9 && (target === 'ceiling' || vy > 0.5) && timeToPlane < 1.2 && d >= targetStartD - 25) {
        this.setPhase('flip');
      }
      if (this.phaseTime > 4) this.setPhase('flip');
      return c;
    }

    if (this.phase === 'flip' || this.phase === 'catch') {
      const desired = rollFor(target);
      this.rollTo(desired, c);
      if (Math.abs(wrapAngle(desired - v.roll)) < 0.6) {
        wantSuction(true);
        this.phase = 'catch';
      }
      // Lost momentum far away from the target: go back to boosting.
      if (this.phase === 'catch' && approach < 1 && dist > CONFIG.suction.range - 0.5 && this.phaseTime > 0.6) {
        this.setPhase('orient');
      }
      return c;
    }
    return c;
  }

  /** Forward distance at which to start the transition from `cur` to `next`. */
  private triggerDistance(cur: RoutePiece, next: RoutePiece): number {
    const curEnd = cur.end * CHUNK;
    const nextStart = next.start * CHUNK;
    if (next.surface === 'floor' && cur.surface === 'floor') return curEnd - 3;
    if (next.surface === 'floor') {
      // Overlapping: drop once the floor is underneath. Gap: leave at the end and hover across.
      return nextStart < curEnd - 12 ? Math.max(nextStart + 5, cur.start * CHUNK + 10) : curEnd - 6;
    }
    // Other targets: leave so that we arrive a bit after the target starts (climbs take longer).
    const lead = next.surface === 'ceiling' && cur.surface !== 'floor' ? 30 : 10;
    return Math.min(curEnd - 6, Math.max(nextStart - lead, cur.start * CHUNK + 10));
  }
}

export interface BotRun {
  distance: number;
  failedAt: string | null;
  log: string[];
  pickups: number;
}

/** Plays a seeded course with the bot for up to `metres` or `maxSeconds`. */
export function playCourse(seed: number, metres: number, maxSeconds = 600): BotRun {
  let course!: Course;
  const sim = new Simulation({
    createLevel: (w) => (course = new Course(w, seed)),
  });
  const bot = new Bot(sim, course);
  const monitor = new FailureMonitor();
  let failedAt: string | null = null;
  const steps = Math.round(maxSeconds / sim.dt);
  for (let i = 0; i < steps; i++) {
    sim.step(bot.controls());
    // The game's own failure rules (fell / crashed / stranded) decide whether the run failed.
    const fail = monitor.check(sim);
    if (fail) {
      failedAt = `${fail} at ${sim.distance.toFixed(0)}m k=${bot.k} phase=${bot.phase} route=${JSON.stringify(course.generator.route.slice(Math.max(0, bot.k - 1), bot.k + 2))}`;
      break;
    }
    if (sim.distance >= metres) break;
  }
  const result = { distance: sim.distance, failedAt, log: bot.log, pickups: sim.refuelCount };
  sim.dispose();
  return result;
}
