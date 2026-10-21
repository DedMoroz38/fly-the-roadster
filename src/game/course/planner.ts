import { CONFIG } from '../config';
import { Rng } from '../../core/rng';
import { clamp, wrapAngle } from '../../core/math';
import { emptyControls, type ControlState } from '../input';
import { StaticLevel, type PickupLike, type ObstacleLike } from '../physics/level';
import { Simulation } from '../simulation';
import { FailureMonitor } from '../session';
import type { Slab, SurfaceType } from '../surfaces';
import { PLANNER_CONFIG as P } from './plannerConfig';

export type ScenarioKind = 'normal' | 'gap' | 'ceiling' | 'wall-left' | 'wall-right' | 'multiple' | 'flight';
export interface ReachableState {
  x: number; y: number; roll: number; vx: number; vy: number; forward: number; rollVelocity: number;
  fuel: number; heat: number; overheated: boolean; suctionOn: boolean; surface: SurfaceType | null;
  /** Actual integration overshoot beyond the preceding chunk boundary, carried forward. */
  distanceOffset: number;
  /** Chunk-relative distance of the latest touchdown or standing start; negative = an earlier chunk. */
  lastArrival: number;
}
export const initialReachableState = (): ReachableState => ({
  x: 0, y: CONFIG.car.halfExtents.y + 0.02, roll: 0, vx: 0, vy: 0, forward: 0, rollVelocity: 0,
  fuel: CONFIG.fuel.capacity, heat: 0, overheated: false, suctionOn: false, surface: 'floor', distanceOffset: 10, lastArrival: 10,
});
export interface RouteWaypoint {
  d: number; x: number; y: number; roll: number; forward: number; fuel: number; heat: number;
  surface: SurfaceType | null; phase: string;
}
export interface ManeuverPhase {
  action: 'drive' | 'launch' | 'roll' | 'catch' | 'flight';
  label: string;
  surface?: SurfaceType;
  untilD?: number;
  x?: number; y?: number;
  duration?: number;
  roll?: number;
  suction?: boolean;
  pulses?: [number, number][];
}
export interface PlanValidation {
  accepted: boolean;
  reasons: string[];
  seconds: number;
  steps: number;
  minFuel: number;
  maxHeat: number;
  timingTolerance: number;
  replayCount: number;
  visitedSurfaces: SurfaceType[];
  minReactionSeconds: number;
  entrySpeedEnvelope: { min: number; max: number };
}
export interface PlannedChunk {
  id: number; seed: number; d0: number; d1: number; kind: ScenarioKind; difficulty: number;
  slabs: Omit<Slab, 'id'>[]; pickups: PickupLike[]; obstacles: ObstacleLike[]; route: RouteWaypoint[];
  plan: ManeuverPhase[]; entry: ReachableState; exit: ReachableState; validation: PlanValidation;
  witness: { dt: number; controls: ControlState[]; samples: RouteWaypoint[]; phaseIndices: number[] };
}
export interface PlanChunkOptions {
  id: number; seed: number; d0: number; kind: ScenarioKind; difficulty: number; entry: ReachableState;
  /** Short opening floor only; later recovery sections retain their full duration. */
  intro?: boolean;
}
interface Blueprint { phases: ManeuverPhase[]; supports: Omit<Slab, 'id'>[]; pickups: PickupLike[]; obstacles: ObstacleLike[]; end: number; required: SurfaceType[] }

