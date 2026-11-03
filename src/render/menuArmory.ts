import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { Rng } from '../core/rng';
import type { CarModel } from './carModel';

/** Showroom armory tuning, in metres and seconds (scene units on the menu turntable). */
export const ARMORY = {
  gravity: 9.8,
  bulletSpeed: 42,
  bulletRadius: 0.03,
  sphereRadius: 0.16,
  restitution: { bullet: 0.5, sphere: 0.3 },
  /** A thrown sphere or spent bullet stays this long after it first lands or drops off the pad. */
  linger: 5,
  maxBullets: 40,
  /** Slowest ball (m/s) that still cracks the glass. */
  crackSpeed: 3,
  /** The pad the car stands on: deck top, then the regolith ring around it. */
  floor: [{ radius: 2.55, y: -0.54 }, { radius: 3.0, y: -0.62 }],
  /** Stands beside the turntable: how far out, and how high the items hop. */
  standOffset: { min: 2.6, max: 4.3 },
  hop: 0.32,
} as const;

export type ArmoryItem = 'gun' | 'sphere';
/** What flies: the gun fires bullets, the ball is thrown itself. */
export type ProjectileKind = 'bullet' | 'sphere';

/** Display sizes on the stands: the gun's scale, and the ball's radius (larger than the thrown one, to read from afar). */
const STAND_SCALE: Record<ArmoryItem, number> = { gun: 1.9, sphere: 0.3 };

/** Launch velocity that carries a throw from `from` to `to` in `time` seconds under gravity. */
export function throwVelocity(from: THREE.Vector3, to: THREE.Vector3, time: number, gravity: number = ARMORY.gravity): THREE.Vector3 {
  return to.clone().sub(from).divideScalar(time).add(new THREE.Vector3(0, 0.5 * gravity * time, 0));
}

/** Velocity after hitting a surface with unit normal `normal`: the normal part reverses, scaled by `restitution`. */
export function bounce(velocity: THREE.Vector3, normal: THREE.Vector3, restitution: number, grip = 0.8): THREE.Vector3 {
  const into = normal.clone().multiplyScalar(velocity.dot(normal));
  return velocity.clone().sub(into).multiplyScalar(grip).sub(into.multiplyScalar(restitution));
}

/** Whether a projectile that first came down at `landedAt` has lingered long enough to go. */
export const removalDue = (landedAt: number | null, time: number) => landedAt !== null && time - landedAt >= ARMORY.linger;

/** Floor height under a point on the pad, or null beyond its edge (things fall off into the dark). */
export function floorAt(x: number, z: number): number | null {
  const r = Math.hypot(x, z);
  for (const ring of ARMORY.floor) if (r <= ring.radius) return ring.y;
  return null;
}

/** A compact sci-fi pistol, barrel along +X; `muzzle` is in the gun's own coordinates. */
function buildGun(metal: THREE.Material, dark: THREE.Material, glow: THREE.Material): { gun: THREE.Group; muzzle: THREE.Vector3 } {
  const gun = new THREE.Group();
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    gun.add(mesh);
  };
  part(new THREE.BoxGeometry(0.62, 0.13, 0.11), metal, 0.05, 0.06, 0);
  part(new THREE.BoxGeometry(0.5, 0.08, 0.1), dark, 0, -0.04, 0);
  part(new THREE.CylinderGeometry(0.032, 0.032, 0.16, 16), metal, 0.42, 0.06, 0, Math.PI / 2);
  part(new THREE.BoxGeometry(0.12, 0.3, 0.095), dark, -0.17, -0.2, 0, 0.28);
  part(new THREE.TorusGeometry(0.055, 0.012, 6, 16, Math.PI), dark, -0.02, -0.08, 0, Math.PI);
  part(new THREE.BoxGeometry(0.42, 0.016, 0.116), glow, 0.05, 0.1, 0);
  part(new THREE.BoxGeometry(0.03, 0.035, 0.03), dark, 0.32, 0.14, 0);
  return { gun, muzzle: new THREE.Vector3(0.5, 0.06, 0) };
}

