import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import cybercabUrl from '../../models/space/tesla_cybercab_3d_model.glb?url';
import m3Url from '../../models/space/tesla_m3_model.glb?url';
import semiUrl from '../../models/space/tesla_semi.glb?url';
import cybertruckUrl from '../../models/tesla_cybertruck.glb?url';
import { CONFIG } from '../game/config';
import { clamp, wrapAngle } from '../core/math';
import type { VehicleCredit } from './vehicles';

/**
 * The Roadster's stunt demo on the menu, modelled on Tesla's October 2026 night demo: the car drives
 * at a row of parked Teslas, lifts off on its thrusters, flies over them with one full barrel roll
 * (Tesla called it the kickflip) and lands upright on the far side.
 *
 * The stage is a straight road across the view: x runs along it (positive to the screen's right),
 * z toward the camera. The four cars stand side by side, touching, with their fronts on one line
 * behind the turntable, and the lane the Roadster jumps along (z = PATH_Z) runs over their roofs.
 *
 * The motion is the game's own physics, not an animation: every step runs the game's vehicle
 * controller (`stepCar`, a port of `Vehicle.applyControls` for a car on or above a flat road) at the
 * game's 60 Hz with the game's constants, driven by the same inputs a player has: cruise speed, Space
 * (lift) and the roll keys. The tests replay those inputs through the real Rapier vehicle and compare.
 */

/** The menu draws every vehicle 15% larger than its physics box; at that size the Roadster is 3.9 m long, about a real one. */
export const MENU_SCALE = 1.15;
/** Height of the road the Roadster drives on and the floor the parked cars stand on. */
export const GROUND_Y = -0.6;
const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const HE = CONFIG.car.halfExtents;

/** The Roadster as drawn: half its length, the height of its centre above the road at rest, and its body's half width and height. */
export const ROADSTER = { halfLength: HE.z * MENU_SCALE, rest: HE.y * MENU_SCALE, halfWidth: HE.x * MENU_SCALE, halfHeight: 0.52, clearance: 0.15 } as const;
/** How far the body reaches above and below its centre when rolled by `roll`. */
export const reachUp = (roll: number) => ROADSTER.halfWidth * Math.abs(Math.sin(roll)) + ROADSTER.halfHeight * Math.abs(Math.cos(roll));

export const DEMO = {
  /** The narrowest stretch of road (half of it, in metres) the show's framing keeps in view. */
  halfWidth: 10.5,
  /** How far the camera follows the car along the road (a fraction of its distance), and where that saturates. */
  pan: { follow: 0.5, reach: 6 },
  /** The camera moves from the menu's framing to the show's over this long. */
  cameraIn: 1.2,
  /** The turntable turns the car to face right, and it settles from its showroom hover onto the road. */
  turn: 0.6,
  /** The cruise speed it drives off at, m/s. */
  leaveSpeed: 13,
  /** Seconds out of sight between passes. */
  gap: 0.3,
  /** It comes back into view at this fraction of its jump speed and speeds up from there. */
  approachEntry: 0.4,
  /** Candidate cruise speeds for the run over the cars, m/s, and how far before the row it may take off. */
  jump: { speeds: [5, 5.5, 6, 6.5, 7, 7.5, 8, 9], runway: { min: 1.5, max: 8, step: 0.25 } },
  /** The turntable turns it back to its spin while the camera returns. */
  settle: 1.0,
  /** How far beyond the edge of the picture a pass starts or ends, so the car is never seen to appear. */
  offscreen: 0.8,
} as const;

/** Where the fronts of the cars stand (z), behind the turntable, and the lane the Roadster jumps along over their roofs. */
export const ROW_FRONT = -3.2;
export const PATH_Z = ROW_FRONT - 2;

/* ------------------------------------------------------------------------------------------------ */
/* The game's vehicle physics for one car on a flat road                                              */
/* ------------------------------------------------------------------------------------------------ */

/** One fixed step, as the game runs its physics. */
export const DT = 1 / CONFIG.physicsHz;
/**
 * Rapier 0.19 integrates each step in this many substeps, so under a constant acceleration `a` a
 * position moves by v·dt + a·dt²·(n + 1)/(2n): between a plain Euler step and the exact parabola.
 */
