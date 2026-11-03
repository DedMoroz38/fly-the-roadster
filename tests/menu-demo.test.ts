import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { vehicleById } from '../src/render/vehicles';
import {
  AUDIENCE, AUDIENCE_CREDITS, cameraFollow, chooseJumps, DEMO, DT, fitToLength, layoutRow, measureCar, nominalPlan, NOMINAL_CARS,
  PATH_Z, planDemo, reachUp, restingCar, ROADSTER, roofGap, rollHold, ROW_FRONT, searchFlights, stepCar, tapeInput, UPRIGHT_FOR_LIFT,
  type DemoPlan, type RowCar,
} from '../src/render/menuDemo';
import { Vapour } from '../src/render/menuVapour';
import { CONFIG } from '../src/game/config';
import { initPhysics, Simulation } from '../src/game/simulation';
import { StaticLevel } from '../src/game/physics/level';
import { emptyControls } from '../src/game/input';
import { FailureMonitor } from '../src/game/session';

beforeAll(initPhysics);

const TAU = Math.PI * 2;
const { row, placements } = layoutRow(NOMINAL_CARS);
const ASPECTS = [16 / 9, 2.1, 1.3];
const plan = nominalPlan(16 / 9);
const at = plan.at;
const frames = (_: DemoPlan, from: number, to: number) => {
  const out: number[] = [];
  for (let t = from; t < to; t += DT / 2) out.push(t);
  return out;
};
/** Visible half-width of the picture at a lane, with the camera's follow at its limit. */
const pictureEdge = (p: DemoPlan, laneZ: number) => p.framing.halfWidthAt(laneZ) + DEMO.pan.follow * DEMO.pan.reach;

describe('Roadster demo', () => {
  it('belongs to the Roadster only', () => {
    expect(vehicleById('roadster').demo).toBe(true);
    for (const id of ['charger', 'cybertruck', 'delorean', 'dino', 'steve']) expect(vehicleById(id).demo).toBeFalsy();
  });

  it('has four cars, left to right: a Semi, a Cybercab, the Cybertruck and a Model 3', () => {
    expect(AUDIENCE.map(c => c.name)).toEqual(['Semi', 'Cybercab', 'Cybertruck', 'Model 3']);
    expect(AUDIENCE_CREDITS).toHaveLength(4);
  });
});

describe('the row of cars', () => {
  it('stands side by side with no gap, in order, centred on the road', () => {
    row.cars.forEach((car, i) => {
      expect(car.to - car.from).toBeCloseTo(NOMINAL_CARS[i].width, 9);
      if (i > 0) expect(car.from).toBeCloseTo(row.cars[i - 1].to, 9);
      expect(placements[i].x).toBeCloseTo((car.from + car.to) / 2, 9);
    });
    expect(row.left).toBeCloseTo(-row.right, 9);
  });

  it('lines the fronts up on one line, behind the turntable, facing the camera', () => {
    placements.forEach((p, i) => expect(p.z + NOMINAL_CARS[i].length / 2).toBeCloseTo(ROW_FRONT, 9));
    expect(ROW_FRONT).toBeLessThan(-2.6);
  });

  it('lies across the Roadster’s jumping lane, which runs over every roof', () => {
    placements.forEach((p, i) => {
      expect(p.z + NOMINAL_CARS[i].length / 2).toBeGreaterThan(PATH_Z + ROADSTER.halfWidth);
      expect(p.z - NOMINAL_CARS[i].length / 2).toBeLessThan(PATH_Z - ROADSTER.halfWidth);
    });
  });
});