/** First choose maneuvers and support intervals; physical slabs are built from those intervals. */
function blueprint(kind: ScenarioKind, seed: number, difficulty: number, entry: ReachableState, intro = false): Blueprint {
  const rng = new Rng(seed);
  // The reaction interval runs from the latest touchdown, which may be in the previous chunk.
  const settled = Math.max(0, entry.lastArrival + CONFIG.car.maxForwardSpeed * P.reactionSeconds + P.reactionMargin);
  const baseLead = rng.int(P.leadMin, P.leadMax);
  const leadAfter = (launchLead: number) => Math.max(baseLead, Math.ceil(settled + launchLead));
  const traversalExtra = rng.int(0, P.traversalVariation);
  const traversal = P.surfaceTraversal + traversalExtra;
  const setupX = CONFIG.corridor.halfWidth - P.setupWallDistance;
  const wallX = CONFIG.corridor.halfWidth - CONFIG.car.halfExtents.y;
  const recovery = CONFIG.car.maxForwardSpeed * P.recoverySeconds;
  const phases: ManeuverPhase[] = [];
  const supports: Omit<Slab, 'id'>[] = [];
  let end: number;
  const required: SurfaceType[] = ['floor'];
  const drive = (untilD: number, surface: SurfaceType = 'floor', x = 0, y = 5) =>
    phases.push({ action: 'drive', label: `${surface} traversal`, untilD, surface, x, y, suction: surface !== 'floor' });
  const roll = (angle: number) => phases.push({ action: 'roll', label: `roll ${Math.round(angle * 180 / Math.PI)}°`, roll: angle, suction: false });
  const catchSurface = (surface: SurfaceType) => phases.push({ action: 'catch', label: `attach ${surface}`, surface, suction: surface !== 'floor' });
  const support = (surface: SurfaceType, d0: number, d1: number) => supports.push({ surface, d0, d1, bevel: d0 !== 0 });
  // Floor runs weave between lanes; the decorator then blocks the lanes the route leaves.
  const slalom = (untilD: number) => {
    // Pass the entry fuel cell centred before the first lane change.
    let d = P.pickupInset + 4, side = rng.chance(0.5) ? -1 : 1;
    drive(d);
    while (untilD - d > P.slalomSegment.max + P.slalomExit) {
      d += rng.int(P.slalomSegment.min, P.slalomSegment.max);
      phases.push({ action: 'drive', label: `slalom ${side < 0 ? 'left' : 'right'}`, untilD: d, surface: 'floor',
        x: side * rng.range(P.slalomLane.min, P.slalomLane.max), y: 5, suction: false });
      side = -side;
    }
    drive(untilD);
  };
  if (kind === 'normal') {
    // The opening and the difficulty-0 fallback stay straight; other floor sections are slaloms.
    end = intro ? rng.int(P.introMin, P.introMax) : difficulty > 0 ? rng.int(P.slalomMin, P.slalomMax) : baseLead + recovery;
    if (intro || difficulty <= 0) drive(end);
    else slalom(end);
    support('floor', 0, end);
  } else if (kind === 'gap' || kind === 'flight') {
    const gap = kind === 'gap' ? P.gapMin + difficulty * (P.gapMax - P.gapMin) : P.flightMin + difficulty * (P.flightMax - P.flightMin);
    const lead = leadAfter(P.gapLaunchLead);
    drive(lead - P.gapLaunchLead);
    phases.push({ action: 'flight', label: kind === 'gap' ? 'lift across gap' : 'extended flight', duration: kind === 'gap' ? 3.4 : 4.2,
      pulses: kind === 'gap' ? [[0, 0.7]] : [[0, 0.5], [1.3, 1.75], [2.2, 2.65]], suction: false });
    catchSurface('floor');
    end = lead + gap + recovery;
    drive(end);
    support('floor', 0, lead);
    support('floor', lead + gap, end);
  } else if (kind === 'ceiling' || kind === 'multiple') {
    const lead = leadAfter(P.ceilingLaunchLead);
    drive(lead - P.ceilingLaunchLead);
    phases.push({ action: 'launch', label: 'launch toward ceiling', duration: P.ceilingLiftSeconds, suction: false });
    roll(Math.PI);
    catchSurface('ceiling');
    required.push('ceiling');
    support('floor', 0, lead);
    support('ceiling', lead - P.supportOverlap, lead + traversal + 40);
    if (kind === 'ceiling') {
      drive(lead + traversal, 'ceiling');
      roll(0);
      catchSurface('floor');
      end = lead + traversal + 40 + recovery;
      drive(end);
      support('floor', lead + traversal - 20, end);
    } else {
      // Mirrored per seed, so the ceiling hands over to either wall.
      const side: SurfaceType = rng.chance(0.5) ? 'left' : 'right';
      const sign = side === 'left' ? -1 : 1;
      drive(lead + 110 + traversalExtra, 'ceiling', sign * setupX);
      roll(sign * Math.PI / 2);
      catchSurface(side);
      drive(lead + 250 + traversalExtra, side, sign * wallX, P.wallReturnHeight);
      roll(0);
      catchSurface('floor');
      end = lead + 250 + P.wallDropPad + traversalExtra + recovery;
      drive(end);
      support(side, lead + 90 + traversalExtra, lead + 250 + P.wallDropPad + traversalExtra);
      support('floor', lead + 230 + traversalExtra, end);
      required.push(side);
    }
  } else {
    const side = kind === 'wall-left' ? 'left' : 'right';
    const sign = side === 'left' ? -1 : 1;
    // Sideways setup is a maneuver too: it starts after the reaction interval and entry fuel cell.
    const setupFrom = Math.max(settled, P.pickupInset + 4);
    const lead = Math.max(baseLead, Math.ceil(setupFrom + P.wallSetupLead));
    drive(setupFrom);
    drive(lead - 12, 'floor', sign * setupX);
    phases.push({ action: 'launch', label: `launch toward ${side} wall`, duration: P.wallLiftSeconds, suction: false });
    roll(sign * Math.PI / 2);
    catchSurface(side);
    drive(lead + traversal, side, sign * wallX, P.wallReturnHeight);
    roll(0);
    catchSurface('floor');
    end = lead + traversal + P.wallDropPad + recovery;
    drive(end);
    support('floor', 0, lead);
    support(side, lead - P.supportOverlap, lead + traversal + P.wallDropPad);
    support('floor', lead + traversal - 20, end);
    required.push(side);
  }
  // Recovery pickups are actual swept pickups in both validation and live play.
  const pickups: PickupLike[] = [
    { id: 1, x: 0, y: 0.8, d: P.pickupInset, surface: 'floor' },
    { id: 2, x: 0, y: 0.8, d: end - P.exitPickupInset, surface: 'floor' },
  ];
  return { phases, supports, pickups, obstacles: [], end, required };
}

