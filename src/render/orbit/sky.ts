import * as THREE from 'three';

/**
 * The sun: about 40° to the left of straight ahead and 22° up, in the upper left of the view. The
 * ground below is in daylight, the light rakes across the track, and the night side (with city
 * lights) lies past the right-hand horizon.
 */
export const ORBIT_SUN_DIR = new THREE.Vector3(-0.6, 0.38, -0.7).normalize();

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uMeteorFrom[METEORS];
uniform vec3 uMeteorTo[METEORS];
uniform float uMeteorT[METEORS];
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  vec3 col = vec3(0.004, 0.005, 0.012);
  // Milky Way: a broad band with a brighter, dust-laned core.
  vec3 bandNormal = normalize(vec3(0.3, 0.7, 0.65));
  float across = dot(d, bandNormal);
  float band = exp(-pow(across * 3.0, 2.0));
  float core = exp(-pow(across * 7.5, 2.0));
  float cloud = fbm(d * 5.0) * fbm(d * 12.0 + 4.0);
  float lanes = smoothstep(0.38, 0.62, fbm(d * 17.0 + 9.0));
  col += (vec3(0.2, 0.22, 0.32) * band * cloud * 1.2 + vec3(0.42, 0.36, 0.3) * core * cloud * (1.0 - lanes * 0.75)) * 0.55;
  // Stars: sharp and steady, in a range of colours; a few bright ones and many faint ones, kept
  // below the bloom threshold so the sky stays dark.
  vec3 cell = floor(d * 600.0);
  float star = hash(cell);
  float threshold = 0.9989 - band * 0.0012;
  if (star > threshold) {
    vec3 tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), hash(cell + 5.0));
    col += tint * pow((star - threshold) / (1.0 - threshold), 2.2) * 1.5;
  }
  // Shooting stars: a white-hot head with a tail fading behind it, along a short arc.
  for (int i = 0; i < METEORS; i++) {
    float t = uMeteorT[i];
    if (t <= 0.0 || t >= 1.0) continue;
    vec3 head = normalize(mix(uMeteorFrom[i], uMeteorTo[i], t));
    vec3 tail = normalize(mix(uMeteorFrom[i], uMeteorTo[i], max(0.0, t - 0.4)));
    vec3 ab = head - tail;
    float along = clamp(dot(d - tail, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
    float dist = length(d - tail - ab * along);
    float streak = exp(-pow(dist / 0.0018, 2.0)) * along * along;
    col += vec3(1.0, 0.95, 0.86) * streak * 2.6 * sin(t * 3.14159);
  }
  // The sun: a small, white-hot disc with a tight glow; bright enough to bloom, not so bright that
  // the bloom spreads into a square.
  float s = max(dot(d, uSun), 0.0);
  col += vec3(1.0, 0.97, 0.92) * (pow(s, 4000.0) * 9.0 + pow(s, 300.0) * 0.5 + pow(s, 24.0) * 0.04);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Shooting stars: at most this many at once, one every few seconds, each a short streak. */
export const METEORS = { slots: 2, every: [2.5, 7], duration: [0.5, 1.0], arc: [10, 24] } as const;

interface Meteor { from: THREE.Vector3; to: THREE.Vector3; age: number; duration: number }

/** Star sphere with the sun and shooting stars painted in; follows the camera so it never gets closer. */
export class OrbitSky {
  readonly group = new THREE.Group();
  private readonly meteors: (Meteor | null)[] = Array.from({ length: METEORS.slots }, () => null);
  private nextMeteor = 1.5;
  private readonly material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false,
    defines: { METEORS: METEORS.slots },
    uniforms: {
      uSun: { value: ORBIT_SUN_DIR.clone() },
      uMeteorFrom: { value: Array.from({ length: METEORS.slots }, () => new THREE.Vector3(0, 1, 0)) },
      uMeteorTo: { value: Array.from({ length: METEORS.slots }, () => new THREE.Vector3(0, 1, 0)) },
      uMeteorT: { value: new Array(METEORS.slots).fill(0) },
    },
  });

  constructor() {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
  }

  update(camera: THREE.Camera, dt: number) {
    this.group.position.copy(camera.position);
    const range = (r: readonly [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    this.nextMeteor -= dt;
    const free = this.meteors.indexOf(null);
    if (this.nextMeteor <= 0 && free >= 0) {
      this.nextMeteor = range(METEORS.every);
      // Somewhere ahead in the upper sky (forward is −Z), heading off at a slant, mostly downward.
      const azimuth = THREE.MathUtils.degToRad(range([-60, 60])), elevation = THREE.MathUtils.degToRad(range([10, 38]));
      const from = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
      const east = new THREE.Vector3(0, 1, 0).cross(from).normalize();
      // east × from points down the sky (straight ahead: (−1, 0, 0) × (0, 0, −1) = (0, −1, 0)).
      const down = new THREE.Vector3().crossVectors(east, from).normalize();
      const slant = THREE.MathUtils.degToRad(range([15, 70])) * (Math.random() < 0.5 ? -1 : 1);
      const travel = east.multiplyScalar(Math.sin(slant)).addScaledVector(down, Math.cos(slant)).normalize();
      const arc = THREE.MathUtils.degToRad(range(METEORS.arc));
      const to = from.clone().multiplyScalar(Math.cos(arc)).addScaledVector(travel, Math.sin(arc)).normalize();
      this.meteors[free] = { from, to, age: 0, duration: range(METEORS.duration) };
    }
    const u = this.material.uniforms;
    this.meteors.forEach((m, i) => {
      if (m) {
        m.age += dt;
        u.uMeteorFrom.value[i].copy(m.from);
        u.uMeteorTo.value[i].copy(m.to);
        if (m.age >= m.duration) this.meteors[i] = null;
      }
      u.uMeteorT.value[i] = m && m.age < m.duration ? m.age / m.duration : 0;
    });
  }

  dispose() {
    (this.group.children[0] as THREE.Mesh).geometry.dispose();
    this.material.dispose();
  }
}
