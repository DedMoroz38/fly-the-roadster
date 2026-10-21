import { describe, it, expect } from 'vitest';
import { cameraGoal } from '../src/render/cameraRig';
import { CONFIG } from '../src/game/config';

describe('cameraGoal', () => {
  it('sits behind the car along world forward and looks ahead', () => {
    const g = cameraGoal({ x: 0, y: 0.35, z: -100 });
    expect(g.position.z).toBeGreaterThan(-100);
    expect(g.lookAt.z).toBeLessThan(-100);
  });
  it('stays inside the corridor when the car drives on walls and the ceiling', () => {
    const { halfWidth: W, height: H } = CONFIG.corridor;
    for (const car of [{ x: -5.6, y: 5, z: 0 }, { x: 5.6, y: 5, z: 0 }, { x: 0, y: 9.6, z: 0 }, { x: -5.6, y: 9.6, z: 0 }]) {
      const g = cameraGoal(car);
      expect(Math.abs(g.position.x)).toBeLessThan(W);
      expect(g.position.y).toBeGreaterThan(0);
      expect(g.position.y).toBeLessThan(H);
    }
  });
  it('has no dependency on roll (camera never barrel-rolls)', () => {
    // cameraGoal only takes a position; CameraRig always sets camera.up = +Y.
    expect(cameraGoal.length).toBe(1);
  });
});

describe('cameraGoal surface awareness', () => {
  it('views floor driving from above and ceiling driving from below', () => {
    const floor = cameraGoal({ x: 0, y: 0.35, z: 0 });
    const ceil = cameraGoal({ x: 0, y: CONFIG.corridor.height - 0.35, z: 0 });
    expect(floor.position.y).toBeGreaterThan(0.35 + 2);
    expect(ceil.position.y).toBeLessThan(CONFIG.corridor.height - 0.35 - 2);
  });
  it('views wall driving from the corridor side', () => {
    const left = cameraGoal({ x: -5.65, y: 5, z: 0 });
    const right = cameraGoal({ x: 5.65, y: 5, z: 0 });
    expect(left.position.x).toBeGreaterThan(-5.65 + 2);
    expect(right.position.x).toBeLessThan(5.65 - 2);
  });
});

import * as THREE from 'three';
import { CameraRig } from '../src/render/cameraRig';

describe('CameraRig (three.js camera)', () => {
  it('never rolls: camera right axis stays horizontal while the car moves over all surfaces', () => {
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500);
    const rig = new CameraRig(cam);
    const path = [
      { x: 0, y: 0.35, z: 0 }, { x: -5.65, y: 5, z: -50 }, { x: 0, y: 9.65, z: -100 }, { x: 5.65, y: 3, z: -150 }, { x: 2, y: -8, z: -200 },
    ];
    for (const p of path) {
      for (let i = 0; i < 60; i++) rig.update(p, 1 / 60);
      cam.updateMatrixWorld();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      expect(Math.abs(right.y)).toBeLessThan(1e-6); // no roll
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      expect(fwd.z).toBeLessThan(-0.85); // looking mostly along world forward
      expect(cam.position.z).toBeGreaterThan(p.z); // behind the car
    }
  });
});
