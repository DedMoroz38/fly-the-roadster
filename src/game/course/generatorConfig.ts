/** Distances in metres. Keep procedural pacing separate from the vehicle's physical limits. */
export const GENERATOR_CONFIG = {
  difficultyScale: 850,
  difficultyCurve: 2.0,
  openingDifficultyMultiplier: 1.5,
  openingDistance: 1000,
  candidateAttempts: 3,
  recoveryEvery: 4,
  easySectionChance: 0.12,
  openingChallengeChunks: 2,
  generateAhead: 1600,
  buildAhead: 700,
  keepBehind: 100,
} as const;

/** Opening kilometre is 50% harder; the later curve stays increasing and below one. */
export function difficultyAt(distance: number): number {
  const log = Math.log1p(Math.max(0, distance) / GENERATOR_CONFIG.difficultyScale);
  const base = log / (log + GENERATOR_CONFIG.difficultyCurve);
  const openingLog = Math.log1p(GENERATOR_CONFIG.openingDistance / GENERATOR_CONFIG.difficultyScale);
  const openingBase = openingLog / (openingLog + GENERATOR_CONFIG.difficultyCurve);
  const openingPeak = openingBase * GENERATOR_CONFIG.openingDifficultyMultiplier;
  if (distance <= GENERATOR_CONFIG.openingDistance) return base * GENERATOR_CONFIG.openingDifficultyMultiplier;
  // Blend the remaining growth toward one without dropping difficulty after the opening.
  return openingPeak + (base - openingBase) * (1 - openingPeak) / (1 - openingBase);
}