describe('the demo’s physics is the game’s', () => {
  it('matches the real Rapier vehicle, step for step, for the same inputs: cruise, Space and the roll key', () => {
    const sim = new Simulation({ createLevel: w => new StaticLevel(w, [{ surface: 'floor', d0: -30, d1: 3000 }]) });
    sim.vehicle.cruiseSpeed = plan.jumpSpeed;
    for (let i = 0; i < 180; i++) sim.step(emptyControls());
    const y0 = sim.vehicle.position.y, d0 = sim.distance;
    const car = restingCar(sim.vehicle.forwardSpeed);
    const monitor = new FailureMonitor();
    let roll = 0, prev = sim.vehicle.roll, landed = -1, contactSink = 0, worst = { y: 0, roll: 0, s: 0, vy: 0, w: 0 };
    for (let f = 0; f < 240; f++) {
      const tape = tapeInput(plan.tape, f, plan.jumpSpeed);
      const input = landed >= 0 ? { ...tape, thrust: false } : tape;
      const step = stepCar(car, input);
      sim.step({ ...emptyControls(), thrust: input.thrust, rollLeft: input.rollLeft });
      expect(monitor.check(sim)).toBeNull();
      if (landed < 0 && f > plan.tape.liftA && step.touchdown !== null) landed = f;
      let d = sim.vehicle.roll - prev;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      roll += d; prev = sim.vehicle.roll;
      const dy = Math.abs(sim.vehicle.position.y - y0 - car.y);
      if (landed >= 0) contactSink = Math.max(contactSink, dy);
      worst = {
        y: landed >= 0 ? worst.y : Math.max(worst.y, dy), roll: Math.max(worst.roll, Math.abs(roll - car.roll)),
        s: Math.max(worst.s, Math.abs(sim.distance - d0 - car.s)),
        // Speeds are compared in the air; on landing Rapier's contact settles the car its own way.
        vy: landed >= 0 ? worst.vy : Math.max(worst.vy, Math.abs(sim.vehicle.body.linvel().y - car.vy)),
        w: landed >= 0 ? worst.w : Math.max(worst.w, Math.abs(sim.vehicle.body.angvel().z - car.w)),
      };
    }
    // In the air within a few millimetres and a tenth of a degree; on landing Rapier's contact lets the
    // car sink a few centimetres into the road before pushing it back up, which the demo does not draw.
    expect(worst.y).toBeLessThan(0.005);
    expect(contactSink).toBeLessThan(0.05);
    expect(worst.roll).toBeLessThan(0.002);
    expect(worst.s).toBeLessThan(0.001);
    expect(worst.vy).toBeLessThan(1e-3);
    expect(worst.w).toBeLessThan(1e-3);
    // The real car lands upright and keeps going, on the same frame as the demo's.
    expect(landed).toBeGreaterThan(plan.tape.liftB);
    expect(Math.abs(sim.vehicle.roll)).toBeLessThan(0.01);
    expect(sim.vehicle.mode).toBe('grounded');
  });

  it('drives with the game’s automatic cruise: it speeds up at most at the game’s acceleration and coasts down at its coasting rate', () => {
    for (const pass of [plan.passes.leave, plan.passes.jump, plan.passes.back]) {
      for (let i = 1; i < pass.frames.length; i++) {
        const a = (pass.frames[i].v - pass.frames[i - 1].v) / DT;
        expect(a).toBeLessThanOrEqual(CONFIG.car.acceleration + 1e-9);
        expect(a).toBeGreaterThanOrEqual(-CONFIG.car.coastDecel - 1e-9);
      }
    }
    // Leaving, it reaches its cruise; coming back, it coasts (the game has no brakes) to rest.
    expect(plan.passes.leave.frames.at(-1)!.v).toBeGreaterThan(DEMO.leaveSpeed - 0.2);
    expect(plan.passes.back.frames.at(-1)!.v).toBeLessThan(0.05);
  });

  it('falls under the game’s gravity and climbs with the game’s lift, frame by frame', () => {
    const c = restingCar(plan.jumpSpeed);
    for (let f = 0; f < 200; f++) {
      const before = { ...c };
      const step = stepCar(c, tapeInput(plan.tape, f, plan.jumpSpeed));
      if (step.touchdown !== null) break;
      if (before.y <= 0 && step.lift === 0) continue;
      const expected = -CONFIG.gravity + Math.cos(before.roll) * CONFIG.thrusters.liftAccel * step.lift;
      expect((c.vy - before.vy) / DT).toBeCloseTo(expected, 6);
    }
  });

  it('rolls with the game’s roll controller: one full turn from holding the key, brought upright by its brake and settle assist', () => {
    const { hold, settle } = rollHold();
    const c = restingCar();
    c.y = 1e4;
    let fastest = 0;
    for (let f = 0; f < settle; f++) {
      stepCar(c, { thrust: false, rollLeft: f < hold, rollRight: false, cruise: 0 });
      fastest = Math.max(fastest, c.w);
    }
    expect(Math.abs(c.roll - TAU)).toBeLessThan(0.01);
    expect(fastest).toBeLessThanOrEqual(CONFIG.car.rollSpeed + 1e-9);
    expect(hold * DT).toBeGreaterThan(1);
  });
});