export const RAPIER_SUBSTEPS = 4;
const SUBSTEP_SHARE = (RAPIER_SUBSTEPS + 1) / (2 * RAPIER_SUBSTEPS);
/** How far a position moves in one step from velocity `v` under acceleration `a`, as Rapier moves it. */
const travel = (v: number, a: number) => (v + SUBSTEP_SHARE * a * DT) * DT;

/**
 * The Roadster's state in the game's terms: distance along its heading, sideways offset from its lane
 * (the game's x), height of its centre above where it rests on the road, their speeds, the roll about
 * its long axis (accumulated, not wrapped) and its rate, and the fuel in its tank.
 */
export interface CarState { s: number; lat: number; y: number; v: number; vlat: number; vy: number; roll: number; w: number; fuel: number }
export interface CarInput { thrust: boolean; rollLeft: boolean; rollRight: boolean; /** The speed automatic cruise holds, m/s. */ cruise: number }
export interface CarStep { lift: number; rollAccel: number; grounded: boolean; /** Vertical speed at the moment it met the road, if it did this step. */ touchdown: number | null }

export const restingCar = (speed = 0): CarState => ({ s: 0, lat: 0, y: 0, v: speed, vlat: 0, vy: 0, roll: 0, w: 0, fuel: CONFIG.fuel.capacity });

/**
 * One step of the game's own vehicle controller (`Vehicle.applyControls`) for a car on, or in the air
 * above, a flat road: automatic cruise, lift thrust along the car's up, gravity, tyre grip sideways
 * while the wheels are on the road, and the roll controller with its brake and its settle assist,
 * all with the game's constants and fuel use. Velocities update before positions, as Rapier
 * integrates. The road is the only thing it can touch.
 */
export function stepCar(c: CarState, input: CarInput): CarStep {
  const car = CONFIG.car, thrusters = CONFIG.thrusters;
  const wrapped = wrapAngle(c.roll);
  // The floor probe: the wheels face the road and are within reach of it.
  const touching = Math.cos(wrapped) >= Math.cos(CONFIG.suction.maxAlignAngleDeg * RAD) && c.y <= car.groundProbe;
  const contact = c.y <= 1e-9;
  const requested = (input.rollLeft ? 1 : 0) - (input.rollRight ? 1 : 0);
  const rate = (input.thrust ? thrusters.liftFuelRate : 0) + (requested ? thrusters.rollFuelRate : 0);
  let power = 0;
  if (rate > 0 && c.fuel > 0) {
    const need = DT * rate;
    if (need <= c.fuel) { c.fuel -= need; power = 1; } else { power = c.fuel / need; c.fuel = 0; }
  }
  const lift = input.thrust ? power : 0;
  const upX = -Math.sin(wrapped), upY = Math.cos(wrapped);
  const forward = clamp((input.cruise - c.v) * car.driveGain, -car.coastDecel, car.acceleration);
  let sideways = upX * thrusters.liftAccel * lift;
  if (touching) sideways += clamp(-c.vlat * car.gripGain, -car.landingGrip, car.landingGrip);
  const vertical = -CONFIG.gravity + upY * thrusters.liftAccel * lift;
  const limit = contact ? car.contactRollAccel : car.rollAccel;
  const roll = power > 0 ? requested : 0;
  let rollAccel: number;
  if (roll) rollAccel = clamp((roll * car.rollSpeed - c.w) * car.rollInputGain, -limit, limit) * power;
  else {
    // Released: settle on the road's normal, or toward the nearest quarter turn once slow and close to it.
    let target: number | null = null;
    if (touching) target = 0;
    else if (Math.abs(c.w) < 1.5) {
      const quarter = Math.round(wrapped / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(wrapAngle(quarter - wrapped)) < car.rollAssistAngleDeg * RAD) target = quarter;
    }
    const targetW = target === null ? 0 : clamp(wrapAngle(target - wrapped) * car.rollAssistGain, -car.rollSpeed, car.rollSpeed);
    rollAccel = clamp((targetW - c.w) * car.rollDamping, -car.rollBrake, car.rollBrake);
  }
  c.s += travel(c.v, forward); c.v += forward * DT;
  c.lat += travel(c.vlat, sideways); c.vlat += sideways * DT;
  c.roll += travel(c.w, rollAccel); c.w += rollAccel * DT;
  let touchdown: number | null = null;
  // The road pushes back only against a car pressed onto it.
  if (contact && vertical <= 0) c.vy = 0;
  else {
    c.y += travel(c.vy, vertical); c.vy += vertical * DT;
    if (c.y < 0) { touchdown = c.vy; c.y = 0; c.vy = 0; }
  }
  return { lift, rollAccel, grounded: touching, touchdown };
}

