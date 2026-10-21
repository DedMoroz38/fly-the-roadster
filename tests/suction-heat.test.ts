import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import { advanceSuctionHeat } from '../src/game/suction';
import { controls, makeSim, run, setRoll } from './helpers';

const S = CONFIG.suction;
const floor = [{ surface: 'floor' as const, d0: -20, d1: 4000 }];
const ceiling = [{ surface: 'ceiling' as const, d0: -20, d1: 4000 }];
const wall = [{ surface: 'left' as const, d0: -20, d1: 4000 }];

const hold = (sim: Awaited<ReturnType<typeof makeSim>>, seconds: number, c = {}) => run(sim, seconds, { ...c, suction: true });

async function attached(surface: 'floor' | 'left' | 'ceiling') {
  const sim = await makeSim(surface === 'floor' ? floor : surface === 'left' ? wall : ceiling,
    surface === 'floor' ? undefined : surface === 'left' ? { x: -5.65, y: 5, z: -10 } : { x: 0, y: 9.65, z: -10 });
  setRoll(sim, surface === 'floor' ? 0 : surface === 'left' ? -Math.PI / 2 : Math.PI);
  run(sim, 1 / 60); // populate Rapier's query pipeline before probing
  hold(sim, sim.dt);
  return sim;
}

describe('suction thermal hysteresis', () => {
  it('hits critical heat, locks out until below recovery, then resumes while E remains held', async () => {
    const sim = await attached('floor');
    for (let i = 0; i < 400 && !sim.vehicle.suctionOverheated; i++) hold(sim, 1 / 60);
    expect(sim.vehicle.suctionHeat).toBe(S.criticalHeat);
    expect(sim.vehicle.suctionOn).toBe(false);
    expect(sim.vehicle.suctionState).toBe('overheated');
    expect(sim.vehicle.mode).toBe('grounded');
    hold(sim, sim.dt);
    expect(sim.vehicle.suctionOn).toBe(false);
    expect(sim.vehicle.suctionOverheated).toBe(true);
    for (let i = 0; i < 300 && sim.vehicle.suctionOverheated; i++) hold(sim, 1 / 60);
    expect(sim.vehicle.suctionHeat).toBeLessThan(S.recoveryHeat);
    expect(sim.vehicle.suctionOverheated).toBe(false);
    expect(sim.vehicle.suctionOn).toBe(false);
    hold(sim, sim.dt);
    expect(sim.vehicle.suctionOn).toBe(true);
    run(sim, 0.5); // release prevents further activation
    expect(sim.vehicle.suctionOn).toBe(false);
  });

  it('releases a ceiling attachment in the same step that it overheats', async () => {
    const sim = await attached('ceiling');
    hold(sim, 0.5);
    expect(sim.vehicle.mode).toBe('attached');
    sim.vehicle.suctionHeat = S.criticalHeat - S.heatRate * sim.dt / 2;
    hold(sim, 1 / 60);
    expect(sim.vehicle.suctionOverheated).toBe(true);
    expect(sim.vehicle.suctionOn).toBe(false);
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.body.linvel().y).toBeLessThan(0);
  });

  it('cools at the configured rate while off and never below zero', async () => {
    const sim = await attached('floor');
    hold(sim, 2);
    run(sim, sim.dt); // release
    const heat = sim.vehicle.suctionHeat;
    run(sim, 1);
    expect(sim.vehicle.suctionHeat).toBeCloseTo(heat - S.coolingRate, 5);
    run(sim, 8);
    expect(sim.vehicle.suctionHeat).toBe(0);
  });

  it('does not unlock exactly at the recovery threshold and accepts a held request after cooling', () => {
    const locked = advanceSuctionHeat({ heat: S.recoveryHeat + S.coolingRate, overheated: true, active: true }, 1, false);
    expect(locked).toEqual({ heat: S.recoveryHeat, overheated: true, active: false });
    const recovered = advanceSuctionHeat(locked, 1 / 60, false);
    expect(recovered.overheated).toBe(false);
    expect(recovered.active).toBe(false);
    expect(advanceSuctionHeat({ ...recovered, active: true }, 1 / 60, false).active).toBe(true);
  });

  it('distinguishes actual floor contact from airborne attraction toward the floor', async () => {
    const sim = await makeSim(floor, { x: 0, y: 1.5, z: -10 });
    run(sim, 1 / 60);
    hold(sim, sim.dt);
    expect(sim.vehicle.suctionState).toBe('attracting');
    expect(sim.vehicle.suctionHeat).toBeCloseTo(S.heatRate / 60, 5);
  });
});

