import { describe, it, expect } from 'vitest';
import { makeSim, run } from './helpers';
import { CONFIG } from '../src/game/config';
import { wrapAngle } from '../src/core/math';

const longFloor = [{ surface: 'floor' as const, d0: -20, d1: 3000 }];

describe('thrusters', () => {
  it('Space lifts the car off the floor and consumes fuel', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 0.3);
    run(sim, 0.5, { thrust: true });
    expect(sim.vehicle.position.y).toBeGreaterThan(1.5);
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - 0.5, 1);
  });

  it('runs dry after ~5 s of continuous thrust and then stops pushing', async () => {
    const sim = await makeSim([], { x: 0, y: 5, z: -10 });
    let emptyAt = -1;
    let lastVy = 0;
    for (let i = 0; i < 60 * 7; i++) {
      run(sim, 1 / 60, { thrust: true });
      if (emptyAt < 0 && sim.fuel.isEmpty) emptyAt = sim.time;
      lastVy = sim.vehicle.body.linvel().y;
    }
    expect(emptyAt).toBeGreaterThan(4.9);
    expect(emptyAt).toBeLessThan(5.1);
    // After running dry only gravity acts: vertical speed decreases at exactly g.
    expect(lastVy).toBeLessThan((CONFIG.thrusters.liftAccel - CONFIG.gravity) * 5 - CONFIG.gravity * 1.9);
    const vy0 = sim.vehicle.body.linvel().y;
    run(sim, 0.5, { thrust: true });
    expect(sim.vehicle.body.linvel().y).toBeCloseTo(vy0 - CONFIG.gravity * 0.5, 0);
  });

  it('no fuel is consumed without thrust input, and thrust is independent of driving', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 1, { accelerate: true });
    expect(sim.fuel.value).toBe(CONFIG.fuel.capacity);
    run(sim, 0.3, { accelerate: true, thrust: true });
    expect(sim.vehicle.position.y).toBeGreaterThan(0.6);
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(20);
  });

  it('ArrowUp forward thruster accelerates beyond driving top speed, same fuel rate', async () => {
    const sim = await makeSim(longFloor);
    run(sim, 3, { accelerate: true });
    expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.maxForwardSpeed, 0);
    run(sim, 1, { accelerate: true, forwardThrust: true });
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(CONFIG.car.maxForwardSpeed + 10);
    expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - 1, 1);
  });

  it('forward thruster works in the air', async () => {
    const sim = await makeSim([], { x: 0, y: 5, z: -10 });
    run(sim, 0.5, { forwardThrust: true });
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(8);
  });

  it('both thrusters together burn fuel twice as fast', async () => {
    const sim = await makeSim([], { x: 0, y: 5, z: -10 });
    run(sim, 1, { forwardThrust: true, thrust: true });
    expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - 2, 1);
  });

  it('thrust pushes away from the wheels: upside down it pushes downward', async () => {
    const sim = await makeSim([], { x: 0, y: 5, z: -10 });
    sim.vehicle.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); // roll = 180°
    run(sim, 0.3, { thrust: true });
    // gravity + thrust both downward
    expect(sim.vehicle.body.linvel().y).toBeLessThan(-(CONFIG.gravity + CONFIG.thrusters.liftAccel) * 0.3 * 0.9);
  });

  it('rolled 90° left, thrust pushes toward the right', async () => {
    const sim = await makeSim([], { x: 0, y: 5, z: -10 });
    // roll +90°: roof points to -X, wheels face +X (right wall), thrust away from wheels => -X
    sim.vehicle.body.setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) }, true);
    run(sim, 0.3, { thrust: true });
    expect(sim.vehicle.body.linvel().x).toBeLessThan(-3);
  });
});