describe('the jump', () => {
  const jumpFrames = () => {
    const pass = plan.passes.jump;
    return pass.frames.map(p => ({ ...p, x: pass.x0 - p.s }));
  };
  const air = () => {
    const all = jumpFrames();
    const start = Math.round((at.jump - at.approach) / DT), end = Math.round((at.land - at.approach) / DT);
    return all.slice(start, end);
  };

  it('goes over the cars, clear of every roof whether the car is upright or rolled over', () => {
    let over = 0;
    for (const p of air()) {
      const gap = roofGap(row, p.x, p.y, p.roll);
      if (Number.isFinite(gap)) { over++; expect(gap).toBeGreaterThan(ROADSTER.clearance - 1e-9); }
    }
    expect(over).toBeGreaterThan(60);
    expect(plan.peak).toBeGreaterThan(row.tallest);
  });

  it('takes off before the row and lands past it, in view', () => {
    expect(plan.takeoffX).toBeGreaterThan(row.right + ROADSTER.halfLength);
    expect(plan.landingX).toBeLessThan(row.left - ROADSTER.halfLength);
    for (const aspect of ASPECTS) {
      const p = nominalPlan(aspect);
      // With the camera leaning after it, the whole car is in the picture as it takes off and as it lands.
      for (const x of [p.landingX, p.takeoffX]) expect(Math.abs(x - cameraFollow(x)) + ROADSTER.halfLength).toBeLessThan(p.framing.halfWidthAt(PATH_Z));
    }
  });

  it('fires the lift only near upright, does exactly one roll, and lands upright and gently', () => {
    const frames = air();
    for (const p of frames) if (p.lift > 0) expect(Math.abs(Math.sin(p.roll))).toBeLessThanOrEqual(Math.sin(UPRIGHT_FOR_LIFT) + 1e-9);
    expect(Math.max(...frames.map(p => p.roll))).toBeLessThan(TAU + 0.05);
    expect(frames.at(-1)!.roll).toBeCloseTo(TAU, 1);
    expect(frames.some(p => p.lift > 0)).toBe(true);
    expect(frames.some(p => p.lift === 0)).toBe(true);
    expect(plan.landingSpeed).toBeLessThan(0);
    expect(plan.landingSpeed).toBeGreaterThanOrEqual(-5);
    // It drifts off its lane by no more than a few centimetres, from the little lift that pushes sideways.
    expect(Math.max(...frames.map(p => Math.abs(p.lat)))).toBeLessThan(0.3);
    expect(plan.airTime).toBeGreaterThan(2);
    expect(plan.airTime).toBeLessThan(3.6);
  });

  it('is found for other rows too, and still clears them', () => {
    const flights = searchFlights();
    const rows: RowCar[][] = [
      NOMINAL_CARS.map(c => ({ ...c, width: c.width * 1.05 })),
      [{ width: 2, height: 1.2, length: 4 }, { width: 2, height: 1.5, length: 4 }],
      NOMINAL_CARS.slice().reverse(),
    ];
    for (const cars of rows) {
      const { row: r } = layoutRow(cars);
      const p = planDemo(r, 16 / 9, chooseJumps(r, flights));
      const pass = p.passes.jump;
      const from = Math.round((p.at.jump - p.at.approach) / DT), to = Math.round((p.at.land - p.at.approach) / DT);
      for (const f of pass.frames.slice(from, to)) {
        const gap = roofGap(r, pass.x0 - f.s, f.y, f.roll);
        if (Number.isFinite(gap)) expect(gap).toBeGreaterThan(ROADSTER.clearance - 1e-9);
      }
    }
  });
});

