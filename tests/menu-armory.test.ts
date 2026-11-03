import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ARMORY, bounce, floorAt, removalDue, throwVelocity } from '../src/render/menuArmory';
import { VEHICLES } from '../src/render/vehicles';

describe('showroom armory', () => {
  it('belongs to the Cybertruck only, which names its window glass', () => {
    const armed = VEHICLES.filter(v => v.armory);
    expect(armed.map(v => v.id)).toEqual(['cybertruck']);
    expect(armed[0].armory!.glass).toBe('Material.001');
  });

  it('throws a ball that arrives at the aimed point after the flight time', () => {
    const from = new THREE.Vector3(3.9, 1.1, 2.5), to = new THREE.Vector3(-0.4, 0.9, 0.1), time = 0.6;
    const v = throwVelocity(from, to, time);
    const landed = from.clone().addScaledVector(v, time).add(new THREE.Vector3(0, -0.5 * ARMORY.gravity * time * time, 0));
    expect(landed.distanceTo(to)).toBeLessThan(1e-9);
  });

  it('bounces off a surface: the push into it reverses and shrinks, the slide keeps some speed', () => {
    const up = new THREE.Vector3(0, 1, 0);
    const out = bounce(new THREE.Vector3(4, -10, 0), up, 0.5, 0.8);
    expect(out.y).toBeCloseTo(5);
    expect(out.x).toBeCloseTo(3.2);
    // A bullet straight into glass comes straight back out, slower.
    const back = bounce(new THREE.Vector3(0, 0, -42), new THREE.Vector3(0, 0, 1), ARMORY.restitution.bullet);
    expect(back.z).toBeGreaterThan(0);
    expect(back.length()).toBeLessThan(42);
  });

  it('removes a projectile five seconds after it first comes down, never while it flies', () => {
    expect(removalDue(null, 100)).toBe(false);
    expect(removalDue(10, 10 + ARMORY.linger - 0.01)).toBe(false);
    expect(removalDue(10, 10 + ARMORY.linger)).toBe(true);
    expect(ARMORY.linger).toBe(5);
  });

  it('has a floor on the pad and none beyond it, where things fall away', () => {
    expect(floorAt(0, 0)).toBe(ARMORY.floor[0].y);
    expect(floorAt(2.8, 0)).toBe(ARMORY.floor[1].y);
    expect(floorAt(3.5, 0)).toBeNull();
  });
});
