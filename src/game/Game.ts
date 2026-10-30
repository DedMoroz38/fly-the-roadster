import { FixedStepper } from '../core/fixedStep';
import { InputManager } from './input';
import { Simulation, initPhysics } from './simulation';
import { getSelectedVehicle, loadVehicle, setSelectedVehicle, VEHICLES, vehicleById, vehicleWorld } from '../render/vehicles';
import { Course } from './course/course';
import { WorkerChunkSource } from './course/workerSource';
import { SCENARIOS } from './course/routeGenerator';
import type { ScenarioKind } from './course/planner';
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

  private terrainSource: WorkerChunkSource | null = null;
  /** The chosen vehicle look, remembered across visits. */
  vehicleId = getSelectedVehicle();

  constructor(private host: HTMLElement) {}

  async start() {
    await initPhysics();
    if (this.disposed) return;
    const query = new URLSearchParams(window.location.search);
    const requested = query.get('template') as ScenarioKind | null;
    const template = requested && SCENARIOS.includes(requested) ? requested : undefined;
    const initialSource = new WorkerChunkSource(this.seed, { template });
    this.terrainSource = initialSource;
    // The car mesh loads alongside the opening terrain; a failed load is logged, not fatal.
    try { await Promise.all([initialSource.ready, loadVehicle(this.vehicleId).catch(() => undefined)]); }
    catch (error) { initialSource.dispose(); if (!this.disposed) throw error; return; }
    if (this.disposed) { initialSource.dispose(); return; }
    this.renderer = new GameRenderer(this.host, vehicleWorld(this.vehicleId), this.seed);
    let first = true;
    this.session = new GameSession(this.seed, (seed) => new Simulation({ createLevel: (w) => {
      const source = first ? initialSource : initialSource.restartSource();
      first = false;
      this.terrainSource = source;
      return new Course(w, seed, { template, source });
    } }));
    this.session.debugEnabled = query.get('debug') === '1';
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

  /** Menu choice of vehicle look; the physics body is the same for every vehicle. */
  selectVehicle(id: string) {
    if (this.session?.state !== 'ready') return;
    this.vehicleId = vehicleById(id).id;
    setSelectedVehicle(this.vehicleId);
    this.renderer?.car.setVehicle(this.vehicleId);
    this.renderer?.setWorld(vehicleWorld(this.vehicleId), this.seed);
    this.emit(true);
  }

  cycleVehicle(step: number) {
    const index = VEHICLES.findIndex(v => v.id === this.vehicleId);
    this.selectVehicle(VEHICLES[(index + step + VEHICLES.length) % VEHICLES.length].id);
  }

  /** Space on the menu is consumed here so it cannot also fire the lift thrusters. */
  startRun() {
    if (this.session.state !== 'ready') return;
    this.input.clearUntilRelease();
    this.session.startRun();
    this.stepper.reset();
    this.last = performance.now();
    this.emit(true);
  }

  restart() {
    this.session.restart();
    this.stepper.reset();
    this.emit(true);
  }

  /** From the pause or game-over screen back to the main menu, where the vehicle can be changed. */
  returnToMenu() {
    if (this.session.state !== 'paused' && this.session.state !== 'gameover') return;
    this.session.returnToMenu();
    this.input.clearUntilRelease();
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

    if (s.state === 'ready') {
      if (this.input.consumePress('thrust')) this.startRun();
      // The roll arrows pick a vehicle on the menu.
      if (this.input.consumePress('rollLeft')) this.cycleVehicle(-1);
      if (this.input.consumePress('rollRight')) this.cycleVehicle(1);
      // No shortcut can bypass the menu or queue a later action.
      for (const action of ['restart', 'pause', 'help', 'menu', 'debug'] as const) this.input.consumePress(action);
    } else {
      if (this.input.consumePress('menu')) this.returnToMenu();
      if (this.input.consumePress('restart')) this.restart();
      if (this.input.consumePress('pause')) {
        if (s.helpOpen) this.toggleHelp();
        else this.togglePause();
      }
      if (this.input.consumePress('help')) this.toggleHelp();
      if (this.input.consumePress('debug')) { s.debugEnabled = !s.debugEnabled; this.emit(true); }
    }

    const before = s.state;
    const course = s.sim.level as Course;
    course.update(s.sim.distance);
    const waiting = course.needsBuffer(s.sim.distance);
    if (waiting || s.state !== 'running') this.stepper.reset();
    const steps = waiting || s.state !== 'running' ? 0 : this.stepper.advance(dt);
    for (let i = 0; i < steps; i++) s.step(this.input.sample());

    if (this.renderedAttempt !== s.attempt) {
      this.renderer.reset();
      this.renderedAttempt = s.attempt;
    }
    const alpha = s.state === 'running' && !waiting ? this.stepper.alpha : 1;
    this.renderer.debugEnabled = s.debugEnabled;
    // The menu has its own showroom; don't draw a second hidden WebGL scene underneath it.
    if (s.state !== 'ready') this.renderer.render(s.sim, alpha, s.state === 'running' && !waiting ? dt : 0, dt);
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
    this.terrainSource?.dispose();
    this.renderer?.dispose();
    this.listeners.clear();
  }
}
