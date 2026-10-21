/** Distances in metres. Keep procedural pacing separate from the vehicle's physical limits. */
export const GENERATOR_CONFIG = {
  difficultyScale: 850,
  difficultyCurve: 2.0,
  candidateAttempts: 3,
  recoveryEvery: 4,
  easySectionChance: 0.12,
  openingChallengeChunks: 2,
  generateAhead: 1600,
  buildAhead: 700,
  keepBehind: 100,
} as const;

/** Smooth logarithmic growth, asymptotically bounded below one. */
export function difficultyAt(distance: number): number {
  const log = Math.log1p(Math.max(0, distance) / GENERATOR_CONFIG.difficultyScale);
  return log / (log + GENERATOR_CONFIG.difficultyCurve);
}