function readState(sim: Simulation, boundary: number, lastArrival: number): ReachableState {
  const v = sim.vehicle, p = v.position, velocity = v.body.linvel();
  return { x: p.x, y: p.y, roll: v.roll, vx: velocity.x, vy: velocity.y, forward: v.forwardSpeed,
    rollVelocity: v.body.angvel().z, fuel: sim.fuel.value, heat: v.suctionHeat, overheated: v.suctionOverheated,
    suctionOn: v.suctionOn, surface: v.supportSurface, distanceOffset: sim.distance - boundary, lastArrival: lastArrival - boundary };
}
function snapshot(sim: Simulation, phase: string): RouteWaypoint {
  const v = sim.vehicle;
  return { d: sim.distance, x: v.position.x, y: v.position.y, roll: v.roll, forward: v.forwardSpeed,
    fuel: sim.fuel.value, heat: v.suctionHeat, surface: v.supportSurface, phase };
}
function makeReplay(entry: ReachableState, b: Blueprint): Simulation {
  const sim = new Simulation({ spawn: { x: entry.x, y: entry.y, z: -entry.distanceOffset },
    createLevel: w => new StaticLevel(w, [{ surface: 'floor', d0: -30, d1: 0, bevel: false }, ...b.supports], b.pickups, b.obstacles) });
  sim.vehicle.body.setLinvel({ x: entry.vx, y: entry.vy, z: -entry.forward }, true);
  sim.vehicle.body.setRotation({ x: 0, y: 0, z: Math.sin(entry.roll / 2), w: Math.cos(entry.roll / 2) }, true);
  sim.vehicle.body.setAngvel({ x: 0, y: 0, z: entry.rollVelocity }, true);
  sim.fuel.consume(1, Math.max(0, CONFIG.fuel.capacity - entry.fuel));
  sim.vehicle.suctionHeat = entry.heat;
  sim.vehicle.suctionOverheated = entry.overheated;
  sim.vehicle.suctionOn = entry.suctionOn;
  sim.vehicle.forwardSpeed = entry.forward;
  return sim;
}
function steer(sim: Simulation, phase: ManeuverPhase, c: ControlState) {
  const v = sim.vehicle, p = v.position, velocity = v.body.linvel();
  const right = { x: Math.cos(v.roll), y: Math.sin(v.roll) };
  const delta = ((phase.x ?? p.x) - p.x) * right.x + ((phase.y ?? p.y) - p.y) * right.y;
  const lateral = velocity.x * right.x + velocity.y * right.y;
  const stopping = lateral * lateral / (2 * CONFIG.car.landingGrip) + 0.15;
  if (Math.abs(delta) > stopping) { c.steerRight = delta > 0; c.steerLeft = delta < 0; }
}
function orientation(sim: Simulation, angle: number, c: ControlState) {
  const error = wrapAngle(angle - sim.vehicle.roll), w = sim.vehicle.body.angvel().z;
  const braking = w * w / (2 * CONFIG.car.rollBrake) + 0.06;
  if (Math.abs(error) > 0.08 && !(Math.sign(error) === Math.sign(w) && Math.abs(error) < braking)) {
    c.rollLeft = error > 0;
    c.rollRight = error < 0;
  }
}
function phaseDone(sim: Simulation, phase: ManeuverPhase, elapsed: number): boolean {
  switch (phase.action) {
    case 'drive': return sim.distance >= phase.untilD!;
    case 'launch': case 'flight': return elapsed >= phase.duration!;
    case 'roll': return Math.abs(wrapAngle(phase.roll! - sim.vehicle.roll)) < 0.32;
    case 'catch': return sim.vehicle.mode !== 'airborne' && sim.vehicle.supportSurface === phase.surface;
  }
}
function phaseControls(sim: Simulation, phase: ManeuverPhase, elapsed: number): ControlState {
  const c = emptyControls();
  c.suction = !!phase.suction;
  if (phase.action === 'drive') steer(sim, phase, c);
  if (phase.action === 'launch') c.thrust = true;
  if (phase.action === 'roll') orientation(sim, phase.roll!, c);
  if (phase.action === 'flight') c.thrust = phase.pulses!.some(([a, b]) => elapsed >= a && elapsed < b);
  return c;
}
interface ReplayResult { exit: ReachableState; controls: ControlState[]; phaseIndices: number[]; samples: RouteWaypoint[]; reasons: string[]; steps: number; seconds: number; minFuel: number; maxHeat: number; minReactionSeconds: number; visited: SurfaceType[] }
function replay(entry: ReachableState, b: Blueprint, tape?: ControlState[], timingShift = 0, phaseIndices?: number[]): ReplayResult {
  const sim = makeReplay(entry, b);
  const failure = new FailureMonitor();
  const controls: ControlState[] = [], recordedPhases: number[] = [], samples: RouteWaypoint[] = [], reasons: string[] = [];
  const visited = new Set<SurfaceType>();
  let phase = 0, phaseStart = 0, minFuel = entry.fuel, maxHeat = entry.heat;
  let lastArrival = entry.lastArrival, wasAirborne = false, minReactionSeconds = Infinity;
  const shift = Math.round(timingShift / sim.dt);
  const maxSteps = Math.ceil(P.maxValidationSeconds / sim.dt);
  let steps = 0;
  try {
    for (; steps < maxSteps && sim.distance < b.end; steps++) {
      if (!tape) {
        while (phase < b.phases.length - 1 && phaseDone(sim, b.phases[phase], sim.time - phaseStart)) {
          phase++; phaseStart = sim.time;
        }
      }
      if (tape && phaseIndices) phase = phaseIndices[Math.max(0, steps - shift)] ?? b.phases.length - 1;
      const active = b.phases[phase];
      const c = tape ? { ...(tape[steps - shift] ?? emptyControls()) } : phaseControls(sim, active, sim.time - phaseStart);
      if (tape && active.action === 'drive' && sim.vehicle.mode !== 'airborne') {
        c.steerLeft = false; c.steerRight = false;
        steer(sim, active, c);
      }
      // The long recovery road permits an ordinary visible steering correction after a
      // timing error; validation never changes the live vehicle or injects resources.
      if (tape && sim.distance > b.end - CONFIG.car.maxForwardSpeed * P.recoverySeconds + 32 && sim.vehicle.supportSurface === 'floor') {
        c.steerLeft = false; c.steerRight = false;
        steer(sim, { action: 'drive', label: 'recovery', x: 0 }, c);
        c.suction = false;
      }
      const newPhase = recordedPhases.length === 0 || recordedPhases[recordedPhases.length - 1] !== phase;
      if (newPhase && (active.action === 'launch' || active.action === 'flight' ||
        (active.action === 'roll' && b.phases[Math.max(0, phase - 1)].action === 'drive'))) {
        const reaction = (sim.distance - lastArrival) / CONFIG.car.maxForwardSpeed;
        minReactionSeconds = Math.min(minReactionSeconds, reaction);
        if (reaction < P.reactionSeconds) { reasons.push('insufficient human reaction interval'); break; }
        if (sim.fuel.value < P.launchFuelReserve) { reasons.push('insufficient launch fuel reserve'); break; }
      }
      controls.push(c); recordedPhases.push(phase);
      sim.step(c);
      if (wasAirborne && sim.vehicle.mode !== 'airborne') lastArrival = sim.distance;
      wasAirborne = sim.vehicle.mode === 'airborne';
      minFuel = Math.min(minFuel, sim.fuel.value); maxHeat = Math.max(maxHeat, sim.vehicle.suctionHeat);
      if (sim.vehicle.supportSurface) visited.add(sim.vehicle.supportSurface);
      if (steps % P.sampleEverySteps === 0) samples.push(snapshot(sim, tape ? 'timing replay' : active.label));
      const failed = failure.check(sim);
      if (failed) { reasons.push(`game failure: ${failed}`); break; }
      const p = sim.vehicle.position;
      if (!Number.isFinite(p.x + p.y + p.z) || p.y < -2 || p.y > CONFIG.corridor.height + 5 || Math.abs(p.x) > CONFIG.corridor.halfWidth + 1) {
        reasons.push(`outside safe corridor at ${sim.distance.toFixed(1)}m (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, roll ${sim.vehicle.roll.toFixed(2)})`); break;
      }
      if (sim.vehicle.suctionOverheated) { reasons.push('required route overheated suction'); break; }
      if (!tape && sim.time - phaseStart > 5 && active.action !== 'drive') { reasons.push(`maneuver timed out: ${active.label}`); break; }
    }
    if (sim.distance < b.end) reasons.push('did not reach chunk exit');
    for (const surface of b.required) if (!visited.has(surface)) reasons.push(`required ${surface} traversal not reached`);
    const exit = readState(sim, b.end, lastArrival);
    if (exit.surface !== 'floor' || sim.vehicle.mode === 'airborne' || Math.abs(exit.roll) > 0.08 || Math.abs(exit.x) > 0.7 || Math.abs(exit.vx) > 0.3 || Math.abs(exit.vy) > 0.5) reasons.push('exit is not a stable centred floor state');
    if (exit.fuel < P.exitFuelReserve) reasons.push('insufficient exit fuel reserve');
    if (exit.heat >= CONFIG.suction.recoveryHeat || exit.overheated || exit.suctionOn) reasons.push('exit lacks suction recovery');
    if (sim.refuelCount < 2) reasons.push('recharge opportunities were not reachable');
    return { exit, controls, phaseIndices: recordedPhases, samples, reasons, steps, seconds: sim.time, minFuel, maxHeat, minReactionSeconds: Number.isFinite(minReactionSeconds) ? minReactionSeconds : P.reactionSeconds, visited: [...visited] };
  } finally { sim.dispose(); }
}

