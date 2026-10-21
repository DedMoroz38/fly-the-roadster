import RAPIER from '@dimforge/rapier3d-compat';
import { Level, SlabSet, ObstacleSet, PickupLike } from '../physics/level';
import type { Slab } from '../surfaces';
import type { CourseDebugInfo } from '../session';
import { ChunkSource, SynchronousChunkSource } from './chunkSource';
import { GENERATOR_CONFIG, difficultyAt } from './generatorConfig';
import { GeneratedChunk, GeneratorOptions } from './routeGenerator';
import type { RouteWaypoint } from './planner';
import { CONFIG } from '../config';

export const STREAM = GENERATOR_CONFIG;
export interface CourseOptions extends GeneratorOptions { source?: ChunkSource }

/** Streams exact validated geometry; there is no quantization between validation and play. */
export class Course implements Level {
  readonly slabs: SlabSet;
  readonly obstacles: ObstacleSet;
  readonly activePickups = new Map<number, PickupLike>();
  readonly chunks: GeneratedChunk[] = [];
  readonly source: ChunkSource;
  version = 0;
  terrainStatus: string | null = null;
  private built = new Set<number>();
  private nextId = 2;
  private lastChunkId = -1;
  private disposed = false;

  constructor(world: RAPIER.World, readonly seed: number, options: CourseOptions = {}) {
    this.slabs = new SlabSet(world);
    this.obstacles = new ObstacleSet(world);
    this.source = options.source ?? new SynchronousChunkSource(seed, options);
    // Entry overlap matches the validator's source floor, with no ramp/seam at d=0.
    this.slabs.add({ id: 1, surface: 'floor', d0: -30, d1: 0, bevel: false });
    this.update(0);
  }

  update(distance: number) {
    if (this.disposed) return;
    const behind = distance - STREAM.keepBehind;
    this.source.request(distance + STREAM.generateAhead, behind);
    for (const chunk of this.source.drain()) {
      if (chunk.id <= this.lastChunkId) continue;
      const previous = this.chunks.at(-1);
      if (previous && Math.abs(chunk.d0 - previous.d1) > 0.001) throw new Error('Non-contiguous terrain stream');
      if (!chunk.validation.accepted) throw new Error('Unvalidated terrain was not published');
      this.chunks.push(chunk);
      this.lastChunkId = chunk.id;
      this.version++;
    }
    for (const chunk of this.chunks) {
      if (this.built.has(chunk.id) || chunk.d0 > distance + STREAM.buildAhead) continue;
      if (chunk.d1 < behind) continue;
      for (const slab of chunk.slabs) this.slabs.add({ ...slab, id: this.nextId++ });
      for (const obstacle of chunk.obstacles) this.obstacles.add({ ...obstacle, id: this.nextId++ });
      for (const pickup of chunk.pickups) {
        const id = this.nextId++;
        this.activePickups.set(id, { ...pickup, id });
      }
      this.built.add(chunk.id);
    }
    for (const slab of this.slabs.active.values()) if (slab.d1 < behind) this.slabs.remove(slab.id);
    for (const obstacle of this.obstacles.active.values()) if (obstacle.d + obstacle.half.z < behind) this.obstacles.remove(obstacle.id);
    for (const pickup of this.activePickups.values()) if (pickup.d < behind) this.activePickups.delete(pickup.id);
    while (this.chunks.length && this.chunks[0].d1 < behind) {
      this.built.delete(this.chunks[0].id);
      this.chunks.shift();
      this.version++;
    }
    this.terrainStatus = this.source.error ? 'Terrain generation failed · R to retry'
      : this.needsBuffer(distance) ? 'Preparing road…' : null;
  }

  /** Slow/erroring generation freezes simulation before the car can reach missing terrain. */
  needsBuffer(distance: number) {
    return !!this.source.error || this.source.frontier - distance < CONFIG.car.maxForwardSpeed * 2;
  }
  collect(id: number) { return this.activePickups.delete(id); }
  /** Logical course distances stay unchanged while physics uses a nearby origin. */
  setOriginDistance(distance: number) {
    this.slabs.setOriginDistance(distance);
    this.obstacles.setOriginDistance(distance);
  }
  get builtSlabs(): Slab[] { return [...this.slabs.active.values()]; }
  get routeWaypoints(): RouteWaypoint[] { return this.chunks.flatMap(chunk => chunk.route); }

  debugInfo(distance: number): CourseDebugInfo {
    const chunk = this.chunks.find(c => distance >= c.d0 && distance < c.d1) ?? this.chunks[0];
    const nearest = chunk?.route.find(p => p.d >= distance);
    const next = chunk?.route.find(p => p.d > distance + 6 && p.phase !== nearest?.phase);
    return {
      difficulty: chunk?.difficulty ?? difficultyAt(distance),
      chunkSeed: chunk?.seed ?? this.seed, chunkId: chunk?.id ?? 0,
      kind: chunk?.kind ?? 'normal', validated: chunk?.validation.accepted ?? false,
      minFuel: chunk?.validation.minFuel ?? 0, maxHeat: chunk?.validation.maxHeat ?? 0,
      phase: nearest?.phase ?? 'floor traversal',
      nextAction: next ? `${next.phase} in ${Math.max(0, Math.round(next.d - distance))} m` : 'Recovery road · cool and recharge',
      frontier: this.source.frontier,
    };
  }

  dispose() {
    this.disposed = true;
    this.source.dispose();
    this.slabs.clear();
    this.obstacles.clear();
    this.chunks.length = 0;
    this.activePickups.clear();
    this.built.clear();
  }
}
