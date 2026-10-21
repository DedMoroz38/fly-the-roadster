import { describe, expect, it } from 'vitest';
import { controls, makeSim, run } from './helpers';

describe('V2 force controller contract', () => {
  it('queues forces and torque without changing pose or velocity before the physics step', async () => {
    const sim = await makeSim([], { x: 0, y: 100, z: -10 });
    const body = sim.vehicle.body;
    const position = body.translation(), rotation = body.rotation();
    const linear = body.linvel(), angular = body.angvel();
    sim.vehicle.applyControls(controls({ accelerate: true, thrust: true, rollRight: true }), sim.dt, sim.fuel);
    expect(body.translation()).toEqual(position);
    expect(body.rotation()).toEqual(rotation);
    expect(body.linvel()).toEqual(linear);
    expect(body.angvel()).toEqual(angular);
    expect(body.userForce().z).toBeLessThan(0);
    expect(body.userForce().y).toBeGreaterThan(0);
    expect(body.userTorque().z).toBeLessThan(0);
    sim.world.step();
    expect(body.linvel().z).toBeLessThan(0);
    expect(body.angvel().z).toBeLessThan(0);
    sim.dispose();
  });

  it('preserves an external speed loss and recovers by bounded engine acceleration', async () => {
    const sim = await makeSim([], { x: 0, y: 1000, z: -10 });
    run(sim, 2);
    sim.vehicle.body.applyImpulse({ x: 0, y: 0, z: sim.vehicle.body.mass() * 18 }, true);
    const reduced = -sim.vehicle.body.linvel().z;
    run(sim, sim.dt);
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(reduced);
    expect(sim.vehicle.forwardSpeed - reduced).toBeLessThan(1);
    sim.dispose();
  });
});
