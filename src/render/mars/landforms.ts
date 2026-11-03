import * as THREE from 'three';
import { hashSeed, Rng } from '../../core/rng';
import { fbm, valueNoise } from '../voxel/noise';

const TALUS = new THREE.Color(0x9a4a26);
const CAP = new THREE.Color(0xb86a3c);
/** Cliff faces: a neutral tint the strata shader colours by height. */
const FACE = new THREE.Color(0xffffff);

const scratch = new THREE.Color();

/** Rock colour per facet, and how much of it is layered cliff (1) rather than scree or cap rock (0). */
interface Shade { color: THREE.Color; strata: number }

/**
 * Turns an indexed shape into flat-shaded triangles coloured per facet, so rock reads as chiselled
 * faces. Sedimentary bands are added later by the material, in world height, so they run level
 * across every facet instead of following the triangles.
 */
function facet(positions: number[], indices: number[], shade: (cx: number, cy: number, cz: number, ny: number) => Shade): THREE.BufferGeometry {
  const pos = new Float32Array(indices.length * 3);
  const col = new Float32Array(indices.length * 3);
  const strata = new Float32Array(indices.length);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    a.fromArray(positions, indices[i] * 3); b.fromArray(positions, indices[i + 1] * 3); c.fromArray(positions, indices[i + 2] * 3);
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const s = shade((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3, n.y);
    for (const [k, v] of [a, b, c].entries()) {
      v.toArray(pos, (i + k) * 3);
      s.color.toArray(col, (i + k) * 3);
      strata[i + k] = s.strata;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geometry.setAttribute('strata', new THREE.BufferAttribute(strata, 1));
  geometry.computeVertexNormals();
  return geometry;
}

const face = (k: number): Shade => ({ color: scratch.copy(FACE).multiplyScalar(k), strata: 1 });
const plain = (color: THREE.Color, k = 1): Shade => ({ color: scratch.copy(color).multiplyScalar(k), strata: 0 });

/**
 * Rock material with level sedimentary bands: rust, ochre, dark basalt and pale dust layers by
 * world height, wavering slightly, on faces marked as cliff. `haze` > 1 fades into the fog sooner,
 * which keeps distant walls reading as far away.
 */
export function strataMaterial(haze = 1): THREE.MeshStandardMaterial {
  // Normals come with the geometry: flat per facet, except on scree.
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0, envMapIntensity: 0.3 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float strata;\nvarying float vStrata;\nvarying vec3 vRockPos;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vStrata = strata;
        vRockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vStrata;
        varying vec3 vRockPos;
        float rHash(float n) { return fract(sin(n) * 43758.5453); }
        float rNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float n = i.x + i.y * 57.0;
          return mix(mix(rHash(n), rHash(n + 1.0), f.x), mix(rHash(n + 57.0), rHash(n + 58.0), f.x), f.y);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Layers about 3–6 m thick; their boundaries waver a little along the rock.
        float wave = (rNoise(vRockPos.xz * 0.025) - 0.5) * 5.0 + (rNoise(vRockPos.xz * 0.15) - 0.5) * 0.8;
        float h = (vRockPos.y + wave) / 4.2;
        float layer = floor(h);
        float pick = rHash(layer * 13.1);
        vec3 band = pick < 0.3 ? vec3(0.42, 0.11, 0.035) : pick < 0.55 ? vec3(0.56, 0.2, 0.07) : pick < 0.72 ? vec3(0.2, 0.06, 0.025) : pick < 0.88 ? vec3(0.64, 0.3, 0.12) : vec3(0.33, 0.1, 0.04);
        // Soft edges between layers and fine grain within them.
        band *= 0.88 + 0.12 * smoothstep(0.0, 0.12, fract(h)) + (rNoise(vRockPos.xy * 1.7 + vRockPos.zy * 1.3) - 0.5) * 0.12;
        diffuseColor.rgb *= mix(vec3(1.0), band, vStrata);`)
      .replace('#include <fog_fragment>', haze === 1 ? '#include <fog_fragment>' : `
        #ifdef USE_FOG
          float hazeDepth = vFogDepth * ${haze.toFixed(2)};
          float haze = 1.0 - exp(-fogDensity * fogDensity * hazeDepth * hazeDepth);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, haze);
        #endif`);
  };
  material.customProgramCacheKey = () => `mars-strata-${haze}`;
  return material;
}

