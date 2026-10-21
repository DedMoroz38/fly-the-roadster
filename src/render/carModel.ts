import * as THREE from 'three';
import { CONFIG } from '../game/config';

/**
 * Custom low-poly futuristic roadster. Local frame: -Z forward, +Y up (wheels at -Y).
 * Exposes setters for effects (thrusters, suction) so the renderer can drive them.
 */
export class CarModel {
  readonly group = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private liftFlames: THREE.Mesh[] = [];
  private rearFlames: THREE.Mesh[] = [];
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

    // Body: side profile extruded across the car's width.
    const profile = new THREE.Shape();
    const pts: [number, number][] = [
      [-1.7, -0.18], [-1.72, -0.04], [-0.7, 0.1], [-0.25, 0.33], [0.55, 0.33], [1.35, 0.12], [1.72, 0.1], [1.72, -0.18],
    ];
    profile.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) profile.lineTo(x, y);
    profile.closePath();
    const width = he.x * 2 - 0.3;
    const bodyGeo = new THREE.ExtrudeGeometry(profile, {
      depth: width, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.08, bevelSegments: 2,
    });
    bodyGeo.rotateY(-Math.PI / 2);
    bodyGeo.translate(width / 2, 0, 0);
    bodyGeo.computeVertexNormals();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc9d3e3, metalness: 0.75, roughness: 0.28 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    this.group.add(body);

    // Cabin glass.
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.82, 0.16, 0.95),
      new THREE.MeshStandardMaterial({ color: 0x0a1a2e, metalness: 0.9, roughness: 0.05, emissive: 0x06223a }),
    );
    glass.position.set(0, 0.3, 0.12);
    this.group.add(glass);

    // Neon accent strips along the sides and a rear light bar.
    this.accentMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.6 });
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 3.0), this.accentMat);
      strip.position.set(side * (width / 2 + 0.09), -0.02, 0);
      this.group.add(strip);
    }
    const tail = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.06, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xff2a6d, emissive: 0xff2a6d, emissiveIntensity: 2 }),
    );
    tail.position.set(0, 0.04, 1.82);
    this.group.add(tail);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.9, 0.04, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f6ff, emissiveIntensity: 2 }),
    );
    head.position.set(0, -0.05, -1.8);
    this.group.add(head);

    // Wheels.
    const wheelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.28, 18);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6, metalness: 0.3 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00a8c0, emissiveIntensity: 1 });
    for (const x of [-1, 1]) {
      for (const z of [-1.15, 1.15]) {
        const w = new THREE.Mesh(wheelGeo, wheelMat);
        w.position.set(x * (he.x - 0.12), -he.y + 0.3, z);
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8).rotateZ(Math.PI / 2), hubMat);
        w.add(hub);
        this.group.add(w);
        this.wheels.push(w);
      }
    }

    // Thruster flames: lift (under the belly, pointing away from the roof) and rear.
    this.flameMat = new THREE.MeshBasicMaterial({
      color: 0x66e0ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const flameGeo = new THREE.ConeGeometry(0.16, 1, 10, 1, true);
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

  /** active: suction toggled on. attached: currently stuck to a surface. */
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
    for (const w of this.wheels) w.rotation.x -= (forwardSpeed / 0.3) * dt;
  }
}
