import { describe, it, expect } from 'vitest';
import { makeSim, run, setRoll, controls } from './helpers';
import { CONFIG } from '../src/game/config';
import { wrapAngle } from '../src/core/math';
import type { Simulation } from '../src/game/simulation';
import type { ControlState } from '../src/game/input';

const H = CONFIG.corridor.height;

/** Steps until `done` returns true (or timeout), applying controls from `ctl` each step. */
function until(sim: Simulation, done: () => boolean, ctl: Partial<ControlState>, maxSeconds = 10) {
  const t0 = sim.time;
  while (!done()) {
    if (sim.time - t0 > maxSeconds) {
      const p = sim.vehicle.position;
      throw new Error(
        `timeout: t=${sim.time.toFixed(2)} d=${sim.distance.toFixed(1)} pos=(${p.x.toFixed(2)},${p.y.toFixed(2)}) ` +
          `roll=${sim.vehicle.roll.toFixed(2)} mode=${sim.vehicle.mode} suction=${sim.vehicle.suctionState} ` +
          `gap=${sim.vehicle.probe?.gap.toFixed(2)} surf=${sim.vehicle.probe?.surface}`,
      );
    }
    sim.step(controls(ctl));
  }
}

describe('scripted transitions (as a player would do them)', () => {
  it('floor -> ceiling: thrust up, 180° barrel roll, suction, drive on the ceiling', async () => {
    const sim = await makeSim([
      { surface: 'floor', d0: -20, d1: 80 },
      { surface: 'ceiling', d0: 60, d1: 600 },
    ]);
    let minY = Infinity;
    const track = () => (minY = Math.min(minY, sim.vehicle.position.y));
    until(sim, () => (track(), sim.distance > 50), { accelerate: true });
    expect(sim.vehicle.mode).toBe('grounded');
    run(sim, 0.55, { accelerate: true, thrust: true });
    expect(sim.vehicle.mode).toBe('airborne');
    until(sim, () => (track(), Math.abs(wrapAngle(sim.vehicle.roll - Math.PI)) < 0.35), { rollLeft: true });
    // Suction is engaged once the wheels face the ceiling (engaging earlier would pull toward the floor).
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => (track(), sim.vehicle.mode === 'attached'), {}, 3);
    expect(sim.vehicle.supportSurface).toBe('ceiling');
    run(sim, 6, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.supportSurface).toBe('ceiling');
    expect(sim.distance).toBeGreaterThan(250);
    expect(minY).toBeGreaterThan(0);
    // Used thrust, but well under the tank size.
    expect(sim.fuel.value).toBeGreaterThan(CONFIG.fuel.capacity - 1);
  });

  it('ceiling -> left wall: suction off, 90° roll, suction on, drive along the wall', async () => {
    const sim = await makeSim(
      [
        { surface: 'ceiling', d0: -20, d1: 140 },
        { surface: 'left', d0: 110, d1: 600 },
      ],
      { x: 0, y: H - 1.5, z: -10 },
    );
    setRoll(sim, Math.PI);
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => sim.vehicle.mode === 'attached', {}, 2);
    // Upside down, the car's right is world -X: steer right to approach the left wall.
    until(sim, () => sim.vehicle.position.x < -4, { accelerate: true, steerRight: true });
    until(sim, () => sim.distance > 105, { accelerate: true });
    expect(sim.vehicle.position.x).toBeLessThan(-3);
    sim.step(controls({ toggleSuction: true, accelerate: true })); // off: gravity releases the car
    // Roll +90° so the wheels face -X (left wall).
    until(sim, () => Math.abs(wrapAngle(sim.vehicle.roll + Math.PI / 2)) < 0.3, { rollLeft: true }, 3);
    sim.step(controls({ toggleSuction: true })); // on
    until(sim, () => sim.vehicle.mode === 'attached', {}, 3);
    expect(sim.vehicle.supportSurface).toBe('left');
    const y = sim.vehicle.position.y;
    expect(y).toBeGreaterThan(3); // caught well above the bottom edge of the wall
    run(sim, 6, { accelerate: true });
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.supportSurface).toBe('left');
    expect(sim.distance).toBeGreaterThan(300);
  });

  it('ceiling -> right wall works the same way mirrored', async () => {
    const sim = await makeSim(
      [
        { surface: 'ceiling', d0: -20, d1: 140 },
        { surface: 'right', d0: 110, d1: 600 },
      ],
      { x: 0, y: H - 1.5, z: -10 },
    );
    setRoll(sim, Math.PI);
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => sim.vehicle.mode === 'attached', {}, 2);
    until(sim, () => sim.vehicle.position.x > 4, { accelerate: true, steerLeft: true });
    until(sim, () => sim.distance > 105, { accelerate: true });
    expect(sim.vehicle.position.x).toBeGreaterThan(3);
    sim.step(controls({ toggleSuction: true, accelerate: true }));
    until(sim, () => Math.abs(wrapAngle(sim.vehicle.roll - Math.PI / 2)) < 0.3, { rollRight: true }, 3);
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => sim.vehicle.mode === 'attached', {}, 3);
    expect(sim.vehicle.supportSurface).toBe('right');
    run(sim, 5, { accelerate: true });
    expect(sim.vehicle.supportSurface).toBe('right');
  });

  it('wall -> floor: steer down the wall, release, roll upright and keep driving', async () => {
    const W = CONFIG.corridor.halfWidth;
    const sim = await makeSim(
      [
        { surface: 'left', d0: -20, d1: 150 },
        { surface: 'floor', d0: 100, d1: 600 },
      ],
      { x: -W + 1.5, y: 6, z: -10 },
    );
    setRoll(sim, -Math.PI / 2);
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => sim.vehicle.mode === 'attached', {}, 2);
    until(sim, () => sim.vehicle.position.y < 2, { accelerate: true, steerRight: true }); // right = down on the left wall
    until(sim, () => sim.distance > 110, { accelerate: true });
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => Math.abs(wrapAngle(sim.vehicle.roll)) < 0.25, { rollLeft: true }, 3);
    until(sim, () => sim.vehicle.mode === 'grounded', {}, 3);
    run(sim, 4, { accelerate: true });
    expect(sim.vehicle.mode).toBe('grounded');
    expect(sim.distance).toBeGreaterThan(250);
  });

  it('floor -> ceiling fails without suction (falls back down)', async () => {
    const sim = await makeSim([
      { surface: 'floor', d0: -20, d1: 80 },
      { surface: 'ceiling', d0: 60, d1: 600 },
    ]);
    until(sim, () => sim.distance > 50, { accelerate: true });
    run(sim, 0.55, { accelerate: true, thrust: true });
    until(sim, () => Math.abs(wrapAngle(sim.vehicle.roll - Math.PI)) < 0.35, { rollLeft: true });
    run(sim, 3);
    expect(sim.vehicle.position.y).toBeLessThan(-10);
  });

  it('thrust assists a late wall catch: roll roof-up first, thrust to regain height, then roll onto the wall', async () => {
    const sim = await makeSim(
      [
        { surface: 'ceiling', d0: -20, d1: 120 },
        { surface: 'left', d0: 185, d1: 600 },
      ],
      { x: -4.5, y: CONFIG.corridor.height - 1.5, z: -10 },
    );
    setRoll(sim, Math.PI);
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => sim.vehicle.mode === 'attached', {}, 2);
    until(sim, () => sim.distance > 122, { accelerate: true });
    sim.step(controls({ toggleSuction: true })); // release
    // 65 m with no surface before the wall starts: roll upright and thrust to hold altitude.
    // Thrust only once the roof points mostly up (thrust pushes away from the wheels).
    const wantThrust = () =>
      Math.cos(sim.vehicle.roll) > 0.7 && sim.vehicle.position.y + sim.vehicle.body.linvel().y * 0.4 < 6;
    while (sim.distance < 180) sim.step(controls({ thrust: wantThrust(), rollLeft: Math.abs(wrapAngle(sim.vehicle.roll)) > 0.3 }));
    const fuelUsed = CONFIG.fuel.capacity - sim.fuel.value;
    expect(fuelUsed).toBeGreaterThan(0.25);
    expect(sim.vehicle.position.y).toBeGreaterThan(1); // still inside the corridor thanks to thrust
    // Roll right 90° from upright: roll -90° => roof +X, wheels face the left wall.
    until(sim, () => Math.abs(wrapAngle(sim.vehicle.roll + Math.PI / 2)) < 0.3, { rollRight: true }, 3);
    sim.step(controls({ toggleSuction: true }));
    until(sim, () => sim.vehicle.mode === 'attached', {}, 3);
    expect(sim.vehicle.supportSurface).toBe('left');
    run(sim, 4, { accelerate: true });
    expect(sim.vehicle.supportSurface).toBe('left');
  });
});
