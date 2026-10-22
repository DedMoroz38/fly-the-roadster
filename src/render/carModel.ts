import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import carUrl from '../../models/car.glb?url';
import { CONFIG } from '../game/config';

let carBody: Promise<THREE.Object3D> | null = null;

/** Loads the car mesh once; every CarModel clones it. Await before building views to avoid pop-in. */
export function loadCarBody(): Promise<THREE.Object3D> {
  carBody ??= new GLTFLoader().loadAsync(carUrl).then(gltf => gltf.scene);
  return carBody;
}

/**
 * Roadster built from models/car.glb, scaled to the physics box. Local frame: -Z forward,
 * +Y up (wheels at -Y). Exposes setters for effects (thrusters, suction) so the renderer can drive them.
 */
export class CarModel {
  readonly group = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private wheelRadius = 0.3;
  private liftFlames: THREE.Mesh[] = [];
  private rearFlames: THREE.Mesh[] = [];
  private rollThrusters: {
    flames: THREE.Mesh[];
    nozzles: THREE.Mesh[];
    flameMat: THREE.MeshBasicMaterial;
    nozzleMat: THREE.MeshStandardMaterial;
  }[] = [];
  private suctionRing: THREE.Mesh;
  private suctionMat: THREE.MeshBasicMaterial;
  private accentMat: THREE.MeshStandardMaterial;
  private flameMat: THREE.MeshBasicMaterial;
  private time = 0;
  private attachFlash = 0;
  private beam: THREE.Mesh;
  private beamMat: THREE.MeshBasicMaterial;
  private thrustLight: THREE.PointLight;