/** The jump as the player's inputs, in frames from take-off: Space until `liftA`, the roll key from `rollStart` for `rollHold`, Space again from `liftB` to touch-down. */
export interface Tape { liftA: number; rollStart: number; rollHold: number; liftB: number }

export function tapeInput(tape: Tape, frame: number, cruise: number): CarInput {
  return { thrust: frame < tape.liftA || frame >= tape.liftB, rollLeft: frame >= tape.rollStart && frame < tape.rollStart + tape.rollHold, rollRight: false, cruise };
}

/**
 * How long to hold the roll key for one full barrel roll: after release the game's brake and settle
 * assist bring it to rest exactly upright. Returns the hold and the frames until it is settled.
 */
export function rollHold(): { hold: number; settle: number } {
  let best: { hold: number; settle: number } | null = null;
  for (let hold = 30; hold <= 110; hold++) {
    const c = restingCar();
    c.y = 1e4; // high in the air: the roll alone
    let settle = -1;
    for (let f = 0; f < 600; f++) {
      stepCar(c, { thrust: false, rollLeft: f < hold, rollRight: false, cruise: 0 });
      if (f >= hold && Math.abs(c.roll - TAU) < 0.5 * RAD && Math.abs(c.w) < 0.02) { settle = f + 1; break; }
    }
    if (settle > 0 && (!best || settle < best.settle)) best = { hold, settle };
  }
  if (!best) throw new Error('No roll hold completes one turn');
  return best;
}

export interface FlightFrame { t: number; y: number; lat: number; roll: number; lift: number; rollAccel: number }
export interface Flight { tape: Tape; frames: FlightFrame[]; peak: number; landingSpeed: number }

/** The lift may fire only while the car is within this angle of upright: then nearly all of it lifts, and the little that pushes sideways is part of the physics too. */
export const UPRIGHT_FOR_LIFT = 6 * RAD;

/**
 * Every jump the inputs can make that lands softly: Space for `liftA` frames, the roll key pressed
 * around the end of that burst for one full turn, and Space again from `liftB` until it touches down.
 * The bursts may overlap the start and the end of the roll only while the car is nearly upright.
 * Only the vertical motion and the roll are searched here; at a steady cruise the speed along the
 * road does not change in the air.
 */
