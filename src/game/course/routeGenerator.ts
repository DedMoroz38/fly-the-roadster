import { hashSeed, Rng } from '../../core/rng';
import { difficultyAt, GENERATOR_CONFIG } from './generatorConfig';
import { decorateChunk } from './decorator';
import { initialReachableState, planChunk, PlannedChunk, ReachableState, ScenarioKind } from './planner';

export const SCENARIOS: readonly ScenarioKind[] = ['normal', 'gap', 'ceiling', 'wall-left', 'wall-right', 'multiple', 'flight'];

export interface GeneratorOptions {
  /** Force a procedural challenge family for reproduction; parameters remain seeded. */
  template?: ScenarioKind;
}

export interface GenerationRecord {
  requested: ScenarioKind;
  attempts: number;
  fallback: boolean;
  rejectedReasons: string[];
}

export type GeneratedChunk = PlannedChunk & { generation: GenerationRecord };

/**
 * Construct a movement plan, validate it, then publish its geometry. The exit state returned
 * by the physical witness becomes the next entry, including momentum, fuel and heat.
 * This class never reads or writes the player's controls. Browser generation runs in a worker.
 */
export class ReachableCourseGenerator {
  readonly chunks: GeneratedChunk[] = [];
  frontier = 0;
  private nextId = 0;
  private exitState: ReachableState = initialReachableState();

  constructor(readonly seed: number, readonly options: GeneratorOptions = {}) {}

  private chooseKind(rng: Rng, difficulty: number): ScenarioKind {
    if (this.options.template) return this.options.template;
    if (this.nextId % GENERATOR_CONFIG.recoveryEvery === 0) return 'normal';
    // Introduce two challenges after the warmup before allowing optional extra recovery.
    if (rng.chance(GENERATOR_CONFIG.easySectionChance) && this.nextId > GENERATOR_CONFIG.openingChallengeChunks) return 'normal';
    const weighted: [ScenarioKind, number][] = [
      // Surface challenges dominate; short floor gaps fade out as difficulty rises.
      ['gap', 1.4 - difficulty * 0.6],
      ['ceiling', 1.1 + difficulty],
      ['wall-left', 1.1 + difficulty],
      ['wall-right', 1.1 + difficulty],
      ['flight', 0.6 + difficulty],
      ['multiple', 0.6 + difficulty * 2.5],
    ];
    let choice = rng.next() * weighted.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [kind, weight] of weighted) if ((choice -= weight) <= 0) return kind;
    return 'gap';
  }

  next(): GeneratedChunk {
    const chunkSeed = hashSeed(`${this.seed >>> 0}:${this.nextId}`);
    const difficulty = difficultyAt(this.frontier);
    const kind = this.chooseKind(new Rng(chunkSeed), difficulty);
    const rejectedReasons: string[] = [];
    let accepted: PlannedChunk | null = null;
    let attempts = 0;
    for (; attempts < GENERATOR_CONFIG.candidateAttempts; attempts++) {
      const candidate = planChunk({
        id: this.nextId, seed: hashSeed(`${chunkSeed}:${attempts}`), d0: this.frontier,
        kind, difficulty, entry: { ...this.exitState },
        intro: this.nextId === 0 && !this.options.template,
      });
      if (candidate.validation.accepted) { accepted = candidate; attempts++; break; }
      rejectedReasons.push(...candidate.validation.reasons);
    }
    const fallback = accepted === null;
    if (!accepted) {
      accepted = planChunk({
        id: this.nextId, seed: chunkSeed, d0: this.frontier,
        kind: 'normal', difficulty: 0, entry: { ...this.exitState },
      });
      // A broken movement configuration must be reported, never silently certified as safe.
      if (!accepted.validation.accepted) throw new Error(`Recovery route rejected: ${accepted.validation.reasons.join('; ')}`);
    }
    accepted = decorateChunk(accepted);
    if (!(accepted.d1 > this.frontier)) throw new Error('Route generator failed to advance');
    const chunk: GeneratedChunk = {
      ...accepted,
      generation: { requested: kind, attempts, fallback, rejectedReasons: [...new Set(rejectedReasons)] },
    };
    this.exitState = { ...chunk.exit };
    this.frontier = chunk.d1;
    this.nextId++;
    this.chunks.push(chunk);
    return chunk;
  }

  generateUntil(distance: number): GeneratedChunk[] {
    const added: GeneratedChunk[] = [];
    while (this.frontier < distance) added.push(this.next());
    return added;
  }

  /** Keep the last exit independently so pruning cannot change future seeded output. */
  forgetBefore(distance: number) {
    while (this.chunks.length > 0 && this.chunks[0].d1 < distance) this.chunks.shift();
  }
}
