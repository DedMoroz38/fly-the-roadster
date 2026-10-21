import { GeneratedChunk, GeneratorOptions, ReachableCourseGenerator } from './routeGenerator';

export interface ChunkSource {
  frontier: number;
  error: string | null;
  request(until: number, forgetBefore: number): void;
  drain(): GeneratedChunk[];
  dispose(): void;
}

/** Headless/testing source. Browser gameplay uses WorkerChunkSource. */
export class SynchronousChunkSource implements ChunkSource {
  readonly generator: ReachableCourseGenerator;
  error: string | null = null;
  private pending: GeneratedChunk[] = [];
  get frontier() { return this.generator.frontier; }
  constructor(seed: number, options: GeneratorOptions = {}) {
    this.generator = new ReachableCourseGenerator(seed, options);
  }
  request(until: number, forgetBefore: number) {
    this.pending.push(...this.generator.generateUntil(until));
    this.generator.forgetBefore(forgetBefore);
  }
  drain() { const result = this.pending; this.pending = []; return result; }
  dispose() { this.pending = []; this.generator.chunks.length = 0; }
}

export type GeneratorRequest =
  | { type: 'init'; seed: number; options: GeneratorOptions; until: number }
  | { type: 'advance'; until: number; forgetBefore: number };
export type GeneratorResponse =
  | { type: 'chunk'; chunk: GeneratedChunk; frontier: number }
  | { type: 'ready'; frontier: number }
  | { type: 'error'; message: string };
