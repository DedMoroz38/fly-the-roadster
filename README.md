# Fly the Roadster

Browser 3D physics platformer: drive a futuristic car down an endless, procedurally generated
corridor of floors, ceilings and side walls. Thrust, barrel-roll and use suction to stick to any surface.

Built with TypeScript, Three.js, Rapier (`@dimforge/rapier3d-compat`), React and Vite.

## Run

```bash
npm install
npm run dev        # http://localhost:5173  (add ?seed=123 for a repeatable course)
npm test           # unit + physics + course-feasibility tests (Vitest, headless)
npm run build      # typecheck + production build
```

Requires Node 18+ (developed on Node 21).

## Controls

| Key | Action |
| --- | --- |
| W / S | Accelerate / brake & reverse |
| Space | Main thrusters (push away from the wheels) |
| ↑ | Forward thruster (boost) |
| ← / → | Barrel roll in the air · steer (car-relative) while on a surface |
| A / D | Steer on a surface |
| E | Toggle suction |
| R | Restart (same seed) |
| Esc | Pause |
| H | Help overlay |

Floors hold the car by gravity. Walls and ceilings need suction with the wheels facing them.
The fuel tank holds about 5 s of thrust; green fuel cells refill it.

## Layout

```
src/core/          seeded RNG, fixed-step accumulator, math helpers
src/game/          rules & physics (no rendering): config, input, fuel, suction rule,
                   session (state/score/failure), simulation, physics/vehicle, physics/level
src/game/course/   seeded generator (route + decorations + pickups) and streaming into physics
src/render/        Three.js renderer: car model, surfaces, pickups, camera rig
src/ui/            React app, HUD and overlays
tests/             Vitest suites; tests/bot.ts is a test-only autopilot that plays generated
                   courses through the real physics to prove they are completable
```

See `INCREMENTS.md` for the build plan and status.
