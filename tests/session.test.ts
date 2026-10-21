import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics, Simulation } from '../src/game/simulation';
import { StaticLevel } from '../src/game/physics/level';
import { Course } from '../src/game/course/course';
import { FailureMonitor, GameSession } from '../src/game/session';
import { controls, setRoll } from './helpers';
import { CONFIG } from '../src/game/config';
import type { Slab } from '../src/game/surfaces';

beforeAll(async () => {
  await initPhysics();
});

const staticSession = (slabs: Omit<Slab, 'id'>[], spawn?: { x: number; y: number; z: number }) => {
  const session = new GameSession(1, () => new Simulation({ spawn, createLevel: (w) => new StaticLevel(w, slabs) }));
  session.startRun();
  return session;
};

function steps(s: GameSession, seconds: number, c = {}) {
  for (let i = 0; i < Math.round(seconds * 60); i++) s.step(controls(c));
}

describe('GameSession flow', () => {
  it('waits at the main menu until explicitly started, then cruises automatically', () => {
    const s = new GameSession(1, () => new Simulation({ createLevel: w =>
      new StaticLevel(w, [{ surface: 'floor', d0: -20, d1: 500 }]) }));
    expect(s.state).toBe('ready');
    const pose = s.sim.pose();
    const world = s.sim.world;
    steps(s, 3, { accelerate: true, thrust: true, rollRight: true, suction: true });
    s.togglePause();
    s.toggleHelp();
    s.restart();
    expect(s.state).toBe('ready');
    expect(s.sim.world).toBe(world);
    expect(s.sim.time).toBe(0);
    expect(s.score).toBe(0);
    expect(s.sim.fuel.fraction).toBe(1);
    expect(s.sim.pose()).toEqual(pose);
    s.startRun();
    expect(s.state).toBe('running');
    expect(s.helpOpen).toBe(false);
    steps(s, 2);
    expect(s.sim.time).toBeGreaterThan(1.9);
    expect(s.score).toBeGreaterThan(30);
    expect(s.sim.vehicle.forwardSpeed).toBeGreaterThan(20);
    const time = s.sim.time;
    s.startRun();
    expect(s.sim.time).toBe(time); // repeated clicks cannot reset an active run
    s.sim.dispose();
  });

  it('tracks furthest forward distance even when an external collision moves the body back', () => {
    const s = staticSession([{ surface: 'floor', d0: -50, d1: 500 }]);
    steps(s, 2, { accelerate: true });
    const score = s.score;
    const p = s.sim.vehicle.position;
    s.sim.vehicle.body.setTranslation({ ...p, z: p.z + 10 }, true);
    s.sim.vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // Reset the monitor by using a small external displacement without a speed drop.
    s.sim.vehicle.forwardSpeed = 0;
    steps(s, 1 / 60);
    expect(s.score).toBe(score);
  });

  it('pause freezes the simulation; resume continues', () => {
    const s = staticSession([{ surface: 'floor', d0: -20, d1: 500 }]);
    steps(s, 0.5, { accelerate: true });
    s.togglePause();
    expect(s.state).toBe('paused');
    const t = s.sim.time;
    steps(s, 1, { accelerate: true });
    expect(s.sim.time).toBe(t);
    s.togglePause();
    steps(s, 0.5, { accelerate: true });
    expect(s.sim.time).toBeGreaterThan(t);
  });

  it('help overlay pauses a running game and resumes on close', () => {
    const s = staticSession([{ surface: 'floor', d0: -20, d1: 500 }]);
    steps(s, 0.2, { accelerate: true });
    s.toggleHelp();
    expect(s.state).toBe('paused');
    s.toggleHelp();
    expect(s.state).toBe('running');
  });

  it('falling out of the corridor ends the attempt', () => {
    const s = staticSession([{ surface: 'floor', d0: -20, d1: 40 }]);
    steps(s, 6, { accelerate: true });
    expect(s.state).toBe('gameover');
    expect(s.failReason).toBe('fell');
    expect(s.snapshot().best).toBeGreaterThan(40);
    const t = s.sim.time;
    steps(s, 1, { accelerate: true });
    expect(s.sim.time).toBe(t); // nothing runs after game over
  });

  it('a head-on hit into the front edge of a slab is a crash', () => {
    // Car is inside the left wall's footprint (outside the corridor) flying into its front face.
    const s = staticSession([{ surface: 'left', d0: 40, d1: 200 }], { x: -6.6, y: 9, z: -10 });
    s.step(controls({ accelerate: true }));
    s.sim.vehicle.body.setLinvel({ x: 0, y: 0, z: -50 }, true);
    steps(s, 2);
    expect(s.state).toBe('gameover');
    expect(s.failReason).toBe('crashed');
  });

  it('driving, landing, cruising and attaching to surfaces are not crashes', () => {
    const s = staticSession(
      [
        { surface: 'floor', d0: -20, d1: 2000 },
        { surface: 'ceiling', d0: -20, d1: 2000 },
      ],
    );
    steps(s, 2, { accelerate: true });
    steps(s, 0.5); // ease toward cruise
    steps(s, 1.5, { accelerate: true });
    steps(s, 0.6, { accelerate: true, thrust: true });
    steps(s, 1.5, { accelerate: true }); // fall back down and land
    expect(s.state).toBe('running');
  });

  it('restart resets vehicle, physics, course, fuel and score, keeping the seed', async () => {
    const s = new GameSession(77, (seed) => new Simulation({ createLevel: (w) => new Course(w, seed) }));
    s.startRun();
    const firstSlabs = [...s.sim.level.slabs.active.values()].map((x) => [x.surface, x.d0, x.d1]);
    steps(s, 2, { accelerate: true });
    steps(s, 0.3, { accelerate: true, thrust: true });
    expect(s.sim.fuel.fraction).toBeLessThan(1);
    s.sim.vehicle.suctionHeat = 100;
    s.sim.vehicle.suctionOverheated = true;
    expect(s.snapshot().suctionHeat).toBe(100);
    expect(s.snapshot().suctionOverheated).toBe(true);
    expect(s.score).toBeGreaterThan(20);
    const oldWorld = s.sim.world;
    s.restart();
    expect(s.sim.world).not.toBe(oldWorld);
    expect(s.state).toBe('running');
    expect(s.score).toBe(0);
    expect(s.sim.fuel.fraction).toBe(1);
    expect(s.sim.distance).toBeCloseTo(10, 1);
    expect(s.sim.vehicle.position.y).toBeLessThan(0.5);
    expect(s.sim.vehicle.suctionOn).toBe(false);
    expect(s.snapshot().suctionHeat).toBe(0);
    expect(s.snapshot().suctionOverheated).toBe(false);
    expect(s.attempt).toBe(1);
    expect(s.failReason).toBeNull();
    expect([...s.sim.level.slabs.active.values()].map((x) => [x.surface, x.d0, x.d1])).toEqual(firstSlabs);
    expect(s.best).toBeGreaterThan(20);
  });

  it('restart works from game over', () => {
    const s = staticSession([{ surface: 'floor', d0: -20, d1: 40 }]);
    steps(s, 6, { accelerate: true });
    expect(s.state).toBe('gameover');
    s.restart();
    expect(s.state).toBe('running');
    steps(s, 0.5, { accelerate: true });
    expect(s.sim.vehicle.mode).toBe('grounded');
  });
});