function shiftedSuction(tape: ControlState[], seconds: number): ControlState[] {
  const shift = Math.round(seconds * CONFIG.physicsHz);
  const result = tape.map(c => ({ ...c, suction: false }));
  // Shift each engagement independently while preserving its release time. This
  // tests an early/late E hold without moving the roll/lift sequence with it.
  for (let start = 0; start < tape.length; start++) {
    if (!tape[start].suction || (start > 0 && tape[start - 1].suction)) continue;
    let end = start + 1;
    while (end < tape.length && tape[end].suction) end++;
    for (let i = Math.max(0, start + shift); i < end; i++) result[i].suction = true;
    start = end - 1;
  }
  return result;
}
function candidateBlueprint(candidate: PlannedChunk): Blueprint {
  return {
    phases: candidate.plan,
    supports: candidate.slabs.map(s => ({ ...s, d0: s.d0 - candidate.d0, d1: s.d1 - candidate.d0 })),
    pickups: candidate.pickups.map(p => ({ ...p, d: p.d - candidate.d0 })),
    obstacles: candidate.obstacles.map(o => ({ ...o, d: o.d - candidate.d0 })),
    end: candidate.d1 - candidate.d0,
    // Every planned attachment is a required traversal; decorative islands are not.
    required: [...new Set<SurfaceType>(['floor', ...candidate.plan.flatMap(p => p.action === 'catch' && p.surface ? [p.surface] : [])])],
  };
}

