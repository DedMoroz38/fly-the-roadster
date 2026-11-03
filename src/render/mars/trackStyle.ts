import * as THREE from 'three';
import type { SurfaceType } from '../../game/surfaces';
import type { GridOrigin, ObstacleKind, ObstacleStyle, PickupStyle, SurfaceStyle } from '../trackStyle';

/** Seconds of world time for the industrial hazards (blinking beacons), advanced by the worlds that use them. */
export const HAZARD_TIME = { value: 0 };

/** Accent light colours keep the shared colour coding: cyan floor, violet ceiling, teal left, amber right. */
export const MARS_ACCENTS: Record<SurfaceType, number> = {
  floor: 0x38e4ff,
  ceiling: 0xb48cff,
  left: 0x3dffc4,
  right: 0xffa640,
};

const glsl = (n: number) => n.toFixed(4);

/** Shared GLSL: hashes and a cheap value noise for scratches and grime. */
/** Shared GLSL for panel shaders: hashes, value noise and anti-aliased lines. */
export const PANEL_GLSL = /* glsl */ `
float mHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float mNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1, 0)), f.x), mix(mHash(i + vec2(0, 1)), mHash(i + vec2(1, 1)), f.x), f.y);
}
float mLine(float x, float width) { float w = fwidth(x) + 1e-4; return 1.0 - smoothstep(width - w, width + w, abs(x)); }
`;

interface PanelOptions {
  surface: SurfaceType;
  /** Panel size across the surface (metres); along the track panels are always 4 m. */
  across: number;
  base: number;
  /** Positions (across the surface, metres) of glowing light strips on the inner face. */
  strips: number[];
  stripWidth: number;
  glow: number;
}

/**
 * Brushed steel deck plates mapped in world space, with dark seams, scuffs and inset light strips
 * on the face that looks into the corridor. Panels repeat every 4 m along the track, which the
 * floating origin (always a multiple of 256 m) preserves, so the pattern never jumps.
 */
