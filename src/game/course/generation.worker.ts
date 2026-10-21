import { initPhysics } from '../simulation';
import { ReachableCourseGenerator } from './routeGenerator';
import type { GeneratorRequest, GeneratorResponse } from './chunkSource';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<GeneratorRequest>) => void) | null;
  postMessage(message: GeneratorResponse): void;
};
let generator: ReachableCourseGenerator | null = null;
let target = 0, forgetBefore = 0, busy = false;
const ready = initPhysics();

worker.onmessage = async ({ data }) => {
  try {
    await ready;
    if (data.type === 'init') generator = new ReachableCourseGenerator(data.seed, data.options);
    else forgetBefore = Math.max(forgetBefore, data.forgetBefore);
    target = Math.max(target, data.until);
    if (busy || !generator) return;
    busy = true;
    while (generator.frontier < target) {
      const chunk = generator.next();
      // Input tapes belong exclusively to the validation world. Gameplay receives geometry,
      // reachable states and diagnostic samples, never a control sequence for the player.
      worker.postMessage({ type: 'chunk', chunk: {
        ...chunk, witness: { ...chunk.witness, controls: [], phaseIndices: [] },
      }, frontier: generator.frontier });
      generator.forgetBefore(forgetBefore);
    }
    worker.postMessage({ type: 'ready', frontier: generator.frontier });
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally { busy = false; }
};
