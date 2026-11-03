import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ParallaxTile } from '../parallax';
import { DINO_THEME, type Tone } from './theme';
import { toneMaterial } from './trackStyle';

const TONE_ORDER: readonly Tone[] = ['paper', 'light', 'mist', 'mid', 'dark', 'ink'];

/** Text drawn on a prop (a tombstone, a plaque); the texture is shared by every prop with the same lines. */
export interface Label { lines: readonly string[]; matrix: THREE.Matrix4; width: number; height: number }

/** A grey-level material per tone, shared by all dino scenery; day and night repaint them in place. */
export class ToneMaterials {
  private readonly materials = new Map<Tone, THREE.MeshBasicMaterial>();
  get(tone: Tone) {
    let material = this.materials.get(tone);
    if (!material) { material = toneMaterial(tone); this.materials.set(tone, material); }
    return material;
  }
  dispose() { for (const material of this.materials.values()) material.dispose(); this.materials.clear(); }
}

/**
 * Collects boxes and other solids into one merged mesh per grey level, so a whole tile of scenery
 * costs a handful of draw calls. Props are written around the origin facing +Z; `place` positions,
 * turns and scales everything added after it.
 */
export class PixelBuilder {
  private readonly parts = new Map<Tone, THREE.BufferGeometry[]>();
  private readonly current = new THREE.Matrix4();
  readonly labels: Label[] = [];

  place(x: number, y: number, z: number, yaw = 0, scale = 1): this {
    this.current.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
    return this;
  }

  /** An axis-aligned box centred at (cx, cy, cz) in the current prop's frame. */
  box(tone: Tone, cx: number, cy: number, cz: number, w: number, h: number, d: number): this {
    return this.solid(tone, new THREE.BoxGeometry(w, h, d).translate(cx, cy, cz));
  }

  /** Any geometry already in the current prop's frame (it is transformed by `place`). */
  solid(tone: Tone, geometry: THREE.BufferGeometry): this {
    geometry.applyMatrix4(this.current);
    const list = this.parts.get(tone) ?? [];
    list.push(geometry);
    this.parts.set(tone, list);
    return this;
  }

  label(lines: readonly string[], cx: number, cy: number, cz: number, width: number, height: number): this {
    const matrix = this.current.clone().multiply(new THREE.Matrix4().makeTranslation(cx, cy, cz));
    this.labels.push({ lines, matrix, width, height });
    return this;
  }

  /** One merged geometry per tone; the builder is spent afterwards. */
  build(): { tone: Tone; geometry: THREE.BufferGeometry }[] {
    const out: { tone: Tone; geometry: THREE.BufferGeometry }[] = [];
    for (const tone of TONE_ORDER) {
      const list = this.parts.get(tone);
      if (!list?.length) continue;
      for (const g of list) { g.deleteAttribute('uv'); if (!g.index) throw new Error('indexed geometry expected'); }
      const geometry = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (geometry) out.push({ tone, geometry });
    }
    this.parts.clear();
    return out;
  }
}

const labelCache = new Map<string, { texture: THREE.CanvasTexture; material: THREE.MeshBasicMaterial }>();
const labelPlane = new THREE.PlaneGeometry(1, 1);

/** Text needs a canvas, which only a browser has; headless runs (tests) draw props without it. */
const canDraw = () => typeof document !== 'undefined';

function labelMaterial(lines: readonly string[], aspect: number) {
  const key = `${aspect.toFixed(2)}|${lines.join('\n')}`;
  let entry = labelCache.get(key);
  if (!entry) {
    // The canvas has the plane's proportions, so text is never stretched.
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = Math.max(64, Math.round(512 / aspect));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const rows = lines.length, rowHeight = canvas.height / rows;
      lines.forEach((line, i) => {
        let px = Math.round(rowHeight * (i === 0 && rows > 2 ? 0.7 : 0.6));
        ctx.font = `bold ${px}px "Courier New", monospace`;
        // Shrink long names until they fit between the stone's edges.
        while (ctx.measureText(line).width > canvas.width - 24 && px > 12) ctx.font = `bold ${--px}px "Courier New", monospace`;
        ctx.fillText(line, canvas.width / 2, (i + 0.5) * rowHeight);
      });
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    material.color = DINO_THEME.ink;
    entry = { texture, material };
    labelCache.set(key, entry);
  }
  return entry.material;
}

export function disposeLabels() {
  for (const { texture, material } of labelCache.values()) { texture.dispose(); material.dispose(); }
  labelCache.clear();
}

/** Turns a spent builder into a scenery tile: merged meshes plus any text labels. */
export function tileFromBuilder(builder: PixelBuilder, materials: ToneMaterials, animate?: ParallaxTile['animate'], extra?: THREE.Object3D, extraDispose?: () => void): ParallaxTile {
  const object = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  for (const { tone, geometry } of builder.build()) {
    object.add(new THREE.Mesh(geometry, materials.get(tone)));
    geometries.push(geometry);
  }
  if (canDraw()) {
    for (const label of builder.labels) {
      const mesh = new THREE.Mesh(labelPlane, labelMaterial(label.lines, label.width / label.height));
      mesh.matrix.copy(label.matrix).scale(new THREE.Vector3(label.width, label.height, 1));
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 1;
      object.add(mesh);
    }
  }
  if (extra) object.add(extra);
  return { object, animate, dispose: () => { for (const g of geometries) g.dispose(); extraDispose?.(); } };
}
