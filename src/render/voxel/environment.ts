import * as THREE from 'three';
import type { Environment } from '../environment';
import { blockAtlas, blockTexture } from './textures';
import { buildIslandTile, ISLAND_CONFIG, SUN_DIR, type IslandTile } from './islands';
import { buildMountainTile, MOUNTAIN_CONFIG } from './mountains';
import { buildMob, type Mob } from './mobs';
import { ParallaxLayer, type ParallaxTile } from './parallax';
import { VoxelSky } from './sky';
import { VOXEL_TIME } from './trackStyle';

/** How the voxel sky world scrolls: islands at a tenth of the car's speed, mountains slower still. */
export const VOXEL_SCENERY = {
  islands: { speed: 0.1, ahead: 900, behind: 140 },
  mountains: { speed: 0.03, ahead: 1300, behind: 200 },
} as const;

/** Floating voxel islands at sunset: sky, sun, lights, fog and two parallax scenery layers. */
export class VoxelEnvironment implements Environment {
  readonly group = new THREE.Group();
  readonly background = null;
  readonly fog = new THREE.FogExp2(0x3c2d63, 0.00105);
  readonly cameraFar = 2600;
  readonly bloom = { strength: 0.42, radius: 0.5, threshold: 0.9 };
  /** Dimmer than neon: the water would otherwise mirror it as a white hot spot. */
  readonly carLight = 9;
  private readonly blockMaterial: THREE.MeshBasicMaterial;
  private readonly cloudMaterial: THREE.MeshBasicMaterial;
  private readonly mountainMaterial: THREE.MeshBasicMaterial;
  private readonly waterMaterial: THREE.MeshBasicMaterial;
  private readonly islands: ParallaxLayer;
  private readonly mountains: ParallaxLayer;
  private readonly sky = new VoxelSky();
  private time = 0;

  constructor(seed: number) {
    this.group.add(this.sky.group);
    this.blockMaterial = new THREE.MeshBasicMaterial({ map: blockAtlas().texture, vertexColors: true, alphaTest: 0.5 });
    // Distant ranges sink into the haze faster than nearby islands, which keeps them reading as far away.
    this.mountainMaterial = new THREE.MeshBasicMaterial({ map: blockAtlas().texture, vertexColors: true });
    this.mountainMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          float hazeDepth = vFogDepth * 1.7;
          float haze = 1.0 - exp(-fogDensity * fogDensity * hazeDepth * hazeDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, haze);
        #endif`);
    };
    this.cloudMaterial = new THREE.MeshBasicMaterial({ map: blockAtlas().texture, vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false });
    const water = blockTexture('water').clone();
    water.wrapS = water.wrapT = THREE.RepeatWrapping;
    water.needsUpdate = true;
    this.waterMaterial = new THREE.MeshBasicMaterial({ map: water, color: new THREE.Color(1.25, 1.35, 1.6), transparent: true, opacity: 0.86, side: THREE.DoubleSide, depthWrite: false });

    // Track lighting: cool twilight sky, a warm low sun ahead-right, violet fill from below.
    this.group.add(new THREE.HemisphereLight(0x8c9cff, 0x3f2d5e, 1.05));
    const sun = new THREE.DirectionalLight(0xffa772, 2.3);
    sun.position.copy(SUN_DIR).multiplyScalar(100);
    this.group.add(sun, sun.target);
    const under = new THREE.DirectionalLight(0x7a62c8, 0.7);
    under.position.set(-3, -10, 4);
    this.group.add(under);
    // Fill from behind the camera: the low sun ahead leaves the side of the vehicle we see in shadow.
    const fill = new THREE.DirectionalLight(0xfff0e0, 1.2);
    fill.position.set(-2, 7, 14);
    this.group.add(fill);

    this.islands = new ParallaxLayer({ ...VOXEL_SCENERY.islands, tileLength: ISLAND_CONFIG.tileLength, build: index => this.islandTile(buildIslandTile(seed, index)) });
    this.mountains = new ParallaxLayer({ ...VOXEL_SCENERY.mountains, tileLength: MOUNTAIN_CONFIG.tileLength, build: index => this.meshTile(buildMountainTile(seed, index), this.mountainMaterial) });
    this.group.add(this.mountains.group, this.islands.group);
  }

  private meshTile(geometry: THREE.BufferGeometry | null, material: THREE.Material): ParallaxTile {
    const object = new THREE.Group();
    if (geometry) object.add(new THREE.Mesh(geometry, material));
    return { object, dispose: () => geometry?.dispose() };
  }

  private islandTile(tile: IslandTile): ParallaxTile {
    const object = new THREE.Group();
    const owned: THREE.BufferGeometry[] = [];
    if (tile.blocks) { object.add(new THREE.Mesh(tile.blocks, this.blockMaterial)); owned.push(tile.blocks); }
    if (tile.clouds) {
      const clouds = new THREE.Mesh(tile.clouds, this.cloudMaterial);
      clouds.renderOrder = 2;
      object.add(clouds); owned.push(tile.clouds);
    }
    for (const fall of tile.waterfalls) {
      const height = fall.top - fall.bottom;
      const geometry = new THREE.PlaneGeometry(fall.width, height);
      // Repeat the water texture once per block down the fall.
      const uv = geometry.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * fall.width / ISLAND_CONFIG.blockSize, uv.getY(i) * height / ISLAND_CONFIG.blockSize);
      const mesh = new THREE.Mesh(geometry, this.waterMaterial);
      mesh.position.set(fall.x, (fall.top + fall.bottom) / 2, -fall.s);
      mesh.rotation.y = fall.facing * Math.PI / 2;
      mesh.renderOrder = 1;
      object.add(mesh); owned.push(geometry);
    }
    const mobs: Mob[] = [];
    const addMob = (mob: Mob, x: number, y: number, s: number, yaw: number, scale: number) => {
      mob.object.position.set(x, y, -s);
      mob.object.userData.baseY = y;
      mob.object.rotation.y = yaw;
      mob.object.scale.setScalar(scale);
      object.add(mob.object);
      mobs.push(mob);
    };
    tile.mobs.forEach((spot, i) => addMob(buildMob(spot.kind, i * 1.7), spot.x, spot.y, spot.s, spot.yaw, ISLAND_CONFIG.blockSize * 1.4));
    tile.ghasts.forEach((g, i) => addMob(buildMob('ghast', i * 2.3), g.x, g.y, g.s, g.x > 0 ? -Math.PI / 2 : Math.PI / 2, ISLAND_CONFIG.blockSize * 1.8));
    return {
      object,
      animate: time => { for (const mob of mobs) mob.animate(time); },
      dispose: () => {
        for (const geometry of owned) geometry.dispose();
        for (const mob of mobs) mob.object.traverse(o => (o as THREE.Mesh).geometry?.dispose());
      },
    };
  }

  update(camera: THREE.PerspectiveCamera, cameraDistance: number, dt: number) {
    this.time += dt;
    VOXEL_TIME.value = this.time;
    this.sky.update(camera, this.time);
    (this.waterMaterial.map as THREE.Texture).offset.y = this.time * 0.9;
    this.islands.update(camera.position.z, cameraDistance, this.time);
    this.mountains.update(camera.position.z, cameraDistance, this.time);
  }

  dispose() {
    this.islands.dispose();
    this.mountains.dispose();
    this.sky.dispose();
    this.blockMaterial.dispose();
    this.cloudMaterial.dispose();
    this.mountainMaterial.dispose();
    this.waterMaterial.map?.dispose();
    this.waterMaterial.dispose();
    this.group.clear();
  }
}