describe('barrel roll', () => {
  function trackRoll(sim: Awaited<ReturnType<typeof makeSim>>, seconds: number, c: object) {
    let total = 0;
    let prev = sim.vehicle.roll;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      run(sim, 1 / 60, c);
      const r = sim.vehicle.roll;
      total += wrapAngle(r - prev);
      prev = r;
    }
    return total;
  }

  it('left arrow performs a full 360° roll (positive about +Z) while airborne', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    const total = trackRoll(sim, 2, { rollLeft: true });
    expect(total).toBeGreaterThan(Math.PI * 2);
  });

  it('right arrow rolls the other way, continuously', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    const total = trackRoll(sim, 3, { rollRight: true });
    expect(total).toBeLessThan(-Math.PI * 3.5);
  });

  it('roll brakes smoothly after releasing (not instantly) and stops within ~25°', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    run(sim, 1, { rollLeft: true });
    const w0 = sim.vehicle.body.angvel().z;
    const r0 = sim.vehicle.roll;
    run(sim, 1 / 30);
    const w1 = sim.vehicle.body.angvel().z;
    expect(w1).toBeLessThan(w0);
    expect(w1).toBeGreaterThan(w0 * 0.5);
    run(sim, 1.2);
    expect(Math.abs(sim.vehicle.body.angvel().z)).toBeLessThan(0.05);
    expect(Math.abs(wrapAngle(sim.vehicle.roll - r0))).toBeLessThan((25 * Math.PI) / 180 + 0.45);
  });

  it('settles onto the nearest 90° orientation when released close to it', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    // Tap left until ~80°, release.
    while (sim.vehicle.roll < (75 * Math.PI) / 180) run(sim, 1 / 60, { rollLeft: true });
    run(sim, 1);
    expect(Math.abs(wrapAngle(sim.vehicle.roll - Math.PI / 2))).toBeLessThan(0.02);
  });

  it('holds an arbitrary angle far from 90° multiples (free rotation, no forced snapping)', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    while (sim.vehicle.roll < (20 * Math.PI) / 180) run(sim, 1 / 60, { rollLeft: true });
    run(sim, 1);
    const r = sim.vehicle.roll;
    expect(r).toBeGreaterThan((30 * Math.PI) / 180);
    expect(r).toBeLessThan((65 * Math.PI) / 180);
    run(sim, 1);
    expect(sim.vehicle.roll).toBeCloseTo(r, 3);
  });

  it('can roll 180° to face the ceiling', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    // Hold until roughly upside down, then release.
    for (let i = 0; i < 600 && Math.abs(wrapAngle(sim.vehicle.roll - Math.PI)) > 0.5; i++) run(sim, 1 / 60, { rollLeft: true });
    expect(Math.abs(wrapAngle(sim.vehicle.roll - Math.PI))).toBeLessThan(0.5);
  });

  it('pitch and yaw stay locked: no flips or free 3D rotation, even after collisions', async () => {
    const sim = await makeSim(
      [
        { surface: 'floor', d0: -20, d1: 40 },
        { surface: 'left', d0: 0, d1: 200 },
        { surface: 'right', d0: 0, d1: 200 },
        { surface: 'ceiling', d0: 0, d1: 200 },
      ],
    );
    let maxOff = 0;
    for (let i = 0; i < 60 * 6; i++) {
      const t = i / 60;
      run(sim, 1 / 60, {
        accelerate: true,
        thrust: t % 1 < 0.4,
        rollLeft: t % 2 < 0.7,
        rollRight: t % 3 > 2.2,
        steerLeft: t % 1.3 < 0.4,
        forwardThrust: t > 4,
      });
      const q = sim.vehicle.body.rotation();
      maxOff = Math.max(maxOff, Math.abs(q.x), Math.abs(q.y));
      const av = sim.vehicle.body.angvel();
      expect(Math.abs(av.x)).toBeLessThan(1e-6);
      expect(Math.abs(av.y)).toBeLessThan(1e-6);
    }
    expect(maxOff).toBeLessThan(1e-5);
  });
});

describe('self-righting', () => {
  it('a car lying on its roof on the floor can roll back onto its wheels', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 500 }], { x: 0, y: 0.4, z: -10 });
    sim.vehicle.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    run(sim, 0.5);
    expect(Math.abs(wrapAngle(sim.vehicle.roll - Math.PI))).toBeLessThan(0.1);
    for (let i = 0; i < 180 && sim.vehicle.mode !== 'grounded'; i++) {
      run(sim, 1 / 60, { rollLeft: Math.abs(wrapAngle(sim.vehicle.roll)) > 0.5 });
    }
    expect(sim.vehicle.mode).toBe('grounded');
    run(sim, 0.3);
    expect(Math.abs(wrapAngle(sim.vehicle.roll))).toBeLessThan(0.02);
  });

  it('a car lying on its side can roll upright', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 500 }], { x: 0, y: 0.95, z: -10 });
    sim.vehicle.body.setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) }, true);
    run(sim, 0.5);
    for (let i = 0; i < 180 && sim.vehicle.mode !== 'grounded'; i++) {
      run(sim, 1 / 60, { rollRight: Math.abs(wrapAngle(sim.vehicle.roll)) > 0.4 });
    }
    expect(sim.vehicle.mode).toBe('grounded');
  });

  it('rolling away from a wall after releasing suction is quick (no grinding against it)', async () => {
    const sim = await makeSim([{ surface: 'left', d0: -20, d1: 500 }], { x: -2, y: 8, z: -10 });
    sim.vehicle.body.setRotation({ x: 0, y: 0, z: Math.sin(-Math.PI / 4), w: Math.cos(-Math.PI / 4) }, true);
    sim.step({ ...(await import('./helpers')).controls({ toggleSuction: true }) });
    run(sim, 1);
    expect(sim.vehicle.mode).toBe('attached');
    sim.step((await import('./helpers')).controls({ toggleSuction: true }));
    const t0 = sim.time;
    while (Math.abs(wrapAngle(sim.vehicle.roll - Math.PI)) > 0.3 && sim.time - t0 < 3) run(sim, 1 / 60, { rollRight: true });
    expect(sim.time - t0).toBeLessThan(0.75);
  });
});
