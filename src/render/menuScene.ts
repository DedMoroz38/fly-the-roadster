import * as THREE from 'three';
import { CarModel } from './carModel';
import { MenuArmory } from './menuArmory';
import { vehicleById, vehicleWorld } from './vehicles';
import { blockAtlas, blockTexture } from './voxel/textures';
import { B, meshVolume, Volume } from './voxel/mesher';
import { sunsetLight } from './voxel/islands';
import { boulderGeometry } from './mars/landforms';
import { chooseJumps, GROUND_Y, layoutRow, loadAudience, MENU_SCALE, PATH_Z, planDemo, ROADSTER, ROW_FRONT, searchFlights, type DemoPlan, type DemoPose, type JumpChoice, type Row } from './menuDemo';
import { Vapour } from './menuVapour';

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

/** A small landing pad set into red regolith, with cyan lights round its edge and a few stones. */
function marsPad(): THREE.Group {
  const pad = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.CylinderGeometry(2.95, 3.05, 0.16, 48),
    new THREE.MeshStandardMaterial({ color: 0x9c4a26, roughness: 1, metalness: 0 }));
  ground.position.y = -0.7;
  pad.add(ground);
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.58, 0.12, 8),
    new THREE.MeshStandardMaterial({ color: 0x4a505b, roughness: 0.38, metalness: 0.65 }));
  deck.position.y = -0.6;
  pad.add(deck);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46e6ff).multiplyScalar(1.4), toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.36, 0.025, 6, 96), glow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.535;
  pad.add(ring);
  const light = new THREE.BoxGeometry(0.22, 0.04, 0.08);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const lamp = new THREE.Mesh(light, glow);
    lamp.position.set(Math.cos(a) * 2.42, -0.53, Math.sin(a) * 2.42);
    lamp.rotation.y = -a;
    pad.add(lamp);
  }
  const stone = boulderGeometry(3);
  const rock = new THREE.MeshStandardMaterial({ color: 0x8a3e1f, roughness: 0.95, flatShading: true });
  for (const [a, r, size] of [[0.4, 2.78, 0.16], [1.9, 2.85, 0.1], [2.6, 2.75, 0.2], [4.1, 2.82, 0.13], [5.3, 2.8, 0.09]]) {
    const mesh = new THREE.Mesh(stone, rock);
    mesh.position.set(Math.cos(a) * r, -0.62, Math.sin(a) * r);
    mesh.scale.setScalar(size);
    mesh.rotation.y = a * 3;
    pad.add(mesh);
  }
  return pad;
}

/** A pale sand turntable with an ink ring, pebbles and a small cactus: the offline game's desert. */
function dinoPad(): THREE.Group {
  const pad = new THREE.Group();
  const sand = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.66, 0.12, 48), new THREE.MeshBasicMaterial({ color: 0xe6e6e6 }));
  sand.position.y = -0.62;
  pad.add(sand);
  const ink = new THREE.MeshBasicMaterial({ color: 0x535353 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.45, 0.03, 6, 96), ink);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.555;
  pad.add(ring);
  const pebble = new THREE.BoxGeometry(0.2, 0.03, 0.06);
  for (let i = 0; i < 14; i++) {
    const a = i * 2.4, r = 1.2 + (i % 4) * 0.32;
    const mesh = new THREE.Mesh(pebble, ink);
    mesh.position.set(Math.cos(a) * r, -0.55, Math.sin(a) * r);
    mesh.rotation.y = a;
    pad.add(mesh);
  }
  const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 0.2), ink);
  trunk.position.set(2.1, -0.15, -0.9);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.14, 0.14), ink);
  arm.position.set(1.85, -0.05, -0.9);
  pad.add(trunk, arm);
  return pad;
}

