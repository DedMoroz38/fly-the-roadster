import { CONFIG } from './config';
import { ControlState } from './input';
import { Simulation } from './simulation';

export type SessionState = 'ready' | 'running' | 'paused' | 'gameover';
export type FailReason = 'fell' | 'crashed' | 'stranded';

export const FAIL_TEXT: Record<FailReason, string> = {
  fell: 'Fell out of the course',
  crashed: 'Crashed into an obstacle edge',
  stranded: 'Stranded — no way forward',
};

/**
 * Pure failure rules, evaluated once per fixed step.
 * - fell: far outside the corridor bounds.
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
      this.noProgressTime = 0; // parked on a surface is a choice, not a failure
    }
    return null;
  }
}

export interface SessionSnapshot {
  state: SessionState;
  distance: number;
  best: number;
  speed: number;
  fuel: number; // 0..1
  fuelEmpty: boolean;
  suctionOn: boolean;
  suctionState: string;
  mode: string;
  surface: string | null;
  failReason: FailReason | null;
  seed: number;
  refuels: number;
  helpOpen: boolean;
}

/**
 * Game flow independent of rendering/DOM: owns the simulation, scoring, failure, pause and
 * restart. The browser `Game` drives it; tests drive it directly.
 */
export class GameSession {
  state: SessionState = 'ready';
  sim: Simulation;
  /** Furthest forward distance reached this attempt (the score). */
  score = 0;
  best = 0;
  failReason: FailReason | null = null;
  helpOpen = true;
  /** Incremented on every restart so views can reset themselves. */
  attempt = 0;
  private monitor = new FailureMonitor();

  constructor(
    readonly seed: number,
    private createSim: (seed: number) => Simulation,
  ) {
    this.sim = createSim(seed);
  }

  /** Called once per fixed step with the sampled controls. */
  step(controls: ControlState) {
    if (this.state === 'ready') {
      const go = controls.accelerate || controls.thrust || controls.forwardThrust || controls.brake;
      if (!go) return;
      this.state = 'running';
      this.helpOpen = false;
    }
    if (this.state !== 'running') return;
    this.sim.step(controls);
    this.score = Math.max(this.score, this.sim.distance);
    const fail = this.monitor.check(this.sim);
    if (fail) {
      this.state = 'gameover';
      this.failReason = fail;
      this.best = Math.max(this.best, this.score);
    }
  }

  togglePause() {
    if (this.state === 'running') this.state = 'paused';
    else if (this.state === 'paused') {
      this.state = 'running';
      this.helpOpen = false;
    }
  }

  toggleHelp() {
    this.helpOpen = !this.helpOpen;
    if (this.helpOpen && this.state === 'running') this.state = 'paused';
    else if (!this.helpOpen && this.state === 'paused') this.state = 'running';
  }

  /** Full reset: new physics world, regenerated course (same seed), full fuel, score 0. */
  restart() {
    this.best = Math.max(this.best, this.score);
    this.sim.dispose();
    this.sim = this.createSim(this.seed);
    this.monitor.reset();
    this.score = 0;
    this.failReason = null;
    this.state = 'running';
    this.helpOpen = false;
    this.attempt++;
  }

  snapshot(): SessionSnapshot {
    const v = this.sim.vehicle;
    return {
      state: this.state,
      distance: this.score,
      best: Math.max(this.best, this.state === 'gameover' ? this.score : 0),
      speed: v.forwardSpeed,
      fuel: this.sim.fuel.fraction,
      fuelEmpty: this.sim.fuel.isEmpty,
      suctionOn: v.suctionOn,
      suctionState: v.suctionState,
      mode: v.mode,
      surface: v.supportSurface,
      failReason: this.failReason,
      seed: this.seed,
      refuels: this.sim.refuelCount,
      helpOpen: this.helpOpen,
    };
  }
}
