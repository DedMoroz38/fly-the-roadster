import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config';
import { vehicleWorld } from '../src/render/vehicles';
import { WORLDS } from '../src/render/worlds';
import { DINO_DAY, DinoTheme, nightAt } from '../src/render/dino/theme';
import { DINO_SURFACES, dinoObstacles, dinoPickups } from '../src/render/dino/trackStyle';
import { GRAVES, MONUMENTS } from '../src/render/dino/props';
import { DINO_SCENERY, middleTile, monumentTile, planMiddle, planMonument, planRoadside, roadsideTile, ROADSIDE_MIN_X, skyTile } from '../src/render/dino/scenery';
import { ToneMaterials } from '../src/render/dino/pixels';

const W = CONFIG.corridor.halfWidth;

describe('dino world registry', () => {
  it('is the Chrome Dino world and supplies every track style', () => {
    expect(vehicleWorld('dino')).toBe('dino');
    expect(WORLDS.dino.id).toBe('dino');
    const origin = { value: 0 };
    for (const surface of ['floor', 'ceiling', 'left', 'right'] as const) {
      expect(DINO_SURFACES.surface(surface, origin)).toBeInstanceOf(THREE.Material);
      expect(DINO_SURFACES.edge(surface, origin)).toBeInstanceOf(THREE.Material);
    }
    const obstacles = dinoObstacles();
    for (const kind of ['block', 'gate', 'barrier'] as const) {
      expect(obstacles.material(kind, origin)).toBeInstanceOf(THREE.Material);
      expect(obstacles.edges(kind)).toBeInstanceOf(THREE.LineBasicMaterial);
    }
    dinoPickups().dispose();
  });
});

describe('day and night', () => {
  it('starts in daylight and stays there for the first 7000 m', () => {
    for (const d of [-5, 0, 100, 3500, 6999, 7000]) expect(nightAt(d)).toBe(0);
  });

  it('fades to night after 7000 m, back to day after 14000 m, and keeps alternating', () => {
    const { period, fade } = DINO_DAY;
    expect(nightAt(period + fade / 2)).toBeGreaterThan(0.2);
    expect(nightAt(period + fade / 2)).toBeLessThan(0.8);
    expect(nightAt(period + fade)).toBe(1);
    expect(nightAt(period * 2 - 1)).toBe(1);
    expect(nightAt(period * 2 + fade)).toBe(0);
    expect(nightAt(period * 3 + fade)).toBe(1);
    expect(nightAt(period * 4 + fade)).toBe(0);
  });

  it('never jumps: neighbouring metres differ by a small step', () => {
    for (let d = 0; d < 30000; d += 1) expect(Math.abs(nightAt(d + 1) - nightAt(d))).toBeLessThan(0.02);
  });

  it('inverts every tone in place, so shared colours need no new materials', () => {
    const theme = new DinoTheme();
    const sand = theme.tone('light');
    const before = sand.clone();
    const luminance = (c: THREE.Color) => c.r + c.g + c.b;
    expect(theme.tone('light')).toBe(sand);
    theme.setNight(1);
    expect(theme.tone('light')).toBe(sand);
    expect(luminance(sand)).toBeLessThan(luminance(before) / 2);
    expect(luminance(theme.ink)).toBeGreaterThan(luminance(theme.paper) * 3);
    expect(theme.paper.r).toBeCloseTo(theme.paper.g, 1);
  });

  it('is monochrome in day and night', () => {
    const theme = new DinoTheme();
    for (const night of [0, 0.3, 1]) {
      theme.setNight(night);
      for (const c of [theme.paper, theme.ink, theme.tone('mid')]) {
        expect(Math.abs(c.r - c.g)).toBeLessThan(0.03);
        expect(Math.abs(c.g - c.b)).toBeLessThan(0.05);
      }
    }
  });
});

describe('dino scenery', () => {
  it('is deterministic per seed and tile', () => {
    expect(planRoadside(42, 7)).toEqual(planRoadside(42, 7));
    expect(planMiddle(42, 7)).toEqual(planMiddle(42, 7));
    expect(planMonument(42, 7)).toEqual(planMonument(42, 7));
    expect(planRoadside(42, 7)).not.toEqual(planRoadside(43, 7));
  });

  it('keeps everything on the roadside clear of the track and apart from each other', () => {
    let graves = 0;
    for (const seed of [1, 42, 233]) for (let index = -2; index < 80; index++) {
      const tile = planRoadside(seed, index);
      const items = [...tile.cacti.map(c => ({ ...c, r: 1.5 })), ...tile.graves.map(g => ({ ...g, r: 2.5 })), ...tile.rocks.map(r => ({ ...r, r: r.size }))];
      for (const i of items) {
        expect(Math.abs(i.x) - i.r).toBeGreaterThan(W + 1);
        expect(Math.abs(i.x)).toBeGreaterThanOrEqual(ROADSIDE_MIN_X);
        expect(i.s).toBeGreaterThanOrEqual(0);
        expect(i.s).toBeLessThanOrEqual(DINO_SCENERY.roadside.tileLength);
      }
      for (const [a, ai] of items.entries()) for (const b of items.slice(a + 1)) expect(Math.hypot(ai.x - b.x, ai.s - b.s)).toBeGreaterThan(1.2);
      graves += tile.graves.length;
    }
    expect(graves).toBeGreaterThan(100);
  });

  it('puts only real epitaphs on stones, and includes Yahoo', () => {
    const names = new Set(GRAVES.map(g => g[0]));
    expect(names.has('YAHOO!')).toBe(true);
    for (let index = 0; index < 60; index++) for (const g of planRoadside(5, index).graves) expect(names.has(g.name)).toBe(true);
  });

  it('shows every monument once before any repeats, on alternating sides, away from the road', () => {
    const n = MONUMENTS.length;
    for (const seed of [1, 42]) for (let round = -1; round < 4; round++) {
      const kinds = Array.from({ length: n }, (_, k) => planMonument(seed, round * n + k).kind);
      expect(new Set(kinds).size).toBe(n);
    }
    for (let index = -3; index < 40; index++) {
      const m = planMonument(9, index), next = planMonument(9, index + 1);
      expect(Math.sign(m.x)).toBe(-Math.sign(next.x));
      expect(Math.abs(m.x)).toBeGreaterThan(40);
    }
  });

  it('builds every tile headlessly with draw calls bounded by the number of greys', () => {
    const materials = new ToneMaterials();
    const meshes = (o: THREE.Object3D) => { let n = 0; o.traverse(c => { if ((c as THREE.Mesh).isMesh) n++; }); return n; };
    for (let index = 0; index < 12; index++) {
      const tiles = [roadsideTile(3, index, materials), middleTile(3, index, materials), monumentTile(3, index, materials), skyTile(3, index, materials)];
      for (const tile of tiles) {
        expect(meshes(tile.object)).toBeGreaterThan(0);
        expect(meshes(tile.object)).toBeLessThan(40);
        tile.animate?.(1);
        tile.animate?.(2);
        tile.dispose();
      }
    }
    materials.dispose();
  });

  it('draws each monument kind', () => {
    const materials = new ToneMaterials();
    const kinds = new Set<string>();
    for (let index = 0; index < MONUMENTS.length; index++) {
      kinds.add(planMonument(1, index).kind);
      const tile = monumentTile(1, index, materials);
      const box = new THREE.Box3().setFromObject(tile.object);
      expect(box.max.y - box.min.y).toBeGreaterThan(7);
      tile.dispose();
    }
    expect(kinds.size).toBe(MONUMENTS.length);
    materials.dispose();
  });
});
