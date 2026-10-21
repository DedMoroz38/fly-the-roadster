/**
 * Fixed-timestep accumulator: converts variable render frame times into a whole number
 * of deterministic simulation steps. Large frame gaps are clamped to avoid a spiral of death.
 */
export class FixedStepper {
  private accumulator = 0;

  constructor(
    readonly dt: number,
    private readonly maxStepsPerFrame = 8,
  ) {}

  /** Returns how many fixed steps to run for this frame. */
  advance(frameSeconds: number): number {
    this.accumulator += Math.max(0, Math.min(frameSeconds, this.dt * this.maxStepsPerFrame));
    let steps = 0;
    while (this.accumulator >= this.dt - 1e-9 && steps < this.maxStepsPerFrame) {
      this.accumulator -= this.dt;
      steps++;
    }
    if (this.accumulator < 0) this.accumulator = 0;
    return steps;
  }

  /** Interpolation factor in [0,1) between the last two simulation states. */
  get alpha(): number {
    return Math.min(1, this.accumulator / this.dt);
  }

  reset() {
    this.accumulator = 0;
  }
}
