import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CarModel } from '../src/render/carModel';

function rollFlames(car: CarModel, control: 'left' | 'right') {
  return car.group.children.filter((child) => child.name.startsWith(`roll-${control}-flame-`)) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
}

describe('roll thruster visuals', () => {
  it('starts hidden and fires only the commanded channel', () => {
    const car = new CarModel();
    const left = rollFlames(car, 'left');
    const right = rollFlames(car, 'right');
    expect(left).toHaveLength(4);
    expect(right).toHaveLength(4);
    expect([...left, ...right].every((flame) => !flame.visible)).toBe(true);

    car.setRollThrust(0.5, 0);
    expect(left.every((flame) => flame.visible)).toBe(true);
    expect(right.every((flame) => !flame.visible)).toBe(true);
    car.setRollThrust(0, 0.5);
    expect(left.every((flame) => !flame.visible)).toBe(true);
    expect(right.every((flame) => flame.visible)).toBe(true);
  });

  it('points opposite exhaust jets in the directions that produce the requested roll', () => {
    const car = new CarModel();
    for (const control of ['left', 'right'] as const) {
      const totalForce = new THREE.Vector3();
      const totalTorque = new THREE.Vector3();
      for (const flame of rollFlames(car, control)) {
        // The actual cone must taper from its nozzle at y=0 to y=-1.
        const vertices = flame.geometry.getAttribute('position');
        let baseRadius = 0;
        for (let i = 0; i < vertices.count; i++) {
          const radius = Math.hypot(vertices.getX(i), vertices.getZ(i));
          if (vertices.getY(i) < -0.99) expect(radius).toBeLessThan(1e-6);
          if (vertices.getY(i) > -0.01) baseRadius = Math.max(baseRadius, radius);
        }
        expect(baseRadius).toBeGreaterThan(0.13);
        const exhaust = new THREE.Vector3(0, -1, 0).applyQuaternion(flame.quaternion);
        const expectedY = control === 'left' ? -Math.sign(flame.position.x) : Math.sign(flame.position.x);
        expect(exhaust.y).toBeCloseTo(expectedY, 6);
        expect(flame.name).toContain(expectedY > 0 ? '-up-' : '-down-');
        const force = exhaust.negate();
        totalForce.add(force);
        totalTorque.add(new THREE.Vector3().crossVectors(flame.position, force));
      }
      expect(totalForce.length()).toBeLessThan(1e-6);
      expect(Math.abs(totalTorque.x)).toBeLessThan(1e-6);
      expect(Math.abs(totalTorque.y)).toBeLessThan(1e-6);
      expect(Math.sign(totalTorque.z)).toBe(control === 'left' ? 1 : -1);
    }
  });

  it('scales with applied thrust and freezes flicker while simulation time is paused', () => {
    const car = new CarModel();
    const flame = rollFlames(car, 'left')[0];
    car.setRollThrust(0.2, 0);
    const weakLength = flame.scale.y;
    const weakOpacity = flame.material.opacity;
    car.setRollThrust(1, 0);
    expect(flame.scale.y).toBeGreaterThan(weakLength);
    expect(flame.material.opacity).toBeGreaterThan(weakOpacity);

    car.update(0.1, 0);
    car.setRollThrust(1, 0);
    const frozenScale = flame.scale.clone();
    car.update(0, 30);
    car.setRollThrust(1, 0);
    expect(flame.scale.equals(frozenScale)).toBe(true);
    car.setRollThrust(0, 0);
    expect(flame.visible).toBe(false);
    expect(flame.material.opacity).toBe(0);
  });
});
