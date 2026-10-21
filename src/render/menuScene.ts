import * as THREE from 'three';
import { CarModel } from './carModel';

/** Isolated showroom for the actual gameplay car; it never touches the simulation. */
export class MenuScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40);
  private readonly car = new CarModel();
  private readonly rings = new THREE.Group();
  private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private observer: ResizeObserver | null = null;
  private frame = 0;
  private lastTime = 0;
  private time = 0;
  private disposed = false;

  constructor(private readonly host: HTMLElement) {
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

    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.07, 80),
      new THREE.MeshStandardMaterial({ color: 0x0b1528, metalness: 0.5, roughness: 0.5 }));
    deck.position.y = -0.63;
    this.scene.add(deck);
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
    this.motion.addEventListener('change', this.onMotionChange);
    this.pose(0);
    this.resize();
    this.lastTime = performance.now();
    if (!this.motion.matches) this.frame = requestAnimationFrame(this.animate);
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

  private pose(dt: number) {
    this.car.update(dt, 0);
    this.car.group.rotation.set(0, -2.45 + this.time * 0.28, Math.sin(this.time * 0.5) * 0.025);
    this.car.group.position.y = 0.06 + Math.sin(this.time * 1.25) * 0.07;
    this.rings.rotation.y = -this.time * 0.11;
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

  private onMotionChange = () => {
    cancelAnimationFrame(this.frame);
    this.lastTime = performance.now();
    if (!this.motion.matches && !this.disposed) this.frame = requestAnimationFrame(this.animate);
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener('resize', this.resize);
    this.motion.removeEventListener('change', this.onMotionChange);
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
