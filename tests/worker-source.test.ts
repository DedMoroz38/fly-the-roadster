import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeneratorResponse } from '../src/game/course/chunkSource';
import type { GeneratedChunk } from '../src/game/course/routeGenerator';
import { WorkerChunkSource } from '../src/game/course/workerSource';
import { GENERATOR_CONFIG } from '../src/game/course/generatorConfig';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<GeneratorResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { MockWorker.instances.push(this); }
  send(data: GeneratorResponse) { this.onmessage?.({ data } as MessageEvent<GeneratorResponse>); }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent); }
}

// The transport treats chunk contents as opaque. Geometry validation belongs
// to the planner tests; these fixtures exercise queue identity and boundaries.
const chunk = (id: number, d0: number, d1: number) => ({ id, d0, d1 } as GeneratedChunk);
const sources: WorkerChunkSource[] = [];
const createSource = () => {
  const source = new WorkerChunkSource(42, { template: 'gap' });
  sources.push(source);
  return source;
};

beforeEach(() => {
  MockWorker.instances = [];
  vi.stubGlobal('Worker', MockWorker);
});
afterEach(() => {
  sources.splice(0).forEach(source => source.dispose());
  vi.unstubAllGlobals();
});

describe('terrain worker lifecycle', () => {
  it('settles initial loading on cancellation and ignores late events after one termination', async () => {
    const source = createSource();
    const worker = MockWorker.instances[0];
    const lateMessage = worker.onmessage!;
    const lateError = worker.onerror!;
    const ready = vi.fn();
    void source.ready.then(ready);
    source.dispose();
    await source.ready;
    source.dispose();
    source.request(GENERATOR_CONFIG.generateAhead + 500, 100);
    lateMessage({ data: { type: 'chunk', chunk: chunk(0, 0, 400), frontier: 400 } } as MessageEvent<GeneratorResponse>);
    lateError({ message: 'stale failure' } as ErrorEvent);
    expect(ready).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(source.error).toBeNull();
    expect(source.frontier).toBe(0);
    expect(source.drain()).toEqual([]);
  });

  it('rejects initial worker failure and records a later failure after readiness', async () => {
    const failed = createSource();
    const rejection = expect(failed.ready).rejects.toThrow('cannot initialize');
    MockWorker.instances[0].fail('cannot initialize');
    await rejection;
    expect(failed.error).toBe('cannot initialize');

    const source = createSource();
    const worker = MockWorker.instances[1];
    worker.send({ type: 'ready', frontier: 1800 });
    await source.ready;
    worker.send({ type: 'error', message: 'validation failed' });
    expect(source.error).toBe('validation failed');
    source.request(3000, 500);
    expect(worker.postMessage).toHaveBeenCalledOnce();
  });

  it('restarts immediately from bounded bootstrap and suppresses regenerated duplicates', async () => {
    const source = createSource();
    const worker = MockWorker.instances[0];
    const span = GENERATOR_CONFIG.generateAhead / 4;
    const initial = Array.from({ length: 5 }, (_, id) => chunk(id, id * span, (id + 1) * span));
    const far = initial[4];
    for (const value of initial) worker.send({ type: 'chunk', chunk: value, frontier: value.d1 });
    worker.send({ type: 'ready', frontier: far.d1 });
    await source.ready;
    expect(source.drain()).toEqual(initial);
    source.dispose();

    const restarted = source.restartSource();
    sources.push(restarted);
    const freshWorker = MockWorker.instances[1];
    await restarted.ready;
    expect(restarted.drain()).toEqual(initial.slice(0, 4));
    expect(freshWorker.postMessage).toHaveBeenCalledWith({ type: 'init', seed: 42, options: { template: 'gap' }, until: GENERATOR_CONFIG.generateAhead });
    for (const value of initial.slice(0, 4)) freshWorker.send({ type: 'chunk', chunk: value, frontier: value.d1 });
    expect(restarted.drain()).toEqual([]);
    freshWorker.send({ type: 'chunk', chunk: far, frontier: far.d1 });
    expect(restarted.drain()).toEqual([far]);
    expect(restarted.frontier).toBe(far.d1);
    restarted.dispose();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(freshWorker.terminate).toHaveBeenCalledOnce();
  });
});