export function searchFlights(): Flight[] {
  const roll = rollHold();
  const flights: Flight[] = [];
  const record = (c: CarState, f: number, step: CarStep): FlightFrame => ({ t: (f + 1) * DT, y: c.y, lat: c.lat, roll: c.roll, lift: step.lift, rollAccel: step.rollAccel });
  const upright = (r: number) => Math.abs(Math.sin(r)) <= Math.sin(UPRIGHT_FOR_LIFT) && Math.cos(r) > 0;
  for (let liftA = 24; liftA <= 60; liftA++) {
    for (const lead of [-4, -2, 0, 2]) {
      const tape: Tape = { liftA, rollStart: liftA + lead, rollHold: roll.hold, liftB: Infinity };
      // The coast without a landing burst, kept frame by frame so each burst can start from it.
      const states: CarState[] = [], frames: FlightFrame[] = [];
      const c = restingCar();
      let tilted = false;
      for (let f = 0; f < 320; f++) {
        states.push({ ...c });
        const step = stepCar(c, tapeInput(tape, f, 0));
        frames.push(record(c, f, step));
        if (step.lift > 0 && !upright(c.roll)) tilted = true;
        if (step.touchdown !== null) break;
      }
      if (tilted) continue;
      // The landing burst may start once the roll is past its last quarter and back within reach of upright.
      const ready = frames.findIndex((p, f) => f >= tape.rollStart + roll.hold && p.roll > Math.PI * 1.5 && upright(p.roll));
      if (ready < 0) continue;
      for (let liftB = ready + 1; liftB < states.length; liftB++) {
        const b = { ...states[liftB] }, tail: FlightFrame[] = [];
        let landing: number | null = null, ok = true;
        for (let f = liftB; f < liftB + 200; f++) {
          const step = stepCar(b, tapeInput({ ...tape, liftB }, f, 0));
          tail.push(record(b, f, step));
          if (!upright(b.roll)) { ok = false; break; }
          if (step.touchdown !== null) { landing = step.touchdown; break; }
          // A burst started too high stops the fall and climbs again: it would never land.
          if (b.vy > 0) break;
        }
        if (!ok || landing === null || landing < -5) continue;
        const all = [...frames.slice(0, liftB), ...tail];
        flights.push({ tape: { ...tape, liftB }, frames: all, peak: Math.max(...all.map(p => p.y)), landingSpeed: landing });
      }
    }
  }
  return flights;
}

/* ------------------------------------------------------------------------------------------------ */
/* The row and the jump over it                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/** One parked car, after being fitted to its length: its footprint and height in stage metres. */
export interface RowCar { width: number; height: number; length: number }

/** The row as the choreography needs it: where it spans along the road and how tall each car is. */
export interface Row {
  left: number;
  right: number;
  tallest: number;
  cars: { from: number; to: number; height: number }[];
}

/**
 * Stands the cars side by side, left to right, touching, centred on the middle of the road and with
 * their fronts on one line. Returns each car's centre (x, z) and the row's extent.
 */
export function layoutRow(cars: readonly RowCar[], front: number = ROW_FRONT): { row: Row; placements: { x: number; z: number }[] } {
  const total = cars.reduce((sum, car) => sum + car.width, 0);
  let cursor = -total / 2;
  const placements: { x: number; z: number }[] = [];
  const spans: Row['cars'] = [];
  for (const car of cars) {
    placements.push({ x: cursor + car.width / 2, z: front - car.length / 2 });
    spans.push({ from: cursor, to: cursor + car.width, height: car.height });
    cursor += car.width;
  }
  return { row: { left: -total / 2, right: total / 2, tallest: Math.max(...cars.map(c => c.height)), cars: spans }, placements };
}

/**
 * Sizes of the four parked cars after fitting, as measured from the models: Semi (left), Cybercab,
 * Cybertruck and Model 3 (right). The scene measures the real models; these stand in for tests.
 */
export const NOMINAL_CARS: readonly RowCar[] = [
  { width: 2.82, height: 3.98, length: 6.2 },
  { width: 1.81, height: 1.35, length: 3.9 },
  { width: 1.82, height: 1.73, length: 5.2 },
  { width: 1.88, height: 1.3, length: 4.2 },
];

/** How high the Roadster's lowest point is above the roof of whatever it is over (negative: it would hit). Infinity when over nothing. */
export function roofGap(row: Row, x: number, y: number, roll: number, slack = 0): number {
  let gap = Infinity;
  for (const car of row.cars) {
    if (x + ROADSTER.halfLength + slack < car.from || x - ROADSTER.halfLength - slack > car.to) continue;
    gap = Math.min(gap, ROADSTER.rest + y - reachUp(roll) - car.height);
  }
  return gap;
}

const PAN_LIMIT = DEMO.pan.follow * DEMO.pan.reach;
/** The camera's sideways follow of a car at `x`: it leans after it, up to a limit. */
export const cameraFollow = (x: number) => PAN_LIMIT * Math.tanh(x / DEMO.pan.reach);

export interface JumpChoice { flight: Flight; speed: number; takeoffX: number; landingX: number; cost: number }

