/** All gameplay tuning in one place. Units: metres, seconds. World forward is -Z. */
export const CONFIG = {
  physicsHz: 60,
  gravity: 20,
  origin: { rebaseDistance: 256 }, // keep Rapier Float32 positions near the player

  corridor: {
    halfWidth: 6, // walls at x = ±6
    height: 10, // floor at y = 0, ceiling at y = 10
    slabThickness: 1,
  },

  car: {
    halfExtents: { x: 0.9, y: 0.35, z: 1.7 },
    mass: 1, // explicit collider mass; forces use the body’s actual mass/inertia
    cruiseSpeed: 24,
    maxForwardSpeed: 32,
    driveGain: 4,
    acceleration: 22,
    coastDecel: 3,
    steerSpeed: 9,
    gripGain: 20,
    steerAccel: 50,
    landingGrip: 110, // decel of sideways speed beyond steering speed after landing/attaching
    rollSpeed: 5, // rad/s, ~1.3 s per full 360° roll
    rollAccel: 30,
    contactRollAccel: 150, // extra torque to tip against the wide contact footprint
    rollInputGain: 30,
    rollDamping: 12,
    rollBrake: 28, // rad/s² deceleration of the roll once the arrow key is released
    rollAssistAngleDeg: 25, // when idle, settle toward the nearest 90° orientation within this angle
    rollAssistGain: 5,
    groundProbe: 0.35, // extra distance below wheels considered "touching"
    contactSpring: 100,
    contactDamping: 20,
    suctionApproachGain: 8,
  },

  thrusters: {
    liftAccel: 42, // > gravity so the car can climb
    liftFuelRate: 1,
    boostFuelRate: 0.4, // W / Up acceleration; automatic cruise uses no fuel
    rollFuelRate: 0.08,
  },

  fuel: {
    capacity: 5, // seconds of continuous thrust
    pickupRadius: 2.6,
  },

  suction: {
    range: 2.5, // attraction requires a nearby surface facing the wheels
    attachDistance: 0.4, // wheels-to-surface gap that counts as attached
    maxAlignAngleDeg: 40, // wheels must face the surface within this angle
    attractAccel: 30, // pull acceleration at max range (grows as it closes)
    maxAttractAccel: 55,
    pressAccel: 25, // extra press into the surface while attached
    stabilizeGain: 14,
    stabilizeDamping: 6,
    maxApproachSpeed: 14, // cap on velocity toward the surface (no snapping)
    attractGravityScale: 0.35, // the suction beam partly carries the car while pulling it in
    criticalHeat: 100,
    recoveryHeat: 35,
    warningHeat: 75,
    floorHeatRate: 24,
    heatRate: 1.5, // normal wall/ceiling or airborne use
    coolingRate: 18,
    floorFuelRate: 0.18,
    fuelRate: 0.04,
    floorRollingResistance: 3, // m/s² opposing motion only during floor contact
  },

  fail: {
    outsideMargin: 15, // distance outside corridor bounds before game over
    crashSpeedDrop: 18, // sudden forward speed loss in one step (head-on) => crash
    roofAngleDeg: 45, // roof landing: within this angle of fully inverted
    roofContactSlop: 0.01, // metres; tolerate the contact solver's small resting gap
    stuckSeconds: 6,
  },
} as const;

export type GameConfig = typeof CONFIG;
