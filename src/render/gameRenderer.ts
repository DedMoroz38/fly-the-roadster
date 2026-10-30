import * as THREE from 'three';
import { CarModel } from './carModel';
import { SurfaceView } from './surfaceView';
import { CameraRig } from './cameraRig';
import { PickupView } from './pickupView';
import { Simulation } from '../game/simulation';
import { lerp } from '../core/math';
import type { RouteWaypoint } from '../game/course/planner';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Environment } from './environment';
import { WORLDS, type WorldId } from './worlds';
import { neonObstacles, obstacleKind, type ObstacleKind, type ObstacleStyle } from './trackStyle';

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
  private materials = new Map<ObstacleKind, THREE.Material>();
  private source: ObstacleSource | null = null;
  private syncedVersion = -1;
  private originDistance = 0;
  private gridOrigin = { value: 0 };

  constructor(private readonly style: ObstacleStyle = neonObstacles()) {}

  private material(kind: ObstacleKind) {
    let material = this.materials.get(kind);
    if (!material) { material = this.style.material(kind, this.gridOrigin); this.materials.set(kind, material); }
    return material;
  }

  sync(source: ObstacleSource | undefined, originDistance = 0) {
    if (!source) { if (this.source) this.clear(); return; }
    if (source !== this.source) { this.clear(); this.source = source; }
    if (source.version === this.syncedVersion && originDistance === this.originDistance) return;
    this.syncedVersion = source.version;
    this.originDistance = originDistance;
    this.gridOrigin.value = originDistance % 4;
    for (const [id, mesh] of this.meshes) {
      if (!source.active.has(id)) { this.group.remove(mesh); this.meshes.delete(id); }
    }
    for (const obstacle of source.active.values()) {
      let mesh = this.meshes.get(obstacle.id);
      if (!mesh) {
        mesh = new THREE.Group();
        mesh.name = `obstacle-${obstacle.id}`;
        const kind = obstacleKind(obstacle);
        mesh.add(new THREE.Mesh(this.box, this.material(kind)));
        const edges = this.style.edges(kind);
        if (edges) mesh.add(new THREE.LineSegments(this.edges, edges));
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
    this.box.dispose(); this.edges.dispose();
    const materials = new Set<THREE.Material>(this.materials.values());
    for (const kind of ['block', 'gate', 'barrier'] as const) { const edges = this.style.edges(kind); if (edges) materials.add(edges); }
    for (const material of materials) material.dispose();
    this.materials.clear();
  }
}

/** Owns the Three.js scene and draws the simulation state (with interpolation). */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly car = new CarModel();
  surfaces!: SurfaceView;
  pickups!: PickupView;
  readonly route = new CourseRouteView();
  obstacles!: ObstacleView;
  debugEnabled = false;
  readonly rig: CameraRig;
  worldId: WorldId | null = null;
  private worldSeed = 0;
  private environment: Environment | null = null;
  private composer: EffectComposer | null = null;
  private carLight: THREE.PointLight;
  private seenAttachCount = 0;
  private originDistance = 0;

  constructor(private host: HTMLElement, world: WorldId = 'neon', seed = 0) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 700);
    this.rig = new CameraRig(this.camera);

    this.carLight = new THREE.PointLight(0x66e0ff, 30, 18, 1.6);
    this.scene.add(this.carLight);
    this.scene.add(this.car.group);
    this.scene.add(this.route.group);
    this.setWorld(world, seed);
  }

  /**
   * Restyles the track and swaps the surroundings. Track views are rebuilt empty and refill from
   * the simulation's active geometry on the next frame; the course itself is unchanged.
   */
  setWorld(id: WorldId, seed = this.worldSeed) {
    if (id === this.worldId && seed === this.worldSeed) return;
    const world = WORLDS[id];
    for (const view of [this.surfaces, this.pickups, this.obstacles]) {
      if (!view) continue;
      this.scene.remove(view.group);
      view.dispose();
    }
    if (this.environment) { this.scene.remove(this.environment.group); this.environment.dispose(); }
    this.surfaces = new SurfaceView(world.surfaces);
    this.pickups = new PickupView(world.pickups());
    this.obstacles = new ObstacleView(world.obstacles());
    this.environment = world.environment(seed);
    this.scene.add(this.environment.group, this.surfaces.group, this.pickups.group, this.obstacles.group);
    this.carLight.intensity = this.environment.carLight;
    this.scene.background = this.environment.background;
    this.scene.fog = this.environment.fog;
    this.camera.far = this.environment.cameraFar;
    this.composer?.dispose();
    this.composer = null;
    const bloom = this.environment.bloom;
    if (bloom) {
      // Light sources (lanterns, portals, the sun) are brighter than white, so only they bloom.
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), bloom.strength, bloom.radius, bloom.threshold));
      this.composer.addPass(new OutputPass());
    }
    this.worldId = id;
    this.worldSeed = seed;
    this.resize();
    // Build the opening scenery and compile shaders now (on the menu), not on the first frame of a run.
    this.environment.update(this.camera, this.originDistance - this.camera.position.z, 0);
    this.renderer.compile(this.scene, this.camera);
  }

  resize() {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
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
    this.carLight.position.set(pos.x, pos.y + 1.5, pos.z - 2);
    this.rig.update(pos, frameDt);
    // The camera's logical distance drives scenery that scrolls slower than the track.
    this.environment?.update(this.camera, origin - this.camera.position.z, frameDt);
    if (this.composer) this.composer.render(frameDt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.route.dispose();
    this.obstacles.dispose();
    this.surfaces.dispose();
    this.pickups.dispose();
    this.environment?.dispose();
    this.composer?.dispose();
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
