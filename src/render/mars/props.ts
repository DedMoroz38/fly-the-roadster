import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { VehicleCredit } from '../vehicles';

export type PropKind = 'starship' | 'rover' | 'robot';

/**
 * Downloaded Sketchfab models live in models/mars/<kind>.glb (optimised copies of the originals in
 * models/mars/source; see README). Each is optional: a missing file simply leaves that sight out.
 * `height` is the real-world height in metres the model is scaled to; `yaw` turns it so its front
 * faces +X (rovers and robots move along their heading). `pose: 'end'` holds the model in the last
 * frame of its animation: the rover ships folded for cruise, and its clip deploys it.
 */
export interface PropSpec {
  height: number;
  yaw: number;
  pose?: 'end';
  /** Caps metalness: fully metallic steel only mirrors the dark sky overhead and turns black. */
  maxMetalness?: number;
  credit: VehicleCredit;
}
export const PROP_SPECS: Record<PropKind, PropSpec> = {
  starship: { height: 50, yaw: 0, maxMetalness: 0.45, credit: { title: 'SpaceX Starship Cargo', author: 'sunnychen753', url: 'https://sketchfab.com/3d-models/0c0b3a7708d04ee995e304f899d7b52b' } },
  // Twice life size, so it reads from the road.
  rover: { height: 4.4, yaw: Math.PI / 2, pose: 'end', credit: { title: 'NASA Curiosity (Clean)', author: 'nebulousflynn', url: 'https://sketchfab.com/3d-models/0696a383f3e841d2b5c7636ee8a58aba' } },
  // One and a half times life size, for the same reason.
  robot: { height: 2.6, yaw: Math.PI / 2, credit: { title: 'Tesla Optimus', author: 'mriexinger', url: 'https://sketchfab.com/3d-models/d68250b144f049eb9c8b38b54203ff9d' } },
};

const URLS = import.meta.glob('../../../models/mars/*.glb', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** The URL of a prop's model, or null when it has not been downloaded. */
export function propUrl(kind: PropKind): string | null {
  for (const [path, url] of Object.entries(URLS)) if (path.endsWith(`/${kind}.glb`)) return url;
  return null;
}

/**
 * Wraps a loaded scene so it stands on y = 0, centred, at its real height and turned to face +X.
 * Shadows are not used anywhere, so nothing else needs touching.
 */
export function normalizeProp(scene: THREE.Object3D, height: number, yaw: number): THREE.Group {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = height / Math.max(size.y, 1e-6);
  const centre = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(scene);
  scene.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
  inner.scale.setScalar(scale);
  inner.rotation.y = yaw;
  const holder = new THREE.Group();
  holder.add(inner);
  return holder;
}

/** Credits for the downloaded props only: a model that is not there needs no attribution. */
export const marsPropCredits = (): VehicleCredit[] => (Object.keys(PROP_SPECS) as PropKind[]).filter(kind => propUrl(kind)).map(kind => PROP_SPECS[kind].credit);

const templates = new Map<PropKind, Promise<THREE.Group | null>>();

/** Loads each prop once; later requests share the same template (and its geometry and materials). */
export function loadProp(kind: PropKind): Promise<THREE.Group | null> {
  let pending = templates.get(kind);
  if (!pending) {
    const url = propUrl(kind);
    const spec = PROP_SPECS[kind];
    pending = url
      ? new GLTFLoader().loadAsync(url).then(gltf => {
        const clip = gltf.animations[0];
        if (spec.pose === 'end' && clip) {
          // Node animation only: the final pose stays in the node transforms that copies inherit.
          const mixer = new THREE.AnimationMixer(gltf.scene);
          mixer.clipAction(clip).play();
          // Not stopped: stopping would restore the folded pose. The mixer is simply dropped.
          mixer.setTime(clip.duration - 1e-3);
        }
        if (spec.maxMetalness !== undefined) {
          gltf.scene.traverse(o => {
            const material = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
            if (!material?.isMeshStandardMaterial) return;
            material.metalness = Math.min(material.metalness, spec.maxMetalness!);
            material.roughness = Math.max(material.roughness, 0.32);
          });
        }
        return normalizeProp(gltf.scene, spec.height, spec.yaw);
      }).catch(() => null)
      : Promise.resolve(null);
    templates.set(kind, pending);
  }
  return pending;
}

/**
 * Places a copy of a prop in `parent` as soon as its model is ready. The returned holder is
 * positioned by the caller; copies share the template's geometry and materials, which stay
 * cached for the whole session and are never disposed with a tile.
 */
export function placeProp(kind: PropKind, parent: THREE.Object3D): THREE.Group {
  const holder = new THREE.Group();
  holder.name = `prop-${kind}`;
  parent.add(holder);
  void loadProp(kind).then(template => {
    if (template && holder.parent) holder.add(template.clone());
  });
  return holder;
}
