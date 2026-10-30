import * as THREE from 'three';
import { blockTexture, type BlockTexture } from './textures';
import type { MobKind } from './islands';

/** Pixel units: one mob "pixel" is 1/16 of a block, as in the original proportions. */
const PX = 1 / 16;

const materials = new Map<string, THREE.MeshBasicMaterial>();
function material(name: BlockTexture, light = 1) {
  const key = `${name}:${light}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ map: blockTexture(name), color: new THREE.Color(light, light, light) });
    materials.set(key, m);
  }
  return m;
}

/** A box part with a skin on every side and an optional face on its front (+Z). Faces are shaded like blocks. */
function part(w: number, h: number, d: number, skin: BlockTexture, face?: BlockTexture) {
  const geometry = new THREE.BoxGeometry(w * PX, h * PX, d * PX);
  // Box material order: +X, −X, +Y, −Y, +Z, −Z.
  const mats = [material(skin, 0.8), material(skin, 0.8), material(skin, 1), material(skin, 0.55),
    material(face ?? skin, 0.95), material(skin, 0.68)];
  return new THREE.Mesh(geometry, mats);
}

/** A limb that swings about its top edge. */
function limb(w: number, h: number, d: number, skin: BlockTexture, x: number, y: number, z: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x * PX, y * PX, z * PX);
  const mesh = part(w, h, d, skin);
  mesh.position.y = (-h / 2) * PX;
  pivot.add(mesh);
  return pivot;
}

export interface Mob { object: THREE.Group; animate(time: number): void }

/** Builds a mob one block = 1 unit tall-scale; the caller scales it to the scenery block size. */
export function buildMob(kind: MobKind | 'ghast', phase = 0): Mob {
  const g = new THREE.Group();
  const swing: { pivot: THREE.Group; sign: number; amount: number }[] = [];
  if (kind === 'creeper') {
    const body = part(8, 12, 4, 'creeper_skin'); body.position.y = 12 * PX; g.add(body);
    const head = part(8, 8, 8, 'creeper_skin', 'creeper_face'); head.position.y = 22 * PX; g.add(head);
    for (const [x, z, sign] of [[-2, 4, 1], [2, 4, -1], [-2, -4, -1], [2, -4, 1]]) {
      const leg = limb(4, 6, 4, 'creeper_skin', x, 6, z); g.add(leg); swing.push({ pivot: leg, sign, amount: 0.5 });
    }
  } else if (kind === 'zombie' || kind === 'skeleton') {
    const skin: BlockTexture = kind === 'zombie' ? 'zombie_skin' : 'bone';
    const thin = kind === 'skeleton' ? 2 : 4;
    const body = part(8, 12, 4, kind === 'zombie' ? 'shirt' : 'bone'); body.position.y = 18 * PX; g.add(body);
    const head = part(8, 8, 8, skin, kind === 'zombie' ? 'zombie_face' : 'skull_face'); head.position.y = 28 * PX; g.add(head);
    for (const [x, sign] of [[-2, 1], [2, -1]]) {
      const leg = limb(thin, 12, thin, kind === 'zombie' ? 'pants' : 'bone', x, 12, 0); g.add(leg); swing.push({ pivot: leg, sign, amount: 0.45 });
    }
    for (const x of [-6, 6]) {
      // Arms held forward, swaying slightly.
      const arm = limb(thin, 12, thin, skin, x, 23, 0); arm.rotation.x = -Math.PI / 2; g.add(arm); swing.push({ pivot: arm, sign: x > 0 ? 1 : -1, amount: 0.08 });
    }
  } else if (kind === 'spider') {
    const abdomen = part(10, 8, 12, 'spider'); abdomen.position.set(0, 6 * PX, -9 * PX); g.add(abdomen);
    const body = part(6, 6, 6, 'spider'); body.position.set(0, 5 * PX, 0); g.add(body);
    const head = part(8, 8, 8, 'spider', 'spider_face'); head.position.set(0, 5 * PX, 7 * PX); g.add(head);
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1, z = -3 + (i % 4) * 2.5;
      const leg = new THREE.Group(); leg.position.set(side * 3 * PX, 5 * PX, z * PX);
      const mesh = part(16, 2, 2, 'spider'); mesh.position.x = side * 8 * PX; leg.add(mesh);
      leg.rotation.z = side * 0.45; g.add(leg); swing.push({ pivot: leg, sign: i % 2 ? 1 : -1, amount: 0.25 });
    }
  } else {
    // Ghast: a big pale cube trailing nine tentacles.
    const body = part(16, 16, 16, 'ghast', 'ghast_face'); body.position.y = 16 * PX; g.add(body);
    for (let i = 0; i < 9; i++) {
      const x = -5 + (i % 3) * 5, z = -5 + Math.floor(i / 3) * 5;
      const t = limb(2, 9 + (i * 7) % 6, 2, 'ghast', x, 8, z); g.add(t); swing.push({ pivot: t, sign: i % 2 ? 1 : -1, amount: 0.3 });
    }
  }
  const animate = (time: number) => {
    const t = time * (kind === 'ghast' ? 1.6 : 5) + phase;
    for (const { pivot, sign, amount } of swing) {
      if (kind === 'spider') pivot.rotation.y = Math.sin(t) * sign * amount;
      else pivot.rotation.x = (kind === 'zombie' || kind === 'skeleton') && amount < 0.1
        ? -Math.PI / 2 + Math.sin(t * 0.5) * amount
        : Math.sin(t) * sign * amount;
    }
    if (kind === 'ghast') g.position.y = g.userData.baseY + Math.sin(time * 0.8 + phase) * 2;
  };
  g.userData.baseY = 0;
  return { object: g, animate };
}
