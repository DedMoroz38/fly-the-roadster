import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config';
import { obstacleKind } from '../src/render/trackStyle';
import { vehicleWorld, VEHICLES } from '../src/render/vehicles';
import { WORLDS } from '../src/render/worlds';
import { buildIslandTile, ISLAND_CONFIG } from '../src/render/voxel/islands';
import { B, meshVolume, Volume } from '../src/render/voxel/mesher';
import { buildMountainTile, MOUNTAIN_CONFIG } from '../src/render/voxel/mountains';
import { ParallaxLayer, sceneryPosition, tileWorldZ } from '../src/render/parallax';
import { atlasRect, TEX, TEXTURE_NAMES, texturePixels } from '../src/render/voxel/textures';
import { VOXEL_SURFACES } from '../src/render/voxel/trackStyle';

const triangles = (g: THREE.BufferGeometry | null) => (g ? g.index!.count / 3 : 0);

describe('pixel block textures', () => {
  it('generates every texture as deterministic 16×16 RGBA and packs it inside the atlas', () => {
    for (const name of TEXTURE_NAMES) {
      const px = texturePixels(name);
      expect(px.length).toBe(TEX * TEX * 4);
      expect(texturePixels(name)).toBe(px);
      const [u0, v0, u1, v1] = atlasRect(name);
      for (const v of [u0, v0, u1, v1]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      expect(u1).toBeGreaterThan(u0);
      expect(v1).toBeGreaterThan(v0);
    }
    // Leaves are cut out; stone is fully opaque.
    const alpha = (name: 'leaves' | 'stone') => [...texturePixels(name)].filter((_, i) => i % 4 === 3);
    expect(alpha('leaves').some(a => a === 0)).toBe(true);
    expect(alpha('stone').every(a => a === 255)).toBe(true);
  });
});

describe('voxel mesher', () => {
  const mesh = (v: Volume) => meshVolume(v, { blockSize: 1, origin: [0, 0, 0] });

  it('emits only faces next to air', () => {
    const one = new Volume(3, 3, 3);
    one.set(1, 1, 1, B.stone);
    expect(triangles(mesh(one))).toBe(12);
    const two = new Volume(3, 3, 3);
    two.set(0, 1, 1, B.stone); two.set(1, 1, 1, B.stone);
    expect(triangles(mesh(two))).toBe(20);
    expect(mesh(new Volume(2, 2, 2))).toBeNull();
  });

  it('keeps faces behind see-through leaves and darkens corners with ambient occlusion', () => {
    const v = new Volume(3, 3, 3);
    v.set(1, 0, 1, B.stone); v.set(1, 1, 1, B.leaves);
    // Stone keeps its top face under the leaves; the leaves' underside rests on opaque stone and is hidden.
    expect(triangles(mesh(v))).toBe(22);
    const floor = new Volume(3, 2, 3);
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) floor.set(x, 0, z, B.stone);
    floor.set(0, 1, 0, B.stone); // a block standing in one corner shades its neighbours' tops
    const colors = mesh(floor)!.getAttribute('color');
    const brightness = Array.from({ length: colors.count }, (_, i) => colors.getX(i));
    expect(Math.min(...brightness)).toBeLessThan(Math.max(...brightness) * 0.75);
  });

  it('draws light sources brighter than white so only they bloom', () => {
    const v = new Volume(1, 1, 1);
    v.set(0, 0, 0, B.glowstone);
    const colors = mesh(v)!.getAttribute('color');
    for (let i = 0; i < colors.count; i++) expect(colors.getX(i)).toBeGreaterThan(1);
  });
});

