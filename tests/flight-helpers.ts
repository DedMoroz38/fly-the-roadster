import { CONFIG } from '../src/game/config';
import { controls } from './helpers';
import type { ControlState } from '../src/game/input';
import type { Simulation } from '../src/game/simulation';

export type FlightPath = (d: number) => { x: number; y: number };

/**
 * A stand-in player for flying sections: follows a path (x and y by forward distance) with the same
 * three inputs a human has. Bank and lift are on/off keys, so both are dithered: the key is held for
 * the fraction of steps that gives the wanted average, which is how a person taps them.
 */
export class FlightPilot {
  private bank = 0;
  private lift = 0;
  /** Largest distance from the path, in x and y, seen so far. */
  worst = { x: 0, y: 0 };
  /** Errors are only counted from this distance on, so the start-up transient is not held against the pilot. */
  constructor(private readonly path: FlightPath, private readonly gain = { p: 2.2, d: 2.6 }, private readonly settleAfter = 250) {}

  step(sim: Simulation): ControlState {
    const fly = CONFIG.flight;
    const p = sim.vehicle.position, v = sim.vehicle.body.linvel(), d = sim.distance;
    const vf = Math.max(1, -v.z);
    const t0 = this.path(d), tA = this.path(d + 1), tB = this.path(d - 1);
    const ex = t0.x - p.x, ey = t0.y - p.y;
    if (d > this.settleAfter) {
      this.worst.x = Math.max(this.worst.x, Math.abs(ex));
      this.worst.y = Math.max(this.worst.y, Math.abs(ey));
    }
    const vxT = (tA.x - tB.x) / 2 * vf, vyT = (tA.y - tB.y) / 2 * vf;
    const axT = (tA.x - 2 * t0.x + tB.x) * vf * vf, ayT = (tA.y - 2 * t0.y + tB.y) * vf * vf;
    const ax = this.gain.p * ex + this.gain.d * (vxT - v.x) + axT;
    const ay = this.gain.p * ey + this.gain.d * (vyT - v.y) + ayT;
    // The lift vector that gives that acceleration on top of the gravity the car still feels.
    const gravity = CONFIG.gravity * fly.gravityScale;
    const wantX = ax, wantY = ay + gravity + v.y * fly.verticalDrag;
    const maxBank = fly.maxBankDeg * Math.PI / 180;
    const bankWanted = Math.max(-maxBank, Math.min(maxBank, -Math.atan2(wantX, Math.max(0.1, wantY))));
    const magnitude = Math.hypot(wantX, Math.max(0, wantY)) / fly.liftAccel;
    // Dither: accumulate the wanted average and press a key when a whole unit has built up.
    this.bank += bankWanted / maxBank;
    const out = { rollLeft: false, rollRight: false };
    if (this.bank >= 0.5) { out.rollLeft = true; this.bank -= 1; }
    else if (this.bank <= -0.5) { out.rollRight = true; this.bank += 1; }
    this.lift += Math.min(1, magnitude);
    let thrust = false;
    if (this.lift >= 1) { thrust = true; this.lift -= 1; }
    return controls({ ...out, thrust });
  }
}

/** A gentle weave: sideways swing about the centre and a slower rise and fall about `altitude`. */
export const weave = (amplitude: { x: number; y: number }, wavelength: { x: number; y: number }, altitude: number): FlightPath => d => ({
  x: amplitude.x * Math.sin(2 * Math.PI * d / wavelength.x),
  y: altitude + amplitude.y * Math.sin(2 * Math.PI * d / wavelength.y),
});
