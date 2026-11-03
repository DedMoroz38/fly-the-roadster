import { describe, expect, it } from 'vitest';
import { makeSim, run, controls } from './helpers';
import { FlightPilot, weave } from './flight-helpers';
import { CONFIG } from '../src/game/config';
import { FailureMonitor } from '../src/game/session';

const maxBank = CONFIG.flight.maxBankDeg * Math.PI / 180;

async function flyingSim(y = 16) {
  const sim = await makeSim([], { x: 0, y, z: -10 });
  sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -CONFIG.car.cruiseSpeed }, true);
  sim.vehicle.flying = true;
  return sim;
}

describe('flying mode physics', () => {
  it('has unlimited fuel for every control', async () => {
    const sim = await flyingSim();
    run(sim, 20, { thrust: true, accelerate: true, rollLeft: true });
    expect(sim.fuel.fraction).toBe(1);
    run(sim, 5, { rollRight: true, thrust: true });
    expect(sim.fuel.isEmpty).toBe(false);
    expect(sim.vehicle.liftThrust).toBe(1);
  });

  it('still burns fuel outside a flying section', async () => {
    const sim = await makeSim([], { x: 0, y: 16, z: -10 });
    run(sim, 1, { thrust: true });
    expect(sim.fuel.fraction).toBeLessThan(0.7);
  });

  it('banks toward the held key but never past the limit, and never flips', async () => {
    for (const key of ['rollLeft', 'rollRight'] as const) {
      const sim = await flyingSim();
      let peak = 0;
      for (let i = 0; i < 60 * 8; i++) { sim.step(controls({ [key]: true })); peak = Math.max(peak, Math.abs(sim.vehicle.roll)); }
      expect(peak).toBeGreaterThan(maxBank - 0.12);
      expect(peak).toBeLessThan(maxBank + 0.12);
      expect(Math.sign(sim.vehicle.roll)).toBe(key === 'rollLeft' ? 1 : -1);
    }
  });

  it('levels out when the roll key is released', async () => {
    const sim = await flyingSim();
    run(sim, 1, { rollLeft: true });
    expect(Math.abs(sim.vehicle.roll)).toBeGreaterThan(0.8);
    run(sim, 1.5);
    expect(Math.abs(sim.vehicle.roll)).toBeLessThan(0.05);
  });

  it('cannot be flipped by any mix of inputs', async () => {
    const sim = await flyingSim(20);
    let seed = 7, peak = 0;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 60 * 60; i++) {
      if (i % 20 === 0) {
        const roll = rnd();
        const state = { rollLeft: roll < 0.33, rollRight: roll > 0.66, thrust: rnd() < 0.5, accelerate: rnd() < 0.3, suction: rnd() < 0.3, steerLeft: rnd() < 0.1, steerRight: rnd() < 0.1 };
        (sim as unknown as { c: unknown }).c = state;
      }
      sim.step(controls((sim as unknown as { c?: object }).c ?? {}));
      peak = Math.max(peak, Math.abs(sim.vehicle.roll));
      if (sim.vehicle.position.y < 3) sim.vehicle.body.setTranslation({ ...sim.vehicle.position, y: 20 }, true);
    }
    expect(peak).toBeLessThan(maxBank + 0.15);
  });

  it('lifts on Space, falls under reduced gravity without it, and banking steers sideways', async () => {
    const sim = await flyingSim(20);
    run(sim, 0.5);
    const fall = sim.vehicle.body.linvel().y;
    expect(fall).toBeLessThan(-3);
    expect(fall).toBeGreaterThan(-0.6 * CONFIG.gravity * 0.5 - 0.2);
    run(sim, 1, { thrust: true });
    expect(sim.vehicle.body.linvel().y).toBeGreaterThan(0);
    const right = await flyingSim(20);
    run(right, 2, { rollRight: true, thrust: true });
    expect(right.vehicle.position.x).toBeGreaterThan(2);
    const left = await flyingSim(20);
    run(left, 2, { rollLeft: true, thrust: true });
    expect(left.vehicle.position.x).toBeLessThan(-2);
  });

  it('ignores suction and keeps cruising forward', async () => {
    const sim = await flyingSim(20);
    run(sim, 3, { suction: true });
    expect(sim.vehicle.suctionOn).toBe(false);
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(CONFIG.car.cruiseSpeed - 1);
  });

  it('uses the wider flight volume for its fall rule', async () => {
    const sim = await flyingSim(30);
    const monitor = new FailureMonitor();
    sim.vehicle.body.setTranslation({ x: 15, y: 30, z: -10 }, true);
    expect(monitor.check(sim)).toBeNull();
    sim.vehicle.body.setTranslation({ x: CONFIG.flight.bounds.halfWidth + 1, y: 30, z: -10 }, true);
    expect(monitor.check(sim)).toBe('fell');
    sim.vehicle.body.setTranslation({ x: 0, y: CONFIG.flight.bounds.minY - 1, z: -10 }, true);
    expect(monitor.check(sim)).toBe('fell');
    sim.vehicle.flying = false;
    sim.vehicle.body.setTranslation({ x: 15, y: 10, z: -10 }, true);
    expect(monitor.check(sim)).toBeNull();
  });
});

describe('flying pilot', () => {
  it('can follow a weaving path at top speed with the same inputs a player has', async () => {
    for (const [speed, amplitude, wavelength] of [[CONFIG.car.cruiseSpeed, 6, 200], [36, 7, 240]] as const) {
      const sim = await makeSim([], { x: 0, y: 14, z: -10 });
      sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -speed }, true);
      sim.vehicle.cruiseSpeed = speed;
      sim.vehicle.flying = true;
      const pilot = new FlightPilot(weave({ x: amplitude, y: 3 }, { x: wavelength, y: 170 }, 14));
      let peakRoll = 0;
      while (sim.distance < 1500) {
        sim.step(pilot.step(sim));
        peakRoll = Math.max(peakRoll, Math.abs(sim.vehicle.roll));
        expect(sim.vehicle.position.y).toBeGreaterThan(2);
      }
      expect(pilot.worst.x).toBeLessThan(1.5);
      expect(pilot.worst.y).toBeLessThan(1.5);
      expect(peakRoll).toBeLessThan(maxBank + 0.15);
    }
  });
});
