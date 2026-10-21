import { FixedStepper } from '../core/fixedStep';
import { InputManager } from './input';
import { Simulation, initPhysics } from './simulation';
import { Course } from './course/course';
import { GameSession, SessionSnapshot } from './session';
import { GameRenderer } from '../render/gameRenderer';

type Listener = (s: SessionSnapshot) => void;

/** Browser-side orchestrator: input -> fixed-step session/simulation -> renderer + HUD. */
export class Game {
  readonly input = new InputManager();
  session!: GameSession;
  private renderer!: GameRenderer;
  private stepper!: FixedStepper;
  private raf = 0;
  private last = 0;
  private detachInput: (() => void) | null = null;
  private disposed = false;
  private listeners = new Set<Listener>();
  private lastEmit = 0;
  private renderedAttempt = 0;

  /** Seed for repeatable runs: `?seed=123` in the URL, otherwise random per page load. */
  readonly seed: number = (() => {
    const q = new URLSearchParams(window.location.search).get('seed');
    return q !== null && q !== '' && !Number.isNaN(Number(q)) ? Number(q) >>> 0 : (Math.random() * 2 ** 32) >>> 0;
  })();

  constructor(private host: HTMLElement) {}

  async start() {
    await initPhysics();
    if (this.disposed) return;
    this.renderer = new GameRenderer(this.host);
    this.session = new GameSession(this.seed, (seed) => new Simulation({ createLevel: (w) => new Course(w, seed) }));
    this.stepper = new FixedStepper(this.session.sim.dt);
    this.detachInput = this.input.attach(window);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.onBlur);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.emit(true);
  }

  /** Exposed for debugging / automated browser checks. */
  get simulation(): Simulation {
    return this.session.sim;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    if (this.session) fn(this.session.snapshot());
    return () => this.listeners.delete(fn);
  }

  restart() {
    this.session.restart();
    this.stepper.reset();
    this.emit(true);
  }

  togglePause() {
    this.session.togglePause();
    this.emit(true);
  }

  toggleHelp() {
    this.session.toggleHelp();
    this.emit(true);
  }

  private emit(force = false) {
    const now = performance.now();
    if (!force && now - this.lastEmit < 50) return; // HUD at ~20 Hz is plenty
    this.lastEmit = now;
    const snap = this.session.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  private onResize = () => this.renderer.resize();
  private onBlur = () => {
    if (this.session.state === 'running') this.togglePause();
  };

  private frame = (now: number) => {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    const s = this.session;

    // Meta keys are edge-triggered and work in every state.
    if (this.input.consumePress('restart')) this.restart();
    if (this.input.consumePress('pause')) {
      if (s.helpOpen && s.state !== 'ready') this.toggleHelp();
      else this.togglePause();
    }
    if (this.input.consumePress('help')) this.toggleHelp();

    const before = s.state;
    const steps = this.stepper.advance(dt);
    for (let i = 0; i < steps; i++) s.step(this.input.sample());
    if (s.state !== 'running') this.input.consumePress('suction'); // don't queue toggles while stopped

    if (this.renderedAttempt !== s.attempt) {
      this.renderer.reset();
      this.renderedAttempt = s.attempt;
    }
    const alpha = s.state === 'running' ? this.stepper.alpha : 1;
    this.renderer.render(s.sim, alpha, s.state === 'running' ? dt : 0, dt);
    this.emit(before !== s.state);
    this.raf = requestAnimationFrame(this.frame);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachInput?.();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.onBlur);
    this.session?.sim.dispose();
    this.renderer?.dispose();
    this.listeners.clear();
  }
}
