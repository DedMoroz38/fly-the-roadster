import { CONFIG } from './config';

export type SuctionState = 'off' | 'searching' | 'attracting' | 'attached';

export interface SuctionProbe {
  /** Gap between the wheels and the surface the wheels point at. */
  gap: number;
  /** cos(angle) between the car's up axis and the surface normal. 1 = wheels face it squarely. */
  alignment: number;
}

export interface SuctionResult {
  state: SuctionState;
  /** Attraction acceleration toward the surface (m/s²), 0 unless attracting. */
  pull: number;
}

export const suctionAlignThreshold = () => Math.cos((CONFIG.suction.maxAlignAngleDeg * Math.PI) / 180);

/**
 * Pure suction rule. Attraction happens only when suction is on, a surface is within range
 * along the wheels' direction and the wheels face it. Pull grows smoothly as the gap closes,
 * so the car is drawn in by forces (no teleport/snap).
 */
export function evaluateSuction(active: boolean, probe: SuctionProbe | null, cfg = CONFIG.suction): SuctionResult {
  if (!active) return { state: 'off', pull: 0 };
  if (!probe || probe.gap > cfg.range) return { state: 'searching', pull: 0 };
  if (probe.alignment < Math.cos((cfg.maxAlignAngleDeg * Math.PI) / 180)) return { state: 'searching', pull: 0 };
  if (probe.gap <= cfg.attachDistance) return { state: 'attached', pull: 0 };
  const closeness = 1 - Math.max(0, probe.gap) / cfg.range;
  return { state: 'attracting', pull: cfg.attractAccel + (cfg.maxAttractAccel - cfg.attractAccel) * closeness };
}
