import { NeonEnvironment, type Environment } from './environment';
import { neonPickups } from './pickupView';
import { NEON_SURFACES } from './surfaceView';
import { neonObstacles, type ObstacleStyle, type PickupStyle, type SurfaceStyle } from './trackStyle';
import { VoxelEnvironment } from './voxel/environment';
import { VOXEL_SURFACES, voxelObstacles, voxelPickups } from './voxel/trackStyle';

export type WorldId = 'neon' | 'voxel';

/** A world restyles the track and supplies its surroundings; the course itself never changes. */
export interface WorldDefinition {
  id: WorldId;
  surfaces: SurfaceStyle;
  obstacles(): ObstacleStyle;
  pickups(): PickupStyle;
  environment(seed: number): Environment;
}

export const WORLDS: Record<WorldId, WorldDefinition> = {
  neon: { id: 'neon', surfaces: NEON_SURFACES, obstacles: neonObstacles, pickups: neonPickups, environment: () => new NeonEnvironment() },
  voxel: { id: 'voxel', surfaces: VOXEL_SURFACES, obstacles: voxelObstacles, pickups: voxelPickups, environment: seed => new VoxelEnvironment(seed) },
};
