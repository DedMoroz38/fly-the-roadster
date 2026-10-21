import * as THREE from 'three';
import { CarModel } from './carModel';
import { SurfaceView } from './surfaceView';
import { CameraRig } from './cameraRig';
import { PickupView } from './pickupView';
import { Simulation } from '../game/simulation';
import { lerp } from '../core/math';
import type { RouteWaypoint } from '../game/course/planner';

interface RouteSource { version: number; readonly routeWaypoints: readonly RouteWaypoint[] }
interface ObstacleSource {
  version: number;
  active: ReadonlyMap<number, { id: number; x: number; y: number; d: number; half: { x: number; y: number; z: number } }>;
}

/** A development-only movement trace. Rebuild only when streamed route data changes. */
export class CourseRouteView {
  readonly group = new THREE.Group();
  readonly line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
    color: 0xd6ff42, transparent: true, opacity: 0.85, depthTest: false, toneMapped: false, fog: false,
  }));
  private source: RouteSource | null = null;
  private syncedVersion = -1;
  private originDistance = 0;

  constructor() {
    this.group.name = 'debug-route';
    this.group.visible = false;
    this.line.name = 'validated-movement-route';
    this.line.renderOrder = 8;
    this.group.add(this.line);
  }

  sync(source: RouteSource | null, enabled: boolean, originDistance = 0) {
    this.group.visible = enabled && source !== null;
    if (!source) { if (this.source) this.clear(); return; }
    if (!enabled || source === this.source && source.version === this.syncedVersion && originDistance === this.originDistance) return;
    const points = source.routeWaypoints;
    const positions = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = originDistance - point.d;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    this.line.geometry.dispose();
    this.line.geometry = geometry;
    this.source = source;
    this.syncedVersion = source.version;
    this.originDistance = originDistance;
  }

  clear() {
    this.line.geometry.dispose();
    this.line.geometry = new THREE.BufferGeometry();
    this.source = null;
    this.syncedVersion = -1;
    this.originDistance = 0;
    this.group.visible = false;
  }

  dispose() {
    this.line.geometry.dispose();
    this.line.material.dispose();
    this.group.clear();
    this.source = null;
  }
}

/** Shared geometry keeps streamed hazard rendering bounded and inexpensive. */
export class ObstacleView {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Group>();
  private box = new THREE.BoxGeometry(1, 1, 1);
  private edges = new THREE.EdgesGeometry(this.box);
  private material = new THREE.MeshStandardMaterial({ color: 0x5b2438, emissive: 0x9d173e, emissiveIntensity: 0.45, metalness: 0.35, roughness: 0.55 });
  private edgeMaterial = new THREE.LineBasicMaterial({ color: 0xff677b, toneMapped: false });
  private source: ObstacleSource | null = null;
  private syncedVersion = -1;
  private originDistance = 0;

  sync(source: ObstacleSource | undefined, originDistance = 0) {
    if (!source) { if (this.source) this.clear(); return; }
    if (source !== this.source) { this.clear(); this.source = source; }
    if (source.version === this.syncedVersion && originDistance === this.originDistance) return;
    this.syncedVersion = source.version;
    this.originDistance = originDistance;
    for (const [id, mesh] of this.meshes) {
      if (!source.active.has(id)) { this.group.remove(mesh); this.meshes.delete(id); }
    }
    for (const obstacle of source.active.values()) {
      let mesh = this.meshes.get(obstacle.id);
      if (!mesh) {
        mesh = new THREE.Group();
        mesh.name = `obstacle-${obstacle.id}`;
        mesh.add(new THREE.Mesh(this.box, this.material));
        mesh.add(new THREE.LineSegments(this.edges, this.edgeMaterial));
        this.meshes.set(obstacle.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.set(obstacle.x, obstacle.y, originDistance - obstacle.d);
      mesh.scale.set(obstacle.half.x * 2, obstacle.half.y * 2, obstacle.half.z * 2);
    }
  }

  clear() {
    this.group.clear();
    this.meshes.clear();
    this.source = null;
    this.syncedVersion = -1;
    this.originDistance = 0;
  }

  dispose() {
    this.clear();
    this.box.dispose(); this.edges.dispose(); this.material.dispose(); this.edgeMaterial.dispose();
  }
}

/** Owns the Three.js scene and draws the simulation state (with interpolation). */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly car = new CarModel();
  readonly surfaces = new SurfaceView();
  readonly pickups = new PickupView();
  readonly route = new CourseRouteView();
  readonly obstacles = new ObstacleView();
  debugEnabled = false;
  readonly rig: CameraRig;
  private carLight: THREE.PointLight;
  private stars: THREE.Points;
  private seenAttachCount = 0;
  private originDistance = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 700);
    this.rig = new CameraRig(this.camera);

