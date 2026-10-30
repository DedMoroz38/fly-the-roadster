import * as THREE from 'three';
import { CarModel } from './carModel';
import { vehicleWorld } from './vehicles';
import { blockAtlas, blockTexture } from './voxel/textures';
import { B, meshVolume, Volume } from './voxel/mesher';
import { sunsetLight } from './voxel/islands';

const MENU_ISLAND = { radius: 7, depth: 4, block: 0.36, rim: 0.74 } as const;

/** A small floating island: a grass rim around a pond, on a dirt-and-stone underside that tapers. */
function menuIsland(): THREE.BufferGeometry {
  const { radius: r, depth, block: size, rim } = MENU_ISLAND;
  const v = new Volume(2 * r + 1, depth + 1, 2 * r + 1);
  for (let i = -r; i <= r; i++) for (let k = -r; k <= r; k++) {
    const d = Math.hypot(i, k) / (r + 0.4);
    if (d > 1) continue;
    const bottom = depth - Math.max(1, Math.round((1 - d * d) * depth));
    // Inside the rim the ground sits one block lower, under the water.
    const top = d > rim ? depth : depth - 1;
    for (let y = bottom; y <= top; y++) v.set(i + r, y, k + r, y === top ? (d > rim ? B.grass : B.dirt) : y >= top - 1 ? B.dirt : B.stone);
  }
  return meshVolume(v, { blockSize: size, origin: [-(r + 0.5) * size, -(depth + 1) * size, -(r + 0.5) * size], light: sunsetLight })!;
}

/** Turntable speed in rad/s: about one turn every 6 s (9 s with reduced motion). */
export const MENU_SPIN = { normal: 1.05, reduced: 0.7 } as const;

/** Isolated showroom for the actual gameplay car; it never touches the simulation. */
export class MenuScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  private readonly car: CarModel;
  private readonly rings = new THREE.Group();
  private readonly deck: THREE.Mesh;
  private readonly island = new THREE.Group();
  private readonly pondTexture: THREE.Texture;
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private lastTime = 0;
  private time = 0;
  private spin = -2.45;
  private disposed = false;

  constructor(private readonly host: HTMLElement, vehicleId?: string) {
    this.car = new CarModel(vehicleId);
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xb9ddff, 0x25163e, 1.9));
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(2, 5, 4);
    this.scene.add(key);
    const cyan = new THREE.PointLight(0x31dfff, 28, 18, 1.5);
    cyan.position.set(-4, 2, 2);
    this.scene.add(cyan);
    const violet = new THREE.PointLight(0xb68aff, 35, 18, 1.5);
    violet.position.set(3, 3, -3);
    this.scene.add(violet);

    this.car.group.scale.setScalar(1.15);
    this.car.setSuction(false, false);
    this.scene.add(this.car.group);

    this.deck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.07, 80),
      new THREE.MeshStandardMaterial({ color: 0x0b1528, metalness: 0.5, roughness: 0.5 }));
    this.deck.position.y = -0.63;
    this.scene.add(this.deck);
    // Steve's world gets a little floating grass island for a turntable instead.
    this.island.add(new THREE.Mesh(menuIsland(), new THREE.MeshBasicMaterial({ map: blockAtlas().texture, vertexColors: true, alphaTest: 0.5 })));
    // The boat floats on a pond; the rim hides the water disc's edge.
    this.pondTexture = blockTexture('water').clone();
    this.pondTexture.wrapS = this.pondTexture.wrapT = THREE.RepeatWrapping;
    this.pondTexture.repeat.set(4, 4);
    this.pondTexture.needsUpdate = true;
    const pond = new THREE.Mesh(new THREE.CircleGeometry(MENU_ISLAND.radius * MENU_ISLAND.rim * MENU_ISLAND.block + 0.3, 40),
      new THREE.MeshBasicMaterial({ map: this.pondTexture, color: new THREE.Color(1.1, 1.15, 1.25), transparent: true, opacity: 0.9 }));
    pond.rotation.x = -Math.PI / 2;
    pond.position.y = -MENU_ISLAND.block * 0.25;
    this.island.add(pond);
    // Water level matches the boat's waterline.
    this.island.position.y = -0.25;
    this.scene.add(this.island);
    this.applyWorld();
    for (const [index, color] of [0x42dfff, 0xb88aff].entries()) {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(2.64, 0.018, 6, 80, Math.PI * 0.76),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, toneMapped: false }));
      arc.rotation.set(Math.PI / 2, 0, index * Math.PI + 0.2);
      this.rings.add(arc);
    }
    this.rings.position.y = -0.58;
    this.scene.add(this.rings);

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(this.host);
    } else {
      window.addEventListener('resize', this.resize);
    }
    this.pose(0);
    this.resize();
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.animate);
  }

  private resize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    const distance = 7.1 * Math.max(1, 1.6 / this.camera.aspect);
    this.camera.position.set(4.5, 2.6, 5.7).normalize().multiplyScalar(distance);
    this.camera.lookAt(0, -0.05, 0);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  };

  setVehicle(id: string) {
    if (id !== this.car.vehicleId) this.car.setVehicle(id);
    this.applyWorld();
  }

  private applyWorld() {
    const voxel = vehicleWorld(this.car.vehicleId) === 'voxel';
    this.island.visible = voxel;
    this.deck.visible = !voxel;
    this.rings.visible = !voxel;
  }

  /** Turntable spin always runs; reduced motion only slows it and drops the bob. */
  private pose(dt: number) {
    const reduced = this.motion.matches;
    this.car.update(dt, 0);
    this.spin += dt * (reduced ? MENU_SPIN.reduced : MENU_SPIN.normal);
    this.car.group.rotation.set(0, this.spin, reduced ? 0 : Math.sin(this.time * 0.5) * 0.025);
    this.car.group.position.y = 0.06 + (reduced ? 0 : Math.sin(this.time * 1.25) * 0.07);
    this.rings.rotation.y = -this.time * (reduced ? 0.04 : 0.25);
    this.island.rotation.y = this.spin;
    this.pondTexture.offset.set(this.time * 0.05, this.time * 0.12);
  }

  private animate = (now: number) => {
    if (this.disposed) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;
    this.time += dt;
    this.pose(dt);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.pondTexture.dispose();
    this.observer?.disconnect();
    window.removeEventListener('resize', this.resize);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