  constructor() {
    const he = CONFIG.car.halfExtents;
    // Headless tests have no loader environment; they exercise the effects only.
    if (typeof document !== 'undefined') loadCarBody().then(body => this.attachBody(body), error => console.error('Car model failed to load', error));

    // Neon underglow strips; they switch to violet while suction is held.
    this.accentMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.6 });
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 2.2), this.accentMat);
      strip.position.set(side * (he.x - 0.25), -he.y + 0.12, 0);
      this.group.add(strip);
    }

    // Thruster flames: lift (under the belly, pointing away from the roof) and rear.
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0x66e0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flameGeo = new THREE.ConeGeometry(0.16, 1, 10, 1, true);
    flameGeo.rotateZ(Math.PI);
    flameGeo.translate(0, -0.5, 0); // base at origin, tip at local -Y (out of the wheel side)
    for (const x of [-0.5, 0.5]) {
      for (const z of [-0.9, 0.9]) {
        const f = new THREE.Mesh(flameGeo, this.flameMat);
        f.position.set(x, -he.y + 0.05, z);
        this.group.add(f);
        this.liftFlames.push(f);
      }
    }
    const rearFlameMat = this.flameMat.clone();
    rearFlameMat.color.set(0xff8a3d);
    for (const x of [-0.45, 0.45]) {
      const f = new THREE.Mesh(flameGeo, rearFlameMat);
      f.position.set(x, 0.0, 1.78);
      f.rotation.x = -Math.PI / 2; // tip toward +Z (behind the car)
      this.group.add(f);
      this.rearFlames.push(f);
    }

    // Roll uses a force couple: opposite vertical jets at both sides, balanced
    // front/rear. Left roll lifts the right side, so its exhaust points down on
    // the right and up on the left. These rotate with the car's local frame.
    const rollFlameGeo = new THREE.ConeGeometry(0.14, 1, 10, 1, true);
    rollFlameGeo.rotateZ(Math.PI);
    rollFlameGeo.translate(0, -0.5, 0);
    const nozzleGeo = new THREE.CylinderGeometry(0.16, 0.12, 0.14, 10, 1, true);
    for (const [index, control] of ['left', 'right'].entries()) {
      const color = index === 0 ? 0xb785ff : 0xff73b5;
      const flameMat = this.flameMat.clone();
      flameMat.color.set(color);
      const nozzleMat = new THREE.MeshStandardMaterial({
        color: 0x343b4b, metalness: 0.8, roughness: 0.3,
        emissive: color, emissiveIntensity: 0.12, side: THREE.DoubleSide,
      });
      const flames: THREE.Mesh[] = [], nozzles: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const exhaustY = index === 0 ? -side : side;
        const sideName = side < 0 ? 'left' : 'right';
        const direction = exhaustY > 0 ? 'up' : 'down';
        for (const z of [-1.42, 1.42]) {
          const end = z < 0 ? 'front' : 'rear';
          const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
          nozzle.name = `roll-${control}-nozzle-${sideName}-${direction}-${end}`;
          nozzle.position.set(side * (he.x + 0.07), exhaustY * 0.2, z);
          nozzle.rotation.z = exhaustY < 0 ? Math.PI : 0;
          this.group.add(nozzle);
          nozzles.push(nozzle);

          const flame = new THREE.Mesh(rollFlameGeo, flameMat);
          flame.name = `roll-${control}-flame-${sideName}-${direction}-${end}`;
          flame.position.set(nozzle.position.x, exhaustY * 0.27, z);
          flame.rotation.z = exhaustY > 0 ? Math.PI : 0;
          this.group.add(flame);
          flames.push(flame);
        }
      }
      this.rollThrusters.push({ flames, nozzles, flameMat, nozzleMat });
    }

    // Suction emitter ring under the car.
    this.suctionMat = new THREE.MeshBasicMaterial({
      color: 0x9b5cff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.suctionRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 1.0, 32), this.suctionMat);
    this.suctionRing.rotation.x = -Math.PI / 2;
    this.suctionRing.position.y = -he.y - 0.02;
    this.group.add(this.suctionRing);

    // Suction beam: a translucent cone from the belly toward the surface being pulled in.
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xb07cff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const beamGeo = new THREE.CylinderGeometry(1.1, 0.7, 1, 24, 1, true);
    beamGeo.translate(0, -0.5, 0); // top at origin, extends along -Y
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.y = -he.y;
    this.beam.visible = false;
    this.group.add(this.beam);

    this.thrustLight = new THREE.PointLight(0x66e0ff, 0, 9, 1.8);
    this.thrustLight.position.set(0, -he.y - 0.6, 0);
    this.group.add(this.thrustLight);

    this.setThrust(0, 0);
    this.setRollThrust(0, 0);
    this.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
    });
  }

  /** Shows the suction beam reaching `length` metres toward the surface, or hides it (null). */
  setSuctionBeam(length: number | null) {
    this.beam.visible = length !== null && length > 0.05;
    if (length !== null) {
      this.beam.scale.set(1, Math.max(0.05, length), 1);
      this.beamMat.opacity = 0.12 + 0.1 * (0.5 + 0.5 * Math.sin(this.time * 20));
    }
  }

  setThrust(lift: number, forward: number) {
    this.thrustLight.intensity = lift * (14 + 4 * Math.sin(this.time * 50)) + forward * 6;
    for (const f of this.liftFlames) {
      f.visible = lift > 0;
      f.scale.set(1, 0.4 + lift * (0.9 + 0.25 * Math.sin(this.time * 60 + f.position.x * 7)), 1);
    }
    for (const f of this.rearFlames) {
      f.visible = forward > 0;
      f.scale.set(1.3, 0.6 + forward * (1.4 + 0.3 * Math.sin(this.time * 55 + f.position.x * 5)), 1.3);
    }
  }

  /** Independent roll channels; inputs reflect the vehicle's applied thrust. */
  setRollThrust(left: number, right: number) {
    for (const [index, thrust] of [left, right].entries()) {
      const intensity = THREE.MathUtils.clamp(thrust, 0, 1);
      const { flames, nozzles, flameMat, nozzleMat } = this.rollThrusters[index];
      flameMat.opacity = intensity * 0.9;
      nozzleMat.emissiveIntensity = 0.12 + intensity * 2.6;
      // Nozzles sit outside the model's bodywork, so they only appear while their channel fires.
      for (const nozzle of nozzles) nozzle.visible = intensity > 0;
      for (const flame of flames) {
        flame.visible = intensity > 0;
        const flicker = Math.sin(this.time * 57 + flame.position.z * 4);
        const width = 0.65 + intensity * 0.55;
        flame.scale.set(width, intensity * (1.15 + flicker * 0.18), width);
      }
    }
  }

  /** active: held suction is powered. attached: currently stuck to a surface. */
  setSuction(active: boolean, attached: boolean) {
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 8);
    this.suctionMat.opacity = active ? (attached ? 0.85 : 0.25 + 0.35 * pulse) : 0;
    this.suctionMat.color.set(attached ? 0xc59bff : 0x9b5cff);
    const s = active ? (attached ? 1.1 : 0.9 + 0.3 * pulse) : 1;
    this.suctionRing.scale.set(s, s, s);
    const flash = this.attachFlash;
    this.accentMat.emissive.set(active ? 0x9b5cff : 0x00e5ff);
    this.accentMat.emissiveIntensity = 1.6 + flash * 4;
  }

  flashAttach() {
    this.attachFlash = 1;
  }

  update(dt: number, forwardSpeed: number) {
    this.time += dt;
    this.attachFlash = Math.max(0, this.attachFlash - dt * 3);
    // The model faces +Z inside its turned-around root, so forward travel spins its wheels positively.
    for (const w of this.wheels) w.rotation.x += (forwardSpeed / this.wheelRadius) * dt;
  }

  /** Fits the model's length to the collider, centres it and rests the wheels on the collider floor. */
  private attachBody(template: THREE.Object3D) {
    const he = CONFIG.car.halfExtents;
    const body = template.clone(true);
    body.rotation.y = Math.PI;
    const root = new THREE.Group();
    root.add(body);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const scale = (he.z * 2) / size.z;
    root.scale.setScalar(scale);
    root.position.set(-centre.x * scale, -he.y - box.min.y * scale, -centre.z * scale);
    body.traverse(o => {
      if (/wheel/i.test(o.name)) this.wheels.push(o);
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = false;
    });
    const wheel = this.wheels[0] && new THREE.Box3().setFromObject(this.wheels[0]).getSize(new THREE.Vector3());
    if (wheel) this.wheelRadius = (wheel.y / 2) * scale;
    this.group.add(root);
  }
}
