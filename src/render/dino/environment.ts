import * as THREE from 'three';
import type { Environment } from '../environment';
import { ParallaxLayer } from '../parallax';
import { disposeLabels, ToneMaterials } from './pixels';
import { DINO_SCENERY, middleTile, monumentTile, roadsideTile, skyTile } from './scenery';
import { DINO_THEME, nightAt } from './theme';
import { toneMaterial } from './trackStyle';

/** A crescent moon by night; by day the same shape is a pale sun. Always straight ahead and up. */
function makeMoon() {
  const group = new THREE.Group();
  const flat = { fog: false, depthWrite: false } as const;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(16, 32), toneMaterial('dark', flat));
  const bite = new THREE.Mesh(new THREE.CircleGeometry(14, 32), toneMaterial('paper', flat));
  bite.position.set(7, 3, 0.5);
  disc.renderOrder = bite.renderOrder = -9;
  group.add(disc, bite);
  return group;
}

/** Sparse stars that only show at night. */
function makeStars(): THREE.Points {
  const n = 220, pos = new Float32Array(n * 3);
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const az = (rnd() - 0.5) * Math.PI * 1.6, el = 0.12 + rnd() * 0.9;
    pos[i * 3] = Math.sin(az) * Math.cos(el) * 500;
    pos[i * 3 + 1] = Math.sin(el) * 500;
    pos[i * 3 + 2] = -Math.cos(az) * Math.cos(el) * 500;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const material = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false });
  material.color = DINO_THEME.ink;
  const stars = new THREE.Points(geometry, material);
  stars.renderOrder = -10;
  stars.frustumCulled = false;
  return stars;
}

/**
 * The offline-game desert in greys only: pale sand, ink cacti and pterodactyls, tombstones for the
 * products Google shut down and giant monuments to what it built. Every 7000 m the whole palette
 * swaps between light and dark through the shared theme, as in Chrome's own game.
 */
export class DinoEnvironment implements Environment {
  readonly group = new THREE.Group();
  readonly background = new THREE.Color();
  readonly fog = new THREE.Fog(0xffffff, 90, 900);
  readonly cameraFar = 1500;
  readonly bloom = null;
  readonly carLight = 14;
  private readonly materials = new ToneMaterials();
  private readonly layers: ParallaxLayer[];
  private readonly sky = new THREE.Group();
  private readonly stars = makeStars();
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 1.5);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private time = 0;

  constructor(seed: number) {
    DINO_THEME.setNight(0);
    this.sky.add(makeMoon(), this.stars);
    this.sky.children[0].position.set(-70, 150, -420);
    this.group.add(this.sky, this.hemi, this.sun, this.sun.target);
    this.sun.position.set(4, 12, 6);
    const under = new THREE.DirectionalLight(0xffffff, 0.7);
    under.position.set(-3, -10, 4);
    this.group.add(under);
    const S = DINO_SCENERY;
    this.layers = [
      new ParallaxLayer({ ...S.sky, build: i => skyTile(seed, i, this.materials) }),
      new ParallaxLayer({ ...S.monuments, build: i => monumentTile(seed, i, this.materials) }),
      new ParallaxLayer({ ...S.middle, build: i => middleTile(seed, i, this.materials) }),
      new ParallaxLayer({ ...S.roadside, build: i => roadsideTile(seed, i, this.materials) }),
    ];
    for (const layer of this.layers) this.group.add(layer.group);
    this.applyTheme();
  }

  /** Repaints what the theme cannot reach by itself: sky, fog and the lights the car is shaded by. */
  private applyTheme() {
    this.background.copy(DINO_THEME.paper);
    this.fog.color.copy(DINO_THEME.paper);
    const night = DINO_THEME.night;
    (this.stars.material as THREE.PointsMaterial).opacity = Math.min(1, Math.max(0, (night - 0.4) / 0.4));
    this.hemi.intensity = 1.5 - night * 0.7;
    this.sun.intensity = 2 - night * 1.1;
  }

  reset() { DINO_THEME.setNight(0); this.applyTheme(); }

  update(camera: THREE.PerspectiveCamera, cameraDistance: number, dt: number) {
    this.time += dt;
    const night = nightAt(cameraDistance);
    if (Math.abs(night - DINO_THEME.night) > 1e-4) { DINO_THEME.setNight(night); this.applyTheme(); }
    this.sky.position.copy(camera.position);
    for (const layer of this.layers) layer.update(camera.position.z, cameraDistance, this.time);
  }

  dispose() {
    for (const layer of this.layers) layer.dispose();
    this.sky.traverse(o => {
      const drawable = o as THREE.Mesh;
      drawable.geometry?.dispose();
      const material = drawable.material;
      for (const m of Array.isArray(material) ? material : material ? [material] : []) m.dispose();
    });
    this.materials.dispose();
    disposeLabels();
    this.group.clear();
  }
}