/**
 * The jumps that clear the row: a soft-landing flight, a cruise speed and a take-off point such that
 * the car's lowest point stays above every roof it passes over (with room to spare along the road
 * too), it lands past the last car and still in view. Best first: a lower, shorter, softer jump.
 */
export function chooseJumps(row: Row, flights: Flight[] = searchFlights()): JumpChoice[] {
  const slack = 0.35;
  const choices: JumpChoice[] = [];
  for (const flight of flights) {
    const air = flight.frames.at(-1)!.t;
    for (const speed of DEMO.jump.speeds) {
      const { min, max, step } = DEMO.jump.runway;
      for (let runway = min; runway <= max + 1e-9; runway += step) {
        const takeoffX = row.right + ROADSTER.halfLength + runway, landingX = takeoffX - speed * air;
        // Past the last car, and with the camera leaning after it, still wholly in the narrowest picture; likewise at take-off.
        if (landingX > row.left - ROADSTER.halfLength - slack) continue;
        if (Math.abs(landingX - cameraFollow(landingX)) + ROADSTER.halfLength > DEMO.halfWidth - 0.3) continue;
        if (Math.abs(takeoffX - cameraFollow(takeoffX)) + ROADSTER.halfLength > DEMO.halfWidth - 0.3) continue;
        if (flight.frames.some(p => roofGap(row, takeoffX - speed * p.t, p.y, p.roll, slack) < ROADSTER.clearance)) continue;
        const cost = 0.5 * air + 0.4 * flight.peak + 0.35 * Math.max(0, -flight.landingSpeed - 2.5) + 0.05 * runway;
        choices.push({ flight, speed, takeoffX, landingX, cost });
        // The shortest run-up that clears is the best for this flight and speed.
        break;
      }
    }
  }
  return choices.sort((a, b) => a.cost - b.cost);
}

/* ------------------------------------------------------------------------------------------------ */
/* Framing and the whole show                                                                         */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The show's camera for a picture of the given aspect: at a person's eye level, square to the row,
 * with the picture shifted up (as a shift lens does) rather than tilted so verticals stay vertical.
 * Far enough back for the road and for the top of the jump, with the ground near the bottom.
 */
export interface ShowFraming { fov: number; distance: number; eye: number; shift: number; aspect: number; halfWidthAt(laneZ: number): number }
export function showFraming(peak: number, aspect: number): ShowFraming {
  // A long lens from further back, as the photographs of the demo were taken: the car high above the
  // row is seen nearly side-on rather than from below, and the stage keeps its proportions.
  const fov = 30, t = Math.tan(fov / 2 * RAD), eye = 1.7, floorShare = 0.12;
  const top = GROUND_Y + ROADSTER.rest + peak + reachUp(Math.PI / 2) + 0.5;
  const span = (top - GROUND_Y) / (1 - floorShare);
  const distance = Math.max(DEMO.halfWidth / (t * aspect), span / (2 * t), 18);
  const frame = 2 * t * distance, bottom = GROUND_Y - floorShare * frame;
  const shift = (bottom + frame / 2 - eye) / distance;
  return { fov, distance, eye, shift, aspect, halfWidthAt: laneZ => t * aspect * (distance + PATH_Z - laneZ) };
}


export interface DemoPose {
  /** Along the road, across it (z) and height above the car's resting height on the road (metres). */
  x: number;
  y: number;
  z: number;
  /** Barrel roll about the car's own long axis, radians. */
  roll: number;
  /** Which way the car faces along the road: +1 to the screen's right. */
  heading: 1 | -1;
  /** 0 = still turning with the turntable, 1 = facing along the road. */
  facing: number;
  /** 1 = floating in its showroom hover above the turntable, 0 = its wheels on the road. */
  hover: number;
  /** The turntable carries the car (and turns with it). */
  onTurntable: boolean;
  /** 0 = the menu's framing, 1 = the show's. */
  camera: number;
  /** How far the camera has moved along the road after the car (metres). */
  cameraX: number;
  visible: boolean;
  /** Ground speed in m/s, for the wheels. */
  speed: number;
  /** Lift jets (the main thrusters under the car), 0..1, and the roll jets pushing each way. */
  lift: number;
  rollJets: { left: number; right: number };
}

