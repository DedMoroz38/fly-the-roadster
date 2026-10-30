import * as THREE from 'three';
import type { SurfaceType } from '../../game/surfaces';
import type { GridOrigin, ObstacleKind, ObstacleStyle, PickupStyle, SurfaceStyle } from '../trackStyle';
import { blockTexture, type BlockTexture } from './textures';

interface BlockMaterialOptions {
  texture: BlockTexture;
  /** Texture for faces that point up or down (TNT tops). */
  top?: BlockTexture;
  /** Metres covered by one texture repeat. */
  period: number;
  /** Lit by the scene's lights (track slabs); otherwise flat-shaded like voxel blocks. */
  lit?: boolean;
  /** Brightness multiplier; above 1 makes the bloom pass glow. */
  glow?: number;
  /** Floor only: sea-lantern tiles set into both outer lanes every 8 m. */
  lanes?: boolean;
  /** Crying obsidian: its purple specks glow. */
  glowSpecks?: boolean;
  /** Top faces are flowing water (`top` texture); the undersides use the side texture. */
  water?: boolean;
}

/** Seconds of world time, advanced by the voxel environment; drives flowing water on the track. */
export const VOXEL_TIME = { value: 0 };

const LANE = { texture: 'sea_lantern' as BlockTexture, cells: [-3, 2], every: 4, glow: 0.9 };

/**
 * A block texture mapped in world space, so it tiles per metre on slabs and boxes of any size. The
 * repeat origin follows the floating physics origin (shared `origin` uniform), so textures never swim.
 */
