import { ControlState, emptyControls } from '../src/game/input';
import { Simulation, initPhysics } from '../src/game/simulation';
import { StaticLevel } from '../src/game/physics/level';
import { Slab } from '../src/game/surfaces';
import { Vec3 } from '../src/game/physics/vehicle';

export async function makeSim(slabs: Omit<Slab, 'id'>[], spawn?: Vec3) {
  await initPhysics();
  return new Simulation({ spawn, createLevel: (w) => new StaticLevel(w, slabs) });
}

export const controls = (c: Partial<ControlState> = {}): ControlState => ({ ...emptyControls(), ...c });

/** Runs the simulation for `seconds` with fixed controls (or a per-step controls function). */
export function run(sim: Simulation, seconds: number, c: Partial<ControlState> | ((t: number) => Partial<ControlState>) = {}) {
  const steps = Math.round(seconds / sim.dt);
  for (let i = 0; i < steps; i++) {
    const cc = typeof c === 'function' ? c(sim.time) : c;
    sim.step(controls(cc));
  }
}

export function setRoll(sim: Simulation, roll: number) {
  sim.vehicle.body.setRotation({ x: 0, y: 0, z: Math.sin(roll / 2), w: Math.cos(roll / 2) }, true);
}
