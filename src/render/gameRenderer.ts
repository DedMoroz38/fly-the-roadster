import * as THREE from 'three';
import { CarModel } from './carModel';
import { SurfaceView } from './surfaceView';
import { CameraRig } from './cameraRig';
import { PickupView } from './pickupView';
import { Simulation } from '../game/simulation';
import { lerp } from '../core/math';

/** Owns the Three.js scene and draws the simulation state (with interpolation). */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly car = new CarModel();
  readonly surfaces = new SurfaceView();
  readonly pickups = new PickupView();
  readonly rig: CameraRig;
  private carLight: THREE.PointLight;
  private stars: THREE.Points;
  private seenAttachCount = 0;

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
    this.seenAttachCount = 0;
  }

  /**
   * alpha: interpolation factor between the previous and current physics step.
   * simDt: simulated time this frame (0 while paused) — drives gameplay effects.
   * frameDt: wall-clock frame time — drives camera smoothing and idle animation.
   */
  render(sim: Simulation, alpha: number, simDt: number, frameDt: number) {
    this.surfaces.sync(sim.level.slabs);
    this.pickups.sync(sim.level, sim.distance);
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
