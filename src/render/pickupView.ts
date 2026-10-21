import * as THREE from 'three';
import type { Level } from '../game/physics/level';

/** Glowing, spinning fuel cells kept in sync with the level's active pickups. */
export class PickupView {
  readonly group = new THREE.Group();
  private items = new Map<number, THREE.Group>();
  private coreGeo = new THREE.OctahedronGeometry(0.95, 0);
  private ringGeo = new THREE.TorusGeometry(1.25, 0.07, 8, 32);
  private coreMat = new THREE.MeshStandardMaterial({ color: 0xb6ff3b, emissive: 0x8cff00, emissiveIntensity: 1.8, metalness: 0.2, roughness: 0.3 });
  private ringMat = new THREE.MeshBasicMaterial({ color: 0xe9ff9a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  private beamGeo = new THREE.CylinderGeometry(0.3, 0.3, 1, 16, 1, true);
  private beamMat = new THREE.MeshBasicMaterial({ color: 0xb6ff3b, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  private burstGeo = new THREE.TorusGeometry(1, 0.08, 8, 40);
  private bursts: { mesh: THREE.Mesh; age: number }[] = [];
  private known = new Map<number, { x: number; y: number; d: number; surface: string }>();
  private time = 0;
  private originDistance = 0;

  sync(level: Level, carDistance?: number, originDistance = 0) {
    if (originDistance !== this.originDistance) {
      const delta = originDistance - this.originDistance;
      for (const [id, mesh] of this.items) mesh.position.z = originDistance - this.known.get(id)!.d;
      for (const burst of this.bursts) burst.mesh.position.z += delta;
      this.originDistance = originDistance;
    }
    const active = level.activePickups;
    if (!active) return;
    for (const [id, obj] of this.items) {
      if (!active.has(id)) {
        this.group.remove(obj);
        this.items.delete(id);
        const p = this.known.get(id);
        this.known.delete(id);
        if (p && carDistance !== undefined && Math.abs(p.d - carDistance) < 12) this.burst(obj.position);
      }
    }
    for (const p of active.values()) {
      if (this.items.has(p.id)) continue;
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.coreGeo, this.coreMat));
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      g.add(ring);
      const light = new THREE.PointLight(0xb6ff3b, 14, 14, 1.5);
      g.add(light);
      // A tall translucent beam across the corridor makes the cell visible from far away.
      const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
      const s = (p as { surface?: string }).surface;
      // Beam spans from the surface across the corridor (offset toward the centre).
      if (s === 'left' || s === 'right') {
        beam.rotation.z = Math.PI / 2;
        beam.scale.set(1, 10, 1);
        beam.position.x = s === 'left' ? 4 : -4;
      } else {
        beam.scale.set(1, 9, 1);
        beam.position.y = s === 'ceiling' ? -3.5 : 3.5;
      }
      g.add(beam);
      this.known.set(p.id, { x: p.x, y: p.y, d: p.d, surface: s ?? '' });
      g.position.set(p.x, p.y, originDistance - p.d);
      this.group.add(g);
      this.items.set(p.id, g);
    }
  }

  private burst(at: THREE.Vector3) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xd9ff7a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(this.burstGeo, mat);
    mesh.position.copy(at);
    this.group.add(mesh);
    this.bursts.push({ mesh, age: 0 });
  }

  update(dt: number) {
    this.time += dt;
    for (const b of this.bursts) {
      b.age += dt;
      const k = b.age / 0.5;
      b.mesh.scale.setScalar(1 + k * 5);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
    }
    for (const b of this.bursts.filter((x) => x.age > 0.5)) {
      this.group.remove(b.mesh);
      (b.mesh.material as THREE.Material).dispose();
    }
    this.bursts = this.bursts.filter((x) => x.age <= 0.5);
    const bob = Math.sin(this.time * 3) * 0.12;
    for (const g of this.items.values()) {
      g.children[0].rotation.y = this.time * 2;
      g.children[0].position.y = bob;
      g.children[1].rotation.x = this.time * 1.3;
      g.children[1].rotation.y = this.time * 0.9;
    }
  }

  clear() {
    for (const obj of this.items.values()) this.group.remove(obj);
    this.items.clear();
    this.known.clear();
    for (const burst of this.bursts) {
      this.group.remove(burst.mesh);
      (burst.mesh.material as THREE.Material).dispose();
    }
    this.bursts = [];
    this.time = 0;
    this.originDistance = 0;
  }

  dispose() {
    this.clear();
    this.coreGeo.dispose();
    this.ringGeo.dispose();
    this.beamGeo.dispose();
    this.burstGeo.dispose();
    this.coreMat.dispose();
    this.ringMat.dispose();
    this.beamMat.dispose();
  }
}