function panelMaterial(o: PanelOptions, origin: GridOrigin): THREE.MeshStandardMaterial {
  // The deck is polished by traffic; walls and the ceiling are satin, so a low sun never blinds.
  const deck = o.surface === 'floor';
  const material = new THREE.MeshStandardMaterial({ color: o.base, metalness: deck ? 0.72 : 0.55, roughness: deck ? 0.44 : 0.6, envMapIntensity: deck ? 0.75 : 0.4 });
  const accent = new THREE.Color(MARS_ACCENTS[o.surface]).multiplyScalar(o.glow);
  // Inner face: which axis it faces along, and which way.
  const inner = { floor: 'vN.y > 0.5', ceiling: 'vN.y < -0.5', left: 'vN.x > 0.5', right: 'vN.x < -0.5' }[o.surface];
  const acrossAxis = o.surface === 'floor' || o.surface === 'ceiling' ? 'x' : 'y';
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
        bool innerFace = ${inner};
        float across = vP.${acrossAxis};
        vec2 pc = vec2(across / ${glsl(o.across)}, vP.z / 4.0);
        vec2 cell = floor(pc);
        // Per-plate tint; ids wrap every 64 plates so a 256 m origin shift keeps them.
        float plate = mHash(vec2(cell.x, mod(cell.y, 64.0)));
        vec2 f = fract(pc) - 0.5;
        float seam = max(mLine((abs(f.x) - 0.5) * ${glsl(o.across)}, 0.03), mLine((abs(f.y) - 0.5) * 4.0, 0.03));
        // Brushed grain along the track and broad scuffs from traffic.
        float grain = mHash(vec2(floor(across * 60.0), cell.y)) * 0.5 + mNoise(vec2(across * 40.0, vP.z * 0.6)) * 0.5;
        float scuff = mNoise(vec2(across * 0.7, vP.z * 0.35) + plate * 9.0);
        vec3 tint = vec3(0.86 + plate * 0.2) * (0.9 + grain * 0.12) * (0.82 + scuff * 0.26);
        diffuseColor.rgb *= innerFace ? tint * (1.0 - seam * 0.75) : vec3(0.55);
        float stripGlow = 0.0;
        ${o.strips.map(s => `stripGlow = max(stripGlow, mLine(across - ${glsl(s)}, ${glsl(o.stripWidth)}));`).join('\n        ')}
        stripGlow *= innerFace ? 1.0 : 0.0;
        float seamMask = seam;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (scuff - 0.5) * 0.22 + seamMask * 0.4, 0.12, 1.0);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uAccent * stripGlow;`);
  };
  material.customProgramCacheKey = () => `mars-panel-${o.surface}`;
  return material;
}

/**
 * The Mars causeway: brushed steel deck plates with cyan light strips near both edges, like the
 * landing-field roads around a base; the walls and ceiling are darker steel with their own strips.
 */
export const MARS_SURFACES: SurfaceStyle = {
  surface: (surface: SurfaceType, origin: GridOrigin) => ({
    floor: () => panelMaterial({ surface, across: 3, base: 0x8d939c, strips: [-5.25, 5.25], stripWidth: 0.06, glow: 1.5 }, origin),
    ceiling: () => panelMaterial({ surface, across: 3, base: 0x5d6270, strips: [-2.6, 2.6], stripWidth: 0.05, glow: 1.8 }, origin),
    left: () => panelMaterial({ surface, across: 2.5, base: 0x5c616c, strips: [8.4], stripWidth: 0.06, glow: 2 }, origin),
    right: () => panelMaterial({ surface, across: 2.5, base: 0x5c616c, strips: [8.4], stripWidth: 0.06, glow: 2 }, origin),
  })[surface](),
  edge: (surface: SurfaceType) => new THREE.MeshBasicMaterial({ color: new THREE.Color(MARS_ACCENTS[surface]).multiplyScalar(1.05) }),
  trim: 0.1,
  bar: 0.16,
};

interface HazardOptions {
  kind: ObstacleKind;
  color: number;
  metalness: number;
  roughness: number;
}

/**
 * Hazard boxes come at any size, so the pattern is laid out in metres on each face from the
 * box's own scale: a dark frame around every face, then a kind-specific face pattern.
 */
function hazardMaterial(o: HazardOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: o.color, metalness: o.metalness, roughness: o.roughness, envMapIntensity: 0.8 });
  const face = {
    // White cargo crates: vertical corrugation and a hazard-striped foot.
    block: `
        float rib = 0.5 + 0.5 * sin(fc.x * 18.0);
        col *= 0.86 + rib * 0.14;
        float foot = step(fc.y, -half2.y + 0.32);
        float chev = step(0.5, fract((fc.x + fc.y) * 1.4));
        col = mix(col, mix(vec3(0.03), vec3(0.95, 0.62, 0.05), chev), foot);
        glow = mLine(fc.y - half2.y + 0.18, 0.035) * step(abs(fc.x), half2.x - 0.25) * 2.2 * vec3(1.0, 0.18, 0.08);`,
    // Steel gantry pieces with long cyan light bars down the middle of every face.
    gate: `
        float bar = mLine(fc.x, 0.07) * step(abs(fc.y), half2.y - 0.3);
        float bar2 = mLine(fc.y, 0.07) * step(abs(fc.x), half2.x - 0.3) * step(half2.y, half2.x);
        col *= 0.92 + mNoise(fc * 9.0) * 0.12;
        glow = max(bar * step(half2.x, half2.y), bar2) * vec3(0.5, 2.6, 3.2);`,
    // Blast walls: yellow and black chevrons, a row of red beacons blinking along the top.
    barrier: `
        float chev = step(0.5, fract((fc.x + abs(fc.y - half2.y * 0.2)) * 0.9));
        col = mix(vec3(0.04), vec3(0.98, 0.7, 0.06), chev);
        float beacon = step(length(vec2(fract(fc.x * 0.5) - 0.5, (fc.y - half2.y + 0.22) * 0.5)), 0.08);
        float blink = 0.35 + 0.65 * step(0.5, fract(uTime * 1.6 + floor(fc.x * 0.5) * 0.25));
        glow = beacon * blink * vec3(3.2, 0.25, 0.12);`,
  }[o.kind];
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = HAZARD_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vHalf;\nvarying vec3 vObjN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vHalf = 0.5 * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
        vLocal = position * 2.0 * vHalf;
        vObjN = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLocal;
        varying vec3 vHalf;
        varying vec3 vObjN;
        uniform float uTime;
        ${PANEL_GLSL}`)
      .replace('#include <map_fragment>', `
        vec3 an = abs(vObjN);
        // Face coordinates in metres: "up" is the box's Y unless this is a top or bottom face.
        vec2 fc = an.y > 0.5 ? vLocal.xz : (an.x > 0.5 ? vLocal.zy : vLocal.xy);
        vec2 half2 = an.y > 0.5 ? vHalf.xz : (an.x > 0.5 ? vHalf.zy : vHalf.xy);
        vec3 col = vec3(1.0);
        vec3 glow = vec3(0.0);
        ${face}
        float frame = 1.0 - step(0.12, min(half2.x - abs(fc.x), half2.y - abs(fc.y)));
        col = mix(col, vec3(0.16), frame);
        diffuseColor.rgb *= col;
        vec3 hazardGlow = glow * (1.0 - frame);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += hazardGlow;`);
  };
  material.customProgramCacheKey = () => `mars-hazard-${o.kind}`;
  return material;
}

