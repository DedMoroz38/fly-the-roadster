import * as THREE from 'three';
import { Rng } from '../../core/rng';

/** Pixel size of every block texture, as in the classic look. */
export const TEX = 16;

/** RGBA pixels, row 0 at the top of the image. */
export type Pixels = Uint8ClampedArray;
type RGB = [number, number, number];

const shade = ([r, g, b]: RGB, k: number): RGB => [r * k, g * k, b * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

class Canvas {
  readonly px: Pixels = new Uint8ClampedArray(TEX * TEX * 4);
  set(x: number, y: number, [r, g, b]: RGB, a = 255) {
    if (x < 0 || y < 0 || x >= TEX || y >= TEX) return;
    const o = (y * TEX + x) * 4;
    this.px[o] = r; this.px[o + 1] = g; this.px[o + 2] = b; this.px[o + 3] = a;
  }
  get(x: number, y: number): RGB {
    const o = (((y + TEX) % TEX) * TEX + ((x + TEX) % TEX)) * 4;
    return [this.px[o], this.px[o + 1], this.px[o + 2]];
  }
  fill(f: (x: number, y: number) => RGB | null) {
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
      const c = f(x, y);
      if (c) this.set(x, y, c);
    }
  }
  /** Multiplies every pixel by a random factor in [1 - amount, 1 + amount]. */
  noise(rng: Rng, amount: number) {
    this.fill((x, y) => shade(this.get(x, y), 1 - amount + rng.next() * amount * 2));
  }
}

/** Flat colour with per-pixel brightness variation: the base of most natural blocks. */
function speckled(rng: Rng, base: RGB, amount: number, specks: [RGB, number][] = []): Canvas {
  const c = new Canvas();
  c.fill(() => {
    for (const [colour, p] of specks) if (rng.chance(p)) return shade(colour, 0.9 + rng.next() * 0.2);
    return shade(base, 1 - amount + rng.next() * amount * 2);
  });
  return c;
}

/** Brick courses: `rows` courses of height h with mortar, alternate courses offset by half a brick. */
function bricks(rng: Rng, base: RGB, mortar: RGB, brickW: number, brickH: number, amount = 0.1): Canvas {
  const c = new Canvas();
  c.fill((x, y) => {
    const row = Math.floor(y / brickH);
    const bx = (x + (row % 2) * (brickW / 2)) % brickW;
    if (y % brickH === brickH - 1 || bx === brickW - 1) return shade(mortar, 0.9 + rng.next() * 0.2);
    // Top-left of each brick catches light, bottom-right falls into shadow.
    const edge = y % brickH === 0 || bx === 0 ? 1.12 : y % brickH === brickH - 2 || bx === brickW - 2 ? 0.88 : 1;
    return shade(base, edge * (1 - amount + rng.next() * amount * 2));
  });
  return c;
}

/** Square tiles with bevelled edges (polished stone, purpur, deepslate tiles). */
function tiles(rng: Rng, base: RGB, mortar: RGB, size: number, amount = 0.08): Canvas {
  const c = new Canvas();
  c.fill((x, y) => {
    const tx = x % size, ty = y % size;
    if (tx === size - 1 || ty === size - 1) return shade(mortar, 0.9 + rng.next() * 0.15);
    const edge = tx === 0 || ty === 0 ? 1.15 : tx === size - 2 || ty === size - 2 ? 0.85 : 1;
    return shade(base, edge * (1 - amount + rng.next() * amount * 2));
  });
  return c;
}

