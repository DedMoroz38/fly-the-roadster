import { afterEach, describe, expect, it, vi } from 'vitest';
import { CarModel } from '../src/render/carModel';
import { DEFAULT_VEHICLE, getSelectedVehicle, setSelectedVehicle, vehicleById, VEHICLES } from '../src/render/vehicles';

function fakeStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
}

afterEach(() => vi.unstubAllGlobals());

describe('vehicle catalogue', () => {
  it('lists every model once, with a bundled file and a credit for each licensed model', () => {
    expect(new Set(VEHICLES.map(v => v.id)).size).toBe(VEHICLES.length);
    expect(VEHICLES.map(v => v.id)).toEqual(['charger', 'roadster', 'cybertruck', 'delorean', 'dino', 'steve']);
    for (const v of VEHICLES) {
      expect(v.url).toMatch(/\.glb$/);
      if (v.id !== 'charger') expect(v.credit?.url).toMatch(/^https:\/\/sketchfab\.com\//);
    }
    // The 28.6 MB original is never shipped; the game loads the light bake.
    expect(vehicleById('roadster').url).toMatch(/lite\.glb$/);
  });

  it('remembers the selection and falls back to the default when storage is missing or stale', () => {
    vi.stubGlobal('localStorage', fakeStorage());
    expect(getSelectedVehicle()).toBe(DEFAULT_VEHICLE);
    setSelectedVehicle('dino');
    expect(getSelectedVehicle()).toBe('dino');
    localStorage.setItem('fly-the-roadster.vehicle', 'removed-model');
    expect(getSelectedVehicle()).toBe(DEFAULT_VEHICLE);
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(getSelectedVehicle()).toBe(DEFAULT_VEHICLE);
    expect(() => setSelectedVehicle('steve')).not.toThrow();
  });

  it('swaps the car look without touching its effects; unknown ids fall back to the default', () => {
    const car = new CarModel('cybertruck');
    expect(car.vehicleId).toBe('cybertruck');
    car.setVehicle('steve');
    expect(car.vehicleId).toBe('steve');
    car.setVehicle('nope');
    expect(car.vehicleId).toBe(DEFAULT_VEHICLE);
    car.setRollThrust(1, 0);
    car.update(1 / 60, 30);
  });
});
