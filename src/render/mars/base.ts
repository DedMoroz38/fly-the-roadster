import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../core/rng';

/** Foundations reach this far below ground so structures never float over a dip. */
export const FOOTING = 9;

const glowing = (hex: number, k: number) => new THREE.Color(hex).multiplyScalar(k);

/** A geodesic hemisphere: the upper half of an icosphere, with a flat floor. */
function geodesicDome(radius: number): THREE.BufferGeometry {
  const sphere = new THREE.IcosahedronGeometry(radius, 2);
  const pos = sphere.getAttribute('position');
  const kept: number[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    const y = Math.min(pos.getY(i), pos.getY(i + 1), pos.getY(i + 2));
    if (y < -radius * 0.02) continue;
    for (let k = 0; k < 3; k++) kept.push(pos.getX(i + k), Math.max(0, pos.getY(i + k)), pos.getZ(i + k));
  }
  sphere.dispose();
  const dome = new THREE.BufferGeometry();
  dome.setAttribute('position', new THREE.Float32BufferAttribute(kept, 3));
  dome.computeVertexNormals();
  return dome;
}

function edges(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const lines = new THREE.EdgesGeometry(source, 1);
  source.dispose();
  return lines;
}

/** Profile of an upright tank with domed ends (radius 1, height 1, base at y = 0). */
function tankProfile(): THREE.Vector2[] {
  const p: THREE.Vector2[] = [new THREE.Vector2(0.001, 0)];
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; p.push(new THREE.Vector2(Math.sin(a) * 1, 0.08 - Math.cos(a) * 0.08 + 0.0)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; p.push(new THREE.Vector2(Math.cos(a) * 1 + 0.001, 0.86 + Math.sin(a) * 0.14)); }
  return p;
}

/** A square lattice mast: four legs with X bracing, base at y = 0, `height` tall. */
function latticeGeometry(height: number, width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const leg = 0.18, h = width / 2;
  for (const [x, z] of [[-h, -h], [h, -h], [h, h], [-h, h]]) {
    const g = new THREE.BoxGeometry(leg, height, leg);
    g.translate(x, height / 2, z);
    parts.push(g);
  }
  const bay = width * 1.3;
  const bays = Math.max(1, Math.round(height / bay));
  const step = height / bays;
  for (let b = 0; b < bays; b++) {
    for (let face = 0; face < 4; face++) {
      for (const dir of [-1, 1]) {
        const length = Math.hypot(width, step);
        const g = new THREE.BoxGeometry(0.09, length, 0.09);
        g.rotateZ(dir * Math.atan2(width, step));
        g.translate(0, b * step + step / 2, h);
        g.rotateY((face * Math.PI) / 2);
        parts.push(g);
      }
      const ring = new THREE.BoxGeometry(width, 0.12, 0.12);
      ring.translate(0, (b + 1) * step, h);
      ring.rotateY((face * Math.PI) / 2);
      parts.push(ring);
    }
  }
  const merged = mergeGeometries(parts.map(p => p.toNonIndexed()), false)!;
  for (const p of parts) p.dispose();
  return merged;
}

/** A parabolic dish facing +Z, about 1 m across. */
function dishGeometry(): THREE.BufferGeometry {
  const p: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) { const r = (i / 8) * 0.5; p.push(new THREE.Vector2(r + 0.001, r * r * 0.8)); }
  const dish = new THREE.LatheGeometry(p, 24);
  dish.rotateX(Math.PI / 2);
  return dish;
}

/**
 * Materials and shared geometry for the code-built parts of the colony: tanks, masts, domes,
 * habitat modules, solar fields, landing pads and cargo pods. Every builder returns an Object3D
 * whose meshes only reference what the kit owns, so dropping a tile disposes nothing here.
 */