describe('roof landings', () => {
  it.each([Math.PI, -Math.PI, Math.PI * 5 / 6, -Math.PI * 5 / 6])(
    'ends the run on actual roof contact at roll %s, including tilted landings', roll => {
      const s = staticSession([{ surface: 'floor', d0: -20, d1: 500 }], { x: 0, y: 3, z: -10 });
      try {
        setRoll(s.sim, roll);
        steps(s, 0.2);
        expect(s.state).toBe('running'); // inverted in mid-air is not a crash
        expect(s.sim.vehicle.position.y).toBeGreaterThan(2);
        steps(s, 1);
        expect(s.state).toBe('gameover');
        expect(s.failReason).toBe('flipped');
        expect(s.sim.vehicle.position.y).toBeLessThan(1);
        const time = s.sim.time;
        const pose = s.sim.vehicle.position;
        steps(s, 1, { rollRight: true, thrust: true });
        expect(s.sim.time).toBe(time);
        expect(s.sim.vehicle.position).toEqual(pose);
        s.restart();
        expect(s.failReason).toBeNull();
        steps(s, 1);
        expect(s.state).toBe('running');
        expect(s.sim.vehicle.mode).toBe('grounded');
      } finally { s.sim.dispose(); }
    },
  );

  it('allows a full airborne barrel roll without any contact', () => {
    const s = staticSession([], { x: 0, y: 8, z: -10 });
    try {
      s.sim.vehicle.body.setLinvel({ x: 0, y: 15, z: -24 }, true);
      let inverted = false;
      for (let i = 0; i < 90; i++) {
        s.step(controls({ rollRight: true }));
        inverted ||= Math.cos(s.sim.vehicle.roll) < -0.9;
        expect(s.state).toBe('running');
      }
      expect(inverted).toBe(true);
      expect(Math.cos(s.sim.vehicle.roll)).toBeGreaterThan(0.5);
    } finally { s.sim.dispose(); }
  });

  it('allows upside-down ceiling attachment and travel', () => {
    const s = staticSession([
      { surface: 'floor', d0: -20, d1: 500 },
      { surface: 'ceiling', d0: -20, d1: 500 },
    ], { x: 0, y: 8.5, z: -10 });
    try {
      setRoll(s.sim, Math.PI);
      s.step(controls({ suction: true }));
      steps(s, 4, { suction: true });
      expect(s.state).toBe('running');
      expect(s.sim.vehicle.mode).toBe('attached');
      expect(s.sim.vehicle.supportSurface).toBe('ceiling');
      expect(s.score).toBeGreaterThan(80);
    } finally { s.sim.dispose(); }
  });

  it.each([-Math.PI / 2, Math.PI / 2])('does not call a side landing a roof crash (%s)', roll => {
    const s = staticSession([{ surface: 'floor', d0: -20, d1: 500 }], { x: 0, y: 1.2, z: -10 });
    try {
      setRoll(s.sim, roll);
      steps(s, 1);
      expect(s.state).toBe('running');
      expect(s.sim.vehicle.position.y).toBeLessThan(1);
    } finally { s.sim.dispose(); }
  });
});

