import { CONFIG } from '../config';
import { clamp } from '../../core/math';

/** Distances in metres. Keep procedural pacing separate from the vehicle's physical limits. */
export const GENERATOR_CONFIG = {
  /** difficulty = 1 − exp(−(distance / scale)^exponent): ~0.42 at 200 m, 0.70 at 1 km, 0.93 at 5 km. */
  difficultyScale: 670,
  difficultyExponent: 0.5,
  /** Extra cruise speed (m/s) at difficulty 1; W keeps its usual margin above cruise. */
  speedGain: 12,
  candidateAttempts: 3,
  /** Every Nth chunk is a forced floor run, until difficulty reaches recoveryUntil. */
  recoveryEvery: 5,
  recoveryUntil: 0.8,
  /** Chance of an extra floor run at difficulty 0; it fades to none at difficulty 1. */
  easySectionChance: 0.05,
  openingChallengeChunks: 2,
  generateAhead: 1600,
  /** Validated distance required before the menu appears. */
  startBuffer: 400,
  buildAhead: 700,
  keepBehind: 100,
} as const;

/** Rises steeply over the first few hundred metres, then keeps climbing toward one. */
export function difficultyAt(distance: number): number {
  const { difficultyScale, difficultyExponent } = GENERATOR_CONFIG;
  return 1 - Math.exp(-((Math.max(0, distance) / difficultyScale) ** difficultyExponent));
}

/** Cruise and boosted speed (m/s) for one chunk. Each chunk is validated at its own pace. */
export interface Pace { cruise: number; max: number }
export function paceFor(difficulty: number): Pace {
  const { cruiseSpeed, maxForwardSpeed } = CONFIG.car;
  const cruise = cruiseSpeed + GENERATOR_CONFIG.speedGain * clamp(difficulty, 0, 1);
  return { cruise, max: cruise + maxForwardSpeed - cruiseSpeed };
}