/** Irregular stones with dark seams, from nearest-seed cells (cobblestone, glowstone, gravel). */
function cells(rng: Rng, colours: RGB[], seam: RGB, count: number, seamWidth = 1): Canvas {
  const seeds = Array.from({ length: count }, () => ({ x: rng.next() * TEX, y: rng.next() * TEX, c: rng.pick(colours) }));
  const nearest = (x: number, y: number) => {
    let best = Infinity, second = Infinity, id = 0;
    seeds.forEach((s, i) => {
      // Wrap so the texture tiles seamlessly.
      const dx = Math.min(Math.abs(x - s.x), TEX - Math.abs(x - s.x)), dy = Math.min(Math.abs(y - s.y), TEX - Math.abs(y - s.y));
      const d = dx * dx + dy * dy;
      if (d < best) { second = best; best = d; id = i; } else if (d < second) second = d;
    });
    return { id, gap: Math.sqrt(second) - Math.sqrt(best) };
  };
  const c = new Canvas();
  c.fill((x, y) => {
    const { id, gap } = nearest(x + 0.5, y + 0.5);
    if (gap < seamWidth) return shade(seam, 0.85 + rng.next() * 0.3);
    const bright = gap < seamWidth + 1 ? 0.88 : 1.06;
    return shade(seeds[id].c, bright * (0.9 + rng.next() * 0.2));
  });
  return c;
}

const PALETTE = {
  stone: [125, 125, 125] as RGB,
  dirt: [134, 96, 67] as RGB,
  grass: [97, 156, 54] as RGB,
  bark: [104, 82, 49] as RGB,
  wood: [168, 135, 81] as RGB,
  leaves: [55, 120, 36] as RGB,
  obsidian: [21, 17, 32] as RGB,
};

