import { describe, it, expect } from 'vitest';
import { makeSim, run, setRoll, controls } from './helpers';
import { evaluateSuction } from '../src/game/suction';
import { CONFIG } from '../src/game/config';
import { wrapAngle } from '../src/core/math';
import type { Simulation } from '../src/game/simulation';
import type { ControlState } from '../src/game/input';

const S = CONFIG.suction;
const H = CONFIG.corridor.height;
const he = CONFIG.car.halfExtents;

describe('evaluateSuction (pure rules)', () => {
  it('is off when not activated, regardless of surface', () => {
    expect(evaluateSuction(false, { surface: 'floor', gap: 0.1, alignment: 1 }).state).toBe('off');
  });
  it('does nothing when no surface or surface too far', () => {
    expect(evaluateSuction(true, null).state).toBe('searching');
    expect(evaluateSuction(true, { surface: 'floor', gap: S.range + 0.1, alignment: 1 }).state).toBe('searching');
  });
  it('requires the wheels to face the surface', () => {
    const tooTilted = Math.cos(((S.maxAlignAngleDeg + 5) * Math.PI) / 180);
    expect(evaluateSuction(true, { surface: 'floor', gap: 2, alignment: tooTilted }).state).toBe('searching');
    expect(evaluateSuction(true, { surface: 'floor', gap: 2, alignment: -1 }).state).toBe('searching');
    const okTilt = Math.cos(((S.maxAlignAngleDeg - 5) * Math.PI) / 180);
    expect(evaluateSuction(true, { surface: 'floor', gap: 2, alignment: okTilt }).state).toBe('attracting');
  });
  it('rejects unclassified faces and invalid measurements', () => {
    expect(evaluateSuction(true, { surface: null, gap: 0, alignment: 1 }).state).toBe('searching');
    expect(evaluateSuction(true, { surface: 'floor', gap: NaN, alignment: 1 }).state).toBe('searching');
  });
  it('pull grows as the surface gets closer, bounded', () => {
    const far = evaluateSuction(true, { surface: 'floor', gap: S.range - 0.01, alignment: 1 });
    const near = evaluateSuction(true, { surface: 'floor', gap: 1, alignment: 1 });
    expect(far.pull).toBeGreaterThan(0);
    expect(near.pull).toBeGreaterThan(far.pull);
    expect(near.pull).toBeLessThanOrEqual(S.maxAttractAccel);
  });
  it('attaches only when sufficiently close', () => {
    expect(evaluateSuction(true, { surface: 'floor', gap: S.attachDistance - 0.01, alignment: 1 }).state).toBe('attached');
    expect(evaluateSuction(true, { surface: 'floor', gap: S.attachDistance + 0.2, alignment: 1 }).state).toBe('attracting');
  });
});

const ceiling = [{ surface: 'ceiling' as const, d0: -20, d1: 2000 }];
const ceilingY = H - he.y; // car centre when resting on the ceiling

function hold(sim: Simulation, seconds: number, c: Partial<ControlState> = {}) {
  run(sim, seconds, { ...c, suction: true });
}

describe('ceiling attachment', () => {
  it('attaches when suction is on, wheels face the ceiling and it is close; then drives forward on it', async () => {
    const sim = await makeSim(ceiling, { x: 0, y: H - 2.5, z: -10 });
    setRoll(sim, Math.PI);
    hold(sim, sim.dt);
    hold(sim, 1);
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.supportSurface).toBe('ceiling');
    expect(sim.vehicle.position.y).toBeGreaterThan(ceilingY - 0.1);
    const d = sim.distance;
    hold(sim, 3, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.distance).toBeGreaterThan(d + 50);
    expect(sim.vehicle.forwardSpeed).toBeCloseTo(CONFIG.car.maxForwardSpeed, 0);
    expect(Math.abs(sim.vehicle.position.y - ceilingY)).toBeLessThan(0.1);
    expect(Math.abs(wrapAngle(sim.vehicle.roll - Math.PI))).toBeLessThan(0.05);
  });

  it('does not stick to the ceiling without suction', async () => {
    const sim = await makeSim(ceiling, { x: 0, y: ceilingY, z: -10 });
    setRoll(sim, Math.PI);
    run(sim, 1, { accelerate: true });
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.position.y).toBeLessThan(0);
  });

  it('does not attach when the wheels face away (upright under the ceiling)', async () => {
    const sim = await makeSim(ceiling, { x: 0, y: H - 2, z: -10 });
    hold(sim, sim.dt);
    hold(sim, 1);
    expect(sim.vehicle.suctionOn).toBe(true);
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.position.y).toBeLessThan(H - 5);
  });

  it('does not attach when the wheels face the ceiling at a steep 60° angle', async () => {
    const sim = await makeSim(ceiling, { x: 0, y: H - 2, z: -10 });
    setRoll(sim, Math.PI - Math.PI / 3);
    // hold the roll by counter-rolling to cancel any self-alignment: none should happen anyway
    hold(sim, sim.dt);
    hold(sim, 0.2);
    expect(sim.vehicle.suctionState).toBe('searching');
    hold(sim, 1);
    expect(sim.vehicle.mode).toBe('airborne');
  });

  it('does not attract from too far away (no teleport across the corridor)', async () => {
    // Upside down on the floor level: ceiling is ~9.3 m away from the wheels, beyond range.
    const sim = await makeSim([...ceiling], { x: 0, y: 1.0, z: -10 });
    setRoll(sim, Math.PI);
    hold(sim, sim.dt);
    hold(sim, 0.1);
    expect(sim.vehicle.suctionState).toBe('searching');
    expect(sim.vehicle.body.linvel().y).toBeLessThan(0);
  });

  it('pulls smoothly: approach speed is capped and position changes continuously', async () => {
    const sim = await makeSim(ceiling, { x: 0, y: H - S.range + 0.2, z: -10 });
    setRoll(sim, Math.PI);
    sim.vehicle.body.setLinvel({ x: 0, y: 6, z: 0 }, true);
    hold(sim, sim.dt);
    let prevY = sim.vehicle.position.y;
    let maxStep = 0, maxVy = 0;
    for (let i = 0; i < 90; i++) {
      hold(sim, 1 / 60);
      const y = sim.vehicle.position.y;
      maxStep = Math.max(maxStep, Math.abs(y - prevY));
      maxVy = Math.max(maxVy, sim.vehicle.body.linvel().y);
      prevY = y;
    }
    expect(sim.vehicle.mode).toBe('attached');
    expect(maxVy).toBeLessThanOrEqual(S.maxApproachSpeed + 1);
    expect(maxStep).toBeLessThan(0.3);
    // settled without bouncing off
    expect(Math.abs(sim.vehicle.body.linvel().y)).toBeLessThan(0.5);
  });

  it('disengaging suction releases the car', async () => {
    const sim = await makeSim(ceiling, { x: 0, y: H - 2, z: -10 });
    setRoll(sim, Math.PI);
    hold(sim, sim.dt);
    hold(sim, 1, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
    const vRelease = sim.vehicle.forwardSpeed;
    const fuelAtRelease = sim.fuel.value, heatAtRelease = sim.vehicle.suctionHeat;
    sim.step(controls());
    expect(sim.vehicle.suctionOn).toBe(false);
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.fuel.value).toBe(fuelAtRelease);
    expect(sim.vehicle.suctionHeat).toBeLessThan(heatAtRelease);
    run(sim, 0.8, { accelerate: true });
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.position.y).toBeLessThan(H - 3);
    // Continuous forward propulsion preserves forward travel on release.
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(10);
    expect(sim.vehicle.forwardSpeed).toBeGreaterThanOrEqual(vRelease - 0.1);
  });

  it('flags the moment of attachment exactly once', async () => {
    const sim = await makeSim(ceiling, { x: 0, y: H - 2, z: -10 });
    setRoll(sim, Math.PI);
    hold(sim, sim.dt);
    let count = 0;
    for (let i = 0; i < 120; i++) {
      hold(sim, 1 / 60);
      if (sim.vehicle.justAttached) count++;
    }
    expect(count).toBe(1);
  });
});

