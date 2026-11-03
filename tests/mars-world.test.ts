import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CONFIG } from '../src/game/config';
import { vehicleWorld } from '../src/render/vehicles';
import { WORLDS } from '../src/render/worlds';
import { archGeometry, buildCliffTile, CLIFF_CONFIG, formationGeometry } from '../src/render/mars/landforms';
import { LANDMARK_CONFIG, LAUNCH_TIMING, planLandmarkTile, planSite, SITE_CLEARANCE, siteKind, SITE_RARITY } from '../src/render/mars/landmarks';
import { normalizeProp, PROP_SPECS } from '../src/render/mars/props';
import { buildGroundTile, GROUND, groundSampler, nearFeatureKind, NEAR_FEATURES, ROCK_STRIDE } from '../src/render/mars/terrain';
import { MARS_SURFACES, marsObstacles, marsPickups } from '../src/render/mars/trackStyle';

const { halfWidth: W } = CONFIG.corridor;
const margin = CONFIG.fail.outsideMargin;

describe('Mars world registry', () => {
  it('is the Cybertruck world and supplies every track style', () => {
    expect(vehicleWorld('cybertruck')).toBe('mars');
    expect(WORLDS.mars.id).toBe('mars');
    const origin = { value: 0 };
    for (const surface of ['floor', 'ceiling', 'left', 'right'] as const) {
      expect(MARS_SURFACES.surface(surface, origin)).toBeInstanceOf(THREE.Material);
      expect(MARS_SURFACES.edge(surface, origin)).toBeInstanceOf(THREE.Material);
    }
    const obstacles = marsObstacles();
    for (const kind of ['block', 'gate', 'barrier'] as const) {
      expect(obstacles.material(kind, origin)).toBeInstanceOf(THREE.Material);
      expect(obstacles.edges(kind)).toBeInstanceOf(THREE.LineBasicMaterial);
    }
    marsPickups().dispose();
  });
});

describe('Mars ground', () => {
  it('stays below everywhere the car can still be in play, with plains just below the deck beside it', () => {
    for (const seed of [1, 42, 233]) {
      const height = groundSampler(seed);
      for (let s = 0; s < 20000; s += 37) {
        // A car falling out of the corridor ends the run before it could meet the ground.
        for (let x = -(W + margin); x <= W + margin; x += 1.5) expect(height(x, s)).toBeLessThan(-margin - 2);
        for (const side of [-1, 1]) for (let ax = GROUND.channel.halfWidth + GROUND.channel.bank; ax < 80; ax += 4) {
          const h = height(side * ax, s);
          expect(h).toBeLessThan(-1);
          expect(h).toBeGreaterThan(-6);
        }
      }
    }
  });

  it('stays near plain level where landmarks stand, since they scroll slower than the ground', () => {
    const height = groundSampler(42);
    for (let s = 0; s < 50000; s += 53) for (const side of [-1, 1]) for (let ax = LANDMARK_CONFIG.site.min - 60; ax <= 500; ax += 10) {
      // Site structures stand at baseY with deep foundations; the ground must stay inside them.
      const h = height(side * ax, s);
      expect(h).toBeGreaterThan(LANDMARK_CONFIG.baseY - LANDMARK_CONFIG.footing + 1);
      expect(h).toBeLessThan(LANDMARK_CONFIG.baseY + 2.5);
    }
  });

  it('builds the same tile for the same seed and index, and joins tiles without a seam', () => {
    const a = buildGroundTile(42, 5), b = buildGroundTile(42, 5), next = buildGroundTile(42, 6);
    expect(Array.from(a.geometry.getAttribute('position').array)).toEqual(Array.from(b.geometry.getAttribute('position').array));
    expect(Array.from(a.rocks)).toEqual(Array.from(b.rocks));
    const pos = a.geometry.getAttribute('position'), nextPos = next.geometry.getAttribute('position');
    const columns = pos.count / (GROUND.tileLength / GROUND.rowStep + 1);
    // The last row of a tile is the first row of the next one, one tile length further on.
    for (let k = 0; k < columns; k++) {
      const last = pos.count - columns + k;
      expect(pos.getX(last)).toBeCloseTo(nextPos.getX(k), 5);
      expect(pos.getY(last)).toBeCloseTo(nextPos.getY(k), 4);
      expect(pos.getZ(last)).toBeCloseTo(-GROUND.tileLength, 5);
    }
    for (const t of [a, b, next]) t.geometry.dispose();
  });

  it('keeps boulders, outcrops and sights out of the corridor', () => {
    for (let index = 0; index < 40; index++) {
      const tile = buildGroundTile(7, index);
      for (let i = 0; i < tile.rocks.length; i += ROCK_STRIDE) expect(Math.abs(tile.rocks[i])).toBeGreaterThan(W + 1.5);
      for (const o of tile.outcrops) expect(Math.abs(o.x) - o.radius * 1.5).toBeGreaterThan(GROUND.channel.halfWidth + GROUND.channel.bank);
      for (const f of tile.features) expect(Math.abs(f.x)).toBeGreaterThan(GROUND.channel.halfWidth + GROUND.channel.bank);
      tile.geometry.dispose();
    }
  });

  it('shows a rover early, then rover, robot and depot sights only rarely and never back to back', () => {
    for (const seed of [1, 42, 233]) {
      expect(nearFeatureKind(seed, NEAR_FEATURES.firstTile)).toBe('rover');
      let count = 0;
      let previous = null;
      for (let index = NEAR_FEATURES.firstTile + 1; index < 3000; index++) {
        const kind = nearFeatureKind(seed, index);
        if (kind) count++;
        if (index > NEAR_FEATURES.firstTile + 3) expect(Boolean(kind && previous)).toBe(false);
        previous = kind;
      }
      // About one every 1.7 km of ground (120 m tiles).
      expect(count / 3000).toBeGreaterThan(0.04);
      expect(count / 3000).toBeLessThan(0.09);
    }
  });
});

