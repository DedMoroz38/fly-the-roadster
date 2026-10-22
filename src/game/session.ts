import { wrapAngle } from '../core/math';
import { CONFIG } from './config';
import { ControlState } from './input';
import { Simulation } from './simulation';

export type SessionState = 'ready' | 'running' | 'paused' | 'gameover';
export type FailReason = 'fell' | 'crashed' | 'flipped' | 'stranded';

/** Read-only route metadata supplied by a procedural level. */
export interface CourseDebugInfo {
  difficulty: number;
  chunkSeed: number;
  chunkId: number;
  kind: string;
  validated: boolean;
  minFuel: number;
  maxHeat: number;
  phase: string;
  nextAction: string;
  frontier: number;
}

export const FAIL_TEXT: Record<FailReason, string> = {
  fell: 'Fell out of the course',
  crashed: 'Crashed into an obstacle edge',
  flipped: 'Landed on the roof',
  stranded: 'Stranded — no way forward',
};

/**
 * Pure failure rules, evaluated once per fixed step.
 * - fell: far outside the corridor bounds.
 * - flipped: roof-down contact with a supporting surface underneath the car.
 * - crashed: lost a lot of forward speed in a single step (a head-on hit on a slab's edge).
 * - stranded: no forward progress for a long time while not standing on anything.
 */
export class FailureMonitor {
  private prevForward = 0;
  private bestDistance = -Infinity;
  private noProgressTime = 0;

  reset() {
    this.prevForward = 0;
    this.bestDistance = -Infinity;
    this.noProgressTime = 0;
  }

  check(sim: Simulation): FailReason | null {
    const { halfWidth: W, height: H } = CONFIG.corridor;
    const m = CONFIG.fail.outsideMargin;
    const p = sim.vehicle.position;
    if (p.y < -m || p.y > H + m || Math.abs(p.x) > W + m) return 'fell';
    if (this.landedOnRoof(sim)) return 'flipped';

    const fwd = sim.vehicle.forwardSpeed;
    const drop = this.prevForward - fwd;
    this.prevForward = fwd;
    if (drop > CONFIG.fail.crashSpeedDrop) return 'crashed';

    if (sim.distance > this.bestDistance + 0.5) {
      this.bestDistance = sim.distance;
      this.noProgressTime = 0;
    } else if (sim.vehicle.mode === 'airborne') {
      this.noProgressTime += sim.dt;
      if (this.noProgressTime > CONFIG.fail.stuckSeconds) return 'stranded';
    } else {
      this.noProgressTime = 0; // a supported car may recover from a low-speed collision
    }
    return null;
  }

  private landedOnRoof(sim: Simulation): boolean {
    const v = sim.vehicle;
    if (Math.cos(v.roll) > -Math.cos(CONFIG.fail.roofAngleDeg * Math.PI / 180)) return false;
    // Wheel probes face upward when inverted. Use actual contacts so an airborne
    // roll is safe and contact with a ceiling above the wheels stays valid.
    let landed = false;
    sim.world.contactPairsWith(v.collider, other => {
      sim.world.contactPair(v.collider, other, manifold => {
        if (Math.abs(manifold.normal().y) < Math.SQRT1_2) return;
        for (let i = 0; i < manifold.numSolverContacts(); i++) {
          if (manifold.solverContactDist(i) <= CONFIG.fail.roofContactSlop &&
            manifold.solverContactPoint(i).y < v.position.y) landed = true;
        }
      });
    });
    return landed;
  }
}

/** A completed airborne trick, paid out on a safe landing. */
export interface FlipAward {
  id: number;
  flips: number;
  points: number;
}

/** Full airborne rolls in one direction, allowing a landing just short of the last one. */
export function completedFlips(airRoll: number): number {
  const tolerance = CONFIG.score.flipToleranceDeg * Math.PI / 180;
  return Math.floor((Math.abs(airRoll) + tolerance) / (2 * Math.PI));
}

export const flipPoints = (flips: number) => CONFIG.score.flipBonus * flips * flips;

export interface SessionSnapshot {
  state: SessionState;
  /** Points: distance points plus flip bonuses. */
  score: number;
  best: number;
  /** Furthest logical distance in metres. */
  distance: number;
  lastFlip: FlipAward | null;
  speed: number;
  totalSpeed: number;
  forwardVelocity: number;
  fuel: number; // 0..1
  fuelEmpty: boolean;
  suctionOn: boolean;
  suctionHeat: number;
  suctionOverheated: boolean;
  suctionState: string;
  mode: string;
  surface: string | null;
  failReason: FailReason | null;
  seed: number;
  refuels: number;
  helpOpen: boolean;
  debugEnabled: boolean;
  debug?: CourseDebugInfo;
  terrainStatus: string | null;
}

