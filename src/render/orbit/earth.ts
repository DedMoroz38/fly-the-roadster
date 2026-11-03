import * as THREE from 'three';
import dayUrl from '../../../models/earth/earth-day.jpg?url';
import day8kUrl from '../../../models/earth/earth-day-8k.jpg?url';
import nightUrl from '../../../models/earth/earth-night.jpg?url';
import cloudsUrl from '../../../models/earth/earth-clouds.jpg?url';
import { ORBIT_SUN_DIR } from './sky';

/**
 * Earth far below the track. At true ISS proportions (400 km over 6371 km) the horizon dips 20°
 * below level and a forward-looking camera sees almost none of the planet; at 1/60 of the radius it
 * dips about 10°, so Earth fills the lower part of the view beside the track, with the limb still
 * clearly curved. The game's metres are not kilometres; only the proportions matter. NASA imagery
 * (public domain): Blue Marble Next Generation (day), Black Marble 2012 (night lights) and the
 * Blue Marble cloud composite.
 */
export const EARTH = {
  radius: 9000,
  /** Height of the track (y = 0) above the surface. */
  altitude: 150,
  /** Radians of turn per metre travelled: the ground drifts below at about a third of the car's speed. */
  turnPerMetre: 0.35 / 9000,
} as const;

/**
 * Where a run starts above Earth and which way it heads (bearing in degrees from north). Seven
 * routes with coastlines and land in view, so a run rarely starts over open ocean (70% of the planet).
 */
export const EARTH_ROUTES: { name: string; lat: number; lon: number; bearing: number }[] = [
  { name: 'Mediterranean', lat: 37, lon: 8, bearing: 85 },
  { name: 'Florida and the Caribbean', lat: 24, lon: -84, bearing: 55 },
  { name: 'Nile and the Red Sea', lat: 22, lon: 30, bearing: 30 },
  { name: 'India and the Himalayas', lat: 22, lon: 74, bearing: 25 },
  { name: 'Japan', lat: 32, lon: 128, bearing: 55 },
  { name: 'Western Europe', lat: 44, lon: -10, bearing: 60 },
  { name: 'Western Australia', lat: -28, lon: 108, bearing: 75 },
];

/**
 * Orientation that puts a place (latitude, longitude in degrees) directly under the track, with the
 * given bearing pointing ahead (−Z). In three's sphere UVs the Blue Marble's longitude maps to
 * u = (lon + 180) / 360, so a place sits at (cos lon · cos lat, sin lat, −sin lon · cos lat).
 */