describe('wall attachment', () => {
  const W = CONFIG.corridor.halfWidth;
  it('attaches to the left wall when wheels face it (roll -90°) and drives along it without sliding down', async () => {
    const sim = await makeSim([{ surface: 'left', d0: -20, d1: 2000 }], { x: -4, y: 5, z: -10 });
    setRoll(sim, -Math.PI / 2);
    hold(sim, sim.dt);
    hold(sim, 1);
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.supportSurface).toBe('left');
    expect(sim.vehicle.position.x).toBeLessThan(-W + he.y + 0.1);
    const y0 = sim.vehicle.position.y;
    hold(sim, 3, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(30);
    expect(Math.abs(sim.vehicle.position.y - y0)).toBeLessThan(0.3);
  });

  it('on the left wall, steering left moves the car up the wall (car-relative controls)', async () => {
    const sim = await makeSim([{ surface: 'left', d0: -20, d1: 2000 }], { x: -4, y: 4, z: -10 });
    setRoll(sim, -Math.PI / 2);
    hold(sim, sim.dt);
    hold(sim, 1);
    const y0 = sim.vehicle.position.y;
    hold(sim, 0.3, { steerLeft: true }); // A/D alone steer while attached
    expect(sim.vehicle.position.y).toBeGreaterThan(y0 + 1);
    expect(sim.vehicle.mode).toBe('attached');
    hold(sim, 0.25, { steerRight: true }); // reverse lateral momentum
    const y1 = sim.vehicle.position.y;
    hold(sim, 0.3, { steerRight: true });
    expect(sim.vehicle.position.y).toBeLessThan(y1 - 1);
  });

  it('attaches to the right wall (roll +90°)', async () => {
    const sim = await makeSim([{ surface: 'right', d0: -20, d1: 2000 }], { x: 4, y: 5, z: -10 });
    setRoll(sim, Math.PI / 2);
    hold(sim, sim.dt);
    hold(sim, 1, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.supportSurface).toBe('right');
    hold(sim, 2, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
  });

  it('does not stick to a wall without suction even when touching it', async () => {
    const sim = await makeSim([{ surface: 'left', d0: -20, d1: 2000 }], { x: -W + he.y + 0.02, y: 5, z: -10 });
    setRoll(sim, -Math.PI / 2);
    run(sim, 1, { accelerate: true });
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.position.y).toBeLessThan(0);
  });

  it('wheels facing the wrong wall: no attachment', async () => {
    const sim = await makeSim([{ surface: 'left', d0: -20, d1: 2000 }], { x: -4, y: 5, z: -10 });
    setRoll(sim, Math.PI / 2); // wheels face the right side; left wall is behind the roof
    hold(sim, sim.dt);
    hold(sim, 0.5);
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.position.x).toBeGreaterThan(-5);
  });
});

describe('floor with suction', () => {
  it('still drives normally on the floor with suction on', async () => {
    const sim = await makeSim([{ surface: 'floor', d0: -20, d1: 2000 }]);
    hold(sim, sim.dt);
    hold(sim, 2, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.forwardSpeed).toBeGreaterThan(30);
  });
});
