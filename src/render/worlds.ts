import { NeonEnvironment, type Environment } from './environment';
import { neonPickups } from './pickupView';
import { NEON_SURFACES } from './surfaceView';
import { neonObstacles, type ObstacleStyle, type PickupStyle, type SurfaceStyle } from './trackStyle';
import { MarsEnvironment } from './mars/environment';
import { MARS_SURFACES, marsObstacles, marsPickups } from './mars/trackStyle';
import { OrbitEnvironment } from './orbit/environment';
import { ORBIT_SURFACES, orbitObstacles, orbitPickups } from './orbit/trackStyle';
import { DinoEnvironment } from './dino/environment';
import { DINO_SURFACES, dinoObstacles, dinoPickups } from './dino/trackStyle';
import { VoxelEnvironment } from './voxel/environment';
import { VOXEL_SURFACES, voxelObstacles, voxelPickups } from './voxel/trackStyle';

export type WorldId = 'neon' | 'voxel' | 'mars' | 'orbit' | 'dino';

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
  mars: { id: 'mars', surfaces: MARS_SURFACES, obstacles: marsObstacles, pickups: marsPickups, environment: seed => new MarsEnvironment(seed) },
  dino: { id: 'dino', surfaces: DINO_SURFACES, obstacles: dinoObstacles, pickups: dinoPickups, environment: seed => new DinoEnvironment(seed) },
  orbit: { id: 'orbit', surfaces: ORBIT_SURFACES, obstacles: orbitObstacles, pickups: orbitPickups, environment: seed => new OrbitEnvironment(seed) },
};
