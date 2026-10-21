import { describe, it, expect, beforeAll } from 'vitest';
import { initPhysics } from '../src/game/simulation';
import { playCourse } from './bot';

/**
 * End-to-end proof that generated courses are completable with the car's real abilities:
 * an autopilot plays the full physics simulation with ordinary controls (thrust, roll,
 * suction, steering) along the generator's guaranteed route, through the intro and far past
 * the point where difficulty is maxed out (~4.5 km).
 */
describe('generated courses are completable', () => {
  beforeAll(async () => {
    await initPhysics();
  });

  const seeds = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];
  for (const seed of seeds) {
    it(`seed ${seed}: autopilot reaches 6 km`, () => {
      const r = playCourse(seed, 6000, 400);
      if (r.failedAt) console.log(r.failedAt, '\n' + r.log.slice(-10).join('\n'));
      expect(r.failedAt).toBeNull();
      expect(r.distance).toBeGreaterThanOrEqual(6000);
      expect(r.pickups).toBeGreaterThan(5); // fuel pickups were reachable and needed
    }, 60000);
  }
});
