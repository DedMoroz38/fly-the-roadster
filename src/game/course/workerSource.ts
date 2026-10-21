import type { ChunkSource, GeneratorRequest, GeneratorResponse } from './chunkSource';
import { GENERATOR_CONFIG } from './generatorConfig';
import type { GeneratedChunk, GeneratorOptions } from './routeGenerator';

/** Bounded ahead-of-player queue. Its worker owns all expensive physical validation. */
export class WorkerChunkSource implements ChunkSource {
  frontier = 0;
  error: string | null = null;
  private worker: Worker;
  private pending: GeneratedChunk[];
  private requested = 0;
  private disposed = false;
  private seenThrough = -1;
  private bootstrap: GeneratedChunk[] = [];
  private resolveReady: (() => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  readonly ready: Promise<void>;

  constructor(readonly seed: number, readonly options: GeneratorOptions = {}, initial: GeneratedChunk[] = []) {
    this.pending = [...initial];
    this.bootstrap = [...initial];
    this.frontier = initial.at(-1)?.d1 ?? 0;
    this.seenThrough = initial.at(-1)?.id ?? -1;
    this.worker = new Worker(new URL('./generation.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
      if (initial.length) this.settleReady();
      const fail = (message: string) => {
        if (this.disposed) return;
        this.error = message;
        this.settleReady(new Error(message));
      };
      this.worker.onerror = event => fail(event.message || 'Terrain worker failed');
      this.worker.onmessage = ({ data }: MessageEvent<GeneratorResponse>) => {
        if (this.disposed) return;
        if (data.type === 'error') { fail(data.message); return; }
        this.frontier = Math.max(this.frontier, data.frontier);
        if (data.type === 'chunk' && data.chunk.id > this.seenThrough) {
          this.seenThrough = data.chunk.id;
          this.pending.push(data.chunk);
          if (data.chunk.d0 < GENERATOR_CONFIG.generateAhead) this.bootstrap.push(data.chunk);
        }
        if (data.type === 'ready') this.settleReady();
      };
    });
    this.requested = GENERATOR_CONFIG.generateAhead;
    this.post({ type: 'init', seed, options, until: this.requested });
  }

  private settleReady(error?: Error) {
    const resolve = this.resolveReady, reject = this.rejectReady;
    this.resolveReady = null;
    this.rejectReady = null;
    if (error) reject?.(error);
    else resolve?.();
  }

  private post(message: GeneratorRequest) { if (!this.disposed) this.worker.postMessage(message); }
  request(until: number, forgetBefore: number) {
    if (this.disposed || until <= this.requested + 100 || this.error) return;
    this.requested = until;
    this.post({ type: 'advance', until, forgetBefore });
  }
  drain() { const result = this.pending; this.pending = []; return result; }
  /** Restart immediately from the bounded bootstrap; a fresh worker continues that same seed. */
  restartSource() { return new WorkerChunkSource(this.seed, this.options, this.bootstrap); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.pending = [];
    // Cancellation is not a loading failure. Game.start checks its disposed
    // flag immediately after awaiting ready, so let that continuation finish.
    this.settleReady();
  }
}