describe('floating island scenery', () => {
  it('builds the same tile for the same seed and index, and different tiles otherwise', () => {
    const a = buildIslandTile(42, 3), b = buildIslandTile(42, 3), c = buildIslandTile(42, 4);
    expect(triangles(a.blocks)).toBe(triangles(b.blocks));
    expect(a.mobs).toEqual(b.mobs);
    expect(triangles(a.blocks)).not.toBe(triangles(c.blocks));
    for (const t of [a, b, c]) for (const g of [t.blocks, t.clouds]) g?.dispose();
  });

  it('keeps every island clear of the corridor and inside its tile, with waterfalls facing the track', () => {
    for (let index = 0; index < 6; index++) {
      const tile = buildIslandTile(7, index);
      const pos = tile.blocks!.getAttribute('position');
      let nearest = Infinity;
      for (let i = 0; i < pos.count; i++) nearest = Math.min(nearest, Math.abs(pos.getX(i)));
      // Rims and trees may poke a little past the nominal radius, never into the clearance band.
      expect(nearest).toBeGreaterThan(CONFIG.corridor.halfWidth + ISLAND_CONFIG.clearance * 0.5);
      for (const fall of tile.waterfalls) {
        expect(Math.sign(fall.facing)).toBe(-Math.sign(fall.x));
        expect(fall.top).toBeGreaterThan(fall.bottom);
      }
      for (const mob of [...tile.mobs, ...tile.ghasts]) {
        expect(mob.s).toBeGreaterThanOrEqual(-ISLAND_CONFIG.tileLength * 0.2);
        expect(mob.s).toBeLessThanOrEqual(ISLAND_CONFIG.tileLength * 1.2);
      }
      tile.blocks?.dispose(); tile.clouds?.dispose();
    }
  });

  it('places mountain ranges far out on both sides within their tile', () => {
    const geometry = buildMountainTile(42, 2)!;
    geometry.computeBoundingBox();
    const pos = geometry.getAttribute('position');
    let left = false, right = false;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      expect(Math.abs(x)).toBeGreaterThanOrEqual(MOUNTAIN_CONFIG.inner * MOUNTAIN_CONFIG.blockSize - 1e-6);
      expect(z).toBeLessThanOrEqual(1e-6);
      expect(z).toBeGreaterThanOrEqual(-MOUNTAIN_CONFIG.tileLength - 1e-6);
      left ||= x < 0; right ||= x > 0;
    }
    expect(left && right).toBe(true);
    geometry.dispose();
  });
});

describe('parallax scrolling', () => {
  it('moves scenery past the camera at its fraction of the camera speed', () => {
    const speed = 0.1, length = 100;
    // An object 50 m into tile 3 (scenery coordinate 350), seen from two camera positions 200 m apart.
    const depth = (cameraZ: number, cameraDistance: number) => cameraZ - (tileWorldZ(cameraZ, 3, length, sceneryPosition(cameraDistance, speed)) - 50);
    const before = depth(0, 1000), after = depth(-200, 1200);
    expect(before).toBeCloseTo(350 - 100, 9);
    expect(before - after).toBeCloseTo(200 * speed, 9);
  });

  it('streams tiles around the camera: near gaps fill at once, far-edge tiles one per frame', () => {
    const built: number[] = [];
    const layer = new ParallaxLayer({ speed: 0.1, tileLength: 100, ahead: 400, behind: 100,
      build: index => { built.push(index); return { object: new THREE.Group(), dispose: () => {} }; } });
    // First frame: tiles up to 60% of the view at once, then one far tile.
    layer.update(0, 0, 0);
    expect(built).toEqual([-1, 0, 1, 2, 3]);
    layer.update(0, 0, 0);
    expect(layer.tileCount).toBe(6);
    // Ordinary travel adds one tile at the far edge per frame.
    layer.update(0, 1000, 0);
    expect(built.at(-1)).toBe(5);
    expect(layer.tileCount).toBe(6);
    // A restart jumps back: the dropped tile behind the camera returns on the very first frame.
    layer.update(0, 0, 0);
    expect(built.filter(b => b === -1)).toHaveLength(2);
    expect(layer.tileCount).toBe(6);
    layer.dispose();
  });
});

describe('Steve’s voxel world', () => {
  it('belongs to Steve; vehicles without a world of their own keep the neon grid', () => {
    const own: Record<string, string> = { steve: 'voxel', cybertruck: 'mars', roadster: 'orbit', dino: 'dino' };
    for (const vehicle of VEHICLES) expect(vehicleWorld(vehicle.id)).toBe(own[vehicle.id] ?? 'neon');
    expect(WORLDS.voxel.surfaces).toBe(VOXEL_SURFACES);
  });

  it('classifies hazards into blocks, gates and barriers for their looks', () => {
    const { halfWidth } = CONFIG.corridor;
    expect(obstacleKind({ y: 0.5, half: { x: halfWidth, y: 0.5 } })).toBe('barrier');
    expect(obstacleKind({ y: 0.7, half: { x: 2.1, y: 0.7 } })).toBe('gate');
    expect(obstacleKind({ y: 0.7, half: { x: 0.8, y: 0.7 } })).toBe('block');
    // Wall and ceiling hazards are blocks too.
    expect(obstacleKind({ y: 4, half: { x: 0.7, y: 0.8 } })).toBe('block');
  });

});