export class BaseKit {
  readonly steel = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 0.55, roughness: 0.3 });
  readonly white = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, metalness: 0.15, roughness: 0.5 });
  readonly dark = new THREE.MeshStandardMaterial({ color: 0x2b2e35, metalness: 0.6, roughness: 0.45 });
  readonly concrete = new THREE.MeshStandardMaterial({ color: 0x6d6560, metalness: 0, roughness: 0.92 });
  readonly solar = new THREE.MeshStandardMaterial({ color: 0x18223e, metalness: 0.75, roughness: 0.2 });
  readonly glass = new THREE.MeshStandardMaterial({ color: 0xbfd2de, metalness: 0.2, roughness: 0.06, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide });
  /** Warm light from inside greenhouses and windows; bright enough to bloom a little. */
  readonly greenhouse = new THREE.MeshBasicMaterial({ color: glowing(0x9dff8a, 0.95) });
  readonly window = new THREE.MeshBasicMaterial({ color: glowing(0xffc47a, 1.9) });
  readonly cyan = new THREE.MeshBasicMaterial({ color: glowing(0x46e6ff, 2.2) });
  /** Beacons blink together; the environment drives this colour. */
  readonly beacon = new THREE.MeshBasicMaterial({ color: glowing(0xff4a1a, 3) });
  readonly frame = new THREE.LineBasicMaterial({ color: 0xd8dde4, transparent: true, opacity: 0.55 });
  private readonly geometries = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cylinder: new THREE.CylinderGeometry(1, 1, 1, 20),
    sphere: new THREE.SphereGeometry(1, 12, 8),
    tank: new THREE.LatheGeometry(tankProfile(), 24),
    mast: latticeGeometry(24, 1.6),
    dish: dishGeometry(),
    dome: geodesicDome(1),
    domeFrame: edges(geodesicDome(1)),
    capsule: new THREE.CapsuleGeometry(1, 2, 6, 16),
    ring: new THREE.TorusGeometry(1, 0.012, 4, 64),
  };

  private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, sx = 1, sy = sx, sz = sx) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    return mesh;
  }

  /** An upright stainless propellant tank with a dark band, base at y = 0. */
  tank(radius: number, height: number): THREE.Object3D {
    const g = new THREE.Group();
    g.add(this.mesh(this.geometries.tank, this.steel, 0, 0, 0, radius, height, radius));
    g.add(this.mesh(this.geometries.cylinder, this.dark, 0, height * 0.3, 0, radius * 1.01, 0.5, radius * 1.01));
    // A deep plinth: the top shows, the rest stays buried whatever the ground does.
    g.add(this.mesh(this.geometries.box, this.concrete, 0, -FOOTING / 2 + 0.6, 0, radius * 2.3, FOOTING + 1.2, radius * 2.3));
    return g;
  }

  /** A lattice light mast with a blinking beacon and a cyan floodlight bar near the top. */
  mast(height: number): THREE.Object3D {
    const g = new THREE.Group();
    const s = height / 24;
    // The lattice reaches a few metres into the ground, like a pile.
    g.add(this.mesh(this.geometries.mast, this.steel, 0, -4, 0, s, (height + 4) / 24, s));
    g.add(this.mesh(this.geometries.sphere, this.beacon, 0, height + 0.5, 0, 0.45));
    g.add(this.mesh(this.geometries.box, this.cyan, 0, height * 0.82, 0.9 * s, 1.4 * s, 0.25, 0.1));
    return g;
  }

  /** A horizontal habitat module with a lit window strip, lying along X. */
  module(length: number, radius: number): THREE.Object3D {
    const g = new THREE.Group();
    const body = this.mesh(this.geometries.capsule, this.white, 0, radius, 0, radius, length / 4, radius);
    body.rotation.z = Math.PI / 2;
    g.add(body);
    for (const side of [-1, 1]) g.add(this.mesh(this.geometries.box, this.window, 0, radius * 1.15, side * radius * 0.97, length * 0.55, radius * 0.16, 0.05));
    g.add(this.mesh(this.geometries.box, this.concrete, 0, -FOOTING / 2 + 0.5, 0, length * 1.05, FOOTING + 1, radius * 1.6));
    return g;
  }

  /** A geodesic greenhouse dome: glowing plants inside, glass outside, a white frame on top. */
  dome(radius: number): THREE.Object3D {
    const g = new THREE.Group();
    g.add(this.mesh(this.geometries.dome, this.greenhouse, 0, 0, 0, radius * 0.9, radius * 0.35, radius * 0.9));
    g.add(this.mesh(this.geometries.dome, this.glass, 0, 0, 0, radius));
    const frame = new THREE.LineSegments(this.geometries.domeFrame, this.frame);
    frame.scale.setScalar(radius * 1.002);
    g.add(frame);
    g.add(this.mesh(this.geometries.cylinder, this.concrete, 0, -FOOTING / 2 + 0.2, 0, radius * 1.06, FOOTING + 0.4, radius * 1.06));
    return g;
  }

  /** Rows of tilted solar panels, all one instanced mesh. Rows run along X; the field faces the sun. */
  solarField(rng: Rng, rows: number, perRow: number): THREE.Object3D {
    const g = new THREE.Group();
    const panels = new THREE.InstancedMesh(this.geometries.box, this.solar, rows * perRow);
    const legs = new THREE.InstancedMesh(this.geometries.box, this.dark, rows * perRow);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    let i = 0;
    for (let r = 0; r < rows; r++) for (let k = 0; k < perRow; k++) {
      const x = (k - (perRow - 1) / 2) * 4.4, z = (r - (rows - 1) / 2) * 5.5;
      e.set(-0.55 + (rng.next() - 0.5) * 0.04, 0, 0);
      m.compose(new THREE.Vector3(x, 1.5, z), q.setFromEuler(e), new THREE.Vector3(4, 0.08, 2.6));
      panels.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, -1.3, z), q.identity(), new THREE.Vector3(0.12, 5.4, 0.12));
      legs.setMatrixAt(i, m);
      i++;
    }
    g.add(panels, legs);
    return g;
  }

  /** A comms dish on a short tower, tilted up toward the sky. */
  antenna(size: number): THREE.Object3D {
    const g = new THREE.Group();
    g.add(this.mesh(this.geometries.cylinder, this.steel, 0, (size - 4) / 2, 0, size * 0.05, size + 4, size * 0.05));
    const dish = this.mesh(this.geometries.dish, this.white, 0, size * 1.05, 0, size * 1.2);
    dish.rotation.x = -0.9;
    g.add(dish);
    g.add(this.mesh(this.geometries.sphere, this.beacon, 0, size * 1.6, 0, size * 0.04));
    return g;
  }

  /** A round landing pad with a ring of cyan lights; top surface at y = 0. */
  pad(radius: number): THREE.Object3D {
    const g = new THREE.Group();
    g.add(this.mesh(this.geometries.cylinder, this.concrete, 0, -FOOTING / 2, 0, radius, FOOTING, radius));
    const lights = new THREE.InstancedMesh(this.geometries.box, this.cyan, 32);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      m.makeRotationY(-a).setPosition(Math.cos(a) * radius * 0.94, 0.05, Math.sin(a) * radius * 0.94);
      m.scale(new THREE.Vector3(0.5, 0.15, 1.6));
      lights.setMatrixAt(i, m);
    }
    g.add(lights);
    const ring = this.mesh(this.geometries.ring, this.cyan, 0, 0.06, 0, radius * 0.55);
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    return g;
  }

  /** A white cargo pod on landing legs, about 4 m tall. */
  cargoPod(): THREE.Object3D {
    const g = new THREE.Group();
    g.add(this.mesh(this.geometries.capsule, this.white, 0, 2.4, 0, 1.1, 1.6, 1.1));
    g.add(this.mesh(this.geometries.box, this.dark, 0, 2.1, 1.0, 1.0, 1.4, 0.2));
    g.add(this.mesh(this.geometries.box, this.cyan, 0, 3.3, 1.05, 0.9, 0.08, 0.05));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const leg = this.mesh(this.geometries.box, this.steel, Math.cos(a) * 1.2, 0.6, Math.sin(a) * 1.2, 0.12, 1.5, 0.12);
      leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
      g.add(leg);
    }
    return g;
  }

  /** A low cylinder of tread marks or pipework between two points on the ground. */
  pipe(x0: number, z0: number, x1: number, z1: number, radius: number): THREE.Object3D {
    const length = Math.hypot(x1 - x0, z1 - z0);
    const pipe = this.mesh(this.geometries.cylinder, this.steel, (x0 + x1) / 2, radius + 0.3, (z0 + z1) / 2, radius, length, radius);
    pipe.rotation.set(Math.PI / 2, 0, 0);
    pipe.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan2(x1 - x0, z1 - z0));
    return pipe;
  }

  /** A small fuel depot by the road: a cluster of tanks, pipework and a light mast. */
  depot(rng: Rng): THREE.Object3D {
    const g = new THREE.Group();
    const tanks = rng.int(2, 4);
    const spots: [number, number][] = [];
    for (let i = 0; i < tanks; i++) {
      const r = rng.range(2.6, 4), h = rng.range(11, 18);
      const x = (i - (tanks - 1) / 2) * 9 + rng.range(-1, 1), z = rng.range(-3, 3);
      const tank = this.tank(r, h);
      tank.position.set(x, 0, z);
      g.add(tank);
      spots.push([x, z]);
    }
    for (let i = 0; i < spots.length - 1; i++) g.add(this.pipe(spots[i][0], spots[i][1] + 4, spots[i + 1][0], spots[i + 1][1] + 4, 0.35));
    const mast = this.mast(rng.range(20, 28));
    mast.position.set((tanks / 2) * 9 + 4, 0, 2);
    g.add(mast);
    return g;
  }

  /**
   * A small outpost: one to three greenhouse domes, a habitat module or two, a solar field and a
   * comms dish. Deliberately modest: an early settlement, not a city.
   */
  outpost(rng: Rng): THREE.Object3D {
    const g = new THREE.Group();
    const domes = rng.int(1, 3);
    let x = 0;
    const centres: [number, number][] = [];
    for (let i = 0; i < domes; i++) {
      const r = rng.range(9, 16);
      const z = rng.range(-8, 8);
      const dome = this.dome(r);
      dome.position.set(x + r, 0, z);
      g.add(dome);
      centres.push([x + r, z]);
      x += r * 2 + rng.range(10, 18);
    }
    const modules = rng.int(1, 2);
    for (let i = 0; i < modules; i++) {
      const module = this.module(rng.range(14, 22), rng.range(2.6, 3.4));
      module.position.set(rng.range(0, x), 0, (i % 2 ? -1 : 1) * rng.range(24, 30));
      module.rotation.y = rng.range(-0.2, 0.2);
      g.add(module);
    }
    for (let i = 0; i < centres.length - 1; i++) {
      g.add(this.pipe(centres[i][0], centres[i][1], centres[i + 1][0], centres[i + 1][1], 1.3));
    }
    const field = this.solarField(rng, rng.int(2, 4), rng.int(5, 9));
    field.position.set(x + 30, 0, rng.range(-15, 15));
    g.add(field);
    const antenna = this.antenna(rng.range(8, 12));
    antenna.position.set(-14, 0, rng.range(-10, 10));
    g.add(antenna);
    const mast = this.mast(rng.range(22, 30));
    mast.position.set(x * 0.5, 0, -22);
    g.add(mast);
    g.position.x = -x / 2;
    const holder = new THREE.Group();
    holder.add(g);
    return holder;
  }

  dispose() {
    for (const g of Object.values(this.geometries)) g.dispose();
    for (const m of [this.steel, this.white, this.dark, this.concrete, this.solar, this.glass, this.greenhouse, this.window, this.cyan, this.beacon, this.frame]) m.dispose();
  }
}
