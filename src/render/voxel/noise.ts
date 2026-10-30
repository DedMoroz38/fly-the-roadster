/** Seeded 2D value noise in [0, 1], smooth between integer lattice points. */
export function valueNoise(seed: number) {
  const hash = (x: number, y: number) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Fractal sum of value-noise octaves, normalised back to [0, 1]. */
export function fbm(seed: number, octaves = 4) {
  const layers = Array.from({ length: octaves }, (_, i) => valueNoise(seed + i * 7919));
  return (x: number, y: number) => {
    let sum = 0, amplitude = 1, total = 0, frequency = 1;
    for (const noise of layers) {
      sum += noise(x * frequency, y * frequency) * amplitude;
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / total;
  };
}