/**
 * Game flow independent of rendering/DOM: owns the simulation, scoring, failure, pause and
 * restart. The browser `Game` drives it; tests drive it directly.
 */
export class GameSession {
  state: SessionState = 'ready';
  sim: Simulation;
  /** Points this attempt: furthest distance plus flip bonuses. */
  score = 0;
  best = 0;
  /** Furthest forward distance reached this attempt, in metres. */
  distance = 0;
  flipBonus = 0;
  lastFlip: FlipAward | null = null;
  failReason: FailReason | null = null;
  helpOpen = false;
  debugEnabled = false;
  /** Incremented on every restart so views can reset themselves. */
  attempt = 0;
  private monitor = new FailureMonitor();
  private prevRoll = 0;
  private airRoll = 0;
  private wasAirborne = false;
  private flipAwards = 0;

  constructor(
    readonly seed: number,
    private createSim: (seed: number) => Simulation,
  ) {
    this.sim = createSim(seed);
    this.prevRoll = this.sim.vehicle.roll;
  }

  /** Only the main menu's explicit start action begins the initial attempt. */
  startRun() {
    if (this.state !== 'ready') return;
    this.state = 'running';
    this.helpOpen = false;
  }

  /** Called once per fixed step with the sampled controls. */
  step(controls: ControlState) {
    if (this.state !== 'running') return;
    this.sim.step(controls);
    this.distance = Math.max(this.distance, this.sim.distance);
    const fail = this.monitor.check(this.sim);
    this.trackFlips(!fail);
    this.score = this.distance * CONFIG.score.pointsPerMetre + this.flipBonus;
    if (fail) {
      this.state = 'gameover';
      this.failReason = fail;
      this.best = Math.max(this.best, this.score);
    }
  }

  /** Accumulates signed roll while airborne; a safe touchdown pays out the completed flips. */
  private trackFlips(safe: boolean) {
    const v = this.sim.vehicle, airborne = v.mode === 'airborne';
    if (airborne) {
      if (!this.wasAirborne) this.airRoll = 0;
      this.airRoll += wrapAngle(v.roll - this.prevRoll);
    } else if (this.wasAirborne && safe) {
      const flips = completedFlips(this.airRoll);
      if (flips > 0) {
        const points = flipPoints(flips);
        this.flipBonus += points;
        this.lastFlip = { id: ++this.flipAwards, flips, points };
      }
    }
    this.prevRoll = v.roll;
    this.wasAirborne = airborne;
  }

  togglePause() {
    if (this.state === 'running') this.state = 'paused';
    else if (this.state === 'paused') {
      this.state = 'running';
      this.helpOpen = false;
    }
  }

  toggleHelp() {
    if (this.state === 'ready') return;
    this.helpOpen = !this.helpOpen;
    if (this.helpOpen && this.state === 'running') this.state = 'paused';
    else if (!this.helpOpen && this.state === 'paused') this.state = 'running';
  }

  /** Full reset: new physics world, regenerated course (same seed), full fuel, score 0. */
  restart() {
    if (this.state === 'ready') return;
    this.best = Math.max(this.best, this.score);
    this.sim.dispose();
    this.sim = this.createSim(this.seed);
    this.monitor.reset();
    this.score = 0;
    this.distance = 0;
    this.flipBonus = 0;
    this.lastFlip = null;
    this.airRoll = 0;
    this.wasAirborne = false;
    this.prevRoll = this.sim.vehicle.roll;
    this.failReason = null;
    this.state = 'running';
    this.helpOpen = false;
    this.attempt++;
  }

  snapshot(): SessionSnapshot {
    const v = this.sim.vehicle;
    const velocity = v.body.linvel();
    const level = this.sim.level as typeof this.sim.level & {
      debugInfo?: (distance: number) => CourseDebugInfo | undefined;
      terrainStatus?: string | null;
    };
    return {
      state: this.state,
      score: this.score,
      best: Math.max(this.best, this.state === 'gameover' ? this.score : 0),
      distance: this.distance,
      lastFlip: this.lastFlip,
      speed: v.forwardSpeed,
      totalSpeed: Math.hypot(velocity.x, velocity.y, velocity.z),
      forwardVelocity: -velocity.z,
      fuel: this.sim.fuel.fraction,
      fuelEmpty: this.sim.fuel.isEmpty,
      suctionOn: v.suctionOn,
      suctionHeat: v.suctionHeat,
      suctionOverheated: v.suctionOverheated,
      suctionState: v.suctionState,
      mode: v.mode,
      surface: v.supportSurface,
      failReason: this.failReason,
      seed: this.seed,
      refuels: this.sim.refuelCount,
      helpOpen: this.helpOpen,
      debugEnabled: this.debugEnabled,
      debug: level.debugInfo?.(this.sim.distance),
      terrainStatus: level.terrainStatus ?? null,
    };
  }
}
