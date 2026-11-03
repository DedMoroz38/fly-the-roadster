import * as THREE from 'three';
import type { SurfaceType } from '../../game/surfaces';
import { canisterPickups, marsObstacles, MARS_ACCENTS, PANEL_GLSL } from '../mars/trackStyle';
import type { GridOrigin, ObstacleStyle, PickupStyle, SurfaceStyle } from '../trackStyle';

interface StationOptions {
  surface: SurfaceType;
  color: number;
  metalness: number;
  roughness: number;
  /** GLSL that sets `tint` (vec3), `glow` (vec3) and `rough` (float offset) from `uv` (metres: across, along). */
  pattern: string;
}

const glsl = (n: number) => n.toFixed(4);

/** Light strips along the inner face, in the shared colour coding of each surface. */
const strip = (positions: number[], width: number, k: number) =>
  `glow += uAccent * ${glsl(k)} * (${positions.map(p => `mLine(uv.x - ${glsl(p)}, ${glsl(width)})`).join(' + ')});`;

/**
 * A station surface mapped in world space (so it never swims as the floating origin moves): the
 * face that looks into the corridor gets the pattern, the slab's other faces a plain darker finish.
 */
function stationMaterial(o: StationOptions, origin: GridOrigin): THREE.MeshStandardMaterial {
  // Foil mostly shows what it reflects (Earth's glow from below), so it takes more of the environment.
  const material = new THREE.MeshStandardMaterial({ color: o.color, metalness: o.metalness, roughness: o.roughness, envMapIntensity: o.surface === 'ceiling' ? 1.6 : 0.6 });
  const accent = new THREE.Color(MARS_ACCENTS[o.surface]);
  const inner = { floor: 'vN.y > 0.5', ceiling: 'vN.y < -0.5', left: 'vN.x > 0.5', right: 'vN.x < -0.5' }[o.surface];
  const across = o.surface === 'floor' || o.surface === 'ceiling' ? 'vP.x' : 'vP.y';
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uGridOrigin: origin, uAccent: { value: accent } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP;\nvarying vec3 vN;\nuniform float uGridOrigin;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vP.z -= uGridOrigin;
        vN = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vP;
        varying vec3 vN;
        uniform vec3 uAccent;
        ${PANEL_GLSL}`)
      .replace('#include <map_fragment>', `
        // uv: metres across the surface and along the track. Along-track patterns repeat in whole
        // divisions of 4 m, which the floating origin (always a multiple of 256 m) preserves.
        vec2 uv = vec2(${across}, vP.z);
        vec3 tint = vec3(1.0);
        vec3 glow = vec3(0.0);
        float rough = 0.0;
        if (${inner}) {
          ${o.pattern}
        } else tint = vec3(0.45);
        diffuseColor.rgb *= tint;
        vec3 stationGlow = glow;
        float stationRough = rough;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + stationRough, 0.08, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += stationGlow;`);
  };
  material.customProgramCacheKey = () => `station-${o.surface}`;
  return material;
}

/** White station plates: 2 × 4 m panels with dark seams, bolt heads at the corners and light wear. */
const PLATES = `
  vec2 cell = floor(uv / vec2(2.0, 4.0));
  vec2 f = uv / vec2(2.0, 4.0) - cell;
  vec2 corner = min(f, 1.0 - f) * vec2(2.0, 4.0); // metres to the nearest plate edges
  float seam = max(mLine(corner.x, 0.025), mLine(corner.y, 0.025));
  float bolt = step(length(corner - 0.12), 0.035);
  float plate = mHash(vec2(cell.x, mod(cell.y, 64.0)));
  float wear = mNoise(uv * vec2(1.3, 0.5) + plate * 7.0);
  tint = vec3(0.9 + plate * 0.08) * (0.94 + wear * 0.08);
  tint *= 1.0 - seam * 0.7 - bolt * 0.45;
  rough = (wear - 0.5) * 0.15 + seam * 0.3;`;

/** Solar-cell walls: deep blue cells in a silver grid, with a thin busbar through each cell. */
const SOLAR = `
  vec2 g = uv / vec2(0.5, 0.5);
  vec2 f = fract(g) - 0.5;
  float grid = max(mLine(abs(f.x) - 0.5, 0.03), mLine(abs(f.y) - 0.5, 0.03));
  float bus = mLine(f.y, 0.012);
  float sheen = mNoise(floor(g) * 0.37) * 0.25;
  tint = mix(vec3(0.08, 0.13, 0.32) * (0.85 + sheen), vec3(0.75, 0.78, 0.82), max(grid, bus * 0.7));
  // A dark frame band every 2 m along the track, like separate array panels.
  float frame = mLine(fract(uv.y / 2.0) - 0.5, 0.012) + mLine(fract(uv.y / 2.0) - 0.5 + 0.5, 0.012);
  tint = mix(tint, vec3(0.12), clamp(frame, 0.0, 1.0));
  rough = -grid * 0.1;`;

/** Gold insulation foil: quilted squares, crinkled, with stitch lines between them. */
const FOIL = `
  vec2 q = uv / 1.0;
  vec2 f = fract(q) - 0.5;
  float stitch = max(mLine(abs(f.x) - 0.5, 0.02), mLine(abs(f.y) - 0.5, 0.02));
  // Soft crinkles: they vary the shine more than the colour, so the foil glints rather than looking mottled.
  float crinkle = mNoise(uv * 5.0) * 0.7 + mNoise(uv * 13.0) * 0.3;
  float puff = 1.0 - dot(f, f) * 1.2;
  tint = vec3(0.95 + crinkle * 0.12) * (0.88 + puff * 0.14) * (1.0 - stitch * 0.45);
  rough = (crinkle - 0.5) * 0.35;`;

/**
 * The orbital station track: white deck plates, solar-array walls and a gold-foil ceiling, with
 * light strips in the shared colour coding (cyan floor, violet ceiling, teal left, amber right).
 */
export const ORBIT_SURFACES: SurfaceStyle = {
  surface: (surface: SurfaceType, origin: GridOrigin) => ({
    floor: () => stationMaterial({ surface, color: 0xd9dde2, metalness: 0.15, roughness: 0.55, pattern: PLATES + strip([-5.25, 5.25], 0.06, 1.5) }, origin),
    ceiling: () => stationMaterial({ surface, color: 0xd6a849, metalness: 1, roughness: 0.38, pattern: FOIL + strip([-2.6, 2.6], 0.05, 1.8) }, origin),
    left: () => stationMaterial({ surface, color: 0xffffff, metalness: 0.55, roughness: 0.28, pattern: SOLAR + strip([8.4], 0.06, 2) }, origin),
    right: () => stationMaterial({ surface, color: 0xffffff, metalness: 0.55, roughness: 0.28, pattern: SOLAR + strip([8.4], 0.06, 2) }, origin),
  })[surface](),
  edge: (surface: SurfaceType) => new THREE.MeshBasicMaterial({ color: new THREE.Color(MARS_ACCENTS[surface]).multiplyScalar(1.05) }),
  trim: 0.1,
  bar: 0.16,
};

/** Cargo crates, truss gantries and chevron blast walls, as on Mars: they suit a station too. */
export const orbitObstacles = (): ObstacleStyle => marsObstacles();

/** Fuel cells glow lime, which stands out against black space and the white deck. */
export const orbitPickups = (): PickupStyle => canisterPickups(new THREE.Color(1.3, 2.6, 0.35), 0xb6ff3b);