export function blockMaterial(o: BlockMaterialOptions, origin: GridOrigin): THREE.Material {
  const glow = o.glow ?? 1;
  const material = o.lit
    ? new THREE.MeshStandardMaterial({ map: blockTexture(o.texture), roughness: o.water ? 0.6 : 0.82, metalness: 0.06 })
    : new THREE.MeshBasicMaterial({ map: blockTexture(o.texture), color: new THREE.Color(glow, glow, glow) });
  const top = blockTexture(o.top ?? o.texture);
  const lane = blockTexture(LANE.texture);
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uGridOrigin: origin, uPeriod: { value: o.period }, uTopMap: { value: top }, uLaneMap: { value: lane }, uTime: VOXEL_TIME,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBlockPos;\nvarying vec3 vBlockNormal;\nuniform float uGridOrigin;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vBlockPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vBlockPos.z -= uGridOrigin;
        vBlockNormal = normalize(mat3(modelMatrix) * normal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBlockPos;
        varying vec3 vBlockNormal;
        uniform float uPeriod;
        uniform sampler2D uTopMap;
        uniform sampler2D uLaneMap;
        uniform float uTime;`)
      .replace('#include <map_fragment>', `
        vec3 an = abs(vBlockNormal);
        bool upDown = an.y >= max(an.x, an.z);
        vec3 bp = vBlockPos / uPeriod;
        vec2 buv = upDown ? bp.xz : (an.x >= an.z ? vec2(bp.z, bp.y) : bp.xy);
        vec4 texel = upDown ? texture2D(uTopMap, fract(buv)) : texture2D(map, fract(buv));
        float waterGlow = 0.0;
        ${o.water ? `
        if (upDown && vBlockNormal.y > 0.0) {
          // Two layers flowing at different speeds and scales break up the repeat, like a current.
          vec4 near = texture2D(uTopMap, fract(buv + vec2(0.0, uTime * 0.35)));
          vec4 far = texture2D(uTopMap, fract(buv * 0.5 + vec2(uTime * 0.04, uTime * 0.12)));
          texel = mix(near, far, 0.45) * vec4(0.78, 0.84, 0.95, 1.0);
          waterGlow = 1.0;
        } else if (upDown) texel = texture2D(map, fract(buv));` : ''}
        float laneGlow = 0.0;
        ${o.lanes ? `
        vec2 cell = floor(vBlockPos.xz / uPeriod);
        bool laneX = abs(cell.x - ${LANE.cells[0].toFixed(1)}) < 0.5 || abs(cell.x - ${LANE.cells[1].toFixed(1)}) < 0.5;
        if (upDown && laneX && abs(mod(cell.y, ${LANE.every.toFixed(1)})) < 0.5) { texel = texture2D(uLaneMap, fract(buv)); laneGlow = 1.0; }` : ''}
        ${o.glowSpecks ? 'if (texel.b > texel.g + 0.25 && texel.r > 0.1) texel.rgb *= 2.8;' : ''}
        ${o.lit ? '' : '// Block-style face shading: bright tops, darker sides, darkest undersides.\n        texel.rgb *= upDown ? (vBlockNormal.y > 0.0 ? 1.0 : 0.55) : (an.x >= an.z ? 0.8 : 0.66);'}
        diffuseColor *= texel;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        ${o.lit && o.lanes ? `totalEmissiveRadiance += texel.rgb * laneGlow * ${LANE.glow.toFixed(2)};` : ''}
        ${o.lit && o.water ? '// Water carries a little light of its own, so the road stays brighter than what sits on it.\n        totalEmissiveRadiance += texel.rgb * waterGlow * (1.0 - laneGlow) * 0.1;' : ''}`);
  };
  material.customProgramCacheKey = () => `block-${o.texture}-${o.top ?? ''}-${o.period}-${o.lit ? 1 : 0}-${o.lanes ? 1 : 0}-${o.glowSpecks ? 1 : 0}-${o.water ? 1 : 0}`;
  return material;
}

/**
 * Steve's sky road: a flowing water channel in stone-brick sides (he is in a boat) with submerged
 * sea-lantern lane lights, purpur ceiling, prismarine and terracotta walls. The colour coding (blue
 * floor, purple ceiling, green left, orange right) matches the neon world, so surfaces stay recognisable.
 */
export const VOXEL_SURFACES: SurfaceStyle = {
  surface: (surface: SurfaceType, origin: GridOrigin) => surface === 'floor'
    ? blockMaterial({ texture: 'stone_bricks', top: 'water', period: 2, lit: true, lanes: true, water: true }, origin)
    : blockMaterial({ texture: ({ ceiling: 'purpur', left: 'prismarine', right: 'terracotta' } as const)[surface], period: 2, lit: true }, origin),
  edge: (surface: SurfaceType, origin: GridOrigin) => blockMaterial({
    texture: ({ floor: 'sea_lantern', ceiling: 'amethyst', left: 'emerald', right: 'glowstone' } as const)[surface],
    period: 1, glow: 1.1,
  }, origin),
  trim: 0.22,
  bar: 0.4,
};

/** Obsidian blocks, crying-obsidian gates (the portal frames) and TNT barriers to jump. */
export function voxelObstacles(): ObstacleStyle {
  const edges = new THREE.LineBasicMaterial({ color: 0xc58bff, toneMapped: false });
  const tntEdges = new THREE.LineBasicMaterial({ color: 0xffd2b0, toneMapped: false });
  return {
    material: (kind: ObstacleKind, origin: GridOrigin) => kind === 'barrier'
      ? blockMaterial({ texture: 'tnt_side', top: 'tnt_top', period: 1, glow: 1.15 }, origin)
      : blockMaterial({ texture: kind === 'gate' ? 'crying_obsidian' : 'obsidian', period: 1, glow: 1.25, glowSpecks: kind === 'gate' }, origin),
    edges: (kind: ObstacleKind) => (kind === 'barrier' ? tntEdges : edges),
  };
}

/** Fuel cells become glowing emerald blocks circled by experience orbs. */
export function voxelPickups(): PickupStyle {
  const core = new THREE.BoxGeometry(1.3, 1.3, 1.3);
  const coreMaterial = new THREE.MeshBasicMaterial({ map: blockTexture('emerald'), color: new THREE.Color(1.9, 1.9, 1.9) });
  const orb = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const orbMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 0.5) });
  return {
    core, coreMaterial,
    ring: () => {
      const ring = new THREE.Group();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const piece = new THREE.Mesh(orb, orbMaterial);
        piece.position.set(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0);
        ring.add(piece);
      }
      return ring;
    },
    light: 0x4dff8a, beam: 0x5dff9a, burst: 0x9dffb0,
    dispose: () => { core.dispose(); coreMaterial.dispose(); orb.dispose(); orbMaterial.dispose(); },
  };
}
