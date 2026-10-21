# Fly the Roadster — Implementation Increments

Source spec: `docs/plan.pdf`. Each increment must be verified (tests + build + manual/browser check
where relevant) to ≥95% confidence before the next one starts. Status legend: ✅ done · 🚧 in progress · ⬜ not started.

## Design decisions (apply to all increments)

- **Axes:** world forward = **−Z**, up = **+Y**, player's right = **+X**. Distance = `−z`.
- **Corridor:** 12 wide (x ∈ [−6, 6]) × 10 tall (y ∈ [0, 10]). Floor top at y=0, ceiling underside at y=10,
  walls at x=±6. All surface slabs sit *outside* the corridor, so geometry never blocks the corridor interior.
- **Car body:** Rapier dynamic body with rotations locked except around Z → barrel rolls only, no pitch/yaw/flips.
- **Arcade driving:** forward speed and lateral (steer) speed are set by the controller along the surface tangent;
  Rapier handles gravity and contacts. Car collider friction is ~0 so rolling on a surface is possible.
- **Left/Right arrows:** roll while airborne / not wheels-down; when wheels-down on a surface they steer in the
  car's local left/right (so on a left wall, "left" moves up the wall — spec §1 Suction last bullet).
  A/D always steer when on a surface.
- **Space:** thrust along car-up (away from the wheels). **ArrowUp:** forward thruster. Both share one fuel tank (5 s).
- **Suction (E):** raycast along car-down; attracts only when within range and wheels face the surface
  (normal within an angle threshold). Attached = gravity disabled + gentle press + roll stabilization.
- **Course:** discretized into 5-unit chunks with 4 boolean surface lanes; a guaranteed route is generated
  first (feasibility-checked gaps + fuel budget), then decoration surfaces are added. Physics/mesh slabs are built
  per contiguous run of chunks. Seeded RNG (mulberry32).
- **Simulation** (physics + rules) is independent of rendering so it can be tested headlessly in Vitest.

## Increments

### 1. Project scaffold ✅
- [x] Vite + React + TypeScript project, Three.js, Rapier (`@dimforge/rapier3d-compat`), Vitest
- [x] Renders a basic 3D scene in the browser; `npm run build`, `npm test`, `tsc` pass

### 2. Core infrastructure ✅
- [x] Seeded RNG, config constants
- [x] Input module: key state, simultaneous keys, edge-triggered toggles (E, R, Esc), preventDefault, blur release; H toggles help
- [x] Fixed-timestep accumulator (deterministic 60 Hz, independent of render FPS)
- [x] Fuel model (5 s tank, proportional consumption, empty blocks thrust, refill)
- [x] Unit tests for all of the above

### 3. Vehicle physics: driving + camera ✅
- [x] Headless `Simulation` (Rapier world, car body, static floor)
- [x] W accelerate / S brake-reverse, arcade forward speed, lateral steer, momentum preserved when leaving surface
- [x] Ground detection by raycast
- [x] Renderer: Three scene, low-poly futuristic car, follow camera that never rolls
- [x] Tests: car drives forward on floor, brakes, falls under gravity when unsupported
  Notes: road-hugging fix added (cancel off-surface velocity while supported, roll stabilization) because Rapier
  kicks the car at internal slab seams. Render interpolation between physics steps.

### 4. Thrusters + barrel roll ✅
- [x] Space = thrust away from wheels, ArrowUp = forward thrust, both consume fuel; none when empty
- [x] Arrow roll (continuous, 360°), no pitch/yaw possible
- [x] Tests: thrust lifts car & drains fuel in ~5 s, full 360° roll, pitch/yaw stay zero

### 5. Suction + surface attachment ✅
- [x] E toggles suction (off by default)
- [x] Attraction only if close enough & wheels face surface; no teleport (force-limited)
- [x] Attached: drive on ceiling/walls, stabilized, detaches on toggle-off
- [x] No sticking to walls/ceiling without suction
- [x] Surface-relative steering (left/right consistent from car perspective)
- [x] Tests: attach conditions (pure), headless floor→ceiling and ceiling→wall transitions with scripted inputs,
      no attach when suction off / wrong orientation / too far
  Notes: gravity is disabled while attached (velocity-based cancel caused drift) and reduced to 35% while
  the suction beam is pulling. A landing grip quickly removes sideways momentum on attach. Roll brakes
  firmly on key release and settles onto the nearest 90° orientation if within 25°, so precise 90°/180° rolls
  are controllable. Releasing suction is how you leave a wall/ceiling; thrust overrides the pull.
  Camera offsets toward the corridor centre from whichever surface the car drives on.
  Verified in-browser: floor → ceiling → left wall sequence driven by keyboard.

### 6. Procedural course ✅
- [x] Chunked 4-lane course model, run builder
- [x] Scripted intro (floor → ceiling → wall → combined) then seeded procedural generation
- [x] Guaranteed route with feasibility limits on gaps & fuel; difficulty ramps with distance
- [x] Fuel pickups as part of generation; pickups restore fuel
- [x] Streaming: build ahead, remove behind (physics + meshes), geometry never spawned inside car
- [x] Tests: determinism by seed, all four lanes toggle independently, route feasibility, pickup spacing,
      streaming add/remove
  Notes: feasibility is proven end-to-end by a test-only autopilot (`tests/bot.ts`) that plays the real
  physics with normal controls; 60/60 seeds reached 8 km during tuning, 12 seeds to 6 km run in CI tests.
  Tuning found & fixed: pieces must stay usable for (transition time × top speed + margin) after the
  previous piece ends; probe uses a 3×3 ray grid so contact holds near surface edges; firmer lateral
  braking grip; self-righting "pop" so a car on its roof/side can roll (box is wider than tall).