/** Independently replay an existing candidate, so altered geometry/resources can be rejected. */
export function validatePlan(candidate: PlannedChunk, entry: ReachableState = candidate.entry): PlanValidation {
  const b = candidateBlueprint(candidate);
  const nominal = replay(entry, b, candidate.witness.controls, 0, candidate.witness.phaseIndices);
  const reasons = [...nominal.reasons];
  let replayCount = 1, steps = nominal.steps, minFuel = nominal.minFuel, maxHeat = nominal.maxHeat, minReactionSeconds = nominal.minReactionSeconds;
  const check = (result: ReplayResult, label: string) => {
    replayCount++; steps += result.steps;
    minFuel = Math.min(minFuel, result.minFuel); maxHeat = Math.max(maxHeat, result.maxHeat);
    minReactionSeconds = Math.min(minReactionSeconds, result.minReactionSeconds);
    reasons.push(...result.reasons.map(reason => `${label}: ${reason}`));
  };
  if (!reasons.length) {
    for (const shift of [-P.timingTolerance, P.timingTolerance]) {
      check(replay(entry, b, candidate.witness.controls, shift, candidate.witness.phaseIndices), `${shift > 0 ? 'late' : 'early'} action timing`);
      if (candidate.witness.controls.some(c => c.suction)) {
        check(replay(entry, b, shiftedSuction(candidate.witness.controls, shift), 0, candidate.witness.phaseIndices), `${shift > 0 ? 'late' : 'early'} suction timing`);
      }
    }
    // A new finite witness is constructed for each measured entry speed. Every replay uses
    // exactly the same physical geometry, fuel, heat and inherited transverse state.
    for (const forward of [CONFIG.car.cruiseSpeed, 28, CONFIG.car.maxForwardSpeed]) {
      if (Math.abs(forward - entry.forward) > 0.1) check(replay({ ...entry, forward }, b), `entry speed ${forward}`);
    }
  }
  return { accepted: reasons.length === 0, reasons, seconds: nominal.seconds, steps, minFuel, maxHeat,
    timingTolerance: P.timingTolerance, replayCount, visitedSurfaces: nominal.visited, minReactionSeconds, entrySpeedEnvelope: { min: CONFIG.car.cruiseSpeed, max: CONFIG.car.maxForwardSpeed } };
}