/** White cargo crates, steel gantry gates with cyan light bars, and chevron blast walls. */
export function marsObstacles(): ObstacleStyle {
  const edges: Record<ObstacleKind, THREE.LineBasicMaterial> = {
    block: new THREE.LineBasicMaterial({ color: 0xff5a3c, toneMapped: false }),
    gate: new THREE.LineBasicMaterial({ color: 0x8ff3ff, toneMapped: false }),
    barrier: new THREE.LineBasicMaterial({ color: 0xffc04a, toneMapped: false }),
  };
  return {
    material: (kind: ObstacleKind) => hazardMaterial(({
      block: { kind, color: 0xe4e2dc, metalness: 0.25, roughness: 0.55 },
      gate: { kind, color: 0xb3bac4, metalness: 0.9, roughness: 0.28 },
      barrier: { kind, color: 0xffffff, metalness: 0.1, roughness: 0.7 },
    } as const)[kind]),
    edges: (kind: ObstacleKind) => edges[kind],
  };
}

/** A rounded tank outline (radius, height) for the methane fuel canister. */
function canisterProfile(): THREE.Vector2[] {
  const points: THREE.Vector2[] = [];
  const r = 0.46, h = 0.62, cap = 0.3;
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; points.push(new THREE.Vector2(Math.sin(a) * r + 0.001, -h - Math.cos(a) * cap)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; points.push(new THREE.Vector2(Math.cos(a) * r + 0.001, h + Math.sin(a) * cap)); }
  points.push(new THREE.Vector2(0.12, h + cap + 0.08), new THREE.Vector2(0.001, h + cap + 0.08));
  return points;
}

/** A glowing propellant canister ringed by a halo; `glow` lights its bands, `halo` the ring and beam. */
export function canisterPickups(glow: THREE.Color, halo: number): PickupStyle {
  const core = new THREE.LatheGeometry(canisterProfile(), 24);
  const coreMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, metalness: 0.6, roughness: 0.25 });
  coreMaterial.onBeforeCompile = shader => {
    shader.uniforms.uGlow = { value: glow };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;\nuniform vec3 uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // Three glowing bands round the tank, like frost lines on a cryogenic cell.
        float band = step(0.82, fract(vH * 2.4 + 0.5)) * step(abs(vH), 0.7);
        totalEmissiveRadiance += uGlow * band + uGlow * 0.07;`);
  };
  coreMaterial.customProgramCacheKey = () => 'canister';
  const ringGeo = new THREE.TorusGeometry(1.3, 0.05, 8, 48);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(halo).multiplyScalar(1.6), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  return {
    core, coreMaterial,
    ring: () => new THREE.Mesh(ringGeo, ringMat),
    light: halo, beam: halo, burst: new THREE.Color(halo).lerp(new THREE.Color(0xffffff), 0.5).getHex(),
    dispose: () => { core.dispose(); coreMaterial.dispose(); ringGeo.dispose(); ringMat.dispose(); },
  };
}

/** Fuel cells become glowing methane canisters, ringed by a cold blue halo. */
export const marsPickups = (): PickupStyle => canisterPickups(new THREE.Color(0.35, 1.9, 2.6), 0x6fe6ff);