export type FormKind = 'mesa' | 'butte' | 'spire' | 'ledge';

/** Ring profile per kind: [height fraction, radius scale]. The first ring is buried. */
const PROFILES: Record<FormKind, [number, number][]> = {
  // Wide talus apron, a sheer cliff with one step, and a flat cap.
  mesa: [[-0.25, 1.45], [0, 1.32], [0.22, 1.06], [0.5, 1], [0.56, 0.9], [0.94, 0.87], [1, 0.8]],
  butte: [[-0.2, 1.5], [0, 1.3], [0.3, 1.02], [0.72, 0.95], [0.78, 0.86], [0.97, 0.82], [1, 0.74]],
  // Hoodoo: a slim column under a wider cap rock.
  spire: [[-0.15, 1.6], [0, 1.25], [0.25, 0.9], [0.6, 0.62], [0.8, 0.55], [0.86, 0.95], [0.97, 0.9], [1, 0.6]],
  // A low, broken shelf of rock.
  ledge: [[-0.4, 1.4], [0, 1.25], [0.45, 1.02], [0.9, 0.95], [1, 0.84]],
};

/**
 * A rock formation built from noisy rings stacked up a profile, with a cap on top. Radius and
 * height in metres; the base sits at y = 0 and the buried ring goes below it.
 */
export function formationGeometry(kind: FormKind, radius: number, height: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const outline = valueNoise(hashSeed(`${seed}:outline`));
  const segments = Math.max(9, Math.min(26, Math.round(radius / 2.5)));
  const stretch = rng.range(0.65, 1);
  const profile = PROFILES[kind];
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [ring, [fy, scale]] of profile.entries()) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      // Lobed outline, then fresh jitter per ring so cliffs are not perfectly vertical.
      const lobes = 0.72 + outline(Math.cos(a) * 1.6 + 5, Math.sin(a) * 1.6 + 5) * 0.62;
      // Scree aprons stay smooth; cliffs are rougher.
      const jitter = 1 + (rng.next() - 0.5) * (ring === profile.length - 1 || fy <= 0.25 ? 0.05 : 0.16);
      const r = radius * scale * lobes * jitter;
      positions.push(Math.cos(a) * r, fy * height + (rng.next() - 0.5) * height * 0.025, Math.sin(a) * r * stretch);
    }
  }
  for (let ring = 0; ring < profile.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const a = ring * segments + i, b = ring * segments + j, c = (ring + 1) * segments + i, d = (ring + 1) * segments + j;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Slightly domed cap.
  const top = profile.length - 1;
  const centre = positions.length / 3;
  positions.push(0, height * (1 + rng.range(0.01, 0.04)), 0);
  for (let i = 0; i < segments; i++) indices.push(top * segments + i, centre, top * segments + (i + 1) % segments);
  const wobble = fbm(hashSeed(`${seed}:wobble`), 2);
  const geometry = facet(positions, indices, (x, y, z, ny) => {
    if (ny > 0.75 && y > height * 0.9) return plain(CAP, 0.9 + wobble(x * 0.05, z * 0.05) * 0.2);
    // Scree slopes are told apart by their angle, so whole bands of the apron share one colour.
    if (ny > 0.22 && y < height * 0.35) return { color: scratch.copy(TALUS).multiplyScalar(0.85 + wobble(x * 0.05, z * 0.05) * 0.25), strata: 0.35 };
    return face(0.92 + wobble(x * 0.08, z * 0.08) * 0.16);
  });
  // Scree aprons get smooth normals, leaning outward like a cone, so neighbouring facets catch a
  // low sun alike instead of flashing light and dark like saw teeth. Cliffs stay chiselled.
  const pos = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), strata = geometry.getAttribute('strata');
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (strata.getX(i) === 1 || normal.getY(i) < 0.22 || normal.getY(i) > 0.97) continue;
    n.set(pos.getX(i), 0, pos.getZ(i)).normalize().setY(0.9).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  return geometry;
}

/**
 * A natural rock arch: a thick, knobbly tube along a squashed half-ellipse whose legs are buried.
 * `span` is the opening's width, `height` its top; the arch spans along local X.
 */