/** Recompute the nominal exit and witness after geometry changes, then repeat every safety replay. */
export function recertifyPlan(candidate: PlannedChunk): PlannedChunk {
  const nominal = replay(candidate.entry, candidateBlueprint(candidate));
  const samples = nominal.samples.map(p => ({ ...p, d: p.d + candidate.d0 }));
  const result: PlannedChunk = { ...candidate, exit: nominal.exit, route: samples,
    witness: { dt: 1 / CONFIG.physicsHz, controls: nominal.controls, samples, phaseIndices: nominal.phaseIndices },
    validation: { ...candidate.validation, accepted: false, reasons: nominal.reasons },
  };
  if (!nominal.reasons.length) result.validation = validatePlan(result);
  return result;
}

/** Generates a candidate and validates its actual control witness; rejection is explicit, never hidden. */
export function planChunk(options: PlanChunkOptions): PlannedChunk {
  const { id, seed, d0, kind, entry } = options;
  const difficulty = clamp(options.difficulty, 0, 1);
  const b = blueprint(kind, seed, difficulty, entry, options.intro);
  const nominal = replay(entry, b);
  const samples = nominal.samples.map(p => ({ ...p, d: p.d + d0 }));
  const candidate: PlannedChunk = {
    id, seed, d0, d1: d0 + b.end, kind, difficulty, entry: { ...entry }, exit: nominal.exit,
    slabs: b.supports.map(s => ({ ...s, d0: s.d0 + d0, d1: s.d1 + d0 })),
    pickups: b.pickups.map(p => ({ ...p, d: p.d + d0 })), obstacles: [], route: samples, plan: b.phases,
    validation: { accepted: nominal.reasons.length === 0, reasons: nominal.reasons, seconds: nominal.seconds, steps: nominal.steps,
      minFuel: nominal.minFuel, maxHeat: nominal.maxHeat, timingTolerance: P.timingTolerance, replayCount: 1, visitedSurfaces: nominal.visited, minReactionSeconds: nominal.minReactionSeconds, entrySpeedEnvelope: { min: CONFIG.car.cruiseSpeed, max: CONFIG.car.maxForwardSpeed } },
    witness: { dt: 1 / CONFIG.physicsHz, controls: nominal.controls, samples, phaseIndices: nominal.phaseIndices },
  };
  if (candidate.validation.accepted) candidate.validation = validatePlan(candidate);
  return candidate;
}
