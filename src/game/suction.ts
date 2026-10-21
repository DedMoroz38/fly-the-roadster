import { CONFIG } from './config';
import type { SurfaceType } from './surfaces';

export type SuctionState = 'off' | 'searching' | 'attracting' | 'attached' | 'overheated' | 'no-energy';

export interface SuctionProbe {
  /** Only classified traversable faces can attract or attach. */
  surface: SurfaceType | null;
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
  if (!probe || !probe.surface || !Number.isFinite(probe.gap) || !Number.isFinite(probe.alignment) || probe.gap > cfg.range) return { state: 'searching', pull: 0 };
  if (probe.alignment < Math.cos((cfg.maxAlignAngleDeg * Math.PI) / 180)) return { state: 'searching', pull: 0 };
  if (probe.gap <= cfg.attachDistance) return { state: 'attached', pull: 0 };
  const closeness = 1 - Math.max(0, probe.gap) / cfg.range;
  return { state: 'attracting', pull: cfg.attractAccel + (cfg.maxAttractAccel - cfg.attractAccel) * closeness };
}


export interface SuctionThermalState {
  heat: number;
  overheated: boolean;
  active: boolean;
}

/** Shared thermal hysteresis. A locked step cools; a held request resumes on the next unlocked step. */
export function advanceSuctionHeat(
  state: SuctionThermalState,
  dt: number,
  floorContact: boolean,
  cfg = CONFIG.suction,
): SuctionThermalState {
  const active = state.active && !state.overheated;
  const change = active ? (floorContact ? cfg.floorHeatRate : cfg.heatRate) : -cfg.coolingRate;
  const heat = Math.max(0, Math.min(cfg.criticalHeat, state.heat + Math.max(0, dt) * change));
  const overheated = heat >= cfg.criticalHeat || (state.overheated && heat >= cfg.recoveryHeat);
  return { heat, overheated, active: active && !overheated };
}
