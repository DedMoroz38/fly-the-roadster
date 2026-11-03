import * as THREE from 'three';
import type { SurfaceType } from '../../game/surfaces';
import { PANEL_GLSL } from '../mars/trackStyle';
import type { GridOrigin, ObstacleKind, ObstacleStyle, PickupStyle, SurfaceStyle } from '../trackStyle';
import { DINO_THEME } from './theme';

/** A flat material in one grey of the shared palette; it follows day and night by itself. */
export function toneMaterial(tone: Parameters<typeof DINO_THEME.tone>[0], extra: THREE.MeshBasicMaterialParameters = {}): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial(extra);
  material.color = DINO_THEME.tone(tone);
  return material;
}

/**
 * A flat monochrome material mapped in world space. `pattern` is GLSL that sets `m`, the grey level
 * (0 = background, 1 = ink), from `uv` (metres across and along the face) and, for any face, `vP`/`vN`.
 */
function patternMaterial(pattern: string, origin: GridOrigin, key: string, inner = 'true', across = 'vP.x'): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial();
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uGridOrigin: origin, uInk: { value: DINO_THEME.ink }, uPaper: { value: DINO_THEME.paper } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP;\nvarying vec3 vN;\nuniform float uGridOrigin;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vP.z -= uGridOrigin;
        vN = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vP;
        varying vec3 vN;
        uniform vec3 uInk;
        uniform vec3 uPaper;
        ${PANEL_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 uv = vec2(${across}, vP.z);
        float m = 0.0;
        if (${inner}) {
          ${pattern}
        } else m = 0.3;
        diffuseColor.rgb = mix(uPaper, uInk, clamp(m, 0.0, 1.0));`);
  };
  material.customProgramCacheKey = () => `dino-${key}`;
  return material;
}

/** Sand with scattered pebbles and a solid ground line near each edge, like the original's horizon. */
const FLOOR = `
  m = 0.26;
  vec2 cell = floor(uv / vec2(1.2, 2.4));
  vec2 f = fract(uv / vec2(1.2, 2.4));
  float h = mHash(vec2(cell.x, mod(cell.y, 64.0)));
  float h2 = mHash(vec2(cell.y, mod(cell.x, 64.0)) + 3.7);
  float dash = step(0.12, f.x) * step(f.x, 0.12 + 0.12 + 0.3 * h2) * step(abs(f.y - (0.2 + 0.6 * h)), 0.025);
  m += dash * step(0.55, h2) * 0.4;
  m += mLine(abs(uv.x) - 5.55, 0.05) * 0.9;`;

/** Hatched ceiling slabs, as if shaded in pencil. */
const CEILING = `
  m = 0.16;
  float d = fract((uv.x + uv.y) * 0.9);
  m += step(abs(d - 0.5), 0.045) * 0.28;
  m += mLine(abs(uv.x) - 5.55, 0.05) * 0.7;`;

/** Sandstone walls: a faint brick course with short vertical joints. */
const WALL = `
  m = 0.12;
  float row = floor(uv.x / 1.0);
  float course = step(abs(fract(uv.x / 1.0) - 0.5), 0.02);
  float joint = step(abs(fract(uv.y / 2.0 + row * 0.5) - 0.5), 0.012) * step(0.02, abs(fract(uv.x / 1.0) - 0.5));
  m += (course + joint) * 0.32;`;

const SURFACE_PATTERNS: Record<SurfaceType, { pattern: string; inner: string; across: string }> = {
  floor: { pattern: FLOOR, inner: 'vN.y > 0.5', across: 'vP.x' },
  ceiling: { pattern: CEILING, inner: 'vN.y < -0.5', across: 'vP.x' },
  left: { pattern: WALL, inner: 'vN.x > 0.5', across: 'vP.y' },
  right: { pattern: WALL, inner: 'vN.x < -0.5', across: 'vP.y' },
};

/** The track in the offline game's palette: pale sand, ink-grey trims, no colour at all. */
export const DINO_SURFACES: SurfaceStyle = {
  surface: (surface: SurfaceType, origin: GridOrigin) => {
    const s = SURFACE_PATTERNS[surface];
    return patternMaterial(s.pattern, origin, surface, s.inner, s.across);
  },
  edge: () => toneMaterial('ink'),
  trim: 0.08,
  bar: 0.12,
};

/** Cactus pillars (spines as pale pixels), ribbed gates and striped barriers, all ink on the sand. */
const CACTUS = `
  float rib = step(abs(fract(vP.x * 2.0 + vP.z * 2.0) - 0.5), 0.07);
  vec2 px = floor(vec2(vP.x + vP.z, vP.y) * 5.0);
  float spine = step(0.9, mHash(px));
  m = 1.0 - rib * 0.18 - spine * 0.45;`;
const GATE = `
  float rib = step(abs(fract(vP.y * 1.5) - 0.5), 0.06);
  m = 0.95 - rib * 0.25;`;
const BARRIER = `
  float s = step(0.5, fract((vP.x + vP.y) * 0.8));
  m = 1.0 - s * 0.5;`;

export function dinoObstacles(): ObstacleStyle {
  const origin: GridOrigin = { value: 0 };
  const materials: Record<ObstacleKind, THREE.Material | null> = { block: null, gate: null, barrier: null };
  const patterns: Record<ObstacleKind, string> = { block: CACTUS, gate: GATE, barrier: BARRIER };
  const edges = new THREE.LineBasicMaterial({ toneMapped: false });
  edges.color = DINO_THEME.tone('paper');
  return {
    // The view hands each kind the shared origin it updates; ours only needs to exist per kind.
    material: (kind, o) => (materials[kind] ??= patternMaterial(patterns[kind], o ?? origin, `obstacle-${kind}`)),
    edges: () => edges,
  };
}

/** Fuel cells: an ink diamond in a spinning ring. */
export function dinoPickups(): PickupStyle {
  const ringGeo = new THREE.TorusGeometry(1.25, 0.09, 8, 32);
  const ringMat = toneMaterial('dark');
  const core = new THREE.OctahedronGeometry(0.95, 0);
  const coreMaterial = toneMaterial('ink');
  return {
    core, coreMaterial, ring: () => new THREE.Mesh(ringGeo, ringMat), light: 0xffffff, beam: 0x888888, burst: 0xffffff,
    dispose: () => { ringGeo.dispose(); ringMat.dispose(); core.dispose(); coreMaterial.dispose(); },
  };
}
