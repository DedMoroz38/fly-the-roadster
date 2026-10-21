import * as THREE from 'three';
import { CONFIG } from '../game/config';
import { clamp, damp, lerp } from '../core/math';

export interface CameraGoal {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
}

/**
 * Pure camera placement: behind the car along world +Z, pulled toward the corridor centre so
 * that wall/ceiling driving stays readable, clamped inside the corridor to avoid clipping.
 * The car's roll is deliberately ignored: the camera never barrel-rolls.
 */
export function cameraGoal(car: { x: number; y: number; z: number }): CameraGoal {
  const { halfWidth: W, height: H } = CONFIG.corridor;
  const reach = CONFIG.car.halfExtents.y;
  // Unit-ish direction from the car toward the corridor centre: the camera sits on the
  // "open" side of whatever surface the car is driving on (above the floor, below the ceiling...).
  const nx = clamp(-car.x / (W - reach), -1, 1);
  const ny = clamp((H / 2 - car.y) / (H / 2 - reach), -1, 1);
  const cx = clamp(lerp(car.x, 0, 0.45) + nx * 1.6, -W + 0.8, W - 0.8);
  const cy = clamp(lerp(car.y, H / 2, 0.45) + ny * 1.8, 0.8, H - 0.8);
  return {
    position: { x: cx, y: cy, z: car.z + 10.5 },
    lookAt: { x: lerp(car.x, 0, 0.25), y: lerp(car.y, H / 2, 0.25) + 0.6, z: car.z - 14 },
  };
}

export class CameraRig {
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;

  constructor(readonly camera: THREE.PerspectiveCamera) {
    camera.up.set(0, 1, 0);
  }

  reset() {
    this.initialized = false;
  }

  /** Translate cached interpolation state together with a floating-origin shift. */
  rebase(delta: number) {
    if (!this.initialized) return;
    this.pos.z += delta;
    this.look.z += delta;
    this.camera.position.z += delta;
  }

  update(car: { x: number; y: number; z: number }, dt: number) {
    const g = cameraGoal(car);
    if (!this.initialized) {
      this.pos.set(g.position.x, g.position.y, g.position.z);
      this.look.set(g.lookAt.x, g.lookAt.y, g.lookAt.z);
      this.initialized = true;
    } else {
      // Lateral/vertical smoothing; forward follow is tight so the car stays framed at speed.
      const k = damp(6, dt);
      this.pos.x += (g.position.x - this.pos.x) * k;
      this.pos.y += (g.position.y - this.pos.y) * k;
      this.pos.z += (g.position.z - this.pos.z) * damp(25, dt);
      this.look.x += (g.lookAt.x - this.look.x) * k;
      this.look.y += (g.lookAt.y - this.look.y) * k;
      this.look.z += (g.lookAt.z - this.look.z) * damp(25, dt);
    }
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
  }
}
