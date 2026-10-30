import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, Simulation } from '../src/game/simulation';
import { StaticLevel } from '../src/game/physics/level';
import { CONFIG } from '../src/game/config';
import { PLANNER_CONFIG as P } from '../src/game/course/plannerConfig';
import { initialReachableState, planChunk } from '../src/game/course/planner';
import { FailureMonitor, GameSession } from '../src/game/session';
import { controls, run, setRoll } from './helpers';

beforeAll(async () => {
  await initPhysics();
});

const H = CONFIG.corridor.height;
const barBottom = H - P.ceilingBarHeight;
const BAR = 70;

/** A car attached to a long ceiling at 32 m/s, heading for one hanging bar. */
function ceilingRun(bar = true) {
  const sim = new Simulation({
    spawn: { x: 0, y: H - CONFIG.car.halfExtents.y, z: 0 },
    createLevel: w => new StaticLevel(w, [{ surface: 'floor', d0: -30, d1: 300 }, { surface: 'ceiling', d0: -30, d1: 300 }], [],
      bar ? [{ id: 1, x: 0, y: H - P.ceilingBarHeight / 2, d: BAR, half: { x: CONFIG.corridor.halfWidth, y: P.ceilingBarHeight / 2, z: P.ceilingBarHalfLength } }] : []),
  });
  sim.vehicle.cruiseSpeed = sim.vehicle.maxSpeed = 32;
  setRoll(sim, Math.PI);
  sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -32 }, true);
  run(sim, 0.5, { suction: true });
  return sim;
}

/** Seconds until the nose reaches the bar's near face; negative once it is past. */
const toBar = (sim: Simulation) => (BAR - P.ceilingBarHalfLength - sim.distance - CONFIG.car.halfExtents.z) / sim.vehicle.forwardSpeed;

/** Cuts suction `release` s before the nose reaches the bar and holds it again `resume` s after (null: never cut). */
function pass(release: number | null, resume = 0) {
  const sim = ceilingRun();
  const monitor = new FailureMonitor();
  let failed: string | null = null;
  try {
    while (sim.distance < BAR + 40 && !failed) {
      const t = toBar(sim);
      sim.step(controls({ suction: release === null || t > release || t < -resume }));
      failed = monitor.check(sim);
    }
    return { failed, onCeiling: sim.vehicle.mode === 'attached' && sim.vehicle.supportSurface === 'ceiling' };
  } finally { sim.dispose(); }
}

describe('ceiling bars', () => {
  it('crashes a car that keeps suction on into the bar', () => {
    expect(pass(null).failed).toBe('crashed');
  });

  it('drops under the bar after a suction cut and pulls back up across a wide re-engage window', () => {
    // Nominal plan: cut 0.5 s before the bar, hold Shift again 0.05 s after the nose reaches it.
    // The cut may come 0.15 s late, and Shift may return from just before the nose reaches the bar
    // to 0.3 s after it: the margin for sucking back in.
    for (const release of [P.ceilingBarRelease, P.ceilingBarRelease - P.timingTolerance]) {
      for (const resume of [-0.1, P.ceilingBarResume, 0.3]) {
        expect(pass(release, resume), `cut ${release} s before, resume ${resume} s after`).toEqual({ failed: null, onCeiling: true });
      }
    }
  });

  it('drops off a ceiling as before, but can pull back up from beyond the normal suction range', () => {
    const sim = ceilingRun(false);
    const y0 = sim.vehicle.position.y;
    run(sim, 0.3);
    // An ordinary fall: at least 80% of free fall from rest.
    expect(y0 - sim.vehicle.position.y).toBeGreaterThan(0.8 * CONFIG.gravity * 0.3 ** 2 / 2);
    run(sim, 0.4);
    expect(H - sim.vehicle.position.y - CONFIG.car.halfExtents.y).toBeGreaterThan(CONFIG.suction.range);
    for (let i = 0; i < 120 && sim.vehicle.mode !== 'attached'; i++) sim.step(controls({ suction: true }));
    expect(sim.vehicle.mode).toBe('attached');
    expect(sim.vehicle.supportSurface).toBe('ceiling');
    sim.dispose();
  });

  it('hangs a full-width bar from the ceiling run, with a validated route beneath it', () => {
    for (const seed of [1, 2, 3]) {
      const chunk = planChunk({ id: 1, seed, d0: 0, kind: 'ceiling', difficulty: 1, entry: { ...initialReachableState(), lastArrival: -400 } });
      expect(chunk.validation.accepted, chunk.validation.reasons.join('; ')).toBe(true);
      expect(chunk.obstacles).toHaveLength(1);
      const bar = chunk.obstacles[0];
      expect(bar.half.x).toBe(CONFIG.corridor.halfWidth);
      expect(bar.y + bar.half.y).toBeCloseTo(H, 6);
      const ceiling = chunk.slabs.find(s => s.surface === 'ceiling')!;
      expect(bar.d).toBeGreaterThan(ceiling.d0 + 20);
      expect(bar.d).toBeLessThan(ceiling.d1 - 20);
      expect(chunk.plan.some(p => p.action === 'hop')).toBe(true);
      // Overlapping the bar lengthwise, the route is below it; after it, back on the ceiling.
      const overlap = CONFIG.car.halfExtents.z + bar.half.z;
      for (const p of chunk.route.filter(p => Math.abs(p.d - bar.d) < overlap)) expect(p.y + CONFIG.car.halfExtents.y).toBeLessThan(barBottom);
      expect(chunk.route.some(p => p.d > bar.d && p.surface === 'ceiling')).toBe(true);
    }
  });

  it('appears on only some ceiling runs at low difficulty', () => {
    const bars = [1, 2, 3, 4, 5, 6, 7, 8].map(seed =>
      planChunk({ id: 1, seed, d0: 0, kind: 'ceiling', difficulty: 0, entry: initialReachableState() }).obstacles.length);
    expect(bars.some(n => n === 0)).toBe(true);
    expect(bars.some(n => n === 1)).toBe(true);
  });
});

describe('returning to the main menu', () => {
  const session = () => {
    const s = new GameSession(1, () => new Simulation({ createLevel: w => new StaticLevel(w, [{ surface: 'floor', d0: -30, d1: 500 }]) }));
    s.startRun();
    return s;
  };

  it('works from pause and game over, resetting the run for the next start', () => {
    const s = session();
    for (let i = 0; i < 60; i++) s.step(controls());
    s.returnToMenu();
    expect(s.state).toBe('running');
    s.togglePause();
    const before = s.sim, attempt = s.attempt;
    s.returnToMenu();
    expect(s.state).toBe('ready');
    expect(s.sim).not.toBe(before);
    expect(s.attempt).toBe(attempt + 1);
    expect(s.score).toBe(0);
    expect(s.best).toBeGreaterThan(0);
    s.startRun();
    expect(s.state).toBe('running');
    s.state = 'gameover';
    s.returnToMenu();
    expect(s.state).toBe('ready');
  });
});