/** One recorded pass: the car's frames at the game's 60 Hz, along a lane, one way. */
interface Pass { start: number; lane: number; heading: 1 | -1; x0: number; frames: { s: number; y: number; lat: number; roll: number; v: number; lift: number; rollAccel: number }[] }

export interface DemoPlan {
  /** Start time of each part of the show, in seconds. */
  at: { leave: number; gap1: number; approach: number; jump: number; land: number; gap2: number; back: number; settle: number; end: number };
  duration: number;
  takeoffX: number;
  landingX: number;
  airTime: number;
  peak: number;
  /** Vertical speed at touch-down (negative = downward), m/s. */
  landingSpeed: number;
  jumpSpeed: number;
  tape: Tape;
  framing: ShowFraming;
  /** Where a pass along each lane is out of the picture (|x| beyond it). */
  edges: { road: number; row: number };
  /** The recorded passes, for tests and diagnostics. */
  passes: { leave: Pass; jump: Pass; back: Pass };
  pose(t: number): DemoPose;
}

const ease = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/** Runs a pass from a car state until `done`, recording every frame. */
function drive(c: CarState, input: (frame: number, c: CarState) => CarInput, done: (c: CarState, frame: number, step: CarStep) => boolean, limit = 3000): Pass['frames'] {
  const frames: Pass['frames'] = [];
  for (let f = 0; f < limit; f++) {
    const step = stepCar(c, input(f, c));
    frames.push({ s: c.s, y: c.y, lat: c.lat, roll: c.roll, v: c.v, lift: step.lift, rollAccel: step.rollAccel });
    if (done(c, f, step)) break;
  }
  return frames;
}

/**
 * The show for a row of cars, framed for a picture of `aspect`: the turntable turns the car to face
 * right, it drives off right, comes back from the right speeding up, takes off before the row, flies
 * over it with one roll, lands, drives off left, comes back in from the left and coasts to a stop on
 * the turntable. Every pass starts and ends beyond the edge of the picture.
 */
export function planDemo(row: Row, aspect: number, choices: JumpChoice[] = chooseJumps(row)): DemoPlan {
  for (const choice of choices.slice(0, 40)) {
    const plan = tryPlan(row, aspect, choice);
    if (plan) return plan;
  }
  throw new Error('No jump clears this row');
}

