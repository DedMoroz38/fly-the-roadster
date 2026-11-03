import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hashSeed, Rng } from '../../core/rng';
import type { Environment } from '../environment';
import { ParallaxLayer, type ParallaxTile } from '../parallax';
import { BaseKit } from './base';
import { archGeometry, boulderGeometry, buildCliffTile, CLIFF_CONFIG, formationGeometry, strataMaterial } from './landforms';
import { LANDMARK_CONFIG, planLandmarkTile, type StarshipSite } from './landmarks';
import { loadProp, placeProp, type PropKind } from './props';
import { MARS_SKY_COLORS, MARS_SUN_DIR, MarsSky } from './sky';
import { buildGroundTile, GROUND, groundSampler, ROCK_STRIDE, type NearFeature } from './terrain';
import { HAZARD_TIME } from './trackStyle';

/** How the Mars world scrolls: ground at full speed, landmarks at 8 %, canyon walls at 3 %. */
export const MARS_SCENERY = {
  ground: { speed: 1, ahead: GROUND.ahead, behind: GROUND.behind },
  landmarks: { speed: LANDMARK_CONFIG.speed, ahead: LANDMARK_CONFIG.ahead, behind: LANDMARK_CONFIG.behind },
  cliffs: { speed: 0.03, ahead: 1500, behind: 300 },
} as const;

/** Phases of a Starship launch, in seconds after ignition. */
export const LAUNCH = { liftoff: 3, climb: 1, pitchFrom: 12, gone: 50 } as const;