describe('suction energy and viability', () => {
  it('charges much more heat and fuel on the floor than on a wall', async () => {
    const floorSim = await attached('floor');
    const wallSim = await attached('left');
    hold(floorSim, 2);
    hold(wallSim, 2);
    expect(floorSim.vehicle.suctionHeat).toBeGreaterThan(wallSim.vehicle.suctionHeat * 10);
    expect(CONFIG.fuel.capacity - floorSim.fuel.value).toBeGreaterThan((CONFIG.fuel.capacity - wallSim.fuel.value) * 3);
    expect(floorSim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - S.floorFuelRate * (floorSim.time - 1 / 60), 4);
    expect(wallSim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - S.fuelRate * (wallSim.time - 1 / 60), 4);
  });

  it('adds rolling resistance on the floor while still allowing sustained forward travel', async () => {
    const normal = await makeSim(floor);
    const sticky = await attached('floor');
    run(normal, 3, { accelerate: true });
    hold(sticky, 3, { accelerate: true });
    expect(sticky.vehicle.forwardSpeed).toBeLessThan(normal.vehicle.forwardSpeed - 0.5);
    expect(sticky.vehicle.forwardSpeed).toBeGreaterThan(CONFIG.car.cruiseSpeed);
    expect(sticky.vehicle.suctionOverheated).toBe(false);
  });

  for (const surface of ['left', 'ceiling'] as const) {
    it(`${surface} traversal remains powered and attached for 25 seconds`, async () => {
      const sim = await attached(surface);
      hold(sim, 25);
      expect(sim.vehicle.mode).toBe('attached');
      expect(sim.vehicle.supportSurface).toBe(surface);
      expect(sim.vehicle.suctionOn).toBe(true);
      expect(sim.vehicle.suctionHeat).toBeLessThan(40);
      expect(sim.vehicle.suctionOverheated).toBe(false);
      expect(sim.fuel.value).toBeGreaterThan(3.9);
      expect(sim.distance).toBeGreaterThan(500);
    });
  }

  it('detaches immediately when empty, resumes after refilling only while E is held', async () => {
    const sim = await attached('ceiling');
    hold(sim, 0.5);
    sim.fuel.consume(1, sim.fuel.value);
    hold(sim, 1 / 60);
    expect(sim.vehicle.suctionOn).toBe(false);
    expect(sim.vehicle.suctionState).toBe('no-energy');
    expect(sim.vehicle.mode).toBe('airborne');
    expect(sim.vehicle.body.linvel().y).toBeLessThan(0);
    hold(sim, sim.dt);
    expect(sim.vehicle.suctionOn).toBe(false);
    sim.fuel.refill();
    hold(sim, sim.dt); // continuous held request resumes as soon as energy returns
    expect(sim.vehicle.suctionOn).toBe(true);
    sim.fuel.consume(1, sim.fuel.value);
    hold(sim, sim.dt);
    sim.fuel.refill();
    run(sim, 1 / 60); // released E does not restart suction after refill
    expect(sim.vehicle.suctionOn).toBe(false);
  });

  it('shares the last fuel proportionally between lift, roll and suction in the same step', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    const rate = CONFIG.thrusters.liftFuelRate + CONFIG.thrusters.rollFuelRate + S.fuelRate;
    sim.fuel.consume(1, CONFIG.fuel.capacity - rate * sim.dt * 0.5);
    sim.step(controls({ thrust: true, rollLeft: true, suction: true }));
    expect(sim.vehicle.liftThrust).toBeCloseTo(0.5, 6);
    expect(sim.vehicle.rollLeftThrust).toBeCloseTo(0.5, 6);
    expect(sim.fuel.isEmpty).toBe(true);
    expect(sim.vehicle.suctionState).toBe('no-energy');
    expect(sim.vehicle.suctionOn).toBe(false);
  });

  it('charges roll fuel and stops powered roll thrust when the tank is empty', async () => {
    const sim = await makeSim([], { x: 0, y: 500, z: -10 });
    run(sim, 1, { rollRight: true });
    expect(sim.fuel.value).toBeCloseTo(CONFIG.fuel.capacity - CONFIG.thrusters.rollFuelRate, 5);
    sim.fuel.consume(1, sim.fuel.value);
    run(sim, 1 / 60, { rollRight: true });
    expect(sim.vehicle.rollRightThrust).toBe(0);
    expect(sim.vehicle.rollLeftThrust).toBe(0);
  });

  it('cannot pull the car across the corridor from a distant wall', async () => {
    const sim = await makeSim(wall, { x: 0, y: 5, z: -10 });
    setRoll(sim, -Math.PI / 2);
    hold(sim, sim.dt);
    hold(sim, 0.1);
    expect(sim.vehicle.suctionState).toBe('searching');
    expect(sim.vehicle.position.x).toBeCloseTo(0, 5);
    expect(sim.vehicle.body.linvel().x).toBeCloseTo(0, 5);
  });
});
