export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Moves `current` toward `target` by at most `maxDelta`. */
export const approach = (current: number, target: number, maxDelta: number) =>
  current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target);
/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  a = a % TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  return a;
}
/** Frame-rate independent exponential smoothing factor. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);
