import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIG } from '../src/game/config';
import {
  initialReachableState, planChunk, validatePlan,
  type PlannedChunk, type ScenarioKind,
} from '../src/game/course/planner';
import { PLANNER_CONFIG } from '../src/game/course/plannerConfig';
import { StaticLevel } from '../src/game/physics/level';
import { FailureMonitor } from '../src/game/session';
import { initPhysics, Simulation } from '../src/game/simulation';

const kinds: ScenarioKind[] = ['normal', 'gap', 'ceiling', 'wall-left', 'wall-right', 'multiple', 'flight'];
const candidates = new Map<ScenarioKind, PlannedChunk>();

beforeAll(async () => {
  await initPhysics();
  for (const [id, kind] of kinds.entries()) {
    candidates.set(kind, planChunk({ id, seed: 918 + id, kind, difficulty: 1, d0: 0, entry: initialReachableState() }));
  }
});

describe('constructive route contracts', () => {
  for (const kind of kinds) {
    it(`physically completes ${kind} with reaction time and finite resources`, () => {
      const plan = candidates.get(kind)!;
      expect(plan.kind).toBe(kind);
      expect(plan.validation.reasons).toEqual([]);
      expect(plan.validation.accepted).toBe(true);
      expect(validatePlan(plan).accepted).toBe(true);
      expect(plan.validation.minFuel).toBeGreaterThan(0);
      expect(plan.validation.maxHeat).toBeLessThan(CONFIG.suction.criticalHeat);
      expect(plan.validation.steps).toBeLessThanOrEqual(
        plan.validation.replayCount * Math.ceil(PLANNER_CONFIG.maxValidationSeconds * CONFIG.physicsHz),
      );
      expect(plan.validation.timingTolerance).toBeGreaterThanOrEqual(0.15);
      const firstAction = plan.witness.controls.findIndex(c => c.thrust || c.rollLeft || c.rollRight || c.steerLeft || c.steerRight || c.suction);
      if (kind !== 'normal') expect(firstAction * plan.witness.dt).toBeGreaterThanOrEqual(PLANNER_CONFIG.reactionSeconds);
      const multipleWall = plan.plan.find(p => p.action === 'catch' && (p.surface === 'left' || p.surface === 'right'))?.surface;
      const required = kind === 'multiple' ? ['floor', 'ceiling', multipleWall!]
        : kind === 'wall-left' ? ['floor', 'left']
          : kind === 'wall-right' ? ['floor', 'right']
            : kind === 'ceiling' ? ['floor', 'ceiling'] : ['floor'];
      expect(plan.validation.visitedSurfaces).toEqual(expect.arrayContaining(required));
    });
  }

  it('mirrors the multi-surface challenge onto both walls across seeds', () => {
    const walls = new Set<string>();
    for (let seed = 0; seed < 6 && walls.size < 2; seed++) {
      const plan = planChunk({ id: 0, seed: 400 + seed, kind: 'multiple', difficulty: 1, d0: 0, entry: initialReachableState() });
      expect(plan.validation.accepted).toBe(true);
      const wall = plan.plan.find(p => p.action === 'catch' && (p.surface === 'left' || p.surface === 'right'))!.surface!;
      expect(plan.validation.visitedSurfaces).toEqual(expect.arrayContaining(['floor', 'ceiling', wall]));
      walls.add(wall);
    }
    expect([...walls].sort()).toEqual(['left', 'right']);
  });

  it('leaves a meaningful extended flight interval with no traversable surfaces', () => {
    const flight = candidates.get('flight')!;
    const floors = flight.slabs.filter(s => s.surface === 'floor').sort((a, b) => a.d0 - b.d0);
    expect(floors).toHaveLength(2);
    const gapStart = floors[0].d1, gapEnd = floors[1].d0;
    expect(gapEnd - gapStart).toBeGreaterThanOrEqual(PLANNER_CONFIG.flightMin);
    expect(gapEnd - gapStart).toBeLessThanOrEqual(PLANNER_CONFIG.flightMax);
    expect(flight.slabs.some(s => s.d0 < gapEnd && s.d1 > gapStart)).toBe(false);
    expect(flight.route.some(p => p.d > gapStart + CONFIG.car.halfExtents.z && p.d < gapEnd - CONFIG.car.halfExtents.z && p.surface === null)).toBe(true);
  });

  it('rejects flight when fuel and all recharge opportunities are removed', () => {
    const original = candidates.get('flight')!;
    const result = validatePlan({ ...original, pickups: [] }, { ...original.entry, fuel: 0 });
    expect(result.accepted).toBe(false);
    expect(result.reasons).not.toEqual([]);
  });

  it('rejects one-frame suction pulses in place of the recorded sustained holds', () => {
    const original = candidates.get('ceiling')!;
    const controls = original.witness.controls;
    expect(controls.some((c, i) => c.suction && controls[i + 1]?.suction)).toBe(true);
    const edgeOnly = controls.map((c, i) => ({ ...c, suction: c.suction && !controls[i - 1]?.suction }));
    const result = validatePlan({ ...original, witness: { ...original.witness, controls: edgeOnly } });
    expect(result.accepted).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('rejects a transition when the required ceiling does not exist', () => {
    const original = candidates.get('ceiling')!;
    const result = validatePlan({ ...original, slabs: original.slabs.filter(s => s.surface !== 'ceiling') });
    expect(result.accepted).toBe(false);
    expect(result.visitedSurfaces).not.toContain('ceiling');
  });

  it('rejects an extended flight with its landing floor removed', () => {
    const original = candidates.get('flight')!;
    const firstFloor = original.slabs.find(s => s.surface === 'floor')!;
    const result = validatePlan({ ...original, slabs: [firstFloor] });
    expect(result.accepted).toBe(false);
    expect(result.reasons).not.toEqual([]);
  });

  it('rejects suction that starts at critical temperature and locked out', () => {
    const original = candidates.get('ceiling')!;
    const result = validatePlan(original, { ...original.entry, heat: CONFIG.suction.criticalHeat, overheated: true, suctionOn: true });
    expect(result.accepted).toBe(false);
    expect(result.reasons.some(reason => /heat|suction|recover/i.test(reason))).toBe(true);
  });

  it('runs consecutive movement witnesses in one world without resetting momentum or resources', () => {
    const first = candidates.get('multiple')!;
    const second = planChunk({ id: 8, seed: 1008, kind: 'wall-right', difficulty: 1, d0: first.d1, entry: first.exit });
    expect(second.validation.reasons).toEqual([]);
    const sim = new Simulation({ createLevel: world => new StaticLevel(world,
      [...first.slabs, ...second.slabs], [...first.pickups, ...second.pickups]) });
    const monitor = new FailureMonitor();
    try {
      for (const control of first.witness.controls) {
        sim.step(control);
        expect(monitor.check(sim)).toBeNull();
      }
      // Separately constructed validation worlds and continuous coalesced colliders
      // produce slightly different contact integration. Measured drift across kinds and
      // seeds reaches ~0.95 m, so both boundaries must stay within two physics steps
      // (~33 ms), well inside the certified ±150 ms action-timing margin.
      const seamTolerance = 2 * CONFIG.car.maxForwardSpeed / CONFIG.physicsHz;
      expect(Math.abs(sim.distance - first.d1 - second.entry.distanceOffset)).toBeLessThan(seamTolerance);
      expect(sim.vehicle.body.linvel().x).toBeCloseTo(second.entry.vx, 3);
      // The next floor collider already exists here, so contact solving at the
      // seam can differ by millimetres/second from an isolated chunk replay.
      expect(Math.abs(sim.vehicle.body.linvel().y - second.entry.vy)).toBeLessThan(0.02);
      expect(sim.vehicle.forwardSpeed).toBeCloseTo(second.entry.forward, 3);
      expect(sim.fuel.value).toBeCloseTo(second.entry.fuel, 3);
      expect(sim.vehicle.suctionHeat).toBeCloseTo(second.entry.heat, 3);
      let sawRight = false;
      for (const control of second.witness.controls) {
        sim.step(control);
        expect(monitor.check(sim)).toBeNull();
        sawRight ||= sim.vehicle.supportSurface === 'right';
      }
      expect(sawRight).toBe(true);
      // Rebasing a float physics world changes contact roundoff; the combined
      // run must remain within one integration step of the planned boundary.
      expect(Math.abs(sim.distance - second.d1 - second.exit.distanceOffset)).toBeLessThan(seamTolerance);
      expect(sim.vehicle.supportSurface).toBe('floor');
      expect(Math.abs(sim.vehicle.roll)).toBeLessThan(0.08);
      expect(Math.abs(sim.vehicle.position.x)).toBeLessThan(0.7);
      expect(sim.fuel.value).toBeGreaterThanOrEqual(PLANNER_CONFIG.exitFuelReserve);
      expect(sim.vehicle.suctionHeat).toBeLessThan(CONFIG.suction.recoveryHeat);
      expect(sim.vehicle.suctionOn).toBe(false);
    } finally {
      sim.dispose();
    }
  });
});