describe('Mars landmarks', () => {
  it('opens with one Starship site and one outpost, then keeps colony sights rare', () => {
    for (const seed of [1, 42, 233]) {
      expect(siteKind(seed, SITE_RARITY.starshipTile)).toBe('starship');
      expect(siteKind(seed, SITE_RARITY.outpostTile)).toBe('outpost');
      const kinds = Array.from({ length: 2000 }, (_, i) => siteKind(seed, i + 10));
      const ships = kinds.filter(k => k === 'starship').length / 2000, outposts = kinds.filter(k => k === 'outpost').length / 2000;
      expect(ships).toBeGreaterThan(0.05); expect(ships).toBeLessThan(0.11);
      expect(outposts).toBeGreaterThan(0.08); expect(outposts).toBeLessThan(0.16);
    }
  });

  it('keeps every formation, arch and site well clear of the track and inside its tile', () => {
    for (let index = 0; index < 60; index++) {
      const plan = planLandmarkTile(42, index);
      for (const f of plan.formations) {
        expect(Math.abs(f.x) - f.radius * 1.45).toBeGreaterThan(LANDMARK_CONFIG.lateral.min - 1);
        expect(f.t).toBeGreaterThanOrEqual(0);
        expect(f.t).toBeLessThan(LANDMARK_CONFIG.tileLength);
      }
      for (const a of plan.arches) expect(Math.abs(a.x)).toBeGreaterThan(200);
      if (plan.site) {
        expect(Math.abs(plan.site.x)).toBeGreaterThanOrEqual(LANDMARK_CONFIG.site.min);
        expect(Math.abs(plan.site.x)).toBeLessThanOrEqual(LANDMARK_CONFIG.site.max);
        if (plan.site.kind === 'starship' && plan.site.launcher !== null) expect(plan.site.launcher).toBeLessThan(plan.site.ships.length);
      }
    }
    // No rock from any tile stands on a site, including sites in the neighbouring tiles.
    for (let index = 1; index < 300; index++) {
      const plan = planLandmarkTile(42, index);
      for (const k of [-1, 0, 1]) {
        const site = planSite(42, index + k);
        if (!site) continue;
        for (const f of plan.formations) expect(Math.hypot(site.x - f.x, site.t + k * LANDMARK_CONFIG.tileLength - f.t)).toBeGreaterThan(f.radius * 1.5 + SITE_CLEARANCE - 1e-6);
      }
    }
    for (const seed of [1, 42, 233]) {
      // The opening Starship stands far ahead and always launches early in the run, still in front of the car.
      const first = planSite(seed, SITE_RARITY.starshipTile);
      if (first?.kind !== 'starship') throw new Error('opening site is not a Starship');
      expect(first.launcher).not.toBeNull();
      expect(first.launchAt).toBeGreaterThanOrEqual(LAUNCH_TIMING.openingAfter.min);
      expect(first.launchAt).toBeLessThanOrEqual(LAUNCH_TIMING.openingAfter.max);
      const aheadAtLaunch = SITE_RARITY.starshipTile * LANDMARK_CONFIG.tileLength + first.t - first.launchAt * LANDMARK_CONFIG.speed;
      expect(aheadAtLaunch).toBeGreaterThan(Math.abs(first.x));
      // Later Starships lift off once they are a good distance ahead.
      for (let index = 10; index < 600; index++) {
        const site = planSite(seed, index);
        if (site?.kind !== 'starship') continue;
        const ahead = index * LANDMARK_CONFIG.tileLength + site.t - site.launchAt * LANDMARK_CONFIG.speed;
        expect(ahead).toBeGreaterThanOrEqual(LAUNCH_TIMING.ahead.min - 1e-6);
        expect(ahead).toBeLessThanOrEqual(LAUNCH_TIMING.ahead.max + 1e-6);
      }
    }
  });

  it('builds closed rock with level-strata markings, at the requested size', () => {
    for (const kind of ['mesa', 'butte', 'spire', 'ledge'] as const) {
      const g = formationGeometry(kind, 20, 40, 3);
      g.computeBoundingBox();
      expect(g.boundingBox!.max.y).toBeGreaterThan(39);
      expect(g.boundingBox!.max.y).toBeLessThan(43);
      expect(g.boundingBox!.min.y).toBeLessThan(0);
      const strata = g.getAttribute('strata');
      expect(strata.count).toBe(g.getAttribute('position').count);
      expect(Array.from(strata.array).some(v => v === 1)).toBe(true);
      expect(Array.from(g.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      g.dispose();
    }
    const arch = archGeometry(40, 25, 6, 1);
    arch.computeBoundingBox();
    expect(arch.boundingBox!.max.y).toBeGreaterThan(25);
    expect(arch.boundingBox!.max.x - arch.boundingBox!.min.x).toBeGreaterThan(40);
    arch.dispose();
  });

  it('continues the canyon walls seamlessly across tiles', () => {
    const a = buildCliffTile(42, 3), b = buildCliffTile(42, 4);
    const pa = a.getAttribute('position'), pb = b.getAttribute('position');
    const near = (p: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, z: number) => {
      const out: string[] = [];
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getZ(i) - z) < 1e-3) out.push(`${p.getX(i).toFixed(2)},${p.getY(i).toFixed(2)}`);
      return new Set(out);
    };
    const end = near(pa, -CLIFF_CONFIG.tileLength), start = near(pb, 0);
    expect(start.size).toBeGreaterThan(10);
    for (const v of start) expect(end.has(v)).toBe(true);
    a.dispose(); b.dispose();
  });
});

describe('Mars props', () => {
  it('scales a downloaded model to its real height, standing on the ground and centred', () => {
    const model = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 2));
    model.position.set(30, 7, -12);
    const prop = normalizeProp(model, PROP_SPECS.robot.height, 0);
    prop.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(prop);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect(box.max.y).toBeCloseTo(PROP_SPECS.robot.height, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
  });
});