describe('FailureMonitor', () => {
  const fake = (o: { x?: number; y?: number; d: number; fwd: number; mode?: string }) =>
    ({
      dt: 1 / 60,
      distance: o.d,
      vehicle: { position: { x: o.x ?? 0, y: o.y ?? 5, z: -o.d }, roll: 0, forwardSpeed: o.fwd, mode: o.mode ?? 'airborne' },
    }) as unknown as Simulation;

  it('flags being stranded airborne with no progress', () => {
    const m = new FailureMonitor();
    let r = null;
    for (let i = 0; i < 60 * (CONFIG.fail.stuckSeconds + 1) && !r; i++) r = m.check(fake({ d: 100, fwd: 0 }));
    expect(r).toBe('stranded');
  });

  it('does not flag a car parked on a surface', () => {
    const m = new FailureMonitor();
    let r = null;
    for (let i = 0; i < 60 * 20; i++) r = r ?? m.check(fake({ d: 100, fwd: 0, mode: 'grounded' }));
    expect(r).toBeNull();
  });

  it('flags leaving the corridor in any direction', () => {
    for (const p of [{ y: -16 }, { y: 26 }, { x: 22 }, { x: -22 }]) {
      expect(new FailureMonitor().check(fake({ d: 10, fwd: 10, ...p }))).toBe('fell');
    }
    expect(new FailureMonitor().check(fake({ d: 10, fwd: 10, y: -5 }))).toBeNull();
  });
});