describe('the show', () => {
  it('starts on the turntable, hovering as on the menu, and ends there the same way', () => {
    for (const t of [0, plan.duration, plan.duration + 1]) {
      const p = plan.pose(t);
      expect(p.x).toBe(0);
      expect(p.y).toBe(0);
      expect(p.hover).toBe(1);
      expect(p.facing).toBe(0);
      expect(p.camera).toBe(0);
      expect(p.onTurntable).toBe(true);
    }
  });

  it('turns quickly to face right on the turntable and settles onto the road before driving off', () => {
    expect(DEMO.turn).toBeLessThanOrEqual(0.6);
    const turned = plan.pose(at.leave);
    expect(turned.facing).toBe(1);
    expect(turned.hover).toBe(0);
    expect(plan.pose(at.leave - 0.01).x).toBe(0);
    expect(plan.pose(at.leave + 0.5).x).toBeGreaterThan(0.5);
    expect(plan.pose(at.leave + 0.5).heading).toBe(1);
  });

  for (const aspect of ASPECTS) {
    it(`never appears or vanishes inside the picture (aspect ${aspect.toFixed(2)})`, () => {
      const p = nominalPlan(aspect);
      // Each pass starts and ends beyond the edge of the picture on its own lane.
      expect(p.edges.road).toBeGreaterThan(pictureEdge(p, 0) + ROADSTER.halfLength);
      expect(p.edges.row).toBeGreaterThan(pictureEdge(p, PATH_Z) + ROADSTER.halfLength);
      const ts = frames(p, 0, p.duration);
      for (let i = 1; i < ts.length; i++) {
        const a = p.pose(ts[i - 1]), b = p.pose(ts[i]);
        const jumped = Math.abs(b.x - a.x) > 1 || Math.abs(b.z - a.z) > 0.5 || a.heading !== b.heading;
        if (a.visible !== b.visible || jumped) {
          // Any change of visibility, lane or direction happens wholly out of the picture.
          for (const q of [a, b]) expect(Math.abs(q.x) - ROADSTER.halfLength).toBeGreaterThan(pictureEdge(p, q.z));
        }
      }
    });
  }

  it('drives right off the turntable, comes back from the right over the row, leaves left and comes back from the left', () => {
    const leave = plan.pose((at.leave + at.gap1) / 2), jump = plan.pose((at.jump + at.land) / 2), back = plan.pose((at.back + at.settle) / 2);
    expect([leave.heading, leave.z]).toEqual([1, 0]);
    expect(jump.heading).toBe(-1);
    expect(Math.abs(jump.z - PATH_Z)).toBeLessThan(0.3);
    expect([back.heading, back.z]).toEqual([1, 0]);
    expect(plan.pose(at.approach + DT).x).toBeGreaterThan(plan.edges.row - 1);
    expect(plan.pose(at.back + DT).x).toBeLessThan(-plan.edges.road + 1);
  });

  it('coasts to rest exactly on the turntable', () => {
    const end = plan.pose(at.settle - 1e-6);
    expect(Math.abs(end.x)).toBeLessThan(0.01);
    expect(end.speed).toBeLessThan(0.05);
  });

  it('moves smoothly while in view', () => {
    const ts = frames(plan, 0, plan.duration);
    for (let i = 1; i < ts.length; i++) {
      const a = plan.pose(ts[i - 1]), b = plan.pose(ts[i]);
      if (!a.visible || !b.visible || a.heading !== b.heading) continue;
      expect(Math.abs(b.x - a.x)).toBeLessThan(0.2);
      expect(Math.abs(b.y - a.y)).toBeLessThan(0.2);
      expect(Math.abs(b.cameraX - a.cameraX)).toBeLessThan(0.1);
    }
  });

  it('has the camera reach the show’s framing while the car leaves, and come back at the end', () => {
    expect(plan.pose(DEMO.cameraIn).camera).toBe(1);
    expect(plan.pose(at.jump).camera).toBe(1);
    expect(plan.pose(at.settle).camera).toBe(1);
    expect(plan.duration).toBeGreaterThan(9);
    expect(plan.duration).toBeLessThan(16);
  });

  it('frames the whole jump: the ground near the bottom of the picture and the top of the jump inside it', () => {
    for (const aspect of ASPECTS) {
      const p = nominalPlan(aspect), f = p.framing, t = Math.tan(f.fov / 2 * Math.PI / 180);
      const top = f.eye + (f.shift + t) * f.distance, bottom = f.eye + (f.shift - t) * f.distance;
      expect(top).toBeGreaterThan(-0.6 + ROADSTER.rest + p.peak + reachUp(Math.PI / 2));
      expect(bottom).toBeLessThan(-0.6);
      expect((-0.6 - bottom) / (top - bottom)).toBeLessThan(0.2);
    }
  });
});

describe('fitting models', () => {
  it('fits models to a length, resting on the ground and centred', () => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 5), new THREE.MeshBasicMaterial());
    box.position.set(3, 10, -4);
    const bounds = new THREE.Box3().setFromObject(fitToLength(box, 4));
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(4, 5);
    expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 5);
  });

  it('measures what a fitted car takes up across the road and in height', () => {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 5), new THREE.MeshBasicMaterial());
    const size = measureCar(fitToLength(box, 4), 4);
    expect(size.width).toBeCloseTo(1.6, 5);
    expect(size.height).toBeCloseTo(1.2, 5);
  });
});

describe('vapour', () => {
  const puff = { size0: 0.2, size1: 1, life: 1, alpha: 0.8 };
  it('puffs grow, fade and are gone after their life', () => {
    const v = new Vapour(50);
    v.emit(new THREE.Vector3(), new THREE.Vector3(0, 1, 0), puff);
    v.update(0.5);
    expect(v.count).toBe(1);
    v.update(1);
    expect(v.count).toBe(0);
    v.dispose();
  });

  it('reuses its oldest slots when full instead of growing without limit', () => {
    const v = new Vapour(20);
    for (let i = 0; i < 100; i++) v.emit(new THREE.Vector3(), new THREE.Vector3(), puff);
    expect(v.count).toBe(20);
    v.dispose();
  });

  it('turns a rate into a whole number of puffs per step, on average', () => {
    const v = new Vapour(10);
    let total = 0;
    for (let i = 0; i < 6000; i++) total += v.puffs(60, 1 / 60);
    expect(total).toBeGreaterThan(5700);
    expect(total).toBeLessThan(6300);
    v.dispose();
  });
});

