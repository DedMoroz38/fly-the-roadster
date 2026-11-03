import * as THREE from 'three';

/** Bloom settings for worlds with glowing light sources. */
export interface BloomSettings { strength: number; radius: number; threshold: number }

/** Everything around the track that a world supplies: lights, sky, fog and distant scenery. */
export interface Environment {
  readonly group: THREE.Group;
  readonly background: THREE.Color | null;
  readonly fog: THREE.Fog | THREE.FogExp2;
  readonly cameraFar: number;
  readonly bloom: BloomSettings | null;
  /** Intensity of the light that travels with the vehicle. */
  readonly carLight: number;
  /** Optional reflections for metal surfaces; built on demand because it needs the renderer. */
  environmentMap?(renderer: THREE.WebGLRenderer): THREE.Texture;
  /**
   * Hands over the renderer's shader precompiler, for parts that appear later (hidden effects,
   * models that are still downloading); compiling them on first sight would freeze that frame.
   */
  prepare?(precompile: (object: THREE.Object3D) => void): void;
  /** A new attempt starts (restart): drop per-run surroundings such as the order of passing objects. */
  reset?(): void;
  /** cameraDistance: the camera's logical forward distance, for scenery that scrolls with travel. */
  update(camera: THREE.PerspectiveCamera, cameraDistance: number, dt: number): void;
  dispose(): void;
}

/** The original look: deep blue void, a star shell and cool neon lighting. */
export class NeonEnvironment implements Environment {
  readonly group = new THREE.Group();
  readonly background = new THREE.Color(0x060818);
  readonly fog = new THREE.Fog(0x060818, 70, 400);
  readonly cameraFar = 700;
  readonly bloom = null;
  readonly carLight = 30;
  private readonly stars = makeStars();

  constructor() {
    this.group.add(new THREE.HemisphereLight(0xa8ccff, 0x3a2a60, 1.25));
    this.group.add(this.stars);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 12, 6);
    this.group.add(sun, sun.target);
    // Soft fill from below so the car and ceilings read well when seen from underneath.
    const under = new THREE.DirectionalLight(0x9c88ff, 0.9);
    under.position.set(-3, -10, 4);
    this.group.add(under);
  }

  update(camera: THREE.PerspectiveCamera) {
    this.stars.position.z = camera.position.z - 10.5;
  }

  dispose() {
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.group.clear();
  }
}

/** Distant star shell around the corridor for depth and motion reference. */
function makeStars(): THREE.Points {
  const n = 1500;
  const pos = new Float32Array(n * 3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 120 + rnd() * 200;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = 5 + Math.sin(a) * r;
    pos[i * 3 + 2] = -rnd() * 600 + 100;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0x9fb8ff, size: 1.2, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8 });
  return new THREE.Points(geo, mat);
}
