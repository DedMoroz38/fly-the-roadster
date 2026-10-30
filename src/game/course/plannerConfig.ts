/** Constructive route planning limits. Distances in metres, time in seconds. */
export const PLANNER_CONFIG = {
  /** Run-up after a landing before the next maneuver, at difficulty 0; shrinks to the hardest value. */
  reactionSeconds: 2,
  reactionSecondsHardest: 1.2,
  /** Covers early timing (0.15 s at max speed) and the previous chunk's late landing. */
  reactionMargin: 10,
  timingTolerance: 0.15,
  /** Floor after the last maneuver of a chunk, at difficulty 0 and at difficulty 1. */
  recoverySeconds: 2,
  recoverySecondsHardest: 1.4,
  /** Minimum recovery after a wall/ceiling run, so suction has cooled below its recovery heat. */
  surfaceCooldownSeconds: 1.7,
  /** Fuel left unplanned at each launch, so a slightly wasteful player can still complete it. */
  launchFuelReserve: 0.25,
  /** The next chunk opens with a pickup before any maneuver, so only a small exit margin is kept. */
  exitFuelReserve: 0.1,
  maxValidationSeconds: 45,
  sampleEverySteps: 6,
  introMin: 110,
  introMax: 130,
  leadMin: 44,
  leadMax: 56,
  supportOverlap: 20,
  ceilingLaunchLead: 30,
  ceilingLiftSeconds: 0.6,
  wallLiftSeconds: 0.45,
  gapLaunchLead: 6,
  wallSetupLead: 40,
  /**
   * Wall/ceiling suction heats as fast as the floor (~4 s to critical). A traversal must outlast
   * the reaction interval after attaching yet end before overheating, so the window is narrow.
   */
  surfaceTraversal: 80,
  traversalVariation: 8,
  /** A sideways launch attaches later than a ceiling launch; extends wall runs to match. */
  wallAttachDelay: 5,
  /** Ceiling drop to wall launch in a multiple; long enough to react and to cool suction. */
  multipleFloorLeg: 110,
  setupWallDistance: 1.9,
  wallReturnHeight: 3,
  /** Wall support beyond the planned drop; the 3 m fall lands almost at once. */
  wallDropPad: 20,
  pickupInset: 12,
  gapMin: 24,
  gapMax: 30,
  flightMin: 52,
  flightMax: 60,
  slalomMin: 200,
  slalomMax: 260,
  slalomSegment: { min: 36, max: 46 },
  slalomLane: { min: 3.2, max: 3.6 },
  /** Straight floor after the last lane change of a chunk, so it ends centred and steady. */
  slalomExit: 32,
  /** Fraction by which slalom lane changes shorten at difficulty 1. */
  slalomTightening: 0.3,
  /** Straight floor after the last lane change before a launch, so the car is not sliding sideways. */
  weaveSettle: 15,
  /** Low full-width barriers inside floor runs: chance per lane change at difficulty 1, and limits. */
  floorBarrierChance: 0.5,
  floorBarrierMax: 2,
  floorBarrierHeight: { min: 0.8, max: 1.2 },
  /** Full-width floor barriers jumped with one lift pulse; offset is from the launch point. */
  hurdleCount: { min: 1, max: 3 },
  hurdleHeight: { min: 1, max: 2 },
  hurdleHalfLength: 0.5,
  hurdleOffset: 18,
  hurdleLiftSeconds: 0.4,
  hurdleSpacing: 125,
  hurdleLanding: 50,
} as const;
