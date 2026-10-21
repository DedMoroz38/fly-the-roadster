/** All gameplay tuning in one place. Units: metres, seconds. World forward is -Z. */
export const CONFIG = {
  physicsHz: 60,
  gravity: 20,

  corridor: {
    halfWidth: 6, // walls at x = ±6
    height: 10, // floor at y = 0, ceiling at y = 10
    slabThickness: 1,
  },

  car: {
    halfExtents: { x: 0.9, y: 0.35, z: 1.7 },
    mass: 1, // via density; controller works with accelerations
    maxForwardSpeed: 32,
    maxReverseSpeed: 10,
    acceleration: 22,
    braking: 45,
    coastDecel: 3,
    steerSpeed: 9,
    steerAccel: 50,
    landingGrip: 110, // decel of sideways speed beyond steering speed after landing/attaching
    rollSpeed: 5, // rad/s, ~1.3 s per full 360° roll
    rollAccel: 30,
    rollBrake: 28, // rad/s² deceleration of the roll once the arrow key is released
    rollAssistAngleDeg: 25, // when idle, settle toward the nearest 90° orientation within this angle
    rollAssistGain: 5,
    groundProbe: 0.35, // extra distance below wheels considered "touching"
    rollPopSpeed: 4.5, // push-off speed when rolling while the roof/side rests on a surface
  },

  thrusters: {
    liftAccel: 42, // > gravity so the car can climb
    forwardAccel: 18,
    maxBoostSpeed: 46,
  },

  fuel: {
    capacity: 5, // seconds of continuous thrust
    pickupRadius: 2.6,
  },

  suction: {
    range: 7, // max distance from wheels to a surface for attraction
    attachDistance: 0.45, // wheels-to-surface gap that counts as attached
    maxAlignAngleDeg: 40, // wheels must face the surface within this angle
    attractAccel: 30, // pull acceleration at max range (grows as it closes)
    maxAttractAccel: 55,
    pressAccel: 25, // extra press into the surface while attached
    stabilizeGain: 14,
    stabilizeDamping: 6,
    maxApproachSpeed: 14, // cap on velocity toward the surface (no snapping)
    attractGravityScale: 0.35, // the suction beam partly carries the car while pulling it in
  },

  fail: {
    outsideMargin: 15, // distance outside corridor bounds before game over
    crashSpeedDrop: 18, // sudden forward speed loss in one step (head-on) => crash
    stuckSeconds: 6,
  },
} as const;

export type GameConfig = typeof CONFIG;
