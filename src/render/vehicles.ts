import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import chargerUrl from '../../models/car.glb?url';
import roadsterUrl from '../../models/tesla_roadster_2026.lite.glb?url';
import cybertruckUrl from '../../models/tesla_cybertruck.glb?url';
import deloreanUrl from '../../models/delorean_time_machine_-_flying_mode.glb?url';
import dinoUrl from '../../models/3d_chrome_dino_walking.glb?url';
import steveUrl from '../../models/steve_in_a_boat.glb?url';
import type { WorldId } from './worlds';

/** Sketchfab models are CC-BY-4.0: the menu shows this credit while the model is selected. */
export interface VehicleCredit {
  title: string; author: string; url: string;
  /** Defaults to CC BY 4.0, the licence of most models here. */
  license?: { label: string; url: string };
}
export const CC_BY = { label: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
export const CC_BY_NC_SA = { label: 'CC BY-NC-SA 4.0', url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/' };

/**
 * A selectable look for the car. Every vehicle uses the same physics body; only the mesh changes.
 * `yaw` turns the model so its front faces −Z (forward); `strip` removes scenery parts by node name.
 */
export interface VehicleOption {
  id: string; name: string; url: string; yaw: number; strip?: RegExp; credit?: VehicleCredit; world?: WorldId;
  /** Showroom armour-glass demo (gun and steel ball on the menu); `glass` names the window material. */
  armory?: { glass: string };
  /** Stunt show on the menu (a "Show demo" button): the car drives past parked cars and flips. */
  demo?: boolean;
}

export const VEHICLES: readonly VehicleOption[] = [
  { id: 'charger', name: 'Fast Charger', url: chargerUrl, yaw: Math.PI },
  { id: 'roadster', name: 'Tesla Roadster', url: roadsterUrl, yaw: Math.PI, world: 'orbit', demo: true,
    credit: { title: 'Tesla Roadtser 2026', author: 'asiphy007', url: 'https://sketchfab.com/3d-models/tesla-roadtser-2026-7630c9fe842d4f5ea86fc1f122753b89' } },
  // Its windows are the black, mirror-smooth Material.001.
  { id: 'cybertruck', name: 'Cybertruck', url: cybertruckUrl, yaw: Math.PI, world: 'mars', armory: { glass: 'Material.001' },
    credit: { title: 'Tesla Cybertruck', author: 'Lexyc16', url: 'https://sketchfab.com/3d-models/tesla-cybertruck-f12e67159f75486bb21213e573520612' } },
  { id: 'delorean', name: 'DeLorean', url: deloreanUrl, yaw: Math.PI,
    credit: { title: 'DeLorean Time Machine - Flying Mode', author: 'Sea Land Air', url: 'https://sketchfab.com/3d-models/delorean-time-machine-flying-mode-b77a3d1927564ea3a78d1229f1b21573' } },
  // A flat, side-on sprite model: its head points along +X.
  { id: 'dino', name: 'Chrome Dino', url: dinoUrl, yaw: Math.PI / 2, world: 'dino',
    credit: { title: '3D Chrome Dino Walking', author: 'MayMax', url: 'https://sketchfab.com/3d-models/3d-chrome-dino-walking-fb6f49c248494011b6b9cac7326f1a91' } },
  // Faces +Z already; the scene includes a square of water tiles (cube_N) around the boat.
  { id: 'steve', name: 'Steve in a Boat', url: steveUrl, yaw: 0, strip: /^cube_\d+$/, world: 'voxel',
    credit: { title: 'Steve In A Boat', author: 'CalebChaffee', url: 'https://sketchfab.com/3d-models/steve-in-a-boat-6e047f8a122c4546b591a91ece432d94' } },
];
export const DEFAULT_VEHICLE = VEHICLES[0].id;

export const vehicleById = (id: string) => VEHICLES.find(v => v.id === id) ?? VEHICLES[0];
/** The world a vehicle drives through; vehicles without their own world use the neon grid. */
export const vehicleWorld = (id: string): WorldId => vehicleById(id).world ?? 'neon';

const STORAGE_KEY = 'fly-the-roadster.vehicle';
/** The remembered choice; storage can be unavailable (private mode, blocked site data). */
export function getSelectedVehicle(): string {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored && VEHICLES.some(v => v.id === stored)) return stored;
  } catch { /* fall through to the default */ }
  return DEFAULT_VEHICLE;
}
export function setSelectedVehicle(id: string) {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, vehicleById(id).id); } catch { /* not remembered */ }
}

export interface LoadedVehicle { scene: THREE.Object3D; animations: THREE.AnimationClip[] }
const loaded = new Map<string, Promise<LoadedVehicle>>();
/** Each model downloads once, on first use; CarModel instances clone it. */
export function loadVehicle(id: string): Promise<LoadedVehicle> {
  const option = vehicleById(id);
  let pending = loaded.get(option.id);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(option.url).then(gltf => ({ scene: gltf.scene, animations: gltf.animations }));
    // A failed download can be retried by selecting the vehicle again.
    pending.catch(() => loaded.delete(option.id));
    loaded.set(option.id, pending);
  }
  return pending;
}
