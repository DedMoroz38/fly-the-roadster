import * as THREE from 'three';

/** How one puff starts and ends. Sizes are metres across, speeds m/s, times seconds. */
export interface PuffOptions {
  size0: number;
  size1: number;
  life: number;
  alpha: number;
  /** Slows the puff by this fraction per second. */
  drag?: number;
  /** Constant acceleration, e.g. a slow rise. */
  lift?: number;
}

const VERTEX = /* glsl */ `
attribute vec3 iPos;
attribute float iSize;
attribute float iAlpha;
attribute float iSeed;
varying float vSeed;
varying vec2 vUv;
varying float vAlpha;
varying float vHeight;
void main() {
  vUv = uv;
  vSeed = iSeed;
  vAlpha = iAlpha;
  vHeight = iPos.y;
  // A flat square that always faces the camera, however large: points would be limited in size.
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uCold;
uniform vec3 uGlow;
uniform float uGlowAmount;
varying float vSeed;
varying vec2 vUv;
varying float vAlpha;
varying float vHeight;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  float d = length(vUv - 0.5) * 2.0;
  // Billowy rather than a perfect disc: the edge is eaten away by noise that differs from puff to puff.
  float billow = noise(vUv * 4.0 + vSeed * 31.0) * 0.6 + noise(vUv * 9.0 - vSeed * 17.0) * 0.4;
  float soft = smoothstep(1.0, 0.0, d + (billow - 0.5) * 0.7);
  // Vapour near the ground picks up the red of the light strips.
  vec3 colour = mix(uCold, uGlow, uGlowAmount * exp(-max(vHeight + 0.6, 0.0) * 0.55));
  gl_FragColor = vec4(colour, soft * soft * vAlpha);
}`;

/**
 * Soft billboard puffs of cold-gas vapour and smoke, drawn as one instanced mesh. Thrusters and
 * ground blasts emit into it; it ages them, grows them and fades them out.
 */
export class Vapour {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly seeds: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly opts: PuffOptions[];
  private readonly geometry = new THREE.InstancedBufferGeometry();
  private readonly material: THREE.ShaderMaterial;
  private alive = 0;
  private seed = 1;

  constructor(capacity = 700) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.seeds = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.opts = new Array<PuffOptions>(capacity);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    for (const name of ['position', 'uv'] as const) this.geometry.setAttribute(name, quad.getAttribute(name));
    this.geometry.setAttribute('iPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('iSeed', new THREE.InstancedBufferAttribute(this.seeds, 1));
    this.geometry.instanceCount = 0;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
      uniforms: { uCold: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: new THREE.Color(1, 0.4, 0.34) }, uGlowAmount: { value: 0.4 } },
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** Puffs alive now. */
  get count() { return this.alive; }

  /** How strongly the ground-level vapour is tinted by the red light strips (0..1). */
  setGlow(amount: number) { this.material.uniforms.uGlowAmount.value = amount; }

  private random() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
  /** A random number in [-1, 1]. */
  private spread() { return this.random() * 2 - 1; }

  /** One puff at `at`, moving at `velocity`. With the pool full the oldest slot is reused. */
  emit(at: THREE.Vector3, velocity: THREE.Vector3, options: PuffOptions) {
    const i = this.alive < this.capacity ? this.alive++ : Math.floor(this.random() * this.capacity);
    this.pos.set([at.x, at.y, at.z], i * 3);
    this.vel.set([velocity.x, velocity.y, velocity.z], i * 3);
    this.age[i] = 0;
    this.life[i] = options.life * (0.8 + 0.4 * this.random());
    this.size[i] = options.size0;
    this.alpha[i] = 0;
    this.opts[i] = options;
    this.seeds[i] = this.random();
    (this.geometry.getAttribute('iSeed') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** A puff from a nozzle: out along `direction` at `speed` with some spread, on top of the car's own motion. */
  jet(at: THREE.Vector3, direction: THREE.Vector3, speed: number, inherited: THREE.Vector3, options: PuffOptions, spread = 1.4) {
    const v = new THREE.Vector3(direction.x * speed + this.spread() * spread, direction.y * speed + this.spread() * spread, direction.z * speed + this.spread() * spread).add(inherited);
    this.emit(at, v, options);
  }

  /** A cloud of big, slow puffs spreading out along the ground from `at`. */
  blast(at: THREE.Vector3, count: number, reach: number, options: PuffOptions) {
    for (let k = 0; k < count; k++) {
      const a = this.random() * Math.PI * 2, r = this.random() * reach * 0.4;
      const p = new THREE.Vector3(at.x + Math.cos(a) * r, at.y + this.random() * 0.4, at.z + Math.sin(a) * r);
      const out = (0.4 + this.random()) * reach * 0.5;
      this.emit(p, new THREE.Vector3(Math.cos(a) * out, 0.3 + this.random() * 0.9, Math.sin(a) * out), options);
    }
  }

  /** The two ways to ask for a random amount: a whole number of puffs for `rate` per second over `dt`. */
  puffs(rate: number, dt: number) {
    const n = rate * dt;
    return Math.floor(n) + (this.random() < n - Math.floor(n) ? 1 : 0);
  }

  update(dt: number) {
    let n = this.alive;
    for (let i = 0; i < n;) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // Swap the last live puff into this slot.
        n--;
        if (i !== n) {
          for (const arr of [this.pos, this.vel]) for (let k = 0; k < 3; k++) arr[i * 3 + k] = arr[n * 3 + k];
          this.age[i] = this.age[n]; this.life[i] = this.life[n]; this.size[i] = this.size[n]; this.alpha[i] = this.alpha[n]; this.opts[i] = this.opts[n]; this.seeds[i] = this.seeds[n];
          (this.geometry.getAttribute('iSeed') as THREE.BufferAttribute).needsUpdate = true;
        }
        continue;
      }
      const o = this.opts[i], t = this.age[i] / this.life[i];
      const drag = Math.max(0, 1 - (o.drag ?? 1.2) * dt);
      this.vel[i * 3] *= drag; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + (o.lift ?? 0) * dt; this.vel[i * 3 + 2] *= drag;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      this.size[i] = o.size0 + (o.size1 - o.size0) * Math.sqrt(t);
      // Fades in over the first moments and out over the rest.
      this.alpha[i] = o.alpha * Math.min(1, t / 0.08) * (1 - t) ** 1.4;
      i++;
    }
    this.alive = n;
    this.geometry.instanceCount = n;
    for (const name of ['iPos', 'iSize', 'iAlpha']) (this.geometry.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  clear() { this.alive = 0; this.geometry.instanceCount = 0; }

  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
