import { describe, it, expect } from 'vitest';
import { makeSim, run } from './helpers';
import { CONFIG } from '../src/game/config';

const longFloor = [{ surface: 'floor' as const, d0: -20, d1: 2000 }];

describe('driving', () => {
  it('rests on the floor without input', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 1);
    expect(sim.vehicle.mode).toBe('grounded');
    expect(sim.vehicle.position.y).toBeGreaterThan(0.2);
    expect(sim.vehicle.position.y).toBeLessThan(0.6);
    expect(Math.abs(sim.distance - 10)).toBeLessThan(0.1);
  });

  it('accelerates forward with W up to max speed', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 0.5);
    const d0 = sim.distance;
    run(sim, 1, { accelerate: true });
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(15);
    run(sim, 3, { accelerate: true });
    expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.maxForwardSpeed, 0);
    expect(sim.distance).toBeGreaterThan(d0 + 50);
    // Stayed on the floor and upright, no drift sideways.
    expect(sim.vehicle.mode).toBe('grounded');
    expect(Math.abs(sim.vehicle.roll)).toBeLessThan(0.05);
    expect(Math.abs(sim.vehicle.position.x)).toBeLessThan(0.05);
  });

  it('brakes to a stop and then reverses with S', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 2, { accelerate: true });
    run(sim, 0.4, { brake: true });
    expect(sim.vehicle.forwardSpeed).toBeLessThan(25);
    run(sim, 2, { brake: true });
    expect(sim.vehicle.forwardSpeed).toBeLessThan(-5);
    expect(sim.vehicle.forwardSpeed).toBeGreaterThanOrEqual(-CONFIG.car.maxReverseSpeed - 0.01);
  });

  it('coasts down when no input', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 2, { accelerate: true });
    const v = sim.vehicle.forwardSpeed;
    run(sim, 1);
    expect(sim.vehicle.forwardSpeed).toBeLessThan(v);
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(v - 5);
  });

  it('steers laterally with A/D on the floor', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 0.3);
    run(sim, 0.4, { steerRight: true, accelerate: true });
    expect(sim.vehicle.position.x).toBeGreaterThan(1);
    run(sim, 0.8, { steerLeft: true });
    expect(sim.vehicle.position.x).toBeLessThan(0);
  });

  it('falls under gravity and keeps momentum when driving off the end of a floor', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 60 }]);
    run(sim, 2.2, { accelerate: true });
    // Car has left the floor (distance > 60) and is airborne, still moving forward fast.
    run(sim, 0.6, { accelerate: true });
    expect(sim.distance).toBeGreaterThan(60);
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(25);
    expect(sim.vehicle.position.y).toBeLessThan(0);
    // No drive while airborne: braking does nothing to forward speed.
    const v = sim.vehicle.forwardSpeed;
    run(sim, 0.3, { brake: true });
    expect(sim.vehicle.forwardSpeed).toBeCloseTo(v, 1);
  });

  it('does not drive on a wall without suction (falls off it)', async () => {
    // Car spawned rolled 90° against the left wall: no floor; it must slide down.
    const sim = await makeSim([{ surface: 'left', d0: -20, d1: 200 }], { x: -5.6, y: 5, z: -10 });
    sim.vehicle.body.setRotation({ x: 0, y: 0, z: Math.sin(-Math.PI / 4), w: Math.cos(-Math.PI / 4) }, true);
    run(sim, 1, { accelerate: true });
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.position.y).toBeLessThan(0);
  });
});

describe('slab seams', () => {
  it('drives smoothly across many adjacent floor slabs at full speed', async () => {
    const slabs = Array.from({ length: 60 }, (_, i) => ({ surface: 'floor' as const, d0: -20 + i * 15, d1: -20 + (i + 1) * 15 }));
    const sim = await makeSim(slabs);
    run(sim, 0.3);
    let maxY = 0, minY = 10, minSpeedAfter = Infinity;
    for (let i = 0; i < 60 * 8; i++) {
      run(sim, 1 / 60, { accelerate: true });
      const y = sim.vehicle.position.y;
      maxY = Math.max(maxY, y);
      minY = Math.min(minY, y);
      if (sim.time > 2.5) minSpeedAfter = Math.min(minSpeedAfter, sim.vehicle.forwardSpeed);
    }
    expect(sim.distance).toBeGreaterThan(200);
    expect(maxY - minY).toBeLessThan(0.1);
    expect(minSpeedAfter).toBeGreaterThan(30);
  });
});
