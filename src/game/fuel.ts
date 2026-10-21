/** Thruster fuel tank. Units are "seconds of continuous single-thruster use". */
export class FuelTank {
  private amount: number;

  constructor(readonly capacity: number) {
    this.amount = capacity;
  }

  get value(): number {
    return this.amount;
  }

  get fraction(): number {
    return this.amount / this.capacity;
  }

  get isEmpty(): boolean {
    return this.amount <= 0;
  }

  /**
   * Burns fuel for `dt` seconds at the given number of active thrusters' rate (each thruster
   * burns 1 unit/s). Returns the fraction of `dt` that could actually be powered (0..1).
   */
  consume(dt: number, activeThrusters: number): number {
    if (activeThrusters <= 0 || dt <= 0) return 0;
    if (this.amount <= 0) return 0;
    const need = dt * activeThrusters;
    if (need <= this.amount) {
      this.amount -= need;
      return 1;
    }
    const fraction = this.amount / need;
    this.amount = 0;
    return fraction;
  }

  refill(amount = this.capacity) {
    this.amount = Math.min(this.capacity, this.amount + amount);
  }

  reset() {
    this.amount = this.capacity;
  }
}
