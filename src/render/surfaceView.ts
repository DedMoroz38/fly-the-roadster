import * as THREE from 'three';
import { SlabSet } from '../game/physics/level';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { slabParts, SurfaceType } from '../game/surfaces';
import { CONFIG } from '../game/config';

export const SURFACE_COLORS: Record<SurfaceType, { base: number; line: number }> = {
  floor: { base: 0x26324a, line: 0x2fd4ff },
  ceiling: { base: 0x3a2350, line: 0xd05bff },
  left: { base: 0x173f3a, line: 0x2bffb0 },
  right: { base: 0x4a2f18, line: 0xffa53d },
};

/** Standard material with a world-space neon grid injected into the emissive term. */
function gridMaterial(surface: SurfaceType): THREE.MeshStandardMaterial {
  const { base, line } = SURFACE_COLORS[surface];
  const mat = new THREE.MeshStandardMaterial({ color: base, roughness: 0.55, metalness: 0.35 });
  const lineColor = new THREE.Color(line);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLineColor = { value: lineColor };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGridNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;\nuniform vec3 uLineColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 gp = vGridPos / vec3(2.0, 2.0, 4.0);
        vec3 gw = fwidth(gp) * 1.2;
        vec3 g = abs(fract(gp - 0.5) - 0.5) / max(gw, vec3(1e-4));
        g += abs(vGridNormal) * 1e4; // no lines along the face's own normal axis
        float lineMin = min(min(g.x, g.y), g.z);
        float gridLine = 1.0 - clamp(lineMin, 0.0, 1.0);
        totalEmissiveRadiance += uLineColor * gridLine * 0.45 + uLineColor * 0.025;`,
      );
  };
  mat.customProgramCacheKey = () => 'grid-' + surface;
  return mat;
}

/** Keeps one mesh per active slab in sync with the physics slab set. */
export class SurfaceView {
  readonly group = new THREE.Group();
  private meshes = new Map<number, THREE.Object3D>();
  private materials: Record<SurfaceType, THREE.MeshStandardMaterial>;
  private edgeMaterials: Record<SurfaceType, THREE.MeshBasicMaterial>;
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private edgeGeo = new THREE.BoxGeometry(1, 1, 1);
  private syncedVersion = -1;
  private source: SlabSet | null = null;

  constructor() {
    this.materials = {
      floor: gridMaterial('floor'),
      ceiling: gridMaterial('ceiling'),
      left: gridMaterial('left'),
      right: gridMaterial('right'),
    };
    const edge = (s: SurfaceType) => new THREE.MeshBasicMaterial({ color: SURFACE_COLORS[s].line });
    this.edgeMaterials = { floor: edge('floor'), ceiling: edge('ceiling'), left: edge('left'), right: edge('right') };
  }

  sync(slabs: SlabSet) {
    if (this.source !== slabs) {
      this.clear();
      this.source = slabs;
      this.syncedVersion = -1;
    }
    if (slabs.version === this.syncedVersion) return;
    this.syncedVersion = slabs.version;
    for (const [id, obj] of this.meshes) {
      if (!slabs.active.has(id)) this.removeMesh(id, obj);
    }
    for (const slab of slabs.active.values()) {
      if (this.meshes.has(slab.id)) continue;
      const { box, lead } = slabParts(slab.surface, slab.d0, slab.d1, slab.bevel !== false);
      const holder = new THREE.Group();
      if (box) {
        const mesh = new THREE.Mesh(this.boxGeo, this.materials[slab.surface]);
        mesh.scale.set(box.half.x * 2, box.half.y * 2, box.half.z * 2);
        mesh.position.set(box.center.x, box.center.y, box.center.z);
        holder.add(mesh);
      }
      if (lead) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i < lead.length; i += 3) pts.push(new THREE.Vector3(lead[i], lead[i + 1], lead[i + 2]));
        const geo = new ConvexGeometry(pts);
        holder.add(new THREE.Mesh(geo, this.materials[slab.surface]));
        holder.userData.ownGeometry = geo;
      }
      // Glowing bars across both ends of the slab so starts, ends and gaps read clearly.
      const ends = slabParts(slab.surface, slab.d0, slab.d1, false).box!;
      for (const end of [-1, 1]) {
        if (end === 1 && slab.bevel === false) continue; // +1 is the start (z = -d0); continuation seam: no marker
        const bar = new THREE.Mesh(this.edgeGeo, this.edgeMaterials[slab.surface]);
        bar.scale.set(ends.half.x * 2 + 0.04, ends.half.y * 2 + 0.04, 0.12);
        bar.position.set(ends.center.x, ends.center.y, ends.center.z + end * (ends.half.z - 0.05));
        holder.add(bar);
      }
      // Neon trim along the corridor-side edges of the surface: frames the corridor and gives
      // strong perspective lines for depth.
      const { halfWidth: W, height: H } = CONFIG.corridor;
      const len = slab.d1 - slab.d0 - (slab.bevel === false ? 0 : 3);
      const zc = -(slab.d0 + (slab.bevel === false ? 0 : 3) + slab.d1) / 2;
      const trims: [number, number][] =
        slab.surface === 'floor' ? [[-W, 0.02], [W, 0.02]]
        : slab.surface === 'ceiling' ? [[-W, H - 0.02], [W, H - 0.02]]
        : slab.surface === 'left' ? [[-W + 0.02, 0], [-W + 0.02, H]]
        : [[W - 0.02, 0], [W - 0.02, H]];
      for (const [x, y] of trims) {
        const trim = new THREE.Mesh(this.edgeGeo, this.edgeMaterials[slab.surface]);
        trim.scale.set(0.08, 0.08, len);
        trim.position.set(x, y, zc);
        holder.add(trim);
      }
      this.group.add(holder);
      this.meshes.set(slab.id, holder);
    }
  }

  private removeMesh(id: number, obj: THREE.Object3D) {
    this.group.remove(obj);
    (obj.userData.ownGeometry as THREE.BufferGeometry | undefined)?.dispose();
    this.meshes.delete(id);
  }

  clear() {
    for (const [id, obj] of [...this.meshes]) this.removeMesh(id, obj);
    this.source = null;
    this.syncedVersion = -1;
  }
}