/** A tileable grey grit texture; it multiplies the baked ground colours. */
function gritTexture(): THREE.DataTexture {
  const size = 128, data = new Uint8Array(size * size * 4);
  const lattice = 16, cell = size / lattice;
  const rng = new Rng(97);
  const grid = Array.from({ length: lattice * lattice }, () => rng.next());
  const at = (i: number, j: number) => grid[((j % lattice) * lattice) + (i % lattice)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = x / cell, gy = y / cell, i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const sm = (t: number) => t * t * (3 - 2 * t);
    const smooth = THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(i, j), at(i + 1, j), sm(fx)), THREE.MathUtils.lerp(at(i, j + 1), at(i + 1, j + 1), sm(fx)), sm(fy));
    const v = Math.round(255 * Math.min(1, 0.8 + smooth * 0.14 + rng.next() * 0.08));
    data.set([v, v, v, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** A soft round sprite for dust and exhaust smoke. */
function softDot(): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
    const a = Math.max(0, 1 - d);
    data.set([255, 255, 255, Math.round(255 * a * a)], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

/** Rocket exhaust colour along the plume: white-hot at the nozzles, orange, then nothing at the tip. */
function plumeGradient(): THREE.DataTexture {
  const size = 64, data = new Uint8Array(size * 4);
  const hot = new THREE.Color(1, 0.92, 0.75), warm = new THREE.Color(1, 0.45, 0.12), c = new THREE.Color();
  for (let i = 0; i < size; i++) {
    const v = i / (size - 1);
    c.copy(hot).lerp(warm, Math.min(1, v * 2.2)).multiplyScalar(Math.pow(1 - v, 1.6));
    data.set([c.r * 255, c.g * 255, c.b * 255, 255], i * 4);
  }
  const texture = new THREE.DataTexture(data, 1, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

interface Launch { site: StarshipSite; ship: THREE.Object3D; plume: THREE.Object3D; smoke: THREE.Sprite[]; launchAt: number; startedAt: number | null; outward: number }

/** Dust motes drifting around the causeway: they stream past at the car's speed. */
const DUST = { count: 420, length: 140, width: 70, height: 26 } as const;

/**
 * Mars at dusk: a starry sky over orange dust haze, a low sun, a causeway above a dry channel,
 * rock formations and canyon walls drifting past, and now and then a sign of the first settlers:
 * a rover, a robot crew, a fuel depot, a greenhouse outpost or a Starship on its pad.
 */
export class MarsEnvironment implements Environment {
  readonly group = new THREE.Group();
  readonly background = null;
  readonly fog = new THREE.FogExp2(MARS_SKY_COLORS.haze.getHex(), 0.00082);
  readonly cameraFar = 2600;
  readonly bloom = { strength: 0.5, radius: 0.55, threshold: 0.92 };
  readonly carLight = 18;
  private readonly sky = new MarsSky();
  private readonly kit = new BaseKit();
  private readonly grit = gritTexture();
  private readonly dot = softDot();
  private readonly plumeTexture = plumeGradient();
  private readonly groundMaterial: THREE.MeshStandardMaterial;
  private readonly rockMaterial = strataMaterial();
  private readonly cliffMaterial = strataMaterial(1.25);
  private readonly plumeMaterial: THREE.MeshBasicMaterial;
  private readonly smokeMaterial: THREE.SpriteMaterial;
  private readonly plumeGeometry: THREE.BufferGeometry;
  private readonly boulder = boulderGeometry(7);
  private readonly ground: ParallaxLayer;
  private readonly landmarks: ParallaxLayer;
  private readonly cliffs: ParallaxLayer;
  private readonly height: (x: number, s: number) => number;
  private readonly launches = new Set<Launch>();
  private readonly dust: THREE.Points;
  private readonly dustSeeds: Float32Array;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private disposed = false;
  private time = 0;
  private cameraDistance = 0;

  constructor(seed: number) {
    this.height = groundSampler(seed);
    this.group.add(this.sky.group);
    this.groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: this.grit, roughness: 0.96, metalness: 0, envMapIntensity: 0.35 });
    // Additive, so the dark end of the gradient simply vanishes; brighter than white so it blooms.
    this.plumeMaterial = new THREE.MeshBasicMaterial({ map: this.plumeTexture, color: new THREE.Color(2.2, 2.2, 2.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.smokeMaterial = new THREE.SpriteMaterial({ map: this.dot, color: 0xc89070, transparent: true, opacity: 0.55, depthWrite: false });
    this.plumeGeometry = new THREE.ConeGeometry(4, 1, 16, 1, true).rotateX(Math.PI).translate(0, -0.5, 0);

    // Lighting: a low orange sun ahead, dim violet sky above, rusty bounce from the ground.
    this.group.add(new THREE.HemisphereLight(0x7a6a9c, 0x7a3418, 1.1));
    const sun = new THREE.DirectionalLight(0xffb070, 2.6);
    sun.position.copy(MARS_SUN_DIR).multiplyScalar(100);
    this.group.add(sun, sun.target);
    // Fill from behind the camera: the sun ahead leaves the side of the vehicle we see in shadow.
    const fill = new THREE.DirectionalLight(0xffe0c8, 1.1);
    fill.position.set(-2, 7, 14);
    this.group.add(fill);
    const under = new THREE.DirectionalLight(0xff8a50, 0.45);
    under.position.set(3, -10, 2);
    this.group.add(under);

    this.cliffs = new ParallaxLayer({ ...MARS_SCENERY.cliffs, tileLength: CLIFF_CONFIG.tileLength, build: index => this.cliffTile(seed, index) });
    this.landmarks = new ParallaxLayer({ ...MARS_SCENERY.landmarks, tileLength: LANDMARK_CONFIG.tileLength, build: index => this.landmarkTile(seed, index) });
    this.ground = new ParallaxLayer({ ...MARS_SCENERY.ground, tileLength: GROUND.tileLength, build: index => this.groundTile(seed, index) });
    this.group.add(this.cliffs.group, this.landmarks.group, this.ground.group);

    const positions = new Float32Array(DUST.count * 3);
    this.dustSeeds = new Float32Array(DUST.count * 3);
    const rng = new Rng(hashSeed(`${seed}:dust`));
    for (let i = 0; i < DUST.count; i++) this.dustSeeds.set([rng.range(-1, 1) * DUST.width, rng.range(-4, DUST.height), rng.next() * DUST.length], i * 3);
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ map: this.dot, color: 0xe0a070, size: 0.32, transparent: true, opacity: 0.45, depthWrite: false }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);
  }

  /**
   * The launch plume and smoke stay hidden until a launch, and the renderer only compiles what is
   * visible; the downloaded models arrive later. Compile them all ahead of time, in the background,
   * so neither a launch nor the first rover or robot freezes the game while shaders build.
   */
  prepare(precompile: (object: THREE.Object3D) => void) {
    const effects = new THREE.Group();
    effects.add(new THREE.Mesh(this.plumeGeometry, this.plumeMaterial), new THREE.Sprite(this.smokeMaterial));
    precompile(effects);
    for (const kind of ['starship', 'rover', 'robot'] as PropKind[]) {
      void loadProp(kind).then(template => { if (template && !this.disposed) precompile(template); });
    }
  }

  environmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
    this.envTarget ??= this.sky.environmentMap(renderer);
    return this.envTarget.texture;
  }

  private cliffTile(seed: number, index: number): ParallaxTile {
    const geometry = buildCliffTile(seed, index);
    const object = new THREE.Group();
    object.add(new THREE.Mesh(geometry, this.cliffMaterial));
    return { object, dispose: () => geometry.dispose() };
  }

  private groundTile(seed: number, index: number): ParallaxTile {
    const tile = buildGroundTile(seed, index);
    const object = new THREE.Group();
    const owned: THREE.BufferGeometry[] = [tile.geometry];
    object.add(new THREE.Mesh(tile.geometry, this.groundMaterial));

    const count = tile.rocks.length / ROCK_STRIDE;
    const rocks = new THREE.InstancedMesh(this.boulder, this.rockMaterial, count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color(0x9a4c2a), color = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const r = tile.rocks.subarray(i * ROCK_STRIDE, (i + 1) * ROCK_STRIDE);
      m.compose(p.set(r[0], r[1], r[2]), q.setFromAxisAngle(up, r[6]), s.set(r[3], r[4], r[5]));
      rocks.setMatrixAt(i, m);
      rocks.setColorAt(i, color.copy(tint).multiplyScalar(r[7]));
    }
    object.add(rocks);

    for (const o of tile.outcrops) {
      const geometry = formationGeometry(o.kind, o.radius, o.height, o.seed);
      const mesh = new THREE.Mesh(geometry, this.rockMaterial);
      mesh.position.set(o.x, o.y - 0.5, -o.t);
      mesh.rotation.y = o.yaw;
      object.add(mesh);
      owned.push(geometry);
    }

    const animations: ((time: number) => void)[] = [];
    for (const feature of tile.features) animations.push(this.nearFeature(object, feature, index));
    return {
      object,
      animate: time => { for (const a of animations) a(time); },
      dispose: () => { for (const g of owned) g.dispose(); rocks.dispose(); },
    };
  }

  /** Builds a near-track sight and returns its per-frame animation. */
  private nearFeature(parent: THREE.Object3D, f: NearFeature, index: number): (time: number) => void {
    const rng = new Rng(f.seed);
    const s0 = index * GROUND.tileLength;
    if (f.kind === 'rover') {
      // A rover crawling across the plain, roughly along the track, following the ground.
      const rover = placeProp('rover', parent);
      const heading = (rng.chance(0.5) ? 0 : Math.PI) + rng.range(-0.6, 0.6);
      const dx = Math.sin(heading), dt = Math.cos(heading);
      return time => {
        const travelled = (time * 0.6) % 120 - 20;
        const x = f.x + dx * travelled * 0.4, t = f.t + dt * travelled;
        rover.position.set(x, this.height(x, s0 + t) + 0.05, -t);
        // The model faces +X; it moves by (0.4·dx, −dt) in world x and z.
        rover.rotation.y = Math.atan2(dt, dx * 0.4);
      };
    }
    if (f.kind === 'crew') {
      // Robots carrying gear between a landed cargo pod and a row of solar panels.
      const site = new THREE.Group();
      site.position.set(f.x, f.y, -f.t);
      parent.add(site);
      const pod = this.kit.cargoPod();
      site.add(pod);
      const field = this.kit.solarField(rng, 1, 4);
      // Work happens on the far side of the pod, so nobody walks out over the channel bank.
      const workX = Math.sign(f.x) * rng.range(1, 5), workZ = rng.range(10, 14) * (rng.chance(0.5) ? -1 : 1);
      field.position.set(workX, 0, workZ + Math.sign(workZ) * 4);
      site.add(field);
      const robots = Array.from({ length: rng.int(2, 3) }, (_, i) => ({ holder: placeProp('robot', site), offset: i * 7.3 + rng.range(0, 3), lane: (i - 1) * 1.6 }));
      const from = new THREE.Vector2(0, 2.5), to = new THREE.Vector2(workX, workZ);
      const length = from.distanceTo(to), speed = 1.1, pause = 2.5;
      const cycle = (length / speed + pause) * 2;
      return time => {
        for (const robot of robots) {
          const c = (time + robot.offset) % cycle;
          const half = cycle / 2;
          const going = c < half;
          const k = Math.min(1, (going ? c : c - half) * speed / length);
          const walking = k < 1;
          const a = going ? from : to, b = going ? to : from;
          const x = a.x + (b.x - a.x) * k + robot.lane, z = a.y + (b.y - a.y) * k;
          const stride = walking ? Math.abs(Math.sin(time * 5.6 + robot.offset)) : 0;
          robot.holder.position.set(x, stride * 0.05, z);
          robot.holder.rotation.set(0, Math.atan2(-(b.y - a.y), b.x - a.x), walking ? Math.sin(time * 5.6 + robot.offset) * 0.035 : 0);
        }
      };
    }
    const depot = this.kit.depot(rng);
    depot.position.set(f.x, f.y, -f.t);
    // The tank row runs along the track.
    depot.rotation.y = Math.PI / 2 + rng.range(-0.25, 0.25);
    parent.add(depot);
    return () => {};
  }

  private landmarkTile(seed: number, index: number): ParallaxTile {
    const plan = planLandmarkTile(seed, index);
    const object = new THREE.Group();
    const parts: THREE.BufferGeometry[] = [];
    const baseY = LANDMARK_CONFIG.baseY;
    for (const f of plan.formations) {
      const g = formationGeometry(f.kind, f.radius, f.height, f.seed);
      g.rotateY(f.yaw).translate(f.x, baseY - 2, -f.t);
      parts.push(g);
    }
    for (const a of plan.arches) {
      const g = archGeometry(a.span, a.height, a.thickness, a.seed);
      // The opening faces the track, so the sky shows through it as it drifts by.
      g.rotateY(Math.PI / 2 + a.yaw).translate(a.x, baseY - 1, -a.t);
      parts.push(g);
    }
    let merged: THREE.BufferGeometry | null = null;
    if (parts.length) {
      merged = mergeGeometries(parts, false);
      for (const p of parts) p.dispose();
      object.add(new THREE.Mesh(merged, this.rockMaterial));
    }
    const instanced: THREE.InstancedMesh[] = [];
    let launch: Launch | null = null;
    if (plan.site) {
      const rng = new Rng(plan.site.seed);
      const holder = new THREE.Group();
      holder.position.set(plan.site.x, baseY, -plan.site.t);
      object.add(holder);
      const outward = Math.sign(plan.site.x);
      if (plan.site.kind === 'outpost') {
        const outpost = this.kit.outpost(rng);
        outpost.rotation.y = rng.range(-0.4, 0.4);
        holder.add(outpost);
      } else {
        const site = plan.site;
        const pad = this.kit.pad(site.ships.length > 1 ? 58 : 36);
        pad.position.y = 0.6;
        holder.add(pad);
        // Propellant farm behind the pad, away from the track, with light masts.
        for (let i = 0; i < rng.int(2, 4); i++) {
          const tank = this.kit.tank(rng.range(5, 7.5), rng.range(22, 34));
          tank.position.set(outward * rng.range(80, 105), 0, (i - 1.5) * 19 + rng.range(-2, 2));
          holder.add(tank);
        }
        for (const z of [-55, 55]) {
          const mast = this.kit.mast(rng.range(34, 44));
          mast.position.set(outward * 60, 0, z);
          holder.add(mast);
        }
        site.ships.forEach((spot, i) => {
          const ship = new THREE.Group();
          ship.position.set(spot.dx, 0.6, spot.dz);
          holder.add(ship);
          placeProp('starship', ship).rotation.y = rng.range(0, Math.PI * 2);
          if (site.launcher !== i) return;
          const plume = new THREE.Group();
          for (const [radius, length, opacity] of [[1, 1, 1], [0.55, 0.62, 1]]) {
            const cone = new THREE.Mesh(this.plumeGeometry, this.plumeMaterial);
            cone.scale.set(radius, length, radius);
            cone.userData.opacity = opacity;
            plume.add(cone);
          }
          plume.visible = false;
          ship.add(plume);
          const smoke = Array.from({ length: 10 }, () => {
            const puff = new THREE.Sprite(this.smokeMaterial.clone());
            puff.visible = false;
            holder.add(puff);
            return puff;
          });
          launch = { site, ship, plume, smoke, launchAt: site.launchAt, startedAt: null, outward };
          this.launches.add(launch);
        });
      }
      holder.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) instanced.push(o as THREE.InstancedMesh); });
    }
    return {
      object,
      dispose: () => {
        merged?.dispose();
        for (const mesh of instanced) mesh.dispose();
        if (launch) {
          for (const puff of launch.smoke) puff.material.dispose();
          this.launches.delete(launch);
        }
      },
    };
  }

  /** Drives one launch: waits for the car to travel far enough, then lifts off and climbs away. */
  private updateLaunch(l: Launch) {
    if (this.cameraDistance < l.launchAt) {
      // Before launch (or after a restart): the ship stands on its pad.
      if (l.startedAt !== null) {
        l.startedAt = null;
        l.ship.position.y = 0.6;
        l.ship.rotation.set(0, 0, 0);
        l.ship.visible = true;
        l.plume.visible = false;
        for (const puff of l.smoke) puff.visible = false;
      }
      return;
    }
    l.startedAt ??= this.time;
    const p = this.time - l.startedAt;
    const rise = Math.max(0, p - LAUNCH.liftoff);
    l.ship.position.y = 0.6 + LAUNCH.climb * rise * rise;
    // A slow pitch away from the track once clear of the pad.
    l.ship.rotation.z = -l.outward * Math.min(0.55, Math.max(0, p - LAUNCH.pitchFrom) * 0.025);
    l.ship.visible = p < LAUNCH.gone;
    const ignite = Math.min(1, p / LAUNCH.liftoff);
    l.plume.visible = l.ship.visible;
    l.plume.children.forEach((cone, i) => {
      const flicker = 0.85 + Math.sin(this.time * 37 + i * 2) * 0.08 + Math.sin(this.time * 23.7) * 0.07;
      const length = (14 + Math.min(60, rise * 6)) * ignite * flicker * (i ? 0.62 : 1);
      cone.scale.set((i ? 0.55 : 1) * (0.6 + ignite * 0.4), length, (i ? 0.55 : 1) * (0.6 + ignite * 0.4));
    });
    // Billowing dust and exhaust spreading out from the pad, fading over half a minute.
    l.smoke.forEach((puff, i) => {
      const a = (i / l.smoke.length) * Math.PI * 2 + 0.3;
      const age = Math.max(0, p - i * 0.15);
      const spread = Math.min(1, age / 9);
      puff.visible = age > 0 && age < 32;
      puff.position.set(Math.cos(a) * (8 + spread * 60), 6 + spread * 14 + age * 0.4, Math.sin(a) * (8 + spread * 60));
      puff.scale.setScalar(18 + spread * 46);
      puff.material.opacity = 0.6 * Math.min(1, age * 2) * Math.max(0, 1 - age / 32);
    });
  }

  update(camera: THREE.PerspectiveCamera, cameraDistance: number, dt: number) {
    this.time += dt;
    this.cameraDistance = cameraDistance;
    HAZARD_TIME.value = this.time;
    this.sky.update(camera, this.time);
    // Beacons blink in unison, about once a second.
    this.kit.beacon.color.setRGB(3, 0.3, 0.1).multiplyScalar(Math.sin(this.time * 4) > 0.2 ? 1 : 0.12);
    this.ground.update(camera.position.z, cameraDistance, this.time);
    this.landmarks.update(camera.position.z, cameraDistance, this.time);
    this.cliffs.update(camera.position.z, cameraDistance, this.time);
    for (const launch of this.launches) this.updateLaunch(launch);

    // Dust motes keep their course position, wrapped into a box that travels with the camera.
    const positions = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < DUST.count; i++) {
      const x = this.dustSeeds[i * 3], y = this.dustSeeds[i * 3 + 1], s = this.dustSeeds[i * 3 + 2];
      const ahead = THREE.MathUtils.euclideanModulo(s - cameraDistance - this.time * 1.5, DUST.length) - 20;
      const drift = THREE.MathUtils.euclideanModulo(x + this.time * 2.2 + DUST.width, DUST.width * 2) - DUST.width;
      positions.setXYZ(i, drift, y + Math.sin(this.time * 0.7 + i) * 0.4, camera.position.z - ahead);
    }
    positions.needsUpdate = true;
  }

  dispose() {
    this.disposed = true;
    this.ground.dispose();
    this.landmarks.dispose();
    this.cliffs.dispose();
    this.sky.dispose();
    this.kit.dispose();
    this.boulder.dispose();
    this.plumeGeometry.dispose();
    this.plumeTexture.dispose();
    for (const m of [this.groundMaterial, this.rockMaterial, this.cliffMaterial, this.plumeMaterial, this.smokeMaterial]) m.dispose();
    this.grit.dispose();
    this.dot.dispose();
    this.dust.geometry.dispose();
    (this.dust.material as THREE.Material).dispose();
    this.envTarget?.dispose();
    this.group.clear();
  }
}
