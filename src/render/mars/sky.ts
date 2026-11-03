import * as THREE from 'three';

/** The sun sits just above the horizon, ahead and to the right of the track (forward is −Z). */
export const MARS_SUN_DIR = new THREE.Vector3(0.42, 0.045, -0.9).normalize();

/** Colours are linear (THREE.Color converts from sRGB hex). */
export const MARS_SKY_COLORS = {
  zenith: new THREE.Color(0x030409),
  upper: new THREE.Color(0x1c0f10),
  /** Dust lit by the low sun: bright orange toward it, a dull rust away from it. */
  horizonSun: new THREE.Color(0xff7a2e),
  horizonAway: new THREE.Color(0x7a3418),
  below: new THREE.Color(0x4a1d0c),
  sun: new THREE.Color(0xffd9a0),
  /** Fog matches the sky just above the horizon, so distant ground melts into it. */
  haze: new THREE.Color(0x9a4a22),
};

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uSun, uZenith, uUpper, uNear, uAway, uBelow, uSunColor;
uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float toSun = dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSun.x, 0.0, uSun.z))) * 0.5 + 0.5;
  vec3 horizon = mix(uAway, uNear, pow(toSun, 4.0));
  // A thick dust layer: the horizon glow fades out quickly, then thin dark air up to the stars.
  vec3 col = h > 0.0
    ? mix(horizon, mix(uUpper, uZenith, smoothstep(0.2, 0.75, h)), smoothstep(0.0, 0.22 + pow(toSun, 6.0) * 0.12, h))
    : mix(horizon, uBelow, smoothstep(0.0, 0.12, -h));
  // Small, intense sun with a wide forward-scattered glow in the dust.
  float sunDot = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(sunDot, 2400.0) * 6.0 + pow(sunDot, 90.0) * 0.55 + pow(sunDot, 9.0) * 0.18);
  // Drifting streaks of high dust catching the light near the horizon.
  float streak = fbm(vec3(d.x * 3.0 + uTime * 0.004, d.y * 26.0, d.z * 3.0));
  col += vec3(1.0, 0.45, 0.18) * smoothstep(0.45, 0.8, streak) * exp(-h * 14.0) * (0.06 + pow(toSun, 3.0) * 0.18) * step(0.0, h);
  // Milky Way: a broad, mottled band with darker dust lanes, overhead and behind the sun.
  vec3 bandNormal = normalize(vec3(-0.5, 0.42, 0.76));
  float across = dot(d, bandNormal);
  float band = exp(-pow(across * 3.2, 2.0));
  float core = exp(-pow(across * 7.0, 2.0));
  float cloud = fbm(d * 5.0) * fbm(d * 11.0 + 7.0);
  float lanes = smoothstep(0.35, 0.65, fbm(d * 18.0 + 2.0));
  float night = smoothstep(0.05, 0.38, h) * (1.0 - pow(sunDot, 2.0) * 0.8);
  col += (vec3(0.3, 0.29, 0.4) * band * cloud * 1.1 + vec3(0.5, 0.4, 0.33) * core * cloud * 1.0 * (1.0 - lanes * 0.7)) * night * smoothstep(0.12, 0.45, h);
  // Stars: no thick air above the dust, so they are many and steady; denser inside the band.
  vec3 cell = floor(d * 520.0);
  float star = hash(cell);
  float threshold = 0.9955 - band * 0.008;
  if (star > threshold) {
    float twinkle = 0.85 + 0.15 * sin(uTime * (0.6 + star * 3.0) + star * 40.0);
    vec3 tint = mix(vec3(1.0, 0.86, 0.7), vec3(0.75, 0.85, 1.0), hash(cell + 3.0));
    col += tint * (star - threshold) / (1.0 - threshold) * 3.2 * twinkle * night;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function marsSkyMaterial(): THREE.ShaderMaterial {
  const c = MARS_SKY_COLORS;
  return new THREE.ShaderMaterial({
    vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: MARS_SUN_DIR.clone() }, uTime: { value: 0 },
      uZenith: { value: c.zenith }, uUpper: { value: c.upper },
      uNear: { value: c.horizonSun }, uAway: { value: c.horizonAway },
      uBelow: { value: c.below }, uSunColor: { value: c.sun },
    },
  });
}

/** Sky dome with the sun painted in; follows the camera so it never gets closer. */
export class MarsSky {
  readonly group = new THREE.Group();
  private readonly material = marsSkyMaterial();

  constructor() {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
  }

  update(camera: THREE.Camera, time: number) {
    this.group.position.copy(camera.position);
    this.material.uniforms.uTime.value = time;
  }

  /** A blurred copy of the sky for reflections on the metal track and props. */
  environmentMap(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
    const scene = new THREE.Scene();
    const material = marsSkyMaterial();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
    scene.add(dome);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(scene, 0.035, 0.1, 50);
    pmrem.dispose();
    material.dispose();
    dome.geometry.dispose();
    return target;
  }

  dispose() {
    this.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }
}