/** Radial glass cracks on a transparent canvas: jagged spokes from the impact, joined by rings. */
function crackTexture(seed: number): THREE.CanvasTexture {
  const size = 512, rng = new Rng(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(236, 246, 255, 0.92)';
  const spokes = rng.int(11, 16);
  const rings = [0.22, 0.42, 0.66].map(f => f * size * 0.5);
  const marks: { x: number; y: number }[][] = rings.map(() => []);
  for (let i = 0; i < spokes; i++) {
    let a = (i / spokes) * Math.PI * 2 + rng.range(-0.15, 0.15);
    const reach = size * 0.5 * rng.range(0.62, 0.97);
    let x = Math.cos(a) * 5, y = Math.sin(a) * 5, r = 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let ring = 0;
    while (r < reach) {
      const step = rng.range(14, 30);
      a += rng.range(-0.16, 0.16);
      x += Math.cos(a) * step; y += Math.sin(a) * step; r = Math.hypot(x, y);
      // Bold strokes: the whole crack covers only a few dozen pixels on the menu's car.
      ctx.lineWidth = Math.max(3, 11 * (1 - r / reach));
      ctx.lineTo(x, y);
      while (ring < rings.length && r >= rings[ring]) marks[ring++][i] = { x, y };
    }
    ctx.stroke();
  }
  // Concentric fractures between neighbouring spokes, some missing, slightly kinked.
  ctx.lineWidth = 4;
  for (const ringMarks of marks) {
    for (let i = 0; i < spokes; i++) {
      const p = ringMarks[i], q = ringMarks[(i + 1) % spokes];
      if (!p || !q || rng.chance(0.3)) continue;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.quadraticCurveTo((p.x + q.x) / 2 * rng.range(0.9, 1.06), (p.y + q.y) / 2 * rng.range(0.9, 1.06), q.x, q.y);
      ctx.stroke();
    }
  }
  // Frosted, shattered glass around the impact, and the pulverised spot where the ball hit.
  const frost = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.36);
  frost.addColorStop(0, 'rgba(230, 240, 250, 0.55)');
  frost.addColorStop(1, 'rgba(230, 240, 250, 0)');
  ctx.fillStyle = frost;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
  ctx.fill();
  const spot = ctx.createRadialGradient(0, 0, 0, 0, 0, 44);
  spot.addColorStop(0, 'rgba(255, 255, 255, 1)');
  spot.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = spot;
  ctx.beginPath();
  ctx.arc(0, 0, 44, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A soft round sprite for sparks and the muzzle flash. */
function softDot(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,220,150,0.8)');
  g.addColorStop(1, 'rgba(255,160,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

interface Projectile { kind: ProjectileKind; mesh: THREE.Mesh; velocity: THREE.Vector3; radius: number; landedAt: number | null; cracked: boolean }
interface Spark { sprite: THREE.Sprite; age: number; life: number; size: number }
interface Stand { item: ArmoryItem; group: THREE.Group; display: THREE.Object3D; ring: THREE.Mesh; hit: THREE.Mesh }

/**
 * The Cybertruck showroom's armour-glass demo: a pistol and a steel ball hop on stands beside the
 * turntable. Click one to pick it up, then click to fire or throw at the cursor. Bullets ricochet off
 * the body and the glass; a ball that hits the glass hard enough cracks it. Everything that comes to
 * rest is removed five seconds after it first lands. Cracks stay until the menu closes or the
 * vehicle changes (a new body is built). Clicks the armory uses never reach the start button.
 */
export class MenuArmory {
  readonly group = new THREE.Group();
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly metal: THREE.MeshStandardMaterial;
  private readonly dark: THREE.MeshStandardMaterial;
  private readonly steel: THREE.MeshStandardMaterial;
  private readonly glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46e6ff).multiplyScalar(1.5), toneMapped: false });
  private readonly standMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.7, roughness: 0.35 });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0x46e6ff, transparent: true, opacity: 0.75, toneMapped: false });
  private readonly bulletMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.25, 0.6), toneMapped: false });
  private readonly sparkTexture = softDot();
  private readonly sphereGeometry = new THREE.SphereGeometry(1, 40, 24);
  private readonly bulletGeometry = new THREE.CapsuleGeometry(1, 3.5, 4, 8);
  private readonly hitGeometry = new THREE.SphereGeometry(1, 12, 8);
  private crackMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly stands: Stand[];
  private readonly heldGun: THREE.Group;
  private readonly heldSphere: THREE.Mesh;
  private readonly muzzle: THREE.Vector3;
  private readonly flash: THREE.Sprite;
  private readonly hint: HTMLElement;
  readonly projectiles: Projectile[] = [];
  private readonly sparks: Spark[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly aim = new THREE.Vector3(0, 0, 0);
  private held: ArmoryItem | null = null;
  private hovered: ArmoryItem | null = null;
  private enabled = false;
  private time = 0;
  private recoil = 0;
  private flashAge = 1;
  private sphereRespawn = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly car: CarModel,
    private readonly glassMaterial: () => string | null,
    /** The turntable's turn rate (rad/s), to lead shots at the spinning car. */
    private readonly spinRate: () => number,
    host: HTMLElement,
  ) {
    // The showroom has no environment of its own; polished metal needs something to reflect.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    const envMap = this.envTarget.texture;
    this.metal = new THREE.MeshStandardMaterial({ color: 0x3a3f48, metalness: 0.9, roughness: 0.3, envMap });
    this.dark = new THREE.MeshStandardMaterial({ color: 0x15181d, metalness: 0.6, roughness: 0.5, envMap });
    this.steel = new THREE.MeshStandardMaterial({ color: 0xdfe4ea, metalness: 1, roughness: 0.1, envMap });

    const { gun, muzzle } = buildGun(this.metal, this.dark, this.glow);
    this.muzzle = muzzle;
    this.stands = (['gun', 'sphere'] as const).map(item => this.buildStand(item, item === 'gun' ? gun : this.sphereMesh(STAND_SCALE.sphere)));
    // Held items ride along with the camera at the bottom corners of the view.
    this.heldGun = new THREE.Group();
    const inHand = gun.clone();
    inHand.rotation.y = -Math.PI / 2; // barrel along +Z, which lookAt points at the target
    inHand.scale.setScalar(0.62); // the stand's copy is enlarged; in hand it sits close to the camera
    this.heldGun.add(inHand);
    this.heldSphere = this.sphereMesh(ARMORY.sphereRadius * 0.55);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTexture, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.flash.visible = false;
    inHand.add(this.flash);
    this.flash.position.copy(muzzle).add(new THREE.Vector3(0.06, 0, 0));
    this.heldGun.visible = this.heldSphere.visible = false;
    camera.add(this.heldGun, this.heldSphere);

    this.hint = document.createElement('span');
    this.hint.className = 'menu-armory-hint';
    host.appendChild(this.hint);
    const canvas = renderer.domElement;
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKey);
    this.setEnabled(false);
    // Development builds expose the armory for inspection from the console.
    if (import.meta.env?.DEV) (window as unknown as { __menuArmory?: MenuArmory }).__menuArmory = this;
  }

  private sphereMesh(radius: number): THREE.Mesh {
    const mesh = new THREE.Mesh(this.sphereGeometry, this.steel);
    mesh.scale.setScalar(radius);
    return mesh;
  }

  private buildStand(item: ArmoryItem, display: THREE.Object3D): Stand {
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.08, 32), this.standMaterial);
    base.position.y = 0.04;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.02, 6, 48), this.ringMaterial.clone());
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.085;
    if (item === 'gun') display.scale.setScalar(STAND_SCALE.gun);
    // A generous invisible target, so the small items are easy to click.
    const hit = new THREE.Mesh(this.hitGeometry, new THREE.MeshBasicMaterial({ visible: false }));
    hit.scale.setScalar(0.75);
    hit.position.y = 0.6;
    group.add(base, ring, display, hit);
    this.group.add(group);
    return { item, group, display, ring, hit };
  }

  /** Shows the armory for vehicles that have one (the Cybertruck); hiding it drops anything held. */
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.group.visible = enabled;
    if (!enabled) {
      this.held = null;
      for (const p of this.projectiles.splice(0)) this.group.remove(p.mesh);
    }
    // Only an armed showroom catches clicks; otherwise the canvas stays click-through to the start button.
    this.renderer.domElement.style.pointerEvents = enabled ? 'auto' : '';
    this.refresh();
  }

  /** Places the stands either side of the turntable, as far out as the view allows. */
  layout() {
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    const toward = this.camera.position.clone().setY(0).normalize();
    const distance = this.camera.position.length();
    const halfWidth = distance * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    const offset = THREE.MathUtils.clamp(halfWidth - 1.1, ARMORY.standOffset.min, ARMORY.standOffset.max);
    // Narrow views have no room beside the pad, so the stands also come forward, in front of its rim.
    const forward = offset < 3.2 ? 1.4 : 0.4;
    for (const stand of this.stands) {
      const side = stand.item === 'gun' ? -1 : 1;
      stand.group.position.copy(right).multiplyScalar(side * offset).addScaledVector(toward, forward).setY(ARMORY.floor[1].y);
    }
    const depth = 2.6;
    const halfH = depth * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const halfW = halfH * this.camera.aspect;
    this.heldGun.position.set(-Math.min(halfW * 0.7, 2.3), -halfH * 0.62, -depth);
    this.heldSphere.position.set(Math.min(halfW * 0.7, 2.3), -halfH * 0.58, -depth);
  }

  private setPointer(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.far = Infinity;
  }

  private standUnderPointer(): ArmoryItem | null {
    const hits = this.raycaster.intersectObjects(this.stands.map(s => s.hit), false);
    return hits.length ? this.stands.find(s => s.hit === hits[0].object)!.item : null;
  }

  /**
   * Where the cursor points: the car, else the pad, else a point some way into the scene. A point on
   * the car is led by `lead` seconds of turntable spin, so a shot lands on the spot that was clicked.
   */
  private target(lead = 0): THREE.Vector3 {
    this.raycaster.far = Infinity;
    const body = this.car.bodyObject;
    const hit = body ? this.raycaster.intersectObject(body, true)[0] : undefined;
    if (hit) return hit.point.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.spinRate() * lead);
    const ray = this.raycaster.ray;
    if (ray.direction.y < -1e-3) {
      const t = (ARMORY.floor[0].y - ray.origin.y) / ray.direction.y;
      const p = ray.at(t, new THREE.Vector3());
      if (floorAt(p.x, p.z) !== null) return p;
    }
    return ray.at(9, new THREE.Vector3());
  }

  private onMove = (event: PointerEvent) => {
    if (!this.enabled) return;
    this.setPointer(event);
    this.hovered = this.standUnderPointer();
    if (this.held) this.aim.copy(this.target());
    this.refresh();
  };

  private onClick = (event: MouseEvent) => {
    if (!this.enabled) return;
    this.setPointer(event);
    const stand = this.standUnderPointer();
    if (!stand && !this.held) return; // an ordinary click on the car: let it start the run
    event.stopPropagation();
    event.preventDefault();
    if (stand) this.held = this.held === stand ? null : stand;
    else this.fire();
    this.refresh();
  };

  private onContextMenu = (event: MouseEvent) => {
    if (!this.enabled || !this.held) return;
    event.preventDefault();
    this.held = null;
    this.refresh();
  };

  private onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.held) {
      this.held = null;
      this.refresh();
    }
  };

  private refresh() {
    const canvas = this.renderer.domElement;
    canvas.style.cursor = !this.enabled ? '' : this.hovered ? 'pointer' : this.held ? 'crosshair' : '';
    this.heldGun.visible = this.enabled && this.held === 'gun';
    this.heldSphere.visible = this.enabled && this.held === 'sphere';
    for (const stand of this.stands) stand.display.visible = this.held !== stand.item;
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    const put = touch ? 'tap the stand to put it back' : 'Esc or right-click to put it back';
    this.hint.textContent = !this.enabled ? ''
      : this.held === 'gun' ? `${touch ? 'Tap' : 'Click'} to shoot · ${put}`
      : this.held === 'sphere' ? `${touch ? 'Tap' : 'Click'} to throw · ${put}`
      : `${touch ? 'Tap' : 'Click'} the gun or the steel ball to pick it up`;
  }

  private fire() {
    if (this.held === 'gun') {
      // A bullet reaches the car in about a tenth of a second.
      const target = this.target(0.12);
      this.heldGun.lookAt(target);
      this.heldGun.updateMatrixWorld(true);
      const from = this.heldGun.children[0].localToWorld(this.muzzle.clone());
      const velocity = target.clone().sub(from).normalize().multiplyScalar(ARMORY.bulletSpeed);
      this.launch('bullet', from, velocity);
      this.recoil = 1;
      this.flashAge = 0;
    } else if (this.held === 'sphere') {
      const from = this.heldSphere.getWorldPosition(new THREE.Vector3());
      // A lob that comes down onto the car, aimed where the clicked spot will be when it arrives.
      const time = THREE.MathUtils.clamp(from.distanceTo(this.target()) / 9, 0.45, 0.75);
      const target = this.target(time);
      this.launch('sphere', from, throwVelocity(from, target, time));
      // Unlimited: the hand is refilled straight away, popping back in.
      this.sphereRespawn = 0;
    }
  }

  private launch(kind: ProjectileKind, from: THREE.Vector3, velocity: THREE.Vector3) {
    const radius = kind === 'bullet' ? ARMORY.bulletRadius : ARMORY.sphereRadius;
    const mesh = kind === 'bullet' ? new THREE.Mesh(this.bulletGeometry, this.bulletMaterial) : this.sphereMesh(radius);
    mesh.scale.setScalar(radius);
    mesh.position.copy(from);
    this.group.add(mesh);
    this.projectiles.push({ kind, mesh, velocity, radius, landedAt: null, cracked: false });
    // Old bullets go first if someone holds the trigger down for a long time.
    const bullets = this.projectiles.filter(p => p.kind === 'bullet');
    if (bullets.length > ARMORY.maxBullets) this.remove(bullets[0]);
  }

  private remove(p: Projectile) {
    this.group.remove(p.mesh);
    this.projectiles.splice(this.projectiles.indexOf(p), 1);
  }

  private spark(at: THREE.Vector3, size: number) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.sparkTexture, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    sprite.position.copy(at);
    this.group.add(sprite);
    this.sparks.push({ sprite, age: 0, life: 0.18, size });
  }

  /** Projects a crack decal onto the glass where the ball struck; it rides along with the car. */
  private crack(hit: THREE.Intersection, normal: THREE.Vector3) {
    if (!this.crackMaterials.length) {
      this.crackMaterials = [11, 23, 37].map(seed => new THREE.MeshBasicMaterial({
        map: crackTexture(seed), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
      }));
    }
    const glass = hit.object as THREE.Mesh;
    const orient = new THREE.Object3D();
    orient.position.copy(hit.point);
    orient.lookAt(hit.point.clone().add(normal));
    orient.rotateZ(Math.random() * Math.PI * 2);
    const size = THREE.MathUtils.randFloat(0.8, 1.05);
    const geometry = new DecalGeometry(glass, hit.point, orient.rotation, new THREE.Vector3(size, size, 0.35));
    // Built in world space; move it into the glass's own frame so it turns with the car.
    geometry.applyMatrix4(glass.matrixWorld.clone().invert());
    const decal = new THREE.Mesh(geometry, this.crackMaterials[Math.floor(Math.random() * this.crackMaterials.length)]);
    decal.name = 'glass-crack';
    decal.renderOrder = 2;
    glass.add(decal);
  }

  private step(p: Projectile, dt: number) {
    p.velocity.y -= ARMORY.gravity * dt;
    const position = p.mesh.position;
    const move = p.velocity.clone().multiplyScalar(dt);
    const length = move.length();
    const body = this.car.bodyObject;
    if (body && length > 1e-6) {
      this.raycaster.set(position, move.clone().divideScalar(length));
      this.raycaster.far = length + p.radius;
      const hit = this.raycaster.intersectObject(body, true).find(h => h.face && h.object.name !== 'glass-crack');
      if (hit?.face) {
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        if (normal.dot(p.velocity) > 0) normal.negate();
        const impact = -p.velocity.dot(normal);
        const speed = p.velocity.length();
        position.copy(hit.point).addScaledVector(normal, p.radius + 0.002);
        p.velocity.copy(bounce(p.velocity, normal, ARMORY.restitution[p.kind]));
        const material = (hit.object as THREE.Mesh).material as THREE.Material;
        const isGlass = material.name !== '' && material.name === this.glassMaterial();
        // Armour glass: bullets glance off it; the steel ball cracks it.
        // Any real throw cracks the glass, even at a slant; only a slow roll does not.
        if (p.kind === 'sphere' && isGlass && !p.cracked && speed > ARMORY.crackSpeed) {
          this.crack(hit, normal);
          p.cracked = true;
        }
        if (impact > 1) this.spark(hit.point, p.kind === 'bullet' ? 0.35 : 0.5);
        return;
      }
    }
    position.add(move);
    const floor = floorAt(position.x, position.z);
    if (floor !== null && position.y - p.radius < floor && p.velocity.y < 0) {
      position.y = floor + p.radius;
      p.landedAt ??= this.time;
      p.velocity.y = Math.abs(p.velocity.y) < 0.8 ? 0 : -p.velocity.y * ARMORY.restitution[p.kind];
    }
    // Rolling and sliding slow down on the pad.
    if (floor !== null && position.y <= floor + p.radius + 1e-3) {
      const drag = Math.exp(-(p.kind === 'sphere' ? 0.9 : 3) * dt);
      p.velocity.x *= drag;
      p.velocity.z *= drag;
    }
    if (floor === null && position.y < ARMORY.floor[1].y - 0.3) p.landedAt ??= this.time;
    if (p.kind === 'sphere') {
      // Roll the ball the way it travels.
      const axis = new THREE.Vector3(p.velocity.z, 0, -p.velocity.x);
      const speed = axis.length();
      if (speed > 1e-4) p.mesh.rotateOnWorldAxis(axis.divideScalar(speed), (speed * dt) / p.radius);
    } else if (length > 1e-6) {
      p.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), move.clone().divideScalar(length));
    }
  }

  update(dt: number) {
    if (!this.enabled) return;
    this.time += dt;
    // Items hop on their stands so it is clear they can be picked up.
    for (const stand of this.stands) {
      const phase = this.time * 2.8 + (stand.item === 'gun' ? 0 : 1.3);
      const hop = Math.abs(Math.sin(phase)) * ARMORY.hop;
      const squash = 1 - Math.max(0, 0.12 - hop) * 1.2;
      const hover = this.hovered === stand.item ? 1.15 : 1;
      const base = stand.item === 'gun' ? 0.62 : 0.1 + STAND_SCALE.sphere;
      stand.display.position.y = base + hop;
      stand.display.rotation.y = stand.item === 'gun' ? this.time * 0.9 : 0;
      stand.display.scale.setScalar(STAND_SCALE[stand.item] * hover);
      if (stand.item === 'sphere') stand.display.scale.y *= squash;
      (stand.ring.material as THREE.MeshBasicMaterial).opacity = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 4)) + (hover > 1 ? 0.2 : 0);
    }
    // The held gun tracks the cursor and kicks back when it fires.
    if (this.held === 'gun') {
      this.heldGun.lookAt(this.aim);
      this.recoil = Math.max(0, this.recoil - dt * 9);
      this.heldGun.children[0].position.z = -this.recoil * 0.08;
      this.heldGun.children[0].rotation.x = -this.recoil * 0.25;
    }
    this.flashAge += dt;
    this.flash.visible = this.flashAge < 0.06;
    this.flash.scale.setScalar(0.35);
    this.sphereRespawn = Math.min(1, this.sphereRespawn + dt * 4);
    this.heldSphere.scale.setScalar(ARMORY.sphereRadius * 0.55 * this.sphereRespawn);
    this.heldSphere.rotation.y += dt * 0.8;

    this.car.group.updateMatrixWorld(true);
    // Small steps keep fast bullets from tunnelling through thin panels.
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    for (const p of [...this.projectiles]) {
      for (let i = 0; i < steps; i++) this.step(p, dt / steps);
      if (removalDue(p.landedAt, this.time)) this.remove(p);
    }
    for (const s of [...this.sparks]) {
      s.age += dt;
      const k = s.age / s.life;
      s.sprite.scale.setScalar(s.size * (0.4 + k));
      s.sprite.material.opacity = 1 - k;
      if (k >= 1) {
        this.group.remove(s.sprite);
        s.sprite.material.dispose();
        this.sparks.splice(this.sparks.indexOf(s), 1);
      }
    }
  }

  dispose() {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKey);
    this.hint.remove();
    for (const m of this.crackMaterials) { m.map?.dispose(); m.dispose(); }
    this.sparkTexture.dispose();
    this.envTarget.dispose();
    // Geometries and materials in the scene graph are released by the menu scene's own sweep.
  }
}