/** A station docking pad for the orbit world: a white deck, a gold-foil rim and cyan approach lights. */
function dockingPad(): THREE.Group {
  const pad = new THREE.Group();
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.1, 12),
    new THREE.MeshStandardMaterial({ color: 0x9aa3ae, roughness: 0.6, metalness: 0.25, fog: false }));
  deck.position.y = -0.6;
  pad.add(deck);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.8, 0.16, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0xd6a849, roughness: 0.35, metalness: 0.9, side: THREE.DoubleSide, fog: false }));
  rim.position.y = -0.62;
  pad.add(rim);
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x46e6ff).multiplyScalar(1.4), toneMapped: false, fog: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.025, 6, 96), glow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -0.545;
  pad.add(ring);
  const lamp = new THREE.BoxGeometry(0.18, 0.04, 0.08);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const mesh = new THREE.Mesh(lamp, glow);
    mesh.position.set(Math.cos(a) * 2.58, -0.54, Math.sin(a) * 2.58);
    mesh.rotation.y = -a;
    pad.add(mesh);
  }
  return pad;
}

/** Alpha that is opaque in the middle and fades to nothing toward the edge, stretched over the surface it is mapped on. */
function softEdge(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [at, alpha] of [[0, 1], [0.6, 1], [1, 0]]) gradient.addColorStop(at, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** A band of light that is brightest along its middle line and fades to nothing at both sides. */
function lightBand(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  for (const [at, alpha] of [[0, 0], [0.42, 0.55], [0.5, 1], [0.58, 0.55], [1, 0]]) gradient.addColorStop(at, `rgba(255,255,255,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 64);
  return new THREE.CanvasTexture(canvas);
}

/** Red, as the LED strips in Tesla's demo. */
const STRIP_RED = new THREE.Color(1.7, 0.16, 0.1);

/**
 * The ground of the Roadster's demo, in the stage's frame (x along the road, +z toward the camera):
 * dark tarmac and the long red light strips of Tesla's night demo, one along the front of the row and
 * a longer one behind it, each with a wash of red on the ground around it. `fade` lists each material
 * with the opacity it has when fully shown.
 */
function demoStage() {
  const group = new THREE.Group();
  const maps = [softEdge(), lightBand()];
  const fade: { material: THREE.MeshBasicMaterial; opacity: number }[] = [];
  const add = (mesh: THREE.Mesh, opacity: number) => { fade.push({ material: mesh.material as THREE.MeshBasicMaterial, opacity }); group.add(mesh); return mesh; };
  const tarmac = new THREE.Mesh(new THREE.PlaneGeometry(76, 34).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x07080d, transparent: true, opacity: 0, alphaMap: maps[0], depthWrite: false }));
  tarmac.position.set(0, -0.6, -1);
  add(tarmac, 1);
  const strip = (length: number, z: number, width: number, wash: number) => {
    const core = new THREE.Mesh(new THREE.PlaneGeometry(length, width).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: STRIP_RED, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    core.position.set(0, -0.585, z);
    core.renderOrder = 2;
    add(core, 1);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(length + 3, wash).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.1, 0.06), map: maps[1], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false }));
    glow.position.set(0, -0.59, z);
    glow.renderOrder = 1;
    add(glow, 0.55);
  };
  strip(19, ROW_FRONT + 1.1, 0.2, 4);
  strip(64, ROW_FRONT + 0.15, 0.12, 2.4);
  return { group, fade, maps };
}

/** The screen's right on the ground, for the camera at (4.5, 2.6, 5.7) looking at the origin. */
const STAGE_RIGHT = new THREE.Vector3(5.7, 0, -4.5).normalize();
/** The stage's +z on the ground: toward the camera. */
const STAGE_NEAR = new THREE.Vector3(-STAGE_RIGHT.z, 0, STAGE_RIGHT.x);

/** Stage coordinates (x along the road, y up, z toward the camera) to world coordinates. */
function stageToWorld(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(STAGE_RIGHT.x * x + STAGE_NEAR.x * z, y, STAGE_RIGHT.z * x + STAGE_NEAR.z * z);
}

/** The menu's light levels, and what they become under the Roadster's night-stage look. */
const HEMI_GROUND = { day: new THREE.Color(0x25163e), night: new THREE.Color(0xb4b4c4) };
const LIGHTS = { hemi: 1.9, key: 3.5, cyan: 28, violet: 35, night: { hemi: 1.0, key: 3.2, cyan: 4, violet: 6, red: 8, up: 3 } } as const;

/** What the menu shows of the demo: nothing, the cars downloading, or the show. */
export type DemoState = 'idle' | 'loading' | 'playing';

/** Turntable speed in rad/s: about one turn every 6 s (9 s with reduced motion). */
export const MENU_SPIN = { normal: 1.05, reduced: 0.7 } as const;

/** Isolated showroom for the actual gameplay car; it never touches the simulation. */
export class MenuScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.1, 160);
  private readonly car: CarModel;
  private readonly rings = new THREE.Group();
  private readonly deck: THREE.Mesh;
  private readonly island = new THREE.Group();
  private readonly marsPad = marsPad();
  private readonly dinoPad = dinoPad();
  private readonly road = demoStage();
  private readonly stage = new THREE.Group();
  private readonly audience = new THREE.Group();
  /** Seconds into the Roadster's demo, or -1 when none is playing. */
  private demoTime = -1;
  private demoLoading = false;
  private demoPlan: DemoPlan | null = null;
  /** The parked row and the jumps that clear it, found once the cars have downloaded. */
  private row: Row | null = null;
  private jumps: JumpChoice[] = [];
  private audienceBuilt = false;
  /**
   * The Roadster's stage draws into a canvas that fills the page behind the menu, so the show can
   * leave the box without the picture ever being redrawn somewhere else. `box` is where the menu's
   * box sits in that canvas, in CSS pixels: the camera maps the box exactly as the other vehicles' do.
   */
  private stageMode = false;
  private box = { left: 0, top: 0, width: 1, height: 1 };
  /** The turntable's turn while the car is away (it stops; it turns with the car while carrying it). */
  private padYaw = 0;
  /**
   * On the menu the parked cars stand back in the dark: haze in the page's own colour takes them
   * (they are twice as far as the turntable) and leaves the turntable as clear as every other
   * vehicle's. It lifts as the camera moves in for the show.
   */
  private readonly haze = new THREE.Fog(0x0b1726, 4.5, 17);
  /** 0..1: how far the Roadster's night-stage look (dark, red strips, the parked cars) has come in. */
  private look = 0;
  private prevDemoTime = -1;
  private readonly vapour = new Vapour();
  private lights!: { hemi: THREE.HemisphereLight; key: THREE.DirectionalLight; cyan: THREE.PointLight; violet: THREE.PointLight; red: THREE.PointLight[]; up: THREE.DirectionalLight };
  private demoListener: ((state: DemoState) => void) | null = null;
  private readonly dockingPad = dockingPad();
  private readonly armory: MenuArmory;
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
    // Khronos PBR Neutral keeps base colours true; ACES shifted hues (washed-out suns, olive skies).
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.renderer.domElement);

    const hemi = new THREE.HemisphereLight(0xb9ddff, 0x25163e, LIGHTS.hemi);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, LIGHTS.key);
    key.position.set(2, 5, 4);
    this.scene.add(key);
    const cyan = new THREE.PointLight(0x31dfff, LIGHTS.cyan, 18, 1.5);
    cyan.position.set(-4, 2, 2);
    this.scene.add(cyan);
    const violet = new THREE.PointLight(0xb68aff, LIGHTS.violet, 18, 1.5);
    violet.position.set(3, 3, -3);
    this.scene.add(violet);
    // Red light along the front of the row, as from the demo's LED strips. They exist from the start (a
    // changing light count would recompile every material) and are switched on by the night-stage look.
    const red = [-6, 0, 6].map(x => {
      const light = new THREE.PointLight(0xff2a18, 0, 9, 1.6);
      const at = stageToWorld(x, 0.35, ROW_FRONT + 1.3);
      light.position.copy(at);
      this.scene.add(light);
      return light;
    });
    // Light thrown back up from the floodlit ground, for a car rolled over above the cars.
    const up = new THREE.DirectionalLight(0xffffff, 0);
    up.position.set(0, -6, 5);
    this.scene.add(up);
    this.lights = { hemi, key, cyan, violet, red, up };

    // The camera carries held items (the armory's gun and ball), so it is part of the scene.
    this.scene.add(this.camera);
    this.armory = new MenuArmory(this.renderer, this.camera, this.car, () => vehicleById(this.car.vehicleId).armory?.glass ?? null,
      () => (this.motion.matches ? MENU_SPIN.reduced : MENU_SPIN.normal), this.host);
    this.scene.add(this.armory.group);

    // The turntable car and its pad stay clear of the stage's haze, which takes only the cars parked
    // behind. The car gets its own copies of its materials for that, so the game's car is untouched.
    this.car.onBody = () => {
      if (!vehicleById(this.car.vehicleId).demo) return;
      this.car.bodyObject?.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const clear = (m: THREE.Material) => { const copy = m.clone() as THREE.MeshStandardMaterial; copy.fog = false; return copy; };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clear) : clear(mesh.material);
      });
    };
    this.car.group.scale.setScalar(MENU_SCALE);
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
    // The Roadster drives off its pad onto the road and back: the deck sits flush with the road.
    this.dockingPad.position.y = -0.045;
    this.scene.add(this.marsPad, this.dockingPad, this.dinoPad);
    // The stage turns so its road runs across the screen, whatever way the camera looks.
    this.stage.rotation.y = Math.atan2(-STAGE_RIGHT.z, STAGE_RIGHT.x);
    this.stage.visible = false;
    this.stage.add(this.road.group, this.audience);
    this.scene.add(this.stage, this.vapour.mesh);
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
    }
    // The stage's canvas follows the window, not the box.
    window.addEventListener('resize', this.resize);
    this.pose(0);
    this.resize();
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.animate);
  }

  private resize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.stageMode ? window.innerWidth : this.host.clientWidth);
    const height = Math.max(1, this.stageMode ? window.innerHeight : this.host.clientHeight);
    // The canvas's displayed size comes from the stylesheet (the box, or the whole page for the stage).
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.measureBox();
    this.placeCamera();
    this.armory.layout();
    this.renderer.render(this.scene, this.camera);
  };

  /** Where the menu's box sits in the canvas (it moves when the menu scrolls or reflows). */
  private measureBox() {
    const box = this.host.getBoundingClientRect(), canvas = this.renderer.domElement.getBoundingClientRect();
    this.box = { left: box.left - canvas.left, top: box.top - canvas.top, width: Math.max(1, box.width), height: Math.max(1, box.height) };
  }

  /** How far the camera has moved from the menu's framing to the show's (0..1), and how far along the road it has followed the car. */
  private demoCamera = 0;
  private demoCameraX = 0;

  private placeCamera() {
    const blend = this.demoCamera, follow = this.demoCameraX;
    // The menu's framing: the turntable, seen from a little above and to the side, filling the box.
    const half = Math.tan(THREE.MathUtils.degToRad(16));
    const boxAspect = this.box.width / this.box.height;
    const menuFrom = new THREE.Vector3(4.5, 2.6, 5.7).normalize().multiplyScalar(7.1 * Math.max(1, 1.6 / boxAspect));
    const menuLook = new THREE.Vector3(0, -0.05, 0);
    this.scene.fog = this.stageMode ? this.haze : null;
    this.haze.near = THREE.MathUtils.lerp(4.5, 400, blend);
    this.haze.far = THREE.MathUtils.lerp(17, 600, blend);
    if (!this.stageMode) {
      this.camera.fov = 32;
      this.camera.position.copy(menuFrom);
      this.camera.lookAt(menuLook);
      this.camera.updateProjectionMatrix();
      return;
    }
    // The same view through the box, widened to the whole canvas: in tangent units at unit distance.
    const canvas = this.renderer.domElement, width = canvas.clientWidth || window.innerWidth, height = canvas.clientHeight || window.innerHeight;
    const unit = (2 * half) / this.box.height;
    const menuLeft = -half * boxAspect - this.box.left * unit, menuTop = half + this.box.top * unit;
    const menu = { left: menuLeft, right: menuLeft + width * unit, top: menuTop, bottom: menuTop - height * unit };
    let frustum = menu, from = menuFrom, look = menuLook;
    const framing = this.demoPlan?.framing;
    if (framing && blend > 0) {
      // The show: eye level, square to the row, the picture shifted up rather than tilted.
      const t = Math.tan(THREE.MathUtils.degToRad(framing.fov / 2)), aspect = width / height;
      const show = { left: -t * aspect, right: t * aspect, top: t + framing.shift, bottom: -t + framing.shift };
      const mix = (a: number, b: number) => a + (b - a) * blend;
      frustum = { left: mix(menu.left, show.left), right: mix(menu.right, show.right), top: mix(menu.top, show.top), bottom: mix(menu.bottom, show.bottom) };
      from = new THREE.Vector3().lerpVectors(menuFrom, stageToWorld(follow, framing.eye, PATH_Z + framing.distance), blend);
      look = new THREE.Vector3().lerpVectors(menuLook, stageToWorld(follow, framing.eye, PATH_Z), blend);
    }
    this.camera.position.copy(from);
    this.camera.lookAt(look);
    const near = this.camera.near;
    this.camera.projectionMatrix.makePerspective(frustum.left * near, frustum.right * near, frustum.top * near, frustum.bottom * near, near, this.camera.far);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  setVehicle(id: string) {
    if (id !== this.car.vehicleId) { this.cancelDemo(); this.car.setVehicle(id); }
    this.applyWorld();
  }

  /** The menu hears when the cars are downloading, when the show runs and when it is over. */
  onDemoChange(listener: ((state: DemoState) => void) | null) { this.demoListener = listener; }

  get demoPlaying() { return this.demoTime >= 0 || this.demoLoading; }

  /** Parks the four cars across the stage, side by side with their fronts on one line, and finds the jumps that clear them. */
  private async buildAudience() {
    if (this.audienceBuilt) return;
    const cars = await loadAudience();
    if (this.disposed || this.audienceBuilt) return;
    const { row, placements } = layoutRow(cars.map(car => car.size));
    cars.forEach(({ model }, i) => {
      const car = model.clone(true);
      car.position.set(placements[i].x, GROUND_Y, placements[i].z);
      this.audience.add(car);
    });
    this.row = row;
    // The jumps depend only on the row, so they are worked out now rather than when the button is pressed.
    this.jumps = chooseJumps(row, searchFlights());
    this.audienceBuilt = true;
  }

  /** Plays the Roadster's stunt show; the cars have normally been downloaded already. */
  async playDemo() {
    if (!vehicleById(this.car.vehicleId).demo || this.demoPlaying || !this.stageMode) return;
    this.demoLoading = true;
    this.demoListener?.('loading');
    const requested = this.car.vehicleId;
    try {
      await this.buildAudience();
      if (this.disposed || !this.demoLoading || this.car.vehicleId !== requested || !this.row) { this.demoLoading = false; this.demoListener?.('idle'); return; }
      // Planned for this window's shape: every pass starts and ends just beyond the edge of the picture.
      const canvas = this.renderer.domElement;
      this.demoPlan = planDemo(this.row, (canvas.clientWidth || 16) / (canvas.clientHeight || 9), this.jumps);
      this.demoLoading = false;
      this.demoTime = 0;
      this.prevDemoTime = 0;
      this.padYaw = this.spin;
      this.demoListener?.('playing');
    } catch (error) {
      console.error('Demo could not be planned', error);
      this.demoLoading = false;
      this.demoListener?.('idle');
    }
  }

  /** Ends the show (it finished, or a click, Esc or another vehicle cut it short): the car is back on its turntable. */
  cancelDemo() {
    if (this.demoTime < 0 && !this.demoLoading) return;
    this.demoTime = -1;
    this.demoLoading = false;
    this.demoCamera = 0;
    this.demoCameraX = 0;
    this.car.setThrust(0, 0);
    this.car.setRollThrust(0, 0);
    this.car.group.visible = true;
    this.placeCamera();
    this.demoListener?.('idle');
  }

  /** Places the car, the turntable and the camera for one moment of the show, and fires its jets. */
  private applyDemo(pose: DemoPose, dt: number) {
    this.demoCamera = pose.camera;
    this.demoCameraX = pose.cameraX;
    const reduced = this.motion.matches;
    // The showroom's float and sway, which the car leaves as the turntable sets it down on the road.
    const bob = reduced ? 0 : Math.sin(this.time * 1.25) * 0.07, sway = reduced ? 0 : Math.sin(this.time * 0.5) * 0.025;
    const heading = this.stage.rotation.y - pose.heading * Math.PI / 2;
    // The shortest way round from the turntable's turn to the road heading.
    let delta = (heading - this.spin) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    const yaw = this.spin + delta * pose.facing;
    const car = this.car.group;
    car.visible = pose.visible;
    // Yaw first, then the barrel roll about the car's own long axis.
    car.rotation.set(0, yaw, pose.roll + sway * pose.hover, 'YXZ');
    const onRoad = GROUND_Y + ROADSTER.rest, hovering = 0.06 + bob;
    stageToWorld(pose.x, onRoad + pose.y + (hovering - onRoad) * pose.hover, pose.z, car.position);
    car.updateMatrixWorld(true);
    // The turntable turns with the car while it carries it, and stands still while the car is away.
    if (pose.onTurntable) this.padYaw = yaw;
    this.dockingPad.rotation.y = this.padYaw;
    // The jets are white cold-gas vapour, not flames: the car's own flame cones stay off.
    this.car.setThrust(0, 0);
    this.car.setRollThrust(0, 0);
    this.demoSpeed = pose.speed;
    if (pose.visible) this.fireJets(pose, dt);
    this.blasts();
  }

  private demoSpeed = 0;
  private readonly nozzles = {
    lift: [[-0.5, -0.3, -0.9], [0.5, -0.3, -0.9], [-0.5, -0.3, 0.9], [0.5, -0.3, 0.9]].map(p => new THREE.Vector3(...p)),
    roll: [[-0.95, 0.1, -0.85], [0.95, 0.1, -0.85], [-0.95, 0.1, 0.85], [0.95, 0.1, 0.85]].map(p => new THREE.Vector3(...p)),
  };
  private readonly scratch = { at: new THREE.Vector3(), dir: new THREE.Vector3(), inherited: new THREE.Vector3() };

  /** White vapour from the thrusters that are firing: the lift jets under the car and the roll jets at its sides. */
  private fireJets(pose: DemoPose, dt: number) {
    const { at, dir, inherited } = this.scratch, car = this.car.group;
    inherited.copy(STAGE_RIGHT).multiplyScalar(pose.heading * pose.speed);
    if (pose.lift > 0) {
      for (const nozzle of this.nozzles.lift) {
        for (let n = this.vapour.puffs(200 * pose.lift, dt); n > 0; n--) {
          at.copy(nozzle); car.localToWorld(at);
          dir.set(0, -1, 0).transformDirection(car.matrixWorld);
          this.vapour.jet(at, dir, 10, inherited, { size0: 0.45, size1: 2.4, life: 1.1, alpha: 1, drag: 1.6 });
        }
      }
    }
    // A roll jet turns the car by firing down on one side and up on the other; braking fires the other pair.
    for (const [side, amount] of [[1, pose.rollJets.left], [-1, pose.rollJets.right]] as const) {
      if (amount < 0.05) continue;
      for (const nozzle of this.nozzles.roll) {
        for (let n = this.vapour.puffs(110 * amount, dt); n > 0; n--) {
          at.copy(nozzle); car.localToWorld(at);
          dir.set(0, nozzle.x * side > 0 ? -1 : 1, 0).transformDirection(car.matrixWorld);
          this.vapour.jet(at, dir, 7, inherited, { size0: 0.3, size1: 1.6, life: 0.9, alpha: 0.8, drag: 1.8 });
        }
      }
    }
  }

  /** Clouds blown off the road where the lift jets fire close to it: at take-off and at touch-down. */
  private blasts() {
    const plan = this.demoPlan;
    if (!plan || this.prevDemoTime < 0) return;
    const was = this.prevDemoTime, now = this.demoTime;
    this.prevDemoTime = now;
    const cloud = { size0: 1.6, size1: 4.6, life: 3.6, alpha: 0.32, drag: 1.1, lift: 0.2 };
    if (was < plan.at.jump && now >= plan.at.jump) this.vapour.blast(stageToWorld(plan.takeoffX, GROUND_Y + 0.15, PATH_Z), 70, 6, cloud);
    if (was < plan.at.land && now >= plan.at.land) this.vapour.blast(stageToWorld(plan.landingX, GROUND_Y + 0.15, PATH_Z), 70, 6, cloud);
  }

  private applyWorld() {
    const world = vehicleWorld(this.car.vehicleId);
    this.island.visible = world === 'voxel';
    this.marsPad.visible = world === 'mars';
    this.dockingPad.visible = world === 'orbit';
    this.dinoPad.visible = world === 'dino';
    this.deck.visible = this.rings.visible = world === 'neon';
    this.armory.setEnabled(Boolean(vehicleById(this.car.vehicleId).armory));
    const demo = Boolean(vehicleById(this.car.vehicleId).demo);
    // Park the demo cars as soon as the Roadster is on show, so they are there behind it and the button works at once.
    if (demo) void this.buildAudience().catch(() => undefined);
    // The menu has already switched the canvas between the box and the whole page (see MainMenu).
    this.stageMode = demo;
    this.resize();
  }

  /** The night-stage look: the cars, tarmac and red strips fade in for the Roadster and out for the others. */
  private applyLook(dt: number) {
    const target = vehicleById(this.car.vehicleId).demo ? 1 : 0;
    this.look += Math.sign(target - this.look) * Math.min(Math.abs(target - this.look), dt * 1.6);
    const e = this.look * this.look * (3 - 2 * this.look);
    this.stage.visible = this.look > 0.001;
    this.audience.visible = this.audienceBuilt;
    this.audience.position.y = -(1 - e) * 6;
    for (const { material, opacity } of this.road.fade) material.opacity = opacity * e;
    const { hemi, key, cyan, violet, red, up } = this.lights, night = LIGHTS.night;
    up.intensity = night.up * e;
    hemi.intensity = THREE.MathUtils.lerp(LIGHTS.hemi, night.hemi, e);
    // The ground bounces light back up (the floodlit tarmac of the demo), so a car rolled over is not a silhouette.
    hemi.groundColor.copy(HEMI_GROUND.day).lerp(HEMI_GROUND.night, e);
    key.intensity = THREE.MathUtils.lerp(LIGHTS.key, night.key, e);
    cyan.intensity = THREE.MathUtils.lerp(LIGHTS.cyan, night.cyan, e);
    violet.intensity = THREE.MathUtils.lerp(LIGHTS.violet, night.violet, e);
    for (const light of red) light.intensity = night.red * e;
    this.vapour.setGlow(0.22 * e);
  }

  /** Turntable spin always runs; reduced motion only slows it and drops the bob. */
  private pose(dt: number) {
    const reduced = this.motion.matches;
    this.spin += dt * (reduced ? MENU_SPIN.reduced : MENU_SPIN.normal);
    this.applyLook(dt);
    this.marsPad.rotation.y = this.dockingPad.rotation.y = this.dinoPad.rotation.y = this.spin;
    const plan = this.demoPlan;
    if (this.demoTime >= 0 && plan) {
      this.demoTime += dt;
      if (this.demoTime >= plan.duration) this.cancelDemo();
      else this.applyDemo(plan.pose(this.demoTime), dt);
    }
    if (this.demoTime >= 0) {
      // The model is drawn larger than its physics box, so its wheels turn for the speed at that size.
      this.car.update(dt, this.demoSpeed / MENU_SCALE);
    } else {
      this.car.update(dt, 0);
      this.car.group.rotation.set(0, this.spin, reduced ? 0 : Math.sin(this.time * 0.5) * 0.025, 'XYZ');
      this.car.group.position.set(0, 0.06 + (reduced ? 0 : Math.sin(this.time * 1.25) * 0.07), 0);
    }
    if (this.stageMode) { this.measureBox(); this.placeCamera(); }
    this.vapour.update(dt);
    this.rings.rotation.y = -this.time * (reduced ? 0.04 : 0.25);
    this.island.rotation.y = this.spin;
    this.armory.update(dt);
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
    this.armory.dispose();
    this.pondTexture.dispose();
    for (const map of this.road.maps) map.dispose();
    this.vapour.dispose();
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
