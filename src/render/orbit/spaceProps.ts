import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CC_BY_NC_SA, type VehicleCredit } from '../vehicles';

export type SpaceModel = 'iss' | 'shuttle' | 'voyager' | 'roadster' | 'millennium' | 'interstellar' | 'wall-e' | 'eve';

/**
 * Space objects in models/space/<name>.glb (optimised copies of the downloads in models/space/source;
 * see README). `size` is the length in metres of the model's longest side once scaled: real sizes,
 * except that the small ones (Starman's car, WALL-E and EVE) are enlarged so they read at a distance. `forward` is the model's own
 * nose direction, used by objects that fly nose first.
 */
export interface SpaceModelSpec { size: number; forward: [number, number, number]; credit: VehicleCredit }

export const SPACE_MODELS: Record<SpaceModel, SpaceModelSpec> = {
  iss: { size: 110, forward: [1, 0, 0], credit: { title: 'ISS', author: 'uperesito', url: 'https://sketchfab.com/3d-models/iss-813f5b296e584c26bf386ca39de6c3d4' } },
  // Enlarged from its real 37 m so it reads as it crosses the sky.
  shuttle: { size: 60, forward: [-1, 0, 0], credit: { title: 'Space Shuttle', author: 'ASHISH', url: 'https://sketchfab.com/3d-models/space-shuttle-892969a88e71495d9e869f96c95f0abf' } },
  voyager: { size: 18, forward: [0, 0, 1], credit: { title: 'Voyager 1', author: 'Sidharth1', url: 'https://sketchfab.com/3d-models/voyager-1-f626e0b2d37b46dab4c9433306720c4b' } },
  // Starman's car, with its real length of about 4 m, enlarged a little to read from the track.
  roadster: { size: 6, forward: [0, 0, 1], credit: { title: '2011 Tesla Roadster 2.5 Sport', author: 'Ddiaz Design', url: 'https://sketchfab.com/3d-models/2011-tesla-roadster-25-sport-7f225b841ad44d948b195361b7bc632e', license: CC_BY_NC_SA } },
  millennium: { size: 35, forward: [0, 0, 1], credit: { title: 'Millennium Falcon - Star Wars', author: 'Quiznos323', url: 'https://sketchfab.com/3d-models/millennium-falcon-star-wars-ed6dc932c3ce407dbe4b903c73595030', license: CC_BY_NC_SA } },
  interstellar: { size: 90, forward: [1, 0, 0], credit: { title: 'Interstellar | Endurance', author: 'devPilot', url: 'https://sketchfab.com/3d-models/interstellar-endurance-901fec2809704b74bec891e9a40a8726' } },
  // WALL-E faces −Z, holding the extinguisher in front of him; he flies back first (+Z), away from it.
  'wall-e': { size: 9, forward: [0, 0, 1], credit: { title: 'WALL-E (Fire Extinguisher)', author: 'SidewalkNZ', url: 'https://sketchfab.com/3d-models/wall-e-fire-extinguisher-14b86f2ae9364b0bb6b1260be3a0f5ac' } },
  // EVE's face (her eyes) is on the model's +X side.
  eve: { size: 10, forward: [1, 0, 0], credit: { title: 'Eve - Wall-E PIXAR Character', author: 'Smoothie 3D', url: 'https://sketchfab.com/3d-models/eve-wall-e-pixar-character-fa821bc361e645d4a80ff4abb1916f4f' } },
};

const URLS = import.meta.glob('../../../models/space/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

export function spaceModelUrl(name: SpaceModel): string | null {
  for (const [path, url] of Object.entries(URLS)) if (path.endsWith(`/${name}.glb`)) return url;
  return null;
}

/** Credits for the models that are present (orbit world). */
export const orbitCredits = (): VehicleCredit[] => (Object.keys(SPACE_MODELS) as SpaceModel[]).filter(spaceModelUrl).map(name => SPACE_MODELS[name].credit);

/**
 * Wraps a model so it is centred on its own origin and its longest side measures `size` metres.
 * Objects in space float: centring (not standing on a base) makes tumbling and spinning look right.
 */
export function normalizeSpaceModel(scene: THREE.Object3D, size: number): THREE.Group {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const extent = box.getSize(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(scene);
  scene.position.sub(box.getCenter(new THREE.Vector3()));
  inner.scale.setScalar(size / Math.max(extent.x, extent.y, extent.z, 1e-6));
  const holder = new THREE.Group();
  holder.add(inner);
  return holder;
}

export interface LoadedSpaceModel { object: THREE.Group; gltf: GLTF }
const loads = new Map<SpaceModel, Promise<LoadedSpaceModel | null>>();

/**
 * Loads each model once. Only one appearance is on screen at a time, so the loaded object itself is
 * shown (no copies), which also keeps WALL-E's skinned, animated mesh intact.
 */
export function loadSpaceModel(name: SpaceModel): Promise<LoadedSpaceModel | null> {
  let pending = loads.get(name);
  if (!pending) {
    const url = spaceModelUrl(name);
    pending = url
      ? new GLTFLoader().loadAsync(url).then(gltf => {
        gltf.scene.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Floating in vacuum: no haze, and never culled by a stale bounding box while animating.
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) (m as THREE.MeshStandardMaterial).fog = false;
          mesh.frustumCulled = false;
        });
        return { object: normalizeSpaceModel(gltf.scene, SPACE_MODELS[name].size), gltf };
      }).catch(() => null)
      : Promise.resolve(null);
    loads.set(name, pending);
  }
  return pending;
}
