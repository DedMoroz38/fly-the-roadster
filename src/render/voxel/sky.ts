import * as THREE from 'three';
import { SUN_DIR } from './islands';

/** Colours are linear (THREE.Color converts from sRGB hex). */
export const SKY_COLORS = {
  zenith: new THREE.Color(0x070a26),
  upper: new THREE.Color(0x231b55),
  horizonWarm: new THREE.Color(0xff8448),
  horizonCool: new THREE.Color(0x5a3f86),
  below: new THREE.Color(0x2a2150),
  sun: new THREE.Color(0xffc27a),
};

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uSun, uZenith, uUpper, uWarm, uCool, uBelow, uSunColor;
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
  vec3 horizon = mix(uCool, uWarm, pow(toSun, 3.0));
  vec3 col = h > 0.0
    ? mix(horizon, mix(uUpper, uZenith, smoothstep(0.25, 0.85, h)), smoothstep(0.0, 0.32, h))
    : mix(horizon, uBelow, smoothstep(0.0, 0.18, -h));
  // Sun halo and a broad warm glow around it.
  float sunDot = max(dot(d, uSun), 0.0);
  col += uSunColor * (pow(sunDot, 700.0) * 2.0 + pow(sunDot, 24.0) * 0.35 + pow(sunDot, 4.0) * 0.08);
  // Milky Way: a soft, mottled band across the night side.
  vec3 bandNormal = normalize(vec3(0.35, 0.55, 0.76));
  float band = exp(-pow(dot(d, bandNormal) * 4.0, 2.0));
  float cloud = fbm(d * 6.0) * fbm(d * 13.0 + 3.0);
  float night = smoothstep(0.08, 0.5, h) * (1.0 - pow(sunDot, 3.0));
  col += vec3(0.42, 0.36, 0.78) * band * cloud * 1.4 * night;
  // Stars: sparse cells, denser inside the band, twinkling slowly.
  vec3 cell = floor(d * 420.0);
  float star = hash(cell);
  float threshold = 0.9965 - band * 0.006;
  if (star > threshold) {
    float twinkle = 0.65 + 0.35 * sin(uTime * (1.0 + star * 5.0) + star * 40.0);
    col += vec3(0.9, 0.92, 1.0) * (star - threshold) / (1.0 - threshold) * 3.0 * twinkle * night;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Sky dome, square sun and its glow. Follows the camera so it never gets closer. */
export class VoxelSky {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly sun: THREE.Mesh;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uSun: { value: SUN_DIR.clone() }, uTime: { value: 0 },
        uZenith: { value: SKY_COLORS.zenith }, uUpper: { value: SKY_COLORS.upper },
        uWarm: { value: SKY_COLORS.horizonWarm }, uCool: { value: SKY_COLORS.horizonCool },
        uBelow: { value: SKY_COLORS.below }, uSunColor: { value: SKY_COLORS.sun },
      },
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), this.material);
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);
    // The square sun, bright enough for the bloom pass.
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(130, 130), new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffa24e).multiplyScalar(1.6), fog: false, depthWrite: false,
    }));
    this.sun.renderOrder = -9;
    this.group.add(this.sun);
  }

  update(camera: THREE.Camera, time: number) {
    this.group.position.copy(camera.position);
    this.material.uniforms.uTime.value = time;
    this.sun.position.copy(SUN_DIR).multiplyScalar(950);
    this.sun.lookAt(camera.position);
  }

  dispose() {
    this.group.traverse(o => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material | undefined)?.dispose();
    });
  }
}
