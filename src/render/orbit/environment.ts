import * as THREE from 'three';
import { Rng, hashSeed } from '../../core/rng';
import type { Environment } from '../environment';
import { HAZARD_TIME } from '../mars/trackStyle';
import { Earth, EARTH_ROUTES, farthestVisible } from './earth';
import { ShowSchedule, showHeading, showPosition, SHOW_KINDS, type ShowEvent, type ShowKind } from './show';
import { ORBIT_SUN_DIR, OrbitSky } from './sky';
import { loadSpaceModel, SPACE_MODELS, type LoadedSpaceModel, type SpaceModel } from './spaceProps';

/** How each kind moves while it is on screen (on top of following its path). */
export const SHOW_MOTION = {
  /**
   * EVE trails WALL-E along his path by this much progress (about 25 m), further out and lower:
   * straight behind him she would be hidden by him from the camera.
   */
  eveLag: 0.03,
  eveOffset: [-10, -4, 0],
  spray: { rate: 34, life: 1.3, speed: 7, size: [0.35, 2.6] },
} as const;

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/** A soft round sprite for the extinguisher spray. */
function puffTexture(): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    data.set([255, 255, 255, Math.round(255 * Math.max(0, 1 - d) ** 1.8)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

/** Reflections for metal and foil: black space above, Earth's blue-white glow below, the sun. */
function environmentScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uSun: { value: ORBIT_SUN_DIR } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uSun; varying vec3 vDir; void main() {
      vec3 d = normalize(vDir);
      vec3 earth = mix(vec3(0.05, 0.08, 0.14), vec3(0.3, 0.45, 0.7), smoothstep(-0.2, -0.6, d.y));
      vec3 col = d.y < -0.34 ? earth : vec3(0.01, 0.012, 0.02);
      col += vec3(1.0, 0.97, 0.92) * pow(max(dot(d, uSun), 0.0), 200.0) * 40.0;
      gl_FragColor = vec4(col, 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material));
  return scene;
}

interface Spray { sprite: THREE.Sprite; position: THREE.Vector3; velocity: THREE.Vector3; age: number }

/**
 * Low Earth orbit: the planet below with day, night and clouds, the sun over its limb, stars, and
 * now and then something drifting by on its own course: the ISS, a Space Shuttle, Voyager, Starman's
 * Roadster, the Millennium Falcon, the spinning Endurance, or WALL-E on his fire extinguisher with
 * EVE in pursuit. One at a time, each on screen for 500–700 m of travel, 200–700 m apart.
 */
export class OrbitEnvironment implements Environment {
  readonly group = new THREE.Group();
  readonly background = null;
  /** Black haze only fades the far end of the track; Earth, sky and the visitors ignore it. */
  readonly fog = new THREE.FogExp2(0x000000, 0.0009);
  readonly cameraFar = Math.ceil(farthestVisible() + 150);
  readonly bloom = { strength: 0.5, radius: 0.5, threshold: 0.92 };
  readonly carLight = 20;
  private readonly sky = new OrbitSky();
  private readonly earth: Earth;
  private schedule: ShowSchedule;
  /** Visitors ride in a frame that follows the camera along the track, so they keep their place in view. */
  private readonly stage = new THREE.Group();
  private readonly puff = puffTexture();
  private readonly sprayMaterial = new THREE.SpriteMaterial({ map: this.puff, color: 0xeef2f6, transparent: true, depthWrite: false, fog: false });
  private readonly sprays: Spray[] = [];
  private readonly loaded = new Map<SpaceModel, LoadedSpaceModel>();
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private current: ShowEvent | null = null;
  private shown: SpaceModel[] = [];
  private mixer: THREE.AnimationMixer | null = null;
  private precompile: ((object: THREE.Object3D) => void) | null = null;
  private disposed = false;
  private time = 0;
  private sprayDebt = 0;
  private readonly lastWallE = new THREE.Vector3();
  private hasLastWallE = false;
  /** WALL-E's extinguisher mesh (null if the model has none), found once. */
  private horn: THREE.Mesh | null | undefined;

  constructor(seed: number) {
    this.earth = new Earth(new Rng(hashSeed(`${seed >>> 0}:earth`)).pick(EARTH_ROUTES));
    // The order of visitors is new for every run, restarts included, unlike the course itself.
    this.schedule = new ShowSchedule(randomSeed());
    this.group.add(this.sky.group, this.earth.group, this.stage);
    // Hard sunlight, blue earthshine from below, and a fill from behind the camera on the car's visible side.
    const sun = new THREE.DirectionalLight(0xfff4e6, 3.2);
    sun.position.copy(ORBIT_SUN_DIR).multiplyScalar(100);
    this.group.add(sun, sun.target);
    this.group.add(new THREE.HemisphereLight(0x1a2238, 0x3a64a8, 1.0));
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.7);
    fill.position.set(-2, 7, 14);
    this.group.add(fill);
    // Download the visitors in the order they will appear.
    const order = [...new Set([...this.schedule.first(SHOW_KINDS.length).map(e => e.kind), ...SHOW_KINDS])];
    for (const kind of order) for (const name of this.modelsOf(kind)) {
      void loadSpaceModel(name).then(model => {
        if (!model || this.disposed) return;
        this.loaded.set(name, model);
        this.precompile?.(model.object);
      });
    }
  }

  private modelsOf(kind: ShowKind): SpaceModel[] {
    return kind === 'wall-e' ? ['wall-e', 'eve'] : [kind];
  }

  prepare(precompile: (object: THREE.Object3D) => void) {
    this.precompile = precompile;
    for (const model of this.loaded.values()) precompile(model.object);
    const spray = new THREE.Sprite(this.sprayMaterial);
    precompile(spray);
  }

  environmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
    // The first point where the renderer is known: Earth picks its imagery to suit the GPU.
    this.earth.load(renderer);
    if (!this.envTarget) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const scene = environmentScene();
      this.envTarget = pmrem.fromScene(scene, 0.03);
      pmrem.dispose();
      scene.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    }
    return this.envTarget.texture;
  }

  /** Puts the right visitors on stage for the current distance; models still downloading join when ready. */
  private cast(event: ShowEvent | null) {
    if (event === this.current) {
      if (event && this.modelsOf(event.kind).some(name => this.loaded.has(name) && !this.shown.includes(name))) this.current = null;
      else return;
    }
    for (const name of this.shown) this.stage.remove(this.loaded.get(name)!.object);
    this.mixer?.stopAllAction();
    this.mixer = null;
    for (const spray of [...this.sprays]) this.dropSpray(spray);
    this.shown = [];
    this.current = event;
    this.hasLastWallE = false;
    if (!event) return;
    for (const name of this.modelsOf(event.kind)) {
      const model = this.loaded.get(name);
      if (!model) continue;
      this.stage.add(model.object);
      this.shown.push(name);
      if (name === 'wall-e') {
        const idle = model.gltf.animations.find(a => /Idle_Base/.test(a.name)) ?? model.gltf.animations[0];
        if (idle) { this.mixer = new THREE.AnimationMixer(model.gltf.scene); this.mixer.clipAction(idle).play(); }
      }
    }
  }

  /** Turns `object` so the model's own nose (`forward`) points along `heading`, banked by `roll`. */
  private face(object: THREE.Object3D, name: SpaceModel, heading: THREE.Vector3, roll = 0) {
    const [fx, fy, fz] = SPACE_MODELS[name].forward;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(fx, fy, fz), heading.clone().normalize());
    // Keep the model's top roughly up, then bank about the heading.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const wantUp = new THREE.Vector3(0, 1, 0).projectOnPlane(heading).normalize();
    if (wantUp.lengthSq() > 0.5) {
      const twist = Math.atan2(new THREE.Vector3().crossVectors(up, wantUp).dot(heading.clone().normalize()), up.dot(wantUp));
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(heading.clone().normalize(), twist + roll));
    }
    object.quaternion.copy(q);
  }

  private pose(event: ShowEvent, progress: number, dt: number) {
    const t = this.time, rng = new Rng(event.seed);
    const phase = rng.range(0, Math.PI * 2);
    for (const name of this.shown) {
      const object = this.loaded.get(name)!.object;
      const lag = name === 'eve' ? SHOW_MOTION.eveLag : 0;
      const p = progress - lag;
      showPosition(event.kind, p, object.position);
      const heading = showHeading(event.kind, p);
      switch (name) {
        case 'iss':
          // A slow, steady turn, as it holds its attitude while we drift past.
          object.rotation.set(0.35, phase + t * 0.06, 0.2);
          break;
        case 'voyager':
          object.quaternion.setFromAxisAngle(new THREE.Vector3(0.3, 1, 0.5).normalize(), phase + t * 0.22);
          break;
        case 'roadster':
          // Tumbling end over end, as Starman's car really does.
          object.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0.25, 0.15).normalize(), phase + t * 0.45);
          break;
        case 'interstellar': {
          // The ring spins about its own axis (the model's X), which is tipped toward us so the ring reads.
          const axis = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.45, 0.35, 1).normalize());
          object.quaternion.copy(axis).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), t * 0.5));
          break;
        }
        case 'millennium': {
          // Banks into its turns: the sideways change of heading sets the roll.
          const ahead = showHeading(event.kind, p + 0.02);
          const turn = new THREE.Vector3().crossVectors(heading, ahead).y;
          this.face(object, name, heading, THREE.MathUtils.clamp(-turn * 18, -0.9, 0.9));
          break;
        }
        case 'eve': {
          // EVE chases WALL-E: she faces him, beside his line, so neither hides the other.
          const [ox, oy, oz] = SHOW_MOTION.eveOffset;
          object.position.add(new THREE.Vector3(ox, oy + Math.sin(t * 1.3) * 0.8, oz));
          const wallE = this.loaded.get('wall-e')?.object;
          const toward = wallE && this.shown.includes('wall-e') ? wallE.position.clone().sub(object.position) : heading;
          this.face(object, name, toward.lengthSq() > 1e-6 ? toward : heading);
          break;
        }
        default:
          this.face(object, name, heading, name === 'shuttle' ? Math.sin(t * 0.3) * 0.15 : 0);
      }
    }
    if (this.shown.includes('wall-e')) this.spray(dt);
  }

  /** WALL-E's extinguisher: puffs from the horn, blown back opposite his travel, spreading and fading. */
  private spray(dt: number) {
    const model = this.loaded.get('wall-e')!;
    const wallE = model.object;
    const velocity = this.hasLastWallE && dt > 0 ? wallE.position.clone().sub(this.lastWallE).divideScalar(dt) : new THREE.Vector3();
    this.lastWallE.copy(wallE.position);
    this.hasLastWallE = true;
    if (this.horn === undefined) {
      this.horn = null;
      model.gltf.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name === 'FireExtinguisher_COMN') this.horn = m; });
    }
    const horn = this.horn;
    if (!horn) return;
    // Vertex 0 is the tip of the extinguisher's horn (found from the animated pose).
    const tip = horn.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(horn.matrixWorld);
    this.stage.worldToLocal(tip);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(wallE.quaternion);
    const { rate, life, speed } = SHOW_MOTION.spray;
    this.sprayDebt += rate * dt;
    while (this.sprayDebt >= 1) {
      this.sprayDebt -= 1;
      const sprite = new THREE.Sprite(this.sprayMaterial.clone());
      const jitter = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2.2);
      this.stage.add(sprite);
      this.sprays.push({ sprite, position: tip.clone(), velocity: velocity.clone().addScaledVector(back, speed).add(jitter), age: 0 });
    }
    for (const s of [...this.sprays]) {
      s.age += dt;
      s.position.addScaledVector(s.velocity, dt);
      const k = s.age / life;
      s.sprite.position.copy(s.position);
      s.sprite.scale.setScalar(THREE.MathUtils.lerp(SHOW_MOTION.spray.size[0], SHOW_MOTION.spray.size[1], k));
      s.sprite.material.opacity = 0.75 * (1 - k) * Math.min(1, s.age * 10);
      if (k >= 1) this.dropSpray(s);
    }
  }

  private dropSpray(s: Spray) {
    this.stage.remove(s.sprite);
    s.sprite.material.dispose();
    this.sprays.splice(this.sprays.indexOf(s), 1);
  }

  reset() {
    this.cast(null);
    this.schedule = new ShowSchedule(randomSeed());
  }

  update(camera: THREE.PerspectiveCamera, cameraDistance: number, dt: number) {
    this.time += dt;
    HAZARD_TIME.value = this.time;
    this.sky.update(camera, dt);
    this.earth.update(camera, cameraDistance, this.time);
    // The stage follows the camera along the track (not its sideways or up-and-down moves).
    this.stage.position.set(0, 0, camera.position.z);
    const now = this.schedule.at(cameraDistance);
    this.cast(now?.event ?? null);
    if (!now) for (const s of [...this.sprays]) this.dropSpray(s);
    this.mixer?.update(dt);
    if (now && this.shown.length) this.pose(now.event, now.progress, dt);
  }

  dispose() {
    this.disposed = true;
    this.cast(null);
    for (const s of [...this.sprays]) this.dropSpray(s);
    this.sky.dispose();
    this.earth.dispose();
    this.puff.dispose();
    this.sprayMaterial.dispose();
    this.envTarget?.dispose();
    this.group.clear();
  }
}