/** Every block face texture, keyed by name. Each generator is seeded, so textures never change. */
const GENERATORS: Record<string, (rng: Rng) => Canvas> = {
  stone: rng => speckled(rng, PALETTE.stone, 0.12, [[[100, 100, 100], 0.12], [[146, 146, 146], 0.06]]),
  cobblestone: rng => cells(rng, [[122, 122, 122], [108, 108, 108], [140, 140, 140], [96, 96, 96]], [62, 62, 62], 9),
  dirt: rng => speckled(rng, PALETTE.dirt, 0.12, [[[110, 76, 52], 0.15], [[155, 115, 82], 0.07], [[90, 90, 90], 0.03]]),
  grass_top: rng => speckled(rng, PALETTE.grass, 0.16, [[[78, 130, 40], 0.18], [[118, 178, 70], 0.08]]),
  grass_side: rng => {
    const c = speckled(rng, PALETTE.dirt, 0.12, [[[110, 76, 52], 0.15], [[155, 115, 82], 0.07]]);
    const depth = Array.from({ length: TEX }, () => 2 + Math.floor(rng.next() * 3) + (rng.chance(0.25) ? 2 : 0));
    c.fill((x, y) => (y < depth[x] ? shade(PALETTE.grass, 0.82 + rng.next() * 0.3) : null));
    return c;
  },
  snow_side: rng => {
    const c = speckled(rng, PALETTE.dirt, 0.12, [[[110, 76, 52], 0.15]]);
    const depth = Array.from({ length: TEX }, () => 3 + Math.floor(rng.next() * 3));
    c.fill((x, y) => (y < depth[x] ? shade([238, 244, 250], 0.93 + rng.next() * 0.08) : null));
    return c;
  },
  snow: rng => speckled(rng, [238, 244, 250], 0.04, [[[214, 226, 238], 0.12]]),
  log_side: rng => {
    const c = new Canvas();
    const stripes = Array.from({ length: TEX }, () => 0.75 + rng.next() * 0.45);
    c.fill((x, y) => shade(PALETTE.bark, stripes[x] * (0.92 + rng.next() * 0.16) * (rng.chance(0.06) && y > 0 ? 0.7 : 1)));
    return c;
  },
  log_top: rng => {
    const c = new Canvas();
    c.fill((x, y) => {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (r > 6.5) return shade(PALETTE.bark, 0.9 + rng.next() * 0.2);
      const ring = Math.floor(r) % 2 === 0 ? 1 : 0.82;
      return shade([182, 146, 90], ring * (0.94 + rng.next() * 0.12));
    });
    return c;
  },
  planks: rng => {
    const c = new Canvas();
    const seams = [0, 4, 8, 12].map(() => Math.floor(rng.next() * TEX));
    c.fill((x, y) => {
      const board = Math.floor(y / 4);
      if (y % 4 === 3) return shade(PALETTE.wood, 0.62);
      if (x === seams[board]) return shade(PALETTE.wood, 0.7);
      return shade(PALETTE.wood, (board % 2 ? 0.95 : 1.02) * (0.93 + rng.next() * 0.12));
    });
    return c;
  },
  dark_planks: rng => {
    const c = new Canvas();
    c.fill((_x, y) => (y % 4 === 3 ? [44, 28, 16] : shade([72, 48, 26], 0.9 + rng.next() * 0.2)));
    return c;
  },
  leaves: rng => {
    const c = new Canvas();
    // Cut-out holes (alpha 0) let light through like the fancy leaves look.
    c.fill(() => (rng.chance(0.14) ? null : shade(PALETTE.leaves, 0.65 + rng.next() * 0.6)));
    return c;
  },
  vines: rng => {
    const c = new Canvas();
    c.fill((x, y) => ((x * 7 + y * 3) % 5 === 0 || rng.chance(0.35) ? shade([62, 132, 40], 0.7 + rng.next() * 0.5) : null));
    return c;
  },
  stone_bricks: rng => bricks(rng, [124, 124, 124], [78, 78, 78], 8, 8),
  mossy_bricks: rng => {
    const c = bricks(rng, [118, 120, 112], [74, 74, 70], 8, 8);
    c.fill(() => (rng.chance(0.22) ? shade([82, 118, 52], 0.85 + rng.next() * 0.3) : null));
    return c;
  },
  deepslate_tiles: rng => tiles(rng, [74, 76, 86], [38, 38, 46], 8, 0.1),
  polished_stone: rng => tiles(rng, [150, 152, 160], [104, 104, 112], 16, 0.05),
  purpur: rng => tiles(rng, [168, 122, 170], [114, 78, 118], 8, 0.08),
  prismarine: rng => bricks(rng, [86, 168, 150], [44, 100, 92], 8, 8, 0.12),
  terracotta: rng => bricks(rng, [194, 104, 46], [130, 64, 30], 16, 4, 0.08),
  obsidian: rng => speckled(rng, PALETTE.obsidian, 0.15, [[[54, 36, 86], 0.14], [[92, 70, 132], 0.04]]),
  crying_obsidian: rng => speckled(rng, PALETTE.obsidian, 0.15, [[[112, 42, 214], 0.13], [[190, 110, 255], 0.06], [[54, 36, 86], 0.1]]),
  glowstone: rng => cells(rng, [[252, 214, 120], [232, 176, 80], [255, 236, 170], [214, 150, 62]], [128, 82, 36], 11),
  sea_lantern: rng => {
    const c = new Canvas();
    c.fill((x, y) => {
      const cross = x === 7 || x === 8 || y === 7 || y === 8 || x === y || x === 15 - y;
      const frame = x === 0 || y === 0 || x === 15 || y === 15;
      return shade(frame ? [118, 160, 158] : cross ? [236, 255, 252] : [176, 214, 206], 0.94 + rng.next() * 0.1);
    });
    return c;
  },
  amethyst: rng => cells(rng, [[150, 92, 220], [196, 140, 255], [120, 70, 190]], [70, 40, 120], 8),
  emerald: rng => {
    const c = new Canvas();
    c.fill((x, y) => {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      const band = r > 6.5 ? 0.7 : r > 4.5 ? 1.15 : r > 2.5 ? 0.92 : 1.3;
      return shade([40, 196, 92], band * (0.94 + rng.next() * 0.12));
    });
    return c;
  },
  tnt_side: rng => {
    const c = new Canvas();
    // Red casing with a white label band and pixel "TNT" lettering, as on the classic block.
    const glyphs = ['111 1  1 111', ' 1  11 1  1 ', ' 1  1 11  1 ', ' 1  1  1  1 '];
    c.fill((x, y) => {
      if (y >= 5 && y <= 10) {
        const gx = x - 2, gy = y - 6;
        if (gy >= 0 && gy < glyphs.length && gx >= 0 && gx < glyphs[0].length && glyphs[gy][gx] === '1') return [40, 40, 40];
        return shade([236, 236, 236], 0.94 + rng.next() * 0.08);
      }
      const stripe = x % 4 === 0 ? 0.8 : 1;
      return shade([214, 56, 32], stripe * (0.9 + rng.next() * 0.16));
    });
    return c;
  },
  tnt_top: rng => {
    const c = new Canvas();
    c.fill((x, y) => {
      const r = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (r < 1.6) return [70, 70, 70];
      return shade(r < 3 ? [226, 226, 226] : [214, 56, 32], 0.9 + rng.next() * 0.16);
    });
    return c;
  },
  water: rng => {
    const c = new Canvas();
    c.fill((x, y) => {
      const wave = Math.sin((y + Math.sin(x * 0.8) * 1.6) * 0.9);
      return shade(mix([46, 98, 214], [110, 170, 255], (wave + 1) / 2), 0.9 + rng.next() * 0.14);
    });
    return c;
  },
  lantern: rng => {
    const c = new Canvas();
    c.fill((x, y) => {
      const frame = x < 3 || x > 12 || y < 2 || y > 13 || (y === 7 && (x < 5 || x > 10));
      if (frame) return shade([52, 52, 62], 0.9 + rng.next() * 0.2);
      return shade([255, 196, 92], 0.9 + rng.next() * 0.2);
    });
    return c;
  },
  window_lit: rng => {
    const c = new Canvas();
    c.fill((x, y) => (x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || y === 7
      ? [74, 50, 28] : shade([255, 198, 110], 0.86 + rng.next() * 0.2)));
    return c;
  },
  coal_ore: rng => {
    const c = speckled(rng, PALETTE.stone, 0.12, [[[100, 100, 100], 0.1]]);
    for (let i = 0; i < 4; i++) {
      const cx = rng.int(2, 13), cy = rng.int(2, 13);
      for (let k = 0; k < 4; k++) c.set(cx + (k % 2), cy + (k >> 1), shade([34, 34, 34], 0.9 + rng.next() * 0.3));
    }
    return c;
  },
  cloud: () => {
    const c = new Canvas();
    c.fill(() => [248, 250, 255]);
    return c;
  },
  // Mob skins: 16×16 faces drawn on an 8×8 grid of 2-pixel cells.
  creeper_skin: rng => speckled(rng, [92, 168, 70], 0.14, [[[58, 120, 44], 0.2], [[150, 210, 120], 0.1], [[40, 60, 36], 0.03]]),
  creeper_face: rng => {
    const c = speckled(rng, [92, 168, 70], 0.14, [[[58, 120, 44], 0.2], [[150, 210, 120], 0.1]]);
    const cell = (cx: number, cy: number) => { for (let k = 0; k < 4; k++) c.set(cx * 2 + (k % 2), cy * 2 + (k >> 1), [18, 18, 18]); };
    for (const [x, y] of [[1, 2], [2, 2], [1, 3], [2, 3], [5, 2], [6, 2], [5, 3], [6, 3], [3, 4], [4, 4], [2, 5], [3, 5], [4, 5], [5, 5], [2, 6], [5, 6], [2, 7], [5, 7]]) cell(x, y);
    return c;
  },
  zombie_skin: rng => speckled(rng, [86, 140, 74], 0.12, [[[64, 112, 56], 0.15]]),
  zombie_face: rng => {
    const c = speckled(rng, [86, 140, 74], 0.12, [[[64, 112, 56], 0.15]]);
    for (let x = 2; x < 6; x++) c.set(x, 8, [30, 30, 30]);
    for (let x = 10; x < 14; x++) c.set(x, 8, [30, 30, 30]);
    for (let x = 4; x < 12; x++) c.set(x, 12, [50, 70, 46]);
    return c;
  },
  shirt: rng => speckled(rng, [0, 166, 168], 0.12, [[[0, 128, 130], 0.12]]),
  pants: rng => speckled(rng, [64, 62, 164], 0.12, [[[48, 46, 130], 0.12]]),
  bone: rng => speckled(rng, [206, 206, 200], 0.08, [[[170, 170, 166], 0.12]]),
  skull_face: rng => {
    const c = speckled(rng, [206, 206, 200], 0.08, [[[170, 170, 166], 0.12]]);
    for (const [x0, y0] of [[2, 6], [10, 6]]) for (let k = 0; k < 16; k++) c.set(x0 + (k % 4), y0 + (k >> 2), [34, 34, 34]);
    for (let x = 4; x < 12; x++) c.set(x, 13, [60, 60, 60]);
    return c;
  },
  spider: rng => speckled(rng, [52, 42, 38], 0.15, [[[30, 24, 22], 0.2], [[74, 60, 52], 0.08]]),
  spider_face: rng => {
    const c = speckled(rng, [52, 42, 38], 0.15, [[[30, 24, 22], 0.2]]);
    for (const [x, y] of [[3, 6], [4, 6], [11, 6], [12, 6], [6, 4], [9, 4], [5, 8], [10, 8]]) c.set(x, y, [230, 30, 30]);
    return c;
  },
  ghast: rng => speckled(rng, [240, 240, 240], 0.04, [[[214, 214, 218], 0.12]]),
  ghast_face: rng => {
    const c = speckled(rng, [240, 240, 240], 0.04, [[[214, 214, 218], 0.12]]);
    for (let x = 2; x < 6; x++) c.set(x, 6, [90, 90, 96]);
    for (let x = 10; x < 14; x++) c.set(x, 6, [90, 90, 96]);
    for (let k = 0; k < 16; k++) c.set(6 + (k % 4), 10 + (k >> 2), [70, 70, 76]);
    return c;
  },
};