    this.scene.background = new THREE.Color(0x060818);
    this.scene.fog = new THREE.Fog(0x060818, 70, 400);
    this.scene.add(new THREE.HemisphereLight(0xa8ccff, 0x3a2a60, 1.25));
    this.stars = makeStars();
    this.scene.add(this.stars);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 12, 6);
    this.scene.add(sun);
    this.scene.add(sun.target);
    // Soft fill from below so the car and ceilings read well when seen from underneath.
    const under = new THREE.DirectionalLight(0x9c88ff, 0.9);
    under.position.set(-3, -10, 4);
    this.scene.add(under);
    this.carLight = new THREE.PointLight(0x66e0ff, 30, 18, 1.6);
    this.scene.add(this.carLight);

    this.scene.add(this.surfaces.group);
    this.scene.add(this.pickups.group);
    this.scene.add(this.car.group);
    this.scene.add(this.route.group);
    this.scene.add(this.obstacles.group);
    this.resize();
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Called on restart: snap camera and drop per-attempt view state. */
  reset() {
    this.rig.reset();
    this.pickups.clear();
    this.surfaces.clear();
    this.route.clear();
    this.obstacles.clear();
    this.seenAttachCount = 0;
    this.originDistance = 0;
  }

  /**
   * alpha: interpolation factor between the previous and current physics step.
   * simDt: simulated time this frame (0 while paused) — drives gameplay effects.
   * frameDt: wall-clock frame time — drives camera smoothing and idle animation.
   */
  render(sim: Simulation, alpha: number, simDt: number, frameDt: number) {
    const origin = sim.originDistance;
    if (origin !== this.originDistance) {
      this.rig.rebase(origin - this.originDistance);
      this.originDistance = origin;
    }
    this.surfaces.sync(sim.level.slabs, origin);
    const routeSource = 'routeWaypoints' in sim.level && 'version' in sim.level
      ? sim.level as typeof sim.level & RouteSource : null;
    this.route.sync(routeSource, this.debugEnabled, origin);
    this.obstacles.sync((sim.level as typeof sim.level & { obstacles?: ObstacleSource }).obstacles, origin);
    this.pickups.sync(sim.level, sim.distance, origin);
    this.pickups.update(frameDt);
    const a = sim.prevPose;
    const b = sim.pose();
    let dRoll = b.roll - a.roll;
    if (dRoll > Math.PI) dRoll -= Math.PI * 2;
    if (dRoll < -Math.PI) dRoll += Math.PI * 2;
    const pos = { x: lerp(a.x, b.x, alpha), y: lerp(a.y, b.y, alpha), z: lerp(a.z, b.z, alpha) };
    this.car.group.position.set(pos.x, pos.y, pos.z);
    this.car.group.rotation.set(0, 0, a.roll + dRoll * alpha);
    this.car.update(simDt, sim.vehicle.forwardSpeed);
    this.car.setThrust(sim.vehicle.liftThrust, sim.vehicle.forwardThrust);
    this.car.setRollThrust(sim.vehicle.rollLeftThrust, sim.vehicle.rollRightThrust);
    if (sim.vehicle.attachCount !== this.seenAttachCount) {
      if (sim.vehicle.attachCount > this.seenAttachCount) this.car.flashAttach();
      this.seenAttachCount = sim.vehicle.attachCount;
    }
    this.car.setSuction(sim.vehicle.suctionOn, sim.vehicle.mode === 'attached');
    this.car.setSuctionBeam(sim.vehicle.suctionState === 'attracting' && sim.vehicle.probe ? sim.vehicle.probe.gap : null);
    // A touch of FOV with speed for a sense of velocity.
    const fov = 68 + Math.min(10, Math.max(0, sim.vehicle.forwardSpeed - 20) * 0.35);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, frameDt * 4);
      this.camera.updateProjectionMatrix();
    }
    this.stars.position.z = pos.z;
    this.carLight.position.set(pos.x, pos.y + 1.5, pos.z - 2);
    this.rig.update(pos, frameDt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.route.dispose();
    this.obstacles.dispose();
    this.surfaces.dispose();
    this.pickups.dispose();
    // Car parts share several geometries/materials. Dispose each remaining
    // scene resource once after views release their own cached assets.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse(object => {
      const drawable = object as THREE.Mesh;
      if (drawable.geometry) geometries.add(drawable.geometry);
      if (drawable.material) {
        for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
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