export function routeOrientation(lat: number, lon: number, bearing: number): THREE.Quaternion {
  const φ = THREE.MathUtils.degToRad(lat), λ = THREE.MathUtils.degToRad(lon), β = THREE.MathUtils.degToRad(bearing);
  const up = new THREE.Vector3(Math.cos(λ) * Math.cos(φ), Math.sin(φ), -Math.sin(λ) * Math.cos(φ));
  const east = new THREE.Vector3(-Math.sin(λ), 0, -Math.cos(λ));
  // up × east is north (at 0°, 0°: (1, 0, 0) × (0, 0, −1) = (0, 1, 0), towards the North Pole).
  const north = new THREE.Vector3().crossVectors(up, east).normalize();
  const ahead = north.multiplyScalar(Math.cos(β)).addScaledVector(east, Math.sin(β)).normalize();
  const back = ahead.negate();
  const right = new THREE.Vector3().crossVectors(up, back);
  // Rows (right, up, back) take the place's frame onto the world's (+X, +Y, +Z).
  const m = new THREE.Matrix4().makeBasis(right, up, back).transpose();
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/** How far the horizon dips below level, in radians. */
export const horizonDip = () => Math.acos(EARTH.radius / (EARTH.radius + EARTH.altitude));

/** How far ahead the horizon is from the track. */
export const horizonDistance = () => Math.sqrt((EARTH.radius + EARTH.altitude) ** 2 - EARTH.radius ** 2);

/**
 * The farthest point the camera must draw: a sight line that grazes the horizon goes on through the
 * atmosphere and leaves its shell on the far side. A far plane short of that clips the glow just
 * above the horizon into a black sliver.
 */
export const farthestVisible = () => horizonDistance() + Math.sqrt((EARTH.radius * SHELL) ** 2 - EARTH.radius ** 2);

const surfaceVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vLocal;
void main() {
  vUv = uv;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPosW = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const surfaceFragment = /* glsl */ `
uniform sampler2D uDay, uNight, uClouds;
uniform vec3 uSun;
uniform float uCloudShift;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vLocal;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
void main() {
  vec3 n = normalize(vNormalW);
  vec3 view = normalize(cameraPosition - vPosW);
  float dist = length(cameraPosition - vPosW);
  float sun = dot(n, uSun);
  vec3 day = texture2D(uDay, vUv).rgb;
  vec3 night = texture2D(uNight, vUv).rgb;
  // Fine detail the imagery is too coarse for, fading out with distance where texels are small on screen.
  float near = 1.0 - smoothstep(300.0, 1400.0, dist);
  float detail = fbm(vLocal * 0.35);
  float water = smoothstep(0.04, 0.16, day.b - max(day.r, day.g * 0.85));
  // Land: relief-like variation in brightness; a touch more saturation than the satellite composite.
  float lum = dot(day, vec3(0.299, 0.587, 0.114));
  day = mix(vec3(lum), day, 1.18);
  day *= 1.0 + (detail - 0.5) * 0.35 * near * (1.0 - water);
  // Oceans read deep navy from orbit.
  day = mix(day, day * vec3(0.55, 0.75, 1.05), water * 0.6);
  // Clouds: the coarse map sets where they are; noise gives them torn, sharp edges and puffy tops.
  float cloudMap = texture2D(uClouds, vec2(vUv.x + uCloudShift, vUv.y)).r;
  float puff = fbm(vLocal * 0.12 + 7.0);
  float cloud = smoothstep(0.42, 0.62, cloudMap + (puff - 0.5) * 0.45 + (detail - 0.5) * 0.12 * near);
  float lit = smoothstep(-0.06, 0.25, sun);
  vec3 dawn = vec3(1.0, 0.5, 0.25) * smoothstep(-0.06, 0.04, sun) * (1.0 - smoothstep(0.04, 0.2, sun));
  float light = pow(max(sun, 0.0), 0.7);
  // Clouds cast soft shadows on what lies under them.
  float shade = 1.0 - smoothstep(0.35, 0.7, cloudMap + (puff - 0.5) * 0.3) * 0.45;
  vec3 ground = day * (0.03 + 1.3 * light) * shade + day * dawn * 0.5;
  // Sun glitter on open water: a broad sheen, broken up into sparkle.
  vec3 h = normalize(uSun + view);
  float spec = pow(max(dot(n, h), 0.0), 60.0) * (0.6 + 0.8 * noise(vLocal * 2.5));
  ground += vec3(1.0, 0.93, 0.82) * spec * water * (1.0 - cloud) * 1.4 * lit;
  // City lights on the night side, dimmed where clouds cover them.
  vec3 cities = night * vec3(1.3, 1.05, 0.7) * 1.4 * (1.0 - cloud * 0.8) * (1.0 - smoothstep(-0.12, 0.05, sun));
  // Cloud tops: bright in the sun, darker in the folds.
  vec3 clouds = vec3(0.98, 0.99, 1.0) * (0.03 + 1.12 * light) * (0.78 + 0.22 * puff * 1.6) + dawn * 0.45;
  vec3 col = mix(ground, clouds, cloud) + cities;
  // Looking through the atmosphere: the further and the more slanting the view, the bluer and paler
  // the ground, until it melts into the bright band along the horizon.
  float slant = 1.0 - max(dot(n, view), 0.0);
  float haze = clamp(1.0 - exp(-dist / 1400.0), 0.0, 1.0) * 0.55 + pow(slant, 6.0) * 0.45;
  vec3 sky = vec3(0.42, 0.62, 1.0) * (0.12 + 0.95 * lit) + dawn * 0.3;
  col = mix(col, sky, clamp(haze, 0.0, 1.0) * (0.25 + 0.75 * lit));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The glowing shell's radius relative to Earth's; it must stay below the camera, which is outside it. */
const SHELL = 1 + (EARTH.altitude * 0.6) / EARTH.radius;
const atmosphereFragment = /* glsl */ `
#define LIMB ${Math.sqrt(1 - 1 / (SHELL * SHELL)).toFixed(4)}
uniform vec3 uSun;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 view = normalize(cameraPosition - vPosW);
  // The far side of the shell, seen past the planet. A ray grazing the surface meets the shell where
  // -n·view = sqrt(1 - (R / Rshell)^2), about 0.21: the glow is brightest there, just above the limb,
  // and fades to nothing at the shell's own edge (-n·view = 0). Nearer the centre the planet hides it.
  float k = clamp(-dot(n, view), 0.0, 1.0);
  float edge = pow(smoothstep(0.0, LIMB, k), 3.0);
  float sun = dot(n, uSun);
  float day = smoothstep(-0.25, 0.3, sun);
  // Blue over the day side, orange where the terminator crosses the limb.
  vec3 tint = mix(vec3(0.25, 0.5, 1.0), vec3(1.0, 0.55, 0.3), smoothstep(0.2, -0.05, sun) * day);
  vec3 col = tint * edge * (0.06 + 1.5 * day);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function texture(url: string, srgb: boolean, anisotropy: number): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** The planet below the track: surface (day, night, clouds) and a glowing atmospheric shell. */
export class Earth {
  readonly group = new THREE.Group();
  private readonly globe = new THREE.Group();
  private textures: THREE.Texture[] = [];
  private readonly surface: THREE.ShaderMaterial;
  private readonly atmosphere: THREE.ShaderMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];

  private readonly start: THREE.Quaternion;
  private readonly roll = new THREE.Quaternion();
  private readonly xAxis = new THREE.Vector3(1, 0, 0);

  constructor(route: { lat: number; lon: number; bearing: number }) {
    this.start = routeOrientation(route.lat, route.lon, route.bearing);
    this.surface = new THREE.ShaderMaterial({
      vertexShader: surfaceVertex, fragmentShader: surfaceFragment, fog: false,
      uniforms: { uDay: { value: null }, uNight: { value: null }, uClouds: { value: null }, uSun: { value: ORBIT_SUN_DIR }, uCloudShift: { value: 0 } },
    });
    this.atmosphere = new THREE.ShaderMaterial({
      vertexShader: surfaceVertex, fragmentShader: atmosphereFragment, fog: false,
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      uniforms: { uSun: { value: ORBIT_SUN_DIR } },
    });
    const sphere = new THREE.SphereGeometry(EARTH.radius, 160, 120);
    const shell = new THREE.SphereGeometry(EARTH.radius * SHELL, 96, 64);
    this.geometries.push(sphere, shell);
    const ground = new THREE.Mesh(sphere, this.surface);
    ground.frustumCulled = false;
    this.globe.add(ground);
    const air = new THREE.Mesh(shell, this.atmosphere);
    air.frustumCulled = false;
    air.renderOrder = -5;
    this.group.add(this.globe, air);
  }

  /**
   * Loads the imagery once the GPU's limits are known: the 8192-pixel day map where it fits (twice
   * the detail), otherwise the 4096-pixel one; filtering as sharp at grazing angles as the GPU allows.
   */
  load(renderer: THREE.WebGLRenderer) {
    if (this.textures.length) return;
    const { maxTextureSize, getMaxAnisotropy } = renderer.capabilities;
    const anisotropy = Math.min(16, getMaxAnisotropy());
    this.textures = [texture(maxTextureSize >= 8192 ? day8kUrl : dayUrl, true, anisotropy), texture(nightUrl, true, 4), texture(cloudsUrl, false, anisotropy)];
    const [day, night, clouds] = this.textures;
    const u = this.surface.uniforms;
    u.uDay.value = day;
    u.uNight.value = night;
    u.uClouds.value = clouds;
  }

  /** Keeps Earth under the camera and turns the surface beneath it as the car travels. */
  update(camera: THREE.Camera, cameraDistance: number, time: number) {
    this.group.position.set(camera.position.x, camera.position.y - EARTH.radius - EARTH.altitude, camera.position.z);
    // Start over the route, then roll the globe about the world X axis: the ground flows straight
    // back under the track, so the car travels along the route's bearing.
    this.globe.quaternion.copy(this.roll.setFromAxisAngle(this.xAxis, cameraDistance * EARTH.turnPerMetre)).multiply(this.start);
    this.surface.uniforms.uCloudShift.value = time * 0.0004;
  }

  dispose() {
    for (const t of this.textures) t.dispose();
    for (const g of this.geometries) g.dispose();
    this.surface.dispose();
    this.atmosphere.dispose();
  }
}