export function archGeometry(span: number, height: number, thickness: number, seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const lumps = valueNoise(hashSeed(`${seed}:arch`));
  const steps = 26, sides = 9;
  const positions: number[] = [];
  const indices: number[] = [];
  const centre = new THREE.Vector3(), tangent = new THREE.Vector3(), normal = new THREE.Vector3(), binormal = new THREE.Vector3(0, 0, 1);
  for (let s = 0; s <= steps; s++) {
    // Angle from one buried foot over the top to the other.
    const t = s / steps, a = Math.PI * (1.12 - t * 1.24);
    centre.set(Math.cos(a) * span * 0.5, Math.sin(a) * height, 0);
    tangent.set(-Math.sin(a) * span * 0.5, Math.cos(a) * height, 0).normalize().multiplyScalar(-1);
    normal.crossVectors(binormal, tangent).normalize();
    // Legs are much thicker than the thin span across the top.
    const r = thickness * (0.55 + Math.pow(Math.abs(t - 0.5) * 2, 2) * 0.9);
    for (let k = 0; k < sides; k++) {
      const b = (k / sides) * Math.PI * 2;
      const bump = 0.8 + lumps(s * 0.6, k * 0.9) * 0.45 + (rng.next() - 0.5) * 0.08;
      const ox = Math.cos(b) * r * bump, oz = Math.sin(b) * r * bump * 1.35;
      positions.push(centre.x + normal.x * ox, centre.y + normal.y * ox, oz);
    }
  }
  for (let s = 0; s < steps; s++) for (let k = 0; k < sides; k++) {
    const k2 = (k + 1) % sides;
    const a = s * sides + k, b = s * sides + k2, c = (s + 1) * sides + k, d = (s + 1) * sides + k2;
    indices.push(a, b, c, b, d, c);
  }
  return facet(positions, indices, () => face(0.9 + rng.next() * 0.15));
}

/** A lumpy boulder of radius 1 shared by every scattered rock; instances scale and turn it. */
export function boulderGeometry(seed: number): THREE.BufferGeometry {
  const base = new THREE.IcosahedronGeometry(1, 1);
  const pos = base.getAttribute('position') as THREE.BufferAttribute;
  const n = valueNoise(hashSeed(`${seed}:boulder`));
  const positions: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.72 + n(x * 2 + 9, z * 2 + y * 1.3 + 9) * 0.5;
    positions.push(x * k, y * k * 0.72, z * k);
  }
  // IcosahedronGeometry is non-indexed; corners shared between faces get the same displacement.
  const indices = Array.from({ length: pos.count }, (_, i) => i);
  base.dispose();
  return facet(positions, indices, () => plain(FACE));
}

/** Distant canyon walls: terraced cliffs that drift at 3 % of the car's speed. */
export const CLIFF_CONFIG = {
  tileLength: 300,
  rowStep: 15,
  inner: 950,
  outer: 1700,
  columns: 34,
  peak: 190,
  baseY: -40,
} as const;

/**
 * One tile of both canyon walls as a terraced heightfield. Noise runs in course-wide coordinates,
 * so the walls continue seamlessly from tile to tile.
 */
export function buildCliffTile(seed: number, index: number): THREE.BufferGeometry {
  const { tileLength, rowStep, inner, outer, columns, peak, baseY } = CLIFF_CONFIG;
  const ridges = fbm(hashSeed(`${seed >>> 0}:cliffs`), 5);
  const rows = Math.round(tileLength / rowStep);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const side of [-1, 1]) {
    const start = positions.length / 3;
    for (let r = 0; r <= rows; r++) {
      const t = r * rowStep, along = index * tileLength + t;
      for (let c = 0; c <= columns; c++) {
        const f = c / columns;
        const lateral = inner + (outer - inner) * f;
        const n = ridges(lateral * 0.004 + (side > 0 ? 50 : 0), along * 0.004);
        // Rise steeply from the canyon floor, then step up in terraces like eroded plateaus.
        const rise = Math.min(1, f * 4) * (0.45 + n * 0.75);
        const raw = rise * peak;
        const step = 28;
        const terrace = Math.floor(raw / step) * step + Math.pow((raw % step) / step, 4) * step;
        const y = c === 0 ? baseY : baseY + 30 + terrace;
        positions.push(side * lateral, y, -t);
      }
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const a = start + r * (columns + 1) + c, b = a + 1, d = a + columns + 1, e = d + 1;
      if (side > 0) indices.push(a, b, d, b, e, d); else indices.push(a, d, b, b, d, e);
    }
  }
  return facet(positions, indices, (_x, _y, _z, ny) => (ny > 0.8 ? plain(CAP, 0.85) : face(1)));
}