export type BlockTexture = keyof typeof GENERATORS;
export const TEXTURE_NAMES = Object.keys(GENERATORS) as BlockTexture[];

const pixelsCache = new Map<string, Pixels>();
/** Deterministic pixels for one texture (row 0 at the top). */
export function texturePixels(name: BlockTexture): Pixels {
  let px = pixelsCache.get(name);
  if (!px) {
    let seed = 7;
    for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    px = GENERATORS[name](new Rng(seed)).px;
    pixelsCache.set(name, px);
  }
  return px;
}

/** Flips rows into GL order (row 0 at the bottom), since DataTexture does not flip. */
function toTexture(px: Pixels, width: number, height: number): THREE.DataTexture {
  const flipped = new Uint8Array(px.length);
  for (let y = 0; y < height; y++) flipped.set(px.subarray(y * width * 4, (y + 1) * width * 4), (height - 1 - y) * width * 4);
  const texture = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const textureCache = new Map<string, THREE.DataTexture>();
/** A repeating texture for one block, for track pieces mapped in world space. */
export function blockTexture(name: BlockTexture): THREE.DataTexture {
  let texture = textureCache.get(name);
  if (!texture) {
    texture = toTexture(texturePixels(name), TEX, TEX);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    textureCache.set(name, texture);
  }
  return texture;
}

export interface Atlas { texture: THREE.DataTexture; columns: number; rows: number; index: Record<string, number> }
let atlas: Atlas | null = null;
/** All block textures in one image, so a whole voxel tile renders with a single material. */
export function blockAtlas(): Atlas {
  if (atlas) return atlas;
  const columns = 8, rows = Math.ceil(TEXTURE_NAMES.length / columns);
  const width = columns * TEX, height = rows * TEX;
  const px = new Uint8ClampedArray(width * height * 4);
  const index: Record<string, number> = {};
  TEXTURE_NAMES.forEach((name, i) => {
    index[name] = i;
    const src = texturePixels(name), col = i % columns, row = Math.floor(i / columns);
    for (let y = 0; y < TEX; y++) px.set(src.subarray(y * TEX * 4, (y + 1) * TEX * 4), ((row * TEX + y) * width + col * TEX) * 4);
  });
  atlas = { texture: toTexture(px, width, height), columns, rows, index };
  return atlas;
}

/** UV rectangle [u0, v0, u1, v1] of a texture inside the atlas, inset to avoid bleeding. */
export function atlasRect(name: BlockTexture): [number, number, number, number] {
  const { columns, rows, index } = blockAtlas();
  const i = index[name], col = i % columns, row = Math.floor(i / columns);
  const inset = 0.02 / TEX;
  const u0 = col / columns + inset, u1 = (col + 1) / columns - inset;
  // Image row 0 is the top, GL v = 1 is the top.
  const v1 = 1 - row / rows - inset, v0 = 1 - (row + 1) / rows + inset;
  return [u0, v0, u1, v1];
}
