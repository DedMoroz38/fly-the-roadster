import { describe, it, expect } from 'vitest';
import { Rng, hashSeed } from '../src/core/rng';
import { FixedStepper } from '../src/core/fixedStep';
import { wrapAngle, approach } from '../src/core/math';
import { FuelTank } from '../src/game/fuel';
import { InputManager } from '../src/game/input';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = Array.from({ length: 20 }, () => a.next());
    const sb = Array.from({ length: 20 }, () => b.next());
    const sc = Array.from({ length: 20 }, () => c.next());
    expect(sa).toEqual(sb);
    expect(sa).not.toEqual(sc);
  });
  it('stays in range', () => {
    const r = new Rng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(3, 5);
      expect([3, 4, 5]).toContain(n);
    }
  });
  it('hashSeed is stable', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });
});

describe('FixedStepper', () => {
  it('produces steps independent of frame rate', () => {
    const dt = 1 / 60;
    const fast = new FixedStepper(dt), slow = new FixedStepper(dt);
    let a = 0, b = 0;
    for (let i = 0; i < 144; i++) a += fast.advance(1 / 144);
    for (let i = 0; i < 30; i++) b += slow.advance(1 / 30);
    expect(a).toBeGreaterThanOrEqual(59);
    expect(a).toBeLessThanOrEqual(60);
    expect(b).toBeGreaterThanOrEqual(59);
    expect(b).toBeLessThanOrEqual(60);
  });
  it('clamps huge frame gaps', () => {
    const s = new FixedStepper(1 / 60, 8);
    expect(s.advance(5)).toBe(8);
    expect(s.advance(0)).toBe(0);
  });
});

describe('math', () => {
  it('wrapAngle', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
  });
  it('approach', () => {
    expect(approach(0, 10, 3)).toBe(3);
    expect(approach(9, 10, 3)).toBe(10);
    expect(approach(0, -10, 3)).toBe(-3);
  });
});

describe('FuelTank', () => {
  it('lasts ~5 seconds of continuous thrust', () => {
    const tank = new FuelTank(5);
    const dt = 1 / 60;
    let steps = 0;
    while (tank.consume(dt, 1) > 0) steps++;
    expect(steps * dt).toBeGreaterThan(4.9);
    expect(steps * dt).toBeLessThan(5.1);
    expect(tank.isEmpty).toBe(true);
  });
  it('consumes proportionally to active thrusters', () => {
    const tank = new FuelTank(5);
    tank.consume(1, 2);
    expect(tank.value).toBeCloseTo(3);
    tank.consume(0.5, 1);
    expect(tank.value).toBeCloseTo(2.5);
    tank.consume(1, 0);
    expect(tank.value).toBeCloseTo(2.5);
  });
  it('blocks thrust when empty and returns partial fraction', () => {
    const tank = new FuelTank(1);
    expect(tank.consume(2, 1)).toBeCloseTo(0.5);
    expect(tank.consume(0.1, 1)).toBe(0);
  });
  it('refills up to capacity', () => {
    const tank = new FuelTank(5);
    tank.consume(4, 1);
    tank.refill(2);
    expect(tank.value).toBeCloseTo(3);
    tank.refill();
    expect(tank.value).toBe(5);
    tank.consume(5, 1);
    tank.reset();
    expect(tank.fraction).toBe(1);
  });
});

describe('InputManager', () => {
  it('supports simultaneous held keys', () => {
    const im = new InputManager();
    im.keyDown('KeyW');
    im.keyDown('Space');
    im.keyDown('ArrowLeft');
    const c = im.sample();
    expect(c.accelerate && c.thrust && c.rollLeft).toBe(true);
    im.keyUp('Space');
    expect(im.sample().thrust).toBe(false);
  });
  it('suction toggle is edge-triggered and ignores auto-repeat', () => {
    const im = new InputManager();
    im.keyDown('KeyE');
    expect(im.sample().toggleSuction).toBe(true);
    im.keyDown('KeyE', true);
    expect(im.sample().toggleSuction).toBe(false);
    im.keyUp('KeyE');
    im.keyDown('KeyE');
    expect(im.sample().toggleSuction).toBe(true);
  });
  it('reports which keys it handles (for preventDefault)', () => {
    const im = new InputManager();
    expect(im.keyDown('Space')).toBe(true);
    expect(im.keyDown('KeyQ')).toBe(false);
  });
  it('clear releases held keys', () => {
    const im = new InputManager();
    im.keyDown('KeyW');
    im.clear();
    expect(im.sample().accelerate).toBe(false);
  });
});