### 7. Game flow + HUD ✅
- [x] Distance score, fuel bar, suction status HUD
- [x] Game over on falling out of corridor / crash / unrecoverable; R restart resets everything; Esc pause
- [x] Help overlay with controls
- [x] Tests: game over triggers, restart resets state
  Notes: `GameSession` (pure, tested) owns state ready/running/paused/gameover, score = max distance,
  failure rules (fell >15 m outside corridor, crash = >18 m/s forward speed lost in one step,
  stranded = airborne with no progress for 6 s). Autopilot runs use the same rules: 80/80 seeds reached
  8 km with no false crash. To avoid cheap deaths, slab leading edges are bevelled (3 m ramp), slabs
  are single convex pieces (no internal seams), steering can't push the car past the corridor edge,
  suction never drags the car through a surface plane, and hard landings are de-penetrated.
  Verified in browser: ready/help screen, HUD, pause, game over (fell), restart.

### 8. Visual polish ✅
- [x] Distinct surface materials (floor/ceiling/walls), lighting, fog/depth cues, gap visibility
- [x] Thruster flames, suction indicator + attach flash, refuel feedback, pickup glow
- [x] Camera adjustments for wall/ceiling driving, no clipping
  Notes: corridor trim lines, starfield, under-fill light, suction beam cone, thruster glow, pickup light
  beams + collection burst, HUD refuel flash, speed-based FOV. Measured 60 fps (~40 draw calls); scene
  objects / geometries / colliders stay bounded over 6 km of streaming.

### 9. Final verification ✅
- [x] Walk through all 19 acceptance criteria (table below)
- [x] Browser play-through of the intro sequence (floor → ceiling → left wall → fuel pickup) by keyboard
- [x] Production build (`npm run build`) runs in the browser with no errors

## Acceptance criteria

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Launches locally, renders a 3D playable environment | ✅ | `npm run dev` / `npm run build` + browser checks |
| 2 | Drive forward along a floor with W | ✅ | `tests/driving.test.ts`, browser |
| 3 | Holding Space activates thrusters and consumes fuel | ✅ | `tests/thrust-roll.test.ts` |
| 4 | Full barrel rolls with ←/→ | ✅ | `barrel roll` tests (360°+ both ways) |
| 5 | No front/back flips or unrestricted rotation | ✅ | rotations locked to Z; test checks quaternion x/y = 0 under stress |
| 6 | E toggles suction | ✅ | `tests/core.test.ts` (edge-triggered), suction tests |
| 7 | Ceiling attach only with suction on, wheels facing, close enough | ✅ | `tests/suction.test.ts` (pure rules + physics) |
| 8 | Same for left and right walls | ✅ | `wall attachment` tests |
| 9 | Drive forward while attached to any of the four surfaces | ✅ | floor/ceiling/left/right drive tests |
| 10 | Floor → ceiling with thrust, 180° roll, suction | ✅ | `tests/transitions.test.ts`, browser keyboard run |
| 11 | Ceiling → side wall with thrust, rotation, suction | ✅ | `tests/transitions.test.ts` (incl. thrust-assisted case), browser |
| 12 | Four surfaces appear/disappear independently | ✅ | `tests/course.test.ts` (toggle counts, ≥12 combos) |
| 13 | Course extends forward indefinitely | ✅ | generator to 50 km; streaming test |
| 14 | Fuel runs out after ~5 s; pickups replenish | ✅ | fuel + pickup tests, browser refuel |
| 15 | Camera follows without rotating with rolls | ✅ | `tests/camera.test.ts` (camera right axis stays horizontal) |
| 16 | Distance, fuel and suction status displayed | ✅ | HUD, browser screenshots |
| 17 | Falling outside the course triggers game over | ✅ | `tests/session.test.ts`, browser |
| 18 | Restart resets the game | ✅ | `tests/session.test.ts` (world, course, fuel, score, car), browser |
| 19 | Automated tests: fuel, suction conditions, transitions, seeded generation | ✅ | 111 Vitest tests incl. autopilot feasibility on 12 seeds × 6 km |

## Design decisions / interpretations worth knowing
- **Steering:** the spec lists no steering keys but requires car-relative turning on surfaces. Arrows roll in
  the air and steer while on a surface; A/D also steer. On the left wall, "left" moves up the wall.
- **Leaving walls/ceilings:** release suction (E). Thrust also overrides the suction pull.
- **Arcade assists:** roll brakes on key release and settles onto the nearest 90° when within 25°; rolling while
  lying on the roof/side pops the car off the surface (self-righting); the suction beam reduces gravity to 35%
  while pulling; gravity is off while attached.
- **Failure:** fell (>15 m outside the corridor), crashed (lost >18 m/s forward speed in one step, i.e. a head-on
  hit), stranded (airborne with no progress for 6 s). Slab leading edges are bevelled so grazing isn't fatal.
- **Seeds:** `?seed=N` in the URL; R restarts the same seed.
