import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { makeSim, run } from './helpers';

const airborne = { x: 0, y: 5000, z: -10 };
const T = CONFIG.thrusters;

describe('fuel-backed forward acceleration', () => {
  it('burns the configured acceleration rate while W is held and stops charging on release', async () => {
    const sim = await makeSim([], airborne);
    try {
      sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -CONFIG.car.cruiseSpeed }, true);
      run(sim, 2, { accelerate: true });
      expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.maxForwardSpeed, 1);
      expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - 2 * T.boostFuelRate, 5);
      const fuel = sim.fuel.value;
      run(sim, 1);
      expect(sim.fuel.value).toBe(fuel);
      expect(sim.vehicle.forwardThrust).toBe(0);
    } finally { sim.dispose(); }
  });

  it('charges combined acceleration, lift, roll and suction from one shared tank', async () => {
    const sim = await makeSim([], airborne);
    try {
      run(sim, 0.5, { accelerate: true, thrust: true, rollLeft: true, suction: true });
      const rate = T.boostFuelRate + T.liftFuelRate + T.rollFuelRate + CONFIG.suction.fuelRate;
      expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - 0.5 * rate, 5);
      expect(sim.vehicle.liftThrust).toBe(1);
      expect(sim.vehicle.suctionOn).toBe(true);
    } finally { sim.dispose(); }
  });

  it('keeps automatic cruise free with an empty tank even when acceleration is held', async () => {
    for (const accelerate of [false, true]) {
      const sim = await makeSim([], airborne);
      try {
        sim.fuel.consume(1, CONFIG.fuel.capacity);
        run(sim, 4, { accelerate });
        expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.cruiseSpeed, 2);
        expect(sim.fuel.value).toBe(0);
        expect(sim.vehicle.forwardThrust).toBe(0);
      } finally { sim.dispose(); }
    }
  });

  it('shares fractional final fuel fairly and reports only powered forward exhaust', async () => {
    const sim = await makeSim([], airborne);
    try {
      const rate = T.boostFuelRate + T.liftFuelRate + T.rollFuelRate + CONFIG.suction.fuelRate;
      sim.fuel.consume(1, CONFIG.fuel.capacity - rate * sim.dt * 0.5);
      sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -CONFIG.car.cruiseSpeed }, true);
      run(sim, sim.dt, { accelerate: true, thrust: true, rollLeft: true, suction: true });
      expect(sim.fuel.value).toBe(0);
      expect(sim.vehicle.forwardThrust).toBeCloseTo(0.5, 5);
      expect(sim.vehicle.liftThrust).toBeCloseTo(0.5, 5);
      expect(sim.vehicle.rollLeftThrust).toBeCloseTo(0.5, 5);
      expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.cruiseSpeed + CONFIG.car.acceleration * sim.dt * 0.5, 4);
      expect(sim.vehicle.body.linvel().y).toBeCloseTo((T.liftAccel * 0.5 - CONFIG.gravity) * sim.dt, 4);
      expect(sim.vehicle.suctionOn).toBe(false);
      const speed = sim.vehicle.forwardSpeed;
      run(sim, sim.dt, { accelerate: true, thrust: true, rollLeft: true, suction: true });
      expect(sim.vehicle.forwardSpeed).toBeLessThan(speed);
      expect(sim.vehicle.forwardThrust).toBe(0);
      expect(sim.vehicle.liftThrust).toBe(0);
      expect(sim.vehicle.rollLeftThrust).toBe(0);
    } finally { sim.dispose(); }
  });

  it('lets exhausted acceleration coast smoothly back to cruise without a velocity snap', async () => {
    const sim = await makeSim([], airborne);
    try {
      sim.fuel.consume(1, CONFIG.fuel.capacity);
      sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -CONFIG.car.maxForwardSpeed }, true);
      run(sim, sim.dt, { accelerate: true });
      expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.maxForwardSpeed - CONFIG.car.coastDecel * sim.dt, 4);
      run(sim, 4, { accelerate: true });
      expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.cruiseSpeed, 2);
      expect(sim.vehicle.forwardThrust).toBe(0);
    } finally { sim.dispose(); }
  });

  it('scales funded extra force and its exhaust together when the tank cannot supply a full step', async () => {
    const outputs: number[] = [], speeds: number[] = [];
    for (const fraction of [1, 0.5, 0]) {
      const sim = await makeSim([], airborne);
      try {
        sim.fuel.consume(1, CONFIG.fuel.capacity - T.boostFuelRate * sim.dt * fraction);
        sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -(CONFIG.car.cruiseSpeed + 1) }, true);
        run(sim, sim.dt, { accelerate: true });
        outputs.push(sim.vehicle.forwardThrust);
        speeds.push(sim.vehicle.forwardSpeed);
      } finally { sim.dispose(); }
    }
    expect(outputs[0]).toBeCloseTo(1, 5);
    expect(outputs[1]).toBeCloseTo(outputs[0] / 2, 5);
    expect(outputs[2]).toBe(0);
    expect(speeds[1] - speeds[2]).toBeCloseTo((speeds[0] - speeds[2]) / 2, 5);
  });
});