function tryPlan(row: Row, aspect: number, choice: JumpChoice): DemoPlan | null {
  const { flight, speed, takeoffX } = choice;
  const framing = showFraming(flight.peak, aspect);
  const edge = (laneZ: number) => framing.halfWidthAt(laneZ) + PAN_LIMIT + ROADSTER.halfLength + DEMO.offscreen;
  const edges = { road: edge(0), row: edge(PATH_Z) };

  // Off the turntable to the right, at its cruise speed.
  const leave: Pass = { start: DEMO.turn, lane: 0, heading: 1, x0: 0,
    frames: drive(restingCar(), () => ({ thrust: false, rollLeft: false, rollRight: false, cruise: DEMO.leaveSpeed }), c => c.s > edges.road) };

  // Back along the row's lane from beyond the right edge, speeding up to the jump's cruise; the tape starts where it reaches the take-off point.
  let takeoff = -1, touchdown = -1, landingSpeed = 0;
  const jumpCar = restingCar(speed * DEMO.approachEntry);
  const jumpFrames = drive(jumpCar, (f, c) => {
    if (takeoff < 0 && edges.row - c.s <= takeoffX) takeoff = f;
    const tapeFrame = takeoff < 0 ? -1 : f - takeoff;
    if (tapeFrame < 0 || touchdown >= 0) return { thrust: false, rollLeft: false, rollRight: false, cruise: speed };
    return tapeInput(flight.tape, tapeFrame, speed);
  }, (c, f, step) => {
    if (takeoff >= 0 && touchdown < 0 && f > takeoff && step.touchdown !== null) { touchdown = f; landingSpeed = step.touchdown; }
    return touchdown >= 0 && edges.row - c.s < -edges.row;
  });
  if (takeoff < 0 || touchdown < 0) return null;
  // The real run, with its own take-off point to the centimetre, must clear every roof.
  for (let f = takeoff; f <= touchdown; f++) {
    const p = jumpFrames[f];
    if (roofGap(row, edges.row - p.s, p.y, p.roll) < ROADSTER.clearance) return null;
  }
  const jump: Pass = { start: 0, lane: PATH_Z, heading: -1, x0: edges.row, frames: jumpFrames };

  // In from beyond the left edge on the turntable's lane, coasting (the game has no brakes) to rest on the turntable.
  const stopFrom = (v0: number) => {
    const c = restingCar(v0);
    const frames = drive(c, () => ({ thrust: false, rollLeft: false, rollRight: false, cruise: 0 }), car => car.v < 0.02);
    return { frames, reach: c.s };
  };
  let lo = 0.5, hi = 30;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (stopFrom(mid).reach < edges.road) lo = mid; else hi = mid; }
  const backRun = stopFrom((lo + hi) / 2);
  // Rest exactly on the turntable's centre: the leftover millimetres are taken off the start.
  const back: Pass = { start: 0, lane: 0, heading: 1, x0: -backRun.reach, frames: backRun.frames };

  const leaveEnd = leave.start + leave.frames.length * DT;
  const gap1 = leaveEnd, approach = gap1 + DEMO.gap;
  jump.start = approach;
  const jumpEnd = approach + jump.frames.length * DT;
  const gap2 = jumpEnd, backAt = gap2 + DEMO.gap;
  back.start = backAt;
  const settle = backAt + back.frames.length * DT;
  const at = { leave: leave.start, gap1, approach, jump: approach + takeoff * DT, land: approach + (touchdown + 1) * DT, gap2, back: backAt, settle, end: settle + DEMO.settle };
  const landingX = edges.row - jumpFrames[touchdown].s;

  const sample = (pass: Pass, t: number) => {
    const u = (t - pass.start) / DT - 1, i = Math.max(0, Math.min(pass.frames.length - 1, Math.floor(u)));
    const a = u < 0 ? null : pass.frames[i], b = pass.frames[Math.min(pass.frames.length - 1, i + 1)];
    // Before its first frame the pass is at its starting state.
    const from = a ?? { s: 0, y: 0, lat: 0, roll: 0, v: b.v, lift: 0, rollAccel: 0 };
    const k = u < 0 ? u + 1 : u - i;
    const mix = (p: number, q: number) => p + (q - p) * Math.min(1, Math.max(0, k));
    const s = mix(from.s, b.s);
    return {
      x: pass.x0 + pass.heading * s, y: mix(from.y, b.y), z: pass.lane + mix(from.lat, b.lat), roll: mix(from.roll, b.roll), speed: mix(from.v, b.v),
      lift: (k < 0.5 ? from : b).lift, rollAccel: (k < 0.5 ? from : b).rollAccel, heading: pass.heading,
    };
  };

  const pose = (t: number): DemoPose => {
    const camera = t < settle ? ease(t / DEMO.cameraIn) : 1 - ease((t - settle) / DEMO.settle);
    const make = (p: Partial<DemoPose> & { x: number }): DemoPose => ({
      y: 0, z: 0, roll: 0, heading: 1, facing: 1, hover: 0, onTurntable: false, camera, cameraX: cameraFollow(p.x) * camera,
      visible: true, speed: 0, lift: 0, rollJets: { left: 0, right: 0 }, ...p,
    });
    const fromPass = (pass: Pass) => {
      const p = sample(pass, t);
      const jets = { left: Math.min(1, Math.max(0, p.rollAccel) / CONFIG.car.rollAccel), right: Math.min(1, Math.max(0, -p.rollAccel) / CONFIG.car.rollBrake) };
      return make({ x: p.x, y: p.y, z: p.z, roll: p.roll, heading: p.heading, speed: p.speed, lift: p.lift, rollJets: jets });
    };
    if (t < leave.start) { const e = ease(t / DEMO.turn); return make({ x: 0, facing: e, hover: 1 - e, onTurntable: true }); }
    if (t < gap1) return fromPass(leave);
    if (t < approach) return make({ x: edges.road + 1, visible: false });
    if (t < gap2) return fromPass(jump);
    if (t < backAt) return make({ x: -edges.row - 1, z: PATH_Z, heading: -1, visible: false });
    if (t < settle) return fromPass(back);
    if (t < at.end) { const e = ease((t - settle) / DEMO.settle); return make({ x: 0, facing: 1 - e, hover: e, onTurntable: true }); }
    return make({ x: 0, facing: 0, hover: 1, onTurntable: true });
  };

  return {
    at, duration: at.end, takeoffX: edges.row - jumpFrames[takeoff].s, landingX, airTime: (touchdown + 1 - takeoff) * DT, peak: flight.peak, landingSpeed,
    jumpSpeed: speed, tape: flight.tape, framing, edges, passes: { leave, jump, back }, pose,
  };
}

let nominalFlights: Flight[] | null = null;
const nominalPlans = new Map<number, DemoPlan>();
/** The show for the nominal row (tests, and anything that has not measured the real models). */
export function nominalPlan(aspect = 16 / 9): DemoPlan {
  let plan = nominalPlans.get(aspect);
  if (!plan) {
    const { row } = layoutRow(NOMINAL_CARS);
    plan = planDemo(row, aspect, chooseJumps(row, (nominalFlights ??= searchFlights())));
    nominalPlans.set(aspect, plan);
  }
  return plan;
}

/** The audience, left to right, with each one's length on stage (a Roadster is 3.9 m here). */
export const AUDIENCE = [
  { name: 'Semi', url: semiUrl, length: 6.2 },
  { name: 'Cybercab', url: cybercabUrl, length: 3.9 },
  { name: 'Cybertruck', url: cybertruckUrl, length: 5.2 },
  { name: 'Model 3', url: m3Url, length: 4.2 },
] as const;

/** Credits for the audience models (all CC BY 4.0), as recorded in each download; the Cybertruck is credited with its own vehicle. */
export const AUDIENCE_CREDITS: VehicleCredit[] = [
  { title: 'Tesla Semi', author: 'Aleksei Rozumnyi', url: 'https://sketchfab.com/3d-models/tesla-semi-39ffc7c746184e0c9ebd5bbcd0b405dd' },
  { title: 'Tesla Cybercab 3D Model', author: 'Grass Grass Grass', url: 'https://sketchfab.com/3d-models/tesla-cybercab-3d-model-45c25fd8442b45129e47be2e66449ca3' },
  { title: 'Tesla M3 model', author: 'wintrez', url: 'https://sketchfab.com/3d-models/tesla-m3-model-3a602469d7874d1397efa67182198705' },
  { title: 'Tesla Cybertruck', author: 'Lexyc16', url: 'https://sketchfab.com/3d-models/tesla-cybertruck-f12e67159f75486bb21213e573520612' },
];

/** Fits a model to a length, centres it and rests it on y = 0; every model faces +Z already. */
export function fitToLength(scene: THREE.Object3D, length: number): THREE.Group {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const scale = length / Math.max(size.z, 1e-6);
  const holder = new THREE.Group(), inner = new THREE.Group();
  inner.add(scene);
  inner.scale.setScalar(scale);
  inner.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  holder.add(inner);
  return holder;
}

/** A fitted car's footprint across the road and its height, as it will stand on the stage. */
export function measureCar(model: THREE.Object3D, length: number): RowCar {
  model.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  return { width: size.x, height: size.y, length };
}

export interface AudienceCar { model: THREE.Group; size: RowCar }

let audience: Promise<AudienceCar[]> | null = null;
/** Downloads the four cars once; the result is shared by every menu scene. */
export function loadAudience(): Promise<AudienceCar[]> {
  if (!audience) {
    const loader = new GLTFLoader();
    audience = Promise.all(AUDIENCE.map(car => loader.loadAsync(car.url).then(gltf => {
      const model = fitToLength(gltf.scene, car.length);
      return { model, size: measureCar(model, car.length) };
    })));
    audience.catch(() => { audience = null; });
  }
  return audience;
}
